/**
 * Unpacking NIP-59 wraps — **our own path, not `appPolicyWraps`**, and the reason is a
 * measured hole in welshman's.
 *
 * ══ What `appPolicyWraps` does with what it unwraps ══════════════════════════════
 *
 * `Wraps` hands every unwrapped rumor to `WrapManager.add`, and that
 * (`@welshman/net` `wrapManager.js:42-44`) does two things this client cannot live with:
 *
 *     this.options.repository.publish(rumor)      // into the SHARED repository
 *     this.options.tracker.copy(wrap.id, rumor.id) // …with the wrap's relay origin
 *
 * The rumor is **unsigned** — a rumor has no `sig` and never will — and `unwrap`
 * (`@welshman/signer` `nip59.js`) checks exactly two things about it: that the seal that
 * carried it was signed by the pubkey it claims, and `isHashedEvent`, which is
 * `typeof id === "string" && id.length === 64` and **verifies no hash at all**.
 *
 * So anybody allowed to send us a private message — which is the entire feature — could
 * put a rumor of ANY kind in the envelope, with a freely chosen id, and it would land in
 * the repository that every reading surface derives from, wearing the relay origin of the
 * envelope. Measured against the real app instance on 2026-09-05: a kind 9 carrying
 * `["h", "welcome"]` inside a **solicited** wrap ends up in
 * `deriveEventsForUrl(url, [{kinds:[9], "#h":["welcome"]}])` — which is the shape of
 * `roomStreamFilter` (`js/feeds.ts`), the source `deriveRoomChat` reads. A foreign,
 * unsigned message in the room feed, past the kind allowlist, past the room membership
 * rules and past `verifyEvent`, with no relay involved in the trick: only the ENVELOPE
 * has to be accepted, and kind 1059 is accepted by both relays by design.
 *
 * ══ What this module does instead ════════════════════════════════════════════════
 *
 * The same unwrap — welshman's `Nip59`, no own crypto — and then:
 *
 *  1. **only kind 14 and 15** ({@link PRIVATE_MESSAGE_KINDS}) are accepted, so a wrap can
 *     only ever produce a private message and never a room message, a profile, a
 *     deletion or a list;
 *  2. the rumor's **id is recomputed** and must match, so a prefilled id cannot shadow a
 *     real event anywhere;
 *  3. a rumor carrying a `sig` is refused — a signed object is not a rumor, and letting
 *     one through would put something into the private view that can be replayed and
 *     forwarded as authenticated;
 *  4. accepted rumors go into {@link privateRumors}, **a store of this module**, never
 *     into `app.repository`, and **no tracker entry is written** for them.
 *
 * The origin check in `js/welshmanInstance.ts` stays in front of all of this and is
 * unchanged: it is what keeps an unsolicited wrap from costing a signer call at all
 * (measured 25 → 0). This module is the second half — what may come OUT of a wrap we did
 * ask for.
 *
 * ══ Sequential on purpose ════════════════════════════════════════════════════════
 *
 * welshman's queue runs a batch of 50 concurrently. Every one of those is a
 * `nip44.decrypt` at the user's signer, and on NIP-46 that is a bunker round trip, on
 * NIP-55 a prompt on the device. One after another is slower and does not stampede a
 * remote signer.
 */
import { derived, writable, type Readable } from 'svelte/store'
import { DIRECT_MESSAGE, WRAP, getHash, type TrustedEvent } from '@welshman/util'
import { Nip59 } from '@welshman/signer'
import { on } from '@welshman/lib'
import type { AppPolicy, IApp } from '@welshman/app'

/** NIP-17: a text message (14) and a file message (15). Nothing else comes out of a wrap. */
export const PRIVATE_MESSAGE_KINDS: ReadonlySet<number> = new Set([DIRECT_MESSAGE, 15])

/** The shape this module checks. A rumor has no `sig`; the optional field is the point. */
export type RumorCandidate = {
    id?: unknown
    kind?: unknown
    pubkey?: unknown
    created_at?: unknown
    content?: unknown
    tags?: unknown
    sig?: unknown
}

/**
 * May this unwrapped object become a private message?
 *
 * Pure, so every rule below is decidable under `node --test` without a signer. Each of
 * the four refusals is a measured failure mode, not defensive habit — the module header
 * says what each one prevents.
 */
