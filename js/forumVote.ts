/**
 * Casting a forum vote (kind 45002) — the part that needs a signer, the repository
 * and a relay.
 *
 * Counterpart to `forumVoteModels.ts` (pure, `node --test`-able). The event shape, the
 * gate and the refusal rules live there; what is left here is the way onto the wire.
 *
 * ── The key stays in the browser ────────────────────────────────────────────────
 *
 * Signing happens exclusively through welshman's active signer (NIP-07/NIP-46/NIP-55):
 * `publishOptimistic` builds a thunk, which fetches `signer` itself and calls
 * `signer.sign()`. There is no crypto, no secret and no server call in this file.
 *
 * ── Three kinds of click, one path ──────────────────────────────────────────────
 *
 * Cast (`0 → ±1`), flip (`+1 ↔ -1`) and **take back** (`±1 → 0`, a click on the arrow
 * that is already pressed). The first two write one 45002; the third writes one NIP-09
 * tombstone per still-standing own vote. Which of the three a click is, and whether it
 * may happen at all, is decided in `forumVoteModels.ts` — this file only carries the
 * result to the relay.
 *
 * ── Why `publishOptimistic` and not a hand-written thunk ────────────────────────
 *
 * A vote needs both halves of that helper, and both for a measurable reason:
 *
 *  - **Optimistic.** The thunk puts the event into the repository synchronously and
 *    records the target url in the tracker. `deriveForumTopics` reads its rows from
 *    exactly that repository through a filter that now includes 45002, so the score
 *    moves on the click, without a round trip and without a second source of truth
 *    next to it.
 *  - **Rollback.** On a relay reject `publishOptimistic` removes the event again
 *    (welshman does that only on an abort, not on a reject). Without it a score would
 *    stay one point higher than the relay's until the next cold start — and the user
 *    would have no way to tell, because a vote has no visible "pending" state the way
 *    a new topic does.
 *
 * ── One flight per target ───────────────────────────────────────────────────────
 *
 * {@link isForumVoteBusy} locks `(relay, target)` while a vote is in the air. The lock
 * sits here and not on the button: the same action is reachable by keyboard, and a
 * double click during the round trip would otherwise produce a second event that the
 * relay stores (it has no dedup for 45002) and that the fold then has to throw away.
 * A module-level `Set` and not a field on the island, for the reason `forumWrite.ts`
 * states: the island is rebuilt on a room change, an in-flight publish is not.
 */
import { makeEvent } from '@welshman/util'
import { t } from './i18n.ts'
import { publishOptimistic } from './publishOptimistic.ts'
import { type VoteChoice } from './forumModels.ts'
import { planForumVote, type VoteDirection } from './forumVoteModels.ts'
import type { SpaceKind } from './spaceCaps.ts'

const inFlight = new Set<string>()

const lockKey = (url: string, targetId: string): string => `vote:${url}:${targetId}`

/** Is a vote on this target already on its way? */
export const isForumVoteBusy = (url: string, targetId: string): boolean =>
    inFlight.has(lockKey(url, targetId))

/**
 * Cast, flip or take back one vote. Returns `''` on success **and** when nothing was
 * written, otherwise the translated relay wording.
 *
 * "Nothing was written" and "success" share a return value on purpose: the cases the
 * planner refuses — a relay this kind may not be written to, a retraction of a vote that
 * was never cast — are not errors the user made, and a message for them would be noise
 * on a control whose whole feedback is the number next to it.
 *
 * ── A retraction is several events, and the first failure stops it ────────────────
 *
 * `retract` yields one kind 5 per still-standing own vote (Buzz takes exactly one target
 * per tombstone). They go out **in order, newest first**, and the first rejection ends
 * the run: continuing would delete an older vote while the newer one survives, which is
 * the one outcome worse than doing nothing — the older vote would then become the
 * winner, and the click that meant "take it back" would have *changed the user's vote*.
 * Stopping leaves the newest standing, i.e. the state before the click.
 *
 * ── The known limit of the rollback, stated because it is not fixed here ──────────
 *
 * `publishOptimistic` undoes a rejected write with `repository.removeEvent`. For a kind 5
 * that is incomplete: `removeEvent` deletes the tombstone from the indexes but does
 * **not** undo the `deletes` record it created for its target
 * (`@welshman/net/dist/net/src/repository.js:81-108`; `_restore` only runs for an
 * address-replaceable event it superseded). So a *rejected* retraction still hides the
 * vote locally until the next cold start. The direction of that error is the harmless
 * one — the surface shows fewer points than the relay holds, never more — and the user
 * is told, because the caller raises the relay's wording as a toast.
 *
 * This is a property of `publishOptimistic`, not of this file: the article surface's
 * reaction un-toggle (`js/longformFeed.ts:1045`) sits on exactly the same edge. Fixing it
 * belongs there, where all its callers would get it, and not in one phase's vote path.
 */
export const voteOnForumTopic = async (
    url: string,
    h: string,
    targetId: string,
    current: VoteChoice,
    currentIds: readonly string[],
    direction: VoteDirection,
    spaceKind: SpaceKind,
): Promise<string> => {
    if (!url) {
        return ''
    }
    const key = lockKey(url, targetId)
    if (inFlight.has(key)) {
        return ''
    }
    // THE GATE, and it comes back as the event bodies or as `null`. Nothing below this
    // line can produce an event that the gate did not agree to.
    const plan = planForumVote(current, currentIds, direction, h, targetId, spaceKind)
    if (!plan) {
        return ''
    }
    inFlight.add(key)
    try {
        for (const body of plan.events) {
            const error = await publishOptimistic(
                url,
                makeEvent(body.kind, { content: body.content, tags: body.tags }),
            )
            if (error) {
                return error
            }
        }

        return ''
    } catch {
        // `new Thunk` throws without pubkey/signer — the session can expire between the
        // render of the button and the click on it. Caught rather than left to bubble:
        // an uncaught throw inside a click handler kills the island, and the user would
        // see a dead surface instead of the one sentence that explains it. The wording
        // is the house's existing one, not a second phrasing of the same fact.
        return t('Zum Schreiben bitte anmelden.')
    } finally {
        inFlight.delete(key)
    }
}
