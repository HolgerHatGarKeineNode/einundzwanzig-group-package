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
 * {@link DmsStore.hide} and {@link DmsStore.openAdd} take it.
 *
 * Opening a NEW conversation has no row to ask, and it used to fall back to the active
 * space. **That fallback was the whole feature's ceiling.** `/spaces` pins the active
 * space to the persisted home relay (`clearEphemeralSpace()` in its `init`,
 * `bridge.ts:3515`), so on a deployment with a zooid home and a Buzz workspace the
 * question "can this space do DMs" was asked of zooid on every surface and answered no —
 * measured on the device on 2026-09-04. The target is now `chooseDmSpace` over the
 * reachable spaces (`dmModels.ts`), the same list `relevantUrls` builds here, with the
 * space in view first so a Buzz home space behaves exactly as before.
 *
 * The gate follows the same rule: {@link kindOf} answers per URL, so a command is refused
 * against a relay that is not Buzz — and against one whose NIP-11 doc has not arrived
 * (`'unknown'` denies, `relayCapability.ts`). What the gate does NOT answer is
 * authorisation: whether the viewer may write to that relay at all is the relay's
 * decision, it comes back as an `OK false`, and {@link DmsStore.error} shows it. That was
 * true before and is unchanged — a capability check is about the dialect, not about
 * membership.
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
import { activeSpace, activeSpaceView, deriveSpaceViewFor, watchSpaceRooms, type SpaceView } from './groups.ts'
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
    chooseDmSpace,
    dmListFilter,
    dmMembershipFilter,
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
    /**
     * May this client open a conversation from here at all?
     *
     * „From here" and not „on the active space": the target is whichever reachable space
     * can carry a `DM_OPEN` (`chooseDmSpace`), and the command goes to exactly that one.
     */
    canDm: boolean
    /**
     * Whether a conversation can be opened from here — three-valued, unlike
     * {@link DmsStore.canDm}, which additionally needs a signer.
     *
     * `'unknown'` means at least one reachable space is still waiting for its NIP-11 doc
     * and none has answered yes yet; a surface that reads that as „no" states a fact
     * about a relay nobody has established yet.
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

/**
 * **The dismissed conversations of this viewer — the one derivation, module level.**
 *
 * Same construction and the same reason as {@link dmNames}: the surfaces that need this
 * set live in two reactivity systems. `DmsStore.hidden` mirrors it for Alpine (rail rows,
 * the dialog), `bridge.ts` takes it as a svelte dependency for the counted room list.
 * `bridge.ts` used to build a second, identical derivation of its own — same rule,
 * different subscription — because this export did not exist yet.
 *
 * **Only 41012 and its relay-signed answer decide.** `hide_dm` sets `hidden_at` on the
 * caller's membership row; the channel and its 39000 stay exactly as they were, so the
 * kind **30622** snapshot is the only thing that says which conversations the viewer put
 * away. It is relay-signed, addressable and p-gated — `deriveRelaySignedEvents` gates on
 * `pubkey === relay.self` and {@link foldHiddenDms} takes the newest revision whose `d`
 * is the viewer.
 *
 * **Both space views, because a conversation can live on either relay.** `relevantUrls`
 * is the same list the store arms its `load()` for; the union is folded per URL, since
 * `relay.self` differs per relay.
 *
 * **It requests nothing.** The historical read (`{kinds:[30622],"#p":[self]}`) is sent by
 * `armVisibility` on mount; this reads what lands in the repository. Unmounted, the set
 * is empty — nothing is hidden, which is the safe direction: a conversation shows one
 * beat too long rather than vanishing without grounds.
 *
 * The identity change is handled by construction and not by a latch: `pubkey` is a
 * dependency, so a new viewer rebuilds the inner subscriptions with their own `#p`
 * filter instead of keeping the old ones alive.
 */
export const hiddenDms: Readable<string[]> = derived<[Readable<string>, Readable<string | undefined>], string[]>(
    [activeSpace, pubkey],
    ([$active, $me], set) => {
        const viewer = $me ?? ''
        const filters = dmVisibilityFilter(viewer)
        if (filters.length === 0) {
            set([])

            return
        }
        const byUrl = new Map<string, string[]>()
        let letzte: string[] = []
        const publish = (): void => {
            const all = new Set<string>()
            for (const hs of byUrl.values()) {
                for (const h of hs) {
                    all.add(h)
                }
            }
            const next = [...all].sort()
            // Only pass on a real change: this fires on every 30622 AND on every relay
            // document, and a fresh array each time would re-render every rail row and
            // re-run the unread derivation below it for nothing.
            if (next.length !== letzte.length || next.some((h, i) => h !== letzte[i])) {
                letzte = next
                set(next)
            }
        }
        const stops = relevantUrls($active).map((url) =>
            deriveRelaySignedEvents(url, filters).subscribe((events: TrustedEvent[]) => {
                byUrl.set(url, [...foldHiddenDms(events, app.use(Relays).get(url)?.self ?? '', viewer)])
                publish()
            }),
        )

        return () => {
            for (const stop of stops) {
                stop()
            }
        }
    },
    [],
)

