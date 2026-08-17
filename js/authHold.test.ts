/**
 * Die Zurückhalte-Policy für die AUTH-Runde.
 *
 * Der teure Fehler wäre hier nicht „hält zu wenig zurück" (dann geht die REQ wie vor der
 * Policy zweimal raus — der heutige Zustand), sondern „hält zu VIEL zurück": eine
 * AUTH-Antwort, die hängen bleibt, oder ein Zurückhalten vor dem Challenge würde den
 * Client auf einem Relay ohne AUTH dauerhaft stumm schalten. Genau diese beiden Fälle
 * stehen deshalb als eigene Gegenproben unten.
 *
 * ── Gemessen wird an der ECHTEN welshman-Socket, nicht an einer Attrappe ───────
 *
 * Hier stand eine handgeschriebene Attrappe, deren `on(...)` einen korrekten Abmelder
 * zurückgab. Das ist genau die Stelle, an der das Original ANDERS ist: `Socket extends
 * EventEmitter`, und `EventEmitter.prototype.on` liefert `this` zum Verketten. Die
 * Attrappe war damit gefälliger als die Wirklichkeit — sie hat den einzigen Fehler
 * zugedeckt, den dieses Modul je hatte (`Socket.cleanup()`/`Pool.remove()` warfen
 * `TypeError: f is not a function`, siehe Docblock in `authHold.ts`), und dabei wie
 * Abdeckung ausgesehen.
 *
 * Deshalb baut jeder Fall unten eine echte `new Socket(url, [socketPolicyAuthHold])`.
 * Das kostet nichts (der Konstruktor öffnet KEIN WebSocket, `open()` ist ein eigener
 * Aufruf) und misst dafür die ganze Kette, um die es geht: welshmans eigenes
 * `policies.map(p => p(this))` beim Anhängen, welshmans eigene `_sendQueue` beim
 * Zurückhalten, welshmans eigenes `unsubscribers.forEach(call)` beim Aufräumen.
 *
 * Beobachtet wird die REALE Wirkung — der Inhalt der Sende-Queue — statt eines
 * mitgeschriebenen `remove`-Aufrufs. Die Queue steht im Konstruktor auf `stop()`, ihre
 * `items` bleiben also synchron liegen und nichts geht je auf den Draht.
 *
 * Ausführen: node --test packages/einundzwanzig-group/js/authHold.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AuthStatus, Pool, Socket, SocketEvent } from '@welshman/net'
import { AUTH_HOLD_FRIST_MS, haeltZurueck, socketPolicyAuthHold } from './authHold.ts'

const URL = 'wss://relay.invalid/'

/** Frische Nachrichten je Fall — `TaskQueue.remove` filtert über Identität (`!==`). */
const req = () => ['REQ', 'REQ-1', { kinds: [1] }]
const auth = () => ['AUTH', { kind: 22242, tags: [], content: '', sig: '', id: '', pubkey: '', created_at: 0 }]
const event = () => ['EVENT', { kind: 9, tags: [], content: '', sig: '', id: '', pubkey: '', created_at: 0 }]

/**
 * Eine echte Socket mit NUR dieser Policy — kein `defaultSocketPolicies`, damit der
 * Fall misst, was er behauptet, und nicht welshmans Wiederhol-Puffer daneben.
 */
const echteSocket = (status: AuthStatus) => {
    const socket = new Socket(URL, [socketPolicyAuthHold])
    socket.auth.setStatus(status)

    return {
        socket,
        /** Sendet und meldet, ob die Nachricht aus der Sende-Queue genommen wurde. */
        senden: (message: unknown[]): boolean => {
            socket.send(message)
            return !socket._sendQueue.items.includes(message)
        },
        setStatus: (s: AuthStatus) => socket.auth.setStatus(s),
    }
}

// ── Der Vertrag der Policy: der Rückgabewert MUSS abmelden ────────────────────
// Diese vier Fälle sind die aktive Kalibrierung. Ohne den Fix in `authHold.ts`
// (`s.on(...)` statt welshmans `on()`-Helfer) fallen sie alle vier — und zwar nicht
// an einer Attrappe, sondern an welshmans eigenem Aufräumpfad.

