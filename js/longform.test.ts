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
    COVER_GRADIENT_ANGLE,
    COVER_PALETTE,
    LONGFORM,
    LONGFORM_DRAFT,
    PUBLISHED_AT_MAX,
    RELATIVE_DATE_MAX_DAYS,
    WORDS_PER_MINUTE,
    articleSearchText,
    articleSnippet,
    coverGradient,
    decodeArticleNaddr,
    isPodcastEpisode,
    naddrForArticle,
    readArticleTags,
    readingTime,
    relativeDateParts,
    renderArticleHtml,
    stripDataUris,
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

// ── Auth-pflichtige Artikelbilder: Marker statt src ────────────────────────────────

/**
 * Spiegelt die Wache (`mediaGuard.ts` via `proxifyImage`): für ein Medium des
 * Workspace-Relays gibt sie `''` zurück — weder Proxy noch rohe URL sind erlaubt.
 * Dass `''` das Signal IST, steht in `blossomMarkup.ts`; hier wird geprüft, was das
 * Markup daraus macht.
 */
const fakeProxifyMitWache = (url: string): string => (url.startsWith('https://buzz.test/') ? '' : fakeProxify(url))

test('renderArticleHtml: ein Bild des Workspace-Relays bekommt KEIN src, sondern den Blossom-Marker', () => {
    const html = renderArticleHtml('![Alt](https://buzz.test/media/a.jpg)', fakeProxifyMitWache)

    // Der Kern: kein `src`-Attribut → der Browser stellt keine Anfrage. Ein `src=""`
    // wäre hier NICHT gleichwertig (siehe Begründung in longform.ts).
    assert.equal(/\ssrc=/.test(html), false)
    assert.match(html, /data-blossom-src="https:\/\/buzz\.test\/media\/a\.jpg"/)
    // Der Alternativtext des Autors überlebt das Entfernen des src-Attributs.
    assert.match(html, /alt="Alt"/)
})

test('renderArticleHtml: ein fremdes Bild bleibt unmarkiert am Proxy (Gegenprobe)', () => {
    const html = renderArticleHtml('![Alt](https://example.com/bild.png)', fakeProxifyMitWache)

    assert.match(html, /<img src="PROXIED\(https:\/\/example\.com\/bild\.png\)" alt="Alt">/)
    assert.equal(html.includes('data-blossom-src'), false)
})

test('renderArticleHtml: ein Anführungszeichen in der Bild-URL bricht das Marker-Attribut nicht auf', () => {
    // Der Marker entsteht über `attrSet` auf dem Token, nicht per String-Ersetzung im
    // fertigen HTML — deshalb greift markdown-its eigene Behandlung. Gemessen wird die
    // URL dabei bereits beim Parsen normalisiert (`"` → `%22`), das Attribut kann also
    // gar nicht erst enden; die Zusage hängt nicht an unserem Code.
    const html = renderArticleHtml('![Alt](<https://buzz.test/media/a".jpg>)', fakeProxifyMitWache)

    assert.match(html, /data-blossom-src="https:\/\/buzz\.test\/media\/a%22\.jpg"/)
    assert.equal(html.includes('a".jpg'), false)
})

// ── PUBLISHED_AT_MAX — die obere Hälfte der Grenze ───────────────────────────────────
//
// Die untere Hälfte (`'bald'`, `'-5'`, `'0'`) war seit P7 gedeckt, die obere nicht: der
// Teilausdruck `&& published <= PUBLISHED_AT_MAX` liess sich am 2026-08-20 ersatzlos
// streichen, und die gesamte JS-Suite blieb gruen (1078 Tests). Genau der Angriff, den
// der Kommentar bei `readArticleTags` beschreibt, war also unbewacht.

test('readArticleTags: `published_at` = 9e15 faellt auf created_at zurueck (der Platz-1-Angriff)', () => {
    // `Number('9e15')` ist endlich und positiv — die untere Haelfte der Grenze laesst es
    // durch. Ohne die obere stuende hier 9e15, `new Date(9e15 * 1000)` waere „Invalid
    // Date", und die absteigend sortierte Liste haette den Artikel dauerhaft oben.
    assert.equal(readArticleTags([['published_at', '9e15']], 1_700_000_000).publishedAt, 1_700_000_000)
})

