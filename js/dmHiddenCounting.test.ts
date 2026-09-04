/**
 * P7c — **an dismissed conversation stops counting, everywhere.**
 *
 * Run: node --test --experimental-strip-types packages/einundzwanzig-group/js/dmHiddenCounting.test.ts
 *
 * ── The defect ───────────────────────────────────────────────────────────────────
 *
 * `41012 DM_HIDE` sets `hidden_at` on the caller's membership row; the relay deletes
 * nothing and the channel's 39000 keeps arriving. Only the rail applied the resulting
 * 30622 set — the list that feeds the unread dot and `/updates` was plain membership. A
 * conversation the user had put away therefore vanished from the column and kept lighting
 * up the bell. On the phone that is worse than on the desktop: the bell is the only route
 * to conversations there, and there is no column in which one could see it is gone.
 *
 * ── What is measured here, and against what ──────────────────────────────────────
 *
 * The REAL selector out of `bridge.ts` (`countedRoomHsOf`, the one the store derivation
 * calls) feeds the REAL `computeUpdates` and `computeUnread`. Nothing in this file
 * re-implements the filter, so a mutation in `bridge.ts` turns these cases red rather
 * than a replica of them.
 *
 * ── The distinction the last case is about ───────────────────────────────────────
 *
 * "Dismissed" and "orphaned" would have the same visible result if they were built the
 * same way, and they are two different statements:
 *
 *   dismissed → the `h` is not in the counted list → `computeUpdates` SKIPS it
 *               (rule 5, `updates.ts:669`/`:717`), no row at all;
 *   orphaned  → the `h` IS counted but has no name → the row stands and says
 *               "message no longer available" (rule 10).
 *
 * A dismissed conversation must take the first path. The last case asserts that it does
 * — no row, and in particular not a dead one.
 *
 * The `localStorage` double stands before the first import: `groups.ts` binds
 * `activeSpaceUrl` to storage while its module body runs, and `bridge.ts` pulls it in.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

const gespeichert = new Map<string, string>()
;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string): string | null => gespeichert.get(k) ?? null,
    setItem: (k: string, v: string): void => void gespeichert.set(k, v),
    removeItem: (k: string): void => void gespeichert.delete(k),
}

const { countedRoomHsOf, roomNamesOf } = await import('./bridge.ts')
const { computeUpdates } = await import('./updates.ts')
const { computeUnread } = await import('./unread.ts')
const { roomKey } = await import('./readState.ts')
type SpaceView = Awaited<typeof import('./groups.ts')> extends never ? never : import('./groups.ts').SpaceView
type ReadState = import('./readState.ts').ReadState

const URL_ = 'wss://relay.example/'
const ME = 'a'.repeat(64)
const ALICE = 'b'.repeat(64)
const NOW = Math.floor(new Date(2026, 6, 23, 12, 0, 0).getTime() / 1000)

const H_RAUM = 'allgemein'
/** The conversation the user put away with a 41012. */
const H_WEG = '3f1c5b6a-9d2e-4c7b-8a10-6e5d4c3b2a19'
/** The one they did not — without it this file would only prove the list can be empty. */
const H_DA = '00000000-1111-2222-3333-444444444444'

const dmRoom = (h: string) => ({ h, name: 'DM', isDm: true, dmParticipants: [ME, ALICE] })

/**
 * A space view reduced to what {@link countedRoomHsOf} reads: `url`, `userRooms`,
 * `dmRooms`. The cast keeps the fixture honest about that instead of inventing values for
 * two dozen fields nobody looks at.
 */
const view = {
    url: URL_,
    userRooms: [{ h: H_RAUM, name: 'Allgemein', isDm: false, dmParticipants: [] }],
    dmRooms: [dmRoom(H_WEG), dmRoom(H_DA)],
} as unknown as SpaceView

const nachricht = (id: string, h: string) =>
    ({
        id,
        kind: 9,
        created_at: NOW - 60,
        pubkey: ALICE,
        tags: [['h', h]],
        content: 'moin',
        sig: '',
    }) as never

/** Everything read an hour ago, so both conversations carry something unread. */
const state = {
    [roomKey(URL_, H_RAUM)]: NOW - 3600,
    [roomKey(URL_, H_WEG)]: NOW - 3600,
    [roomKey(URL_, H_DA)]: NOW - 3600,
} as ReadState

const events = [nachricht('m1', H_WEG), nachricht('m2', H_DA)]

const updatesFor = (hidden: string[]) =>
    computeUpdates({
        url: URL_,
        joined: countedRoomHsOf(view, hidden),
        events,
        comments: [],
        state,
        me: ME,
        roomNames: { [H_RAUM]: 'Allgemein', [H_WEG]: 'Alice', [H_DA]: 'Alice' },
        profiles: new Map() as never,
        now: NOW,
    })

const unreadFor = (hidden: string[]) =>
    computeUnread({
        url: URL_,
        joined: countedRoomHsOf(view, hidden),
        events,
        comments: [],
        state,
        me: ME,
    })

// ══ The selector ═════════════════════════════════════════════════════════════════

test('the counted list drops the dismissed conversation and keeps everything else', () => {
    assert.deepEqual(countedRoomHsOf(view, [H_WEG]), [H_RAUM, H_DA])
})

