/**
 * `$store.bookmarks` — NIP-51 bookmarks (P2), the impure half.
 *
 * The rules (which 30003 is a bookmark set and which is Buzz mesh telemetry, how a tag
 * list merges, what counts as a confirmed write) live in `bookmarkModels.ts` and are
 * testable there without a browser. What is left here is what genuinely needs welshman:
 * reading through the tracker, gating, signing, publishing — and re-reading to see
 * whether the relay actually did anything.
 *
 * ── Why a store and not an island ──────────────────────────────────────────────────
 *
 * The same reason the pin got one (`js/roomPins.ts`): the state is needed at two places
 * that cannot see each other in the DOM — the `/bookmarks` screen, and the entry in the
 * message menu inside `nostrRoomChat`. Two islands would mean two truths about "is this
 * bookmarked", and the second goes stale the moment a bookmark is set on another device.
 * `nostrRoomChat` gains no field: the markup reads `$store.bookmarks.*`.
 *
 * ── The gate runs before the event exists ──────────────────────────────────────────
 *
 * The write path does not ask the gate and then decide; it asks
 * `planBookmarkWrite` (`bookmarkModels.ts`), which asks the gate and answers `null`
 * when the answer is no. Gate and event body are then the same value: there is nothing
 * to sign unless the gate said yes. That matters because a gate call whose result is
 * dropped is indistinguishable from one that is honoured, and this way the promise is
 * a unit test rather than a reading of the source.
 *
 * `mayWriteKind` is asked a second time here, in {@link recomputePermission} — but only
 * to decide whether the markup shows the entry at all. A menu item that would do
 * nothing is worse than no menu item.
 *
 * ── One space, one list ────────────────────────────────────────────────────────────
 *
 * Read and write both go to the **active space relay** and nowhere else. A NIP-51
 * bookmark list is global by protocol, so the outbox model would be defensible — but it
 * would carry the reading habits of an association member onto public relays, and it
 * would depend on a relay list that many members do not have. The consequence is stated
 * so nobody has to find it: bookmarks made while one space is active do not appear while
 * another is. Reversing that is one `relays` array in {@link publishList}.
 */
import { sanitizeUrl } from '@braintree/sanitize-url'
import { throttled } from '@welshman/store'
import { makeEvent, type Filter, type TrustedEvent } from '@welshman/util'
import { derived, get } from 'svelte/store'
import { app } from './welshmanApp.ts'
import { pubkey } from './welshmanSession.ts'
import { load, request, requestOne } from './welshmanNet.ts'
import { deriveEventsForUrl } from './repository.ts'
import { activeSpace } from './groups.ts'
import { WORKSPACE_URL, deriveSpaceKind, type SpaceKind } from './spaceCaps.ts'
import { workspaceRoomHref } from './spaceParam.ts'
import { displayProfileByPubkey, profilesByPubkey } from './spaceProfiles.ts'
import { bodyWithoutQuote, fullTimeLabel } from './feeds.ts'
import { publishOptimistic } from './publishOptimistic.ts'
import { mayWriteKind } from './relayCapability.ts'
import { t } from './i18n.ts'
import {
    BOOKMARKS,
    NAMED_BOOKMARKS,
    type BookmarkEventLike,
    type BookmarkRef,
    type BookmarkWrite,
    bookmarkRefs,
    bookmarkedEventIds,
    isBookmarked,
    otherBookmarkRefs,
    ownBookmarkList,
    planBookmarkWrite,
    writeConfirmed,
} from './bookmarkModels.ts'

/** A bookmarked message, as the screen and the pin-style bar render it. */
export type BookmarkEntry = {
    id: string
    text: string
    name: string
    time: string
    /** Where the row jumps to; empty while the message is unknown. */
    href: string
    /** `d` of the 30003 set it came from; `''` for the plain list. */
    set: string
    /** Is the message itself loaded? Otherwise the row shows a placeholder. */
    resolved: boolean
}

/** A bookmark that is not a message: an address, a topic, a url. */
export type BookmarkLink = {
    type: string
    value: string
    /** Sanitised target for `r`; `''` for everything we will not link. */
    href: string
    set: string
}

