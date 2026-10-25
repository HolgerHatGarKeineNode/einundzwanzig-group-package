/**
 * The verified-badge lookup goes to our server, through welshman's REAL `Handles` plugin.
 *
 * Run: node --test --experimental-strip-types packages/einundzwanzig-group/js/nip05Proxy.test.ts
 */
import { test, describe, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { App, Handles } from '@welshman/app'
import { NIP05_BATCH, fetchHandlesViaProxy, nip05ProxyBase, routeHandlesThroughProxy } from './nip05Proxy.ts'

const PK = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90'

/** A fetch stub that answers like `Nip05Controller` and records every URL. */
const server = (answer: (handles: string[]) => unknown[]) => {
    const urls: string[] = []
    const impl = async (url: string) => {
        urls.push(url)
        const handles = new URL(url, 'http://host').searchParams.getAll('h[]')

        return { ok: true, json: async () => ({ data: answer(handles) }) }
    }

    return { impl, urls }
}

const originalFetch = globalThis.fetch
afterEach(() => {
    globalThis.fetch = originalFetch
})

describe('nip05ProxyBase', () => {
    test('no boot global → the package route; explicit empty → off', () => {
        assert.equal(nip05ProxyBase(undefined), '/nostr/nip05')
        assert.equal(nip05ProxyBase(''), '')
        assert.equal(nip05ProxyBase(' /x/nip05 '), '/x/nip05')
        assert.equal(nip05ProxyBase(42), '')
    })
})

describe('welshman Handles asks our server, never the domain', () => {
    test('CORE PROOF: load() resolves through the endpoint and no .well-known request leaves the browser', async () => {
        const direct: string[] = []
        globalThis.fetch = (async (url: string) => {
            direct.push(String(url))
            throw new TypeError('Failed to fetch (CORS)')
        }) as typeof fetch

        const app = new App({ config: {} })
        const handles = app.use(Handles)
        const { impl, urls } = server((hs) => hs.map((handle) => ({ handle, status: 'found', info: { pubkey: PK, relays: ['wss://r.example/'] } })))
        routeHandlesThroughProxy(handles, '/nostr/nip05', impl)

        const handle = await handles.load('alice@primal.net')

        assert.equal(handle?.pubkey, PK)
        assert.equal(handles.get('alice@primal.net')?.pubkey, PK)
        assert.deepEqual(urls, ['/nostr/nip05?h[]=alice%40primal.net'])
        assert.deepEqual(direct, [], 'a direct .well-known fetch went out — the CORS failure is back')
    })

    test('COUNTER-CHECK: without the proxy welshman fetches the domain directly (what fails on CORS)', async () => {
        const direct: string[] = []
        globalThis.fetch = (async (url: string) => {
            direct.push(String(url))
            throw new TypeError('Failed to fetch (CORS)')
        }) as typeof fetch

        const handles = new App({ config: {} }).use(Handles)
        routeHandlesThroughProxy(handles, '', server(() => []).impl)

        assert.equal(await handles.load('alice@primal.net'), undefined)
        assert.deepEqual(direct, ['https://primal.net/.well-known/nostr.json?name=alice'])
    })

    test('the undo restores welshman’s own fetch', () => {
        const handles = new App({ config: {} }).use(Handles)
        const own = handles.fetch
        const undo = routeHandlesThroughProxy(handles, '/nostr/nip05', server(() => []).impl)
        assert.notEqual(handles.fetch, own)
        undo()
        assert.equal(handles.fetch, own)
    })
})

describe('fetchHandlesViaProxy', () => {
    test(`batches of ${NIP05_BATCH}, like the server's MAX_HANDLES`, async () => {
        const all = Array.from({ length: NIP05_BATCH + 1 }, (_, i) => `n${i}@example.org`)
        const { impl, urls } = server(() => [])

        await fetchHandlesViaProxy('/nostr/nip05', all, impl)

        assert.equal(urls.length, 2)
        assert.equal(new URL(urls[0], 'http://h').searchParams.getAll('h[]').length, NIP05_BATCH)
    })

    test('only a 64-hex key for a handle that was asked counts', async () => {
        const { impl } = server(() => [
            { handle: 'alice@primal.net', info: { pubkey: PK } },
            { handle: 'bob@primal.net', info: { pubkey: 'not-hex' } },
            { handle: 'eve@foreign.example', info: { pubkey: PK } },
            { handle: 'carol@primal.net', info: null },
        ])

        const found = await fetchHandlesViaProxy('/nostr/nip05', ['alice@primal.net', 'bob@primal.net', 'carol@primal.net'], impl)

        assert.deepEqual([...found.keys()], ['alice@primal.net'])
    })

    test('a failing endpoint is "no handle", not a throw', async () => {
        const found = await fetchHandlesViaProxy('/nostr/nip05', ['alice@primal.net'], async () => {
            throw new TypeError('offline')
        })

        assert.equal(found.size, 0)
    })
})

describe('the island wires it in', () => {
    test('the app instance’s Handles asks the package route', async () => {
        const asked: string[] = []
        globalThis.fetch = (async (url: string) => {
            asked.push(String(url))

            return new Response(JSON.stringify({ data: [{ handle: 'dora@primal.net', info: { pubkey: PK } }] }))
        }) as typeof fetch

        const { app } = await import('./welshmanInstance.ts')
        const handle = await app.use(Handles).load('dora@primal.net')

        assert.deepEqual(asked, ['/nostr/nip05?h[]=dora%40primal.net'])
        assert.equal(handle?.pubkey, PK)
    })
})
