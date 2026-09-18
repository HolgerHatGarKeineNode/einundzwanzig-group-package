/**
 * The Portal index of the command palette (D6) — REIN & welshman-free like
 * `paletteItems.ts`, so the filter is testable without a browser.
 *
 * Relative imports WITH the `.ts` extension: this file has to load from Vite AND from
 * `node --test`, and the node test runner does not resolve without one (same pattern as
 * `publishResult.ts`).
 *
 * ── The one decision this file implements ────────────────────────────────────────
 * The typed query NEVER leaves the device. The palette asks `/suche/portal-index` ONCE per
 * session for a compact index of the Portal's meetups, dates, courses and lecturers, and
 * every keystroke after that is filtered here, in memory. The alternative — a request per
 * keystroke — would hand this server (and one hop further the Portal) every visitor's
 * search history and would spend the Portal's 60/min per IP on a bucket the whole instance
 * shares (R9).
 *
 * ── Why this filter exists NEXT TO Flux' own ─────────────────────────────────────
 * Flux' `ui-select[filter]` does the visible text filtering of the rendered options, and
 * the other palette sections rely on exactly that. It cannot help here for one reason:
 * the index carries ~1100 rows in production (312 meetups, ~650 dates, 46 courses, 119
 * lecturers), and rendering all of them as options would be a DOM of 1100 nodes built on
 * the first keystroke. So this filter decides WHICH rows become options at all (a
 * pre-cut, capped per section) and Flux narrows the visible set as everywhere else.
 *
 * The two filters must not disagree in the one direction that hurts: a row this filter
 * DROPS can never come back. It therefore uses the house search (`search.ts`:
 * diacritic-blind, AND over all terms, ß = ss), which is strictly broader than Flux'
 * substring match — the intersection is Flux' semantics, and nothing is lost that Flux
 * would have shown.
 */

import { matchesAllTerms, parseSearchTerms } from './search.ts'

/** The four row types of the index — identical to the palette's four new sections. */
export type PortalKind = 'meetup' | 'event' | 'course' | 'lecturer'

export const PORTAL_KINDS: readonly PortalKind[] = ['meetup', 'event', 'course', 'lecturer']

/**
 * One index row. The keys are SHORT because the payload is the cost of the feature:
 * `t`ype, `r`eference (slug resp. numeric id), `n`ame, `s`ubtitle, `d`ate (`Y-m-d H:i`),
 * `a`ddress (the 31923 coordinate of a date this client may answer — P5).
 * Named once here and nowhere else.
 */
export type PortalIndexRow = {
    t: PortalKind
    r: string
    n: string
    s: string
    d: string
    /**
     * '' for every row that carries no answerable date: the three other kinds, a date
     * without a `nostr_address`, and a date whose meetup switched RSVP off or keeps its
     * attendance private (the server already applies both — `BuildsPortalIndex`).
     */
    a: string
}

/** What the endpoint answers. `status` is the catalog's, not the browser's. */
export type PortalIndex = {
    v: number
    status: 'fresh' | 'stale' | 'offline'
    rows: PortalIndexRow[]
}

export const PORTAL_INDEX_PATH = '/suche/portal-index'

/** How many rows one palette section shows. Deliberately small — this is a hit list. */
export const PORTAL_SECTION_LIMIT = 12

const EMPTY_INDEX: PortalIndex = { v: 1, status: 'offline', rows: [] }

/**
 * Is the payload shaped like an index?
 *
 * A half-understood answer is treated as NO index at all: a partly mapped row would show a
 * palette line that leads to `/bereich/meetups/undefined`. Fail closed on the shape, not on
 * the individual row.
 */
