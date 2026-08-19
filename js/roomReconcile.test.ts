/**
 * Pure-Tests des Raum-Abgleichs (welshman-frei).
 *   node --test packages/einundzwanzig-group/js/roomReconcile.test.ts
 *
 * Drei Zusagen, die einander bedingen:
 *
 *  (a) Ein Raum, den der Relay in einer vollständigen Antwort nicht mehr liefert UND
 *      der die Einzelprobe nicht übersteht, verschwindet — sonst überlebt ein auf
 *      Buzz gelöschter Kanal jeden Reload, weil Buzz beim Löschen keinen lesbaren
 *      Grabstein zurücklässt (Fundstellen und Messung im Kopf von `roomReconcile.ts`).
 *  (b) Ein Raum bleibt, wenn eine der beiden Antworten unvollständig war. Jede Zeile
 *      unter „(b)" ist eine gemessene Lage, in der ein Relay schweigt, ohne dass
 *      etwas gelöscht wurde.
 *  (c) Ein Lauf, der die LOKALE Seite des Vergleichs nicht kannte (Cache nach einem
 *      Reload noch nicht hydriert), darf sich nicht als Erfolg merken. Das ist der
 *      Defekt, an dem der Reload-Pfad hing — Messung an
 *      {@link shouldArmReconcileLock}.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
    MAX_RECONCILE_CANDIDATES,
    candidatesAreCredible,
    classifyRoomAnswer,
    confirmsRoomGone,
    selectReconcileCandidates,
    shouldArmReconcileLock,
    type KnownRoomEvent,
    type ReconcileRun,
    type RoomAnswerSignals,
} from './roomReconcile.ts'

const SPACE = 'wss://buzz.einundzwanzig.space/'
const ANDERER_SPACE = 'wss://relay.einundzwanzig.space/'

/** Der gelöschte Kanal aus dem Anlassfall. */
const GELOESCHT: KnownRoomEvent = { id: 'ev-github-eingang', h: 'github-eingang', relays: [SPACE] }
/** Ein Raum, den der Relay weiterhin liefert. */
const LEBEND: KnownRoomEvent = { id: 'ev-willkommen', h: 'willkommen', relays: [SPACE] }

/** Eine tragfähige Antwort: EOSE, kein CLOSED, kein Abriss, mindestens ein Raum. */
const antwort = (over: Partial<RoomAnswerSignals> = {}): RoomAnswerSignals => ({
    sawEose: true,
    sawClosed: false,
    sawDisconnect: false,
    roomCount: 3,
    ...over,
})

/** Die Einzelprobe eines gelöschten Raums: sauber beantwortet, null Treffer. */
const probeLeer = (over: Partial<RoomAnswerSignals> = {}): RoomAnswerSignals => antwort({ roomCount: 0, ...over })

const lauf = (over: Partial<ReconcileRun> = {}): ReconcileRun => ({
    verdict: 'complete',
    cacheHydrated: true,
    knownCount: 4,
    candidatesCredible: true,
    ...over,
})

// ── (a) Der Raum verschwindet ───────────────────────────────────────────────────

test('(a) Stufe 1 schlägt den fehlenden Raum als Kandidat vor', () => {
    const verdict = classifyRoomAnswer(antwort())
    assert.equal(verdict, 'complete')
    assert.deepEqual(
        selectReconcileCandidates(SPACE, [GELOESCHT, LEBEND], new Set(['willkommen']), verdict).map((r) => r.id),
        ['ev-github-eingang'],
    )
})

test('(a) Stufe 2 bestätigt ihn: sauber beantwortet, kein 39000 unter dieser Adresse', () => {
    // Gemessen am buzz-test-Stack (2026-08-19, :3004): `{kinds:[39000],"#d":[h]}`
    // liefert für den gelöschten Kanal 0 Zeilen mit EOSE und ohne CLOSED, während
    // dieselbe Aufrufform ohne `#d` im selben Moment weiter Zeilen liefert.
    assert.equal(confirmsRoomGone(probeLeer()), true)
})

test('(a) Was der Relay weiterhin liefert, wird gar nicht erst Kandidat', () => {
    assert.deepEqual(
        selectReconcileCandidates(SPACE, [GELOESCHT, LEBEND], new Set(['willkommen', 'github-eingang']), 'complete'),
        [],
    )
})

// ── (b) Stufe 1: unvollständige Antworten schlagen NICHTS vor ───────────────────

