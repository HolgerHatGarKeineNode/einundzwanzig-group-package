/**
 * Die Artikelliste als **Projektion**: filtern, sortieren, hervorheben (P2).
 *
 * Rein — kein welshman, kein Alpine, kein DOM. Alles, was diese Fläche an Entscheidungen
 * trifft, steht hier und ist unter `node --test` prüfbar:
 *
 *   node --experimental-strip-types --test packages/einundzwanzig-group/js/articleList.test.ts
 *
 * Die Insel in `bridge.ts` hält danach nur noch drei Werte (`items`, `query`, `sort`) und
 * ruft genau eine Funktion.
 *
 * ── Warum die Suche NICHT `searchMessages` ruft ──────────────────────────────────────
 *
 * `searchMessages` (`search.ts`) ist die Suche des Chat-Verlaufs und dort richtig: kurze
 * Zeilen, viele davon. Ein Artikel ist das Gegenteil — 104 Zeilen à im Mittel 4 400
 * durchsuchbare Zeichen. Sie faltet ihre Heuhaufen bei **jedem Aufruf** neu
 * (`matchesAllTerms` → `foldForSearch`), und die Faltung ist der teure Teil: sie legt zu
 * jedem Zeichen einen Index-Eintrag an, damit Trefferstellen auf den Originaltext
 * zurückzeigen können.
 *
 * Am echten Bestand gemessen (2026-08-20, 104 Artikel, 458 687 durchsuchbare Zeichen nach
 * {@link articleSearchText}, je 15 Läufe auf dem Entwicklungsrechner):
 *
 * | Weg                                                   | je Tastendruck |
 * |-------------------------------------------------------|---------------:|
 * | `searchMessages(rows, 'b', 104)`                        |      127,65 ms |
 * | `searchMessages(rows, 'bitcoin', 104)`                  |      109,24 ms |
 * | nur `matchesAllTerms` (also der Filter ohne Ausschnitte)|       62,29 ms |
 * | **hier: vorgefaltet + `includes`**                      | **0,01–0,30 ms** |
 *
 * Der Preis dafür ist **88 ms einmalig** je neu eingetroffenem Artikel — nicht je
 * Tastendruck. Auf dem Entwicklungsrechner wären 62 ms je Anschlag gerade noch erträglich;
 * ein Telefon rechnet drei- bis fünfmal langsamer, und dann steht die Tastatur.
 *
 * **Die Semantik bleibt identisch, und das ist kein Vorsatz, sondern ein Test:**
 * `articleList.test.ts` schickt dieselben Eingaben durch beide Wege und vergleicht die
 * Trefferlisten. Laufen sie je auseinander, ist dieser Test rot — nicht ein Bugreport in
 * drei Monaten. Gefaltet wird mit demselben {@link foldForSearch}, zerlegt mit demselben
 * {@link parseSearchTerms}, hervorgehoben mit demselben {@link findMatchRanges}: UND über
 * die Begriffe, ODER über die Felder, diakritika-blind, ß gilt als ss, der Autorname zählt
 * mit.
 *
 * `searchMessages` selbst bleibt **unangetastet**. Sie trägt die Chat-Suche; ein Umbau
 * dort wäre ein zweiter, ungeplanter Prüfgegenstand.
 */
import type { ArticleRow } from './longform.ts'
import { articleSearchText } from './longform.ts'
import { findMatchRanges, foldForSearch, parseSearchTerms, toSegments, type SearchSegment } from './search.ts'
import { DEFAULT_ARTICLE_SORT, type ArticleSort } from './articleSorts.ts'

/**
 * Die Ordnungen wohnen in `articleSorts.ts` — einem Modul ohne jeden Import, damit
 * `bridge.ts` sie statisch nehmen kann, ohne markdown-it in den `app`-Chunk zu ziehen
 * (Begründung dort). Hier nur durchgereicht, damit Verbraucher dieser Projektion nicht
 * zwei Adressen kennen müssen.
 */
export { ARTICLE_SORTS, DEFAULT_ARTICLE_SORT, type ArticleSort } from './articleSorts.ts'

