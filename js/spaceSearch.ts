/**
 * P5 — relay-seitige Volltextsuche über den Workspace (NIP-50), plus die
 * Aufbereitung ihrer Treffer.
 *
 * Alles hier Getroffene ist am Quellcode nachgeprüft, nicht angenommen. Die fünf
 * Eigenschaften, die diese Datei formen — jede mit ihrer Fundstelle:
 *
 * ── 1. Zwei Anfragen, je GENAU EIN Filter ───────────────────────────────────
 * Buzz weist einen REQ ab, der Such- und Nicht-Such-Filter mischt
 * (`crates/buzz-relay/src/handlers/req.rs:206-217`,
 * `"error: mixed search and non-search filters not supported"`). Der Suchzweig
 * versteht `kinds`, `authors`, `since`/`until`, `#h` und ein (gedeckeltes)
 * `limit` (`req.rs:560-605`). Profile und Nachrichten brauchen verschiedene
 * `kinds` und verschiedene Zusatzbedingungen — also zwei Filter, und weil jeder
 * REQ nur EINE Sub-ID trägt, zwei Anfragen.
 *
 * ── 2. Keine Live-Ergebnisse, per Konstruktion ──────────────────────────────
 * `req.rs:205-208`: „Search filters hit Postgres FTS and return historical hits,
 * then EOSE. They are not registered for fan-out." Ein `limit:0`-Abo liefe also
 * ins Leere. Deshalb `request(...)` mit `signal` und `autoClose`, nicht `load()`
 * und kein Abo.
 *
 * ── 3. Ganzwort statt Typeahead, ebenfalls per Konstruktion ─────────────────
 * `handle_search_req` verdrahtet `SearchMode::FullText` fest (`req.rs:627`);
 * `SearchMode::Prefix` gibt es nur für die HTTP-Bridge
 * (`crates/buzz-search/src/query.rs:60-68`), die wir nicht benutzen. „tyl"
 * findet nie „Tyler". Daraus folgt die Auslösung auf Enter statt pro Taste —
 * eine Relay-Eigenschaft, kein Umsetzungsfehler.
 *
 * ── 4. `matchFilters` verwirft gültige Treffer ──────────────────────────────
 * `requestOne` prüft JEDES eingehende Ereignis noch einmal clientseitig gegen die
 * eigenen Filter (`@welshman/net/dist/net/src/request.js:44-47`) und schiebt
 * Nichtpasser nach `onFiltered` statt nach `onEvent`. Der `search`-Zweig von
 * `matchFilter` kehrt in der ERSTEN Schleifenrunde zurück, egal wie sie ausgeht
 * (`@welshman/util/dist/util/src/Filters.js:11-20`) — nur das erste Wort
 * entscheidet, und es entscheidet per `String.includes`.
 *
 * **Korrektur an der Planvorlage, gemessen statt angenommen:** dort stand als
 * Beispiel „meetups" ↔ „meetup", also Stemming. Das passiert bei Buzz NICHT.
 * Der Index ist `to_tsvector('simple', content)` — am laufenden Testrelay
 * ausgelesen (`pg_get_expr` auf die generierte Spalte `events.search_tsv`,
 * 2026-08-17), und die Konfiguration `simple` kennt weder Stemming noch
 * Stoppwörter: `to_tsvector('simple','… meetup …') @@
 * websearch_to_tsquery('simple','meetups')` ist **false**.
 *
 * Der Riss zwischen Relay und `matchFilter` liegt woanders — bei der
 * QUERY-Sprache. `websearch_to_tsquery` versteht `or`, `matchFilter` nicht. Am
 * laufenden Relay gemessen (2026-08-17): die Suche
 * `kupferzwerg or zwergpinguin` liefert ein Ereignis mit dem Inhalt
 * „Zwergpinguin am See"; `matchFilters` derselben installierten Fassung sagt
 * dazu `false`, weil das erste Wort „kupferzwerg" nicht im Text steht. Der
 * Treffer ist echt und käme ohne die `onFiltered`-Auswertung nie an.
 *
 * Deshalb sammelt {@link runSpaceSearch} aus **beiden** Kanälen ein. Der
 * aufgelöste Promise-Wert von `request` enthält nur die `onEvent`-Hälfte
 * (`request.js:48`, `events.push(event)` steht im else-Zweig) und ist hier
 * unbrauchbar.
 *
 * Zweite Folge derselben Sache: die Relay-Treffer werden hier **nicht** noch
 * einmal durch unseren eigenen Abgleich gefiltert. Das Relay hat entschieden;
 * ein zweiter Textabgleich wäre exakt der Fehler, den Punkt 4 beschreibt, nur in
 * unserem Code — `matchesAllTerms` aus `search.ts` würde denselben Treffer
 * wegwerfen wie `matchFilter`, nur eine Ebene später. `search.ts` liefert
 * deshalb ausschließlich die HERVORHEBUNG; findet sie nichts, bleibt der Text
 * eben unmarkiert.
 *
 * ── 5. Der kind-0-Riegel bleibt stehen ──────────────────────────────────────
 * `core.ts` setzt `netContext.isEventValid` so, dass kind 0 vom Workspace-Relay
 * nirgends durchkommt. Dieser Riegel wirkt an ZWEI Stellen, und die sind
 * getrennt:
 *
 *   - der socket-weite Mitschnitt von `@welshman/app`, der ins Repository
 *     schreibt (`@welshman/app/dist/app/src/index.js:44-52`), ruft
 *     `netContext.isEventValid` DIREKT auf — er ist über Request-Optionen nicht
 *     erreichbar;
 *   - `requestOne` benutzt `options.isEventValid || netContext.isEventValid`
 *     (`request.js:15`).
 *
 * Ein Override am Request hebt den Riegel also nur für die Zustellung an DIESE
 * Insel auf; ins Repository kommt weiterhin nichts. Ohne den Override lieferte
 * die Personensuche strukturell null Treffer und sähe aus wie „nichts gefunden".
 *
 * **Abweichung vom Auftrag, bewusst:** verlangt war `isEventValid: () => true`.
 * Das schaltet zusätzlich die Signaturprüfung ab — ein Relay könnte dann ein
 * beliebiges kind 0 für einen fremden Pubkey unterschieben, und der Name stünde
 * in unserer Trefferliste. Hier steht deshalb {@link relaySearchEventValid}:
 * dieselbe Wirkung für den kind-0-Riegel, aber `verifyEvent` bleibt scharf.
 *
 * ── Ladbarkeit aus `node --test` ────────────────────────────────────────────
 * Relative Importe mit `.ts`-Endung; `@welshman/net` wird NUR lazy per `import()` im
 * Standard-Dep geholt. Der Test setzt seinen eigenen `request` ein und lädt
 * welshman-Netz nie.
 *
 * Die frühere Begründung dafür („`@welshman/app` fasst beim Modulladen `localStorage`
 * an") ist überholt: gemessen am 2026-08-22 laden `@welshman/app` und `@welshman/net`
 * unter node fehlerfrei. Der lazy Import bleibt trotzdem richtig — er hält den
 * Netz-Stack aus dem Test heraus, nicht nur aus der Ladbarkeit.
 */
