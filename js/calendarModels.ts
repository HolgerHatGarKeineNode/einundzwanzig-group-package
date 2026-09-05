/**
 * NIP-52 calendar rules — PURE and welshman-free (like `relayCaps.ts`,
 * `meetupPresentation.ts`, `roomCategories.ts`), so they stay provable without a
 * browser or a store runtime (`calendarModels.test.ts` runs under `node --test`).
 * NO extension-less relative imports — the node test runner would stop resolving them.
 *
 * The welshman half (relay list, query, publish, the Alpine island) is `calendar.ts`.
 *
 * ── Which events this is about, measured rather than assumed ────────────────────────
 *
 * The Einundzwanzig portal signs and publishes its meetups as NIP-52 since 2026-09-04
 * (`einundzwanzig-portal/app/Console/Commands/Nostr/PublishCalendarEvents.php`, every
 * five minutes via `routes/console.php`). Two kinds leave that command:
 *
 *   31924 calendar     `d = meetup-<meetupId>`        one per meetup
 *   31923 time-based   `d = meetup-event-<eventId>`   one per date, carrying
 *                      `["a", "31924:<portalPubkey>:meetup-<meetupId>"]`
 *
 * Read from `wss://nos.lol` on 2026-09-05, verbatim, the whole public output of that
 * publisher at the time (`nak req -a daf83d92… -l 200`):
 *
 *   31924 meetup-366        "21Bitcoin Zypern"      tags d,title,location,g
 *   31924 meetup-359        "Indy Bitcoin Meetup"   tags d,title,location,g,r,r,r
 *   31923 meetup-event-3780 start 1789599600        tags d,title,start,D,end,
 *                                                        start_tzid,location,g,a
 *   31923 meetup-event-3777 start 1789228800        same shape
 *
 * **That `a` tag is the join, and it is COMPUTABLE.** A meetup room's 39000 carries the
 * portal's meetup id — as `["i","meetup:<id>"]` on zooid, and inside the
 * `einundzwanzig:meetup:<id>` prefix of `about` on Buzz (`roomAbout.ts`). So the client
 * never has to guess which dates belong to a room: it builds the calendar coordinate
 * from the id and asks for `{"kinds":[31923],"authors":[…],"#a":[…]}`. See
 * {@link meetupCalendarAddress}.
 *
 * ── The author filter is not decoration ─────────────────────────────────────────────
 *
 * kind 31923 is a public kind on public relays. The same `nak req -k 31923 -l 100`
 * that found the portal's events returned 96 events from 15 other authors — baseball
 * games, Brazilian concerts, and two keys (`6cb4dab5…`, `4fcdcc4b…`) publishing an
 * Austrian club's own dates with byte-identical bodies under two different keys. Any
 * of them can put ANY `a` tag on their event, including ours: the coordinate is not a
 * capability. Without `authors` the card would render whatever a stranger points at
 * this room. The pubkey is configuration, not a literal — see `calendar.ts`.
 *
 * ── Addressable means replaceable, and that cuts both ways ──────────────────────────
 *
 * A date that moves is re-published under the SAME coordinate. The relay keeps the
 * newest, but our repository can legitimately hold both (cache from IndexedDB plus a
 * fresh one off the wire), so every fold in here keeps the newest `created_at` per
 * `(pubkey, d)` — {@link latestByAddress}. The same rule is why an RSVP records the
 * event id it answered ({@link makeRsvpTags}): the coordinate alone cannot say which
 * version somebody said yes to.
 */

/** Kind 31923 — NIP-52 time-based calendar event. Mirrors welshman's `EVENT_TIME`. */
export const CALENDAR_EVENT_KIND = 31923

/** Kind 31924 — NIP-52 calendar. Mirrors welshman's `CALENDAR`. */
export const CALENDAR_KIND = 31924

/** Kind 31925 — NIP-52 RSVP. Mirrors welshman's `EVENT_RSVP`. */
export const CALENDAR_RSVP_KIND = 31925

/**
 * `d`-tag prefix of a portal CALENDAR (31924), i.e. `meetup-<id>` —
 * `NostrCalendarEventFactory::calendarDTag()` in the portal repository. The date events
 * use `meetup-event-<id>` and are NOT addressed by this client: they are found through
 * the `a` tag instead, because their id is the portal's `meetup_events.id`, which no
 * room knows.
 */
