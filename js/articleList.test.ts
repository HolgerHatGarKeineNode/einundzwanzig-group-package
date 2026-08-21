/**
 * Pure-Tests der Listen-Projektion (P2) — `js/articleList.ts`, welshman-frei:
 *   node --experimental-strip-types --test packages/einundzwanzig-group/js/articleList.test.ts
 *
 * Der Kernbeweis der Phase steht ganz unten und ist als solcher markiert.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createArticleList, sortArticles, type ArticleSort } from './articleList.ts'
import { articleSearchText, type ArticleRow } from './longform.ts'
import { KEINE_METRIKEN, type ArticleRowMitMetriken } from './articleMetrics.ts'
import { searchMessages } from './search.ts'

/** Feste Locale: `localeCompare` ohne Angabe hinge an der Umgebung des Testrechners. */
const DE = new Intl.Collator('de', { sensitivity: 'base', numeric: true })

let laufendeId = 0

/**
 * **`metriken` ist seit P6 Pflichtfeld der Zeile.** Der Default `KEINE_METRIKEN` steht
 * hier und nicht in der Projektion: `createArticleList` reicht die Zeile durch (`...row`)
 * und erfindet nichts. Ein Test, der Metriken prüfen will, setzt sie über `over`.
 */
const row = (over: Partial<ArticleRowMitMetriken> = {}): ArticleRowMitMetriken => {
    laufendeId += 1

    return {
        id: String(laufendeId).padStart(64, '0'),
        pubkey: 'a'.repeat(64),
        identifier: `kennung-${laufendeId}`,
        naddr: `naddr1test${laufendeId}`,
        title: 'Ein Titel',
        teaser: 'Ein Teaser',
        image: '',
        content: 'Ein Fliesstext.',
        authorName: 'Anna',
        authorPicture: '',
        publishedAt: 1_700_000_000,
        createdAt: 1_700_000_000,
        dateLabel: '1. Januar 2024',
        dateIso: '2023-11-14T22:13:20.000Z',
        topics: [],
        coverCss: 'linear-gradient(135deg, #7b3d10, #421d06)',
        readingMinutes: 3,
        podcast: null,
        metriken: KEINE_METRIKEN,
        ...over,
    }
}

const ids = (cards: { id: string }[]): string[] => cards.map((card) => card.id)

// Die Literal-Zusicherungen auf `ARTICLE_SORTS` und `DEFAULT_ARTICLE_SORT` stehen seit
// dem Umzug der Konstanten in `articleSorts.test.ts` — zusammen mit dem Riegel, der die
// Werte im Blade-View gegen sie hält. Hier wären sie eine zweite Kopie derselben Aussage.

// ── Sortierung ───────────────────────────────────────────────────────────────────────

test('sortArticles `newest`: absteigend nach publishedAt, NICHT nach createdAt', () => {
    // Der Fall, den der Plan unter „Verworfen" beschreibt: ein rueckdatierter
    // Archivimport hat das juengste `created_at` und muss trotzdem unten stehen.
    const archiv = row({ title: 'Archiv', publishedAt: 1_500_000_000, createdAt: 1_800_000_000 })
    const neu = row({ title: 'Neu', publishedAt: 1_790_000_000, createdAt: 1_790_000_000 })

    assert.deepEqual(
        sortArticles([archiv, neu], 'newest', DE).map((r) => r.title),
        ['Neu', 'Archiv'],
    )
})

test('sortArticles `newest`: bei gleichem Datum entscheidet die Event-Id — die Ordnung ist TOTAL', () => {
    const spaet = row({ id: 'f'.repeat(64), publishedAt: 1_700_000_000 })
    const frueh = row({ id: '0'.repeat(64), publishedAt: 1_700_000_000 })

    // Beide Eingangsreihenfolgen muessen dasselbe Ergebnis liefern. Ohne den
    // Id-Zweitschluessel haenge das an der Stabilitaet von Array.sort und damit an der
    // Reihenfolge, in der die Ableitung die Events ausgibt — die sich bei jedem
    // eintreffenden kind-0 aendern kann. Die Liste sprænge dann beim Laden der Profile um.
    assert.deepEqual(ids(sortArticles([spaet, frueh], 'newest', DE)), ids(sortArticles([frueh, spaet], 'newest', DE)))
    assert.equal(sortArticles([spaet, frueh], 'newest', DE)[0]!.id, '0'.repeat(64))
})

