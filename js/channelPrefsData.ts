/**
 * Kanal-Präferenzen aus Buzz Desktop (NIP-78, kind 30078) — **reine Hälfte**:
 * parsen, deckeln, mergen. Kein Netz, keine Krypto, keine Stores; damit läuft
 * `channelPrefsData.test.ts` unter `node --test`. Die unreine Hälfte (Filter,
 * `ensurePlaintext`, Stores) liegt in `channelPrefs.ts`.
 *
 * ── Warum das Format nicht unseres ist ──
 *
 * Diese vier Blobs schreibt **Buzz Desktop**, wir lesen sie nur. Jede Abweichung
 * beim Parsen ist deshalb kein Geschmack, sondern ein Fehler: dann sieht unsere
 * Sidebar etwas anderes als die, in der der Nutzer die Präferenz gesetzt hat.
 * Die Formen sind an Buzz' Quelle verifiziert (Stand 2026-08-16, Repo `buzz`,
 * `desktop/src/features/sidebar/lib/`):
 *
 * | `d`-Tag            | Nutzlast                                                   | Fundstelle                        |
 * |--------------------|------------------------------------------------------------|-----------------------------------|
 * | `channel-sections` | `{version:1, sections:[{id,name,icon?,order}], assignments:{ch→sec}}` | `channelSectionsSync.ts:190-194` |
 * | `channel-sort`     | `{version:1, groups:{gruppe→'alpha'\|'recent'}}`             | `channelSortSync.ts:178-181`      |
 * | `channel-stars`    | `{version:1, channels:{ch→{starred:bool, updatedAt:number}}}`| `channelStarsSync.ts:165-168`     |
 * | `channel-mutes`    | `{version:1, channels:{ch→{muted:bool, updatedAt:number}}}`  | `channelMutesSync.ts:165-168`     |
 *
 * Alle vier tragen `[["d",<tag>],["t",<tag>]]` als Tags und einen
 * nip44-an-sich-selbst verschlüsselten `content`; der Kanal-Schlüssel ist die
 * Kanal-UUID, bei uns `RailRoom.h` (NIP-29 `h`, identisch mit dem `d` des 39000).
 *
 * ── Zwei Merge-Regeln, nicht eine ──
 *
 * `sections` und `sort` sind **Whole-Blob-LWW** über `created_at` des Events
 * (Buzz: `channelSectionsSync.ts:143`, `channelSortSync.ts:145` — „take whichever
 * is newer"). `stars` und `mutes` mergen **pro Kanal** über `updatedAt` des
 * Eintrags (`channelStarsStorage.ts:111-130`, `channelMutesStorage.ts:111-130`);
 * ein Kanal, den nur eine Seite kennt, überlebt dabei immer.
 *
 * ── Eine kaputte Nutzlast leert die Sidebar NIE ──
 *
 * Jeder Parser gibt bei Unlesbarem `null` zurück und die `apply*`-Funktionen
 * geben dann den **bisherigen** Stand unverändert weiter — dieselbe Fail-Soft-Regel
 * wie `readState.ts sanitizeReadState`: was nicht der Form entspricht, fällt weg,
 * nicht der Bestand. Der Unterschied zu `?? DEFAULT_STORE` (so macht es Buzz beim
 * localStorage-Lesen) ist Absicht: wir haben keinen lokalen Zweitstand, ein
 * Rückfall auf leer wäre bei uns sichtbarer Datenverlust in der Anzeige.
 */

// ── `d`-Tags ────────────────────────────────────────────────────────────────

export const D_CHANNEL_SECTIONS = 'channel-sections'
export const D_CHANNEL_SORT = 'channel-sort'
export const D_CHANNEL_STARS = 'channel-stars'
export const D_CHANNEL_MUTES = 'channel-mutes'

/** Die vier `d`-Tags in EINEM Filter — Reihenfolge ist die des Plans, nicht Zufall. */
export const CHANNEL_PREFS_D: readonly string[] = [
    D_CHANNEL_SECTIONS,
    D_CHANNEL_SORT,
    D_CHANNEL_STARS,
    D_CHANNEL_MUTES,
]

// ── Grenzen (1:1 aus Buzz, damit dieselbe Nutzlast dieselbe Sicht ergibt) ────

