/**
 * Buzz DM channels (kinds 41010/41011/41012) — the pure half.
 *
 * Counterpart to `dms.ts` (signer, relay, store). Browser-free and store-free like
 * `presenceData.ts`, `reminderModels.ts` and `forumVoteModels.ts`, so every rule below
 * is decidable under `node --test`. Relative imports carry the `.ts` extension: the file
 * has to load from Vite **and** from the node test runner.
 *
 * ══ A Buzz DM is a CHANNEL, not a message format ═════════════════════════════════
 *
 * This is the whole reason the phase is cheap. `open_dm` (`buzz-db/src/dm.rs:356`)
 * inserts an ordinary row into `channels` with `channel_type = 'dm'` and
 * `visibility = 'private'`, then adds every participant to `channel_members`. From that
 * moment the conversation is a room with an `h`, and it is read and written with the
 * chat surface this client already has — `deriveRoomChat`, `sendRoomMessage`,
 * `listenRoom`, `chat-row.blade.php`, `chat-composer.blade.php`, all untouched.
 *
 * There is **no** encryption in it. A Buzz DM is private the way a private channel is
 * private (relay-side access control), not the way NIP-17 is private (gift wrap). That
 * distinction belongs in the surface text and is written there, next to the picker
 * (`dm-modal.blade.php`) — see the note at the end of this file.
 *
 * ══ The three commands, read off the producer ════════════════════════════════════
 *
 * ```rust
 * // crates/buzz-sdk/src/builders.rs:1675-1694
 * pub fn build_dm_open(pubkeys: &[&str]) -> Result<EventBuilder, SdkError> {
 *     if pubkeys.is_empty() || pubkeys.len() > 8 { … }
 *     let mut tags = Vec::with_capacity(pubkeys.len());
 *     for pk in pubkeys { tags.push(tag(&["p", &check_pubkey_hex(pk, "pubkey")?])?); }
 *     Ok(EventBuilder::new(Kind::Custom(KIND_DM_OPEN as u16), "").tags(tags))
 * }
 * pub fn build_dm_add_member(channel_id: Uuid, pubkey: &str) -> Result<EventBuilder, SdkError> {
 *     let tags = vec![tag(&["h", &channel_id.to_string()])?, tag(&["p", &pk])?];
 *     Ok(EventBuilder::new(Kind::Custom(KIND_DM_ADD_MEMBER as u16), "").tags(tags))
 * }
 * ```
 *
 *   41010 `DM_OPEN`        `["p", <hex>]` × 1–8 · no `h`, no `d`, empty content
 *   41011 `DM_ADD_MEMBER`  `["h", <dm-uuid>]` + `["p", <hex>]` × ≥1
 *   41012 `DM_HIDE`        `["h", <dm-uuid>]`
 *
 * The SDK has no `build_dm_hide`; the shape above is `buzz-cli/src/commands/dms.rs:95-103`.
 *
 * ── Why none of them carries a `d` tag, and why that is a decision ───────────────
 *
 * `buzz-cli`'s `cmd_open_dm` adds one (`dms.rs:58,68`) with the comment *"build_dm_open
 * doesn't accept a d-tag, so we build the event manually"*. Following it would be a
 * mistake: `persist_command_event` (`command_executor.rs:136-210`) branches on the
 * PRESENCE of a `d` tag, not on the kind, and the branch it takes is the NIP-33
 * coordinate path — advisory lock, stale-write comparison, and `deleted_at = NOW()` on
 * the previous row for the same `(kind, pubkey, d)`. A command kind does not need any of
 * that, and a client that ever reused a `d` would get `duplicate: already processed`
 * for a command that never ran. We follow the SDK builder, which is the canonical
 * producer, and stay out of that branch entirely.
 *
 * ══ The answer comes back in the OK message, not as an event ══════════════════════
 *
 * `is_command_kind` (`buzz-core/src/kind.rs:815-826`) routes all three to
 * `command_executor::handle_command` after signature, timestamp, pubkey/auth match and
 * scope check (`ingest.rs:2059-2060`). The executor answers in `IngestResult.message`,
 * which the relay puts in the `OK` frame:
 *
 *   41010 → `response:{"channel_id":"<uuid>","created":true|false}`
 *   41011 → `response:{"channel_id":"<uuid>"}`     — **no `created` field**
 *   41012 → `{}`
 *   any   → `duplicate: already processed`         — see {@link DM_DUPLICATE}
 *
 * welshman keeps that string: `publishOne` writes `result.detail = detail` on the
 * SUCCESS branch too (`@welshman/net` `publish.js:56-59`), and the thunk mirrors the
 * result into `thunk.results[url]`. `getUrlsWithStatus(PublishStatus.Success)` answers
 * only *whether*, never *what* — hence {@link parseDmResponse} and the detail-carrying
 * wait in `publishResult.ts`.
 *
 * ── `duplicate: already processed` is reachable, and it carries no channel id ────
 *
 * `persist_command_event` inserts the command event with `ON CONFLICT DO NOTHING` on the
 * event **id**. Two identical commands in the same second — same participants, same
 * empty content, same `created_at` in whole seconds — serialise to the same id, so the
 * second one is answered with `duplicate: already processed` and the executor never
 * runs. The caller therefore cannot rely on a channel id always coming back; it has to
 * fall back on re-reading the list. {@link parseDmResponse} returns `null` for that
 * message on purpose rather than inventing an id.
 *
 * ══ DM sets are IMMUTABLE — 41011 opens a new conversation ═══════════════════════
 *
 * `handle_dm_add_member` (`command_executor.rs:527-533`) merges the existing members
 * with the new ones and calls `open_dm` on the **merged set**, with the comment
 * *"creates NEW DM — DM sets are immutable"*. The old conversation keeps existing, with
 * its own history and its own members. A surface that says "add person" without saying
 * that is lying about what the button does, so `dm-modal.blade.php` says it next to the
 * control — see the note at the end of this file.
 *
 * ══ Listing: 39000 with `#p`, never 41001 ════════════════════════════════════════
 *
 * `emit_group_discovery_events` (`side_effects.rs:1085-1095`) puts one `["p", <hex>]`
 * per participant into the DM's relay-signed 39000, plus `["hidden"]`, `["private"]`,
 * `["closed"]` and `["t","dm"]`. So a DM is discoverable with
 * `{kinds:[39000], "#p":[self]}` — see {@link dmListFilter}.
 *
 * **Not over 41001.** `KIND_DM_CREATED` exists as a constant and appears in exactly four
 * other places in the relay repo, none of which is a producer: `ALL_KINDS` (a catalogue,
 * `kind.rs:718`), a metrics label bound (`event.rs:43`), and `is_side_effect_kind`
 * (`side_effects.rs:36`) — which is only ever asked about events that were stored, and
 * 41001 cannot be stored because `required_scope_for_kind` has no arm for it and ends
 * `_ => Err("restricted: unknown event kind")` (`ingest.rs:453`). `buzz-cli`'s
 * `cmd_list_dms` queries `{kinds:[41001], "#p":[me]}` (`dms.rs:7-16`) and therefore
 * returns an empty list by construction.
 *
 * ══ Hiding is a per-viewer flag, and only 30622 reveals it ═══════════════════════
 *
 * `hide_dm` sets `channel_members.hidden_at` for the caller (`dm.rs:397-410`). It does
 * **not** touch the channel, so the DM's 39000 is unchanged and a client that only reads
 * 39000 keeps showing a conversation the user just dismissed. The relay publishes the
 * hidden set as kind 30622 `DM_VISIBILITY` — `["d", <viewer>]`, `["p", <viewer>]`, one
 * `["h", <uuid>]` per hidden DM, signed by the relay (`side_effects.rs:3169-3225`).
 *
 * 30622 is **relay-only** (`is_relay_only_kind`, `kind.rs:830-838`): a client publish is
 * refused with `restricted: relay-only kind`, so this client never writes one — and
 * {@link foldHiddenDms} accepts one only from the relay's own NIP-11 `self` pubkey.
 * Reading it needs `#p:[self]` in the filter and gets no `ids` exemption
 * (`p_gated_filters_authorized`, `req.rs:1058-1091`), which is what {@link dmVisibilityFilter}
 * encodes.
 */
