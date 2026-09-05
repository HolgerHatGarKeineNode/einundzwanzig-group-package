/**
 * **P6 latch: no mute list is written without a relay answer, and only one module can write one.**
 *   node --test --experimental-strip-types packages/einundzwanzig-group/js/muteWriteGate.test.ts
 *
 * ── Why the behaviour test next door is only half the promise ──────────────────
 *
 * `muteModels.test.ts` proves that {@link planMuteWrite} refuses without `listAnswered`.
 * That stays green if somebody builds a 10000 in `mutes.ts` by hand and never asks the
 * plan — the refusing function still refuses, it is simply no longer on the path. That is
 * exactly how a blind write would get in, and it is why the DoD asks for a test that goes
 * red on it rather than for a comment.
 *
 * So this latch measures the WIRING: how many places can build a mute event at all, and
 * who asks the gate.
 *
 * ── What is at stake ──────────────────────────────────────────────────────────
 *
 * Kind 10000 is replaceable: one list per pubkey, and the relay does not union — it
 * replaces. A write built without the relay's copy in hand deletes every mute the user
 * made on another device, silently, on their own account. Same class as kind 3.
 *
 * `@welshman/app`'s `MuteLists` plugin does precisely that (`muteLists.js` `update()` →
 * `forceLoad` → `makeForceLoadItem`, which awaits the fetch and then reads whatever
 * happens to be in the index). That is why it is not used, and why this file also asserts
 * that nobody imports it.
 *
 * ── AST, not grep — the same scanner as the P4 latch ──────────────────────────
 *
 * `workspaceQuelleGate.ts`; its head carries the reasoning and the two gaps a text pattern
 * had. It matters here as well: `mutes.ts` NAMES `mutePublicly` and `MuteLists` in its
 * header, on purpose, to say why they are not used. A text search would report those
 * sentences as the violation.
 *
 * ── What this latch cannot see, in its own words ──────────────────────────────
 *
 * It sees names, not values. `const f = makeEvent; f(...)` or a namespace import would
 * walk past it, and it cannot read the arguments of a call — "was `listAnswered` really
 * the relay's `EOSE`" is a question for the pure test, not for this one. Together they
 * cover the two ways in: changing the rule (pure test) and going around it (here).
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
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
import { flattenWhitespace } from './moderationSurfaceGate.ts'

const JS_DIR = dirname(fileURLToPath(import.meta.url))

/** The impure half — the only module that may turn a mute into an event. */
const WRITER = 'mutes.ts'
/** The pure half, where the gate lives. */
const DATA_MODULE = './muteModels.ts'
/** The gate the writer goes through. It hands out no plan without a relay answer. */
const GATE = 'planMuteWrite'

/**
 * The guards of the write path, with the number of call sites each must have.
 *
 * **Why a COUNT and not just "is it called".** Each of these is a step whose removal is
 * invisible to every behaviour test that does not produce its rare precondition:
 *
 * | call | what a removal breaks in production |
 * |---|---|
 * | `readOwnMuteList` | twice: once to build the merge base and its `answered` verdict, once to check the relay meant its `OK`. Drop the first and every write is blind; drop the second and a `created_at` that lost the race counts as delivered |
 * | `planMuteWrite` | the whole gate — no-answer, self-mute, unknown relay kind and no-op are all off the path at once |
 * | `mayWriteKind` | the menu offers an action on a space whose kind is still in flight |
 * | `muteWriteConfirmed` | zooid's silent drop of a replaceable event with a stale `created_at` reads as success |
 * | `publishOptimistic` | nothing reaches the relay; the local store carries a mute that exists nowhere |
 * | `makeEvent` | exactly one place builds the event — a second is a second way to the relay, uncovered by the gate |
 */
const WRITE_GUARDS: Readonly<Record<string, number>> = {
    readOwnMuteList: 2,
    planMuteWrite: 1,
    mayWriteKind: 1,
    muteWriteConfirmed: 1,
    publishOptimistic: 1,
    makeEvent: 1,
}

/**
 * Names of the write half that must have exactly one caller in the whole production tree.
 */
const WRITE_HALF_CALLERS: Readonly<Record<string, string>> = {
    [GATE]: WRITER,
    // Behind the gate, inside the pure half: the tag algebra is called by the plan and by
    // nobody else. A second caller would be a tag list that never passed the refusals.
    withMutedPubkey: 'muteModels.ts',
    withoutMutedPubkey: 'muteModels.ts',
}

