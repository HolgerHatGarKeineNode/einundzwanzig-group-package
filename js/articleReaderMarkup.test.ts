/**
 * **Der Riegel zwischen den reinen Modulen und dem Markup, das sie bedient.**
 *
 *   node --experimental-strip-types --test packages/einundzwanzig-group/js/articleReaderMarkup.test.ts
 *
 * PHP und TypeScript teilen zur Laufzeit nichts. Vier Zusagen dieser Phase stehen
 * deshalb zwangsläufig doppelt — einmal als Konstante im TS, einmal als Zeichenkette im
 * Blade — und können still auseinanderlaufen, ohne dass irgendetwas rot wird:
 *
 *  1. die Klasse, an der der Lightbox-Auslöser greift ({@link ARTICLE_IMAGE_CLASS}),
 *  2. das Attribut, aus dem er die Quelle liest ({@link ARTICLE_FULL_ATTR}),
 *  3. der Anker, an dem der Lesefortschritt misst (`data-artikel-text`),
 *  4. die Sticky-Bedingungen des Asides, die keine Testsuite sonst berührt.
 *
 * Bauform wie `articleSorts.test.ts`: **findet eine Sonde ihren Gegenstand nicht, wirft
 * sie** — statt „nichts gefunden" zu melden. Eine Sonde, die bei unlesbarer Eingabe
 * besteht, ist fail-open und sähe nach dem nächsten Umbau des Views wie ein bestandener
 * Test aus, während sie in Wahrheit gar nichts mehr misst.
 *
 * Warum hier und nicht als `assertSee` im Pest-Test: ein `assertSee` belegte, dass eine
 * Zeichenkette IRGENDWO im gerenderten Markup steht. Es fiele nicht darauf herein, dass
 * sie im falschen Element steht, und es könnte die TS-Konstante gar nicht kennen.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ARTICLE_FULL_ATTR, ARTICLE_IMAGE_CLASS } from './longform.ts'

const VIEWS = join(import.meta.dirname, '..', 'resources', 'views')
const ARTIKEL = join(VIEWS, '⚡article.blade.php')
const RAUM = join(VIEWS, '⚡room.blade.php')
const LIGHTBOX = join(VIEWS, 'components', 'lightbox-overlay.blade.php')

/**
 * Quelltext einer Datei, **ohne Blade-Kommentare** — und **werfend**, wenn sie fehlt
 * oder leer ist.
 *
 * Das Entfernen der Kommentare ist keine Kosmetik. Diese Views erklären sich
 * ausführlich, und jede Zusage steht dort auch als Zitat: `font-mono` kommt dreimal vor,
 * zweimal davon in dem Satz „**kein** `font-mono`". Eine Sonde über den rohen Quelltext
 * fände sie und meldete einen Verstoß, den es nicht gibt — oder, in der Gegenrichtung,
 * einen Anker, der nur im Kommentar erwähnt wird. Dieselbe Behandlung wie in
 * `zapTargetSources.test.ts` (`ohneKommentare`).
 */
const lies = (pfad: string): string => {
    const roh = readFileSync(pfad, 'utf8')
    if (roh.trim() === '') {
        throw new Error(`${pfad} ist leer — die Sonde misst nichts mehr.`)
    }
    const quelle = roh.replace(/\{\{--[\s\S]*?--\}\}/g, '')
    if (quelle.trim() === '') {
        throw new Error(`${pfad} besteht nur aus Kommentaren — die Sonde misst nichts mehr.`)
    }

    return quelle
}

/**
 * Der Klick-Auslöser des Artikeltextes, als Block.
 *
 * **Wirft, wenn der Block fehlt.** Er ist die Stelle, an der die Lightbox überhaupt
 * ausgelöst wird; ohne ihn wären alle Zusagen darunter über nichts.
 */
const ausloeserBlock = (): string => {
    const quelle = lies(ARTIKEL)
    // Angesetzt am ANKER der Fläche (`data-artikel-text`), nicht am ersten `x-on:click`
    // der Datei: der erste gehört dem Teilen-Knopf im Kopf, und eine Sonde, die dort
    // landet, prüft mit voller Überzeugung die falsche Stelle.
    const treffer = /data-artikel-text[\s\S]*?x-on:click="([\s\S]*?)"\s*><\/div>/.exec(quelle)
    if (!treffer) {
        throw new Error(`Kein x-on:click-Block am data-artikel-text in ${ARTIKEL} gefunden — die Sonde misst nichts mehr.`)
    }

    return treffer[1]!
}

// ── Die Schranke zuerst ─────────────────────────────────────────────────────────────

test('die Sonden finden ihre Gegenstaende ueberhaupt — sonst ist alles darunter wertlos', () => {
    assert.equal(lies(ARTIKEL).length > 2000, true, 'Die Artikel-View ist verdächtig klein.')
    assert.equal(lies(LIGHTBOX).length > 500, true, 'Die Lightbox-Komponente ist verdächtig klein.')
    assert.equal(ausloeserBlock().length > 20, true)
})

