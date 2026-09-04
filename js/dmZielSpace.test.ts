/**
 * **Which relay a new conversation is opened on — measured against the real store.**
 *
 * Run: node --test --experimental-strip-types packages/einundzwanzig-group/js/dmZielSpace.test.ts
 *
 * ── The defect this file pins down ───────────────────────────────────────────────
 *
 * `canDm` was `mayWriteKind(DM_OPEN, kindOf(activeUrl))` — the space in VIEW. On
 * `/spaces` that space is pinned: the island's `init()` calls `clearEphemeralSpace()`
 * unconditionally (`bridge.ts:3515`), so it is always the persisted HOME relay. On a
 * deployment with a zooid home and a Buzz workspace the answer was therefore `false` on
 * every surface and at every viewport — measured on the device on 2026-09-04
 * (`canDm: false`, `dmSupport: "other"` on `/spaces`, `/spaces?space=workspace` and
 * `/forge`). Never a regression; it is what "the active space" means once a second space
 * exists next to it.
 *
 * ── Why the setup is exactly this one ────────────────────────────────────────────
 *
 * Two relays: `HOME` answers zooid, `WORK` answers zooid first and Buzz afterwards. The
 * flip is not decoration — it is the case the whole surface is built around (the NIP-11
 * doc arrives late, and `spaceCaps.ts` is three-valued because of it). Both sides the DoD
 * asks for are in here in their natural order: while no reachable space can carry a
 * `DM_OPEN` there is no button and **nothing at all goes to the workspace on the wire**;
 * the moment one can, the button is there and the command goes to THAT relay.
 *
 * ── What is real here and what is a double ───────────────────────────────────────
 *
 * Real: the store (`wireDms`), the whole welshman graph behind it (repository, tracker,
 * `Rooms`, `Relays`), the nip01 signer, `chooseDmSpace`, `planDmOpen`, `foldDmRooms`,
 * `buildSpaceView`, `openRoomAt` and `planRoomNavigation`. Doubled: the network — every
 * socket is a `MockAdapter` that answers REQ from a per-URL fixture set and answers a
 * published EVENT with an `OK` carrying the executor's `response:` line, the same seam
 * `dmMount.test.ts` and `welshmanLoad.test.ts` use. `document`/`window` are the two
 * minimal doubles the dialog and the navigation touch, installed AFTER the imports so no
 * module can branch on them while it loads.
 *
 * The 39000 and 39002 are the shapes `emit_group_discovery_events` writes
 * (`side_effects.rs:1056-1162`), signed with the workspace relay's own key — `Rooms`
 * accepts room state only from the NIP-11 `self` pubkey, so a fixture signed by anyone
 * else would be silently dropped and every case here would measure nothing.
 *
 * ── The one thing this file cannot decide ────────────────────────────────────────
 *
 * `'unknown'` at store level. Reaching it means having no NIP-11 doc for a URL, and then
 * `makeSpaceKindStore` starts its retry ladder with real `setTimeout`s of 1 s / 4 s / 15 s
 * that outlive the case. The three-valuedness is therefore pinned where it is decided —
 * `chooseDmSpace` in `dmModels.test.ts`, including the row that matters (`'other'` next
 * to `'unknown'` stays `'unknown'`).
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AbstractAdapter, ClientMessage } from '@welshman/net'
import type { Filter, TrustedEvent } from '@welshman/util'
import type { DmsStore } from './dms.ts'

// ── Everything that has to stand before the first import ────────────────────────
//
// `groups.ts` binds `activeSpaceUrl` to storage while its module body runs, and
// `spaceCaps.ts` reads `__nostrWorkspace` on module toplevel. Same construction and same
// reason as `dmMount.test.ts` / `activeSpacePersistenz.test.ts`; nothing outside this
// file sees either.
/**
 * **The signer leaks a 30-second timer per signature, and it is not ours.**
 *
 * `signWithOptions` (`@welshman/signer`, unchanged in 0.9.5 through **0.9.9** —
 * `dist/signer/src/util.js` is byte-identical across all five, md5
 * `841a092d1ec00748decf358be46d2922`, measured against the published tarballs on
 * 2026-09-04; do NOT drop this wrapper on the assumption that an upgrade fixed it)
 * `dist/signer/src/util.js:56-60` races the signature against
 * `setTimeout(() => reject("Signing timed out"), 30_000)` and never clears it — not on
 * success, not on failure. In a browser tab that is a stray timer; under `node --test` it
 * is a live handle, so a file that signs ONE event idles for 30 s after its last case.
 * Measured here before this wrapper existed: 3.2 s of cases, `duration_ms 31184`, and
 * `process.getActiveResourcesInfo()` reporting exactly one leftover `Timeout`.
 *
 * `unref()` takes the handle out of the event loop's keep-alive set and changes nothing
 * else: the timer still fires while the loop runs, and rejecting an already-settled
 * promise is a no-op. The bound is 25 s so nothing this file or the client itself waits
 * on is touched — the longest real one is the publish verdict at 20 s
 * (`publishResult.ts`), and that one IS cleared.
 */
