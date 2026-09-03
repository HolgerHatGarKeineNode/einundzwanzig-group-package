/**
 * **The latch over the WIRING of the timed suspension — not over its behaviour.**
 *   node --test --experimental-strip-types packages/einundzwanzig-group/js/moderationTimeoutWiring.test.ts
 *
 * ── Why this exists next to `moderationTimeoutModels.test.ts` ───────────────
 *
 * The rules are covered behaviourally there: `planTimeout` asks the write gate and
 * answers `null`, so a 9042 without an expiration and a 9042 on a zooid space provably
 * produce no event body. What that cannot show is whether the facade **uses** the
 * planner. A `members.ts` that assembled its own `[['p', …]]` and published it would
 * leave every other suite green while the gate stands beside the road — and the event
 * that then lands on a zooid relay is stored forever and read by nobody.
 *
 * The same holds one layer up: an island that called `buzzTimeoutPubkey` directly would
 * skip the facade and with it the gate.
 *
 * ── Why AST and not `grep` ──────────────────────────────────────────────────
 *
 * Measurably necessary here, not theoretical: this phase's modules name `mayWriteKind`,
 * `planTimeout` and the relay's own `extract_expiration(event)` in prose to explain when
 * each is asked. A text match reports those explanations as proof. `ts.createSourceFile`
 * sees the tree the compiler sees, and comments are not in it. The scanner is the one
 * from the P6 latch (`workspaceQuelleGate.ts`), reused rather than rebuilt.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { importiertAus, liesDatei, ruftAuf } from './workspaceQuelleGate.ts'

const JS_DIR = import.meta.dirname
const befund = (name: string) => liesDatei(join(JS_DIR, name), name)

/**
 * Lower bounds of identifier calls the scanner must see.
 *
 * Calibration, not style: without them a broken scanner reports exactly what a clean tree
 * reports — "does not call `planTimeout`" is also true when nothing was read at all.
 * **Measured 2026-09-03:** `members.ts` 129, `buzzAdmin.ts` 29, `bridge.ts` 691. Counted
 * are calls through an IDENTIFIER (`f(…)`), never through a property (`this.f(…)`), which
 * is why the numbers are far smaller than the file lengths suggest. The thresholds sit
 * well below the measurement: they are meant to catch a blind scanner, not the next
 * refactor.
 */
const MIN_CALLS = { 'members.ts': 60, 'buzzAdmin.ts': 15, 'bridge.ts': 200 }

test('CALIBRATION: the scanner really reads all three files', () => {
    for (const [name, floor] of Object.entries(MIN_CALLS)) {
        const f = befund(name)
        assert.ok(f.aufrufe.length >= floor, `${name}: only ${f.aufrufe.length} calls seen (at least ${floor} expected)`)
    }
    // And one call per file that has nothing to do with the claim: otherwise a scanner
    // that only ever finds `plan*`/`may*` names would report the same counts as a healthy
    // one.
    // `shortNpub` and not `nip19.npubEncode`: the scanner counts identifier calls, never
    // property calls — a neutral anchor has to be one it can actually see.
    assert.ok(ruftAuf(befund('members.ts'), 'shortNpub'))
    assert.ok(ruftAuf(befund('buzzAdmin.ts'), 'makeEvent'))
    assert.ok(ruftAuf(befund('bridge.ts'), 'dispatchModal'))
})

test('CORE: the write path goes through the gated planner, not around it', () => {
    // `planTimeout` IS the gate on this path: it asks `mayWriteKind` and returns `null`
    // when the answer is no, so an event body only exists once the space is known to be a
    // Buzz space. Assembling the tags in the facade instead would put the decision back
    // where no test can reach it.
    const facade = befund('members.ts')
    assert.ok(
        importiertAus(facade, 'planTimeout', './moderationTimeoutModels.ts'),
        '`members.ts` does not import the gated planner',
    )
    assert.ok(ruftAuf(facade, 'planTimeout'), '… and does not call it')
    assert.ok(importiertAus(facade, 'planUntimeout', './moderationTimeoutModels.ts'))
    assert.ok(ruftAuf(facade, 'planUntimeout'))

    // And the planner really is gated — otherwise the lines above would be satisfied by a
    // function that just builds tags. Checked at the source, not assumed.
    const model = befund('moderationTimeoutModels.ts')
    assert.ok(importiertAus(model, 'mayWriteKind', './relayCapability.ts'))
    assert.ok(ruftAuf(model, 'mayWriteKind'))

    // … and its result is what goes on the wire.
    assert.ok(importiertAus(facade, 'buzzTimeoutPubkey', './buzzAdmin.ts'))
    assert.ok(ruftAuf(facade, 'buzzTimeoutPubkey'))
    assert.ok(ruftAuf(facade, 'buzzUntimeoutPubkey'))
})

test('… and the island uses the facade instead of the relay arm', () => {
    // Calling `buzzTimeoutPubkey` from the island would skip the facade and with it the
    // planner — the one place the gate is asked.
    const island = befund('bridge.ts')
    assert.ok(importiertAus(island, 'timeoutSpaceMember', './members.ts'))
    assert.ok(ruftAuf(island, 'timeoutSpaceMember'), 'the island does not call the facade')
    assert.ok(ruftAuf(island, 'untimeoutSpaceMember'))
    assert.equal(ruftAuf(island, 'buzzTimeoutPubkey'), false, 'the island reaches past the facade')
    assert.equal(ruftAuf(island, 'buzzUntimeoutPubkey'), false)
})

test('… and the markup mirror asks the same gate, so a dead menu entry never shows', () => {
    // `canTimeout` decides whether the entry is rendered at all. It must come from the same
    // function as the write decision; a second rule ("is this Buzz?") would drift, and the
    // result would be a button that is guaranteed to do nothing.
    const island = befund('bridge.ts')
    assert.ok(importiertAus(island, 'mayWriteKind', './relayCapability.ts'))
    assert.ok(ruftAuf(island, 'mayWriteKind'))
    assert.ok(importiertAus(island, 'BUZZ_TIMEOUT', './moderationTimeoutModels.ts'))
})

test('CORE: the restriction list is parsed by the function that separates 403 from empty', () => {
    // Without this the `catch { return [] }` could come back unnoticed: the pure parser
    // would still be correct and its own suite still green, while the surface reports "no
    // restrictions" to a moderator who simply may not ask.
    const arm = befund('buzzAdmin.ts')
    assert.ok(importiertAus(arm, 'parseRestrictionList', './moderationTimeoutModels.ts'))
    assert.ok(ruftAuf(arm, 'parseRestrictionList'), '`buzzLoadRestricted` no longer parses through the gate')

    const facade = befund('members.ts')
    assert.ok(ruftAuf(facade, 'buzzLoadRestricted'), 'the Buzz arm of the restriction list is gone')

    const island = befund('bridge.ts')
    assert.ok(ruftAuf(island, 'loadRestrictedMembers'), 'the island no longer loads the restriction list')
})

test('COUNTER-PROOF: the scanner does NOT see a name that only stands in a comment', () => {
    // Without this case every assertion above would also be green on a scanner that cannot
    // tell code from prose. `moderationTimeoutModels.ts` quotes the relay's own
    // `extract_expiration(event)?…` in its header — call syntax and all — and never calls
    // it; `mayWriteKind` stands in the same header AND in the code.
    const model = befund('moderationTimeoutModels.ts')
    assert.equal(ruftAuf(model, 'extract_expiration'), false, 'there the name stands in a comment only')
    assert.ok(ruftAuf(model, 'mayWriteKind'), 'a real call in the same file is found')
})
