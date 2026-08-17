/**
 * **Die Buchführung über offene `REQ` — reine Logik, ohne Socket, ohne Uhr.**
 *
 * N4 fragt nach einem Fall, der zweimal auftrat und seit sieben Läufen nicht wieder:
 * ein `load()` bleibt **ohne jede Antwort** — kein EOSE, kein CLOSED, kein Disconnect.
 * Eine Fehlersuche ohne Repro kostet mehr, als sie findet; deshalb ist hier nicht die
 * Suche, sondern die **Erfassung** gebaut.
 *
 * ── Warum eine Erfassung überhaupt etwas sieht, was der Aufrufer nicht sieht ──────
 *
 * Am 2026-08-18 an echten welshman-Sockets gegen einen ws-Nachbau von Buzz gemessen
 * (Server-Frame-Log neben den `requestOne`-Rückrufen). Drei Stellen löschen ein
 * Abschluss-Signal, **bevor** es den Aufrufer erreicht — alle drei in welshmans
 * `socketPolicyAuthBuffer` (`@welshman/net/dist/net/src/policy.js:62-75`):
 *
 * 1. jedes `CLOSED` mit Präfix `auth-required:` (Zeile 62-67),
 * 2. jedes `EOSE`, solange `socket.auth.status ∉ {none, ok}` (Zeile 68-71),
 * 3. jedes `OK false` mit Präfix `auth-required:` (Zeile 72-75).
 *
 * Gemessen, Fall „auth optional, Signer lehnt ab": der Relay antwortete `EVENT` **und**
 * `EOSE`, der Aufrufer sah `NICHTS` und sein `load()` löste erst über die 3-s-Zeitgrenze
 * auf. Das ist Punkt 2 — und es ist **exakt** die Beobachtung aus P10.
 *
 * Der Ausweg ist deshalb nicht mehr Protokoll an derselben Stelle, sondern eine Stufe
 * tiefer: `SocketEvent.Receiving` wird synchron in `onmessage` gefeuert
 * (`socket.js:88-89`), **bevor** die Policy die Nachricht aus `_recvQueue` nimmt.
 * Wer dort mitschreibt, sieht den Draht; wer an `Receive` hängt, sieht die Auswahl.
 * Dieselbe Trennung gilt beim Senden: `Sending` heißt „die App wollte", `Send` heißt
 * „ging raus" (`socket.js:121-124` gegen `:41-44`). Eine `REQ`, die in `Sending`
 * auftaucht und nie in `Send`, wurde zurückgehalten — von unserer eigenen
 * {@link ../authHold} oder von welshmans Puffer.
 *
 * ── Was das Modul NICHT tut ────────────────────────────────────────────────────
 *
 * Keine Uhr, kein Timer, keine Konsole. `t` kommt bei jedem Ereignis von außen, die
 * Bewertung „überfällig" fällt erst beim Abruf ({@link befunde}). Im Normalbetrieb
 * kostet das einen Map-Eintrag je `REQ`, der beim Abschluss wieder verschwindet —
 * und nichts, was jemand lesen müsste. Erst wenn jemand `window.__reqWatch()` ruft,
 * entsteht Ausgabe.
 */

/** Obergrenzen — die Erfassung darf nie zur Speicherursache werden. */
export const MAX_OFFEN = 400
export const MAX_AUFFAELLIG = 60
export const MAX_FRAMES = 12
export const MAX_SOCKETS = 40

/** Ab wann eine noch offene Anfrage als überfällig gilt (Vorgabe für {@link befunde}). */
export const UEBERFAELLIG_MS = 10_000

export type Drahtart = 'EVENT' | 'EOSE' | 'CLOSED' | 'NOTICE' | 'OK' | 'AUTH' | 'ANDERE'

export type ReqWatchEreignis =
    | { typ: 'req-gewuenscht'; url: string; subId: string; filter: string; t: number }
    | { typ: 'req-gesendet'; url: string; subId: string; t: number }
    | { typ: 'close-gesendet'; url: string; subId: string; t: number }
    | { typ: 'draht'; url: string; subId: string | null; art: Drahtart; grund: string; t: number }
    | { typ: 'zugestellt'; url: string; subId: string | null; art: Drahtart; t: number }
    | { typ: 'socket-status'; url: string; status: string; t: number }
    | { typ: 'auth-status'; url: string; status: string; t: number }

type OffeneReq = {
    url: string
    subId: string
    filter: string
    gewuenschtAm: number
    gesendetAm: number | null
    events: number
    drahtEose: number | null
    drahtClosed: { grund: string; t: number } | null
    zugestellterAbschluss: { art: Drahtart; t: number } | null
    clientCloseAm: number | null
}

type SocketKontext = {
    url: string
    socketStatus: string
    authStatus: string
    letzteFrames: Array<{ art: string; t: number; detail: string }>
}

