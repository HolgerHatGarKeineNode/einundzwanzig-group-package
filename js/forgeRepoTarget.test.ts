/**
 * **One target table for a repository: `/forge/<naddr>`, built in one place.**
 *   node --experimental-strip-types --test packages/einundzwanzig-group/js/forgeRepoTarget.test.ts
 *
 * ── The defect, measured in P6 ────────────────────────────────────────────────────
 *
 * The overview island (`js/forge.ts`) is handed the route of the OVERVIEW
 * (`/bereich/forge`) as `_base` — it needs it for its `?tab=` links. Its `repoHref`
 * appended the `naddr` to that base and produced `/bereich/forge/<naddr>`, for which there
 * is no route (`routes/group.php` puts the repo page on `/forge/{naddr}`). Every tile of
 * the Forge overview therefore led to a 404; the response guard printed
 * `404 GET /bereich/forge/naddr1…`, and it was the cause of 16 failing `desktop-forge*`
 * cases. The same mistake stood a second time in `⚡forge-repo.blade.php`, in the
 * „Gleiche Historie"-pills.
 *
 * ── Why a source gate ─────────────────────────────────────────────────────────────
 *
 * The behaviour half exists and is the real proof: `desktop-forge.spec.ts` asserts the
 * tile's `href` and then clicks it, and the response guard fails any case that produces a
 * 404. What that cannot state is the RULE — that there is one function which knows this
 * target and that the overview goes through it. `railForge.repoHref` has built the right
 * path all along; the overview simply had its own second opinion, and a second opinion is
 * how the two drifted apart in the first place.
 *
 * ── What this gate cannot see ─────────────────────────────────────────────────────
 *
 * Names and text. A `repoHref` that calls the shared function and then rewrites its result
 * passes, and so would a Blade file that builds the path out of two concatenated halves.
 * It measures the two shapes that actually occurred.
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { lies, liesDatei } from './workspaceQuelleGate.ts'
import { repoHref } from './railForge.ts'

const JS_DIR = import.meta.dirname
const FORGE = join(JS_DIR, 'forge.ts')
const REPO_BLADE = join(JS_DIR, '..', 'resources', 'views', '⚡forge-repo.blade.php')

/** The local name `forge.ts` imports the shared builder under. */
const SHARED = 'repoDetailHref'

describe('the repository target', () => {
    test('the shared builder produces the route the router declares', () => {
        // Literal, not derived from a constant: this is the one place where the path is
        // written down next to the route it has to match (`routes/group.php:172`,
        // `Route::livewire('/forge/{naddr}', …)`).
        assert.equal(repoHref('naddr1abc'), '/forge/naddr1abc')
        assert.equal(repoHref(''), '')
    })

    test('the overview island builds its tile target through that builder', () => {
        const befund = liesDatei(FORGE, 'forge.ts')
        const eingefuehrt = befund.importe.some(
            (stelle) => stelle.name === SHARED && stelle.exportName === 'repoHref' && stelle.modul === './railForge.ts',
        )
        assert.ok(eingefuehrt, `forge.ts must import \`repoHref\` from ./railForge.ts as ${SHARED}`)

        const rueckgaben = befund.werte.filter((wert) => wert.art === 'return' && wert.name === 'repoHref')
        assert.ok(rueckgaben.length >= 1, 'forge.ts declares no `repoHref` at all — the scanner is pointed at nothing')
        assert.ok(
            rueckgaben.some((wert) => wert.form === 'CallExpression' && wert.ruft === SHARED),
            'the overview island must return the shared builder\'s result, not a path of its own',
        )
    })

    test('CALIBRATION: the shape that produced the 404 is recognised as a different one', () => {
        // The exact body that stood there until P7. It is not a call, so the assertion
        // above falls — which is what „calibrated" means here.
        const kaputt = [
            'const insel = {',
            '    repoHref(row: { naddr: string }) {',
            '        return row.naddr ? `${this._base}/${row.naddr}` : \'\'',
            '    },',
            '}',
        ].join('\n')
        const werte = lies('probe.ts', kaputt).werte.filter((wert) => wert.name === 'repoHref')
        assert.deepEqual(werte.map((wert) => wert.form), ['ConditionalExpression'])
        assert.ok(!werte.some((wert) => wert.ruft === SHARED))
    })

    test('no Blade builds a repository link out of the overview route', () => {
        // Text and not AST: Blade is not TypeScript, and the shape being kept out is a
        // literal one — the overview route with a segment glued behind it.
        const blade = readFileSync(REPO_BLADE, 'utf8')
        assert.ok(
            !/route\('group\.bereich\.forge'\)\s*\}\}\/'/.test(blade),
            '`⚡forge-repo.blade.php` appends a naddr to the OVERVIEW route — that is the 404 again',
        )
        assert.ok(
            blade.includes("'/forge/' + encodeURIComponent(andere.naddr)"),
            'the „Gleiche Historie" pills must point at the repo route',
        )
    })
})
