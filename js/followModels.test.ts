import test, { describe } from 'node:test'
import assert from 'node:assert/strict'
import {
    FOLLOWS,
    followedPubkeysOf,
    followListAnswered,
    followListWins,
    followRelayTargets,
    followWriteConfirmed,
    isFollowPersonTag,
    ownFollowList,
    planFollowWrite,
    winningFollowList,
    withFollowedPubkey,
    withoutFollowedPubkey,
    type FollowEventLike,
    type FollowRelayRead,
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

/** Like {@link list}, but with an id of its own — for the NIP-01 tie-break (P2). */
const idList = (id: string, tags: string[][], created_at = 100): FollowEventLike =>
    ({ id, kind: FOLLOWS, pubkey: ME, created_at, tags, content: '' })

const read = (url: string, answered: boolean, held: FollowEventLike | null = null): FollowRelayRead =>
    ({ url, answered, list: held })

const OUTBOX = 'wss://outbox.example/'
const OUTBOX_2 = 'wss://second.example/'
const SPACE = 'wss://space.example/'

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
        const seen = followedPubkeysOf(list([['p', ALICE], ['t', 'x'], ['p', BOB], ['p', ALICE]]))
        assert.deepEqual(seen, [ALICE, BOB])
    })

    /**
     * **The NIP-01 ordering, and why P2 needs its second half.**
     *
     * Before P2 one relay was asked, so "newest wins" was enough. Now several are, and
     * two of them can hold lists with the SAME `created_at` — not as an edge case:
     * `makeEvent` stamps seconds, so any two writes inside one second tie. NIP-01 settles
     * it: *„In case of replaceable events with the same timestamp, the event with the
     * lowest id (first in lexical order) should be retained, and the other discarded."*
     * Without that line this client would agree with whichever relay answered first, and
     * two tabs would render two different follow lists from the same data.
     */
    test('NIP-01 ordering: a newer created_at wins', () => {
        assert.equal(followListWins(idList('a', [], 200), idList('b', [], 100)), true)
        assert.equal(followListWins(idList('a', [], 100), idList('b', [], 200)), false)
        assert.equal(followListWins(idList('a', [], 100), null), true, 'anything beats nothing')
    })

    test('NIP-01 tie-break: at the SAME created_at the lexicographically smallest id wins', () => {
        // `>=` instead of `>` on the timestamp makes both of these true, and then "whoever
        // answered last" decides — the exact non-determinism the rule removes.
        assert.equal(followListWins(idList('aaa', [], 100), idList('bbb', [], 100)), true)
        assert.equal(followListWins(idList('bbb', [], 100), idList('aaa', [], 100)), false)
        assert.equal(followListWins(idList('aaa', [], 100), idList('aaa', [], 100)), false, 'itself is not newer')
    })

    test('ownFollowList carries the tie-break, not just the timestamp', () => {
        const klein = idList('aaa', [['p', ALICE]], 100)
        const gross = idList('bbb', [['p', BOB]], 100)
        assert.equal(ownFollowList([gross, klein], ME), klein, 'batch order must not decide')
        assert.equal(ownFollowList([klein, gross], ME), klein)
    })
})

/**
 * **P2: which relays a contact list is read from and written to.**
 *
 * The space relay is NOT replaced by the outbox. Members read each other there, and a
 * reader without a kind 10002 would otherwise have no target at all — the write would
 * land nowhere and the read would ask nobody.
 */
