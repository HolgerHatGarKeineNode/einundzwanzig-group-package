/**
 * Pure-Tests der Mitgliedschafts-Nachführung (welshman-frei).
 *   node --test packages/einundzwanzig-group/js/roomMembership.test.ts
 *
 * Jeder Fall hier ist eine am Buzz-Teststack gemessene Lage (2026-08-17,
 * `buzz-test:3001`, wiederverwendeter Stack) — allen voran der teure: nach einem
 * Fremd-Rauswurf aus einem PRIVATEN Raum liefert der Relay auf das REQ
 * `{kinds:[39002],"#d":[h]}` gar nichts mehr (EOSE, 0 Events, sechs Versuche über
 * 13,7 s). Es gibt dort keine „neue Liste ohne mich", an der sich `joined`
 * korrigieren könnte — nur Schweigen. Deshalb entscheidet die Marke, nicht die
 * Nachlese.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
    confirmsMembership,
    createRoomMembershipRevocations,
    roomMembershipKey,
    type RoomMembershipRead,
} from './roomMembership.ts'

const ALT = 'aaaa1111'
const NEU = 'bbbb2222'
const RAUM = roomMembershipKey('wss://buzz.example/', '0535ecb1-e5d7-47a7-af07-6eb8f1337a5f')

/** Die Sekunde des Entzugs. Alles Weitere wird relativ dazu ausgedrückt. */
const T = 1_755_600_000

const liste = (id: string, listsMe: boolean, createdAt = T): RoomMembershipRead =>
    ({ listEventId: id, listsMe, createdAt })
/** Der Stand beim Entzug — Id plus die Sekunde, ab der eine Liste zählt. */
const entzug = (id: string, createdAt = T) => ({ staleListEventId: id, staleCreatedAt: id === '' ? 0 : createdAt })

test('ohne Entzug gibt es nichts aufzuheben', () => {
    assert.equal(confirmsMembership(liste(NEU, true), undefined), false)
})

test('privater Raum nach dem Rauswurf: der Relay schweigt — die Marke bleibt', () => {
    // Gemessen: EOSE, 0 Events. `null` ist genau dieser Fall, und er ist KEIN
    // Mitgliedschaftsbeweis. Ohne diese Zeile stünde der Composer wieder da.
    assert.equal(confirmsMembership(null, entzug(ALT)), false)
    assert.equal(confirmsMembership(undefined, entzug(ALT)), false)
})

test('offener Raum nach dem Rauswurf: neue Liste ohne mich hebt nichts auf', () => {
    // Gemessen: +202 ms nach dem 9001 liefert das REQ eine Liste mit neuer
    // Event-id, in der der eigene Pubkey fehlt.
    assert.equal(confirmsMembership(liste(NEU, false), entzug(ALT)), false)
})

test('der Rennfall: dieselbe Liste wie beim Entzug beweist nichts', () => {
    // Der Relay liefert unmittelbar nach einem Austritt für einige hundert
    // Millisekunden noch die ALTE Liste (gemessen am Join-Pfad, groups.ts).
    // Würde sie die Marke aufheben, käme der Composer für einen Nutzer zurück,
    // der längst draußen ist.
    assert.equal(confirmsMembership(liste(ALT, true), entzug(ALT)), false)
})

test('eine ANDERE, NEUERE Liste, die mich führt, rehabilitiert', () => {
    assert.equal(confirmsMembership(liste(NEU, true, T + 1), entzug(ALT)), true)
})

test('N3: eine ÄLTERE Liste rehabilitiert NICHT — auch mit anderer Id', () => {
    // Das ist der Riss, den die Id-Regel allein offen ließ: ein Lesereplikat, das
    // hinterherhinkt, liefert eine ANDERE Id mit KLEINEREM `created_at`. Sie führt
    // uns noch (der Rauswurf steht dort noch nicht drin) — ohne den
    // Ordnungs-Riegel fiele die Marke und die Fläche zeigte einen Composer für
    // jemanden, der nicht mehr schreiben darf.
    assert.equal(confirmsMembership(liste(NEU, true, T - 1), entzug(ALT)), false)
    // Auch eine deutlich ältere Fassung ändert daran nichts.
    assert.equal(confirmsMembership(liste(NEU, true, T - 3_600), entzug(ALT)), false)
})

test('N3: GLEICHE Sekunde, andere Id — die Id-Regel entscheidet, nicht die Ordnung', () => {
    // `created_at` ist sekundengranular (NIP-01), und dieser Pfad spielt sich
    // darunter ab (CLOSED nach 11–61 ms, neue Liste +202 ms). Ein `>` sperrte die
    // Wiederaufnahme in derselben Sekunde DAUERHAFT aus — die Marke fällt nur
    // durch ein `confirm`, und jedes spätere Lesen liefert dieselbe Sekunde
    // erneut. Deshalb `>=`.
    assert.equal(confirmsMembership(liste(NEU, true, T), entzug(ALT, T)), true)
    // Die Id-Regel bleibt darunter unverändert scharf.
    assert.equal(confirmsMembership(liste(ALT, true, T), entzug(ALT, T)), false)
})