test('sortArticles `author`: alphabetisch nach Autorname, innerhalb eines Autors neueste zuerst', () => {
    const berta = row({ authorName: 'Berta', publishedAt: 1_700_000_000 })
    const annaAlt = row({ authorName: 'Anna', publishedAt: 1_600_000_000 })
    const annaNeu = row({ authorName: 'Anna', publishedAt: 1_700_000_000 })

    assert.deepEqual(
        sortArticles([berta, annaAlt, annaNeu], 'author', DE).map((r) => [r.authorName, r.publishedAt]),
        [
            ['Anna', 1_700_000_000],
            ['Anna', 1_600_000_000],
            ['Berta', 1_700_000_000],
        ],
    )
})

test('sortArticles `title`: A–Z, diakritika-blind — Ueber steht bei Uber, nicht am Ende', () => {
    const uber = row({ title: 'Über Bitcoin' })
    const zeta = row({ title: 'Zeta' })
    const alpha = row({ title: 'Alpha' })

    assert.deepEqual(
        sortArticles([zeta, uber, alpha], 'title', DE).map((r) => r.title),
        ['Alpha', 'Über Bitcoin', 'Zeta'],
    )
})

test('sortArticles `title`: titellose Artikel stehen HINTEN, nicht als Klumpen vorne', () => {
    const ohne = row({ title: '   ' })
    const beta = row({ title: 'Beta' })
    const alpha = row({ title: 'Alpha' })

    assert.deepEqual(
        sortArticles([ohne, beta, alpha], 'title', DE).map((r) => r.title.trim()),
        ['Alpha', 'Beta', ''],
    )
})

test('sortArticles gibt IMMER ein neues Array zurueck — die Eingabe gehoert dem Store', () => {
    const eingabe = [row({ publishedAt: 1 }), row({ publishedAt: 2 })]
    const kopie = [...eingabe]
    const ausgabe = sortArticles(eingabe, 'newest', DE)

    assert.notEqual(ausgabe, eingabe)
    assert.deepEqual(ids(eingabe), ids(kopie), 'die Eingabe wurde an Ort und Stelle sortiert')
})

// ── Filtern ──────────────────────────────────────────────────────────────────────────

test('cards ohne Suchtext: alle Zeilen, in der gewaehlten Ordnung', () => {
    const liste = createArticleList({ collator: DE })
    const alle = [row({ title: 'Zeta' }), row({ title: 'Alpha' })]

    assert.equal(liste.cards(alle, '', 'newest').length, 2)
    assert.deepEqual(
        liste.cards(alle, '   ', 'title').map((c) => c.title),
        ['Alpha', 'Zeta'],
    )
})

test('cards findet ueber den Teaser (das summary-Tag)', () => {
    const liste = createArticleList({ collator: DE })
    const treffer = row({ title: 'Egal', teaser: 'Warum Selbstverwahrung zaehlt', content: 'x' })
    const rest = row({ title: 'Egal', teaser: 'Etwas anderes', content: 'x' })

    assert.deepEqual(ids(liste.cards([treffer, rest], 'selbstverwahrung', 'newest')), [treffer.id])
})

test('cards findet ueber den Autornamen — und der zaehlt NICHT als Volltext', () => {
    const liste = createArticleList({ collator: DE })
    const treffer = row({ authorName: 'Gigi', title: 'Egal', teaser: 'Egal', content: 'Egal' })
    const rest = row({ authorName: 'Anna', title: 'Egal', teaser: 'Egal', content: 'Egal' })

    assert.deepEqual(ids(liste.cards([treffer, rest], 'gigi', 'newest')), [treffer.id])
})

