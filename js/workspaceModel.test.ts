/**
 * **P6: ein Modell, zwei Fassungen** — der Verhaltensteil.
 *
 * Ausführen (Repo-Root):
 *   node --experimental-strip-types --test packages/einundzwanzig-group/js/workspaceModel.test.ts
 *
 * Hier steht, was {@link buildWorkspaceModel} LIEFERT. Dass die beiden Inseln es
 * auch wirklich fragen, steht in `workspaceQuelleGate.test.ts` — die zweite Hälfte
 * derselben Zusage, und ohne sie wäre diese hier zahnlos (eine Funktion, die
 * niemand mehr aufruft, besteht ihre Tests weiterhin).
 *
 * **Die tragenden Fälle sind die KREUZ-Fälle**: ein Kanal, der in der einen
 * Fassung woanders steht als in der anderen, ist der Fehler, den P6 auflöst. Ein
 * Test, der nur die flache Liste oder nur den Baum prüft, sähe ihn nie.
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { buildWorkspaceModel, isChannelMuted, isChannelPinned, isWorkspaceChannel } from './workspaceModel.ts'
import type { RailRoom, WorkspacePrefs } from './railGroups.ts'
import type { ForgeNavRepo } from './railForge.ts'

const raum = (over: Partial<RailRoom> & { h: string }): RailRoom => ({
    name: over.h,
    joined: true,
    ...over,
})

const repo = (over: Partial<ForgeNavRepo> & { address: string; name: string }): ForgeNavRepo => ({
    naddr: `naddr-${over.name}`,
    channelId: '',
    issueCount: 0,
    pullRequestCount: 0,
    ...over,
})

/**
 * Der Bestand für alle Fälle unten — bewusst so geschnitten, dass er JEDE Regel
 * einmal trifft, die zwischen den zwei Fassungen liegen kann:
 *
 * - `alpha-kanal` hängt an einem Repo **und** ist beigetreten,
 * - `beta-kanal` hängt an einem Repo und ist **nicht** beigetreten,
 * - `stern` gehört zu Repo `gamma`, ist aber **angeheftet** — der Pin schlägt die
 *   Repo-Bindung, das ist der Kreuzfall schlechthin,
 * - `still` ist **stumm** (bleibt trotzdem in der Liste),
 * - `frei` gehört zu keinem Repo,
 * - `forum` ist ein Forum ohne Repo (eigene Zeilensorte im Baum).
 *
 * Vier Top-Level-Einträge — bewusst **unter** `PROJECT_FOLD_THRESHOLD` (5): die
 * Faltung ist eine eigene Regel mit eigenen Tests in `railForge.test.ts`, und in
 * einem gefalteten Baum wäre jede Aussage über `claimed` eine über die Faltung.
 */
const RAEUME: RailRoom[] = [
    raum({ h: 'alpha-kanal' }),
    raum({ h: 'beta-kanal', joined: false }),
    raum({ h: 'frei' }),
    raum({ h: 'stern' }),
    raum({ h: 'still' }),
    raum({ h: 'forum', isForum: true }),
]

const REPOS: ForgeNavRepo[] = [
    repo({ address: '30617:o:a', name: 'alpha', channelId: 'alpha-kanal', issueCount: 2 }),
    repo({ address: '30617:o:b', name: 'beta', channelId: 'beta-kanal' }),
    repo({ address: '30617:o:c', name: 'gamma', channelId: 'stern' }),
]

const PREFS: WorkspacePrefs = { pinned: ['stern'], muted: ['still'] }

const modell = (over: Partial<Parameters<typeof buildWorkspaceModel<RailRoom>>[0]> = {}) =>
    buildWorkspaceModel<RailRoom>({ rooms: RAEUME, prefs: PREFS, repos: REPOS, ...over })

