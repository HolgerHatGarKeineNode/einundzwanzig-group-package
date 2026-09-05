/**
 * P3 — **the chat header of a conversation, and why it needed its own latch.**
 *
 * Run: node --test --experimental-strip-types packages/einundzwanzig-group/js/dmHeaderName.test.ts
 *
 * Plan: `docs/plans/2026-09-05T0125-community-features-herbst.md`, phase P3.
 *
 * ── What was broken ─────────────────────────────────────────────────────────────────
 *
 * `dmRoomNames.test.ts` (P7b) already holds the RULE and the two surfaces that render a
 * room LIST. The chat header is neither: `nostrRoomChat` reads `roomsByUrl`, which holds
 * `Room` — welshman's `readRoomMeta` output — and that reader looks at neither `t` nor
 * `p`. So the header took `room.name` raw and showed the literal `"DM"` /
 * `"Group DM (N)"` the relay stores for every conversation
 * (`buzz-db/src/dm.rs:157-162`), in the page title as well.
 *
 * Every existing wiring assertion stayed GREEN through that defect, and not by accident:
 * `bridge.ts` did import `dmRoomName` and did call `ensureDmNames` — for
 * `joinedRoomNames`, a different surface. "The file calls the shared resolution
 * somewhere" is therefore not a statement about the header, which is why the cases below
 * measure the header's own three links:
 *
 *   1. `dmNameableFromTags` — the two markers lifted out of the raw 39000 tags
 *   2. the header's store dependencies — `dmNames` among them, or the name freezes on
 *      shortened pubkeys the moment the profiles arrive one tick later
 *   3. the assignment itself — `this.roomName` must not be the relay's own string again
 *
 * ── Why AST and not `grep` ──────────────────────────────────────────────────────────
 *
 * The block this file guards explains its own defect in prose and quotes `room.name`,
 * `"DM"` and `dmNames` while doing so. A text match would read those explanations as
 * proof. `ts.createSourceFile` sees the tree the compiler sees; comments are not in it.
 * Same reason and same scanner family as `workspaceQuelleGate.ts` and
 * `calendarWiring.test.ts`.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { dmNameableFromTags, roomDisplayName } from './dmModels.ts'
import { importiertAus, liesDatei, ruftAuf } from './workspaceQuelleGate.ts'

const JS_DIR = import.meta.dirname
const BRIDGE = join(JS_DIR, 'bridge.ts')
const bridgeSource = readFileSync(BRIDGE, 'utf8')
const bridgeTree = ts.createSourceFile('bridge.ts', bridgeSource, ts.ScriptTarget.Latest, true)

/** 64 lowercase hex, one letter each, so the fixtures read at a glance. */
const pk = (c: string): string => c.repeat(64)

const ME = pk('a')
const ALICE = pk('b')
const BOB = pk('c')

const NAMES: Record<string, string> = { [ME]: 'Me', [ALICE]: 'Alice', [BOB]: 'Bob' }
const nameOf = (p: string): string => NAMES[p] ?? ''

/**
 * The tags of a DM's 39000, as the relay writes them (`side_effects.rs:1082-1095`):
 * the `t` marker plus one `p` per participant, next to the noise that is not a marker.
 */
const dmTags = (participants: string[]): string[][] => [
    ['d', '3f1c5b6a-9d2e-4c7b-8a10-6e5d4c3b2a19'],
    ['hidden'],
    ['private'],
    ['t', 'dm'],
    ...participants.map((p) => ['p', p]),
]

// ══ 1. The two markers, lifted out of the raw tags ════════════════════════════════

test('dmNameableFromTags reads the DM marker and the participants off a 39000', () => {
    const nameable = dmNameableFromTags('DM', dmTags([ME, ALICE]))

    assert.equal(nameable.isDm, true)
    assert.deepEqual(nameable.dmParticipants, [ME, ALICE])
    assert.equal(nameable.name, 'DM', 'the relay name has to survive — it is the fallback')
    assert.equal(roomDisplayName(nameable, ME, nameOf), 'Alice')
})

