/**
 * **The latch: no operable "remove member" or "ban member" anywhere in the markup.**
 *   node --test --experimental-strip-types packages/einundzwanzig-group/js/moderationSurfaceGate.test.ts
 *
 * The decision it holds (2026-09-03, the association's, not a technical one): members are
 * neither removed nor banned; the timed suspension is the strongest measure this surface
 * offers. The reasoning, the word-boundary trap and the limits of a text scanner are in
 * the module header of `moderationSurfaceGate.ts`.
 *
 * ── Calibrated, and here is how ─────────────────────────────────────────────
 *
 * A source-text latch goes blind silently when the form it checks changes, and a latch
 * nobody has seen fail is not known to be a guard. Three calibrations run before the
 * claim:
 *
 *  1. the sweep sees the whole tree (file count, throwing below the floor);
 *  2. the stripper really removes a commented block **and** really keeps active markup —
 *     proven on a synthetic source, so it cannot pass by finding nothing;
 *  3. the actions that MUST stay operable are found by the same scanner, in the same
 *     files. Without that, every assertion below would also hold on a scanner that reads
 *     empty strings.
 *
 * Deliberately made red twice, both times reverted byte for byte under md5:
 *
 *  - with the disabled blocks un-commented the CORE case reported all six handlers;
 *  - with the bracket-less line the review found — `x-on:click="removeMember"`, outside
 *    every comment block — the CORE case reported `removeMember`. **Before the fix that
 *    same line left all six cases green**; the case below pins the rule that closed it.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
    MIN_BLADE_FILES,
    callsHandler,
    collectBlades,
    flattenWhitespace,
    readBlade,
    showsLabel,
    stripBladeComments,
} from './moderationSurfaceGate.ts'

const VIEWS = join(import.meta.dirname, '..', 'resources', 'views')

const blades = () => collectBlades(VIEWS).map((path) => readBlade(path, path.slice(VIEWS.length + 1)))

/**
 * Every click handler that acts against a PERSON.
 *
 * `unbanMember` and `liftTimeout` are deliberately absent: an existing restriction has to
 * stay liftable. `removeMember` is the space membership, `kickRoomMember` the same action
 * one room deeper — the back door the plan names by name.
 */
const PERSON_HANDLERS = [
    'removeMember',
    'banMember',
    'kickRoomMember',
    'askBanAuthor',
    'confirmBanAuthor',
    'banReportedUser',
]

/** Labels that can mean nothing else. `__('Entfernen')` is NOT one — see below. */
const PERSON_LABELS = ['Bannen', 'Autor bannen']

test('CALIBRATION: the sweep sees the whole view tree', () => {
    const files = collectBlades(VIEWS)
    assert.ok(files.length >= MIN_BLADE_FILES, `only ${files.length} Blade files seen`)
    // And the four files this phase touched are among them, by name: a walker that lost a
    // subdirectory would still clear the count above.
    for (const name of [
        '⚡directory.blade.php',
        '⚡spaces.blade.php',
        '⚡room.blade.php',
        join('partials', 'chat-row.blade.php'),
    ]) {
        assert.ok(
            files.some((f) => f.endsWith(name)),
            `${name} is not in the sweep`,
        )
    }
})

test('CALIBRATION: the stripper removes comments and keeps active markup', () => {
    const source = [
        '<flux:menu.item x-on:click="stillHere(m)">A</flux:menu.item>',
        '{{-- disabled with a reason',
        '<flux:menu.item x-on:click="banMember(m)">{{ __(\'Bannen\') }}</flux:menu.item>',
        '--}}',
        '<flux:menu.item x-on:click="alsoHere(m)">B</flux:menu.item>',
    ].join('\n')
    const active = stripBladeComments(source)

    assert.ok(active.includes('stillHere(m)'), 'the stripper ate active markup')
    assert.ok(active.includes('alsoHere(m)'), 'the stripper ate markup after the comment')
    assert.equal(active.includes('banMember(m)'), false, 'the stripper left the commented handler standing')
    assert.equal(active.includes("__('Bannen')"), false)

    // Two comments in one file must not swallow everything between them (a greedy match
    // would) — the failure mode that makes a latch quietly measure nothing.
    const two = stripBladeComments('{{-- a --}}KEEP{{-- b --}}')
    assert.equal(two, 'KEEP')
})

