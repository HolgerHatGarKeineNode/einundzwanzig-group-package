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
 * ── Which relays this is read from and written to ──────────────────────────────
 *
 * **The reader's declared write relays, or — if they have declared none — a fallback set
 * of public relays that actually serve kind 3.** {@link followRelayTargets} decides;
 * `js/follows.ts` supplies the fallback and carries the measurement for it.
 *
 * The space relay is in neither direction. P2 had it in both „because the members read
 * each other there", and that premise is false: nothing in this client reads a foreign
 * contact list. See N1 below for what it cost.
 *
 * ── THE INVARIANT, after two audit rounds ──────────────────────────────────────
 *
 * > **The base of a kind-3 write and its target set are the same set**, drawn once. No
 * > relay is a write target that was not a base source. A write happens only if **every**
 * > relay in that set closed the read with an `EOSE` in the same operation, and the base
 * > is the NIP-01 winner over exactly that set.
 *
 * Four ways earlier versions broke it, every one fail-OPEN, every one ending in the same
 * replaceable-event data loss the module was written to prevent:
 *
 *  · **F1** — {@link followListAnswered} asked `some`. One relay that answered and held
 *    nothing licensed a full replacement on relays that had not answered and did hold the
 *    list.
 *  · **F2** — „no NIP-65 list" and „could not ask" were the same empty array, and the
 *    cheapest way to produce it was a socket error. {@link OutboxKnowledge} splits them.
 *  · **F3** — the set came from a quality-filtered, randomised sample of at most three
 *    (`RelayScenario.getUrls()`), drawn once for the read and again for the write; 88.7 %
 *    of follows read a different set than they wrote. {@link declaredWriteRelaysOf} takes
 *    the declaration instead, and `js/follows.ts` draws it once.
 *  · **N1** — the space relay was a write target without being a usable base source: it
 *    holds no contact list, so the base was `null` and a one-tag kind 3 was written there,
 *    which then won the next session's NIP-01 comparison. {@link followRelayTargets} no
 *    longer knows the space at all.
 *
 * The first three are conditions on the ANSWER; N1 was a condition on the SET, one level
 * below them, and that is why fixing the first three did not fix it.
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
import { isRelayUrl, normalizeRelayUrl } from '@welshman/util'
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
 * This user's newest replaceable event of one kind, or `null`.
 *
 * Newest per author and not simply "the first one": the repository keeps one event per
 * replaceable address, but a cold start can hand us an IndexedDB copy and a fresh one in
 * the same batch, and the older of the two would otherwise decide.
 *
 * Takes the kind because the follow path now resolves TWO replaceable lists with the same
 * rule — kind 3 and, since the F2 repair, the reader's own kind 10002. One winner
 * implementation for both; two would drift, and the NIP-01 tie-break is exactly the part
 * that gets forgotten in a copy.
 */
export const newestOwnEvent = (events: FollowEventLike[], self: string, kind: number): FollowEventLike | null => {
    if (!self) {
        return null
    }
    let newest: FollowEventLike | null = null
    for (const event of events) {
        if (event.kind !== kind || event.pubkey !== self) {
            continue
        }
        if (followListWins(event, newest)) {
            newest = event
        }
    }

    return newest
}

/** This user's newest kind-3, or `null`. */
export const ownFollowList = (events: FollowEventLike[], self: string): FollowEventLike | null =>
    newestOwnEvent(events, self, FOLLOWS)

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
 *
 * `isRelayUrl` first, and that is not belt-and-braces: `normalizeRelayUrl` does NOT throw
 * on `http://host/`, it rewrites it to `wss://host/` (measured). Accepting that would
 * invent a relay out of a web link somebody put in their NIP-65 list, and this module
 * would then disagree with `RelayListReader` in `@welshman/domain`, which gates on
 * `isRelayUrl` — a disagreement the differential test in `followModels.test.ts` exists to
 * catch.
 */
const followRelayUrl = (url: string): string => {
    if (!url || !isRelayUrl(url)) {
        return ''
    }
    try {
        return normalizeRelayUrl(url)
    } catch {
        return ''
    }
}

