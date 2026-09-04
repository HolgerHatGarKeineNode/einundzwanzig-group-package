/**
 * The timed suspension of a member (Buzz kinds 9042/9043) — the pure half.
 *
 * Counterpart to `buzzAdmin.ts` (signer, relay, HTTP). Browser-free and store-free like
 * `forumVoteModels.ts` and `bookmarkModels.ts`, so every rule below is decidable under
 * `node --test`. Relative imports carry the `.ts` extension: the file has to load from
 * Vite **and** from the node test runner.
 *
 * ══ Why this surface has a timeout and nothing harsher ══════════════════════════
 *
 * A product decision of the association, not a technical one, taken 2026-09-03 and
 * quoted verbatim in `docs/plans/2026-09-03T1915-buzz-kind-ernte.md`: *„Wir entfernen
 * und bannen keine Mitglieder, sondern machen höchstens Timeout, welchen man einstellen
 * kann."* The timed suspension is therefore the strongest measure the client offers —
 * there is no escalation step above it, and the removal/ban entries that used to sit
 * next to it are commented out with that same reason — six comment blocks holding seven
 * elements, across four files (`moderationSurfaceGate.ts` names them and guards them).
 *
 * ══ The event shape, read off the producer ══════════════════════════════════════
 *
 * `crates/buzz-relay/src/handlers/moderation_commands.rs`, module header, verbatim:
 *
 * > - 9040 ban: `["p", <hex pubkey>]` required; optional
 * >   `["expiration", <unix secs>]` (absent ⇒ permanent), `["reason", <text>]`.
 * > - 9042 timeout: `["p", <hex pubkey>]` + required `["expiration", <unix secs>]`;
 * >   optional `["reason", <text>]`.
 * > - 9043 untimeout: `["p", <hex pubkey>]`.
 *
 * **The whole decision rests on that one difference.** 9040 without `expiration` is
 * permanent; 9042 refuses to exist without it (`handle_timeout`:
 * `extract_expiration(event)?.ok_or_else(|| invalid("timeout requires an expiration
 * tag"))?`). So a 9042 whose expiration is missing or unusable is not built here at all —
 * {@link buildTimeoutTags} answers `null`, and the planner passes that on. A builder that
 * emitted the event and let the relay refuse it would spend a signature prompt on the
 * user's signing device for a command that cannot work.
 *
 * ── Three properties of the relay side that shape the code, each measured ────────
 *
 * 1. **±120 s freshness.** `MAX_COMMAND_SKEW_SECS = 120` in the same file — a quarter of
 *    the usual ±900 s. The command is therefore never prepared and stored; `now` is a
 *    parameter here and the caller passes the second in which it publishes. Same rule the
 *    9030-series already follows (`buzzAdmin.ts` module header, fallstrick 1).
 * 2. **9042–9044 are never readable.** The relay executes and drops them; it neither
 *    stores nor fans them out. Success is read back from `GET /moderation/restricted`
 *    (and `/moderation/audit`) — which is why the response parser lives in this module
 *    too: the list is the only proof the write worked.
 * 3. **`expiration` is parsed as a plain i64 of seconds** (`extract_expiration`), with no
 *    "must be in the future" check. A value in the past is accepted and expires
 *    immediately — a silent no-op. {@link expirationFrom} is what keeps that out.
 */
import { mayWriteKind } from './relayCapability.ts'
import type { SpaceKind } from './spaceCaps.ts'

/**
 * Buzz: suspend a pubkey until a given time (`KIND_MODERATION_TIMEOUT`,
 * `buzz-core/src/kind.rs:363`).
 *
 * The constant lives in this pure module and not next to the other Buzz kinds in
 * `buzzAdmin.ts`, for the reason `FORUM_VOTE` lives in `forumModels.ts`: `buzzAdmin.ts`
 * imports welshman and cannot be loaded by the node test runner, and a gate whose kind
 * number is unreachable from a test is a gate nobody can check.
 */
export const BUZZ_TIMEOUT = 9042

/** Buzz: lift a timed suspension (`KIND_MODERATION_UNTIMEOUT`, `kind.rs:365`). */
export const BUZZ_UNTIMEOUT = 9043

/** A planned 9042 — kind pinned by the type, so it cannot be sent down the 9043 path. */
export type TimeoutCommand = { kind: typeof BUZZ_TIMEOUT; tags: string[][] }

/** A planned 9043. */
export type UntimeoutCommand = { kind: typeof BUZZ_UNTIMEOUT; tags: string[][] }

