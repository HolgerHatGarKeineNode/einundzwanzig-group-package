/**
 * Die Adresse eines einzelnen Vorgangs — geprüft wird, was einen geteilten Link
 * still ins Leere führen würde:
 *
 *   1. **Müll im Parameter fällt auf „kein Ziel"**, statt als Selektor
 *      weitergereicht zu werden.
 *   2. **Zwei Ziele sind kein Ziel** — sonst behauptete die Adresse etwas
 *      anderes, als der Bildschirm zeigt.
 *   3. **Der Wechsel räumt den alten Parameter weg.** Bleibt er stehen, trägt
 *      die Adresse beide und Regel 2 verwirft sie: der Link zeigt nichts.
 *   4. **Fremde Parameter bleiben unberührt** (`?tab=`, `?from=`).
 *
 * Ausführen:
 * node --experimental-strip-types --test packages/einundzwanzig-group/js/forgeVorgang.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ISSUE_PARAM, PR_PARAM, readVorgang, tabForVorgang, withVorgang } from './forgeVorgang.ts'

const ID = 'a'.repeat(64)
const ID_B = 'b'.repeat(64)
const BASIS = 'https://example.test/forge/naddr1abc'

test('readVorgang: die beiden gültigen Formen, mit und ohne führendes `?`', () => {
    assert.deepEqual(readVorgang(`?${ISSUE_PARAM}=${ID}`), { art: 'issue', id: ID })
    assert.deepEqual(readVorgang(`${PR_PARAM}=${ID}`), { art: 'pr', id: ID })
    // Grossschreibung ist dieselbe Id — eine Hex-Kennung ist nicht case-sensitiv.
    assert.deepEqual(readVorgang(`?${ISSUE_PARAM}=${ID.toUpperCase()}`), { art: 'issue', id: ID })
})

test('readVorgang: alles, was keine 64-stellige Hex-Id ist, ergibt KEIN Ziel', () => {
    for (const wert of ['', 'bob', 'a'.repeat(63), 'a'.repeat(65), 'g'.repeat(64), `${ID} `, '../../etc']) {
        assert.equal(readVorgang(`?${ISSUE_PARAM}=${encodeURIComponent(wert)}`), null, `„${wert}" kam durch`)
    }
    assert.equal(readVorgang(''), null)
    assert.equal(readVorgang('?tab=code'), null)
})

/**
 * Regel 2. Die naheliegende Alternative wäre „nimm das erste" — und genau das
 * wäre geraten: welcher Parameter zuerst steht, entscheidet der Absender der
 * Adresse, nicht der Leser.
 */
test('readVorgang: zwei Ziele sind kein Ziel — es wird nicht gewählt', () => {
    assert.equal(readVorgang(`?${ISSUE_PARAM}=${ID}&${PR_PARAM}=${ID_B}`), null)
    assert.equal(readVorgang(`?${PR_PARAM}=${ID_B}&${ISSUE_PARAM}=${ID}`), null)
    // KONTROLLE: ist der zweite Wert Müll, bleibt der erste ein gültiges Ziel —
    // die Regel greift bei zwei GÜLTIGEN, nicht bei zwei vorhandenen.
    assert.deepEqual(readVorgang(`?${ISSUE_PARAM}=${ID}&${PR_PARAM}=bob`), { art: 'issue', id: ID })
})

test('tabForVorgang: die Liste heisst `pulls`, nicht `pr`', () => {
    assert.equal(tabForVorgang('issue'), 'issues')
    assert.equal(tabForVorgang('pr'), 'pulls')
})

test('withVorgang: setzt das Ziel und lässt fremde Parameter stehen', () => {
    const href = withVorgang(`${BASIS}?tab=code&from=updates`, { art: 'issue', id: ID })
    const params = new URL(href).searchParams

    assert.equal(params.get(ISSUE_PARAM), ID)
    assert.equal(params.get('tab'), 'code')
    assert.equal(params.get('from'), 'updates')
})

/**
 * Regel 3 — der Fall, den man beim Bauen übersieht: vom Issue zum PR springen.
 * Bleibt der alte Parameter stehen, trägt die Adresse beide, und `readVorgang`
 * verwirft sie nach Regel 2. Der geteilte Link zeigte dann NICHTS.
 */
test('withVorgang: der Wechsel der Art räumt den alten Parameter weg', () => {
    const href = withVorgang(`${BASIS}?${ISSUE_PARAM}=${ID}`, { art: 'pr', id: ID_B })

    assert.equal(new URL(href).searchParams.get(ISSUE_PARAM), null)
    assert.equal(new URL(href).searchParams.get(PR_PARAM), ID_B)
    // Und die Runde schliesst sich: was hier herauskommt, liest `readVorgang`.
    assert.deepEqual(readVorgang(new URL(href).search), { art: 'pr', id: ID_B })
})

test('withVorgang: `null` entfernt BEIDE Parameter und lässt den Rest stehen', () => {
    const href = withVorgang(`${BASIS}?${ISSUE_PARAM}=${ID}&${PR_PARAM}=${ID_B}&tab=issues`, null)
    const params = new URL(href).searchParams

    assert.equal(params.get(ISSUE_PARAM), null)
    assert.equal(params.get(PR_PARAM), null)
    assert.equal(params.get('tab'), 'issues')
})

test('withVorgang: eine unbrauchbare Id wird nicht geschrieben', () => {
    assert.equal(new URL(withVorgang(BASIS, { art: 'issue', id: 'bob' })).searchParams.get(ISSUE_PARAM), null)
})

test('withVorgang: eine Adresse, die keine ist, kommt unverändert zurück', () => {
    assert.equal(withVorgang('nicht-mal-eine-url', { art: 'issue', id: ID }), 'nicht-mal-eine-url')
})
