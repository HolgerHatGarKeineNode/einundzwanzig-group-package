/**
 * **The latch over the WIRING of presence — not over its behaviour.**
 *   node --test --experimental-strip-types packages/einundzwanzig-group/js/presenceWiring.test.ts
 *
 * Three promises of P6 that no behavioural test can carry, because each of them breaks
 * without anything going red:
 *
 *  1. **The read path is `request({onEvent})`, never a derivation.** `welshmanInstance.ts`
 *     drops ephemeral events before the repository, so `deriveEvents`/`deriveEventsForUrl`
 *     is *blind* for kind 20001 — not empty. A store wired that way compiles, runs,
 *     subscribes, and shows an empty presence table forever, which is indistinguishable
 *     from "nobody is online". Only the shape of the call betrays it.
 *  2. **The write path goes through the gated planner.** `planPresence` asks
 *     `mayWriteKind` and answers `null`; a store that assembled `makeEvent(20001, …)`
 *     itself would put the decision back where no test can reach it — and would write
 *     Buzz's dialect onto a zooid relay, which stores what it does not understand.
 *  3. **There is no shipped 20002 write path.** The typing indicator was measured in this
 *     phase and deliberately **not** delivered (decision 2026-09-03: a cosmetic feature
 *     must not endanger the core one, R4). "It is not there" is a claim that ages badly
 *     unless something checks it, so the last case reads every production module and
 *     insists the number does not occur in code.
 *
 * ── Why AST and not `grep` ──────────────────────────────────────────────────────
 *
 * Because 20002 appears in this package's **prose** — `nip46-perms.ts` explains why it is
 * not in the permission list, and that explanation must not read as a violation. A text
 * match would report the comment as a finding; `ts.createSourceFile` sees the tree the
 * compiler sees, and comments are not in it. The scanner is the one from the P6-workspace
 * latch (`workspaceQuelleGate.ts`), reused rather than rebuilt.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'
import { importiertAus, lies, liesDatei, ruftAuf, sammleModule } from './workspaceQuelleGate.ts'
import { PRESENCE_UPDATE } from './presenceData.ts'

const JS_DIR = import.meta.dirname
const befund = (name: string) => liesDatei(join(JS_DIR, name), name)

/**
 * Lower bound of identifier calls the scanner must see in `presence.ts`.
 *
 * Calibration, not style: without it "does not call `planPresence`" is also true when
 * nothing was read at all. **Measured 2026-09-04: 39 identifier calls** (`f(…)`, never
 * `obj.f(…)`, which is why the number is far below the file length). The threshold sits
 * at 15 — it is meant to catch a blind scanner, not the next refactor.
 */
const MIN_CALLS_PRESENCE = 15

/** The typing indicator (`KIND_TYPING_INDICATOR`, `buzz-core/src/kind.rs`). Not shipped. */
const TYPING_INDICATOR = 20002

/** Every numeric literal in a file, out of the syntax tree (so: not out of comments). */
const numericLiterals = (name: string, source: string): number[] => {
    const tree = ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true)
    const found: number[] = []
    const walk = (node: ts.Node): void => {
        if (ts.isNumericLiteral(node)) {
            found.push(Number(node.text))
        }
        if (ts.isStringLiteralLike(node)) {
            // A kind can also be smuggled in as text (`['k', '20002']`, a filter built
            // from strings). Cheap to cover, and the failure would look identical.
            const asNumber = Number(node.text)
            if (Number.isFinite(asNumber) && node.text.trim() !== '') {
                found.push(asNumber)
            }
        }
        ts.forEachChild(node, walk)
    }
    walk(tree)

    return found
}

test('CALIBRATION: the scanner really reads `presence.ts`', () => {
    const f = befund('presence.ts')
    assert.ok(
        f.aufrufe.length >= MIN_CALLS_PRESENCE,
        `only ${f.aufrufe.length} calls seen (at least ${MIN_CALLS_PRESENCE} expected) — the scanner measures nothing here`,
    )
    // And one call that has nothing to do with any claim below: otherwise a scanner that
    // only ever finds `plan*`/`request` names would report the same count as a healthy one.
    assert.ok(ruftAuf(f, 'makeEvent'), 'the scanner does not see the event being built')
})

