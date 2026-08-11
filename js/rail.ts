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
} from './groups'
import { loadMeetupPresentations, meetupPresentationBySlug } from './meetups'
import { type MeetupPresentation } from './meetupPresentation'
import { workspaceRoomHref } from './spaceParam'
import { regionName } from './countryNames'
import { sumUnreadRooms } from './unread'
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
} from './railGroups'
import { t } from './i18n'

/** localStorage-Schlüssel des Auf/Zu-Zustands. */
const OPEN_KEY = 'railGroups.open'

/** Default-Zustand: nur „Räume" offen; der Rest kostet sonst die halbe Spalte. */
const DEFAULT_OPEN: Record<RailGroupKey, boolean> = {
    rooms: true,
    meetups: false,
    proposals: false,
    workspace: false,
}

/** Beschriftungen der vier Gruppen — geteilt zwischen Chip und Gruppenkopf. */
const GROUP_LABEL: Record<RailGroupKey, string> = {
    rooms: t('Räume'),
    meetups: t('Meetups'),
    proposals: t('Projektunterstützung'),
    workspace: t('Workspace'),
}

type CountryOption = { country: string; flag: string; name: string; count: number }

export type RailState = {
    space: SpaceView | null
    workspace: SpaceView | null
    url: string
    query: string
    scope: RailScope
    focused: boolean
    activeRoomH: string
    open: Record<RailGroupKey, boolean>
    presentations: Record<string, MeetupPresentation>
    _unsubView: (() => void) | null
    _unsubActive: (() => void) | null
    _unsubWorkspace: (() => void) | null
    _unsubMeetups: (() => void) | null
    _controller: AbortController | null
    _wsController: AbortController | null
    _onKey: ((e: KeyboardEvent) => void) | null
    readonly groups: RailGroup[]
    readonly rooms: RailRoom[]
    readonly spaceLabel: string
    readonly workspaceLabel: string
    readonly hasWorkspaceSection: boolean
    readonly countryOptions: CountryOption[]
    groupFor(key: RailGroupKey): RailGroup
    groupUnread(key: RailGroupKey): number
    isOpen(key: RailGroupKey): boolean
    toggleGroup(key: RailGroupKey): void
    scopeToGroup(key: RailGroupKey): void
    toggleCountry(iso: string): void
    clearScope(): void
    railName(room: RailRoom): string
    roomFlag(room: RailRoom): string
    cityHint(room: RailRoom): string
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

/** `SpaceView` → flache Rail-Räume; `joined` kommt aus der Herkunftsliste. */
const toRailRooms = (view: SpaceView | null): RailRoom[] => [
    ...(view?.userRooms ?? []).map((r: RoomView) => ({ ...r, joined: true })),
    ...(view?.otherRooms ?? []).map((r: RoomView) => ({ ...r, joined: false })),
]

const readOpen = (): Record<RailGroupKey, boolean> => {
    try {
        const raw = localStorage.getItem(OPEN_KEY)
        if (!raw) {
            return { ...DEFAULT_OPEN }
        }

        return { ...DEFAULT_OPEN, ...(JSON.parse(raw) as Partial<Record<RailGroupKey, boolean>>) }
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
    focused: false,
    activeRoomH: '',
    open: { ...DEFAULT_OPEN },
    presentations: {},
    _unsubView: null,
    _unsubActive: null,
    _unsubWorkspace: null,
    _unsubMeetups: null,
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

        return buildGroups(toRailRooms(self.space), {
            presentations: self.presentations,
            query: self.query,
            scope: self.scope,
            workspaceRooms: toRailRooms(self.workspace),
        })
    },

    /**
     * Die SICHTBARE Reihenfolge über alle offenen Gruppen — die Grundlage für
     * Alt+↑/↓ und Enter. Zeilen aus zugeklappten Gruppen gehören nicht dazu:
     * eine Tastatur-Navigation an unsichtbaren Zeilen entlang wäre eine Blackbox.
     */
    get rooms(): RailRoom[] {
        const self = this as RailState

        const out: RailRoom[] = []
        for (const g of self.groups) {
            if (self.isOpen(g.key)) {
                out.push(...g.joined, ...g.others)
            }
        }

        return out
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
        return this.groups.find((g) => g.key === key) ?? { key, joined: [], others: [], hiddenCount: 0, total: 0 }
    },

    /**
     * Ungelesen-Summe einer Gruppe — erscheint NUR am zugeklappten Kopf. Ist die
     * Gruppe offen, tragen die Zeilen die Pillen. Ein Zähler, ein Ort.
     * Gerechnet über den ungekappten Bestand: eine Summe, die die Kappung mitmacht,
     * wäre falsch.
     */
    groupUnread(key: RailGroupKey): number {
        const store = (window as unknown as { Alpine?: { store(n: string): { rooms?: Record<string, number> } } })
            .Alpine?.store('unread')
        const all = key === 'workspace' ? toRailRooms(this.workspace) : toRailRooms(this.space)
        const hs = all.filter((r) => (key === 'workspace' ? true : groupKeyOf(r) === key)).map((r) => r.h)

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

    activeGroup(): RailGroupKey | null {
        if (this.activeRoomH === '') {
            return null
        }
        for (const key of RAIL_GROUP_ORDER) {
            const g = this.groupFor(key)
            if ([...g.joined, ...g.others].some((r) => r.h === this.activeRoomH)) {
                return key
            }
        }

        return null
    },

    isOpen(key: RailGroupKey): boolean {
        // Die Gruppe des aktiven Raums klappt IMMER auf — sonst beantwortet die
        // Rail „wo bin ich" nicht mehr, ihren ersten Zweck.
        if (this.activeRoomH !== '' && this.activeGroup() === key) {
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
        try {
            localStorage.setItem(OPEN_KEY, JSON.stringify(this.open))
        } catch {
            /* gesperrter Storage → der Zustand gilt nur für diese Seite. Kein Fehler. */
        }
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

    railName(room: RailRoom): string {
        return middleTruncate(room.name || room.h)
    },

    roomFlag(room: RailRoom): string {
        return this.presentations[room.meetupSlug ?? '']?.flag ?? ''
    },

    /** Stadt als Trefferbegründung — nur, wenn die Suche NICHT über den Namen traf. */
    cityHint(room: RailRoom): string {
        const pres = this.presentations[room.meetupSlug ?? '']

        return matchedViaCity(room, pres, this.query) ? (pres?.city ?? '') : ''
    },

    openRoom(room: RailRoom): void {
        const w = window as unknown as { Livewire?: { navigate: (href: string) => void } }
        const isWorkspaceRoom = this.workspace !== null
            && (this.workspace.userRooms.some((r) => r.h === room.h) || this.workspace.otherRooms.some((r) => r.h === room.h))

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
        // dem Netz-Roundtrip; ohne das bliebe die alte Zeile markiert.
        this.activeRoomH = room.h
        if (w.Livewire) {
            w.Livewire.navigate(href)
        } else {
            window.location.assign(href)
        }
    },

    jumpToFirst(): void {
        const first = this.rooms[0]
        if (first) {
            this.query = ''
            this.openRoom(first)
        }
    },

    step(delta: number): void {
        const list = this.rooms
        if (list.length === 0) {
            return
        }
        const at = list.findIndex((r) => r.h === this.activeRoomH)
        const next = at === -1 ? (delta > 0 ? 0 : list.length - 1) : at + delta
        if (next >= 0 && next < list.length) {
            this.openRoom(list[next])
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

/** Typ eines Raums für die Ungelesen-Summe — spiegelt `groupOf` aus `railGroups`. */
const groupKeyOf = (room: RailRoom): RailGroupKey =>
    room.isProjectSupport ? 'proposals' : room.isMeetup ? 'meetups' : 'rooms'

export function wireRail(Alpine: { data: (name: string, factory: () => unknown) => void }): void {
    Alpine.data('nostrRail', createRail)
}

export { parseScope, scopeToken }
