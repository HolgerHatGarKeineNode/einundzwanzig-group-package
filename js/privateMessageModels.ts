/**
 * NIP-17 private messages (kind 14 inside a NIP-59 wrap) — the pure half of P7.
 *
 * Counterpart to `js/privateMessages.ts` (signer, relays, store). Browser-free and
 * store-free like `muteModels.ts` and `messagingRelayModels.ts`, so every rule below is
 * decidable under `node --test`.
 *
 * ══ What a conversation IS here, and why it is not a room ════════════════════════
 *
 * A Buzz DM is a channel with an `h` (`dmModels.ts` says it at length), and the whole
 * chat surface of this client is built on `#h`. A NIP-17 conversation has no `h` and no
 * identity of its own at all: it is nothing but **the set of people in it**. Two rumors
 * belong together when their participant sets match, and that is the only join there is
 * — {@link conversationKey}.
 *
 * The consequence, stated because it will surprise somebody: adding a person does not
 * extend a conversation, it starts a different one. That is not a limitation of this
 * client, it is what the protocol says a conversation is. (Buzz behaves the same way for
 * its own DMs, for its own reasons — `command_executor.rs:527-533`, "DM sets are
 * immutable".)
 *
 * ══ A rumor is UNSIGNED ══════════════════════════════════════════════════════════
 *
 * `unwrap` verifies exactly one thing: that the seal it came out of was signed by the
 * pubkey the rumor claims (`nip59.js`, `seal.pubkey !== rumor.pubkey` throws). After
 * that moment nothing about the object is verifiable — it carries no signature and never
 * will. So this module treats `rumor.pubkey` as the author (that IS the proof) and
 * treats the rumor as something that must never be persisted or forwarded. Neither 1059
 * nor 14 is in `PERSIST_KINDS`, and `js/storage.test.ts` holds that down.
 *
 * ══ The size ceiling is a real wall, not a style rule ════════════════════════════
 *
 * NIP-44 v2 refuses a plaintext over 65535 bytes, and the message is encrypted TWICE:
 * the rumor goes into the seal, and the base64 of that goes into the wrap. Base64 adds a
 * third, so a rumor near the limit produces a seal over it and the send fails at the
 * signer with a message no user can act on. {@link MAX_PRIVATE_MESSAGE_BYTES} is set
 * well below the point where that can happen, and `privateMessageModels.test.ts` proves
 * the ceiling by actually wrapping a message of exactly that size.
 */
import { DIRECT_MESSAGE, WRAP, normalizeRelayUrl } from '@welshman/util'
import { mayWriteKind } from './relayCapability.ts'
import type { SpaceKind } from './spaceCaps.ts'

export { DIRECT_MESSAGE }

/**
 * The largest message body this client will send, in UTF-8 bytes.
 *
 * 16 KiB. The wall is NIP-44's 65535-byte plaintext limit applied to the SEAL, whose
 * body is the base64 of the encrypted rumor — roughly `1.34 × (rumor + 100) + 200`. At
 * 16 KiB of text the seal lands near 22 KB, so there is a factor of three in hand for
 * tags, a long participant list and multi-byte characters. The ceiling is asserted by
 * building a real wrap at exactly this size, not by arithmetic in a comment.
 */
export const MAX_PRIVATE_MESSAGE_BYTES = 16 * 1024

/** A rumor as it comes out of the wrap manager — only the fields this module reads. */
export type RumorLike = {
    id: string
    kind: number
    pubkey: string
    created_at: number
    content: string
    tags: string[][]
}

export type PrivateConversation = {
    /** The participant set, canonical — see {@link conversationKey}. */
    key: string
    /** Everybody in it, including the reader, sorted. */
    participants: string[]
    /** Everybody except the reader, in the same order. */
    others: string[]
    lastAt: number
    preview: string
    count: number
}

const isHexPubkey = (value: unknown): value is string =>
    typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)

/**
 * The canonical identity of a conversation: its participants, deduplicated, sorted,
 * joined.
 *
 * Sorted and not "author first": the same conversation has to produce the same key no
 * matter who sent the message being folded, or every reply would open a new thread.
 * Non-hex entries are dropped rather than kept as-is — a malformed `p` tag from a
 * foreign client must not be able to split a conversation in two.
 */
