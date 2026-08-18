/**
 * Pure-Tests fuer die Herkunfts-Entscheidung (welshman-frei).
 *   node --test packages/einundzwanzig-group/js/profileMerge.test.ts
 *
 * Es ist die einzige Stelle, an der ueber das LOESCHEN eines Profils entschieden wird
 * — deshalb steht sie allein und ist einzeln geprueft.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isSpaceHostedMedia, isSpaceLocalOnly, mergeProfileForDisplay, newestByPubkey, sanitizeSpaceProfile } from './profileMerge.ts'

const BUZZ = 'wss://buzz.einundzwanzig.space/'
const ZOOID = 'wss://group.einundzwanzig.space/'

test('nur vom Workspace-Relay gesehen → loeschen', () => {
    assert.equal(isSpaceLocalOnly([BUZZ], BUZZ), true)
    assert.equal(isSpaceLocalOnly(new Set([BUZZ]), BUZZ), true)
})

test('auch woanders gesehen → BEHALTEN (dasselbe Event liegt im nativen Nostr)', () => {
    assert.equal(isSpaceLocalOnly([BUZZ, ZOOID], BUZZ), false)
    assert.equal(isSpaceLocalOnly([ZOOID], BUZZ), false)
    assert.equal(isSpaceLocalOnly([BUZZ, 'wss://purplepag.es/'], BUZZ), false)
})

test('unbekannte Herkunft → BEHALTEN, nie auf Verdacht loeschen', () => {
    // Aus IndexedDB oder Backend-Cache geladen: der Tracker weiss nichts. Eine
    // Vermutung rechtfertigt kein Loeschen.
    assert.equal(isSpaceLocalOnly([], BUZZ), false)
    assert.equal(isSpaceLocalOnly(undefined, BUZZ), false)
    assert.equal(isSpaceLocalOnly(new Set(), BUZZ), false)
})

test('die URL muss exakt passen — kein Praefix-Vergleich', () => {
    // `normalizeRelayUrl` haengt einen Schraegstrich an; wer hier lockerer vergliche,
    // koennte ein Profil eines FREMDEN Relays mit aehnlichem Namen wegloeschen.
    assert.equal(isSpaceLocalOnly(['wss://buzz.einundzwanzig.space'], BUZZ), false)
    assert.equal(isSpaceLocalOnly(['wss://buzz.einundzwanzig.space.evil.tld/'], BUZZ), false)
})

// ── Der Merge ───────────────────────────────────────────────────────────────

/** Wie `readProfile` es liefert: Felder plus das Event, aus dem sie stammen. */
const profile = (fields: Record<string, unknown>, created_at = 0) => ({
    ...fields,
    event: { id: 'x'.repeat(64), pubkey: 'a'.repeat(64), created_at, kind: 0, tags: [], content: '', sig: '' },
}) as never

test('DIE ALTE GEFAHR: ein Space-Profil ueberschreibt kein vorhandenes natives Feld', () => {
    // Gemessene Lage am 2026-08-18: nativ „El Presidento Ben" (created_at 1781649668),
    // auf Buzz „ElPresidentoBenito" (1785401118) — das Space-Event ist JUENGER. Im
    // Repository gewaenne es deshalb. Hier gewinnt das Feld, nicht der Zeitstempel.
    const native = profile({ name: 'El Presidento Ben', picture: 'https://image.nostr.build/echt.jpg' }, 1781649668)
    const local = profile({ display_name: 'ElPresidentoBenito', picture: 'https://buzz.einundzwanzig.space/media/x.jpg' }, 1785401118)

    const merged = mergeProfileForDisplay(native, local)!

    assert.equal(merged.name, 'El Presidento Ben')
    assert.equal(merged.picture, 'https://image.nostr.build/echt.jpg')
    // display_name war nativ LEER → die Luecke darf das Space-Profil fuellen.
    assert.equal(merged.display_name, 'ElPresidentoBenito')
    // Das Anzeige-Objekt traegt weiter das NATIVE Event (kein Publish-Pfad auf Buzz).
    assert.equal(merged.event?.created_at, 1781649668)
})

