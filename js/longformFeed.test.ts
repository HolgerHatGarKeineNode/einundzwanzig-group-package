/**
 * Der Zeilen-Vertrag der Artikelfläche (P1) — was `longformFeed.ts` (`toRow`) liefern
 * muss. Ausführen:
 *   node --experimental-strip-types --test packages/einundzwanzig-group/js/longformFeed.test.ts
 *
 * ── Warum diese Datei `longformFeed.ts` NICHT importiert ─────────────────────────────
 *
 * Sie kann es nicht, und das ist gemessen (2026-08-20), nicht vermutet. Zwei Gründe
 * hintereinander:
 *
 * 1. **Endungslose Importe.** `longformFeed.ts` schreibt `from './core'`, `'./locale'`,
 *    `'./profiles'`, `'./repository'`. Vites Auflöser ergänzt `.ts`, Nodes ESM-Auflöser
 *    nicht — `ERR_MODULE_NOT_FOUND`. In der Kette ab hier hängen **13 solche Kanten in
 *    6 Dateien** (`core.ts` → `./storage`, `./relayNotices`, `./reqWatch`, `./authHold`,
 *    `./readState`; `relayNotices.ts` → `./publishResult`; …). Im gesamten `js/` sind es
 *    208 in 33 Dateien. Das ist ein eigener Auftrag, keine Nebenwirkung von P1.
 * 2. **Und danach fehlt `localStorage`.** In einer Kopie mit ergänzten Endungen lädt das
 *    Modul zwar („OK geladen"), zieht dabei aber `session.ts` in den Graphen, und das
 *    ruft beim Import welshmans `synced()` → `localStorage.getItem`. In node gibt es das
 *    nicht: `TypeError: Cannot read properties of undefined (reading 'getItem')`, zweimal
 *    gefangen und protokolliert (Lesestand + Cache fallen still auf flüchtig zurück).
 *    Ein Test, der erst das Speicher-Subsystem hochzieht, um an eine 6-Zeilen-Funktion zu
 *    kommen, misst die falsche Sache.
 *
 * **Die Folge für P1** war kein schwächerer Test, sondern ein anderer Schnitt: das Bauen
 * der Zeile ist nach `longform.ts` gewandert (`buildArticleRow`, rein, ohne welshman),
 * `toRow` reicht nur noch vier Werte an. Beide Modulköpfe schreiben diese Trennung
 * ohnehin vor — `toRow` stand nur auf der falschen Seite davon.
 *
 * **Was hier folglich NICHT gedeckt ist**, ausdrücklich benannt: die vier Zuweisungen in
 * `toRow` selbst (`displayProfileByPubkey`, das Avatar-Argument, `[BOARD_URL]`,
 * `dateLabel`). Sie sind mit `node --test` nicht erreichbar. Sobald `js/` seine
 * Import-Endungen hat und ein `localStorage`-Stub existiert, gehört genau das hier hinein.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as nip19 from 'nostr-tools/nip19'
import { LONGFORM, buildArticleRow, type ArticleEventLike, type ArticleRowDeps } from './longform.ts'

const AUTOR = '3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d'
const BOARD = 'wss://nostr.einundzwanzig.space/'

/**
 * Der Fixture-Fall, auf dem der Kernbeweis steht: `created_at` und `published_at` sind
 * **verschieden**, und zwar deutlich.
 *
 * Das ist keine erfundene Konstellation. Im Bestand driften 13 von 104 Artikeln, bis zu
 * 164 Tage — 12 davon Podcast-Archivimporte, deren `published_at` das echte
 * Episodendatum trägt. Wären beide Werte im Fixture gleich, ginge jede Verwechslung der
 * beiden Felder grün durch.
 */
const PUBLISHED_AT = 1_700_000_000
const CREATED_AT = 1_714_000_000

const event = (over: Partial<ArticleEventLike> = {}): ArticleEventLike => ({
    id: 'e'.repeat(64),
    pubkey: AUTOR,
    created_at: CREATED_AT,
    content: 'Der Fliesstext des Artikels.',
    tags: [
        ['d', 'meine-kennung'],
        ['title', 'Selbstverwahrung'],
        ['summary', 'Warum der eigene Schluessel zaehlt'],
        ['image', 'https://bild.test/titel.png'],
        ['published_at', String(PUBLISHED_AT)],
        ['t', 'bitcoin'],
    ],
    ...over,
})

