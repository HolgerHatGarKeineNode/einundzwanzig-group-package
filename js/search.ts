/**
 * Suche im geladenen Verlauf (P6a) — die reine Logik, ohne welshman, ohne DOM.
 *
 * ── Warum überhaupt selbst filtern ──────────────────────────────────────────────────
 * Der Bestand liegt im Speicher; ein Relay wird dafür nicht gefragt. Der naheliegende
 * Weg wäre, `search` einfach in den Filter zu schreiben und welshman machen zu lassen —
 * genau der trägt aber einen Fehler, der GEMESSEN und nicht vermutet ist:
 *
 *   node_modules/@welshman/util/dist/util/src/Filters.js:11-20 (0.8.16)
 *       if (filter.search) {
 *           const terms = filter.search.toLowerCase().split(/\s+/g)
 *           for (const term of terms) {
 *               if (content.includes(term)) { return true }
 *               return false                 // ← in JEDEM Fall in Runde 1 zurück
 *           }
 *       }
 *
 * Die Schleife kehrt in der ERSTEN Iteration zurück, egal wie sie ausgeht. Nur das erste
 * Wort entscheidet, jedes weitere ist wirkungslos: „bitcoin meetup" liefert dasselbe wie
 * „bitcoin". Das ist keine tote Zeile — `Repository.query` ruft `matchFilter` für jedes
 * Ereignis auf (`@welshman/net/dist/net/src/repository.js:127`), ein `search` im Filter
 * liefe also direkt hinein.
 *
 * ── Was diese Umsetzung anders macht ────────────────────────────────────────────────
 * Drei Unterschiede, alle absichtlich und alle testbar:
 *
 *  1. **UND statt „erstes Wort".** Jeder Suchbegriff muss vorkommen. „bitcoin meetup"
 *     findet nur, was beides enthält — in beliebiger Reihenfolge.
 *  2. **Diakritika-blind, und ß gilt als ss.** „muller" findet „Müller", „grusse" findet
 *     „Grüße", „Straße" findet „Strasse". `matchFilter` kennt nur `toLowerCase` und
 *     findet davon nichts. Das ß ist kein Zierrat, sondern der Grund für die
 *     Index-Tabelle unten: ein Zeichen wird zu zweien.
 *  3. **Autorname zählt mit.** Ein Begriff darf im Text ODER im Anzeigenamen stehen;
 *     „peter danke" findet Peters „danke". `matchFilter` sieht ausschließlich
 *     `event.content` und kann das grundsätzlich nicht.
 *
 * Teilwörter finden beide (`includes`), Groß-/Kleinschreibung ebenfalls — das ist kein
 * Unterschied, nur eine Erwartung, die erfüllt bleibt.
 *
 * ── Warum die Faltung eine Index-Tabelle mitführt ───────────────────────────────────
 * Für die Hervorhebung müssen Trefferstellen auf den ORIGINALTEXT zurückzeigen. Faltet
 * man naiv (`normalize('NFD').replace(...)`), verschiebt sich jede Position hinter dem
 * ersten Umlaut, und die Markierung säße daneben. {@link foldForSearch} faltet deshalb
 * Zeichen für Zeichen und merkt sich zu jeder Position der Faltung die Position im
 * Original — auch wenn ein Zeichen zu keinem oder zu mehreren wird.
 */

/** Höchstzahl gleichzeitig gezeigter Treffer. Darüber steht die Gesamtzahl in der UI. */
export const SEARCH_RESULT_LIMIT = 50

/** Zeichen vor dem ersten Treffer, die der Ausschnitt als Kontext mitnimmt. */
export const SNIPPET_RADIUS = 48

/** Höchstlänge eines Ausschnitts (nach dem Fenster, vor den Auslassungszeichen). */
export const SNIPPET_MAX = 200

/** Kombinierende Akzente, die die Faltung wegwirft (nach NFD-Zerlegung). */
const DIACRITIC = /\p{Diacritic}/gu

/** Ein Trefferbereich im Originaltext: `[start, ende)`, Ende exklusiv. */
export type MatchRange = [number, number]

/** Ein Stück Anzeigetext — `hit` markiert die Hervorhebung. */
export type SearchSegment = { text: string; hit: boolean }

/** Was eine durchsuchbare Zeile mindestens mitbringen muss. */
export type SearchableRow = {
    id: string
    /** Der durchsuchte Nachrichtentext. */
    text: string
    /** Anzeigename des Autors — zählt bei der Suche mit (siehe Kopf, Punkt 3). */
    name: string
    created_at: number
}

