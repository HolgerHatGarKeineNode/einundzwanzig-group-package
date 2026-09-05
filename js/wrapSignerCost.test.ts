/**
 * **P7, DoD 3 — an unsolicited foreign gift wrap must cost the signer NOTHING.**
 *   node --test --experimental-strip-types packages/einundzwanzig-group/js/wrapSignerCost.test.ts
 *
 * ── The defect this measures ─────────────────────────────────────────────────────
 *
 * `isRelayEvent` (`@welshman/net` `message.js`) is `m[0] === "EVENT"` and nothing else —
 * it never looks at the subscription id. So any connected relay may push a correctly
 * signed kind 1059 carrying our `p` tag on a subscription we never opened. With
 * `appPolicyWraps` in the policy list that wrap reaches `Wraps.enqueue`, and the queue
 * decrypts it **at the user's signer**: on NIP-46 a bunker round trip each, on NIP-55 a
 * prompt on the signing device each.
 *
 * Measured before the check existed (`p7-messung-b-signer-kosten.txt`): **25 unsolicited
 * wraps → 25 `nip44.decrypt` calls**. That number is why `appPolicyWraps` was kept out of
 * the policy list until this phase.
 *
 * ── What is measured here, and against what ──────────────────────────────────────
 *
 * Against the REAL app instance — the one `js/welshmanInstance.ts` builds with our real
 * policy list, including the origin check and `appPolicyWraps`. Not a replica: a replica
 * would keep passing after somebody removes the policy from the list.
 *
 * The counter sits on the app's own signer through `user.wrapSigner`, the same seam
 * `appPolicyCacheDecrypt` uses, so it sees every method the app asks of the user. The
 * plaintext cache cannot absorb anything here: every wrap carries its own ciphertext.
 *
 * ── The positive control is not optional ─────────────────────────────────────────
 *
 * A zero on its own proves nothing — an ingest that dropped every wrap would score zero
 * too, and the feature would be silently dead. The third case therefore asks for a wrap
 * the ordinary way and requires it to be decrypted AND unwrapped. Both halves, one file:
 * that is the only shape in which the number means anything.
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import type { AbstractAdapter, ClientMessage } from '@welshman/net'

const gespeichert = new Map<string, string>()
;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string): string | null => gespeichert.get(k) ?? null,
    setItem: (k: string, v: string): void => void gespeichert.set(k, v),
    removeItem: (k: string): void => void gespeichert.delete(k),
}

const { app } = await import('./welshmanApp.ts')
const { loginWithNip01 } = await import('./welshmanSession.ts')
const { MockAdapter, SocketEvent } = await import('@welshman/net')
const { WRAP, getPubkey, hash, makeSecret, normalizeRelayUrl, prep } = await import('@welshman/util')
const { Nip01Signer, getSeal } = await import('@welshman/signer')
const { buildGiftWrap } = await import('./giftWrap.ts')
const { wrapFilters } = await import('./privateMessages.ts')

const URL_ = normalizeRelayUrl('wss://hostile.relay.invalid/')
const N = 25
const MY_SECRET = makeSecret()
const ME = getPubkey(MY_SECRET)
const now = (): number => Math.round(Date.now() / 1000)

/** Every method the app asked of the user's signer, counted by name. */
const calls: Record<string, number> = {}
const decrypts = (): number => (calls['nip44.decrypt'] ?? 0) + (calls['nip04.decrypt'] ?? 0)

/**
 * A wrap addressed to us but encrypted to somebody else — what a hostile or merely noisy
 * relay can produce without any secret of ours: valid signature, our `p` tag, content we
 * could never open. The signature has to be real: the ingest runs `verifyEvent`, and a
 * forged one would be dropped for the wrong reason.
 */
const hostileWrap = async (createdAt = now()) => {
    const wrapper = Nip01Signer.ephemeral()
    const stranger = getPubkey(makeSecret())

    return wrapper.sign(
        hash({
            kind: WRAP,
            pubkey: await wrapper.getPubkey(),
            content: await wrapper.nip44.encrypt(stranger, JSON.stringify({ junk: Math.random() })),
            created_at: createdAt,
            tags: [['p', ME]],
        }),
    )
}

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 400))

let socket: { emit: (event: string, ...args: unknown[]) => void; send: (message: unknown) => void }

before(async () => {
    // No real sockets: the pool would otherwise try to dial the invalid host.
    app.netContext.getAdapter = (): AbstractAdapter => new MockAdapter(URL_, (_message: ClientMessage) => {})
    loginWithNip01(MY_SECRET)
    // The session store hydrates through a subscription; give it its microtask.
    await settle()
    assert.equal(app.user?.pubkey, ME, 'PRECONDITION: the app carries our identity')
    app.user?.wrapSigner((method, thunk) => {
        calls[method] = (calls[method] ?? 0) + 1

        return thunk()
    })
    socket = app.pool.get(URL_) as unknown as typeof socket
})

after(() => {
    // The socket carries a 30 s ping interval; without this the runner waits it out.
    app.pool.remove(URL_)
})

