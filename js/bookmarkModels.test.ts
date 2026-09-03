/**
 * Pure tests for the bookmark rules (browser-free, like `bookmarkModels.ts` itself):
 *   node --test --experimental-strip-types packages/einundzwanzig-group/js/bookmarkModels.test.ts
 *
 * Two things are defended here, and neither is cosmetic:
 *
 *  1. **Kind 30003 has two meanings on the same relay.** It is NIP-51 `NAMED_BOOKMARKS`
 *     and it is Buzz Desktop's mesh member status — signed with the *user's own key*,
 *     so `authors:[self]` does not separate them. Without the shape filter the bookmark
 *     screen shows mesh telemetry, and the cold-start cache stores it.
 *  2. **A write rebuilds the whole tag list.** Every rule about what survives that
 *     rebuild is a rule about not deleting bookmarks a user made in another client —
 *     web links above all, which is exactly where the house's own `readList` would have
 *     dropped them (`isValidTag` demands a *relay* url for `r`).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
    BOOKMARKS,
    MESH_STATUS_D_PREFIX,
    MESH_STATUS_MARKER,
    NAMED_BOOKMARKS,
    type BookmarkEventLike,
    bookmarkRefs,
    bookmarkedEventIds,
    isBookmarkTag,
    isBookmarked,
    isBuzzMeshStatus,
    otherBookmarkRefs,
    ownBookmarkList,
    ownBookmarkLists,
    planBookmarkWrite,
    withBookmarkTag,
    withoutBookmarkValue,
    writeConfirmed,
} from './bookmarkModels.ts'

const ME = 'a'.repeat(64)
const SOMEONE_ELSE = 'b'.repeat(64)
const MSG_A = '1'.repeat(64)
const MSG_B = '2'.repeat(64)

const ev = (
    over: Partial<BookmarkEventLike> & { kind: number; tags: string[][] },
): BookmarkEventLike => ({
    id: 'id-' + Math.random().toString(36).slice(2),
    pubkey: ME,
    created_at: 1_800_000_000,
    content: '',
    ...over,
})

/** The plain 10003 of the logged-in user. */
const list = (tags: string[][], over: Partial<BookmarkEventLike> = {}) =>
    ev({ kind: BOOKMARKS, tags, ...over })

/** A named 30003 set. */
const set = (d: string, tags: string[][], over: Partial<BookmarkEventLike> = {}) =>
    ev({ kind: NAMED_BOOKMARKS, tags: [['d', d], ...tags], ...over })

/**
 * A mesh member status exactly as Buzz Desktop builds it
 * (`desktop/src-tauri/src/mesh_llm/coordinator.rs:458-475`): kind 30003, a `d` of
 * `buzz-mesh-member-status:<ownerId>`, a `["k","buzz-mesh-status"]` marker, and a JSON
 * payload in `content`.
 */
const meshStatus = (ownerId = 'owner-7') =>
    ev({
        kind: NAMED_BOOKMARKS,
        tags: [
            ['d', `${MESH_STATUS_D_PREFIX}${ownerId}`],
            ['k', MESH_STATUS_MARKER],
        ],
        content: '{"ownerId":"owner-7","models":["llama"]}',
    })

// ── The 30003 collision ─────────────────────────────────────────────────────

test('a 30003 carrying the mesh `d` prefix is discarded', () => {
    // The core of the phase. `{kinds:[30003], authors:[self]}` fishes these out of the
    // relay for anybody who also runs Buzz Desktop, because they are signed with the
    // same identity key. Left in, the bookmark screen shows a row per mesh report.
    assert.equal(isBuzzMeshStatus(meshStatus()), true)
    assert.deepEqual(ownBookmarkLists([meshStatus()], ME), [])
    assert.deepEqual(bookmarkRefs([meshStatus()], ME), [])
})

