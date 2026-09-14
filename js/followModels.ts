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
 * ── Which relays this is read from and written to (P2) ─────────────────────────
 *
 * **The outbox relays of the reader, plus the active space** — {@link followRelayTargets}.
 * Until P2 it was the space and nothing else, and that turned the empty merge base from
 * an edge case into the normal one: a closed NIP-29 relay stands in nobody's NIP-65 list,
 * no foreign client writes a kind 3 there, so `list: null` meant "the one relay we asked
 * does not hold it" far more often than "there is none".
 *
 * The space stays in the set rather than being replaced by the outbox: the members read
 * each other there, and a reader without a kind 10002 would otherwise have no target at
 * all.
 *
 * **What is unioned are the SOURCES, never the `p` tags.** Kind 3 is replaceable
 * (NIP-01: „for kind `n` such that `10000 <= n < 20000 || n == 0 || n == 3`, events are
 * replaceable"), so exactly one of the lists we collect is valid — {@link followListWins}
 * picks it. Merging the tags of several relays instead would look like the friendlier
 * choice and is a data corruption with its own failure class: it resurrects every
 * unfollow a relay has not caught up with yet, silently and permanently, and every
 * superficial test of it passes.
 *
 * Both relays accept kind 3: Buzz maps `KIND_CONTACT_LIST` to `Scope::UsersWrite`
 * (`crates/buzz-relay/src/handlers/ingest.rs`, the allowlist arm above the
 * `_ => Err("restricted: unknown event kind")` catch-all), zooid has no kind allowlist at
 * all. The gate below therefore denies only on `'unknown'`, which is `mayWriteKind`'s
 * fail-closed default while NIP-11 is still in flight.
 */
import { normalizeRelayUrl } from '@welshman/util'
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
 * **Does `candidate` replace `incumbent`?** The NIP-01 ordering for replaceable events,
 * written out because P2 asks it of lists from DIFFERENT relays and not just of two
 * copies in one batch.
 *
 * NIP-01, verbatim: *„In case of replaceable events with the same timestamp, the event
 * with the lowest id (first in lexical order) should be retained, and the other
 * discarded."* The tie is not exotic here — `makeEvent` stamps `created_at` in **seconds**
 * (`@welshman/util` `Events.js`), so two writes inside the same second carry the same
 * number and the id decides. Without the second line every relay would be free to pick a
 * different winner, and this client would agree with whichever one answered first.
 *
 * `>` and not `>=` on the timestamp, deliberately: with `>=` an equally old list would
 * displace the incumbent and the id rule below would never be reached, which is the same
 * "whoever answered last wins" the rule exists to remove.
 */
export const followListWins = (candidate: FollowEventLike, incumbent: FollowEventLike | null): boolean => {
    if (!incumbent) {
        return true
    }
    if (candidate.created_at !== incumbent.created_at) {
        return candidate.created_at > incumbent.created_at
    }

    return candidate.id < incumbent.id
}

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
        if (followListWins(event, newest)) {
            newest = event
        }
    }

    return newest
}

/**
 * `normalizeRelayUrl`, but **without a throw** — `''` for anything unreadable.
 *
 * The same construction and the same reasoning as `normalisiereOderNichts` in
 * `js/articleMetrics.ts`: `normalizeRelayUrl` throws a `TypeError` on garbage, and a
 * throw while assembling the relay set of a contact list would take out the read AND the
 * write for one malformed entry. An unreadable URL counts as **absent** instead, which
 * neither invents a target nor removes a well-formed one.
 *
 * What it does NOT do, measured against the installed welshman 0.9.9 rather than assumed:
 * `wss://host/` and `wss://host` collapse, `wss://HOST/` lowercases — but
 * `wss://host./` stays distinct from `wss://host/`. A trailing dot is a different name in
 * a URL and the same name in DNS; stripping it here would be this client deciding about
 * somebody else's relay entry. It simply stays a second target, which for a write is
 * harmless and for the verdict below is judged on its own.
 */
const followRelayUrl = (url: string): string => {
    if (!url) {
        return ''
    }
    try {
        return normalizeRelayUrl(url)
    } catch {
        return ''
    }
}

