/**
 * N5 — Vertragstest gegen die **installierte** welshman-Fassung, nicht gegen einen
 * Nachbau: verschweigt der Rückgabewert von `load()` Ereignisse, die der
 * Kaltstart-Cache (repository + tracker) beim Booten schon kennt?
 *
 * Ausführen:
 *   node --experimental-strip-types --test packages/einundzwanzig-group/js/welshmanLoad.test.ts
 *
 * **Warum diese Frage einen eigenen Test hat.** Drei Stellen in `groups.ts` lesen die
 * relay-signierte Mitgliederliste (kind 39002, NIP-29) aus dem RÜCKGABEWERT von
 * `load()` statt aus dem Repository — `loadSpaceRooms` (:702),
 * `reloadRoomMembership` (:770) und `revokeRoomMembership` (:875). 39002 steht in
 * `PERSIST_KINDS` (`storage.ts`), liegt nach dem ersten Besuch also im Cache. Wäre
 * der Rückgabewert um gecachte Ereignisse gekürzt, hinge daran mehr als eine Liste:
 * `roomMembersByUrl` trägt Composer-Sichtbarkeit, „Meine Räume", Palette,
 * Ungelesen-Abos und seit P9 die Nachführung nach einem Fremd-Rauswurf.
 *
 * **Gemessen (2026-08-18), und die Antwort ist Nein:** `makeLoader` legt seinen
 * Tracker **je Stapel neu** an (`@welshman/net/…/request.js:147`
 * `const tracker = new Tracker()`) und dedupliziert nur gegen diesen. Der App-weite
 * Tracker aus `@welshman/app` ist ein anderes Objekt; er wird von der Pool-Policy
 * gefüllt (`@welshman/app/…/index.js:49`) und beeinflusst `load()` nicht. Ein warmer
 * Cache kann den Rückgabewert also nicht leeren.
 *
 * Der zweite Fall unten ist die **Gegenprobe**: mit einem GETEILTEN Tracker — genau
 * der Konstruktion, die es hier nicht gibt — liefert derselbe Aufruf null Ereignisse.
 * Er belegt, dass der erste Fall nicht aus einem trivialen Grund grün ist, und er
 * fällt zusammen mit dem ersten um, sollte welshman jemals auf einen geteilten
 * Tracker umstellen. Dann sind die drei Stellen oben neu zu bewerten.
 */
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { repository, tracker } from './welshmanApp.ts'
import {
    load,
    netContext,
    requestOne,
    MockAdapter,
    type AbstractAdapter,
    type ClientMessage,
} from '@welshman/net'
import { normalizeRelayUrl, type Filter, type TrustedEvent } from '@welshman/util'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'

const URL_ = normalizeRelayUrl('wss://relay.test.invalid/')
const H = 'raum-h'

const relaySecret = generateSecretKey()
const memberPubkey = getPublicKey(generateSecretKey())

/**
 * Eine relay-signierte 39002 (ROOM_MEMBERS) — echte Signatur, weil welshmans
 * Vorgabe für `isEventValid` `verifyEvent` ist: ein gefälschtes Ereignis käme gar
 * nicht erst bis zur Dubletten-Frage.
 */
const membersEvent = finalizeEvent(
    {
        kind: 39002,
        created_at: 1_700_000_000,
        tags: [
            ['d', H],
            ['p', memberPubkey],
        ],
        content: '',
    },
    relaySecret,
) as unknown as TrustedEvent

const filters: Filter[] = [{ kinds: [39002], '#d': [H] }]

/** Ein Relay, das auf jedes REQ genau diese eine Liste liefert und dann EOSE sagt. */
const makeAdapter = (): MockAdapter => {
    const adapter: MockAdapter = new MockAdapter(URL_, (message: ClientMessage) => {
        if (message[0] !== 'REQ') {
            return
        }
        const subId = message[1] as string
        setTimeout(() => {
            adapter.receive(['EVENT', subId, membersEvent])
            adapter.receive(['EOSE', subId])
        }, 0)
    })

    return adapter
}

describe('welshman load(): der Rückgabewert verschweigt keinen Cache-Bestand', () => {
    const originalGetAdapter = netContext.getAdapter

    before(() => {
        netContext.getAdapter = (): AbstractAdapter => makeAdapter()
        // Exakt der Boot-Pfad aus `storage.ts`: Ereignisse in die repository,
        // Herkunft in den tracker. Danach ist der Cache warm.
        repository.load([membersEvent])
        tracker.load(new Map([[membersEvent.id, new Set([URL_])]]))
    })

    after(() => {
        netContext.getAdapter = originalGetAdapter
    })

    test('bei warmem Cache liefert load() die Liste trotzdem zurück', async () => {
        assert.ok(repository.getEvent(membersEvent.id), 'Vorbedingung: das Ereignis liegt im Cache')
        assert.equal(tracker.hasRelay(membersEvent.id, URL_), true, 'Vorbedingung: der tracker kennt die Herkunft')

        const events = await load({ relays: [URL_], filters })

        assert.deepEqual(
            events.map((event) => event.id),
            [membersEvent.id],
            'load() muss die gecachte 39002 liefern — sonst lesen loadUserGroupList/reconcileSpaceRooms in groups.ts ins Leere',
        )
        // Und die Fläche: sie liest ohnehin aus dem Repository, nicht aus dem Rückgabewert.
        assert.equal(repository.query(filters).length, 1)
    })

    test('GEGENPROBE: mit geteiltem Tracker käme nichts an', async () => {
        // Dieselbe Anfrage, aber gegen den App-weiten (warmen) Tracker dedupliziert —
        // die Konstruktion, die `makeLoader` NICHT verwendet. Fällt dieser Fall um,
        // ist die Zusage des ersten Falls wertlos geworden.
        // `signal` ist Pflicht, nicht Zierde: ohne ihn stellt `requestOne` einen
        // 30-Sekunden-Aufräumtimer (`request.js:93`), der den Testlauf so lange offen hält.
        const controller = new AbortController()
        const events = await requestOne({
            relay: URL_,
            filters,
            tracker,
            autoClose: true,
            signal: controller.signal,
            context: { getAdapter: (): AbstractAdapter => makeAdapter() },
        })

        assert.deepEqual(events, [], 'ein geteilter Tracker macht jedes gecachte Ereignis zur Dublette')
    })
})
