/**
 * Pure-Tests für die Kanal-Präferenzen aus Buzz Desktop (NIP-78 / kind 30078).
 * Ohne Netz, ohne Krypto, ohne Stores:
 *   node --experimental-strip-types --test packages/einundzwanzig-group/js/channelPrefsData.test.ts
 *
 * Die Nutzlasten in `realistisch*` sind KEINE erfundenen Beispiele: sie haben
 * exakt die Form, die Buzz Desktop publiziert (Fundstellen im Kopf von
 * `channelPrefsData.ts`), inklusive des `t`-Tag-Zwillings und der UUID-Kanal-Ids,
 * wie sie am Ziel-Relay auftreten (`08f1a277-…`, Messung P1).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
    CHANNEL_PREFS_D,
    D_CHANNEL_MUTES,
    D_CHANNEL_SECTIONS,
    D_CHANNEL_SORT,
    D_CHANNEL_STARS,
    EMPTY_FLAGS,
    MAX_FLAG_ENTRIES,
    MAX_PREFS_FUTURE_SKEW_SEC,
    MAX_SECTIONS,
    MAX_SORT_GROUPS,
    WRITABLE_CHANNEL_PREFS_D,
    applyBlob,
    boundFlags,
    flagFieldFor,
    flagPayloadJson,
    flaggedIds,
    mergeFlags,
    nextPrefsCreatedAt,
    orderedSections,
    parseChannelPrefsContent,
    parseMutesPayload,
    parseSectionsPayload,
    parseSortPayload,
    parseStarsPayload,
    planChannelPrefsPublish,
    sectionSortGroupKey,
    setFlag,
    sortModeForGroup,
    toWorkspaceSections,
    type FlagStore,
    type SectionsStore,
    type SortStore,
} from './channelPrefsData.ts'
import { buildGroups, buildWorkspaceList, type RailRoom } from './railGroups.ts'

// Kanal-Ids in der Form, in der sie am Ziel-Relay stehen (kind 39000 `d`).
const CH_NEWS = '08f1a277-3f0e-4a2f-9a5c-6b8a32936154'
const CH_FORGE = '576d38b2-1f44-4c6b-9d0e-2a7c5f1b3e90'
const CH_STILL = 'c1d2e3f4-5a6b-4c7d-8e9f-0a1b2c3d4e5f'

// ── channel-sections ────────────────────────────────────────────────────────

test('channel-sections: reale Nutzlast wird vollständig gelesen', () => {
    const store = parseSectionsPayload({
        version: 1,
        sections: [
            { id: 'sec-team', name: 'Team', icon: 'users', order: 0 },
            { id: 'sec-bau', name: 'Baustellen', order: 1 },
        ],
        assignments: { [CH_NEWS]: 'sec-team', [CH_FORGE]: 'sec-bau' },
    })

    assert.ok(store)
    assert.deepEqual(store.sections.map((s) => s.id), ['sec-team', 'sec-bau'])
    assert.equal(store.sections[0].icon, 'users')
    assert.equal(store.sections[1].icon, undefined, 'fehlendes icon bleibt weg statt leer')
    assert.deepEqual(store.assignments, { [CH_NEWS]: 'sec-team', [CH_FORGE]: 'sec-bau' })
})

test('channel-sections: verwaiste Zuordnung fällt weg, gültige bleiben', () => {
    const store = parseSectionsPayload({
        version: 1,
        sections: [{ id: 'sec-team', name: 'Team', order: 0 }],
        assignments: { [CH_NEWS]: 'sec-team', [CH_FORGE]: 'sec-geloescht' },
    })

    assert.deepEqual(store?.assignments, { [CH_NEWS]: 'sec-team' })
})

test('channel-sections: eine kaputte Sektion reißt die anderen nicht mit', () => {
    const store = parseSectionsPayload({
        version: 1,
        sections: [
            { id: 'sec-ok', name: 'Ok', order: 0 },
            { id: 'sec-kaputt', name: 'Ohne Order' },
            { name: 'Ohne Id', order: 2 },
            'gar kein Objekt',
            { id: 'sec-nan', name: 'NaN-Order', order: Number.NaN },
        ],
        assignments: {},
    })

    assert.deepEqual(store?.sections.map((s) => s.id), ['sec-ok'])
})

test('channel-sections: Buzz prüft hier KEIN version-Feld — wir auch nicht', () => {
    // Nachgeprüft an `channelSectionsStorage.ts:78-119`: anders als bei sort/stars/
    // mutes gibt es dort keinen version-Riegel. Wären wir strenger, verlöre unsere
    // Sidebar Sektionen, die Buzz weiter zeigt.
    const store = parseSectionsPayload({
        version: 2,
        sections: [{ id: 'sec-neu', name: 'Neu', order: 0 }],
        assignments: {},
    })

    assert.equal(store?.sections.length, 1)
})

test('channel-sections: der Parser sortiert NICHT — Buzz tut es erst zur Anzeige', () => {
    // Aufgedeckt durch die Differenzprobe gegen Buzz' eigenen Parser (2026-08-17):
    // `boundChannelSectionsStore` gibt den Store UNVERÄNDERT zurück, solange nichts
    // über dem Deckel liegt (`channelSectionsStorage.ts:55-61`). Sortiert wird im
    // Anzeige-Hook (`useChannelSections.ts:166`). Ein Parser, der immer sortiert,
    // lieferte hier eine andere Liste als Buzz.
    const payload = {
        version: 1,
        sections: [
            { id: 'spaet', name: 'Spät', order: 9 },
            { id: 'frueh', name: 'Früh', order: 1 },
        ],
        assignments: {},
    }
    const store = parseSectionsPayload(payload) as SectionsStore

    assert.deepEqual(store.sections.map((s) => s.id), ['spaet', 'frueh'], 'Reihenfolge der Nutzlast bleibt')
    assert.deepEqual(orderedSections(store).map((s) => s.id), ['frueh', 'spaet'], 'die Anzeige sortiert nach order')
})

test('channel-sections: Deckel bei 100 Sektionen, nach order das Ende behalten', () => {
    const sections = Array.from({ length: MAX_SECTIONS + 5 }, (_, i) => ({
        id: `sec${i}`,
        name: `S${i}`,
        order: i,
    }))
    const store = parseSectionsPayload({ version: 1, sections, assignments: {} })

    assert.equal(store?.sections.length, MAX_SECTIONS)
    assert.equal(store?.sections[0].id, 'sec5', 'die höchsten order-Werte überleben — wie in Buzz')
})

// ── channel-sort ────────────────────────────────────────────────────────────

test('channel-sort: reale Nutzlast, unbekannte Modi fallen weg', () => {
    const store = parseSortPayload({
        version: 1,
        groups: { starred: 'recent', channels: 'alpha', forums: 'quatsch', 'section:sec-team': 'recent' },
    })

    assert.ok(store)
    assert.equal(sortModeForGroup(store, 'starred'), 'recent')
    assert.equal(sortModeForGroup(store, 'channels'), 'alpha')
    assert.equal(sortModeForGroup(store, sectionSortGroupKey('sec-team')), 'recent')
    assert.equal(sortModeForGroup(store, 'forums'), 'alpha', 'ungültiger Modus → Default, nicht "quatsch"')
    assert.equal(sortModeForGroup(store, 'dms'), 'alpha', 'nicht gesetzte Gruppe → Default')
})

test('channel-sort: falsche version verwirft — Buzz prüft hier (anders als bei sections)', () => {
    assert.equal(parseSortPayload({ version: 2, groups: { channels: 'recent' } }), null)
    assert.equal(parseSortPayload({ groups: { channels: 'recent' } }), null)
})

test('channel-sort: Deckel behält die festen Gruppen, kappt nur section:*', () => {
    const groups: Record<string, string> = { starred: 'recent', channels: 'recent', forums: 'recent', dms: 'recent' }
    for (let i = 0; i < MAX_SORT_GROUPS + 10; i++) {
        groups[`section:s${i}`] = 'recent'
    }
    const store = parseSortPayload({ version: 1, groups })

    assert.equal(Object.keys(store?.groups ?? {}).length, MAX_SORT_GROUPS)
    assert.equal(sortModeForGroup(store as SortStore, 'starred'), 'recent', 'feste Gruppe überlebt den Deckel')
})

// ── channel-stars / channel-mutes ───────────────────────────────────────────

test('channel-stars: Feldname ist `starred`, channel-mutes: `muted`', () => {
    const stars = parseStarsPayload({
        version: 1,
        channels: { [CH_NEWS]: { starred: true, updatedAt: 1_755_300_000 } },
    })
    const mutes = parseMutesPayload({
        version: 1,
        channels: { [CH_STILL]: { muted: true, updatedAt: 1_755_300_000 } },
    })

    assert.deepEqual(flaggedIds(stars as FlagStore), [CH_NEWS])
    assert.deepEqual(flaggedIds(mutes as FlagStore), [CH_STILL])
    // Kreuzprobe: die Nutzlast des einen darf im anderen Parser NICHTS ergeben.
    assert.deepEqual(parseMutesPayload({ version: 1, channels: { [CH_NEWS]: { starred: true, updatedAt: 1 } } })?.channels, {})
})

test('channel-mutes: false ist eine Aussage — der Eintrag bleibt, die Id nicht', () => {
    const store = parseMutesPayload({
        version: 1,
        channels: {
            [CH_STILL]: { muted: true, updatedAt: 10 },
            [CH_NEWS]: { muted: false, updatedAt: 20 },
        },
    })

    assert.equal(Object.keys(store?.channels ?? {}).length, 2, 'ein aufgehobenes Stumm ist Information')
    assert.deepEqual(flaggedIds(store as FlagStore), [CH_STILL])
})

test('Einträge mit kaputtem updatedAt fallen weg, die gesunden bleiben', () => {
    const store = parseMutesPayload({
        version: 1,
        channels: {
            [CH_STILL]: { muted: true, updatedAt: 10 },
            a: { muted: true, updatedAt: Number.NaN },
            b: { muted: true, updatedAt: -1 },
            c: { muted: true, updatedAt: '10' },
            d: { muted: 'ja', updatedAt: 10 },
            e: null,
        },
    })

    assert.deepEqual(Object.keys(store?.channels ?? {}), [CH_STILL])
})

test('Per-Key-Merge über updatedAt: jüngerer Eintrag gewinnt, fremde Kanäle überleben', () => {
    const bestand = parseMutesPayload({
        version: 1,
        channels: {
            [CH_STILL]: { muted: true, updatedAt: 100 },
            [CH_NEWS]: { muted: true, updatedAt: 500 },
        },
    }) as FlagStore
    // Zweites Event: hebt CH_STILL auf (jünger) und will CH_NEWS entstummen (ÄLTER).
    const neu = parseMutesPayload({
        version: 1,
        channels: {
            [CH_STILL]: { muted: false, updatedAt: 200 },
            [CH_NEWS]: { muted: false, updatedAt: 400 },
            [CH_FORGE]: { muted: true, updatedAt: 50 },
        },
    })

    const merged = mergeFlags(bestand, neu)

    assert.equal(merged.channels[CH_STILL].on, false, 'updatedAt 200 > 100 — das jüngere Verdikt gilt')
    assert.equal(merged.channels[CH_NEWS].on, true, 'updatedAt 400 < 500 — das ältere Verdikt verliert')
    assert.equal(merged.channels[CH_FORGE].on, true, 'nur eine Seite kennt ihn — er überlebt')
})

test('Per-Key-Merge bei Gleichstand: der Bestand behält recht (kein Flattern)', () => {
    const a = { version: 1, channels: { [CH_NEWS]: { on: true, updatedAt: 100 } } } as FlagStore
    const b = { version: 1, channels: { [CH_NEWS]: { on: false, updatedAt: 100 } } } as FlagStore

    assert.equal(mergeFlags(a, b).channels[CH_NEWS].on, true)
})

test('Deckel der Flag-Karte: die 500 jüngsten überleben, deterministisch', () => {
    const channels: Record<string, { muted: boolean; updatedAt: number }> = {}
    for (let i = 0; i < MAX_FLAG_ENTRIES + 3; i++) {
        channels[`ch${String(i).padStart(4, '0')}`] = { muted: true, updatedAt: i }
    }
    const store = boundFlags(parseMutesPayload({ version: 1, channels }) as FlagStore)

    assert.equal(Object.keys(store.channels).length, MAX_FLAG_ENTRIES)
    assert.equal(store.channels['ch0000'], undefined, 'ältester Eintrag fällt raus')
    assert.ok(store.channels[`ch${String(MAX_FLAG_ENTRIES + 2).padStart(4, '0')}`], 'jüngster bleibt')
})

// ── Whole-Blob-LWW ──────────────────────────────────────────────────────────

test('Whole-Blob-LWW: der jüngere Blob gewinnt GANZ, nicht feldweise', () => {
    const alt = { store: parseSortPayload({ version: 1, groups: { channels: 'recent', dms: 'recent' } }) as SortStore, createdAt: 100 }
    const neu = { store: parseSortPayload({ version: 1, groups: { channels: 'alpha' } }) as SortStore, createdAt: 200 }

    const winner = applyBlob(alt, neu)

    assert.equal(sortModeForGroup(winner!.store, 'channels'), 'alpha')
    assert.equal(
        sortModeForGroup(winner!.store, 'dms'),
        'alpha',
        'der alte dms-Eintrag wird NICHT gerettet — genau das heißt Whole-Blob',
    )
})

test('Whole-Blob-LWW: ein älteres Event (Reconnect-Replay) kippt den Stand nicht', () => {
    const neu = { store: EMPTY_SORT_WITH('alpha'), createdAt: 200 }
    const alt = { store: EMPTY_SORT_WITH('recent'), createdAt: 100 }

    assert.equal(applyBlob(neu, alt), neu, 'Ankunftsreihenfolge entscheidet nicht, created_at entscheidet')
    assert.equal(applyBlob(neu, { ...alt, createdAt: 200 }), neu, 'Gleichstand: Bestand behält')
})

function EMPTY_SORT_WITH(mode: 'alpha' | 'recent'): SortStore {
    return parseSortPayload({ version: 1, groups: { channels: mode } }) as SortStore
}

// ── Fail-soft: kaputte Nutzlast leert die Sidebar NIE ────────────────────────

test('Kaputte Nutzlast fällt auf den BESTAND zurück, nicht auf leer', () => {
    const bestand = parseMutesPayload({
        version: 1,
        channels: { [CH_STILL]: { muted: true, updatedAt: 100 } },
    }) as FlagStore

    // Vier Sorten Unlesbares, wie sie real vorkommen: fehlgeschlagene
    // Entschlüsselung (Zeichensalat), fremdes JSON-Format, leerer Klartext,
    // undefined (kein Signer).
    for (const kaputt of ['nicht mal JSON {{{', '{"version":9,"channels":{}}', '', undefined]) {
        const parsed = parseChannelPrefsContent(D_CHANNEL_MUTES, kaputt) as FlagStore | null
        assert.equal(parsed, null, `unlesbar ergibt null: ${String(kaputt)}`)
        assert.deepEqual(
            flaggedIds(mergeFlags(bestand, parsed)),
            [CH_STILL],
            'die Stummschaltung überlebt eine kaputte Nutzlast',
        )
    }

    // Und derselbe Fall für die Blob-Seite.
    const blob = { store: parseSortPayload({ version: 1, groups: { channels: 'recent' } }) as SortStore, createdAt: 100 }
    assert.equal(applyBlob(blob, null), blob, 'unlesbarer Blob → Bestand bleibt stehen')
    assert.equal(applyBlob(null, null), null)
})

test('Ein leerer, aber GÜLTIGER Blob leert dagegen sehr wohl — das ist eine Aussage', () => {
    const bestand = { store: parseSortPayload({ version: 1, groups: { channels: 'recent' } }) as SortStore, createdAt: 100 }
    const geleert = { store: parseSortPayload({ version: 1, groups: {} }) as SortStore, createdAt: 200 }

    assert.equal(sortModeForGroup(applyBlob(bestand, geleert)!.store, 'channels'), 'alpha')
})

// ── Einstieg über das d-Tag ─────────────────────────────────────────────────

test('parseChannelPrefsContent verzweigt über das d-Tag und wirft nie', () => {
    assert.equal(CHANNEL_PREFS_D.length, 4)
    assert.deepEqual([...CHANNEL_PREFS_D], [D_CHANNEL_SECTIONS, D_CHANNEL_SORT, D_CHANNEL_STARS, D_CHANNEL_MUTES])

    const sections = parseChannelPrefsContent(
        D_CHANNEL_SECTIONS,
        JSON.stringify({ version: 1, sections: [{ id: 's', name: 'S', order: 0 }], assignments: {} }),
    ) as SectionsStore
    assert.equal(sections.sections.length, 1)

    const sort = parseChannelPrefsContent(D_CHANNEL_SORT, JSON.stringify({ version: 1, groups: { channels: 'recent' } })) as SortStore
    assert.equal(sortModeForGroup(sort, 'channels'), 'recent')

    const stars = parseChannelPrefsContent(
        D_CHANNEL_STARS,
        JSON.stringify({ version: 1, channels: { [CH_NEWS]: { starred: true, updatedAt: 7 } } }),
    ) as FlagStore
    assert.deepEqual(flaggedIds(stars), [CH_NEWS])

    // Ein fremdes `d`-Tag am selben kind 30078 (etwa Buzz' `read-state:<slot>` oder
    // unser `einundzwanzig/read-state/v1`) darf hier NICHTS ergeben.
    assert.equal(parseChannelPrefsContent('read-state:42', JSON.stringify({ version: 1, channels: {} })), null)
    assert.equal(parseChannelPrefsContent('einundzwanzig/read-state/v1', '{"raum":123}'), null)
})

// ── Wirksamkeit: die ganze Kette von der Nutzlast bis in die Sidebar ────────
//
// Das ist der Nachweis aus der DoD („eine in Buzz Desktop gesetzte Stummschaltung
// wirkt in unserer Sidebar, eine dort gesetzte Sortierung wird angewandt"), so weit
// er OHNE Relay und Browser führbar ist: `channelPrefs.ts` kann hier nicht laufen
// (es zieht `@welshman/net`), aber alles NACH der Entschlüsselung schon — und genau
// dort sitzt die Logik. Was diese Kette nicht abdeckt, steht im Bericht.
//
// Der Klartext ist exakt der, den Buzz Desktop verschlüsselt
// (`channelMutesSync.ts:165-168`, `channelSortSync.ts:178-181`); das Parsen wurde
// zusätzlich in einer Differenzprobe direkt gegen Buzz' eigene Parser gefahren.

test('Kette: eine in Buzz gesetzte Stummschaltung wirkt in der Sidebar', () => {
    const klartext = JSON.stringify({
        version: 1,
        channels: {
            [CH_STILL]: { muted: true, updatedAt: 1_786_700_000 },
            [CH_NEWS]: { muted: false, updatedAt: 1_786_700_100 },
        },
    })

    const mutes = mergeFlags(EMPTY_FLAGS, parseChannelPrefsContent(D_CHANNEL_MUTES, klartext) as FlagStore)
    const workspaceRooms: RailRoom[] = [
        { h: CH_NEWS, name: 'news', joined: true },
        { h: CH_STILL, name: 'still', joined: true },
        { h: CH_FORGE, name: 'forge', joined: true },
    ]
    const gruppe = buildGroups([], {
        workspaceRooms,
        workspacePrefs: { muted: flaggedIds(mutes) },
    }).find((g) => g.key === 'workspace')!

    assert.deepEqual(gruppe.muted, [CH_STILL], 'genau der in Buzz stummgeschaltete Raum')
    assert.deepEqual(
        gruppe.joined.map((r) => r.name),
        ['forge', 'news', 'still'],
        'stumm heißt leise, nicht weg — die Zeile bleibt in der Liste',
    )
    // Der zweite Kanal steht mit `muted:false` in derselben Nutzlast: eine
    // AUFGEHOBENE Stummschaltung darf nicht als Stummschaltung ankommen.
    assert.ok(!gruppe.muted.includes(CH_NEWS))
})

test('Kette: eine in Buzz gesetzte Sortierung wird angewandt', () => {
    const klartext = JSON.stringify({ version: 1, groups: { channels: 'recent', starred: 'alpha' } })
    const sort = parseChannelPrefsContent(D_CHANNEL_SORT, klartext) as SortStore

    const workspaceRooms: RailRoom[] = [
        { h: CH_NEWS, name: 'news', joined: true, lastMessageAt: 1_786_000_000 },
        { h: CH_STILL, name: 'still', joined: true, lastMessageAt: 1_786_900_000 },
        { h: CH_FORGE, name: 'forge', joined: true, lastMessageAt: null },
    ]
    const bauen = (prefs: Parameters<typeof buildGroups>[1]) =>
        buildGroups([], { workspaceRooms, ...prefs }).find((g) => g.key === 'workspace')!

    // Ohne Präferenz: alphabetisch (Buzz' Default und unser bisheriges Verhalten).
    assert.deepEqual(bauen({}).joined.map((r) => r.name), ['forge', 'news', 'still'])

    // Mit der Präferenz aus dem Event: jüngste Aktivität zuerst.
    const angewandt = bauen({
        workspacePrefs: {
            sort: sortModeForGroup(sort, 'channels'),
            pinnedSort: sortModeForGroup(sort, 'starred'),
        },
    })
    assert.deepEqual(angewandt.joined.map((r) => r.name), ['still', 'news', 'forge'])
})

test('Kette: Anheftung hebt den Raum nach oben, ohne ihn zu verdoppeln', () => {
    const klartext = JSON.stringify({
        version: 1,
        channels: { [CH_FORGE]: { starred: true, updatedAt: 1_786_700_000 } },
    })
    const stars = mergeFlags(EMPTY_FLAGS, parseChannelPrefsContent(D_CHANNEL_STARS, klartext) as FlagStore)
    const gruppe = buildGroups([], {
        workspaceRooms: [
            { h: CH_NEWS, name: 'news', joined: true },
            { h: CH_FORGE, name: 'forge', joined: true },
        ],
        workspacePrefs: { pinned: flaggedIds(stars) },
    }).find((g) => g.key === 'workspace')!

    assert.deepEqual(gruppe.pinned.map((r) => r.name), ['forge'])
    assert.deepEqual(gruppe.joined.map((r) => r.name), ['news'])
    assert.equal(gruppe.total, 2, 'kein Raum zählt doppelt')
})

test('Leere Startwerte sind eingefroren — niemand mutiert den Default', () => {
    assert.throws(() => {
        ;(EMPTY_FLAGS.channels as Record<string, unknown>).x = 1
    }, 'EMPTY_FLAGS ist frozen')
})

// ── Kette: Sektionen von der Nutzlast bis in die Rail (P7) ─────────────────
//
// Dieselbe Bauart wie die drei Ketten darüber: die Nutzlast hat exakt die Form,
// die Buzz Desktop verschlüsselt (`channelSectionsSync.ts:190-194`), und geprüft
// wird alles NACH der Entschlüsselung — Parsen, Anzeige-Reihenfolge, Zuordnung,
// Sortiermodus je Sektion, bis in die fertige Gruppe.

test('Kette: in Buzz angelegte Sektionen gliedern die Rail — in `order`-Reihenfolge', () => {
    const klartext = JSON.stringify({
        version: 1,
        // Absichtlich NICHT in `order`-Reihenfolge notiert: der Parser sortiert
        // nicht um, `toWorkspaceSections` tut es. Stünde die Sortierung im Parser,
        // zeigten Buzz und wir verschiedene Listen (Differenzprobe 2026-08-17).
        sections: [
            { id: 'sec-b', name: 'Später', order: 2 },
            { id: 'sec-a', name: 'Zuerst', icon: '🚀', order: 1 },
        ],
        assignments: { [CH_NEWS]: 'sec-a', [CH_FORGE]: 'sec-b' },
    })
    const sections = parseChannelPrefsContent(D_CHANNEL_SECTIONS, klartext) as SectionsStore
    const sort = parseChannelPrefsContent(
        D_CHANNEL_SORT,
        JSON.stringify({ version: 1, groups: { [sectionSortGroupKey('sec-a')]: 'recent' } }),
    ) as SortStore

    const gruppe = buildGroups([], {
        workspaceRooms: [
            { h: CH_NEWS, name: 'news', joined: true },
            { h: CH_FORGE, name: 'forge', joined: true },
            { h: CH_STILL, name: 'still', joined: true },
        ],
        workspacePrefs: { sections: toWorkspaceSections(sections, sort) },
    }).find((g) => g.key === 'workspace')!

    assert.deepEqual(gruppe.sections.map((s) => s.name), ['Zuerst', 'Später'], '`order` bestimmt die Reihenfolge')
    assert.equal(gruppe.sections[0].icon, '🚀')
    assert.deepEqual(gruppe.sections[0].rooms.map((r) => r.name), ['news'])
    assert.deepEqual(gruppe.sections[1].rooms.map((r) => r.name), ['forge'])
    // Der dritte Kanal steht in KEINER Sektion — und bleibt trotzdem sichtbar.
    assert.deepEqual(gruppe.joined.map((r) => r.name), ['still'])
    assert.equal(gruppe.total, 3, 'jeder Raum genau einmal')
})

test('Kette: der Sortiermodus einer Sektion kommt aus `channel-sort`', () => {
    const sections = parseChannelPrefsContent(
        D_CHANNEL_SECTIONS,
        JSON.stringify({
            version: 1,
            sections: [{ id: 'sec-a', name: 'A', order: 1 }],
            assignments: { [CH_NEWS]: 'sec-a', [CH_FORGE]: 'sec-a' },
        }),
    ) as SectionsStore

    // `news` ist AKTIVER, steht alphabetisch aber HINTER `forge` — nur so
    // unterscheiden sich die beiden Modi überhaupt.
    const bauen = (sort: SortStore) =>
        buildGroups([], {
            workspaceRooms: [
                { h: CH_NEWS, name: 'news', joined: true, lastMessageAt: 1_786_900_000 },
                { h: CH_FORGE, name: 'forge', joined: true, lastMessageAt: 1_786_000_000 },
            ],
            workspacePrefs: { sections: toWorkspaceSections(sections, sort) },
        }).find((g) => g.key === 'workspace')!.sections[0].rooms.map((r) => r.name)

    const leer = parseChannelPrefsContent(D_CHANNEL_SORT, JSON.stringify({ version: 1, groups: {} })) as SortStore
    assert.deepEqual(bauen(leer), ['forge', 'news'], 'ohne Angabe Buzz-Default `alpha`')

    const recent = parseChannelPrefsContent(
        D_CHANNEL_SORT,
        JSON.stringify({ version: 1, groups: { 'section:sec-a': 'recent' } }),
    ) as SortStore
    assert.deepEqual(bauen(recent), ['news', 'forge'], 'jüngste Aktivität zuerst')

    // Gegenprobe: der Modus der Gruppe `channels` darf NICHT auf die Sektion
    // durchschlagen — Buzz führt beide Schlüssel getrennt.
    const nurChannels = parseChannelPrefsContent(
        D_CHANNEL_SORT,
        JSON.stringify({ version: 1, groups: { channels: 'recent' } }),
    ) as SortStore
    assert.deepEqual(bauen(nurChannels), ['forge', 'news'], 'die Sektion bleibt bei ihrem eigenen Default')
})

test('toWorkspaceSections reicht verwaiste Zuordnungen nicht durch', () => {
    // `stripOrphanedAssignments` hat sie schon im Parser entfernt; hier ist der
    // Nachweis, dass die Umformung nichts wieder hereinholt.
    const sections = parseChannelPrefsContent(
        D_CHANNEL_SECTIONS,
        JSON.stringify({
            version: 1,
            sections: [{ id: 'sec-a', name: 'A', order: 1 }],
            assignments: { [CH_NEWS]: 'sec-a', [CH_FORGE]: 'geloescht' },
        }),
    ) as SectionsStore
    const form = toWorkspaceSections(sections, { version: 1, groups: {} })

    assert.deepEqual(Object.keys(form.assignments), [CH_NEWS])
    assert.deepEqual(form.sortById, { 'sec-a': 'alpha' })
})

// ── Kette: dieselben Präferenzen auf der BÜHNE (P7, ohne xl-Breakpoint) ─────

test('Kette: Stummschaltung und Sortierung wirken auch in der mobilen Raumliste', () => {
    const mutes = mergeFlags(EMPTY_FLAGS, parseChannelPrefsContent(
        D_CHANNEL_MUTES,
        JSON.stringify({ version: 1, channels: { [CH_STILL]: { muted: true, updatedAt: 1_786_700_000 } } }),
    ) as FlagStore)
    const sort = parseChannelPrefsContent(
        D_CHANNEL_SORT,
        JSON.stringify({ version: 1, groups: { channels: 'recent' } }),
    ) as SortStore

    const liste = buildWorkspaceList<RailRoom>([
        { h: CH_NEWS, name: 'news', joined: true, lastMessageAt: 1_786_000_000 },
        { h: CH_STILL, name: 'still', joined: true, lastMessageAt: 1_786_900_000 },
        { h: CH_FORGE, name: 'forge', joined: false, lastMessageAt: 1_786_500_000 },
    ], {
        muted: flaggedIds(mutes),
        sort: sortModeForGroup(sort, 'channels'),
        pinnedSort: sortModeForGroup(sort, 'starred'),
    })

    assert.deepEqual(
        liste.rooms.map((r) => r.name),
        ['still', 'news', 'forge'],
        'jüngste zuerst INNERHALB der Mitgliedschaft — der entdeckbare Raum bleibt hinten',
    )
    assert.deepEqual(liste.muted, [CH_STILL], 'die Zeile bleibt stehen und wird als stumm gemeldet')
})

test('Kette: eine in Buzz angeheftete Zeile steht auch auf der Bühne oben', () => {
    const stars = mergeFlags(EMPTY_FLAGS, parseChannelPrefsContent(
        D_CHANNEL_STARS,
        JSON.stringify({ version: 1, channels: { [CH_FORGE]: { starred: true, updatedAt: 1_786_700_000 } } }),
    ) as FlagStore)

    const liste = buildWorkspaceList<RailRoom>([
        { h: CH_NEWS, name: 'news', joined: true },
        { h: CH_FORGE, name: 'forge', joined: true },
    ], { pinned: flaggedIds(stars) })

    assert.deepEqual(liste.rooms.map((r) => r.name), ['forge', 'news'])
    assert.deepEqual(liste.pinned, [CH_FORGE])
})

// ── Write half (P4) ─────────────────────────────────────────────────────────

const flags = (channels: Record<string, { on: boolean; updatedAt: number }>): FlagStore =>
    ({ version: 1, channels })

/**
 * THE guard of this phase. `channel-sections` and `channel-sort` are whole-blob LWW —
 * writing one replaces the section layout and the channel sorting the user set in Buzz
 * Desktop, and this client has no surface to set either. The plan is the only way to
 * build an event in `channelPrefs.ts`, so a `null` here means the write cannot happen.
 */
