/**
 * May the client write this event kind on the space it is currently looking at?
 *
 * Pure logic, browser-free, no store and no `@welshman/app` — the same purity that
 * `js/welshmanKinds.ts:18-26` states for the kind adapter and that `js/forumModels.ts`
 * and `js/pins.ts` keep, so the whole gate is decidable under `node --test` without a
 * relay, without a signer and without mocks. The one import from `js/relayCaps.ts` is
 * itself welshman-free.
 *
 * ── Why this gate exists at all: zooid has no kind allowlist ─────────────────────
 *
 * A Buzz-specific kind written into a zooid space is not ignored — it is **accepted,
 * stored and fanned out**, and nobody collects it again. Three places, all read at
 * `d985857`:
 *
 *   - `zooid/instance.go` ends `OnEvent` with `return false, ""` — accept. There is no
 *     allowlist of known kinds anywhere above it, only deny lists.
 *   - `zooid/groups.go` `IsGroupEvent` is true for **any** kind that carries an `h`
 *     tag (`return GetGroupIDFromEvent(event) != ""`).
 *   - `zooid/groups.go` `CheckWrite` falls through with `return ""` for a member of an
 *     open or joined group.
 *
 * So a 45002 forum vote or a 41010 DM command in a zooid room is permanent garbage
 * with no semantics: no client reads it, no relay validates it, and no deletion path
 * is planned for it. Buzz is the opposite case and needs no protection from us — its
 * ingest ends on a closed allowlist (`_ => Err("restricted: unknown event kind")`),
 * so a wrong kind there is a rejection, not a stain.
 *
 * That asymmetry is the whole design: **the gate protects the relay that cannot
 * protect itself.**
 *
 * ── Fail-closed, twice ───────────────────────────────────────────────────────────
 *
 * 1. **`'unknown'` denies.** `deriveSpaceKind` (`js/spaceCaps.ts:280`) is three-valued
 *    precisely because a two-valued type has no room for "not known yet"; `'unknown'`
 *    means the NIP-11 doc is still in flight, and a surface that decides in that state
 *    decides without grounds (the reasoning is written out in `js/userStatus.ts:12-18`).
 *    Denying costs nothing here: the store resolves within ~20 s at the latest — after
 *    the backoff ladder is spent it publishes `'other'` and never stays `'unknown'`
 *    (`js/spaceCaps.ts:250-262`). A write that has to wait one tick is cheap; an
 *    irreversible write on the wrong relay is not.
 *
 * 2. **An unregistered kind denies.** The table below is the complete list of kinds
 *    this gate governs, and a kind that is not in it is a kind whose relay requirement
 *    nobody has decided yet. Denying makes that omission loud at the first attempt
 *    instead of letting it through silently — which is the exact failure mode the gate
 *    was built against.
 *
 *    The flip side, stated so nobody has to discover it: this is **not** a general
 *    write gate for the whole client. Kind 9, 7, 5, 9000… are not in the table and are
 *    denied by it. It answers only for the kinds this plan introduces, and it is called
 *    from those write paths — never from a shared publish helper.
 *
 * ── Called before signing, not after publishing ──────────────────────────────────
 *
 * The point of the gate is that the event never exists. Once it is signed and sent,
 * the answer comes from the relay, and on zooid that answer is `OK true`.
 */
import { hasRelayExtension } from './relayCaps.ts'
import type { SpaceKind } from './spaceCaps.ts'

/**
 * NIP-11 `supported_extensions` identifier for event reminders (kind 30300). Buzz
 * advertises it unconditionally (`buzz-relay/src/nip11.rs:165`); measured against
 * production on 2026-09-03 the answer was `["nip-er","nip-pl"]`.
 */
export const NIP_ER_EXTENSION = 'nip-er'

/**
 * What a kind needs from the relay it is written to.
 *
 * `'any'` — a protocol-wide kind that means the same thing everywhere. `'buzz'` — a
 * kind of Buzz's own dialect, which only Buzz validates and reads. `extension` adds a
 * second condition on top of `'buzz'`: the relay must advertise the draft in its
 * NIP-11 doc, because the kind belongs to an extension that a Buzz build can be
 * compiled or configured without.
 *
 * **`'other'` is the third value, and it points the other way** (P7, 2026-09-05). Until
 * then the table only ever protected zooid from Buzz's dialect, because Buzz protects
 * itself with a closed allowlist. Kind 10050 is the first entry where that allowlist is
 * the problem: it is an ordinary NIP-17 kind, `buzz-core/src/kind.rs` has no constant
 * for it, and `required_scope_for_kind` therefore ends on
 * `_ => Err("restricted: unknown event kind")`. `'other'` means "everywhere except a
 * Buzz space" — the write is refused before signing instead of being sent and bounced.
 */
type WriteRule = { readonly relay: 'any' | 'buzz' | 'other'; readonly extension?: string }

/**
 * The governed kinds. Numeric literals on purpose: this is a policy table, not the
 * place where a kind gets its name. Each phase keeps its own named constant in its own
 * module (`FORUM_VOTE` in `forumModels.ts`, the NIP-51 kinds under their welshman names
 * `PINS`/`BOOKMARKS`/`NAMED_BOOKMARKS`) and passes it in here.
 */
