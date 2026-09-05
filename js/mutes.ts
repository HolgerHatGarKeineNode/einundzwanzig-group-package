/**
 * `$store.mutes` — NIP-51 person mutes (kind 10000, P6), the impure half.
 *
 * The rules (what a mute list is, how its tags merge, when a write is refused, which
 * events a muted reader sees) live in `js/muteModels.ts` and run there under
 * `node --test` without a browser. What is left here is what genuinely needs welshman:
 * reading through the tracker, arming per space, publishing — and, above all, deciding
 * whether the relay actually **answered** before anything is written.
 *
 * ── The whole point of this file: kind 10000 is replaceable ──────────────────────
 *
 * One list per pubkey, every write replaces the whole thing. Writing it from an
 * incomplete picture deletes every entry we did not see — the same class as kind 3, and
 * the reason a phone and a laptop can silently un-mute each other.
 *
 * **welshman's own `MuteLists` plugin does exactly that.** Read at
 * `@welshman/app/dist/app/src/plugins/muteLists.js`: `update()` calls
 * `forceLoad(user.pubkey)`, and `makeForceLoadItem` (`@welshman/store`
 * `repository.js:449`) is `await loadItem(key); return getItem(key)` — it awaits the
 * fetch and then reads whatever happens to be in the index. An offline tab, a socket that
 * never opened, an AUTH round that swallowed the `EOSE`: all three end with `undefined`,
 * `MuteListWriter` starts from an empty list, and `mutePublicly` publishes a 10000 that
 * contains exactly one entry. There is no signal on the way out that says "we were
 * guessing". So the plugin is not used, and this module asks the question welshman does
 * not: {@link readOwnMuteList} reports whether an `EOSE` arrived, and
 * `planMuteWrite` refuses to build an event without one.
 *
 * Fail-closed on purpose. A refused mute costs one click; a mute written blind costs
 * every entry the user made anywhere else.
 *
 * ── One space, one list ─────────────────────────────────────────────────────────
 *
 * Read and write both go to the **active space relay** and nowhere else — the same
 * decision as `js/bookmarks.ts`, taken for the same reason: a NIP-51 list is global by
 * protocol, but carrying an association member's mute list onto public relays exposes
 * who they are avoiding, and the outbox route depends on a kind-10002 list many members
 * do not have. The consequence, stated rather than discovered: mutes made while one space
 * is active do not apply while another is. Reversing it is one `relays` array in
 * {@link publishMuteList}.
 *
 * ── Armed at boot, not on mount ─────────────────────────────────────────────────
 *
 * `js/bookmarks.ts` arms when its screen mounts, because only that screen reads it. This
 * one has three readers that never see each other: the settings section, the profile card
 * on every page, and the chat list itself through {@link deriveMutedPubkeys}. So it arms
 * as soon as the space and the identity are known — which is also, literally, the phase's
 * "kind 10000 is read at start".
 */
import { derived, get, type Readable } from 'svelte/store'
import { makeEvent, type Filter, type TrustedEvent } from '@welshman/util'
import { nip19 } from 'nostr-tools'
import { pubkey } from './welshmanSession.ts'
import { load, request, requestOne } from './welshmanNet.ts'
import { deriveEventsForUrl } from './repository.ts'
import { activeSpace } from './groups.ts'
import { deriveSpaceKind, type SpaceKind } from './spaceCaps.ts'
import { displayProfileByPubkey, profilesByPubkey } from './spaceProfiles.ts'
import { warmProfiles } from './profiles.ts'
import { publishOptimistic } from './publishOptimistic.ts'
import { mayWriteKind } from './relayCapability.ts'
import { t } from './i18n.ts'
import {
    MUTES,
    type MuteEventLike,
    type MuteWrite,
    mutedPubkeysOf,
    muteWriteConfirmed,
    ownMuteList,
    planMuteWrite,
} from './muteModels.ts'

/** One row of the management list in settings. */
export type MuteEntry = {
    pubkey: string
    npub: string
    name: string
}

type MutesStore = {
    /** Has a relay answered for the current space and identity? */
    ready: boolean
    busy: boolean
    /** Literal, already translated wording; `''` = none. */
    error: string
    /** May this user write a mute list on the active space at all? */
    canMute: boolean
    /** Does the list carry an encrypted private half this client neither shows nor writes? */
    hasPrivate: boolean
    /**
     * The reader's own pubkey, so the markup can leave the action off their own profile
     * card. `planMuteWrite` refuses it a second time — this field only decides whether a
     * button exists.
     */
    me: string
    entries: MuteEntry[]
    isMuted(target: string): boolean
    toggle(target: string): Promise<void>
    dismissError(): void
}

const noop = (): void => {}