test('an ordinary channel is left alone — no `t:dm`, no resolution', () => {
    // A room whose 39000 carries `p` tags for another reason must NOT become a
    // conversation: the type question is asked at the `t` tag and only there
    // (`roomCategories.parseDmTag`).
    const nameable = dmNameableFromTags('Allgemein', [['p', ALICE], ['t', 'forum']])

    assert.equal(nameable.isDm, false)
    assert.equal(roomDisplayName(nameable, ME, nameOf), 'Allgemein')
})

test('a group conversation names its counterparties, the viewer is not one of them', () => {
    const nameable = dmNameableFromTags('Group DM (3)', dmTags([ME, ALICE, BOB]))

    assert.equal(roomDisplayName(nameable, ME, nameOf), 'Alice, Bob')
})

test('no tags at all ⇒ the relay name stands, and nothing throws', () => {
    // The warm-render race: `roomsByUrl` knows the room before its event is in the
    // repository. `room?.event?.tags` is then empty and the header must simply keep the
    // name it has, not blank out — an empty room name means ORPHANED downstream
    // (`updates.ts`, and the docblock at `roomDisplayName` says so).
    const nameable = dmNameableFromTags('DM', [])

    assert.equal(nameable.isDm, false)
    assert.deepEqual(nameable.dmParticipants, [])
    assert.equal(roomDisplayName(nameable, ME, nameOf), 'DM')
})

// ══ 2. The header's own store dependencies ═══════════════════════════════════════

/**
 * The identifier lists of every `derived([…], …)` in a file.
 *
 * Only array literals of plain identifiers are collected — that is the shape every
 * multi-store derivation in this package uses, and a shape the scanner can decide
 * without evaluating anything.
 */
const derivedStoreLists = (tree: ts.Node): string[][] => {
    const lists: string[][] = []
    const walk = (node: ts.Node): void => {
        if (
            ts.isCallExpression(node)
            && ts.isIdentifier(node.expression)
            && node.expression.text === 'derived'
            && node.arguments.length > 0
            && ts.isArrayLiteralExpression(node.arguments[0])
        ) {
            const elements = node.arguments[0].elements
            if (elements.every(ts.isIdentifier)) {
                lists.push(elements.map((element) => (element as ts.Identifier).text))
            }
        }
        ts.forEachChild(node, walk)
    }
    walk(tree)

    return lists
}

test('CALIBRATION: the scanner really sees the derivations of `bridge.ts`', () => {
    // Fail-closed: "no list contains `dmNames`" is also true for a file that was never
    // parsed. 2597 unit tests do not help if this scanner reads an empty tree.
    //
    // The floor is MEASURED, not guessed (2026-09-05): `bridge.ts` holds five `derived(`
    // calls, four of them over an array literal, three of those over plain identifiers.
    // Most of this island's reactivity runs through `.subscribe` on a single store, which
    // is why the number is small in an 9 200-line file.
    const lists = derivedStoreLists(bridgeTree)
    assert.ok(lists.length >= 3, `only ${lists.length} store lists found — the scanner is blind here`)
    assert.ok(
        lists.some((list) => list.includes('activeSpaceView') && list.includes('dmNames')),
        'the P7b derivation `joinedRoomNames` is missing — the scanner is measuring the wrong tree',
    )
})

/**
 * The header's own subscription: `derived([roomsByUrl, dmNames, pubkey], …).subscribe(…)`.
 *
 * Scoping the assertions to THIS node is the whole point of the file. `bridge.ts` imports
 * `dmRoomName` and calls `ensureDmNames` for `joinedRoomNames` as well, so a file-wide
 * "is it called anywhere" question answers yes even while the header is broken — which is
 * precisely the state the repository was in before this phase.
 */
const headerSubscription = (tree: ts.SourceFile): ts.CallExpression | null => {
    let found: ts.CallExpression | null = null
    const walk = (node: ts.Node): void => {
        if (
            ts.isCallExpression(node)
            && ts.isPropertyAccessExpression(node.expression)
            && node.expression.name.text === 'subscribe'
            && ts.isCallExpression(node.expression.expression)
        ) {
            const [list] = derivedStoreLists(node.expression.expression)
            if (list && list.length === 3 && list.includes('roomsByUrl') && list.includes('dmNames')) {
                found = node
            }
        }
        ts.forEachChild(node, walk)
    }
    walk(tree)

    return found
}

