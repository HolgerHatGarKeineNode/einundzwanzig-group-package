/**
 * The NIP-52 rules of the meetup date card.
 *   node --test --experimental-strip-types packages/einundzwanzig-group/js/calendarModels.test.ts
 *
 * Pure: no browser, no relay, no signer. "Now" is injected everywhere — a test against
 * the wall clock is a documented flake source in this repository, and half of this
 * module's job is to decide which date is the NEXT one.
 *
 * The two fixtures at the top are not invented. Their TAGS are verbatim: tag for tag and
 * character for character as `nak req -a daf83d92… -k 31923 wss://nos.lol` returned them
 * on 2026-09-05. `PORTAL_EVENT` is the kind 31923 that `daf83d92…` published on
 * 2026-09-04 for the Indianapolis meetup; `FOREIGN_EVENT` is the shape a third-party
 * publisher uses on the same relay (an Austrian club's own event, carrying
 * `summary`/`end_tzid`/`r` and no `a` at all). A rule proven against a hand-rolled
 * fixture proves nothing about the wire.
 *
 * **One deliberate deviation, named because "verbatim" has to mean it:** the `content` of
 * `PORTAL_EVENT` is ABRIDGED to its first sentence. The real one is ~1 100 characters of
 * emoji-prefixed prose, and no rule in this module reads it beyond copying it into
 * `description`. The `id` and `sig` therefore do NOT hash this fixture — nothing here
 * verifies a signature, and if anything ever does, this fixture has to be completed
 * first. `FOREIGN_EVENT` carries its real content in full (it is one sentence).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
    CALENDAR_EVENT_KIND,
    CALENDAR_KIND,
    CALENDAR_RSVP_KIND,
    countRsvps,
    keepOwnAuthors,
    latestByAddress,
    makeRsvpTags,
    meetupCalendarAddress,
    ownRsvpStatus,
    pickNextCalendarEvent,
    readCalendarEvent,
    readRsvp,
    rsvpDTag,
    usableTimeZone,
    type CalendarSourceEvent,
} from './calendarModels.ts'

const PORTAL = 'daf83d92768b5d0005373f83e30d4203c0b747c170449e02fea611a0da125ee6'
const FOREIGN = '6cb4dab56ca4d76eb310a3b9f35af391d736f6b5fd349c556eb59eed619212c1'
const ME = 'a'.repeat(64)
const SOMEONE = 'b'.repeat(64)

/** Off nos.lol, 2026-09-05 (`d=meetup-event-3780`) — tags verbatim, `content` abridged. */
const PORTAL_EVENT: CalendarSourceEvent = {
    id: 'c6619354a2bc07f498040465905894ae5f9f76879d630b9a4d8af7a955b1ba18',
    pubkey: PORTAL,
    kind: 31923,
    created_at: 1788524104,
    content: 'Our next meetup will be on Wednesday, September 16.',
    tags: [
        ['d', 'meetup-event-3780'],
        ['title', 'Indy Bitcoin Meetup #60 (via portal.bitcoindiana.org)'],
        ['start', '1789599600'],
        ['D', '20712'],
        ['end', '1789606800'],
        ['start_tzid', 'Europe/Berlin'],
        ['location', 'Union Jack Pub, 921 Broad Ripple Avenue, Indianapolis, IN 46220'],
        ['g', 'dp4dz'],
        ['a', '31924:daf83d92768b5d0005373f83e30d4203c0b747c170449e02fea611a0da125ee6:meetup-359'],
    ],
}

/** Verbatim off nos.lol, 2026-09-05 — a third-party publisher, same kind, same relay. */
const FOREIGN_EVENT: CalendarSourceEvent = {
    id: '2047dd4ab318319a4ed0a9319b6e7261e3123e6048688041202e7ea204e2d54d',
    pubkey: FOREIGN,
    kind: 31923,
    created_at: 1788550738,
    content: 'Vielleicht Vortrag. Vielleicht Lightning. Sicher gute Gespräche.',
    tags: [
        ['d', '01-oktober-vl'],
        ['title', '01. Oktober Stammtisch'],
        ['start', '1790874000'],
        ['start_tzid', 'Europe/Vienna'],
        ['D', '20727'],
        ['end', '1790891940'],
        ['end_tzid', 'Europe/Vienna'],
        ['location', 'bar21'],
        ['r', 'https://www.bitcoin-club-linz.at/veranstaltungen/01-oktober-vl/'],
        ['summary', 'Vielleicht Vortrag. Vielleicht Lightning. Sicher gute Gespräche.'],
        ['t', 'einundzwanzig'],
        ['t', 'bitcoin'],
        ['t', '21linz'],
    ],
}

