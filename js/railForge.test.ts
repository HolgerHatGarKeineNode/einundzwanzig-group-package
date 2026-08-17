/**
 * Pure-Tests für den Forge-Baum der Workspace-Sektion (welshman-frei).
 *   node --test packages/einundzwanzig-group/js/railForge.test.ts
 *
 * Die vier Zustände A–D des abgenommenen Zielbilds stehen namentlich in den
 * Testtiteln — sie sind der Vertrag dieser Phase, nicht eine Auswahl daraus.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
    FORGE_OVERVIEW_HREF,
    PROJECT_FOLD_THRESHOLD,
    buildForgeNav,
    flattenForgeNav,
    groupTargets,
    railTargets,
    repoHref,
    type ForgeNavNode,
    type ForgeNavProject,
    type ForgeNavRepo,
} from './railForge.ts'
import type { RailGroup, RailGroupKey, RailRoom } from './railGroups.ts'

const room = (over: Partial<RailRoom> & { h: string }): RailRoom => ({
    name: over.h,
    joined: true,
    ...over,
})

const OWNER = 'a'.repeat(64)

const repo = (over: Partial<ForgeNavRepo> & { name: string }): ForgeNavRepo => ({
    address: `30617:${OWNER}:${over.name}`,
    naddr: `naddr1${over.name}`,
    channelId: '',
    issueCount: 0,
    pullRequestCount: 0,
    ...over,
})

const project = (over: Partial<ForgeNavProject> & { name: string }): ForgeNavProject => ({
    address: `30621:${OWNER}:${over.name}`,
    repoAddresses: [],
    ...over,
})

/** Die sichtbare Zeilenfolge bei „alles zu, außer dem aktiven Pfad" (Regel 4). */
const visibleRows = (nodes: ForgeNavNode[]): ForgeNavNode[] =>
    flattenForgeNav(nodes, (candidate) => candidate.onActivePath)

/** Die sichtbare Zeilenfolge bei „alles auf". */
const allRows = (nodes: ForgeNavNode[]): ForgeNavNode[] => flattenForgeNav(nodes, () => true)

const shape = (rows: ForgeNavNode[]): string[] =>
    rows.map((r) => `${'  '.repeat(r.depth)}${r.kind}${r.label ? ':' + r.label : ''}${r.count ? ' · ' + r.count : ''}`)

// ── Zustand A ───────────────────────────────────────────────────────────────

test('A: keine Repos → keine Zeile, kein Anspruch auf einen Kanal', () => {
    const nav = buildForgeNav({ repos: [], projects: [], rooms: [room({ h: 'general' })] })

    assert.deepEqual(nav.nodes, [])
    assert.deepEqual(nav.claimed, [])
    assert.equal(nav.collapsed, false)
    assert.equal(nav.total, 0)
})

test('A: ein Projekt ohne auflösbares Repo erzeugt keine leere Überschrift', () => {
    const nav = buildForgeNav({
        repos: [],
        projects: [project({ name: 'Plattform', repoAddresses: [`30617:${OWNER}:weg`] })],
        rooms: [],
    })

    assert.deepEqual(nav.nodes, [])
})

// ── Zustand B / B′ ──────────────────────────────────────────────────────────

const vereinRepo = repo({
    name: 'einundzwanzig-verein',
    channelId: '576d38b2-9372-418e-93ec-134ca508722c',
    issueCount: 3,
    pullRequestCount: 1,
})

const vereinRooms = [
    room({ h: '576d38b2-9372-418e-93ec-134ca508722c', name: '0V_einundzwanzig-verein' }),
    room({ h: 'general', name: 'general' }),
]

test('B: ein Repo, zugeklappt — genau EINE Zeile, der Kanal fällt aus der flachen Liste', () => {
    const nav = buildForgeNav({ repos: [vereinRepo], projects: [], rooms: vereinRooms })

    assert.deepEqual(shape(visibleRows(nav.nodes)), ['repo:einundzwanzig-verein'])
    assert.deepEqual(nav.claimed, ['576d38b2-9372-418e-93ec-134ca508722c'])
    assert.equal(nav.nodes[0].href, repoHref('naddr1einundzwanzig-verein'))
})

test('B′: aufgeklappt — Kanal, Issues, Pull Requests in dieser Reihenfolge', () => {
    const nav = buildForgeNav({ repos: [vereinRepo], projects: [], rooms: vereinRooms })

    assert.deepEqual(shape(allRows(nav.nodes)), [
        'repo:einundzwanzig-verein',
        '  room:0V_einundzwanzig-verein',
        '  issues · 3',
        '  pulls · 1',
    ])
})

