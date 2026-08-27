/**
 * P7 — die **Relay-Filter** der Forge: was für welche Fläche angefragt wird.
 *
 * Rein: kein welshman, kein Store, kein Netz, relative Importe mit `.ts` — damit
 * `node --experimental-strip-types --test forgeAbfragen.test.ts` das Modul lädt.
 * Bis P7 standen diese Filter als private Konstanten in `forge.ts`; dort waren
 * sie **nicht prüfbar**, weil `forge.ts` beim Modulladen welshman anfasst. Genau
 * deshalb ist der Fehler unten so lange unbemerkt geblieben.
 *
 * ── Warum ein Repo seinen eigenen Deckel braucht ────────────────────────────
 *
 * `limit` gilt in NIP-01 **je Filter**, nicht je Tag-Wert. Ein Filter
 * `{kinds:[1621], "#a":[repoA, repoB], limit:200}` liefert also die 200
 * jüngsten Issues **beider** Repos zusammen — nicht 200 je Repo. Wer damit eine
 * Repo-Detailseite füllt, zeigt dort ein unvollständiges Bild, sobald ein
 * ANDERES Repo aktiver ist: die 200 jüngsten Ereignisse können sämtlich dem
 * Nachbarn gehören. Nichts daran ist sichtbar — die Liste ist kürzer, sonst
 * nichts.
 *
 * Deshalb zwei Zuschnitte statt eines:
 *
 * - {@link contentFilters} — der Workspace-Blick der Übersicht. Ein geteiltes
 *   Budget ist dort die richtige Antwort: die Fläche zeigt ausdrücklich „alles
 *   zusammen" und trägt den `truncated`-Hinweis, wenn genau am Deckel angekommen
 *   wird.
 * - {@link repoContentFilters} — der Blick EINER Repo-Seite. Das Budget gehört
 *   diesem Repo allein, und keine fremde Aktivität kann es aufbrauchen.
 *
 * Der Preis ist ehrlich zu nennen: die Detailseite fragt damit ein zweites Mal
 * nach Ereignissen, die die Übersicht eventuell schon geholt hat. Das kostet
 * sechs Subscriptions von `max_subscriptions: 1024` und eine Antwort, die der
 * `repository` ohnehin entdoppelt — gegen eine Liste, die still zu kurz ist, ist
 * das billig.
 */
import {
    DELETION,
    FORGE_COMMENT,
    GIT_ISSUE,
    GIT_PATCH,
    GIT_PR_UPDATE,
    GIT_PULL_REQUEST,
    GIT_STATUS_KINDS,
    PROJECT_ANNOUNCEMENT,
    REPO_ANNOUNCEMENT,
    REPO_STATE,
} from './forgeModels.ts'

/**
 * Ein Relay-Filter nach NIP-01 — **strukturell**, nicht aus welshman importiert.
 *
 * Zeichengleich mit `Filter` aus `@welshman/util` (`util/src/Filters.d.ts`),
 * inklusive der **nicht** optionalen Index-Signatur: nur so sind beide Typen in
 * beide Richtungen zuweisbar und `forge.ts` kann diese Filter unverändert an
 * `load()` weiterreichen. Ein `import type` wäre kürzer, zöge aber die
 * welshman-Typen in ein Modul, das ohne sie prüfbar bleiben soll — dieselbe
 * Entscheidung wie bei `ForgeEvent` gegen `TrustedEvent` in `forgeModels.ts`.
 */
export type RelayFilter = {
    ids?: string[]
    kinds?: number[]
    authors?: string[]
    since?: number
    until?: number
    limit?: number
    search?: string
    [key: `#${string}`]: string[]
}

// ── Grenzen ─────────────────────────────────────────────────────────────────

/** Obergrenze der Bestandslisten. Buzz deckelt selbst auf `max_limit: 1000`. */
export const FORGE_LIST_LIMIT = 500
/**
 * Obergrenze für Issues, Patches und PRs — **je Filter**, siehe Modulkopf.
 *
 * Auf der Übersicht heißt das „je Kind über alle Repos zusammen", auf einer
 * Repo-Seite „je Kind für dieses eine Repo". Dieselbe Zahl, zwei Zuschnitte.
 */
