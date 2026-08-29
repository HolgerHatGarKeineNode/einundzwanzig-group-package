/**
 * Regressionsträger für die Mitglieder-Quelle eines NIP-29-Raums
 * (`roomMembersByUrl` in `js/groups.ts`).
 *   node --test packages/einundzwanzig-group/js/roomMembersQuelle.test.ts
 *
 * ── Warum es diese Datei gibt ───────────────────────────────────────────────────
 *
 * `roomMembersByUrl` trägt Composer-Sichtbarkeit, „Meine Räume", Pin-Recht und die
 * Mitgliederliste. In P5 des 0.9.5-Sprungs wird ihre Quelle vom eigenen 39002-Lesen auf
 * `app.use(Rooms).membership` umgestellt. Die drei Lagen hier sind vor dem Umbau gemessen
 * und beschreiben, was sich dabei ändern DARF und was nicht:
 *
 *   1. Eine 39002, die NICHT vom Relay selbst signiert ist, darf keine Mitgliedschaft
 *      begründen. **Das war vor dem Umbau kaputt** — der Eigenbau las 39002 ohne
 *      `self`-Prüfung, ein fremder Signierer konnte sich in jeden Raum schreiben.
 *      `js/members.ts` fängt das an genau einer Fläche defensiv ab („nicht self-gefiltert").
 *   2. Ein 9000 (Admin fügt hinzu), das NEUER ist als der 39002-Schnappschuss, muss
 *      sichtbar sein, bevor der Relay den Schnappschuss neu erzeugt hat. Der Eigenbau
 *      konnte das nicht.
 *   3. Die Entzugs-Marke aus `js/roomMembership.ts` (P9) muss weiter greifen: nach einem
 *      Fremd-Rauswurf aus einem PRIVATEN Raum liefert der Relay keine neue 39002 mehr,
 *      und die alte — auch aus der IndexedDB — behauptet die Mitgliedschaft sonst ewig
 *      weiter. `app.use(Rooms)` kennt diese Marke nicht; sie ist der Grund, warum der
 *      Umbau eine Hülle ist und kein Ersatz.
 *
 * Fall 3 ist die Kalibrierung: fiele die Hülle weg, wäre er rot, während 1 und 2 grün
 * blieben.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { get } from 'svelte/store'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { Relays } from '@welshman/app'
import { app } from './welshmanInstance.ts'
import { ROOM_META, ROOM_ADMINS, ROOM_MEMBERS, ROOM_ADD_MEMBER } from './welshmanKinds.ts'

/** Jeder Fall bekommt eine eigene Space-URL — das Repository ist prozessweit geteilt. */
let laufNr = 0
const naechsteUrl = (): string => `wss://p5-probe-${++laufNr}.example/`

type Sk = Uint8Array

const mach = (sk: Sk, kind: number, tags: string[][], created_at: number) =>
    finalizeEvent({ kind, created_at, tags, content: '' }, sk)

/** Legt ein Relay mit `self` an und liefert Werkzeug, um Events darauf zu buchen. */
const raumStellen = (url: string, relayPk: string) => {
    app.use(Relays).set(url, { url, self: relayPk } as never)

    return (event: { id: string }): void => {
        app.repository.publish(event as never)
        app.tracker.track(event.id, url)
    }
}

const mitglieder = async (url: string, h: string): Promise<Set<string>> => {
    const { roomMembersByUrl } = await import('./groups.ts')
    return get(roomMembersByUrl).get(url)?.get(h) ?? new Set<string>()
}

test('eine 39002 von einem FREMDEN Signierer begründet keine Mitgliedschaft', async () => {
    const url = naechsteUrl()
    const h = 'raum'
    const t = Math.floor(Date.now() / 1000)
    const relaySk = generateSecretKey()
    const fremdSk = generateSecretKey()
    const opferPk = getPublicKey(generateSecretKey())
    const buche = raumStellen(url, getPublicKey(relaySk))

    buche(mach(relaySk, ROOM_META, [['d', h], ['name', 'Raum']], t))
    // Der Relay listet niemanden; ein Fremder behauptet eine Mitgliedschaft.
    buche(mach(relaySk, ROOM_MEMBERS, [['d', h]], t))
    buche(mach(fremdSk, ROOM_MEMBERS, [['d', h], ['p', opferPk]], t + 5))

    assert.deepEqual([...(await mitglieder(url, h))], [], 'die gefälschte Liste darf nicht zählen')
})

