import test, { describe } from 'node:test'
import assert from 'node:assert/strict'
import { RELAYS } from '@welshman/util'
import { RelayListReader } from '@welshman/domain'
import {
    FOLLOWS,
    declaredWriteRelaysOf,
    followedPubkeysOf,
    followListAnswered,
    followListWins,
    followRelayTargets,
    followWriteConfirmed,
    isFollowPersonTag,
    newestOwnEvent,
    normalizeRelaySet,
    outboxKnowledgeOf,
    ownFollowList,
    planFollowWrite,
    unansweredRelays,
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

/** A kind 10002 of ours, for the NIP-65 cases. */
const relayList = (tags: string[][], created_at = 100): FollowEventLike =>
    ({ id: 'r', kind: RELAYS, pubkey: ME, created_at, tags, content: '' })

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

describe('normalizeRelaySet: the shared normaliser', () => {
    test('CORE: normalises, drops non-relays, de-duplicates, keeps order', () => {
        assert.deepEqual(
            normalizeRelaySet(['wss://outbox.example', OUTBOX_2, 'wss://OUTBOX.example/', '', 'ws://']),
            [OUTBOX, OUTBOX_2],
        )
    })

    test('an empty input stays empty — it does not invent a fallback', () => {
        assert.deepEqual(normalizeRelaySet([]), [])
    })
})

describe('newestOwnEvent: one NIP-01 winner for both lists', () => {
    test('CORE: the kind is part of the question', () => {
        const drei = idList('aaa', [['p', ALICE]], 200)
        const zehntausendzwei = relayList([['r', OUTBOX]], 300)
        assert.equal(newestOwnEvent([drei, zehntausendzwei], ME, FOLLOWS), drei)
        assert.equal(newestOwnEvent([drei, zehntausendzwei], ME, RELAYS), zehntausendzwei)
    })

    test('a foreign author never wins, whatever the timestamp', () => {
        const fremd = { ...relayList([['r', OUTBOX]], 900), pubkey: BOB }
        assert.equal(newestOwnEvent([fremd], ME, RELAYS), null)
    })

    test('the tie-break applies here too — the same function, not a copy of it', () => {
        const klein = { ...relayList([['r', OUTBOX]], 100), id: 'aaa' }
        const gross = { ...relayList([['r', OUTBOX_2]], 100), id: 'bbb' }
        assert.equal(newestOwnEvent([gross, klein], ME, RELAYS), klein)
    })
})

/**
 * **NIP-65 parsing, checked against welshman rather than against the spec text.**
 *
 * The rule itself is one sentence — NIP-65: *„If the marker is omitted, the relay is both
 * read and write."* — and it is still worth a differential test, because this function has
 * to agree with `RelayListReader.writeUrls()` in `@welshman/domain`, not merely with my
 * reading of the spec. The reference parser is RUN here, not quoted: `isRelayUrl` gating,
 * the `relay` alias, normalisation and de-duplication are all places where a reimplementation
 * drifts silently.
 */
describe('declaredWriteRelaysOf: NIP-65 write relays', () => {
    test('CORE: an absent marker means read AND write', () => {
        assert.deepEqual(declaredWriteRelaysOf(relayList([['r', OUTBOX]])), [OUTBOX])
    })

    test('CORE: `write` counts, `read` does not', () => {
        assert.deepEqual(
            declaredWriteRelaysOf(relayList([['r', OUTBOX, 'write'], ['r', OUTBOX_2, 'read']])),
            [OUTBOX],
        )
    })

    test('a kind 10002 that declares only read relays yields NO write relay', () => {
        assert.deepEqual(declaredWriteRelaysOf(relayList([['r', OUTBOX, 'read']])), [])
    })

    test('no list at all: empty, and it is the caller who decides what that means', () => {
        assert.deepEqual(declaredWriteRelaysOf(null), [])
    })

    test('normalised and de-duplicated; non-relay entries drop out', () => {
        assert.deepEqual(
            declaredWriteRelaysOf(relayList([
                ['r', 'wss://outbox.example'],
                ['r', 'wss://OUTBOX.example/'],
                ['r', 'http://outbox.example/'],
                ['r', 'nicht mal eine url'],
                ['p', OUTBOX_2],
            ])),
            [OUTBOX],
        )
    })

    test('DIFFERENTIAL: agrees with welshman RelayListReader on every fixture', () => {
        // Run, not read. A reimplementation of somebody else's parser is a claim about
        // their code, and the only honest way to make it is to execute theirs.
        const fixtures: string[][][] = [
            [['r', OUTBOX]],
            [['r', OUTBOX, 'write'], ['r', OUTBOX_2, 'read']],
            [['r', OUTBOX, 'read']],
            [['r', OUTBOX, '']],
            [['relay', OUTBOX_2], ['r', OUTBOX, 'write']],
            [['r', 'wss://outbox.example'], ['r', 'wss://OUTBOX.example/']],
            [['r', 'http://outbox.example/'], ['r', 'nicht mal eine url'], ['r', '']],
            [['p', ALICE], ['t', 'bitcoin']],
            [],
        ]
        for (const tags of fixtures) {
            const event = relayList(tags)
            const referenz = new RelayListReader(RELAYS, {} as never, event as never).writeUrls()
            assert.deepEqual(
                declaredWriteRelaysOf(event),
                referenz,
                `disagrees with RelayListReader on ${JSON.stringify(tags)}`,
            )
        }
    })

    test('CALIBRATION: the reference parser is really running and really discriminates', () => {
        // Without this, a `RelayListReader` that threw or returned `[]` for everything
        // would make the differential case above green against a broken implementation.
        assert.deepEqual(
            new RelayListReader(RELAYS, {} as never, relayList([['r', OUTBOX], ['r', OUTBOX_2, 'read']]) as never)
                .writeUrls(),
            [OUTBOX],
        )
    })
})

/**
 * **F2: „this reader has no relay list" and „we could not ask" are different answers.**
 *
 * All three states get their own case. Two of three would leave exactly the gap the
 * finding describes: before the repair there were two values, and the missing third was
 * the one a fault produced.
 *
 * The fault was cheap to produce, which is what made it a High: `RelayStats.getQuality`
 * returns `0` after ONE `SocketStatus.Error` inside 60 s, and `RelayScenario.getUrls()`
 * drops a zero-quality relay entirely — so a network hiccup emptied the outbox, the empty
 * outbox took the lenient branch, and the card told the reader the harmless reason.
 */
describe('outboxKnowledgeOf: three states, never two', () => {
    test('CORE listed: write relays are declared — completeness is then the contact list\'s problem', () => {
        assert.equal(outboxKnowledgeOf({ writeUrls: [OUTBOX], allAnswered: false }), 'listed')
        assert.equal(outboxKnowledgeOf({ writeUrls: [OUTBOX], allAnswered: true }), 'listed')
    })

    test('CORE confirmed-none: nothing declared AND everybody answered', () => {
        assert.equal(outboxKnowledgeOf({ writeUrls: [], allAnswered: true }), 'confirmed-none')
    })

    test('CORE unknown: nothing declared and somebody stayed silent — NOT the same thing', () => {
        // This is the whole finding. The two cases above and below differ by one boolean,
        // and before the repair they were one value.
        assert.equal(outboxKnowledgeOf({ writeUrls: [], allAnswered: false }), 'unknown')
    })

    test('the three are distinct values, so a caller cannot collapse two by accident', () => {
        const alle = [
            outboxKnowledgeOf({ writeUrls: [OUTBOX], allAnswered: true }),
            outboxKnowledgeOf({ writeUrls: [], allAnswered: true }),
            outboxKnowledgeOf({ writeUrls: [], allAnswered: false }),
        ]
        assert.equal(new Set(alle).size, 3, `expected three distinct verdicts, got ${JSON.stringify(alle)}`)
    })
})

/**
 * **THE invariant, and the finding that it replaces.**
 *
 * A kind 3 may be written only if EVERY relay of the target set closed the read with an
 * `EOSE` in the same operation. The first version of this function asked `some`, which
 * reads reasonably and is wrong by one word: the write does not go to the relay that
 * answered, it goes to the whole set.
 *
 * Both directions are asserted, and so is the vacuous one — `[].every(…)` is `true`, and
 * an empty target set sliding through as "everything answered" would be a write to
 * nowhere reported as a complete read.
 */
describe('followListAnswered: EVERY target must have answered, not just one', () => {
    test('CORE: one relay that answered does NOT license the ones that stayed silent', () => {
        // F1 in one line. The relay that answered is not the relay the write replaces.
        assert.equal(followListAnswered([read(OUTBOX, true), read(OUTBOX_2, false), read(SPACE, false)],
            [OUTBOX, OUTBOX_2, SPACE]), false)
    })

    test('CORE: all of them answered — and only then', () => {
        assert.equal(followListAnswered([read(OUTBOX, true), read(OUTBOX_2, true), read(SPACE, true)],
            [OUTBOX, OUTBOX_2, SPACE]), true)
    })

    test('CORE: a reader with no relay list — the space alone IS the whole set', () => {
        // Not a second, laxer branch: the set is `[SPACE]`, and every member of it
        // answered. One rule, two situations. Refusing here would make following
        // impossible for people who cannot fix it — this client writes no kind 10002.
        assert.equal(followListAnswered([read(SPACE, true)], [SPACE]), true)
        assert.equal(followListAnswered([read(SPACE, false)], [SPACE]), false)
    })

    test('an empty target set is NOT vacuously complete', () => {
        assert.equal(followListAnswered([], []), false)
        assert.equal(followListAnswered([read(OUTBOX, true)], []), false)
    })

    test('a target nobody even asked counts as unanswered', () => {
        // The set is built from `targets`, not from `reads`: a read that silently never
        // happened has to show up as a gap, not disappear.
        assert.equal(followListAnswered([read(OUTBOX, true)], [OUTBOX, OUTBOX_2]), false)
    })

    test('the verdict is about the ANSWER, not about what the relay held', () => {
        // A reader who genuinely follows nobody has relays that answer with zero events.
        // That is a complete answer, and refusing it would leave them unable to make
        // their first follow ever.
        assert.equal(followListAnswered([read(OUTBOX, true, null), read(SPACE, true, null)], [OUTBOX, SPACE]), true)
    })

    test('targets and answers are matched NORMALISED — a missing slash must not fail closed', () => {
        assert.equal(followListAnswered([read('wss://outbox.example', true)], ['wss://outbox.example/']), true)
        assert.equal(followListAnswered([read('wss://outbox.example/', true)], ['wss://outbox.example']), true)
    })
})

/**
 * The refusal has to NAME the relay, or the strict rule above is unusable: a reader whose
 * own kind 10002 carries a dead entry can fix that — elsewhere, this client writes no
 * relay list — but only if they are told which entry.
 */
describe('unansweredRelays: what the refusal says', () => {
    test('CORE: exactly the targets that did not answer, normalised', () => {
        assert.deepEqual(
            unansweredRelays([read(OUTBOX, true), read(OUTBOX_2, false), read(SPACE, false)],
                [OUTBOX, OUTBOX_2, SPACE]),
            [OUTBOX_2, SPACE],
        )
    })

    test('a target with no read at all is named too', () => {
        assert.deepEqual(unansweredRelays([read(OUTBOX, true)], [OUTBOX, OUTBOX_2]), [OUTBOX_2])
    })

    test('everything answered: nothing to name', () => {
        assert.deepEqual(unansweredRelays([read(OUTBOX, true), read(SPACE, true)], [OUTBOX, SPACE]), [])
    })
})

/**
 * **The F1 scenario end to end, in the auditor's own shape.**
 *
 * A reader on three write relays whose 700-entry list sits on two of them. The third is
 * fresh and holds nothing; it answers. The two that hold the list run into the timeout.
 * Under the `some` rule this produced a signed kind 3 with ONE tag and an empty `content`,
 * addressed at all four relays, with `created_at = now()` — 700 contacts and the legacy
 * relay map gone, reported as success.
 *
 * The whole chain is exercised here rather than the verdict alone, because the verdict is
 * only half of the claim: `winningFollowList` still returns `null` in this situation, and
 * `planFollowWrite` would still build a body from it. The promise is that **no body comes
 * out**, and that is only true if the two functions are wired the way `js/follows.ts`
 * wires them.
 */
describe('F1: a partial answer never licenses a total replacement', () => {
    const FRESH = 'wss://fresh.example/'
    const DAMUS = 'wss://relay.damus.io/'
    const NOSLOL = 'wss://nos.lol/'

    /** The 700 the reader would lose, shortened to three — the count is not the point. */
    const echteListe = idList('aaa', [['p', ALICE], ['p', BOB], ['t', 'bitcoin']], 100)

    const reads = [
        read(FRESH, true, null),
        read(DAMUS, false, echteListe),
        read(NOSLOL, false, echteListe),
        read(SPACE, false, null),
    ]
    const targets = [FRESH, DAMUS, NOSLOL, SPACE]

    test('CORE: the verdict is NOT answered', () => {
        assert.equal(
            followListAnswered(reads, targets),
            false,
            'one fresh relay that answered and held nothing must not stand in for the two that hold the list',
        )
    })

    test('CORE: no event body comes out — the plan refuses', () => {
        const plan = planFollowWrite({
            list: winningFollowList(reads),
            listAnswered: followListAnswered(reads, targets),
            target: BOB,
            self: ME,
            add: false,
            spaceKind: 'other',
        })
        assert.equal(plan, null, 'this is the write that deletes 700 contacts; it must not exist')
    })

    test('CALIBRATION: the same inputs with every relay answering DO produce a body', () => {
        // Without this the case above would also pass for a gate that refuses everything.
        const alleDa = reads.map((r) => ({ ...r, answered: true }))
        const plan = planFollowWrite({
            list: winningFollowList(alleDa),
            listAnswered: followListAnswered(alleDa, targets),
            target: BOB,
            self: ME,
            add: false,
            spaceKind: 'other',
        })
        assert.ok(plan, 'a complete answer must still be able to write')
        assert.deepEqual(plan.tags, [['p', ALICE], ['t', 'bitcoin']], 'and it is built from the REAL list')
    })

    test('CALIBRATION: the refusal names the two relays that stayed silent', () => {
        assert.deepEqual(unansweredRelays(reads, targets), [DAMUS, NOSLOL, SPACE])
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
