/**
 * Soft forgetting: grows, persists across page loads, recovers on success — and never
 * learns from a dead network.
 *
 * Run: node --test --experimental-strip-types packages/einundzwanzig-group/js/relayForget.test.ts
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { App, RelayStats } from '@welshman/app'
import { SocketEvent, SocketStatus } from '@welshman/net'
import { Emitter } from '@welshman/lib'
import { RelayScenario, addMinimalFallbacks, makeSelection, normalizeRelayUrl } from '@welshman/util'
import {
    EPISODE_GAP_S,
    FORGET_BASE_S,
    FORGET_MAX_S,
    NETWORK_PROOF_S,
    STORAGE_KEY,
    forgetRelayQuality,
    forgetUntil,
    isForgotten,
    makeRelayForgetting,
    noteFailure,
    parseRecords,
    serializeRecords,
} from './relayForget.ts'

const DEAD = normalizeRelayUrl('relay.0xchat.com')
const LIVE = normalizeRelayUrl('nos.lol')
const OWN = normalizeRelayUrl('group.example')
const FALLBACK = normalizeRelayUrl('fallback.example')

const T0 = 1_800_000_000

const memoryStorage = () => {
    const data = new Map<string, string>()

    return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), data }
}

/** A clock the test moves. */
const clock = (start = T0) => {
    let t = start

    return { now: () => t, set: (v: number) => void (t = v), add: (d: number) => void (t += d) }
}

const routed = (quality: (url: string) => number, urls: string[] = [DEAD, LIVE]): string[] =>
    new RelayScenario([makeSelection(urls)], { getRelayQuality: quality, getDefaultRelays: () => [FALLBACK] })
        .policy(addMinimalFallbacks)
        .limit(10)
        .getUrls()
        .toSorted()

describe('the backoff', () => {
    test('doubles per episode from one minute and stops at six hours', () => {
        let record = noteFailure(undefined, T0)
        const skips = [forgetUntil(record) - T0]
        for (let i = 1; i < 12; i += 1) {
            record = noteFailure(record, T0 + i * 10_000)
            skips.push(forgetUntil(record) - record.lastFailure)
        }

        assert.deepEqual(skips.slice(0, 5), [60, 120, 240, 480, 960])
        assert.equal(Math.max(...skips), FORGET_MAX_S)
        assert.equal(skips.at(-1), FORGET_MAX_S)
    })

    test('a burst inside one episode counts once', () => {
        let record = noteFailure(undefined, T0)
        record = noteFailure(record, T0 + 1)
        record = noteFailure(record, T0 + 3)
        record = noteFailure(record, T0 + EPISODE_GAP_S - 1 + 3)

        assert.equal(record.failures, 1)
        assert.equal(noteFailure(record, record.lastFailure + EPISODE_GAP_S).failures, 2)
    })

    test('the skip ends — the relay is tried again', () => {
        const record = noteFailure(undefined, T0)
        assert.equal(isForgotten(record, T0 + FORGET_BASE_S - 1), true)
        assert.equal(isForgotten(record, T0 + FORGET_BASE_S), false)
    })
})

