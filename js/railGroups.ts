/**
 * Gruppierung, Suche und Kürzung für den Desktop-Navigator — REIN & welshman-frei
 * (wie `roomCategories.ts` und `meetupPresentation.ts`), damit die Logik ohne
 * Browser-/Store-Runtime testbar bleibt (`railGroups.test.ts`). KEINE relativen
 * Imports mit Endung — sonst läuft der Node-Test-Runner nicht mehr.
 *
 * **Warum das ein eigenes Modul ist.** Die Rail zeigte zwei flache Listen mit 13 und
 * 82 Einträgen. 95 Zeilen sind eine Übersicht, egal welche Überschriften darüber
 * stehen — und eine Übersicht ist genau das, was eine Sprungliste nicht sein darf.
 * Die Gruppen sind deshalb kein Ordnungs-Schmuck, sondern der Mechanismus, mit dem
 * die Spalte KÜRZER wird als vorher: ungefiltert passt sie auf einen Bildschirm,
 * gefunden wird trotzdem alles.
 *
 * Der Zuschnitt hat GENAU EINE Achse: den Raumtyp. Die zweite Achse
 * (Mitgliedschaft) wird bewusst nicht zur Überschrift — sie ist Reihenfolge und
 * Textgewicht innerhalb der Gruppe. Sonst entstünden 2 × 4 × n Zellen statt 4.
 */

/** Die Typ-Merkmale eines Raums, die den Gruppenschnitt tragen. */
export type RailRoom = {
    h: string
    name: string
    picture?: string
    locked?: boolean
    isMeetup?: boolean
    isProjectSupport?: boolean
    meetupSlug?: string
    /** `created_at` des jüngsten Timeline-Events, `null` wenn keins bekannt. */
    lastMessageAt?: number | null
    /** Ist der Nutzer Mitglied? Kommt aus `userRooms` vs. `otherRooms`. */
    joined?: boolean
}

/** Der Präsentations-Join eines Meetup-Raums (Untermenge von `MeetupPresentation`). */
export type RailPresentation = {
    country?: string
    flag?: string
    city?: string
}

/** Die vier Gruppen. Reihenfolge ist Teil des Vertrags, nicht Zufall. */
export type RailGroupKey = 'rooms' | 'meetups' | 'proposals' | 'workspace'

export const RAIL_GROUP_ORDER: readonly RailGroupKey[] = ['rooms', 'meetups', 'proposals', 'workspace']

/**
 * Kürzel, die den Scope adressierbar machen. Es ist genau die Zeichenfolge, die
 * ein Klick auf die Lupe ins Feld schreibt — das Präfix ist damit kein Geheimwissen,
 * sondern etwas, das die Oberfläche dem Nutzer beibringt.
 */
export const SCOPE_PREFIX: Readonly<Record<string, RailGroupKey>> = {
    r: 'rooms',
    m: 'meetups',
    p: 'proposals',
    w: 'workspace',
}

/**
 * Höchstzahl NICHT beigetretener Zeilen je Gruppe im ungefilterten Zustand.
 * Beigetretene werden NIE gekappt — sie sind der Zweck der Spalte.
 */
export const UNJOINED_CAP = 12

/**
 * Eine benannte Untergliederung der Workspace-Gruppe — was der Nutzer in Buzz
 * Desktop als „Section" angelegt hat (`channel-sections`, NIP-78).
 *
 * `icon` ist ein EMOJI, kein Icon-Name: Buzz lässt dort einen Emoji-Picker wählen
 * und rendert ihn als Text (`ChannelSectionDialogs.tsx:115`, `StatusEmoji`).
 */
export type RailSection = {
    id: string
    name: string
    icon?: string
    /** Die Räume dieser Sektion, nach dem Sortiermodus `section:<id>` geordnet. */
    rooms: RailRoom[]
}

