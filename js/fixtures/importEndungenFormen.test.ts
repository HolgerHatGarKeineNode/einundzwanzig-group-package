/**
 * Die acht Importformen des P3-Gates, je mit eigener Positivkontrolle — ausgelagert aus
 * `js/importEndungenGate.test.ts` (siehe dessen Docblock): Fixture-Quelltext hier ist
 * String-Literal und enthält wörtlich `from './modul'` u.ä. Läge diese Datei direkt unter
 * `js/`, würde der KERNBEWEIS des Gates SICH SELBST als Fundstelle melden — gemessen,
 * nicht vermutet (11 Fundstellen aus den eigenen Test-Strings im ersten Entwurf).
 * `js/fixtures/` liegt außerhalb von `sammleTsDateien`s nicht-rekursivem Scan.
 *
 * Ausführen (läuft in `npm run test:unit` mit):
 *   node --experimental-strip-types --test packages/einundzwanzig-group/js/fixtures/importEndungenFormen.test.ts
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { findeInDatei } from '../importEndungenGate.ts'

describe('acht Importformen, je mit eigener Positivkontrolle', () => {
    const faelle: Array<{ name: string; quelltext: string }> = [
        { name: 'from, einfach', quelltext: "import { x } from './modul'\n" },
        { name: 'bare Side-Effect-Import', quelltext: "import './modul'\n" },
        { name: 'dynamic import()', quelltext: "const m = await import('./modul')\n" },
        { name: 'export … from', quelltext: "export { x } from './modul'\n" },
        { name: 'import type … from', quelltext: "import type { X } from './modul'\n" },
        { name: 'doppelte Anführungszeichen', quelltext: 'import { x } from "./modul"\n' },
        {
            name: 'mehrzeiliges Import-Statement',
            quelltext: "import {\n    a,\n    b,\n} from './modul'\n",
        },
        { name: 'require()', quelltext: "const m = require('./modul')\n" },
    ]

    for (const { name, quelltext } of faelle) {
        test(`rot ohne Endung: ${name}`, () => {
            const treffer = findeInDatei('fixture.ts', quelltext)
            assert.ok(treffer.length >= 1, `Form "${name}" wurde nicht erkannt:\n${quelltext}`)
        })

        test(`grün mit ergänzter Endung: ${name}`, () => {
            const mitEndung = quelltext.replace("'./modul'", "'./modul.ts'").replace('"./modul"', '"./modul.ts"')
            assert.notEqual(mitEndung, quelltext, `Testfixture "${name}" hat die Endung nicht wirklich ergänzt`)
            const treffer = findeInDatei('fixture.ts', mitEndung)
            assert.deepEqual(treffer, [], `Form "${name}" schlägt auch MIT Endung noch an:\n${mitEndung}`)
        })
    }

    test('ein Importpfad in einem Blockkommentar wird nicht gemeldet (Kalibrierung des Kommentar-Strippers)', () => {
        const quelltext = "/**\n * Beispiel: `import './modul'`\n */\nexport const x = 1\n"
        assert.deepEqual(findeInDatei('fixture.ts', quelltext), [])
    })

    test('…aber ein Import NACH einem Blockkommentar wird weiter erkannt (keine Überstrippung)', () => {
        const quelltext = "/**\n * Kommentar\n */\nimport { x } from './modul'\n"
        const treffer = findeInDatei('fixture.ts', quelltext)
        assert.equal(treffer.length, 1)
        assert.equal(treffer[0]!.zeile, 4)
    })

    test('ein Importpfad in einem Zeilenkommentar wird nicht gemeldet', () => {
        const quelltext = "// import './modul'\nexport const x = 1\n"
        assert.deepEqual(findeInDatei('fixture.ts', quelltext), [])
    })

    // KEIN Test „String-Literal wird nicht gemeldet": Strings werden bewusst NICHT
    // blank gemacht (siehe `importEndungenGate.ts`, sonst würde ein echter Importpfad in
    // einem String verstümmelt). Eine Business-String, die zufällig `import('./x')`
    // wörtlich enthält, würde deshalb als Fund erscheinen — eine dokumentierte Grenze,
    // kein stiller Blindfleck. Geprüft (2026-08-22): kein `js/*.ts` hat so einen String.
})