/**
 * The tag names a NIP-65 relay entry can carry. `relay` is welshman's alias
 * (`relayTags(["r", "relay"])` in `@welshman/domain` `kinds/RelayList.js`); the spec only
 * names `r`, and reading both is what keeps this in step with the library.
 */
export const RELAY_LIST_TAGS: readonly string[] = ['r', 'relay']

/** The NIP-65 marker that makes an entry write-only. */
export const RELAY_LIST_WRITE_MARKER = 'write'

/**
 * **The relays this reader has DECLARED they write to** — NIP-65, kind 10002.
 *
 * NIP-65, verbatim: *„If the marker is omitted, the relay is both read and write."* So an
 * entry counts as a write relay when its third column is absent, empty, or exactly
 * `write`; a `read` marker excludes it. Mirrors `RelayListReader.writeUrls()` down to the
 * `isRelayUrl` gate and the normalisation, and `followModels.test.ts` runs both over the
 * same fixtures rather than trusting that sentence.
 *
 * **Why this is parsed here and not read off `RelayLists.writeUrls(pk)`.** That projection
 * is welshman's and it is correct — but it answers a different question than the one the
 * write path has to ask. It hands back urls with no way to say whether anybody was ever
 * asked, and F2 was exactly that: an empty projection read as „this reader has no relay
 * list". Parsing the winning EVENT keeps the url list and the verdict about it tied to one
 * object.
 */
export const declaredWriteRelaysOf = (list: FollowEventLike | null): string[] => {
    const urls: string[] = []
    for (const tag of list?.tags ?? []) {
        if (!RELAY_LIST_TAGS.includes(tag[0] as string)) {
            continue
        }
        const marker = tag[2]
        if (marker && marker !== RELAY_LIST_WRITE_MARKER) {
            continue
        }
        const url = followRelayUrl(tag[1] ?? '')
        if (url && !urls.includes(url)) {
            urls.push(url)
        }
    }

    return urls
}

/**
 * **What we know about the reader's own NIP-65 list**, and the whole point is that it is
 * three values rather than two.
 *
 * | value | means | what the follow path does |
 * |---|---|---|
 * | `listed` | a kind 10002 with at least one write relay | read and write go to exactly those relays, and every one of them must answer |
 * | `confirmed-none` | at least one relay we asked closed with `EOSE`, and nothing we got back held a usable kind 10002 | read and write go to the fallback set, and the card says the reach is not what it looks like |
 * | `unknown` | somebody did not answer, so „no list" and „could not ask" are indistinguishable | **nothing is read and nothing is written** |
 *
 * The bar for `confirmed-none` was „every asked relay" until K7 — {@link outboxKnowledgeOf}
 * carries why it moved and what the residual risk is.
 *
 * **F2 is the reason this type exists.** Before it, „no relay list" was a single empty
 * array, and the cheapest way to produce that array was a fault: `RelayStats.getQuality`
 * returns `0` after ONE `SocketStatus.Error` inside 60 s (`@welshman/app`
 * `plugins/relayStats.js`), and `RelayScenario.getUrls()` drops a zero-quality relay
 * entirely. A network hiccup therefore emptied the outbox, the empty outbox took the
 * lenient branch, and the surface told the reader the harmless reason. The failure signal
 * opened the bolt it should have closed.
 */
export type OutboxKnowledge = 'listed' | 'confirmed-none' | 'unknown'

