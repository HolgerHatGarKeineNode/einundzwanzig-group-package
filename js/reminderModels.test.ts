/**
 * The rules of a private reminder (NIP-ER, Buzz kind 30300) — the pure half.
 *
 *   node --test --experimental-strip-types packages/einundzwanzig-group/js/reminderModels.test.ts
 *
 * Five promises, each of which fails silently if it breaks:
 *
 *  1. **The envelope is what the relay accepts.** `validate_event_reminder` rejects with
 *     a bare `invalid: …` string; welshman surfaces that as a publish error, but only
 *     after the user's signing device has already prompted. Building an event the relay
 *     refuses spends a signature on nothing.
 *  2. **The content is encrypted to the author and to nobody else.** Checked here with a
 *     real NIP-44 round trip and a real foreign key, not with a stub — the negative case
 *     is the whole promise.
 *  3. **The horizon comes out of NIP-11.** Hard-coded, it would be wrong the moment an
 *     operator sets `SPROUT_MAX_NOT_BEFORE_DELTA`, and the symptom would be a reminder
 *     that was silently never scheduled.
 *  4. **The surface is off when the relay does not advertise `nip-er`.** A relay that
 *     stores 30300 without running the scheduler accepts every reminder and delivers
 *     none.
 *  5. **Due-ness is decided here, not by the relay.** NIP-ER is explicit that a relay may
 *     serve early, late, repeatedly or not at all.
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { Nip01Signer } from '@welshman/signer'
import { generateSecretKey } from 'nostr-tools/pure'
import {
    CLEANUP_MAX_SECONDS,
    CLEANUP_MIN_SECONDS,
    EVENT_REMINDER,
    MAX_NOT_BEFORE,
    PREVIEW_MAX_CHARS,
    REMINDER_ALT,
    REMINDER_DELAYS,
    REMINDER_D_ENTROPY_BITS,
    availableDelays,
    buildReminderEvent,
    cleanupExpiration,
    dueReminders,
    foldReminders,
    hasDuplicateJsonKeys,
    isCanonicalTimestamp,
    makeReminderD,
    parseReminderContent,
    pendingReminders,
    planReminder,
    reminderD,
    reminderNotBefore,
    reminderPlaintext,
    reminderTargetFor,
    validateReminderTags,
    type ReminderContent,
    type ReminderContext,
    type ReminderEventLike,
} from './reminderModels.ts'
import { maxNotBeforeDelta } from './relayCaps.ts'

/** `Uint8Array` → lowercase hex. `@noble/hashes/utils` is not an exported subpath here. */
const hex = (bytes: Uint8Array): string =>
    Array.from(bytes)
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('')

const NOW = 1_800_000_000
const YEAR = 31_536_000
const URL_ = 'wss://buzz.example/'
const ID_A = 'a'.repeat(64)
const ID_B = 'b'.repeat(64)
const SELF = 'c'.repeat(64)

/** The NIP-11 doc of a Buzz relay, as production answered it on 2026-09-03. */
const BUZZ_PROFILE = {
    supported_extensions: ['nip-er', 'nip-pl'],
    limitation: { max_not_before_delta: YEAR },
}

const ctx = (over: Partial<ReminderContext> = {}): ReminderContext => ({
    nowSecs: NOW,
    spaceKind: 'buzz',
    profile: BUZZ_PROFILE,
    ...over,
})

const pending: ReminderContent = { target: { id: ID_A }, status: 'pending', note: 'nachfassen' }

const tagValue = (tags: string[][], name: string): string | undefined =>
    tags.find((tag) => tag[0] === name)?.[1]

// ══ 1. The four form rules of the envelope ═════════════════════════════════════
//
// Mirrored from `validate_event_reminder` (`ingest.rs:1766-1834`) and
// `validate_not_before` (`:1735-1755`) at `fc0d2bc5`. The wording of each answer is the
// relay's own, so a rejection here reads like a rejection there.