import { mayWriteKind } from './relayCapability.ts'
import type { SpaceKind } from './spaceCaps.ts'

/** Buzz `KIND_DM_OPEN` (`buzz-core/src/kind.rs:507`). */
export const DM_OPEN = 41010

/** Buzz `KIND_DM_ADD_MEMBER` (`kind.rs:509`). */
export const DM_ADD_MEMBER = 41011

/** Buzz `KIND_DM_HIDE` (`kind.rs:511`). */
export const DM_HIDE = 41012

/** Buzz `KIND_DM_VISIBILITY` (`kind.rs:449`) — relay-authored, never written here. */
export const DM_VISIBILITY = 30622

/**
 * How many OTHER participants a `DM_OPEN` may name.
 *
 * Enforced three times on the relay side and each time with the same number: the SDK
 * builder (`builders.rs:1676`), the command handler (`command_executor.rs:334-339`) and
 * the database (`open_dm`, `dm.rs:370-374`, on the merged set). Nine total including the
 * caller — the caller is added by the relay whether or not they name themselves.
 */
export const DM_MAX_OTHERS = 8

/** Ceiling on the whole participant set, caller included (`dm.rs:112-116`). */
export const DM_MAX_PARTICIPANTS = 9

/*
 * The `["t","dm"]` marker itself lives in `roomCategories.ts` next to `["t","forum"]`
 * (`DM_CHANNEL_TYPE`/`parseDmTag`): that file is the one place where a Buzz
 * `channel_type` is turned into a client-side flag, and splitting the two markers over
 * two files would make the next channel type a coin toss.
 */

