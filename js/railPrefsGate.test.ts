/**
 * **The workspace boundary of the rail's preference menu — P4 → P6, re-cut in P3 of Concept C.**
 *   node --test --experimental-strip-types packages/einundzwanzig-group/js/railPrefsGate.test.ts
 *
 * Plan: `docs/plans/2026-09-05T0125-community-features-herbst.md`, section
 * "Aus P4 nach P6 uebertragen — entschieden, nicht vergessen".
 *
 * ── What P3 of the navigation revamp changed about this promise ─────────────────
 *
 * The menu carries TWO actions, and since P3 they no longer share one gate:
 *
 * | action | gate | why |
 * |---|---|---|
 * | „Raum stummschalten" | `canSetPrefs` = workspace only | `channel-mutes` is Buzz' blob, keyed by channel UUID. A room of the home space has no key in it, and writing one puts an id there that no other client can resolve. UNCHANGED. |
 * | „Raum anheften" | `canPin` = every row with an `h` | D7 moved pinning to the reader's OWN kind 30078 (`js/pinSet.ts`). `togglePinned` routes by key: workspace → `channel-stars` (shared with Buzz Desktop), everything else → the pin set. No relay has to permit it. |
 *
 * So the cases below no longer assert "both actions behind `canSetPrefs`" — that would now
 * be a false promise. They assert the per-action gate, and the mute half is asserted exactly
 * as strictly as before.
 *
 * ── The hole this closes, measured in P4 ────────────────────────────────────────
 *
 * `canSetPrefs` (`js/rail.ts`) answers whether a rail row may offer the preference menu
 * at all. **Replacing its body with `return true` leaves the ENTIRE suite green.** The
 * predicate underneath it (`isWorkspaceChannel`) has four unit cases of its own, and the
 * write path has `channelPrefsWriteGate.test.ts` — but nothing asserted that the rail
 * still *asks*, and in production this gate is the only per-room check there is:
 * `setChannelFlag` validates the armed WORKSPACE, not the room. Without it a room of the
 * home space could be written into Buzz' blob under an `h` no other client can resolve.
 *
 * ── Two halves, because the gate has two halves ─────────────────────────────────
 *
 * 1. **The predicate still decides something** — AST count of `isWorkspaceChannel` in
 *    `rail.ts`. `return true` drops the count from 2 to 1 and this case falls. The
 *    scanner is `workspaceQuelleGate.ts`; its head carries the reasoning and the two gaps
 *    a text pattern had.
 * 2. **The markup still asks it** — the Blade reader from `moderationSurfaceGate.ts`,
 *    reading the same file the compiler would see (Blade comments stripped). Deleting the
 *    `<template x-if="canSetPrefs(room)">` around the menu is invisible to the AST half,
 *    and it is the more likely edit of the two.
 *
 * ── What this cannot see, in its own words ──────────────────────────────────────
 *
 * The AST half counts names, not meanings: `canSetPrefs` calling `isWorkspaceChannel` and
 * throwing the result away would pass. The Blade half reads text, not a tree: it can say
 * that the toggles stand behind the gate in document order, not that they are inside its
 * subtree. Both are built against the quiet repetition of a pattern, not against
 * deliberate circumvention — the same limit `moderationSurfaceGate.ts` states for itself.
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MIN_AUFRUFE, liesDatei } from './workspaceQuelleGate.ts'
import { flattenWhitespace, readBlade } from './moderationSurfaceGate.ts'

const JS_DIR = dirname(fileURLToPath(import.meta.url))
const ROW_BLADE = join(JS_DIR, '..', 'resources', 'views', 'components', 'rail-room-row.blade.php')

/** The predicate both call sites in `rail.ts` share. */
const PREDICATE = 'isWorkspaceChannel'

/**
 * How many times `rail.ts` must call {@link PREDICATE}, and which places those are.
 *
 * | call site | what a removal breaks in production |
 * |---|---|
 * | `canSetPrefs` | the MUTE entry appears on rooms of the HOME space, and a flag written there lands in Buzz' blob under an `h` Buzz cannot resolve |
 * | `openRoom` | a workspace conversation opens `/rooms/{h}` without `?space=workspace`, i.e. against the home relay: empty history, and a join attempt ends in `invalid: group not found` |
 * | `isPinned` | the pin glyph reads the wrong source for a workspace row: Buzz' star is then invisible in the rail although Buzz Desktop shows it |
 * | `togglePinned` | the pin key of a workspace room carries the SPACE url — a second „angeheftet" truth next to `channel-stars`, exactly what D7 forbids |
 *
 * A count and not "is it called": with one shared predicate, "called at all" stays true
 * when either of the two call sites is deleted. That is the whole failure mode.
 */