export const PORTAL_CALENDAR_D_PREFIX = 'meetup-'

/** The three attendance values NIP-52 allows in the `status` tag of a 31925. */
export const RSVP_STATUSES = ['accepted', 'declined', 'tentative'] as const

export type RsvpStatus = (typeof RSVP_STATUSES)[number]

/** Just enough of a Nostr event for these rules — keeps the module dependency-free. */
export type CalendarSourceEvent = {
    id: string
    pubkey: string
    kind: number
    created_at: number
    content: string
    tags: string[][]
}

/** The fields of a kind 31923 this client renders. Empty/0 where the tag is absent. */
export type CalendarEventFields = {
    /** `d` — the portal's `meetup-event-<id>`. '' makes the event unaddressable. */
    dTag: string
    title: string
    /** `start` as a Unix timestamp in seconds; 0 when missing or not a number. */
    start: number
    /** `end` as a Unix timestamp in seconds; 0 when absent. */
    end: number
    /** `start_tzid`, e.g. `Europe/Berlin` ('' when absent). */
    startTzid: string
    location: string
    /** `content` — the portal puts the description there, never in a `summary` tag. */
    description: string
    /** The `a` tag: the 31924 coordinate this date belongs to ('' when absent). */
    calendarAddress: string
}

/** The fields of a kind 31925 this client counts. */
export type RsvpFields = {
    /** `d` — the RSVP's own identifier. */
    dTag: string
    /** `a` — the coordinate of the calendar event answered ('' when absent). */
    address: string
    /** `e` — the concrete event id answered, when the author recorded one. */
    eventId: string
    /** `status` — '' when absent or outside NIP-52's three values. */
    status: RsvpStatus | ''
}

const tagValue = (tags: string[][], name: string): string => {
    for (const tag of tags) {
        if (tag[0] === name && typeof tag[1] === 'string') {
            return tag[1]
        }
    }

    return ''
}

/**
 * A tag value as a Unix timestamp, or 0.
 *
 * `Number('')` is 0 and `Number('  12 ')` is 12, so the string is checked against a
 * digit pattern first: a `start` tag that says `soon` must not become "1970" — a wrong
 * date reads exactly like a right one.
 */
const tagSeconds = (tags: string[][], name: string): number => {
    const raw = tagValue(tags, name)

    return /^\d+$/.test(raw) ? Number(raw) : 0
}

/**
 * The 31924 coordinate of a portal meetup: `31924:<portalPubkey>:meetup-<meetupId>`.
 *
 * '' when either half is missing — an empty coordinate must never become a filter,
 * because `{"#a":[""]}` is a query for everything nobody tagged, not a query for
 * nothing. The caller checks for '' before asking a relay.
 */
export const meetupCalendarAddress = (portalPubkey: string, meetupId: string): string => {
    const pubkey = (portalPubkey || '').trim().toLowerCase()
    const id = (meetupId || '').trim()

    return pubkey && id ? `${CALENDAR_KIND}:${pubkey}:${PORTAL_CALENDAR_D_PREFIX}${id}` : ''
}

/** Reads the rendered fields out of a kind 31923. Tolerates every tag being absent. */
export const readCalendarEvent = (event: CalendarSourceEvent): CalendarEventFields => ({
    dTag: tagValue(event.tags, 'd'),
    title: tagValue(event.tags, 'title'),
    start: tagSeconds(event.tags, 'start'),
    end: tagSeconds(event.tags, 'end'),
    startTzid: tagValue(event.tags, 'start_tzid'),
    location: tagValue(event.tags, 'location'),
    description: event.content ?? '',
    calendarAddress: tagValue(event.tags, 'a'),
})

/** Reads the counted fields out of a kind 31925. */
export const readRsvp = (event: CalendarSourceEvent): RsvpFields => {
    const status = tagValue(event.tags, 'status')

    return {
        dTag: tagValue(event.tags, 'd'),
        address: tagValue(event.tags, 'a'),
        eventId: tagValue(event.tags, 'e'),
        status: (RSVP_STATUSES as readonly string[]).includes(status) ? (status as RsvpStatus) : '',
    }
}