export type RailGroup = {
    key: RailGroupKey
    /**
     * Angeheftete Räume, ganz oben. Nie gekappt — sie sind ausdrücklich gewählt.
     * Nur die Gruppe `workspace` kann hier etwas stehen haben; siehe
     * {@link WorkspacePrefs}.
     */
    pinned: RailRoom[]
    /**
     * Die Sektionen dieser Gruppe, in ANZEIGE-Reihenfolge (`order` aufsteigend,
     * vorsortiert vom Aufrufer über `orderedSections`). Leere Sektionen fallen
     * heraus. Wieder nur `workspace` kann hier etwas stehen haben.
     *
     * Die Räume darin sind aus {@link joined}/{@link others} HERAUSGENOMMEN, nicht
     * kopiert — dieselbe Regel wie bei {@link pinned}, und aus demselben Grund:
     * ein Raum, der zweimal in der Spalte steht, macht jede Zahl daneben falsch.
     */
    sections: RailSection[]
    /** Beigetretene Räume ohne Sektion, alphabetisch. Nie gekappt. */
    joined: RailRoom[]
    /** Nicht beigetretene ohne Sektion, nach Gruppenregel sortiert und ggf. gekappt. */
    others: RailRoom[]
    /** Wie viele nicht beigetretene die Kappung verschluckt hat (0 = keine). */
    hiddenCount: number
    /** Gesamtbestand der Gruppe VOR der Kappung — die Zahl am Gruppenkopf. */
    total: number
    /**
     * Die `h` der stummgeschalteten Räume DIESER Gruppe, VOR der Kappung.
     * Zweck: die Ungelesen-Summe am Gruppenkopf lässt sie aus — sonst zählte ein
     * stumm geschalteter Raum weiter mit und die Stummschaltung „wirkte" nur
     * optisch. Wieder nur `workspace` kann hier etwas stehen haben.
     */
    muted: string[]
}

/** Der aktive Suchbereich: Gruppe und/oder Land. */
export type RailScope = {
    group: RailGroupKey | null
    /** ISO-3166-1-alpha-2, GROSS ('' = kein Landfilter). */
    country: string
}

export const EMPTY_SCOPE: RailScope = { group: null, country: '' }

const nameOf = (room: RailRoom): string => (room.name || room.h).toLocaleLowerCase()

const byName = (a: RailRoom, b: RailRoom): number => nameOf(a).localeCompare(nameOf(b))

/** Jüngste Aktivität zuerst; Räume ohne bekannte Aktivität ans Ende. */
const byActivity = (a: RailRoom, b: RailRoom): number =>
    (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0) || byName(a, b)

/**
 * Der Typ eines Raums. Reihenfolge der Prüfung ist bedeutsam: ein Raum kann
 * beide Marker tragen, und „Antrag" ist die speziellere Aussage.
 */
export const groupOf = (room: RailRoom): Exclude<RailGroupKey, 'workspace'> => {
    if (room.isProjectSupport) {
        return 'proposals'
    }

    return room.isMeetup ? 'meetups' : 'rooms'
}

/**
 * Diakritika-tolerantes Enthaltensein. `localeCompare` hilft hier nicht — gesucht
 * wird nach Teilzeichenketten, nicht sortiert.
 */
const contains = (haystack: string, needle: string): boolean =>
    haystack.toLocaleLowerCase().includes(needle.toLocaleLowerCase())

/**
 * Trifft die Suche diesen Raum? Gesucht wird über Name UND Stadt — sonst
 * beantworten Rail und Bühne dieselbe Frage verschieden (die Bühne sucht die
 * Stadt bereits mit).
 */
export const matchRoom = (room: RailRoom, pres: RailPresentation | undefined, query: string): boolean => {
    const q = query.trim()
    if (q === '') {
        return true
    }

    return contains(room.name || room.h, q) || (pres?.city ? contains(pres.city, q) : false)
}

/**
 * Traf die Suche NUR über die Stadt? Dann hängt die Zeile die Stadt als Suffix an —
 * ohne das findet der Nutzer eine Zeile, in der sein Suchwort nicht vorkommt, und
 * traut der Suche nicht mehr.
 */
export const matchedViaCity = (room: RailRoom, pres: RailPresentation | undefined, query: string): boolean => {
    const q = query.trim()
    if (q === '' || !pres?.city) {
        return false
    }

    return contains(pres.city, q) && !contains(room.name || room.h, q)
}