test('ein 9000 nach dem Schnappschuss ist sofort sichtbar', async () => {
    const url = naechsteUrl()
    const h = 'raum'
    const t = Math.floor(Date.now() / 1000)
    const relaySk = generateSecretKey()
    const adminSk = generateSecretKey()
    const adminPk = getPublicKey(adminSk)
    const neuPk = getPublicKey(generateSecretKey())
    const buche = raumStellen(url, getPublicKey(relaySk))

    buche(mach(relaySk, ROOM_META, [['d', h], ['name', 'Raum']], t))
    buche(mach(relaySk, ROOM_ADMINS, [['d', h], ['p', adminPk]], t))
    buche(mach(relaySk, ROOM_MEMBERS, [['d', h], ['p', adminPk]], t))
    // Der Admin nimmt jemanden auf; der Relay hat den Schnappschuss noch nicht erneuert.
    buche(mach(adminSk, ROOM_ADD_MEMBER, [['h', h], ['p', neuPk]], t + 10))

    const set = await mitglieder(url, h)
    assert.equal(set.has(adminPk), true, 'der Admin bleibt Mitglied')
    assert.equal(set.has(neuPk), true, 'die Aufnahme wirkt vor dem neuen Schnappschuss')
})

test('ein 9000 von einem NICHT-Admin wirkt nicht', async () => {
    const url = naechsteUrl()
    const h = 'raum'
    const t = Math.floor(Date.now() / 1000)
    const relaySk = generateSecretKey()
    const fremdSk = generateSecretKey()
    const zielPk = getPublicKey(generateSecretKey())
    const buche = raumStellen(url, getPublicKey(relaySk))

    buche(mach(relaySk, ROOM_META, [['d', h], ['name', 'Raum']], t))
    buche(mach(relaySk, ROOM_MEMBERS, [['d', h]], t))
    buche(mach(fremdSk, ROOM_ADD_MEMBER, [['h', h], ['p', zielPk]], t + 10))

    assert.deepEqual([...(await mitglieder(url, h))], [], 'nur Admins und der Relay dürfen aufnehmen')
})

test('die Entzugs-Marke nimmt den EIGENEN Pubkey aus der Menge — fremde bleiben', async () => {
    const url = naechsteUrl()
    const h = 'privat'
    const t = Math.floor(Date.now() / 1000)
    const relaySk = generateSecretKey()
    const meinSk = generateSecretKey()
    const meinPk = getPublicKey(meinSk)
    const andererPk = getPublicKey(generateSecretKey())
    const buche = raumStellen(url, getPublicKey(relaySk))

    buche(mach(relaySk, ROOM_META, [['d', h], ['name', 'Privat']], t))
    buche(mach(relaySk, ROOM_MEMBERS, [['d', h], ['p', meinPk], ['p', andererPk]], t))

    const { pubkey } = await import('./welshmanSession.ts')
    const { revokeRoomMembership } = await import('./groups.ts')
    const vorher = pubkey.get()

    try {
        pubkey.set(meinPk)
        assert.equal((await mitglieder(url, h)).has(meinPk), true, 'ohne Marke bin ich Mitglied')

        // **Ohne angemeldeten Pubkey aufrufen, und das ist kein Umweg, sondern nötig:**
        // `revokeRoomMembership` setzt die Marke synchron und liest danach die 39002
        // NACH — der Nachlesen-Teil läuft nur `if (pk)`. Gegen die Attrappen-URL dieses
        // Tests würde er eine Verbindung aufmachen, die nie zustande kommt, und der
        // Testprozess beendete sich nicht mehr (dieselbe Falle wie beim 0.9.5-Sprung,
        // als die Unit-Tests ins Internet telefonierten). Die Marke gilt pro Raum, nicht
        // pro Identität, also ist die Reihenfolge folgenlos für das, was geprüft wird.
        pubkey.set(undefined)
        await revokeRoomMembership(url, h)
        pubkey.set(meinPk)

        const set = await mitglieder(url, h)
        assert.equal(set.has(meinPk), false, 'nach dem Entzug bin ich draussen')
        assert.equal(set.has(andererPk), true, 'der Entzug ist eine Aussage über MICH, nicht über andere')
    } finally {
        pubkey.set(vorher)
    }
})
