/**
 * Ungelesen-Ableitung (P3/P6) — aus dem **Punkt** ist eine **Zahl** geworden.
 *
 * Es gibt bewusst KEINEN eigenen Zähl-Store. „Ungelesen" ist eine reine Projektion aus
 * zwei Quellen, die es ohnehin schon gibt:
 *
 *     repository (Events, url-gescopt über den tracker)  ─┐
 *     readState  (Wasserzeichen, Wall-Clock)             ─┴─> throttled(300) ─> UnreadView
 *
 * Damit kann ein Marker nie gegen den Feed divergieren — beide lesen dieselbe
 * `repository`, aus der auch der Raum-Verlauf lebt. Genau diese Kopplung ist die
 * Voraussetzung dafür, dass P6 überhaupt zählen DARF: die Zahl entsteht aus demselben
 * Bestand, den der Nutzer im Raum darunter nachzählen kann. Sie ist deshalb ehrlich
 * gekappt — mehr als der lokale Bestand (300/Raum, 30 Tage, `storage.ts`) kann sie nicht
 * behaupten, und sie behauptet auch nicht mehr.
 *
 * `any` bleibt daneben bestehen und wird NICHT durch „irgendeine Summe > 0" ersetzt: die
 * Bottom-Nav trägt laut §4.1 Nr. 5 weiterhin einen Punkt ohne Zahl, und die Header-Glocke
 * fragt dasselbe Ja/Nein.
 *
 * Der Vertrag zur Oberfläche (Blade liest ihn defensiv über `$store.unread?.…`):
 *     Alpine.store('unread') → {
 *         rooms: Record<h, number>, threads: Record<rootId, number>, any: boolean,
 *         roomsTotal: number, threadsTotal: number,
 *         capped(n, cap): string   ← nur im Store, siehe `wireUnread` in bridge.ts
 *     }
 */
import { derived, writable, type Readable } from 'svelte/store'
import { throttled } from '@welshman/store'
import { pubkey } from '@welshman/app'
import { MESSAGE, COMMENT, POLL, ZAP_GOAL, getTagValue, type TrustedEvent } from '@welshman/util'
// Die beiden relativen Importe tragen ABSICHTLICH ihre `.ts`-Endung (anders als sonst
// im Modul-Bestand): Nodes ESM-Auflösung kennt keine extensionslosen Pfade, und ohne
// Endung liefe `node --test unread.test.ts` in ERR_MODULE_NOT_FOUND — die Ableitung wäre
// nur noch im Browser prüfbar. Vite/rollup lösen die explizite Endung unverändert auf;
// die Testdateien im Repo schreiben sie ohnehin schon so.
import { deriveEventsForUrl } from './repository.ts'
import { readState, readStateReady, threadKey, roomWatermark, threadWatermark, type ReadState } from './readState.ts'

/**
 * Lotus' In-Chat-Thread (NIP-29 Group Chat Threading, kind 10) — hier bewusst als
 * lokale Konstante gespiegelt statt aus `feeds.ts` importiert: `feeds.ts` zieht über
 * `./core` den kompletten App-Boot (welshman-Kontext, IndexedDB) mit und wäre damit
 * nicht mehr unter `node --test` prüfbar. Eine Zahl zu duplizieren ist der kleinere
 * Preis als eine untestbare Ableitung.
 */
const CHAT_THREAD = 10