export const conversationKey = (pubkeys: readonly string[]): string =>
    Array.from(new Set(pubkeys.filter(isHexPubkey))).sort().join(',')

/**
 * Who is in the conversation this rumor belongs to: its author plus its `p` tags.
 *
 * The author comes from `rumor.pubkey`, which is the one thing the unwrap proved. The
 * `p` tags come from inside the ciphertext, so they are the sender's claim about the
 * participant list — which is exactly what they are meant to be. Nothing here comes from
 * the OUTER wrap, whose single `p` tag is public and says only where the envelope went.
 */
export const conversationParticipants = (rumor: RumorLike): string[] => {
    const people = [rumor.pubkey]
    for (const tag of rumor.tags) {
        if (tag[0] === 'p' && isHexPubkey(tag[1])) {
            people.push(tag[1])
        }
    }

    return Array.from(new Set(people.filter(isHexPubkey))).sort()
}

/** Is this rumor a NIP-17 message the reader is part of? */
export const isOwnPrivateMessage = (rumor: RumorLike, self: string): boolean =>
    rumor.kind === DIRECT_MESSAGE &&
    isHexPubkey(self) &&
    conversationParticipants(rumor).includes(self)

/**
 * Fold rumors into conversations, newest first.
 *
 * Ties on `lastAt` are broken by key so the order is stable across recomputes — a list
 * that reshuffles on every incoming message is unusable, and two messages in the same
 * second is the normal case in a live exchange.
 */
export const foldPrivateConversations = (
    rumors: readonly RumorLike[],
    self: string,
): PrivateConversation[] => {
    const byKey = new Map<string, PrivateConversation>()
    for (const rumor of rumors) {
        if (!isOwnPrivateMessage(rumor, self)) {
            continue
        }
        const participants = conversationParticipants(rumor)
        const key = conversationKey(participants)
        const existing = byKey.get(key)
        if (!existing) {
            byKey.set(key, {
                key,
                participants,
                others: participants.filter((pubkey) => pubkey !== self),
                lastAt: rumor.created_at,
                preview: rumor.content,
                count: 1,
            })
            continue
        }
        existing.count += 1
        if (rumor.created_at > existing.lastAt) {
            existing.lastAt = rumor.created_at
            existing.preview = rumor.content
        }
    }

    return Array.from(byKey.values()).sort((a, b) => b.lastAt - a.lastAt || a.key.localeCompare(b.key))
}

/**
 * The messages of one conversation, oldest first.
 *
 * Ties broken by id, for the same stability reason as above: without it a reload could
 * put two messages of the same second in the other order, and a reader would believe the
 * answer came before the question.
 */
export const privateConversationMessages = (
    rumors: readonly RumorLike[],
    self: string,
    key: string,
): RumorLike[] =>
    rumors
        .filter((rumor) => isOwnPrivateMessage(rumor, self) && conversationKey(conversationParticipants(rumor)) === key)
        .sort((a, b) => a.created_at - b.created_at || a.id.localeCompare(b.id))

export type PrivateMessagePlan = {
    text: string
    /** Everybody who should receive it, excluding the sender. */
    recipients: readonly string[]
    self: string
    spaceKind: SpaceKind
    now: number
}

export type PrivateMessageDraft = {
    /** The rumor template, before `prep` stamps and hashes it. */
    template: { kind: number; content: string; tags: string[][]; created_at: number }
    /** Who gets a wrap — the recipients AND the sender, so their other devices see it. */
    wrapFor: string[]
}

/**
 * The message to send, or `null` when it must not be sent.
 *
 * The refusals, and what each one prevents:
 *
 *  1. **No identity / no recipient.** Nothing to seal, nobody to seal it for.
 *  2. **Blank text.** An empty encrypted message is indistinguishable from a delivery
 *     bug on the receiving side.
 *  3. **Over the ceiling.** See {@link MAX_PRIVATE_MESSAGE_BYTES} — the alternative is a
 *     failure inside NIP-44 that surfaces as an opaque signer error.
 *  4. **The reader as their own recipient.** A self-copy is added anyway (`wrapFor`);
 *     letting `recipients` contain the sender would make the participant set differ from
 *     the one the receivers compute and split the conversation in two.
 *  5. **A space that cannot take kind 1059.** Fail-closed on `'unknown'`, so a message
 *     is never sent to a relay whose NIP-11 doc has not arrived yet.
 *
 * `wrapFor` includes the sender on purpose. NIP-17 has no "sent" folder: the only way a
 * second device of the author ever sees the message is a wrap addressed to the author.
 * Leaving it out is the classic way this feature ships half-working.
 */
