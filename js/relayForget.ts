/**
 * Soft forgetting of relays that keep failing — learned, persisted, and undone by success.
 *
 * ── What already existed, and what was missing ──────────────────────────────────
 * welshman's `RelayStats.getQuality` already skips a relay with recent errors (quality 0
 * for an error in the last minute, or more than three in the last hour), and quality 0
 * drops a URL from `RelayScenario.getUrls()` (see `deadRelays.ts`). Two things kept that
 * from working here:
 *
 *  1. **The stats live in memory, and every page of this app is a full page load.** Each
 *     navigation started with an empty `RelayStats`, so a relay that cannot even be resolved
 *     was dialled again on every page — measured 2026-10-25 driving the companion over 45
 *     routes: `relay.nsecbunker.com`, `nostr.v0l.io`, `relayer.fiatjaf.com`,
 *     `relay.0xchat.com` (all NXDOMAIN), `relay.damus.io` (handshake 503).
 *  2. **No growth.** Its thresholds step at one minute and one hour; its third rule (more
 *     than ten errors a day) can never fire, because `recent_errors` is cut to ten entries
 *     (`slice(-10)` in `plugins/relayStats.js`). A permanently dead relay therefore costs
 *     about four dials an hour, forever.
 *
 * This module adds exactly those two things on top — it reads welshman's stats (it does not
 * listen to sockets itself) and wraps welshman's quality function (it does not replace it).
 * `deadRelays.ts` said a learning list was "discarded" because it would need persistence,
 * expiry, re-entry and diagnosis. The user asked for it on 2026-10-25 ("das softe
 * ‚vergessen' von Relays, die immer wieder failen"); all four are here.
 *
 * ── The rules ─────────────────────────────────────────────────────────────────────
 *  · A failure EPISODE is a socket error; errors less than {@link EPISODE_GAP_S} apart are
 *    one episode (welshman's own reconnect loop produces bursts within one page).
 *  · After n consecutive episodes the relay is skipped for 1, 2, 4 … minutes, capped at
 *    {@link FORGET_MAX_S}; then it is tried again, once.
 *  · One successful open erases the record: full recovery, no probation.
 *  · **A failure only counts while the network demonstrably works** — another relay
 *    opened within {@link NETWORK_PROOF_S}. Without this rule a phone in a tunnel would
 *    learn to forget every relay it knows. Failures without such proof wait that long for
 *    one and are dropped otherwise.
 *  · Skipping means routing only: the URL drops out of `getUrls()`. The outbox/inbox model
 *    (NIP-65) is untouched — a selection whose relays are all skipped gets welshman's
 *    fallback relay, which is never quality-filtered. Relays the host configured itself
 *    (space, workspace, board) are never forgotten.
 *  · A relay that answers and refuses (`auth-required:`, `restricted:`, `blocked:`) has NOT
 *    failed: only a socket error counts. "Relays die nicht verbinden sind nicht unbedingt
 *    direkt ein Fehler" — and one that does connect is not one at all.
 */

/** Errors closer together than this are one failure episode, seconds. */
export const EPISODE_GAP_S = 60

/** Skip time after the first episode, doubled per further episode, seconds. */
export const FORGET_BASE_S = 60

/** Longest skip, seconds. */
export const FORGET_MAX_S = 6 * 3600

/** A success of ANY relay this recent proves the network works, seconds. */
export const NETWORK_PROOF_S = 120

/** Records whose last failure is older than this are dropped, seconds. */
export const RECORD_TTL_S = 7 * 86400

/** Most records kept (the most recently failed win). */
export const MAX_RECORDS = 300

export const STORAGE_KEY = 'group:relay-forget:v1'

export type ForgetRecord = { failures: number; lastFailure: number }

export type ForgetRecords = Map<string, ForgetRecord>

/** Register a failure at `at` (seconds); a burst within one episode counts once. */
export const noteFailure = (record: ForgetRecord | undefined, at: number): ForgetRecord => {
    if (!record) {
        return { failures: 1, lastFailure: at }
    }
    if (at - record.lastFailure < EPISODE_GAP_S) {
        return { failures: record.failures, lastFailure: Math.max(record.lastFailure, at) }
    }

    return { failures: record.failures + 1, lastFailure: at }
}

/** Until when (seconds) this record keeps its relay out of the routing. */
export const forgetUntil = (record: ForgetRecord): number =>
    record.lastFailure + Math.min(FORGET_MAX_S, FORGET_BASE_S * 2 ** Math.max(0, record.failures - 1))

export const isForgotten = (record: ForgetRecord | undefined, now: number): boolean =>
    record !== undefined && record.failures > 0 && now < forgetUntil(record)

/**
 * Wrap a quality function: a forgotten relay gets 0 (out of `getUrls()`), anything else —
 * and every exempt relay — keeps its base quality untouched.
 */