/**
 * How long a read of our own list may take before we call it unanswered.
 *
 * Six seconds, the same number and the same reasoning as `CONFIRM_TIMEOUT_MS` in
 * `js/bookmarks.ts`: long enough for a cold socket plus an AUTH round on a slow line,
 * short enough that a mute click does not feel broken. Running out is not an error here —
 * it is the state in which nothing is written.
 */
export const READ_TIMEOUT_MS = 6_000

/** Every 10000 of one author, from one relay. */
export const muteFilters = (self: string): Filter[] => [{ kinds: [MUTES], authors: [self] }]

// ── The read half, shared by all three surfaces ─────────────────────────────────

/** For which `url|pubkey` the live subscription is armed — `''` = for none. */
let armedFor = ''
let liveController: AbortController | null = null

/**
 * Open the live subscription for our own mute list on this space, once per identity.
 *
 * The backlog comes through {@link readOwnMuteList} on the write path and through the
 * `load` below on arming; this subscription is what makes a mute set on another device
 * arrive without a reload.
 */
const armMuteList = (url: string, self: string): void => {
    const key = `${url}|${self}`
    if (armedFor === key) {
        return
    }
    armedFor = key
    liveController?.abort()
    liveController = null
    if (!url || !self) {
        return
    }
    liveController = new AbortController()
    void load({ relays: [url], filters: muteFilters(self) }).catch(noop)
    void request({
        relays: [url],
        signal: liveController.signal,
        filters: muteFilters(self).map((filter) => ({ ...filter, limit: 0 })),
    }).catch(noop)
}

/**
 * The muted pubkeys of the reader, on this space, reactively.
 *
 * The chat list depends on this (`js/feeds.ts deriveRoomChat`), which is also why arming
 * happens **here** and not only in the Alpine store: a room page that is opened without
 * ever touching settings must still filter. `deriveEventsForUrl` reads relay-bound
 * through the tracker, so a 10000 that reached us from a different space cannot leak into
 * this space's answer.
 *
 * A `Set` and not an array: `visibleChatEvents` asks it once per message.
 */
export const deriveMutedPubkeys = (url: string): Readable<ReadonlySet<string>> =>
    derived([deriveEventsForUrl(url, [{ kinds: [MUTES] }]), pubkey], ([$events, $self]) => {
        const self = $self ?? ''
        armMuteList(url, self)
        const list = ownMuteList($events as unknown as MuteEventLike[], self)

        return new Set(mutedPubkeysOf(list))
    })

/** What a read of our own list came back with. */
export type MuteListRead = {
    /** **Did a relay send `EOSE`?** `false` means: do not write anything. */
    answered: boolean
    list: MuteEventLike | null
}

/**
 * Read our own mute list from the relay and report whether the relay actually answered.
 *
 * Deliberately `requestOne` and not `load`: the loader batches and de-duplicates by
 * filter, so a merged answer from a batch already in flight would be the state from
 * *before* somebody else's write — and, worse for this phase, it gives no `EOSE` of its
 * own to hang the "answered" verdict on. This asks the one relay directly, once, and
 * takes its `EOSE` as the signal.
 *
 * **Absence of `EOSE` is the fail-closed case.** A hanging AUTH round swallows it (this
 * repo has measured that), an offline tab never gets it, and a `CLOSED` ends the request
 * without one. All three mean the same thing here: we do not know what the relay holds,
 * so we must not replace it.
 */
export const readOwnMuteList = async (url: string, self: string): Promise<MuteListRead> => {
    if (!url || !self) {
        return { answered: false, list: null }
    }
    let answered = false
    let events: TrustedEvent[] = []
    try {
        events = await requestOne({
            relay: url,
            filters: muteFilters(self),
            autoClose: true,
            onEose: () => {
                answered = true
            },
            signal: AbortSignal.timeout(READ_TIMEOUT_MS),
        })
    } catch {
        return { answered: false, list: null }
    }

    return { answered, list: ownMuteList(events as unknown as MuteEventLike[], self) }
}

// ── The store ───────────────────────────────────────────────────────────────────