const echterTimeout = globalThis.setTimeout
;(globalThis as { setTimeout?: unknown }).setTimeout = ((fn: () => void, ms?: number, ...rest: unknown[]) => {
    const handle = echterTimeout(fn as never, ms as never, ...(rest as never[]))
    if ((ms ?? 0) >= 25_000) {
        ;(handle as { unref?: () => void }).unref?.()
    }

    return handle
}) as unknown as typeof setTimeout

const gespeichert = new Map<string, string>()
;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string): string | null => gespeichert.get(k) ?? null,
    setItem: (k: string, v: string): void => void gespeichert.set(k, v),
    removeItem: (k: string): void => void gespeichert.delete(k),
}
;(globalThis as { __nostrWorkspace?: string }).__nostrWorkspace = 'wss://buzz.test.invalid/'

const { app, Relays } = await import('./welshmanApp.ts')
const { pubkey, sessions } = await import('./welshmanSession.ts')
const { activeSpaceUrl } = await import('./groups.ts')
const { wireDms } = await import('./dms.ts')
const { WORKSPACE_URL } = await import('./spaceCaps.ts')
const { MockAdapter } = await import('@welshman/net')
const { Relay } = await import('@welshman/domain')
const { normalizeRelayUrl } = await import('@welshman/util')
const { finalizeEvent, generateSecretKey, getPublicKey } = await import('nostr-tools/pure')

const HOME = normalizeRelayUrl('wss://zooid.test.invalid/')
const WORK = normalizeRelayUrl('wss://buzz.test.invalid/')

const ZOOID = 'https://github.com/coracle-social/zooid'
const BUZZ = 'https://github.com/block/buzz'

const hex = (bytes: Uint8Array): string =>
    Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')

/** The viewer — a real key, because the store really signs the 41010. */
const MEIN_SECRET = generateSecretKey()
const ME = getPublicKey(MEIN_SECRET)
/** The other participant. Only their pubkey is ever needed. */
const ALICE = getPublicKey(generateSecretKey())

/** The workspace relay's own key: NIP-11 `self`, and the author of all room state. */
const RELAY_SECRET = generateSecretKey()
const RELAY_SELF = getPublicKey(RELAY_SECRET)

/** A channel id in the shape `Uuid::new_v4()` produces. */
const H = '3f1c5b6a-9d2e-4c7b-8a10-6e5d4c3b2a19'

const relaySigned = (kind: number, tags: string[][]): TrustedEvent =>
    finalizeEvent(
        { kind, created_at: Math.floor(Date.now() / 1000), tags, content: '' },
        RELAY_SECRET,
    ) as unknown as TrustedEvent

/**
 * The two events `emit_group_discovery_events` writes for a fresh DM, in its shapes:
 * the 39000 with `hidden`/`closed`/`t=dm` and one `p` per participant
 * (`side_effects.rs:1080-1099`), and the 39002 with `["p", <hex>, "", <role>]`
 * (`group_members_tags`, `:1036-1045`).
 */
const DM_META = relaySigned(39000, [
    ['d', H],
    ['name', 'DM'],
    ['private'],
    ['hidden'],
    ['p', ME],
    ['p', ALICE],
    ['closed'],
    ['t', 'dm'],
])
const DM_MEMBERS = relaySigned(39002, [
    ['d', H],
    ['p', ME, '', 'member'],
    ['p', ALICE, '', 'member'],
])

// ── The doubled network ─────────────────────────────────────────────────────────