type BookmarksStore = {
    /** Has the first read of the active space happened? */
    ready: boolean
    loading: boolean
    busy: boolean
    /** Literal relay wording, `''` = none. */
    error: string
    /** May this user write a bookmark list on the active space at all? */
    canBookmark: boolean
    /** Does the list carry an encrypted private half this client does not show? */
    hasPrivate: boolean
    entries: BookmarkEntry[]
    links: BookmarkLink[]
    mount(): void
    unmount(): void
    isBookmarked(value: string): boolean
    /** Add or drop one bookmark. `value` is a message id, a topic, a url or an address. */
    toggle(value: string): Promise<void>
    dismissError(): void
}

const noop = (): void => {}

/**
 * How long the confirmation re-read may take before we stop waiting.
 *
 * Well under `PUBLISH_VERDICT_TIMEOUT_MS` (20 s): at this point the relay has already
 * answered `OK`, we are only asking whether it meant it. A hanging AUTH round can
 * swallow the `EOSE` of a request entirely — that case must end in "cannot tell", not
 * in a spinner (`writeConfirmed` treats an empty answer as confirmed, and says why).
 */
const CONFIRM_TIMEOUT_MS = 6_000

/** Both bookmark lists of one author, from one relay. */
const bookmarkFilters = (self: string): Filter[] => [{ kinds: [BOOKMARKS, NAMED_BOOKMARKS], authors: [self] }]

/** Event → row of the screen. An unresolved message keeps its place and says so. */
const toEntry = (ref: BookmarkRef, event: TrustedEvent | undefined, workspace: boolean): BookmarkEntry => {
    const h = event?.tags.find((tag) => tag[0] === 'h' && tag[1])?.[1] ?? ''

    return {
        id: ref.value,
        text: event ? bodyWithoutQuote(event) : '',
        name: event ? displayProfileByPubkey(event.pubkey) : '',
        time: event ? fullTimeLabel(event.created_at) : '',
        href: h ? (workspace ? workspaceRoomHref(h) : `/rooms/${encodeURIComponent(h)}`) : '',
        set: ref.set,
        resolved: Boolean(event),
    }
}

/**
 * Only an `r` bookmark becomes a link, and only through `sanitizeUrl`.
 *
 * These values come out of a list any client may have written — `javascript:` in an
 * `href` is a one-tag script injection. `sanitizeUrl` answers `about:blank` for
 * everything it rejects, and that is treated as "no link" rather than rendered.
 */
const toLink = (ref: BookmarkRef): BookmarkLink => {
    const href = ref.type === 'r' ? sanitizeUrl(ref.value) : ''

    return { type: ref.type, value: ref.value, href: href === 'about:blank' ? '' : href, set: ref.set }
}

