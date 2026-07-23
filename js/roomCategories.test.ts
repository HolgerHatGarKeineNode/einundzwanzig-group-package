/**
 * Pure-Tests fuer Raum-Kategorien & Zusatz-Tags (welshman-app-frei).
 * Laeuft ohne neue Dependency ueber Nodes eingebauten Test-Runner + TS-Type-Stripping:
 *   node --test packages/einundzwanzig-group/js/roomCategories.test.ts
 *
 * `groups.ts` selbst ist hier NICHT importierbar (es zieht ueber @welshman/app
 * `localStorage` beim Modul-Load) — deshalb wird `roomMetaEvent` unten aus seinen
 * beiden echten Bausteinen nachgestellt: welshmans `makeRoomEditEvent` (unveraendert
 * aus node_modules) + `withExtraTags` (Produktionscode). Der einzige nicht mitgetestete
 * Teil ist der Store-Lookup des vorhandenen 39000, der hier als `existing` reinkommt.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { makeRoomEditEvent } from '@welshman/util'
import {
    DEFAULT_ROOM_TYPE,
    PROJECT_SUPPORT_MARKER,
    isFocusMode,
    isStandardRoom,
    parseProjectSupportTags,
    parseRoomType,
    projectSupportTags,
    supportsCountryFilter,
    withExtraTags,
} from './roomCategories.ts'
import { parseMeetupTags } from './meetupPresentation.ts'

// ── Kategorie-Erkennung ─────────────────────────────────────────────────────

test('parseProjectSupportTags hebt Marker und Antrags-id aus den Roh-Tags', () => {
    const tags = [
        ['d', 'p3f9a2b7c1d0'],
        ['name', 'Antrag: Bitcoin-Meetup-Foerderung'],
        ['private'],
        ['closed'],
        ['hidden'],
        ['t', 'project-support'],
        ['i', 'proposal:42'],
    ]
    assert.deepEqual(parseProjectSupportTags(tags), { isProjectSupport: true, proposalId: '42' })
})

test('parseProjectSupportTags: Raum ohne Marker bleibt leer', () => {
    const tags = [
        ['d', 'welcome'],
        ['name', 'Willkommen'],
        ['t', 'other'],
    ]
    assert.deepEqual(parseProjectSupportTags(tags), { isProjectSupport: false, proposalId: '' })
})

test('parseProjectSupportTags toleriert fehlende/leere Tags (Warm-Render-Race)', () => {
    assert.deepEqual(parseProjectSupportTags([]), { isProjectSupport: false, proposalId: '' })
})

test('parseProjectSupportTags: Marker ohne Bindung → kategorisiert, aber ohne Antrags-id', () => {
    assert.deepEqual(parseProjectSupportTags([['t', 'project-support']]), {
        isProjectSupport: true,
        proposalId: '',
    })
})

test('die Raum-ID („p…"-Praefix) entscheidet NICHT — nur der Marker', () => {
    // Analog zu den Meetups, wo das `m`-Praefix ebenfalls niemand auswertet.
    assert.equal(parseProjectSupportTags([['d', 'p3f9a2b7c1d0']]).isProjectSupport, false)
})

test('REGRESSION Meetup: ein Meetup-Raum ist keine Projektunterstuetzung', () => {
    const meetupTags = [
        ['d', 'm3f9a2b7c1d0'],
        ['name', 'Einundzwanzig Saarbrücken'],
        ['t', 'meetup'],
        ['i', 'meetup:42'],
        ['meetup_slug', 'einundzwanzig-saarbruecken'],
    ]
    assert.deepEqual(parseProjectSupportTags(meetupTags), { isProjectSupport: false, proposalId: '' })
    // …und die Meetup-Erkennung bleibt davon voellig unberuehrt.
    assert.deepEqual(parseMeetupTags(meetupTags), {
        isMeetup: true,
        meetupId: '42',
        meetupSlug: 'einundzwanzig-saarbruecken',
    })
})

test('REGRESSION Meetup: ein Antragsraum ist kein Meetup', () => {
    const psTags = [
        ['d', 'p3f9a2b7c1d0'],
        ['t', 'project-support'],
        ['i', 'proposal:7'],
    ]
    assert.deepEqual(parseMeetupTags(psTags), { isMeetup: false, meetupId: '', meetupSlug: '' })
})

test('projectSupportTags baut Marker + Bindung (ohne id nur den Marker)', () => {
    assert.deepEqual(projectSupportTags(42), [
        ['t', PROJECT_SUPPORT_MARKER],
        ['i', 'proposal:42'],
    ])
    assert.deepEqual(projectSupportTags('7'), [
        ['t', 'project-support'],
        ['i', 'proposal:7'],
    ])
    assert.deepEqual(projectSupportTags(''), [['t', 'project-support']])
    assert.deepEqual(projectSupportTags(), [['t', 'project-support']])
})

// ── Standard-Raum-Filter (die Produktions-Praedikate der Raumliste) ─────────

test('isStandardRoom: nur unkategorisierte Raeume sind Standard', () => {
    assert.equal(isStandardRoom({}), true)
    assert.equal(isStandardRoom({ isMeetup: false, isProjectSupport: false }), true)
    assert.equal(isStandardRoom({ isMeetup: true, isProjectSupport: false }), false)
    assert.equal(isStandardRoom({ isMeetup: false, isProjectSupport: true }), false)
})

test('Raumliste: Antragsraum faellt aus „Andere", bleibt aber in „Meine Raeume"', () => {
    // Spiegelt die beiden Filterstellen der Bridge (standardCount/_ensureFiltered):
    // `otherRooms` laeuft durch `isStandardRoom`, `userRooms` bewusst NICHT.
    const plain = { h: 'welcome', isMeetup: false, isProjectSupport: false }
    const meetup = { h: 'm1', isMeetup: true, isProjectSupport: false }
    const proposal = { h: 'p3f9a2b7c1d0', isMeetup: false, isProjectSupport: true }

    const otherRooms = [plain, meetup, proposal]
    const userRooms = [proposal]

    assert.deepEqual(otherRooms.filter(isStandardRoom), [plain], 'Meetup UND Antragsraum raus')
    // Der Meetup-Pool (Positiv-Filter) zieht weiterhin nur Meetups — kein Seiteneffekt.
    assert.deepEqual(
        otherRooms.filter((r) => r.isMeetup),
        [meetup],
    )
    // Kein Verstecken: wer Mitglied ist, sieht seinen Antragsraum weiter.
    assert.deepEqual(userRooms, [proposal])
    assert.equal(userRooms.length + otherRooms.filter(isStandardRoom).length, 2, 'standardCount zaehlt Meine voll mit')
})

// ── Zusatz-Tags am 9002 (`roomMetaEvent`) ───────────────────────────────────

const baseInput = {
    h: 'p3f9a2b7c1d0',
    name: 'Antrag: Bitcoin-Meetup-Foerderung',
    about: 'Vorstandsraum zum Antrag',
    picture: '',
    isPrivate: true,
    isClosed: true,
    isHidden: true,
    isRestricted: false,
}

/** 1:1 der Rumpf von `groups.ts#roomMetaEvent` — nur der Store-Lookup ist Parameter. */
const metaEvent = (input: typeof baseInput & { extraTags?: string[][] }, existing?: { tags: string[][] }) =>
    withExtraTags(
        makeRoomEditEvent({ ...input, pictureMeta: undefined, event: existing as never }),
        input.extraTags,
    )

