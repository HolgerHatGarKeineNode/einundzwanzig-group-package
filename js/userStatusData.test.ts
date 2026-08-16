/**
 * Die Status-Faltung ohne Relay, ohne Store, ohne echte Uhr. Geprüft wird das, was in
 * der Fläche STILL bricht — jeder dieser Fälle sieht in der Oberfläche wie ein
 * gültiger Status aus, wenn er falsch behandelt wird:
 *
 *   1. **Verfall über `expiration` (NIP-40).** Buzz Desktop wertet das Tag nicht aus
 *      (`desktop/src/features/user-status/hooks.ts:24-38`) und zeigt „bin bis 14 Uhr
 *      weg" auch um 22 Uhr. Ein Test, der nur „Tag wird gelesen" prüft, fängt das
 *      nicht: es muss ein Status VERSCHWINDEN.
 *   2. **Höchstalter.** Ohne `expiration` gibt es kein Signal, dass ein Status alt
 *      ist — kind 30315 ist ersetzbar, es liegt genau ein Event da. Fällt die Grenze
 *      weg, merkt das niemand, bis ein Status aus dem Vorjahr im Chat steht.
 *   3. **Leer = gelöscht.** NIP-38 sagt es ausdrücklich. Der teure Fall ist der
 *      leere Status, der einen ÄLTEREN gefüllten überschreibt: wer „den jüngsten
 *      nicht-leeren" nimmt, macht das Löschen wirkungslos.
 *   4. **NIP-33-Replace statt Ankunftsreihenfolge.** Beim Reconnect-Replay kommt das
 *      ältere Event nach dem neueren an. Ein Fold über „letzter gewinnt" lässt den
 *      Status dann sichtbar zurückspringen.
 *
 * Dazu die Falle, die keine Spec verrät: `emoji` ist in NIP-30 bereits vergeben
 * (`["emoji", shortcode, url]`) und bedeutet dort ein BILD. Ein Client, der blind
 * `tag[1]` nimmt, malt den nackten Shortcode an die Stelle des Emojis.
 *
 * Ausführen:
 *   node --experimental-strip-types --test packages/einundzwanzig-group/js/userStatusData.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
    MAX_STATUS_AGE_SEC,
    STATUS_TEXT_CAP,
    USER_STATUS,
    foldUserStatuses,
    parseStatusEvent,
    statusEmoji,
    statusExpiresAt,
    statusFingerprint,
    type StatusEventLike,
} from './userStatusData.ts'

const ALICE = 'a'.repeat(64)
const BOB = 'b'.repeat(64)
/** Feste „Jetzt"-Marke — der Test verbraucht keine echten Sekunden. */
const NOW = 1_800_000_000

/** Ein 30315 mit `d=general`; alles Weitere überschreibt der Aufrufer. */
const statusEvent = (over: Partial<StatusEventLike> = {}): StatusEventLike => ({
    id: '0'.repeat(64),
    kind: USER_STATUS,
    pubkey: ALICE,
    created_at: NOW - 60,
    content: 'schreibt Tests',
    tags: [['d', 'general']],
    ...over,
})

// ── 1. Verfall über `expiration` (NIP-40) ────────────────────────────────────

test('ein abgelaufenes expiration entfernt den Status — Buzz Desktop zeigte ihn weiter', () => {
    const events = [statusEvent({ tags: [['d', 'general'], ['expiration', String(NOW - 1)]] })]

    assert.equal(foldUserStatuses(events, NOW).size, 0)
})

test('expiration exakt jetzt ist abgelaufen, eine Sekunde später nicht', () => {
    const atNow = [statusEvent({ tags: [['d', 'general'], ['expiration', String(NOW)]] })]
    const inFuture = [statusEvent({ tags: [['d', 'general'], ['expiration', String(NOW + 1)]] })]

    assert.equal(foldUserStatuses(atNow, NOW).size, 0)
    assert.equal(foldUserStatuses(inFuture, NOW).get(ALICE)?.text, 'schreibt Tests')
})