/** What each relay would answer a historical REQ with. Filled as the run progresses. */
const bestand = new Map<string, TrustedEvent[]>([
    [HOME, []],
    [WORK, []],
])

/** Every client frame, with the relay it was addressed to. */
const gesendet: { url: string; message: ClientMessage }[] = []

const passt = (filter: Filter, event: TrustedEvent): boolean => {
    if (filter.kinds && !filter.kinds.includes(event.kind)) {
        return false
    }
    if (filter.authors && !filter.authors.includes(event.pubkey)) {
        return false
    }
    for (const [key, werte] of Object.entries(filter)) {
        if (!key.startsWith('#')) {
            continue
        }
        const name = key.slice(1)
        const gesucht = werte as string[]
        if (!event.tags.some((tag) => tag[0] === name && gesucht.includes(tag[1]))) {
            return false
        }
    }

    return true
}

/** REQ frames sent to `url`, as their filter lists. */
const reqs = (url: string): Filter[][] =>
    gesendet
        .filter((frame) => frame.url === url && frame.message[0] === 'REQ')
        .map((frame) => frame.message.slice(2) as Filter[])

/** EVENT frames sent to `url`. */
const events = (url: string): TrustedEvent[] =>
    gesendet
        .filter((frame) => frame.url === url && frame.message[0] === 'EVENT')
        .map((frame) => frame.message[1] as TrustedEvent)

let store: DmsStore
/** Where `openConversation` sent the browser. */
let navigiert = ''

const warten = (ms = 250): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

before(() => {
    app.netContext.getAdapter = (url: string): AbstractAdapter => {
        // `InstanceType<typeof …>` and not `: MockAdapter`: the class arrives through a
        // dynamic `import()` (it has to — everything above it must run first), so the name
        // is a value binding and carries no type of its own.
        const adapter: InstanceType<typeof MockAdapter> = new MockAdapter(url, (message: ClientMessage) => {
            gesendet.push({ url, message })
            if (message[0] === 'REQ') {
                const subId = message[1] as string
                const filters = message.slice(2) as Filter[]
                setTimeout(() => {
                    for (const event of bestand.get(url) ?? []) {
                        if (filters.some((filter) => passt(filter, event))) {
                            // **The two lines a real socket would contribute.**
                            // `requestOne` does not fill the repository; `appPolicyIngest`
                            // does, and it hangs off `app.pool`'s SOCKETS
                            // (`@welshman/app/dist/app/src/policy.js:48-61`:
                            // `app.tracker.track(event.id, socket.url);
                            // app.repository.publish(event)`). A `MockAdapter` has no
                            // socket — `get sockets() { return [] }` — so without these
                            // two lines nothing an adapter delivers ever reaches a single
                            // repository-backed collection. Measured, not assumed: with
                            // only `adapter.receive` the events were served and
                            // `app.repository.query([{kinds:[39000]}])` stayed at 0.
                            app.tracker.track(event.id, url)
                            app.repository.publish(event)
                            adapter.receive(['EVENT', subId, event])
                        }
                    }
                    adapter.receive(['EOSE', subId])
                }, 0)
            }
            if (message[0] === 'EVENT') {
                const event = message[1] as TrustedEvent
                setTimeout(() => {
                    // The relay creates the channel and only THEN do its discovery events
                    // exist — exactly the order that makes the refresh necessary at all.
                    if (event.kind === 41010) {
                        bestand.set(url, [...(bestand.get(url) ?? []), DM_META, DM_MEMBERS])
                    }
                    adapter.receive([
                        'OK',
                        event.id,
                        true,
                        `response:{"channel_id":"${H}","created":true}`,
                    ])
                }, 0)
            }
        })

        return adapter
    }

    // Both relays answer zooid to begin with. The docs are placed BEFORE the first
    // subscription so `deriveSpaceKind` decides from them instead of fetching.
    app.use(Relays).set(HOME, new Relay(HOME, { software: ZOOID, self: getPublicKey(generateSecretKey()) }))
    app.use(Relays).set(WORK, new Relay(WORK, { software: ZOOID, self: RELAY_SELF }))

    // A real nip01 session, because `submit()` really signs.
    sessions.set({ [ME]: { method: 'nip01', pubkey: ME, secret: hex(MEIN_SECRET) } })
    pubkey.set(ME)
    activeSpaceUrl.set(HOME)

    const alpine: Record<string, unknown> = {}
    wireDms({
        store: (name: string, value?: unknown): unknown => {
            if (value !== undefined) {
                alpine[name] = value
            }

            return alpine[name]
        },
    })
    store = alpine.dms as DmsStore

    // The two doubles the dialog and the navigation touch. After the imports on purpose:
    // a module that branched on `document` while loading would see a different world than
    // the browser gives it.
    // A plain class, not a parameter-property one: `--experimental-strip-types` refuses
    // `constructor(public x)` outright, and the failure looks like a broken test file
    // rather than a syntax error (`tests 1 / fail 1`).
    ;(globalThis as { CustomEvent?: unknown }).CustomEvent = class {
        type: string
        detail: unknown
        constructor(type: string, init?: { detail?: unknown }) {
            this.type = type
            this.detail = init?.detail
        }
    }
    ;(globalThis as { document?: unknown }).document = {
        activeElement: null,
        querySelector: (): null => null,
        dispatchEvent: (): boolean => true,
    }
    ;(globalThis as { window?: unknown }).window = {
        location: { assign: (href: string): void => void (navigiert = href) },
    }
})

