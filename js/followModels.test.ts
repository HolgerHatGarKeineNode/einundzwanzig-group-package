import test, { describe } from 'node:test'
import assert from 'node:assert/strict'
import { RELAYS } from '@welshman/util'
import { RelayListReader } from '@welshman/domain'
import {
    FOLLOWS,
    anyRelayAnswered,
    armingReadsContactList,
    declaredWriteRelaysOf,
    followedPubkeysIn,
    followedPubkeysOf,
    followListAnswered,
    followListWins,
    followRelayTargets,
    followWriteConfirmed,
    isFollowPersonTag,
    newestOwnEvent,
    noFollowTargets,
    normalizeRelaySet,
    outboxKnowledgeOf,
    ownFollowList,
    followBaseId,
    planFollowWrite,
    unansweredRelays,
    winningFollowList,
    withFollowedPubkeys,
    withoutFollowedPubkey,
    type FollowEventLike,
    type FollowPlanInput,
    type FollowRelayRead,
    type FollowTargetSet,
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
const CAROL = 'd'.repeat(64)

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

    /**
     * **A4: the set that comes out never aliases anything the caller still holds — and the
     * review's version of this finding does not reproduce.**
     *
     * The finding as it was handed down had two halves: that
     * `followRelayTargets('listed', [a, b], [])` hands back the caller's own array, and
     * that `readonly` is a statement about a type rather than a guard on a value. The
     * second half is true and worth keeping in mind. **The first half is not**, and it was
     * measured rather than argued: at `9ff152a`, before `mintTargetSet` copied anything,
     *
     *     followRelayTargets('listed', declared, []) === declared   // false
     *     declared.push('wss://attacker.example/')                  // targets stays at two
     *
     * because {@link normalizeRelaySet} sits in the path and allocates a fresh array on
     * every call. So there was nothing to exploit, and this case passes at `9ff152a`
     * exactly as it does here. The reporting review has since withdrawn the claim: both
     * call sites of `mintTargetSet` allocate, and it is not exported, so there was no third
     * one to find.
     *
     * **Which makes this a DOUBLY secured assurance, and that is why the case is written
     * about the contract rather than about the copy.** Two independent allocations uphold
     * it — `normalizeRelaySet` and, since the copy in `mintTargetSet`, the mint itself.
     * Removing either one alone leaves this green; removing both turns it red. Measured
     * both ways, and the second step is the one that shows the copy carries anything at
     * all. The copy is kept because the invariant then belongs to the function that hands
     * the value out, instead of depending on a helper further up continuing to allocate.
     */
    test('CORE: the minted set is a COPY — mutating the source afterwards cannot widen it', () => {
        const declared = [OUTBOX, OUTBOX_2]
        const targets = followRelayTargets('listed', declared, [])
        declared.push(FALLBACK)
        assert.deepEqual(
            [...targets],
            [OUTBOX, OUTBOX_2],
            'the caller still holds a handle on the array the target set is made of. A push through it widens a '
                + 'set the type says is readonly, and both the completeness verdict and the write follow it.',
        )
        // The same for the empty set, handed out at every early exit of `readOwnFollowList`:
        // two callers must not end up holding one array between them, or a mutation through
        // either reaches the other.
        assert.notEqual(
            noFollowTargets(),
            noFollowTargets(),
            'two calls of noFollowTargets() returned the SAME array. One caller mutating it at runtime then '
                + 'widens the target set of an unrelated read.',
        )
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
    const sitzung1 = (): { targets: FollowTargetSet; plan: ReturnType<typeof planFollowWrite> } => {
        const targets = followRelayTargets('confirmed-none', [], [RELAY_A])
        // Every target answered; relay A holds the real list, because that is where the
        // reader's client put it.
        const reads = targets.map((url) => read(url, true, url === RELAY_A ? echteListe : null))

        return {
            targets,
            plan: planFollowWrite({
                list: winningFollowList(reads),
                listAnswered: followListAnswered(reads, targets),
                shownBase: null,
                target: BOB,
                self: ME,
                add: false,
                spaceKind: 'other',
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
 * **ACCEPTED RISK — these cases DOCUMENT a hole, they do not close one.**
 *
 * Read them as a record of a decision, not as a guarantee. They assert the damaging
 * outcome on purpose, the same way the P1 defect case did before P2 repaired it.
 *
 * **Restated after the high-water floor was removed.** For a while a per-identity contact
 * count stood underneath this, so the stub below was refused on any device that had seen
 * the real list. That floor is gone: it was the only fail-open element left on this path
 * and it produced three dead ends of its own — one unfollow per follow, a lock-out after a
 * mass unfollow on another device, and a permanent refusal after one degraded read. What
 * catches a truncated base now is named below, and nothing else does.
 *
 * ── The situation, in BOTH branches ───────────────────────────────────────────
 *
 * A reader whose real contact list is not on the relays this operation asks. Every asked
 * relay answers and holds nothing, so the merge base is legitimately `null` and a
 * one-entry kind 3 goes to the asked set. Which set that is depends on
 * {@link OutboxKnowledge}, and the two branches are NOT equally bad:
 *
 * | branch | where the one-tag stub lands | how far the damage reaches |
 * |---|---|---|
 * | `confirmed-none` | the four fallback relays, which this reader never chose | **deferred** — the relays holding the real list are not written to, and the loss happens only if a later session reads both and the stub wins the NIP-01 comparison |
 * | `listed` | the reader's **own, announced write relays** | **immediate and global** — those are precisely the addresses NIP-65 points every other client at, so every reader of this profile now sees a contact list of one |
 *
 * The `listed` branch is the heavier of the two and it is the one this file lost when the
 * floor came out: `CORE route F6: 'listed' targets that hold nothing — refused` asserted a
 * refusal that no longer happens. It is back below, as a record and not as a promise.
 *
 * ── What stands in the way, precisely — and what does not ─────────────────────
 *
 * | holds | does not hold |
 * |---|---|
 * | `followListAnswered` with `every`: one silent target and nothing is written at all | it cannot tell „answered and holds nothing" from „answered and holds the list" |
 * | `OutboxKnowledge.unknown`: no relay list resolvable ⇒ no target set ⇒ no write | once `confirmed-none` is reached, the fallback set is used whatever it holds |
 * | `FOLLOW_BASE_HINT_RELAYS` as an extra read-only source: in the `listed` branch it asks four relays the targets do not | **it covers the `listed` branch only if the real list happens to sit on one of those four.** A reader whose list lives solely on their own relays gets nothing from it — and for `confirmed-none` the hints ARE the targets, so there it adds no source at all |
 * | `content` is carried over byte for byte | when the base is missing there is no `content` to carry, and it goes out empty |
 *
 * So the honest summary is: **a complete answer from relays that genuinely hold nothing is
 * indistinguishable from a complete answer from a reader who follows nobody, and this
 * client writes the same event in both cases.** That is the residual exposure of the whole
 * phase, in one sentence.
 *
 * ── Why it is accepted rather than closed ─────────────────────────────────────
 *
 * Every mechanism tried against it either refused legitimate writes (the floor, three dead
 * ends) or locked the feature out entirely when a third-party relay was down („every asked
 * relay must answer" — measured while `relay.damus.io` returned HTTP 521). The exposure
 * itself is narrow: it needs the relay list to be unfindable AND the contact list to be
 * absent from every fallback relay, and three of the four default relays were measured
 * serving a real 704-tag list on 2026-09-14.
 *
 * **What would change the decision:** a fallback relay that stops serving kind 3, an ask
 * set that shrinks to one relay, or a way to tell „this relay has no list for you" from
 * „this relay has nothing for anybody" — the last one would close it outright.
 */
describe('ACCEPTED RISK, not a guarantee: relays that answer and hold nothing yield a stub', () => {
    const FERN = 'wss://never-asked.example/'
    const echteListe = idList('aaa', [['p', ALICE], ['p', BOB], ['t', 'bitcoin']], 1000)

    test('DOCUMENTED: `confirmed-none` — the fallback relays answer, hold nothing, a one-entry list is built', () => {
        const targets = followRelayTargets('confirmed-none', [], [FALLBACK, FALLBACK_2])
        const reads = targets.map((url) => read(url, true, null))
        const plan = planFollowWrite({
            list: winningFollowList(reads),
            listAnswered: followListAnswered(reads, targets),
            shownBase: null,
            targets: [ALICE],
            self: ME,
            add: true,
            spaceKind: 'other',
        })
        assert.ok(plan, 'every target answered, so the gate does not stand in the way here')
        assert.deepEqual(
            plan.tags,
            [['p', ALICE]],
            'ONE entry — this is the accepted risk, asserted so that it cannot change unnoticed',
        )
        assert.equal(plan.content, '', 'and no legacy relay map, because there was no list to carry one from')
    })

    test('DOCUMENTED: the `listed` branch writes the stub to the reader\'s OWN announced relays', () => {
        // Restored from `CORE route F6` at 657dd5c, with the verdict turned around: there
        // it asserted `null`, because the high-water floor refused. Nothing refuses now.
        const targets = followRelayTargets('listed', [OUTBOX, OUTBOX_2], [])
        const reads = targets.map((url) => read(url, true, null))
        assert.equal(followListAnswered(reads, targets), true, 'CALIBRATION: the completeness gate is satisfied')
        const plan = planFollowWrite({
            list: winningFollowList(reads),
            listAnswered: followListAnswered(reads, targets),
            shownBase: null,
            targets: [ALICE],
            self: ME,
            add: true,
            spaceKind: 'other',
        })
        assert.ok(plan, 'and a plan is produced — this branch has no refusal left in it either')
        assert.deepEqual(plan.tags, [['p', ALICE]], 'one entry, on the relays the outbox model advertises')
        assert.deepEqual(
            [...targets],
            [OUTBOX, OUTBOX_2],
            'the targets ARE the declared write relays, which is why this branch is the heavier one: the loss is '
                + 'not deferred to a later session, it is visible to every client that follows NIP-65 immediately',
        )
        // And the hints do not save it: they are four foreign relays, and this reader's
        // list is on neither of them.
        const hintReads = [read(FALLBACK, true, null), read(FALLBACK_2, true, null)]
        assert.equal(
            winningFollowList([...reads, ...hintReads]),
            null,
            'the read-only sources raise the base only when the list is on one of THEM. Here it is not, and the '
                + 'mitigation row above says so.',
        )
    })

    test('DOCUMENTED: what the removed floor used to catch here, and no longer does', () => {
        // Kept as an explicit record: until this round a per-identity high-water mark
        // refused this write on any device that had seen the real list. Nothing takes its
        // place — the assertion above IS the current behaviour, on every device.
        const targets = followRelayTargets('confirmed-none', [], [FALLBACK, FALLBACK_2])
        const reads = targets.map((url) => read(url, true, null))
        assert.equal(followListAnswered(reads, targets), true, 'the completeness verdict is satisfied…')
        assert.equal(winningFollowList(reads), null, '…and the base is still null. That pair is the whole hole.')
    })

    test('DOCUMENTED: in `confirmed-none` the real list is on a never-asked relay — the loss is deferred', () => {
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
            shownBase: null,
            target: BOB,
            self: ME,
            add: false,
            spaceKind: 'other',
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
            shownBase: null,
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
            shownBase: null,
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
        const nachher = withFollowedPubkeys(vorher, [BOB], ME)
        assert.deepEqual(nachher[0], ['p', BOB], 'the new entry is first — and carries no invented relay hint')
        assert.deepEqual(nachher.slice(1), vorher, 'every existing tag survives, with its extra columns')
    })

    /**
     * **The single most important difference to the function P3 replaced.**
     *
     * `withFollowedPubkey([['p', ALICE, 'wss://relay/', 'ali']], ALICE)` answered
     * `[['p', ALICE]]` — it removed the entry and re-prepended it bare, so the relay hint
     * and the petname were gone. For one person that was a reordering nobody reached (the
     * store derives the direction from the list a relay just showed it). For „follow all
     * 400 members" of whom 380 are already followed it would be refusal 3 of the module
     * header, broken 380 times, in one signed event that looks like a success.
     */
    test('CORE: a target that is ALREADY followed changes nothing — hint and petname survive', () => {
        const vorher = [['p', ALICE, 'wss://relay/', 'ali']]
        assert.deepEqual(withFollowedPubkeys(vorher, [ALICE], ME), vorher)
    })

    test('CORE: the same person twice in one set is added ONCE', () => {
        assert.deepEqual(withFollowedPubkeys([], [BOB, BOB, BOB], ME), [['p', BOB]])
    })

    test('CORE: new entries keep the order they were given, in front of the base', () => {
        assert.deepEqual(
            withFollowedPubkeys([['t', 'bitcoin']], [ALICE, BOB], ME),
            [['p', ALICE], ['p', BOB], ['t', 'bitcoin']],
        )
    })

    test('CORE: the reader\'s own key and an empty entry drop out — the rest is still added', () => {
        assert.deepEqual(withFollowedPubkeys([], [ME, '', BOB], ME), [['p', BOB]])
    })

    test('CORE: a self entry the base already carries is left alone — removing it would shrink', () => {
        const vorher = [['p', ME], ['p', ALICE]]
        assert.deepEqual(withFollowedPubkeys(vorher, [ME, BOB], ME), [['p', BOB], ['p', ME], ['p', ALICE]])
    })

    test('an empty set of targets leaves the list exactly as it was', () => {
        const vorher = [['p', ALICE, 'wss://relay/', 'ali'], ['t', 'x']]
        assert.deepEqual(withFollowedPubkeys(vorher, [], ME), vorher)
    })

    test('unfollowing removes only that person — hint and petname of the others stay', () => {
        const nachher = withoutFollowedPubkey(
            [['p', ALICE, 'wss://relay/', 'ali'], ['t', 'x'], ['p', BOB]],
            BOB,
        )
        assert.deepEqual(nachher, [['p', ALICE, 'wss://relay/', 'ali'], ['t', 'x']])
    })
})

/**
 * The two arms of the direction, as two constants — a single `basis` with `add: boolean`
 * cannot exist any more, and that is the point of the union (see {@link FollowPlanDirection}
 * in `js/followModels.ts`): a bulk unfollow is not a flag away, it is an edit to that file.
 */
const basis = {
    list: list([]),
    listAnswered: true,
    targets: [ALICE],
    self: ME,
    add: true as const,
    spaceKind: 'other' as const,
    // The opt-out of the F1 binding: these cases are about the OTHER refusals, and most of
    // them override `list` in the spread — a fixture that bound the base would make every
    // one of them refuse for the new reason and prove nothing about the old ones. The
    // binding has cases of its own (below, and in `js/followPreviewBase.test.ts`).
    shownBase: null,
}

/**
 * The unfollow arm: one person, never a set.
 *
 * **The base carries `['p', ME]` on purpose (U1).** With an empty list every refusal of
 * this arm is satisfied by the no-op rule instead — `withoutFollowedPubkey([], x)` is `[]`,
 * `sameTags` fires, and the answer is `null` whatever the gate above decided. An audit
 * measured exactly that: at `bfbd7f1` the `input.target === self` condition could be deleted
 * and all 99 cases of this file stayed green. A fixture whose emptiness makes the assertions
 * true for the wrong reason is the cheapest way to lose a guard.
 */
const abbau = {
    list: list([['p', ME], ['p', ALICE]]),
    listAnswered: true,
    target: ALICE,
    self: ME,
    add: false as const,
    spaceKind: 'other' as const,
    // As in `basis`: the unfollow arm has no preview to bind to at all (`js/follows.ts`,
    // `toggle`), so `null` here is the production value and not a convenience.
    shownBase: null,
}

describe('planFollowWrite: the gate and the event body are ONE value', () => {
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

    /**
     * **The two arms answer the reader's own key differently, and that is deliberate.**
     *
     * Unfollow takes one target, so „unusable target" and „nothing to do" are one sentence
     * and refusing says it plainly. Follow is fed by the member directory, in which the
     * reader has a row of their own; refusing the whole set because of it would lock „follow
     * everybody" for exactly the members this feature exists for. What both arms hold is the
     * invariant the old refusal protected: self never becomes a NEW `p` tag.
     */
    test('CORE: unfollowing YOURSELF is refused — measured against a base that HOLDS the entry', () => {
        // The two calibrations come first, and without them this case proves nothing: they
        // say that removing self really would change the list, and that the same base with
        // an ordinary target does produce a body. Only then is the `null` below the gate.
        assert.deepEqual(
            followedPubkeysOf(abbau.list),
            [ME, ALICE],
            'CALIBRATION: the base carries self AND another entry, so a removal is a real change',
        )
        assert.ok(
            planFollowWrite({ ...abbau }),
            'CALIBRATION: the same base with an ordinary target writes — the gate is not simply closed',
        )

        assert.equal(
            planFollowWrite({ ...abbau, target: ME }),
            null,
            'without this the answer is a plan with one tag where the base had two — a shrink, from a click the '
                + 'reader never asked for',
        )
    })

    test('CORE: following a set that CONTAINS yourself adds the rest, and adds no self tag', () => {
        const plan = planFollowWrite({ ...basis, targets: [ME, ALICE, BOB] })
        assert.ok(plan, 'the reader\'s own row in the member directory must not lock the whole action')
        assert.deepEqual(plan.tags, [['p', ALICE], ['p', BOB]], 'self is dropped, the other two are added')
    })

    /**
     * The more important half of the pair: an entry the base already carries stays, whoever
     * it names. Removing it would be an event with fewer entries than the base — the one
     * outcome this module exists to prevent — and it would happen for a reason the reader
     * never asked for.
     */
    test('CORE: a self entry ALREADY on the list survives a bulk follow untouched', () => {
        const plan = planFollowWrite({ ...basis, list: list([['p', ME, 'wss://mine/', 'me']]), targets: [ME, BOB] })
        assert.ok(plan)
        assert.deepEqual(plan.tags, [['p', BOB], ['p', ME, 'wss://mine/', 'me']])
    })

    test('a guest has nothing to sign with', () => {
        assert.equal(planFollowWrite({ ...basis, self: '' }), null)
        assert.equal(planFollowWrite({ ...abbau, self: '' }), null)
    })

    /**
     * **The empty-target half of that refusal is redundant TODAY — pinned, not assumed (U1).**
     *
     * Measured: `withoutFollowedPubkey(base, '')` removes nothing, because
     * {@link isFollowPersonTag} demands a non-empty value. A malformed `['p','']` in
     * somebody's list therefore never matches an empty target, the plan ends at the no-op
     * rule anyway, and the guard cannot be shown red on its own. A guard nobody can turn red
     * is precisely the kind of assurance this module has already lost once.
     *
     * **It stays, and the reason sits one module away rather than in the abstract:** loosen
     * `isFollowPersonTag` to accept an empty value and an empty target starts removing every
     * `['p','']` a foreign client left behind — a shrink of the base. Measured on
     * 2026-09-14: removing the guard alone is harmless, loosening `isFollowPersonTag` alone
     * is harmless, doing both produces the shrink. The last assertion pins that coupling, so
     * „redundant" stays a measured statement with a date on it.
     */
    test('an empty target is refused — and why that refusal is currently redundant', () => {
        assert.equal(planFollowWrite({ ...abbau, target: '' }), null)
        assert.equal(planFollowWrite({ ...basis, targets: [''] }), null, 'and a set of nothing but blanks too')
        assert.equal(planFollowWrite({ ...basis, targets: [] }), null, 'as does an empty set')

        const malformed = [['p', ''], ['p', ALICE], ['p']]
        assert.deepEqual(
            withoutFollowedPubkey(malformed, ''),
            malformed,
            'an empty target matches no tag at all. If this ever changes, the refusal above stops being redundant '
                + 'and becomes the only thing between an empty target and the malformed entries of the base.',
        )
    })

    test('a write that changes nothing is refused — double click, or a second device first', () => {
        assert.equal(planFollowWrite({ ...basis, list: list([['p', ALICE]]) }), null)
        assert.equal(planFollowWrite({ ...abbau, list: list([['p', BOB]]) }), null)
    })

    test('unfollowing produces the list without that person', () => {
        const plan = planFollowWrite({ ...abbau, list: list([['p', ALICE], ['p', BOB]]) })
        assert.ok(plan)
        assert.deepEqual(plan.tags, [['p', BOB]])
    })

    test('CALIBRATION: the case above is only meaningful because the same input with `add` writes', () => {
        // Without this line "refused" would also be true for a gate that refuses
        // everything, and every refusal case above would prove nothing.
        assert.ok(planFollowWrite({ ...basis, list: list([['p', BOB]]) }))
    })
})

/**
 * **P3: n targets resolve in ONE pass, and the base is a suffix of the answer.**
 *
 * The phase exists because of a property of `makeEvent`, not because of a convenience:
 * `created_at` is stamped in SECONDS, so n writes inside the same second carry the same
 * timestamp, NIP-01 breaks the tie on the id, and the losers are dropped. Buzz reports a
 * dropped replaceable event as `OK true` with the message `duplicate:`
 * (`buzz/crates/buzz-relay/src/handlers/ingest.rs`), which every surface reads as success.
 * n calls would therefore be n events that displace each other, each holding the base plus
 * exactly one entry — „follow 400" ending at 399 lost, reported green.
 */
describe('P3: n targets, ONE event', () => {
    test('CORE: one call takes the whole set, and the base keeps its extra columns', () => {
        const plan = planFollowWrite({
            ...basis,
            list: list([['p', ALICE, 'wss://relay/', 'ali'], ['t', 'bitcoin']], 100, '{"wss://a/":{}}'),
            targets: [BOB, CAROL],
        })
        assert.ok(plan)
        assert.deepEqual(
            plan.tags,
            [['p', BOB], ['p', CAROL], ['p', ALICE, 'wss://relay/', 'ali'], ['t', 'bitcoin']],
            'both new entries in front, in the order given; hint, petname and foreign tag untouched',
        )
        assert.equal(plan.content, '{"wss://a/":{}}', 'and the legacy relay map is carried over byte for byte')
    })

    /**
     * **What n separate calls would have produced — the created_at trap, without a relay.**
     *
     * Each call sees the same base and answers base + 1. Signed in the same second, one of
     * them survives and the rest are silently displaced, so the reader ends up with exactly
     * ONE of the people they selected. This case is why the set form exists and it is the
     * calibration for the one above: without it, „one call adds both" would also be true of
     * an implementation that happened to be called twice.
     */
    test('CALIBRATION: n separate calls each answer base + 1 — so n-1 follows are lost', () => {
        const bestand = list([['p', ALICE]])
        const einzeln = [BOB, CAROL].map((one) => planFollowWrite({ ...basis, list: bestand, targets: [one] }))
        for (const plan of einzeln) {
            assert.ok(plan)
            assert.equal(
                followedPubkeysIn(plan.tags).length,
                2,
                'every one of the n bodies holds the base plus exactly one entry — they are not cumulative',
            )
        }
        assert.deepEqual(einzeln.at(-1)?.tags, [['p', CAROL], ['p', ALICE]], 'the last one signed keeps only CAROL')
        const zusammen = planFollowWrite({ ...basis, list: bestand, targets: [BOB, CAROL] })
        assert.equal(followedPubkeysIn(zusammen?.tags ?? []).length, 3, 'the one call keeps all three')
    })

    test('CORE: a set in which SOME are already followed succeeds and adds only the missing ones', () => {
        const plan = planFollowWrite({
            ...basis,
            list: list([['p', ALICE, 'wss://relay/', 'ali'], ['p', BOB]]),
            targets: [ALICE, CAROL, BOB],
        })
        assert.ok(plan, 'a partly-redundant selection is the ordinary case of a bulk follow, not an error')
        assert.deepEqual(
            plan.tags,
            [['p', CAROL], ['p', ALICE, 'wss://relay/', 'ali'], ['p', BOB]],
            'only CAROL is new; ALICE keeps her hint and her petname, and neither is re-sorted',
        )
    })

    test('CORE: a set in which EVERY target is already followed produces no event at all', () => {
        assert.equal(
            planFollowWrite({ ...basis, list: list([['p', ALICE], ['p', BOB]]), targets: [BOB, ALICE] }),
            null,
            'a signed event that changes nothing is refusal 5, and a bulk call is where it happens most',
        )
    })

    test('CORE: the answer is never shorter than the base, whatever the set contains', () => {
        const bestand = list([['p', ALICE], ['t', 'x'], ['p', BOB, 'wss://r/', 'bo']])
        for (const targets of [[], [ALICE], [ME], [''], [ALICE, BOB], [CAROL], [CAROL, CAROL, ME, '']]) {
            const plan = planFollowWrite({ ...basis, list: bestand, targets })
            assert.ok(
                (plan?.tags.length ?? bestand.tags.length) >= bestand.tags.length,
                `a set of ${JSON.stringify(targets)} produced a body shorter than the base`,
            )
        }
    })
})

// ── The property test — the core proof of P3 ───────────────────────────────────

/**
 * A deterministic PRNG (mulberry32). Seeded on purpose: a property test whose corpus
 * changes between runs reports a failure nobody can reproduce, and a green run of it says
 * nothing about the next one.
 */
const makeRandom = (seed: number): (() => number) => {
    let state = seed >>> 0

    return (): number => {
        state = (state + 0x6d2b79f5) >>> 0
        let t = state
        t = Math.imul(t ^ (t >>> 15), t | 1)
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61)

        return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296
    }
}

/** 64 hex characters, distinct per index — a pubkey as far as this module is concerned. */
const pk = (n: number): string => n.toString(16).padStart(2, '0').repeat(32)

/** The shapes a `p` tag carries in the wild: bare, with a relay hint, with a petname. */
const EXTRA_COLUMNS: readonly (readonly string[])[] = [
    [],
    ['wss://hint.example/'],
    ['wss://hint.example/', 'petname'],
    ['', 'petname-without-hint'],
]

/**
 * Tags this client cannot display and must not decide about — including two malformed `p`
 * tags, which are the ones a naive filter loses first.
 */
const FOREIGN_TAGS: readonly (readonly string[])[] = [
    ['t', 'bitcoin'],
    ['e', 'f'.repeat(64)],
    ['relay', 'wss://legacy.example/'],
    ['client', 'einundzwanzig', 'wss://x/'],
    ['p'],
    ['p', ''],
]

/** `content` shapes, including the legacy relay map and bytes no parser should touch. */
const CONTENTS: readonly string[] = [
    '',
    '{"wss://a/":{"read":true,"write":true}}',
    '   ',
    '{"broken":',
    'ünïcödé ✅ \u0000 tail',
]

describe('P3 PROPERTY: every previous entry survives, `content` is byte-identical, no answer means no body', () => {
    test('CORE: 500 generated bases with hints, petnames and foreign tags', () => {
        const rnd = makeRandom(0x21_09_14)
        const POOL = 10
        let faelle = 0
        let zusicherungen = 0
        // The corpus has to CONTAIN the interesting shapes, or the properties below are
        // true of a degenerate one. Counted, then asserted at the end.
        let mitBestand = 0
        let mitFremdtag = 0
        let mitPetname = 0
        let mitSchonGefolgt = 0
        let mitSelbst = 0
        let verweigert = 0
        let geschrieben = 0

        for (let n = 0; n < 500; n++) {
            faelle++
            // ── the base ──────────────────────────────────────────────────
            const baseTags: string[][] = []
            const eintraege = Math.floor(rnd() * 7)
            for (let i = 0; i < eintraege; i++) {
                const wer = rnd() < 0.12 ? ME : pk(Math.floor(rnd() * POOL))
                const extra = EXTRA_COLUMNS[Math.floor(rnd() * EXTRA_COLUMNS.length)] as readonly string[]
                if (extra.length === 2) {
                    mitPetname++
                }
                baseTags.push(['p', wer, ...extra])
                if (rnd() < 0.4) {
                    mitFremdtag++
                    baseTags.push([...(FOREIGN_TAGS[Math.floor(rnd() * FOREIGN_TAGS.length)] as readonly string[])])
                }
            }
            if (baseTags.length > 0) {
                mitBestand++
            }
            const content = CONTENTS[Math.floor(rnd() * CONTENTS.length)] as string
            const bestand = rnd() < 0.15 ? null : list(baseTags, 100, content)
            const vorher = bestand?.tags ?? []
            const gefolgt = followedPubkeysIn(vorher)

            // ── the target set ────────────────────────────────────────────
            const targets: string[] = []
            const gewuenscht = Math.floor(rnd() * 8)
            for (let i = 0; i < gewuenscht; i++) {
                const r = rnd()
                if (r < 0.08) {
                    targets.push(ME)
                } else if (r < 0.14) {
                    targets.push('')
                } else if (r < 0.45 && gefolgt.length > 0) {
                    targets.push(gefolgt[Math.floor(rnd() * gefolgt.length)] as string)
                } else {
                    targets.push(pk(Math.floor(rnd() * POOL)))
                }
            }
            if (targets.includes(ME)) {
                mitSelbst++
            }
            if (targets.some((one) => gefolgt.includes(one))) {
                mitSchonGefolgt++
            }

            // What a correct answer must add: usable, not already there, first occurrence.
            const bekannt = new Set(gefolgt)
            const erwartet: string[] = []
            for (const one of targets) {
                if (!one || one === ME || bekannt.has(one)) {
                    continue
                }
                bekannt.add(one)
                erwartet.push(one)
            }

            const eingabe: FollowPlanInput = {
                list: bestand,
                listAnswered: true,
                targets,
                self: ME,
                add: true,
                spaceKind: 'other',
                // Bound to the base it is planning from — the ordinary case of a previewed
                // write, 500 times over. It is the calibration the F1 refusal below needs:
                // a gate that refused everything would show up here as 500 refusals.
                shownBase: followBaseId(bestand),
            }

            // ── 1. without a relay answer there is NO body. Every case, not one. ──
            assert.equal(
                planFollowWrite({ ...eingabe, listAnswered: false }),
                null,
                `case ${n}: an unanswered read produced an event body. That is the replaceable-kind data loss `
                    + 'itself — the relay\'s list replaced by whatever this client happened to hold.',
            )
            zusicherungen++

            // ── 1b. …and not on a base the reader never saw. F1, 500 times over. ──
            //
            // The id is the identity of the base, so „some other list" is any id but this
            // one. A complete relay answer does not make a body legitimate: the answer can
            // be a DIFFERENT list than the one the numbers were counted against, and on
            // this path that difference is silent — measured at 703 counted, 403 written.
            assert.equal(
                planFollowWrite({ ...eingabe, shownBase: `${followBaseId(bestand)}0` }),
                null,
                `case ${n}: a body was built on a base the reader was never shown. The preview counts against one `
                    + 'list and freezes it; a kind 3 is replaceable, and what gets signed has to be the same list.',
            )
            zusicherungen++

            const plan = planFollowWrite(eingabe)

            if (erwartet.length === 0) {
                verweigert++
                assert.equal(
                    plan,
                    null,
                    `case ${n}: a set that adds nobody produced a signed event. A no-op kind 3 costs a signature `
                        + 'and a created_at that displaces the real list on relays that are behind.',
                )
                zusicherungen++
                continue
            }

            geschrieben++
            assert.ok(plan, `case ${n}: a set with ${erwartet.length} new entries produced no body`)
            zusicherungen++

            // ── 2. `content` byte for byte ────────────────────────────────
            assert.equal(
                plan.content,
                bestand?.content ?? '',
                `case ${n}: \`content\` was rewritten. NIP-02 calls it unused; plenty of clients keep their relay `
                    + 'map there, and this client cannot display it — so it is not ours to decide about.',
            )
            zusicherungen++

            // ── 3. THE suffix property: the base survives, byte for byte, in order ──
            assert.deepEqual(
                plan.tags.slice(plan.tags.length - vorher.length),
                vorher,
                `case ${n}: the previous list is not a suffix of the answer. Every relay hint, every petname and `
                    + 'every foreign tag has to come through a bulk follow unchanged — and while that holds, an '
                    + 'answer shorter than the base is structurally impossible.',
            )
            zusicherungen++

            assert.ok(
                plan.tags.length >= vorher.length,
                `case ${n}: the answer is shorter than the base — the one outcome this module exists to prevent`,
            )
            zusicherungen++

            // ── 4. the prefix is exactly the additions: bare, unique, in order ──
            assert.deepEqual(
                plan.tags.slice(0, plan.tags.length - vorher.length),
                erwartet.map((one) => ['p', one]),
                `case ${n}: the added entries are not exactly the usable targets, bare and in the order given. `
                    + 'A duplicate here is a malformed list; an invented relay hint is a claim other clients act on.',
            )
            zusicherungen++

            // ── 5. self is never a NEW entry, whatever the set said ───────
            assert.ok(
                !plan.tags.slice(0, plan.tags.length - vorher.length).some((tag) => tag[1] === ME),
                `case ${n}: the reader was added to their own contact list`,
            )
            zusicherungen++
        }

        // ── the corpus itself, so that none of the above is true vacuously ──
        assert.equal(faelle, 500, 'the case count is measured here, not claimed in prose')
        assert.ok(mitBestand > 100, `only ${mitBestand} cases had a non-empty base`)
        assert.ok(mitFremdtag > 100, `only ${mitFremdtag} foreign tags were generated`)
        assert.ok(mitPetname > 100, `only ${mitPetname} entries carried extra columns`)
        assert.ok(mitSchonGefolgt > 50, `only ${mitSchonGefolgt} cases had an already-followed target`)
        assert.ok(mitSelbst > 20, `only ${mitSelbst} cases had the reader's own key in the set`)
        assert.ok(verweigert > 50, `only ${verweigert} cases were refused — the refusal branch is barely exercised`)
        assert.ok(geschrieben > 200, `only ${geschrieben} cases produced a body`)
        assert.ok(zusicherungen > 2_500, `only ${zusicherungen} assertions ran`)
        // Reported rather than described: the DoD asks for the case count, and a number in a
        // comment rots the moment the loop bound moves.
        console.log(
            `P3 property: ${faelle} cases, ${zusicherungen} assertions — ${geschrieben} bodies, `
                + `${verweigert} refusals, ${mitSchonGefolgt} with an already-followed target, `
                + `${mitSelbst} with the reader's own key, ${mitFremdtag} foreign tags, ${mitPetname} extra columns`,
        )
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