import { verifyEvent, type TrustedEvent } from '@welshman/util'
import {
    SEARCH_RESULT_LIMIT,
    findMatchRanges,
    parseSearchTerms,
    snippetSegments,
    toSegments,
    type SearchSegment,
} from './search.ts'

// ── Filterbau ───────────────────────────────────────────────────────────────

/**
 * Was durchsucht wird: Chat (9), Buzz' zweite Chat-Fassung (40002) und die
 * Forum-Kinds (45001 Thema, 45003 Antwort).
 *
 * Die Forum-Kinds stehen hier, obwohl am Ziel-Relay heute kein Forum existiert
 * (P4 ist zurückgestellt) — sie kosten nichts und die FTS-Allowlist des Relays
 * ist exakt `[0,9,40002,45001,45003]`
 * (`crates/buzz-db/src/migration.rs:1966`). Ein Kind mehr im Filter wäre
 * wirkungslos, ein Kind weniger eine Lücke, sobald das erste Forum entsteht.
 */
export const SEARCH_CONTENT_KINDS: readonly number[] = [9, 40002, 45001, 45003]

/** Die Personensuche. Getrennt, weil kind 0 kein `#h` und keinen Raum kennt. */
export const SEARCH_PROFILE_KINDS: readonly number[] = [0]

/**
 * Wie viele Treffer je Anfrage. Buzz deckelt selbst auf
 * `DEFAULT_MAX_PAGE_LIMIT` (`req.rs:566-571`); 50 liegt weit darunter und ist die
 * Zahl, die eine Palette noch sinnvoll anzeigt.
 */
export const SEARCH_LIMIT = 50