describe('followRelayTargets: outbox ∪ space', () => {
    test('CORE: both halves are in — outbox first, space always present', () => {
        assert.deepEqual(followRelayTargets([OUTBOX, OUTBOX_2], SPACE), [OUTBOX, OUTBOX_2, SPACE])
    })

    test('CORE: an empty outbox still leaves the space — this reader can still follow', () => {
        assert.deepEqual(followRelayTargets([], SPACE), [SPACE])
    })

    test('a space that is also an outbox relay appears once, and is still there', () => {
        assert.deepEqual(followRelayTargets([SPACE, OUTBOX], SPACE), [SPACE, OUTBOX])
    })

    test('de-duplication happens AFTER normalisation — a missing slash is not a second relay', () => {
        // Measured against the installed welshman 0.9.9: `normalizeRelayUrl` appends the
        // slash and lowercases the host. A raw `Set` would have written the same list to
        // the same relay twice and, worse, counted it twice in the verdict below.
        assert.deepEqual(followRelayTargets(['wss://outbox.example', 'wss://OUTBOX.example/'], SPACE), [OUTBOX, SPACE])
    })

    test('a trailing dot stays a SEPARATE relay — stated, not silently collapsed', () => {
        // `wss://host./` is a different name in a URL and the same name in DNS.
        // `normalizeRelayUrl` does not collapse it (measured), and this client does not
        // rewrite somebody else's relay entry. It simply becomes a second target.
        assert.deepEqual(
            followRelayTargets(['wss://outbox.example./'], SPACE),
            ['wss://outbox.example./', SPACE],
        )
    })

    test('an unreadable entry counts as ABSENT, it does not take the whole set down', () => {
        // `normalizeRelayUrl` throws a TypeError on garbage. A throw here would take out
        // the read AND the write for one malformed relay entry.
        assert.deepEqual(followRelayTargets(['nicht mal eine url', '', OUTBOX], SPACE), [OUTBOX, SPACE])
    })

    test('an unreadable SPACE leaves an empty set — and an empty set can never answer', () => {
        assert.deepEqual(followRelayTargets([], 'ws://'), [])
    })
})

/**
 * **P2: the staged, fail-closed verdict.** This is the rule the whole phase turns on.
 *
 * Both branches are asserted here, not one: a test that only covers "outbox present"
 * leaves the branch every reader without a kind 10002 actually takes unmeasured, and a
 * test that only covers "outbox empty" is green for a rule that never looks at the outbox
 * at all.
 */
describe('followListAnswered: an EOSE from the space alone is not an answer', () => {
    test('CORE, outbox present: the space answering is NOT enough', () => {
        // This is the defect P2 removes, in one line. The space relay practically never
        // holds a contact list — a closed NIP-29 relay stands in nobody's NIP-65 list —
        // so "answered, and it held nothing" used to be the normal reading of "we asked
        // the wrong relay", and a write on it is a kind 3 with one entry.
        assert.equal(followListAnswered([read(SPACE, true), read(OUTBOX, false)], [OUTBOX]), false)
    })

    test('CORE, outbox present: ONE outbox relay answering is enough', () => {
        assert.equal(followListAnswered([read(SPACE, false), read(OUTBOX, true)], [OUTBOX, OUTBOX_2]), true)
    })

    test('CORE, outbox EMPTY: the space answering is enough — there is no better source', () => {
        // Refusing here would make following impossible for exactly the people who cannot
        // fix it: this client has no write path for kind 10002.
        assert.equal(followListAnswered([read(SPACE, true)], []), true)
    })

    test('outbox empty and nobody answered: still no', () => {
        assert.equal(followListAnswered([read(SPACE, false)], []), false)
    })

    test('nothing was asked at all: no', () => {
        assert.equal(followListAnswered([], []), false)
        assert.equal(followListAnswered([], [OUTBOX]), false)
    })

    test('the verdict is about the ANSWER, not about what the relay held', () => {
        // A reader who genuinely follows nobody has an outbox relay that answers with zero
        // events. That is a complete answer, and refusing it would leave them unable to
        // make their first follow ever.
        assert.equal(followListAnswered([read(OUTBOX, true, null)], [OUTBOX]), true)
    })

    test('the outbox is matched NORMALISED — a missing slash must not silently fail closed', () => {
        assert.equal(followListAnswered([read(OUTBOX, true)], ['wss://outbox.example']), true)
    })
})

/**
 * **P2: the union is of SOURCES, never of tags.**
 *
 * Kind 3 is replaceable, so exactly one of the lists collected is valid. Merging their
 * `p` tags is the friendlier-looking choice and a data corruption with its own failure
 * class: it resurrects every unfollow a relay has not caught up with, silently and
 * permanently — and it passes every superficial test, because the result contains
 * everybody the user expects to see.
 */