test(`THE MEASUREMENT: ${N} unsolicited wraps cost 0 signer calls`, async () => {
    const wraps = await Promise.all(Array.from({ length: N }, () => hostileWrap()))
    const before_ = decrypts()
    for (const wrap of wraps) {
        // Exactly what a relay can send unasked: a well-formed EVENT frame on a
        // subscription id we never opened.
        socket.emit(SocketEvent.Receive, ['EVENT', 'SUB-WE-NEVER-OPENED', wrap], URL_)
    }
    await settle()

    assert.equal(decrypts() - before_, 0, 'every one of these would be a bunker round trip')
    assert.equal(
        app.repository.query([{ kinds: [WRAP] }]).length,
        0,
        'and none of them reached the repository, so none can reach the disk either',
    )
})

test('our OWN subscription does not authorise a wrap it never asked for', async () => {
    // The attack with one more step: a relay answering a request of ours with something
    // else. A check that only compared subscription ids would wave this through.
    socket.send(['REQ', 'REQ-ours', { kinds: [9], '#h': ['some-room'] }])
    const wrap = await hostileWrap()
    const before_ = decrypts()
    socket.emit(SocketEvent.Receive, ['EVENT', 'REQ-ours', wrap], URL_)
    await settle()

    assert.equal(decrypts() - before_, 0)
    assert.equal(app.repository.query([{ kinds: [WRAP] }]).length, 0)
})

test('a wrap for SOMEBODY ELSE on our own wrap subscription is not ours either', async () => {
    socket.send(['REQ', 'REQ-wraps-a', ...wrapFilters(ME)])
    const wrapper = Nip01Signer.ephemeral()
    const foreign = await wrapper.sign(
        hash({
            kind: WRAP,
            pubkey: await wrapper.getPubkey(),
            content: await wrapper.nip44.encrypt(getPubkey(makeSecret()), '{}'),
            created_at: now(),
            tags: [['p', getPubkey(makeSecret())]],
        }),
    )
    const before_ = decrypts()
    socket.emit(SocketEvent.Receive, ['EVENT', 'REQ-wraps-a', foreign], URL_)
    await settle()

    assert.equal(decrypts() - before_, 0, 'the filter says #p is us; this one is not')
})

test('POSITIVE CONTROL: a wrap we asked for is decrypted and unwrapped', async () => {
    // Without this case the zeros above would also be produced by an ingest that drops
    // every wrap — a mute button scores zero on every measurement there is.
    const senderSecret = makeSecret()
    const sender = Nip01Signer.fromSecret(senderSecret)
    const wanted = await buildGiftWrap({
        sender,
        recipient: ME,
        template: prep({ kind: 14, content: 'solicited', tags: [['p', ME]], created_at: now() } as never, getPubkey(senderSecret)),
        now: now(),
    })

    socket.send(['REQ', 'REQ-wraps-b', ...wrapFilters(ME)])
    const before_ = decrypts()
    socket.emit(SocketEvent.Receive, ['EVENT', 'REQ-wraps-b', wanted], URL_)
    await settle()

    assert.ok(decrypts() - before_ >= 1, 'the wrap we asked for still reaches the signer')
    assert.equal(app.repository.query([{ kinds: [WRAP] }]).length, 1, 'and only this one entered the repository')
    const rumor = app.wrapManager.getRumor(wanted.id)
    assert.equal(rumor?.content, 'solicited', 'the unwrapped message is the one that was sent')
    assert.equal(rumor?.pubkey, getPubkey(senderSecret), 'the author comes out of the seal, not off the envelope')
})

test('the seal is what proves the author — and getSeal is welshman’s, unchanged', async () => {
    // Held here rather than in `giftWrap.test.ts` because it is the reason this whole
    // chain may trust `rumor.pubkey` at all: `unwrap` throws when the seal's pubkey and
    // the rumor's disagree, so a wrap cannot claim an author it was not sealed by.
    const attackerSecret = makeSecret()
    const attacker = Nip01Signer.fromSecret(attackerSecret)
    const victim = getPubkey(makeSecret())
    const lyingRumor = prep({ kind: 14, content: 'not mine', tags: [['p', ME]], created_at: now() } as never, victim)
    const seal = await getSeal(attacker, ME, lyingRumor)
    const wrapper = Nip01Signer.ephemeral()
    const forged = await wrapper.sign(
        hash({
            kind: WRAP,
            pubkey: await wrapper.getPubkey(),
            content: await wrapper.nip44.encrypt(ME, JSON.stringify(seal)),
            created_at: now(),
            tags: [['p', ME]],
        }),
    )

    socket.send(['REQ', 'REQ-wraps-c', ...wrapFilters(ME)])
    socket.emit(SocketEvent.Receive, ['EVENT', 'REQ-wraps-c', forged], URL_)
    await settle()

    assert.equal(
        app.wrapManager.getRumor(forged.id),
        undefined,
        'a rumor whose claimed author did not seal it never becomes a message',
    )
})