/** Ein NIP-50-Filter, wie er über den Draht geht. */
export type SpaceSearchFilter = {
    kinds: number[]
    search: string
    limit: number
    '#h'?: string[]
    authors?: string[]
    since?: number
    until?: number
}

/** Die Eingrenzungen, die Buzz' Suchzweig versteht (`req.rs:560-605`). */
export type SpaceSearchQuery = {
    /** Der Suchtext. Leer/nur Leerraum = keine Suche. */
    q: string
    /** Auf einen Kanal eingrenzen (UUID des NIP-29-`h`). */
    h?: string
    authors?: string[]
    since?: number
    until?: number
}

/**
 * Die beiden Filter — Inhalt und Personen, in dieser Reihenfolge.
 *
 * **Leere Anfrage ergibt eine leere Liste**, und die ist der Grund, warum
 * {@link runSpaceSearch} dann keinen einzigen Roundtrip fährt: „nichts gesucht"
 * ist nicht „alles gefunden". Dieselbe Regel wie {@link parseSearchTerms}.
 *
 * `#h`, `authors`, `since` und `until` gelten NUR für den Inhaltsfilter. Ein
 * Profil hat kein `h` und gehört keinem Kanal — ein `#h` auf kind 0 träfe
 * garantiert nichts (`req.rs:588-600` verwirft den Filter dann sogar ganz).
 */
export const buildSearchFilters = (query: SpaceSearchQuery, limit = SEARCH_LIMIT): SpaceSearchFilter[] => {
    const search = query.q.trim()
    if (search === '') {
        return []
    }

    const content: SpaceSearchFilter = { kinds: [...SEARCH_CONTENT_KINDS], search, limit }
    if (query.h) {
        content['#h'] = [query.h]
    }
    if (query.authors && query.authors.length > 0) {
        content.authors = [...query.authors]
    }
    if (typeof query.since === 'number') {
        content.since = query.since
    }
    if (typeof query.until === 'number') {
        content.until = query.until
    }

    return [content, { kinds: [...SEARCH_PROFILE_KINDS], search, limit }]
}

// ── Netz ────────────────────────────────────────────────────────────────────

/** Der Ausschnitt von welshmans `RequestOptions`, den diese Datei benutzt. */
export type SpaceSearchRequestOptions = {
    relays: string[]
    filters: SpaceSearchFilter[]
    signal?: AbortSignal
    autoClose?: boolean
    isEventValid?: (event: TrustedEvent, url: string) => boolean
    onEvent?: (event: TrustedEvent, url: string) => void
    onFiltered?: (event: TrustedEvent, url: string) => void
    onClosed?: (reason: string, url: string) => void
    onEose?: (url: string) => void
}

export type SpaceSearchRequest = (options: SpaceSearchRequestOptions) => Promise<unknown>

export type SpaceSearchDeps = {
    request: SpaceSearchRequest
}

/**
 * Der kind-0-Riegel aus `core.ts`, aufgehoben — aber NUR er.
 *
 * Siehe Punkt 5 im Dateikopf: `requestOne` ersetzt mit dieser Funktion den
 * gesamten `netContext.isEventValid`, also auch die Signaturprüfung. Die bleibt
 * hier deshalb ausdrücklich stehen. Der Riegel selbst wird nicht ausgehebelt,
 * sondern umgangen: der Weg ins Repository läuft über einen anderen Aufruf
 * derselben Funktion, den diese Option nicht erreicht.
 */
export const relaySearchEventValid = (event: TrustedEvent): boolean => verifyEvent(event)

const defaultDeps: SpaceSearchDeps = {
    // **Der App-gebundene `request`, nicht der freistehende aus `@welshman/net`.**
    // Seit 0.9.5 braucht der einen `context` mit `pool` und `repository`; ohne ihn wirft
    // er `Unable to connect to relays without context.pool`, sobald eine echte
    // Relay-URL im Spiel ist. `context` ist dort optional typisiert — der Typecheck
    // hätte das nie gemeldet, und die Suche wäre stumm gescheitert.
    //
    // Der Import bleibt dynamisch: er hält den Netz-Pfad aus den reinen Tests dieses
    // Moduls heraus, die ihren eigenen `request` einsetzen (siehe Dateikopf).
    request: async (options) => {
        const netz = await import('./welshmanNet.ts')

        return netz.request(options as never)
    },
}

