/**
 * Private reminders over NIP-ER (Buzz kind 30300) — the pure half.
 *
 * Counterpart to `reminders.ts` (store, signer, relay). Browser-free and store-free like
 * `moderationTimeoutModels.ts` and `bookmarkModels.ts`, so every rule below is decidable
 * under `node --test`. Relative imports carry the `.ts` extension: the file has to load
 * from Vite **and** from the node test runner.
 *
 * ══ What the relay enforces, read off the producer ══════════════════════════════
 *
 * `crates/buzz-relay/src/handlers/ingest.rs` `validate_event_reminder` (`:1766-1834`)
 * and `validate_not_before` (`:1735-1755`), read at `fc0d2bc5`:
 *
 *  - **exactly one `d` tag, non-empty** — `missing d tag` / `duplicate d tag` /
 *    `empty d tag`;
 *  - **at most one `not_before`**, a decimal integer string of ASCII digits only, no
 *    sign, no leading zero except the literal `"0"`, `<= 9007199254740991` —
 *    `malformed not_before` for every violation, duplicates included;
 *  - `not_before <= now + max_not_before_delta` — `not_before too far in future`;
 *  - when **both** `not_before` and `expiration` are present, `expiration` must be
 *    strictly greater — `expiration before not_before`.
 *
 * Everything this module builds is checked against those rules **before** signing
 * ({@link validateReminderTags} runs inside {@link planReminder}), because an event the
 * relay refuses costs a signature prompt on the user's signing device and produces
 * nothing. That is the same construction P2–P4 use: the gate is the return value.
 *
 * ── Three places where this module is stricter than the relay, on purpose ────────
 *
 * 1. **`d` must carry ≥128 bits of entropy** (NIP-ER: *"`d` MUST be an opaque random
 *    value with at least 128 bits of entropy and MUST NOT be derived from the target
 *    event, reminder text, or reminder time"*). The relay checks only that the tag
 *    exists and is non-empty — it cannot check entropy, and it does not try. The
 *    requirement is a privacy one and it is ours to keep: the `d` tag is **public**, and
 *    a `d` derived from the target id would tell the relay exactly what the encrypted
 *    content is hiding. {@link makeReminderD} is therefore the only way a `d` is minted
 *    here, and it takes its bytes from the platform CSPRNG.
 * 2. **The horizon is read, not assumed** ({@link maxNotBeforeDelta} in `relayCaps.ts`).
 * 3. **A terminal state never carries `not_before`.** NIP-ER: *"Because relays cannot
 *    read `status`, clients MUST omit `not_before` on `done` and `cancelled`
 *    replacements."* A `done` that kept its `not_before` would stay in the relay's due
 *    query (`buzz-db/src/event.rs:1400-1420`: `not_before IS NOT NULL AND not_before <=
 *    now`) and be pushed again as due — a reminder that cannot be finished.
 *
 * ══ The content is encrypted, and that is a property of this module ═════════════
 *
 * `.content` MUST be a NIP-44 ciphertext to the author's own key (NIP-ER, same
 * self-encryption as NIP-51 private lists). The encryption itself needs a signer and is
 * therefore impure — but the **decision** is not, and that is why {@link buildReminderEvent}
 * exists: the plan carries a `plaintext`, never a `content`, and the only function that
 * produces a `content` is one that must be handed an encryptor and refuses an answer that
 * is empty or unchanged.
 *
 * That last guard is not decoration. `nip44EncryptToSelf` goes through whatever signer is
 * active — Amber over NIP-55, a bunker over NIP-46, both of them foreign processes that
 * answer over a string channel. A malformed answer that echoes the request would publish
 * the user's private note **in the clear, to a relay, under their own key**, and nothing
 * downstream would notice: the relay never decrypts, and our own read path would parse it
 * happily. One comparison closes that.
 */
import { maxNotBeforeDelta } from './relayCaps.ts'
import { mayWriteKind, NIP_ER_EXTENSION } from './relayCapability.ts'
import type { SpaceKind } from './spaceCaps.ts'

