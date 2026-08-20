/**
 * Die Ordnungen der Artikelliste — **ein eigenes Modul mit NULL Importen.**
 *
 * ── Warum das nicht in `articleList.ts` bleibt ───────────────────────────────────────
 *
 * `bridge.ts` braucht diese Werte (Startwert, „liegt ein Filter an?", „alles zurück"),
 * und es braucht sie SOFORT — die Insel `nostrArticles` setzt ihren Startzustand, bevor
 * irgendein `import()` aufgelöst ist. Aus `articleList.ts` importieren ginge nicht ohne
 * Preis: das Modul hängt über `longform.ts` an markdown-it, und ein statischer
 * WERT-Import zöge die ganze Kette in den `app`-Chunk, den JEDE Seite lädt.
 *
 * **Der Preis ist nicht geschätzt, sondern durch eine Gegenprobe gebaut** (2026-08-20,
 * `npm run build`, beide Fassungen nacheinander):
 *
 * | `bridge.ts` importiert aus | `app`-Chunk | eigener `longform`-Chunk |
 * |---|---:|---:|
 * | `articleSorts.ts` (so gebaut) |  **88,33 kB gzip** | 49,40 kB gzip |
 * | `articleList.ts` (naiv)       | **138,41 kB gzip** | **fällt weg** |
 *
 * Der Lazy-Chunk verschwindet in der zweiten Fassung vollständig: **+50,08 kB gzip auf
 * jeder Seite des Clients**, für einen Screen, den die meisten Sitzungen nie öffnen.
 * Genau das verhindert die Insel mit ihrem dynamischen Import — und dieses Modul ist der
 * Grund, warum sie es weiterhin kann.
 *
 * Vorher standen die drei Zeichenketten deshalb dreifach im Quelltext: hier, in
 * `bridge.ts` als `'newest'`-Literale und in `⚡articles.blade.php`. Drei Kopien, von
 * denen zwei still auseinanderlaufen konnten — `sortArticles` fällt bei einem unbekannten
 * Wert auf `newest` zurück, ohne dass etwas rot wird.
 *
 * Dieses Modul löscht die Kopie in `bridge.ts`. Die in Blade bleibt (PHP und TypeScript
 * teilen zur Laufzeit nichts) und wird stattdessen von `articleSorts.test.ts` gegen
 * dieses Modul gehalten — Datei gelesen, Werte verglichen, Reihenfolge inklusive.
 *
 * Rein und ohne jede Abhängigkeit:
 *   node --experimental-strip-types --test packages/einundzwanzig-group/js/articleSorts.test.ts
 */

/**
 * Die Ordnungen der Liste, in der Reihenfolge, in der die Oberfläche sie anbietet.
 *
 * **Wörtlich drei.** Ein Test hält Zahl und Werte fest — ohne ihn hielte jede Zusicherung
 * die Konstante gegen sich selbst, und eine Kürzung bliebe grün (im Haus schon passiert:
 * `COVER_PALETTE`, P1).
 */
export const ARTICLE_SORTS = ['newest', 'author', 'title'] as const

export type ArticleSort = (typeof ARTICLE_SORTS)[number]

/**
 * Die Ordnung ohne Zutun: **Neueste zuerst**.
 *
 * Die Feldwahl dahinter (`publishedAt`, also `published_at` mit Rückfall auf `created_at`)
 * ist in P2 **unverändert** geblieben — begründet im Plan unter „Verworfen" und gestützt
 * darauf, dass alle 13 Driftfälle des Bestands **rück**datiert sind (12 davon
 * Podcast-Archivimporte). Ein Umstieg auf `created_at` höbe genau die nach oben.
 */
export const DEFAULT_ARTICLE_SORT: ArticleSort = 'newest'
