/**
 * Regression carrier for the space join queue (`deriveSpaceJoinRequests`,
 * `js/actionItems.ts`).
 *   node --test packages/einundzwanzig-group/js/joinQueueQuelle.test.ts
 *
 * Third and last carrier of the P5 `Rooms` migration, after `roomMembersQuelle.test.ts`
 * and `roomMetaQuelle.test.ts`. Unlike those two this one guards a wrapper that pulls in
 * BOTH directions — measured against `app.use(Rooms).pendingJoins` with identical inputs:
 *
 * **What `Rooms` gets right and our own fold did not.** A request is answered by the
 * latest moderation op on that pubkey, not by the membership list. Ours only pruned on
 * "is a member now" or "a newer 9022 exists", so a 9001 — which produces no 9022 —
 * resurrected the request:
 *
 *     9021, approved via 9000, later kicked via 9001   ours: OPEN AGAIN   Rooms: pruned
 *     9021, refused directly via 9001                  ours: OPEN AGAIN   Rooms: pruned
 *
 * The old code knew half of this: `bridge.ts acceptJoin` deletes the 9021 from the
 * repository by hand, with a comment naming exactly this resurrection. That workaround
 * only ever covered the accept path — a refusal by 9001 (from the members view, or by a
 * second admin) kept coming back.
 *
 * **What we keep and `Rooms` does not know.** `pendingJoins` returns raw 9021 events:
 *
 *     open (non-closed) room                           ours: none        Rooms: pending
 *     9021 naming a room that does not exist           ours: none        Rooms: pending
 *
 * The first is protocol truth on this relay: zooid auto-approves joins to open rooms and
 * writes the pubkey straight into the 39002, so nothing is ever pending there. The second
 * matters more: `h` is attacker-chosen, so anyone can publish a 9021 for an invented room
 * and land in every admin's queue — and `acceptJoin` would answer it with a 9000 for a
 * room nobody created.
 *
 * `isClosed` comes from the room metadata converted in stage 2, so this wrapper sits on
 * top of that one: without the relay-signature check there, `closed` itself was forgeable.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { get } from 'svelte/store'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { Relays } from '@welshman/app'
import { app } from './welshmanInstance.ts'
import { ROOM_META, ROOM_ADMINS, ROOM_MEMBERS, ROOM_JOIN, ROOM_LEAVE, ROOM_ADD_MEMBER, ROOM_REMOVE_MEMBER } from './welshmanKinds.ts'

let runNr = 0
const nextUrl = (): string => `wss://p5join-${++runNr}.example/`
const T = (): number => Math.floor(Date.now() / 1000)

/**
 * Sets up a space with one room (closed unless told otherwise), one admin, and returns
 * the tools to add events plus the keys involved.
 */
const space = (roomTags: string[][] = [['closed', '']]) => {
    const url = nextUrl()
    const relaySk = generateSecretKey()
    const adminSk = generateSecretKey()
    const userSk = generateSecretKey()
    app.use(Relays).set(url, { url, self: getPublicKey(relaySk) } as never)

    const add = (sk: Uint8Array, kind: number, tags: string[][], created_at: number): void => {
        const event = finalizeEvent({ kind, created_at, tags, content: '' }, sk)
        app.repository.publish(event as never)
        app.tracker.track(event.id, url)
    }
    const t = T()
    add(relaySk, ROOM_META, [['d', 'r'], ['name', 'Room'], ...roomTags], t)
    add(relaySk, ROOM_ADMINS, [['d', 'r'], ['p', getPublicKey(adminSk)]], t)
    add(relaySk, ROOM_MEMBERS, [['d', 'r'], ['p', getPublicKey(adminSk)]], t)

    return {
        url,
        t,
        adminSk,
        userSk,
        userPk: getPublicKey(userSk),
        byRelay: (kind: number, tags: string[][], at: number) => add(relaySk, kind, tags, at),
        by: (sk: Uint8Array, kind: number, tags: string[][], at: number) => add(sk, kind, tags, at),
    }
}

const queue = async (url: string): Promise<string[]> => {
    const { deriveSpaceJoinRequests } = await import('./actionItems.ts')
    return (get(deriveSpaceJoinRequests(url)) as { pubkey: string }[]).map((v) => v.pubkey)
}

test('a join request for a closed room is open', async () => {
    const s = space()
    s.by(s.userSk, ROOM_JOIN, [['h', 'r']], s.t + 5)

    assert.deepEqual(await queue(s.url), [s.userPk])
})

test('an OPEN room produces no open request — the relay approves those itself', async () => {
    const s = space([])
    s.by(s.userSk, ROOM_JOIN, [['h', 'r']], s.t + 5)

    assert.deepEqual(await queue(s.url), [])
})

test('a request naming a room that does not exist stays out of the queue', async () => {
    const s = space()
    // `h` is chosen by whoever signs the 9021 — nothing stops a stranger from inventing one.
    s.by(s.userSk, ROOM_JOIN, [['h', 'ghost']], s.t + 5)

    assert.deepEqual(await queue(s.url), [], 'otherwise anyone could fill every admin queue')
})

test('a withdrawn request (newer 9022) is gone', async () => {
    const s = space()
    s.by(s.userSk, ROOM_JOIN, [['h', 'r']], s.t + 5)
    s.by(s.userSk, ROOM_LEAVE, [['h', 'r']], s.t + 9)

    assert.deepEqual(await queue(s.url), [])
})

test('an approved request (9000 by an admin) is gone', async () => {
    const s = space()
    s.by(s.userSk, ROOM_JOIN, [['h', 'r']], s.t + 5)
    s.by(s.adminSk, ROOM_ADD_MEMBER, [['h', 'r'], ['p', s.userPk]], s.t + 9)

    assert.deepEqual(await queue(s.url), [])
})

test('a kick after approval does NOT reopen the request', async () => {
    const s = space()
    s.by(s.userSk, ROOM_JOIN, [['h', 'r']], s.t + 5)
    s.by(s.adminSk, ROOM_ADD_MEMBER, [['h', 'r'], ['p', s.userPk]], s.t + 9)
    // A 9001 produces no 9022, and the pubkey drops out of the member set again.
    s.by(s.adminSk, ROOM_REMOVE_MEMBER, [['h', 'r'], ['p', s.userPk]], s.t + 20)

    assert.deepEqual(await queue(s.url), [], 'the request was answered — twice, in fact')
})

test('a direct refusal by 9001 answers the request', async () => {
    const s = space()
    s.by(s.userSk, ROOM_JOIN, [['h', 'r']], s.t + 5)
    s.by(s.adminSk, ROOM_REMOVE_MEMBER, [['h', 'r'], ['p', s.userPk]], s.t + 9)

    assert.deepEqual(await queue(s.url), [])
})

test('a 9001 OLDER than the request does not answer it', async () => {
    const s = space()
    // Refused once, asked again afterwards: that is a new request, not an answered one.
    s.by(s.adminSk, ROOM_REMOVE_MEMBER, [['h', 'r'], ['p', s.userPk]], s.t + 5)
    s.by(s.userSk, ROOM_JOIN, [['h', 'r']], s.t + 9)

    assert.deepEqual(await queue(s.url), [s.userPk])
})