describe('form rule 1 — exactly one, non-empty `d`', () => {
    test('no `d` at all', () => {
        assert.equal(validateReminderTags([['alt', REMINDER_ALT]], NOW, YEAR), 'missing d tag')
    })

    test('two `d` tags', () => {
        assert.equal(validateReminderTags([['d', 'x'], ['d', 'y']], NOW, YEAR), 'duplicate d tag')
    })

    test('an empty `d`', () => {
        assert.equal(validateReminderTags([['d', '']], NOW, YEAR), 'empty d tag')
    })

    test('a bare `["d"]` is NOT an empty d tag — it is no d tag', () => {
        // The relay skips every tag shorter than two entries before it looks at the name
        // (`if parts.len() < 2 { continue }`). A client that treated this as "empty" would
        // report a different reason than the relay for the same event.
        assert.equal(validateReminderTags([['d']], NOW, YEAR), 'missing d tag')
    })

    test('exactly one non-empty `d` passes', () => {
        assert.equal(validateReminderTags([['d', 'x']], NOW, YEAR), '')
    })
})

describe('form rule 2 — `d` carries at least 128 bits of entropy', () => {
    test('a minted `d` is 128 bits of hex', () => {
        const d = makeReminderD()
        assert.equal(REMINDER_D_ENTROPY_BITS, 128)
        assert.match(d, /^[0-9a-f]{32}$/, '32 lowercase hex chars = 16 bytes = 128 bit')
    })

    test('every byte of the CSPRNG output reaches the `d`', () => {
        // The failure this catches is a truncating hex conversion — `toString(16)` without
        // `padStart` drops the leading zero of every byte below 0x10, and a `d` of 16
        // random bytes silently becomes one of ~25 hex chars. Still random, no longer 128
        // bits, and nothing would have complained.
        const bytes = new Uint8Array([0, 1, 15, 16, 255, 7, 8, 9, 10, 11, 12, 13, 14, 128, 254, 3])
        assert.equal(makeReminderD(() => bytes), '00010f10ff0708090a0b0c0d0e80fe03')
        assert.equal(makeReminderD(() => bytes).length, 32)
    })

    test('two calls differ', () => {
        assert.notEqual(makeReminderD(), makeReminderD())
    })

    test('the minted `d` is asked of the CSPRNG, not derived from the reminder', () => {
        // NIP-ER forbids deriving `d` from the target, the text or the time — the tag is
        // public and would otherwise hand the relay what the ciphertext hides. Measured
        // structurally: the function takes no reminder input at all.
        assert.equal(makeReminderD.length, 0, 'no required parameter — a reminder cannot be passed in at all')
    })
})

describe('form rule 3 — at most one `not_before`, canonical decimal', () => {
    test('a leading zero is refused', () => {
        assert.equal(isCanonicalTimestamp('007'), false)
        assert.equal(isCanonicalTimestamp('0'), true, '"0" is the one value allowed to start with 0')
    })

    test('sign, space, decimal point and empty are refused', () => {
        for (const bad of ['', ' 1', '1 ', '+1', '-1', '1.0', '1e3', '0x10', '١٢٣']) {
            assert.equal(isCanonicalTimestamp(bad), false, `"${bad}"`)
        }
    })

    test('the range ends at Number.MAX_SAFE_INTEGER, exactly', () => {
        assert.equal(isCanonicalTimestamp(String(MAX_NOT_BEFORE)), true)
        assert.equal(isCanonicalTimestamp('9007199254740992'), false, 'one past the bound')
        assert.equal(isCanonicalTimestamp('9007199254740993'), false, 'the value Number() silently rounds')
        assert.equal(isCanonicalTimestamp('99999999999999999999'), false, 'longer than the bound')
    })

    test('two `not_before` tags are `malformed not_before`, like the relay says', () => {
        const tags = [['d', 'x'], ['not_before', String(NOW + 60)], ['not_before', String(NOW + 120)]]
        assert.equal(validateReminderTags(tags, NOW, YEAR), 'malformed not_before')
    })

    test('a non-canonical `not_before` is refused inside the envelope too', () => {
        assert.equal(
            validateReminderTags([['d', 'x'], ['not_before', '0' + String(NOW + 60)]], NOW, YEAR),
            'malformed not_before',
        )
    })

    test('beyond the horizon is refused with the relay’s wording', () => {
        assert.equal(
            validateReminderTags([['d', 'x'], ['not_before', String(NOW + YEAR + 1)]], NOW, YEAR),
            'not_before too far in future',
        )
        assert.equal(validateReminderTags([['d', 'x'], ['not_before', String(NOW + YEAR)]], NOW, YEAR), '', 'the bound is inclusive')
    })
})

