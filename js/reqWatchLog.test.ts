/**
 * Die Buchführung über offene `REQ` — reine Logik, ohne Socket und ohne Uhr.
 *
 * **Der Fall, um den es geht** (N4): ein `load()` bleibt ohne jede Antwort. Am
 * 2026-08-18 an echten welshman-Sockets gemessen, dass der Relay dabei sehr wohl
 * antwortet — `socketPolicyAuthBuffer` entfernt das Signal nur, bevor es zugestellt
 * wird (`policy.js:62-75`). Die Erfassung muss deshalb genau diesen Unterschied führen:
 * **kam an** ist nicht **wurde zugestellt**.
 *
 * ── Gegenprobe (durchgeführt, nicht behauptet) ────────────────────────────────
 *
 * In `reqWatchLog.ts` in `bewerte()` die Zeile
 *
 * ```ts
 * if (r.drahtEose !== null || r.drahtClosed !== null) { return 'verschluckt' }
 * ```
 *
 * entfernen — also die Erfassung des verschluckten Abschlusses ausbauen. Dann fallen
 * `ein verschlucktes CLOSED …` und `ein verschlucktes EOSE …` mit
 * `'keine-antwort' !== 'verschluckt'`. Entfernt man stattdessen den ganzen
 * `close-gesendet`-Zweig, fallen zusätzlich alle Fälle, die `befunde()` nach dem
 * Client-CLOSE lesen — die Erfassung sieht dann gar nichts mehr.
 *
 * Ausführen: node --test --experimental-strip-types packages/einundzwanzig-group/js/reqWatchLog.test.ts
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
    anwenden,
    befunde,
    filterKurz,
    leererState,
    MAX_AUFFAELLIG,
    MAX_FRAMES,
    type ReqWatchState,
} from './reqWatchLog.ts'

const URL_ = 'wss://relay.test/'
const SUB = 'REQ-1234abcd'

/** Der übliche Vorlauf: die App will senden, es geht raus. */
const angefragt = (state: ReqWatchState, t = 1000, subId = SUB): void => {
    anwenden(state, { typ: 'req-gewuenscht', url: URL_, subId, filter: 'kinds=30617', t })
    anwenden(state, { typ: 'req-gesendet', url: URL_, subId, t: t + 1 })
}

