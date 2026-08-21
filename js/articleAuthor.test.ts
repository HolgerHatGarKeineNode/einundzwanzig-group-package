/**
 * Die Autorenseite (P4) — die reinen Entscheidungen.
 *
 *   node --experimental-strip-types --test packages/einundzwanzig-group/js/articleAuthor.test.ts
 *
 * ── Der Kernbeweis dieser Phase ─────────────────────────────────────────────────────
 *
 * **Zwei Autoren mit identischem Anzeigenamen bleiben getrennt — gefiltert wird der
 * `pubkey`.** Er steht unten als eigener Block, und er trägt seine eigene
 * Plausibilitätsschranke: wenn der Fixture seine Namenskollision je verliert, WIRFT der
 * Test, statt leer grün zu werden. Ein Test, dessen Gegenstand verschwunden ist, meldet
 * sonst dasselbe wie ein bestandener.
 *
 * ── Mutationsproben (von Hand gefahren, jede bytegenau zurückgebaut) ──────────────
 *
 * | Mutation in `articleAuthor.ts`                                              | gemessen        |
 * |-----------------------------------------------------------------------------|-----------------|
 * | `artikelDesAutors` filtert über den NAMEN des Zielautors statt über `pubkey`  | **rot**, 3 Fälle |
 * | `artikelDesAutors`: `pubkey === '' ? [] :` gestrichen                        | **rot**, 1 Fall  |
 * | `nachMonat`: `.sort(…)` gestrichen                                           | **rot**, 3 Fälle |
 * | `nachMonat`: Schlüssel `jahr * 12 + monat` → `Number(\`\${jahr}.\${monat}\`)`     | **rot**, 1 Fall  |
 * | `leseNip05Antwort`: `hasOwnProperty`-Zweig gestrichen                        | **rot**, 5 Fälle |
 * | `deuteAutorParam`: `@`-Zweig hinter den `npub1`-Zweig geschoben               | **rot**, 1 Fall  |
 *
 * Nachgetragen 2026-08-21 (Nachbesserung), dieselbe Bauart:
 *
 * | Mutation                                                                     | gemessen        |
 * |------------------------------------------------------------------------------|-----------------|
 * | `NIP05_WURZEL` `'_'` → `'root'`                                              | **rot**, 2 Fälle |
 * | `istNip05Domain`: Stufe (2), der URL-Parser-Vergleich, gestrichen             | **rot**, 2 Fälle |
 * | `istNip05Domain`: Stufe (3), die Buchstaben-Bedingung, gestrichen             | **rot**, 2 Fälle |
 * | `liesBegrenzt`: Zählung aus der Schleife hinter das vollständige Lesen gezogen | **rot**, 1 Fall  |
 *
 * Die letzte ist der Beweis, dass die Größengrenze jetzt den SPEICHER schützt und nicht
 * nur den Parser: die mutierte Fassung las den unendlichen Strom weiter, bis V8 mit
 * `RangeError: Invalid string length` aufgab — also genau bis an die Grenze, hinter der
 * in Chromium der Tab stirbt. Vor der Nachbesserung war das der Produktivzustand.
 *
 * `NIP05_WURZEL` ist der P2-Fall (`DEFAULT_SPACES_TAB`) noch einmal: bis zur
 * Nachbesserung prüfte der einzige berührende Fall `name: NIP05_WURZEL` — Symbol gegen
 * Symbol. Die Konstante auf `'root'` gesetzt lief die gesamte Suite grün durch, während
 * jede Wurzel-Adresse still in „Diese Domain kennt den Namen nicht" endete.
 *
 * Die erste ist die tragende: sie ist genau der Fehler, den der Kernbeweis abfängt. Sie
 * setzt `zeilen.find(z => z.pubkey === pubkey)` und filtert danach auf dessen
 * `authorName` — die realistische Form des Fehlers, nicht ein Vergleich, der ohnehin
 * nichts trifft. Für den Compiler ist sie zulässig: {@link artikelDesAutors} verlangt
 * nur `{pubkey}`, ein `authorName` daneben stört ihn nicht.
 *
 * Die vierte prüft die Ordnung ÜBER die Jahresgrenze: `2026-01` muss vor `2025-12`
 * stehen, und ein zusammengesetzter Schlüssel bekäme genau das falsch.
 *
 * **Zwei dieser Proben haben beim ersten Lauf ÜBERLEBT** (fail-closed und `.sort`) — die
 * Tests waren so gebaut, dass die mutierte Fassung zufällig dasselbe lieferte. Beide
 * Testfälle sind daraufhin geschärft worden, und was sie jetzt trägt, steht bei ihnen als
 * Kommentar. Die Zahlen oben sind die Messung NACH dieser Schärfung.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
    AUTOR_PARAM_MAX,
    NIP05_MAX_ZEICHEN,
    NIP05_TIMEOUT_MS,
    NIP05_WURZEL,
    artikelDesAutors,
    aufloesenNip05,
    autorGrunddaten,
    deuteAutorParam,
    holeNip05Json,
    leseNip05Antwort,
    liesBegrenzt,
    lokalerMonat,
    lokalesJahr,
    nachMonat,
    nip05Url,
} from './articleAuthor.ts'
import { buildArticleRow, type ArticleRow } from './longform.ts'

// ── Werkzeug ───────────────────────────────────────────────────────────────────────

/** Zwei echte, verschiedene Hex-Pubkeys aus dem eingefrorenen Formen-Satz. */
const AUTOR_A = '8d902379f20374504b21103188da3112c55a9045e48811e9c5f03bdfedeedace'
const AUTOR_B = 'f240be2b684f85cc81566f2081386af81d7427ea86250c8bde6b7a8500c761ba'

/** 15. Juni 2024, 12:00 UTC. */
const MITTE_2024 = Date.UTC(2024, 5, 15, 12) / 1000

/**
 * Eine Zeile über den ECHTEN Bauweg (`buildArticleRow`) statt als Handentwurf.
 *
 * Ein hingeschriebenes Objektliteral bliebe grün, wenn `ArticleRow` seine Felder
 * umbenennt — der Test prüfte dann eine Form, die es nicht mehr gibt.
 */