test('ohne extraTags ist das Event byte-gleich zu vorher (identische Referenz)', () => {
    const built = makeRoomEditEvent({ ...baseInput, pictureMeta: undefined, event: undefined })
    const before = JSON.stringify(built)

    assert.equal(withExtraTags(built), built, 'dieselbe Referenz, kein Rebuild')
    assert.equal(withExtraTags(built, []), built)
    assert.equal(JSON.stringify(withExtraTags(built, [])), before)
    // …und auch das komplette 9002 aus dem Aufrufer-Pfad bleibt unveraendert.
    assert.equal(JSON.stringify(metaEvent(baseInput)), before)
})

test('ANLEGEN: extraTags landen im 9002 (Marker + Bindung)', () => {
    const event = metaEvent({ ...baseInput, extraTags: projectSupportTags(42) })
    assert.equal(event.kind, 9002)
    assert.deepEqual(event.tags, [
        ['h', 'p3f9a2b7c1d0'],
        ['name', 'Antrag: Bitcoin-Meetup-Foerderung'],
        ['about', 'Vorstandsraum zum Antrag'],
        ['closed'],
        ['hidden'],
        ['private'],
        ['t', 'project-support'],
        ['i', 'proposal:42'],
    ])
    // Und die Gegenprobe: aus genau diesen Tags liest der Client die Kategorie.
    assert.deepEqual(parseProjectSupportTags(event.tags), { isProjectSupport: true, proposalId: '42' })
})

