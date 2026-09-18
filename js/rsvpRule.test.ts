/**
 * The RSVP rule (D12/D12a, P5) — one case per row of the table in `rsvpRule.ts`.
 *   node --test --experimental-strip-types packages/einundzwanzig-group/js/rsvpRule.test.ts
 *
 * „Now" is injected everywhere. Half of this module's job is to decide whether a date is
 * still to come, and a test against the wall clock would be the documented flake of this
 * repository: a fixture „61 s ahead" becomes „60 s ahead" while the second ticks.
 *
 * The base fixture is the kind 31923 the Portal published on 2026-09-04 for the
 * Indianapolis meetup, read off nos.lol on 2026-09-05 — tags verbatim, `content` abridged
 * (nothing here hashes it). The cancellation tags are the ones
 * `NostrCalendarEventFactory::cancellationTags()` emits, read in the Portal repository on
 * 2026-09-18.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
    addressOf,
    CANCELLED_STATUS,
    decideRsvpOffer,
    disclosureAckValue,
    disclosureIsAcknowledged,
    isCancelledCalendarEvent,
    isUpcomingCalendarEvent,
    parseCalendarAddress,
    RSVP_DISCLOSURE_VERSION,
    rsvpTargetFor,
} from './rsvpRule.ts'
import type { CalendarSourceEvent } from './calendarModels.ts'

const PORTAL = 'daf83d92768b5d0005373f83e30d4203c0b747c170449e02fea611a0da125ee6'
const FOREIGN = '6cb4dab56ca4d76eb310a3b9f35af391d736f6b5fd349c556eb59eed619212c1'

/** A fixed „now" — 2026-09-18 12:00:00 UTC. */
const NOW = 1789732800
const START = NOW + 4 * 86400

const datum = (over: Partial<CalendarSourceEvent> & { tags?: string[][] } = {}): CalendarSourceEvent => ({
    id: 'c6619354a2bc07f498040465905894ae5f9f76879d630b9a4d8af7a955b1ba18',
    pubkey: PORTAL,
    kind: 31923,
    created_at: NOW - 3600,
    content: 'Our next meetup will be on Wednesday, September 16.',
    tags: [
        ['d', 'meetup-event-3780'],
        ['title', 'Indy Bitcoin Meetup #60 (via portal.bitcoindiana.org)'],
        ['start', String(START)],
        ['D', String(Math.floor(START / 86400))],
        ['start_tzid', 'America/Indiana/Indianapolis'],
        ['location', 'Bier Brewery, Indianapolis'],
        ['a', `31924:${PORTAL}:meetup-366`],
    ],
    ...over,
})

const ADDRESS = `31923:${PORTAL}:meetup-event-3780`

/** The happy path, with every knob at the value the Portal delivers for a normal date. */
const eingabe = (over: Partial<Parameters<typeof decideRsvpOffer>[0]> = {}) => ({
    nostrAddress: ADDRESS,
    attendeesPublic: true,
    rsvpEnabled: true,
    configured: true,
    events: [datum()],
    authors: [PORTAL],
    nowSeconds: NOW,
    ...over,
})

test('a published, future, non-cancelled date of a configured author is answerable', () => {
    const decision = decideRsvpOffer(eingabe())

    assert.equal(decision.mode, 'nostr')
    assert.equal(decision.grund, 'offen')
    assert.equal(decision.event?.id, datum().id)
})

test('rsvp_enabled=false removes the surface entirely — not even the Portal link', () => {
    const decision = decideRsvpOffer(eingabe({ rsvpEnabled: false }))

    assert.equal(decision.mode, 'aus')
    assert.equal(decision.grund, 'rsvp-abgeschaltet')
    assert.equal(decision.event, null)
})

test('attendees_public=false forbids the NOSTR answer and leaves the REST one (D12a)', () => {
    const decision = decideRsvpOffer(eingabe({ attendeesPublic: false }))

    assert.equal(decision.mode, 'rest')
    assert.equal(decision.grund, 'zusagen-nicht-oeffentlich')
    assert.equal(decision.event, null)
})