/**
 * Sortiervergleich für Titel und Autorennamen.
 *
 * `sensitivity: 'base'` — „Über" und „Uber" stehen nebeneinander, nicht am jeweils anderen
 * Ende. `numeric: true` — „Teil 2" vor „Teil 10". Injizierbar, damit ein Test eine feste
 * Locale setzen kann; ohne Angabe entscheidet die Umgebung, und das ist zur Laufzeit
 * genau richtig (die App läuft in sieben Sprachen).
 */
const DEFAULT_COLLATOR = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true })

/**
 * Zweitschlüssel jeder Ordnung: neueste zuerst, bei Gleichstand die Event-Id.
 *
 * **Die Id ist kein Zierrat, sondern macht die Ordnung total.** Ohne sie hinge die
 * Reihenfolge zweier gleich datierter Artikel an der Stabilität von `Array.sort` und
 * damit an der Eingangsreihenfolge der Ableitung — die sich bei jedem eintreffenden kind-0
 * ändern kann. Die Liste spränge dann beim Nachladen der Profile um.
 *
 * Verglichen wird roh (`<`/`>`), nicht per `localeCompare`: eine Event-Id ist Hex, und
 * eine locale-abhängige Ordnung über Hex wäre eine Abhängigkeit ohne Gegenwert.
 */
const byNewest = (a: ArticleRow, b: ArticleRow): number =>
    b.publishedAt - a.publishedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

/**
 * Die Liste in eine der drei Ordnungen bringen. Gibt **immer ein neues Array** zurück —
 * die Eingabe kommt aus einem Store und gehört diesem.
 *
 * **Titellose Artikel stehen in A–Z hinten.** Ein leerer Titel trägt keinen Namen, nach
 * dem man ihn einsortieren könnte; vorne geklumpt wären es genau die Zeilen, unter denen
 * die Oberfläche „Ohne Titel" schreibt — eine Gruppe Namenloser als Auftakt einer
 * alphabetischen Liste. Im heutigen Bestand ist die Menge leer (0 von 104 ohne `title`),
 * die Regel steht für den Tag, an dem sie es nicht mehr ist.
 */
export const sortArticles = (
    rows: readonly ArticleRow[],
    sort: ArticleSort,
    collator: Intl.Collator = DEFAULT_COLLATOR,
): ArticleRow[] => {
    if (sort === 'author') {
        return [...rows].sort((a, b) => collator.compare(a.authorName, b.authorName) || byNewest(a, b))
    }

    if (sort === 'title') {
        return [...rows].sort((a, b) => {
            const left = a.title.trim()
            const right = b.title.trim()
            if (!left !== !right) {
                return left ? -1 : 1
            }

            return collator.compare(left, right) || byNewest(a, b)
        })
    }

    return [...rows].sort(byNewest)
}

/**
 * Eine Karte der Liste: die Zeile plus das, was nur die Suche und die Position beisteuern.
 *
 * Die drei `*Parts` sind fertige Anzeigestücke (`hit: true` = hervorheben). Sie stehen
 * **auch ohne Suche** da und enthalten dann genau ein Stück — die Oberfläche hat damit
 * einen einzigen Renderpfad statt zweier, und der Fall „gerade wird gesucht" ist keine
 * Verzweigung im Markup.
 */
export type ArticleCard = ArticleRow & {
    /** Titel, in Trefferstücke zerlegt. */
    titleParts: SearchSegment[]
    /** Teaser, in Trefferstücke zerlegt. */
    teaserParts: SearchSegment[]
    /** Autorname, in Trefferstücke zerlegt. */
    authorParts: SearchSegment[]
    /**
     * Die erste Karte der **ungefilterten** Liste in der **Standard**-Ordnung.
     *
     * Die Hervorhebung behauptet „das ist der neueste Artikel". Unter einer Suche oder
     * einer anderen Ordnung wäre das schlicht unwahr — dann ist die erste Karte nur die
     * erste. Deshalb gibt es in beiden Fällen **keine** hervorgehobene Karte, statt eine
     * beliebige Zeile groß zu setzen.
     */
    featured: boolean
}

/** Was {@link createArticleList} von außen entgegennimmt — beides nur für Tests nötig. */
export type ArticleListDeps = {
    /** Sortiervergleich; ohne Angabe die Umgebungs-Locale. */
    collator?: Intl.Collator
    /**
     * Die Faltung. Injizierbar, damit ein Test **zählen** kann, wie oft gefaltet wird —
     * die Zusage „einmal je Artikel, nicht je Tastendruck" ist sonst unprüfbar.
     */
    fold?: (text: string) => string
}

