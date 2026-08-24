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
    /*
     * **`?tab=issues` stand bis P3 (2026-08-24) in dieser Liste — berechtigt, und
     * berechtigt entfernt.** Damals gab es die Liste nicht; ein solcher Parameter
     * war Müll und musste zurückfallen. Seit P3 ist er ein gültiger Wert
     * (workspace-weite Issue-Liste). Die Zeile hier wandert deshalb nach unten in
     * den Positivfall statt gestrichen zu werden — sonst verlöre die Whitelist
     * genau den Fall, der ihre Bedeutung geändert hat.
     *
     * `?tab=Workspaces` bleibt: die Whitelist vergleicht Zeichen für Zeichen,
     * und eine Grossschreibung aus einer fremden Adresse ist kein Tab.
     */
    for (const search of ['', '?', '?tab=', '?tab=Workspaces', '?tab=Issues', '?tab=../etc', '?rt=meetups']) {
        assert.equal(readForgeTab(search), DEFAULT_FORGE_TAB, search)
    }
})

test('readForgeTab nimmt die workspace-weiten Listen an (P3)', () => {
    assert.equal(readForgeTab('?tab=issues'), 'issues')
    assert.equal(readForgeTab('?tab=pulls'), 'pulls')
    // KONTROLLE: `pr` ist NICHT der Tab-Bezeichner — die Liste heisst `pulls`,
    // wie auf der Repo-Seite. Zwei Namen für dieselbe Liste wären zwei Bedeutungen.
    assert.equal(readForgeTab('?tab=pr'), DEFAULT_FORGE_TAB)
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
    // Seit P3 fünf Werte: `issues`/`pulls` sind die workspace-weiten Listen. Sie
    // stehen in der Whitelist, aber NICHT in der Tab-Reihe — die bleibt bei drei
    // (der Kanäle-Tab ist unterhalb `xl` der einzige Zugang zu den Kanälen).
    assert.deepEqual([...FORGE_TABS], ['activity', 'repos', 'workspaces', 'issues', 'pulls'])
})

test('jeder gültige Tab überlebt die Runde schreiben → lesen', () => {
    for (const tab of ['activity', 'repos', 'workspaces'] as const) {
        const url = new URL('https://example.test/forge')
        url.searchParams.set(FORGE_TAB_PARAM, tab)
        assert.equal(readForgeTab(url.search), tab)
    }
})
