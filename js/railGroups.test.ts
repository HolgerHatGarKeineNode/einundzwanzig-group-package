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
    buildWorkspaceList,
    groupOf,
    matchRoom,
    matchedViaCity,
    middleTruncate,
    parseScope,
    scopeToken,
    splitMine,
    type RailGroupKey,
    type RailRoom,
    type WorkspaceSections,
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
    assert.deepEqual([...RAIL_GROUP_ORDER], ['rooms', 'workspace', 'meetups', 'proposals'])
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

test('die vier Kürzel stehen WÖRTLICH da — inklusive des neuen f: (P5)', () => {
    // Gegen Literale, nicht gegen `SCOPE_PREFIX` iteriert: eine Schleife über die
    // Konstante prüft sie gegen sich selbst und bliebe grün, wenn jemand ein Kürzel
    // vertauscht. Die Zeichen sind das, was der Nutzer TIPPT — sie sind Vertrag.
    assert.equal(parseScope('r:').scope.group, 'rooms')
    assert.equal(parseScope('m:').scope.group, 'meetups')
    assert.equal(parseScope('p:').scope.group, 'proposals')
    assert.equal(parseScope('f:').scope.group, 'workspace')
})

test('f: und w: zeigen auf DIESELBE Gruppe — der alte Weg bleibt offen (P5)', () => {
    // Die Sektion heißt seit P5 „Forge"; `f:` ist das neue Kürzel. `w:` steckt in
    // jedem Kopf, der die Rail schon benutzt hat — verlöre es seine Bedeutung, würde
    // daraus still eine gewöhnliche Suche nach dem Text „w:" und die Liste wäre leer
    // statt gefiltert. Beide Richtungen, beide mit Resttext.
    assert.deepEqual(parseScope('f: repo'), { scope: { group: 'workspace', country: '' }, rest: 'repo' })
    assert.deepEqual(parseScope('w: repo'), { scope: { group: 'workspace', country: '' }, rest: 'repo' })
    assert.equal(parseScope('F:egal').scope.group, 'workspace', 'Großschreibung zählt gleich')
    assert.equal(parseScope('W:egal').scope.group, 'workspace', 'Großschreibung zählt gleich')
})

test('die Lupe schreibt das NEUE Kürzel f:, nicht mehr w: (P5)', () => {
    // `scopeToken` nimmt den ersten Eintrag in `SCOPE_PREFIX`, der auf die Gruppe
    // zeigt — die Reihenfolge der Schlüssel ist damit Vertrag. Stünde `w` vorn,
    // schriebe die Lupe weiter das alte Kürzel, während der Hilfetext der Rail
    // `f:` verspricht: zwei Wahrheiten über dieselbe Taste.
    assert.equal(scopeToken({ group: 'workspace', country: '' }), 'f:')
    assert.equal(scopeToken({ group: 'rooms', country: '' }), 'r:')
    assert.equal(scopeToken({ group: 'meetups', country: '' }), 'm:')
    assert.equal(scopeToken({ group: 'proposals', country: '' }), 'p:')
})

test('RAIL_GROUP_ORDER ist unverändert — der Gruppenschlüssel heißt weiter workspace (P5)', () => {
    // Umbenannt wurde der ANZEIGENAME der Sektion („Workspace" → „Forge"), nicht der
    // Schlüssel. Er steht in dieser Reihenfolge, in `railTargets` (Alt+↑/↓) und in
    // gespeicherten Faltungszuständen; ihn mitzuändern wäre eine Datenmigration für
    // eine Beschriftung. WÖRTLICH, damit ein Umbenennen hier rot wird.
    assert.deepEqual([...RAIL_GROUP_ORDER], ['rooms', 'workspace', 'meetups', 'proposals'])
})

test('Workspace-Räume landen in ihrer eigenen Gruppe, nicht bei den Räumen', () => {
    const groups = buildGroups([room({ h: 'heim' })], { workspaceRooms: [room({ h: 'ws', joined: true })] })

    assert.deepEqual(group(groups, 'workspace').joined.map((r) => r.h), ['ws'])
    assert.deepEqual(group(groups, 'rooms').others.map((r) => r.h), ['heim'])
})

// ── Workspace-Präferenzen aus Buzz Desktop (NIP-78, kind 30078) ─────────────