describe('REQ-Erfassung: der Unterschied zwischen „kam an" und „wurde zugestellt"', () => {
    test('ein verschlucktes CLOSED hinterlässt einen Befund — mit dem Grund vom Draht', () => {
        // Der gemessene Normalfall auf einem auth_required-Relay: der Relay schickt
        // CLOSED, die Policy nimmt es aus `_recvQueue`, der Aufrufer sieht nichts und
        // sein load() läuft in die 3-s-Zeitgrenze, die dann CLOSE sendet.
        const state = leererState()
        angefragt(state)
        anwenden(state, {
            typ: 'draht',
            url: URL_,
            subId: SUB,
            art: 'CLOSED',
            grund: 'auth-required: we cannot serve requests to unauthenticated users',
            t: 1100,
        })
        // KEIN 'zugestellt' — genau das ist der Fall.
        anwenden(state, { typ: 'close-gesendet', url: URL_, subId: SUB, t: 4200 })

        const [b, ...rest] = befunde(state, 4300)
        assert.equal(rest.length, 0, 'genau ein Befund')
        assert.equal(b.art, 'verschluckt')
        assert.equal(b.gesendet, true)
        assert.match(b.draht, /^CLOSED «auth-required: /)
        assert.equal(b.alterMs, 3200, 'Alter zählt ab dem Sendewunsch, nicht ab dem CLOSE')
    })

    test('ein verschlucktes EOSE ebenso — auch wenn Events durchkamen', () => {
        // Der Fall „auth optional, Signer hängt": EVENT wird zugestellt, EOSE nicht.
        // Ohne diesen Zweig sähe die Erfassung eine erfolgreiche Anfrage.
        const state = leererState()
        angefragt(state)
        anwenden(state, { typ: 'draht', url: URL_, subId: SUB, art: 'EVENT', grund: '', t: 1050 })
        anwenden(state, { typ: 'zugestellt', url: URL_, subId: SUB, art: 'EVENT', t: 1060 })
        anwenden(state, { typ: 'draht', url: URL_, subId: SUB, art: 'EOSE', grund: '', t: 1070 })
        anwenden(state, { typ: 'close-gesendet', url: URL_, subId: SUB, t: 4200 })

        const [b] = befunde(state, 4300)
        assert.equal(b.art, 'verschluckt')
        assert.equal(b.events, 1)
        assert.equal(b.draht, 'EVENT×1 + EOSE')
    })

    test('ein zugestelltes CLOSED ist KEIN Befund', () => {
        // Die Kalibrierung nach unten: eine Erfassung, die alles meldet, meldet nichts.
        const state = leererState()
        angefragt(state)
        anwenden(state, { typ: 'draht', url: URL_, subId: SUB, art: 'CLOSED', grund: 'restricted: nope', t: 1100 })
        anwenden(state, { typ: 'zugestellt', url: URL_, subId: SUB, art: 'CLOSED', t: 1110 })
        anwenden(state, { typ: 'close-gesendet', url: URL_, subId: SUB, t: 1120 })

        assert.deepEqual(befunde(state, 9999), [])
    })

    test('ein zugestelltes EOSE ist KEIN Befund — auch nicht als überfälliges Live-Abo', () => {
        // Ein Live-`request()` ohne autoClose bleibt nach dem EOSE absichtlich offen.
        // Es darf die Erfassung nicht mit Dauer-Befunden fluten.
        const state = leererState()
        angefragt(state)
        anwenden(state, { typ: 'draht', url: URL_, subId: SUB, art: 'EOSE', grund: '', t: 1070 })
        anwenden(state, { typ: 'zugestellt', url: URL_, subId: SUB, art: 'EOSE', t: 1080 })

        assert.deepEqual(befunde(state, 60_000), [], 'nach 59 s offen, aber sauber quittiert')
    })
})

describe('REQ-Erfassung: die anderen beiden Ausgänge', () => {
    test('zurückgehalten — in `Sending` gesehen, nie in `Send`', () => {
        // Der Zustand, den eine hängende AUTH-Runde erzeugt: die Nachricht geht nie
        // auf den Draht. Ohne das Paar Sending/Send wäre er von „keine Antwort"
        // nicht zu unterscheiden — und die Suche liefe beim Relay statt beim Client.
        const state = leererState()
        anwenden(state, { typ: 'auth-status', url: URL_, status: 'pending_signature', t: 900 })
        anwenden(state, { typ: 'req-gewuenscht', url: URL_, subId: SUB, filter: 'kinds=30617', t: 1000 })
        anwenden(state, { typ: 'close-gesendet', url: URL_, subId: SUB, t: 4200 })

        const [b] = befunde(state, 4300)
        assert.equal(b.art, 'nie-gesendet')
        assert.equal(b.gesendet, false)
        assert.equal(b.draht, 'nichts')
        assert.equal(b.authStatus, 'pending_signature', 'der Kontext benennt den Verdächtigen')
    })

    test('keine Antwort — ging raus, der Relay sagte nichts', () => {
        const state = leererState()
        anwenden(state, { typ: 'socket-status', url: URL_, status: 'open', t: 900 })
        angefragt(state)
        anwenden(state, { typ: 'close-gesendet', url: URL_, subId: SUB, t: 4200 })

        const [b] = befunde(state, 4300)
        assert.equal(b.art, 'keine-antwort')
        assert.equal(b.socketStatus, 'open', 'kein Disconnect — der Socket stand')
    })

    test('noch offen und überfällig wird erst beim Abruf bewertet', () => {
        // Keine Timer: die Schwelle greift, wenn jemand nachsieht.
        const state = leererState()
        angefragt(state)

        assert.deepEqual(befunde(state, 5000, 10_000), [], 'unter der Schwelle: still')
        const [b] = befunde(state, 12_000, 10_000)
        assert.equal(b.art, 'offen')
        assert.equal(b.alterMs, 11_000)
    })
})

