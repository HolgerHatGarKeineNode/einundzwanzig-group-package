/**
 * Der Riegel gegen die EINE Kopie der Sortierwerte, die sich nicht beseitigen ließ.
 *
 *   node --experimental-strip-types --test packages/einundzwanzig-group/js/articleSorts.test.ts
 *
 * ── Warum es diese Datei gibt ────────────────────────────────────────────────────────
 *
 * Die drei Ordnungswerte standen dreifach im Quelltext: in `articleSorts.ts`, in
 * `bridge.ts` als `'newest'`-Literale und in `⚡articles.blade.php`. Zwei der drei Kopien
 * konnten still auseinanderlaufen — `sortArticles` fällt bei einem unbekannten Wert auf
 * `newest` zurück, ohne dass irgendetwas rot wird. Die Kopie in `bridge.ts` ist gelöscht
 * (sie importiert jetzt {@link DEFAULT_ARTICLE_SORT}); die in Blade bleibt, weil PHP und
 * TypeScript zur Laufzeit nichts teilen. **Sie wird hier gehalten, nicht behauptet.**
 *
 * Der Kommentar im Blade nannte vor diesem Test einen Server-Test in
 * `LongformReaderTest.php`, der diese Zusage NIE eingelöst hat — dort steht keine einzige
 * Zusicherung auf einen Sortierwert. Eine falsche Deckungszusage ist schlimmer als eine
 * fehlende: sie erzeugt Vertrauen ohne Deckung, und der nächste Leser prüft nicht nach,
 * weil dort steht, es sei geprüft.
 *
 * Warum hier und nicht als `assertSee` im Pest-Test: ein `assertSee` belegte, dass die
 * drei Zeichenketten IRGENDWO im Markup stehen. Es fiele nicht auf einen vierten Wert
 * herein, nicht auf eine vertauschte Reihenfolge und nicht auf einen Tippfehler, der eine
 * andere Zeile trifft. Dieser Test vergleicht die beiden LISTEN, Reihenfolge inklusive —
 * und er lebt im selben Repo wie beide Artefakte, also braucht er keine Änderung am Host.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ARTICLE_SORTS, DEFAULT_ARTICLE_SORT, type ArticleSort } from './articleSorts.ts'
// Ausdrücklich über die zweite Adresse: `articleList.ts` reicht die Konstanten weiter,
// und ein gebrochener Re-Export fiele sonst nirgends auf.
import { ARTICLE_SORTS as DURCHGEREICHT } from './articleList.ts'

const BLADE = join(import.meta.dirname, '..', 'resources', 'views', '⚡articles.blade.php')

/**
 * Die `value`-Einträge aus dem `$sortOptions`-Block des Blade-Views.
 *
 * **Findet die Sonde ihren Block nicht, wirft sie** — statt eine leere Liste
 * zurückzugeben. Eine Sonde, die bei unlesbarer Eingabe „nichts gefunden" meldet, ist
 * fail-open: sie sähe nach einem Umbau des Views wie ein bestandener Test aus, während sie
 * in Wahrheit gar nichts mehr misst.
 */
const sortwerteAusBlade = (): string[] => {
    const quelle = readFileSync(BLADE, 'utf8')
    const block = /\$sortOptions\s*=\s*\[([\s\S]*?)\];/.exec(quelle)
    if (!block) {
        throw new Error(`Kein $sortOptions-Block in ${BLADE} gefunden — die Sonde misst nichts mehr.`)
    }

    return [...block[1]!.matchAll(/'value'\s*=>\s*'([^']*)'/g)].map((treffer) => treffer[1]!)
}

// ── Die Konstanten WÖRTLICH ──────────────────────────────────────────────────────────

test('ARTICLE_SORTS traegt WOERTLICH drei Ordnungen, in dieser Reihenfolge', () => {
    assert.deepEqual([...ARTICLE_SORTS], ['newest', 'author', 'title'])
    assert.equal(ARTICLE_SORTS.length, 3)
})

test('DEFAULT_ARTICLE_SORT ist WOERTLICH `newest` — die Feldwahl der Liste bleibt publishedAt', () => {
    assert.equal(DEFAULT_ARTICLE_SORT, 'newest')
    assert.equal(ARTICLE_SORTS.includes(DEFAULT_ARTICLE_SORT), true)
})

test('`articleList.ts` reicht dieselben Werte weiter — der Re-Export ist nicht gebrochen', () => {
    assert.deepEqual([...DURCHGEREICHT], [...ARTICLE_SORTS])
})

// ── Der Riegel: Blade gegen die Konstante ────────────────────────────────────────────

test('die Sonde findet ihren Block ueberhaupt — sonst ist jede Aussage darunter wertlos', () => {
    // Die Schranke ist der zweite halbe Test (Bauform aus `I18nCatalogGateTest`): ein
    // Leser, der nichts mehr findet, meldet sonst dasselbe wie ein Leser, der alles
    // gefunden hat. Bewusst `>= 3` und nicht `=== 3` — die Gleichheit prueft der Test
    // darunter, und diese Schranke soll auch dann noch greifen, wenn eine vierte Ordnung
    // dazukommt.
    assert.equal(sortwerteAusBlade().length >= 3, true, 'Der $sortOptions-Block liefert weniger als drei Werte.')
})

test('RIEGEL: die Sortierwerte in `⚡articles.blade.php` sind identisch mit ARTICLE_SORTS — Reihenfolge inklusive', () => {
    // Reihenfolge zaehlt: die Oberflaeche baut ihr Auswahlmenue in genau dieser Folge,
    // und `nostrArticles.sortLabel()` schlaegt die Beschriftung ueber den Wert nach. Eine
    // Vertauschung waere ein falsch beschrifteter Umschalter, keine Fehlermeldung.
    assert.deepEqual(sortwerteAusBlade(), [...ARTICLE_SORTS])
})

test('jeder Wert aus dem Blade ist eine gueltige ArticleSort — kein Tippfehler rutscht durch', () => {
    // Ohne diese Zeile faenge der Vergleich oben zwar jede Abweichung, aber die Meldung
    // saehe nach „Reihenfolge" aus. Hier steht namentlich, WELCHER Wert unbekannt ist —
    // und genau der faellt zur Laufzeit still auf `newest` zurueck.
    for (const wert of sortwerteAusBlade()) {
        assert.equal(
            (ARTICLE_SORTS as readonly string[]).includes(wert),
            true,
            `„${wert}" steht im Blade, ist aber keine ArticleSort — sortArticles faellt darauf still auf „${DEFAULT_ARTICLE_SORT}" zurueck.`,
        )
    }
})

test('`bridge.ts` schreibt die Ordnungswerte NICHT mehr als Literale', () => {
    // Der zweite Teil der Aufraeumung, und der einzige Weg, ihn festzuhalten: ein neues
    // `'newest'` in der Insel waere eine dritte Wahrheit, die kein anderer Test sieht.
    const bridge = readFileSync(join(import.meta.dirname, 'bridge.ts'), 'utf8')
    for (const wert of ARTICLE_SORTS satisfies readonly ArticleSort[]) {
        assert.equal(
            bridge.includes(`'${wert}'`),
            false,
            `bridge.ts enthaelt wieder das Literal '${wert}' — es gehoert aus articleSorts.ts importiert.`,
        )
    }
})
