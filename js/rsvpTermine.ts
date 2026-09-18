/**
 * `$store.rsvpTermine` — saying yes to a Portal date from the read-only Portal surfaces
 * (D12/P5): the meetup page, the Termine list and the next-date row on Start.
 *
 * ── Why a STORE and not an island per date ───────────────────────────────────────────
 *
 * The Termine list shows up to sixty dates on one screen. An island per row would open
 * sixty subscriptions and sixty REQs against a third-party relay for one page — so the
 * rows REGISTER their coordinate here ({@link RsvpTermineStore.track}) and this store asks
 * ONE query for all of them. The second reason is the one the five stores before it had:
 * the same fact („did I answer this date?") is needed by two surfaces that never see each
 * other in the DOM — the meetup page's next-date block and the same date's row in the list.
 *
 * ── What it does NOT decide ──────────────────────────────────────────────────────────
 *
 * Whether a date may be answered at all through Nostr is the SERVER's half of the rule:
 * `rsvp_enabled`, `attendees_public` and the presence of a `nostr_address` come out of the
 * Portal payload, and the Blade surface renders either this store's buttons or the REST
 * arm on that basis (`components/rsvp-termin.blade.php`). What this store adds is the half
 * only the browser can answer: is the 31923 really on the relays, is it from a configured
 * author, is it neither cancelled nor over (`rsvpRule.rsvpTargetFor`).
 *
 * ── The disclosure (D12) ─────────────────────────────────────────────────────────────
 *
 * A press writes a signed, public, permanent event to relays this client does not own, and
 * one query against the coordinate returns the complete guest list. The room's date card
 * states that in a line next to its single button; here the button often stands in a list of
 * sixty rows, where a sentence per row is not readable. So the FIRST answer on this device
 * opens the sentence as a STEP — „Verstanden & zusagen" acknowledges it and carries out the
 * same intent, every later answer publishes directly. The acknowledgement lives in
 * `localStorage` and belongs to the DEVICE, not to the account (see `RSVP_DISCLOSURE_KEY`).
 */
import { derived, get, type Readable } from 'svelte/store'
import type { Filter, TrustedEvent } from '@welshman/util'
import { CALENDAR_EVENT, CALENDAR_RSVP } from './welshmanKinds.ts'
import { load } from './welshmanNet.ts'
import { deriveEventsForUrls } from './repository.ts'
import { pubkey } from './welshmanSession.ts'
import { activeSpaceView } from './groups.ts'
import { pinnedKeys } from './pinSetSync.ts'
import { CALENDAR_AUTHORS, CALENDAR_RELAYS, calendarConfigured } from './calendar.ts'
import { countRsvps, ownRsvpAt, ownRsvpStatus, type RsvpStatus } from './calendarModels.ts'
import { publishRsvp } from './rsvpPublish.ts'
import { t } from './i18n.ts'
import { formatTimestamp } from './locale.ts'
import {
    disclosureAckValue,
    disclosureIsAcknowledged,
    parseCalendarAddress,
    rsvpTargetFor,
    RSVP_DISCLOSURE_KEY,
    type RsvpGrund,
} from './rsvpRule.ts'

/** Upper bound of one date query — two months of dates, not a timeline. */
const DATE_LOAD_LIMIT = 200

/** Upper bound of the answers asked for at once. */
const RSVP_LOAD_LIMIT = 500

/** One tracked date, as the markup reads it. */
export type RsvpRow = {
    /** Has a relay round for this address come back at least once? */
    ready: boolean
    /** May this date be answered through Nostr right now (browser half + session)? */
    offen: boolean
    /** Why not, when `offen` is false — the named reasons of `rsvpRule.ts`. */
    grund: RsvpGrund
    /** How many said yes, as the relays currently show it. */
    attending: number
    /** The user's own answer, '' when they have not answered (or are logged out). */
    myStatus: RsvpStatus | ''
    /** A publish is in flight — keeps a double tap from signing twice. */
    busy: boolean
    /** Verbatim relay rejection, shown as-is. '' when nothing went wrong. */
    error: string
    /** Relays that took the answer and relays that did not — only on a partial result. */
    partial: { delivered: string[]; failed: string[] } | null
}

