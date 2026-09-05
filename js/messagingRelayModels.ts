/**
 * NIP-17 messaging relay lists (kind 10050) — the pure half of P7.
 *
 * Counterpart to `js/messagingRelays.ts` (signer, relay, store). Browser-free and
 * store-free like `muteModels.ts`, so every rule below is decidable under `node --test`.
 *
 * ══ What a 10050 is for, and why it is not optional ══════════════════════════════
 *
 * A NIP-17 message is a gift wrap addressed to a pubkey — it carries no hint where the
 * recipient reads. Kind 10050 is that hint: *"private messages for me go to these
 * relays"*. Without it a foreign client has nowhere to deliver, and NIP-17 in this
 * client would be a house convention on our own relay rather than interop — which is the
 * only reason to prefer it over the Buzz DM channels that already exist.
 *
 * ══ It is REPLACEABLE, and that is the whole danger ══════════════════════════════
 *
 * One list per pubkey; every write replaces the previous one entirely. The same class as
 * kind 10000 in P6, and the same trap: welshman's `MessagingRelayLists.update()`
 * (`@welshman/app` `plugins/messagingRelayLists.js`) builds its writer from
 * `await this.forceLoad(user.pubkey)`, and `makeForceLoadItem` (`@welshman/store`
 * `repository.js:449`) is `await loadItem(key); return getItem(key)` — it awaits the
 * fetch and then reads whatever happens to be in the index. Offline, a dead socket, or
 * an AUTH round that swallows the `EOSE` all end with `undefined`, the writer starts
 * from an EMPTY list, and the published 10050 contains exactly the one relay this device
 * happened to add. Nothing on the way out says that anything was guessed.
 *
 * So the plugin is not used. {@link planMessagingRelayWrite} refuses to produce an event
 * body without an explicit `listAnswered`, exactly as `planMuteWrite` does, and
 * `messagingRelays.ts` derives that verdict from the `EOSE` of its own request rather
 * than from a promise having resolved.
 *
 * ══ Where it may be written: measured, not assumed ═══════════════════════════════
 *
 * **Buzz refuses kind 10050 outright.** There is no constant for it anywhere in
 * `buzz-core/src/kind.rs`, so `required_scope_for_kind` falls through to
 * `_ => Err("restricted: unknown event kind")`. Measured against a local slot on
 * 2026-09-05 with kind 10000 as the positive control
 * (`p7-messung-c-kind10050.txt`):
 *
 *   Buzz   10050 → `OK false` "restricted: unknown event kind", requery: not findable
 *   Buzz   10000 → `OK true`,                                   requery: findable
 *   zooid  10050 → `OK true`,                                   requery: findable
 *   zooid  10000 → `OK true`,                                   requery: findable
 *
 * That is why the kind carries a `relay: 'other'` rule in `js/relayCapability.ts` rather
 * than `'any'`: on a Buzz space the write is refused before it is signed, instead of
 * being sent and rejected. The consequence, stated rather than discovered: a member
 * whose only space is Buzz cannot publish a messaging relay list at all, and foreign
 * clients therefore cannot find them. The transport still works between members of the
 * same space (see `privateMessages.ts`), interop does not.
 */
import { MESSAGING_RELAYS } from '@welshman/util'
import { mayWriteKind } from './relayCapability.ts'
import type { SpaceKind } from './spaceCaps.ts'

export { MESSAGING_RELAYS }

/** The shape this module needs off an event — anything with tags and a timestamp. */
export type RelayListEventLike = {
    kind: number
    pubkey: string
    created_at: number
    content: string
    tags: string[][]
}

/** What a planned write looks like before it is signed. */
export type RelayListWrite = {
    kind: number
    content: string
    tags: string[][]
    created_at: number
}

/**
 * Is this a usable relay URL for a messaging list?
 *
 * Deliberately narrow and deliberately NOT `normalizeRelayUrl`: that helper is
 * forgiving by design (it repairs, it does not judge), and a list is the one place
 * where a repaired URL is worse than a rejected one — it would be published, other
 * clients would trust it, and the repair would be ours rather than the author's.
 */
export const isMessagingRelayUrl = (value: unknown): value is string => {
    if (typeof value !== 'string' || value.trim() !== value || value === '') {
        return false
    }
    try {
        const url = new URL(value)

        return (url.protocol === 'wss:' || url.protocol === 'ws:') && url.hostname !== ''
    } catch {
        return false
    }
}

/**
 * The newest 10050 of one author.
 *
 * Newest by `created_at`, ties broken by the lexicographically smaller id — the NIP-01
 * rule for replaceable events, so this client agrees with the relay about which copy
 * counts instead of picking whichever arrived first.
 */