test('B′: die Kind-Zeilen führen auf den Tab, den sie benennen', () => {
    const rows = allRows(buildForgeNav({ repos: [vereinRepo], projects: [], rooms: vereinRooms }).nodes)

    assert.equal(rows[1].href, '', 'die Kanalzeile springt über openRoom, nicht über einen href')
    assert.equal(rows[1].room?.h, '576d38b2-9372-418e-93ec-134ca508722c')
    assert.equal(rows[2].href, '/forge/naddr1einundzwanzig-verein?tab=issues')
    assert.equal(rows[3].href, '/forge/naddr1einundzwanzig-verein?tab=pulls')
})

test('B: ein Projekt mit GENAU EINEM Repo wird zu einer Zeile (Regel 2)', () => {
    const nav = buildForgeNav({
        repos: [vereinRepo],
        projects: [project({ name: 'einundzwanzig-verein', repoAddresses: [vereinRepo.address] })],
        rooms: vereinRooms,
    })

    assert.deepEqual(shape(visibleRows(nav.nodes)), ['repo:einundzwanzig-verein'])
    assert.equal(nav.nodes[0].kind, 'repo', 'keine Projektebene über einem einzigen Repo')
})

// ── Zustand C ───────────────────────────────────────────────────────────────

test('C: ein Projekt mit mehreren Repos bekommt die Zwischenebene', () => {
    const relay = repo({ name: 'relay', channelId: 'c-relay', issueCount: 12 })
    const desktop = repo({ name: 'desktop' })
    const mobile = repo({ name: 'mobile' })
    const nav = buildForgeNav({
        repos: [relay, desktop, mobile],
        projects: [project({
            name: 'Plattform',
            repoAddresses: [relay.address, desktop.address, mobile.address],
        })],
        rooms: [room({ h: 'c-relay', name: '0V_relay' })],
    })

    assert.deepEqual(shape(allRows(nav.nodes)), [
        'project:Plattform',
        '  repo:desktop',
        '  repo:mobile',
        '  repo:relay',
        '    room:0V_relay',
        '    issues · 12',
    ])
})

test('C: Repos mit und ohne Projekt stehen auf derselben Ebene, alphabetisch', () => {
    const relay = repo({ name: 'relay' })
    const desktop = repo({ name: 'desktop' })
    const solo = repo({ name: 'buch' })
    const nav = buildForgeNav({
        repos: [relay, desktop, solo],
        projects: [project({ name: 'Plattform', repoAddresses: [relay.address, desktop.address] })],
        rooms: [],
    })

    assert.deepEqual(nav.nodes.map((n) => n.label), ['buch', 'Plattform'])
    assert.equal(nav.nodes[0].depth, 0, 'Regel 7: kein Pseudo-Projekt über dem Solo-Repo')
})

// ── Zustand D ───────────────────────────────────────────────────────────────

const manyRepos = (count: number): ForgeNavRepo[] =>
    Array.from({ length: count }, (_, i) => repo({ name: `repo-${i}`, channelId: `c-${i}` }))

test('D: ab fünf Einträgen faltet die Liste — der aktive Pfad bleibt sichtbar', () => {
    const repos = manyRepos(7)
    const rooms = repos.map((r, i) => room({ h: `c-${i}`, name: `0V_repo-${i}` }))
    const nav = buildForgeNav({ repos, projects: [], rooms, activeId: repos[2].address })

    assert.equal(nav.collapsed, true)
    assert.equal(nav.total, 7)
    assert.deepEqual(shape(visibleRows(nav.nodes)), [
        'repo:repo-2',
        '  room:0V_repo-2',
        'more · 7',
    ])
    assert.equal(nav.nodes[nav.nodes.length - 1].href, FORGE_OVERVIEW_HREF)
})

test('D: der aktive Pfad wird auch über einen offenen KANAL gefunden', () => {
    const repos = manyRepos(6)
    const rooms = repos.map((r, i) => room({ h: `c-${i}`, name: `0V_repo-${i}` }))
    const nav = buildForgeNav({ repos, projects: [], rooms, activeRoomH: 'c-4' })

    assert.deepEqual(shape(visibleRows(nav.nodes)), ['repo:repo-4', '  room:0V_repo-4', 'more · 6'])
})

test('D: ohne aktives Element bleibt nur die Sammelzeile stehen', () => {
    const repos = manyRepos(PROJECT_FOLD_THRESHOLD)
    const nav = buildForgeNav({ repos, projects: [], rooms: [] })

    assert.deepEqual(shape(nav.nodes), ['more · 5'])
})

