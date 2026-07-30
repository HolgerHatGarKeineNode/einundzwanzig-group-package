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

export type RailGroup = {
    key: RailGroupKey
    /** Beigetretene Räume, alphabetisch. Nie gekappt. */
    joined: RailRoom[]
    /** Nicht beigetretene, nach Gruppenregel sortiert und ggf. gekappt. */
    others: RailRoom[]
    /** Wie viele nicht beigetretene die Kappung verschluckt hat (0 = keine). */
    hiddenCount: number
    /** Gesamtbestand der Gruppe VOR der Kappung — die Zahl am Gruppenkopf. */
    total: number
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

export type BuildOptions = {
    /** Präsentations-Join für Meetup-Räume (Land/Stadt/Flagge). */
    presentations?: Record<string, RailPresentation>
    /** Suchtext ohne Scope-Token. */
    query?: string
    scope?: RailScope
    /** Räume des Workspace-Space — eigene Gruppe, eigener Relay. */
    workspaceRooms?: RailRoom[]
}

/**
 * Baut die vier Gruppen.
 *
 * **Gekappt wird nur ungefiltert.** Wer ausdrücklich eingegrenzt hat, bekommt sein
 * vollständiges Ergebnis; eine Kappung auf ein angefordertes Ergebnis wäre eine
 * Lüge über die Trefferzahl.
 */
export const buildGroups = (rooms: RailRoom[], opts: BuildOptions = {}): RailGroup[] => {
    const pres = opts.presentations ?? {}
    const query = (opts.query ?? '').trim()
    const scope = opts.scope ?? EMPTY_SCOPE
    const filtering = query !== '' || scope.group !== null || scope.country !== ''

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

        const joined = members.filter((r) => r.joined).sort(byName)
        const others = members.filter((r) => !r.joined).sort(key === 'meetups' ? byActivity : byName)
        const capped = filtering ? others : others.slice(0, UNJOINED_CAP)

        return {
            key,
            joined,
            others: capped,
            hiddenCount: others.length - capped.length,
            total: joined.length + others.length,
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