/** `channelSectionsStorage.ts:4` */
export const MAX_SECTIONS = 100
/** `channelSectionsStorage.ts:5` */
export const MAX_SECTION_ASSIGNMENTS = 1_000
/** `channelSortPreference.ts:5` — 4 feste Gruppen + 100 Sektionen. */
export const MAX_SORT_GROUPS = 104
/** `channelStarsStorage.ts:2` / `channelMutesStorage.ts:2` */
export const MAX_FLAG_ENTRIES = 500

// ── Typen ───────────────────────────────────────────────────────────────────

export type ChannelSection = {
    id: string
    name: string
    icon?: string
    order: number
}

export type SectionsStore = {
    version: 1
    sections: ChannelSection[]
    /** Kanal-`h` → Sektions-`id`. */
    assignments: Record<string, string>
}

export type SortMode = 'alpha' | 'recent'

/** Feste Gruppen plus `section:<id>` — `channelSortPreference.ts:13-18`. */
export type SortGroupKey = 'starred' | 'channels' | 'forums' | 'dms' | `section:${string}`

export type SortStore = {
    version: 1
    groups: Record<string, SortMode>
}

/**
 * Ein Stern-/Stumm-Eintrag. `updatedAt` sind **Sekunden** (`Math.floor(Date.now()/1000)`,
 * `useChannelStars.ts:164` / `useChannelMutes.ts:164`) — dieselbe Einheit wie
 * `created_at`, aber unabhängig davon: der Vergleich läuft ausschließlich zwischen
 * zwei `updatedAt`. Wir rechnen die Zahl nie um; verglichen wird nur.
 */
export type FlagEntry = {
    on: boolean
    updatedAt: number
}

export type FlagStore = {
    version: 1
    channels: Record<string, FlagEntry>
}

/** Buzz' Default-Sortierung, `channelSortPreference.ts:25`. */
export const DEFAULT_SORT_MODE: SortMode = 'alpha'

/**
 * Die leeren Startwerte. **Auch die inneren Container sind eingefroren** —
 * `Object.freeze` ist flach, und Buzz' `DEFAULT_STORE` (`channelStarsStorage.ts:14`)
 * friert nur die Hülle ein: ein `DEFAULT_STORE.channels[x] = …` irgendwo im
 * Aufrufer vergiftete dort den Default für den Rest der Sitzung. Hier nicht.
 */
export const EMPTY_SECTIONS: SectionsStore = Object.freeze({
    version: 1,
    sections: Object.freeze([] as ChannelSection[]),
    assignments: Object.freeze({} as Record<string, string>),
}) as SectionsStore

export const EMPTY_SORT: SortStore = Object.freeze({
    version: 1,
    groups: Object.freeze({} as Record<string, SortMode>),
}) as SortStore

export const EMPTY_FLAGS: FlagStore = Object.freeze({
    version: 1,
    channels: Object.freeze({} as Record<string, FlagEntry>),
}) as FlagStore

// ── Deckel ──────────────────────────────────────────────────────────────────

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * Sektionen auf {@link MAX_SECTIONS} und Zuordnungen auf
 * {@link MAX_SECTION_ASSIGNMENTS} deckeln.
 *
 * **Die `order`-Sortierung greift NUR, wenn wirklich gekappt wird** — und das ist
 * kein Schönheitsfehler, sondern Buzz' Verhalten, an dessen Code nachgemessen
 * (`channelSectionsStorage.ts:55-61`: liegt nichts über dem Deckel, gibt die
 * Funktion `store` **unverändert** zurück, also in der Reihenfolge der Nutzlast).
 * Sortiert wird bei Buzz erst zur Anzeige (`useChannelSections.ts:166`) — dafür
 * gibt es hier {@link orderedSections}.
 *
 * Ein früherer Entwurf hat hier IMMER nach `order` sortiert. Die Differenzprobe
 * gegen Buzz' eigenen Parser (2026-08-17) hat das aufgedeckt: bei einer Nutzlast,
 * deren Reihenfolge nicht der `order` entspricht, hätten die beiden Clients
 * verschiedene Sektionslisten geliefert.
 *
 * Beim Kappen behält `slice(-MAX)` das ENDE, also die höchsten `order`-Werte.
 * Ebenfalls Buzz (`:45-48`) und bewusst nachgebaut: bei einer Übermenge müssen
 * beide Clients dieselben 100 zeigen.
 */