/**
 * Liest ein Scope-Präfix aus dem Eingabetext: `m:` `p:` `r:` `w:` für Gruppen,
 * zwei Buchstaben für ein Land (`de:` `at:`). Gibt den Scope UND den Resttext
 * zurück — der Aufrufer entscheidet, ob er das Token stehen lässt oder in einen
 * Chip hebt.
 *
 * Unbekannte Präfixe bleiben Text. Ein `foo:` ist eine Suche nach „foo:", keine
 * stille Filterung auf nichts.
 */
export const parseScope = (text: string): { scope: RailScope; rest: string } => {
    const m = /^\s*([a-zA-Z]{1,2}):\s*/.exec(text)
    if (!m) {
        return { scope: EMPTY_SCOPE, rest: text }
    }
    const token = m[1].toLowerCase()
    const rest = text.slice(m[0].length)

    if (token.length === 1 && SCOPE_PREFIX[token]) {
        return { scope: { group: SCOPE_PREFIX[token], country: '' }, rest }
    }
    // Zwei Buchstaben = Ländercode. Er impliziert die Meetup-Gruppe: Länder gibt
    // es nur dort, und ein Landfilter über Räume ohne Land wäre immer leer.
    if (token.length === 2) {
        return { scope: { group: 'meetups', country: token.toUpperCase() }, rest }
    }

    return { scope: EMPTY_SCOPE, rest: text }
}

/** Der Text, den ein Klick auf die Lupe bzw. einen Land-Chip ins Feld schreibt. */
export const scopeToken = (scope: RailScope): string => {
    if (scope.country !== '') {
        return scope.country.toLowerCase() + ':'
    }
    const entry = Object.entries(SCOPE_PREFIX).find(([, g]) => g === scope.group)

    return entry ? entry[0] + ':' : ''
}

/** Buzz' Sortiermodi — `'alpha'` nach Namen, `'recent'` nach letzter Aktivität. */
export type RailSortMode = 'alpha' | 'recent'

/**
 * Was der Nutzer in **Buzz Desktop** über seine Workspace-Kanäle gesagt hat
 * (NIP-78 / kind 30078, gelesen von `channelPrefs.ts`). Drei Eingaben, kein
 * Umbau: die Gruppenlogik bleibt rein und bekommt nur mehr zu wissen.
 *
 * **Warum ausschließlich `workspace`.** Die Präferenzen liegen auf dem
 * Buzz-Relay und beschreiben dessen Kanäle. Auf die zooid-Gruppen angewandt
 * wären sie eine Aussage über Räume, über die niemand etwas gesagt hat — und der
 * zooid-Arm bleibt in dieser Runde unverändert.
 *
 * **Nur lesen.** Setzen ist bewusst nicht Teil dieser Runde: wer nichts in Buzz
 * Desktop gepflegt hat, sieht hier nichts, und das ist kein Mangel, sondern der
 * Zuschnitt.
 */
/**
 * Die Sektionen des Workspace, aufbereitet für {@link buildGroups}.
 *
 * **Strukturell statt importiert.** Die Quelle ist `channelPrefsData.ts`
 * (`SectionsStore` + `orderedSections` + `sortModeForGroup`), aber dieses Modul
 * importiert bewusst NICHTS: es läuft unter `node --test` direkt gegen die
 * `.ts`-Datei, und ein endungsloser relativer Import wäre dort nicht auflösbar.
 * Die Umrechnung macht `channelPrefs.ts`, das ohnehin beide Seiten kennt.
 */
export type WorkspaceSections = {
    /**
     * Sektionen in ANZEIGE-Reihenfolge (`order` aufsteigend). Hier wird NICHT mehr
     * sortiert: die Reihenfolge ist eine Aussage des Aufrufers (`orderedSections`),
     * und Buzz trennt an genau derselben Stelle (`useChannelSections.ts:166`).
     */
    sections: readonly { id: string; name: string; icon?: string }[]
    /** Kanal-`h` → Sektions-`id`. Zuordnungen auf unbekannte Sektionen sind folgenlos. */
    assignments: Readonly<Record<string, string>>
    /** Sortiermodus je Sektion (Buzz-Gruppenschlüssel `section:<id>`). */
    sortById?: Readonly<Record<string, RailSortMode>>
}