test('readArticleTags: die Grenze ist WOERTLICH 4e9 — und sie ist inklusiv', () => {
    // Gegen ein Literal, nicht gegen die Konstante: sonst blieben die Faelle unten gruen,
    // auch wenn jemand PUBLISHED_AT_MAX auf 9e15 hochsetzt und den Riegel damit oeffnet.
    assert.equal(PUBLISHED_AT_MAX, 4_000_000_000)

    // Genau auf der Grenze gilt der Wert noch, eine Sekunde darueber nicht mehr.
    assert.equal(readArticleTags([['published_at', '4000000000']], 42).publishedAt, 4_000_000_000)
    assert.equal(readArticleTags([['published_at', '4000000001']], 42).publishedAt, 42)
})

test('readArticleTags: Millisekunden-Zeitstempel gelten als unplausibel, nicht als umzurechnen', () => {
    // 1.7e12 waere „2023 in Millisekunden". Umgerechnet ergaebe es 2023, ungeprueft das
    // Jahr 55 837. Die Entscheidung des Hauses ist: nicht raten, sondern verwerfen.
    assert.equal(readArticleTags([['published_at', '1700000000000']], 1_700_000_000).publishedAt, 1_700_000_000)
})

test('readArticleTags: `Infinity` und `NaN` kommen nicht durch', () => {
    assert.equal(readArticleTags([['published_at', 'Infinity']], 7).publishedAt, 7)
    assert.equal(readArticleTags([['published_at', '1e999']], 7).publishedAt, 7)
})

// ── Lesezeit ─────────────────────────────────────────────────────────────────────────

test('readingTime: die Lesegeschwindigkeit ist WOERTLICH 200 wpm', () => {
    // Literal statt Symbol (Hausregel, Vorbild `spacesTab.test.ts`): ohne diese Zeile
    // hielten alle Faelle unten die Konstante gegen sich selbst und blieben gruen, wenn
    // jemand 200 auf 50 setzt und jede Lesezeit vervierfacht.
    assert.equal(WORDS_PER_MINUTE, 200)

    // Und dieselbe Festlegung am Ergebnis: 200 Woerter sind genau eine Minute, 201 zwei.
    assert.equal(readingTime(Array.from({ length: 200 }, () => 'wort').join(' ')), 1)
    assert.equal(readingTime(Array.from({ length: 201 }, () => 'wort').join(' ')), 2)
})

test('readingTime: ein einziges Wort ergibt 1 Minute, nicht 0 (aufgerundet, nicht gerundet)', () => {
    // Der Fall, der `Math.round` von `Math.ceil` trennt: round(1/200) = 0.
    assert.equal(readingTime('wort'), 1)
    assert.equal(readingTime('nur ein paar wenige woerter'), 1)
    assert.equal(readingTime(Array.from({ length: 99 }, () => 'wort').join(' ')), 1)
})

test('readingTime: leerer Text ergibt 0 — die einzige Null', () => {
    assert.equal(readingTime(''), 0)
    assert.equal(readingTime('   \n\n \t '), 0)
})

test('readingTime: Frontmatter zaehlt nicht mit', () => {
    const woerter = Array.from({ length: 400 }, () => 'wort').join(' ')
    const mitFrontmatter = `---\ntype: gallery\nlayout: grid\n---\n${woerter}`

    // 400 Woerter = 2 Minuten. Zaehlte das Frontmatter mit (4 weitere Woerter), bliebe es
    // hier zufaellig auch bei 2 — deshalb zusaetzlich der Fall genau an der Kante.
    assert.equal(readingTime(mitFrontmatter), 2)
    assert.equal(readingTime(`---\ntype: gallery\n---\n${Array.from({ length: 200 }, () => 'w').join(' ')}`), 1)
})

test('readingTime: mehrfacher Leerraum, Zeilenumbrueche und NBSP trennen genau einmal', () => {
    assert.equal(readingTime('eins   zwei\n\n\tdrei vier'), 1)
    assert.equal(readingTime(Array.from({ length: 201 }, () => 'w').join('\n')), 2)
})

test('readingTime: ein eingebettetes base64-Bild ist EIN Wort, kein Roman', () => {
    // Der 245-kB-Artikel des Bestands: 314 Woerter roh. Ein base64-Block enthaelt keinen
    // Leerraum, also darf er die Lesezeit nicht aufblaehen.
    const bild = `![](data:image/png;base64,${'A'.repeat(200_000)})`

    assert.equal(readingTime(bild), 1)
    assert.equal(readingTime(`${bild} ${Array.from({ length: 199 }, () => 'wort').join(' ')}`), 1)
})

