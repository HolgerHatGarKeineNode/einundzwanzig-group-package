/**
 * **Keine `REQ` in ein offenes AUTH hinein — sie geht sonst zweimal raus.**
 *
 * welshmans `socketPolicyAuthBuffer` ist ein **Wiederhol**-Puffer, kein Zurückhalte-Puffer
 * (`policy.js:38-85`): jede Nachricht geht sofort raus UND wird kopiert; sobald AUTH auf
 * `Ok` steht, werden die letzten ≤50 erneut gesendet. Auf einem Relay mit `auth_required`
 * bedeutet das für jede `REQ`, die vor dem Abschluss der AUTH-Runde rausgeht: einmal
 * abgelehnt, einmal wiederholt — **zwei Frames für eine Subscription**.
 *
 * Am laufenden Buzz-Relay mitgeschnitten (2026-07-31): **20 von 34** REQ-Ids gingen zweimal
 * raus. Die Kette Zeile für Zeile:
 *
 * ```
 * +903   ← ["AUTH","23e8eb…"]                                   Relay fordert AUTH
 * +1001  → ["REQ","REQ-09895391",…]                             welshman fragt trotzdem
 * +1001  ← ["CLOSED","REQ-…","auth-required: not authenticated"] abgelehnt
 * +1116  → ["AUTH",{kind:22242,…}]                              jetzt erst signiert
 * +1243  → ["REQ","REQ-09895391",…]                             dieselbe Id, zweiter Frame
 * ```
 *
 * Das ist teuer, weil Buzz **Frames** deckelt: 50 je 5 s je Pubkey (`admission.rs:9,40`,
 * gezählt werden `EVENT`, `REQ`, `COUNT`). Wird der Deckel gerissen, verwirft der Relay das
 * nächste `EVENT` mit einer nackten `NOTICE` statt eines `OK` — die Mutation verpufft still
 * (siehe `relayNotices.ts`). Jede vermeidbare `REQ` ist damit ein Stück Sicherheitsabstand.
 *
 * **Diese Policy löscht nur den ERSTEN, ohnehin zum Scheitern verurteilten Sendeversuch.**
 * Zugestellt wird die Nachricht weiterhin von welshmans eigenem Wiederhol-Puffer — der
 * hat sie beim `Sending`-Ereignis längst kopiert, bevor wir sie aus der Sende-Queue nehmen.
 * Wir bauen also keinen zweiten Zustellweg, wir streichen einen doppelten.
 *
 * **Die Fehlerrichtung ist Absicht.** Greift das Entfernen nicht (andere welshman-Version,
 * andere Queue-Mechanik), geht die Nachricht wie bisher zweimal raus — der heutige Zustand.
 * Es gibt keinen Pfad, auf dem diese Policy eine Nachricht verschwinden lässt, den es nicht
 * ohne sie auch gäbe: bei `DeniedSignature`/`Forbidden` verwirft welshman seinen Puffer,
 * aber dort wäre auch der erste Versuch abgelehnt worden.
 *
 * **Vor dem Challenge wird NICHT zurückgehalten** (`AuthStatus.None`): dann weiß niemand, ob
 * der Relay überhaupt AUTH verlangt. Eine Nachricht dort zurückzuhalten hieße, sie auf einem
 * Relay ohne AUTH für immer liegen zu lassen.
 */
import { AuthStatus, SocketEvent, isClientAuth } from '@welshman/net'

/** Zustände, in denen eine AUTH-Runde läuft — nur hier wird zurückgehalten. */
const PENDING: string[] = [AuthStatus.Requested, AuthStatus.PendingSignature, AuthStatus.PendingResponse]

type QueueLike = { remove: (item: unknown) => void }
type SocketLike = {
    auth: { status: string }
    _sendQueue: QueueLike
    on: (event: string, cb: (message: unknown, url: string) => void) => () => void
}

/**
 * Socket-Policy im Sinne von `defaultSocketPolicies`. Wird in `core.ts` einmalig
 * dazugestellt — NEBEN `socketPolicyAuthBuffer`, nicht an dessen Stelle. Der Rückgabewert
 * ist der Abmelder, den welshman beim Aufräumen des Sockets ruft.
 */
export const socketPolicyAuthHold = (socket: unknown): (() => void) => {
    const s = socket as SocketLike
    return s.on(SocketEvent.Sending, (message) => {
        // Die AUTH-Antwort selbst muss durch — sonst käme die Runde nie zum Abschluss.
        if (isClientAuth(message as Parameters<typeof isClientAuth>[0])) {
            return
        }
        if (PENDING.includes(s.auth.status)) {
            s._sendQueue.remove(message)
        }
    })
}
