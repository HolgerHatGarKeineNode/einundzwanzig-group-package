/**
 * Pure-Tests fuer die Zuordnung CLOSED-Grund → Raumzustand (welshman-frei).
 *   node --test packages/einundzwanzig-group/js/roomGate.test.ts
 *
 * Jede Zeile hier ist eine am laufenden Buzz-Teststack gemessene Lage
 * (2026-08-17, `buzz-test:3001`, frisch per `down -v` aufgesetzt) — plus der
 * unbekannte Grund, der die eigentliche Zusage traegt: er faellt auf
 * `blocked`, nie auf den freundlichen Weg.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifyRoomClosedReason } from './roomGate.ts'

test('Raum verlassen (kind 9022): Buzz raeumt die Sub ab — das ist kein Zugriffsurteil', () => {
    // Gemessen: nach dem 9022 kommt auf der offenen Live-Sub genau dieser Grund.
    assert.equal(classifyRoomClosedReason('restricted: channel access revoked'), 'membershipChanged')
})

test('Nie Mitglied eines privaten Raums: kein Zugriff', () => {
    assert.equal(classifyRoomClosedReason('restricted: not a channel member'), 'blocked')
})

test('Geloeschter (9008) oder nie existierender Raum: derselbe Riegel, kein Zugriff', () => {
    // Gemessen: `deleted_at IS NULL` faellt den Raum aus der Zugriffsliste, der
    // Relay antwortet wortgleich wie beim privaten Fremdraum.
    assert.equal(classifyRoomClosedReason('restricted: not a channel member'), 'blocked')
})

test('zooid: der Relay-Riegel aus P11 bleibt „kein Zugriff"', () => {
    assert.equal(classifyRoomClosedReason('restricted: you are not a member of this relay'), 'blocked')
})

test('Kein Relay-Mitglied bei Buzz: die Ablehnung traegt gar kein `restricted:`', () => {
    // Gemessen: AUTH scheitert mit `OK false restricted: not a relay member`,
    // der REQ danach wird mit `auth-required: not authenticated` geschlossen.
    // Der Grund sagt nichts ueber die Berechtigung dieses RAUMS — und welshmans
    // Auth-Buffer entfernt ihn ohnehin, bevor `onClosed` ihn sieht.
    assert.equal(classifyRoomClosedReason('auth-required: not authenticated'), 'unrelated')
})

test('Gruende ohne `restricted:` aendern die Flaeche nicht', () => {
    assert.equal(classifyRoomClosedReason('error: too many subscriptions'), 'unrelated')
    assert.equal(classifyRoomClosedReason('error: database error'), 'unrelated')
    assert.equal(classifyRoomClosedReason('rate-limited: slow down'), 'unrelated')
    assert.equal(classifyRoomClosedReason(''), 'unrelated')
})

test('DIE ZUSAGE: ein UNBEKANNTER restricted-Grund faellt auf „kein Zugriff"', () => {
    // Der Text kann sich mit jeder Relay-Version aendern. Wer hier faelschlich
    // „wieder beitreten" angeboten bekaeme, klickte ins Leere — deshalb ist die
    // Zuordnung eine Allowlist mit genau einem freundlichen Eintrag.
    assert.equal(classifyRoomClosedReason('restricted: ausgedachter neuer Grund'), 'blocked')
    assert.equal(classifyRoomClosedReason('restricted:'), 'blocked')
    assert.equal(classifyRoomClosedReason('restricted: you are timed out until 1789012345'), 'blocked')
    assert.equal(classifyRoomClosedReason('restricted: not a relay member'), 'blocked')
})

test('Der freundliche Weg braucht den Grund EXAKT — ein Zusatz macht daraus eine andere Lage', () => {
    // Praefix-Test statt Gleichheit waere die falsche Fehlerrichtung: ein
    // kuenftiges `… (banned)` waere ein Rauswurf, kein Austritt.
    assert.equal(classifyRoomClosedReason('restricted: channel access revoked (banned)'), 'blocked')
    assert.equal(classifyRoomClosedReason('restricted: channel access revoked permanently'), 'blocked')
})

test('Rand: Leerraum und Grossschreibung kippen die Zuordnung nicht', () => {
    assert.equal(classifyRoomClosedReason('  restricted: channel access revoked  '), 'membershipChanged')
    assert.equal(classifyRoomClosedReason('RESTRICTED: Channel Access Revoked'), 'membershipChanged')
    assert.equal(classifyRoomClosedReason('  RESTRICTED: not a channel member'), 'blocked')
})
