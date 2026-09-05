/**
 * Did WE ask for this event, or did the relay simply push it? — the pure half of P7.
 *
 * ══ Why a client needs to be able to answer that at all ══════════════════════════
 *
 * `isRelayEvent` (`@welshman/net` `message.js`) is `m[0] === "EVENT"` and nothing
 * else — it does not look at the subscription id. Every ingest path in welshman is
 * built on it, so **any** connected relay may hand us a correctly signed event on a
 * subscription we never opened, and it enters the repository as if we had asked.
 *
 * For nearly every kind that is merely noise. For kind 1059 it is a signer round trip:
 * `appPolicyWraps` feeds each incoming wrap to `Wraps.enqueue`, and the queue decrypts
 * it AT THE USER'S SIGNER. Measured on 2026-09-05 against a real `App`
 * (`p7-messung-b-signer-kosten.txt`): **25 unsolicited wraps → 25 `nip44.decrypt`
 * calls**. On a NIP-46 bunker that is 25 round trips; on NIP-55 it is 25 prompts on the
 * signing device. A relay can do that to a member for free, from a different tab, over
 * a connection the member opened for something else entirely.
 *
 * With the ledger below in front of the ingest the same 25 cost **0** signer calls, and
 * one wrap we did ask for still costs its 2 (wrap + seal) and unwraps — the positive
 * control in the same measurement. That distinction is the whole point: a filter that
 * scores zero on everything is a mute button, not a check.
 *
 * ══ What this is NOT ═════════════════════════════════════════════════════════════
 *
 * It is not a general ingest gate. `js/welshmanInstance.ts` applies it to kind 1059 and
 * to nothing else, on purpose: an unsolicited kind 9 is a wasted object, an unsolicited
 * kind 1059 is a prompt on somebody's hardware. Widening it to every kind would put a
 * new fail-closed condition in front of every read path in the client — including the
 * ones that receive on subscriptions opened by code we do not own (negentropy sync,
 * welshman's own collections) — and this phase has not measured those.
 *
 * ══ Both ends of the ledger are fed, and both matter ═════════════════════════════
 *
 * `SocketEvent.Sending` is emitted synchronously inside `Socket.send`
 * (`net/socket.js:121-124`), before the frame can be answered, so a REQ is in the
 * ledger before its first EVENT can arrive — even when `socketPolicyAuthBuffer` holds
 * the frame back through an AUTH round and replays the SAME message object afterwards
 * (`net/policy.js`), and even when our own `socketPolicyAuthHold` drops the first copy.
 * Both replay the id, so the entry stays correct.
 *
 * The other end is eviction. Without it the ledger is a leak that grows for as long as
 * the tab lives — every `load()` opens a fresh id — and a leak in the thing that decides
 * what may reach the signer is worse than the leak itself. Three forgetters:
 * our own `CLOSE`, the relay's `CLOSED`, and {@link MAX_TRACKED_SUBSCRIPTIONS} as the
 * backstop for the subscriptions nobody closes (a live room subscription is closed by an
 * `AbortSignal`, which sends `CLOSE`; a socket that dies takes its ledger with it).
 */
import { matchFilters, type Filter } from '@welshman/util'

/**
 * How many of our own open subscriptions one socket is tracked for.
 *
 * Insertion-ordered eviction, oldest first — a `Map` iterates in insertion order, so the
 * first key is the least recently opened. 256 is above anything this client opens
 * against one relay (the room screen is the busiest surface and sits at a few dozen),
 * and small enough that the ledger cannot become a memory problem on a long-lived tab.
 *
 * **Eviction is fail-CLOSED, and that is the right direction here:** an evicted id is
 * treated as unsolicited, so a wrap answering a very old subscription is dropped rather
 * than decrypted. It costs a message that a reload brings back; the opposite default
 * would cost the guarantee this module exists for.
 */
export const MAX_TRACKED_SUBSCRIPTIONS = 256

/** Our own open subscriptions on one socket: subscription id → the filters we sent. */
export type SubscriptionLedger = Map<string, Filter[]>

export const makeSubscriptionLedger = (): SubscriptionLedger => new Map<string, Filter[]>()

const isFrame = (frame: unknown): frame is unknown[] => Array.isArray(frame)

const subscriptionIdOf = (frame: unknown[]): string | null =>
    typeof frame[1] === 'string' && frame[1] !== '' ? frame[1] : null

/**
 * Note a frame WE are sending: a `REQ` opens a subscription, a `CLOSE` ends it.
 *
 * Everything else is ignored, including `EVENT`, `AUTH`, `NEG-OPEN` and anything
 * malformed — this is fed straight from a socket event, so it sees whatever any policy
 * in the chain decides to send.
 */
export const rememberOwnRequest = (ledger: SubscriptionLedger, frame: unknown): void => {
    if (!isFrame(frame)) {
        return
    }
    const id = subscriptionIdOf(frame)
    if (!id) {
        return
    }
    if (frame[0] === 'CLOSE') {
        ledger.delete(id)

        return
    }
    if (frame[0] !== 'REQ') {
        return
    }
    const filters = frame.slice(2).filter((filter): filter is Filter => typeof filter === 'object' && filter !== null)
    // A REQ without a single usable filter would match nothing later anyway; recording
    // it would only take a slot and make an id "ours" that can never authorise an event.
    if (filters.length === 0) {
        return
    }
    ledger.set(id, filters)
    while (ledger.size > MAX_TRACKED_SUBSCRIPTIONS) {
        const oldest = ledger.keys().next()
        if (oldest.done) {
            return
        }
        ledger.delete(oldest.value)
    }
}

/**
 * Note a frame the RELAY sent: a `CLOSED` ends the subscription from its side.
 *
 * Kept apart from {@link rememberOwnRequest} rather than folded into one function that
 * takes both directions: a relay must never be able to CREATE a ledger entry, and the
 * cheapest way to guarantee that is that the function reading relay frames has no branch
 * that writes one.
 */
export const forgetClosedSubscription = (ledger: SubscriptionLedger, frame: unknown): void => {
    if (!isFrame(frame) || frame[0] !== 'CLOSED') {
        return
    }
    const id = subscriptionIdOf(frame)
    if (id) {
        ledger.delete(id)
    }
}

/**
 * Did we ask for this event?
 *
 * Two conditions, and the second one is not decoration: a relay that answers a
 * subscription of ours may put anything in the answer. `["EVENT", <our sub id>, <a
 * gift wrap>]` on a subscription that asked for kind 9 is exactly the same attack with
 * one more step, so the event has to match the filters that subscription actually
 * carried.
 */
export const isSolicitedEvent = (ledger: SubscriptionLedger, frame: unknown): boolean => {
    if (!isFrame(frame) || frame[0] !== 'EVENT') {
        return false
    }
    const id = subscriptionIdOf(frame)
    if (!id) {
        return false
    }
    const filters = ledger.get(id)
    if (!filters) {
        return false
    }
    const event = frame[2]
    if (typeof event !== 'object' || event === null) {
        return false
    }

    return matchFilters(filters, event as Parameters<typeof matchFilters>[1])
}
