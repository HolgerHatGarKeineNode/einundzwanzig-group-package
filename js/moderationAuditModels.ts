/**
 * The moderation history (`GET /moderation/audit`) — the pure half.
 *
 * Counterpart to `buzzAdmin.ts` (signer, relay, HTTP) and to `moderationAudit.ts` (the
 * Alpine island). Browser-free and store-free like `moderationTimeoutModels.ts`, so every
 * rule below is decidable under `node --test`. Relative imports carry the `.ts`
 * extension: the file has to load from Vite **and** from the node test runner.
 *
 * ══ Why this surface exists at all ══════════════════════════════════════════════
 *
 * 9042/9043 (timed suspension and its lifting) have been buildable since the previous
 * plan, but nothing a moderator does is readable afterwards: the relay executes those
 * commands and neither stores nor fans them out, so `REQ -k 9042` finds nothing by
 * construction (`moderationTimeoutModels.ts`, property 2). The audit log is the only
 * place a carried-out measure is on record — and until this phase the client never asked
 * for it. Its single caller was the E2E probe `tests/e2e/support/buzz-moderation.ts`.
 *
 * ══ The row shape, read off the producer ════════════════════════════════════════
 *
 * `action_json` in `crates/buzz-relay/src/api/bridge.rs` (buzz checkout, 2026-09-05):
 *
 *     {"id": <uuid>, "actor_pubkey": <hex>, "action": <string>,
 *      "target_pubkey": <hex|null>, "target_event_id": <hex|null>,
 *      "channel_id": <uuid|null>, "reason_code": <string|null>,
 *      "public_reason": <string|null>, "private_reason": <string|null>,
 *      "matched_principal": <string|null>, "created_at": <rfc3339>}
 *
 * and `list_moderation_actions` (`buzz-db/src/lib.rs:4696`) documents the order:
 * *„List moderation audit action rows, newest first."* The grouping below sorts anyway —
 * an order the client does not control is not an order the client should depend on.
 *
 * Two fields of that row are deliberately **not** carried into {@link AuditEntry}:
 * `private_reason` (mod-only wording that no surface of ours asks for) and
 * `matched_principal` (a NIP-OA enforcement detail). `created_at` is an RFC-3339 STRING
 * here, not a unix int — the same trap the report rows carry (`buzzAdmin.ts BuzzReport`).
 *
 * ══ 403 is an answer, not a defect ══════════════════════════════════════════════
 *
 * The route sits behind `authorize_moderation_read` (NIP-98 **plus** moderation
 * permission). Whoever lacks that permission gets `403 restricted: moderator access
 * required`. {@link parseAuditList} keeps that apart from every other failure the same
 * way `parseRestrictionList` does — and {@link auditDays}, the one function the island
 * calls, turns **every** failure into an empty list. A history nobody may read is a
 * surface that is not there, never an error banner.
 */
import { formatTimestamp } from './locale.ts'
import { t } from './i18n.ts'

/** One carried-out moderation measure, in the client's own vocabulary. */
export type AuditEntry = {
    /** Row id (UUID) — the key of the rendered row, never an event id. */
    id: string
    /** The moderator who issued the command. */
    actorPubkey: string
    /** Raw relay vocabulary: `ban` · `unban` · `timeout` · `untimeout` · `resolve:*` … */
    action: string
    /** The member the measure was aimed at, `''` when the target was content. */
    targetPubkey: string
    /** The event the measure was aimed at, `''` when the target was a person. */
    targetEventId: string
    /** The moderator's wording, or the machine reason code when there is none. */
    reason: string
    /** Unix **seconds** (parsed from the relay's RFC-3339 string). */
    createdAt: number
}

/**
 * Why a history could not be read. Same three answers as the restriction list, and for
 * the same reason: *you may not ask* has to stay distinguishable from *nothing happened*
 * for whoever debugs this later — even though the surface renders both as "no history".
 */
export type AuditListFailure = 'unauthorized' | 'forbidden' | 'unavailable'

export type AuditListResult =
    | { ok: true; entries: AuditEntry[] }
    | { ok: false; reason: AuditListFailure; status: number; detail: string }

const asText = (value: unknown): string => (typeof value === 'string' ? value : '')

const isHex64 = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)

/** RFC-3339 (what serde writes for a `DateTime<Utc>`) → unix seconds, `null` if unusable. */
const parseInstant = (value: unknown): number | null => {
    if (typeof value !== 'string' || value === '') {
        return null
    }
    const ms = Date.parse(value)

    return Number.isFinite(ms) ? Math.floor(ms / 1000) : null
}

/**
 * Parse one answer of `GET /moderation/audit`.
 *
 * Fail-closed in the same two directions as `parseRestrictionList`: a non-2xx status is a
 * failure and never an empty list, and a 200 whose body is not an array is a failure too
 * — a body of the wrong shape means we are talking to something other than this route,
 * and reading that as "nothing happened yet" is the silent-emptiness failure one layer up.
 *
 * A row without a usable `id`, `action` or `created_at` is dropped instead of guessed at:
 * it can neither be keyed nor grouped by day, and an entry stamped "today" because its
 * timestamp was unreadable would be a lie about a moderation record.
 */