/** Prefix of the executor's answer in the `OK` message (`command_executor.rs:442`). */
export const DM_RESPONSE_PREFIX = 'response:'

/** The executor's answer when the exact same command event was already ingested. */
export const DM_DUPLICATE = 'duplicate: already processed'

/** A 64-character lowercase hex pubkey — the only form Buzz's `decode_pubkey` accepts. */
const HEX_64 = /^[0-9a-f]{64}$/

/**
 * A channel id as `Uuid::parse_str` accepts it; Buzz mints them with `Uuid::new_v4()`.
 *
 * Case-insensitive on purpose, unlike {@link isDmPubkey} above — and the asymmetry is
 * the relay's, not ours. `decode_pubkey` runs `hex::decode`, which refuses uppercase, so
 * a mixed-case pubkey is answered with `invalid: bad pubkey hex`; Rust's `Uuid::parse_str`
 * accepts either case. A gate that refused what the relay accepts would be a gate that
 * invents a rule.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Is this a pubkey Buzz would accept in a `p` tag? Case-sensitive on purpose. */
export const isDmPubkey = (value: unknown): value is string =>
    typeof value === 'string' && HEX_64.test(value)

/** Is this a channel id Buzz would parse out of an `h` tag? */
export const isDmChannelId = (value: unknown): value is string =>
    typeof value === 'string' && UUID.test(value)

/**
 * What a user may type into the participant field, turned into a hex pubkey — or `''`.
 *
 * `decode` is handed in rather than imported so this module stays free of
 * `nostr-tools`: it is imported by `groups.ts`, which sits in the boot path, and the
 * bundle guard (`bundleGrenze.nodetest.ts`) exists because exactly this kind of
 * incidental value import once cost every chunk 48 kB. The same shape as
 * `dmTitle(…, nameOf)` and `agentLabels(…, nip19.npubEncode)` in `forgeWake.ts`, and it
 * makes the parser testable without a bech32 implementation.
 *
 * Accepted: a bare 64-hex pubkey in either case, and an `npub1…`. Refused — deliberately
 * — is every other bech32 form: an `nprofile` carries relay hints this surface would
 * silently drop, and an `note`/`nevent`/`naddr` in a person field is a mistake, not an
 * abbreviation. `''` means "not a person", and the caller shows that instead of sending
 * a command the relay would reject with `invalid: bad pubkey hex`.
 */
export const parseDmRecipient = (
    value: string,
    decode: (bech32: string) => { type: string; data: unknown },
): string => {
    const raw = (value ?? '').trim()
    if (!raw) {
        return ''
    }
    const lower = raw.toLowerCase()
    if (HEX_64.test(lower)) {
        return lower
    }
    if (!lower.startsWith('npub1')) {
        return ''
    }
    try {
        const { type, data } = decode(lower)

        return type === 'npub' && isDmPubkey(data) ? data : ''
    } catch {
        return ''
    }
}

