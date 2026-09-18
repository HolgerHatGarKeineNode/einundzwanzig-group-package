/**
 * **P3 latch: a pin event is built in ONE place, behind the EOSE gate, for a FIXED relay set.**
 *
 * Run (repo root):
 *   node --experimental-strip-types --test packages/einundzwanzig-group/js/pinWriteGate.test.ts
 *
 * ── Why the pure test next door is only half the promise ──────────────────────
 *
 * `pinSet.test.ts` proves that {@link decidePinPublish} refuses without an `EOSE`, refuses a
 * read-only payload and refuses the bare default seed. All of that stays green if somebody
 * builds the event in `pinSetSync.ts` by hand and never asks the decision — the refusing
 * function still refuses, it is simply no longer on the path. That is exactly how a blind
 * write would get in, and no behaviour test sees it: in the E2E the relay DOES answer, so a
 * removed gate changes nothing observable.
 *
 * So this latch measures the WIRING: how many places can build a pin event at all, who calls
 * the gate, and — the one the plan is most explicit about — **which relay set the module
 * reads**.
 *
 * ── The relay-set latch is the load-bearing one ───────────────────────────────
 *
 * D7: "user's NIP-65 write relays plus the persisted zooid space URL — NOT `activeSpace`".
 * Both of the forbidden sources resolve to the SAME URL in every test and on most devices:
 * `activeSpace` differs from `activeSpaceUrl` only after the user has tapped a workspace
 * room, and `eigeneOutboxUrls()` differs from the declared list only when the user has more
 * than three write relays or one of them has dropped to quality 0. A behaviour test cannot
 * tell them apart; a source census can, and the consequence of the swap is the user's whole
 * pin set written to a relay he never chose.
 *
 * ── What this latch cannot see, in its own words ──────────────────────────────
 *
 * It sees names, not values. `const f = makeEvent; f(…)`, a namespace import or a call
 * through a property (`x.publish(…)`) walk past it — which is why the publish site is also
 * pinned by the two calls no write can skip (`makeEvent`, `nip44EncryptToSelf`), and why the
 * behaviour half lives in `pinSet.test.ts` and in the E2E round trip.
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
    MIN_AUFRUFE,
    importiertAus,
    liesDatei,
    ruftAuf,
    sammleModule,
    type Quellenbefund,
} from './workspaceQuelleGate.ts'

const JS_DIR = dirname(fileURLToPath(import.meta.url))

/** The impure half — the only module that may turn a pin set into an event. */
const WRITER = 'pinSetSync.ts'
/** The pure half, where every refusal lives. */
const MODEL = './pinSet.ts'
/** The one decision the writer has to go through. */
const GATE = 'decidePinPublish'

/**
 * Calls whose REMOVAL is invisible to every behaviour test, with the number of sites each
 * must have — and what production loses without it.
 *
 * | call | what a removal breaks |
 * |---|---|
 * | `decidePinPublish` | the `EOSE` gate, the read-only gate, the default-seed gate and the identity guard are all off the path at once |
 * | `readPinSet` | 2: the arming read AND the fetch-and-merge before the publish. Losing the second one drops the pin a second device made a moment ago |
 * | `anyRelayAccepted` | a refused publish counts as delivered — the pin is gone after the next reload, silently |
 * | `prunePins` | tombstones pile up until the cap evicts live pins |
 * | `seedDefaultPins` | D8's wallet default disappears |
 * | `mergePinSets` | the per-key merge is off the read path: the last event seen wins whole |
 */
const GUARDS: Readonly<Record<string, number>> = {
    [GATE]: 1,
    readPinSet: 2,
    anyRelayAccepted: 1,
    prunePins: 1,
    seedDefaultPins: 1,
    mergePinSets: 2,
}

/**
 * The two steps a pin write cannot skip, each allowed EXACTLY ONCE in the writer: one event
 * body, one encryption. A second site for either is a second way to the relay, and it would
 * not be behind the gate.
 */
const SINGLE_SITE = ['makeEvent', 'nip44EncryptToSelf']

/**
 * Relay sources the writer must NOT import — the two that look identical in a test and are
 * not on a device (see the header).
 */
const FORBIDDEN_RELAY_SOURCES: readonly { name: string; modul: string; grund: string }[] = [
    {
        name: 'activeSpace',
        modul: './groups.ts',
        grund: 'carries the ephemeral workspace override — a tap on a workspace room would move the pin set to the Buzz relay for the rest of the session',
    },
    {
        name: 'eigeneOutboxUrls',
        modul: './welshmanRouter.ts',
        grund: 'a randomised sample of at most three declared relays, minus every relay at quality 0 (F3 in follows.ts: 88.7 % divergence between the set read and the set written)',
    },
]

