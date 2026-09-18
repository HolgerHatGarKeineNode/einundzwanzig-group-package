/**
 * „Angeheftet" (D7/D8) — the pure half: keys, parsing, merge, caps, and the ONE decision
 * that turns a pin set into a published event.
 *
 * Deliberately **without welshman imports**, so every rule below runs under `node --test`
 * without a browser, a signer or a relay (`pinSet.test.ts`). The network and store half is
 * `pinSetSync.ts`. Same split, same reason as `channelPrefsData.ts`/`channelPrefs.ts` and
 * `pins.ts`/`roomPins.ts` — and note the neighbour: **`js/pins.ts` is MESSAGE pins**
 * (kind 9010/40004 inside a room). This file is the user's personal "angeheftet" set.
 *
 * ── The event ───────────────────────────────────────────────────────────────────
 *
 * kind 30078 (NIP-78), `d = einundzwanzig/pins`, no other tags, content NIP-44 encrypted
 * to self:
 *
 *     {"v":1,"pins":{"<key>":{"on":true,"at":1788600000,"pos":0}}}
 *
 * The `d` value is checked against the two foreign namespaces on the relays this client
 * talks to: zooid's own app-data lives under `zooid/…` and Buzz' read state under
 * `read-state:<32 hex>` (`js/readState.ts`, `js/channelPrefsData.ts`). `einundzwanzig/pins`
 * collides with neither, and it must stay that way — a collision is silent, because both
 * sides would simply fail to parse the other's payload and write their own over it.
 *
 * ── Why NOT the read-state blob, and not `readStateSync.ts`' load/merge ─────────
 *
 * Both were considered and rejected in the plan (R2). `readStateSync.ts` merges
 * **grow-only** (`:268-272`), takes no `EOSE` verdict before writing (`:285-288`) and
 * derives its relay set from `activeSpace` (`:250-260`). Every one of the three is wrong
 * here: a pin can be REMOVED (grow-only would resurrect it), a write without a verdict
 * replaces a set we never saw (welshman's own list plugins do exactly that — memory
 * `welshman-forceload-schreibt-leere-liste`), and `activeSpace` follows the ephemeral
 * workspace override, so a user who tapped a workspace room would write his pins to the
 * Buzz relay for the rest of the session.
 *
 * ── Two merge rules in this house, and this is the per-key one ──────────────────
 *
 * {@link mergePinSets} merges **per key** over `at`, like Buzz' `channel-stars`
 * (`mergeFlags` in `channelPrefsData.ts`) and unlike the whole-blob LWW of
 * `channel-sections`. Two devices that each pinned a different thing keep both
 * statements; a removal is an entry with `on:false` (a tombstone), never a missing key.
 * Without the tombstone the older device's `on:true` would win the next merge and the pin
 * would come back — the failure this module is measured against.
 *
 * ── What is NOT in this blob ────────────────────────────────────────────────────
 *
 * Rooms of the **Buzz workspace**: they are pinned through Buzz' own `channel-stars`
 * (`js/channelPrefs.ts`), so Buzz Desktop and this client keep one truth about a starred
 * channel. {@link pinWriteRoute} is where that fork is decided, and it is decided here —
 * pure, and therefore askable by a test.
 */

// The `created_at` rule is shared with the channel-preference blobs on purpose: same kind,
// same addressable replacement, same relay window. Two copies of that arithmetic would be
// two answers to "may a second toggle inside the same second survive".
import { MAX_PREFS_FUTURE_SKEW_SEC, nextPrefsCreatedAt } from './channelPrefsData.ts'

// ── Identity of the event ───────────────────────────────────────────────────────

/** The `d` tag. Stable forever: it IS the address of the user's pin set. */
export const PIN_D = 'einundzwanzig/pins'

/** The payload version this client writes and fully understands. */
export const PIN_VERSION = 1

/**
 * Cap on stored entries — 500, the same number `channelPrefsData.ts MAX_FLAG_ENTRIES`
 * carries, and for the same reason: a blob that grows without a bound ends as a payload no
 * relay wants to store and every reader has to decrypt.
 */
