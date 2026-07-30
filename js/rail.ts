/**
 * `nostrRail` — die Insel des Desktop-Navigators (P4 der Desktop-Shell).
 *
 * **Warum das nicht `nostrSpaces` ist.** Die Rail steht auf JEDER Seite, auch auf
 * `/rooms/{h}`. `nostrSpaces.init()` ruft als erstes `clearEphemeralSpace()`
 * (`bridge.ts`, Kommentar dort: „Diese Seite IST der Vereins-Space") — auf einer
 * Raumseite instanziiert wäre das fatal: ein Workspace-Raum fiele beim Öffnen
 * sofort auf zooid zurück, der Verlauf bliebe leer, und der Rückweg wäre kaputt.
 * Dieselbe Insel ein zweites Mal zu mounten verbietet zusätzlich der
 * Ein-Insel-Vorbehalt in `bridge.ts` (Modul-Scope-Caches `_roomFilterCache`,
 * `_countryCache`).
 *
 * Deshalb diese eigene, bewusst ARME Insel. Ihre Regeln:
 *   - Sie LIEST. Sie ruft `clearEphemeralSpace()` niemals, setzt keinen Space und
 *     schreibt kein Event.
 *   - Sie benutzt die Modul-Scope-Caches von `nostrSpaces` nicht mit.
 *   - Sie kennt weder Filter noch Kategorien noch Raum-Verwaltung. Wer suchen,
 *     filtern oder Räume anlegen will, geht auf `/spaces` — die Rail ist eine
 *     Sprungliste, keine zweite Raumübersicht.
 *
 * `watchSpaceRooms` ruft sie hingegen sehr wohl: auf `/rooms/{h}` ist sonst
 * niemand da, der die Raumliste des aktiven Space überhaupt lädt. Das ist eine
 * Subscription, keine Mutation — der aktive Space bleibt, was er war.
 */

import { get } from 'svelte/store'
import {
    activeSpace,
    activeSpaceView,
    watchSpaceRooms,
    displayRelayUrl,
    WORKSPACE_URL,
    type SpaceView,
    type RoomView,
} from './groups'
import { workspaceRoomHref } from './spaceParam'

export type RailState = {
    space: SpaceView | null
    url: string
    query: string
    focused: boolean
    activeRoomH: string
    _unsubView: (() => void) | null
    _unsubActive: (() => void) | null
    _controller: AbortController | null
    _onKey: ((e: KeyboardEvent) => void) | null
    readonly rooms: RoomView[]
    readonly spaceLabel: string
    readonly userRooms: RoomView[]
    readonly otherRooms: RoomView[]
    readonly matchCount: number
    roomHref(h: string): string
    openRoom(h: string): void
    jumpToFirst(): void
    step(delta: number): void
    init(): void
    destroy(): void
}

/**
 * Der aktive Raum steht im Pfad, nicht im Zustand — `/rooms/{h}`. Ihn aus der URL
 * zu lesen statt ihn zu führen ist der einzige Weg, der `wire:navigate` überlebt:
 * Alpine wird bei jeder Navigation neu aufgebaut, die Adressleiste nicht.
 */