/** Was die Oberfläche sieht. Werte sind ZAHLEN (P6) — gezählte Ereignisse, nicht Ja/Nein. */
export type UnreadView = {
    /**
     * Schlüssel ist `room.h`, Wert die Anzahl ungelesener Ereignisse.
     *
     * Drei unterscheidbare Zustände, und die Unterscheidung ist gewollt:
     *   - **Schlüssel fehlt** = in diesem Raum bin ich nicht (Regel 1) → gar kein Marker.
     *   - **Schlüssel mit 0** = beigetreten und gelesen → keine Pille, aber die Zeile ist
     *     nachweislich geprüft worden.
     *   - **Schlüssel > 0** = so viele ungelesene Ereignisse.
     */
    rooms: Record<string, number>
    /**
     * Schlüssel ist `thread.rootId` (NIP-22 `E`), Wert die Anzahl ungelesener Antworten.
     *
     * **Asymmetrisch zu {@link rooms}: hier gibt es kein Null-Seeding.** Ein Thread ohne
     * ungelesene Antwort bekommt KEINEN Schlüssel. Der Grund ist der Schlüsselraum: die
     * Menge der beigetretenen Räume ist klein und bekannt (`joined`), die Menge der je
     * gelesenen Threads wächst dagegen unbeschränkt mit — `readState` ist grow-only. Für
     * jeden davon eine 0 in den Store zu legen hieße, den Store mit Nullen zu füllen, die
     * niemand liest. Die Oberfläche fragt Threads ohnehin zeilenweise ab und braucht die
     * Antwort „nicht beigetreten vs. gelesen" dort nicht — ein Thread, den ich sehe, ist
     * einer, den ich lesen darf.
     */
    threads: Record<string, number>
    /**
     * Irgendwo etwas Ungelesenes — speist den Punkt am Chat-Tab der Bottom-Nav (§4.1
     * Nr. 5: **Punkt ohne Zahl**) und die Ja/Nein-Frage der Header-Glocke.
     */
    any: boolean
    /**
     * Summe über alle Räume — die Zahl der Tab-Pille „Räume" (§4.4).
     *
     * Aggregiert wird über EREIGNISSE, nicht über Räume: „4" heißt vier ungelesene
     * Nachrichten, nicht vier Räume mit Ungelesenem. Sonst stünde am Tab eine andere
     * Größe als in den Pillen der Zeilen direkt darunter, und die Summe der sichtbaren
     * Pillen ergäbe nicht die Zahl am Tab.
     */
    roomsTotal: number
    /** Summe über alle Threads — die Zahl der Tab-Pille „Threads". Ereignisse, wie {@link roomsTotal}. */
    threadsTotal: number
}

export const EMPTY_UNREAD: UnreadView = { rooms: {}, threads: {}, any: false, roomsTotal: 0, threadsTotal: 0 }

/**
 * Cap-Schwelle der frei stehenden Pillen — Raum-Zeile, Meetup-Kachel, Thread-Zeile, Tab
 * (§4.1 Nr. 1–4). Exakt bis einschließlich 99, darüber `99+`.
 */
export const BADGE_CAP = 99

/**
 * Cap-Schwelle der Header-Glocke (§4.1 Nr. 6, begründet in §4.2): sie sitzt zwischen
 * `exit`-Link und Profil-Chip, dreistellig drückte sie die `max-w-[7rem]`-Namenszeile.
 */
export const BELL_CAP = 9

/**
 * Zahl → Pillentext. Rein, ohne `Intl` und ohne Browser — die Ziffern sind ASCII, und
 * eine lokalisierte Tausender-Gruppierung kann in einer `min-w-5`-Pille ohnehin nie
 * auftreten (oberhalb der Cap steht `99+`).
 *
 * Entschieden, weil der Plan es offenließ:
 *   - **0, negativ, `NaN`/`Infinity`, `null`/`undefined` ⇒ `''`** (leerer String), nicht
 *     `'0'`. §4.1 verlangt „bei 0: Element nicht gerendert" — der leere String ist das,
 *     was ein `x-text` in genau diesem Fall anzeigen darf, ohne dass eine leere Pille
 *     stehen bleibt. `undefined` ist ausdrücklich erlaubt, weil `threads[rootId]` für
 *     einen gelesenen Thread gar keinen Schlüssel hat (siehe {@link UnreadView.threads})
 *     und das Template sonst überall ein `?? 0` mitschleppen müsste.
 *   - **Nachkommastellen werden abgeschnitten** (`Math.floor`). Ereigniszahlen sind ganz;
 *     eine gebrochene Eingabe ist ein Aufruferfehler und soll keine `3,7` in die Pille
 *     schreiben.
 *   - **Genau auf der Schwelle steht die Zahl**, erst darüber das `+`: `99` → `'99'`,
 *     `100` → `'99+'`. „`99+`" für exakt 99 wäre eine Lüge über einen Wert, den wir
 *     genau kennen.
 *
 * @param cap Schwelle, ab der gekappt wird. {@link BADGE_CAP} oder {@link BELL_CAP};
 *   Werte < 1 werden auf 1 gehoben, damit `cap = 0` keine `'0+'`-Pille erzeugt.
 */
export function formatUnreadCount(count: number | null | undefined, cap: number = BADGE_CAP): string {
    if (typeof count !== 'number' || !Number.isFinite(count) || count < 1) {
        return ''
    }
    const limit = Math.max(1, Math.floor(cap))
    const exact = Math.floor(count)
    return exact > limit ? `${limit}+` : String(exact)
}

