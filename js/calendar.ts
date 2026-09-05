/**
 * `nostrMeetupEvent` — the meetup date card in the room header (P2), the welshman half.
 *
 * Counterpart to the pure `calendarModels.ts` (tags, folding, tally, RSVP shape) — same
 * split as `pins.ts`/`roomPins.ts` and `longform.ts`/`longformFeed.ts`. Everything that
 * needs a relay, the repository, a signer or a store lives here; everything that has to
 * be provable under `node --test` lives there.
 *
 * ── The source is NOT the space relay ───────────────────────────────────────────────
 *
 * A meetup's dates are published by the **portal**, to the **public** relays it is
 * configured for (`einundzwanzig-portal/config/services.php`, `NOSTR_RELAYS`, default
 * `nos.lol,relay.damus.io`) — not to the zooid/Buzz space this client otherwise talks
 * to. That makes this the second surface with a third relay source after the article
 * screen, so every query below carries an **explicit** `relays: CALENDAR_RELAYS`, the
 * way `longformFeed.ts` and `buzzAdmin.ts` do. Relying on the router's defaults would
 * ask the wrong relay.
 *
 * No code default for the addresses, no code default for the author: an unconfigured
 * install must not open a silent WebSocket to the public internet, and an E2E run must
 * be able to point both at its own worker relay. Same rule and same reason as
 * `board_relay_url` in `config/group.php`. Unconfigured ⇒ this card falls back to the
 * HTTP source and sends not a single REQ.
 *
 * ── Why there is an author filter, and why the coordinate alone is not one ──────────
 *
 * kind 31923 is a public kind on public relays and the `a` tag is a claim, not a
 * capability: anybody can publish an event pointing at our calendar. Measured on
 * 2026-09-05, a plain `nak req -k 31923 -l 100 wss://nos.lol` returned 100 events from
 * 16 authors — baseball fixtures, Brazilian concerts, and two separate keys publishing
 * an Austrian club's dates with byte-identical bodies. Without `authors` this card
 * renders whatever a stranger aims at the room. See {@link CALENDAR_AUTHORS}.
 *
 * ── And why the HTTP source stays ───────────────────────────────────────────────────
 *
 * `meetupPresentation.ts`/`meetups.ts` (the portal's `/api/mobile/meetups`) keeps its
 * job as the fallback. Measured on 2026-09-05, the portal publisher had exactly **two**
 * meetups on Nostr, while the HTTP list carries every meetup's next date. A card that
 * dropped the fallback would go blank for almost every room. The card says which of the
 * two it is showing — {@link MeetupEventState.source} is rendered, not just tracked.
 */
import { get } from 'svelte/store'
import { makeEvent, type Filter, type TrustedEvent } from '@welshman/util'
import { CALENDAR_EVENT, CALENDAR_RSVP } from './welshmanKinds.ts'
import { leseRelayListeNachsichtig } from './articleMetrics.ts'
import { load } from './welshmanNet.ts'
import { deriveEventsForUrls } from './repository.ts'
import { publishOptimistic } from './publishOptimistic.ts'
import { activeSpace, makeRoomId, roomsById, type Room } from './groups.ts'
import { parseMeetupTags } from './meetupPresentation.ts'
import { parseAboutMarker } from './roomAbout.ts'
import { getMeetupPresentation, loadMeetupPresentations } from './meetups.ts'
import { pubkey } from './welshmanSession.ts'
import { formatTimestamp } from './locale.ts'
import { t } from './i18n.ts'
import {
    countRsvps,
    makeRsvpTags,
    meetupCalendarAddress,
    ownRsvpStatus,
    pickNextCalendarEvent,
    readCalendarEvent,
    type RsvpStatus,
} from './calendarModels.ts'

/**
 * The relays a meetup's dates are read from and its RSVPs are written to
 * (`NOSTR_CALENDAR_RELAYS`, comma separated). Empty ⇒ this surface asks nothing.
 *
 * Read straight off `globalThis`, like `BOARD_URL` in `longformFeed.ts`: the host writes
 * it into the `<head>` before the island boots, and an E2E run can pre-set it with
 * `addInitScript`.
 *
 * The LENIENT reader, not the strict one, and that is a containment decision rather than
 * a taste: this module is pulled in by `bridge.ts` **statically**, so a throw at module
 * evaluation would take the whole island down at boot over a typo in the operator's
 * `.env` (the finding recorded at `leseRelayListeNachsichtig`; `longformFeed.ts` may
 * throw because it is only ever imported dynamically, into a caught branch). An
 * unreadable entry is dropped and reported once.
 */