test('… and so is one that carries only the `d` prefix, or only the `k` marker', () => {
    // Buzz needs BOTH signals before it hard-deletes a superseded row (`lib.rs:5210-5216`
    // is an `&&`) — a false positive there would destroy a real set. We only decide what
    // to display, so either signal is enough. A half-formed mesh event is still mesh.
    const onlyD = ev({ kind: NAMED_BOOKMARKS, tags: [['d', `${MESH_STATUS_D_PREFIX}x`]] })
    const onlyK = ev({ kind: NAMED_BOOKMARKS, tags: [['d', 'reading'], ['k', MESH_STATUS_MARKER]] })

    assert.equal(isBuzzMeshStatus(onlyD), true, 'the `d` prefix alone is enough')
    assert.equal(isBuzzMeshStatus(onlyK), true, 'the `k` marker alone is enough')
})

test('COUNTER-PROOF: a real 30003 set survives the filter', () => {
    // Without this the test above is also green on a function that answers `true` for
    // everything — and the bookmark sets of every other client would be invisible.
    const reading = set('reading', [['e', MSG_A]])

    assert.equal(isBuzzMeshStatus(reading), false)
    assert.deepEqual(bookmarkRefs([reading], ME), [{ type: 'e', value: MSG_A, set: 'reading' }])
})

test('the mesh shape means nothing on a 10003 — only 30003 collides', () => {
    // Guard against the filter widening by accident: kind 10003 is not in the collision,
    // and a list that happens to carry a `k` tag must not vanish.
    const odd = list([['k', MESH_STATUS_MARKER], ['e', MSG_A]])

    assert.equal(isBuzzMeshStatus(odd), false)
    assert.deepEqual(bookmarkedEventIds(bookmarkRefs([odd], ME)), [MSG_A])
})

// ── Whose list, and which version of it ─────────────────────────────────────

test('a list signed by somebody else is not this user’s list', () => {
    // The read filter already says `authors:[self]`, but a relay is not obliged to
    // honour it and the repository holds events from every source at once.
    const foreign = list([['e', MSG_A]], { pubkey: SOMEONE_ELSE })

    assert.deepEqual(ownBookmarkLists([foreign], ME), [])
    assert.equal(ownBookmarkList([foreign], ME), null)
})

test('without a logged-in pubkey there is no list at all', () => {
    assert.deepEqual(ownBookmarkLists([list([['e', MSG_A]])], ''), [])
})

test('of two versions of the same replaceable list the newest wins', () => {
    const old = list([['e', MSG_A]], { created_at: 1_800_000_000 })
    const fresh = list([['e', MSG_B]], { created_at: 1_800_000_100 })

    assert.deepEqual(bookmarkedEventIds(bookmarkRefs([old, fresh], ME)), [MSG_B])
    // Order of arrival must not decide — a cold start reads IndexedDB in any order.
    assert.deepEqual(bookmarkedEventIds(bookmarkRefs([fresh, old], ME)), [MSG_B])
})

test('a 30003 without a `d` is dropped — it has no address and no name', () => {
    // NIP-01 addresses it as `30003:<pubkey>:`, so every such event replaces every
    // other one. Rendering it as a set would also leave a nameless heading.
    const nameless = ev({ kind: NAMED_BOOKMARKS, tags: [['e', MSG_A]] })

    assert.deepEqual(ownBookmarkLists([nameless], ME), [])
})

// ── Order and duplicates across lists ───────────────────────────────────────

test('the plain list comes first, the named sets behind it in a stable order', () => {
    const events = [set('zzz', [['e', MSG_B]]), list([['e', MSG_A]]), set('aaa', [['t', 'bitcoin']])]

    assert.deepEqual(
        bookmarkRefs(events, ME),
        [
            { type: 'e', value: MSG_A, set: '' },
            { type: 't', value: 'bitcoin', set: 'aaa' },
            { type: 'e', value: MSG_B, set: 'zzz' },
        ],
        'plain list, then sets by `d` — independent of the order they arrived in',
    )
})