const LEER: RsvpRow = {
    ready: false,
    offen: false,
    grund: 'kein-termin',
    attending: 0,
    myStatus: '',
    busy: false,
    error: '',
    partial: null,
}

export type RsvpTermineStore = {
    /** Is a session present at all? Without one there is nothing to sign with. */
    angemeldet: boolean
    /** Does the FIRST answer on this device still owe the disclosure? */
    hinweisOffen: boolean
    /** The answer waiting behind the disclosure, `null` when none is. */
    wartet: { address: string; status: RsvpStatus } | null
    /** The tracked rows, by coordinate. */
    rows: Record<string, RsvpRow>
    track(addresses: unknown): void
    row(address: string): RsvpRow
    rsvp(address: string, status: RsvpStatus): void
    hinweisBestaetigen(): void
    hinweisAbbrechen(): void
    dismiss(address: string): void
    partialLabel(address: string): string
}

/** A relay URL as a person reads it: host only. Same rule as the room's date card. */
const displayRelay = (url: string): string => {
    try {
        return new URL(url).host
    } catch {
        return url
    }
}

const readAck = (): boolean => {
    try {
        return disclosureIsAcknowledged(localStorage.getItem(RSVP_DISCLOSURE_KEY))
    } catch {
        // Private mode, blocked storage: the sentence is shown again. Asking twice is the
        // harmless direction; publishing a public, permanent answer without having said what
        // it does is not.
        return false
    }
}

const writeAck = (): void => {
    try {
        localStorage.setItem(RSVP_DISCLOSURE_KEY, disclosureAckValue())
    } catch {
        // See above — the answer still goes out, the sentence is simply shown again.
    }
}

// ── Module state ───────────────────────────────────────────────────────────────────────
//
// At module level and not inside `wireRsvpTermine`, because the Start island at the bottom
// tracks an address it only learns in the browser: with the state in a closure that island
// would need a handle the wiring hands out, and this is that handle.

/** Coordinates the surfaces of this page have registered. */
const tracked = new Set<string>()

let dates: TrustedEvent[] = []
let answers: TrustedEvent[] = []
let unsubDates: (() => void) | null = null
let unsubRsvps: (() => void) | null = null

/** Alpine's reactive proxy of the store — `null` until the store is wired. */
let reactive: RsvpTermineStore | null = null

const rowOf = (address: string): RsvpRow => reactive?.rows[address] ?? LEER

const writeRow = (address: string, patch: Partial<RsvpRow>): void => {
    if (!reactive) {
        return
    }
    // A NEW object, not a mutation of the held one: Alpine tracks the property that was
    // written, and a nested mutation inside `rows` would move no `x-text` on the page.
    reactive.rows = { ...reactive.rows, [address]: { ...rowOf(address), ...patch } }
}

/** Fold everything currently known into the rows the markup reads. */
const render = (): void => {
    if (!reactive) {
        return
    }
    const now = Math.floor(Date.now() / 1000)
    const self = get(pubkey) ?? ''
    const next: Record<string, RsvpRow> = {}

    for (const address of tracked) {
        const { event, grund } = rsvpTargetFor({ events: dates, address, authors: CALENDAR_AUTHORS, nowSeconds: now })

        next[address] = {
            ...rowOf(address),
            ready: true,
            // A session is part of the question: without a key there is nothing to sign, and
            // two buttons a guest cannot press are worse than none — the guest gets the
            // Portal link-out instead.
            offen: event !== null && self !== '',
            grund,
            attending: countRsvps(answers, address).accepted,
            myStatus: ownRsvpStatus(answers, address, self),
        }
    }

    reactive.rows = next
    reactive.angemeldet = self !== ''
}