describe('buildWorkspaceModel — eine Ableitung, zwei Fassungen', () => {
    test('die flache Fassung führt JEDEN Raum genau einmal — auch die, die im Baum stehen', () => {
        const model = modell()

        assert.deepEqual(
            model.channels.map((row) => row.h),
            ['stern', 'alpha-kanal', 'forum', 'frei', 'still', 'beta-kanal'],
        )
        assert.equal(model.channelCount, RAEUME.length)
        assert.equal(new Set(model.channels.map((row) => row.h)).size, RAEUME.length)
    })

    test('KREUZFALL: der Pin schlägt die Repo-Bindung — in BEIDEN Fassungen, aus EINEM Aufruf', () => {
        const model = modell()

        // Baum-Fassung: `stern` ist nicht darin, sein Repo `gamma` steht ohne Kanal da.
        assert.deepEqual(model.nav.claimed, ['alpha-kanal', 'beta-kanal', 'forum'])
        assert.equal(model.allRows.some((row) => row.room?.h === 'stern'), false)

        // Flache Fassung: `stern` steht ganz oben, angeheftet, ohne Repo-Zuordnung.
        const stern = model.channels[0]
        assert.equal(stern.h, 'stern')
        assert.equal(stern.pinned, true)
        assert.equal(stern.repoName, '')
    })

    test('KREUZFALL: die Repo-Bindung des Baums steht in der flachen Zeile als Name', () => {
        const model = modell()

        assert.deepEqual(
            model.channels.map((row) => [row.h, row.repoName]),
            [
                ['stern', ''],
                ['alpha-kanal', 'alpha'],
                ['forum', ''],
                ['frei', ''],
                ['still', ''],
                ['beta-kanal', 'beta'],
            ],
        )
    })

    test('KREUZFALL: eine geänderte Präferenz wirkt in beiden Fassungen desselben Aufrufs', () => {
        // Genau die Zusicherung, um die es P6 geht: es gibt keinen Weg, an dem die
        // eine Fassung die Präferenz sieht und die andere nicht.
        const vorher = modell()
        assert.equal(vorher.nav.claimed.includes('alpha-kanal'), true)
        assert.equal(vorher.channels[1].h, 'alpha-kanal')

        const nachher = modell({ prefs: { ...PREFS, pinned: ['stern', 'alpha-kanal'] } })
        assert.equal(nachher.nav.claimed.includes('alpha-kanal'), false)
        assert.deepEqual(nachher.channels.slice(0, 2).map((row) => row.h), ['alpha-kanal', 'stern'])
        assert.deepEqual(nachher.pinned, ['alpha-kanal', 'stern'])
    })

    test('stumm heißt leise, nicht weg — und wird in beiden Fassungen gemeldet', () => {
        const model = modell()

        const still = model.channels.find((row) => row.h === 'still')
        assert.ok(still, '`still` ist aus der Liste gefallen — Stummschaltung ist keine Löschung.')
        assert.equal(still.muted, true)
        assert.deepEqual(model.muted, ['still'])
        // Und in der anderen Fassung: `still` gehört zu keinem Repo, steht also
        // flach — aber es steht.
        assert.equal(model.channels.filter((row) => row.muted).length, 1)
    })

    test('`pinned`/`muted` melden nur, was WIRKLICH in der Liste steht', () => {
        // Ein `h` aus den Präferenzen ohne Raum ist keine Zeile. Vorher stand diese
        // Unterscheidung nur auf der mobilen Seite; die Rail las die rohen
        // Präferenzen und hätte einen Geisterkanal mitgezählt.
        const model = modell({ prefs: { pinned: ['stern', 'gibt-es-nicht'], muted: ['weg'] } })

        assert.deepEqual(model.pinned, ['stern'])
        assert.deepEqual(model.muted, [])
    })

    test('der Klappzustand faltet NUR die Baum-Fassung, nie die Kanalliste', () => {
        const offen = modell()
        assert.deepEqual(
            offen.rows.map((row) => row.id),
            ['30617:o:a', 'room:alpha-kanal', '30617:o:a#issues', '30617:o:b', 'room:beta-kanal', 'room:forum', '30617:o:c'],
        )

        const zu = modell({ open: { '30617:o:a': false } })
        assert.deepEqual(
            zu.rows.map((row) => row.id),
            ['30617:o:a', '30617:o:b', 'room:beta-kanal', 'room:forum', '30617:o:c'],
        )

        // `allRows` bleibt vollständig (das braucht `activeGroup()`), und die
        // Kanalliste sieht vom Klappzustand nichts.
        assert.equal(zu.allRows.length, offen.rows.length)
        assert.deepEqual(zu.channels.map((row) => row.h), offen.channels.map((row) => row.h))
    })

    test('bei aktiver Suche fällt der Baum — die Kanalliste bleibt VOLLSTÄNDIG', () => {
        const model = modell({ filtering: true })

        assert.deepEqual(model.nav.nodes, [])
        assert.deepEqual(model.nav.claimed, [])
        assert.deepEqual(model.rows, [])
        // Der Bestandsteil, der nicht mitfallen darf: mobil gibt es keine Suche,
        // und `claimed: []` heißt für die Rail „die Kanäle stehen flach", nicht
        // „es gibt keine".
        assert.deepEqual(
            model.channels.map((row) => row.h),
            ['stern', 'alpha-kanal', 'forum', 'frei', 'still', 'beta-kanal'],
        )
        assert.deepEqual(model.channels.map((row) => row.repoName), ['', '', '', '', '', ''])
    })

    test('ohne Repos bleibt die Kanalliste dieselbe Liste — nur ohne Bindung', () => {
        // Der Fall vor dem ersten Emit von `subscribeForgeNav`: die Fläche darf
        // nicht leer sein, während der Baum noch unterwegs ist.
        const model = modell({ repos: [] })

        assert.deepEqual(
            model.channels.map((row) => row.h),
            ['stern', 'alpha-kanal', 'forum', 'frei', 'still', 'beta-kanal'],
        )
        assert.deepEqual(model.nav.claimed, ['forum'])
    })

    test('der in Buzz gesetzte Sortiermodus erreicht die Kanalliste', () => {
        const nachAktivitaet = buildWorkspaceModel<RailRoom>({
            rooms: [
                raum({ h: 'alt', lastMessageAt: 100 }),
                raum({ h: 'neu', lastMessageAt: 900 }),
            ],
            prefs: { sort: 'recent' },
        })

        assert.deepEqual(nachAktivitaet.channels.map((row) => row.h), ['neu', 'alt'])
    })

    test('die Zeile trägt das ORIGINAL-Raumobjekt, keine Kopie', () => {
        // `room-tile` setzt bei einem Bildfehler `room.picture = ''`; an einer
        // Kopie liefe das ins Leere.
        const model = modell()
        const frei = model.channels.find((row) => row.h === 'frei')

        assert.equal(frei?.room, RAEUME[2])
    })

    test('die Zeile trägt ihr reload-festes Ziel', () => {
        const model = modell()

        assert.equal(model.channels[0].href, '/rooms/stern?space=workspace')
    })

    test('isChannelPinned/isChannelMuted: die Antwort der Rail und die Zeile sagen dasselbe', () => {
        // Nicht gegen sich selbst geprüft: links steht die Funktion, die `rail.ts`
        // je Zeile aufruft, rechts der Wert, den die mobile Zeile mitbringt — und
        // beide gegen eine AUSGESCHRIEBENE Erwartung.
        const model = modell()
        const erwartet: [string, boolean, boolean][] = [
            ['stern', true, false],
            ['alpha-kanal', false, false],
            ['forum', false, false],
            ['frei', false, false],
            ['still', false, true],
            ['beta-kanal', false, false],
        ]

        assert.deepEqual(model.channels.map((row) => [row.h, row.pinned, row.muted]), erwartet)
        assert.deepEqual(
            erwartet.map(([h]) => [h, isChannelPinned(PREFS, h), isChannelMuted(PREFS, h)]),
            erwartet,
        )
    })

    test('leerer Workspace: keine Zeile, keine Zahl, kein Wurf', () => {
        const model = buildWorkspaceModel<RailRoom>({ rooms: [] })

        assert.deepEqual(model.channels, [])
        assert.equal(model.channelCount, 0)
        assert.deepEqual(model.rows, [])
        assert.deepEqual(model.pinned, [])
    })
})

