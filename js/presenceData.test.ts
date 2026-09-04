/**
 * Presence (kind 20001) — the pure half.
 *
 *   node --test --experimental-strip-types packages/einundzwanzig-group/js/presenceData.test.ts
 *
 * Four promises, each of which fails silently if it breaks:
 *
 *  1. **The TTL boundary is where it is claimed to be.** The relay drops its Redis key at
 *     exactly 180 s and sends nothing when it does; a client that keeps a dot one second
 *     longer than the relay would show presence nobody is backing any more. The boundary
 *     is asserted on both sides, with an injected `now` — never against the wall clock,
 *     which is a documented flake source in this repo.
 *  2. **The heartbeat is due at 45 s and therefore inside 60 s.** Miss it and the peer's
 *     entry expires at 180 s; the user then goes silently invisible while their tab is
 *     still open.
 *  3. **An unknown status is dropped, and a `p` tag is never trusted.** Both are ways to
 *     put a claim about somebody else on the screen.
 *  4. **The gate answers before an event exists.** `planPresence` returns `null` rather
 *     than a body whenever the relay is not known to be Buzz.
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
    PRESENCE_HEARTBEAT_MS,
    PRESENCE_MAX_SKEW_SECS,
    PRESENCE_TICK_MS,
    PRESENCE_TTL_SECS,
    PRESENCE_UPDATE,
    foldPresence,
    isPresenceFresh,
    mayReadPresence,
    parsePresenceEvent,
    planPresence,
    presenceFingerprint,
    shouldSendPresence,
    type PresenceEventLike,
} from './presenceData.ts'

/** Fixed clock. Nothing in this file reads `Date.now()`. */
const NOW = 1_800_000_000

const ALICE = 'a'.repeat(64)
const BOB = 'b'.repeat(64)

const ev = (pubkey: string, content: string, createdAt: number, id = ''): PresenceEventLike => ({
    id,
    kind: PRESENCE_UPDATE,
    pubkey,
    created_at: createdAt,
    content,
})

describe('the TTL boundary', () => {
    test('fresh up to one second before the TTL, gone at the TTL itself (exclusive)', () => {
        // The three cases that matter, and the middle one is the whole point: at exactly
        // 180 s the relay's `SET … EX 180` key is no longer readable, so neither is ours.
        assert.equal(isPresenceFresh(NOW - (PRESENCE_TTL_SECS - 1), NOW), true, '179 s old → still present')
        assert.equal(isPresenceFresh(NOW - PRESENCE_TTL_SECS, NOW), false, 'exactly 180 s old → gone')
        assert.equal(isPresenceFresh(NOW - (PRESENCE_TTL_SECS + 1), NOW), false, '181 s old → gone')
    })

    test('the same boundary decides the table, not just the predicate', () => {
        // Calibration in the other direction: without this case the boundary could be
        // right in `isPresenceFresh` and never reached by `foldPresence`.
        const events = [ev(ALICE, 'online', NOW - (PRESENCE_TTL_SECS - 1)), ev(BOB, 'online', NOW - PRESENCE_TTL_SECS)]
        const table = foldPresence(events, NOW)
        assert.equal(table.get(ALICE), 'online')
        assert.equal(table.has(BOB), false, 'the peer at exactly the TTL is absent, not offline')
        assert.equal(table.size, 1)
    })

    test('a future timestamp is accepted as skew up to the limit and ignored beyond it', () => {
        // Without the bound this event never ages out: the ephemeral path runs no drift
        // check at all, so anyone can pin a dot on themselves forever.
        assert.equal(isPresenceFresh(NOW + PRESENCE_MAX_SKEW_SECS, NOW), true, 'exactly at the skew limit → accepted')
        assert.equal(isPresenceFresh(NOW + PRESENCE_MAX_SKEW_SECS + 1, NOW), false, 'one second beyond → ignored')
        const table = foldPresence([ev(ALICE, 'online', NOW + 400_000)], NOW)
        assert.equal(table.size, 0, 'a presence stamped days ahead shows nobody')
    })
})

describe('the heartbeat', () => {
    test('is due at the interval and therefore inside a minute', () => {
        const last = { status: 'online' as const, atMs: 0 }
        assert.equal(shouldSendPresence(last, 'online', PRESENCE_HEARTBEAT_MS - 1), false, 'one ms early → no beat')
        assert.equal(shouldSendPresence(last, 'online', PRESENCE_HEARTBEAT_MS), true, 'at the interval → beat (inclusive)')
        // The promise of the phase, asserted as arithmetic rather than as prose. The gap
        // between two beats is not the interval alone: a beat becomes due at 45 s and goes
        // out at the FOLLOWING tick, so the worst case is `heartbeat + tick`. Asserting
        // only the interval would let someone raise the tick to 30 s — beats every 75 s,
        // a peer dropping out of presence at 180 s, and nothing red anywhere.
        assert.ok(
            PRESENCE_HEARTBEAT_MS + PRESENCE_TICK_MS <= 60_000,
            `worst case between two beats is ${PRESENCE_HEARTBEAT_MS + PRESENCE_TICK_MS} ms, must be at most 60 s`,
        )
        assert.ok(
            3 * (PRESENCE_HEARTBEAT_MS / 1000) <= PRESENCE_TTL_SECS,
            'three heartbeats must fit inside the relay TTL, otherwise one lost frame drops the user',
        )
    })

    test('a state change beats the interval, and so does a clock that jumped backwards', () => {
        const last = { status: 'online' as const, atMs: 10_000 }
        assert.equal(shouldSendPresence(last, 'away', 10_001), true, 'online → away is said at once')
        assert.equal(shouldSendPresence(null, 'online', 0), true, 'nothing said yet → say it')
        assert.equal(shouldSendPresence(last, 'online', 5_000), true, 'clock went backwards → say it rather than park')
    })
})