test('without a nostr_address the client never publishes — whatever the relays hold', () => {
    for (const address of [null, '', 'meetup-event-3780', '31923::d', `31924:${PORTAL}:meetup-366`.replace(PORTAL, 'xx')]) {
        const decision = decideRsvpOffer(eingabe({ nostrAddress: address }))

        assert.equal(decision.mode, 'rest', `address ${JSON.stringify(address)}`)
        assert.equal(decision.grund, 'keine-adresse', `address ${JSON.stringify(address)}`)
    }
})

test('a 31924 calendar coordinate is not a date — an RSVP to it counts nowhere', () => {
    const decision = decideRsvpOffer(eingabe({ nostrAddress: `31924:${PORTAL}:meetup-366` }))

    // Not `keine-adresse`: the coordinate parses, it is simply the wrong kind — so the
    // event lookup refuses it, and the reason says which half was wrong.
    assert.equal(decision.mode, 'rest')
    assert.equal(decision.grund, 'kein-termin')
})

test('an unconfigured install asks no relay and offers no Nostr answer', () => {
    const decision = decideRsvpOffer(eingabe({ configured: false }))

    assert.equal(decision.mode, 'rest')
    assert.equal(decision.grund, 'nicht-eingerichtet')
})

test('an address signed by a key this install does not trust is refused by author, not by absence', () => {
    const decision = decideRsvpOffer(eingabe({ authors: [FOREIGN] }))

    assert.equal(decision.mode, 'rest')
    assert.equal(decision.grund, 'fremder-autor')
})

test('the relays hold nothing under that address', () => {
    const decision = decideRsvpOffer(eingabe({ events: [] }))

    assert.equal(decision.mode, 'rest')
    assert.equal(decision.grund, 'kein-termin')
})

test('a date under the SAME d but a foreign author is not the answer to our address', () => {
    // Everything about this event is legal Nostr; only the author is wrong. Without the
    // author check it would be the event on screen — the `a`/`d` is a claim, not a
    // capability (the finding that put `keepOwnAuthors` into `calendarModels.ts`).
    const decision = decideRsvpOffer(eingabe({ events: [datum({ pubkey: FOREIGN })] }))

    assert.equal(decision.mode, 'rest')
    assert.equal(decision.grund, 'kein-termin')
})

test('a cancelled date is not answerable — both carriers of the fact are read', () => {
    const statusTag = decideRsvpOffer(eingabe({
        events: [datum({ tags: [...datum().tags, ['status', CANCELLED_STATUS]] })],
    }))
    assert.equal(statusTag.mode, 'rest')
    assert.equal(statusTag.grund, 'termin-abgesagt')

    const labelOnly = decideRsvpOffer(eingabe({
        events: [datum({ tags: [...datum().tags, ['L', 'status'], ['l', CANCELLED_STATUS, 'status']] })],
    }))
    assert.equal(labelOnly.grund, 'termin-abgesagt', 'the NIP-32 mirror alone must also count as cancelled')
})

test('„cancelled" with two l\'s is NOT the machine value and must not cancel anything', () => {
    const decision = decideRsvpOffer(eingabe({
        events: [datum({ tags: [...datum().tags, ['status', 'cancelled']] })],
    }))

    // The double-l spelling is the human marker in the title. Accepting it here would be a
    // second vocabulary for one fact — and the day the Portal writes `status: pending` this
    // test says which spelling this client compares against.
    assert.equal(decision.mode, 'nostr')
})

test('a date that is over is not answerable, and `end` decides where there is one', () => {
    const past = decideRsvpOffer(eingabe({
        events: [datum({ tags: [...datum().tags.filter((t) => t[0] !== 'start'), ['start', String(NOW - 7200)]] })],
    }))
    assert.equal(past.mode, 'rest')
    assert.equal(past.grund, 'termin-vorbei')

    // Started two hours ago, runs for another one: the meetup somebody is on their way to.
    const running = decideRsvpOffer(eingabe({
        events: [datum({
            tags: [
                ...datum().tags.filter((t) => t[0] !== 'start'),
                ['start', String(NOW - 7200)],
                ['end', String(NOW + 3600)],
            ],
        })],
    }))
    assert.equal(running.mode, 'nostr', 'a running meetup is still answerable')
})