/** Was `toRow` beisteuert — hier mit erkennbaren Werten statt der welshman-Quellen. */
const deps = (over: Partial<ArticleRowDeps> = {}): ArticleRowDeps => ({
    authorName: 'Anna',
    authorPicture: 'https://bild.test/avatar.png',
    relays: [BOARD],
    formatDate: (ts) => `DATUM(${ts})`,
    // Verpflichtend im Vertrag (siehe `ArticleRowDeps`), hier mit einem Wert, der in
    // KEINER anderen Zusicherung dieser Datei vorkommt — eine Verwechslung mit einer
    // Minutenzahl aus einem Nachbartest fiele sonst nicht auf.
    readingMinutes: 7,
    ...over,
})

// ── DER KERNBEWEIS ───────────────────────────────────────────────────────────────────

test('KERNBEWEIS: createdAt kommt aus event.created_at, publishedAt aus dem published_at-Tag', () => {
    const row = buildArticleRow(event(), deps())

    assert.equal(row.createdAt, CREATED_AT)
    assert.equal(row.publishedAt, PUBLISHED_AT)

    // Und die Vorbedingung ausdrücklich: wären die beiden gleich, sagte der Fall nichts.
    assert.notEqual(CREATED_AT, PUBLISHED_AT)
})

test('KERNBEWEIS-Kehrseite: das Datum der Karte formatiert publishedAt, nicht createdAt', () => {
    // Die zweite Hälfte derselben Verwechslung: die Zeile könnte die Felder richtig
    // führen und trotzdem das falsche formatieren.
    assert.equal(buildArticleRow(event(), deps()).dateLabel, `DATUM(${PUBLISHED_AT})`)
})

test('ohne published_at-Tag fallen beide Felder zusammen — der Fall, der nichts beweist', () => {
    const row = buildArticleRow(event({ tags: [['d', 'x']] }), deps())

    assert.equal(row.publishedAt, CREATED_AT)
    assert.equal(row.createdAt, CREATED_AT)
})

// ── Die neuen Felder aus P1 ──────────────────────────────────────────────────────────

test('pubkey: die Zeile trägt die Adresse des Autors, nicht nur seinen Namen', () => {
    // Zwei Autoren dürfen gleich heißen. Die Hovercard und die Autorenseite (P4) filtern
    // auf diesen Wert.
    const row = buildArticleRow(event(), deps({ authorName: 'Anna' }))

    assert.equal(row.pubkey, AUTOR)
    assert.equal(row.authorName, 'Anna')
})

test('content: der Artikeltext liegt ROH und zeichengleich in der Zeile', () => {
    const roh = `Absatz eins.\n\n![](data:image/png;base64,${'A'.repeat(5000)})\n\nAbsatz zwei.`
    const row = buildArticleRow(event({ content: roh }), deps())

    // Zeichengleich, inklusive der base64-Nutzlast: gekappt oder vorgereinigt wäre die
    // Lesezeit falsch und der Lesefortschritt (P3) rechnete gegen eine falsche Länge.
    // Das Reinigen für die Suche passiert in `articleSearchText`, nicht hier.
    assert.equal(row.content, roh)
    assert.equal(row.content.length, roh.length)
})

test('content: auch der leere Artikel kommt als leerer String an, nicht als undefined', () => {
    assert.equal(buildArticleRow(event({ content: '' }), deps()).content, '')
})

// ── Der übrige Zeilenvertrag (bis P1 ungeprüft) ──────────────────────────────────────

test('die Zeile hat genau die vereinbarten Felder — kein Feld fällt still weg', () => {
    const row = buildArticleRow(event(), deps())

    assert.deepEqual(Object.keys(row).sort(), [
        'authorName',
        'authorPicture',
        'content',
        'coverCss',
        'createdAt',
        'dateIso',
        'dateLabel',
        'id',
        'identifier',
        'image',
        'naddr',
        'podcast',
        'pubkey',
        'publishedAt',
        'readingMinutes',
        'teaser',
        'title',
        'topics',
    ])
})

// ── Die vier Felder, die P2 hinzugefügt hat ──────────────────────────────────────────

test('identifier: das `d`-Tag steht ROH in der Zeile, nicht nur bech32-verpackt im naddr', () => {
    // Der Cover-Verlauf und (ab P6) der `#a`-Filter brauchen die Adresse. Ohne dieses
    // Feld müsste jeder Verbraucher den naddr erst wieder aufmachen.
    assert.equal(buildArticleRow(event(), deps()).identifier, 'meine-kennung')
})

