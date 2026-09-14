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
import { readFileSync, readdirSync } from 'node:fs'
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
import ts from 'typescript'
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
 * **P2, and then the audit repairs, added a layer of these** — every one is a step no
 * behaviour test of the pure half can see, because the pure functions keep passing while
 * the writer stops asking them:
 *
 * | call | what a removal breaks in production |
 * |---|---|
 * | `readOwnRelayList` / `readRelayListFrom` | the reader's kind 10002 is no longer resolved with a verdict of its own. „No relay list" and „could not ask" collapse back into one empty array — F2, where a single socket error licensed a space-only write and the card called it the harmless reason |
 * | `declaredWriteRelaysOf` | twice: the relays to ask for the 10002, and the write set itself. The target set stops being the DECLARED one |
 * | `outboxKnowledgeOf` | the three-way verdict becomes two-way again |
 * | `normalizeRelaySet` | the relay-list targets stop being normalised and de-duplicated, so the same indexer can be asked twice and counted twice |
 * | `followRelayTargets` | ONCE, and that is the point: the set is drawn in the read and carried to the write. A second call here is F3 coming back |
 * | `followListAnswered` | twice — the contact list and the relay list. Without it `answered` falls back to "somebody said EOSE", which is F1 |
 * | `unansweredRelays` / `refusalReason` | the strict rule refuses without saying which relay is silent, and a reader with a dead entry in their own relay list can never act on it |
 * | `writeRefused` | the failure message names the space again, which after P2 is usually not the relay that blocked |
 * | `winningFollowList` | twice — the contact list and the relay list. Replace either with a tag union and every entry a relay has not caught up with comes back, silently and permanently |
 * | `followListWins` / `newestOwnEvent` | the NIP-01 resolution. Drop it and whichever answer arrived last decides |
 * | `followRelayTargets` | ONE call, and since N1 it is also the only place that knows what the target set is. Its arguments are the verdict, the declaration and the fallback — the space is not among them |
 * | `adoptReadList` | three times: arming, a click, and the re-read after a write. Drop them and the card renders the space relay's copy while `toggle()` decides from the real one — a button labelled „Folgen" that unfollows |
 */
const WRITE_GUARDS: Readonly<Record<string, number>> = {
    readOwnFollowList: 2,
    readFollowListsFrom: 2,
    readFollowListFrom: 2,
    readOwnRelayList: 1,
    readRelayListFrom: 1,
    planFollowWrite: 1,
    followedPubkeysOf: 2,
    mayWriteKind: 1,
    // F5 and D2 — both relay reads of this module go through a context of their own.
    baseReadContext: 2,
    // D2: two reads on the repository-free context now — the contact list and the kind 10002.
    requestOneWithoutRepository: 2,
    // F6 — the read-only sources reach the base and nothing else.
    normalizeRelaySet: 2,
    // F7 — the arming pass asks only what the reader declared.
    armingReadsContactList: 1,
    followWriteConfirmed: 1,
    // The local door of D1, and the shared helper behind it — one call each. Widening
    // `publishSpreadOptimistic` for this caller would put the demand on `js/calendar.ts` too.
    publishToTargetSet: 1,
    publishSpreadOptimistic: 1,
    // D1: the empty set still goes through the one minting site, at every early exit.
    noFollowTargets: 3,
    makeEvent: 1,
    declaredWriteRelaysOf: 2,
    outboxKnowledgeOf: 1,
    followRelayTargets: 1,
    followListAnswered: 1,
    // K7: the relay-list verdict asks a DIFFERENT question and must use a different
    // function. Fusing the two would put a `some` one refactor away from the F1 riegel.
    anyRelayAnswered: 1,
    unansweredRelays: 2,
    refusalReason: 2,
    writeRefused: 2,
    winningFollowList: 2,
    newestOwnEvent: 2,
    followListWins: 1,
    adoptReadList: 3,
    // N1: the contact list is asked for ONCE per read, per relay — the live subscription
    // that used to stand open on the space relay is gone, not moved to the targets.
    followFilters: 1,
    // N1: the repository is not a source for a kind 3 any more. `ownFollowList` survives
    // in exactly one place, inside the per-relay read, where it picks the newest of what
    // THAT relay just sent.
    ownFollowList: 1,
}

/**
 * **Names that must not appear in this module at all — N1.**
 *
 * `deriveEventsForUrl` is the repository read that made the space copy a base source:
 * a one-tag kind 3 written to the space in an earlier session came back through it, from
 * the relay and after a reload from IndexedDB as well (`FOLLOWS` is in `PERSIST_KINDS`
 * and `js/storage.ts` restores the tracker line with it), and being the newest event of
 * its address it won the NIP-01 comparison. 700 contacts to two, measured over two
 * sessions.
 *
 * `request` is the live subscription that stood open on the space for our own kind 3. It
 * delivered nothing — a contact list is not on the space — and pointing it at the target
 * relays instead would have meant a permanent presence signal on up to four foreign
 * relays.
 */
const FORBIDDEN_IN_WRITER = ['deriveEventsForUrl', 'request']

