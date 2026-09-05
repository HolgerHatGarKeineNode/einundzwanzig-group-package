/**
 * **The rules of `js/wrapOrigin.ts`, one assertion per rule.**
 *   node --test --experimental-strip-types packages/einundzwanzig-group/js/wrapOrigin.test.ts
 *
 * Plan: `docs/plans/2026-09-05T0125-community-features-herbst.md`, phase P7, under the
 * standing extra DoD "reine Logik braucht reine Tests".
 *
 * Two of the rules below name a consequence in their own docblock, and those are the two
 * that would never be reached by an E2E run:
 *
 *  - `isSolicitedEvent` on an id we never opened — **a signer round trip per event**.
 *    Measured at 25 of 25 (`p7-messung-b-signer-kosten.txt`); on NIP-46 that is 25
 *    bunker calls, on NIP-55 25 prompts on the signing device.
 *  - `isSolicitedEvent` on an id that IS ours but with an event the subscription never
 *    asked for — the same attack with one extra step, and the one a check that only
 *    compares subscription ids would wave through.
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
    MAX_TRACKED_SUBSCRIPTIONS,
    forgetClosedSubscription,
    isSolicitedEvent,
    makeSubscriptionLedger,
    rememberOwnRequest,
} from './wrapOrigin.ts'

const WRAP_KIND = 1059
const ME = 'a'.repeat(64)
const SOMEONE = 'b'.repeat(64)

/** A gift wrap as it comes off the wire — only the fields a filter looks at. */
const wrap = (overrides: Record<string, unknown> = {}) => ({
    id: 'e'.repeat(64),
    kind: WRAP_KIND,
    pubkey: SOMEONE,
    created_at: 1_788_000_000,
    tags: [['p', ME]],
    content: 'ciphertext',
    sig: 'f'.repeat(128),
    ...overrides,
})

const wrapFilter = { kinds: [WRAP_KIND], '#p': [ME] }

describe('rememberOwnRequest', () => {
    test('a REQ we send makes its subscription id ours', () => {
        const ledger = makeSubscriptionLedger()
        rememberOwnRequest(ledger, ['REQ', 'sub-1', wrapFilter])

        assert.equal(isSolicitedEvent(ledger, ['EVENT', 'sub-1', wrap()]), true)
    })

    test('a REQ with several filters is solicited when ANY of them matches', () => {
        const ledger = makeSubscriptionLedger()
        rememberOwnRequest(ledger, ['REQ', 'sub-1', { kinds: [9] }, wrapFilter])

        assert.equal(isSolicitedEvent(ledger, ['EVENT', 'sub-1', wrap()]), true)
    })

    test('our own CLOSE forgets the subscription', () => {
        const ledger = makeSubscriptionLedger()
        rememberOwnRequest(ledger, ['REQ', 'sub-1', wrapFilter])
        rememberOwnRequest(ledger, ['CLOSE', 'sub-1'])

        assert.equal(isSolicitedEvent(ledger, ['EVENT', 'sub-1', wrap()]), false)
    })

    test('a REQ without a usable filter is not recorded', () => {
        // Recording it would take a slot and hand out an id that can never authorise
        // anything — a ledger entry that only weakens the cap.
        const ledger = makeSubscriptionLedger()
        rememberOwnRequest(ledger, ['REQ', 'sub-1'])

        assert.equal(ledger.size, 0)
    })

    test('frames that are not REQ or CLOSE leave the ledger alone', () => {
        const ledger = makeSubscriptionLedger()
        rememberOwnRequest(ledger, ['EVENT', wrap()])
        rememberOwnRequest(ledger, ['AUTH', 'challenge'])
        rememberOwnRequest(ledger, 'not-a-frame')
        rememberOwnRequest(ledger, ['REQ', 42, wrapFilter])

        assert.equal(ledger.size, 0)
    })

    test('the ledger is capped, and the oldest entry goes first', () => {
        const ledger = makeSubscriptionLedger()
        for (let i = 0; i <= MAX_TRACKED_SUBSCRIPTIONS; i++) {
            rememberOwnRequest(ledger, ['REQ', `sub-${i}`, wrapFilter])
        }

        assert.equal(ledger.size, MAX_TRACKED_SUBSCRIPTIONS)
        // Eviction is fail-closed: the evicted id no longer authorises anything.
        assert.equal(isSolicitedEvent(ledger, ['EVENT', 'sub-0', wrap()]), false)
        assert.equal(isSolicitedEvent(ledger, ['EVENT', `sub-${MAX_TRACKED_SUBSCRIPTIONS}`, wrap()]), true)
    })
})

