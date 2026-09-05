/**
 * **`js/giftWrap.ts`: the rules, plus a CONTRACT TEST against welshman's own wrap.**
 *   node --test --experimental-strip-types packages/einundzwanzig-group/js/giftWrap.test.ts
 *
 * Plan: `docs/plans/2026-09-05T0125-community-features-herbst.md`, phase P7. The phase
 * boundary asks for it in one sentence, quoted verbatim because a translated requirement
 * is a paraphrased one:
 * "Eigenbau an Krypto ist hier unvermeidbar, aber er gehört in eine eigene, klein gehaltene Datei — mit einem Contract-Test gegen einen von welshman erzeugten Wrap, damit die eigene Hülle nachweislich dieselbe Form hat."
 *
 * So the centre of this file is not "does it run" but **"is it the same envelope"**: an
 * own wrap and a welshman wrap of the same rumor are unwrapped by the same recipient
 * with welshman's own `unwrap`, and the two rumors must be identical field for field. If
 * they ever diverge — a missing tag, a different kind, a seal built differently — this
 * test says so before a foreign client has to.
 *
 * The one difference that is intended is asserted as a difference, not glossed over:
 * welshman's `created_at` can be up to 1e5 s in the past, ours never leaves the window a
 * Buzz relay accepts (measured 900 s, `p7-messung-a-wrap-drift.txt`).
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { WRAP, SEAL, getPubkey, makeSecret, verifyEvent, type StampedEvent } from '@welshman/util'
import { Nip01Signer, unwrap, wrap as welshmanWrap } from '@welshman/signer'
import { MAX_WRAP_BACKDATE_SECONDS, buildGiftWrap, wrapCreatedAt } from './giftWrap.ts'

const NOW = 1_788_600_000

const makeSigner = () => {
    const secret = makeSecret()

    return { signer: Nip01Signer.fromSecret(secret), pubkey: getPubkey(secret) }
}

/** The same rumor body for both builders, with an explicit stamp so ids can be compared. */
const template = (): StampedEvent =>
    ({
        kind: 14,
        content: 'contract',
        created_at: NOW - 5,
        tags: [['p', 'x']],
    }) as StampedEvent

describe('wrapCreatedAt', () => {
    test('never in the future — the largest draw is still now()', () => {
        assert.equal(wrapCreatedAt(NOW, MAX_WRAP_BACKDATE_SECONDS, () => 0), NOW)
    })

    test('never further back than the window a Buzz relay accepts', () => {
        const earliest = wrapCreatedAt(NOW, MAX_WRAP_BACKDATE_SECONDS, () => 0.999_999_9)
        assert.ok(earliest >= NOW - MAX_WRAP_BACKDATE_SECONDS, `earliest was ${NOW - earliest} s back`)
        // The measured gate is 900 s (ingest.rs MAX_TIMESTAMP_DRIFT_SECS); the whole
        // range has to sit inside it with room for a client clock that runs fast.
        assert.ok(NOW - earliest < 900)
    })

    test('a whole number of seconds, even from a fractional clock', () => {
        const value = wrapCreatedAt(NOW + 0.75, MAX_WRAP_BACKDATE_SECONDS, () => 0.5)
        assert.equal(value, Math.floor(value))
    })

    test('it actually varies — a fixed timestamp would defeat the point', () => {
        const draws = new Set([0.1, 0.4, 0.9].map((r) => wrapCreatedAt(NOW, MAX_WRAP_BACKDATE_SECONDS, () => r)))
        assert.equal(draws.size, 3)
    })

    test('a zero window collapses to now() instead of throwing', () => {
        assert.equal(wrapCreatedAt(NOW, 0, () => 0.99), NOW)
    })
})

