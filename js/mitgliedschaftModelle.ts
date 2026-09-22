/**
 * „Ich › Verein" (D11, P5) — the PURE half: reading the two payloads, deciding the shown
 * status, and the ten-minute cache. welshman-free and DOM-free, so every row below is
 * provable under `node --test` (same split as `calendarModels.ts`/`calendar.ts`).
 *
 * NO extension-less relative imports — the node test runner would stop resolving them.
 *
 * ── Why the STATUS is decided here and not read off one field ────────────────────────
 *
 * The association reports two status fields side by side and they mean different things
 * (`MembershipResource`, read in the Verein repository 2026-09-18):
 * `association_status` is the category the board assigned, `membership_status` is whether
 * the person is a member right now. They differ exactly when a fee year goes unpaid — so a
 * surface that read only the first would call a lapsed member active, which is the one
 * wrong answer this page must not give. The decision therefore has a name, a table and a
 * test, instead of living inside a Blade `@if`.
 */
import { readMe, type MeData } from './vereinFlow.ts'

/** One recorded annual fee, as `GET /payments` delivers it. */
export type PaymentRow = {
    /** The fee year — the identifier the association addresses a payment by. */
    year: number
    /** The amount in the association's own currency unit (integer, as sent). */
    amount: number
    currency: string
    paid: boolean
    /** The receipt, present only once the fee is settled. */
    receiptUrl: string | null
}

/**
 * `GET /api/v1/membership/payments` → rows, newest year first.
 *
 * Fail-soft per ROW and not per response: a payload the association extends with a field
 * this client does not know must not cost the whole list, while a row without a usable year
 * has nothing to show and is dropped — the year is what the surface prints and what a
 * receipt is addressed by.
 *
 * `{data: […]}` and a bare array are both accepted: the association wraps its collections
 * in `data`, and a proxy that unwrapped one would otherwise silently return nothing.
 */
export const readPayments = (body: unknown): PaymentRow[] => {
    const root = (body ?? {}) as { data?: unknown }
    const list = Array.isArray(root.data) ? root.data : Array.isArray(body) ? body : []
    const rows: PaymentRow[] = []

    for (const raw of list) {
        if (typeof raw !== 'object' || raw === null) {
            continue
        }
        const row = raw as Record<string, unknown>
        const year = typeof row.year === 'number' ? row.year : Number(row.year)
        if (!Number.isInteger(year) || year < 2000 || year > 2200) {
            continue
        }
        const receipt = row.receipt_url ?? row.receiptUrl

        rows.push({
            year,
            amount: typeof row.amount === 'number' ? row.amount : Number(row.amount) || 0,
            currency: typeof row.currency === 'string' ? row.currency : '',
            // `paid` only on an EXPLICIT true: a missing field is „not known", and reading it
            // as „paid" would tell somebody their fee is settled when nothing says so.
            paid: row.paid === true,
            receiptUrl: typeof receipt === 'string' && receipt.trim() !== '' ? receipt.trim() : null,
        })
    }

    rows.sort((a, b) => b.year - a.year)

    return rows
}

/**
 * The five states this page can be in, and the surface says which one it is.
 *
 * | condition                                         | state             |
 * |---------------------------------------------------|-------------------|
 * | `membership_status` = `active`                     | `mitglied`        |
 * | a record exists, the current year is PAID, but     | `freischaltung-   |
 * |   `membership_status` is not `active` (yet)        |   offen`          |
 * | a record exists, the current year is not paid      | `zahlung-offen`   |
 * | no record at all (404 / empty)                     | `kein-antrag`     |
 * | the association was not reachable                  | `unbekannt`       |
 *
 * `zahlung-offen` covers the two cases that look alike from here and lead to the same place
 * (the join flow's payment step): somebody who applied and has not paid, and a member whose
 * new fee year is open. Distinguishing them would need a fourth button and says nothing the
 * reader has to act on differently.
 *
 * `freischaltung-offen` is the fee paid for the association's `current_year` while
 * `membership_status` still says otherwise — the association reconciles payments at night
 * (see `verein.ts`, „wartet auf den nächtlichen Abgleich"). Mapping that to `zahlung-offen`
 * put „your fee is still open" and a pay button next to „Fee year 2026 · paid" (device
 * sighting v1.13.0).
 */
export type MitgliedschaftZustand = 'mitglied' | 'freischaltung-offen' | 'zahlung-offen' | 'kein-antrag' | 'unbekannt'

export const mitgliedschaftZustand = (input: {
    /** Did the read succeed at all? False = the association was not reachable. */
    gelesen: boolean
    /** Did it answer „no record" (404 or an empty body)? */
    ohneAkte: boolean
    me: MeData | null
    /** `membership_status` verbatim, '' when absent. */
    membershipStatus: string
}): MitgliedschaftZustand => {
    if (!input.gelesen) {
        return 'unbekannt'
    }
    if (input.ohneAkte || input.me === null) {
        return 'kein-antrag'
    }
    if (input.membershipStatus === 'active') {
        return 'mitglied'
    }
    if (input.me.paid) {
        return 'freischaltung-offen'
    }

    return 'zahlung-offen'
}

/** `membership_status` out of the same payload `readMe` reads — '' when absent. */
export const readMembershipStatus = (body: unknown): string => {
    const root = (body ?? {}) as { data?: unknown }
    const data = ((root.data ?? root) ?? {}) as Record<string, unknown>

    return typeof data.membership_status === 'string' ? data.membership_status : ''
}

/** Both halves of one `/me` read, so a caller cannot take one and forget the other. */
export const readMembership = (body: unknown): { me: MeData; membershipStatus: string } => ({
    me: readMe(body),
    membershipStatus: readMembershipStatus(body),
})

// ── The ten-minute cache ───────────────────────────────────────────────────────────────

/**
 * How long a read stays good (D11: „one signature per opening, cached in memory for 10
 * minutes").
 *
 * The number is not a guess about how fast the association changes — it is the cost of the
 * READ: every call needs a fresh NIP-98 signature, and on a bunker/Amber session a signature
 * is a prompt the user has to answer. Ten minutes means somebody who leaves the page and
 * comes back does not get a second prompt, while a payment made in another window still
 * shows up within the quarter hour.
 */
export const MITGLIEDSCHAFT_CACHE_MS = 10 * 60 * 1000

/**
 * Is a value loaded at `loadedAt` still good at `now`?
 *
 * `loadedAt = 0` means „never loaded" and is not fresh. A `now` BEFORE `loadedAt` (the
 * device clock moved backwards) counts as fresh rather than as expired: re-reading would
 * cost a signature for a value that is newer than the question.
 */
export const cacheIsFresh = (loadedAt: number, now: number, ttl = MITGLIEDSCHAFT_CACHE_MS): boolean =>
    loadedAt > 0 && now - loadedAt < ttl
