/**
 * Die beiden Longform-Kind-Zahlen (NIP-23) — **und NICHTS sonst.**
 *
 * ── Warum diese vier Zeilen ein eigenes Modul sind ─────────────────────────────────
 *
 * **Diese Datei hat null Importe, und das ist ihr ganzer Zweck.** Sie ist die
 * Einzelquelle für zwei Konstanten, die von beiden Seiten der Bundle-Grenze gebraucht
 * werden: von `longform.ts` (das an **markdown-it** hängt und deshalb nur im Lazy-Chunk
 * der Artikelfläche landen darf) und von `articleMetrics.ts` (das über `core.ts` im
 * Boot-Pfad JEDER Seite liegt).
 *
 * Ein einziger WERT-Import über diese Grenze zieht den ganzen Renderer mit. Gemessen am
 * 2026-08-21, als `articleMetrics.ts` `LONGFORM` noch aus `longform.ts` holte:
 *
 * | app-Chunk | mit der Kante | ohne |
 * |---|---|---|
 * | roh | 386 868 B | 270 348 B |
 * | gzip | 139 559 B | **90 006 B** |
 *
 * **Rund 48 kB gzip auf jeder Seite — für die Zahl 30023.**
 *
 * ── Das ist die Hausform, nicht eine Erfindung dieser Phase ───────────────────────
 *
 * `js/articleSorts.ts` hat aus exakt demselben Grund null Importe (P2: ein Wert-Import
 * aus `bridge.ts` löste dort den Lazy-Chunk auf und ließ den app-Chunk um 50,08 kB gzip
 * wachsen), und `bridge.ts` begründet dieselbe Grenze an drei Stellen in seinem Kopf.
 *
 * ── Wer hier etwas ergänzt ────────────────────────────────────────────────────────
 *
 * **Nur Konstanten ohne Abhängigkeiten.** Der erste `import` in dieser Datei nimmt ihr
 * die Eigenschaft, wegen der sie existiert — und zwar unsichtbar: es wird nichts rot,
 * die Seiten werden nur langsamer. Der Riegel dagegen ist
 * `bundleGrenze.nodetest.ts` (auf den DATEINAMEN geankert, nicht auf einen Pfad — der
 * wandert beim nächsten Verschieben und wird still falsch); er misst das gebaute Artefakt.
 */

/** NIP-23: der publizierte Longform-Artikel (adressierbar, `d` = Kennung). */
export const LONGFORM = 30023

/**
 * NIP-23: der ENTWURF. Steht hier nur, damit die Zahl einen Namen hat — gefragt wird er
 * nie.
 *
 * **Wichtig für den Listenfilter:** 67 der 99 publizierten Artikel tragen ein `d` der
 * Form `draft-<ts>` (gemessen 2026-08-12; der Plan nannte 66 von 98). Das sind
 * **publizierte** Artikel, deren Kennung nur so heißt, weil der schreibende Client sie
 * beim ersten Speichern vergeben hat. Ein Filter auf das `d`-Muster löschte damit
 * **zwei Drittel** des Bestands — der teuerste stille Fehler, den diese Fläche machen
 * kann. Ein echter Entwurf ist kind {@link LONGFORM_DRAFT}, und den fragen wir nicht ab
 * (am Relay existieren davon 2).
 */
export const LONGFORM_DRAFT = 30024
