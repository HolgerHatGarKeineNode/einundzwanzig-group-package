/**
 * Pure-Tests fuer die NIP-30-Tag-Ableitung des Composer-Emoji-Buttons (C1, PLAN4).
 * Laeuft ohne neue Dependency ueber Nodes eingebauten Test-Runner + TS-Type-Stripping:
 *   node --test packages/einundzwanzig-group/js/emojiTags.test.ts
 *
 * Die sechs Faelle unten sind die, die der Autor beim Bauen manuell durchgespielt hat
 * (siehe emojiTags.ts-Kopf) — hier als Regression festgeschrieben, damit sie nicht
 * wieder von Hand geprueft werden muessen.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { emojiTagsForContent, type EmojiRef } from './emojiTags.ts'

// Zwei bekannte Custom-Emojis des Profils — Reihenfolge in der Liste ist bewusst
// NICHT die Reihenfolge, in der sie im Text vorkommen (siehe Test 2).
const PEPE: EmojiRef = { shortcode: 'pepe', url: 'https://robohash.org/pepe.png' }
const KEK: EmojiRef = { shortcode: 'kek', url: 'https://robohash.org/kek.png' }
const CUSTOM = [PEPE, KEK]

// 1) eingefuegt — ein einzelnes bekanntes Shortcode im Text bekommt sein Tag.
test('eingefuegtes Custom-Emoji bekommt sein emoji-Tag', () => {
    assert.deepEqual(emojiTagsForContent('Schau mal :pepe: an', CUSTOM), [
        ['emoji', 'pepe', 'https://robohash.org/pepe.png'],
    ])
})

// 2) von Hand getippt (mehrere) — die Reihenfolge der Tags folgt dem TEXT, nicht der
// Reihenfolge in der custom-Liste (dort steht pepe vor kek, im Text ist es umgekehrt).
test('mehrere getippte Shortcodes: Tag-Reihenfolge = Vorkommen im Text, nicht die der Emoji-Liste', () => {
    assert.deepEqual(emojiTagsForContent('Erst :kek: und dann :pepe:', CUSTOM), [
        ['emoji', 'kek', 'https://robohash.org/kek.png'],
        ['emoji', 'pepe', 'https://robohash.org/pepe.png'],
    ])
})

// 3) doppelt vorkommend — zweimal derselbe Shortcode im Text ergibt trotzdem nur EIN Tag.
test('doppelt vorkommendes Shortcode erzeugt nur EIN Tag (dedupliziert)', () => {
    const tags = emojiTagsForContent(':pepe: haha :pepe: nochmal', CUSTOM)
    assert.equal(tags.length, 1)
    assert.deepEqual(tags, [['emoji', 'pepe', 'https://robohash.org/pepe.png']])
})

// 4) geloescht — der Shortcode steht nicht mehr im (finalen) Text → kein Tag. Das ist
// der Kern der ganzen Ableitung: es gibt keine mitgefuehrte „ich habe X eingefuegt"-Liste.
test('geloeschtes Emoji (nicht mehr im Text) hinterlaesst kein Tag', () => {
    assert.deepEqual(emojiTagsForContent('Text ganz ohne Emoji mehr', CUSTOM), [])
})

// 5) unbekannter Shortcode — ':irgendwas:' ist syntaktisch ein Treffer, aber nicht in
// der eigenen Custom-Emoji-Liste registriert → kein Tag.
test('unbekannter Shortcode bekommt kein Tag', () => {
    assert.deepEqual(emojiTagsForContent('Das ist :unbekannt: hier', CUSTOM), [])
})

// 6) Shortcode innerhalb einer URL — ein zufaellig ":wort:"-foermiges Pfadsegment einer
// URL matcht den Regex, ist aber (wie im gemeldeten Fall) kein bekanntes Emoji → kein
// Tag. Der Regex selbst kennt keine URL-Grenzen; der Schutz kommt allein daraus, dass
// nur BEKANNTE Shortcodes ein Tag bekommen (siehe emojiTags.ts-Kommentar).
test('ein Shortcode-foermiges Segment MITTEN in einer URL bekommt kein Tag, solange es kein bekanntes Emoji ist', () => {
    assert.deepEqual(
        emojiTagsForContent('Schau https://cdn.example.com/:notregistered:/thumb.png an', CUSTOM),
        [],
    )
})

// Rand: keine eigenen Custom-Emojis (frischer Nutzer / Snapshot noch leer) → nie ein Tag,
// auch wenn der Text wie ein Shortcode aussieht.
test('ohne eigene Custom-Emojis (leerer Snapshot) entsteht nie ein Tag', () => {
    assert.deepEqual(emojiTagsForContent(':pepe: :kek:', []), [])
})

// Rand: Text ganz ohne Doppelpunkt nimmt den Fruehausstieg — reine Absicherung, dass er
// nicht aus Versehen doch matcht.
test('Text ohne jeden Doppelpunkt bleibt taglos', () => {
    assert.deepEqual(emojiTagsForContent('Ganz normaler Text', CUSTOM), [])
})
