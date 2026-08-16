/**
 * Pure-Tests für die schmale Auszeichnungs-Schicht des Chats (welshman-frei).
 * Läuft ohne neue Dependency über Nodes eingebauten Test-Runner + TS-Type-Stripping:
 *   node --test packages/einundzwanzig-group/js/chatMarkup.test.ts
 *
 * Der Anlass (2026-08-16): eine Ankündigung mit `**21Meetup**` stand zeichengleich im
 * Verlauf — die Sterne waren sichtbar, weil der Chat gar keine Auszeichnung kannte.
 * Geprüft wird deshalb beides: dass die vier gewollten Marker greifen, und dass die
 * ausdrücklich ABGELEHNTEN Formen weiterhin unangetastet bleiben. Die zweite Hälfte ist
 * die wichtigere — sie hält die Entscheidung fest, nicht nur die Funktion.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyInlineMarkup, stripInlineMarkup } from './chatMarkup.ts'

// ── Was greifen soll ────────────────────────────────────────────────────────────────

test('**fett** wird zu <strong>', () => {
    assert.equal(applyInlineMarkup('**21Meetup** von'), '<strong>21Meetup</strong> von')
})

test('~~durchgestrichen~~ wird zu <del>', () => {
    assert.equal(applyInlineMarkup('~~alt~~ neu'), '<del>alt</del> neu')
})

test('mehrere Hervorhebungen in einer Zeile werden alle gesetzt', () => {
    assert.equal(
        applyInlineMarkup('**eins** und **zwei**'),
        '<strong>eins</strong> und <strong>zwei</strong>',
    )
})

test('verschachtelt: **~~x~~** trägt beide Elemente', () => {
    assert.equal(applyInlineMarkup('**~~weg~~**'), '<strong><del>weg</del></strong>')
})

// ── Was NICHT greifen darf ──────────────────────────────────────────────────────────

test('Potenzschreibweise mit Abstand bleibt Text — `2 ** 3 ** 4` ist keine Hervorhebung', () => {
    assert.equal(applyInlineMarkup('2 ** 3 ** 4'), '2 ** 3 ** 4')
})

test('ein einzelner Stern bleibt stehen (Multiplikation, Fußnote, Zensur)', () => {
    assert.equal(applyInlineMarkup('3 * 4 = 12'), '3 * 4 = 12')
    assert.equal(applyInlineMarkup('*kursiv wollen wir nicht*'), '*kursiv wollen wir nicht*')
})

test('Unterstriche bleiben unangetastet — sonst würde jeder Bezeichner kursiv', () => {
    assert.equal(applyInlineMarkup('foo_bar_baz und __init__'), 'foo_bar_baz und __init__')
})

test('über Zeilenumbrüche hinweg greift nichts — sonst zöge ein einzelnes ** den halben Text fett', () => {
    assert.equal(applyInlineMarkup('**offen\nzweite Zeile**'), '**offen\nzweite Zeile**')
})

test('ein unpaariger Marker bleibt sichtbar, statt den Rest zu verschlucken', () => {
    assert.equal(applyInlineMarkup('**nie geschlossen'), '**nie geschlossen')
})

test('abgelehnte Markdown-Formen bleiben Zeichen für Zeichen stehen', () => {
    // Jede dieser Zeilen ist eine EIGENE Entscheidung (Begründung im Modulkopf) —
    // greift eine davon eines Tages doch, ist das ein Regress und kein Feature.
    for (const roh of [
        '# Überschrift',
        '## Auch keine',
        '> zitiert',
        '- Aufzählung',
        '1. nummeriert',
        '[Text](https://example.com)',
        '![Bild](https://example.com/x.png)',
        '#bitcoin',
    ]) {
        assert.equal(applyInlineMarkup(roh), roh, `„${roh}" darf nicht ausgezeichnet werden`)
    }
})

test('escapte Eingabe bleibt escapt — die Funktion erzeugt NUR ihre eigenen Tags', () => {
    // Der Eingabestring ist bereits durch welshman gelaufen, `<` ist also `&lt;`.
    // Genau darauf beruht die Sicherheit: aus Nutzertext kann kein Markup entstehen.
    assert.equal(
        applyInlineMarkup('&lt;script&gt;alert(1)&lt;/script&gt; **fett**'),
        '&lt;script&gt;alert(1)&lt;/script&gt; <strong>fett</strong>',
    )
})

// ── Der Rohtext-Zwilling für Ausschnitte ────────────────────────────────────────────

test('stripInlineMarkup räumt fett, durchgestrichen und Code aus Ausschnitten', () => {
    assert.equal(stripInlineMarkup('**21Meetup** von ~~gestern~~ mit `code`'), '21Meetup von gestern mit code')
})

test('stripInlineMarkup lässt Code-Blöcke stehen, nur ohne Zäune', () => {
    assert.equal(stripInlineMarkup('vorher ```let x = 1``` nachher'), 'vorher let x = 1 nachher')
})

test('stripInlineMarkup fasst Text ohne Marker nicht an', () => {
    const roh = 'Ganz normale Nachricht mit https://example.com und #thema'
    assert.equal(stripInlineMarkup(roh), roh)
})

test('stripInlineMarkup lässt einen unpaarigen Marker stehen, statt Text zu fressen', () => {
    assert.equal(stripInlineMarkup('offen ** und `zu'), 'offen ** und `zu')
})
