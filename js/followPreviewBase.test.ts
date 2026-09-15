/**
 * **F1: the list the preview counted is the list that gets signed — or nothing is.**
 *   node --test --experimental-strip-types packages/einundzwanzig-group/js/followPreviewBase.test.ts
 *
 * ── The damage this file exists for, as it was measured ───────────────────────
 *
 * `openBulkPreview()` freezes `from` off the list the store holds. `followMany()` then
 * reads the relays again and plans against **that** answer, and until this round nothing
 * compared the two. The trigger is not an attacker: one relay not answering inside the
 * six-second window while the reader looks at the dialog.
 *
 * Measured on `6565549` (`js/f1repro.test.ts` in the scratchpad of that round, the three
 * cases below with the numbers inverted):
 *
 * | case | setup | trigger | preview said | event written |
 * |---|---|---|---|---|
 * | C2 | outbox holds an old 400-entry copy, the current 703 on a hint relay | the hint relay misses one window | 703 → 706 | **403 tags** |
 * | C3 | as C2 | none | 703 → 706 | 706 tags |
 * | B1 | the outbox holds the 703 | it answers `EOSE` without the event | 703 → 706 | **3 tags**, `content` wiped |
 *
 * `store.error` stayed `''` in all three, and `confirmBulkFollow` reads `''` as success:
 * selection cleared, dialog closed. A replaceable kind 3 with a fresh `created_at` on the
 * reader's own declared write relays. No undo.
 *
 * ── The two halves, and why both are here ─────────────────────────────────────
 *
 *  1. **The locally held list joins the NIP-01 comparison as a voiceless source.** That is
 *     what keeps C2 and B1 from happening at all — a relay dropping out can no longer move
 *     the base backwards. The precedent is `readOwnRelayList`, which does exactly this for
 *     kind 10002.
 *  2. **The base that was counted binds the write.** A base can still move FORWARD — another
 *     device writes, a relay serves something newer — and then the numbers on screen are
 *     stale. B2 below is that case, and it is the one half 1 cannot cover: a newer but
 *     SHORTER list wins the comparison by NIP-01, correctly, and the preview still said 706.
 *
 * ── This file drives the `listed` path ────────────────────────────────────────
 *
 * Every reader here serves a kind 10002, so the targets are their declared write relays and
 * the hints are the public defaults — the configuration `js/followBulkWire.test.ts` does not
 * have (everything there is `confirmed-none`). That is deliberate: on `listed` the targets
 * are the relays the outbox model points every other client at, so a short list written
 * there is the reader's contact list for the world.
 */
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import type { AbstractAdapter, ClientMessage, MockAdapter as MockAdapterType } from '@welshman/net'
import type { Filter, TrustedEvent } from '@welshman/util'
import type { FollowsStore } from './follows.ts'

const INDEXER = 'wss://indexer.base.invalid/'
const OUTBOX = 'wss://outbox.base.invalid/'
const HINT = 'wss://hint.base.invalid/'