/**
 * NIP-ER event reminder (`KIND_EVENT_REMINDER`, `buzz-core/src/kind.rs:102`).
 *
 * Lives in this pure module and not next to the Buzz kinds in `buzzAdmin.ts`, for the
 * reason `FORUM_VOTE` lives in `forumModels.ts` and `BUZZ_TIMEOUT` in
 * `moderationTimeoutModels.ts`: those files import welshman and cannot be loaded by the
 * node test runner, and a rule whose kind number is unreachable from a test is a rule
 * nobody can check.
 */
export const EVENT_REMINDER = 30300

/** Re-export so a call site needs one import, not two. See `relayCapability.ts`. */
export { NIP_ER_EXTENSION }

/**
 * NIP-31 fallback text. Deliberately a constant and deliberately content-free: the tag is
 * **public**, and a client that put the reminder note in here would undo the encryption
 * it just performed. The wording is the one the NIP-ER examples use.
 */
export const REMINDER_ALT = 'Encrypted reminder'

/** NIP-ER: `9007199254740991`, the interoperable JSON integer bound the spec mandates. */
export const MAX_NOT_BEFORE = Number.MAX_SAFE_INTEGER

/** Bits of entropy a `d` tag must carry (NIP-ER). 16 bytes → 32 lowercase hex chars. */
export const REMINDER_D_ENTROPY_BITS = 128

/** The three states NIP-ER defines. Anything else is ignored, never guessed. */
export type ReminderStatus = 'pending' | 'done' | 'cancelled'

/** What a reminder points at. Every field optional — a note-only reminder is valid. */
export type ReminderTarget = {
    id?: string
    a?: string
    relays?: string[]
    preview?: string
}

/** The decrypted plaintext of a 30300, after validation. */
export type ReminderContent = {
    target?: ReminderTarget
    status: ReminderStatus
    note?: string
}

/** A planned 30300 — `plaintext`, never `content`. See the module header. */
export type ReminderPlan = {
    kind: typeof EVENT_REMINDER
    tags: string[][]
    /** The JSON that {@link buildReminderEvent} will encrypt. Never published as is. */
    plaintext: string
}

/** A 30300 ready to sign. Only {@link buildReminderEvent} produces one. */
export type ReminderEvent = {
    kind: typeof EVENT_REMINDER
    content: string
    tags: string[][]
}

/** The shape this module needs off a stored event — no welshman types. */
export type ReminderEventLike = {
    id: string
    pubkey: string
    created_at: number
    content: string
    tags: string[][]
}

// ── Form rules ───────────────────────────────────────────────────────────────────

/** 64 lowercase hex — a NIP-01 event id. */
const isEventId = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)

/**
 * `<kind>:<pubkey>:<d>` — a syntactically valid NIP-01 address.
 *
 * `d` may be empty (a plain replaceable coordinate is written `10002:<pk>:`), so the
 * check is on the first two parts and on there being exactly three.
 */
const isAddress = (value: unknown): value is string => {
    if (typeof value !== 'string') {
        return false
    }
    const parts = value.split(':')

    return parts.length === 3 && /^[0-9]{1,5}$/.test(parts[0]) && /^[0-9a-f]{64}$/.test(parts[1])
}

/** Absolute `ws://`/`wss://` with a non-empty host — NIP-ER's rule for `target.relays`. */
const isRelayUrl = (value: unknown): value is string => {
    if (typeof value !== 'string') {
        return false
    }
    try {
        const url = new URL(value)

        return (url.protocol === 'ws:' || url.protocol === 'wss:') && url.hostname !== ''
    } catch {
        return false
    }
}

