/**
 * Pure-Tests für die Suche im geladenen Verlauf (P6a) — welshman-frei per Modulschnitt.
 * Läuft ohne neue Dependency über Nodes eingebauten Test-Runner + TS-Type-Stripping:
 *   node --experimental-strip-types --test packages/einundzwanzig-group/js/search.test.ts
 *
 * Vorbild `js/paletteItems.test.ts` / `js/nostrEventLink.test.ts` / `js/chatLinks.test.ts`.
 *
 * EINE Testgruppe importiert `matchFilter` aus dem echten `@welshman/util` (reale
 * Abhängigkeit, kein Mock — dasselbe Prinzip wie `nostrEventLink.test.ts` mit
 * `nostr-tools/nip19`) um die im Kopfkommentar von `search.ts` behauptete Schwäche
 * (nur das erste Suchwort entscheidet) am echten installierten Paket zu belegen, statt
 * sie nachzuerzählen.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { matchFilter } from '@welshman/util'
import {
    SEARCH_RESULT_LIMIT,
    findMatchRanges,
    foldForSearch,
    matchesAllTerms,
    parseSearchTerms,
    searchMessages,
    snippetSegments,
    toSegments,
    type SearchableRow,
} from './search.ts'

const row = (over: Partial<SearchableRow> & { id: string }): SearchableRow => ({
    text: '',
    name: '',
    created_at: 0,
    ...over,
})

const nostrEvent = (content: string) => ({
    kind: 9,
    content,
    tags: [],
    created_at: 0,
    id: 'a'.repeat(64),
    pubkey: 'b'.repeat(64),
    sig: 'c'.repeat(128),
})

// ── SEARCH_RESULT_LIMIT ──────────────────────────────────────────────────────────────

test('SEARCH_RESULT_LIMIT ist 50', () => {
    assert.equal(SEARCH_RESULT_LIMIT, 50)
})

// ── 1. Mehrwortsuche als UND — Gegenprobe am echten welshman matchFilter ────────────

test('welshman matchFilter: erstes Wort trifft, zweites fehlt komplett -> FALSCHTREFFER (belegt am echten Paket)', () => {
    const event = nostrEvent('Bitcoin ist heute im Gespraech.')
    assert.equal(
        matchFilter({ search: 'bitcoin xyz999notpresent' }, event),
        true,
        'matchFilter prueft nur den ERSTEN Term und ignoriert den Rest — "xyz999notpresent" fehlt im Content trotzdem MATCH',
    )
})

test('welshman matchFilter: dieselbe Anfrage, Woerter vertauscht, liefert ein ANDERES Ergebnis — nur die Reihenfolge entscheidet', () => {
    const event = nostrEvent('Bitcoin ist heute im Gespraech.')
    assert.equal(matchFilter({ search: 'bitcoin xyz999notpresent' }, event), true)
    assert.equal(matchFilter({ search: 'xyz999notpresent bitcoin' }, event), false)
})

test('searchMessages: derselbe Fall wie oben wird als NICHT-Treffer erkannt (korrekte UND-Semantik, Gegenprobe)', () => {
    const rows = [row({ id: '1', text: 'Bitcoin ist heute im Gespraech.', name: 'sam' })]
    const out = searchMessages(rows, 'bitcoin xyz999notpresent')
    assert.equal(out.total, 0)
})

test('searchMessages: Wortreihenfolge in der Anfrage aendert das Ergebnis NICHT (matchFilter waere davon abhaengig)', () => {
    const rows = [row({ id: '1', text: 'Bitcoin und Wien gehoeren zusammen.', name: 'sam' })]
    assert.equal(searchMessages(rows, 'bitcoin wien').total, 1)
    assert.equal(searchMessages(rows, 'wien bitcoin').total, 1)
})

test('searchMessages: beide Woerter noetig — fehlt eines, kein Treffer, egal welches', () => {
    const rows = [row({ id: '1', text: 'nur Bitcoin, kein zweites Stichwort', name: 'x' })]
    assert.equal(searchMessages(rows, 'bitcoin lightning').total, 0)
    assert.equal(searchMessages(rows, 'lightning bitcoin').total, 0)
})

// ── 2. Teilwortsuche ─────────────────────────────────────────────────────────────────

test('Teilwortsuche: "coin" findet "Bitcoin" (eine Wortgrenzen-Suche wuerde das verschlucken)', () => {
    const rows = [row({ id: '1', text: 'Bitcoin ist da.', name: 'x' })]
    assert.equal(searchMessages(rows, 'coin').total, 1)
})

// ── 3. Diakritika-Blindheit inklusive ß→ss ──────────────────────────────────────────

test('foldForSearch faltet Umlaute und ß weg', () => {
    assert.equal(foldForSearch('Müller').folded, 'muller')
    assert.equal(foldForSearch('Straße').folded, 'strasse')
    assert.equal(foldForSearch('Grüße').folded, 'grusse')
    assert.equal(foldForSearch('Können').folded, 'konnen')
})

test('Diakritika-blind Richtung 1: "grusse" findet "Grüße"', () => {
    const rows = [row({ id: '1', text: 'Herzliche Grüße von der Nostr-Runde!', name: 'x' })]
    assert.equal(searchMessages(rows, 'grusse').total, 1)
})

test('Diakritika-blind Richtung 2: "Grüße" (mit Umlaut in der Suchanfrage) findet "grusse" im Text', () => {
    const rows = [row({ id: '1', text: 'wir sagen grusse an alle', name: 'x' })]
    assert.equal(searchMessages(rows, 'Grüße').total, 1)
})

test('ß gilt als ss — beide Schreibweisen finden sich gegenseitig', () => {
    const strasseTrifftStrasse = searchMessages([row({ id: '1', text: 'Die Straße ist gesperrt.', name: 'x' })], 'strasse')
    const strasseFindetSs = searchMessages([row({ id: '1', text: 'die strasse ist gesperrt', name: 'x' })], 'Straße')
    assert.equal(strasseTrifftStrasse.total, 1)
    assert.equal(strasseFindetSs.total, 1)
})

// ── 4. Groß-/Kleinschreibung spielt keine Rolle ─────────────────────────────────────

test('Groß-/Kleinschreibung ist egal — weder im Text noch in der Anfrage', () => {
    const rows = [row({ id: '1', text: 'BITCOIN ist Grossartig', name: 'x' })]
    assert.equal(searchMessages(rows, 'bitcoin').total, 1)
    assert.equal(searchMessages(rows, 'BiTcOiN').total, 1)
})

// ── 5. Der Autorname zählt mit ──────────────────────────────────────────────────────

test('Autorname zaehlt mit: "relay admin" findet die Nachricht dieses Autors', () => {
    const rows = [row({ id: '1', text: 'Server ist wieder online.', name: 'Relay Admin' })]
    assert.equal(searchMessages(rows, 'relay admin').total, 1)
})

test('Autorname allein reicht — der Text muss den Begriff nicht enthalten', () => {
    const rows = [row({ id: '1', text: 'kurze Nachricht ohne Bezug', name: 'Relay Admin' })]
    assert.equal(searchMessages(rows, 'admin').total, 1)
})

test('Kombination: ein Begriff im Text, ein Begriff im Namen — UND ueber die Begriffe bleibt bestehen, ODER ueber die Felder je Begriff', () => {
    const rows = [row({ id: '1', text: 'server laeuft wieder', name: 'Relay Admin' })]
    assert.equal(searchMessages(rows, 'server admin').total, 1)
    // "server" steht nur im Text, "wien" steht in keinem der beiden Felder -> kein Treffer
    assert.equal(searchMessages(rows, 'server wien').total, 0)
})

// ── 6. Trefferlimit: hits gedeckelt, total nicht ────────────────────────────────────

test('Trefferlimit kappt die Liste auf SEARCH_RESULT_LIMIT, total zaehlt trotzdem alle', () => {
    const rows = Array.from({ length: SEARCH_RESULT_LIMIT + 7 }, (_, i) =>
        row({ id: String(i).padStart(4, '0'), text: 'bitcoin', name: 'x', created_at: i }),
    )
    const out = searchMessages(rows, 'bitcoin')
    assert.equal(out.hits.length, SEARCH_RESULT_LIMIT)
    assert.equal(out.total, SEARCH_RESULT_LIMIT + 7)
    assert.equal(out.capped, true)
})

test('unter dem Limit: capped bleibt false, hits.length === total', () => {
    const rows = [row({ id: '1', text: 'bitcoin', name: 'x' }), row({ id: '2', text: 'bitcoin', name: 'y' })]
    const out = searchMessages(rows, 'bitcoin')
    assert.equal(out.capped, false)
    assert.equal(out.hits.length, out.total)
})

test('genau am Limit: capped bleibt false', () => {
    const rows = Array.from({ length: SEARCH_RESULT_LIMIT }, (_, i) =>
        row({ id: String(i).padStart(4, '0'), text: 'bitcoin', name: 'x', created_at: i }),
    )
    const out = searchMessages(rows, 'bitcoin')
    assert.equal(out.capped, false)
    assert.equal(out.hits.length, SEARCH_RESULT_LIMIT)
})

// ── 7. Leere und entartete Eingaben ─────────────────────────────────────────────────

test('leere Eingabe: keine Treffer, searched bleibt die volle geladene Zahl, kein Wurf', () => {
    const rows = [row({ id: '1', text: 'irgendwas', name: 'x' }), row({ id: '2', text: 'anderes', name: 'y' })]
    assert.doesNotThrow(() => searchMessages(rows, ''))
    const out = searchMessages(rows, '')
    assert.equal(out.total, 0)
    assert.deepEqual(out.hits, [])
    assert.equal(out.searched, rows.length)
    assert.equal(out.capped, false)
})

test('nur Leerzeichen (inkl. Tab/Newline): verhaelt sich wie leere Eingabe', () => {
    const rows = [row({ id: '1', text: 'irgendwas', name: 'x' })]
    const out = searchMessages(rows, '   \t  \n ')
    assert.equal(out.total, 0)
})

test('nur Sonderzeichen: wirft nicht und kann trotzdem treffen', () => {
    const rows = [row({ id: '1', text: '???!!!', name: 'x' }), row({ id: '2', text: 'normaler text', name: 'y' })]
    assert.doesNotThrow(() => searchMessages(rows, '???!!!'))
    assert.equal(searchMessages(rows, '???!!!').total, 1)
})

test('sehr langer Suchstring wirft nicht', () => {
    const longQuery = 'a'.repeat(5000)
    const rows = [row({ id: '1', text: 'x'.repeat(3000), name: 'y' })]
    assert.doesNotThrow(() => searchMessages(rows, longQuery))
    assert.equal(searchMessages(rows, longQuery).total, 0)
})

test('leerer Nachrichtenbestand wirft nicht, searched ist 0', () => {
    assert.doesNotThrow(() => searchMessages([], 'irgendwas'))
    assert.deepEqual(searchMessages([], 'irgendwas'), { searched: 0, total: 0, hits: [], capped: false })
})

// ── 8. `searched` ist die GEMESSENE laufende Zahl, nicht die Konstante 300 ─────────

test('searched ist rows.length — NICHT die Konstante 300 aus storage.ts (MSG_CAP_PER_ROOM)', () => {
    const rows7 = Array.from({ length: 7 }, (_, i) => row({ id: String(i), text: 'x', name: 'y' }))
    assert.equal(searchMessages(rows7, 'irrelevant').searched, 7)

    // Ueber 300 hinaus (nachgeladener Verlauf) — waere searched hartkodiert, faele das hier auf
    const rows301 = Array.from({ length: 301 }, (_, i) => row({ id: String(i), text: 'x', name: 'y' }))
    assert.equal(searchMessages(rows301, 'irrelevant').searched, 301)
})

// ── Primitiva: foldForSearch / Index-Tabelle ────────────────────────────────────────

test('foldForSearch: Index-Tabelle zeigt fuer jede gefaltete Position auf die richtige Original-Position (ß wird zu zwei Zeichen)', () => {
    // 'Straße': S-t-r-a-ß-e, ß an Original-Index 4
    const { folded, map } = foldForSearch('Straße')
    assert.equal(folded, 'strasse')
    assert.deepEqual(map, [0, 1, 2, 3, 4, 4, 5])
})

// ── Primitiva: parseSearchTerms ─────────────────────────────────────────────────────

test('parseSearchTerms: Dubletten nach der Faltung werden entfernt', () => {
    assert.deepEqual(parseSearchTerms('Bitcoin BITCOIN bitcoin'), ['bitcoin'])
})

test('parseSearchTerms: leere/nur-Leerraum-Eingabe liefert eine leere Liste', () => {
    assert.deepEqual(parseSearchTerms(''), [])
    assert.deepEqual(parseSearchTerms('   '), [])
})

// ── Primitiva: matchesAllTerms ──────────────────────────────────────────────────────

test('matchesAllTerms: leere Terme-Liste matcht NIE ("nicht gesucht" != "alles gefunden")', () => {
    assert.equal(matchesAllTerms(['irgendein text'], []), false)
})

test('matchesAllTerms: UND ueber die Begriffe, ODER ueber die Felder', () => {
    assert.equal(matchesAllTerms(['bitcoin lightning', 'sam'], ['bitcoin', 'sam']), true)
    assert.equal(matchesAllTerms(['bitcoin lightning', 'sam'], ['bitcoin', 'wien']), false)
})

// ── Primitiva: findMatchRanges (inkl. Verschmelzen angrenzender Treffer) ───────────

test('findMatchRanges: leere Terme oder leerer Text liefern []', () => {
    assert.deepEqual(findMatchRanges('irgendwas', []), [])
    assert.deepEqual(findMatchRanges('', ['a']), [])
})

test('findMatchRanges: mehrere Vorkommen desselben Begriffs werden alle gefunden', () => {
    assert.deepEqual(findMatchRanges('bit bit bit', ['bit']), [
        [0, 3],
        [4, 7],
        [8, 11],
    ])
})

test('findMatchRanges: angrenzende Treffer verschiedener Begriffe verschmelzen zu EINEM Bereich', () => {
    // "bit" -> [0,3), "coin" -> [3,7): beruehren sich exakt an Position 3
    assert.deepEqual(findMatchRanges('Bitcoin', ['bit', 'coin']), [[0, 7]])
})

test('findMatchRanges: ein Treffer im gefalteten ß zeigt im Original auf GENAU EIN Zeichen', () => {
    assert.deepEqual(findMatchRanges('Straße', ['ss']), [[4, 5]])
})

// ── Primitiva: toSegments ───────────────────────────────────────────────────────────

test('toSegments: ohne Bereiche entsteht genau EIN Stueck', () => {
    assert.deepEqual(toSegments('hallo welt', []), [{ text: 'hallo welt', hit: false }])
})

test('toSegments: ein Bereich in der Mitte erzeugt drei Stuecke', () => {
    const segs = toSegments('vor MITTE nach', [[4, 9]])
    assert.deepEqual(segs, [
        { text: 'vor ', hit: false },
        { text: 'MITTE', hit: true },
        { text: ' nach', hit: false },
    ])
})

test('toSegments: Zeilenumbrueche/Mehrfach-Leerraum werden zu einem Leerzeichen geflacht', () => {
    assert.deepEqual(toSegments('a\n\n  b', []), [{ text: 'a b', hit: false }])
})

test('toSegments: Fenster (from/to) klemmt Bereiche auf den Ausschnitt', () => {
    const segs = toSegments('0123456789', [[0, 3], [7, 10]], 2, 8)
    assert.deepEqual(segs, [
        { text: '2', hit: true },
        { text: '3456', hit: false },
        { text: '7', hit: true },
    ])
})

// ── Primitiva: snippetSegments ──────────────────────────────────────────────────────

test('snippetSegments: kurzer Text ohne Kuerzung bekommt keine Auslassungszeichen', () => {
    const segs = snippetSegments('kurzer satz mit einem treffer', ['treffer'])
    assert.ok(!segs.some((s) => s.text === '…'))
})

test('snippetSegments: Treffer weit hinten bekommt ein FUEHRENDES Auslassungszeichen', () => {
    const text = 'x'.repeat(30) + 'treffer' + 'y'.repeat(5)
    const segs = snippetSegments(text, ['treffer'], 5, 15)
    assert.equal(segs[0]?.text, '…')
})

test('snippetSegments: ein Begriff laenger als max wird trotzdem VOLLSTAENDIG angezeigt', () => {
    const term = 'x'.repeat(20)
    const text = `vorspann ${term} nachspann`
    const segs = snippetSegments(text, [term], 2, 5)
    assert.equal(segs.find((s) => s.hit)?.text, term)
})

// ── searchMessages: Sortierung und Anzeigestuecke ───────────────────────────────────

test('searchMessages: sortiert neueste zuerst, bei Gleichstand nach id — unabhaengig von der Einfuegereihenfolge', () => {
    const rows = [
        row({ id: 'b', text: 'bitcoin', name: 'x', created_at: 100 }),
        row({ id: 'a', text: 'bitcoin', name: 'x', created_at: 100 }),
        row({ id: 'c', text: 'bitcoin', name: 'x', created_at: 200 }),
    ]
    const out = searchMessages(rows, 'bitcoin')
    assert.deepEqual(out.hits.map((h) => h.id), ['c', 'a', 'b'])
})

test('searchMessages: Treffer tragen segments (Text) UND nameSegments (Autorname), beide mit korrekter Hervorhebung', () => {
    const rows = [row({ id: '1', text: 'Bitcoin ist da', name: 'Relay Admin' })]
    const out = searchMessages(rows, 'admin')
    assert.equal(out.hits[0]?.nameSegments.some((s) => s.hit && s.text.toLowerCase() === 'admin'), true)
    // Der Text traegt den Begriff nicht -> keine Hervorhebung dort
    assert.equal(out.hits[0]?.segments.every((s) => !s.hit), true)
})
