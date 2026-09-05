/**
 * **The rules of `js/muteModels.ts`, one assertion per rule.**
 *   node --test --experimental-strip-types packages/einundzwanzig-group/js/muteModels.test.ts
 *
 * Plan: `docs/plans/2026-09-05T0125-community-features-herbst.md`, phase P6, and the
 * standing extra DoD "reine Logik braucht reine Tests" that starts with this phase: every
 * newly exported pure function carries at least one case that falls when the function is
 * inverted. Not "the module is tested" — **one assertion per rule**, because a rule whose
 * precondition is rare (an unreachable relay, a foreign private half, a list written by
 * another client) is never touched by an E2E run and would be built, correct, and guarded
 * by nothing.
 *
 * Two of the rules below name a consequence in their own docblock, which is exactly the
 * pattern the plan says went uncovered four phases in a row:
 *
 *  - `planMuteWrite` with `listAnswered: false` — **data loss**: kind 10000 is
 *    replaceable, so writing it without having seen the relay's copy deletes every entry
 *    made on another device.
 *  - `visibleChatEvents` keeping the reader's own messages — **no way back**: your own
 *    row is where the unmute action hangs, and hiding it locks you out of your own chat.
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
    MUTES,
    isMutePersonTag,
    mutedPubkeysOf,
    muteWriteConfirmed,
    ownMuteList,
    planMuteWrite,
    visibleChatEvents,
    withMutedPubkey,
    withoutMutedPubkey,
    type MuteEventLike,
} from './muteModels.ts'

const ME = 'a'.repeat(64)
const OTHER = 'b'.repeat(64)
const THIRD = 'c'.repeat(64)

const list = (tags: string[][], over: Partial<MuteEventLike> = {}): MuteEventLike => ({
    id: 'id',
    kind: MUTES,
    pubkey: ME,
    created_at: 1_000,
    tags,
    content: '',
    ...over,
})

describe('mute tags', () => {
    test('a person mute is a `p` tag with a value — and nothing else is', () => {
        assert.equal(isMutePersonTag(['p', OTHER]), true)
        // The three other NIP-51 mute carriers. This client neither writes nor reads
        // them, and must never mistake one for a person.
        assert.equal(isMutePersonTag(['t', 'bitcoin']), false)
        assert.equal(isMutePersonTag(['word', 'shitcoin']), false)
        assert.equal(isMutePersonTag(['e', OTHER]), false)
        // An empty value would produce `["p",""]` on the next write.
        assert.equal(isMutePersonTag(['p', '']), false)
        assert.equal(isMutePersonTag(['p']), false)
    })

    test('muting keeps every foreign tag and puts the new person first', () => {
        const before = [['t', 'bitcoin'], ['p', THIRD], ['word', 'moon']]
        const after = withMutedPubkey(before, OTHER)

        assert.deepEqual(after[0], ['p', OTHER])
        // The hashtag and the word mute of another client survive. Dropping them would be
        // a silent deletion of something this client cannot even display.
        assert.deepEqual(after.slice(1), [['t', 'bitcoin'], ['p', THIRD], ['word', 'moon']])
    })

    test('muting the same person twice does not duplicate the entry', () => {
        const after = withMutedPubkey([['p', OTHER], ['t', 'x']], OTHER)

        assert.deepEqual(after, [['p', OTHER], ['t', 'x']])
    })

    test('unmuting removes only that person, not the rest of the list', () => {
        const after = withoutMutedPubkey([['p', OTHER], ['p', THIRD], ['t', 'x']], OTHER)

        assert.deepEqual(after, [['p', THIRD], ['t', 'x']])
    })
})

describe('reading the list', () => {
    test('only OUR OWN list counts, and only the newest one', () => {
        const events = [
            list([['p', OTHER]], { id: 'old', created_at: 1_000 }),
            list([['p', THIRD]], { id: 'new', created_at: 2_000 }),
            list([['p', 'd'.repeat(64)]], { id: 'foreign', pubkey: OTHER, created_at: 9_000 }),
            list([['p', 'e'.repeat(64)]], { id: 'wrongkind', kind: 10003, created_at: 9_000 }),
        ]

        assert.equal(ownMuteList(events, ME)?.id, 'new')
        // A guest has no list — and must not inherit the first event in the batch.
        assert.equal(ownMuteList(events, ''), null)
    })

    test('the muted pubkeys are the `p` tags, deduplicated, in list order', () => {
        assert.deepEqual(
            mutedPubkeysOf(list([['p', OTHER], ['t', 'x'], ['p', THIRD], ['p', OTHER]])),
            [OTHER, THIRD],
        )
        assert.deepEqual(mutedPubkeysOf(null), [])
    })
})

describe('planMuteWrite — the gate and the event body in one decision', () => {
    const ok = {
        list: null as MuteEventLike | null,
        listAnswered: true,
        target: OTHER,
        self: ME,
        add: true,
        spaceKind: 'other' as const,
    }

    test('CALIBRATION: the happy path really produces an event body', () => {
        // Without this every refusal below would also hold for a function that always
        // returns null.
        const plan = planMuteWrite(ok)
        assert.ok(plan, 'the plan refuses even the ordinary case — every case below is worthless')
        assert.equal(plan.kind, MUTES)
        assert.deepEqual(plan.tags, [['p', OTHER]])
    })

    test('DATA LOSS: without an answer from the relay there is NO event at all', () => {
        // The rule this phase exists for. Kind 10000 is replaceable: one list per pubkey,
        // every write replaces the whole thing. With `listAnswered: false` we do not know
        // what the relay holds — writing our own view would delete every mute the user
        // made on another device. Not "write an empty list", not "write ours anyway".
        assert.equal(planMuteWrite({ ...ok, listAnswered: false }), null)
        // And it is not the empty list that saves us: even with entries in hand, an
        // unanswered read must refuse. (A load that timed out can still leave a stale
        // copy in the repository.)
        assert.equal(
            planMuteWrite({ ...ok, listAnswered: false, list: list([['p', THIRD]]) }),
            null,
        )
    })

    test("a space whose kind is still 'unknown' is not written to", () => {
        // `deriveSpaceKind` reports 'unknown' while the NIP-11 doc is in flight, and a
        // surface that decides in that state decides without grounds.
        assert.equal(planMuteWrite({ ...ok, spaceKind: 'unknown' }), null)
        // Buzz names kind 10000 in its ingest allowlist, zooid stores anything — so both
        // resolved kinds are allowed.
        assert.ok(planMuteWrite({ ...ok, spaceKind: 'buzz' }))
    })

    test('you cannot mute yourself, and a guest cannot mute anybody', () => {
        // Muting yourself removes your own messages from your own chat — together with
        // the row that carries the way back.
        assert.equal(planMuteWrite({ ...ok, target: ME }), null)
        assert.equal(planMuteWrite({ ...ok, self: '' }), null)
        assert.equal(planMuteWrite({ ...ok, target: '' }), null)
    })

    test('a write that would change nothing is refused', () => {
        // A double click, or a second device that got there first. Without this a signed
        // event goes out over the wire that changes nothing at all.
        assert.equal(planMuteWrite({ ...ok, list: list([['p', OTHER]]) }), null)
        assert.equal(planMuteWrite({ ...ok, add: false, list: list([['t', 'x']]) }), null)
    })

    test('the encrypted private half is carried over BYTE FOR BYTE', () => {
        // The list may carry a private half written by another client. This module never
        // decrypts and never re-encrypts it — `@welshman/domain`'s ListWriter can silently
        // return `""` for a payload it cannot parse, and that is a signed deletion of
        // somebody's private mutes. See the module header.
        const plan = planMuteWrite({ ...ok, list: list([['p', THIRD]], { content: 'AaBbCc==' }) })
        assert.equal(plan?.content, 'AaBbCc==')
        // …and the foreign entry is still there: this is a merge, not a replacement.
        assert.deepEqual(plan?.tags, [['p', OTHER], ['p', THIRD]])
    })

    test('unmuting produces a list without that person and with everything else', () => {
        const plan = planMuteWrite({
            ...ok,
            add: false,
            list: list([['p', OTHER], ['p', THIRD], ['word', 'x']]),
        })

        assert.deepEqual(plan?.tags, [['p', THIRD], ['word', 'x']])
    })
})

describe('visibleChatEvents — the display filter', () => {
    const events = [
        { id: '1', pubkey: ME },
        { id: '2', pubkey: OTHER },
        { id: '3', pubkey: THIRD },
    ]

    test('a muted author disappears, everybody else stays', () => {
        const shown = visibleChatEvents(events, new Set([OTHER]), ME)

        assert.deepEqual(shown.map((event) => event.id), ['1', '3'])
    })

    test('NO WAY BACK: your own messages are never hidden, even if the list says so', () => {
        // `planMuteWrite` refuses to mute yourself, but a list written by another client
        // can carry your own pubkey. Honouring it would make your own chat look broken
        // with no way back — the row carrying the unmute action would be gone with it.
        const shown = visibleChatEvents(events, new Set([ME, OTHER]), ME)

        assert.deepEqual(shown.map((event) => event.id), ['1', '3'])
    })

    test('an empty mute set hands back the SAME array, not a copy', () => {
        // `deriveRoomChat` rebuilds on every emit of fourteen sources; a fresh array on
        // the ordinary path would cost an allocation per emit on the hottest surface in
        // the client and buy nothing.
        assert.equal(visibleChatEvents(events, new Set(), ME), events)
    })
})

describe('muteWriteConfirmed — did the relay mean its OK?', () => {
    test('a relay list that disagrees with us is believed', () => {
        // zooid drops a replaceable event whose `created_at` is not greater than the
        // stored one and returns no error. A clock running behind makes every mute a
        // silent no-op while the relay keeps saying yes.
        assert.equal(muteWriteConfirmed([['p', THIRD]], OTHER, true), false)
        assert.equal(muteWriteConfirmed([['p', OTHER]], OTHER, false), false)
    })

    test('a relay list that agrees with us confirms', () => {
        assert.equal(muteWriteConfirmed([['p', OTHER]], OTHER, true), true)
        assert.equal(muteWriteConfirmed([['t', 'x']], OTHER, false), true)
    })

    test('SILENCE is not evidence — an absent answer confirms', () => {
        // The opposite direction from `planMuteWrite`, on purpose: there, silence must
        // block the write, because writing blind destroys foreign data. Here the write
        // already happened and was acknowledged, and a hanging AUTH round swallowing the
        // EOSE must not be reported to the user as "your mute did not stick".
        assert.equal(muteWriteConfirmed(null, OTHER, true), true)
        assert.equal(muteWriteConfirmed(null, OTHER, false), true)
    })
})
