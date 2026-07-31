/**
 * **Die letzte `NOTICE` je Relay — das einzige, was Buzz zu einem verworfenen Event sagt.**
 *
 * NIP-01 verpflichtet ein Relay, auf JEDES `EVENT` mit einem `OK` zu antworten. Buzz hält
 * sich daran nicht, wenn der Ratenbegrenzer greift: `send_admission_result` wird für Events
 * mit `sub_id: None` gerufen (`connection.rs:632-650`), und ohne Subscription-Id baut
 * `request_rejection_message` eine nackte **`NOTICE`** — ohne die Event-Id. Am laufenden
 * Relay mitgeschnitten:
 *
 * ```
 * →  ["EVENT",{"kind":9005,"tags":[["e",…],["h",…]],…}]
 * ←  ["NOTICE","rate-limited: quota exceeded; retry in 2s"]
 * ```
 *
 * **Was das im Client anrichtet:** welshman ordnet Publish-Ergebnisse über die Event-Id aus
 * dem `OK` zu. Kommt keins, bleibt der Thunk für immer `pending` — der Aufrufer wartet
 * ewig, der Knopf bleibt `busy`, es gibt keine Fehlermeldung und keinen zweiten Versuch.
 * Genau das trug den wochenlangen `buzz-moderation:95`-Flake: 60 Nachrichten/Minute je
 * Pubkey sind Buzz' Produktions-Default (`rate_limit.rs:110`), und ob die Quote im Moment
 * des Klicks erschöpft ist, hängt am Timing — deshalb war der Test mal grün, mal rot, und
 * ein `console.log` im Pfad verschob ihn auf 7/7 grün.
 *
 * Dieses Modul kann die NOTICE nicht dem Event zuordnen — die Information gibt es am Draht
 * nicht. Es kann aber die **letzte NOTICE mit Zeitstempel** festhalten, sodass ein Publish,
 * der ohne Verdikt ausläuft, den Grund NENNEN kann statt zu raten. Eine NOTICE, die älter
 * ist als der Publish selbst, wird dabei verworfen ({@link noticeSince}) — sonst erbte ein
 * späterer, ganz anderer Fehlschlag eine fremde Begründung.
 */
import { Pool, SocketEvent, isRelayNotice } from '@welshman/net'
import { setRelayNoticeReader } from './publishResult'

/** Letzte NOTICE je Relay-URL, mit Empfangszeit (`Date.now()`). */
const lastNotice = new Map<string, { text: string; at: number }>()

let listening = false

/**
 * Hängt sich einmalig an den Socket-Pool und schreibt jede eingehende NOTICE mit.
 *
 * Idempotent — der Aufruf steht im App-Boot und darf beliebig oft passieren.
 *
 * **`_data` wird ausdrücklich mitgenommen, nicht nur `subscribe`.** welshmans
 * `Pool.subscribe` ruft den Callback NUR für neu angelegte Sockets (`pool.js:34-38`) — auf
 * einen bereits offenen Space-Relay hörte dieses Modul sonst nie, und ausgerechnet der ist
 * beim Start schon da. Ein Zuhörer, der genau die eine Verbindung verpasst, um die es geht,
 * wäre schlimmer als keiner: er meldete „keine NOTICE" und klänge dabei wie eine Messung.
 */
export const watchRelayNotices = (): void => {
    if (listening) {
        return
    }
    listening = true
    const pool = Pool.get()
    const attach = (socket: { on: (e: typeof SocketEvent.Receive, cb: (m: unknown, url: string) => void) => unknown }) => {
        socket.on(SocketEvent.Receive, (message, url) => {
            if (isRelayNotice(message as Parameters<typeof isRelayNotice>[0])) {
                lastNotice.set(url, { text: String((message as unknown[])[1] ?? ''), at: Date.now() })
            }
        })
    }
    for (const socket of pool._data.values()) {
        attach(socket)
    }
    pool.subscribe(attach)
    setRelayNoticeReader(noticeSince)
}

/**
 * Die NOTICE dieses Relays, sofern sie **nach** `since` eintraf; sonst ''.
 *
 * Der Zeitfilter ist der ganze Punkt: ohne ihn bekäme jeder spätere Publish-Fehlschlag die
 * Begründung einer längst vergangenen NOTICE angeheftet — eine Fehlermeldung, die
 * überzeugend klingt und nicht zum Vorfall gehört.
 */
export const noticeSince = (url: string, since: number): string => {
    const entry = lastNotice.get(url)
    return entry && entry.at >= since ? entry.text : ''
}

/** Nur für Tests: den Mitschnitt leeren. */
export const _resetRelayNotices = (): void => {
    lastNotice.clear()
}
