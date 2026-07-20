/**
 * Raum-Kategorien & Zusatz-Tags — REIN & welshman-frei (wie `relayCaps.ts` und
 * `meetupPresentation.ts`), damit die Logik ohne Browser-/Store-Runtime testbar
 * bleibt (`roomCategories.test.ts`). KEINE relativen Imports — sonst laeuft der
 * Node-Test-Runner nicht mehr (Vite-Style-Imports ohne Endung).
 *
 * Zwei Dinge leben hier:
 *
 * 1. Die Kategorie „Projektunterstuetzung": Das Vereins-Portal legt pro Antrag
 *    einen privaten NIP-29-Raum an (`private`+`closed`+`hidden`, Raum-ID
 *    `p<12 hex>`) und markiert ihn im 39000 mit `["t","project-support"]` plus
 *    dem stabilen Bindungs-Tag `["i","proposal:<antrags-id>"]` — exakt analog zu
 *    `["t","meetup"]` / `["i","meetup:<id>"]`. Die Raum-ID selbst wird NICHT
 *    ausgewertet (das `m`-Praefix der Meetups wird es auch nicht); allein der
 *    Marker entscheidet.
 *
 * 2. `withExtraTags` — der Anhaenge-Schritt fuer beliebige Zusatz-Tags an ein
 *    von welshmans `makeRoomEditEvent` gebautes 9002. welshman baut die Tag-Liste
 *    abschliessend aus den bekannten Feldern; eigene Marker kommen dort nicht
 *    rein. `makeRoomEditEvent` wird NICHT gepatcht (node_modules), die Tags
 *    werden danach ergaenzt.
 *
 * Warum ein eigenes Modul statt `meetupPresentation.ts` zu erweitern:
 * - `meetupPresentation.ts` ist per Doc/Name der Praesentations-JOIN gegen die
 *   Portal-Meetup-Liste (API-URL, Flagge, Deep-Link, naechster Termin).
 *   Projektunterstuetzungen haben keinen solchen Join — sie dort einzuquartieren
 *   waere eine Fehlbenennung.
 * - Die Meetup-Raeume laufen produktiv. Ein Modul, das nicht angefasst wird,
 *   kann auch nicht brechen: Regressionsfreiheit vor Bequemlichkeit.
 */

/** Marker-Tagwert der Kategorie „Projektunterstuetzung" (`["t", …]`). */
export const PROJECT_SUPPORT_MARKER = 'project-support'

/** Praefix des stabilen Bindungs-Tags (`["i","proposal:<antrags-id>"]`). */
export const PROPOSAL_ID_PREFIX = 'proposal:'

/** Marker/Bindungs-Tags der Kategorie, aus `room.event.tags` gehoben. */
export type ProjectSupportTags = {
    /** Traegt das 39000 den `["t","project-support"]`-Marker? */
    isProjectSupport: boolean
    /** Stabile Antrags-id aus `["i","proposal:<id>"]` ('' wenn keine). */
    proposalId: string
}

/**
 * Hebt die Projektunterstuetzungs-Felder aus den ROH-Tags eines 39000
 * (`room.event.tags`). welshmans `readRoomMeta` liest diese Custom-Tags NICHT —
 * daher hier selbst, wie bei `parseMeetupTags`.
 */
export const parseProjectSupportTags = (tags: string[][]): ProjectSupportTags => {
    let isProjectSupport = false
    let proposalId = ''
    for (const tag of tags) {
        if (tag[0] === 't' && tag[1] === PROJECT_SUPPORT_MARKER) {
            isProjectSupport = true
        } else if (tag[0] === 'i' && typeof tag[1] === 'string' && tag[1].startsWith(PROPOSAL_ID_PREFIX)) {
            proposalId = tag[1].slice(PROPOSAL_ID_PREFIX.length)
        }
    }
    return { isProjectSupport, proposalId }
}

/**
 * Die Zusatz-Tags, mit denen ein Antragsraum beim Anlegen markiert wird —
 * als `RoomInput.extraTags` an `createRoom` zu uebergeben. Ohne Antrags-id
 * bleibt es beim reinen Kategorie-Marker (der Raum ist dann zwar kategorisiert,
 * aber an keinen Antrag gebunden).
 */
export const projectSupportTags = (proposalId: string | number = ''): string[][] => {
    const id = String(proposalId ?? '').trim()
    const tags: string[][] = [['t', PROJECT_SUPPORT_MARKER]]
    if (id) {
        tags.push(['i', `${PROPOSAL_ID_PREFIX}${id}`])
    }
    return tags
}

/** Das Minimum an Kategorie-Flags, ueber das die Raumlisten filtern. */
export type RoomCategoryFlags = {
    isMeetup?: boolean
    isProjectSupport?: boolean
}

/**
 * Gehoert der Raum in die Liste der ENTDECKBAREN Standard-Raeume? Kategorisierte
 * Raeume (Meetup, Projektunterstuetzung) haben dort nichts verloren — sie leben
 * in ihrem eigenen Pool bzw. sind (Antragsraeume) ohnehin `hidden`.
 *
 * ACHTUNG — nur auf `otherRooms` anwenden, NIE auf `userRooms`: Wer Mitglied
 * eines Antrags-/Meetup-Raums ist, muss ihn in „Meine Raeume" weiter finden und
 * betreten koennen. Kategorisieren heisst nicht verstecken.
 */
export const isStandardRoom = (room: RoomCategoryFlags): boolean =>
    !room.isMeetup && !room.isProjectSupport

/**
 * Haengt Zusatz-Tags an ein bereits gebautes Event an (typisch: das 9002 aus
 * welshmans `makeRoomEditEvent`) und gibt das ERGEBNIS zurueck.
 *
 * Invarianten — beides ist in `roomCategories.test.ts` festgenagelt:
 * - Ohne (bzw. mit leeren) `extraTags` wird das Event UNVERAENDERT und IDENTISCH
 *   zurueckgegeben (dieselbe Referenz) → das heutige Verhalten aller Aufrufer
 *   ist byte-gleich, nicht nur „gleichwertig".
 * - Keine Duplikate: ein Zusatz-Tag, dessen Name+Wert schon in `event.tags`
 *   steht, wird uebersprungen. Das ist der Fall beim EDIT eines bereits
 *   markierten Raums — `makeRoomEditEvent` kopiert die Tags des vorhandenen
 *   39000 mit (Tag-Erhalt), der Marker ist also schon da.
 *
 * Die Dedup-Regel ist Name+Wert (Mengen-Semantik), nicht nur Name: `t` und `i`
 * sind Mehrfach-Tags. Ein Meetup-`["i","meetup:42"]` und ein
 * `["i","proposal:7"]` koennen so nebeneinander stehen, ohne sich zu verdraengen.
 */
export const withExtraTags = <T extends { tags: string[][] }>(event: T, extraTags?: string[][]): T => {
    if (!extraTags || extraTags.length === 0) {
        return event
    }
    const tags = [...event.tags]
    let added = false
    for (const tag of extraTags) {
        if (!Array.isArray(tag) || !tag[0]) {
            continue
        }
        if (tags.some((t) => t[0] === tag[0] && t[1] === tag[1])) {
            continue
        }
        tags.push(tag)
        added = true
    }
    return added ? { ...event, tags } : event
}
