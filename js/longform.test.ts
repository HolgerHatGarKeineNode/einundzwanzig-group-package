/**
 * Pure-Tests für den Longform-Reader (P7) — `js/longform.ts`, welshman-frei.
 * Läuft ohne neue Dependency über Nodes eingebauten Test-Runner + TS-Type-Stripping:
 *   node --experimental-strip-types --test packages/einundzwanzig-group/js/longform.test.ts
 *
 * Bewusst NICHT aus `./core.ts` importiert: `proxifyImage` dort zieht `@welshman/app`,
 * `@welshman/net`, `@welshman/router` mit — Module, die unter `node --test` nicht sicher
 * laden (siehe `longformFeed.ts`-Kopfkommentar: „die welshman-Seite"). Der Bild-Test unten
 * spiegelt stattdessen `proxifyImage`s dokumentierten Vertrag (`js/core.ts:47-54`, gelesen,
 * nicht geraten: „Nur http(s) wird proxifiziert — data:/blob: bleiben unangetastet") über
 * eine lokale Fake-Funktion. Was hier geprüft wird, ist der VERTRAG zwischen `longform.ts`
 * und seinem `proxify`-Parameter (jede Bild-URL geht unverändert durch die übergebene
 * Funktion, keine Sonderbehandlung nach Schema INNERHALB von `longform.ts`) — nicht
 * `proxifyImage` selbst.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as nip19 from 'nostr-tools/nip19'
import {
    BR_SENTINEL,
    LONGFORM,
    LONGFORM_DRAFT,
    articleSnippet,
    decodeArticleNaddr,
    naddrForArticle,
    readArticleTags,
    renderArticleHtml,
    stripFrontmatter,
} from './longform.ts'

// ── Tag-Extraktion ───────────────────────────────────────────────────────────────────

test('readArticleTags: liest title/image/published_at aus vollständigen Tags', () => {
    const tags = readArticleTags(
        [
            ['d', 'mein-artikel'],
            ['title', 'Mein Artikel'],
            ['image', 'https://example.com/bild.png'],
            ['published_at', '1700000000'],
            ['summary', 'Kurzfassung'],
        ],
        1750000000,
    )
    assert.deepEqual(tags, {
        identifier: 'mein-artikel',
        title: 'Mein Artikel',
        summary: 'Kurzfassung',
        image: 'https://example.com/bild.png',
        publishedAt: 1700000000,
        topics: [],
    })
})

test('readArticleTags: fehlende Tags liefern leere Strings, published_at fällt auf created_at zurück', () => {
    const tags = readArticleTags([['d', 'x']], 1750000000)
    assert.equal(tags.title, '')
    assert.equal(tags.image, '')
    assert.equal(tags.summary, '')
    assert.equal(tags.publishedAt, 1750000000)
    assert.deepEqual(tags.topics, [])
})

test('readArticleTags: komplett leere Tag-Liste (kein einziges Tag) bricht nicht', () => {
    const tags = readArticleTags([], 42)
    assert.deepEqual(tags, { identifier: '', title: '', summary: '', image: '', publishedAt: 42, topics: [] })
})

test('readArticleTags: nicht-numerisches/negatives published_at fällt auf created_at zurück', () => {
    assert.equal(readArticleTags([['published_at', 'bald']], 999).publishedAt, 999)
    assert.equal(readArticleTags([['published_at', '-5']], 999).publishedAt, 999)
    assert.equal(readArticleTags([['published_at', '0']], 999).publishedAt, 999)
})

test('readArticleTags: doppeltes Tag — der ERSTE Wert gewinnt (Zusage von firstTag)', () => {
    const tags = readArticleTags([
        ['title', 'Erste Fassung'],
        ['title', 'Zweite Fassung'],
    ])
    assert.equal(tags.title, 'Erste Fassung')
})

test('readArticleTags: t-Tags in Reihenfolge, doppelte bleiben (keine Dedupe-Zusage), leere t-Werte fallen raus', () => {
    const tags = readArticleTags([
        ['t', 'bitcoin'],
        ['t', ''],
        ['t', 'freiheit'],
        ['t', 'bitcoin'],
    ])
    assert.deepEqual(tags.topics, ['bitcoin', 'freiheit', 'bitcoin'])
})

// ── `d`-Tag `draft-*` wird NICHT gefiltert ───────────────────────────────────────────
//
// Der teuerste stille Fehler dieser Phase (siehe LONGFORM_DRAFT-Doku in longform.ts):
// 67 von 99 echten Artikeln tragen `d = draft-<ts>` und sind trotzdem publizierte 30023.
// `readArticleTags` darf den Identifier NIEMALS auswerten oder verwerfen — die Prüfung
// auf „ist das ein echter Entwurf" ist die KIND-Nummer (30023 vs. 30024), nie ein
// String-Muster auf `d`. Zweite Mutation (E2E-Ebene) in `tests/e2e/longform-reader.spec.ts`.

test('readArticleTags: ein `d`-Wert der Form draft-<ts> ist ein ganz normaler Identifier, kein Sonderfall', () => {
    const tags = readArticleTags([
        ['d', 'draft-1723400000'],
        ['title', 'Publizierter Artikel mit draft-Kennung'],
    ])
    assert.equal(tags.identifier, 'draft-1723400000')
    assert.equal(tags.title, 'Publizierter Artikel mit draft-Kennung')
})

test('LONGFORM_DRAFT (30024) ist NICHT gleich LONGFORM (30023) — die Kind-Zahl ist die einzig gültige Unterscheidung', () => {
    assert.equal(LONGFORM, 30023)
    assert.equal(LONGFORM_DRAFT, 30024)
    assert.notEqual(LONGFORM, LONGFORM_DRAFT)
})

// ── Sanitizer-Nachweis: eingebettetes HTML/Script wird nicht ausgeführt ─────────────
//
// Reale Vektoren, keine Spielzeug-Payload. Jeder Eintrag prüft eine ANDERE Umgehung:
// rohes HTML, on…=-Attribute, javascript:/vbscript:-Schemata (als Link UND als Bild),
// srcdoc, data:text/html. `renderArticleHtml` ohne zweiten Parameter — der Bild-Proxy
// ist für diesen Nachweis irrelevant.
//
// **Wichtig, was hier NICHT geprüft wird:** eine naive Prüfung „enthält die Ausgabe
// irgendwo die Zeichenkette `onerror=`?" ist FALSCH — markdown-it escaped die
// spitzen Klammern (`<`/`>`) des rohen HTML zu Entities, der Rest des Tags (inkl.
// `onerror="…"`, `srcdoc="…"`) bleibt als SICHTBARER, INERTER Text stehen (z. B.
// `&lt;img src=x onerror=&quot;alert(1)&quot;&gt;`) — das ist sicher, weil kein
// echtes `<img>`-Element entsteht. Geprüft wird deshalb STRUKTURELL: entsteht der
// gefährliche Tag/das gefährliche Attribut ALS ECHTES HTML-KONSTRUKT (ein
// unescapter `<tag`, bzw. ein `attr="scheme:`-Attributwert in echtem Markup)?
// Genau das hätte ein `html: true` bzw. ein deaktiviertes `validateLink` erzeugt —
// beide Mutationen unten belegen es.

/** Rohes HTML im Artikeltext — der Tag darf NICHT unescaped (als echtes Element) auftauchen. */
const RAW_HTML_VECTORS: Array<{ name: string; content: string; tag: string }> = [
    { name: '<script>', content: '<script>alert(1)</script>', tag: 'script' },
    { name: 'onerror= via <img>', content: '<img src=x onerror="alert(1)">', tag: 'img' },
    { name: '<iframe src="javascript:…">', content: '<iframe src="javascript:alert(1)"></iframe>', tag: 'iframe' },
    { name: '<svg onload=…>', content: '<svg onload=alert(1)>', tag: 'svg' },
    { name: '<object data="javascript:…">', content: '<object data="javascript:alert(1)"></object>', tag: 'object' },
    { name: '<embed src="javascript:…">', content: '<embed src="javascript:alert(1)">', tag: 'embed' },
    { name: '<form action="javascript:…">', content: '<form action="javascript:alert(1)"><input></form>', tag: 'form' },
    { name: 'srcdoc via <iframe>', content: '<iframe srcdoc="<script>alert(1)</script>"></iframe>', tag: 'iframe' },
]

