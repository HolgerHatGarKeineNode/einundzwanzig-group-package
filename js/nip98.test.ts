/**
 * Pure-Tests für den NIP-98-Header (welshman-frei, wie `nip98.ts` selbst).
 *   node --test packages/einundzwanzig-group/js/nip98.test.ts
 *
 * Was hier schiefgehen kann, geht *still* schief: ein um ein Zeichen abweichender
 * `u`-Tag liefert kein Rendering-Problem, sondern ein `401 URL mismatch` — und die
 * Melde-Queue bleibt einfach leer, ununterscheidbar von „keine Meldungen".
 * Am laufenden buzz-test-Stack gegengeprüft (siehe Modulkopf von `nip98.ts`).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { httpBase, nip98Url, nip98Template, encodeNip98Header, nip98AuthHeader, HTTP_AUTH_KIND, type SignedLike } from './nip98.ts'

test('ws→http, wss→https, trailing Slash weg', () => {
    assert.equal(httpBase('ws://localhost:3001/'), 'http://localhost:3001')
    assert.equal(httpBase('wss://relay.example/'), 'https://relay.example')
    // Buzz leitet das Schema aus seiner RELAY_URL ab (ws→http) — die Abbildung
    // muss deckungsgleich sein, sonst passt der signierte URL nie.
    assert.equal(httpBase('ws://localhost:3001'), 'http://localhost:3001')
})

test('nip98Url baut genau den URL, der auch abgerufen wird', () => {
    assert.equal(
        nip98Url('ws://localhost:3001/', '/moderation/reports', { status: 'open', limit: 50 }),
        'http://localhost:3001/moderation/reports?status=open&limit=50',
    )
})

test('leere/undefinierte Query-Werte fallen raus (kein „?status=")', () => {
    assert.equal(nip98Url('ws://h/', '/moderation/reports', {}), 'http://h/moderation/reports')
    assert.equal(nip98Url('ws://h/', '/moderation/reports', { status: undefined, limit: '' }), 'http://h/moderation/reports')
})

test('Reihenfolge der Query-Parameter ist die Einfügereihenfolge, nicht alphabetisch', () => {
    // Die Signatur deckt den ROHEN Query-String. Würde hier irgendwo sortiert,
    // wäre der signierte String ein anderer als der gesendete.
    assert.equal(nip98Url('ws://h/', '/x', { status: 'open', limit: 5 }), 'http://h/x?status=open&limit=5')
    assert.equal(nip98Url('ws://h/', '/x', { limit: 5, status: 'open' }), 'http://h/x?limit=5&status=open')
})

test('Template: kind 27235, u/method-Tags, leerer content', () => {
    const t = nip98Template('http://h/x?a=1', 'get', 1_700_000_000, 'deadbeef')
    assert.equal(t.kind, HTTP_AUTH_KIND)
    assert.equal(t.created_at, 1_700_000_000)
    assert.equal(t.content, '')
    assert.deepEqual(t.tags[0], ['u', 'http://h/x?a=1'])
    // Buzz vergleicht die Methode case-insensitiv, wir senden trotzdem kanonisch.
    assert.deepEqual(t.tags[1], ['method', 'GET'])
    assert.deepEqual(t.tags[2], ['nonce', 'deadbeef'])
})

test('ohne expliziten nonce ist jedes Template verschieden (Buzz-Replay-Guard)', () => {
    // Zwei Abrufe derselben URL in derselben Sekunde ergäben sonst dieselbe
    // Event-id → `401 NIP-98: replay detected`, und die Queue wäre bei zwei
    // schnellen Klicks tot.
    const a = nip98Template('http://h/x', 'GET', 1_700_000_000)
    const b = nip98Template('http://h/x', 'GET', 1_700_000_000)
    assert.notEqual(JSON.stringify(a.tags), JSON.stringify(b.tags))
})

const signed = (over: Partial<SignedLike> = {}): SignedLike => ({
    kind: HTTP_AUTH_KIND,
    created_at: 1_700_000_000,
    tags: [['u', 'http://h/x']],
    content: '',
    pubkey: 'a'.repeat(64),
    id: 'b'.repeat(64),
    sig: 'c'.repeat(128),
    ...over,
})

test('Header trägt das Präfix „Nostr " und dekodierbares Event-JSON', () => {
    const header = encodeNip98Header(signed())
    assert.ok(header.startsWith('Nostr '))
    const json = JSON.parse(Buffer.from(header.slice(6), 'base64').toString('utf8'))
    assert.equal(json.kind, HTTP_AUTH_KIND)
    assert.equal(json.sig, 'c'.repeat(128))
})

test('Nicht-ASCII im URL bricht die Kodierung nicht (btoa würde werfen)', () => {
    const header = encodeNip98Header(signed({ tags: [['u', 'https://münchen.example/x']] }))
    const json = JSON.parse(Buffer.from(header.slice(6), 'base64').toString('utf8'))
    assert.deepEqual(json.tags[0], ['u', 'https://münchen.example/x'])
})

test('nip98AuthHeader reicht genau den übergebenen URL an den Signer', async () => {
    let seen: string[][] = []
    const header = await nip98AuthHeader(
        async (e) => {
            seen = e.tags
            return signed({ tags: e.tags })
        },
        'http://localhost:3001/moderation/reports?status=open&limit=50',
    )
    assert.deepEqual(seen[0], ['u', 'http://localhost:3001/moderation/reports?status=open&limit=50'])
    assert.ok(header.startsWith('Nostr '))
})
