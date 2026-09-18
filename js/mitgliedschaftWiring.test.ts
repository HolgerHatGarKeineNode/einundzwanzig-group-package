/**
 * **The latch over the DOOR the membership island knocks on — not over its rules.**
 *   node --test --experimental-strip-types packages/einundzwanzig-group/js/mitgliedschaftWiring.test.ts
 *
 * Plan: `docs/plans/2026-09-17T1946-revamp-ein-eingang.md`, decision D11.
 *
 * ── Why this exists next to `mitgliedschaftModelle.test.ts` ─────────────────────────
 *
 * That one proves what the page does with an ANSWER. It cannot see WHERE the question
 * went, and that is the one thing about this surface that has two right answers and one
 * wrong one:
 *
 *   web  `/api/verein/*`      session + CSRF. The route lives in the hosted web instance.
 *   app  `/api/app/verein/*`  no session, no CSRF — the NIP-98 signature IS the identity.
 *
 * The app has no session and never will (D4: the login state is client-side there), so an
 * app build that knocks on the WEB door gets a redirect to a login page instead of its
 * membership — and the surface would show „nicht erreichbar", i.e. it fails in the shape of
 * an ordinary outage. Nothing about that is visible in the markup, in a Pest test or in a
 * `node --test` of the rules: the choice is one conditional inside a template literal.
 *
 * ── Why AST and not `grep` ─────────────────────────────────────────────────────────
 *
 * Both prefixes are named in the module header of `mitgliedschaft.ts` — in prose, to explain
 * why there are two. A text match would report that explanation as proof. `ts.createSourceFile`
 * sees the tree the compiler sees, and comments are not in it. Same reason and same shape as
 * `calendarWiring.test.ts`.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const PFAD = join(import.meta.dirname, 'mitgliedschaft.ts')
const QUELLE = readFileSync(PFAD, 'utf8')
const BAUM = ts.createSourceFile('mitgliedschaft.ts', QUELLE, ts.ScriptTarget.Latest, true)

/** Every `a ? b : c` of the file, with its three parts as source text. */
const bedingteAusdruecke = (): { bedingung: string; wahr: string; falsch: string }[] => {
    const treffer: { bedingung: string; wahr: string; falsch: string }[] = []
    const walk = (node: ts.Node): void => {
        if (ts.isConditionalExpression(node)) {
            treffer.push({
                bedingung: node.condition.getText(BAUM),
                wahr: node.whenTrue.getText(BAUM),
                falsch: node.whenFalse.getText(BAUM),
            })
        }
        ts.forEachChild(node, walk)
    }
    walk(BAUM)

    return treffer
}

/** The value of a `const NAME = '…'` at module level, or '' when there is none. */
const konstante = (name: string): string => {
    let wert = ''
    const walk = (node: ts.Node): void => {
        if (
            ts.isVariableDeclaration(node)
            && ts.isIdentifier(node.name)
            && node.name.text === name
            && node.initializer !== undefined
            && ts.isStringLiteral(node.initializer)
        ) {
            wert = node.initializer.text
        }
        ts.forEachChild(node, walk)
    }
    walk(BAUM)

    return wert
}

test('CALIBRATION: the scanner really read the island', () => {
    // A scan that found nothing because it read nothing looks exactly like a clean file.
    assert.ok(QUELLE.length > 8_000, `the island is ${QUELLE.length} characters — that is not it`)
    assert.ok(bedingteAusdruecke().length >= 3, 'no conditionals at all: the tree is not being walked')
})

test('the two proxy prefixes are the two routes the host registers', () => {
    // `bootstrap/app.php` of the web host: `->prefix('api/verein')` and
    // `->prefix('api/app/verein')`. A typo here is a 404 the surface reports as an outage.
    assert.equal(konstante('WEB_PROXY_PREFIX'), '/api/verein')
    assert.equal(konstante('APP_PROXY_PREFIX'), '/api/app/verein')
    assert.equal(konstante('API_PREFIX'), '/api/v1/membership', 'the path BEHIND both doors is the same')
})

test('the APP goes through the SIGNED door, and the choice hangs on `isMobile`', () => {
    const treffer = bedingteAusdruecke().filter(
        (t) => t.wahr.includes('PROXY_PREFIX') || t.falsch.includes('PROXY_PREFIX'),
    )

    assert.equal(treffer.length, 1, 'the door is chosen in more than one place — or in none')
    assert.equal(treffer[0].bedingung, 'isMobile', 'the choice hangs on something else than the chassis')
    assert.equal(treffer[0].wahr, 'APP_PROXY_PREFIX', 'the app would knock on the session door')
    assert.equal(treffer[0].falsch, 'WEB_PROXY_PREFIX')
})

test('the CSRF token is added for the WEB door only', () => {
    /*
     * Not cosmetic. The app door sits outside the `web` middleware group and has no session
     * to compare a token against; sending one there is noise on every request. The web door
     * is behind CSRF and REJECTS the request without it (419) — which the page would show as
     * „nicht erreichbar", the same shape as an outage.
     *
     * Asserted as a guarded statement, not as presence: `headers['X-CSRF-TOKEN'] = …` on its
     * own would be green in both worlds.
     */
    let gefunden = 0
    const walk = (node: ts.Node): void => {
        if (ts.isIfStatement(node) && node.expression.getText(BAUM) === '!isMobile') {
            if (node.thenStatement.getText(BAUM).includes('X-CSRF-TOKEN')) {
                gefunden += 1
            }
        }
        ts.forEachChild(node, walk)
    }
    walk(BAUM)

    assert.equal(gefunden, 1, 'the CSRF header is not inside an `if (!isMobile)` — check who gets it')
})