test('cards findet ueber den Fliesstext, und Data-URIs erzeugen KEINE Falschtreffer', () => {
    const liste = createArticleList({ collator: DE })
    // `sad` steht in der base64-Nutzlast — genau der gemessene Falschtreffer aus P1.
    const rausch = row({ title: 'Bild', teaser: 'Bild', content: 'data:image/png;base64,iVBORsadgaaa' })
    const echt = row({ title: 'Egal', teaser: 'Egal', content: 'Ich war sad und dann nicht mehr.' })

    assert.deepEqual(ids(liste.cards([rausch, echt], 'sad', 'newest')), [echt.id])
})

test('cards: UND ueber die Begriffe, ODER ueber die Felder', () => {
    const liste = createArticleList({ collator: DE })
    // „gigi bitcoin": der Name steht im Autorfeld, das Wort im Titel — beides zaehlt.
    const treffer = row({ authorName: 'Gigi', title: 'Bitcoin heute', teaser: 'x', content: 'x' })
    const nurName = row({ authorName: 'Gigi', title: 'Etwas anderes', teaser: 'x', content: 'x' })

    assert.deepEqual(ids(liste.cards([treffer, nurName], 'gigi bitcoin', 'newest')), [treffer.id])
})

test('cards ist diakritika-blind und liest ss fuer ß — dieselbe Faltung wie der Chat', () => {
    const liste = createArticleList({ collator: DE })
    const muell = row({ title: 'Müller über Straße', teaser: 'x', content: 'x' })

    assert.equal(liste.cards([muell], 'muller', 'newest').length, 1)
    assert.equal(liste.cards([muell], 'strasse', 'newest').length, 1)
    assert.equal(liste.cards([muell], 'UBER', 'newest').length, 1)
})

test('cards: eine Suche ohne Treffer liefert eine LEERE Liste, nicht den Bestand', () => {
    const liste = createArticleList({ collator: DE })

    assert.deepEqual(liste.cards([row(), row()], 'zzzqqxyznotexist', 'newest'), [])
})

// ── Semantik-Gleichheit mit `searchMessages` ─────────────────────────────────────────
//
// Der eigene Suchpfad existiert aus Laufzeitgruenden (Begruendung im Modulkopf), nicht
// aus fachlichen. Diese Zusicherung ist der Riegel dagegen, dass „schneller" unbemerkt zu
// „anders" wird: dieselben Zeilen, dieselben Anfragen, dieselbe Treffermenge.

test('SEMANTIK: der eigene Suchpfad findet exakt dasselbe wie `searchMessages`', () => {
    const liste = createArticleList({ collator: DE })
    const bestand = [
        row({ title: 'Bitcoin und Freiheit', teaser: 'Ein Essay', content: 'Ueber Geld.', authorName: 'Anna' }),
        row({ title: 'Müller schreibt', teaser: 'Über die Straße', content: 'Grüße.', authorName: 'Peter Müller' }),
        row({ title: 'Kalte Lagerung', teaser: 'Hardware', content: 'bitcoin im Tresor.', authorName: 'Gigi' }),
        row({ title: 'Ohne alles', teaser: '', content: '', authorName: 'Zora' }),
        row({ title: 'Bild', teaser: 'x', content: 'data:image/png;base64,iVBORsadgaaa', authorName: 'Anna' }),
    ]
    const projiziert = bestand.map(articleSearchText)

    for (const anfrage of [
        'bitcoin',
        'BITCOIN',
        'bitcoin freiheit',
        'muller',
        'strasse',
        'grusse',
        'peter',
        'gigi bitcoin',
        'sad',
        'zzzqqxyznotexist',
        '',
        '   ',
        'b',
    ]) {
        const meine = new Set(ids(liste.cards(bestand, anfrage, 'newest')))
        const ihre = new Set(searchMessages(projiziert, anfrage, projiziert.length).hits.map((h) => h.id))

        // `searchMessages` liefert bei leerer Anfrage NULL Treffer, diese Fläche zeigt
        // dann den Bestand — das ist der eine bewusste Unterschied und er steht hier
        // ausdrücklich, statt die Anfragen wegzulassen, bei denen es nicht passt.
        if (anfrage.trim() === '') {
            assert.equal(ihre.size, 0)
            assert.equal(meine.size, bestand.length)
            continue
        }

        assert.deepEqual([...meine].sort(), [...ihre].sort(), `Treffer weichen ab bei „${anfrage}"`)
    }
})

