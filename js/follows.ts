/**
 * `$store.follows` — NIP-02 contact list (kind 3, P8), the impure half.
 *
 * The rules (what a contact list is, how its tags merge, when a write is refused) live in
 * `js/followModels.ts` and run there under `node --test` without a browser. What is left
 * here is what genuinely needs welshman: reading through the tracker, arming per space,
 * publishing — and, above all, deciding whether the relay actually **answered** before
 * anything is written.
 *
 * ── The whole point of this file: kind 3 is replaceable, and it is the big one ───
 *
 * One list per pubkey, every write replaces the whole thing. Writing it from an
 * incomplete picture deletes every contact we did not see — and unlike a mute list, this
 * is the object every other client reads to build the user's feed. The failure is not
 * "one entry missing", it is "the follow list is gone".
 *
 * **welshman's own list plugins do exactly that.** Read at
 * `@welshman/app/dist/app/src/plugins/muteLists.js` and measured in this repo:
 * `update()` calls `forceLoad(user.pubkey)`, and `makeForceLoadItem` (`@welshman/store`
 * `repository.js:449`) is `await loadItem(key); return getItem(key)` — it awaits the
 * fetch and then reads whatever happens to be in the index. An offline tab, a socket that
 * never opened, an AUTH round that swallowed the `EOSE`: all three end with `undefined`,
 * the writer starts from an empty list, and what gets published is a replaceable event
 * with exactly one entry. There is no signal on the way out that says "we were guessing".
 *
 * So no plugin is used, and this module asks the question welshman does not:
 * {@link readOwnFollowList} reports whether an `EOSE` arrived, and `planFollowWrite`
 * refuses to build an event without one. Fail-closed on purpose — a refused follow costs
 * one click, a follow written blind costs everyone the user ever followed.
 *
 * ── Where a contact list is read and written — and why not the space (N1) ──────
 *
 * **One set for both directions, and the space is in neither.** P2 put the space in
 * „because the members read each other there"; that premise was checked and is false. In
 * the whole production tree nobody reads a foreign contact list — `followFilters` is
 * `{kinds:[FOLLOWS], authors:[self]}`, and the only other source ran through
 * `newestOwnEvent(events, self, FOLLOWS)`.
 *
 * **A `grep` for `FOLLOWS` does not find every consumer**, and the exception is worth
 * knowing before somebody repeats that search: welshman's `Wot` plugin derives over EVERY
 * kind 3 in the repository (`@welshman/app` `plugins/wot.js`) and `Profiles.makeSearch`
 * ranks by it. That one is benign — it can tilt a search result, never reach the merge
 * base — but „nobody reads a foreign contact list" is a statement about THIS module's
 * code, not about the repository.
 *
 * The space copy had one consumer that could act
 * on it, our own merge base, and that is exactly what made it dangerous: with no NIP-65
 * list the target set was the space alone, the space holds no kind 3, so the base was
 * `null` and a one-tag kind 3 landed there — and won the next session's NIP-01
 * comparison. Measured across two sessions with real signatures: 700 contacts to two.
 *
 * So: `listed` → the declared write relays. `confirmed-none` → {@link FOLLOW_FALLBACK_RELAYS},
 * which are public relays that accept and serve kind 3 (the constant carries the
 * measurement, including the one relay that answers and can never hold a list).
 * `unknown` → nothing is read and nothing is written.
 *
 * Both relay kinds take kind 3 where it matters for the E2E stack: Buzz maps
 * `KIND_CONTACT_LIST` to `Scope::UsersWrite`, zooid has no kind allowlist at all.
 *
 * ── ONE set, drawn once, and every member of it has to answer ───────────────────
 *
 * The invariant and the four findings behind it are written out in the header of
 * `js/followModels.ts`. What this file has to hold up:
 *
 *  · {@link readOwnRelayList} decides WHERE, with a verdict of its own
 *    ({@link OutboxKnowledge}) instead of an empty array that could mean two things;
 *  · {@link readOwnFollowList} draws the set once and carries it in
 *    {@link FollowListRead.targets};
 *  · {@link publishFollowList} takes that set rather than drawing its own, and verifies
 *    against the same relays it wrote to.
 *
 * **`eigeneOutboxUrls()` is not used here and must not be.** It is a `RelayScenario`: at
 * most three of the declared relays, picked with `Math.random()`, minus every relay whose
 * live quality is `0` after a single socket error. For a read that is all reasonable; for
 * the target set of a replaceable write it was three separate hazards (F2, F3). It stays
 * unchanged for its other callers.
 *
 * **Round trips per click, stated rather than hidden.** A follow costs a kind 10002 read
 * (indexers ∪ the relays a cached list names) and then the kind 3 read over the target
 * set, each bounded by {@link READ_TIMEOUT_MS}. The first is skipped once a `listed`
 * verdict has been resolved for this identity — see {@link listedRelayCache} for why
 * exactly that one verdict may be kept and the other two may not.
 *
 * ── Armed at boot, not on mount ─────────────────────────────────────────────────
 *
 * The profile card sits on every page behind the gate, and it is the only reader — but it
 * opens from a window event, not from a screen, so there is no mount to hang the arming
 * on. It arms as soon as the space and the identity are known, like `js/mutes.ts`.
 *
 * ── `listSeen`: the only statement the surface may believe (P1) ────────────────
 *
 * **A relay closed a read of our own list with an `EOSE`.** Its single source is
 * {@link readOwnFollowList}`.answered` — never a store callback.
 *
 * There used to be a second field, `ready`, meaning „the repository handed us its copy".
 * It was true within one tick of arming, **with an empty list**: `deriveEventsForUrl` is
 * a Svelte store and calls its subscriber synchronously on subscribe — measured against
 * welshman 0.9.9 with a `MockAdapter`: `subscribe callbacks before any await: 1 | first
 * value: []`. In that field „this person is not followed" and „we have not looked yet"
 * were the same value. N1 removed the repository source it reported on, so the field is
 * gone with it rather than left standing at a permanent `false`.
 */
