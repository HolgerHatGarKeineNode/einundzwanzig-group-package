/**
 * Pure-Tests für die NIP-21-Referenzlogik hinter Zitat- und Profilkarte (P5).
 * Läuft ohne neue Dependency über Nodes eingebauten Test-Runner + TS-Type-Stripping:
 *   node --experimental-strip-types --test packages/einundzwanzig-group/js/nostrEventLink.test.ts
 *
 * Vorbild `js/paletteItems.test.ts` / `js/chatLinks.test.ts` — welshman-frei, nur
 * `nostr-tools/nip19` als echte Abhängigkeit (kein Mock nötig, das Modul selbst tut das
 * schon per Modulschnitt, siehe `nostrEventLink.ts`-Kopfkommentar).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as nip19 from 'nostr-tools/nip19'
import {
    REF_DECODE_CAP,
    firstNostrRef,
    refClickTarget,
    refThreadPath,
    shortenEntity,
    withShortRefTokens,
} from './nostrEventLink.ts'

const ID_A = 'a'.repeat(64)
const ID_B = 'b'.repeat(64)
const PK_A = 'c'.repeat(64)
const PK_B = 'd'.repeat(64)

const note = (id = ID_A): string => nip19.noteEncode(id)
const nevent = (over: { id?: string; relays?: string[]; author?: string; kind?: number } = {}): string =>
    nip19.neventEncode({ id: ID_A, ...over })
const npub = (pk = PK_A): string => nip19.npubEncode(pk)
const nprofile = (over: { pubkey?: string; relays?: string[] } = {}): string =>
    nip19.nprofileEncode({ pubkey: PK_A, ...over })

// ── firstNostrRef: die vier Kennungsarten, `nostr:`-Pflicht ─────────────────────────

test('firstNostrRef: nostr:note1… liefert ein Event mit leeren Relays/Autor', () => {
    const ref = firstNostrRef(`Schau mal: nostr:${note()}`)
    assert.deepEqual(ref, { kind: 'event', id: ID_A, entity: note(), relays: [], author: '' })
})

test('firstNostrRef: nostr:nevent1… trägt Relay-Hints und Autor aus dem TLV', () => {
    const entity = nevent({ relays: ['wss://r1.example/', 'wss://r2.example/'], author: PK_B, kind: 9 })
    const ref = firstNostrRef(`nostr:${entity}`)
    assert.deepEqual(ref, {
        kind: 'event',
        id: ID_A,
        entity,
        relays: ['wss://r1.example/', 'wss://r2.example/'],
        author: PK_B,
    })
})

test('firstNostrRef: nostr:npub1… liefert ein Profil mit leeren Relays', () => {
    const ref = firstNostrRef(`Folg nostr:${npub()}`)
    assert.deepEqual(ref, { kind: 'profile', pubkey: PK_A, entity: npub(), relays: [] })
})

test('firstNostrRef: nostr:nprofile1… trägt Relay-Hints aus dem TLV', () => {
    const entity = nprofile({ relays: ['wss://p.example/'] })
    const ref = firstNostrRef(`nostr:${entity}`)
    assert.deepEqual(ref, { kind: 'profile', pubkey: PK_A, entity, relays: ['wss://p.example/'] })
})

// ── Priorität: Ereignis schlägt Profil, unabhängig von der Position ─────────────────

test('firstNostrRef: nevent NACH einem npub gewinnt trotzdem (Ereignis > Profil)', () => {
    const ref = firstNostrRef(`nostr:${npub(PK_B)} dann nostr:${nevent()}`)
    assert.equal(ref?.kind, 'event')
    assert.equal((ref as { id: string }).id, ID_A)
})

test('firstNostrRef: note VOR einem nevent gewinnt (beide Event, erstes Token zählt)', () => {
    const secondEntity = nevent({ id: ID_B })
    const ref = firstNostrRef(`nostr:${note(ID_A)} nostr:${secondEntity}`)
    assert.equal(ref?.kind, 'event')
    assert.equal((ref as { id: string }).id, ID_A)
})

test('firstNostrRef: nur ein npub im Text (keine Event-Referenz) liefert das Profil', () => {
    const ref = firstNostrRef(`Kein Ereignis, nur nostr:${npub(PK_B)}`)
    assert.equal(ref?.kind, 'profile')
})

// ── Genau höchstens EINE Referenz ────────────────────────────────────────────────────

test('firstNostrRef: zwei Event-Referenzen im Text — nur die erste zählt', () => {
    const first = nevent({ id: ID_A })
    const second = nevent({ id: ID_B })
    const ref = firstNostrRef(`nostr:${first} und auch nostr:${second}`)
    assert.equal((ref as { id: string }).id, ID_A)
})

// ── Nackte bech32 ohne `nostr:`-Präfix: KEINE Karte (bewusste Grenze, W4) ────────────

test('firstNostrRef: nackte Kennungen ohne nostr:-Präfix erzeugen KEINE Referenz', () => {
    assert.equal(firstNostrRef(`Schau: ${note()}`), null)
    assert.equal(firstNostrRef(`Schau: ${nevent()}`), null)
    assert.equal(firstNostrRef(`Schau: ${npub()}`), null)
    assert.equal(firstNostrRef(`Schau: ${nprofile()}`), null)
})

test('firstNostrRef: @npub1… ohne nostr:-Präfix erzeugt KEINE Referenz', () => {
    assert.equal(firstNostrRef(`Hallo @${npub()}`), null)
})

test('firstNostrRef: nostr:npub1… OHNE führendes @ funktioniert weiterhin (Kontrastprobe zum @-Fall)', () => {
    const ref = firstNostrRef(`Hallo nostr:${npub()}`)
    assert.equal(ref?.kind, 'profile')
})

// ── Kaputte/abgeschnittene Kennungen fallen still durch ──────────────────────────────

test('firstNostrRef: eine zu kurze, abgeschnittene Kennung fällt durch (Regex verlangt Mindestlänge)', () => {
    // Kein Match des Musters selbst (zu wenige Zeichen nach dem Präfix) → gar kein Kandidat.
    assert.equal(firstNostrRef('nostr:note1abc'), null)
})

test('firstNostrRef: eine längenrichtige, aber checksum-kaputte Kennung fällt still durch', () => {
    // Gleiche Länge wie ein echtes note1 (58 Datenzeichen), aber keine gültige Payload/Prüfsumme.
    const broken = `note1${'q'.repeat(58)}`
    assert.equal(firstNostrRef(`nostr:${broken}`), null)
})

test('firstNostrRef: eine gültige Referenz NACH einer kaputten wird trotzdem gefunden', () => {
    const broken = `note1${'q'.repeat(58)}`
    const ref = firstNostrRef(`nostr:${broken} nostr:${note(ID_B)}`)
    assert.equal((ref as { id: string }).id, ID_B)
})

// ── Der Decode-Deckel (REF_DECODE_CAP) ───────────────────────────────────────────────

test('REF_DECODE_CAP ist 8 — die dokumentierte Härtungsgrenze', () => {
    assert.equal(REF_DECODE_CAP, 8)
})

test('firstNostrRef: mehr als REF_DECODE_CAP kaputte Event-Token vor der ersten gültigen → kein Treffer', () => {
    const broken = `note1${'q'.repeat(58)}`
    // REF_DECODE_CAP (8) kaputte Kandidaten in den Event-Bucket, DANACH die gültige — sie
    // liegt außerhalb des Deckels und wird nie versucht.
    const junk = new Array(REF_DECODE_CAP).fill(`nostr:${broken}`).join(' ')
    const ref = firstNostrRef(`${junk} nostr:${note(ID_B)}`)
    assert.equal(ref, null)
})

test('firstNostrRef: bis zu REF_DECODE_CAP kaputte Event-Token, danach die gültige → wird gefunden', () => {
    const broken = `note1${'q'.repeat(58)}`
    // Einen WENIGER als der Deckel — die gültige Referenz liegt noch innerhalb des Buckets.
    const junk = new Array(REF_DECODE_CAP - 1).fill(`nostr:${broken}`).join(' ')
    const ref = firstNostrRef(`${junk} nostr:${note(ID_B)}`)
    assert.equal((ref as { id: string }).id, ID_B)
})

// ── shortenEntity ─────────────────────────────────────────────────────────────────

test('shortenEntity: kürzt auf 16 Zeichen + Ellipse, kurze Strings bleiben unverändert', () => {
    assert.equal(shortenEntity('abcdefghijklmnop'), 'abcdefghijklmnop') // genau 16 → unverändert
    assert.equal(shortenEntity('abcdefghijklmnopq'), 'abcdefghijklmnop…') // 17 → gekürzt
    assert.equal(shortenEntity(note()), `${note().slice(0, 16)}…`)
})

// ── withShortRefTokens: „nie geschachtelt" ───────────────────────────────────────────

test('withShortRefTokens: ersetzt ein nostr:…-Token durch die gekürzte Kennung OHNE nostr:-Präfix', () => {
    const entity = nevent({ id: ID_B })
    const out = withShortRefTokens(`Text vor nostr:${entity} Text danach`)
    assert.equal(out, `Text vor ${shortenEntity(entity)} Text danach`)
    assert.ok(!out.includes('nostr:'), 'das nostr:-Präfix darf im Ausschnitt nicht mehr stehen')
    assert.ok(!out.includes(entity), 'die volle Kennung darf nicht mehr im Ausschnitt stehen')
})

test('withShortRefTokens: Text ohne Referenz bleibt unverändert', () => {
    assert.equal(withShortRefTokens('ganz normaler Text'), 'ganz normaler Text')
})

test('withShortRefTokens: mehrere Token werden alle gekürzt', () => {
    const e1 = nevent({ id: ID_A })
    const e2 = npub(PK_B)
    const out = withShortRefTokens(`nostr:${e1} und nostr:${e2}`)
    assert.equal(out, `${shortenEntity(e1)} und ${shortenEntity(e2)}`)
})

// ── refThreadPath ─────────────────────────────────────────────────────────────────

test('refThreadPath: benutzt den Raum des zitierten Ereignisses, wenn bekannt', () => {
    assert.equal(refThreadPath('nevent1xyz', 'zielraum', 'aktuellraum'), '/rooms/zielraum/thread/nevent1xyz')
})

test('refThreadPath: fällt auf den aktuellen Raum zurück, wenn der Zielraum unbekannt ist', () => {
    assert.equal(refThreadPath('nevent1xyz', '', 'aktuellraum'), '/rooms/aktuellraum/thread/nevent1xyz')
})

test('refThreadPath: kodiert den Raumnamen für die URL', () => {
    assert.equal(refThreadPath('nevent1xyz', 'a b', 'x'), '/rooms/a%20b/thread/nevent1xyz')
})

// ── refClickTarget: die Drei-Fälle-Regel ─────────────────────────────────────────────

test('refClickTarget: aufgelöst UND im Fenster → scroll', () => {
    assert.equal(refClickTarget(true, true), 'scroll')
})

test('refClickTarget: aufgelöst, aber NICHT im Fenster → thread (Fall B)', () => {
    assert.equal(refClickTarget(true, false), 'thread')
})

test('refClickTarget: unaufgelöst, obwohl (fälschlich) als „im Fenster" markiert → thread', () => {
    assert.equal(refClickTarget(false, true), 'thread')
})

test('refClickTarget: unaufgelöst und nicht im Fenster → thread (Fall C)', () => {
    assert.equal(refClickTarget(false, false), 'thread')
})