export type WorkspacePrefs = {
    /** `h` der angehefteten Räume (Buzz: `channel-stars`). */
    pinned?: readonly string[]
    /** `h` der stummgeschalteten Räume (Buzz: `channel-mutes`). */
    muted?: readonly string[]
    /** Sortierung der normalen Zeilen (Buzz-Gruppe `channels`). */
    sort?: RailSortMode
    /**
     * Sortierung der angehefteten Zeilen (Buzz-Gruppe `starred`) — in Buzz eine
     * EIGENE Einstellung (`AppSidebar.tsx:430-434` gegen `:420`), deshalb auch
     * hier ein eigenes Feld statt einer geteilten.
     */
    pinnedSort?: RailSortMode
    /**
     * Die benannten Sektionen (Buzz: `channel-sections`). Ohne dieses Feld
     * verhält sich {@link buildGroups} exakt wie vor P7 — eine Gruppe ohne
     * Sektionen ist die bisherige Gruppe.
     */
    sections?: WorkspaceSections
}

export type BuildOptions = {
    /** Präsentations-Join für Meetup-Räume (Land/Stadt/Flagge). */
    presentations?: Record<string, RailPresentation>
    /** Suchtext ohne Scope-Token. */
    query?: string
    scope?: RailScope
    /** Räume des Workspace-Space — eigene Gruppe, eigener Relay. */
    workspaceRooms?: RailRoom[]
    /** Kanal-Präferenzen aus Buzz Desktop; greifen NUR auf `workspace`. */
    workspacePrefs?: WorkspacePrefs
}

/** Der Vergleicher zu einem Modus. `'alpha'` ist der Default in Buzz wie bei uns. */
const comparatorFor = (mode: RailSortMode | undefined): ((a: RailRoom, b: RailRoom) => number) =>
    mode === 'recent' ? byActivity : byName

/**
 * Die Räume auf ihre Sektionen verteilen. Leere Sektionen fallen heraus.
 *
 * **Warum leer = weg.** Buzz rendert auch leere Sektionen
 * (`AppSidebar.tsx:672`, `bySection[id] ?? []`) — dort kann man Kanäle
 * hineinziehen, die Überschrift ist also ein Ziel. Wir lesen nur; eine
 * Überschrift ohne Zeilen wäre hier eine Beschriftung über nichts.
 *
 * **Eine Zuordnung auf eine unbekannte Sektion ist folgenlos.** Der Raum bleibt
 * dann im Rest-Block und ist damit weiterhin erreichbar — genau der Fall, den
 * Buzz mit `sectionIds.has(sectionId)` abfängt (`AppSidebar.tsx:399-408`).
 */
const buildSections = (rooms: RailRoom[], prefs: WorkspaceSections | undefined): RailSection[] => {
    if (!prefs || prefs.sections.length === 0) {
        return []
    }
    const byId = new Map<string, RailRoom[]>()
    for (const room of rooms) {
        const id = prefs.assignments[room.h]
        if (id === undefined) {
            continue
        }
        const bucket = byId.get(id)
        if (bucket) {
            bucket.push(room)
        } else {
            byId.set(id, [room])
        }
    }

    return prefs.sections.flatMap((section): RailSection[] => {
        const members = byId.get(section.id)
        if (!members || members.length === 0) {
            return []
        }

        return [{
            id: section.id,
            name: section.name,
            ...(section.icon ? { icon: section.icon } : {}),
            rooms: members.sort(comparatorFor(prefs.sortById?.[section.id])),
        }]
    })
}

