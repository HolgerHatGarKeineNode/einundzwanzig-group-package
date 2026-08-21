/**
 * `nostrRoomSearch` — die Suche im geladenen Verlauf eines Raums (P6a).
 *
 * ── Warum eine eigene Insel ─────────────────────────────────────────────────────────
 * Kein Zustand in `nostrRoomChat` (`bridge.ts`). Die Suche hat ihren eigenen
 * Lebenszyklus (auf/zu), ihre eigene Abo-Laufzeit und ihre eigene Datenquelle; das
 * einzige, was `bridge.ts` von ihr weiss, ist die Registrierungszeile in
 * `registerNostrComponents`. Gleiches Vorgehen wie Befehlspalette (P4, `palette.ts`)
 * und Darstellungs-Schalter (P5, `displayPrefs.ts`).
 *
 * Genau EINE Naht zur Rauminsel gibt es, und sie liegt im Markup, nicht hier: der Klick
 * auf einen Treffer ruft `scrollToMessage(id)` über die Alpine-Scope-Kette auf — dieselbe
 * Methode, die auch die Zitat-Vorschau in `chat-row` benutzt. Sie ist lesender Gebrauch
 * einer bestehenden Fähigkeit, kein neuer Zustand.
 *
 * ── Kein Netz. Nachweisbar, nicht behauptet ─────────────────────────────────────────
 * Es wird KEIN `REQ` gestellt — weder für die Nachrichten noch für die Namen:
 *
 *  - {@link deriveRoomMessages} liest ausschliesslich Repository + Tracker
 *    (`@welshman/store/dist/store/src/repository.js:159-180`); die Ableitung hängt sich
 *    an das `update`-Ereignis des Repositories und fragt kein Relay.
 *  - `displayProfileByPubkey` ist ein Lesezugriff auf eine Map
 *    (`@welshman/app/dist/app/src/profiles.js:15,19` → `getProfilesByPubkey().get(pk)`).
 *    Das ist bewusst NICHT `deriveProfile`/`loadProfile`: die laden nach, und ein
 *    Suchfeld, das beim Tippen Profile nachzieht, hätte genau das Netz, das hier
 *    ausgeschlossen sein soll. Fehlt ein Profil, steht der npub-Kurzname da — die
 *    Rauminsel lädt die Profile des Verlaufs ohnehin bereits.
 *
 * Ein Netzwerk-Mitschnitt sieht während der Suche deshalb nichts. Das ist prüfbar und
 * nicht bloss Sichtprüfung.
 *
 * ── Warum die Quelle der Verlauf ist und nicht `repository.query` ───────────────────
 * Der Plan nannte `repository.query([{kinds:[9,40002],'#h':[h]}])`. Diese Insel nimmt
 * stattdessen {@link deriveRoomMessages} — dieselbe Quelle, aus der der Verlauf selbst
 * gerendert wird. Beide lesen nur den Speicher; der Unterschied sind zwei Dinge, die
 * `repository.query` nicht leisten kann:
 *
 *  1. **Raum-IDs sind nicht global eindeutig.** `#h` ist je Relay vergeben, und
 *     `repository.query` kennt keine Herkunft. Ein Raum `general` im Vereins-Space und
 *     ein Raum `general` im Workspace (beide in derselben Sitzung geladen, siehe
 *     `groups.ts WORKSPACE_URL`) fielen in denselben Topf — die Suche zeigte Treffer aus
 *     einem fremden Space. `deriveRoomMessages` filtert über den Tracker auf die
 *     Relay-Herkunft und kann das nicht.
 *  2. **Jeder Treffer muss anspringbar sein.** `scrollToMessage` sucht `#msg-{id}` im DOM
 *     und kehrt wortlos zurück, wenn der Knoten fehlt (`bridge.ts` → `scrollToMessage`). Nur wer
 *     dieselbe Menge durchsucht, die der Verlauf rendert, kann keinen Treffer anbieten,
 *     der beim Klick nichts tut. `deriveRoomMessages` IST diese Menge — inklusive der
 *     Feinheiten, die `repository.query` nicht kennt: Thread-Antworten stehen nicht im
 *     Verlauf (auf Buzz sind das kind-9-Ereignisse im selben `#h`) und die kind-9-Kopie
 *     einer Umfrage auch nicht.
 *
 * Die Kind-Auswahl des Plans bleibt: aus dem Strom werden nur Nachrichten durchsucht
 * (kind 9 / 40002), nicht Umfragen (1068) und Zap-Ziele (9041) — deren Inhalt steht in
 * Tags, nicht im `content`, und eine Trefferzeile ohne Text wäre eine leere Zeile.
 */

import { MESSAGE, type TrustedEvent } from '@welshman/util'
import { displayProfileByPubkey } from './spaceProfiles.ts'
import { activeSpace } from './groups'
import { bodyWithoutQuote, deriveRoomMessages, fullTimeLabel } from './feeds'
import { BUZZ_MESSAGE_V2 } from './relayCaps'
import { SEARCH_RESULT_LIMIT, searchMessages, type SearchHit, type SearchableRow } from './search'

/** Eine durchsuchbare Zeile: der Rohtext plus das, was die Trefferliste anzeigt. */
type RoomSearchRow = SearchableRow & { time: string }

