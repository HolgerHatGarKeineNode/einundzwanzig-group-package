/**
 * NIP-51 person mutes (kind 10000) — the pure half (P6).
 *
 * Browser-free and store-free, exactly like `js/bookmarkModels.ts`, whose shape this
 * module follows down to the naming: every rule below is decidable under `node --test`
 * without a relay, without a signer and without mocks. The network and store half lives
 * in `js/mutes.ts`, the display filter is applied in `js/feeds.ts`.
 *
 * ── Two different things are called "mute" in this client ────────────────────────
 *
 * **Room mute** — kind 30078, `d=channel-mutes`, workspace-bound, per-channel merge over
 * `updatedAt` (`js/channelPrefsData.ts`). **Person mute** — kind 10000, global, NIP-51
 * tag list, this module. Different kinds, different relays, different merge rules, no
 * shared code. They therefore carry different words and different icons in the surface:
 * the room keeps `bell-slash` and "stummschalten", the person gets `eye-slash` and
 * "ausblenden". That decision was taken in P4 and is held by a comment in both room
 * menus so nobody reuses the room wording here.
 *
 * ── What a mute is, and what it deliberately is not ──────────────────────────────
 *
 * It hides an author **in the chat list of this client, for this reader**. The events
 * still travel over the wire, are still stored in the repository, still count towards
 * reaction and thread numbers, and any other client reads them normally. It is not a
 * ban, not a block, and not confidentiality. The association does not ban or remove its
 * members (decision 2026-09-03, held by `js/moderationSurfaceGate.ts`); this is the
 * personal tool that exists *instead*, and the surface says so in a sentence rather than
 * in a comment.
 *
 * ── Why the tag algebra is written here rather than taken from `@welshman/domain` ──
 *
 * The same three reasons `bookmarkModels.ts` lists for kind 10003, and the first one is
 * a data-loss bug that applies unchanged to 10000: `ListWriter.renderContent()` returns
 * `""` for a list whose decrypted private payload is not an array of string arrays
 * (`core/ListReader.js` sets `decrypted = true` *before* it validates), so a foreign
 * private half can be signed away. `@welshman/app`'s `MuteLists` plugin builds on exactly
 * that writer.
 *
 * **This module never decrypts and never re-encrypts.** `content` is carried over byte
 * for byte, so the private half of a mute list written by another client cannot be lost
 * by anything we do. The price is stated rather than hidden: this client writes only the
 * PUBLIC half. See {@link planMuteWrite}.
 *
 * ── The rule this phase exists for: kind 10000 is replaceable ────────────────────
 *
 * One list per pubkey; every write replaces the whole thing. A client that writes with an
 * incomplete picture deletes the entries it never saw — two tabs, or one tab and a phone,
 * lose each other. Same class as kind 3. So {@link planMuteWrite} takes `listAnswered`
 * and refuses to produce an event body when the relay has not answered. Not "write an
 * empty list", not "write ours anyway": **no event at all.**
 */
import { MUTES } from './welshmanKinds.ts'
import { mayWriteKind } from './relayCapability.ts'
import type { SpaceKind } from './spaceCaps.ts'

export { MUTES }

/** As much of an event as anything here touches — deliberately not a welshman type. */
export type MuteEventLike = {
    id: string
    kind: number
    pubkey: string
    created_at: number
    tags: string[][]
    content: string
}

/**
 * The NIP-51 tag name that mutes a PERSON.
 *
 * A mute list may also carry `t` (hashtag), `word` and `e` (thread). This client neither
 * writes nor reads those — but it must not drop them either, which is why every write
 * below filters on `p` and leaves every other tag standing.
 */
export const MUTE_PERSON_TAG = 'p'

/** Is this tag a person mute with a usable value? */
export const isMutePersonTag = (tag: string[]): boolean =>
    tag[0] === MUTE_PERSON_TAG && typeof tag[1] === 'string' && tag[1] !== ''

/**
 * This user's newest kind-10000, or `null`.
 *
 * Newest per author and not simply "the first one": the repository keeps one event per
 * replaceable address, but a cold start can hand us an IndexedDB copy and a fresh one in
 * the same batch, and the older of the two would otherwise decide what is muted.
 */
export const ownMuteList = (events: MuteEventLike[], self: string): MuteEventLike | null => {
    if (!self) {
        return null
    }
    let newest: MuteEventLike | null = null
    for (const event of events) {
        if (event.kind !== MUTES || event.pubkey !== self) {
            continue
        }
        if (!newest || event.created_at > newest.created_at) {
            newest = event
        }
    }

    return newest
}

/** The muted pubkeys of one list, in list order, deduplicated. */
export const mutedPubkeysOf = (list: MuteEventLike | null): string[] => {
    const seen = new Set<string>()
    for (const tag of list?.tags ?? []) {
        if (isMutePersonTag(tag)) {
            seen.add(tag[1] as string)
        }
    }

    return [...seen]
}

/**
 * The full tag list after muting one person — **newest first**, every foreign tag kept.
 *
 * Prepending for the same reason `withBookmarkTag` does: the management list in settings
 * renders top down, and a list that grows at the bottom pushes the entry the user just
 * made out of sight. Tags that are not person mutes (`t`, `word`, `e`, `alt`, whatever
 * another client wrote) keep their relative order and are never dropped — this client
 * offers no surface for them, and silently deleting what it cannot display is the exact
 * failure mode the whole module is built against.
 */
