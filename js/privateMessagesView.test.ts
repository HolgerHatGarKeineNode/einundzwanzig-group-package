/**
 * **What the `/messages` SCREEN shows — asserted through the real store, not next to it.**
 *   node --test --experimental-strip-types packages/einundzwanzig-group/js/privateMessagesView.test.ts
 *
 * ── Why this file exists, and it is a mutation probe that found the gap ─────────
 *
 * The P7 audit's F2 is that a SIGNED plaintext kind 14 carrying `["p", <victim>]` passes
 * `verifyEvent`, enters the shared repository like any other event — every `{ids}` loader
 * pulls one in — and used to appear on the screen that promises nobody is reading along.
 *
 * The first assurance for it asserted on `wrapIngest`'s store. Mutation probe N5 pointed
 * `derivePrivateRumors` back at the repository and **everything stayed green**: the test
 * checked the neighbour of the thing it was about. This file goes through
 * `wirePrivateMessages` and reads `$store.privateMessages.conversations` — the value the
 * markup renders — so the assurance is about the view and not about a store next to it.
 *
 * The positive control is not decoration: a store that never shows anything passes the
 * first case too.
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readable } from 'svelte/store'
import type { AbstractAdapter, ClientMessage } from '@welshman/net'
import type { PrivateMessagesStore } from './privateMessages.ts'

const gespeichert = new Map<string, string>()
;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string): string | null => gespeichert.get(k) ?? null,
    setItem: (k: string, v: string): void => void gespeichert.set(k, v),
    removeItem: (k: string): void => void gespeichert.delete(k),
}

const { app, Relays } = await import('./welshmanApp.ts')
const { loginWithNip01 } = await import('./welshmanSession.ts')
const { activeSpaceUrl } = await import('./groups.ts')
const { wirePrivateMessages } = await import('./privateMessages.ts')
const { addOwnPrivateMessage, clearPrivateRumors } = await import('./wrapIngest.ts')
const { MockAdapter } = await import('@welshman/net')
const { Relay } = await import('@welshman/domain')
const { getHash, getPubkey, hash, makeSecret, normalizeRelayUrl } = await import('@welshman/util')
const { Nip01Signer } = await import('@welshman/signer')

const URL_ = normalizeRelayUrl('wss://view.test.invalid/')
const MY_SECRET = makeSecret()
const ME = getPubkey(MY_SECRET)
const OTHER_SECRET = makeSecret()
const OTHER = getPubkey(OTHER_SECRET)
const now = (): number => Math.round(Date.now() / 1000)
const settle = (ms = 400): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

let store: PrivateMessagesStore

before(async () => {
    app.netContext.getAdapter = (): AbstractAdapter => new MockAdapter(URL_, (_m: ClientMessage) => {})
    // A NIP-11 doc placed by hand, same seam as `dmMount.test.ts`: without it
    // `deriveSpaceKind` answers `'unknown'`, which denies, and the cases would measure the
    // capability gate instead of the view.
    app.use(Relays).set(URL_, new Relay(URL_, { software: 'https://github.com/coracle-social/zooid', self: 'f'.repeat(64) }))
    loginWithNip01(MY_SECRET)
    activeSpaceUrl.set(URL_)
    await settle()

    const alpine: Record<string, unknown> = {}
    wirePrivateMessages(
        {
            store: (name: string, value?: unknown): unknown => {
                if (value !== undefined) {
                    alpine[name] = value
                }

                return alpine[name]
            },
        },
        {
            t: (text: string) => text,
            displayProfileByPubkey: (pubkey: string) => pubkey.slice(0, 8),
            profilesByPubkey: readable(new Map()),
            warmProfiles: () => undefined,
            deriveSpaceDirectory: () => readable({ members: [] }),
            watchSpaceDirectory: () => undefined,
        },
    )
    store = alpine.privateMessages as PrivateMessagesStore
    await settle()
})

after(() => {
    clearPrivateRumors()
    app.pool.remove(URL_)
})

test('PRECONDITION: the screen starts empty', () => {
    assert.equal(store.conversations.length, 0)
})

test('F2: a SIGNED plaintext kind 14 in the repository never becomes a conversation', async () => {
    // It gets there the ordinary way — this is what `verifyEvent` lets through and what
    // any `{ids}` loader pulls in. The assurance is that the screen does not show it.
    const sender = Nip01Signer.fromSecret(OTHER_SECRET)
    const plain = await sender.sign(
        hash({
            kind: 14,
            pubkey: OTHER,
            created_at: now(),
            content: 'PLAINTEXT-ON-THE-RELAY',
            tags: [['p', ME]],
        }),
    )
    app.repository.publish(plain as never)
    await settle()

    assert.equal(app.repository.query([{ kinds: [14] }]).length, 1, 'precondition: it is in the repository')
    assert.equal(
        store.conversations.some((row) => row.preview === 'PLAINTEXT-ON-THE-RELAY'),
        false,
        'plaintext under the lock symbol',
    )
})

test('POSITIVE CONTROL: a properly unwrapped message DOES become a conversation', async () => {
    // Without this the case above would also pass on a screen that shows nothing at all.
    const body = {
        kind: 14,
        pubkey: OTHER,
        created_at: now(),
        content: 'SEALED-TO-ME',
        tags: [['p', ME]],
    }
    assert.equal(addOwnPrivateMessage({ ...body, id: getHash(body as never) } as never), true)
    await settle()

    const row = store.conversations.find((entry) => entry.preview === 'SEALED-TO-ME')
    assert.ok(row, 'an unwrapped message reaches the screen')
    assert.deepEqual(row?.others, [OTHER])
})
