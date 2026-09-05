/**
 * The rules of the moderation history (`GET /moderation/audit`).
 *   node --test --experimental-strip-types packages/einundzwanzig-group/js/moderationAuditModels.test.ts
 *
 * Pure: no browser, no relay, no signer. Time is injected everywhere — a test against the
 * wall clock is a documented flake source in this repository, and this module's whole job
 * is to say "today" and "yesterday".
 *
 * The row fixtures below are the shape of `action_json`
 * (`crates/buzz-relay/src/api/bridge.rs`), not an invented one.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
    auditActionLabel,
    auditDays,
    dayKey,
    dayLabel,
    groupAuditByDay,
    parseAuditList,
    type AuditEntry,
} from './moderationAuditModels.ts'

const ACTOR = 'a'.repeat(64)
const TARGET = 'b'.repeat(64)
const EVENT_ID = 'c'.repeat(64)

/** A local-time instant, so nothing here depends on the runner's time zone. */
const at = (y: number, m: number, d: number, h = 12, min = 0): number =>
    Math.floor(new Date(y, m - 1, d, h, min, 0).getTime() / 1000)

/** The same instant as the relay writes it: RFC-3339. */
const rfc = (ts: number): string => new Date(ts * 1000).toISOString()

const row = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    id: '11111111-2222-3333-4444-555555555555',
    actor_pubkey: ACTOR,
    action: 'timeout',
    target_pubkey: TARGET,
    target_event_id: null,
    channel_id: null,
    reason_code: null,
    public_reason: 'Spam im Willkommensraum',
    private_reason: 'nur fuer Moderatoren',
    matched_principal: null,
    created_at: rfc(at(2026, 9, 5, 10, 30)),
    ...over,
})

// ── 403 is an answer, not a defect ───────────────────────────────────────────────

test('CORE: 403 is a forbidden result — never an empty list', () => {
    const result = parseAuditList(403, 'restricted: moderator access required')
    assert.equal(result.ok, false)
    assert.equal(result.ok === false && result.reason, 'forbidden')
    assert.equal(result.ok === false && result.status, 403)
    assert.equal(result.ok === false && result.detail, 'restricted: moderator access required')
})

test('CORE: without moderation rights the surface has no history and no error', () => {
    // The whole of DoD 2 in one line: `auditDays` is what the island assigns, and for a
    // 403 it is empty. There is no second field carrying a message the markup could show.
    assert.deepEqual(auditDays(parseAuditList(403, 'restricted: moderator access required'), at(2026, 9, 5)), [])
})

test('401 (no/《invalid》 NIP-98 header) is told apart from 403', () => {
    const result = parseAuditList(401, 'missing Nostr auth')
    assert.equal(result.ok === false && result.reason, 'unauthorized')
})

test('every other non-2xx is `unavailable` — 404 included, which is what zooid would answer', () => {
    for (const status of [404, 429, 500, 502]) {
        const result = parseAuditList(status, 'nope')
        assert.equal(result.ok, false, `status ${status}`)
        assert.equal(result.ok === false && result.reason, 'unavailable', `status ${status}`)
    }
})

test('a 200 whose body is not a list is a failure, not "nothing happened yet"', () => {
    for (const body of [null, 'text', 42, { error: 'x' }]) {
        const result = parseAuditList(200, body)
        assert.equal(result.ok, false, JSON.stringify(body))
        assert.equal(result.ok === false && result.reason, 'unavailable')
    }
    // The envelope form is accepted, for the same one-line reason as in the restriction
    // list: a future wrapping should not become a silently empty screen.
    const wrapped = parseAuditList(200, { actions: [row()] })
    assert.equal(wrapped.ok, true)
    assert.equal(wrapped.ok === true && wrapped.entries.length, 1)
})

// ── The row ──────────────────────────────────────────────────────────────────────

test('a row becomes an entry, with `created_at` as unix SECONDS', () => {
    const stamp = at(2026, 9, 5, 10, 30)
    const result = parseAuditList(200, [row({ created_at: rfc(stamp) })])
    assert.equal(result.ok, true)
    const entry = (result as { entries: AuditEntry[] }).entries[0]
    assert.deepEqual(entry, {
        id: '11111111-2222-3333-4444-555555555555',
        actorPubkey: ACTOR,
        action: 'timeout',
        targetPubkey: TARGET,
        targetEventId: '',
        reason: 'Spam im Willkommensraum',
        createdAt: stamp,
    })
})

test('an unreadable timestamp drops the row instead of dating it to now', () => {
    for (const bad of [null, '', 'gestern', 123]) {
        const result = parseAuditList(200, [row({ created_at: bad })])
        assert.equal(result.ok === true && result.entries.length, 0, `created_at ${JSON.stringify(bad)}`)
    }
})

test('a row without id or action is dropped — it can be neither keyed nor labelled', () => {
    assert.equal((parseAuditList(200, [row({ id: '' })]) as { entries: AuditEntry[] }).entries.length, 0)
    assert.equal((parseAuditList(200, [row({ action: null })]) as { entries: AuditEntry[] }).entries.length, 0)
})