/** Das Ergebnis einer Relay-Suche, roh — Aufbereitung siehe unten. */
export type SpaceSearchOutcome = {
    /** Wurde überhaupt gefragt? `false` bei leerer Eingabe. */
    ran: boolean
    /**
     * Haben BEIDE Anfragen ein EOSE gesehen?
     *
     * Das ist das tragfähige Erreichbarkeitssignal: `request` wirft nicht, wenn
     * der Relay schweigt oder ablehnt — es löst nach seinem Zeitfenster leer auf.
     * Ohne diese Zahl hieße „keine Treffer" auch dann „gibt es nicht", wenn nie
     * jemand geantwortet hat.
     */
    complete: boolean
    /** Grund einer Relay-Ablehnung (`CLOSED`), sonst `null`. */
    rejected: string | null
    /** Treffer der Inhaltssuche, neueste zuerst, dedupliziert. */
    messages: TrustedEvent[]
    /** Treffer der Personensuche, neueste zuerst, ein Ereignis je Pubkey. */
    profiles: TrustedEvent[]
}

const EMPTY_OUTCOME: SpaceSearchOutcome = {
    ran: false,
    complete: false,
    rejected: null,
    messages: [],
    profiles: [],
}

const byCreatedAtDesc = (a: TrustedEvent, b: TrustedEvent): number =>
    b.created_at - a.created_at || a.id.localeCompare(b.id)

/** Neueste kind-0 je Pubkey — ältere Fassungen desselben Profils fliegen raus. */
const newestPerPubkey = (events: TrustedEvent[]): TrustedEvent[] => {
    const byPubkey = new Map<string, TrustedEvent>()
    for (const event of events) {
        const known = byPubkey.get(event.pubkey)
        if (!known || known.created_at < event.created_at) {
            byPubkey.set(event.pubkey, event)
        }
    }

    return [...byPubkey.values()].sort(byCreatedAtDesc)
}

/**
 * Eine Runde Relay-Suche: zwei Anfragen, je ein Filter, Treffer aus `onEvent`
 * UND `onFiltered`.
 *
 * Die beiden Anfragen laufen parallel und teilen sich das Abbruchsignal. Ein
 * `CLOSED` einer der beiden wird gemeldet statt verschluckt — `load()` reicht
 * `onClosed` gar nicht erst durch, dort verschwände eine Ablehnung still und der
 * Aufrufer liefe in den Timeout.
 */
export const runSpaceSearch = async (
    relayUrl: string,
    query: SpaceSearchQuery,
    signal?: AbortSignal,
    deps: SpaceSearchDeps = defaultDeps,
    limit = SEARCH_LIMIT,
): Promise<SpaceSearchOutcome> => {
    const filters = buildSearchFilters(query, limit)
    if (filters.length === 0) {
        return { ...EMPTY_OUTCOME }
    }

    const [contentFilter, profileFilter] = filters
    const collected = new Map<string, TrustedEvent>()
    let rejected: string | null = null
    let eoseCount = 0

    /** Ein Filter, eine Anfrage — `requestOne` sendet ein REQ je Filter. */
    const one = (filter: SpaceSearchFilter, isEventValid?: SpaceSearchRequestOptions['isEventValid']) =>
        deps.request({
            relays: [relayUrl],
            filters: [filter],
            signal,
            autoClose: true,
            isEventValid,
            // Beide Kanäle, und zwar gleichwertig: was `matchFilters` aussortiert,
            // ist am Relay trotzdem ein Treffer gewesen (Punkt 4 im Kopf).
            onEvent: (event) => {
                if (!collected.has(event.id)) {
                    collected.set(event.id, event)
                }
            },
            onFiltered: (event) => {
                if (!collected.has(event.id)) {
                    collected.set(event.id, event)
                }
            },
            onClosed: (reason) => {
                rejected = rejected ?? reason
            },
            onEose: () => {
                eoseCount += 1
            },
        })

    await Promise.all([
        one(contentFilter),
        // NUR hier der Override — die Inhaltssuche braucht ihn nicht und behält
        // damit den unveränderten Kontext-Haken.
        one(profileFilter, relaySearchEventValid),
    ])

    const all = [...collected.values()]

    return {
        ran: true,
        complete: eoseCount >= 2,
        rejected,
        messages: all.filter((event) => event.kind !== 0).sort(byCreatedAtDesc),
        profiles: newestPerPubkey(all.filter((event) => event.kind === 0)),
    }
}

// ── Aufbereitung ────────────────────────────────────────────────────────────

