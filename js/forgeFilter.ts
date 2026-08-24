/**
 * SORTIERUNG UND SCOPE der Forge-Listen (P6, Schritt 23).
 *
 * Rein: kein welshman, kein Alpine, kein DOM, keine Übersetzung. Testbar mit
 * `node --experimental-strip-types --test packages/einundzwanzig-group/js/forgeFilter.test.ts`.
 *
 * ── Warum beide Auswahlen EINE Datei sind ───────────────────────────────────
 * Sie beantworten dieselbe Frage in zwei Hälften — „welche Zeilen, in welcher
 * Reihenfolge" — und die Fläche zeigt sie als ein Steuerpaar. Getrennt lägen
 * die Rückfall-Regeln (unbekannter Wert → Standard) zweimal da.
 *
 * ── Was hier NICHT steht ────────────────────────────────────────────────────
 * Die Suche. Sie ist ein eigener Vorgang mit eigener Zerlegung
 * (`forgeSearch.ts`, npub→hex, mehrere Begriffe) und wird VOR dieser Sortierung
 * angewandt: erst was gemeint ist, dann in welcher Reihenfolge.
 */

// ── Sortierung ──────────────────────────────────────────────────────────────

/**
 * Drei Werte, und sie bedeuten auf ALLEN drei Listen dasselbe.
 *
 * Ein vierter Wert je Liste („offene Issues" nur bei Repos, „meiste Kommentare"
 * nur bei Vorgängen) wurde verworfen: die Auswahl stünde dann bei jedem
 * Listenwechsel anders da, und ein Wert, der beim Umschalten still verschwindet,
 * ist schlimmer als einer, der fehlt. Drei Werte, die überall tragen.
 *
 * `name` sortiert bei Repos den Repo-Namen und bei Vorgängen den Titel — beides
 * ist „wie das Ding heisst", also derselbe Begriff und keine zwei Bedeutungen
 * unter einem Wort.
 */
export const SORTIERUNGEN = ['aktiv', 'alt', 'name'] as const
export type Sortierung = (typeof SORTIERUNGEN)[number]
export const DEFAULT_SORTIERUNG: Sortierung = 'aktiv'

/**
 * Eine Whitelist, keine Anzeigeliste — dieselbe Bauform wie `readForgeTab`.
 * Ein unbekannter Wert (alter Bookmark, Tippfehler, fremder Client) fällt auf
 * den Standard zurück, statt eine leere Liste zu erzeugen.
 */
export const leseSortierung = (wert: unknown): Sortierung =>
    (SORTIERUNGEN as readonly string[]).includes(String(wert))
        ? (String(wert) as Sortierung)
        : DEFAULT_SORTIERUNG

// ── Scope ───────────────────────────────────────────────────────────────────

/**
 * „Alle / Von mir / Mir zugewiesen".
 *
 * **Nur drei, nicht Buzz' sechs.** Die übrigen (erwähnt mich, ich habe
 * kommentiert, ich bin Reviewer, geschlossen von mir) sind Inventar: sie
 * kosten je eine Zeile in der Auswahl und beantworten eine Frage, die niemand
 * täglich stellt. Wer sie braucht, hat ein anderes Werkzeug.
 *
 * **`zugewiesen` trägt erst seit P1** — davor gab es keine gefalteten
 * Zuweisungen, die Option hätte eine leere Liste geliefert und wie ein Defekt
 * ausgesehen.
 */
export const SCOPES = ['alle', 'von-mir', 'zugewiesen'] as const
export type Scope = (typeof SCOPES)[number]
export const DEFAULT_SCOPE: Scope = 'alle'

export const leseScope = (wert: unknown): Scope =>
    (SCOPES as readonly string[]).includes(String(wert)) ? (String(wert) as Scope) : DEFAULT_SCOPE

// ── Repos ───────────────────────────────────────────────────────────────────

export type SortierbarerRepo = {
    /** Kennung der Zeile — der Tiebreak, damit die Reihenfolge stabil ist. */
    address: string
    name: string
    /** Anzeigename, nach dem `name` sortiert. */
    createdAt: number
    /**
     * Zeitpunkt der letzten Regung. `0`, wenn das Repo seit seiner Ankündigung
     * nichts erlebt hat — dann trägt `createdAt`.
     */
    lastActivityAt?: number
}