const createStore = (): { store: BookmarksStore; bind: (reactive: BookmarksStore) => void } => {
    let unsubSpace: () => void = noop
    let unsubPubkey: () => void = noop
    let unsubSource: () => void = noop
    let unsubKind: () => void = noop
    let unsubProfiles: () => void = noop
    /** For which `url|pubkey` the read side is armed — `null` = for none. */
    let armedFor: string | null = null
    let controller: AbortController | null = null
    /**
     * The active space url. A closure variable and not a store field: nothing in the
     * markup needs it (`roomPins` exposes its `url` only because the pin bar renders
     * per room), and a field nobody reads is a field that goes stale unnoticed.
     */
    let url = ''
    /** The raw 10003/30003 of this relay, unfiltered; the model does the sorting. */
    let rawLists: BookmarkEventLike[] = []
    /** Three-valued space kind; `'unknown'` denies (see the module header). */
    let spaceKind: SpaceKind = 'unknown'
    /** Ids already fetched by id — never a second REQ for the same one. */
    const requested = new Set<string>()
    /** How many island nodes hold the store; see `roomPins.ts` for the `wire:navigate` race. */
    let mounts = 0

    /** Every write goes here: the raw object before {@link bind}, the reactive proxy after. */
    let self: BookmarksStore

    const store: BookmarksStore = {
        ready: false,
        loading: false,
        busy: false,
        error: '',
        canBookmark: false,
        hasPrivate: false,
        entries: [],
        links: [],

        mount(): void {
            mounts++
            if (unsubSpace !== noop) {
                return
            }
            unsubSpace = activeSpace.subscribe((nextUrl: string) => {
                if (!nextUrl) {
                    return
                }
                // The relay kind decides whether we may write at all, and it arrives
                // late. Subscribed rather than read once: a single synchronous read at
                // mount time is the documented way this surface breaks (`roomPins.ts`
                // carries the same note after it happened there).
                unsubKind()
                unsubKind = deriveSpaceKind(nextUrl).subscribe((kind: SpaceKind) => {
                    spaceKind = kind
                    recomputePermission()
                })
                // The author name of an old bookmark arrives with its profile, long
                // after the row was built. Throttled like `feeds.ts`, so a burst of
                // profiles does not rebuild the list once per profile.
                unsubProfiles()
                unsubProfiles = throttled(300, profilesByPubkey).subscribe(() => {
                    if (self.entries.some((entry) => !entry.resolved || !entry.name)) {
                        recompute()
                    }
                })
                armSource(nextUrl)
            })
            // **The pubkey is a second, independent arrival.** The list is keyed by
            // author, and the island's session store can resolve after `activeSpace`
            // has already emitted. Armed on the space alone, the first pass would take
            // the guest branch (`ready`, empty) and — because `armedFor` then holds
            // `url|`, which never changes again — stay empty for the whole session.
            // Silently: no error, no spinner, just no bookmarks.
            unsubPubkey = pubkey.subscribe(() => {
                // `canBookmark` also hangs on the pubkey — a guest may not write.
                recomputePermission()
                armSource(url)
            })
        },

        /**
         * Two latches, same reason as `roomPins.unmount`: `wire:navigate` inserts the
         * new body **before** it tears the old one down, so a bare teardown would rip
         * out the subscriptions the new node just built.
         */
        unmount(): void {
            mounts = Math.max(0, mounts - 1)
            if (mounts > 0) {
                return
            }
            teardown()
        },

        isBookmarked(value: string): boolean {
            return isBookmarked(refs(), value)
        },

        async toggle(value: string): Promise<void> {
            if (self.busy || !value) {
                return
            }
            const self_ = get(pubkey) ?? ''
            if (!self_ || !url) {
                return
            }
            // Adding always creates a message tag — this client offers no other way in.
            // Removing works for every kind of entry, which is what lets the screen drop
            // a topic or a link a foreign client put in the same list.
            const add = !self.isBookmarked(value)
            // THE GATE, and it comes back as the event body or as `null`. `canBookmark`
            // mirrors the same decision for the markup, but a store method must not
            // trust a field the markup could have gone stale on.
            const plan = planBookmarkWrite(ownBookmarkList(rawLists, self_), value, add, spaceKind)
            if (!plan) {
                return
            }
            self.busy = true
            self.error = ''
            try {
                const failure = await publishList(plan, value, add, self_)
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

    const refs = (): BookmarkRef[] => bookmarkRefs(rawLists, get(pubkey) ?? '')

    const teardown = (): void => {
        controller?.abort()
        controller = null
        unsubSource()
        unsubKind()
        unsubProfiles()
        unsubPubkey()
        unsubSpace()
        unsubSource = noop
        unsubKind = noop
        unsubProfiles = noop
        unsubPubkey = noop
        unsubSpace = noop
        armedFor = null
        url = ''
        rawLists = []
        spaceKind = 'unknown'
        requested.clear()
        self.ready = false
        self.loading = false
        self.busy = false
        self.error = ''
        self.canBookmark = false
        self.hasPrivate = false
        self.entries = []
        self.links = []
    }

    /**
     * Read source, backlog load and live subscription for one `(url, pubkey)` pair.
     *
     * Keyed and not value-compared: `activeSpace` re-emits for reasons that have nothing
     * to do with the url, and rebuilding the subscription each time would drop the live
     * REQ on the floor between two frames.
     */
    const armSource = (nextUrl: string): void => {
        if (!nextUrl) {
            return
        }
        const self_ = get(pubkey) ?? ''
        const key = `${nextUrl}|${self_}`
        if (armedFor === key) {
            return
        }
        armedFor = key
        url = nextUrl
        if (!self_) {
            // A guest has no list. Say so rather than spinning forever.
            rawLists = []
            self.ready = true
            recompute()

            return
        }
        self.loading = true
        unsubSource()
        unsubSource = derived(deriveEventsForUrl(nextUrl, bookmarkFilters(self_)), (events) =>
            events as unknown as BookmarkEventLike[],
        ).subscribe((events: BookmarkEventLike[]) => {
            rawLists = events
            recompute()
        })
        controller?.abort()
        controller = new AbortController()
        void load({ relays: [nextUrl], filters: bookmarkFilters(self_) }).then(() => {
            self.loading = false
            self.ready = true
            recompute()
        })
        void request({
            relays: [nextUrl],
            signal: controller.signal,
            filters: bookmarkFilters(self_).map((filter) => ({ ...filter, limit: 0 })),
        })
    }

    const recomputePermission = (): void => {
        self.canBookmark = Boolean(get(pubkey)) && mayWriteKind(BOOKMARKS, spaceKind)
    }

    /** Rows out of the raw lists, and a targeted fetch for whatever is still missing. */
    const recompute = (): void => {
        const all = refs()
        const workspace = Boolean(WORKSPACE_URL) && url === WORKSPACE_URL
        const messages = all.filter((ref) => ref.type === 'e')

        self.entries = messages.map((ref) =>
            toEntry(ref, app.repository.getEvent(ref.value) as TrustedEvent | undefined, workspace),
        )
        self.links = otherBookmarkRefs(all).map(toLink)
        // A non-empty `content` on our own list is the encrypted private half. We never
        // decrypt it (and never re-encrypt it, so it cannot be lost here) — but a screen
        // that silently omits entries the user made elsewhere is the worse failure, so
        // the fact is surfaced instead of hidden.
        self.hasPrivate = (ownBookmarkList(rawLists, get(pubkey) ?? '')?.content ?? '') !== ''

        const missing = bookmarkedEventIds(all).filter(
            (id) => !app.repository.getEvent(id) && !requested.has(id),
        )
        if (missing.length > 0 && url) {
            missing.forEach((id) => requested.add(id))
            // `.then(recompute)` is required, not decoration: the derivation above
            // listens on `{kinds:[10003,30003]}`, and a fetched **message** matches
            // neither. Without it the row would stay a placeholder forever — the same
            // mistake `roomPins.ts` documents at its own targeted load.
            void load({ relays: [url], filters: [{ ids: missing }] }).then(() => recompute())
        }
    }

    /**
     * Publish the planned list, then check that the relay meant its `OK`.
     *
     * The plan already carries `content` over from the existing list **unchanged** —
     * that is the whole handling of the NIP-51 private half (see the header of
     * `bookmarkModels.ts` for the `@welshman/domain` path where it can be lost).
     */
    const publishList = async (
        plan: BookmarkWrite,
        value: string,
        add: boolean,
        self_: string,
    ): Promise<string> => {
        const failure = await publishOptimistic(url, makeEvent(plan.kind, { content: plan.content, tags: plan.tags }))
        if (failure) {
            return failure
        }

        return (await confirm(value, add, self_)) ? '' : t('Der Space hat das Lesezeichen nicht übernommen.')
    }

    /**
     * Re-read the list from the relay and judge the answer.
     *
     * Deliberately `requestOne` and not `load`: the loader batches and de-duplicates by
     * filter, and a merged answer from a batch that was already in flight would be the
     * state from **before** the write. This asks the one relay directly, once.
     */
    const confirm = async (value: string, add: boolean, self_: string): Promise<boolean> => {
        let events: TrustedEvent[] = []
        try {
            events = await requestOne({
                relay: url,
                filters: [{ kinds: [BOOKMARKS], authors: [self_] }],
                autoClose: true,
                signal: AbortSignal.timeout(CONFIRM_TIMEOUT_MS),
            })
        } catch {
            // Timed out or closed by the relay — "cannot tell", not "failed".
            return true
        }
        const list = ownBookmarkList(events as unknown as BookmarkEventLike[], self_)

        return writeConfirmed(list ? list.tags : null, value, add)
    }

    return {
        store,
        bind: (reactive: BookmarksStore): void => {
            self = reactive
        },
    }
}

export function wireBookmarks(Alpine: { store: (name: string, value?: unknown) => unknown }): void {
    if (Alpine.store('bookmarks')) {
        return
    }
    const { store, bind } = createStore()
    Alpine.store('bookmarks', store)
    // From here the store writes only into the reactive proxy — same reason and same
    // shape as `wireRoomPins`/`viewport.ts`: a closure that keeps mutating the raw
    // object changes values Alpine never hears about.
    bind(Alpine.store('bookmarks') as BookmarksStore)
}
