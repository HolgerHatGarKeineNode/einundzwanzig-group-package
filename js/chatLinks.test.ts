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

// Regression 2026-07-24: welshmans parseLink linkt jedes wort.wort und setzt
// https:// davor. Im Chat gepostete Code-Snippets (Alpine-Store-Zugriffe,
// Dateinamen mit .ts-Endung, $store.unread-Pfade) wurden so zu URLs:
//   "Schau mal: Alpine.store('unread')"  →  <a href="https://alpine.store">…</a>
// isPlausibleUrl filtert post-parse diese Token raus. Policy nach Nutzer-Vorgabe:
// NUR http:// und https:// sind Links, alles andere (auch nackte domain.tld,
// wss:, mailto:, lightning:) fällt auf Plaintext zurück.
// Die echten Faelle aus dem Bug-Report stehen jeweils als eigener Test, damit ein
// Regression sofort zeigt, welcher Token wieder durchrutscht.
import { isPlausibleUrl } from './chatLinks.ts'

test('Alpine.store wird NICHT als URL erkannt (Bug-Report 2026-07-24)', () => {
    assert.equal(isPlausibleUrl("Alpine.store"), false)
})

test('readState.ts wird NICHT als URL erkannt', () => {
    assert.equal(isPlausibleUrl('readState.ts'), false)
})

test('$store.unread wird NICHT als URL erkannt', () => {
    assert.equal(isPlausibleUrl('store.unread'), false)
})

test('readStateSync.ts wird NICHT als URL erkannt', () => {
    assert.equal(isPlausibleUrl('readStateSync.ts'), false)
})

test('Variable.eigenschaft NICHT als URL', () => {
    assert.equal(isPlausibleUrl('config.app_name'), false)
})

// Positive Faelle: einzige Links nach Policy sind http:// und https://.
test('https-URL ist plausibel', () => {
    assert.equal(isPlausibleUrl('https://example.com/path?t=1#x'), true)
})

test('http-URL ist plausibel', () => {
    assert.equal(isPlausibleUrl('http://example.com'), true)
})

test('https-GROSSSCHREIBUNG ist plausibel (Schema case-insensitive)', () => {
    assert.equal(isPlausibleUrl('HTTPS://example.com'), true)
})

test('http-GROSSSCHREIBUNG ist plausibel', () => {
    assert.equal(isPlausibleUrl('HTTP://example.com'), true)
})

// Alle nicht-http-Schemas fallen raus (Policy: nur http/https, sonst nichts).
// mailto:/lightning: laufen in welshman ohnehin über eigene Node-Typen und werden
// separat gerendert; der Filter hier trifft nur Link-Nodes.
test('wss-URL ist NICHT plausibel (nur http/https)', () => {
    assert.equal(isPlausibleUrl('wss://relay.example.com'), false)
})

test('ws-URL ist NICHT plausibel', () => {
    assert.equal(isPlausibleUrl('ws://relay.example.com'), false)
})

test('ftp-URL ist NICHT plausibel', () => {
    assert.equal(isPlausibleUrl('ftp://example.com'), false)
})

test('mailto ist NICHT plausibel', () => {
    assert.equal(isPlausibleUrl('mailto:jemand@example.com'), false)
})

test('lightning-Invoice ist NICHT plausibel', () => {
    assert.equal(isPlausibleUrl('lightning:lnbc100n1pjd…'), false)
})

// Nackte Domains (selbst bekannte TLDs) sind KEINE Links mehr.
test('nackte domain.com ist NICHT plausibel', () => {
    assert.equal(isPlausibleUrl('example.com'), false)
})

test('nackte Subdomain fountain.fm ist NICHT plausibel', () => {
    assert.equal(isPlausibleUrl('fountain.fm/episode/abc'), false)
})

test('nackte einundzwanzig.space ist NICHT plausibel', () => {
    assert.equal(isPlausibleUrl('einundzwanzig.space'), false)
})

test('nackte example.de ist NICHT plausibel', () => {
    assert.equal(isPlausibleUrl('example.de'), false)
})

test('nackte example.io ist NICHT plausibel', () => {
    assert.equal(isPlausibleUrl('example.io/path'), false)
})

// Edge: leere / kranke Eingaben. Fail-closed, nie Link.
test('leerer String ist nicht plausibel', () => {
    assert.equal(isPlausibleUrl(''), false)
})

test('nur Punkt ist nicht plausibel', () => {
    assert.equal(isPlausibleUrl('.'), false)
})

test('TLD-Jonglage ohne Schema ist nicht plausibel', () => {
    assert.equal(isPlausibleUrl('a.b.c.unbekanntetld'), false)
})

test('pseudo-Schema tcp:// ist NICHT plausibel', () => {
    assert.equal(isPlausibleUrl('tcp://example.com'), false)
})

test('http-Match im Inneren reicht NICHT (muss am Anfang stehen)', () => {
    assert.equal(isPlausibleUrl('siehe https://example.com'), false)
})