/**
 * `@welshman/app`'s mute plugin, by name. Importing it anywhere is the shortcut this
 * phase deliberately did not take — see the module header of `js/mutes.ts` for the
 * `forceLoad` reading that makes it unsafe here.
 */
const FORBIDDEN_IMPORT = 'MuteLists'

const befundFuer = (datei: string): Quellenbefund => liesDatei(join(JS_DIR, datei), datei)

const zaehle = (befund: Quellenbefund, name: string): number =>
    befund.aufrufe.filter((aufruf) => aufruf === name).length

describe('P6 latch: a mute list is never written blind', () => {
    // ── Calibration ─────────────────────────────────────────────────────────
    //
    // Without it every "does not call X" below is worth nothing: a scanner that read the
    // wrong file reports the same as a clean one.

    test('CALIBRATION: the scanner really reads mutes.ts', () => {
        const befund = befundFuer(WRITER)
        assert.ok(
            befund.aufrufe.length >= MIN_AUFRUFE,
            `only ${befund.aufrufe.length} calls seen in ${WRITER} (at least ${MIN_AUFRUFE} expected)`,
        )
        // A call that has nothing to do with this latch — it belongs to the READ half.
        assert.ok(
            ruftAuf(befund, 'mutedPubkeysOf'),
            `${WRITER} does not call mutedPubkeysOf() — the scanner reads the wrong file`,
        )
    })

    // ── Core ────────────────────────────────────────────────────────────────

    test(`CORE: ${WRITER} goes through ${GATE}`, () => {
        const befund = befundFuer(WRITER)
        assert.ok(
            importiertAus(befund, GATE, DATA_MODULE),
            `${WRITER} does not import ${GATE} from ${DATA_MODULE}.`,
        )
        assert.ok(
            ruftAuf(befund, GATE),
            `${WRITER} does not call ${GATE}() — the no-answer refusal is not on the path, and a blind write `
                + 'deletes every mute made on another device.',
        )
    })

    test('CORE: every guard of the write path is still on the path', () => {
        const befund = befundFuer(WRITER)
        for (const [name, erwartet] of Object.entries(WRITE_GUARDS)) {
            assert.equal(
                zaehle(befund, name),
                erwartet,
                `${WRITER} calls ${name}() ${zaehle(befund, name)}x, expected ${erwartet}. `
                    + 'A guard that is no longer called is invisible to every behaviour test that cannot '
                    + 'produce its precondition — see the table at WRITE_GUARDS.',
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

    test("CORE: nobody imports welshman's MuteLists plugin", () => {
        const module = sammleModule(JS_DIR)
        const importer = module.filter((datei) =>
            befundFuer(datei).importe.some((stelle) => stelle.exportName === FORBIDDEN_IMPORT),
        )
        assert.deepEqual(
            importer,
            [],
            `${importer.join(', ')} imports ${FORBIDDEN_IMPORT}. Its update() starts from an empty list when the `
                + 'fetch came back with nothing — which is exactly the blind write this phase exists to prevent.',
        )
    })

    /**
     * **The one link no pure test and no AST count can reach.**
     *
     * `listAnswered` is only as good as its source: it must be the relay's `EOSE` and
     * nothing else. Hard-coding it to `true` — a one-word edit that reads like a
     * simplification — turns the whole gate above into decoration, and every case in
     * `muteModels.test.ts` stays green because the plan is still asked, just with a lie.
     * An E2E cannot reach it either: producing "the relay never sends EOSE" needs a
     * WebSocket proxy that switches off one of the two prevention layers.
     *
     * So this one is measured on the source text, with its blindness calibrated: a text
     * assertion goes red for a line break as readily as for the change it guards
     * (documented in this repo more than once), which is why the first two assertions
     * check that the scanner is looking at a real, non-trivial file.
     */
    test('CORE: the answered verdict still comes from the relay EOSE', () => {
        const quelle = readFileSync(join(JS_DIR, WRITER), 'utf8')
        assert.ok(quelle.length > 4_000, `${WRITER} is only ${quelle.length} bytes — the scanner reads the wrong file`)
        assert.ok(quelle.includes('export const readOwnMuteList'), `${WRITER} no longer defines readOwnMuteList`)

        assert.match(
            quelle,
            /let answered = false/,
            `${WRITER}: the verdict no longer starts at false. Starting at true means every write is treated as `
                + 'informed, including the ones where the relay said nothing at all.',
        )
        assert.match(
            quelle,
            /onEose:\s*\(\)\s*=>\s*\{\s*answered\s*=\s*true/,
            `${WRITER}: the verdict is no longer set from the request's onEose. Then `
                + '`listAnswered` is not the relay\'s answer any more, and the gate in planMuteWrite is decoration.',
        )
    })

    /**
     * **The neighbouring form, twice — and the second time it was my own assertion.**
     *
     * *(1) The answer is fetched and thrown away.* Every case above this one counts CALLS.
     * That is a deletion detector, not a semantic one — the limit `moderationSurfaceGate.ts`
     * states for itself and that P4 wrote down. A guard that is still called and whose
     * result is discarded keeps every count intact and turns nothing red. It was found in
     * review on the one line that matters most:
     *
     *     return { answered, list: … }   →   return { answered: true, list: … }
     *
     * *(2) The fix for (1) was a whole-statement text comparison — and that falls to
     * APPENDING.* `return isWorkspaceChannel(this.workspace, room.h) || room.isDm === true`
     * leaves the pinned substring standing, every count intact, and the gate widened.
     * **Measured 2026-09-05: 6 of the 9 statements this latch pinned were defeated that
     * way** (`answer`, `after`, `self.canMute`, `events`, `canSetPrefs`, `isWorkspaceRoom`).
     * A prefix match is not beaten by deleting, it is beaten by appending.
     *
     * **So the question goes to the AST**, which is where it belonged: `Quellenbefund.werte`
     * reports the FORM of the expression a value is built from. Append `|| true` and the
     * form is no longer `CallExpression` but `BinaryExpression||`, and `ruft` falls to `''`
     * — the site drops out of the expected set below and this case goes red.
     *
     * The table is read as: *for guard G, these and exactly these are the places whose
     * value IS its answer.*
     *
     * | guard | what a widened or discarded answer costs |
     * |---|---|
     * | `readOwnMuteList` | the merge base and the verdict come from somewhere other than the relay |
     * | `muteWriteConfirmed` | zooid's silent drop of a stale `created_at` reads as success |
     * | `mayWriteKind` | the menu offers an action on a relay whose kind is still unknown |
     * | `visibleChatEvents` | hiding a person does nothing — the call is there, its answer is not the list |
     *
     * **What this cannot see, in its own words:** shapes, not control flow. A second
     * `return` of the same shape placed earlier would satisfy an existence check while the
     * real one lies. That is what the behaviour pair next door is for
     * (`muteModels.test.ts`), and it is why neither file is enough alone.
     */
    test('CORE: the answer of every guard IS the value — asked of the AST, not of the text', () => {
        const befundFuerDatei = (datei: string) => befundFuer(datei)
        const kurz = (stelle: { art: string; name: string; form: string }) =>
            `${stelle.art} ${stelle.name} ${stelle.form}`
        const stellen = (datei: string, wache: string) =>
            befundFuerDatei(datei).werte.filter((stelle) => stelle.ruft === wache).map(kurz).sort()

        const ERWARTET: ReadonlyArray<readonly [string, string, string[], string]> = [
            [WRITER, 'readOwnMuteList', ['binding after CallExpression', 'binding answer CallExpression'],
                'toggle() and publishMuteList() must BE the relay read, not merely trigger it.'],
            [WRITER, 'muteWriteConfirmed', ['return publishMuteList ConditionalExpression'],
                'the confirmation must decide the return value, not be computed beside it.'],
            [WRITER, 'mayWriteKind', ['assignment self.canMute BinaryExpression&&'],
                'the write permission must be derived from the relay kind.'],
            ['feeds.ts', 'visibleChatEvents', ['binding events CallExpression'],
                'the message list must BE the filtered list.'],
        ]

        for (const [datei, wache, erwartet, folge] of ERWARTET) {
            assert.deepEqual(
                stellen(datei, wache),
                erwartet,
                `${datei}: the value sites built from ${wache}() are [${stellen(datei, wache).join(' | ')}], `
                    + `expected [${erwartet.join(' | ')}]. ${folge} An appended \`|| true\` shows up here as a `
                    + 'missing entry, because the expression is then a BinaryExpression and not a call.',
            )
        }
    })

    /**
     * **The verdict object, pinned on its FIELDS.**
     *
     * `answered` has to be the shorthand — the collected value — and the object has to
     * carry exactly two fields. The second half is not pedantry: `{ answered, list: x,
     * answered: true }` is legal JavaScript, the LAST key wins, and the shorthand still
     * stands there looking correct. A text comparison over the statement catches that one
     * (the trailing `}` anchors it), a field list catches it and says why.
     */
    test('CORE: readOwnMuteList returns the COLLECTED verdict, in the shorthand', () => {
        const rueckgaben = befundFuer(WRITER).werte.filter(
            (stelle) => stelle.art === 'return' && stelle.name === 'readOwnMuteList',
        )
        assert.ok(rueckgaben.length >= 2, `${WRITER}: readOwnMuteList has ${rueckgaben.length} return(s) — the scanner reads the wrong file.`)

        const gesammelt = rueckgaben.filter((stelle) => stelle.felder.join(',') === 'answered,list=')
        assert.equal(
            gesammelt.length,
            1,
            `${WRITER}: readOwnMuteList has ${gesammelt.length} return(s) of the form { answered, list: … }, expected 1. `
                + 'A hard-wired `answered: true` turns the shorthand into a field with its own value; a duplicate '
                + '`answered: true` appended to the same object wins in JS while the shorthand still stands.',
        )
    })

    /**
     * **The refusal of the gate is honoured — and this one stays a text assertion.**
     *
     * The clause allows both: anchor at BOTH ends, or ask the AST. `if (!plan) {` is
     * already anchored at both ends — `if (` on the left, `) {` on the right — so an
     * appended condition (`if (!plan && false) {`) breaks the match rather than slipping
     * past it. Measured with the other eight on 2026-09-05: this is one of the three that
     * an append does NOT defeat.
     *
     * Without it, a fallback beside the gate (`planMuteWrite(…) ?? {…}`) would mean the
     * gate is asked and its refusal overruled — every count intact, nothing red.
     */
    test('CORE: a refused plan is honoured, not overruled', () => {
        const quelle = flattenWhitespace(readFileSync(join(JS_DIR, WRITER), 'utf8'))
        assert.ok(quelle.includes('const plan = planMuteWrite({'), `${WRITER}: the plan is no longer bound at all.`)
        assert.ok(
            quelle.includes('if (!plan) {'),
            `${WRITER}: the refusal of planMuteWrite is not honoured. A fallback beside the gate means the gate is `
                + 'asked and overruled — and every call count stays intact.',
        )
    })

    test('CORE: the store is wired into the island, or no surface has it', () => {
        // The three readers hang on `$store.mutes`; without this call the profile card
        // button and the settings section render nothing and say nothing about why.
        const befund = befundFuer('bridge.ts')
        assert.ok(importiertAus(befund, 'wireMutes', './mutes.ts'), 'bridge.ts does not import wireMutes from ./mutes.ts.')
        assert.ok(ruftAuf(befund, 'wireMutes'), 'bridge.ts does not call wireMutes() — $store.mutes never exists.')
    })

    test('CORE: the chat list filters through the pure function, not through its own predicate', () => {
        // Two answers to "is this author hidden" would drift: one would filter, the other
        // would label the button. And `visibleChatEvents` carries the rule that the
        // reader's OWN messages are never hidden — reimplemented in `feeds.ts`, that rule
        // would be gone and there would be no way back out of the room.
        const befund = befundFuer('feeds.ts')
        assert.ok(
            importiertAus(befund, 'visibleChatEvents', './muteModels.ts'),
            'feeds.ts does not import visibleChatEvents from ./muteModels.ts.',
        )
        assert.ok(ruftAuf(befund, 'visibleChatEvents'), 'feeds.ts does not call visibleChatEvents() — the chat list is unfiltered.')
        // That its ANSWER is what the message list is built from is asserted above, over
        // the AST — a text comparison here would be the weaker of the two standing next to
        // the stronger, and the weaker is the one that ages.
        assert.ok(
            importiertAus(befund, 'deriveMutedPubkeys', './mutes.ts'),
            'feeds.ts does not import deriveMutedPubkeys — the filter has no source and would always be empty.',
        )
        assert.ok(ruftAuf(befund, 'deriveMutedPubkeys'))
    })
})