export const forgetRelayQuality =
    (records: ForgetRecords, exempt: (url: string) => boolean, now: () => number = nowSeconds) =>
    (base: (url: string) => number) =>
    (url: string): number =>
        !exempt(url) && isForgotten(records.get(url), now()) ? 0 : base(url)

/** Parse what {@link serializeRecords} wrote; anything malformed or expired is dropped. */
export const parseRecords = (raw: string | null, now: number): ForgetRecords => {
    const records: ForgetRecords = new Map()
    if (!raw) {
        return records
    }
    let parsed: unknown
    try {
        parsed = JSON.parse(raw)
    } catch {
        return records
    }
    if (!parsed || typeof parsed !== 'object') {
        return records
    }
    for (const [url, value] of Object.entries(parsed as Record<string, unknown>)) {
        if (!Array.isArray(value) || value.length !== 2) {
            continue
        }
        const [failures, lastFailure] = value as [unknown, unknown]
        if (
            typeof failures === 'number' && Number.isInteger(failures) && failures > 0 && failures < 1000 &&
            typeof lastFailure === 'number' && lastFailure <= now + 60 && now - lastFailure < RECORD_TTL_S
        ) {
            records.set(url, { failures, lastFailure })
        }
    }

    return records
}

/** Compact form `{url: [failures, lastFailure]}`, newest {@link MAX_RECORDS} only. */
export const serializeRecords = (records: ForgetRecords, now: number): string => {
    const kept = [...records.entries()]
        .filter(([, record]) => now - record.lastFailure < RECORD_TTL_S)
        .sort((a, b) => b[1].lastFailure - a[1].lastFailure)
        .slice(0, MAX_RECORDS)

    return JSON.stringify(Object.fromEntries(kept.map(([url, record]) => [url, [record.failures, record.lastFailure]])))
}

export const nowSeconds = (): number => Math.floor(Date.now() / 1000)

/** The slice of a welshman `RelayStatsItem` this module reads. */
export type StatsLike = { last_open: number; last_error: number }

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>

/**
 * The learning half: fed with welshman's `RelayStats` items (`onItem`), it turns new errors
 * and opens into records and persists them. Returns the records (live) and the feed.
 */
export const makeRelayForgetting = (options: {
    storage?: StorageLike | undefined
    now?: () => number
    persistDelayMs?: number
}) => {
    const now = options.now ?? nowSeconds
    const storage = options.storage
    const records = parseRecords(safeRead(storage), now())
    const seen = new Map<string, StatsLike>()
    const pending = new Map<string, number>()
    let lastAnySuccess = 0
    let timer: ReturnType<typeof setTimeout> | undefined

    const persist = () => {
        if (!storage || timer) {
            return
        }
        timer = setTimeout(() => {
            timer = undefined
            try {
                storage.setItem(STORAGE_KEY, serializeRecords(records, now()))
            } catch {
                // Quota or a locked-down WebView: forgetting just stays per page.
            }
        }, options.persistDelayMs ?? 500)
    }

    const commit = (url: string, at: number) => {
        records.set(url, noteFailure(records.get(url), at))
        persist()
    }

    const flushPending = () => {
        for (const [url, at] of pending) {
            if (lastAnySuccess - at <= NETWORK_PROOF_S && at - lastAnySuccess <= NETWORK_PROOF_S) {
                commit(url, at)
            }
        }
        pending.clear()
    }

    const feed = (url: string, stats: StatsLike | undefined): void => {
        if (!stats) {
            return
        }
        const before = seen.get(url) ?? { last_open: 0, last_error: 0 }
        seen.set(url, { last_open: stats.last_open, last_error: stats.last_error })

        const failed = stats.last_error > before.last_error
        const opened = stats.last_open > before.last_open
        // Both inside one batched update: the later event wins.
        if (opened && (!failed || stats.last_open >= stats.last_error)) {
            pending.delete(url)
            if (records.delete(url)) {
                persist()
            }
            lastAnySuccess = Math.max(lastAnySuccess, stats.last_open)
            flushPending()

            return
        }
        if (failed) {
            const at = stats.last_error
            if (lastAnySuccess > 0 && at - lastAnySuccess <= NETWORK_PROOF_S) {
                commit(url, at)
            } else {
                pending.set(url, at)
            }
        }
        // Waiting failures that never got their proof are dropped.
        for (const [pendingUrl, at] of pending) {
            if (now() - at > NETWORK_PROOF_S) {
                pending.delete(pendingUrl)
            }
        }
    }

    return { records, feed }
}

const safeRead = (storage: StorageLike | undefined): string | null => {
    try {
        return storage?.getItem(STORAGE_KEY) ?? null
    } catch {
        return null
    }
}