test('WRITE GUARD: sections and sort get no publish plan — only stars and mutes do', () => {
    assert.deepEqual(
        [...WRITABLE_CHANNEL_PREFS_D],
        [D_CHANNEL_STARS, D_CHANNEL_MUTES],
        'the writable set must stay exactly these two — adding a blob tag here is silent data loss in Buzz Desktop',
    )
    for (const dTag of [D_CHANNEL_SECTIONS, D_CHANNEL_SORT, 'einundzwanzig/read-state/v1', '']) {
        assert.equal(flagFieldFor(dTag), null, `${dTag} must have no payload field`)
        assert.equal(
            planChannelPrefsPublish(dTag, EMPTY_FLAGS, 1_000, 0),
            null,
            `planChannelPrefsPublish must refuse ${dTag} — writing it overwrites the user's Buzz Desktop layout wholesale`,
        )
    }
    // Positive control: without it a plan function that returned `null` for everything
    // would pass the four lines above.
    assert.equal(flagFieldFor(D_CHANNEL_STARS), 'starred')
    assert.equal(flagFieldFor(D_CHANNEL_MUTES), 'muted')
    assert.ok(planChannelPrefsPublish(D_CHANNEL_MUTES, EMPTY_FLAGS, 1_000, 0))
})

test('WRITE GUARD: the published payload carries channels only — no sections, no sort keys', () => {
    const plan = planChannelPrefsPublish(D_CHANNEL_MUTES, flags({ a: { on: true, updatedAt: 5 } }), 1_000, 0)
    assert.ok(plan)
    const payload = JSON.parse(plan.json) as Record<string, unknown>
    assert.deepEqual(Object.keys(payload).sort(), ['channels', 'version'])
    for (const forbidden of ['sections', 'assignments', 'groups', 'sort']) {
        assert.equal(forbidden in payload, false, `${forbidden} must never travel in a flag payload`)
    }
    assert.deepEqual(plan.tags, [['d', D_CHANNEL_MUTES], ['t', D_CHANNEL_MUTES]])
})