/**
 * `tzid` if this runtime can actually format in it, `''` otherwise.
 *
 * ## Why this is a check and not a cast
 *
 * `new Intl.DateTimeFormat(locale, {timeZone: 'Erde/Mitte'})` THROWS, and the house
 * formatter (`locale.ts formatTimestamp`) catches every construction error and falls
 * back to a plain ISO-like rendering **in the reader's local time** — silently. For a
 * place-bound event that is the one outcome that must not happen by accident: it looks
 * exactly like a correct local-time rendering, and somebody plans a journey around it.
 * Asking first turns the silent fallback into a decision the caller makes and labels.
 *
 * A relay carries whatever the publisher wrote, and `start_tzid` is free text.
 */
export const usableTimeZone = (tzid: string): string => {
    const value = (tzid || '').trim()
    if (!value) {
        return ''
    }
    try {
        new Intl.DateTimeFormat('en', { timeZone: value }).format(0)

        return value
    } catch {
        return ''
    }
}

/**
 * Keeps only the events of `authors` — the SECOND application of the author filter, on
 * the reading side.
 *
 * ## Why it exists twice, and why it is its own function
 *
 * The first application is the `authors` key of the REQ (`calendar.ts
 * calendarEventFilters`). A relay is free to answer with whatever it likes, and the
 * repository these events land in is shared with every other surface of this client — an
 * event that arrived through some other query is in there too.
 *
 * It sits here, exported and pure, because a check that only exists inside a subscribe
 * callback cannot be falsified on its own: with both halves in place, removing either
 * one leaves every test green, and only removing BOTH turns the surface red. Two halves,
 * two tests.
 */
export const keepOwnAuthors = <T extends { pubkey: string }>(
    events: readonly T[],
    authors: readonly string[],
): T[] => events.filter((event) => authors.includes(event.pubkey))

/**
 * Folds a list of ADDRESSABLE events down to one per `(pubkey, d)`, newest wins.
 *
 * Ties on `created_at` are broken by the lexicographically smaller event id, so that two
 * clients folding the same set arrive at the same event. Second granularity makes a tie
 * an ordinary case, not an exotic one — a re-publish inside the same second is exactly
 * what a five-minute cron can produce.
 */
export const latestByAddress = <T extends CalendarSourceEvent>(events: readonly T[]): T[] => {
    const byKey = new Map<string, T>()
    for (const event of events) {
        const key = `${event.kind}:${event.pubkey}:${tagValue(event.tags, 'd')}`
        const held = byKey.get(key)
        if (
            !held
            || event.created_at > held.created_at
            || (event.created_at === held.created_at && event.id < held.id)
        ) {
            byKey.set(key, event)
        }
    }

    return [...byKey.values()]
}

/**
 * The next date out of a set of 31923s: the one that starts soonest among those not yet
 * over. `null` when nothing qualifies.
 *
 * A date counts as "not over" while `end` (or, without an `end`, `start`) is still in
 * the future. That is deliberate: a meetup that began an hour ago is the one a visitor
 * wants to see on the room's header, not the one four weeks out. Events without a
 * usable `start` are dropped — an event at timestamp 0 would otherwise always be "past"
 * and, worse, could win the sort if the comparison ran the other way round.
 *
 * The list is folded through {@link latestByAddress} first, so a moved date is judged by
 * its current version even when the old one is still in the repository.
 */
export const pickNextCalendarEvent = <T extends CalendarSourceEvent>(
    events: readonly T[],
    nowSeconds: number,
): T | null => {
    let best: T | null = null
    let bestStart = 0
    for (const event of latestByAddress(events)) {
        const { start, end } = readCalendarEvent(event)
        if (start <= 0 || (end > 0 ? end : start) < nowSeconds) {
            continue
        }
        if (!best || start < bestStart || (start === bestStart && event.id < best.id)) {
            best = event
            bestStart = start
        }
    }

    return best
}

/** Attendance tally of one calendar event. */
export type RsvpTally = { accepted: number; declined: number; tentative: number }

