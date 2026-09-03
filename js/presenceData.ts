/**
 * Presence (kind 20001, Buzz) — the **pure** half: parse a status event, decide who is
 * still present, and decide whether it is time to say so again. No network, no store, no
 * welshman, no clock; everything time-related arrives as a parameter, which is why
 * `presenceData.test.ts` runs under `node --test` without a relay and without real
 * seconds. The impure half (subscription, heartbeat, teardown) is `presence.ts`.
 *
 * ── Presence has no backlog, and that shapes everything here ─────────────────────
 *
 * 20001 is ephemeral: the relay never stores it. A REQ answers with EOSE and **zero**
 * events, after which only live deltas arrive (`buzz-relay/src/handlers/event.rs`,
 * `handle_ephemeral_event` — presence is published to the global topic and fanned out,
 * never written to the database). So a client learns about a peer only when that peer
 * next sends a heartbeat.
 *
 * Two consequences, both deliberate:
 *
 *  1. **There is no "offline" to render.** "Nobody told us anything about this pubkey"
 *     and "this pubkey is away from the keyboard" are the same observation for the first
 *     {@link PRESENCE_TTL_SECS} of a session, and the surface must not turn the first
 *     into the second. {@link foldPresence} therefore returns only pubkeys that are
 *     *positively* present; everyone else is simply absent from the map, and the markup
 *     renders nothing for them. A grey "offline" dot would be a claim we cannot make.
 *  2. **The client keeps its own TTL.** The relay's presence entry lives in Redis with
 *     `EX 180` (`buzz-pubsub/src/presence.rs`), but that TTL is invisible from here — no
 *     event is sent when it lapses. So the same 180 s is applied locally to the last
 *     event we saw. See {@link PRESENCE_TTL_SECS} for where the boundary sits.
 *
 * ── The subject is the author, never a `p` tag ──────────────────────────────────
 *
 * A live 20001 is self-signed and says something about **its own author**. Buzz Desktop
 * writes the same rule out at `desktop/src/features/presence/lib/presence.ts`: *"A p tag
 * is NOT trusted here — a client could forge one to spoof another user."* The relay does
 * the same (`handle_ephemeral_event` keys Redis by `auth_pubkey`, not by a tag). This
 * module therefore never reads tags at all.
 *
 * ── Unknown status strings are dropped, not guessed ─────────────────────────────
 *
 * The WebSocket path accepts an arbitrary content string for forward compatibility
 * (`buzz-core/src/presence.rs`: *"The WebSocket path (kind:20001) accepts arbitrary
 * status strings … this enum is the curated set for structured APIs"*), so a future
 * client may well send something we have never heard of. Rendering an unknown status as
 * "online" would be inventing information; {@link parsePresenceEvent} returns `null` for
 * it, exactly as Buzz Desktop's `parseLivePresenceEvent` does.
 */
import { mayWriteKind } from './relayCapability.ts'
import type { SpaceKind } from './spaceCaps.ts'

/** `KIND_PRESENCE_UPDATE` (`buzz-core/src/kind.rs`). Ephemeral: `20000 ≤ kind < 30000`. */
export const PRESENCE_UPDATE = 20001

/**
 * The three statuses the curated Buzz enum defines (`buzz-core/src/presence.rs`).
 * `'offline'` is a **command**, not a state: the relay deletes the presence entry when it
 * sees it, and this module drops the pubkey from the table for the same reason.
 */
export type PresenceStatus = 'online' | 'away' | 'offline'

/** What a surface can actually draw. `'offline'` is never one of these — see the header. */
export type PresenceState = 'online' | 'away'

/** The piece of an event this module needs. Structural on purpose: no welshman types. */
export type PresenceEventLike = {
    id?: string
    kind?: number
    pubkey: string
    created_at: number
    content: string
}

/** One parsed 20001, before TTL and winner selection have had their say. */
export type ParsedPresence = {
    pubkey: string
    /** Event id, used only as the tie-break of a `created_at` draw; `''` if absent. */
    id: string
    status: PresenceStatus
    updatedAt: number
}

/** A 20001 ready to sign. Only {@link planPresence} produces one. */
export type PresencePlan = {
    kind: typeof PRESENCE_UPDATE
    content: PresenceStatus
    tags: string[][]
}

/**
 * How long a presence entry stays valid without a fresh heartbeat: **180 s**, the same
 * value the relay puts on its Redis key (`PRESENCE_TTL_SECS`, `buzz-pubsub/src/presence.rs`)
 * and the same one Buzz Desktop keeps locally (`PRESENCE_TTL_SECONDS = 3 × heartbeat`).
 * Three heartbeats, so a single lost frame does not make the dot flicker.
 *
 * **The boundary is exclusive, and that is a decision, not an accident.** An entry is
 * fresh while `now - updatedAt < 180`; at exactly 180 it is gone. That mirrors Redis:
 * `EX 180` means the key is no longer readable once 180 s have elapsed, so at the very
 * second where the relay would stop reporting the user, we stop too. Erring the other way
 * would show a dot the relay itself no longer backs.
 */
