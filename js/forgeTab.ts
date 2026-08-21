/**
 * Der Tab der Forge-ÜBERSICHT in der URL: `/forge?tab=workspaces`.
 *
 * **Warum es ihn seit P5 gibt.** Der Tab „Workspaces" stand bis dahin auf `/spaces` und
 * war dort über `?tab=workspaces` adressierbar (`spacesTab.ts`). Mit dem Umzug hierher
 * hätte jeder Bookmark und jeder geteilte Link seine Bedeutung verloren — und zwar STILL:
 * `readSpacesTab` hätte auf „Räume" zurückgefallen, die Adresse behauptete das eine, der
 * Bildschirm zeigte das andere. Genau der Fehler, gegen den `spacesTab.ts` geschrieben
 * wurde. `⚡spaces.blade.php` leitet die alte Adresse deshalb serverseitig hierher weiter,
 * und dieser Leser nimmt sie an.
 *
 * ── Der Zwilling: `spacesTab.ts` ────────────────────────────────────────────────────
 *
 * `readSpacesTab` ist dasselbe Modul für `/spaces` und die QUELLE der Weiterleitung. Die
 * beiden gehören zusammen gelesen; die ausführliche Begründung, warum es beide Hälften
 * braucht — Leser hier UND Rückschreiben per `replaceState` in `forge.ts` —, steht in
 * seinem Modulkopf. Wer hier einen Tab ergänzt, prüft dort mit, ob die Adresse ihn
 * erreichen kann.
 *
 * Dieselbe Bauform wie `tabFromLocation` auf der Repo-Seite (`forge.ts`) und dieselbe
 * Whitelist-Haltung wie bei `?space=` und `?from=`: was nicht auf der Liste steht, ist
 * Müll und fällt auf den Startwert — ein ungeprüfter Query-Wert in `x-model="tab"` zeigte
 * sonst schlicht KEINEN Tab.
 *
 * Kein Import: das Modul ist rein und ohne welshman/Alpine testbar
 * (`node --experimental-strip-types --test packages/einundzwanzig-group/js/forgeTab.test.ts`).
 */

/** Der Query-Parameter, der den Tab der Forge-Übersicht trägt. */
export const FORGE_TAB_PARAM = 'tab'

/** Die vier Tabs aus `⚡forge.blade.php`, in Anzeige-Reihenfolge. */
export const FORGE_TABS = ['activity', 'projects', 'repos', 'workspaces'] as const

export type ForgeTab = (typeof FORGE_TABS)[number]

/**
 * Der Startwert ohne (oder mit ungültigem) Parameter — die Aktivitäts-Spur, also die
 * Frage „was ist hier zuletzt passiert?". Steht bewusst NICHT in der URL.
 */
export const DEFAULT_FORGE_TAB: ForgeTab = 'activity'

/**
 * Liest den Tab aus einer Query (`window.location.search`).
 *
 * @param search Die Query-Zeichenkette, mit oder ohne führendes `?`.
 */
export const readForgeTab = (search: string): ForgeTab => {
    const value = new URLSearchParams(search).get(FORGE_TAB_PARAM)

    return FORGE_TABS.find((tab) => tab === value) ?? DEFAULT_FORGE_TAB
}
