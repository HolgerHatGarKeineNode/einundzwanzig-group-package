/**
 * Adapter: Event-Kind-Konstanten (NIP-01, Kind-Nummern) — **unter ihren 0.9.5-Namen**.
 *
 * ── Welche 0.9.5-API diese Datei vorwegnimmt ─────────────────────────────────────
 * Die Kind-Konstanten von `@welshman/util`. Bis auf einen sind die Namen zwischen
 * 0.8.16 und 0.9.5 identisch; das Paket bleibt dasselbe. Der eine, der sich ändert,
 * ist der teure: **`ZAP_RESPONSE` heißt in 0.9.5 `ZAP_RECEIPT`** (die Zahl 9735 bleibt).
 * Diese Datei exportiert deshalb schon `ZAP_RECEIPT` und bildet es intern auf das
 * 0.8.16-`ZAP_RESPONSE` ab. Das Paket kennt den alten Namen ab jetzt nicht mehr.
 *
 * ── Was in P3 daraus entfällt ────────────────────────────────────────────────────
 * Die Zeile `export { ZAP_RESPONSE as ZAP_RECEIPT }` wird zu einem gewöhnlichen
 * `export { ZAP_RECEIPT }`; danach ist die ganze Datei eine reine Weiterleitung und
 * kann ersatzlos gelöscht werden, indem die Importe wieder auf `@welshman/util`
 * zeigen. **Keine Aufrufstelle muss angefasst werden.**
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
export { ZAP_RESPONSE as ZAP_RECEIPT } from '@welshman/util'

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

    // Polls (NIP-88)
    POLL, // 1068
    POLL_RESPONSE, // 1018

    // Zaps (NIP-57)
    ZAP_GOAL, // 9041

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