for (const vector of RAW_HTML_VECTORS) {
    test(`Sanitizer-Nachweis: ${vector.name} entsteht nicht als echtes HTML-Element`, () => {
        const html = renderArticleHtml(vector.content)
        const liveTag = new RegExp(`<${vector.tag}[\\s>/]`, 'i')
        assert.equal(liveTag.test(html), false, `Ausgabe enthält ein LEBENDES <${vector.tag}>: ${html}`)
    })
}

/** Markdown-Link/-Bild auf ein gefährliches URL-Schema — darf nie zum echten href/src-Attribut werden. */
const SCHEME_VECTORS: Array<{ name: string; content: string; deadlyAttr: RegExp }> = [
    { name: 'javascript: Link', content: '[klick](javascript:alert(1))', deadlyAttr: /href\s*=\s*"javascript:/i },
    { name: 'vbscript: Link', content: '[klick](vbscript:alert(1))', deadlyAttr: /href\s*=\s*"vbscript:/i },
    { name: 'javascript: Bild', content: '![b](javascript:alert(1))', deadlyAttr: /src\s*=\s*"javascript:/i },
    {
        name: 'data:text/html Bild',
        content: '![b](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)',
        deadlyAttr: /src\s*=\s*"data:text\/html/i,
    },
]

for (const vector of SCHEME_VECTORS) {
    test(`Sanitizer-Nachweis: ${vector.name} wird nie zum lebenden href/src-Attribut`, () => {
        const html = renderArticleHtml(vector.content)
        assert.equal(vector.deadlyAttr.test(html), false, `Ausgabe trägt ein gefährliches Attribut: ${html}`)
    })
}

test('Sanitizer-Nachweis: <script> wird nicht stillschweigend entfernt, sondern sichtbar als Entity escaped', () => {
    // Unterscheidet "escaped" von "verschluckt" — beides erfüllt die Vektor-Prüfung oben,
    // aber nur "escaped" belegt, dass hier markdown-its HTML-Escaping greift und nicht
    // zufällig ein anderer Mechanismus den Tag-Namen wegfiltert.
    const html = renderArticleHtml('<script>alert(1)</script>')
    assert.match(html, /&lt;script&gt;/)
})

test('Sanitizer-Nachweis: ein normaler Artikel (Überschrift, Fett, Link, Bild, Liste) rendert unauffällig', () => {
    const html = renderArticleHtml(
        '# Titel\n\n**Fett** und [ein Link](https://example.com).\n\n- Punkt eins\n- Punkt zwei\n\n![Alt-Text](https://example.com/bild.png)',
    )
    assert.match(html, /<h1>Titel<\/h1>/)
    assert.match(html, /<strong>Fett<\/strong>/)
    assert.match(html, /<a href="https:\/\/example\.com"/)
    assert.match(html, /<img src="https:\/\/example\.com\/bild\.png" alt="Alt-Text">/)
    assert.match(html, /<li>Punkt eins<\/li>/)
})

// ── naddr: erzeugen und wieder dekodieren ────────────────────────────────────────────

test('naddrForArticle/decodeArticleNaddr: Rundlauf liefert Pubkey und Identifier unverändert zurück', () => {
    const pubkey = 'a'.repeat(64)
    const naddr = naddrForArticle(pubkey, 'mein-artikel', ['wss://relay.example/'])
    const decoded = decodeArticleNaddr(naddr)
    assert.deepEqual(decoded, { pubkey, identifier: 'mein-artikel' })
})

test('naddrForArticle: Relay-Hint ist optional (Default leer) — der Rundlauf funktioniert trotzdem', () => {
    const pubkey = 'b'.repeat(64)
    const naddr = naddrForArticle(pubkey, 'ohne-relay')
    assert.deepEqual(decodeArticleNaddr(naddr), { pubkey, identifier: 'ohne-relay' })
})

test('decodeArticleNaddr: naddr auf ein ANDERES Kind liefert null (kein Longform-Artikel)', () => {
    const naddr = nip19.naddrEncode({ kind: 30017, pubkey: 'c'.repeat(64), identifier: 'x', relays: [] })
    assert.equal(decodeArticleNaddr(naddr), null)
})

test('decodeArticleNaddr: eine andere Kennungsart (npub) liefert null, wirft nicht', () => {
    const npub = nip19.npubEncode('d'.repeat(64))
    assert.equal(decodeArticleNaddr(npub), null)
})

test('decodeArticleNaddr: syntaktischer Müll liefert null, wirft nicht', () => {
    assert.equal(decodeArticleNaddr('naddr1garbage'), null)
    assert.equal(decodeArticleNaddr(''), null)
    assert.equal(decodeArticleNaddr('nicht-mal-bech32'), null)
})

// ── Frontmatter-Erkennung: eng gebaut, beide Richtungen geprüft ─────────────────────

test('stripFrontmatter: der gemessene Bestandsfall (--- / key: wert / ---) wird geschnitten', () => {
    const content = '---\ntype: gallery\nlayout: grid\n---\nDer eigentliche Artikeltext.'
    assert.equal(stripFrontmatter(content), 'Der eigentliche Artikeltext.')
})

test('stripFrontmatter: führende Leerzeilen nach dem schließenden --- werden mitentfernt', () => {
    const content = '---\ntitle: X\n---\n\n\nText nach zwei Leerzeilen.'
    assert.equal(stripFrontmatter(content), 'Text nach zwei Leerzeilen.')
})

test('stripFrontmatter: leere Zeilen ZWISCHEN den Feldern sind erlaubt (Bedingung c prüft nur nicht-leere Zeilen)', () => {
    const content = '---\ntitle: X\n\nauthor: Y\n---\nText.'
    assert.equal(stripFrontmatter(content), 'Text.')
})

test('stripFrontmatter: schließendes --- GENAU an der Fenstergrenze (30 Zeilen) wird noch gefunden', () => {
    const keyLines = Array.from({ length: 29 }, (_, i) => `key${i}: wert${i}`)
    const content = ['---', ...keyLines, '---', 'Text am Ende.'].join('\n')
    assert.equal(stripFrontmatter(content), 'Text am Ende.')
})

test('stripFrontmatter: schließendes --- EINE Zeile hinter der Fenstergrenze wird NICHT mehr gefunden — Text bleibt unverändert', () => {
    const keyLines = Array.from({ length: 30 }, (_, i) => `key${i}: wert${i}`)
    const content = ['---', ...keyLines, '---', 'Text am Ende.'].join('\n')
    // Innerhalb der geprüften 30 Zeilen ist JEDE Zeile `key: wert` (Bedingung c erfüllt),
    // aber das schließende `---` selbst liegt außerhalb — die Schleife endet, ohne es zu
    // finden, und fällt auf „unverändert" zurück.
    assert.equal(stripFrontmatter(content), content)
})

test('stripFrontmatter: erste Zeile ist --- (Trennlinie), aber die zweite ist Fließtext — bleibt unverändert', () => {
    // Genau der Fall, den die enge Erkennung schützen soll: eine legitime horizontale
    // Linie am Artikelanfang, gefolgt von normalem Text mit einem Bindestrich.
    const content = '---\nDies ist ein ganz normaler Absatz mit einem Gedankenstrich - wirklich.\n---\nMehr Text.'
    assert.equal(stripFrontmatter(content), content)
})

test('stripFrontmatter: --- am Anfang OHNE ein zweites --- irgendwo im Dokument bleibt unverändert (reine hr)', () => {
    const content = '---\nEin Absatz.\n\nNoch ein Absatz.\n\nUnd noch einer, ohne dass je ein zweites --- folgt.'
    assert.equal(stripFrontmatter(content), content)
})

test('stripFrontmatter: Text ohne führendes --- bleibt komplett unangetastet', () => {
    const content = '# Titel\n\nGanz normaler Artikel ohne jede Frontmatter.'
    assert.equal(stripFrontmatter(content), content)
})

test('stripFrontmatter: eine einzelne Zeile, die exakt --- ist (kein weiterer Inhalt), bleibt unverändert', () => {
    assert.equal(stripFrontmatter('---'), '---')
})

// ── `<br />`-Behandlung inkl. Missbrauchsfall ────────────────────────────────────────

test('renderArticleHtml: <br />, <br/>, <br> — alle drei Schreibweisen werden zu echten Zeilenumbrüchen', () => {
    const html = renderArticleHtml('Zeile eins<br />Zeile zwei<br/>Zeile drei<br>Zeile vier')
    assert.equal((html.match(/<br>/g) ?? []).length, 3)
    assert.equal(html.includes('&lt;br'), false)
})

test('renderArticleHtml: Missbrauchsfall — schreibt der Autor das Sentinel-Zeichen selbst, entsteht HÖCHSTENS ein zusätzlicher Zeilenumbruch, keine Injektion', () => {
    // BR_SENTINEL ist U+E000 (Private Use Area) — kein Autor tippt es normalerweise,
    // aber die Zusage im Modulkopf ("es gibt nichts, was sich darüber einschleusen
    // ließe") wird hier verifiziert statt geglaubt.
    const withSentinel = `Text mit einem seltenen Zeichen: ${BR_SENTINEL} und weiter.`
    const html = renderArticleHtml(withSentinel)

    // Das Sentinel-Zeichen selbst taucht nirgends mehr in der Ausgabe auf.
    assert.equal(html.includes(BR_SENTINEL), false)
    // Es wurde zu GENAU einem <br> — nicht mehr, nicht weniger, keine kaputte Struktur.
    assert.equal((html.match(/<br>/g) ?? []).length, 1)
    // Und der Rest des Textes ist unverändert vorhanden (keine abgeschnittene/verschobene
    // Ausgabe).
    assert.match(html, /Text mit einem seltenen Zeichen:/)
    assert.match(html, /und weiter\./)
})

test('renderArticleHtml: Sentinel-Zeichen UND ein echtes <br /> im selben Artikel ergeben zwei <br>, keine Vermischung', () => {
    const html = renderArticleHtml(`Erste Zeile<br />Zweite Zeile mit Zeichen ${BR_SENTINEL} am Ende.`)
    assert.equal((html.match(/<br>/g) ?? []).length, 2)
})

// ── Bilder über `proxifyImage`-Vertrag (data:/blob: bleiben unangetastet) ──────────

/** Spiegelt `proxifyImage`s dokumentierten Vertrag (`core.ts:47-54`) — siehe Modulkopf. */
const fakeProxify = (url: string): string => (/^https?:\/\//i.test(url) ? `PROXIED(${url})` : url)

test('renderArticleHtml: eine https-Bild-URL läuft durch die übergebene proxify-Funktion', () => {
    const html = renderArticleHtml('![Alt](https://example.com/bild.png)', fakeProxify)
    assert.match(html, /<img src="PROXIED\(https:\/\/example\.com\/bild\.png\)" alt="Alt">/)
})

test('renderArticleHtml: data:image/png bleibt UNANGETASTET, obwohl proxify für jedes Bild aufgerufen wird', () => {
    const dataUrl = 'data:image/png;base64,iVBORw0KGgo='
    const html = renderArticleHtml(`![Alt](${dataUrl})`, fakeProxify)
    assert.match(html, new RegExp(`<img src="${dataUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}" alt="Alt">`))
})

test('renderArticleHtml: ohne proxify-Parameter bleibt die Bild-URL unverändert (Pure-Test-Normalfall)', () => {
    const html = renderArticleHtml('![Alt](https://example.com/bild.png)')
    assert.match(html, /<img src="https:\/\/example\.com\/bild\.png" alt="Alt">/)
})

test('renderArticleHtml: das alt-Attribut kommt aus dem Bild-Text, nicht leer (Regression: renderToken statt der Werksregel)', () => {
    const html = renderArticleHtml('![Ein Alternativtext](https://example.com/bild.png)', fakeProxify)
    assert.match(html, /alt="Ein Alternativtext"/)
})

// ── articleSnippet — bewusst mitgetestet: sie teilt sich stripFrontmatter mit dem Renderer ──

test('articleSnippet: Markdown-Auszeichnung fällt weg, reiner Text bleibt', () => {
    const snippet = articleSnippet('# Titel\n\n**Fett** und [ein Link](https://example.com) und mehr Text.')
    assert.equal(snippet.includes('#'), false)
    assert.equal(snippet.includes('**'), false)
    assert.equal(snippet.includes('https://example.com'), false)
    assert.match(snippet, /Fett und ein Link und mehr Text\./)
})

test('articleSnippet: bricht bei der max-Grenze ab und hängt eine Ellipse an', () => {
    const long = Array.from({ length: 40 }, (_, i) => `Wort${i}`).join(' ')
    const snippet = articleSnippet(long, 40)
    assert.ok(snippet.endsWith('…'))
    assert.ok(snippet.length <= 41)
})

test('articleSnippet: Codefence-Inhalt wird übersprungen, nicht angezeigt', () => {
    const content = 'Vor dem Code.\n```js\nconst geheim = 1\n```\nNach dem Code.'
    const snippet = articleSnippet(content)
    assert.equal(snippet.includes('geheim'), false)
    assert.match(snippet, /Vor dem Code\. Nach dem Code\./)
})
