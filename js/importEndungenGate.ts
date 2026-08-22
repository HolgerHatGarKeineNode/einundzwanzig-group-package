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
 * ── Grenzen dieser Vereinfachung — und WARUM sie nicht behoben werden ─────────────────
 *
 * **Kein vollständiger JS/TS-Parser: Regex-Literale werden nicht als eigene Kategorie
 * erkannt, und der Blast-Radius ist der REST DER DATEI, nicht eine Zeile.** Belegt vom
 * `reviewer` (2026-08-22, P3-REJECT): `const re = /[/*]/; import { x } from './modul'` —
 * gültiges JS (in `[...]` braucht `/` kein Escaping), aber der Tokenizer liest das `/*`
 * innerhalb der Zeichenklasse als Block-Kommentar-Start und blankt bis zum nächsten
 * Kommentarende (Stern-Schrägstrich) im Text — findet er keins mehr, bis Dateiende
 * (bewusst NICHT als Literal hier hingeschrieben: genau diese zwei Zeichen würden auch
 * DIESEN Docblock vorzeitig schließen — derselbe Effekt, eine Ebene höher, an dem der
 * erste Entwurf dieser Zeile beim `npm run typecheck` gescheitert ist). Ein Import NACH
 * dieser Konstruktion wird
 * unsichtbar, egal wie weit er entfernt steht. Eine frühere Fassung dieses Docblocks
 * bezifferte den Schaden als „eine verschluckte Zeile" — das war falsch, und die
 * Momentaufnahmen-Begründung dahinter („geprüft 2026-08-22, keine Instanz im Repo") ist
 * exakt das Argument, das oben gegen die Zeilennummer-Ausnahmeliste steht: eine Aussage
 * über den heutigen Bestand, keine über die Zukunft.
 *
 * **Der Tokenizer wird dafür NICHT repariert.** Regex-Literal gegen Divisionsoperator ist
 * ohne einen echten Parser nicht entscheidbar (`a = b /c/ d` — beides gültige Lesarten je
 * nach vorherigem Token). Eine Heuristik dagegen hätte ihre eigene Lücke, nur eine Ebene
 * tiefer versteckt.
 *
 * **Was die Lücke stattdessen deckt: das Ladbarkeits-Gate (`ladbarkeitGate.ts`), und zwar
 * nur TEILWEISE.** Ein vom Tokenizer übersehener STATISCHER Import (`from`/`export …
 * from`/bare) wird beim Laden des Moduls trotzdem aufgelöst — ESM linkt alle statischen
 * Importe vor der Ausführung, unabhängig davon, ob ein Text-Scanner sie sieht. Bewiesen an
 * einer echten Repo-Datei, Fixture-Regressionsfall in
 * `js/fixtures/importGateArbeitsteilung.test.ts` (Fall 1), mit Mutationsprobe.
 * **Offene, unbehobene Lücke:** ein vom Trick verdecktes DYNAMISCHES `import()` in einem
 * Funktionskörper, der beim bloßen Modul-Laden nicht ausgeführt wird (Lazy-Chunk-Muster,
 * produktiv z. B. in `js/bridge.ts:3680`), entgeht BEIDEN Gates — das Ladbarkeits-Gate
 * führt nur Toplevel-Code aus. Festgehalten, nicht verschwiegen, in
 * `importGateArbeitsteilung.test.ts` (Fall 2). Dieses Import-Gate ist also OHNE das
 * Ladbarkeits-Gate unvollständig, und selbst mit beiden bleibt der Lazy-Fall offen.
 *
 * Template-Interpolationen (`${...}`) werden als Teil des Template-Strings kopiert, nicht
 * rekursiv geparst — für diesen Scanner unproblematisch, da produktive Importe nie in
 * Template-Strings stehen. String-Literale werden ABSICHTLICH nicht blank gemacht (sonst
 * würde ein echter Importpfad darin verstümmelt) — eine Business-String, die wörtlich
 * `import('./x')` enthält, würde deshalb fälschlich als Fund erscheinen (fail-closed in die
 * andere Richtung: lieber ein unnötiger roter Treffer als ein verschluckter echter).
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