// ── Die Faltung: einmal je Artikel, nicht je Tastendruck ─────────────────────────────

test('LAUFZEIT: der Volltext wird EINMAL je Artikel gefaltet, nicht je Tastendruck', () => {
    const gefaltet: string[] = []
    const liste = createArticleList({
        collator: DE,
        fold: (text) => {
            gefaltet.push(text)

            return text.toLowerCase()
        },
    })
    const bestand = [row({ title: 'Bitcoin', content: 'Text A' }), row({ title: 'Freiheit', content: 'Text B' })]

    // Ein Nutzer tippt „bit" — drei Aufrufe ueber denselben Bestand.
    liste.cards(bestand, 'b', 'newest')
    liste.cards(bestand, 'bi', 'newest')
    liste.cards(bestand, 'bit', 'newest')

    // Zwei Artikel-Volltexte, dazu je Aufruf die (nicht gemerkten) Autornamen.
    const volltexte = gefaltet.filter((text) => /text [ab]/i.test(text))
    assert.equal(volltexte.length, 2, `Volltext wurde ${volltexte.length}-mal gefaltet statt 2-mal`)
})

test('LAUFZEIT: ein NEUER Artikel wird gefaltet, die bekannten nicht noch einmal', () => {
    let faltungen = 0
    const liste = createArticleList({ collator: DE, fold: (text) => ((faltungen += 1), text.toLowerCase()) })
    const alt = row({ content: 'alt' })

    liste.cards([alt], 'x', 'newest')
    const nachErstem = faltungen
    const neu = row({ content: 'neu' })
    liste.cards([alt, neu], 'x', 'newest')

    // Genau EINE zusätzliche Volltext-Faltung (plus die Namen, die nie gemerkt werden).
    assert.equal(faltungen - nachErstem <= 3, true, `${faltungen - nachErstem} Faltungen fuer einen neuen Artikel`)
    assert.equal(faltungen > nachErstem, true, 'der neue Artikel wurde gar nicht gefaltet')
})

test('LAUFZEIT: der Autorname wird NICHT gemerkt — ein spaeter eintreffendes kind 0 wirkt sofort', () => {
    const liste = createArticleList({ collator: DE })
    const npubKurz = row({ authorName: 'npub1abcd…', title: 'Egal', teaser: 'Egal', content: 'Egal' })

    assert.equal(liste.cards([npubKurz], 'gigi', 'newest').length, 0)

    // Dasselbe Ereignis (gleiche Id), aber der Anzeigename ist inzwischen da. Genau die
    // Mechanik, die im Haus schon einmal eine Phase gekostet hat.
    const mitName = { ...npubKurz, authorName: 'Gigi' }
    assert.equal(liste.cards([mitName], 'gigi', 'newest').length, 1)
})

// ── Hervorhebung ─────────────────────────────────────────────────────────────────────

test('cards ohne Suche: jedes Feld ist GENAU EIN Stueck, keins hervorgehoben', () => {
    const liste = createArticleList({ collator: DE })
    const [karte] = liste.cards([row({ title: 'Ein Titel', teaser: 'Ein Teaser', authorName: 'Anna' })], '', 'newest')

    assert.deepEqual(karte!.titleParts, [{ text: 'Ein Titel', hit: false }])
    assert.deepEqual(karte!.teaserParts, [{ text: 'Ein Teaser', hit: false }])
    assert.deepEqual(karte!.authorParts, [{ text: 'Anna', hit: false }])
})

test('cards mit Suche: der Treffer im Titel ist als eigenes Stueck markiert', () => {
    const liste = createArticleList({ collator: DE })
    const [karte] = liste.cards([row({ title: 'Bitcoin und Freiheit' })], 'bitcoin', 'newest')

    assert.deepEqual(karte!.titleParts, [
        { text: 'Bitcoin', hit: true },
        { text: ' und Freiheit', hit: false },
    ])
})

