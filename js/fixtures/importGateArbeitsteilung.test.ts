/**
 * **Die Arbeitsteilung zwischen Import-Gate und Ladbarkeits-Gate — festgeschrieben, nicht
 * behauptet.** Ausgelöst durch `reviewer`-REJECT (2026-08-22): ein Regex-Literal mit
 * unescapter Zeichenklasse (`/[/*]/`) lässt den Kommentar-Tokenizer aus
 * `importEndungenGate.ts` ein `/*` lesen, das keines ist, und blankt damit den REST DER
 * DATEI — nicht nur eine Zeile. Ein echter endungsloser Import danach wird verschluckt.
 *
 * Der Tokenizer wird dafür NICHT repariert (Regex-vs-Division ist ohne echten Parser
 * unentscheidbar, `a = b /c/ d`; ein fragiler Riegel gegen einen fragilen Riegel ist kein
 * Fortschritt). Stattdessen hält dieser Test fest, WAS die Lücke schließt und WAS NICHT:
 *
 * 1. Ein **statischer** endungsloser Import (`from`/`export … from`/bare), vom Tokenizer
 *    übersehen, wird vom Ladbarkeits-Gate trotzdem gefangen — ESM löst alle statischen
 *    Importe eines Moduls beim Laden auf, unabhängig davon, ob der Text-Scanner sie sieht.
 *    **Bewiesen an einer echten Repo-Datei** (`js/countryNames.ts`, cp+sha256-Rückbau,
 *    kein `git checkout`), siehe Meldung an den Koordinator vom 2026-08-22.
 * 2. **Offene Lücke, in der BEIDE Gates schweigen:** ein dynamisches `import()` in einem
 *    Funktionskörper, der beim bloßen Laden des Moduls nicht ausgeführt wird (Lazy-Chunk-
 *    Muster — genau das, was `js/bridge.ts:3680` `void import('./longformFeed.ts')`
 *    produktiv einsetzt). Das Ladbarkeits-Gate führt nur den Toplevel-Code aus; ein
 *    `import()` in einer nie aufgerufenen Funktion wird dabei nicht ausgelöst. Vom
 *    Regex-Trick verdeckt UND nie ausgeführt → beide Gates melden „ladbar/keine
 *    Fundstelle". **Gemessen, nicht vermutet** (siehe Meldung). Dieser Test hält die Lücke
 *    bewusst fest (Fall 2 unten), statt sie zu verschweigen — es ist eine Grenze der
 *    gewählten Lösung, kein Regressionsriegel dagegen.
 *
 * Mutationsprobe für Fall 1 gefahren: `ladeUnterNode`s `ladbar: fehler === null` auf
 * `ladbar: true` (Konstante) gesetzt → dieser Test wird rot. Ohne diese Probe wäre die
 * Zusage „Teil B fängt es" nie geprüft worden, siehe `feedback_neutrale_mutation_
 * braucht_positivkontrolle` im Testerinnen-Gedächtnis.
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { findeInDatei } from '../importEndungenGate.ts'
import { ladeUnterNode } from '../ladbarkeitGate.ts'

describe('Arbeitsteilung: Import-Gate-Lücke (Regex-Literal) vs. Ladbarkeits-Gate', () => {
    test('Fall 1 — statischer Import, vom Trick verdeckt: Import-Gate übersieht ihn, Ladbarkeits-Gate fängt ihn', async () => {
        const quelltext = "const re = /[/*]/; import { x } from './nichtVorhanden'\n"

        // Erster Teil der Arbeitsteilung: der Tokenizer versagt HIER — das ist die bekannte
        // Grenze, kein Bug, den man beheben könnte, ohne einen echten Parser zu bauen.
        const importGateTreffer = findeInDatei('fixture.ts', quelltext)
        assert.deepEqual(
            importGateTreffer,
            [],
            'Der Tokenizer hat den verdeckten Import DOCH gefunden — entweder ist die ' +
                'Reviewer-Konstruktion nicht mehr gültig, oder der Tokenizer wurde geändert. ' +
                'In beiden Fällen: diesen Test und den Docblock von importEndungenGate.ts prüfen.',
        )

        // Zweiter Teil: das Ladbarkeits-Gate muss GENAU DAS auffangen, was der erste Teil
        // liegen lässt. Isolierte Fixture-Datei, damit `pruefeLadbarkeit`s
        // MIN_MODULE-Fail-closed-Schranke nicht im Weg steht.
        const tempDir = mkdtempSync(join(tmpdir(), 'arbeitsteilung-fall1-'))
        try {
            writeFileSync(join(tempDir, 'fixture.ts'), quelltext, 'utf8')
            const ergebnis = await ladeUnterNode(tempDir, 'fixture.ts')
            assert.equal(
                ergebnis.ladbar,
                false,
                'Das Ladbarkeits-Gate meldet die vom Tokenizer übersehene Datei als ladbar — ' +
                    'die Arbeitsteilung ist gebrochen. Prüfen: wurde `ladeUnterNode` geändert, ' +
                    'oder liegt der Fehler jetzt woanders?',
            )
            assert.match(ergebnis.fehler ?? '', /ERR_MODULE_NOT_FOUND/)
        } finally {
            rmSync(tempDir, { recursive: true, force: true })
        }
    })

    test('Fall 2 — OFFENE LÜCKE: dynamisches import() in nie aufgerufener Funktion entgeht BEIDEN Gates', async () => {
        const quelltext = "const re = /[/*]/\nexport function ladeLazy() {\n    return import('./nichtVorhanden')\n}\n"

        const importGateTreffer = findeInDatei('fixture.ts', quelltext)
        assert.deepEqual(importGateTreffer, [], 'Import-Gate: erwartet leer (bekannte Lücke)')

        const tempDir = mkdtempSync(join(tmpdir(), 'arbeitsteilung-fall2-'))
        try {
            writeFileSync(join(tempDir, 'fixture.ts'), quelltext, 'utf8')
            const ergebnis = await ladeUnterNode(tempDir, 'fixture.ts')
            // Bewusst KEIN Fehlschlag hier — das ist der Beweis der offenen Lücke, nicht
            // ihre Behebung. `ladeLazy()` wird nie aufgerufen, also löst node den
            // dynamischen Import nie auf, also bleibt das Modul „ladbar". Ändert sich das
            // (weil jemand die Lücke schließt), darf dieser Assert ruhig brechen — dann ist
            // die Lücke weg und der Kommentar oben veraltet.
            assert.equal(
                ergebnis.ladbar,
                true,
                'Diese Assertion hält eine bekannte LÜCKE fest, keine Zusage: bricht sie, ' +
                    'prüfen, OB die Lücke tatsächlich behoben wurde (dann diesen Test anpassen) ' +
                    'oder ob node sein Verhalten geändert hat.',
            )
        } finally {
            rmSync(tempDir, { recursive: true, force: true })
        }
    })
})