describe('forgetClosedSubscription', () => {
    test("the relay's CLOSED forgets the subscription", () => {
        const ledger = makeSubscriptionLedger()
        rememberOwnRequest(ledger, ['REQ', 'sub-1', wrapFilter])
        forgetClosedSubscription(ledger, ['CLOSED', 'sub-1', 'auth-required: …'])

        assert.equal(isSolicitedEvent(ledger, ['EVENT', 'sub-1', wrap()]), false)
    })

    test('only a CLOSED forgets — an EOSE on the same id does not', () => {
        // Found by mutation probe M4: dropping the `frame[0] !== 'CLOSED'` check left
        // every case here green, and the resulting function deletes on ANY relay frame
        // carrying a subscription id. A relay could then quietly drop our wrap
        // subscription out of the ledger with an `EOSE` and every message after it would
        // be treated as unsolicited — messages lost, silently, and looking like the
        // origin check working correctly.
        const ledger = makeSubscriptionLedger()
        rememberOwnRequest(ledger, ['REQ', 'sub-1', wrapFilter])
        forgetClosedSubscription(ledger, ['EOSE', 'sub-1'])
        forgetClosedSubscription(ledger, ['EVENT', 'sub-1', wrap()])
        forgetClosedSubscription(ledger, ['NOTICE', 'sub-1'])

        assert.equal(isSolicitedEvent(ledger, ['EVENT', 'sub-1', wrap()]), true)
    })

    test('a relay frame can never CREATE an entry', () => {
        // The reason this function exists separately from `rememberOwnRequest`: a relay
        // that could write the ledger could authorise its own pushes.
        const ledger = makeSubscriptionLedger()
        forgetClosedSubscription(ledger, ['REQ', 'sub-1', wrapFilter])
        forgetClosedSubscription(ledger, ['EVENT', 'sub-1', wrap()])

        assert.equal(ledger.size, 0)
        assert.equal(isSolicitedEvent(ledger, ['EVENT', 'sub-1', wrap()]), false)
    })
})

describe('isSolicitedEvent', () => {
    test('an id we never opened is NOT solicited — the 25-signer-calls rule', () => {
        const ledger = makeSubscriptionLedger()
        rememberOwnRequest(ledger, ['REQ', 'sub-mine', wrapFilter])

        assert.equal(isSolicitedEvent(ledger, ['EVENT', 'sub-we-never-opened', wrap()]), false)
    })

    test('our own subscription does not authorise an event it never asked for', () => {
        // The one a check that compares subscription ids alone would let through.
        const ledger = makeSubscriptionLedger()
        rememberOwnRequest(ledger, ['REQ', 'sub-1', { kinds: [9], '#h': ['room'] }])

        assert.equal(isSolicitedEvent(ledger, ['EVENT', 'sub-1', wrap()]), false)
    })

    test('a wrap addressed to somebody else does not match our own #p filter', () => {
        const ledger = makeSubscriptionLedger()
        rememberOwnRequest(ledger, ['REQ', 'sub-1', wrapFilter])

        assert.equal(isSolicitedEvent(ledger, ['EVENT', 'sub-1', wrap({ tags: [['p', SOMEONE]] })]), false)
    })

    test('malformed frames answer false instead of throwing', () => {
        const ledger = makeSubscriptionLedger()
        rememberOwnRequest(ledger, ['REQ', 'sub-1', wrapFilter])

        assert.equal(isSolicitedEvent(ledger, ['EOSE', 'sub-1']), false)
        assert.equal(isSolicitedEvent(ledger, ['EVENT', 'sub-1', null]), false)
        assert.equal(isSolicitedEvent(ledger, ['EVENT', 'sub-1']), false)
        assert.equal(isSolicitedEvent(ledger, 'nope'), false)
    })
})