const befundFuer = (datei: string): Quellenbefund => liesDatei(join(JS_DIR, datei), datei)

const zaehle = (befund: Quellenbefund, name: string): number =>
    befund.aufrufe.filter((aufruf) => aufruf === name).length

describe('P3 latch: the pin write path', () => {
    // ── Calibration ─────────────────────────────────────────────────────────
    //
    // Without it every "does not call X" below is worth nothing: a scanner reading the
    // wrong file reports the same as a clean one.

    test('CALIBRATION: the scanner really reads pinSetSync.ts', () => {
        const befund = befundFuer(WRITER)
        assert.ok(
            befund.aufrufe.length >= MIN_AUFRUFE,
            `only ${befund.aufrufe.length} calls seen in ${WRITER} (at least ${MIN_AUFRUFE} expected)`,
        )
        // A call that has nothing to do with the write half — it belongs to the READ path.
        assert.ok(ruftAuf(befund, 'parsePinContent'), `${WRITER} does not call parsePinContent() — the scanner reads the wrong file`)
    })

    // ── The gate ────────────────────────────────────────────────────────────

    test(`CORE: ${WRITER} goes through ${GATE}, imported from the pure half`, () => {
        const befund = befundFuer(WRITER)
        assert.ok(ruftAuf(befund, GATE), `${WRITER} does not call ${GATE}() — nothing gates the write`)
        assert.ok(
            importiertAus(befund, GATE, MODEL),
            `${WRITER} does not import ${GATE} from ${MODEL} — a local copy is not the gate`,
        )
    })

    for (const [name, erwartet] of Object.entries(GUARDS)) {
        test(`GUARD: ${WRITER} calls ${name}() exactly ${erwartet}×`, () => {
            assert.equal(zaehle(befundFuer(WRITER), name), erwartet)
        })
    }

    for (const name of SINGLE_SITE) {
        test(`SINGLE SITE: ${name}() appears exactly once in ${WRITER}`, () => {
            assert.equal(zaehle(befundFuer(WRITER), name), 1)
        })
    }

    // ── The relay set ───────────────────────────────────────────────────────

    test('RELAYS: the persisted space URL is the source, not the active one', () => {
        const befund = befundFuer(WRITER)
        assert.ok(
            importiertAus(befund, 'activeSpaceUrl', './groups.ts'),
            `${WRITER} does not import activeSpaceUrl — the persisted space is where the pins live`,
        )
        for (const quelle of FORBIDDEN_RELAY_SOURCES) {
            assert.ok(
                !importiertAus(befund, quelle.name, quelle.modul),
                `${WRITER} imports ${quelle.name} from ${quelle.modul}: ${quelle.grund}`,
            )
        }
    })

    test('RELAYS: the declared write list is read, and its WRITING half is not touched', () => {
        const befund = befundFuer(WRITER)
        assert.ok(importiertAus(befund, 'RelayLists', '@welshman/app'), `${WRITER} does not read the NIP-65 list at all`)
        // `RelayLists.update`/`setWriteUrls`/`forceLoad` are the plugin's writing half, and
        // it is the one that publishes a list with a single entry after an unanswered read
        // (memory: welshman-forceload-schreibt-leere-liste). This module may only READ.
        for (const verboten of ['forceLoad', 'setWriteUrls', 'addWriteUrl']) {
            assert.ok(
                !ruftAuf(befund, verboten),
                `${WRITER} calls ${verboten}() — that is the plugin's writing half and it publishes empty lists`,
            )
        }
    })

    // ── Nobody else may build this address ──────────────────────────────────

    test('EXCLUSIVITY: only the writer and the model know the d tag', () => {
        const module = sammleModule(JS_DIR)
        const traeger = module.filter((datei) => {
            const befund = befundFuer(datei)

            return importiertAus(befund, 'PIN_D', MODEL)
        })
        assert.deepEqual(traeger, [WRITER], `PIN_D is imported by ${traeger.join(', ')} — only ${WRITER} may build the address`)
    })

    test('EXCLUSIVITY: the local setter has exactly one caller, and it is the writer', () => {
        const module = sammleModule(JS_DIR)
        const rufer = module.filter((datei) => ruftAuf(befundFuer(datei), 'setPinEntry'))
        assert.deepEqual(rufer, [WRITER])
    })
})