test('war beim Entzug keine Liste bekannt, genügt die erste, die mich führt', () => {
    // `joined` war ohne Liste ohnehin false — eine Liste, die überhaupt erst jetzt
    // eintrifft, ist die frischere Aussage. `staleCreatedAt` ist dann 0, der
    // Ordnungs-Riegel also für jede echte Liste erfüllt.
    assert.equal(confirmsMembership(liste(NEU, true, T - 10_000), entzug('')), true)
})

test('Schlüssel trennen Raum und Space', () => {
    assert.notEqual(roomMembershipKey('wss://a/', 'h1'), roomMembershipKey('wss://a/', 'h2'))
    assert.notEqual(roomMembershipKey('wss://a/', 'h1'), roomMembershipKey('wss://b/', 'h1'))
    // Kein Zusammenfallen zweier Paare über die Trennstelle hinweg.
    assert.notEqual(roomMembershipKey('wss://a/x', 'y'), roomMembershipKey('wss://a/', 'xy'))
})

test('der volle Ablauf eines Fremd-Rauswurfs aus einem privaten Raum', () => {
    const revocations = createRoomMembershipRevocations()
    assert.equal(revocations.has(RAUM), false)

    // `CLOSED restricted: channel access revoked` — die einzige Zeile, die der
    // Relay von sich aus schickt (gemessen: 61 ms nach dem 9001).
    revocations.revoke(RAUM, ALT, T)
    assert.equal(revocations.has(RAUM), true)

    // Das Nachladen liefert im privaten Raum nichts → die Marke muss stehen bleiben.
    assert.equal(revocations.confirm(RAUM, null), false)
    assert.equal(revocations.has(RAUM), true)

    // Auch ein später eintreffender Cache-Stand derselben alten Liste ändert nichts.
    assert.equal(revocations.confirm(RAUM, liste(ALT, true)), false)
    assert.equal(revocations.has(RAUM), true)

    // N3: eine andere, aber ÄLTERE Liste (hinkendes Lesereplikat) ebenso wenig.
    assert.equal(revocations.confirm(RAUM, liste(NEU, true, T - 1)), false)
    assert.equal(revocations.has(RAUM), true)

    // Erst eine frisch gelesene, ANDERE Liste, die uns führt (Wiederaufnahme durch
    // den Admin oder eigener Wiederbeitritt), gibt den Raum frei.
    assert.equal(revocations.confirm(RAUM, liste(NEU, true, T + 1)), true)
    assert.equal(revocations.has(RAUM), false)
})

test('Store: jeder Abonnent bekommt sofort den Stand und danach jede Änderung', () => {
    const revocations = createRoomMembershipRevocations()
    const stände: number[] = []
    const unsubscribe = revocations.subscribe((value) => stände.push(value.size))

    assert.deepEqual(stände, [0], 'subscribe muss synchron den aktuellen Wert liefern')

    revocations.revoke(RAUM, ALT, T)
    assert.deepEqual(stände, [0, 1])

    // Wiederholte CLOSED-Zeilen desselben Entzugs: kein neuer Stand, sonst rechnet
    // die ganze Mitgliedersicht bei jedem Wiederaufsetzen der Sub neu.
    revocations.revoke(RAUM, ALT, T)
    assert.deepEqual(stände, [0, 1])

    // Ein Entzug, der sich auf eine NEUERE Liste bezieht, ist dagegen eine Änderung.
    revocations.revoke(RAUM, NEU, T + 1)
    assert.deepEqual(stände, [0, 1, 1])

    revocations.confirm(RAUM, liste('cccc3333', true, T + 2))
    assert.deepEqual(stände, [0, 1, 1, 0])

    unsubscribe()
    revocations.revoke(RAUM, ALT, T)
    assert.deepEqual(stände, [0, 1, 1, 0], 'nach dem Abmelden darf nichts mehr ankommen')
})

test('Store: jeder Stand ist eine eigene Map — festgehaltene Werte mutieren nicht', () => {
    const revocations = createRoomMembershipRevocations()
    const stände: ReadonlyMap<string, unknown>[] = []
    revocations.subscribe((value) => stände.push(value))

    revocations.revoke(RAUM, ALT, T)
    assert.equal(stände[0].size, 0, 'der erste Stand darf nachträglich nicht wachsen')
    assert.equal(stände[1].size, 1)
    assert.notEqual(stände[0], stände[1])
})

test('Store: ein Raum ohne Marke bleibt von confirm unberührt', () => {
    const revocations = createRoomMembershipRevocations()
    let emits = 0
    revocations.subscribe(() => {
        emits += 1
    })

    assert.equal(revocations.confirm(RAUM, liste(NEU, true)), false)
    assert.equal(emits, 1, 'nur der initiale Emit — confirm ohne Marke darf nichts auslösen')
})

test('Marken sind je Raum getrennt', () => {
    const revocations = createRoomMembershipRevocations()
    const a = roomMembershipKey('wss://buzz.example/', 'raum-a')
    const b = roomMembershipKey('wss://buzz.example/', 'raum-b')

    revocations.revoke(a, ALT, T)
    assert.equal(revocations.has(a), true)
    assert.equal(revocations.has(b), false)

    revocations.confirm(a, liste(NEU, true, T + 1))
    assert.equal(revocations.has(a), false)
})