const WRITE_RULES: ReadonlyMap<number, WriteRule> = new Map<number, WriteRule>([
    // ── NIP-51 lists — global, author-owned, no relay dialect ────────────────────
    // These are ordinary protocol events: `PINS`, `BOOKMARKS` and `NAMED_BOOKMARKS` in
    // `@welshman/util`, and `KIND_PIN_LIST` / `KIND_BOOKMARK_LIST` / `KIND_BOOKMARK_SET`
    // in `buzz-core/src/kind.rs:22,32,43`, all three inside Buzz's ingest allowlist.
    // Writing them on a zooid space produces a valid, readable, replaceable list — not
    // garbage. So the gate lets them through on either relay.
    [10001, { relay: 'any' }],
    [10003, { relay: 'any' }],
    [30003, { relay: 'any' }],
    // `MUTES` (P6). Same shape, and Buzz names it in the very same match arm as the two
    // above: `KIND_MUTE_LIST` (`buzz-core/src/kind.rs:17`) maps to `Scope::UsersWrite` in
    // `buzz-relay/src/handlers/ingest.rs:365-377`, under the comment "NIP-51 standard
    // lists and NIP-65 relay list — user-owned global state". zooid has no kind allowlist
    // and stores it like any other event. Read at the sources on 2026-09-05.
    [10000, { relay: 'any' }],

    // ── NIP-17 / NIP-59 private messages (P7) ────────────────────────────────────
    // `WRAP` (kind 1059). Both relays take it, and both were asked rather than read:
    // Buzz names `KIND_GIFT_WRAP` in its ingest allowlist (`ingest.rs:380`) and even
    // waives the pubkey/auth match for it (`ingest.rs:2023-2028`), because a wrap is
    // signed by a throwaway key and not by the member sending it; zooid authorises the
    // RECIPIENT instead of the author (`instance.go:192-197 AllowRecipientEvent`).
    // Measured on 2026-09-05, each result confirmed by a requery
    // (`p7-messung-a-wrap-drift.txt`): accepted and findable on both.
    [1059, { relay: 'any' }],
    // `MESSAGING_RELAYS` (kind 10050) — **not** `'any'`, and the difference is measured.
    // Buzz has no constant for this kind at all, so it ends on the closing arm of
    // `required_scope_for_kind` and answers `restricted: unknown event kind`; zooid
    // stores it like any other event. Positive control in the same run: kind 10000 is
    // accepted by both, so the refusal is about this kind and not about the connection
    // (`p7-messung-c-kind10050.txt`). Reasoning and consequence: `messagingRelayModels.ts`.
    [10050, { relay: 'other' }],

    // ── Buzz dialect — meaningless anywhere else ─────────────────────────────────
    // `KIND_FORUM_VOTE`, `kind.rs:552`. Buzz validates the target
    // (`validate_forum_vote_target`); zooid would just store it.
    [45002, { relay: 'buzz' }],
    // `KIND_MODERATION_TIMEOUT` / `KIND_MODERATION_UNTIMEOUT`, `kind.rs:363,365`. Buzz
    // executes these as commands and never stores them; zooid has no moderation model
    // that could read them at all.
    [9042, { relay: 'buzz' }],
    [9043, { relay: 'buzz' }],
    // `KIND_PRESENCE_UPDATE`, `kind.rs:463`. Ephemeral on Buzz and handled outside the
    // scope allowlist; on zooid an ephemeral kind with an `h` tag is a stored event.
    [20001, { relay: 'buzz' }],
    // `KIND_EVENT_REMINDER`, `kind.rs:102`. Buzz only re-publishes a due reminder if the
    // NIP-ER scheduler is part of the deployment, and it says so in `supported_extensions`
    // — so this one carries the extension condition rather than a hard-coded assumption.
    [30300, { relay: 'buzz', extension: NIP_ER_EXTENSION }],
    // `KIND_DM_OPEN` / `KIND_DM_ADD_MEMBER` / `KIND_DM_HIDE`, `kind.rs:507,509,511`.
    // Commands answered in the `OK` message field; on zooid nothing answers.
    [41010, { relay: 'buzz' }],
    [41011, { relay: 'buzz' }],
    [41012, { relay: 'buzz' }],
])

/**
 * The decision. `profile` is the NIP-11 info doc of the active space — needed only for
 * the extension-gated kinds, and safe to omit for every other one.
 *
 * @param kind        event kind about to be signed
 * @param spaceKind   from `deriveSpaceKind`; `'unknown'` denies
 * @param profile     NIP-11 doc of the same relay the write goes to
 */
export const mayWriteKind = (
    kind: number,
    spaceKind: SpaceKind,
    profile?: { supported_extensions?: string[] },
): boolean => {
    if (spaceKind === 'unknown') {
        return false
    }

    const rule = WRITE_RULES.get(kind)
    if (!rule) {
        return false
    }

    if (rule.relay === 'any') {
        return true
    }

    // `'other'` carries no extension condition — a NIP-11 doc says what a relay ADDS,
    // never what it refuses, so there is nothing there to ask.
    if (rule.relay === 'other') {
        return spaceKind === 'other'
    }

    if (spaceKind !== 'buzz') {
        return false
    }

    return rule.extension === undefined || hasRelayExtension(rule.extension, profile)
}
