/**
 * Die Zurückhalte-Policy für die AUTH-Runde.
 *
 * Der teure Fehler wäre hier nicht „hält zu wenig zurück" (dann geht die REQ wie vor der
 * Policy zweimal raus — der heutige Zustand), sondern „hält zu VIEL zurück": eine
 * AUTH-Antwort, die hängen bleibt, oder ein Zurückhalten vor dem Challenge würde den
 * Client auf einem Relay ohne AUTH dauerhaft stumm schalten. Genau diese beiden Fälle
 * stehen deshalb als eigene Gegenproben unten.
 *
 * Ausführen: node --test --experimental-strip-types packages/einundzwanzig-group/js/authHold.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { socketPolicyAuthHold } from './authHold.ts'

const REQ = ['REQ', 'REQ-1', { kinds: [1] }]
const AUTH = ['AUTH', { kind: 22242, tags: [], content: '', sig: '', id: '', pubkey: '', created_at: 0 }]
const EVENT = ['EVENT', { kind: 9, tags: [], content: '', sig: '', id: '', pubkey: '', created_at: 0 }]

/** Socket-Attrappe: merkt sich, was aus der Sende-Queue entfernt wurde. */
const fakeSocket = (status: string) => {
    let handler: ((m: unknown, url: string) => void) | null = null
    const entfernt: unknown[] = []
    const socket = {
        auth: { status },
        _sendQueue: { remove: (item: unknown) => entfernt.push(item) },
        on: (_event: string, cb: (m: unknown, url: string) => void) => {
            handler = cb
            return () => {}
        },
    }
    return {
        socket,
        entfernt,
        senden: (message: unknown) => handler?.(message, 'ws://x/'),
        setStatus: (s: string) => {
            socket.auth.status = s
        },
    }
}

for (const status of ['requested', 'pending_signature', 'pending_response']) {
    test(`Während der AUTH-Runde (${status}) wird die REQ aus der Sende-Queue genommen`, () => {
        const f = fakeSocket(status)
        socketPolicyAuthHold(f.socket)
        f.senden(REQ)
        assert.deepEqual(f.entfernt, [REQ])
    })
}

test('VOR dem Challenge (none) wird nichts zurückgehalten', () => {
    // Dort weiß niemand, ob der Relay überhaupt AUTH verlangt. Zurückhalten hieße, die
    // Nachricht auf einem Relay ohne AUTH für immer liegen zu lassen.
    const f = fakeSocket('none')
    socketPolicyAuthHold(f.socket)
    f.senden(REQ)
    assert.deepEqual(f.entfernt, [], 'keine Zurückhaltung ohne laufende AUTH-Runde')
})

for (const status of ['ok', 'denied_signature', 'forbidden']) {
    test(`Nach Abschluss der Runde (${status}) geht alles wieder direkt raus`, () => {
        const f = fakeSocket(status)
        socketPolicyAuthHold(f.socket)
        f.senden(REQ)
        assert.deepEqual(f.entfernt, [])
    })
}

test('Die AUTH-Antwort selbst wird NIE zurückgehalten', () => {
    // Der Fall, der die Policy zur Sackgasse machte: hielte sie das kind-22242 zurück,
    // käme die Runde nie auf `ok` — und nichts würde je gesendet.
    const f = fakeSocket('pending_signature')
    socketPolicyAuthHold(f.socket)
    f.senden(AUTH)
    assert.deepEqual(f.entfernt, [], 'AUTH muss durch')
})

test('Auch ein EVENT wird während der Runde zurückgehalten', () => {
    // Nicht nur REQs zählen gegen Buzz' Frame-Budget — EVENT und COUNT ebenso.
    const f = fakeSocket('requested')
    socketPolicyAuthHold(f.socket)
    f.senden(EVENT)
    assert.deepEqual(f.entfernt, [EVENT])
})

test('Der Status wird bei JEDER Nachricht neu gelesen, nicht beim Anhängen eingefroren', () => {
    // Die Policy hängt sich EINMAL an den Socket und lebt über die ganze AUTH-Runde.
    // Läse sie den Status beim Anhängen, hielte sie danach entweder immer oder nie zurück.
    const f = fakeSocket('none')
    socketPolicyAuthHold(f.socket)
    f.senden(REQ)
    assert.deepEqual(f.entfernt, [])
    f.setStatus('requested')
    f.senden(REQ)
    assert.deepEqual(f.entfernt, [REQ])
    f.setStatus('ok')
    f.senden(REQ)
    assert.deepEqual(f.entfernt, [REQ], 'nach `ok` kommt nichts mehr dazu')
})