// ── Data-URIs strippen (Vorstufe der Suche) ──────────────────────────────────────────

test('stripDataUris: die base64-Nutzlast verschwindet, der Text darum herum bleibt', () => {
    const text = `Davor ![](data:image/png;base64,iVBORw0KGgoAAAA) Danach`

    const gestrippt = stripDataUris(text)

    assert.equal(text.includes('iVBORw0KGgo'), true, 'Vorbedingung: der Rohtext traegt die Nutzlast ueberhaupt')
    assert.equal(gestrippt.includes('iVBORw0KGgo'), false)
    assert.match(gestrippt, /Davor/)
    assert.match(gestrippt, /Danach/)
})

test('stripDataUris: der Schnitt endet an der URI und frisst KEINEN Folgetext', () => {
    // Die Falle: alle Buchstaben von „Freiheit" liegen in [A-Za-z0-9+/=]. Nimmt die
    // Zeichenklasse Leerraum mit auf, laeuft der Treffer ueber das Ende der URI hinaus
    // und loescht echten Autorentext.
    const text = 'data:image/png;base64,AAAABBBB Freiheit und Selbstverwahrung'

    assert.match(stripDataUris(text), /Freiheit und Selbstverwahrung/)
})

test('stripDataUris: Text ohne Data-URI bleibt zeichengleich', () => {
    const text = 'Ein ganz normaler Artikel mit einem Link https://einundzwanzig.space und einem *Wort*.'

    assert.equal(stripDataUris(text), text)
})

// ── Suchtext-Adapter ─────────────────────────────────────────────────────────────────

/** Eine Zeile in der Form, die `articleSearchText` erwartet. */
const suchZeile = (over: Partial<Parameters<typeof articleSearchText>[0]> = {}) => ({
    id: 'id-1',
    title: 'Selbstverwahrung',
    teaser: 'Warum der eigene Schluessel zaehlt',
    content: 'Ein Artikel ueber Hardware-Wallets.',
    authorName: 'Anna',
    publishedAt: 1_700_000_000,
    ...over,
})

test('articleSearchText: `created_at` wird gefuellt — sonst sortiert searchMessages nach NaN', () => {
    const zeile = articleSearchText(suchZeile())

    assert.equal(typeof zeile.created_at, 'number')
    assert.equal(Number.isNaN(zeile.created_at), false)
})

test('articleSearchText: `created_at` traegt `publishedAt` — dieselbe Ordnung wie die Liste', () => {
    // Die Entscheidung, nicht nur das Vorhandensein: die Liste sortiert nach
    // `publishedAt`. Naehme die Suche `createdAt`, saehe der Leser nach dem Tippen eine
    // andere Reihenfolge als davor.
    assert.equal(articleSearchText(suchZeile({ publishedAt: 1_650_000_000 })).created_at, 1_650_000_000)
})

test('articleSearchText: sortiert man die Ergebnisse absteigend, kommt das Neueste zuerst', () => {
    const zeilen = [
        articleSearchText(suchZeile({ id: 'alt', publishedAt: 1_600_000_000 })),
        articleSearchText(suchZeile({ id: 'neu', publishedAt: 1_800_000_000 })),
        articleSearchText(suchZeile({ id: 'mittel', publishedAt: 1_700_000_000 })),
    ]

    // Genau die Sortierzeile aus `search.ts` (`searchMessages`), hier nachgestellt: sie
    // ist der einzige Verbraucher von `created_at`.
    zeilen.sort((a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id))

    assert.deepEqual(
        zeilen.map((z) => z.id),
        ['neu', 'mittel', 'alt'],
    )
})

test('articleSearchText: Titel, Teaser und Fliesstext sind alle durchsuchbar', () => {
    const zeile = articleSearchText(suchZeile())

    assert.match(zeile.text, /Selbstverwahrung/)
    assert.match(zeile.text, /eigene Schluessel/)
    assert.match(zeile.text, /Hardware-Wallets/)
})

