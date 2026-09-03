/**
 * `$store.dms` — Buzz DM channels (kinds 41010/41011/41012, P7), the impure half.
 *
 * The rules (command bodies, the write gate, the OK-message parser, the hidden-set fold,
 * the title) live in `dmModels.ts` and are checked there without a browser. What is left
 * here is what genuinely needs welshman: a signer, a relay, three subscriptions and the
 * profile names that turn a participant list into a conversation title.
 *
 * ══ What this store does NOT own: the list itself ════════════════════════════════
 *
 * The rail's DM group is fed from `SpaceView.dmRooms` (`groups.ts`), not from here. A
 * DM's 39000 arrives through the ordinary room load — `watchSpaceRooms` requests
 * `{kinds:[39000,9008,39002,39001]}` without `#p`, and a member is served their own DMs'
 * discovery events on it. Building a second list here would mean two answers to "which
 * conversations do I have", and the older one would rot.
 *
 * What this store adds are the two things the ordinary load cannot give:
 *
 *  1. **The refresh after a command.** Discovery events are stored channel-scoped, and
 *     the relay says what that costs: *"live global subscriptions (e.g. `{kinds:[39000]}`)
 *     won't receive these events via fan-out. Clients discover groups via historical REQ
 *     queries"* (`side_effects.rs:1054-1057`). A conversation opened a second ago is
 *     therefore invisible to the open subscription — {@link refresh} asks for it with
 *     `dmListFilter`, the `{kinds:[39000], "#p":[self]}` the DoD names.
 *  2. **The hidden set.** 41012 sets `hidden_at` on the caller's membership row and
 *     leaves the channel untouched, so the 39000 is unchanged and the row would stay in
 *     the sidebar forever. Only the relay-signed kind 30622 says which conversations the
 *     viewer dismissed — {@link DmsStore.hidden}, folded by `foldHiddenDms`.
 *
 * ══ Which relay a command goes to ════════════════════════════════════════════════
 *
 * Not simply "the active space": the rail shows the conversations of BOTH space views
 * (home and workspace), and a hide sent to the wrong relay is answered with
 * `invalid: DM not found` — a confusing failure for a correct click. Every DM row
 * therefore carries the URL it came from (`RailRoom.spaceUrl`, set in `rail.ts`), and
 * {@link DmsStore.hide} and {@link DmsStore.openAdd} take it. Only opening a NEW
 * conversation has no row to ask, and that one uses the active space.
 *
 * The gate follows the same rule: {@link kindOf} answers per URL, so a command is refused
 * against a relay that is not Buzz — and against one whose NIP-11 doc has not arrived
 * (`'unknown'` denies, `relayCapability.ts`).
 *
 * ══ The gate comes back as the command body, not as a boolean ════════════════════
 *
 * `planDmOpen`/`planDmAddMember`/`planDmHide` answer `null` when the write must not
 * happen, so a caller that skips the question has nothing to sign — the same shape as
 * `planReminder`, `planPresence`, `planForumVote`, `planTimeout` and `planBookmarkWrite`.
 * The reason it matters for these three kinds is R3 of the plan: zooid has no kind
 * allowlist, and a 41010 written there is accepted, stored and fanned out as permanent
 * garbage that answers nobody.
 *
 * ══ Why nothing navigates after a successful open ════════════════════════════════
 *
 * Landing in the fresh conversation would be nice and is deliberately not done here.
 * Opening a room is not one line: `nostrRail.openRoom` decides between `/rooms/{h}` and
 * `/rooms/{h}?space=workspace` and sets or clears the ephemeral space, and getting that
 * wrong loads the room against the wrong relay — empty history, and a join attempt
 * answered with `invalid: group not found`. A second copy of that decision in this store
 * would be a second truth about it. The dialog closes, the refreshed list puts the
 * conversation at the top of an already-open rail group, and the existing row opens it.
 */
