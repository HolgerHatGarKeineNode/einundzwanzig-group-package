/**
 * Pure-Tests fuer die Relay-Modus-Weiche (welshman-frei, wie `relayCaps.ts` selbst).
 *   node --test packages/einundzwanzig-group/js/relayCaps.test.ts
 *
 * Die Weiche entscheidet, ob die Space-Verwaltung ueber NIP-86 (zooid) oder ueber
 * Buzz' native Relay-Admin-Kinds laeuft. Ein Fehlgriff hier ist teuer: auf einem
 * Buzz-Relay scheitert jeder `manageRelay`-Aufruf still (`POST /` → 405), auf einem
 * zooid-Relay wuerden 9030/9031 als unbekannte Kinds im Nichts landen.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isBuzzRelay, hasNip70, hasRelayExtension, relayVersion, spaceSupportsRooms } from './relayCaps.ts'

test('Buzz wird am software-Feld des NIP-11-Docs erkannt', () => {
    assert.equal(isBuzzRelay({ software: 'https://github.com/block/buzz' }), true)
    // Gross-/Kleinschreibung darf nicht entscheiden.
    assert.equal(isBuzzRelay({ software: 'HTTPS://GITHUB.COM/Block/Buzz' }), true)
})

test('zooid bleibt auf der NIP-86-Strecke', () => {
    assert.equal(isBuzzRelay({ software: 'https://github.com/coracle-social/zooid' }), false)
})

test('Unbekannte oder fehlende Relay-Profile gelten NICHT als Buzz', () => {
    // Default = bestehendes Verhalten (zooid/NIP-86). Ein noch nicht geladenes
    // NIP-11-Doc darf die Verwaltung nicht auf die Buzz-Strecke umschalten.
    assert.equal(isBuzzRelay(undefined), false)
    assert.equal(isBuzzRelay({}), false)
    assert.equal(isBuzzRelay({ software: 'https://github.com/fiatjaf/khatru' }), false)
})

test('Ein Wort „buzz" irgendwo im String reicht nicht', () => {
    // Absichtlich eng auf `block/buzz` gebunden — ein Relay namens „buzzrelay"
    // (es gibt eins) darf die Admin-Strecke nicht kapern.
    assert.equal(isBuzzRelay({ software: 'https://github.com/astro/buzzrelay' }), false)
})

test('Die uebrigen Faehigkeits-Pruefungen bleiben unberuehrt', () => {
    // Regressionsanker: isBuzzRelay wurde neben hasNip70/spaceSupportsRooms
    // eingefuegt — die beiden duerfen sich dadurch nicht veraendert haben.
    assert.equal(hasNip70({ supported_nips: ['70'] }), true)
    assert.equal(hasNip70({ supported_nips: ['29'] }), false)
    assert.equal(spaceSupportsRooms(false, { supported_nips: ['29'] }), true)
    assert.equal(spaceSupportsRooms(false, { supported_nips: ['1'] }), false)
    assert.equal(spaceSupportsRooms(true, undefined), true)
})

// ── NIP-11 `version` and `supported_extensions` (P1) ────────────────────────

test('the relay version is read from the NIP-11 doc as the relay states it', () => {
    // Measured against production on 2026-09-03, so the fixture is the real answer and
    // not an invented one.
    assert.equal(relayVersion({ version: '0.2.1' }), '0.2.1')
    assert.equal(relayVersion({ version: '  0.2.1  ' }), '0.2.1')
})

test('a missing version is an empty string, never a guess', () => {
    // Absent doc and absent field must be indistinguishable from each other and must
    // never read as "some version" — this helper exists to catch the case where a
    // deployed binary is older than its source, and inventing a value would hide it.
    assert.equal(relayVersion(undefined), '')
    assert.equal(relayVersion({}), '')
    assert.equal(relayVersion({ version: '   ' }), '')
})

test('an advertised draft extension is recognised, case and spacing aside', () => {
    // The identifiers are free-form draft names with no registry and no spelling rule.
    const profile = { supported_extensions: ['nip-er', 'nip-pl'] }
    assert.equal(hasRelayExtension('nip-er', profile), true)
    assert.equal(hasRelayExtension('nip-pl', profile), true)
    assert.equal(hasRelayExtension('NIP-ER', profile), true)
    assert.equal(hasRelayExtension(' nip-er ', profile), true)
    assert.equal(hasRelayExtension('nip-er', { supported_extensions: [' NIP-ER'] }), true)
})

test('a missing extension is false — no assumed capability', () => {
    assert.equal(hasRelayExtension('nip-er', undefined), false)
    assert.equal(hasRelayExtension('nip-er', {}), false)
    assert.equal(hasRelayExtension('nip-er', { supported_extensions: [] }), false)
    assert.equal(hasRelayExtension('nip-er', { supported_extensions: ['nip-pl'] }), false)
    assert.equal(hasRelayExtension('', { supported_extensions: ['nip-er'] }), false)
})

test('a substring is not an extension, and neither is a non-array', () => {
    // welshman copies non-standard NIP-11 fields through untouched (@welshman/domain
    // `Relay.js:19-25`) and coerces only `supported_nips` — so this is raw foreign JSON.
    // Without the guards, `String.prototype.includes` would answer yes to both of these.
    const asString = { supported_extensions: 'nip-error' } as unknown as { supported_extensions?: string[] }
    assert.equal(hasRelayExtension('nip-er', asString), false)
    assert.equal(hasRelayExtension('nip-er', { supported_extensions: ['nip-error'] }), false)
    const asObject = { supported_extensions: { 0: 'nip-er' } } as unknown as { supported_extensions?: string[] }
    assert.equal(hasRelayExtension('nip-er', asObject), false)
    const withNulls = { supported_extensions: [null, 42, 'nip-er'] } as unknown as { supported_extensions?: string[] }
    assert.equal(hasRelayExtension('nip-er', withNulls), true)
})
