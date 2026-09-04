/**
 * P7b — **what `$store.dms.mount()` costs, and what a SECOND mount costs.**
 *
 * Run: node --test --experimental-strip-types packages/einundzwanzig-group/js/dmMount.test.ts
 *
 * ── Why this file exists ─────────────────────────────────────────────────────────
 *
 * Until this phase the store was armed at exactly one place, `desktop-rail.blade.php`.
 * The rail is not rendered in the NativePHP host (`app-frame.blade.php:44`) and does not
 * exist below `xl` in the browser either, so on both surfaces `canDm` stayed on its
 * initial `false` and every DM control was invisible before it could be built. The mount
 * therefore moved up into `app-frame.blade.php`, which is the root of exactly the pages
 * behind the gate — and the rail's own mount stayed where it was, because it documents
 * the rail's dependency and guarantees the hidden set is known before the first row.
 *
 * That makes a DOUBLE mount the normal case in the web host, and "the counter handles it"
 * is a claim, not a measurement. What is measured here is the only thing that would hurt:
 * **what goes out on the wire.** `mount()` buys `armUrl` → `deriveSpaceKind` and, once
 * the NIP-11 doc says Buzz, `armVisibility` → one `load()` of the relay-signed 30622
 * (`{kinds:[30622], "#p":[<self>]}` — p-gated, `req.rs:1069-1086`). A second mount that
 * armed a second time would double every REQ on every page of the app.
 *
 * ── Which guard actually carries this, measured by mutation on 2026-09-04 ────────
 *
 * Three guards stand in the way, and the first assumption about them was WRONG. Removing
 * the outermost — `if (unsubSpace !== noop) return` in `mount()` — leaves every case here
 * green: the second mount then re-subscribes `activeSpace`, but `armUrl` refuses at
 * `unsubKind.has(url)` and no REQ follows. Removing `mount()`'s AND `armUrl`'s guard is
 * still green, because `armVisibility` refuses at `unsubVisibility.has(url)`. Only with
 * all three gone does the count go 1 → 2 and this file go red.
 *
 * So the idempotence is per-URL and defence in depth; the mount counter is NOT what
 * carries it. What the counter does carry is the `wire:navigate` case, and that has its
 * own probe: removing `if (mounts > 0) return` from `unmount()` turns the fourth case
 * below red on its own.
 *
 * ── How it is measured ───────────────────────────────────────────────────────────
 *
 * Against the real store, not a replica: `wireDms` builds it, `app.netContext.getAdapter`
 * is replaced with a `MockAdapter` that records every client frame, and the NIP-11 doc is
 * put into the `Relays` collection by hand so `deriveSpaceKind` answers `'buzz'` without
 * an HTTP fetch. Same seam `welshmanLoad.test.ts` uses.
 *
 * The `localStorage` double has to stand BEFORE the first import: `groups.ts` binds
 * `activeSpaceUrl` to storage while its module body runs. Same construction and same
 * reason as `activeSpacePersistenz.test.ts`; nothing outside this file sees it.
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AbstractAdapter, ClientMessage } from '@welshman/net'
import type { DmsStore } from './dms.ts'

const gespeichert = new Map<string, string>()
;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string): string | null => gespeichert.get(k) ?? null,
    setItem: (k: string, v: string): void => void gespeichert.set(k, v),
    removeItem: (k: string): void => void gespeichert.delete(k),
}

const { app, Relays } = await import('./welshmanApp.ts')
const { pubkey } = await import('./welshmanSession.ts')
const { activeSpaceUrl } = await import('./groups.ts')
const { wireDms } = await import('./dms.ts')
const { MockAdapter } = await import('@welshman/net')
const { Relay } = await import('@welshman/domain')
const { normalizeRelayUrl } = await import('@welshman/util')

const URL_ = normalizeRelayUrl('wss://buzz.test.invalid/')
const ME = 'a'.repeat(64)
/** The relay's own key (NIP-11 `self`) — what a 30622 would have to be signed with. */
const RELAY_SELF = 'f'.repeat(64)

/** Every client frame this run produced, in order. */
const gesendet: ClientMessage[] = []

/** REQ frames whose filter names the DM visibility kind. */
const sichtbarkeitsReqs = (): ClientMessage[] =>
    gesendet.filter(
        (message) =>
            message[0] === 'REQ' &&
            message.slice(2).some((filter) => (filter as { kinds?: number[] })?.kinds?.includes(30622)),
    )

let store: DmsStore

before(() => {
    app.netContext.getAdapter = (): AbstractAdapter =>
        new MockAdapter(URL_, (message: ClientMessage) => {
            gesendet.push(message)
        })

    // The NIP-11 doc, placed by hand: `isBuzzRelay` looks at `software`, and
    // `deriveRelaySignedEvents` at `self`. Without the doc `deriveSpaceKind` would answer
    // `'unknown'`, which denies — and the case would then measure the gate, not the mount.
    app.use(Relays).set(URL_, new Relay(URL_, { software: 'https://github.com/block/buzz', self: RELAY_SELF }))

    pubkey.set(ME)
    activeSpaceUrl.set(URL_)

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
})

