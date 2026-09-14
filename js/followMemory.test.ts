/**
 * **The floor's memory, measured rather than latched (D6).**
 *   node --test --experimental-strip-types packages/einundzwanzig-group/js/followMemory.test.ts
 *
 * ── Why this file exists ───────────────────────────────────────────────────────
 *
 * `js/followWriteGate.test.ts` pins that `rememberFollowRead` is called, that the key is
 * per identity, and that the monotone guard is there. All three are literals, and the
 * reviewer walked past them: neutralising the `localStorage.setItem` INSIDE the storage
 * helper left the call site and the guard untouched, and the whole suite stayed green
 * twice over — 2921/2921, each against a fresh build. Live, `knownFollowCount` would then
 * have returned `0` forever and K8 would have been decoration.
 *
 * A latch counts literals; only a round trip can say the value comes back. So this file
 * runs the impure half against a `localStorage` stand-in and asserts what the store does,
 * not what it looks like.
 *
 * ── Why the impure half is loadable at all ─────────────────────────────────────
 *
 * `js/relayConfig.ts` switches on `typeof window`, so under `node --test` the relay lists
 * are empty and nothing reaches the network — the same property `js/zapTargetSources.test.ts`
 * relies on. The stand-in has to be installed **before** the import, because the module
 * graph is evaluated on first import; hence the dynamic `import()` below rather than a
 * static one.
 */
import test, { describe, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { FOLLOWS, planFollowWrite, type FollowEventLike, type FollowRelayRead } from './followModels.ts'

const ME = 'a'.repeat(64)
const DU = 'b'.repeat(64)
const ZIEL = 'c'.repeat(64)

/** The store the module writes into, readable from the test — this is the whole point. */
const zellen = new Map<string, string>()

;(globalThis as unknown as { localStorage: unknown }).localStorage = {
    getItem: (key: string): string | null => zellen.get(key) ?? null,
    setItem: (key: string, value: string): void => {
        zellen.set(key, value)
    },
    removeItem: (key: string): void => {
        zellen.delete(key)
    },
}

const follows = await import('./follows.ts')

const liste = (n: number, content = '', id = 'aaa', created_at = 1000): FollowEventLike => ({
    id,
    kind: FOLLOWS,
    pubkey: ME,
    created_at,
    tags: Array.from({ length: n }, (_, i) => ['p', `${i}`.padStart(64, '0')]),
    content,
})

const read = (url: string, answered: boolean, held: FollowEventLike | null): FollowRelayRead =>
    ({ url, answered, list: held })

describe('the floor has a memory, and it survives a round trip', () => {
    beforeEach(() => {
        zellen.clear()
    })

    test('CORE: what a read remembers is what the gate later reads back', () => {
        // The mutation that stayed green against the latch: `setItem` neutralised. Here
        // that shows up immediately, because nothing else produces this number.
        assert.equal(follows.knownFollowCount(ME), 0, 'an identity with no history starts at zero')
        follows.rememberFollowRead(ME, [read('wss://a/', true, liste(700))])
        assert.equal(follows.knownFollowCount(ME), 700, 'the store did not keep it')
    })

    test('CORE: the number really reaches the gate — a truncated base is refused', () => {
        follows.rememberFollowRead(ME, [read('wss://a/', true, liste(700))])
        const plan = planFollowWrite({
            list: null,
            listAnswered: true,
            target: ZIEL,
            self: ME,
            add: true,
            spaceKind: 'other',
            knownContactCount: follows.knownFollowCount(ME),
            knownContentNonEmpty: follows.knownContentNonEmpty(ME),
        })
        assert.equal(plan, null, 'a one-entry list against a remembered 700 must not exist')
    })

    test('CORE: it is kept PER identity — one reader never inherits another\'s floor', () => {
        follows.rememberFollowRead(ME, [read('wss://a/', true, liste(700))])
        assert.equal(follows.knownFollowCount(DU), 0, 'a second key at this device must start empty')
        assert.equal(follows.knownFollowCount(ME), 700)
    })

    test('CORE D2: the mark comes from the MAXIMUM over all reads, not from the winner', () => {
        // The F6 shape: the targets hold the real list, a read-only hint holds a newer,
        // validly signed one-entry event. The winner is the stub; the floor must not be.
        follows.rememberFollowRead(ME, [
            read('wss://target/', true, liste(700, '', 'aaa', 1000)),
            read('wss://hint/', false, liste(1, '', 'zzz', 2000)),
        ])
        assert.equal(follows.knownFollowCount(ME), 700, 'fed from the winner this would be 1, and the floor gone')
    })

    test('CORE D1: a write this client made sets the mark down — reads never do', () => {
        follows.rememberFollowRead(ME, [read('wss://a/', true, liste(20))])
        follows.setFollowCount(ME, 19)
        assert.equal(follows.knownFollowCount(ME), 19, 'the one lowering there is')
        follows.rememberFollowRead(ME, [read('wss://a/', true, liste(3))])
        assert.equal(follows.knownFollowCount(ME), 19, 'a read that found less must NOT lower the floor')
    })

    test('CORE D5: the content flag round-trips, and follows what the reads found', () => {
        follows.rememberFollowRead(ME, [read('wss://a/', true, liste(5, '{"wss://x/":{}}'))])
        assert.equal(follows.knownContentNonEmpty(ME), true)
        follows.rememberFollowRead(ME, [read('wss://a/', true, liste(5, ''))])
        assert.equal(follows.knownContentNonEmpty(ME), false, 'blanked elsewhere must not lock the reader out')
    })

    test('a read that carried no list at all says nothing — neither number moves', () => {
        follows.rememberFollowRead(ME, [read('wss://a/', true, liste(700, '{"x":1}'))])
        follows.rememberFollowRead(ME, [read('wss://a/', true, null), read('wss://b/', true, null)])
        assert.equal(follows.knownFollowCount(ME), 700)
        assert.equal(follows.knownContentNonEmpty(ME), true, 'all-null is not evidence that the content is empty')
    })

    test('a guest writes nothing and reads zero', () => {
        follows.rememberFollowRead('', [read('wss://a/', true, liste(700))])
        follows.setFollowCount('', 5)
        assert.equal(zellen.size, 0, 'no shared key is ever created')
        assert.equal(follows.knownFollowCount(''), 0)
    })

    test('a corrupted entry degrades to "no history" instead of throwing', () => {
        zellen.set(`e21:follows:count:${ME}`, 'nicht mal JSON')
        assert.equal(follows.knownFollowCount(ME), 0)
        assert.equal(follows.knownContentNonEmpty(ME), false)
    })

    test('CALIBRATION: the stand-in is really the store the module uses', () => {
        // Without this the whole file could be measuring its own Map. The key has to turn
        // up under the name production uses, per identity.
        follows.rememberFollowRead(ME, [read('wss://a/', true, liste(42))])
        assert.deepEqual([...zellen.keys()], [`e21:follows:count:${ME}`])
        assert.match(zellen.get(`e21:follows:count:${ME}`) ?? '', /"count":42/)
    })
})
