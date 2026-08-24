/**
 * Die reinen Regeln des Code-Browsers — geprüft wird, was die Fläche STILL
 * falsch machen würde:
 *
 *   1. **Eine `git://`- oder `ssh://`-clone-URL ist im Browser unerreichbar.**
 *      Wer sie durchlässt, verschiebt den Fehler in `isomorphic-git`, wo er als
 *      unverständlicher Netzfehler ankommt statt als klare Auskunft.
 *   2. **Ein Schrägstrich zu viel ist ein `401`.** Der NIP-98-`u`-Tag muss
 *      zeichengenau die Repo-Basis tragen, die `git_expected_url` erwartet.
 *   3. **`docs/readme.md` ist nicht die Visitenkarte des Repositories.**
 *   4. **`total` ist beim Clone oft `0`.** Ein Balken aus `loaded/total`
 *      springt dann auf `Infinity` oder behauptet Stillstand.
 *   5. **Ein Abbruch ist kein Netzfehler.** Wer die Einordnung dreht, meldet
 *      dem Nutzer einen Fehler für etwas, das er selbst ausgelöst hat.
 *
 * Ausführen:
 * node --experimental-strip-types --test packages/einundzwanzig-group/js/gitReadme.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
    BILD_GRENZE,
    README_VORZUG,
    TEXT_GRENZE,
    ZEILEN_GRENZE,
    bildMime,
    dateiArt,
    elternPfad,
    findeReadme,
    istBinaer,
    krumelspur,
    kuerzeZeilen,
    sortiereEintraege,
    verbinde,
    type BaumEintrag,
    groesse,
    istEigenerHost,
    istMarkdown,
    klonPfad,
    ordneFehlerEin,
    waehleCloneUrl,
    zuFortschritt,
} from './gitReadme.ts'

// ── clone-URL ───────────────────────────────────────────────────────────────

test('waehleCloneUrl nimmt nur http(s) — und die ERSTE davon', () => {
    assert.equal(
        waehleCloneUrl(['git://example.invalid/x', 'https://buzz.example/git/a/b']),
        'https://buzz.example/git/a/b',
    )
    assert.equal(waehleCloneUrl(['http://lokal.test/git/a/b']), 'http://lokal.test/git/a/b')
})

test('KONTROLLE: ohne erreichbares Schema bleibt es LEER, statt etwas zu raten', () => {
    // Der Fall, den die Fläche als eigene Auskunft zeigen muss. Gäbe die
    // Funktion hier die ssh-URL zurück, endete es in einem Netzfehler ohne Sinn.
    assert.equal(waehleCloneUrl(['ssh://git@example.invalid/x.git']), '')
    assert.equal(waehleCloneUrl(['git@github.com:a/b.git']), '')
    assert.equal(waehleCloneUrl([]), '')
    assert.equal(waehleCloneUrl(['']), '')
})

test('der abschliessende Schrägstrich fällt weg — sonst `401 NIP-98 auth failed`', () => {
    // `git_expected_url` baut die Repo-Basis aus dem PFAD zusammen. Ein `/` zu
    // viel im `u`-Tag ist ein anderer String und damit eine andere Signatur.
    assert.equal(waehleCloneUrl(['https://buzz.example/git/a/b/']), 'https://buzz.example/git/a/b')
    assert.equal(waehleCloneUrl(['https://buzz.example/git/a/b///']), 'https://buzz.example/git/a/b')
})

test('istEigenerHost vergleicht den HOST, nicht die Zeichenkette', () => {
    const relay = 'wss://buzz.einundzwanzig.space'
    assert.equal(istEigenerHost('https://buzz.einundzwanzig.space/git/a/b', relay), true)
    // Gross-/Kleinschreibung des Hosts ist bedeutungslos.
    assert.equal(istEigenerHost('https://BUZZ.einundzwanzig.space/git/a/b', relay), true)
    // Ein fremder Git-Host ist KEIN Fehler, aber unser Token trägt dort nicht.
    assert.equal(istEigenerHost('https://github.com/a/b', relay), false)
    // Ein Präfix-Trick darf nicht durchrutschen.
    assert.equal(istEigenerHost('https://buzz.einundzwanzig.space.boese.example/x', relay), false)
    assert.equal(istEigenerHost('', relay), false)
    assert.equal(istEigenerHost('kaputt', relay), false)
})

test('klonPfad hängt an Eigentümer und `d`, nicht am Namen', () => {
    // Der Name ist frei wählbar und zweimal vergeben; die Koordinate ist die
    // Identität.
    assert.equal(klonPfad('AABB', 'mein-repo'), '/repos/aabb/mein-repo')
    // Ein `d` darf Zeichen tragen, die kein Pfad verträgt.
    assert.equal(klonPfad('aa', 'a/b:c'), '/repos/aa/a_b_c')
    assert.equal(klonPfad('aa', '..'), '/repos/aa/..')
})

// ── README-Auswahl ──────────────────────────────────────────────────────────

test('findeReadme folgt der Vorzugsliste, nicht der Reihenfolge im Baum', () => {
    assert.equal(findeReadme(['readme.txt', 'README.md', 'index.js']), 'README.md')
    assert.equal(findeReadme(['readme.rst', 'readme.txt']), 'readme.txt')
    assert.equal(findeReadme(['README']), 'README')
})

test('ohne README bleibt es leer — die Fläche zeigt dann die Beschreibung', () => {
    assert.equal(findeReadme(['index.js', 'package.json']), '')
    assert.equal(findeReadme([]), '')
})

test('KONTROLLE: `docs/readme.md` ist NICHT die Visitenkarte des Repositories', () => {
    // Der Aufrufer reicht nur die WURZEL herein; kommt doch ein Pfad durch,
    // darf er nicht gewinnen — er heisst nicht „readme".
    assert.equal(findeReadme(['docs/readme.md', 'index.js']), '')
})

test('eine unbekannte Endung gewinnt nur, wenn nichts Bevorzugtes da ist', () => {
    assert.equal(findeReadme(['README.adoc']), 'README.adoc')
    // …aber niemals VOR einem bevorzugten Namen.
    assert.equal(findeReadme(['README.adoc', 'readme.md']), 'readme.md')
    // Bei zwei gleichrangigen entscheidet eine feste Regel, nicht der Zufall.
    assert.equal(findeReadme(['readme.org', 'readme.adoc']), 'readme.adoc')
})

test('die Vorzugsliste ist durchgehend kleingeschrieben — sonst greift der Vergleich nie', () => {
    // Verglichen wird gegen `name.toLowerCase()`. Ein Grossbuchstabe in der
    // Liste fiele lautlos durch und die Reihenfolge wäre wirkungslos.
    for (const eintrag of README_VORZUG) {
        assert.equal(eintrag, eintrag.toLowerCase())
    }
})

test('istMarkdown trennt Gerendertes von Rohtext', () => {
    assert.equal(istMarkdown('README.md'), true)
    assert.equal(istMarkdown('readme.MARKDOWN'), true)
    assert.equal(istMarkdown('readme.txt'), false)
    assert.equal(istMarkdown('README'), false)
})

// ── Größen ─────────────────────────────────────────────────────────────────

test('groesse liefert Zahl und Einheit GETRENNT — die Fläche baut den Satz', () => {
    assert.deepEqual(groesse(0), { zahl: 0, einheit: 'B' })
    assert.deepEqual(groesse(999), { zahl: 999, einheit: 'B' })
    assert.deepEqual(groesse(1000), { zahl: 1, einheit: 'kB' })
    assert.deepEqual(groesse(8_300_000), { zahl: 8.3, einheit: 'MB' })
    // Dezimal, nicht binär: der Nutzer vergleicht mit seinem Datenvolumen.
    assert.deepEqual(groesse(1_048_576), { zahl: 1, einheit: 'MB' })
})

test('groesse verkraftet Unsinn, statt `NaN` in die Fläche zu lassen', () => {
    assert.deepEqual(groesse(Number.NaN), { zahl: 0, einheit: 'B' })
    assert.deepEqual(groesse(-5), { zahl: 0, einheit: 'B' })
    assert.deepEqual(groesse(Number.POSITIVE_INFINITY), { zahl: 0, einheit: 'B' })
})

// ── Fortschritt ────────────────────────────────────────────────────────────

test('WÄCHTER: ohne `total` gibt es KEINEN Anteil — und keine erfundene Zahl', () => {
    // Das ist der Fall, der einen Balken auf `Infinity` schickt oder ihn bei 0
    // festnageln lässt, obwohl Arbeit läuft.
    const f = zuFortschritt({ phase: 'Analyzing workdir', loaded: 42, total: 0 })
    assert.equal(f.anteil, null, 'Aus `total: 0` wurde ein Anteil gerechnet.')
    assert.equal(f.geladen, 42, 'Der rohe Zähler muss trotzdem da sein.')
})

test('mit `total` ist der Anteil berechenbar und gedeckelt', () => {
    assert.equal(zuFortschritt({ phase: 'Receiving objects', loaded: 50, total: 200 }).anteil, 0.25)
    // Mehr als 100 % kann eine Anzeige nicht meinen.
    assert.equal(zuFortschritt({ loaded: 300, total: 200 }).anteil, 1)
})

test('fehlende Felder ergeben Nullen, keinen Wurf', () => {
    assert.deepEqual(zuFortschritt({}), { phase: '', anteil: null, geladen: 0, gesamt: 0 })
    assert.deepEqual(
        zuFortschritt({ loaded: Number.NaN, total: Number.NaN }),
        { phase: '', anteil: null, geladen: 0, gesamt: 0 },
    )
})

// ── Fehlereinordnung ───────────────────────────────────────────────────────

test('WÄCHTER: ein Abbruch ist ein Abbruch, kein Netzfehler', () => {
    // Ein abgebrochener `fetch` wirft — und seine Meldung enthält in Chromium
    // ebenfalls Netz-Wortlaut. Die Reihenfolge der Prüfung entscheidet.
    const abbruch = Object.assign(new Error('The user aborted a request.'), { name: 'AbortError' })
    assert.equal(ordneFehlerEin(abbruch), 'abgebrochen')
    assert.equal(ordneFehlerEin(new Error('signal is aborted without reason')), 'abgebrochen')
})

test('401 und 403 heissen „kein Zugriff", nicht „Netz"', () => {
    assert.equal(ordneFehlerEin(new Error('HTTP Error: 401 NIP-98 auth failed')), 'kein-zugriff')
    assert.equal(ordneFehlerEin(new Error('403 Forbidden')), 'kein-zugriff')
    assert.equal(ordneFehlerEin(new Error('you are not a member of this relay')), 'kein-zugriff')
})

test('CORS und tote Verbindung heissen „Netz"', () => {
    assert.equal(ordneFehlerEin(new TypeError('Failed to fetch')), 'netz')
    assert.equal(ordneFehlerEin(new Error('NetworkError when attempting to fetch resource.')), 'netz')
})

test('was sich nicht einordnen lässt, heisst „unbekannt" — statt falsch einsortiert', () => {
    assert.equal(ordneFehlerEin(new Error('Could not find HEAD')), 'unbekannt')
    assert.equal(ordneFehlerEin(null), 'unbekannt')
    assert.equal(ordneFehlerEin('irgendwas'), 'unbekannt')
})

// ── Baum ────────────────────────────────────────────────────────────────────

test('sortiereEintraege: Verzeichnisse zuerst, dann alphabetisch OHNE Gross/Klein', () => {
    // Git liefert seine eigene Sortierung, in der `Zebra` vor `apfel` steht.
    // Wer sie durchreicht, zeigt eine Liste, die niemand überfliegen kann.
    const eintraege: BaumEintrag[] = [
        { name: 'index.js', art: 'blob' },
        { name: 'Zebra', art: 'blob' },
        { name: 'src', art: 'tree' },
        { name: 'apfel', art: 'blob' },
        { name: 'Docs', art: 'tree' },
    ]
    assert.deepEqual(
        sortiereEintraege(eintraege).map((e) => e.name),
        ['Docs', 'src', 'apfel', 'index.js', 'Zebra'],
    )
})

test('sortiereEintraege verändert die EINGABE nicht', () => {
    // Die Ableitung läuft bei jedem Ereignis neu; ein `sort` an Ort und Stelle
    // schriebe in ein Modell, das jemand anders hält.
    const eintraege: BaumEintrag[] = [{ name: 'b', art: 'blob' }, { name: 'a', art: 'blob' }]
    sortiereEintraege(eintraege)
    assert.deepEqual(eintraege.map((e) => e.name), ['b', 'a'])
})

test('krumelspur und elternPfad', () => {
    assert.deepEqual(krumelspur('src/js/app.ts'), [
        { name: 'src', pfad: 'src' },
        { name: 'js', pfad: 'src/js' },
        { name: 'app.ts', pfad: 'src/js/app.ts' },
    ])
    // Die Wurzel benennt die FLÄCHE — ihr Wort muss übersetzt sein.
    assert.deepEqual(krumelspur(''), [])
    assert.equal(elternPfad('src/js/app.ts'), 'src/js')
    assert.equal(elternPfad('src'), '')
    assert.equal(elternPfad(''), '')
})

test('verbinde erzeugt keine doppelten Schrägstriche', () => {
    assert.equal(verbinde('', 'src'), 'src')
    assert.equal(verbinde('src', 'app.ts'), 'src/app.ts')
})

// ── Dateiart ────────────────────────────────────────────────────────────────

const bytesAus = (s: string): Uint8Array => new TextEncoder().encode(s)
const nullBytes = (n: number): Uint8Array => new Uint8Array(n)

test('istBinaer erkennt ein NUL — und schaut nur in die ersten 8000 Bytes', () => {
    assert.equal(istBinaer(bytesAus('nur text')), false)
    const mitNull = new Uint8Array([104, 0, 105])
    assert.equal(istBinaer(mitNull), true)
    // Ein NUL JENSEITS des Fensters wird nicht gefunden — das ist die bewusste
    // Grenze der Heuristik, kein Versehen.
    const spaet = new Uint8Array(9000)
    spaet.fill(65)
    spaet[8500] = 0
    assert.equal(istBinaer(spaet), false)
})

test('WÄCHTER: ein Bild wird als BILD erkannt, nicht als binär', () => {
    // Ein PNG enthält NUL-Bytes. Prüfte man den Inhalt vor der Endung, landete
    // jedes Bild bei „binär" und würde nie angezeigt.
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 13])
    assert.equal(dateiArt('logo.png', png), 'bild')
    assert.equal(istBinaer(png), true, 'Vorbedingung: dieses Byte-Muster IST binär.')
})

test('Grösse schlägt Inhalt — eine Riesendatei wird gar nicht erst untersucht', () => {
    const riesig = new Uint8Array(TEXT_GRENZE + 1)
    riesig.fill(65)
    assert.equal(dateiArt('vendor.js.map', riesig), 'zu-gross')
    // Auch ein Bild über seiner eigenen Grenze.
    assert.equal(dateiArt('gross.png', new Uint8Array(BILD_GRENZE + 1)), 'zu-gross')
})

test('svg gilt als TEXT, nicht als Bild', () => {
    // Es ist Quelltext. Als Bild eingebunden liesse es fremdes Markup ins
    // Dokument — eine Sicherheitszusage, die niemand geprüft hat.
    assert.equal(dateiArt('logo.svg', bytesAus('<svg></svg>')), 'text')
})

test('Markdown, Text und Binär werden unterschieden', () => {
    assert.equal(dateiArt('README.md', bytesAus('# Titel')), 'markdown')
    assert.equal(dateiArt('index.js', bytesAus('const a = 1')), 'text')
    assert.equal(dateiArt('daten.bin', nullBytes(64)), 'binaer')
    assert.equal(dateiArt('leer.txt', new Uint8Array(0)), 'text')
})

test('bildMime trifft die gängigen Endungen und rät sonst nicht', () => {
    assert.equal(bildMime('a.PNG'), 'image/png')
    assert.equal(bildMime('a.jpg'), 'image/jpeg')
    assert.equal(bildMime('a.jpeg'), 'image/jpeg')
    assert.equal(bildMime('a.unbekannt'), 'application/octet-stream')
})

// ── Kürzen ──────────────────────────────────────────────────────────────────

test('kuerzeZeilen sagt die WAHRE Gesamtzahl, nicht die gekürzte', () => {
    // „3000 von 41 233 Zeilen" ist eine Auskunft; „gekürzt" ist keine.
    const viele = Array.from({ length: ZEILEN_GRENZE + 233 }, (_, i) => `Zeile ${i}`).join('\n')
    const r = kuerzeZeilen(viele)
    assert.equal(r.gekuerzt, true)
    assert.equal(r.zeilen, ZEILEN_GRENZE + 233)
    assert.equal(r.text.split('\n').length, ZEILEN_GRENZE)
})

test('KONTROLLE: unter der Grenze wird nichts angefasst', () => {
    const kurz = 'a\nb\nc'
    const r = kuerzeZeilen(kurz)
    assert.equal(r.gekuerzt, false)
    assert.equal(r.text, kurz)
    assert.equal(r.zeilen, 3)
})
