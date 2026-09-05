/**
 * **The rules of `acceptRumor` (`js/wrapIngest.ts`), one assertion per rule.**
 *   node --test --experimental-strip-types packages/einundzwanzig-group/js/wrapIngest.test.ts
 *
 * This is the gate the P7 security audit's HIGH finding produced. What comes out of a
 * NIP-59 envelope is checked upstream by exactly two things: that the seal signed the
 * claimed author, and `isHashedEvent` — which is `typeof id === "string" &&
 * id.length === 64` and verifies no hash at all. Everything else is this function.
 *
 * Each refusal names what it prevents, and none of them is reachable from an E2E run,
 * because every one of them needs a sender who deliberately puts the wrong thing in the
 * envelope:
 *
 *  - **wrong kind** — a kind 9 with an `h` tag went into the ROOM FEED, unsigned, past the
 *    kind allowlist and past the room membership rules;
 *  - **a signature** — a signed object is not a rumor; showing one in the private view
 *    would mean something replayable is displayed as "sealed to me";
 *  - **an id that is not the hash** — a freely chosen id lets the sender pick which of our
 *    events the object collides with.
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { getHash } from '@welshman/util'
import { PRIVATE_MESSAGE_KINDS, acceptRumor } from './wrapIngest.ts'

const AUTHOR = 'a'.repeat(64)
const ME = 'b'.repeat(64)

/** A rumor with the id its content actually hashes to. */
const rumor = (overrides: Record<string, unknown> = {}) => {
    const body = {
        kind: 14,
        pubkey: AUTHOR,
        created_at: 1_788_600_000,
        content: 'hello',
        tags: [['p', ME]],
        ...overrides,
    }

    return { ...body, id: getHash(body as never), ...('id' in overrides ? { id: overrides.id } : {}) }
}

describe('acceptRumor', () => {
    test('a NIP-17 text message passes', () => {
        assert.equal(acceptRumor(rumor()), true)
    })

    test('a NIP-17 file message passes', () => {
        assert.equal(acceptRumor(rumor({ kind: 15 })), true)
    })

    test('THE finding: no other kind comes out of an envelope', () => {
        // kind 9 with an `h` tag is the measured case — it reached `deriveRoomChat`.
        assert.equal(acceptRumor(rumor({ kind: 9, tags: [['h', 'welcome']] })), false)
        for (const kind of [0, 1, 5, 3, 10000, 30078, 1059, 13]) {
            assert.equal(acceptRumor(rumor({ kind })), false, `kind ${kind} came through`)
        }
    })

    test('the kind set is exactly 14 and 15, not "everything small"', () => {
        // Asserted against the set rather than restating the literals: a widened set would
        // otherwise pass this file silently.
        assert.deepEqual(Array.from(PRIVATE_MESSAGE_KINDS).sort((a, b) => a - b), [14, 15])
    })

    test('a rumor carrying a signature is refused', () => {
        const signed = { ...rumor(), sig: 'f'.repeat(128) }
        assert.equal(acceptRumor(signed), false)
    })

    test('an empty signature field is not a signature', () => {
        // `sig: ''` is what some encoders produce for "none"; refusing it would drop
        // legitimate messages, so the rule is about a signature being PRESENT.
        assert.equal(acceptRumor({ ...rumor(), sig: '' }), true)
    })

    test('an id that is not the hash of the body is refused', () => {
        assert.equal(acceptRumor(rumor({ id: 'c'.repeat(64) })), false)
    })

    test('a tampered body with the old id is refused', () => {
        // The same rule from the other side: change one character of the content and the
        // id no longer belongs to it.
        const original = rumor()
        assert.equal(acceptRumor({ ...original, content: 'hello!' }), false)
    })

    test('a missing or malformed author is refused', () => {
        // Built by hand, not through the helper: `getHash` THROWS on a malformed pubkey
        // ("can't serialize event with wrong or missing properties"). That is also why
        // the author is checked before the hash is recomputed and why the recompute sits
        // in a `try` — a throw here would take the whole unwrap chain down.
        assert.equal(acceptRumor({ ...rumor(), pubkey: 'short' }), false)
        assert.equal(acceptRumor({ ...rumor(), pubkey: undefined }), false)
    })

    test('a missing or malformed id is refused', () => {
        assert.equal(acceptRumor({ ...rumor(), id: undefined }), false)
        assert.equal(acceptRumor(rumor({ id: 'short' })), false)
    })

    test('nothing at all is refused instead of throwing', () => {
        assert.equal(acceptRumor(null), false)
        assert.equal(acceptRumor(undefined), false)
        assert.equal(acceptRumor('not an object' as never), false)
        assert.equal(acceptRumor({} as never), false)
    })
})