describe('REQ-Erfassung: Kontext und Grenzen', () => {
    test('die letzten Frames der Verbindung hängen am Befund', () => {
        const state = leererState()
        anwenden(state, { typ: 'socket-status', url: URL_, status: 'open', t: 900 })
        anwenden(state, { typ: 'draht', url: URL_, subId: null, art: 'AUTH', grund: 'challenge', t: 950 })
        anwenden(state, { typ: 'auth-status', url: URL_, status: 'requested', t: 951 })
        angefragt(state)
        anwenden(state, { typ: 'close-gesendet', url: URL_, subId: SUB, t: 4200 })

        const [b] = befunde(state, 4300)
        assert.deepEqual(
            b.letzteFrames.map((f) => f.art + ':' + f.detail),
            ['status:open', '←AUTH:challenge', 'auth:requested', '→REQ:' + SUB, '→CLOSE:' + SUB],
        )
    })

    test('der Frame-Ring ist gedeckelt — die Erfassung wird nie zur Speicherursache', () => {
        const state = leererState()
        for (let i = 0; i < MAX_FRAMES + 20; i++) {
            anwenden(state, { typ: 'socket-status', url: URL_, status: 's' + i, t: i })
        }
        angefragt(state, 5000)
        anwenden(state, { typ: 'close-gesendet', url: URL_, subId: SUB, t: 9000 })

        const [b] = befunde(state, 9100)
        assert.equal(b.letzteFrames.length, MAX_FRAMES)
        assert.equal(b.letzteFrames.at(-1)?.detail, SUB, 'das Jüngste überlebt, nicht das Älteste')
    })

    test('die Befundliste ist gedeckelt und behält die jüngsten', () => {
        const state = leererState()
        for (let i = 0; i < MAX_AUFFAELLIG + 5; i++) {
            const sub = 'REQ-' + i
            angefragt(state, 1000 + i, sub)
            anwenden(state, { typ: 'close-gesendet', url: URL_, subId: sub, t: 2000 + i })
        }
        const alle = befunde(state, 9999)
        assert.equal(alle.length, MAX_AUFFAELLIG)
        assert.equal(alle.at(-1)?.subId, 'REQ-' + String(MAX_AUFFAELLIG + 4))
    })

    test('ein Draht-Signal zu einer unbekannten Sub-Id wird nicht erfunden', () => {
        const state = leererState()
        anwenden(state, { typ: 'draht', url: URL_, subId: 'REQ-fremd', art: 'EOSE', grund: '', t: 1000 })
        assert.deepEqual(befunde(state, 99_999), [])
    })
})

describe('filterKurz: erkennbar, ohne Schlüsselmaterial mitzunehmen', () => {
    test('Autoren und Ids nur als Anzahl, Tag-Werte gekürzt', () => {
        // Ein Befund landet im Zweifel in einem Fehlerbericht. Ein vollständiger
        // Pubkey hat dort nichts verloren — die Anzahl reicht zum Wiedererkennen.
        const pk = 'a'.repeat(64)
        const kurz = filterKurz({ kinds: [30617, 30618], authors: [pk, pk], '#h': ['raum-abcdef123', 'x'], limit: 500 })

        assert.equal(kurz, 'kinds=30617,30618 authors×2 #h=raum-abc+1 limit=500')
        assert.equal(kurz.includes(pk), false, 'kein Pubkey im Klartext')
    })

    test('kein Filter, kaputter Filter, leerer Filter', () => {
        assert.equal(filterKurz(undefined), '?')
        assert.equal(filterKurz('REQ-1'), '?')
        assert.equal(filterKurz({}), '{}')
    })
})