import { get } from 'svelte/store'
import { makeEvent, type Filter, type TrustedEvent } from '@welshman/util'
import { pubkey } from './welshmanSession.ts'
import { requestOne } from './welshmanNet.ts'
// F5 only — see {@link baseReadContext}. Every other query in this file goes through the
// adapter above; this one needs a context the adapter deliberately does not offer.
import { requestOne as requestOneWithoutRepository } from '@welshman/net'
import type { NetContext } from '@welshman/net'
import { activeSpace } from './groups.ts'
import { deriveSpaceKind, type SpaceKind } from './spaceCaps.ts'
import { publishSpreadOptimistic } from './publishOptimistic.ts'
import { mayWriteKind } from './relayCapability.ts'
import { app } from './welshmanApp.ts'
import { RELAYS } from './welshmanKinds.ts'
import { DEFAULT_RELAYS, INDEXER_RELAYS } from './relayConfig.ts'
import { t } from './i18n.ts'
import {
    FOLLOWS,
    type FollowEventLike,
    type FollowRelayRead,
    type FollowWrite,
    type OutboxKnowledge,
    anyRelayAnswered,
    armingReadsContactList,
    declaredWriteRelaysOf,
    floorAfterRead,
    followedPubkeysIn,
    followedPubkeysOf,
    followListAnswered,
    followListWins,
    followRelayTargets,
    followWriteConfirmed,
    followWriteBlanksKnownContent,
    followWriteShrinksBelowKnown,
    newestOwnEvent,
    normalizeRelaySet,
    ownFollowList,
    outboxKnowledgeOf,
    planFollowWrite,
    unansweredRelays,
    winningFollowList,
} from './followModels.ts'

export type FollowsStore = {
    /**
     * **Has a relay closed a read of our own list with an `EOSE`?**
     *
     * `false` means: we do not know whether this person is followed, and the surface must
     * say so instead of guessing. Set from {@link readOwnFollowList}`.answered` and from
     * nothing else; reset to `false` whenever the space or the identity changes.
     */
    listSeen: boolean
    /**
     * **Was the reader's contact list written to this space and nowhere else?** (P2)
     *
     * `true` means {@link OutboxKnowledge} came back **`confirmed-none`**: every relay we
     * asked for the reader's kind 10002 answered, and none of them had one. The list is
     * still written — refusing would make following impossible for exactly the people who
     * cannot fix it, because this client has no write path for kind 10002 — but the card
     * says so instead of promising a reach the list does not have.
     *
     * **`confirmed-none` and not „the url list came back empty".** That was F2: a single
     * socket error emptied the quality-filtered outbox, the empty array took the lenient
     * branch, and this field then told the reader the harmless reason for a fault. In the
     * `unknown` state it stays `false` and nothing is written at all.
     *
     * Only meaningful together with {@link FollowsStore.listSeen}: before a read has come
     * back, both are `false`, and the surface gates on both.
     */
    noRelayList: boolean
    busy: boolean
    /** Literal, already translated wording; `''` = none. */
    error: string
    /** May this user write a contact list on the active space at all? */
    canFollow: boolean
    me: string
    /** The pubkeys we follow, in list order. */
    following: string[]
    isFollowing(target: string): boolean
    toggle(target: string): Promise<void>
    dismissError(): void
}

const noop = (): void => {}

/**
 * How long a read of our own list may take before we call it unanswered.
 *
 * Six seconds, the same number and the same reasoning as `READ_TIMEOUT_MS` in
 * `js/mutes.ts`: long enough for a cold socket plus an AUTH round on a slow line, short
 * enough that a click does not feel broken. Running out is not an error here — it is the
 * state in which nothing is written.
 */
export const READ_TIMEOUT_MS = 6_000

/** Every kind 3 of one author, from one relay. */
export const followFilters = (self: string): Filter[] => [{ kinds: [FOLLOWS], authors: [self] }]

/** Every kind 10002 of one author, from one relay. */
export const relayListFilters = (self: string): Filter[] => [{ kinds: [RELAYS], authors: [self] }]

/**
 * **Where a contact list goes when its owner has not said where — base and target alike.**
 *
 * `DEFAULT_RELAYS` and deliberately **not** `INDEXER_RELAYS`, and the difference is
 * measured rather than assumed. Read-only `nak` probes on 2026-09-14 for one pubkey with a
 * 704-entry contact list, each relay checked for liveness with a second query so that
 * „no answer" and „does not have it" stay apart:
 *
 * | relay | in | connects | serves kind 1 | serves that kind 3 |
 * |---|---|---|---|---|
 * | `purplepag.es` | indexer | yes | no | **yes, 704 tags** |
 * | `relay.damus.io` | indexer | **no — HTTP 521, three attempts** | — | — |
 * | `indexer.coracle.social` | indexer | yes | no | **no** |
 * | `relay.primal.net` | default | yes | yes | no (does not hold this one) |
 * | `theforest.nostr1.com` | default | yes | yes | **yes, 704 tags** |
 * | `nostr.oxtr.dev` | default | yes | yes | **yes, 704 tags** |
 * | `nos.lol` | default | yes | yes | **yes, 704 tags** |
 *
 * **`indexer.coracle.social` is the row that decides this constant.** It answers, and it
 * serves no contact list at all — this repo already records why, quoting the relay:
 * `blocked: this relay only accepts kind 10002 events` (`js/profiles.ts`,
 * `PROFILE_HOSTILE_INDEXERS`). A relay that per construction never holds the list is the
 * worst possible base source: it closes with `EOSE`, contributes `null`, and its answer
 * counts towards completeness. That is F1 in a new costume, and it is why the set the
 * kind 10002 is ASKED of must not be reused as the set the kind 3 is read from.
 *
 * The defaults are general-purpose public relays that accept kind 3 and are read by other
 * clients — which is the whole point of the fallback: a list nobody can find is not a
 * contact list. `relay.primal.net` not holding this particular list is not a counter
 * example, it is what a relay looks like before it is written to.
 *
 * Configurable through `window.__nostrRelays.default`, which is what makes this work in
 * E2E (`tests/e2e/support/zooid.ts` points all three lists at the test relay) without a
 * second code path.
 */
export const FOLLOW_FALLBACK_RELAYS: readonly string[] = DEFAULT_RELAYS

/**
 * **Relays read into the base and NEVER written to — a read-only source (F6).**
 *
 * ── The hole this closes ───────────────────────────────────────────────────────
 *
 * The accepted risk recorded in `followModels.test.ts` covers `confirmed-none` only, and
 * its mitigation („the relay that holds the list is not written to, the loss is deferred")
 * does not carry over to `listed`: there the targets ARE the relays the outbox model points
 * every other client at. A reader whose declared write relays do not (or no longer) hold
 * their kind 3 — freshly declared, replaceables purged, a list written by a client that
 * only published to indexers — would get a one-entry kind 3 on exactly those relays, and
 * that would then be their contact list for the world.
 *
 * ── Why an extra SOURCE is strictly safer and not laxer ────────────────────────
 *
 * A source can only ever move the base FORWARD IN TIME: {@link winningFollowList} takes the
 * NIP-01 winner across every read, so one more read can replace `null` with a real list or
 * an older list with a newer one, and can never do the opposite.
 *
 * **„Forward in time" is not „larger", and the first version of this sentence said
 * „raise", which was wrong.** A newer event can carry fewer entries — that is what an
 * unfollow is, and it is also what the one-tag stub of every finding on this path looks
 * like. Measured: targets serving the real 700-entry list plus a hint serving a newer,
 * validly signed one-entry event yields a base of one. The base is then correct by NIP-01
 * and small, which is why the floor is fed by {@link rememberFollowRead} from the maximum
 * over ALL reads and not from the winner. What would make it laxer is letting it
 * vote — either as a write target (then we replace a copy on a relay whose answer we did
 * not require) or as a completeness voice (then a hint answering could stand in for a
 * target that did not). It does neither, and the latch in `followWriteGate.test.ts` goes
 * red if it ever does.
 *
 * Same list as the fallback, for the same measured reason: these are public relays that
 * accept and serve kind 3.
 */