export const MAX_PINS = 500

/** How long a tombstone (`on:false`) is kept before it is dropped — 90 days. */
export const TOMBSTONE_TTL_SEC = 90 * 24 * 60 * 60

export { MAX_PREFS_FUTURE_SKEW_SEC as MAX_PIN_FUTURE_SKEW_SEC }

// ── Keys ───────────────────────────────────────────────────────────────────────

/**
 * The six key namespaces (D7). A key is opaque to the merge — it only has to be stable
 * across devices, which is why a room key carries its RELAY: the same `h` on two relays is
 * two different rooms, and a bare `h` would make one of them shadow the other.
 */
export const PIN_PREFIXES = ['area', 'room', 'article', 'repo', 'meetup', 'person'] as const
export type PinPrefix = (typeof PIN_PREFIXES)[number]

/** `area:<key>` — one of the tiles of `config('group.areas')`. */
export const areaPinKey = (area: string): string => `area:${area}`
/** `room:<h>@<relay>` — the NIP-29 `h` plus the relay it lives on. */
export const roomPinKey = (h: string, relay: string): string => `room:${h}@${relay}`
/** `article:<30023 coordinate>` — `kind:pubkey:d`, the addressable form. */
export const articlePinKey = (coordinate: string): string => `article:${coordinate}`
/** `repo:<30617 coordinate>`. */
export const repoPinKey = (coordinate: string): string => `repo:${coordinate}`
/** `meetup:<slug>` — the Portal's slug, the id every client shares for a meetup. */
export const meetupPinKey = (slug: string): string => `meetup:${slug}`
/** `person:<hex pubkey>`. Hex and not npub: the npub is a display form. */
export const personPinKey = (pubkey: string): string => `person:${pubkey}`

/**
 * Is this a key this client understands?
 *
 * Unknown prefixes are **kept on the read side** (they belong to a future version of this
 * client or another one of ours) and refused on the write side — see {@link setPinEntry}.
 * That asymmetry is the whole point: a foreign key must survive our merge, but this client
 * must not invent one.
 */
export const isPinKey = (key: string): boolean => {
    const at = key.indexOf(':')
    if (at < 1 || at === key.length - 1) {
        return false
    }

    return (PIN_PREFIXES as readonly string[]).includes(key.slice(0, at))
}

/** The prefix of a key, or `''` for a malformed one. */
export const pinPrefixOf = (key: string): string => {
    const at = key.indexOf(':')

    return at < 1 ? '' : key.slice(0, at)
}

/**
 * The `h` and the relay of a `room:` key — `null` for every other key or a malformed one.
 *
 * `lastIndexOf('@')`: a relay URL contains no `@`, but an `h` theoretically could, and the
 * relay is the part this client compares against `WORKSPACE_URL`.
 */
export const roomKeyParts = (key: string): { h: string; relay: string } | null => {
    if (!key.startsWith('room:')) {
        return null
    }
    const body = key.slice('room:'.length)
    const at = body.lastIndexOf('@')
    if (at < 1 || at === body.length - 1) {
        return null
    }

    return { h: body.slice(0, at), relay: body.slice(at + 1) }
}

// ── Types ──────────────────────────────────────────────────────────────────────

/**
 * One pin. `at` are **seconds** and the only thing the merge compares; `pos` is the
 * display order and carries no merge weight (two devices reordering at the same second is
 * a cosmetic conflict, losing a pin is not).
 */
export type PinEntry = {
    on: boolean
    at: number
    pos: number
}

export type PinSet = {
    v: typeof PIN_VERSION
    pins: Record<string, PinEntry>
}

/**
 * The empty set. Frozen **including the inner container** — `Object.freeze` is shallow,
 * and a `EMPTY_PINS.pins[x] = …` anywhere in a caller would poison the default for the
 * rest of the session (the bug `channelPrefsData.ts` names at `EMPTY_SECTIONS`).
 */
