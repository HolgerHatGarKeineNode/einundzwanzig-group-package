/**
 * **P4 latch: the write half touches `stars` and `mutes` — and nothing else.**
 *
 * Run (repo root):
 *   node --experimental-strip-types --test packages/einundzwanzig-group/js/channelPrefsWriteGate.test.ts
 *
 * ── Why the behaviour test next door is only half the promise ──────────────────
 *
 * `channelPrefsData.test.ts` proves that {@link planChannelPrefsPublish} refuses
 * `channel-sections` and `channel-sort`. That stays green if somebody builds a second
 * event in `channelPrefs.ts` by hand and never asks the plan — the refusing function
 * still refuses, it is simply no longer on the path. This is exactly how a whole-blob
 * write would get in, and it is the reason the plan's DoD asks for a test that goes red
 * on it rather than for a comment.
 *
 * So this latch measures the WIRING: how many places can build a preference event at
 * all, and who calls the gate.
 *
 * ── What is at stake ──────────────────────────────────────────────────────────
 *
 * `channel-sections` and `channel-sort` are whole-blob LWW (`channelPrefsData.ts
 * applyBlob`). One write replaces the section layout and the channel sorting the user
 * set in Buzz Desktop — completely, and in a client this one cannot see. There is no
 * surface here that would set either of them, so every write to them is loss.
 *
 * ── AST, not grep — measured, not assumed ─────────────────────────────────────
 *
 * The scanner is `workspaceQuelleGate.ts`; its head carries the reasoning and the two
 * gaps a text pattern had. It matters here as well: `channelPrefs.ts` NAMES both blob
 * tags in its comments, on purpose, to say that they are not written. A text search
 * would report those sentences as the violation.
 *
 * ── What this latch cannot see, in its own words ──────────────────────────────
 *
 * It sees names, not values. `const f = makeEvent; f(...)` or a namespace import would
 * walk past it, and it cannot read the arguments of a call — "which `d` tag went into
 * this plan" is a question for the pure test, not for this one. Together they cover the
 * two ways in: changing the writable set (pure test) and going around the gate (here).
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
    MIN_AUFRUFE,
    importiertAus,
    liesDatei,
    ruftAuf,
    sammleModule,
    type Quellenbefund,
} from './workspaceQuelleGate.ts'

const JS_DIR = dirname(fileURLToPath(import.meta.url))

/** The impure half — the only module that may turn a preference store into an event. */
const WRITER = 'channelPrefs.ts'
/** The pure half, where the gate lives. */
const DATA_MODULE = './channelPrefsData.ts'
/**
 * The gate the writer goes through. It hands out no plan for the two blob tags — and
 * since the second P4 round it also carries the identity guard, so the whole decision is
 * one pure call the impure half either makes or does not.
 */
const GATE = 'decideChannelPrefsPublish'

/**
 * Names that must exist in EXACTLY ONE production module, and that module is
 * {@link WRITER}.
 *
 * `makeEvent` and `nip44EncryptToSelf` are the two steps a preference write cannot skip:
 * a second call site for either is a second way to reach the relay, and it would not be
 * covered by the gate. `readStateSync.ts` calls both as well — for its own kind 30078
 * with its own `d` tag — which is why this list is checked against the FLAG modules
 * below and not against the whole tree.
 */
const SINGLE_SITE = ['makeEvent', 'nip44EncryptToSelf']

/**
 * The guards of the publish path, with the number of call sites each must have.
 *
 * **Why a COUNT and not just "is it called".** Each of these four is a step whose removal
 * is invisible to every behaviour test that does not produce its rare precondition:
 *
 * | call | what a removal breaks in production |
 * |---|---|
 * | `mergeOwnBlobBeforePublish` | a second device's channel is dropped on the next publish |
 * | `decideChannelPrefsPublish` | the sections/sort gate and the identity guard are both off the path |
 * | `publishEpochUnchanged` | an identity switch during the SIGNER round trip writes the old store under the new key |
 * | `anyRelayAccepted` | a refused publish counts as delivered — the switch is gone after the reload |
 *
 * `publishEpochUnchanged` is asked twice in total: once inside
 * `decideChannelPrefsPublish` (pure, covered by its own test) and once HERE, after the
 * encryption. Only the second one is visible to this scanner, hence 1.
 *
 * The behaviour of the first three is covered next door: the decision as a pure function
 * (`channelPrefsData.test.ts`), the merge and the refusal against a real relay
 * (`tests/e2e/buzz-channel-prefs.spec.ts`, anchors P4/5 and P4/6). What this table adds is
 * the case those cannot see — the call simply gone.
 */
const PUBLISH_GUARDS: Readonly<Record<string, number>> = {
    mergeOwnBlobBeforePublish: 1,
    decideChannelPrefsPublish: 1,
    publishEpochUnchanged: 1,
    anyRelayAccepted: 1,
}