export const FOLLOW_BASE_HINT_RELAYS: readonly string[] = DEFAULT_RELAYS

/**
 * **What this device has learned about this identity's contact list.**
 *
 * Two numbers-worth of memory, one record, because they are written at the same moments
 * and read at the same moment: the high-water mark {@link followWriteShrinksBelowKnown}
 * measures against, and whether the last complete read found a non-empty `content`.
 *
 * Per pubkey and never shared, the same shape and reasoning as `progressKey()` in
 * `js/verein.ts`: a collective key would hand the next reader on this device somebody
 * else's contact count, and a wrong value here refuses writes.
 */
type FollowMemory = { count: number; content: boolean }

const FOLLOW_MEMORY_NONE: FollowMemory = { count: 0, content: false }

const followMemoryKey = (self: string): string | null => (self ? `e21:follows:count:${self}` : null)

/**
 * `{count: 0, content: false}` for an unknown identity, and that is the right default
 * rather than a fallback: the floor can only be as informed as this reader's own history,
 * and a first write must go through. `localStorage` throws in some WebView configurations
 * on access alone, hence the `try` — and a broken store degrades to „no history", the
 * direction that refuses nothing.
 */
const readFollowMemory = (self: string): FollowMemory => {
    const key = followMemoryKey(self)
    if (!key) {
        return FOLLOW_MEMORY_NONE
    }
    try {
        const raw = localStorage.getItem(key)
        if (!raw) {
            return FOLLOW_MEMORY_NONE
        }
        const parsed = JSON.parse(raw) as Partial<FollowMemory>
        const count = Number(parsed?.count)

        return { count: Number.isFinite(count) && count > 0 ? Math.floor(count) : 0, content: parsed?.content === true }
    } catch {
        return FOLLOW_MEMORY_NONE
    }
}

const writeFollowMemory = (self: string, value: FollowMemory): void => {
    const key = followMemoryKey(self)
    if (!key) {
        return
    }
    try {
        localStorage.setItem(key, JSON.stringify(value))
    } catch {
        // A store that refuses to write costs the guard its memory, never a write its
        // safety: the reads below keep returning the older, smaller number.
    }
}

/** The largest contact count ever seen for `self`, or `0`. */
export const knownFollowCount = (self: string): number => readFollowMemory(self).count

/** Did the last complete read of `self`'s list find a non-empty `content`? */
export const knownContentNonEmpty = (self: string): boolean => readFollowMemory(self).content

/**
 * **What a COMPLETE read taught us.** The only way the mark moves from a read (D2, D3, b).
 *
 * ── `count` is the maximum over ALL reads, not the count of the winner (D2) ─────
 *
 * The winner is the NIP-01 newest, and „newest" says nothing about „largest". Measured:
 * the targets serve the real 700-entry list while a read-only hint serves a newer, validly
 * signed ONE-entry event; the winner is the stub, and feeding the mark from it set the
 * floor to 1 — the floor then waved through the very write it exists to stop. The maximum
 * over every read cannot be lowered by a newer smaller event, and the F6 hints are exactly
 * the reads that make the difference.
 *
 * **The docblock at {@link FOLLOW_BASE_HINT_RELAYS} used to say „a source can only ever
 * raise the base". That is true over TIME and false over CONTENT**, and this is where the
 * difference bites.
 *
 * ── Only from a read that passed the verdict (D3) ──────────────────────────────
 *
 * A round that may not write may not raise the floor either. Measured: with both targets
 * silent and a hint carrying an older, larger, validly signed list of 712, the mark went
 * to 712, and the next perfectly healthy read of the real 700 was then refused in BOTH
 * directions — permanently, with no path back. A degraded read is not evidence about this
 * identity; it is evidence about the network.
 *
 * ── And since variant (b), a read may lower it — under four conditions ─────────
 *
 * A monotone floor made a mass unfollow on another device a permanent lock-out: the mark
 * stays at 700, both directions are refused, and because nothing can be written the mark
 * never comes down either. {@link floorAfterRead} carries the four conditions and the
 * check of each of them against every finding this module has had; the short form is that
 * no single relay can cause it and none of the known failure shapes satisfies all four.
 *
 * `content` is taken from the same reads and only when at least one of them carried a
 * list: all-null says nothing about the content, and writing `false` there would silently
 * drop the second half of the floor.
 */
export const rememberFollowRead = (self: string, reads: readonly FollowRelayRead[]): void => {
    const lists = reads.map((read: FollowRelayRead) => read.list).filter(Boolean) as FollowEventLike[]
    if (!self || lists.length === 0) {
        return
    }
    const previous = readFollowMemory(self)
    writeFollowMemory(self, {
        count: floorAfterRead(reads, previous.count),
        content: lists.some((list: FollowEventLike) => list.content !== ''),
    })
}

/**
 * **The one way the mark comes DOWN: a write this client made itself (D1).**
 *
 * ── Why it has to be able to come down at all ──────────────────────────────────
 *
 * A monotone mark and ordinary unfollowing are mutually exclusive, and the first version
 * chose the mark. Measured end to end over the real gate with 20 contacts: one unfollow
 * went through, the second and third were refused, an add restored the count, and only
 * then did a fourth unfollow work. **At most one unfollow per follow** — „unfollow A on
 * Monday, B on Tuesday" was broken, which is not the mass-cleanup case the docblock
 * claimed as the price, and the message told the reader to retry something that could
 * never succeed.
 *
 * ── Why THIS number and not the one from the re-read ───────────────────────────
 *
 * The count of the event we just published. It is not a guess: the plan was built from a
 * base that had already cleared every refusal above it, including the floor — so it is the
 * one number on this path that a complete answer covers. Taking it from the re-read
 * instead would make the floor depend on a second round trip that frequently comes back
 * empty (the events are already in the tracker from the publish, so they arrive as
 * duplicates and never reach the result), and „empty" would then set the mark to zero.
 *
 * Reads still only raise. This is the sole exception, and it is bounded by what we wrote.
 */
export const setFollowCount = (self: string, count: number): void => {
    if (!self) {
        return
    }
    writeFollowMemory(self, { count, content: readFollowMemory(self).content })
}

/** For which `url|pubkey` this module has already armed — `''` = for none. */
let armedFor = ''

