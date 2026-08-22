/**
 * Scanner für den P3-Riegel: findet relative Importe in `js/*.ts` ohne Dateiendung.
 *
 * Ausführen (läuft in `npm run test:unit` mit, über `importEndungenGate.test.ts`):
 *   node --experimental-strip-types --test packages/einundzwanzig-group/js/importEndungenGate.test.ts
 *
 * Plan: `docs/plans/2026-08-20T1712-js-insel-testbar-machen.md`, Abschnitt P3.
 *
 * ── Warum ein Kommentar-Tokenizer statt einer Zeilennummer-Ausnahmeliste ─────────────
 *
 * Zwei bekannte Fundstellen — `js/publishOptimistic.ts:12` (`import('./longformFeed')` in
 * Prosa) und `js/longformFeed.test.ts:11` (`from './core'` etc. in Prosa) — stehen in
 * Blockkommentaren und dürfen dieses Gate nicht rot machen. Eine Ausnahmeliste über
 * Zeilennummern wäre die billigere Lösung — und die falsche: Zeilenverweise sind in diesem
 * Repo am 2026-08-20 und am 2026-08-22 zusammen SECHSMAL gebrochen, ohne dass ein Test rot
 * wurde (Plan, Abschnitt „Risiken & Edge-Cases"). Eine Zeilenliste bricht auf genau dieselbe
 * Art: lautlos, beim nächsten Verschub — und dann entweder verdeckt sie eine echte
 * Fundstelle (falsch grün) oder färbt eine harmlose Zeile rot (falsch rot, blockiert die
 * nächste Änderung ohne Grund). Ein Kommentar-Tokenizer bricht nicht durchs Verschieben,
 * nur an einer Sprachkonstruktion, die er nicht kennt — teurer zu schreiben, aber robuster
 * gegen genau die Änderungsart, die diesen Code am meisten trifft.
 *
 * ── Grenzen dieser Vereinfachung ──────────────────────────────────────────────────────
 *
 * Kein vollständiger JS/TS-Parser: Regex-Literale (`/foo\//`) werden nicht als eigene
 * Kategorie erkannt — ein `//` oder `/*` INNERHALB eines Regex-Literals würde fälschlich
 * als Kommentarstart gelesen. Geprüft (2026-08-22): kein `js/*.ts` enthält ein
 * Regex-Literal mit `//` oder `/*` im Muster. Träfe das künftig zu, wäre die Folge eine
 * verschluckte Zeile im bereinigten Text (das Gate sieht dann evtl. eine Fundstelle NICHT
 * — fail-open in genau diesem Fall) — kein Totalausfall, aber der Grund, warum diese Datei
 * die Einschränkung ausdrücklich nennt statt sie zu verschweigen. Template-Interpolationen
 * (`${...}`) werden als Teil des Template-Strings kopiert, nicht rekursiv geparst — für
 * diesen Scanner unproblematisch, da produktive Importe nie in Template-Strings stehen.
 * String-Literale werden ABSICHTLICH nicht blank gemacht (sonst würde ein echter Importpfad
 * darin verstümmelt) — eine Business-String, die wörtlich `import('./x')` enthält, würde
 * deshalb fälschlich als Fund erscheinen (fail-closed in die andere Richtung: lieber ein
 * unnötiger roter Treffer als ein verschluckter echter). Geprüft (2026-08-22): kein
 * `js/*.ts` hat so eine Zeichenkette.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join, extname } from 'node:path'

const ERLAUBTE_ENDUNGEN = new Set(['.ts', '.js', '.json', '.css', '.svg', '.mjs'])

/**
 * Ersetzt Zeilen- und Blockkommentare durch Leerzeichen (Zeilenumbrüche bleiben stehen,
 * damit Zeilennummern der Fundstellen stimmen); String- und Template-Inhalte bleiben
 * unangetastet, damit ein Importpfad darin nicht verstümmelt wird.
 */