export const EMPTY_PINS: PinSet = Object.freeze({
    v: PIN_VERSION,
    pins: Object.freeze({} as Record<string, PinEntry>),
}) as PinSet

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value)

// ── Caps and pruning ───────────────────────────────────────────────────────────

/**
 * Cap to {@link MAX_PINS}: the **newest** `at` survive, ties broken by key.
 *
 * Deterministic on purpose — two devices holding the same payload have to keep the same
 * 500, or they would keep deleting each other's tail. Same construction as `boundFlags`.
 */
export const boundPins = (store: PinSet): PinSet => {
    const entries = Object.entries(store.pins)
    if (entries.length <= MAX_PINS) {
        return store
    }
    entries.sort(([leftKey, left], [rightKey, right]) =>
        left.at !== right.at ? left.at - right.at : leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0,
    )

    return { v: PIN_VERSION, pins: Object.fromEntries(entries.slice(-MAX_PINS)) }
}

/**
 * Drop tombstones older than {@link TOMBSTONE_TTL_SEC}. Active pins are never pruned, at
 * any age.
 *
 * **The price, stated rather than discovered:** a device that has been offline for longer
 * than the TTL and still carries the pin as `on:true` will resurrect it — its `at` is then
 * the only statement left about that key. 90 days is the plan's number; making it infinite
 * would trade that for a blob that only ever grows.
 */
export const prunePins = (store: PinSet, nowSec: number): PinSet => {
    const kept = Object.entries(store.pins).filter(
        ([, entry]) => entry.on || entry.at > nowSec - TOMBSTONE_TTL_SEC,
    )
    if (kept.length === Object.keys(store.pins).length) {
        return store
    }

    return { v: PIN_VERSION, pins: Object.fromEntries(kept) }
}

// ── Parsing ────────────────────────────────────────────────────────────────────

/**
 * What a parsed payload is: the set, plus whether this client may WRITE it back.
 *
 * `readOnly` is the answer to "unknown `v`" and it is a value, not a thrown error: a
 * payload written by a newer client is still the best picture we have of the user's pins,
 * so it is displayed — and never replaced. Dropping it instead would show an empty pin bar
 * next to a full one on the other device.
 */
export type PinParse = { store: PinSet; readOnly: boolean }

/**
 * Parse a decoded payload. `null` = not a pin payload at all (then the caller keeps its
 * current state — the fail-soft rule of every parser in this house).
 *
 * An unknown `v` yields `{store: EMPTY_PINS, readOnly: true}`: the entries are NOT read,
 * because their shape is by definition unknown, but the read-only flag travels so the
 * write path can refuse. Both halves matter — reading a future payload as if it were v1
 * would be a guess, and forgetting the flag would overwrite it.
 *
 * Individual broken entries fall out, the rest survives (`flatMap` pattern from
 * `parseFlagPayload`). A `NaN` in `at` would poison every later comparison, so it is
 * refused rather than clamped.
 */
export const parsePinPayload = (json: unknown): PinParse | null => {
    if (!isPlainObject(json) || !isPlainObject(json.pins)) {
        return null
    }
    if (json.v !== PIN_VERSION) {
        // A version we do not know: no entries, and no write either.
        return typeof json.v === 'number' || typeof json.v === 'string'
            ? { store: EMPTY_PINS, readOnly: true }
            : null
    }
    const pins: Record<string, PinEntry> = Object.fromEntries(
        Object.entries(json.pins).flatMap(([key, value]): [string, PinEntry][] => {
            if (key === '' || !isPlainObject(value)) {
                return []
            }
            if (typeof value.on !== 'boolean') {
                return []
            }
            const at = value.at
            if (typeof at !== 'number' || !Number.isFinite(at) || at < 0) {
                return []
            }
            const pos = typeof value.pos === 'number' && Number.isFinite(value.pos) ? value.pos : 0

            return [[key, { on: value.on, at, pos }]]
        }),
    )

    return { store: boundPins({ v: PIN_VERSION, pins }), readOnly: false }
}