const dated = (over: Partial<CalendarSourceEvent> & { start?: number; end?: number; d?: string }): CalendarSourceEvent => {
    const { start, end, d, ...rest } = over
    const tags: string[][] = [['d', d ?? 'meetup-event-1'], ['title', 'A date']]
    if (start !== undefined) {
        tags.push(['start', String(start)])
    }
    if (end !== undefined) {
        tags.push(['end', String(end)])
    }

    return {
        id: 'e'.repeat(64),
        pubkey: PORTAL,
        kind: CALENDAR_EVENT_KIND,
        created_at: 1_780_000_000,
        content: '',
        tags,
        ...rest,
    }
}

const rsvp = (over: {
    id?: string
    pubkey?: string
    created_at?: number
    address?: string
    status?: string
    d?: string
}): CalendarSourceEvent => ({
    id: over.id ?? 'f'.repeat(64),
    pubkey: over.pubkey ?? ME,
    kind: CALENDAR_RSVP_KIND,
    created_at: over.created_at ?? 1_780_000_000,
    content: '',
    tags: [
        ['d', over.d ?? 'rsvp:x'],
        ...(over.address === undefined ? [['a', 'ADDR']] : over.address ? [['a', over.address]] : []),
        ...(over.status === undefined ? [['status', 'accepted']] : over.status ? [['status', over.status]] : []),
    ],
})

// ── The kind numbers, against NIP-52 ────────────────────────────────────────────────

test('the three kinds are NIP-52s, not near-misses', () => {
    assert.equal(CALENDAR_EVENT_KIND, 31923)
    assert.equal(CALENDAR_KIND, 31924)
    assert.equal(CALENDAR_RSVP_KIND, 31925)
})

// ── The join: room → calendar coordinate ────────────────────────────────────────────

test('meetupCalendarAddress builds exactly the coordinate the portal writes', () => {
    // `NostrCalendarEventFactory::coordinate(31924, pubkey, "meetup-359")` — and the
    // portal's own event says so in its `a` tag, which is asserted against right here.
    assert.equal(
        meetupCalendarAddress(PORTAL, '359'),
        '31924:daf83d92768b5d0005373f83e30d4203c0b747c170449e02fea611a0da125ee6:meetup-359',
    )
    assert.equal(meetupCalendarAddress(PORTAL, '359'), readCalendarEvent(PORTAL_EVENT).calendarAddress)
})

test('meetupCalendarAddress takes non-numeric ids — the E2E seed uses `meetup:e2e-berlin`', () => {
    assert.equal(meetupCalendarAddress(PORTAL, 'e2e-berlin'), `31924:${PORTAL}:meetup-e2e-berlin`)
})

test('meetupCalendarAddress returns "" instead of a half coordinate', () => {
    // A `{"#a":[""]}` is a query for everything untagged, not a query for nothing — the
    // empty string has to be recognisable by the caller.
    assert.equal(meetupCalendarAddress('', '359'), '')
    assert.equal(meetupCalendarAddress(PORTAL, ''), '')
    assert.equal(meetupCalendarAddress('   ', '  '), '')
})

// ── Reading a date ──────────────────────────────────────────────────────────────────

test('readCalendarEvent lifts the portal event field for field', () => {
    assert.deepEqual(readCalendarEvent(PORTAL_EVENT), {
        dTag: 'meetup-event-3780',
        title: 'Indy Bitcoin Meetup #60 (via portal.bitcoindiana.org)',
        start: 1789599600,
        end: 1789606800,
        startTzid: 'Europe/Berlin',
        location: 'Union Jack Pub, 921 Broad Ripple Avenue, Indianapolis, IN 46220',
        description: 'Our next meetup will be on Wednesday, September 16.',
        calendarAddress: '31924:daf83d92768b5d0005373f83e30d4203c0b747c170449e02fea611a0da125ee6:meetup-359',
    })
})

test('readCalendarEvent survives a foreign shape: no `a`, extra tags it does not know', () => {
    const read = readCalendarEvent(FOREIGN_EVENT)
    assert.equal(read.calendarAddress, '', 'a third-party event carries no calendar coordinate')
    assert.equal(read.title, '01. Oktober Stammtisch')
    assert.equal(read.start, 1790874000)
})

