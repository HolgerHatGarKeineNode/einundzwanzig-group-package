/**
 * Der Ladbarkeits-Riegel: **alle Module in `js/` laden unter node** (114 am 2026-08-22,
 * `sammleModule().length` zur Laufzeit — die Zahl wächst mit, wird deshalb hier bewusst
 * nicht festgeschrieben). Über die P3-DoD hinaus gebaut — der Plan verlangt nur das
 * Import-Gate (`importEndungenGate.ts`) — weil er die Zusage misst, die P1+P2 tatsächlich
 * hergestellt haben, statt nur ihren Proxy (Import-Stil). Scanner + Begründung:
 * `js/ladbarkeitGate.ts`.
 *
 * **Was dieses Gate NICHT (mehr) ist: ein Ersatzriegel fürs Import-Gate.** Bis zum
 * 2026-08-22 stand hier, es decke die Regex-Literal-Lücke von `importEndungenGate.ts`
 * für statische Importe strukturell ab. Diese Arbeitsteilung ist entfallen — seit dem
 * Umbau auf den TypeScript-AST fängt das Import-Gate beide Konstruktionen selbst (siehe
 * `js/fixtures/importGateArbeitsteilung.test.ts`). Und sie hätte ohnehin nie getragen:
 * ein lazy `import()` in einer nie aufgerufenen Funktion wird beim Modul-Laden nicht
 * ausgelöst, dieses Gate hätte es also nie gesehen.
 *
 * Was bleibt, ist eine **andere Klasse**, die kein Import-Muster je sähe:
 * Toplevel-Nebeneffekte gegen Browser-Globals — `document.addEventListener` in
 * `toast.ts:51`, `localStorage` in `session.ts`/`groups.ts`. Genau daran scheiterten in
 * P2 zehn Module.
 *
 * **Laufzeit-Entscheidung (2026-08-22, gemessen):** die Module SEQUENTIELL unter node zu
 * laden kostet ~100 s (`for`-Schleife über alle Module, einzeln gemessen). Mit
 * `parallelitaet=8` (siehe `ladbarkeitGate.ts`) sinkt das auf einen ZUWACHS von rund 12,7 s
 * auf `npm run test:unit`:
 *
 *   | Lauf | ohne dieses Gate (vorher) | mit diesem Gate (danach, 3×) |
 *   |---|---|---|
 *   | Gesamtlaufzeit | 3,30 s (1524 Tests) | 16,07 s / 15,89 s / 15,97 s (1550 Tests) |
 *
 * Zuwachs ≈ **12,7 s** — unter der ~20-s-Grenze aus dem Auftrag. Diese Datei heißt deshalb
 * bewusst `*.test.ts` und läuft damit MIT `npm run test:unit` — sie ist Teil des
 * Standard-Laufs, kein separates Skript.
 *
 * Ausführen (auch einzeln):
 *   node --experimental-strip-types --test packages/einundzwanzig-group/js/ladbarkeitGate.test.ts
 *
 * **Kein CI. `.github/` existiert nicht** — dieses Gate wirkt nur, wenn jemand von Hand
 * `npm run test:unit` aufruft.
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pruefeLadbarkeit, sammleModule, MIN_MODULE } from './ladbarkeitGate.ts'

const JS_DIR = dirname(fileURLToPath(import.meta.url))

describe('Ladbarkeits-Gate: jedes Modul in js/ lädt unter node', () => {
    test('KALIBRIERUNG: der Scanner sieht das Repo — sonst ist sein „alle ladbar" wertlos', () => {
        const module = sammleModule(JS_DIR)
        assert.ok(
            module.length >= MIN_MODULE,
            `Nur ${module.length} Module unter ${JS_DIR} gesehen (erwartet mindestens ${MIN_MODULE}).`,
        )
    })

    test('fail-closed: ein leeres Verzeichnis lässt das Gate werfen, statt „alle ladbar" zu melden', async () => {
        const leer = mkdtempSync(join(tmpdir(), 'ladbarkeit-leer-'))
        try {
            await assert.rejects(() => pruefeLadbarkeit(leer), /nur 0 Module/)
        } finally {
            rmSync(leer, { recursive: true, force: true })
        }
    })

    test('KERNBEWEIS: alle Module in js/ laden fehlerfrei unter node', { timeout: 60_000 }, async () => {
        const ergebnisse = await pruefeLadbarkeit(JS_DIR)
        const gescheitert = ergebnisse.filter((e) => !e.ladbar)
        assert.deepEqual(
            gescheitert.map((e) => e.datei),
            [],
            `${gescheitert.length} Module scheitern beim Laden unter node:\n` +
                gescheitert.map((e) => `  ${e.datei}: ${e.fehler}`).join('\n'),
        )
    })
})