describe('form rule 4 — `expiration` must be strictly greater than `not_before`', () => {
    const withBoth = (nb: number, exp: number) => [
        ['d', 'x'],
        ['not_before', String(nb)],
        ['expiration', String(exp)],
    ]

    test('equal is refused — the reminder would expire in the second it came due', () => {
        assert.equal(validateReminderTags(withBoth(NOW + 60, NOW + 60), NOW, YEAR), 'expiration before not_before')
    })

    test('earlier is refused', () => {
        assert.equal(validateReminderTags(withBoth(NOW + 60, NOW + 59), NOW, YEAR), 'expiration before not_before')
    })

    test('one second later passes', () => {
        assert.equal(validateReminderTags(withBoth(NOW + 60, NOW + 61), NOW, YEAR), '')
    })

    test('an `expiration` WITHOUT `not_before` is never compared', () => {
        // The terminal shape: `done`/`cancelled` drop `not_before` and add a cleanup
        // `expiration` that is necessarily "before" a `not_before` that no longer exists.
        // Both the relay and NIP-ER only compare when both are present.
        assert.equal(validateReminderTags([['d', 'x'], ['expiration', String(NOW + 1)]], NOW, YEAR), '')
    })
})

// ══ 2. The content is NIP-44 to self — and to nobody else ══════════════════════

describe('the content is encrypted to the author’s own key', () => {
    const secret = generateSecretKey()
    const mine = Nip01Signer.fromSecret(hex(secret))
    const foreignSecret = generateSecretKey()
    const foreign = Nip01Signer.fromSecret(hex(foreignSecret))

    test('POSITIVE: the author decrypts their own reminder back to the exact plaintext', async () => {
        const myPubkey = await mine.getPubkey()
        const plan = planReminder(makeReminderD(), pending, 3600, ctx())
        assert.ok(plan, 'precondition: the plan exists')

        const event = await buildReminderEvent(plan, (text) => mine.nip44.encrypt(myPubkey, text))

        assert.equal(event.kind, EVENT_REMINDER)
        assert.notEqual(event.content, plan.plaintext, 'the content is not the plaintext')
        assert.equal(
            await mine.nip44.decrypt(myPubkey, event.content),
            plan.plaintext,
            'and it decrypts back byte for byte',
        )
        assert.deepEqual(parseReminderContent(await mine.nip44.decrypt(myPubkey, event.content)), pending)
    })

    test('NEGATIVE: a foreign key cannot read it — neither from its own side nor from ours', async () => {
        const myPubkey = await mine.getPubkey()
        const foreignPubkey = await foreign.getPubkey()
        const plan = planReminder(makeReminderD(), pending, 3600, ctx())
        assert.ok(plan)
        const event = await buildReminderEvent(plan, (text) => mine.nip44.encrypt(myPubkey, text))

        // The conversation key is derived from (foreign secret, our pubkey) — a different
        // key than (our secret, our pubkey), so the MAC check fails before any plaintext
        // exists. This is the whole confidentiality promise of the phase.
        await assert.rejects(
            () => foreign.nip44.decrypt(myPubkey, event.content),
            'a stranger holding the ciphertext and our pubkey must not get the note',
        )
        await assert.rejects(
            () => mine.nip44.decrypt(foreignPubkey, event.content),
            'and neither does the same ciphertext read against the wrong counterparty',
        )
    })

    test('NEGATIVE: the private note never appears in the tags', () => {
        const secretNote = 'Kontostand pruefen bei Hausbank XY'
        const plan = planReminder(makeReminderD(), { status: 'pending', note: secretNote }, 3600, ctx())
        assert.ok(plan)
        const flat = JSON.stringify(plan.tags)
        assert.equal(flat.includes(secretNote), false, 'the note must not leak into a public tag')
        assert.equal(flat.includes(ID_A), false, 'and neither must a target id')
        assert.equal(tagValue(plan.tags, 'alt'), REMINDER_ALT, 'the alt text is a constant, not the note')
    })

    test('a signer that echoes its input is refused instead of publishing the note in the clear', async () => {
        const plan = planReminder(makeReminderD(), pending, 3600, ctx())
        assert.ok(plan)
        await assert.rejects(
            () => buildReminderEvent(plan, async (text) => text),
            /plaintext unchanged/,
            'an echoing signer would publish the private note under the author’s own key',
        )
    })

    test('a signer that answers empty is refused too', async () => {
        const plan = planReminder(makeReminderD(), pending, 3600, ctx())
        assert.ok(plan)
        await assert.rejects(() => buildReminderEvent(plan, async () => ''), /empty ciphertext/)
    })
})