/**
 * **The three-way verdict.** `anyAnswered` is „at least one relay we asked for the kind
 * 10002 closed with an `EOSE`".
 *
 * ── Why `some` here and `every` on the contact list (K7) ────────────────────────
 *
 * These answer two different questions, and only one of them licenses a write.
 *
 * {@link followListAnswered} asks *„may we replace what these relays hold?"* — that stays
 * `every`, unconditionally. It is the F1 riegel and nothing here touches it.
 *
 * This function asks *„is it safe to conclude this reader has declared no relays?"* Until
 * K7 it demanded every asked relay, for a good reason at the time: a wrong
 * `confirmed-none` planted a one-tag kind 3 on the SPACE, which nobody read and which
 * still won our own next merge base. **K4 removed that path.** What a wrong
 * `confirmed-none` produces now is a write to the fallback set — and because base and
 * target set are the same set, that set is READ first, completely, with `every`. Measured
 * read-only on 2026-09-14: three of the four default relays serve the reader's real
 * contact list. So the ordinary outcome of a wrong verdict is that the real list is
 * extended, not that one is invented.
 *
 * The price of the strict form, by contrast, was not theoretical. `relay.damus.io` sits in
 * `INDEXER_RELAYS` and answered HTTP 521 on three consecutive probes plus its NIP-11
 * endpoint; under `allAnswered` that alone made `confirmed-none` unreachable, so **no
 * member without a kind 10002 could follow at all** — which is exactly the group this
 * feature exists for. Availability as the product of three third-party uptimes is not a
 * design.
 *
 * `unknown` still covers „nobody answered", and an empty ask set still lands there, so the
 * fail-closed edge for a deployment without indexers is unchanged.
 *
 * **The residual risk is named and pinned by a test rather than argued away**: a reader
 * whose real list is on none of the fallback relays, asked while their kind 10002 happens
 * to be unfindable, gets a one-entry stub on the fallback set. See the case
 * „ACCEPTED RISK" in `followModels.test.ts`.
 */
export const outboxKnowledgeOf = (
    input: { writeUrls: readonly string[]; anyAnswered: boolean },
): OutboxKnowledge => {
    if (input.writeUrls.length > 0) {
        return 'listed'
    }

    return input.anyAnswered ? 'confirmed-none' : 'unknown'
}

/**
 * **Did at least ONE of these relays close with an `EOSE`?**
 *
 * Deliberately a separate function from {@link followListAnswered} rather than a flag on
 * it. The two look interchangeable and are not: this one decides which relays to use,
 * that one decides whether they may be replaced. Fusing them would put a `some` one
 * refactor away from the riegel that F1 cost us.
 */
export const anyRelayAnswered = (reads: readonly FollowRelayRead[]): boolean =>
    reads.some((read) => read.answered)

/**
 * **May the ARMING pass read the contact list, or does it wait for a click? (F7)**
 *
 * Only for `listed`. Those relays are the reader's own declaration — asking them is the
 * outbox model working as intended, and the answer is what lets the button show a truthful
 * label instead of „Lädt…" forever.
 *
 * For `confirmed-none` the targets are public relays the reader never chose, and asking
 * them `{kinds:[3], authors:[self]}` on **every page load** tells four third parties who
 * is reading, when, and that a follow is about to happen. `relayConfig.ts` grants those
 * relays AUTH, so it is not even a pseudonymous pattern. The read still happens — on the
 * click, where P1 already put a retry: the first click while `listSeen` is false is a read
 * and never a write, so nothing about the safety of the write changes. What changes is
 * that a reader who never follows anybody never announces themselves.
 *
 * `unknown` reads nothing either way; there is no set to ask.
 */
export const armingReadsContactList = (knowledge: OutboxKnowledge): boolean => knowledge === 'listed'

/**
 * **The relays a contact list is read from AND written to — one set, no space.**
 *
 * ── Why the space relay is in neither list any more (N1) ────────────────────────
 *
 * P2 put the space in the set „because the members read each other there". That premise
 * was checked and is false. In the whole production tree **nobody reads a foreign contact
 * list**: `followFilters` is `{kinds:[FOLLOWS], authors:[self]}`, and the only other
 * source went through `newestOwnEvent(events, self, FOLLOWS)`, which is the same
 * restriction. The space copy of a kind 3 therefore had exactly one consumer that could
 * act on it — our own merge base — and that made it a liability with no upside.
 *
 * The liability, measured across two sessions with real signatures: with no NIP-65 list
 * the target set was the space alone, the space holds no kind 3, so the merge base was
 * `null` and a one-tag kind 3 landed there. In the next session, once the relay list did
 * resolve, that stub was the newest event of its address and won the NIP-01 comparison —
 * 700 contacts down to two, no attacker and no fault required.
 *
 * ── The rule that replaces it ──────────────────────────────────────────────────
 *
 * > The base of a write and its target set are THE SAME SET.
 *
 * `listed` → the declared write relays. `confirmed-none` → the caller's fallback set,
 * which has to be relays that actually accept and serve kind 3 (`js/follows.ts` picks it
 * and the latch pins it). `unknown` → the empty set, which {@link followListAnswered}
 * refuses, so nothing is read and nothing can be written.
 *
 * Normalised before de-duplicating, and that is not decoration: a `Set` over raw strings
 * splits `wss://host` from `wss://host/` into two targets, and this repo has been bitten
 * by exactly that class of host comparison before.
 */
