/**
 * Carrier for the F2 hardening: the P9 revocation lock must only accept evidence that the
 * thing it guards would accept — a 39002 signed by the relay's NIP-11 `self`.
 *   node --test packages/einundzwanzig-group/js/roomMembershipGate.test.ts
 *
 * Three reads used to take any 39002: `readMembership` (which lifts a mark),
 * `revokeRoomMembership`'s stale-list lookup (which records what was in force), and
 * `reloadRoomMembership`'s `listed` (which reports whether a re-join succeeded).
 *
 * **This file exists because "not unit-pinnable" was wrong.** The reasoning was that the
 * three sit behind a module-level `load()` with no injection seam. The seam is in this
 * repo and predates the claim: `js/welshmanLoad.test.ts` swaps `app.netContext.getAdapter`
 * for a `MockAdapter` and answers the REQ itself — its own docblock names
 * `reloadRoomMembership` and `revokeRoomMembership` as the reason it exists. Same trick
 * here, no production change.
 *
 * Every case has its positive control: a relay-signed list in the same position must do
 * what the forged one may not. Without those the file would pass just as happily if the
 * membership path were broken outright.
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { get } from 'svelte/store'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { MockAdapter, type AbstractAdapter } from '@welshman/net'
import type { ClientMessage } from '@welshman/net'
import { Relays } from '@welshman/app'
import { app } from './welshmanInstance.ts'
import { pubkey } from './welshmanSession.ts'
import { reloadRoomMembership, revokeRoomMembership, roomMembersByUrl } from './groups.ts'

const URL_ = 'wss://f2gate.example/'
const H = 'privatraum'

const relaySk = generateSecretKey()
const relayPk = getPublicKey(relaySk)
const strangerSk = generateSecretKey()
const meSk = generateSecretKey()
const mePk = getPublicKey(meSk)

/** A 39002 for our room, listing `mePk`, signed by whoever is passed in. */
const memberList = (sk: Uint8Array, createdAt: number) =>
    finalizeEvent(
        { kind: 39002, created_at: createdAt, tags: [['d', H], ['p', mePk]], content: '' },
        sk,
    )

/** What the mocked relay answers the next REQ with. Swapped per test. */
let antwort: ReturnType<typeof memberList> | null = null

/**
 * The adapter has to be reachable from inside its own message handler to answer, so it is
 * built in two steps rather than in one expression.
 */
const adapterBauen = (adapterUrl: string): MockAdapter => {
    let self: MockAdapter
    // The url must come from the caller: a MockAdapter fixed to one address answers only
    // that address, and a test using a second url would silently receive nothing — passing
    // for lack of an answer rather than because the code did the right thing. That
    // happened once here and cost a calibration round.
    self = new MockAdapter(adapterUrl, (message: ClientMessage) => {
        if (message[0] !== 'REQ') {
            return
        }
        const subId = message[1] as string
        setTimeout(() => {
            if (antwort) {
                self.receive(['EVENT', subId, antwort])
            }
            self.receive(['EOSE', subId])
        }, 0)
    })

    return self
}

const originalGetAdapter = app.netContext.getAdapter
const originalPubkey = pubkey.get()

before(() => {
    app.netContext.getAdapter = (adapterUrl: string): AbstractAdapter => adapterBauen(adapterUrl)
    app.use(Relays).set(URL_, { url: URL_, self: relayPk } as never)
})

after(() => {
    app.netContext.getAdapter = originalGetAdapter
    pubkey.set(originalPubkey)
})

// ── `listed` in reloadRoomMembership ───────────────────────────────────────────

test('a re-join is NOT confirmed by a list signed by a stranger', async () => {
    antwort = memberList(strangerSk, 1_700_000_100)

    assert.equal(
        await reloadRoomMembership(URL_, H, mePk, true),
        false,
        'a self-made 39002 would otherwise report a membership the relay never granted',
    )
})

test('control: a relay-signed list DOES confirm the re-join', async () => {
    antwort = memberList(relaySk, 1_700_000_200)

    assert.equal(await reloadRoomMembership(URL_, H, mePk, true), true)
})

// ── readMembership: what may lift a revocation mark ────────────────────────────

/** Sets the mark without touching the network (`revoke` runs before the `load`). */
const markeSetzen = async (): Promise<void> => {
    const vorher = pubkey.get()
    pubkey.set(undefined)
    await revokeRoomMembership(URL_, H)
    pubkey.set(vorher)
}

