/**
 * Zuordnung: `CLOSED`-Grund des Relays → Zustand der Raumfläche.
 *
 * **Warum das eine eigene, reine Funktion ist.** Bis P8 galt jedes `CLOSED`
 * mit `restricted:`-Präfix als dasselbe: „kein Zugriff". Am laufenden
 * Buzz-Teststack gemessen (2026-08-17, `buzz-test:3001`, frisch per `down -v`)
 * sind es aber zwei verschiedene Lagen mit zwei verschiedenen Auswegen:
 *
 * | Lage (Buzz)                                   | Antwort auf den REQ                            |
 * |-----------------------------------------------|------------------------------------------------|
 * | Raum verlassen (kind 9022), Sub war offen      | `CLOSED restricted: channel access revoked`    |
 * | nie Mitglied, Raum privat                      | `CLOSED restricted: not a channel member`      |
 * | Raum gelöscht (9008) bzw. nie existiert        | `CLOSED restricted: not a channel member`      |
 * | kein Relay-Mitglied                            | AUTH `OK false restricted: not a relay member`, |
 * |                                                | REQ danach `CLOSED auth-required: not authenticated` |
 * | offener Raum, nie beigetreten                  | `EOSE` (kein CLOSED — Lesen ist erlaubt)        |
 *
 * Auf zooid (Vereins-Space) heißt derselbe Riegel
 * `restricted: you are not a member of this relay` — er muss weiter auf
 * „kein Zugriff" fallen, sonst kippt das Gate aus P11.
 *
 * **`channel access revoked` ist KEIN Zugriffsurteil.** Buzz sendet ihn, wenn
 * sich die RAUM-Mitgliedschaft geändert hat und er deshalb die laufenden Subs
 * dieses Raums abräumt (`buzz-relay/src/handlers/side_effects.rs:131`) — beim
 * eigenen Austritt, beim Entfernen durch einen Admin, beim Archivieren des
 * Raums und beim Umschalten offen→privat. Der Relay-Zugang selbst bleibt
 * bestehen. Ob der Raum danach noch lesbar ist, sagt der Grund NICHT; das
 * beantwortet erst der nächste REQ (gemessen: offener Raum → `EOSE`,
 * privater/gelöschter Raum → `restricted: not a channel member`).
 *
 * **Die Zuordnung hängt an einer Zeichenkette — und das ist bewusst eine
 * ALLOWLIST.** Genau ein Grund öffnet den freundlichen Weg, alles andere mit
 * `restricted:`-Präfix fällt auf „kein Zugriff". Ändert eine Relay-Version
 * den Text, verschiebt sich ein Fall deshalb immer von „freundlich" nach
 * „gesperrt" — nie umgekehrt. Der Nutzer sieht dann im schlimmsten Fall ein
 * Gate zu viel; er bekommt nie einen Beitreten-Knopf angeboten, der ins Leere
 * klickt. Eine Deny-Liste („alles außer X ist harmlos") hätte die
 * entgegengesetzte, gefährliche Fehlerrichtung.
 */

/**
 * Was der Grund über den Raum aussagt.
 *
 * - `blocked` — kein Zugriff. Die Raumfläche zeigt das Relay-Gate.
 * - `membershipChanged` — die Raum-Mitgliedschaft hat sich geändert, der
 *   Relay hat die Subs dieses Raums abgeräumt. Kein Urteil über den Zugriff:
 *   der Aufrufer fragt neu und entscheidet an DESSEN Antwort.
 * - `unrelated` — sagt nichts über die Berechtigung (Rate-Limit, `error:`,
 *   `auth-required:`). Die Fläche bleibt, wie sie ist.
 */
export type RoomGateVerdict = 'blocked' | 'membershipChanged' | 'unrelated'

/**
 * Der EINZIGE Grund, der nicht als Zugriffsverweigerung gilt. Exakter
 * Vergleich (nach `trim`/`toLowerCase`), kein Präfix-Test: ein Grund wie
 * `restricted: channel access revoked (banned)` wäre eine andere Lage und
 * fällt richtigerweise auf `blocked`.
 */
const MEMBERSHIP_CHANGED_REASON = 'restricted: channel access revoked'

/** NIP-01: nur `restricted:` ist eine Aussage über die Berechtigung. */
const RESTRICTED_PREFIX = 'restricted:'

export const classifyRoomClosedReason = (reason: string): RoomGateVerdict => {
    const normalized = reason.trim().toLowerCase()
    if (!normalized.startsWith(RESTRICTED_PREFIX)) {
        return 'unrelated'
    }
    if (normalized === MEMBERSHIP_CHANGED_REASON) {
        return 'membershipChanged'
    }
    return 'blocked'
}