// ══ 3. The horizon comes out of NIP-11 ═════════════════════════════════════════

describe('the horizon is read from NIP-11, never assumed', () => {
    test('the production value is taken as it stands', () => {
        assert.equal(maxNotBeforeDelta(BUZZ_PROFILE), YEAR)
    })

    test('a LOWER horizon really shortens what may be planned', () => {
        // The load-bearing case: if the bound were hard-coded to a year, this plan would
        // be built and the relay would answer `invalid: not_before too far in future` —
        // after the signature prompt.
        const small = { supported_extensions: ['nip-er'], limitation: { max_not_before_delta: 7200 } }
        assert.equal(maxNotBeforeDelta(small), 7200)
        assert.ok(planReminder(makeReminderD(), pending, 7200, ctx({ profile: small })), 'exactly at the bound')
        assert.equal(planReminder(makeReminderD(), pending, 7201, ctx({ profile: small })), null, 'one second past it')
        // …and the same delay is fine against the production horizon, so the refusal above
        // came from the doc and not from a second hidden limit.
        assert.ok(planReminder(makeReminderD(), pending, 7201, ctx()))
    })

    test('the offered delays shrink with the horizon', () => {
        assert.deepEqual(availableDelays(7200).map((d) => d.key), ['In 1 Stunde'], 'two hours fit one choice')
        assert.deepEqual(
            availableDelays(3 * 60 * 60).map((d) => d.key),
            ['In 1 Stunde', 'In 3 Stunden'],
            'the bound is inclusive — a delay exactly at the horizon stays on offer',
        )
        assert.equal(availableDelays(YEAR).length, REMINDER_DELAYS.length, 'a year offers all of them')
        assert.deepEqual(availableDelays(null), [], 'no stated horizon offers nothing')
    })

    test('a missing or unusable horizon denies — it does not fall back to a default', () => {
        for (const limitation of [undefined, {}, { max_not_before_delta: 0 }, { max_not_before_delta: -1 }]) {
            const profile = { supported_extensions: ['nip-er'], ...(limitation ? { limitation } : {}) }
            assert.equal(maxNotBeforeDelta(profile), null, JSON.stringify(limitation))
            assert.equal(planReminder(makeReminderD(), pending, 3600, ctx({ profile })), null)
        }
    })

    test('a numeric STRING is not a number — the field is refused, not parsed', () => {
        // welshman hands non-standard NIP-11 fields through raw, so what arrives here is
        // foreign JSON. Putting a `parseInt` between us and a bound that decides whether an
        // event is accepted would be a guess about someone else's document.
        const profile = { supported_extensions: ['nip-er'], limitation: { max_not_before_delta: '31536000' } }
        assert.equal(maxNotBeforeDelta(profile as never), null)
    })

    test('a horizon of exactly one year is NOT written down anywhere in this module', async () => {
        // The calibration for the promise above: a test that only asserts behaviour would
        // stay green if someone re-introduced the default as a constant and used it as a
        // fallback. Read at the source instead.
        const source = await (await import('node:fs/promises')).readFile(
            new URL('./reminderModels.ts', import.meta.url),
            'utf8',
        )
        const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
        assert.equal(code.includes('31536000'), false, 'the one-year default must not appear as code')
        assert.equal(code.includes('31_536_000'), false)
    })
})