declare const followTargetSetBrand: unique symbol

/**
 * **The target set as a TYPE — the assurance D7 kept losing, moved where a walk cannot be
 * walked around.**
 *
 * A branded `readonly string[]`: structurally an array of relay urls, nominally something
 * only {@link followRelayTargets} can produce. Everything downstream — the contact-list
 * read, the write, {@link FollowRelayRead}-based verdicts — takes this type and not
 * `string[]`.
 *
 * ── Why a type and not a fourth source check ───────────────────────────────────
 *
 * Three rounds of review found three different ways to fold the read-only hint relays into
 * the set that votes on completeness and then gets written to, and every one of them was a
 * new SHAPE of the same class:
 *
 * ```ts
 * readFollowListsFrom([...targets, ...hints], …)    // round 6
 * const merged = [...targets, ...hints]             // round 7
 * let targets = …; targets = [...targets, ...hints] // round 8
 * targets.push(...hints)                            // round 8
 * ```
 *
 * A source walk can only ever enumerate the shapes it was told about, so each round it was
 * green against the form that had not been thought of yet. The type ends the enumeration
 * for those four:
 *
 *  · `readonly string[]` has no `push`, no `splice`, no `sort` — the fourth form stops
 *    being a bypass and starts being a compile error (`TS2339`).
 *  · a spread, a `concat`, a ternary, a re-assignment all produce a plain `string[]`,
 *    which does not carry the brand and is not assignable — forms one to three, `TS2345`
 *    and `TS2322`. A `satisfies` is the same story.
 *
 * ── WHAT THIS DOES NOT DO. Read this before you trust it. ──────────────────────
 *
 * An earlier version of this docblock closed with „the only remaining way in is a cast,
 * and casts are a countable set". **That sentence was the actual defect of the round it
 * was written in** — not because it was careless, but because it tells the next reviewer
 * they may stop looking. A review then measured four ways in that are not casts, each
 * `tsc` exit 0 and the source census green:
 *
 * | | how the brand is acquired without a cast |
 * |---|---|
 * | A1 | `JSON.parse(JSON.stringify([...targets, 'wss://…']))` — the return type is `any`, and `any` is assignable to everything |
 * | A2 | `Object.assign([...targets, ...hints], targets)` — the result type is an INTERSECTION, so it carries the brand of the second argument while holding the elements of the first |
 * | A3 | `type Minted = FollowTargetSet` in another file, then `urls as Minted` — a cast the census cannot see, because it matches the text `FollowTargetSet` and an alias never contains it |
 * | A4 | **REFUTED, never reachable** — the claim was that mutating the array handed to {@link mintTargetSet} widens the minted set. Measured at `9ff152a`, before any copy existed: both of its two call sites pass a freshly allocated array, and it is not exported. Listed here so nobody re-opens it as a lead; the contract in {@link mintTargetSet} is a promise, not a repair |
 *
 * The shortest forgery out of the EXPORTED api, one expression, no `as` and no `any`:
 * `Object.assign(noFollowTargets(), ['wss://attacker.example/'])`.
 *
 * So, precisely: **the brand closes the four forms that actually occurred in review, at
 * compile time. It does not close laundering through `any`, through an intersection, or
 * through an aliased cast.** What stands against those is not a type and not a source
 * scanner but a measurement at the wire: `js/followClickGate.test.ts` counts the relays a
 * CLICK asks and the events it sends, `js/followArmingGate.test.ts` does the same for the
 * PAGE LOAD. Both, not either — the intersection form was placed in the arming branch
 * precisely because nothing is written there, and it stayed green until the second file
 * existed. A widened set is extra traffic whatever syntax produced it.
 *
 * The brand is minted in exactly one expression, {@link mintTargetSet}.
 */
