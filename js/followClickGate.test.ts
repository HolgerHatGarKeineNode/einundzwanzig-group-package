/**
 * **The first click on an unseen contact list reads; it never writes — asserted through
 * the real store, against a relay that answers.**
 *   node --test --experimental-strip-types packages/einundzwanzig-group/js/followClickGate.test.ts
 *
 * ── Why this file exists ───────────────────────────────────────────────────────
 *
 * The bolt is one line in `js/follows.ts`:
 *
 *     const seenBefore = self.listSeen
 *     self.listSeen = self.listSeen || answer.answered
 *     …
 *     if (!seenBefore) { self.error = …; return }
 *
 * It has stood since P1 and **nothing held it**: the audit set the condition to
 * `if (false)` and the whole follow suite stayed green at 119/119. What is lost without it
 * is not a relay write to the wrong set — `planFollowWrite` still demands `answered` — but
 * the truthfulness of the LABEL. While `listSeen` is false the button reads
 * „Kontaktliste store", and a click on that label must not sign a follow or an unfollow:
 * the markup never told the user which of the two it would be.
 *
 * ── Why a behaviour test and not a source latch ────────────────────────────────
 *
 * Because the same round retired a source walk that had been bypassed four times (see
 * `FollowTargetSet` in `js/followModels.ts`). A latch here would pin the shape of an `if`;
 * this file asks the store what it DID — how many events reached the relay, and which
 * sentence the card showed. The seam is `app.netContext.getAdapter`, the same one
 * `js/privateMessagesView.test.ts` and `js/reminderDelivery.test.ts` use: a `MockAdapter`
 * that answers the REQs and records every EVENT frame.
 *
 * The second case is the positive control and it is not decoration: a store that never
 * writes at all passes the first case perfectly.
 */
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import type { AbstractAdapter, ClientMessage, MockAdapter as MockAdapterType } from '@welshman/net'
import type { Filter, TrustedEvent } from '@welshman/util'
import type { FollowsStore } from './follows.ts'

const INDEXER = 'wss://indexer.click.invalid/'
const FALLBACK = 'wss://fallback.click.invalid/'
const SPACE = 'wss://space.click.invalid/'

// Before ANY import of the module graph: `js/relayConfig.ts` reads this once, at load.
// Without it `DEFAULT_RELAYS` is empty outside a browser and the target set would be
// empty too — the case would then measure the vacuous-set guard instead of the bolt.
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
const { MockAdapter } = await import('@welshman/net')
const { Relay } = await import('@welshman/domain')
const { FOLLOWS } = await import('./followModels.ts')
const { RELAYS } = await import('./welshmanKinds.ts')
const { makeEvent, makeSecret, getPubkey } = await import('@welshman/util')
const { Nip01Signer } = await import('@welshman/signer')

const SECRET = makeSecret()
const ME = getPubkey(SECRET)
const SIGNER = Nip01Signer.fromSecret(SECRET)
/** A second identity for the `listed` case, so no test depends on running after another. */
const SECRET_2 = makeSecret()
const ME_2 = getPubkey(SECRET_2)
const SIGNER_2 = Nip01Signer.fromSecret(SECRET_2)
const ALICE = 'b'.repeat(64)
const BOB = 'c'.repeat(64)
const OUTBOX = 'wss://outbox.click.invalid/'

/**
 * The kind 3 the relays serve — replaced by whatever gets published, like a real relay.
 *
 * Really signed, because `@welshman/net` runs `isEventValid` on every received event
 * before it reaches the caller: a hand-built object would be dropped silently and the read
 * would come back empty with an `EOSE`, which is the one shape this module must never
 * mistake for an answer.
 */
let servedList: TrustedEvent = await SIGNER.sign(
    makeEvent(FOLLOWS, { created_at: 1_800_000_000, tags: [['p', ALICE], ['p', BOB], ['t', 'bitcoin']], content: '' }),
) as unknown as TrustedEvent

