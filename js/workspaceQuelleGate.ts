/**
 * Scanner für den P6-Riegel: **beantworten die mobile Kanalliste und die Rail die
 * Workspace-Frage aus DERSELBEN Funktion?**
 *
 * Ausführen (läuft in `npm run test:unit` mit, über `workspaceQuelleGate.test.ts`):
 *   node --experimental-strip-types --test packages/einundzwanzig-group/js/workspaceQuelleGate.test.ts
 *
 * Plan: `docs/plans/2026-08-26T1912-forge-buzz-gitea-sprache.md`, Abschnitt P6/4.
 *
 * ── Warum ein Riegel über den QUELLTEXT und nicht nur über das Verhalten ────
 *
 * `workspaceModel.test.ts` prüft, was {@link buildWorkspaceModel} liefert. Das ist
 * die halbe Zusage: baut ein späterer Umbau in `bridge.ts` wieder eine eigene
 * Liste aus `buildWorkspaceList`, bleibt jeder Verhaltenstest der reinen Funktion
 * **grün** — die Funktion tut ja weiterhin das Richtige, sie wird nur nicht mehr
 * gefragt. Genau so sind die beiden Datenwege vor P6 entstanden, und genau davor
 * warnt die DoD-Zeile („ohne diesen Riegel driftet es beim nächsten Umbau erneut
 * auseinander").
 *
 * Der Riegel prüft deshalb die VERDRAHTUNG: welche Funktion ruft die Insel auf.
 *
 * ── Warum AST und nicht `grep` ─────────────────────────────────────────────
 *
 * Ein Textmuster wäre hier **nachweislich** falsch, nicht nur theoretisch: die
 * Erklärung am Import in `bridge.ts` nennt `buildWorkspaceList` wörtlich, um zu
 * sagen, dass es dort nicht mehr steht. Ein `grep` meldete den Kommentar als
 * Verstoß; ein `grep`, das Kommentare zu erkennen versucht, hat die zwei
 * gemessenen Lücken aus `importEndungenGate.ts` (Regex-Literal als vorgetäuschter
 * Blockkommentar). `ts.createSourceFile` sieht denselben Baum wie der Compiler,
 * und Kommentare tauchen darin gar nicht erst als Code auf.
 *
 * ── Was der Scanner NICHT kann ─────────────────────────────────────────────
 *
 * Er sieht Namen, keine Werte. Ein `const f = buildWorkspaceList; f(...)` oder ein
 * `railGroups.buildWorkspaceList(...)` über einen Namespace-Import liefe an ihm
 * vorbei. Beides ist im Paket nirgends üblich und wäre eine bewusste Umgehung —
 * ein Riegel gegen Absicht ist dieser hier nicht, sondern einer gegen die
 * unauffällige Wiederholung eines Musters, das es hier schon zweimal gab.
 */
import { readFileSync, readdirSync } from 'node:fs'
import ts from 'typescript'

/** Ein importierter Name mit seiner Herkunft. */
export type Importstelle = {
    /** Der LOKALE Name — unter dem er in dieser Datei aufgerufen wird. */
    name: string
    /** Der Name im exportierenden Modul (bei `x as y` also `x`). */
    exportName: string
    /** Der Modul-Spezifizierer, z. B. `./workspaceModel.ts`. */
    modul: string
}

export type Quellenbefund = {
    datei: string
    importe: Importstelle[]
    /** Namen, die als Funktion aufgerufen werden (`f(…)`, auch `f<T>(…)`). */
    aufrufe: string[]
    /** Places where a value is PRODUCED — see {@link Wertstelle}. */
    werte: Wertstelle[]
}

/**
 * **Where a value is produced, and in what FORM.**
 *
 * Added 2026-09-05, and the reason is a gap that was the same one twice in a row.
 * {@link aufrufe} answers "is X called?" — a **deletion** detector. The first fix for that
 * was a whole-statement text comparison, and that one falls to **appending**:
 *
 *     return isWorkspaceChannel(this.workspace, room.h) || room.isDm === true
 *
 * The pinned substring stands unchanged, every count is intact, and the gate is widened.
 * Measured 2026-09-05: **6 of 9** statement comparisons in the P6 latch could be walked
 * past that way. A prefix match is not beaten by deleting, it is beaten by appending.
 *
 * So what is recorded here is the FORM of the producing expression, not its text: append
 * `|| true` and the expression is no longer a `CallExpression` but a `BinaryExpression||`,
 * and `ruft` falls to empty.
 *
 * **What this scanner cannot do, written out:** it sees shapes, not control flow. A
 * second `return` of the same shape placed earlier would satisfy an existence check while
 * the real one lies. Only the behaviour tests next to it cover that, which is why they
 * are there.
 */
