/**
 * **A pinned message the relay does not deliver reaches a final state.**
 *   node --experimental-strip-types --test packages/einundzwanzig-group/js/pinFetchLedger.test.ts
 *
 * Device sighting v1.13.0: in the room „TWENTY ONE Companion App" both pinned rows stayed on
 * „Nachricht wird geladen…" for good. The bar asked the relay once for each pinned message
 * older than the loaded window; when that request settled without the event nothing ever
 * said so, and the one-REQ-per-id guard made sure nothing asked again either.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createPinFetchLedger } from './pins.ts'

test('a request that settles without the event turns „loading" into „unavailable"', () => {
    const ledger = createPinFetchLedger()
    const loaded = new Set<string>()
    const isLoaded = (id: string): boolean => loaded.has(id)

    assert.deepEqual(ledger.toRequest(['a', 'b'], isLoaded), ['a', 'b'])
    assert.equal(ledger.state('a', isLoaded), 'loading', 'while the request runs, the row may say it is on its way')

    loaded.add('b')
    ledger.settle(['a', 'b'])

    assert.equal(ledger.state('a', isLoaded), 'unavailable', 'settled and still absent — the stuck state of the sighting')
    assert.equal(ledger.state('b', isLoaded), 'loaded')
})

test('every id is requested once — the recompute after settling does not loop', () => {
    const ledger = createPinFetchLedger()
    const isLoaded = (): boolean => false

    ledger.toRequest(['a'], isLoaded)
    ledger.settle(['a'])

    assert.deepEqual(ledger.toRequest(['a'], isLoaded), [])
})

test('an event that arrives later through the room history still wins over „unavailable"', () => {
    const ledger = createPinFetchLedger()
    const loaded = new Set<string>()
    const isLoaded = (id: string): boolean => loaded.has(id)

    ledger.toRequest(['a'], isLoaded)
    ledger.settle(['a'])
    loaded.add('a')

    assert.equal(ledger.state('a', isLoaded), 'loaded')
})

test('clear() forgets both halves — a room switch asks again', () => {
    const ledger = createPinFetchLedger()
    const isLoaded = (): boolean => false

    ledger.toRequest(['a'], isLoaded)
    ledger.settle(['a'])
    ledger.clear()

    assert.equal(ledger.state('a', isLoaded), 'loading')
    assert.deepEqual(ledger.toRequest(['a'], isLoaded), ['a'])
})