/**
 * Thread-Wurzel eines Kommentars, format-übergreifend: unsere kind-1111 tragen
 * `["E", rootId]` (NIP-22, uppercase), Lotus' kind-10 tragen
 * `["e", rootId, relay, "root"]` (NIP-29, Marker). Gleiche Regel wie
 * `feeds.ts commentRootId` — hier eigenständig, siehe {@link CHAT_THREAD}.
 */
export const unreadCommentRootId = (event: TrustedEvent): string =>
    getTagValue('E', event.tags) ?? event.tags.find((t) => t[0] === 'e' && t[3] === 'root')?.[1] ?? ''

export type UnreadInput = {
    /** Normalisierte Space-Relay-URL — Teil des Raum-Schlüssels im Wasserzeichen. */
    url: string
    /** `h` der BEIGETRETENEN Räume (relay-signierte 39002). */
    joined: readonly string[]
    /** Timeline-Events des Space (kind 9/1068/9041), bereits url-gescopt. */
    events: readonly TrustedEvent[]
    /** Kommentare des Space (kind 1111 + Lotus' kind 10), bereits url-gescopt. */
    comments: readonly TrustedEvent[]
    state: ReadState
    /** Eigener pubkey. Leer (Gast) ⇒ nichts ist ungelesen. */
    me: string
}

/**
 * Reine Ableitung — kein Store, kein Netz, kein Browser. Node-testbar.
 *
 * Regeln, jede mit einem Grund:
 *
 * 1. **Nur beigetretene Räume.** Ein entdeckbarer Raum, in dem man nicht ist, bekommt
 *    keinen Schlüssel und damit keinen Punkt. Sonst leuchtete die Liste bei jedem
 *    fremden Meetup auf, das man nie betreten hat.
 * 2. **Eigene Nachrichten zählen nicht.** Man liest nicht, was man selbst geschrieben hat.
 * 3. **`created_at > wm`**, nicht `>=`: NIP-01-`since` ist inklusiv, das zuletzt
 *    Quittierte darf nicht sofort wieder ungelesen sein.
 * 4. **Threads nur, wenn ich sie schon einmal gelesen habe** (es existiert ein
 *    `t:<rootId>`-Wasserzeichen). Ohne diese Regel wäre jeder je im Space eröffnete
 *    Thread beim ersten Blick ungelesen — der Punkt verlöre seine Bedeutung. Ein Thread,
 *    den man nie geöffnet hat, meldet sich in P4 über die Benachrichtigungs-Liste
 *    (Erwähnung/Antwort auf mich), nicht über diesen Punkt.
 * 5. **Raum und Thread sind entkoppelt.** Kommentare (kind 1111) erscheinen nicht im
 *    Raum-Feed (eigener, `#h`-loser Filter) — wer den Raum bis unten liest, hat sie
 *    nachweislich nicht gesehen. Nur `all` dominiert beides (in den Wasserzeichen
 *    selbst, siehe `readState.roomWatermark`).
 * 6. **Gezählt werden EREIGNISSE, eins pro Event** (P6-Entscheidung, die der Plan
 *    offenließ). Zwei Nachrichten desselben Autors zählen zwei, nicht eine; ein Event
 *    zählt in genau einem Raum bzw. genau einem Thread. Begründung: die Pille steht neben
 *    einer Zeile, deren Inhalt eine Liste von Nachrichten ist — „3" muss heißen, dass
 *    drei Nachrichten dastehen, sonst kann der Nutzer die Zahl nicht nachzählen. Eine
 *    Aggregation nach Autoren oder Gesprächssträngen (wie sie `updates.ts` für die
 *    ZEILEN von `/updates` macht) beantwortete eine andere Frage.
 *    Ein Kommentar zählt ausschließlich in seinen Thread und NIE zusätzlich in den Raum —
 *    das ist Regel 5 in Zahlform: `roomsTotal` und `threadsTotal` überschneiden sich nicht.
 *
 * Gelöschtes zählt automatisch nicht mit: die Quelle (`repository.query`) schließt
 * kind-5-Tombstones per Default aus, und NIP-29-9005-Ziele werden aktiv aus der
 * `repository` entfernt (`feeds.ts honorDeleteEvent`).
 */