test('a date without a usable start is never „upcoming"', () => {
    const decision = decideRsvpOffer(eingabe({
        events: [datum({ tags: [...datum().tags.filter((t) => t[0] !== 'start'), ['start', 'bald']] })],
    }))

    assert.equal(decision.grund, 'termin-vorbei')
    assert.equal(isUpcomingCalendarEvent(datum({ tags: [['d', 'x']] }), NOW), false)
})

test('a moved date is judged by its NEWEST version, not by the one still in the cache', () => {
    const alt = datum({ id: '0'.repeat(64), created_at: NOW - 7200 })
    const neu = datum({
        id: '1'.repeat(64),
        created_at: NOW - 60,
        tags: [...datum().tags, ['status', CANCELLED_STATUS]],
    })

    // Both versions are in the repository — the order they arrive in must not decide.
    assert.equal(decideRsvpOffer(eingabe({ events: [alt, neu] })).grund, 'termin-abgesagt')
    assert.equal(decideRsvpOffer(eingabe({ events: [neu, alt] })).grund, 'termin-abgesagt')
})

test('parseCalendarAddress refuses everything that must never become a relay filter', () => {
    assert.deepEqual(parseCalendarAddress(ADDRESS), {
        kind: 31923,
        pubkey: PORTAL,
        dTag: 'meetup-event-3780',
    })
    assert.equal(parseCalendarAddress(null), null)
    assert.equal(parseCalendarAddress('31923:' + PORTAL + ':'), null, 'an empty d is a query for everything')
    assert.equal(parseCalendarAddress('31923::meetup-event-1'), null)
    assert.equal(parseCalendarAddress(`31923:${PORTAL.toUpperCase()}:meetup-event-1`), null, 'hex is lower case on the wire')
    assert.equal(parseCalendarAddress(`abc:${PORTAL}:meetup-event-1`), null)
    assert.equal(parseCalendarAddress(`31923:${PORTAL}:a:b`), null, 'a third colon is not a d tag')
})

test('addressOf builds the coordinate an RSVP points at, and nothing from a d-less event', () => {
    assert.equal(addressOf(datum()), ADDRESS)
    assert.equal(addressOf(datum({ tags: [['title', 'ohne d']] })), '')
})

test('rsvpTargetFor names the reason instead of returning a bare null', () => {
    assert.equal(rsvpTargetFor({ events: [], address: '', authors: [PORTAL], nowSeconds: NOW }).grund, 'keine-adresse')
    assert.equal(
        rsvpTargetFor({ events: [datum()], address: ADDRESS, authors: [], nowSeconds: NOW }).grund,
        'fremder-autor',
    )
})

test('isCancelledCalendarEvent ignores a status tag of another namespace', () => {
    // `["l","canceled"]` without the namespace is a label in the implicit „ugc" namespace
    // (NIP-32) and says nothing about our `status` vocabulary.
    assert.equal(isCancelledCalendarEvent(datum({ tags: [...datum().tags, ['l', CANCELLED_STATUS]] })), false)
    assert.equal(isCancelledCalendarEvent(datum({ tags: [...datum().tags, ['status', 'confirmed']] })), false)
})

test('the disclosure is asked once and its acknowledgement survives a version bump downwards', () => {
    assert.equal(disclosureIsAcknowledged(null), false)
    assert.equal(disclosureIsAcknowledged(''), false)
    assert.equal(disclosureIsAcknowledged('nein'), false)
    assert.equal(disclosureIsAcknowledged('0'), false)
    assert.equal(disclosureIsAcknowledged(disclosureAckValue()), true)
    assert.equal(disclosureIsAcknowledged(' 1 '), true, 'a stray space must not re-ask')
    assert.equal(
        disclosureIsAcknowledged(String(RSVP_DISCLOSURE_VERSION + 1)),
        true,
        'a device that saw a LATER text has seen this one',
    )
})