export const parsePortalIndex = (payload: unknown): PortalIndex | null => {
    if (typeof payload !== 'object' || payload === null) {
        return null
    }
    const raw = payload as { v?: unknown; status?: unknown; rows?: unknown }
    if (!Array.isArray(raw.rows)) {
        return null
    }

    const rows: PortalIndexRow[] = []
    for (const row of raw.rows) {
        if (typeof row !== 'object' || row === null) {
            continue
        }
        const r = row as Record<string, unknown>
        if (typeof r.t !== 'string' || typeof r.r !== 'string' || typeof r.n !== 'string') {
            continue
        }
        if (!PORTAL_KINDS.includes(r.t as PortalKind) || r.r === '' || r.n === '') {
            continue
        }
        rows.push({
            t: r.t as PortalKind,
            r: r.r,
            n: r.n,
            s: typeof r.s === 'string' ? r.s : '',
            d: typeof r.d === 'string' ? r.d : '',
            // Absent on most rows by design (`PortalHit::toIndexRow`), so the fallback is
            // the ordinary case here and not a defect.
            a: typeof r.a === 'string' ? r.a : '',
        })
    }

    const status = raw.status === 'stale' || raw.status === 'offline' ? raw.status : 'fresh'

    return { v: typeof raw.v === 'number' ? raw.v : 1, status, rows }
}

/**
 * Upcoming first, undated last, then by name.
 *
 * The dates are `Y-m-d H:i` strings and are compared AS STRINGS — that format sorts
 * lexicographically exactly like chronologically, and a `Date` per row per keystroke would
 * be work for nothing.
 */
const byDateThenName = (a: PortalIndexRow, b: PortalIndexRow): number => {
    if (a.d === '' && b.d === '') {
        return a.n.localeCompare(b.n)
    }
    if (a.d === '') {
        return 1
    }
    if (b.d === '') {
        return -1
    }

    return a.d.localeCompare(b.d) || a.n.localeCompare(b.n)
}

/**
 * The rows of ONE section, filtered and capped.
 *
 * An empty query returns the first rows of that kind — that is what a scope chip is for
 * (`t:` with nothing typed means „show me the next dates"). Without a scope the palette
 * does not ask for these sections at all (`visibleSections`).
 */
export const filterPortalIndex = (
    rows: readonly PortalIndexRow[],
    kind: PortalKind,
    query: string,
    limit: number = PORTAL_SECTION_LIMIT,
): PortalIndexRow[] => {
    const terms = parseSearchTerms(query)
    const hits: PortalIndexRow[] = []

    for (const row of rows) {
        if (row.t !== kind) {
            continue
        }
        if (terms.length > 0 && !matchesAllTerms([row.n, row.s], terms)) {
            continue
        }
        hits.push(row)
    }

    hits.sort(byDateThenName)

    return hits.slice(0, limit)
}

/**
 * Where a row leads.
 *
 * A DATE leads to its meetup: the read-only surfaces have no page per date (D9), so its
 * reference IS the meetup slug. The two numeric kinds lead to their detail pages.
 *
 * `encodeURIComponent` per segment, and not on the whole path: a slug comes from Portal
 * data, and a `/` in it would otherwise silently address a different route.
 */
export const portalHref = (row: PortalIndexRow): string => {
    switch (row.t) {
        case 'meetup':
        case 'event':
            return `/bereich/meetups/${encodeURIComponent(row.r)}`
        case 'course':
            return `/bereich/kurse/${encodeURIComponent(row.r)}`
        case 'lecturer':
            return `/bereich/kurse/referenten/${encodeURIComponent(row.r)}`
    }
}

/** The right-aligned hint of a row: the date if it has one, otherwise its subtitle. */
export const portalHint = (row: PortalIndexRow): string => (row.d !== '' ? row.d : row.s)

