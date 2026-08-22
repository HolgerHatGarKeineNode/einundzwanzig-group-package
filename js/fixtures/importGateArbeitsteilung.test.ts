/**
 * **Der AST-Scanner fängt beide Reviewer-Konstruktionen selbst — keine Arbeitsteilung mit
 * dem Ladbarkeits-Gate mehr nötig.** Diese Datei hieß bis 2026-08-22 „Arbeitsteilung" und
 * hielt zwei Fälle fest, in denen der textbasierte Kommentar-Tokenizer aus
 * `importEndungenGate.ts` schwieg — Fall 1 wurde vom Ladbarkeits-Gate aufgefangen, Fall 2
 * NICHT (beide Gates schwiegen gleichzeitig, gemessen). Mit dem AST-Umbau (siehe Docblock
 * von `importEndungenGate.ts`) sind beide Fälle keine Lücke mehr, sondern eine Zusage: der
 * `ts`-Compiler-AST sieht ein Regex-Literal als eigenen Tokentyp (nie als Kommentarstart)
 * und einen `CallExpression`-Knoten unabhängig von seiner Tiefe im Baum — ob er beim
 * bloßen Laden ausgeführt würde, spielt für den WALK keine Rolle.
 *
 * Diese Datei bleibt trotzdem bestehen (gleicher Name, andere Aussage): die beiden Fälle
 * sind der genaueste bekannte Stresstest für den Scanner, und ein Regressionsriegel dafür
 * ist mehr wert als ein weiterer generischer Fixture-Fall.
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { findeInDatei } from '../importEndungenGate.ts'

describe('AST-Scanner fängt beide Reviewer-Konstruktionen direkt (keine Arbeitsteilung mehr nötig)', () => {
    test('Fall 1 — Regex-Literal + statischer Import auf derselben Zeile: vom Scanner selbst gefunden', () => {
        const quelltext = "const re = /[/*]/; import { x } from './nichtVorhanden'\n"
        const treffer = findeInDatei('fixture.ts', quelltext)
        assert.equal(
            treffer.length,
            1,
            `Erwartet genau einen Treffer, bekommen: ${JSON.stringify(treffer)}. Der frühere ` +
                'Text-Tokenizer fand hier NICHTS (Blast-Radius „Rest der Datei") — bricht dieser ' +
                'Test, ist entweder der AST-Walk kaputt oder jemand hat auf Textmuster zurückgebaut.',
        )
        assert.equal(treffer[0]!.ausschnitt, "'./nichtVorhanden'")
    })

    test('Fall 2 — Regex-Literal + dynamisches import() in NIE aufgerufenem Funktionskörper: vom Scanner selbst gefunden', () => {
        const quelltext = "const re = /[/*]/\nexport function ladeLazy() {\n    return import('./nichtVorhanden')\n}\n"
        const treffer = findeInDatei('fixture.ts', quelltext)
        assert.equal(
            treffer.length,
            1,
            `Erwartet genau einen Treffer, bekommen: ${JSON.stringify(treffer)}. Das war die ` +
                'Lücke, in der BEIDE früheren Gates schwiegen (weder Text-Tokenizer noch ' +
                'Ladbarkeits-Gate, das nur Toplevel-Code ausführt) — bricht dieser Test, ist die ' +
                'Lücke zurück.',
        )
        assert.equal(treffer[0]!.zeile, 3)
    })
})
