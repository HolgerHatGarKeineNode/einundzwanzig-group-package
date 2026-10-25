/**
 * NIP-42 scope against welshman's REAL socket and its default policies (auth buffer,
 * lifecycle …) — no network: frames go in through `socket.receive`, outgoing frames are
 * read off `Sending`.
 *
 * Run: node --test --experimental-strip-types packages/einundzwanzig-group/js/authScope.test.ts
 */
import { test, describe, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { AuthStatus, Socket, SocketEvent, SocketStatus, defaultSocketPolicies } from '@welshman/net'
import { asksForAuth, makeSocketPolicyAuthScope, type AuthMode } from './authScope.ts'

const URL_ = 'wss://foreign.example/'
const SUB = 'REQ-1'
const AUTH_ID = 'a'.repeat(64)

const settle = () => new Promise((r) => setTimeout(r, 250))

/** Every socket a test built — cleaned up so welshman's lifecycle interval lets node exit. */
const sockets: Socket[] = []
afterEach(() => {
    for (const socket of sockets.splice(0)) {
        socket.cleanup()
    }
})

/** A socket with welshman's defaults plus our policy; records signatures, frames out and in. */
const setup = (mode: AuthMode) => {
    let signatures = 0
    const policy = makeSocketPolicyAuthScope({
        sign: async (template) => {
            signatures += 1

            return { ...template, id: AUTH_ID, pubkey: 'b'.repeat(64), sig: 'c'.repeat(128) } as never
        },
        mode: () => mode,
    })
    const socket = new Socket(URL_, [...defaultSocketPolicies, policy])
    sockets.push(socket)
    // "Open" without a WebSocket: `socketPolicyConnectOnSend` would otherwise dial.
    socket.status = SocketStatus.Open
    const sent: unknown[][] = []
    const delivered: unknown[][] = []
    socket.on(SocketEvent.Sending, (m: unknown[]) => sent.push(m))
    socket.on(SocketEvent.Receive, (m: unknown[]) => delivered.push(m))

    return {
        socket,
        sent,
        delivered,
        signatures: () => signatures,
        req: () => socket.send(['REQ', SUB, { kinds: [1] }]),
        challenge: () => socket.receive(['AUTH', 'challenge-1']),
        reqsSent: () => sent.filter((m) => m[0] === 'REQ' && m[1] === SUB).length,
    }
}

describe('asksForAuth', () => {
    test('auth-required refusals and the NIP-67 "auth" hint ask; everything else does not', () => {
        assert.equal(asksForAuth(['CLOSED', SUB, 'auth-required: members only']), true)
        assert.equal(asksForAuth(['OK', 'e'.repeat(64), false, 'auth-required: sign in']), true)
        assert.equal(asksForAuth(['EOSE', SUB, ['auth', 'finish']]), true)
        assert.equal(asksForAuth(['EOSE', SUB]), false)
        assert.equal(asksForAuth(['EOSE', SUB, ['finish']]), false)
        assert.equal(asksForAuth(['CLOSED', SUB, 'restricted: not a member']), false)
        assert.equal(asksForAuth(['OK', 'e'.repeat(64), true, 'auth-required: odd']), false)
    })
})

describe('a declined challenge no longer jams the socket', () => {
    test('CORE PROOF (never): the EOSE of a REQ reaches the caller although the relay challenged', async () => {
        const s = setup('never')
        s.challenge()
        s.req()
        s.socket.receive(['EOSE', SUB])
        await settle()

        assert.equal(s.socket.auth.status, AuthStatus.DeniedSignature)
        assert.ok(s.delivered.some((m) => m[0] === 'EOSE'), 'the EOSE was swallowed — the request hangs until its timeout')
        assert.equal(s.signatures(), 0)
    })

    test('never: an auth-required refusal reaches the caller instead of silence', async () => {
        const s = setup('never')
        s.challenge()
        s.req()
        s.socket.receive(['CLOSED', SUB, 'auth-required: members only'])
        await settle()

        assert.ok(s.delivered.some((m) => m[0] === 'CLOSED'))
        assert.equal(s.signatures(), 0)
    })

    test('never, relay refuses without ever challenging: the refusal is handed over', async () => {
        const s = setup('never')
        s.req()
        s.socket.receive(['CLOSED', SUB, 'auth-required: members only'])
        await settle()

        assert.ok(s.delivered.some((m) => m[0] === 'CLOSED'))
    })
})

describe('on-demand: a foreign relay gets AUTH only when it asks, and the request is replayed', () => {
    test('a bare challenge is NOT answered, and answers flow', async () => {
        const s = setup('on-demand')
        s.challenge()
        s.req()
        s.socket.receive(['EOSE', SUB])
        await settle()

        assert.equal(s.signatures(), 0, 'signed on a mere challenge — the pubkey went to a relay that never asked')
        assert.equal(s.socket.auth.status, AuthStatus.None)
        assert.ok(s.delivered.some((m) => m[0] === 'EOSE'))
    })

    test('CORE PROOF: auth-required → AUTH → the same REQ again, and the caller never sees the refusal', async () => {
        const s = setup('on-demand')
        s.challenge()
        s.req()
        s.socket.receive(['CLOSED', SUB, 'auth-required: members only'])
        await settle()

        assert.equal(s.signatures(), 1)
        assert.ok(s.sent.some((m) => m[0] === 'AUTH'), 'no AUTH frame went out')

        s.socket.receive(['OK', AUTH_ID, true, ''])
        await settle()

        assert.equal(s.socket.auth.status, AuthStatus.Ok)
        assert.equal(s.reqsSent(), 2, 'the refused REQ was not replayed after AUTH')
        assert.equal(s.delivered.some((m) => m[0] === 'CLOSED'), false, 'the caller saw a refusal that AUTH resolved')
    })

    test('a refused EVENT is replayed after AUTH as well', async () => {
        const s = setup('on-demand')
        const event = { id: 'e'.repeat(64), kind: 1, content: '', tags: [], created_at: 1, pubkey: 'b'.repeat(64), sig: 'c'.repeat(128) }
        s.challenge()
        s.socket.send(['EVENT', event])
        s.socket.receive(['OK', event.id, false, 'auth-required: sign in to publish'])
        await settle()
        s.socket.receive(['OK', AUTH_ID, true, ''])
        await settle()

        assert.equal(s.sent.filter((m) => m[0] === 'EVENT').length, 2)
    })

    test('the NIP-67 "auth" hint on EOSE is a demand too', async () => {
        const s = setup('on-demand')
        s.challenge()
        s.req()
        s.socket.receive(['EOSE', SUB, ['auth']])
        await settle()

        assert.equal(s.signatures(), 1)
    })

    test('a refusal that arrives before the challenge is answered once the challenge comes', async () => {
        const s = setup('on-demand')
        s.req()
        s.socket.receive(['CLOSED', SUB, 'auth-required: members only'])
        await settle()
        assert.equal(s.signatures(), 0)

        s.challenge()
        await settle()
        assert.equal(s.signatures(), 1)
    })
})

describe('eager: our own relays, as before', () => {
    test('the challenge is signed at once', async () => {
        const s = setup('eager')
        s.challenge()
        await settle()

        assert.equal(s.signatures(), 1)
    })
})

describe('which relay gets which mode (`authModeFor` in welshmanInstance.ts)', () => {
    const PK = 'd'.repeat(64)
    const lists = { read: ['wss://my-inbox.example/'], write: ['wss://my-outbox.example'], messaging: ['wss://my-dm.example/'] }
    const fakeApp = (pubkey?: string, groupTags: string[][] = []) =>
        ({
            user: pubkey ? { pubkey } : undefined,
            use: (plugin: { name: string }) =>
                plugin.name === 'RelayLists'
                    ? { readUrls: () => ({ get: () => lists.read }), writeUrls: () => ({ get: () => lists.write }) }
                    : { urls: () => ({ get: () => lists.messaging }) },
            repository: { query: () => (groupTags.length ? [{ created_at: 1, tags: groupTags }] : []) },
        }) as never
    const at = (url: string) => ({ url }) as never

    test('no user → never; the user’s own 10002/10050/10009 relays → eager; anything else → on-demand', async () => {
        const { authModeFor } = await import('./welshmanInstance.ts')

        assert.equal(authModeFor(fakeApp(), at('wss://my-inbox.example/')), 'never')
        assert.equal(authModeFor(fakeApp(PK), at('wss://my-inbox.example/')), 'eager')
        assert.equal(authModeFor(fakeApp(PK), at('wss://my-outbox.example/')), 'eager', 'normalisation: the list entry has no trailing slash')
        assert.equal(authModeFor(fakeApp(PK), at('wss://my-dm.example/')), 'eager')
        assert.equal(authModeFor(fakeApp(PK, [['group', 'abc', 'wss://joined-space.example']]), at('wss://joined-space.example/')), 'eager')
        assert.equal(authModeFor(fakeApp(PK, [['r', 'wss://listed.example/']]), at('wss://listed.example/')), 'eager')
        assert.equal(authModeFor(fakeApp(PK), at('wss://someone-elses-outbox.example/')), 'on-demand')
    })
})
