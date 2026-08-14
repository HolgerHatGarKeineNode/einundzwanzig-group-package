/**
 * Pure-Tests für `locale.ts` (P3, Schritt 4) — ohne Alpine/welshman, ohne Browser
 * (läuft unter `node --test`, wie `i18n.test.ts` daneben).
 *
 * Zwei Aussagen tragen die Phase:
 *
 *  1. **Die Sprache kommt aus `<html lang>`** — dem Attribut, das das Layout aus
 *     `app()->getLocale()` rendert. Umschalten ändert das Format WIRKLICH, nicht
 *     nur theoretisch.
 *  2. **Der Formatter-Cache friert die Sprache nicht ein.** Genau das war die
 *     Falle des vorherigen `_dateFmtCache` in `bridge.ts`: einmal gebaut, für
 *     immer deutsch. Der Test wechselt die Sprache NACH dem ersten Aufruf —
 *     träte der Cache in Kraft, käme zweimal dasselbe heraus.
 *
 * `document` existiert unter Node nicht; es wird hier als Testdouble gesetzt und
 * danach wieder entfernt, damit Nachbardateien im selben Prozess nichts erben.
 */
import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { FALLBACK, formatNumber, formatTimestamp, islandLocale, pluralCategory } from './locale.ts'

/** `<html lang="…">` setzen — dieselbe Stelle, die `einundzwanzig.blade.php` rendert. */
const setLang = (lang: string): void => {
    ;(globalThis as unknown as { document: { documentElement: { lang: string } } }).document = {
        documentElement: { lang },
    }
}

afterEach(() => {
    delete (globalThis as { document?: unknown }).document
})

// ── Woher die Sprache kommt ─────────────────────────────────────────────────

test('ohne document gilt die Standardsprache des Hauses', () => {
    assert.equal(typeof (globalThis as { document?: unknown }).document, 'undefined') // Vorbedingung
    assert.equal(islandLocale(), FALLBACK)
    assert.equal(FALLBACK, 'de')
})

test('die Sprache kommt aus <html lang>', () => {
    setLang('es')
    assert.equal(islandLocale(), 'es')
})

test('ein leeres oder nur-Leerzeichen-lang fällt auf die Standardsprache zurück', () => {
    setLang('   ')
    assert.equal(islandLocale(), FALLBACK)
})

/**
 * Laravel liefert einen reinen Sprachcode (`de`, nicht `de-DE`) — dieser Test
 * hält fest, dass genau der durchgereicht wird. Eine erfundene Region wäre eine
 * Behauptung über den Aufenthaltsort des Nutzers.
 */
test('keine erfundene Region: der Sprachcode geht unverändert an Intl', () => {
    setLang('de')
    assert.equal(islandLocale(), 'de')
    assert.equal(formatNumber(1234), (1234).toLocaleString('de'))
})

// ── Zahlen ─────────────────────────────────────────────────────────────────

test('Zahlen folgen der Sprache: de „1.234", en „1,234"', () => {
    setLang('de')
    assert.equal(formatNumber(1234), '1.234')
    setLang('en')
    assert.equal(formatNumber(1234), '1,234')
})

/**
 * DER Cache-Test für Zahlen: derselbe Aufruf, nur die Sprache dazwischen
 * gewechselt. Ein sprachloser Cache lieferte hier zweimal „1.234".
 */
test('der Zahl-Cache friert die Sprache nicht ein', () => {
    setLang('de')
    const zuerst = formatNumber(21000)
    setLang('en')
    const danach = formatNumber(21000)

    assert.equal(zuerst, '21.000')
    assert.equal(danach, '21,000')
    assert.notEqual(zuerst, danach)
})

// ── Daten ──────────────────────────────────────────────────────────────────

/** 2026-01-01 12:00 Ortszeit als Unix-Sekunde — kein UTC-Literal, sonst kippt der Tag. */
const NEUJAHR = Math.floor(new Date(2026, 0, 1, 12, 0, 0).getTime() / 1000)
const LANG_DATE: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long', year: 'numeric' }

test('Datumslabels folgen der Sprache (Monatsname UND Reihenfolge)', () => {
    setLang('de')
    assert.equal(formatTimestamp(NEUJAHR, LANG_DATE), '1. Januar 2026')
    setLang('es')
    assert.equal(formatTimestamp(NEUJAHR, LANG_DATE), '1 de enero de 2026')
    setLang('en')
    assert.equal(formatTimestamp(NEUJAHR, LANG_DATE), 'January 1, 2026')
})

/**
 * Derselbe Cache-Beweis für `Intl.DateTimeFormat` — das war die konkrete Stelle
 * (`bridge.ts _dateFmtCache`), an der ein global gehaltener Formatter die Sprache
 * eingefroren hätte. Gleiche Optionen, andere Sprache ⇒ anderer Eintrag.
 */
test('der Datums-Cache friert die Sprache nicht ein', () => {
    setLang('de')
    const zuerst = formatTimestamp(NEUJAHR, LANG_DATE)
    setLang('pl')
    const danach = formatTimestamp(NEUJAHR, LANG_DATE)

    assert.notEqual(zuerst, danach)
    assert.equal(zuerst, '1. Januar 2026')
    assert.equal(danach, '1 stycznia 2026')
})