test('the same value in a set and in the plain list is shown once, as the plain one', () => {
    // Matters beyond tidiness: only the plain-list copy can be removed from here (this
    // client writes no sets), so the row the user can act on has to be the one shown.
    const refs = bookmarkRefs([set('reading', [['e', MSG_A]]), list([['e', MSG_A]])], ME)

    assert.deepEqual(refs, [{ type: 'e', value: MSG_A, set: '' }])
})

test('messages and everything else are told apart', () => {
    const refs = bookmarkRefs(
        [list([['e', MSG_A], ['a', '30023:' + ME + ':artikel'], ['t', 'bitcoin'], ['r', 'https://21.tld/x']])],
        ME,
    )

    assert.deepEqual(bookmarkedEventIds(refs), [MSG_A])
    assert.deepEqual(
        otherBookmarkRefs(refs).map((ref) => ref.type),
        ['a', 't', 'r'],
    )
    assert.equal(isBookmarked(refs, 'https://21.tld/x'), true)
    assert.equal(isBookmarked(refs, MSG_B), false)
})

test('a bookmark tag needs a name we know AND a non-empty value', () => {
    assert.equal(isBookmarkTag(['e', MSG_A]), true)
    assert.equal(isBookmarkTag(['e', '']), false, 'an empty value is no bookmark')
    assert.equal(isBookmarkTag(['e']), false, 'a bare tag is no bookmark')
    assert.equal(isBookmarkTag(['p', ME]), false, 'a `p` tag is a mention, not a bookmark')
    assert.equal(isBookmarkTag(['d', 'reading']), false, 'the set identifier is not an entry')
})

// ── Writing: what a rebuilt list must keep ──────────────────────────────────

test('adding puts the new bookmark first and keeps everything else in order', () => {
    const before = [['alt', 'my list'], ['e', MSG_A], ['t', 'bitcoin']]
    const after = withBookmarkTag(before, ['e', MSG_B])

    assert.deepEqual(after, [['e', MSG_B], ['alt', 'my list'], ['e', MSG_A], ['t', 'bitcoin']])
})

test('adding twice does not duplicate the entry', () => {
    const once = withBookmarkTag([['e', MSG_A]], ['e', MSG_A])

    assert.deepEqual(once, [['e', MSG_A]])
})

test('REGRESSION: a bookmarked web link survives a write', () => {
    // This is the one the house's `readList` would have eaten: its `isValidTag` requires
    // `isRelayUrl(tag[1])` for an `r` tag, and `isRelayUrl` rejects every `https://…`
    // (`@welshman/util` `Relay.js`: `protocol.match(/^wss?:$/)`). Bookmarking a message
    // would then have silently deleted every link the user saved in another client.
    const before = [['r', 'https://einundzwanzig.space/podcast'], ['r', 'http://21.tld/a?b=c#d']]
    const after = withBookmarkTag(before, ['e', MSG_A])

    assert.deepEqual(after, [['e', MSG_A], ...before])
})

test('removing takes the value out of every tag kind and leaves the rest alone', () => {
    const before = [
        ['alt', 'my list'],
        ['e', MSG_A],
        ['e', MSG_B],
        ['t', 'bitcoin'],
        ['r', 'https://21.tld/x'],
    ]

    assert.deepEqual(withoutBookmarkValue(before, MSG_A), [
        ['alt', 'my list'],
        ['e', MSG_B],
        ['t', 'bitcoin'],
        ['r', 'https://21.tld/x'],
    ])
    assert.deepEqual(withoutBookmarkValue(before, 'https://21.tld/x'), [
        ['alt', 'my list'],
        ['e', MSG_A],
        ['e', MSG_B],
        ['t', 'bitcoin'],
    ])
})

test('removing something that is not there changes nothing', () => {
    const before = [['e', MSG_A]]

    assert.deepEqual(withoutBookmarkValue(before, MSG_B), before)
})

test('a non-bookmark tag is never removed, even if its value matches', () => {
    // `["p", <hex>]` and `["e", <hex>]` can carry the same 64 hex characters. Dropping
    // by value alone would strip a mention out of a foreign client's list.
    const before = [['p', MSG_A], ['e', MSG_A]]

    assert.deepEqual(withoutBookmarkValue(before, MSG_A), [['p', MSG_A]])
})