/** (Re)open the two queries for everything tracked so far. */
const arm = (): void => {
    if (tracked.size === 0 || !calendarConfigured()) {
        render()

        return
    }

    const parsed = [...tracked].map((address) => parseCalendarAddress(address))
    const dTags = Array.from(new Set(parsed.filter((a) => a !== null).map((a) => (a as { dTag: string }).dTag)))
    const addresses = [...tracked]

    /*
     * ONE filter per REQ (house rule): the dates are asked by `authors` + `#d`, NOT by `#a`.
     * A 31923's own coordinate is `kind:pubkey:d`, so `#d` IS the address once the author is
     * pinned — while the `a` tag OF a 31923 points at its calendar (31924), not at itself.
     * Asking `#a` here would return every date of the calendar and nothing that answers this
     * coordinate.
     */
    const dateFilters: Filter[] = [
        { kinds: [CALENDAR_EVENT], authors: CALENDAR_AUTHORS, '#d': dTags, limit: DATE_LOAD_LIMIT },
    ]
    // No author filter on the ANSWERS, on purpose: an RSVP is everyone's to write, and
    // restricting it to the known authors would count nobody but the Portal.
    const answerFilters: Filter[] = [{ kinds: [CALENDAR_RSVP], '#a': addresses, limit: RSVP_LOAD_LIMIT }]

    unsubDates?.()
    unsubRsvps?.()
    void load({ relays: CALENDAR_RELAYS, filters: dateFilters })
    void load({ relays: CALENDAR_RELAYS, filters: answerFilters })
    unsubDates = deriveEventsForUrls(CALENDAR_RELAYS, dateFilters).subscribe((events: TrustedEvent[]) => {
        dates = events
        render()
    })
    unsubRsvps = deriveEventsForUrls(CALENDAR_RELAYS, answerFilters).subscribe((events: TrustedEvent[]) => {
        answers = events
        render()
    })
}

/** Register one or more coordinates. Called from Blade and from the Start island. */
const trackAddresses = (addresses: unknown): void => {
    const list = Array.isArray(addresses) ? addresses : [addresses]
    let neu = false
    for (const raw of list) {
        const address = typeof raw === 'string' ? raw.trim() : ''
        // Anything unparseable is DROPPED and never reaches a filter: `{"#d":[""]}` is a
        // query for everything nobody tagged, not a query for nothing.
        if (address === '' || parseCalendarAddress(address) === null || tracked.has(address)) {
            continue
        }
        tracked.add(address)
        neu = true
    }
    if (neu) {
        arm()
    }
}

const veroeffentlichen = async (address: string, status: RsvpStatus): Promise<void> => {
    const self = get(pubkey) ?? ''
    // Re-decided HERE and not taken from the row: between the tap and this line the Portal
    // may have re-published the date as cancelled, and a row is a snapshot.
    const { event } = rsvpTargetFor({
        events: dates,
        address,
        authors: CALENDAR_AUTHORS,
        nowSeconds: Math.floor(Date.now() / 1000),
    })
    if (event === null || self === '') {
        return
    }

    writeRow(address, { busy: true, error: '', partial: null })
    try {
        // The last argument is the `created_at` of the answer this one replaces: two answers
        // inside the same second would otherwise tie, and NIP-01 keeps the OLD one
        // (`calendarModels.rsvpCreatedAt` — measured in this phase's E2E run).
        const outcome = await publishRsvp(
            CALENDAR_RELAYS, self, event, status, ownRsvpAt(answers, address, self),
        )

        writeRow(address, {
            busy: false,
            error: outcome.error,
            partial: outcome.delivered.length > 0 && outcome.failed.length > 0
                ? { delivered: outcome.delivered, failed: outcome.failed }
                : null,
        })
    } finally {
        // A throw out of the publish path must not leave the buttons disabled for good — the
        // measured failure class of `verein.ts` (`busy` stuck, no error, no way out but a
        // reload).
        if (rowOf(address).busy) {
            writeRow(address, { busy: false })
        }
    }
}