test('CONTROL: without a dismissal both conversations are counted', () => {
    // Otherwise every assertion below would also hold for a fixture that never had two.
    assert.deepEqual(countedRoomHsOf(view, []), [H_RAUM, H_WEG, H_DA])
})

// ══ /updates — against the real computeUpdates ═══════════════════════════════════

test('a dismissed conversation produces NO /updates row', () => {
    const items = updatesFor([H_WEG])

    assert.equal(
        items.some((item) => item.h === H_WEG),
        false,
        'die ausgeblendete Unterhaltung darf keine Zeile erzeugen',
    )
})

test('PRESENCE: the conversation that was NOT dismissed still produces its row', () => {
    const items = updatesFor([H_WEG])

    assert.equal(items.length, 1, 'genau eine Zeile — sonst prüft der Fall darüber nur, dass die Liste leer ist')
    assert.equal(items[0].h, H_DA)
    assert.equal(items[0].context, 'Alice')
    assert.equal(items[0].unread, true)
})

test('CONTROL: with the same input and nothing dismissed there are TWO rows', () => {
    const items = updatesFor([])

    assert.deepEqual(items.map((item) => item.h).sort(), [H_DA, H_WEG].sort())
})

// ══ The unread dot — against the real computeUnread ══════════════════════════════

test('a dismissed conversation contributes nothing to the unread dot', () => {
    const view_ = unreadFor([H_WEG])

    assert.equal(view_.rooms[H_WEG], undefined, 'ein nicht gezählter Raum hat gar keinen Eintrag')
    assert.equal(view_.rooms[H_DA], 1, 'die andere Unterhaltung zählt weiterhin')
    assert.equal(view_.roomsTotal, 1)
    assert.equal(view_.any, true, 'der Punkt leuchtet weiter — nur eben für die richtige Unterhaltung')
})

test('CONTROL: undismissed, the same events give the dot two rooms', () => {
    const view_ = unreadFor([])

    assert.equal(view_.rooms[H_WEG], 1)
    assert.equal(view_.roomsTotal, 2)
})

test('and with BOTH dismissed the dot goes dark — the whole point of the fix', () => {
    const view_ = unreadFor([H_WEG, H_DA])

    assert.equal(view_.roomsTotal, 0)
    assert.equal(view_.any, false)
})

// ══ Dismissed is SKIPPED, not ORPHANED — the two must stay distinguishable ═══════

test('the dismissed row is skipped, not turned into a dead "no longer available" row', () => {
    const items = updatesFor([H_WEG])

    assert.equal(
        items.some((item) => item.orphan),
        false,
        '„ausgeblendet" darf nicht als „verwaist" herauskommen — das wären zwei Aussagen mit einem Bild',
    )
})

test('the name map stays a SUPERSET of the counted list — the two rules must not merge', () => {
    // The invariant that keeps them apart. Measured on 2026-09-04 that it was NOT held by
    // anything: a `joinedRoomNames` that additionally filters the dismissed rooms passed
    // 20 tests and the typecheck, because `computeUpdates` sorts by the counted list first
    // and never reaches the name. It only bites once the two lists diverge — and then a
    // live conversation reads "message no longer available".
    const namen = roomNamesOf(view, {}, ME)
    for (const hidden of [[], [H_WEG], [H_WEG, H_DA]]) {
        for (const h of countedRoomHsOf(view, hidden)) {
            assert.ok(h in namen, `${h} zählt, hat aber keinen Namen — die Zeile käme als „verwaist" heraus`)
        }
    }
    // Und die Richtung, die die Zusage überhaupt erst zu einer Zusage macht: die Karte
    // trägt AUCH den ausgeblendeten Raum. Sonst wäre „Obermenge" bloss „gleich".
    assert.ok(H_WEG in namen, 'die ausgeblendete Unterhaltung fehlt in der Namenskarte')

    // ── Was dieser Fall NICHT fängt, gemessen statt vermutet (2026-09-04) ──────────
    // Drei Mutationsformen von `roomNamesOf` ausprobiert:
    //  (a) `dmRooms` aus der Karte gelassen              → dieser Fall wird ROT;
    //  (b) einen `hidden`-Parameter ergänzt und gefiltert → der TYPECHECK wird rot
    //      (TS2554 an genau diesem Aufruf, weil er drei Argumente reicht);
    //  (c) `get(hiddenDmHs)` INNERHALB der Funktion gelesen → **grün, beides**. Der
    //      Store ist unter `node --test` leer, ein reiner Aufruf sieht ihn nicht.
    // (c) bleibt offen und ist bewusst so notiert: dieser Riegel deckt die Signatur und
    // den Rumpf, nicht einen Griff in den Modulzustand.
})

test('CONTROL: a room WITHOUT a name is still orphaned — the other statement survives', () => {
    // Rule 10 has to keep working, or the case above is green because nothing is ever
    // orphaned any more. `H_DA` is counted here and simply has no name.
    const items = computeUpdates({
        url: URL_,
        joined: countedRoomHsOf(view, [H_WEG]),
        events,
        comments: [],
        state,
        me: ME,
        roomNames: { [H_RAUM]: 'Allgemein', [H_DA]: '' },
        profiles: new Map() as never,
        now: NOW,
    })

    assert.equal(items.length, 1, 'die verwaiste Zeile BLEIBT stehen — anders als die ausgeblendete')
    assert.equal(items[0].h, H_DA)
    assert.equal(items[0].orphan, true)
})
