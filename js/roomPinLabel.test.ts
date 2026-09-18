/**
 * **A pinned room is looked up WITH its relay — the chip shows a name, not an `h`.**
 *   node --experimental-strip-types --test packages/einundzwanzig-group/js/roomPinLabel.test.ts
 *
 * P6 measured the defect this pins down: `pinRows` (`js/pinSetSync.ts`) resolved the label
 * of a `room:` key with `roomsById.get(parts.h)`, while that index is keyed by
 * `makeRoomId(url, h)` = `${url}'${h}` (`js/groups.ts`). The lookup could never hit, so
 * every pinned room fell back to its `h` — measured
 * `room:welcome@ws://localhost:3335/ → welcome` instead of „Willkommen", on Start's chips
 * since P3 and in the left bar since P6.
 *
 * ── Why the id builder is a parameter and not an import ────────────────────────────
 *
 * `makeRoomId` lives in `js/groups.ts`, which pulls welshman in and is therefore out of
 * reach of `node --test`. Re-spelling `${url}'${h}` here would put a second truth about
 * that format into the repository — the class of defect the plan's own memory calls
 * „konstante gegen sich selbst geprüft". So {@link roomPinLookup} takes the builder, and
 * what is asserted here is the rule it owns: BOTH halves of the key go into the lookup.
 *
 * The case that would have caught the defect is the third one: an index keyed by the bare
 * `h` must MISS. Without it, a lookup that ignores the relay passes the first two.
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { roomPinLookup, roomPinKey, pinChipFallback } from './pinSet.ts'

/** The production builder, spelled the way `js/groups.ts` spells it. */
const makeRoomId = (url: string, h: string): string => `${url}'${h}`

const SPACE = 'ws://localhost:3335/'
const OTHER = 'wss://relay.example/'

/** An index in the shape `roomsById` has: id → room, and the room carries a name. */
const index = new Map<string, { name: string }>([
    [makeRoomId(SPACE, 'welcome'), { name: 'Willkommen' }],
    [makeRoomId(OTHER, 'welcome'), { name: 'Welcome elsewhere' }],
    [makeRoomId(SPACE, 'nameless'), { name: '' }],
])

describe('roomPinLookup', () => {
    test('finds the room the key names — relay and `h` together', () => {
        assert.equal(roomPinLookup(roomPinKey('welcome', SPACE), index, makeRoomId)?.name, 'Willkommen')
    })

    test('the SAME `h` on another relay is another room', () => {
        // The reason a pin key carries its relay at all (D7). A lookup that dropped the
        // relay would answer one of the two for both.
        assert.equal(roomPinLookup(roomPinKey('welcome', OTHER), index, makeRoomId)?.name, 'Welcome elsewhere')
    })

    test('an index keyed by the bare `h` MISSES — the defect P6 measured', () => {
        const flach = new Map<string, { name: string }>([['welcome', { name: 'Willkommen' }]])
        assert.equal(roomPinLookup(roomPinKey('welcome', SPACE), flach, makeRoomId), undefined)
    })

    test('an unknown room, a foreign prefix and a malformed key all answer `undefined`', () => {
        assert.equal(roomPinLookup(roomPinKey('nichtda', SPACE), index, makeRoomId), undefined)
        assert.equal(roomPinLookup('area:wallet', index, makeRoomId), undefined)
        assert.equal(roomPinLookup('room:welcome', index, makeRoomId), undefined)
        assert.equal(roomPinLookup('room:@relay', index, makeRoomId), undefined)
    })

    test('a room whose kind 39000 carries no name leaves the fallback standing', () => {
        // Why the call site joins this with `||` and not `??`: the entry EXISTS, its name
        // is the empty string, and an empty chip says less than the `h` does.
        const treffer = roomPinLookup(roomPinKey('nameless', SPACE), index, makeRoomId)
        assert.equal(treffer?.name, '')
        assert.equal(treffer?.name || pinChipFallback(roomPinKey('nameless', SPACE)), 'nameless')
    })
})
