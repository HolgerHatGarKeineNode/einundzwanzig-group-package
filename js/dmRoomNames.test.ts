/**
 * P7b — **the name of a conversation, and the one place it is decided.**
 *
 * Run: node --test --experimental-strip-types packages/einundzwanzig-group/js/dmRoomNames.test.ts
 *
 * ── The defect these cases are built around ──────────────────────────────────────
 *
 * Buzz stores the literal string `"DM"` as the channel name of every two-person
 * conversation and `"Group DM (N)"` for every group (`buzz-db/src/dm.rs:157-162`). Until
 * this phase only the rail knew that and resolved the name through the participants
 * (`railName`); `bridge.ts joinedRoomNames` took `room.name` raw. That was invisible on
 * the web desktop and fatal everywhere else: the rail is never rendered in the NativePHP
 * host (`app-frame.blade.php:44`) and does not exist below `xl` in the browser either,
 * while `/updates` lists the conversations on exactly those surfaces — as N rows all
 * called "DM".
 *
 * Three levels, because the promise breaks at three different places:
 *
 *  1. **The rule** ({@link roomDisplayName}) — a conversation is named after its
 *     counterparties, a normal room after itself, and the fallback is the relay's own
 *     name, never `''`.
 *  2. **The consequence for `/updates`** — `buildItem` reads an empty room name as
 *     ORPHANED and replaces the row with "message no longer available". So the fallback
 *     is not cosmetic: get it wrong and an unresolvable conversation does not merely look
 *     wrong, it disappears behind a false claim. This is checked against the real
 *     `computeUpdates`, not against a description of it.
 *  3. **The wiring** — that both surfaces really call the shared resolution. A second
 *     implementation is exactly what this phase removed, and nothing about the two
 *     levels above goes red if someone writes one again. The AST scanner from the P6
 *     workspace latch (`workspaceQuelleGate.ts`) is reused rather than rebuilt.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { foldDmRooms, roomDisplayName, type DmNameableRoom } from './dmModels.ts'
import { computeUpdates, type UpdateInput } from './updates.ts'
import { roomKey, type ReadState } from './readState.ts'
import { importiertAus, liesDatei, ruftAuf } from './workspaceQuelleGate.ts'

const JS_DIR = import.meta.dirname

/** 64 lowercase hex, one letter each, so the fixtures read at a glance. */
const pk = (c: string): string => c.repeat(64)

const ME = pk('a')
const ALICE = pk('b')
const BOB = pk('c')

/** Channel ids in the shape `Uuid::new_v4()` produces. */
const H_DM = '3f1c5b6a-9d2e-4c7b-8a10-6e5d4c3b2a19'
const H_STUMM = '00000000-1111-2222-3333-444444444444'
const H_RAUM = 'allgemein'

const NAMEN: Record<string, string> = { [ME]: 'Ich', [ALICE]: 'Alice', [BOB]: 'Bob' }
const nameOf = (p: string): string => NAMEN[p] ?? ''

/** A conversation, exactly as `buildSpaceView` puts it into `SpaceView.dmRooms`. */
const dmRoom = (h: string, participants: string[], name = 'DM') => ({
    h,
    name,
    isDm: true,
    dmParticipants: participants,
})

// ══ 1. The rule ══════════════════════════════════════════════════════════════════

test('a conversation is named after the counterparty, not after the relay string', () => {
    assert.equal(roomDisplayName(dmRoom(H_DM, [ME, ALICE]), ME, nameOf), 'Alice')
    assert.equal(roomDisplayName(dmRoom(H_DM, [ME, ALICE, BOB], 'Group DM (3)'), ME, nameOf), 'Alice, Bob')
})

test('an ordinary room keeps its own name — the resolution touches only conversations', () => {
    const raum = { h: H_RAUM, name: 'Allgemein', isDm: false, dmParticipants: [] }
    assert.equal(roomDisplayName(raum, ME, nameOf), 'Allgemein')
    // And a row that carries no DM marker at all is the same case; `RailRoom.isDm` is optional.
    const ohneMarker: DmNameableRoom = { name: 'Allgemein' }
    assert.equal(roomDisplayName(ohneMarker, ME, nameOf), 'Allgemein')
})