const zeile = (pubkey: string, authorName: string, publishedAt: number, id: string): ArticleRow =>
    buildArticleRow(
        {
            id,
            pubkey,
            content: 'Inhalt.',
            created_at: publishedAt,
            tags: [
                ['d', id],
                ['title', `Titel ${id}`],
                ['published_at', String(publishedAt)],
            ],
        },
        {
            authorName,
            authorPicture: '',
            relays: [],
            formatDate: () => 'irgendwann',
            readingMinutes: 1,
        },
    )

// ── DER KERNBEWEIS ─────────────────────────────────────────────────────────────────

test('KERNBEWEIS: zwei Autoren mit IDENTISCHEM Anzeigenamen bleiben getrennt — gefiltert wird der pubkey', () => {
    const NAME = 'Satoshi'
    const bestand = [
        zeile(AUTOR_A, NAME, MITTE_2024, 'a1'),
        zeile(AUTOR_B, NAME, MITTE_2024, 'b1'),
        zeile(AUTOR_A, NAME, MITTE_2024 - 86_400, 'a2'),
        zeile(AUTOR_B, NAME, MITTE_2024 - 86_400, 'b2'),
    ]

    // **Die Schranke, und sie steht VOR der eigentlichen Zusage.** Verliert der Fixture
    // seine Namenskollision, misst dieser Test nichts mehr — und meldete trotzdem grün.
    const nameTreffer = bestand.filter((z) => z.authorName === NAME).length
    assert.equal(
        nameTreffer,
        4,
        'Der Fixture trägt keine Namenskollision mehr — der Kernbeweis misst dann nichts. ' +
            'Beide Autoren müssen denselben authorName haben, sonst ist ein Namensfilter nicht von einem pubkey-Filter zu unterscheiden.',
    )

    const seiteA = artikelDesAutors(bestand, AUTOR_A)
    const seiteB = artikelDesAutors(bestand, AUTOR_B)

    assert.equal(seiteA.length, 2)
    assert.equal(seiteB.length, 2)
    assert.deepEqual(
        seiteA.map((z) => z.id),
        ['a1', 'a2'],
    )
    assert.deepEqual(
        seiteB.map((z) => z.id),
        ['b1', 'b2'],
    )
    // Kein Artikel des einen darf auf der Seite des anderen stehen.
    assert.ok(seiteA.every((z) => z.pubkey === AUTOR_A))
    assert.ok(seiteB.every((z) => z.pubkey === AUTOR_B))
    // Und: die beiden Seiten sind DISJUNKT. Ein Namensfilter lieferte hier zweimal
    // dieselben vier Zeilen — genau das ist der Fehler, den diese Zeile ausschließt.
    assert.equal(seiteA.filter((z) => seiteB.includes(z)).length, 0)
})

test('artikelDesAutors ist fail-closed: ein leerer pubkey waehlt NICHTS aus, auch wenn eine Zeile selbst keinen traegt', () => {
    // **Die dritte Zeile ist der ganze Test.** Ohne sie liefert auch die ungeschützte
    // Fassung (`zeilen.filter(z => z.pubkey === '')`) eine leere Liste — der Test wäre
    // grün und die Zusage ungeprüft; genau so ist er beim ersten Anlauf durch die
    // Mutationsprobe gefallen. Eine Zeile OHNE Adresse ist der einzige Fall, in dem sich
    // „nichts auswählen" von „zufällig nichts gefunden" unterscheiden lässt.
    const bestand = [
        zeile(AUTOR_A, 'A', MITTE_2024, 'a1'),
        zeile(AUTOR_B, 'B', MITTE_2024, 'b1'),
        zeile('', 'Ohne Adresse', MITTE_2024, 'leer'),
    ]
    assert.equal(bestand.filter((z) => z.pubkey === '').length, 1, 'Ohne eine adresslose Zeile misst dieser Test nichts.')
    assert.deepEqual(artikelDesAutors(bestand, ''), [])
})

test('artikelDesAutors laesst die Eingabe unangetastet und gibt ein NEUES Array zurueck', () => {
    const bestand = [zeile(AUTOR_A, 'A', MITTE_2024, 'a1')]
    const treffer = artikelDesAutors(bestand, AUTOR_A)
    assert.notEqual(treffer, bestand)
    assert.equal(bestand.length, 1)
})

// ── Die beiden Enden des Bestands: ein Artikel und fuenfundfuenfzig ────────────────

test('EIN Artikel: Anzahl 1, eine einzige Monatsmarke — die Seite traegt den kleinsten Autor', () => {
    // Sechs der zwölf Autoren des Bestands haben genau einen Artikel.
    const bestand = [zeile(AUTOR_A, 'A', MITTE_2024, 'a1'), zeile(AUTOR_B, 'B', MITTE_2024, 'b1')]
    const eigene = artikelDesAutors(bestand, AUTOR_A)

    assert.equal(eigene.length, 1)
    const grund = autorGrunddaten(eigene, () => 2024)
    assert.equal(grund.anzahl, 1)
    assert.equal(grund.seitJahr, 2024)
    const gruppen = nachMonat(eigene, () => ({ jahr: 2024, monat: 6 }))
    assert.equal(gruppen.length, 1)
    assert.equal(gruppen[0]!.artikel.length, 1)
    assert.equal(gruppen[0]!.jahr, 2024)
    assert.equal(gruppen[0]!.monat, 6)
    // Der Formatierer-Eingang stammt aus DIESER Gruppe.
    assert.equal(gruppen[0]!.stempel, MITTE_2024)
})

