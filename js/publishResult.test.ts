/**
 * Pure-Tests fuer die Publish-Auswertung (welshman-frei).
 *   node --test packages/einundzwanzig-group/js/publishResult.test.ts
 *
 * Der Kern: `timeout` und `aborted` sind FEHLER. welshmans `waitForThunkError` meldet
 * fuer beide `''` (Erfolg), weil `thunkIsComplete` nur `sending`/`pending` als „laeuft
 * noch" kennt. Genau das liess in `buzz-moderation:95` ein nie gesendetes 9005 als
 * zugestellt durchgehen — der Client machte mit dem 9044 weiter und schloss die
 * Meldung, waehrend der Inhalt am Relay liegen blieb.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
    NO_VERDICT_ERROR,
    PUBLISH_VERDICT_TIMEOUT_MS,
    mapRelayError,
    publishError,
    setRelayNoticeReader,
    waitForPublishError,
} from './publishResult.ts'

/**
 * Minimaler Thunk-Ersatz: `emit` schiebt einen Zustand nach, `options.relays` traegt die
 * Ziele — genau die Form, aus der `waitForPublishError` die NOTICE-Quelle liest.
 */
const fakeThunk = (relays: string[] = ['wss://a']) => {
    const subs: ((t: { results?: Record<string, { status?: string; detail?: string }> }) => void)[] = []
    return {
        options: { relays },
        subscribe: (cb: (typeof subs)[number]) => {
            subs.push(cb)
            cb({ results: {} })
            return () => {}
        },
        emit: (results: Record<string, { status?: string; detail?: string }>) => subs.forEach((cb) => cb({ results })),
    }
}

test('alle Relays melden success → leerer String (Erfolg)', () => {
    assert.equal(publishError({ 'wss://a': { status: 'success' }, 'wss://b': { status: 'success' } }), '')
})

test('noch nichts entschieden → undefined, nicht Erfolg', () => {
    assert.equal(publishError({}), undefined)
    assert.equal(publishError(undefined), undefined)
    assert.equal(publishError({ 'wss://a': { status: 'sending', detail: 'sending...' } }), undefined)
    assert.equal(publishError({ 'wss://a': { status: 'pending' } }), undefined)
})

test('ein Relay laeuft noch → das Ergebnis der anderen zaehlt noch nicht', () => {
    assert.equal(publishError({ 'wss://a': { status: 'success' }, 'wss://b': { status: 'pending' } }), undefined)
})

test('failure liefert die Begruendung des Relays', () => {
    assert.equal(publishError({ 'wss://a': { status: 'failure', detail: 'invalid: bad tag' } }), 'invalid: bad tag')
})

test('TIMEOUT ist ein Fehler — welshman meldet hier faelschlich Erfolg', () => {
    assert.equal(publishError({ 'wss://a': { status: 'timeout', detail: 'timed out' } }), 'timed out')
})

test('ABORTED ist ein Fehler — dieselbe Luecke', () => {
    assert.equal(publishError({ 'wss://a': { status: 'aborted', detail: 'aborted' } }), 'aborted')
})

test('ohne detail faellt die Begruendung auf den Status zurueck (nie leer)', () => {
    assert.equal(publishError({ 'wss://a': { status: 'timeout' } }), 'timeout')
})

test('unbekannter Status gilt als Fehler, nicht als Erfolg', () => {
    // Die Auswertung ist bewusst „alles ausser success ist ein Fehler" — ein kuenftiger
    // welshman-Status darf nicht still als zugestellt durchgehen.
    assert.equal(publishError({ 'wss://a': { status: 'irgendwas-neues' } }), 'irgendwas-neues')
    assert.equal(publishError({ 'wss://a': {} }), 'Publish fehlgeschlagen')
})

test('ein schlechtes Relay unter mehreren gewinnt', () => {
    assert.equal(
        publishError({ 'wss://a': { status: 'success' }, 'wss://b': { status: 'timeout', detail: 'timed out' } }),
        'timed out',
    )
})

// ── Die Zeitgrenze: ohne Verdikt darf nicht ewig gewartet werden ───────────

test('Ein Relay, das NIE antwortet, laeuft in einen Fehler statt in eine Ewigkeit', async (t) => {
    // Buzz antwortet auf ein ratenbegrenztes EVENT mit einer nackten NOTICE statt mit
    // einem OK. welshman ordnet Ergebnisse ueber die Event-Id aus dem OK zu — es kommt
    // also nie eins, und der Thunk bleibt fuer immer `pending`. Vor dieser Grenze wartete
    // der Aufrufer ewig: kein Fehler, keine Meldung, der Knopf blieb `busy`.
    t.mock.timers.enable({ apis: ['setTimeout'] })
    setRelayNoticeReader(() => '')
    const thunk = fakeThunk()
    const p = waitForPublishError(thunk)
    t.mock.timers.tick(PUBLISH_VERDICT_TIMEOUT_MS + 1)
    assert.equal(await p, NO_VERDICT_ERROR)
})

test('Die Relay-Begruendung steht IN der Meldung, wenn sie rechtzeitig kam', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] })
    setRelayNoticeReader((url) => (url === 'wss://a' ? 'rate-limited: quota exceeded; retry in 2s' : ''))
    const p = waitForPublishError(fakeThunk())
    t.mock.timers.tick(PUBLISH_VERDICT_TIMEOUT_MS + 1)
    assert.equal(await p, `${NO_VERDICT_ERROR} rate-limited: quota exceeded; retry in 2s`)
    setRelayNoticeReader(() => '')
})

