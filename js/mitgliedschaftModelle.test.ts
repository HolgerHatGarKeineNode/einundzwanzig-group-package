/**
 * „Ich › Verein" (D11, P5) — the rules of the page, without a browser and without a signer.
 *   node --test --experimental-strip-types packages/einundzwanzig-group/js/mitgliedschaftModelle.test.ts
 *
 * The payload shapes are the association's own, read in `einundzwanzig-verein` on 2026-09-18:
 * `MembershipResource` (two status fields side by side, `current_year` nested) and
 * `PaymentEventResource` (`year`, `amount`, `currency`, `paid`, `receipt_url` — the receipt
 * only once the fee is settled). Everything here is measured against those, not against an
 * invented shape.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
    cacheIsFresh,
    MITGLIEDSCHAFT_CACHE_MS,
    mitgliedschaftZustand,
    readMembership,
    readMembershipStatus,
    readPayments,
} from './mitgliedschaftModelle.ts'

/** `GET /api/v1/membership/me` of an active member, as the association sends it. */
const ME_AKTIV = {
    data: {
        pubkey: 'a'.repeat(64),
        association_status: 'Active',
        association_status_value: 2,
        membership_status: 'active',
        statutes_accepted_at: '2026-01-04T10:12:00+01:00',
        applied_at: '2026-01-04T10:12:00+01:00',
        current_year: {
            year: 2026,
            fee: 42,
            currency: 'EUR',
            paid: true,
            receipt_url: 'https://btcpay.example/i/abc/receipt',
        },
    },
}

// ── /payments ──────────────────────────────────────────────────────────────────────────

test('readPayments: newest year first, receipt only where the fee is settled', () => {
    const rows = readPayments({
        data: [
            { year: 2025, amount: 42, currency: 'EUR', paid: true, receipt_url: 'https://btcpay.example/i/2025' },
            { year: 2026, amount: 42, currency: 'EUR', paid: false, receipt_url: null },
        ],
    })

    assert.deepEqual(rows.map((row) => row.year), [2026, 2025])
    assert.equal(rows[0].paid, false)
    assert.equal(rows[0].receiptUrl, null)
    assert.equal(rows[1].receiptUrl, 'https://btcpay.example/i/2025')
})

test('readPayments: a bare array is read too — an unwrapping proxy must not empty the list', () => {
    const rows = readPayments([{ year: 2026, amount: 42, currency: 'EUR', paid: true }])

    assert.equal(rows.length, 1)
    assert.equal(rows[0].year, 2026)
})

test('readPayments: `paid` only on an explicit true', () => {
    // A missing field is „not known". Reading it as „paid" would tell somebody their fee is
    // settled when nothing says so — and this page is where they would check.
    const rows = readPayments({ data: [{ year: 2026, amount: 42, currency: 'EUR' }, { year: 2025, paid: 'ja' }] })

    assert.equal(rows[0].paid, false)
    assert.equal(rows[1].paid, false)
})

test('readPayments: a row without a usable year is dropped, not guessed', () => {
    const rows = readPayments({
        data: [
            { amount: 42, paid: true },
            { year: 'letztes Jahr', paid: true },
            { year: 1999, paid: true },
            { year: 2026, amount: 42, currency: 'EUR', paid: true },
        ],
    })

    // The year is what the surface prints and what a receipt is addressed by.
    assert.deepEqual(rows.map((row) => row.year), [2026])
})

test('readPayments: nothing usable is an empty list, never a throw', () => {
    for (const body of [null, undefined, 'nope', {}, { data: 'nope' }, { data: [null, 7] }]) {
        assert.deepEqual(readPayments(body), [], JSON.stringify(body))
    }
})

test('readPayments: an empty receipt string is no receipt', () => {
    const rows = readPayments({ data: [{ year: 2026, paid: true, receipt_url: '   ' }] })

    assert.equal(rows[0].receiptUrl, null)
})

// ── the four states ────────────────────────────────────────────────────────────────────

test('mitgliedschaftZustand: an active membership', () => {
    const { me, membershipStatus } = readMembership(ME_AKTIV)

    assert.equal(mitgliedschaftZustand({ gelesen: true, ohneAkte: false, me, membershipStatus }), 'mitglied')
    assert.equal(me.year, 2026)
    assert.equal(me.fee, 42)
    assert.equal(me.paid, true)
    assert.equal(me.receiptUrl, 'https://btcpay.example/i/abc/receipt')
})

test('mitgliedschaftZustand: a LAPSED member is not active — the second status field decides', () => {
    /*
     * The row this whole function exists for. The association reports `association_status`
     * (the category the board assigned) and `membership_status` (whether the person is a
     * member right now) side by side, and they differ exactly when a fee year goes unpaid. A
     * surface reading only the first would call this person active.
     */
    const body = {
        data: {
            ...ME_AKTIV.data,
            association_status: 'Active',
            membership_status: 'awaiting_payment',
            current_year: { year: 2026, fee: 42, currency: 'EUR', paid: false, receipt_url: null },
        },
    }
    const { me, membershipStatus } = readMembership(body)

    assert.equal(membershipStatus, 'awaiting_payment')
    assert.equal(mitgliedschaftZustand({ gelesen: true, ohneAkte: false, me, membershipStatus }), 'zahlung-offen')
})

test('mitgliedschaftZustand: no record at all is „kein-antrag" (the 404 of a guest)', () => {
    assert.equal(
        mitgliedschaftZustand({ gelesen: true, ohneAkte: true, me: readMembership({}).me, membershipStatus: '' }),
        'kein-antrag',
    )
    assert.equal(
        mitgliedschaftZustand({ gelesen: true, ohneAkte: false, me: null, membershipStatus: '' }),
        'kein-antrag',
    )
})

test('mitgliedschaftZustand: an unreachable association is UNKNOWN, not „no"', () => {
    // The state a surface usually forgets. Saying „kein Antrag" here would be a statement
    // about somebody's membership that nobody measured.
    assert.equal(
        mitgliedschaftZustand({ gelesen: false, ohneAkte: false, me: readMembership(ME_AKTIV).me, membershipStatus: 'active' }),
        'unbekannt',
    )
})

test('readMembershipStatus: absent, wrong type and nested — all three without a throw', () => {
    assert.equal(readMembershipStatus(ME_AKTIV), 'active')
    assert.equal(readMembershipStatus({ membership_status: 'active' }), 'active', 'an unwrapped body counts too')
    assert.equal(readMembershipStatus({ data: { membership_status: 7 } }), '')
    assert.equal(readMembershipStatus(null), '')
})

// ── the ten-minute cache ───────────────────────────────────────────────────────────────

test('cacheIsFresh: ten minutes, and „never loaded" is not fresh', () => {
    const now = 1_789_732_800_000

    assert.equal(cacheIsFresh(0, now), false, 'never loaded')
    assert.equal(cacheIsFresh(now, now), true)
    assert.equal(cacheIsFresh(now - MITGLIEDSCHAFT_CACHE_MS + 1, now), true)
    assert.equal(cacheIsFresh(now - MITGLIEDSCHAFT_CACHE_MS, now), false, 'the boundary is exclusive')
    assert.equal(MITGLIEDSCHAFT_CACHE_MS, 600_000)
})

test('cacheIsFresh: a device clock that jumped BACKWARDS does not cost a signature', () => {
    // Re-reading would cost a NIP-98 signature — i.e. a prompt on an Amber session — for a
    // value that is newer than the question.
    assert.equal(cacheIsFresh(1_789_732_800_000, 1_789_732_000_000), true)
})