test('Der Rückgabewert ist eine aufrufbare Funktion, nicht die Socket selbst', () => {
    // `EventEmitter.prototype.on` gibt `this` zurück. Wer das als Abmelder
    // weiterreicht, übergibt welshman ein Objekt, das es später aufrufen wird.
    const socket = new Socket(URL, [])
    const abmelder = socketPolicyAuthHold(socket)

    assert.equal(typeof abmelder, 'function', 'Policy muss einen Abmelder liefern')
    assert.notEqual(abmelder as unknown, socket, 'der Abmelder darf nicht die Socket selbst sein')
})

test('Der Abmelder hängt den Zuhörer wirklich ab — danach wird nichts mehr zurückgehalten', () => {
    // Aufrufbar allein genügt nicht: ein `() => {}` bestünde den Fall darüber.
    const socket = new Socket(URL, [])
    socket.auth.setStatus(AuthStatus.Requested)

    const abmelder = socketPolicyAuthHold(socket)
    assert.equal(socket.listenerCount(SocketEvent.Sending), 2, 'AuthState + Policy hören mit')

    const gehalten = req()
    socket.send(gehalten)
    assert.equal(socket._sendQueue.items.includes(gehalten), false, 'vor dem Abmelden wird zurückgehalten')

    abmelder()
    assert.equal(socket.listenerCount(SocketEvent.Sending), 1, 'nur noch AuthState hört mit')

    const durch = req()
    socket.send(durch)
    assert.equal(socket._sendQueue.items.includes(durch), true, 'nach dem Abmelden geht alles durch')
})

test('`Socket.cleanup()` wirft nicht — welshman ruft die Policy-Rückgaben als Funktionen', () => {
    // welshman sammelt die Rückgaben (`socket.js:58`) und ruft sie beim Aufräumen
    // mit `call = f => f()` (`socket.js:114`). Eine Socket ist nicht aufrufbar.
    const socket = new Socket(URL, [socketPolicyAuthHold])

    assert.equal(typeof socket.unsubscribers[0], 'function')
    assert.doesNotThrow(() => socket.cleanup())
})

test('`Pool.remove(url)` wirft nicht UND löscht die Socket aus der Registry', () => {
    // Der Wurf lag VOR `this._data.delete(url)` (`pool.js:44-50`): die tote Socket blieb
    // danach stehen, und der Reconnect in `verein.ts` brach ab, bevor er neu beobachtete.
    const pool = new Pool({ makeSocket: (url) => new Socket(url, [socketPolicyAuthHold]) })
    pool.get(URL)
    assert.equal(pool.has(URL), true)

    assert.doesNotThrow(() => pool.remove(URL))
    assert.equal(pool.has(URL), false, 'nach dem Abriss darf kein Socket zurückbleiben')
})

// ── Das Zurückhalte-Verhalten selbst — unverändert, jetzt am Original gemessen ──

for (const status of [AuthStatus.Requested, AuthStatus.PendingSignature, AuthStatus.PendingResponse]) {
    test(`Während der AUTH-Runde (${status}) wird die REQ aus der Sende-Queue genommen`, () => {
        const f = echteSocket(status)
        assert.equal(f.senden(req()), true)
    })
}

test('VOR dem Challenge (none) wird nichts zurückgehalten', () => {
    // Dort weiß niemand, ob der Relay überhaupt AUTH verlangt. Zurückhalten hieße, die
    // Nachricht auf einem Relay ohne AUTH für immer liegen zu lassen.
    const f = echteSocket(AuthStatus.None)
    assert.equal(f.senden(req()), false, 'keine Zurückhaltung ohne laufende AUTH-Runde')
})

for (const status of [AuthStatus.Ok, AuthStatus.DeniedSignature, AuthStatus.Forbidden]) {
    test(`Nach Abschluss der Runde (${status}) geht alles wieder direkt raus`, () => {
        const f = echteSocket(status)
        assert.equal(f.senden(req()), false)
    })
}

test('Die AUTH-Antwort selbst wird NIE zurückgehalten', () => {
    // Der Fall, der die Policy zur Sackgasse machte: hielte sie das kind-22242 zurück,
    // käme die Runde nie auf `ok` — und nichts würde je gesendet.
    const f = echteSocket(AuthStatus.PendingSignature)
    assert.equal(f.senden(auth()), false, 'AUTH muss durch')
})