test('cards mit Suche: auch der Autorname wird hervorgehoben', () => {
    const liste = createArticleList({ collator: DE })
    const [karte] = liste.cards([row({ authorName: 'Peter Müller', title: 'x', teaser: 'x' })], 'muller', 'newest')

    assert.deepEqual(karte!.authorParts, [
        { text: 'Peter ', hit: false },
        { text: 'Müller', hit: true },
    ])
})

// ── Die hervorgehobene erste Karte ───────────────────────────────────────────────────

test('featured: genau die erste Karte der unveraenderten Ansicht, sonst keine', () => {
    const liste = createArticleList({ collator: DE })
    const bestand = [row({ title: 'Alpha', publishedAt: 2 }), row({ title: 'Beta', publishedAt: 1 })]

    assert.deepEqual(
        liste.cards(bestand, '', 'newest').map((c) => c.featured),
        [true, false],
    )
})

test('featured: unter einer Suche gibt es KEINE — „der neueste Artikel" waere dann gelogen', () => {
    const liste = createArticleList({ collator: DE })
    const bestand = [row({ title: 'Alpha', publishedAt: 2 }), row({ title: 'Alpha zwei', publishedAt: 1 })]

    assert.deepEqual(
        liste.cards(bestand, 'alpha', 'newest').map((c) => c.featured),
        [false, false],
    )
})

test('featured: in einer anderen Ordnung gibt es ebenfalls KEINE', () => {
    const liste = createArticleList({ collator: DE })
    const bestand = [row({ title: 'Alpha', publishedAt: 2 }), row({ title: 'Beta', publishedAt: 1 })]

    for (const sort of ['author', 'title'] satisfies ArticleSort[]) {
        assert.deepEqual(
            liste.cards(bestand, '', sort).map((c) => c.featured),
            [false, false],
            `Ordnung ${sort} zeigt eine hervorgehobene Karte`,
        )
    }
})

test('featured: eine leere Liste erzeugt keine hervorgehobene Karte (und keinen Fehler)', () => {
    assert.deepEqual(createArticleList({ collator: DE }).cards([], '', 'newest'), [])
})

// ── DER KERNBEWEIS (erste Haelfte) ───────────────────────────────────────────────────
//
// Die zweite Haelfte — „und der Bestand wird dabei NICHT neu geladen" — ist eine Aussage
// ueber das Netz und kann hier per Konstruktion nicht fallen: dieses Modul kennt weder
// `load` noch einen Relay noch `fetch`. Sie wird in
// `tests/e2e/longform-reader.spec.ts` am REQ-Zaehler des Relays belegt.

test('KERNBEWEIS: ein Wort, das NUR im Titel steht, findet den Artikel', () => {
    const liste = createArticleList({ collator: DE })
    const gesucht = row({
        title: 'Zwiebelfisch',
        // Weder Teaser noch Fliesstext noch Autorname enthalten das Wort — der Treffer
        // kann ausschliesslich aus dem Titel kommen.
        teaser: 'Eine Betrachtung ueber Satzfehler im Druck.',
        content: 'Der Text handelt von Bleisatz und von gar nichts sonst.',
        authorName: 'Anna',
    })
    const rest = [
        row({ title: 'Etwas ganz anderes', teaser: 'x', content: 'x', authorName: 'Berta' }),
        row({ title: 'Noch etwas', teaser: 'y', content: 'y', authorName: 'Cara' }),
    ]

    const treffer = liste.cards([...rest, gesucht], 'zwiebelfisch', 'newest')

    assert.deepEqual(ids(treffer), [gesucht.id])
    // Und die Vorbedingung ausdruecklich: stuende das Wort noch woanders, saegte der Fall
    // nichts ueber den Titel aus.
    const anderswo = `${gesucht.teaser}\n${gesucht.content}\n${gesucht.authorName}`.toLowerCase()
    assert.equal(anderswo.includes('zwiebelfisch'), false)
})
