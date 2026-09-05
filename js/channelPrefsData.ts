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

// ── Write half (P4) ─────────────────────────────────────────────────────────

/**
 * The two `d` tags this client may WRITE — and the two that are missing are missing
 * for a data-loss reason, not for a scope reason.
 *
 * `channel-stars` and `channel-mutes` merge PER CHANNEL over `updatedAt`
 * ({@link mergeFlags}): two devices that each muted a different channel keep both
 * statements. `channel-sections` and `channel-sort` go through {@link applyBlob},
 * i.e. whole-blob LWW — writing one of them replaces the section layout and the
 * channel sorting the user set in Buzz Desktop WHOLESALE, and this client offers no
 * surface to set either. That is silent data loss in a foreign client, so the
 * prohibition lives here as code and not as a sentence in a comment.
 *
 * {@link planChannelPrefsPublish} is the only gate; it returns `null` for every `d`
 * tag outside this list.
 */
export const WRITABLE_CHANNEL_PREFS_D: readonly string[] = [D_CHANNEL_STARS, D_CHANNEL_MUTES]

/** The payload field of a writable `d` tag — `null` for everything else. */
export const flagFieldFor = (dTag: string): 'starred' | 'muted' | null => {
    if (dTag === D_CHANNEL_STARS) {
        return 'starred'
    }
    if (dTag === D_CHANNEL_MUTES) {
        return 'muted'
    }

    return null
}

/**
 * Set one channel's flag locally.
 *
 * Unconditional, unlike {@link mergeFlags}: this is the user's own action on this
 * device, not a remote statement that has to win a timestamp comparison. Routed
 * through the merge it would CANCEL ITSELF on a second toggle inside the same second
 * — `mergeFlags` overwrites only on a strictly newer `updatedAt`.
 *
 * {@link boundFlags} runs afterwards for the same reason it runs on the read side:
 * both clients have to keep the same 500 entries.
 */
export const setFlag = (store: FlagStore, h: string, on: boolean, updatedAt: number): FlagStore =>
    boundFlags({ version: 1, channels: { ...store.channels, [h]: { on, updatedAt } } })

/**
 * Store → the exact payload Buzz Desktop writes (`channelMutesSync.ts:165-168`,
 * `{version: 1, channels: merged.channels}`), channel ids in sorted order.
 *
 * Sorted because the caller compares this string against the last published one to
 * decide whether a publish would be a no-op. Without a fixed order that comparison
 * would hang on object insertion order and republish an unchanged store.
 */
export const flagPayloadJson = (store: FlagStore, field: 'starred' | 'muted'): string => {
    const channels: Record<string, Record<string, unknown>> = {}
    for (const id of Object.keys(store.channels).sort()) {
        const entry = store.channels[id]
        channels[id] = { [field]: entry.on, updatedAt: entry.updatedAt }
    }

    return JSON.stringify({ version: 1, channels })
}

/**
 * How far into the future a `created_at` may be pushed to win the addressable
 * replacement — 600 s.
 *
 * Buzz rejects EVERY event whose timestamp sits more than ±900 s from server time
 * (`buzz/crates/buzz-relay/src/handlers/ingest.rs:2005-2012` — a global check, not
 * one for gift wraps). 600 leaves room for the seconds between building the event and
 * its ingest.
 */
export const MAX_PREFS_FUTURE_SKEW_SEC = 600

/**
 * The `created_at` of the next publish: now, but at least one second past the newest
 * event we have seen at the relay.
 *
 * Without the bump a second toggle inside the same second would be dropped SILENTLY:
 * kind 30078 is addressable, and on an equal `created_at` a relay keeps the older
 * event (NIP-01 tie break). The user sees the switch flip and loses it on reload.
 * Buzz bumps for the same reason (`channelMutesSync.ts:170-173`).
 *
 * Capped, because the head carries a FOREIGN device's clock: a Buzz Desktop running
 * an hour fast would otherwise push every write past Buzz' ±900 s window, and the
 * relay would reject all of them instead of merely not replacing. The capped
 * direction is the recoverable one.
 */
export const nextPrefsCreatedAt = (nowSec: number, remoteHead: number): number =>
    Math.min(Math.max(nowSec, remoteHead + 1), nowSec + MAX_PREFS_FUTURE_SKEW_SEC)

/** Everything the impure half needs to turn a store into an event. */
export type ChannelPrefsPublishPlan = {
    dTag: string
    field: 'starred' | 'muted'
    /** The PLAINTEXT payload — encrypting it is the impure half's job. */
    json: string
    /** `[["d",tag],["t",tag]]` — exactly Buzz' tags (`channelMutesSync.ts:178-181`). */
    tags: string[][]
    createdAt: number
}

