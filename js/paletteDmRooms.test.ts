/**
 * P3 — **the conversations in the command palette.**
 *
 * Run: node --test --experimental-strip-types packages/einundzwanzig-group/js/paletteDmRooms.test.ts
 *
 * Plan: `docs/plans/2026-09-05T0125-community-features-herbst.md`, phase P3.
 *
 * ── What was missing ────────────────────────────────────────────────────────────────
 *
 * `SpaceView` has carried three pots since P7 — `userRooms`, `otherRooms` and `dmRooms`
 * — and the palette read two of them. A conversation was therefore reachable through the
 * rail (desktop only, `xl` and up) and through `/updates`, but ⌘K, the one entry point
 * that exists on EVERY width, did not list it at all. Its messages did show up in the
 * workspace search, which made the gap read like a bug in the search: you found the
 * sentence and not the place it was said.
 *
 * ── Why these cases drive the real getter ───────────────────────────────────────────
 *
 * `createPalette()` returns a plain object; its getters run without Alpine, without a
 * browser and without a relay. So this file asserts what the palette really produces,
 * not what a copy of its rules would produce. The two places that must stay away from
 * the network are handled by the fixtures, not by mocks: `ensureDmNames` sends nothing
 * for a view without a URL and nothing for a room without participants
 * (`dms.ts`, `spaceProfiles.loadSpaceProfiles`).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { roomGroupKey, type PaletteRoom } from './paletteItems.ts'

/**
 * A workspace has to EXIST before `palette.ts` is evaluated — `WORKSPACE_URL` is a
 * module constant read once off `globalThis` (`spaceCaps.ts:115`), and `instantHits`
 * returns an empty list without it. Same construction and same reason as the
 * `__nostrCalendarAuthors` handover in `calendarWiring.test.ts`.
 */
const WORKSPACE = 'ws://localhost:3001/'
;(globalThis as { __nostrWorkspace?: string }).__nostrWorkspace = WORKSPACE

const { createPalette } = await import('./palette.ts')

/** 64 lowercase hex, one letter each, so the fixtures read at a glance. */
const pk = (c: string): string => c.repeat(64)

const ME = pk('a')
const ALICE = pk('b')
const BOB = pk('c')

const H_ALICE = '3f1c5b6a-9d2e-4c7b-8a10-6e5d4c3b2a19'
const H_GROUP = '00000000-1111-2222-3333-444444444444'

const NAMES: Record<string, string> = { [ALICE]: 'Alice', [BOB]: 'Bob' }

/** A conversation exactly as `buildSpaceView` puts it into `SpaceView.dmRooms`. */
const dmRoom = (h: string, participants: string[], name = 'DM') => ({
    h,
    name,
    about: '',
    picture: '',
    locked: false,
    isDm: true,
    dmParticipants: participants,
    lastMessageAt: null,
})

const room = (h: string, name: string) => ({ h, name, about: '', picture: '', locked: false, lastMessageAt: null })

/**
 * A space view reduced to what the palette reads.
 *
 * `url: ''` is the default on purpose: `ensureDmNames` skips a view without a URL
 * entirely, so no fixture reaches for a relay. The two cases that need a real URL say so.
 */
const view = (over: Record<string, unknown> = {}) => ({
    url: '',
    label: '',
    userRooms: [],
    otherRooms: [],
    dmRooms: [],
    ...over,
}) as never

/** A palette with the profile table already filled — the state after the first profiles. */
const palette = (over: Record<string, unknown> = {}) => {
    const state = createPalette()
    Object.assign(state, { _dmNames: NAMES, _me: ME }, over)

    return state
}

// ══ 1. The conversations reach the room section at all ═══════════════════════════

test('a conversation of the workspace shows up in the palette room list', () => {
    const state = palette({
        _workspace: view({ dmRooms: [dmRoom(H_ALICE, [ME, ALICE])] }),
    })

    const rows = state.roomItems
    assert.deepEqual(rows.map((r: PaletteRoom) => r.h), [H_ALICE], 'the third pot never reaches the list')
})

test('a conversation is listed under its PARTICIPANTS, not under the relay word', () => {
    // Flux filters over `textContent`: a row named "DM" is findable as "DM" and as
    // nothing else. With forty conversations that is forty identical rows.
    const state = palette({
        _workspace: view({
            dmRooms: [dmRoom(H_ALICE, [ME, ALICE]), dmRoom(H_GROUP, [ME, ALICE, BOB], 'Group DM (3)')],
        }),
    })

    const byH = new Map(state.roomItems.map((r: PaletteRoom) => [r.h, r.name]))
    assert.equal(byH.get(H_ALICE), 'Alice')
    assert.equal(byH.get(H_GROUP), 'Alice, Bob')
})

