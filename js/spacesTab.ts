/**
 * Der Tab der Space-Seite in der URL: `/spaces?tab=threads`.
 *
 * **Warum es diesen Whitelist-Leser gibt.** Der `$watch` in `bridge.ts` spiegelt JEDEN
 * Tab-Wechsel in die Adresse. Gelesen wurde beim Mount aber nur `threads`; alles andere
 * fiel auf `rooms` zurück. Ein geteilter oder neu geladener Link zeigte damit verlässlich
 * den falschen Tab, und zwar still: die Adresse behauptete das eine, der Bildschirm zeigte
 * das andere.
 *
 * ── Seit P5 gibt es genau ZWEI Tabs ──────────────────────────────────────────────────
 *
 * Der dritte Tab „Workspaces" ist nach `/forge` gewandert (Ortskarten-Leiste, P5). Damit
 * hat die Bar in **jeder** Konfiguration zwei Einträge, das `x-if` im Markup ist weg — und
 * dieser Leser braucht die Frage „gibt es einen Workspace?" nicht mehr. Sie war ein
 * ARGUMENT und keine Annahme, weil der Tab ohne Workspace gar nicht gerendert wurde; ohne
 * den Tab ist die Frage gegenstandslos.
 *
 * **`?tab=workspaces` fällt trotzdem NICHT still auf „Räume".** Genau das wäre der Fehler,
 * gegen den dieser Modulkopf geschrieben ist — nur unter anderem Namen: ein Bookmark oder
 * ein geteilter Link behauptete „Workspaces" und bekäme wortlos die Raumliste. Die Adresse
 * wird stattdessen SERVERSEITIG weitergeführt, bevor diese Funktion sie je sieht:
 * `⚡spaces.blade.php` (`mount()`) antwortet auf `/spaces?tab=workspaces` mit einer
 * Weiterleitung auf `/forge?tab=workspaces`, dort liest {@link readForgeTab}
 * (`forgeTab.ts`) den Wert. Serverseitig und nicht in der Insel, weil ein Redirect im
 * Client erst nach dem Boot liefe — der Nutzer sähe die Raumliste aufblitzen.
 *
 * ── Der Zwilling: `forgeTab.ts` ──────────────────────────────────────────────────────
 *
 * `readForgeTab` (`js/forgeTab.ts`) ist dasselbe Modul für `/forge` und seit P5 das ZIEL
 * der Weiterleitung oben. Die beiden gehören zusammen gelesen: ein Redirect ohne
 * Whitelist-Leser auf der Zielseite ließe die Adresse ankommen und dann ignorieren, und
 * ein Leser ohne Rückschreiben (`replaceState`, `forge.ts`) behauptete nach dem ersten
 * Tab-Klick weiter „workspaces". Das ist zweimal derselbe Fehler an zwei Orten, und
 * deshalb steht er hier zweimal geschlossen.
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

/** Die Tabs der Space-Seite — genau die zwei aus `⚡spaces.blade.php`. */
export type SpacesTab = 'rooms' | 'threads'

/**
 * Der Startwert ohne (oder mit ungültigem) Parameter. Er steht bewusst NICHT in der
 * URL — eine saubere Adresse für den Normalfall, siehe den Schreiber in `bridge.ts`.
 *
 * Zugleich die Festlegung „Chat steht an erster Stelle": auf beiden Ebenen der Navigation
 * (Ortskarten und Segmented-Bar) ist der Chat der erste Eintrag.
 */
export const DEFAULT_SPACES_TAB: SpacesTab = 'rooms'

/**
 * Liest den Tab aus einer Query (`window.location.search`).
 *
 * @param search Die Query-Zeichenkette, mit oder ohne führendes `?`.
 */
export const readSpacesTab = (search: string): SpacesTab => {
    const value = new URLSearchParams(search).get(SPACES_TAB_PARAM)

    if (value === 'threads') {
        return 'threads'
    }

    return DEFAULT_SPACES_TAB
}