describe('winningFollowList: the newest list wins, the tags are never merged', () => {
    test('CORE: an unfollow the other relay has not seen stays gone', () => {
        const alt = idList('aaa', [['p', ALICE], ['p', BOB]], 100)
        const neu = idList('bbb', [['p', ALICE]], 200)
        const gewinner = winningFollowList([read(SPACE, true, alt), read(OUTBOX, true, neu)])
        assert.equal(gewinner, neu, 'the newest list is the valid one')
        assert.deepEqual(
            followedPubkeysOf(gewinner),
            [ALICE],
            'a tag union would hand BOB back — an unfollow undone by a stale relay, permanently',
        )
    })

    test('CORE: relay order does not decide', () => {
        const alt = idList('aaa', [['p', ALICE], ['p', BOB]], 100)
        const neu = idList('bbb', [['p', ALICE]], 200)
        assert.equal(winningFollowList([read(OUTBOX, true, neu), read(SPACE, true, alt)]), neu)
    })

    test('at a tie the NIP-01 id rule decides here too', () => {
        const klein = idList('aaa', [['p', ALICE]], 100)
        const gross = idList('bbb', [['p', BOB]], 100)
        assert.equal(winningFollowList([read(SPACE, true, gross), read(OUTBOX, true, klein)]), klein)
    })

    test('a list from an UNANSWERED relay still counts as a merge base', () => {
        // Opposite direction from followListAnswered, on purpose: whether we may write is
        // the verdict's question. What we would write FROM is this one, and a list carried
        // by a relay that never sent its EOSE is still a real, signed event of ours —
        // taking it can only raise the winner's created_at, never lower it.
        const neu = idList('bbb', [['p', ALICE], ['p', BOB]], 300)
        assert.equal(winningFollowList([read(OUTBOX, true, idList('aaa', [['p', ALICE]], 100)), read(SPACE, false, neu)]), neu)
    })

    test('nobody held one: null, and the plan gate decides what that means', () => {
        assert.equal(winningFollowList([read(SPACE, true), read(OUTBOX, true)]), null)
        assert.equal(winningFollowList([]), null)
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

    /**
     * **The case P1 documented as a defect and P2 repaired — at the source, not here.**
     *
     * `listAnswered: true` with `list: null` builds a kind 3 holding exactly ONE entry.
     * That is the only correct output for somebody who genuinely has no contact list, and
     * it was a data loss for everybody else, because until P2 the input could not mean
     * what it says: the read went to the **space relay alone**, a closed NIP-29 relay
     * stands in nobody's NIP-65 list, and no foreign client writes a kind 3 there. So
     * `list: null` mostly meant "we asked the wrong relay".
     *
     * **The repair was the relay set, not this function.** `readOwnFollowList` now asks
     * outbox ∪ space ({@link followRelayTargets}) and hands over the verdict of
     * {@link followListAnswered}, which with a NIP-65 list on file takes an `EOSE` from an
     * OUTBOX relay — the space alone no longer clears it. So the pair below now says what
     * it always claimed: a relay that holds this reader's contact list was asked, and
     * there is none.
     *
     * What this case therefore holds today: the empty base is **permitted**, and it is
     * the caller's relay set that earns the right to reach it. Weakening `listAnswered`
     * back to "any relay said EOSE" puts the one-entry list back without changing a line
     * of this file — which is why the staged rule has its own describe block above and
     * the wiring has `followWriteGate.test.ts`.
     */
    test('an answered read with NO list is a reader who has none — and gets a one-entry list', () => {
        const plan = planFollowWrite({ ...basis, list: null, listAnswered: true })
        assert.ok(plan, 'the refusal hangs on `listAnswered`, and this input clears it')
        assert.deepEqual(
            plan.tags,
            [['p', ALICE]],
            'one entry — correct here, and only because `listAnswered` now means an outbox relay answered',
        )
        assert.equal(plan.content, '', 'no legacy relay map to carry over: there was no list to carry it from')
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
