/**
 * Pure tests for the write gate (welshman-free, like `relayCapability.ts` itself).
 *   node --test --experimental-strip-types packages/einundzwanzig-group/js/relayCapability.test.ts
 *
 * What is being defended here is not a display detail: on a zooid space every kind in
 * this table would be accepted, stored and fanned out with no reader and no way back
 * (`zooid/instance.go` `OnEvent` → `return false, ""`, `groups.go` `IsGroupEvent` true
 * for any `h`-tagged kind, `CheckWrite` falling through for a member — all read at
 * `d985857`). Each test below therefore states which mistake it makes expensive.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { NIP_ER_EXTENSION, mayWriteKind } from './relayCapability.ts'

/** A Buzz NIP-11 doc as production answers it (2026-09-03). */
const buzzProfile = { supported_extensions: ['nip-er', 'nip-pl'] }

/** Every kind the plan's later phases write, with the relay it needs. */
const NIP51_KINDS = [10001, 10003, 30003]
const BUZZ_ONLY_KINDS = [45002, 9042, 9043, 20001, 41010, 41011, 41012]
const EXTENSION_KIND = 30300

// ── Fail-closed on 'unknown' ────────────────────────────────────────────────

test("'unknown' denies — the NIP-11 doc is still in flight, so nothing is decided", () => {
    // `deriveSpaceKind` is three-valued exactly so that "not known yet" is its own
    // state and not a `false`. A write in that state would be a coin flip on which
    // relay it lands, and on zooid the wrong side is irreversible. The wait is cheap:
    // the store publishes 'other' once its backoff ladder is spent (spaceCaps.ts).
    for (const kind of BUZZ_ONLY_KINDS) {
        assert.equal(mayWriteKind(kind, 'unknown'), false)
    }
    assert.equal(mayWriteKind(EXTENSION_KIND, 'unknown', buzzProfile), false)
})

test("'unknown' denies even the global NIP-51 kinds, and even with a doc in hand", () => {
    // These would in fact be harmless on either relay. They are still denied while the
    // space kind is unresolved: one rule, no exception to reason about later, and a
    // caller that hangs a skeleton on 'unknown' behaves the same everywhere.
    for (const kind of NIP51_KINDS) {
        assert.equal(mayWriteKind(kind, 'unknown'), false)
        assert.equal(mayWriteKind(kind, 'unknown', buzzProfile), false)
    }
})

// ── Buzz dialect vs. zooid ──────────────────────────────────────────────────

test('a Buzz-only kind is denied on a non-Buzz space', () => {
    // The core of the gate. 45002/9042/9043/20001/41010-41012 have no reader outside
    // Buzz; zooid stores them anyway.
    for (const kind of BUZZ_ONLY_KINDS) {
        assert.equal(mayWriteKind(kind, 'other'), false, `kind ${kind} must not reach a non-Buzz relay`)
    }
    assert.equal(mayWriteKind(EXTENSION_KIND, 'other', buzzProfile), false)
})

test('a Buzz-only kind is allowed on a Buzz space', () => {
    // The gate has to let the plan's phases through, or it is just an off switch.
    for (const kind of BUZZ_ONLY_KINDS) {
        assert.equal(mayWriteKind(kind, 'buzz'), true, `kind ${kind} must be writable on Buzz`)
    }
})

test('the NIP-51 list kinds are allowed on both relays', () => {
    // 10001/10003/30003 are protocol-wide, author-owned and replaceable. They are in
    // Buzz's ingest allowlist (`kind.rs:22,32,43`) and are ordinary valid events on
    // zooid — no dialect, so no restriction.
    for (const kind of NIP51_KINDS) {
        assert.equal(mayWriteKind(kind, 'buzz'), true, `kind ${kind} on Buzz`)
        assert.equal(mayWriteKind(kind, 'other'), true, `kind ${kind} on a non-Buzz relay`)
    }
})

// ── The second condition: an advertised extension ───────────────────────────