export const acceptRumor = (rumor: RumorCandidate | null | undefined): boolean => {
    if (!rumor || typeof rumor !== 'object') {
        return false
    }
    if (typeof rumor.kind !== 'number' || !PRIVATE_MESSAGE_KINDS.has(rumor.kind)) {
        return false
    }
    // A rumor is unsigned. Anything carrying a signature came from somewhere else and
    // must not enter the view that promises "this was sealed to me".
    if (rumor.sig !== undefined && rumor.sig !== '') {
        return false
    }
    // NIP-01 says `created_at` is a whole number of seconds. Measured on 2026-09-05:
    // this function accepted `1.5`, and since the id is hashed over the SAME body the id
    // still matched. Upstream refuses that one today (`isStampedEvent` checks
    // `created_at % 1 === 0 && created_at >= 0`) — but a gate that only holds because
    // somebody else's check happens to run first is not a gate, and this one is the
    // reason this whole phase exists. It is checked here.
    //
    // What it buys, concretely: `created_at` is the sort key of the conversation list and
    // it sits INSIDE the ciphertext, so no relay gates it. Without the rule a sender
    // chooses where their own message lands in the reader's list.
    if (typeof rumor.created_at !== 'number' || !Number.isInteger(rumor.created_at) || rumor.created_at < 0) {
        return false
    }
    if (typeof rumor.pubkey !== 'string' || rumor.pubkey.length !== 64) {
        return false
    }
    if (typeof rumor.id !== 'string' || rumor.id.length !== 64) {
        return false
    }
    // `isHashedEvent` upstream checks the LENGTH of the id and nothing else. Recompute it:
    // a free id would let a sender pick which event of ours the object collides with.
    try {
        return getHash(rumor as never) === rumor.id
    } catch {
        return false
    }
}

/** Every private message this session has unwrapped, newest write wins per id. */
const rumorsById = writable<Map<string, TrustedEvent>>(new Map())

/**
 * The unwrapped private messages — the ONLY source `js/privateMessages.ts` reads.
 *
 * Deliberately not the repository: see the module header. Nothing else in the client can
 * put anything in here, and nothing in here is persisted (neither 1059 nor 14 is in
 * `PERSIST_KINDS`, held by `js/storagePersistKinds.test.ts`).
 */
export const privateRumors: Readable<TrustedEvent[]> = derived(rumorsById, ($byId) => Array.from($byId.values()))

/** Only for tests: forget everything this session unwrapped. */
export const clearPrivateRumors = (): void => rumorsById.set(new Map())

/**
 * Put a message WE just sealed into the same store, so it shows without a round trip.
 *
 * It goes through {@link acceptRumor} like anything else — not out of suspicion of our
 * own sender, but because a second door into this store is a second set of rules, and the
 * second set is the one nobody checks again. This is also what keeps the relay's echo of
 * our own envelope from costing another decryption: the id is already known.
 */
export const addOwnPrivateMessage = (rumor: TrustedEvent): boolean => {
    if (!acceptRumor(rumor as RumorCandidate)) {
        return false
    }
    rumorsById.update(($byId) => new Map($byId).set(rumor.id, rumor))

    return true
}

/**
 * Watch the repository for wraps and unwrap them into {@link privateRumors}.
 *
 * The backlog loop is welshman's shape and runs over an empty repository at construction
 * time — wraps can only arrive later, through the origin-checked ingest.
 */
export const appPolicyPrivateWraps: AppPolicy = (app: IApp) => {
    const seen = new Set<string>()
    let chain: Promise<void> = Promise.resolve()

    const unpack = async (wrap: TrustedEvent): Promise<void> => {
        const user = app.user
        if (!user || seen.has(wrap.id)) {
            return
        }
        // The envelope has to name us. `Wraps` checks this too, and it is the difference
        // between "a message for me" and "a message the relay copied to me".
        if (!wrap.tags.some((tag) => tag[0] === 'p' && tag[1] === user.pubkey)) {
            return
        }
        seen.add(wrap.id)
        try {
            const rumor = await Nip59.fromSigner(user.signer).unwrap(wrap as never)
            if (!acceptRumor(rumor as RumorCandidate)) {
                return
            }
            rumorsById.update(($byId) => new Map($byId).set(rumor.id, rumor as TrustedEvent))
        } catch {
            // Remembered through `seen`: retrying costs another signer call for an
            // envelope we already know we cannot open.
        }
    }

    const enqueue = (wrap: TrustedEvent): void => {
        chain = chain.then(() => unpack(wrap))
    }

    for (const wrap of app.repository.query([{ kinds: [WRAP] }])) {
        enqueue(wrap)
    }

    return on(app.repository, 'update', ({ added }: { added: TrustedEvent[] }) => {
        for (const event of added) {
            if (event.kind === WRAP) {
                enqueue(event)
            }
        }
    })
}