const ws = (over: Partial<RailRoom> & { h: string }): RailRoom => room({ joined: true, ...over })

test('Ohne Präferenzen bleibt alles wie vorher — pinned und muted sind leer', () => {
    const groups = buildGroups([room({ h: 'heim' })], { workspaceRooms: [ws({ h: 'a' })] })

    for (const g of groups) {
        assert.deepEqual(g.pinned, [], `${g.key}: keine Anheftung ohne Präferenz`)
        assert.deepEqual(g.muted, [], `${g.key}: keine Stummschaltung ohne Präferenz`)
    }
})

test('Angeheftete stehen oben und NICHT mehr in joined/others', () => {
    const groups = buildGroups([], {
        workspaceRooms: [ws({ h: 'zulu' }), ws({ h: 'alpha' }), ws({ h: 'fremd', joined: false })],
        workspacePrefs: { pinned: ['zulu', 'fremd'] },
    })
    const g = group(groups, 'workspace')

    assert.deepEqual(g.pinned.map((r) => r.h), ['fremd', 'zulu'], 'angeheftet, alphabetisch (Default alpha)')
    assert.deepEqual(g.joined.map((r) => r.h), ['alpha'], 'ein angehefteter Raum steht nicht zweimal da')
    assert.deepEqual(g.others.map((r) => r.h), [])
    assert.equal(g.total, 3, 'der Kopf zählt die Angehefteten mit')
})

test('Angeheftete werden NIE gekappt — auch nicht als Nicht-Mitglieder', () => {
    const rooms = Array.from({ length: 20 }, (_, i) => ws({ h: `w${String(i).padStart(2, '0')}`, joined: false }))
    const g = group(buildGroups([], {
        workspaceRooms: rooms,
        workspacePrefs: { pinned: rooms.map((r) => r.h) },
    }), 'workspace')

    assert.equal(g.pinned.length, 20)
    assert.equal(g.hiddenCount, 0, 'was angeheftet ist, verschluckt die Kappung nicht')
    assert.equal(g.total, 20)
})

test('Sortiermodus `recent` gilt im Workspace — auch für die Beigetretenen', () => {
    const rooms = [
        ws({ h: 'alt', lastMessageAt: 100 }),
        ws({ h: 'neu', lastMessageAt: 900 }),
        ws({ h: 'nie', lastMessageAt: null }),
    ]

    const alpha = group(buildGroups([], { workspaceRooms: rooms }), 'workspace')
    assert.deepEqual(alpha.joined.map((r) => r.h), ['alt', 'neu', 'nie'], 'Default bleibt alphabetisch')

    const recent = group(buildGroups([], { workspaceRooms: rooms, workspacePrefs: { sort: 'recent' } }), 'workspace')
    assert.deepEqual(recent.joined.map((r) => r.h), ['neu', 'alt', 'nie'], 'jüngste Aktivität zuerst, Stille ans Ende')
})

test('Angeheftete haben ihren EIGENEN Sortiermodus (Buzz-Gruppe `starred`)', () => {
    const rooms = [
        ws({ h: 'alt', lastMessageAt: 100 }),
        ws({ h: 'neu', lastMessageAt: 900 }),
        ws({ h: 'ruhig', lastMessageAt: 50 }),
    ]
    const g = group(buildGroups([], {
        workspaceRooms: rooms,
        workspacePrefs: { pinned: ['alt', 'neu'], sort: 'alpha', pinnedSort: 'recent' },
    }), 'workspace')

    assert.deepEqual(g.pinned.map((r) => r.h), ['neu', 'alt'], 'pinnedSort steuert die Angehefteten')
    assert.deepEqual(g.joined.map((r) => r.h), ['ruhig'])
})

test('Stumme Räume bleiben stehen und werden gemeldet — sie verschwinden NICHT', () => {
    const g = group(buildGroups([], {
        workspaceRooms: [ws({ h: 'laut' }), ws({ h: 'still' })],
        workspacePrefs: { muted: ['still', 'gibtesnicht'] },
    }), 'workspace')

    assert.deepEqual(g.joined.map((r) => r.h), ['laut', 'still'], 'stumm heißt leise, nicht weg')
    assert.deepEqual(g.muted, ['still'], 'nur real vorhandene Räume werden gemeldet')
    assert.equal(g.total, 2)
})