test('an unresolvable conversation keeps the relay name — it does not vanish', () => {
    // The fallback is `room.name`, never `''` (`dmModels.roomDisplayName`). A row with an
    // empty name would be filterable by nothing and clickable into a room whose label the
    // toast then reports as the bare uuid.
    const state = palette({
        _workspace: view({ dmRooms: [dmRoom(H_ALICE, [])] }),
    })

    assert.deepEqual(state.roomItems.map((r: PaletteRoom) => r.name), ['DM'])
})

// ══ 2. The fold — deduplicated, dismissed rows out ═══════════════════════════════

test('the same conversation on both views is listed ONCE', () => {
    // The home space MAY be the workspace. Two rows with the same `h` are swallowed
    // silently by Alpine's `:key`, so the duplicate would not even be visible as one.
    const both = [dmRoom(H_ALICE, [ME, ALICE])]
    const state = palette({
        _space: view({ dmRooms: both }),
        _workspace: view({ dmRooms: both }),
    })

    assert.equal(state.roomItems.filter((r: PaletteRoom) => r.h === H_ALICE).length, 1)
})

test('a conversation the viewer put away (41012) is not offered again', () => {
    const state = palette({
        _workspace: view({ dmRooms: [dmRoom(H_ALICE, [ME, ALICE]), dmRoom(H_GROUP, [ME, BOB])] }),
        _hiddenDms: [H_ALICE],
    })

    assert.deepEqual(state.roomItems.map((r: PaletteRoom) => r.h), [H_GROUP])
})

// ══ 3. The relay of origin — what `openRoom` acts on ═════════════════════════════

test('a workspace conversation is marked as such, a home one is not', () => {
    // `openRoom` reads exactly this flag: it decides whether the ephemeral space is set
    // and whether the href goes through `workspaceRoomHref`. Wrong flag = the room loads
    // against the wrong relay.
    //
    // No participants in these fixtures on purpose: with a real URL `ensureDmNames` would
    // otherwise ask the relay, and this case is about the origin, not about names.
    const state = palette({
        _space: view({ url: 'wss://home/', dmRooms: [dmRoom(H_ALICE, [])] }),
        _workspace: view({ url: WORKSPACE, dmRooms: [dmRoom(H_GROUP, [])] }),
    })

    const byH = new Map(state.roomItems.map((r: PaletteRoom) => [r.h, r.workspace]))
    assert.equal(byH.get(H_GROUP), true, 'the workspace conversation lost its origin')
    assert.equal(byH.get(H_ALICE), false, 'a home conversation must not switch the space')
})

// ══ 4. The scope — `d:` has to find them ═════════════════════════════════════════

test('`d:` narrows to the conversations, `f:` no longer swallows them', () => {
    // Conversations exist only on Buzz, and Buzz IS the workspace. Without the `isDm`
    // precedence in `roomGroupKey` every conversation counted as a workspace room: `d:`
    // stayed empty for good and `f:` mixed channels with conversations.
    const dm = { h: H_ALICE, name: 'Alice', isDm: true, workspace: true } as PaletteRoom
    const channel = { h: 'general', name: 'General', workspace: true } as PaletteRoom

    assert.equal(roomGroupKey(dm), 'dms')
    assert.equal(roomGroupKey(channel), 'workspace')

    // And through the real getter: `d:` leaves the ordinary channel out.
    const state = palette({
        _workspace: view({ userRooms: [room('general', 'General')], dmRooms: [dmRoom(H_ALICE, [ME, ALICE])] }),
        scope: { section: 'rooms', group: 'dms', country: '' },
    })
    assert.deepEqual(state.roomItems.map((r: PaletteRoom) => r.h), [H_ALICE])

    // The counter-direction is NOT asserted through `roomItems`: `w:`/`f:` deliberately
    // produces no Flux option at all (`visibleSections`, so that Enter runs the relay
    // search instead of opening the first row). Its half of the question is the instant
    // hits below.
})

// ══ 5. The instant hits of the workspace search ══════════════════════════════════

test('the workspace search finds a conversation by a participant name', () => {
    // The other half of the same gap: `w:` searched the loaded stock of the workspace and
    // its room list left the conversations out. The messages of a conversation were
    // findable there, the conversation itself was not.
    const state = palette({
        _workspace: view({ dmRooms: [dmRoom(H_ALICE, [ME, ALICE])] }),
        scope: { section: 'rooms', group: 'workspace', country: '' },
        query: 'Alice',
    })

    const hits = state.instantHits
    assert.equal(hits.length, 1, 'no instant hit — the conversation is invisible in the workspace scope')
    assert.equal(hits[0].sort, 'room')
    assert.equal(hits[0].h, H_ALICE)
    assert.equal(hits[0].name, 'Alice')
})