/**
 * What the write gate needs to answer: which kind of relay the active space is, and its
 * NIP-11 doc. Same shape as `ReminderContext`/`PresenceContext` for the same reason —
 * the gate is one function and every caller feeds it the same two facts.
 */
export type DmContext = {
    /** From `deriveSpaceKind`; `'unknown'` denies (fail-closed, see `relayCapability.ts`). */
    spaceKind: SpaceKind
}

/** A command body ready to be signed — kind and tags, never a signed event. */
export type DmCommand = {
    kind: number
    tags: string[][]
}

/**
 * The other participants of a conversation, normalised: lowercase, deduplicated, self
 * removed, order preserved, anything that is not a 64-hex pubkey dropped.
 *
 * Self is removed rather than rejected because the relay does the same thing silently
 * (`handle_dm_open` folds duplicates into `all_bytes`, `command_executor.rs:348-353`) —
 * but it counts the tag against the limit of eight first. Removing it here means the
 * user's own key in the picker costs them nothing.
 */
export const dmOthers = (pubkeys: readonly string[], self: string): string[] => {
    const own = typeof self === 'string' ? self.toLowerCase() : ''
    const seen = new Set<string>()
    const out: string[] = []
    for (const raw of pubkeys) {
        const pk = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
        if (!isDmPubkey(pk) || pk === own || seen.has(pk)) {
            continue
        }
        seen.add(pk)
        out.push(pk)
    }

    return out
}

/**
 * Open (or re-open) a conversation with `pubkeys` — the body, or `null`.
 *
 * **The gate IS the return value**, the same shape as `planReminder`, `planPresence`,
 * `planForumVote`, `planTimeout` and `planBookmarkWrite`: a caller that does not ask has
 * nothing to sign. On zooid and while the NIP-11 doc is still in flight
 * (`spaceKind === 'unknown'`) this answers `null`, and the reason it matters here is
 * R3 of the plan — zooid has no kind allowlist, so a 41010 written there is accepted,
 * stored and fanned out as permanent garbage that answers nobody.
 */
export const planDmOpen = (pubkeys: readonly string[], self: string, ctx: DmContext): DmCommand | null => {
    if (!mayWriteKind(DM_OPEN, ctx.spaceKind)) {
        return null
    }
    const others = dmOthers(pubkeys, self)
    if (others.length === 0 || others.length > DM_MAX_OTHERS) {
        return null
    }

    return { kind: DM_OPEN, tags: others.map((pk) => ['p', pk]) }
}

/**
 * Add people to an existing conversation — which, on Buzz, means **opening a new one**
 * with the union of both sets. See the module header; the sentence the surface must show
 * stands next to the control in `dm-modal.blade.php`.
 *
 * `existing` is the current participant set as read from the DM's 39000 (`p` tags,
 * caller included). It is not decoration: the relay rejects a merged set above nine
 * (`command_executor.rs:509-513`), and a merge that adds nobody would return the SAME
 * channel with `created: false` — a no-op the surface would have to announce as a new
 * conversation. Both are refused here, before anything is signed.
 */
export const planDmAddMember = (
    h: string,
    pubkeys: readonly string[],
    existing: readonly string[],
    self: string,
    ctx: DmContext,
): DmCommand | null => {
    if (!mayWriteKind(DM_ADD_MEMBER, ctx.spaceKind)) {
        return null
    }
    if (!isDmChannelId(h)) {
        return null
    }
    // `existing` already contains self; normalising against `''` keeps it that way.
    const current = new Set(dmOthers(existing, ''))
    current.add(typeof self === 'string' ? self.toLowerCase() : '')
    const added = dmOthers(pubkeys, self).filter((pk) => !current.has(pk))
    if (added.length === 0) {
        return null
    }
    if (current.size + added.length > DM_MAX_PARTICIPANTS) {
        return null
    }

    return { kind: DM_ADD_MEMBER, tags: [['h', h], ...added.map((pk) => ['p', pk])] }
}

/**
 * Dismiss a conversation from this user's own sidebar — the body, or `null`.
 *
 * Nothing is deleted and nobody else is affected: `hide_dm` sets `hidden_at` on this
 * viewer's membership row (`dm.rs:397-410`), and re-opening the same participant set
 * clears it again (`open_dm` → `unhide_dm`, `dm.rs:377-381`). The surface says so.
 */