export type FollowTargetSet = readonly string[] & { readonly [followTargetSetBrand]: true }

/**
 * THE one place the brand comes into existence.
 *
 * Deliberately not exported: a second minting site would give every caller the cast back
 * that the type just took away, and the whole assurance is that there is one.
 *
 * **Copies — as a contract, not as a repair (A4).** A review reported that this function
 * branded the caller's array in place, so that `followRelayTargets('listed', declared, [])`
 * handed back the very array `declared` pointed at and a later `declared.push('wss://…')`
 * widened a set the type calls `readonly`. **That was measured at `9ff152a`, before the
 * copy existed, and it did not hold:** the returned set was never identical to the argument
 * and a push through it changed nothing. Both call sites below hand in a freshly allocated
 * array — one a literal, one the result of {@link normalizeRelaySet} — and the function is
 * not exported, so there was no third way in. The reporting review has since withdrawn the
 * claim.
 *
 * The copy stayed anyway, and the reason is a contract rather than a hole: the function
 * that hands the value out is the one that should owe „nobody else holds this array",
 * instead of the promise resting on a helper further up continuing to allocate. What
 * remains true from the original report is the general half — `readonly` is a statement
 * about a binding at compile time and guards no value at runtime.
 */
const mintTargetSet = (urls: readonly string[]): FollowTargetSet => {
    // Bound as `readonly string[]` before the assertion so that the ONE cast in this file
    // stays a cast from `readonly string[]`. `[...urls] as FollowTargetSet` is a cast from
    // `string[]`, which TypeScript rejects as insufficiently overlapping (TS2352) and
    // which would have to be laundered through `unknown` — a second entry in the census
    // next door, and a worse one.
    const copy: readonly string[] = [...urls]

    return copy as FollowTargetSet
}

/**
 * The empty target set, for the callers that have to report „no set was drawn" without
 * drawing one.
 *
 * Goes through {@link followRelayTargets} rather than minting its own, so the count of
 * minting sites stays at one, and a fresh array each call so that no two callers can share
 * a value somebody later mutates through a cast.
 */
export const noFollowTargets = (): FollowTargetSet => followRelayTargets('unknown', [], [])

export const followRelayTargets = (
    knowledge: OutboxKnowledge,
    declaredWriteUrls: readonly string[],
    fallbackUrls: readonly string[],
): FollowTargetSet => {
    if (knowledge === 'unknown') {
        return mintTargetSet([])
    }

    return mintTargetSet(normalizeRelaySet(knowledge === 'listed' ? declaredWriteUrls : fallbackUrls))
}

/**
 * Normalise, drop what is not a relay url, de-duplicate — first occurrence wins, order
 * kept.
 *
 * Its own function because the relay-list read needs the same treatment for a set that
 * has nothing to do with a space (indexers ∪ the relays a cached kind 10002 names), and
 * calling {@link followRelayTargets} with an empty second argument would have said
 * something untrue about what that argument is.
 */