test('30300 needs the advertised nip-er extension, not just a Buzz relay', () => {
    // A Buzz deployment without the NIP-ER scheduler accepts the reminder and never
    // delivers it. That is a silent failure with a signed event behind it, so the
    // advertisement is a condition and not a hint.
    assert.equal(mayWriteKind(EXTENSION_KIND, 'buzz', buzzProfile), true)
    assert.equal(mayWriteKind(EXTENSION_KIND, 'buzz'), false)
    assert.equal(mayWriteKind(EXTENSION_KIND, 'buzz', {}), false)
    assert.equal(mayWriteKind(EXTENSION_KIND, 'buzz', { supported_extensions: ['nip-pl'] }), false)
})

test('the extension condition does not turn a non-Buzz relay into a Buzz one', () => {
    // Both conditions hold at once. A relay that advertised `nip-er` without being Buzz
    // still gets no 30300 from us.
    assert.equal(mayWriteKind(EXTENSION_KIND, 'other', { supported_extensions: [NIP_ER_EXTENSION] }), false)
})

test('the extension identifier is the one Buzz actually advertises', () => {
    // Asserting the constant against its own literal would only restate the source.
    // Bind it to the measured answer instead: `buzzProfile` is what production returned
    // on 2026-09-03, so a typo in the constant makes this test red rather than silently
    // switching 30300 off everywhere.
    assert.ok(
        buzzProfile.supported_extensions.includes(NIP_ER_EXTENSION),
        `the gate looks for "${NIP_ER_EXTENSION}", which Buzz does not advertise`,
    )
})

// ── Fail-closed on everything not in the table ──────────────────────────────

test('a kind nobody registered is denied', () => {
    // A kind that is not in the table is a kind whose relay requirement was never
    // decided. Denying makes the omission loud on the first attempt instead of leaking
    // the next dialect kind onto zooid silently.
    assert.equal(mayWriteKind(40005, 'buzz'), false)
    assert.equal(mayWriteKind(40005, 'other'), false)
    assert.equal(mayWriteKind(30300 + 1, 'buzz', buzzProfile), false)
})

test('the gate is not a general publish gate — the everyday kinds are denied too', () => {
    // Stated as a test so it cannot be mistaken for an oversight: kind 9 chat, kind 7
    // reactions and the NIP-29 admin kinds are outside this gate's mandate. Wiring it
    // into a shared publish helper would break them, loudly and immediately.
    for (const kind of [0, 5, 7, 9, 9000, 9005, 30078]) {
        assert.equal(mayWriteKind(kind, 'buzz'), false, `kind ${kind} is not governed here`)
    }
})

// ── P7: NIP-17 / NIP-59 ────────────────────────────────────────────────────

test('a gift wrap (1059) may be written on either relay', () => {
    // Both were asked, not read: Buzz names KIND_GIFT_WRAP in its ingest allowlist and
    // waives the pubkey/auth match for it; zooid authorises the recipient instead of the
    // author. Measured with a requery on 2026-09-05 (`p7-messung-a-wrap-drift.txt`).
    assert.equal(mayWriteKind(1059, 'buzz'), true)
    assert.equal(mayWriteKind(1059, 'other'), true)
    assert.equal(mayWriteKind(1059, 'unknown'), false)
})

test('a messaging relay list (10050) is refused on Buzz and allowed elsewhere', () => {
    // The first entry in this table that protects the USER from a relay rather than the
    // relay from the client: Buzz has no constant for 10050 at all and answers
    // `restricted: unknown event kind`. Measured with kind 10000 as the positive control
    // in the same run (`p7-messung-c-kind10050.txt`).
    assert.equal(mayWriteKind(10050, 'buzz'), false)
    assert.equal(mayWriteKind(10050, 'other'), true)
    assert.equal(mayWriteKind(10050, 'unknown'), false)
})

test("the 'other' rule is not the 'any' rule with extra words", () => {
    // If `'other'` ever collapsed into `'any'`, 10050 would be signed on a Buzz space and
    // bounced there — the exact failure the entry exists to prevent. Held against a kind
    // that IS `'any'`, so the two answers have to differ on a Buzz space.
    assert.notEqual(mayWriteKind(10050, 'buzz'), mayWriteKind(10000, 'buzz'))
})
