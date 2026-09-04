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
 * Landing in the fresh conversation would be nice and is deliberately not done here. The
 * dialog closes, the refreshed list puts the conversation at the top of the group that is
 * already open, and the existing row opens it — one place where a conversation is
 * entered, not two.
 *
 * **What DID change: the store can open a row, and does not own the rule for it.** This
 * paragraph used to end with „a second copy of that decision in this store would be a
 * second truth about it", and the decision lived inside `nostrRail.openRoom`. That was
 * right while the rail was the only surface with room rows. It is not anymore — the
 * conversation list on `/spaces` shows the same rows where the rail does not exist at all
 * (never in the NativePHP host, and only from `xl` in the web client). The rule therefore
 * MOVED to `roomNavModel.ts` (pure, node-tested) with its side effects in `navigate.ts`;
 * {@link DmsStore.openConversation} and the rail both call it. Still one truth, now in a
 * place two surfaces can reach.
 */
import * as nip19 from 'nostr-tools/nip19'
import { derived, get, type Readable } from 'svelte/store'
import { throttled } from '@welshman/store'
import { makeEvent, type TrustedEvent } from '@welshman/util'
import { app, Relays, Thunks } from './welshmanApp.ts'
import { pubkey } from './welshmanSession.ts'
import { load } from './welshmanNet.ts'
import { activeSpace, activeSpaceView, deriveSpaceViewFor, type SpaceView } from './groups.ts'
import { deriveRelaySignedEvents } from './repository.ts'
import { deriveSpaceDirectory, watchSpaceDirectory, type DirectoryView } from './members.ts'
import { deriveSpaceKind, hasWorkspace, WORKSPACE_URL, type SpaceKind } from './spaceCaps.ts'
import { displayProfileByPubkey, loadSpaceProfiles, profilesByPubkey } from './spaceProfiles.ts'
import { mapRelayError, waitForPublishOutcome } from './publishResult.ts'
import { dispatchModal } from './modal.ts'
import { openRoomAt } from './navigate.ts'
import { t } from './i18n.ts'
import {
    DM_ADD_MEMBER,
    DM_MAX_PARTICIPANTS,
    DM_OPEN,
    dmListFilter,
    dmTitle,
    dmVisibilityFilter,
    foldDmRooms,
    foldHiddenDms,
    parseDmRecipient,
    parseDmResponse,
    planDmAddMember,
    planDmHide,
    planDmOpen,
    roomDisplayName,
    type DmCommand,
    type DmNameableRoom,
} from './dmModels.ts'
import { mayWriteKind } from './relayCapability.ts'

/** Name of the Flux modal — shared between island and Blade, like `REMINDER_MODAL`. */
export const DM_MODAL = 'dm'

// ══ The participant resolution — module level, because two surfaces need it ═══════
//
// The rail and `/updates` ask the same question ("what is this conversation called")
// and used to answer it in two places, one of which — `bridge.ts joinedRoomNames` —
// answered `"DM"` for every row because that is literally what the relay stores
// (`buzz-db/src/dm.rs:157-162`). The rule now lives once in `dmModels.roomDisplayName`,
// and the profile table it resolves against lives once here.
//
// Why not inside the store's closure, where `known`/`recomputeNames` used to sit: the
// store is an ALPINE store, and `bridge.ts` builds SVELTE derivations. A derivation
// cannot read a reactive Alpine proxy and re-run on it. Both therefore read {@link
// dmNames}: the store mirrors it into `DmsStore.names` for the markup, `bridge.ts`
// takes it as a dependency. One table, one loader, two bindings.

/** Pubkeys whose display name some DM surface is currently showing. */
const knownNames = new Set<string>()

/**
 * `<url>|<pubkey>` of everyone already asked for — the request gate of
 * {@link ensureDmNames}.
 *
 * Keyed per RELAY and not per pubkey alone, which the closure-local `known` it replaces
 * was not: the rail shows the conversations of both space views, and a participant of a
 * workspace conversation used to be requested from the HOME relay (`activeUrl`) or, once
 * seen there, not at all. `loadSpaceProfiles` keys its own gate the same way; this one
 * only exists so a render path does not build the request list on every frame.
 */
