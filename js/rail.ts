/**
 * `nostrRail` — die Insel des Desktop-Navigators.
 *
 * **Warum das nicht `nostrSpaces` ist.** Die Rail steht auf JEDER Seite, auch auf
 * `/rooms/{h}`. `nostrSpaces.init()` ruft als erstes `clearEphemeralSpace()`
 * (`bridge.ts`, Kommentar dort: „Diese Seite IST der Vereins-Space") — auf einer
 * Raumseite instanziiert wäre das fatal: ein Workspace-Raum fiele beim Öffnen
 * sofort auf zooid zurück, der Verlauf bliebe leer, und der Rückweg wäre kaputt.
 * Dieselbe Insel ein zweites Mal zu mounten verbietet zusätzlich der
 * Ein-Insel-Vorbehalt in `bridge.ts` (Modul-Scope-Caches).
 *
 * **Die Leseregel und ihre einzige Ausnahme.** Die Rail mutiert den aktiven Space
 * nicht als Nebenwirkung ihres Lebenszyklus — nie in `init()`, nie in `destroy()`.
 * Eine vom Nutzer angeforderte Navigation in einen anderen Space ist aber keine
 * Nebenwirkung, sondern die Navigation selbst; deshalb genau zwei Stellen, beide
 * im Klick-Handler (`openRoom`), keine im Lebenszyklus.
 *
 * **Heim-Space vs. Workspace.** Gruppen 1–3 binden an den HEIM-Space (die
 * persistierte Wahl, ohne ephemere Übersteuerung), Gruppe 4 fest an den Workspace.
 * Vorher hing alles an `activeSpace` — deshalb zeigte die Rail in einem
 * Workspace-Raum die falsche Raumliste. Jetzt zeigt sie beide, korrekt beschriftet.
 *
 * Die Gruppierung selbst ist reine, node-getestete Logik (`railGroups.ts`). Hier
 * lebt nur, was ohne Browser nicht geht: Subscriptions, Navigation, localStorage.
 */

import { get } from 'svelte/store'
import {
    DEFAULT_SPACE_URL,
    WORKSPACE_URL,
    activeSpaceUrl,
    activeSpaceView,
    clearEphemeralSpace,
    deriveSpaceViewFor,
    displayRelayUrl,
    ephemeralSpaceUrl,
    hasWorkspace,
    setActiveSpaceEphemeral,
    watchSpaceRooms,
    type RoomView,
    type SpaceView,
} from './groups.ts'
import { loadMeetupPresentations, meetupPresentationBySlug } from './meetups.ts'
import { type MeetupPresentation } from './meetupPresentation.ts'
import { workspaceRoomHref } from './spaceParam.ts'
import { regionName } from './countryNames.ts'
import { sumUnreadRooms } from './unread.ts'
import {
    EMPTY_SCOPE,
    RAIL_GROUP_ORDER,
    buildGroups,
    matchedViaCity,
    middleTruncate,
    parseScope,
    scopeToken,
    type RailGroup,
    type RailGroupKey,
    type RailRoom,
    type RailScope,
    type WorkspacePrefs,
} from './railGroups.ts'
import {
    FORGE_OVERVIEW_HREF,
    groupTargets,
    isForgeNodeOpen,
    railTargets,
    type ForgeNav,
    type ForgeNavNode,
    type ForgeNavProject,
    type ForgeNavRepo,
    type RailTarget,
} from './railForge.ts'
import {
    buildWorkspaceModel,
    isChannelMuted,
    isChannelPinned,
    type WorkspaceModel,
} from './workspaceModel.ts'
import { subscribeWorkspacePrefs } from './channelPrefs.ts'
import { subscribeForgeNav } from './forge.ts'
import { t } from './i18n.ts'
import { foldDmRooms } from './dmModels.ts'
import { dmRoomName, ensureDmNames } from './dms.ts'
import { pubkey } from './welshmanSession.ts'

/**
 * localStorage-Schlüssel des Auf/Zu-Zustands.
 *
 * Seit P1 stehen darin nicht mehr nur die vier Gruppenschlüssel, sondern auch die
 * Knoten-ids des Forge-Baums (`30617:<owner>:<d>` und `30621:…`). Der Schlüssel
 * bleibt derselbe: ein alter Eintrag mit nur vier Feldern ist ein gültiger neuer,
 * und ein Knoten ohne Eintrag ist zu — was Regel 4 ohnehin verlangt.
 */
const OPEN_KEY = 'railGroups.open'

/**
 * Stand der einmaligen Umstellungen an {@link OPEN_KEY}. Eigener Schlüssel und
 * kein Feld im Objekt daneben: das ist ein `Record<string, boolean>`, in dem
 * jeder Fremdkörper als Knoten-id durchginge.
 */
const OPEN_MIGRATION_KEY = 'railGroups.openMigration'
const OPEN_MIGRATION = '2'

/**
 * Default-Zustand: „Räume" (wo bin ich) und „Workspace" (woran arbeite ich)
 * offen, die beiden Verzeichnisse zu.
 *
 * **Warum der Workspace seit P2 offen ist.** Er ist nicht die vierte Gruppe
 * unter Gleichen, sondern die Fläche, für die diese Rail gebaut wurde: Repos,
 * Projekte und ihre Kanäle. Zugeklappt zeigte die Spalte davon NICHTS — der
 * Nutzer sah beim Öffnen der App drei Verzeichnisse und musste seinen eigenen
 * Arbeitsort erst suchen. MEETUPS und PROJEKTUNTERSTÜTZUNG bleiben zu: sie sind
 * Verzeichnisse zum Stöbern (92 Meetup-Zeilen in Produktion), keine Arbeitsorte.
 */
const DEFAULT_OPEN: Record<RailGroupKey, boolean> = {
    rooms: true,
    meetups: false,
    proposals: false,
    workspace: true,
    // P7 — Direktnachrichten. Offen wie die beiden anderen Arbeitsorte und aus
    // demselben Grund: die Gruppe ist klein (auf Buzz höchstens so viele Zeilen wie
    // der Nutzer Unterhaltungen führt) und beantwortet „mit wem spreche ich". Sie
    // zuzuklappen hieße, den neuen Bestand vor dem Nutzer zu verstecken, der ihn
    // gerade angelegt hat. Bei null Unterhaltungen kostet der offene Zustand eine
    // Kopfzeile und eine Leerzeile.
    dms: true,
}

/** Beschriftungen der fünf Gruppen — geteilt zwischen Chip und Gruppenkopf. */
const GROUP_LABEL: Record<RailGroupKey, string> = {
    rooms: t('Räume'),
    meetups: t('Meetups'),
    proposals: t('Projektunterstützung'),
    workspace: t('Workspace'),
    dms: t('Direktnachrichten'),
}

type CountryOption = { country: string; flag: string; name: string; count: number }