test('THE READ LATCH: presence is read with `request({onEvent})`, not through a derivation', () => {
    const f = befund('presence.ts')
    assert.ok(importiertAus(f, 'request', './welshmanNet.ts'), '`presence.ts` does not import the raw request adapter')
    assert.ok(ruftAuf(f, 'request'), '… and does not call it')

    // The other half of the promise, and the one that would actually break: no derivation
    // over the repository, because the repository never sees an ephemeral event.
    const forbidden = f.importe.filter((entry) => entry.modul === './repository.ts')
    assert.deepEqual(
        forbidden.map((entry) => entry.exportName),
        [],
        'a repository derivation is structurally blind for kind 20001 — it would show an empty table forever',
    )

    // `autoClose: false` and an `onEvent` handler are the two properties that make the
    // subscription a live one; either missing turns it into a one-shot that answers with
    // EOSE and nothing else, because presence has no backlog to deliver.
    const source = readFileSync(join(JS_DIR, 'presence.ts'), 'utf8')
    const tree = ts.createSourceFile('presence.ts', source, ts.ScriptTarget.Latest, true)
    const properties = new Map<string, string>()
    const walk = (node: ts.Node): void => {
        if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name)) {
            properties.set(node.name.text, node.initializer.getText(tree))
        }
        ts.forEachChild(node, walk)
    }
    walk(tree)
    assert.ok(properties.has('onEvent'), 'the live subscription has no onEvent handler')
    assert.equal(properties.get('autoClose'), 'false', 'without `autoClose: false` the subscription closes at EOSE')
})

test('THE WRITE LATCH: the gate is the return value, and it is asked before anything is signed', () => {
    const f = befund('presence.ts')
    assert.ok(importiertAus(f, 'planPresence', './presenceData.ts'), '`presence.ts` does not import the gated planner')
    assert.ok(ruftAuf(f, 'planPresence'), '… and does not call it')

    // And the planner really is gated — otherwise the line above would be satisfied by a
    // function that just builds a content string. Checked at the source, not assumed.
    const model = befund('presenceData.ts')
    assert.ok(importiertAus(model, 'mayWriteKind', './relayCapability.ts'))
    assert.ok(ruftAuf(model, 'mayWriteKind'))
})

test('… and the space kind is SUBSCRIBED, not read once', () => {
    // The documented way this class of surface breaks in this repo: a single synchronous
    // read at mount time answers `'unknown'` while the NIP-11 doc is still in flight, and
    // the value never catches up (`spaceCaps.ts`, `roomPins.ts`). Presence would then be
    // permanently silent on a relay that speaks Buzz perfectly well.
    const f = befund('presence.ts')
    assert.ok(importiertAus(f, 'deriveSpaceKind', './spaceCaps.ts'))
    assert.ok(ruftAuf(f, 'deriveSpaceKind'))
    // …and the read side asks the same three-valued question through the pure gate, so
    // "`unknown` renders nothing" is decided in a place a test can reach.
    assert.ok(importiertAus(f, 'mayReadPresence', './presenceData.ts'))
    assert.ok(ruftAuf(f, 'mayReadPresence'))
})

test('THE 20002 LATCH: no production module writes, reads or names the typing indicator', () => {
    // Calibration first, and it is the whole worth of this case: a scanner that finds
    // nothing looks exactly like a clean tree. So: it must find the number it is looking
    // for when the number is there…
    assert.deepEqual(
        numericLiterals('probe.ts', `const k = ${TYPING_INDICATOR}; const s = '${TYPING_INDICATOR}'`).filter(
            (value) => value === TYPING_INDICATOR,
        ),
        [TYPING_INDICATOR, TYPING_INDICATOR],
        'the literal scanner does not see a 20002 that IS there — it would report every tree as clean',
    )
    // …and it must be blind to the same number in a comment, or `nip46-perms.ts` (which
    // explains in prose why 20002 is absent) would be reported as the violation.
    assert.deepEqual(numericLiterals('probe.ts', `// ${TYPING_INDICATOR}\nconst k = 1`), [1])

    const modules = sammleModule(JS_DIR)
    const offenders: string[] = []
    let sawPresenceKind = false
    for (const name of modules) {
        const source = readFileSync(join(JS_DIR, name), 'utf8')
        // Fail-closed: an unreadable module must throw rather than count as clean.
        lies(name, source)
        const numbers = numericLiterals(name, source)
        if (numbers.includes(TYPING_INDICATOR)) {
            offenders.push(name)
        }
        if (numbers.includes(PRESENCE_UPDATE)) {
            sawPresenceKind = true
        }
    }
    assert.ok(
        sawPresenceKind,
        `CALIBRATION: the scan of ${modules.length} modules did not even find kind ${PRESENCE_UPDATE} — it is looking at the wrong tree`,
    )
    assert.deepEqual(
        offenders,
        [],
        `these modules carry kind ${TYPING_INDICATOR} in code: ${offenders.join(', ')}. ` +
            'The typing indicator was measured in P6 and deliberately not shipped (decision 2026-09-03).',
    )
})