const requestedNames = new Set<string>()

/**
 * `pubkey → display name` for everyone in {@link knownNames}.
 *
 * Throttled like `deriveSpaceDirectory`, and for the same reason: profiles trickle in one
 * by one, and a rebuild per arrival is quadratic over the loading window.
 *
 * **It does not emit when {@link ensureDmNames} adds a key**, and that is deliberate, not
 * an oversight. `ensureDmNames` is called from inside a svelte derivation
 * (`joinedRoomNames`); a store write from there would re-enter that derivation while it
 * is still running and its own `set` would then overwrite the newer value. Nothing is
 * lost by waiting: `loadSpaceProfiles` makes `profilesByPubkey` emit as soon as the
 * profile arrives, and until then every consumer falls back to `displayProfileByPubkey`,
 * which answers the same thing this table would have held.
 */
export const dmNames: Readable<Record<string, string>> = derived(
    throttled(300, profilesByPubkey),
    () => {
        const table: Record<string, string> = {}
        for (const pk of knownNames) {
            table[pk] = displayProfileByPubkey(pk)
        }

        return table
    },
)

/**
 * Register pubkeys whose names a DM surface needs, and ask the space for the ones it has
 * not seen.
 *
 * `loadSpaceProfiles` deduplicates per `(url, pubkey)` itself and does not touch a store
 * before its first `await`, so this is safe to call from a render path or from a
 * derivation — the same property `ensureRelayProfile` relies on in `groups.ts`.
 */
export const ensureDmNames = (url: string, pubkeys: Iterable<string>): void => {
    const fresh: string[] = []
    for (const pk of pubkeys) {
        if (!pk) {
            continue
        }
        knownNames.add(pk)
        const key = `${url}|${pk}`
        if (url && !requestedNames.has(key)) {
            requestedNames.add(key)
            fresh.push(pk)
        }
    }
    if (fresh.length > 0) {
        void loadSpaceProfiles(url, fresh)
    }
}

/**
 * The display name of a room row, resolved against a snapshot of {@link dmNames}.
 *
 * The snapshot is the argument rather than a read inside, because that is what makes the
 * caller's reactivity work: Alpine tracks the read of `$store.dms.names`, svelte tracks
 * the `dmNames` dependency. Both then hand the same table to the same rule.
 */
export const dmRoomName = (room: DmNameableRoom, self: string, names: Record<string, string>): string =>
    roomDisplayName(room, self, (pk) => names[pk] ?? displayProfileByPubkey(pk))

/** Which job the dialog is doing right now. */
export type DmDialogMode = 'new' | 'add'

/** One row of the participant picker. */
export type DmCandidate = {
    pubkey: string
    name: string
    picture: string
}

/**
 * One conversation, as the dialog lists it.
 *
 * The three fields that are not decoration: `h` and `spaceUrl` are what
 * {@link DmsStore.hide} and {@link DmsStore.openAdd} address the relay with, and
 * `dmParticipants` is what its name is made of.
 */
export type DmConversation = {
    h: string
    name: string
    isDm: boolean
    dmParticipants: string[]
    spaceUrl: string
}

