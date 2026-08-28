/**
 * Adapter: Event-Kind-Konstanten aus `@welshman/util` (NIP-01, Kind-Nummern).
 *
 * **Warum diese Datei existiert.** Kind-Konstanten sind die Namen, die upstream am
 * billigsten umbenannt werden — und deren Umbenennung bei uns am teuersten ist, weil
 * sie quer durch das Paket stehen. In 0.9.5 ist genau das passiert: `ZAP_RESPONSE`
 * (9735) heißt dort `ZAP_RECEIPT`, und `ZAP_REQUEST` (9734) ist neu dazugekommen. Die
 * Zahl ändert sich nicht, der Name schon. Mit diesem Adapter ist das eine Zeile hier
 * statt fünf Dateien.
 *
 * Deshalb stehen hier **alle** Kind-Konstanten, die das Paket benutzt — auch die, die
 * den Sprung heil überstehen. Ein Adapter, der nur die gerade brechenden Namen führt,
 * ist beim nächsten Mal wieder ein halber.
 *
 * **Reine Durchreiche.** Die Namen und Werte sind unverändert die von welshman; hier
 * wird nichts umbenannt und nichts ergänzt. Eigene Kind-Nummern des Projekts gehören
 * NICHT hierher, sondern dorthin, wo sie fachlich hingehören (z. B. `js/forgeModels.ts`).
 *
 * **Diese Datei importiert ausschließlich `@welshman/util`** — siehe die Begründung in
 * `js/welshmanTags.ts`.
 */
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
    ZAP_RESPONSE, // 9735 — heißt ab 0.9.5 upstream ZAP_RECEIPT

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
