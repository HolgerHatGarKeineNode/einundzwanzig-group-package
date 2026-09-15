/**
 * **The gate of P4, and it is a wire count: following n people costs ONE event and a
 * number of REQ frames that does not depend on n.**
 *   node --test --experimental-strip-types packages/einundzwanzig-group/js/followBulkWire.test.ts
 *
 * ── Why a count and not a behaviour description ────────────────────────────────
 *
 * „Bulk follow is cheap" is the claim the plan's cost model makes, and the naive build
 * that breaks it is three characters away: `for (const t of targets) await toggle(t)`. It
 * looks right, it follows everybody on screen, and it is the one outcome this whole plan
 * exists to prevent — `makeEvent` stamps `created_at` in SECONDS, so n writes inside the
 * same second carry the same timestamp, NIP-01 breaks the tie on the id hash, and Buzz
 * reports every displaced one as `OK true` with the message `duplicate:`
 * (`buzz/crates/buzz-relay/src/handlers/ingest.rs`). „Follow 400 members" would end at 399
 * lost and report green on every surface.
 *
 * No assertion about the shape of the code catches that; a count of EVENT frames at the
 * relay does, and so does the REQ count, because the loop also re-reads the contact list
 * once per person.
 *
 * ── The instrument ────────────────────────────────────────────────────────────
 *
 * `app.netContext.getAdapter` with a `MockAdapter`, the same seam
 * `js/followClickGate.test.ts` and `js/welshmanLoad.test.ts` use. Every `REQ` and every
 * `EVENT` frame is recorded with the relay it went to; the mock answers as a relay does,
 * including replacing the stored list on a write, so the re-read after a publish sees what
 * a real one would.
 *
 * **Both directions are measured.** Counting only what is written would leave the reads
 * free to explode — which is the expensive half in this repo's own cost model: 400 ×
 * `Profiles.load(pk)` is 1204 REQ frames (1200 of them kind-10002 outbox resolution, one
 * per pubkey per indexer, unbatchable because `RelayLists.fetch` sets `limit: 1` and
 * `calculateFilterGroup` gives every filter with a `limit` a random group id). The bulk
 * follow must never take that shape, which is why `kinds: [0]` on this path is asserted to
 * be absent and the absence is calibrated against a real kind-0 request.
 */
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import type { AbstractAdapter, ClientMessage, MockAdapter as MockAdapterType } from '@welshman/net'
import type { Filter, TrustedEvent } from '@welshman/util'
import type { FollowsStore } from './follows.ts'

const JS_DIR = dirname(fileURLToPath(import.meta.url))

const INDEXER = 'wss://indexer.bulk.invalid/'
const FALLBACK = 'wss://fallback.bulk.invalid/'
/** The two relays a `listed` reader declares in their kind 10002 — see the last case. */
const OUT1 = 'wss://out1.bulk.invalid/'
const OUT2 = 'wss://out2.bulk.invalid/'

// Before ANY import of the module graph: `js/relayConfig.ts` reads this once, at load.
// Without it `DEFAULT_RELAYS` is empty outside a browser, the fallback target set is empty
// too, and every case below would measure the vacuous-set guard instead of the write.
;(globalThis as { __nostrRelays?: unknown }).__nostrRelays = {
    indexer: [INDEXER],
    default: [FALLBACK],
    signer: [],
}
const stored = new Map<string, string>()
;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string): string | null => stored.get(k) ?? null,
    setItem: (k: string, v: string): void => void stored.set(k, v),
    removeItem: (k: string): void => void stored.delete(k),
}

const { app, Relays } = await import('./welshmanApp.ts')
const { loginWithNip01 } = await import('./welshmanSession.ts')
const { activeSpaceUrl } = await import('./groups.ts')
const { wireFollows } = await import('./follows.ts')
const { load } = await import('./welshmanNet.ts')
const { MockAdapter } = await import('@welshman/net')
const { Relay } = await import('@welshman/domain')
const { FOLLOWS } = await import('./followModels.ts')
const { RELAYS } = await import('./welshmanKinds.ts')
const { makeEvent, makeSecret, getPubkey } = await import('@welshman/util')
const { Nip01Signer } = await import('@welshman/signer')

/** A pubkey-shaped constant that is nobody's key — the targets of a bulk follow. */
const target = (i: number): string => (i + 1).toString(16).padStart(64, '0')

const ALICE = 'b'.repeat(64)
const BOB = 'c'.repeat(64)

/**
 * **The size the cost claim is made at.** The plan states every figure as a function of n
 * and uses 400 as its worked example, because the real member count sits behind NIP-42 and
 * was deliberately not measured with a member key.
 */
const MANY = 400
const TARGETS: readonly string[] = Array.from({ length: MANY }, (_, i) => target(i))

/**
 * **The ceiling this phase nails down.**
 *
 * Three REQ frames per bulk follow, whatever n is: the reader's kind 10002 at the indexer,
 * the contact-list read over the target set, and the re-read that checks the `OK`. Stated
 * as a ceiling as well as an equality so the case still fails loudly if the path grows a
 * fourth round trip that is proportional to anything.
 */
const BULK_REQ_CEILING = 4

