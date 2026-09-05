/**
 * The one piece of NIP-59 this client builds itself — and the whole reason it does.
 *
 * ══ What is NOT rebuilt here ═════════════════════════════════════════════════════
 *
 * The seal (kind 13) is welshman's `getSeal`, called verbatim. Its `created_at` is
 * randomised with `now(5)` and that is right: the seal is the *plaintext of the wrap*,
 * so no relay ever sees its timestamp, and NIP-59 asks for exactly that randomisation to
 * defeat time-correlation. Nothing about it needs to change, and rewriting it would put
 * a second copy of somebody else's crypto in our tree for no gain.
 *
 * The rumor is welshman's `prep`. The signature is welshman's `Nip01Signer`. The
 * encryption is welshman's `nip44`. **This module signs nothing and encrypts nothing on
 * its own** — it assembles one event body and hands it to a signer.
 *
 * ══ What IS rebuilt, and why it could not be avoided ═════════════════════════════
 *
 * `getWrap` (`@welshman/signer` `nip59.js:11-19`) sets `created_at: now(5)` on the WRAP
 * — the outer event, the only one a relay sees — and offers no way to override it.
 * `now(5)` is `Math.round(Date.now() / 1000 - Math.random() * 1e5)`: up to **27 hours**
 * of backdating.
 *
 * Measured against a local Buzz slot on 2026-09-05 (`p7-messung-a-wrap-drift.txt`,
 * every result confirmed by a requery, because `nak` and a bare `OK` both lie by
 * omission):
 *
 *   created_at = now()          → `OK true`,  findable
 *   created_at = now() − 3600   → `OK false`, "invalid: event timestamp too far from
 *                                 server time", not findable
 *   welshman `getWrap` (−51984) → `OK false`, same message, not findable
 *
 * The gate is `MAX_TIMESTAMP_DRIFT_SECS = 900` in `buzz-relay/src/handlers/ingest.rs`,
 * and it sits directly after the signature check, **before** any per-kind handling — so
 * it is not a gift-wrap rule that could be relaxed for gift wraps. With welshman's
 * randomisation roughly 0.9 % of messages would arrive. The same three wraps against a
 * local zooid are all accepted (no timestamp gate there at all), so this is a Buzz
 * constraint, not a protocol one.
 *
 * ══ The timestamp we choose instead ══════════════════════════════════════════════
 *
 * Not `now()` flat. NIP-59's reason for randomising stands — a wrap whose `created_at`
 * is the send time tells an observer when a message was written, which is most of what
 * traffic analysis wants. {@link wrapCreatedAt} therefore keeps the randomisation and
 * only shrinks its range to what the strictest relay in this deployment accepts:
 * {@link MAX_WRAP_BACKDATE_SECONDS} seconds, comfortably inside the measured 900.
 *
 * The rumor keeps its own true `created_at` inside the ciphertext, so nothing about
 * message ORDER in the conversation depends on this number.
 */
import { WRAP, hash, prep, type SignedEvent, type StampedEvent } from '@welshman/util'
import { Nip01Signer, getSeal, type ISigner } from '@welshman/signer'

/**
 * How far back a wrap's `created_at` may be randomised.
 *
 * 600 and not 900: the relay compares against ITS clock, and a client whose clock runs
 * a few minutes fast would otherwise land outside the window through no fault of the
 * randomiser. 300 seconds of headroom on a measured 900 costs nothing and removes a
 * whole class of "works on my machine".
 */
export const MAX_WRAP_BACKDATE_SECONDS = 600

/**
 * The `created_at` of the outer wrap.
 *
 * Three rules, and each one is a real constraint rather than taste:
 *
 *  1. **Never in the future.** A relay that clamps future timestamps would reject it,
 *     and there is no privacy gain in the direction that has no history to hide in.
 *  2. **Never further back than `maxBackdate`.** This is the Buzz gate, measured.
 *  3. **A whole number of seconds.** `created_at` is an integer in NIP-01; a fractional
 *     value serialises into the id hash and produces an event no relay will accept.
 */
export const wrapCreatedAt = (
    nowSeconds: number,
    maxBackdate: number = MAX_WRAP_BACKDATE_SECONDS,
    random: () => number = Math.random,
): number => {
    const span = Math.max(0, Math.floor(maxBackdate))
    const back = Math.floor(Math.min(Math.max(random(), 0), 0.999_999) * (span + 1))

    return Math.floor(nowSeconds) - back
}

export type GiftWrapInput = {
    /** The author of the message. Their signer seals it; their identity stays inside. */
    sender: ISigner
    /** Hex pubkey of the recipient. Also the wrap's one `p` tag. */
    recipient: string
    /** The rumor to deliver — a kind 14 for NIP-17, but this module does not care. */
    template: StampedEvent
    /** Extra tags on the OUTER wrap. Visible to every relay; NIP-17 uses none. */
    tags?: string[][]
    /** Seconds since the epoch. Injected so the builder is testable without a clock. */
    now: number
    random?: () => number
}

/**
 * Seal a rumor for one recipient and wrap it under a throwaway key.
 *
 * The wrapper is `Nip01Signer.ephemeral()` — a key generated for this one event and
 * dropped. That is what hides the sender: the wrap is signed by a pubkey nobody has
 * ever seen, and the real author is only inside the seal, which only the recipient can
 * open. Reusing a key here, even once, would undo the entire construction.
 */
export const buildGiftWrap = async ({
    sender,
    recipient,
    template,
    tags = [],
    now,
    random,
}: GiftWrapInput): Promise<SignedEvent> => {
    const author = await sender.getPubkey()
    const rumor = prep(template, author)
    const seal = await getSeal(sender, recipient, rumor)
    const wrapper = Nip01Signer.ephemeral()

    return wrapper.sign(
        hash({
            kind: WRAP,
            pubkey: await wrapper.getPubkey(),
            content: await wrapper.nip44.encrypt(recipient, JSON.stringify(seal)),
            created_at: wrapCreatedAt(now, MAX_WRAP_BACKDATE_SECONDS, random),
            tags: [...tags, ['p', recipient]],
        }),
    )
}