test('articleSearchText: der Autorname landet in `name`, nicht im Text', () => {
    // `searchMessages` durchsucht `[row.text, row.name]` — der Name gehoert in sein
    // eigenes Feld, weil die UI ihn getrennt hervorhebt (`nameSegments`).
    const zeile = articleSearchText(suchZeile())

    assert.equal(zeile.name, 'Anna')
})

test('articleSearchText: base64 wird NICHT durchsuchbar (der Falschtreffer-Fall)', () => {
    // Gemessen am Bestand: „sad" fand roh 7 Artikel, gestrippt 2; „iVBOR" fand 5, danach
    // keinen. Der Nutzer bekaeme sonst Treffer angeboten, in denen das Wort nirgends steht.
    const zeile = articleSearchText(suchZeile({ content: `![](data:image/png;base64,iVBORsadAAAA)` }))

    assert.equal(zeile.text.includes('iVBORsad'), false)
})

test('articleSearchText: die uebrigen Felder der Zeile ueberleben (searchMessages gibt sie zurueck)', () => {
    const zeile = articleSearchText(suchZeile())

    assert.equal(zeile.id, 'id-1')
    assert.equal(zeile.title, 'Selbstverwahrung')
    assert.equal(zeile.publishedAt, 1_700_000_000)
})

// ── Cover-Verlauf ────────────────────────────────────────────────────────────────────

const PUBKEY_A = 'a'.repeat(64)
const PUBKEY_B = 'b'.repeat(64)

test('coverGradient: gleiche Adresse ergibt denselben Verlauf — auch ueber Aufrufe hinweg', () => {
    assert.deepEqual(coverGradient(PUBKEY_A, 'mein-artikel'), coverGradient(PUBKEY_A, 'mein-artikel'))
})

test('coverGradient: eine neue Fassung desselben Artikels behaelt ihren Verlauf', () => {
    // Ein 30023 ist ersetzbar: neue Fassung, neue Event-Id, womoeglich neuer Titel und
    // neues `created_at`. Der Verlauf haengt an `pubkey` + `d` und kann davon nichts
    // sehen — dass der Titel nicht durchschlaegt, ist strukturell gesichert (er ist kein
    // Parameter). Diese Zeile haelt die Signatur fest, damit ihn niemand nachtraegt.
    assert.equal(coverGradient.length, 2)
    assert.deepEqual(coverGradient(PUBKEY_A, 'draft-1700000000'), coverGradient(PUBKEY_A, 'draft-1700000000'))
})

test('coverGradient: die Kennung geht in den Hash ein — zwei Artikel eines Autors unterscheiden sich', () => {
    const verlaeufe = new Set(
        Array.from({ length: 12 }, (_unused, i) => coverGradient(PUBKEY_A, `artikel-${i}`).css),
    )

    // Bei acht Paaren und zwoelf Artikeln koennen Wiederholungen vorkommen; was NICHT
    // vorkommen darf, ist genau ein einziger Verlauf fuer alles — das waere der Fall,
    // wenn nur der `pubkey` gehasht wuerde.
    assert.equal(verlaeufe.size > 1, true, `nur ${verlaeufe.size} verschiedene Verlaeufe`)
})

test('coverGradient: der pubkey geht in den Hash ein — dasselbe `d` bei zwei Autoren unterscheidet sich', () => {
    // 67 der 104 Artikel heissen `draft-<ts>`; Kollisionen ueber Autoren hinweg sind real.
    const treffer = Array.from({ length: 12 }, (_unused, i) => `draft-${i}`).filter(
        (d) => coverGradient(PUBKEY_A, d).css !== coverGradient(PUBKEY_B, d).css,
    )

    assert.equal(treffer.length > 0, true, 'der pubkey aendert nie etwas — er geht nicht in den Hash ein')
})

// Die Palette WOERTLICH festnageln, nicht nur ueber sich selbst.
//
// Der `reviewer` hat am 2026-08-20 gemessen, dass die Palette von 8 auf 2 Paare gekuerzt
// werden kann, ohne dass ein einziger Test rot wird (105/105 gruen) — erst bei EINEM Paar
// fielen zwei Faelle. Der Grund ist derselbe wie beim `DEFAULT_SPACES_TAB`-Mutanten:
// jede Zusicherung hielt `COVER_PALETTE` gegen `COVER_PALETTE.length`, also gegen sich
// selbst. Eine schrumpfende Palette ist aber eine echte Verschlechterung — sie erhoeht die
// Kollisionsrate zweier Artikel auf denselben Verlauf, und genau das soll die Streuung
// verhindern.
test('COVER_PALETTE traegt WOERTLICH acht Paare, und jedes ist ein Paar', () => {
    assert.equal(COVER_PALETTE.length, 8)

    for (const paar of COVER_PALETTE) {
        assert.equal(paar.length, 2, 'jeder Eintrag ist genau ein Farb-PAAR (von, nach)')
    }
})

