/**
 * `$store.presence` — who is here right now (kind 20001, P6), the impure half.
 *
 * The rules (parsing, the TTL boundary, the write gate, the heartbeat decision) live in
 * `presenceData.ts` and are checked there without a browser. What is left here is what
 * genuinely needs welshman and the DOM: a live subscription, a heartbeat, the page's own
 * visibility, and the teardown that says goodbye.
 *
 * ══ The read path does NOT go through the repository, and that is structural ═══════
 *
 * `welshmanInstance.ts` drops every ephemeral event **before** the repository
 * (`isEphemeralKind`, `20000 ≤ kind < 30000`) — deliberately, because an event the relay
 * itself refuses to store has no business in a cache that outlives the tab. Every
 * `deriveEvents`/`deriveEventsForUrl` pattern in this package is therefore not *empty*
 * for 20001, it is **blind**: the events arrive on the socket, the policy returns before
 * `repository.publish`, and no derivation will ever see them.
 *
 * So this module reads with `request({filters, relays, onEvent, autoClose: false})`
 * (`welshmanNet.ts`), which hands events to a callback straight off the adapter. The
 * ingest policy stays untouched. Signature verification is **not** lost on that path:
 * `requestOne` defaults `isEventValid` to `verifyEvent` (`@welshman/net` `request.js`),
 * and `matchFilters` runs as well, so a relay cannot answer a presence subscription with
 * something else.
 *
 * ── Why the subscription is re-armed on a timer ────────────────────────────────────
 *
 * `requestOne` keeps every accepted event in an array (`events.push(event)`) and every id
 * in a `Tracker`, both for the life of the subscription, and it never forgets. For a
 * replaceable kind that is a rounding error. For an ephemeral kind with a heartbeat it is
 * unbounded: twenty peers beating every 45 s produce roughly 1 600 events per hour, and a
 * tab that stays open all day would hold every one of them. {@link PRESENCE_RESUB_MS}
 * drops the whole request and opens a new one; presence has no backlog, so a re-arm costs
 * exactly one CLOSE plus one REQ frame and loses nothing.
 *
 * The same re-arm covers the other silent failure: welshman does **not** re-send a REQ
 * after a socket drops (`requestOne` only reports `onDisconnect`), so a subscription that
 * survived a disconnect is a subscription that will never deliver again — and an empty
 * presence table looks exactly like "nobody is online". `userStatus.ts` carries the same
 * note for the same reason.
 *
 * ══ There is no backlog, so "unknown" is the normal state ═════════════════════════
 *
 * A REQ for 20001 answers with EOSE and zero events; only live deltas follow. For up to
 * one heartbeat after mounting, we genuinely do not know who is there — and the surface
 * says so by rendering **nothing**. It never renders an "offline" dot, because it cannot
 * tell "away from the keyboard" from "has not spoken yet". Absence of a dot is absence of
 * a statement; the reasoning is the same one `userStatus.ts` writes out for `'unknown'`.
 *
 * ── The gate runs before the event exists ──────────────────────────────────────────
 *
 * The write path asks `planPresence` (`presenceData.ts`), which asks `mayWriteKind` and
 * answers `null` when the answer is no. Gate and event body are the same value, so a
 * caller that publishes without asking has nothing to publish. On zooid and while the
 * NIP-11 doc is in flight, nothing is ever signed.
 */
import { makeEvent } from '@welshman/util'
import { get } from 'svelte/store'
import { app, Thunks } from './welshmanApp.ts'
import { pubkey } from './welshmanSession.ts'
import { request } from './welshmanNet.ts'
import { activeSpace } from './groups.ts'
import { deriveSpaceKind, type SpaceKind } from './spaceCaps.ts'
import { waitForPublishError } from './publishResult.ts'
import {
    PRESENCE_TICK_MS,
    PRESENCE_TTL_SECS,
    PRESENCE_UPDATE,
    foldPresence,
    mayReadPresence,
    parsePresenceEvent,
    planPresence,
    presenceFingerprint,
    shouldSendPresence,
    type PresenceEventLike,
    type PresenceSend,
    type PresenceState,
    type PresenceStatus,
} from './presenceData.ts'