// ── 1./2. Der Lightbox-Auslöser folgt dem Chat-Muster ───────────────────────────────

test('der Ausloeser greift GENAU an ARTICLE_IMAGE_CLASS — nicht an einem getippten Namen', () => {
    // Der Vergleich läuft gegen die KONSTANTE, nicht gegen ein Literal im Test: würde
    // hier ein zweites Literal stehen, wäre genau die Kopie entstanden, die dieser Test
    // verhindern soll.
    assert.match(ausloeserBlock(), new RegExp(`matches\\('img\\.${ARTICLE_IMAGE_CLASS}'\\)`))
})

test('der Ausloeser liest dataset.full — dasselbe Attribut, das der Renderer schreibt', () => {
    // `data-full` ⇒ `dataset.full`. Die Umrechnung steht hier ausgeschrieben, damit ein
    // umbenanntes Attribut beide Seiten mitnimmt.
    const feld = ARTICLE_FULL_ATTR.replace(/^data-/, '')
    assert.equal(feld, 'full')
    assert.match(ausloeserBlock(), new RegExp(`dataset\\.${feld}\\b`))
})

test('der Ausloeser schreibt in `lightboxSrc` — der ganze Vertrag der Lightbox-Komponente', () => {
    assert.match(ausloeserBlock(), /lightboxSrc\s*=/)
    // Und die Komponente selbst liest ihn. Beide Hälften, damit nicht eine allein wandert.
    assert.match(lies(LIGHTBOX), /x-show="lightboxSrc"/)
})

test('die Lightbox steht in BEIDEN Aufrufern als Komponente — nirgends mehr als Kopie', () => {
    for (const [name, pfad] of [['Artikel', ARTIKEL], ['Raum', RAUM]] as const) {
        assert.match(lies(pfad), /<x-group::lightbox-overlay \/>/, `${name}: bindet die Lightbox-Komponente nicht ein`)
        // Die Gegenrichtung: der ausgelagerte Rumpf darf NICHT zusätzlich dort stehen.
        assert.equal(
            lies(pfad).includes('x-data="lightboxZoom"'),
            false,
            `${name}: trägt noch eine eigene Kopie des Lightbox-Rumpfes`,
        )
    }
    assert.match(lies(LIGHTBOX), /x-data="lightboxZoom"/)
})

test('die Systemleisten-Abstaende des Schliessen-Knopfes sind MITGEWANDERT, nicht verloren', () => {
    // Sie sind der Grund, warum die Datei in `tests/Feature/SafeAreaGateTest.php` steht.
    // Ein Verschieben, das sie unterwegs verliert, setzte den einzigen Ausgang der
    // Lightbox auf dem Telefon wieder unter die Uhr (gemeldet 2026-08-16).
    const quelle = lies(LIGHTBOX)
    assert.match(quelle, /top-\[max\(env\(safe-area-inset-top\),1rem\)\]/)
    assert.match(quelle, /right-\[max\(env\(safe-area-inset-right\),1rem\)\]/)
})

// ── 3. Der Anker der Fortschritt-Messung ────────────────────────────────────────────

test('der Artikeltext traegt `data-artikel-text` — der Anker, an dem gemessen wird', () => {
    const quelle = lies(ARTIKEL)
    // Bewusst ein eigenes Attribut und nicht die Stilklasse `.article-content`: eine
    // Messung, die an einem Klassennamen hängt, fällt aus, sobald jemand die Typografie
    // umbenennt — und sie fällt STILL aus (die Sonde meldet dann „nicht verfolgbar").
    assert.match(quelle, /data-artikel-text/)
    assert.equal((quelle.match(/data-artikel-text/g) ?? []).length, 1, 'Der Anker darf genau einmal vorkommen.')
})