/** Eine Zeile mit ihren fertig hervorgehobenen Anzeigestücken. */
export type SearchHit<T extends SearchableRow> = T & {
    segments: SearchSegment[]
    nameSegments: SearchSegment[]
}

/**
 * Das vollständige Ergebnis einer Suche.
 *
 * `searched` ist die tragende Zahl für die Oberfläche: sie sagt, wie groß der geladene
 * Verlauf gerade IST. Ohne sie hieße „nichts gefunden" für den Nutzer „gibt es nicht",
 * und das wäre gelogen.
 */
export type SearchOutcome<T extends SearchableRow> = {
    /** Zahl der durchsuchten Nachrichten (= Umfang des geladenen Verlaufs). */
    searched: number
    /** Zahl der Treffer insgesamt. */
    total: number
    /** Die gezeigten Treffer, neueste zuerst, auf `limit` gekappt. */
    hits: SearchHit<T>[]
    /** Gab es mehr Treffer als gezeigt? */
    capped: boolean
}

/**
 * Ein einzelnes Zeichen falten: Akzente weg, klein geschrieben, ß zu ss.
 *
 * Kann leer werden (ein alleinstehender kombinierender Akzent) oder länger als ein
 * Zeichen (ß, und `'İ'.toLowerCase()` ergibt ebenfalls zwei) — beides fängt die
 * Index-Tabelle in {@link foldForSearch} ab.
 *
 * Das ß wird NACH `toLowerCase` behandelt, damit auch das grosse ẞ (U+1E9E) mitkommt:
 * es wird erst zu ß und dann zu ss.
 */
const foldChar = (ch: string): string => {
    const base = ch.normalize('NFD').replace(DIACRITIC, '').toLowerCase()
    return base === 'ß' ? 'ss' : base
}

/**
 * Faltung mit Rückweg: `folded` ist der vergleichbare Text, `map[i]` die Position von
 * `folded[i]` im Original.
 *
 * Bewusst über UTF-16-Code-Units statt über Code-Points: die Trefferbereiche werden am
 * Ende mit `slice()` auf den Originaltext angewandt, und `slice` rechnet ebenfalls in
 * Code-Units. Ein Ersatzzeichenpaar (Emoji) bleibt dadurch als Ganzes erhalten — seine
 * beiden Hälften stehen nebeneinander in der Tabelle.
 */
export const foldForSearch = (text: string): { folded: string; map: number[] } => {
    let folded = ''
    const map: number[] = []
    for (let i = 0; i < text.length; i++) {
        const out = foldChar(text[i])
        for (let k = 0; k < out.length; k++) {
            folded += out[k]
            map.push(i)
        }
    }
    return { folded, map }
}

/**
 * Suchbegriffe aus der Eingabe: an Leerraum getrennt, gefaltet, ohne Dubletten.
 *
 * Leere Eingabe ergibt eine leere Liste — und die bedeutet überall „nicht gesucht",
 * nicht „alles gefunden".
 */
export const parseSearchTerms = (query: string): string[] => {
    const terms: string[] = []
    for (const raw of query.trim().split(/\s+/)) {
        const term = foldForSearch(raw).folded
        if (term !== '' && !terms.includes(term)) {
            terms.push(term)
        }
    }
    return terms
}

/** Überlappende/anstoßende Bereiche zusammenlegen — sonst markierte die UI doppelt. */
const mergeRanges = (ranges: MatchRange[]): MatchRange[] => {
    const sorted = ranges.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1])
    const merged: MatchRange[] = []
    for (const [start, end] of sorted) {
        const last = merged[merged.length - 1]
        if (last && start <= last[1]) {
            last[1] = Math.max(last[1], end)
        } else {
            merged.push([start, end])
        }
    }
    return merged
}

/**
 * Alle Fundstellen der Begriffe im Text — als Bereiche im ORIGINAL, zusammengelegt.
 *
 * Die Begriffe sind bereits gefaltet ({@link parseSearchTerms}); der Text wird hier
 * gefaltet. Verglichen wird also Faltung gegen Faltung, zurückgegeben wird Original.
 */
export const findMatchRanges = (text: string, terms: string[]): MatchRange[] => {
    if (terms.length === 0 || text === '') {
        return []
    }
    const { folded, map } = foldForSearch(text)
    const ranges: MatchRange[] = []
    for (const term of terms) {
        let at = folded.indexOf(term)
        while (at !== -1) {
            const start = map[at]
            const last = map[at + term.length - 1]
            if (start !== undefined && last !== undefined) {
                ranges.push([start, last + 1])
            }
            at = folded.indexOf(term, at + term.length)
        }
    }
    return mergeRanges(ranges)
}