export const planPrivateMessage = ({
    text,
    recipients,
    self,
    spaceKind,
    now,
}: PrivateMessagePlan): PrivateMessageDraft | null => {
    if (!isHexPubkey(self)) {
        return null
    }
    if (!mayWriteKind(WRAP, spaceKind)) {
        return null
    }
    const body = text.trim()
    if (body === '') {
        return null
    }
    if (new TextEncoder().encode(body).length > MAX_PRIVATE_MESSAGE_BYTES) {
        return null
    }
    const others = Array.from(new Set(recipients.filter(isHexPubkey))).filter((pubkey) => pubkey !== self)
    if (others.length === 0) {
        return null
    }

    return {
        template: {
            kind: DIRECT_MESSAGE,
            content: body,
            tags: others.map((pubkey) => ['p', pubkey]),
            created_at: Math.floor(now),
        },
        wrapFor: [...others, self],
    }
}

/** Same normalisation the pool uses, without letting a malformed entry throw. */
const sameRelay = (url: string): string => {
    try {
        return normalizeRelayUrl(url)
    } catch {
        return ''
    }
}

/**
 * Where one recipient's wrap goes.
 *
 * NIP-17 says: the relays in their kind-10050 list. **That list is written by somebody
 * else**, and this function is the reason that matters.
 *
 * ══ The addresses are FOREIGN input, and they used to reach the socket pool ══════
 *
 * Found by the P7 security audit and reproduced in both directions. A 10050 is a public,
 * replaceable event anybody can publish; naming an address in it used to be enough to
 * make this client open a socket there. `darfAuthBekommen` (`js/relayConfig.ts`) is
 * fail-OPEN by construction — its own docblock predicted this exact path: *"it is
 * fail-OPEN for anything that comes later. A new foreign-relay path … gets AUTH without
 * anybody doing anything"* — so the relay of the sender's choosing received a NIP-42
 * kind 22242 signed with OUR pubkey. That binds our IP to our identity for a stranger,
 * which is the opposite of what this whole surface promises.
 *
 * ══ An allow list, and what it costs ═════════════════════════════════════════════
 *
 * `allowed` is the set of relays this client already speaks to on its own account — the
 * active space and our own published messaging relays. A listed address outside it is
 * dropped, and the message goes to the fallback instead. Compared after
 * `normalizeRelayUrl`, so a different spelling of the same address is not a different
 * relay; a malformed entry normalises to `''` and never matches.
 *
 * **The price, stated rather than discovered:** a recipient who reads private messages
 * ONLY on a third relay does not get the message there. This client reads on the active
 * space and nowhere else (the "one space, one list" decision), so the asymmetry would
 * exist either way — but it is a real limit and it is in the plan's Restposten. Widening
 * it needs the other fix, which is `darfAuthBekommen` becoming fail-closed, and that
 * touches every relay path in the client rather than this one.
 *
 * The two rules that were here before stand unchanged:
 *
 *  - **Fallback to the space relay** when nothing survives. Without it the feature would
 *    be dead on a Buzz-only deployment, where 10050 cannot be published at all.
 *  - **Never an empty answer with a fallback available.** A send with no target succeeds
 *    locally and arrives nowhere; the caller has to be able to tell that apart.
 */
export const messageTargets = (
    listed: readonly string[],
    fallback: string,
    allowed: readonly string[] = [],
): string[] => {
    const permitted = new Set(allowed.map(sameRelay).filter((url) => url !== ''))
    // **The NORMALISED form is what comes back, not the string that was checked.**
    // Returning the raw entry was the same class of defect this whole phase ran against:
    // one form is checked, another is used. `space.example` normalises to
    // `wss://space.example/`, passes the allow list — and the caller would have received
    // `space.example`. Unreachable today only because the one production caller filters
    // through `isMessagingRelayUrl` first, and nobody promised to keep that filter.
    const urls = listed
        .filter((url) => typeof url === 'string' && url !== '')
        .map(sameRelay)
        .filter((url) => url !== '' && permitted.has(url))
    if (urls.length > 0) {
        return Array.from(new Set(urls))
    }

    return fallback ? [fallback] : []
}