// ══ 4. The surface is off without the `nip-er` extension ═══════════════════════

describe('the gate: relay kind and advertised extension, both', () => {
    test('a Buzz relay that does NOT advertise `nip-er` yields no plan', () => {
        const noEr = { supported_extensions: ['nip-pl'], limitation: { max_not_before_delta: YEAR } }
        assert.equal(planReminder(makeReminderD(), pending, 3600, ctx({ profile: noEr })), null)
    })

    test('a missing `supported_extensions` yields no plan', () => {
        const bare = { limitation: { max_not_before_delta: YEAR } }
        assert.equal(planReminder(makeReminderD(), pending, 3600, ctx({ profile: bare })), null)
    })

    test('a zooid space yields no plan even with a doc that advertises everything', () => {
        // zooid has no kind allowlist: it would accept and STORE the reminder forever,
        // encrypted, scheduled by nobody.
        assert.equal(planReminder(makeReminderD(), pending, 3600, ctx({ spaceKind: 'other' })), null)
    })

    test('`unknown` — NIP-11 still in flight — denies', () => {
        assert.equal(planReminder(makeReminderD(), pending, 3600, ctx({ spaceKind: 'unknown' })), null)
    })

    test('COUNTER-PROOF: the same call on a Buzz space with `nip-er` DOES produce a plan', () => {
        assert.ok(planReminder(makeReminderD(), pending, 3600, ctx()), 'otherwise every case above is green for nothing')
    })
})

// ══ 5. Due-ness is decided here ════════════════════════════════════════════════

const evt = (over: Partial<ReminderEventLike> & { d: string }): ReminderEventLike => ({
    id: over.id ?? ID_A,
    pubkey: over.pubkey ?? SELF,
    created_at: over.created_at ?? NOW,
    content: 'ciphertext',
    tags: over.tags ?? [['d', over.d]],
})

const texts = (pairs: [string, ReminderContent][]) =>
    new Map(pairs.map(([id, content]) => [id, reminderPlaintext(content)]))