/**
 * The canonical decimal form NIP-ER demands of `not_before`, mirrored from the relay's
 * `validate_not_before`.
 *
 * The leading-zero rule is the one that surprises: `"007"` parses fine in every language
 * and is still rejected, so that each timestamp has exactly one wire form. `"0"` is the
 * one value allowed to begin with a zero. The upper bound is checked as an exact integer,
 * never through a float — `Number("9007199254740993")` silently rounds, which is the
 * reason the spec spells the bound out.
 */
export const isCanonicalTimestamp = (value: string): boolean => {
    if (!/^[0-9]+$/.test(value)) {
        return false
    }
    if (value.length > 1 && value.startsWith('0')) {
        return false
    }
    // Compare as a string before touching Number: an 18-digit input would already have
    // lost precision by the time it reached a numeric comparison.
    if (value.length > String(MAX_NOT_BEFORE).length) {
        return false
    }
    if (value.length === String(MAX_NOT_BEFORE).length && value > String(MAX_NOT_BEFORE)) {
        return false
    }

    return true
}

/**
 * The relay's envelope rules over a tag list — the whole of `validate_event_reminder`.
 * Returns `''` when the relay would accept the envelope, otherwise the relay's own
 * wording, so a rejection here and a rejection there read the same.
 *
 * `now` and `maxDelta` are parameters, never read here: the horizon check needs a clock,
 * and a rule that reads the wall clock is a rule with a flake in it (the house rule every
 * TTL in this package follows, stated in `storagePersistKinds.test.ts`).
 *
 * **Tags shorter than two entries are skipped**, exactly as the relay skips them
 * (`if parts.len() < 2 { continue }`). A bare `["d"]` is therefore not an empty `d` tag
 * to either side — it is no `d` tag at all, and the answer is `missing d tag`.
 */
export const validateReminderTags = (tags: string[][], now: number, maxDelta: number): string => {
    let dCount = 0
    let dEmpty = false
    let notBefore: string | null = null
    let duplicateNotBefore = false
    let expiration: string | null = null

    for (const tag of tags) {
        if (!Array.isArray(tag) || tag.length < 2) {
            continue
        }
        if (tag[0] === 'd') {
            dCount += 1
            if (tag[1] === '') {
                dEmpty = true
            }
        } else if (tag[0] === 'not_before') {
            if (notBefore !== null) {
                duplicateNotBefore = true
            } else {
                notBefore = tag[1]
            }
        } else if (tag[0] === 'expiration') {
            expiration = tag[1]
        }
    }

    if (dCount === 0) {
        return 'missing d tag'
    }
    if (dCount > 1) {
        return 'duplicate d tag'
    }
    if (dEmpty) {
        return 'empty d tag'
    }
    if (duplicateNotBefore || (notBefore !== null && !isCanonicalTimestamp(notBefore))) {
        return 'malformed not_before'
    }

    if (notBefore !== null) {
        const nb = Number(notBefore)
        if (nb > now + maxDelta) {
            return 'not_before too far in future'
        }
        // Only checked when both are present — same as the relay, and same as NIP-ER:
        // a terminal reminder carries `expiration` and no `not_before` at all.
        if (expiration !== null && /^[0-9]+$/.test(expiration) && Number(expiration) <= nb) {
            return 'expiration before not_before'
        }
    }

    return ''
}

// ── Minting a `d` ────────────────────────────────────────────────────────────────

/** Injectable so the test can mint a known `d`; production passes nothing. */
export type RandomBytes = (length: number) => Uint8Array

const cryptoRandomBytes: RandomBytes = (length) => globalThis.crypto.getRandomValues(new Uint8Array(length))

/**
 * A fresh reminder address component: {@link REMINDER_D_ENTROPY_BITS} bits of CSPRNG
 * output as lowercase hex.
 *
 * **Never derived from anything.** NIP-ER forbids deriving `d` from the target event, the
 * reminder text or the reminder time, and the reason is visible in this module's own
 * privacy table: the relay sees `pubkey`, `not_before` and the set of `d` values. A `d`
 * that is a hash of the target id would hand it the one thing NIP-44 was applied to hide,
 * and it would do so for every client that ever reads the address.
 */
