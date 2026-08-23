/**
 * Pure-Tests für den Tab-Parameter der Forge-Übersicht (welshman-/Alpine-frei).
 *   node --experimental-strip-types --test packages/einundzwanzig-group/js/forgeTab.test.ts
 *
 * Der tragende Fall ist `?tab=workspaces`: er ist das ZIEL der Weiterleitung von
 * `/spaces?tab=workspaces` (P5). Nimmt dieser Leser ihn nicht an, landet ein alter
 * Bookmark auf der Aktivitäts-Spur — still, ohne Fehler, mit falschem Bildschirm.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readForgeTab, DEFAULT_FORGE_TAB, FORGE_TAB_PARAM, FORGE_TABS } from './forgeTab.ts'

test('readForgeTab nimmt jeden der drei Tabs an', () => {
    // WÖRTLICH, nicht über `FORGE_TABS` iteriert: eine Schleife über die Konstante prüft
    // sie gegen sich selbst und bliebe grün, wenn jemand einen Tab herausnimmt.
    assert.equal(readForgeTab('?tab=activity'), 'activity')
    assert.equal(readForgeTab('?tab=repos'), 'repos')
    assert.equal(readForgeTab('?tab=workspaces'), 'workspaces')
})

test('der gestrichene Projekte-Tab fällt auf den Startwert, statt still zu wirken', () => {
    // Der Tab ist am 2026-08-23 entfallen; die Projekte leben ab `xl` in der Rail weiter.
    // Ein geteiltes `/forge?tab=projects` aus der Zeit davor darf NICHT dazu führen, dass
    // `x-model="tab"` einen Wert trägt, zu dem es kein Panel gibt — dann stünde die Fläche
    // leer da, ohne Ausweg. Genau dagegen ist die Whitelist gebaut.
    assert.equal(readForgeTab('?tab=projects'), DEFAULT_FORGE_TAB)
    assert.equal(readForgeTab('?tab=projects'), 'activity')
})

test('das Ziel der P5-Weiterleitung kommt wirklich an', () => {
    // `/spaces?tab=workspaces` → `/forge?tab=workspaces`. Der Leser bekommt genau die
    // Query, die die Weiterleitung anhängt — inklusive weiterer Parameter davor.
    assert.equal(readForgeTab('?tab=workspaces'), 'workspaces')
    assert.equal(readForgeTab('?von=spaces&tab=workspaces'), 'workspaces')
    assert.notEqual(readForgeTab('?tab=workspaces'), DEFAULT_FORGE_TAB)
})

test('readForgeTab verwirft alles andere', () => {
    for (const search of ['', '?', '?tab=', '?tab=Workspaces', '?tab=issues', '?tab=../etc', '?rt=meetups']) {
        assert.equal(readForgeTab(search), DEFAULT_FORGE_TAB, search)
    }
})

test('der Startwert ist WÖRTLICH „activity"', () => {
    // Ohne diese Zeile hielten alle übrigen Zusicherungen die Konstante gegen sich selbst.
    assert.equal(DEFAULT_FORGE_TAB, 'activity')
    assert.equal(readForgeTab(''), 'activity')
})

test('der Parametername ist WÖRTLICH „tab" — derselbe wie auf der Space- und der Repo-Seite', () => {
    assert.equal(FORGE_TAB_PARAM, 'tab')
})

test('die Tab-Liste ist WÖRTLICH die drei aus dem Markup, in Anzeige-Reihenfolge', () => {
    assert.deepEqual([...FORGE_TABS], ['activity', 'repos', 'workspaces'])
})

test('jeder gültige Tab überlebt die Runde schreiben → lesen', () => {
    for (const tab of ['activity', 'repos', 'workspaces'] as const) {
        const url = new URL('https://example.test/forge')
        url.searchParams.set(FORGE_TAB_PARAM, tab)
        assert.equal(readForgeTab(url.search), tab)
    }
})