describe('folding and due-ness', () => {
    test('the newest replacement wins, ties by lowest id', () => {
        const older = evt({ d: 'r1', id: ID_A, created_at: NOW - 10 })
        const newer = evt({ d: 'r1', id: ID_B, created_at: NOW })
        const folded = foldReminders(
            [older, newer],
            SELF,
            texts([
                [ID_A, { status: 'pending', note: 'alt' }],
                [ID_B, { status: 'done', note: 'neu' }],
            ]),
        )
        assert.equal(folded.length, 1)
        assert.equal(folded[0].status, 'done')

        // Same second, different id: the LOWER id wins, per NIP-01 and NIP-ER. Two devices
        // that both act in the same second must land on the same answer.
        const tieA = evt({ d: 'r2', id: ID_A, created_at: NOW })
        const tieB = evt({ d: 'r2', id: ID_B, created_at: NOW })
        for (const order of [[tieA, tieB], [tieB, tieA]]) {
            const tie = foldReminders(
                order,
                SELF,
                texts([
                    [ID_A, { status: 'cancelled', note: 'a' }],
                    [ID_B, { status: 'done', note: 'b' }],
                ]),
            )
            assert.equal(tie[0].id, ID_A, 'the lexicographically lower id wins, whatever the input order')
        }
    })

    test('a reminder we cannot decrypt is ignored, not shown half-empty', () => {
        const folded = foldReminders([evt({ d: 'r1' })], SELF, new Map([[ID_A, undefined]]))
        assert.deepEqual(folded, [])
    })

    test('a foreign author is dropped', () => {
        const folded = foldReminders(
            [evt({ d: 'r1', pubkey: 'f'.repeat(64) })],
            SELF,
            texts([[ID_A, { status: 'pending', note: 'x' }]]),
        )
        assert.deepEqual(folded, [])
    })

    test('due means `not_before <= now`, decided locally', () => {
        const past = evt({ d: 'r1', id: ID_A, tags: [['d', 'r1'], ['not_before', String(NOW - 1)]] })
        const future = evt({ d: 'r2', id: ID_B, tags: [['d', 'r2'], ['not_before', String(NOW + 1)]] })
        const folded = foldReminders(
            [past, future],
            SELF,
            texts([
                [ID_A, { status: 'pending', note: 'faellig' }],
                [ID_B, { status: 'pending', note: 'spaeter' }],
            ]),
        )
        assert.deepEqual(dueReminders(folded, NOW).map((r) => r.d), ['r1'])
        assert.deepEqual(pendingReminders(folded, NOW).map((r) => r.d), ['r2'])

        // The boundary, fixed on purpose: `not_before === now` IS due. NIP-ER defines a
        // due reminder as one whose `not_before` is "less than or equal to" now.
        const edge = evt({ d: 'r3', id: ID_A, tags: [['d', 'r3'], ['not_before', String(NOW)]] })
        const one = foldReminders([edge], SELF, texts([[ID_A, { status: 'pending', note: 'jetzt' }]]))
        assert.equal(dueReminders(one, NOW).length, 1)
    })

    test('a TERMINAL head that still carries `not_before` is terminal, not due', () => {
        // NIP-ER, verbatim: "If a latest replacement decrypts to `done` or `cancelled` but
        // carries `not_before`, clients MUST treat it as terminal state and MUST NOT
        // schedule or display a due notification for it." The relay cannot see `status`,
        // so this is the client's job alone.
        const stale = evt({ d: 'r1', tags: [['d', 'r1'], ['not_before', String(NOW - 100)]] })
        const folded = foldReminders([stale], SELF, texts([[ID_A, { status: 'done', note: 'erledigt' }]]))
        assert.equal(folded[0].status, 'done')
        assert.equal(folded[0].notBefore, null)
        assert.deepEqual(dueReminders(folded, NOW), [])
    })

    test('a pending head WITHOUT exactly one valid `not_before` is never due', () => {
        for (const tags of [
            [['d', 'r1']],
            [['d', 'r1'], ['not_before', String(NOW - 1)], ['not_before', String(NOW - 2)]],
            [['d', 'r1'], ['not_before', '0' + String(NOW - 1)]],
        ]) {
            const folded = foldReminders(
                [evt({ d: 'r1', tags })],
                SELF,
                texts([[ID_A, { status: 'pending', note: 'x' }]]),
            )
            assert.equal(folded[0].notBefore, null, JSON.stringify(tags))
            assert.deepEqual(dueReminders(folded, NOW), [])
        }
    })

    test('`reminderD` and `reminderNotBefore` read the same tags the relay does', () => {
        assert.equal(reminderD(evt({ d: 'x' })), 'x')
        assert.equal(reminderD(evt({ d: 'x', tags: [['alt', 'a']] })), '')
        assert.equal(reminderNotBefore(evt({ d: 'x', tags: [['d', 'x'], ['not_before', '1800000000']] })), 1_800_000_000)
    })
})

// ══ The content parser ════════════════════════════════════════════════════════

