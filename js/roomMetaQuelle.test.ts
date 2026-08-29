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
import { Relays, Rooms } from '@welshman/app'
import { app } from './welshmanInstance.ts'
import { ROOM_META, ROOM_MEMBERS, ROOM_ADMINS, ROOM_DELETE } from './welshmanKinds.ts'

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

// ── The tombstone authority gate (security finding F1) ────────────────────────
//
// Upstream leaves 9008 ungated on purpose (`plugins/rooms.js:120-122`); we do not, and
// the gate is NOT inert although almost every state makes it look so. The plugin drops a
// room at `deletedAt >= max(39000, 39001, 39002)`, our rule at `deletedAt >= 39000`, so
// the two differ in exactly one window: the tombstone newer than the 39000 but OLDER than
// the newest room-state event. The first case below is that window — every other case in
// this file places the 9008 after all room state, where our rule is a no-op and any test
// would pass with or without the gate.
//
// Two of the cases assert against `app.use(Rooms).byUrl` directly rather than through
// `roomsByUrl`. That is deliberate: they document an UPSTREAM property, and asserted
// through our derivation our own rule dominates the outcome, so an upstream fix would
// land silently. Neither carries an instruction to delete itself when it turns red — a
// guard whose documented answer to red is "remove me" is fail-open.
//
// **The two window cases are coupled to upstream's healing behaviour, by construction.**
// The window only exists because the plugin compares the tombstone against
// `max(39000, 39001, 39002)`; narrow that comparison upstream and the window closes. Then
// these two and the `UPSTREAM:` healing case go red together — four assertions moving at
// once, with one cause that is not visible from any single failure. If that happens, do
// not repair them one by one: check first whether the plugin still heals, and if it does
// not, our rule has become redundant in that window and these cases document history
// rather than behaviour.

test('THE WINDOW: a forged 9008 older than the newest room state does not remove the room', async () => {
    const url = naechsteUrl()
    const t = T()
    const { buche, vomRelay } = stelle(url)

    buche(vomRelay(ROOM_META, [['d', 'a'], ['name', 'A']], t))
    buche(vonFremd(ROOM_DELETE, [['h', 'a']], t + 5))
    // The later member list keeps the plugin from dropping the room, so from here on our
    // rule is the only thing that could — and without the gate it would.
    buche(vomRelay(ROOM_MEMBERS, [['d', 'a'], ['p', 'b'.repeat(64)]], t + 10))

    assert.deepEqual((await raeume(url)).map((r) => r.h), ['a'])
})

test('THE WINDOW, control: a RELAY-SIGNED 9008 in the same position does remove it', async () => {
    const url = naechsteUrl()
    const t = T()
    const { buche, vomRelay } = stelle(url)

    buche(vomRelay(ROOM_META, [['d', 'a'], ['name', 'A']], t))
    buche(vomRelay(ROOM_DELETE, [['h', 'a']], t + 5))
    buche(vomRelay(ROOM_MEMBERS, [['d', 'a'], ['p', 'b'.repeat(64)]], t + 10))

    assert.deepEqual(
        (await raeume(url)).map((r) => r.h),
        [],
        'the wrapper must keep removing rooms the relay really deleted',
    )
})

test('a forged 9008 with several `h` tags removes none of the rooms', async () => {
    const url = naechsteUrl()
    const t = T()
    const { buche, vomRelay } = stelle(url)

    buche(vomRelay(ROOM_META, [['d', 'a'], ['name', 'A']], t))
    buche(vomRelay(ROOM_META, [['d', 'b'], ['name', 'B']], t))
    buche(vonFremd(ROOM_DELETE, [['h', 'a'], ['h', 'b']], t + 5))
    buche(vomRelay(ROOM_MEMBERS, [['d', 'a'], ['p', 'c'.repeat(64)]], t + 10))
    buche(vomRelay(ROOM_MEMBERS, [['d', 'b'], ['p', 'c'.repeat(64)]], t + 10))

    assert.deepEqual((await raeume(url)).map((r) => r.h).sort(), ['a', 'b'])
})

test('a 9008 from a room admin removes it — moderation keeps working', async () => {
    const url = naechsteUrl()
    const t = T()
    const adminSk = generateSecretKey()
    const { buche, vomRelay } = stelle(url)

    buche(vomRelay(ROOM_META, [['d', 'a'], ['name', 'A']], t))
    buche(vomRelay(ROOM_ADMINS, [['d', 'a'], ['p', getPublicKey(adminSk)]], t))
    buche(finalizeEvent({ kind: ROOM_DELETE, created_at: t + 5, tags: [['h', 'a']], content: '' }, adminSk))
    buche(vomRelay(ROOM_MEMBERS, [['d', 'a'], ['p', 'c'.repeat(64)]], t + 10))

    assert.deepEqual((await raeume(url)).map((r) => r.h), [])
})

// ── Upstream properties, asserted where they live ──────────────────────────────
//
// These two say what `@welshman/app` does, not what we do. If upstream starts gating
// 9008, they turn red and must be rewritten to the new behaviour — the finding is then
// resolved upstream and our gate becomes a second line rather than the only one.

test('UPSTREAM: the plugin accepts a forged 9008 (ungated by design)', async () => {
    const url = naechsteUrl()
    const t = T()
    const { buche, vomRelay } = stelle(url)

    buche(vomRelay(ROOM_META, [['d', 'a'], ['name', 'A']], t))
    buche(vonFremd(ROOM_DELETE, [['h', 'a']], t + 20))

    const imPlugin = (app.use(Rooms).byUrl.get().get(url) ?? []) as { h: string }[]
    assert.deepEqual(imPlugin.map((r) => r.h), [], 'plugins/rooms.js:120-122 — deletes are not self-checked')
})

test('UPSTREAM: the plugin heals a delete once newer room state arrives', async () => {
    const url = naechsteUrl()
    const t = T()
    const { buche, vomRelay } = stelle(url)

    buche(vomRelay(ROOM_META, [['d', 'a'], ['name', 'A']], t))
    buche(vomRelay(ROOM_DELETE, [['h', 'a']], t + 5))
    buche(vomRelay(ROOM_MEMBERS, [['d', 'a'], ['p', 'b'.repeat(64)]], t + 10))

    const imPlugin = (app.use(Rooms).byUrl.get().get(url) ?? []) as { h: string }[]
    assert.deepEqual(imPlugin.map((r) => r.h), ['a'], 'deletedAt is compared against max(39000, 39001, 39002)')
})
