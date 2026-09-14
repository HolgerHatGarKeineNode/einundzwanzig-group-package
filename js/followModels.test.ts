import test, { describe } from 'node:test'
import assert from 'node:assert/strict'
import { RELAYS } from '@welshman/util'
import { RelayListReader } from '@welshman/domain'
import {
    FOLLOWS,
    MIN_SOURCES_TO_LOWER,
    floorAfterRead,
    anyRelayAnswered,
    armingReadsContactList,
    followWriteBlanksKnownContent,
    followWriteShrinksBelowKnown,
    followedPubkeysIn,
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
const FALLBACK = 'wss://fallback.example/'
const FALLBACK_2 = 'wss://fallback-two.example/'

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
 * **N1: the base of a write and its target set are the same set — and the space is in
 * neither.**
 *
 * P2 put the space relay in „because the members read each other there". The premise was
 * checked against the production tree and is false: nobody reads a foreign contact list
 * anywhere. The space copy could only ever be consumed by our own merge base, and that is
 * what made it a hazard rather than a service — see the two-session case further down.
 */
describe('followRelayTargets: one set, and the space is not in it', () => {
    test('CORE listed: exactly the declared write relays — no space, no fallback', () => {
        assert.deepEqual(
            followRelayTargets('listed', [OUTBOX, OUTBOX_2], [FALLBACK]),
            [OUTBOX, OUTBOX_2],
        )
    })

    test('CORE confirmed-none: the fallback set, and nothing of the declaration', () => {
        assert.deepEqual(followRelayTargets('confirmed-none', [], [FALLBACK, FALLBACK_2]), [FALLBACK, FALLBACK_2])
    })

    test('CORE unknown: the EMPTY set — nothing is read, so nothing can be written', () => {
        // Fail-closed expressed in the set rather than only in the verdict: an empty
        // target set is refused by followListAnswered, so the two say the same thing
        // twice and neither can be walked past alone.
        assert.deepEqual(followRelayTargets('unknown', [OUTBOX], [FALLBACK]), [])
        assert.equal(followListAnswered([read(OUTBOX, true)], followRelayTargets('unknown', [OUTBOX], [FALLBACK])), false)
    })

    test('CORE: a space url handed in as a declared relay is NOT special — it is simply not there', () => {
        // The guarantee is structural: this function has no space parameter any more, so
        // there is no argument through which a space could re-enter.
        assert.equal(followRelayTargets.length, 3, 'the signature gained a space argument again')
        assert.ok(!followRelayTargets('listed', [OUTBOX], [FALLBACK]).includes(SPACE))
        assert.ok(!followRelayTargets('confirmed-none', [], [FALLBACK]).includes(SPACE))
    })

    test('de-duplication happens AFTER normalisation — a missing slash is not a second relay', () => {
        // Measured against the installed welshman 0.9.9: `normalizeRelayUrl` appends the
        // slash and lowercases the host. A raw `Set` would have written the same list to
        // the same relay twice and, worse, counted it twice in the verdict.
        assert.deepEqual(
            followRelayTargets('listed', ['wss://outbox.example', 'wss://OUTBOX.example/'], []),
            [OUTBOX],
        )
    })

    test('a trailing dot stays a SEPARATE relay — stated, not silently collapsed', () => {
        // `wss://host./` is a different name in a URL and the same name in DNS.
        // `normalizeRelayUrl` does not collapse it (measured), and this client does not
        // rewrite somebody else's relay entry.
        assert.deepEqual(
            followRelayTargets('listed', ['wss://outbox.example./'], []),
            ['wss://outbox.example./'],
        )
    })

    test('an unreadable entry counts as ABSENT, it does not take the whole set down', () => {
        assert.deepEqual(followRelayTargets('listed', ['nicht mal eine url', '', OUTBOX], []), [OUTBOX])
    })

    test('a declaration of nothing but garbage leaves an empty set — which can never answer', () => {
        assert.deepEqual(followRelayTargets('listed', ['ws://'], [FALLBACK]), [])
    })
})

/**
 * **THE proof of this round: the two-session chain that destroyed 700 contacts.**
 *
 * Session 1 — the reader has no kind 10002. Under P2 the target set was the space alone,
 * the space holds no contact list, the merge base was therefore `null`, and a kind 3 with
 * ONE tag was written to the space.
 *
 * Session 2 — the relay list resolves. The target set became `[relay-a, space]`, the
 * space stub was the newest event of that address, it won the NIP-01 comparison, and
 * `planFollowWrite` built the next list from it. Relay A went from 700 entries to two.
 *
 * No attacker and no fault required: it is enough that the indexers answer and hold no
 * kind 10002 for this reader while their contact list sits on a relay nobody asked.
 *
 * The case asserts the CONTACT COUNT on relay A before and after, because that is the
 * quantity the reader loses — a test that only asserted „the target set has no space"
 * would stay green for any number of other ways back in.
 */
describe('N1: the space stub can no longer poison a later session', () => {
    const RELAY_A = 'wss://relay-a.example/'
    /** The reader's real list — three stand in for 700; the count is what is asserted. */
    const echteListe = idList('aaa', [['p', ALICE], ['p', BOB], ['t', 'bitcoin']], 1000)

    /** Session 1: no kind 10002 anywhere, and the fallback is where lists actually live. */
    const sitzung1 = (): { targets: string[]; plan: ReturnType<typeof planFollowWrite> } => {
        const targets = followRelayTargets('confirmed-none', [], [RELAY_A])
        // Every target answered; relay A holds the real list, because that is where the
        // reader's client put it.
        const reads = targets.map((url) => read(url, true, url === RELAY_A ? echteListe : null))

        return {
            targets,
            plan: planFollowWrite({
                list: winningFollowList(reads),
                listAnswered: followListAnswered(reads, targets),
                target: BOB,
                self: ME,
                add: false,
                spaceKind: 'other',
                knownContactCount: 0, knownContentNonEmpty: false,
            }),
        }
    }

    test('CORE: session 1 writes to a relay that HOLDS the list, so the base is the real one', () => {
        const { targets, plan } = sitzung1()
        assert.deepEqual(targets, [RELAY_A], 'the space is not a target, and the fallback is not empty')
        assert.ok(plan, 'a complete answer must be able to write')
        assert.equal(
            followedPubkeysOf({ ...echteListe, tags: plan.tags }).length,
            1,
            'unfollowing BOB leaves ALICE — the real list minus one, not a stub',
        )
    })

    test('CORE: the 700 survive — no one-tag stub is produced anywhere', () => {
        const { plan } = sitzung1()
        assert.ok(plan)
        assert.ok(
            plan.tags.some((tag) => tag[0] === 't'),
            'the foreign tags of the real list are carried over; a stub would have none',
        )
        assert.notDeepEqual(plan.tags, [['p', BOB]], 'this shape IS the stub that destroyed the list')
    })

    test('CORE: session 2 with a resolved relay list cannot see a space copy at all', () => {
        // Even if a stub from an older client version still sits on the space, it is not
        // in the target set, so it is not a base source, so it cannot win.
        const stub = idList('zzz', [['p', BOB]], 2000)
        const targets = followRelayTargets('listed', [RELAY_A], [])
        assert.deepEqual(targets, [RELAY_A])
        const reads = targets.map((url) => read(url, true, echteListe))
        const base = winningFollowList(reads)
        assert.equal(base, echteListe, 'the base is what the target relays showed, and they showed the real list')
        assert.equal(
            followedPubkeysOf(base).length,
            2,
            'the reader still has both contacts — this number was 1 before N1 was fixed',
        )
        assert.ok(stub.created_at > echteListe.created_at, 'CALIBRATION: the stub really is the newer event')
    })

    test('CALIBRATION: the stub WOULD still win if it ever got into the set', () => {
        // Without this the case above proves nothing: it has to be true that the only
        // thing keeping the stub out is the target set, not some accident of timestamps.
        const stub = idList('zzz', [['p', BOB]], 2000)
        const vergiftet = [read(RELAY_A, true, echteListe), read(SPACE, true, stub)]
        assert.equal(winningFollowList(vergiftet), stub)
        assert.equal(followedPubkeysOf(winningFollowList(vergiftet)).length, 1, 'this is the 700 → 2 collapse')
    })
})

/**
 * **The divergence that is deliberately NOT closed.**
 *
 * `outboxKnowledgeOf` returns `listed` as soon as write relays are declared, without
 * demanding that every asked relay answered. That is a decision, not an oversight: with
 * the space out of the set, a stale kind 10002 leads to a CONSISTENT old relay set — read
 * and written alike — while the newer relays are simply not touched and are read again
 * next session. Divergence, not destruction. Tightening it would only add refusals.
 */
describe('a stale relay list gives a consistent old set, not a broken one', () => {
    const ALT = 'wss://old-relay.example/'
    const NEU = 'wss://new-relay.example/'

    test('CORE: the stale declaration is read AND written — the same set, both ways', () => {
        const knowledge = outboxKnowledgeOf({ writeUrls: [ALT], anyAnswered: false })
        assert.equal(knowledge, 'listed', 'a declaration we hold is a declaration, answered or not')
        const targets = followRelayTargets(knowledge, [ALT], [NEU])
        assert.deepEqual(targets, [ALT], 'read and write both go here')
        assert.ok(!targets.includes(NEU), 'the newer relay is not written to — and so not damaged either')
    })

    test('CORE: the untouched relay keeps its own copy, and wins later if it is newer', () => {
        // The next session resolves the new declaration and reads both; NIP-01 decides.
        const altListe = idList('aaa', [['p', ALICE]], 1000)
        const neuListe = idList('bbb', [['p', ALICE], ['p', BOB]], 2000)
        const targets = followRelayTargets('listed', [ALT, NEU], [])
        const reads = [read(ALT, true, altListe), read(NEU, true, neuListe)]
        assert.equal(followListAnswered(reads, targets), true)
        assert.equal(winningFollowList(reads), neuListe, 'the newer copy wins; nothing was lost in between')
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
        assert.equal(outboxKnowledgeOf({ writeUrls: [OUTBOX], anyAnswered: false }), 'listed')
        assert.equal(outboxKnowledgeOf({ writeUrls: [OUTBOX], anyAnswered: true }), 'listed')
    })

    test('CORE confirmed-none: nothing declared, and at least one relay answered', () => {
        assert.equal(outboxKnowledgeOf({ writeUrls: [], anyAnswered: true }), 'confirmed-none')
    })

    test('CORE unknown: nothing declared and NOBODY answered — NOT the same thing', () => {
        // This is the whole F2 finding. The two cases above and below differ by one
        // boolean, and before the repair they were one value.
        assert.equal(outboxKnowledgeOf({ writeUrls: [], anyAnswered: false }), 'unknown')
    })

    test('the three are distinct values, so a caller cannot collapse two by accident', () => {
        const alle = [
            outboxKnowledgeOf({ writeUrls: [OUTBOX], anyAnswered: true }),
            outboxKnowledgeOf({ writeUrls: [], anyAnswered: true }),
            outboxKnowledgeOf({ writeUrls: [], anyAnswered: false }),
        ]
        assert.equal(new Set(alle).size, 3, `expected three distinct verdicts, got ${JSON.stringify(alle)}`)
    })
})

/**
 * **K7: one answer is enough to conclude „no relay list", and never enough to write.**
 *
 * Two questions that look alike and are not. {@link anyRelayAnswered} decides WHICH relays
 * to use; {@link followListAnswered} decides whether they may be REPLACED. Only the second
 * is the F1 riegel, and it is untouched — the cases below assert both halves next to each
 * other precisely so nobody reads the loosening as reaching further than it does.
 *
 * The bar moved because the strict form had a measured price and no longer had its
 * benefit. Its benefit was gone with K4: a wrong `confirmed-none` no longer plants a stub
 * on a relay nobody reads, it picks the fallback set — which, base and target being the
 * same set, is read completely first. Its price was live: `relay.damus.io` answered HTTP
 * 521 on three consecutive probes, and under `allAnswered` that alone locked out every
 * member without a kind 10002.
 */
describe('K7: the relay-list verdict needs ONE answer, the write still needs all', () => {
    test('CORE: one answering relay is enough to conclude „this reader declared none"', () => {
        const reads = [read(OUTBOX, true, null), read(OUTBOX_2, false, null)]
        assert.equal(anyRelayAnswered(reads), true)
        assert.equal(outboxKnowledgeOf({ writeUrls: [], anyAnswered: anyRelayAnswered(reads) }), 'confirmed-none')
    })

    test('CORE: no answer at all is still `unknown` — the fail-closed edge is unchanged', () => {
        const reads = [read(OUTBOX, false, null), read(OUTBOX_2, false, null)]
        assert.equal(anyRelayAnswered(reads), false)
        assert.equal(outboxKnowledgeOf({ writeUrls: [], anyAnswered: anyRelayAnswered(reads) }), 'unknown')
    })

    test('CORE: an empty ask set answers nothing — a deployment without indexers cannot follow', () => {
        assert.equal(anyRelayAnswered([]), false)
        assert.equal(outboxKnowledgeOf({ writeUrls: [], anyAnswered: anyRelayAnswered([]) }), 'unknown')
    })

    test('CORE: the WRITE gate is untouched — one answer there is still not enough', () => {
        // The same two reads that are enough to pick a relay set are NOT enough to
        // replace what those relays hold. If this ever goes green, the loosening has
        // leaked from the question it was meant for into the one it was not.
        const reads = [read(OUTBOX, true, null), read(OUTBOX_2, false, null)]
        assert.equal(followListAnswered(reads, [OUTBOX, OUTBOX_2]), false)
    })
})

/**
 * **ACCEPTED RISK — this case DOCUMENTS a hole, it does not close one.**
 *
 * Read it as a record of a decision, not as a guarantee. It asserts the damaging outcome
 * on purpose, the same way the P1 defect case did before P2 repaired it.
 *
 * The situation: a reader whose kind 10002 happens to be unfindable at this moment, and
 * whose real contact list sits on a relay that is in none of the fallback relays. Every
 * fallback relay answers and holds nothing, so the merge base is legitimately `null`, and
 * a one-entry kind 3 is written to the fallback set. If the reader's declared relays later
 * overlap that set, the stub wins the NIP-01 comparison there.
 *
 * **Why it is accepted rather than fixed.** Closing it means going back to „every asked
 * relay must answer", and that was measured to lock the feature out entirely whenever one
 * of three third-party indexers is down — which was the case on the day this was written.
 * The remaining exposure is narrow: it needs the relay list to be unfindable AND the
 * contact list to be absent from every fallback relay, and three of the four default
 * relays were measured serving a real 704-tag list.
 *
 * **What would change the decision:** if a fallback relay stops serving kind 3, or if the
 * ask set shrinks to one relay, this narrows to almost nothing and the case should be
 * re-argued rather than kept.
 */
describe('ACCEPTED RISK, not a guarantee: no list on any fallback relay yields a stub', () => {
    const FERN = 'wss://never-asked.example/'
    const echteListe = idList('aaa', [['p', ALICE], ['p', BOB], ['t', 'bitcoin']], 1000)

    test('DOCUMENTED: the fallback relays answer, hold nothing, and a one-entry list is built', () => {
        const targets = followRelayTargets('confirmed-none', [], [FALLBACK, FALLBACK_2])
        const reads = targets.map((url) => read(url, true, null))
        const plan = planFollowWrite({
            list: winningFollowList(reads),
            listAnswered: followListAnswered(reads, targets),
            target: ALICE,
            self: ME,
            add: true,
            spaceKind: 'other',
            knownContactCount: 0, knownContentNonEmpty: false,
        })
        assert.ok(plan, 'every target answered, so the gate does not stand in the way here')
        assert.deepEqual(
            plan.tags,
            [['p', ALICE]],
            'ONE entry — this is the accepted risk, asserted so that it cannot change unnoticed',
        )
        assert.equal(plan.content, '', 'and no legacy relay map, because there was no list to carry one from')
    })

    test('DOCUMENTED: the real list on a never-asked relay is untouched — the loss is deferred, not immediate', () => {
        // The stub does not reach the relay that holds the list, so nothing is destroyed
        // in this session. It becomes a loss only if a later session reads both.
        const targets = followRelayTargets('confirmed-none', [], [FALLBACK])
        assert.ok(!targets.includes(FERN), 'the relay that actually holds the list is not written to')
        assert.equal(followedPubkeysOf(echteListe).length, 2, 'it still has both contacts after this session')
    })

    test('CALIBRATION: with the list present on ONE fallback relay, no stub is produced', () => {
        // The ordinary case, and the reason the risk is narrow: a wrong verdict extends
        // the real list instead of inventing one.
        const targets = followRelayTargets('confirmed-none', [], [FALLBACK, FALLBACK_2])
        const reads = targets.map((url) => read(url, true, url === FALLBACK ? echteListe : null))
        const plan = planFollowWrite({
            list: winningFollowList(reads),
            listAnswered: followListAnswered(reads, targets),
            target: BOB,
            self: ME,
            add: false,
            spaceKind: 'other',
            knownContactCount: 0, knownContentNonEmpty: false,
        })
        assert.ok(plan)
        assert.deepEqual(plan.tags, [['p', ALICE], ['t', 'bitcoin']], 'the real list minus one, not a stub')
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
            knownContactCount: 0, knownContentNonEmpty: false,
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
            knownContactCount: 0, knownContentNonEmpty: false,
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
    const basis = { list: list([]), listAnswered: true, target: ALICE, self: ME, add: true, spaceKind: 'other' as const, knownContactCount: 0, knownContentNonEmpty: false }

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

/**
 * **K8 — THE FLOOR, and the whole point of this round.**
 *
 * Five findings on this path (F1, F2, N1, F5, F6) ended in one and the same state: a base
 * of `null` or a truncated one while `listAnswered` is `true`, a one-entry kind 3, written
 * to relays that hold the real list. Each was repaired at its own entrance, and each time
 * a new entrance turned up. This block asserts the EXIT instead.
 *
 * Every case below reproduces one of the known routes with its own inputs — the route is
 * not simulated, it is reconstructed from the shape it leaves behind — and asserts that no
 * event body comes out. The route that nobody has found yet leaves the same shape, which
 * is the only reason this is worth having.
 *
 * The calibration at the end is not decoration: without it, „refused" would also be true
 * of a floor that refuses everything, and every case above it would prove nothing.
 */
describe('K8: the floor refuses the RESULT, whatever the route to it was', () => {
    const HOCHSTAND = 700

    /** The reader's real list, shortened; only the COUNT matters to this rule. */
    const echt = (n: number): FollowEventLike =>
        idList('aaa', Array.from({ length: n }, (_, i) => ['p', `${i}`.padStart(64, '0')]), 1000)

    const plan = (over: Partial<Parameters<typeof planFollowWrite>[0]>) => planFollowWrite({
        list: null,
        listAnswered: true,
        target: ALICE,
        self: ME,
        add: true,
        spaceKind: 'other',
        knownContactCount: HOCHSTAND,
        knownContentNonEmpty: false,
        ...over,
    })

    test('CORE route F1: an incomplete answer left the base empty — refused', () => {
        // One relay answered and held nothing while the holders stayed silent. The verdict
        // gate catches this one too; the floor catches it a second time, on its own.
        assert.equal(plan({ list: null, listAnswered: true }), null)
    })

    test('CORE route F5: `isDeleted` suppressed every event, so the base is null — refused', () => {
        // The shape this leaves is indistinguishable from F1 at the plan: `answered: true`,
        // zero events. That is exactly why the floor does not ask how it got here.
        assert.equal(plan({ list: null, listAnswered: true, add: true }), null)
    })

    test('CORE route F6: `listed` targets that hold nothing — refused', () => {
        const targets = followRelayTargets('listed', [OUTBOX, OUTBOX_2], [])
        const reads = targets.map((url) => read(url, true, null))
        assert.equal(followListAnswered(reads, targets), true, 'CALIBRATION: the verdict gate is satisfied here')
        assert.equal(
            plan({ list: winningFollowList(reads), listAnswered: followListAnswered(reads, targets) }),
            null,
            'the declared write relays are what the outbox model points every other client at',
        )
    })

    test('CORE route confirmed-none: the fallback relays hold nothing — refused', () => {
        const targets = followRelayTargets('confirmed-none', [], [FALLBACK, FALLBACK_2])
        const reads = targets.map((url) => read(url, true, null))
        assert.equal(
            plan({ list: winningFollowList(reads), listAnswered: followListAnswered(reads, targets) }),
            null,
            'this is the ACCEPTED RISK from the previous round. The floor catches it ONLY on a device that has '
                + 'already seen the real list — with mark 0 (fresh profile, second device, cleared site data, '
                + 'private window, unreadable storage) this plan is produced exactly as asserted here.',
        )
    })

    test('CORE: a remove that would drop more than one entry — refused', () => {
        // A truncated base with a real high-water mark: unfollowing one person from a list
        // of three would leave two where 699 are expected.
        assert.equal(plan({ list: echt(3), add: false, target: '0'.padStart(64, '0') }), null)
    })

    test('CORE: an add may never shrink — the boundary is exact, not generous', () => {
        // From one below the mark an add lands exactly ON it, so it passes: following
        // somebody has to remain possible right after a legitimate unfollow.
        assert.ok(plan({ list: echt(HOCHSTAND - 1), add: true }), 'base 699 + one = 700, which meets the mark')
        // From two below it cannot reach the mark, and that is a shrink.
        assert.equal(plan({ list: echt(HOCHSTAND - 2), add: true }), null, 'base 698 + one = 699 < 700')
    })

    test('CALIBRATION: a legitimate add goes through', () => {
        const written = plan({ list: echt(HOCHSTAND), add: true })
        assert.ok(written, 'following somebody from a complete base must still work')
        assert.equal(followedPubkeysIn(written.tags).length, HOCHSTAND + 1)
    })

    test('CALIBRATION: a legitimate remove goes through, and takes exactly one', () => {
        const written = plan({ list: echt(HOCHSTAND), add: false, target: '0'.padStart(64, '0') })
        assert.ok(written, 'unfollowing from a complete base must still work')
        assert.equal(followedPubkeysIn(written.tags).length, HOCHSTAND - 1)
    })

    test('CALIBRATION: an identity with no history refuses nothing — a first write must pass', () => {
        const written = plan({ list: null, knownContactCount: 0 })
        assert.ok(written, 'the floor can only be as informed as this reader\'s own history')
        assert.deepEqual(written.tags, [['p', ALICE]])
    })

    test('the rule itself, both directions, at the exact boundary', () => {
        // An `add` targets somebody NOT in the base (so the count rises by one); a
        // `remove` targets somebody who IS (so it falls by one). Using an absent target
        // for a remove would measure the no-op case, which `sameTags` already refuses —
        // and it is how the first draft of this case got its arithmetic wrong.
        const drin = '0'.padStart(64, '0')
        const bei = (n: number, add: boolean, known: number): boolean =>
            followWriteShrinksBelowKnown({
                list: echt(n), listAnswered: true, target: add ? ALICE : drin, self: ME, add,
                spaceKind: 'other', knownContactCount: known, knownContentNonEmpty: false,
            })
        assert.equal(bei(10, true, 10), false, 'add from the mark: 11 ≥ 10')
        assert.equal(bei(9, true, 10), false, 'add from one below lands ON the mark: 10 ≥ 10')
        assert.equal(bei(8, true, 10), true, 'add from two below cannot reach it: 9 < 10')
        assert.equal(bei(10, false, 10), false, 'remove from the mark: 9 ≥ 9')
        assert.equal(bei(9, false, 10), true, 'remove from one below: 8 < 9')
    })
})

/**
 * **F7: a page load asks only relays the reader chose.**
 *
 * The write path is unaffected — the first click while `listSeen` is `false` has been a
 * read and never a write since P1, so deferring the read defers nothing but the label.
 */
describe('armingReadsContactList: who gets asked on a page load', () => {
    test('CORE: `listed` — the reader\'s own declared relays, asked at arming', () => {
        assert.equal(armingReadsContactList('listed'), true)
    })

    test('CORE: `confirmed-none` — four foreign relays, NOT asked until the reader acts', () => {
        assert.equal(armingReadsContactList('confirmed-none'), false)
    })

    test('`unknown` has no set to ask either way', () => {
        assert.equal(armingReadsContactList('unknown'), false)
    })
})

/**
 * **D1 — THE unfollow run, and the core proof of this round.**
 *
 * The first version of the floor was monotone upwards, which makes ordinary unfollowing
 * impossible: the mark stays at the old count, so the second unfollow in a row falls below
 * `mark − 1` and is refused. Measured end to end over the real gate with 20 contacts:
 * one unfollow through, the next two refused, an add restoring the count, and only then a
 * fourth unfollow working. **At most one unfollow per follow.**
 *
 * That is not the mass-cleanup case the docblock claimed as the price — it is „unfollow A
 * on Monday, B on Tuesday" — and the refusal text told the reader to retry something that
 * could never succeed.
 *
 * The repair: a write this client made itself sets the mark to what it published. Reads
 * still only raise it. This case walks the measured sequence step by step and asserts the
 * outcome of each; without the lowering, steps 2, 3 and 6 go red.
 */
describe('D1: unfollowing twice in a row is not a defect', () => {
    const kontakt = (i: number): string => `${i}`.padStart(64, '0')
    const liste = (n: number, id = 'aaa'): FollowEventLike =>
        idList(id, Array.from({ length: n }, (_, i) => ['p', kontakt(i)]), 1000)

    /** The store, as `js/follows.ts` keeps it: reads raise, a confirmed write sets. */
    const laufen = (schritte: ReadonlyArray<{ add: boolean; ziel: string }>) => {
        let mark = 20
        let stand = 20
        const ergebnis: string[] = []
        for (const schritt of schritte) {
            const basis = liste(stand)
            // A complete read raises the mark to what the relays showed — never lowers it.
            mark = Math.max(mark, followedPubkeysOf(basis).length)
            const plan = planFollowWrite({
                list: basis,
                listAnswered: true,
                target: schritt.ziel,
                self: ME,
                add: schritt.add,
                spaceKind: 'other',
                knownContactCount: mark,
                knownContentNonEmpty: false,
            })
            if (!plan) {
                ergebnis.push('REFUSED')
                continue
            }
            stand = followedPubkeysIn(plan.tags).length
            mark = stand
            ergebnis.push(`written(${stand})`)
        }

        return ergebnis
    }

    test('CORE: six steps, remove/remove/remove/add/remove/remove — every one of them lands', () => {
        assert.deepEqual(
            laufen([
                { add: false, ziel: kontakt(0) },
                { add: false, ziel: kontakt(1) },
                { add: false, ziel: kontakt(2) },
                { add: true, ziel: ALICE },
                { add: false, ziel: kontakt(3) },
                { add: false, ziel: kontakt(4) },
            ]),
            ['written(19)', 'written(18)', 'written(17)', 'written(18)', 'written(17)', 'written(16)'],
            'the measured failure was written(19), REFUSED, REFUSED, written(20), written(19) — at most one '
                + 'unfollow per follow, for an ordinary reader with no defect anywhere',
        )
    })

    test('CORE: the floor is still there — a truncated base is refused at every step', () => {
        // The same run, but each step reads a base of one. Nothing may be written.
        let mark = 20
        for (let i = 0; i < 6; i += 1) {
            const plan = planFollowWrite({
                list: liste(1),
                listAnswered: true,
                target: ALICE,
                self: ME,
                add: true,
                spaceKind: 'other',
                knownContactCount: mark,
                knownContentNonEmpty: false,
            })
            assert.equal(plan, null, `step ${i + 1}: a base of one must never be written over a mark of ${mark}`)
        }
    })

    test('CALIBRATION: without the lowering the second unfollow is refused', () => {
        // The bug, reconstructed: mark frozen at 20 while the list shrinks.
        const plan = planFollowWrite({
            list: liste(19),
            listAnswered: true,
            target: kontakt(1),
            self: ME,
            add: false,
            spaceKind: 'other',
            knownContactCount: 20,
            knownContentNonEmpty: false,
        })
        assert.equal(plan, null, 'this is exactly what D1 measured, and why the mark has to be able to come down')
    })
})

/**
 * **D5 — the second half of the floor: a `content` we know about, going out empty.**
 *
 * The count cannot see this. `content` is the legacy relay map some clients still read;
 * this client carries it byte for byte and must not decide about it, so an empty `content`
 * in a plan means the base was empty **or the base was missing** — and the missing base is
 * the failure class this whole module keeps landing in.
 */
describe('D5: blanking a known content is refused', () => {
    const mitInhalt = (tags: string[][], content: string): FollowEventLike =>
        ({ id: 'aaa', kind: FOLLOWS, pubkey: ME, created_at: 1000, tags, content })

    const eingabe = (list: FollowEventLike | null, knownContentNonEmpty: boolean) => ({
        list, listAnswered: true, target: ALICE, self: ME, add: true,
        spaceKind: 'other' as const, knownContactCount: 0, knownContentNonEmpty,
    })

    test('CORE: a missing base while the content is known non-empty — refused', () => {
        assert.equal(followWriteBlanksKnownContent(eingabe(null, true)), true)
        assert.equal(planFollowWrite(eingabe(null, true)), null)
    })

    test('CORE: the count would NOT have caught this — the floor needs both halves', () => {
        // Mark 0, so the shrink rule waves it through; only the content rule refuses.
        assert.equal(followWriteShrinksBelowKnown(eingabe(null, true)), false)
    })

    test('a base that carries the content through is written', () => {
        const plan = planFollowWrite(eingabe(mitInhalt([['p', BOB]], '{"wss://a/":{"read":true}}'), true))
        assert.ok(plan)
        assert.equal(plan.content, '{"wss://a/":{"read":true}}', 'byte for byte, as the module header requires')
    })

    test('a reader whose content was legitimately blanked elsewhere is NOT locked out', () => {
        // The flag falls on the next complete read, so this is a guard and not a dead end.
        assert.ok(planFollowWrite(eingabe(mitInhalt([['p', BOB]], ''), false)))
    })

    test('nothing known about the content: nothing refused', () => {
        assert.equal(followWriteBlanksKnownContent(eingabe(null, false)), false)
    })
})

/**
 * **Variant (b) — the way back out of the floor, and its four locks.**
 *
 * A monotone floor and a mass unfollow on another device are mutually exclusive: after
 * tidying up on a phone from 700 to 50, the desktop refuses both directions forever, and
 * because it cannot write, the mark never comes down either. That is the same class of
 * dead end as the one that broke ordinary unfollowing, one level further out.
 *
 * The way out is deliberately narrow. Every source of the round must have answered, every
 * one must have delivered a list, they must all agree on the count, and there must be at
 * least two of them. The counter-probes below take away one condition each — the point of
 * having them separately is that each of the five findings on this path fails a DIFFERENT
 * one, so loosening any single condition re-opens a different door.
 */
describe('floorAfterRead: the floor comes down only on a unanimous, complete round', () => {
    const liste = (n: number, id = 'aaa'): FollowEventLike =>
        idList(id, Array.from({ length: n }, (_, i) => ['p', `${i}`.padStart(64, '0')]), 1000)

    const quelle = (url: string, answered: boolean, held: FollowEventLike | null): FollowRelayRead =>
        ({ url, answered, list: held })

    test('CORE: the foreign-device chain — 700 down to 50, and the next follow goes through', () => {
        const runde = [
            quelle(OUTBOX, true, liste(50, 'aaa')),
            quelle(OUTBOX_2, true, liste(50, 'bbb')),
            quelle(FALLBACK, true, liste(50, 'ccc')),
        ]
        const boden = floorAfterRead(runde, 700)
        assert.equal(boden, 50, 'every source answered, every one held a list, all agree, and 50 < 700')

        const plan = planFollowWrite({
            list: liste(50),
            listAnswered: true,
            target: ALICE,
            self: ME,
            add: true,
            spaceKind: 'other',
            knownContactCount: boden,
            knownContentNonEmpty: false,
        })
        assert.ok(plan, 'without the lowering this is refused, and the reader is locked out for good')
        assert.equal(followedPubkeysIn(plan.tags).length, 51)
    })

    test('COUNTER-PROBE (1): one source did not answer — no lowering', () => {
        // The F1 shape. The silent one is exactly the relay that might hold the real list.
        const runde = [
            quelle(OUTBOX, true, liste(50, 'aaa')),
            quelle(OUTBOX_2, false, liste(50, 'bbb')),
            quelle(FALLBACK, true, liste(50, 'ccc')),
        ]
        assert.equal(floorAfterRead(runde, 700), 700)
    })

    test('COUNTER-PROBE (2): one source delivered nothing — no lowering', () => {
        // The F5 shape: `EOSE` arrives, the events do not. „Delivered nothing" and
        // „delivered an empty list" are different answers, and only the second one counts.
        const runde = [
            quelle(OUTBOX, true, liste(50, 'aaa')),
            quelle(OUTBOX_2, true, null),
            quelle(FALLBACK, true, liste(50, 'ccc')),
        ]
        assert.equal(floorAfterRead(runde, 700), 700)
    })

    test('COUNTER-PROBE (3): the sources disagree — no lowering, and the ORDER does not decide', () => {
        // The F6/B2 shape: the targets carry the real list, a read-only hint carries a
        // newer one-entry stub. It must not lower the floor and must not raise it to 1.
        const echt = liste(700, 'aaa')
        const stub = idList('zzz', [['p', ALICE]], 2000)
        assert.equal(floorAfterRead([quelle(OUTBOX, true, echt), quelle(FALLBACK, true, stub)], 700), 700)
        // **Both orders, and that is not symmetry for its own sake.** With the agreement
        // check removed, the version above still passes — `counts[0]` happens to be 700,
        // and 700 is not below the floor. Only the small-first order exposes it. Measured:
        // the mutation that drops `new Set(counts).size === 1` left the one-sided case
        // green, which is how a counter-probe can assert the right thing for the wrong
        // reason.
        assert.equal(floorAfterRead([quelle(FALLBACK, true, stub), quelle(OUTBOX, true, echt)], 700), 700)
        const klein = liste(50, 'ccc')
        assert.equal(
            floorAfterRead([quelle(FALLBACK, true, klein), quelle(OUTBOX, true, echt)], 700),
            700,
            'a small list first and a large one second must not lower the floor to the small one',
        )
    })

    test('COUNTER-PROBE (4): the agreed count is LARGER — the raising rule takes over', () => {
        const runde = [quelle(OUTBOX, true, liste(900, 'aaa')), quelle(FALLBACK, true, liste(900, 'bbb'))]
        assert.equal(floorAfterRead(runde, 700), 900, 'a unanimous larger round raises, it does not "lower to" it')
    })

    test('COUNTER-PROBE (4b): a single source can never lower, however unanimous it is with itself', () => {
        assert.equal(floorAfterRead([quelle(OUTBOX, true, liste(50))], 700), 700)
        assert.equal(MIN_SOURCES_TO_LOWER, 2, 'the fourth condition, named')
    })

    test('a round with nothing at all leaves the floor untouched', () => {
        assert.equal(floorAfterRead([], 700), 700)
        assert.equal(floorAfterRead([quelle(OUTBOX, true, null), quelle(FALLBACK, true, null)], 700), 700)
    })

    test('an empty list IS a list — a reader who follows nobody can say so unanimously', () => {
        // Two sources, both answering, both handing over a real kind 3 with zero `p` tags.
        const leer = idList('aaa', [['t', 'bitcoin']], 1000)
        assert.equal(
            floorAfterRead([quelle(OUTBOX, true, leer), quelle(FALLBACK, true, { ...leer, id: 'bbb' })], 700),
            0,
        )
    })
})
