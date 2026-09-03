/**
 * NIP-51 bookmarks — the pure half (P2).
 *
 * Browser-free and store-free, exactly like `js/pins.ts`: every rule below is
 * decidable under `node --test` without a relay, without a signer and without mocks.
 * The network and store half lives in `js/bookmarks.ts`. Three imports, all of them
 * browser-free themselves: the kind adapter (`@welshman/util` only), the write gate
 * from `relayCapability.ts`, and one type.
 *
 * **The gate is imported here on purpose.** {@link planBookmarkWrite} asks it and
 * returns `null` when the answer is no, so the decision and the event body are the same
 * value — a caller that skips the gate has nothing to sign. Asked from the store
 * instead, the promise "gated before signing" would only be checkable by reading the
 * source; here it is a test.
 *
 * ── Why the tag algebra is written here instead of taken from `@welshman/domain` ──
 *
 * `@welshman/domain` ships `BookmarkListReader`/`BookmarkListWriter` for kind 10003,
 * and the plan named them. They are not used, for three reasons read off the installed
 * 0.9.5 sources — the first of which destroys user data:
 *
 *  1. **`ListWriter.renderContent()` can wipe the encrypted private half.**
 *     `ListReader.parse()` sets `decrypted = true` *before* it checks the plaintext
 *     (`core/ListReader.js`: `decrypted = true` then `if (Array.isArray(json))`), so a
 *     private payload that is not an array of string arrays leaves `privateTags`
 *     empty while `decrypted` is true. `renderContent()` then takes the
 *     `privateTags.length === 0` branch and returns `""` — the ciphertext is gone,
 *     signed away, on a list the user never asked us to touch. This module never
 *     decrypts and never re-encrypts: the write path copies `content` over byte for
 *     byte, so the private half cannot be lost by anything we do.
 *  2. **The reader is asynchronous** (`AsyncEventReader`), and our read path is a live
 *     store subscription. Awaiting inside it buys a stale-result race for a payload we
 *     do not display anyway.
 *  3. **The plan wants the merge/dedupe rules pure and tested.** With the domain
 *     writer they would sit in `node_modules` and no sibling test could reach them.
 *
 * The house's own `readList` from `js/welshmanList.ts` is likewise unusable here, and
 * for a sharper reason: its `isValidTag` demands `isRelayUrl(tag[1])` for an `r` tag,
 * because there `r` means a relay (kind 10009, the space list). In a bookmark list `r`
 * is a **web** address — `isRelayUrl` rejects every `https://…` (`@welshman/util`
 * `Relay.js`: `parsed.protocol.match(/^wss?:$/)`). Reading a bookmark list through it
 * and writing the result back would silently delete every link the user bookmarked in
 * another client.
 *
 * ── The 30003 collision with Buzz' mesh telemetry ─────────────────────────────────
 *
 * Kind 30003 is NIP-51 `NAMED_BOOKMARKS` **and** the carrier of Buzz Desktop's mesh
 * member status (`buzz-db/src/lib.rs:5210-5216`). Those events are signed with the
 * member's **own identity key** (`desktop/src-tauri/src/mesh_llm/coordinator.rs:458-475`
 * builds them, `app_state.rs:306` `signing_keys()` hands over the user's keys), so
 * `authors:[self]` does **not** separate them: a user who runs Buzz Desktop with the
 * mesh feature publishes them under the same pubkey that owns their bookmarks. The
 * separation has to happen on the event's shape — {@link isBuzzMeshStatus} below.
 */
import { BOOKMARKS, NAMED_BOOKMARKS } from './welshmanKinds.ts'
import { mayWriteKind } from './relayCapability.ts'
import type { SpaceKind } from './spaceCaps.ts'

export { BOOKMARKS, NAMED_BOOKMARKS }

/** As much of an event as anything here touches — deliberately not a welshman type. */
export type BookmarkEventLike = {
    id: string
    kind: number
    pubkey: string
    created_at: number
    tags: string[][]
    content: string
}

/**
 * `d` prefix of Buzz' mesh member status (`STATUS_D_TAG_PREFIX` plus its separator,
 * `desktop/src-tauri/src/mesh_llm/coordinator.rs:21,467`).
 */
export const MESH_STATUS_D_PREFIX = 'buzz-mesh-member-status:'

/** The `["k", …]` marker the same events carry (`coordinator.rs:469`). */
export const MESH_STATUS_MARKER = 'buzz-mesh-status'

/** Tag names NIP-51 gives a bookmark list: event, address, topic, url. */
export const BOOKMARK_TAG_NAMES: readonly string[] = ['e', 'a', 't', 'r']

