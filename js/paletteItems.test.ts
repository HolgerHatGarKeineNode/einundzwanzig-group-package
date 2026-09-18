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
    WORKSPACE_SIGIL,
    hasPaletteScope,
    isTextEntry,
    isWorkspaceScope,
    mergePaletteScope,
    parsePaletteScope,
    paletteSigil,
    paletteScopeToken,
    recentRooms,
    scopedRooms,
    visibleSections,
    isPortalSection,
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

test('visibleSections: with input every section EXCEPT „zusagen", in a fixed order', () => {
    // Since P4 there are eight of them; P5 added a ninth that is deliberately not among them.
    // The order itself is pinned by the contract case further down.
    assert.deepEqual(
        visibleSections({ ...EMPTY_PALETTE_SCOPE }, 'bit'),
        PALETTE_SECTIONS.filter((section) => section !== 'zusagen'),
    )
})

test('visibleSections: „zusagen" appears ONLY when it is asked for', () => {
    /*
     * Not cosmetics. Every other section offers a LINK; a `zusagen` row publishes a signed,
     * public, permanent kind 31925. Flux activates the first visible option on every text
     * change and opens it on Enter — with these rows in the unscoped list, typing a meetup's
     * name and pressing Enter could publish an answer instead of opening a page.
     */
    assert.equal(visibleSections(EMPTY_PALETTE_SCOPE, '').includes('zusagen'), false)
    assert.equal(visibleSections(EMPTY_PALETTE_SCOPE, 'kempten').includes('zusagen'), false)
    assert.deepEqual(visibleSections({ section: 'zusagen', group: null, country: '' }, ''), ['zusagen'])
})

test('parsePaletteScope: `z:` is the chip of the „zusagen" section', () => {
    assert.deepEqual(parsePaletteScope('z:').scope, { section: 'zusagen', group: null, country: '' })
    assert.deepEqual(parsePaletteScope('Z: kempten'), {
        scope: { section: 'zusagen', group: null, country: '' },
        rest: 'kempten',
    })
    // TWO letters stay what the grammar has always made of them: a country code
    // (`parseScope`), not a longer form of this prefix — which is exactly why the new chip
    // had to be a single letter.
    // (a two-letter token implies the meetup group — a country filter over rooms without a
    // country would always be empty, `railGroups.parseScope`).
    assert.deepEqual(parsePaletteScope('zu:').scope, { section: 'rooms', group: 'meetups', country: 'ZU' })
})

test('visibleSections: mit gesetztem Scope genau die eine adressierte Sektion', () => {
    assert.deepEqual(visibleSections({ section: 'members', group: null, country: '' }, ''), ['members'])
    assert.deepEqual(visibleSections({ section: 'actions', group: null, country: '' }, 'suche'), ['actions'])
})

// ── P5: der Workspace-Scope ─────────────────────────────────────────────────

test('isWorkspaceScope erkennt genau die Gruppe workspace, unabhängig von der Sektion', () => {
    assert.equal(isWorkspaceScope(parsePaletteScope('w:pinguin').scope), true)
    assert.equal(isWorkspaceScope({ ...EMPTY_PALETTE_SCOPE }), false)
    assert.equal(isWorkspaceScope({ section: 'rooms', group: 'meetups', country: '' }), false)
    assert.equal(isWorkspaceScope({ section: 'members', group: null, country: '' }), false)
})

/**
 * **Das ist kein Kosmetik-Test.** Solange im Workspace-Scope auch nur EINE
 * `ui-option` entsteht, aktiviert Flux sie bei jeder Textänderung
 * (`_filterable.onChange` → `activateFirst()`) und öffnet sie bei Enter
 * (`handleKeyboardSelection`) — die Enter-Taste spränge dann in einen Raum,
 * statt den Relay zu fragen. Die leere Liste IST der Mechanismus.
 */
test('visibleSections: der Workspace-Scope erzeugt KEINE Flux-Option — sonst frisst Flux das Enter', () => {
    const scope = parsePaletteScope('w:').scope

    assert.deepEqual(visibleSections(scope, ''), [])
    assert.deepEqual(visibleSections(scope, 'pinguin'), [])
})