export const makeReminderD = (randomBytes: RandomBytes = cryptoRandomBytes): string =>
    Array.from(randomBytes(REMINDER_D_ENTROPY_BITS / 8))
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('')

// ── The content ──────────────────────────────────────────────────────────────────

/**
 * Does this JSON text contain a duplicate member name in any object?
 *
 * NIP-ER: *"Clients MUST ignore … plaintext with duplicate member names in any object"*.
 * `JSON.parse` cannot answer this — it builds the object first and the loser of the
 * duplicate is gone before any reviver runs — so the question is asked of the **text**.
 *
 * The scanner walks the string once, string-aware (a `{`, `}` or `"` inside a string
 * literal is data, and a `\"` does not end the literal). It tracks one key set per open
 * object and reports the first repeat. It is deliberately used **only** for this boolean:
 * the value itself still comes from `JSON.parse`, so a bug in here can at worst reject a
 * reminder — never mis-parse one.
 *
 * Why the rule matters for a self-encrypted document at all: it is a convergence rule,
 * not a security one. Two clients that disagree about which of two `"status"` members
 * wins disagree about whether a reminder is done — and the author sees a different answer
 * per device, with no way to tell which is right.
 */
export const hasDuplicateJsonKeys = (text: string): boolean => {
    const stack: Set<string>[] = []
    let i = 0
    // The last string literal read, and whether it sat directly before a `:` — that is
    // what makes it a member name rather than a value.
    let lastString: string | null = null

    while (i < text.length) {
        const ch = text[i]
        if (ch === '"') {
            let out = ''
            i += 1
            while (i < text.length && text[i] !== '"') {
                if (text[i] === '\\') {
                    out += text[i] + (text[i + 1] ?? '')
                    i += 2
                } else {
                    out += text[i]
                    i += 1
                }
            }
            i += 1 // closing quote
            lastString = out
            continue
        }
        if (ch === '{') {
            stack.push(new Set())
            lastString = null
        } else if (ch === '}') {
            stack.pop()
            lastString = null
        } else if (ch === '[' || ch === ']' || ch === ',') {
            lastString = null
        } else if (ch === ':') {
            const keys = stack[stack.length - 1]
            if (keys && lastString !== null) {
                if (keys.has(lastString)) {
                    return true
                }
                keys.add(lastString)
            }
            lastString = null
        }
        i += 1
    }

    return false
}

const isStatus = (value: unknown): value is ReminderStatus =>
    value === 'pending' || value === 'done' || value === 'cancelled'

/**
 * Decrypted plaintext → validated {@link ReminderContent}, or `null`.
 *
 * `null` for every case NIP-ER tells a client to ignore: not an object, duplicate member
 * names, unknown `status`, a `target.id` that is not 64 lowercase hex, a `target.a` that
 * is not a NIP-01 address, a non-string `preview`/`note`, and a `pending` reminder with
 * neither a usable target reference nor a note.
 *
 * `target.relays` is the one field filtered rather than rejected — the spec says so
 * explicitly (*"clients MUST ignore entries that are not absolute `ws://` or `wss://`
 * URLs"*), and a bad hint is not a reason to lose the reminder that carries it.
 *
 * Unknown fields are kept out rather than carried through: this client re-serialises the
 * content on every replacement, and a field it does not understand would either be
 * dropped silently or copied blindly. Dropping it **visibly** — the reminder still works,
 * the unknown extension does not — is the direction that never surprises. Stated here
 * because the spec allows carrying them.
 */