export const boundSections = (store: SectionsStore): SectionsStore => {
    const sections = store.sections
        .slice()
        .sort((left, right) => left.order - right.order)
        .slice(-MAX_SECTIONS)
    const sectionIds = new Set(sections.map((section) => section.id))
    const assignments = Object.fromEntries(
        Object.entries(store.assignments)
            .filter(([, sectionId]) => sectionIds.has(sectionId))
            .slice(-MAX_SECTION_ASSIGNMENTS),
    )
    if (
        sections.length === store.sections.length
        && Object.keys(assignments).length === Object.keys(store.assignments).length
    ) {
        return store
    }

    return { version: 1, sections, assignments }
}

/**
 * Zuordnungen auf gelöschte Sektionen wegwerfen, dann deckeln — die Reihenfolge
 * ist Buzz' (`channelSectionsStorage.ts:64-76`). Erst strippen, dann deckeln:
 * andernfalls belegte eine verwaiste Zuordnung einen der 1 000 Plätze.
 */
export const stripOrphanedAssignments = (store: SectionsStore): SectionsStore => {
    const sectionIds = new Set(store.sections.map((section) => section.id))
    const cleaned = Object.fromEntries(
        Object.entries(store.assignments).filter(([, sectionId]) => sectionIds.has(sectionId)),
    )
    const stripped = Object.keys(cleaned).length === Object.keys(store.assignments).length
        ? store
        : { ...store, assignments: cleaned }

    return boundSections(stripped)
}

/**
 * Sektionen in ANZEIGE-Reihenfolge (`order` aufsteigend). Getrennt vom Parsen,
 * weil Buzz genau hier trennt (`useChannelSections.ts:166`) — und weil eine
 * Sortierung im Parser eine Aussage über die Nutzlast wäre, die sie nicht macht.
 */
export const orderedSections = (store: SectionsStore): ChannelSection[] =>
    store.sections.slice().sort((left, right) => left.order - right.order)

/**
 * Sortier-Gruppen deckeln. Feste Gruppen (`starred`/`channels`/`forums`/`dms`)
 * überleben immer, gekappt werden nur die `section:<id>`-Einträge
 * (`channelSortPreference.ts:70-85`).
 */
export const boundSort = (store: SortStore): SortStore => {
    const entries = Object.entries(store.groups)
    if (entries.length <= MAX_SORT_GROUPS) {
        return store
    }
    const isFixed = (key: string): boolean =>
        key === 'starred' || key === 'channels' || key === 'forums' || key === 'dms'
    const fixed = entries.filter(([key]) => isFixed(key))
    const custom = entries.filter(([key]) => !isFixed(key)).slice(-(MAX_SORT_GROUPS - fixed.length))

    return { version: 1, groups: Object.fromEntries([...fixed, ...custom]) }
}

/**
 * Stern-/Stumm-Karte auf {@link MAX_FLAG_ENTRIES} deckeln: die **jüngsten**
 * `updatedAt` überleben, bei Gleichstand entscheidet die Kanal-Id
 * (`channelStarsStorage.ts:79-86`). Deterministisch, damit zwei Geräte mit
 * derselben Nutzlast dieselben 500 behalten.
 */
export const boundFlags = (store: FlagStore): FlagStore => {
    const entries = Object.entries(store.channels)
    if (entries.length <= MAX_FLAG_ENTRIES) {
        return store
    }
    entries.sort(([leftId, left], [rightId, right]) =>
        left.updatedAt !== right.updatedAt
            ? left.updatedAt - right.updatedAt
            : leftId < rightId ? -1 : leftId > rightId ? 1 : 0,
    )

    return { version: 1, channels: Object.fromEntries(entries.slice(-MAX_FLAG_ENTRIES)) }
}

// ── Parser ──────────────────────────────────────────────────────────────────

/**
 * `channel-sections` parsen. Einzelne kaputte Sektionen fallen heraus, der Rest
 * bleibt (`flatMap`-Muster aus `channelSectionsStorage.ts:84-107`).
 *
 * **Kein `version`-Riegel — und das ist eine Beobachtung, keine Nachlässigkeit.**
 * Buzz prüft `version === 1` bei `sort`, `stars` und `mutes`, bei `sections`
 * NICHT (`channelSectionsStorage.ts:78-119` gegen `channelSortPreference.ts:92`).
 * Ein 30078 mit `version: 2` liefert dort also weiter Sektionen. Wir spiegeln das
 * bewusst: würden wir hier strenger sein, verlöre unsere Sidebar Sektionen, die
 * Buzz noch zeigt — und der Zweck des Features ist, dieselbe Sidebar zu sehen.
 */
