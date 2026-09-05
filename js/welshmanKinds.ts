/**
 * Adapter: Event-Kind-Konstanten (NIP-01, Kind-Nummern) — **unter ihren 0.9.5-Namen**.
 *
 * ── Welche 0.9.5-API diese Datei vorwegnimmt ─────────────────────────────────────
 * Die Kind-Konstanten von `@welshman/util`. Bis auf einen sind die Namen zwischen
 * 0.8.16 und 0.9.5 identisch; das Paket bleibt dasselbe. Der eine, der sich geändert
 * hat, war der teure: **`ZAP_RESPONSE` heisst seit 0.9.5 `ZAP_RECEIPT`** (die Zahl 9735
 * bleibt). Die Umbenennung ist mit dem Sprung vollzogen — die Aufrufstellen standen
 * schon vorher auf dem neuen Namen und mussten nicht angefasst werden.
 *
 * ── Warum die Datei bleibt, obwohl sie jetzt eine reine Weiterleitung ist ────────
 * Sie hält die Kind-Namen an EINEM Ort. Der nächste Sprung benennt wieder eine
 * Konstante um, und dann ist das hier eine Zeile statt einer Suche über 30 Dateien —
 * genau das, was der `ZAP_RESPONSE`-Fall gezeigt hat.
 *
 * Hier stehen **alle** Kind-Konstanten, die das Paket benutzt — auch die, die den
 * Sprung heil überstehen. Ein Adapter, der nur die gerade brechenden Namen führt, ist
 * beim nächsten Mal wieder ein halber. Eigene Kind-Nummern des Projekts gehören NICHT
 * hierher, sondern dorthin, wo sie fachlich hingehören (z. B. `js/forgeModels.ts`).
 *
 * **Diese Datei importiert ausschließlich `@welshman/util`** — `js/polls.ts` („bewusst
 * welshman-app-frei") und `js/articleMetrics.ts` („rein bis auf `@welshman/util`") halten
 * diese Reinheit ausdrücklich fest; ein Adapter, der nebenbei `@welshman/app`
 * hereinzieht, würde sie still aufheben.
 */

// Der eine Name, der sich in 0.9.5 ändert. Aufrufstellen benutzen bereits ZAP_RECEIPT.
export { ZAP_RECEIPT } from '@welshman/util'

// Namensgleich in 0.8.16 und 0.9.5 — gegen die 0.9.5-Exportmenge geprüft, nicht geraten.
export {
    // NIP-01 / Grundbestand
    PROFILE, // 0
    FOLLOWS, // 3
    DELETE, // 5 — NIP-09
    REACTION, // 7 — NIP-25
    MESSAGE, // 9 — NIP-C7 (Chat)
    MUTES, // 10000
    RELAYS, // 10002 — NIP-65
    APP_DATA, // 30078 — NIP-78
    REPORT, // 1984 — NIP-56
    COMMENT, // 1111 — NIP-22

    // Lesezeichen (NIP-51) — P2. Zwei Listen, eine Nummer mit Zweitbedeutung:
    // 30003 ist bei Buzz zugleich der Träger des Mesh-Mitgliedsstatus, siehe
    // `js/bookmarkModels.ts`.
    BOOKMARKS, // 10003
    NAMED_BOOKMARKS, // 30003

    // Polls (NIP-88)
    POLL, // 1068
    POLL_RESPONSE, // 1018

    // Zaps (NIP-57)
    ZAP_GOAL, // 9041

    // Calendar (NIP-52) — P2. welshman's names are NOT the spec's: the package calls the
    // time-based event `EVENT_TIME` and the RSVP `EVENT_RSVP`. They are renamed here to
    // something that says what it is (`CALENDAR_EVENT`/`CALENDAR_RSVP`), so the call site
    // reads. `CALENDAR` (31924) already carries its name; it is never queried, only built
    // as the coordinate of an `a` tag (`calendarModels.meetupCalendarAddress`).
    CALENDAR, // 31924
    EVENT_TIME as CALENDAR_EVENT, // 31923
    EVENT_RSVP as CALENDAR_RSVP, // 31925

    // Räume/Gruppen (NIP-29)
    ROOMS, // 10009
    ROOM_CREATE, // 9007
    ROOM_DELETE, // 9008
    ROOM_DELETE_EVENT, // 9005
    ROOM_JOIN, // 9021
    ROOM_LEAVE, // 9022
    ROOM_ADD_MEMBER, // 9000
    ROOM_REMOVE_MEMBER, // 9001
    ROOM_META, // 39000
    ROOM_ADMINS, // 39001
    ROOM_MEMBERS, // 39002

    // Relay-Mitgliedschaft (zooid-Directory)
    RELAY_MEMBERS, // 13534
    RELAY_JOIN, // 28934
    RELAY_INVITE, // 28935
    RELAY_LEAVE, // 28936
} from '@welshman/util'
