/**
 * NIP-02 contact list (kind 3) — the pure half (P8).
 *
 * Browser-free and store-free, exactly like `js/muteModels.ts`, whose shape this module
 * follows down to the naming: every rule below is decidable under `node --test` without a
 * relay, without a signer and without mocks. The network and store half lives in
 * `js/follows.ts`, the button in `resources/views/components/profile-card.blade.php`.
 *
 * ── Why kind 3 is the most dangerous replaceable list in this client ─────────────
 *
 * It is ONE list per pubkey, it is global (not space-bound), and for most people it is
 * the single most valuable object they own on nostr — the list every other client reads
 * to decide what their feed contains. Every write replaces the whole thing. A client that
 * writes with an incomplete picture deletes every contact it never saw, and nothing about
 * that is recoverable from this side.
 *
 * This repository has measured the failure once already, on a different list: welshman's
 * `forceLoad` returns `undefined` on a dead socket, and the caller wrote a replaceable
 * event with ONE entry. So {@link planFollowWrite} takes `listAnswered` and refuses to
 * produce an event body when the relay has not answered. Not "write an empty list", not
 * "write ours anyway": **no event at all.**
 *
 * ── What is carried over untouched ──────────────────────────────────────────────
 *
 * Two things, and both for the same reason — this client cannot display them, so it must
 * not decide about them:
 *
 *  · **`content`.** Historically a JSON map of relay URLs to read/write flags (NIP-02
 *    calls it deprecated, plenty of clients still read it). Carried byte for byte.
 *  · **Every tag that is not a `p` tag**, and the extra columns of the `p` tags that
 *    stay: `["p", <pubkey>, <relay hint>, <petname>]`. A follow written here adds a bare
 *    two-element tag, but an existing entry keeps its hint and petname.
 *
 * ── Which relay this is written to ──────────────────────────────────────────────
 *
 * The active space, like every other write in this client. Both relays accept kind 3:
 * Buzz maps `KIND_CONTACT_LIST` to `Scope::UsersWrite`
 * (`crates/buzz-relay/src/handlers/ingest.rs`, the allowlist arm above the
 * `_ => Err("restricted: unknown event kind")` catch-all), zooid has no kind allowlist at
 * all. The gate below therefore denies only on `'unknown'`, which is `mayWriteKind`'s
 * fail-closed default while NIP-11 is still in flight.
 */
import { FOLLOWS } from './welshmanKinds.ts'
import { mayWriteKind } from './relayCapability.ts'
import type { SpaceKind } from './spaceCaps.ts'

export { FOLLOWS }

/** As much of an event as anything here touches — deliberately not a welshman type. */
export type FollowEventLike = {
    id: string
    kind: number
    pubkey: string
    created_at: number
    tags: string[][]
    content: string
}

/** The NIP-02 tag name that names a followed person. */
export const FOLLOW_PERSON_TAG = 'p'

/** Is this tag a follow entry with a usable value? */
export const isFollowPersonTag = (tag: string[]): boolean =>
    tag[0] === FOLLOW_PERSON_TAG && typeof tag[1] === 'string' && tag[1] !== ''

/**
 * This user's newest kind-3, or `null`.
 *
 * Newest per author and not simply "the first one": the repository keeps one event per
 * replaceable address, but a cold start can hand us an IndexedDB copy and a fresh one in
 * the same batch, and the older of the two would otherwise decide who is followed.
 */
export const ownFollowList = (events: FollowEventLike[], self: string): FollowEventLike | null => {
    if (!self) {
        return null
    }
    let newest: FollowEventLike | null = null
    for (const event of events) {
        if (event.kind !== FOLLOWS || event.pubkey !== self) {
            continue
        }
        if (!newest || event.created_at > newest.created_at) {
            newest = event
        }
    }

    return newest
}

/** The followed pubkeys of one list, in list order, deduplicated. */
export const followedPubkeysOf = (list: FollowEventLike | null): string[] => {
    const seen = new Set<string>()
    for (const tag of list?.tags ?? []) {
        if (isFollowPersonTag(tag)) {
            seen.add(tag[1] as string)
        }
    }

    return [...seen]
}

/**
 * The full tag list after following one person — **newest first**, every foreign tag kept.
 *
 * Prepending for the same reason `withMutedPubkey` does: a list that grows at the bottom
 * pushes the entry the user just made out of sight wherever it is rendered top down.
 *
 * The new entry is a bare `["p", <pubkey>]`. A relay hint would be a guess — the space we
 * happen to be on is not necessarily where that person writes — and an invented hint is
 * worse than none, because other clients act on it.
 */
