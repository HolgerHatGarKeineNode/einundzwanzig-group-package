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
 * Since P2 both directions use {@link followRelayTargets} — the reader's outbox relays
 * **plus** the space. The space stays in the set rather than being replaced: the members
 * read each other there, and a reader without a kind 10002 would otherwise have no
 * target at all. welshman routes a contact list the same way, minus the space
 * (`@welshman/domain` `FollowList.renderRoutes()` returns `[userOutbox()]`).
 *
 * Both relays take the kind. Buzz maps `KIND_CONTACT_LIST` to `Scope::UsersWrite`
 * (`crates/buzz-relay/src/handlers/ingest.rs`, the allowlist arm above the
 * `_ => Err("restricted: unknown event kind")` catch-all), zooid has no kind allowlist.
 *
 * ── The outbox has to be ASKED before it is snapshotted ─────────────────────────
 *
 * `eigeneOutboxUrls()` is a synchronous projection over the repository
 * (`@welshman/app` `plugins/relayLists.js`: `writeUrls` is `this.project(…)`), so an
 * empty answer means either "this reader has no NIP-65 list" or "nobody has fetched it
 * yet" — and the two demand opposite behaviour. Measured in this tree on 2026-09-14:
 * **no module requests kind 10002 for the reader's own pubkey.** `bridge.ts` derives it
 * from the repository for display only, and the one place that would fetch it as a side
 * effect (`Profiles.load(me)` → `Network.loadUsingOutbox` → `RelayLists.load`) runs on
 * the wallet settings island and in the member directory, neither of which the profile
 * card waits for. Without the load below, "outbox ∪ space" would be "space" for nearly
 * every reader and this whole phase would be a no-op that measures green.
 *
 * `RelayLists.load` is welshman's own cached loader (`makeLoadItem`: one attempt per
 * pubkey per hour, shared pending promise, bounded by the loader's 3 s timeout), and it
 * is a plugin METHOD, not the `forceLoad` import the P1 latch forbids.
 *
 * **What it still cannot tell us, stated rather than discovered:** `load` resolves with
 * `undefined` both when no kind 10002 exists and when no indexer could be reached. So
 * "the outbox is empty" is an *attempted* answer, not a confirmed one, and a reader whose
 * indexers are unreachable falls into the empty-outbox branch — where an `EOSE` from the
 * space suffices. Closing that would take a second loader with its own `EOSE` verdict,
 * the way {@link readFollowListFrom} has one; it is named here so it is a known hole and
 * not a surprise.
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
import { app, RelayLists } from './welshmanApp.ts'
import { eigeneOutboxUrls } from './welshmanRouter.ts'
import { t } from './i18n.ts'
import {
    FOLLOWS,
    type FollowEventLike,
    type FollowRelayRead,
    type FollowWrite,
    followedPubkeysOf,
    followListAnswered,
    followListWins,
    followRelayTargets,
    followWriteConfirmed,
    ownFollowList,
    planFollowWrite,
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
     * `true` means the last read found no NIP-65 relay list for them, so
     * {@link followRelayTargets} had nothing but the space to offer. The list is still
     * written — refusing would make following impossible for exactly the people who
     * cannot fix it, because this client has no write path for kind 10002 — but the card
     * says so instead of promising a reach the list does not have.
     *
     * Only meaningful together with {@link FollowsStore.listSeen}: before a read has
     * come back, "no outbox" and "not looked yet" are the same `false`, and the surface
     * gates on both.
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

/** For which `url|pubkey` the live subscription is armed — `''` = for none. */
let armedFor = ''
let liveController: AbortController | null = null

/** What a read of our own list came back with. */
export type FollowListRead = {
    /**
     * **Is the merge base usable?** From {@link followListAnswered} — with a NIP-65 list
     * on file this takes an `EOSE` from an OUTBOX relay; the space alone is not enough.
     * `false` means: do not write anything.
     */
    answered: boolean
    list: FollowEventLike | null
    /**
     * The outbox relays this read asked, as `eigeneOutboxUrls()` reported them **after**
     * the relay list had been fetched. Empty = no NIP-65 list we were able to find.
     */
    outboxUrls: string[]
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
 * Read our own contact list from **outbox ∪ space** and report whether the answer may be
 * built upon.
 *
 * Four steps, each with its own section in the module header:
 *
 *  · fetch the reader's NIP-65 list, so that an empty outbox is an *attempted* answer and
 *    not a cold snapshot of a projection nobody ever filled;
 *  · assemble the targets — {@link followRelayTargets}, outbox first, space always in;
 *  · ask every target separately and in parallel, so the `EOSE` verdict stays per relay;
 *  · resolve the answers. The verdict comes from {@link followListAnswered}, the merge
 *    base from {@link winningFollowList} — two different questions, asked of two
 *    different functions on purpose. One decides whether we may write at all, the other
 *    what we would write from, and the second one must never be a union of `p` tags.
 */
export const readOwnFollowList = async (url: string, self: string): Promise<FollowListRead> => {
    if (!url || !self) {
        return { answered: false, list: null, outboxUrls: [] }
    }
    await app.use(RelayLists).load(self).catch(noop)
    const outboxUrls = eigeneOutboxUrls()
    const targets = followRelayTargets(outboxUrls, url)
    const reads = await Promise.all(targets.map((target: string) => readFollowListFrom(target, self)))
    const answered = followListAnswered(reads, outboxUrls)

    return { answered, list: winningFollowList(reads), outboxUrls }
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
                self.listSpaceOnly = answer.outboxUrls.length === 0
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
                        : t('Der Space hat die Liste nicht ausgeliefert. Es wurde nichts geändert.')

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
                        self.error = t('Der Space hat die Liste nicht ausgeliefert. Es wurde nichts geändert.')
                    }

                    return
                }
                const failure = await publishFollowList(plan, target, add, me)
                if (failure) {
                    self.error = failure
                }
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
     * `eigeneOutboxUrls()` is read synchronously here and that is safe **because of the
     * order in `toggle()`**, not by itself: the merge-base read runs first and awaits the
     * NIP-65 fetch, so the projection is warm by the time this runs. Calling
     * `publishFollowList` from anywhere else would have to await that fetch again.
     */
    const publishFollowList = async (
        plan: FollowWrite,
        target: string,
        add: boolean,
        me: string,
    ): Promise<string> => {
        const spread = await publishSpreadOptimistic(
            followRelayTargets(eigeneOutboxUrls(), url),
            makeEvent(plan.kind, { content: plan.content, tags: plan.tags }),
        )
        if (spread.delivered.length === 0) {
            return spread.error || t('Der Space hat die Änderung nicht übernommen.')
        }
        const after = await readOwnFollowList(url, me)
        adoptReadList(after.list)

        return followWriteConfirmed(after.list ? after.list.tags : null, target, add)
            ? ''
            : t('Der Space hat die Änderung nicht übernommen.')
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
            self.listSeen = read.answered
            self.listSpaceOnly = read.outboxUrls.length === 0
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