test('CALIBRATION: the actions that must STAY operable are found by this scanner', () => {
    // Without this case every assertion below would also pass on a scanner that reads
    // nothing at all.
    const files = blades()
    const find = (name: string) => {
        const found = files.find((f) => f.file.endsWith(name))
        assert.ok(found, `${name} not read`)

        return found
    }

    // Removing a single foreign MESSAGE — content, not a person. Untouched by this phase.
    assert.ok(callsHandler(find('⚡room.blade.php'), 'confirmAdminDelete'), 'the message-removal modal is gone')
    assert.ok(callsHandler(find('⚡room.blade.php'), 'askAdminDelete'), 'the message-removal trigger is gone')
    assert.ok(callsHandler(find(join('partials', 'chat-row.blade.php')), 'askAdminDelete'))
    // Lifting an existing restriction, both kinds.
    assert.ok(callsHandler(find('⚡directory.blade.php'), 'unbanMember'), 'unbanning is gone')
    assert.ok(callsHandler(find('⚡directory.blade.php'), 'liftTimeout'), 'lifting a suspension is gone')
    // And the replacement itself.
    assert.ok(callsHandler(find('⚡directory.blade.php'), 'openTimeout'), 'the timeout entry is gone')
    assert.ok(callsHandler(find('⚡spaces.blade.php'), 'addRoomMemberByNpub'), 'the room member list is gone')
})

test('CORE: a handler WITHOUT brackets counts as a call — Alpine calls it anyway', () => {
    // The hole the review measured. Alpine auto-calls an expression that evaluates to a
    // function: `x-on:click="removeMember"` runs `removeMember(clickEvent)` (the four lines
    // in our own build are cited in the module header). A scanner that insists on `(`
    // reports a clean tree while the button works.
    //
    // Synthetic sources here and not the real file, so this case keeps its meaning after
    // the next edit of the markup — the real tree is what the CORE case below reads.
    const source = (active: string) => ({ file: 'synthetic.blade.php', active })

    assert.ok(
        callsHandler(source('<flux:menu.item icon="user-minus" x-on:click="removeMember">X</flux:menu.item>'), 'removeMember'),
        'the bracket-less shorthand is not seen — this is exactly the line that slipped through',
    )
    // Its relatives: a modifier on the attribute, the `@` short form, single quotes, and an
    // expression whose RESULT is the function (Alpine calls that too).
    assert.ok(callsHandler(source('<button @click.prevent="banMember">X</button>'), 'banMember'))
    assert.ok(callsHandler(source("<button x-on:click='kickRoomMember'>X</button>"), 'kickRoomMember'))
    assert.ok(callsHandler(source('<button x-on:click="m.mine ? noop : banReportedUser">X</button>'), 'banReportedUser'))

    // And it stays word-bounded: lifting a restriction must not be reported as banning.
    assert.equal(callsHandler(source('<button x-on:click="unbanMember">X</button>'), 'banMember'), false)
    // A name outside an event attribute is not a call — `x-text` renders, it does not run.
    assert.equal(callsHandler(source('<span x-text="removeMemberLabel"></span>'), 'removeMember'), false)
    assert.equal(callsHandler(source('<span x-text="removeMember"></span>'), 'removeMember'), false)
})

test('CORE: no active markup removes or bans a member — anywhere in the tree', () => {
    const offenders: string[] = []
    for (const source of blades()) {
        for (const handler of PERSON_HANDLERS) {
            if (callsHandler(source, handler)) {
                // No trailing `(` in the message: since the bracket-less form counts too,
                // printing one would name a shape the file may not contain.
                offenders.push(`${source.file}: ${handler}`)
            }
        }
        for (const label of PERSON_LABELS) {
            if (showsLabel(source, label)) {
                offenders.push(`${source.file}: __('${label}')`)
            }
        }
    }

    assert.deepEqual(
        offenders,
        [],
        'The association does not remove or ban its members (decision 2026-09-03) — '
            + `these markup sites do it anyway:\n  ${offenders.join('\n  ')}`,
    )
})

test('… and `__(\'Entfernen\')` is deliberately NOT on the forbidden list', () => {
    // It labels the removal of a single foreign MESSAGE, which stays operable. Putting the
    // label on the list would force that button to be renamed to satisfy a latch — the
    // latch would then be steering the product instead of holding a decision.
    const room = blades().find((f) => f.file.endsWith('⚡room.blade.php'))
    assert.ok(room)
    assert.ok(showsLabel(room, 'Entfernen'), 'the message-removal button lost its label')
    assert.ok(callsHandler(room, 'confirmAdminDelete'), '… and its handler')
})

test('every disabled site carries the business reason, not just „bewusst deaktiviert"', () => {
    // A decision without a written reason gets re-negotiated — that is exactly what
    // happened here on 2026-09-03, when only „bewusst deaktiviert" stood at the disabled
    // ban site. The reason therefore has to be IN the comment, and this is what keeps the
    // next hand from dropping it.
    //
    // Read raw, NOT through `readBlade`: the sentence lives inside the Blade comment, and
    // the stripper the other cases use would remove exactly the thing being checked.
    const REASON = 'the association does not remove or ban its members'
    const files = collectBlades(VIEWS)
    const withReason = files
        .filter((path) => flattenWhitespace(readFileSync(path, 'utf8')).includes(REASON))
        .map((path) => path.slice(VIEWS.length + 1))
        .sort()

    assert.deepEqual(
        withReason,
        [
            join('partials', 'chat-row.blade.php'),
            '⚡directory.blade.php',
            '⚡room.blade.php',
            '⚡spaces.blade.php',
        ].sort(),
    )
})