const createStore = (): { store: DmsStore; bind: (reactive: DmsStore) => void } => {
    let unsubSpace: () => void = noop
    let unsubPubkey: () => void = noop
    let unsubProfiles: () => void = noop
    let unsubDirectory: () => void = noop
    let unsubConversations: () => void = noop
    let unsubHidden: () => void = noop
    let dirController: AbortController | null = null
    let listController: AbortController | null = null
    const unsubKind = new Map<string, () => void>()
    /** url → three-valued relay kind; a missing key denies (there is no doc yet). */
    const spaceKinds = new Map<string, SpaceKind>()
    /** `<url>|<viewer>` of every 30622 snapshot already asked for; see `armVisibility`. */
    const requestedVisibility = new Set<string>()
    /** The space in view — what `activeSpace` last said. NOT necessarily the DM target. */
    let activeUrl = ''
    /**
     * The relay a NEW conversation is opened on — `chooseDmSpace` over the reachable
     * spaces, `''` while none may carry a `DM_OPEN`.
     *
     * Separate from {@link activeUrl} since the DM capability stopped being a property of
     * the space in view: on `/spaces` that space is pinned to the persisted home relay
     * (`clearEphemeralSpace()`, `bridge.ts:3515`), so a zooid home with a Buzz workspace
     * had no writable DM space at all. The full reasoning is at `chooseDmSpace`.
     *
     * `canDm` and this field come out of the SAME call — a control that promises what the
     * write cannot keep is the failure mode this pairing exists to prevent.
     */
    let dmUrl = ''
    /** The last emit of the space views the dialog list is folded from; `[]` while disarmed. */
    let conversationViews: SpaceView[] = []
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

    /**
     * Hand the shared {@link hiddenDms} set over into Alpine.
     *
     * The fold itself used to sit here, over a per-URL `visibilityEvents` map. It is one
     * level up now, because `bridge.ts` needs the same answer and cannot read a reactive
     * Alpine proxy — the same split as with {@link dmNames}. What is left is the handover
     * and the one thing that has to happen with it.
     */
    const takeHidden = (next: string[]): void => {
        if (next.length === self.hidden.length && next.every((h, i) => h === self.hidden[i])) {
            return
        }
        self.hidden = next
        // The dialog's list is folded against exactly this set — a hide has to take
        // the row out of it, or the button looks broken while the list is open.
        recomputeConversations()
    }

    const recomputePermission = (): void => {
        // ONE call, three consumers: the target relay, the three-valued state the surface
        // may show, and the boolean the control hangs on. They cannot disagree because
        // they are not computed separately — see `chooseDmSpace` for why that matters.
        //
        // The candidates are the same list `relevantUrls` gives every other reader here,
        // in the same order: space in view first, workspace second. On a Buzz home space
        // the first candidate wins and nothing about the old behaviour moves.
        const choice = chooseDmSpace(relevantUrls(activeUrl).map((url) => ({ url, spaceKind: kindOf(url) })))
        dmUrl = choice.url
        // Two fields out of one question, and they are NOT the same question. `canDm`
        // answers „may I open one" — it needs a signer and denies while the NIP-11 doc is
        // missing. `dmSupport` answers „can a conversation be opened from here at all",
        // and it keeps the third value: a surface that folds `'unknown'` into „no" tells
        // someone on a slow relay that they cannot do something they can.
        self.dmSupport = choice.support
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

    /**
     * The relay the OPEN DIALOG is about: the conversation's own for `'add'`, the DM
     * target for `'new'`.
     *
     * It used to be `activeUrl` for both, which was wrong in the `'add'` case before this
     * change already — extending a conversation of the workspace relay looked up its
     * participants' profiles on the home relay, which has never heard of them.
     */
    const dialogUrl = (): string => (self.mode === 'add' ? self.forUrl : dmUrl)

    /** Register pubkeys this surface shows; see {@link ensureDmNames}. */
    const ensureNames = (pubkeys: Iterable<string>): void => ensureDmNames(dialogUrl(), pubkeys)

    /**
     * Ask the relay for this viewer's 30622 snapshot — **the request, and nothing else.**
     *
     * The derivation that used to hang here moved to the module-level {@link hiddenDms};
     * what is left is the one thing a derivation cannot do. It has to happen explicitly:
     * 30622 is addressable and p-gated, nothing else in this client requests it, and
     * `hiddenDms` would otherwise sit on an empty repository forever.
     *
     * `requestedVisibility` is keyed per `<url>|<viewer>`, so an identity change asks
     * again with the new `#p` filter instead of being latched out by a per-URL flag.
     */
    const armVisibility = (url: string): void => {
        const viewer = me()
        const filters = dmVisibilityFilter(viewer)
        if (filters.length === 0) {
            return
        }
        const key = `${url}|${viewer}`
        if (requestedVisibility.has(key)) {
            return
        }
        requestedVisibility.add(key)
        void load({ relays: [url], filters })
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
     *
     * **Against the relay the command goes to** (`url`), not against the space in view.
     * A picker fed from the home relay's directory while the conversation is opened on
     * the workspace suggests people that relay has never heard of — and it is the same
     * `13534`/`33534` read either way, just aimed at the right relay.
     */
    const armDirectory = (url: string): void => {
        if (dirController || !url) {
            return
        }
        dirController = new AbortController()
        watchSpaceDirectory(url, dirController.signal)
        unsubDirectory = deriveSpaceDirectory(url).subscribe((dir: DirectoryView) => {
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
     *
     * **And it asks for that view's rooms**, which nothing here used to do.
     * `deriveSpaceViewFor` states the obligation in its own docblock — *"Wer sie nutzt,
     * muss die Räume selbst anstoßen (`watchSpaceRooms`) — diese Ableitung liest nur"* —
     * and every other caller honours it (`rail.ts:1004`, `palette.ts:865`,
     * `bridge.ts:3677`). This one did not, and all three of those are out of reach on a
     * phone: the rail does not exist below `xl`, the palette arms on its first open, and
     * `bridge.ts:3677` is the `/forge` island. So on `/spaces` the panel folded a
     * workspace view that nobody had ever loaded, and the workspace's conversations were
     * missing from the one surface built to show them.
     *
     * The space in view brings its own watch from the page island, so only the workspace
     * is armed here. Two watches on one URL are not a new risk — the repository
     * deduplicates and the cost is one REQ (the same reckoning `rail.ts` writes down for
     * its own second watch).
     */
    const armConversations = (): void => {
        if (unsubConversations !== noop) {
            return
        }
        const views: Readable<SpaceView>[] = [activeSpaceView]
        if (hasWorkspace()) {
            views.push(deriveSpaceViewFor(WORKSPACE_URL))
            listController = new AbortController()
            watchSpaceRooms(WORKSPACE_URL, listController.signal)
        }
        unsubConversations = derived(views, ($views: SpaceView[]) => $views).subscribe((next: SpaceView[]) => {
            conversationViews = next
            recomputeConversations()
        })
    }

    const disarmConversations = (): void => {
        listController?.abort()
        listController = null
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
        unsubHidden()
        unsubSpace = noop
        unsubPubkey = noop
        unsubProfiles = noop
        unsubHidden = noop
        for (const stop of unsubKind.values()) {
            stop()
        }
        unsubKind.clear()
        spaceKinds.clear()
        // Cleared, unlike `knownNames`: this is a „already asked for" marker, and after a
        // teardown the repository read has to happen again for the next mount. `hiddenDms`
        // itself needs no cleanup here — it is module level and stops its own inner
        // subscriptions as soon as the last subscriber lets go.
        requestedVisibility.clear()
        activeUrl = ''
        dmUrl = ''
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
        // Both halves in one REQ: the DM's 39000 AND the relay-signed 39002 that makes it
        // the viewer's own. Without the second one `buildSpaceView` sorts the fresh
        // channel into the DISCOVERABLE rooms and the conversation never appears in the
        // list at all — the reasoning, and the relay's own note about why a live
        // subscription cannot deliver either of them, is at `dmMembershipFilter`.
        const filters = [...dmListFilter(me()), ...dmMembershipFilter(me())]
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
                // **An identity change has to ask again.** The filter carries
                // `#p:[<the viewer>]`, so the answer the old user got says nothing about
                // the new one. The re-read is no longer guarded by tearing subscriptions
                // down — `hiddenDms` has `pubkey` as a dependency and rebuilds itself —
                // but the REQUEST still has to be sent, and `requestedVisibility` is
                // keyed per `<url>|<viewer>` so this loop is not latched out by the
                // previous user's marker.
                for (const url of unsubKind.keys()) {
                    if (kindOf(url) === 'buzz') {
                        armVisibility(url)
                    }
                }
            })
            // The dismissed conversations, out of the shared module-level derivation
            // (see {@link hiddenDms}) — the mirror into Alpine, nothing more. The fold
            // used to live in this closure; `bridge.ts` needed the same answer and could
            // not read it from here, which is why it grew a second copy.
            unsubHidden = hiddenDms.subscribe(takeHidden)
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
            // The directory of the relay this conversation will be created on — which is
            // not necessarily the space in view; see `dmUrl`.
            armDirectory(dmUrl)
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
            armDirectory(url)
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
            // `dmUrl` and not `activeUrl`: the relay `canDm` was decided against is the
            // relay the command goes to. {@link dialogUrl} says the same thing for the
            // names; this line is the one that spends a signature, so it reads the
            // fields directly.
            const url = self.mode === 'add' ? self.forUrl : dmUrl
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