// ── The gate, and why it is part of the plan ────────────────────────────────

test('GATE: while the space kind is unknown, no event body is produced at all', () => {
    // The phase's central promise, as a behaviour rather than as a code reading: the
    // gate's answer *is* the event body, so a write path that ignores it has nothing to
    // sign. `'unknown'` is what `deriveSpaceKind` reports while the NIP-11 document is
    // still in flight — deciding then would be guessing which relay we are talking to.
    assert.equal(planBookmarkWrite(null, MSG_A, true, 'unknown'), null, 'adding is refused')
    assert.equal(
        planBookmarkWrite(list([['e', MSG_A]]), MSG_A, false, 'unknown'),
        null,
        'and so is removing — the same list would be rewritten either way',
    )
})

test('GATE: on a resolved space the plan is a complete kind-10003 body', () => {
    // Counter-proof to the test above: without it the gate could deny everything and
    // both would still be green, with a surface that never writes a bookmark.
    for (const kind of ['buzz', 'other'] as const) {
        const plan = planBookmarkWrite(null, MSG_A, true, kind)
        assert.deepEqual(plan, { kind: BOOKMARKS, content: '', tags: [['e', MSG_A]] }, `on a ${kind} space`)
    }
})

test('the plan carries the encrypted private half over untouched', () => {
    // The one thing a bookmark write must never do. `content` of a NIP-51 list is the
    // NIP-44 ciphertext of the private entries; this client never decrypts it, so the
    // only safe handling is to copy it. `@welshman/domain`'s writer re-renders it and
    // can end up with `""` (see the module header) — that would sign the user's private
    // bookmarks away.
    const withPrivate = list([['e', MSG_A]], { content: 'AqrJ…ciphertext…==' })
    const plan = planBookmarkWrite(withPrivate, MSG_B, true, 'buzz')

    assert.equal(plan?.content, 'AqrJ…ciphertext…==')
    assert.deepEqual(plan?.tags, [['e', MSG_B], ['e', MSG_A]])
})

test('the plan removes by value, whatever kind of entry it was', () => {
    const withLink = list([['r', 'https://21.tld/x'], ['e', MSG_A]])
    const plan = planBookmarkWrite(withLink, 'https://21.tld/x', false, 'buzz')

    assert.deepEqual(plan?.tags, [['e', MSG_A]])
})

test('an empty value is no plan', () => {
    assert.equal(planBookmarkWrite(list([['e', MSG_A]]), '', true, 'buzz'), null)
})

// ── Did the relay mean its OK? ──────────────────────────────────────────────

test('the write counts as taken when the relay’s copy shows the change', () => {
    assert.equal(writeConfirmed([['e', MSG_A]], MSG_A, true), true, 'added and present')
    assert.equal(writeConfirmed([], MSG_A, false), true, 'removed and gone')
})

test('the write counts as NOT taken when the relay still shows the old list', () => {
    // The zooid trap: `ReplaceEvent` drops a replaceable event whose `created_at` is not
    // greater than the stored one and answers `deleted, nil` — the client sees `OK true`
    // and nothing happened (`zooid/events.go:440-443`). Kind 10003 is replaceable, so a
    // clock that runs behind turns every bookmark into a silent no-op.
    assert.equal(writeConfirmed([], MSG_A, true), false, 'added, but the relay has no such entry')
    assert.equal(writeConfirmed([['e', MSG_A]], MSG_A, false), false, 'removed, but it is still there')
})

test('an empty answer is “cannot tell”, not “failed”', () => {
    // A request that ends in a `CLOSED` from a hanging AUTH round returns nothing, and
    // so does a relay that simply does not serve the list back. Turning that into a red
    // error message would contradict an `OK` the relay already gave.
    assert.equal(writeConfirmed(null, MSG_A, true), true)
    assert.equal(writeConfirmed(null, MSG_A, false), true)
})
