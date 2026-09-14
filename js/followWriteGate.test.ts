/**
 * **P1/P2 latch: a kind 3 is written from what the RIGHT relays showed us, or not at all.**
 *   node --test --experimental-strip-types packages/einundzwanzig-group/js/followWriteGate.test.ts
 *
 * P1: the follow button never claims to know, and only one module builds a kind 3.
 * P2: that module reads and writes outbox ∪ space, and the verdict it trusts is staged —
 * an `EOSE` from the space relay alone no longer licenses a write.
 *
 * ── What the behaviour test next door cannot promise ───────────────────────────
 *
 * `followModels.test.ts` proves that {@link planFollowWrite} refuses without
 * `listAnswered`. That stays green when somebody builds a kind 3 in `follows.ts` by hand
 * and never asks the plan: the refusing function still refuses, it is simply no longer on
 * the path. Same for the surface — a pure test cannot see a button, and a button that
 * says „Folgen" while nothing has been read is the defect this phase exists for.
 *
 * So this latch measures the WIRING and the MARKUP: who may build the event, whose answer
 * the write decision is, where the `listSeen` verdict comes from, which relays the read and
 * the write go to, and whether the button still announces the third state.
 *
 * ── What is at stake ──────────────────────────────────────────────────────────
 *
 * Kind 3 is replaceable, global and the object every other client reads to build the
 * user's feed. A write from an incomplete picture does not lose an entry, it loses the
 * follow list. `@welshman/app`'s `FollowLists` plugin builds its writer from
 * `await this.forceLoad(user.pubkey)` (`plugins/followLists.js`), and `makeForceLoadItem`
 * is `await loadItem(key); return getItem(key)` (`store/src/repository.js`) — a dead
 * socket ends in `undefined`, with no error and no flag, and the writer starts from an
 * empty list. That is why the plugin is not used here and why importing it is forbidden
 * below rather than discouraged in a comment.
 *
 * ── AST, not grep ─────────────────────────────────────────────────────────────
 *
 * `workspaceQuelleGate.ts` carries the reasoning and the two measured holes a text
 * pattern had. It matters here twice over: `follows.ts` NAMES `FollowLists` and
 * `forceLoad` in its header, on purpose, to say why they are not used — a text search
 * would report those very sentences as the violation. And a call needs no brackets:
 * `x-on:click="handler"` is invisible to any `NAME(` scanner, which is how three gates in
 * this repo were walked past.
 *
 * ── What this latch cannot see, in its own words ──────────────────────────────
 *
 * It sees names and shapes, not values and not control flow. `const f = makeEvent; f(…)`
 * walks past it, it cannot read the arguments of a call, and a second `return` of the
 * right shape placed before the real one would satisfy an existence check. "Was
 * `listAnswered` really the relay's `EOSE`" is a question for the pure test and for the
 * source-text cases at the end. Together they cover the two ways in: changing the rule
 * (behaviour test) and going around it (here).
 *
 * The Blade half is text, not a tree — Blade is not JavaScript, and the AST scanner
 * cannot parse it. `moderationSurfaceGate.ts` states the same limit for the same reason.
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
    type Wertstelle,
} from './workspaceQuelleGate.ts'
import { flattenWhitespace, readBlade } from './moderationSurfaceGate.ts'

const JS_DIR = dirname(fileURLToPath(import.meta.url))

/** The impure half — the only module that may turn a follow into an event. */
const WRITER = 'follows.ts'
/** The pure half, where the gate lives. */
const DATA_MODULE = './followModels.ts'
/** The gate the writer goes through. It hands out no plan without a relay answer. */
const GATE = 'planFollowWrite'

/** The one surface with a follow button. */
const CARD = 'components/profile-card.blade.php'
const CARD_PATH = join(JS_DIR, '..', 'resources', 'views', 'components', 'profile-card.blade.php')