describe('parseReminderContent — every case NIP-ER tells a client to ignore', () => {
    const ok = (content: ReminderContent) => parseReminderContent(reminderPlaintext(content))

    test('a valid target-backed and a valid note-only reminder both parse', () => {
        assert.deepEqual(ok({ target: { id: ID_A }, status: 'pending' }), { target: { id: ID_A }, status: 'pending' })
        assert.deepEqual(ok({ status: 'pending', note: 'Beleg einreichen' }), { status: 'pending', note: 'Beleg einreichen' })
    })

    test('an unknown status is ignored', () => {
        assert.equal(parseReminderContent('{"status":"snoozed"}'), null)
        assert.equal(parseReminderContent('{"note":"x"}'), null, 'and so is a missing one')
    })

    test('not an object, or not JSON at all', () => {
        for (const bad of ['', 'null', '[]', '"pending"', '42', '{', 'undefined']) {
            assert.equal(parseReminderContent(bad), null, JSON.stringify(bad))
        }
        assert.equal(parseReminderContent(undefined), null, 'a failed decryption')
    })

    test('duplicate member names are ignored — in the object AND in the target', () => {
        assert.equal(parseReminderContent('{"status":"done","status":"pending"}'), null)
        assert.equal(parseReminderContent(`{"status":"pending","target":{"id":"${ID_A}","id":"${ID_B}"}}`), null)
    })

    test('a malformed target reference drops the whole reminder', () => {
        assert.equal(parseReminderContent(`{"status":"pending","target":{"id":"ABC"}}`), null, 'not 64 lowercase hex')
        assert.equal(parseReminderContent(`{"status":"pending","target":{"id":"${ID_A.toUpperCase()}"}}`), null, 'uppercase hex')
        assert.equal(parseReminderContent(`{"status":"pending","target":{"a":"30023:kurz:d"}}`), null, 'not an address')
        assert.equal(parseReminderContent(`{"status":"pending","target":[]}`), null, 'target is not an object')
        assert.equal(parseReminderContent(`{"status":"pending","note":1}`), null, 'note is not a string')
    })

    test('a valid address target passes', () => {
        const a = `30023:${ID_A}:mein-artikel`
        assert.deepEqual(parseReminderContent(`{"status":"pending","target":{"a":"${a}"}}`), {
            target: { a },
            status: 'pending',
        })
    })

    test('relay hints are FILTERED per entry, not grounds to drop the reminder', () => {
        const parsed = parseReminderContent(
            `{"status":"pending","target":{"id":"${ID_A}","relays":["wss://ok.example/","https://nope.example/","",7,"wss://"]}}`,
        )
        assert.deepEqual(parsed?.target?.relays, ['wss://ok.example/'])
        // But a `relays` that is not an array at all is a malformed document.
        assert.equal(parseReminderContent(`{"status":"pending","target":{"id":"${ID_A}","relays":"wss://x/"}}`), null)
    })

    test('a PENDING reminder needs a reference or a note; a terminal one needs neither', () => {
        assert.equal(parseReminderContent('{"status":"pending"}'), null)
        assert.equal(parseReminderContent('{"status":"pending","note":"   "}'), null, 'whitespace is not a note')
        assert.deepEqual(parseReminderContent('{"status":"done"}'), { status: 'done' })
        assert.deepEqual(parseReminderContent('{"status":"cancelled"}'), { status: 'cancelled' })
    })

    test('unknown fields are dropped rather than carried through', () => {
        assert.deepEqual(parseReminderContent(`{"status":"done","recurrence":"weekly"}`), { status: 'done' })
    })
})

describe('hasDuplicateJsonKeys — the scanner is string-aware', () => {
    test('finds a repeat at any depth', () => {
        assert.equal(hasDuplicateJsonKeys('{"a":1,"a":2}'), true)
        assert.equal(hasDuplicateJsonKeys('{"t":{"x":1,"x":2}}'), true)
        assert.equal(hasDuplicateJsonKeys('{"l":[{"x":1},{"x":2}]}'), false, 'two objects, one key each')
    })

    test('a brace, a quote or a colon INSIDE a string is data', () => {
        assert.equal(hasDuplicateJsonKeys('{"note":"a{\\"b\\":1,\\"b\\":2}"}'), false)
        assert.equal(hasDuplicateJsonKeys('{"note":"x:y","n2":"a:b"}'), false)
        assert.equal(hasDuplicateJsonKeys('{"note":"ends with backslash \\\\","note":"again"}'), true)
    })

    test('the same name in sibling objects is not a duplicate', () => {
        assert.equal(hasDuplicateJsonKeys('{"a":{"id":1},"b":{"id":2}}'), false)
    })
})

// ══ Planning: the two shapes ══════════════════════════════════════════════════

