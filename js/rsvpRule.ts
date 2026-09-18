/**
 * WHEN this client offers a Nostr RSVP for a Portal date, and when it does not (D12/D12a,
 * P5) — PURE and welshman-free like `calendarModels.ts`, so every row of the table below
 * is provable under `node --test`.
 *
 * NO extension-less relative imports — the node test runner would stop resolving them.
 *
 * ── Why a rule and not an `if` at the button ─────────────────────────────────────────
 *
 * Four surfaces ask the same question (the meetup page, the Termine list, the room's date
 * card and the Start preview) and they ask it from two different sides: three of them
 * start from a PORTAL payload (`nostr_address`, `attendees_public`, `rsvp_enabled`), the
 * room card starts from an EVENT it found on a relay. A copy of the condition per surface
 * is four chances to get one row wrong, and the row that gets wrong is the expensive one:
 * publishing a public, permanent answer where the meetup asked for none.
 *
 * ── The table ────────────────────────────────────────────────────────────────────────
 *
 * | Condition                                        | mode   | grund                     |
 * |--------------------------------------------------|--------|---------------------------|
 * | `rsvp_enabled = false`                           | `aus`  | `rsvp-abgeschaltet`       |
 * | `attendees_public = false`                       | `rest` | `zusagen-nicht-oeffentlich`|
 * | no `nostr_address`                               | `rest` | `keine-adresse`           |
 * | no calendar relays / no authors configured       | `rest` | `nicht-eingerichtet`      |
 * | the address' author is not a configured author   | `rest` | `fremder-autor`           |
 * | no 31923 under that address on the relays        | `rest` | `kein-termin`             |
 * | the 31923 carries `["status","canceled"]`        | `rest` | `termin-abgesagt`         |
 * | the 31923 is over                                | `rest` | `termin-vorbei`           |
 * | everything else                                  | `nostr`| `offen`                   |
 *
 * **`aus` means no RSVP surface at all**, `rest` means „not through Nostr": on the web
 * that is the link into the Portal („Im Portal zusagen"), in the app its own REST RSVP
 * controls, which the Portal still accepts (`MeetupEventController::rsvp` gates on
 * `rsvp_enabled` and on nothing else — read 2026-09-18).
 *
 * The `attendees_public = false` row is `rest` and not `aus` on purpose. D12a forbids the
 * NOSTR answer there, for a reason that is specific to Nostr: a kind 31925 is public and
 * permanent, and one query against the coordinate returns the whole guest list — exactly
 * what a meetup that hides its attendance did not ask for. The REST answer has none of
 * those properties and the Portal grants it today; taking it away would remove a working
 * ability under the heading of a rule about a different mechanism.
 */
import {
    isCancelledCalendarEvent,
    latestByAddress,
    readCalendarEvent,
    type CalendarSourceEvent,
} from './calendarModels.ts'

/**
 * The cancellation READING lives in `calendarModels.ts` and is re-exported here.
 *
 * Not a convenience: the room's date card needs it on every page (it is statically in the
 * boot path), while this module — the policy — is loaded only where an answer is possible.
 * With the function here, importing it would have dragged the whole rule into the boot path,
 * and the bundle latch measures exactly that.
 */
export { CANCELLED_STATUS, CANCELLED_LABEL_NAMESPACE, isCancelledCalendarEvent } from './calendarModels.ts'

export type RsvpMode = 'nostr' | 'rest' | 'aus'

export type RsvpGrund =
    | 'offen'
    | 'rsvp-abgeschaltet'
    | 'zusagen-nicht-oeffentlich'
    | 'keine-adresse'
    | 'nicht-eingerichtet'
    | 'fremder-autor'
    | 'kein-termin'
    | 'termin-abgesagt'
    | 'termin-vorbei'

export type RsvpDecision = {
    mode: RsvpMode
    grund: RsvpGrund
    /** The 31923 an answer would address — only ever set on `mode: 'nostr'`. */
    event: CalendarSourceEvent | null
}

/** The three parts of a NIP-01 coordinate. `null` for anything else. */
export type CalendarAddress = { kind: number; pubkey: string; dTag: string }

/**
 * `31923:<64 hex>:meetup-event-<id>` → its parts.
 *
 * The kind is checked against 31923 and the pubkey against 32 hex bytes, because both end
 * up in a relay FILTER: an `authors: ['']` or a `#d: ['']` is a query for everything
 * nobody tagged, not a query for nothing — the same reason `meetupCalendarAddress` returns
 * '' rather than a half coordinate.
 */
export const parseCalendarAddress = (address: string | null | undefined): CalendarAddress | null => {
    const parts = (address ?? '').split(':')
    if (parts.length !== 3) {
        return null
    }
    const [kind, pubkey, dTag] = parts
    if (!/^\d+$/.test(kind) || !/^[0-9a-f]{64}$/.test(pubkey) || dTag === '') {
        return null
    }

    return { kind: Number(kind), pubkey, dTag }
}