/**
 * The guards of the write path, with the number of call sites each must have.
 *
 * **Why a COUNT and not just "is it called".** Each of these is a step whose removal is
 * invisible to every behaviour test that cannot produce its rare precondition:
 *
 * | call | what a removal breaks in production |
 * |---|---|
 * | `readOwnFollowList` | three times: arming (the `listSeen` verdict), the merge base of a write, and the re-read that checks the relay meant its `OK`. Drop the first and the button never leaves the unknown state; drop the second and every write is blind; drop the third and a `created_at` that lost the race counts as delivered |
 * | `readFollowListFrom` | the per-relay read. Replace it with one `load` over the set and the `EOSE` becomes a single merged verdict that can no longer say WHICH relay answered — the staged rule below is then undecidable |
 * | `planFollowWrite` | the whole gate — no-answer, self-follow, unknown relay kind and no-op all leave the path at once |
 * | `followedPubkeysOf` | twice: the rendered list, and the DIRECTION of a click. Drop the second and `add` comes from a cache that is empty until a relay answers |
 * | `mayWriteKind` | the card offers an action on a space whose kind is still in flight |
 * | `followWriteConfirmed` | a replaceable event dropped for a stale `created_at` reads as success |
 * | `publishSpreadOptimistic` | nothing reaches the relays; the local store carries a follow that exists nowhere. The SPREAD form specifically: `publishOptimistic` flattens the per-relay outcome back to one string, and then a write that landed on two of three relays is rolled back in the interface |
 * | `makeEvent` | exactly one place builds the event — a second is a second way to the relay, past the gate |
 *
 * **P2 added six, and every one of them is a step no behaviour test of the pure half can
 * see** — the pure functions keep passing while the writer stops asking them:
 *
 * | call | what a removal breaks in production |
 * |---|---|
 * | `eigeneOutboxUrls` | twice: the read set and the write set. Drop either and that direction is back to the space relay alone, which is the whole defect P2 removes |
 * | `followRelayTargets` | twice, same two directions. This is where the space stays IN the set next to the outbox; without it a reader with no kind 10002 has no target at all |
 * | `followListAnswered` | the staged verdict. Without it `answered` falls back to "somebody said EOSE", the space qualifies, and a kind 3 with one entry is what gets published |
 * | `winningFollowList` | the NIP-01 resolution across relays. Replace it with a tag union and every unfollow a relay has not caught up with comes back — silently, permanently, and looking like success |
 * | `followListWins` | twice: the rendered list and the adoption of a read. Drop it and the label is decided by whichever answer arrived last |
 * | `adoptReadList` | three times: arming, a click, and the re-read after a write. Drop them and the card renders the space relay's copy while `toggle()` decides from the real one — a button labelled „Folgen" that unfollows |
 */
const WRITE_GUARDS: Readonly<Record<string, number>> = {
    readOwnFollowList: 3,
    readFollowListFrom: 1,
    planFollowWrite: 1,
    followedPubkeysOf: 2,
    mayWriteKind: 1,
    followWriteConfirmed: 1,
    publishSpreadOptimistic: 1,
    makeEvent: 1,
    eigeneOutboxUrls: 2,
    followRelayTargets: 2,
    followListAnswered: 1,
    winningFollowList: 1,
    followListWins: 2,
    adoptReadList: 3,
}

/** Names of the write half that must have exactly one caller in the whole production tree. */
const WRITE_HALF_CALLERS: Readonly<Record<string, string>> = {
    [GATE]: WRITER,
    // Behind the gate, inside the pure half: the tag algebra is called by the plan and by
    // nobody else. A second caller would be a tag list that never passed the refusals.
    withFollowedPubkey: 'followModels.ts',
    withoutFollowedPubkey: 'followModels.ts',
}

/**
 * `@welshman/app`'s contact-list plugin and the two loader names it is built from.
 *
 * Forbidden as IMPORTS, not as words: `follows.ts` and `followModels.ts` both name them
 * in prose to explain the refusal, and `spaceCaps.ts`/`buzzAdmin.ts` legitimately call a
 * `forceLoad` **method** on a different plugin. Only an import binding is a way in.
 */
const FORBIDDEN_IMPORTS = ['FollowLists', 'forceLoad', 'forceLoadFollowList']