export const CALENDAR_RELAYS: string[] = leseRelayListeNachsichtig(
    (globalThis as { __nostrCalendarRelays?: string }).__nostrCalendarRelays,
)

/**
 * The pubkeys whose kind 31923 this client will show (`NOSTR_CALENDAR_AUTHORS`, comma
 * separated hex). Empty ⇒ nothing is asked, because an unfiltered query is worse than no
 * query (see the header).
 *
 * A LIST rather than one key, and that is not speculative: the calendar coordinate
 * embeds the author (`31924:<pubkey>:meetup-<id>`), so a key rotation at the portal
 * would orphan every date published before it. With a list both keys are asked and both
 * coordinates are built, and the older dates stay visible until they age out by
 * themselves.
 *
 * The measured production value on 2026-09-05 is a single key,
 * `daf83d92768b5d0005373f83e30d4203c0b747c170449e02fea611a0da125ee6`
 * (`npub1mturmynk3dwsqpfh87p7xr2zq0qtw37pwpzfuqh75cg6pksjtmnqqxv6kw`, kind 0 name
 * "Einundzwanzig Portal", website `portal.einundzwanzig.space`). It belongs in
 * `.env.example`, not here.
 *
 * Anything that is not 32-byte hex is dropped: an `npub1…` pasted into the variable
 * would match no event at all, and "matches nothing" is indistinguishable from "this
 * meetup has no dates".
 */
export const CALENDAR_AUTHORS: string[] = ((): string[] => {
    const raw = (globalThis as { __nostrCalendarAuthors?: string }).__nostrCalendarAuthors

    return (raw ?? '')
        .split(',')
        .map((part) => part.trim().toLowerCase())
        .filter((part) => /^[0-9a-f]{64}$/.test(part))
})()

/** Is this surface configured at all? Both halves are needed; one alone asks nothing. */
export const calendarConfigured = (): boolean => CALENDAR_RELAYS.length > 0 && CALENDAR_AUTHORS.length > 0

/** Upper bounds of a single load — a meetup has a handful of dates, not a timeline. */
const EVENT_LOAD_LIMIT = 20
const RSVP_LOAD_LIMIT = 200

/**
 * The portal meetup id a room is bound to, or '' — the join key of this whole surface.
 *
 * Two shapes, because the two relays store it differently and the caller must not have
 * to know which relay it is looking at (the rule `roomAbout.ts` states: decided by the
 * DATA FORMAT, not by a configuration switch):
 *
 *  - **zooid** passes a 9007's extra tags into the 39000 unchanged, so the id sits in
 *    `["i","meetup:<id>"]` — what `scripts/sync-meetup-rooms.sh` writes.
 *  - **Buzz** builds the 39000 itself from a fixed tag set and drops foreign markers, so
 *    the same script puts the id into `about` as `einundzwanzig:meetup:<id>`.
 *
 * `parseAboutMarker` has existed since the Buzz port and had, until this phase, **not a
 * single production caller** — built and never wired. This is it.
 */
export const roomMeetupId = (room: Pick<Room, 'event' | 'about'> | undefined): string => {
    if (!room) {
        return ''
    }
    const fromTags = parseMeetupTags(room.event?.tags ?? []).meetupId
    if (fromTags) {
        return fromTags
    }
    const marker = parseAboutMarker(room.about)

    return marker?.kind === 'meetup' ? marker.id : ''
}

/** The 31924 coordinates of one meetup, one per configured author. */
const calendarAddresses = (meetupId: string): string[] =>
    CALENDAR_AUTHORS.map((author) => meetupCalendarAddress(author, meetupId)).filter((address) => address !== '')

/** Filter for a meetup's dates: our authors AND our coordinates — both, not either. */
export const calendarEventFilters = (meetupId: string): Filter[] => {
    const addresses = calendarAddresses(meetupId)

    return addresses.length === 0
        ? []
        : [{ kinds: [CALENDAR_EVENT], authors: CALENDAR_AUTHORS, '#a': addresses, limit: EVENT_LOAD_LIMIT }]
}

/**
 * Filter for the answers to one date. **No author filter here, on purpose:** an RSVP is
 * everyone's to write, and restricting it to the known authors would count nobody but
 * the portal.
 */
export const rsvpFilters = (eventAddress: string): Filter[] =>
    eventAddress ? [{ kinds: [CALENDAR_RSVP], '#a': [eventAddress], limit: RSVP_LOAD_LIMIT }] : []