describe('buildGiftWrap — the envelope', () => {
    test('kind 1059, one p tag, signed by a key that is nobody', async () => {
        const sender = makeSigner()
        const recipient = makeSigner()
        const event = await buildGiftWrap({
            sender: sender.signer,
            recipient: recipient.pubkey,
            template: template(),
            now: NOW,
        })

        assert.equal(event.kind, WRAP)
        assert.deepEqual(event.tags, [['p', recipient.pubkey]])
        assert.equal(verifyEvent(event), true)
        // The wrapper key is ephemeral: it is neither of the two people involved.
        assert.notEqual(event.pubkey, sender.pubkey)
        assert.notEqual(event.pubkey, recipient.pubkey)
    })

    test('two wraps of the same rumor are signed by two different keys', async () => {
        // Reusing the wrapper key even once would link every message of one sender.
        const sender = makeSigner()
        const recipient = makeSigner()
        const one = await buildGiftWrap({
            sender: sender.signer,
            recipient: recipient.pubkey,
            template: template(),
            now: NOW,
        })
        const two = await buildGiftWrap({
            sender: sender.signer,
            recipient: recipient.pubkey,
            template: template(),
            now: NOW,
        })

        assert.notEqual(one.pubkey, two.pubkey)
    })

    test('the sender is not on the outside of the envelope', async () => {
        const sender = makeSigner()
        const recipient = makeSigner()
        const event = await buildGiftWrap({
            sender: sender.signer,
            recipient: recipient.pubkey,
            template: template(),
            now: NOW,
        })

        assert.equal(JSON.stringify({ ...event, content: '' }).includes(sender.pubkey), false)
    })

    test('extra outer tags are kept and the p tag is still added', async () => {
        const sender = makeSigner()
        const recipient = makeSigner()
        const event = await buildGiftWrap({
            sender: sender.signer,
            recipient: recipient.pubkey,
            template: template(),
            tags: [['expiration', '123']],
            now: NOW,
        })

        assert.deepEqual(event.tags, [
            ['expiration', '123'],
            ['p', recipient.pubkey],
        ])
    })
})

describe('CONTRACT: the own envelope against welshman’s', () => {
    test('both unwrap to the identical rumor', async () => {
        const sender = makeSigner()
        const recipient = makeSigner()

        const ours = await buildGiftWrap({
            sender: sender.signer,
            recipient: recipient.pubkey,
            template: template(),
            now: NOW,
        })
        const theirs = await welshmanWrap(
            sender.signer,
            Nip01Signer.ephemeral(),
            recipient.pubkey,
            template(),
        )

        const ourRumor = await unwrap(recipient.signer, ours)
        const theirRumor = await unwrap(recipient.signer, theirs)

        assert.deepEqual(ourRumor, theirRumor)
        assert.equal(ourRumor.pubkey, sender.pubkey)
        assert.equal(ourRumor.kind, 14)
    })

    test('same field set and same kinds on both layers', async () => {
        const sender = makeSigner()
        const recipient = makeSigner()
        const ours = await buildGiftWrap({
            sender: sender.signer,
            recipient: recipient.pubkey,
            template: template(),
            now: NOW,
        })
        const theirs = await welshmanWrap(
            sender.signer,
            Nip01Signer.ephemeral(),
            recipient.pubkey,
            template(),
        )

        assert.deepEqual(Object.keys(ours).sort(), Object.keys(theirs).sort())
        assert.equal(ours.kind, theirs.kind)
        // The seal inside is welshman's own `getSeal`, so it must be theirs kind for kind.
        const ourSeal = JSON.parse(await recipient.signer.nip44.decrypt(ours.pubkey, ours.content))
        const theirSeal = JSON.parse(await recipient.signer.nip44.decrypt(theirs.pubkey, theirs.content))
        assert.equal(ourSeal.kind, SEAL)
        assert.equal(theirSeal.kind, SEAL)
        assert.deepEqual(Object.keys(ourSeal).sort(), Object.keys(theirSeal).sort())
        assert.deepEqual(ourSeal.tags, theirSeal.tags)
    })

    test('THE difference: welshman backdates out of the window, we do not', async () => {
        // This is the whole reason the file exists. Asserted as a difference rather than
        // described in prose — if welshman ever narrows `now(5)`, this test says so and
        // the module can go.
        const sender = makeSigner()
        const recipient = makeSigner()
        const draws: number[] = []
        for (let i = 0; i < 40; i++) {
            const theirs = await welshmanWrap(
                sender.signer,
                Nip01Signer.ephemeral(),
                recipient.pubkey,
                template(),
            )
            draws.push(Math.round(Date.now() / 1000) - theirs.created_at)
        }
        const outsideBuzzWindow = draws.filter((back) => back > 900).length
        assert.ok(outsideBuzzWindow > 30, `only ${outsideBuzzWindow} of 40 welshman wraps were outside ±900 s`)

        for (let i = 0; i < 40; i++) {
            const event = await buildGiftWrap({
                sender: sender.signer,
                recipient: recipient.pubkey,
                template: template(),
                now: NOW,
            })
            assert.ok(event.created_at <= NOW)
            assert.ok(NOW - event.created_at <= MAX_WRAP_BACKDATE_SECONDS)
        }
    })
})
