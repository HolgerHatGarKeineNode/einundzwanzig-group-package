/**
 * Pure-Tests für die Palette-Grammatik und Sektionslogik (welshman-frei, P4).
 * Läuft ohne neue Dependency über Nodes eingebauten Test-Runner + TS-Type-Stripping:
 *   node --experimental-strip-types --test packages/einundzwanzig-group/js/paletteItems.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
    EMPTY_PALETTE_SCOPE,
    PALETTE_SECTIONS,
    hasPaletteScope,
    isTextEntry,
    mergePaletteScope,
    parsePaletteScope,
    paletteSigil,
    paletteScopeToken,
    recentRooms,
    scopedRooms,
    visibleSections,
    type PaletteRoom,
    type PaletteScope,
} from './paletteItems.ts'

const room = (over: Partial<PaletteRoom> & { h: string }): PaletteRoom => ({
    name: over.h,
    joined: false,
    ...over,
})

// ── parsePaletteScope: die Grammatik ────────────────────────────────────────

test('parsePaletteScope: @ und > sind Sigel, kein zweites Schema', () => {
    assert.deepEqual(parsePaletteScope('@mira'), {
        scope: { section: 'members', group: null, country: '' },
        rest: 'mira',
    })
    assert.deepEqual(parsePaletteScope('>einst'), {
        scope: { section: 'actions', group: null, country: '' },
        rest: 'einst',
    })
})

test('parsePaletteScope: r: m: p: w: und ein Ländercode grenzen auf Räume ein — dieselbe Grammatik wie die Rail', () => {
    assert.deepEqual(parsePaletteScope('m:kempten'), {
        scope: { section: 'rooms', group: 'meetups', country: '' },
        rest: 'kempten',
    })
    assert.deepEqual(parsePaletteScope('p:antrag'), {
        scope: { section: 'rooms', group: 'proposals', country: '' },
        rest: 'antrag',
    })
    assert.deepEqual(parsePaletteScope('r:bit'), {
        scope: { section: 'rooms', group: 'rooms', country: '' },
        rest: 'bit',
    })
    assert.deepEqual(parsePaletteScope('w:x'), {
        scope: { section: 'rooms', group: 'workspace', country: '' },
        rest: 'x',
    })
    assert.deepEqual(parsePaletteScope('de:'), {
        scope: { section: 'rooms', group: 'meetups', country: 'DE' },
        rest: '',
    })
})

test('parsePaletteScope: unbekannte Präfixe bleiben Text, kein stiller Filter auf nichts', () => {
    assert.deepEqual(parsePaletteScope('foo:bar'), { scope: { ...EMPTY_PALETTE_SCOPE }, rest: 'foo:bar' })
    assert.deepEqual(parsePaletteScope('einfacher text'), { scope: { ...EMPTY_PALETTE_SCOPE }, rest: 'einfacher text' })
})

test('parsePaletteScope hebt den Präfix vollständig aus dem Rest — der rohe Feldwert bleibt scope-frei (Flux filtert sonst wörtlich nach "r:bit")', () => {
    const { rest } = parsePaletteScope('r:bit')
    assert.equal(rest.includes('r:'), false, 'der Scope-Präfix darf nicht im Rest überleben')
    assert.equal(rest, 'bit')
})

// ── mergePaletteScope ────────────────────────────────────────────────────────

test('mergePaletteScope: ein Land überlebt eine spätere Gruppenangabe (wie rail.liftToken)', () => {
    const withCountry: PaletteScope = { section: 'rooms', group: null, country: 'DE' }
    const meetups: PaletteScope = { section: 'rooms', group: 'meetups', country: '' }

    assert.deepEqual(mergePaletteScope(withCountry, meetups), { section: 'rooms', group: 'meetups', country: 'DE' })
})

test('mergePaletteScope: @/> sind ein Sektionswechsel und ersetzen den bestehenden Scope komplett', () => {
    const withCountry: PaletteScope = { section: 'rooms', group: 'meetups', country: 'AT' }
    const members: PaletteScope = { section: 'members', group: null, country: '' }

    assert.deepEqual(mergePaletteScope(withCountry, members), members)
})

// ── hasPaletteScope / Sigel / Chip-Token ────────────────────────────────────

test('hasPaletteScope: leerer Scope trägt keine Einschränkung', () => {
    assert.equal(hasPaletteScope({ ...EMPTY_PALETTE_SCOPE }), false)
    assert.equal(hasPaletteScope({ section: 'members', group: null, country: '' }), true)
    assert.equal(hasPaletteScope({ section: null, group: null, country: 'DE' }), true)
})

test('paletteSigil folgt der Sektion, ohne Scope gilt #', () => {
    assert.equal(paletteSigil({ ...EMPTY_PALETTE_SCOPE }), '#')
    assert.equal(paletteSigil({ section: 'members', group: null, country: '' }), '@')
    assert.equal(paletteSigil({ section: 'actions', group: null, country: '' }), '>')
    assert.equal(paletteSigil({ section: 'spaces', group: null, country: '' }), '/')
})

test('paletteScopeToken schreibt für Mitglieder/Aktionen das Sigel, für Räume das Rail-Token', () => {
    assert.equal(paletteScopeToken({ section: 'members', group: null, country: '' }), '@')
    assert.equal(paletteScopeToken({ section: 'actions', group: null, country: '' }), '>')
    assert.equal(paletteScopeToken({ section: 'rooms', group: 'meetups', country: '' }), 'm:')
})

// ── visibleSections: nie leer, feste Reihenfolge ────────────────────────────

test('visibleSections: ohne Eingabe und ohne Scope Räume + Aktionen — die Palette ist NIE leer', () => {
    assert.deepEqual(visibleSections({ ...EMPTY_PALETTE_SCOPE }, ''), ['rooms', 'actions'])
    assert.deepEqual(visibleSections({ ...EMPTY_PALETTE_SCOPE }, '   '), ['rooms', 'actions'])
})

test('visibleSections: mit Eingabe alle vier, in fester Reihenfolge Räume · Mitglieder · Spaces · Aktionen', () => {
    assert.deepEqual(visibleSections({ ...EMPTY_PALETTE_SCOPE }, 'bit'), [...PALETTE_SECTIONS])
    assert.deepEqual([...PALETTE_SECTIONS], ['rooms', 'members', 'spaces', 'actions'])
})

test('visibleSections: mit gesetztem Scope genau die eine adressierte Sektion', () => {
    assert.deepEqual(visibleSections({ section: 'members', group: null, country: '' }, ''), ['members'])
    assert.deepEqual(visibleSections({ section: 'actions', group: null, country: '' }, 'suche'), ['actions'])
})

// ── recentRooms: der Ruhezustand ────────────────────────────────────────────

test('recentRooms: Beigetretene zuerst, danach jüngste Aktivität, auf `limit` gekappt', () => {
    const rooms = [
        room({ h: 'joined-alt', joined: true, lastMessageAt: 100 }),
        room({ h: 'joined-neu', joined: true, lastMessageAt: 900 }),
        room({ h: 'fremd-neu', joined: false, lastMessageAt: 950 }),
        room({ h: 'fremd-alt', joined: false, lastMessageAt: 10 }),
    ]

    assert.deepEqual(recentRooms(rooms, 3).map((r) => r.h), ['joined-neu', 'joined-alt', 'fremd-neu'])
})

test('recentRooms: Räume ohne bekannte Aktivität landen ans Ende, ohne die Kappung zu sprengen', () => {
    const rooms = [
        room({ h: 'ohne-aktivitaet', joined: true, lastMessageAt: null }),
        room({ h: 'aktiv', joined: true, lastMessageAt: 5 }),
    ]

    assert.deepEqual(recentRooms(rooms).map((r) => r.h), ['aktiv', 'ohne-aktivitaet'])
})

// ── scopedRooms: die Trefferliste einer Suche, ungekappt ───────────────────

test('scopedRooms: section != rooms liefert nichts — die Sektion ist adressiert, nicht der Raumbestand', () => {
    const rooms = [room({ h: 'a', joined: true })]
    assert.deepEqual(scopedRooms(rooms, { section: 'members', group: null, country: '' }), [])
})

test('scopedRooms: Gruppen- und Landfilter greifen, Beigetretene vor den anderen, beide alphabetisch', () => {
    const rooms: PaletteRoom[] = [
        { ...room({ h: 'zulu-meetup', name: 'Zulu Meetup', isMeetup: true, meetupSlug: 'z' }), joined: false },
        { ...room({ h: 'alpha-meetup', name: 'Alpha Meetup', isMeetup: true, meetupSlug: 'a' }), joined: true },
        { ...room({ h: 'other-country', name: 'Other', isMeetup: true, meetupSlug: 'o' }), joined: false },
        { ...room({ h: 'plain', name: 'Plain' }), joined: true },
    ]
    const countryOf = (r: PaletteRoom): string =>
        ({ z: 'DE', a: 'DE', o: 'AT' })[r.meetupSlug ?? ''] ?? ''

    const scope: PaletteScope = { section: 'rooms', group: 'meetups', country: 'DE' }
    assert.deepEqual(
        scopedRooms(rooms, scope, countryOf).map((r) => r.h),
        ['alpha-meetup', 'zulu-meetup'],
        'beigetreten zuerst, dann alphabetisch — Land grenzt AT aus, Gruppe grenzt "plain" aus',
    )
})

test('scopedRooms: KEINE Kappung — anders als die Rail (dort 12), hier ist die Liste die Trefferliste', () => {
    const rooms = Array.from({ length: 30 }, (_, i) => room({ h: `r${i}`, joined: false }))
    assert.equal(scopedRooms(rooms, { ...EMPTY_PALETTE_SCOPE }).length, 30)
})

// ── isTextEntry: die Bedingung für den `?`-Guard ────────────────────────────

test('isTextEntry: text-artige Eingaben, textarea, select und contenteditable zählen als Texteingabe', () => {
    assert.equal(isTextEntry({ tagName: 'INPUT', type: 'text' }), true)
    assert.equal(isTextEntry({ tagName: 'input', type: 'search' }), true, 'Groß-/Kleinschreibung des Tags egal')
    assert.equal(isTextEntry({ tagName: 'TEXTAREA' }), true)
    assert.equal(isTextEntry({ tagName: 'SELECT' }), true, 'Typeahead-Auswahl läuft über Tastendrücke')
    assert.equal(isTextEntry({ isContentEditable: true }), true)
})

test('isTextEntry: Buttons, Checkboxen und der leere Fokus zählen NICHT — dort darf ? die Hilfe öffnen', () => {
    assert.equal(isTextEntry(null), false)
    assert.equal(isTextEntry({ tagName: 'BUTTON' }), false)
    assert.equal(isTextEntry({ tagName: 'INPUT', type: 'checkbox' }), false)
    assert.equal(isTextEntry({ tagName: 'INPUT', type: 'radio' }), false)
    assert.equal(isTextEntry({ tagName: 'BODY' }), false)
})