import * as nip19 from 'nostr-tools/nip19'
import { get } from 'svelte/store'
import { throttled } from '@welshman/store'
import { makeEvent, type TrustedEvent } from '@welshman/util'
import { app, Relays, Thunks } from './welshmanApp.ts'
import { pubkey } from './welshmanSession.ts'
import { load } from './welshmanNet.ts'
import { activeSpace } from './groups.ts'
import { deriveRelaySignedEvents } from './repository.ts'
import { deriveSpaceDirectory, watchSpaceDirectory, type DirectoryView } from './members.ts'
import { deriveSpaceKind, hasWorkspace, WORKSPACE_URL, type SpaceKind } from './spaceCaps.ts'
import { displayProfileByPubkey, loadSpaceProfiles, profilesByPubkey } from './spaceProfiles.ts'
import { mapRelayError, waitForPublishOutcome } from './publishResult.ts'
import { dispatchModal } from './modal.ts'
import { t } from './i18n.ts'
import {
    DM_ADD_MEMBER,
    DM_MAX_PARTICIPANTS,
    DM_OPEN,
    dmListFilter,
    dmTitle,
    dmVisibilityFilter,
    foldHiddenDms,
    parseDmRecipient,
    parseDmResponse,
    planDmAddMember,
    planDmHide,
    planDmOpen,
    type DmCommand,
} from './dmModels.ts'
import { mayWriteKind } from './relayCapability.ts'

/** Name of the Flux modal — shared between island and Blade, like `REMINDER_MODAL`. */
export const DM_MODAL = 'dm'

/** Which job the dialog is doing right now. */
export type DmDialogMode = 'new' | 'add'

/** One row of the participant picker. */
export type DmCandidate = {
    pubkey: string
    name: string
    picture: string
}

export type DmsStore = {
    /** May this client open a conversation on the ACTIVE space at all? */
    canDm: boolean
    /** Channel ids this viewer has dismissed (relay-signed 30622). */
    hidden: string[]
    /** A write is in flight; every control that could start a second one is disabled. */
    busy: boolean
    /** The relay's own words after a refusal, or `''`. */
    error: string
    /** `'new'` or `'add'` — which job the open dialog is doing. */
    mode: DmDialogMode
    /** For `'add'`: the conversation being extended, its relay, its participants. */
    forH: string
    forUrl: string
    forParticipants: string[]
    /** What the user typed into the participant field. */
    draft: string
    /** Who the user has picked so far, in pick order. */
    picked: string[]
    /** The space directory, as far as it is loaded — the source of {@link DmsStore.suggestions}. */
    directory: DmCandidate[]
    /** `pubkey → display name`, the reactive half of {@link DmsStore.nameOf}. */
    names: Record<string, string>

    mount(): void
    unmount(): void

    /** Display name of one participant — profile name, else a shortened pubkey. */
    nameOf(pubkey: string): string
    /** Title of a conversation, from its participants. */
    titleOf(participants: string[] | undefined): string
    /** Is this conversation dismissed? (the rail leaves it out) */
    isHidden(h: string): boolean
    /** People matching {@link DmsStore.draft} who are not already picked or in the set. */
    suggestions(): DmCandidate[]
    /** Would {@link DmsStore.addDraft} accept what is in the field right now? */
    draftIsPerson(): boolean
    /** How many more people this command may name — the relay's own ceiling. */
    remaining(): number

    openNew(): void
    openAdd(h: string, url: string, participants: string[]): void
    closeDialog(): void
    dismissError(): void

    addDraft(): void
    pick(pubkey: string): void
    unpick(pubkey: string): void

    submit(): Promise<void>
    hide(h: string, url: string): Promise<void>
}

const noop = (): void => {}

/** How many suggestions the picker shows — a dialog list, not a directory. */
const MAX_SUGGESTIONS = 8

/**
 * The URLs this store can be asked about: the space in view and, when configured, the
 * workspace. Both, because a conversation row may come from either one.
 */