describe('parsing', () => {
    test('only the three known statuses survive', () => {
        assert.equal(parsePresenceEvent(ev(ALICE, 'online', NOW))?.status, 'online')
        assert.equal(parsePresenceEvent(ev(ALICE, 'away', NOW))?.status, 'away')
        assert.equal(parsePresenceEvent(ev(ALICE, 'offline', NOW))?.status, 'offline')
        // Forward compatibility is the relay's business, not ours: an unknown string is
        // not evidence of anything, and rendering it as "online" would be an invention.
        assert.equal(parsePresenceEvent(ev(ALICE, 'invisible', NOW)), null)
        assert.equal(parsePresenceEvent(ev(ALICE, '', NOW)), null)
        assert.equal(parsePresenceEvent(ev(ALICE, '{"status":"online"}', NOW)), null, 'the legacy JSON form is the relay’s to accept, not ours to render')
    })

    test('the subject is the author — a p tag changes nothing', () => {
        // A live 20001 is self-signed; a forged `["p", <victim>]` must not move anybody
        // else's dot. This module reads no tags at all, and this case nails that down.
        const forged = { ...ev(ALICE, 'online', NOW), tags: [['p', BOB]] } as PresenceEventLike
        const table = foldPresence([forged], NOW)
        assert.equal(table.get(ALICE), 'online')
        assert.equal(table.has(BOB), false, 'the p tag must not put BOB online')
    })

    test('a malformed pubkey, a foreign kind or a broken timestamp is dropped', () => {
        assert.equal(parsePresenceEvent(ev('nope', 'online', NOW)), null)
        assert.equal(parsePresenceEvent(ev(ALICE.toUpperCase(), 'online', NOW)), null, 'hex is lowercase')
        assert.equal(parsePresenceEvent({ ...ev(ALICE, 'online', NOW), kind: 20002 }), null, 'a typing indicator is not presence')
        assert.equal(parsePresenceEvent({ ...ev(ALICE, 'online', NOW), created_at: Number.NaN }), null)
    })
})

describe('the table', () => {
    test('the newest statement wins regardless of arrival order', () => {
        // A relay replays on reconnect and does not promise an order; a fold over "last
        // one in wins" would let the dot flip back to a stale value.
        const older = ev(ALICE, 'online', NOW - 100, '1')
        const newer = ev(ALICE, 'away', NOW - 10, '2')
        assert.equal(foldPresence([older, newer], NOW).get(ALICE), 'away')
        assert.equal(foldPresence([newer, older], NOW).get(ALICE), 'away')
    })

    test('a draw is decided by the id, so the answer is stable', () => {
        const a = ev(ALICE, 'online', NOW - 5, 'aa')
        const b = ev(ALICE, 'away', NOW - 5, 'bb')
        assert.equal(foldPresence([a, b], NOW).get(ALICE), 'online')
        assert.equal(foldPresence([b, a], NOW).get(ALICE), 'online')
    })

    test('offline removes the pubkey instead of ageing out', () => {
        // The user closed the tab; the relay ran `clear_presence`. If `'offline'` only
        // dropped out at parse time, the older `'online'` would win and the dot would sit
        // there for another three minutes.
        const table = foldPresence([ev(ALICE, 'online', NOW - 60), ev(ALICE, 'offline', NOW - 1)], NOW)
        assert.equal(table.has(ALICE), false)
        // …and an offline that is OLDER than an online does not remove anything.
        const back = foldPresence([ev(ALICE, 'offline', NOW - 60), ev(ALICE, 'online', NOW - 1)], NOW)
        assert.equal(back.get(ALICE), 'online')
    })

    test('the fingerprint changes exactly when the visible table does', () => {
        const one = foldPresence([ev(ALICE, 'online', NOW - 1)], NOW)
        const same = foldPresence([ev(ALICE, 'online', NOW - 2)], NOW)
        const other = foldPresence([ev(ALICE, 'away', NOW - 1)], NOW)
        assert.equal(presenceFingerprint(one), presenceFingerprint(same), 'a new heartbeat alone is not a change')
        assert.notEqual(presenceFingerprint(one), presenceFingerprint(other))
        assert.equal(presenceFingerprint(new Map()), '')
    })
})

describe('the write gate', () => {
    test('only a known Buzz space produces an event body', () => {
        const plan = planPresence('online', 'buzz')
        assert.deepEqual(plan, { kind: PRESENCE_UPDATE, content: 'online', tags: [] })
        // Channel-less on purpose: with an `h` tag the relay would route the event to one
        // channel's subscribers instead of the global topic.
        assert.deepEqual(plan?.tags, [], 'presence carries no tags')
    })

    test('the READ side denies the same two states — and `unknown` renders NOTHING', () => {
        // The DoD sentence of this phase, as an assertion: `'unknown'` must not render and
        // must not render `false` either. It opens no subscription, so the table stays
        // empty and the markup draws no dot — which is the truthful answer, because
        // presence has no backlog to have missed.
        assert.equal(mayReadPresence('buzz'), true)
        assert.equal(mayReadPresence('unknown'), false, 'NIP-11 still in flight → no statement about anybody')
        assert.equal(mayReadPresence('other'), false, 'a zooid space has no presence to read')
    })

    test('unknown and non-Buzz deny — the event is never built, let alone signed', () => {
        assert.equal(planPresence('online', 'unknown'), null, 'NIP-11 still in flight → no write')
        assert.equal(planPresence('online', 'other'), null, 'zooid stores what it does not understand')
        assert.equal(planPresence('offline', 'other'), null, 'the same for the farewell')
    })
})