const PREDICATE_CALLS = 4

describe('P6 carry-over: the rail still asks whether a room belongs to the workspace', () => {
    // ── Calibration ─────────────────────────────────────────────────────────
    //
    // Without it every claim below is worth nothing: a scanner that read the wrong file,
    // or a Blade reader that got an empty string, reports exactly what a clean tree does.

    test('CALIBRATION: the AST scanner really reads rail.ts', () => {
        const befund = liesDatei(join(JS_DIR, 'rail.ts'), 'rail.ts')
        assert.ok(
            befund.aufrufe.length >= MIN_AUFRUFE,
            `only ${befund.aufrufe.length} calls seen in rail.ts (at least ${MIN_AUFRUFE} expected)`,
        )
        // A call that has nothing to do with this latch.
        assert.ok(befund.aufrufe.includes('openRoomAt'), 'rail.ts does not call openRoomAt() — the scanner reads the wrong file')
    })

    test('CALIBRATION: the Blade reader really reads the rail row, with its menu', () => {
        const row = readBlade(ROW_BLADE, 'rail-room-row.blade.php')
        // The two actions the menu exists for, each exactly once — the count the
        // "behind the gate" case below depends on.
        assert.equal(
            (row.active.match(/togglePinned\(/g) ?? []).length,
            1,
            'rail-room-row.blade.php no longer has exactly one togglePinned( — the order case below measures something else',
        )
        assert.equal((row.active.match(/toggleMuted\(/g) ?? []).length, 1)
    })

    // ── Core ────────────────────────────────────────────────────────────────

    test(`CORE: rail.ts calls ${PREDICATE}() exactly ${PREDICATE_CALLS}x`, () => {
        const befund = liesDatei(join(JS_DIR, 'rail.ts'), 'rail.ts')
        const count = befund.aufrufe.filter((name) => name === PREDICATE).length
        assert.equal(
            count,
            PREDICATE_CALLS,
            `rail.ts calls ${PREDICATE}() ${count}x, expected ${PREDICATE_CALLS}. `
                + `Replacing the body of canSetPrefs with \`return true\` produces exactly this number — `
                + 'and left the whole suite green before this case existed. See the table at PREDICATE_CALLS.',
        )
        // …and it comes from the module that owns the workspace question, not from a
        // second, local copy of the three lines.
        assert.ok(
            befund.importe.some((stelle) => stelle.exportName === PREDICATE),
            `rail.ts does not import ${PREDICATE} — a local re-implementation is a second answer to the same question.`,
        )
    })

    /**
     * **The count above is a deletion detector — and a text comparison is an append trap.**
     *
     * `isWorkspaceChannel(this.workspace, room.h); return true` keeps the count at 2 and
     * turns nothing red: the predicate is asked and its answer thrown away. The first fix
     * for that pinned the whole statement as text — and **that** falls to appending:
     *
     *     return isWorkspaceChannel(this.workspace, room.h) || room.isDm === true
     *
     * The pinned substring stands unchanged, the count stands at 2, and the gate is
     * widened. Found in review on exactly these two sites; measured across all nine sites
     * of this phase on 2026-09-05, six of them were defeated the same way.
     *
     * So the question goes to the AST: `Quellenbefund.werte` reports the FORM of the
     * expression a value is built from. An appended `|| true` makes it a
     * `BinaryExpression||` whose `ruft` is empty, and the site drops out of the set below.
     *
     * | site | what a widened or discarded answer costs |
     * |---|---|
     * | `return canSetPrefs` | the preference menu is back on rooms of the home space — and in production this gate is the only per-room check there is: `setChannelFlag` validates the armed workspace, not the room |
     * | `const isWorkspaceRoom` | a home-space room opens with `?space=workspace` against the wrong relay: empty history, and a join ends in `invalid: group not found` |
     */
    test('CORE: the predicate IS the value — asked of the AST, not of the text', () => {
        const befund = liesDatei(join(JS_DIR, 'rail.ts'), 'rail.ts')
        const stellen = befund.werte
            .filter((stelle) => stelle.ruft === PREDICATE)
            .map((stelle) => `${stelle.art} ${stelle.name} ${stelle.form}`)
            .sort()

        assert.deepEqual(
            stellen,
            ['binding isWorkspaceRoom CallExpression', 'return canSetPrefs CallExpression'],
            `rail.ts: the value sites built from ${PREDICATE}() are [${stellen.join(' | ')}]. Both have to be the `
                + 'call itself — a discarded answer keeps the count at 2, and an appended `|| true` keeps the text '
                + 'comparison green. Neither survives this one: the expression is then a BinaryExpression.',
        )
    })

    /**
     * **Each action behind ITS OWN gate, and the mute half as strictly as before.**
     *
     * The order test is the same construction as before — the gate has to stand BEFORE its
     * action in the active markup. What changed is that there are two gates now, and the
     * dangerous direction is only one of them: a mute written on a home-space room lands in
     * Buzz' blob under an unresolvable id, while a pin written anywhere lands in the reader's
     * own event, which is the whole point of D7.
     */
    test('CORE: the MUTE entry is behind canSetPrefs, the PIN entry behind canPin', () => {
        const row = readBlade(ROW_BLADE, 'rail-room-row.blade.php')
        const muteGate = row.active.indexOf('x-if="canSetPrefs(room)"')
        assert.notEqual(
            muteGate,
            -1,
            'rail-room-row.blade.php no longer wraps the MUTE entry in <template x-if="canSetPrefs(room)">. '
                + 'In production that gate is the ONLY per-room check: setChannelFlag validates the armed '
                + 'workspace, not the room.',
        )
        const pinGate = row.active.indexOf('x-if="canPin(room)"')
        assert.notEqual(pinGate, -1, 'rail-room-row.blade.php no longer wraps the PIN entry in <template x-if="canPin(room)">.')

        assert.ok(
            row.active.indexOf('toggleMuted(') > muteGate,
            'toggleMuted( stands BEFORE the canSetPrefs gate in the active markup — it is not behind it.',
        )
        assert.ok(
            row.active.indexOf('togglePinned(') > pinGate,
            'togglePinned( stands BEFORE the canPin gate in the active markup — it is not behind it.',
        )
        // And the trigger itself only exists when at least one entry does — otherwise a row
        // without any action would still carry a menu button that opens an empty menu.
        assert.ok(row.active.includes('x-if="canPin(room) || canSetPrefs(room)"'))
    })

    test('CORE: both gates are x-if and not x-show', () => {
        // Not cosmetics. An entry that silently does nothing must not be in the tree at all: a
        // screen reader would announce an action with no effect, on every room of the home
        // space. The comments above the templates say so; this is the assertion.
        const row = readBlade(ROW_BLADE, 'rail-room-row.blade.php')
        assert.ok(row.active.includes('<template x-if="canSetPrefs(room)">'))
        assert.ok(row.active.includes('<template x-if="canPin(room)">'))
        assert.equal(row.active.includes('x-show="canSetPrefs(room)"'), false)
        assert.equal(row.active.includes('x-show="canPin(room)"'), false)
    })

    /**
     * **The pin key of a row is built in ONE place** — `roomPinKeyFor` in `js/pinSetSync.ts`.
     *
     * Two call sites in `rail.ts` (`isPinned` and `togglePinned`) and no third way: a row that
     * assembled `'room:' + h + '@' + url` itself would be free to take the url from
     * `activeSpace`, i.e. from the ephemeral workspace override — and then the key of a pinned
     * home-space room would change the moment the user has visited a workspace room. The
     * plan's D7 names exactly that relay set as the one that must NOT be used.
     */
    test('CORE: the rail does not build a pin key of its own', () => {
        const befund = liesDatei(join(JS_DIR, 'rail.ts'), 'rail.ts')
        assert.equal(befund.aufrufe.filter((name) => name === 'roomPinKeyFor').length, 2)
        assert.ok(befund.importe.some((stelle) => stelle.exportName === 'roomPinKeyFor'))
        // Not the low-level builder either: `roomPinKey(h, relay)` takes the relay as an
        // argument, so a call to it here would be a second place that decides which relay
        // belongs into the key. (A text search for `'room:'` would NOT do: the rail carries
        // that prefix for its own target ids, which have nothing to do with pins.)
        assert.equal(befund.aufrufe.filter((name) => name === 'roomPinKey').length, 0)
    })
})