test('(b) Kein EOSE: die Antwort kam nie — hängende NIP-42-AUTH verschluckt es', () => {
    // welshmans Auth-Puffer entfernt bei hängender AUTH-Runde EOSE UND CLOSED
    // (`welshmanAuthSwallow.test.ts`). Übrig bleibt eine leere Antwort, die wie
    // „dieser Space hat keine Räume" aussieht.
    const verdict = classifyRoomAnswer(antwort({ sawEose: false, roomCount: 0 }))
    assert.equal(verdict, 'no-eose')
    assert.deepEqual(selectReconcileCandidates(SPACE, [GELOESCHT, LEBEND], new Set(), verdict), [])
})

test('(b) CLOSED: der Relay hat abgelehnt, nicht geantwortet', () => {
    const verdict = classifyRoomAnswer(antwort({ sawClosed: true, roomCount: 0 }))
    assert.equal(verdict, 'closed')
    assert.deepEqual(selectReconcileCandidates(SPACE, [GELOESCHT, LEBEND], new Set(), verdict), [])
})

test('(b) CLOSED NACH dem EOSE zählt immer noch als unvollständig', () => {
    // Buzz räumt laufende Subs eines Raums bei Mitgliedschaftsänderungen ab
    // (`restricted: channel access revoked`) — das kann nach dem EOSE kommen.
    const verdict = classifyRoomAnswer(antwort({ sawClosed: true }))
    assert.equal(verdict, 'closed')
    assert.deepEqual(selectReconcileCandidates(SPACE, [GELOESCHT, LEBEND], new Set(['willkommen']), verdict), [])
})

test('(b) Abriss: ein toter Socket wirft nicht, er schweigt', () => {
    const verdict = classifyRoomAnswer(antwort({ sawDisconnect: true }))
    assert.equal(verdict, 'disconnected')
    assert.deepEqual(selectReconcileCandidates(SPACE, [GELOESCHT, LEBEND], new Set(), verdict), [])
})

test('(b) Leere, aber saubere Antwort: null sichtbare Räume sind KEINE Positivkontrolle', () => {
    // Der teuerste Fall: EOSE, kein CLOSED — und trotzdem darf nicht gelöscht werden.
    // Genauso sieht es aus, wenn die Relay-Mitgliedschaft entzogen wurde.
    const verdict = classifyRoomAnswer(antwort({ roomCount: 0 }))
    assert.equal(verdict, 'nothing-visible')
    assert.deepEqual(selectReconcileCandidates(SPACE, [GELOESCHT, LEBEND], new Set(), verdict), [])
})

// ── (b) Stufe 2: die Einzelprobe rettet, was die breite Abfrage verlor ──────────

test('(b) Einzelprobe ohne EOSE bestätigt nichts — der Kandidat bleibt', () => {
    assert.equal(confirmsRoomGone(probeLeer({ sawEose: false })), false)
})

test('(b) Einzelprobe mit CLOSED bestätigt nichts', () => {
    assert.equal(confirmsRoomGone(probeLeer({ sawClosed: true })), false)
})

test('(b) Einzelprobe mit Abriss bestätigt nichts', () => {
    assert.equal(confirmsRoomGone(probeLeer({ sawDisconnect: true })), false)
})

test('(b) DIE RETTUNG bei gekappter Seite: die Einzelprobe findet den Raum doch', () => {
    // Der Fall, für den Stufe 2 überhaupt existiert. Buzz darf nach dem SQL-Zugriff
    // nachfiltern und dabei beliebig viele Kandidaten verwerfen (`req.rs:434-439`) —
    // eine kurze Antwort beweist also NICHT, dass die Seite vollständig war. Ein so
    // verlorener Raum wird hier Kandidat und muss die Einzelprobe überleben.
    assert.equal(confirmsRoomGone(antwort({ roomCount: 1 })), false)
})

// ── Der Deckel auf die behauptete Änderung ──────────────────────────────────────

test('Bis zum Deckel wird geglaubt, darüber nicht', () => {
    const viele = (n: number): KnownRoomEvent[] =>
        Array.from({ length: n }, (_, i) => ({ id: `ev-${i}`, h: `h-${i}`, relays: [SPACE] }))
    assert.equal(candidatesAreCredible(viele(MAX_RECONCILE_CANDIDATES)), true)
    assert.equal(candidatesAreCredible(viele(MAX_RECONCILE_CANDIDATES + 1)), false)
})

test('Eine unglaubwürdige Kandidatenzahl sperrt auch nicht', () => {
    // Sonst konservierte ausgerechnet der degradierteste Lauf seinen Zustand für 60 s.
    assert.equal(shouldArmReconcileLock(lauf({ candidatesCredible: false })), false)
})

