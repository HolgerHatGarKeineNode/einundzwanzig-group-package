/**
 * `nostrPalette` — die Befehlspalette (⌘K) und das Kürzel-Register.
 *
 * ── Warum ein eigenes Modul ─────────────────────────────────────────────────
 * Die Palette legt KEINEN Zustand in `nostrRoomChat` (`bridge.ts`) ab. Sie steht
 * einmal im Layout, hat ihre eigenen Abos und ihren eigenen Lebenszyklus; das
 * einzige, was `bridge.ts` von ihr weiß, ist die Registrierungszeile in
 * `registerNostrComponents`. Das war die offene Architektur-Frage von P4 — und
 * die Antwort ist: die Naht ist nicht nötig.
 *
 * ── Warum sie im Layout hängt und nicht in der Rail ─────────────────────────
 * Der ⌘K-Listener saß bis P4 in `rail.ts`. Die Rail existiert aber nur ab `xl`
 * (`<template x-if="$store.viewport.desktop">` entscheidet über die EXISTENZ des
 * Knotens) — unterhalb gab es also gar kein ⌘K. Der Listener ist deshalb
 * UMGEZOGEN, nicht kopiert: zwei Registrierungen hießen zwei Handler pro
 * Tastendruck. `Alt+↑/↓` (Raumwechsel) bleibt in der Rail, wo die Raumliste ist.
 *
 * ── Was Flux liefert und was nicht ──────────────────────────────────────────
 * `flux:command` ist ein `<ui-select filter>`: Textfilterung (diakritika-/
 * großschreibungsunempfindliche Teilzeichenkette über `textContent`),
 * Tastatur-Navigation (↑/↓/↵ über `aria-activedescendant`) und der Leerzustand
 * kommen von dort und werden hier NICHT nachgebaut. Was Flux nicht kennt, sind
 * **Sektionen**: es gibt keine Gruppen-Komponente, und eine Überschrift ist für
 * den Filter kein Element. Ihre Sichtbarkeit wird deshalb hier geführt — aber
 * abgeleitet aus Flux' eigenem Ergebnis (`[data-hidden]` an den Zeilen), nicht
 * aus einem zweiten Textabgleich.
 *
 * ── Daten erst beim ersten Öffnen ───────────────────────────────────────────
 * Die Abos (Raumliste, Directory, Space-Liste) laufen erst, wenn die Palette das
 * erste Mal aufgeht. Sonst zahlte JEDE Seite drei Relay-Requests für ein Fenster,
 * das die meisten Aufrufe nie sehen. Der Bestand ist beim Öffnen trotzdem sofort
 * da: welshman beantwortet die Ableitungen aus dem Repository (Kaltstart-Cache),
 * das Abo frischt nur nach.
 */

import { get } from 'svelte/store'
import { app, Relays } from './welshmanApp.ts'
import { pubkey } from './welshmanSession.ts'
import { type TrustedEvent } from '@welshman/util'
import type { RelayInfo } from './welshmanRelay.ts'
import { displayProfileByPubkey } from './spaceProfiles.ts'
import {
    DEFAULT_SPACE_URL,
    WORKSPACE_URL,
    activeSpaceUrl,
    clearEphemeralSpace,
    deriveSpaceViewFor,
    displayRelayUrl,
    ephemeralSpaceUrl,
    groupSpaceChoices,
    hasWorkspace,
    isVereinRelay,
    loadUserGroupList,
    setActiveSpace,
    setActiveSpaceEphemeral,
    watchSpaceRooms,
    type RoomView,
    type SpaceView,
} from './groups.ts'
import { spaceBranding } from './relayCaps.ts'
import { deriveSpaceDirectory, watchSpaceDirectory, type DirectoryView, type MemberView } from './members.ts'
import { loadMeetupPresentations, meetupPresentationBySlug } from './meetups.ts'
import { type MeetupPresentation } from './meetupPresentation.ts'
import { workspaceRoomHref } from './spaceParam.ts'
import { regionName } from './countryNames.ts'
import { dispatchModal } from './modal.ts'
import { MESSAGES_PATH, navigateTo } from './navigate.ts'
import { flashToast } from './toast.ts'
import { t } from './i18n.ts'
import { type RailGroupKey } from './railGroups.ts'
import {
    EMPTY_PALETTE_SCOPE,
    PALETTE_SECTIONS,
    hasPaletteScope,
    isPortalSection,
    isTextEntry,
    isWorkspaceScope,
    mergePaletteScope,
    parsePaletteScope,
    paletteSigil,
    recentRooms,
    scopedRooms,
    visibleSections,
    type PaletteRoom,
    type PaletteScope,
    type PaletteSection,
    type PortalSection,
} from './paletteItems.ts'
/*
 * ── Why the Portal index arrives through `import()` ──────────────────────────────
 *
 * `palette.ts` is in the BOOT path: the palette hangs in the layout, so every page of this
 * client parses it. The bundle latch (`tests/e2e/support/bundleGrenze.nodetest.ts`) measures
 * exactly that path and went red over these additions — 112 379 B gzip against a mark of
 * 112 000, and its own docblock says a second raise of that mark would be a statement about
 * the boot path rather than about the number.
 *
 * So the module is fetched when the palette OPENS (`_ensureData`, together with its data),
 * and the TYPES are imported separately — a type import is erased at build time and pulls
 * nothing into the chunk. Same pattern as `longformFeed.ts` and `directoryIsland.ts`.
 *
 * The reference is module-level and not per instance: there is one palette per document, and
 * a second instance (a `wire:navigate` rebuild) must not fetch the chunk again.
 */
import type {
    PortalIndex,
    PortalIndexRow,
    PortalKind,
} from './portalIndex.ts'

type PortalModul = typeof import('./portalIndex.ts')

let portalModul: PortalModul | null = null
import { deriveSpaceKind, type SpaceKind } from './spaceCaps.ts'
import { deriveEventsForUrl } from './repository.ts'
import { searchMessages, type SearchHit, type SearchableRow } from './search.ts'
import {
    SEARCH_CONTENT_KINDS,
    runSpaceSearch,
    toMessageHits,
    toPersonHits,
    type MessageHit,
    type PersonHit,
} from './spaceSearch.ts'

/** Der Name der beiden Flux-Modals — geteilt zwischen Insel und Blade. */
export const PALETTE_MODAL = 'command-palette'
export const SHORTCUTS_MODAL = 'shortcuts'

/** Beschriftungen der Rail-Gruppen — für den Scope-Chip, wie in `rail.ts`. */
const GROUP_LABEL: Record<RailGroupKey, string> = {
    rooms: t('Räume'),
    meetups: t('Meetups'),
    proposals: t('Projektunterstützung'),
    workspace: t('Workspace'),
    dms: t('Direktnachrichten'),
}

