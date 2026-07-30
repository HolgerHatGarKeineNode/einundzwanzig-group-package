/**
 * Pure-Tests fuer die Herkunfts-Entscheidung (welshman-frei).
 *   node --test packages/einundzwanzig-group/js/spaceProfiles.test.ts
 *
 * Es ist die einzige Stelle, an der ueber das LOESCHEN eines Profils entschieden wird
 * — deshalb steht sie allein und ist einzeln geprueft.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isSpaceLocalOnly } from './spaceProfiles.ts'

const BUZZ = 'wss://buzz.einundzwanzig.space/'
const ZOOID = 'wss://group.einundzwanzig.space/'

test('nur vom Workspace-Relay gesehen → loeschen', () => {
    assert.equal(isSpaceLocalOnly([BUZZ], BUZZ), true)
    assert.equal(isSpaceLocalOnly(new Set([BUZZ]), BUZZ), true)
})

test('auch woanders gesehen → BEHALTEN (dasselbe Event liegt im nativen Nostr)', () => {
    assert.equal(isSpaceLocalOnly([BUZZ, ZOOID], BUZZ), false)
    assert.equal(isSpaceLocalOnly([ZOOID], BUZZ), false)
    assert.equal(isSpaceLocalOnly([BUZZ, 'wss://purplepag.es/'], BUZZ), false)
})

test('unbekannte Herkunft → BEHALTEN, nie auf Verdacht loeschen', () => {
    // Aus IndexedDB oder Backend-Cache geladen: der Tracker weiss nichts. Eine
    // Vermutung rechtfertigt kein Loeschen.
    assert.equal(isSpaceLocalOnly([], BUZZ), false)
    assert.equal(isSpaceLocalOnly(undefined, BUZZ), false)
    assert.equal(isSpaceLocalOnly(new Set(), BUZZ), false)
})

test('die URL muss exakt passen — kein Praefix-Vergleich', () => {
    // `normalizeRelayUrl` haengt einen Schraegstrich an; wer hier lockerer vergliche,
    // koennte ein Profil eines FREMDEN Relays mit aehnlichem Namen wegloeschen.
    assert.equal(isSpaceLocalOnly(['wss://buzz.einundzwanzig.space'], BUZZ), false)
    assert.equal(isSpaceLocalOnly(['wss://buzz.einundzwanzig.space.evil.tld/'], BUZZ), false)
})