// ── Der Herkunfts-Riegel ────────────────────────────────────────────────────────

test('Ein Raum, den auch ein ANDERER Space kennt, wird nie Kandidat', () => {
    // `repository.removeEvent` wirkt global über alle Spaces. Ein Ereignis mit
    // zweiter Herkunft verschwände auch dort — deshalb bleibt es liegen.
    const geteilt: KnownRoomEvent = { ...GELOESCHT, relays: [SPACE, ANDERER_SPACE] }
    assert.deepEqual(selectReconcileCandidates(SPACE, [geteilt], new Set(['willkommen']), 'complete'), [])
})

test('Ein Raum ohne bekannte Herkunft wird nie Kandidat', () => {
    const herkunftslos: KnownRoomEvent = { ...GELOESCHT, relays: [] }
    assert.deepEqual(selectReconcileCandidates(SPACE, [herkunftslos], new Set(), 'complete'), [])
})

test('Der Abgleich EINES Space fasst die Räume eines anderen nicht an', () => {
    const fremd: KnownRoomEvent = { id: 'ev-verein', h: 'verein', relays: [ANDERER_SPACE] }
    assert.deepEqual(
        selectReconcileCandidates(SPACE, [fremd, GELOESCHT], new Set(['willkommen']), 'complete').map((r) => r.id),
        ['ev-github-eingang'],
    )
})

test('Ein 39000 ohne `d`-Tag hat kein `h` und ist damit nicht abgleichbar', () => {
    const ohneD: KnownRoomEvent = { id: 'ev-kaputt', h: '', relays: [SPACE] }
    assert.deepEqual(selectReconcileCandidates(SPACE, [ohneD], new Set(['willkommen']), 'complete'), [])
})

// ── (c) Reload-Pfad: die Sperre darf einen leeren Vergleich nicht konservieren ──

test('(c) DER RELOAD-FALL: `complete` mit leerem Bestand sperrt NICHT', () => {
    // Gemessen (buzz-test, 2026-08-19): nach einem Reload zieht der Lauf seinen
    // Schnappschuss, bevor `storageReady` den Cache ins repository gespiegelt hat.
    // Der Geisterraum steht nur im Cache → knownCount 0 → nichts zu löschen. Das
    // Verdikt ist trotzdem `complete` (EOSE kam), und genau deshalb darf das Verdikt
    // allein die Sperre nicht setzen: sonst schützte der leerhändige Lauf den
    // Geisterraum zusätzlich 60 s lang.
    assert.equal(shouldArmReconcileLock(lauf({ knownCount: 0 })), false)
})

test('(c) Ohne hydrierten Cache sperrt kein Lauf — auch nicht mit Bestand', () => {
    // Der Bestand könnte dann aus der Live-Sub stammen und den Cache-Anteil (genau den
    // Geisterraum) nicht enthalten. `knownCount > 0` allein trüge diese Zusage nicht.
    assert.equal(shouldArmReconcileLock(lauf({ cacheHydrated: false })), false)
})

test('(c) Ein Lauf mit beidem — brauchbarer Antwort und beurteiltem Bestand — sperrt', () => {
    assert.equal(shouldArmReconcileLock(lauf()), true)
})

test('(c) Kein Verdikt außer `complete` sperrt', () => {
    for (const verdict of ['closed', 'disconnected', 'no-eose', 'nothing-visible'] as const) {
        assert.equal(shouldArmReconcileLock(lauf({ verdict })), false, `${verdict} darf nicht sperren`)
    }
})

// ── DIE ZUSAGEN ─────────────────────────────────────────────────────────────────

test('DIE ZUSAGE 1: NUR `complete` schlägt Kandidaten vor', () => {
    const alle = ['complete', 'closed', 'disconnected', 'no-eose', 'nothing-visible'] as const
    const vorschlagend = alle.filter(
        (verdict) => selectReconcileCandidates(SPACE, [GELOESCHT], new Set(), verdict).length > 0,
    )
    assert.deepEqual(vorschlagend, ['complete'])
})

test('DIE ZUSAGE 2: die Einzelprobe bestätigt NUR die sauber beantwortete Leere', () => {
    // Vier Nicht-Antworten und ein Treffer — keiner davon darf löschen.
    assert.equal(confirmsRoomGone(probeLeer()), true)
    for (const kaputt of [
        probeLeer({ sawEose: false }),
        probeLeer({ sawClosed: true }),
        probeLeer({ sawDisconnect: true }),
        antwort({ roomCount: 1 }),
    ]) {
        assert.equal(confirmsRoomGone(kaputt), false)
    }
})