export const planDmHide = (h: string, ctx: DmContext): DmCommand | null => {
    if (!mayWriteKind(DM_HIDE, ctx.spaceKind)) {
        return null
    }
    if (!isDmChannelId(h)) {
        return null
    }

    return { kind: DM_HIDE, tags: [['h', h]] }
}

/** What the executor answered: which channel, and whether it had to create it. */
export type DmResponse = {
    channelId: string
    /** `null` for 41011, which reports no `created` field at all. */
    created: boolean | null
}

/**
 * The executor's answer out of the `OK` message, or `null` when there is none.
 *
 * `null` covers three genuinely different situations that a caller must treat the same
 * way — re-read the list instead of trusting a channel id: a relay that answered
 * something else, a `duplicate: already processed` (the command never ran), and a
 * malformed body. Inventing an id for any of them would put a channel in the sidebar
 * that may not exist.
 */
export const parseDmResponse = (detail: unknown): DmResponse | null => {
    if (typeof detail !== 'string') {
        return null
    }
    const raw = detail.trim()
    if (!raw.startsWith(DM_RESPONSE_PREFIX)) {
        return null
    }
    let parsed: unknown
    try {
        parsed = JSON.parse(raw.slice(DM_RESPONSE_PREFIX.length))
    } catch {
        return null
    }
    if (typeof parsed !== 'object' || parsed === null) {
        return null
    }
    const { channel_id: channelId, created } = parsed as { channel_id?: unknown; created?: unknown }
    if (!isDmChannelId(channelId)) {
        return null
    }

    return { channelId, created: typeof created === 'boolean' ? created : null }
}

/** Minimal shape of an event this module folds — no welshman types in a pure file. */
export type DmEventLike = {
    kind: number
    pubkey: string
    created_at: number
    tags: string[][]
}

/**
 * The conversations this viewer has hidden, out of the relay's 30622 snapshots.
 *
 * Three authority checks, and each one closes a different hole:
 *
 *  1. **`pubkey === relaySelf`.** 30622 is relay-only; a snapshot from any other key is
 *     a forgery, and accepting it would let a stranger empty someone's DM sidebar. This
 *     is the same gate `roomsByUrl` puts on room state, for the same reason.
 *  2. **`d === viewer`.** The coordinate names whose hidden set this is. Without it a
 *     snapshot belonging to another member — which the relay would never send us, but a
 *     cache replay might — would hide our conversations.
 *  3. **newest wins.** 30622 is addressable, so the relay replaces it on every hide and
 *     re-open. A folded view over several revisions must take the newest, or an un-hide
 *     would never become visible. Ties break on the higher id, matching what welshman's
 *     repository does for addressable events.
 *
 * `relaySelf` empty means the NIP-11 doc has not arrived yet: nothing is hidden then,
 * which is the safe direction (a conversation shows one beat too long, rather than
 * vanishing without grounds).
 */
export const foldHiddenDms = (
    events: readonly (DmEventLike & { id?: string })[],
    relaySelf: string,
    viewer: string,
): Set<string> => {
    if (!relaySelf || !viewer) {
        return new Set()
    }
    let best: (DmEventLike & { id?: string }) | null = null
    for (const event of events) {
        if (event.kind !== DM_VISIBILITY || event.pubkey !== relaySelf) {
            continue
        }
        if (tagValue(event.tags, 'd') !== viewer) {
            continue
        }
        if (
            best === null ||
            event.created_at > best.created_at ||
            (event.created_at === best.created_at && (event.id ?? '') > (best.id ?? ''))
        ) {
            best = event
        }
    }
    if (best === null) {
        return new Set()
    }

    return new Set(best.tags.filter((tag) => tag[0] === 'h' && isDmChannelId(tag[1])).map((tag) => tag[1] as string))
}

/** First value of the named tag, or `''`. */
const tagValue = (tags: readonly string[][], name: string): string =>
    tags.find((tag) => tag[0] === name && typeof tag[1] === 'string')?.[1] ?? ''