/**
 * Kommt JEDER Begriff in mindestens einem der Heuhaufen vor? (UND über die Begriffe,
 * ODER über die Felder — Text und Autorname sind gleichberechtigt.)
 */
export const matchesAllTerms = (haystacks: string[], terms: string[]): boolean => {
    if (terms.length === 0) {
        return false
    }
    const folded = haystacks.map((h) => foldForSearch(h).folded)
    return terms.every((term) => folded.some((h) => h.includes(term)))
}

/** Zeilenumbrüche und Mehrfach-Leerraum zu einem Leerzeichen — eine Zeile pro Treffer. */
const flatten = (text: string): string => text.replace(/\s+/g, ' ')

/**
 * Text in Anzeigestücke schneiden. Ohne Bereiche entsteht genau ein Stück.
 *
 * `from`/`to` schneiden zusätzlich ein Fenster heraus (für den Ausschnitt); die Bereiche
 * werden dabei auf das Fenster geklemmt.
 */
export const toSegments = (
    text: string,
    ranges: MatchRange[],
    from = 0,
    to = text.length,
): SearchSegment[] => {
    const segments: SearchSegment[] = []
    let cursor = from
    for (const [start, end] of ranges) {
        if (end <= from || start >= to) {
            continue
        }
        const hitStart = Math.max(start, from)
        const hitEnd = Math.min(end, to)
        if (hitStart > cursor) {
            segments.push({ text: flatten(text.slice(cursor, hitStart)), hit: false })
        }
        segments.push({ text: flatten(text.slice(hitStart, hitEnd)), hit: true })
        cursor = hitEnd
    }
    if (cursor < to) {
        segments.push({ text: flatten(text.slice(cursor, to)), hit: false })
    }
    return segments.filter((segment) => segment.text !== '')
}

/**
 * Der Ausschnitt einer Trefferzeile: ein Fenster um den ERSTEN Treffer, mit
 * Auslassungszeichen an den geschnittenen Enden.
 *
 * Ohne Fenster stünde bei einer langen Nachricht der Treffer irgendwo hinter dem
 * sichtbaren Rand — die Zeile zeigte dann Text, aber nicht den Grund, warum sie da ist.
 */
export const snippetSegments = (
    text: string,
    terms: string[],
    radius = SNIPPET_RADIUS,
    max = SNIPPET_MAX,
): SearchSegment[] => {
    const ranges = findMatchRanges(text, terms)
    const first = ranges[0]
    const from = first ? Math.max(0, first[0] - radius) : 0
    // Das Fenster muss den ersten Treffer immer VOLLSTÄNDIG enthalten, auch wenn der
    // Suchbegriff selbst länger als `max` ist.
    const to = Math.min(text.length, Math.max(from + max, first ? first[1] : 0))
    const segments = toSegments(text, ranges, from, to)
    if (from > 0) {
        segments.unshift({ text: '…', hit: false })
    }
    if (to < text.length) {
        segments.push({ text: '…', hit: false })
    }
    return segments
}

/**
 * Die Suche selbst: filtern, neueste zuerst, kappen, Anzeigestücke bauen.
 *
 * Bewusst synchron und ohne Entprellung — der Bestand liegt im Speicher, ein Tastendruck
 * kostet einen Durchlauf über einige hundert Zeilen. Eine Entprellung brächte hier keine
 * Ruhe, sondern nur eine Verzögerung, die auch jeder Test aussitzen müsste.
 */
export const searchMessages = <T extends SearchableRow>(
    rows: T[],
    query: string,
    limit = SEARCH_RESULT_LIMIT,
): SearchOutcome<T> => {
    const terms = parseSearchTerms(query)
    if (terms.length === 0) {
        return { searched: rows.length, total: 0, hits: [], capped: false }
    }
    const matched = rows.filter((row) => matchesAllTerms([row.text, row.name], terms))
    matched.sort((a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id))
    const hits = matched.slice(0, limit).map((row) => ({
        ...row,
        segments: snippetSegments(row.text, terms),
        nameSegments: toSegments(row.name, findMatchRanges(row.name, terms)),
    }))
    return { searched: rows.length, total: matched.length, hits, capped: matched.length > hits.length }
}
