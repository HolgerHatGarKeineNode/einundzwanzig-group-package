/**
 * **The rules of `js/messagingRelayModels.ts`, one assertion per rule.**
 *   node --test --experimental-strip-types packages/einundzwanzig-group/js/messagingRelayModels.test.ts
 *
 * Plan: `docs/plans/2026-09-05T0125-community-features-herbst.md`, phase P7, under the
 * standing extra DoD "reine Logik braucht reine Tests".
 *
 * The rule with a consequence in its own docblock, and the reason this file exists at
 * all: `planMessagingRelayWrite` with `listAnswered: false` is **data loss**. Kind 10050
 * is replaceable, so a write from an unanswered read publishes a list containing only
 * what this one device added and deletes every relay the user entered anywhere else.
 * welshman's own plugin does exactly that (`forceLoad`), which is why it is not used.
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
    MESSAGING_RELAYS,
    isMessagingRelayUrl,
    messagingRelayUrls,
    messagingRelayWriteConfirmed,
    ownMessagingRelayList,
    planMessagingRelayWrite,
    type RelayListEventLike,
} from './messagingRelayModels.ts'

const ME = 'a'.repeat(64)
const OTHER = 'b'.repeat(64)
const NOW = 1_788_600_000
const RELAY_A = 'wss://relay.a.example/'
const RELAY_B = 'wss://relay.b.example/'

const list = (overrides: Partial<RelayListEventLike & { id: string }> = {}) => ({
    id: '1'.repeat(64),
    kind: MESSAGING_RELAYS,
    pubkey: ME,
    created_at: NOW - 100,
    content: '',
    tags: [['relay', RELAY_A]],
    ...overrides,
})

const plan = (overrides: Record<string, unknown> = {}) =>
    planMessagingRelayWrite({
        list: null,
        listAnswered: true,
        urls: [RELAY_A],
        self: ME,
        spaceKind: 'other',
        now: NOW,
        ...overrides,
    } as Parameters<typeof planMessagingRelayWrite>[0])

describe('isMessagingRelayUrl', () => {
    test('takes ws and wss', () => {
        assert.equal(isMessagingRelayUrl('wss://relay.example/'), true)
        assert.equal(isMessagingRelayUrl('ws://localhost:3335/'), true)
    })

    test('rejects rather than repairs — a published list must be the author’s', () => {
        for (const value of ['', ' wss://relay.example/', 'relay.example', 'https://relay.example/', 'wss://', 42, null]) {
            assert.equal(isMessagingRelayUrl(value), false, `${JSON.stringify(value)} should not pass`)
        }
    })
})

describe('ownMessagingRelayList', () => {
    test('picks the newest list of this author', () => {
        const old = list({ id: '0'.repeat(64), created_at: NOW - 200 })
        const fresh = list({ id: '2'.repeat(64), created_at: NOW - 10 })
        assert.equal(ownMessagingRelayList([old, fresh], ME), fresh)
    })

    test('a tie is broken by the smaller id, like NIP-01 does it', () => {
        // Otherwise this client and the relay would disagree about which copy counts,
        // and two tabs writing in the same second would show different lists.
        const a = list({ id: 'a'.repeat(64) })
        const b = list({ id: '0'.repeat(64) })
        assert.equal(ownMessagingRelayList([a, b], ME), b)
    })

    test('somebody else’s list is not ours', () => {
        assert.equal(ownMessagingRelayList([list({ pubkey: OTHER })], ME), null)
    })

    test('another kind with the same author is not a messaging list', () => {
        assert.equal(ownMessagingRelayList([list({ kind: 10002 })], ME), null)
    })

    test('without an identity there is no own list', () => {
        assert.equal(ownMessagingRelayList([list()], ''), null)
    })
})

describe('messagingRelayUrls', () => {
    test('reads the relay tags in order', () => {
        assert.deepEqual(messagingRelayUrls(list({ tags: [['relay', RELAY_A], ['relay', RELAY_B]] })), [RELAY_A, RELAY_B])
    })

    test('drops unusable entries and other tag names', () => {
        const source = list({
            tags: [
                ['relay', RELAY_A],
                ['relay', 'not-a-url'],
                ['r', RELAY_B],
                ['relay'],
            ],
        })
        assert.deepEqual(messagingRelayUrls(source), [RELAY_A])
    })

    test('collapses duplicates — otherwise every message would go there twice', () => {
        assert.deepEqual(messagingRelayUrls(list({ tags: [['relay', RELAY_A], ['relay', RELAY_A]] })), [RELAY_A])
    })

    test('no list is no relays', () => {
        assert.deepEqual(messagingRelayUrls(null), [])
    })
})

describe('planMessagingRelayWrite', () => {
    test('an answered read with a new URL produces the event body', () => {
        const written = plan()
        assert.equal(written?.kind, MESSAGING_RELAYS)
        assert.deepEqual(written?.tags, [['relay', RELAY_A]])
        assert.equal(written?.content, '')
    })

    test('THE gate: without an EOSE nothing is written', () => {
        // Data loss. A 10050 written from an unanswered read replaces the user's whole
        // list with what this device happens to hold.
        assert.equal(plan({ listAnswered: false }), null)
    })

    test('no identity, no write', () => {
        assert.equal(plan({ self: '' }), null)
    })

    test('a Buzz space refuses the kind before it is signed', () => {
        // Measured: `restricted: unknown event kind` (`p7-messung-c-kind10050.txt`).
        assert.equal(plan({ spaceKind: 'buzz' }), null)
    })

    test('a relay whose kind is not known yet refuses too', () => {
        assert.equal(plan({ spaceKind: 'unknown' }), null)
    })

    test('an empty list is never published', () => {
        // It is indistinguishable from the bug above after the fact.
        assert.equal(plan({ urls: [] }), null)
        assert.equal(plan({ urls: ['nonsense'] }), null)
    })

    test('an unchanged list is not rewritten', () => {
        assert.equal(plan({ list: list(), urls: [RELAY_A] }), null)
    })

    test('a reordering IS a change', () => {
        // Order carries meaning in a relay list, so it is compared positionally.
        const written = plan({ list: list({ tags: [['relay', RELAY_A], ['relay', RELAY_B]] }), urls: [RELAY_B, RELAY_A] })
        assert.deepEqual(written?.tags, [['relay', RELAY_B], ['relay', RELAY_A]])
    })

    test('duplicates in the input collapse before the comparison', () => {
        assert.equal(plan({ list: list(), urls: [RELAY_A, RELAY_A] }), null)
    })

    test('the timestamp always beats the list it replaces', () => {
        // NIP-01 breaks a `created_at` tie by the SMALLER id — an equal timestamp is a
        // coin flip, not an update. Two tabs writing in the same second is not exotic.
        const written = plan({ list: list({ created_at: NOW + 500 }), urls: [RELAY_B] })
        assert.equal(written?.created_at, NOW + 501)
    })

    test('without an older list it uses the clock it was given', () => {
        assert.equal(plan()?.created_at, NOW)
    })
})

describe('messagingRelayWriteConfirmed', () => {
    test('confirmed when the relay hands back exactly what was asked for', () => {
        assert.equal(messagingRelayWriteConfirmed(list({ tags: [['relay', RELAY_B]] }), [RELAY_B]), true)
    })

    test('not confirmed when the relay kept the old list', () => {
        // An `OK true` says the frame was accepted. This says the state changed.
        assert.equal(messagingRelayWriteConfirmed(list(), [RELAY_B]), false)
    })

    test('not confirmed when there is no list at all', () => {
        assert.equal(messagingRelayWriteConfirmed(null, [RELAY_A]), false)
    })
})