/** Decrypted plaintext → {@link PinParse}. **Never throws**; unreadable input is `null`. */
export const parsePinContent = (plaintext: string | undefined): PinParse | null => {
    if (!plaintext) {
        return null
    }
    let json: unknown
    try {
        json = JSON.parse(plaintext)
    } catch {
        return null
    }

    return parsePinPayload(json)
}

// ── Merge ──────────────────────────────────────────────────────────────────────

/**
 * Merge per key: the newer `at` wins, a tie keeps the entry we already had (`>`), and a key
 * only one side knows always survives.
 *
 * The event's `created_at` plays **no** role here — that is exactly the difference to the
 * whole-blob rule. Two devices, each having pinned a different thing, keep both statements
 * no matter which event arrived last.
 */
export const mergePinSets = (current: PinSet, incoming: PinSet | null): PinSet => {
    if (!incoming) {
        return current
    }
    const pins: Record<string, PinEntry> = { ...current.pins }
    for (const [key, entry] of Object.entries(incoming.pins)) {
        const existing = pins[key]
        if (!existing || entry.at > existing.at) {
            pins[key] = entry
        }
    }

    return boundPins({ v: PIN_VERSION, pins })
}

// ── Local changes ──────────────────────────────────────────────────────────────

/**
 * Set or clear ONE pin locally — unconditional, unlike {@link mergePinSets}.
 *
 * This is the user's own action on this device, not a remote statement that has to win a
 * timestamp comparison. Routed through the merge it would CANCEL ITSELF on a second toggle
 * inside the same second (`mergePinSets` overwrites only on a strictly newer `at`) — the
 * same trap `setFlag` in `channelPrefsData.ts` documents.
 *
 * Returns the store **unchanged** for a key this client does not understand: a write path
 * that can invent keys is a write path that can put anything into a blob every device
 * merges.
 */
export const setPinEntry = (store: PinSet, key: string, on: boolean, at: number, pos = 0): PinSet => {
    if (!isPinKey(key)) {
        return store
    }

    return boundPins({ v: PIN_VERSION, pins: { ...store.pins, [key]: { on, at, pos } } })
}

/**
 * The default pins of a fresh set (D8: wallet), seeded with `at: 0`.
 *
 * `at: 0` is what makes the seed lose against **every** real statement, including a
 * removal made on another device three years ago — the exact hazard R2 names. It is also
 * the marker {@link hasUserPin} reads to keep the seed from being published on its own.
 */
export const seedDefaultPins = (keys: readonly string[], store: PinSet = EMPTY_PINS): PinSet => {
    const pins: Record<string, PinEntry> = { ...store.pins }
    let index = 0
    for (const key of keys) {
        if (isPinKey(key) && !pins[key]) {
            pins[key] = { on: true, at: 0, pos: index }
        }
        index += 1
    }

    return boundPins({ v: PIN_VERSION, pins })
}

/**
 * Does this set contain a single statement a USER made? (`at > 0`)
 *
 * The gate for D8's "published only with the first user change". Without it the local
 * default seed would be published on the first load of a fresh device and would then be
 * indistinguishable from a deliberate pin — and, worse, a device whose read came back
 * empty for any other reason would publish a set consisting of exactly the default.
 */
export const hasUserPin = (store: PinSet): boolean =>
    Object.values(store.pins).some((entry) => entry.at > 0)

/**
 * The keys that are pinned right now, in display order: `pos` ascending, then the newer
 * `at` first, then the key. Tombstones are not pinned.
 *
 * Sorted deterministically because this list drives the left bar and the Start chips, and
 * a bar that reorders itself on every relay emit reads as broken.
 */
export const pinnedKeysOf = (store: PinSet): string[] =>
    Object.entries(store.pins)
        .filter(([, entry]) => entry.on)
        .sort(([leftKey, left], [rightKey, right]) =>
            left.pos !== right.pos
                ? left.pos - right.pos
                : left.at !== right.at
                    ? right.at - left.at
                    : leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0,
        )
        .map(([key]) => key)

