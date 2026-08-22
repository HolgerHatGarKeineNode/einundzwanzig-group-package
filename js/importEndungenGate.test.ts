/**
 * P3 aus `docs/plans/2026-08-20T1712-js-insel-testbar-machen.md`: das Gate gegen den
 * Rückfall in endungslose relative Importe. P1 hat 243 Fundstellen auf `.ts`-Endungen
 * umgestellt, P2 die drei Toplevel-Barrieren verzögert — dieser Test hält den Zustand fest.
 *
 * Ausführen (läuft in `npm run test:unit` mit, Repo-Root):
 *   node --experimental-strip-types --test packages/einundzwanzig-group/js/importEndungenGate.test.ts
 *
 * Scanner + Begründung: `js/importEndungenGate.ts`. Die acht Importformen mit je eigener
 * Positivkontrolle stehen NICHT hier, sondern in `js/fixtures/importEndungenFormen.test.ts`
 * — bewusst, nicht aus Ordnung: Fixture-Quelltext als String-Literal enthält wörtlich
 * `from './modul'` u.ä., und `sammleTsDateien` liest `js/*.ts` NICHT rekursiv. Läge die
 * Fixture-Datei hier in `js/`, würde der KERNBEWEIS unten SICH SELBST als Fundstelle
 * melden — gemessen: genau das ist beim ersten Entwurf passiert (11 Fundstellen aus den
 * eigenen Test-Strings). `js/fixtures/` liegt außerhalb des non-rekursiven Scans und löst
 * das sauber, im selben Muster wie `js/fixtures/longformBestand.test.ts`.
 *
 * **Kein CI. `.github/` existiert nicht** — dieser Test läuft nur, wenn jemand von Hand
 * `npm run test:unit` aufruft (`composer test` bindet es nicht ein, siehe Meldung). Er ist
 * Teil des Standard-Laufs, aber der Lauf selbst ist manuell.
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { scanne, sammleTsDateien, MIN_TS_DATEIEN } from './importEndungenGate.ts'

/** `js/`-Verzeichnis selbst, aus der Lage dieser Datei abgeleitet. */
const JS_DIR = dirname(fileURLToPath(import.meta.url))

describe('Import-Gate: relative Importe ohne Dateiendung', () => {
    test('KALIBRIERUNG: der Scanner sieht das Repo — sonst ist sein „0 Fundstellen" wertlos', () => {
        const dateien = sammleTsDateien(JS_DIR)
        assert.ok(
            dateien.length >= MIN_TS_DATEIEN,
            `Nur ${dateien.length} .ts-Dateien unter ${JS_DIR} gesehen (erwartet mindestens ${MIN_TS_DATEIEN}).`,
        )
    })

    test('fail-closed: ein leeres Verzeichnis lässt den Scan werfen, statt „0 Fundstellen" zu melden', () => {
        const leer = mkdtempSync(join(tmpdir(), 'import-gate-leer-'))
        try {
            assert.throws(() => scanne(leer), /nur 0 \.ts-Dateien/)
        } finally {
            rmSync(leer, { recursive: true, force: true })
        }
    })

    test('KERNBEWEIS: js/*.ts hat null endungslose relative Importe', () => {
        const treffer = scanne(JS_DIR)
        assert.deepEqual(
            treffer,
            [],
            `${treffer.length} endungslose Importe gefunden:\n` +
                treffer.map((f) => `  ${f.datei}:${f.zeile} — ${f.ausschnitt}`).join('\n'),
        )
    })

    test('die zwei bekannten Fundstellen in Blockkommentaren bleiben unentdeckt (Positivkontrolle der Kommentar-Erkennung im echten Repo)', () => {
        // publishOptimistic.ts:12 zitiert `import('./longformFeed')` in Prosa;
        // longformFeed.test.ts:11 zitiert `from './core'` u.a. in Prosa. Beide dürfen NICHT
        // als Fund erscheinen — täten sie es doch, wäre die Kommentar-Erkennung kaputt und
        // der KERNBEWEIS oben bereits rot; diese Probe benennt die Ursache konkret.
        const treffer = scanne(JS_DIR)
        const betroffen = treffer.filter((f) => f.datei === 'publishOptimistic.ts' || f.datei === 'longformFeed.test.ts')
        assert.deepEqual(betroffen, [])
    })
})