const SECTION_LABEL: Record<PaletteSection, string> = {
    rooms: t('Räume'),
    members: t('Mitglieder'),
    spaces: t('Spaces'),
    // D6 — the four Portal sections. "Meetups" here means the PAGE of the association
    // portal, not the room group of the same name (`m:`); the chip therefore says "Meetups
    // im Portal", so the two chips do not read alike.
    meetups: t('Meetups im Portal'),
    events: t('Termine'),
    courses: t('Kurse'),
    lecturers: t('Referenten'),
    // P5 — not „Termine" a second time: this section does not show dates to READ but dates to
    // ANSWER, and only the reader's own. Two chips reading alike would be the drift the
    // grammar of this file is built against.
    zusagen: t('Zusagen zu deinen Meetups'),
    actions: t('Aktionen'),
}

/**
 * Section → row type of the index. Two vocabularies, because they name two things: the
 * section is a surface of the palette (plural, like its siblings), the type is a field in
 * the index (singular, the way the PHP side writes it). The mapping stands HERE once
 * instead of as a `.slice(0, -1)` trick in four places.
 */
const PORTAL_KIND_OF: Record<PortalSection, PortalKind> = {
    meetups: 'meetup',
    events: 'event',
    courses: 'course',
    lecturers: 'lecturer',
}

/** Eine Zeile der Sektion „Aktionen". Kommt aus Blade (Routen + `__()`). */
export type PaletteAction = {
    id: string
    label: string
    /** Ziel-URL (absolut, aus `route()`); fehlt bei reinen Modal-Aktionen. */
    href?: string
    icon?: string
    /**
     * P5 — an action that leaves the palette OPEN and raises a scope chip instead.
     *
     * „Zusagen" is not a destination but a question („which date?"): it raises the `z:`
     * chip and lists the dates of the reader's own meetups. An `href` would have needed a
     * page for that, and there is none — the list lives in the palette.
     */
    scope?: PaletteSection
}

export type PaletteSpace = { url: string; label: string; hint: string; active: boolean }

// ── P5: Workspace-Suche ─────────────────────────────────────────────────────

/**
 * Eine Zeile der SOFORT-Treffer: aus dem bereits geladenen Bestand, ohne Netz,
 * bei jedem Tastendruck neu. Sie ist die ehrliche Ergänzung zur Relay-Suche,
 * kein Notnagel — der Relay kann konstruktionsbedingt kein Typeahead
 * (`SearchMode::FullText` fest verdrahtet, `buzz/…/handlers/req.rs:627`), und
 * ohne diese Liste stünde das Feld bis zum Enter stumm da.
 */
export type InstantRow = SearchableRow & {
    /** Raum oder Nachricht — entscheidet Symbol, Rangfolge und Ziel. */
    sort: 'room' | 'message'
    /** Kanal-UUID: bei `'room'` der Raum selbst, bei `'message'` sein Kanal. */
    h: string
    pubkey: string
}

export type InstantHit = SearchHit<InstantRow>

/** Höchstzahl Sofort-Treffer. Bewusst klein: darunter steht die Relay-Liste. */
const INSTANT_LIMIT = 12

/**
 * Kinds, deren geladener Bestand die Sofort-Treffer trägt — dieselben, die auch
 * an den Relay gehen. Zwei Listen wären zwei Wahrheiten über dieselbe Frage.
 */
const INSTANT_FILTERS = [{ kinds: [...SEARCH_CONTENT_KINDS] }]

type PaletteConfig = { actions?: PaletteAction[] }

const EMPTY_DIRECTORY: DirectoryView = { ready: false, members: [], roles: [] }

/** `SpaceView` → flache Palette-Räume; `joined` kommt aus der Herkunftsliste. */
const toPaletteRooms = (view: SpaceView | null, workspace: boolean): PaletteRoom[] => [
    ...(view?.userRooms ?? []).map((r: RoomView) => ({ ...r, joined: true, workspace })),
    ...(view?.otherRooms ?? []).map((r: RoomView) => ({ ...r, joined: false, workspace })),
]

/**
 * The NIP-17 store, if it is already there — `undefined` otherwise.
 *
 * Through `window.Alpine.store` rather than an import, for the same reason as in
 * `rail.ts`: `privateMessages.ts` lives in its own chunk, and a static import would pull
 * it into the boot path.
 */
type PrivateMessagesLese = {
    conversations?: readonly { key: string; title: string }[]
}

const privateMessagesStore = (): PrivateMessagesLese | undefined =>
    (window as unknown as { Alpine?: { store(n: string): unknown } }).Alpine?.store('privateMessages') as
        | PrivateMessagesLese
        | undefined

/**
 * The third pot: the encrypted conversations (NIP-17) as palette rows.
 *
 * **What P8 changed.** Until P7 the Buzz DM channels of both space views stood here,
 * deduplicated and stripped of the ones put away with a 41012, and their NAME had to be
 * built right here: the relay stored the literal `"DM"` for every conversation. Both are
 * gone. A NIP-17 conversation exists only in this tab's memory, has no relay-given name
 * and no second view it could arrive from twice — the store hands over the finished,
 * deduplicated list including the resolved `title`.
 *
 * `isPrivateDm` sends the click to `/messages` (`openRoom` below). Without that marker it
 * would run into `/rooms/<conversationKey>`, a room no relay knows.
 */
const toPaletteDms = (): PaletteRoom[] =>
    (privateMessagesStore()?.conversations ?? []).map((row) => ({
        h: row.key,
        name: row.title,
        isDm: true,
        isPrivateDm: true,
        joined: true,
        workspace: false,
    }))

/** `route()` liefert absolute URLs; der Auth-Gate will den reinen „/…"-Pfad. */
const pathOf = (href: string): string => {
    try {
        const url = new URL(href, window.location.origin)

        return url.pathname + url.search
    } catch {
        return href
    }
}

type AuthGateStore = { requireAuth(intent: { label?: string; returnUrl?: string; resume?: () => void }): boolean }

const authGate = (): AuthGateStore | undefined =>
    (window as unknown as { Alpine?: { store(n: string): AuthGateStore | undefined } }).Alpine?.store('authGate')

/**
 * The two stores the „Zusagen" section reads, reached the same way as `authGate` above:
 * through `window.Alpine` and not through an import.
 *
 * That is deliberate and it is the containment: `palette.ts` sits in the boot path of every
 * page, and a static import of `pinSetSync.ts`/`rsvpTermine.ts` would pull their welshman
 * halves in with it. Both stores are registered by `bridge.ts` before any component is
 * evaluated (`registerNostrComponents`), so the lookup never comes up empty in the browser —
 * and where it does (a unit test without Alpine), the section is simply empty.
 */