/** The module those names come from — a namespace import of it is a way past the list above. */
const PLUGIN_MODULE = '@welshman/app'

const befundFuer = (datei: string): Quellenbefund => liesDatei(join(JS_DIR, datei), datei)

const zaehle = (befund: Quellenbefund, name: string): number =>
    befund.aufrufe.filter((aufruf) => aufruf === name).length

const kurz = (stelle: Wertstelle): string => `${stelle.art} ${stelle.name} ${stelle.form}`

/** Every place in `datei` whose VALUE is the answer of `wache()`, as sorted short labels. */
const wertstellen = (datei: string, wache: string): string[] =>
    befundFuer(datei).werte.filter((stelle) => stelle.ruft === wache).map(kurz).sort()

const quelleDesWriters = (): string => readFileSync(join(JS_DIR, WRITER), 'utf8')

/**
 * The follow button, whole — opening tag, label and closing tag — with whitespace
 * flattened.
 *
 * Sliced out of the ACTIVE markup (Blade comments already removed by `readBlade`), because
 * the reasoning above the button names `listSeen` and „Folgen" repeatedly and a scanner
 * that read the comments would pass on the strength of prose alone.
 *
 * `data-person-follow` is matched without a trailing word character: the error line below
 * carries `data-person-follow-fehler` and would otherwise be the anchor.
 */
const folgenKnopf = (): string => {
    const { active } = readBlade(CARD_PATH, CARD)
    const anker = active.search(/data-person-follow(?![\w-])/)
    assert.ok(anker > 0, `${CARD}: no element carries data-person-follow — the follow button is gone entirely.`)
    const start = active.lastIndexOf('<flux:button', anker)
    const ende = active.indexOf('</flux:button>', anker)
    assert.ok(start >= 0 && ende > start, `${CARD}: data-person-follow does not sit on a flux:button.`)

    return flattenWhitespace(active.slice(start, ende + '</flux:button>'.length))
}

/**
 * The P2 notice under the button — „this list is not findable outside this space" — whole,
 * with whitespace flattened.
 *
 * Sliced out of the ACTIVE markup for the same reason as the button: the comment above it
 * explains the gating in prose and names both fields, so a scanner that read the comments
 * would pass on the strength of the explanation alone.
 */
const lokalHinweis = (): string => {
    const { active } = readBlade(CARD_PATH, CARD)
    const anker = active.indexOf('data-person-follow-lokal')
    assert.ok(
        anker > 0,
        `${CARD}: no element carries data-person-follow-lokal. A reader without a NIP-65 relay list then gets `
            + 'told nothing: their contact list is written to the space relay only, where no other client of '
            + 'theirs will ever look for it, and the surface claims a reach the list does not have.',
    )
    const start = active.lastIndexOf('<flux:text', anker)
    const ende = active.indexOf('</flux:text>', anker)
    assert.ok(start >= 0 && ende > start, `${CARD}: data-person-follow-lokal does not sit on a flux:text.`)

    return flattenWhitespace(active.slice(start, ende + '</flux:text>'.length))
}

