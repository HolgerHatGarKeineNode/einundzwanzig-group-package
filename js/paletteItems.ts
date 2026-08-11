/**
 * Grammatik und Sektionsschnitt der Befehlspalette — REIN & welshman-frei (wie
 * `railGroups.ts`), damit die Logik ohne Browser-/Store-Runtime testbar bleibt.
 * Relative Imports MIT `.ts`-Endung: die Datei muss aus Vite UND aus
 * `node --test` ladbar sein, und der Node-Test-Runner löst ohne Endung nicht auf
 * (dasselbe Muster wie `publishResult.ts`).
 *
 * ── Eine Grammatik, nicht zwei ──────────────────────────────────────────────
 * Die Suchsprache ist {@link parseScope} aus `railGroups.ts`, unverändert
 * wiederverwendet: `r:` `m:` `p:` `w:` grenzen auf eine Raumgruppe ein, zwei
 * Buchstaben auf ein Land. Die Palette ergänzt genau ZWEI Zeichen — `@` für
 * Mitglieder, `>` für Aktionen — und beide sind Sigel, keine zweite Sprache: sie
 * stehen an derselben Stelle (ganz vorn), werden nach demselben Verfahren in den
 * Chip gehoben und mit demselben Escape wieder gelöst. Ein eigenes `g r`/`g s`-
 * Schema wurde ausdrücklich verworfen; wer `m:` kennt, kennt hier alles.
 *
 * Unbekannte Präfixe bleiben Text — ein `foo:` ist eine Suche nach „foo:", keine
 * stille Filterung auf nichts. Das entscheidet `parseScope`, nicht diese Datei.
 *
 * ── Was hier NICHT passiert ─────────────────────────────────────────────────
 * Es wird **nicht nach Text gefiltert**. Das tut Flux' `ui-select[filter]`
 * (`FilterableGroup.matches` in `flux-pro/dist/flux.js`: NFD-normalisiert,
 * diakritika- und großschreibungsunempfindlich, Teilzeichenkette über
 * `textContent`). Ein zweiter Textabgleich hier wäre eine zweite Wahrheit über
 * dieselbe Frage und liefe irgendwann auseinander. Diese Datei entscheidet nur,
 * WELCHE Zeilen überhaupt entstehen — der Scope und die Rangfolge.
 */

import { groupOf, parseScope, scopeToken, type RailGroupKey, type RailRoom } from './railGroups.ts'

/** Die vier Sektionen. Reihenfolge ist Teil des Vertrags, nicht Zufall. */
export type PaletteSection = 'rooms' | 'members' | 'spaces' | 'actions'

export const PALETTE_SECTIONS: readonly PaletteSection[] = ['rooms', 'members', 'spaces', 'actions']

/**
 * Das Sigel einer Sektion. Es steht an drei Orten für dasselbe: als Präfix im
 * Feld, als Zeichen vor dem Prompt und als Marke vor jeder Zeile ihrer Sektion.
 * `#` und `@` sind Nostr-/Chat-Konvention, `>` ist das Aktions-Sigel aus der
 * Grammatik. `/` für Spaces ist der Pfad-Charakter einer Relay-Adresse — es ist
 * bewusst KEIN Eingabepräfix (die Grammatik kennt keins für Spaces), sondern nur
 * eine Lesehilfe an der Zeile.
 */
export const SECTION_SIGIL: Readonly<Record<PaletteSection, string>> = {
    rooms: '#',
    members: '@',
    spaces: '/',
    actions: '>',
}

/** Der aktive Suchbereich der Palette: Sektion + (bei Räumen) Gruppe und Land. */
export type PaletteScope = {
    section: PaletteSection | null
    group: RailGroupKey | null
    /** ISO-3166-1-alpha-2, GROSS ('' = kein Landfilter). */
    country: string
}

export const EMPTY_PALETTE_SCOPE: PaletteScope = { section: null, group: null, country: '' }