test('identifier: ohne `d`-Tag bleibt er leer — genau wie der naddr', () => {
    const row = buildArticleRow(event({ tags: [['title', 'Ohne Kennung']] }), deps())

    assert.equal(row.identifier, '')
    assert.equal(row.naddr, '')
})

test('coverCss: ist IMMER gesetzt, auch wenn ein echtes Titelbild danebensteht', () => {
    // Zwei Gründe (siehe `ArticleRow.coverCss`): das echte Bild kann im Browser
    // scheitern, und der Verlauf kostet nichts.
    const mitBild = buildArticleRow(event(), deps())

    assert.equal(mitBild.image, 'https://bild.test/titel.png')
    assert.match(mitBild.coverCss, /^linear-gradient\(135deg, #[0-9a-f]{6}, #[0-9a-f]{6}\)$/)
})

test('coverCss: haengt an pubkey UND Kennung — dieselbe Adresse ergibt denselben Verlauf', () => {
    const eins = buildArticleRow(event(), deps())
    const wieder = buildArticleRow(event({ id: 'f'.repeat(64) }), deps({ authorName: 'Jemand anders' }))
    const andere = buildArticleRow(event({ tags: [['d', 'andere-kennung']] }), deps())

    // Gleiche Adresse, neue Fassung (andere Event-Id, anderer Anzeigename): gleicher Verlauf.
    assert.equal(wieder.coverCss, eins.coverCss)
    // Andere Kennung: anderer Verlauf.
    assert.notEqual(andere.coverCss, eins.coverCss)
})

test('dateIso: maschinenlesbarer Zeitpunkt zum ANZEIGE-Datum, aus publishedAt', () => {
    // Die Karte darf ihr Datum relativ beschriften („vor 3 Wochen"). Das ist fuer einen
    // Menschen eine Auskunft und fuer eine Maschine gar nichts — dieses Feld traegt den
    // Zeitpunkt weiter, in das `datetime`-Attribut des `<time>`.
    const row = buildArticleRow(event(), deps())

    assert.equal(row.dateIso, new Date(PUBLISHED_AT * 1000).toISOString())
    assert.equal(row.dateIso, '2023-11-14T22:13:20.000Z')
    // Und zwar aus `publishedAt`, NICHT aus `createdAt` — dieselbe Feldwahl wie das
    // sichtbare Datum, sonst behaupteten Beschriftung und Attribut Verschiedenes.
    assert.notEqual(row.dateIso, new Date(CREATED_AT * 1000).toISOString())
})

test('readingMinutes: wird DURCHGEREICHT, nicht hier gerechnet', () => {
    // Der Merker sitzt beim Aufrufer (`longformFeed.ts`, `readingCache`), weil er dort
    // eine Event-Id hat. `buildArticleRow` ist rein und darf keine Historie führen.
    assert.equal(buildArticleRow(event(), deps({ readingMinutes: 42 })).readingMinutes, 42)
    assert.equal(buildArticleRow(event(), deps({ readingMinutes: 0 })).readingMinutes, 0)
})

// ── Podcast und fehlendes Titelbild sind ZWEI Merkmale ───────────────────────────────
//
// Am 2026-08-20 über den Bestand gemessen: 14 Episoden, 14 Artikel ohne `image`,
// Schnittmenge **12**. Wer die beiden Mengen gleichsetzt, baut zwei kaputte Karten —
// eine Episode ohne Player und eine Textkarte mit einem. Beide Randfälle stehen hier.

const IMETA_AUDIO = ['imeta', 'url https://podcast.test/folge-7.mp3', 'm audio/mpeg']

test('podcast: eine Episode MIT Titelbild bekommt trotzdem ihren Player', () => {
    const row = buildArticleRow(
        event({ tags: [['d', 'folge-7'], ['title', 'Folge 7'], ['image', 'https://bild.test/cover.png'], IMETA_AUDIO] }),
        deps(),
    )

    assert.equal(row.image, 'https://bild.test/cover.png')
    assert.equal(row.podcast?.url, 'https://podcast.test/folge-7.mp3')
})

test('podcast: ein Artikel OHNE Titelbild ist deswegen keine Episode', () => {
    const row = buildArticleRow(event({ tags: [['d', 'nur-text'], ['title', 'Nur Text']] }), deps())

    assert.equal(row.image, '')
    assert.equal(row.podcast, null)
})

test('podcast: die Dauer ist 0 — im ganzen Bestand traegt keine Episode eine', () => {
    const row = buildArticleRow(event({ tags: [['d', 'folge-7'], IMETA_AUDIO] }), deps())

    assert.equal(row.podcast?.durationSeconds, 0)
    // Ausdruecklich 0 und nicht NaN/undefined: die Oberflaeche prueft auf > 0 und laesst
    // die Angabe sonst WEG, statt „0:00" zu behaupten.
    assert.equal(Number.isNaN(row.podcast?.durationSeconds), false)
})

test('podcast: ein `imeta` mit Bild-MIME erzeugt KEINEN Player', () => {
    const row = buildArticleRow(
        event({ tags: [['d', 'galerie'], ['imeta', 'url https://bild.test/x.webp', 'm image/webp']] }),
        deps(),
    )

    assert.equal(row.podcast, null)
})

test('naddr: trägt Kind, Autor, Kennung und den Relay-Hint', () => {
    const row = buildArticleRow(event(), deps())
    const decoded = nip19.decode(row.naddr)

    assert.equal(decoded.type, 'naddr')
    assert.deepEqual(decoded.data, {
        kind: LONGFORM,
        pubkey: AUTOR,
        identifier: 'meine-kennung',
        relays: [BOARD],
    })
})

test('naddr: ohne `d`-Tag bleibt er leer — die Karte bekommt dann kein href', () => {
    assert.equal(buildArticleRow(event({ tags: [['title', 'Ohne Kennung']] }), deps()).naddr, '')
})

test('naddr: eine `draft-<ts>`-Kennung ist ein ganz normaler Identifier', () => {
    // 67 der 104 Artikel heißen so und sind publiziert. Ein Filter auf das Muster
    // löschte zwei Drittel des Bestands.
    const row = buildArticleRow(event({ tags: [['d', 'draft-1723400000']] }), deps())

    assert.equal((nip19.decode(row.naddr).data as { identifier: string }).identifier, 'draft-1723400000')
})

test('naddr: ohne Relay-Hint entsteht er trotzdem (leerer BOARD_URL ist ein realer Zustand)', () => {
    const row = buildArticleRow(event(), deps({ relays: [] }))

    assert.deepEqual((nip19.decode(row.naddr).data as { relays: string[] }).relays, [])
})

test('teaser: das `summary`-Tag gewinnt vor der Fließtext-Vorschau', () => {
    const row = buildArticleRow(event({ content: 'Ganz anderer Text.' }), deps())

    assert.equal(row.teaser, 'Warum der eigene Schluessel zaehlt')
})

test('teaser: ohne `summary` entsteht er aus dem Artikeltext — ohne Markdown-Zeichen', () => {
    const row = buildArticleRow(
        event({ tags: [['d', 'x']], content: '# Die Ueberschrift\n\nDer **erste** Absatz.' }),
        deps(),
    )

    assert.equal(row.teaser.includes('#'), false)
    assert.equal(row.teaser.includes('**'), false)
    assert.match(row.teaser, /Die Ueberschrift/)
})

test('teaser: ein leeres `summary`-Tag zählt als fehlend, nicht als leerer Teaser', () => {
    const row = buildArticleRow(event({ tags: [['summary', '']], content: 'Der Fliesstext.' }), deps())

    assert.equal(row.teaser, 'Der Fliesstext.')
})

test('image und topics kommen roh aus den Tags', () => {
    const row = buildArticleRow(event(), deps())

    assert.equal(row.image, 'https://bild.test/titel.png')
    assert.deepEqual(row.topics, ['bitcoin'])
})

test('fehlendes image ergibt einen leeren String (14 von 104 Artikeln)', () => {
    const row = buildArticleRow(event({ tags: [['d', 'x']] }), deps())

    assert.equal(row.image, '')
    assert.deepEqual(row.topics, [])
})

test('id und Avatar werden unverändert durchgereicht', () => {
    const row = buildArticleRow(event({ id: 'a'.repeat(64) }), deps({ authorPicture: 'https://b.test/p.png' }))

    assert.equal(row.id, 'a'.repeat(64))
    assert.equal(row.authorPicture, 'https://b.test/p.png')
})

test('ein `published_at` von 9e15 kippt die Zeile nicht auf Platz 1', () => {
    // Derselbe Riegel wie in `readArticleTags`, hier an der fertigen Zeile: sonst stünde
    // in `publishedAt` eine Zahl, die die absteigende Sortierung dauerhaft anführt.
    const row = buildArticleRow(event({ tags: [['published_at', '9e15']] }), deps())

    assert.equal(row.publishedAt, CREATED_AT)
    assert.equal(row.dateLabel, `DATUM(${CREATED_AT})`)
})