// Before ANY import of the module graph — `js/relayConfig.ts` reads this once, at load.
;(globalThis as { __nostrRelays?: unknown }).__nostrRelays = {
    indexer: [INDEXER],
    default: [HINT],
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

/** A pubkey-shaped constant that is nobody's key. */
const person = (i: number): string => (i + 1).toString(16).padStart(64, '0')

/** What one relay does, for the one identity of the case that is running. */
type RelayState = {
    /** The kind 3 it serves, `null` for „answers the read with an `EOSE` and no event". */
    follows?: TrustedEvent | null
    /** The kind 10002 it serves. */
    relayList?: TrustedEvent | null
    /** Never close a kind-3 read — the fail-closed case, and the trigger of C2. */
    silentFollows?: boolean
    /** Take the write, answer `OK true`, and go on serving what it served before. */
    keepOnWrite?: boolean
    /** Take the write, answer `OK true`, and serve nothing at all afterwards. */
    emptyAfterWrite?: boolean
}
let world: Record<string, RelayState> = {}

const written: TrustedEvent[] = []
/** Every REQ frame, so a case can prove that a read it is waiting for actually happened. */
const requested: { url: string; kinds: number[] }[] = []
const clearWire = (): void => {
    written.length = 0
    requested.length = 0
}

/**
 * **Every event reaches the client the way a socket delivers it: parsed from text.**
 *
 * `nostr-tools` caches the outcome of a verification on the object itself
 * (`verifiedSymbol`), and `verifyEvent` short-circuits on it. A mock that hands the SAME
 * object to two reads therefore skips the check on the second — and a probe built by
 * spreading a real event carries the symbol along and is not a forgery at all. The round
 * trip costs nothing here and keeps the harness honest about what the wire does.
 */
const asDelivered = (event: TrustedEvent): TrustedEvent => JSON.parse(JSON.stringify(event)) as TrustedEvent

const makeAdapter = (url: string): MockAdapterType => {
    const adapter: MockAdapterType = new MockAdapter(url, (message: ClientMessage) => {
        if (message[0] === 'REQ') {
            const subId = message[1] as string
            const filters = message.slice(2) as Filter[]
            for (const filter of filters) {
                requested.push({ url, kinds: [...(filter.kinds ?? [])] })
            }
            setTimeout(() => {
                let hold = false
                const state = world[url] ?? {}
                for (const filter of filters) {
                    if (filter.kinds?.includes(RELAYS)) {
                        if (state.relayList) {
                            adapter.receive(['EVENT', subId, asDelivered(state.relayList)])
                        }
                        continue
                    }
                    if (filter.kinds?.includes(FOLLOWS)) {
                        if (state.silentFollows) {
                            hold = true
                            continue
                        }
                        if (state.follows) {
                            adapter.receive(['EVENT', subId, asDelivered(state.follows)])
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
            const state = world[url]
            if (state?.emptyAfterWrite) {
                state.follows = null
            } else if (state && !state.keepOnWrite) {
                state.follows = event
            }
            setTimeout(() => adapter.receive(['OK', event.id, true, '']), 0)
        }
    })

    return adapter
}

const settle = (ms = 300): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Wait for a condition, up to `deadline`, and report whether it came true.
 *
 * A fixed `settle(7_000)` was the first form and it was a flake waiting to happen: the arming
 * read is `READ_TIMEOUT_MS` (6 s) plus whatever the relay-list round costs, and in a file
 * where the previous case left a six-second read pending the sum lands very close to the
 * sleep. The deadline says what the assertion means — „within this long", not „at this
 * moment" — and the case is still red if the field never moves.
 */
const waitUntil = async (predicate: () => boolean, deadline = 15_000): Promise<number> => {
    const started = Date.now()
    while (Date.now() - started < deadline) {
        if (predicate()) {
            return Date.now() - started
        }
        await settle(100)
    }

    return -1
}

/**
 * A really signed kind 3 — `@welshman/net` verifies every event it receives.
 *
 * **Every `created_at` in this file is in the past**, and that is not decoration: the event
 * a write produces is stamped `now` by `makeEvent`, and `adoptReadList` takes it only if it
 * wins the NIP-01 comparison against the list already held. Fixtures dated in the future
 * would make the store keep rendering the old list after a successful write — an artefact of
 * the fixture, measured here first as a failing assertion, that would hide a real regression
 * later.
 */
const signFollows = async (
    secret: string,
    tags: string[][],
    createdAt: number,
    content = '',
): Promise<TrustedEvent> =>
    (await Nip01Signer.fromSecret(secret).sign(
        makeEvent(FOLLOWS, { created_at: createdAt, tags, content }),
    )) as unknown as TrustedEvent

const signRelayList = async (secret: string, urls: string[]): Promise<TrustedEvent> =>
    (await Nip01Signer.fromSecret(secret).sign(
        makeEvent(RELAYS, {
            created_at: 1_700_000_000,
            tags: urls.map((url: string) => ['r', url, 'write']),
            content: '',
        }),
    )) as unknown as TrustedEvent

let label = 0

/**
 * A fresh identity with a fresh store on a fresh space url.
 *
 * Wired BEFORE the login for the same reason as in `js/followBulkWire.test.ts`: `armedFor`
 * is one module-level key, so a store wired after an identity is already active never
 * receives an arming answer. No case here depends on the arming pass — each drives
 * `armFollowRead()` itself — but the starting state has to be honest.
 */
async function freshIdentity(secret: string): Promise<FollowsStore> {
    label += 1
    const spaceUrl = `wss://space${label}.base.invalid/`
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

    return alpine.follows as FollowsStore
}

/**
 * **What `openBulkPreview()` freezes**, in the two fields the write is measured against.
 *
 * Mirrored here rather than called: `js/directoryIsland.ts` is an Alpine island and does not
 * run under `node --test`. The surface half — that it freezes `follows.listId` and hands
 * back `plan.base` rather than the live field — is pinned by the AST case in
 * `js/followBulkWire.test.ts`.
 */
const freezePreview = (store: FollowsStore, targets: readonly string[]): { from: number; to: number; base: string } => {
    const from = store.following.length
    const already = targets.filter((pk: string) => store.isFollowing(pk)).length

    return { from, to: from + (targets.length - already), base: store.listId }
}

/** 703 contacts; the outdated copy holds the first 400 of them. */
const BIG = 703
const OLD = 400
const NEW_PEOPLE = [person(900), person(901), person(902)]
const bigTags = (): string[][] => Array.from({ length: BIG }, (_, i) => ['p', person(i)])
const oldTags = (): string[][] => Array.from({ length: OLD }, (_, i) => ['p', person(i)])

const REFUSED_BY_BASE =
    'Deine Kontaktliste hat sich seit der Vorschau geändert. Es wurde nichts geschrieben — prüfe die Auswahl noch einmal.'

describe('F1: the base the preview counted is the base that gets signed', () => {
    const originalGetAdapter = app.netContext.getAdapter

    before(() => {
        app.netContext.getAdapter = (url: string): AbstractAdapter => makeAdapter(url)
    })

    after(() => {
        app.netContext.getAdapter = originalGetAdapter
        for (const url of [INDEXER, OUTBOX, HINT]) {
            app.pool.remove(url)
        }
    })

    /**
     * **F3: a read that never lands has to leave something to press.**
     *
     * For a `listed` reader whose declared relay never closes the read, the arming pass ends
     * after `READ_TIMEOUT_MS` with `answered: false` — and until this round nothing on the
     * bulk bar changed: „Lädt…", forever, with no relay name, no error and no retry. The
     * strict verdict this client applies to a contact list is only bearable because „the
     * refusal is visible and names the relay" (`followListAnswered`), and on this path it
     * was neither.
     *
     * The field only says that asking again is worth offering; the NAMES come from the retry
     * itself, which goes through the same refusal every other path uses.
     *
     * ── This case has to stay FIRST in the file, and it says so out loud ───────
     *
     * It is the only one here that depends on the ARMING pass, and arming is guarded by one
     * module-level key (`armedFor` in `js/follows.ts`). From the second identity onwards the
     * store of the previous case is still subscribed to `activeSpace` and `pubkey`, takes
     * that key first, and the store this case holds never arms at all — measured: the field
     * never moved within 15 s. The precondition below is the guard against exactly that: it
     * asserts that the arming read really went out, so a case moved down the file goes red
     * instead of quietly measuring nothing.
     */
    test('CORE: an arming read that never lands leaves the load step on offer', async () => {
        const secret = makeSecret()
        world = {
            [INDEXER]: { relayList: await signRelayList(secret, [OUTBOX]) },
            [OUTBOX]: { follows: await signFollows(secret, bigTags(), 1_700_000_500), silentFollows: true },
            [HINT]: { follows: null },
        }
        clearWire()
        const store = await freshIdentity(secret)
        assert.ok(
            requested.some((req) => req.url === OUTBOX && req.kinds.includes(FOLLOWS)),
            'PRECONDITION: the arming pass did not ask the declared relay for the contact list at all, so there '
                + 'is no attempt for this case to be about. `armedFor` is one module-level key — if this case is '
                + 'not the FIRST identity in the file, the store of the previous one owns that key and this store '
                + 'never arms.',
        )
        assert.equal(
            store.listReadFailed,
            false,
            'PRECONDITION: while the arming read is in flight „Lädt…" is the honest label — the offer must not '
                + 'appear before the attempt has failed',
        )

        // The read is bounded by READ_TIMEOUT_MS (6 s); this is the state after it.
        const flipped = await waitUntil(() => store.listReadFailed)

        assert.equal(store.listSeen, false, 'nothing was seen — the relay never closed the read')
        assert.ok(
            flipped >= 0,
            'the attempt is over and it failed, so the bar has to stop saying „Lädt…", but the field never moved '
                + 'within 15 s. Without it the surface is inert for the rest of the session for a reader whose own '
                + 'declared relay is down — and it never tells them which one.',
        )
        assert.equal(
            store.error,
            '',
            'and the arming pass itself stays quiet: a page load must not put a refusal on the profile card for '
                + 'something the reader did not do. The sentence belongs to the retry.',
        )

        // …and the retry is where the relay gets named.
        await store.armFollowRead()
        assert.equal(
            store.error,
            'Diese Relais haben die Kontaktliste nicht ausgeliefert: outbox.base.invalid. Es wurde nichts geändert.',
            'the retry click produces the refusal that names the silent relay — which is what makes the strict '
                + 'verdict bearable in the first place. The bulk bar mirrors this into bulkError.',
        )
    })

    /**
     * **C2 — one relay misses one window.** The auditor's headline case: 303 contacts
     * destroyed by a relay being slow, with an empty error and a closed dialog.
     */
    test('CORE: a hint relay falling silent does not shrink the base', async () => {
        const secret = makeSecret()
        world = {
            [INDEXER]: { relayList: await signRelayList(secret, [OUTBOX]) },
            [OUTBOX]: { follows: await signFollows(secret, oldTags(), 1_700_000_000) },
            [HINT]: { follows: await signFollows(secret, bigTags(), 1_700_000_500) },
        }
        const store = await freshIdentity(secret)

        await store.armFollowRead()
        assert.equal(store.listSeen, true, 'PRECONDITION: the list was read')
        assert.equal(store.following.length, BIG, 'PRECONDITION: the store holds the current 703')
        const preview = freezePreview(store, NEW_PEOPLE)
        assert.deepEqual([preview.from, preview.to], [BIG, BIG + 3], 'PRECONDITION: the dialog says 703 → 706')

        // …and now the relay that holds the current list misses one window.
        world[HINT].silentFollows = true
        clearWire()
        await store.followMany(NEW_PEOPLE, preview.base)

        assert.equal(written.length, 1, 'PRECONDITION: one event went out')
        assert.equal(
            written[0]?.tags.length,
            BIG + 3,
            `the event carries ${written[0]?.tags.length ?? 0} tags, the preview promised ${BIG + 3}. At 6565549 `
                + 'this was 403: the outbox served an outdated copy, the relay holding the current list was one '
                + 'window late, and the difference was signed without a word. The list this session already read '
                + 'off a relay has to stay in the comparison — it can only raise the winner, never lower it.',
        )
        assert.equal(store.error, '', 'and the ordinary case stays ordinary — no refusal for a relay being slow')
        assert.equal(store.following.length, BIG + 3, 'the rendered list is the one that was written')
    })

    /** **C3 — the positive control.** Same setup, nobody silent. */
    test('CALIBRATION: the same setup with every relay answering writes the same event', async () => {
        const secret = makeSecret()
        world = {
            [INDEXER]: { relayList: await signRelayList(secret, [OUTBOX]) },
            [OUTBOX]: { follows: await signFollows(secret, oldTags(), 1_700_000_000) },
            [HINT]: { follows: await signFollows(secret, bigTags(), 1_700_000_500) },
        }
        const store = await freshIdentity(secret)

        assert.equal(
            store.listReadFailed,
            false,
            'PRECONDITION: the arming read landed, so the bar shows no retry offer (F3) — the control for the '
                + 'case at the end of this file',
        )
        await store.armFollowRead()
        const preview = freezePreview(store, NEW_PEOPLE)
        clearWire()
        await store.followMany(NEW_PEOPLE, preview.base)

        assert.equal(written[0]?.tags.length, BIG + 3, 'the undisturbed case: 703 + 3')
        assert.equal(store.error, '')
    })

    /**
     * **B1 — the relay answers the read with an `EOSE` and no event.** A purged
     * replaceable, a relay that lost it, a read that raced a deletion: the answer is
     * complete and empty, which is the one shape `planFollowWrite` is allowed to build on.
     */
    test('CORE: a complete but EMPTY answer does not wipe the list', async () => {
        const secret = makeSecret()
        world = {
            [INDEXER]: { relayList: await signRelayList(secret, [OUTBOX]) },
            [OUTBOX]: { follows: await signFollows(secret, bigTags(), 1_700_000_500, 'wss://legacy.example') },
            [HINT]: { follows: null },
        }
        const store = await freshIdentity(secret)

        await store.armFollowRead()
        assert.equal(store.following.length, BIG, 'PRECONDITION: the store holds the 703')
        const preview = freezePreview(store, NEW_PEOPLE)

        world[OUTBOX].follows = null
        clearWire()
        await store.followMany(NEW_PEOPLE, preview.base)

        assert.equal(written.length, 1, 'PRECONDITION: one event went out')
        assert.equal(
            written[0]?.tags.length,
            BIG + 3,
            `the event carries ${written[0]?.tags.length ?? 0} tags, expected ${BIG + 3}. At 6565549 this was 3 — `
                + 'the whole contact list replaced by the three people of the selection, because the only relay '
                + 'that had been asked answered with nothing.',
        )
        assert.equal(
            written[0]?.content,
            'wss://legacy.example',
            'and the legacy relay map in `content` is carried over. A base of `null` takes `content` with it: '
                + 'the loss is not only the `p` tags.',
        )
        assert.equal(store.error, '')
    })

    /**
     * **B2 — the base moved FORWARD, and half 1 cannot help.**
     *
     * Another device wrote a shorter list — an older client, a partial sync, a reader who
     * unfollowed 300 people on their phone. That event is newer, so it wins the NIP-01
     * comparison against the list we hold, correctly. The numbers on screen are then stale,
     * and this is the case the binding exists for: what was counted is not what would be
     * written, and the difference is 300 contacts.
     */
    test('CORE: a base that moved since the preview refuses the write and says so', async () => {
        const secret = makeSecret()
        world = {
            [INDEXER]: { relayList: await signRelayList(secret, [OUTBOX]) },
            [OUTBOX]: { follows: await signFollows(secret, bigTags(), 1_700_000_500) },
            [HINT]: { follows: null },
        }
        const store = await freshIdentity(secret)

        await store.armFollowRead()
        const preview = freezePreview(store, NEW_PEOPLE)
        assert.deepEqual([preview.from, preview.to], [BIG, BIG + 3], 'PRECONDITION: the dialog says 703 → 706')

        // The other device writes while the dialog is open: newer, and 303 entries shorter.
        world[OUTBOX].follows = await signFollows(secret, oldTags(), 1_700_000_900)
        clearWire()
        await store.followMany(NEW_PEOPLE, preview.base)

        assert.deepEqual(
            written.map((event: TrustedEvent) => event.tags.length),
            [],
            'a kind 3 was signed against a base the reader never saw. The dialog counted 703 → 706 and the body '
                + 'would have carried 403 — the same event as C2, only this time the relay is right and the '
                + 'numbers are stale. A replaceable write cannot be taken back, so the refusal is the answer.',
        )
        assert.equal(
            store.error,
            REFUSED_BY_BASE,
            'and the reader is told that the LIST moved, not that their relays are broken and not that they '
                + 'already follow everyone. An empty error here is read as success one line later: the selection '
                + 'is cleared and the dialog closes over a write that never happened.',
        )
        assert.equal(store.following.length, OLD, 'the store now renders what the relay showed — so the next '
            + 'preview counts against the list that is really there')
    })

    /**
     * **The held list is a SOURCE and never a VOICE.**
     *
     * Holding a list says nothing about whether a relay could be asked. If it counted
     * towards the completeness verdict, a reader whose only target relay is down could
     * write — which is F1 in its original costume: a write licensed by something other than
     * a complete relay answer.
     */
    test('CORE: holding a list does not license a write while a target is silent', async () => {
        const secret = makeSecret()
        world = {
            [INDEXER]: { relayList: await signRelayList(secret, [OUTBOX]) },
            [OUTBOX]: { follows: await signFollows(secret, bigTags(), 1_700_000_500) },
            [HINT]: { follows: null },
        }
        const store = await freshIdentity(secret)

        await store.armFollowRead()
        assert.equal(store.following.length, BIG, 'PRECONDITION: the list is held')
        const preview = freezePreview(store, NEW_PEOPLE)

        world[OUTBOX].silentFollows = true
        clearWire()
        await store.followMany(NEW_PEOPLE, preview.base)

        assert.deepEqual(
            written.map((event: TrustedEvent) => event.kind),
            [],
            'the write went out on a base no relay confirmed. The list we hold is a candidate for the MERGE BASE '
                + 'and nothing else; letting it answer „the relays are fine" is the replaceable-kind data loss '
                + 'with one extra step.',
        )
        assert.equal(
            store.error,
            'Diese Relais haben die Kontaktliste nicht ausgeliefert: outbox.base.invalid. Es wurde nichts geändert.',
            'and the silent relay is named — the refusal has to be actionable',
        )
    })

    /**
     * **The re-read after the write asks the RELAYS, with no local candidate.**
     *
     * `followWriteConfirmed` treats „the relay answered nothing" as „cannot tell" and does
     * not turn it into a red error — the documented asymmetry. Hand the held list into that
     * comparison and the answer stops being about the relay: the pre-write copy wins, none
     * of the targets are in it, and every such write reports a failure that did not happen.
     */
    test('CORE: a relay that serves nothing after the write is „cannot tell", not a failure', async () => {
        const secret = makeSecret()
        world = {
            [INDEXER]: { relayList: await signRelayList(secret, [OUTBOX]) },
            [OUTBOX]: { follows: await signFollows(secret, bigTags(), 1_700_000_500), emptyAfterWrite: true },
            [HINT]: { follows: null },
        }
        const store = await freshIdentity(secret)

        await store.armFollowRead()
        const preview = freezePreview(store, NEW_PEOPLE)
        clearWire()
        await store.followMany(NEW_PEOPLE, preview.base)

        assert.equal(written.length, 1, 'PRECONDITION: the write went out and the relay answered OK')
        assert.equal(
            store.error,
            '',
            'the relay answered the re-read with nothing at all, which is „cannot tell" and not „it refused". '
                + 'A local candidate in that comparison would answer with the copy we held BEFORE the publish — '
                + 'none of the targets are in it, and the reader would be told their follow failed.',
        )
    })

    /**
     * **A reader who genuinely has no contact list.** `''` is a base like any other, and the
     * binding has to hold for it — otherwise the one reader whose base is easiest to
     * overwrite is the one nobody checks.
     */
    test('CORE: „no list" binds as tightly as a list', async () => {
        const secret = makeSecret()
        world = {
            [INDEXER]: { relayList: await signRelayList(secret, [OUTBOX]) },
            [OUTBOX]: { follows: null },
            [HINT]: { follows: null },
        }
        const store = await freshIdentity(secret)

        await store.armFollowRead()
        assert.equal(store.listSeen, true, 'PRECONDITION: the read landed — the relays answered, with nothing')
        const preview = freezePreview(store, NEW_PEOPLE)
        assert.deepEqual([preview.from, preview.base], [0, ''], 'PRECONDITION: no list, and the id says so')

        // A list appears between the preview and the click — another device, or a relay
        // that finally caught up. The reader was shown „0 → 3"; the truth is 703 → 706.
        world[OUTBOX].follows = await signFollows(secret, bigTags(), 1_700_000_500)
        clearWire()
        await store.followMany(NEW_PEOPLE, preview.base)

        assert.deepEqual(
            written.map((event: TrustedEvent) => event.tags.length),
            [],
            'the reader confirmed „deine Kontaktliste wächst von 0 auf 3" and a 706-tag event would have gone out '
                + 'under it. The direction is harmless here; the agreement between the numbers and the signature '
                + 'is not, and it is the only thing the reader was given to check.',
        )
        assert.equal(store.error, REFUSED_BY_BASE)
    })

    /**
     * **The identity of the base is the EVENT, not its size.**
     *
     * A base of the same length and different content is the same loss with a number that
     * agrees — and `from` is the only thing the dialog shows. Two lists of 703, one of them
     * newer with 300 people swapped out: the count is identical and the write must still
     * refuse.
     */
    test('CORE: a same-sized but different base is still a different base', async () => {
        const secret = makeSecret()
        const mine = await signFollows(secret, bigTags(), 1_700_000_500)
        const swapped = await signFollows(
            secret,
            Array.from({ length: BIG }, (_, i) => ['p', person(i < 300 ? i + 5_000 : i)]),
            1_700_000_900,
        )
        world = {
            [INDEXER]: { relayList: await signRelayList(secret, [OUTBOX]) },
            [OUTBOX]: { follows: mine },
            [HINT]: { follows: null },
        }
        const store = await freshIdentity(secret)

        await store.armFollowRead()
        const preview = freezePreview(store, NEW_PEOPLE)
        world[OUTBOX].follows = swapped
        clearWire()
        await store.followMany(NEW_PEOPLE, preview.base)

        assert.deepEqual(
            written.map((event: TrustedEvent) => event.tags.length),
            [],
            'both lists hold 703 entries, so a binding on the COUNT would have signed this one. 300 of the '
                + 'entries are other people.',
        )
        assert.equal(store.error, REFUSED_BY_BASE)
    })

    /**
     * **`store.listId` is the id of the list `following` was rendered from** — the value the
     * surface freezes. If it ever stops moving with the list, the binding agrees with
     * everything and this whole file passes for the wrong reason.
     */
    test('CORE: listId names the event the rendered list came from', async () => {
        const secret = makeSecret()
        const first = await signFollows(secret, [['p', person(0)]], 1_700_000_500)
        world = {
            [INDEXER]: { relayList: await signRelayList(secret, [OUTBOX]) },
            [OUTBOX]: { follows: first },
            [HINT]: { follows: null },
        }
        const store = await freshIdentity(secret)
        assert.equal(store.listId, '', 'PRECONDITION: nothing has been read, so there is no base to name')

        await store.armFollowRead()
        assert.equal(store.listId, first.id, 'after the read it names the event the relay served')
        assert.deepEqual(store.following, [person(0)], 'and it is the same list that is rendered')

        const second = await signFollows(secret, [['p', person(0)], ['p', person(1)]], 1_700_000_900)
        world[OUTBOX].follows = second
        await store.armFollowRead()
        assert.equal(store.listId, second.id, 'and it moves with the list, in the same recomputation')
        assert.equal(store.following.length, 2)
    })
})
