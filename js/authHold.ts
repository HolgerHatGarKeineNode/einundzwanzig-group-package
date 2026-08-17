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
 *
 * **Vor dem Challenge wird NICHT zurückgehalten** (`AuthStatus.None`): dann weiß niemand, ob
 * der Relay überhaupt AUTH verlangt. Eine Nachricht dort zurückzuhalten hieße, sie auf einem
 * Relay ohne AUTH für immer liegen zu lassen.
 *
 * ── Die AUTH-Runde braucht eine Frist — sonst hält diese Policy für immer ───────
 *
 * Hier stand: „Es gibt keinen Pfad, auf dem diese Policy eine Nachricht verschwinden
 * lässt, den es nicht ohne sie auch gäbe." **Das ist widerlegt** (N4, 2026-08-18, echte
 * welshman-Sockets gegen einen ws-Nachbau, mit und ohne diese Policy als Gegenprobe).
 *
 * welshmans `AuthState.doAuth` kennt zwei Wege, auf denen die Runde **nie** endet
 * (`@welshman/net/dist/net/src/auth.js:71-94`):
 *
 * 1. `await tryCatch(() => sign(template))` — `tryCatch` fängt eine **abgelehnte**
 *    Zusage nicht ab, es hängt ihr nur einen `catch`-Zuhörer an (`lib/Tools.js:834-846`).
 *    Das `await` wirft also weiter, `doAuth` hat kein `try`, und der Aufrufer in
 *    `makeSocketPolicyAuth` ruft es ohne `await`/`catch` (`policy.js:196`). Ergebnis:
 *    eine unbehandelte Ablehnung — und der Status bleibt für immer `pending_signature`.
 *    Auslöser im Alltag: eine abgelehnte NIP-07-Aufforderung, eine Erweiterung, die beim
 *    Reload noch nicht injiziert ist, ein NIP-46-Bunker, der nicht antwortet.
 * 2. `shouldAuth` ist beim Challenge `false` (bei uns: noch kein Pubkey) — dann wird
 *    `doAuth` nie gerufen und der Status bleibt `requested`, bis der Socket neu aufbaut.
 *
 * Gemessen, Relay mit **optionalem** AUTH (Challenge, bedient aber trotzdem), Signer
 * lehnt ab, zweite Anfrage auf derselben Verbindung:
 *
 * ```
 * mit dieser Policy:   aufrufer_sah NICHTS   draht: kein zweiter REQ
 * ohne diese Policy:   aufrufer_sah EVENT    draht: ←REQ  →EVENT+EOSE
 * ```
 *
 * Ohne Frist macht die Policy aus „Daten kommen, nur ohne EOSE" ein „gar nichts".
 * Deshalb hält sie nur, solange die Runde **läuft**: nach {@link AUTH_HOLD_FRIST_MS}
 * geht wieder alles durch — zurück auf das Verhalten vor der Policy, also genau die
 * Fehlerrichtung, die dieser Docblock ohnehin zusagt.
 *
 * **Warum 10 s:** eine gesunde Runde ist in 100–500 ms durch (gemessen); Buzz schließt
 * eine unauthentifizierte Verbindung ohnehin nach 5 s (`connection.rs`, `AUTH_TIMEOUT`);
 * der langsamste legitime Weg ist ein NIP-46-Bunker über einen fremden Relay. 10 s liegt
 * über allem davon und unter jeder Dauer, in der Zurückhalten noch etwas einspart.
 */
import { AuthStatus, AuthStateEvent, SocketEvent, isClientAuth } from '@welshman/net'
import { on } from '@welshman/lib'

/** Zustände, in denen eine AUTH-Runde läuft — nur hier wird zurückgehalten. */
const PENDING: string[] = [AuthStatus.Requested, AuthStatus.PendingSignature, AuthStatus.PendingResponse]

/**
 * Wie lange eine AUTH-Runde höchstens „läuft". Danach gilt sie als hängen geblieben
 * und es wird nichts mehr zurückgehalten — Begründung im Modul-Docblock.
 */
export const AUTH_HOLD_FRIST_MS = 10_000