test('readCalendarEvent tolerates an event with no tags at all', () => {
    assert.deepEqual(readCalendarEvent({ ...PORTAL_EVENT, tags: [], content: '' }), {
        dTag: '',
        title: '',
        start: 0,
        end: 0,
        startTzid: '',
        location: '',
        description: '',
        calendarAddress: '',
    })
})

test('a non-numeric `start` becomes 0, never 1970', () => {
    // `Number('')` is 0 and `Number(' 12 ')` is 12. A date rendered as 1 Jan 1970 reads
    // exactly like a correct one, which is why the digit check exists.
    assert.equal(readCalendarEvent(dated({ tags: [['d', 'x'], ['start', 'soon']] } as never)).start, 0)
    assert.equal(readCalendarEvent(dated({ tags: [['d', 'x'], ['start', ' 12 ']] } as never)).start, 0)
    assert.equal(readCalendarEvent(dated({ tags: [['d', 'x'], ['start', '-5']] } as never)).start, 0)
})

// ── Replaceability ──────────────────────────────────────────────────────────────────

test('latestByAddress keeps the newest version per (kind, pubkey, d)', () => {
    const old = dated({ id: '1'.repeat(64), created_at: 100, start: 1000, d: 'meetup-event-3780' })
    const fresh = dated({ id: '2'.repeat(64), created_at: 200, start: 2000, d: 'meetup-event-3780' })
    const other = dated({ id: '3'.repeat(64), created_at: 150, start: 3000, d: 'meetup-event-9' })
    const kept = latestByAddress([old, fresh, other])
    assert.equal(kept.length, 2)
    assert.ok(kept.includes(fresh) && kept.includes(other))
    assert.ok(!kept.includes(old))
})

test('latestByAddress breaks a same-second tie by event id, not by array order', () => {
    // Second granularity makes the tie an ordinary case: a five-minute cron republishing
    // inside one second produces it. Two clients folding the same set must agree.
    const a = dated({ id: '1'.repeat(64), created_at: 100, d: 'same' })
    const b = dated({ id: '9'.repeat(64), created_at: 100, d: 'same' })
    assert.deepEqual(latestByAddress([a, b]), [a])
    assert.deepEqual(latestByAddress([b, a]), [a])
})

test('latestByAddress does not merge two authors under one d-tag', () => {
    const mine = dated({ id: '1'.repeat(64), pubkey: PORTAL, created_at: 100, d: 'same' })
    const theirs = dated({ id: '2'.repeat(64), pubkey: FOREIGN, created_at: 50, d: 'same' })
    assert.equal(latestByAddress([mine, theirs]).length, 2)
})

// ── Picking the next date ───────────────────────────────────────────────────────────

test('pickNextCalendarEvent takes the soonest date that is not over', () => {
    const soon = dated({ id: '1'.repeat(64), start: 2000, d: 'a' })
    const later = dated({ id: '2'.repeat(64), start: 5000, d: 'b' })
    assert.equal(pickNextCalendarEvent([later, soon], 1000), soon)
})

test('a date already past is skipped, and the one after it wins', () => {
    const past = dated({ id: '1'.repeat(64), start: 500, d: 'a' })
    const next = dated({ id: '2'.repeat(64), start: 5000, d: 'b' })
    assert.equal(pickNextCalendarEvent([past, next], 1000), next)
})

test('a meetup that STARTED but has not ended stays the next date', () => {
    // The one a visitor wants on the header is the evening currently running, not the
    // one four weeks out.
    const running = dated({ id: '1'.repeat(64), start: 900, end: 2000, d: 'a' })
    const future = dated({ id: '2'.repeat(64), start: 9000, d: 'b' })
    assert.equal(pickNextCalendarEvent([running, future], 1000), running)
})

test('without an `end`, `start` decides whether the date is over', () => {
    const noEnd = dated({ id: '1'.repeat(64), start: 900, d: 'a' })
    assert.equal(pickNextCalendarEvent([noEnd], 1000), null)
    assert.equal(pickNextCalendarEvent([noEnd], 800), noEnd)
})

test('an event without a usable start never wins — not even against nothing', () => {
    // Otherwise a broken `start` would render as 1 Jan 1970 and, at timestamp 0, could
    // even beat every real date in the sort.
    assert.equal(pickNextCalendarEvent([dated({ d: 'a' })], 1000), null)
})

