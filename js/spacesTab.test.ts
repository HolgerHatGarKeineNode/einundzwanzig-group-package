/**
 * Pure-Tests für den Tab-Parameter der Space-Seite (welshman-/Alpine-frei).
 *   node --experimental-strip-types --test packages/einundzwanzig-group/js/spacesTab.test.ts
 *
 * Der Parameter hat GENAU zwei Pflichten, und beide hängen an einem realen Fehler:
 *   1. Er MUSS jeden Tab zurücklesen, den der `$watch` in `bridge.ts` hineinschreibt —
 *      `workspaces` wurde einmal geschrieben, aber nie gelesen, und ein geteilter Link
 *      landete still auf „Räume".
 *   2. Er DARF nichts annehmen, was es nicht gibt: ein ausgewählter Tab ohne Panel ist
 *      eine leere Fläche ohne Ausweg.
 *
 * **Seit P5 ist `workspaces` kein Tab dieser Seite mehr** (er ist nach `/forge` gewandert).
 * Dass er hier auf `rooms` fällt, ist deshalb richtig — aber NUR, weil die Adresse den
 * Leser gar nicht mehr erreicht: `⚡spaces.blade.php` leitet `/spaces?tab=workspaces`
 * serverseitig auf `/forge?tab=workspaces` um. Diese Datei prüft die eine Hälfte (der
 * Leser kennt `workspaces` nicht mehr), die andere hängt am Feature-Test der Route.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readSpacesTab, DEFAULT_SPACES_TAB, SPACES_TAB_PARAM } from './spacesTab.ts'

test('readSpacesTab nimmt threads an', () => {
    assert.equal(readSpacesTab('?tab=threads'), 'threads')
    assert.equal(readSpacesTab('?rt=meetups&tab=threads&cc=de'), 'threads')
    assert.equal(readSpacesTab('tab=threads'), 'threads')
})

test('readSpacesTab verwirft alles andere — einschließlich des abgewanderten workspaces', () => {
    for (const search of [
        '',
        '?',
        '?tab=',
        '?tab=rooms',
        '?tab=Threads',
        '?tab=workspaces',
        '?tab=WORKSPACES',
        '?tab=../etc',
        '?rt=meetups',
    ]) {
        assert.equal(readSpacesTab(search), DEFAULT_SPACES_TAB, search)
    }
})

test('die Bar hat GENAU zwei Einträge — der Leser kennt keinen dritten', () => {
    // Die Zusage aus der P5-DoD („in jeder Config genau zwei Einträge"), auf der Seite,
    // auf der sie mechanisch prüfbar ist. Wer `workspaces` hier wieder aufnähme, ohne den
    // Tab zurückzubauen, bekäme einen ausgewählten Tab ohne Panel — dieselbe leere Fläche
    // wie vor der Whitelist. WÖRTLICH gegen die zwei Literale, nicht gegen den Typ: ein
    // `type`-Fehler fiele erst `tsc` auf, und dieser Test soll ihn vorher zeigen.
    const alle = new Set<string>()
    for (const search of ['', '?tab=threads', '?tab=rooms', '?tab=workspaces', '?tab=beliebig']) {
        alle.add(readSpacesTab(search))
    }
    assert.deepEqual([...alle].sort(), ['rooms', 'threads'])
})

test('der Default ist WÖRTLICH „rooms" — gegen ein Literal geprüft, nicht gegen sich selbst', () => {
    // Ohne diesen Fall halten alle übrigen Zusicherungen `DEFAULT_SPACES_TAB` gegen
    // `DEFAULT_SPACES_TAB` und sind damit gegen eine Änderung der Konstante blind:
    // auf 'threads' gesetzt blieben sie grün, während die Startseite ohne Parameter
    // stillschweigend die Thread-Liste statt der Räume öffnete. Der erste Tab ist
    // aber eine Festlegung („Chat steht an erster Stelle"), keine Beliebigkeit.
    assert.equal(DEFAULT_SPACES_TAB, 'rooms')

    // Und dieselbe Festlegung am Ergebnis, an einer Eingabe, die nicht `threads` ist.
    assert.equal(readSpacesTab(''), 'rooms')
    assert.equal(readSpacesTab('?tab=quatsch'), 'rooms')
})

test('der Parametername ist derselbe, den der Schreiber in bridge.ts setzt', () => {
    assert.equal(SPACES_TAB_PARAM, 'tab')
})

test('jeder gültige Tab überlebt die Runde schreiben → lesen', () => {
    // Die Gegenprobe zum `$watch`: was er in die URL schreibt, muss zurückkommen.
    for (const tab of ['threads'] as const) {
        const url = new URL('https://example.test/spaces')
        url.searchParams.set(SPACES_TAB_PARAM, tab)
        assert.equal(readSpacesTab(url.search), tab)
    }

    // Und der Default steht bewusst NICHT in der URL — er kommt aus der leeren Query.
    const clean = new URL('https://example.test/spaces')
    clean.searchParams.delete(SPACES_TAB_PARAM)
    assert.equal(readSpacesTab(clean.search), DEFAULT_SPACES_TAB)
})