/** Ein Raum in der Palette — ein Rail-Raum plus seine Space-Herkunft. */
export type PaletteRoom = RailRoom & {
    /** Kommt der Raum aus dem Workspace-Relay statt aus dem Heim-Space? */
    workspace?: boolean
    /** Rechtsbündiger Zusatz (Stadt eines Meetups, Workspace-Name) — '' = keiner. */
    hint?: string
}

/** Zu welcher Rail-Gruppe zählt der Raum? Workspace schlägt den Typ. */
export const roomGroupKey = (room: PaletteRoom): RailGroupKey =>
    room.workspace === true ? 'workspace' : groupOf(room)

/**
 * Liest den Scope aus dem Eingabetext und gibt den Rest zurück.
 *
 * Reihenfolge ist bedeutsam: `@`/`>` zuerst, weil sie einzeichig sind und kein
 * `:` tragen — danach entscheidet `parseScope` über die Raum-Präfixe.
 */
export const parsePaletteScope = (text: string): { scope: PaletteScope; rest: string } => {
    const sigil = /^\s*([@>])\s*/.exec(text)
    if (sigil) {
        return {
            scope: { section: sigil[1] === '@' ? 'members' : 'actions', group: null, country: '' },
            rest: text.slice(sigil[0].length),
        }
    }

    const { scope, rest } = parseScope(text)
    if (scope.group === null && scope.country === '') {
        return { scope: { ...EMPTY_PALETTE_SCOPE }, rest: text }
    }

    return { scope: { section: 'rooms', group: scope.group, country: scope.country }, rest }
}

/**
 * Führt einen frisch erkannten Scope mit dem bestehenden zusammen.
 *
 * Ein bereits gesetztes Land soll eine Gruppenangabe überleben: `de:` + später
 * `m:` ergibt „Meetups in Deutschland", nicht „Meetups" (dieselbe Regel wie
 * `rail.liftToken`). `@`/`>` sind dagegen ein Sektionswechsel und ersetzen alles
 * — ein Landfilter über Mitglieder wäre gegenstandslos.
 */
export const mergePaletteScope = (current: PaletteScope, next: PaletteScope): PaletteScope => {
    if (next.section !== 'rooms') {
        return { ...next }
    }

    return {
        section: 'rooms',
        group: next.group ?? current.group,
        country: next.country !== '' ? next.country : current.country,
    }
}

/** Trägt der Scope überhaupt eine Einschränkung? */
export const hasPaletteScope = (scope: PaletteScope): boolean =>
    scope.section !== null || scope.group !== null || scope.country !== ''

/** Das Zeichen vor dem Prompt — folgt der Sektion, sonst `#`. */
export const paletteSigil = (scope: PaletteScope): string =>
    scope.section === null ? SECTION_SIGIL.rooms : SECTION_SIGIL[scope.section]

/**
 * Der Text, den ein Klick auf eine Sektion ins Feld schriebe. Für Räume ist das
 * zeichengleich das Rail-Token (`m:`, `de:`) — dieselbe Zeichenfolge, die die
 * Rail dem Nutzer bereits beibringt.
 */
export const paletteScopeToken = (scope: PaletteScope): string => {
    if (scope.section === 'members' || scope.section === 'actions') {
        return SECTION_SIGIL[scope.section]
    }

    return scopeToken({ group: scope.group, country: scope.country })
}

/**
 * Welche Sektionen entstehen?
 *
 * Ohne Eingabe und ohne Scope: Räume und Aktionen — die Palette ist **nie leer**,
 * sie öffnet mit den zuletzt benutzten Räumen und dem, was man tun kann. Mit
 * Eingabe alle vier. Mit Scope genau die eine, die adressiert wurde.
 *
 * Dass Mitglieder und Spaces erst mit Eingabe erscheinen, ist kein Sparzwang,
 * sondern die Antwort auf „was hilft im Ruhezustand": eine alphabetische
 * Mitgliederliste beim Öffnen wäre Rauschen vor der ersten Taste — und sie kostet
 * dann auch keine hundert Zeilen im DOM.
 */
