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

/**
 * The sections. Their order is part of the contract, not an accident.
 *
 * ── The four Portal sections (D6, P4) ──────────────────────────────────────────
 * `meetups` `events` `courses` `lecturers` come from the ONE index the palette loads per
 * session (`portalIndex.ts`) — not from a relay and not per keystroke. They stand AFTER
 * rooms and members and BEFORE the actions: whoever types is usually looking for something
 * he knows (a room, a person); the Portal objects are what he wants to FIND, and the
 * actions stay the last block because they are always the same ones.
 *
 * **`meetups` is NOT the room group `m:`.** That group filters the chat ROOMS of a meetup,
 * this section shows the meetup PAGES of the Portal — two different things with the same
 * word, and exactly why they carry different prefixes (see {@link PORTAL_PREFIX}).
 */
export type PortalSection = 'meetups' | 'events' | 'courses' | 'lecturers'

/**
 * `zusagen` (P5) is NOT a Portal section, although its rows come out of the same index: a
 * Portal row NAVIGATES, a `zusagen` row PUBLISHES — a signed, public, permanent kind 31925.
 * That difference is why it has its own section, is reachable only by asking for it
 * explicitly (see {@link visibleSections}), and never appears in the resting palette.
 */
export type PaletteSection = 'rooms' | 'members' | 'spaces' | PortalSection | 'zusagen' | 'actions'

export const PORTAL_SECTIONS: readonly PortalSection[] = ['meetups', 'events', 'courses', 'lecturers']

export const PALETTE_SECTIONS: readonly PaletteSection[] = [
    'rooms', 'members', 'spaces', ...PORTAL_SECTIONS, 'zusagen', 'actions',
]

/** Does this section come from the Portal index? */
export const isPortalSection = (section: PaletteSection | null): section is PortalSection =>
    section !== null && (PORTAL_SECTIONS as readonly string[]).includes(section)

/**
 * The input prefixes of the Portal sections.
 *
 * ── Why OWN letters and not `m:` ──────────────────────────────────────────────
 * `m:` has narrowed the rail to the meetup ROOMS since its own P4 (`railGroups.SCOPE_PREFIX`),
 * and it must keep doing so: it sits in every head that uses the rail. A second `m:` with a
 * different meaning inside the same grammar would be exactly the drift the head of this file
 * rejects.
 *
 * Free are single letters other than `r` `m` `p` `f` `w` `d` — and TWO letters are out of
 * the question: `parseScope` reads those as a country code (`de:` `at:`), so a `tr:` would
 * silently be a country filter. Hence these four, named after the German words the surface
 * uses:
 *
 *   `o:` Orte (places) — the meetup pages of the Portal
 *   `t:` Termine (dates) — the meetup dates
 *   `k:` Kurse (courses)
 *   `l:` Lehrende (lecturers)
 *
 * The characters are part of the help text (`command-palette.blade.php`), not secret lore.
 */
export const PORTAL_PREFIX: Readonly<Record<string, PortalSection>> = {
    o: 'meetups',
    t: 'events',
    k: 'courses',
    l: 'lecturers',
}

/**
 * The input prefix of the `zusagen` section (P5) — „z" for Zusagen.
 *
 * Its own letter for the same reason the four above have theirs: `t:` lists the dates of the
 * whole association to READ, `z:` lists the dates of the reader's OWN meetups to ANSWER.
 * Same grammar, and the letter is in the help text, not secret lore.
 */
export const RSVP_PREFIX = 'z'

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
    // The Portal sections carry their input prefix as their mark — a character the user can
    // type himself is the best reading aid. No zoo of symbols for four sections.
    meetups: 'o',
    events: 't',
    courses: 'k',
    lecturers: 'l',
    zusagen: RSVP_PREFIX,
    actions: '>',
}

/**
 * Das Zeichen des Workspace-Scopes (`w:`) — die einzige Fläche, die den Relay
 * fragt statt den geladenen Bestand zu filtern (P5, NIP-50). Bewusst ein
 * Lupen-Zeichen und kein Buchstabe: es steht für eine andere ART von Ergebnis,
 * nicht für eine weitere Sektion.
 */
export const WORKSPACE_SIGIL = '⌕'

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

/**
 * Which rail group does the room belong to? Workspace beats the type — **but a
 * conversation beats the workspace.**
 *
 * That exception is not a nicety, it is the condition for `d:` finding anything at all:
 * conversations exist only on Buzz, and Buzz IS the workspace. Without the precedence
 * every conversation counted as a workspace room, `d:` stayed empty for good and
 * `f:`/`w:` mixed channels with conversations. The rail decides the same question the
 * same way — there a conversation never reaches the workspace bucket in the first place,
 * it goes past `groupOf` (`railGroups.buildGroups`).
 */