test('55 Artikel ueber fuenf Monate: alle 55 bleiben drin, die Gruppen stehen absteigend', () => {
    // **Die Verteilung ist die des echten Vielschreibers**, gemessen am 2026-08-21:
    // 2026-02 (1) · 2026-05 (1) · 2026-06 (28) · 2026-07 (17) · 2026-08 (8) = 55.
    // Genau dieser Autor hätte nach JAHR eine einzige Marke bekommen — er ist der Grund,
    // warum die Gliederung monatlich ist (Messtabelle bei `nachMonat`).
    const verteilung: [number, number][] = [
        [2, 1],
        [5, 1],
        [6, 28],
        [7, 17],
        [8, 8],
    ]
    const bestand: ArticleRow[] = []
    let i = 0
    for (const [monat, wieviele] of verteilung) {
        for (let k = 0; k < wieviele; k++) {
            // `publishedAt` kodiert hier den Monat, damit `monatVon` ihn zurückrechnen kann.
            bestand.push(zeile(AUTOR_A, 'Vielschreiber', monat, `a${i++}`))
        }
    }
    assert.equal(bestand.length, 55, 'Die Verteilung muss 55 Artikel ergeben, sonst misst dieser Test den falschen Autor.')
    bestand.push(zeile(AUTOR_B, 'Vielschreiber', 6, 'fremd'))

    const eigene = artikelDesAutors(bestand, AUTOR_A)
    assert.equal(eigene.length, 55)

    const gruppen = nachMonat(eigene, (ts) => ({ jahr: 2026, monat: ts }))
    assert.equal(gruppen.length, 5)
    assert.deepEqual(
        gruppen.map((g) => g.monat),
        [8, 7, 6, 5, 2],
    )
    assert.deepEqual(
        gruppen.map((g) => g.artikel.length),
        [8, 17, 28, 1, 1],
    )
    // Kein Artikel geht beim Gliedern verloren oder taucht doppelt auf.
    assert.equal(
        gruppen.reduce((summe, g) => summe + g.artikel.length, 0),
        55,
    )
    assert.equal(autorGrunddaten(eigene, () => 2026).seitJahr, 2026)
})

// ── Monatsgruppen ──────────────────────────────────────────────────────────────────

test('nachMonat gliedert auch UNSORTIERTE Eingabe zu genau einem Eintrag je Monat', () => {
    // Zwei Fehler auf einmal, und beide brauchen DIESE Reihenfolge:
    //  · eine sequenzielle Gruppierung gäbe zweimal „2024" aus;
    //  · eine Gruppierung ohne abschließendes Sortieren gäbe die Jahre in der
    //    Eintreffreihenfolge aus, also 2022 zuerst.
    // Eine bereits absteigende Eingabe könnte keinen von beiden zeigen — der erste
    // Entwurf dieses Tests tat genau das und ließ die Mutation „`.sort` gestrichen"
    // durch.
    const monate = [3, 5, 4, 5, 4]
    const zeilen = monate.map((monat, i) => zeile(AUTOR_A, 'A', monat, `z${i}`))
    const gruppen = nachMonat(zeilen, (ts) => ({ jahr: 2026, monat: ts }))

    assert.deepEqual(
        gruppen.map((g) => g.monat),
        [5, 4, 3],
    )
    assert.deepEqual(
        gruppen.map((g) => g.artikel.length),
        [2, 2, 1],
    )
})

test('nachMonat ordnet ueber die JAHRESGRENZE richtig — Dezember vor Januar', () => {
    // Der Schlüssel ist `jahr * 12 + monat` und damit monoton. Ein zusammengesetzter
    // String wäre es nicht: `'2026-9'` stünde lexikografisch VOR `'2026-10'`.
    const monate: Record<string, { jahr: number; monat: number }> = {
        1: { jahr: 2026, monat: 1 },
        2: { jahr: 2025, monat: 12 },
        3: { jahr: 2026, monat: 9 },
        4: { jahr: 2026, monat: 10 },
    }
    const zeilen = [1, 2, 3, 4].map((n) => zeile(AUTOR_A, 'A', n, `z${n}`))
    const gruppen = nachMonat(zeilen, (ts) => monate[String(ts)]!)

    assert.deepEqual(
        gruppen.map((g) => `${g.jahr}-${String(g.monat).padStart(2, '0')}`),
        ['2026-10', '2026-09', '2026-01', '2025-12'],
    )
})

test('nachMonat haelt die Eingabereihenfolge INNERHALB einer Gruppe', () => {
    const zeilen = [zeile(AUTOR_A, 'A', 6, 'erst'), zeile(AUTOR_A, 'A', 6, 'dann')]
    const [gruppe] = nachMonat(zeilen, (ts) => ({ jahr: 2026, monat: ts }))
    assert.deepEqual(
        gruppe!.artikel.map((z) => z.id),
        ['erst', 'dann'],
    )
})

test('nachMonat auf leerer Liste: keine Gruppe, kein Wurf', () => {
    assert.deepEqual(nachMonat([]), [])
})

test('lokalerMonat liefert 1-basierte Monate — nicht die 0-Basis von Date.getMonth()', () => {
    // 15. Juni 12:00 UTC: für jede Zone derselbe Kalendertag (siehe `lokalesJahr`).
    assert.deepEqual(lokalerMonat(MITTE_2024), { jahr: 2024, monat: 6 })
})

test('lokalesJahr liest das Jahr LOKAL — an einem Zeitpunkt, den keine Zone der Welt verschiebt', () => {
    // 15. Juni 12:00 UTC: selbst bei −12 h und +14 h derselbe Kalendertag.
    assert.equal(lokalesJahr(MITTE_2024), 2024)
})

// ── Grunddaten ─────────────────────────────────────────────────────────────────────

test('autorGrunddaten nimmt das ÄLTESTE publishedAt, nicht das letzte Element', () => {
    // Absichtlich aufsteigend sortiert — die Funktion darf sich auf keine Ordnung verlassen.
    const zeilen = [zeile(AUTOR_A, 'A', 2019, 'alt'), zeile(AUTOR_A, 'A', 2024, 'neu')]
    assert.equal(autorGrunddaten(zeilen, (ts) => ts).seitJahr, 2019)
})