export function wireRsvpTermine(Alpine: {
    data: (name: string, factory: (...args: unknown[]) => unknown) => void
    store: (name: string, value?: unknown) => unknown
}): void {
    Alpine.data('nostrNaechsterTermin', createNaechsterTermin as (...args: unknown[]) => unknown)

    if (Alpine.store('rsvpTermine')) {
        return
    }

    const store: RsvpTermineStore = {
        angemeldet: false,
        hinweisOffen: !readAck(),
        wartet: null,
        rows: {},
        track(addresses: unknown): void {
            trackAddresses(addresses)
        },
        row(address: string): RsvpRow {
            return this.rows[address] ?? LEER
        },
        rsvp(address: string, status: RsvpStatus): void {
            const row = this.row(address)
            if (!row.offen || row.busy) {
                return
            }
            if (this.hinweisOffen) {
                // The answer WAITS behind the sentence, and the same tap carries it out once
                // the sentence is acknowledged — nobody presses twice for one intent.
                this.wartet = { address, status }

                return
            }
            void veroeffentlichen(address, status)
        },
        hinweisBestaetigen(): void {
            const wartet = this.wartet
            writeAck()
            this.hinweisOffen = false
            this.wartet = null
            if (wartet) {
                void veroeffentlichen(wartet.address, wartet.status)
            }
        },
        hinweisAbbrechen(): void {
            // The disclosure stays owed: whoever backed out has not agreed to anything.
            this.wartet = null
        },
        dismiss(address: string): void {
            writeRow(address, { error: '', partial: null })
        },
        partialLabel(address: string): string {
            const partial = this.row(address).partial
            if (!partial) {
                return ''
            }

            // The same sentence as the room's date card — one wording for one fact.
            return t('Zusage liegt auf :ok, nicht auf :fehlt.', {
                ok: partial.delivered.map(displayRelay).join(', '),
                fehlt: partial.failed.map(displayRelay).join(', '),
            })
        },
    }

    Alpine.store('rsvpTermine', store)
    // From here only the reactive proxy is written — same reason and same shape as
    // `wirePinSet`/`wireBookmarks`: a closure mutating the raw object changes values Alpine
    // never hears about.
    reactive = Alpine.store('rsvpTermine') as RsvpTermineStore

    pubkey.subscribe(() => {
        // An identity change makes every own-answer statement wrong; the queries stay, the
        // fold is redone (`ownRsvpStatus` reads the new key).
        render()
    })
}

// ── The next date on Start (P5) ────────────────────────────────────────────────────────

/** The slugs of the meetups the reader PINNED (D7) — the `meetup:<slug>` keys of the set. */
const pinnedMeetupSlugs: Readable<string[]> = derived(pinnedKeys, ($keys) =>
    $keys
        .filter((key) => key.startsWith('meetup:'))
        .map((key) => key.slice('meetup:'.length))
        .filter((slug) => slug !== ''))

/**
 * The slugs of the meetups whose ROOM the reader joined.
 *
 * `userRooms` and not every room of the space: being in the space is not a relation to a
 * meetup, having joined its room is. The slug comes off the 39000 through `SpaceView`, which
 * resolves it against the Portal list — the same join the meetup tile uses.
 */
const joinedMeetupSlugs: Readable<string[]> = derived(activeSpaceView, ($space) =>
    $space.userRooms.map((room) => room.meetupSlug).filter((slug) => typeof slug === 'string' && slug !== ''))

type PortalIndexModul = typeof import('./portalIndex.ts')

let portalModul: PortalIndexModul | null = null
let indexRows: Parameters<PortalIndexModul['answerableDates']>[0] = []

