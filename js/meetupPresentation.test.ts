/**
 * Pure-Tests fuer den Meetup-Praesentations-Join (welshman-frei).
 * Laeuft ohne neue Dependency ueber Nodes eingebauten Test-Runner + TS-Type-Stripping:
 *   node --test packages/einundzwanzig-group/js/meetupPresentation.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
    parseMeetupTags,
    flagEmoji,
    portalLink,
    buildPresentation,
    buildPresentationMap,
} from './meetupPresentation.ts'

test('parseMeetupTags hebt Marker, id und slug aus den Roh-Tags', () => {
    const tags = [
        ['d', 'm3f9a2b7c1d0'],
        ['name', 'Einundzwanzig Saarbrücken'],
        ['picture', 'https://example/logo.png'],
        ['t', 'meetup'],
        ['i', 'meetup:42'],
        ['meetup_slug', 'einundzwanzig-saarbruecken'],
    ]
    assert.deepEqual(parseMeetupTags(tags), {
        isMeetup: true,
        meetupId: '42',
        meetupSlug: 'einundzwanzig-saarbruecken',
    })
})

test('parseMeetupTags: Nicht-Meetup-Raum bleibt leer', () => {
    const tags = [
        ['d', 'welcome'],
        ['name', 'Willkommen'],
        ['t', 'other'],
    ]
    assert.deepEqual(parseMeetupTags(tags), { isMeetup: false, meetupId: '', meetupSlug: '' })
})

test('parseMeetupTags toleriert fehlende/leere Tags (Warm-Render-Race)', () => {
    assert.deepEqual(parseMeetupTags([]), { isMeetup: false, meetupId: '', meetupSlug: '' })
})

test('flagEmoji: ISO-alpha-2 → Emoji-Flagge', () => {
    assert.equal(flagEmoji('DE'), '🇩🇪')
    assert.equal(flagEmoji('at'), '🇦🇹') // klein-geschrieben wird normalisiert
    assert.equal(flagEmoji('CH'), '🇨🇭')
    assert.equal(flagEmoji('PA'), '🇵🇦')
})

test('flagEmoji: ungueltige Codes → leer (kein Crash)', () => {
    assert.equal(flagEmoji(''), '')
    assert.equal(flagEmoji('D'), '')
    assert.equal(flagEmoji('DEU'), '')
    assert.equal(flagEmoji('12'), '')
})

test('portalLink: aus country+slug (verifiziert 100% deckungsgleich mit der API)', () => {
    assert.equal(
        portalLink('CH', 'einundzwanzig-meetup-pfaeffikon-sz'),
        'https://portal.einundzwanzig.space/ch/meetup/einundzwanzig-meetup-pfaeffikon-sz',
    )
    assert.equal(portalLink('', 'x'), '')
    assert.equal(portalLink('DE', ''), '')
})

test('buildPresentation: Record → fertige Praesentation', () => {
    const p = buildPresentation({
        name: 'Einundzwanzig Saarbrücken',
        slug: 'einundzwanzig-saarbruecken',
        city: 'Saarbrücken',
        country: 'DE',
        logo: 'https://example/logo.png',
        next_event_start: '2026-07-19 16:00',
    })
    assert.equal(p.flag, '🇩🇪')
    assert.equal(p.portalLink, 'https://portal.einundzwanzig.space/de/meetup/einundzwanzig-saarbruecken')
    assert.equal(p.country, 'DE')
    assert.equal(p.city, 'Saarbrücken')
    assert.equal(p.nextEventStart, '2026-07-19 16:00')
})

test('buildPresentationMap: Index nach slug, ueberspringt Records ohne slug', () => {
    const map = buildPresentationMap([
        { name: 'A', slug: 'a', country: 'DE' } as never,
        { name: 'B', slug: '' } as never,
    ])
    assert.equal(map.size, 1)
    assert.equal(map.get('a')?.flag, '🇩🇪')
})