test('autorGrunddaten ohne Artikel: Anzahl 0 und seitJahr 0 — „keine Angabe", nicht 1970', () => {
    assert.deepEqual(autorGrunddaten([]), { anzahl: 0, seitJahr: 0 })
})

// ── Die Adresse deuten: npub ───────────────────────────────────────────────────────

test('npub wird ohne Netz zu ihrem Hex-Pubkey', () => {
    // npub des Autors A, mit nostr-tools erzeugt und hier als LITERAL festgehalten —
    // gegen `npubEncode(AUTOR_A)` zu prüfen hieße, die Bibliothek gegen sich selbst zu halten.
    const ziel = deuteAutorParam('npub13kgzx70jqd69qjepzqcc3k33ztz44yz9ujypr6w97qaalm0wmt8q9g953j')
    assert.equal(ziel.art, 'pubkey')
    assert.equal(ziel.art === 'pubkey' ? ziel.pubkey : '', AUTOR_A)
})

test('FEHLZUSTAND 2 — eine npub mit kaputter Pruefsumme: Grund „npub", nicht „format"', () => {
    const ziel = deuteAutorParam('npub13kgzx70jqd69qjepzqcc3k33ztz44yz9ujypr6w97qaalm0wmt8q9g953k')
    assert.deepEqual(ziel, { art: 'ungueltig', grund: 'npub' })
})

test('FEHLZUSTAND 2 — abgeschnittene npub: ebenfalls „npub"', () => {
    assert.deepEqual(deuteAutorParam('npub13kgzx70jqd69qjepzqcc'), { art: 'ungueltig', grund: 'npub' })
})

test('FEHLZUSTAND 1 — eine ANDERE bech32-Kennung ist kein npub-Problem, sondern ein Formatproblem', () => {
    // Ein `nevent`/`naddr`/`nsec` trägt kein `npub1`-Präfix und fällt deshalb nach `format`.
    // Der Unterschied ist nicht kosmetisch: der `format`-Satz nennt die Eingabe NICHT.
    assert.deepEqual(deuteAutorParam('nsec1vl029mgpspedva04g90vltkh6fvh240zqtv9k0t9af8935ke9laqsnlfe5'), {
        art: 'ungueltig',
        grund: 'format',
    })
})

test('FEHLZUSTAND 1 — Kauderwelsch ohne Punkt und ohne @', () => {
    assert.deepEqual(deuteAutorParam('satoshi'), { art: 'ungueltig', grund: 'format' })
})

test('FEHLZUSTAND 1 — leerer und nur-Leerraum-Parameter', () => {
    assert.deepEqual(deuteAutorParam(''), { art: 'ungueltig', grund: 'format' })
    assert.deepEqual(deuteAutorParam('   '), { art: 'ungueltig', grund: 'format' })
})

test('AUTOR_PARAM_MAX ist 256 — und ein Zeichen darueber faellt durch', () => {
    assert.equal(AUTOR_PARAM_MAX, 256)
    const gerade = `${'a'.repeat(246)}@ab.de`
    assert.equal(gerade.length, 252)
    assert.equal(deuteAutorParam(gerade).art, 'nip05')
    assert.deepEqual(deuteAutorParam(`${'a'.repeat(251)}@ab.de`), { art: 'ungueltig', grund: 'format' })
})

// ── Die Adresse deuten: NIP-05 ─────────────────────────────────────────────────────

test('name@domain.tld wird zum NIP-05-Ziel, die Domain kleingeschrieben', () => {
    assert.deepEqual(deuteAutorParam('Alice@Example.COM'), { art: 'nip05', name: 'Alice', domain: 'example.com' })
})

test('NIP05_WURZEL ist der Unterstrich — und zwar als LITERAL, nicht als Symbol', () => {
    // **Warum diese Zeile hier steht.** Bis 2026-08-21 prüfte der Test unten
    // `name: NIP05_WURZEL` — Symbol gegen Symbol. Gemessen: die Konstante auf `'root'`
    // gesetzt, danach lief die gesamte Suite (1324 Fälle) grün durch und `typecheck`
    // meldete null. Die Konstante ist aber verhaltenstragend: die nackte Domain fragte
    // dann `?name=root` ab, und der Wurzel-Adressweg endete für JEDE Domain still in
    // „Diese Domain kennt den Namen nicht".
    //
    // NIP-05 schreibt den Unterstrich vor („If the user's name is `_`…"), und welshmans
    // `displayNip05` zeigt `_@example.com` als „example.com" an — genau die Form, die
    // Menschen kopieren und in die URL setzen.
    assert.equal(NIP05_WURZEL, '_')
    // Und der Wert kommt auch dort an, wo er wirkt: in der Abfrage-URL.
    assert.equal(
        nip05Url(deuteAutorParam('einundzwanzig.space') as { name: string; domain: string }),
        'https://einundzwanzig.space/.well-known/nostr.json?name=_',
    )
})

test('die nackte Domain ist die WURZEL-Adresse `_@domain` — die Form, die auf dem Bildschirm steht', () => {
    // `displayNip05('_@einundzwanzig.space')` zeigt „einundzwanzig.space"; wer das kopiert,
    // landet hier. Der Name steht als LITERAL da (siehe den Test darüber).
    assert.deepEqual(deuteAutorParam('einundzwanzig.space'), {
        art: 'nip05',
        name: '_',
        domain: 'einundzwanzig.space',
    })
    // Dieselbe Zusage noch einmal über die Konstante — damit ein Umbenennen der Konstante
    // hier auffällt und nicht nur ein Ändern ihres WERTES.
    assert.equal(NIP05_WURZEL, '_')
})

test('das @ entscheidet VOR dem npub1-Praefix — sonst bekaeme eine NIP-05-Adresse den npub-Satz', () => {
    assert.deepEqual(deuteAutorParam('npub1@example.com'), { art: 'nip05', name: 'npub1', domain: 'example.com' })
})