test('paletteSigil: der Workspace-Scope trägt die Lupe, nicht das Raum-Sigel', () => {
    assert.equal(paletteSigil(parsePaletteScope('w:x').scope), WORKSPACE_SIGIL)
    // Die übrigen Scopes bleiben unverändert — der Workspace ist ein Sonderfall,
    // keine neue Regel für alle.
    assert.equal(paletteSigil({ section: 'rooms', group: 'meetups', country: '' }), '#')
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

// ── P4/D6: the four Portal sections ────────────────────────────────────────

test('parsePaletteScope: o: t: k: l: address the Portal sections', () => {
    assert.deepEqual(parsePaletteScope('o:kempten'), {
        scope: { section: 'meetups', group: null, country: '' },
        rest: 'kempten',
    })
    assert.deepEqual(parsePaletteScope('t:'), {
        scope: { section: 'events', group: null, country: '' },
        rest: '',
    })
    assert.deepEqual(parsePaletteScope('k:basis'), {
        scope: { section: 'courses', group: null, country: '' },
        rest: 'basis',
    })
    assert.deepEqual(parsePaletteScope('L: johannes'), {
        scope: { section: 'lecturers', group: null, country: '' },
        rest: 'johannes',
    })
})

test('parsePaletteScope: `m:` stays the ROOM group — the Portal section carries its own prefix', () => {
    // The heart of D6's collision question: the same word ("Meetups") for two things, hence
    // two prefixes. An `m:` that suddenly filtered Portal pages would have made every head
    // that uses the rail relearn it.
    assert.deepEqual(parsePaletteScope('m:kempten').scope, { section: 'rooms', group: 'meetups', country: '' })
    assert.deepEqual(parsePaletteScope('o:kempten').scope, { section: 'meetups', group: null, country: '' })
})

test('parsePaletteScope: a country code stays a country code', () => {
    // Two letters are ALWAYS a country (`parseScope`) — which is why the Portal prefixes are
    // single letters. Measured so a later `tr:` does not silently become a country filter.
    assert.deepEqual(parsePaletteScope('at:graz').scope, { section: 'rooms', group: 'meetups', country: 'AT' })
})

test('paletteScopeToken: a Portal section writes its prefix back WITH the colon', () => {
    // This is the text a click on the chip writes into the field — it has to parse back into
    // the same section, or the surface teaches a grammar it does not understand itself.
    for (const [token, section] of [['o:', 'meetups'], ['t:', 'events'], ['k:', 'courses'], ['l:', 'lecturers']] as const) {
        const scope: PaletteScope = { section, group: null, country: '' }
        assert.equal(paletteScopeToken(scope), token)
        assert.equal(parsePaletteScope(token).scope.section, section)
    }
})

test('visibleSections: the Portal sections appear only once something is typed', () => {
    // At rest 312 meetup rows would be noise (and 312 DOM nodes); with input all eight
    // sections are available.
    assert.deepEqual(visibleSections(EMPTY_PALETTE_SCOPE, ''), ['rooms', 'actions'])
    assert.deepEqual(
        visibleSections(EMPTY_PALETTE_SCOPE, 'kempten'),
        PALETTE_SECTIONS.filter((section) => section !== 'zusagen'),
    )
    // With a scope exactly the addressed one — even without input (`t:` means "show me dates").
    assert.deepEqual(visibleSections({ section: 'events', group: null, country: '' }, ''), ['events'])
})

test('PALETTE_SECTIONS: the order is contract — Portal between spaces and actions', () => {
    assert.deepEqual([...PALETTE_SECTIONS], [
        'rooms', 'members', 'spaces', 'meetups', 'events', 'courses', 'lecturers', 'zusagen', 'actions',
    ])
})

test('isPortalSection separates the four Portal sections from the Nostr surfaces', () => {
    assert.equal(isPortalSection('meetups'), true)
    assert.equal(isPortalSection('lecturers'), true)
    assert.equal(isPortalSection('rooms'), false)
    assert.equal(isPortalSection('actions'), false)
    // `zusagen` reads the same index and is still not a Portal section: its rows publish
    // instead of navigating, which is why it is gated differently everywhere.
    assert.equal(isPortalSection('zusagen'), false)
    assert.equal(isPortalSection(null), false)
})