export const roomGroupKey = (room: PaletteRoom): RailGroupKey =>
    room.workspace === true && room.isDm !== true ? 'workspace' : groupOf(room)

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

    /*
     * The Portal prefixes BEFORE `parseScope`: the grammar is the same shape (`x:`), but
     * these letters belong to this file. Placed after it the branch would never run — an
     * unknown single character falls through `parseScope` as text, and `o:` would be a
     * search for "o:".
     */
    const zusagen = /^\s*([a-zA-Z]):\s*/.exec(text)
    if (zusagen && zusagen[1].toLowerCase() === RSVP_PREFIX) {
        return {
            scope: { section: 'zusagen', group: null, country: '' },
            rest: text.slice(zusagen[0].length),
        }
    }

    const portal = /^\s*([a-zA-Z]):\s*/.exec(text)
    if (portal && PORTAL_PREFIX[portal[1].toLowerCase()]) {
        return {
            scope: { section: PORTAL_PREFIX[portal[1].toLowerCase()], group: null, country: '' },
            rest: text.slice(portal[0].length),
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

/**
 * Steht die Palette im Workspace-Scope (`w:`)?
 *
 * Das ist der eine Scope, der nicht den geladenen Bestand einschränkt, sondern
 * eine ANDERE Quelle aufmacht: die relay-seitige Volltextsuche (NIP-50) über
 * Nachrichten und Profile des Workspace-Relays, plus die Sofort-Treffer aus dem
 * bereits geladenen Bestand. Deshalb steht die Frage hier als eigene Funktion
 * und nicht als `scope.group === 'workspace'` an fünf Stellen.
 */
export const isWorkspaceScope = (scope: PaletteScope): boolean => scope.group === 'workspace'

/** Das Zeichen vor dem Prompt — Workspace-Lupe, sonst Sektion, sonst `#`. */
export const paletteSigil = (scope: PaletteScope): string => {
    if (isWorkspaceScope(scope)) {
        return WORKSPACE_SIGIL
    }

    return scope.section === null ? SECTION_SIGIL.rooms : SECTION_SIGIL[scope.section]
}

/**
 * Der Text, den ein Klick auf eine Sektion ins Feld schriebe. Für Räume ist das
 * zeichengleich das Rail-Token (`m:`, `de:`) — dieselbe Zeichenfolge, die die
 * Rail dem Nutzer bereits beibringt.
 */
export const paletteScopeToken = (scope: PaletteScope): string => {
    if (scope.section === 'members' || scope.section === 'actions') {
        return SECTION_SIGIL[scope.section]
    }
    if (isPortalSection(scope.section) || scope.section === 'zusagen') {
        // The prefix WITH its colon, exactly as it is typed — not the bare mark.
        return SECTION_SIGIL[scope.section] + ':'
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
 *
 * P4: with input it is now all EIGHT sections, because the four Portal ones joined. Each
 * of them caps at twelve rows (`portalIndex.PORTAL_SECTION_LIMIT`) — 312 meetup rows in
 * the DOM would be the same noise three hundred times over, and the selection in front of
 * that cap is made by the index filter, not by Flux.
 */
export const visibleSections = (scope: PaletteScope, query: string): PaletteSection[] => {
    // Der Workspace-Scope erzeugt BEWUSST keine einzige Flux-Option — und das
    // ist kein Sparen, sondern die Bedingung dafür, dass die Enter-Taste dort
    // die Suche auslöst:
    //
    // `ui-select[filter]` aktiviert bei jeder Textänderung wieder die erste
    // sichtbare Option (`flux.js`, `_filterable.onChange` → `activateFirst()`),
    // und `handleKeyboardSelection` klickt sie bei Enter an. Stünde hier auch
    // nur eine Raumzeile, spränge Enter in diesen Raum statt zu suchen. Ohne
    // Optionen bleibt `getActive()` leer, Flux' Handler kehrt nach seinem
    // `preventDefault` sofort zurück, und der eigene Listener am selben Feld
    // kommt zum Zug (`stopPropagation` hält keine Geschwister auf demselben
    // Element auf).
    //
    // Verloren geht dabei nichts: die Workspace-Räume erscheinen in der
    // Trefferliste als Sofort-Treffer — mit besserer Übereinstimmung als Flux'
    // Teilzeichenkette (Diakritika, UND über mehrere Begriffe).
    if (isWorkspaceScope(scope)) {
        return []
    }

    if (scope.section !== null) {
        return [scope.section]
    }

    /*
     * `zusagen` is deliberately NOT in the unscoped result — not when resting and not while
     * typing. Every other section here offers a LINK; this one offers a public, permanent
     * signature, and an Enter that lands on it because the meetup's name happened to match
     * what was typed is one keystroke too few. It appears when it is asked for: through the
     * action „Zusagen", which lifts the `z:` chip, or by typing that chip.
     */
    return query.trim() === ''
        ? ['rooms', 'actions']
        : PALETTE_SECTIONS.filter((section) => section !== 'zusagen')
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
