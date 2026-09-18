/**
 * WHERE a kind 31925 goes — the one publish path of every RSVP surface (D12, P5).
 *
 * ── The relay set, and why it has two halves ─────────────────────────────────────────
 *
 * 1. **The calendar relays** (`NOSTR_CALENDAR_RELAYS` — nos.lol, relay.damus.io in
 *    production). That is where the Portal publishes its dates and where its ingest
 *    (`nostr:ingest-rsvps`, P1) looks for the answers. An RSVP that misses them is not
 *    counted by anybody.
 * 2. **The user's own NIP-65 write relays.** An answer is a statement the person made, and
 *    it belongs where their other statements are: their own client on another device finds
 *    it there, and so does anybody who follows them. Without this half the answer exists
 *    only on two relays the user never chose — and if the Portal ever rotates its relay
 *    list, their own history of „I was there" stays behind.
 *
 * The union is deduplicated and the order is calendar-first, because that is the half the
 * count depends on and `Thunks.publish` starts them in list order.
 *
 * ── Why the relays are an ARGUMENT and not read here ─────────────────────────────────
 * `calendar.ts` (the room's date card) already owns the two configuration constants and is
 * imported statically by `bridge.ts`. Reading them here would mean importing that island
 * from the module the island itself imports — a cycle Vite resolves by handing one side an
 * undefined binding at evaluation, which shows up as „the relay list is empty" on one
 * surface and nowhere else. The caller passes what it has.
 */
import { makeEvent, normalizeRelayUrl } from '@welshman/util'
import { RelayLists } from '@welshman/app'
import { CALENDAR_RSVP } from './welshmanKinds.ts'
import { app } from './welshmanInstance.ts'
import { publishSpreadOptimistic } from './publishOptimistic.ts'
import { makeRsvpTags, rsvpCreatedAt, type CalendarSourceEvent, type RsvpStatus } from './calendarModels.ts'

/**
 * The declared write relays of `self`, read off the `RelayLists` projection.
 *
 * NOT through the router scenario, same reason and same shape as `pinSetSync.pinRelayTargets`:
 * the scenario ranks and can drop a relay whose live quality has fallen to zero. For a
 * personal statement the DECLARED set is the right one — the user said "my events live
 * here", and a temporarily unreachable relay is a failure to report, not a target to hide.
 *
 * Empty without a session: a guest has no key, hence no answer to publish.
 */
export const ownWriteRelays = (self: string): string[] =>
    self ? app.use(RelayLists).writeUrls(self).get().map((url: string) => normalizeRelayUrl(url)) : []

/**
 * The full target set of one RSVP: calendar relays first, then the user's own.
 *
 * Deduplicated after normalisation — `wss://nos.lol` and `wss://nos.lol/` are one relay,
 * and publishing twice to it would report one of the two as a duplicate and muddy the
 * partial-result line.
 */
export const rsvpRelayTargets = (calendarRelays: readonly string[], self: string): string[] => {
    const urls = [
        ...calendarRelays.map((url) => normalizeRelayUrl(url)),
        ...ownWriteRelays(self),
    ]

    return Array.from(new Set(urls.filter((url) => url !== '')))
}

export type RsvpOutcome = {
    /** Verbatim relay rejection. '' when at least one relay took the event. */
    error: string
    delivered: string[]
    failed: string[]
}

/**
 * Sign and publish the answer, and report what became of it.
 *
 * Three outcomes, not two, and the middle one is the ordinary case — the reasoning is
 * `calendar.ts rsvp()` and it has not changed: with two or more relays a PARTIAL result is
 * normal (measured 2026-09-05: `relay.damus.io` answered 5 of 8 attempts with `503` while
 * `nos.lol` took the same event), the answer IS public on the relays that took it, and
 * rolling it back locally would show the user a state the world does not share.
 *
 * `publishSpreadOptimistic` puts the event into the repository before any relay has spoken,
 * so the count and the button state move without a round trip, and rolls it back only when
 * NOTHING landed.
 */
export const publishRsvp = async (
    calendarRelays: readonly string[],
    self: string,
    event: CalendarSourceEvent,
    status: RsvpStatus,
    /**
     * `created_at` of the own answer this one REPLACES, 0 when there is none
     * (`calendarModels.ownRsvpAt`). Passing it is what keeps a changed answer from tying
     * with the one before it — reasoning in {@link rsvpCreatedAt}.
     */
    replacedAt = 0,
): Promise<RsvpOutcome> => {
    const targets = rsvpRelayTargets(calendarRelays, self)
    if (targets.length === 0) {
        // Not an exception: an install without calendar relays shows no RSVP button at all
        // (`calendarConfigured`), so this is the impossible case — and an empty `delivered`
        // is the shape the caller already handles.
        return { error: '', delivered: [], failed: [] }
    }

    const outcome = await publishSpreadOptimistic(
        targets,
        makeEvent(CALENDAR_RSVP, {
            tags: makeRsvpTags(event, status),
            created_at: rsvpCreatedAt(Math.floor(Date.now() / 1000), replacedAt),
        }),
    )

    return { error: outcome.delivered.length === 0 ? outcome.error : '', delivered: outcome.delivered, failed: outcome.failed }
}