test('ein kaputtes expiration lässt den Status weder sofort verfallen noch unsterblich werden', () => {
    assert.equal(statusExpiresAt([['expiration', 'bald']]), null)
    assert.equal(statusExpiresAt([['expiration', '']]), null)
    assert.equal(statusExpiresAt([]), null)
    // Unlesbar ⇒ behandelt wie „kein Tag": das Höchstalter bleibt die einzige Grenze.
    const events = [statusEvent({ tags: [['d', 'general'], ['expiration', 'bald']] })]
    assert.equal(foldUserStatuses(events, NOW).get(ALICE)?.text, 'schreibt Tests')
})

// ── 2. Höchstalter ───────────────────────────────────────────────────────────

test('ein Status ohne expiration verfällt am Höchstalter — sonst stünde er ewig', () => {
    const zuAlt = [statusEvent({ created_at: NOW - MAX_STATUS_AGE_SEC - 1 })]
    const geradeNoch = [statusEvent({ created_at: NOW - MAX_STATUS_AGE_SEC })]

    assert.equal(foldUserStatuses(zuAlt, NOW).size, 0)
    assert.equal(foldUserStatuses(geradeNoch, NOW).get(ALICE)?.text, 'schreibt Tests')
})

test('das Höchstalter ist ein Parameter — ein Aufrufer darf es enger ziehen', () => {
    const events = [statusEvent({ created_at: NOW - 3600 })]

    assert.equal(foldUserStatuses(events, NOW, 1800).size, 0)
    assert.equal(foldUserStatuses(events, NOW, 7200).size, 1)
})

// ── 3. Leer = gelöscht ───────────────────────────────────────────────────────

test('leerer content ohne Emoji heißt gelöscht, nicht unverändert', () => {
    const events = [statusEvent({ content: '   ' })]

    assert.equal(foldUserStatuses(events, NOW).size, 0)
})

test('leerer content MIT Emoji bleibt ein Status — das Emoji ist die Aussage', () => {
    const events = [statusEvent({ content: '', tags: [['d', 'general'], ['emoji', '🎧']] })]
    const status = foldUserStatuses(events, NOW).get(ALICE)

    assert.equal(status?.text, '')
    assert.equal(status?.emoji, '🎧')
})

test('ein leeres Event löscht den älteren gefüllten Status — nicht umgekehrt', () => {
    // Genau der Fall, den „nimm den jüngsten NICHT-LEEREN" still falsch macht.
    const events = [
        statusEvent({ id: '1'.repeat(64), created_at: NOW - 600, content: 'im Meeting' }),
        statusEvent({ id: '2'.repeat(64), created_at: NOW - 60, content: '' }),
    ]

    assert.equal(foldUserStatuses(events, NOW).size, 0)
})

// ── 4. NIP-33-Replace statt Ankunftsreihenfolge ──────────────────────────────

test('bei verdrehter Ankunft gewinnt das größere created_at, nicht das zuletzt eingetroffene', () => {
    // Reconnect-Replay: der Relay spielt seinen Bestand erneut ein, das ÄLTERE Event
    // trifft NACH dem neueren ein. „Letzter gewinnt" ließe den Status zurückspringen.
    const neu = statusEvent({ id: '2'.repeat(64), created_at: NOW - 60, content: 'jetzt gültig' })
    const alt = statusEvent({ id: '1'.repeat(64), created_at: NOW - 6000, content: 'längst vorbei' })

    assert.equal(foldUserStatuses([neu, alt], NOW).get(ALICE)?.text, 'jetzt gültig')
    assert.equal(foldUserStatuses([alt, neu], NOW).get(ALICE)?.text, 'jetzt gültig')
})

test('bei gleichem created_at gewinnt die kleinere Id (NIP-01)', () => {
    const a = statusEvent({ id: `a${'0'.repeat(63)}`, content: 'A' })
    const b = statusEvent({ id: `f${'0'.repeat(63)}`, content: 'F' })

    assert.equal(foldUserStatuses([a, b], NOW).get(ALICE)?.text, 'A')
    assert.equal(foldUserStatuses([b, a], NOW).get(ALICE)?.text, 'A')
})

test('mehrere Pubkeys stehen nebeneinander und beeinflussen sich nicht', () => {
    const events = [
        statusEvent({ pubkey: ALICE, content: 'A' }),
        statusEvent({ pubkey: BOB, content: 'B', created_at: NOW - 5 }),
        statusEvent({ pubkey: BOB, content: '', created_at: NOW - 1 }),
    ]
    const table = foldUserStatuses(events, NOW)

    assert.equal(table.get(ALICE)?.text, 'A')
    assert.equal(table.has(BOB), false)
})

