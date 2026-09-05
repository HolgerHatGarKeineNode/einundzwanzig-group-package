/**
 * **The rules of `js/privateMessageModels.ts`, one assertion per rule.**
 *   node --test --experimental-strip-types packages/einundzwanzig-group/js/privateMessageModels.test.ts
 *
 * Plan: `docs/plans/2026-09-05T0125-community-features-herbst.md`, phase P7, under the
 * standing extra DoD "reine Logik braucht reine Tests".
 *
 * Three of the rules name a consequence in their own docblock, and none of them would be
 * reached by an E2E run:
 *
 *  - `planPrivateMessage` puts the SENDER in `wrapFor` — without it the author's own
 *    second device never sees what they wrote. NIP-17 has no "sent" folder.
 *  - `planPrivateMessage` refuses a body over the ceiling — otherwise the failure
 *    happens inside NIP-44 and reaches the user as an opaque signer error.
 *  - `messageTargets` never answers empty when a fallback exists — a send with no target
 *    succeeds locally and arrives nowhere.
 *
 * The ceiling is proved by BUILDING a wrap at exactly that size rather than by
 * arithmetic: a size rule that is only reasoned about is a size rule nobody has tested.
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { getPubkey, makeSecret } from '@welshman/util'
import { Nip01Signer, unwrap } from '@welshman/signer'
import { buildGiftWrap } from './giftWrap.ts'
import {
    DIRECT_MESSAGE,
    MAX_PRIVATE_MESSAGE_BYTES,
    conversationKey,
    conversationParticipants,
    foldPrivateConversations,
    isOwnPrivateMessage,
    messageTargets,
    planPrivateMessage,
    privateConversationMessages,
    type RumorLike,
} from './privateMessageModels.ts'

const ME = 'a'.repeat(64)
const ANNA = 'b'.repeat(64)
const BEN = 'c'.repeat(64)
const NOW = 1_788_600_000
const SPACE = 'wss://space.example/'

const rumor = (overrides: Partial<RumorLike> = {}): RumorLike => ({
    id: '1'.repeat(64),
    kind: DIRECT_MESSAGE,
    pubkey: ANNA,
    created_at: NOW,
    content: 'hello',
    tags: [['p', ME]],
    ...overrides,
})

const plan = (overrides: Record<string, unknown> = {}) =>
    planPrivateMessage({
        text: 'hello',
        recipients: [ANNA],
        self: ME,
        spaceKind: 'other',
        now: NOW,
        ...overrides,
    } as Parameters<typeof planPrivateMessage>[0])

describe('conversationKey', () => {
    test('the same set gives the same key whoever sent the message', () => {
        // Without this every reply would open a new thread.
        assert.equal(conversationKey([ME, ANNA]), conversationKey([ANNA, ME]))
    })

    test('duplicates collapse', () => {
        assert.equal(conversationKey([ME, ANNA, ME]), conversationKey([ME, ANNA]))
    })

    test('a malformed pubkey cannot split a conversation in two', () => {
        assert.equal(conversationKey([ME, ANNA, 'NOTHEX']), conversationKey([ME, ANNA]))
    })

    test('a different set is a different conversation', () => {
        assert.notEqual(conversationKey([ME, ANNA]), conversationKey([ME, ANNA, BEN]))
    })
})

describe('conversationParticipants', () => {
    test('author plus p tags', () => {
        assert.deepEqual(conversationParticipants(rumor({ tags: [['p', ME], ['p', BEN]] })), [ME, ANNA, BEN].sort())
    })

    test('other tag names are not participants', () => {
        // `e` is a reply marker and `subject` is a title. Reading either as a person
        // would put somebody in a conversation who was never addressed.
        assert.deepEqual(conversationParticipants(rumor({ tags: [['e', BEN], ['subject', 'x']] })), [ANNA])
    })

    test('a message to oneself has one participant', () => {
        assert.deepEqual(conversationParticipants(rumor({ pubkey: ME, tags: [['p', ME]] })), [ME])
    })
})

describe('isOwnPrivateMessage', () => {
    test('a kind 14 the reader is part of', () => {
        assert.equal(isOwnPrivateMessage(rumor(), ME), true)
    })

    test('another kind is not a private message', () => {
        assert.equal(isOwnPrivateMessage(rumor({ kind: 9 }), ME), false)
    })

    test("somebody else's conversation is not the reader's", () => {
        assert.equal(isOwnPrivateMessage(rumor({ pubkey: ANNA, tags: [['p', BEN]] }), ME), false)
    })

    test('without an identity nothing is ours', () => {
        assert.equal(isOwnPrivateMessage(rumor(), ''), false)
    })
})

describe('foldPrivateConversations', () => {
    test('messages of the same set land in one conversation, newest first', () => {
        const rows = foldPrivateConversations(
            [
                rumor({ id: '1'.repeat(64), created_at: NOW - 100 }),
                rumor({ id: '2'.repeat(64), created_at: NOW, content: 'later' }),
                rumor({ id: '3'.repeat(64), pubkey: BEN, created_at: NOW - 50, tags: [['p', ME]] }),
            ],
            ME,
        )

        assert.equal(rows.length, 2)
        assert.equal(rows[0].preview, 'later')
        assert.equal(rows[0].count, 2)
        assert.deepEqual(rows[0].others, [ANNA])
        assert.deepEqual(rows[1].others, [BEN])
    })

    test('a group is a different conversation from the pair inside it', () => {
        const rows = foldPrivateConversations(
            [rumor(), rumor({ id: '2'.repeat(64), tags: [['p', ME], ['p', BEN]] })],
            ME,
        )
        assert.equal(rows.length, 2)
    })

    test('the order is stable when two conversations share a timestamp', () => {
        // Two messages in the same second is the normal case in a live exchange; a list
        // that reshuffles on every recompute is unusable.
        const rows = () =>
            foldPrivateConversations(
                [rumor(), rumor({ id: '2'.repeat(64), pubkey: BEN, tags: [['p', ME]] })],
                ME,
            ).map((row) => row.key)
        assert.deepEqual(rows(), rows())
    })

    test('foreign conversations never appear', () => {
        assert.deepEqual(foldPrivateConversations([rumor({ pubkey: ANNA, tags: [['p', BEN]] })], ME), [])
    })
})

describe('privateConversationMessages', () => {
    test('oldest first, and only this conversation', () => {
        const key = conversationKey([ME, ANNA])
        const rows = privateConversationMessages(
            [
                rumor({ id: '2'.repeat(64), created_at: NOW }),
                rumor({ id: '1'.repeat(64), created_at: NOW - 10 }),
                rumor({ id: '3'.repeat(64), tags: [['p', ME], ['p', BEN]] }),
            ],
            ME,
            key,
        )

        assert.deepEqual(rows.map((row) => row.created_at), [NOW - 10, NOW])
    })

    test('a timestamp tie is broken by id, so question and answer keep their order', () => {
        const key = conversationKey([ME, ANNA])
        const rows = privateConversationMessages(
            [rumor({ id: 'b'.repeat(64) }), rumor({ id: 'a'.repeat(64) })],
            ME,
            key,
        )
        assert.deepEqual(rows.map((row) => row.id[0]), ['a', 'b'])
    })
})

describe('planPrivateMessage', () => {
    test('a message to one person', () => {
        const draft = plan()
        assert.equal(draft?.template.kind, DIRECT_MESSAGE)
        assert.deepEqual(draft?.template.tags, [['p', ANNA]])
        assert.equal(draft?.template.created_at, NOW)
    })

    test('THE self-copy: the sender is always wrapped for too', () => {
        // NIP-17 has no "sent" folder — without this the author's second device never
        // sees what the author wrote.
        assert.deepEqual(plan()?.wrapFor, [ANNA, ME])
    })

    test('the participant set the receivers compute is the one we sent to', () => {
        // If `recipients` could contain the sender, the `p` tags would differ from the
        // participant set and the conversation would split in two.
        const draft = plan({ recipients: [ANNA, ME, BEN] })
        assert.deepEqual(draft?.template.tags, [['p', ANNA], ['p', BEN]])
        assert.deepEqual(draft?.wrapFor, [ANNA, BEN, ME])
    })

    test('blank text is refused', () => {
        assert.equal(plan({ text: '   \n ' }), null)
    })

    test('the text is trimmed, not sent with its whitespace', () => {
        assert.equal(plan({ text: '  hi  ' })?.template.content, 'hi')
    })

    test('a body over the ceiling is refused HERE, not inside NIP-44', () => {
        assert.equal(plan({ text: 'x'.repeat(MAX_PRIVATE_MESSAGE_BYTES + 1) }), null)
        assert.ok(plan({ text: 'x'.repeat(MAX_PRIVATE_MESSAGE_BYTES) }))
    })

    test('the ceiling counts BYTES, not characters', () => {
        // One emoji is four bytes. A character-based limit would let a message through
        // that NIP-44 then refuses.
        assert.equal(plan({ text: '😀'.repeat(MAX_PRIVATE_MESSAGE_BYTES / 4 + 1) }), null)
    })

    test('no recipient, no message', () => {
        assert.equal(plan({ recipients: [] }), null)
        assert.equal(plan({ recipients: [ME] }), null)
        assert.equal(plan({ recipients: ['nonsense'] }), null)
    })

    test('no identity, no message', () => {
        assert.equal(plan({ self: '' }), null)
    })

    test('a relay whose kind is not known yet gets nothing', () => {
        assert.equal(plan({ spaceKind: 'unknown' }), null)
    })

    test('a Buzz space takes gift wraps — this is not a zooid-only feature', () => {
        // Measured: `KIND_GIFT_WRAP` is in Buzz's ingest allowlist and the wrap is
        // findable by requery (`p7-messung-a-wrap-drift.txt`).
        assert.ok(plan({ spaceKind: 'buzz' }))
    })
})

describe('the ceiling, proved by building a real wrap', () => {
    test('a message of exactly MAX_PRIVATE_MESSAGE_BYTES survives seal and wrap', async () => {
        // The wall is NIP-44's 65535-byte plaintext limit applied to the SEAL, whose body
        // is the base64 of the encrypted rumor. Arithmetic in a comment would not notice
        // if the ceiling were raised past it; this does.
        const senderSecret = makeSecret()
        const recipientSecret = makeSecret()
        const sender = Nip01Signer.fromSecret(senderSecret)
        const recipient = Nip01Signer.fromSecret(recipientSecret)
        const draft = plan({ text: 'x'.repeat(MAX_PRIVATE_MESSAGE_BYTES), self: getPubkey(senderSecret) })
        assert.ok(draft)

        const event = await buildGiftWrap({
            sender,
            recipient: getPubkey(recipientSecret),
            template: draft.template as never,
            now: NOW,
        })
        const back = await unwrap(recipient, event)

        assert.equal(back.content.length, MAX_PRIVATE_MESSAGE_BYTES)
    })
})

describe('messageTargets', () => {
    test('the listed relays win', () => {
        assert.deepEqual(messageTargets(['wss://a/', 'wss://b/'], SPACE), ['wss://a/', 'wss://b/'])
    })

    test('duplicates collapse — otherwise the message goes twice', () => {
        assert.deepEqual(messageTargets(['wss://a/', 'wss://a/'], SPACE), ['wss://a/'])
    })

    test('THE fallback: no list means the space relay, not nowhere', () => {
        // Without it the feature is dead on a Buzz-only deployment, where 10050 cannot be
        // published at all.
        assert.deepEqual(messageTargets([], SPACE), [SPACE])
        assert.deepEqual(messageTargets(['', ''], SPACE), [SPACE])
    })

    test('no list and no fallback answers empty so the caller can refuse', () => {
        assert.deepEqual(messageTargets([], ''), [])
    })
})