test('D: vier Einträge falten NICHT — die Schwelle ist der fünfte', () => {
    const nav = buildForgeNav({ repos: manyRepos(PROJECT_FOLD_THRESHOLD - 1), projects: [], rooms: [] })

    assert.equal(nav.collapsed, false)
    assert.equal(nav.nodes.length, 4)
})

test('D: ein weggefaltetes Repo gibt seinen Kanal an die flache Liste ZURÜCK', () => {
    const repos = manyRepos(7)
    const rooms = repos.map((r, i) => room({ h: `c-${i}`, name: `0V_repo-${i}` }))
    const nav = buildForgeNav({ repos, projects: [], rooms, activeId: repos[2].address })

    // Genau einmal sichtbar heißt genau einmal — nicht keinmal. Nur der Kanal des
    // sichtbaren Repos verschwindet aus der flachen Liste.
    assert.deepEqual(nav.claimed, ['c-2'])
})

// ── Die Zusagen der Definition of Done ──────────────────────────────────────

test('ein Kanal mit Repo-Bindung erscheint NIRGENDS doppelt — auch nicht bei zwei Anspruchstellern', () => {
    const first = repo({ name: 'alpha', address: `30617:${OWNER}:aaa`, channelId: 'shared' })
    const second = repo({ name: 'beta', address: `30617:${OWNER}:bbb`, channelId: 'shared' })
    const nav = buildForgeNav({
        repos: [second, first],
        projects: [],
        rooms: [room({ h: 'shared', name: '0V_shared' })],
    })

    const rows = allRows(nav.nodes)
    assert.deepEqual(rows.filter((r) => r.kind === 'room').map((r) => r.room?.h), ['shared'])
    assert.deepEqual(nav.claimed, ['shared'], 'genau ein Anspruch, egal in welcher Reihenfolge geladen wurde')
    // Deterministisch die kleinste Koordinate, nicht die Eingabereihenfolge.
    assert.equal(rows.find((r) => r.kind === 'room')?.depth, 1)
    assert.equal(rows[0].label, 'alpha')
    assert.deepEqual(shape(allRows(nav.nodes)), ['repo:alpha', '  room:0V_shared', 'repo:beta'])
})

test('dasselbe Repo in zwei Projekten erscheint nur einmal — sonst stünde sein Kanal doppelt', () => {
    const shared = repo({ name: 'kern', channelId: 'c-kern' })
    const other = repo({ name: 'rand' })
    const nav = buildForgeNav({
        repos: [shared, other],
        projects: [
            project({ name: 'Zwei', address: `30621:${OWNER}:zzz`, repoAddresses: [shared.address, other.address] }),
            project({ name: 'Eins', address: `30621:${OWNER}:aaa`, repoAddresses: [shared.address] }),
        ],
        rooms: [room({ h: 'c-kern', name: '0V_kern' })],
    })

    const rows = allRows(nav.nodes)
    assert.deepEqual(rows.filter((r) => r.kind === 'repo').map((r) => r.label), ['kern', 'rand'])
    assert.deepEqual(nav.claimed, ['c-kern'])
    // `aaa` < `zzz`: das Projekt „Eins" greift zuerst und behält `kern`, „Zwei"
    // bleibt mit einem Repo übrig und verschmilzt nach Regel 2 zu einer Zeile.
    assert.deepEqual(shape(rows), ['repo:kern', '  room:0V_kern', 'repo:rand'])
})

test('ein `buzz-channel` auf einen unsichtbaren Kanal erzeugt KEINE Zeile', () => {
    const nav = buildForgeNav({
        repos: [repo({ name: 'geheim', channelId: 'nicht-geladen', issueCount: 2 })],
        projects: [],
        rooms: [room({ h: 'general' })],
    })

    assert.deepEqual(shape(allRows(nav.nodes)), ['repo:geheim', '  issues · 2'])
    assert.deepEqual(nav.claimed, [], 'ein Kanal, den es nicht gibt, wird auch nicht beansprucht')
})

test('ein Kanal ohne Repo-Bindung wird nie beansprucht', () => {
    const nav = buildForgeNav({
        repos: [repo({ name: 'ohne' })],
        projects: [],
        rooms: [room({ h: 'general' }), room({ h: 'welcome' })],
    })

    assert.deepEqual(nav.claimed, [])
})