/** Is this key pinned (and not tombstoned)? */
export const isPinned = (store: PinSet, key: string): boolean => store.pins[key]?.on === true

/**
 * The label a chip shows when nothing better is known — **the identifying part of the key,
 * not the key.**
 *
 * A pin can point at an object this device has never loaded (a room of a space one is not
 * in, a person without a kind 0, an article whose relay is silent). The chip still has to
 * carry a word, and `article:30023:8f2…:mein-text` is not one. So: the `d` of a coordinate,
 * the `h` of a room, the slug of a meetup, a shortened key for a person.
 *
 * Pure and therefore askable: the impure half replaces this with a real name wherever it has
 * one (room name, profile name), and this is what stands when it does not.
 */
export const pinChipFallback = (key: string): string => {
    const at = key.indexOf(':')
    if (at < 1) {
        return key
    }
    const prefix = key.slice(0, at)
    const value = key.slice(at + 1)
    if (prefix === 'room') {
        return roomKeyParts(key)?.h ?? value
    }
    if (prefix === 'article' || prefix === 'repo') {
        // A NIP-01 coordinate is `kind:pubkey:d`; the `d` is the only human part of it.
        const parts = value.split(':')

        return parts.length >= 3 ? parts.slice(2).join(':') : value
    }
    if (prefix === 'person') {
        return value.length > 12 ? `${value.slice(0, 8)}…` : value
    }

    return value
}

// ── Write path ─────────────────────────────────────────────────────────────────

/**
 * Store → the exact payload string, keys in sorted order.
 *
 * Sorted because the caller compares this string against the last confirmed one to decide
 * whether a publish would be a no-op. Without a fixed order that comparison would hang on
 * object insertion order and republish an unchanged set — one signature per tab switch.
 */
export const pinPayloadJson = (store: PinSet): string => {
    const pins: Record<string, PinEntry> = {}
    for (const key of Object.keys(store.pins).sort()) {
        const entry = store.pins[key]
        pins[key] = { on: entry.on, at: entry.at, pos: entry.pos }
    }

    return JSON.stringify({ v: PIN_VERSION, pins })
}

/** `created_at` of the next publish — the shared rule, see the import at the top. */
export const nextPinCreatedAt = (nowSec: number, remoteHead: number): number =>
    nextPrefsCreatedAt(nowSec, remoteHead)

/** Everything the impure half needs to build the event. */
export type PinPublishPlan = {
    /** The PLAINTEXT payload — encrypting it is the impure half's job. */
    json: string
    /** `[["d","einundzwanzig/pins"]]` — no other tags (D7). */
    tags: string[][]
    createdAt: number
}

/** Why a publish is not happening. Each reason differs in what the caller must do next. */
export type PinSkipReason =
    /** **No relay closed our read with an `EOSE`.** Writing now replaces a set we never saw. */
    | 'unanswered'
    /** The stored payload carries a `v` this client does not understand (D7). */
    | 'read-only'
    /** Identity changed under us mid-publish. Keep the pending mark; the new identity owns nothing here. */
    | 'stale'
    /** Only the local default seed is in the set — D8 forbids publishing that by itself. */
    | 'default-only'
    /** Byte-identical to what a relay already confirmed. */
    | 'unchanged'
    /** No signed-in identity, so no address and no key to encrypt to. */
    | 'no-identity'

export type PinPublishDecision =
    | { go: false; reason: PinSkipReason }
    | { go: true; plan: PinPublishPlan }

/**
 * **The whole decision of a pin publish, in one pure function.**
 *
 * It exists in this shape for the same reason `decideChannelPrefsPublish` does: the ways
 * NOT to send are exactly the ways this feature loses data quietly, and none of them is
 * reachable from a browser test. `unanswered` needs a relay that accepts a connection and
 * never sends `EOSE` (this repo has measured that a hanging AUTH round does exactly that),
 * `stale` needs a logout inside a two-second window, `default-only` needs a fresh identity
 * on a device that has never pinned anything.
 *
 * The order is load-bearing: identity, then the two REFUSALS that protect foreign data,
 * then the two that only save a signature. A caller that reverses the last two still
 * behaves correctly; one that reverses the first two writes a set it never read.
 */