export type DmsStore = {
    /** May this client open a conversation on the ACTIVE space at all? */
    canDm: boolean
    /**
     * Whether the active space does DMs — three-valued, unlike {@link DmsStore.canDm}.
     *
     * `'unknown'` means the NIP-11 doc has not arrived; a surface that reads it as „no"
     * states a fact about the relay that nobody has established yet.
     */
    dmSupport: SpaceKind
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
    /**
     * The viewer's conversations of both space views, dismissed ones removed.
     *
     * **Armed only while the dialog is open** ({@link DmsStore.openNew}), like
     * {@link DmsStore.directory} and for the same reason: it hangs off two `SpaceView`
     * derivations, and every page load would pay for a list most visits never see.
     * Outside the dialog it is `[]` — the rail builds its own rows from the same
     * `foldDmRooms`, out of the views it already holds.
     */
    conversations: DmConversation[]

    mount(): void
    unmount(): void
    /**
     * Hold {@link DmsStore.conversations} live, and release it again.
     *
     * Reference counted, because the dialog opens from the panel and both want the same
     * derivation. See `listHolders` in the factory for what breaks without the count.
     */
    armList(): void
    disarmList(): void
    /** Open a conversation row — the one rule, shared with the desktop rail. */
    openConversation(room: { h: string; spaceUrl?: string }): void

    /** Display name of one participant — profile name, else a shortened pubkey. */
    nameOf(pubkey: string): string
    /** Title of a conversation, from its participants. */
    titleOf(participants: string[] | undefined): string
    /** The name a row shows — {@link dmRoomName}, bound to this store's name table. */
    displayName(room: DmNameableRoom & { spaceUrl?: string }): string
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
    let unsubConversations: () => void = noop
    let dirController: AbortController | null = null
    const unsubKind = new Map<string, () => void>()
    const unsubVisibility = new Map<string, () => void>()
    /** url → three-valued relay kind; a missing key denies (there is no doc yet). */
    const spaceKinds = new Map<string, SpaceKind>()
    /** url → that relay's own 30622, already gated on `pubkey === relay.self`. */
    const visibilityEvents = new Map<string, TrustedEvent[]>()
    /** The space a NEW conversation is opened on. */
    let activeUrl = ''
    /** The last emit of the space views the dialog list is folded from; `[]` while disarmed. */
    let conversationViews: SpaceView[] = []
    /** Whose hidden set the visibility subscriptions were armed for. */
    let armedFor = ''
    /** How many island nodes hold the store; see `roomPins.ts` for the `wire:navigate` race. */
    let mounts = 0
    /**
     * How many surfaces currently want {@link DmsStore.conversations} to be live.
     *
     * Two of them exist since the conversations became reachable on a phone: the dialog
     * (while it is open) and the „Direkt"-panel on `/spaces` (while that tab is chosen).
     * Without the count the first `closeDialog()` would tear the list out from under the
     * panel — the dialog opens FROM the panel, so that sequence is the normal one, not an
     * edge case.
     */
    let listHolders = 0

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
            // The dialog's list is folded against exactly this set — a hide has to take
            // the row out of it, or the button looks broken while the dialog is open.
            recomputeConversations()
        }
    }

    const recomputePermission = (): void => {
        // Two fields out of one question, and they are NOT the same question. `canDm`
        // answers „may I open one" — it needs a signer and denies while the NIP-11 doc is
        // missing. `dmSupport` answers „does this relay do DMs at all", and it keeps the
        // third value: a surface that folds `'unknown'` into „no" tells someone on a slow
        // relay that the space cannot do something it can.
        self.dmSupport = kindOf(activeUrl)
        self.canDm = Boolean(me()) && mayWriteKind(DM_OPEN, self.dmSupport)
    }

    /** The dialog's list, out of the last space views and the current hidden set. */
    const recomputeConversations = (): void => {
        self.conversations = foldDmRooms(conversationViews, self.hidden).map((room) => ({
            h: room.h,
            name: room.name,
            isDm: room.isDm,
            dmParticipants: room.dmParticipants,
            spaceUrl: room.spaceUrl,
        }))
    }

    /** Register pubkeys this surface shows; see {@link ensureDmNames}. */
    const ensureNames = (pubkeys: Iterable<string>): void => ensureDmNames(activeUrl, pubkeys)

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

    /**
     * The dialog's conversation list, armed only while the dialog is open.
     *
     * Same frugality as {@link armDirectory}, for a different cost: `deriveSpaceViewFor`
     * is a fresh derivation over the whole room set and rebuilds on every activity wave.
     * The rail already holds both views and folds its own rows out of them with the same
     * {@link foldDmRooms}; a second permanent subscriber would compute the same thing
     * twice on every page.
     *
     * The workspace view only joins in when one is configured — `deriveSpaceViewFor('')`
     * would normalise an empty URL.
     */
    const armConversations = (): void => {
        if (unsubConversations !== noop) {
            return
        }
        const views: Readable<SpaceView>[] = [activeSpaceView]
        if (hasWorkspace()) {
            views.push(deriveSpaceViewFor(WORKSPACE_URL))
        }
        unsubConversations = derived(views, ($views: SpaceView[]) => $views).subscribe((next: SpaceView[]) => {
            conversationViews = next
            recomputeConversations()
        })
    }

    const disarmConversations = (): void => {
        unsubConversations()
        unsubConversations = noop
        conversationViews = []
        self.conversations = []
    }

    const teardown = (): void => {
        disarmDirectory()
        disarmConversations()
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
        // `knownNames` is deliberately NOT cleared: it is module level now, `bridge.ts`
        // feeds it too, and it holds nothing but public display names.
        armedFor = ''
        activeUrl = ''
        listHolders = 0
        self.canDm = false
        self.dmSupport = 'unknown'
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
        dmSupport: 'unknown',
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
        conversations: [],

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
            //
            // This mirrors the shared {@link dmNames} table into Alpine. The table itself
            // is module level (see the section at the top of this file) because
            // `bridge.ts` needs the same one and cannot read a reactive Alpine proxy;
            // what happens here is only the handover into the other reactivity system.
            unsubProfiles = dmNames.subscribe((next: Record<string, string>) => {
                const keys = Object.keys(next)
                const changed =
                    keys.length !== Object.keys(self.names).length || keys.some((pk) => next[pk] !== self.names[pk])
                if (changed) {
                    self.names = next
                }
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

        armList(): void {
            listHolders++
            armConversations()
        },

        disarmList(): void {
            listHolders = Math.max(0, listHolders - 1)
            if (listHolders === 0) {
                disarmConversations()
            }
        },

        /**
         * **Not a second copy of the rail's decision** — the same one, from
         * `roomNavModel.ts`. The header of this module used to explain why nothing
         * navigates from here; that held while the rail was the only surface with room
         * rows. The conversation list on `/spaces` is the second, and it exists exactly
         * where the rail does not (phone, and the web client below `xl`).
         *
         * A DM row knows its own relay (`spaceUrl`, set by `foldDmRooms`), so the
         * question the rail answers by scanning its workspace view is answered here by
         * reading the row.
         */
        openConversation(room: { h: string; spaceUrl?: string }): void {
            if (!room?.h) {
                return
            }
            openRoomAt(room.h, Boolean(room.spaceUrl) && room.spaceUrl === WORKSPACE_URL)
        },

        nameOf(pk: string): string {
            return self.names[pk] ?? displayProfileByPubkey(pk)
        },

        titleOf(participants: string[] | undefined): string {
            const list = participants ?? []
            ensureNames(list)

            return dmTitle(list, me(), (pk) => self.nameOf(pk))
        },

        /**
         * The name a row shows. Reads `self.names` through {@link dmRoomName}, so an
         * Alpine effect that calls this re-runs when a profile arrives.
         *
         * The profiles are asked of the relay the ROW came from, not of the active space:
         * a conversation of the workspace relay may well have participants the home relay
         * has never heard of.
         */
        displayName(room: DmNameableRoom & { spaceUrl?: string }): string {
            if (room.isDm) {
                ensureDmNames(room.spaceUrl || activeUrl, room.dmParticipants ?? [])
            }

            return dmRoomName(room, me(), self.names)
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
            // Only the `'new'` dialog lists the existing conversations, so only it pays
            // for them — `'add'` is one action on one conversation and shows no list.
            self.armList()
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
            // Against `url` and not the active space: this conversation may be one of the
            // workspace relay's, and its participants are then unknown at home.
            ensureDmNames(url, participants)
            armDirectory()
            dispatchModal(DM_MODAL)
        },

        closeDialog(): void {
            self.draft = ''
            self.picked = []
            disarmDirectory()
            // Only the `'new'` dialog took a hold; `'add'` never armed the list.
            if (self.mode !== 'add') {
                self.disarmList()
            }
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