export const parseReminderContent = (plaintext: string | undefined): ReminderContent | null => {
    if (!plaintext || hasDuplicateJsonKeys(plaintext)) {
        return null
    }
    let raw: unknown
    try {
        raw = JSON.parse(plaintext)
    } catch {
        return null
    }
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
        return null
    }
    const obj = raw as Record<string, unknown>
    if (!isStatus(obj.status)) {
        return null
    }
    if (obj.note !== undefined && typeof obj.note !== 'string') {
        return null
    }

    let target: ReminderTarget | undefined
    if (obj.target !== undefined) {
        if (typeof obj.target !== 'object' || obj.target === null || Array.isArray(obj.target)) {
            return null
        }
        const rawTarget = obj.target as Record<string, unknown>
        if (rawTarget.id !== undefined && !isEventId(rawTarget.id)) {
            return null
        }
        if (rawTarget.a !== undefined && !isAddress(rawTarget.a)) {
            return null
        }
        if (rawTarget.preview !== undefined && typeof rawTarget.preview !== 'string') {
            return null
        }
        if (rawTarget.relays !== undefined && !Array.isArray(rawTarget.relays)) {
            return null
        }
        const relays = Array.isArray(rawTarget.relays) ? rawTarget.relays.filter(isRelayUrl) : undefined
        target = {
            ...(typeof rawTarget.id === 'string' ? { id: rawTarget.id } : {}),
            ...(typeof rawTarget.a === 'string' ? { a: rawTarget.a } : {}),
            ...(relays && relays.length > 0 ? { relays } : {}),
            ...(typeof rawTarget.preview === 'string' ? { preview: rawTarget.preview } : {}),
        }
    }

    const note = typeof obj.note === 'string' ? obj.note : undefined
    const hasReference = Boolean(target?.id || target?.a)
    if (obj.status === 'pending' && !hasReference && !(note ?? '').trim()) {
        return null
    }

    return {
        ...(target ? { target } : {}),
        status: obj.status,
        ...(note !== undefined ? { note } : {}),
    }
}

/** {@link ReminderContent} → the JSON that gets encrypted. Field order is fixed. */
export const reminderPlaintext = (content: ReminderContent): string =>
    JSON.stringify({
        ...(content.target ? { target: content.target } : {}),
        status: content.status,
        ...(content.note !== undefined ? { note: content.note } : {}),
    })

// ── Building the event ───────────────────────────────────────────────────────────

/** What {@link buildReminderEvent} needs: NIP-44 to the author's own key. */
export type EncryptToSelf = (plaintext: string) => Promise<string>

/**
 * Plan + encryptor → a signable 30300. **The only way a `content` comes into being.**
 *
 * Throws rather than returning `null` on a bad ciphertext, and that asymmetry is
 * deliberate: everywhere else in this phase a refusal means "the surface may not do
 * this", which is a state the user can be shown. Here it means the signing device
 * answered something impossible, and the only safe reaction is to not publish at all.
 * A `null` would join the other `null`s at the call site and be rendered as "the space
 * refused" — a wrong explanation for a broken signer.
 *
 * Two refusals, both cheap and both real:
 *  - an **empty** answer: NIP-44 output is never empty, and an empty `content` would be
 *    a reminder with no content that this client would then fail to parse forever;
 *  - an answer **equal to the plaintext**: a signer that echoes its input would publish
 *    the private note in the clear, under the author's own key, to a relay that keeps it
 *    (30300 is stored, not ephemeral). Nothing downstream would catch it — the relay
 *    never decrypts, and our own reader would parse the plaintext happily.
 */
export const buildReminderEvent = async (plan: ReminderPlan, encryptToSelf: EncryptToSelf): Promise<ReminderEvent> => {
    const content = await encryptToSelf(plan.plaintext)
    if (!content) {
        throw new Error('reminder: the signer returned an empty ciphertext')
    }
    if (content === plan.plaintext) {
        throw new Error('reminder: the signer returned the plaintext unchanged')
    }

    return { kind: plan.kind, content, tags: plan.tags }
}

// ── The offered delays ───────────────────────────────────────────────────────────

const HOUR = 60 * 60
const DAY = 24 * HOUR

/** One choice in the reminder dialog. `key` is the translation key of its label. */
export type ReminderDelay = { key: string; seconds: number }

