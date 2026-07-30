/**
 * Pure-Tests für die Rail-Gruppierung (welshman-frei).
 * Läuft ohne neue Dependency über Nodes eingebauten Test-Runner + TS-Type-Stripping:
 *   node --test packages/einundzwanzig-group/js/railGroups.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
    EMPTY_SCOPE,
    RAIL_GROUP_ORDER,
    UNJOINED_CAP,
    buildGroups,
    groupOf,
    matchRoom,
    matchedViaCity,
    middleTruncate,
    parseScope,
    scopeToken,
    splitMine,
    type RailGroupKey,
    type RailRoom,
} from './railGroups.ts'

const room = (over: Partial<RailRoom> & { h: string }): RailRoom => ({
    name: over.h,
    joined: false,
    ...over,
})

const group = (groups: ReturnType<typeof buildGroups>, key: RailGroupKey) =>
    groups.find((g) => g.key === key)!

test('groupOf: Antrag schlägt Meetup — „Antrag" ist die speziellere Aussage', () => {
    assert.equal(groupOf(room({ h: 'a' })), 'rooms')
    assert.equal(groupOf(room({ h: 'b', isMeetup: true })), 'meetups')
    assert.equal(groupOf(room({ h: 'c', isProjectSupport: true })), 'proposals')
    assert.equal(groupOf(room({ h: 'd', isMeetup: true, isProjectSupport: true })), 'proposals')
})

test('Gruppenreihenfolge ist Vertrag, nicht Zufall', () => {
    assert.deepEqual([...RAIL_GROUP_ORDER], ['rooms', 'meetups', 'proposals', 'workspace'])
    assert.deepEqual(buildGroups([]).map((g) => g.key), [...RAIL_GROUP_ORDER])
})

test('Beigetretene stehen vor den anderen und werden NIE gekappt', () => {
    const rooms = [
        ...Array.from({ length: 30 }, (_, i) => room({ h: `mine${i}`, joined: true })),
        ...Array.from({ length: 30 }, (_, i) => room({ h: `other${i}` })),
    ]
    const g = group(buildGroups(rooms), 'rooms')

    assert.equal(g.joined.length, 30, 'beigetretene ungekappt')
    assert.equal(g.others.length, UNJOINED_CAP)
    assert.equal(g.hiddenCount, 30 - UNJOINED_CAP)
    assert.equal(g.total, 60, 'der Kopf zeigt den Bestand VOR der Kappung')
})

test('Gefiltert wird NIE gekappt — eine Kappung auf ein angefordertes Ergebnis wäre eine Lüge', () => {
    const rooms = Array.from({ length: 30 }, (_, i) => room({ h: `treffer${i}` }))
    const g = group(buildGroups(rooms, { query: 'treffer' }), 'rooms')

    assert.equal(g.others.length, 30)
    assert.equal(g.hiddenCount, 0)
})

test('Meetups: nicht beigetretene nach Aktivität, Räume alphabetisch', () => {
    const meetups = [
        room({ h: 'alt', isMeetup: true, lastMessageAt: 100 }),
        room({ h: 'neu', isMeetup: true, lastMessageAt: 900 }),
        room({ h: 'nie', isMeetup: true, lastMessageAt: null }),
    ]
    assert.deepEqual(group(buildGroups(meetups), 'meetups').others.map((r) => r.h), ['neu', 'alt', 'nie'])

    const plain = [room({ h: 'zulu' }), room({ h: 'alpha' })]
    assert.deepEqual(group(buildGroups(plain), 'rooms').others.map((r) => r.h), ['alpha', 'zulu'])
})

test('Suche trifft über die Stadt, nicht nur über den Namen', () => {
    const pres = { 'allgaeu-e2e': { city: 'Kempten', country: 'DE', flag: '🇩🇪' } }
    const r = room({ h: 'x', name: 'Bitcoin Meetup Allgäu', isMeetup: true, meetupSlug: 'allgaeu-e2e' })

    assert.equal(matchRoom(r, pres['allgaeu-e2e'], 'kempten'), true)
    assert.equal(matchedViaCity(r, pres['allgaeu-e2e'], 'kempten'), true, 'Trefferbegründung nötig')
    assert.equal(matchedViaCity(r, pres['allgaeu-e2e'], 'allgäu'), false, 'Name traf — keine Begründung nötig')
    assert.equal(matchRoom(r, pres['allgaeu-e2e'], 'hamburg'), false)
})

test('Landfilter greift nur auf Meetups — andere Gruppen tragen kein Land', () => {
    const pres = { de: { country: 'DE' }, at: { country: 'AT' } }
    const rooms = [
        room({ h: 'm-de', isMeetup: true, meetupSlug: 'de' }),
        room({ h: 'm-at', isMeetup: true, meetupSlug: 'at' }),
        room({ h: 'normal' }),
    ]
    const groups = buildGroups(rooms, { presentations: pres, scope: { group: null, country: 'DE' } })

    assert.deepEqual(group(groups, 'meetups').others.map((r) => r.h), ['m-de'])
    assert.equal(group(groups, 'rooms').others.length, 0, 'Räume ohne Land fallen aus dem Landfilter')
})

test('Scope-Präfixe: bekannte Kürzel greifen, unbekannte bleiben Text', () => {
    assert.deepEqual(parseScope('m:kempten'), { scope: { group: 'meetups', country: '' }, rest: 'kempten' })
    assert.deepEqual(parseScope('p: antrag'), { scope: { group: 'proposals', country: '' }, rest: 'antrag' })
    assert.deepEqual(parseScope('de:'), { scope: { group: 'meetups', country: 'DE' }, rest: '' })
    assert.deepEqual(parseScope('foo:bar'), { scope: EMPTY_SCOPE, rest: 'foo:bar' })
    assert.deepEqual(parseScope('einfach'), { scope: EMPTY_SCOPE, rest: 'einfach' })
})

test('scopeToken schreibt genau das Präfix, das parseScope wieder liest', () => {
    for (const key of RAIL_GROUP_ORDER) {
        const token = scopeToken({ group: key, country: '' })
        assert.equal(parseScope(token).scope.group, key, `Rundlauf für ${key}`)
    }
    assert.equal(parseScope(scopeToken({ group: 'meetups', country: 'AT' })).scope.country, 'AT')
})

test('Workspace-Räume landen in ihrer eigenen Gruppe, nicht bei den Räumen', () => {
    const groups = buildGroups([room({ h: 'heim' })], { workspaceRooms: [room({ h: 'ws', joined: true })] })

    assert.deepEqual(group(groups, 'workspace').joined.map((r) => r.h), ['ws'])
    assert.deepEqual(group(groups, 'rooms').others.map((r) => r.h), ['heim'])
})

test('middleTruncate erhält das unterscheidende Ende', () => {
    const long = 'bitcoin-einsteigervortrag-von-prag-2026'
    const cut = middleTruncate(long, 20)

    assert.ok(cut.length <= 20)
    assert.ok(cut.includes('…'))
    assert.ok(cut.startsWith('bitcoin'), 'Kopf bleibt erkennbar')
    assert.ok(long.endsWith(cut.slice(cut.indexOf('…') + 1)), 'Ende bleibt erhalten')
    assert.equal(middleTruncate('kurz', 20), 'kurz', 'kurze Namen bleiben unangetastet')
})

// ── Mobile Untergliederung von „Meine Räume" ────────────────────────────────

const mine = (h: string, isMeetup = false): RailRoom => room({ h, isMeetup, joined: true })

test('splitMine: unter der Schwelle bleibt es EINE Sektion', () => {
    const rooms = [mine('a'), mine('b'), mine('c', true), mine('d', true)]
    const secs = splitMine(rooms)

    assert.equal(secs.length, 1, '4 Zeilen sind noch keine Gruppe')
    assert.equal(secs[0].key, 'rooms')
    assert.equal(secs[0].rooms.length, 4)
})

test('splitMine: ab der Schwelle zwei Sektionen, Räume vor Meetups', () => {
    const rooms = [mine('a'), mine('m1', true), mine('b'), mine('m2', true), mine('c')]
    const secs = splitMine(rooms)

    assert.deepEqual(secs.map((s) => s.key), ['rooms', 'meetups'])
    assert.deepEqual(secs[0].rooms.map((r) => r.h), ['a', 'b', 'c'])
    assert.deepEqual(secs[1].rooms.map((r) => r.h), ['m1', 'm2'])
})

test('splitMine: nur ein Typ bleibt EINE Sektion — mit dem passenden Namen', () => {
    const nurRaeume = splitMine(Array.from({ length: 6 }, (_, i) => mine(`r${i}`)))
    assert.equal(nurRaeume.length, 1)
    assert.equal(nurRaeume[0].key, 'rooms')

    const nurMeetups = splitMine(Array.from({ length: 6 }, (_, i) => mine(`m${i}`, true)))
    assert.equal(nurMeetups.length, 1)
    assert.equal(nurMeetups[0].key, 'meetups', 'eine Überschrift über allem ist keine Gruppe')
})

test('splitMine: leere Liste ergibt keine Sektion', () => {
    assert.deepEqual(splitMine([]), [])
})

test('splitMine gibt die ORIGINAL-Objekte zurück, keine Kopien', () => {
    // `room-tile` setzt bei einem Bildfehler `room.picture = ''`, damit der
    // Fallback greift — an einer Kopie liefe das ins Leere.
    const a = mine('a')
    const m = mine('m', true)
    const secs = splitMine([a, mine('b'), mine('c'), m, mine('n', true)])

    assert.equal(secs[0].rooms[0], a, 'Identität, nicht Gleichheit')
    assert.equal(secs[1].rooms[0], m)
})

test('splitMine sortiert NICHT um — die Eingabereihenfolge gilt', () => {
    const secs = splitMine([mine('zulu'), mine('alpha'), mine('m'), mine('mm', true), mine('nn', true)])

    assert.deepEqual(secs[0].rooms.map((r) => r.h), ['zulu', 'alpha', 'm'])
})