export type RailState = {
    space: SpaceView | null
    workspace: SpaceView | null
    url: string
    query: string
    scope: RailScope
    /**
     * Der Sprung aus `/forge?tab=workspaces` in die Rail steht noch aus.
     *
     * Er braucht einen Merker, weil das Ereignis `forge-zeige-kanaele` FRÜHER
     * eintrifft, als die Workspace-Sektion existiert: gemessen am 2026-08-27
     * standen im Moment des Ereignisses **0** `[data-rail-gruppenkopf]` im DOM,
     * auch zwei `requestAnimationFrame` später noch. Der Kopf hängt an
     * `<template x-if="hasWorkspaceSection">`, und die Bedingung wird erst wahr,
     * wenn die Workspace-Daten da sind. Ein `$nextTick` im Zuhörer lief deshalb
     * auf `undefined` und verpuffte still — sichtbar wurde das nie, weil
     * `toggleGroup` kein DOM braucht und die Gruppe trotzdem aufging.
     */
    kanalSprungOffen: boolean
    focused: boolean
    activeRoomH: string
    /** `naddr` des offenen Repositories (`/forge/{naddr}`), `''` sonst. */
    activeRepoNaddr: string
    /** `?tab=` der Repo-Seite: `'issues'`, `'pulls'` oder `''`. */
    activeRepoTab: string
    /**
     * Auf/Zu — Gruppen UND Forge-Knoten in EINEM Objekt, weil beides dieselbe
     * Frage ist und in denselben localStorage-Eintrag gehört.
     */
    open: Record<string, boolean>
    presentations: Record<string, MeetupPresentation>
    /** In Buzz Desktop gesetzte Kanal-Präferenzen (NIP-78) — nur für den Workspace. */
    prefs: WorkspacePrefs
    /** Repositories des Workspace (30617) — die Wurzeln des Forge-Baums. */
    forgeRepos: ForgeNavRepo[]
    /** Projekte des Workspace (30621, NIP-MP). */
    forgeProjects: ForgeNavProject[]
    _unsubForge: (() => void) | null
    _unsubView: (() => void) | null
    _unsubActive: (() => void) | null
    _unsubWorkspace: (() => void) | null
    _unsubMeetups: (() => void) | null
    _unsubPrefs: (() => void) | null
    _controller: AbortController | null
    _wsController: AbortController | null
    _onKey: ((e: KeyboardEvent) => void) | null
    readonly groups: RailGroup[]
    readonly rooms: RailRoom[]
    /** Die sichtbare Sprungliste über alle offenen Gruppen — Alt+↑/↓ und Enter. */
    readonly targets: RailTarget[]
    /**
     * **Die eine Ableitung der Workspace-Frage** (P6) — geteilt mit der mobilen
     * Kanalliste (`nostrWorkspaceRooms` in `bridge.ts`). Baum UND flache Liste
     * kommen aus demselben Aufruf; siehe `workspaceModel.ts`.
     */
    readonly workspaceModel: WorkspaceModel
    /** Der Forge-Baum der Workspace-Sektion (P1) — die Baum-Fassung des Modells. */
    readonly forgeNav: ForgeNav
    /** Die sichtbaren Baum-Zeilen, abgeflacht — genau das, was das Markup rendert. */
    readonly forgeRows: ForgeNavNode[]
    /** Kennung des aktiven Ziels: `room:<h>` oder eine Forge-Knoten-id. */
    readonly activeTargetId: string
    readonly forgeOverviewHref: string
    readonly spaceLabel: string
    readonly workspaceLabel: string
    readonly hasWorkspaceSection: boolean
    readonly countryOptions: CountryOption[]
    groupFor(key: RailGroupKey): RailGroup
    /** Bestand am Gruppenkopf — im Workspace inklusive der Repos/Projekte. */
    groupTotal(key: RailGroupKey): number
    groupUnread(key: RailGroupKey): number
    isOpen(key: RailGroupKey): boolean
    toggleGroup(key: RailGroupKey): void
    /** Ist dieser Baum-Knoten aufgeklappt? Der aktive Pfad IMMER (Regel 4). */
    isNodeOpen(node: ForgeNavNode): boolean
    toggleNode(node: ForgeNavNode): void
    /** Die Zeile anspringen — Raum über `openRoom`, alles andere über die Adresse. */
    openNode(node: ForgeNavNode): void
    /** Der gekürzte Zeilentext; der volle Name steht im `title`. */
    nodeName(node: ForgeNavNode): string
    zeigeKanaele(): void
    vollzieheKanalSprung(kopf: HTMLElement | null | undefined): boolean
    kanalSprungErledigt(): void
    scopeToGroup(key: RailGroupKey): void
    toggleCountry(iso: string): void
    clearScope(): void
    railName(room: RailRoom): string
    roomFlag(room: RailRoom): string
    cityHint(room: RailRoom): string
    /** Ist dieser Raum in Buzz Desktop stummgeschaltet? */
    isMuted(room: RailRoom): boolean
    /** Ist dieser Raum in Buzz Desktop angeheftet (`channel-stars`)? */
    isPinned(room: RailRoom): boolean
    openRoom(room: RailRoom): void
    jumpToFirst(): void
    step(delta: number): void
    liftToken(): void
    onEscape(el: HTMLInputElement): void
    focusPrompt(): void
    /** In welcher Gruppe liegt der aktive Raum? `null`, wenn keiner offen ist. */
    activeGroup(): RailGroupKey | null
    readonly scopeLabel: string
    init(): void
    destroy(): void
}

/**
 * Der aktive Raum steht im Pfad, nicht im Zustand — ihn aus der URL zu lesen statt
 * ihn zu führen ist der einzige Weg, der `wire:navigate` überlebt: Alpine wird bei
 * jeder Navigation neu aufgebaut, die Adressleiste nicht.
 */