describe('planReminder — the pending and the terminal shape', () => {
    test('pending: one `d`, one `not_before`, an `alt`, and NO `expiration`', () => {
        const d = makeReminderD()
        const plan = planReminder(d, pending, 3600, ctx())
        assert.ok(plan)
        assert.equal(plan.kind, EVENT_REMINDER)
        assert.deepEqual(plan.tags, [
            ['d', d],
            ['not_before', String(NOW + 3600)],
            ['alt', REMINDER_ALT],
        ])
    })

    test('terminal: no `not_before`, a jittered cleanup `expiration`', () => {
        const d = makeReminderD()
        const plan = planReminder(d, { status: 'done' }, null, ctx(), () => 0.5)
        assert.ok(plan)
        assert.equal(tagValue(plan.tags, 'not_before'), undefined, 'a done reminder must never stay in the due query')
        assert.equal(tagValue(plan.tags, 'expiration'), String(NOW + CLEANUP_MIN_SECONDS + (CLEANUP_MAX_SECONDS - CLEANUP_MIN_SECONDS) / 2))
    })

    test('the cleanup window is 30 to 90 days and the jitter really moves', () => {
        assert.equal(cleanupExpiration(NOW, () => 0), NOW + CLEANUP_MIN_SECONDS, 'the floor is 30 days')
        // `Math.random()` never returns 1, so the ceiling is open: the value stays strictly
        // below 90 days however close the draw gets.
        assert.ok(cleanupExpiration(NOW, () => 0.9999999999) < NOW + CLEANUP_MAX_SECONDS)
        assert.ok(cleanupExpiration(NOW, () => 0.9999999999) > NOW + CLEANUP_MAX_SECONDS - 10)
        assert.notEqual(cleanupExpiration(NOW, () => 0), cleanupExpiration(NOW, () => 0.9))
    })

    test('a pending reminder without a delay is refused — a bookmark is P2’s job', () => {
        assert.equal(planReminder(makeReminderD(), pending, null, ctx()), null)
        assert.equal(planReminder(makeReminderD(), pending, 0, ctx()), null)
        assert.equal(planReminder(makeReminderD(), pending, -60, ctx()), null)
        assert.equal(planReminder(makeReminderD(), pending, 1.5, ctx()), null)
    })

    test('an empty `d` or an unusable clock is refused', () => {
        assert.equal(planReminder('', pending, 3600, ctx()), null)
        assert.equal(planReminder(makeReminderD(), pending, 3600, ctx({ nowSecs: 0 })), null)
        assert.equal(planReminder(makeReminderD(), pending, 3600, ctx({ nowSecs: 1.5 })), null)
    })

    test('a content this client could not read back is refused before it is signed', () => {
        // `pending` with neither reference nor note round-trips to `null` in the parser —
        // building it would produce a reminder the author's own next session drops.
        assert.equal(planReminder(makeReminderD(), { status: 'pending' }, 3600, ctx()), null)
    })

    test('every plan the planner returns passes the relay’s own envelope check', () => {
        for (const [content, delay] of [[pending, 3600], [{ status: 'done' } as ReminderContent, null]] as const) {
            const plan = planReminder(makeReminderD(), content, delay, ctx())
            assert.ok(plan)
            assert.equal(validateReminderTags(plan.tags, NOW, YEAR), '')
        }
    })
})

describe('reminderTargetFor', () => {
    test('carries the id, the relay it was read from and a trimmed preview', () => {
        assert.deepEqual(reminderTargetFor(ID_A, URL_, '  hallo   welt \n'), {
            id: ID_A,
            relays: [URL_],
            preview: 'hallo welt',
        })
    })

    test('a preview is capped', () => {
        const target = reminderTargetFor(ID_A, URL_, 'x'.repeat(500))
        assert.equal(target?.preview?.length, PREVIEW_MAX_CHARS)
    })

    test('a non-relay url is dropped, an unusable id refuses the whole target', () => {
        assert.deepEqual(reminderTargetFor(ID_A, 'https://buzz.example/', 'x'), { id: ID_A, preview: 'x' })
        assert.equal(reminderTargetFor('nope', URL_, 'x'), null)
    })
})