test('CONTROL: the same search finds nothing under the relay word', () => {
    // Without this the case above would also be green if the row were called "DM" and the
    // search matched something else entirely.
    const state = palette({
        _workspace: view({ dmRooms: [dmRoom(H_ALICE, [ME, ALICE])] }),
        scope: { section: 'rooms', group: 'workspace', country: '' },
        query: 'Group DM',
    })

    assert.deepEqual(state.instantHits, [])
})

// ══ 6. The nudge on the surface that has no room rows ════════════════════════════

/**
 * Whether a named getter of `palette.ts` calls a named method on itself.
 *
 * Source level and not behaviour, because the effect of the missing call is invisible
 * here: `ensureDmNames` deduplicates in a module-level set, and what it triggers
 * (`loadSpaceProfiles`) needs a relay. The consequence only shows on a device — the
 * conversations in the workspace search would be called `npub1…` for good.
 */
const getterCalls = (getterName: string, method: string): boolean => {
    const source = readFileSync(join(import.meta.dirname, 'palette.ts'), 'utf8')
    const tree = ts.createSourceFile('palette.ts', source, ts.ScriptTarget.Latest, true)
    let found: ts.GetAccessorDeclaration | ts.MethodDeclaration | null = null
    const find = (node: ts.Node): void => {
        if (
            (ts.isGetAccessorDeclaration(node) || ts.isMethodDeclaration(node))
            && ts.isIdentifier(node.name)
            && node.name.text === getterName
        ) {
            found = node
        }
        ts.forEachChild(node, find)
    }
    find(tree)
    assert.ok(found, `\`${getterName}\` is gone from palette.ts — this case measures nothing`)

    let hit = false
    const scan = (node: ts.Node): void => {
        if (
            ts.isCallExpression(node)
            && ts.isPropertyAccessExpression(node.expression)
            && node.expression.name.text === method
        ) {
            hit = true
        }
        ts.forEachChild(node, scan)
    }
    scan(found)

    return hit
}

test('both surfaces ask for the participant profiles — the room list AND the workspace search', () => {
    // `w:` produces no room row at all by design, so `_dmItems` never runs there. The
    // instant hits are the only thing on that surface, and they show conversations since
    // this phase — without their own nudge they would show shortened keys.
    assert.equal(getterCalls('_dmItems', '_nudgeDmNames'), true)
    assert.equal(getterCalls('instantHits', '_nudgeDmNames'), true)
})

test('CONTROL: the scanner can tell a getter that does NOT call it', () => {
    assert.equal(getterCalls('roomItems', '_nudgeDmNames'), false, 'roomItems goes through `_dmItems`, not directly')
    assert.equal(getterCalls('_dmItems', 'thisMethodDoesNotExist'), false)
})

// ══ 7. Where the three ingredients of a DM name come from ════════════════════════

/** The identifiers a named method of `palette.ts` mentions. */
const namesUsedIn = (methodName: string): Set<string> => {
    const source = readFileSync(join(import.meta.dirname, 'palette.ts'), 'utf8')
    const tree = ts.createSourceFile('palette.ts', source, ts.ScriptTarget.Latest, true)
    let found: ts.MethodDeclaration | null = null
    const find = (node: ts.Node): void => {
        if (ts.isMethodDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === methodName) {
            found = node
        }
        ts.forEachChild(node, find)
    }
    find(tree)
    assert.ok(found, `\`${methodName}\` is gone from palette.ts — this case measures nothing`)

    const used = new Set<string>()
    const scan = (node: ts.Node): void => {
        if (ts.isIdentifier(node)) {
            used.add(node.text)
        }
        ts.forEachChild(node, scan)
    }
    scan(found)

    return used
}

test('the palette subscribes to the profile table, the hidden set and the viewer', () => {
    // The three fields the tests above SET by hand. Nothing in this file would notice if
    // the subscription that fills them in production disappeared: every conversation
    // would then be called `npub1…`, every dismissed one would come back, and the viewer
    // would count as their own counterparty. Source level, because `_ensureData` opens
    // relay subscriptions and cannot run in a unit test.
    const used = namesUsedIn('_ensureData')
    for (const name of ['dmNames', 'hiddenDms', 'pubkey', '_unsubDms']) {
        assert.ok(used.has(name), `_ensureData no longer mentions \`${name}\` — the DM names are never filled`)
    }
    // And it is given back. `wire:navigate` rebuilds this island on every navigation, so a
    // subscription that is never released is one more live derivation per page view.
    assert.ok(namesUsedIn('destroy').has('_unsubDms'), 'the DM subscription is never unsubscribed')
})

test('CONTROL: the same scanner does NOT find a name that is absent', () => {
    const used = namesUsedIn('_ensureData')
    assert.equal(used.has('thisIdentifierDoesNotExist'), false)
    // And it really reads a body: `_ensureData` is the wiring method, it has to mention
    // the subscriptions it was already known for.
    assert.ok(used.has('watchSpaceRooms') && used.has('deriveSpaceViewFor'))
})