/**
 * The second reader's own NIP-65 list, naming {@link OUTBOX} as their write relay.
 *
 * Served only to the second identity, so the two situations under test — „no relay list
 * anywhere" and „a relay list that resolves" — cannot interfere through the module-level
 * `listedRelayCache`, which is keyed by pubkey.
 */
const relayList2: TrustedEvent = await SIGNER_2.sign(
    makeEvent(RELAYS, { created_at: 1_800_000_000, tags: [['r', OUTBOX]], content: '' }),
) as unknown as TrustedEvent

/** The second reader's contact list, on their own relay. */
let servedList2: TrustedEvent = await SIGNER_2.sign(
    makeEvent(FOLLOWS, { created_at: 1_800_000_000, tags: [['p', ALICE]], content: '' }),
) as unknown as TrustedEvent

/** Every EVENT frame that reached a relay, with the relay it went to. */
const written: TrustedEvent[] = []
/** The relay urls the writes went to, in order — the D2/outbox half of the measurement. */
const writtenTo: string[] = []
/**
 * **Every REQ this client sent, with the relay it went to and the kinds it asked for.**
 *
 * Finding S4: without this the file recorded EVENT frames only, and a review used exactly
 * that gap — it widened the target set inside the ARMING pass, where nothing is ever
 * written, and the three cases here stayed green while the production effect was the whole
 * of F7 coming back: `{kinds:[3],authors:[self]}` to four foreign relays on every page
 * view, with AUTH granted to them in `js/relayConfig.ts`. A read is traffic too, and
 * traffic is what a reader pays for in de-anonymisation.
 */
const requested: { url: string; kinds: number[] }[] = []

/** The kind-3 reads, as the relay urls they went to. */
const contactListReadsTo = (): string[] =>
    requested.filter((req) => req.kinds.includes(FOLLOWS)).map((req) => req.url)

/** The kind-10002 reads, as the relay urls they went to. */
const relayListReadsTo = (): string[] =>
    requested.filter((req) => req.kinds.includes(RELAYS)).map((req) => req.url)

/**
 * A relay that serves the current kind 3 and has no kind 10002 for anybody.
 *
 * No relay list is deliberate: it puts {@link OutboxKnowledge} at `confirmed-none`, which
 * is the state in which the arming pass defers the read (F7) — so `listSeen` is still
 * false when the first click arrives, which is exactly the situation under test.
 */
const makeAdapter = (url: string): MockAdapterType => {
    const adapter: MockAdapterType = new MockAdapter(url, (message: ClientMessage) => {
        if (message[0] === 'REQ') {
            const subId = message[1] as string
            const filters = message.slice(2) as Filter[]
            for (const filter of filters) {
                requested.push({ url, kinds: [...(filter.kinds ?? [])] })
            }
            setTimeout(() => {
                for (const filter of filters) {
                    const forSecond = filter.authors?.includes(ME_2) ?? false
                    if (filter.kinds?.includes(RELAYS) && forSecond) {
                        // Only the second reader has one — D2's positive control: this
                        // event has to survive a read that runs WITHOUT the repository.
                        adapter.receive(['EVENT', subId, relayList2])
                    }
                    if (filter.kinds?.includes(FOLLOWS)) {
                        adapter.receive(['EVENT', subId, forSecond ? servedList2 : servedList])
                    }
                }
                adapter.receive(['EOSE', subId])
            }, 0)

            return
        }
        if (message[0] === 'EVENT') {
            const event = message[1] as TrustedEvent
            written.push(event)
            writtenTo.push(url)
            if (event.pubkey === ME_2) {
                servedList2 = event
            } else {
                servedList = event
            }
            setTimeout(() => adapter.receive(['OK', event.id, true, '']), 0)
        }
    })

    return adapter
}

const settle = (ms = 300): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * A fresh store on a fresh space url.
 *
 * **`secret` exists because arming is guarded by a MODULE-level key** (`armedFor`, one per
 * url+pubkey). Every store wired earlier in this file is still subscribed to `activeSpace`
 * and `pubkey`, and they react first — so a store created after them finds the key for its
 * own url already taken and never receives an arming answer. Passing a fresh identity and
 * logging in AFTER the store is wired gives it a key nobody else can hold. Measured: without
 * this the third case saw `listSeen === false` for 3.6 s while a hand-run
 * `readOwnRelayList` resolved `listed` in 9 ms.
 */
