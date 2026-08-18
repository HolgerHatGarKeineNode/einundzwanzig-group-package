/**
 * Pure-Tests fuer die Herkunfts-Entscheidung (welshman-frei).
 *   node --test packages/einundzwanzig-group/js/profileMerge.test.ts
 *
 * Es ist die einzige Stelle, an der ueber das LOESCHEN eines Profils entschieden wird
 * — deshalb steht sie allein und ist einzeln geprueft.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isSpaceHostedMedia, isSpaceLocalOnly, mergeProfileForDisplay, newestByPubkey, sanitizeSpaceProfile, spaceFieldsForDisplay } from './profileMerge.ts'

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
    // Der Inhalt kommt durch, das OBJEKT aber nicht: siehe die Allowlist-Zusage unten.
    const local = profile({ display_name: 'nostr-specialist' })
    assert.deepEqual(mergeProfileForDisplay(undefined, local), { display_name: 'nostr-specialist' })
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

test('das relay-eigene Bild BLEIBT stehen — der Ladeweg dafuer existiert jetzt', () => {
    // Bis 2026-08-19 flog es hier raus (401 im <img>). Seit dem client-seitigen
    // Blossom-Fetch wird die URL gebraucht; erkannt wird sie am Origin, nicht an
    // einem Merker im Profil.
    const aufgenommen = sanitizeSpaceProfile({
        name: 'ceo',
        picture: 'https://buzz.einundzwanzig.space/media/a.jpg',
        banner: 'https://buzz.einundzwanzig.space/media/b.jpg',
    })

    assert.equal(aufgenommen.picture, 'https://buzz.einundzwanzig.space/media/a.jpg')
    assert.equal(aufgenommen.banner, 'https://buzz.einundzwanzig.space/media/b.jpg')
    assert.equal(isSpaceHostedMedia(aufgenommen.picture, BUZZ), true, 'die Flaeche muss den Blossom-Weg daran erkennen')

    const fremd = sanitizeSpaceProfile({ picture: 'https://image.nostr.build/a.jpg' })
    assert.equal(fremd.picture, 'https://image.nostr.build/a.jpg')
    assert.equal(isSpaceHostedMedia(fremd.picture, BUZZ), false, 'Fremdbilder laufen weiter ueber den Proxy')
})

test('mehrere Fassungen desselben ersetzbaren kind 0 → die juengste gewinnt', () => {
    const ev = (pubkey: string, created_at: number) =>
        ({ id: `${created_at}`, pubkey, created_at, kind: 0, tags: [], content: '', sig: '' }) as never

    const newest = newestByPubkey([ev('a', 10), ev('a', 30), ev('a', 20), ev('b', 5)])

    assert.equal(newest.get('a')?.created_at, 30)
    assert.equal(newest.get('b')?.created_at, 5)
})

test('OHNE natives Profil greift dieselbe Allowlist — der teuerste Zweig, nicht der seltenste', () => {
    // Genau hier lag der Fehler: der Kurzschluss gab das Space-Profil unveraendert
    // zurueck. `feeds.ts:947/1130` baut aus `lud16 || lud06` das Zap-Ziel, und der Zweig
    // „kein natives Profil" ist im Workspace der NORMALFALL (10 von 11 Maintainern) —
    // ein Relay haette damit die Empfangsadresse fuer Zaps gesetzt.
    const local = profile({
        display_name: 'ceo',
        picture: 'https://image.example/ceo.jpg',
        lud16: 'angreifer@wallet.example',
        lud06: 'lnurl1angreifer',
        nip05: 'ceo@buzz.example',
    })

    const merged = mergeProfileForDisplay(undefined, local)!

    assert.equal(merged.display_name, 'ceo')
    assert.equal(merged.picture, 'https://image.example/ceo.jpg')
    assert.equal(merged.lud16, undefined, 'eine relay-gesetzte Zahlungsadresse ist ein Vermoegensschaden')
    assert.equal(merged.lud06, undefined)
    assert.equal(merged.nip05, undefined)
    assert.equal(merged.event, undefined, 'das Space-Event darf an keinem Anzeige-Objekt haengen')
    assert.notEqual(merged, local, 'nie eine geteilte Referenz auf einen Eintrag der Zweitquelle')
})

test('ein Space-Profil OHNE anzeigbares Feld ergibt nichts — nicht ein leeres Objekt', () => {
    // Sonst stuende im gemergten Store ein Eintrag, der nur so tut, als gaebe es ein Profil.
    assert.equal(spaceFieldsForDisplay(profile({ lud16: 'angreifer@wallet.example' })), undefined)
    assert.equal(spaceFieldsForDisplay(profile({ name: '   ' })), undefined)
    assert.equal(spaceFieldsForDisplay(undefined), undefined)
    assert.equal(mergeProfileForDisplay(undefined, profile({ lud16: 'x@y.z' })), undefined)
})

test('die Allowlist greift schon beim AUFNEHMEN in die Zweitquelle (zweite Ebene)', () => {
    const aufgenommen = sanitizeSpaceProfile({
        name: 'ceo',
        lud16: 'angreifer@wallet.example',
        lud06: 'lnurl1angreifer',
        nip05: 'ceo@buzz.example',
        lnurl: 'lnurl1x',
    })

    assert.equal(aufgenommen.name, 'ceo')
    assert.equal(aufgenommen.lud16, undefined)
    assert.equal(aufgenommen.lud06, undefined)
    assert.equal(aufgenommen.nip05, undefined)
    assert.equal(aufgenommen.lnurl, undefined)
})