test('Stumm gemeldet wird UNGEKAPPT — die Kopfsumme rechnet über den Bestand', () => {
    const rooms = Array.from({ length: 20 }, (_, i) => ws({ h: `w${String(i).padStart(2, '0')}`, joined: false }))
    const g = group(buildGroups([], {
        workspaceRooms: rooms,
        workspacePrefs: { muted: ['w00', 'w19'] },
    }), 'workspace')

    assert.equal(g.others.length, UNJOINED_CAP, 'w19 ist nach der Kappung nicht mehr sichtbar')
    assert.deepEqual(g.muted, ['w00', 'w19'], 'gemeldet wird trotzdem beides — sonst zählte w19 in der Summe mit')
})

test('Die Präferenzen greifen NUR auf den Workspace, nie auf die Heim-Gruppen', () => {
    const groups = buildGroups(
        [room({ h: 'heim', joined: true }), room({ h: 'treff', isMeetup: true, joined: true })],
        { workspacePrefs: { pinned: ['heim', 'treff'], muted: ['heim'], sort: 'recent' } },
    )

    assert.deepEqual(group(groups, 'rooms').pinned, [], 'kein Anheften im zooid-Arm')
    assert.deepEqual(group(groups, 'rooms').muted, [], 'keine Stummschaltung im zooid-Arm')
    assert.deepEqual(group(groups, 'rooms').joined.map((r) => r.h), ['heim'], 'der Raum bleibt, wo er war')
    assert.deepEqual(group(groups, 'meetups').joined.map((r) => r.h), ['treff'])
})