/**
 * The delays the dialog offers, shortest first.
 *
 * Plain durations, no calendar words: "tomorrow morning" would need the user's timezone
 * and would then be a lie for anyone whose device disagrees with it. `not_before` is a
 * unix second, and "in 1 day" means the same thing everywhere.
 */
export const REMINDER_DELAYS: readonly ReminderDelay[] = [
    { key: 'In 1 Stunde', seconds: HOUR },
    { key: 'In 3 Stunden', seconds: 3 * HOUR },
    { key: 'In 1 Tag', seconds: DAY },
    { key: 'In 3 Tagen', seconds: 3 * DAY },
    { key: 'In 1 Woche', seconds: 7 * DAY },
]

/**
 * The subset of {@link REMINDER_DELAYS} this relay would accept — the horizon applied to
 * the menu instead of to the error message.
 *
 * `maxDelta === null` (relay states no horizon) yields an **empty** list, and the surface
 * that renders it therefore offers nothing. See {@link maxNotBeforeDelta} for why that is
 * the fail-closed direction and why it cannot happen against Buzz.
 */
export const availableDelays = (maxDelta: number | null): ReminderDelay[] =>
    maxDelta === null ? [] : REMINDER_DELAYS.filter((delay) => delay.seconds <= maxDelta)

// ── Planning a write ─────────────────────────────────────────────────────────────

/** How long a finished reminder lingers before the relay drops it: 30 to 90 days. */
export const CLEANUP_MIN_SECONDS = 30 * DAY
export const CLEANUP_MAX_SECONDS = 90 * DAY

/**
 * `expiration` for a terminal replacement — NIP-40 cleanup, jittered as NIP-ER suggests.
 *
 * The jitter is not cosmetic. Without it every reminder completed in the same session
 * expires in the same second, and the relay's expiry sweep would then delete them in one
 * batch — which tells an observer of the relay how many reminders that author finished
 * at that moment. `random` is injected so the test does not depend on a coin flip.
 */
export const cleanupExpiration = (nowSecs: number, random = Math.random): number =>
    nowSecs + CLEANUP_MIN_SECONDS + Math.floor(random() * (CLEANUP_MAX_SECONDS - CLEANUP_MIN_SECONDS))

/** Everything {@link planReminder} needs beyond the reminder itself. */
export type ReminderContext = {
    nowSecs: number
    spaceKind: SpaceKind
    /** The NIP-11 doc of the relay the write goes to. */
    profile?: { supported_extensions?: string[]; limitation?: { max_not_before_delta?: number } }
}

/**
 * **The gate and the event body in one decision.** `null` means: do not write.
 *
 * The same construction as `planTimeout` (`moderationTimeoutModels.ts`), `planForumVote`
 * and `planBookmarkWrite`, and for the same reason: the phase's promise is that
 * `mayWriteKind` is asked *before* signing, and a gate call whose result is dropped looks
 * exactly like one that is honoured. Here the gate's answer decides whether a plan exists
 * at all, so a caller that publishes without asking has nothing to publish.
 *
 * For 30300 the gate is the strictest in the table: `relay: 'buzz'` **plus** the
 * `nip-er` extension out of NIP-11. Both conditions earn their place —
 *
 *  - on **zooid** the kind is meaningless in the worst possible way: no kind allowlist,
 *    so the reminder would be **stored** forever, encrypted, scheduled by nobody
 *    (`relayCapability.ts` writes that out in full);
 *  - on a **Buzz without the NIP-ER scheduler** the event is accepted and then never
 *    becomes due — the one failure this surface must not have, because the user's only
 *    evidence that it worked is that the reminder arrives.
 *
 * `'unknown'` — the state while the NIP-11 doc is in flight — denies as well.
 *
 * ── The two shapes ──────────────────────────────────────────────────────────────
 *
 * A **pending** reminder carries exactly one `not_before` and no `expiration`; a
 * **terminal** one (`done`/`cancelled`) carries no `not_before` and an `expiration`.
 * NIP-ER requires both directions, and the relay depends on the second: its due query
 * selects on `not_before IS NOT NULL`, so a `done` that kept the tag would keep coming
 * back as due.
 *
 * The envelope is checked against the relay's own rules before it is returned
 * ({@link validateReminderTags}). That check is not belt-and-braces — the horizon it
 * applies comes from the NIP-11 doc of this very relay, so it is the only place where
 * "the relay will accept this" is actually decided.
 */