test('EDIT: Fremd-Tags des vorhandenen 39000 ueberleben unveraendert (Meetup-Marker!)', () => {
    // Der produktive Meetup-Fall: Admin editiert Name/Beschreibung eines per nak
    // angelegten Meetup-Raums. Ohne extraTags — genau der heutige Pfad.
    const existing = {
        tags: [
            ['d', 'm3f9a2b7c1d0'],
            ['name', 'Alt'],
            ['t', 'meetup'],
            ['i', 'meetup:42'],
            ['meetup_slug', 'einundzwanzig-saarbruecken'],
        ],
    }
    const event = metaEvent({ ...baseInput, h: 'm3f9a2b7c1d0', name: 'Neu', isPrivate: false, isClosed: false, isHidden: false }, existing)
    assert.deepEqual(parseMeetupTags(event.tags), {
        isMeetup: true,
        meetupId: '42',
        meetupSlug: 'einundzwanzig-saarbruecken',
    })
    assert.equal(event.tags.filter((t) => t[0] === 't').length, 1)
    assert.equal(event.tags.filter((t) => t[0] === 'i').length, 1)
})

test('EDIT eines Antragsraums: Marker ueberlebt und wird NICHT verdoppelt', () => {
    const existing = {
        tags: [
            ['d', 'p3f9a2b7c1d0'],
            ['name', 'Alt'],
            ['t', 'project-support'],
            ['i', 'proposal:42'],
        ],
    }
    // (a) ohne extraTags — der normale Edit-Pfad der UI
    const plain = metaEvent({ ...baseInput, name: 'Neu' }, existing)
    assert.deepEqual(parseProjectSupportTags(plain.tags), { isProjectSupport: true, proposalId: '42' })

    // (b) mit denselben extraTags — der Aufrufer schickt den Marker erneut mit
    const again = metaEvent({ ...baseInput, name: 'Neu', extraTags: projectSupportTags(42) }, existing)
    assert.deepEqual(again.tags, plain.tags, 'nichts kommt dazu')
    assert.equal(again.tags.filter((t) => t[0] === 't' && t[1] === 'project-support').length, 1)
    assert.equal(again.tags.filter((t) => t[0] === 'i' && t[1] === 'proposal:42').length, 1)
})

test('withExtraTags: gleicher Tag-Name mit anderem Wert verdraengt nichts (Mengen-Semantik)', () => {
    const event = { tags: [['t', 'meetup'], ['i', 'meetup:42']] }
    const merged = withExtraTags(event, projectSupportTags(7))
    assert.deepEqual(merged.tags, [
        ['t', 'meetup'],
        ['i', 'meetup:42'],
        ['t', 'project-support'],
        ['i', 'proposal:7'],
    ])
    assert.deepEqual(event.tags.length, 2, 'das Eingangs-Event wird nicht mutiert')
})

test('withExtraTags: kaputte Zusatz-Tags werden ignoriert, nicht durchgereicht', () => {
    const event = { tags: [['h', 'x']] }
    assert.equal(withExtraTags(event, [[], ['']] as string[][]), event)
    assert.deepEqual(withExtraTags(event, [[], ['t', 'ok']]).tags, [
        ['h', 'x'],
        ['t', 'ok'],
    ])
})

// ── Fokus-Kategorie der Raumuebersicht (`?rt=`) ─────────────────────────────

test('parseRoomType: bekannte Kategorien durch, alles andere auf den Default', () => {
    assert.equal(parseRoomType('meetups'), 'meetups')
    assert.equal(parseRoomType('proposals'), 'proposals')
    assert.equal(parseRoomType('rooms'), 'rooms')
    // Kaputte/fehlende URL zeigt die Standardliste, nie eine leere Seite.
    assert.equal(parseRoomType(null), DEFAULT_ROOM_TYPE)
    assert.equal(parseRoomType(undefined), DEFAULT_ROOM_TYPE)
    assert.equal(parseRoomType(''), DEFAULT_ROOM_TYPE)
    assert.equal(parseRoomType('Meetups'), DEFAULT_ROOM_TYPE, 'Gross-/Kleinschreibung ist keine Kategorie')
    assert.equal(parseRoomType('<script>'), DEFAULT_ROOM_TYPE)
})

test('isFocusMode ist kategorie-agnostisch: alles ausser dem Default ist Fokus', () => {
    assert.equal(isFocusMode('rooms'), false)
    assert.equal(isFocusMode('meetups'), true)
    assert.equal(isFocusMode('proposals'), true)
})

test('Land-Filter gibt es NUR bei Meetups — Antragsraeume tragen kein Land', () => {
    assert.equal(supportsCountryFilter('meetups'), true)
    assert.equal(supportsCountryFilter('proposals'), false)
    assert.equal(supportsCountryFilter('rooms'), false)
})