/** Wann ist ein Repo „zuletzt aktiv" gewesen? Regung, sonst Ankündigung. */
export const repoRegung = (repo: SortierbarerRepo): number =>
    repo.lastActivityAt && repo.lastActivityAt > 0 ? repo.lastActivityAt : repo.createdAt

/**
 * Vergleich für Namen.
 *
 * `localeCompare` und nicht `<`: Repo-Namen sind Menschentext, und ein reiner
 * Codepoint-Vergleich stellte „Ärger" hinter „Zulu". `undefined` als Locale
 * heisst „die des Laufzeitumgebung" — dieselbe, in der der Nutzer liest.
 */
const nachName = (a: string, b: string): number => a.localeCompare(b, undefined, { sensitivity: 'base' })

/**
 * Sortiert OHNE die Eingabe zu verändern.
 *
 * `[...repos]` statt `repos.sort()`: die Eingabe ist `overview.repos`, also der
 * Bestand selbst. In-place zu sortieren hiesse, die Anzeige-Reihenfolge in den
 * Bestand zu schreiben — und die nächste Ableitung fände eine andere Welt vor.
 *
 * **Jeder Zweig endet mit einem Tiebreak auf `address`.** Ohne ihn ist die
 * Reihenfolge bei gleichem Schlüssel implementierungsabhängig; die Liste
 * springt dann zwischen zwei Renderdurchläufen, ohne dass sich etwas geändert
 * hätte. Dieselbe Regel, die `groupTimeline` mit seinem `id`-Tiebreak befolgt.
 */
export const sortiereRepos = <T extends SortierbarerRepo>(repos: T[], sortierung: Sortierung): T[] => {
    const kopie = [...repos]
    if (sortierung === 'name') {
        return kopie.sort((a, b) => nachName(a.name, b.name) || nachName(a.address, b.address))
    }
    const richtung = sortierung === 'alt' ? 1 : -1

    return kopie.sort(
        (a, b) => (repoRegung(a) - repoRegung(b)) * richtung || nachName(a.address, b.address),
    )
}

// ── Vorgänge (Issues und Pull Requests) ─────────────────────────────────────

export type FilterbarerVorgang = {
    id: string
    title: string
    /** Verfasser, roh und kleingeschrieben. */
    author: string
    /** Die aktuell Zugewiesenen ({@link foldAssignments}), roh und klein. */
    assignees: string[]
    updatedAt: number
}

/**
 * Filtert nach Scope.
 *
 * **Ohne angemeldeten Schlüssel gibt es kein „mir".** Dann liefert diese
 * Funktion unverändert alles zurück, statt eine leere Liste zu erzeugen — die
 * Fläche blendet die Auswahl in dem Fall ohnehin aus (ein Filter, der nichts
 * filtern kann, gehört nicht auf den Schirm). Die Regel steht trotzdem HIER,
 * damit sie auch dann gilt, wenn ein Aufrufer sie vergisst: fail-open ist bei
 * einer reinen ANZEIGE-Auswahl die harmlose Richtung, ein stiller Leerzustand
 * die schädliche.
 *
 * Beide Seiten kleingeschrieben verglichen: ein Pubkey ist hex, und hex ist
 * case-insensitiv. Genau diese Uneinigkeit war F1 aus P5 — dort schrieb der
 * Builder klein und die Faltung verglich byteweise. Hier gibt es nur eine
 * Meinung, und sie steht in dieser Zeile.
 */
export const filtereVorgaenge = <T extends FilterbarerVorgang>(
    items: T[],
    scope: Scope,
    viewer: string,
): T[] => {
    const ich = String(viewer ?? '').toLowerCase()
    if (scope === 'alle' || ich === '') {
        return items
    }
    if (scope === 'von-mir') {
        return items.filter((item) => String(item.author ?? '').toLowerCase() === ich)
    }

    return items.filter((item) => (item.assignees ?? []).some((pk) => String(pk).toLowerCase() === ich))
}

/** Wie {@link sortiereRepos}, mit `id` als Tiebreak und `title` für `name`. */
export const sortiereVorgaenge = <T extends FilterbarerVorgang>(
    items: T[],
    sortierung: Sortierung,
): T[] => {
    const kopie = [...items]
    if (sortierung === 'name') {
        return kopie.sort((a, b) => nachName(a.title, b.title) || nachName(a.id, b.id))
    }
    const richtung = sortierung === 'alt' ? 1 : -1

    return kopie.sort((a, b) => (a.updatedAt - b.updatedAt) * richtung || nachName(a.id, b.id))
}