export type Wertstelle = {
    /** `return` · `binding` (`const x = …`) · `assignment` (`x.y = …`). */
    art: 'return' | 'binding' | 'assignment'
    /** The bound name, the assignment target, or — for a `return` — the enclosing function. */
    name: string
    /**
     * `ts.SyntaxKind` of the producing expression, with the operator appended for a
     * `BinaryExpression` (`BinaryExpression&&`). `await`, `as` and parentheses are peeled
     * off first — none of them changes the value.
     */
    form: string
    /**
     * The called identifier when the value IS that call — also behind `&&` (right operand)
     * and in the condition of a `?:`. Otherwise `''`.
     */
    ruft: string
    /**
     * For an object literal: the fields in order, `name` for the shorthand and `name=` for
     * one with its own value. That tells `{ answered, list: x }` apart from
     * `{ answered: true, list: x }` AND from `{ answered, list: x, answered: true }` — the
     * duplicate wins in JS and would otherwise be invisible.
     */
    felder: string[]
}

/** Peel off `await x`, `x as T`, `(x)` and `x!` — none of them changes the value. */
const kern = (node: ts.Expression): ts.Expression => {
    let aktuell = node
    for (;;) {
        if (ts.isAwaitExpression(aktuell) || ts.isNonNullExpression(aktuell)) {
            aktuell = aktuell.expression
        } else if (ts.isAsExpression(aktuell) || ts.isSatisfiesExpression(aktuell)) {
            aktuell = aktuell.expression
        } else if (ts.isParenthesizedExpression(aktuell)) {
            aktuell = aktuell.expression
        } else {
            return aktuell
        }
    }
}

/**
 * The identifier whose call the value CONSISTS of.
 *
 * Two reach-throughs, both with a reason: in `a && f(x)` the deciding part is `f(x)` (the
 * shape `Boolean(me) && mayWriteKind(…)`), and in `f(x) ? a : b` it is the condition. An
 * appended `|| true` makes the top node a `||` whose right operand is not a call, so the
 * answer falls back to `''` — which is exactly the point.
 */
const gerufenerKern = (node: ts.Expression): string => {
    const innen = kern(node)
    if (ts.isCallExpression(innen) && ts.isIdentifier(innen.expression)) {
        return innen.expression.text
    }
    if (ts.isBinaryExpression(innen) && innen.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
        return gerufenerKern(innen.right)
    }
    if (ts.isConditionalExpression(innen)) {
        return gerufenerKern(innen.condition)
    }

    return ''
}

const formVon = (node: ts.Expression): string => {
    const innen = kern(node)
    if (ts.isBinaryExpression(innen)) {
        return `BinaryExpression${innen.operatorToken.getText()}`
    }

    return ts.SyntaxKind[innen.kind]
}

const felderVon = (node: ts.Expression): string[] => {
    const innen = kern(node)
    if (!ts.isObjectLiteralExpression(innen)) {
        return []
    }

    return innen.properties.map((eigenschaft) => {
        const name = eigenschaft.name && ts.isIdentifier(eigenschaft.name) ? eigenschaft.name.text : '?'

        return ts.isShorthandPropertyAssignment(eigenschaft) ? name : `${name}=`
    })
}

const wertstelle = (art: Wertstelle['art'], name: string, ausdruck: ts.Expression): Wertstelle => ({
    art,
    name,
    form: formVon(ausdruck),
    ruft: gerufenerKern(ausdruck),
    felder: felderVon(ausdruck),
})

/** The function a `return` sits in — method, named function, or `const f = () => …`. */
const umgebendeFunktion = (node: ts.Node): string => {
    for (let eltern = node.parent; eltern; eltern = eltern.parent) {
        if (ts.isMethodDeclaration(eltern) && ts.isIdentifier(eltern.name)) {
            return eltern.name.text
        }
        if (ts.isFunctionDeclaration(eltern) && eltern.name) {
            return eltern.name.text
        }
        if (ts.isVariableDeclaration(eltern) && ts.isIdentifier(eltern.name)) {
            return eltern.name.text
        }
        if (ts.isPropertyAssignment(eltern) && ts.isIdentifier(eltern.name)) {
            return eltern.name.text
        }
    }

    return ''
}

/**
 * Eine Datei lesen und ihre Importe + Aufrufe melden.
 *
 * **Fail-closed:** eine Datei ohne Anweisungen (leer, nur Kommentare, oder vom
 * Parser verworfen) wirft, statt „keine Fundstellen" zu melden. Ein Scanner, der
 * bei einer unlesbaren Datei schweigt, meldet Abwesenheit, wo er nichts gesehen
 * hat — das ist der teuerste Fehler, den ein Riegel machen kann.
 */
