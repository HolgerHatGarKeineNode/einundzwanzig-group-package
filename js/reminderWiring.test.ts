/**
 * **The latch over the WIRING of the reminder write path — not over its behaviour.**
 *   node --test --experimental-strip-types packages/einundzwanzig-group/js/reminderWiring.test.ts
 *
 * ── Why this exists next to `reminderModels.test.ts` ────────────────────────
 *
 * The gate itself is covered behaviourally: `planReminder` asks it and answers `null`, so
 * `reminderModels.test.ts` can prove that an unresolved space, a zooid space or a relay
 * without `nip-er` produces no plan at all. What that cannot show is whether the store
 * **uses** the planner — a `reminders.ts` that assembled its own tag list and published
 * that would leave every other suite green while the gate stood beside the road. Exactly
 * the construction P2–P4 latched for the same reason.
 *
 * ── And one promise that only an AST can carry here ─────────────────────────
 *
 * The confidentiality promise of this phase is *"`.content` is a NIP-44 ciphertext to the
 * author's own key"*. `buildReminderEvent` guarantees that for everything that goes
 * through it (`reminderModels.test.ts` measures the round trip and the two refusals), but
 * a store could bypass it: `makeEvent(30300, {content: plan.plaintext, …})` type-checks,
 * runs, publishes — and puts the user's private note on a relay in the clear. No test of
 * a pure function can see that, and no behavioural test of the store would go red: the
 * reminder would work perfectly, it would just be readable by the relay.
 *
 * So the last case below reads every `makeEvent(…)` in `reminders.ts` out of the syntax
 * tree and insists that its `content` comes from the return value of
 * `buildReminderEvent` — never from the plan.
 *
 * ── Why AST and not `grep` ──────────────────────────────────────────────────
 *
 * Not theoretical here: `mayWriteKind`, `planReminder` and `buildReminderEvent` appear in
 * this package's comments as often as they appear as code — the module headers of
 * `relayCapability.ts`, `reminderModels.ts` and `reminders.ts` all name them in prose to
 * explain when they are asked. A text match would report those explanations as proof.
 * `ts.createSourceFile` sees the tree the compiler sees, and comments are not in it. The
 * scanner is the one from the P6 latch (`workspaceQuelleGate.ts`), reused rather than
 * rebuilt.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'
import { importiertAus, liesDatei, ruftAuf } from './workspaceQuelleGate.ts'

const JS_DIR = import.meta.dirname
const befund = (name: string) => liesDatei(join(JS_DIR, name), name)

/**
 * Lower bound of identifier calls the scanner must see in `reminders.ts`.
 *
 * Calibration, not style: without it a broken scanner reports exactly what a clean tree
 * reports — "does not call `planReminder`" is also true when nothing was read at all.
 * **Measured 2026-09-03: 68 identifier calls** (`f(…)`, never `obj.f(…)`, which is why
 * the number is smaller than the file length suggests). The threshold sits at 20: it is
 * meant to catch a blind scanner, not the next refactor.
 */
const MIN_CALLS_REMINDERS = 20

test('CALIBRATION: the scanner really reads `reminders.ts`', () => {
    const f = befund('reminders.ts')
    assert.ok(
        f.aufrufe.length >= MIN_CALLS_REMINDERS,
        `only ${f.aufrufe.length} calls seen (at least ${MIN_CALLS_REMINDERS} expected) — the scanner measures nothing here`,
    )
    // And one call that has nothing to do with the claim: otherwise a scanner that only
    // ever finds `plan*`/`may*` names would report the same count as a healthy one.
    assert.ok(ruftAuf(f, 'makeEvent'), 'the scanner does not see the event being built')
})

test('CORE: the write path goes through the gated planner, not around it', () => {
    // `planReminder` IS the gate on this path: it asks `mayWriteKind` and returns `null`
    // when the answer is no, so an event body only exists once the space kind AND the
    // NIP-11 doc are resolved. Assembling the tags in the store instead would put the
    // decision back where no test can reach it.
    const f = befund('reminders.ts')
    assert.ok(importiertAus(f, 'planReminder', './reminderModels.ts'), '`reminders.ts` does not import the gated planner')
    assert.ok(ruftAuf(f, 'planReminder'), '… and does not call it')

    // And the planner really is gated — otherwise the line above would be satisfied by a
    // function that just builds tags. Checked at the source, not assumed.
    const model = befund('reminderModels.ts')
    assert.ok(importiertAus(model, 'mayWriteKind', './relayCapability.ts'))
    assert.ok(ruftAuf(model, 'mayWriteKind'))
    // 30300 is the one kind in the table with a second condition — the extension — and it
    // is only checkable when the planner actually reads the horizon out of the same doc.
    assert.ok(importiertAus(model, 'maxNotBeforeDelta', './relayCaps.ts'))
    assert.ok(ruftAuf(model, 'maxNotBeforeDelta'), 'the horizon would then be a guess')
})