export const ownMessagingRelayList = <T extends RelayListEventLike & { id?: string }>(
    events: readonly T[],
    self: string,
): T | null => {
    if (!self) {
        return null
    }
    let best: T | null = null
    for (const event of events) {
        if (event.kind !== MESSAGING_RELAYS || event.pubkey !== self) {
            continue
        }
        if (!best || event.created_at > best.created_at) {
            best = event
            continue
        }
        if (event.created_at === best.created_at && (event.id ?? '') < (best.id ?? '')) {
            best = event
        }
    }

    return best
}

/**
 * The relay URLs a list names.
 *
 * NIP-17 spells the entry `["relay", "wss://…"]`. Unusable entries are dropped rather
 * than repaired, and duplicates collapse — a list that names the same relay twice would
 * otherwise send every message there twice.
 */
export const messagingRelayUrls = (list: RelayListEventLike | null | undefined): string[] => {
    if (!list) {
        return []
    }
    const urls: string[] = []
    for (const tag of list.tags) {
        if (tag[0] !== 'relay' || !isMessagingRelayUrl(tag[1])) {
            continue
        }
        if (!urls.includes(tag[1])) {
            urls.push(tag[1])
        }
    }

    return urls
}

export type MessagingRelayPlan = {
    /** The list as the relay last told us it is; `null` = there is none. */
    list: RelayListEventLike | null
    /** **Did a relay send `EOSE`?** `false` means: do not write anything. */
    listAnswered: boolean
    /** The URLs the list should contain after the write. */
    urls: readonly string[]
    self: string
    spaceKind: SpaceKind
    /** Seconds since the epoch. Injected so the rule is decidable without a clock. */
    now: number
}

/**
 * The event body for a 10050 write, or `null` when the write must not happen.
 *
 * Six reasons to refuse, and every one of them is a measured failure mode rather than
 * defensive habit:
 *
 *  1. **No `listAnswered`.** The replaceable-write trap above. This is the only refusal
 *     the surface reports to the user, because it is the only one they can act on.
 *  2. **No identity.** Nothing to sign with.
 *  3. **The space cannot take the kind** (`mayWriteKind`, fail-closed on `'unknown'` and
 *     on Buzz). Signing an event that will be refused teaches the user nothing.
 *  4. **No usable URL.** An empty 10050 is a legal statement ("do not send me anything")
 *     and it is also exactly what the bug in 1 produces. The two are indistinguishable
 *     after the fact, so this client never writes one; the way to stop receiving is to
 *     delete the list, not to publish an empty one.
 *  5. **Nothing changed.** A replaceable kind rewritten with identical content is pure
 *     churn: a new id, a new timestamp, another copy for every reader to reconcile.
 *  6. **A timestamp that cannot win.** Two writes in the same second are a real race
 *     between two tabs, and NIP-01 breaks a `created_at` tie by the SMALLER id — so an
 *     equal timestamp is a coin flip, not an update. The plan carries `created_at` and
 *     forces it past the list it replaces.
 */
export const planMessagingRelayWrite = ({
    list,
    listAnswered,
    urls,
    self,
    spaceKind,
    now,
}: MessagingRelayPlan): RelayListWrite | null => {
    if (!listAnswered || !self) {
        return null
    }
    if (!mayWriteKind(MESSAGING_RELAYS, spaceKind)) {
        return null
    }
    const wanted: string[] = []
    for (const url of urls) {
        if (isMessagingRelayUrl(url) && !wanted.includes(url)) {
            wanted.push(url)
        }
    }
    if (wanted.length === 0) {
        return null
    }
    const current = messagingRelayUrls(list)
    if (current.length === wanted.length && current.every((url, index) => url === wanted[index])) {
        return null
    }

    return {
        kind: MESSAGING_RELAYS,
        // The list is public by design — a foreign client has to be able to read it
        // without a key. Nothing goes in `content`, and nothing is carried over from the
        // previous list either: unlike a NIP-51 list, 10050 has no encrypted half whose
        // loss would be silent.
        content: '',
        tags: wanted.map((url) => ['relay', url]),
        created_at: Math.max(Math.floor(now), (list?.created_at ?? 0) + 1),
    }
}

/**
 * Did the relay really take the write? Answered from what it hands back on a re-read,
 * not from its `OK`.
 *
 * The same shape as `muteWriteConfirmed`, and for the same reason: an `OK true` says the
 * frame was accepted, a requery says the state changed. This phase measured a relay that
 * answers `OK true` and stores nothing.
 */
export const messagingRelayWriteConfirmed = (
    list: RelayListEventLike | null,
    urls: readonly string[],
): boolean => {
    const stored = messagingRelayUrls(list)

    return stored.length === urls.length && urls.every((url, index) => stored[index] === url)
}
