/**
 * Pure-Tests für `t()` (P2, Strang C) — ohne Alpine/welshman, ohne `window`
 * (läuft unter `node --test`, siehe Kopf von `roomFingerprint.test.ts`).
 *
 * Deckt Punkt 7 der Phasen-Anforderung:
 *  - fehlender Schlüssel → deutscher Quelltext (identisch zu Laravels `__()`)
 *  - Platzhalter-Ersetzung, inkl. der Kollision "längster Schlüssel zuerst"
 *  - Verhalten OHNE `window` — der Normalfall in dieser Testumgebung selbst,
 *    UND nach explizitem Entfernen eines zuvor gesetzten `window`.
 *
 * `window` existiert unter Node nicht global — für die "mit Katalog"-Fälle wird
 * es hier bewusst als Testdouble gesetzt und danach wieder entfernt, damit
 * spätere Tests in dieser Datei (und mögliche Nachbardateien im selben
 * Prozess) nicht leaken.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { t } from './i18n.ts'

test('ohne window: ein Schlüssel liefert sich selbst (deutscher Quelltext)', () => {
    assert.equal(typeof (globalThis as { window?: unknown }).window, 'undefined') // Vorbedingung
    assert.equal(t('Nicht verbunden'), 'Nicht verbunden')
})

test('ein Katalog-Eintrag übersetzt den Schlüssel', () => {
    ;(globalThis as unknown as { window: { __nostrI18n: Record<string, string> } }).window = {
        __nostrI18n: { Speichern: 'Save' },
    }
    try {
        assert.equal(t('Speichern'), 'Save')
    } finally {
        delete (globalThis as { window?: unknown }).window
    }
})

test('ein im Katalog FEHLENDER Schlüssel bleibt deutsch, auch wenn ein Katalog existiert', () => {
    ;(globalThis as unknown as { window: { __nostrI18n: Record<string, string> } }).window = {
        __nostrI18n: { Speichern: 'Save' },
    }
    try {
        assert.equal(t('Ein Schlüssel, der in keiner Übersetzung steht'), 'Ein Schlüssel, der in keiner Übersetzung steht')
    } finally {
        delete (globalThis as { window?: unknown }).window
    }
})

test('nach dem Entfernen von window fällt t() wieder auf den deutschen Quelltext zurück', () => {
    ;(globalThis as unknown as { window: { __nostrI18n: Record<string, string> } }).window = {
        __nostrI18n: { Speichern: 'Save' },
    }
    delete (globalThis as { window?: unknown }).window

    assert.equal(t('Speichern'), 'Speichern')
})

// ── Platzhalter-Ersetzung ────────────────────────────────────────────────

test('ein :platzhalter wird ersetzt (auch ohne Katalog, direkt am Quelltext)', () => {
    assert.equal(t('Hallo :name', { name: 'Satoshi' }), 'Hallo Satoshi')
})

test('Zahlen-Platzhalter werden zu String gerendert', () => {
    assert.equal(t(':count Nachrichten', { count: 3 }), '3 Nachrichten')
})

test('mehrere Platzhalter werden alle ersetzt', () => {
    assert.equal(t(':a und :b', { a: 'X', b: 'Y' }), 'X und Y')
})

/**
 * Die eigentliche Falle (wie in Laravels `Translator::makeReplacements`):
 * ":c" ist ein Teilstring-Präfix von ":count". Ohne "längster Schlüssel
 * zuerst" ersetzte ein naiver Durchlauf ":c" ZUERST und zerschnitte ":count"
 * mitten im Wort (":c" + "ount" bliebe als Fragment stehen, ":count" würde nie
 * vollständig ersetzt). Die Implementierung sortiert absteigend nach Länge —
 * dieser Test verankert genau das Ergebnis, das nur bei korrekter Reihenfolge
 * entsteht.
 */
test('Platzhalter-Kollision: ":count" wird VOLLSTÄNDIG ersetzt, nicht nur sein Präfix ":c"', () => {
    assert.equal(t(':c :count', { c: 'X', count: 'Y' }), 'X Y')
})

test('ohne Ersetzungs-Argument bleibt ein :platzhalter-Literal unverändert', () => {
    assert.equal(t('Hallo :name'), 'Hallo :name')
})