/**
 * **The ceiling as the formula it always was** — `2·|targets| + |hints \ targets| + cold`.
 *
 * The constant above is the `confirmed-none` configuration of this file (1 target, no hints,
 * one cold kind-10002 round) and it was read for a while as the ceiling of the path. It is
 * not: on the `listed` path the targets are the DECLARED write relays and
 * `readOwnFollowList` additionally asks `FOLLOW_BASE_HINT_RELAYS` minus the targets, so a
 * reader with two declared relays pays five frames — measured in the last case here.
 *
 * What the formula has to show is that **no term contains n**: the read is one REQ per
 * relay, the re-read is one REQ per target, and the number of people in the selection
 * appears nowhere. The naive bulk follow — a loop over `toggle()` — multiplies the whole
 * expression by n, and 400 × `Profiles.load(pk)` adds 1200 frames that are not in it at all.
 *
 * `cold` is 1 while the reader's kind 10002 has not been resolved this session and 0
 * afterwards ({@link listedRelayCache} in `js/follows.ts` keeps a `listed` verdict, and only
 * that one).
 */
const bulkReqCeiling = (targets: number, hints: number, cold: number): number => 2 * targets + hints + cold

/**
 * What one relay does for one reader. Keyed by pubkey, because a single `MockAdapter` per
 * url serves every identity in this file — the pool hands out one adapter per relay.
 */
type Behaviour = {
    /** The kind 3 this relay serves for that author, or `null` for „has none". */
    list: TrustedEvent | null
    /**
     * The reader's kind 10002. `undefined` — the default in this file — is the
     * `confirmed-none` verdict, which puts the target set on {@link FALLBACK}. One identity
     * here has one, and that is the `listed` configuration: see the last case.
     */
    relayList?: TrustedEvent
    /** Never close a kind-3 read with an `EOSE` — the fail-closed case. */
    silentFollows?: boolean
    /** What the relay serves AFTER a write, instead of what was written. */
    serveAfterWrite?: TrustedEvent
}
const behaviour = new Map<string, Behaviour>()

/** Every REQ this client sent: the relay, the kinds asked for, and whose data. */
const requested: { url: string; kinds: number[]; authors: string[] }[] = []
/** Every EVENT frame that reached a relay. */
const written: TrustedEvent[] = []
/** The relays those writes went to, in order. */
const writtenTo: string[] = []

const clearWire = (): void => {
    requested.length = 0
    written.length = 0
    writtenTo.length = 0
}

/**
 * **Every REQ in the measured window, unfiltered — and the unfiltered part is a repair.**
 *
 * This read `requested.filter((req) => req.authors.includes(self))` until a mutation stayed
 * green: 400 × `app.use(Profiles).load(pk)` added to the bulk path changed nothing here,
 * because those frames carry the TARGETS' pubkeys in `authors` and the filter threw every
 * one of them away. The filter was meant to keep other stores in this process out of the
 * count; it also removed the entire failure mode the count exists to catch.
 *
 * The window is quiet instead: every case clears the recorder immediately before the one
 * call it awaits, and no other store is doing anything at that moment. Whose data was asked
 * for is then asserted separately, as a statement in its own right.
 */
const wireFrames = (): { url: string; kinds: number[] }[] =>
    requested.map((req) => ({ url: req.url, kinds: req.kinds }))

/** The pubkeys a window's REQ frames asked about, de-duplicated. */
const askedAbout = (): string[] => [...new Set(requested.flatMap((req) => req.authors))].sort()

const makeAdapter = (url: string): MockAdapterType => {
    const adapter: MockAdapterType = new MockAdapter(url, (message: ClientMessage) => {
        if (message[0] === 'REQ') {
            const subId = message[1] as string
            const filters = message.slice(2) as Filter[]
            for (const filter of filters) {
                requested.push({
                    url,
                    kinds: [...(filter.kinds ?? [])],
                    authors: [...(filter.authors ?? [])],
                })
            }
            setTimeout(() => {
                let hold = false
                for (const filter of filters) {
                    const author = filter.authors?.[0] ?? ''
                    const state = behaviour.get(author)
                    // Almost nobody in this file has a kind 10002: that is the
                    // `confirmed-none` verdict, which puts the target set on the fallback
                    // relay and keeps it the same for every case here. The one identity
                    // that HAS one is the `listed` counting case at the end — the reviewer's
                    // finding that the ceiling below was measured on one configuration only.
                    if (filter.kinds?.includes(RELAYS)) {
                        if (state?.relayList) {
                            adapter.receive(['EVENT', subId, state.relayList])
                        }
                        continue
                    }
                    if (filter.kinds?.includes(FOLLOWS)) {
                        if (state?.silentFollows) {
                            hold = true
                            continue
                        }
                        if (state?.list) {
                            adapter.receive(['EVENT', subId, state.list])
                        }
                    }
                }
                if (!hold) {
                    adapter.receive(['EOSE', subId])
                }
            }, 0)

            return
        }
        if (message[0] === 'EVENT') {
            const event = message[1] as TrustedEvent
            written.push(event)
            writtenTo.push(url)
            const state = behaviour.get(event.pubkey)
            if (state) {
                // A relay that keeps something other than what it was sent is not exotic:
                // a replaceable write that loses the `created_at` race is answered
                // `OK true` with `duplicate:` and the stored copy never moves.
                state.list = state.serveAfterWrite ?? event
            }
            setTimeout(() => adapter.receive(['OK', event.id, true, '']), 0)
        }
    })

    return adapter
}

const settle = (ms = 300): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** A signed kind 10002 — the declaration that makes a reader `listed`. */
const signRelayList = async (secret: string, urls: string[]): Promise<TrustedEvent> =>
    (await Nip01Signer.fromSecret(secret).sign(
        makeEvent(RELAYS, {
            created_at: 1_700_000_000,
            tags: urls.map((url: string) => ['r', url, 'write']),
            content: '',
        }),
    )) as unknown as TrustedEvent