export const parseSectionsPayload = (json: unknown): SectionsStore | null => {
    if (!isPlainObject(json)) {
        return null
    }
    const sections: ChannelSection[] = Array.isArray(json.sections)
        ? json.sections.flatMap((entry: unknown): ChannelSection[] => {
            if (!isPlainObject(entry)) {
                return []
            }
            if (
                typeof entry.id !== 'string'
                || typeof entry.name !== 'string'
                || typeof entry.order !== 'number'
                || !Number.isFinite(entry.order)
            ) {
                return []
            }
            const icon = typeof entry.icon === 'string' && entry.icon.trim() !== '' ? entry.icon.trim() : undefined

            return [{ id: entry.id, name: entry.name, ...(icon ? { icon } : {}), order: entry.order }]
        })
        : []
    const assignments: Record<string, string> = isPlainObject(json.assignments)
        ? Object.fromEntries(
            Object.entries(json.assignments).filter(
                (entry): entry is [string, string] => typeof entry[1] === 'string',
            ),
        )
        : {}

    return stripOrphanedAssignments({ version: 1, sections, assignments })
}

/** `channel-sort` parsen. Unbekannte Modi fallen still weg, `version !== 1` verwirft. */
export const parseSortPayload = (json: unknown): SortStore | null => {
    if (!isPlainObject(json) || json.version !== 1) {
        return null
    }
    const groups: Record<string, SortMode> = isPlainObject(json.groups)
        ? Object.fromEntries(
            Object.entries(json.groups).filter(
                (entry): entry is [string, SortMode] => entry[1] === 'alpha' || entry[1] === 'recent',
            ),
        )
        : {}

    return boundSort({ version: 1, groups })
}

/**
 * `channel-stars` / `channel-mutes` parsen — dieselbe Form, nur ein anderer
 * Feldname (`starred` bzw. `muted`). Intern heißt das Feld {@link FlagEntry.on},
 * damit Sortier- und Merge-Logik einmal existiert statt zweimal.
 *
 * Ein Eintrag überlebt nur mit booleschem Flag UND endlichem, nicht-negativem
 * `updatedAt` — ein `NaN` vergiftete sonst jeden späteren Vergleich
 * (`channelStarsStorage.ts:33-45`).
 */
export const parseFlagPayload = (json: unknown, field: 'starred' | 'muted'): FlagStore | null => {
    if (!isPlainObject(json) || json.version !== 1) {
        return null
    }
    const channels: Record<string, FlagEntry> = isPlainObject(json.channels)
        ? Object.fromEntries(
            Object.entries(json.channels).flatMap(([id, value]): [string, FlagEntry][] => {
                if (!isPlainObject(value)) {
                    return []
                }
                const on = value[field]
                const updatedAt = value.updatedAt
                if (typeof on !== 'boolean') {
                    return []
                }
                if (typeof updatedAt !== 'number' || !Number.isFinite(updatedAt) || updatedAt < 0) {
                    return []
                }

                return [[id, { on, updatedAt }]]
            }),
        )
        : {}

    return boundFlags({ version: 1, channels })
}

export const parseStarsPayload = (json: unknown): FlagStore | null => parseFlagPayload(json, 'starred')

export const parseMutesPayload = (json: unknown): FlagStore | null => parseFlagPayload(json, 'muted')

/**
 * Entschlüsselter Klartext → Store, anhand des `d`-Tags. **Wirft nie.** Alles,
 * was kein JSON ist, ein fremdes Format hat oder zu einem unbekannten `d`-Tag
 * gehört, ergibt `null` — der Aufrufer behält dann seinen Stand.
 */
export const parseChannelPrefsContent = (
    dTag: string,
    plaintext: string | undefined,
): SectionsStore | SortStore | FlagStore | null => {
    if (!plaintext) {
        return null
    }
    let json: unknown
    try {
        json = JSON.parse(plaintext)
    } catch {
        return null
    }
    switch (dTag) {
        case D_CHANNEL_SECTIONS:
            return parseSectionsPayload(json)
        case D_CHANNEL_SORT:
            return parseSortPayload(json)
        case D_CHANNEL_STARS:
            return parseStarsPayload(json)
        case D_CHANNEL_MUTES:
            return parseMutesPayload(json)
        default:
            return null
    }
}

// ── Merge ───────────────────────────────────────────────────────────────────

