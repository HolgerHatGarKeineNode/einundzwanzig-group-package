/**
 * Regressionsträger für die Raum-Metadaten-Quelle (`roomsByUrl` in `js/groups.ts`).
 *   node --test packages/einundzwanzig-group/js/roomMetaQuelle.test.ts
 *
 * ── Warum es diese Datei gibt ───────────────────────────────────────────────────
 *
 * Schwesterdatei zu `roomMembersQuelle.test.ts`. Nachdem dort gemessen war, dass die
 * Mitglieder-Quelle die Relay-Selbstsignatur nicht prüfte, wurde dieselbe Sonde auf die
 * Metadaten angesetzt — und die Lücke war dort **grösser**: ein fremder Signierer konnte
 * nicht nur einen Raum erfinden, sondern einen bestehenden ENTFÜHREN (derselbe `d`-Wert,
 * neuerer Zeitstempel, eigener Name und `private`-Flag). Gemessen erschien der Raum „echt"
 * doppelt, einmal mit dem untergeschobenen Namen.
 *
 * Das ist keine Kosmetik: `isClosed` steuert, ob Beitrittsanfragen als offen gelten
 * (`actionItems.ts`), `isPrivate` und `isHidden` steuern Sichtbarkeit, und `roomsById`
 * trägt die Existenzprüfung beim Anlegen (`groups.ts createRoom`).
 *
 * ── Die Hülle, und warum sie nötig ist ─────────────────────────────────────────
 *
 * `app.use(Rooms)` blendet gelöschte Räume selbst aus — aber nach einer anderen Regel:
 * es vergleicht den 9008 gegen das **Maximum** aus 39000/39001/39002. Kommt nach der
 * Löschung eine neue Mitgliederliste, wird der Raum dort wieder sichtbar. Gemessen:
 *
 *   39000 → 9008 → neue 39002   ·   unser Weg: ausgeblendet   ·   Rooms: SICHTBAR
 *
 * Unsere Regel vergleicht gegen die 39000 und bleibt deshalb bestehen. Fall 4 ist die
 * Kalibrierung dieser Hülle.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { get } from 'svelte/store'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { Relays } from '@welshman/app'
import { app } from './welshmanInstance.ts'
import { ROOM_META, ROOM_MEMBERS, ROOM_DELETE } from './welshmanKinds.ts'

let laufNr = 0
const naechsteUrl = (): string => `wss://p5meta-${++laufNr}.example/`

const stelle = (url: string) => {
    const relaySk = generateSecretKey()
    app.use(Relays).set(url, { url, self: getPublicKey(relaySk) } as never)
    const buche = (event: { id: string }): void => {
        app.repository.publish(event as never)
        app.tracker.track(event.id, url)
    }
    const vomRelay = (kind: number, tags: string[][], created_at: number) =>
        finalizeEvent({ kind, created_at, tags, content: '' }, relaySk)

    return { buche, vomRelay }
}

const vonFremd = (kind: number, tags: string[][], created_at: number) =>
    finalizeEvent({ kind, created_at, tags, content: '' }, generateSecretKey())

type Raum = { h: string; name?: string; isPrivate?: boolean; isClosed?: boolean; event?: { tags: string[][] } }

const raeume = async (url: string): Promise<Raum[]> => {
    const { roomsByUrl } = await import('./groups.ts')
    return (get(roomsByUrl).get(url) ?? []) as Raum[]
}

const T = () => Math.floor(Date.now() / 1000)

test('eine 39000 von einem FREMDEN Signierer erzeugt keinen Raum', async () => {
    const url = naechsteUrl()
    const t = T()
    const { buche, vomRelay } = stelle(url)

    buche(vomRelay(ROOM_META, [['d', 'echt'], ['name', 'Echter Raum']], t))
    buche(vonFremd(ROOM_META, [['d', 'fake'], ['name', 'Untergeschoben'], ['closed', '']], t))

    const liste = await raeume(url)
    assert.deepEqual(liste.map((r) => r.h), ['echt'], 'nur der relay-signierte Raum zählt')
})

test('eine fremde 39000 kann einen bestehenden Raum nicht ENTFÜHREN', async () => {
    const url = naechsteUrl()
    const t = T()
    const { buche, vomRelay } = stelle(url)

    buche(vomRelay(ROOM_META, [['d', 'echt'], ['name', 'Echter Raum']], t))
    // Gleicher d-Wert, neuer, mit eigenem Namen und private-Flag.
    buche(vonFremd(ROOM_META, [['d', 'echt'], ['name', 'ENTFÜHRT'], ['private', '']], t + 50))

    const liste = await raeume(url)
    assert.equal(liste.length, 1, 'der Raum darf nicht doppelt erscheinen')
    assert.equal(liste[0].name, 'Echter Raum')
    assert.notEqual(liste[0].isPrivate, true, 'ein fremdes private-Flag darf nicht greifen')
})

test('ein 9008 blendet den Raum aus', async () => {
    const url = naechsteUrl()
    const t = T()
    const { buche, vomRelay } = stelle(url)

    buche(vomRelay(ROOM_META, [['d', 'a'], ['name', 'A']], t))
    buche(vomRelay(ROOM_DELETE, [['h', 'a']], t + 10))

    assert.deepEqual((await raeume(url)).map((r) => r.h), [])
})

test('eine neue 39002 lässt einen gelöschten Raum NICHT wiederauferstehen', async () => {
    const url = naechsteUrl()
    const t = T()
    const { buche, vomRelay } = stelle(url)

    buche(vomRelay(ROOM_META, [['d', 'a'], ['name', 'A']], t))
    buche(vomRelay(ROOM_DELETE, [['h', 'a']], t + 10))
    // Der Relay schickt danach noch eine Mitgliederliste — bei `Rooms` allein reicht das,
    // damit der Raum wieder im Index steht (gemessen). Unsere Regel vergleicht gegen die
    // 39000 und hält ihn draussen.
    buche(vomRelay(ROOM_MEMBERS, [['d', 'a'], ['p', 'b'.repeat(64)]], t + 20))

    assert.deepEqual((await raeume(url)).map((r) => r.h), [], 'gelöscht bleibt gelöscht')
})

test('eine neue 39000 nach der Löschung legt den Raum wieder an', async () => {
    const url = naechsteUrl()
    const t = T()
    const { buche, vomRelay } = stelle(url)

    buche(vomRelay(ROOM_META, [['d', 'a'], ['name', 'A']], t))
    buche(vomRelay(ROOM_DELETE, [['h', 'a']], t + 10))
    buche(vomRelay(ROOM_META, [['d', 'a'], ['name', 'A neu']], t + 20))

    const liste = await raeume(url)
    assert.deepEqual(liste.map((r) => r.h), ['a'])
    assert.equal(liste[0].name, 'A neu')
})

test('die ROH-Tags des 39000 bleiben erreichbar (Meetup/Forum/Projekt hängen daran)', async () => {
    const url = naechsteUrl()
    const t = T()
    const { buche, vomRelay } = stelle(url)

    buche(vomRelay(ROOM_META, [['d', 'm'], ['name', 'Meetup'], ['einundzwanzig_meetup', 'berlin']], t))

    const raum = (await raeume(url))[0]
    assert.ok(raum.event, 'das Quell-Event muss mitkommen')
    assert.ok(
        raum.event.tags.some((tag) => tag[0] === 'einundzwanzig_meetup'),
        'haus-eigene Tags kennt kein welshman-Reader — sie kommen nur über das Event',
    )
})
