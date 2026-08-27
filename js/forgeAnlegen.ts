/**
 * ── WELCHE der zwei Anlege-Bauformen steht — an EINER Stelle entschieden ─────
 *
 * Der Anlege-Knopf der Forge gab es bis zum 2026-08-27 nur in EINER Form: als
 * rundes Plus am unteren Bildrand (`.forge-fab`). Das ist die mobile Bauform.
 * Am Desktop liegt sie ausserhalb des Blickfelds, in dem jemand eine Liste
 * liest — der Nutzer hat den Knopf auf der Live-Seite gesucht und nicht
 * gefunden. Gitea und GitHub setzen „Neues Issue" statt dessen als
 * beschrifteten Knopf in die Filterleiste ÜBER der Liste.
 *
 * Seither gibt es ZWEI Bauformen, und dieses Modul sagt, welche gilt. Es ist
 * bewusst ein eigenes Modul und keine Methode in `forge.ts`:
 *
 *   1. **Die Ausschliesslichkeit ist die eigentliche Zusage.** Zwei sichtbare
 *      Knöpfe für dieselbe Handlung wären schlimmer als der heutige Zustand —
 *      dann fragt sich der Leser, ob sie dasselbe tun. Stünden die zwei
 *      Bedingungen als je eigener Ausdruck in zwei Blade-Zeilen, wäre die
 *      Ausschliesslichkeit eine Absprache zwischen zwei Zeichenketten, die
 *      niemand prüft. Hier ist sie EINE Funktion mit EINEM Rückgabewert; zwei
 *      Formen zugleich sind damit nicht ausdrückbar, nicht nur unwahrscheinlich.
 *   2. **Prüfbar ohne Browser.** `forge.ts` zieht welshman und damit die halbe
 *      Insel; dieses Modul ist frei davon und läuft unter `node --test`.
 *
 * ── Warum die BREITE hereingereicht wird ────────────────────────────────────
 * Weil sie im Aufrufer reaktiv gelesen werden MUSS. Alpines `$store` ist aus
 * einem `Alpine.data`-Objekt heraus nicht als Abhängigkeit erfasst — das steht
 * in `forge.ts` an der Übersichts-Insel ausgeschrieben und hat dort schon einmal
 * eine stehengebliebene Fläche gekostet. In der Blade-Zeile
 * (`anlegeForm($store.viewport.desktop, …)`) findet die Lesung dagegen INNERHALB
 * des Alpine-Effekts statt und wird verfolgt; dieselbe Bauform wie an der
 * Bottom-Nav und an der Rail. Die Schwelle selbst steht weiterhin genau einmal,
 * in `viewport.ts` (`DESKTOP_QUERY`).
 */

/**
 * `kopf` = der beschriftete Knopf in der Filterleiste (Desktop-Chassis).
 * `fab`  = das runde Plus am unteren Bildrand (Mobil-Chassis, Daumenbereich).
 * `keins` = es gibt nichts anzulegen.
 */
export type AnlegeForm = 'kopf' | 'fab' | 'keins'

/** Der Reiter, auf dem der beschriftete Knopf steht. */
export const ANLEGE_TAB = 'issues'

/**
 * @param desktop Das CHASSIS, nicht die Spurbreite — siehe die Herleitung unten.
 * @param tab     Der offene Reiter der Repo-Werkbank.
 * @param geladen Steht eine Repo-Ansicht? Vor dem Laden gibt es nichts anzulegen.
 *
 * ── Warum das Chassis entscheidet und keine Container-Query ─────────────────
 * P3 und P5 haben ihre Schwellen bewusst an `@container` gehängt, weil dort die
 * SPURBREITE die Frage war (passt der Diff, passt die zweite Spalte). Hier ist
 * sie es nicht, und zwar aus einem strukturellen Grund:
 *
 *   Der FAB ist `position: fixed` und sitzt 5 rem über dem unteren Rand — genau
 *   dort, wo die Bottom-Nav steht. Die Bottom-Nav ist `xl:hidden`. Ab dem
 *   Desktop-Chassis ist der FAB also ein Knopf, der über nichts mehr schwebt;
 *   das ist die Frage, die hier beantwortet wird, und sie ist eine Frage des
 *   Chassis, nicht der Listenbreite.
 *
 *   Dazu kommt, dass eine Container-Query sie gar nicht beantworten KÖNNTE:
 *   `container-type: inline-size` bringt `contain: layout` mit und macht den
 *   Vorfahren zum Bezugsrahmen jedes `fixed`-Nachfahren. Ein FAB in einem
 *   Container klebt am Rand der Bühne statt am Rand des Fensters. Die zwei
 *   Formen stehen deshalb in verschiedenen Teilbäumen, und ein
 *   Container-Query-Ergebnis verlässt seinen Container nicht.
 *
 * Der Knopf muss auf jeder Desktop-Breite in die Leiste passen. Nachgerechnet
 * gegen die schmalste Stelle: Chassis-Schwelle 1280 px → Bühne 1280 − 320 (Rail)
 * − 64 (Polster) ≈ 896 px, einspaltig, die Werkbank hat alles davon. Ab 1440 px
 * greift `@container repo (min-width: 65rem)` und die Werkbank fällt auf
 * 1041 − 384 − 24 ≈ 633 px. Beides trägt eine Leiste aus Suchfeld und einem
 * 8,5-rem-Knopf mit grossem Abstand.
 */
export const anlegeForm = (desktop: boolean, tab: string, geladen: boolean): AnlegeForm => {
    if (!geladen) {
        return 'keins'
    }

    // Die Reihenfolge trägt: das Mobil-Chassis bekommt den FAB auf JEDEM Reiter
    // (`toggleIssueDraft` schaltet beim Öffnen auf die Issue-Liste — sonst legte
    // ein Klick auf dem Code-Reiter ein Issue an, von dem nichts zu sehen wäre).
    if (!desktop) {
        return 'fab'
    }

    // Am Desktop ist der Knopf an SEINE Liste gebunden. „Neues Issue" über einer
    // Patch-Liste wäre eine Beschriftung, die nicht zu ihrer Umgebung passt —
    // dieselbe Regel, nach der `detailSucheName()` mit dem Reiter wechselt.
    // Gitea macht es genauso: den grünen Knopf gibt es auf der Issue-Seite.
    return tab === ANLEGE_TAB ? 'kopf' : 'keins'
}