/** A signed kind 3 for one identity — really signed, because `@welshman/net` verifies. */
const signList = async (
    secret: string,
    tags: string[][],
    createdAt = 1_800_000_000,
): Promise<TrustedEvent> =>
    (await Nip01Signer.fromSecret(secret).sign(
        makeEvent(FOLLOWS, { created_at: createdAt, tags, content: '' }),
    )) as unknown as TrustedEvent

describe('P4: n follows are one event, and the wire says so', () => {
    const originalGetAdapter = app.netContext.getAdapter

    before(() => {
        app.netContext.getAdapter = (url: string): AbstractAdapter => makeAdapter(url)
    })

    after(() => {
        app.netContext.getAdapter = originalGetAdapter
        for (const url of [INDEXER, FALLBACK, OUT1, OUT2]) {
            app.pool.remove(url)
        }
    })

    test('CORE: 400 targets produce ONE signed event, and the base survives whole', async () => {
        const secret = makeSecret()
        const base = await signList(secret, [['p', ALICE, 'wss://alice.example/', 'Alice'], ['p', BOB], ['t', 'bitcoin']])
        const { store, me } = await freshIdentityWithSecret('many', secret, { list: base })

        await store.armFollowRead()
        assert.equal(store.listSeen, true, 'PRECONDITION: the read-only arm landed, so the bulk path is armed')
        assert.deepEqual(store.following, [ALICE, BOB], 'PRECONDITION: and it is the relay copy that is rendered')
        clearWire()

        await store.followMany(TARGETS, store.listId)

        assert.equal(
            written.length,
            1,
            `following ${MANY} people produced ${written.length} events. n events carry the same `
                + '`created_at` (makeEvent stamps seconds), NIP-01 breaks the tie on the id hash, and Buzz answers '
                + 'the displaced ones `OK true` + `duplicate:` — so n-1 follows are lost and every surface reads '
                + 'it as success. One call, one plan, one signature.',
        )
        assert.equal(written[0]?.kind, FOLLOWS)
        assert.equal(written[0]?.pubkey, me, 'signed by the reader, on the key the session holds')
        assert.deepEqual([...new Set(writtenTo)], [FALLBACK], 'and it went to the target set of the read')

        const tags = written[0]?.tags ?? []
        assert.equal(tags.length, MANY + 3, `the event carries ${tags.length} tags, expected ${MANY} + the 3 of the base`)
        assert.deepEqual(
            tags.slice(0, MANY),
            TARGETS.map((pk: string) => ['p', pk]),
            'every target is in the one event, in the order it was given',
        )
        assert.deepEqual(
            tags.slice(MANY),
            [['p', ALICE, 'wss://alice.example/', 'Alice'], ['p', BOB], ['t', 'bitcoin']],
            'the base is a SUFFIX of the result, column for column: the relay hint and the petname of an '
                + 'already-followed contact survive, and so does the foreign `t` tag. The single-target '
                + 'predecessor re-prepended an existing entry as a bare `["p", hex]` — over a bulk selection that '
                + 'is one stripped petname per already-followed person, in one signed event, invisible on screen.',
        )
    })

    test('CORE: the REQ count does not grow with the number of targets', async () => {
        const secretMany = makeSecret()
        const many = await freshIdentityWithSecret('countmany', secretMany, {
            list: await signList(secretMany, [['p', ALICE]]),
        })
        await many.store.armFollowRead()
        clearWire()
        await many.store.followMany(TARGETS, many.store.listId)
        const forMany = wireFrames()
        const manyAskedAbout = askedAbout()
        assert.equal(written.length, 1, 'PRECONDITION: the many-target write happened')

        const secretOne = makeSecret()
        const one = await freshIdentityWithSecret('countone', secretOne, {
            list: await signList(secretOne, [['p', ALICE]]),
        })
        await one.store.armFollowRead()
        clearWire()
        await one.store.followMany([target(0)], one.store.listId)
        const forOne = wireFrames()
        assert.equal(written.length, 1, 'PRECONDITION: the one-target write happened')

        assert.equal(
            forMany.length,
            forOne.length,
            `${MANY} targets cost ${forMany.length} REQ frames and 1 target costs ${forOne.length}. A bulk follow `
                + 'that reads per person is the naive path: the plan measures 1204 REQ for 400 people over the '
                + 'outbox model against 1 for a flat load, and every one of those round trips carries '
                + '`authors:[self]` to relays the reader did not choose.',
        )
        assert.deepEqual(
            forMany,
            [
                // The reader's own kind 10002, asked of the indexer — one round, and the
                // only one that is about relays rather than about the list.
                { url: INDEXER, kinds: [RELAYS] },
                // The merge base, over the target set.
                { url: FALLBACK, kinds: [FOLLOWS] },
                // The re-read that decides whether the relay meant its `OK` — the same
                // target set, which is why it is not a second relay-list resolution.
                { url: FALLBACK, kinds: [FOLLOWS] },
            ],
            'the frames of a bulk follow, in order — a fourth one is either a relay set drawn twice (F3) or a '
                + 'read that scales with the selection',
        )
        assert.equal(
            forMany.length,
            bulkReqCeiling(1, 0, 1),
            `a bulk follow sent ${forMany.length} REQ frames; for THIS configuration — confirmed-none, so one `
                + 'target (the fallback), no hints beside it, and the kind 10002 still cold — the formula gives '
                + `${bulkReqCeiling(1, 0, 1)}. The „listed" configuration is counted in its own case below.`,
        )
        assert.ok(
            forMany.length <= BULK_REQ_CEILING,
            `a bulk follow sent ${forMany.length} REQ frames, ceiling ${BULK_REQ_CEILING}`,
        )
        assert.deepEqual(
            forMany.filter((req) => req.kinds.includes(0)),
            [],
            'the bulk write path asked for a kind 0. Profiles are the member list\'s business and it loads them '
                + 'flat against the space relay; asking per person here is the 1204-frame shape, arrived at from '
                + 'the other side.',
        )
        // ── Whose data was asked for — the half the frame count cannot say ────
        //
        // Found by a mutation that stayed green: `app.use(Profiles).load(pk)` per target
        // sends its kind-10002 resolution with the TARGET as the author, one frame per
        // pubkey per indexer, unbatchable (`RelayLists.fetch` sets `limit: 1`, and
        // `calculateFilterGroup` gives every filter with a `limit` a random group id, so
        // `unionFilters` never merges them). That is the 1200 of the plan's 1204, and it
        // does not show up as „a kind 0 was asked for" at all, because the profile itself
        // is never reached when no relay list resolves.
        assert.deepEqual(
            manyAskedAbout,
            [many.me],
            `a bulk follow asked about [${manyAskedAbout.length} pubkeys], expected only the reader's own. Every `
                + 'other pubkey in there is a round trip that scales with the selection — and one that tells a '
                + 'foreign relay which 400 people this reader is about to follow.',
        )
    })

    test('CALIBRATION: the recorder does see a kind-0 request when one is made', async () => {
        clearWire()
        await load({ relays: [FALLBACK], filters: [{ kinds: [0], authors: [ALICE, BOB] }] })
        await settle()
        assert.ok(
            requested.some((req) => req.kinds.includes(0)),
            'no kind-0 REQ was recorded for a request that was definitely made — then the absence asserted in the '
                + 'case above says nothing at all, which is the standard way an absence measurement lies',
        )
    })

    test('CORE: armFollowRead reads the list and signs NOTHING', async () => {
        const secret = makeSecret()
        const { store } = await freshIdentityWithSecret('armread', secret, {
            list: await signList(secret, [['p', ALICE], ['p', BOB]]),
        })
        assert.equal(store.listSeen, false, 'PRECONDITION: a confirmed-none reader is not read on a page load (F7)')
        clearWire()

        await store.armFollowRead()

        assert.deepEqual(
            written.map((event: TrustedEvent) => event.kind),
            [],
            'the „Kontaktliste laden" step signed an event. It is offered under a label that promises a read, and '
                + 'a reader who presses it has been shown no direction, no target and no count.',
        )
        assert.equal(store.listSeen, true, 'and the verdict is in — the bulk bar can move on from „Kontaktliste laden"')
        assert.equal(store.noRelayList, true, 'this reader has no kind 10002, and the bar says so')
        assert.deepEqual(store.following, [ALICE, BOB], 'the rendered list is the one the relay showed')
        assert.equal(store.error, '', 'a read that landed reports nothing — the surface mirrors this into bulkError')
    })

    test('CORE: a silent relay leaves listSeen false and the refusal names it', async () => {
        const secret = makeSecret()
        const { store } = await freshIdentityWithSecret('silent', secret, { list: null, silentFollows: true })
        clearWire()

        await store.armFollowRead()

        assert.equal(
            store.listSeen,
            false,
            'a relay that never closed the read left the verdict at „seen". Absence of an `EOSE` is the '
                + 'fail-closed case: a hanging AUTH round swallows it, an offline tab never gets it, and a `CLOSED` '
                + 'ends the request without one.',
        )
        assert.equal(
            store.error,
            'Diese Relais haben die Kontaktliste nicht ausgeliefert: fallback.bulk.invalid. Es wurde nichts geändert.',
            'and the reader is told WHICH relay is silent — a strict refusal without a name is a button that says '
                + 'no forever with nothing to act on',
        )
        assert.deepEqual(written.map((event: TrustedEvent) => event.kind), [], 'nothing was signed')
    })

    test('CORE: followMany on an unseen list reads, refuses, and writes nothing', async () => {
        const secret = makeSecret()
        const { store } = await freshIdentityWithSecret('unseen', secret, {
            list: await signList(secret, [['p', ALICE]]),
        })
        assert.equal(store.listSeen, false, 'PRECONDITION: nothing has been read yet')
        clearWire()

        await store.followMany([target(0), target(1)], store.listId)

        assert.deepEqual(
            written.map((event: TrustedEvent) => event.kind),
            [],
            'a bulk write went out while the list had never been read. The preview above the button counts '
                + '„wächst von X auf Y" off `following`, which is empty until a relay answers — so the reader '
                + 'would have signed against numbers that were never true, and those numbers are the only place '
                + 'the plan gives them to notice an unread base BEFORE the signature.',
        )
        assert.equal(
            store.error,
            'Die Kontaktliste ist jetzt geladen. Bitte noch einmal klicken.',
            'and it says so — an empty error is read as SUCCESS by confirmBulkFollow, which then clears the '
                + 'selection and closes the dialog over a write that never happened',
        )
        assert.equal(store.listSeen, true, 'the click was spent on the read, so the next one is the ordinary one')
    })

    test('CORE: a relay that keeps a SHORTER list is not a confirmed bulk follow', async () => {
        const secret = makeSecret()
        const me = getPubkey(secret)
        // What the relay serves after the write: the first target only. A validly signed,
        // newer event — this is what a replaceable write looks like when the relay took
        // something else, and `OK true` says nothing about it.
        const partial = await signList(secret, [['p', target(0)]], 1_800_000_100)
        const { store } = await freshIdentityWithSecret('partial', secret, {
            list: await signList(secret, []),
            serveAfterWrite: partial,
        })
        assert.equal(me, store.me, 'PRECONDITION: the session is on this identity')
        await store.armFollowRead()
        clearWire()

        await store.followMany([target(0), target(1)], store.listId)

        assert.equal(written.length, 1, 'PRECONDITION: the write went out and the relay answered OK')
        assert.equal(
            store.error,
            'Diese Relais haben die Änderung nicht übernommen: fallback.bulk.invalid.',
            'the relay came back with a list holding the FIRST target and not the second, and the surface called '
                + 'it a success. One event carries all of them, so the confirmation has to be „all of them" — '
                + 'checking one, or `some`, reports 400 follows to a reader who got 1.',
        )
    })

    /**
     * **Armed, and then the relay goes quiet.**
     *
     * Found by a mutation that stayed green: with `if (!answer.answered)` replaced by
     * `if (false)` in the refusal of `followMany`, all nine cases passed — no case reached
     * `planFollowWrite` returning `null` for a read that did not answer. That branch is
     * reachable in production the moment a relay stops answering between the arming read
     * and the confirm click, and without it the reader is told that they already follow
     * everybody they selected — about a relay that said nothing at all.
     *
     * The three causes of a `null` plan are genuinely different and one of them must never
     * borrow another's sentence — that is the whole reason the branch is a three-way and
     * not a ternary.
     */
    test('CORE: a relay that falls silent after arming is named, not mistaken for a no-op', async () => {
        const secret = makeSecret()
        const me = getPubkey(secret)
        const state: Behaviour = { list: await signList(secret, [['p', ALICE]]) }
        const { store } = await freshIdentityWithSecret('wentquiet', secret, state)

        await store.armFollowRead()
        assert.equal(store.listSeen, true, 'PRECONDITION: the list was read once, so the bolt is past')
        // …and now the relay stops closing the read. `behaviour` is keyed by pubkey and
        // read on every REQ, so this is the same relay changing its mind mid-session.
        state.silentFollows = true
        assert.equal(behaviour.get(me)?.silentFollows, true, 'PRECONDITION: the relay is the silent one now')
        clearWire()

        await store.followMany([target(0)], store.listId)

        assert.deepEqual(written.map((event: TrustedEvent) => event.kind), [], 'nothing may be written on a base '
            + 'nobody confirmed — this is the replaceable-kind data loss, and it does not care that an earlier '
            + 'read succeeded')
        assert.equal(
            store.error,
            'Diese Relais haben die Kontaktliste nicht ausgeliefert: fallback.bulk.invalid. Es wurde nichts geändert.',
            'the refusal has to name the silent relay. „Deine Kontaktliste ändert sich nicht" here would be a '
                + 'confident statement about the wrong thing, and the reader would go and check their selection '
                + 'while the fault is a relay.',
        )
    })

    /**
     * **A second call while the first is in flight must not look like a success.**
     *
     * `confirmBulkFollow` reads an empty `store.error` as „it worked": it clears the
     * selection and closes the dialog. So a guard that returns silently is not neutral, it
     * is a false confirmation — and this one is reachable. The profile card opens out of
     * the member list itself, so a single follow started there holds `busy` through up to
     * two relay timeouts while the reader walks back to the bulk bar and confirms.
     *
     * The relay in this case never closes the read, which is what keeps the first call in
     * flight long enough to press the second one — the same shape as a slow relay, only
     * deterministic.
     */
    test('CORE: a bulk follow while the store is busy refuses out loud', async () => {
        const secret = makeSecret()
        const { store } = await freshIdentityWithSecret('busy', secret, { list: null, silentFollows: true })
        clearWire()

        // Not awaited: this is the operation that is still running when the second one
        // arrives. It holds `busy` for READ_TIMEOUT_MS.
        const inFlight = store.armFollowRead()
        assert.equal(store.busy, true, 'PRECONDITION: the first operation holds the store')

        await store.followMany([target(0)], store.listId)

        assert.deepEqual(written.map((event: TrustedEvent) => event.kind), [], 'nothing may be written')
        assert.equal(
            store.error,
            'Es wurde nichts geändert. Bitte gleich noch einmal versuchen.',
            'a silent return here is read as success one line later: the selection is cleared and the dialog '
                + 'closes over a bulk follow that never left the browser',
        )
        await inFlight
    })

    /**
     * **The one guard of this phase that lives in the surface, and the only instrument
     * available for it is the AST.**
     *
     * `confirmBulkFollow` reads an empty `store.error` as success. The counterpart is that
     * a NON-empty one must not leave the frozen preview standing: the three numbers in it
     * („wächst von :von auf :auf") were counted against the contact list as the store held
     * it when the dialog opened, and every refusal `followMany` can produce has moved that
     * list — the first click on an unseen list IS the read, so afterwards `following` is
     * no longer empty. A second press of the confirm button is one keystroke away, and it
     * would sign against numbers that are now false.
     *
     * **What this case can and cannot say.** It pins a SHAPE: that the error branch assigns
     * `null` to `bulkPlan`. It cannot say that the dialog closes or that the reader sees
     * the bar again — that is a browser question and belongs to P6's E2E, where the dialog
     * exists. A shape latch is the weaker instrument and it is named as such rather than
     * dressed up: `js/directoryIsland.ts` is an Alpine island and does not run under
     * `node --test`, which is why `js/followWriteGate.test.ts` reads `bridge.ts` the same
     * way. The file moved on 2026-09-15: the member directory left `bridge.ts` for a
     * module of its own so that its 5 kB gzip stop riding along on every page.
     */
    test('CORE: a refused bulk write voids the frozen preview', () => {
        const source = readFileSync(join(JS_DIR, 'directoryIsland.ts'), 'utf8')
        const tree = ts.createSourceFile('directoryIsland.ts', source, ts.ScriptTarget.Latest, true)
        let method: ts.MethodDeclaration | null = null
        const findMethod = (node: ts.Node): void => {
            if (ts.isMethodDeclaration(node) && node.name.getText() === 'confirmBulkFollow') {
                method = node
            }
            ts.forEachChild(node, findMethod)
        }
        findMethod(tree)
        assert.ok(method, 'directoryIsland.ts has no confirmBulkFollow() method — the bulk write has no call site at all.')

        let branch: ts.Statement | null = null
        const findBranch = (node: ts.Node): void => {
            if (ts.isIfStatement(node) && node.expression.getText() === 'follows.error') {
                branch = node.thenStatement
            }
            ts.forEachChild(node, findBranch)
        }
        findBranch(method)
        assert.ok(
            branch,
            'confirmBulkFollow() no longer branches on `follows.error`. Then a refused write — a silent relay, an '
                + 'unread list, a relay that kept a shorter copy — is indistinguishable from a successful one, and '
                + 'the surface clears the selection over it.',
        )

        const voided: string[] = []
        const findVoid = (node: ts.Node): void => {
            if (
                ts.isBinaryExpression(node)
                && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
                && node.left.getText().endsWith('.bulkPlan')
            ) {
                voided.push(node.right.getText())
            }
            ts.forEachChild(node, findVoid)
        }
        findVoid(branch)
        assert.deepEqual(
            voided,
            ['null'],
            `the error branch of confirmBulkFollow() assigns [${voided.join(' | ')}] to bulkPlan, expected [null]. `
                + 'Leaving the plan standing after a refusal puts a second click one keystroke away from signing '
                + 'against „wächst von 0 auf 400" while the list that was finally read holds 703.',
        )
    })

    /**
     * **The same count on the OTHER configuration — the reviewer's finding of this round.**
     *
     * Everything above runs `confirmed-none`: nobody in this file has a kind 10002, so the
     * target set is the one fallback relay and the hint set is empty. That is one of the two
     * shapes this path has, and the ceiling of 4 was measured on it alone.
     *
     * A `listed` reader is the other one, and it is the one that matters most: the targets
     * are then the relays the outbox model points every other client at. The set is bigger
     * (two declared relays here), `readOwnFollowList` asks the hint relays beside them, and
     * the re-read after the write goes to every target again — five frames, not three.
     *
     * **What must hold is the same sentence as above, and it is the load-bearing half: the
     * count does not depend on n.** The code batches over the relay set, never over people,
     * so 400 targets and 1 target produce the identical frames. The F1 repair of this round
     * adds nothing here — the locally held list is a candidate in the comparison, not a read.
     */
    test('CORE: the REQ count does not grow with n on the `listed` path either', async () => {
        const secretMany = makeSecret()
        const many = await freshIdentityWithSecret('listedmany', secretMany, {
            list: await signList(secretMany, [['p', ALICE]]),
            relayList: await signRelayList(secretMany, [OUT1, OUT2]),
        })
        await many.store.armFollowRead()
        assert.equal(many.store.noRelayList, false, 'PRECONDITION: this reader IS listed — they declared two relays')
        clearWire()
        await many.store.followMany(TARGETS, many.store.listId)
        const forMany = wireFrames()
        const manyAskedAbout = askedAbout()
        assert.equal(
            new Set(written.map((event: TrustedEvent) => event.id)).size,
            1,
            'PRECONDITION: the many-target write happened, and it is ONE event — two EVENT frames here are the '
                + 'same signed event spread over two relays, which is what a declared write set is for',
        )
        assert.deepEqual(
            [...new Set(writtenTo)].sort(),
            [OUT1, OUT2],
            'and it went to the DECLARED relays — on this path the target set is the outbox, not the fallback',
        )

        const secretOne = makeSecret()
        const one = await freshIdentityWithSecret('listedone', secretOne, {
            list: await signList(secretOne, [['p', ALICE]]),
            relayList: await signRelayList(secretOne, [OUT1, OUT2]),
        })
        await one.store.armFollowRead()
        clearWire()
        await one.store.followMany([target(0)], one.store.listId)
        const forOne = wireFrames()
        assert.equal(
            new Set(written.map((event: TrustedEvent) => event.id)).size,
            1,
            'PRECONDITION: the one-target write happened',
        )

        assert.equal(
            forMany.length,
            forOne.length,
            `on the listed path ${MANY} targets cost ${forMany.length} REQ frames and 1 target costs `
                + `${forOne.length}. The selection must not appear in the count on either configuration.`,
        )
        assert.deepEqual(
            forMany,
            [
                // The merge base, over the declared write relays — one REQ each.
                { url: OUT1, kinds: [FOLLOWS] },
                { url: OUT2, kinds: [FOLLOWS] },
                // The read-only hint, which is the default set minus the targets (F6).
                { url: FALLBACK, kinds: [FOLLOWS] },
                // The re-read that checks the `OK`, over the targets and only them.
                { url: OUT1, kinds: [FOLLOWS] },
                { url: OUT2, kinds: [FOLLOWS] },
            ],
            'the frames of a bulk follow for a listed reader, in order. The kind 10002 is not among them because '
                + 'the arming read resolved it and a `listed` verdict is kept for the session (listedRelayCache); '
                + 'a frame for it here would mean that cache is gone, which is three indexer requests immediately '
                + 'before every contact-list write.',
        )
        assert.equal(
            forMany.length,
            bulkReqCeiling(2, 1, 0),
            `a listed bulk follow sent ${forMany.length} REQ frames; two declared relays, one hint beside them and `
                + `a warm relay-list verdict give ${bulkReqCeiling(2, 1, 0)}. This is the number the ceiling of 4 `
                + 'did not cover — it is a ceiling for the confirmed-none configuration, not for the path.',
        )
        assert.deepEqual(
            manyAskedAbout,
            [many.me],
            `a listed bulk follow asked about [${manyAskedAbout.length} pubkeys], expected only the reader's own.`,
        )
    })

    /**
     * **F1, the surface half: the preview freezes the base, and the write is measured
     * against the FROZEN one.**
     *
     * The store refuses a plan built on a base other than the one it was handed — but only
     * if what it is handed is the base the reader was SHOWN. `follows.listId` read at submit
     * time is the store's current answer, so passing that would compare the base with
     * itself and the whole binding would be a no-op that looks exactly like the repair.
     *
     * Same instrument and same limits as the case above: `js/directoryIsland.ts` is an
     * Alpine island and does not run under `node --test`, so this pins a SHAPE. What it
     * cannot say is that the dialog shows the right numbers — that is P6's E2E.
     */
    test('CORE: the write is bound to the base the preview froze, not to the live one', () => {
        const source = readFileSync(join(JS_DIR, 'directoryIsland.ts'), 'utf8')
        const tree = ts.createSourceFile('directoryIsland.ts', source, ts.ScriptTarget.Latest, true)
        const methods = new Map<string, ts.MethodDeclaration>()
        const findMethods = (node: ts.Node): void => {
            if (ts.isMethodDeclaration(node)) {
                methods.set(node.name.getText(), node)
            }
            ts.forEachChild(node, findMethods)
        }
        findMethods(tree)

        const preview = methods.get('openBulkPreview')
        assert.ok(preview, 'directoryIsland.ts has no openBulkPreview() — nothing freezes anything.')
        const frozen: string[] = []
        const findBindings = (node: ts.Node): void => {
            if (ts.isVariableDeclaration(node) && node.name.getText() === 'base' && node.initializer) {
                frozen.push(node.initializer.getText())
            }
            ts.forEachChild(node, findBindings)
        }
        findBindings(preview)
        assert.deepEqual(
            frozen,
            ['follows.listId'],
            `openBulkPreview() freezes [${frozen.join(' | ')}] as the base, expected [follows.listId]. That field `
                + 'is the id of the event `following` was rendered from, and it is the only thing that can say '
                + 'WHICH list the three numbers were counted against — `from` says 703 and not which 703.',
        )
        const plans: string[] = []
        const findPlan = (node: ts.Node): void => {
            if (
                ts.isBinaryExpression(node)
                && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
                && node.left.getText().endsWith('.bulkPlan')
                && ts.isObjectLiteralExpression(node.right)
            ) {
                plans.push(node.right.getText())
            }
            ts.forEachChild(node, findPlan)
        }
        findPlan(preview)
        assert.equal(plans.length, 1, 'openBulkPreview() no longer assigns a frozen plan object.')
        assert.ok(
            /\bbase\b/.test(plans[0] ?? ''),
            `the frozen plan is ${plans[0]}, and it does not carry the base. Then the write has nothing to be `
                + 'measured against and the preview is decoration.',
        )

        const confirm = methods.get('confirmBulkFollow')
        assert.ok(confirm, 'directoryIsland.ts has no confirmBulkFollow() — the bulk write has no call site.')
        const calls: string[][] = []
        const findCalls = (node: ts.Node): void => {
            if (ts.isCallExpression(node) && node.expression.getText().endsWith('.followMany')) {
                calls.push(node.arguments.map((argument: ts.Expression) => argument.getText()))
            }
            ts.forEachChild(node, findCalls)
        }
        findCalls(confirm)
        assert.deepEqual(
            calls,
            [['targets', 'shownBase']],
            `confirmBulkFollow() calls followMany with [${calls.map((c) => c.join(', ')).join(' | ')}]. It has to `
                + 'hand over both the frozen selection and the frozen base — a call with one argument leaves '
                + '`shownBase` undefined, which the gate refuses (fail-closed, but every bulk follow then fails).',
        )
        const bound: string[] = []
        const findBase = (node: ts.Node): void => {
            if (ts.isVariableDeclaration(node) && node.name.getText() === 'shownBase' && node.initializer) {
                bound.push(node.initializer.getText())
            }
            ts.forEachChild(node, findBase)
        }
        findBase(confirm)
        assert.deepEqual(
            bound,
            ['plan.base'],
            `confirmBulkFollow() takes its base from [${bound.join(' | ')}], expected [plan.base]. Reading `
                + '`follows.listId` here compares the store with itself: the numbers the reader confirmed came '
                + 'from the frozen plan, and so must the base.',
        )
        // Asked of the AST and not of the text, because the comment in that method NAMES the
        // live field in order to rule it out — a text match would be red for the sentence
        // that explains the rule.
        const liveReads: string[] = []
        const findLive = (node: ts.Node): void => {
            if (ts.isPropertyAccessExpression(node) && node.name.getText() === 'listId') {
                liveReads.push(node.getText())
            }
            ts.forEachChild(node, findLive)
        }
        findLive(confirm)
        assert.deepEqual(
            liveReads,
            [],
            `confirmBulkFollow() reads [${liveReads.join(' | ')}]. The live field at submit time is the store's `
                + 'current answer — the very thing the frozen base exists to be compared against.',
        )
    })

    /**
     * **F3, the surface half: three methods, one question.**
     *
     * „May the reader press „Kontaktliste laden"" is asked by the hint, by the label and by
     * the disabled state, and the third one is what makes the difference between a button
     * that invites a retry and one that is inert. Three copies of the condition is how one
     * of them stays behind — the state this repairs is exactly that shape: the label said
     * „Lädt…" forever while the store had long given up.
     */
    test('CORE: the bulk bar asks ONE predicate whether the list can still be loaded', () => {
        const source = readFileSync(join(JS_DIR, 'directoryIsland.ts'), 'utf8')
        const tree = ts.createSourceFile('directoryIsland.ts', source, ts.ScriptTarget.Latest, true)
        const methods = new Map<string, ts.MethodDeclaration>()
        const findMethods = (node: ts.Node): void => {
            if (ts.isMethodDeclaration(node)) {
                methods.set(node.name.getText(), node)
            }
            ts.forEachChild(node, findMethods)
        }
        findMethods(tree)

        for (const name of ['bulkHint', 'bulkPrimaryLabel', 'bulkPrimaryBlocked']) {
            const method = methods.get(name)
            assert.ok(method, `directoryIsland.ts has no ${name}() — the bulk bar lost one of its three states.`)
            const calls: string[] = []
            const findCalls = (node: ts.Node): void => {
                if (ts.isCallExpression(node) && node.expression.getText() === 'canLoadContactList') {
                    calls.push(node.getText())
                }
                ts.forEachChild(node, findCalls)
            }
            findCalls(method)
            assert.equal(
                calls.length,
                1,
                `${name}() asks canLoadContactList() ${calls.length}x, expected once. Asking noRelayList alone `
                    + 'is the state this repairs: a listed reader whose declared relay never closes the read is '
                    + 'left with „Lädt…" for the session — no relay name, no error, no retry.',
            )
        }

        const predicate = source.slice(source.indexOf('const canLoadContactList'))
        assert.ok(
            /noRelayList/.test(predicate.slice(0, 200)) && /listReadFailed/.test(predicate.slice(0, 200)),
            'canLoadContactList() no longer reads both reasons. `noRelayList` is the reader who is deliberately '
                + 'not read on a page load (P2/D8); `listReadFailed` is the reader whose read was attempted and '
                + 'did not land. Dropping either one makes the bar inert for that group.',
        )
    })

    test('CORE: a selection that changes nothing is refused out loud, not silently', async () => {
        const secret = makeSecret()
        const { store } = await freshIdentityWithSecret('noop', secret, {
            list: await signList(secret, [['p', target(0)], ['p', target(1)]]),
        })
        await store.armFollowRead()
        clearWire()

        await store.followMany([target(0), target(1)], store.listId)

        assert.deepEqual(
            written.map((event: TrustedEvent) => event.kind),
            [],
            'a signed event that changes nothing — a replaceable write with a fresh `created_at` and the same '
                + 'content, which on a relay that resolves ties by id is a coin flip against the copy that is '
                + 'already there',
        )
        assert.equal(
            store.error,
            'Deine Kontaktliste ändert sich nicht — du folgst allen Ausgewählten schon.',
            'and the reason is on screen. Silence here is worse than an error: `confirmBulkFollow` treats an empty '
                + '`error` as success, clears the selection and closes the dialog.',
        )
    })
})