export const normalizeRelaySet = (urls: readonly string[]): string[] => {
    const targets: string[] = []
    for (const raw of urls) {
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
 * **The invariant of this whole module, in one function: every relay we are about to
 * WRITE to must have answered the read in the SAME operation.**
 *
 * ── What it replaces, and why that was a High finding ───────────────────────────
 *
 * Until the F1 repair this asked `some`: one outbox relay that answered was enough. That
 * reads reasonably and is wrong by exactly one word, because the write does not go to the
 * relay that answered — it goes to the whole target set. Measured by the auditor with
 * these functions: a reader on `[fresh.example, relay.damus.io, nos.lol]` whose 700-entry
 * list sits on the last two; `fresh.example` answers with `EOSE` and nothing; the other
 * two run into the six-second timeout.
 *
 *     followListAnswered : true
 *     merge base         : null
 *     planFollowWrite    : 1 tag, content ""
 *     write targets      : [fresh.example, relay.damus.io, nos.lol, space]
 *
 * `created_at` is `now()`, so it dominates on all four. 700 contacts and the legacy relay
 * map in `content` gone, and the surface reports success. A partial answer licensed a
 * total replacement.
 *
 * ── The cost of the strict form, stated rather than discovered ──────────────────
 *
 * One permanently dead relay in the reader's own kind 10002 makes following impossible
 * until they remove it — and this client has no write path for kind 10002, so they have
 * to do that elsewhere. That is the right direction for an object with no undo: the
 * refusal costs a click, the mistake costs every contact they have. It is only bearable
 * because the refusal is **visible and names the relay** — see {@link unansweredRelays},
 * which exists for that message and not for diagnostics.
 *
 * The verdict is about the relays that ANSWERED, never about the lists they carried: a
 * reader who genuinely follows nobody has relays that answer with zero events, and that
 * is a complete answer.
 */
export const followListAnswered = (reads: readonly FollowRelayRead[], targets: readonly string[]): boolean => {
    const wanted = new Set(targets.map(followRelayUrl).filter(Boolean))
    if (wanted.size === 0) {
        // Nothing was asked. Not "everything answered vacuously" — `[].every(…)` is
        // `true`, and that would be a write to nowhere reported as a complete read.
        return false
    }
    const answered = new Set(reads.filter((read) => read.answered).map((read) => followRelayUrl(read.url)))

    return [...wanted].every((url) => answered.has(url))
}

/**
 * The targets that did NOT close with an `EOSE`, normalised — the content of the refusal
 * message.
 *
 * A target nobody even attempted counts as unanswered: the set is built from `targets`,
 * not from `reads`, so a read that silently never happened shows up here instead of
 * disappearing.
 */
export const unansweredRelays = (reads: readonly FollowRelayRead[], targets: readonly string[]): string[] => {
    const answered = new Set(reads.filter((read) => read.answered).map((read) => followRelayUrl(read.url)))

    return targets.map(followRelayUrl).filter((url) => url && !answered.has(url))
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

/** The followed pubkeys in a tag list, in order, deduplicated. */
export const followedPubkeysIn = (tags: readonly string[][]): string[] => {
    const seen = new Set<string>()
    for (const tag of tags) {
        if (isFollowPersonTag(tag)) {
            seen.add(tag[1] as string)
        }
    }

    return [...seen]
}

/** The followed pubkeys of one list, in list order, deduplicated. */
export const followedPubkeysOf = (list: FollowEventLike | null): string[] => followedPubkeysIn(list?.tags ?? [])

/**
 * **The full tag list after following n people — the base carried over UNTOUCHED, the
 * genuinely new entries in front of it, in the order they were given.**
 *
 * Prepending for the same reason `withMutedPubkey` does: a list that grows at the bottom
 * pushes the entry the user just made out of sight wherever it is rendered top down.
 *
 * A new entry is a bare `["p", <pubkey>]`. A relay hint would be a guess — the space we
 * happen to be on is not necessarily where that person writes — and an invented hint is
 * worse than none, because other clients act on it.
 *
 * ── Why the base is not filtered, and why that is the whole point of P3 ─────────
 *
 * The single-target predecessor removed the target's existing entry and re-prepended it as
 * a bare tag. For one person that is a reordering with one measurable cost: the entry loses
 * its relay hint and its petname (`["p", <hex>, <relay>, <petname>]` → `["p", <hex>]`).
 * `js/follows.ts` never reaches the case, because it derives the direction from the list a
 * relay just showed it, so a person already followed is unfollowed and never re-added.
 *
 * **A bulk call has no such luck.** „Follow every member" over 400 people of whom 380 are
 * already followed would run all 380 through that reordering and strip 380 petnames and
 * hints in one signed event — refusal 3 of {@link planFollowWrite}, broken 380 times, and
 * invisible on screen because the follow itself succeeds. So an already-followed target
 * contributes **nothing**: it stays exactly where it is, with every column it had.
 *
 * ── The properties this function is chosen for ─────────────────────────────────
 *
 *  · **`tags` is a SUFFIX of the result**, element for element, column for column. The
 *    result can therefore never be shorter than the base, whatever is passed in — which is
 *    the one outcome a contact-list write must never have.
 *  · A pubkey repeated inside `targets` is added once. A duplicate `p` tag is not a
 *    stronger follow, it is a malformed list.
 *  · `self` and the empty string are dropped from the additions rather than refusing the
 *    call. The reader's own key is in the member directory this feeds, and „follow all"
 *    must not be impossible for a member; the invariant those refusals protect is „self
 *    never becomes a new `p` tag", and dropping keeps it. A self entry the base already
 *    carries is left alone — removing it would be a shrink nobody asked for.
 */
export const withFollowedPubkeys = (tags: string[][], targets: readonly string[], self: string): string[][] => {
    const known = new Set(followedPubkeysIn(tags))
    const added: string[][] = []
    for (const target of targets) {
        if (!target || target === self || known.has(target)) {
            continue
        }
        known.add(target)
        added.push([FOLLOW_PERSON_TAG, target])
    }

    return [...added, ...tags]
}

/** The full tag list after unfollowing one person. Every other tag stays. */
export const withoutFollowedPubkey = (tags: string[][], target: string): string[][] =>
    tags.filter((tag) => !(isFollowPersonTag(tag) && tag[1] === target))

/** The body of the event a write would produce — nothing more than that. */
export type FollowWrite = { kind: number; content: string; tags: string[][] }

/**
 * **The direction of a write, as a shape rather than as a flag — and the reason it is a
 * union is a decision of the plan, not a taste in types.**
 *
 * | arm | what it takes | what it can do |
 * |---|---|---|
 * | `add: true` | `targets`, n ≥ 0 | grow the list by the entries it does not already have |
 * | `add: false` | `target`, exactly one | remove exactly one entry |
 *
 * ── Why growth is bulk and shrinking is not ────────────────────────────────────
 *
 * P3 exists because n follows must become ONE replaceable event: `makeEvent` stamps
 * `created_at` in seconds, so n writes inside the same second carry the same timestamp and
 * the id hash decides which survives — on Buzz the loser is reported as `OK true` with
 * `duplicate:`, which reads as success. n calls would be n events that displace each other;
 * one call is one event.
 *
 * None of that argues for a bulk UNFOLLOW, and the plan puts mass-unfollow out of scope
 * with a reason of its own: same mechanism, but a misclick cannot be taken back, so it is
 * its own piece of work with its own question to the user. With a plain `targets: string[]`
 * next to a plain `add: boolean`, that decision would be three characters away — `add: false`
 * over a selection of 400 produces an event with 400 entries FEWER than the base, which is
 * the single outcome this module exists to prevent, and no test of the follow direction
 * would see it.
 *
 * **So the union is that scope decision, held by the compiler.** Widening it is not a
 * type-level inconvenience to be smoothed out: whoever replaces this with one flag is
 * overruling a decision of the plan, and the cost of doing it deliberately is one edit to
 * this file — which is exactly where the „eigene Rückfrage" the plan asks for belongs.
 */
export type FollowPlanDirection =
    | {
        add: true
        /**
         * The people to follow. Duplicates, entries already on the list, the reader's own
         * key and empty strings all contribute nothing — {@link withFollowedPubkeys}
         * carries why each of those is dropped rather than refused.
         */
        targets: readonly string[]
    }
    | {
        add: false
        /** The one person to unfollow. Empty or the reader themselves refuses the write. */
        target: string
    }

/** What {@link planFollowWrite} needs to answer. */
export type FollowPlanInput = FollowPlanDirection & {
    /**
     * Our own newest kind 3, as {@link winningFollowList} resolved it across the relays
     * that were asked — or `null`.
     *
     * **`null` next to `listAnswered: true` really does mean "there is none".** Before P2
     * the read went to the space relay alone, where a contact list practically never
     * lives, so `null` mostly meant "we asked the wrong relay"; after P2 but before the
     * audit, one answering relay was enough, so it meant "the relay that answered does not
     * hold it". Both are closed by the invariant in the module header — by the relay SET
     * and the completeness of its answer, never by this gate.
     */
    list: FollowEventLike | null
    /**
     * **Did EVERY relay of the target set close the read with an `EOSE`?** From
     * {@link followListAnswered}. Not „some relay said `EOSE`" — that was F1, and it let a
     * relay which held nothing license a full replacement on the ones that held the list.
     * `false` also covers "not asked yet" and "the reader's own kind 10002 was not
     * retrievable" ({@link OutboxKnowledge}`.unknown`); all of them must refuse.
     */
    listAnswered: boolean
    /** The reader's own pubkey; `''` for a guest. */
    self: string
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
 * | `!self` | a guest write with no key |
 * | no usable target | an empty `p` tag, or an unfollow of nobody |
 * | `!listAnswered` | **the replaceable-kind data loss**: we replace the relay's contact list with the entries we happen to know, and every follow made on another device is deleted. Since P2 the verdict behind this flag is the staged one in {@link followListAnswered} — an `EOSE` from the space relay alone no longer clears it while the reader has an outbox |
 * | `!mayWriteKind` | a write while the relay kind is still `'unknown'`, i.e. a guess about which relay we are talking to |
 * | `sameTags` | a signed event that changes nothing — a double click, a second device that got there first, or a bulk call in which every target was already followed |
 *
 * `content` is carried over unchanged: the relay map some clients still keep there is not
 * ours to rewrite (module header).
 *
 * ── n targets, ONE event — and why that is not an optimisation (P3) ────────────
 *
 * The follow direction takes a set and resolves it in one pass. Calling this n times and
 * signing each answer would produce n replaceable events with, in the ordinary case, the
 * SAME `created_at`: `makeEvent` stamps seconds. NIP-01 then breaks the tie on the id, so
 * one of the n survives and the other n-1 are dropped — Buzz reports the dropped ones as
 * `OK true` with the message `duplicate:`, which every surface reads as success. Each of
 * those n bodies was built from the same base and therefore holds the base plus exactly one
 * entry: „follow 400 members" would end at 399 lost, reported green. One call, one event.
 *
 * ── The two arms decide the reader's OWN key differently, deliberately ─────────
 *
 * `add: false, target: self` **refuses the whole write**; `add: true` with `self` among the
 * targets **drops it and adds the rest**. That is not an inconsistency left behind:
 *
 *  · The unfollow arm takes exactly one target, so „that target is unusable" and „this call
 *    has nothing to do" are the same sentence. Refusing says it once and plainly.
 *  · The follow arm is fed by the member directory, and the reader is a member. Refusing
 *    the whole set because the reader's own row is in it would make „follow everybody"
 *    impossible for precisely the people this feature is for. The invariant behind the old
 *    refusal is „self never becomes a new `p` tag", and dropping keeps it exactly.
 *
 * A self entry the base already carries is untouched in both arms of the follow direction —
 * removing it would be a shrink nobody asked for, and shrinking is what this module is
 * about ({@link withFollowedPubkeys}).
 */
export const planFollowWrite = (input: FollowPlanInput): FollowWrite | null => {
    const { list, listAnswered, self, spaceKind } = input
    if (!self) {
        return null
    }
    // The unfollow arm, which is single-target by construction: an unusable target leaves
    // it with nothing to do, and saying so here keeps it out of the tag algebra. The follow
    // arm has no equivalent — an unusable entry among n is dropped, not fatal.
    if (!input.add && (!input.target || input.target === self)) {
        return null
    }
    if (!listAnswered) {
        return null
    }
    if (!mayWriteKind(FOLLOWS, spaceKind)) {
        return null
    }
    const current = list?.tags ?? []
    const tags = input.add
        ? withFollowedPubkeys(current, input.targets, self)
        : withoutFollowedPubkey(current, input.target)
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