test('Zähler 0 erzeugt KEINE Zeile (Regel 5)', () => {
    const nav = buildForgeNav({
        repos: [repo({ name: 'still', issueCount: 0, pullRequestCount: 0 })],
        projects: [],
        rooms: [],
    })

    assert.deepEqual(nav.nodes[0].children, [])
    assert.deepEqual(shape(allRows(nav.nodes)), ['repo:still'])
})

test('nur PRs, keine Issues — die Null erzeugt trotzdem keine Zeile', () => {
    const nav = buildForgeNav({
        repos: [repo({ name: 'nurpr', pullRequestCount: 4 })],
        projects: [],
        rooms: [],
    })

    assert.deepEqual(shape(allRows(nav.nodes)), ['repo:nurpr', '  pulls · 4'])
})

test('Regel 4: beim ersten Laden ist alles zu — außer dem Pfad zum aktiven Element', () => {
    const withChannel = repo({ name: 'mit', channelId: 'c-1', issueCount: 1 })
    const other = repo({ name: 'ohne' })
    const rooms = [room({ h: 'c-1', name: '0V_mit' })]

    const idle = buildForgeNav({ repos: [withChannel, other], projects: [], rooms })
    assert.deepEqual(shape(visibleRows(idle.nodes)), ['repo:mit', 'repo:ohne'])

    // Aufgeklappt wird der KNOTEN, nicht die einzelne Zeile: der aktive Kanal
    // öffnet sein Repo, und damit stehen alle Kinder des Repos da.
    const open = buildForgeNav({ repos: [withChannel, other], projects: [], rooms, activeRoomH: 'c-1' })
    assert.deepEqual(shape(visibleRows(open.nodes)), ['repo:mit', '  room:0V_mit', '  issues · 1', 'repo:ohne'])
})

test('der aktive Pfad markiert auch die Projektebene darüber', () => {
    const a = repo({ name: 'a', address: `30617:${OWNER}:a`, issueCount: 5 })
    const b = repo({ name: 'b', address: `30617:${OWNER}:b` })
    const nav = buildForgeNav({
        repos: [a, b],
        projects: [project({ name: 'Plattform', repoAddresses: [a.address, b.address] })],
        rooms: [],
        activeId: `${a.address}#issues`,
    })

    assert.deepEqual(shape(visibleRows(nav.nodes)), [
        'project:Plattform',
        '  repo:a',
        '    issues · 5',
        '  repo:b',
    ])
})

test('flattenForgeNav respektiert das Prädikat je Knoten, nicht je Ebene', () => {
    const a = repo({ name: 'a', address: `30617:${OWNER}:a`, issueCount: 1 })
    const b = repo({ name: 'b', address: `30617:${OWNER}:b`, issueCount: 2 })
    const nav = buildForgeNav({ repos: [a, b], projects: [], rooms: [] })

    assert.deepEqual(shape(flattenForgeNav(nav.nodes, (n) => n.id === a.address)), [
        'repo:a',
        '  issues · 1',
        'repo:b',
    ])
})

test('Knoten-ids sind stabil und eindeutig — sie tragen Klappzustand UND Aktivmarkierung', () => {
    const a = repo({ name: 'a', address: `30617:${OWNER}:a`, channelId: 'c', issueCount: 1, pullRequestCount: 1 })
    const nav = buildForgeNav({ repos: [a], projects: [], rooms: [room({ h: 'c' })] })
    const ids = allRows(nav.nodes).map((n) => n.id)

    assert.deepEqual(ids, [`30617:${OWNER}:a`, 'room:c', `30617:${OWNER}:a#issues`, `30617:${OWNER}:a#pulls`])
    assert.equal(new Set(ids).size, ids.length)
})

test('ein Repo ohne naddr bleibt ein reiner Klappknoten statt eines toten Links', () => {
    const nav = buildForgeNav({
        repos: [repo({ name: 'kaputt', naddr: '', issueCount: 2 })],
        projects: [],
        rooms: [],
    })

    assert.equal(nav.nodes[0].href, '')
    assert.equal(nav.nodes[0].children[0].href, '')
})

// ── Die Sprungliste (Alt+↑/↓) ───────────────────────────────────────────────

/** Eine Gruppe in Vollform — die Felder, die `groupTargets` liest. */
const railGroup = (over: Partial<RailGroup> & { key: RailGroupKey }): RailGroup => ({
    pinned: [],
    sections: [],
    claimed: [],
    joined: [],
    others: [],
    hiddenCount: 0,
    total: 0,
    muted: [],
    ...over,
})

