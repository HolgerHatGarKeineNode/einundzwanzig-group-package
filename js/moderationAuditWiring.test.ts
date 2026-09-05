/**
 * **The latch over the WIRING of the moderation history — not over its rules.**
 *   node --test --experimental-strip-types packages/einundzwanzig-group/js/moderationAuditWiring.test.ts
 *
 * Plan: `docs/plans/2026-09-05T0125-community-features-herbst.md`, phase P1.
 *
 * ── Why this exists next to `moderationAuditModels.test.ts` ─────────────────
 *
 * That one proves what the client does with an ANSWER. It cannot see whether the
 * question is ever asked — and that is exactly the defect this phase was opened for: the
 * relay has served `/moderation/audit` all along, the parser could have existed all
 * along, and the only caller in the whole repository was the E2E probe
 * (`tests/e2e/support/buzz-moderation.ts`). A history whose fetch is missing looks, from
 * every other suite, exactly like a relay with nothing to report.
 *
 * The chain has four links and each one is asserted below, because breaking any single
 * one leaves the surface silently empty:
 *
 *   1. `buzzAdmin.buzzLoadAudit` → `buzzModerationFetch('/moderation/audit')`
 *   2. `moderationAudit.ts` (the island) → `buzzLoadAudit`
 *   3. `bridge.ts` → `wireModerationAudit` (without it the island is never registered)
 *   4. the markup → mounts the island AND dispatches the event that starts the fetch
 *
 * ── Why AST and not `grep` ──────────────────────────────────────────────────
 *
 * Not theoretical here: this file's own header names `buzzLoadAudit` three times, and
 * the module headers of `moderationAudit.ts` and `moderationAuditModels.ts` name the
 * route in prose to explain it. A text match would report those explanations as proof.
 * `ts.createSourceFile` sees the tree the compiler sees, and comments are not in it. The
 * scanner is the one from the P6 latch (`workspaceQuelleGate.ts`), reused rather than
 * rebuilt; the Blade half uses the reader of the P4 latch (`moderationSurfaceGate.ts`),
 * because Blade is not JavaScript and no AST scanner reads it.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import ts from 'typescript'
import { readFileSync } from 'node:fs'
import { importiertAus, liesDatei, ruftAuf } from './workspaceQuelleGate.ts'
import { flattenWhitespace, readBlade } from './moderationSurfaceGate.ts'

const JS_DIR = import.meta.dirname
const befund = (name: string) => liesDatei(join(JS_DIR, name), name)

const VIEWS = join(JS_DIR, '..', 'resources', 'views')
const directory = () => readBlade(join(VIEWS, '⚡directory.blade.php'), '⚡directory.blade.php')

/**
 * Does `datei` call `callee(…)` with `literal` among its string arguments?
 *
 * The route path is the one part of this chain that the identifier scanner cannot see:
 * `buzzModerationFetch(url, '/moderation/restricted')` and
 * `buzzModerationFetch(url, '/moderation/audit')` are the same call to it. A history
 * pointed at the wrong route would answer, and answer with the restriction list.
 */
const ruftMitZeichenkette = (datei: string, callee: string, literal: string): boolean => {
    const quelltext = readFileSync(join(JS_DIR, datei), 'utf8')
    const sourceFile = ts.createSourceFile(datei, quelltext, ts.ScriptTarget.Latest, true)
    if (sourceFile.statements.length === 0) {
        throw new Error(`${datei}: keine einzige Anweisung geparst — der Scanner misst hier nichts.`)
    }
    let gefunden = false
    const walk = (node: ts.Node): void => {
        if (
            ts.isCallExpression(node)
            && ts.isIdentifier(node.expression)
            && node.expression.text === callee
            && node.arguments.some((arg) => ts.isStringLiteralLike(arg) && arg.text === literal)
        ) {
            gefunden = true
        }
        ts.forEachChild(node, walk)
    }
    walk(sourceFile)

    return gefunden
}

/**
 * Lower bound of identifier calls the scanner must see in `moderationAudit.ts`.
 *
 * Calibration, not style: without it a broken scanner reports exactly what a clean tree
 * reports — "does not call `buzzLoadAudit`" is also true when nothing was read at all.
 * **Measured 2026-09-05: 6 identifier calls** (`f(…)`, never `obj.f(…)`, which is why the
 * number is far smaller than the file length suggests — an island is mostly methods).
 * The threshold sits at 4: it is meant to catch a blind scanner, not the next edit.
 */
const MIN_CALLS_ISLAND = 4