/** The 31923's own coordinate — what an RSVP points at. */
export const calendarEventAddress = (event: TrustedEvent): string =>
    `${event.kind}:${event.pubkey}:${readCalendarEvent(event).dTag}`

/** Absolute date in the active language — same shape the meetup tile prints. */
const dateLabelOf = (start: number): string =>
    start > 0
        ? formatTimestamp(start, {
            weekday: 'short',
            day: 'numeric',
            month: 'short',
            hour: '2-digit',
            minute: '2-digit',
        })
        : ''

/**
 * `next_event_start` of the HTTP list is `YYYY-MM-DD HH:MM` in the portal's local time.
 * `new Date('2026-09-16 19:00')` is implementation-defined; the `T` makes it the ISO
 * local-time form every engine parses the same way. 0 for anything unparseable — a card
 * that printed 1 Jan 1970 would read exactly like a correct one.
 */
const httpDateSeconds = (iso: string): number => {
    if (!iso) {
        return 0
    }
    const ms = new Date(iso.replace(' ', 'T')).getTime()

    return Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 1000) : 0
}

/** State of the card. Every non-underscore field is read by the markup. */
type MeetupEventState = {
    /** Where the shown date comes from: the relays, the portal HTTP list, or nowhere. */
    source: 'nostr' | 'http' | ''
    title: string
    /** Localised absolute date, ready to print. */
    dateLabel: string
    location: string
    /** How many said yes — only ever non-zero for a Nostr-sourced date. */
    attending: number
    /** The user's own answer, '' when they have not answered (or are logged out). */
    myStatus: RsvpStatus | ''
    /** A publish is in flight — keeps a double click from signing twice. */
    busy: boolean
    /** Verbatim relay rejection, shown as-is. '' when nothing went wrong. */
    error: string
    /** Can this user answer at all? False without a session or without a Nostr date. */
    canRsvp: boolean
    _h: string
    _url: string
    _meetupId: string
    _address: string
    _event: TrustedEvent | null
    _rsvps: TrustedEvent[]
    _unsub: (() => void)[]
    _unsubEvents: (() => void) | null
    _unsubRsvps: (() => void) | null
    init(): void
    rsvp(status: RsvpStatus): Promise<void>
    dismissError(): void
    destroy(): void
    _start(): void
    _watchRsvps(address: string): void
    _render(): void
}

/**
 * The card, per room.
 *
 * The island is mounted for EVERY room and stays silent unless the room is a meetup with
 * a resolvable id — deliberately no `isMeetup` gate in the markup. The markup cannot make
 * that call: `RoomView.isMeetup` comes from the 39000's tags and is false on Buzz, where
 * the marker lives in `about` (see {@link roomMeetupId}). One place decides, and this is
 * it.
 */