export const FORGE_ROOT_LIMIT = 200
/** Höchstzahl `#a`-Werte je Grabstein-Anfrage. */
export const TOMBSTONE_CHUNK = 100

// ── Filter ──────────────────────────────────────────────────────────────────

/** Repos, Projekte und Branch-Zustände — der Bestand der Übersichtsseite. */
export const overviewFilters = (relaySelf: string): RelayFilter[] => [
    { kinds: [REPO_ANNOUNCEMENT], limit: FORGE_LIST_LIMIT },
    { kinds: [PROJECT_ANNOUNCEMENT], limit: FORGE_LIST_LIMIT },
    // Der `authors`-Filter ist hier die eigentliche Aussage: siehe Eigenheit 1
    // im Kopf von `forge.ts`. Ohne bekanntes `self` bleibt er weg — dann liefert
    // der Relay alle 30618 und `foldRepoState` sortiert die unberechtigten
    // selbst aus.
    relaySelf
        ? { kinds: [REPO_STATE], authors: [relaySelf], limit: FORGE_LIST_LIMIT }
        : { kinds: [REPO_STATE], limit: FORGE_LIST_LIMIT },
]

/**
 * Issues, PRs, PR-Updates, Statuswechsel und Kommentare zu gegebenen Repos.
 *
 * Je Kind ein eigener Filter statt eines gemeinsamen: `limit` gilt je Filter,
 * und ein geteiltes Budget liesse die eine Art die andere verdrängen (P5,
 * 2026-08-23, für 1617). Über die Repos hinweg wird das Budget dagegen
 * ausdrücklich geteilt — siehe {@link repoContentFilters} für den Gegenzuschnitt.
 */
export const contentFilters = (addresses: string[]): RelayFilter[] =>
    addresses.length === 0
        ? []
        : [
              { kinds: [GIT_ISSUE], '#a': addresses, limit: FORGE_ROOT_LIMIT },
              { kinds: [GIT_PATCH], '#a': addresses, limit: FORGE_ROOT_LIMIT },
              { kinds: [GIT_PULL_REQUEST], '#a': addresses, limit: FORGE_ROOT_LIMIT },
              { kinds: [GIT_PR_UPDATE], '#a': addresses, limit: FORGE_LIST_LIMIT },
              { kinds: [...GIT_STATUS_KINDS], '#a': addresses, limit: FORGE_LIST_LIMIT },
              // Eigenheit 2: kind 1, nicht 1111.
              { kinds: [FORGE_COMMENT], '#a': addresses, limit: FORGE_LIST_LIMIT },
          ]

/**
 * Dieselben Filter für **genau ein** Repo — der Zuschnitt der Detailseite.
 *
 * Dass hier `contentFilters` mit einer einelementigen Liste aufgerufen wird, ist
 * die ganze Änderung und zugleich der ganze Punkt: es gibt keine zweite
 * Filterliste, die auseinanderlaufen könnte. Was sich ändert, ist **wer sich das
 * Budget teilt** — auf dieser Fläche niemand.
 *
 * Eine leere Adresse ergibt eine leere Filterliste, nicht einen Filter mit
 * leerem `#a`: letzterer fände am Relay nichts und sähe wie ein leeres Repo aus.
 */
export const repoContentFilters = (address: string): RelayFilter[] =>
    address === '' ? [] : contentFilters([address])

/** Grabsteine, gescopet über `#a` (Eigenheit 3 im Kopf von `forge.ts`). */
export const tombstoneFilters = (addresses: string[]): RelayFilter[] => {
    const filters: RelayFilter[] = []
    for (let i = 0; i < addresses.length; i += TOMBSTONE_CHUNK) {
        filters.push({ kinds: [DELETION], '#a': addresses.slice(i, i + TOMBSTONE_CHUNK) })
    }

    return filters
}