/** The event's own coordinate, built from what it carries. '' without a `d`. */
export const addressOf = (event: CalendarSourceEvent): string => {
    const { dTag } = readCalendarEvent(event)

    return dTag === '' ? '' : `${event.kind}:${event.pubkey}:${dTag}`
}

/** Is this date still to come? `end` decides where there is one, `start` otherwise. */
export const isUpcomingCalendarEvent = (event: CalendarSourceEvent, nowSeconds: number): boolean => {
    const { start, end } = readCalendarEvent(event)

    return start > 0 && (end > 0 ? end : start) >= nowSeconds
}

/**
 * The one 31923 that answers `address`, plus the reason there is none.
 *
 * Folded through {@link latestByAddress} first: a date that moved is re-published under the
 * same coordinate, and our repository can legitimately hold both versions (IndexedDB cache
 * plus a fresh one off the wire). Judging the OLD one would mean showing an RSVP button for
 * a date that has since been called off.
 */
export const rsvpTargetFor = (input: {
    events: readonly CalendarSourceEvent[]
    address: string
    authors: readonly string[]
    nowSeconds: number
}): { event: CalendarSourceEvent | null; grund: RsvpGrund } => {
    const parsed = parseCalendarAddress(input.address)
    if (parsed === null) {
        return { event: null, grund: 'keine-adresse' }
    }
    /*
     * The author check on the ADDRESS, before a single event is looked at. `nostr_address`
     * comes from our own Portal, so its pubkey is the Portal's — but the configured author
     * list is what this install trusts, and an address signed by a key that is not on it
     * has no findable event for us anyway (the REQ carries `authors`). Saying so as its own
     * reason keeps „the Portal rotated its key" apart from „the relay has nothing".
     */
    if (!input.authors.includes(parsed.pubkey)) {
        return { event: null, grund: 'fremder-autor' }
    }

    const candidates = latestByAddress(input.events).filter(
        (event) => event.pubkey === parsed.pubkey && event.kind === parsed.kind && addressOf(event) === input.address,
    )
    if (candidates.length === 0) {
        return { event: null, grund: 'kein-termin' }
    }
    const event = candidates[0]
    if (isCancelledCalendarEvent(event)) {
        return { event: null, grund: 'termin-abgesagt' }
    }
    if (!isUpcomingCalendarEvent(event, input.nowSeconds)) {
        return { event: null, grund: 'termin-vorbei' }
    }

    return { event, grund: 'offen' }
}

/**
 * The decision for one date. See the table in the module header.
 *
 * `configured` is the caller's answer to „does this install have calendar relays AND
 * authors" (`calendar.calendarConfigured()`); it is passed in rather than read, because
 * this module must stay free of the `globalThis` the configuration arrives on.
 */
export const decideRsvpOffer = (input: {
    nostrAddress: string | null
    attendeesPublic: boolean
    rsvpEnabled: boolean
    configured: boolean
    events: readonly CalendarSourceEvent[]
    authors: readonly string[]
    nowSeconds: number
}): RsvpDecision => {
    if (!input.rsvpEnabled) {
        return { mode: 'aus', grund: 'rsvp-abgeschaltet', event: null }
    }
    if (!input.attendeesPublic) {
        return { mode: 'rest', grund: 'zusagen-nicht-oeffentlich', event: null }
    }
    if (parseCalendarAddress(input.nostrAddress) === null) {
        return { mode: 'rest', grund: 'keine-adresse', event: null }
    }
    if (!input.configured) {
        return { mode: 'rest', grund: 'nicht-eingerichtet', event: null }
    }

    const { event, grund } = rsvpTargetFor({
        events: input.events,
        address: input.nostrAddress as string,
        authors: input.authors,
        nowSeconds: input.nowSeconds,
    })

    return event === null ? { mode: 'rest', grund, event: null } : { mode: 'nostr', grund: 'offen', event }
}

// ── The disclosure before the FIRST answer ─────────────────────────────────────────────

/**
 * Storage key of the acknowledged disclosure. House `e21:` prefix, and deliberately NOT
 * bound to the pubkey: what the sentence explains is a property of the MECHANISM (a signed
 * event on foreign relays is public and permanent), not of an account. Whoever has read it
 * once has read it; asking again after a key change would train people to click it away.
 */
export const RSVP_DISCLOSURE_KEY = 'e21:rsvp:hinweis'

/**
 * Version of the text that was acknowledged. Stored as a number so that a future, MATERIAL
 * change to what an RSVP does can ask once more — a cosmetic rewording must not.
 */
export const RSVP_DISCLOSURE_VERSION = 1

/** Has this device acknowledged the current disclosure? Anything unparseable = no. */
export const disclosureIsAcknowledged = (raw: string | null): boolean => {
    if (raw === null) {
        return false
    }
    const value = Number(raw.trim())

    return Number.isFinite(value) && value >= RSVP_DISCLOSURE_VERSION
}

/** What gets written on „Verstanden". */
export const disclosureAckValue = (): string => String(RSVP_DISCLOSURE_VERSION)