test('Ein echtes Verdikt gewinnt gegen die Zeitgrenze — auch spaeter noch', async (t) => {
    // Die Grenze ist eine Notbremse, kein zweiter Bewerter: kommt das OK, zaehlt das OK.
    t.mock.timers.enable({ apis: ['setTimeout'] })
    const thunk = fakeThunk()
    const p = waitForPublishError(thunk)
    thunk.emit({ 'wss://a': { status: 'success' } })
    t.mock.timers.tick(PUBLISH_VERDICT_TIMEOUT_MS + 1)
    assert.equal(await p, '', 'Erfolg bleibt Erfolg')
})

test('Nach dem Verdikt feuert die Zeitgrenze nicht mehr nach', async (t) => {
    // `clearTimeout` ist kein Detail: ohne ihn haengt in jedem Tab je Publish ein Timer
    // ueber 20 s nach — und in einem Chat sind das viele.
    t.mock.timers.enable({ apis: ['setTimeout'] })
    const thunk = fakeThunk()
    const p = waitForPublishError(thunk)
    thunk.emit({ 'wss://a': { status: 'failure', detail: 'invalid: bad tag' } })
    assert.equal(await p, 'invalid: bad tag')
    t.mock.timers.tick(PUBLISH_VERDICT_TIMEOUT_MS + 1)
    assert.equal(await p, 'invalid: bad tag', 'die Grenze ueberschreibt nichts mehr')
})

// ── P7: die Relay-Begruendung darf nicht verlorengehen ─────────────────────────────
//
// Die Faelle unten sind LITERALE Relay-Antworten, keine erfundenen. Herkunft:
//   · `blocked: NIP-05 verification needed to publish events`
//     — wss://nostr.einundzwanzig.space (nostr-rs-relay 0.10.0), gemessen 2026-08-21
//   · `restricted: you are not a member of this relay`  — zooid
//   · `restricted: unknown event kind`                  — Buzz auf ein kind 1111
//
// Der Kern der Zusage ist in ALLEN Faellen derselbe: der Originaltext steht WOERTLICH
// in der Meldung. Vorher wurde er verworfen und durch „du bist evtl. kein Mitglied
// dieses Raums" ersetzt — fuer den ersten und den dritten Fall eine erfundene Ursache.

const NIP05_ABLEHNUNG = 'blocked: NIP-05 verification needed to publish events'

test('KERNBEWEIS: die NIP-05-Ablehnung steht WOERTLICH in der Meldung', () => {
    const meldung = mapRelayError(NIP05_ABLEHNUNG)

    assert.ok(
        meldung.includes(NIP05_ABLEHNUNG),
        `Der Relay-Grund fehlt in der Meldung: ${meldung}`,
    )
})

test('… und die frueher erfundene Ursache steht NICHT mehr darin', () => {
    // Literal und nicht ueber eine Konstante: genau dieser Satz war der Fehler, und ein
    // Test gegen ein Symbol wuerde eine Rueckkehr nicht bemerken.
    assert.ok(!mapRelayError(NIP05_ABLEHNUNG).includes('kein Mitglied dieses Raums'))
})

test('die NIP-05-Ablehnung bekommt ihren eigenen Hinweis, nicht den Mitglieds-Hinweis', () => {
    const meldung = mapRelayError(NIP05_ABLEHNUNG)

    assert.ok(meldung.includes('NIP-05-Adresse'), meldung)
    assert.ok(!meldung.includes('kein Mitglied'), meldung)
})

test('zooids Mitglieds-Ablehnung behaelt ihren Hinweis — und traegt den Grund mit', () => {
    const roh = 'restricted: you are not a member of this relay'
    const meldung = mapRelayError(roh)

    assert.ok(meldung.includes('kein Mitglied dieses Relays'), meldung)
    assert.ok(meldung.includes(roh), meldung)
})

test('eine Ablehnung ohne passenden Hinweis erfindet keine Ursache', () => {
    const roh = 'restricted: unknown event kind'
    const meldung = mapRelayError(roh)

    assert.ok(meldung.includes(roh), meldung)
    assert.ok(!meldung.includes('Mitglied'), meldung)
    assert.ok(!meldung.includes('NIP-05'), meldung)
})

test('Rate-Limit bleibt handlungsleitend und nennt trotzdem den Wortlaut', () => {
    const roh = 'rate-limited: quota exceeded; retry in 2s'
    const meldung = mapRelayError(roh)

    assert.ok(meldung.includes('Zu viele Nachrichten'), meldung)
    assert.ok(meldung.includes(roh), meldung)
})

test('`auth` steht ZULETZT — eine spezifischere Ursache im selben Text gewinnt', () => {
    // Enthaelt sowohl `auth` als auch `nip-05`. Stuende der auth-Zweig vorn, bekaeme der
    // Nutzer „bitte erneut senden" fuer ein Problem, das kein erneutes Senden loest.
    const meldung = mapRelayError('auth-required: NIP-05 verification needed')

    assert.ok(meldung.includes('NIP-05-Adresse'), meldung)
})

test('leerer Grund → der einzige Satz, der dann noch stimmt', () => {
    assert.equal(mapRelayError('   '), 'Konnte nicht gesendet werden.')
})
