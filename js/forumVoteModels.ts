/**
 * Voting on a forum post (kind 45002) — the pure half.
 *
 * Counterpart to `forumVote.ts` (signer, relay, store). Browser-free and store-free
 * like `forumWriteModels.ts` and `bookmarkModels.ts`, so every rule below is decidable
 * under `node --test`. Relative imports carry the `.ts` extension: the file has to load
 * from Vite **and** from the node test runner.
 *
 * ══ The event shape, read off the producer ══════════════════════════════════════
 *
 * ```rust
 * // crates/buzz-sdk/src/builders.rs:456-470
 * /// Build a forum vote event (kind 45002). Content is `"+"` or `"-"`.
 * pub fn build_vote(channel_id: Uuid, target_event_id: nostr::EventId,
 *                   direction: VoteDirection) -> Result<EventBuilder, SdkError> {
 *     let content = match direction { VoteDirection::Up => "+", VoteDirection::Down => "-" };
 *     let tags = vec![tag(&["h", &channel_id.to_string()])?,
 *                     tag(&["e", &target_event_id.to_hex()])?];
 *     Ok(EventBuilder::new(Kind::Custom(45002), content).tags(tags))
 * }
 * ```
 *
 *   kind    45002
 *   tags    `["h", <channel-uuid>]`  — mandatory, `ingest.rs:625`
 *           `["e", <64 lowercase hex>]` — the target
 *   content `"+"` or `"-"`
 *
 * ── What the relay checks, and one detail that decides the tag order ─────────────
 *
 * `validate_forum_vote_target` (`ingest.rs:1001-1046`) demands an `e` tag whose value
 * is 64 hex characters, that the target event **exists**, that it is a 45001 or 45003,
 * and that target and vote live in the **same channel**. It does **not** look at
 * `content` — that part is convention only (see `VOTE_UP` in `forumModels.ts`).
 *
 * The detail: for 45002 the relay takes the **first** matching `e` tag
 * (`find_map` without `.rev()`), whereas for NIP-25 reactions it takes the **last**,
 * because NIP-25 says so (`ingest.rs:2796-2800`). Two kinds, two ends of the same list.
 * {@link buildVoteTags} therefore emits **exactly one** `e` tag, so first and last are
 * the same tag and the question cannot be asked. That is also why this builder exists
 * rather than a caller assembling tags: a second `e` tag added later — a quote, a
 * thread marker — would silently move the target on one relay and not on the other.
 */
import { FORUM_VOTE, VOTE_DOWN, VOTE_UP, type VoteChoice } from './forumModels.ts'
import { DELETE } from './welshmanKinds.ts'
import { mayWriteKind } from './relayCapability.ts'
import type { SpaceKind } from './spaceCaps.ts'

/** A vote a user can cast. `0` is not one — see the retraction note below. */
export type VoteDirection = 1 | -1

/**
 * The body (or bodies) a click would produce — nothing more than that.
 *
 * `cast` is one 45002. `retract` is **one kind 5 per still-standing own vote**: Buzz
 * takes exactly one target per tombstone (`ingest.rs:2477-2489`), and taking back only
 * the newest would resurrect the one before it (the reasoning is written out at
 * `ForumVoteTally.mineIds`). The `action` field exists so a caller cannot confuse the
 * two by looking at `kind` alone.
 */
export type ForumVoteWrite =
    | { action: 'cast'; events: readonly ForumEventBody[] }
    | { action: 'retract'; events: readonly ForumEventBody[] }

/** One event to sign and publish. */
export type ForumEventBody = { kind: number; content: string; tags: string[][] }

/** 64 lowercase hex, the form `validate_forum_vote_target` accepts. */
const isEventId = (value: string): boolean => /^[0-9a-f]{64}$/.test(value)

/**
 * The tags of a 45002 — **`h` first, then exactly one `e`**, in the order
 * `build_vote` writes them.
 *
 * Exactly one `e` is the load-bearing part (see the module header); the order is the
 * cheap part, kept so the event is byte-shaped like the reference implementation's and
 * nobody has to ask later whether a difference was deliberate.
 */
export const buildVoteTags = (h: string, targetId: string): string[][] => [
    ['h', h],
    ['e', targetId],
]

/**
 * The tags of a retraction — `["k","45002"]`, exactly one `["e", <voteId>]`, and the
 * channel.
 *
 * The shape is the house's, taken from `deleteRoomMessage` (`js/feeds.ts`), which is the
 * one existing kind 5 built from an id plus an `h` rather than from a parent event:
 * `[['k', String(kind)], ['e', id], ...roomTags(h, url)]`. Two deliberate differences:
 *
 *  - **No `["-"]` (NIP-70).** `roomTags` adds it when the relay advertises NIP-70. Buzz's
 *    own builders add it to neither the vote (`build_vote`) nor the deletion
 *    (`build_delete_compat`, `builders.rs:452-464`), and a tombstone that is protected
 *    while the vote it removes is not would be a mismatch invented here. Vote and
 *    retraction carry the same tags as the reference implementation's.
 *  - **No relay hint / author in the `e` tag.** `tagEvent` (`js/welshmanApp.ts:153`)
 *    writes `['e', id, hint, mark, pubkey]`, but the hint comes from live relay state and
 *    this module is pure. NIP-09 needs the id; `Repository.isDeletedById` reads the id;
 *    Buzz reads the id. The extra positions are advisory.
 */
export const buildRetractionTags = (h: string, voteId: string): string[][] => [
    ['k', String(FORUM_VOTE)],
    ['e', voteId],
    ['h', h],
]