// ── Das emoji-Tag: Buzz-Form ja, NIP-30-Form nein ────────────────────────────

test('das Emoji kommt nur aus der zweigliedrigen Buzz-Form', () => {
    assert.equal(statusEmoji([['emoji', '🚀']]), '🚀')
    // NIP-30: ["emoji", shortcode, url] — tag[1] ist ein SHORTCODE, kein Zeichen.
    assert.equal(statusEmoji([['emoji', 'kekw', 'https://example.test/kekw.png']]), '')
    assert.equal(statusEmoji([['emoji']]), '')
    assert.equal(statusEmoji([]), '')
    // Textfeld zweckentfremdet ⇒ kein Badge.
    assert.equal(statusEmoji([['emoji', 'x'.repeat(40)]]), '')
})

// ── Zuschnitt und Fremdes ────────────────────────────────────────────────────

test('der Text wird einzeilig gemacht und gedeckelt — 64 KB erlaubt der Relay', () => {
    const parsed = parseStatusEvent(statusEvent({ content: `  baut\n\tden   Feed  ${'x'.repeat(500)}` }))

    assert.equal(parsed?.text.startsWith('baut den Feed x'), true)
    assert.equal(parsed?.text.length, STATUS_TEXT_CAP)
})

test('fremdes Kind oder fremdes d-Tag zählt nicht als Status', () => {
    assert.equal(parseStatusEvent(statusEvent({ kind: 1 })), null)
    assert.equal(parseStatusEvent(statusEvent({ tags: [['d', 'music']] })), null)
    assert.equal(parseStatusEvent(statusEvent({ tags: [] })), null)
    assert.equal(foldUserStatuses([statusEvent({ tags: [['d', 'music']] })], NOW).size, 0)
})

// ── Fingerabdruck: der Cache-Schlüssel der Chat-Zeile ────────────────────────

test('der Fingerabdruck ändert sich bei jeder sichtbaren Änderung', () => {
    const basis = { text: 'im Meeting', emoji: '', updatedAt: NOW }

    assert.equal(statusFingerprint(basis), statusFingerprint({ ...basis }))
    assert.notEqual(statusFingerprint(basis), statusFingerprint({ ...basis, text: 'am Strand' }))
    assert.notEqual(statusFingerprint(basis), statusFingerprint({ ...basis, emoji: '🏖️' }))
    assert.notEqual(statusFingerprint(basis), statusFingerprint({ ...basis, updatedAt: NOW + 1 }))
    assert.notEqual(statusFingerprint(basis), statusFingerprint(undefined))
})

test('zwei Fassungen derselben Sekunde sind unterscheidbar — updatedAt allein reichte nicht', () => {
    // Buzz publiziert mit Sekundenauflösung; zwei Publishes in derselben Sekunde
    // tragen dasselbe created_at. Stünde nur das im Schlüssel, bliebe die Zeile stehen.
    assert.notEqual(
        statusFingerprint({ text: 'im Meeting', emoji: '', updatedAt: NOW }),
        statusFingerprint({ text: 'Feierabend', emoji: '', updatedAt: NOW }),
    )
})

test('die Tabelle liefert Werte, die direkt in den Fingerabdruck gehen', () => {
    // Der Vertrag zwischen Faltung und Memoisierung: gleiche Eingabe (in beliebiger
    // Reihenfolge) ⇒ gleicher Abdruck, geänderter Status ⇒ anderer Abdruck.
    const alt = statusEvent({ id: '1'.repeat(64), created_at: NOW - 600, content: 'im Meeting' })
    const neu = statusEvent({ id: '2'.repeat(64), created_at: NOW - 60, content: 'Feierabend' })

    const vorher = statusFingerprint(foldUserStatuses([alt], NOW).get(ALICE))
    const nachher = statusFingerprint(foldUserStatuses([alt, neu], NOW).get(ALICE))
    const verdreht = statusFingerprint(foldUserStatuses([neu, alt], NOW).get(ALICE))

    assert.notEqual(vorher, nachher)
    assert.equal(nachher, verdreht)
})