/**
 * **The relays a contact list is read from and written to: outbox ∪ space.**
 *
 * The space is appended rather than substituted — see the module header. Order is
 * outbox first, space last; the de-duplication keeps the first occurrence, so a space
 * that is also an outbox relay appears once and is still in the set.
 *
 * Normalised before de-duplicating, and that is not decoration: a `Set` over raw strings
 * splits `wss://host` from `wss://host/` into two targets, and this repo has been bitten
 * by exactly that class of host comparison before. Both callers happen to hand over
 * normalised URLs today (`eigeneOutboxUrls()` runs every entry through welshman's
 * `makeSelection`, `activeSpace` through `normalizeRelayUrl` in `js/groups.ts`) — which
 * is a property of the callers, not of this function, and the next caller will not have
 * it.
 */
export const followRelayTargets = (outboxUrls: readonly string[], spaceUrl: string): string[] => {
    const targets: string[] = []
    for (const raw of [...outboxUrls, spaceUrl]) {
        const url = followRelayUrl(raw)
        if (url && !targets.includes(url)) {
            targets.push(url)
        }
    }

    return targets
}

/** What ONE relay answered when asked for our own contact list. */
export type FollowRelayRead = {
    /** The relay asked, normalised by {@link followRelayTargets}. */
    url: string
    /**
     * **Did this relay close the read with an `EOSE`?** A timeout, a `CLOSED` and a
     * hanging AUTH round are all `false` — this repo has measured that a hanging AUTH
     * round swallows the `EOSE` entirely, and the answer then looks exactly like an
     * empty list.
     */
    answered: boolean
    /** The newest kind 3 of ours this relay held, or `null`. */
    list: FollowEventLike | null
}

/**
 * **The staged, fail-closed verdict: may a write be planned from what we just read?**
 *
 * | outbox | what has to have answered | why |
 * |---|---|---|
 * | non-empty | at least ONE outbox relay | the contact list lives there. An `EOSE` from the space alone says nothing about it, and treating it as an answer is precisely the defect P2 removes: the space almost never holds the list, so "answered, empty" became the normal reading of "we asked the wrong relay" |
 * | empty | any relay that was asked, i.e. the space | there is no better source. Refusing here would make following impossible for every reader without a kind 10002, and this client cannot write one for them |
 *
 * The verdict is about the relays that ANSWERED, never about the lists they carried: a
 * reader who genuinely follows nobody has an outbox relay that answers with zero events,
 * and that is a complete answer.
 */
export const followListAnswered = (reads: readonly FollowRelayRead[], outboxUrls: readonly string[]): boolean => {
    const outbox = new Set(outboxUrls.map(followRelayUrl).filter(Boolean))
    const answered = reads.filter((read) => read.answered)
    if (outbox.size > 0) {
        return answered.some((read) => outbox.has(read.url))
    }

    return answered.length > 0
}

/**
 * **The one valid list among the relays we asked** — the union of SOURCES resolved back
 * to a single event, never a union of tags (module header).
 *
 * Every read counts here, including one from a relay that never sent its `EOSE`. That is
 * deliberate and it is the opposite direction from {@link followListAnswered}: a list
 * carried by an unanswered read is still a real, signed event of ours, and taking it into
 * the comparison can only raise the winner's `created_at`, never lower it. Whether we may
 * WRITE is the verdict's question; what the merge base IS, is this one.
 */
export const winningFollowList = (reads: readonly FollowRelayRead[]): FollowEventLike | null => {
    let winner: FollowEventLike | null = null
    for (const read of reads) {
        if (read.list && followListWins(read.list, winner)) {
            winner = read.list
        }
    }

    return winner
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
    /**
     * Our own newest kind 3, as {@link winningFollowList} resolved it across the relays
     * that were asked — or `null`.
     *
     * **Since P2 `null` next to `listAnswered: true` really does mean "there is none".**
     * Before P2 the read went to the space relay alone, where a contact list practically
     * never lives, so `null` mostly meant "we asked the wrong relay" and the pair below
     * could not tell the two apart. It is the relay SET that fixed that, not this gate.
     */
    list: FollowEventLike | null
    /**
     * **Did the read that produced `list` come back answered?** From
     * {@link followListAnswered}, which is stricter than "some relay said `EOSE`": with a
     * NIP-65 list on file it takes an `EOSE` from an OUTBOX relay. `false` also covers
     * "not asked yet" — the two are the same thing here, and both must refuse.
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
 * | `!listAnswered` | **the replaceable-kind data loss**: we replace the relay's contact list with the entries we happen to know, and every follow made on another device is deleted. Since P2 the verdict behind this flag is the staged one in {@link followListAnswered} — an `EOSE` from the space relay alone no longer clears it while the reader has an outbox |
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