test('no resolvable title ⇒ the relay name stays, and it is never the empty string', () => {
    // A 39000 without a usable `p` tag: `dmParticipants` is empty, `dmTitle` has nobody
    // to name and answers ''. The row must keep standing under the relay's own name.
    assert.equal(roomDisplayName(dmRoom(H_STUMM, []), ME, nameOf), 'DM')
    assert.equal(roomDisplayName(dmRoom(H_STUMM, [], 'Group DM (4)'), ME, nameOf), 'Group DM (4)')
    // Participants without a profile are a DIFFERENT case and must not fall back: the
    // shortened key is more informative than "DM", and `dmTitle` already provides it.
    assert.equal(roomDisplayName(dmRoom(H_DM, [ME, ALICE]), ME, () => ''), `${ALICE.slice(0, 8)}…`)
})

// ══ 2. The consequence for `/updates` — measured against `computeUpdates` ═════════

const URL = 'wss://relay.example/'
const NOW = Math.floor(new Date(2026, 6, 23, 12, 0, 0).getTime() / 1000)

const nachricht = (id: string, h: string, createdAt: number) =>
    ({
        id,
        kind: 9,
        created_at: createdAt,
        pubkey: ALICE,
        tags: [['h', h]],
        content: 'moin',
        sig: '',
    }) as never

/**
 * The map `bridge.ts joinedRoomNames` builds — built HERE with the same function, so the
 * case measures the shipped resolution and not a description of it.
 */
type BenannterRaum = DmNameableRoom & { h: string }

const roomNamesOf = (rooms: BenannterRaum[], resolver = nameOf): Record<string, string> =>
    Object.fromEntries(rooms.map((room) => [room.h, roomDisplayName(room, ME, resolver)]))

const updateInput = (over: Partial<UpdateInput> = {}): UpdateInput => ({
    url: URL,
    joined: [H_DM, H_STUMM],
    events: [],
    comments: [],
    state: {} as ReadState,
    me: ME,
    roomNames: {},
    profiles: new Map() as never,
    now: NOW,
    ...over,
})

test('/updates shows the resolved conversation title as the row context', () => {
    const rooms = [dmRoom(H_DM, [ME, ALICE]), dmRoom(H_STUMM, [])]
    const items = computeUpdates(
        updateInput({
            state: { [roomKey(URL, H_DM)]: NOW - 3600 } as ReadState,
            events: [nachricht('m1', H_DM, NOW - 60)],
            roomNames: roomNamesOf(rooms),
        }),
    )

    assert.equal(items.length, 1)
    assert.equal(items[0].context, 'Alice', 'die Zeile trug bis P7b den Relay-Namen „DM"')
    assert.equal(items[0].orphan, false)
})

test('an unresolvable conversation stays in the list under "DM" — it does NOT drop out', () => {
    // The trap the docblock at `joinedRoomNames` names itself: a missing key means
    // "orphaned" in `computeUpdates`, and an empty name is the same thing. Both would
    // turn this row into "message no longer available" — a false statement about a live
    // conversation.
    const rooms = [dmRoom(H_DM, [ME, ALICE]), dmRoom(H_STUMM, [])]
    const roomNames = roomNamesOf(rooms)
    assert.equal(roomNames[H_STUMM], 'DM', 'Vorbedingung: der Rückfall steht wirklich in der Karte')

    const items = computeUpdates(
        updateInput({
            state: { [roomKey(URL, H_STUMM)]: NOW - 3600 } as ReadState,
            events: [nachricht('m2', H_STUMM, NOW - 60)],
            roomNames,
        }),
    )

    assert.equal(items.length, 1, 'die Unterhaltung muss eine Zeile behalten')
    assert.equal(items[0].orphan, false)
    assert.equal(items[0].context, 'DM')
})

test('CONTROL: with an empty name the same row DOES become orphaned', () => {
    // Without this case the one above is green for a trivial reason — it would pass just
    // as well if `computeUpdates` never marked anything orphaned at all.
    const items = computeUpdates(
        updateInput({
            state: { [roomKey(URL, H_STUMM)]: NOW - 3600 } as ReadState,
            events: [nachricht('m2', H_STUMM, NOW - 60)],
            roomNames: { [H_STUMM]: '' },
        }),
    )

    assert.equal(items.length, 1)
    assert.equal(items[0].orphan, true, 'der Riegel greift — der Fall darüber ist also nicht trivial grün')
})