test('pickNextCalendarEvent judges a moved date by its CURRENT version', () => {
    // The old version is still in the repository (IndexedDB cache next to a fresh load).
    // Judged by the old start the meetup is over; by the new one it is next week.
    const oldVersion = dated({ id: '1'.repeat(64), created_at: 100, start: 500, d: 'meetup-event-3780' })
    const moved = dated({ id: '2'.repeat(64), created_at: 200, start: 9000, d: 'meetup-event-3780' })
    assert.equal(pickNextCalendarEvent([oldVersion, moved], 1000), moved)
})

test('empty in, null out', () => {
    assert.equal(pickNextCalendarEvent([], 1000), null)
})

// ── RSVPs ───────────────────────────────────────────────────────────────────────────

test('readRsvp drops a status outside NIP-52s three values', () => {
    assert.equal(readRsvp(rsvp({ status: 'maybe-ish' })).status, '')
    assert.equal(readRsvp(rsvp({ status: 'Accepted' })).status, '', 'the values are lowercase')
    assert.equal(readRsvp(rsvp({ status: '' })).status, '')
    for (const status of ['accepted', 'declined', 'tentative']) {
        assert.equal(readRsvp(rsvp({ status })).status, status)
    }
})

test('countRsvps counts one vote per pubkey, the newest', () => {
    const tally = countRsvps(
        [
            rsvp({ id: '1'.repeat(64), pubkey: ME, created_at: 100, status: 'declined' }),
            rsvp({ id: '2'.repeat(64), pubkey: ME, created_at: 200, status: 'accepted', d: 'rsvp:other' }),
            rsvp({ id: '3'.repeat(64), pubkey: SOMEONE, created_at: 150, status: 'accepted' }),
        ],
        'ADDR',
    )
    assert.deepEqual(tally, { accepted: 2, declined: 0, tentative: 0 })
})

test('… and that fold is what stops a foreign client from voting eleven times', () => {
    // A client that draws a fresh UUID per change leaves its old answers standing as
    // separate addressable events. Counting them separately is how four guests report
    // as five.
    const many = [1, 2, 3, 4, 5].map((n) =>
        rsvp({ id: String(n).repeat(64), pubkey: SOMEONE, created_at: 100 + n, status: 'accepted', d: `rsvp:${n}` }),
    )
    assert.deepEqual(countRsvps(many, 'ADDR'), { accepted: 1, declined: 0, tentative: 0 })
})

test('an RSVP for another event does not count here', () => {
    const tally = countRsvps([rsvp({ address: 'OTHER', status: 'accepted' })], 'ADDR')
    assert.deepEqual(tally, { accepted: 0, declined: 0, tentative: 0 })
})

test('an RSVP with an unusable status counts as neither yes nor no', () => {
    assert.deepEqual(countRsvps([rsvp({ status: 'nope' })], 'ADDR'), { accepted: 0, declined: 0, tentative: 0 })
})

test('countRsvps with an empty address counts nothing — it does not match untagged RSVPs', () => {
    assert.deepEqual(countRsvps([rsvp({ address: '' })], ''), { accepted: 0, declined: 0, tentative: 0 })
})

test('ownRsvpStatus reports my newest answer and nobody elses', () => {
    const events = [
        rsvp({ id: '1'.repeat(64), pubkey: ME, created_at: 100, status: 'tentative' }),
        rsvp({ id: '2'.repeat(64), pubkey: ME, created_at: 200, status: 'declined', d: 'rsvp:later' }),
        rsvp({ id: '3'.repeat(64), pubkey: SOMEONE, created_at: 300, status: 'accepted' }),
    ]
    assert.equal(ownRsvpStatus(events, 'ADDR', ME), 'declined')
    assert.equal(ownRsvpStatus(events, 'ADDR', SOMEONE), 'accepted')
    assert.equal(ownRsvpStatus(events, 'ADDR', 'c'.repeat(64)), '')
    assert.equal(ownRsvpStatus(events, 'ADDR', null), '', 'logged out: no answer, not a crash')
})

// ── Building our own RSVP ───────────────────────────────────────────────────────────

test('makeRsvpTags carries NIP-52s required trio plus the two that make it traceable', () => {
    const tags = makeRsvpTags(PORTAL_EVENT, 'accepted')
    const address = `31923:${PORTAL}:meetup-event-3780`
    assert.deepEqual(tags, [
        ['d', `rsvp:${address}`],
        ['a', address],
        ['e', PORTAL_EVENT.id],
        ['p', PORTAL],
        ['status', 'accepted'],
    ])
})

