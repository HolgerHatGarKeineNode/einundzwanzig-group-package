/**
 * The rules of the timed suspension (Buzz 9042/9043) and of reading the restriction list.
 *   node --test --experimental-strip-types packages/einundzwanzig-group/js/moderationTimeoutModels.test.ts
 *
 * Pure, no browser, no relay, no signer — the module under test imports nothing but the
 * write gate and a type. Time is injected everywhere: a test against the wall clock is a
 * documented flake source in this repository.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
    BUZZ_TIMEOUT,
    BUZZ_UNTIMEOUT,
    MAX_TIMEOUT_SECONDS,
    buildTimeoutTags,
    buildUntimeoutTags,
    expirationFrom,
    parseRestrictionList,
    planTimeout,
    planUntimeout,
} from './moderationTimeoutModels.ts'

/** A fixed "now", so nothing here depends on when it runs. */
const NOW = 1_767_225_600 // 2026-01-01T00:00:00Z
const HOUR = 3600
const DAY = 24 * HOUR
const PUBKEY = 'a'.repeat(64)

const tagValue = (tags: string[][], name: string): string | undefined =>
    tags.find((tag) => tag[0] === name)?.[1]

// ── The mandatory expiration ─────────────────────────────────────────────────────

test('a 9042 carries `p` and `expiration`, in that order', () => {
    const command = planTimeout(PUBKEY, DAY, NOW, 'buzz')
    assert.ok(command)
    assert.equal(command.kind, BUZZ_TIMEOUT)
    assert.deepEqual(command.tags, [
        ['p', PUBKEY],
        ['expiration', String(NOW + DAY)],
    ])
})

test('CORE: a 9042 WITHOUT an expiration is never built', () => {
    // The relay refuses it (`handle_timeout`: "timeout requires an expiration tag"), and
    // that refusal costs a signature prompt on the user's device. So the body must not
    // come into existence in the first place — through the builder …
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 1.5]) {
        assert.equal(buildTimeoutTags(PUBKEY, bad), null, `expiration ${bad} must not build a body`)
    }

    // … and through the planner, whatever the duration was that produced it.
    for (const duration of [0, -HOUR, Number.NaN, MAX_TIMEOUT_SECONDS + 1]) {
        assert.equal(planTimeout(PUBKEY, duration, NOW, 'buzz'), null, `duration ${duration} must not plan a 9042`)
    }

    // And every body that IS built carries the tag — the positive half of the same claim,
    // without which the four cases above would also pass on a planner that always says no.
    for (const duration of [1, HOUR, DAY, 30 * DAY, MAX_TIMEOUT_SECONDS]) {
        const command = planTimeout(PUBKEY, duration, NOW, 'buzz')
        assert.ok(command, `duration ${duration} must plan a 9042`)
        assert.equal(tagValue(command.tags, 'expiration'), String(NOW + duration))
    }
})

test('the duration is what the caller chose — the module fixes no value of its own', () => {
    for (const duration of [HOUR, 3 * DAY, 7 * DAY, 30 * DAY]) {
        const command = planTimeout(PUBKEY, duration, NOW, 'buzz')
        assert.ok(command)
        assert.equal(Number(tagValue(command.tags, 'expiration')) - NOW, duration)
    }
})

test('`expirationFrom` takes `now` as a parameter and pins both ends of its range', () => {
    assert.equal(expirationFrom(NOW, HOUR), NOW + HOUR)
    // One second is allowed (inclusive lower bound), zero is not (exclusive).
    assert.equal(expirationFrom(NOW, 1), NOW + 1)
    assert.equal(expirationFrom(NOW, 0), null)
    // The upper bound is inclusive, the second beyond it is not.
    assert.equal(expirationFrom(NOW, MAX_TIMEOUT_SECONDS), NOW + MAX_TIMEOUT_SECONDS)
    assert.equal(expirationFrom(NOW, MAX_TIMEOUT_SECONDS + 1), null)
    // An unusable clock is refused rather than added to.
    assert.equal(expirationFrom(0, HOUR), null)
    assert.equal(expirationFrom(Number.NaN, HOUR), null)
})

// ── The gate ─────────────────────────────────────────────────────────────────────

test('CORE: the gate answers, and it answers as a return value', () => {
    // 9042/9043 are Buzz dialect. On zooid the command would be *stored* as a permanent,
    // unreadable event and suspend nobody — the case `relayCapability.ts` exists for.
    assert.equal(planTimeout(PUBKEY, DAY, NOW, 'other'), null)
    assert.equal(planUntimeout(PUBKEY, 'other'), null)
    // `'unknown'` = the NIP-11 doc is still in flight. Fail-closed, same as everywhere.
    assert.equal(planTimeout(PUBKEY, DAY, NOW, 'unknown'), null)
    assert.equal(planUntimeout(PUBKEY, 'unknown'), null)
    // And the positive control, so the four refusals above are not vacuous.
    assert.ok(planTimeout(PUBKEY, DAY, NOW, 'buzz'))
    assert.ok(planUntimeout(PUBKEY, 'buzz'))
})