/** What a read of our own NIP-65 list came back with. */
export type RelayListRead = {
    /** Three values, not two — see {@link OutboxKnowledge}. */
    knowledge: OutboxKnowledge
    /** The declared write relays, normalised. Non-empty exactly when `knowledge` is `listed`. */
    writeUrls: string[]
    /** Relays asked for the kind 10002 that never sent an `EOSE` — for the refusal message. */
    unanswered: string[]
}

/** What a read of our own contact list came back with. */
export type FollowListRead = {
    /**
     * **Is the merge base usable?** From {@link followListAnswered}: EVERY relay in
     * {@link FollowListRead.targets} closed the read with an `EOSE`. `false` means: do not
     * write anything.
     */
    answered: boolean
    list: FollowEventLike | null
    /**
     * **The relay set this read used — and the only set a write may go to.**
     *
     * Carried out of here rather than recomputed at the write, because recomputing is
     * finding F3: the old set came from `eigeneOutboxUrls()`, a randomised sample of at
     * most three, drawn once for the read and again for the write. 88.7 % of follows read
     * a different set than they wrote, measured over 20 000 draws.
     */
    targets: string[]
    /** Targets that did not answer — what the refusal on the card names. */
    unanswered: string[]
    /** What we know about the reader's own kind 10002 while this read happened. */
    outbox: OutboxKnowledge
}

/**
 * Read our own contact list from ONE relay and report whether that relay answered.
 *
 * Deliberately `requestOne` and not `load`: the loader batches and de-duplicates by
 * filter, so a merged answer from a batch already in flight would be the state from
 * *before* somebody else's write — and it gives no `EOSE` of its own to hang the
 * "answered" verdict on. This asks the one relay directly, once, and takes its `EOSE` as
 * the signal. It is also what keeps the verdict PER RELAY: a `load` over a set of relays
 * reports one merged end of stream and could never say *which* of them answered, and the
 * staged rule in {@link followListAnswered} is exactly that distinction.
 *
 * **Absence of `EOSE` is the fail-closed case.** A hanging AUTH round swallows it (this
 * repo has measured that), an offline tab never gets it, and a `CLOSED` ends the request
 * without one. All three mean the same thing here: we do not know what this relay holds,
 * so we must not replace it.
 */
/**
 * **The net context of the app, minus the repository (F5).**
 *
 * ── What the repository was still doing after N1 ────────────────────────────────
 *
 * N1 removed the repository as a SOURCE for a kind 3. It stayed a **filter**, which is a
 * different thing and was missed. `@welshman/net@0.9.9` `request.js` runs, for every event
 * a relay sends:
 *
 *     else if (options.context?.repository?.isDeleted(event)) { options.onDeleted?.(…) }
 *
 * — before `isEventValid`, before `matchFilters`, and the event is **not** pushed into the
 * result. The `EOSE` still arrives, so the read reports `answered: true` with zero events,
 * and that is the class this module keeps ending up in: a base of `null` that looks like a
 * complete answer.
 *
 * No attacker needed. The optimistic thunk puts our new kind 3 into the repository, which
 * makes the previous one count as superseded for the rest of the session; every target
 * relay that still serves the previous one then contributes nothing. Relays that answer
 * `OK true` and store nothing are documented in this very file.
 *
 * ── Why the context and not `onDeleted` ────────────────────────────────────────
 *
 * Taking the dropped event back through `onDeleted` looks like the smaller change and is
 * the dangerous one: that branch sits **above** `isEventValid` and `matchFilters`, so the
 * event it hands out is neither signature-checked nor filter-checked. Feeding it into the
 * base would open an injection path this module has been measured not to have. Removing
 * the repository from the context removes the short-circuit and leaves both checks exactly
 * where they are.
 *
 * `pool` and `getAdapter` are kept, so this is still the app's connection machinery — the
 * only thing missing is the deletion index. Ingestion is unaffected: events reach the
 * repository through the app's ingest policy on the socket, not through this context.
 *
 * This is the one call in this file that does not go through `js/welshmanNet.ts`, and that
 * is the point: the adapter exists to hand every caller the SAME context, and this caller
 * needs a different one.
 */
const baseReadContext = (): NetContext => ({ ...app.netContext, repository: undefined })

const readFollowListFrom = async (url: string, self: string): Promise<FollowRelayRead> => {
    let answered = false
    let events: TrustedEvent[] = []
    try {
        events = await requestOneWithoutRepository({
            relay: url,
            filters: followFilters(self),
            autoClose: true,
            onEose: () => {
                answered = true
            },
            signal: AbortSignal.timeout(READ_TIMEOUT_MS),
            context: baseReadContext(),
        })
    } catch {
        return { url, answered: false, list: null }
    }

    return { url, answered, list: ownFollowList(events as unknown as FollowEventLike[], self) }
}

/**
 * Read our own kind 10002 from ONE relay. Same construction and same reasoning as
 * {@link readFollowListFrom} — the `EOSE` has to stay attributable to this relay.
 */
/**
 * **This read still runs WITH the repository, and that is a near-miss worth naming.**
 *
 * `readFollowListFrom` had to lose the repository from its context (F5) because
 * `@welshman/net` drops every event `repository.isDeleted(event)` accepts, before the
 * signature and filter checks and without touching the `EOSE`. The same thing happens
 * here: measured, this read returns zero events for a relay that did send the kind 10002,
 * once a newer copy of it sits in the repository.
 *
 * It is harmless **today**, and only for one reason: {@link readOwnRelayList} carries the
 * repository's own newest copy into `candidates` as a voteless source, so the declaration
 * survives the filter by another route. It becomes a finding the moment either of these
 * changes:
 *
 *  · `cached` is dropped from `candidates`, or
 *  · a kind 5 of the reader's own reaches the repository for their own 10002 address —
 *    then `isDeleted` holds for every copy and `cached` is empty too.
 *
 * Left as it is rather than widened: the contact-list read needed the narrow fix it got,
 * and taking the repository out of every read in this module would drop a protection
 * nobody asked to lose. The latch next door pins that this read keeps the ordinary
 * adapter, so a silent change here is visible.
 */
const readRelayListFrom = async (url: string, self: string): Promise<FollowRelayRead> => {
    let answered = false
    let events: TrustedEvent[] = []
    try {
        events = await requestOne({
            relay: url,
            filters: relayListFilters(self),
            autoClose: true,
            onEose: () => {
                answered = true
            },
            signal: AbortSignal.timeout(READ_TIMEOUT_MS),
        })
    } catch {
        return { url, answered: false, list: null }
    }

    return { url, answered, list: newestOwnEvent(events as unknown as FollowEventLike[], self, RELAYS) }
}