/** Ein Stand mit seiner Herkunftszeit — `createdAt` ist `event.created_at` (Sekunden). */
export type Dated<T> = { store: T; createdAt: number }

/**
 * Whole-Blob-LWW für `sections` und `sort`: der jüngere Blob gewinnt **ganz**,
 * es wird nichts feldweise vereinigt (Buzz: `channelSectionsSync.ts:142-146`).
 *
 * Bei Gleichstand behält der bisherige Stand — zwei Relays mit demselben
 * `created_at` dürfen die Anzeige nicht bei jedem Event umschalten.
 */
export const applyBlob = <T>(current: Dated<T> | null, incoming: Dated<T> | null): Dated<T> | null => {
    if (!incoming) {
        return current // unlesbar → Bestand behalten, NIE leeren
    }
    if (!current) {
        return incoming
    }

    return incoming.createdAt > current.createdAt ? incoming : current
}

/**
 * Per-Key-Merge für `stars` und `mutes`: je Kanal gewinnt der jüngere
 * `updatedAt`; bei Gleichstand der bisherige Eintrag (`>=`, wie Buzz
 * `channelStarsStorage.ts:124`). Ein Kanal, den nur eine Seite kennt, überlebt.
 *
 * **`created_at` des Events spielt hier keine Rolle** — genau das ist der
 * Unterschied zum Blob: zwei Geräte, die je einen anderen Kanal stumm geschaltet
 * haben, verlieren so keine der beiden Angaben, egal welches Event zuletzt kam.
 */
export const mergeFlags = (current: FlagStore, incoming: FlagStore | null): FlagStore => {
    if (!incoming) {
        return current
    }
    const channels: Record<string, FlagEntry> = { ...current.channels }
    for (const [id, entry] of Object.entries(incoming.channels)) {
        const existing = channels[id]
        if (!existing || entry.updatedAt > existing.updatedAt) {
            channels[id] = entry
        }
    }

    return boundFlags({ version: 1, channels })
}

// ── Anwenden ────────────────────────────────────────────────────────────────

/** Die Kanäle mit gesetztem Flag (`starred`/`muted` = true). */
export const flaggedIds = (store: FlagStore): string[] =>
    Object.entries(store.channels)
        .filter(([, entry]) => entry.on)
        .map(([id]) => id)

/** Sortiermodus einer Gruppe, mit Buzz' Default `alpha` (`channelSortPreference.ts:136-141`). */
export const sortModeForGroup = (store: SortStore, group: SortGroupKey): SortMode =>
    store.groups[group] ?? DEFAULT_SORT_MODE

/** Der Gruppen-Schlüssel einer Sektion (`channelSortPreference.ts:32-34`). */
export const sectionSortGroupKey = (sectionId: string): SortGroupKey => `section:${sectionId}`

/**
 * `channel-sections` + `channel-sort` → die Form, die `buildGroups`
 * (`railGroups.ts`) als `WorkspacePrefs.sections` erwartet.
 *
 * **Hier — und nur hier — wird nach `order` sortiert.** Das Parsen macht über die
 * Anzeige-Reihenfolge bewusst keine Aussage (siehe {@link boundSections}); Buzz
 * trennt an genau derselben Stelle (`useChannelSections.ts:166`).
 *
 * **Der Sortiermodus je Sektion wird VORAB aufgelöst** statt als Rückruf
 * durchgereicht: `railGroups.ts` bleibt so eine reine Datenumformung, und der
 * Schlüssel ist genau Buzz' `section:<id>`.
 *
 * Der Rückgabetyp steht hier STRUKTURELL statt als Import von `railGroups.ts`:
 * dieses Modul ist import-frei, damit es unter `node --test` direkt gegen die
 * `.ts`-Datei läuft. TypeScript prüft die Zuweisung trotzdem — beide Seiten
 * beschreiben dieselbe Form.
 */
export const toWorkspaceSections = (
    sections: SectionsStore,
    sort: SortStore,
): {
    sections: { id: string; name: string; icon?: string }[]
    assignments: Record<string, string>
    sortById: Record<string, SortMode>
} => {
    const ordered = orderedSections(sections)

    return {
        sections: ordered.map(({ id, name, icon }) => ({ id, name, ...(icon ? { icon } : {}) })),
        assignments: sections.assignments,
        sortById: Object.fromEntries(
            ordered.map((section) => [section.id, sortModeForGroup(sort, sectionSortGroupKey(section.id))]),
        ),
    }
}