/** Is `name` called anywhere inside this subtree? */
const callsInside = (node: ts.Node, name: string): boolean => {
    let hit = false
    const walk = (child: ts.Node): void => {
        if (ts.isCallExpression(child) && ts.isIdentifier(child.expression) && child.expression.text === name) {
            hit = true
        }
        ts.forEachChild(child, walk)
    }
    walk(node)

    return hit
}

test('the chat header derives over `roomsByUrl` AND `dmNames` AND `pubkey`', () => {
    // All three or the header is wrong in a way nothing else notices:
    //  - without `roomsByUrl` there is no room,
    //  - without `pubkey` the viewer counts as their own counterparty,
    //  - without `dmNames` the name is a SNAPSHOT. The profiles arrive after the mount,
    //    so the header would keep the shortened keys it computed on the first tick —
    //    visibly wrong, and green in every test that only looks at the rule.
    const lists = derivedStoreLists(bridgeTree)
    assert.ok(
        lists.some(
            (list) => list.length === 3
                && list.includes('roomsByUrl')
                && list.includes('dmNames')
                && list.includes('pubkey'),
        ),
        'no derivation over exactly [roomsByUrl, dmNames, pubkey] — the room header is not wired to the profiles',
    )
})

// ══ 3. The assignment itself ═════════════════════════════════════════════════════

/** The source text of every right-hand side of an assignment to `this.roomName`. */
const roomNameAssignments = (tree: ts.SourceFile): string[] => {
    const found: string[] = []
    const walk = (node: ts.Node): void => {
        if (
            ts.isBinaryExpression(node)
            && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
            && ts.isPropertyAccessExpression(node.left)
            && node.left.name.text === 'roomName'
            && node.left.expression.kind === ts.SyntaxKind.ThisKeyword
        ) {
            found.push(node.right.getText(tree))
        }
        ts.forEachChild(node, walk)
    }
    walk(tree)

    return found
}

test('the header assigns a RESOLVED name, never the relay string it got', () => {
    const assignments = roomNameAssignments(bridgeTree)
    assert.equal(assignments.length, 1, `expected exactly one \`this.roomName = …\`, found ${assignments.length}`)
    assert.equal(
        /\bname\b/.test(assignments[0]),
        false,
        `\`this.roomName = ${assignments[0]}\` puts the relay's own field on screen again — `
            + 'for a conversation that string is "DM" for everyone (`buzz-db/src/dm.rs:157-162`)',
    )
})

test('WIRING: `bridge.ts` lifts the markers with the shared helper', () => {
    // Without this call the derivation above could hold `dmNames` and still hand
    // `dmRoomName` a row with no `isDm` — which returns `room.name` unchanged. The
    // header would be exactly as broken as before, with every other assertion green.
    const quelle = liesDatei(BRIDGE, 'bridge.ts')
    assert.equal(importiertAus(quelle, 'dmNameableFromTags', './dmModels.ts'), true)
    assert.equal(ruftAuf(quelle, 'dmNameableFromTags'), true)
})

test('WIRING: the header itself resolves, and asks for the profiles it resolves against', () => {
    const header = headerSubscription(bridgeTree)
    assert.ok(header, 'the header subscription is gone — nothing below this line measures anything')
    // Scoped to the header node, not to the file: both names are used by
    // `joinedRoomNames` too, so the file-wide question is green either way.
    assert.equal(callsInside(header, 'dmNameableFromTags'), true, 'the header never asks whether this is a DM')
    assert.equal(callsInside(header, 'dmRoomName'), true, 'the header does not run the shared resolution')
    // `ensureDmNames` is what makes `loadSpaceProfiles` run. Without it the table stays
    // empty and every name falls back to a shortened key — for good, because on this
    // surface nothing else asks for those profiles: the rail does not exist in the
    // NativePHP host and not below `xl` in the browser.
    assert.equal(callsInside(header, 'ensureDmNames'), true, 'the participants profiles are never requested')
})