/**
 * Upper bound of a suspension: one year.
 *
 * Not a relay rule — the relay takes any i64 — but a client one, and deliberately the
 * same horizon Buzz uses for the only other future timestamp it schedules
 * (`limitation.max_not_before_delta: 31536000`, measured against production
 * 2026-09-03). A suspension longer than that is a ban under another name, and this
 * surface does not do bans.
 */
export const MAX_TIMEOUT_SECONDS = 365 * 24 * 60 * 60

/** 64 lowercase hex — the form `extract_p_tag_bytes` accepts. */
const isPubkey = (value: string): boolean => /^[0-9a-f]{64}$/.test(value)

/**
 * `now + duration`, or `null` when the result would not be a usable `expiration`.
 *
 * `now` is a **parameter, not a reading of the wall clock** — the house rule for every
 * TTL rule in this package (`js/storagePersistKinds.test.ts` states it), and the only way
 * this function is testable without a flake.
 *
 * Refused, each for its own reason:
 *  - a non-integer or non-positive `now` — nothing sensible can be added to it;
 *  - a duration ≤ 0 — the relay would accept the resulting past timestamp and the
 *    suspension would end before it began (see property 3 in the module header);
 *  - a duration beyond {@link MAX_TIMEOUT_SECONDS}.
 */
export const expirationFrom = (nowSecs: number, durationSecs: number): number | null => {
    if (!Number.isSafeInteger(nowSecs) || nowSecs <= 0) {
        return null
    }
    if (!Number.isSafeInteger(durationSecs) || durationSecs <= 0 || durationSecs > MAX_TIMEOUT_SECONDS) {
        return null
    }

    return nowSecs + durationSecs
}

/**
 * The tags of a 9042 — **`p` first, then the mandatory `expiration`**, optionally
 * `reason`. `null` when either mandatory part is unusable.
 *
 * This is the single place a 9042 body is assembled, and that is the point: the promise
 * "no 9042 without an expiration" is a property of one function, not of every caller.
 */
export const buildTimeoutTags = (pubkey: string, expiration: number, reason = ''): string[][] | null => {
    if (!isPubkey(pubkey)) {
        return null
    }
    if (!Number.isSafeInteger(expiration) || expiration <= 0) {
        return null
    }
    const tags = [
        ['p', pubkey],
        ['expiration', String(expiration)],
    ]
    const trimmed = reason.trim()

    return trimmed ? [...tags, ['reason', trimmed]] : tags
}

/** The tags of a 9043 — one `p`, nothing else. `null` for a malformed pubkey. */
export const buildUntimeoutTags = (pubkey: string): string[][] | null =>
    isPubkey(pubkey) ? [['p', pubkey]] : null

/**
 * **The gate and the event body in one decision.** `null` means: do not write.
 *
 * The same construction as `planForumVote` (`forumVoteModels.ts`) and `planBookmarkWrite`
 * (`bookmarkModels.ts`), and for the same reason: the phase's promise is that
 * `mayWriteKind` is asked *before* signing, and a gate call whose result is dropped looks
 * exactly like one that is honoured. Here the gate's answer decides whether an event body
 * exists at all, so a caller that publishes without asking has nothing to publish.
 *
 * For 9042 the gate answers `relay: 'buzz'`. On zooid the kind is meaningless in the
 * worst possible way: zooid has no kind allowlist, so it would **store** the command as a
 * permanent, unreadable event and suspend nobody (`relayCapability.ts` writes that out in
 * full). `'unknown'` — the state while the NIP-11 doc is in flight — denies as well.
 */
export const planTimeout = (
    pubkey: string,
    durationSecs: number,
    nowSecs: number,
    spaceKind: SpaceKind,
    reason = '',
): TimeoutCommand | null => {
    if (!mayWriteKind(BUZZ_TIMEOUT, spaceKind)) {
        return null
    }
    const expiration = expirationFrom(nowSecs, durationSecs)
    if (expiration === null) {
        return null
    }
    const tags = buildTimeoutTags(pubkey, expiration, reason)

    return tags ? { kind: BUZZ_TIMEOUT, tags } : null
}

/**
 * The same decision for lifting a suspension (9043).
 *
 * Gated on its own kind and not on 9042's: the two are separate entries in
 * `WRITE_RULES`, and a surface that may not suspend might still have to lift what an
 * older client left behind.
 */
export const planUntimeout = (pubkey: string, spaceKind: SpaceKind): UntimeoutCommand | null => {
    if (!mayWriteKind(BUZZ_UNTIMEOUT, spaceKind)) {
        return null
    }
    const tags = buildUntimeoutTags(pubkey)

    return tags ? { kind: BUZZ_UNTIMEOUT, tags } : null
}

