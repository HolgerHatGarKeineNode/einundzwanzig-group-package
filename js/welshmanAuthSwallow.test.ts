/**
 * N4 — Vertragstest gegen die **installierte** welshman-Fassung: welche
 * Abschluss-Signale entfernt `socketPolicyAuthBuffer`, bevor sie zugestellt werden?
 *
 * **Warum das die Kernfrage von N4 ist.** Beim P10-Bau blieb zweimal ein `load()` ohne
 * jede Antwort hängen — „kein EOSE, kein CLOSED, kein Disconnect". Der naheliegende
 * Kandidat war, dass ein `CLOSED` `requestOne` sofort mit `[]` auflöst
 * (`request.js:63-76`). Am 2026-08-18 gegen einen ws-Nachbau von Buzz gemessen, und die
 * Antwort ist präziser: auf dem AUTH-Pfad **erreicht das CLOSED `requestOne` nie**.
 * `socketPolicyAuthBuffer` nimmt es aus `_recvQueue`, bevor `SocketEvent.Receive` feuert
 * (`@welshman/net/dist/net/src/policy.js:62-75`). Der Aufrufer sieht deshalb nicht „der
 * Relay hat abgelehnt", sondern **gar nichts** — bis die 3-s-Zeitgrenze von `load()`
 * greift.
 *
 * Drei Signale betrifft das, und das mittlere ist das folgenreiche:
 *
 * | Signal | Bedingung | Folge |
 * |---|---|---|
 * | `CLOSED` mit Präfix `auth-required:` | immer | Ablehnung wird zur Stille |
 * | `EOSE` | `auth.status ∉ {none, ok}` | **eine völlig normale Antwort wird zur Stille** |
 * | `OK false` mit Präfix `auth-required:` | immer | Publish ohne Verdikt |
 *
 * Zeile 2 ist der beobachtete Fall: bleibt die AUTH-Runde hängen — und sie kann das,
 * `doAuth` lässt eine abgelehnte Signatur als unbehandelte Zusage entkommen und den
 * Status auf `pending_signature` stehen (`auth.js:81-93`, `policy.js:196`) — dann
 * verschwindet **jedes** EOSE dieser Verbindung, auch von Anfragen, die der Relay
 * einwandfrei beantwortet.
 *
 * ── Ohne Netz und ohne neue Abhängigkeit gemessen ─────────────────────────────
 *
 * Eine echte `Socket` braucht für diesen Vertrag kein WebSocket: `onmessage` tut nichts
 * anderes als `_recvQueue.push(m)` gefolgt von `emit(Receiving, m, url)`
 * (`socket.js:83-98`) — genau das steht unten. Gemessen wird an welshmans eigener
 * `defaultSocketPolicies`, nicht an einem Nachbau der Policy.
 *
 * Ausführen: node --test --experimental-strip-types packages/einundzwanzig-group/js/welshmanAuthSwallow.test.ts
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { AuthStatus, Socket, SocketEvent, defaultSocketPolicies } from '@welshman/net'

const URL_ = 'wss://relay.invalid/'
const SUB = 'REQ-abcd1234'

/** Ein Frame so einspeisen, wie `Socket.onmessage` es tut, und auf die Zustellung warten. */
const einspeisen = async (socket: Socket, nachricht: unknown[]): Promise<unknown[][]> => {
    const zugestellt: unknown[][] = []
    const zuhoerer = (m: unknown) => zugestellt.push(m as unknown[])
    socket.on(SocketEvent.Receive, zuhoerer)

    socket._recvQueue.push(nachricht)
    socket.emit(SocketEvent.Receiving, nachricht, URL_)

    // `_recvQueue` verarbeitet über `setTimeout(batchDelay = 100)`; 250 ms sind
    // reichlich und machen den Fall unabhängig von der Maschine.
    await new Promise((r) => setTimeout(r, 250))
    socket.off(SocketEvent.Receive, zuhoerer)
    return zugestellt
}

const socketMit = (status: AuthStatus): Socket => {
    const socket = new Socket(URL_, defaultSocketPolicies)
    socket.auth.setStatus(status)
    return socket
}

describe('welshman entfernt Abschluss-Signale während einer laufenden AUTH-Runde', () => {
    test('CLOSED mit Präfix `auth-required:` wird NICHT zugestellt', async () => {
        const socket = socketMit(AuthStatus.PendingSignature)
        const zugestellt = await einspeisen(socket, [
            'CLOSED',
            SUB,
            'auth-required: we cannot serve requests to unauthenticated users',
        ])
        socket.cleanup()

        assert.deepEqual(zugestellt, [], 'die Ablehnung erreicht requestOne nie')
    })

    test('EOSE wird NICHT zugestellt — obwohl der Relay sauber geantwortet hat', async () => {
        // Der beobachtete Fall. Hängt die Runde, verschwindet dieses Signal dauerhaft.
        const socket = socketMit(AuthStatus.PendingSignature)
        const zugestellt = await einspeisen(socket, ['EOSE', SUB])
        socket.cleanup()

        assert.deepEqual(zugestellt, [], 'kein EOSE, obwohl der Relay eins geschickt hat')
    })

    test('KALIBRIERUNG: nach `ok` kommt dasselbe EOSE durch', async () => {
        // Ohne diesen Fall bewiese der Fall darüber nur, dass die Zustellung überhaupt
        // nicht funktioniert.
        const socket = socketMit(AuthStatus.Ok)
        const zugestellt = await einspeisen(socket, ['EOSE', SUB])
        socket.cleanup()

        assert.deepEqual(zugestellt, [['EOSE', SUB]])
    })

    test('KALIBRIERUNG: ein CLOSED mit anderem Präfix kommt durch — das Präfix ist der Unterschied', async () => {
        // `restricted:` ist Buzz' und zooids Antwort an ein Nicht-Mitglied. Nur diese
        // Form erreicht den Aufrufer; `auth-required:` nicht.
        const socket = socketMit(AuthStatus.PendingSignature)
        const zugestellt = await einspeisen(socket, ['CLOSED', SUB, 'restricted: you are not a member'])
        socket.cleanup()

        assert.deepEqual(zugestellt, [['CLOSED', SUB, 'restricted: you are not a member']])
    })

    test('EVENT kommt auch während der Runde durch — nur der ABSCHLUSS fehlt', async () => {
        // Deshalb sieht der Fall im Produkt nicht wie ein Fehler aus, sondern wie
        // „lädt ewig": Daten sind da, das Fertig-Signal nicht.
        const socket = socketMit(AuthStatus.PendingSignature)
        const event = { id: 'x', kind: 1, tags: [], content: '', pubkey: 'y', created_at: 0, sig: 'z' }
        const zugestellt = await einspeisen(socket, ['EVENT', SUB, event])
        socket.cleanup()

        assert.equal(zugestellt.length, 1)
    })
})