export const decidePinPublish = (input: {
    store: PinSet
    self: string
    /** Did at least ONE target relay close our read with an `EOSE`? */
    answered: boolean
    /** Did the stored payload carry an unknown `v`? */
    readOnly: boolean
    nowSec: number
    remoteHead: number
    lastPublishedJson: string | undefined
    capturedEpoch: number
    currentEpoch: number
}): PinPublishDecision => {
    if (!input.self) {
        return { go: false, reason: 'no-identity' }
    }
    if (input.capturedEpoch !== input.currentEpoch) {
        return { go: false, reason: 'stale' }
    }
    if (!input.answered) {
        return { go: false, reason: 'unanswered' }
    }
    if (input.readOnly) {
        return { go: false, reason: 'read-only' }
    }
    if (!hasUserPin(input.store)) {
        return { go: false, reason: 'default-only' }
    }
    const json = pinPayloadJson(input.store)
    if (json === input.lastPublishedJson) {
        return { go: false, reason: 'unchanged' }
    }

    return {
        go: true,
        plan: {
            json,
            tags: [['d', PIN_D]],
            createdAt: nextPinCreatedAt(input.nowSec, input.remoteHead),
        },
    }
}

/**
 * Did at least ONE relay accept the publish? Pure and parameterised over the token so this
 * module stays free of `@welshman/net`; the caller passes `PublishStatus.Success`.
 *
 * **An empty result map is `false`, not `true`** — a publish that produced no verdict must
 * not be remembered as delivered, or the pin is silently gone after the next reload.
 */
export const anyRelayAccepted = (
    results: Record<string, { status: string }>,
    successStatus: string,
): boolean => Object.values(results).some((result) => result.status === successStatus)

// ── The fork: which write path owns this key ────────────────────────────────────

/**
 * Where a toggle of this key has to go.
 *
 * `'stars'` — a room of the **Buzz workspace**: its pin is Buzz' `channel-stars` blob, so
 * Buzz Desktop and this client keep ONE truth about a starred channel (D7). Writing such a
 * room into our own blob as well would create a second "angeheftet" that drifts.
 *
 * `'blob'` — everything else, including rooms of the zooid space, which Buzz' blob cannot
 * address at all (its keys are channel UUIDs of one relay).
 *
 * `workspaceUrl === ''` (no workspace configured) therefore routes every room to the blob.
 * The comparison is on the **already normalised** URLs the caller holds — normalising here
 * would need a welshman import and would be a second URL truth (memory:
 * `url-identitaet-faengt-kanonische-ip-nicht`).
 */
export const pinWriteRoute = (key: string, workspaceUrl: string): 'stars' | 'blob' => {
    const parts = roomKeyParts(key)
    if (parts && workspaceUrl !== '' && parts.relay === workspaceUrl) {
        return 'stars'
    }

    return 'blob'
}

/**
 * The union both surfaces show (D7: "one selector, no second truth"): the blob's pinned
 * keys plus the Buzz-starred channels, expressed as `room:<h>@<workspace>` keys.
 *
 * The blob comes first and the stars follow in their own order; a channel that is starred
 * in Buzz AND pinned in the blob (possible if a client wrote the key before this fork
 * existed) appears exactly once.
 */
export const unionPinnedKeys = (
    blobKeys: readonly string[],
    starredHs: readonly string[],
    workspaceUrl: string,
): string[] => {
    const out = [...blobKeys]
    const seen = new Set(out)
    if (workspaceUrl === '') {
        return out
    }
    for (const h of starredHs) {
        const key = roomPinKey(h, workspaceUrl)
        if (!seen.has(key)) {
            seen.add(key)
            out.push(key)
        }
    }

    return out
}