test('a broken pubkey becomes empty, it does not break the whole list', () => {
    // Same class of input as in the report queue: whatever the relay hands over gets
    // validated as 64-hex, because a row is rendered next to a profile link.
    const result = parseAuditList(200, [row({ target_pubkey: 'zz', actor_pubkey: 'nope' })])
    const entry = (result as { entries: AuditEntry[] }).entries[0]
    assert.equal(entry.targetPubkey, '')
    assert.equal(entry.actorPubkey, '')
})

test('an action against CONTENT keeps its event id and has no target pubkey', () => {
    const result = parseAuditList(200, [
        row({ action: 'delete', target_pubkey: null, target_event_id: EVENT_ID }),
    ])
    const entry = (result as { entries: AuditEntry[] }).entries[0]
    assert.equal(entry.targetPubkey, '')
    assert.equal(entry.targetEventId, EVENT_ID)
})

test('the reason falls back to the machine code, and `private_reason` is never carried', () => {
    const withCode = parseAuditList(200, [row({ public_reason: null, reason_code: 'spam' })])
    assert.equal((withCode as { entries: AuditEntry[] }).entries[0].reason, 'spam')
    const plain = parseAuditList(200, [row()])
    assert.equal(JSON.stringify((plain as { entries: AuditEntry[] }).entries[0]).includes('nur fuer Moderatoren'), false)
})

// ── Grouped by day ───────────────────────────────────────────────────────────────

const entry = (id: string, ts: number, action = 'timeout'): AuditEntry => ({
    id,
    actorPubkey: ACTOR,
    action,
    targetPubkey: TARGET,
    targetEventId: '',
    reason: '',
    createdAt: ts,
})

test('CORE: entries of one day land under ONE heading, newest day first', () => {
    const now = at(2026, 9, 5, 18)
    const days = groupAuditByDay(
        [
            entry('a', at(2026, 9, 3, 9)),
            entry('b', at(2026, 9, 5, 9, 5)),
            entry('c', at(2026, 9, 5, 9, 6)),
            entry('d', at(2026, 9, 4, 23, 59)),
        ],
        now,
    )
    assert.deepEqual(
        days.map((d) => [d.key, d.entries.map((e) => e.id)]),
        [
            ['2026-09-05', ['c', 'b']],
            ['2026-09-04', ['d']],
            ['2026-09-03', ['a']],
        ],
    )
})

test('the day key is the LOCAL calendar day — a late-evening entry does not slide into tomorrow', () => {
    // `toISOString()` would be UTC and would put 23:30 local into the next day across half
    // of Europe. That is the whole reason `dayKey` builds the string by hand.
    assert.equal(dayKey(at(2026, 9, 5, 23, 30)), '2026-09-05')
    assert.equal(dayKey(at(2026, 9, 5, 0, 15)), '2026-09-05')
})

test('the heading says Heute/Gestern and otherwise the full date', () => {
    const now = at(2026, 9, 5, 18)
    assert.equal(dayLabel(at(2026, 9, 5, 1), now), 'Heute')
    assert.equal(dayLabel(at(2026, 9, 4, 23), now), 'Gestern')
    const older = dayLabel(at(2026, 9, 3, 12), now)
    assert.notEqual(older, 'Heute')
    assert.notEqual(older, 'Gestern')
    assert.match(older, /2026/)
})

test('grouping survives a relay that stops sending newest-first', () => {
    // `list_moderation_actions` documents the order, but an order the client does not
    // control is not an order the client should depend on.
    const now = at(2026, 9, 5, 18)
    const ascending = [entry('old', at(2026, 9, 3, 9)), entry('new', at(2026, 9, 5, 9))]
    assert.deepEqual(
        groupAuditByDay(ascending, now).map((d) => d.key),
        ['2026-09-05', '2026-09-03'],
    )
})

// ── Labels ───────────────────────────────────────────────────────────────────────

test('every action the relay writes has a label, and an unknown one shows itself', () => {
    // The vocabulary of `moderation_commands.rs` (`insert_audit` calls plus
    // `resolution_audit_action`), complete.
    for (const action of [
        'ban',
        'unban',
        'timeout',
        'untimeout',
        'delete',
        'kick',
        'dismiss_report',
        'escalate',
        'resolve:delete',
        'resolve:kick',
        'resolve:ban',
        'resolve:timeout',
        'resolve:unknown',
    ]) {
        assert.notEqual(auditActionLabel(action), action, `${action} has no label`)
        assert.notEqual(auditActionLabel(action), '', `${action} is labelled empty`)
    }
    assert.equal(auditActionLabel('shadowban'), 'shadowban')
})

test('the history LABELS a ban but offers none — the two forbidden labels stay absent', () => {
    // The association neither bans nor removes its members (decision 2026-09-03), and
    // `moderationSurfaceGate.ts` latches the markup. A record of what happened is not an
    // action: an older client or another tool on the same relay can have written such a
    // row, and hiding it would be a history that lies.
    const labels = ['ban', 'kick', 'resolve:ban'].map(auditActionLabel)
    for (const label of labels) {
        assert.notEqual(label, 'Bannen')
        assert.notEqual(label, 'Autor bannen')
    }
})