/**
 * The ONE gate between a preference store and a published event.
 *
 * Returns `null` for every `d` tag outside {@link WRITABLE_CHANNEL_PREFS_D}. A caller
 * that wants to write `channel-sections` or `channel-sort` gets nothing to publish —
 * that is the whole enforcement, and it is testable without a relay.
 */
export const planChannelPrefsPublish = (
    dTag: string,
    store: FlagStore,
    nowSec: number,
    remoteHead: number,
): ChannelPrefsPublishPlan | null => {
    const field = flagFieldFor(dTag)
    if (field === null || !WRITABLE_CHANNEL_PREFS_D.includes(dTag)) {
        return null
    }

    return {
        dTag,
        field,
        json: flagPayloadJson(store, field),
        tags: [['d', dTag], ['t', dTag]],
        createdAt: nextPrefsCreatedAt(nowSec, remoteHead),
    }
}

/**
 * Did at least ONE relay say `OK true`?
 *
 * The house rule since `profiles.ts summarizePublishResults`: one accepting relay means
 * stored. Pure and parameterised over the token, so it runs under `node --test` without
 * pulling `@welshman/net` into this module — the caller passes `PublishStatus.Success`.
 *
 * **An empty result map is `false`, not `true`.** That is the direction that matters:
 * a publish that produced no verdict at all must not be remembered as delivered, or the
 * switch is silently gone after the next reload.
 */
export const anyRelayAccepted = (
    results: Record<string, { status: string }>,
    successStatus: string,
): boolean => Object.values(results).some((result) => result.status === successStatus)

/**
 * **Does this in-flight publish still belong to the identity that started it?**
 *
 * The arm counter goes up on every arm and disarm (`channelPrefs.ts resetStores`). A
 * publish captures it before its first `await` and asks again afterwards — an identity
 * switch during the fetch or the signer round trip would otherwise encrypt the NEW user's
 * (freshly emptied) store with the NEW user's key and wipe whatever that user had.
 *
 * A one-line comparison, and it is a named function on purpose: the value of this call is
 * that it is COUNTABLE. `channelPrefsWriteGate.test.ts` requires it at the call site after
 * the encryption, because a removed guard there is invisible to every behaviour test that
 * does not switch identity mid-publish.
 */
export const publishEpochUnchanged = (captured: number, current: number): boolean =>
    captured === current

/** Why a publish is not happening — the reasons are distinguished because they differ in what the caller must do next. */
export type PublishSkipReason =
    /** Identity or workspace changed under us. Keep the pending mark; the new identity owns nothing here. */
    | 'stale'
    /** `d` tag outside {@link WRITABLE_CHANNEL_PREFS_D} — the sections/sort prohibition. */
    | 'not-writable'
    /** Byte-identical to what a relay already confirmed. Nothing to send, and nothing pending either. */
    | 'unchanged'

export type PublishDecision =
    | { go: false; reason: PublishSkipReason }
    | { go: true; plan: ChannelPrefsPublishPlan }

/**
 * **The whole decision of a publish, in one pure function** — everything between "the
 * relay's copy is merged in" and "encrypt and send".
 *
 * It exists in this shape because the three ways NOT to send are exactly the three ways
 * this feature can lose data quietly, and none of them is reachable from a browser test:
 *
 * - `stale` — an identity switch mid-publish. Reproducing it in an E2E means logging out
 *   inside a two-second window.
 * - `not-writable` — the `channel-sections` / `channel-sort` prohibition.
 * - `unchanged` — the no-op that keeps a tab switch from costing a signature.
 *
 * The impure half calls this once and then only encrypts and sends. That is the point:
 * what can be decided without a relay is decided here, where a test can ask.
 */
export const decideChannelPrefsPublish = (input: {
    dTag: string
    store: FlagStore
    nowSec: number
    remoteHead: number
    lastPublishedJson: string | undefined
    capturedEpoch: number
    currentEpoch: number
}): PublishDecision => {
    if (!publishEpochUnchanged(input.capturedEpoch, input.currentEpoch)) {
        return { go: false, reason: 'stale' }
    }
    const plan = planChannelPrefsPublish(input.dTag, input.store, input.nowSec, input.remoteHead)
    if (plan === null) {
        return { go: false, reason: 'not-writable' }
    }
    if (plan.json === input.lastPublishedJson) {
        return { go: false, reason: 'unchanged' }
    }

    return { go: true, plan }
}
