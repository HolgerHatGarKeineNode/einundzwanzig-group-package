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
import { mayWriteKind } from './relayCapability.ts'
import type { SpaceKind } from './spaceCaps.ts'

/** A vote a user can cast. `0` is not one — see the retraction note below. */
export type VoteDirection = 1 | -1

/** The body of the event a vote would produce — nothing more than that. */
export type ForumVoteWrite = { kind: number; content: string; tags: string[][] }

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
 * **The gate and the event body in one decision.** `null` means: do not write.
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
 * ── A write that changes nothing is refused ────────────────────────────────────────
 *
 * `current === direction` returns `null`. That is the phase's requirement that a second
 * click must not raise the visible counter, enforced at the only place that can enforce
 * it: the markup can be stale, and `foldForumVotes` would fold the duplicate away
 * anyway — but only *after* an event was signed, published and stored on the relay
 * forever. The relay has no dedup for 45002 (that is the whole reason the fold exists),
 * so a duplicate is not a no-op there, it is a row.
 *
 * ── Why there is no way back to "no vote", and why that is a decision ──────────────
 *
 * Both conceivable retractions were rejected, deliberately and not by omission:
 *
 *  - **A third `content` value.** The relay validates `content` not at all, so such an
 *    event is accepted and delivered — and every other client decides for itself what
 *    it means. Buzz Desktop's builder only knows `"+"` and `"-"`. We would be writing a
 *    private dialect into a shared channel, and {@link foldForumVotes} would have to
 *    treat an unreadable direction as a retraction, which is exactly the "do not guess"
 *    rule it is built on.
 *  - **A kind 5 tombstone.** It would work on the relay — Buzz's deletion path is
 *    kind-agnostic and author-checked (measured 2026-08-24 on a fresh stack). It does
 *    not work in *this* client: welshman's repository applies a tombstone only at
 *    **strictly greater** `created_at`, and a retraction clicked seconds after the vote
 *    carries the same second. The vote would stay on screen until a reload, i.e. the
 *    one case that matters — the misclick — is the one case that visibly fails.
 *
 * So a vote is changed by another vote and by nothing else. Up ↔ down works, up → none
 * does not, and the surface must not offer a control that suggests otherwise.
 */
export const planForumVote = (
    current: VoteChoice,
    direction: VoteDirection,
    h: string,
    targetId: string,
    spaceKind: SpaceKind,
): ForumVoteWrite | null => {
    if (!h || !isEventId(targetId)) {
        return null
    }
    if (current === direction) {
        return null
    }
    if (!mayWriteKind(FORUM_VOTE, spaceKind)) {
        return null
    }

    return {
        kind: FORUM_VOTE,
        content: direction === 1 ? VOTE_UP : VOTE_DOWN,
        tags: buildVoteTags(h, targetId),
    }
}