/**
 * Wie eine abgeschlossene Anfrage ausging. Nur die ersten drei sind ein Befund —
 * `zugestellt` wird gar nicht erst aufbewahrt.
 */
export type Befundart =
    /** In `Sending` gesehen, nie in `Send`: zurückgehalten, ging nie auf den Draht. */
    | 'nie-gesendet'
    /** Der Relay antwortete, das Signal wurde vor der Zustellung entfernt. */
    | 'verschluckt'
    /** Ging raus, der Relay sagte zu dieser Sub-Id nichts. */
    | 'keine-antwort'
    /** Läuft noch und ist über der Schwelle. */
    | 'offen'

export type Befund = {
    art: Befundart
    url: string
    subId: string
    filter: string
    /** Millisekunden zwischen „App wollte senden" und Abschluss bzw. Abruf. */
    alterMs: number
    gesendet: boolean
    events: number
    /** Was am Draht ankam — auch wenn es nie zugestellt wurde. */
    draht: string
    /** Zustand der Verbindung im Moment des Abrufs. */
    socketStatus: string
    authStatus: string
    /** Die letzten Frames dieser Verbindung, ältestes zuerst. */
    letzteFrames: Array<{ art: string; t: number; detail: string }>
}

export type ReqWatchState = {
    offen: Map<string, OffeneReq>
    auffaellig: Befund[]
    sockets: Map<string, SocketKontext>
}

export const leererState = (): ReqWatchState => ({
    offen: new Map(),
    auffaellig: [],
    sockets: new Map(),
})

const schluessel = (url: string, subId: string): string => url + '|' + subId

const kontext = (state: ReqWatchState, url: string): SocketKontext => {
    let k = state.sockets.get(url)
    if (!k) {
        k = { url, socketStatus: 'unbekannt', authStatus: 'unbekannt', letzteFrames: [] }
        if (state.sockets.size >= MAX_SOCKETS) {
            const aeltester = state.sockets.keys().next().value
            if (aeltester !== undefined) {
                state.sockets.delete(aeltester)
            }
        }
        state.sockets.set(url, k)
    }
    return k
}

const frame = (state: ReqWatchState, url: string, art: string, detail: string, t: number): void => {
    const k = kontext(state, url)
    k.letzteFrames.push({ art, t, detail })
    if (k.letzteFrames.length > MAX_FRAMES) {
        k.letzteFrames.splice(0, k.letzteFrames.length - MAX_FRAMES)
    }
}

/**
 * Fasst einen Filter so zusammen, dass er zum Wiedererkennen taugt, **ohne
 * Schlüsselmaterial mitzunehmen**: Kinds und Tag-Namen im Klartext, Autoren und Ids
 * nur als Anzahl, Tag-Werte auf acht Zeichen gekürzt. Ein Befund landet im Zweifel
 * in einem Fehlerbericht — dort hat ein vollständiger Pubkey nichts verloren.
 */
export const filterKurz = (filter: unknown): string => {
    if (!filter || typeof filter !== 'object') {
        return '?'
    }
    const f = filter as Record<string, unknown>
    const teile: string[] = []
    if (Array.isArray(f.kinds)) {
        teile.push('kinds=' + f.kinds.join(','))
    }
    if (Array.isArray(f.ids)) {
        teile.push('ids×' + f.ids.length)
    }
    if (Array.isArray(f.authors)) {
        teile.push('authors×' + f.authors.length)
    }
    for (const [k, v] of Object.entries(f)) {
        if (k.startsWith('#') && Array.isArray(v)) {
            const erster = v.length > 0 ? String(v[0]).slice(0, 8) : ''
            teile.push(k + '=' + erster + (v.length > 1 ? '+' + (v.length - 1) : ''))
        }
    }
    for (const k of ['limit', 'since', 'until'] as const) {
        if (typeof f[k] === 'number') {
            teile.push(k + '=' + String(f[k]))
        }
    }
    return teile.length > 0 ? teile.join(' ') : '{}'
}

/** Wie die Anfrage ausging — `null`, wenn sie sauber abgeschlossen wurde. */
const bewerte = (r: OffeneReq): Befundart | null => {
    if (r.zugestellterAbschluss) {
        return null
    }
    if (r.gesendetAm === null) {
        return 'nie-gesendet'
    }
    if (r.drahtEose !== null || r.drahtClosed !== null) {
        return 'verschluckt'
    }
    return 'keine-antwort'
}

const drahtText = (r: OffeneReq): string => {
    const teile: string[] = []
    if (r.events > 0) {
        teile.push('EVENT×' + r.events)
    }
    if (r.drahtEose !== null) {
        teile.push('EOSE')
    }
    if (r.drahtClosed) {
        teile.push('CLOSED «' + r.drahtClosed.grund + '»')
    }
    return teile.length > 0 ? teile.join(' + ') : 'nichts'
}