/**
 * **The relay picker that must NOT be on this path — F3.**
 *
 * `eigeneOutboxUrls()` puts the declared relays through a `RelayScenario`: at most three
 * of them (`getLimit()` defaults to 3), chosen with `Math.random()` in `scoreRelay`, and
 * with every relay whose live quality is `0` dropped entirely. For a read that is a
 * sensible optimisation. As the target set of a REPLACEABLE write it means the write goes
 * somewhere else than the read looked — measured at 88.7 % of follows over 20 000 draws —
 * and that a single socket error silently shrinks the set the verdict was formed over.
 */
const FORBIDDEN_RELAY_PICKERS = ['eigeneOutboxUrls', 'szenarioAusUrls']

/** Names of the write half that must have exactly one caller in the whole production tree. */
const WRITE_HALF_CALLERS: Readonly<Record<string, string>> = {
    [GATE]: WRITER,
    // Behind the gate, inside the pure half: the tag algebra is called by the plan and by
    // nobody else. A second caller would be a tag list that never passed the refusals.
    withFollowedPubkeys: 'followModels.ts',
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
 * The name of the nearest enclosing named declaration — which function a node sits in.
 *
 * Used to say WHERE a brand is minted rather than only how often: „once, somewhere in the
 * file" would be satisfied by a cast that moved out of `mintTargetSet` into a caller.
 */
/**
 * **A floor under the file count of the brand scan.**
 *
 * 328 TypeScript files lay under `js/` when this was written, 5 of them in `js/fixtures/`.
 * Stated well below that so ordinary deletions do not trip it — it is not a census, it is
 * a guard against a scan that stopped reading. It cannot on its own catch a scan that only
 * stopped DESCENDING, which is why the case pairs it with a subdirectory check.
 */
const SCAN_FLOOR = 250

/**
 * Every `.ts` file under a directory, recursively, as paths relative to it.
 *
 * `readdirSync(dir)` — no `recursive` — is what this replaces, and the difference was a
 * measured bypass: a second minting site in `js/fixtures/` was invisible to it while the
 * assertion above still reported one minter (S3).
 */
const tsFilesUnder = (dir: string): string[] =>
    readdirSync(dir, { recursive: true, encoding: 'utf8' })
        .filter((entry: string) => entry.endsWith('.ts'))

const enclosingDeclarationName = (node: ts.Node): string => {
    for (let parent = node.parent; parent; parent = parent.parent) {
        if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) {
            return parent.name.text
        }
        if ((ts.isFunctionDeclaration(parent) || ts.isMethodDeclaration(parent)) && parent.name) {
            return parent.name.getText()
        }
    }

    return '(top level)'
}

/**
 * The writer's source with every comment removed — for the few checks that ask „does this
 * LITERAL appear anywhere", where a well-commented file is otherwise its own false
 * positive. `follows.ts` names `answered: true` in prose precisely to explain the hazard,
 * the same way it names `FollowLists` and `forceLoad` to explain why they are not used.
 *
 * The compiler does the stripping, not a regex: a regex literal that looks like a block
 * comment has fooled a gate in this repo before (`importEndungenGate.ts`), and
 * `transpileModule` sees the same tokens `tsc` does.
 */