const pinSetStore = (): { keys: string[] } | null =>
    (window as unknown as { Alpine?: { store(n: string): { keys?: string[] } | undefined } })
        .Alpine?.store('pinSet') as { keys: string[] } | null ?? null

type RsvpStoreLike = {
    hinweisOffen: boolean
    row(address: string): { myStatus: string } | undefined
    track(address: string): void
    rsvp(address: string, status: 'accepted' | 'declined' | 'tentative'): void
}

const rsvpStore = (): RsvpStoreLike | null =>
    (window as unknown as { Alpine?: { store(n: string): RsvpStoreLike | undefined } })
        .Alpine?.store('rsvpTermine') ?? null

export type PaletteState = {
    /** Ist der Dialog offen? Spiegelt den `<dialog>`, führt ihn nicht. */
    shown: boolean
    query: string
    scope: PaletteScope
    actions: PaletteAction[]
    presentations: Record<string, MeetupPresentation>
    _space: SpaceView | null
    _workspace: SpaceView | null
    _spaceUrls: string[]
    _relays: Map<string, RelayInfo>
    _directory: DirectoryView
    /** The viewer; never their own counterparty. */
    _me: string
    _url: string
    _wired: boolean
    _unsubActive: (() => void) | null
    _unsubView: (() => void) | null
    _unsubWorkspace: (() => void) | null
    _unsubSpaces: (() => void) | null
    _unsubRelays: (() => void) | null
    _unsubDirectory: (() => void) | null
    _unsubMe: (() => void) | null
    _unsubMeetups: (() => void) | null
    _controller: AbortController | null
    _wsController: AbortController | null
    _dirController: AbortController | null
    _onKey: ((e: KeyboardEvent) => void) | null
    _observer: MutationObserver | null
    _syncQueued: boolean
    // ── P5: Workspace-Suche ─────────────────────────────────────────────────
    /** Relay-Art des Workspace: `'unknown'` heißt Skeleton, nicht „geht nicht". */
    spaceKind: SpaceKind
    /** Läuft gerade eine Relay-Anfrage? */
    searching: boolean
    /** Wurde in dieser Runde überhaupt schon gesucht? */
    searchRan: boolean
    /** Haben beide Anfragen EOSE gesehen? Trennt „nichts da" von „keine Antwort". */
    searchComplete: boolean
    /** Grund einer Relay-Ablehnung (`CLOSED`), sonst `null`. */
    searchRejected: string | null
    /** Der Text, mit dem zuletzt gesucht wurde (nicht der im Feld stehende). */
    searchQuery: string
    /** The ONE Portal index of this session (D6) — empty until the load is through. */
    portal: PortalIndex | null
    searchMessages: MessageHit[]
    searchPeople: PersonHit[]
    _wsEvents: TrustedEvent[]
    _unsubWsEvents: (() => void) | null
    _unsubSpaceKind: (() => void) | null
    _searchController: AbortController | null
    readonly sigil: string
    readonly hasScope: boolean
    readonly scopeLabel: string
    readonly roomItems: PaletteRoom[]
    readonly memberItems: MemberView[]
    readonly spaceItems: PaletteSpace[]
    readonly actionItems: PaletteAction[]
    /** The four Portal sections, filtered IN THE BROWSER (D6 — the query stays here). */
    readonly meetupItems: PortalIndexRow[]
    readonly eventItems: PortalIndexRow[]
    readonly courseItems: PortalIndexRow[]
    readonly lecturerItems: PortalIndexRow[]
    /** Steht die Palette im Workspace-Scope UND gibt es einen Workspace? */
    readonly workspaceActive: boolean
    readonly instantHits: InstantHit[]
    readonly searchHitCount: number
    shows(section: PaletteSection): boolean
    runWorkspaceSearch(): void
    onEnter(): void
    resetSearch(): void
    openInstant(hit: InstantHit): void
    openMessageHit(hit: MessageHit): void
    openPersonHit(hit: PersonHit): void
    open(): void
    close(): void
    toggle(): void
    onClose(): void
    onEscape(): void
    lift(): void
    clearScope(): void
    openRoom(room: PaletteRoom): void
    openMember(member: MemberView): void
    openSpace(space: PaletteSpace): void
    runAction(action: PaletteAction): void
    portalRows(section: PortalSection): PortalIndexRow[]
    portalHint(row: PortalIndexRow): string
    openPortal(row: PortalIndexRow): void
    /** P5: the dates of the reader's OWN meetups that a kind 31925 can answer. */
    readonly zusagenItems: PortalIndexRow[]
    /** The user's own answer to one of those rows ('' = none yet). */
    zusageStatus(row: PortalIndexRow): string
    /** Publish the answer. Opens the disclosure first where it is still owed. */
    zusagen(row: PortalIndexRow): void
    openShortcuts(): void
    _go(href: string, label: string): void
    _dmItems(): PaletteRoom[]
    _hintFor(room: PaletteRoom): string
    _el(): HTMLElement | null
    _syncHeadings(): void
    _queueHeadingSync(): void
    _ensureData(): void
    init(): void
    destroy(): void
}

/**
 * Zwei TypeScript-Eigenheiten wie in `rail.ts`: das Literal wird DIREKT
 * zurückgegeben (sonst ist `this` in den Methoden `{}`), und jeder Getter pinnt
 * sein `this` selbst per `const self = this as PaletteState` — Alpine reicht den
 * reaktiven Proxy als `this` herein, eine Closure-Variable verlöre genau die
 * Reaktivität, für die der Getter da ist.
 */