export const parseAuditList = (status: number, body: unknown): AuditListResult => {
    if (status === 401) {
        return { ok: false, reason: 'unauthorized', status, detail: asText(body) }
    }
    if (status === 403) {
        return { ok: false, reason: 'forbidden', status, detail: asText(body) }
    }
    if (status < 200 || status >= 300) {
        return { ok: false, reason: 'unavailable', status, detail: asText(body) }
    }

    const envelope = body as { actions?: unknown } | null
    const rows = Array.isArray(body) ? body : Array.isArray(envelope?.actions) ? envelope.actions : null
    if (rows === null) {
        return { ok: false, reason: 'unavailable', status, detail: 'unexpected response shape (no array)' }
    }

    const entries = (rows as Record<string, unknown>[])
        .map((row): AuditEntry | null => {
            const createdAt = parseInstant(row?.created_at)
            const action = asText(row?.action)
            const id = asText(row?.id)
            if (createdAt === null || action === '' || id === '') {
                return null
            }

            return {
                id,
                actorPubkey: isHex64(row.actor_pubkey) ? row.actor_pubkey : '',
                action,
                targetPubkey: isHex64(row.target_pubkey) ? row.target_pubkey : '',
                targetEventId: isHex64(row.target_event_id) ? row.target_event_id : '',
                reason: asText(row.public_reason) || asText(row.reason_code),
                createdAt,
            }
        })
        .filter((entry): entry is AuditEntry => entry !== null)

    return { ok: true, entries }
}

/**
 * Relay vocabulary → the wording the moderator sees.
 *
 * The names come from the two places that write an audit row:
 * `handlers/moderation_commands.rs` (`ban`, `unban`, `timeout`, `untimeout`) and
 * `resolution_audit_action` in the same file (`dismiss_report`, `escalate`,
 * `resolve:delete|kick|ban|timeout|unknown`).
 *
 * **A label here is not a button.** `ban` and `kick` still appear in this list although
 * the association neither bans nor removes its members (decision 2026-09-03, latched by
 * `moderationSurfaceGate.ts`): the history shows what *did* happen, and older clients as
 * well as other tools on the same relay could have written such a row. Suppressing it
 * would be a history that lies. What stays absent is the operable element — and the two
 * forbidden labels `Bannen` / `Autor bannen` are deliberately not among these strings.
 *
 * An action this list does not know falls back to the raw relay word instead of being
 * hidden: a new relay verb should show up as itself, not disappear.
 */
export const auditActionLabel = (action: string): string => {
    switch (action) {
        case 'ban':
            return t('Gebannt')
        case 'unban':
            return t('Bann aufgehoben')
        case 'timeout':
            return t('Befristet gesperrt')
        case 'untimeout':
            return t('Sperre aufgehoben')
        case 'delete':
            return t('Inhalt entfernt')
        case 'kick':
            return t('Aus dem Raum entfernt')
        case 'dismiss_report':
            return t('Meldung verworfen')
        case 'escalate':
            return t('Meldung eskaliert')
        case 'resolve:delete':
            return t('Meldung erledigt (Inhalt entfernt)')
        case 'resolve:kick':
            return t('Meldung erledigt (aus dem Raum entfernt)')
        case 'resolve:ban':
            return t('Meldung erledigt (gebannt)')
        case 'resolve:timeout':
            return t('Meldung erledigt (befristet gesperrt)')
        case 'resolve:unknown':
            return t('Meldung erledigt')
        default:
            return action
    }
}

/** Local calendar day of a unix second as `YYYY-MM-DD` — the grouping key. */
export const dayKey = (ts: number): string => {
    const d = new Date(ts * 1000)
    const p = (n: number): string => String(n).padStart(2, '0')

    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

const startOfDay = (d: Date): number => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()

/**
 * „Heute" · „Gestern" · the full date — the same three-way rule and the same format
 * options as the day divider of the chat history (`feeds.ts dayLabel`, `:365`).
 *
 * **Copied and not imported, deliberately:** that one is module-private in `feeds.ts`,
 * and `feeds.ts` pulls in welshman — importing it would drag the whole SDK into a module
 * whose entire point is that `node --test` can load it. Same trade `longformFeed.ts`
 * already documents for `dateLabelAbsolut`. What is shared is the *format*, and that is
 * one line long.
 */
export const dayLabel = (ts: number, now: number): string => {
    const diffDays = Math.round((startOfDay(new Date(now * 1000)) - startOfDay(new Date(ts * 1000))) / 86_400_000)
    if (diffDays === 0) {
        return t('Heute')
    }
    if (diffDays === 1) {
        return t('Gestern')
    }

    return formatTimestamp(ts, { day: 'numeric', month: 'long', year: 'numeric' })
}

/** Time of day of one entry, as the chat rows show it. */
export const auditTimeLabel = (ts: number): string => formatTimestamp(ts, { hour: '2-digit', minute: '2-digit' })

/** One day of history: its key, its heading and the measures of that day, newest first. */
export type AuditDay = {
    key: string
    label: string
    entries: AuditEntry[]
}

/**
 * Entries → days, newest day first, newest entry first inside a day.
 *
 * **Why grouped at all:** a moderation history is bursty — a session of work produces a
 * dozen rows within a minute. Rendered flat, that is twenty near-identical timestamps
 * under each other and the reader has to reconstruct the days himself.
 */
export const groupAuditByDay = (entries: AuditEntry[], now: number): AuditDay[] => {
    const days = new Map<string, AuditDay>()
    for (const entry of [...entries].sort((a, b) => b.createdAt - a.createdAt)) {
        const key = dayKey(entry.createdAt)
        const day = days.get(key)
        if (day) {
            day.entries.push(entry)
        } else {
            days.set(key, { key, label: dayLabel(entry.createdAt, now), entries: [entry] })
        }
    }

    return [...days.values()]
}

/**
 * The one call the island makes: a parsed answer → the days it renders.
 *
 * **Every failure becomes an empty list, and that is the whole point.** Without the
 * permission to read the log there is no history — not an error, not a toast, not an
 * empty-state sentence claiming that nothing has happened (it may well have). The
 * distinction the parser preserves stays available for whoever debugs this; the surface
 * itself does not need it.
 */
export const auditDays = (result: AuditListResult, now: number): AuditDay[] =>
    result.ok ? groupAuditByDay(result.entries, now) : []