/**
 * **Find out where this reader has declared that they write — and whether we could find
 * out at all.** The F2 repair.
 *
 * Three answers, never two ({@link OutboxKnowledge}). The one that did not exist before is
 * `unknown`, and its absence was the finding: „this reader has no NIP-65 list" and „we
 * could not ask" were the same empty array, and the cheapest way to produce that array was
 * a fault rather than a fact.
 *
 * ── Whom we ask ────────────────────────────────────────────────────────────────
 *
 * The indexers plus whatever the repository already knows this reader's write relays to
 * be — the same set welshman's own `RelayLists.fetch` assembles
 * (`@welshman/app` `plugins/relayLists.js`: `uniq([...indexerScenario, ...writeUrls])`).
 * A relay list is announced to the relays it names, so they are a real second source.
 *
 * ── Why not `RelayLists.load(self)`, which is right there ──────────────────────
 *
 * Because it answers with data and never with a verdict: `makeLoadItem` resolves to
 * `undefined` when there is no kind 10002 AND when no indexer could be reached, with no
 * error and no flag — the same shape of hole this module refuses to accept for kind 3. It
 * also caches for an hour, which would make a fault taken once stick for the session.
 *
 * ── Why the winning EVENT and not `RelayLists.writeUrls(self)` ─────────────────
 *
 * The projection is correct and it is welshman's; it is simply a different question. It
 * hands back urls with no way to say whether anybody was ever asked, and it would make the
 * url list depend on when the repository happened to ingest relative to when we looked.
 * Resolving the event ourselves keeps the urls and the verdict about them tied to one
 * object, through the same NIP-01 rule the contact list uses.
 *
 * **A cached list is a `listed`, without waiting for anyone.** A kind 10002 in the
 * repository (`RELAYS` is in `PERSIST_KINDS`, so it survives a cold start) is a
 * declaration this reader made; requiring the indexers to confirm it would block following
 * on somebody else's uptime for no gain — the protection for that reader is the complete
 * answer demanded on the contact list itself, {@link followListAnswered}.
 *
 * **`confirmed-none` is the one verdict here that needs EVERY asked relay to have
 * answered**, because it is the only one that licenses a write. Getting it wrong is not a
 * local mistake: the space-only kind 3 it produces carries a fresh `created_at`, so in the
 * next session — when the real relay list does resolve — it wins the NIP-01 comparison
 * against the reader's genuine list and takes it down with it. That two-step is why the
 * bar is „all", and the price is stated rather than hidden: with three indexers
 * configured, one of them silent means a reader who has no kind 10002 cannot follow until
 * it answers. A refused click against a contact list that cannot be restored.
 *
 * **A deployment with NO indexers configured cannot follow at all**, and that is the same
 * decision seen from the other side: `asked` is then empty, and an empty set is not
 * vacuously complete ({@link followListAnswered} says so explicitly). Adding the space
 * relay to this set as a fallback would make the answer non-empty and worthless — the
 * space holds nobody's kind 10002, so „it answered, there is none" would be
 * `confirmed-none` for every reader whose indexers are down. That is F2 with an extra
 * step.
 */
/**
 * **A resolved `listed` verdict, kept for the session — and nothing else (N2).**
 *
 * Measured by the auditor: without this, every click sent three REQ to foreign indexers
 * immediately before a contact-list write. `relay.damus.io` is both an indexer here and a
 * public relay, so it could read the timing and the target of every follow off that
 * pattern. The relay list is not a secret, but the moment we ask for it is.
 *
 * **Only `listed` is cacheable, and the asymmetry is the whole point.** `confirmed-none`
 * is the verdict that licenses a write to the fallback set; taken once during a fault it
 * would then stand for the rest of the session, which is F2 with a memory. `unknown`
 * caches nothing by construction. A `listed` answer, by contrast, only decides WHICH
 * relays are read and written — and every one of them still has to answer the contact-list
 * read itself ({@link followListAnswered}), which is where the protection actually sits.
 *
 * The cost is named: a kind 10002 changed on another device is not picked up until the
 * next page load. **And the entry can come from IndexedDB alone** — `RELAYS` is in
 * `PERSIST_KINDS`, so a tab that boots offline resolves `listed` from the cold-start cache
 * and then keeps that relay set for the session without any relay having been asked. The set then in use is the reader's own previous declaration, read and
 * written consistently — divergence, not loss.
 */
let listedRelayCache: { self: string; writeUrls: string[] } | null = null

export const readOwnRelayList = async (self: string): Promise<RelayListRead> => {
    if (!self) {
        return { knowledge: 'unknown', writeUrls: [], unanswered: [] }
    }
    if (listedRelayCache?.self === self) {
        return { knowledge: 'listed', writeUrls: listedRelayCache.writeUrls, unanswered: [] }
    }
    const cached = newestOwnEvent(
        app.repository.query(relayListFilters(self)) as unknown as FollowEventLike[],
        self,
        RELAYS,
    )
    const asked = normalizeRelaySet([...INDEXER_RELAYS, ...declaredWriteRelaysOf(cached)])
    const reads = await Promise.all(asked.map((target: string) => readRelayListFrom(target, self)))
    // The cached copy joins the NIP-01 comparison as a source with no verdict of its own —
    // it answers "what did this reader declare", never "could we ask".
    const candidates = [...reads, { url: '', answered: false, list: cached }]
    const writeUrls = declaredWriteRelaysOf(winningFollowList(candidates))
    const knowledge = outboxKnowledgeOf({ writeUrls, anyAnswered: anyRelayAnswered(reads) })
    if (knowledge === 'listed') {
        listedRelayCache = { self, writeUrls }
    }

    return { knowledge, writeUrls, unanswered: unansweredRelays(reads, asked) }
}

/**
 * Ask a KNOWN target set for our own contact list and resolve the two questions it raises.
 *
 * The set comes in rather than being computed here, and that is the F3 repair: the read
 * and the write have to use the same relays, so the draw happens once, in
 * {@link readOwnFollowList}, and is carried through {@link FollowListRead.targets}.
 *
 *  · Every target is asked separately and in parallel, so the `EOSE` verdict stays per
 *    relay — {@link followListAnswered} needs to know *which* of them answered.
 *  · The verdict comes from {@link followListAnswered}, the merge base from
 *    {@link winningFollowList}. Two different questions, asked of two different functions
 *    on purpose: one decides whether we may write at all, the other what we would write
 *    from, and the second must never be a union of `p` tags.
 */