test('FEHLZUSTAND 1 — eine leere Haelfte ist ebenfalls kein Ziel', () => {
    // Die vollständige Domain-Liste steht weiter unten; hier nur die beiden Fälle, in
    // denen eine der beiden Hälften ganz fehlt.
    assert.deepEqual(deuteAutorParam('@example.com'), { art: 'ungueltig', grund: 'format' })
    assert.deepEqual(deuteAutorParam('a@'), { art: 'ungueltig', grund: 'format' })
})

// ── WOHIN der Browser des Lesers anklopfen darf ────────────────────────────────────
//
// Die Domain kommt aus der URL. Ein Link `/articles/autor/x@irgendwo.tld` genügt, damit
// jeder, der ihn öffnet, dort anklopft — mit seiner IP, seinem User-Agent, zu einem
// Zeitpunkt, den ein Dritter gewählt hat. **Der Abruf läuft im BROWSER, nicht im Server**
// (`holeNip05Json` steht in der Insel; die Blade-Komponente deutet den Parameter
// ausdrücklich nicht — es ist also kein SSRF, aber es ist ein Abfluss.)
//
// Die Fälle unten sind vollständig gemessen (2026-08-21), auch die, die DURCHGEHEN. Ein
// Test, der nur die abgewiesenen aufzählt, verschweigt genau die Hälfte, auf die es
// ankommt.

test('ABGEWIESEN: alles, was kein Domainname ist — Loopback, privates Netz, Port, Zugangsdaten, Pfad, Nicht-ASCII', () => {
    const abgewiesen = [
        // Kein Punkt.
        'x@localhost',
        // **Kanonische IPv4-Literale.** Sie kommen über die reine Form durch UND über den
        // URL-Parser-Vergleich: `new URL('https://127.0.0.1/').hostname` ist wieder
        // `127.0.0.1`, der Parser hat nichts umzuschreiben (gemessen 2026-08-21).
        // Abgewiesen werden sie allein von Stufe (3), „das letzte Label trägt einen
        // Buchstaben" — die Mutationsprobe dazu steht unten.
        'x@127.0.0.1',
        'x@10.0.0.1',
        'x@192.168.1.1',
        'x@0.0.0.0',
        // Die Metadaten-Adresse jeder Cloud. Im Browser des Lesers zielt sie auf SEIN Netz.
        'x@169.254.169.254',
        // Hex-Label mit Ziffern-TLD — dieselbe Klasse.
        'x@0x7f.1',
        // **Die Hex- und Oktalformen. Sie sind der Grund, warum die Buchstaben-Bedingung
        // allein NICHT reichte:** `0x1` trägt ein `x`, kommt also durch jede Prüfung auf
        // „das letzte Label hat einen Buchstaben". Alle sechs wurden am Bestandscode
        // gemessen (2026-08-21) und gingen durch; drei davon kamen in Chromium 151 an
        // einem Loopback-Server tatsächlich an, mit `Host: 127.0.0.1`. Abgewiesen werden
        // sie erst von Stufe (2), dem URL-Parser-Vergleich.
        'x@0x7f.0x1',
        'x@0x7f.0x0.0x0.0x1',
        // Oktal und Hex gemischt — dieselbe Adresse, dritte Schreibweise.
        'x@0177.0.0.0x1',
        'x@0300.0250.0.1',
        // Die Metadaten-Adresse jeder Cloud, hexadezimal.
        'x@0xa9.0xfe.0xa9.0xfe',
        'x@0xc0.0xa8.0x1.0x1',
        'x@0xa.0x0.0x0.0x1',
        // Dieselbe Adresse dezimal: fällt schon an der Punkt-Pflicht.
        'x@2130706433',
        // Klammer-Literal, Port, Zugangsdaten, Pfad.
        'x@[::1]',
        'x@evil.tld:8080',
        'user:pw@example.com',
        'x@example.com/pfad',
        // Kaputte Labelstruktur.
        'x@a..b.de',
        'x@.example.com',
        'x@example.com.',
        'x@-example.com',
        'x@example-.com',
        // Leerraum.
        'x@exa mple.com',
    ]

    for (const kaputt of abgewiesen) {
        assert.deepEqual(
            deuteAutorParam(kaputt),
            { art: 'ungueltig', grund: 'format' },
            `„${kaputt}" haette als Format-Fehler enden muessen — sonst klopft der Browser des Lesers dort an`,
        )
    }
})

test('ABGEWIESEN: ein Unicode-Homoglyph in „example.com" ist keine Domain', () => {
    // Kyrillisches „e" (U+0435) und „x" (U+0445). Sie liegen nicht in `a-z0-9-` und fallen
    // damit an der Form — nicht, weil irgendwo eine Homoglyph-Liste gepflegt würde.
    const homoglyph = 'x@ехample.com'
    assert.notEqual(homoglyph, 'x@example.com', 'Der Fixture ist keine Homoglyph-Adresse mehr — dieser Test misst dann nichts.')
    assert.deepEqual(deuteAutorParam(homoglyph), { art: 'ungueltig', grund: 'format' })
})

test('DURCH: Punycode geht bewusst durch — es IST die ASCII-Form einer internationalen Domain', () => {
    // Sie abzuweisen hieße, NIP-05 für jeden nicht-lateinischen Handle abzuschalten.
    assert.deepEqual(deuteAutorParam('x@xn--bcher-kva.example'), {
        art: 'nip05',
        name: 'x',
        domain: 'xn--bcher-kva.example',
    })
})

