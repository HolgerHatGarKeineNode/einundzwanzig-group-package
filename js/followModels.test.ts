import test, { describe } from 'node:test'
import assert from 'node:assert/strict'
import {
    FOLLOWS,
    followedPubkeysOf,
    followWriteConfirmed,
    isFollowPersonTag,
    ownFollowList,
    planFollowWrite,
    withFollowedPubkey,
    withoutFollowedPubkey,
    type FollowEventLike,
} from './followModels.ts'

/**
 * NIP-02 contact list (kind 3) — the pure rules (P8).
 *
 * **What this file is really about.** Kind 3 is the most consequential replaceable event
 * this client writes: one list per person, global, and the object every other client reads
 * to build a feed. A write from an incomplete picture does not lose an entry, it loses the
 * follow list. Every case below that looks like bookkeeping is there because of that one
 * failure mode.
 */

const ME = 'a'.repeat(64)
const ALICE = 'b'.repeat(64)
const BOB = 'c'.repeat(64)

const list = (tags: string[][], created_at = 100, content = '', pubkey = ME): FollowEventLike =>
    ({ id: 'x', kind: FOLLOWS, pubkey, created_at, tags, content })

describe('reading a contact list', () => {
    test('the NEWEST kind 3 of the author decides, not the first one seen', () => {
        // A cold start hands us the IndexedDB copy and a fresh one in the same batch. The
        // older of the two must not decide who is followed.
        const alt = list([['p', ALICE]], 100)
        const neu = list([['p', ALICE], ['p', BOB]], 200)
        assert.equal(ownFollowList([neu, alt], ME), neu)
        assert.equal(ownFollowList([alt, neu], ME), neu)
    })

    test('a list of a DIFFERENT author is never ours', () => {
        assert.equal(ownFollowList([list([['p', ALICE]], 100, '', BOB)], ME), null)
    })

    test('a guest has no list — an empty self never matches', () => {
        assert.equal(ownFollowList([list([['p', ALICE]])], ''), null)
    })

    test('only `p` tags with a value count as follows', () => {
        assert.equal(isFollowPersonTag(['p', ALICE]), true)
        assert.equal(isFollowPersonTag(['p', '']), false)
        assert.equal(isFollowPersonTag(['p']), false)
        assert.equal(isFollowPersonTag(['t', 'bitcoin']), false)
    })

    test('duplicates collapse, order is kept', () => {
        const read = followedPubkeysOf(list([['p', ALICE], ['t', 'x'], ['p', BOB], ['p', ALICE]]))
        assert.deepEqual(read, [ALICE, BOB])
    })
})

describe('the tag algebra keeps what it cannot display', () => {
    test('following prepends a BARE tag and keeps every foreign one', () => {
        const vorher = [['t', 'bitcoin'], ['p', ALICE, 'wss://relay/', 'ali']]
        const nachher = withFollowedPubkey(vorher, BOB)
        assert.deepEqual(nachher[0], ['p', BOB], 'the new entry is first — and carries no invented relay hint')
        assert.deepEqual(nachher.slice(1), vorher, 'every existing tag survives, with its extra columns')
    })

    test('following somebody already followed moves them to the front WITHOUT duplicating', () => {
        const nachher = withFollowedPubkey([['p', ALICE, 'wss://relay/', 'ali']], ALICE)
        assert.deepEqual(nachher, [['p', ALICE]])
    })

    test('unfollowing removes only that person — hint and petname of the others stay', () => {
        const nachher = withoutFollowedPubkey(
            [['p', ALICE, 'wss://relay/', 'ali'], ['t', 'x'], ['p', BOB]],
            BOB,
        )
        assert.deepEqual(nachher, [['p', ALICE, 'wss://relay/', 'ali'], ['t', 'x']])
    })
})

describe('planFollowWrite: the gate and the event body are ONE value', () => {
    const basis = { list: list([]), listAnswered: true, target: ALICE, self: ME, add: true, spaceKind: 'other' as const }

    test('the ordinary case produces a body that carries `content` over untouched', () => {
        const plan = planFollowWrite({ ...basis, list: list([['p', BOB]], 100, '{"wss://a/":{"read":true}}') })
        assert.ok(plan)
        assert.equal(plan.kind, FOLLOWS)
        assert.equal(plan.content, '{"wss://a/":{"read":true}}', 'the legacy relay map is not ours to rewrite')
        assert.deepEqual(plan.tags, [['p', ALICE], ['p', BOB]])
    })

    test('THE CORE REFUSAL: an unanswered read produces NO event at all', () => {
        // Without this, a dead socket ends with `list: null` and we publish a kind 3 with
        // one entry — deleting every contact the user made anywhere else. Measured once in
        // this repo on welshman's `forceLoad`, which returns `undefined` in exactly that
        // situation.
        assert.equal(planFollowWrite({ ...basis, list: null, listAnswered: false }), null)
        // And it refuses even when we DO hold a list: "we have one" is not "the relay
        // showed us theirs".
        assert.equal(planFollowWrite({ ...basis, list: list([['p', BOB]]), listAnswered: false }), null)
    })

    test('a relay whose kind is still unknown is refused — fail-closed', () => {
        assert.equal(planFollowWrite({ ...basis, spaceKind: 'unknown' }), null)
    })

    test('following yourself is refused', () => {
        assert.equal(planFollowWrite({ ...basis, target: ME }), null)
    })

    test('a guest has nothing to sign with', () => {
        assert.equal(planFollowWrite({ ...basis, self: '' }), null)
    })

    test('an empty target is refused — an empty `p` tag is not a follow', () => {
        assert.equal(planFollowWrite({ ...basis, target: '' }), null)
    })

    test('a write that changes nothing is refused — double click, or a second device first', () => {
        assert.equal(planFollowWrite({ ...basis, list: list([['p', ALICE]]), add: true }), null)
        assert.equal(planFollowWrite({ ...basis, list: list([['p', BOB]]), add: false }), null)
    })

    test('unfollowing produces the list without that person', () => {
        const plan = planFollowWrite({ ...basis, list: list([['p', ALICE], ['p', BOB]]), add: false })
        assert.ok(plan)
        assert.deepEqual(plan.tags, [['p', BOB]])
    })

    test('CALIBRATION: the case above is only meaningful because the same input with `add` writes', () => {
        // Without this line "refused" would also be true for a gate that refuses
        // everything, and every refusal case above would prove nothing.
        assert.ok(planFollowWrite({ ...basis, list: list([['p', BOB]]), add: true }))
    })
})

describe('followWriteConfirmed: silence is not evidence', () => {
    test('a relay that answered and DISAGREES is trusted', () => {
        assert.equal(followWriteConfirmed([['p', BOB]], ALICE, true), false)
        assert.equal(followWriteConfirmed([['p', ALICE]], ALICE, false), false)
    })

    test('a relay that answered and agrees confirms', () => {
        assert.equal(followWriteConfirmed([['p', ALICE]], ALICE, true), true)
        assert.equal(followWriteConfirmed([['p', BOB]], ALICE, false), true)
    })

    test('NO answer is not a failure — the opposite direction from the write gate', () => {
        // A hanging AUTH round swallows the `EOSE` entirely. Turning "cannot tell" into a
        // red error would contradict an `OK` we already have, most often for the people
        // with the worst connection. Before the write, silence blocks; after it, silence
        // only means we cannot re-check.
        assert.equal(followWriteConfirmed(null, ALICE, true), true)
        assert.equal(followWriteConfirmed(null, ALICE, false), true)
    })
})