after(() => {
    // Leave the store torn down whatever the cases did, so nothing keeps a timer alive.
    for (let i = 0; i < 4; i++) {
        store.unmount()
    }
})

test('PRECONDITION: nothing is armed and nothing is on the wire before the first mount', () => {
    assert.equal(store.canDm, false, 'der Startwert, an dem die mobile Fläche hängen blieb')
    assert.equal(gesendet.length, 0)
})

test('one mount arms the space: canDm turns true and exactly one 30622 REQ goes out', async () => {
    store.mount()
    // `load()` batches; give the loader a tick to flush.
    await new Promise((resolve) => setTimeout(resolve, 300))

    assert.equal(store.canDm, true, 'ohne Mount läuft kein recomputePermission — genau das war der Defekt')
    assert.equal(sichtbarkeitsReqs().length, 1, 'ein REQ auf die relay-signierte 30622, kein zweiter')
    const [, , filter] = sichtbarkeitsReqs()[0] as [string, string, { kinds: number[]; '#p': string[] }]
    assert.deepEqual(filter.kinds, [30622])
    assert.deepEqual(filter['#p'], [ME], '30622 ist p-gated — ohne `#p` antwortet Buzz mit CLOSED')
})

test('THE MEASUREMENT: a second mount costs nothing on the wire', async () => {
    const vorher = gesendet.length
    store.mount()
    await new Promise((resolve) => setTimeout(resolve, 300))

    assert.equal(sichtbarkeitsReqs().length, 1, 'der zweite Mount darf kein zweites REQ auslösen')
    assert.equal(gesendet.length, vorher, 'und überhaupt keinen weiteren Frame')
    assert.equal(store.canDm, true)
})

test('the first unmount tears nothing down while the second holder is still there', () => {
    store.unmount()

    assert.equal(store.canDm, true, 'teardown() setzt canDm auf false — er darf hier nicht gelaufen sein')
})

test('the last unmount really does tear down — the counter is not a one-way latch', () => {
    store.unmount()

    assert.equal(store.canDm, false)
    assert.deepEqual(store.hidden, [])
    assert.deepEqual(store.names, {})
})

test('and a later mount arms again — which is what makes the case above a real teardown', async () => {
    // This is also the POSITIVE CONTROL for the counting above: it is the one case in
    // which `sichtbarkeitsReqs()` is supposed to grow. Without it, "no second REQ" would
    // read the same as "this file cannot see a REQ at all".
    const vorher = sichtbarkeitsReqs().length
    store.mount()
    await new Promise((resolve) => setTimeout(resolve, 300))

    assert.equal(store.canDm, true)
    assert.equal(sichtbarkeitsReqs().length, vorher + 1, 'nach echtem Abbau wird neu abonniert')
})

// ══ The two mount sites — a latch, because nothing above sees the markup ══════════

const BLADE_DIR = join(import.meta.dirname, '..', 'resources', 'views', 'components')

/**
 * A Blade file with its comments removed.
 *
 * Not decoration: both files EXPLAIN the mount in prose, so a plain text search for
 * `mount()` is green on the explanation alone — exactly the failure mode where a grep
 * finds its own justification. The control case below proves the stripping works.
 */
const ohneKommentare = (datei: string): string =>
    readFileSync(join(BLADE_DIR, datei), 'utf8').replace(/\{\{--[\s\S]*?--\}\}/g, '')

test('LATCH: the store is mounted in app-frame AND in the rail — two sites, not one', () => {
    // `app-frame` is the root of every page behind the gate on BOTH hosts; the rail is
    // the desktop-only second holder. One of them alone is what the phase came from.
    for (const datei of ['app-frame.blade.php', 'desktop-rail.blade.php']) {
        const markup = ohneKommentare(datei)
        assert.ok(markup.includes('$store.dms?.mount()'), `${datei} meldet den DM-Store nicht an`)
        assert.ok(markup.includes('$store.dms?.unmount()'), `${datei} meldet ihn an, aber nie ab`)
    }
})

test('CONTROL: the comment stripper really strips — otherwise the latch checks prose', () => {
    const roh = readFileSync(join(BLADE_DIR, 'app-frame.blade.php'), 'utf8')
    assert.ok(roh.includes('{{--'), 'Vorbedingung: die Datei trägt überhaupt Blade-Kommentare')
    assert.ok(
        roh.includes('`mount()`'),
        'Vorbedingung: der Kommentar spricht über mount() — genau darum wird gestrippt',
    )
    assert.equal(
        ohneKommentare('app-frame.blade.php').includes('`mount()`'),
        false,
        'nach dem Strippen darf keine Prosa mehr übrig sein, die den Riegel füttert',
    )
})