after(() => {
    for (let i = 0; i < 4; i++) {
        store.unmount()
    }
})

// ══ Side one: no reachable space can do it ═══════════════════════════════════════

test('BEIDE zooid: kein Knopf, kein Ziel — und der Workspace hört kein Wort', async () => {
    store.mount()
    await warten()

    assert.equal(store.canDm, false, 'kein erreichbarer Space kann ein 41010 tragen')
    assert.equal(store.dmSupport, 'other', 'beide Docs sind da: das ist ein ENTSCHIEDENES Nein, kein offenes')
    // Die Fläche entsteht nur bei Zeilen ODER Recht (`dm-list.blade.php`) — hier keins
    // von beidem.
    assert.deepEqual(store.conversations, [])
    assert.equal(
        gesendet.filter((frame) => frame.url === WORK).length,
        0,
        'ohne DM-Fähigkeit geht nichts an den Workspace — auch keine Sichtbarkeits-Abfrage',
    )
})

test('BEIDE zooid: `openNew()` ist ein No-op, nicht ein Dialog ohne Absenden', () => {
    store.openNew()

    assert.deepEqual(store.conversations, [], 'die Liste wurde nicht armiert')
    assert.equal(
        reqs(WORK).length,
        0,
        'auch kein Verzeichnis-REQ: der Dialog wurde gar nicht erst geöffnet',
    )
})

// ══ Side two: the workspace answers Buzz ═════════════════════════════════════════

test('DIE MESSUNG: sagt der Workspace Buzz, ist der Knopf da — der Heim-Space bleibt zooid', async () => {
    // Genau der Aufbau des Nutzers: `group.space_url` ist zooid, `group.workspace_url`
    // ist Buzz. Vor `chooseDmSpace` blieb `canDm` hier für immer falsch.
    app.use(Relays).set(WORK, new Relay(WORK, { software: BUZZ, self: RELAY_SELF }))
    await warten()

    assert.equal(store.canDm, true)
    assert.equal(store.dmSupport, 'buzz')
})

test('Die Liste armiert den Workspace — sonst faltet sie eine Sicht, die niemand geladen hat', async () => {
    store.armList()
    await warten()

    const raumReqs = reqs(WORK).filter((filters) =>
        filters.some((filter) => filter.kinds?.includes(39000) && filter['#p'] === undefined),
    )
    assert.ok(
        raumReqs.length > 0,
        'ohne `watchSpaceRooms(WORKSPACE_URL)` bleibt die Unterhaltungsliste auf dem Telefon leer: ' +
            'Rail, Palette und `/forge` sind dort alle drei nicht da',
    )
})

test('Das Kommando geht an den Workspace, nicht an den Space in der Ansicht', async () => {
    store.openNew()
    store.pick(ALICE)
    assert.deepEqual(store.picked, [ALICE], 'Vorbedingung: es gibt jemanden zu schreiben')

    await store.submit()
    await warten()

    assert.equal(store.error, '', `der Relay hat abgelehnt: ${store.error}`)
    const geschrieben = events(WORK).filter((event) => event.kind === 41010)
    assert.equal(geschrieben.length, 1, 'genau ein 41010, und zwar an den Workspace')
    assert.deepEqual(
        geschrieben[0].tags,
        [['p', ALICE]],
        'der Körper ist der von `planDmOpen` — ein `p` je Gegenüber, kein `h`, kein `d`',
    )
    assert.equal(
        events(HOME).filter((event) => event.kind === 41010).length,
        0,
        'auf zooid wäre ein 41010 dauerhafter Müll, den niemand liest (`relayCapability.ts`)',
    )
})