export const planReminder = (
    d: string,
    content: ReminderContent,
    delaySecs: number | null,
    ctx: ReminderContext,
    random = Math.random,
): ReminderPlan | null => {
    if (!mayWriteKind(EVENT_REMINDER, ctx.spaceKind, ctx.profile)) {
        return null
    }
    const maxDelta = maxNotBeforeDelta(ctx.profile)
    if (maxDelta === null) {
        return null
    }
    if (!d || !Number.isSafeInteger(ctx.nowSecs) || ctx.nowSecs <= 0) {
        return null
    }

    const tags: string[][] = [['d', d]]
    if (content.status === 'pending') {
        // A pending reminder without a due time is a bookmark, and this client already has
        // one of those (P2, NIP-51). Offering a second, encrypted, invisible one would be
        // two answers to the same question.
        if (delaySecs === null || !Number.isSafeInteger(delaySecs) || delaySecs <= 0 || delaySecs > maxDelta) {
            return null
        }
        tags.push(['not_before', String(ctx.nowSecs + delaySecs)])
    } else {
        tags.push(['expiration', String(cleanupExpiration(ctx.nowSecs, random))])
    }
    tags.push(['alt', REMINDER_ALT])

    if (validateReminderTags(tags, ctx.nowSecs, maxDelta) !== '') {
        return null
    }

    const plaintext = reminderPlaintext(content)
    // A content this client cannot read back is a reminder it cannot finish. Cheaper to
    // find here than after it is signed, encrypted and accepted.
    if (parseReminderContent(plaintext) === null) {
        return null
    }

    return { kind: EVENT_REMINDER, tags, plaintext }
}

/** How long a cached preview may be. Encrypted, but still: no need to store an essay. */
export const PREVIEW_MAX_CHARS = 140

/**
 * The target of a reminder on a chat message. `relays` is a **hint**, as NIP-ER says, and
 * carries the one relay this client actually read the message from.
 */
export const reminderTargetFor = (eventId: string, url: string, preview: string): ReminderTarget | null => {
    if (!isEventId(eventId)) {
        return null
    }
    const trimmed = preview.trim().replace(/\s+/g, ' ').slice(0, PREVIEW_MAX_CHARS)

    return {
        id: eventId,
        ...(isRelayUrl(url) ? { relays: [url] } : {}),
        ...(trimmed ? { preview: trimmed } : {}),
    }
}

// ── Reading reminders back ───────────────────────────────────────────────────────

/** One reminder, folded and decrypted, as the surface renders it. */
export type Reminder = {
    /** Event id of the head — the deduplication key NIP-ER prescribes, next to `d`. */
    id: string
    d: string
    status: ReminderStatus
    /** `null` for a terminal reminder, or a pending one whose tag is unusable. */
    notBefore: number | null
    note: string
    target: ReminderTarget | null
    createdAt: number
}

/**
 * The `d` of an event, or `''` — the address component NIP-01 replacement is keyed on.
 * Only the **first** `d` counts here; an event with two would already have been refused
 * by {@link validateReminderTags} on the way out and by the relay on the way in.
 */
export const reminderD = (event: ReminderEventLike): string =>
    event.tags.find((tag) => tag[0] === 'd' && typeof tag[1] === 'string')?.[1] ?? ''

/**
 * The single valid `not_before` of an event, or `null`.
 *
 * `null` covers three different things on purpose — no tag, more than one tag, and a
 * non-canonical value — because NIP-ER folds them into one client rule: *"Clients MUST
 * ignore pending reminders without exactly one valid `not_before`."*
 */