test('the payload has Buzz’ exact shape: `muted`/`starred` plus `updatedAt`, ids sorted', () => {
    const store = flags({ b: { on: false, updatedAt: 7 }, a: { on: true, updatedAt: 5 } })
    assert.equal(
        flagPayloadJson(store, 'muted'),
        '{"version":1,"channels":{"a":{"muted":true,"updatedAt":5},"b":{"muted":false,"updatedAt":7}}}',
    )
    assert.equal(
        flagPayloadJson(store, 'starred'),
        '{"version":1,"channels":{"a":{"starred":true,"updatedAt":5},"b":{"starred":false,"updatedAt":7}}}',
    )
    // Sorted, so that "have I published this already?" does not hang on insertion order.
    assert.equal(flagPayloadJson(flags({ a: { on: true, updatedAt: 5 }, b: { on: false, updatedAt: 7 } }), 'muted'),
        flagPayloadJson(store, 'muted'))
})

test('round trip: what we write is what our own parser reads back', () => {
    const store = flags({ 'a956ca5e-f2f7-5bed-bfe9-3313a8ee8718': { on: true, updatedAt: 1_755_000_000 } })
    const back = parseChannelPrefsContent(D_CHANNEL_MUTES, flagPayloadJson(store, 'muted'))
    assert.deepEqual(back, store)
    assert.deepEqual(parseChannelPrefsContent(D_CHANNEL_STARS, flagPayloadJson(store, 'starred')), store)
})