test('Auch ein EVENT wird während der Runde zurückgehalten', () => {
    // Nicht nur REQs zählen gegen Buzz' Frame-Budget — EVENT und COUNT ebenso.
    const f = echteSocket(AuthStatus.Requested)
    assert.equal(f.senden(event()), true)
})

test('Der Status wird bei JEDER Nachricht neu gelesen, nicht beim Anhängen eingefroren', () => {
    // Die Policy hängt sich EINMAL an den Socket und lebt über die ganze AUTH-Runde.
    // Läse sie den Status beim Anhängen, hielte sie danach entweder immer oder nie zurück.
    const f = echteSocket(AuthStatus.None)
    assert.equal(f.senden(req()), false)

    f.setStatus(AuthStatus.Requested)
    assert.equal(f.senden(req()), true)

    f.setStatus(AuthStatus.Ok)
    assert.equal(f.senden(req()), false, 'nach `ok` kommt nichts mehr dazu')
})

// ── Die Frist: eine hängende AUTH-Runde darf den Socket nicht stumm schalten ───
//
// Der Anlass steht im Modul-Docblock und ist gemessen (N4, 2026-08-18): welshmans
// `doAuth` kennt zwei Wege, auf denen die Runde NIE endet. Ohne Frist hielte diese
// Policy danach für immer — und auf einem Relay mit optionalem AUTH kostete das
// Daten, die ohne die Policy angekommen wären.

test('die reine Entscheidung: laufende Runde hält, abgelaufene nicht', () => {
    const t = 1_000_000
    assert.equal(haeltZurueck(AuthStatus.Requested, t, t + 1), true, 'frische Runde hält')
    assert.equal(haeltZurueck(AuthStatus.Requested, t, t + AUTH_HOLD_FRIST_MS - 1), true)
    assert.equal(haeltZurueck(AuthStatus.Requested, t, t + AUTH_HOLD_FRIST_MS), false, 'auf die Millisekunde')
    assert.equal(haeltZurueck(AuthStatus.Ok, t, t + 1), false, 'kein Halten ohne laufende Runde')
    assert.equal(haeltZurueck(AuthStatus.None, null, t), false)
})

test('ohne beobachtete Flanke wird gehalten — die Vorsicht liegt beim Zurückhalten', () => {
    // `rundeSeit === null` heißt „die Runde begann, bevor jemand zuhörte". Dort das
    // Halten auszusetzen hieße, den Normalfall wegen eines Sonderfalls aufzugeben.
    assert.equal(haeltZurueck(AuthStatus.PendingSignature, null, 1_000_000), true)
})

/** Führt `fn` mit angehaltener Uhr aus — `Date.now()` liefert, was `zeit()` sagt. */
const mitUhr = (fn: (setze: (t: number) => void) => void): void => {
    const echt = Date.now
    let jetzt = 1_000_000
    Date.now = () => jetzt
    try {
        fn((t) => {
            jetzt = t
        })
    } finally {
        Date.now = echt
    }
}

test('am echten Socket: nach der Frist geht wieder alles durch', () => {
    mitUhr((setze) => {
        setze(1_000_000)
        const f = echteSocket(AuthStatus.PendingSignature)

        assert.equal(f.senden(req()), true, 'in der Runde: zurückgehalten')

        setze(1_000_000 + AUTH_HOLD_FRIST_MS)
        assert.equal(f.senden(req()), false, 'nach der Frist: durch, wie vor der Policy')
    })
})

test('am echten Socket: eine NEUE Runde startet die Frist neu', () => {
    // Sonst erbte eine späte, gesunde Runde die Uhr einer alten — und hielte nie.
    mitUhr((setze) => {
        setze(1_000_000)
        const f = echteSocket(AuthStatus.Requested)

        setze(1_000_500)
        f.setStatus(AuthStatus.Ok)
        assert.equal(f.senden(req()), false)

        // Reconnect: welshman setzt bei `closed`/`error` auf `none` zurück, dann
        // kommt ein neues Challenge — Stunden später.
        setze(9_000_000)
        f.setStatus(AuthStatus.None)
        f.setStatus(AuthStatus.Requested)
        assert.equal(f.senden(req()), true, 'die neue Runde hält wieder')

        setze(9_000_000 + AUTH_HOLD_FRIST_MS)
        assert.equal(f.senden(req()), false, 'und läuft ihrerseits ab')
    })
})