/**
 * Counts the RSVPs that answer `address`: **one vote per pubkey**, the newest one.
 *
 * Folding by pubkey rather than by `(pubkey, d)` is the point. NIP-52 lets the client
 * pick the RSVP's `d` freely ("universally unique identifier. Generated by the client"),
 * so a client that draws a fresh UUID on every change leaves its earlier answers
 * standing as separate addressable events. Counting those as separate people is how a
 * meetup with four guests reports eleven. This client derives its own `d` from the
 * target ({@link rsvpDTag}) so that a change REPLACES, but the fold has to hold for
 * everybody else's events too.
 *
 * An RSVP without one of NIP-52's three status values is not counted at all — neither as
 * yes nor as no. Same reason as the `start` check above: inventing a value is worse than
 * missing one.
 */
export const countRsvps = (rsvps: readonly CalendarSourceEvent[], address: string): RsvpTally => {
    const tally: RsvpTally = { accepted: 0, declined: 0, tentative: 0 }
    if (!address) {
        return tally
    }
    for (const [, event] of newestPerPubkey(rsvps, address)) {
        const { status } = readRsvp(event)
        if (status) {
            tally[status] += 1
        }
    }

    return tally
}

/** The user's own current answer to `address` ('' when they have not answered). */
export const ownRsvpStatus = (
    rsvps: readonly CalendarSourceEvent[],
    address: string,
    pubkey: string | null | undefined,
): RsvpStatus | '' => {
    if (!address || !pubkey) {
        return ''
    }
    const own = newestPerPubkey(rsvps, address).get(pubkey)

    return own ? readRsvp(own).status : ''
}

/** Newest RSVP per pubkey among those answering `address`. Shared by tally and own-status. */
const newestPerPubkey = (
    rsvps: readonly CalendarSourceEvent[],
    address: string,
): Map<string, CalendarSourceEvent> => {
    const byPubkey = new Map<string, CalendarSourceEvent>()
    for (const event of rsvps) {
        if (readRsvp(event).address !== address) {
            continue
        }
        const held = byPubkey.get(event.pubkey)
        if (
            !held
            || event.created_at > held.created_at
            || (event.created_at === held.created_at && event.id < held.id)
        ) {
            byPubkey.set(event.pubkey, event)
        }
    }

    return byPubkey
}

/**
 * The `d` tag this client puts on its own RSVP — DERIVED from the target, not random.
 *
 * NIP-52 leaves the value to the client. A random one would make every change a new
 * addressable event, and the relay would keep them all: the author's own client would
 * then have to fold its own history to answer "what did I say?". Deriving it from the
 * coordinate makes the RSVP replaceable in the only sense that matters — one answer per
 * (person, event), and changing it overwrites the previous one at the relay.
 *
 * Uniqueness is not lost by this: addressability is `(kind, pubkey, d)`, and the pubkey
 * is in there. Two people answering the same date have the same `d` and remain two
 * distinct events.
 */
export const rsvpDTag = (address: string): string => `rsvp:${address}`

/**
 * The tags of our own kind 31925 answering `event`.
 *
 * `a` and `status` are NIP-52's required tags (besides `d`); `e` and `p` are optional
 * and both are set on purpose:
 *
 *  - `e` records WHICH VERSION was answered. The coordinate cannot: a moved date keeps
 *    its address, so an RSVP that only carries `a` looks equally fresh after the venue
 *    and the day have both changed. Anyone who wants to detect that has the id here.
 *  - `p` is the calendar event's author, so the publisher's own client can find the
 *    answers to its dates with a plain `{"#p":[…]}` — without it, RSVPs are only
 *    findable by someone who already knows the coordinate.
 *
 * `fb` is deliberately NOT set. NIP-52 makes it optional and forbids it on `declined`,
 * and this surface has no free/busy notion to fill it from; an invented `free` would be
 * a claim about the user's calendar that the user never made.
 */
export const makeRsvpTags = (
    event: CalendarSourceEvent,
    status: RsvpStatus,
): string[][] => {
    const { dTag } = readCalendarEvent(event)
    const address = `${event.kind}:${event.pubkey}:${dTag}`

    return [
        ['d', rsvpDTag(address)],
        ['a', address],
        ['e', event.id],
        ['p', event.pubkey],
        ['status', status],
    ]
}