test('coverGradient: der CSS-Wert ist fertig bindbar und traegt WOERTLICH 135 Grad', () => {
    assert.equal(COVER_GRADIENT_ANGLE, 135)

    const verlauf = coverGradient(PUBKEY_A, 'x')

    assert.equal(verlauf.css, `linear-gradient(135deg, ${verlauf.from}, ${verlauf.to})`)
})

test('coverGradient: jede Farbe der Palette traegt weisse Schrift (WCAG AA, 4,5:1)', () => {
    const kanal = (v: number): number => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
    const leuchtdichte = (hex: string): number => {
        const [r, g, b] = [1, 3, 5].map((i) => kanal(parseInt(hex.slice(i, i + 2), 16) / 255))
        return 0.2126 * r + 0.7152 * g + 0.0722 * b
    }

    assert.equal(COVER_PALETTE.length > 0, true)
    for (const [von, nach] of COVER_PALETTE) {
        for (const farbe of [von, nach]) {
            assert.match(farbe, /^#[0-9a-f]{6}$/, farbe)
            const kontrast = 1.05 / (leuchtdichte(farbe) + 0.05)
            assert.equal(kontrast >= 4.5, true, `${farbe} hat nur ${kontrast.toFixed(2)}:1 gegen Weiss`)
        }
    }
})

test('coverGradient: jeder Index der Palette ist erreichbar — kein `undefined` aus dem Hash', () => {
    // `>>> 0` in der Hash-Funktion: ohne die vorzeichenlose Umwandlung liefert `% length`
    // bei negativem Zwischenwert einen negativen Index und damit `undefined`.
    for (let i = 0; i < 200; i++) {
        const verlauf = coverGradient(PUBKEY_A, `kennung-${i}`)
        assert.equal(typeof verlauf.from, 'string')
        assert.equal(typeof verlauf.to, 'string')
    }
})

// ── Podcast-Episoden ─────────────────────────────────────────────────────────────────

/** Ein echtes `imeta` aus dem Bestand (gezogen 2026-08-20, Vance-Crowe-Bridge). */
const ECHTES_AUDIO_IMETA = [
    'imeta',
    'm audio/mpeg',
    'url https://serve.podhome.fm/episode/14f388e3-1857-430b-dc9f-08dd3181bbe3/6390114092.mp3',
]

/** Das einzige Bild-`imeta` des Bestands — genau ein Artikel traegt es. */
const ECHTES_BILD_IMETA = [
    'imeta',
    'url https://route96.pareto.space/9b8e1800de5f375e33854fa581411ff5b0c97622481f1c914454f8e8d13af72a.webp',
    'm image/webp',
    'dim 860x860',
    'x 9b8e1800de5f375e33854fa581411ff5b0c97622481f1c914454f8e8d13af72a',
]

test('isPodcastEpisode: erkennt das echte Audio-imeta des Bestands, mit URL', () => {
    const episode = isPodcastEpisode([['title', 'ATR'], ECHTES_AUDIO_IMETA])

    assert.notEqual(episode, null)
    assert.equal(episode?.mimeType, 'audio/mpeg')
    assert.equal(episode?.url, 'https://serve.podhome.fm/episode/14f388e3-1857-430b-dc9f-08dd3181bbe3/6390114092.mp3')
})

test('isPodcastEpisode: ein Artikel mit `m image/webp` bekommt KEINEN Player', () => {
    // Der Fall, der die Pruefung auf den `m`-Wert von einer Pruefung auf blosse
    // imeta-Existenz trennt. Genau ein Artikel des Bestands traegt dieses Tag.
    assert.equal(isPodcastEpisode([ECHTES_BILD_IMETA]), null)
})

test('isPodcastEpisode: ohne jedes imeta ist es keine Episode', () => {
    assert.equal(isPodcastEpisode([['title', 'Ein normaler Artikel'], ['d', 'x']]), null)
    assert.equal(isPodcastEpisode([]), null)
})

test('isPodcastEpisode: `audio/*` gilt, nicht nur `audio/mpeg`', () => {
    assert.equal(isPodcastEpisode([['imeta', 'm audio/mp4', 'url https://x.test/a.m4a']])?.mimeType, 'audio/mp4')
    assert.equal(isPodcastEpisode([['imeta', 'm AUDIO/MPEG', 'url https://x.test/a.mp3']])?.mimeType, 'AUDIO/MPEG')
})

test('isPodcastEpisode: ohne brauchbare URL keine Episode — ein Player ohne Quelle taete nichts', () => {
    assert.equal(isPodcastEpisode([['imeta', 'm audio/mpeg']]), null)
    assert.equal(isPodcastEpisode([['imeta', 'm audio/mpeg', 'url ']]), null)
    assert.equal(isPodcastEpisode([['imeta', 'm audio/mpeg', 'url javascript:alert(1)']]), null)
    assert.equal(isPodcastEpisode([['imeta', 'm audio/mpeg', 'url /lokal/a.mp3']]), null)
})

test('isPodcastEpisode: Dauer fehlt im gesamten Bestand — dann 0, nicht NaN', () => {
    // 14 von 14 Episoden tragen nur `m` und `url` (2026-08-20 nachgemessen). Die 0 ist
    // hier der Normalfall, nicht der Rand: die Oberflaeche muss ihn tragen.
    assert.equal(isPodcastEpisode([ECHTES_AUDIO_IMETA])?.durationSeconds, 0)
})

test('isPodcastEpisode: Dauer aus dem imeta-Feld (NIP-71), auf ganze Sekunden gerundet', () => {
    const tags = [['imeta', 'm audio/mpeg', 'url https://x.test/a.mp3', 'duration 29.223']]

    assert.equal(isPodcastEpisode(tags)?.durationSeconds, 29)
})

test('isPodcastEpisode: Dauer auch aus dem eigenen `duration`-Tag (NIP-71), imeta gewinnt', () => {
    assert.equal(
        isPodcastEpisode([['imeta', 'm audio/mpeg', 'url https://x.test/a.mp3'], ['duration', '3600']])?.durationSeconds,
        3600,
    )
    assert.equal(
        isPodcastEpisode([
            ['imeta', 'm audio/mpeg', 'url https://x.test/a.mp3', 'duration 60'],
            ['duration', '3600'],
        ])?.durationSeconds,
        60,
    )
})

test('isPodcastEpisode: unbrauchbare Dauer wird 0, nicht NaN und nicht negativ', () => {
    for (const roh of ['bald', '-5', '0', 'Infinity', '']) {
        const tags = [['imeta', 'm audio/mpeg', 'url https://x.test/a.mp3', `duration ${roh}`]]
        assert.equal(isPodcastEpisode(tags)?.durationSeconds, 0, roh)
    }
})

test('isPodcastEpisode: imeta-Werte duerfen Leerzeichen enthalten (NIP-92 trennt am ERSTEN)', () => {
    const tags = [['imeta', 'alt Eine Folge ueber Bitcoin', 'm audio/mpeg', 'url https://x.test/a.mp3']]

    assert.equal(isPodcastEpisode(tags)?.url, 'https://x.test/a.mp3')
})

test('isPodcastEpisode: das erste Audio-imeta gewinnt, ein Bild davor stoert nicht', () => {
    const tags = [ECHTES_BILD_IMETA, ECHTES_AUDIO_IMETA]

    assert.equal(isPodcastEpisode(tags)?.mimeType, 'audio/mpeg')
})

// ── Relatives Datum: die Regel, nicht die Formulierung ───────────────────────────────
//
// Formatiert wird in `locale.ts` (`formatRelativeDate`, `Intl.RelativeTimeFormat`).
// Hier steht nur die ENTSCHEIDUNG: relativ oder absolut, und mit welcher Einheit.

/** Ein fester Bezugspunkt, damit die Faelle nicht an der Uhr des Testrechners haengen. */
const HEUTE = Math.floor(Date.UTC(2026, 7, 20, 12, 0, 0) / 1000)
const TAG = 86_400

test('RELATIVE_DATE_MAX_DAYS ist WOERTLICH 30', () => {
    // Ohne diese Zeile hielte jede Zusicherung unten die Konstante gegen sich selbst.
    // Die 30 traegt eine gemessene Entscheidung: 15 der 104 Artikel sind juenger, 50
    // weitere tragen ein Juni-2026-Datum (gezaehlt) und blieben mit einer groesseren
    // Schwelle allesamt „vor 2 Monaten".
    assert.equal(RELATIVE_DATE_MAX_DAYS, 30)
})

test('relativeDateParts: heute, gestern und vorgestern sind Tage', () => {
    assert.deepEqual(relativeDateParts(HEUTE, HEUTE), { value: 0, unit: 'day' })
    assert.deepEqual(relativeDateParts(HEUTE - TAG, HEUTE), { value: -1, unit: 'day' })
    assert.deepEqual(relativeDateParts(HEUTE - 2 * TAG, HEUTE), { value: -2, unit: 'day' })
})

test('relativeDateParts: ab dem siebten Tag wird in WOCHEN gerechnet, abgerundet', () => {
    assert.deepEqual(relativeDateParts(HEUTE - 6 * TAG, HEUTE), { value: -6, unit: 'day' })
    assert.deepEqual(relativeDateParts(HEUTE - 7 * TAG, HEUTE), { value: -1, unit: 'week' })
    // „vor 23 Tagen" ist eine Zahl, die niemand einordnet — „vor 3 Wochen" ist eine Auskunft.
    assert.deepEqual(relativeDateParts(HEUTE - 23 * TAG, HEUTE), { value: -3, unit: 'week' })
    assert.deepEqual(relativeDateParts(HEUTE - 29 * TAG, HEUTE), { value: -4, unit: 'week' })
})

test('relativeDateParts: die Schwelle ist WOERTLICH 30 Tage und AUSSCHLIESSEND', () => {
    assert.notEqual(relativeDateParts(HEUTE - 29 * TAG, HEUTE), null)
    assert.equal(relativeDateParts(HEUTE - 30 * TAG, HEUTE), null)
    assert.equal(relativeDateParts(HEUTE - 400 * TAG, HEUTE), null)
})

test('relativeDateParts: der Juni-Bestand (60-90 Tage) bleibt ABSOLUT — der eigentliche Grund fuer die Schwelle', () => {
    // 50 Artikel tragen ein Juni-2026-Datum (gezaehlt). Waere die Schwelle groesser,
    // stuende „vor 2 Monaten" fuenfzigmal untereinander.
    for (const tage of [60, 75, 90]) {
        assert.equal(relativeDateParts(HEUTE - tage * TAG, HEUTE), null, `${tage} Tage muessten absolut sein`)
    }
})

test('relativeDateParts: ZUKUNFT gilt als absolut — „in 3 Tagen" unter einer lesbaren Karte waere gelogen', () => {
    assert.equal(relativeDateParts(HEUTE + 3 * TAG, HEUTE), null)
    assert.equal(relativeDateParts(HEUTE + 400 * TAG, HEUTE), null)
})

test('relativeDateParts: gerechnet wird in KALENDERTAGEN, nicht in vergangenen Stunden', () => {
    // Der Fall, der die Ordinal-Rechnung ueberhaupt noetig macht: gestern 23:00, heute
    // 08:00 — neun Stunden Abstand, aber ein Kalendertag. Eine Division durch 86400
    // ergaebe 0 und die Karte schriebe „heute" ueber einen Artikel von gestern.
    const heuteMorgens = Math.floor(new Date(2026, 7, 20, 8, 0, 0).getTime() / 1000)
    const gesternAbends = Math.floor(new Date(2026, 7, 19, 23, 0, 0).getTime() / 1000)

    assert.equal((heuteMorgens - gesternAbends) / TAG < 1, true, 'Vorbedingung: weniger als 24 Stunden Abstand')
    assert.deepEqual(relativeDateParts(gesternAbends, heuteMorgens), { value: -1, unit: 'day' })
})

test('relativeDateParts: derselbe Tag zu verschiedenen Uhrzeiten bleibt „heute"', () => {
    const frueh = Math.floor(new Date(2026, 7, 20, 0, 30, 0).getTime() / 1000)
    const spaet = Math.floor(new Date(2026, 7, 20, 23, 30, 0).getTime() / 1000)

    assert.deepEqual(relativeDateParts(frueh, spaet), { value: 0, unit: 'day' })
})