test('setFlag writes unconditionally — two toggles in the same second do not cancel out', () => {
    const muted = setFlag(EMPTY_FLAGS, 'a', true, 100)
    assert.deepEqual(muted.channels.a, { on: true, updatedAt: 100 })
    // Through `mergeFlags` this would be a no-op (it needs a strictly newer updatedAt),
    // and the user would watch the switch flip back.
    const unmuted = setFlag(muted, 'a', false, 100)
    assert.equal(unmuted.channels.a.on, false)
    assert.equal(mergeFlags(muted, flags({ a: { on: false, updatedAt: 100 } })).channels.a.on, true)
})

test('setFlag keeps the other channels and stays under the cap', () => {
    const many: Record<string, { on: boolean; updatedAt: number }> = {}
    for (let i = 0; i < MAX_FLAG_ENTRIES; i++) {
        many[`c${String(i).padStart(4, '0')}`] = { on: true, updatedAt: 1_000 + i }
    }
    const grown = setFlag(flags(many), 'fresh', true, 9_999)
    assert.equal(Object.keys(grown.channels).length, MAX_FLAG_ENTRIES)
    assert.equal(grown.channels.fresh.on, true, 'the entry just set must survive the cap')
    assert.equal('c0000' in grown.channels, false, 'the oldest updatedAt is the one that goes')
})

