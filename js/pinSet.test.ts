/**
 * **`js/pinSet.ts` — the pin set's rules, without a browser, a signer or a relay.**
 *   node --test --experimental-strip-types packages/einundzwanzig-group/js/pinSet.test.ts
 *
 * Plan: `docs/plans/2026-09-17T1946-revamp-ein-eingang.md`, phase P3. Its DoD names five
 * cases by hand, and each one is a way this feature loses the user's pins quietly:
 *
 * | DoD case | what it prevents | here |
 * |---|---|---|
 * | two stale devices lose nothing | whole-blob LWW dropping the other device's pin | `merge` |
 * | load without EOSE ⇒ 0 publishes | replacing a set we never read | `decidePinPublish` |
 * | unknown `v` ⇒ no write | overwriting a newer client's payload | `parse` + `decide` |
 * | default seed never published alone | a fresh device announcing a pin nobody made | `decidePinPublish` |
 * | cap | a blob that grows until no relay stores it | `boundPins` |
 *
 * The sixth is the one the plan does not spell out and the one the merge stands on:
 * **a removal is an entry, not a missing key.** Without the tombstone the older device's
 * `on: true` wins the next merge and the pin comes back. It is tested from both sides —
 * with the tombstone and with the key simply gone.
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
    EMPTY_PINS,
    MAX_PINS,
    PIN_D,
    TOMBSTONE_TTL_SEC,
    anyRelayAccepted,
    areaPinKey,
    articlePinKey,
    boundPins,
    decidePinPublish,
    hasUserPin,
    isPinKey,
    isPinned,
    meetupPinKey,
    mergePinSets,
    nextPinCreatedAt,
    parsePinContent,
    parsePinPayload,
    personPinKey,
    pinPayloadJson,
    pinPrefixOf,
    pinWriteRoute,
    pinnedKeysOf,
    prunePins,
    repoPinKey,
    roomKeyParts,
    roomPinKey,
    seedDefaultPins,
    setPinEntry,
    unionPinnedKeys,
    type PinSet,
} from './pinSet.ts'

const NOW = 1_788_600_000
const WORKSPACE = 'wss://buzz.example/'
const SPACE = 'wss://space.example/'

const setOf = (pins: Record<string, { on: boolean; at: number; pos?: number }>): PinSet => ({
    v: 1,
    pins: Object.fromEntries(Object.entries(pins).map(([key, entry]) => [key, { pos: 0, ...entry }])),
})

const baseDecision = {
    self: 'a'.repeat(64),
    answered: true,
    readOnly: false,
    nowSec: NOW,
    remoteHead: NOW - 100,
    lastPublishedJson: undefined as string | undefined,
    capturedEpoch: 7,
    currentEpoch: 7,
}

describe('keys', () => {
    test('the six namespaces build the documented form', () => {
        assert.equal(areaPinKey('wallet'), 'area:wallet')
        assert.equal(roomPinKey('welcome', SPACE), `room:welcome@${SPACE}`)
        assert.equal(articlePinKey('30023:abc:slug'), 'article:30023:abc:slug')
        assert.equal(repoPinKey('30617:abc:repo'), 'repo:30617:abc:repo')
        assert.equal(meetupPinKey('berlin'), 'meetup:berlin')
        assert.equal(personPinKey('f'.repeat(64)), `person:${'f'.repeat(64)}`)
    })

    test('a foreign prefix and a malformed key are not writable keys', () => {
        assert.equal(isPinKey('area:wallet'), true)
        assert.equal(isPinKey('zooid:something'), false)
        assert.equal(isPinKey('area:'), false)
        assert.equal(isPinKey(':wallet'), false)
        assert.equal(isPinKey('wallet'), false)
        assert.equal(pinPrefixOf('room:x@wss://r/'), 'room')
        assert.equal(pinPrefixOf('nonsense'), '')
    })

    test('a room key splits at the LAST @ — a relay URL has none, an h might', () => {
        assert.deepEqual(roomKeyParts(`room:we@lcome@${SPACE}`), { h: 'we@lcome', relay: SPACE })
        assert.equal(roomKeyParts('area:wallet'), null)
        assert.equal(roomKeyParts('room:welcome'), null)
        assert.equal(roomKeyParts('room:@wss://r/'), null)
    })
})

describe('parse', () => {
    test('a v1 payload comes back writable', () => {
        const parsed = parsePinContent('{"v":1,"pins":{"area:wallet":{"on":true,"at":5,"pos":2}}}')
        assert.ok(parsed)
        assert.equal(parsed.readOnly, false)
        assert.deepEqual(parsed.store.pins['area:wallet'], { on: true, at: 5, pos: 2 })
    })

    test('an UNKNOWN v yields read-only and NO entries — the payload is not guessed at', () => {
        const parsed = parsePinPayload({ v: 2, pins: { 'area:wallet': { on: true, at: 5 } } })
        assert.ok(parsed)
        assert.equal(parsed.readOnly, true)
        assert.deepEqual(parsed.store.pins, {})
    })

    test('a broken entry falls out, the rest of the payload survives', () => {
        const parsed = parsePinPayload({
            v: 1,
            pins: {
                'area:wallet': { on: true, at: 5 },
                'area:chat': { on: 'yes', at: 5 },
                'area:leute': { on: true, at: Number.NaN },
                'area:forge': { on: true, at: -1 },
                '': { on: true, at: 5 },
                'area:kurse': { on: true, at: 9, pos: 'x' },
            },
        })
        assert.ok(parsed)
        assert.deepEqual(Object.keys(parsed.store.pins).sort(), ['area:kurse', 'area:wallet'])
        // A non-numeric `pos` degrades to 0 instead of dropping the entry: order is
        // cosmetic, the pin is not.
        assert.equal(parsed.store.pins['area:kurse'].pos, 0)
    })

    test('unreadable input is null — the caller keeps its state', () => {
        assert.equal(parsePinContent(''), null)
        assert.equal(parsePinContent(undefined), null)
        assert.equal(parsePinContent('not json'), null)
        assert.equal(parsePinContent('{"v":1}'), null)
        assert.equal(parsePinPayload([]), null)
        assert.equal(parsePinPayload({ pins: {} }), null)
    })

    test('a foreign key is KEPT on the read side — our merge must not drop it', () => {
        const parsed = parsePinPayload({ v: 1, pins: { 'future:thing': { on: true, at: 5 } } })
        assert.ok(parsed)
        assert.equal(parsed.store.pins['future:thing'].on, true)
    })
})

describe('merge', () => {
    test('per key: the newer at wins, a tie keeps what we had', () => {
        const current = setOf({ 'area:wallet': { on: true, at: 100 } })
        const newer = mergePinSets(current, setOf({ 'area:wallet': { on: false, at: 200 } }))
        assert.equal(isPinned(newer, 'area:wallet'), false)
        const tie = mergePinSets(current, setOf({ 'area:wallet': { on: false, at: 100 } }))
        assert.equal(isPinned(tie, 'area:wallet'), true)
    })

    test('TWO STALE DEVICES LOSE NOTHING — in either merge order', () => {
        const phone = setOf({ 'area:wallet': { on: true, at: 100 } })
        const laptop = setOf({ 'meetup:berlin': { on: true, at: 200 } })
        for (const merged of [mergePinSets(phone, laptop), mergePinSets(laptop, phone)]) {
            assert.deepEqual(pinnedKeysOf(merged).sort(), ['area:wallet', 'meetup:berlin'])
        }
    })

    test('a TOMBSTONE keeps a removal — and without it the pin comes back', () => {
        const removedHere = setOf({ 'meetup:berlin': { on: false, at: 200 } })
        const staleRemote = setOf({ 'meetup:berlin': { on: true, at: 100 } })
        assert.deepEqual(pinnedKeysOf(mergePinSets(removedHere, staleRemote)), [])
        // The counter-case, i.e. what a merge without tombstones would do: the key is simply
        // absent on our side, so the stale remote statement is the only one left.
        const removedByDeleting: PinSet = { v: 1, pins: {} }
        assert.deepEqual(pinnedKeysOf(mergePinSets(removedByDeleting, staleRemote)), ['meetup:berlin'])
    })

    test('a null incoming leaves the set untouched', () => {
        const current = setOf({ 'area:wallet': { on: true, at: 100 } })
        assert.equal(mergePinSets(current, null), current)
    })
})

describe('caps and pruning', () => {
    test('the cap keeps the newest 500, in both insertion orders', () => {
        const many: Record<string, { on: boolean; at: number }> = {}
        for (let i = 0; i < MAX_PINS + 11; i++) {
            many[`meetup:m${String(i).padStart(4, '0')}`] = { on: true, at: 1000 + i }
        }
        const forward = boundPins(setOf(many))
        const reversed = boundPins(setOf(Object.fromEntries(Object.entries(many).reverse())))
        assert.equal(Object.keys(forward.pins).length, MAX_PINS)
        assert.deepEqual(Object.keys(forward.pins).sort(), Object.keys(reversed.pins).sort())
        // The oldest fell out, the newest stayed.
        assert.equal(forward.pins['meetup:m0000'], undefined)
        assert.equal(forward.pins[`meetup:m${String(MAX_PINS + 10).padStart(4, '0')}`].on, true)
    })

    test('a set at the cap is returned unchanged (no allocation, no reorder)', () => {
        const small = setOf({ 'area:wallet': { on: true, at: 1 } })
        assert.equal(boundPins(small), small)
    })

    test('a tombstone dies after 90 days, an active pin never does', () => {
        const store = setOf({
            'meetup:old': { on: false, at: NOW - TOMBSTONE_TTL_SEC - 1 },
            'meetup:fresh': { on: false, at: NOW - 10 },
            'area:wallet': { on: true, at: 0 },
        })
        const pruned = prunePins(store, NOW)
        assert.deepEqual(Object.keys(pruned.pins).sort(), ['area:wallet', 'meetup:fresh'])
        assert.equal(prunePins(setOf({ 'area:wallet': { on: true, at: 0 } }), NOW).pins['area:wallet'].on, true)
    })
})

describe('local changes', () => {
    test('a second toggle inside the same second is not swallowed', () => {
        // The trap `setPinEntry` exists for: routed through the merge, the second call would
        // lose against its own equal `at`.
        const once = setPinEntry(EMPTY_PINS, 'meetup:berlin', true, NOW)
        const twice = setPinEntry(once, 'meetup:berlin', false, NOW)
        assert.equal(isPinned(twice, 'meetup:berlin'), false)
    })

    test('a key this client does not understand changes NOTHING', () => {
        const store = setOf({ 'area:wallet': { on: true, at: 1 } })
        assert.equal(setPinEntry(store, 'zooid:evil', true, NOW), store)
        assert.equal(setPinEntry(store, 'nonsense', true, NOW), store)
    })

    test('the default seed carries at 0 and never claims to be a user statement', () => {
        const seeded = seedDefaultPins(['area:wallet'])
        assert.deepEqual(seeded.pins['area:wallet'], { on: true, at: 0, pos: 0 })
        assert.equal(hasUserPin(seeded), false)
        assert.equal(hasUserPin(setPinEntry(seeded, 'meetup:berlin', true, NOW)), true)
        // It loses against every real statement, including a removal made years ago.
        const merged = mergePinSets(seeded, setOf({ 'area:wallet': { on: false, at: 1 } }))
        assert.equal(isPinned(merged, 'area:wallet'), false)
        // And it does not overwrite a set that already knows the key.
        const existing = setOf({ 'area:wallet': { on: false, at: 50 } })
        assert.equal(seedDefaultPins(['area:wallet'], existing).pins['area:wallet'].at, 50)
    })

    test('display order is pos, then the newer at, then the key', () => {
        const store = setOf({
            'meetup:b': { on: true, at: 100, pos: 1 },
            'meetup:a': { on: true, at: 300, pos: 1 },
            'area:wallet': { on: true, at: 0, pos: 0 },
            'meetup:gone': { on: false, at: 900, pos: 0 },
        })
        assert.deepEqual(pinnedKeysOf(store), ['area:wallet', 'meetup:a', 'meetup:b'])
    })
})

describe('payload', () => {
    test('the JSON is key-sorted and survives a round trip', () => {
        const store = setOf({ 'meetup:b': { on: true, at: 2 }, 'area:wallet': { on: false, at: 1 } })
        const json = pinPayloadJson(store)
        assert.equal(json, '{"v":1,"pins":{"area:wallet":{"on":false,"at":1,"pos":0},"meetup:b":{"on":true,"at":2,"pos":0}}}')
        const back = parsePinContent(json)
        assert.ok(back)
        assert.deepEqual(back.store.pins, store.pins)
    })

    test('insertion order does not change the payload — otherwise "unchanged" would lie', () => {
        const a = setOf({ 'area:wallet': { on: true, at: 1 }, 'meetup:b': { on: true, at: 2 } })
        const b = setOf({ 'meetup:b': { on: true, at: 2 }, 'area:wallet': { on: true, at: 1 } })
        assert.equal(pinPayloadJson(a), pinPayloadJson(b))
    })

    test('created_at bumps past the relay head and is capped in the future', () => {
        assert.equal(nextPinCreatedAt(NOW, NOW), NOW + 1)
        assert.equal(nextPinCreatedAt(NOW, NOW - 50), NOW)
        assert.equal(nextPinCreatedAt(NOW, NOW + 10_000), NOW + 600)
    })
})

describe('decidePinPublish', () => {
    const store = setOf({ 'meetup:berlin': { on: true, at: NOW - 5 } })

    test('LOAD WITHOUT EOSE ⇒ no plan, so zero publishes', () => {
        const decision = decidePinPublish({ ...baseDecision, store, answered: false })
        assert.deepEqual(decision, { go: false, reason: 'unanswered' })
    })

    test('an unknown v ⇒ no plan, even with a user change waiting', () => {
        assert.deepEqual(decidePinPublish({ ...baseDecision, store, readOnly: true }), {
            go: false,
            reason: 'read-only',
        })
    })

    test('THE DEFAULT SEED ALONE is never published', () => {
        assert.deepEqual(decidePinPublish({ ...baseDecision, store: seedDefaultPins(['area:wallet']) }), {
            go: false,
            reason: 'default-only',
        })
        // …but the first real change publishes the whole set, seed included.
        const withChange = setPinEntry(seedDefaultPins(['area:wallet']), 'meetup:berlin', true, NOW)
        const decision = decidePinPublish({ ...baseDecision, store: withChange })
        assert.equal(decision.go, true)
        assert.ok(decision.go && decision.plan.json.includes('area:wallet'))
    })

    test('unpinning the default IS a user change', () => {
        const removed = setPinEntry(seedDefaultPins(['area:wallet']), 'area:wallet', false, NOW)
        assert.equal(decidePinPublish({ ...baseDecision, store: removed }).go, true)
    })

    test('an identity switch mid-publish refuses, and so does a missing identity', () => {
        assert.deepEqual(decidePinPublish({ ...baseDecision, store, currentEpoch: 8 }), { go: false, reason: 'stale' })
        assert.deepEqual(decidePinPublish({ ...baseDecision, store, self: '' }), { go: false, reason: 'no-identity' })
    })

    test('a byte-identical payload is not sent again', () => {
        assert.deepEqual(
            decidePinPublish({ ...baseDecision, store, lastPublishedJson: pinPayloadJson(store) }),
            { go: false, reason: 'unchanged' },
        )
    })

    test('the plan carries exactly the d tag and nothing else', () => {
        const decision = decidePinPublish({ ...baseDecision, store })
        assert.ok(decision.go)
        assert.deepEqual(decision.plan.tags, [['d', PIN_D]])
        assert.equal(decision.plan.createdAt, NOW)
        assert.equal(decision.plan.json, pinPayloadJson(store))
    })

    test('the identity guard runs BEFORE the EOSE check — a stale pass says stale', () => {
        // Order matters for the message the surface shows: "we could not read" is the one
        // the user can act on, "you switched accounts" is not their problem.
        const decision = decidePinPublish({ ...baseDecision, store, answered: false, currentEpoch: 9 })
        assert.deepEqual(decision, { go: false, reason: 'stale' })
    })
})

describe('publish verdict', () => {
    test('one accepting relay is enough — an EMPTY result map is not', () => {
        assert.equal(anyRelayAccepted({ [SPACE]: { status: 'success' } }, 'success'), true)
        assert.equal(anyRelayAccepted({ [SPACE]: { status: 'failure' } }, 'success'), false)
        assert.equal(anyRelayAccepted({}, 'success'), false)
    })
})

describe('the Buzz fork', () => {
    test('a workspace room goes to channel-stars, everything else into the blob', () => {
        assert.equal(pinWriteRoute(roomPinKey('welcome', WORKSPACE), WORKSPACE), 'stars')
        assert.equal(pinWriteRoute(roomPinKey('welcome', SPACE), WORKSPACE), 'blob')
        assert.equal(pinWriteRoute(roomPinKey('welcome', WORKSPACE), ''), 'blob')
        assert.equal(pinWriteRoute(areaPinKey('wallet'), WORKSPACE), 'blob')
        assert.equal(pinWriteRoute('room:broken', WORKSPACE), 'blob')
    })

    test('the union shows both sources once', () => {
        const keys = unionPinnedKeys(
            ['area:wallet', roomPinKey('welcome', WORKSPACE)],
            ['welcome', 'random'],
            WORKSPACE,
        )
        assert.deepEqual(keys, ['area:wallet', roomPinKey('welcome', WORKSPACE), roomPinKey('random', WORKSPACE)])
        // Without a workspace there are no stars to union in.
        assert.deepEqual(unionPinnedKeys(['area:wallet'], ['welcome'], ''), ['area:wallet'])
    })
})