const tagValue = (name: string, tags: string[][]): string =>
    tags.find((tag) => tag[0] === name && typeof tag[1] === 'string')?.[1] ?? ''

/** Is this tag one of the four bookmark carriers, with a usable value? */
export const isBookmarkTag = (tag: string[]): boolean =>
    BOOKMARK_TAG_NAMES.includes(tag[0] ?? '') && typeof tag[1] === 'string' && tag[1] !== ''

/**
 * Is this 30003 Buzz' mesh member status rather than a bookmark set?
 *
 * **The relay demands both signals, we accept either — on purpose.** Buzz' replacement
 * rule fires only when the `d` prefix *and* the `["k","buzz-mesh-status"]` marker are
 * present (`lib.rs:5210-5216`, an `&&`), because it is deciding whether to hard-delete
 * a superseded row and a false positive there would destroy a real set. We are deciding
 * what to *display*, where the error costs are reversed: showing mesh telemetry as
 * somebody's bookmarks is a visible defect, dropping a hypothetical set that a user
 * named `buzz-mesh-member-status:…` is not. So this reads as `||` and stays fail-closed.
 */
export const isBuzzMeshStatus = (event: BookmarkEventLike): boolean => {
    if (event.kind !== NAMED_BOOKMARKS) {
        return false
    }
    if (tagValue('d', event.tags).startsWith(MESH_STATUS_D_PREFIX)) {
        return true
    }

    return event.tags.some((tag) => tag[0] === 'k' && tag[1] === MESH_STATUS_MARKER)
}

/** One bookmarked thing, with the list it came from. */
export type BookmarkRef = {
    /** `e` message · `a` addressable event · `t` topic · `r` url. */
    type: string
    value: string
    /** `d` of the 30003 set it came from; `''` for the plain 10003 list. */
    set: string
}

/**
 * The key a replaceable list is addressed by. 10003 is keyed by kind alone, 30003 by
 * kind plus `d` — the repository already keeps only the newest per key, but a cold
 * start can hand us both an IndexedDB copy and a fresh one, so the fold repeats it.
 */
const listKey = (event: BookmarkEventLike): string =>
    event.kind === BOOKMARKS ? String(BOOKMARKS) : `${NAMED_BOOKMARKS}:${tagValue('d', event.tags)}`

/**
 * Which of the given events are this user's bookmark lists — newest per address,
 * mesh telemetry removed, the plain list first and the named sets behind it in a
 * stable order.
 *
 * A 30003 without a `d` is dropped: NIP-01 addresses it as `30003:<pubkey>:`, so every
 * such event would overwrite every other one, and it has no name to show either.
 */
export const ownBookmarkLists = (events: BookmarkEventLike[], self: string): BookmarkEventLike[] => {
    if (!self) {
        return []
    }
    const newest = new Map<string, BookmarkEventLike>()
    for (const event of events) {
        if (event.pubkey !== self) {
            continue
        }
        if (event.kind !== BOOKMARKS && event.kind !== NAMED_BOOKMARKS) {
            continue
        }
        if (isBuzzMeshStatus(event)) {
            continue
        }
        if (event.kind === NAMED_BOOKMARKS && tagValue('d', event.tags) === '') {
            continue
        }
        const key = listKey(event)
        const previous = newest.get(key)
        if (previous && previous.created_at >= event.created_at) {
            continue
        }
        newest.set(key, event)
    }

    return Array.from(newest.values()).sort((a, b) => {
        if (a.kind !== b.kind) {
            return a.kind === BOOKMARKS ? -1 : 1
        }

        return tagValue('d', a.tags).localeCompare(tagValue('d', b.tags))
    })
}

/** This user's plain 10003, or `null` — the one list this client writes. */
export const ownBookmarkList = (events: BookmarkEventLike[], self: string): BookmarkEventLike | null =>
    ownBookmarkLists(events, self).find((event) => event.kind === BOOKMARKS) ?? null

/**
 * Every bookmarked thing across the user's lists, deduplicated by value.
 *
 * The plain 10003 comes first, so an entry that is both loose and filed in a set keeps
 * the loose one — which is the one {@link withoutBookmarkValue} can remove, since this
 * client writes no sets.
 */
export const bookmarkRefs = (events: BookmarkEventLike[], self: string): BookmarkRef[] => {
    const seen = new Set<string>()
    const refs: BookmarkRef[] = []
    for (const list of ownBookmarkLists(events, self)) {
        const set = list.kind === BOOKMARKS ? '' : tagValue('d', list.tags)
        for (const tag of list.tags) {
            if (!isBookmarkTag(tag)) {
                continue
            }
            const key = `${tag[0]}:${tag[1]}`
            if (seen.has(key)) {
                continue
            }
            seen.add(key)
            refs.push({ type: tag[0] as string, value: tag[1] as string, set })
        }
    }

    return refs
}