/**
 * The participants of a DM out of its relay-signed 39000.
 *
 * The relay writes them as bare `["p", <hex>]` — **not** the NIP-29 four-element form
 * `["p", <hex>, <relay>, <role>]` it uses in the 39002 member list
 * (`side_effects.rs:1040-1043` against `:1089-1092`). Reading either shape works here;
 * only `tag[1]` is looked at.
 */
export const dmParticipants = (tags: readonly string[][]): string[] =>
    tags.filter((tag) => tag[0] === 'p' && isDmPubkey(tag[1])).map((tag) => tag[1] as string)

/**
 * The people a conversation is WITH — participants minus the viewer.
 *
 * A conversation with yourself is possible (`open_dm` merges the caller in either way)
 * and is the one case where this returns the viewer: a title of "" would be worse than
 * a title naming the only person in the room.
 */
export const dmCounterparts = (participants: readonly string[], self: string): string[] => {
    const others = participants.filter((pk) => pk !== self)

    return others.length > 0 ? others : participants.slice(0, 1)
}

/**
 * The title of a DM row.
 *
 * The relay's own `name` is useless for this: `create_dm` stores the literal string
 * `"DM"` for two people and `"Group DM (N)"` for more (`dm.rs:157-162`), so every
 * conversation in the sidebar would carry the same label. The name has to come from the
 * counterparties' profiles, which is why this takes a resolver instead of reading a
 * store — it stays testable without one.
 *
 * `limit` names how many people are spelled out before the rest becomes a count. Three
 * is the point at which a rail row ~290 px wide stops showing a whole name.
 */
export const dmTitle = (
    participants: readonly string[],
    self: string,
    nameOf: (pubkey: string) => string,
    limit = 3,
): string => {
    const others = dmCounterparts(participants, self)
    const names = others.map((pk) => nameOf(pk).trim() || `${pk.slice(0, 8)}…`)
    if (names.length <= limit) {
        return names.join(', ')
    }

    return `${names.slice(0, limit).join(', ')} +${names.length - limit}`
}

/** What {@link roomDisplayName} needs of a row — a `RoomView` and a `RailRoom` both fit. */
export type DmNameableRoom = {
    /** The relay's own channel name. For a conversation that is `"DM"` for everyone. */
    name: string
    isDm?: boolean
    dmParticipants?: readonly string[]
}

/**
 * **The display name of a room row — the one answer, for every surface.**
 *
 * Until this function existed the question had two answers. `railName` (`rail.ts`)
 * resolved a conversation through its participants; `joinedRoomNames` (`bridge.ts`) took
 * `room.name` raw, and since the relay stores the literal `"DM"` as the channel name of
 * every two-person conversation and `"Group DM (N)"` for every group
 * (`buzz-db/src/dm.rs:157-162`), `/updates` showed N rows all called "DM". The rail was
 * the only place that knew better, and the rail does not exist in the NativePHP host
 * (`app-frame.blade.php:44`) — so on mobile *nothing* knew better.
 *
 * **The fallback is `room.name`, never `''`.** An empty string is not a neutral value on
 * the `/updates` path: `buildItem` reads `roomName === ''` as **orphaned** (`updates.ts`,
 * §8) and replaces the row with "message no longer available". A conversation whose
 * participants cannot be resolved — a 39000 that carries no usable `p` tag — must keep
 * standing in the list under the relay's own name, not disappear behind a wrong claim.
 *
 * Pure, and it stays that way: the caller passes the viewer and a name resolver, exactly
 * like {@link dmTitle}. That is what lets the two reactivity systems in this package
 * (svelte derivations in `bridge.ts`, Alpine getters in the rail) share one rule while
 * each binds its own source.
 */
export const roomDisplayName = (
    room: DmNameableRoom,
    self: string,
    nameOf: (pubkey: string) => string,
    limit = 3,
): string => {
    if (!room.isDm) {
        return room.name
    }

    return dmTitle(room.dmParticipants ?? [], self, nameOf, limit) || room.name
}

/** A space view, as far as {@link foldDmRooms} looks into it. */
export type DmRoomSource<T> = { url?: string; dmRooms?: readonly T[] } | null | undefined

