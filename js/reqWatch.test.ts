/**
 * Die **Verdrahtung** der REQ-Erfassung — an einer echten welshman-Socket aus dem
 * echten Pool der App-Instanz (`app.pool`), mit den Socket-Policies, die
 * `welshmanInstance.ts` ihr mitgibt. Seit 0.9.5 gibt es keinen globalen `Pool.get()`
 * mehr — jede App hat ihren eigenen.
 *
 * `reqWatchLog.test.ts` prüft die Buchführung; sie ist rein und könnte tadellos sein,
 * während dieses Modul an den falschen Ereignissen hängt. Genau das wäre der teure
 * Fehler: eine Erfassung, die nie etwas erfasst, sieht im Betrieb aus wie „der Fall
 * ist nicht wieder aufgetreten".
 *
 * Kein WebSocket nötig — `onmessage` tut nichts anderes als `_recvQueue.push(m)` plus
 * `emit(Receiving, m, url)` (`socket.js:83-98`), und `_sendQueue.processItem` ruft
 * `this._ws?.send(...)` mit optionalem Zugriff, feuert `Send` also auch ohne Verbindung
 * (`socket.js:41-44`).
 *
 * Ausführen: node --test --experimental-strip-types packages/einundzwanzig-group/js/reqWatch.test.ts
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { AuthStatus, SocketEvent } from '@welshman/net'
import { app } from './welshmanInstance.ts'
import { watchRequests, reqWatchBefunde } from './reqWatch.ts'

const URL_ = 'wss://relay.wiring.invalid/'

const warten = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('REQ-Erfassung: die Verdrahtung am echten Pool', () => {
    test('ein von welshman verschlucktes CLOSED landet als Befund — mit Grund und AUTH-Zustand', async () => {
        watchRequests()

        const socket = app.pool.get(URL_)
        socket._sendQueue.start() // sonst feuert `Send` nie (ohne offene Verbindung)
        socket.emit(SocketEvent.Status, 'open', URL_)

        // **Reihenfolge: erst SENDEN, dann die AUTH-Anforderung.** Bis zum
        // welshman-0.9.5-Sprung stand `setStatus(PendingSignature)` davor und der Fall
        // war trotzdem grün — weil der GLOBALE Pool von damals unsere eigene Policy
        // `socketPolicyAuthHold` gar nicht trug (die pushte `core.ts`, das dieser Test
        // nicht importiert). Seit 0.9.5 gehören die Socket-Policies zur App-Instanz, und
        // `app.pool` trägt sie immer — der Hold streicht eine REQ, die während
        // `PendingSignature` abgeht, und der Befund war folgerichtig `nie-gesendet`
        // statt `verschluckt`.
        //
        // Diese Reihenfolge ist zugleich die realistischere: produktiv geht die REQ
        // hinaus, der Relay fordert daraufhin AUTH, und erst dann kommt das CLOSED, das
        // welshmans AuthBuffer verschluckt. Genau diesen Ablauf soll die Erfassung sehen.
        const sub = 'REQ-verdraht1'
        socket.send(['REQ', sub, { kinds: [30617], '#h': ['raum-abcdefgh'] }])
        await warten(250)
        socket.auth.setStatus(AuthStatus.PendingSignature)

        // Der Relay antwortet — und `socketPolicyAuthBuffer` nimmt die Antwort aus
        // `_recvQueue`, bevor sie zugestellt wird.
        const closed = ['CLOSED', sub, 'auth-required: we cannot serve requests to unauthenticated users']
        socket._recvQueue.push(closed)
        socket.emit(SocketEvent.Receiving, closed, URL_)
        await warten(250)

        // `load()` gibt nach seiner Zeitgrenze auf und schließt die Subscription.
        socket.send(['CLOSE', sub])
        await warten(250)

        const b = reqWatchBefunde().find((x) => x.subId === sub)
        assert.ok(b, 'die Erfassung muss diesen Fall sehen')
        assert.equal(b.art, 'verschluckt')
        assert.equal(b.gesendet, true, 'die REQ ging auf den Draht')
        assert.match(b.draht, /^CLOSED «auth-required: /)
        assert.equal(b.authStatus, 'pending_signature')
        assert.equal(b.socketStatus, 'open', 'kein Disconnect')
        assert.equal(b.filter, 'kinds=30617 #h=raum-abc')
        assert.ok(b.alterMs >= 250, 'das Alter zählt ab dem Sendewunsch')

        app.pool.remove(URL_)
    })

    test('eine sauber quittierte Anfrage hinterlässt KEINEN Befund', async () => {
        // Die Kalibrierung: eine Erfassung, die jede Anfrage meldet, meldet nichts.
        watchRequests()

        const socket = app.pool.get(URL_)
        socket._sendQueue.start()
        socket.auth.setStatus(AuthStatus.Ok)

        const sub = 'REQ-verdraht2'
        socket.send(['REQ', sub, { kinds: [1] }])
        await warten(250)

        const eose = ['EOSE', sub]
        socket._recvQueue.push(eose)
        socket.emit(SocketEvent.Receiving, eose, URL_)
        await warten(250)

        socket.send(['CLOSE', sub])
        await warten(250)

        assert.equal(
            reqWatchBefunde(0).find((x) => x.subId === sub),
            undefined,
            'auch bei Schwelle 0 kein Befund',
        )

        app.pool.remove(URL_)
    })

    test('`window.__reqWatch()` steht bereit und liefert dieselbe Liste', () => {
        watchRequests()
        const abruf = (globalThis as { __reqWatch?: (s?: number) => unknown[] }).__reqWatch

        assert.equal(typeof abruf, 'function', 'ohne diesen Griff ist die Erfassung im Betrieb unerreichbar')
        assert.deepEqual(abruf?.(0), reqWatchBefunde(0))
    })
})