export function lies(datei: string, quelltext: string): Quellenbefund {
    const sourceFile = ts.createSourceFile(datei, quelltext, ts.ScriptTarget.Latest, true)
    if (sourceFile.statements.length === 0) {
        throw new Error(`${datei}: keine einzige Anweisung geparst — der Scanner misst hier nichts.`)
    }

    const importe: Importstelle[] = []
    const aufrufe: string[] = []
    const werte: Wertstelle[] = []

    const walk = (node: ts.Node): void => {
        if (ts.isImportDeclaration(node) && ts.isStringLiteralLike(node.moduleSpecifier)) {
            const modul = node.moduleSpecifier.text
            const bindings = node.importClause?.namedBindings
            if (bindings && ts.isNamedImports(bindings)) {
                for (const element of bindings.elements) {
                    importe.push({
                        name: element.name.text,
                        exportName: (element.propertyName ?? element.name).text,
                        modul,
                    })
                }
            }
            const defaultName = node.importClause?.name
            if (defaultName) {
                importe.push({ name: defaultName.text, exportName: 'default', modul })
            }
            if (bindings && ts.isNamespaceImport(bindings)) {
                importe.push({ name: bindings.name.text, exportName: '*', modul })
            }
        }
        if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
            aufrufe.push(node.expression.text)
        }
        if (ts.isReturnStatement(node) && node.expression) {
            werte.push(wertstelle('return', umgebendeFunktion(node), node.expression))
        }
        if (ts.isVariableDeclaration(node) && node.initializer && ts.isIdentifier(node.name)) {
            werte.push(wertstelle('binding', node.name.text, node.initializer))
        }
        if (
            ts.isBinaryExpression(node)
            && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
            && !ts.isIdentifier(node.left)
        ) {
            werte.push(wertstelle('assignment', node.left.getText().replace(/\s+/g, ''), node.right))
        }
        ts.forEachChild(node, walk)
    }
    walk(sourceFile)

    return { datei, importe, aufrufe, werte }
}

/** Dieselbe Auskunft, direkt von der Platte. */
export function liesDatei(pfad: string, anzeigename: string): Quellenbefund {
    return lies(anzeigename, readFileSync(pfad, 'utf8'))
}

/**
 * Untergrenze der Aufrufe, die der Scanner in einer der beiden Inseln sehen MUSS.
 *
 * Kalibrierung, kein Stil: `bridge.ts` und `rail.ts` sind 8 400 bzw. 950 Zeilen
 * Insel-Code. Sieht der Scanner dort nur eine Handvoll Aufrufe, misst er etwas
 * anderes als die Datei — und sein „ruft `buildWorkspaceList` nicht auf" wäre
 * wertlos.
 *
 * **Gemessen am 2026-08-27, nicht geschätzt:** 679 Aufrufe in `bridge.ts`, **53**
 * in `rail.ts`. Gezählt werden nur Aufrufe über einen BEZEICHNER (`f(…)`),
 * nicht über eine Eigenschaft (`this.f(…)`, `Alpine.data(…)`) — deshalb ist die
 * Zahl in einer Insel voller Methoden viel kleiner, als die Zeilenzahl vermuten
 * lässt. Der Schwellwert liegt darum bei 25 und nicht bei 50: er soll einen
 * kaputten Scanner fangen, nicht die nächste Umstrukturierung von `rail.ts`.
 */
export const MIN_AUFRUFE = 25

/**
 * Untergrenze der Produktivmodule in `js/` — dieselbe Fail-closed-Schranke wie in
 * `importEndungenGate.ts` und aus demselben Grund: ein Scan, der nichts findet,
 * weil er nichts gelesen hat, sieht aus wie ein sauberer Baum.
 */
export const MIN_MODULE = 100

/**
 * Alle PRODUKTIV-Module in `js/` — nicht rekursiv, ohne Tests.
 *
 * Ohne Tests, weil die Tests der reinen Module die alten Quellen selbstverständlich
 * weiter aufrufen (`railGroups.test.ts` prüft `buildWorkspaceList`, und das soll es
 * auch). Die Zusage dieses Riegels gilt dem ausgelieferten Code.
 */
export function sammleModule(verzeichnis: string): string[] {
    const dateien = readdirSync(verzeichnis, { withFileTypes: true })
        .filter((eintrag) => eintrag.isFile() && eintrag.name.endsWith('.ts') && !eintrag.name.endsWith('.test.ts')
            && !eintrag.name.endsWith('.d.ts'))
        .map((eintrag) => eintrag.name)
        .sort()
    if (dateien.length < MIN_MODULE) {
        throw new Error(
            `Der Scanner sieht in ${verzeichnis} nur ${dateien.length} Module (erwartet mindestens ${MIN_MODULE}). `
                + 'Er misst nicht mehr, was er messen soll.',
        )
    }

    return dateien
}

/** Ruft diese Datei die Funktion `name` auf? */
export const ruftAuf = (befund: Quellenbefund, name: string): boolean => befund.aufrufe.includes(name)

/** Importiert diese Datei `exportName` aus `modul`? */
export const importiertAus = (befund: Quellenbefund, exportName: string, modul: string): boolean =>
    befund.importe.some((stelle) => stelle.exportName === exportName && stelle.modul === modul)