test('unter „de" ist die Ausgabe bitgleich zur alten harten Formatierung', () => {
    setLang('de')
    const d = new Date(NEUJAHR * 1000)

    assert.equal(formatTimestamp(NEUJAHR, LANG_DATE), d.toLocaleDateString('de-DE', LANG_DATE))
    assert.equal(
        formatTimestamp(NEUJAHR, { hour: '2-digit', minute: '2-digit' }),
        d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }),
    )
    assert.equal(
        formatTimestamp(NEUJAHR, { dateStyle: 'medium', timeStyle: 'short' }),
        d.toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' }),
    )
    assert.equal(formatNumber(21000), (21000).toLocaleString('de-DE'))
})

// ── Zählformen (P3, Schritt 3) ───────────────────────────────────────────────

/*
 * `pluralCategory` ist die halbe Miete der dritten Zählform: sie beantwortet die
 * INTL-Frage („in welche Form fällt 22 auf Polnisch?"), während `tPlural` drüben
 * in `i18n.ts` den passenden Katalogeintrag sucht.
 *
 * Die Fälle hier prüfen genau die Zahlen, an denen ein selbstgebautes
 * `count === 1 ?` falsch liegt — und die drei Fallen, die erst die Messung
 * zutage gefördert hat: pl unterscheidet 12–14 von 22, lv zählt 21 als „one",
 * und pt zählt die NULL als „one".
 */

test('pl kennt vier Formen, inklusive der Ausnahme bei 12–14', () => {
    setLang('pl')
    assert.equal(pluralCategory(1), 'one')
    assert.equal(pluralCategory(2), 'few')
    assert.equal(pluralCategory(3), 'few')
    assert.equal(pluralCategory(4), 'few')
    assert.equal(pluralCategory(5), 'many')
    // Die bekannte Ausnahme: 12–14 sind NICHT `few`, obwohl sie auf 2–4 enden.
    assert.equal(pluralCategory(12), 'many')
    assert.equal(pluralCategory(13), 'many')
    assert.equal(pluralCategory(14), 'many')
    // 22 dagegen schon — genau der Unterschied, den ein Ternary nie träfe.
    assert.equal(pluralCategory(22), 'few')
    assert.equal(pluralCategory(0), 'many')
})

test('lv kennt drei Formen — und 21 fällt in „one", nicht in „other"', () => {
    setLang('lv')
    assert.equal(pluralCategory(0), 'zero')
    assert.equal(pluralCategory(1), 'one')
    assert.equal(pluralCategory(2), 'other')
    // Alles auf 1 AUSSER 11: das ist der Grund, warum die `one`-Form im Katalog
    // eine `:count`-Variante braucht — „1 telpa" verschluckte hier die 21.
    assert.equal(pluralCategory(21), 'one')
    assert.equal(pluralCategory(101), 'one')
    assert.equal(pluralCategory(11), 'zero')
    assert.equal(pluralCategory(19), 'zero')
})

test('pt zählt die NULL als „one" — die Falle, die keine Vermutung hergegeben hätte', () => {
    setLang('pt')
    assert.equal(pluralCategory(0), 'one')
    assert.equal(pluralCategory(1), 'one')
    assert.equal(pluralCategory(2), 'other')
})

test('die sechs übrigen Sprachen trennen genau bei 1', () => {
    for (const lang of ['de', 'en', 'es', 'nl', 'hu']) {
        setLang(lang)
        assert.equal(pluralCategory(1), 'one', lang)
        for (const n of [0, 2, 5, 11, 21, 22, 101]) {
            assert.equal(pluralCategory(n), 'other', `${lang} bei ${n}`)
        }
    }
})

/**
 * Der Rückfall ist der Fall, der in Produktion auftritt — eine Laufzeit ohne
 * (vollständiges) ICU. Dann muss GENAU das alte Verhalten gelten, nicht ein
 * Fehler und nicht eine fremde Sprache.
 */
test('ohne Intl.PluralRules gilt das alte Verhalten: one für 1, sonst other', () => {
    /*
     * Die Sprache muss eine sein, die in diesem Prozess noch NIE gefragt wurde:
     * der Cache hält das gebaute `Intl.PluralRules`-Objekt, nicht den
     * Konstruktor — ein nachträglich entfernter `Intl.PluralRules` erreicht
     * einen bereits gefüllten Eintrag nicht mehr. Das ist kein Mangel des
     * Caches (eine echte Laufzeit hat ICU entweder von Anfang an oder nie),
     * aber es entscheidet, ob dieser Fall den Rückfall wirklich betritt.
     * `lt` steht in keinem anderen Fall dieser Datei.
     */
    setLang('lt')
    // `Intl.PluralRules` ist im Typ read-only; für das Nachstellen einer Laufzeit
    // OHNE ICU muss es hier trotzdem verschwinden und danach zurückkommen.
    const intl = Intl as unknown as { PluralRules?: typeof Intl.PluralRules }
    const echt = intl.PluralRules
    delete intl.PluralRules
    try {
        assert.equal(pluralCategory(1), 'one')
        assert.equal(pluralCategory(2), 'other')
        assert.equal(pluralCategory(5), 'other')
    } finally {
        intl.PluralRules = echt
    }
})

test('ein nicht-endlicher Zähler fällt auf other, statt zu werfen', () => {
    setLang('pl')
    assert.equal(pluralCategory(Number.NaN), 'other')
    assert.equal(pluralCategory(Number.POSITIVE_INFINITY), 'other')
})

/** Dieselbe Cache-Falle wie bei den Formattern: die Sprache steht im Schlüssel. */
test('der PluralRules-Cache friert die Sprache nicht ein', () => {
    setLang('de')
    assert.equal(pluralCategory(3), 'other')
    setLang('pl')
    assert.equal(pluralCategory(3), 'few')
})
