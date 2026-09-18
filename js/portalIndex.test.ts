/**
 * Pure tests for the palette's Portal index (D6, P4) — welshman-free, no DOM.
 *   node --experimental-strip-types --test packages/einundzwanzig-group/js/portalIndex.test.ts
 *
 * What is measured is above all what a broken version would get wrong SILENTLY: a
 * half-understood index, a row pointing at `/bereich/meetups/undefined`, and a second
 * network request nobody sees.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
    PORTAL_SECTION_LIMIT,
    filterPortalIndex,
    loadPortalIndex,
    parsePortalIndex,
    portalHint,
    portalHref,
    answerableDates,
    nowIndexKey,
    resetPortalIndex,
    type PortalIndexRow,
} from './portalIndex.ts'

const row = (over: Partial<PortalIndexRow> & { t: PortalIndexRow['t']; r: string; n: string }): PortalIndexRow => ({
    s: '',
    d: '',
    a: '',
    ...over,
})

const index: PortalIndexRow[] = [
    row({ t: 'meetup', r: 'einundzwanzig-kempten', n: 'Einundzwanzig Kempten', s: 'Kempten · DE', d: '2026-10-02 19:00' }),
    row({ t: 'meetup', r: 'bitcoin-muenchen', n: 'Bitcoin München', s: 'München · DE' }),
    row({ t: 'meetup', r: 'graz', n: 'Einundzwanzig Graz', s: 'Graz · AT', d: '2026-09-30 18:00' }),
    row({ t: 'event', r: 'einundzwanzig-kempten', n: 'Einundzwanzig Kempten', s: 'Gasthof Post', d: '2026-10-02 19:00' }),
    row({ t: 'course', r: '44', n: 'Basiskurs Tag 1', s: 'Johannes', d: '2026-11-25 17:30' }),
    row({ t: 'lecturer', r: '144', n: 'Johannes', s: '21neumarkt.de', d: '2026-11-25 17:30' }),
]

// ── parsePortalIndex: fail closed on the SHAPE ─────────────────────────────

test('parsePortalIndex: an unusable answer is no index at all', () => {
    assert.equal(parsePortalIndex(null), null)
    assert.equal(parsePortalIndex('nope'), null)
    assert.equal(parsePortalIndex({ v: 1 }), null)
})

test('parsePortalIndex: half rows are dropped instead of showing a broken row', () => {
    // A row without `r` would lead to `/bereich/meetups/undefined` in the palette — a click
    // that finds nothing and looks like a failure of the SEARCH.
    const parsed = parsePortalIndex({
        v: 1,
        status: 'fresh',
        rows: [
            { t: 'meetup', r: 'graz', n: 'Graz' },
            { t: 'meetup', n: 'ohne ref' },
            { t: 'quatsch', r: 'x', n: 'falscher Typ' },
            { t: 'course', r: '1', n: '' },
            'nicht mal ein Objekt',
        ],
    })

    assert.equal(parsed?.rows.length, 1)
    assert.equal(parsed?.rows[0].r, 'graz')
    // Missing optional fields become '' and not `undefined`: otherwise the row renders
    // "undefined" as its hint.
    assert.equal(parsed?.rows[0].s, '')
    assert.equal(parsed?.rows[0].d, '')
})

test('parsePortalIndex: an unknown status counts as fresh, not as an error', () => {
    assert.equal(parsePortalIndex({ rows: [], status: 'weiss-nicht' })?.status, 'fresh')
    assert.equal(parsePortalIndex({ rows: [], status: 'stale' })?.status, 'stale')
    assert.equal(parsePortalIndex({ rows: [], status: 'offline' })?.status, 'offline')
})

// ── filterPortalIndex: the selection Flux cannot make ──────────────────────

test('filterPortalIndex: its own section only, upcoming dates first', () => {
    const meetups = filterPortalIndex(index, 'meetup', '')

    assert.deepEqual(meetups.map((r) => r.r), ['graz', 'einundzwanzig-kempten', 'bitcoin-muenchen'])
    // A meetup WITHOUT a date goes last — not alphabetically in between. Whoever opens the
    // palette is usually looking for the next one.
    assert.equal(meetups[2].d, '')
})

test('filterPortalIndex: the house search rules — AND over all terms, blind to diacritics', () => {
    // Flux' substring match can do neither, and that is why this filter exists at all
    // (rather than a bare cap).
    //
    // "munchen" finds "München": the folding drops diacritics (NFD, accents removed). It
    // does NOT transliterate — so "muenchen" does NOT find it, and that is the house rule
    // (`search.ts`), not a gap of this file. Measured here so the expectation lives in one
    // place instead of four heads.
    assert.deepEqual(filterPortalIndex(index, 'meetup', 'munchen').map((r) => r.r), ['bitcoin-muenchen'])
    assert.deepEqual(filterPortalIndex(index, 'meetup', 'muenchen'), [])
    assert.deepEqual(filterPortalIndex(index, 'meetup', 'bitcoin münchen').map((r) => r.r), ['bitcoin-muenchen'])
    // A second term has to occur as well (AND) — "bitcoin graz" is no hit, even though each
    // word alone would match a row.
    assert.deepEqual(filterPortalIndex(index, 'meetup', 'bitcoin graz'), [])
})

test('filterPortalIndex: the subtitle counts — the city is the reason people type', () => {
    assert.deepEqual(filterPortalIndex(index, 'meetup', 'kempten').map((r) => r.r), ['einundzwanzig-kempten'])
    assert.deepEqual(filterPortalIndex(index, 'event', 'gasthof').map((r) => r.r), ['einundzwanzig-kempten'])
})

test('filterPortalIndex: capped — otherwise 312 options would stand in the DOM', () => {
    const viele = Array.from({ length: 40 }, (_, i) => row({ t: 'meetup', r: `m${i}`, n: `Meetup ${i}` }))

    assert.equal(filterPortalIndex(viele, 'meetup', '').length, PORTAL_SECTION_LIMIT)
    assert.equal(filterPortalIndex(viele, 'meetup', '', 3).length, 3)
})

// ── Targets ─────────────────────────────────────────────────────────────────

test('portalHref: a DATE leads to its meetup — there is no page per date', () => {
    assert.equal(portalHref(index[0]), '/bereich/meetups/einundzwanzig-kempten')
    assert.equal(portalHref(index[3]), '/bereich/meetups/einundzwanzig-kempten')
    assert.equal(portalHref(index[4]), '/bereich/kurse/44')
    assert.equal(portalHref(index[5]), '/bereich/kurse/referenten/144')
})

test('portalHref: the slug is encoded — it comes from foreign Portal data', () => {
    // A `/` in the slug would silently address a different route.
    assert.equal(
        portalHref(row({ t: 'meetup', r: 'a/b?c=1', n: 'x' })),
        '/bereich/meetups/a%2Fb%3Fc%3D1',
    )
})

test('portalHint: the date when there is one — otherwise the subtitle', () => {
    assert.equal(portalHint(index[0]), '2026-10-02 19:00')
    assert.equal(portalHint(index[1]), 'München · DE')
})

// ── The ONE request per session ────────────────────────────────────────────

test('loadPortalIndex: ONE request, no matter how often the palette opens', async () => {
    resetPortalIndex()
    let calls = 0
    const fetchImpl = async (): Promise<{ ok: boolean; status: number; json(): Promise<unknown> }> => {
        calls += 1

        return { ok: true, status: 200, json: async () => ({ v: 1, status: 'fresh', rows: [{ t: 'meetup', r: 'graz', n: 'Graz' }] }) }
    }

    const erste = await loadPortalIndex(fetchImpl)
    const zweite = await loadPortalIndex(fetchImpl)

    assert.equal(calls, 1)
    assert.equal(erste.rows.length, 1)
    assert.equal(zweite.rows.length, 1)
})

test('loadPortalIndex: two simultaneous opens share one request', async () => {
    resetPortalIndex()
    let calls = 0
    const fetchImpl = async () => {
        calls += 1
        await new Promise((resolve) => setTimeout(resolve, 5))

        return { ok: true, status: 200, json: async () => ({ v: 1, status: 'fresh', rows: [] }) }
    }

    await Promise.all([loadPortalIndex(fetchImpl), loadPortalIndex(fetchImpl)])

    assert.equal(calls, 1)
})

test('loadPortalIndex: a failure is empty and is retried on the next open', async () => {
    // Fail-soft: without the Portal the palette stays fully usable with rooms, members and
    // actions — and a failed request must not stick for the whole session.
    resetPortalIndex()
    let calls = 0
    const fetchImpl = async () => {
        calls += 1

        return calls === 1
            ? { ok: false, status: 503, json: async () => ({}) }
            : { ok: true, status: 200, json: async () => ({ v: 1, status: 'stale', rows: [{ t: 'course', r: '1', n: 'Kurs' }] }) }
    }

    const leer = await loadPortalIndex(fetchImpl)
    assert.deepEqual(leer.rows, [])
    assert.equal(leer.status, 'offline')

    const danach = await loadPortalIndex(fetchImpl)
    assert.equal(calls, 2)
    assert.equal(danach.rows.length, 1)
    // The status comes from the CATALOG, not from the browser: "stale" means the Portal did
    // not answer and the server is showing its last copy.
    assert.equal(danach.status, 'stale')
})

// ── answerableDates: the rows behind „Zusagen" (P5) ────────────────────────

const PORTAL_PUB = 'daf83d92768b5d0005373f83e30d4203c0b747c170449e02fea611a0da125ee6'
const coord = (id: number): string => `31923:${PORTAL_PUB}:meetup-event-${id}`

const termine: PortalIndexRow[] = [
    row({ t: 'event', r: 'graz', n: 'Einundzwanzig Graz', d: '2026-09-30 18:00', a: coord(1) }),
    row({ t: 'event', r: 'einundzwanzig-kempten', n: 'Kempten', d: '2026-09-20 19:00', a: coord(2) }),
    // Same meetup, a second date further out — both are answerable, the nearer one first.
    row({ t: 'event', r: 'einundzwanzig-kempten', n: 'Kempten', d: '2026-10-18 19:00', a: coord(3) }),
    // No coordinate: the Portal published nothing for it, or the meetup switched RSVP off /
    // keeps its attendance private (the server applies both — `BuildsPortalIndex`).
    row({ t: 'event', r: 'graz', n: 'Einundzwanzig Graz', d: '2026-09-21 18:00' }),
    // A date that has already started.
    row({ t: 'event', r: 'graz', n: 'Einundzwanzig Graz', d: '2026-09-18 10:00', a: coord(4) }),
    // Not a date at all.
    row({ t: 'meetup', r: 'graz', n: 'Einundzwanzig Graz', d: '2026-09-30 18:00', a: coord(5) }),
]

test('answerableDates: only own meetups, only published dates, only the future', () => {
    const hits = answerableDates(termine, ['graz', 'einundzwanzig-kempten'], '2026-09-18 12:00')

    assert.deepEqual(hits.map((hit) => hit.a), [coord(2), coord(1), coord(3)])
})

test('answerableDates: a meetup that is neither pinned nor joined is not offered', () => {
    const hits = answerableDates(termine, ['einundzwanzig-kempten'], '2026-09-18 12:00')

    assert.deepEqual(hits.map((hit) => hit.a), [coord(2), coord(3)])
})

test('answerableDates: nothing pinned, nothing joined — an empty list, not the whole association', () => {
    // The honest answer. Offering strangers' meetups here would invite a public, permanent
    // answer to a date the user has no relation to.
    assert.deepEqual(answerableDates(termine, [], '2026-09-18 12:00'), [])
})

test('answerableDates: the cap holds', () => {
    const viele = Array.from({ length: 40 }, (_, i) =>
        row({ t: 'event', r: 'graz', n: 'Graz', d: `2026-10-${String((i % 28) + 1).padStart(2, '0')} 18:00`, a: coord(i) }))

    assert.equal(answerableDates(viele, ['graz'], '2026-09-18 12:00').length, PORTAL_SECTION_LIMIT)
    assert.equal(answerableDates(viele, ['graz'], '2026-09-18 12:00', 3).length, 3)
})

test('nowIndexKey: the index\'s own format, in local time', () => {
    // Local and not UTC: the Portal's dates are wall-clock strings without a zone, and a
    // UTC stamp would shift every boundary by the reader's offset.
    const at = new Date(2026, 8, 18, 9, 5)

    assert.equal(nowIndexKey(at), '2026-09-18 09:05')
    assert.match(nowIndexKey(), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)
})

test('parsePortalIndex: the coordinate survives, and a non-string one does not', () => {
    const parsed = parsePortalIndex({
        v: 1,
        status: 'fresh',
        rows: [
            { t: 'event', r: 'graz', n: 'Graz', d: '2026-09-30 18:00', a: coord(7) },
            { t: 'event', r: 'wien', n: 'Wien', d: '2026-09-30 18:00', a: 31923 },
            { t: 'meetup', r: 'linz', n: 'Linz' },
        ],
    })

    assert.equal(parsed?.rows[0].a, coord(7))
    assert.equal(parsed?.rows[1].a, '', 'a number is not a coordinate — and must not become a filter')
    assert.equal(parsed?.rows[2].a, '', 'the key is absent on most rows by design')
})
