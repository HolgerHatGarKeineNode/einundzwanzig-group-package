/**
 * Die Sperre für geparkte Ex-Relay-Domains — und der Nachweis, dass sie im echten
 * Auswahl-Pfad wirkt, nicht nur in der eigenen Funktion.
 *
 * Ausführen:
 *   node --experimental-strip-types --test packages/einundzwanzig-group/js/deadRelays.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { RelayScenario, addNoFallbacks, makeSelection, normalizeRelayUrl } from '@welshman/util'
import { DEAD_RELAYS, guardRelayQuality } from './deadRelays.ts'

const TOT = normalizeRelayUrl('nostr.milou.lol')
const LEBT = normalizeRelayUrl('nos.lol')

test('eine gelistete URL bekommt Güte 0', () => {
    const guard = guardRelayQuality(() => 0.7)
    assert.equal(guard(TOT), 0)
    // Die Liste hält die NORMALISIERTE Form — genau die reicht die Auswahl durch.
    assert.ok(DEAD_RELAYS.has(TOT))
})

test('eine ungelistete URL behält ihre ursprüngliche Güte', () => {
    const guard = guardRelayQuality((url) => (url === LEBT ? 0.42 : 0.1))
    assert.equal(guard(LEBT), 0.42)
    // Auch eine 0 aus der Basis bleibt eine 0 — die Blocked-Relay-Liste des Nutzers
    // (kind 10006) wirkt weiter, die Sperre schaltet sie nicht ab.
    assert.equal(guardRelayQuality(() => 0)(LEBT), 0)
})

test('Güte 0 fliegt aus getUrls() — der Hebel selbst, an der echten Auswahl', () => {
    // Seit 0.9.5 gibt es `@welshman/router` nicht mehr; die Auswahl-Maschinerie ist
    // `RelayScenario` aus `@welshman/util`, und die Güte-Funktion kommt nicht mehr aus
    // einem globalen `routerContext`, sondern als Option herein. Was der Fall prüft, ist
    // unverändert: `getUrls()` filtert über `scoreRelay`, und `-(0 * … )` ist `-0` und
    // damit falsy — die URL fällt heraus, es entsteht kein Socket und kein NIP-11-Abruf.
    const basis = () => 0.5
    const szenario = (getRelayQuality: (url: string) => number) =>
        new RelayScenario([makeSelection([TOT, LEBT])], { getRelayQuality, getDefaultRelays: () => [] })
            .policy(addNoFallbacks)
            .limit(10)
            .getUrls()

    const ohne = szenario(basis)
    assert.deepEqual(ohne.toSorted(), [LEBT, TOT].toSorted(), 'ohne Sperre routet welshman zur toten Domain')

    const mit = szenario(guardRelayQuality(basis))
    assert.deepEqual(mit, [LEBT], 'mit Sperre bleibt nur die lebende URL — kein Socket, kein NIP-11-Abruf')
})