describe('learning from welshman RelayStats items', () => {
    test('CORE PROOF: a failure with a working network is remembered across a page load and keeps the relay out of routing', async () => {
        const storage = memoryStorage()
        const c = clock()
        const page1 = makeRelayForgetting({ storage, now: c.now, persistDelayMs: 0 })

        page1.feed(LIVE, { last_open: T0, last_error: 0 })
        page1.feed(DEAD, { last_open: 0, last_error: T0 + 1 })
        await new Promise((r) => setTimeout(r, 5))
        assert.ok(storage.data.get(STORAGE_KEY)?.includes(DEAD), 'nothing persisted')

        // The next page: a fresh instance, empty welshman stats, same storage.
        c.add(30)
        const page2 = makeRelayForgetting({ storage, now: c.now })
        const quality = forgetRelayQuality(page2.records, () => false, c.now)(() => 0.8)

        assert.equal(quality(DEAD), 0)
        assert.deepEqual(routed(quality), [LIVE], 'the dead relay is still dialled on the next page')

        // …and comes back once its time is up.
        c.add(FORGET_BASE_S)
        assert.deepEqual(routed(quality), [DEAD, LIVE].toSorted())
    })

    test('one successful open erases the record (full recovery)', () => {
        const c = clock()
        const f = makeRelayForgetting({ now: c.now })
        f.feed(LIVE, { last_open: T0, last_error: 0 })
        f.feed(DEAD, { last_open: 0, last_error: T0 + 1 })
        assert.equal(f.records.get(DEAD)?.failures, 1)

        f.feed(DEAD, { last_open: T0 + 400, last_error: T0 + 1 })
        assert.equal(f.records.has(DEAD), false)
    })

    test('OFFLINE: when nothing opens, nothing is learned', () => {
        const c = clock()
        const f = makeRelayForgetting({ now: c.now })
        f.feed(DEAD, { last_open: 0, last_error: T0 })
        f.feed(LIVE, { last_open: 0, last_error: T0 })
        c.add(NETWORK_PROOF_S + 1)
        f.feed(OWN, { last_open: 0, last_error: c.now() })
        // The network comes back much later — the old failures have lost their proof window.
        c.add(NETWORK_PROOF_S + 1)
        f.feed(LIVE, { last_open: c.now(), last_error: T0 })

        assert.equal(f.records.has(DEAD), false, 'a tunnel taught the client to forget a relay')
    })

    test('a failure that happens BEFORE the first open of the page counts once the network proves itself', () => {
        const c = clock()
        const f = makeRelayForgetting({ now: c.now })
        f.feed(DEAD, { last_open: 0, last_error: T0 })
        assert.equal(f.records.has(DEAD), false, 'committed without proof')
        c.add(1)
        f.feed(LIVE, { last_open: T0 + 1, last_error: 0 })
        assert.equal(f.records.get(DEAD)?.failures, 1)
    })

    test('the host’s own relays are never forgotten', () => {
        const c = clock()
        const records = new Map([[OWN, { failures: 9, lastFailure: T0 }]])
        const quality = forgetRelayQuality(records, (url) => url === OWN, c.now)(() => 0.7)

        assert.equal(quality(OWN), 0.7)
    })

    test('against welshman’s real RelayStats: socket status events become records', async () => {
        const f = makeRelayForgetting({})
        const stats = new App({ config: {} }).use(RelayStats)
        stats.onItem((url, item) => f.feed(url, item))

        // Through welshman's public socket hook, the way `appPolicyRelayStats` wires it.
        const socket = new Emitter()
        stats.monitorSocket(socket as never)
        socket.emit(SocketEvent.Status, SocketStatus.Open, LIVE)
        socket.emit(SocketEvent.Status, SocketStatus.Error, DEAD)
        // `RelayStats.update` batches for 150 ms.
        await new Promise((r) => setTimeout(r, 300))

        assert.equal(f.records.get(DEAD)?.failures, 1)
        assert.equal(f.records.has(LIVE), false)
    })
})

describe('persistence format', () => {
    test('garbage, future and expired entries are dropped; the rest round-trips', () => {
        const raw = JSON.stringify({
            [DEAD]: [3, T0 - 10],
            'wss://future.example/': [1, T0 + 10_000],
            'wss://old.example/': [1, T0 - 8 * 86400],
            'wss://bad.example/': ['x', T0],
            'wss://shape.example/': { failures: 1 },
        })
        const records = parseRecords(raw, T0)

        assert.deepEqual([...records.keys()], [DEAD])
        assert.deepEqual(parseRecords(serializeRecords(records, T0), T0), records)
        assert.equal(parseRecords('{not json', T0).size, 0)
    })
})

describe('the island wires it in', () => {
    test('a relay with two failure episodes is skipped by the app’s resolver after welshman’s own one-minute rule has lapsed', async () => {
        const { app } = await import('./welshmanInstance.ts')
        const { Router, makeRelayStatsItem } = await import('@welshman/app')
        const stats = app.use(RelayStats)
        const dead = normalizeRelayUrl('wired-dead.example')
        const now = Math.floor(Date.now() / 1000)

        // Two episodes 110 s apart, the last one 90 s ago: welshman's own rule (an error in
        // the last minute) no longer fires, ours (2 episodes → 2 minutes) still does.
        stats.set(LIVE, { ...makeRelayStatsItem(LIVE), last_open: now - 150 })
        stats.set(dead, { ...makeRelayStatsItem(dead), last_error: now - 200, recent_errors: [now - 200] })
        stats.set(dead, { ...makeRelayStatsItem(dead), last_error: now - 90, recent_errors: [now - 200, now - 90] })

        assert.ok(stats.getQuality(dead) > 0, 'calibration: welshman alone would route to it again')
        const quality = app.use(Router).resolver.options.getRelayQuality!
        assert.equal(quality(dead), 0)
        assert.ok(quality(normalizeRelayUrl('untouched.example')) > 0)
    })
})