/** Just the bookmarked event ids (`e`), in display order. */
export const bookmarkedEventIds = (refs: BookmarkRef[]): string[] =>
    refs.filter((ref) => ref.type === 'e').map((ref) => ref.value)

/** Everything that is not a message — addresses, topics, urls. */
export const otherBookmarkRefs = (refs: BookmarkRef[]): BookmarkRef[] =>
    refs.filter((ref) => ref.type !== 'e')

/**
 * The full tag list after adding one bookmark — **newest first**.
 *
 * Prepending and not appending: this list is what the screen renders top down, and a
 * list that grows at the bottom pushes the entry the user just made out of sight. Tags
 * that are not bookmarks (`alt`, `title`, whatever another client wrote) keep their
 * relative order and are never dropped.
 *
 * The duplicate check is by VALUE and not by value plus type: the same string cannot
 * meaningfully be both an event id and a topic, and a list carrying it twice would
 * offer two rows that remove each other.
 */
export const withBookmarkTag = (tags: string[][], tag: string[]): string[][] => [
    tag,
    ...tags.filter((existing) => !(isBookmarkTag(existing) && existing[1] === tag[1])),
]

/** The full tag list after removing every bookmark with this value. */
export const withoutBookmarkValue = (tags: string[][], value: string): string[][] =>
    tags.filter((tag) => !(isBookmarkTag(tag) && tag[1] === value))

/** The body of the event a write would produce — nothing more than that. */
export type BookmarkWrite = { kind: number; content: string; tags: string[][] }

/**
 * **The gate and the event body in one decision.** `null` means: do not write.
 *
 * The phase's central promise is that `mayWriteKind` is asked *before* signing, not
 * after publishing. Asserting that from the outside is hard — a call to the gate whose
 * result is dropped looks exactly like one that is honoured. Here the two cannot come
 * apart: the gate's answer decides whether an event body exists at all, so a caller that
 * publishes without it has nothing to publish. That also makes the promise testable
 * without a browser, which an AST scan over the write path cannot be.
 *
 * What the gate actually decides for kind 10003 is the third state. Its table says
 * `relay: 'any'` — both relay families store a NIP-51 list and every client can read it
 * — but `'unknown'` denies, and `'unknown'` is what `deriveSpaceKind` reports while the
 * NIP-11 document is still in flight. So the surface stays inert for the first moments
 * instead of guessing which relay it is talking to.
 *
 * `content` is carried over from the existing list **unchanged**: that is the entire
 * handling of the NIP-51 private half. It is never decrypted and never re-encrypted, so
 * nothing here can lose it.
 */
export const planBookmarkWrite = (
    list: BookmarkEventLike | null,
    value: string,
    add: boolean,
    spaceKind: SpaceKind,
): BookmarkWrite | null => {
    if (!value || !mayWriteKind(BOOKMARKS, spaceKind)) {
        return null
    }
    const current = list?.tags ?? []

    return {
        kind: BOOKMARKS,
        content: list?.content ?? '',
        tags: add ? withBookmarkTag(current, ['e', value]) : withoutBookmarkValue(current, value),
    }
}

/** Is this value bookmarked in the given refs? */
export const isBookmarked = (refs: BookmarkRef[], value: string): boolean =>
    refs.some((ref) => ref.value === value)

/**
 * Did the relay really take the write?
 *
 * `OK true` does not say so. zooid's `ReplaceEvent` drops a replaceable event whose
 * `created_at` is not greater than the stored one and returns `deleted, nil` — no
 * error reaches the client (`zooid/events.go:440-443`, written out in `js/pins.ts` at `pinStateReached`). Kind 10003 is replaceable, so it sits in exactly that trap:
 * a clock that runs behind makes every bookmark a no-op while the relay keeps saying
 * yes. The store therefore re-reads the list from the relay and asks this question of
 * what came back.
 *
 * `null` means the relay answered nothing — which is not a failure: an AUTH round that
 * ends in `CLOSED` returns an empty batch just as an unstored event would
 * (`@welshman/net`), and we will not turn "cannot tell" into a red error over a write
 * the relay acknowledged.
 */
export const writeConfirmed = (
    relayTags: string[][] | null,
    value: string,
    shouldBeBookmarked: boolean,
): boolean => {
    if (relayTags === null) {
        return true
    }

    return relayTags.some((tag) => isBookmarkTag(tag) && tag[1] === value) === shouldBeBookmarked
}