type RoomSearchState = {
    h: string
    /** Ist die Suchfläche offen? */
    open: boolean
    query: string
    /** Umfang des geladenen Verlaufs (durchsuchte Nachrichten). */
    searched: number
    /** Treffer insgesamt — kann grösser sein als `hits.length`. */
    total: number
    hits: SearchHit<RoomSearchRow>[]
    capped: boolean
    limit: number
    _events: TrustedEvent[]
    _unsubSpace: (() => void) | null
    _unsubEvents: (() => void) | null
    init(): void
    toggle(): void
    show(): void
    close(): void
    clear(): void
    run(): void
    destroy(): void
}

/**
 * Zustand der Fläche nach aussen melden.
 *
 * Der Knopf, der die Suche öffnet, steht im Seitenkopf und damit AUSSERHALB dieser
 * Insel — er kann `open` nicht lesen. Ohne diese Meldung trüge er kein `aria-expanded`
 * und keinen Aktiv-Zustand, oder er müsste seinen eigenen Schalter mitführen, der beim
 * Schliessen über Escape/✕ still falsch würde. Zwei Zustände für dieselbe Sache sind
 * schlimmer als keiner: hier gibt es genau eine Wahrheit, und sie wird gesendet.
 */
const announce = (open: boolean): void => {
    document.dispatchEvent(new CustomEvent('room-search-state', { detail: { open }, bubbles: true }))
}

/** Nur echte Nachrichten (kind 9 / Buzz 40002) — siehe Kopf. */
const isSearchable = (event: TrustedEvent): boolean =>
    event.kind === MESSAGE || event.kind === BUZZ_MESSAGE_V2

/**
 * Ereignis → durchsuchbare Zeile. Der Text ist der Rohtext OHNE das vorangestellte
 * Zitat einer Antwort (`bodyWithoutQuote`): sonst fände „hallo" jede Antwort auf eine
 * Nachricht mit „hallo", und die Trefferliste zeigte reihenweise fremden Text.
 */
const toRow = (event: TrustedEvent): RoomSearchRow => ({
    id: event.id,
    created_at: event.created_at,
    text: bodyWithoutQuote(event),
    name: displayProfileByPubkey(event.pubkey),
    time: fullTimeLabel(event.created_at),
})

const createRoomSearch = (h: unknown): RoomSearchState => ({
    h: String(h),
    open: false,
    query: '',
    searched: 0,
    total: 0,
    hits: [],
    capped: false,
    limit: SEARCH_RESULT_LIMIT,
    _events: [],
    _unsubSpace: null,
    _unsubEvents: null,

    /**
     * `$watch` auf die Eingabe statt eines zweiten `input`-Handlers neben `x-model`.
     * Beide lauschten sonst auf DASSELBE Ereignis, und welcher zuerst liefe, hinge an der
     * Attributreihenfolge im Markup — dieselbe Begründung wie in `displayPrefs.ts`. So
     * wird beobachtet, was bereits geschrieben ist.
     */
    init(): void {
        ;(this as unknown as { $watch: (prop: string, cb: () => void) => void }).$watch('query', () => this.run())
    },

    toggle(): void {
        if (this.open) {
            this.close()
        } else {
            this.show()
        }
    },

    /**
     * Öffnen — und ERST JETZT abonnieren. Vorbild ist die Befehlspalette: eine Ableitung,
     * die jede Raum-Sitzung mitläuft, kostet auch dann, wenn nie gesucht wird. Der
     * Bestand ist beim Öffnen trotzdem sofort da, weil die Ableitung synchron aus dem
     * Repository beantwortet wird.
     */
    show(): void {
        this.open = true
        announce(true)
        if (this._unsubSpace) {
            return
        }
        this._unsubSpace = activeSpace.subscribe((url: string) => {
            this._unsubEvents?.()
            this._unsubEvents = deriveRoomMessages(url, this.h).subscribe((events: TrustedEvent[]) => {
                this._events = events.filter(isSearchable)
                this.run()
            })
        })
    },

    /** Schliessen: Abos lösen, Eingabe verwerfen. Ein zweites Öffnen fängt frisch an. */
    close(): void {
        this.open = false
        announce(false)
        this.query = ''
        this.hits = []
        this.total = 0
        this.capped = false
        this._unsubEvents?.()
        this._unsubEvents = null
        this._unsubSpace?.()
        this._unsubSpace = null
        this._events = []
        this.searched = 0
    },

    /** Nur die Eingabe leeren (Knopf im Feld) — die Fläche bleibt offen. */
    clear(): void {
        this.query = ''
        this.run()
    },

    /** Suchen. Synchron, im Speicher, ohne Netz. */
    run(): void {
        const outcome = searchMessages(this._events.map(toRow), this.query, this.limit)
        this.searched = outcome.searched
        this.total = outcome.total
        this.hits = outcome.hits
        this.capped = outcome.capped
    },

    /** Alpine ruft `destroy()` beim Entfernen des Knotens (Raumwechsel, `wire:navigate`). */
    destroy(): void {
        this._unsubEvents?.()
        this._unsubEvents = null
        this._unsubSpace?.()
        this._unsubSpace = null
    },
})

export function wireRoomSearch(Alpine: {
    data: (name: string, factory: (...args: unknown[]) => unknown) => void
}): void {
    Alpine.data('nostrRoomSearch', createRoomSearch as (...args: unknown[]) => unknown)
}
