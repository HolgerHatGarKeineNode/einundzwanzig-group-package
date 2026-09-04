/**
 * **Who is allowed to switch the conversation list off** — the reference count in
 * `dms.ts`.
 *
 * Run: node --test --experimental-strip-types packages/einundzwanzig-group/js/dmListArming.test.ts
 *
 * ── The failure this file is written against ─────────────────────────────────────
 *
 * Until the conversations became reachable on a phone, exactly one surface wanted
 * `$store.dms.conversations` to be live: the „Neue Unterhaltung"-dialog. `openNew()`
 * armed the derivation, `closeDialog()` disarmed it, and a single owner needs no
 * bookkeeping.
 *
 * The „Direkt"-panel on `/spaces` is the second owner, and it is not an exotic one — the
 * dialog opens FROM that panel. Without a count the sequence is: panel arms, dialog arms
 * (no-op, already armed), user cancels, `closeDialog()` disarms — and the list the user
 * is looking at empties itself. The NORMAL path, not an edge case.
 *
 * ── How this is measured, and why it is not a replica ────────────────────────────
 *
 * Against the real store built by `wireDms`, through the seam `dmMount.test.ts` uses.
 * The observable is `DmsStore.conversations`: `disarmConversations()` is the only thing
 * that assigns `[]` to it outside of an emit, so a SENTINEL written into the field
 * survives exactly as long as the derivation is held. That is a direct read of the
 * counter, not a proxy for it.
 *
 * The `localStorage` double has to stand BEFORE the first import (`groups.ts` binds
 * `activeSpaceUrl` to storage while its module body runs) — same construction and same
 * reason as in `dmMount.test.ts`.
 */
import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { DmsStore, DmConversation } from './dms.ts'

const gespeichert = new Map<string, string>()
;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string): string | null => gespeichert.get(k) ?? null,
    setItem: (k: string, v: string): void => void gespeichert.set(k, v),
    removeItem: (k: string): void => void gespeichert.delete(k),
}

const { wireDms } = await import('./dms.ts')

/** A row that no emit can produce — so its survival can only mean "still armed". */
const SENTINEL: DmConversation = {
    h: 'sentinel',
    name: 'DM',
    isDm: true,
    dmParticipants: [],
    spaceUrl: '',
}

let store: DmsStore

before(() => {
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

test('PRECONDITION: arming replaces the list, so the sentinel has to be written after it', () => {
    store.conversations = [SENTINEL]
    store.armList()

    assert.deepEqual(store.conversations, [], 'die Anmeldung emittiert sofort und rechnet die Liste neu')

    store.disarmList()
})

test('THE MEASUREMENT: with two holders, one release does not empty the list', () => {
    // Panel arms…
    store.armList()
    // …dialog arms on top of it. The derivation is already live, so nothing re-emits —
    // which is why the sentinel written now survives an honest hold.
    store.armList()
    store.conversations = [SENTINEL]

    // Dialog closes.
    store.disarmList()

    assert.deepEqual(
        store.conversations,
        [SENTINEL],
        'der Dialog hat abgemeldet, das Panel hält noch — die Liste darf nicht leer sein',
    )
})

test('NEGATIVE CONTROL: the last release DOES empty it', () => {
    // Without this case "the list survived" would read the same as "this file cannot
    // observe a disarm at all".
    store.disarmList()

    assert.deepEqual(store.conversations, [], 'der letzte Halter gibt frei — jetzt muss abgebaut werden')
})

test('the count does not go negative — a stray release cannot poison the next hold', () => {
    // `closeDialog()` can run without a matching `openNew()` (the modal is dismissable
    // with Escape and the backdrop). A counter that went to -1 would then need TWO
    // arms before the panel worked again.
    store.disarmList()
    store.disarmList()

    store.armList()
    store.conversations = [SENTINEL]
    store.disarmList()

    assert.deepEqual(store.conversations, [], 'ein Halter, eine Freigabe — kein verschluckter Abbau')
})

test('re-arming after a full release works — the counter is not a one-way latch', () => {
    store.armList()
    store.conversations = [SENTINEL]
    store.armList()

    assert.deepEqual(store.conversations, [SENTINEL], 'die zweite Anmeldung auf eine laufende ist ein No-op')

    store.disarmList()
    assert.deepEqual(store.conversations, [SENTINEL])
    store.disarmList()
    assert.deepEqual(store.conversations, [])
})

// ══ The two holders — a latch, because nothing above sees the markup ══════════════

const VIEW_DIR = join(import.meta.dirname, '..', 'resources', 'views')

/**
 * A Blade file with its comments removed.
 *
 * Same reason as in `dmMount.test.ts`: both files EXPLAIN the arming in prose, so a plain
 * text search would be green on the explanation alone. The control case below proves the
 * stripping works.
 */
const ohneKommentare = (pfad: string): string =>
    readFileSync(join(VIEW_DIR, pfad), 'utf8').replace(/\{\{--[\s\S]*?--\}\}/g, '')

test('LATCH: the „Direkt"-panel holds the list, and gives it back', () => {
    const markup = ohneKommentare('components/dm-list.blade.php')

    assert.ok(markup.includes('$store.dms?.armList()'), 'das Panel meldet die Liste nicht an')
    assert.ok(markup.includes('$store.dms?.disarmList()'), 'das Panel meldet sie an, aber nie ab')
})

test('CONTROL: the comment stripper really strips — otherwise the latch checks prose', () => {
    const roh = readFileSync(join(VIEW_DIR, 'components', 'dm-list.blade.php'), 'utf8')

    assert.ok(roh.includes('{{--'), 'Vorbedingung: die Datei trägt überhaupt Blade-Kommentare')
    assert.ok(roh.includes('`armList()`'), 'Vorbedingung: der Kommentar spricht über armList()')
    assert.equal(
        ohneKommentare('components/dm-list.blade.php').includes('`armList()`'),
        false,
        'nach dem Strippen darf keine Prosa mehr übrig sein, die den Riegel füttert',
    )
})