const readFollowListsFrom = async (
    targets: string[],
    hints: string[],
    self: string,
    outbox: OutboxKnowledge,
): Promise<FollowListRead> => {
    const targetReads = await Promise.all(targets.map((target: string) => readFollowListFrom(target, self)))
    // Read-only sources, kept in their own array so that the two questions below can only
    // ever be asked of the targets — see {@link FOLLOW_BASE_HINT_RELAYS}.
    const hintReads = await Promise.all(hints.map((hint: string) => readFollowListFrom(hint, self)))
    const answered = followListAnswered(targetReads, targets)
    const list = winningFollowList([...targetReads, ...hintReads])
    // D3: a round that may not write may not raise the floor either, and D2: what it
    // learns comes from every read of the round, not from the winner. Both live in
    // {@link rememberFollowRead}, which is why it takes the reads and not a number.
    if (answered) {
        rememberFollowRead(self, [...targetReads, ...hintReads])
    }

    return { answered, list, targets, unanswered: unansweredRelays(targetReads, targets), outbox }
}

/**
 * Read our own contact list from the relays that hold it, and report whether the answer
 * may be built upon.
 *
 * The relay list comes first and it is a gate, not a lookup: while
 * {@link OutboxKnowledge} is `unknown` there is no honest target set, and asking a set we
 * cannot justify would produce exactly the verdict F2 produced — a confident answer built
 * on a fault.
 *
 * **`spaceUrl` is the arming SCOPE, never a relay target.** It answers „is a space active
 * at all", which is what decides whether this surface exists; the relays are chosen by
 * {@link followRelayTargets} and the space is not among them since N1. It is passed in
 * rather than read from `activeSpace` here so that a read cannot report into a space the
 * reader has meanwhile left. The latch in `followWriteGate.test.ts` pins that it never
 * reaches the target set.
 */
export const readOwnFollowList = async (
    spaceUrl: string,
    self: string,
    arming = false,
): Promise<FollowListRead> => {
    if (!spaceUrl || !self) {
        return { answered: false, list: null, targets: [], unanswered: [], outbox: 'unknown' }
    }
    const relayList = await readOwnRelayList(self)
    if (relayList.knowledge === 'unknown') {
        return { answered: false, list: null, targets: [], unanswered: relayList.unanswered, outbox: 'unknown' }
    }
    // F7: on a page load we only ask relays the reader declared themselves. Everything
    // else waits for the click — {@link armingReadsContactList} carries why.
    if (arming && !armingReadsContactList(relayList.knowledge)) {
        return { answered: false, list: null, targets: [], unanswered: [], outbox: relayList.knowledge }
    }

    const targets = followRelayTargets(relayList.knowledge, relayList.writeUrls, FOLLOW_FALLBACK_RELAYS)
    // Everything the hints would add that is not already a target. A relay in both would
    // otherwise be asked twice and — worse — could look like two independent sources.
    // …and an arming pass takes none of them: the hints are foreign relays too.
    const hints = arming
        ? []
        : normalizeRelaySet(FOLLOW_BASE_HINT_RELAYS).filter((url: string) => !targets.includes(url))

    return readFollowListsFrom(targets, hints, self, relayList.knowledge)
}

/**
 * Arm this space and identity: read our own list **with a verdict**. Returns whether this
 * call started a NEW arming.
 *
 * The read goes through {@link readOwnFollowList}, the same read the write path uses,
 * because it is the only one that reports whether the relays **answered**. Until P1 this
 * was a `load()`, and that is the whole defect: `load` fills the cache and hands back no
 * `EOSE` of its own, so the only thing left to hang a verdict on was the repository store
 * — which emits synchronously, with an empty list.
 *
 * ── The live subscription is gone (N1) ─────────────────────────────────────────
 *
 * It used to sit here, scoped to the space relay, so that a follow made on another device
 * arrived without a reload. It delivered nothing: a contact list is not on the space, and
 * since N1 the space is not a kind-3 relay for this client at all. Pointing it at the
 * target relays instead would have meant a standing open subscription on up to four
 * foreign relays for our own pubkey — a permanent presence signal, for a convenience that
 * the read on every click already provides. So it is removed rather than moved.
 *
 * `onAnswered` fires at most once per arming, and only while this arming is still the
 * current one: a read may take two relay round trips, and it must not report into a space
 * the user has meanwhile left.
 */
const armFollowList = (url: string, self: string, onAnswered: (read: FollowListRead) => void): boolean => {
    const key = `${url}|${self}`
    if (armedFor === key) {
        return false
    }
    armedFor = key
    if (!url || !self) {
        return true
    }
    void readOwnFollowList(url, self, true)
        .then((read: FollowListRead) => {
            if (armedFor === key) {
                onAnswered(read)
            }
        })
        .catch(noop)

    return true
}

/** At most this many relay names go into a refusal — the rest as „+n". */
const NAMED_RELAYS_IN_ERROR = 3

