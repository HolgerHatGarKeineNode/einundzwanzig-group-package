/**
 * **The latch over the WIRING of the bookmark write path — not over its behaviour.**
 *   node --test --experimental-strip-types packages/einundzwanzig-group/js/bookmarkWiring.test.ts
 *
 * ── Why this exists next to `bookmarkModels.test.ts` ────────────────────────
 *
 * The gate itself is covered behaviourally: `planBookmarkWrite` asks it and answers
 * `null`, so `bookmarkModels.test.ts` can prove that an unresolved space produces no
 * event body at all. What that cannot show is whether the store **uses** the planner —
 * a `bookmarks.ts` that assembles its own tag list and publishes that would leave every
 * other suite green while the gate stands beside the road.
 *
 * The same holds for the verdict: publishing through `app.use(Thunks).publish` directly
 * would skip `publishOptimistic`, and with it the rollback of the optimistically
 * inserted event on a relay reject. The bookmark would stay on screen and be gone on
 * the next reload.
 *
 * ── Why AST and not `grep` ──────────────────────────────────────────────────
 *
 * Not theoretical here: `mayWriteKind` appears in this package's comments as often as
 * it appears as code — the module headers of `relayCapability.ts` and `bookmarks.ts`
 * both name it in prose to explain when it is asked. A text match would report those
 * explanations as proof. `ts.createSourceFile` sees the tree the compiler sees, and
 * comments are not in it. The scanner is the one from the P6 latch
 * (`workspaceQuelleGate.ts`), reused rather than rebuilt.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { importiertAus, liesDatei, ruftAuf } from './workspaceQuelleGate.ts'

const JS_DIR = import.meta.dirname
const befund = (name: string) => liesDatei(join(JS_DIR, name), name)

/**
 * Lower bound of identifier calls the scanner must see in `bookmarks.ts`.
 *
 * Calibration, not style: without it a broken scanner reports exactly what a clean tree
 * reports — "does not call `planBookmarkWrite`" is also true when nothing was read at
 * all. **Measured 2026-09-03: 63 identifier calls** (`f(…)`, never `obj.f(…)`, which is
 * why the number is smaller than the file length suggests). The threshold sits at 20:
 * it is meant to catch a blind scanner, not the next refactor.
 */
const MIN_CALLS_BOOKMARKS = 20

test('CALIBRATION: the scanner really reads `bookmarks.ts`', () => {
    const f = befund('bookmarks.ts')
    assert.ok(
        f.aufrufe.length >= MIN_CALLS_BOOKMARKS,
        `only ${f.aufrufe.length} calls seen (at least ${MIN_CALLS_BOOKMARKS} expected) — the scanner measures nothing here`,
    )
    // And one call that has nothing to do with the claim: otherwise a scanner that only
    // ever finds `may*` names would report the same count as a healthy one.
    assert.ok(ruftAuf(f, 'makeEvent'), 'the scanner does not see the event being built')
})

test('CORE: the write path goes through the gated planner, not around it', () => {
    // `planBookmarkWrite` IS the gate on this path: it asks `mayWriteKind` and returns
    // `null` when the answer is no, so an event body only exists once the space kind is
    // resolved. Assembling the tags in the store instead would put the decision back
    // where no test can reach it.
    const f = befund('bookmarks.ts')
    assert.ok(
        importiertAus(f, 'planBookmarkWrite', './bookmarkModels.ts'),
        '`bookmarks.ts` does not import the gated planner',
    )
    assert.ok(ruftAuf(f, 'planBookmarkWrite'), '… and does not call it')

    // And the planner really is gated — otherwise the line above would be satisfied by
    // a function that just builds tags. Checked at the source, not assumed.
    const model = befund('bookmarkModels.ts')
    assert.ok(importiertAus(model, 'mayWriteKind', './relayCapability.ts'))
    assert.ok(ruftAuf(model, 'mayWriteKind'))
})

test('… and the markup mirror asks the same gate, so a dead menu entry never shows', () => {
    // `canBookmark` decides whether the entry is rendered at all. It must come from the
    // same function as the write decision; a second rule here would drift.
    const f = befund('bookmarks.ts')
    assert.ok(importiertAus(f, 'mayWriteKind', './relayCapability.ts'))
    assert.ok(ruftAuf(f, 'mayWriteKind'))
})

test('… and publishes through `publishOptimistic`, which rolls back on a reject', () => {
    // welshman withdraws an optimistically inserted event only on an abort, never on a
    // relay reject (`js/publishOptimistic.ts`). Publishing through `Thunks` directly
    // would leave a rejected bookmark standing on screen until the next reload.
    const f = befund('bookmarks.ts')
    assert.ok(importiertAus(f, 'publishOptimistic', './publishOptimistic.ts'))
    assert.ok(ruftAuf(f, 'publishOptimistic'))
})

test('… and re-reads the list to see whether the relay meant its `OK`', () => {
    // `requestOne` and not `load`: the batched loader de-duplicates by filter, so a
    // merged answer from a batch already in flight would be the state from *before* the
    // write — a confirmation that confirms itself.
    const f = befund('bookmarks.ts')
    assert.ok(ruftAuf(f, 'requestOne'), 'the confirmation read is gone')
    assert.ok(ruftAuf(f, 'writeConfirmed'), 'the answer is fetched but never judged')
})

test('COUNTER-PROOF: the scanner does NOT see a name that only stands in a comment', () => {
    // Without this case the tests above would also be green on a scanner that cannot
    // tell code from prose — and then they would pass on a file that merely *mentions*
    // the gate. `relayCapability.ts` names `deriveSpaceKind` in its header and never
    // calls it; `bookmarks.ts` does call it.
    const gate = befund('relayCapability.ts')
    assert.equal(ruftAuf(gate, 'deriveSpaceKind'), false, 'there the name stands in a comment only')
    assert.ok(ruftAuf(befund('bookmarks.ts'), 'deriveSpaceKind'), 'a real call of the same name is found')
})