test('Suche und Anheftung zusammen: gefiltert wird zuerst, angeheftet danach', () => {
    const g = group(buildGroups([], {
        workspaceRooms: [ws({ h: 'x', name: 'Bau Nord' }), ws({ h: 'y', name: 'Bau Süd' }), ws({ h: 'z', name: 'Küche' })],
        workspacePrefs: { pinned: ['y', 'z'] },
        query: 'bau',
    }), 'workspace')

    assert.deepEqual(g.pinned.map((r) => r.h), ['y'], 'z ist angeheftet, trifft die Suche aber nicht')
    assert.deepEqual(g.joined.map((r) => r.h), ['x'])
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

// ── Sektionen in der Rail (P7, `channel-sections`) ──────────────────────────

const sectionPrefs = (over: Partial<WorkspaceSections> = {}): WorkspaceSections => ({
    sections: [{ id: 's1', name: 'Arbeit' }, { id: 's2', name: 'Privat' }],
    assignments: {},
    ...over,
})

test('Sektionen erscheinen in der Reihenfolge, die der Aufrufer vorgibt', () => {
    const g = group(buildGroups([], {
        workspaceRooms: [ws({ h: 'a' }), ws({ h: 'b' }), ws({ h: 'c' })],
        workspacePrefs: {
            sections: sectionPrefs({
                // `orderedSections` hat bereits nach `order` sortiert — hier steht
                // die ANZEIGE-Reihenfolge, und buildGroups sortiert sie nicht um.
                sections: [{ id: 's2', name: 'Privat' }, { id: 's1', name: 'Arbeit' }],
                assignments: { a: 's1', b: 's2', c: 's2' },
            }),
        },
    }), 'workspace')

    assert.deepEqual(g.sections.map((s) => s.name), ['Privat', 'Arbeit'])
    assert.deepEqual(g.sections[0].rooms.map((r) => r.h), ['b', 'c'])
    assert.deepEqual(g.sections[1].rooms.map((r) => r.h), ['a'])
})

test('Ein Kanal OHNE Sektion bleibt erreichbar — im Rest-Block unter den Sektionen', () => {
    const g = group(buildGroups([], {
        workspaceRooms: [ws({ h: 'zugeordnet' }), ws({ h: 'lose' }), ws({ h: 'fremd', joined: false })],
        workspacePrefs: { sections: sectionPrefs({ assignments: { zugeordnet: 's1' } }) },
    }), 'workspace')

    assert.deepEqual(g.sections.map((s) => s.rooms.map((r) => r.h)), [['zugeordnet']])
    assert.deepEqual(g.joined.map((r) => r.h), ['lose'], 'kein Kanal verschwindet, weil er keiner Sektion angehört')
    assert.deepEqual(g.others.map((r) => r.h), ['fremd'])
    assert.equal(g.total, 3, 'der Kopf zählt Sektions-Zeilen mit')
})

test('Eine Zuordnung auf eine UNBEKANNTE Sektion ist folgenlos, nicht tödlich', () => {
    const g = group(buildGroups([], {
        workspaceRooms: [ws({ h: 'a' })],
        workspacePrefs: { sections: sectionPrefs({ assignments: { a: 'geloescht' } }) },
    }), 'workspace')

    assert.deepEqual(g.sections, [], 'leere Sektionen fallen heraus')
    assert.deepEqual(g.joined.map((r) => r.h), ['a'], 'der Raum steht im Rest-Block, nicht im Nichts')
})

test('Anheften SCHLÄGT die Sektion — ein Raum steht nie in beidem', () => {
    const g = group(buildGroups([], {
        workspaceRooms: [ws({ h: 'stern' }), ws({ h: 'normal' })],
        workspacePrefs: {
            pinned: ['stern'],
            sections: sectionPrefs({ assignments: { stern: 's1', normal: 's1' } }),
        },
    }), 'workspace')

    assert.deepEqual(g.pinned.map((r) => r.h), ['stern'])
    assert.deepEqual(g.sections.map((s) => s.rooms.map((r) => r.h)), [['normal']], 'der angeheftete Raum ist aus der Sektion raus')
    assert.equal(g.total, 2, 'kein Raum zählt doppelt')
})

test('Jede Sektion hat ihren EIGENEN Sortiermodus (`section:<id>`)', () => {
    const g = group(buildGroups([], {
        workspaceRooms: [
            ws({ h: 'alt', lastMessageAt: 100 }),
            ws({ h: 'neu', lastMessageAt: 900 }),
            ws({ h: 'zulu', lastMessageAt: 900 }),
            ws({ h: 'alpha', lastMessageAt: 100 }),
        ],
        workspacePrefs: {
            sections: sectionPrefs({
                assignments: { alt: 's1', neu: 's1', zulu: 's2', alpha: 's2' },
                sortById: { s1: 'recent', s2: 'alpha' },
            }),
        },
    }), 'workspace')

    assert.deepEqual(g.sections[0].rooms.map((r) => r.h), ['neu', 'alt'], 's1 nach Aktivität')
    assert.deepEqual(g.sections[1].rooms.map((r) => r.h), ['alpha', 'zulu'], 's2 alphabetisch')
})

test('Sektions-Zeilen werden NICHT gekappt — der Deckel gilt nur dem Rest-Block', () => {
    const rooms = Array.from({ length: 20 }, (_, i) => ws({ h: `w${String(i).padStart(2, '0')}`, joined: false }))
    const g = group(buildGroups([], {
        workspaceRooms: rooms,
        workspacePrefs: {
            sections: sectionPrefs({ assignments: Object.fromEntries(rooms.map((r) => [r.h, 's1'])) }),
        },
    }), 'workspace')

    assert.equal(g.sections[0].rooms.length, 20)
    assert.equal(g.hiddenCount, 0)
    assert.equal(g.total, 20)
})

test('Sektionen gibt es NUR im Workspace — nie im zooid-Arm', () => {
    const groups = buildGroups([room({ h: 'heim', joined: true })], {
        workspacePrefs: { sections: sectionPrefs({ assignments: { heim: 's1' } }) },
    })

    assert.deepEqual(group(groups, 'rooms').sections, [])
    assert.deepEqual(group(groups, 'rooms').joined.map((r) => r.h), ['heim'])
})

test('Ohne Sektions-Präferenz ist die Gruppe bitgleich zu vorher', () => {
    const rooms = [ws({ h: 'a' }), ws({ h: 'b', joined: false })]
    const ohne = group(buildGroups([], { workspaceRooms: rooms }), 'workspace')
    const leer = group(buildGroups([], {
        workspaceRooms: rooms,
        workspacePrefs: { sections: { sections: [], assignments: {} } },
    }), 'workspace')

    assert.deepEqual(ohne.sections, [])
    assert.deepEqual(leer.sections, [])
    assert.deepEqual(ohne.joined.map((r) => r.h), leer.joined.map((r) => r.h))
    assert.deepEqual(ohne.others.map((r) => r.h), leer.others.map((r) => r.h))
})

test('Das Emoji der Sektion wird durchgereicht, ein leeres NICHT', () => {
    const g = group(buildGroups([], {
        workspaceRooms: [ws({ h: 'a' }), ws({ h: 'b' })],
        workspacePrefs: {
            sections: {
                sections: [{ id: 's1', name: 'Mit', icon: '🚀' }, { id: 's2', name: 'Ohne' }],
                assignments: { a: 's1', b: 's2' },
            },
        },
    }), 'workspace')

    assert.equal(g.sections[0].icon, '🚀')
    assert.ok(!('icon' in g.sections[1]), 'ohne Emoji steht kein Feld da — sonst rendert die Zeile eine leere Lücke')
})

// ── Die Workspace-Liste der Bühne (P7, Tab „Workspaces" ohne xl) ────────────

test('buildWorkspaceList ohne Präferenzen: beigetreten vor entdeckbar, je alphabetisch', () => {
    const list = buildWorkspaceList([
        ws({ h: 'zulu' }),
        ws({ h: 'alpha' }),
        ws({ h: 'fremd-a', joined: false }),
        ws({ h: 'fremd-z', joined: false }),
    ])

    assert.deepEqual(list.rooms.map((r) => r.h), ['alpha', 'zulu', 'fremd-a', 'fremd-z'])
    assert.deepEqual(list.pinned, [])
    assert.deepEqual(list.muted, [])
})

test('buildWorkspaceList: die in Buzz gesetzte Sortierung wirkt auf der Bühne', () => {
    const rooms = [
        ws({ h: 'alt', lastMessageAt: 100 }),
        ws({ h: 'neu', lastMessageAt: 900 }),
        ws({ h: 'nie', lastMessageAt: null }),
    ]

    assert.deepEqual(buildWorkspaceList(rooms).rooms.map((r) => r.h), ['alt', 'neu', 'nie'])
    assert.deepEqual(
        buildWorkspaceList(rooms, { sort: 'recent' }).rooms.map((r) => r.h),
        ['neu', 'alt', 'nie'],
        'jüngste Aktivität zuerst, Stille ans Ende',
    )
})

test('buildWorkspaceList: stumm heißt leise, nicht weg — und wird gemeldet', () => {
    const list = buildWorkspaceList([ws({ h: 'laut' }), ws({ h: 'still' })], {
        muted: ['still', 'gibtesnicht'],
    })

    assert.deepEqual(list.rooms.map((r) => r.h), ['laut', 'still'], 'die Zeile bleibt stehen')
    assert.deepEqual(list.muted, ['still'], 'nur real vorhandene Räume werden gemeldet')
})

test('buildWorkspaceList: ein stumm geschalteter ANGEHEFTETER Raum wird auch oben gemeldet', () => {
    // Buzz erlaubt beides zugleich; wer nur den Rest-Bestand meldet, zeigt die
    // angeheftete Zeile ohne Glocke — und die Stummschaltung wirkte dort nicht.
    const list = buildWorkspaceList([ws({ h: 'stern' }), ws({ h: 'normal' })], {
        pinned: ['stern'],
        muted: ['stern'],
    })

    assert.deepEqual(list.rooms.map((r) => r.h), ['stern', 'normal'])
    assert.deepEqual(list.pinned, ['stern'])
    assert.deepEqual(list.muted, ['stern'])
})

test('buildWorkspaceList: Angeheftete stehen oben, mit EIGENEM Sortiermodus', () => {
    const list = buildWorkspaceList([
        ws({ h: 'alt', lastMessageAt: 100 }),
        ws({ h: 'neu', lastMessageAt: 900 }),
        ws({ h: 'rest', lastMessageAt: 500 }),
    ], { pinned: ['alt', 'neu'], sort: 'alpha', pinnedSort: 'recent' })

    assert.deepEqual(list.rooms.map((r) => r.h), ['neu', 'alt', 'rest'])
    assert.deepEqual(list.pinned, ['neu', 'alt'], 'gemeldet wird, was wirklich oben steht')
})

test('buildWorkspaceList gibt die ORIGINAL-Objekte zurück und kappt nichts', () => {
    const rooms = Array.from({ length: 30 }, (_, i) => ws({ h: `w${String(i).padStart(2, '0')}`, joined: false }))
    const list = buildWorkspaceList(rooms)

    assert.equal(list.rooms.length, 30, 'die Bühne hat keinen „Noch :count"-Fuß — hier darf nichts verschwinden')
    assert.equal(list.rooms[0], rooms[0], 'Identität, nicht Gleichheit')
})

test('buildWorkspaceList: leere Liste bleibt leer', () => {
    const list = buildWorkspaceList([], { pinned: ['x'], muted: ['y'], sort: 'recent' })

    assert.deepEqual(list.rooms, [])
    assert.deepEqual(list.pinned, [])
    assert.deepEqual(list.muted, [])
})

// ── Repo-gebundene Kanäle (P1) ──────────────────────────────────────────────

test('claimedRoomHs: ein repo-gebundener Kanal fällt aus der flachen Liste — und NUR dort', () => {
    const groups = buildGroups([], {
        workspaceRooms: [ws({ h: 'kanal' }), ws({ h: 'general' })],
        claimedRoomHs: ['kanal'],
    })
    const g = group(groups, 'workspace')

    assert.deepEqual(g.claimed.map((r) => r.h), ['kanal'])
    assert.deepEqual(g.joined.map((r) => r.h), ['general'], 'genau einmal, nicht zweimal')
    assert.deepEqual(g.others, [])
    assert.equal(g.total, 2, 'der Kopf zählt ihn mit — er ist sichtbar, nur woanders')
})

test('claimedRoomHs: ein Kanal OHNE Bindung bleibt flach, wo er war', () => {
    const g = group(buildGroups([], {
        workspaceRooms: [ws({ h: 'general' }), ws({ h: 'welcome', joined: false })],
        claimedRoomHs: ['gibt-es-nicht'],
    }), 'workspace')

    assert.deepEqual(g.claimed, [])
    assert.deepEqual(g.joined.map((r) => r.h), ['general'])
    assert.deepEqual(g.others.map((r) => r.h), ['welcome'])
})

test('Anheften schlägt die Repo-Bindung — die ausdrückliche Wahl gewinnt', () => {
    const g = group(buildGroups([], {
        workspaceRooms: [ws({ h: 'kanal' })],
        workspacePrefs: { pinned: ['kanal'] },
        claimedRoomHs: ['kanal'],
    }), 'workspace')

    assert.deepEqual(g.pinned.map((r) => r.h), ['kanal'])
    assert.deepEqual(g.claimed, [], 'nicht in beidem — sonst stünde er zweimal in der Spalte')
    assert.equal(g.total, 1)
})

test('Die Repo-Bindung schlägt die Sektion — sie ist die genauere Aussage', () => {
    const sections: WorkspaceSections = {
        sections: [{ id: 's1', name: 'Projekte' }],
        assignments: { kanal: 's1', general: 's1' },
    }
    const g = group(buildGroups([], {
        workspaceRooms: [ws({ h: 'kanal' }), ws({ h: 'general' })],
        workspacePrefs: { sections },
        claimedRoomHs: ['kanal'],
    }), 'workspace')

    assert.deepEqual(g.claimed.map((r) => r.h), ['kanal'])
    assert.deepEqual(g.sections.map((s) => s.rooms.map((r) => r.h)), [['general']])
    assert.equal(g.total, 2)
})

test('claimedRoomHs greift NUR auf den Workspace — der zooid-Arm bleibt unberührt', () => {
    const g = group(buildGroups([room({ h: 'kanal', joined: true })], { claimedRoomHs: ['kanal'] }), 'rooms')

    assert.deepEqual(g.claimed, [])
    assert.deepEqual(g.joined.map((r) => r.h), ['kanal'])
})

test('ohne claimedRoomHs ist das Ergebnis bitgleich zu vorher', () => {
    const rooms = [ws({ h: 'a' }), ws({ h: 'b', joined: false })]

    assert.deepEqual(
        group(buildGroups([], { workspaceRooms: rooms }), 'workspace'),
        group(buildGroups([], { workspaceRooms: rooms, claimedRoomHs: [] }), 'workspace'),
    )
})