test('DURCH und BENANNT OFFEN: `.local`, `.internal` und jeder oeffentliche Name mit privater IP', () => {
    // **Ein benannter Rest, keine Lücke, die noch jemand stopfen soll.** `drucker.local`
    // (mDNS, RFC 6762) und `intern.internal` (ICANN-Privatnamensraum) kommen durch und
    // zielen ins LAN des Lesers.
    assert.equal(deuteAutorParam('x@drucker.local').art, 'nip05')
    assert.equal(deuteAutorParam('x@intern.internal').art, 'nip05')

    // **Eine TLD-Sperrliste wäre KEIN Fix — und der Grund ist nicht, dass Listen
    // veralten.** Er steht in der Zeile darunter: `intern.example.com` ist ein ganz
    // gewöhnlicher öffentlicher Name in einer öffentlichen TLD. Zeigt sein A-Record auf
    // `192.168.1.1`, landet die Anfrage im LAN des Lesers — und keine Namensliste der
    // Welt sieht das, weil am NAMEN nichts davon steht. Entscheidbar ist es nur an der
    // Adressfamilie, die die Auflösung liefert, und die sieht dieser Code nie; sie prüft
    // der Browser (Local Network Access).
    //
    // Deshalb steht die Zeile hier: sie hält fest, dass eine Liste diesen Fall NICHT
    // fängt. Wer je eine bauen will, wird an ihr rot — und muss den Fall erklären.
    assert.equal(deuteAutorParam('x@intern.example.com').art, 'nip05')
})

// ── Die drei Stufen von `istNip05Domain`, jede einzeln nachgewiesen ───────────────
//
// Sie schließen VERSCHIEDENE Dinge, und genau das war der Befund vom 2026-08-21: die
// Buchstaben-Bedingung allein ließ sechs Schreibweisen durch, der URL-Vergleich allein
// ließe sechs andere durch. Die Tests unten sind so gebaut, dass das Streichen JEDER
// einzelnen Stufe rot macht — und dass man an der Fehlermeldung sieht, welche fehlt.

test('STUFE 2 — der URL-Parser darf die Eingabe nicht umschreiben: Hex, Oktal und gemischt fallen', () => {
    // Der Mechanismus, ausgeschrieben: `hostname` ist genau das, was der `fetch` gleich
    // als Host nimmt. Weicht es von der Eingabe ab, hat der Parser sie gedeutet — und
    // dann ist die Eingabe nicht der Name, für den der Leser sie hält.
    const umgeschrieben: Array<[string, string]> = [
        ['0x7f.0x1', '127.0.0.1'],
        ['0x7f.0x0.0x0.0x1', '127.0.0.1'],
        ['0177.0.0.0x1', '127.0.0.1'],
        ['0300.0250.0.1', '192.168.0.1'],
        ['0xa9.0xfe.0xa9.0xfe', '169.254.169.254'],
        ['0xc0.0xa8.0x1.0x1', '192.168.1.1'],
        ['0xa.0x0.0x0.0x1', '10.0.0.1'],
    ]
    for (const [eingabe, ziel] of umgeschrieben) {
        // **Die Schranke zuerst.** Deutet die Laufzeit diese Form eines Tages NICHT mehr
        // als IP-Adresse, misst der Fall darunter nichts mehr — und meldete trotzdem grün.
        assert.equal(
            new URL(`https://${eingabe}/`).hostname,
            ziel,
            `„${eingabe}" wird von dieser Laufzeit nicht mehr zu ${ziel} — der Fall misst nichts mehr.`,
        )
        assert.deepEqual(
            deuteAutorParam(`x@${eingabe}`),
            { art: 'ungueltig', grund: 'format' },
            `„${eingabe}" ist ${ziel} in anderer Schreibweise und muss an Stufe (2) fallen.`,
        )
    }
})

test('STUFE 3 — das kanonische IPv4-Literal ist ein FIXPUNKT des Parsers und braucht die Buchstaben-Bedingung', () => {
    // **Der Grund, warum Stufe (3) nicht ersatzlos entfallen konnte.** Der naheliegende
    // Schluss „der URL-Vergleich erledigt alle IP-Literale" ist gemessen falsch: bei der
    // kanonischen Punktschreibweise hat der Parser nichts umzuschreiben, `hostname` ist
    // identisch zur Eingabe, und Stufe (2) schweigt.
    for (const ip of ['127.0.0.1', '10.0.0.1', '192.168.1.1', '169.254.169.254', '0.0.0.0', '1.1.1.1']) {
        assert.equal(
            new URL(`https://${ip}/`).hostname,
            ip,
            `„${ip}" wird vom Parser umgeschrieben — dann prüft dieser Test nicht mehr, was er soll.`,
        )
        assert.deepEqual(
            deuteAutorParam(`x@${ip}`),
            { art: 'ungueltig', grund: 'format' },
            `„${ip}" kommt an Stufe (2) vorbei und muss an Stufe (3) fallen.`,
        )
    }
})

test('Die drei Stufen kosten keine echte Adresse — gewoehnliche Namen und Punycode bleiben unveraendert', () => {
    // Die Gegenprobe zu den beiden Tests darüber: eine Prüfung, die alles abweist, wäre
    // ebenfalls grün. Nach Stufe (1) besteht die Eingabe nur noch aus `a-z0-9-.` in
    // sauberer Labelstruktur — daran hat der Parser außer der Zahlendeutung nichts zu tun.
    for (const gut of ['example.com', 'sub.example.com', 'xn--bcher-kva.example', 'a1.b2.tld', 'einundzwanzig.space']) {
        assert.equal(new URL(`https://${gut}/`).hostname, gut, `Der Parser schreibt „${gut}" um — Fixture kaputt.`)
        assert.deepEqual(
            deuteAutorParam(`x@${gut}`),
            { art: 'nip05', name: 'x', domain: gut },
            `„${gut}" ist eine gewöhnliche Domain und darf nicht abgewiesen werden.`,
        )
    }
})

test('DURCH: gewöhnliche Domains, Subdomains und Großschreibung', () => {
    assert.deepEqual(deuteAutorParam('x@sub.example.com'), { art: 'nip05', name: 'x', domain: 'sub.example.com' })
    assert.deepEqual(deuteAutorParam('x@EXAMPLE.COM'), { art: 'nip05', name: 'x', domain: 'example.com' })
})

test('die Abfrage-URL ist https, well-known und ein KODIERTER Name', () => {
    assert.equal(
        nip05Url({ name: 'a b', domain: 'example.com' }),
        'https://example.com/.well-known/nostr.json?name=a%20b',
    )
})

// ── Die Antwort deuten: FEHLZUSTAND 3 gegen FEHLZUSTAND 4 ─────────────────────────