// ── Reading the restrictions back ────────────────────────────────────────────────
//
// `GET /moderation/restricted` is the only way to see that a 9042 took effect, because
// the command itself is never stored (property 2 in the module header). The response is
// a bare JSON array of `ban_json` rows (`api/bridge.rs`):
//
//     {"pubkey": <hex>, "banned": <bool>, "ban_expires_at": <rfc3339|null>,
//      "ban_reason": <string|null>, "muted_until": <rfc3339|null>,
//      "mute_reason": <string|null>, "actor_pubkey": <hex>, "updated_at": <rfc3339>}
//
// and the SQL behind it (`buzz-db` `list_restricted`) returns exactly the rows that are
// restricted **right now**: an active ban, or `muted_until > now()`. So a row without an
// active ban is a running timeout — that is what makes the `kind` field below decidable
// from the row alone, without a second clock.

/** One restricted member, in the client's own vocabulary. */
export type RestrictionEntry = {
    pubkey: string
    /** `true` = an active ban (from an older client or another tool); `false` = a timeout. */
    banned: boolean
    /** End of the timed suspension as a **unix second**, or `null` when there is none. */
    mutedUntil: number | null
    /** The moderator's wording — the ban reason for a ban, the mute reason for a timeout. */
    reason: string
}

/**
 * Why a restriction list could not be read.
 *
 * `'forbidden'` and `'unauthorized'` are kept apart from everything else on purpose: they
 * are the two answers that mean *you may not ask*, and a surface that shows them as
 * "nobody is restricted" tells the moderator the opposite of the truth.
 */
export type RestrictionListFailure = 'unauthorized' | 'forbidden' | 'unavailable'

export type RestrictionListResult =
    | { ok: true; entries: RestrictionEntry[] }
    | { ok: false; reason: RestrictionListFailure; status: number; detail: string }

/** RFC-3339 (what serde writes for a `DateTime<Utc>`) → unix seconds, `null` if unusable. */
const parseInstant = (value: unknown): number | null => {
    if (typeof value !== 'string' || value === '') {
        return null
    }
    const ms = Date.parse(value)

    return Number.isFinite(ms) ? Math.floor(ms / 1000) : null
}

const asText = (value: unknown): string => (typeof value === 'string' ? value : '')

/**
 * Parse one answer of `GET /moderation/restricted` — **the place where 403 stops being an
 * empty list.**
 *
 * ── The defect this replaces (found while building P4) ───────────────────────────
 *
 * `buzzLoadRestricted` used to end in `catch { return [] }`. "Nobody is restricted" and
 * "you are not allowed to ask" were the same answer, and so were "the relay is down" and
 * "the response was not a list at all". For the old purpose that was defensible and the
 * code said so — banning and unbanning (9040/9041) worked whether or not the list loaded,
 * so a toast there would only have been noise. For a surface that *carries* a moderation
 * decision it is not: the moderator would read a screen that says the suspension is not
 * in place while it is, or that nobody is suspended while they simply lack the permission
 * to see it.
 *
 * ── Fail-closed in the same two directions as the write gate ─────────────────────
 *
 * A non-2xx status is a failure, never an empty list. And a 200 whose body is not an
 * array is a failure too, not "no rows": a body of the wrong shape means the caller is
 * talking to something other than this route, and guessing that it meant "empty" is the
 * silent-emptiness failure one layer up.
 *
 * Both response shapes are accepted — the bare array the relay sends today, and a
 * `{"restricted": […]}` envelope. The envelope was what the client's first version read
 * for; it has never been observed, but taking it costs one line and refusing it would
 * turn a future wrapping into a silently empty screen.
 */
export const parseRestrictionList = (status: number, body: unknown): RestrictionListResult => {
    if (status === 401) {
        return { ok: false, reason: 'unauthorized', status, detail: asText(body) }
    }
    if (status === 403) {
        return { ok: false, reason: 'forbidden', status, detail: asText(body) }
    }
    if (status < 200 || status >= 300) {
        return { ok: false, reason: 'unavailable', status, detail: asText(body) }
    }

    const envelope = body as { restricted?: unknown } | null
    const rows = Array.isArray(body) ? body : Array.isArray(envelope?.restricted) ? envelope.restricted : null
    if (rows === null) {
        return { ok: false, reason: 'unavailable', status, detail: 'unexpected response shape (no array)' }
    }

    const entries = (rows as Record<string, unknown>[])
        .filter((row) => typeof row?.pubkey === 'string' && isPubkey(row.pubkey))
        .map((row) => {
            const banned = row.banned === true

            return {
                pubkey: row.pubkey as string,
                banned,
                mutedUntil: banned ? null : parseInstant(row.muted_until),
                reason: banned ? asText(row.ban_reason) : asText(row.mute_reason),
            }
        })

    return { ok: true, entries }
}
