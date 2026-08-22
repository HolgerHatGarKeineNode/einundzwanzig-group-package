/**
 * Scanner für den P3-Riegel: findet relative Importe in `js/*.ts` ohne Dateiendung — über
 * den TypeScript-Compiler-AST, nicht über Textmuster.
 *
 * Ausführen (läuft in `npm run test:unit` mit, über `importEndungenGate.test.ts`):
 *   node --experimental-strip-types --test packages/einundzwanzig-group/js/importEndungenGate.test.ts
 *
 * Plan: `docs/plans/2026-08-20T1712-js-insel-testbar-machen.md`, Abschnitt P3.
 *
 * ── Warum AST statt Textmuster ────────────────────────────────────────────────────────
 *
 * Die Vorgängerfassung dieser Datei war ein Kommentar-Tokenizer über rohem Text und hatte
 * zwei bewiesene Lücken, beide aus derselben Ursache: **JavaScript wird mit Textmustern
 * geraten, nicht geparst.**
 *
 * 1. Ein Regex-Literal mit unescapter Zeichenklasse (`/[/*]/` — in `[...]` braucht `/`
 *    kein Escaping) täuschte einen Block-Kommentar vor und blankte den REST DER DATEI,
 *    nicht nur eine Zeile (`reviewer`-REJECT, 2026-08-22).
 * 2. Ein dynamisches `import()` in einem nie aufgerufenen Funktionskörper (Lazy-Chunk-
 *    Muster, produktiv z. B. `js/bridge.ts:3680`) blieb zusätzlich für das Ladbarkeits-
 *    Gate unsichtbar, weil dieses nur Toplevel-Code ausführt — beide Riegel schwiegen
 *    gleichzeitig.
 *
 * Jede Text-Heuristik gegen Lücke 1 hätte die nächste eigene Lücke gehabt (Regex vs.
 * Divisionsoperator ist ohne echten Parser nicht entscheidbar: `a = b /c/ d`). `typescript`
 * liegt bereits als Abhängigkeit im Repo — `npm run typecheck` nutzt es —, und
 * `ts.createSourceFile` liefert denselben AST, den der Compiler selbst sieht:
 *
 *   - Ein Regex-Literal ist für den Parser ein eigener Tokentyp (`RegularExpressionLiteral`),
 *     niemals ein Kommentarstart — Lücke 1 existiert damit nicht mehr.
 *   - Ein `import()` ist ein `CallExpression` wie jedes andere; seine Lage im Baum (auf
 *     Modul-Ebene oder tief in einem Funktionskörper) spielt für die Erkennung keine
 *     Rolle, weil der AST-Walk den ganzen Baum besucht, nicht nur ausgeführten Code.
 *   - Kommentare tauchen im AST gar nicht als Code auf — die frühere Sonderbehandlung für
 *     Blockkommentar-Zitate (`js/publishOptimistic.ts:12`, `js/longformFeed.test.ts:11`)
 *     erübrigt sich von selbst, es gibt nichts mehr zu tarnen.
 *
 * **Wichtig für den nächsten Leser, der „vereinfachen" will:** der AST-Weg ist nicht die
 * aufwendigere Lösung — er ist kürzer als der Tokenizer, den er ersetzt (siehe Git-Historie
 * dieser Datei), und hat keine offene Lücke. Ein Rückbau auf Textmuster bringt beide oben
 * genannten Lücken zurück.
 *
 * Das Ladbarkeits-Gate (`ladbarkeitGate.ts`) bleibt bestehen, deckt aber jetzt eine ANDERE
 * Klasse: Toplevel-Nebeneffekte ohne jedes Import-Muster (`document.addEventListener` in
 * `toast.ts`), die kein AST-Walk über Importe je sehen würde — es ist kein Ersatzriegel für
 * dieses Gate mehr, siehe dessen eigenen Docblock.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { extname, join } from 'node:path'
import ts from 'typescript'

const ERLAUBTE_ENDUNGEN = new Set(['.ts', '.js', '.json', '.css', '.svg', '.mjs'])

export type Fundstelle = { datei: string; zeile: number; ausschnitt: string }

function hatErlaubteEndung(importPfad: string): boolean {
    return ERLAUBTE_ENDUNGEN.has(extname(importPfad))
}

function istRelativerPfad(pfad: string): boolean {
    return pfad.startsWith('./') || pfad.startsWith('../')
}

/**
 * Findet alle acht Importformen (`from`, bare Side-Effect-Import, `import()`, `export …
 * from`, `import type … from`, doppelte Anführungszeichen, mehrzeilig, `require()`) über
 * denselben AST — `ts.isImportDeclaration`/`ts.isExportDeclaration` decken die ersten
 * fünf (eine `ImportDeclaration` ohne `importClause` IST der bare Import, `isTypeOnly`
 * ändert an der Knotenart nichts), ein `CallExpression`, dessen `expression` das
 * `ImportKeyword` ist, deckt `import()`, derselbe Knotentyp mit dem Bezeichner `require`
 * deckt `require()`.
 *
 * @param dateiname Nur für die Meldung — der Scanner selbst kennt keine Pfade.
 */
export function findeInDatei(dateiname: string, quelltext: string): Fundstelle[] {
    const sourceFile = ts.createSourceFile(dateiname, quelltext, ts.ScriptTarget.Latest, true)
    const treffer: Fundstelle[] = []

    const melde = (spezifizierer: ts.StringLiteralLike): void => {
        const pfad = spezifizierer.text
        if (!istRelativerPfad(pfad) || hatErlaubteEndung(pfad)) {
            return
        }
        const { line } = sourceFile.getLineAndCharacterOfPosition(spezifizierer.getStart(sourceFile))
        treffer.push({ datei: dateiname, zeile: line + 1, ausschnitt: spezifizierer.getText(sourceFile) })
    }

    const besuche = (knoten: ts.Node): void => {
        if (
            (ts.isImportDeclaration(knoten) || ts.isExportDeclaration(knoten)) &&
            knoten.moduleSpecifier &&
            ts.isStringLiteralLike(knoten.moduleSpecifier)
        ) {
            melde(knoten.moduleSpecifier)
        } else if (ts.isCallExpression(knoten)) {
            const istDynamicImport = knoten.expression.kind === ts.SyntaxKind.ImportKeyword
            const istRequire = ts.isIdentifier(knoten.expression) && knoten.expression.text === 'require'
            const argument = knoten.arguments[0]
            if ((istDynamicImport || istRequire) && argument && ts.isStringLiteralLike(argument)) {
                melde(argument)
            }
        }
        ts.forEachChild(knoten, besuche)
    }
    besuche(sourceFile)

    return treffer
}

/**
 * Untergrenze fail-closed, Vorbild `I18nCatalogGateTest.php:82` („der Scanner sieht das
 * Repo — sonst ist sein ‚0 fehlend' wertlos"). 192 `.ts`-Dateien standen am 2026-08-22
 * unter `js/` (`ls js/*.ts | wc -l`). Bewusst deutlich darunter angesetzt: eine
 * Untergrenze ist kein Sollwert, sie bewegt sich bei normalem Wachstum nie.
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