test('gueltige nostr.json mit Eintrag: gefunden', () => {
    const ergebnis = leseNip05Antwort({ names: { alice: AUTOR_A } }, 'alice')
    assert.deepEqual(ergebnis, { art: 'gefunden', pubkey: AUTOR_A })
})

test('FEHLZUSTAND 3 — gueltige nostr.json OHNE diesen Namen: „unbekannt", nicht „fehlgeschlagen"', () => {
    assert.deepEqual(leseNip05Antwort({ names: { bob: AUTOR_B } }, 'alice'), { art: 'unbekannt' })
})

test('FEHLZUSTAND 3 — leere names-Tabelle ist ebenfalls eine gueltige Antwort', () => {
    assert.deepEqual(leseNip05Antwort({ names: {} }, 'alice'), { art: 'unbekannt' })
})

test('FEHLZUSTAND 3 — zeichengenau: „Alice" ist nicht „alice" (dieselbe Regel wie in welshman)', () => {
    assert.deepEqual(leseNip05Antwort({ names: { alice: AUTOR_A } }, 'Alice'), { art: 'unbekannt' })
})

test('FEHLZUSTAND 4 — keine nostr.json: kein Objekt, kein names, falscher Typ', () => {
    assert.deepEqual(leseNip05Antwort(null, 'alice'), { art: 'fehlgeschlagen' })
    assert.deepEqual(leseNip05Antwort('<html>404</html>', 'alice'), { art: 'fehlgeschlagen' })
    assert.deepEqual(leseNip05Antwort({}, 'alice'), { art: 'fehlgeschlagen' })
    assert.deepEqual(leseNip05Antwort({ names: 'nope' }, 'alice'), { art: 'fehlgeschlagen' })
})

test('FEHLZUSTAND 4 — Eintrag da, aber kein Hex-Pubkey: „fehlgeschlagen", denn die Domain KENNT den Namen', () => {
    assert.deepEqual(leseNip05Antwort({ names: { alice: 'npub1…' } }, 'alice'), { art: 'fehlgeschlagen' })
    assert.deepEqual(leseNip05Antwort({ names: { alice: 42 } }, 'alice'), { art: 'fehlgeschlagen' })
    assert.deepEqual(leseNip05Antwort({ names: { alice: AUTOR_A.toUpperCase() } }, 'alice'), {
        art: 'fehlgeschlagen',
    })
})

test('ein geerbter Schluessel aus dem Prototyp zaehlt NICHT als Eintrag', () => {
    // `names.toString` gibt es auf jedem Objekt. Ohne `hasOwnProperty` fände ein
    // `/articles/autor/toString@example.com` dort eine Funktion und meldete „fehlgeschlagen"
    // statt „unbekannt" — ein Fehlzustand, der die falsche Ursache nennt.
    assert.deepEqual(leseNip05Antwort({ names: {} }, 'toString'), { art: 'unbekannt' })
})

// ── Die Aufloesung als Ganzes ──────────────────────────────────────────────────────

test('aufloesenNip05 ruft GENAU die gebaute URL und reicht die Antwort durch', async () => {
    const gerufen: string[] = []
    const ergebnis = await aufloesenNip05({ name: 'alice', domain: 'example.com' }, async (url) => {
        gerufen.push(url)

        return { names: { alice: AUTOR_A } }
    })

    assert.deepEqual(gerufen, ['https://example.com/.well-known/nostr.json?name=alice'])
    assert.deepEqual(ergebnis, { art: 'gefunden', pubkey: AUTOR_A })
})

test('FEHLZUSTAND 4 — jeder Wurf der Abfrage wird zu „fehlgeschlagen", nicht zu einer Ablehnung', async () => {
    const ergebnis = await aufloesenNip05({ name: 'alice', domain: 'example.com' }, async () => {
        throw new Error('ERR_NAME_NOT_RESOLVED')
    })
    assert.deepEqual(ergebnis, { art: 'fehlgeschlagen' })
})

test('die vier Fehlzustaende sind vier VERSCHIEDENE Werte — sonst traegt die Flaeche vier gleiche Saetze', async () => {
    const gruende = new Set<string>()
    gruende.add((deuteAutorParam('satoshi') as { grund: string }).grund)
    gruende.add((deuteAutorParam('npub1kaputt') as { grund: string }).grund)
    gruende.add(leseNip05Antwort({ names: {} }, 'a').art === 'unbekannt' ? 'nip05-unbekannt' : '?')
    gruende.add(
        (await aufloesenNip05({ name: 'a', domain: 'b.de' }, async () => {
            throw new Error('weg')
        })).art === 'fehlgeschlagen'
            ? 'nip05-fehlgeschlagen'
            : '?',
    )

    assert.deepEqual([...gruende].sort(), ['format', 'nip05-fehlgeschlagen', 'nip05-unbekannt', 'npub'])
})

// ── Die beiden Grenzen der Abfrage ─────────────────────────────────────────────────

test('NIP05_TIMEOUT_MS ist 8000 — eine Frist, die im Quelltext steht und nicht in einer Gewohnheit', () => {
    assert.equal(NIP05_TIMEOUT_MS, 8_000)
})

test('NIP05_MAX_ZEICHEN ist 1000000 — die Grenze, ab der eine fremde Antwort nicht mehr GELESEN wird', () => {
    assert.equal(NIP05_MAX_ZEICHEN, 1_000_000)
})

// ── Und dass die beiden Grenzen auch VERDRAHTET sind ──────────────────────────────
//
// Zwei Konstanten mit Literal-Zeile beweisen nur, dass die Zahlen dastehen. Ob sie an
// der Anfrage ankommen, ist eine zweite Frage — und sie war bis 2026-08-21 offen. Die
// Größengrenze stand sogar HINTER `await antwort.text()`: sie schützte den Parser und
// nicht den Speicher (gemessen in Chromium 151, 150 MB kamen als 157.286.418 Zeichen in
// 139 ms vollständig an, bei 250 MB starb der Tab). Die Tests unten fahren die echte
// Funktion gegen ein `fetch`-Double.