/**
 * **The gate and the event bodies in one decision.** `null` means: do not write.
 *
 * The same construction as `planBookmarkWrite` (`bookmarkModels.ts`) and for the same
 * reason: the phase's promise is that `mayWriteKind` is asked *before* signing, and a
 * gate call whose result is dropped looks exactly like one that is honoured. Here the
 * gate's answer decides whether an event body exists at all, so a caller that publishes
 * without it has nothing to publish — and the promise is a unit test instead of a
 * reading of the source.
 *
 * For 45002 the gate answers `relay: 'buzz'`: zooid has no kind allowlist and would
 * **store** a forum vote forever, as garbage nothing reads (`relayCapability.ts` writes
 * that out in full). `'unknown'` — the state while the NIP-11 doc is in flight — denies
 * as well, so the buttons stay inert for the first moments instead of guessing.
 *
 * ── The gate is asked about 45002 even for the kind-5 branch, on purpose ───────────
 *
 * `mayWriteKind(5, …)` would answer **false** everywhere: kind 5 is deliberately absent
 * from `WRITE_RULES`, and `relayCapability.ts` says so in as many words — "this is not a
 * general write gate for the whole client. Kind 9, 7, 5, 9000… are not in the table and
 * are denied by it." Asking it here would not make the retraction safer, it would make it
 * impossible. Adding 5 to the table is worse still: the table would then have to answer
 * for every other kind 5 this client writes (`interactions.ts` deletes messages and
 * reactions on **both** relay families), and this phase would have silently turned a
 * purpose-built table into a general one.
 *
 * So the question asked is the one that actually decides: *may a 45002 exist on this
 * relay at all?* If not, no vote of ours can be there and there is nothing to take back.
 * That is also the conservative direction — the gate can only ever refuse a retraction
 * for a vote that could not have been cast.
 *
 * ── A write that changes nothing is refused ────────────────────────────────────────
 *
 * Two cases, both `null`:
 *
 *  - **Casting the direction that already stands** is not a duplicate here — it is the
 *    retraction (see below). What is refused is the *retraction of a vote that was never
 *    cast*: `current === 0` leaves nothing to take back, and `mineIds` empty says the
 *    same thing in the currency the write path uses.
 *  - **A cast whose target is not a 64-hex id**, or a click without a channel. The relay
 *    would refuse it (`validate_forum_vote_target`), and asking the user's signing device
 *    for a signature nobody can use is a prompt spent on nothing.
 *
 * The relay has no dedup for 45002 — that is the whole reason `foldForumVotes` exists —
 * so anything written here is a row on the relay forever, not a no-op.
 *
 * ── Taking a vote back: it works, and here is why the first answer was wrong ───────
 *
 * P3 first shipped **without** a retraction, on the grounds that welshman applies a
 * tombstone only at strictly greater `created_at` and a retraction clicked in the same
 * second would therefore be stranded. **That is false for this kind, and the correct
 * fact matters more than the wrong conclusion did:**
 *
 *  - `Repository.isDeletedByAddress` compares `created_at`
 *    (`@welshman/net/dist/net/src/repository.js:202`) — but it only ever applies to
 *    **addressable** events, i.e. an `["a", …]` tombstone.
 *  - A 45002 is not addressable: no `d` tag, and 45002 lies in neither the 10000–19999
 *    nor the 30000–39999 range. Its deletion is by id, and `isDeletedById` (`:199`)
 *    carries **no** `created_at` comparison at all. The implementation says why, and it
 *    is verbatim this case: *"comparing would strand anything taken back in the same
 *    second it was made."*
 *  - The same fact was already measured and written down in this repository, at
 *    `makeEventDelete` (`js/interactions.ts:70-97`), including the three-row measurement
 *    for a kind 7 deleted one second later, in the same second, and one second earlier —
 *    `isDeleted true` in all three.
 *
 * Relay-side the path is clear too: Buzz deletes kind-agnostically after an authorship
 * check, measured on a fresh stack on 2026-08-24; only the "exactly one target per
 * tombstone" limit applies, which is why {@link planForumVote} emits one event per id.
 *
 * ── What a retraction still cannot do ─────────────────────────────────────────────
 *
 * Flipping `+` → `-` leaves the `+` standing on the relay; only the fold hides it. That
 * is inherent to a relay without dedup and is not what a retraction is for. A user who
 * wants nothing counted clicks the arrow that is pressed, and *that* takes back every
 * own vote on the target.
 */
export const planForumVote = (
    current: VoteChoice,
    currentIds: readonly string[],
    direction: VoteDirection,
    h: string,
    targetId: string,
    spaceKind: SpaceKind,
): ForumVoteWrite | null => {
    if (!h || !mayWriteKind(FORUM_VOTE, spaceKind)) {
        return null
    }

    if (current === direction) {
        // The arrow that is already pressed: take the vote back. Every still-standing
        // own vote on this target gets its own tombstone — one target per kind 5.
        const events = currentIds
            .filter((id) => isEventId(id))
            .map((id) => ({ kind: DELETE, content: '', tags: buildRetractionTags(h, id) }))

        return events.length > 0 ? { action: 'retract', events } : null
    }

    if (!isEventId(targetId)) {
        return null
    }

    return {
        action: 'cast',
        events: [
            {
                kind: FORUM_VOTE,
                content: direction === 1 ? VOTE_UP : VOTE_DOWN,
                tags: buildVoteTags(h, targetId),
            },
        ],
    }
}