export const visibleSections = (scope: PaletteScope, query: string): PaletteSection[] => {
    if (scope.section !== null) {
        return [scope.section]
    }

    return query.trim() === '' ? ['rooms', 'actions'] : [...PALETTE_SECTIONS]
}

const nameOf = (room: RailRoom): string => (room.name || room.h).toLocaleLowerCase()

const byName = (a: RailRoom, b: RailRoom): number => nameOf(a).localeCompare(nameOf(b))

/** Jüngste Aktivität zuerst; Räume ohne bekannte Aktivität ans Ende. */
const byActivity = (a: RailRoom, b: RailRoom): number =>
    (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0) || byName(a, b)

/**
 * Die zuletzt benutzten Räume — der Ruhezustand der Palette.
 *
 * Beigetretene zuerst (dort war der Nutzer wirklich), innerhalb dessen nach
 * jüngster Aktivität. Reicht die Zahl nicht, füllen entdeckbare Räume auf: eine
 * halbleere Liste beim Öffnen wäre schlechter als eine, die etwas anbietet.
 */
export const recentRooms = <T extends RailRoom>(rooms: T[], limit = 5): T[] => {
    const joined = rooms.filter((r) => r.joined).sort(byActivity)
    const rest = rooms.filter((r) => !r.joined).sort(byActivity)

    return [...joined, ...rest].slice(0, limit)
}

/**
 * Die Räume, die der Scope übrig lässt — ungekappt.
 *
 * **Bewusst ohne Kappung** (die Rail kappt bei zwölf): dort ist die Liste die
 * Übersicht, hier ist sie die Trefferliste einer Suche. Was gekappt wäre, wäre
 * unauffindbar — und die Kappung würde ausgerechnet dann greifen, wenn Flux
 * gleich darauf alles bis auf einen Treffer ausblendet.
 */
export const scopedRooms = <T extends PaletteRoom>(
    rooms: T[],
    scope: PaletteScope,
    countryOf: (room: T) => string = () => '',
): T[] => {
    if (scope.section !== null && scope.section !== 'rooms') {
        return []
    }

    let out = rooms
    if (scope.country !== '') {
        out = out.filter((r) => countryOf(r) === scope.country)
    }
    if (scope.group !== null) {
        out = out.filter((r) => roomGroupKey(r) === scope.group)
    }

    const joined = out.filter((r) => r.joined).sort(byName)
    const others = out.filter((r) => !r.joined).sort(byName)

    return [...joined, ...others]
}

/**
 * Steht der Fokus in einem Feld, in dem Zeichen ankommen sollen?
 *
 * Das ist die Bedingung, unter der `?` NICHT die Hilfe öffnet — sonst kann
 * niemand mehr ein Fragezeichen tippen. `SELECT` zählt mit: dort läuft die
 * Typeahead-Auswahl über Tastendrücke.
 *
 * Nimmt eine Form statt eines `Element`, damit die Regel ohne DOM prüfbar bleibt.
 */
export type FocusTarget = { tagName?: string; type?: string; isContentEditable?: boolean } | null

const TEXT_INPUT_TYPES = new Set([
    'text', 'search', 'email', 'url', 'tel', 'password', 'number',
    'date', 'datetime-local', 'month', 'time', 'week',
])

export const isTextEntry = (el: FocusTarget): boolean => {
    if (!el) {
        return false
    }
    if (el.isContentEditable === true) {
        return true
    }
    const tag = (el.tagName ?? '').toUpperCase()
    if (tag === 'TEXTAREA' || tag === 'SELECT') {
        return true
    }
    if (tag !== 'INPUT') {
        return false
    }

    return TEXT_INPUT_TYPES.has((el.type ?? 'text').toLowerCase())
}