export const PRESENCE_TTL_SECS = 180

/**
 * How often we say we are still here: **45 s**.
 *
 * The relay's TTL is fixed at 180 s and is not negotiable from the client, so the beat has
 * to be well inside a third of it. Buzz Desktop uses exactly 60 s and therefore tolerates
 * two lost frames; 45 s tolerates three, and the extra cost is one WebSocket frame every
 * 45 s — against the relay's budget of **50 frames per 5 s per pubkey**
 * (`human_ws_events_per_sec × 5`, `buzz-relay/src/admission.rs`) that is 0.11 frames per
 * window. The margin matters because a hidden browser tab has its timers throttled to
 * roughly one call per minute; at 45 s nominal we still beat well inside the TTL there.
 */
export const PRESENCE_HEARTBEAT_MS = 45_000

/**
 * The one timer the impure half runs on: **15 s**. It carries three jobs at once — let
 * stale entries expire, decide whether the heartbeat is due, and re-arm the subscription
 * when its turn comes.
 *
 * It lives in the pure module because it is half of an arithmetic promise, not a
 * scheduling detail: a beat becomes due at {@link PRESENCE_HEARTBEAT_MS} and goes out at
 * the following tick, so the worst case between two beats is `heartbeat + tick` = **60 s
 * exactly**. That sum is what `presenceData.test.ts` asserts, and it is the bound the
 * relay's 180 s TTL is measured against — a tick raised without lowering the beat would
 * silently push the gap past the promise.
 */
export const PRESENCE_TICK_MS = 15_000

/**
 * How far into the future a `created_at` may sit before the event is ignored: **120 s**.
 *
 * The ephemeral path does **not** run the ±900 s drift check that `ingest_event` applies
 * to stored events (`handle_ephemeral_event` verifies the signature and nothing else), so
 * a peer can legally hand us a presence event stamped next year. Without this bound such
 * an event would never age out of {@link isPresenceFresh} and would pin a dot on that
 * pubkey forever. Two minutes covers ordinary clock skew between two machines and nothing
 * beyond it.
 */
export const PRESENCE_MAX_SKEW_SECS = 120

const HEX64 = /^[0-9a-f]{64}$/

const isStatus = (value: string): value is PresenceStatus =>
    value === 'online' || value === 'away' || value === 'offline'

/**
 * One event → {@link ParsedPresence}, or `null` if it is not a presence statement we
 * understand.
 *
 * The kind is re-checked although the filter already restricts it: this module is fed
 * from a raw `request({onEvent})` that bypasses the repository (ephemeral events never
 * reach it, `welshmanInstance.ts`), so there is no second gate behind this one.
 */
export const parsePresenceEvent = (event: PresenceEventLike): ParsedPresence | null => {
    if (!event || typeof event.pubkey !== 'string' || !HEX64.test(event.pubkey)) {
        return null
    }
    if (event.kind !== undefined && event.kind !== PRESENCE_UPDATE) {
        return null
    }
    if (typeof event.created_at !== 'number' || !Number.isFinite(event.created_at)) {
        return null
    }
    const status = typeof event.content === 'string' ? event.content.trim() : ''
    if (!isStatus(status)) {
        return null
    }

    return {
        pubkey: event.pubkey,
        id: typeof event.id === 'string' ? event.id : '',
        status,
        updatedAt: Math.floor(event.created_at),
    }
}

/**
 * Is a presence statement of this age still worth showing?
 *
 * Two bounds, and the failure direction of both is "show nothing":
 *
 *  - **too old — exclusive.** Fresh while `now - updatedAt < ttl`; at exactly the TTL the
 *    entry is gone, because at exactly that second the relay's Redis key is gone too.
 *  - **too far ahead — inclusive.** A stamp up to and including
 *    {@link PRESENCE_MAX_SKEW_SECS} in the future is accepted as clock skew; one second
 *    beyond it is not accepted at all.
 */
export const isPresenceFresh = (updatedAt: number, now: number, ttlSecs = PRESENCE_TTL_SECS): boolean => {
    const age = now - updatedAt
    if (age < 0) {
        return -age <= PRESENCE_MAX_SKEW_SECS
    }

    return age < ttlSecs
}

/** Does `next` replace `best`? Newest wins; on a draw the lexicographically smaller id. */
const replaces = (next: ParsedPresence, best: ParsedPresence): boolean =>
    next.updatedAt > best.updatedAt || (next.updatedAt === best.updatedAt && next.id < best.id)

/**
 * The presence table: `pubkey → 'online' | 'away'`. Absent means **no statement**, never
 * "offline" (see the module header).
 *
 * `now` comes from the caller; this module owns no clock. The order of the input is
 * irrelevant — the winner is picked by `created_at`, not by arrival, because a relay
 * replays and reorders as it pleases and a fold over "last one wins" would let a dot flip
 * back and forth on a reconnect.
 */