/**
 * DoD 3 of this phase, at the data layer: device A muted room 1, device B muted room 2.
 * B fetches A's blob before publishing (`mergeOwnBlobBeforePublish`), so what B writes
 * has to carry both. Kind 30078 is addressable — a relay does not union, it replaces.
 */
test('two devices, two different channels: the published payload carries both', () => {
    const deviceA = setFlag(EMPTY_FLAGS, 'room-1', true, 1_000)
    const deviceB = setFlag(EMPTY_FLAGS, 'room-2', true, 1_010)

    const merged = mergeFlags(deviceB, deviceA)
    const plan = planChannelPrefsPublish(D_CHANNEL_MUTES, merged, 2_000, 1_500)
    assert.ok(plan)
    const payload = JSON.parse(plan.json) as { channels: Record<string, { muted: boolean }> }
    assert.deepEqual(Object.keys(payload.channels).sort(), ['room-1', 'room-2'])
    assert.equal(payload.channels['room-1'].muted, true)
    assert.equal(payload.channels['room-2'].muted, true)

    // And the other direction, because the merge must not depend on who published last.
    const other = planChannelPrefsPublish(D_CHANNEL_MUTES, mergeFlags(deviceA, deviceB), 2_000, 1_500)
    assert.ok(other)
    assert.equal(other.json, plan.json)
})

