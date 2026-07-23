/**
 * Ungelesen-Ableitung (P3) — der **Punkt**, keine Zahl.
 *
 * Es gibt bewusst KEINEN eigenen Zähl-Store. „Ungelesen" ist eine reine Projektion aus
 * zwei Quellen, die es ohnehin schon gibt:
 *
 *     repository (Events, url-gescopt über den tracker)  ─┐
 *     readState  (Wasserzeichen, Wall-Clock)             ─┴─> throttled(300) ─> UnreadView
 *
 * Damit kann ein Marker nie gegen den Feed divergieren — beide lesen dieselbe
 * `repository`, aus der auch der Raum-Verlauf lebt.
 *
 * Abgeleitet wird ein BOOLEAN, nicht `count`: die Frage einer Listenzeile ist „muss ich
 * da rein?". Der Zähler kommt in P6, wenn das Wasserzeichen lange genug Wall-Clock ist,
 * um ihm zu glauben. Ein Punkt kann zu spät kommen, aber nicht lügen.
 *
 * Der Vertrag zur Oberfläche (Blade liest ihn defensiv über `$store.unread?.…`):
 *     Alpine.store('unread') → { rooms: Record<h, boolean>, threads: Record<rootId, boolean>, any: boolean }
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

/** Was die Oberfläche sieht. Werte sind boolesch — es gibt in P3 keine Zahl. */
export type UnreadView = {
    /** Schlüssel ist `room.h`. Fehlender Schlüssel = kein Marker. */
    rooms: Record<string, boolean>
    /** Schlüssel ist `thread.rootId` (NIP-22 `E`). */
    threads: Record<string, boolean>
    /** Irgendwo etwas Ungelesenes — speist den Punkt am Chat-Tab der Bottom-Nav. */
    any: boolean
}

export const EMPTY_UNREAD: UnreadView = { rooms: {}, threads: {}, any: false }

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
 *
 * Gelöschtes zählt automatisch nicht mit: die Quelle (`repository.query`) schließt
 * kind-5-Tombstones per Default aus, und NIP-29-9005-Ziele werden aktiv aus der
 * `repository` entfernt (`feeds.ts honorDeleteEvent`).
 */
export function computeUnread(input: UnreadInput): UnreadView {
    const rooms: Record<string, boolean> = {}
    const threads: Record<string, boolean> = {}
    if (!input.me) {
        return { rooms, threads, any: false }
    }
    const watermarkByH = new Map<string, number>()
    for (const h of input.joined) {
        rooms[h] = false
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
            rooms[h] = true
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
            threads[rootId] = true
        }
    }
    const any = Object.values(rooms).some(Boolean) || Object.values(threads).some(Boolean)
    return { rooms, threads, any }
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