/**
 * Die reine Entscheidung, herausgezogen, damit sie ohne Socket und ohne Uhr prüfbar ist.
 *
 * `rundeSeit === null` heißt „keine laufende Runde beobachtet" — dann entscheidet
 * allein der Status, damit ein Zuhörer, der die Flanke verpasst hat, nicht dauerhaft
 * durchwinkt.
 */
export const haeltZurueck = (status: string, rundeSeit: number | null, jetzt: number): boolean => {
    if (!PENDING.includes(status)) {
        return false
    }
    return rundeSeit === null || jetzt - rundeSeit < AUTH_HOLD_FRIST_MS
}

type Listener = (message: unknown, url: string) => void
type StatusListener = (status: string) => void
type QueueLike = { remove: (item: unknown) => void }
type AuthLike = {
    status: string
    on: (event: string, cb: StatusListener) => unknown
    off: (event: string, cb: StatusListener) => unknown
}
type SocketLike = {
    auth: AuthLike
    _sendQueue: QueueLike
    on: (event: string, cb: Listener) => unknown
    off: (event: string, cb: Listener) => unknown
}

/**
 * Socket-Policy im Sinne von `defaultSocketPolicies`. Wird in `core.ts` einmalig
 * dazugestellt — NEBEN `socketPolicyAuthBuffer`, nicht an dessen Stelle. Der Rückgabewert
 * ist der Abmelder, den welshman beim Aufräumen des Sockets ruft.
 *
 * ── Abgemeldet wird über welshmans `on()`, NICHT über `socket.on()` ────────────
 *
 * Hier stand `return s.on(SocketEvent.Sending, cb)` — im Glauben, das liefere den
 * Abmelder. Tut es nicht: `Socket extends EventEmitter` (`net/dist/net/src/socket.js:22`),
 * und `EventEmitter.prototype.on` gibt zum Verketten **`this`** zurück, also das
 * Socket-Objekt selbst. welshman sammelt die Policy-Rückgaben (`socket.js:58`
 * `this.unsubscribers = policies.map(p => p(this))`) und ruft sie beim Aufräumen
 * (`socket.js:114` `this.unsubscribers.forEach(call)`, mit `call = f => f()`) — auf
 * ein Socket-Objekt angewandt ergibt das `TypeError: f is not a function`.
 *
 * Gemessen an der echten welshman-Socket (0.8.x): `Socket.cleanup()` UND
 * `Pool.remove(url)` warfen. Und weil der Wurf in `Pool.remove` VOR
 * `this._data.delete(url)` liegt (`pool.js:44-50`), blieb der tote Socket danach
 * sogar in der Registry stehen. Das traf jede Socket, denn `core.ts` hängt diese
 * Policy an welshmans geteiltes `defaultSocketPolicies`.
 *
 * `on()` aus `@welshman/lib` (`Tools.js:1198`) registriert identisch und gibt
 * `() => target.off(event, cb)` zurück — genau das, was jede welshman-eigene Policy
 * in `policy.js` benutzt (`socketPolicyPing`, `socketPolicyAuthBuffer`). Am
 * Zurückhalte-Verhalten ändert sich dadurch nichts: der Callback und seine
 * Registrierung sind unverändert, nur der Rückgabewert ist jetzt aufrufbar.
 */
export const socketPolicyAuthHold = (socket: unknown): (() => void) => {
    const s = socket as SocketLike
    /** Beginn der laufenden Runde; `null`, sobald sie beendet ist. */
    let rundeSeit: number | null = null

    const abStatus = on<Record<string, [string]>, string>(
        s.auth,
        AuthStateEvent.Status,
        (status) => {
            if (!PENDING.includes(String(status))) {
                rundeSeit = null
            } else if (rundeSeit === null) {
                rundeSeit = Date.now()
            }
        },
    )

    const abSending = on<Record<string, [unknown, string]>, string>(s, SocketEvent.Sending, (message) => {
        // Die AUTH-Antwort selbst muss durch — sonst käme die Runde nie zum Abschluss.
        if (isClientAuth(message as Parameters<typeof isClientAuth>[0])) {
            return
        }
        if (haeltZurueck(s.auth.status, rundeSeit, Date.now())) {
            s._sendQueue.remove(message)
        }
    })

    return () => {
        abStatus()
        abSending()
    }
}