/**
 * The conversations of several space views as one list: deduplicated by `h`, dismissed
 * ones removed, each row tagged with the relay it came from.
 *
 * **Why the rows carry `spaceUrl`.** The rail shows the conversations of BOTH views (home
 * space and workspace), and a hide sent to the wrong relay is answered with
 * `invalid: DM not found`. Every command therefore takes the URL from the row it acts on
 * (see the module header of `dms.ts`), which only works if the row remembers it.
 *
 * **Why the deduplication is not cosmetic.** The home space MAY be the workspace, and an
 * Alpine `x-for :key="room.h"` with two identical keys silently swallows a row.
 *
 * `joined: true` without a check: a DM only reaches `SpaceView.dmRooms` if the
 * relay-signed 39002 lists the viewer as a member — `buildSpaceView` decides that, and it
 * is not decided a second time here.
 */
export const foldDmRooms = <T extends { h: string }>(
    views: readonly DmRoomSource<T>[],
    hidden: Iterable<string>,
): (T & { joined: true; spaceUrl: string })[] => {
    const dismissed = new Set(hidden)
    const seen = new Set<string>()
    const out: (T & { joined: true; spaceUrl: string })[] = []
    for (const view of views) {
        for (const room of view?.dmRooms ?? []) {
            // Dismissed means: the user took this conversation out of their column with a
            // 41012. The relay DELETES nothing — the 39000 keeps arriving unchanged, and
            // only the relay-signed 30622 says which conversations should go. Without this
            // filter the button would have no effect.
            if (seen.has(room.h) || dismissed.has(room.h)) {
                continue
            }
            seen.add(room.h)
            out.push({ ...room, joined: true, spaceUrl: view?.url ?? '' })
        }
    }

    return out
}

/**
 * The filter that finds this viewer's conversations.
 *
 * `#p` is what makes it a DM query rather than a room query: the relay puts a `p` tag
 * per participant on a DM's 39000 and on no other channel's (`side_effects.rs:1085-1095`
 * is inside `if channel.channel_type == "dm"`). The `["t","dm"]` check still has to
 * happen on the result — a future channel type could carry `p` tags too, and the rule of
 * this repo is that the DATA decides, never the relay branch (`roomCategories.ts`).
 *
 * **Why this exists next to the client's ordinary room load.** `watchSpaceRooms` already
 * requests `{kinds:[39000,9008,39002,39001]}` without `#p`, and a member does receive
 * their DMs' 39000 through it. What it does not receive is a DM created a moment ago:
 * discovery events are stored channel-scoped, and the relay says so itself —
 * *"live global subscriptions (e.g. `{kinds:[39000]}`) won't receive these events via
 * fan-out. Clients discover groups via historical REQ queries"* (`side_effects.rs:1054-1057`).
 * So the targeted filter is the refresh after a command, not a second listing path.
 */
export const dmListFilter = (self: string): { kinds: number[]; '#p': string[] }[] =>
    isDmPubkey(self) ? [{ kinds: [39000], '#p': [self] }] : []

/**
 * The filter for the hidden-set snapshot.
 *
 * `#p:[self]` is mandatory, not a narrowing: 30622 is in `P_GATED_KINDS`, so a filter
 * naming that kind without a `#p` exactly equal to the reader's own pubkey is answered
 * with `CLOSED` (`p_gated_filters_authorized`, `req.rs:1058-1091`). The `ids` exemption
 * that other p-gated kinds get is explicitly withdrawn for this one, because the event
 * is relay-signed — its id is not author-bound, so knowing it proves nothing.
 */
export const dmVisibilityFilter = (self: string): { kinds: number[]; '#p': string[] }[] =>
    isDmPubkey(self) ? [{ kinds: [DM_VISIBILITY], '#p': [self] }] : []

/*
 * The two sentences the surface owes the user live in `dm-modal.blade.php`, not here:
 * user-facing text goes through `__()` so `i18n:scan` sees it and all seven catalogues
 * carry it. Both state a relay rule, and each stands directly next to the control it
 * describes, so the wording cannot drift away from the button it belongs to:
 *
 *  - next to "add person": that this opens a NEW conversation and the old one stays
 *    (`handle_dm_add_member`, `command_executor.rs:527-533`; see {@link planDmAddMember});
 *  - under the picker: that a Buzz DM is a private CHANNEL, plaintext on the relay and
 *    protected by its access rules — not a NIP-17 gift wrap. A user who reads "DM" and
 *    assumes end-to-end encryption has been misled by the surface, not by the relay.
 */