/**
 * `nostrNaechsterTermin` — the one upcoming date on Start the reader has a relation to,
 * together with its answer.
 *
 * ── Where the data comes from, and why not from the server ───────────────────────────
 * Start holds NO server state (D4: it renders for guest and member alike and decides the
 * difference in its own island with a skeleton). The two halves of „a date the reader has a
 * relation to" are not available on the server either: the pinned meetups live in a NIP-44
 * blob only the browser can read (D7), and the joined rooms are relay state.
 *
 * So the dates come from the index the palette already loads once per session
 * (`/suche/portal-index`, strong ETag, `max-age=300`) — the SAME module and the same cache,
 * so opening ⌘K after Start costs no second request. The module arrives through `import()`:
 * `bridge.ts` is in the boot path of every page and the index filter has no business there.
 *
 * ── Why the list is narrowed ──────────────────────────────────────────────────────────
 * „The next date of the whole association" is a row nobody acts on — it is a stranger's
 * meetup 600 km away. Pinned meetups and joined rooms are the two statements the reader has
 * already made about which meetups are his. Neither present: the row does not appear, and
 * nothing invites a public, permanent answer to a date he has no relation to.
 */
type NaechsterTerminState = {
    /** '' while there is nothing to show — the markup gates the whole row on it. */
    address: string
    name: string
    /** The date in the active language, ready to print. '' when there is no row. */
    dateLabel: string
    href: string
    /** Venue or city, whichever the index row carries. */
    location: string
    _unsub: (() => void)[]
    init(): void
    destroy(): void
    _recompute(): void
}

/**
 * `Y-m-d H:i` → Unix seconds, read as LOCAL wall-clock time.
 *
 * The index carries the Portal's own strings and they name no zone; `new Date('2026-09-18
 * 19:00')` is implementation-defined, so the `T` is inserted — that is the ISO local-time
 * form every engine parses the same way. 0 for anything unparseable: a row printing
 * 1 Jan 1970 would read exactly like a correct one (the same rule as `httpDateSeconds` in
 * `calendar.ts`).
 */
const indexDateSeconds = (value: string): number => {
    if (value === '') {
        return 0
    }
    const ms = new Date(value.replace(' ', 'T')).getTime()

    return Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 1000) : 0
}

const createNaechsterTermin = (): NaechsterTerminState => ({
    address: '',
    name: '',
    dateLabel: '',
    href: '',
    location: '',
    _unsub: [],

    init(): void {
        void import('./portalIndex.ts')
            .then(async (modul) => {
                const index = await modul.loadPortalIndex()
                portalModul = modul
                indexRows = index.rows
                this._recompute()
            })
            .catch(() => {
                // Fail-soft, like the palette: without the Portal this row does not appear. A
                // rejected `import()` would be an unhandled rejection on every Start.
            })

        // Both sources change AFTER boot: the pin set arrives from the relays (D7) and the
        // room list from the space. Without these subscriptions the row would be decided once,
        // during the warm-render race — the measured „snapshot read once" failure class.
        this._unsub.push(pinnedMeetupSlugs.subscribe(() => this._recompute()))
        this._unsub.push(joinedMeetupSlugs.subscribe(() => this._recompute()))
    },

    destroy(): void {
        for (const off of this._unsub) {
            off()
        }
        this._unsub = []
    },

    _recompute(): void {
        if (portalModul === null) {
            return
        }
        const slugs = Array.from(new Set([...get(pinnedMeetupSlugs), ...get(joinedMeetupSlugs)]))
        const hit = portalModul.answerableDates(indexRows, slugs, portalModul.nowIndexKey(), 1)[0] ?? null

        const seconds = indexDateSeconds(hit?.d ?? '')

        this.address = hit?.a ?? ''
        this.name = hit?.n ?? ''
        this.dateLabel = seconds > 0
            ? formatTimestamp(seconds, {
                weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
            })
            : ''
        this.location = hit?.s ?? ''
        this.href = hit ? `/bereich/meetups/${encodeURIComponent(hit.r)}` : ''

        if (this.address !== '') {
            trackAddresses(this.address)
        }
    },
})
