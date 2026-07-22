/**
 * Pure-Tests fuer die Link-Anzeige im Chat (welshman-frei).
 * Laeuft ohne neue Dependency ueber Nodes eingebauten Test-Runner + TS-Type-Stripping:
 *   node --test packages/einundzwanzig-group/js/chatLinks.test.ts
 *
 * Kern der Regression: welshmans `renderLink` zeigt nur `host + pathname` — Schema und
 * Query-String fallen weg, ein `?t=1234` verschwindet aus der Anzeige. Gemeldet an
 * einem fountain.fm-Episodenlink mit Timestamp.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { linkDisplay } from './chatLinks.ts'

// Das gemeldete Original: welshman lieferte `fountain.fm/episode/glkhDHV6IFZWkNySFSg3`
// und schluckte den Timestamp. Genau der muss sichtbar bleiben.
test('Query-String bleibt in der Anzeige erhalten', () => {
    assert.equal(
        linkDisplay('https://fountain.fm/episode/glkhDHV6IFZWkNySFSg3?t=2145', 'fountain.fm/episode/glkhDHV6IFZWkNySFSg3'),
        'https://fountain.fm/episode/glkhDHV6IFZWkNySFSg3?t=2145',
    )
})

test('mehrere Query-Parameter bleiben vollstaendig', () => {
    assert.equal(linkDisplay('https://example.com/watch?v=abc&t=90s', ''), 'https://example.com/watch?v=abc&t=90s')
})

test('Fragment bleibt erhalten', () => {
    assert.equal(linkDisplay('https://example.com/doc#kapitel-3', ''), 'https://example.com/doc#kapitel-3')
})

// Schema MUSS sichtbar sein: sonst ist http nicht von https zu unterscheiden.
test('Schema wird angezeigt', () => {
    assert.equal(linkDisplay('https://example.com/a', ''), 'https://example.com/a')
})

test('http bleibt als http erkennbar', () => {
    assert.equal(linkDisplay('http://example.com/a', ''), 'http://example.com/a')
})

// welshman-Verhalten, das erhalten bleibt: ein nackter Slash ist kein Pfad.
test('nackter Root-Slash entfaellt', () => {
    assert.equal(linkDisplay('https://example.com/', ''), 'https://example.com')
})

test('Root mit Query behaelt den Slash-Pfad nicht, aber die Query', () => {
    assert.equal(linkDisplay('https://example.com/?ref=nostr', ''), 'https://example.com?ref=nostr')
})

test('Port bleibt Teil des Hosts', () => {
    assert.equal(linkDisplay('http://localhost:8000/x?y=1', ''), 'http://localhost:8000/x?y=1')
})

// Schemas ohne Host bekommen KEIN `//` untergeschoben.
test('mailto behaelt seine Form ohne doppelten Slash', () => {
    assert.equal(linkDisplay('mailto:jemand@example.com', ''), 'mailto:jemand@example.com')
})

// Nie eine leere Beschriftung: unparsebares faellt auf welshmans Anzeige zurueck.
test('unparsebare URL faellt auf den Fallback zurueck', () => {
    assert.equal(linkDisplay('nicht mal ansatzweise eine url', 'fallback-text'), 'fallback-text')
})
