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
 * ── Outbox ∪ space, and why the space is not enough (P2) ────────────────────────
 *
 * Until P2 read and write both went to the **active space relay** and nowhere else —
 * the same decision as `js/mutes.ts` and `js/bookmarks.ts`, taken for the same reason:
 * the outbox route depends on a kind-10002 list many members do not have. For a NIP-51
 * list that reasoning carries; for kind 3 it does not, and the cost was measured: a
 * closed NIP-29 relay stands in nobody's NIP-65 list, so the space almost never holds
 * the reader's contact list, `list: null` was the normal answer, and a follow built on
 * it is a replaceable event with one entry.
 *
 * Since P2 both directions use {@link followRelayTargets} — the reader's declared write
 * relays **plus** the space. The space stays in the set rather than being replaced: the
 * members read each other there, and a reader without a kind 10002 would otherwise have
 * no target at all. welshman routes a contact list the same way, minus the space
 * (`@welshman/domain` `FollowList.renderRoutes()` returns `[userOutbox()]`).
 *
 * Both relays take the kind. Buzz maps `KIND_CONTACT_LIST` to `Scope::UsersWrite`
 * (`crates/buzz-relay/src/handlers/ingest.rs`, the allowlist arm above the
 * `_ => Err("restricted: unknown event kind")` catch-all), zooid has no kind allowlist.
 *
 * ── ONE set, drawn once, and every member of it has to answer ───────────────────
 *
 * The invariant and the three audit findings behind it are written out in the header of
 * `js/followModels.ts`. What this file has to hold up:
 *
 *  · {@link readOwnRelayList} decides WHERE, with a verdict of its own
 *    ({@link OutboxKnowledge}) instead of an empty array that could mean two things;
 *  · {@link readOwnFollowList} draws the set once and carries it in
 *    {@link FollowListRead.targets};
 *  · {@link publishFollowList} takes that set rather than drawing its own, and verifies
 *    against the same relays it wrote to.
 *
 * **The first version used `eigeneOutboxUrls()` for this and that was wrong three times
 * over.** It is a synchronous projection over the repository put through a
 * `RelayScenario`, so (a) an empty answer meant either „no NIP-65 list" or „nobody has
 * fetched it yet", (b) `RelayStats.getQuality` returns `0` after ONE socket error in 60 s
 * and `getUrls()` then drops that relay entirely — a fault silently shrinking the set —
 * and (c) the scenario keeps at most three and picks them with `Math.random()`, so two
 * draws rarely agree. For a read that is all reasonable; for the target set of a
 * replaceable write it is a hazard. `eigeneOutboxUrls()` is therefore no longer used here
 * and stays unchanged for its other callers.
 *
 * **Two round trips per click, stated rather than hidden.** A follow now costs a kind
 * 10002 read (indexers ∪ the relays a cached list names) before the kind 3 read, each
 * bounded by {@link READ_TIMEOUT_MS}. That is up to twelve seconds in the worst case and
 * normally well under one. It is not cached: a cached „this reader has no relay list"
 * taken during a fault would stick for the session, and that verdict is the one that
 * licenses a space-only write.
 *
 * ── Armed at boot, not on mount ─────────────────────────────────────────────────
 *
 * The profile card sits on every page behind the gate, and it is the only reader — but it
 * opens from a window event, not from a screen, so there is no mount to hang the arming
 * on. It arms as soon as the space and the identity are known, like `js/mutes.ts`.
 *
 * ── `ready` and `listSeen` answer DIFFERENT questions (P1) ──────────────────────
 *
 * `ready` says the repository handed us its copy of the kind 3. It is true within one
 * tick of arming, **with an empty list**: `deriveEventsForUrl` is a Svelte store, and a
 * Svelte store calls its subscriber synchronously on subscribe — measured against
 * welshman 0.9.9 with a `MockAdapter`: `subscribe callbacks before any await: 1 |
 * first value: []`. In that field "this person is not followed" and "we have not looked
 * yet" are the same value, and a button that believes it offers "Folgen" for somebody
 * the reader has followed for years.
 *
 * {@link FollowsStore.listSeen} is the stricter statement, and the only one the surface
 * may believe: **a relay closed a read of our own list with an `EOSE`.** Its single
 * source is {@link readOwnFollowList}`.answered` — never a store callback, because a
 * store callback is exactly the mistake above.
 *
 * They are two fields and not one on purpose. Merging them would mean either weakening
 * `listSeen` to "the cache emitted" (the defect) or strengthening `ready` to "a relay
 * answered", which would silently change what the cache verdict means for any later
 * reader of it. Two questions, two answers, both named.
 */