export function computeUnread(input: UnreadInput): UnreadView {
    const rooms: Record<string, number> = {}
    const threads: Record<string, number> = {}
    if (!input.me) {
        return { rooms, threads, any: false, roomsTotal: 0, threadsTotal: 0 }
    }
    const watermarkByH = new Map<string, number>()
    for (const h of input.joined) {
        rooms[h] = 0
        watermarkByH.set(h, roomWatermark(input.state, input.url, h))
    }
    for (const event of input.events) {
        if (event.pubkey === input.me) {
            continue
        }
        const h = getTagValue('h', event.tags)
        if (!h) {
            continue
        }
        const watermark = watermarkByH.get(h)
        if (watermark === undefined) {
            continue // nicht beigetreten → kein Schlüssel, kein Punkt
        }
        if (event.created_at > watermark) {
            rooms[h] += 1 // Regel 6: ein Ereignis, ein Zähler
        }
    }
    for (const comment of input.comments) {
        if (comment.pubkey === input.me) {
            continue
        }
        const rootId = unreadCommentRootId(comment)
        if (!rootId || input.state[threadKey(rootId)] === undefined) {
            continue // nie gelesen → kein Punkt (Regel 4)
        }
        if (comment.created_at > threadWatermark(input.state, rootId)) {
            threads[rootId] = (threads[rootId] ?? 0) + 1
        }
    }
    const roomsTotal = sumValues(rooms)
    const threadsTotal = sumValues(threads)
    return { rooms, threads, any: roomsTotal > 0 || threadsTotal > 0, roomsTotal, threadsTotal }
}

const sumValues = (counts: Record<string, number>): number => {
    let total = 0
    for (const value of Object.values(counts)) {
        total += value
    }
    return total
}

/**
 * Ist der Lesestand geladen?
 *
 * **Solange nicht, wird NICHTS gemeldet.** Ein leeres `readState` hieße Wasserzeichen 0
 * und damit „alles ungelesen" — beim Start blitzte jeder Raum kurz auf und ginge wieder
 * aus. Kein Punkt ist der korrekte Zustand für „weiß ich noch nicht"; „alles ungelesen"
 * wäre der schlimmere Fehler. Betrifft besonders iOS, wo die IndexedDB ephemer ist.
 *
 * Der Watcher startet ABSICHTLICH erst beim ersten {@link deriveUnread}-Aufruf und nicht
 * beim Modul-Eval: `readStateReady` wird von `initReadState()` neu zugewiesen — ein
 * `.then` zur Eval-Zeit hinge an der Platzhalter-Promise und meldete sofort „fertig".
 */
const readStateBooted = writable(false)
let bootWatched = false

const watchReadStateBoot = (): void => {
    if (bootWatched) {
        return
    }
    bootWatched = true
    void readStateReady.then(
        () => readStateBooted.set(true),
        () => readStateBooted.set(true), // fail-soft: aufgegeben ist auch fertig
    )
}

/**
 * Der reaktive Ungelesen-Zustand eines Space.
 *
 * `throttled(300, …)` auf beiden Event-Quellen (Muster: `feeds.ts deriveSpaceThreads`):
 * beim Kaltstart streamt der Verlauf Event für Event herein, ungedrosselt fiele die
 * ganze Ableitung pro Nachricht neu an.
 *
 * EIN Scan über den Space-Stream mit Gruppierung nach `h` — bewusst NICHT N einzelne
 * `repository.query`-Aufrufe je Raum. Die Spezifikation nennt beides; die Query-Variante
 * beruht auf einer ungemessenen Annahme über die Kosten auf einem Android-WebView, diese
 * hier braucht sie nicht: `deriveEventsForUrl` pflegt seinen Index inkrementell
 * (`@welshman/store deriveEventsByIdForUrl` hängt an `repository`+`tracker`), pro Emit
 * bleibt eine lineare Falte über den ohnehin gekappten Bestand (300/Raum, 30 Tage).
 */
export const deriveUnread = (url: string, joined: Readable<string[]>): Readable<UnreadView> => {
    watchReadStateBoot()
    return derived(
        [
            throttled(300, deriveEventsForUrl(url, [{ kinds: [MESSAGE, POLL, ZAP_GOAL] }])),
            throttled(300, deriveEventsForUrl(url, [{ kinds: [COMMENT, CHAT_THREAD] }])),
            readState,
            joined,
            pubkey,
            readStateBooted,
        ],
        ([$events, $comments, $state, $joined, $me, $booted]) =>
            $booted
                ? computeUnread({
                      url,
                      joined: $joined as string[],
                      events: $events as TrustedEvent[],
                      comments: $comments as TrustedEvent[],
                      state: $state as ReadState,
                      me: ($me as string | undefined) ?? '',
                  })
                : EMPTY_UNREAD,
    )
}