// ── Der Aktivitätsbalken (Schritt 25) ───────────────────────────────────────

/** Der Zeitraum des Balkens, in Sekunden. Dreissig Tage. */
export const AKTIVITAETS_FENSTER = 30 * 24 * 60 * 60

export type AktivitaetsEreignis = { repoAddress: string; createdAt: number }

export type RepoAktivitaet = {
    /** Ereignisse im Fenster — die Zahl, die neben dem Balken steht. */
    anzahl: number
    /** Jüngstes Ereignis ÜBERHAUPT, auch ausserhalb des Fensters. */
    letzteRegung: number
    /** `anzahl` geteilt durch die des aktivsten Repos, 0…1. */
    anteil: number
}

/**
 * Aktivität je Repository über die letzten dreissig Tage.
 *
 * ── Die Parametrierung, und wer sie entschieden hat ─────────────────────────
 * Dreissig Tage, normalisiert auf das aktivste Repo, mit der absoluten Zahl
 * daneben — Nutzerentscheid vom 2026-08-24, nachdem die Frage im Plan offen
 * lag und nur diesen Schritt blockierte.
 *
 * **Die Normalisierung ist relativ, die Zahl ist absolut, und das ist der
 * Punkt.** Ein voller Balken heisst „hier passiert am meisten", nicht „hier
 * passiert viel" — bei drei Ereignissen im ganzen Workspace ist der volle
 * Balken drei Ereignisse. Deshalb steht die Zahl daneben und nicht darunter:
 * sie ist nicht die Erläuterung des Balkens, sondern seine Bezugsgrösse
 * (und zugleich die Erfüllung von WCAG 1.4.1 — wer den Balken nicht sieht,
 * verliert nichts).
 *
 * ── Eingabe UNGEKAPPT ───────────────────────────────────────────────────────
 * Der Aufrufer muss den vollen `buildActivity`-Ertrag reichen, nicht den auf
 * `ACTIVITY_LIMIT` geschnittenen Strom. Sonst hinge die Zahl an der Länge der
 * Anzeigeliste statt am Bestand — und ein Repo fiele aus dem Balken, weil ein
 * anderes viel gepusht hat.
 */
export const aktivitaetJeRepo = (
    ereignisse: AktivitaetsEreignis[],
    jetzt: number,
    fenster: number = AKTIVITAETS_FENSTER,
): Map<string, RepoAktivitaet> => {
    const ab = jetzt - fenster
    const roh = new Map<string, { anzahl: number; letzteRegung: number }>()
    for (const e of ereignisse) {
        const adresse = e.repoAddress
        if (!adresse) {
            continue
        }
        const stand = roh.get(adresse) ?? { anzahl: 0, letzteRegung: 0 }
        // Ein autorgesetztes `created_at` kann in der Zukunft liegen. Es zählt
        // mit — es ist eine Regung —, aber es verschiebt das Fenster nicht.
        if (e.createdAt >= ab) {
            stand.anzahl += 1
        }
        if (e.createdAt > stand.letzteRegung) {
            stand.letzteRegung = e.createdAt
        }
        roh.set(adresse, stand)
    }
    let hoechste = 0
    for (const stand of roh.values()) {
        if (stand.anzahl > hoechste) {
            hoechste = stand.anzahl
        }
    }

    return new Map(
        [...roh].map(([adresse, stand]) => [
            adresse,
            {
                anzahl: stand.anzahl,
                letzteRegung: stand.letzteRegung,
                anteil: hoechste === 0 ? 0 : stand.anzahl / hoechste,
            },
        ]),
    )
}

/**
 * Lohnt der Balken überhaupt?
 *
 * **Nein, wenn nur ein Repo im Fenster aktiv war** — er wäre dann immer voll
 * und sagte nichts. Ein Vergleichsbild ohne Vergleich ist Dekoration, und
 * Dekoration, die wie ein Messwert aussieht, ist schlimmer als keine.
 * (Nutzerentscheid vom 2026-08-24, mit dem Zeitraum zusammen.)
 */
export const balkenLohnt = (aktivitaet: Map<string, RepoAktivitaet>): boolean =>
    [...aktivitaet.values()].filter((a) => a.anzahl > 0).length > 1