const relevantUrls = (active: string): string[] => {
    const urls = active ? [active] : []
    if (hasWorkspace() && !urls.includes(WORKSPACE_URL)) {
        urls.push(WORKSPACE_URL)
    }

    return urls
}

const createStore = (): { store: DmsStore; bind: (reactive: DmsStore) => void } => {
    let unsubSpace: () => void = noop
    let unsubPubkey: () => void = noop
    let unsubProfiles: () => void = noop
    let unsubDirectory: () => void = noop
    let dirController: AbortController | null = null
    const unsubKind = new Map<string, () => void>()
    const unsubVisibility = new Map<string, () => void>()
    /** url → three-valued relay kind; a missing key denies (there is no doc yet). */
    const spaceKinds = new Map<string, SpaceKind>()
    /** url → that relay's own 30622, already gated on `pubkey === relay.self`. */
    const visibilityEvents = new Map<string, TrustedEvent[]>()
    /** The space a NEW conversation is opened on. */
    let activeUrl = ''
    /** Pubkeys whose name this surface shows — the set {@link DmsStore.names} covers. */
    const known = new Set<string>()
    /** Whose hidden set the visibility subscriptions were armed for. */
    let armedFor = ''
    /** How many island nodes hold the store; see `roomPins.ts` for the `wire:navigate` race. */
    let mounts = 0

    /** Every write goes here: the raw object before {@link bind}, the reactive proxy after. */
    let self: DmsStore

    const kindOf = (url: string): SpaceKind => spaceKinds.get(url) ?? 'unknown'

    const me = (): string => get(pubkey) ?? ''

    const recomputeHidden = (): void => {
        const viewer = me()
        const all = new Set<string>()
        for (const [url, events] of visibilityEvents) {
            for (const h of foldHiddenDms(events, app.use(Relays).get(url)?.self ?? '', viewer)) {
                all.add(h)
            }
        }
        const next = [...all].sort()
        // Only assign when the visible set actually changed: this runs on every emit of
        // the underlying derivation, and a fresh array each time would re-render every
        // rail row for nothing.
        if (next.length !== self.hidden.length || next.some((h, i) => h !== self.hidden[i])) {
            self.hidden = next
        }
    }

    const recomputePermission = (): void => {
        self.canDm = Boolean(me()) && mayWriteKind(DM_OPEN, kindOf(activeUrl))
    }

    /** Rebuild the reactive name table for everyone this surface currently shows. */
    const recomputeNames = (): void => {
        let changed = false
        const next: Record<string, string> = {}
        for (const pk of known) {
            next[pk] = displayProfileByPubkey(pk)
            if (next[pk] !== self.names[pk]) {
                changed = true
            }
        }
        if (changed || Object.keys(next).length !== Object.keys(self.names).length) {
            self.names = next
        }
    }

    /**
     * Register pubkeys whose names this surface needs, and ask the relay for the ones it
     * has not seen. `loadSpaceProfiles` deduplicates per `(url, pubkey)` itself, so this
     * is safe to call from a render path — the same property `ensureRelayProfile` relies
     * on in `groups.ts`.
     */
    const ensureNames = (pubkeys: Iterable<string>): void => {
        const fresh = [...pubkeys].filter((pk) => pk && !known.has(pk))
        if (fresh.length === 0) {
            return
        }
        for (const pk of fresh) {
            known.add(pk)
        }
        if (activeUrl) {
            void loadSpaceProfiles(activeUrl, fresh)
        }
        recomputeNames()
    }

    const armVisibility = (url: string): void => {
        if (unsubVisibility.has(url)) {
            return
        }
        const viewer = me()
        const filters = dmVisibilityFilter(viewer)
        if (filters.length === 0) {
            return
        }
        armedFor = viewer
        // The historical read has to be asked for explicitly: 30622 is addressable and
        // p-gated, nothing else in this client requests it, and the derivation below
        // would otherwise sit on an empty repository forever.
        void load({ relays: [url], filters })
        unsubVisibility.set(
            url,
            deriveRelaySignedEvents(url, filters).subscribe((events: TrustedEvent[]) => {
                visibilityEvents.set(url, events)
                recomputeHidden()
            }),
        )
    }

    const armUrl = (url: string): void => {
        if (!url || unsubKind.has(url)) {
            return
        }
        unsubKind.set(
            url,
            deriveSpaceKind(url).subscribe((kind: SpaceKind) => {
                spaceKinds.set(url, kind)
                recomputePermission()
                if (kind === 'buzz') {
                    armVisibility(url)
                }
            }),
        )
    }

    /**
     * The picker's source, armed only while the dialog is open.
     *
     * `watchSpaceDirectory` sends a REQ for 13534/33534; the palette arms it on open for
     * exactly this reason (`palette.ts:859`). Arming it at mount would cost every page
     * load a directory read for a dialog most visits never open.
     */
    const armDirectory = (): void => {
        if (dirController || !activeUrl) {
            return
        }
        dirController = new AbortController()
        watchSpaceDirectory(activeUrl, dirController.signal)
        unsubDirectory = deriveSpaceDirectory(activeUrl).subscribe((dir: DirectoryView) => {
            self.directory = dir.members.map((member) => ({
                pubkey: member.pubkey,
                name: member.name,
                picture: member.picture,
            }))
        })
    }

    const disarmDirectory = (): void => {
        dirController?.abort()
        dirController = null
        unsubDirectory()
        unsubDirectory = noop
    }

    const teardown = (): void => {
        disarmDirectory()
        unsubSpace()
        unsubPubkey()
        unsubProfiles()
        unsubSpace = noop
        unsubPubkey = noop
        unsubProfiles = noop
        for (const stop of unsubKind.values()) {
            stop()
        }
        for (const stop of unsubVisibility.values()) {
            stop()
        }
        unsubKind.clear()
        unsubVisibility.clear()
        spaceKinds.clear()
        visibilityEvents.clear()
        known.clear()
        armedFor = ''
        activeUrl = ''
        self.canDm = false
        self.hidden = []
        self.busy = false
        self.error = ''
        self.picked = []
        self.draft = ''
        self.directory = []
        self.names = {}
    }

    /**
     * Sign, publish, and read the executor's answer out of the `OK` message.
     *
     * `channelId` is `''` when the relay named none, and that is not an error: a
     * `duplicate: already processed` — the same command twice inside one second, whose
     * event id is then identical — is a successful publish with no id. The caller answers
     * it by re-reading the list rather than pointing at a channel it cannot name.
     */
    const run = async (url: string, command: DmCommand): Promise<{ error: string; channelId: string }> => {
        const thunk = app.use(Thunks).publish({
            relays: [url],
            event: makeEvent(command.kind, { tags: command.tags }),
        })
        const outcome = await waitForPublishOutcome(thunk)
        if (outcome.error) {
            return { error: mapRelayError(outcome.error), channelId: '' }
        }

        return { error: '', channelId: parseDmResponse(outcome.detail)?.channelId ?? '' }
    }

    /** Pull a freshly created conversation into the repository; see the module header. */
    const refresh = async (url: string): Promise<void> => {
        const filters = dmListFilter(me())
        if (filters.length > 0) {
            await load({ relays: [url], filters })
        }
    }

    /** Re-read the viewer's hidden set after a hide; see {@link DmsStore.hide}. */
    const refreshVisibility = async (url: string): Promise<void> => {
        const filters = dmVisibilityFilter(me())
        if (filters.length > 0) {
            await load({ relays: [url], filters })
        }
    }

    const store: DmsStore = {
        canDm: false,
        hidden: [],
        busy: false,
        error: '',
        mode: 'new',
        forH: '',
        forUrl: '',
        forParticipants: [],
        draft: '',
        picked: [],
        directory: [],
        names: {},

        mount(): void {
            mounts++
            if (unsubSpace !== noop) {
                return
            }
            unsubSpace = activeSpace.subscribe((url: string) => {
                activeUrl = url
                for (const candidate of relevantUrls(url)) {
                    armUrl(candidate)
                }
                recomputePermission()
            })
            // The pubkey is a second, independent arrival — the same trap as in
            // `reminders.ts`: armed on the space alone, the first pass would take the
            // guest branch and the visibility subscription would never be built.
            unsubPubkey = pubkey.subscribe(() => {
                recomputePermission()
                // **An identity change tears the visibility subscriptions down.** Their
                // filter carries `#p:[<the old viewer>]`, and `unsubVisibility.has(url)`
                // would otherwise keep them alive forever: the new user would see the
                // hidden set of nobody, and the relay would keep answering questions
                // about a pubkey that has left. The fold is safe in that state (it checks
                // `d === viewer`), so the failure would be silent — a conversation the
                // new user hid stays in their column until a reload.
                const viewer = me()
                if (viewer !== armedFor) {
                    for (const stop of unsubVisibility.values()) {
                        stop()
                    }
                    unsubVisibility.clear()
                    visibilityEvents.clear()
                    armedFor = viewer
                }
                recomputeHidden()
                for (const url of unsubKind.keys()) {
                    if (kindOf(url) === 'buzz') {
                        armVisibility(url)
                    }
                }
            })
            // Names are the whole point of the DM group: the relay stores `"DM"` as the
            // channel name for EVERY conversation (`buzz-db/src/dm.rs:157-162`), so
            // without profiles the sidebar is a column of identical rows.
            // `displayProfileByPubkey` is a function and not a store — it only catches up
            // when something recomputes, which is exactly what this subscription is for
            // (the note stands at its definition in `spaceProfiles.ts`). Throttled like
            // `deriveSpaceDirectory`, and for the same reason: profiles trickle in one by
            // one, and a rebuild per arrival is quadratic over the loading window.
            unsubProfiles = throttled(300, profilesByPubkey).subscribe(() => {
                recomputeNames()
            })
        },

        /**
         * Two latches, same reason as `reminders.unmount`: `wire:navigate` inserts the new
         * body **before** it tears the old one down.
         */
        unmount(): void {
            mounts = Math.max(0, mounts - 1)
            if (mounts > 0) {
                return
            }
            teardown()
        },

        nameOf(pk: string): string {
            return self.names[pk] ?? displayProfileByPubkey(pk)
        },

        titleOf(participants: string[] | undefined): string {
            const list = participants ?? []
            ensureNames(list)

            return dmTitle(list, me(), (pk) => self.nameOf(pk))
        },

        isHidden(h: string): boolean {
            return self.hidden.includes(h)
        },

        suggestions(): DmCandidate[] {
            const query = self.draft.trim().toLowerCase()
            const taken = new Set([me(), ...self.picked, ...self.forParticipants])
            const rows = self.directory.filter((c) => !taken.has(c.pubkey))
            const hits = query === ''
                ? rows
                : rows.filter((c) => c.name.toLowerCase().includes(query) || c.pubkey.startsWith(query))

            return hits.slice(0, MAX_SUGGESTIONS)
        },

        draftIsPerson(): boolean {
            const pk = parseDmRecipient(self.draft, nip19.decode)

            return Boolean(pk) && pk !== me() && !self.picked.includes(pk) && !self.forParticipants.includes(pk)
        },

        /**
         * Buzz counts the CALLER into the nine, and for an extension it counts the whole
         * existing set. Both ceilings are the relay's (`command_executor.rs:334-339` and
         * `:509-513`); the number shown here is the same one `planDmAddMember`/
         * `planDmOpen` refuse to exceed.
         */
        remaining(): number {
            const base = self.mode === 'add' ? self.forParticipants.length : 1
            const room = DM_MAX_PARTICIPANTS - base - self.picked.length

            return room > 0 ? room : 0
        },

        openNew(): void {
            if (!self.canDm) {
                return
            }
            self.mode = 'new'
            self.forH = ''
            self.forUrl = ''
            self.forParticipants = []
            self.picked = []
            self.draft = ''
            self.error = ''
            armDirectory()
            dispatchModal(DM_MODAL)
        },

        openAdd(h: string, url: string, participants: string[]): void {
            // The same gate the command itself will ask, asked before the dialog opens:
            // a form that cannot be submitted is worse than a control that stays away.
            if (!h || !mayWriteKind(DM_ADD_MEMBER, kindOf(url))) {
                return
            }
            self.mode = 'add'
            self.forH = h
            self.forUrl = url
            self.forParticipants = [...participants]
            self.picked = []
            self.draft = ''
            self.error = ''
            ensureNames(participants)
            armDirectory()
            dispatchModal(DM_MODAL)
        },

        closeDialog(): void {
            self.draft = ''
            self.picked = []
            disarmDirectory()
            dispatchModal(DM_MODAL, false)
        },

        dismissError(): void {
            self.error = ''
        },

        /** Take what is in the field, if it is a person this relay would accept. */
        addDraft(): void {
            const pk = parseDmRecipient(self.draft, nip19.decode)
            if (pk) {
                self.pick(pk)
            }
        },

        pick(pk: string): void {
            if (!pk || pk === me() || self.picked.includes(pk) || self.forParticipants.includes(pk)) {
                return
            }
            if (self.remaining() <= 0) {
                return
            }
            ensureNames([pk])
            self.picked = [...self.picked, pk]
            self.draft = ''
        },

        unpick(pk: string): void {
            self.picked = self.picked.filter((p) => p !== pk)
        },

        async submit(): Promise<void> {
            if (self.busy || self.picked.length === 0) {
                return
            }
            const url = self.mode === 'add' ? self.forUrl : activeUrl
            // THE GATE, and it comes back as the command body or as `null`. `canDm`
            // mirrors the same decision for the markup, but a store method must not trust
            // a field the markup could have gone stale on.
            const command = self.mode === 'add'
                ? planDmAddMember(self.forH, self.picked, self.forParticipants, me(), { spaceKind: kindOf(url) })
                : planDmOpen(self.picked, me(), { spaceKind: kindOf(url) })
            if (!url || !command) {
                self.error = t('Dieser Space kann keine Direktnachrichten führen.')

                return
            }
            self.busy = true
            self.error = ''
            try {
                const { error, channelId } = await run(url, command)
                if (error) {
                    self.error = error

                    return
                }
                // Refreshed either way: with a channel id it confirms the row the relay
                // just named, and without one — the exact repeat inside a second — it is
                // the only way to learn what happened.
                await refresh(url)
                if (!channelId) {
                    ensureNames(self.picked)
                }
                self.closeDialog()
            } finally {
                self.busy = false
            }
        },

        async hide(h: string, url: string): Promise<void> {
            if (self.busy) {
                return
            }
            const command = planDmHide(h, { spaceKind: kindOf(url) })
            if (!command) {
                return
            }
            self.busy = true
            self.error = ''
            try {
                const { error } = await run(url, command)
                self.error = error
                if (!error) {
                    // The relay refreshes the viewer's 30622 as a post-commit side effect
                    // (`publish_dm_visibility_snapshot`), but the snapshot is addressable
                    // and channel-less — nothing pushes it into an open subscription here.
                    // Without this read the row would stay in the rail until a reload.
                    await refreshVisibility(url)
                }
            } finally {
                self.busy = false
            }
        },
    }

    self = store

    return {
        store,
        bind: (reactive: DmsStore): void => {
            self = reactive
        },
    }
}

export function wireDms(Alpine: { store: (name: string, value?: unknown) => unknown }): void {
    if (Alpine.store('dms')) {
        return
    }
    const { store, bind } = createStore()
    Alpine.store('dms', store)
    // From here the store writes only into the reactive proxy — same reason and same
    // shape as `wirePresence`/`wireReminders`/`wireBookmarks`: a closure that keeps
    // mutating the raw object changes values Alpine never hears about.
    bind(Alpine.store('dms') as DmsStore)
}