test('an unmute of one device does not resurrect through the other device’ older entry', () => {
    const muted = setFlag(EMPTY_FLAGS, 'room-1', true, 1_000)
    const unmuted = setFlag(muted, 'room-1', false, 1_100)
    const payload = JSON.parse(flagPayloadJson(mergeFlags(unmuted, muted), 'muted')) as {
        channels: Record<string, { muted: boolean }>
    }
    assert.equal(payload.channels['room-1'].muted, false, 'the newer updatedAt wins, and `false` is a statement')
})

test('created_at is bumped past the relay head — a second toggle in the same second is not swallowed', () => {
    // Equal created_at means the relay keeps the OLDER event (NIP-01 tie break); the
    // user would see the switch flip and lose it on reload.
    assert.equal(nextPrefsCreatedAt(1_000, 1_000), 1_001)
    assert.equal(nextPrefsCreatedAt(1_000, 1_004), 1_005)
    // Nothing to beat: plain now.
    assert.equal(nextPrefsCreatedAt(1_000, 0), 1_000)
    assert.equal(nextPrefsCreatedAt(1_000, 999), 1_000)
    // A foreign device with a broken clock must not push us past Buzz' ±900 s window
    // (`ingest.rs:2005-2012`) — every write would be REJECTED instead of not replacing.
    assert.equal(nextPrefsCreatedAt(1_000, 99_999), 1_000 + MAX_PREFS_FUTURE_SKEW_SEC)
    assert.ok(MAX_PREFS_FUTURE_SKEW_SEC < 900, 'the cap has to stay inside Buzz’ drift window')
})

test('the plan carries the bumped created_at, not a bare now', () => {
    const plan = planChannelPrefsPublish(D_CHANNEL_STARS, EMPTY_FLAGS, 1_000, 1_000)
    assert.ok(plan)
    assert.equal(plan.createdAt, 1_001)
    assert.equal(plan.field, 'starred')
    assert.equal(plan.dTag, D_CHANNEL_STARS)
})
