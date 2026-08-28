/**
 * **Die Verdrahtung der REQ-Erfassung an welshmans Socket-Pool.**
 *
 * Die ganze Buchführung — und ihre Begründung — steht in {@link ./reqWatchLog}; hier
 * steht nur, wo die Ereignisse herkommen. Zwei Paare, und die Wahl innerhalb jedes
 * Paares ist der eigentliche Punkt:
 *
 * | Ereignis | Bedeutung | warum genau dieses |
 * |---|---|---|
 * | `Sending` | die App **wollte** senden | wird gefeuert, bevor eine Policy die Nachricht aus `_sendQueue` nehmen kann |
 * | `Send` | ging auf den Draht | fehlt genau dann, wenn zurückgehalten wurde |
 * | `Receiving` | kam am Draht an | synchron in `onmessage` (`socket.js:88-89`), **vor** dem Löschen aus `_recvQueue` |
 * | `Receive` | wurde zugestellt | fehlt genau dann, wenn eine Policy das Signal entfernt hat |
 *
 * Ohne diese Trennung wäre die Erfassung so blind wie das Protokoll, das sie ersetzt:
 * am 2026-08-18 gemessen, dass ein Relay `EVENT` **und** `EOSE` schickt, der Aufrufer
 * aber `NICHTS` sieht, weil `socketPolicyAuthBuffer` das `EOSE` entfernt, solange die
 * AUTH-Runde nicht abgeschlossen ist (`policy.js:68-71`). Ein Mitschnitt an `Receive`
 * hätte genau diesen Fall — den beobachteten — nicht gesehen.
 *
 * **Kosten im Normalbetrieb:** fünf Zuhörer je Socket, ein Map-Eintrag je `REQ`, der
 * beim Abschluss wieder verschwindet. Keine Timer, keine Konsolenausgabe, keine
 * Netzlast. Erst der Abruf über `window.__reqWatch()` erzeugt Ausgabe.
 */
import {
    SocketEvent,
    AuthStateEvent,
    isClientReq,
    isClientClose,
    isRelayEvent,
    isRelayEose,
    isRelayClosed,
    isRelayNotice,
    isRelayAuth,
    isRelayOk,
} from '@welshman/net'
import { on } from '@welshman/lib'
import { app } from './welshmanInstance.ts'
import {
    anwenden,
    befunde,
    filterKurz,
    leererState,
    UEBERFAELLIG_MS,
    type Befund,
    type Drahtart,
    type ReqWatchState,
} from './reqWatchLog.ts'

const state: ReqWatchState = leererState()

let listening = false

type Nachricht = unknown[]

/** Art und Sub-Id einer Relay-Nachricht — `null`, wenn sie zu keiner Subscription gehört. */
const deuten = (m: Nachricht): { art: Drahtart; subId: string | null; grund: string } | null => {
    const msg = m as Parameters<typeof isRelayEvent>[0]
    if (isRelayEvent(msg)) {
        return { art: 'EVENT', subId: String(m[1] ?? ''), grund: '' }
    }
    if (isRelayEose(msg)) {
        return { art: 'EOSE', subId: String(m[1] ?? ''), grund: '' }
    }
    if (isRelayClosed(msg)) {
        return { art: 'CLOSED', subId: String(m[1] ?? ''), grund: String(m[2] ?? '') }
    }
    if (isRelayNotice(msg)) {
        return { art: 'NOTICE', subId: null, grund: String(m[1] ?? '') }
    }
    if (isRelayAuth(msg)) {
        return { art: 'AUTH', subId: null, grund: 'challenge' }
    }
    if (isRelayOk(msg)) {
        return { art: 'OK', subId: null, grund: (m[2] ? 'true ' : 'false ') + String(m[3] ?? '') }
    }
    return null
}

type Listener = (message: Nachricht, url: string) => void
type StatusListener = (status: string, url: string) => void
type AuthStatusListener = (status: string) => void
type SocketLike = {
    url: string
    auth: {
        status: string
        on: (event: string, cb: AuthStatusListener) => unknown
        off: (event: string, cb: AuthStatusListener) => unknown
    }
    on: (event: string, cb: Listener | StatusListener) => unknown
    off: (event: string, cb: Listener | StatusListener) => unknown
}

const anhaengen = (socket: unknown): void => {
    const s = socket as SocketLike
    const url = s.url

    on<Record<string, [Nachricht, string]>, string>(s, SocketEvent.Sending, (m) => {
        const msg = m as Parameters<typeof isClientReq>[0]
        if (isClientReq(msg)) {
            anwenden(state, {
                typ: 'req-gewuenscht',
                url,
                subId: String(m[1] ?? ''),
                filter: filterKurz(m[2]),
                t: Date.now(),
            })
        } else if (isClientClose(msg)) {
            anwenden(state, { typ: 'close-gesendet', url, subId: String(m[1] ?? ''), t: Date.now() })
        }
    })

    on<Record<string, [Nachricht, string]>, string>(s, SocketEvent.Send, (m) => {
        if (isClientReq(m as Parameters<typeof isClientReq>[0])) {
            anwenden(state, { typ: 'req-gesendet', url, subId: String(m[1] ?? ''), t: Date.now() })
        }
    })

    on<Record<string, [Nachricht, string]>, string>(s, SocketEvent.Receiving, (m) => {
        const d = deuten(m)
        if (d) {
            anwenden(state, { typ: 'draht', url, subId: d.subId, art: d.art, grund: d.grund, t: Date.now() })
        }
    })

    on<Record<string, [Nachricht, string]>, string>(s, SocketEvent.Receive, (m) => {
        const d = deuten(m)
        if (d) {
            anwenden(state, { typ: 'zugestellt', url, subId: d.subId, art: d.art, t: Date.now() })
        }
    })

    on<Record<string, [string, string]>, string>(s, SocketEvent.Status, (status) => {
        anwenden(state, { typ: 'socket-status', url, status: String(status), t: Date.now() })
    })

    on<Record<string, [string]>, string>(s.auth, AuthStateEvent.Status, (status) => {
        anwenden(state, { typ: 'auth-status', url, status: String(status), t: Date.now() })
    })
}

/**
 * Hängt die Erfassung einmalig an den Pool und legt `window.__reqWatch()` bereit.
 *
 * **`_data` wird mitgenommen, nicht nur `subscribe`** — aus demselben Grund wie in
 * `relayNotices.ts`: `Pool.subscribe` ruft den Rückruf nur für **neu** angelegte
 * Sockets (`pool.js:34-38`). Der Workspace-Relay steht beim Boot oft schon, und
 * ausgerechnet der ist der interessante.
 */
export const watchRequests = (): void => {
    if (listening) {
        return
    }
    listening = true
    const pool = app.pool
    for (const socket of pool._data.values()) {
        anhaengen(socket)
    }
    pool.subscribe(anhaengen)
    ;(globalThis as { __reqWatch?: (schwelleMs?: number) => Befund[] }).__reqWatch = (
        schwelleMs = UEBERFAELLIG_MS,
    ) => befunde(state, Date.now(), schwelleMs)
}

/** Nur für Tests und die Konsole: den aktuellen Stand ohne `window` abrufen. */
export const reqWatchBefunde = (schwelleMs = UEBERFAELLIG_MS): Befund[] =>
    befunde(state, Date.now(), schwelleMs)