/**
 * The dates somebody can say yes to right now (P5) — the rows behind the palette action
 * „Zusagen" and behind the next-date row on Start.
 *
 * Three conditions, and the first two are the whole point:
 *  · `a !== ''` — the Portal published a 31923 for this date AND the meetup allows an
 *    answer. Applied on the SERVER (`BuildsPortalIndex`), so a row that reaches here is
 *    answerable in principle; whether the relays actually hold the event is decided by
 *    `rsvpRule.decideRsvpOffer` at the moment of the answer.
 *  · the meetup is one of `slugs` — the user's own: his pinned meetups and the meetups of
 *    the rooms he joined. Without that narrowing this would be „the next 650 dates of the
 *    whole association", which is a list nobody acts on.
 *  · the date has not started. `nowKey` is `Y-m-d H:i` and compared AS A STRING: that
 *    format sorts lexicographically exactly like chronologically, and the index already
 *    relies on it (`byDateThenName`).
 *
 * Deliberately no fallback to „all meetups" when `slugs` is empty: an empty list is the
 * honest answer for somebody who has pinned nothing and joined nothing, and the surface
 * says so. Filling it with strangers' meetups would invite a public, permanent answer to a
 * date the user has no relation to.
 */
export const answerableDates = (
    rows: readonly PortalIndexRow[],
    slugs: readonly string[],
    nowKey: string,
    limit = PORTAL_SECTION_LIMIT,
): PortalIndexRow[] => {
    if (slugs.length === 0) {
        return []
    }
    const wanted = new Set(slugs)
    const hits = rows.filter(
        (row) => row.t === 'event' && row.a !== '' && row.d >= nowKey && wanted.has(row.r),
    )
    hits.sort(byDateThenName)

    return hits.slice(0, limit)
}

/**
 * „Now" in the index' own date format (`Y-m-d H:i`), in LOCAL time.
 *
 * Local, because that is what the Portal puts into the payload — its dates are wall-clock
 * strings without a zone, and comparing them against a UTC stamp would shift every
 * boundary by the reader's offset. One hour of imprecision at the boundary is the price of
 * a string comparison over 650 rows per keystroke; a date that started 40 minutes ago is
 * still one somebody is on their way to.
 */
export const nowIndexKey = (at: Date = new Date()): string => {
    const pad = (value: number): string => String(value).padStart(2, '0')

    return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}`
}

// ── The one load per session ────────────────────────────────────────────────────

type FetchLike = (input: string, init?: { headers?: Record<string, string> }) => Promise<{
    ok: boolean
    status: number
    json(): Promise<unknown>
}>

let cached: PortalIndex | null = null
let inflight: Promise<PortalIndex> | null = null

/**
 * Load the index once.
 *
 * ── Why the ETag is not handled here ─────────────────────────────────────────────
 * The endpoint answers with a strong ETag and `max-age=300`; revalidation is the BROWSER's
 * job and it does it better than this module could (it also does it across tabs and page
 * loads). What this module adds is the „once per session" — a second `⌘K` in the same tab
 * must not even reach the network stack.
 *
 * Fail-soft: a failed load leaves the sections empty and is retried on the next open. The
 * palette keeps working without the Portal — rooms, members and actions do not depend on it.
 */
export const loadPortalIndex = (fetchImpl?: FetchLike): Promise<PortalIndex> => {
    if (cached !== null) {
        return Promise.resolve(cached)
    }
    if (inflight !== null) {
        return inflight
    }

    const doFetch: FetchLike | undefined = fetchImpl
        ?? (typeof fetch === 'function' ? (fetch as unknown as FetchLike) : undefined)
    if (!doFetch) {
        return Promise.resolve(EMPTY_INDEX)
    }

    inflight = doFetch(PORTAL_INDEX_PATH, { headers: { Accept: 'application/json' } })
        .then(async (response) => {
            if (!response.ok) {
                throw new Error(`portal index ${response.status}`)
            }
            const index = parsePortalIndex(await response.json())
            if (index === null) {
                throw new Error('portal index: unexpected shape')
            }
            cached = index

            return index
        })
        .catch(() => EMPTY_INDEX)
        .finally(() => {
            inflight = null
        })

    return inflight
}

/** Test seam: forget the session cache (`node --test` and the E2E request counter). */
export const resetPortalIndex = (): void => {
    cached = null
    inflight = null
}