/** `wss://relay.example/` → `relay.example` — a relay name a reader can match to theirs. */
const relayLabel = (url: string): string => url.replace(/^wss?:\/\//, '').replace(/\/$/, '')

/** A short, readable list of relay names, capped so one message cannot become a wall. */
const relayNames = (urls: readonly string[]): string => {
    const names = urls.map(relayLabel)
    const shown = names.slice(0, NAMED_RELAYS_IN_ERROR).join(', ')

    return names.length > NAMED_RELAYS_IN_ERROR ? `${shown} +${names.length - NAMED_RELAYS_IN_ERROR}` : shown
}

/**
 * **Why nothing was written, in words the reader can act on.**
 *
 * The strict verdict of {@link followListAnswered} is only bearable because of this
 * function. „Es wurde nichts geändert" on its own leaves a reader with a button that
 * refuses forever and no idea which of their relays to remove or wake up; a dead entry in
 * their own kind 10002 is a thing they CAN fix, but only if they are told which one.
 *
 * The two causes are genuinely different and get different sentences:
 *
 *  · `unknown` — their relay list itself was not retrievable, so we never had a target
 *    set. Nothing about their contact list is implied.
 *  · otherwise — the target set stands and some of it stayed silent. Those are named.
 */
const refusalReason = (read: FollowListRead): string => {
    if (read.outbox === 'unknown') {
        return t('Deine Relay-Liste (NIP-65) war nicht abrufbar. Es wurde nichts geändert.')
    }
    return t('Diese Relais haben die Kontaktliste nicht ausgeliefert: :relays. Es wurde nichts geändert.', {
        relays: relayNames(read.unanswered),
    })
}

/**
 * Which relays refused or dropped the write — the counterpart of {@link refusalReason}
 * for the other end of the round trip.
 *
 * Until the audit this said „Der Space hat die Änderung nicht übernommen." for every
 * outcome, and after P2 the space is usually not the relay that blocked: a replaceable
 * event dropped for a `created_at` that lost the race sits wherever it sat. A message that
 * names the wrong relay is worse than a vague one — the reader goes and checks something
 * that is working.
 */
const writeRefused = (urls: readonly string[]): string =>
    t('Diese Relais haben die Änderung nicht übernommen: :relays.', { relays: relayNames(urls) })

// ── The store ───────────────────────────────────────────────────────────────────

const createStore = (): { store: FollowsStore; bind: (reactive: FollowsStore) => void; start: () => void } => {
    let url = ''
    let spaceKind: SpaceKind = 'unknown'
    /**
     * **The only contact list this store knows: the one the target relays showed us.**
     *
     * ── Why there is no repository source beside it any more (N1) ───────────────
     *
     * Until N1 this field competed with `deriveEventsForUrl(space, [{kinds:[FOLLOWS]}])`,
     * and `ownList()` took the NIP-01 winner of the two. That second source was the
     * poisoning path: a one-tag kind 3 written to the space in an earlier session came
     * back — from the relay, and after a reload from IndexedDB as well, because `FOLLOWS`
     * is in `PERSIST_KINDS` and `js/storage.ts` restores the tracker line with it — and
     * being the newest event of its address, it won.
     *
     * So the base has exactly one origin now: {@link readFollowListFrom}, over the relays
     * of THIS operation.
     *
     * **The repository is no longer a SOURCE — it was still a FILTER until F5.** That
     * sentence used to read „not consulted for a kind 3 at all", which was wrong and
     * measurably so: `@welshman/net` drops every received event for which
     * `repository.isDeleted(event)` holds, before the signature and filter checks and
     * without touching the `EOSE`. {@link baseReadContext} takes the repository out of the
     * context of this one read; it is consulted for nothing here now, neither way. The
     * price
     * is that the button says „Lädt…" until the read lands instead of showing a cached
     * answer, which is the honest state anyway — P1 built that state for exactly this.
     *
     * Written only from an answer of {@link readOwnFollowList}, and only when it wins by
     * the NIP-01 rule, so a later read that found nothing cannot take the list away
     * again.
     */
    let readList: FollowEventLike | null = null
    let unsubKind: () => void = noop
    /** Every write goes here: the raw object before {@link bind}, the reactive proxy after. */
    let self: FollowsStore

    const store: FollowsStore = {
        listSeen: false,
        noRelayList: false,
        busy: false,
        error: '',
        canFollow: false,
        me: '',
        following: [],

        /**
         * Read off {@link FollowsStore.following} and not off the raw list in the closure:
         * `following` is the reactive proxy Alpine watches, the closure variable is not. A
         * predicate the markup calls has to change when the list does, or the button keeps
         * offering "follow" for somebody who already is.
         */
        isFollowing(target: string): boolean {
            return self.following.includes(target)
        },

        /**
         * Follow or unfollow one person.
         *
         * Order: read our own list from the relay → plan → publish → re-read to see
         * whether the relay meant its `OK`. The read is not an optimisation and not a
         * merge convenience: without its `answered` verdict the plan refuses, and that
         * refusal is the whole protection against replacing a list we have not seen.
         */
        async toggle(target: string): Promise<void> {
            const me = get(pubkey) ?? ''
            if (self.busy || !target || !me || !url) {
                return
            }
            self.busy = true
            self.error = ''
            try {
                const answer = await readOwnFollowList(url, me)
                const seenBefore = self.listSeen
                self.listSeen = self.listSeen || answer.answered
                // Refreshed from the read that just happened, not left at what arming
                // saw: a kind 10002 that arrives mid-session has to be able to take the
                // notice off the card, and a session that starts before the relay list
                // resolves has to be able to put it on.
                self.noRelayList = answer.outbox === 'confirmed-none'
                adoptReadList(answer.list)
                if (!seenBefore) {
                    // THE BOLT IN THE PATH, and it has to be here rather than on the
                    // button. `aria-disabled` is an announcement, not a lock: the element
                    // stays clickable and stays reachable from the keyboard (written out
                    // in `js/forge.ts` for the same situation). So a click while the list
                    // is unseen is a RETRY of the read and never a write — the label said
                    // nothing about the direction, and writing here would sign a decision
                    // the user was never shown. The next click, with the verdict in hand,
                    // is the ordinary one.
                    self.error = answer.answered
                        ? t('Die Kontaktliste ist jetzt geladen. Bitte noch einmal klicken.')
                        : refusalReason(answer)

                    return
                }
                // The DIRECTION comes from the list the relay just showed us, not from
                // `self.following`. The cached list is `[]` for as long as no relay has
                // answered, so deriving `add` from it means "follow" for everybody the
                // user already follows — a signed event whose only effect is to sort the
                // person to the front. `planFollowWrite` would then refuse it as a no-op
                // at best, and at worst confirm a follow that was already there.
                //
                // Bound in two steps rather than one so the answer of `followedPubkeysOf`
                // is a value the AST latch can point at: `!f(x).includes(y)` is a unary
                // expression whose call is buried, and a swap back to `self.isFollowing`
                // would leave that shape untouched.
                const followedNow = followedPubkeysOf(answer.list)
                const add = !followedNow.includes(target)
                // THE GATE, and it comes back as the event body or as `null`. A refused
                // plan is silent for every reason but this one — the user has to learn
                // that nothing was written, or they will believe a follow that does not
                // exist.
                // Bound rather than inlined so that the SAME value goes into the gate and
                // into the message below. Asking the floor twice with two different inputs
                // is how a refusal and its explanation drift apart.
                const eingabe = {
                    list: answer.list,
                    listAnswered: answer.answered,
                    target,
                    self: me,
                    add,
                    spaceKind,
                    knownContactCount: knownFollowCount(me),
                    knownContentNonEmpty: knownContentNonEmpty(me),
                }
                const plan = planFollowWrite(eingabe)
                if (!plan) {
                    if (!answer.answered) {
                        self.error = refusalReason(answer)
                    } else if (followWriteShrinksBelowKnown(eingabe) || followWriteBlanksKnownContent(eingabe)) {
                        // THE FLOOR refused. Silent here would be the worst of both
                        // worlds: nothing written and nothing said, on the one path that
                        // exists because every other explanation has already failed.
                        self.error = t('Die Kontaktliste sieht unvollständig aus — kleiner als das, was zuletzt bekannt war. Es wurde nichts geschrieben, bitte versuch es noch einmal.')
                    }

                    return
                }
                const failure = await publishFollowList(plan, target, add, me, answer)
                if (failure) {
                    self.error = failure
                }
            } catch {
                // A rejection out of the read path used to escape as an unhandled
                // rejection while `self.error` stayed `''` — the direction was safe
                // (nothing written) but silent, and a button that does nothing without
                // saying why is indistinguishable from one that is broken.
                self.error = t('Die Kontaktliste konnte nicht gelesen werden. Es wurde nichts geändert.')
            } finally {
                self.busy = false
            }
        },

        dismissError(): void {
            self.error = ''
        },
    }

    self = store

    /** The list the surface renders — the same one the write path would build from. */
    const ownList = (): FollowEventLike | null => readList

    /** Take a list a relay showed us, if it beats the one we already had. */
    const adoptReadList = (list: FollowEventLike | null): void => {
        if (list && followListWins(list, readList)) {
            readList = list
            recompute()
        }
    }

    /**
     * Publish the planned list to **the target set of the read it is based on**, then
     * check that those relays meant their `OK`.
     *
     * It said „outbox ∪ space" until this round — a description of the design K4 removed.
     * Reported by the reviewer, pre-existing, corrected here rather than carried on.
     *
     * The plan carries `content` over from the existing list **unchanged** — that is the
     * entire handling of the legacy relay map some clients still keep there
     * (`followModels.ts` header).
     *
     * ── Why the failure question is "did it land ANYWHERE" ──────────────────────
     *
     * With one relay "something went wrong" and "nothing was written" are the same
     * sentence; across a set they come apart, and `publishSpreadOptimistic` is built on
     * exactly that distinction (its header carries the measurement: `relay.damus.io`
     * answered 5 of 8 attempts with `503` while the other relay kept the event). Reading
     * its `error` as the verdict here would roll a real, public write back in the
     * interface and tell the reader their follow failed while it stands on two of their
     * three relays.
     *
     * So: `delivered` empty ⇒ the event exists nowhere (the thunk has removed it again)
     * ⇒ report. Otherwise the write happened and the re-read below decides, the same way
     * it did before P2.
     *
     * ── `targets` comes IN — it is not drawn again here (F3) ───────────────────
     *
     * The set was drawn once, by the read whose answer this plan is built on, and the
     * invariant of this module is that those are the same relays. Recomputing it was the
     * finding: the old call went through `eigeneOutboxUrls()`, whose scenario keeps at
     * most three of the declared relays and picks them with `Math.random()`, so the write
     * routinely went somewhere else than the read — measured at 88.7 % of follows. Every
     * relay in this set answered the read; that is what makes replacing their copy
     * defensible, and it is only true for THIS set.
     *
     * The re-read uses the same set too, which is also why it is
     * {@link readFollowListsFrom} and not {@link readOwnFollowList}: verifying against
     * relays we did not write to would answer a different question, and re-resolving the
     * kind 10002 would cost a second round of indexer requests for nothing.
     */
    const publishFollowList = async (
        plan: FollowWrite,
        target: string,
        add: boolean,
        me: string,
        read: FollowListRead,
    ): Promise<string> => {
        const spread = await publishSpreadOptimistic(
            read.targets,
            makeEvent(plan.kind, { content: plan.content, tags: plan.tags }),
        )
        if (spread.delivered.length === 0) {
            return spread.error || writeRefused(read.targets)
        }
        // D1: the one place the floor may come down. The number is the one we just
        // published — see {@link setFollowCount} for why it is that and not the re-read's.
        setFollowCount(me, followedPubkeysIn(plan.tags).length)
        const after = await readFollowListsFrom(read.targets, [], me, read.outbox)
        adoptReadList(after.list)

        return followWriteConfirmed(after.list ? after.list.tags : null, target, add)
            ? ''
            : writeRefused(spread.failed.length > 0 ? spread.failed : read.targets)
    }

    const recompute = (): void => {
        self.following = followedPubkeysOf(ownList())
    }

    /**
     * `mayWriteKind` is asked here a SECOND time — `planFollowWrite` asks it for the
     * write. This one only decides whether the markup offers the action at all: a button
     * that would do nothing is worse than no button. The store method never trusts this
     * field; the plan re-decides in its own currency.
     *
     * **Since K4 this says nothing about the write target.** It asks whether the SPACE
     * relay would take a kind 3, and a kind 3 is no longer written to the space; in
     * practice it now only delays the button until the space's NIP-11 has resolved
     * (`[3, {relay: 'any'}]` in `relayCapability.ts`). Kept because it is a documented
     * refusal of `planFollowWrite` from P8 and removing it is its own decision — but do
     * not read it as a statement about where the list goes.
     */
    const recomputePermission = (): void => {
        self.me = get(pubkey) ?? ''
        self.canFollow = Boolean(self.me) && mayWriteKind(FOLLOWS, spaceKind)
    }

    const armSource = (nextUrl: string): void => {
        const me = get(pubkey) ?? ''
        url = nextUrl
        // A NEW space or identity means a new list, of which nothing has been seen yet.
        // Re-arming the same pair must not reset the verdict: no second read follows it,
        // and the button would stay inert for the rest of the session.
        if (armFollowList(nextUrl, me, (read: FollowListRead) => {
            // ORed, not assigned. The arming read takes up to twice {@link READ_TIMEOUT_MS}
            // and a click can finish first; assigning would then throw away a verdict
            // `toggle()` had already earned, putting the button back into the unknown
            // state for no reason the reader can see. `false` here never means „not
            // seen", only „this attempt did not see it".
            self.listSeen = self.listSeen || read.answered
            self.noRelayList = read.outbox === 'confirmed-none'
            adoptReadList(read.list)
        })) {
            self.listSeen = false
            // Not `true`: „no outbox" and „not looked yet" are the same absence of a
            // relay list, and only one of them is a statement about this reader. The
            // notice on the card is gated on `listSeen` for the same reason.
            self.noRelayList = false
            // A new space or identity: the list read for the previous one says nothing
            // about this one, and keeping it would render one person's follows under
            // another person's key.
            readList = null
        }
        recompute()
    }

    const start = (): void => {
        activeSpace.subscribe((nextUrl: string) => {
            if (!nextUrl) {
                return
            }
            // The relay kind decides whether we may write at all, and it arrives late.
            // Subscribed rather than read once — the documented way this kind of surface
            // breaks in this repo.
            unsubKind()
            unsubKind = deriveSpaceKind(nextUrl).subscribe((kind: SpaceKind) => {
                spaceKind = kind
                recomputePermission()
            })
            armSource(nextUrl)
        })
        // The pubkey is a second, independent arrival: the session store can resolve after
        // `activeSpace` has already emitted. Without this the first pass would take the
        // guest branch and stay empty for the whole session — silently.
        pubkey.subscribe(() => {
            recomputePermission()
            armSource(url)
        })
    }

    return {
        store,
        bind: (reactive: FollowsStore): void => {
            self = reactive
        },
        start,
    }
}

export function wireFollows(Alpine: { store: (name: string, value?: unknown) => unknown }): void {
    if (Alpine.store('follows')) {
        return
    }
    const { store, bind, start } = createStore()
    Alpine.store('follows', store)
    // From here the store writes only into the reactive proxy — same reason and same shape
    // as `wireMutes`/`wireBookmarks`: a closure that keeps mutating the raw object changes
    // values Alpine never hears about.
    bind(Alpine.store('follows') as FollowsStore)
    start()
}