/** Eine Nachricht in der Trefferliste. */
export type MessageHit = {
    id: string
    pubkey: string
    kind: number
    /** Kanal-UUID aus dem `h`-Tag, '' wenn keins (dann relay-global). */
    h: string
    created_at: number
    text: string
    name: string
    segments: SearchSegment[]
    nameSegments: SearchSegment[]
}

/**
 * Eine Person in der Trefferliste.
 *
 * **Ohne `nip05`, und das ist eine Entscheidung.** Der Wert stünde hier roh aus einem
 * kind 0 des Workspace-Relays: signaturgeprüft, aber NICHT gegen `.well-known/nostr.json`
 * verifiziert. In dieser App bedeutet ein schlichter Handle-Text „geprüft" — die fünf
 * anderen Anzeigen laufen alle über `verifiedNip05` ([[handles]]). Eine Trefferzeile, die
 * das bricht, behauptet eine Identität, die niemand geprüft hat, und sieht dabei aus wie
 * die geprüften daneben.
 *
 * Verifizieren wäre der andere Weg, kostet hier aber zweimal zu viel: eine
 * `.well-known`-Abfrage **je Treffer** an fremde Hosts (die dabei erfahren, wonach hier
 * gesucht wird), und die Liste ist ein Schnappschuss aus einem Promise — ein asynchron
 * nachgewärmter Handle erschiene ohnehin nie. Also gar nicht zeigen.
 */
export type PersonHit = {
    pubkey: string
    name: string
    picture: string
    about: string
    created_at: number
    nameSegments: SearchSegment[]
    aboutSegments: SearchSegment[]
}

const tagValue = (event: TrustedEvent, key: string): string =>
    event.tags.find((tag) => tag[0] === key)?.[1] ?? ''

/**
 * Nachrichten-Treffer aufbereiten.
 *
 * **Ohne erneuten Textabgleich** — siehe Punkt 4 im Kopf: das Relay hat
 * entschieden, unser Abgleich kennt kein Stemming und würde genau die Treffer
 * wegwerfen, für die `onFiltered` überhaupt ausgewertet wird. `search.ts` trägt
 * hier nur die Hervorhebung; findet sie nichts, steht der Text eben unmarkiert
 * da (und das ist ehrlicher als ihn zu verschweigen).
 */
export const toMessageHits = (
    events: TrustedEvent[],
    query: string,
    nameOf: (pubkey: string) => string,
    limit = SEARCH_RESULT_LIMIT,
): MessageHit[] => {
    const terms = parseSearchTerms(query)

    return events.slice(0, limit).map((event) => {
        const name = nameOf(event.pubkey)

        return {
            id: event.id,
            pubkey: event.pubkey,
            kind: event.kind,
            h: tagValue(event, 'h'),
            created_at: event.created_at,
            text: event.content,
            name,
            segments: snippetSegments(event.content, terms),
            nameSegments: toSegments(name, findMatchRanges(name, terms)),
        }
    })
}

/** Ein kind-0-`content` so weit lesen, wie es die Trefferzeile braucht. */
const readProfile = (event: TrustedEvent): { name: string; picture: string; about: string } => {
    let parsed: Record<string, unknown> = {}
    try {
        const value: unknown = JSON.parse(event.content || '{}')
        if (value && typeof value === 'object') {
            parsed = value as Record<string, unknown>
        }
    } catch {
        // Ein kaputtes Profil ist kein Grund, den ganzen Treffer wegzuwerfen —
        // der Pubkey allein trägt die Zeile noch.
    }
    const str = (key: string): string => (typeof parsed[key] === 'string' ? (parsed[key] as string) : '')

    return {
        name: str('display_name') || str('displayName') || str('name'),
        // Kein `nip05`: unverifiziert und deshalb nicht anzeigbar — Begründung bei {@link PersonHit}.
        picture: str('picture'),
        about: str('about'),
    }
}

/** Personen-Treffer aufbereiten. Gleiche Regel wie oben: nur Hervorhebung. */
export const toPersonHits = (
    events: TrustedEvent[],
    query: string,
    limit = SEARCH_RESULT_LIMIT,
): PersonHit[] => {
    const terms = parseSearchTerms(query)

    return events.slice(0, limit).map((event) => {
        const profile = readProfile(event)
        const name = profile.name || event.pubkey.slice(0, 12)

        return {
            pubkey: event.pubkey,
            name,
            picture: profile.picture,
            about: profile.about,
            created_at: event.created_at,
            nameSegments: toSegments(name, findMatchRanges(name, terms)),
            aboutSegments: profile.about === '' ? [] : snippetSegments(profile.about, terms),
        }
    })
}