const createMeetupEvent = (h: unknown): MeetupEventState => ({
    source: '',
    title: '',
    dateLabel: '',
    location: '',
    attending: 0,
    myStatus: '',
    busy: false,
    error: '',
    canRsvp: false,
    _h: String(h ?? ''),
    _url: '',
    _meetupId: ' not-resolved-yet',
    _address: '',
    _event: null,
    _rsvps: [],
    _unsub: [],
    _unsubEvents: null,
    _unsubRsvps: null,

    init(): void {
        // The HTTP fallback is loaded either way and costs one request per session
        // (`loadMeetupPresentations` is idempotent and fail-soft). It fills the card
        // while the relays are still answering — and stays if they never do.
        void loadMeetupPresentations().then(() => this._render())

        this._unsub.push(
            activeSpace.subscribe((url: string) => {
                this._url = url
                this._start()
            }),
        )
        // A room's 39000 arrives asynchronously (`watchSpaceRooms`). Without this the
        // card would be decided once, during the warm-render race, and a room whose
        // metadata landed a moment later would stay empty forever — the measured
        // "snapshot read once" failure class.
        this._unsub.push(roomsById.subscribe(() => this._start()))
        this._unsub.push(pubkey.subscribe(() => this._render()))
    },

    /**
     * Ask the calendar relays for this room's dates — once per (room, meetup id), which
     * is why `_meetupId` starts at a value no id can equal instead of at `''`: an
     * ordinary room resolves to `''` and must still run through the render once.
     *
     * Not a live `request`: a meetup date is not a chat. The portal republishes at most
     * every five minutes, and whoever leaves the page open misses a moved venue until
     * the next visit — not worth a permanently open subscription on a third relay.
     */
    _start(): void {
        const meetupId = roomMeetupId(get(roomsById).get(makeRoomId(this._url, this._h)))
        if (meetupId === this._meetupId) {
            return
        }
        this._meetupId = meetupId
        this._address = ''
        this._event = null
        this._rsvps = []
        this._unsubEvents?.()
        this._unsubEvents = null
        this._unsubRsvps?.()
        this._unsubRsvps = null
        this._render()

        const filters = calendarEventFilters(meetupId)
        if (!meetupId || !calendarConfigured() || filters.length === 0) {
            return
        }
        void load({ relays: CALENDAR_RELAYS, filters })
        this._unsubEvents = deriveEventsForUrls(CALENDAR_RELAYS, filters).subscribe((events: TrustedEvent[]) => {
            // The author check is repeated HERE and not only in the filter that went out.
            // A relay may answer with whatever it likes, and the repository is shared
            // with every other surface of this client — the guarantee has to hold on the
            // reading side too.
            const mine = events.filter((event) => CALENDAR_AUTHORS.includes(event.pubkey))
            this._event = pickNextCalendarEvent(mine, Math.floor(Date.now() / 1000))
            const address = this._event ? calendarEventAddress(this._event) : ''
            if (address && address !== this._address) {
                this._address = address
                this._watchRsvps(address)
            }
            this._render()
        })
    },

    /** Load and then follow the answers to the currently shown date. */
    _watchRsvps(address: string): void {
        const filters = rsvpFilters(address)
        this._unsubRsvps?.()
        void load({ relays: CALENDAR_RELAYS, filters })
        this._unsubRsvps = deriveEventsForUrls(CALENDAR_RELAYS, filters).subscribe((events: TrustedEvent[]) => {
            this._rsvps = events
            this._render()
        })
    },

    /**
     * Fold everything currently known into the fields the markup reads.
     *
     * The Nostr date WINS over the HTTP one when there is one: the portal signs it from
     * the same database row the HTTP list is built from, so the two cannot disagree about
     * a date that exists in both — and only the Nostr one can carry attendance.
     */
    _render(): void {
        const event = this._event
        if (event) {
            const fields = readCalendarEvent(event)
            this.source = 'nostr'
            this.title = fields.title
            this.dateLabel = dateLabelOf(fields.start)
            this.location = fields.location
            this.attending = countRsvps(this._rsvps, this._address).accepted
            this.myStatus = ownRsvpStatus(this._rsvps, this._address, get(pubkey))
            this.canRsvp = Boolean(get(pubkey))

            return
        }
        // Fallback: the portal's HTTP list, joined by slug exactly as the meetup tile
        // does it. It has no venue and no attendance — and says so by leaving them empty.
        const room = get(roomsById).get(makeRoomId(this._url, this._h))
        const slug = parseMeetupTags(room?.event?.tags ?? []).meetupSlug
        const seconds = httpDateSeconds(getMeetupPresentation(slug)?.nextEventStart ?? '')
        this.source = seconds > 0 ? 'http' : ''
        this.title = seconds > 0 ? t('Nächster Termin') : ''
        this.dateLabel = seconds > 0 ? dateLabelOf(seconds) : ''
        this.location = ''
        this.attending = 0
        this.myStatus = ''
        this.canRsvp = false
    },

    /**
     * Publish our own kind 31925 to the calendar relays and wait for their verdict.
     *
     * `publishOptimistic` puts the event into the repository immediately, so the count
     * and the button state move without a round trip, and removes it again if the relays
     * reject it — without that rollback a "yes" would keep standing that nobody ever
     * accepted. The `d` is derived from the target (`calendarModels.rsvpDTag`), so
     * changing the answer REPLACES the previous one instead of stacking a second event
     * beside it.
     */
    async rsvp(status: RsvpStatus): Promise<void> {
        const event = this._event
        if (this.busy || !event || !get(pubkey)) {
            return
        }
        this.busy = true
        this.error = ''
        try {
            this.error = await publishOptimistic(
                CALENDAR_RELAYS,
                makeEvent(CALENDAR_RSVP, { tags: makeRsvpTags(event, status) }),
            )
        } finally {
            this.busy = false
        }
    },

    dismissError(): void {
        this.error = ''
    },

    destroy(): void {
        for (const off of this._unsub) {
            off()
        }
        this._unsub = []
        this._unsubEvents?.()
        this._unsubEvents = null
        this._unsubRsvps?.()
        this._unsubRsvps = null
    },
})

export function wireMeetupEvent(Alpine: {
    data: (name: string, factory: (...args: unknown[]) => unknown) => void
}): void {
    Alpine.data('nostrMeetupEvent', createMeetupEvent as (...args: unknown[]) => unknown)
}