/** `globalThis.fetch` für die Dauer eines Falls ersetzen — **immer** zurückgesetzt. */
const mitFetch = async (ersatz: typeof globalThis.fetch, lauf: () => Promise<void>): Promise<void> => {
    const echt = globalThis.fetch
    globalThis.fetch = ersatz
    try {
        await lauf()
    } finally {
        globalThis.fetch = echt
    }
}

test('holeNip05Json liest eine gewoehnliche nostr.json und gibt sie geparst zurueck', async () => {
    let gerufen = ''
    await mitFetch(
        (async (url: string | URL | Request) => {
            gerufen = String(url)

            return new Response(JSON.stringify({ names: { alice: AUTOR_A } }), { status: 200 })
        }) as typeof globalThis.fetch,
        async () => {
            const roh = await holeNip05Json('https://example.com/.well-known/nostr.json?name=alice')
            assert.deepEqual(roh, { names: { alice: AUTOR_A } })
        },
    )
    assert.equal(gerufen, 'https://example.com/.well-known/nostr.json?name=alice')
})

test('holeNip05Json BRICHT DEN STROM AB, sobald die Grenze reisst — es wird nicht erst alles gelesen', async () => {
    // **Der eigentliche Nachweis dieser Auflage.** Die Gegenseite liefert unendlich viel;
    // gezählt wird, wie viel sie überhaupt liefern DURFTE. Eine Grenze hinter
    // `await antwort.text()` ließe diese Zahl ins Unendliche laufen — der Test hinge dann
    // bis zum Timeout, statt grün zu werden.
    let geliefert = 0
    const brocken = new TextEncoder().encode('x'.repeat(64 * 1024))
    const strom = new ReadableStream<Uint8Array>({
        pull(steuerung) {
            geliefert += brocken.length
            steuerung.enqueue(brocken)
        },
    })

    await mitFetch(
        (async () => new Response(strom, { status: 200 })) as typeof globalThis.fetch,
        async () => {
            await assert.rejects(
                holeNip05Json('https://example.com/.well-known/nostr.json?name=a'),
                /zu groß/,
                'Eine Antwort jenseits der Grenze muss werfen — der Aufrufer macht daraus „fehlgeschlagen".',
            )
        },
    )

    // Die Schranke nach oben: gelesen wurde wenig mehr als die Grenze, nicht alles.
    assert.ok(
        geliefert < NIP05_MAX_ZEICHEN * 2,
        `Die Gegenseite durfte ${geliefert} Zeichen liefern — die Grenze greift erst NACH dem Lesen.`,
    )
    // Und die Schranke nach unten: es wurde überhaupt bis an die Grenze gelesen. Ohne
    // sie wäre der Fall auch dann grün, wenn `liesBegrenzt` sofort und aus einem ganz
    // anderen Grund würfe.
    assert.ok(
        geliefert > NIP05_MAX_ZEICHEN,
        `Es wurden nur ${geliefert} Zeichen angefordert — dieser Fall misst die Grenze nicht.`,
    )
})

test('liesBegrenzt haelt Mehrbyte-Zeichen ueber die Stueckgrenze zusammen', async () => {
    // Ein „ä" ist in UTF-8 zwei Bytes. Fällt es auf zwei Stücke und wird jedes für sich
    // dekodiert, entstehen zwei Ersatzzeichen — und `JSON.parse` sähe kaputten Text.
    const roh = new TextEncoder().encode('{"names":{"bäcker":"ok"}}')
    const strom = new ReadableStream<Uint8Array>({
        start(steuerung) {
            for (let i = 0; i < roh.length; i++) {
                steuerung.enqueue(roh.slice(i, i + 1))
            }
            steuerung.close()
        },
    })
    const text = await liesBegrenzt(strom)
    assert.equal(text, '{"names":{"bäcker":"ok"}}')
    assert.deepEqual(JSON.parse(text), { names: { 'bäcker': 'ok' } })
})

test('liesBegrenzt ist fail-closed: ein 200er OHNE Koerper wirft, statt leeren Text zu liefern', async () => {
    // Leerer Text ginge als `JSON.parse('')` ebenfalls in einen Wurf — aber nur zufällig.
    // Hier steht die Absicht: kein Körper ist keine `nostr.json`.
    await assert.rejects(liesBegrenzt(null), /ohne Körper/)
})

test('holeNip05Json reicht eine Frist als AbortSignal durch und schickt KEINE Zugangsdaten mit', async () => {
    let gesehen: RequestInit | undefined
    await mitFetch(
        (async (_url: string | URL | Request, init?: RequestInit) => {
            gesehen = init

            return new Response('{"names":{}}', { status: 200 })
        }) as typeof globalThis.fetch,
        async () => {
            await holeNip05Json('https://example.com/.well-known/nostr.json?name=a')
        },
    )
    assert.equal(gesehen?.credentials, 'omit', 'Die fremde Domain darf keine Cookies zu sehen bekommen.')
    assert.ok(gesehen?.signal instanceof AbortSignal, 'Ohne Signal hängt die Fläche, solange die Gegenseite hält.')
    assert.equal(gesehen?.signal?.aborted, false, 'Die Frist darf nicht schon beim Absenden abgelaufen sein.')
    // **Der WERT der Frist steht nicht hier, sondern als Quelltext-Sonde** in
    // `articleAuthorMarkup.test.ts`: aus einem laufenden `AbortSignal` ist die Dauer
    // nicht auslesbar, und eine Uhr im Test acht Sekunden laufen zu lassen wäre eine
    // Prüfung, die niemand mehr abwartet.
})

test('holeNip05Json wirft bei einem Fehlerstatus — und der Aufrufer macht daraus „fehlgeschlagen"', async () => {
    await mitFetch(
        (async () => new Response('nope', { status: 500 })) as typeof globalThis.fetch,
        async () => {
            await assert.rejects(holeNip05Json('https://example.com/.well-known/nostr.json?name=a'), /NIP-05: 500/)
        },
    )
})