test('die Leseleiste respektiert prefers-reduced-motion — sie springt, statt zu gleiten', () => {
    const quelle = lies(ARTIKEL)
    // ZWEI Anker, und die Trennung ist Absicht: `data-leseleiste` am Rahmen beantwortet
    // „gibt es überhaupt eine Leiste?", `data-leseleiste-fuellung` trägt den Wert. Die
    // Füllung ist bei 0 % null Pixel breit und gilt damit jeder Sichtbarkeitsprüfung als
    // unsichtbar — ein Test, der sie nach der Existenz fragt, misst die falsche Sache.
    assert.equal(/data-leseleiste[^-]/.test(quelle), true, 'Kein `data-leseleiste` am Rahmen — die Sonde misst nichts mehr.')
    assert.equal(/data-leseleiste-fuellung/.test(quelle), true, 'Keine `data-leseleiste-fuellung` — die Sonde misst nichts mehr.')
    // WÖRTLICH die Tailwind-v4-Schreibweise des Hauses (`status-strip.blade.php` nutzt
    // dieselbe). Ein blankes `transition-[width]` ohne diese Zeile wäre unter
    // `prefers-reduced-motion` eine laufende Animation — und genau das verbietet die DoD.
    assert.match(quelle, /transition-\[width\][^"]*motion-reduce:transition-none/)
})

// ── 4. Die Sticky-Bedingungen des Asides ────────────────────────────────────────────

test('das Raster setzt `xl:items-start` — ohne das klebt gar nichts', () => {
    // Raster-Kinder strecken sich per Default auf Zeilenhöhe. Ein `sticky` an einem
    // zeilenhohen Kind hat keinen Weg zu wandern: es sieht aus wie ein Fehler im
    // Scroll-Verhalten und ist einer im Layout.
    assert.match(lies(ARTIKEL), /xl:grid-cols-\[minmax\(0,1fr\)_18rem\][^"]*xl:items-start/)
})

test('das Aside hat KEINE eigene Hoehe — eine definite Cross-Size schlaegt align-self:start', () => {
    const quelle = lies(ARTIKEL)
    const aside = /<aside([\s\S]*?)<\/aside>/.exec(quelle)
    if (!aside) {
        throw new Error('Kein <aside> in der Artikel-View gefunden — die Sonde misst nichts mehr.')
    }
    const oeffnung = /<aside[^>]*>/.exec(quelle)![0]
    assert.match(oeffnung, /xl:sticky/)
    assert.match(oeffnung, /xl:top-6/)
    assert.equal(/\bh-full\b/.test(oeffnung), false, 'Das Aside trägt `h-full` — damit fällt das Kleben aus.')
})

// ── Haus-Regeln, die diese Fläche einhalten muss ────────────────────────────────────

test('kein `font-mono` in der Artikel-View — `--font-mono` ist im Theme nicht definiert', () => {
    // Jedes `font-mono` zöge still eine zweite Schriftfamilie herein (Bestandsbefund,
    // eigener Auftrag). Neuer Code setzt stattdessen `tabular-nums`.
    assert.equal(/\bfont-mono\b/.test(lies(ARTIKEL)), false)
    assert.match(lies(ARTIKEL), /tabular-nums/)
})

test('die Insel bekommt die Basis-Route — ohne sie ist nichts teilbar', () => {
    // `artikelTeilZiel('' , …)` liefert `teilbar: false`. Fiele dieses zweite Argument
    // weg, wäre JEDER Artikel unteilbar — und zwar lautlos, mit einem Knopf, der den
    // inerten Grund nennt, obwohl der Artikel eine Adresse hat.
    assert.match(lies(ARTIKEL), /x-data="nostrArticle\(@js\(\$naddr\), @js\(route\('group\.articles'\)\)\)"/)
})

test('die Leseleiste beginnt, wo die BUEHNE beginnt — dieselbe Zahl wie die Rail-Spalte', () => {
    // Am laufenden Client gesehen: mit `inset-x-0` allein lief die Leiste über die ganze
    // Fensterbreite, also auch über die Desktop-Rail — und las sich dort, als lade die
    // Navigation. Der Versatz ist eine KOPIE der Rail-Breite aus `app-frame`, und
    // Kopien driften. Diese Zusage hält beide Zahlen zusammen.
    const rahmen = lies(join(VIEWS, 'components', 'app-frame.blade.php'))
    const spalte = /xl:grid-cols-\[([0-9.]+rem)_minmax\(0,1fr\)\]/.exec(rahmen)
    if (!spalte) {
        throw new Error('Keine xl:grid-cols-Definition in app-frame.blade.php — die Sonde misst nichts mehr.')
    }
    const artikel = lies(ARTIKEL)
    const versatz = /xl:left-\[([0-9.]+rem)\]/.exec(artikel)
    if (!versatz) {
        throw new Error('Kein xl:left-[…rem] an der Leseleiste — die Sonde misst nichts mehr.')
    }
    assert.equal(versatz[1], spalte[1], 'Der Versatz der Leseleiste und die Rail-Spalte sind auseinandergelaufen.')
})

test('der Lightning-Einstieg hat DREI Zustaende — und bei `unbekannt` steht gar keine Zeile', () => {
    const quelle = lies(ARTIKEL)
    // Das `x-if` ist die eigentliche Zusage: solange das kind 0 des Autors nicht da ist,
    // wird über seine Zahlungsadresse NICHTS behauptet. Am laufenden Client stand hier
    // vorher „Keine Lightning-Adresse" — auch unter Artikeln von Autoren, die eine haben.
    assert.match(quelle, /x-if="article\.author\.lightning !== 'unbekannt'"/)
    // Und der inerte Zustand bleibt sichtbar statt still grau: `aria-disabled` (nicht
    // `disabled` — das nähme dem Knopf den Fokus und damit den Weg zur Begründung).
    assert.match(quelle, /aria-disabled="article\.author\.lightning === 'ja' \? null : 'true'"/)
    assert.equal(/\sdisabled="/.test(quelle), false, 'Ein hartes `disabled` nimmt dem Knopf den Fokus.')
})