/**
 * **`isWorkspaceChannel` — the FIRST gate of the write path (P4).**
 *
 * It decides whether a row carries the preference menu at all. If it wrongly says yes,
 * the client writes the `h` of a zooid-space room into Buzz' `channel-stars` /
 * `channel-mutes` — an id no other client of that workspace can resolve, inside a blob
 * Buzz Desktop keeps maintaining.
 *
 * **Why this lives here and not in the E2E:** in the E2E fixture the home space and the
 * workspace point at the SAME relay (`support/buzz.ts useBuzz`). By construction there is
 * no room there that does not belong to the workspace — the negative direction cannot be
 * produced in the browser. As a pure function it takes ten lines.
 */
describe('isWorkspaceChannel: which row may carry a channel preference (P4)', () => {
    const workspace = {
        userRooms: [{ h: 'joined' }],
        otherRooms: [{ h: 'discoverable' }],
        dmRooms: [{ h: 'conversation' }],
    }

    test('all three pots of the workspace count — all three', () => {
        for (const h of ['joined', 'discoverable', 'conversation']) {
            assert.equal(isWorkspaceChannel(workspace, h), true, `${h} belongs to the workspace`)
        }
    })

    test('CORE: a room of the HOME space does not belong to it', () => {
        assert.equal(
            isWorkspaceChannel(workspace, 'zooid-room'),
            false,
            'a foreign room must not carry a preference menu — its `h` would end up in Buzz’ blob',
        )
        // The neighbouring edge case: an `h` that exists NOWHERE (the empty string out of a
        // half-built state) is not a workspace channel either.
        assert.equal(isWorkspaceChannel(workspace, ''), false)
    })

    test('CORE: without a loaded workspace the answer is NO, not "maybe"', () => {
        assert.equal(
            isWorkspaceChannel(null, 'joined'),
            false,
            'as long as the workspace view is not there, no row carries a menu — fail-closed',
        )
    })

    test('an empty workspace is not a free pass', () => {
        assert.equal(isWorkspaceChannel({ userRooms: [], otherRooms: [], dmRooms: [] }, 'x'), false)
    })
})