const freshStore = async (spaceUrl: string, secret?: string): Promise<FollowsStore> => {
    // A NIP-11 doc by hand, same seam as `js/privateMessagesView.test.ts`: without it
    // `deriveSpaceKind` answers `'unknown'`, `mayWriteKind` denies, and the write case
    // would measure the capability gate instead of the bolt.
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
    if (secret) {
        loginWithNip01(secret)
    }
    await settle()

    return alpine.follows as FollowsStore
}

describe('the first click reads, the second writes — measured at the relay', () => {
    const originalGetAdapter = app.netContext.getAdapter

    before(async () => {
        app.netContext.getAdapter = (url: string): AbstractAdapter => makeAdapter(url)
        loginWithNip01(SECRET)
        await settle()
    })

    after(() => {
        app.netContext.getAdapter = originalGetAdapter
        for (const url of [INDEXER, FALLBACK, SPACE, 'wss://second.click.invalid/']) {
            app.pool.remove(url)
        }
    })

    test('CORE: a click while the list is unseen writes NOTHING and says so', async () => {
        requested.length = 0
        const store = await freshStore(SPACE)
        assert.equal(store.listSeen, false, 'CALIBRATION: without a kind 10002 the arming pass defers (F7)')

        // ── S4: F7 measured at the wire, not in the source ────────────────────
        //
        // The page load is over at this point. A `confirmed-none` reader must not have had
        // their contact list asked for anywhere: that request carries `authors:[self]` to
        // relays they never chose, and `js/relayConfig.ts` grants those relays AUTH.
        assert.deepEqual(
            contactListReadsTo(),
            [],
            'the arming pass asked for the contact list. For a reader with no relay list that is a '
                + '`{kinds:[3],authors:[self]}` to four foreign relays on every page view, with AUTH — F7, back '
                + 'again. No source instrument is needed to see it: it is traffic.',
        )
        // And the pass DID run — otherwise the assertion above is true for the wrong
        // reason, which is the failure mode of every absence measurement.
        assert.deepEqual(
            [...new Set(relayListReadsTo())],
            [INDEXER],
            'CALIBRATION: the arming pass has to have asked the indexer for a kind 10002. If it asked nothing at '
                + 'all, the emptiness above says nothing about F7.',
        )
        written.length = 0
        requested.length = 0

        await store.toggle(ALICE)

        assert.deepEqual(
            written.map((event: TrustedEvent) => event.kind),
            [],
            'a click on a button labelled „Kontaktliste store" signed an event. The label never said which '
                + 'direction it would go, so whatever was signed is a decision the user was not shown.',
        )
        assert.equal(
            store.error,
            'Die Kontaktliste ist jetzt geladen. Bitte noch einmal klicken.',
            'and the card has to say that the click was consumed by the read, or a button that did nothing '
                + 'visible is indistinguishable from a broken one',
        )
        assert.equal(store.listSeen, true, 'the read did land — the next click is the ordinary one')
        assert.deepEqual(store.following, [ALICE, BOB], 'and the list the relay showed is what the card renders')
        assert.deepEqual(
            [...new Set(contactListReadsTo())],
            [FALLBACK],
            'the click read the contact list from the target set and from nowhere else — for this reader the '
                + 'hints ARE the targets, so anything beyond that url is a set that grew on the way',
        )
    })

    test('CALIBRATION: the SECOND click writes, and writes the read list plus one', async () => {
        const store = await freshStore('wss://second.click.invalid/')
        await store.toggle(ALICE)
        assert.equal(store.listSeen, true, 'the first click did the read')
        written.length = 0

        // ALICE is already followed, so this one is the unfollow — the direction comes
        // from the list the relay showed, not from a cache.
        await store.toggle(ALICE)

        assert.equal(written.length, 1, 'exactly one event, and it is the second click that produced it')
        assert.equal(written[0]?.kind, FOLLOWS)
        assert.equal(written[0]?.pubkey, ME, 'signed by the reader, on the key the session holds')
        assert.deepEqual(
            written[0]?.tags,
            [['p', BOB], ['t', 'bitcoin']],
            'the real list minus one entry — the base came from the relay, and the non-`p` tag survived',
        )
        assert.deepEqual([...new Set(writtenTo)], [FALLBACK], 'and it went to the fallback set, which is the '
            + 'target set for a reader with no relay list of their own')
    })

    /**
     * **D2's positive control: a kind 10002 read WITHOUT the repository still finds one.**
     *
     * The mutation probe shows the latch going red when the relay-list read is put back on
     * the app context. It cannot show the other direction — that taking the repository out
     * did not simply kill the read. A context is easy to break in a way that produces the
     * same empty-plus-`EOSE` shape the change was made to prevent, and `confirmed-none`
     * looks exactly like a working `confirmed-none`.
     *
     * So: a reader who HAS a NIP-65 list, served over that context, has to end up writing
     * to the relay it names — and to nothing else.
     *
     * **This case says nothing about the ARMING pass, and not because arming is out of
     * reach here.** An earlier version of this docblock claimed that; a review measured
     * `arming=true knowledge=listed` inside this very process and disproved it. What is
     * true is narrower: arming runs beside the cases, started by a store subscription, and
     * several stores share one recorder — so a url in the record cannot be attributed to a
     * particular pass, and „these relays and no others at page load" is not a sentence this
     * file can say. `js/followArmingGate.test.ts` says it, in its own process with one
     * store. (`armedFor` is one module-level key and the earlier stores hold it, which is
     * why this case clicks twice instead of waiting for a pre-load; that is a property of
     * the harness, not of the code.)
     *
     * **What this case DOES say since T3 is the read set.** Until then it asserted only
     * what was written, and that was a measured hole: a widening of the contact-list READ
     * set on the click path passed the type, the census, this file and the arming file
     * alike. The auditor's positive control was `["wss://outbox.click.invalid/",
     * "wss://indexer.click.invalid/"]` — 3/3 green in both wire files.
     */
    test('CALIBRATION: a reader WITH a kind 10002 writes to their own relay, not to the fallback', async () => {
        const store = await freshStore('wss://outbox-space.click.invalid/', SECRET_2)
        await store.toggle(BOB)
        assert.equal(store.listSeen, true, 'the first click did the read')
        assert.equal(store.noRelayList, false, 'and the card says nothing about a missing outbox — this reader has one')
        written.length = 0
        writtenTo.length = 0
        // The record is cleared here too, so the read-set equality below is about THIS
        // click and not about everything the file has done so far.
        requested.length = 0

        await store.toggle(BOB)

        assert.equal(written.length, 1, 'the click wrote, so the relay-list read really did resolve')
        assert.deepEqual(
            written[0]?.tags,
            // Newest first — `withFollowedPubkey` prepends. TWO entries is the load-bearing
            // part: a read that came back empty would have produced exactly `[['p', BOB]]`,
            // which is the stub this whole phase is about.
            [['p', BOB], ['p', ALICE]],
            'the base is the list that came back over the repository-free context, not an empty one',
        )
        assert.deepEqual(
            [...new Set(writtenTo)],
            [OUTBOX],
            'and it went to the relay the reader announced — the outbox branch, end to end',
        )
        // T3 — the READ set, as an equality and not as a containment. For a `listed`
        // reader the two legitimate sources are the declared relay (target) and the
        // default set (read-only hints, F6); anything beyond those two is a set that grew
        // on the way, and the write path follows the read path.
        assert.deepEqual(
            [...new Set(contactListReadsTo())].sort(),
            [FALLBACK, OUTBOX].sort(),
            'the click asked for the contact list somewhere other than the declared relay and the read-only '
                + 'hints. A widened read set is the same edit as a widened write set one step earlier — it '
                + 'passes the brand (an intersection keeps it), it passes the census (no assertion), and it '
                + 'passes the arming file (which measures a page load). This equality is where it stops.',
        )
    })
})