test('the `a` of our RSVP points at the DATE (31923), not at the calendar (31924)', () => {
    // Easy to get backwards: the room is joined through the 31924 coordinate, but an
    // RSVP answers one date. Pointing at the calendar would make every date of a meetup
    // share one attendance count.
    const address = makeRsvpTags(PORTAL_EVENT, 'accepted').find((t) => t[0] === 'a')?.[1]
    assert.ok(address?.startsWith('31923:'))
    assert.notEqual(address, readCalendarEvent(PORTAL_EVENT).calendarAddress)
})

test('the RSVP `d` is derived, so changing the answer REPLACES it', () => {
    const yes = makeRsvpTags(PORTAL_EVENT, 'accepted')
    const no = makeRsvpTags(PORTAL_EVENT, 'declined')
    assert.equal(yes[0][1], no[0][1], 'same d → same address → the relay keeps one')
    assert.notEqual(yes[4][1], no[4][1])
})

test('rsvpDTag separates two dates of the same meetup', () => {
    assert.notEqual(rsvpDTag('31923:x:meetup-event-1'), rsvpDTag('31923:x:meetup-event-2'))
})

test('no `fb` tag is invented', () => {
    // NIP-52 makes it optional and forbids it on `declined`. This surface has no
    // free/busy notion to fill it from, and a stock `free` would be a claim about the
    // user's calendar that the user never made.
    assert.equal(makeRsvpTags(PORTAL_EVENT, 'accepted').some((t) => t[0] === 'fb'), false)
    assert.equal(makeRsvpTags(PORTAL_EVENT, 'declined').some((t) => t[0] === 'fb'), false)
})

// ── The time zone of a place-bound event ────────────────────────────────────────────

test('usableTimeZone passes a zone this runtime can format in', () => {
    assert.equal(usableTimeZone('Europe/Vienna'), 'Europe/Vienna')
    assert.equal(usableTimeZone('America/Indiana/Indianapolis'), 'America/Indiana/Indianapolis')
    assert.equal(usableTimeZone('  Europe/Berlin  '), 'Europe/Berlin', 'trimmed, because a tag is free text')
})

test('usableTimeZone returns "" instead of letting the formatter throw', () => {
    // `new Intl.DateTimeFormat(l, {timeZone: 'Erde/Mitte'})` THROWS, and `formatTimestamp`
    // catches every construction error and falls back to the reader's LOCAL time without
    // saying so. For a place-bound event that silent fallback is the whole defect: it
    // looks exactly like a correct rendering.
    assert.equal(usableTimeZone('Erde/Mitte'), '')
    assert.equal(usableTimeZone('MESZ'), '')
    assert.equal(usableTimeZone(''), '')
    assert.equal(usableTimeZone('   '), '')
})

test('the portal event carries a zone, and this is the one it carries', () => {
    // Reported upstream rather than worked around: the tag says `Europe/Berlin` on an
    // INDIANAPOLIS meetup. The `start` timestamp is right (1789599600 = 19:00 EDT), the
    // zone name is not — the portal derives it from the country code
    // (`NostrCalendarEventFactory` -> `CountryTimezone::forCountryCode`). The card can
    // only render the zone it is given; naming it is what makes the error visible instead
    // of hiding it behind the reader's own clock.
    assert.equal(readCalendarEvent(PORTAL_EVENT).startTzid, 'Europe/Berlin')
    assert.equal(usableTimeZone(readCalendarEvent(PORTAL_EVENT).startTzid), 'Europe/Berlin')
})

// ── The reading half of the author filter ───────────────────────────────────────────

test('keepOwnAuthors drops everything that is not ours', () => {
    // The second application of the filter. The first is the `authors` key of the REQ; a
    // relay may answer with whatever it likes, and the repository is shared with every
    // other surface of this client.
    assert.deepEqual(keepOwnAuthors([PORTAL_EVENT, FOREIGN_EVENT], [PORTAL]), [PORTAL_EVENT])
    assert.deepEqual(keepOwnAuthors([PORTAL_EVENT, FOREIGN_EVENT], [FOREIGN]), [FOREIGN_EVENT])
    assert.deepEqual(keepOwnAuthors([PORTAL_EVENT, FOREIGN_EVENT], [PORTAL, FOREIGN]).length, 2)
})

test('keepOwnAuthors with NO authors keeps nothing — it does not fall open', () => {
    // The dangerous shape would be "no authors configured, so let everything through".
    // That is the one behaviour that must not exist on this path.
    assert.deepEqual(keepOwnAuthors([PORTAL_EVENT, FOREIGN_EVENT], []), [])
})
