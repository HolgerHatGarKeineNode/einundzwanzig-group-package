/**
 * **Which relays a PAGE LOAD asks for the contact list — one store, one process.**
 *   node --test --experimental-strip-types packages/einundzwanzig-group/js/followArmingGate.test.ts
 *
 * ── Why this is a separate file and not a fourth case next door ────────────────
 *
 * `js/followClickGate.test.ts` measures clicks. It cannot measure the arming pass of a
 * `listed` reader, and the reason is structural: `armedFor` in `js/follows.ts` is ONE
 * module-level key, and every store an earlier case wired stays subscribed to
 * `activeSpace` and `pubkey`. They re-arm first and take the key, so the store a later case
 * builds never receives an arming answer. A separate file is a separate process, one store,
 * no contention.
 *
 * ── What it is for, and it is a measured gap, not a precaution ─────────────────
 *
 * A review widened the target set with
 *
 *     const targets = arming ? Object.assign([...drawn, ...hints], drawn) : drawn
 *
 * — an intersection, so the brand survives; no cast, so the census next door sees nothing;
 * `tsc` exit 0. Placed in the arming branch **on purpose**, because nothing is ever written
 * there and every EVENT-frame assertion is therefore blind to it. Adding the REQ urls to
 * the click file did not help: measured, that mutation was 3/3 green before AND after, for
 * the structural reason above.
 *
 * In production the same edit is the whole of F7 coming back — `{kinds:[3],authors:[self]}`
 * to four relays the reader never chose, on every page view, with AUTH granted to them in
 * `js/relayConfig.ts`. Deanonymisation, not data loss, and no source instrument is needed
 * to see it: it is traffic.
 */
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import type { AbstractAdapter, ClientMessage, MockAdapter as MockAdapterType } from '@welshman/net'
import type { Filter, TrustedEvent } from '@welshman/util'
import type { FollowsStore } from './follows.ts'

const INDEXER = 'wss://indexer.arming.invalid/'
/** The default set — read-only hints for a `listed` reader, and never a target. */
const HINT = 'wss://hint.arming.invalid/'
/** The relay this reader declares in their kind 10002. The only legitimate target. */
const OUTBOX = 'wss://outbox.arming.invalid/'
const SPACE = 'wss://space.arming.invalid/'

// Before any import of the module graph — `js/relayConfig.ts` reads this once, at load.
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

const SECRET = makeSecret()
const ME = getPubkey(SECRET)
const SIGNER = Nip01Signer.fromSecret(SECRET)
const ALICE = 'b'.repeat(64)

const relayList: TrustedEvent = await SIGNER.sign(
    makeEvent(RELAYS, { created_at: 1_800_000_000, tags: [['r', OUTBOX]], content: '' }),
) as unknown as TrustedEvent
const contactList: TrustedEvent = await SIGNER.sign(
    makeEvent(FOLLOWS, { created_at: 1_800_000_000, tags: [['p', ALICE]], content: '' }),
) as unknown as TrustedEvent

/** Every REQ, with the relay it went to and the kinds it asked for. */
const requested: { url: string; kinds: number[] }[] = []
/** Every EVENT frame — a page load must produce none of these at all. */
const written: TrustedEvent[] = []

const contactListReadsTo = (): string[] =>
    [...new Set(requested.filter((req) => req.kinds.includes(FOLLOWS)).map((req) => req.url))].sort()

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
                    // Only the indexer knows the relay list, and only the declared relay
                    // holds the contact list — so „who was asked" and „who answered" stay
                    // distinguishable in the record above.
                    if (filter.kinds?.includes(RELAYS) && url === INDEXER) {
                        adapter.receive(['EVENT', subId, relayList])
                    }
                    if (filter.kinds?.includes(FOLLOWS) && url === OUTBOX) {
                        adapter.receive(['EVENT', subId, contactList])
                    }
                }
                adapter.receive(['EOSE', subId])
            }, 0)

            return
        }
        if (message[0] === 'EVENT') {
            written.push(message[1] as TrustedEvent)
            setTimeout(() => adapter.receive(['OK', (message[1] as TrustedEvent).id, true, '']), 0)
        }
    })

    return adapter
}

const settle = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** Wait for a condition rather than for a clock — the arming pass is two round trips deep. */
const waitUntil = async (condition: () => boolean, ms = 3000): Promise<void> => {
    const deadline = Date.now() + ms
    while (!condition() && Date.now() < deadline) {
        await settle(25)
    }
}

let store: FollowsStore

describe('the arming pass of a `listed` reader asks its own relay and nothing else', () => {
    const originalGetAdapter = app.netContext.getAdapter

    before(async () => {
        app.netContext.getAdapter = (url: string): AbstractAdapter => makeAdapter(url)
        app.use(Relays).set(SPACE, new Relay(SPACE, { software: 'https://github.com/coracle-social/zooid' }))
        loginWithNip01(SECRET)
        activeSpaceUrl.set(SPACE)
        const alpine: Record<string, unknown> = {}
        wireFollows({
            store: (name: string, value?: unknown): unknown => {
                if (value !== undefined) {
                    alpine[name] = value
                }

                return alpine[name]
            },
        })
        store = alpine.follows as FollowsStore
        await waitUntil(() => store.listSeen)
    })

    after(() => {
        app.netContext.getAdapter = originalGetAdapter
        for (const url of [INDEXER, HINT, OUTBOX, SPACE]) {
            app.pool.remove(url)
        }
    })

    test('CALIBRATION: the arming pass ran, and it resolved the relay list', () => {
        assert.equal(store.me, ME, 'the store is on the identity whose relay list the mock serves')
        // Without this the assertion below would be satisfied by a page load that did
        // nothing at all — the failure mode of every measurement of an absence.
        assert.equal(store.listSeen, true, 'a `listed` reader is the case arming does NOT defer (F7)')
        assert.equal(store.noRelayList, false, 'and this reader has a kind 10002, so the card says nothing')
        assert.deepEqual(store.following, [ALICE], 'the list came back over the repository-free context (D2)')
    })

    test('CORE: the contact list was asked for at the DECLARED relay only, never at a hint', () => {
        assert.deepEqual(
            contactListReadsTo(),
            [OUTBOX],
            'a page load asked for this reader\'s contact list somewhere other than their own declared relay. '
                + 'That request carries `authors:[self]`, the relays in question get AUTH in js/relayConfig.ts, '
                + 'and the reader never chose them — F7. A widened target set shows up here whatever syntax made '
                + 'it: an intersection and a JSON round trip both survive the type and the census, and neither '
                + 'survives being counted at the wire.',
        )
    })

    test('CORE: a page load signs nothing', () => {
        assert.deepEqual(
            written.map((event: TrustedEvent) => event.kind),
            [],
            'arming is a read. An event at page load is a contact list written from whatever the reader happened '
                + 'to have in hand, which is the defect this whole phase is about.',
        )
    })
})