test('Alt+↑/↓ erreicht JEDE sichtbare Zeile — Repo, Kanal, Issues und Pull Requests', () => {
    const nav = buildForgeNav({ repos: [vereinRepo], projects: [], rooms: vereinRooms })
    const workspace = railGroup({ key: 'workspace', joined: [vereinRooms[1]] })
    const rows = allRows(nav.nodes)

    assert.deepEqual(railTargets([workspace], rows, () => true).map((t) => t.id), [
        `30617:${OWNER}:einundzwanzig-verein`,
        'room:576d38b2-9372-418e-93ec-134ca508722c',
        `30617:${OWNER}:einundzwanzig-verein#issues`,
        `30617:${OWNER}:einundzwanzig-verein#pulls`,
        'room:general',
    ])
})

test('die Sprungliste ist EXAKT die gerenderte Liste — zugeklappt fehlen die Kinder', () => {
    const nav = buildForgeNav({ repos: [vereinRepo], projects: [], rooms: vereinRooms })
    const workspace = railGroup({ key: 'workspace', joined: [vereinRooms[1]] })
    const rows = visibleRows(nav.nodes) // Regel 4: alles zu

    assert.deepEqual(railTargets([workspace], rows, () => true).map((t) => t.id), [
        `30617:${OWNER}:einundzwanzig-verein`,
        'room:general',
    ])
})

test('die Reihenfolge ist die des Markups: angeheftet · Baum · Sektionen · beigetreten · andere', () => {
    const pin = room({ h: 'pin' })
    const inSection = room({ h: 'sek' })
    const mine = room({ h: 'mein' })
    const other = room({ h: 'fremd', joined: false })
    const nav = buildForgeNav({ repos: [vereinRepo], projects: [], rooms: vereinRooms })
    const workspace = railGroup({
        key: 'workspace',
        pinned: [pin],
        sections: [{ id: 's', name: 'S', rooms: [inSection] }],
        claimed: [vereinRooms[0]],
        joined: [mine],
        others: [other],
    })

    assert.deepEqual(railTargets([workspace], allRows(nav.nodes), () => true).map((t) => t.id), [
        'room:pin',
        `30617:${OWNER}:einundzwanzig-verein`,
        'room:576d38b2-9372-418e-93ec-134ca508722c',
        `30617:${OWNER}:einundzwanzig-verein#issues`,
        `30617:${OWNER}:einundzwanzig-verein#pulls`,
        'room:sek',
        'room:mein',
        'room:fremd',
    ])
})

test('zugeklappte Gruppen liefern keine Zeilen — die Tastatur läuft nicht durch Unsichtbares', () => {
    const rooms = railGroup({ key: 'rooms', joined: [room({ h: 'a' })] })
    const workspace = railGroup({ key: 'workspace', joined: [room({ h: 'b' })] })
    const nav = buildForgeNav({ repos: [vereinRepo], projects: [], rooms: vereinRooms })

    assert.deepEqual(
        railTargets([rooms, workspace], allRows(nav.nodes), (key) => key === 'rooms').map((t) => t.id),
        ['room:a'],
    )
})

test('der Baum hängt an der Workspace-Gruppe und an keiner anderen', () => {
    const nav = buildForgeNav({ repos: [vereinRepo], projects: [], rooms: vereinRooms })

    assert.deepEqual(
        railTargets([railGroup({ key: 'rooms' })], allRows(nav.nodes), () => true),
        [],
    )
})

test('reine Klappknoten stehen NICHT in der Sprungliste — sonst bliebe Alt+↓ auf ihnen stehen', () => {
    const a = repo({ name: 'a', address: `30617:${OWNER}:a` })
    const b = repo({ name: 'b', address: `30617:${OWNER}:b` })
    const nav = buildForgeNav({
        repos: [a, b],
        projects: [project({ name: 'Plattform', repoAddresses: [a.address, b.address] })],
        rooms: [],
    })

    assert.deepEqual(railTargets([railGroup({ key: 'workspace' })], allRows(nav.nodes), () => true).map((t) => t.id), [
        `30617:${OWNER}:a`,
        `30617:${OWNER}:b`,
    ])
})

test('groupTargets und railTargets sehen dieselbe Menge — eine Funktion, zwei Verbrauchsstellen', () => {
    const nav = buildForgeNav({ repos: [vereinRepo], projects: [], rooms: vereinRooms })
    const workspace = railGroup({ key: 'workspace', joined: [vereinRooms[1]] })
    const rows = allRows(nav.nodes)

    assert.deepEqual(
        groupTargets(workspace, rows).map((t) => t.id),
        railTargets([workspace], rows, () => true).map((t) => t.id),
    )
})
