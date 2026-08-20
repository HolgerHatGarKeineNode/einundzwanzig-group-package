/**
 * Pure-Tests für den Tab-Parameter der Space-Seite (welshman-/Alpine-frei).
 *   node --experimental-strip-types --test packages/einundzwanzig-group/js/spacesTab.test.ts
 *
 * Der Parameter hat GENAU zwei Pflichten, und beide hängen an einem realen Fehler:
 *   1. Er MUSS jeden Tab zurücklesen, den der `$watch` in `bridge.ts` hineinschreibt —
 *      `workspaces` wurde geschrieben, aber nie gelesen, und ein geteilter Link landete
 *      still auf „Räume".
 *   2. Er DARF `workspaces` NICHT annehmen, wenn es den Tab gar nicht gibt: ohne
 *      konfigurierten Workspace rendert `x-if="hasWorkspace"` ihn nicht, und ein
 *      ausgewählter Tab ohne Panel ist eine leere Fläche ohne Ausweg.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readSpacesTab, DEFAULT_SPACES_TAB, SPACES_TAB_PARAM } from './spacesTab.ts'

test('readSpacesTab nimmt threads an — mit und ohne Workspace', () => {
    assert.equal(readSpacesTab('?tab=threads', true), 'threads')
    assert.equal(readSpacesTab('?tab=threads', false), 'threads')
    assert.equal(readSpacesTab('?rt=meetups&tab=threads&cc=de', true), 'threads')
})

test('readSpacesTab nimmt workspaces NUR an, wenn der Tab existiert', () => {
    assert.equal(readSpacesTab('?tab=workspaces', true), 'workspaces')
    // Der Fall ohne Workspace: der Tab wird nicht gerendert, also darf er auch nicht
    // ausgewählt sein. Rückfall auf den Default statt auf einen Zustand ohne Panel.
    assert.equal(readSpacesTab('?tab=workspaces', false), DEFAULT_SPACES_TAB)
})

test('readSpacesTab verwirft alles andere', () => {
    for (const search of ['', '?', '?tab=', '?tab=rooms', '?tab=Threads', '?tab=WORKSPACES', '?tab=../etc', '?rt=meetups']) {
        assert.equal(readSpacesTab(search, true), DEFAULT_SPACES_TAB, search)
    }
})

test('der Default ist WÖRTLICH „rooms" — gegen ein Literal geprüft, nicht gegen sich selbst', () => {
    // Ohne diesen Fall halten alle übrigen Zusicherungen `DEFAULT_SPACES_TAB` gegen
    // `DEFAULT_SPACES_TAB` und sind damit gegen eine Änderung der Konstante blind:
    // auf 'threads' gesetzt blieben sie grün, während die Startseite ohne Parameter
    // stillschweigend die Thread-Liste statt der Räume öffnete. Der erste Tab ist
    // aber eine Festlegung („Chat steht an erster Stelle"), keine Beliebigkeit.
    assert.equal(DEFAULT_SPACES_TAB, 'rooms')

    // Und dieselbe Festlegung am Ergebnis, an einer Eingabe, die weder `threads`
    // noch `workspaces` ist — mit und ohne Workspace.
    assert.equal(readSpacesTab('', true), 'rooms')
    assert.equal(readSpacesTab('?tab=quatsch', true), 'rooms')
    assert.equal(readSpacesTab('?tab=quatsch', false), 'rooms')
})

test('der Parametername ist derselbe, den der Schreiber in bridge.ts setzt', () => {
    assert.equal(SPACES_TAB_PARAM, 'tab')
})

test('jeder gültige Tab überlebt die Runde schreiben → lesen', () => {
    // Die Gegenprobe zum `$watch`: was er in die URL schreibt, muss zurückkommen.
    // Genau diese Runde war für `workspaces` unterbrochen.
    for (const tab of ['threads', 'workspaces'] as const) {
        const url = new URL('https://example.test/spaces')
        url.searchParams.set(SPACES_TAB_PARAM, tab)
        assert.equal(readSpacesTab(url.search, true), tab)
    }

    // Und der Default steht bewusst NICHT in der URL — er kommt aus der leeren Query.
    const clean = new URL('https://example.test/spaces')
    clean.searchParams.delete(SPACES_TAB_PARAM)
    assert.equal(readSpacesTab(clean.search, true), DEFAULT_SPACES_TAB)
})