export const withMutedPubkey = (tags: string[][], target: string): string[][] => [
    [MUTE_PERSON_TAG, target],
    ...tags.filter((tag) => !(isMutePersonTag(tag) && tag[1] === target)),
]

/** The full tag list after unmuting one person. Every other tag stays. */
export const withoutMutedPubkey = (tags: string[][], target: string): string[][] =>
    tags.filter((tag) => !(isMutePersonTag(tag) && tag[1] === target))

/** The body of the event a write would produce — nothing more than that. */
export type MuteWrite = { kind: number; content: string; tags: string[][] }

/** What {@link planMuteWrite} needs to answer. */
export type MutePlanInput = {
    /** Our own newest 10000 as the relay last showed it, or `null` for "there is none". */
    list: MuteEventLike | null
    /**
     * **Did the relay answer the read that produced `list`?** `false` also covers "not
     * asked yet" — the two are the same thing here, and both must refuse.
     */
    listAnswered: boolean
    /** The person to mute or unmute. */
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
 * Same construction as `planBookmarkWrite`, and for the same reason: a call to a gate
 * whose result is dropped looks exactly like one that is honoured, so gate and body are
 * made the same value. A caller that skips this has nothing to sign.
 *
 * The five refusals, each with what it prevents:
 *
 * | refusal | what happens without it |
 * |---|---|
 * | `!target` / `!self` | an empty `p` tag, or a guest write with no key |
 * | `target === self` | muting yourself — your own messages vanish from your own chat, and no surface can undo it because your row is gone with them |
 * | `!listAnswered` | **the replaceable-kind data loss**: we replace the relay's list with the one entry we know about, and every mute made on another device is deleted |
 * | `!mayWriteKind` | a write while the relay kind is still `'unknown'`, i.e. a guess about which relay we are talking to |
 * | `sameTags` | a signed event that changes nothing — a double click, or a second device that got there first |
 *
 * `content` is carried over unchanged: that is the entire handling of the NIP-51 private
 * half (module header). It is never decrypted and never re-encrypted, so nothing here can
 * lose it — and equally, nothing here can write into it. This client's mutes are public.
 */
export const planMuteWrite = (input: MutePlanInput): MuteWrite | null => {
    const { list, listAnswered, target, self, add, spaceKind } = input
    if (!target || !self || target === self) {
        return null
    }
    if (!listAnswered) {
        return null
    }
    if (!mayWriteKind(MUTES, spaceKind)) {
        return null
    }
    const current = list?.tags ?? []
    const tags = add ? withMutedPubkey(current, target) : withoutMutedPubkey(current, target)
    if (sameTags(current, tags)) {
        return null
    }

    return { kind: MUTES, content: list?.content ?? '', tags }
}

/**
 * The chat events a muted reader should see.
 *
 * **Own messages are never hidden.** {@link planMuteWrite} refuses to mute yourself, but
 * a list written by another client can carry your own pubkey, and honouring it would make
 * your own chat look broken with no way back — the row that carries the unmute action
 * would be gone with everything else.
 *
 * Returns the **same array reference** when nothing is muted. That is not cosmetic:
 * `deriveRoomChat` rebuilds the whole message list on every emit of any of its fourteen
 * sources, and a fresh array on the ordinary path would defeat nothing but cost an
 * allocation per emit on the hottest surface in the client.
 */
export const visibleChatEvents = <T extends { pubkey: string }>(
    events: T[],
    muted: ReadonlySet<string>,
    self: string,
): T[] => {
    if (muted.size === 0) {
        return events
    }

    return events.filter((event) => event.pubkey === self || !muted.has(event.pubkey))
}

/**
 * Did the relay really take the write?
 *
 * `OK true` does not say so, and kind 10000 sits in the same trap as 10003: zooid's
 * `ReplaceEvent` drops a replaceable event whose `created_at` is not greater than the
 * stored one and returns no error (`zooid/events.go:440-443`, written out in `js/pins.ts`
 * at `pinStateReached`). A clock that runs behind makes every mute a silent no-op while
 * the relay keeps saying yes.
 *
 * `null` means the relay answered nothing, and that is **not** a failure — the same
 * asymmetry `writeConfirmed` in `bookmarkModels.ts` spells out at length: a hanging AUTH
 * round swallows the `EOSE` of a request entirely, and turning "cannot tell" into a red
 * error would contradict a verdict we already have, most often for the people with the
 * worst connection. A *positive* answer that disagrees with us is trusted; an *absent*
 * one is not evidence.
 *
 * Note the direction this differs from {@link planMuteWrite}: there, silence must block
 * the write, because a write on an unknown list destroys foreign data. Here the write has
 * already happened and been acknowledged, and silence only means we cannot re-check it.
 */
export const muteWriteConfirmed = (
    relayTags: string[][] | null,
    target: string,
    shouldBeMuted: boolean,
): boolean => {
    if (relayTags === null) {
        return true
    }

    return relayTags.some((tag) => isMutePersonTag(tag) && tag[1] === target) === shouldBeMuted
}