/**
 * Baut die vier Gruppen.
 *
 * **Gekappt wird nur ungefiltert.** Wer ausdrücklich eingegrenzt hat, bekommt sein
 * vollständiges Ergebnis; eine Kappung auf ein angefordertes Ergebnis wäre eine
 * Lüge über die Trefferzahl.
 *
 * **Die Workspace-Präferenzen ändern nichts an den anderen drei Gruppen.** Ohne
 * `workspacePrefs` ist das Ergebnis bitgleich zu vorher: `pinned` ist leer,
 * `sections` ist leer, `muted` ist leer, und der Default-Modus `'alpha'` ist genau
 * die Namenssortierung, die schon immer galt.
 *
 * **Die Reihenfolge im Workspace ist Buzz': angeheftet → Sektionen → Rest.** Wer
 * in keiner Sektion steht, landet im Rest-Block (`joined`/`others`) UNTER den
 * Sektionen — dieselbe Stelle, an der Buzz seine Gruppe „Channels" rendert
 * (`AppSidebar.tsx:625,672,731`). Kein Kanal verschwindet, weil er keiner Sektion
 * zugeordnet ist; das ist der Zweck des Rest-Blocks, kein Auffangbecken.
 *
 * **Sektions-Zeilen werden nicht gekappt.** Der Deckel {@link UNJOINED_CAP} schützt
 * vor einer 82-zeiligen Entdecken-Liste; eine Sektion ist dagegen eine ausdrückliche
 * Wahl des Nutzers — dieselbe Begründung wie bei den Angehefteten.
 */
export const buildGroups = (rooms: RailRoom[], opts: BuildOptions = {}): RailGroup[] => {
    const pres = opts.presentations ?? {}
    const query = (opts.query ?? '').trim()
    const scope = opts.scope ?? EMPTY_SCOPE
    const filtering = query !== '' || scope.group !== null || scope.country !== ''
    const prefs = opts.workspacePrefs ?? {}
    const pinnedSet = new Set(prefs.pinned ?? [])
    const mutedSet = new Set(prefs.muted ?? [])

    const buckets: Record<RailGroupKey, RailRoom[]> = { rooms: [], meetups: [], proposals: [], workspace: [] }
    for (const room of rooms) {
        buckets[groupOf(room)].push(room)
    }
    for (const room of opts.workspaceRooms ?? []) {
        buckets.workspace.push(room)
    }

    return RAIL_GROUP_ORDER.map((key) => {
        let members = buckets[key]

        // Der Landfilter greift ausschließlich auf Meetups — nur sie tragen ein Land.
        if (scope.country !== '') {
            members = key === 'meetups'
                ? members.filter((r) => (pres[r.meetupSlug ?? '']?.country ?? '') === scope.country)
                : []
        }
        if (scope.group !== null && key !== scope.group) {
            members = []
        }
        if (query !== '') {
            members = members.filter((r) => matchRoom(r, pres[r.meetupSlug ?? ''], query))
        }

        // Angeheftete werden aus den normalen Töpfen HERAUSGENOMMEN, nicht kopiert
        // — genau wie in Buzz (`AppSidebar.tsx:399`: `if (starredChannelIds?.has(id))
        // continue`). Stünde ein Raum in beiden, zeigte die Rail ihn doppelt und die
        // Kappungszahl wäre falsch.
        const isWorkspace = key === 'workspace'
        const pinned = isWorkspace ? members.filter((r) => pinnedSet.has(r.h)) : []
        const afterPinned = isWorkspace && pinned.length > 0 ? members.filter((r) => !pinnedSet.has(r.h)) : members

        // Anheften SCHLÄGT die Sektion: `buildSections` sieht die angehefteten Räume
        // gar nicht mehr. Genau Buzz' Reihenfolge (`AppSidebar.tsx:399`:
        // `if (starredChannelIds?.has(id)) continue` steht VOR der Sektions-Zuordnung)
        // — ein angehefteter Raum steht oben, nicht in seiner Sektion, und nie in beidem.
        const sections = isWorkspace ? buildSections(afterPinned, prefs.sections) : []
        const inSection = new Set(sections.flatMap((s) => s.rooms.map((r) => r.h)))
        const rest = inSection.size > 0 ? afterPinned.filter((r) => !inSection.has(r.h)) : afterPinned

        // Der Sortiermodus gilt nur im Workspace; überall sonst bleibt die
        // bisherige Regel (beigetreten alphabetisch, Meetups nach Aktivität).
        const restSort = isWorkspace ? comparatorFor(prefs.sort) : null
        const joined = rest.filter((r) => r.joined).sort(restSort ?? byName)
        const others = rest.filter((r) => !r.joined).sort(restSort ?? (key === 'meetups' ? byActivity : byName))
        const capped = filtering ? others : others.slice(0, UNJOINED_CAP)
        const inSectionCount = sections.reduce((sum, s) => sum + s.rooms.length, 0)

        return {
            key,
            pinned: pinned.sort(comparatorFor(prefs.pinnedSort)),
            sections,
            joined,
            others: capped,
            hiddenCount: others.length - capped.length,
            // Gerechnet über den UNGEKAPPTEN Bestand inklusive der Angehefteten und
            // der Sektions-Zeilen — der Kopf zeigt, was da ist, nicht was gerade
            // sichtbar ist.
            total: pinned.length + inSectionCount + joined.length + others.length,
            muted: isWorkspace ? members.filter((r) => mutedSet.has(r.h)).map((r) => r.h) : [],
        }
    })
}