test('… and the markup mirror asks the same gate, so a dead menu entry never shows', () => {
    // `canRemind` decides whether the entry is rendered at all. It must come from the same
    // function as the write decision; a second rule here would drift.
    const f = befund('reminders.ts')
    assert.ok(importiertAus(f, 'mayWriteKind', './relayCapability.ts'))
    assert.ok(ruftAuf(f, 'mayWriteKind'))
    // …and the offered durations come from the relay's own horizon, not from a constant.
    assert.ok(ruftAuf(f, 'availableDelays'))
    assert.ok(ruftAuf(f, 'maxNotBeforeDelta'))
})

test('… and the NIP-11 doc is SUBSCRIBED, not read once', () => {
    // The documented way this class of surface breaks in this repo: a single synchronous
    // read at mount time answers "not Buzz / no extension" while the doc is still in
    // flight, and the value never catches up (`spaceCaps.ts`, `roomPins.ts`).
    const f = befund('reminders.ts')
    assert.ok(importiertAus(f, 'deriveSpaceProfile', './spaceCaps.ts'))
    assert.ok(ruftAuf(f, 'deriveSpaceProfile'))
    assert.ok(ruftAuf(f, 'deriveSpaceKind'))
})

test('… and publishes through `publishOptimistic`, which rolls back on a reject', () => {
    // welshman withdraws an optimistically inserted event only on an abort, never on a
    // relay reject (`js/publishOptimistic.ts`). Publishing through `Thunks` directly would
    // leave a rejected reminder standing on screen until the next reload — and a reminder
    // the relay never took is exactly the failure this surface must not have.
    const f = befund('reminders.ts')
    assert.ok(importiertAus(f, 'publishOptimistic', './publishOptimistic.ts'))
    assert.ok(ruftAuf(f, 'publishOptimistic'))
})

test('… and stays wired to `onDuplicate`, where the due signal actually lands', () => {
    // Measured in `reminderDelivery.test.ts` against the installed welshman: a NIP-ER due
    // signal is the SAME event id again, and `@welshman/net` routes it to `onDuplicate`.
    // Wired only to `onEvent`, the surface would show a reminder as pending forever while
    // the relay announced it as due every ten seconds.
    const source = readFileSync(join(JS_DIR, 'reminders.ts'), 'utf8')
    const tree = ts.createSourceFile('reminders.ts', source, ts.ScriptTarget.Latest, true)
    const handlers = new Set<string>()
    const walk = (node: ts.Node): void => {
        if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name)) {
            handlers.add(node.name.text)
        }
        ts.forEachChild(node, walk)
    }
    walk(tree)
    assert.ok(handlers.has('onEvent'), 'the live subscription has no onEvent handler')
    assert.ok(handlers.has('onDuplicate'), 'the due signal has nowhere to land')
})

test('THE CONFIDENTIALITY LATCH: every `makeEvent` content comes from `buildReminderEvent`', () => {
    // `makeEvent(EVENT_REMINDER, {content: plan.plaintext, tags: plan.tags})` type-checks,
    // runs, publishes — and puts the user's private note on the relay in the clear. The
    // relay never decrypts, so nothing rejects it; our own reader parses plain JSON
    // happily, so nothing looks broken. Only the shape of the call betrays it.
    const source = readFileSync(join(JS_DIR, 'reminders.ts'), 'utf8')
    const tree = ts.createSourceFile('reminders.ts', source, ts.ScriptTarget.Latest, true)

    /** Local names that hold the result of `await buildReminderEvent(…)`. */
    const encrypted = new Set<string>()
    const contents: string[] = []

    const collectBindings = (node: ts.Node): void => {
        if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
            const init = ts.isAwaitExpression(node.initializer) ? node.initializer.expression : node.initializer
            if (ts.isCallExpression(init) && ts.isIdentifier(init.expression) && init.expression.text === 'buildReminderEvent') {
                encrypted.add(node.name.text)
            }
        }
        ts.forEachChild(node, collectBindings)
    }
    collectBindings(tree)

    const collectContents = (node: ts.Node): void => {
        if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'makeEvent') {
            for (const argument of node.arguments) {
                if (!ts.isObjectLiteralExpression(argument)) {
                    continue
                }
                for (const property of argument.properties) {
                    if (
                        ts.isPropertyAssignment(property) &&
                        ts.isIdentifier(property.name) &&
                        property.name.text === 'content'
                    ) {
                        contents.push(property.initializer.getText(tree))
                    }
                }
            }
        }
        ts.forEachChild(node, collectContents)
    }
    collectContents(tree)

    assert.ok(encrypted.size > 0, 'nothing in `reminders.ts` is the result of `buildReminderEvent`')
    assert.ok(contents.length > 0, 'CALIBRATION: no `makeEvent({content: …})` found — the scanner measures nothing')
    for (const expression of contents) {
        assert.ok(
            [...encrypted].some((name) => expression === `${name}.content`),
            `\`content: ${expression}\` does not come from buildReminderEvent — the reminder would go out unencrypted`,
        )
    }
})