const codeDesWriters = (): string =>
    ts.transpileModule(quelleDesWriters(), {
        compilerOptions: { removeComments: true, target: ts.ScriptTarget.ESNext },
    }).outputText

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
            ['readOwnFollowList', ['binding answer CallExpression'],
                'toggle() must BE the relay read, not merely trigger it.'],
            ['readFollowListsFrom', ['binding after CallExpression', 'return readOwnFollowList CallExpression'],
                'the read of the contact list, and the re-read that checks the OK, must both BE this call — '
                    + 'and the second one must use the SAME target set it wrote to.'],
            ['readOwnRelayList', ['binding relayList CallExpression'],
                'where to read and write must BE the answer of the relay-list read, gate and all.'],
            ['declaredWriteRelaysOf', ['binding writeUrls CallExpression'],
                'the write relays must BE the declaration in the kind 10002, not a value computed beside it.'],
            ['outboxKnowledgeOf', ['binding knowledge CallExpression'],
                'the three-way verdict must BE the answer; `?? "confirmed-none"` next to it is F2 returning.'],
            ['newestOwnEvent', ['binding cached CallExpression'],
                'the cached relay list must BE the NIP-01 winner over the repository, not the first row found.'],
            ['normalizeRelaySet', ['binding asked CallExpression'],
                'the relays asked for the kind 10002 must BE the normalised, de-duplicated set.'],
            ['followedPubkeysOf', ['assignment self.following CallExpression', 'binding followedNow CallExpression'],
                'the rendered list AND the direction of a click come from a list somebody read.'],
            ['mayWriteKind', ['assignment self.canFollow BinaryExpression&&'],
                'the offered action must be derived from the relay kind.'],
            ['followWriteConfirmed', ['return publishFollowList ConditionalExpression'],
                'the confirmation must decide the return value, not be computed beside it.'],
            // ── P2 ──────────────────────────────────────────────────────────
            ['followListAnswered', ['binding answered CallExpression'],
                'the completeness verdict must BE the answer; `|| true` next to it is the one-entry kind 3 '
                    + 'returning. The second call sits inline in outboxKnowledgeOf(), which the count covers.'],
            ['followRelayTargets', ['binding targets CallExpression'],
                'the target set must BE the answer of that function, not a value computed beside it — a `?? [url]` '
                    + 'there is the space back in the set.'],
            ['publishToTargetSet', ['binding spread CallExpression'],
                'the per-relay outcome must be kept: a write that landed on two of three relays is not a failure. '
                    + 'Through the local door and not through publishSpreadOptimistic directly, because only the '
                    + 'door demands a FollowTargetSet — see D1.'],
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
        assert.ok(
            quelle.includes(`const plan = ${GATE}({`),
            `${WRITER}: the plan is no longer bound at all.`,
        )
        assert.ok(
            quelle.includes('if (!plan) {'),
            `${WRITER}: the refusal of ${GATE} is not honoured. A fallback beside the gate means the gate is `
                + 'asked and overruled — and every call count stays intact.',
        )
    })

    /**
     * **N1: the merge base has exactly one origin.**
     *
     * `adoptReadList` is the only writer of the field the surface and the plan both read,
     * and it only ever takes a list that came out of {@link readFollowListFrom} — i.e.
     * off a relay that is in the target set of this very operation. Before N1 it competed
     * with a repository source scoped to the space, and `ownList()` took the NIP-01 winner
     * of the two; that is how a space stub reached the plan.
     */
    test('CORE: the rendered list IS the read list — no second source beside it', () => {
        const quelle = flattenWhitespace(quelleDesWriters())
        assert.ok(
            quelle.includes('const ownList = (): FollowEventLike | null => readList'),
            `${WRITER}: the rendered list is no longer just what the target relays showed. A second source here `
                + 'is a second way into the merge base, and the space copy is the one that was there before.',
        )
        // The AST scanner records assignments to PROPERTIES, not to plain identifiers, so
        // this one is counted on the text — anchored on both sides and with a count, the
        // same construction the listSeen store literal uses next door.
        assert.ok(
            quelle.includes('if (list && followListWins(list, readList)) { readList = list'),
            `${WRITER}: adoptReadList no longer gates on the NIP-01 comparison, so a later read that found `
                + 'nothing — or an older list — can take the base away again.',
        )
        const schreibstellen = (quelle.match(/\breadList = /g) ?? []).length
        assert.equal(
            schreibstellen,
            2,
            `${WRITER}: readList is assigned at ${schreibstellen} places, expected 2 — the adoption inside `
                + 'adoptReadList and the reset on a new identity. (The declaration carries a type annotation and '
                + 'is not matched here.) A third is a second source for the merge base, which is what N1 was.',
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
                // the arming read came back — ORed for the same reason. Assigning
                // `read.answered` here (a PropertyAccessExpression, which is what stood
                // here until the audit) throws away a verdict a click had already earned:
                // the arming read takes up to twice READ_TIMEOUT_MS and can finish second.
                'assignment self.listSeen BinaryExpression||',
                // armSource(): a new space or identity — nothing seen yet.
                'assignment self.listSeen FalseKeyword',
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

        assert.ok(
            /let answered = false/.test(quelle),
            `${WRITER}: the verdict no longer starts at false. Starting at true means every write is treated as `
                + 'informed, including the ones where the relay said nothing at all.',
        )
        assert.ok(
            /onEose:\s*\(\)\s*=>\s*\{\s*answered\s*=\s*true/.test(quelle),
            `${WRITER}: the verdict is no longer set from the request's onEose. Then \`listAnswered\` is not the `
                + `relay's answer any more, and the gate in ${GATE} is decoration.`,
        )
    })

    test('CORE: readFollowListsFrom returns the COLLECTED verdict, in the shorthand', () => {
        const rueckgaben = befundFuer(WRITER).werte.filter(
            (stelle) => stelle.art === 'return' && stelle.name === 'readFollowListsFrom',
        )
        const gesammelt = rueckgaben.filter(
            (stelle) => stelle.felder.join(',') === 'answered,list,targets,unanswered=,outbox',
        )
        assert.equal(
            gesammelt.length,
            1,
            `${WRITER}: readFollowListsFrom has ${gesammelt.length} return(s) of the form `
                + '{ answered, list: …, targets, unanswered: …, outbox }, expected 1. Each shorthand is load '
                + 'bearing: a hard-wired `answered: true` turns it into a field with its own value, `targets` is '
                + 'the set the write is allowed to use, and `outbox` is what the card gates its "not findable '
                + 'outside this space" notice on. A duplicate key appended to the same object wins in JS while the '
                + 'shorthand still stands there looking right.',
        )
    })

    test('CORE: every early exit of readOwnFollowList refuses — no verdict is ever hard-wired true', () => {
        const rueckgaben = befundFuer(WRITER).werte.filter(
            (stelle) => stelle.art === 'return' && stelle.name === 'readOwnFollowList',
        )
        const objekte = rueckgaben.filter((stelle) => stelle.form === 'ObjectLiteralExpression')
        assert.equal(
            objekte.length,
            3,
            `${WRITER}: readOwnFollowList has ${objekte.length} object returns, expected 3 — the guest exit, the `
                + 'one for an unretrievable relay list, and the F7 arming exit that asks no foreign relay.',
        )
        for (const stelle of objekte) {
            assert.equal(
                stelle.felder.join(','),
                'answered=,list=,targets=,unanswered=,outbox=',
                `${WRITER}: an early exit of readOwnFollowList has fields [${stelle.felder.join(' | ')}].`,
            )
        }
        assert.ok(
            !codeDesWriters().includes('answered: true'),
            `${WRITER}: an \`answered: true\` literal appears in the file. The verdict has exactly one source, `
                + 'the completeness of the relay answers, and a literal beside it is the write this module exists '
                + 'to prevent.',
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
    test('CORE: the target set comes from the verdict, the declaration and the fallback', () => {
        const quelle = quelleDesWriters()
        assert.ok(
            /followRelayTargets\(relayList\.knowledge, relayList\.writeUrls, FOLLOW_FALLBACK_RELAYS\)/.test(quelle),
            `${WRITER}: the target set is no longer built from the three things that may decide it. A space url `
                + 'as a fourth argument is N1 coming back: the space holds no contact list, so it contributes a '
                + '`null` base while being a write target, and the one-tag kind 3 that produces wins the next '
                + "session's NIP-01 comparison.",
        )
    })

    /**
     * **N1: nothing that can never hold a contact list may be in the set.**
     *
     * The fallback is where a reader without a kind 10002 has their list read AND written,
     * so it has to be relays that accept and serve kind 3. Measured read-only on
     * 2026-09-14, each relay checked for liveness with a second query: `nos.lol`,
     * `nostr.oxtr.dev` and `theforest.nostr1.com` served a 704-tag contact list;
     * `indexer.coracle.social` answered and served none at all — this repo already records
     * why, quoting the relay: `blocked: this relay only accepts kind 10002 events`.
     *
     * A relay like that is the worst possible base source: it closes with `EOSE`,
     * contributes `null`, and its answer counts towards completeness. That is why the set
     * the kind 10002 is ASKED of must not be reused as the set the kind 3 is read from,
     * and why this is a latch and not a comment.
     */
    test('CORE: the fallback set is the DEFAULT relays, never the indexers', () => {
        const quelle = quelleDesWriters()
        assert.ok(
            /export const FOLLOW_FALLBACK_RELAYS: readonly string\[\] = DEFAULT_RELAYS/.test(quelle),
            `${WRITER}: the fallback set is no longer DEFAULT_RELAYS. If it becomes INDEXER_RELAYS, then `
                + 'indexer.coracle.social — which answers and serves no kind 3 at all — becomes a base source '
                + 'whose empty answer counts as a complete one.',
        )
        assert.ok(
            !/FOLLOW_FALLBACK_RELAYS[^\n]*INDEXER_RELAYS/.test(quelle),
            `${WRITER}: the fallback set is built from INDEXER_RELAYS.`,
        )
    })

    /**
     * **N1: the space url is an arming scope, not a relay.**
     *
     * It still comes into `readOwnFollowList`, because „is a space active at all" decides
     * whether this surface exists. It must not travel any further than that guard.
     */
    test('CORE: the space url reaches the guard and nothing else', () => {
        const quelle = flattenWhitespace(quelleDesWriters())
        assert.ok(
            quelle.includes('if (!spaceUrl || !self) {'),
            `${WRITER}: the arming guard on the space url is gone.`,
        )
        const verwendungen = (quelle.match(/\bspaceUrl\b/g) ?? []).length
        assert.equal(
            verwendungen,
            3,
            `${WRITER}: \`spaceUrl\` appears ${verwendungen}x in the code, expected 3 — the parameter, the `
                + 'guard, and nothing more. Anything beyond that is the space on its way back into a relay set.',
        )
    })

    /**
     * **N2: exactly one of the three verdicts may be remembered.**
     *
     * `listed` only decides WHICH relays are read and written; every one of them still has
     * to answer the contact-list read itself, which is where the protection sits.
     * `confirmed-none` is the verdict that licenses a write to the fallback set — cached
     * once during a fault it would stand for the whole session, which is F2 with a memory.
     *
     * **This case exists because the promise had no latch.** The mutation that widens the
     * store to `knowledge !== 'unknown'` was run and left every test green, so the
     * asymmetry was prose only. Both halves are pinned here: what may be written into the
     * cache, and what the cache is allowed to claim when it is read.
     */
    test('CORE: only a `listed` verdict may be cached, and the cache may only claim `listed`', () => {
        const quelle = flattenWhitespace(quelleDesWriters())
        assert.ok(
            quelle.includes("if (knowledge === 'listed') { listedRelayCache = { self, writeUrls } }"),
            `${WRITER}: the relay-list cache no longer stores ONLY a listed verdict. A remembered `
                + '`confirmed-none` makes one fault decide every write for the rest of the session.',
        )
        assert.ok(
            quelle.includes("return { knowledge: 'listed', writeUrls: listedRelayCache.writeUrls, unanswered: [] }"),
            `${WRITER}: the cache hit no longer returns a plain listed verdict. It may only ever hand back the `
                + 'one state it is allowed to hold.',
        )
        const speicherstellen = (quelle.match(/listedRelayCache = /g) ?? []).length
        assert.equal(
            speicherstellen,
            1,
            `${WRITER}: listedRelayCache is written at ${speicherstellen} places, expected 1. A second write is `
                + 'a second rule about what may be remembered.',
        )
    })

    /**
     * **F5: the base read must not run through the repository's deletion index.**
     *
     * `@welshman/net` drops every received event for which `repository.isDeleted(event)`
     * holds — before the signature check, before the filter check, and without touching
     * the `EOSE`. The read then reports `answered: true` with zero events, which is the
     * state this whole module exists to avoid. Our own optimistic thunk is enough to
     * trigger it: it puts the new list into the repository, and every target relay still
     * serving the previous one contributes nothing.
     *
     * Both halves are pinned: the context must lose the repository, and the read must use
     * that context. Either one alone is a comment.
     *
     * ── D2: and the kind 10002 read is the same hazard, not a lesser one ───────
     *
     * This case used to assert the opposite for the relay-list read — „only the
     * contact-list base read needs a context of its own; widening that to every read would
     * drop a protection nobody asked to lose". That sentence was wrong, and the audit
     * measured how: a deleted-marked kind 10002 is dropped by the same short-circuit, the
     * `EOSE` still arrives, and `{writeUrls: [], anyAnswered: true}` is read by
     * `outboxKnowledgeOf` as `confirmed-none` — the verdict that PERMITS a write, not the
     * one that refuses. The relay-list read had the worse failure mode of the two and the
     * weaker protection.
     *
     * So both reads are pinned onto the same context now, and the house adapter is gone
     * from this module entirely — there is no third read left that could want it.
     */
    test('CORE: both relay reads run on a context WITHOUT the repository', () => {
        const quelle = flattenWhitespace(quelleDesWriters())
        assert.ok(
            quelle.includes('const baseReadContext = (): NetContext => ({ ...app.netContext, repository: undefined })'),
            `${WRITER}: the base read context no longer drops the repository. It then filters the read through `
                + 'the deletion index, and a superseded-looking event disappears while the EOSE still arrives.',
        )
        // Bounded rather than greedy: the call body contains an arrow function, so a
        // `[^}]*` would stop at its closing brace and report a clean file as broken.
        assert.ok(
            /requestOneWithoutRepository\(\{[\s\S]{0,400}?context: baseReadContext\(\)/.test(quelle),
            `${WRITER}: the per-relay contact-list read no longer uses that context.`,
        )
        assert.ok(
            /const readFollowListFrom = [\s\S]{0,600}?requestOneWithoutRepository/.test(quelle),
            `${WRITER}: the repository-free context is not the one readFollowListFrom uses.`,
        )
        // D2 — the same two halves for the kind 10002 read.
        assert.ok(
            /const readRelayListFrom = [\s\S]{0,700}?requestOneWithoutRepository\(\{[\s\S]{0,400}?context: baseReadContext\(\)/
                .test(quelle),
            `${WRITER}: the relay-list read is back on the app context. A kind 5 the reader signed against their `
                + 'own 10002 then empties the outbox with an EOSE, and `confirmed-none` — the verdict that permits '
                + 'a write — is what comes out.',
        )
        // The negative half of D2, and the reason it can be stated so bluntly: with both
        // reads moved, no caller in this module has any business with the house adapter.
        assert.ok(
            !quelle.includes("from './welshmanNet.ts'"),
            `${WRITER}: the house adapter is imported again. It hands out the app context, repository included, `
                + 'which is the one thing neither read here may have.',
        )
    })

    /**
     * **F6: a read-only source raises the base and votes on nothing.**
     *
     * The accepted risk recorded next door covers `confirmed-none` only; on `listed` the
     * targets are the relays the outbox model points every other client at, so a one-entry
     * kind 3 there is the reader's contact list for the world. An extra SOURCE can only
     * ever raise the base — `winningFollowList` takes the NIP-01 winner across every read.
     * What would make it laxer is letting it be a target, or letting it vote on
     * completeness. Both are pinned here; the count in `WRITE_GUARDS` cannot see either.
     */
    test('CORE: the read-only hints never become targets and never vote', () => {
        const quelle = flattenWhitespace(quelleDesWriters())
        assert.ok(
            quelle.includes('const answered = followListAnswered(targetReads, targets)'),
            `${WRITER}: the completeness verdict can see the hint reads. A hint answering would then stand in `
                + 'for a target that never did — F6 turned back into F1.',
        )
        assert.ok(
            quelle.includes('const list = winningFollowList([...targetReads, ...hintReads])'),
            `${WRITER}: the hints no longer reach the base, which is the only thing they are for.`,
        )
        assert.ok(
            /publishToTargetSet\(\s*read\.targets,/.test(quelleDesWriters()),
            `${WRITER}: the write may go to the targets and to nothing else.`,
        )
        assert.ok(
            !/publishToTargetSet\([^)]*hint/i.test(flattenWhitespace(quelleDesWriters())),
            `${WRITER}: a read-only source reached the write. It was never asked to answer for what it holds.`,
        )
        assert.ok(
            quelle.includes('filter((url: string) => !targets.includes(url))'),
            `${WRITER}: a relay in both sets is asked twice and, worse, looks like two independent sources.`,
        )
    })

    /**
     * **D1: the target set is a TYPE now. This case is the NARROW remainder — read the
     * limits below before you treat it as complete.**
     *
     * ── Why the walk this replaces is gone ─────────────────────────────────────
     *
     * Three rounds, three versions of a source walk, four bypasses — and each version was
     * green against the form nobody had thought of yet:
     *
     * ```ts
     * readFollowListsFrom([...targets, ...hints], …)    // round 6, caught by version 2
     * const merged = [...targets, ...hints]             // round 7, caught by version 3
     * let targets = …; targets = [...targets, ...hints] // round 8, version 3 green
     * targets.push(...hints)                            // round 8, version 3 green
     * ```
     *
     * „Every way to widen an array" is not an enumerable set, so a walk over shapes can
     * only ever be one review behind. {@link FollowTargetSet} moves the rule into the type
     * system, where the compiler decides the class rather than a list deciding the forms:
     * all four are a `tsc` error now, measured with the exit code.
     *
     * ── What this case does, and it is two narrow things ───────────────────────
     *
     *  · repo-wide, exactly ONE type assertion may name `FollowTargetSet`, and it has to
     *    sit in `mintTargetSet`. A second one is a second minting site.
     *  · the assertion census of the two follow modules is pinned, so a new `as any` in
     *    them cannot appear without moving a number in the table below.
     *
     * The table is deliberately a census and not a ban — the three
     * `as unknown as FollowEventLike[]` in the writer are welshman's `TrustedEvent` being
     * narrowed and have nothing to do with relays. Changing them is allowed; changing them
     * silently is not.
     *
     * ── WHAT IT DOES NOT DO. This paragraph is the point of the case. ──────────
     *
     * The version before this one closed with „casts ARE an enumerable category … so a
     * census of them is a complete check rather than a sample", and that sentence was the
     * finding of its own round: it tells the next reviewer they may stop looking. Four ways
     * in were then measured, each with `tsc` exit 0 and this census green:
     *
     * | | acquires the brand without an assertion this case can see |
     * |---|---|
     * | A1 | `JSON.parse(JSON.stringify([...targets, 'wss://…']))` — returns `any` |
     * | A2 | `Object.assign([...targets, ...hints], targets)` — an intersection carries the brand |
     * | A3 | `type Minted = FollowTargetSet` elsewhere, then `urls as Minted` — the text match below never sees an alias |
     * | A4 | **REFUTED** — reported as „mutate the array handed to `mintTargetSet` and the minted set widens", measured false at `9ff152a` before any copy existed: both call sites allocate, and the function is not exported. Kept in the table so it is not re-opened as a lead |
     *
     * Shortest forgery from the exported api, one expression, no `as`, no `any`:
     * `Object.assign(noFollowTargets(), ['wss://attacker.example/'])`.
     *
     * A1 and A3 are **not** closed here and are not meant to be — chasing them one by one
     * is the source walk again, in a new costume. What stands against them is
     * `js/followClickGate.test.ts`: it counts the relays a read asks and the events a write
     * sends, at the wire, where a widened set is extra traffic no matter which syntax
     * produced it. If you are reviewing this area, that file is the instrument, and this
     * one is a tripwire beside it.
     */
    test('CORE: the target-set brand is minted once, and no cast launders one', () => {
        /** `file` → assertion target type → how many. Measured, then pinned. */
        const ASSERTION_CENSUS: Readonly<Record<string, Readonly<Record<string, number>>>> = {
            'followModels.ts': { FollowTargetSet: 1, string: 2 },
            'follows.ts': { 'FollowEventLike[]': 3, FollowsStore: 1, unknown: 3 },
        }

        /** Every `as X` / `<X>y` in a file, counted by the text of X. */
        const censusOf = (file: string): Record<string, number> => {
            const tree = ts.createSourceFile(file, readFileSync(join(JS_DIR, file), 'utf8'), ts.ScriptTarget.Latest, true)
            const counts: Record<string, number> = {}
            const walk = (node: ts.Node): void => {
                if (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) {
                    const key = node.type.getText()
                    counts[key] = (counts[key] ?? 0) + 1
                }
                ts.forEachChild(node, walk)
            }
            walk(tree)

            return counts
        }

        for (const [file, expected] of Object.entries(ASSERTION_CENSUS)) {
            assert.deepEqual(
                censusOf(file),
                expected,
                `${file}: the type assertions in this file are no longer the ones that were reviewed. A new `
                    + 'assertion is the one remaining way to hand an unbranded array to the read or the write '
                    + '— `as any` needs no brand name to do it. Read the new one, then move the number here.',
            )
        }

        // Repo-wide, because the type is exported: any file could mint one.
        //
        // RECURSIVE, and that word is the whole of finding S3. `readdirSync(JS_DIR)`
        // without it sees the top level only, and `js/fixtures/` is a pre-existing
        // subdirectory of ordinary TypeScript. A reviewer put a second minting site there,
        // routed the real target set through it, and got `tsc` exit 0 with 123/123 green
        // while this case still reported exactly one minter. A scanner that finds nothing
        // because it looks nowhere reports the same thing as a clean tree.
        const scanned: string[] = []
        const minters: string[] = []
        for (const entry of tsFilesUnder(JS_DIR)) {
            scanned.push(entry)
            const tree = ts.createSourceFile(entry, readFileSync(join(JS_DIR, entry), 'utf8'), ts.ScriptTarget.Latest, true)
            const walk = (node: ts.Node): void => {
                if (
                    (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node))
                    && node.type.getText().includes('FollowTargetSet')
                ) {
                    const enclosing = enclosingDeclarationName(node)
                    minters.push(`${entry}:${enclosing}`)
                }
                ts.forEachChild(node, walk)
            }
            walk(tree)
        }
        assert.deepEqual(
            minters,
            ['followModels.ts:mintTargetSet'],
            `the brand is minted at ${minters.length} place(s): ${minters.join(', ') || '(none)'}. Exactly one, inside `
                + 'mintTargetSet, is the whole assurance — a second one gives every caller back the cast the type '
                + 'took away. None at all means the type no longer exists and the four bypasses are open again.',
        )

        // ── CALIBRATION of the scan itself ────────────────────────────────────
        //
        // Both halves are needed, and the second is the one S3 was about: a floor on the
        // file count catches a walk that broke outright, but NOT a walk that silently
        // stopped descending — the top level alone is well over any floor worth stating.
        assert.ok(
            scanned.length >= SCAN_FLOOR,
            `the brand scan saw ${scanned.length} TypeScript files, expected at least ${SCAN_FLOOR}. It has stopped `
                + 'reading the tree, and an empty finding list above means nothing while that is true.',
        )
        const fromSubdirectory = scanned.filter((entry: string) => entry.includes('/'))
        assert.ok(
            fromSubdirectory.length > 0,
            'the brand scan saw no file from a subdirectory of js/. That is exactly the blind spot S3 measured: '
                + '`js/fixtures/` is ordinary TypeScript, a minting site there is invisible to a flat readdir, and '
                + 'the case above then passes without having looked.',
        )
    })


    /**
     * **F7: a page load asks only relays the reader chose.**
     *
     * Without this, `confirmed-none` sent `{kinds:[3], authors:[self]}` to four foreign
     * relays on every page view, immediately before any contact-list write, and
     * `relayConfig.ts` grants those relays AUTH. The read still happens — on the click,
     * where P1 already put a retry.
     */
    test('CORE: the arming pass defers the read for anybody but a `listed` reader', () => {
        const quelle = flattenWhitespace(quelleDesWriters())
        assert.ok(
            quelle.includes('if (arming && !armingReadsContactList(relayList.knowledge)) {'),
            `${WRITER}: the arming pass no longer defers. Every page view then announces the reader to four `
                + 'relays they never chose.',
        )
        assert.ok(
            quelle.includes('void readOwnFollowList(url, self, true)'),
            `${WRITER}: the arming call no longer says it is an arming call, so the deferral never fires.`,
        )
        assert.ok(
            /const hints = arming\s*\?\s*\[\]/.test(quelleDesWriters()),
            `${WRITER}: an arming pass takes the read-only hints too — they are foreign relays as well.`,
        )
    })

    test('CORE: the repository and the live subscription are gone from this module', () => {
        const befund = befundFuer(WRITER)
        for (const name of FORBIDDEN_IN_WRITER) {
            assert.equal(
                zaehle(befund, name),
                0,
                `${WRITER} calls ${name}(). See FORBIDDEN_IN_WRITER — one of them is the path a space stub took `
                    + 'back into the merge base, from the relay and from IndexedDB alike.',
            )
            assert.ok(
                !befund.importe.some((stelle) => stelle.exportName === name),
                `${WRITER} imports ${name}. Even unused it is an invitation back into N1.`,
            )
        }
    })

    /**
     * **F3: the write set is the read set, not a second draw.**
     *
     * A count cannot see this. Two calls to `followRelayTargets` would keep every number
     * intact and still produce two different sets — that is exactly what the audit
     * measured, at 88.7 % of follows. So the write has to take the set it was handed, and
     * the argument is pinned rather than the call.
     */
    test('CORE: the WRITE goes to the set the READ used — drawn once', () => {
        const quelle = quelleDesWriters()
        assert.ok(
            /publishToTargetSet\(\s*read\.targets,/.test(quelle),
            `${WRITER}: the write no longer uses the target set of the read it is based on. Every relay in that `
                + 'set answered; that is what makes replacing their copy defensible, and it is true for no other '
                + 'set. A fresh draw here is the finding coming back.',
        )
        assert.ok(
            /readFollowListsFrom\(read\.targets, \[\], me, read\.outbox\)/.test(quelle),
            `${WRITER}: the re-read after the write no longer uses the same relays the write went to, so it `
                + 'answers a different question than the one that was asked.',
        )
    })

    test('CORE: the randomised, quality-filtered relay sample is not on this path', () => {
        const befund = befundFuer(WRITER)
        for (const name of FORBIDDEN_RELAY_PICKERS) {
            assert.equal(
                zaehle(befund, name),
                0,
                `${WRITER} calls ${name}(). That runs the declared relays through a RelayScenario: at most three `
                    + 'of them, picked with Math.random(), and every relay with a live quality of 0 dropped. As '
                    + 'the target set of a replaceable write that means the write lands somewhere else than the '
                    + 'read looked, and one socket error silently shrinks the set the verdict was formed over.',
            )
            assert.ok(
                !befund.importe.some((stelle) => stelle.exportName === name),
                `${WRITER} imports ${name}. Even unused it is an invitation back into F3.`,
            )
        }
    })

    /**
     * **F2: the relay list is a gate, not a lookup.**
     *
     * With {@link OutboxKnowledge} `unknown` there is no honest target set — „this reader
     * has no relay list" and „we could not ask" are indistinguishable, and the second one
     * is produced by a fault. Without this branch the path continues with an empty
     * declaration, which is precisely the space-only write the finding is about.
     */
    test('CORE: an unretrievable relay list stops the read before it picks targets', () => {
        const quelle = flattenWhitespace(quelleDesWriters())
        assert.ok(
            quelle.includes("if (relayList.knowledge === 'unknown') {"),
            `${WRITER}: the relay-list verdict is no longer honoured. An empty declaration then reads as "this `
                + 'reader has no NIP-65 list", the target set collapses to the space, and a socket error is enough '
                + 'to produce it.',
        )
    })

    /**
     * **F1: the verdict is asked of the TARGET set, not of the reads alone.**
     *
     * `followListAnswered(reads)` — one argument — would type-check nowhere, but
     * `followListAnswered(reads, reads.map(r => r.url))` would, and it is `some` in
     * disguise: a set built from the answers can never be missing one. The second argument
     * has to be the independently drawn target list.
     *
     * **And it belongs on the contact list ONLY.** Since K7 the relay-list verdict asks
     * `anyRelayAnswered` — a deliberately different function for a deliberately different
     * question („which relays do we use" versus „may we replace what they hold"). Both
     * directions are pinned: the write gate must stay `every`, and the relay-list verdict
     * must not be tightened into it.
     */
    test('CORE: completeness is measured against the targets — and only where it belongs', () => {
        const quelle = quelleDesWriters()
        assert.ok(
            /followListAnswered\(targetReads, targets\)/.test(quelle),
            `${WRITER}: the contact-list verdict is no longer measured against the TARGET reads and the target `
                + 'set. Handing it the hint reads too would let a read-only source stand in for a target that '
                + 'never answered — F6 turned into F1.',
        )
        assert.ok(
            /outboxKnowledgeOf\(\{ writeUrls, anyAnswered: anyRelayAnswered\(reads\) \}\)/.test(quelle),
            `${WRITER}: the relay-list verdict no longer goes through anyRelayAnswered. Swapping in `
                + 'followListAnswered there would TIGHTEN it back to „every asked relay" — measured to lock the '
                + 'feature out entirely while one of three third-party indexers is down (K7).',
        )
        assert.ok(
            !/followListAnswered\(reads, asked\)/.test(quelle),
            `${WRITER}: the relay-list verdict is measured with the contact-list gate again.`,
        )
        assert.ok(
            !/followListAnswered\([^)]*\.map\(/.test(quelle),
            `${WRITER}: the target set handed to followListAnswered is derived from the reads themselves. A set `
                + 'built from the answers is complete by construction — that is `some` wearing `every`.',
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
    test('CORE: the relay list is read with an EOSE verdict of its own, per relay', () => {
        const quelle = quelleDesWriters()
        const eose = quelle.match(/onEose:\s*\(\)\s*=>\s*\{\s*answered\s*=\s*true/g) ?? []
        assert.equal(
            eose.length,
            2,
            `${WRITER}: ${eose.length} read(s) take their verdict from an onEose, expected 2 — the contact list `
                + 'and the relay list. Without its own verdict the kind 10002 read is back to `RelayLists.load`, '
                + 'which resolves to `undefined` both when there is no relay list and when no indexer could be '
                + 'reached: F2 exactly.',
        )
        const falsch = quelle.match(/let answered = false/g) ?? []
        assert.equal(
            falsch.length,
            2,
            `${WRITER}: ${falsch.length} verdict(s) start at false, expected 2. Starting at true means a read `
                + 'that never happened counts as complete.',
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
     * Gating it on `noRelayList` alone would show it to everybody during the first
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
            xShow[1].includes('noRelayList'),
            `${CARD}: the notice does not hang on noRelayList (x-show="${xShow[1]}").`,
        )
        assert.ok(
            xShow[1].includes('listSeen'),
            `${CARD}: the notice does not hang on listSeen (x-show="${xShow[1]}"). Before a read has come back `
                + '„no relay list" and „nobody looked yet" are the same empty outbox, and only one of them is '
                + 'about this reader.',
        )
        assert.ok(
            hinweis.includes('NIP-65'),
            `${CARD}: the notice no longer names the reason. A reader who is not told that the cause is a missing `
                + 'NIP-65 relay list has nothing to act on.',
        )
        // N1 made the previous wording false: the space is no longer written to, so the
        // list IS findable outside it — on the public fallback relays. A sentence that
        // describes a previous version is worse than none, because the reader acts on it.
        assert.ok(
            !/außerhalb dieses Space nicht auffindbar/.test(hinweis),
            `${CARD}: the notice still claims the list cannot be found outside this Space. Since N1 the space is `
                + 'not a write target at all and the fallback relays are public ones that other clients read.',
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