import { get } from 'svelte/store'
import { makeEvent, type Filter, type TrustedEvent } from '@welshman/util'
import { pubkey } from './welshmanSession.ts'
import { request, requestOne } from './welshmanNet.ts'
import { deriveEventsForUrl } from './repository.ts'
import { activeSpace } from './groups.ts'
import { deriveSpaceKind, type SpaceKind } from './spaceCaps.ts'
import { publishSpreadOptimistic } from './publishOptimistic.ts'
import { mayWriteKind } from './relayCapability.ts'
import { app } from './welshmanApp.ts'
import { RELAYS } from './welshmanKinds.ts'
import { INDEXER_RELAYS } from './relayConfig.ts'
import { t } from './i18n.ts'
import {
    FOLLOWS,
    type FollowEventLike,
    type FollowRelayRead,
    type FollowWrite,
    type OutboxKnowledge,
    declaredWriteRelaysOf,
    followedPubkeysOf,
    followListAnswered,
    followListWins,
    followRelayTargets,
    followWriteConfirmed,
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
     * Has the repository emitted for the current space and identity?
     *
     * **Cache readiness, not knowledge** — true within one tick, with an empty list. The
     * module header carries the measurement. Never gate a write or a label on it.
     */
    ready: boolean
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
    listSpaceOnly: boolean
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

/** For which `url|pubkey` the live subscription is armed — `''` = for none. */
let armedFor = ''
let liveController: AbortController | null = null

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
const readFollowListFrom = async (url: string, self: string): Promise<FollowRelayRead> => {
    let answered = false
    let events: TrustedEvent[] = []
    try {
        events = await requestOne({
            relay: url,
            filters: followFilters(self),
            autoClose: true,
            onEose: () => {
                answered = true
            },
            signal: AbortSignal.timeout(READ_TIMEOUT_MS),
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
export const readOwnRelayList = async (self: string): Promise<RelayListRead> => {
    if (!self) {
        return { knowledge: 'unknown', writeUrls: [], unanswered: [] }
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
    const knowledge = outboxKnowledgeOf({ writeUrls, allAnswered: followListAnswered(reads, asked) })

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
    self: string,
    outbox: OutboxKnowledge,
): Promise<FollowListRead> => {
    const reads = await Promise.all(targets.map((target: string) => readFollowListFrom(target, self)))
    const answered = followListAnswered(reads, targets)

    return { answered, list: winningFollowList(reads), targets, unanswered: unansweredRelays(reads, targets), outbox }
}

/**
 * Read our own contact list from **declared write relays ∪ space** and report whether the
 * answer may be built upon.
 *
 * The relay list comes first and it is a gate, not a lookup: while
 * {@link OutboxKnowledge} is `unknown` there is no honest target set, and asking a set we
 * cannot justify would produce exactly the verdict F2 produced — a confident answer built
 * on a fault.
 */
export const readOwnFollowList = async (url: string, self: string): Promise<FollowListRead> => {
    if (!url || !self) {
        return { answered: false, list: null, targets: [], unanswered: [], outbox: 'unknown' }
    }
    const relayList = await readOwnRelayList(self)
    if (relayList.knowledge === 'unknown') {
        return { answered: false, list: null, targets: [], unanswered: relayList.unanswered, outbox: 'unknown' }
    }

    return readFollowListsFrom(followRelayTargets(relayList.writeUrls, url), self, relayList.knowledge)
}

/**
 * Arm this space and identity: read the backlog **with a verdict**, and open the live
 * subscription. Returns whether this call started a NEW arming.
 *
 * Two requests, two jobs:
 *
 *  · The backlog goes through {@link readOwnFollowList}, the same read the write path
 *    uses, because it is the only one that reports whether the relay **answered**. Until
 *    P1 this was a `load()`, and that is the whole defect: `load` fills the cache and
 *    hands back no `EOSE` of its own, so the only thing left to hang a verdict on was the
 *    repository store — which emits synchronously, with an empty list. Nothing is lost by
 *    the swap: every event received on a socket reaches the repository through the app's
 *    ingest policy (`js/welshmanInstance.ts`), not through the loader.
 *  · The live request is what makes a follow set on another device arrive without a
 *    reload. It is **not** a source for `listSeen`; the verdict has exactly one source.
 *
 * `onAnswered` fires at most once per arming, and only while this arming is still the
 * current one: a read may take six seconds, and it must not report into a space the user
 * has meanwhile left.
 */
const armFollowList = (url: string, self: string, onAnswered: (read: FollowListRead) => void): boolean => {
    const key = `${url}|${self}`
    if (armedFor === key) {
        return false
    }
    armedFor = key
    liveController?.abort()
    liveController = null
    if (!url || !self) {
        return true
    }
    liveController = new AbortController()
    void readOwnFollowList(url, self)
        .then((read: FollowListRead) => {
            if (armedFor === key) {
                onAnswered(read)
            }
        })
        .catch(noop)
    void request({
        relays: [url],
        signal: liveController.signal,
        filters: followFilters(self).map((filter) => ({ ...filter, limit: 0 })),
    }).catch(noop)

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
    let rawLists: FollowEventLike[] = []
    /**
     * **The best contact list a relay has actually shown us, across outbox ∪ space.**
     *
     * P2 needs this, and it is not a cache: {@link rawLists} comes from
     * `deriveEventsForUrl(space, …)`, i.e. from the space relay ALONE. Until P2 that was
     * also where the write path read, so the rendered label and the direction of a click
     * could not disagree. Now the write path reads the outbox too, and without this field
     * the two would come apart for exactly the people the phase is for: the card would
     * offer „Folgen" from an empty space-only list while `toggle()` computes `add: false`
     * from the real one — a click labelled "follow" that unfollows.
     *
     * Written only from an answer of {@link readOwnFollowList}, and only when it wins by
     * the NIP-01 rule, so a later read that found nothing cannot take the list away
     * again.
     */
    let readList: FollowEventLike | null = null
    let unsubSource: () => void = noop
    let unsubKind: () => void = noop
    /** Every write goes here: the raw object before {@link bind}, the reactive proxy after. */
    let self: FollowsStore

    const store: FollowsStore = {
        ready: false,
        listSeen: false,
        listSpaceOnly: false,
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
                self.listSpaceOnly = answer.outbox === 'confirmed-none'
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
                const plan = planFollowWrite({
                    list: answer.list,
                    listAnswered: answer.answered,
                    target,
                    self: me,
                    add,
                    spaceKind,
                })
                if (!plan) {
                    if (!answer.answered) {
                        self.error = refusalReason(answer)
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

    /**
     * The list the surface renders: the space relay's copy and {@link readList}, resolved
     * by the same NIP-01 rule the write path uses. Never a union of their tags.
     */
    const ownList = (): FollowEventLike | null => {
        const cached = ownFollowList(rawLists, get(pubkey) ?? '')

        return readList && followListWins(readList, cached) ? readList : cached
    }

    /** Take a list a relay showed us, if it beats the one we already had. */
    const adoptReadList = (list: FollowEventLike | null): void => {
        if (list && followListWins(list, readList)) {
            readList = list
            recompute()
        }
    }

    /**
     * Publish the planned list to **outbox ∪ space**, then check that the relays meant
     * their `OK`.
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
        const after = await readFollowListsFrom(read.targets, me, read.outbox)
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
            self.listSpaceOnly = read.outbox === 'confirmed-none'
            adoptReadList(read.list)
        })) {
            self.listSeen = false
            // Not `true`: „no outbox" and „not looked yet" are the same absence of a
            // relay list, and only one of them is a statement about this reader. The
            // notice on the card is gated on `listSeen` for the same reason.
            self.listSpaceOnly = false
            // A new space or identity: the list read for the previous one says nothing
            // about this one, and keeping it would render one person's follows under
            // another person's key.
            readList = null
        }
        unsubSource()
        if (!nextUrl || !me) {
            rawLists = []
            self.ready = false
            recompute()

            return
        }
        unsubSource = deriveEventsForUrl(nextUrl, [{ kinds: [FOLLOWS] }]).subscribe((events: TrustedEvent[]) => {
            rawLists = events as unknown as FollowEventLike[]
            self.ready = true
            recompute()
        })
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
