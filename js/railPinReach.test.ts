/**
 * **The left bar subscribes to the pin set in EVERY installation — not only where a Buzz
 * workspace is configured.**
 *   node --experimental-strip-types --test packages/einundzwanzig-group/js/railPinReach.test.ts
 *
 * ── The defect, measured in P6 ────────────────────────────────────────────────────
 *
 * `js/rail.ts` armed `subscribePinned` inside `if (hasWorkspace())`. The pin set is the
 * READER's own kind 30078 and exists without any workspace, but the island only learned
 * about it in the workspace arm: in a space without one — which is every `useZooid()` E2E
 * run and every plain zooid space — `this.pinned` stayed `[]`, `isPinned(room)` was always
 * false, the pin glyph never appeared and the row's menu kept offering „Raum anheften"
 * however often it was pressed. Measured in the P6 run: the store held
 * `["room:welcome@ws://localhost:3335/","area:wallet"]` while the island's `pinned` was
 * `[]`.
 *
 * ── Why a source gate and not a behaviour test ─────────────────────────────────────
 *
 * `rail.ts` is the impure island: it imports welshman and cannot be loaded under
 * `node --test`. The behaviour half is the E2E (`desktop-left-bar.spec.ts` removes the pin
 * through the row's own menu, which is exactly the path that was dead). What no behaviour
 * test on a workspace-configured stack would ever see is the RE-NESTING of this call — the
 * defect is invisible wherever a workspace exists, and that is where most cases run.
 *
 * ── What this gate cannot see, in its own words ────────────────────────────────────
 *
 * It reads one call and its ancestors. A guard written as `if (!hasWorkspace()) return`
 * earlier in the same function, or a wrapper that decides the same thing under another
 * name, walks past it. It measures the shape that actually occurred and the one a later
 * edit would most plausibly restore — an `if` block that a new subscription is tucked into
 * because everything around it lives there.
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'

const JS_DIR = import.meta.dirname
const RAIL = join(JS_DIR, 'rail.ts')

/** The one entry point a surface uses to read the pin set (`js/pinSetSync.ts`). */
const SUBSCRIBE = 'subscribePinned'
/** The predicate whose arm the call must NOT sit in. */
const WORKSPACE_GUARD = 'hasWorkspace'

type Fund = {
    /** How many times {@link SUBSCRIBE} is called in the file. */
    aufrufe: number
    /** How many of those sit inside an `if` whose condition mentions {@link WORKSPACE_GUARD}. */
    imWorkspaceArm: number
}

/**
 * Count the calls and how many of them stand in a workspace-gated branch.
 *
 * **Fail-closed:** a file the parser produces no statements for throws rather than
 * reporting „no calls" — a scanner that is silent when it cannot see is worse than none.
 */
export const zaehleAufrufe = (datei: string, quelltext: string): Fund => {
    const sourceFile = ts.createSourceFile(datei, quelltext, ts.ScriptTarget.Latest, true)
    if (sourceFile.statements.length === 0) {
        throw new Error(`${datei}: not one statement parsed — this scanner measures nothing here.`)
    }
    let aufrufe = 0
    let imWorkspaceArm = 0

    const besuche = (node: ts.Node): void => {
        if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === SUBSCRIBE) {
            aufrufe += 1
            for (let eltern = node.parent; eltern; eltern = eltern.parent) {
                if (
                    ts.isIfStatement(eltern)
                    // `.expression` and not `.condition`: that is what an `IfStatement`
                    // carries in the TypeScript API (`condition` belongs to the ternary).
                    && eltern.expression.getText(sourceFile).includes(WORKSPACE_GUARD)
                    && eltern.thenStatement.getStart(sourceFile) <= node.getStart(sourceFile)
                    && node.getEnd() <= eltern.thenStatement.getEnd()
                ) {
                    imWorkspaceArm += 1
                    break
                }
            }
        }
        ts.forEachChild(node, besuche)
    }
    ts.forEachChild(sourceFile, besuche)

    return { aufrufe, imWorkspaceArm }
}

describe('the rail reaches the pin set without a workspace', () => {
    // ── Calibration: the scanner can tell the two shapes apart ──────────────────────
    test('CALIBRATION: a call inside the workspace arm is seen as such', () => {
        const kaputt = [
            'function init() {',
            '    if (hasWorkspace()) {',
            '        this._unsubPinned = subscribePinned((keys) => { this.pinned = keys })',
            '    }',
            '}',
        ].join('\n')
        assert.deepEqual(zaehleAufrufe('probe.ts', kaputt), { aufrufe: 1, imWorkspaceArm: 1 })
    })

    test('CALIBRATION: the same call outside that arm is not', () => {
        const heil = [
            'function init() {',
            '    if (hasWorkspace()) {',
            '        this._unsubForge = subscribeForgeNav(() => {})',
            '    }',
            '    this._unsubPinned = subscribePinned((keys) => { this.pinned = keys })',
            '}',
        ].join('\n')
        assert.deepEqual(zaehleAufrufe('probe.ts', heil), { aufrufe: 1, imWorkspaceArm: 0 })
    })

    test('FAIL-CLOSED: an unreadable file throws instead of reporting nothing', () => {
        assert.throws(() => zaehleAufrufe('leer.ts', ''), /measures nothing/)
    })

    // ── The measurement ────────────────────────────────────────────────────────────
    test('`rail.ts` arms the pin set outside every workspace branch', () => {
        const fund = zaehleAufrufe('rail.ts', readFileSync(RAIL, 'utf8'))
        assert.equal(fund.aufrufe, 1, `${SUBSCRIBE} must be armed exactly once in the rail`)
        assert.equal(
            fund.imWorkspaceArm,
            0,
            'the pin set is the reader\'s own event — a rail that only reads it where a Buzz '
                + 'workspace is configured shows no pin and offers no „unpin" in every other space',
        )
    })
})