export const foldPresence = (
    events: readonly PresenceEventLike[],
    now: number,
    ttlSecs = PRESENCE_TTL_SECS,
): Map<string, PresenceState> => {
    const winners = new Map<string, ParsedPresence>()
    for (const event of events) {
        const parsed = parsePresenceEvent(event)
        if (!parsed) {
            continue
        }
        const best = winners.get(parsed.pubkey)
        if (!best || replaces(parsed, best)) {
            winners.set(parsed.pubkey, parsed)
        }
    }

    const out = new Map<string, PresenceState>()
    for (const [pubkey, winner] of winners) {
        // `'offline'` drops out here rather than in the parser: it has to be able to beat
        // an older `'online'` of the same pubkey first, otherwise a user who just left
        // would keep the dot until the TTL ran out.
        if (winner.status !== 'offline' && isPresenceFresh(winner.updatedAt, now, ttlSecs)) {
            out.set(pubkey, winner.status)
        }
    }

    return out
}

/**
 * A stable string for "has the visible table changed?" — the store writes into an Alpine
 * proxy, and assigning a freshly built object on every tick would invalidate every chat
 * row's binding once per tick for no reason.
 */
export const presenceFingerprint = (table: ReadonlyMap<string, PresenceState>): string =>
    [...table]
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([pubkey, state]) => `${pubkey}:${state}`)
        .join(',')

/**
 * **The gate and the event body in one decision.** `null` means: do not write.
 *
 * The same construction as `planReminder` (`reminderModels.ts`), `planTimeout`,
 * `planForumVote` and `planBookmarkWrite`, and for the same reason: the promise is that
 * `mayWriteKind` is asked *before* signing, and a gate call whose result is dropped looks
 * exactly like one that is honoured. Here the gate's answer decides whether there is
 * anything to publish at all.
 *
 * 20001 is `relay: 'buzz'` in the table. On zooid the kind would not be ephemeral in any
 * useful sense: zooid has no kind allowlist, and a presence event that carries no `h` tag
 * is stored as an ordinary event that nobody reads and nobody collects
 * (`relayCapability.ts` writes that out in full). `'unknown'` — the state while the
 * NIP-11 doc is in flight — denies as well.
 *
 * **No tags at all.** Presence is channel-less on purpose: `handle_ephemeral_event` routes
 * an ephemeral event with an `h` tag to that channel's subscribers and one without it to
 * the global topic, and presence is a statement about a person, not about a room. Buzz
 * Desktop sends `tags: []` here too (`relayClientSession.ts`). The 128-byte content cap
 * the relay applies is irrelevant for a status of at most seven characters.
 */
export const planPresence = (status: PresenceStatus, spaceKind: SpaceKind): PresencePlan | null =>
    mayWriteKind(PRESENCE_UPDATE, spaceKind) ? { kind: PRESENCE_UPDATE, content: status, tags: [] } : null

/**
 * May this space be READ for presence at all?
 *
 * The counterpart of {@link planPresence}, and three-valued for the same reason. `'buzz'`
 * is the only answer that opens a subscription: on a non-Buzz relay a 20001 means nothing,
 * and while the NIP-11 doc is still in flight (`'unknown'`) the honest surface is an empty
 * one — **no dot, not a grey dot**. A client that decided in that state would be showing
 * "nobody is here" as a fact one tick after every page load.
 */
export const mayReadPresence = (spaceKind: SpaceKind): boolean => spaceKind === 'buzz'

/** What the last write was, as {@link shouldSendPresence} needs to see it. */
export type PresenceSend = { status: PresenceStatus; atMs: number }

/**
 * Is it time to publish presence again?
 *
 * Two reasons, and only two: the state changed (say so at once — that is what makes the
 * dot move), or the last statement is a heartbeat old (say so again — otherwise the relay
 * drops us at 180 s and the peers' TTL does the same).
 *
 * The interval boundary is **inclusive**: at exactly {@link PRESENCE_HEARTBEAT_MS} the
 * beat is due. The caller ticks on a coarser timer than the interval, so the real gap is
 * "one tick or less after 45 s" — which is what keeps the promise "the heartbeat fires at
 * most every 60 s" true even under a browser's background timer throttling.
 */
export const shouldSendPresence = (
    last: PresenceSend | null,
    desired: PresenceStatus,
    nowMs: number,
    beatMs = PRESENCE_HEARTBEAT_MS,
): boolean => {
    if (last === null) {
        return true
    }
    if (last.status !== desired) {
        return true
    }
    // A clock that jumped backwards (system time change, suspended laptop) must not park
    // the heartbeat: anything that is not a plausible "recently sent" is a reason to send.
    if (nowMs < last.atMs) {
        return true
    }

    return nowMs - last.atMs >= beatMs
}
