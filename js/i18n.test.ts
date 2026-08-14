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
import { t, tPlural } from './i18n.ts'

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

// ── Numerus mit den Regeln der Zielsprache (P3, Schritt 3) ───────────────────

/*
 * `tPlural` verheiratet die zwei Hälften: `pluralCategory` (in `locale.ts`)
 * beantwortet die Intl-Frage, hier fällt die Wahl des KATALOGEINTRAGS.
 *
 * Die Fälle laufen von unten nach oben durch die Suchkette — und der wichtigste
 * ist NICHT der glückliche: was passiert, wenn die Sonderform fehlt. Genau das
 * ist der Zustand, in dem eine Sprache in Produktion steht, solange sie noch
 * niemand vollständig gepflegt hat.
 */
const RAUM = { one: '1 Raum', other: ':count Räume' }

/** `<html lang>` + Katalog gemeinsam setzen — beide Quellen, die `tPlural` liest. */
const setUmgebung = (lang: string, katalog: Record<string, string>): void => {
    ;(globalThis as unknown as { document: { documentElement: { lang: string } } }).document = {
        documentElement: { lang },
    }
    ;(globalThis as unknown as { window: { __nostrI18n: Record<string, string> } }).window = {
        __nostrI18n: katalog,
    }
}

const raeumUmgebungAuf = (): void => {
    delete (globalThis as { document?: unknown }).document
    delete (globalThis as { window?: unknown }).window
}

test('de ohne Katalog: die Ausgabe ist Zeichen für Zeichen die von vorher', () => {
    try {
        setUmgebung('de', {})
        assert.equal(tPlural(RAUM, 1), '1 Raum')
        assert.equal(tPlural(RAUM, 0), '0 Räume')
        assert.equal(tPlural(RAUM, 2), '2 Räume')
        assert.equal(tPlural(RAUM, 22), '22 Räume')
    } finally {
        raeumUmgebungAuf()
    }
})

test('en mit Katalog nimmt die zwei Grundformen — ohne jede Sonderform', () => {
    try {
        setUmgebung('en', { '1 Raum': '1 room', ':count Räume': ':count rooms' })
        assert.equal(tPlural(RAUM, 1), '1 room')
        assert.equal(tPlural(RAUM, 7), '7 rooms')
    } finally {
        raeumUmgebungAuf()
    }
})

test('pl greift für 2–4 die #few-Sonderform und für 5+ die Grundform', () => {
    try {
        setUmgebung('pl', {
            '1 Raum': '1 pokój',
            ':count Räume': ':count pokoi',
            ':count Räume#few': ':count pokoje',
        })
        assert.equal(tPlural(RAUM, 1), '1 pokój')
        assert.equal(tPlural(RAUM, 3), '3 pokoje')
        assert.equal(tPlural(RAUM, 5), '5 pokoi')
        // Die Ausnahmen, an denen ein Ternary und ein naives „endet auf 2–4" scheitern.
        assert.equal(tPlural(RAUM, 12), '12 pokoi')
        assert.equal(tPlural(RAUM, 22), '22 pokoje')
    } finally {
        raeumUmgebungAuf()
    }
})

test('lv trennt 0, 1 und 2 — und 21 verliert seine Zahl NICHT', () => {
    try {
        setUmgebung('lv', {
            '1 Raum': '1 telpa',
            ':count Räume': ':count telpas',
            ':count Räume#one': ':count telpa',
            ':count Räume#zero': ':count telpu',
        })
        assert.equal(tPlural(RAUM, 0), '0 telpu')
        assert.equal(tPlural(RAUM, 1), '1 telpa')
        assert.equal(tPlural(RAUM, 2), '2 telpas')
        assert.equal(tPlural(RAUM, 11), '11 telpu')
        // Der eigentliche Punkt der #one-Variante: ohne sie stünde hier „1 telpa".
        assert.equal(tPlural(RAUM, 21), '21 telpa')
    } finally {
        raeumUmgebungAuf()
    }
})

test('pt: die NULL fällt in one — mit #one behält sie ihre Zahl', () => {
    try {
        setUmgebung('pt', {
            '1 Raum': '1 sala',
            ':count Räume': ':count salas',
            ':count Räume#one': ':count sala',
        })
        assert.equal(tPlural(RAUM, 0), '0 sala')
        assert.equal(tPlural(RAUM, 1), '1 sala')
        assert.equal(tPlural(RAUM, 2), '2 salas')
    } finally {
        raeumUmgebungAuf()
    }
})

// ── Der Rückfall — der Fall, der in Produktion auftritt ──────────────────────

test('fehlt die Sonderform, erscheint die Grundform — nie der rohe Schlüssel', () => {
    try {
        // Polnischer Katalog OHNE #few: 3 muss auf die `other`-Grundform fallen,
        // also auf genau das, was vor dieser Änderung dort stand.
        setUmgebung('pl', { '1 Raum': '1 pokój', ':count Räume': ':count pokoi' })
        assert.equal(tPlural(RAUM, 3), '3 pokoi')
        assert.equal(tPlural(RAUM, 1), '1 pokój')
    } finally {
        raeumUmgebungAuf()
    }
})

test('fehlt auch die Grundform, erscheint der deutsche Quelltext — nie ein sichtbares #few', () => {
    try {
        setUmgebung('pl', {})
        assert.equal(tPlural(RAUM, 3), '3 Räume')
        assert.equal(tPlural(RAUM, 1), '1 Raum')
        assert.ok(!tPlural(RAUM, 3).includes('#'))
    } finally {
        raeumUmgebungAuf()
    }
})

test('ein LEERER Katalogwert verdrängt die Grundform nicht', () => {
    try {
        // Der leere String ist die Narbe der alten Fragment-Verkettung. Träte er
        // als gültige Sonderform auf, verschwände die Zeile spurlos.
        setUmgebung('pl', { '1 Raum': '1 pokój', ':count Räume': ':count pokoi', ':count Räume#few': '' })
        assert.equal(tPlural(RAUM, 3), '3 pokoi')
    } finally {
        raeumUmgebungAuf()
    }
})

test('weitere Platzhalter neben :count werden mitgefüllt', () => {
    const THREAD = {
        one: '1 Antwort, letzte :time — Thread öffnen',
        other: ':count Antworten, letzte :time — Thread öffnen',
    }
    try {
        setUmgebung('de', {})
        assert.equal(tPlural(THREAD, 1, { time: 'vor 5 Min' }), '1 Antwort, letzte vor 5 Min — Thread öffnen')
        assert.equal(tPlural(THREAD, 4, { time: 'vor 5 Min' }), '4 Antworten, letzte vor 5 Min — Thread öffnen')
    } finally {
        raeumUmgebungAuf()
    }
})
