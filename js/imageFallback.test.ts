/**
 * P7 — Unit-Tests des Bild-Fallback-Klassifizierers (`imageFallback.ts`).
 *
 * Im Gegensatz zu `longform.test.ts` (das `proxifyImage`s Vertrag nur spiegelt,
 * weil `core.ts` unter `node --test` nicht ladbar ist — welshman-Imports ohne
 * Extension) testet diese Datei den ECHTEN Code: `imageFallback.ts` ist Import-frei
 * und direkt ladbar. Die Fälle sind die Policy-Klassen des Proxys
 * (`ImageProxyController::isSafeUrl`) plus die Angreifer-URLs aus der gemessenen
 * Reproduktion (`docs/plans/…/p7-proxy-repro-vorher.log`).
 *
 * Lauf: node --test packages/einundzwanzig-group/js/imageFallback.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mayFallbackToRaw } from './imageFallback.ts'

test('Angreifer-Klasse aus der Reproduktion: nie roh laden', () => {
    assert.equal(mayFallbackToRaw('//evil.example/x.png'), false, 'protokoll-relativ (Tür 1/2/4-Seed)')
    assert.equal(mayFallbackToRaw('http://evil.example/meetup.png'), false, 'http-Schema (Tür 3/5-Seed)')
    assert.equal(mayFallbackToRaw('http://evil.example/inline.png'), false, 'http-Schema, Chat-Inline')
})

test('legitime https-Bilder: Roh-Rückfall erlaubt (Upstream-Versagen des Proxys)', () => {
    assert.equal(mayFallbackToRaw('https://robohash.org/vip.png'), true)
    assert.equal(mayFallbackToRaw('https://example.com/a/b/c.webp?q=1'), true)
    assert.equal(mayFallbackToRaw('HTTPS://EXAMPLE.COM/x.png'), true, 'Schema-Großschreibung')
    assert.equal(mayFallbackToRaw('  https://example.com/x.png  '), true, 'Leerraum wie im Browser-Trim')
})

test('private/reservierte Host-Literale: nie roh laden (Proxy-Policy gespiegelt)', () => {
    assert.equal(mayFallbackToRaw('https://127.0.0.1/x.png'), false, 'loopback v4')
    assert.equal(mayFallbackToRaw('https://10.1.2.3/x.png'), false, 'RFC1918 10/8')
    assert.equal(mayFallbackToRaw('https://172.16.0.1/x.png'), false, 'RFC1918 172.16/12 (untere Grenze)')
    assert.equal(mayFallbackToRaw('https://172.31.255.255/x.png'), false, 'RFC1918 172.16/12 (obere Grenze)')
    assert.equal(mayFallbackToRaw('https://192.168.1.1/x.png'), false, 'RFC1918 192.168/16')
    assert.equal(mayFallbackToRaw('https://169.254.1.1/x.png'), false, 'link-local')
    assert.equal(mayFallbackToRaw('https://100.64.0.1/x.png'), false, 'CGNAT 100.64/10')
    assert.equal(mayFallbackToRaw('https://192.0.2.1/x.png'), false, 'TEST-NET-1')
    assert.equal(mayFallbackToRaw('https://224.0.0.1/x.png'), false, 'multicast')
    assert.equal(mayFallbackToRaw('https://localhost/x.png'), false, 'localhost-Name')
    assert.equal(mayFallbackToRaw('https://foo.localhost/x.png'), false, 'subdomain von localhost')
    assert.equal(mayFallbackToRaw('https://box.internal/x.png'), false, 'interne Namenskonvention')
    assert.equal(mayFallbackToRaw('https://[::1]/x.png'), false, 'loopback v6')
    assert.equal(mayFallbackToRaw('https://[fe80::1]/x.png'), false, 'link-local v6')
    assert.equal(mayFallbackToRaw('https://[fd00::1]/x.png'), false, 'ULA v6')
    assert.equal(mayFallbackToRaw('https://[::ffff:10.0.0.1]/x.png'), false, 'v4-mapped privat')
})

test('öffentliche IP-Literale bleiben erlaubt (Proxy nimmt sie auch)', () => {
    assert.equal(mayFallbackToRaw('https://93.184.216.34/x.png'), true, 'öffentliche v4')
    assert.equal(mayFallbackToRaw('https://[2606:2800:220:1:248:1893:25c8:1946]/x.png'), true, 'öffentliche v6')
    assert.equal(mayFallbackToRaw('https://[::ffff:93.184.216.34]/x.png'), true, 'v4-mapped öffentlich')
})

test('kein Fremdziel: Inline-Schemata, relative Pfade, Leer, Nicht-Strings', () => {
    assert.equal(mayFallbackToRaw('data:image/png;base64,iVBOR…'), false, 'data: (Fehler am Inline-src ist endgültig)')
    assert.equal(mayFallbackToRaw('blob:https://example.com/uuid'), false, 'blob:')
    assert.equal(mayFallbackToRaw('/bilder/x.png'), false, 'relativer Pfad')
    assert.equal(mayFallbackToRaw(''), false, 'leer')
    assert.equal(mayFallbackToRaw(undefined), false, 'undefined')
    assert.equal(mayFallbackToRaw(42), false, 'Zahl statt String')
    assert.equal(mayFallbackToRaw('ftp://example.com/x.png'), false, 'unbekanntes Schema')
    assert.equal(mayFallbackToRaw('https:///x.png'), false, 'https ohne Host')
})