test('leeres Feld wird gefuellt — auch wenn es nur aus Leerzeichen besteht', () => {
    const merged = mergeProfileForDisplay(profile({ name: '   ', about: '' }), profile({ name: 'ceo', about: 'Rolle im Team', picture: 'https://x/y.jpg' }))!

    assert.equal(merged.name, 'ceo')
    assert.equal(merged.about, 'Rolle im Team')
    assert.equal(merged.picture, 'https://x/y.jpg')
})

test('kein natives Profil → das Space-Profil traegt allein', () => {
    // Der gemessene Normalfall: zehn von elf Maintainern haben NIRGENDS ein natives kind 0.
    const local = profile({ display_name: 'nostr-specialist' })
    assert.equal(mergeProfileForDisplay(undefined, local), local)
})

test('kein Space-Profil → dieselbe Referenz zurueck, keine Kopie', () => {
    const native = profile({ name: 'jemand' })
    assert.equal(mergeProfileForDisplay(native, undefined), native)
    // Auch wenn das Space-Profil nichts Neues beitraegt, bleibt es dieselbe Referenz.
    assert.equal(mergeProfileForDisplay(native, profile({ name: 'anders' })), native)
})

test('ZAHLUNGSADRESSE UND NIP-05 kommen NIE aus dem Space-Profil', () => {
    // Eine relay-erzeugte lud16 leitete Zaps an einen Empfaenger um, den der Nutzer nie
    // gewaehlt hat; ein relay-gesetztes nip05 ist eine fremde Identitaetsbehauptung.
    const merged = mergeProfileForDisplay(
        profile({ name: 'jemand' }),
        profile({ lud16: 'angreifer@wallet.example', lud06: 'lnurl1...', nip05: 'ceo@buzz.example' }),
    )!

    assert.equal(merged.lud16, undefined)
    assert.equal(merged.lud06, undefined)
    assert.equal(merged.nip05, undefined)
})

// ── Bilder, die das Space-Relay selbst ausliefert ───────────────────────────

test('Bild vom Space-Relay wird erkannt — Origin gegen Origin', () => {
    assert.equal(isSpaceHostedMedia('https://buzz.einundzwanzig.space/media/abc.jpg', BUZZ), true)
    assert.equal(isSpaceHostedMedia('https://image.nostr.build/abc.jpg', BUZZ), false)
    assert.equal(isSpaceHostedMedia('https://buzz.einundzwanzig.space.evil.tld/media/abc.jpg', BUZZ), false)
    assert.equal(isSpaceHostedMedia('', BUZZ), false)
    assert.equal(isSpaceHostedMedia('kein-url', BUZZ), false)
    assert.equal(isSpaceHostedMedia('https://buzz.einundzwanzig.space/media/abc.jpg', ''), false)
})

test('Buzz-Bild fliegt raus (401 ohne Blossom-Auth), Fremdbild bleibt', () => {
    const dropped = sanitizeSpaceProfile(
        { name: 'ceo', picture: 'https://buzz.einundzwanzig.space/media/a.jpg', banner: 'https://buzz.einundzwanzig.space/media/b.jpg' },
        BUZZ,
        true,
    )
    assert.equal(dropped.picture, undefined)
    assert.equal(dropped.banner, undefined)
    assert.equal(dropped.name, 'ceo')

    const kept = sanitizeSpaceProfile({ picture: 'https://image.nostr.build/a.jpg' }, BUZZ, true)
    assert.equal(kept.picture, 'https://image.nostr.build/a.jpg')

    // Kein Buzz-Space (zooid liefert seine Blossom-Blobs ohne Auth aus) → nichts wird geworfen.
    const zooid = sanitizeSpaceProfile({ picture: 'https://group.einundzwanzig.space/media/a.jpg' }, ZOOID, false)
    assert.equal(zooid.picture, 'https://group.einundzwanzig.space/media/a.jpg')
})

test('mehrere Fassungen desselben ersetzbaren kind 0 → die juengste gewinnt', () => {
    const ev = (pubkey: string, created_at: number) =>
        ({ id: `${created_at}`, pubkey, created_at, kind: 0, tags: [], content: '', sig: '' }) as never

    const newest = newestByPubkey([ev('a', 10), ev('a', 30), ev('a', 20), ev('b', 5)])

    assert.equal(newest.get('a')?.created_at, 30)
    assert.equal(newest.get('b')?.created_at, 5)
})
