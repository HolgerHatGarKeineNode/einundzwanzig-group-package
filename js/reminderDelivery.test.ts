/**
 * P5 — **contract test against the installed welshman, not against a rebuild**: which
 * callback does a NIP-ER *due signal* actually land in?
 *
 *   node --test --experimental-strip-types packages/einundzwanzig-group/js/reminderDelivery.test.ts
 *
 * ── Why this question decides whether the feature works at all ──────────────────
 *
 * NIP-ER's delivery model is unusual: when `not_before` passes, a push-mode relay
 * re-sends the **same, unchanged, already-delivered** event ("a due signal … is not a new
 * event and is not a delivery guarantee"). Buzz does exactly that — its scheduler polls
 * every 10 s and republishes the original signed event to the author's open subscription
 * (`buzz-relay/src/main.rs:728-848`), and its NIP-11 advertises
 * `due_delivery_mode: "push"`.
 *
 * The spec also warns, in as many words, that a client stack can eat that signal:
 * *"clients SHOULD ensure the receive path for `kind:30300` notifications does not
 * suppress repeated `EVENT` messages by id; pool-level duplicate-id filtering can
 * otherwise drop due-time redelivery before application code runs."*
 *
 * welshman **is** such a stack. `@welshman/net` `request.js` routes every arriving event
 * through a per-request `Tracker` and branches before it ever reaches `onEvent`:
 *
 *     if (tracker.track(event.id, url)) { options.onDuplicate?.(event, url) }
 *     else if (…isDeleted…) else if (…!isEventValid…) else if (…!matchFilters…)
 *     else { options.onEvent?.(event, url); events.push(event) }
 *
 * So a surface wired only to `onEvent` would show a reminder as pending forever while the
 * relay was announcing it as due, once every ten seconds, correctly. That is not a bug
 * anyone would find by reading our own code — hence this file.
 *
 * **The measurement runs through `js/welshmanNet.ts`'s `request`, the same function
 * `reminders.ts` calls**, not through a hand-rolled call: a measurement that uses a
 * different path than the measured code proves nothing about the measured code.
 */
import { test, describe, after } from 'node:test'
import assert from 'node:assert/strict'
import { app } from './welshmanApp.ts'
import { MockAdapter, type AbstractAdapter, type ClientMessage } from '@welshman/net'
import { request } from './welshmanNet.ts'
import { normalizeRelayUrl, type TrustedEvent } from '@welshman/util'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { EVENT_REMINDER } from './reminderModels.ts'

const URL_ = normalizeRelayUrl('wss://buzz.test.invalid/')
const secret = generateSecretKey()
const author = getPublicKey(secret)

/**
 * A real, signed 30300 — welshman's default `isEventValid` is `verifyEvent`, so a faked
 * event would be dropped one branch further down and the measurement would be about the
 * wrong branch.
 */
const reminder = finalizeEvent(
    {
        kind: EVENT_REMINDER,
        created_at: 1_800_000_000,
        tags: [
            ['d', '0f1e2d3c4b5a69788796a5b4c3d2e1f0'],
            ['not_before', '1800000060'],
            ['alt', 'Encrypted reminder'],
        ],
        content: 'nip44-ciphertext-placeholder',
    },
    secret,
) as unknown as TrustedEvent

/** A second, unrelated reminder — the counter-proof needs two distinct ids. */
const other = finalizeEvent(
    {
        kind: EVENT_REMINDER,
        created_at: 1_800_000_001,
        tags: [['d', 'ffeeddccbbaa99887766554433221100'], ['alt', 'Encrypted reminder']],
        content: 'nip44-ciphertext-placeholder-2',
    },
    secret,
) as unknown as TrustedEvent

/**
 * A relay that answers a REQ with `send`, then EOSE, then — like the NIP-ER scheduler —
 * repeats the events in `redeliver` on the very same subscription.
 */
const makeAdapter = (send: TrustedEvent[], redeliver: TrustedEvent[]): MockAdapter => {
    const adapter: MockAdapter = new MockAdapter(URL_, (message: ClientMessage) => {
        if (message[0] !== 'REQ') {
            return
        }
        const subId = message[1] as string
        setTimeout(() => {
            for (const event of send) {
                adapter.receive(['EVENT', subId, event])
            }
            adapter.receive(['EOSE', subId])
            for (const event of redeliver) {
                adapter.receive(['EVENT', subId, event])
            }
        }, 0)
    })

    return adapter
}

/** Run one live-style subscription and count which callback saw what. */
const measure = async (send: TrustedEvent[], redeliver: TrustedEvent[]) => {
    const onEvent: string[] = []
    const onDuplicate: string[] = []
    const controller = new AbortController()
    const done = request({
        relays: [URL_],
        signal: controller.signal,
        filters: [{ kinds: [EVENT_REMINDER], authors: [author], limit: 0 }],
        onEvent: (event: TrustedEvent) => onEvent.push(event.id),
        onDuplicate: (event: TrustedEvent) => onDuplicate.push(event.id),
        onEose: () => {
            // Give the redelivery a turn of the loop before closing the subscription —
            // this is the moment the relay's scheduler would fire into.
            setTimeout(() => controller.abort(), 20)
        },
    })
    await done

    return { onEvent, onDuplicate }
}

describe('NIP-ER due signal: which callback sees the redelivery', () => {
    const originalGetAdapter = app.netContext.getAdapter

    after(() => {
        app.netContext.getAdapter = originalGetAdapter
    })

    const arm = (send: TrustedEvent[], redeliver: TrustedEvent[]) => {
        app.netContext.getAdapter = (): AbstractAdapter => makeAdapter(send, redeliver)
    }

    test('the due redelivery of an already-seen reminder lands in `onDuplicate`, NOT `onEvent`', async () => {
        arm([reminder], [reminder])
        const { onEvent, onDuplicate } = await measure([reminder], [reminder])

        assert.deepEqual(onEvent, [reminder.id], 'the first arrival is a normal event')
        assert.deepEqual(
            onDuplicate,
            [reminder.id],
            'and the due signal — the same id again on the same subscription — is a DUPLICATE. ' +
                'A surface wired only to onEvent never learns that the reminder came due.',
        )
    })

    test('COUNTER-PROOF: two different ids both land in `onEvent`', async () => {
        // Without this case the test above would also be green on a stack that routes
        // *everything* to onDuplicate, or on a mock that never delivers twice.
        arm([reminder], [other])
        const { onEvent, onDuplicate } = await measure([reminder], [other])

        assert.deepEqual(onEvent, [reminder.id, other.id], 'distinct ids are not duplicates of each other')
        assert.deepEqual(onDuplicate, [], 'and nothing was suppressed')
    })

    test('a THIRD delivery of the same id is a duplicate too — the signal repeats, and so must we', async () => {
        // Buzz claims a due reminder before publishing (`delivered_at`), so in principle it
        // fires once — but NIP-ER explicitly allows a relay to "send due signals early,
        // late, repeatedly, or not at all", and a client that only handled the second
        // arrival would be relying on the one behaviour the spec refuses to promise.
        arm([reminder], [reminder, reminder])
        const { onEvent, onDuplicate } = await measure([reminder], [reminder, reminder])

        assert.deepEqual(onEvent, [reminder.id])
        assert.deepEqual(onDuplicate, [reminder.id, reminder.id])
    })
})
