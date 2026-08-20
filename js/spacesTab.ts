/**
 * Der Tab der Space-Seite in der URL: `/spaces?tab=threads`.
 *
 * **Warum es diesen Whitelist-Leser gibt.** Der `$watch` in `bridge.ts` spiegelt JEDEN
 * Tab-Wechsel in die Adresse — auch `workspaces`. Gelesen wurde beim Mount aber nur
 * `threads`; alles andere fiel auf `rooms` zurück. Ein geteilter oder neu geladener
 * `?tab=workspaces`-Link zeigte damit verlässlich den falschen Tab, und zwar still: die
 * Adresse behauptete das eine, der Bildschirm zeigte das andere.
 *
 * **Warum der Leser den Workspace kennen muss.** Der dritte Tab existiert nur, wenn ein
 * Workspace konfiguriert ist (`hasWorkspace()`, im Markup `x-if="hasWorkspace"`). Ein
 * `tab: 'workspaces'` ohne gerenderten Tab wäre ein Zustand ohne Panel — die Bar zeigte
 * keinen ausgewählten Eintrag und die Fläche darunter bliebe leer. Die Verfügbarkeit ist
 * deshalb ein ARGUMENT dieser Funktion und keine Annahme in ihr: das Modul bleibt rein,
 * und der Aufrufer bringt die eine Tatsache mit, die er ohnehin schon hat.
 *
 * Dieselbe Whitelist-Haltung wie bei `?space=` (`readSpaceParam`, `spaceParam.ts`) und
 * `?from=` (`readOrigin`, `updatesView.ts`): was nicht auf der Liste steht, ist Müll und
 * wird verworfen, statt in den Zustand durchgereicht zu werden.
 *
 * Kein Import: das Modul ist rein und ohne welshman/Alpine testbar
 * (`node --experimental-strip-types --test packages/einundzwanzig-group/js/spacesTab.test.ts`).
 */

/** Der Query-Parameter, der den Tab der Space-Seite trägt. */
export const SPACES_TAB_PARAM = 'tab'

/** Die Tabs der Space-Seite — genau die drei aus `⚡spaces.blade.php`. */
export type SpacesTab = 'rooms' | 'threads' | 'workspaces'

/**
 * Der Startwert ohne (oder mit ungültigem) Parameter. Er steht bewusst NICHT in der
 * URL — eine saubere Adresse für den Normalfall, siehe den Schreiber in `bridge.ts`.
 */
export const DEFAULT_SPACES_TAB: SpacesTab = 'rooms'

/**
 * Liest den Tab aus einer Query (`window.location.search`).
 *
 * @param search        Die Query-Zeichenkette, mit oder ohne führendes `?`.
 * @param hasWorkspace  Ist ein Workspace konfiguriert, existiert der dritte Tab also?
 *                      Ohne ihn ist `?tab=workspaces` genauso ungültig wie Müll.
 */
export const readSpacesTab = (search: string, hasWorkspace: boolean): SpacesTab => {
    const value = new URLSearchParams(search).get(SPACES_TAB_PARAM)

    if (value === 'threads') {
        return 'threads'
    }

    if (value === 'workspaces' && hasWorkspace) {
        return 'workspaces'
    }

    return DEFAULT_SPACES_TAB
}