export const createPalette = (config: PaletteConfig = {}): PaletteState => ({
    shown: false,
    query: '',
    scope: { ...EMPTY_PALETTE_SCOPE },
    actions: config.actions ?? [],
    presentations: {},
    _space: null,
    _workspace: null,
    _spaceUrls: [],
    _relays: new Map(),
    _directory: EMPTY_DIRECTORY,
    _me: '',
    _url: DEFAULT_SPACE_URL,
    _wired: false,
    _unsubActive: null,
    _unsubView: null,
    _unsubWorkspace: null,
    _unsubSpaces: null,
    _unsubRelays: null,
    _unsubDirectory: null,
    _unsubMe: null,
    _unsubMeetups: null,
    _controller: null,
    _wsController: null,
    _dirController: null,
    _onKey: null,
    _observer: null,
    _syncQueued: false,
    spaceKind: 'unknown',
    searching: false,
    searchRan: false,
    searchComplete: false,
    searchRejected: null,
    searchQuery: '',
    portal: null,
    searchMessages: [],
    searchPeople: [],
    _wsEvents: [],
    _unsubWsEvents: null,
    _unsubSpaceKind: null,
    _searchController: null,

    get sigil(): string {
        return paletteSigil((this as PaletteState).scope)
    },

    get hasScope(): boolean {
        return hasPaletteScope((this as PaletteState).scope)
    },

    /** „Meetups · Österreich", „Räume", „Mitglieder" — die Beschriftung des Chips. */
    get scopeLabel(): string {
        const self = this as PaletteState
        const parts: string[] = []
        if (self.scope.group !== null) {
            parts.push(GROUP_LABEL[self.scope.group])
        } else if (self.scope.section !== null && self.scope.section !== 'rooms') {
            parts.push(SECTION_LABEL[self.scope.section])
        } else if (self.scope.section === 'rooms' && self.scope.country === '') {
            parts.push(SECTION_LABEL.rooms)
        }
        if (self.scope.country !== '') {
            parts.push(regionName(self.scope.country))
        }

        return parts.join(' · ')
    },

    get roomItems(): PaletteRoom[] {
        const self = this as PaletteState
        if (!self.shows('rooms')) {
            return []
        }

        const all = [
            ...toPaletteRooms(self._space, false),
            ...toPaletteRooms(self._workspace, true),
            ...self._dmItems(),
        ]
        // Ruhezustand: die zuletzt benutzten fünf. Sobald gesucht oder eingegrenzt
        // wird, der volle Bestand — Flux blendet daraus aus, was nicht passt.
        const shown = !self.hasScope && self.query.trim() === ''
            ? recentRooms(all)
            : scopedRooms(all, self.scope, (r) => self.presentations[r.meetupSlug ?? '']?.country ?? '')

        return shown.map((r) => ({ ...r, hint: self._hintFor(r) }))
    },

    get memberItems(): MemberView[] {
        const self = this as PaletteState

        return self.shows('members') ? self._directory.members : []
    },

    /**
     * Dieselbe Auswahl, die die Einstellungen anbieten (`groupSpaceChoices`: der
     * feste Default plus die beigetretenen, gefiltert auf NIP-29-fähige Relays) —
     * eine Wahrheit darüber, wohin man wechseln kann. Der Name kommt aus dem
     * NIP-11-Profil, sonst steht der Host für sich selbst.
     */
    get spaceItems(): PaletteSpace[] {
        const self = this as PaletteState
        if (!self.shows('spaces')) {
            return []
        }

        return self._spaceUrls.map((url) => {
            const host = displayRelayUrl(url)
            const active = url === self._url

            return {
                url,
                label: spaceBranding(host, self._relays.get(url)).label || host,
                // Der Space, in dem man gerade steht, ist als solcher markiert —
                // sonst wählt man ihn und nichts passiert sichtbar.
                hint: active ? `${t('aktiv')} · ${host}` : host,
                active,
            }
        })
    },

    get actionItems(): PaletteAction[] {
        const self = this as PaletteState

        return self.shows('actions') ? self.actions : []
    },

    // ── P4/D6: the four Portal sections ─────────────────────────────────────

    get meetupItems(): PortalIndexRow[] {
        return (this as PaletteState).portalRows('meetups')
    },

    get eventItems(): PortalIndexRow[] {
        return (this as PaletteState).portalRows('events')
    },

    get courseItems(): PortalIndexRow[] {
        return (this as PaletteState).portalRows('courses')
    },

    get lecturerItems(): PortalIndexRow[] {
        return (this as PaletteState).portalRows('lecturers')
    },

    // ── P5/D12: „Zusagen" — answering a date from the palette ───────────────

    /**
     * The dates of the reader's OWN meetups that this client may answer.
     *
     * „Own" is the union of two statements the reader has already made: the meetups he
     * PINNED (D7, `$store.pinSet`) and the meetups whose ROOM he joined. „The next dates of
     * the whole association" would be a list of strangers' meetups 600 km away — and every
     * row of it an invitation to a public, permanent answer to a date he has no relation to.
     *
     * The rows come out of the SAME index as the four Portal sections and carry the 31923
     * coordinate (`a`), which the server only fills where the meetup allows an answer at all
     * (`BuildsPortalIndex`: `rsvp_enabled` AND `attendees_public`). Whether the relays really
     * hold that event is decided at the moment of the answer, by the shared rule.
     */
    get zusagenItems(): PortalIndexRow[] {
        const self = this as PaletteState
        // The reactive reads FIRST — Alpine records a getter's dependencies while it RUNS, and
        // a guard in front of them would leave this getter without any (the measured „right
        // rows, zero options" failure of P4).
        const rows = self.portal?.rows ?? []
        const pinned = (pinSetStore()?.keys ?? [])
            .filter((key: string) => key.startsWith('meetup:'))
            .map((key: string) => key.slice('meetup:'.length))
        const joined = (self._space?.userRooms ?? [])
            .map((room: RoomView) => room.meetupSlug)
            .filter((slug: string) => slug !== '')
        if (portalModul === null || rows.length === 0 || !self.shows('zusagen')) {
            return []
        }

        return portalModul.answerableDates(
            rows,
            Array.from(new Set([...pinned, ...joined])),
            portalModul.nowIndexKey(),
        )
    },

    zusageStatus(row: PortalIndexRow): string {
        return rsvpStore()?.row(row.a)?.myStatus ?? ''
    },

    /**
     * Answer this date — through the SAME store and the same publish path as every other RSVP
     * surface (`$store.rsvpTermine`), so the disclosure, the relay set and the „one answer per
     * person" fold cannot differ between the palette and the meetup page.
     *
     * The palette stays OPEN: the row's state changes in place (the store's `myStatus`), and
     * somebody who wants to answer three dates should not have to press ⌘K three times. The
     * disclosure, where it is still owed, appears on the surface that owns it — so the palette
     * closes and lands on the date's meetup page, which carries the sentence and the buttons.
     */
    zusagen(row: PortalIndexRow): void {
        const store = rsvpStore()
        if (store === null || row.a === '') {
            return
        }
        store.track(row.a)
        if (store.hinweisOffen) {
            // The sentence has to be READ before the first answer, and a palette row is not a
            // place to read a paragraph. So this one press leads to the meetup page instead of
            // publishing — with the address in scope, where the disclosure and the button sit
            // next to each other.
            (this as PaletteState).openPortal(row)

            return
        }
        store.rsvp(row.a, 'accepted')
    },

    /**
     * The rows of one Portal section — out of the ONE loaded index, filtered here in the
     * browser (D6: the typed query never leaves the device).
     *
     * Without an index (load still in flight, Portal unreachable) the list is empty and the
     * section does not appear at all — the palette stays fully usable, rooms, members and
     * actions do not depend on the Portal.
     */
    portalRows(section: PortalSection): PortalIndexRow[] {
        const self = this as PaletteState
        /*
         * ── The REACTIVE fields are read FIRST, and that is not style ────────────
         *
         * Alpine records the dependencies of a getter while it RUNS. A guard on the lazily
         * loaded module in front of these two reads returns before either of them is
         * touched — the effect then has no dependency on `portal` or `query`, and setting
         * the index later re-renders NOTHING. Measured exactly like that: the island held
         * the right rows (`meetupItems.length === 1`) while the DOM had zero options, and
         * the E2E spec was the only thing that saw it.
         */
        const rows = self.portal?.rows ?? []
        const query = self.query
        if (portalModul === null || rows.length === 0 || !self.shows(section)) {
            return []
        }

        return portalModul.filterPortalIndex(rows, PORTAL_KIND_OF[section], query)
    },

    /**
     * The date when there is one, otherwise the subtitle — the right-aligned hint.
     *
     * Only ever called from a rendered Portal row, and such a row exists only once the module
     * is there; the `?? ''` is the honest answer for the impossible case rather than a throw
     * inside a render.
     */
    portalHint(row: PortalIndexRow): string {
        return portalModul?.portalHint(row) ?? ''
    },

    /**
     * Open a Portal row. A DATE leads into its meetup: there is deliberately no page per
     * date (D9), and its reference IS the meetup slug.
     */
    openPortal(row: PortalIndexRow): void {
        if (portalModul === null) {
            return
        }
        (this as PaletteState)._go(portalModul.portalHref(row), row.n)
    },

    shows(section: PaletteSection): boolean {
        const self = this as PaletteState

        return visibleSections(self.scope, self.query).includes(section)
    },

    // ── P5: Workspace-Suche ─────────────────────────────────────────────────

    /**
     * `hasWorkspace()` entscheidet SYNCHRON und ohne Netz (Ebene 1 aus
     * `spaceCaps.ts`) — kein NIP-11 im kritischen Pfad, also kein Mount-Rennen.
     * Ob der Relay wirklich Buzz spricht (und damit NIP-50 kann), steht in
     * {@link PaletteState.spaceKind} und ist dreiwertig; die Fläche existiert
     * währenddessen bereits und zeigt ein Skeleton.
     */
    get workspaceActive(): boolean {
        const self = this as PaletteState

        return hasWorkspace() && isWorkspaceScope(self.scope)
    },

    /**
     * Die Sofort-Treffer: Workspace-Räume und der geladene Nachrichtenbestand,
     * durch `search.ts` gefiltert — diakritika-blind, UND über alle Begriffe,
     * Autorname zählt mit. Ohne Netz, ohne Entprellung, bei jedem Tastendruck.
     *
     * Räume stehen vor Nachrichten: wer `w:` tippt, will meistens hinspringen,
     * nicht lesen. Innerhalb beider Gruppen bleibt die Ordnung von
     * `searchMessages` (neueste zuerst).
     */
    get instantHits(): InstantHit[] {
        const self = this as PaletteState
        if (!self.workspaceActive || self.query.trim() === '') {
            return []
        }

        // Direkt aus der `SpaceView` und nicht über `toPaletteRooms`: die
        // Beschreibung (`about`) gehört zu `RoomView`, nicht zu `RailRoom` — sie
        // fiele auf dem Weg über den Palette-Typ weg, und genau sie macht einen
        // Raum über sein Thema auffindbar.
        const roomViews: RoomView[] = [
            ...(self._workspace?.userRooms ?? []),
            ...(self._workspace?.otherRooms ?? []),
        ]
        const rooms: InstantRow[] = roomViews.map((room) => ({
            id: `room:${room.h}`,
            sort: 'room',
            h: room.h,
            pubkey: '',
            text: room.about,
            name: room.name,
            created_at: room.lastMessageAt ?? 0,
        }))
        const messages: InstantRow[] = self._wsEvents.map((event) => ({
            id: event.id,
            sort: 'message',
            h: event.tags.find((tag) => tag[0] === 'h')?.[1] ?? '',
            pubkey: event.pubkey,
            text: event.content,
            name: displayProfileByPubkey(event.pubkey),
            created_at: event.created_at,
        }))

        const { hits } = searchMessages([...rooms, ...messages], self.query, INSTANT_LIMIT)

        return [...hits.filter((hit) => hit.sort === 'room'), ...hits.filter((hit) => hit.sort === 'message')]
    },

    get searchHitCount(): number {
        const self = this as PaletteState

        return self.searchMessages.length + self.searchPeople.length
    },

    /**
     * Eine Runde Relay-Suche. **Auf Enter, nicht pro Tastendruck** — der Relay
     * kann kein Präfix-Matching (`SearchMode::FullText`, `req.rs:627`), ein
     * Roundtrip je Taste lieferte also bis zum letzten Buchstaben nichts und
     * verbrauchte dabei Buzz' Frame-Budget.
     *
     * Der laufende Lauf wird bei jedem neuen abgebrochen; `runSpaceSearch`
     * reicht das Signal an beide Anfragen durch.
     */
    runWorkspaceSearch(): void {
        const self = this as PaletteState
        const query = self.query.trim()
        if (!self.workspaceActive || query === '') {
            self.resetSearch()

            return
        }

        self._searchController?.abort()
        const controller = new AbortController()
        self._searchController = controller
        self.searchQuery = query
        self.searching = true
        self.searchRan = true
        self.searchComplete = false
        self.searchRejected = null
        self.searchMessages = []
        self.searchPeople = []

        void runSpaceSearch(WORKSPACE_URL, { q: query }, controller.signal)
            .then((outcome) => {
                if (controller.signal.aborted) {
                    return
                }
                self.searching = false
                self.searchComplete = outcome.complete
                self.searchRejected = outcome.rejected
                self.searchMessages = toMessageHits(outcome.messages, query, displayProfileByPubkey)
                self.searchPeople = toPersonHits(outcome.profiles, query)
            })
            .catch((error: unknown) => {
                if (controller.signal.aborted) {
                    return
                }
                self.searching = false
                // Kein erfundener Grund: was der Fehler sagt, steht da — mehr
                // wissen wir an dieser Stelle nicht.
                self.searchRejected = error instanceof Error ? error.message : String(error)
            })
    },

    /**
     * Enter im Feld. Außerhalb des Workspace-Scopes passiert hier NICHTS: dort
     * trägt Flux die Auswahl (`handleKeyboardSelection`), und ein zweiter
     * Handler wäre eine zweite Wahrheit über dieselbe Taste.
     */
    onEnter(): void {
        const self = this as PaletteState
        if (self.workspaceActive) {
            self.runWorkspaceSearch()
        }
    },

    resetSearch(): void {
        const self = this as PaletteState
        self._searchController?.abort()
        self._searchController = null
        self.searching = false
        self.searchRan = false
        self.searchComplete = false
        self.searchRejected = null
        self.searchQuery = ''
        self.searchMessages = []
        self.searchPeople = []
    },

    /** Sofort-Treffer öffnen — Raum direkt, Nachricht über ihren Kanal. */
    openInstant(hit: InstantHit): void {
        const self = this as PaletteState
        if (hit.sort === 'room') {
            self.openRoom({ h: hit.h, name: hit.name, workspace: true } as PaletteRoom)

            return
        }
        self.openMessageHit({ h: hit.h, name: hit.name } as MessageHit)
    },

    /**
     * Ein Nachrichten-Treffer führt in seinen Kanal. Eine Sprungmarke auf das
     * einzelne Ereignis gibt es bewusst nicht: der Raum lädt sein eigenes
     * Fenster, und ein Deep-Link auf eine Nachricht, die dort noch gar nicht
     * geladen ist, führte in eine leere Stelle statt zum Treffer.
     */
    openMessageHit(hit: MessageHit): void {
        const self = this as PaletteState
        if (!hit.h) {
            self.close()

            return
        }
        setActiveSpaceEphemeral(WORKSPACE_URL)
        self._go(workspaceRoomHref(hit.h), hit.name || hit.h)
    },

    /** Personen-Treffer → dieselbe Profilkarte wie die Mitglieder-Sektion. */
    openPersonHit(hit: PersonHit): void {
        this.close()
        window.dispatchEvent(new CustomEvent('open-profile', { detail: hit.pubkey }))
    },

    // ── Öffnen/Schließen ────────────────────────────────────────────────────

    open(): void {
        this._ensureData()
        this.query = ''
        this.scope = { ...EMPTY_PALETTE_SCOPE }
        // Das Feld direkt leeren, nicht nur `query`: Flux hängt seinen Filter an
        // den `value`-Setter des Inputs (`filterResultsByInput`), und Alpines
        // `x-model` schreibt nur bei einer ÄNDERUNG von `query` zurück. Ohne das
        // stünde beim zweiten Öffnen die alte Suche samt alter Filterung da.
        const input = this._el()?.querySelector<HTMLInputElement>('[data-palette-input]')
        if (input) {
            input.value = ''
        }
        this.resetSearch()
        this.shown = true
        dispatchModal(PALETTE_MODAL)
    },

    close(): void {
        // Ein laufender Such-Roundtrip gehört zur offenen Palette. Bleibt er
        // stehen, schreibt er beim nächsten Öffnen in eine Fläche, die eine
        // andere Frage stellt.
        this.resetSearch()
        this.shown = false
        dispatchModal(PALETTE_MODAL, false)
    },

    toggle(): void {
        if (this.shown) {
            this.close()
        } else {
            this.open()
        }
    },

    /** Der `<dialog>` ist auch über Escape und Backdrop zu; das ist der eine Ausgang. */
    onClose(): void {
        this.shown = false
    },

    /** Escape in drei Stufen: Text leeren → Scope lösen → Palette schließen. */
    onEscape(): void {
        if (this.query !== '') {
            this.query = ''
            // Die Trefferliste gehört zum Suchtext, nicht zur offenen Palette:
            // ein geleertes Feld über einer stehen gebliebenen Trefferliste wäre
            // eine Antwort auf eine Frage, die niemand mehr stellt.
            this.resetSearch()

            return
        }
        if (this.hasScope) {
            this.clearScope()

            return
        }
        this.close()
    },

    // ── Grammatik ───────────────────────────────────────────────────────────

    /**
     * Token-Lift: ein getipptes `@`, `>`, `m:` oder `de:` wandert aus dem Feld in
     * den Chip. Läuft am `input`-Ereignis, NICHT in einem `$watch` auf `query` —
     * der Lift schreibt `query` selbst, ein Watch riefe sich rekursiv auf
     * (dieselbe Begründung wie `rail.liftToken`).
     */
    lift(): void {
        const { scope, rest } = parsePaletteScope(this.query)
        if (scope.section === null) {
            return
        }
        // **Hier stand kurz eine Sperre „`w:` nur mit konfiguriertem Workspace"**
        // — sie ist wieder raus, und der Grund steht in
        // `command-palette.spec.ts:260`: der Chip soll auch OHNE Workspace
        // greifen („auch ohne dass eine Zeile erscheint"). Das ist eine
        // ausdrücklich geprüfte Zusage, kein Versehen. Ohne Workspace bleibt es
        // damit beim alten Verhalten: Chip da, keine Zeile, „Nichts gefunden."
        // — die Suchfläche hängt an `workspaceActive` und erscheint nicht.
        this.scope = mergePaletteScope(this.scope, scope)
        this.query = rest
        this.resetSearch()
    },

    clearScope(): void {
        this.scope = { ...EMPTY_PALETTE_SCOPE }
        this.resetSearch()
    },

    // ── Ziele ───────────────────────────────────────────────────────────────

    /**
     * Navigation mit Auth-Gate: eingeloggt springt sie sofort, als Gast öffnet der
     * Store das Login-Sheet statt eine Route zu betreten, die der Server (Web) bzw.
     * niemand (NativePHP) schützt. Dieselbe Regel wie in `nav-tab`.
     */
    _go(href: string, label: string): void {
        this.close()
        const gate = authGate()
        if (gate) {
            gate.requireAuth({ label, returnUrl: pathOf(href), resume: () => navigateTo(href) })

            return
        }
        navigateTo(href)
    },

    openRoom(room: PaletteRoom): void {
        // An encrypted conversation has no `h` on any relay — its `h` field carries the
        // `conversationKey`, its surface is `/messages`. Without this branch the row would
        // run into `/rooms/<key>`, a room no relay knows. The same branch stands in
        // `rail.openRoom`; both columns show the same rows.
        if (room.isPrivateDm === true) {
            // `&an=` and not `?c=`: `MESSAGES_PATH` already carries `?ansicht=direkt`, so a
            // second `?` produced `…?ansicht=direkt?c=<key>` — one parameter named
            // `ansicht` with the value `direkt?c=<key>`, i.e. the palette opened the
            // conversation list and never the conversation. Present since P2, found while
            // building the Direkt segment. The separator and the name are decided in
            // `js/navigate.ts`; this call site no longer builds either.
            this._go(`${MESSAGES_PATH}&an=${encodeURIComponent(room.h)}`, room.name || room.h)

            return
        }

        // Dieselben zwei Mutationen wie `rail.openRoom`: der Wechsel in einen
        // Workspace-Raum setzt den ephemeren Space, der Rückweg räumt ihn ab.
        // Ohne das lüde ein Heim-Raum gegen das falsche Relay.
        if (room.workspace === true) {
            setActiveSpaceEphemeral(WORKSPACE_URL)
        } else if (get(ephemeralSpaceUrl) !== null) {
            clearEphemeralSpace()
        }
        const href = room.workspace === true
            ? workspaceRoomHref(room.h)
            : `/rooms/${encodeURIComponent(room.h)}`
        this._go(href, room.name || room.h)
    },

    /**
     * Mitglied → Profilkarte. Das Modal hängt seit P4 im Layout (nicht mehr nur in
     * Raum/Directory/Spaces), sonst liefe die Zeile auf halben Seiten ins Leere.
     */
    openMember(member: MemberView): void {
        this.close()
        window.dispatchEvent(new CustomEvent('open-profile', { detail: member.pubkey }))
    },

    /** Space wechseln — zeichengleich zu `nostrSpaces.choose()`. */
    openSpace(space: PaletteSpace): void {
        setActiveSpace(space.url)
        if (isVereinRelay(space.url)) {
            flashToast(
                t('EINUNDZWANZIG-Vereins-Relay — voller Zugang zu Räumen & Chat nur für Vereinsmitglieder. Mitglied werden: verein.einundzwanzig.space'),
                'info',
            )
        }
        this._go('/bereich/chat', space.label)
    },

    runAction(action: PaletteAction): void {
        if (action.href) {
            this._go(action.href, action.label)

            return
        }
        if (action.scope) {
            /*
             * P5 — an action that asks a question instead of going somewhere: it lifts the
             * section's chip and leaves the palette open. The input is cleared as well, not
             * only `query`: Flux hangs its filter on the input's `value` setter, and a stale
             * value would filter the fresh list by the old text (the same reason `open()`
             * clears it by hand).
             */
            this.scope = { section: action.scope, group: null, country: '' }
            this.query = ''
            const input = this._el()?.querySelector<HTMLInputElement>('[data-palette-input]')
            if (input) {
                input.value = ''
            }

            return
        }
        this.close()
    },

    openShortcuts(): void {
        this.close()
        dispatchModal(SHORTCUTS_MODAL)
    },

    // ── The conversations ───────────────────────────────────────────────────

    /**
     * The encrypted conversations as palette rows.
     *
     * Until P7 a nudge for the participants' profiles stood here as well
     * (`_nudgeDmNames`): the Buzz channels carried pubkeys only, so the name had to be
     * resolved at render time. The `privateMessages` store warms its own profiles
     * (`warmProfiles` in `recompute`) and hands over a finished `title` — a nudge from
     * here would be a second place doing the same thing.
     */
    _dmItems(): PaletteRoom[] {
        return toPaletteDms()
    },

    // ── Rechtsbündiger Zusatz einer Raumzeile ───────────────────────────────

    /**
     * Stadt eines Meetups bzw. der Workspace-Name. Der Text steht IM `ui-option`
     * und zählt damit für Flux' Filter mit — gewollt: die Rail sucht die Stadt
     * ebenfalls mit, und ein Treffer, dessen Grund unsichtbar ist, wirkt wie ein
     * Fehler der Suche.
     */
    _hintFor(room: PaletteRoom): string {
        if (room.workspace === true) {
            return this._workspace?.label || displayRelayUrl(WORKSPACE_URL)
        }

        return this.presentations[room.meetupSlug ?? '']?.city ?? ''
    },

    // ── Sektionsköpfe ───────────────────────────────────────────────────────

    /**
     * Der Wurzelknoten dieser Insel. Bewusst `$el` und nicht `$refs`: Alpine
     * initialisiert die Wurzel VOR ihren Kindern, in `init()` ist `$refs` also
     * noch leer — der Beobachter unten hing damit an nichts, und die
     * Sektionsköpfe blieben für immer versteckt (gemessen, nicht vermutet).
     */
    _el(): HTMLElement | null {
        return (this as unknown as { $el?: HTMLElement }).$el ?? null
    },

    /**
     * Eine Überschrift ohne sichtbare Zeile darunter ist eine Lüge über das
     * Ergebnis. Flux kennt keine Gruppen (kein `command.group` in den Stubs), also
     * wird die Sichtbarkeit hier geführt — aber ABGELEITET aus Flux' Ergebnis:
     * gelesen wird `[data-hidden]`, das der Filter selbst setzt. Kein zweiter
     * Textabgleich, keine zweite Wahrheit.
     */
    _syncHeadings(): void {
        const root = this._el()?.querySelector<HTMLElement>('[data-palette-items]')
        if (!root) {
            return
        }
        for (const key of PALETTE_SECTIONS) {
            const head = root.querySelector<HTMLElement>(`[data-palette-heading="${key}"]`)
            if (!head) {
                continue
            }
            head.hidden = root.querySelector(`[data-palette-section="${key}"]:not([data-hidden])`) === null
        }

        /**
         * Derselbe Schluss für den Leerzustand — und der ist ein EIGENER Knoten,
         * nicht Flux' `command.empty`. Zwei gemessene Gründe:
         *
         *  1. Flux' `refresh()` (`displayEmptyAndCreateOptions`) hängt
         *     ausschließlich an `filterable.onChange`, und das feuert NUR bei
         *     geändertem SUCHTEXT. Unsere Zeilen entstehen aus Alpine, also bei
         *     GLEICHEM Text: Flux' eigener Beobachter ruft dann
         *     `filter(lastSearch)`, der Text ist derselbe, `onChange` bleibt
         *     stumm — „Nichts gefunden." stand über elf sichtbaren Zeilen.
         *  2. Von außen nachhelfen geht nicht: Flux hängt an jedes Element, dem
         *     es `data-hidden` schreibt, einen `_durableAttributeObserver`, der
         *     JEDE fremde Änderung sofort zurückrollt (flux.js, `attributeObserver`:
         *     `oldValue === null` → removeAttribute). Ein Setzen von außen ergab
         *     ein sichtbares Ping-Pong über hunderte Mutationen.
         *
         * Deshalb: eigener Knoten, native `hidden`-Eigenschaft (die Flux nicht
         * bewacht), Flux' eigener Leerzustand per CSS aus dem Bild.
         */
        const empty = root.querySelector<HTMLElement>('[data-palette-empty]')
        if (empty) {
            // Im Workspace-Scope entsteht bewusst KEINE Flux-Option (siehe
            // `visibleSections`) — die pauschale Regel „keine sichtbare Zeile →
            // nichts gefunden" wäre dort eine Lüge über die Trefferliste, die
            // direkt darunter steht. Diese Fläche meldet ihren Leerzustand
            // selbst, mit dem Unterschied zwischen „keine Treffer" und „keine
            // Antwort".
            empty.hidden = this.workspaceActive
                || root.querySelector('[data-palette-section]:not([data-hidden])') !== null
        }
    },

    _queueHeadingSync(): void {
        if (this._syncQueued) {
            return
        }
        this._syncQueued = true
        requestAnimationFrame(() => {
            this._syncQueued = false
            this._syncHeadings()
        })
    },

    // ── Daten ───────────────────────────────────────────────────────────────

    /**
     * Abos beim ERSTEN Öffnen aufbauen, danach stehen lassen. Idempotent: ein
     * zweites Öffnen zahlt nichts.
     */
    _ensureData(): void {
        if (this._wired) {
            return
        }
        this._wired = true

        // Heim-Space (Räume 1–3 der Rail): bewusst `activeSpaceUrl`, NICHT
        // `activeSpace` — letzteres schließt den ephemeren Workspace ein, und dann
        // zeigte die Palette in einem Workspace-Raum dessen Räume als „Räume".
        this._unsubActive = activeSpaceUrl.subscribe((url: string | null) => {
            this._url = url ?? DEFAULT_SPACE_URL
            this._controller?.abort()
            this._controller = new AbortController()
            watchSpaceRooms(this._url, this._controller.signal)
            this._dirController?.abort()
            this._dirController = new AbortController()
            watchSpaceDirectory(this._url, this._dirController.signal)

            this._unsubView?.()
            this._unsubView = deriveSpaceViewFor(this._url).subscribe((view: SpaceView) => {
                this._space = view
            })
            this._unsubDirectory?.()
            this._unsubDirectory = deriveSpaceDirectory(this._url).subscribe((dir: DirectoryView) => {
                this._directory = dir
            })
        })

        if (hasWorkspace()) {
            this._wsController = new AbortController()
            watchSpaceRooms(WORKSPACE_URL, this._wsController.signal)
            this._unsubWorkspace = deriveSpaceViewFor(WORKSPACE_URL).subscribe((view: SpaceView) => {
                this._workspace = view
            })
            // P5 — die Sofort-Treffer. `deriveEventsForUrl` liest ausschließlich
            // das Repository (herkunftsgenau über den `tracker`) und fragt KEIN
            // Relay: die Liste ist das, was ohnehin schon geladen ist. Ein
            // eigener Netz-Load stünde hier falsch — die Relay-Hälfte der Suche
            // läuft über `runSpaceSearch`, auf Enter.
            this._unsubWsEvents = deriveEventsForUrl(WORKSPACE_URL, INSTANT_FILTERS).subscribe(
                (events: TrustedEvent[]) => {
                    this._wsEvents = events
                },
            )
            // Dreiwertig, nachziehend (P1): `'unknown'` ist ein eigener Zustand,
            // an dem ein Skeleton hängt — kein „kann kein NIP-50".
            this._unsubSpaceKind = deriveSpaceKind(WORKSPACE_URL).subscribe((kind: SpaceKind) => {
                this.spaceKind = kind
            })
        }

        void loadUserGroupList()
        this._unsubSpaces = groupSpaceChoices.subscribe((urls: string[]) => {
            this._spaceUrls = urls
        })
        this._unsubRelays = app.use(Relays).index.$.subscribe((byUrl: Map<string, RelayInfo>) => {
            this._relays = byUrl
        })

        // Who is looking? Until P7 this answer arrived together with two DM ingredients
        // from one shared derivation — the Buzz channels' name table and the conversations
        // put away with a 41012. Neither concept exists any more; what remains is the one
        // question the palette actually asks.
        this._unsubMe = pubkey.subscribe((me: string | undefined) => {
            this._me = me ?? ''
        })

        void loadMeetupPresentations()
        this._unsubMeetups = meetupPresentationBySlug.subscribe((bySlug: Map<string, MeetupPresentation>) => {
            this.presentations = Object.fromEntries(bySlug)
        })

        /*
         * P4/D6 — the Portal index. ONE load, here inside `_ensureData` and therefore on the
         * FIRST opening of the palette: a page that never sees ⌘K does not pay for it. Every
         * further opening costs nothing (`loadPortalIndex` keeps the result for the session,
         * revalidation is the browser's job through the ETag).
         *
         * No `await` anywhere in the critical path: the palette is usable immediately with
         * rooms and actions, and the Portal sections appear as soon as the index is there.
         */
        void import('./portalIndex.ts')
            .then((modul: PortalModul) => {
                portalModul = modul

                return modul.loadPortalIndex()
            })
            .then((index: PortalIndex) => {
                this.portal = index
            })
            // Fail-soft, exactly like the load itself: without the chunk the four Portal
            // sections stay empty and the palette keeps working with rooms, members and
            // actions. A rejected `import()` would otherwise be an unhandled rejection on
            // every page that opens ⌘K.
            .catch(() => undefined)
    },

    // ── Lebenszyklus ────────────────────────────────────────────────────────

    init(): void {
        // ⌘K/Strg+K auf JEDER Breite — das ist der Grund für den Umzug aus der
        // Rail. `!altKey`, damit Alt+⌘+K (Systemkürzel) nicht mitgefangen wird.
        this._onKey = (e: KeyboardEvent): void => {
            if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'k') {
                e.preventDefault()
                this.toggle()

                return
            }
            // `?` öffnet die Hilfe NUR, wenn kein Textfeld den Fokus hat — sonst
            // könnte niemand mehr ein Fragezeichen tippen. Auf deutschen Layouts
            // ist das Shift+ß; `e.key` liefert trotzdem '?'.
            if (e.key === '?' && !e.metaKey && !e.ctrlKey && !e.altKey && !isTextEntry(document.activeElement)) {
                e.preventDefault()
                dispatchModal(SHORTCUTS_MODAL)
            }
        }
        window.addEventListener('keydown', this._onKey)

        const items = this._el()?.querySelector<HTMLElement>('[data-palette-items]')
        if (items) {
            this._observer = new MutationObserver(() => this._queueHeadingSync())
            this._observer.observe(items, {
                subtree: true,
                childList: true,
                attributes: true,
                attributeFilter: ['data-hidden'],
            })
        }
    },

    destroy(): void {
        this._unsubActive?.()
        this._unsubView?.()
        this._unsubWorkspace?.()
        this._unsubSpaces?.()
        this._unsubRelays?.()
        this._unsubDirectory?.()
        this._unsubMe?.()
        this._unsubMeetups?.()
        this._unsubWsEvents?.()
        this._unsubSpaceKind?.()
        this._controller?.abort()
        this._wsController?.abort()
        this._dirController?.abort()
        this._searchController?.abort()
        this._observer?.disconnect()
        this._observer = null
        // Pflicht: `wire:navigate` baut die Insel bei jeder Navigation neu auf. Ein
        // nicht abgemeldeter window-Listener sammelte sich sonst an, und nach
        // zwanzig Wechseln liefe ein Tastendruck zwanzig Mal.
        if (this._onKey) {
            window.removeEventListener('keydown', this._onKey)
            this._onKey = null
        }
    },
})

export function wirePalette(Alpine: { data: (name: string, factory: (...args: unknown[]) => unknown) => void }): void {
    Alpine.data('nostrPalette', createPalette as (...args: unknown[]) => unknown)
}