const zuBefund = (state: ReqWatchState, r: OffeneReq, art: Befundart, jetzt: number): Befund => {
    const k = kontext(state, r.url)
    return {
        art,
        url: r.url,
        subId: r.subId,
        filter: r.filter,
        alterMs: jetzt - r.gewuenschtAm,
        gesendet: r.gesendetAm !== null,
        events: r.events,
        draht: drahtText(r),
        socketStatus: k.socketStatus,
        authStatus: k.authStatus,
        letzteFrames: k.letzteFrames.slice(),
    }
}

const merke = (state: ReqWatchState, b: Befund): void => {
    state.auffaellig.push(b)
    if (state.auffaellig.length > MAX_AUFFAELLIG) {
        state.auffaellig.splice(0, state.auffaellig.length - MAX_AUFFAELLIG)
    }
}

/**
 * Ein Draht- oder Sendeereignis verbuchen. Rein: mutiert nur den übergebenen State,
 * ruft keine Uhr, schreibt nichts.
 */
export const anwenden = (state: ReqWatchState, e: ReqWatchEreignis): void => {
    if (e.typ === 'socket-status') {
        kontext(state, e.url).socketStatus = e.status
        frame(state, e.url, 'status', e.status, e.t)
        return
    }
    if (e.typ === 'auth-status') {
        kontext(state, e.url).authStatus = e.status
        frame(state, e.url, 'auth', e.status, e.t)
        return
    }
    if (e.typ === 'req-gewuenscht') {
        if (state.offen.size >= MAX_OFFEN) {
            const aeltester = state.offen.keys().next().value
            if (aeltester !== undefined) {
                state.offen.delete(aeltester)
            }
        }
        state.offen.set(schluessel(e.url, e.subId), {
            url: e.url,
            subId: e.subId,
            filter: e.filter,
            gewuenschtAm: e.t,
            gesendetAm: null,
            events: 0,
            drahtEose: null,
            drahtClosed: null,
            zugestellterAbschluss: null,
            clientCloseAm: null,
        })
        frame(state, e.url, '→REQ', e.subId, e.t)
        return
    }
    if (e.typ === 'req-gesendet') {
        const r = state.offen.get(schluessel(e.url, e.subId))
        if (r && r.gesendetAm === null) {
            r.gesendetAm = e.t
        }
        return
    }
    if (e.typ === 'close-gesendet') {
        frame(state, e.url, '→CLOSE', e.subId, e.t)
        const key = schluessel(e.url, e.subId)
        const r = state.offen.get(key)
        if (!r) {
            return
        }
        r.clientCloseAm = e.t
        state.offen.delete(key)
        const art = bewerte(r)
        if (art) {
            merke(state, zuBefund(state, r, art, e.t))
        }
        return
    }
    if (e.typ === 'draht') {
        frame(state, e.url, '←' + e.art, e.subId ?? e.grund.slice(0, 24), e.t)
        if (!e.subId) {
            return
        }
        const r = state.offen.get(schluessel(e.url, e.subId))
        if (!r) {
            return
        }
        if (e.art === 'EVENT') {
            r.events += 1
        }
        if (e.art === 'EOSE' && r.drahtEose === null) {
            r.drahtEose = e.t
        }
        if (e.art === 'CLOSED' && !r.drahtClosed) {
            r.drahtClosed = { grund: e.grund, t: e.t }
        }
        return
    }
    // 'zugestellt' — dieselbe Nachricht, aber sie hat die Policies überlebt.
    if (!e.subId || (e.art !== 'EOSE' && e.art !== 'CLOSED')) {
        return
    }
    const key = schluessel(e.url, e.subId)
    const r = state.offen.get(key)
    if (!r) {
        return
    }
    r.zugestellterAbschluss = { art: e.art, t: e.t }
    // Ein zugestelltes CLOSED beendet die Subscription; ein EOSE nicht (Live-Abos
    // laufen danach weiter). Nur das CLOSED wird deshalb hier ausgebucht — das EOSE
    // erst, wenn der Client seinerseits schließt.
    if (e.art === 'CLOSED') {
        state.offen.delete(key)
    }
}

/**
 * Der Abruf: alle festgehaltenen Befunde plus alles, was **jetzt** überfällig offen
 * steht. Jüngstes zuletzt. Reine Auswertung — ändert den State nicht.
 */
export const befunde = (state: ReqWatchState, jetzt: number, schwelleMs = UEBERFAELLIG_MS): Befund[] => {
    const offen: Befund[] = []
    for (const r of state.offen.values()) {
        if (jetzt - r.gewuenschtAm >= schwelleMs && !r.zugestellterAbschluss) {
            offen.push(zuBefund(state, r, 'offen', jetzt))
        }
    }
    return state.auffaellig.concat(offen)
}