describe('P1/P2 latch: a follow is never written blind, and it is written where it can be found', () => {
    // ── Calibration ─────────────────────────────────────────────────────────
    //
    // Without these, every "does not call X" below is worth nothing: a scanner that read
    // the wrong file reports exactly what a clean one does.

    test('CALIBRATION: the scanner really reads follows.ts', () => {
        const befund = befundFuer(WRITER)
        assert.ok(
            befund.aufrufe.length >= MIN_AUFRUFE,
            `only ${befund.aufrufe.length} calls seen in ${WRITER} (at least ${MIN_AUFRUFE} expected)`,
        )
        // A call that has nothing to do with this latch — it belongs to the READ half.
        assert.ok(
            ruftAuf(befund, 'ownFollowList'),
            `${WRITER} does not call ownFollowList() — the scanner reads the wrong file`,
        )
    })

    test('CALIBRATION: the scanner really reads the profile card', () => {
        const knopf = folgenKnopf()
        assert.ok(knopf.length > 200, `the sliced follow button is only ${knopf.length} characters long`)
        assert.ok(knopf.includes('x-on:click'), `${CARD}: the sliced button has no click handler at all`)
        assert.ok(knopf.includes('$store.follows'), `${CARD}: the sliced button does not read $store.follows`)
    })

    // ── Core: the write path ────────────────────────────────────────────────

    test(`CORE: ${WRITER} goes through ${GATE}`, () => {
        const befund = befundFuer(WRITER)
        assert.ok(
            importiertAus(befund, GATE, DATA_MODULE),
            `${WRITER} does not import ${GATE} from ${DATA_MODULE}.`,
        )
        assert.ok(
            ruftAuf(befund, GATE),
            `${WRITER} does not call ${GATE}() — the no-answer refusal is off the path, and a blind write `
                + 'replaces the contact list with whatever this tab happened to see.',
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

    /**
     * **The plan is the write decision, not a call beside it.**
     *
     * Counting calls is a deletion detector. A gate that is still called and whose answer
     * is dropped keeps every count intact — the neighbouring latch found exactly that in
     * review. So the question goes to the AST: the value each guard produces has to BE
     * that call. Append `?? {…}` or `|| true` and the expression is no longer a
     * `CallExpression`, the site drops out of the expected set, and this case goes red.
     *
     * | guard | what a discarded or widened answer costs |
     * |---|---|
     * | `planFollowWrite` | the gate is asked and overruled; a refusal turns into a body |
     * | `readOwnFollowList` | the merge base and the `OK` check come from somewhere other than the relay |
     * | `followedPubkeysOf` | the rendered list, and the direction of a click, stop being the read list |
     * | `mayWriteKind` | the card offers the action while the relay kind is unknown |
     * | `followWriteConfirmed` | a silently dropped replaceable event reads as success |
     * | `followListAnswered` | the staged verdict is asked and then overruled — `?? true` here is the one-entry kind 3 |
     * | `eigeneOutboxUrls` | the outbox is looked up and then not used; the read falls back to the space relay |
     * | `followListWins` | the rendered list stops being the NIP-01 winner of the two sources |
     * | `publishSpreadOptimistic` | the per-relay outcome is discarded, and a partial write reads as a total failure |
     */
    test('CORE: the answer of every guard IS the value — asked of the AST, not of the text', () => {
        const ERWARTET: ReadonlyArray<readonly [string, string[], string]> = [
            [GATE, ['binding plan CallExpression'],
                'the event body and the refusal are one value; a fallback beside it is a write past the gate.'],
            ['readOwnFollowList', ['binding after CallExpression', 'binding answer CallExpression'],
                'toggle() and publishFollowList() must BE the relay read, not merely trigger it.'],
            ['followedPubkeysOf', ['assignment self.following CallExpression', 'binding followedNow CallExpression'],
                'the rendered list AND the direction of a click come from a list somebody read.'],
            ['mayWriteKind', ['assignment self.canFollow BinaryExpression&&'],
                'the offered action must be derived from the relay kind.'],
            ['followWriteConfirmed', ['return publishFollowList ConditionalExpression'],
                'the confirmation must decide the return value, not be computed beside it.'],
            // ── P2 ──────────────────────────────────────────────────────────
            ['eigeneOutboxUrls', ['binding outboxUrls CallExpression'],
                'the relays a contact list is read from must BE the reader\'s outbox, not a value beside it.'],
            ['followRelayTargets', ['binding targets CallExpression'],
                'the read set must BE outbox ∪ space. The write set passes the same call inline, which the '
                    + 'count in WRITE_GUARDS and the source case further down cover.'],
            ['followListAnswered', ['binding answered CallExpression'],
                'the staged verdict must BE the answer; `|| true` next to it is the one-entry kind 3 returning.'],
            ['followListWins', ['return ownList ConditionalExpression'],
                'the rendered list must be the NIP-01 winner of the two sources, not whichever arrived last.'],
            ['publishSpreadOptimistic', ['binding spread CallExpression'],
                'the per-relay outcome must be kept: a write that landed on two of three relays is not a failure.'],
        ]

        for (const [wache, erwartet, folge] of ERWARTET) {
            assert.deepEqual(
                wertstellen(WRITER, wache),
                erwartet,
                `${WRITER}: the value sites built from ${wache}() are [${wertstellen(WRITER, wache).join(' | ')}], `
                    + `expected [${erwartet.join(' | ')}]. ${folge} An appended \`|| true\` shows up here as a `
                    + 'missing entry, because the expression is then a BinaryExpression and not a call.',
            )
        }
    })

    test('CORE: a refused plan is honoured, not overruled', () => {
        // `if (!plan) {` is anchored at BOTH ends — `if (` on the left, `) {` on the
        // right — so an appended condition breaks the match rather than slipping past it.
        // Measured in the neighbouring latch on 2026-09-05: a prefix match is not beaten
        // by deleting, it is beaten by appending, and this is one of the shapes that
        // survives an append.
        const quelle = flattenWhitespace(quelleDesWriters())
        assert.ok(quelle.includes(`const plan = ${GATE}({`), `${WRITER}: the plan is no longer bound at all.`)
        assert.ok(
            quelle.includes('if (!plan) {'),
            `${WRITER}: the refusal of ${GATE} is not honoured. A fallback beside the gate means the gate is `
                + 'asked and overruled — and every call count stays intact.',
        )
    })

    test('CORE: the direction of a click comes from the READ list, not from the cache', () => {
        const quelle = flattenWhitespace(quelleDesWriters())
        assert.ok(
            quelle.includes('const followedNow = followedPubkeysOf(answer.list)'),
            `${WRITER}: the direction is no longer derived from the answer of the relay read. `
                + '`self.following` is [] until a relay answers, so `add` would be true for everybody the user '
                + 'already follows — a signed event whose only effect is to sort that person to the front.',
        )
        assert.ok(
            quelle.includes('const add = !followedNow.includes(target)'),
            `${WRITER}: \`add\` is no longer that list's verdict.`,
        )
    })

    // ── Core: welshman's plugin stays out ───────────────────────────────────

    test("CORE: nobody imports welshman's FollowLists plugin or its loader", () => {
        const module = sammleModule(JS_DIR)
        const treffer: string[] = []
        for (const datei of module) {
            for (const stelle of befundFuer(datei).importe) {
                if (FORBIDDEN_IMPORTS.includes(stelle.exportName)) {
                    treffer.push(`${datei}: ${stelle.exportName} from ${stelle.modul}`)
                }
            }
        }
        assert.deepEqual(
            treffer,
            [],
            `forbidden import(s): ${treffer.join(' · ')}. FollowLists.update() builds its writer from `
                + '`await forceLoad(pubkey)`, and that returns `undefined` on a dead socket — no error, no flag, '
                + 'and a kind 3 with one entry is what gets published.',
        )
    })

    test(`CORE: nobody namespace-imports ${PLUGIN_MODULE} either`, () => {
        // The documented blind spot of the case above: `import * as app from
        // '@welshman/app'` records the export name `*`, and `app.FollowLists` would then
        // be a property access the scanner cannot resolve. Closing it costs one
        // assertion, and no module in this tree needs the form.
        const module = sammleModule(JS_DIR)
        const treffer = module.filter((datei) =>
            befundFuer(datei).importe.some((stelle) => stelle.modul === PLUGIN_MODULE && stelle.exportName === '*'),
        )
        assert.deepEqual(
            treffer,
            [],
            `${treffer.join(', ')} namespace-imports ${PLUGIN_MODULE}, which puts every forbidden name back `
                + 'within reach behind a property access.',
        )
    })

    // ── Core: where `listSeen` comes from ───────────────────────────────────

    /**
     * **The one link no call count can reach.**
     *
     * `listSeen` is only as good as its source: it must be the relay's `EOSE` and nothing
     * else. Hard-wiring it to `true` — a one-word edit that reads like a simplification —
     * turns the third button state into decoration while every count stays intact and
     * every case in `followModels.test.ts` stays green.
     *
     * Two assertions, because the hard-wire has two shapes. An ASSIGNMENT
     * (`self.listSeen = true`) shows up in the AST as a `TrueKeyword` form that is not in
     * the expected set. The INITIAL VALUE in the store literal is not an assignment at
     * all, so that one is pinned on the text — anchored at both ends by `: ` and `,` —
     * plus a field count, because `{ listSeen: false, …, listSeen: true }` is legal
     * JavaScript in which the last key wins while the first still reads correctly.
     */
    test('CORE: the listSeen verdict is only ever set from a relay answer', () => {
        const stellen = befundFuer(WRITER).werte.filter((stelle) => stelle.name === 'self.listSeen').map(kurz).sort()
        assert.deepEqual(
            stellen,
            [
                // toggle(): adopt the verdict of the read it just did, never lose one.
                'assignment self.listSeen BinaryExpression||',
                // armSource(): a new space or identity — nothing seen yet.
                'assignment self.listSeen FalseKeyword',
                // the arming read has answered (or timed out): `read.answered`.
                'assignment self.listSeen PropertyAccessExpression',
            ],
            `${WRITER}: the assignments to self.listSeen are [${stellen.join(' | ')}]. A \`TrueKeyword\` among `
                + 'them is a hard-wired verdict, and then the button claims to know the follow state of a list '
                + 'nobody has read.',
        )
    })

    test('CORE: the store starts in the unknown state, exactly once', () => {
        const quelle = flattenWhitespace(quelleDesWriters())
        assert.ok(
            quelle.includes('listSeen: false,'),
            `${WRITER}: the store no longer starts at listSeen: false. Starting at true means every surface `
                + 'treats the first tick as informed — which is the whole defect this phase removes.',
        )
        const felder = befundFuer(WRITER).werte
            .filter((stelle) => stelle.art === 'binding' && stelle.name === 'store')
            .flatMap((stelle) => stelle.felder)
        assert.ok(felder.length > 5, `${WRITER}: the store literal has ${felder.length} fields — wrong binding read.`)
        assert.equal(
            felder.filter((feld) => feld === 'listSeen=').length,
            1,
            `${WRITER}: the store literal carries ${felder.filter((f) => f === 'listSeen=').length} listSeen fields. `
                + 'A duplicate key wins in JS while the first one still stands there looking right.',
        )
    })

    test('CORE: the answered verdict still comes from the relay EOSE', () => {
        const quelle = quelleDesWriters()
        assert.ok(quelle.length > 4_000, `${WRITER} is only ${quelle.length} bytes — the scanner reads the wrong file`)
        assert.ok(quelle.includes('export const readOwnFollowList'), `${WRITER} no longer defines readOwnFollowList`)

        assert.match(
            quelle,
            /let answered = false/,
            `${WRITER}: the verdict no longer starts at false. Starting at true means every write is treated as `
                + 'informed, including the ones where the relay said nothing at all.',
        )
        assert.match(
            quelle,
            /onEose:\s*\(\)\s*=>\s*\{\s*answered\s*=\s*true/,
            `${WRITER}: the verdict is no longer set from the request's onEose. Then \`listAnswered\` is not the `
                + `relay's answer any more, and the gate in ${GATE} is decoration.`,
        )
    })

    test('CORE: readOwnFollowList returns the COLLECTED verdict, in the shorthand', () => {
        const rueckgaben = befundFuer(WRITER).werte.filter(
            (stelle) => stelle.art === 'return' && stelle.name === 'readOwnFollowList',
        )
        assert.ok(
            rueckgaben.length >= 2,
            `${WRITER}: readOwnFollowList has ${rueckgaben.length} return(s) — the scanner reads the wrong file.`,
        )

        const gesammelt = rueckgaben.filter((stelle) => stelle.felder.join(',') === 'answered,list=,outboxUrls')
        assert.equal(
            gesammelt.length,
            1,
            `${WRITER}: readOwnFollowList has ${gesammelt.length} return(s) of the form `
                + '{ answered, list: …, outboxUrls }, expected 1. A hard-wired `answered: true` turns the shorthand '
                + 'into a field with its own value; a duplicate `answered: true` appended to the same object wins in '
                + 'JS while the shorthand stands. `outboxUrls` is a shorthand for the same reason — it is what the '
                + 'card gates its "this list is not findable outside this space" notice on, and a literal `[]` there '
                + 'would silence the notice for everybody.',
        )
    })

    // ── Core: P2 — outbox ∪ space in BOTH directions ────────────────────────

    /**
     * **The two relay sets, pinned where a count cannot reach.**
     *
     * `WRITE_GUARDS` proves that `followRelayTargets` is called twice. It cannot prove
     * WHAT it is called with — and `followRelayTargets([], url)` keeps every count intact
     * while putting the read and the write back on the space relay alone, which is the
     * defect this phase exists for.
     *
     * Matched against the raw source with `\s*` rather than the flattened text: the write
     * call spans lines, and a regex anchored on both sides of the argument survives
     * reformatting while still going red when either half of the union is removed.
     */
    test('CORE: the READ set is outbox ∪ space', () => {
        const quelle = quelleDesWriters()
        assert.match(
            quelle,
            /const targets = followRelayTargets\(outboxUrls, url\)/,
            `${WRITER}: the read no longer asks outbox ∪ space. Against the space relay alone a contact list is `
                + 'practically never found — a closed NIP-29 relay stands in nobody\'s NIP-65 list — so the merge '
                + 'base comes back empty and a follow written on it is a kind 3 with one entry.',
        )
    })

    test('CORE: the WRITE set is outbox ∪ space, through the same function', () => {
        const quelle = quelleDesWriters()
        assert.match(
            quelle,
            /publishSpreadOptimistic\(\s*followRelayTargets\(eigeneOutboxUrls\(\), url\)/,
            `${WRITER}: the write no longer goes to outbox ∪ space. Writing the contact list to the space relay `
                + 'only leaves it invisible to every other client the reader uses — kind 3 is the object those '
                + 'clients build their feed from.',
        )
    })

    /**
     * **The outbox has to be ASKED before it is snapshotted.**
     *
     * `eigeneOutboxUrls()` is a synchronous projection over the repository. Measured in
     * this tree on 2026-09-14: **no module requests kind 10002 for the reader's own
     * pubkey** — `bridge.ts` derives it for display, and the one path that fetches it as a
     * side effect (`Profiles.load(me)`) runs on the wallet settings island and in the
     * member directory. Without this load the projection is empty for nearly every
     * reader, "outbox ∪ space" is "space", and the whole phase measures green while doing
     * nothing.
     */
    test('CORE: the relay list is fetched before the outbox is read off', () => {
        const quelle = quelleDesWriters()
        assert.match(
            quelle,
            /await app\.use\(RelayLists\)\.load\(self\)/,
            `${WRITER}: the reader's NIP-65 list is no longer fetched before eigeneOutboxUrls() is asked. The `
                + 'projection is then a cold snapshot: empty means "nobody looked", the empty-outbox branch of the '
                + 'staged verdict is taken, and an EOSE from the space relay clears a write again.',
        )
    })

    /**
     * **A partial write is not a failure**, and the distinction only exists because the
     * publish goes to several relays now.
     *
     * `publishSpreadOptimistic` reports `error` even when the event landed somewhere —
     * its own header carries the measurement. Reading that string as the verdict would
     * tell the reader their follow failed while it stands, publicly, on two of their
     * three relays.
     */
    test('CORE: the write counts as failed only when it landed NOWHERE', () => {
        const quelle = flattenWhitespace(quelleDesWriters())
        assert.ok(
            quelle.includes('if (spread.delivered.length === 0) {'),
            `${WRITER}: the failure question is no longer "did it land anywhere". With a set of relays a partial `
                + 'result is the ordinary case, and reporting it as a failure contradicts a write that happened.',
        )
    })

    // ── Core: the surface ───────────────────────────────────────────────────

    /**
     * **The third state, on the button itself.**
     *
     * Removing this check from the markup makes nothing else red: no pure test can see a
     * button, and the store keeps working. The card would simply go back to saying
     * „Folgen" for everybody — including the 700 people the reader already follows — and
     * that is indistinguishable from a correct empty list.
     *
     * Both directions are asserted, because a latch that only pins the CONDITION is blind
     * to the whole site disappearing: the label must be gated as well, and the button
     * must not be hidden instead of being made inert.
     */
    test('CORE: the follow button announces the unknown state instead of claiming one', () => {
        const knopf = folgenKnopf()
        assert.ok(
            knopf.includes(`x-bind:aria-disabled="$store.follows?.listSeen ? null : 'true'"`),
            `${CARD}: the follow button no longer goes inert while the contact list is unseen. It then invites a `
                + 'click whose direction nobody has read.',
        )
        assert.match(
            knopf,
            /x-text="!\$store\.follows\?\.listSeen \?/,
            `${CARD}: the LABEL is no longer gated on listSeen. „Folgen" while nothing has been read is exactly `
                + 'the claim this phase removes — an inert button carrying that word still makes it.',
        )
    })

    test('CORE: the unknown state is inert, not disabled and not hidden', () => {
        const knopf = folgenKnopf()
        assert.ok(
            !/(?<![-\w])disabled\s*=/.test(knopf),
            `${CARD}: the follow button carries a real \`disabled\`. That drops it out of the tab order, so the `
                + 'reason never reaches a screen reader — and Playwright\'s click() then waits 30 s on it.',
        )
        const xShow = /x-show="([^"]*)"/.exec(knopf)
        assert.ok(xShow, `${CARD}: the follow button has no x-show at all.`)
        assert.ok(
            !xShow[1].includes('listSeen'),
            `${CARD}: the follow button is HIDDEN while the list is unseen (x-show="${xShow[1]}"). A missing `
                + 'button is indistinguishable from "following is impossible here"; the third state has to be visible.',
        )
    })

    /**
     * **The notice, and the two conditions it hangs on.**
     *
     * Gating it on `listSpaceOnly` alone would show it to everybody during the first
     * seconds of every page: before a read comes back the outbox is empty because nobody
     * has looked yet, which is not a statement about this reader at all. Gating it on
     * `listSeen` alone would show it to everybody, full stop. Both, or it lies in one
     * direction or the other.
     */
    test('CORE: the card says when the list is findable in this space only', () => {
        const hinweis = lokalHinweis()
        const xShow = /x-show="([^"]*)"/.exec(hinweis)
        assert.ok(xShow, `${CARD}: the P2 notice has no x-show at all — it would stand on every card, always.`)
        assert.ok(
            xShow[1].includes('listSpaceOnly'),
            `${CARD}: the notice does not hang on listSpaceOnly (x-show="${xShow[1]}").`,
        )
        assert.ok(
            xShow[1].includes('listSeen'),
            `${CARD}: the notice does not hang on listSeen (x-show="${xShow[1]}"). Before a read has come back `
                + '„no relay list" and „nobody looked yet" are the same empty outbox, and only one of them is '
                + 'about this reader.',
        )
        assert.ok(
            hinweis.includes('NIP-65'),
            `${CARD}: the notice no longer names the reason. „Not findable" without „because no NIP-65 relay list `
                + 'is on file" is something the reader cannot act on.',
        )
    })

    test('CORE: the store is wired into the island, or no surface has it', () => {
        // The card hangs on `$store.follows`; without this call the button renders
        // nothing and says nothing about why.
        const befund = befundFuer('bridge.ts')
        assert.ok(
            importiertAus(befund, 'wireFollows', './follows.ts'),
            'bridge.ts does not import wireFollows from ./follows.ts.',
        )
        assert.ok(ruftAuf(befund, 'wireFollows'), 'bridge.ts does not call wireFollows() — $store.follows never exists.')
    })
})