test('a malformed pubkey plans nothing', () => {
    for (const bad of ['', 'npub1abc', 'A'.repeat(64), 'a'.repeat(63), `${PUBKEY}0`]) {
        assert.equal(planTimeout(bad, DAY, NOW, 'buzz'), null, `"${bad}" must not plan a 9042`)
        assert.equal(planUntimeout(bad, 'buzz'), null, `"${bad}" must not plan a 9043`)
    }
})

test('the reason is optional and trimmed; an empty one adds no tag', () => {
    assert.equal(buildTimeoutTags(PUBKEY, NOW + DAY)?.length, 2)
    assert.equal(buildTimeoutTags(PUBKEY, NOW + DAY, '   ')?.length, 2)
    assert.deepEqual(buildTimeoutTags(PUBKEY, NOW + DAY, '  Spam  ')?.[2], ['reason', 'Spam'])
    assert.deepEqual(planTimeout(PUBKEY, DAY, NOW, 'buzz', 'Spam')?.tags[2], ['reason', 'Spam'])
})

test('a 9043 is one `p` tag and nothing else', () => {
    const command = planUntimeout(PUBKEY, 'buzz')
    assert.ok(command)
    assert.equal(command.kind, BUZZ_UNTIMEOUT)
    assert.deepEqual(command.tags, [['p', PUBKEY]])
    assert.deepEqual(buildUntimeoutTags(PUBKEY), [['p', PUBKEY]])
    assert.equal(buildUntimeoutTags('nope'), null)
})

// ── Reading the list back ────────────────────────────────────────────────────────

const OTHER = 'b'.repeat(64)

test('CORE: a 403 is NOT an empty list', () => {
    const result = parseRestrictionList(403, 'forbidden')
    assert.equal(result.ok, false)
    assert.equal(result.ok === false && result.reason, 'forbidden')
    assert.equal(result.ok === false && result.status, 403)
})

test('… and neither is a 401, a 500, or a body that is not a list', () => {
    assert.equal(parseRestrictionList(401, '{"error":"missing Nostr auth"}').ok, false)
    const unauthorized = parseRestrictionList(401, '')
    assert.equal(unauthorized.ok === false && unauthorized.reason, 'unauthorized')

    const down = parseRestrictionList(503, 'upstream')
    assert.equal(down.ok === false && down.reason, 'unavailable')

    // A 200 whose body is not an array means we are talking to something else. Reporting
    // it as "no rows" is the silent-emptiness failure one layer up.
    const shape = parseRestrictionList(200, { rows: [] })
    assert.equal(shape.ok === false && shape.reason, 'unavailable')
})

test('an empty list stays an empty list — and says so as a success', () => {
    const result = parseRestrictionList(200, [])
    assert.equal(result.ok, true)
    assert.deepEqual(result.ok === true && result.entries, [])
})

test('a running timeout is read apart from a ban, with its end as a unix second', () => {
    const result = parseRestrictionList(200, [
        { pubkey: PUBKEY, banned: false, muted_until: '2026-01-02T00:00:00Z', mute_reason: 'Ruhe' },
        { pubkey: OTHER, banned: true, ban_expires_at: null, ban_reason: 'Spam', muted_until: null },
    ])
    assert.equal(result.ok, true)
    assert.deepEqual(result.ok === true && result.entries, [
        { pubkey: PUBKEY, banned: false, mutedUntil: NOW + DAY, reason: 'Ruhe' },
        { pubkey: OTHER, banned: true, mutedUntil: null, reason: 'Spam' },
    ])
})

test('rows without a usable pubkey are dropped, missing reasons become empty strings', () => {
    const result = parseRestrictionList(200, [
        { pubkey: 'kurz', banned: false, muted_until: '2026-01-02T00:00:00Z' },
        { banned: true },
        { pubkey: OTHER, banned: false, muted_until: 'nicht-datum' },
    ])
    assert.deepEqual(result.ok === true && result.entries, [
        { pubkey: OTHER, banned: false, mutedUntil: null, reason: '' },
    ])
})

test('the `{"restricted": […]}` envelope is accepted as well as the bare array', () => {
    const result = parseRestrictionList(200, { restricted: [{ pubkey: PUBKEY, banned: true, ban_reason: 'x' }] })
    assert.deepEqual(result.ok === true && result.entries, [
        { pubkey: PUBKEY, banned: true, mutedUntil: null, reason: 'x' },
    ])
})
