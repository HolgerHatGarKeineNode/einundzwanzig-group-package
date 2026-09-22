/**
 * The space has no code default any more: a missing `__nostrSpace` yields an unreachable
 * placeholder, and the app instance lets neither a socket nor a NIP-11 fetch go out to it.
 *
 * Why: the default used to be `ws://localhost:3334/`, the local test relay, and it shipped
 * in the release bundle — measured on the device (v1.13.0 build 142), every page of the
 * companion app's own layout dialled the phone's port 3334. Reasoning in full at
 * `UNCONFIGURED_SPACE_URL` (`relayConfig.ts`).
 *
 * Run: node --test --experimental-strip-types packages/einundzwanzig-group/js/unconfiguredSpace.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Relays } from '@welshman/app'
import { SocketStatus } from '@welshman/net'
import { UNCONFIGURED_SPACE_URL, configuredSpaceUrl, isUnconfiguredSpace } from './relayConfig.ts'
import { app } from './welshmanInstance.ts'

test('a missing or empty space configuration becomes the placeholder, never a localhost relay', () => {
    for (const raw of [undefined, null, '', '   ']) {
        assert.equal(configuredSpaceUrl(raw), UNCONFIGURED_SPACE_URL, `input ${JSON.stringify(raw)}`)
    }
    assert.equal(configuredSpaceUrl('ws://127.0.0.1:7'), 'ws://127.0.0.1:7/')
    assert.equal(isUnconfiguredSpace(UNCONFIGURED_SPACE_URL), true)
    // Control: a real relay — including a local one somebody configured on purpose — is not
    // the placeholder.
    assert.equal(isUnconfiguredSpace('ws://localhost:3334/'), false)
    assert.equal(isUnconfiguredSpace('wss://group.einundzwanzig.space/'), false)
})

test('the app instance opens no socket to the placeholder and reports it as an error', () => {
    const socket = app.pool.get(UNCONFIGURED_SPACE_URL)
    const statuses: string[] = []
    socket.on('status', (status: string) => statuses.push(status))

    socket.attemptToOpen()

    assert.equal((socket as unknown as { _ws?: unknown })._ws, undefined, 'a WebSocket was created')
    assert.deepEqual(statuses, [SocketStatus.Error])
    app.pool.remove(UNCONFIGURED_SPACE_URL)
})

test('the app instance fetches no NIP-11 document for the placeholder, and still does for a relay', async () => {
    const original = globalThis.fetch
    const calls: string[] = []
    globalThis.fetch = (async (input: string | URL | Request) => {
        calls.push(String(input))
        throw new Error('offline in this test')
    }) as typeof fetch

    try {
        assert.equal(await app.use(Relays).fetch(UNCONFIGURED_SPACE_URL), undefined)
        assert.deepEqual(calls, [], 'the placeholder was fetched')

        // Control: the wrapper passes every other relay through to welshman's fetch.
        await app.use(Relays).fetch('wss://relay.example/')
        assert.deepEqual(calls, ['https://relay.example/'])
    } finally {
        globalThis.fetch = original
    }
})

test('no source file of the island falls back to a loopback address', async () => {
    // The shape of the removed default: `?? 'ws://localhost:3334/'` (or `||`). Scanned over
    // every non-test module, so a second such fallback cannot come back in another file.
    const { readdirSync, readFileSync } = await import('node:fs')
    const dir = new URL('.', import.meta.url)
    const fallback = /(\?\?|\|\|)\s*['"`](wss?|https?):\/\/(localhost|127\.\d+\.\d+\.\d+|\[::1\])/
    const hits = readdirSync(dir)
        .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
        .flatMap((name) =>
            readFileSync(new URL(name, dir), 'utf8')
                .split('\n')
                .map((line, index) => ({ name, line: index + 1, text: line }))
                .filter(({ text }) => fallback.test(text)),
        )
        .map(({ name, line, text }) => `${name}:${line}: ${text.trim()}`)

    assert.deepEqual(hits, [])
    // Control: the pattern sees the line it was written against.
    assert.equal(fallback.test("normalizeRelayUrl(spaceOverride ?? 'ws://localhost:3334/')"), true)
})