/** How long to wait before re-opening a subscription whose socket dropped. */
export const RELISTEN_DELAY_MS = 2_000

/** Age at which the live subscription is dropped and re-opened. See the module header. */
export const PRESENCE_RESUB_MS = 15 * 60_000

/**
 * Consecutive publish failures after which the heartbeat gives up until something
 * changes.
 *
 * A relay that refuses presence (no membership, a fenced community, a rate limit) refuses
 * it again in 45 s, and a NIP-46 bunker that declines the signature would be asked again
 * every 45 s for as long as the tab is open. Three attempts are enough to distinguish a
 * hiccup from a "no"; after that the loop stops and only a real state change — the user
 * switching tabs, or a fresh mount — starts it again.
 */
export const PRESENCE_WRITE_ATTEMPTS = 3

/** What the markup reads. Values are `'online' | 'away'`; an absent key means no statement. */
type PresenceStore = {
    /** `pubkey → state`. Rebuilt only when the visible table actually changed. */
    byPubkey: Record<string, PresenceState>
    /** What this client is broadcasting about itself, `''` while it broadcasts nothing. */
    mine: '' | PresenceState
    mount(): void
    unmount(): void
}

const noop = (): void => {}

const nowSec = (): number => Math.floor(Date.now() / 1000)

/**
 * The status this page would claim right now.
 *
 * `'away'` follows the page's visibility and nothing else. Buzz Desktop derives it from
 * OS-wide idle time (`resolveAutomaticPresenceStatus`, 10 minutes), which a browser tab
 * cannot see — and guessing idleness from in-page activity would call a user "away" who
 * is reading, and "online" who left the machine with the tab in front. Visibility is the
 * one signal that is actually observable here, so it is the only one used.
 */
const desiredStatus = (): PresenceStatus =>
    typeof document !== 'undefined' && document.visibilityState === 'hidden' ? 'away' : 'online'