const roomHFromPath = (pathname: string): string => {
    const m = /^\/rooms\/([^/?#]+)/.exec(pathname)

    return m ? decodeURIComponent(m[1]) : ''
}

/**
 * Dasselbe für die Repo-Seite: `/forge/{naddr}` plus den Tab aus `?tab=`.
 *
 * Der Tab steht in der Query und nicht im Alpine-Zustand der Zielseite, weil die
 * Rail sonst nicht sagen könnte, welche der beiden Kind-Zeilen gerade offen ist —
 * und weil eine Zeile „Issues · 3", die auf den Aktivitäts-Tab führt, etwas
 * anderes zeigt als ihre Beschriftung.
 */
const repoFromPath = (pathname: string, search: string): { naddr: string; tab: string } => {
    const m = /^\/forge\/([^/?#]+)/.exec(pathname)
    if (!m) {
        return { naddr: '', tab: '' }
    }
    let tab = ''
    try {
        tab = new URLSearchParams(search).get('tab') ?? ''
    } catch {
        /* kaputte Query → kein Tab. Die Zeile ist dann das Repo selbst. */
    }

    return { naddr: decodeURIComponent(m[1]), tab }
}

/** Navigation über Livewire, mit hartem Fallback — an EINER Stelle statt an drei. */
const navigateTo = (href: string): void => {
    if (href === '') {
        return
    }
    const w = window as unknown as { Livewire?: { navigate: (target: string) => void } }
    if (w.Livewire) {
        w.Livewire.navigate(href)
    } else {
        window.location.assign(href)
    }
}

const persistOpen = (open: Record<string, boolean>): void => {
    try {
        localStorage.setItem(OPEN_KEY, JSON.stringify(open))
    } catch {
        /* gesperrter Storage → der Zustand gilt nur für diese Seite. Kein Fehler. */
    }
}

/** `SpaceView` → flache Rail-Räume; `joined` kommt aus der Herkunftsliste. */
const toRailRooms = (view: SpaceView | null): RailRoom[] => [
    ...(view?.userRooms ?? []).map((r: RoomView) => ({ ...r, joined: true })),
    ...(view?.otherRooms ?? []).map((r: RoomView) => ({ ...r, joined: false })),
]

/**
 * Der DM-Store, wenn er schon steht — sonst `undefined`.
 *
 * Über `window.Alpine.store` und nicht über einen Import: derselbe Weg, den
 * {@link RailState.groupUnread} für `$store.unread` geht. Alpine-Stores sind reaktive
 * Proxys, ein Lesen daraus innerhalb eines Getters wird also mitverfolgt — die Rail
 * rechnet neu, sobald der Store seine ausgeblendeten Unterhaltungen oder seine
 * Namenstabelle ändert.
 */
type DmStoreLese = {
    hidden?: string[]
    names?: Record<string, string>
}

const dmStore = (): DmStoreLese | undefined =>
    (window as unknown as { Alpine?: { store(n: string): unknown } }).Alpine?.store('dms') as
        | DmStoreLese
        | undefined

/**
 * Die Unterhaltungen BEIDER Sichten (Heim-Space und Workspace), nach `h` entdoppelt.
 *
 * Die Faltung selbst steht seit P7b als `foldDmRooms` in `dmModels.ts` — der Dialog
 * (`dm-modal.blade.php`) baut seine Liste aus derselben Funktion, statt wie bisher aus
 * `groupFor('dms')` und damit aus dem Alpine-Scope dieser Rail. Zwei Faltungen wären
 * zwei Wahrheiten über dieselbe Frage; die Begründungen (Entdopplung, `spaceUrl`,
 * `joined`, ausgeblendete Zeilen) stehen dort.
 */
const toRailDms = (home: SpaceView | null, workspace: SpaceView | null): RailRoom[] =>
    foldDmRooms([home, workspace], dmStore()?.hidden ?? [])

const readOpen = (): Record<string, boolean> => {
    try {
        const raw = localStorage.getItem(OPEN_KEY)
        const stored = raw ? (JSON.parse(raw) as Record<string, boolean>) : {}

        // ── Einmalige Umstellung: der Workspace-Default hat sich gedreht ──────
        // `persistOpen` schreibt IMMER alle vier Gruppenschlüssel — auch die, die
        // der Nutzer nie angefasst hat. Wer je irgendeine Gruppe geklappt hat,
        // trägt deshalb ein `workspace: false` im Speicher, das keine Entscheidung
        // ist, sondern eine Kopie des ALTEN Defaults. Ohne diese Zeilen erreichte
        // die Umstellung genau die Nutzer nicht, für die sie gebaut ist: die mit
        // Vorgeschichte. Einmal, nur dieser eine Schlüssel — jede bewusste
        // Klappwahl an Gruppen und Knoten bleibt erhalten.
        //
        // Der Merker wird AUCH bei leerem Speicher gesetzt, und das ist keine
        // Kosmetik: sonst liefe die Umstellung erst beim ersten Klick eines neuen
        // Nutzers — und träfe dann genau die Wahl, die er gerade getroffen hat.
        if (localStorage.getItem(OPEN_MIGRATION_KEY) !== OPEN_MIGRATION) {
            delete stored.workspace
            if (raw) {
                localStorage.setItem(OPEN_KEY, JSON.stringify(stored))
            }
            localStorage.setItem(OPEN_MIGRATION_KEY, OPEN_MIGRATION)
        }

        return { ...DEFAULT_OPEN, ...stored }
    } catch {
        return { ...DEFAULT_OPEN } // kaputter/gesperrter Storage → Default, kein Fehler
    }
}

/**
 * Zwei TypeScript-Eigenheiten, die den Aufbau hier erklären:
 *
 * 1. Das Literal wird DIREKT zurückgegeben (`=> ({…})`), nicht über eine
 *    Zwischenvariable. Nur so ist es kontextuell durch `RailState` typisiert und
 *    `this` in den Methoden dadurch bekannt — dasselbe Muster wie alle Inseln in
 *    `bridge.ts`. Mit `const state: RailState = {…}; return state` fällt `this`
 *    auf `{}` zurück und jeder Feldzugriff ist ein Fehler (gemessen, nicht vermutet).
 * 2. Für ACCESSOREN greift auch das nicht — dort pinnt jeder Getter sein `this`
 *    selbst per `const self = this as RailState`. Bewusst NICHT über eine
 *    Closure-Variable: Alpine reicht den reaktiven Proxy als `this` herein, ein
 *    Getter am rohen Objekt verlöre genau die Reaktivität, für die er da ist.
 */
export const createRail = (): RailState => ({
    space: null,
    workspace: null,
    url: '',
    query: '',
    scope: { ...EMPTY_SCOPE },
    kanalSprungOffen: false,
    focused: false,
    activeRoomH: '',
    activeRepoNaddr: '',
    activeRepoTab: '',
    open: { ...DEFAULT_OPEN },
    presentations: {},
    prefs: {},
    forgeRepos: [],
    forgeProjects: [],
    _unsubForge: null,
    _unsubView: null,
    _unsubActive: null,
    _unsubWorkspace: null,
    _unsubMeetups: null,
    _unsubPrefs: null,
    _controller: null,
    _wsController: null,
    _onKey: null,

    get spaceLabel(): string {
        const self = this as RailState

        return self.space?.label || displayRelayUrl(self.url) || ''
    },

    get workspaceLabel(): string {
        const self = this as RailState

        return self.workspace?.label || displayRelayUrl(WORKSPACE_URL) || ''
    },

    get hasWorkspaceSection(): boolean {
        return hasWorkspace()
    },

    // Getter statt gespiegelter Felder: die Gruppierung ist reines Ableiten aus
    // (Räume, Präsentationen, Suchtext, Scope), und Alpine wertet Getter reaktiv aus.
    // Ein gespiegeltes Feld wäre eine zweite Wahrheit über dieselbe Frage.
    get groups(): RailGroup[] {
        const self = this as RailState

        // Die Unterhaltungen kommen als Teil der ERSTEN Liste herein und nicht als
        // eigene Option: `groupOf` schickt sie am Marker `isDm` in die Gruppe `dms`,
        // und damit gilt für sie automatisch dieselbe Such-, Scope- und Kappungsregel
        // wie für jede andere Zeile. Eine dritte Option neben `workspaceRooms` wäre
        // ein zweiter Weg durch dieselbe Funktion.
        return buildGroups([...toRailRooms(self.space), ...toRailDms(self.space, self.workspace)], {
            presentations: self.presentations,
            query: self.query,
            scope: self.scope,
            workspaceRooms: toRailRooms(self.workspace),
            workspacePrefs: self.prefs,
            claimedRoomHs: self.forgeNav.claimed,
        })
    },

    /**
     * **Die eine Ableitung** (P6) — dieselbe Funktion, aus der die mobile
     * Kanalliste ihre Zeilen zieht (`nostrWorkspaceRooms._apply()` in
     * `bridge.ts`). Der Pin-Vorrang, die Repo-Bindung und die Zustände
     * `pinned`/`muted` stehen seither genau einmal, in `workspaceModel.ts`.
     *
     * **Bei aktiver Suche gibt es keinen Baum.** Eine Suche ist eine flache
     * Trefferliste; eine Hierarchie darüber verbärge Treffer hinter zugeklappten
     * Knoten, und der Nutzer schlösse aus einer kurzen Liste, dass es nicht mehr
     * gibt. Aufgelöst heißt hier zugleich: `claimed` ist leer, die Kanäle stehen
     * flach in ihrer Gruppe und werden ganz normal mitgefiltert — genau der
     * Zustand von vor dieser Phase. Dieselbe Logik wie „gefiltert wird nie
     * gekappt" in `buildGroups`. Die Regel steht als `filtering` im Modell, damit
     * beide Fassungen sie aus derselben Quelle bekommen.
     *
     * Getter und kein gespiegeltes Feld — aus demselben Grund wie {@link groups}:
     * ein Feld daneben wäre eine zweite Wahrheit über dieselbe Frage.
     */
    get workspaceModel(): WorkspaceModel {
        const self = this as RailState

        return buildWorkspaceModel({
            rooms: toRailRooms(self.workspace),
            prefs: self.prefs,
            repos: self.forgeRepos,
            projects: self.forgeProjects,
            activeRoomH: self.activeRoomH,
            activeId: self.activeTargetId.startsWith('room:') ? '' : self.activeTargetId,
            filtering: self.query.trim() !== '' || self.scope.group !== null || self.scope.country !== '',
            open: self.open,
        })
    },

    /** Der Forge-Baum (P1) — die Baum-Fassung des Modells. */
    get forgeNav(): ForgeNav {
        return (this as RailState).workspaceModel.nav
    },

    get forgeRows(): ForgeNavNode[] {
        return (this as RailState).workspaceModel.rows
    },

    /**
     * Welches Ziel ist gerade offen?
     *
     * Ein Raum steht im Pfad (`/rooms/{h}`), ein Repository ebenfalls
     * (`/forge/{naddr}` plus `?tab=`) — beides wird beim Mount aus der Adresse
     * gelesen und nicht geführt, weil `wire:navigate` Alpine neu aufbaut, die
     * Adressleiste aber nicht. Der `naddr` wird hier gegen die geladenen Repos
     * aufgelöst, weil die Knoten-id die stabile KOORDINATE ist: ein `naddr` trägt
     * Relay-Hinweise und ist damit nicht kanonisch.
     */
    get activeTargetId(): string {
        const self = this as RailState

        if (self.activeRoomH !== '') {
            return `room:${self.activeRoomH}`
        }
        if (self.activeRepoNaddr === '') {
            return ''
        }
        const repo = self.forgeRepos.find((candidate) => candidate.naddr === self.activeRepoNaddr)
        if (!repo) {
            return ''
        }
        if (self.activeRepoTab === 'issues' || self.activeRepoTab === 'pulls') {
            return `${repo.address}#${self.activeRepoTab}`
        }

        return repo.address
    },

    get forgeOverviewHref(): string {
        return FORGE_OVERVIEW_HREF
    },

    /**
     * Die SICHTBARE Reihenfolge über alle offenen Gruppen — die Grundlage für
     * Alt+↑/↓ und Enter. Zeilen aus zugeklappten Gruppen gehören nicht dazu:
     * eine Tastatur-Navigation an unsichtbaren Zeilen entlang wäre eine Blackbox.
     *
     * Seit P1 sind nicht mehr alle Zeilen Räume: der Forge-Baum bringt Repo-,
     * Issues- und PR-Zeilen mit, die eine Adresse statt eines `h` tragen. Die
     * Liste wird deshalb von `railTargets` gebaut — EINER Funktion, die auch
     * {@link activeGroup} speist. In P3 und P7 lief genau diese Menge schon
     * zweimal auseinander; eine dritte Berechnung gibt es hier nicht.
     */
    get targets(): RailTarget[] {
        const self = this as RailState

        return railTargets(self.groups, self.forgeRows, (key) => self.isOpen(key))
    },

    /**
     * Die sichtbaren RÄUME — die Untermenge von {@link targets}, die einen Raum
     * trägt. Enter im Suchfeld springt in den ersten davon, und der Leersatz
     * („Kein Raum passt zu dieser Suche") hängt an ihrer Zahl. Bei aktiver Suche
     * ist das exakt die Liste von vor P1: dann gibt es keinen Baum.
     */
    get rooms(): RailRoom[] {
        const self = this as RailState

        return self.targets.flatMap((target) => (target.room ? [target.room] : []))
    },

    /** Länder der Meetup-Gruppe mit Bestand, das eigene Land zuerst — wie die Bühne. */
    get countryOptions(): CountryOption[] {
        const self = this as RailState

        const counts = new Map<string, number>()
        for (const room of toRailRooms(self.space)) {
            if (!room.isMeetup) {
                continue
            }
            const iso = self.presentations[room.meetupSlug ?? '']?.country ?? ''
            if (iso) {
                counts.set(iso, (counts.get(iso) ?? 0) + 1)
            }
        }

        return [...counts.entries()]
            .map(([country, count]) => ({
                country,
                count,
                flag: self.presentations[
                    Object.keys(self.presentations).find((s) => self.presentations[s].country === country) ?? ''
                ]?.flag ?? '',
                name: regionName(country),
            }))
            .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    },

    groupFor(key: RailGroupKey): RailGroup {
        return this.groups.find((g) => g.key === key)
            ?? { key, pinned: [], sections: [], claimed: [], joined: [], others: [], hiddenCount: 0, total: 0, muted: [] }
    },

    /**
     * Die Zahl am Gruppenkopf — der Bestand der Sektion, ungekappt.
     *
     * **Warum das nicht `groupFor(key).total` ist.** `buildGroups` zählt RÄUME;
     * ein Repository ist keiner. Im Workspace bezifferte der Kopf damit
     * ausgerechnet das nicht, worum es in dieser Sektion geht: bei einem Repo
     * und zwei Kanälen stand dort `2`, und das eine Ding, das der Nutzer sucht,
     * war in keiner Zahl enthalten.
     *
     * **Gezählt werden die Top-Level-Einträge des Baums** (`forgeNav.total`,
     * also VOR der Faltung), nicht jede Baumzeile. Zwei Gründe: die Kanäle unter
     * einem Repo stecken bereits in `total` — sie sind sichtbar, nur an anderer
     * Stelle, und das war schon vor dieser Phase so. Und „Issues · 3" ist kein
     * Eintrag der Sektion, sondern ein MERKMAL der Zeile darüber (dieselbe
     * Unterscheidung, die `rail-forge-row.blade.php` in drei Registern trifft) —
     * mitgezählt bezifferte der Kopf eine Menge, die niemand nachzählen kann.
     * `total` statt `nodes.length` bewusst: gefaltet stünde sonst die Zahl der
     * gerade sichtbaren Zeilen dort, und die Zahl am Kopf sagt „was da ist",
     * nicht „was gerade zu sehen ist".
     */
    groupTotal(key: RailGroupKey): number {
        return this.groupFor(key).total + (key === 'workspace' ? this.forgeNav.total : 0)
    },

    /**
     * Ungelesen-Summe einer Gruppe — erscheint NUR am zugeklappten Kopf. Ist die
     * Gruppe offen, tragen die Zeilen die Pillen. Ein Zähler, ein Ort.
     * Gerechnet über den ungekappten Bestand: eine Summe, die die Kappung mitmacht,
     * wäre falsch.
     *
     * **Stummgeschaltete Räume zählen nicht mit.** Sonst bliebe die Stummschaltung
     * eine Optik: die Zeile wäre blass, der Kopf schriebe die Zahl trotzdem an —
     * und genau die Zahl ist es, die zum Hineinschauen auffordert. Buzz macht das
     * ebenso (`communityUnreadObserver.ts:207,286`).
     */
    groupUnread(key: RailGroupKey): number {
        const store = (window as unknown as { Alpine?: { store(n: string): { rooms?: Record<string, number> } } })
            .Alpine?.store('unread')
        // Die Unterhaltungen stehen seit P7 in einem EIGENEN Topf der `SpaceView` und
        // kommen aus beiden Sichten. Ohne diesen Zweig zählte der Kopf der DM-Gruppe
        // immer null — die Zeilen trügen ihre Pillen, der zugeklappte Kopf nicht.
        const all = key === 'workspace'
            ? toRailRooms(this.workspace)
            : key === 'dms'
                ? toRailDms(this.space, this.workspace)
                : toRailRooms(this.space)
        // `isChannelMuted` und kein eigenes Set (P6): das war die dritte Stelle,
        // die „ist dieser Kanal stumm?" selbst beantwortet hat.
        const hs = all
            .filter((r) => (key === 'workspace' ? !isChannelMuted(this.prefs, r.h) : groupKeyOf(r) === key))
            .map((r) => r.h)

        return sumUnreadRooms(store?.rooms, hs)
    },

    /** Beschriftung des Scope-Chips: „Meetups · Österreich", „Räume", „🇩🇪 Deutschland". */
    get scopeLabel(): string {
        const self = this as RailState

        const parts: string[] = []
        if (self.scope.group) {
            parts.push(GROUP_LABEL[self.scope.group])
        }
        if (self.scope.country) {
            parts.push(regionName(self.scope.country))
        }

        return parts.join(' · ')
    },

    focusPrompt(): void {
        const el = (this as unknown as { $refs?: { prompt?: HTMLInputElement } }).$refs?.prompt
        el?.focus()
        el?.select()
    },

    /**
     * Aus `/forge?tab=workspaces` in die Rail springen.
     *
     * Zwei Hälften, und nur die erste darf sofort laufen: die Gruppe aufzuklappen
     * ist reiner Zustand, der Fokus braucht den gerenderten Kopf. Deshalb setzt
     * diese Methode nur den Merker; ausgeführt wird der Sprung vom `x-effect` in
     * `desktop-rail.blade.php`, sobald `hasWorkspaceSection` wahr ist.
     */
    zeigeKanaele(): void {
        if (!this.isOpen('workspace')) {
            this.toggleGroup('workspace')
        }
        this.kanalSprungOffen = true
    },

    /**
     * Den ausstehenden Sprung vollziehen, falls dieser Kopf der richtige ist.
     *
     * **Eine Wahrheit, zwei Auslöser** — weil es zwei Lagen gibt und keine davon
     * die andere abdeckt:
     *   - *warm*: die Workspace-Sektion steht schon, wenn das Ereignis eintrifft.
     *     Dann greift der Aufruf aus dem Zuhörer (`desktop-rail.blade.php`).
     *   - *kalt*: sie entsteht erst danach. Dann greift das `x-init` am Kopf selbst
     *     (`rail-group.blade.php`) — der Kopf meldet sich, sobald es ihn gibt.
     *
     * Warum nicht ein `x-effect` auf `hasWorkspaceSection`: gemessen am 2026-08-27
     * wertet Alpine ihn NICHT neu aus, wenn dieser Getter wahr wird. Er liest
     * `hasWorkspace()` — eine Funktion ausserhalb des Alpine-Datenobjekts, also
     * ausserhalb jeder Abhängigkeitsverfolgung. Der Effect stand korrekt im DOM,
     * beide Bedingungen waren wahr, der Kopf war da — und er lief trotzdem nicht.
     */
    vollzieheKanalSprung(kopf: HTMLElement | null | undefined): boolean {
        if (!this.kanalSprungOffen || !kopf) {
            return false
        }
        kopf.closest('[data-rail]')
            ?.querySelector('#rail-group-workspace')
            ?.scrollIntoView({ block: 'nearest' })
        kopf.focus({ preventScroll: true })
        this.kanalSprungOffen = false

        return true
    },

    /** Der Sprung ist ausgeführt — den Merker fallen lassen. */
    kanalSprungErledigt(): void {
        this.kanalSprungOffen = false
    },

    activeGroup(): RailGroupKey | null {
        const active = this.activeTargetId
        if (active === '') {
            return null
        }
        // Gefragt wird über ALLE Zeilen der Gruppe, unabhängig vom Klappzustand
        // ihrer Knoten: das aktive Element kann in einem zugeklappten Repo liegen,
        // und genau dann muss die Gruppe darüber aufgehen. Dieselbe Funktion, die
        // auch `targets` speist — Sektions- UND Baum-Zeilen zählen mit, ein Raum
        // in einer Sektion oder unter einem Repo ist der aktive Raum wie jeder
        // andere. `allRows` statt eines zweiten `flattenForgeNav`-Aufrufs: die
        // ungefaltete Liste liefert das Modell mit (P6).
        const rows = this.workspaceModel.allRows
        for (const key of RAIL_GROUP_ORDER) {
            const targets = groupTargets(this.groupFor(key), key === 'workspace' ? rows : [])
            if (targets.some((target) => target.id === active)) {
                return key
            }
        }

        return null
    },

    isOpen(key: RailGroupKey): boolean {
        // Die Gruppe des aktiven Ziels klappt IMMER auf — sonst beantwortet die
        // Rail „wo bin ich" nicht mehr, ihren ersten Zweck.
        if (this.activeTargetId !== '' && this.activeGroup() === key) {
            return true
        }
        // Während einer Suche klappt jede Gruppe mit Treffern auf, sonst bliebe das
        // Ergebnis hinter einem zugeklappten Kopf verborgen.
        if ((this.query.trim() !== '' || this.scope.group !== null) && this.groupFor(key).total > 0) {
            return true
        }

        return this.open[key] === true
    },

    toggleGroup(key: RailGroupKey): void {
        this.open = { ...this.open, [key]: !this.open[key] }
        persistOpen(this.open)
    },

    /**
     * Aufgeklappt? Die Regel steht rein und getestet in `railForge.ts`
     * ({@link isForgeNodeOpen}); hier wird nur der Speicher gelesen.
     *
     * **`Object.hasOwn` und nicht `?? undefined`.** Ein ausdrücklich zugeklappter
     * Knoten steht als `false` im Speicher, ein nie angefasster gar nicht — und
     * genau diese beiden Fälle muss die Regel unterscheiden können, seit Projekt-
     * und Repo-Zeilen einen Default „offen" haben. Ein `this.open[node.id] ===
     * true` (P1) warf beides zusammen: die Wahl „zu" wäre vom Default
     * überschrieben worden und die Zeile ließe sich nicht mehr zuklappen.
     */
    isNodeOpen(node: ForgeNavNode): boolean {
        return isForgeNodeOpen(node, Object.hasOwn(this.open, node.id) ? this.open[node.id] : undefined)
    },

    toggleNode(node: ForgeNavNode): void {
        this.open = { ...this.open, [node.id]: !this.isNodeOpen(node) }
        persistOpen(this.open)
    },

    openNode(node: ForgeNavNode): void {
        if (node.room) {
            this.openRoom(node.room)

            return
        }
        if (node.href === '') {
            // Ein reiner Klappknoten (Projekt, Repo ohne `naddr`): der Klick auf
            // den Namen klappt, statt ins Leere zu führen.
            this.toggleNode(node)

            return
        }
        navigateTo(node.href)
    },

    nodeName(node: ForgeNavNode): string {
        // Enger als in der flachen Liste: drei Ebenen kosten Einrückung
        // (12 px je Stufe), die dem Namen fehlt.
        //
        // **Die Zahlen sind gemessen, nicht geschätzt (P6).** Bis dahin galt
        // `30 − 2·depth`, und das kürzte messbar zu früh. Gemessen wird an der
        // einzigen Stelle, die zählt — `scrollWidth > clientWidth` an der
        // Beschriftung selbst (`buzz-rail-breite.spec.ts`, alle vier
        // Nav-Zustände): kürzt CSS ein zweites Mal, ist die Zahl zu groß; bleibt
        // sichtbar Platz stehen, ist sie zu klein.
        //
        // Am 1440-px-Bild gemessen: der Beschriftung stehen 227 px (Ebene 0),
        // 215 px (Ebene 1) und 203 px (Ebene 2) zur Verfügung — je Ebene 12 px
        // weniger, das ist genau die Einrückung. Ein Repo-Name aus Kleinbuchstaben
        // und Bindestrichen misst rund 7,0 px je Zeichen; damit passen 32/30/28
        // Zeichen. Das alte `30 − 2·depth` ließ davon gemessene 13–15 px ungenutzt
        // (die im Design-Pass genannten „30–60 px" waren für diese Namen zu hoch
        // gegriffen), `36 − 3·depth` — der dort vorgeschlagene Wert — läuft
        // dagegen um 16–25 px ÜBER und erzeugt die doppelte Ellipsis.
        //
        // **Eine Zeichenzahl kann für einen Proportionalsatz nie exakt sein.**
        // Ein Name aus lauter Großbuchstaben ist breiter und läuft auch bei 32
        // ins CSS-Kürzen — das ist der eingebaute Rückfall und sieht dann aus wie
        // vorher. Ausgerichtet wird an den Namen, die tatsächlich vergeben werden.
        return middleTruncate(node.label, 32 - node.depth * 2)
    },

    scopeToGroup(key: RailGroupKey): void {
        this.scope = { group: key, country: '' }
        this.focusPrompt()
    },

    toggleCountry(iso: string): void {
        this.scope = this.scope.country === iso
            ? { ...this.scope, country: '' }
            : { group: 'meetups', country: iso }
    },

    clearScope(): void {
        this.scope = { ...EMPTY_SCOPE }
    },

    /**
     * Der sichtbare Name einer Zeile.
     *
     * **Für eine Unterhaltung kommt er NICHT aus dem Raumnamen.** Buzz speichert als
     * Kanalnamen für jede Zweier-Unterhaltung die Zeichenkette `"DM"` und für jede
     * Gruppe `"Group DM (N)"` (`buzz-db/src/dm.rs:157-162`) — die Spalte zeigte sonst
     * dieselbe Zeile mehrfach.
     *
     * **Die Auflösung ist seit P7b `dmRoomName` und steht genau einmal** (`dms.ts`,
     * Regel in `dmModels.roomDisplayName`): dieselbe Funktion beantwortet die Frage für
     * `/updates` in `bridge.ts joinedRoomNames`, wo bisher der rohe Relay-Name stand.
     * Übergeben wird die Namenstabelle des DM-Stores und nicht in ihr gelesen — der
     * Lesezugriff auf `$store.dms.names` HIER ist es, den Alpine mitverfolgt; die Zeile
     * rechnet also neu, sobald ein Profil eintrifft. Fehlt der Store (Boot), bleibt der
     * Raumname als ehrlicher Rückfall.
     */
    railName(room: RailRoom): string {
        if (room.isDm) {
            // Der Anstoß, ohne den die Zeile für immer einen gekürzten Schlüssel zeigte.
            // Er hing bis P7b in `titleOf` und lief damit gegen den AKTIVEN Space, auch
            // für eine Unterhaltung des Workspace-Relays; `spaceUrl` fragt den Relay, von
            // dem die Zeile stammt (`foldDmRooms` setzt ihn).
            ensureDmNames(room.spaceUrl ?? '', room.dmParticipants ?? [])
        }

        return middleTruncate(dmRoomName(room, pubkey.get() ?? '', dmStore()?.names ?? {}) || room.h)
    },

    roomFlag(room: RailRoom): string {
        return this.presentations[room.meetupSlug ?? '']?.flag ?? ''
    },

    /**
     * Stummgeschaltet? Beantwortet von {@link isChannelMuted} — der EINEN
     * Implementierung dieser Frage im Paket (P6). Vorher stand sie hier und ein
     * zweites Mal in `bridge.ts`.
     *
     * **Nicht über {@link workspaceModel}**, obwohl das Modell die Antwort je
     * Zeile mitführt: der Getter baut bei jedem Zugriff neu, und diese Frage
     * stellt das Markup einmal PRO ZEILE — die mobile Fassung fragt sie einmal
     * je Liste. Zwei Verbrauchsstellen, eine Implementierung; das ist die Regel,
     * nicht ein Kompromiss. Der andere Weg wäre derselbe Fehler wie das
     * `groupFor('workspace').muted`, das hier schon einmal stand.
     */
    isMuted(room: RailRoom): boolean {
        return isChannelMuted(this.prefs, room.h)
    },

    /** Angeheftet? Trägt das Nadel-Icon der Zeile — dieselbe Quelle wie {@link isMuted}. */
    isPinned(room: RailRoom): boolean {
        return isChannelPinned(this.prefs, room.h)
    },

    /** Stadt als Trefferbegründung — nur, wenn die Suche NICHT über den Namen traf. */
    cityHint(room: RailRoom): string {
        const pres = this.presentations[room.meetupSlug ?? '']

        return matchedViaCity(room, pres, this.query) ? (pres?.city ?? '') : ''
    },

    openRoom(room: RailRoom): void {
        // `dmRooms` steht hier ausdrücklich mit dabei: seit P7 sind die Unterhaltungen
        // ein eigener Topf der `SpaceView`, und ohne diese Zeile öffnete eine
        // Unterhaltung des WORKSPACE-Relays `/rooms/{h}` ohne `?space=workspace` — also
        // gegen den Heim-Relay, der den Kanal nicht kennt: leerer Verlauf, und ein
        // Beitrittsversuch endete mit `invalid: group not found`.
        const isWorkspaceRoom = this.workspace !== null
            && (this.workspace.userRooms.some((r) => r.h === room.h)
                || this.workspace.otherRooms.some((r) => r.h === room.h)
                || this.workspace.dmRooms.some((r) => r.h === room.h))

        // ── Die einzigen zwei Mutationen der Rail, beide vom Nutzer angefordert ──
        if (isWorkspaceRoom) {
            setActiveSpaceEphemeral(WORKSPACE_URL)
        } else if (get(ephemeralSpaceUrl) !== null) {
            // Aus einem Workspace-Raum zurück in einen Heim-Raum. NÖTIG: `/rooms/{h}`
            // ohne `?space=` setzt beim Mount nichts, und `clearEphemeralSpace()` läuft
            // sonst nur auf `/spaces`. Ohne diese Zeile lüde der Raum gegen das FALSCHE
            // Relay — leerer Verlauf, Beitritt als `invalid: group not found`.
            clearEphemeralSpace()
        }

        const href = isWorkspaceRoom ? workspaceRoomHref(room.h) : `/rooms/${encodeURIComponent(room.h)}`
        // `activeRoomH` sofort mitziehen: `wire:navigate` tauscht den Body erst nach
        // dem Netz-Roundtrip; ohne das bliebe die alte Zeile markiert. Aus demselben
        // Grund fällt die Repo-Markierung: gleich steht ein Raum im Pfad.
        this.activeRoomH = room.h
        this.activeRepoNaddr = ''
        this.activeRepoTab = ''
        navigateTo(href)
    },

    jumpToFirst(): void {
        const first = this.rooms[0]
        if (first) {
            this.query = ''
            this.openRoom(first)
        }
    },

    /**
     * Alt+↑/↓ eine Zeile weiter — über die SICHTBARE Sprungliste, nicht über die
     * Räume: seit P1 sind Repo-, Issues- und PR-Zeilen ebenso sichtbar und ebenso
     * anspringbar.
     */
    step(delta: number): void {
        const list = this.targets
        if (list.length === 0) {
            return
        }
        const active = this.activeTargetId
        const at = list.findIndex((target) => target.id === active)
        const next = at === -1 ? (delta > 0 ? 0 : list.length - 1) : at + delta
        if (next >= 0 && next < list.length) {
            const target = list[next]
            if (target.room) {
                this.openRoom(target.room)
            } else {
                navigateTo(target.href)
            }
        }
    },

    /** Escape in drei Stufen: Text leeren → Scope lösen → Feld verlassen. */
    /**
     * Token-Lift: ein getipptes `de:` / `m:` wandert aus dem Textfeld in den Chip.
     *
     * Das Präfix ist genau die Zeichenfolge, die ein Klick auf die Lupe bzw. einen
     * Land-Chip schreibt — wer geklickt hat, hat sie gesehen und tippt sie beim
     * nächsten Mal selbst. Damit das nicht zwei getrennte Wege bleiben, wird sie
     * hier erkannt und in denselben Zustand gehoben.
     *
     * Läuft im `input`-Ereignis, NICHT in einem `$watch` auf `query`: der Lift
     * schreibt `query` selbst, und ein Watch riefe sich sonst rekursiv auf.
     * Unbekannte Präfixe bleiben stehen — ein `foo:` ist eine Suche nach „foo:",
     * keine stille Filterung auf nichts (`parseScope` entscheidet das).
     */
    liftToken(): void {
        const { scope, rest } = parseScope(this.query)
        if (scope.group === null && scope.country === '') {
            return
        }
        // Ein bereits gesetztes Land nicht durch eine Gruppenangabe verlieren:
        // `de:` + später `m:` soll „Meetups in Deutschland" ergeben, nicht „Meetups".
        this.scope = {
            group: scope.group ?? this.scope.group,
            country: scope.country !== '' ? scope.country : this.scope.country,
        }
        this.query = rest
    },

    onEscape(el: HTMLInputElement): void {
        if (this.query !== '') {
            this.query = ''

            return
        }
        if (this.scope.group !== null || this.scope.country !== '') {
            this.clearScope()

            return
        }
        el.blur()
    },

    init(): void {
        this.activeRoomH = roomHFromPath(window.location.pathname)
        const repo = repoFromPath(window.location.pathname, window.location.search)
        this.activeRepoNaddr = repo.naddr
        this.activeRepoTab = repo.tab
        this.open = readOpen()

        // Startwerte synchron, damit die Rail nicht leer aufblitzt: beide sind
        // derived Stores und haben bereits einen Wert.
        this.space = get(activeSpaceView)

        // ── Heim-Space (Gruppen 1–3) ────────────────────────────────────────────
        // Bewusst `activeSpaceUrl`, NICHT `activeSpace`: letzteres schließt den
        // ephemeren Workspace ein, und dann zeigte die Rail in einem Workspace-Raum
        // dessen Räume als „Räume". Der Heim-Space ist die persistierte Wahl.
        this._unsubActive = activeSpaceUrl.subscribe((url: string | null) => {
            this.url = url ?? DEFAULT_SPACE_URL
            this._controller?.abort()
            this._controller = new AbortController()
            watchSpaceRooms(this.url, this._controller.signal)
            // Die Sicht hängt an DIESER URL, nicht an einer einmal gelesenen: wechselt
            // der Heim-Space in den Einstellungen, muss die Rail mitziehen. Deshalb
            // steht das Abo INNERHALB der Subscription und wird bei jedem Wechsel
            // neu aufgebaut — sonst zeigte die Rail bis zum Reload den alten Space.
            this._unsubView?.()
            this._unsubView = deriveSpaceViewFor(this.url).subscribe((view: SpaceView) => {
                this.space = view
            })
        })

        // ── Workspace (Gruppe 4) ────────────────────────────────────────────────
        // Feste URL, eigener Watch — dasselbe Muster, das `nostrSpaces` für seinen
        // Workspaces-Tab bereits fährt. Zwei Watches auf dieselbe URL sind kein
        // neues Risiko: die Repository dedupliziert, Kosten sind ein REQ.
        if (hasWorkspace()) {
            this._wsController = new AbortController()
            watchSpaceRooms(WORKSPACE_URL, this._wsController.signal)
            this._unsubWorkspace = deriveSpaceViewFor(WORKSPACE_URL).subscribe((view: SpaceView) => {
                this.workspace = view
            })

            // ── Kanal-Präferenzen aus Buzz Desktop (NIP-78, P3) ──────────────────
            // `subscribeWorkspacePrefs` schaltet den Netzweg beim ersten Abonnenten
            // scharf (idempotent, modulweit) und gibt den Abmelder zurück: der Weg
            // bleibt über `wire:navigate` stehen, nur das Abo hier wird pro Insel
            // auf- und wieder abgebaut. Seit P7 hängt die Bühne am selben Einstieg —
            // deshalb steht hier kein eigener `initChannelPrefs()`-Aufruf mehr.
            // Die Präferenzen sind rein lesend — gesetzt werden sie in Buzz Desktop.
            this._unsubPrefs = subscribeWorkspacePrefs((prefs: WorkspacePrefs) => {
                this.prefs = prefs
            })

            // ── Forge-Baum (P1) ──────────────────────────────────────────────────
            // Derselbe Einstieg wie bei den Präferenzen: `subscribeForgeNav`
            // schaltet den Netzweg beim ersten Abonnenten scharf (idempotent,
            // modulweit) und gibt den Abmelder zurück. Der Netzweg bleibt über
            // `wire:navigate` stehen — sonst liefe bei jedem Raumwechsel ein
            // neuer `load` für einen Bestand, der sich selten ändert.
            this._unsubForge = subscribeForgeNav((data) => {
                this.forgeRepos = data.repos
                this.forgeProjects = data.projects
            })
        }

        // Meetup-Präsentation (Land/Flagge/Stadt) EINMAL laden, fail-soft, und den
        // Index nach Alpine spiegeln — die Zeile joint dann über `room.meetupSlug`.
        void loadMeetupPresentations()
        this._unsubMeetups = meetupPresentationBySlug.subscribe((bySlug: Map<string, MeetupPresentation>) => {
            this.presentations = Object.fromEntries(bySlug)
        })

        // ── Tastatur ────────────────────────────────────────────────────────────
        // Nur hier registriert, und die Rail existiert nur ab xl (`x-if` am
        // Viewport-Store) — auf dem Telefon läuft dieser Listener also nie. Genau
        // das ist der Grund, warum ⌘K hier NICHT mehr steht: es ist in P4 in die
        // Befehlspalette umgezogen (`palette.ts`, einmal im Layout, viewport-
        // unabhängig). Ein zweiter Zweig hier wäre kein Zusatz, sondern ein
        // zweiter Handler pro Tastendruck. Alt+↑/↓ bleibt, weil die Raumliste,
        // durch die es blättert, hier liegt.
        this._onKey = (e: KeyboardEvent): void => {
            if (e.altKey && !e.metaKey && !e.ctrlKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
                e.preventDefault()
                this.step(e.key === 'ArrowDown' ? 1 : -1)
            }
        }
        window.addEventListener('keydown', this._onKey)
    },

    destroy(): void {
        this._unsubActive?.()
        this._unsubView?.()
        this._unsubWorkspace?.()
        this._unsubMeetups?.()
        this._unsubPrefs?.()
        this._unsubForge?.()
        this._controller?.abort()
        this._wsController?.abort()
        // Pflicht: `wire:navigate` baut die Insel bei JEDEM Raumwechsel neu auf. Ein
        // nicht abgemeldeter window-Listener sammelte sich sonst an, und nach zwanzig
        // Wechseln liefe ein Tastendruck zwanzig Mal.
        if (this._onKey) {
            window.removeEventListener('keydown', this._onKey)
            this._onKey = null
        }
    },
})

/*
 * Hier stand bis P1 `visibleSectionRooms(group)` — die Räume aller Sektionen
 * einer Gruppe, damit `rooms` (Tastatur) und `activeGroup()` (Aufklappen)
 * dieselbe Menge sehen. Diese Aufgabe ist mit dem Forge-Baum gewachsen und
 * deshalb nach `railForge.ts` gezogen (`groupTargets`/`railTargets`): dort ist
 * sie ohne Browser prüfbar, und sie deckt jetzt ALLE Zeilenarten ab statt nur die
 * Sektions-Räume. Der Grund ist unverändert der von P3 und P7 — liefen die beiden
 * Stellen auseinander, wäre eine Zeile sichtbar, aber nicht anspringbar.
 */

/** Typ eines Raums für die Ungelesen-Summe — spiegelt `groupOf` aus `railGroups`. */
const groupKeyOf = (room: RailRoom): RailGroupKey =>
    room.isDm ? 'dms' : room.isProjectSupport ? 'proposals' : room.isMeetup ? 'meetups' : 'rooms'

export function wireRail(Alpine: { data: (name: string, factory: () => unknown) => void }): void {
    Alpine.data('nostrRail', createRail)
}

export { parseScope, scopeToken }