const createStore = (): { store: MutesStore; bind: (reactive: MutesStore) => void; start: () => void } => {
    let url = ''
    let spaceKind: SpaceKind = 'unknown'
    let rawLists: MuteEventLike[] = []
    let unsubSource: () => void = noop
    let unsubKind: () => void = noop
    /** Every write goes here: the raw object before {@link bind}, the reactive proxy after. */
    let self: MutesStore

    const store: MutesStore = {
        ready: false,
        busy: false,
        error: '',
        canMute: false,
        hasPrivate: false,
        me: '',
        entries: [],

        /**
         * Read off {@link MutesStore.entries} and not off the raw list in the closure:
         * `entries` is the reactive proxy Alpine watches, the closure variable is not. A
         * predicate the markup calls has to change when the list does, or the menu keeps
         * offering "ausblenden" for somebody who already is.
         */
        isMuted(target: string): boolean {
            return self.entries.some((entry) => entry.pubkey === target)
        },

        /**
         * Mute or unmute one person.
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
                const add = !self.isMuted(target)
                const answer = await readOwnMuteList(url, me)
                // THE GATE, and it comes back as the event body or as `null`. A refused
                // plan is silent for every reason but this one — the user has to learn
                // that nothing was written, or they will believe a mute that does not
                // exist.
                const plan = planMuteWrite({
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
                const failure = await publishMuteList(plan, target, add, me)
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

    const ownList = (): MuteEventLike | null => ownMuteList(rawLists, get(pubkey) ?? '')

    /**
     * Publish the planned list, then check that the relay meant its `OK`.
     *
     * The plan carries `content` over from the existing list **unchanged** — that is the
     * entire handling of the NIP-51 private half (`muteModels.ts` header).
     */
    const publishMuteList = async (
        plan: MuteWrite,
        target: string,
        add: boolean,
        me: string,
    ): Promise<string> => {
        const failure = await publishOptimistic(url, makeEvent(plan.kind, { content: plan.content, tags: plan.tags }))
        if (failure) {
            return failure
        }
        const after = await readOwnMuteList(url, me)

        return muteWriteConfirmed(after.list ? after.list.tags : null, target, add)
            ? ''
            : t('Der Space hat die Änderung nicht übernommen.')
    }

    const recompute = (): void => {
        const list = ownList()
        const pubkeys = mutedPubkeysOf(list)
        self.entries = pubkeys.map((pk) => ({
            pubkey: pk,
            npub: npubOf(pk),
            name: displayProfileByPubkey(pk),
        }))
        // A non-empty `content` on our own list is the encrypted private half. This
        // client never decrypts it and never re-encrypts it, so it cannot be lost here —
        // but a management screen that silently omits entries the user made elsewhere is
        // the worse failure, so the fact is surfaced instead of hidden.
        self.hasPrivate = (list?.content ?? '') !== ''
        // Names arrive with their profiles, long after the row was built.
        void warmProfiles(pubkeys)
    }

    /**
     * `mayWriteKind` is asked here a SECOND time — `planMuteWrite` asks it for the write.
     * This one only decides whether the markup offers the action at all: a menu entry
     * that would do nothing is worse than no menu entry. The store method never trusts
     * this field; the plan re-decides in its own currency.
     */
    const recomputePermission = (): void => {
        self.me = get(pubkey) ?? ''
        self.canMute = Boolean(self.me) && mayWriteKind(MUTES, spaceKind)
    }

    const armSource = (nextUrl: string): void => {
        const me = get(pubkey) ?? ''
        url = nextUrl
        armMuteList(nextUrl, me)
        unsubSource()
        if (!nextUrl || !me) {
            rawLists = []
            self.ready = false
            recompute()

            return
        }
        unsubSource = deriveEventsForUrl(nextUrl, [{ kinds: [MUTES] }]).subscribe((events: TrustedEvent[]) => {
            rawLists = events as unknown as MuteEventLike[]
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
            // breaks in this repo (`roomPins.ts` carries the note after it happened).
            unsubKind()
            unsubKind = deriveSpaceKind(nextUrl).subscribe((kind: SpaceKind) => {
                spaceKind = kind
                recomputePermission()
            })
            armSource(nextUrl)
        })
        // The pubkey is a second, independent arrival: the session store can resolve
        // after `activeSpace` has already emitted. Without this the first pass would take
        // the guest branch and stay empty for the whole session — silently.
        pubkey.subscribe(() => {
            recomputePermission()
            armSource(url)
        })
        // A muted author's display name arrives with their profile.
        profilesByPubkey.subscribe(() => {
            if (self.entries.some((entry) => !entry.name)) {
                recompute()
            }
        })
    }

    return {
        store,
        bind: (reactive: MutesStore): void => {
            self = reactive
        },
        start,
    }
}

/** npub of a hex pubkey; the raw hex if it cannot be encoded. */
const npubOf = (pk: string): string => {
    try {
        return nip19.npubEncode(pk)
    } catch {
        return pk
    }
}


export function wireMutes(Alpine: { store: (name: string, value?: unknown) => unknown }): void {
    if (Alpine.store('mutes')) {
        return
    }
    const { store, bind, start } = createStore()
    Alpine.store('mutes', store)
    // From here the store writes only into the reactive proxy — same reason and same
    // shape as `wireBookmarks`/`wireRoomPins`: a closure that keeps mutating the raw
    // object changes values Alpine never hears about.
    bind(Alpine.store('mutes') as MutesStore)
    start()
}