/**
 * Kürzt in der MITTE statt am Ende.
 *
 * Am Ende zu kürzen trifft bei diesen Raumnamen genau das unterscheidende Stück:
 * `bitcoin-einsteigervortrag-von-pra…` und `einundzwanzig-pleb-walk-rheinhess…`
 * sind bis zum Kürzungspunkt nahezu identisch mit ihren Nachbarn. Das Ende trägt
 * hier die Information.
 */
export const middleTruncate = (name: string, max = 34): string => {
    if (name.length <= max) {
        return name
    }
    // Ein Zeichen für das Auslassungszeichen; der Rest geht 60/40 an Kopf und Ende.
    const keep = max - 1
    const head = Math.ceil(keep * 0.6)

    return name.slice(0, head) + '…' + name.slice(name.length - (keep - head))
}

/**
 * Ab wie vielen Zeilen lohnt eine Untergliederung der Liste „Meine Räume"?
 *
 * Fünf, aus zwei unabhängigen Richtungen: bei 375×667 passen mit Space-Kopf und
 * Segment-Umschalter rund fünf Zeilen ins Bild — bis dahin sieht man die Liste
 * ohnehin als Ganzes. Und bis dahin trägt der Flaggen-Pin am Avatar den Typ
 * bereits ohne Überschrift; ein Label kostet 21px, also fast eine halbe Zeile.
 *
 * Darunter ändert sich für den Nutzer NICHTS — das ist der Punkt der Schwelle.
 */
export const MINE_SPLIT_THRESHOLD = 5

/**
 * Teilt eine reine Mitgliederliste in „Räume" und „Meetups" — die mobile Fassung
 * des Gruppenschnitts.
 *
 * **Warum nicht `buildGroups()`.** Dessen Bestandteile passen hier nicht: die
 * joined/others-Achse ist gegenstandslos (diese Liste ist zu 100 % beigetreten,
 * ohne gesetztes `joined` fiele alles in `others` und Meetups würden nach
 * Aktivität statt nach Namen sortiert), die Kappung bei 12 wäre stiller
 * Datenverlust, und Länder-/Scope-Filter gibt es mobil nicht. Geteilt wird
 * deshalb genau das, was geteilt gehört: `groupOf`.
 *
 * **Identitätserhaltend.** Gibt die ORIGINAL-Objekte zurück, keine Kopien:
 * `room-tile` setzt bei einem Bildfehler `room.picture = ''`, damit der Fallback
 * greift — an einer Kopie liefe das ins Leere.
 *
 * **Sortiert nicht um.** Die Reihenfolge innerhalb einer Sektion ist die der
 * Eingabe; wer sie ändern will, ändert sie beim Aufrufer.
 *
 * Unter der Schwelle oder bei nur einem vorkommenden Typ: genau EINE Sektion —
 * eine Überschrift über allem ist keine Gruppe.
 */