const roomHFromPath = (pathname: string): string => {
    const m = /^\/rooms\/([^/?#]+)/.exec(pathname)

    return m ? decodeURIComponent(m[1]) : ''
}

/** Diakritika-tolerantes Enthaltensein — „Kempten" findet auch „KEMPTEN". */
const matches = (haystack: string, needle: string): boolean =>
    haystack.toLocaleLowerCase().includes(needle.toLocaleLowerCase())

export const createRail = (): RailState => ({
    space: null,
    url: '',
    query: '',
    focused: false,
    activeRoomH: '',
    _unsubView: null,
    _unsubActive: null,
    _controller: null,
    _onKey: null,

    /** Beide Sektionen als EINE Reihenfolge — die Grundlage für Alt+↑/↓. */
    get rooms(): RoomView[] {
        return [...this.userRooms, ...this.otherRooms]
    },

    get spaceLabel(): string {
        return this.space?.label || displayRelayUrl(this.url) || ''
    },

    // Beide Listen laufen durch denselben Filter. Getter statt `$watch`: die
    // Filterung ist reines Ableiten aus `query` + `space`, und Alpine wertet
    // Getter reaktiv aus — ein gespiegeltes Feld wäre eine zweite Wahrheit.
    get userRooms(): RoomView[] {
        const q = this.query.trim()
        const rooms = this.space?.userRooms ?? []

        return q === '' ? rooms : rooms.filter((r) => matches(r.name || r.h, q))
    },

    get otherRooms(): RoomView[] {
        const q = this.query.trim()
        const rooms = this.space?.otherRooms ?? []

        return q === '' ? rooms : rooms.filter((r) => matches(r.name || r.h, q))
    },

    get matchCount(): number {
        return this.userRooms.length + this.otherRooms.length
    },

    /**
     * Die Raum-URL trägt die Space-Markierung mit, wenn der aktive Space der
     * Workspace ist (`?space=workspace`, siehe `spaceParam.ts`). Ohne sie landete
     * ein Reload des Ziels wieder auf dem Vereins-Relay und der Raum bliebe leer.
     */
    roomHref(h: string): string {
        return WORKSPACE_URL !== '' && this.url === WORKSPACE_URL
            ? workspaceRoomHref(h)
            : `/rooms/${encodeURIComponent(h)}`
    },

    openRoom(h: string): void {
        const w = window as unknown as { Livewire?: { navigate: (href: string) => void } }
        const href = this.roomHref(h)
        // `activeRoomH` sofort mitziehen: `wire:navigate` tauscht den Body erst
        // nach dem Netz-Roundtrip. Ohne das bliebe die alte Zeile bis dahin
        // markiert und der Klick fühlte sich tot an.
        this.activeRoomH = h
        if (w.Livewire) {
            w.Livewire.navigate(href)
        } else {
            window.location.assign(href)
        }
    },

    /** Enter im `#`-Prompt springt in den ersten Treffer. */
    jumpToFirst(): void {
        const first = this.userRooms[0] ?? this.otherRooms[0]
        if (first) {
            this.query = ''
            this.openRoom(first.h)
        }
    },

    /**
     * Einen Raum weiter/zurück (Alt+↓ / Alt+↑) über BEIDE Sektionen hinweg.
     * Ohne aktiven Raum (z.B. auf `/spaces`) beginnt Alt+↓ oben, Alt+↑ unten.
     * Kein Umlauf: am Ende der Liste passiert nichts. Ein Umlauf wäre auf einer
     * 95-Zeilen-Liste eine Überraschung, keine Hilfe.
     */
    step(delta: number): void {
        const list = this.rooms
        if (list.length === 0) {
            return
        }
        const at = list.findIndex((r) => r.h === this.activeRoomH)
        const next = at === -1 ? (delta > 0 ? 0 : list.length - 1) : at + delta
        if (next >= 0 && next < list.length) {
            this.openRoom(list[next].h)
        }
    },

    init(): void {
        this.activeRoomH = roomHFromPath(window.location.pathname)

        // ── Tastatur ─────────────────────────────────────────────────────────
        // Nur hier registriert, und die Rail existiert nur ab xl (`x-if` am
        // Viewport-Store) — auf dem Telefon läuft dieser Listener also nie.
        //
        // ⌘K/Strg+K greift AUCH aus dem Composer heraus: es ist der Sprung weg
        // vom Schreiben, genau dann braucht man ihn. Alt+Pfeil dagegen ist ohne
        // Textfeld-Ausnahme sicher — die Kombination erzeugt keine Eingabe.
        this._onKey = (e: KeyboardEvent): void => {
            if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'k') {
                e.preventDefault()
                const el = (this as unknown as { $refs?: { prompt?: HTMLInputElement } }).$refs?.prompt
                el?.focus()
                el?.select()

                return
            }
            if (e.altKey && !e.metaKey && !e.ctrlKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
                e.preventDefault()
                this.step(e.key === 'ArrowDown' ? 1 : -1)
            }
        }
        window.addEventListener('keydown', this._onKey)

        // Startwert synchron setzen, damit die Rail nicht erst leer aufblitzt:
        // `activeSpaceView` ist ein derived Store und hat bereits einen Wert.
        this.space = get(activeSpaceView)

        this._unsubActive = activeSpace.subscribe((url: string) => {
            this.url = url
            // Ein Space-Wechsel bricht die Subscription des alten ab — sonst
            // liefen zwei Relay-Watches nebeneinander und die Liste mischte.
            this._controller?.abort()
            this._controller = new AbortController()
            watchSpaceRooms(url, this._controller.signal)
        })

        this._unsubView = activeSpaceView.subscribe((view: SpaceView) => {
            this.space = view
        })
    },

    destroy(): void {
        this._unsubActive?.()
        this._unsubView?.()
        this._controller?.abort()
        // Pflicht, nicht Kosmetik: `wire:navigate` baut die Insel bei JEDEM
        // Raumwechsel neu auf. Ein nicht abgemeldeter window-Listener sammelte
        // sich sonst pro Navigation an, und nach zwanzig Wechseln liefe ein
        // Tastendruck zwanzig Mal.
        if (this._onKey) {
            window.removeEventListener('keydown', this._onKey)
            this._onKey = null
        }
    },
})

export function wireRail(Alpine: { data: (name: string, factory: () => unknown) => void }): void {
    Alpine.data('nostrRail', createRail)
}