test('CALIBRATION: the scanner really reads the island', () => {
    const f = befund('moderationAudit.ts')
    assert.ok(
        f.aufrufe.length >= MIN_CALLS_ISLAND,
        `only ${f.aufrufe.length} calls seen (at least ${MIN_CALLS_ISLAND} expected) — the scanner measures nothing here`,
    )
    // And one call that has nothing to do with the claim: otherwise a scanner that only
    // ever finds `buzz*` names would report the same count as a healthy one.
    assert.ok(ruftAuf(f, 'auditDays'), 'the scanner does not see the answer being folded')
})

test('CALIBRATION: the Blade reader really reads the directory screen', () => {
    const markup = flattenWhitespace(directory().active)
    assert.ok(markup.includes('x-data="nostrDirectory"'), 'the directory island is gone — the reader measures nothing here')
    assert.ok(markup.includes('dialog') || markup.includes('flux:modal'), 'no modal markup at all')
})

test('CORE 1: the transport asks `/moderation/audit`, not one of its two neighbours', () => {
    const f = befund('buzzAdmin.ts')
    assert.ok(ruftAuf(f, 'buzzModerationFetch'), 'the authenticated GET is gone')
    assert.ok(
        ruftMitZeichenkette('buzzAdmin.ts', 'buzzModerationFetch', '/moderation/audit'),
        '`buzzLoadAudit` no longer points at the audit route',
    )
    // The parse is the client's, not a raw hand-through: the 403 rule lives there.
    assert.ok(importiertAus(f, 'parseAuditList', './moderationAuditModels.ts'))
    assert.ok(ruftAuf(f, 'parseAuditList'))
})

test('CORE 2: the island really fetches — this is the assertion the mutation probe removes', () => {
    const f = befund('moderationAudit.ts')
    assert.ok(importiertAus(f, 'buzzLoadAudit', './buzzAdmin.ts'), 'the island does not import the fetch')
    assert.ok(ruftAuf(f, 'buzzLoadAudit'), '… and never calls it: the history would stay empty forever')
    // Every failure has to end in the same empty list — that decision is in the pure
    // module, so the island must go through it instead of branching on its own.
    assert.ok(importiertAus(f, 'auditDays', './moderationAuditModels.ts'))
    assert.ok(ruftAuf(f, 'auditDays'))
})

test('CORE 3: the island is registered — an unregistered `x-data` renders nothing', () => {
    const f = befund('bridge.ts')
    assert.ok(importiertAus(f, 'wireModerationAudit', './moderationAudit.ts'), 'bridge.ts does not import the island')
    assert.ok(ruftAuf(f, 'wireModerationAudit'), '… and never wires it into `registerNostrComponents`')
})

test('CORE 4: the markup mounts the island and the trigger starts the fetch', () => {
    const markup = flattenWhitespace(directory().active)
    assert.ok(markup.includes('x-data="nostrModerationAudit"'), 'the history island is not mounted')
    assert.ok(
        markup.includes('x-on:moderation-audit-open.window="load()"'),
        'the island does not listen for the open event',
    )
    assert.ok(
        markup.includes(`x-on:click="$dispatch('moderation-audit-open')"`),
        'the dialog trigger does not dispatch the open event — the history would never be fetched',
    )
})

test('… and zooid is not asked at all: the Buzz check sits in front of the fetch', () => {
    // `/moderation/audit` is Buzz's native API; zooid has no such route. Asking anyway
    // would spend a NIP-98 signature (a bunker roundtrip, a prompt on the device) on a
    // guaranteed 404. The async check, for the reason `loadSpaceReports` states.
    const f = befund('moderationAudit.ts')
    assert.ok(importiertAus(f, 'spaceIsBuzzAsync', './buzzAdmin.ts'))
    assert.ok(ruftAuf(f, 'spaceIsBuzzAsync'))
})

test('COUNTER-PROOF: the scanner does NOT see a name that only stands in a comment', () => {
    // Without this case every assertion above would also be green on a scanner that
    // cannot tell code from prose — and then they would pass on an island that merely
    // *mentions* the fetch. `moderationAudit.ts` names `loadSpaceReports` in its header
    // (as the precedent for the Buzz check) and never calls it; `actionItems.ts` does.
    assert.equal(
        ruftAuf(befund('moderationAudit.ts'), 'loadSpaceReports'),
        false,
        'there the name stands in a comment only',
    )
    assert.ok(ruftAuf(befund('actionItems.ts'), 'loadSpaceReports'), 'a real call of the same name is found')
})
