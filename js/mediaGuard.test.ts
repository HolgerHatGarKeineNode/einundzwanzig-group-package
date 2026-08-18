/**
 * Die Wache vor dem Bild-Proxy — die Regel, die an EINER Stelle für alle 21
 * Avatar-Aufrufstellen, die Profilkarte, Chat-Anhänge, Artikelbilder und Custom-Emoji
 * gilt (alle laufen durch `proxifyImage`).
 *
 * Ausführen:
 *   node --experimental-strip-types --test packages/einundzwanzig-group/js/mediaGuard.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mayProxifyMedia } from './mediaGuard.ts'

const WORKSPACE = 'wss://buzz.einundzwanzig.space/'

test('Medien des Workspace-Relays gehen NIE an den Proxy', () => {
    assert.equal(mayProxifyMedia('https://buzz.einundzwanzig.space/media/a.jpg', WORKSPACE), false)
    // Auch ohne den `/media/`-Pfad: geschützt ist der HOST, nicht ein Pfadmuster.
    assert.equal(mayProxifyMedia('https://buzz.einundzwanzig.space/irgendwas.png', WORKSPACE), false)
})

test('alles andere bleibt unangetastet', () => {
    assert.equal(mayProxifyMedia('https://image.nostr.build/a.jpg', WORKSPACE), true)
    assert.equal(mayProxifyMedia('https://buzz.einundzwanzig.space.evil.tld/a.jpg', WORKSPACE), true)
    assert.equal(mayProxifyMedia('https://evil.tld/?x=buzz.einundzwanzig.space', WORKSPACE), true)
    assert.equal(mayProxifyMedia('kaputt', WORKSPACE), true)
    assert.equal(mayProxifyMedia(undefined, WORKSPACE), true)
})

test('ohne konfigurierten Workspace gibt es nichts zu schuetzen', () => {
    assert.equal(mayProxifyMedia('https://buzz.einundzwanzig.space/media/a.jpg', ''), true)
})