export const splitMine = <T extends RailRoom>(rooms: T[]): { key: 'rooms' | 'meetups'; rooms: T[] }[] => {
    const standard = rooms.filter((r) => groupOf(r) !== 'meetups')
    const meetups = rooms.filter((r) => groupOf(r) === 'meetups')

    if (rooms.length < MINE_SPLIT_THRESHOLD || standard.length === 0 || meetups.length === 0) {
        return rooms.length === 0
            ? []
            : [{ key: meetups.length === rooms.length ? 'meetups' : 'rooms', rooms }]
    }

    // Reihenfolge wie `RAIL_GROUP_ORDER`: Räume vor Meetups.
    return [
        { key: 'rooms', rooms: standard },
        { key: 'meetups', rooms: meetups },
    ]
}

/** Die Workspace-Liste der Bühne: eine flache Reihenfolge plus zwei Merkmal-Listen. */
export type WorkspaceList<T extends RailRoom> = {
    /** Alle Zeilen in Anzeige-Reihenfolge: angeheftet · beigetreten · entdeckbar. */
    rooms: T[]
    /** `h` der angehefteten Räume, die WIRKLICH in der Liste stehen. */
    pinned: string[]
    /** `h` der stummgeschalteten Räume — sie bleiben in `rooms` stehen. */
    muted: string[]
}

/**
 * Die Workspace-Raumliste der BÜHNE (Tab „Workspaces" in `⚡spaces.blade.php`) —
 * die Fläche, die es auch unterhalb von `xl` gibt, wo keine Rail existiert.
 *
 * **Warum nicht `buildGroups()`** (dieselbe Frage wie bei {@link splitMine}, andere
 * Antwort im Detail): Die Bühne zeigt EINE Liste ohne Gruppenköpfe, ohne Scope,
 * ohne Länderfilter und ohne Kappung — `buildGroups` liefert vier Gruppen, von
 * denen drei hier immer leer wären, und würde die entdeckbaren Räume bei 12
 * abschneiden. Das wäre auf einer Fläche, die keinen „Noch :count"-Fuß hat,
 * stiller Datenverlust. Wiederverwendet wird deshalb das, was die Regel AUSMACHT:
 * dieselben `WorkspacePrefs`, dieselben Vergleicher, dieselbe Reihenfolge
 * (angeheftet zuerst, dann der Rest) und dieselbe Zusage „stumm heißt leise, nicht
 * weg". Die Sektionen bleiben bewusst der Rail vorbehalten: die Bühnen-Liste hat
 * keine Untergliederung und bekäme mit Sektionsköpfen eine zweite Achse, die dort
 * niemand angefordert hat.
 *
 * **Die joined/others-Trennung bleibt erhalten** und wird NUR INNERHALB sortiert.
 * Sie ist die Reihenfolge, die diese Fläche vorher schon hatte
 * (`userRooms.concat(otherRooms)`, `bridge.ts`); ohne sie sortierte ein
 * `sort: 'alpha'` — der Default! — die beigetretenen Räume unter die fremden und
 * änderte die Liste für jeden Nutzer, der nie eine Präferenz gesetzt hat.
 *
 * **Identitätserhaltend** wie {@link splitMine}: die Original-Objekte, keine Kopien.
 */
export const buildWorkspaceList = <T extends RailRoom>(rooms: T[], prefs: WorkspacePrefs = {}): WorkspaceList<T> => {
    const pinnedSet = new Set(prefs.pinned ?? [])
    const mutedSet = new Set(prefs.muted ?? [])

    const pinned = rooms.filter((r) => pinnedSet.has(r.h)).sort(comparatorFor(prefs.pinnedSort))
    const rest = pinned.length > 0 ? rooms.filter((r) => !pinnedSet.has(r.h)) : rooms
    const bySort = comparatorFor(prefs.sort)

    return {
        rooms: [
            ...pinned,
            ...rest.filter((r) => r.joined).sort(bySort),
            ...rest.filter((r) => !r.joined).sort(bySort),
        ],
        pinned: pinned.map((r) => r.h),
        // Gemeldet wird über den GESAMTEN Bestand, nicht über `rest`: ein
        // angehefteter Raum kann zugleich stumm sein (Buzz erlaubt beides), und
        // seine Zeile muss dann auch oben stumm aussehen.
        muted: rooms.filter((r) => mutedSet.has(r.h)).map((r) => r.h),
    }
}