test('Die eröffnete Unterhaltung ist danach eine Zeile — mit dem Relay, aus dem sie stammt', async () => {
    // Grosszügig gewartet: die Sicht hängt über `lastMessageAtByUrl` an einem
    // `throttled(1000, …)` (`groups.ts:332`), die Zeile kann also eine Sekunde nach dem
    // `OK` erscheinen.
    await warten(1500)

    assert.equal(store.conversations.length, 1, 'ohne die 39002 im Refresh landet sie in den ENTDECKBAREN Räumen')
    assert.equal(store.conversations[0].h, H)
    assert.equal(
        store.conversations[0].spaceUrl,
        WORKSPACE_URL,
        'die Zeile trägt ihren Relay — daran hängt jedes weitere Kommando und der Sprung',
    )
})

test('DER SPRUNG trägt die Space-Markierung — ohne sie bliebe der Verlauf leer', () => {
    store.openConversation(store.conversations[0])

    assert.equal(
        navigiert,
        `/rooms/${H}?space=workspace`,
        'ohne `?space=workspace` lädt `/rooms/{h}` gegen den Heim-Relay: leerer Verlauf, ' +
            'und der Beitritt (9021) käme als `invalid: group not found` zurück (`spaceParam.ts`)',
    )
})

// ══ The control: back to zooid, and the surface closes again ════════════════════

test('GEGENPROBE: fällt der Workspace weg, ist der Knopf sofort wieder weg', async () => {
    app.use(Relays).set(WORK, new Relay(WORK, { software: ZOOID, self: RELAY_SELF }))
    await warten()

    assert.equal(store.canDm, false)
    assert.equal(store.dmSupport, 'other')
    const vorher = events(WORK).length
    store.openNew()
    await store.submit()

    assert.equal(events(WORK).length, vorher, 'ein Klick auf den nicht mehr vorhandenen Knopf schreibt nichts')
})

// ══ The latch: nothing above sees the markup ════════════════════════════════════

const BLADE_DIR = join(import.meta.dirname, '..', 'resources', 'views', 'components')

/**
 * A Blade file with its comments removed — the same stripper and the same reason as in
 * `dmMount.test.ts`: both files EXPLAIN `canDm` in prose, so a plain text search would be
 * green on the explanation alone.
 */
const ohneKommentare = (datei: string): string =>
    readFileSync(join(BLADE_DIR, datei), 'utf8').replace(/\{\{--[\s\S]*?--\}\}/g, '')

test('LATCH: beide Flächen hängen den Eröffnen-Knopf an genau dieses `canDm`', () => {
    const liste = ohneKommentare('dm-list.blade.php')
    assert.ok(liste.includes('$store.dms?.canDm'), 'die mobile Fläche gatet den Knopf nicht mehr am Store')
    assert.ok(liste.includes('$store.dms.openNew()'), 'und ruft ihn nicht mehr auf')

    const rail = ohneKommentare('desktop-rail.blade.php')
    assert.ok(rail.includes('action-show="$store.dms?.canDm"'), 'die Rail gatet ihren `+` nicht mehr am Store')
})

test('CONTROL: der Kommentar-Stripper strippt wirklich — sonst prüft der Latch Prosa', () => {
    const roh = readFileSync(join(BLADE_DIR, 'dm-list.blade.php'), 'utf8')
    assert.ok(roh.includes('{{--'), 'Vorbedingung: die Datei trägt überhaupt Blade-Kommentare')
    assert.ok(roh.includes('`canDm`'), 'Vorbedingung: der Kommentar spricht über canDm — genau darum wird gestrippt')
    assert.equal(
        ohneKommentare('dm-list.blade.php').includes('`canDm`'),
        false,
        'nach dem Strippen darf keine Prosa mehr übrig sein, die den Latch füttert',
    )
})