// ══ 3. The fold both surfaces share ══════════════════════════════════════════════

test('foldDmRooms: deduplicated by h, dismissed rows out, relay of origin kept', () => {
    const home = { url: 'wss://home/', dmRooms: [dmRoom(H_DM, [ME, ALICE]), dmRoom(H_STUMM, [ME, BOB])] }
    const workspace = { url: 'wss://work/', dmRooms: [dmRoom(H_DM, [ME, ALICE])] }

    const alle = foldDmRooms([home, workspace], [])
    assert.deepEqual(
        alle.map((room) => [room.h, room.spaceUrl]),
        [
            [H_DM, 'wss://home/'],
            [H_STUMM, 'wss://home/'],
        ],
        'die zweite Sicht darf dieselbe Unterhaltung nicht ein zweites Mal einreihen',
    )
    assert.equal(alle.every((room) => room.joined), true)

    const sichtbar = foldDmRooms([home, workspace], [H_DM])
    assert.deepEqual(sichtbar.map((room) => room.h), [H_STUMM], 'ausgeblendet heißt: nicht in der Liste')
    assert.deepEqual(foldDmRooms([null, undefined], []), [], 'eine Sicht, die es noch nicht gibt, wirft nicht')
})

// ══ 4. The wiring — that both surfaces really use the shared resolution ══════════

const befund = (name: string) => liesDatei(join(JS_DIR, name), name)

test('WIRING: bridge.ts and rail.ts both resolve through `dmRoomName` from `dms.ts`', () => {
    for (const datei of ['bridge.ts', 'rail.ts']) {
        const quelle = befund(datei)
        assert.equal(
            importiertAus(quelle, 'dmRoomName', './dms.ts'),
            true,
            `${datei} muss die geteilte Auflösung importieren, statt eine eigene zu bauen`,
        )
        assert.equal(ruftAuf(quelle, 'dmRoomName'), true, `${datei} importiert sie, ruft sie aber nicht auf`)
        // Und der Anstoß, ohne den die Auflösung nichts zu tun hätte. Die Profile kommen
        // NICHT von selbst: `loadSpaceProfiles` läuft nur, wenn eine Fläche danach fragt,
        // und beim Umbau auf `dmRoomName` fiel dieser Aufruf in `rail.ts` zunächst weg —
        // die Namen der Workspace-Unterhaltungen wären für immer gekürzte Schlüssel
        // geblieben, ohne dass irgendetwas rot geworden wäre.
        assert.equal(
            ruftAuf(quelle, 'ensureDmNames'),
            true,
            `${datei} löst die Profile der Teilnehmer nicht aus — die Auflösung liefe ins Leere`,
        )
    }
})

test('WIRING: neither surface builds a second title out of `dmTitle`', () => {
    // `dmTitle` is the rule underneath `roomDisplayName`. A surface that called it
    // directly would be the second resolution path again — with its own fallback, its own
    // limit, and its own idea of what an unresolvable conversation is called.
    for (const datei of ['bridge.ts', 'rail.ts']) {
        const quelle = befund(datei)
        assert.equal(ruftAuf(quelle, 'dmTitle'), false, `${datei} darf den Titel nicht selbst bilden`)
        assert.equal(importiertAus(quelle, 'dmTitle', './dmModels.ts'), false)
    }
})

test('CONTROL: the scanner sees these two files at all', () => {
    // Fail-closed: `ruftAuf(…) === false` is also true for a file the scanner never read.
    // 679 calls were measured in `bridge.ts` and 53 in `rail.ts` on 2026-08-27
    // (`workspaceQuelleGate.MIN_AUFRUFE`); the floor here only has to catch a blind scan.
    assert.ok(befund('bridge.ts').aufrufe.length > 100)
    assert.ok(befund('rail.ts').aufrufe.length > 25)
    // And the negative assertion above is only worth something if the scanner CAN see
    // `dmTitle` — it does, in the module that owns it.
    assert.equal(ruftAuf(befund('dms.ts'), 'dmTitle'), true)
})