/**
 * A fresh identity with a fresh store on a fresh space url.
 *
 * Wired BEFORE the login, like `js/followClickGate.test.ts`: `armedFor` is one
 * module-level key, and a store that is wired after an identity is already active never
 * receives an arming answer. None of the cases here depend on the arming pass — they drive
 * `armFollowRead()` or `followMany()` directly — but the precondition each of them asserts
 * (`listSeen === false`) has to be the honest starting state and not an accident.
 *
 * The secret is supplied by the caller rather than generated here, so a case can sign the
 * list the relay will serve for that identity before the store exists.
 */
async function freshIdentityWithSecret(
    label: string,
    secret: string,
    state: Behaviour,
): Promise<{ store: FollowsStore; me: string }> {
    const me = getPubkey(secret)
    behaviour.set(me, state)
    const spaceUrl = `wss://${label}.bulk.invalid/`
    app.use(Relays).set(spaceUrl, new Relay(spaceUrl, { software: 'https://github.com/coracle-social/zooid' }))
    activeSpaceUrl.set(spaceUrl)
    const alpine: Record<string, unknown> = {}
    wireFollows({
        store: (name: string, value?: unknown): unknown => {
            if (value !== undefined) {
                alpine[name] = value
            }

            return alpine[name]
        },
    })
    loginWithNip01(secret)
    await settle()

    return { store: alpine.follows as FollowsStore, me }
}