const binMitglied = (): boolean => (get(roomMembersByUrl).get(URL_)?.get(H) ?? new Set<string>()).has(mePk)

test('a stranger-signed list does not lift the mark', async () => {
    pubkey.set(mePk)
    // The relay's own list puts us in the room to begin with.
    app.repository.publish(memberList(relaySk, 1_700_000_300) as never)
    app.tracker.track(memberList(relaySk, 1_700_000_300).id, URL_)
    await markeSetzen()
    assert.equal(binMitglied(), false, 'precondition: the mark is in force')

    antwort = memberList(strangerSk, 1_700_000_400)
    await reloadRoomMembership(URL_, H, mePk, true)

    assert.equal(binMitglied(), false, 'the lock must not accept evidence its subject would reject')
})

test('control: a relay-signed list lifts the mark', async () => {
    pubkey.set(mePk)
    antwort = memberList(relaySk, 1_700_000_500)
    await reloadRoomMembership(URL_, H, mePk, true)

    assert.equal(binMitglied(), true, 'otherwise no composer would ever come back after a re-join')
})

// ── The residual: a mark recorded from nothing is a mark that lifts itself ──────
//
// The signature check used to sit on the ALREADY SELECTED newest 39002. A foreign list
// with a newer `created_at` won that selection, failed the check, and collapsed to
// `undefined` — indistinguishable from "no list known". The mark was then written with
// `staleListEventId=''` and `staleCreatedAt=0`, which makes `confirmsMembership`'s last
// two conditions vacuous: any list naming us lifts it, including a stale cached one.
//
// The same collapse needed no attacker at all — a cold start where the CLOSED arrives
// before the NIP-11 response produced it too, which is the likelier trigger.

test('a foreign NEWER list does not JAM the mark', async () => {
    pubkey.set(mePk)
    const jetzt = Math.floor(Date.now() / 1000)
    // The relay's real list, and a foreign one dated between it and now. Ungated, the
    // foreign one wins the selection and its `created_at` becomes the bar a re-join has to
    // clear — a bar the relay never set.
    const genuine = memberList(relaySk, jetzt - 1000)
    app.repository.publish(genuine as never)
    app.tracker.track(genuine.id, URL_)
    const foreign = memberList(strangerSk, jetzt - 500)
    app.repository.publish(foreign as never)
    app.tracker.track(foreign.id, URL_)

    await markeSetzen()
    assert.equal(binMitglied(), false, 'precondition: the mark is in force')

    // Dated between the two: newer than the relay's list, older than the foreign one.
    // Gated, this is a valid re-join proof. Ungated, the foreign list keeps it out.
    antwort = memberList(relaySk, jetzt - 750)
    await reloadRoomMembership(URL_, H, mePk, true)

    assert.equal(binMitglied(), true, 'a stranger must not be able to raise the bar for our own re-join')
})

test('with no relay-signed list known at revocation, a stale list cannot lift the mark', async () => {
    // Cold start: the CLOSED arrives before the NIP-11 response, so nothing relay-signed is
    // known when the mark is written. Its floor is then the revocation moment; with `0`
    // instead the mark would be vacuous and the first list naming us would lift it — the
    // composer would come back for a user the relay just kicked.
    // Its own url AND its own room id: the repository and the marks are process-wide, and
    // sharing either with the tests above masked this case — it passed for lack of state
    // rather than because the floor held. Verified: run alone it is red under the
    // mutation, green without.
    const url = 'wss://f2gate-cold.example/'
    const kaltH = 'kaltstart-raum'
    const jetzt = Math.floor(Date.now() / 1000)

    // Revoke while `self` is still unknown for this url.
    pubkey.set(undefined)
    await revokeRoomMembership(url, kaltH)
    pubkey.set(mePk)

    // NIP-11 arrives afterwards, and with it the relay's list — but an OLD one, the kind
    // that sits in the cache after a kick.
    app.use(Relays).set(url, { url, self: relayPk } as never)
    const alt = finalizeEvent(
        { kind: 39002, created_at: jetzt - 5000, tags: [['d', kaltH], ['p', mePk]], content: '' },
        relaySk,
    )
    app.repository.publish(alt as never)
    app.tracker.track(alt.id, url)

    antwort = alt
    await reloadRoomMembership(url, kaltH, mePk, true)

    const drin = (get(roomMembersByUrl).get(url)?.get(kaltH) ?? new Set<string>()).has(mePk)
    assert.equal(drin, false, 'a list from before the kick is no proof of a re-join')
})