export const withFollowedPubkey = (tags: string[][], target: string): string[][] => [
    [FOLLOW_PERSON_TAG, target],
    ...tags.filter((tag) => !(isFollowPersonTag(tag) && tag[1] === target)),
]

/** The full tag list after unfollowing one person. Every other tag stays. */
export const withoutFollowedPubkey = (tags: string[][], target: string): string[][] =>
    tags.filter((tag) => !(isFollowPersonTag(tag) && tag[1] === target))

/** The body of the event a write would produce — nothing more than that. */
export type FollowWrite = { kind: number; content: string; tags: string[][] }

/** What {@link planFollowWrite} needs to answer. */
export type FollowPlanInput = {
    /** Our own newest kind 3 as the relay last showed it, or `null` for "there is none". */
    list: FollowEventLike | null
    /**
     * **Did the relay answer the read that produced `list`?** `false` also covers "not
     * asked yet" — the two are the same thing here, and both must refuse.
     */
    listAnswered: boolean
    /** The person to follow or unfollow. */
    target: string
    /** The reader's own pubkey; `''` for a guest. */
    self: string
    add: boolean
    /** From `deriveSpaceKind`; `'unknown'` denies. */
    spaceKind: SpaceKind
}

/** Are these two tag lists the same list? Order counts — a reorder IS a change. */
const sameTags = (a: string[][], b: string[][]): boolean =>
    a.length === b.length && a.every((tag, i) => tag.length === b[i]?.length && tag.every((v, j) => v === b[i]?.[j]))

/**
 * **The gate and the event body in one decision.** `null` means: do not write.
 *
 * Same construction as `planMuteWrite`, and for the same reason: a call to a gate whose
 * result is dropped looks exactly like one that is honoured, so gate and body are made
 * the same value. A caller that skips this has nothing to sign.
 *
 * The five refusals, each with what it prevents:
 *
 * | refusal | what happens without it |
 * |---|---|
 * | `!target` / `!self` | an empty `p` tag, or a guest write with no key |
 * | `target === self` | following yourself — harmless on the wire, but it puts a row in every reader's contact list that means nothing, and the button would offer "unfollow yourself" forever |
 * | `!listAnswered` | **the replaceable-kind data loss**: we replace the relay's contact list with the entries we happen to know, and every follow made on another device is deleted |
 * | `!mayWriteKind` | a write while the relay kind is still `'unknown'`, i.e. a guess about which relay we are talking to |
 * | `sameTags` | a signed event that changes nothing — a double click, or a second device that got there first |
 *
 * `content` is carried over unchanged: the relay map some clients still keep there is not
 * ours to rewrite (module header).
 */
export const planFollowWrite = (input: FollowPlanInput): FollowWrite | null => {
    const { list, listAnswered, target, self, add, spaceKind } = input
    if (!target || !self || target === self) {
        return null
    }
    if (!listAnswered) {
        return null
    }
    if (!mayWriteKind(FOLLOWS, spaceKind)) {
        return null
    }
    const current = list?.tags ?? []
    const tags = add ? withFollowedPubkey(current, target) : withoutFollowedPubkey(current, target)
    if (sameTags(current, tags)) {
        return null
    }

    return { kind: FOLLOWS, content: list?.content ?? '', tags }
}

/**
 * Did the relay really take the write?
 *
 * `OK true` does not say so: zooid's `ReplaceEvent` drops a replaceable event whose
 * `created_at` is not greater than the stored one and returns no error
 * (`zooid/events.go:440-443`, written out in `js/pins.ts` at `pinStateReached`). A clock
 * that runs behind makes every follow a silent no-op while the relay keeps saying yes.
 *
 * `null` means the relay answered nothing, and that is **not** a failure — the same
 * asymmetry `muteWriteConfirmed` spells out: a hanging AUTH round swallows the `EOSE` of
 * a request entirely, and turning "cannot tell" into a red error would contradict a
 * verdict we already have, most often for the people with the worst connection. A
 * *positive* answer that disagrees with us is trusted; an *absent* one is not evidence.
 *
 * Note the direction this differs from {@link planFollowWrite}: there, silence must block
 * the write, because a write on an unknown list destroys foreign data. Here the write has
 * already happened and been acknowledged, and silence only means we cannot re-check it.
 */
export const followWriteConfirmed = (
    relayTags: string[][] | null,
    target: string,
    shouldBeFollowed: boolean,
): boolean => {
    if (relayTags === null) {
        return true
    }

    return relayTags.some((tag) => isFollowPersonTag(tag) && tag[1] === target) === shouldBeFollowed
}
