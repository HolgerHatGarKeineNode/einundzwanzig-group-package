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
import { isBuzzRelay, hasNip70, spaceSupportsRooms } from './relayCaps.ts'

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