const createStore = (): { store: PresenceStore; bind: (reactive: PresenceStore) => void } => {
    let unsubSpace: () => void = noop
    let unsubKind: () => void = noop
    let unsubPubkey: () => void = noop
    let controller: AbortController | null = null
    let ticker: ReturnType<typeof setInterval> | null = null
    let coalesce: ReturnType<typeof setTimeout> | null = null
    let url = ''
    /** Three-valued space kind; `'unknown'` denies both directions (see the header). */
    let spaceKind: SpaceKind = 'unknown'
    /** The newest presence event per pubkey, trimmed to the five fields we read. */
    const latest = new Map<string, PresenceEventLike>()
    /** Last visible table, as a string — the change detector for the Alpine proxy. */
    let fingerprint = ''
    /** When the current subscription was opened; drives {@link PRESENCE_RESUB_MS}. */
    let armedAtMs = 0
    /** What we last said about ourselves, and when. `null` = nothing said yet. */
    let lastSend: PresenceSend | null = null
    /** Consecutive publish failures; at {@link PRESENCE_WRITE_ATTEMPTS} the loop stops. */
    let writeFailures = 0
    let mounts = 0
    /** Every write goes here: the raw object before {@link bind}, the proxy after. */
    let self: PresenceStore

    const store: PresenceStore = {
        byPubkey: {},
        mine: '',

        mount(): void {
            mounts++
            if (unsubSpace !== noop) {
                return
            }
            unsubSpace = activeSpace.subscribe((nextUrl: string) => {
                if (!nextUrl || nextUrl === url) {
                    return
                }
                // A different space is a different presence population and a different
                // permission: drop everything before the new relay says a word.
                resetSpace(nextUrl)
                unsubKind()
                unsubKind = deriveSpaceKind(nextUrl).subscribe((kind: SpaceKind) => {
                    if (kind === spaceKind) {
                        return
                    }
                    spaceKind = kind
                    armRead()
                    sendIfDue()
                })
            })
            // The pubkey is a second, independent arrival — the same trap `bookmarks.ts`
            // and `reminders.ts` document: armed on the space alone, the first pass would
            // take the guest branch and nothing would ever start the heartbeat.
            unsubPubkey = pubkey.subscribe(() => {
                lastSend = null
                writeFailures = 0
                sendIfDue()
            })
            if (typeof document !== 'undefined') {
                document.addEventListener('visibilitychange', onVisibility)
            }
            ticker = setInterval(tick, PRESENCE_TICK_MS)
        },

        /**
         * Two latches, the same reason as `roomPins.unmount` and `reminders.unmount`:
         * `wire:navigate` inserts the new body **before** it tears the old one down, so a
         * plain teardown on the first `destroy()` would kill the store the new page just
         * mounted.
         */
        unmount(): void {
            mounts = Math.max(0, mounts - 1)
            if (mounts > 0) {
                return
            }
            teardown()
        },
    }

    self = store

    /**
     * Say goodbye, then forget everything.
     *
     * The farewell is not decoration: the relay clears presence by itself only when the
     * **last** connection of a pubkey closes (`buzz-relay/src/connection.rs`), and this
     * client keeps its socket open for every other surface. Without an explicit
     * `'offline'` a user who leaves the chat would keep a dot for another three minutes.
     * It is fire-and-forget by design — a farewell that blocked navigation would be worse
     * than one that occasionally does not make it out.
     */
    const teardown = (): void => {
        if (lastSend && lastSend.status !== 'offline') {
            publishPresence('offline')
        }
        controller?.abort()
        controller = null
        unsubKind()
        unsubPubkey()
        unsubSpace()
        unsubKind = noop
        unsubPubkey = noop
        unsubSpace = noop
        if (ticker !== null) {
            clearInterval(ticker)
            ticker = null
        }
        if (coalesce !== null) {
            clearTimeout(coalesce)
            coalesce = null
        }
        if (typeof document !== 'undefined') {
            document.removeEventListener('visibilitychange', onVisibility)
        }
        latest.clear()
        fingerprint = ''
        armedAtMs = 0
        lastSend = null
        writeFailures = 0
        spaceKind = 'unknown'
        url = ''
        self.byPubkey = {}
        self.mine = ''
    }

    /** Everything that belongs to one relay, dropped when the space changes. */
    const resetSpace = (nextUrl: string): void => {
        controller?.abort()
        controller = null
        latest.clear()
        fingerprint = ''
        armedAtMs = 0
        lastSend = null
        writeFailures = 0
        spaceKind = 'unknown'
        url = nextUrl
        self.byPubkey = {}
        self.mine = ''
    }

    // ── Reading ──────────────────────────────────────────────────────────────────

    /**
     * One long-lived REQ per space. `limit: 0` says "from now on" — there is no backlog to
     * ask for, and saying so keeps a relay from inventing one.
     *
     * `onDuplicate` sits next to `onEvent` because welshman's per-request tracker
     * swallows an id it has already seen; two heartbeats are two ids, so this branch
     * should never fire, but a re-delivery that silently disappeared would be a dot that
     * expires while the peer is still there.
     */
    const armRead = (): void => {
        if (!url || !mayReadPresence(spaceKind)) {
            return
        }
        controller?.abort()
        const mine = new AbortController()
        controller = mine
        armedAtMs = Date.now()
        void request({
            relays: [url],
            signal: mine.signal,
            autoClose: false,
            filters: [{ kinds: [PRESENCE_UPDATE], limit: 0 }],
            onEvent: (event: unknown) => ingest(event as PresenceEventLike),
            onDuplicate: (event: unknown) => ingest(event as PresenceEventLike),
            onDisconnect: () => {
                if (controller !== mine) {
                    return
                }
                controller = null
                mine.abort()
                setTimeout(() => {
                    if (controller === null) {
                        armRead()
                    }
                }, RELISTEN_DELAY_MS)
            },
        })
    }

    /** One incoming event → the newest-per-pubkey map. Older arrivals are dropped. */
    const ingest = (event: PresenceEventLike): void => {
        const parsed = parsePresenceEvent(event)
        if (!parsed) {
            return
        }
        const known = latest.get(parsed.pubkey)
        if (known && known.created_at > parsed.updatedAt) {
            return
        }
        // A trimmed copy, not the welshman event: this map is held for the life of the
        // page and a full event carries tags, content and signature we never read again.
        latest.set(parsed.pubkey, {
            id: parsed.id,
            kind: PRESENCE_UPDATE,
            pubkey: parsed.pubkey,
            created_at: parsed.updatedAt,
            content: parsed.status,
        })
        scheduleRecompute()
    }

    /**
     * A short collector in front of {@link recompute}: joining a busy space delivers a
     * burst of heartbeats, and each of them would otherwise rebuild the table.
     */
    const scheduleRecompute = (): void => {
        if (coalesce !== null) {
            return
        }
        coalesce = setTimeout(() => {
            coalesce = null
            recompute()
        }, 200)
    }

    const recompute = (): void => {
        const now = nowSec()
        // Forget what can no longer become visible again, so the map stays the size of
        // the room rather than the size of the session.
        for (const [pk, event] of latest) {
            if (now - event.created_at > PRESENCE_TTL_SECS * 2) {
                latest.delete(pk)
            }
        }
        const table = foldPresence([...latest.values()], now)
        const next = presenceFingerprint(table)
        if (next === fingerprint) {
            return
        }
        fingerprint = next
        self.byPubkey = Object.fromEntries(table)
    }

    // ── Writing ──────────────────────────────────────────────────────────────────

    /**
     * Publish one presence statement. Deliberately **not** `publishOptimistic`: there is
     * nothing to show optimistically and nothing in the repository to roll back — an
     * ephemeral event never gets there. What is left of a failure is the counter below.
     */
    const publishPresence = (status: PresenceStatus): void => {
        const plan = planPresence(status, spaceKind)
        if (!plan || !url || !get(pubkey)) {
            return
        }
        // Marked as sent BEFORE the answer arrives: the heartbeat must not fire again
        // while this one is in flight, and a failure is handled by the attempt counter
        // rather than by an immediate retry.
        lastSend = { status, atMs: Date.now() }
        self.mine = status === 'offline' ? '' : status
        try {
            const thunk = app.use(Thunks).publish({
                relays: [url],
                event: makeEvent(plan.kind, { content: plan.content, tags: plan.tags }),
            })
            void waitForPublishError(thunk).then(
                (error: string) => {
                    writeFailures = error ? writeFailures + 1 : 0
                },
                () => {
                    writeFailures += 1
                },
            )
        } catch {
            // No signer, no socket: the same failure as a rejection, and just as silent.
            // Presence is the one surface that must never interrupt anybody.
            writeFailures += 1
        }
    }

    const sendIfDue = (): void => {
        if (writeFailures >= PRESENCE_WRITE_ATTEMPTS) {
            return
        }
        const desired = desiredStatus()
        if (shouldSendPresence(lastSend, desired, Date.now())) {
            publishPresence(desired)
        }
    }

    /** A tab change is a state change, and a state change is said at once, not at the tick. */
    const onVisibility = (): void => {
        // The user did something; a loop that had given up gets one more chance.
        writeFailures = 0
        sendIfDue()
    }

    const tick = (): void => {
        recompute()
        sendIfDue()
        if (armedAtMs > 0 && Date.now() - armedAtMs >= PRESENCE_RESUB_MS) {
            armRead()
        }
    }

    return {
        store,
        bind: (reactive: PresenceStore): void => {
            self = reactive
        },
    }
}

export function wirePresence(Alpine: { store: (name: string, value?: unknown) => unknown }): void {
    if (Alpine.store('presence')) {
        return
    }
    const { store, bind } = createStore()
    Alpine.store('presence', store)
    // From here the store writes only into the reactive proxy — same reason and same
    // shape as `wireReminders`/`wireBookmarks`/`wireRoomPins`: a closure that keeps
    // mutating the raw object changes values Alpine never hears about.
    bind(Alpine.store('presence') as PresenceStore)
}
