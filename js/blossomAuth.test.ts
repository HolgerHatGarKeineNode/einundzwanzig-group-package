/**
 * Die FORM des Blossom-Auth-Events — gegen die Antworten, die der echte Relay am
 * 2026-08-19 gegeben hat (Tabelle im Kopf von `blossomAuth.ts`).
 *
 * Ausführen:
 *   node --experimental-strip-types --test packages/einundzwanzig-group/js/blossomAuth.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
    AUTH_REUSE_SECONDS,
    AUTH_TTL_SECONDS,
    BLOSSOM_AUTH_KIND,
    blossomAuthHeader,
    isAuthEventUsable,
    makeBlossomAuthTemplate,
    mediaOriginOf,
    type SignedLike,
} from './blossomAuth.ts'

const ORIGIN = 'https://buzz.einundzwanzig.space'
const JETZT = 1_800_000_000

const tag = (event: { tags: string[][] }, name: string): string | undefined => event.tags.find((t) => t[0] === name)?.[1]

const signiert = (template: ReturnType<typeof makeBlossomAuthTemplate>): SignedLike => ({
    ...template,
    pubkey: 'a'.repeat(64),
    id: 'b'.repeat(64),
    sig: 'c'.repeat(128),
})

test('das Auth-Event hat die Form, die der Relay akzeptiert', () => {
    const event = makeBlossomAuthTemplate(ORIGIN, JETZT)

    assert.equal(event.kind, BLOSSOM_AUTH_KIND)
    assert.equal(event.created_at, JETZT)
    // Gemessen: ohne `t=get` → 401.
    assert.equal(tag(event, 't'), 'get')
    // Gemessen: `server` deckt ALLE Blobs des Hosts ab; ein `x` nur genau einen (403).
    assert.equal(tag(event, 'server'), ORIGIN)
    assert.equal(tag(event, 'x'), undefined)
    // Gemessen: `expiration` in der Vergangenheit → 401.
    assert.equal(tag(event, 'expiration'), String(JETZT + AUTH_TTL_SECONDS))
    // Gemessen: leerer `content` → 401.
    assert.notEqual(event.content.trim(), '')
})

test('wiederverwendbar ist es nur innerhalb BEIDER gemessener Grenzen', () => {
    const frisch = signiert(makeBlossomAuthTemplate(ORIGIN, JETZT))

    assert.equal(isAuthEventUsable(frisch, JETZT), true)
    assert.equal(isAuthEventUsable(frisch, JETZT + AUTH_REUSE_SECONDS - 1), true)
    // `created_at` zu alt — der Relay lehnt ab (gemessen: −2 h → 401), obwohl das
    // `expiration` noch in der Zukunft läge. Genau diese Grenze uebersieht man leicht.
    assert.equal(isAuthEventUsable(frisch, JETZT + AUTH_REUSE_SECONDS + 1), false)
    assert.ok(AUTH_REUSE_SECONDS < AUTH_TTL_SECONDS, 'die Wiederverwendung muss unter der Gueltigkeit liegen')

    const abgelaufen = signiert(makeBlossomAuthTemplate(ORIGIN, JETZT, 10))
    assert.equal(isAuthEventUsable(abgelaufen, JETZT + 11), false)

    assert.equal(isAuthEventUsable(undefined, JETZT), false)
    assert.equal(isAuthEventUsable({ ...frisch, kind: 27235 }, JETZT), false, 'ein NIP-98-Event ist kein Blossom-Auth')
    assert.equal(isAuthEventUsable({ ...frisch, tags: [['t', 'get']] }, JETZT), false, 'ohne expiration kein Freibrief')
})

test('der Header ist `Nostr <base64(event)>` und laesst sich zurueckrechnen', () => {
    const event = signiert(makeBlossomAuthTemplate(ORIGIN, JETZT))
    const header = blossomAuthHeader(event)

    assert.match(header, /^Nostr [A-Za-z0-9+/=]+$/)
    assert.deepEqual(JSON.parse(Buffer.from(header.slice(6), 'base64').toString('utf8')), event)
})

test('der Origin traegt nie Pfad oder Schraegstrich', () => {
    assert.equal(mediaOriginOf('wss://buzz.einundzwanzig.space/'), ORIGIN)
    assert.equal(mediaOriginOf('wss://buzz.einundzwanzig.space'), ORIGIN)
    assert.equal(mediaOriginOf('https://buzz.einundzwanzig.space/media/abc.jpg'), ORIGIN)
    assert.equal(mediaOriginOf('ws://localhost:3334/'), 'http://localhost:3334')
    assert.equal(mediaOriginOf('kein-url'), '')
    assert.equal(mediaOriginOf(''), '')
})