export function bereinigeKommentare(quelltext: string): string {
    let ausgabe = ''
    let i = 0
    const n = quelltext.length
    while (i < n) {
        const zwei = quelltext.slice(i, i + 2)
        if (zwei === '//') {
            const zeilenende = quelltext.indexOf('\n', i)
            const bis = zeilenende === -1 ? n : zeilenende
            ausgabe += ' '.repeat(bis - i)
            i = bis
            continue
        }
        if (zwei === '/*') {
            const kommentarende = quelltext.indexOf('*/', i + 2)
            const bis = kommentarende === -1 ? n : kommentarende + 2
            ausgabe += quelltext.slice(i, bis).replace(/[^\n]/g, ' ')
            i = bis
            continue
        }
        const zeichen = quelltext[i]
        if (zeichen === "'" || zeichen === '"' || zeichen === '`') {
            let j = i + 1
            while (j < n) {
                if (quelltext[j] === '\\') {
                    j += 2
                    continue
                }
                if (quelltext[j] === zeichen) {
                    j += 1
                    break
                }
                j += 1
            }
            ausgabe += quelltext.slice(i, j)
            i = j
            continue
        }
        ausgabe += zeichen
        i += 1
    }
    return ausgabe
}

/**
 * Trifft alle acht bekannten Importformen über EIN Muster: das Schlüsselwort
 * (`from`/`import`/`require`), optional gefolgt von `(`, dann das Anführungszeichen.
 * Damit deckt diese eine Regel `from './x'`, `import './x'` (bare Side-Effect-Import),
 * `import('./x')`, `export … from './x'`, `import type … from './x'`, `require('./x')`,
 * doppelte Anführungszeichen und mehrzeilige Import-Statements (das Muster verlangt kein
 * Zeilenende zwischen Schlüsselwort und Anführungszeichen, `\s` schließt `\n` ein) — ohne
 * acht getrennte Regexe zu pflegen.
 */
const IMPORT_MUSTER = /\b(?:from|import|require)\s*\(?\s*(['"])(\.\.?\/[^'"]*)\1/g

export type Fundstelle = { datei: string; zeile: number; ausschnitt: string }

function hatErlaubteEndung(importPfad: string): boolean {
    return ERLAUBTE_ENDUNGEN.has(extname(importPfad))
}

/** @param dateiname Nur für die Meldung — der Scanner selbst kennt keine Pfade. */
export function findeInDatei(dateiname: string, quelltext: string): Fundstelle[] {
    const bereinigt = bereinigeKommentare(quelltext)
    const treffer: Fundstelle[] = []
    for (const match of bereinigt.matchAll(IMPORT_MUSTER)) {
        const importPfad = match[2]!
        if (hatErlaubteEndung(importPfad)) {
            continue
        }
        const zeile = bereinigt.slice(0, match.index).split('\n').length
        treffer.push({ datei: dateiname, zeile, ausschnitt: match[0] })
    }
    return treffer
}

/**
 * Untergrenze fail-closed, Vorbild `I18nCatalogGateTest.php:82` („der Scanner sieht das
 * Repo — sonst ist sein ‚0 fehlend' wertlos"). 112 nicht-Test-`.ts`-Module plus laufend
 * wachsende Zahl an `.test.ts`-Dateien standen am 2026-08-22 unter `js/` (`ls js/*.ts |
 * wc -l` = 188 insgesamt). Bewusst deutlich darunter angesetzt: eine Untergrenze ist kein
 * Sollwert, sie bewegt sich bei normalem Wachstum nie.
 */
export const MIN_TS_DATEIEN = 150

/** Nicht rekursiv — deckungsgleich mit der Messgrundlage des Plans (`js/*.ts`). */
export function sammleTsDateien(verzeichnis: string): string[] {
    return readdirSync(verzeichnis)
        .filter((name) => name.endsWith('.ts'))
        .sort()
}

/**
 * Scannt `verzeichnis` und wirft, wenn er weniger als `MIN_TS_DATEIEN` sieht — fail-closed:
 * ein leerer oder falscher Scan-Pfad soll NICHT „0 Fundstellen" melden, das wäre eine
 * Lüge, keine saubere Bilanz.
 */
export function scanne(verzeichnis: string): Fundstelle[] {
    const dateien = sammleTsDateien(verzeichnis)
    if (dateien.length < MIN_TS_DATEIEN) {
        throw new Error(
            `Der Import-Scanner hat nur ${dateien.length} .ts-Dateien unter ${verzeichnis} gesehen ` +
                `(erwartet: mindestens ${MIN_TS_DATEIEN}). Er misst nicht mehr, was er messen soll — ` +
                `sein „0 Fundstellen" wäre wertlos.`,
        )
    }
    const treffer: Fundstelle[] = []
    for (const name of dateien) {
        const quelltext = readFileSync(join(verzeichnis, name), 'utf8')
        treffer.push(...findeInDatei(name, quelltext))
    }
    return treffer
}