/**
 * Names that belong to the write half of the preferences and must have exactly one
 * caller in the whole production tree.
 */
const WRITE_HALF_CALLERS: Readonly<Record<string, string>> = {
    [GATE]: WRITER,
    setFlag: WRITER,
    // Both sit BEHIND the gate, inside the pure half: `planChannelPrefsPublish` is called
    // by the decision, the serialiser by the plan. A second caller for either would be a
    // payload that never passed the `d` tag check.
    planChannelPrefsPublish: 'channelPrefsData.ts',
    flagPayloadJson: 'channelPrefsData.ts',
}

const befundFuer = (datei: string): Quellenbefund => liesDatei(join(JS_DIR, datei), datei)

const zaehle = (befund: Quellenbefund, name: string): number =>
    befund.aufrufe.filter((aufruf) => aufruf === name).length

describe('P4 latch: only stars and mutes are written', () => {
    // ── Calibration ─────────────────────────────────────────────────────────
    //
    // Without it every "does not call X" below is worth nothing: a scanner that reads
    // the wrong file reports the same as a clean one.

    test('CALIBRATION: the scanner really reads channelPrefs.ts', () => {
        const befund = befundFuer(WRITER)
        assert.ok(
            befund.aufrufe.length >= MIN_AUFRUFE,
            `only ${befund.aufrufe.length} calls seen in ${WRITER} (at least ${MIN_AUFRUFE} expected)`,
        )
        // A call that has nothing to do with this latch — it belongs to the READ half.
        assert.ok(ruftAuf(befund, 'mergeFlags'), `${WRITER} does not call mergeFlags() — the scanner reads the wrong file`)
    })

    // ── Core ────────────────────────────────────────────────────────────────

    test(`CORE: ${WRITER} goes through ${GATE}`, () => {
        const befund = befundFuer(WRITER)
        assert.ok(
            importiertAus(befund, GATE, DATA_MODULE),
            `${WRITER} does not import ${GATE} from ${DATA_MODULE}.`,
        )
        assert.ok(ruftAuf(befund, GATE), `${WRITER} does not call ${GATE}() — the sections/sort gate is not on the path.`)
    })

    test(`CORE: ${WRITER} has exactly ONE place that builds and encrypts a preference event`, () => {
        const befund = befundFuer(WRITER)
        for (const name of SINGLE_SITE) {
            assert.equal(
                zaehle(befund, name),
                1,
                `${WRITER} calls ${name}() ${zaehle(befund, name)} times. Exactly one is allowed: a second call site `
                    + `is a second way to the relay, and it is not covered by ${GATE} — that is how a `
                    + 'channel-sections or channel-sort write gets in.',
            )
        }
    })

    test('CORE: in the whole production tree, only one module runs the write half', () => {
        const module = sammleModule(JS_DIR)
        for (const [name, erwartet] of Object.entries(WRITE_HALF_CALLERS)) {
            const aufrufer = module.filter((datei) => ruftAuf(befundFuer(datei), name))
            assert.deepEqual(
                aufrufer,
                [erwartet],
                `${name}() is called by: ${aufrufer.join(', ') || '(nobody)'}. Allowed is ${erwartet}.`,
            )
        }
    })

    test('CORE: every guard of the publish path is still on the path', () => {
        const befund = befundFuer(WRITER)
        for (const [name, erwartet] of Object.entries(PUBLISH_GUARDS)) {
            assert.equal(
                zaehle(befund, name),
                erwartet,
                `${WRITER} calls ${name}() ${zaehle(befund, name)}x, expected ${erwartet}. `
                    + 'A guard that is no longer called is invisible to every behaviour test that '
                    + 'cannot produce its precondition — see the table at PUBLISH_GUARDS.',
            )
        }
    })

    test('CORE: both room lists write through the SAME entry point', () => {
        // The two surfaces that carry the menu. If one of them grew its own path into
        // the stores, "already muted" would soon mean two different things — the same
        // split P6 resolved for the reading side.
        for (const insel of ['rail.ts', 'bridge.ts']) {
            const befund = befundFuer(insel)
            assert.ok(
                importiertAus(befund, 'toggleChannelFlag', './channelPrefs.ts'),
                `${insel} does not import toggleChannelFlag from ./channelPrefs.ts.`,
            )
            assert.ok(ruftAuf(befund, 'toggleChannelFlag'), `${insel} does not call toggleChannelFlag().`)
            for (const verboten of [...SINGLE_SITE, ...Object.keys(WRITE_HALF_CALLERS)]) {
                assert.equal(
                    ruftAuf(befund, verboten),
                    false,
                    `${insel} calls ${verboten}() itself — the write half belongs in ${WRITER}.`,
                )
            }
        }
    })
})