export const reminderNotBefore = (event: ReminderEventLike): number | null => {
    const values = event.tags.filter((tag) => tag[0] === 'not_before').map((tag) => tag[1])
    if (values.length !== 1 || typeof values[0] !== 'string' || !isCanonicalTimestamp(values[0])) {
        return null
    }

    return Number(values[0])
}

/**
 * Fold a pile of 30300 into one reminder per address, newest wins.
 *
 * NIP-01 replacement ordering, spelled out by NIP-ER: *"the event with the highest
 * `created_at`; ties are broken by lowest lexicographic `id`"*. The tie-break is not
 * theoretical here — a snooze and a completion clicked in the same second on two devices
 * produce exactly that, and without a deterministic rule the two devices would disagree
 * about whether the reminder is done.
 *
 * `plaintextById` is the decryption, supplied by the caller: decrypting needs a signer and
 * does not belong in a pure module. An entry that is missing or unreadable drops the
 * reminder — NIP-ER: *"Clients MUST ignore plaintext they cannot decrypt."*
 *
 * Foreign authors are dropped too. The read filter is `authors:[self]` and the relay
 * enforces author-only reads for 30300, so a foreign 30300 can only come from a relay
 * that broke both — and a reminder that decrypts under our key is by construction ours.
 */
export const foldReminders = (
    events: readonly ReminderEventLike[],
    self: string,
    plaintextById: ReadonlyMap<string, string | undefined>,
): Reminder[] => {
    const heads = new Map<string, ReminderEventLike>()
    for (const event of events) {
        if (event.pubkey !== self) {
            continue
        }
        const d = reminderD(event)
        if (!d) {
            continue
        }
        const current = heads.get(d)
        if (
            !current ||
            event.created_at > current.created_at ||
            (event.created_at === current.created_at && event.id < current.id)
        ) {
            heads.set(d, event)
        }
    }

    const out: Reminder[] = []
    for (const [d, event] of heads) {
        const content = parseReminderContent(plaintextById.get(event.id))
        if (!content) {
            continue
        }
        out.push({
            id: event.id,
            d,
            status: content.status,
            // NIP-ER: a head that decrypts to a terminal status is terminal even if it
            // still carries `not_before` — the tag is then a leftover, not a schedule.
            notBefore: content.status === 'pending' ? reminderNotBefore(event) : null,
            note: content.note ?? '',
            target: content.target ?? null,
            createdAt: event.created_at,
        })
    }

    return out
}

/**
 * The reminders that are due **now**, soonest first.
 *
 * `now` is a parameter, and this function is the whole of NIP-ER's *"Clients MUST enforce
 * `not_before` locally even when a relay serves an event early or does not support this
 * NIP."* The relay's due signal is a nudge to re-evaluate, never the decision: a relay can
 * serve early, late, repeatedly or not at all, and `not_before` is explicitly not a
 * security boundary.
 *
 * A pending reminder without exactly one valid `not_before` is not due and never will be —
 * it is dropped by {@link foldReminders} already (`notBefore: null`) and filtered again
 * here, because "ignore it" is the spec's word for both.
 */
export const dueReminders = (reminders: readonly Reminder[], now: number): Reminder[] =>
    reminders
        .filter((r) => r.status === 'pending' && r.notBefore !== null && r.notBefore <= now)
        .sort((a, b) => (a.notBefore ?? 0) - (b.notBefore ?? 0) || (a.id < b.id ? -1 : 1))

/** The pending reminders that have not come due yet, soonest first. */
export const pendingReminders = (reminders: readonly Reminder[], now: number): Reminder[] =>
    reminders
        .filter((r) => r.status === 'pending' && r.notBefore !== null && r.notBefore > now)
        .sort((a, b) => (a.notBefore ?? 0) - (b.notBefore ?? 0) || (a.id < b.id ? -1 : 1))