/** Die Projektion — ein Aufruf je Änderung von Bestand, Suchtext oder Ordnung. */
export type ArticleListProjector = {
    cards(rows: readonly ArticleRow[], query: string, sort: ArticleSort): ArticleCard[]
}

/**
 * Baut die Projektion **mit ihrem Faltungs-Merker**.
 *
 * ── Warum eine Fabrik und kein freier Funktionsaufruf ────────────────────────────────
 *
 * Der Merker ist der ganze Punkt (siehe Modulkopf). Er hängt am Lebenszyklus der Insel:
 * ein Screen, ein Merker, und mit dem Screen ist er weg. Ein Modul-globaler Merker wäre
 * über Sitzungen hinweg unbegrenzt gewachsen, und ein Test könnte ihn nicht zurücksetzen.
 *
 * **Geschlüsselt wird auf die Event-Id, und das veraltet nie.** Ein 30023 ist ersetzbar:
 * eine überarbeitete Fassung desselben Artikels ist ein anderes Ereignis mit einer anderen
 * Id und bekommt zwangsläufig einen eigenen Eintrag. Der alte kann nicht fälschlich
 * weiterverwendet werden — er ist unerreichbar, weil ihn niemand mehr nachfragt. Exakt
 * dieselbe Begründung wie beim `htmlCache` und beim `readingCache` in `longformFeed.ts`.
 *
 * **Der Autorname steht bewusst NICHT im Merker.** Er trifft asynchron ein (kind 0) und
 * ändert sich nach dem ersten Emit — gemerkt wäre er ab da falsch, und ein Nutzer fände
 * einen Autor unter seiner npub-Kurzform, aber nicht unter seinem Namen. Er wird deshalb
 * je Aufruf gefaltet. **Gemessen 0,249 ms** für 104 Namen (1 970 Zeichen, 200 Läufe) —
 * gegen die 87 ms der einmaligen Volltext-Faltung ist das der Preis, der die
 * Reaktivität kauft. (Hier stand „unter 0,01 ms"; das war geschätzt und um das
 * Fünfundzwanzigfache zu günstig.)
 */
export const createArticleList = (deps: ArticleListDeps = {}): ArticleListProjector => {
    const collator = deps.collator ?? DEFAULT_COLLATOR
    const fold = deps.fold ?? ((text: string): string => foldForSearch(text).folded)
    const foldedById = new Map<string, string>()

    const foldedText = (row: ArticleRow): string => {
        let folded = foldedById.get(row.id)
        if (folded === undefined) {
            // `articleSearchText` (P1) liefert den Vertrag: Titel, Teaser und Fließtext,
            // Data-URIs herausgeschnitten. Ohne das Strippen fände „sad" fünf Artikel, in
            // denen das Wort nirgends steht — die Begründung steht dort ausführlich.
            folded = fold(articleSearchText(row).text)
            foldedById.set(row.id, folded)
        }

        return folded
    }

    return {
        cards(rows: readonly ArticleRow[], query: string, sort: ArticleSort): ArticleCard[] {
            const terms = parseSearchTerms(query)
            const matched =
                terms.length === 0
                    ? rows
                    : rows.filter((row) => {
                          const haystacks = [foldedText(row), fold(row.authorName)]

                          return terms.every((term) => haystacks.some((hay) => hay.includes(term)))
                      })

            const ordered = sortArticles(matched, sort, collator)
            // Die hervorgehobene Karte gibt es nur in der unveränderten Ansicht — siehe
            // {@link ArticleCard.featured}.
            const featuredAt = terms.length === 0 && sort === DEFAULT_ARTICLE_SORT ? 0 : -1

            return ordered.map((row, index) => ({
                ...row,
                titleParts: toSegments(row.title, findMatchRanges(row.title, terms)),
                teaserParts: toSegments(row.teaser, findMatchRanges(row.teaser, terms)),
                authorParts: toSegments(row.authorName, findMatchRanges(row.authorName, terms)),
                featured: index === featuredAt,
            }))
        },
    }
}
