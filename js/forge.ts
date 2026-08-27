/**
 * P6 — die Forge am Workspace: Netz, Ableitungen und die beiden Alpine-Inseln.
 *
 * Gegenstück zu den reinen Modulen `forgeModels.ts` (Faltung) und
 * `forgeActivity.ts` (Zeitleiste). Dieselbe Aufteilung wie
 * `longform.ts`/`longformFeed.ts` und `search.ts`/`roomSearch.ts`: alles, was ein
 * Relay, den `repository` oder einen Store braucht, steht hier — alles, was
 * unter `node --test` prüfbar sein muss, dort.
 *
 * ── Die Quelle ist AUSSCHLIESSLICH der Workspace ────────────────────────────
 *
 * Jede Anfrage trägt ein explizites `relays: [WORKSPACE_URL]` und jede Ableitung
 * bindet über {@link deriveEventsForUrl} an die **Herkunfts-URL** (via
 * `tracker`). Der `repository` ist geteilt: ein reiner `{kinds:[1]}`-Filter über
 * den Store fischte sonst jede Chat-Antwort des zooid-Space als
 * „Issue-Kommentar" ein. Dieselbe Regel wie in `longformFeed.ts`.
 *
 * ── Vier gemessene Eigenheiten, die den Aufbau bestimmen ────────────────────
 *
 * 1. **Der Branch-Zustand ist RELAY-signiert.** Alle drei 30618 am Ziel-Relay
 *    tragen den Pubkey aus dem NIP-11-Feld `self`, keines den des Eigentümers
 *    (gemessen 2026-08-17). Ohne `relaySelf` im `authors`-Filter ist die
 *    Branch-Anzeige leer — und zwar still. `self`, **nicht** `pubkey`: Buzz
 *    liefert `pubkey: null` (ebenfalls am Ziel-Relay abgefragt).
 * 2. **Kommentare sind kind 1.** NIP-22 (1111) ist am Relay nicht registriert.
 * 3. **Grabsteine werden beim LADEN über `#a`/`#e` gescopet**, in Blöcken zu
 *    höchstens 100 Werten. Ein unscoped `{kinds:[5]}` zöge dort die gesamte
 *    Löschhistorie der Community — dieselbe Vorsicht wie in Buzz'
 *    `projectEnumeration.ts:117-150`. Im **Live-Abo** gilt das nicht: `limit: 0`
 *    überspringt bei Buzz die gespeicherte Abfrage ganz. Siehe
 *    {@link liveTombstoneFilter}.
 * 4. **Keine Boundary-Bucket-Paginierung.** Buzz braucht Vollständigkeit, weil
 *    seine Push-Policy daran hängt; eine Leseliste nicht. Statt dessen
 *    `limit:500` und ein **ehrlicher Hinweis**, wenn genau so viele Ereignisse
 *    ankamen ({@link ForgeOverview.truncated}) — eine stillschweigend gekürzte
 *    Liste ist eine falsche Aussage über den Bestand.
 */
import { deriveRelay, pubkey, repository, tracker } from '@welshman/app'
import { load, request } from '@welshman/net'
import { throttled } from '@welshman/store'
import type { Filter, TrustedEvent } from '@welshman/util'
import { displayProfileByPubkey, profilesByPubkey } from './spaceProfiles.ts'
import * as nip19 from 'nostr-tools/nip19'
import { derived, readable, writable, type Readable } from 'svelte/store'
import { proxifyImage, storageReady } from './core.ts'
import { t } from './i18n.ts'
import { toast } from './toast.ts'
import { formatNumber, formatTimestamp } from './locale.ts'
import { warmProfiles } from './profiles.ts'
import { deriveEventsForUrl } from './repository.ts'
import { roomsByUrl } from './groups.ts'
import { normalizeRelayUrl } from '@welshman/util'
import { deriveSpaceDirectory, loadMemberProfiles, loadSpaceDirectory, watchSpaceDirectory, type DirectoryView } from './members.ts'
import { deriveAgentDirectory, listenAgentDirectory, type AgentDirectoryView } from './agentDirectory.ts'
import { agentMentionItems, mergeMentionItems, type MentionItemLike } from './agentDirectoryData.ts'
import { mentionInsert } from './interactions.ts'
import { mentionQueryAt, spliceMention } from './mentionCompose.ts'
import { wakeMentionedAgents, type WakeResult } from './forgeWake.ts'
import { WORKSPACE_URL, deriveSpaceKind, type SpaceKind } from './spaceCaps.ts'
import { DEFAULT_FORGE_TAB, FORGE_TAB_PARAM, readForgeTab } from './forgeTab.ts'
import {
    type Scope,
    type Sortierung,
    aktivitaetJeRepo,
    balkenLohnt,
    filtereVorgaenge,
    leseScope,
    leseSortierung,
    sortiereRepos,
    sortiereVorgaenge,
} from './forgeFilter.ts'
import { HEX64, vorgangPath, type VorgangArt } from './forgeVorgang.ts'
import { anlegeForm, type AnlegeForm } from './forgeAnlegen.ts'
// Die xl-Schwelle kommt aus `viewport.ts` und wird hier NICHT als drittes Literal
// wiederholt. Der Modulkopf dort führt aus, warum sie schon zweimal steht (CSS und
// Store) und dass ein auseinanderlaufendes Paar ein stiller Fehler wäre — ein
// drittes Paar wäre derselbe Fehler noch einmal.
import { DESKTOP_QUERY, type ViewportForm as ForgeForm } from './viewport.ts'
import { buildActivity, type ActivityItem } from './forgeActivity.ts'
import {
    EMPTY_DIFF,
    diffStat,
    parseUnifiedDiff,
    patchBody,
    type DiffStat,
    type ParsedDiff,
} from './forgeDiff.ts'
// Rein und ohne Netz: WOHER der Diff eines Pull Requests käme, und wann gar
// nicht. Das Holen selbst steht im lazy geladenen `gitBrowser.ts`.
import { baueDiff, prDiffQuelle, type PrDiffQuelle } from './forgePrDiff.ts'
import type { PrDiffFehler } from './gitBrowser.ts'
import { filterRepos, sucheVorgaenge } from './forgeSearch.ts'
import {
    FORGE_LIST_LIMIT,
    FORGE_ROOT_LIMIT,
    TOMBSTONE_CHUNK,
    contentFilters,
    overviewFilters,
    repoContentFilters,
    tombstoneFilters,
} from './forgeAbfragen.ts'
// NUR die REINEN Helfer statisch — `gitBrowser.ts` wird dynamisch geladen,
// sonst läge `isomorphic-git` (84 kB gzip) im Chunk, den jede Seite zieht.
import {
    dateiArt,
    findeReadme,
    groesse,
    krumelspur,
    kuerzeZeilen,
    sortiereEintraege,
    verbinde,
    bildMime,
    elternPfad,
    type BaumEintrag,
    type DateiArt,
    istEigenerHost,
    istMarkdown,
    ordneFehlerEin,
    waehleCloneUrl,
    type Fortschritt,
    type KlonFehler,
} from './gitReadme.ts'
import {
    groupTimeline,
    timelineFullLabel,
    timelineTimeLabel,
    type TimelineGroup,
} from './forgeTimeline.ts'
import type { ForgeNavProject, ForgeNavRepo } from './railForge.ts'
import {
    DELETION,
    FORGE_COMMENT,
    GIT_ISSUE,
    GIT_PR_UPDATE,
    GIT_PULL_REQUEST,
    GIT_STATUS_KINDS,
    PROJECT_ANNOUNCEMENT,
    REPO_ANNOUNCEMENT,
    REPO_STATE,
    GIT_PATCH,
    buildIssues,
    buildPatches,
    buildProjects,
    buildPullRequests,
    buildRepos,
    foldRepoState,
    gruppiereNachRepo,
    kurzeCommits,
    isPubkey,
    maintainerLookupFor,
    repoAddressOf,
    shortCommitId,
    reviewerRows,
    truncatedLists,
    unclaimedRepos,
    verwandteRepos,
    type ForgeEvent,
    type Issue,
    type MergeInfo,
    type Patch,
    type Project,
    type PullRequest,
    type Repo,
    type RepoGruppe,
    type ReviewerRow,
    type RepoState,
} from './forgeModels.ts'
import {
    WRITABLE_ISSUE_STATUSES,
    commentDraftProblem,
    issueDraftProblem,
    approveGate,
    assignGate,
    canAssignOthers,
    memberGate,
    orphanedPending,
    pendingState,
    statusGate,
    type DraftProblem,
    type PendingWrite,
    type WritableIssueStatus,
    type WriteGate,
} from './forgeWriteModels.ts'
import {
    clearPending,
    dismissPending,
    forgePending,
    isBusy,
    publishAssignment,
    publishForgeComment,
    publishIssue,
    publishIssueStatus,
    publishReview,
} from './forgeWrite.ts'

// ── Grenzen ─────────────────────────────────────────────────────────────────

/**
 * Die Deckel und die Relay-Filter liegen seit P7 in `forgeAbfragen.ts` — rein
 * und damit prüfbar. Hier bleiben sie als Re-Export stehen, weil sie zur
 * Aussenseite dieser Datei gehören; die Definition steht genau einmal.
 */
export { FORGE_LIST_LIMIT, FORGE_ROOT_LIMIT, TOMBSTONE_CHUNK } from './forgeAbfragen.ts'
/** Wie viele Zeilen die Zeitleiste höchstens zeigt (wie im Referenzclient: 30). */
export const ACTIVITY_LIMIT = 50

// ── `naddr` ─────────────────────────────────────────────────────────────────

/**
 * `naddr` eines Repos — die Kennung in der URL.
 *
 * Wie beim Artikel (`longform.ts`, `articleSnippet`) und aus demselben Grund: ein 30617 ist
 * ersetzbar, seine Event-Id wechselt mit jeder Neuankündigung. Kind + Autor +
 * `d` bleiben und funktionieren auch in einem fremden Client.
 */
export const naddrForRepo = (owner: string, dtag: string, relays: string[] = []): string =>
    nip19.naddrEncode({ kind: REPO_ANNOUNCEMENT, pubkey: owner, identifier: dtag, relays })

/** `naddr` → `{owner, dtag}`, oder `null` bei allem, was nicht passt. */
export const decodeRepoNaddr = (naddr: string): { owner: string; dtag: string } | null => {
    try {
        const decoded = nip19.decode(naddr)
        if (decoded.type !== 'naddr' || decoded.data.kind !== REPO_ANNOUNCEMENT) {
            return null
        }

        return { owner: decoded.data.pubkey.toLowerCase(), dtag: decoded.data.identifier }
    } catch {
        return null
    }
}

// ── Filter ──────────────────────────────────────────────────────────────────
//
// Die Relay-Filter selbst stehen seit P7 in `forgeAbfragen.ts` — rein, ohne
// welshman und damit unter `node --test` prüfbar. Hier stand bis dahin nur EIN
// Zuschnitt (`contentFilters` über alle Repo-Adressen), und die Detailseite
// benutzte ihn mit: ein Repo konnte auf seiner eigenen Seite Issues fehlen
// sehen, weil ein anderes das gemeinsame `limit` aufgebraucht hatte. Der
// repo-gescopte Gegenzuschnitt ist `repoContentFilters`.

/**
 * Der lokale Filter über den geteilten `repository`.
 *
 * Bewusst OHNE `#a` **und ohne `limit`**: was hier hereinkommt, wurde vorher
 * gezielt vom Workspace geladen, und die Faltung ignoriert Grabsteine auf fremde
 * Koordinaten von selbst. Ein `#a`-Filter müsste die Adressliste kennen, die er
 * selbst erst erzeugt; ein `limit` schnitte die Ableitung an einer anderen
 * Stelle ab als das Netz und machte aus einem vollständigen Bestand still eine
 * gekürzte Liste.
 */
const ALL_FORGE_KINDS = [
    REPO_ANNOUNCEMENT,
    REPO_STATE,
    PROJECT_ANNOUNCEMENT,
    GIT_ISSUE,
    GIT_PATCH,
    GIT_PULL_REQUEST,
    GIT_PR_UPDATE,
    ...GIT_STATUS_KINDS,
    FORGE_COMMENT,
    DELETION,
]

// ── Ableitung ───────────────────────────────────────────────────────────────

/** Der relay-eigene Pubkey aus NIP-11 (`self`), `''` solange unbekannt. */
export const deriveRelaySelf = (url: string): Readable<string> =>
    derived(deriveRelay(url), (relay) => (relay as { self?: string } | undefined)?.self ?? '')

/** Eine Zeile der Repo-Liste, anzeigefertig. */
export type RepoRow = Repo & {
    /** `naddr` für die Detail-Route. */
    naddr: string
    ownerName: string
    dateLabel: string
    /** Branch-Zustand aus 30618 — `null`, wenn keiner vorliegt. */
    state: RepoState | null
    issueCount: number
    pullRequestCount: number
    /** Wie viele 1617 auf dieses Repo zeigen. Seit P5 (2026-08-23). */
    patchCount: number
    /**
     * Die Maintainer mit aufgelöstem Namen und Bild.
     *
     * Getrennt von `maintainers` (den rohen Pubkeys), weil die Fläche Menschen
     * zeigt und keine Hex-Ketten — und weil ein `x-for` über die rohen Schlüssel
     * die Initiale aus einer Hex-Ziffer bilden würde.
     */
    people: { pubkey: string; name: string; picture: string }[]
    /** Ereignisse der letzten dreissig Tage — die Zahl neben dem Balken (P6). */
    activityCount: number
    /** Dieselbe Zahl, geteilt durch die des aktivsten Repos: die Balkenlänge. */
    activityShare: number
    /** Jüngste Regung ÜBERHAUPT — Schlüssel der Sortierung „Zuletzt aktiv". */
    lastActivityAt: number
}

export type ProjectRow = Project & {
    ownerName: string
    dateLabel: string
    repoNaddrs: { naddr: string; name: string }[]
}

/** Die vier Kacheln über der Liste. Eine `0` ist eine Aussage, keine Leere. */
export type ForgeCounts = {
    projects: number
    repos: number
    pullRequests: number
    issues: number
    /**
     * Patches (kind 1617). Seit P5 (2026-08-23).
     *
     * Die Zustandszeile zeigt sie **nur, wenn es welche gibt** — anders als bei
     * Repos, Issues und PRs, wo eine `0` eine Aussage ist („noch keine"). Ein
     * Patch ist ein Werkzeug fuer Werkzeugleute: viele Workspaces arbeiten nur
     * mit Pull Requests und werden nie ein 1617 sehen. Eine dauerhafte `0` waere
     * dort kein Befund, sondern eine Spalte, die nie etwas sagt.
     */
    patches: number
}

/**
 * Eine Zeile der workspace-weiten Vorgangslisten (P3).
 *
 * **Bewusst schmaler als `IssueRow`/`PullRequestRow`.** Diese Liste beantwortet
 * „was liegt insgesamt offen und wo" — sie zeigt keinen Rumpf, keine Kommentare
 * und keinen gerenderten Markdown. Das ist nicht Sparsamkeit: `renderMarkdown`
 * über alle Vorgänge ALLER Repos liefe bei jedem Emit der Ableitung, und die
 * Antwort auf die Frage dieser Fläche steht im Titel.
 */
export type VorgangRow = {
    id: string
    title: string
    status: string
    statusLabel: string
    authorName: string
    timeLabel: string
    commentCount: number
    /** Die Adresse dieses Vorgangs auf seiner Repo-Seite — `withVorgang` aus P2. */
    href: string
    /** Verfasser, roh und kleingeschrieben — Schlüssel des Scopes „Von mir". */
    author: string
    /**
     * Auf WEN dieser Vorgang wartet — Schlüssel des Scopes „Mir zugewiesen".
     *
     * Ein Feld, zwei Quellen, eine Bedeutung: bei einem Issue sind es die
     * Zugewiesenen (`assignees`), bei einem Pull Request die angefragten
     * Reviewer (`reviewers`). Ein PR kennt keine Zuweisung — er wartet auf eine
     * Durchsicht. Beides beantwortet dieselbe Frage („liegt das bei mir?"), und
     * genau deshalb steht es unter EINEM Namen statt unter zweien, die die
     * Fläche dann wieder zusammenführen müsste.
     */
    wartetAuf: string[]
    /** Zeitstempel der letzten Regung — Schlüssel der Sortierung. */
    updatedAt: number
}

/** Die Vorgänge EINES Repositories, für die workspace-weite Liste. */
export type VorgangGruppe = {
    address: string
    name: string
    /** Ziel des Gruppenkopfes: die Repo-Seite mit der passenden Liste. */
    href: string
    items: VorgangRow[]
}

export type ForgeOverview = {
    repos: RepoRow[]
    projects: ProjectRow[]
    /**
     * Alle Issues des Workspace, nach Repository gruppiert (P3).
     *
     * **Kostet keine einzige zusätzliche Abfrage:** `loadForge` sammelt die
     * Adressen aus ALLEN 30617 und lädt die Vorgänge dazu (`contentFilters`);
     * bis P3 wurden sie nur gezählt und weggeworfen. Die Decke von
     * {@link FORGE_ROOT_LIMIT} gilt dabei je Kind über alle Repos ZUSAMMEN —
     * deshalb trägt diese Fläche denselben `truncated`-Hinweis wie die
     * Repo-Liste.
     */
    issueGroups: VorgangGruppe[]
    /** Dasselbe für Pull Requests. */
    pullGroups: VorgangGruppe[]
    /**
     * Lohnt der Aktivitätsbalken? Nur bei mehr als EINEM aktiven Repository —
     * sonst wäre er immer voll und sagte nichts ({@link balkenLohnt}).
     */
    aktivitaetsbalken: boolean
    /**
     * Repos, die kein Projekt für sich beansprucht.
     *
     * **Bewusste Abweichung von Buzz Desktop:** dort erzeugt ein Repo ohne
     * Projekt ein „legacy project" (`projectModels.ts:368-386`) und die Kachel
     * „Projects" zeigt deshalb `1`, obwohl kein einziges kind 30621 existiert.
     * Wir erfinden kein Projekt, das es nicht gibt — die Kachel zeigt `0`, und
     * die Repos stehen hier, damit sie trotzdem niemand suchen muss.
     */
    unclaimed: RepoRow[]
    counts: ForgeCounts
    /**
     * Die Zeitleiste, nach Tagen gruppiert — leere Buckets sind raus. Keine
     * flache Liste daneben: zwei Darstellungen desselben Bestands wären zwei
     * Orte, an denen die Länge auseinanderlaufen kann.
     */
    activityGroups: ActivityGroup[]
    /**
     * Welche Listen genau am Limit ankamen und deshalb gekürzt sein KÖNNTEN.
     * Leer = keine Kürzung. Siehe Eigenheit 4 im Modulkopf.
     */
    truncated: string[]
}

const EMPTY_OVERVIEW: ForgeOverview = {
    repos: [],
    projects: [],
    issueGroups: [],
    pullGroups: [],
    unclaimed: [],
    counts: { projects: 0, repos: 0, pullRequests: 0, issues: 0, patches: 0 },
    aktivitaetsbalken: false,
    activityGroups: [],
    truncated: [],
}

const dateLabel = (ts: number): string =>
    formatTimestamp(ts, { day: 'numeric', month: 'short', year: 'numeric' })

const timeLabel = (ts: number): string =>
    formatTimestamp(ts, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })

/**
 * Anzeigename eines Pubkeys.
 *
 * `displayProfileByPubkey` fällt auf eine gekürzte `npub`-Form zurück, wenn das
 * kind 0 noch nicht da ist — die Zeile bleibt also lesbar, statt eine rohe
 * 64-stellige Hex-Kennung zu zeigen („Resolve references", VISION_ACTIVITY.md).
 */
/**
 * Der Anzeigename eines Schlüssels — **und die Engstelle, an der kein Wurf
 * durchkommen darf** (F1, 2026-08-24).
 *
 * `displayProfileByPubkey` endet bei fehlendem kind 0 in `displayPubkey`, also
 * in `nip19.npubEncode`, und das **wirft** bei allem, was nicht hexadezimal ist
 * (`npubEncode('Bob')` → SyntaxError, nachgestellt). Jeder Aufruf dieser
 * Funktion steht in einem `derived()`-Callback. Svelte hält seine
 * `subscriber_queue` modulweit: ein Wurf darin lässt sie ungeleert zurück, und
 * danach stellt **jeder** Store der Seite die Auslieferung ein — auch die, die
 * mit der Forge nichts zu tun haben. Aus einem falschen Tag wird so eine tote
 * Seite, und weil das Ereignis am Relay liegen bleibt, überlebt der Zustand
 * jeden Reload.
 *
 * **Der Riegel steht hier und nicht nur an den Datenquellen.** Beides ist
 * gebaut — `toRepoState` filtert den `p`-Tag, `foldAssignments` und
 * `foldReviews` filtern ihre `p`-Listen —, aber diese Quellen sind aufzählbar
 * und wachsen. Die Engstelle ist es nicht: jeder Schlüssel, der je zu einem
 * Namen wird, kommt hier durch. Genau das war der Fehler von P1 — der Riegel
 * existierte in `foldAssignments`, wurde beim Bau des Aktivitätsstroms aber
 * nicht mitgenommen.
 *
 * Ein unbrauchbarer Wert ergibt `''` statt einer erfundenen Kennung: die Fläche
 * zeigt dann keinen Namen, was zutrifft — sie kennt keinen.
 *
 * **Exportiert, damit die Zusage einen Träger hat** (N3, 2026-08-24). Sie war
 * die einzige Stelle der Kette ohne Test: keine `.test.ts` importierte
 * `forge.ts`, und wer diese Zeile auf `pubkey ? …` zurückdrehte, blieb grün —
 * ausgerechnet an der Stelle, die als die wichtigere begründet ist. Der Export
 * ist kein Test-Zubehör: eine Funktion, deren Vertrag „wirft unter keinen
 * Umständen" lautet, gehört überprüfbar gemacht. Geprüft in
 * `forgeNameGuard.test.ts` gegen die ECHTE `nip19`-Implementierung.
 */
export const nameOf = (pubkey: string): string =>
    isPubkey(pubkey) ? displayProfileByPubkey(pubkey) : ''

/** Pubkeys → Personen mit Namen und ROHEM Bild (`nostr-avatar` proxifiziert selbst). */
const peopleOf = (
    pubkeys: string[],
    profiles: Map<string, { picture?: string }>,
): { pubkey: string; name: string; picture: string }[] =>
    pubkeys.map((pubkey) => ({
        pubkey,
        name: nameOf(pubkey),
        picture: profiles.get(pubkey)?.picture ?? '',
    }))

/**
 * Die Sätze der Zeitleiste. Ein Typ, ein Satz — die Zuordnung steht HIER und
 * nicht in `forgeActivity.ts`, damit das reine Modul sprachfrei bleibt.
 *
 * Der Repo-Name steht nicht im Satz, sondern als eigenes Element daneben; die
 * Sätze enden deshalb offen.
 */
const ACTIVITY_VERBS: Record<ActivityItem['type'], string> = {
    'repo-created': 'hat das Repository angelegt:',
    push: 'hat gepusht nach',
    'issue-opened': 'hat ein Issue eröffnet:',
    'issue-status': 'hat den Status eines Issues geändert:',
    'patch-opened': 'hat einen Patch eingereicht:',
    'patch-status': 'hat den Status eines Patches geändert:',
    'pr-opened': 'hat einen Pull Request eröffnet:',
    'pr-updated': 'hat einen Pull Request aktualisiert:',
    'pr-status': 'hat den Status eines Pull Requests geändert:',
    comment: 'hat kommentiert:',
    // Die fünf Vorgangsformen (Nachzug zu P1). Drei davon NENNEN jemanden — der
    // Name steht im Satz und nicht daneben, weil „hat zugewiesen: <Titel>" die
    // eine Frage offenlässt, für die es die Zeile gibt. Deshalb tragen sie
    // `:namen` und laufen über {@link verbFor}, nicht über diese Tabelle
    // allein; die Tabelle hält den Fall ohne genannte Person offen.
    assignment: 'hat zugewiesen:',
    unassignment: 'hat die Zuweisung entfernt:',
    'review-request': 'hat um einen Review gebeten:',
    approval: 'hat freigegeben:',
    'changes-requested': 'hat Änderungen erbeten:',
}

/** Die drei Satzarten, deren Verb eine Person nennt. */
const VERBS_MIT_PERSON: Partial<Record<ActivityItem['type'], string>> = {
    assignment: 'hat :namen zugewiesen:',
    unassignment: 'hat die Zuweisung von :namen entfernt:',
    'review-request': 'hat :namen um einen Review gebeten:',
}

/**
 * Das Verb einer Zeile, mit den genannten Personen darin.
 *
 * Die Namen werden HIER eingesetzt und nicht im Markup: `forgeActivity.ts` ist
 * sprachfrei (es liefert `targets` als rohe Schlüssel), und die Fläche darf
 * keinen Satz zusammenstückeln — in einer Sprache mit anderer Wortstellung
 * stünde die Person sonst an der falschen Stelle. Ein Platzhalter im
 * Katalogsatz überlebt jede Übersetzung, eine Verkettung im Markup nicht.
 *
 * Ohne genannte Person (dürfte nur bei kaputten Ereignissen vorkommen — die
 * Faltung verlangt mindestens ein `p`) fällt es auf die personenlose Form
 * zurück, statt „hat  zugewiesen" mit einer Lücke zu zeigen.
 */
const verbFor = (item: ActivityItem): string => {
    const form = VERBS_MIT_PERSON[item.type]
    const targets = item.targets ?? []
    if (!form || targets.length === 0) {
        return t(ACTIVITY_VERBS[item.type])
    }

    return t(form, { namen: targets.map(nameOf).join(', ') })
}

const STATUS_LABELS: Record<string, string> = {
    open: 'Offen',
    applied: 'Erledigt',
    merged: 'Zusammengeführt',
    resolved: 'Erledigt',
    closed: 'Geschlossen',
    draft: 'Entwurf',
}

/** Statuscode → Anzeigewort. Unbekannter Code bleibt leer statt geraten. */
export const statusLabel = (code: string): string => (STATUS_LABELS[code] ? t(STATUS_LABELS[code]) : '')

/** Die Zeitleiste, anzeigefertig — mit Namen, Bild, Satz und Zeitangabe. */
export type ActivityRow = ActivityItem & {
    actorName: string
    actorPicture: string
    verb: string
    /**
     * Die KURZE Angabe für die Zeile („vor 3 Std", „gestern", „12. Aug. 2026").
     * Der Tages-Trenner darüber trägt den groben Zeitraum; ein zweiter absoluter
     * Zeitstempel je Zeile wiederholte ihn nur.
     */
    timeLabel: string
    /** Die volle Angabe mit Uhrzeit — steht im `title` der Zeile, nicht im Fließtext. */
    fullLabel: string
    statusLabel: string
}

/** Eine Tages-Gruppe der Zeitleiste (`HEUTE` · `GESTERN` · `DIESE WOCHE` · `ÄLTER`). */
export type ActivityGroup = TimelineGroup<ActivityRow>

const toActivityRows = (
    items: ActivityItem[],
    profiles: Map<string, { picture?: string }>,
    now: number,
): ActivityRow[] =>
    items.map((item) => ({
        ...item,
        actorName: nameOf(item.actor),
        // ROH wie im Profil — `x-group::nostr-avatar` proxifiziert selbst; ein
        // hier schon proxifizierter Wert liefe zweimal durch den Proxy.
        actorPicture: profiles.get(item.actor)?.picture ?? '',
        verb: verbFor(item),
        timeLabel: timelineTimeLabel(item.createdAt, now),
        fullLabel: timelineFullLabel(item.createdAt),
        statusLabel: statusLabel(item.status),
    }))

/**
 * Die fertige, nach Tagen gruppierte Zeitleiste.
 *
 * `now` wird EINMAL je Emit gelesen und durch beide Schritte gereicht: das
 * Zeit-Label der Zeile und ihr Bucket entstehen so garantiert aus derselben Uhr.
 * Zwei getrennte `Date.now()` — eines im Modell, eines beim Rendern — ergäben
 * genau an der Mitternachtsgrenze eine Zeile „vor 3 Std" unter „Gestern".
 *
 * `repoNames` ist der einzige Unterschied zwischen den beiden Flächen: die
 * Übersicht mischt Repos und benennt sie beim Wechsel, die Einzel-Repo-Ansicht
 * zeigt sie nie (Begründung an {@link groupTimeline}).
 */
const toActivityGroups = (
    items: ActivityItem[],
    profiles: Map<string, { picture?: string }>,
    now: number,
    repoNames: boolean,
): ActivityGroup[] => groupTimeline(toActivityRows(items, profiles, now), now, { repoNames })

/**
 * Vorgänge → anzeigefertige Gruppen mit Sprungzielen (P3, Route seit P1).
 *
 * Der `href` einer Zeile ist die Einzelroute auf der Repo-Seite: dieselbe Form,
 * die der Kopier-Knopf dort liefert. Sie wird hier nicht neu erfunden, sondern
 * mit `vorgangPath` aus derselben Quelle gebaut — sonst gäbe es zwei
 * Schreibweisen desselben Links, und die zweite altert.
 *
 * Die Basis ist der SITE-RELATIVE Pfad (`/forge/{naddr}`) — ein absoluter
 * `href` wäre für `wire:navigate` ein Fremdziel.
 */
/**
 * Auf wen wartet dieser Vorgang?
 *
 * Ein Issue nennt seine Zugewiesenen, ein Pull Request seine angefragten
 * Reviewer — verschiedene Felder, dieselbe Frage. Die Vereinheitlichung steht
 * HIER und nicht in der Fläche: sonst müsste jede Liste die Fallunterscheidung
 * noch einmal treffen, und zwei Stellen driften.
 */
const wartetAufVon = (item: { assignees?: string[]; reviewers?: string[] }): string[] =>
    (item.assignees ?? item.reviewers ?? []).map((pk) => String(pk).toLowerCase())

const zuGruppen = (
    gruppen: RepoGruppe<{
        id: string
        title: string
        status: string
        author: string
        updatedAt: number
        commentCount: number
        assignees?: string[]
        reviewers?: string[]
    }>[],
    art: VorgangArt,
    naddrOf: (address: string) => string,
): VorgangGruppe[] =>
    gruppen.map((gruppe) => {
        const naddr = naddrOf(gruppe.address)
        const basis = naddr === '' ? '' : `/forge/${encodeURIComponent(naddr)}`
        const listenTab = art === 'issue' ? 'issues' : 'pulls'

        return {
            address: gruppe.address,
            name: gruppe.name,
            href: basis === '' ? '' : `${basis}?tab=${listenTab}`,
            items: gruppe.items.map((item) => ({
                id: item.id,
                title: item.title,
                status: item.status,
                statusLabel: statusLabel(item.status),
                authorName: nameOf(item.author),
                timeLabel: dateLabel(item.updatedAt),
                commentCount: item.commentCount,
                href: basis === '' ? '' : vorgangPath(basis, { art, id: item.id }),
                author: String(item.author ?? '').toLowerCase(),
                wartetAuf: wartetAufVon(item),
                updatedAt: item.updatedAt,
            })),
        }
    })

/** Alle Forge-Ereignisse des Workspace, gedrosselt. */
const forgeEvents = (): Readable<ForgeEvent[]> =>
    throttled(300, deriveEventsForUrl(WORKSPACE_URL, [{ kinds: ALL_FORGE_KINDS }])) as unknown as Readable<
        ForgeEvent[]
    >

/**
 * Die Übersichtsseite: Repos, Projekte, Kennzahlen und Zeitleiste.
 *
 * Reaktiv über drei Quellen, und alle drei sind nötig: die Ereignisse (sie
 * kommen nach dem `load` herein), die Profile (Namen treffen später ein) und
 * `relay.self` (ohne es ist der Branch-Zustand nicht zuzuordnen). Ein einmaliges
 * Auslesen beim Mount wäre genau der Schnappschuss-Fehler, den dieses Projekt
 * mehrfach getreten hat.
 */
export const deriveForgeOverview = (): Readable<ForgeOverview> => {
    if (!WORKSPACE_URL) {
        return readable(EMPTY_OVERVIEW)
    }

    return derived(
        [forgeEvents(), throttled(300, profilesByPubkey), deriveRelaySelf(WORKSPACE_URL)],
        ([events, profiles, relaySelf]) => {
            const all = events as ForgeEvent[]
            // Eine Uhr für diesen Emit — siehe `toActivityGroups`.
            const now = Math.floor(Date.now() / 1000)
            const deletions = all.filter((event) => event.kind === DELETION)
            const repos = buildRepos(all, deletions)
            const projects = buildProjects(all, repos, deletions)
            const addresses = new Set(repos.map((repo) => repo.address))
            // `maintainerLookupFor(repos)`: seit dem 2026-08-23 zählt der Statuswechsel
            // eines eingetragenen Maintainers, wie NIP-34 es verlangt. Die Repos liegen
            // hier ohnehin vor — ohne das Durchreichen bliebe der alte, engere Riegel.
            const maintainersOf = maintainerLookupFor(repos)
            const issues = buildIssues(all, all, all, maintainersOf).filter((issue) =>
                addresses.has(issue.repoAddress),
            )
            const pulls = buildPullRequests(all, all, all, all, maintainersOf).filter((pr) =>
                addresses.has(pr.repoAddress),
            )
            const patches = buildPatches(all, all, all, maintainersOf).filter((patch) =>
                addresses.has(patch.repoAddress),
            )

            const patchesByRepo = new Map<string, number>()
            for (const patch of patches) {
                patchesByRepo.set(patch.repoAddress, (patchesByRepo.get(patch.repoAddress) ?? 0) + 1)
            }
            const issuesByRepo = new Map<string, number>()
            for (const issue of issues) {
                issuesByRepo.set(issue.repoAddress, (issuesByRepo.get(issue.repoAddress) ?? 0) + 1)
            }
            const pullsByRepo = new Map<string, number>()
            for (const pr of pulls) {
                pullsByRepo.set(pr.repoAddress, (pullsByRepo.get(pr.repoAddress) ?? 0) + 1)
            }

            /**
             * Welche `d`-Tags sich mehr als ein Repository teilt (N1).
             *
             * Ein 30618 trägt keinen Eigentümer; bei geteiltem Namen ist ein
             * relay-signierter Zustand deshalb nicht zuzuordnen. Nur der
             * BESTAND weiss davon — `foldRepoState` kann es nicht sehen.
             */
            const geteilteNamen = new Set(
                repos
                    .map((repo) => repo.dtag)
                    .filter((dtag, index, alle) => alle.indexOf(dtag) !== index),
            )

            // ── Der Strom EINMAL, und die Zählung vom UNGEKAPPTEN Ertrag ────
            //
            // `ACTIVITY_LIMIT` schneidet die ANZEIGE. Zählte der Balken danach,
            // hinge die Zahl eines Repos daran, wie viel ein anderes gepusht
            // hat — ein Messwert, der sich durch fremde Arbeit ändert.
            const alleEreignisse = buildActivity({
                repos,
                events: all,
                relaySelf: relaySelf as string,
            })
            const aktivitaet = aktivitaetJeRepo(alleEreignisse, now)

            const rows: RepoRow[] = repos.map((repo) => ({
                ...repo,
                naddr: naddrForRepo(repo.owner, repo.dtag, WORKSPACE_URL ? [WORKSPACE_URL] : []),
                ownerName: nameOf(repo.owner),
                dateLabel: dateLabel(repo.createdAt),
                state: foldRepoState(all, {
                    owner: repo.owner,
                    relaySelf: relaySelf as string,
                    dtag: repo.dtag,
                    dtagGeteilt: geteilteNamen.has(repo.dtag),
                }),
                issueCount: issuesByRepo.get(repo.address) ?? 0,
                pullRequestCount: pullsByRepo.get(repo.address) ?? 0,
                patchCount: patchesByRepo.get(repo.address) ?? 0,
                people: peopleOf(repo.maintainers, profiles as Map<string, { picture?: string }>),
                activityCount: aktivitaet.get(repo.address)?.anzahl ?? 0,
                activityShare: aktivitaet.get(repo.address)?.anteil ?? 0,
                lastActivityAt: aktivitaet.get(repo.address)?.letzteRegung ?? 0,
            }))
            const byAddress = new Map(rows.map((row) => [row.address, row]))
            /** Repo-Koordinate → `naddr`; die Zeilen liegen ohnehin schon vor. */
            const naddrOf = (address: string): string => byAddress.get(address)?.naddr ?? ''

            const truncated = truncatedLists({
                repos: repos.length,
                issues: issues.length,
                pulls: pulls.length,
                listLimit: FORGE_LIST_LIMIT,
                rootLimit: FORGE_ROOT_LIMIT,
            })

            const unclaimedAddresses = new Set(unclaimedRepos(repos, projects).map((repo) => repo.address))

            return {
                repos: rows,
                unclaimed: rows.filter((row) => unclaimedAddresses.has(row.address)),
                projects: projects.map((project) => ({
                    ...project,
                    ownerName: nameOf(project.owner),
                    dateLabel: dateLabel(project.createdAt),
                    repoNaddrs: project.repos.map((repo) => ({
                        naddr: byAddress.get(repo.address)?.naddr ?? '',
                        name: repo.name,
                    })),
                })),
                // Die workspace-weiten Listen (P3) — dieselben `issues`/`pulls`,
                // aus denen einen Absatz weiter oben die Kacheln gezählt werden.
                // Zwei Ableitungen für denselben Bestand wären zwei Zahlen.
                issueGroups: zuGruppen(gruppiereNachRepo(issues, repos), 'issue', naddrOf),
                pullGroups: zuGruppen(gruppiereNachRepo(pulls, repos), 'pr', naddrOf),
                counts: {
                    projects: projects.length,
                    repos: repos.length,
                    pullRequests: pulls.length,
                    issues: issues.length,
                    patches: patches.length,
                },
                // Die Übersicht mischt Repos — hier nennt die Zeile ihr Repo,
                // aber nur beim Wechsel.
                aktivitaetsbalken: balkenLohnt(aktivitaet),
                activityGroups: toActivityGroups(
                    // Derselbe Ertrag wie oben, nur für die Anzeige geschnitten.
                    // `relaySelf` ist bei Buzz der SIGNIERER der 30618 — ohne ihn
                    // fällt jede Push-Zeile heraus (F2). Er liegt in dieser
                    // Ableitung ohnehin vor; genau derselbe Wert speist
                    // `foldRepoState` ein paar Zeilen darüber.
                    alleEreignisse.slice(0, ACTIVITY_LIMIT),
                    profiles as Map<string, { picture?: string }>,
                    now,
                    true,
                ),
                truncated,
            }
        },
    )
}

// ── Der Bestand für die RAIL (P1) ───────────────────────────────────────────

/**
 * Was der Forge-Baum der Workspace-Sektion braucht: Repos, Projekte, Zähler.
 *
 * **Eine eigene Ableitung neben {@link deriveForgeOverview}, kein zweiter
 * Aufrufer davon.** Die Übersicht rechnet bei jeder Änderung Zeitleiste,
 * Datumsbeschriftungen, Branch-Zustände und Personenkarten aus — die Rail steht
 * auf JEDER Seite und braucht davon nichts. Was hier geteilt wird, ist die
 * Faltung selbst (`buildRepos`/`buildProjects`/`buildIssues`), also genau das,
 * was auseinanderlaufen dürfte; die Aufbereitung ist je Fläche eine andere.
 *
 * Die Zähler sind bewusst DIESELBE Zahl wie die Kacheln der Übersicht (alle
 * Issues bzw. PRs eines Repos, nicht nur die offenen): zwei Zahlen für dieselbe
 * Frage an zwei Orten sind ein Fehlerbericht in Wartestellung.
 */
export const deriveForgeNav = (): Readable<{ repos: ForgeNavRepo[]; projects: ForgeNavProject[] }> => {
    if (!WORKSPACE_URL) {
        return readable({ repos: [], projects: [] })
    }

    return derived(forgeEvents(), (events) => {
        const all = events as ForgeEvent[]
        const deletions = all.filter((event) => event.kind === DELETION)
        const repos = buildRepos(all, deletions)
        const projects = buildProjects(all, repos, deletions)
        const addresses = new Set(repos.map((repo) => repo.address))

        const issuesByRepo = new Map<string, number>()
        for (const issue of buildIssues(all)) {
            if (addresses.has(issue.repoAddress)) {
                issuesByRepo.set(issue.repoAddress, (issuesByRepo.get(issue.repoAddress) ?? 0) + 1)
            }
        }
        const pullsByRepo = new Map<string, number>()
        for (const pull of buildPullRequests(all)) {
            if (addresses.has(pull.repoAddress)) {
                pullsByRepo.set(pull.repoAddress, (pullsByRepo.get(pull.repoAddress) ?? 0) + 1)
            }
        }

        return {
            repos: repos.map((repo) => ({
                address: repo.address,
                name: repo.name,
                naddr: naddrForRepo(repo.owner, repo.dtag, WORKSPACE_URL ? [WORKSPACE_URL] : []),
                channelId: repo.channelId,
                issueCount: issuesByRepo.get(repo.address) ?? 0,
                pullRequestCount: pullsByRepo.get(repo.address) ?? 0,
            })),
            projects: projects.map((project) => ({
                address: project.address,
                name: project.name,
                repoAddresses: project.repos.map((repo) => repo.address),
            })),
        }
    })
}

/**
 * Auf den Kaltstart-Cache warten, BEVOR die erste Netz-Runde losläuft (P10).
 *
 * Nicht Kosmetik, sondern eine Reihenfolge-Zusage: `repository.load()` und
 * `tracker.load()` sind **destruktiv** (welshman leert die Indizes und lädt neu).
 * Käme eine Relay-Antwort dazwischen, würfe der Cache-Load sie wieder weg — genau
 * dieselbe Falle, die `bridge.ts` beim Raum-`setup()` mit demselben `storageReady`
 * schon abfängt (M3 P1). Zusätzlich malt die Fläche so aus dem Cache, bevor das
 * Netz überhaupt antwortet, statt beides um dieselbe Millisekunde rennen zu lassen.
 *
 * `storageReady` rejectet nie (fail-soft) und ist beim Gast sofort aufgelöst.
 */
const forgeCacheReady = (): Promise<void> => storageReady

/**
 * **`load()` kann leer zurückkommen, obwohl der Bestand vorliegt** — die
 * Absicherung dagegen. Die *Ursache* ist offen; die frühere Erklärung war falsch.
 *
 * Das Symptom ist gemessen (P10, Teststack): nach einem Reload mit warmem Cache
 * stieg `loadForge` bei „`addresses.length === 0`" aus — **Issues, Kommentare
 * und Statuswechsel wurden gar nicht mehr geladen**, und niemand hätte es
 * gesehen, weil der Cache die Fläche trotzdem füllte. Die zweite Laderunde
 * leitet ihre `#a`-Adressen aus der ersten ab; ein leerer Rückgabewert schaltet
 * sie also stumm ab.
 *
 * ── Was hier bis N5 stand, und warum es NICHT stimmt ────────────────────────
 *
 * Erklärt wurde das mit dem app-weiten `tracker`: `load` verschweige alles, was
 * der schon kennt. **Widerlegt** (N5-Lauf, drei Sonden inkl. negativer Kontrolle
 * gegen einen gepatchten Vendor, nachgelesen im installierten Paket):
 *
 * - `makeLoader` legt seinen Tracker **je Stapel neu** an —
 *   `@welshman/net/…/request.js:147` ist ein blankes `const tracker = new
 *   Tracker()`, ohne `options.tracker`-Rückfall. Die Dublettenprüfung in
 *   `requestOne:35-37` läuft also gegen ein frisches, leeres Objekt.
 * - Der app-weite `tracker` aus `@welshman/app` ist ein **anderes** Objekt und
 *   wird von `load` nie gelesen; `request` (`request.js:110`) genauso wenig.
 * - Richtig bleibt nur die Teilbeobachtung, dass `makeLoader` `onDuplicate`
 *   nicht durchreicht (`request.js:204-221`) — folgenlos, weil der Zweig für
 *   gecachte Ereignisse gar nicht erst betreten wird. Zwei gleichzeitige `load`
 *   mit überlappenden Filtern bekommen beide dasselbe Event.
 *
 * ── Der aktuelle Verdacht, ausdrücklich als Verdacht ────────────────────────
 *
 * Ein `CLOSED` auf das erste REQ löst `requestOne` **sofort mit `[]`** auf
 * (`request.js:65-74`: letzte sub_id weg → `close()` → `deferred.resolve`). Auf
 * einem `auth_required`-Relay ist genau das die Normalform der AUTH-Runde —
 * derselbe Lauf mass `{"runde":1,"rueckgabewert":0,"repository":0}` gefolgt von
 * `{"runde":2,"rueckgabewert":1,"repository":1}`. **Nicht bewiesen**: die
 * Zurechnung zum P10-Symptom gehört zu N4 und ist dort offen.
 *
 * ── Warum die Absicherung trotzdem bleibt ───────────────────────────────────
 *
 * Sie hängt an keiner dieser Ursachen: die Adressen kommen aus der Vereinigung
 * von *frisch geliefert* und *liegt lokal vor*, egal warum der Rückgabewert leer
 * war. Letzteres über den `tracker` auf den Workspace gescopet, wie jede
 * Ableitung dieser Datei. `repository.query` lässt Gelöschtes weg, ein per
 * Grabstein entferntes Repo taucht hier also nicht wieder auf.
 */
const localForgeEvents = (filters: Filter[]): TrustedEvent[] =>
    repository
        .query(filters.map(({ limit, ...rest }) => rest))
        .filter((event: TrustedEvent) => tracker.hasRelay(event.id, WORKSPACE_URL))

/**
 * Ids, deren Grabstein schon einmal angefragt wurde. Modulweit und damit einmal je
 * Seitenaufbau — `wire:navigate` behält den JS-Kontext, ein Routenwechsel stellt
 * die Frage also nicht erneut.
 */
const tombstoneAsked = new Set<string>()

/**
 * **Der Grabstein eines Issues ist über `#a` nicht zu finden** — und genau das
 * macht den Kaltstart-Cache (P10) gefährlich.
 *
 * Am Teststack gemessen (2026-08-17): ein `kind 5` mit `["e", <issue-id>]` löscht
 * das Issue am Relay **hart** — es kommt aus keiner Abfrage mehr zurück. Der
 * Grabstein selbst bleibt lesbar, aber **nur** über `#e`: er trägt kein `a`-Tag,
 * {@link tombstoneFilters} findet ihn also nie. Solange nichts gecacht wurde, fiel
 * das nicht auf — was der Relay nicht liefert, zeigt die Fläche nicht. Mit Cache
 * kehrt sich das um: das Issue kommt aus der IndexedDB, der Grabstein aus keiner
 * Quelle, und das Gelöschte stünde bei **jedem** Seitenaufbau wieder da — nicht
 * als Aufblitzen wie beim 9008-Fall, sondern dauerhaft.
 *
 * Gefragt wird deshalb nach den Grabsteinen genau dessen, was **lokal vorliegt**:
 * einmal je Id und Seitenaufbau, in Blöcken zu {@link TOMBSTONE_CHUNK}, als
 * zusätzliche Filter derselben Laderunde (kein eigener Roundtrip). Ohne Cache ist
 * die Liste leer und es geht kein einziger zusätzlicher Filter raus. Den Rest
 * erledigt welshman: `repository` schließt das Ziel eines kind 5 aus jeder
 * `query()` aus, und `storage.ts` persistiert den Grabstein (kind 5 steht seit
 * jeher in `PERSIST_KINDS`) — der nächste Kaltstart ist schon sauber.
 *
 * *Warum nicht „was der Relay nicht mitgeschickt hat"?* Weil der Rückgabewert
 * von `load` nachweislich leer sein kann, obwohl der Bestand vorliegt — die
 * Ursache ist offen, das Symptom gemessen (siehe {@link localForgeEvents}). Ein
 * Vergleich „lokal minus geliefert" hielte in genau diesem Fall **jedes**
 * gecachte Ereignis für verschwunden und fragte nach lauter Grabsteinen, die es
 * nicht gibt.
 *
 * ── Was diese Filter kosten — und was hier bis N6 falsch stand ──────────────
 *
 * Hier stand die Rechnung „7 Filter, Grenze 10, drei Filter Luft". Sie war
 * falsch, und zwar in der Prämisse: `max_filters: 10` deckelt die Filter **in
 * einer REQ-Nachricht** (`protocol.rs:92-99` prüft `arr[2..].len()`), aber
 * welshman legt nie mehr als **einen** Filter in eine REQ-Nachricht. `requestOne`
 * schickt je Filter eine eigene REQ mit eigener sub_id
 * (`@welshman/net/…/request.js:99-104`), und `load` ändert daran nichts:
 * `unionFilters` (`request.js:191`) bündelt die Filter einer Runde nur zu einer
 * *Liste*, die derselbe Aufruf anschließend wieder einzeln verschickt. Die
 * Chunk-Verschmelzung stimmt (`Filters.js:42-69` gruppiert Filter ohne `limit`
 * nach Schlüsselmenge, aus beliebig vielen `{kinds:[5],"#e":[…]}` wird einer) —
 * sie spart REQ-Nachrichten, nicht Filter-Slots.
 *
 * Die reale Obergrenze ist deshalb **`max_subscriptions: 1024` je Verbindung**
 * (`nip11.rs:109`, durchgesetzt in `handlers/req.rs:25/65`). Die zweite
 * Laderunde der Übersicht belegt davon 7, die Rail 4, das Live-Abo 6 — wer
 * {@link contentFilters} erweitert, kostet je Filter eine Subscription von
 * 1024, nicht einen von drei verbliebenen Plätzen. Gemessen wird das in
 * `buzz-forge.spec.ts` („kein REQ trägt mehr als einen Filter"), damit die
 * Prämisse nicht ein zweites Mal aus einer Leseannahme stammt.
 *
 * Die Werteliste selbst ist unkritisch: bei vollen Deckeln (300 Wurzeln + 600
 * Blätter) trägt der `#e`-Filter 900 Ids ≈ 59 KB gegen `max_message_length:
 * 524288`, und der REQ-Pfad kennt keine Obergrenze für Tag-Werte.
 */
const tombstoneFiltersForCached = (content: Filter[]): Filter[] => {
    const ids = localForgeEvents(content)
        .map((event: TrustedEvent) => event.id)
        .filter((id: string) => !tombstoneAsked.has(id))
    const filters: Filter[] = []
    for (let i = 0; i < ids.length; i += TOMBSTONE_CHUNK) {
        filters.push({ kinds: [DELETION], '#e': ids.slice(i, i + TOMBSTONE_CHUNK) })
    }
    for (const id of ids) {
        tombstoneAsked.add(id)
    }

    return filters
}

/**
 * Bestand für die Rail laden — **dieselben Filter wie die Übersicht, weniger
 * davon**: keine Branch-Zustände (die Rail zeigt keine Branches), keine
 * PR-Updates, keine Statuswechsel, keine Kommentare, kein Markdown-Renderer und
 * kein Profil-Warmup. Die Rail braucht Namen von Repos, nicht von Menschen.
 *
 * Zwei Runden, weil die zweite die Adressen der ersten braucht — dieselbe
 * Reihenfolge wie {@link loadForge}, nur mit dem kleineren Zuschnitt.
 */
const loadForgeNav = async (signal?: AbortSignal): Promise<void> => {
    if (!WORKSPACE_URL) {
        return
    }
    await forgeCacheReady()
    const overview: Filter[] = [
        { kinds: [REPO_ANNOUNCEMENT], limit: FORGE_LIST_LIMIT },
        { kinds: [PROJECT_ANNOUNCEMENT], limit: FORGE_LIST_LIMIT },
    ]
    const base = await load({ relays: [WORKSPACE_URL], filters: overview, signal })

    const addresses = repoAddressesOf([...base, ...localForgeEvents(overview)])
    if (addresses.length === 0 || signal?.aborted) {
        return
    }

    // Auch die Rail zählt Issues und PRs — ein gecachtes, am Relay längst
    // gelöschtes Issue bliebe hier sonst dauerhaft in der Zahl stehen, selbst
    // wenn niemand die Forge-Seite öffnet. Siehe tombstoneFiltersForCached.
    const roots: Filter[] = [
        { kinds: [GIT_ISSUE], '#a': addresses, limit: FORGE_ROOT_LIMIT },
        { kinds: [GIT_PULL_REQUEST], '#a': addresses, limit: FORGE_ROOT_LIMIT },
    ]
    await load({
        relays: [WORKSPACE_URL],
        filters: [...roots, ...tombstoneFilters(addresses), ...tombstoneFiltersForCached(roots)],
        signal,
    })
}

let navStarted = false

/**
 * **Der einzige Einstieg für eine Fläche**, die den Forge-Baum zeigt: schaltet den
 * Netzweg scharf (idempotent, modulweit) und abonniert {@link deriveForgeNav}.
 * Gibt den Abmelder zurück — die Fläche ruft ihn in `destroy()`.
 *
 * Dasselbe Muster und dieselbe Begründung wie `subscribeWorkspacePrefs`
 * (`channelPrefs.ts`): gebunden an den ERSTEN Abonnenten, nicht an den
 * Seitenaufruf. `wire:navigate` baut die Rail bei jedem Raumwechsel neu auf —
 * hinge der `load` am Mount, liefe er bei jedem Klick erneut. Der Netzweg bleibt
 * deshalb modulweit stehen; abgemeldet wird nur dieses eine Abo.
 */
export const subscribeForgeNav = (
    listener: (data: { repos: ForgeNavRepo[]; projects: ForgeNavProject[] }) => void,
): (() => void) => {
    if (!navStarted && WORKSPACE_URL) {
        navStarted = true
        void loadForgeNav().catch((error: unknown) => {
            // Fail-soft wie überall im Lesepfad: ohne Bestand bleibt der Baum leer
            // und die Kanäle stehen flach — also genau der Zustand von vor P1.
            console.warn('[forge] Der Forge-Baum konnte nicht geladen werden', error)
        })
    }

    return deriveForgeNav().subscribe(listener)
}

/** Ein Kommentar, anzeigefertig (Markdown bereits gerendert). */
export type CommentRow = {
    id: string
    author: string
    authorName: string
    authorPicture: string
    html: string
    timeLabel: string
}

/**
 * Eine Person auf der Forge-Fläche: Schlüssel, Anzeigename, rohes Bild.
 *
 * Dieselbe Form wie `RepoRow.people` und aus derselben Quelle ({@link peopleOf})
 * — es gibt auf dieser Fläche genau EINEN Weg, aus einem Schlüssel einen
 * Menschen zu machen. Ein zweiter wäre der Punkt, an dem zwei Zeilen desselben
 * Bildschirms verschiedene Namen für denselben Schlüssel zeigen.
 */
export type ForgePerson = { pubkey: string; name: string; picture: string }

export type IssueRow = Omit<Issue, 'comments'> & {
    authorName: string
    authorPicture: string
    timeLabel: string
    html: string
    /**
     * Die Zugewiesenen mit Namen — das Zuweisungs-Band.
     *
     * **Nicht aus `RepoRow.people` nachgeschlagen**, obwohl das naheliegt: dort
     * stehen die MAINTAINER des Announcements. Ein Zugewiesener muss keiner
     * sein (jedes Mitglied kann ein Issue an sich ziehen), und ein Nachschlagen
     * hätte ihn still namenlos gelassen. `peopleOf` löst jeden Schlüssel auf,
     * unabhängig von seiner Rolle.
     *
     * Ohne bekanntes kind 0 liefert `nameOf` die gekürzte `npub`-Form — dieselbe
     * Rückfallebene wie beim Autor einer Zeile, nicht die rohe Hex-Kette.
     */
    assigneePeople: ForgePerson[]
    comments: CommentRow[]
}

/**
 * Die gekürzten Formen der 1631-Commits — anzeigefertig (P7/2).
 *
 * Dieselbe Begründung wie bei `shortCommit`: die Fläche zeigt überall sieben
 * Stellen, und `commit.slice(0, 7)` im Markup wäre eine achte Kopie derselben
 * Regel — dort ohne die Formprüfung, die aus `["merge-commit","master"]`
 * sonst eine Pille namens „master" machte. Die vollen Ids stehen daneben
 * (`merge.mergeCommit`, `merge.appliedAsCommits`); wer verlinkt, nimmt die.
 */
export type MergeRow = {
    shortMergeCommit: string
    shortAppliedAsCommits: string[]
}

export type PullRequestRow = Omit<PullRequest, 'comments' | 'updates'> & MergeRow & {
    authorName: string
    authorPicture: string
    timeLabel: string
    html: string
    shortCommit: string
    /**
     * Die Reviewer-Zeile: Person **plus** ihre Entscheidung zum aktuellen Commit.
     *
     * Die Liste kommt aus `reviewerRows` (rein, geprüft) und enthält auch, wer
     * entschieden hat, ohne angefragt worden zu sein — der Repo-Eigentümer darf
     * das. Vor dem Nachzug rechnete das Markup diese Zuordnung mit drei
     * `.some()`-Ausdrücken je Zeile selbst und übersah genau diesen Fall.
     */
    reviewerPeople: (ForgePerson & { decision: ReviewerRow['decision'] })[]
    comments: CommentRow[]
    updates: { id: string; authorName: string; shortCommit: string; timeLabel: string; html: string }[]
}

/**
 * Ein Patch, anzeigefertig — mit **geparstem** Diff.
 *
 * Der rohe `content` bleibt daneben stehen: er ist der Patch, und nur mit ihm
 * kann jemand `git am` fuettern. Ein Modell, das nur das Geparste behielte,
 * naehme die einzige Handlung weg, fuer die es ein 1617 ueberhaupt gibt.
 */
export type PatchRow = Omit<Patch, 'comments'> & MergeRow & {
    authorName: string
    timeLabel: string
    shortCommit: string
    /** Der gelesene Diff — Dateien, Hunks, Zeilen (`forgeDiff.ts`). */
    diff: ParsedDiff
    /** Kennzahlen fuers Abzeichen: Dateien, `+`, `-`. */
    stat: DiffStat
    /**
     * Der Beschreibungstext (Commit-Nachricht ohne erste Zeile) — **KLARTEXT**.
     *
     * Bewusst NICHT `html` genannt: jedes andere Modell dieser Fläche trägt in
     * `html` gerendertes Markdown, und ein gleichnamiges Feld mit rohem Text
     * wäre eine Einladung, es an `x-html` zu binden. Der Unterschied ist hier
     * eine Sicherheitszusage, kein Stil.
     */
    body: string
    comments: CommentRow[]
}

/**
 * Ein Repo mit derselben Historie (`euc`) — anzeigefertig (P7/3).
 *
 * **Bewusst „verwandt" und nicht „Fork":** siehe {@link verwandteRepos}. Aus
 * dem `euc` folgt, dass zwei Repos dieselbe Wurzel haben, **nicht**, welches
 * von welchem abstammt. Eine Fläche, die hier „Fork von X" schreibt, behauptet
 * eine Richtung, die im Protokoll nicht steht.
 */
export type VerwandtesRepo = {
    address: string
    /** Ziel der Zeile: die Detailseite dieses Repos. */
    naddr: string
    name: string
    ownerName: string
}

export type RepoView = {
    repo: RepoRow
    issues: IssueRow[]
    patches: PatchRow[]
    pullRequests: PullRequestRow[]
    /**
     * Repos mit demselben `euc`, ohne dieses selbst. Leer ist der Normalfall —
     * und heißt „keins bekannt", nicht „keins vorhanden": gesehen wird nur, was
     * dieser Workspace kennt.
     */
    verwandte: VerwandtesRepo[]
    /**
     * Dieselbe Tages-Gruppierung wie auf der Übersicht — aber OHNE Repo-Namen in
     * den Zeilen: hier ist er für alle derselbe und steht als Seitentitel über
     * der Liste.
     */
    activityGroups: ActivityGroup[]
    truncated: string[]
}

/**
 * Der Markdown-Renderer des Artikel-Lesers, **wiederverwendet statt nachgebaut**.
 *
 * `markdown-it` mit `html:false` — roher HTML-Text des Autors ist damit bereits
 * zu Entities geworden, `javascript:`/`data:`-Links werden gar nicht erst zu
 * Ankern (`js/longform.ts`, Begründung samt Messung dort). Ein zweiter Renderer
 * für Issue-Texte hiesse zwei Sicherheitszusagen für dieselbe Art Fremdtext.
 *
 * Der Import ist lazy: 50 kB gzip gehören nicht in den `app`-Chunk, den jede
 * Seite lädt. Bis er da ist, steht der Rohtext — **nicht** als HTML gebunden,
 * die Fläche zeigt ihn über `x-text`.
 */
let renderer: ((content: string, proxify?: (url: string) => string) => string) | null = null

/**
 * Ist der Renderer da? **Als Store, nicht als Feld** — und das ist kein Stil:
 * die Ableitungen unten laufen schon, bevor der Chunk geladen ist (ein
 * Kaltstart-Cache liefert Ereignisse ohne Netz). Ohne diese Quelle liefen sie
 * genau einmal, mit leerem `html`, und der Issue-Text bliebe dauerhaft leer,
 * weil danach kein Ereignis mehr eintrifft, das eine Neuberechnung auslöst.
 */
const rendererReady = writable(false)

const ensureRenderer = async (): Promise<void> => {
    if (!renderer) {
        renderer = (await import('./longform.ts')).renderArticleHtml
        rendererReady.set(true)
    }
}

/**
 * Gerenderter Text, gemerkt je Ereignis-Id.
 *
 * Ohne den Merker liefe markdown-it bei JEDEM Emit der Ableitung über jeden
 * Issue-Text, jeden Kommentar und jedes PR-Update — und die Ableitung hängt an
 * den Profilen, die asynchron nachtröpfeln. Die Id ist als Schlüssel korrekt,
 * weil sie sich mit dem Inhalt ändert. Dasselbe Muster wie `htmlCache` in
 * `longformFeed.ts` (`htmlCache`).
 */
const htmlCache = new Map<string, string>()

/**
 * Der geparste Diff je Ereignis-Id.
 *
 * Dieselbe Begründung wie beim HTML-Memo: die Ableitung läuft bei JEDEM
 * eintreffenden Ereignis neu, und ein Patch von 4000 Zeilen wieder und wieder
 * durch den Parser zu schicken, kostet ohne Gegenwert. Die Id ist der
 * Schlüssel — ein 1617 ist NICHT ersetzbar (kind < 10000), sein Inhalt kann
 * sich also nie ändern, und ein Eintrag kann nie veralten.
 */
const diffCache = new Map<string, ParsedDiff>()

const parseDiffMemo = (id: string, content: string): ParsedDiff => {
    let diff = diffCache.get(id)
    if (diff === undefined) {
        diff = parseUnifiedDiff(content)
        diffCache.set(id, diff)
    }

    return diff
}

const renderMarkdown = (id: string, content: string): string => {
    if (!renderer) {
        return ''
    }
    let html = htmlCache.get(id)
    if (html === undefined) {
        html = renderer(content, (url) => proxifyImage(url, 'full'))
        htmlCache.set(id, html)
    }

    return html
}

/**
 * Ein Kommentar, anzeigefertig — mit Gesicht, denn die Einzelansicht zeigt
 * Karten mit Autoren-Kopfzeile (P1). Das Profil kommt als zweites Argument,
 * weil nur der Aufrufer weiss, welche Profil-Map dieser Emit gesehen hat;
 * `nameOf` allein arbeitet auf dem (drosseligen) Zwischenstand.
 */
const toCommentRow = (
    comment: { id: string; author: string; content: string; createdAt: number },
    profiles: Map<string, { picture?: string }>,
): CommentRow => ({
    id: comment.id,
    author: comment.author,
    authorName: nameOf(comment.author),
    authorPicture: profiles.get(comment.author)?.picture ?? '',
    html: renderMarkdown(comment.id, comment.content),
    timeLabel: timeLabel(comment.createdAt),
})

/**
 * Kürzung UND Formprüfung kommen seit P7 aus `forgeModels.ts` — dieselbe Regel,
 * die dort über `merge-commit` und `merge-base` entscheidet, und dort geprüft.
 * Zwei Kopien wären zwei Gelegenheiten, sie auseinanderlaufen zu lassen
 * (F1, 2026-08-24, `isPubkey`).
 */
const shortCommit = shortCommitId

/** Die gekürzten 1631-Commits einer Wurzel — leer, solange kein 1631 vorliegt. */
const mergeRow = (merge: MergeInfo): MergeRow => ({
    shortMergeCommit: shortCommit(merge.mergeCommit),
    shortAppliedAsCommits: kurzeCommits(merge.appliedAsCommits),
})

/** Ein einzelnes Repository mit seinen Issues, PRs und seiner Zeitleiste. */
export const deriveRepoView = (naddr: string): Readable<RepoView | null> => {
    const address = decodeRepoNaddr(naddr)
    if (!address || !WORKSPACE_URL) {
        return readable<RepoView | null>(null)
    }

    return derived(
        [forgeEvents(), throttled(300, profilesByPubkey), deriveRelaySelf(WORKSPACE_URL), rendererReady],
        ([events, profiles, relaySelf]) => {
            const all = events as ForgeEvent[]
            // Eine Uhr für diesen Emit — siehe `toActivityGroups`.
            const now = Math.floor(Date.now() / 1000)
            const deletions = all.filter((event) => event.kind === DELETION)
            const alleRepos = buildRepos(all, deletions)
            const repo = alleRepos.find(
                (candidate) => candidate.owner === address.owner && candidate.dtag === address.dtag,
            )
            if (!repo) {
                return null
            }
            // Trägt ein ANDERES sichtbares Repo denselben Namen? Dann ist ein
            // relay-signierter Zustand nicht zuzuordnen (N1). Die Liste lag
            // ohnehin vor — sie wurde bis zum 2026-08-24 nur weggeworfen.
            const dtagGeteilt = alleRepos.filter((candidate) => candidate.dtag === repo.dtag).length > 1

            // Genau ein Repo auf dieser Fläche — die Nachschlagefunktion baut sich aus ihm.
            const maintainersOf = maintainerLookupFor([repo])
            const issues = buildIssues(all, all, all, maintainersOf).filter(
                (issue) => issue.repoAddress === repo.address,
            )
            const pulls = buildPullRequests(all, all, all, all, maintainersOf).filter(
                (pr) => pr.repoAddress === repo.address,
            )
            const patches = buildPatches(all, all, all, maintainersOf).filter(
                (patch) => patch.repoAddress === repo.address,
            )
            const truncated = truncatedLists({
                repos: 0,
                issues: issues.length,
                pulls: pulls.length,
                listLimit: FORGE_LIST_LIMIT,
                rootLimit: FORGE_ROOT_LIMIT,
            })

            const row: RepoRow = {
                ...repo,
                naddr,
                ownerName: nameOf(repo.owner),
                dateLabel: dateLabel(repo.createdAt),
                state: foldRepoState(all, {
                    owner: repo.owner,
                    relaySelf: relaySelf as string,
                    dtag: repo.dtag,
                    dtagGeteilt,
                }),
                issueCount: issues.length,
                pullRequestCount: pulls.length,
                patchCount: patches.length,
                people: peopleOf(repo.maintainers, profiles as Map<string, { picture?: string }>),
                // Der Aktivitätsbalken ist ein VERGLEICH zwischen Repositories
                // (P6). Auf der Detailseite gibt es nichts zu vergleichen — ein
                // Balken, der immer voll ist, sagt nichts. Die Felder tragen
                // deshalb hier bewusst 0 und werden von dieser Fläche nicht
                // gerendert; sie stehen nur, weil `RepoRow` EIN Typ ist und
                // bleiben soll.
                activityCount: 0,
                activityShare: 0,
                lastActivityAt: 0,
            }

            return {
                repo: row,
                // `alleRepos` lag ohnehin vor (es beantwortet `dtagGeteilt`) —
                // die Verwandtschaft kostet keine zusätzliche Abfrage, nur einen
                // Durchlauf über eine Liste, die schon im Speicher steht.
                verwandte: verwandteRepos(repo, alleRepos).map((andere) => ({
                    address: andere.address,
                    // Mit Relay-Hinweis wie an den beiden anderen Fundstellen:
                    // ein `naddr`, den jemand aus der App kopiert, soll auch in
                    // einem fremden Client sagen, wo das Repo liegt (NIP-19).
                    naddr: naddrForRepo(andere.owner, andere.dtag, WORKSPACE_URL ? [WORKSPACE_URL] : []),
                    name: andere.name,
                    ownerName: nameOf(andere.owner),
                })),
                issues: issues.map((issue) => ({
                    ...issue,
                    authorName: nameOf(issue.author),
                    authorPicture: (profiles as Map<string, { picture?: string }>).get(issue.author)?.picture ?? '',
                    timeLabel: timeLabel(issue.createdAt),
                    html: renderMarkdown(issue.id, issue.content),
                    assigneePeople: peopleOf(issue.assignees, profiles as Map<string, { picture?: string }>),
                    comments: issue.comments.map((comment) => toCommentRow(comment, profiles as Map<string, { picture?: string }>)),
                })),
                patches: patches.map((patch) => ({
                    ...patch,
                    authorName: nameOf(patch.author),
                    timeLabel: timeLabel(patch.createdAt),
                    shortCommit: shortCommit(patch.commit),
                    ...mergeRow(patch.merge),
                    diff: parseDiffMemo(patch.id, patch.content),
                    stat: diffStat(parseDiffMemo(patch.id, patch.content)),
                    // KLARTEXT, nicht gerendert — siehe `patchBody` in `forgeDiff.ts`.
                    body: patchBody(patch.content),
                    comments: patch.comments.map((comment) => toCommentRow(comment, profiles as Map<string, { picture?: string }>)),
                })),
                pullRequests: pulls.map((pr) => ({
                    ...pr,
                    authorName: nameOf(pr.author),
                    authorPicture: (profiles as Map<string, { picture?: string }>).get(pr.author)?.picture ?? '',
                    timeLabel: timeLabel(pr.createdAt),
                    html: renderMarkdown(pr.id, pr.content),
                    shortCommit: shortCommit(pr.commit),
                    ...mergeRow(pr.merge),
                    // Erst die reine Zuordnung (Reviewer → Entscheidung), dann
                    // die Namen darauf. Zwei Schritte, weil der erste ohne
                    // Browser prüfbar ist und der zweite nicht.
                    reviewerPeople: reviewerRows(pr.reviewers, pr.approvals, pr.changeRequests).map((row) => ({
                        ...peopleOf([row.pubkey], profiles as Map<string, { picture?: string }>)[0],
                        decision: row.decision,
                    })),
                    comments: pr.comments.map((comment) => toCommentRow(comment, profiles as Map<string, { picture?: string }>)),
                    updates: pr.updates.map((update) => ({
                        id: update.id,
                        authorName: nameOf(update.author),
                        shortCommit: shortCommit(update.commit),
                        timeLabel: timeLabel(update.createdAt),
                        html: renderMarkdown(update.id, update.content),
                    })),
                })),
                activityGroups: toActivityGroups(
                    buildActivity({ repos: [repo], events: all, relaySelf: relaySelf as string }).slice(0, ACTIVITY_LIMIT),
                    profiles as Map<string, { picture?: string }>,
                    now,
                    false,
                ),
                truncated,
            }
        },
    )
}

// ── Netz ────────────────────────────────────────────────────────────────────

/**
 * Ergebnis eines Ladevorgangs.
 *
 * `complete` hängt am **EOSE**, nicht an einem Wurf: `load()` wirft nicht, wenn
 * der Relay schweigt oder ablehnt — es löst nach seinem Zeitfenster leer auf.
 * Ohne dieses Feld sagte die Fläche „Noch keine Repositories" über einen Relay,
 * mit dem sie nie gesprochen hat (Messtabelle in `longformFeed.ts`, `LoadOutcome`).
 */
export type ForgeLoadOutcome = { complete: boolean; count: number }

const NOT_ASKED: ForgeLoadOutcome = { complete: true, count: 0 }

const warm = (events: TrustedEvent[]): void => {
    const pubkeys = new Set<string>()
    for (const event of events) {
        pubkeys.add(event.pubkey)
        // Der Pusher steht im `p`-Tag des relay-signierten 30618 — ohne ihn
        // stünde in der Zeitleiste der Relay statt des Menschen.
        for (const tag of event.tags) {
            if ((tag[0] === 'p' || tag[0] === 'maintainers') && /^[0-9a-f]{64}$/i.test(tag[1] ?? '')) {
                pubkeys.add(tag[1].toLowerCase())
            }
        }
    }
    void warmProfiles(pubkeys)
}

/**
 * Die Repo-Koordinaten eines Ereignis-Bestands — der Schlüssel für die zweite
 * Laderunde. Steht einmal hier, weil zwei Laderunden ihn brauchen
 * ({@link loadForge} und der schlanke Rail-Zwilling): eine zweite Kopie wäre
 * genau die Stelle, an der eine Klein-/Großschreibung auseinanderliefe und der
 * `#a`-Filter still nichts mehr fände.
 */
const repoAddressesOf = (events: TrustedEvent[]): string[] => [
    ...new Set(
        events
            .filter((event) => event.kind === REPO_ANNOUNCEMENT)
            .map((event) => {
                const dtag = event.tags.find((tag) => tag[0] === 'd')?.[1] ?? ''

                return dtag ? `${REPO_ANNOUNCEMENT}:${event.pubkey.toLowerCase()}:${dtag}` : ''
            })
            .filter((address) => address !== ''),
    ),
]

/**
 * Bestand der Übersicht laden — in zwei Runden, weil die zweite die Ergebnisse
 * der ersten braucht: erst Repos/Projekte/Zustände, dann alles, was per `#a` an
 * ihnen hängt (Issues, PRs, Status, Kommentare, Grabsteine).
 */
export const loadForge = async (relaySelf: string, signal?: AbortSignal): Promise<ForgeLoadOutcome> => {
    if (!WORKSPACE_URL) {
        return NOT_ASKED
    }
    await ensureRenderer().catch(() => {
        // Ohne Renderer bleibt der Text roh — die Liste selbst trägt trotzdem.
    })
    await forgeCacheReady()

    let complete = false
    const overview = overviewFilters(relaySelf)
    const base = await load({
        relays: [WORKSPACE_URL],
        filters: overview,
        signal,
        onEose: () => {
            complete = true
        },
    })
    warm(base)

    const local = localForgeEvents(overview)
    const addresses = repoAddressesOf([...base, ...local])
    if (addresses.length === 0 || signal?.aborted) {
        return { complete, count: base.length + local.length }
    }

    const content = contentFilters(addresses)
    const rest = await load({
        relays: [WORKSPACE_URL],
        filters: [...content, ...tombstoneFilters(addresses), ...tombstoneFiltersForCached(content)],
        signal,
    })
    warm(rest)

    return { complete, count: base.length + local.length + rest.length }
}

/**
 * Bestand für **eine** Repo-Seite laden — der Ladeweg der Detailfläche (P7/1).
 *
 * Unterschied zu {@link loadForge} in genau einem Punkt, und der ist der ganze
 * Zweck: die **zweite** Runde fragt nur nach diesem einen Repo
 * ({@link repoContentFilters}). `FORGE_ROOT_LIMIT` ist damit dieses Repos
 * eigenes Budget; kein Nachbar kann es aufbrauchen. Vorher lief hier
 * `loadForge`, also derselbe workspace-weite Zuschnitt wie auf der Übersicht —
 * bei einem aktiven Nachbarn zeigte die Seite still eine gekürzte Liste.
 *
 * **Die erste Runde bleibt global, und das ist kein Versehen.** Diese Fläche
 * braucht den Repo-BESTAND, nicht nur ihr eigenes Announcement: `deriveRepoView`
 * entscheidet daran, ob ein zweites sichtbares Repo denselben `d`-Tag trägt (N1,
 * dann ist ein relay-signierter Branch-Zustand nicht zuzuordnen), und seit P7/3
 * findet sie darüber die Repos mit gleichem `euc`. Runde 1 kostet drei Filter
 * mit `limit: 500` und trägt keinen `#a`-Deckel — sie war nie das Problem.
 *
 * **Die Adresse kommt aus dem `naddr`, nicht aus Runde 1.** Sie ist darin
 * vollständig enthalten (`kind:pubkey:d`), und das schliesst nebenbei die Lücke,
 * an der {@link loadForge} bei leerem Rückgabewert die zweite Runde ganz
 * ausliess (siehe {@link localForgeEvents}): hier gibt es nichts abzuleiten.
 */
export const loadRepoDetail = async (
    naddr: string,
    relaySelf: string,
    signal?: AbortSignal,
): Promise<ForgeLoadOutcome> => {
    const ziel = decodeRepoNaddr(naddr)
    if (!WORKSPACE_URL || !ziel) {
        return NOT_ASKED
    }
    await ensureRenderer().catch(() => {
        // Ohne Renderer bleibt der Text roh — die Liste selbst trägt trotzdem.
    })
    await forgeCacheReady()

    let complete = false
    const overview = overviewFilters(relaySelf)
    const base = await load({
        relays: [WORKSPACE_URL],
        filters: overview,
        signal,
        onEose: () => {
            complete = true
        },
    })
    warm(base)

    const local = localForgeEvents(overview)
    if (signal?.aborted) {
        return { complete, count: base.length + local.length }
    }

    const address = repoAddressOf(ziel.owner, ziel.dtag)
    const content = repoContentFilters(address)
    const rest = await load({
        relays: [WORKSPACE_URL],
        filters: [...content, ...tombstoneFilters([address]), ...tombstoneFiltersForCached(content)],
        signal,
    })
    warm(rest)

    return { complete, count: base.length + local.length + rest.length }
}

/**
 * **Das Live-Abo auf Grabsteine — der einzige unscoped Filter dieser Datei.**
 *
 * Bis N6 endete jede Löschung an der offenen Sitzung: {@link contentFilters}
 * trägt kein `kind 5`, also erreichte ein Grabstein den Tab erst beim nächsten
 * Seitenaufbau (dort holt ihn {@link tombstoneFiltersForCached}). Wer eine
 * Übersicht offen ließ, sah ein gelöschtes Issue beliebig lange weiter.
 *
 * **Warum er nicht gescopet werden KANN.** Buzz erzwingt beim Ingest, dass ein
 * `kind 5` **genau ein** Ziel trägt — `e` ODER `a`, nie beides
 * (`handlers/ingest.rs:2477-2489`, „deletion events must reference exactly one
 * target via e or a tag"). Der Grabstein eines Issues trägt damit zwingend nur
 * `["e", <id>]` und ist über `#a` prinzipiell nicht zu finden. Ein `#e`-Filter
 * wiederum müsste die Id-Menge kennen, die er selbst erst erzeugt — und ein
 * Abo hat, anders als eine Laderunde, keine zweite Runde: `request` sendet die
 * Filter einmal beim Aufziehen. Ein `#e`-Abo wäre also blind für genau die
 * Ereignisse, die nach dem Aufziehen entstehen.
 *
 * **Warum der unscoped Filter hier trotzdem billig ist** — und das ist gemessen,
 * nicht vermutet:
 *
 * 1. `limit: 0` heißt bei Buzz wirklich null Bestand: `handlers/req.rs:561`
 *    (`if limit == 0 { continue }`) überspringt die gespeicherte Abfrage
 *    komplett. Die Warnung in Eigenheit 3 des Modulkopfs (»ein unscoped
 *    `{kinds:[5]}` zöge die gesamte Löschhistorie«) gilt für `load`, nicht hier.
 * 2. Der Live-Ausstoß ist **nicht** die Löschhistorie der Community, sondern nur
 *    ihr global gescopeter Anteil. Buzz leitet den Kanal eines `kind 5` vom
 *    ZIEL ab (`ingest.rs:2189-2229`) und hält die Trennung symmetrisch:
 *    „Global subscriptions do NOT receive channel-scoped events"
 *    (`subscription.rs:fan_out_scoped`). Eine gelöschte Chat-Nachricht hat einen
 *    Kanal und erreicht dieses Abo deshalb nie; NIP-34-Ereignisse sind bei Buzz
 *    ausdrücklich **nie** kanal-gescopet (`ingest.rs:566-576`).
 * 3. Ein fremder Grabstein bleibt wirkungslos, zweifach verriegelt: Buzz lehnt
 *    ein `kind 5` auf ein fremdes Ereignis schon beim Ingest ab
 *    (`side_effects.rs:validate_standard_deletion_event`, „must be event
 *    author"), und welshmans `repository` zählt eine Löschung nur, wenn
 *    `pubkey === event.pubkey` (`net/…/repository.js:_isDeleted`).
 *
 * Er deckt damit beide Grabstein-Formen ab: `a` (Repo, Projekt, Zustand — die
 * Faltung in `deletionThresholds`) und `e` (Issue, PR, Kommentar — den Rest
 * erledigt der `repository`, der das Ziel aus jeder `query()` nimmt und die
 * Ableitung per `removed` benachrichtigt).
 *
 * ── Der Filterhaushalt, korrigiert ──────────────────────────────────────────
 *
 * Hier stand (P10) die Rechnung „7 Filter, die Grenze ist 10, drei Filter Luft".
 * Die Prämisse stimmt nicht: `max_filters: 10` gilt für die Filter **in einer
 * REQ-Nachricht** (`protocol.rs:92-99` prüft `arr[2..].len()`), und welshman
 * packt in eine REQ-Nachricht immer genau **einen** Filter —
 * `requestOne` schickt je Filter eine eigene REQ mit eigener sub_id
 * (`@welshman/net/…/request.js:99-104`). Auch `load` tut das: `unionFilters`
 * bündelt die Filter einer Runde nur zu einer *Liste*, die dann wieder einzeln
 * verschickt wird. Die tatsächliche Obergrenze ist `max_subscriptions: 1024` je
 * Verbindung (`nip11.rs:109`, `handlers/req.rs:25`) — dieses Abo belegt davon 6
 * statt 5. Belegt in `buzz-forge.spec.ts` („kein REQ trägt mehr als einen
 * Filter"), damit die Zahl nicht wieder aus einer Leseannahme stammt.
 *
 * ── Warum `request` und nicht `load` ────────────────────────────────────────
 *
 * `request` mit `limit:0` statt eines zweiten `load`: ein Statuswechsel oder ein
 * Kommentar soll ohne Reload erscheinen. **Ohne `autoClose`** — das Abo soll
 * genau so lange stehen wie die Fläche; beendet wird es über das `signal`.
 *
 * Bekannte Grenze, hier nicht behoben: `request` zieht nach einem
 * Verbindungsabriss **nicht** von selbst neu auf (`@welshman/net/…/request.js`
 * meldet `onDisconnect`, schließt aber nur bei `autoClose`). Der Nachzug wäre
 * dieselbe Selbstheilung wie in `userStatus.ts`; für eine Leseliste, die man
 * beim Zurückkommen ohnehin neu lädt, ist das kein tragender Mangel — es steht
 * hier, damit niemand es für erledigt hält.
 */
export const liveTombstoneFilter = (): Filter => ({ kinds: [DELETION], limit: 0 })

export const watchForge = (addresses: string[], signal: AbortSignal): void => {
    if (!WORKSPACE_URL || addresses.length === 0) {
        return
    }
    void request({
        relays: [WORKSPACE_URL],
        filters: [
            ...contentFilters(addresses).map((filter) => ({ ...filter, limit: 0 })),
            liveTombstoneFilter(),
        ],
        signal,
    })
}

// ── Schreiben: Texte und Zeilen ─────────────────────────────────────────────

/**
 * Warum eine Schreibaktion gesperrt ist — als Satz, nicht als Code.
 *
 * Die Sätze stehen HIER und nicht in `forgeWriteModels.ts`: das reine Modul
 * bleibt sprachfrei, damit es unter `node --test` ohne Katalog lädt. Dieselbe
 * Trennung wie zwischen `forgeActivity.ts` und den Verben oben.
 */
const GATE_TEXTS: Record<string, string> = {
    anonymous: 'Zum Schreiben bitte anmelden.',
    'not-actor': 'Den Status darf nur ändern, wer das Issue eröffnet hat — oder wem das Repository gehört.',
}

const gateText = (gate: WriteGate): string =>
    gate.allowed ? '' : t(GATE_TEXTS[gate.reason] ?? GATE_TEXTS.anonymous)

/**
 * Dieselben Codes, andere Sätze — je Aktion (P5).
 *
 * `not-actor` heisst bei jeder Aktion etwas anderes, und ein gemeinsamer Satz
 * („du darfst das nicht") wäre die Sorte Begründung, nach der man erst recht
 * fragt. Der Riegel ist **vor** dem Klick sichtbar; dann muss er auch sagen,
 * WER es dürfte.
 *
 * **Exportiert, damit die Vollständigkeit einen Träger hat.** `gateTextFrom`
 * fällt bei einem unbekannten Code stillschweigend auf den `anonymous`-Satz
 * zurück — dann stünde „bitte anmelden" unter einem Knopf, der aus einem ganz
 * anderen Grund zu ist, bei einem angemeldeten Nutzer. Genau diese Lücke
 * entsteht, wenn jemand einen neuen `WriteGateReason` ergänzt und die Tabellen
 * vergisst; `forgeRiegelTexte.test.ts` hält dagegen.
 */
export const ASSIGN_GATE_TEXTS: Record<string, string> = {
    anonymous: 'Zum Schreiben bitte anmelden.',
    'not-actor': 'Andere zuweisen darf nur, wer das Issue eröffnet hat, wem das Repository gehört oder wer als Maintainer eingetragen ist. Dich selbst kannst du jederzeit eintragen.',
    // F3: KEINE Berechtigungsfrage. Ohne eigenen Satz stünde hier „bitte
    // anmelden" — bei einem angemeldeten Nutzer, dem nur der Gegenstand fehlt.
    targets: 'Diese Zuweisung nennt niemanden Gültigen — oder mehr Personen, als ein Ereignis tragen kann.',
}

export const REVIEW_GATE_TEXTS: Record<string, string> = {
    anonymous: 'Zum Schreiben bitte anmelden.',
    'not-actor': 'Freigeben können angefragte Reviewer und die Verantwortlichen des Repositorys — der Autor eines Pull Requests seinen eigenen nicht.',
    'no-commit': 'Dieser Pull Request nennt keinen Commit. Eine Freigabe gilt für genau einen Stand — ohne ihn hätte sie keinen Bezug und würde von jedem Client verworfen.',
    settled: 'Dieser Pull Request ist abgeschlossen. Eine Freigabe ändert daran nichts mehr.',
}

const gateTextFrom = (texte: Record<string, string>, gate: WriteGate): string =>
    gate.allowed ? '' : t(texte[gate.reason] ?? texte.anonymous)

/** Was an einem Entwurf fehlt — als Satz für die Fläche. */
const PROBLEM_TEXTS: Record<string, string> = {
    'title-required': 'Ohne Titel geht es nicht.',
    'title-too-long': 'Der Titel ist zu lang.',
    'body-required': 'Ohne Text geht es nicht.',
    'body-too-long': 'Der Text ist zu lang.',
    'target-invalid': 'Dieses Ziel lässt sich nicht adressieren.',
}

const problemText = (problem: DraftProblem): string => (problem ? t(PROBLEM_TEXTS[problem] ?? '') : '')

/** Anzeigewort eines setzbaren Zustands — dieselbe Quelle wie die Leseansicht. */
const writableStatusLabel = (status: WritableIssueStatus): string => statusLabel(status)

/** Eine gescheiterte Schreibaktion, anzeigefertig. */
export type FailedWriteRow = {
    id: string
    /** Titel (Issue), Zielzustand (Status) oder der Kommentartext. */
    label: string
    error: string
}

const toFailedRow = (entry: PendingWrite): FailedWriteRow => ({
    id: entry.id,
    label:
        entry.what === 'status'
            ? writableStatusLabel(entry.label as WritableIssueStatus)
            : entry.label || entry.content,
    error: entry.error,
})

// ── Inseln ──────────────────────────────────────────────────────────────────

type ForgeState = {
    loading: boolean
    error: string
    kind: SpaceKind
    tab: string
    /**
     * Der Kanalbestand für den Reiter „Kanäle" — `null`, solange er unbekannt ist.
     *
     * **Ein Spiegel, keine zweite Quelle.** Gerechnet wird die Zahl an genau einer
     * Stelle (`workspaceModel.ts buildWorkspaceModel`, Feld `channelCount`) und
     * gehalten an genau einer (`WorkspaceRoomsState.channelCount`, Insel
     * `nostrWorkspaceRooms`). Diese Insel hier rechnet nichts nach und abonniert
     * nichts zusätzlich; sie bekommt den fertigen Wert per Ereignis aus ihrem
     * eigenen Nachfahren gereicht (`⚡forge.blade.php`, `x-effect`/`x-on:
     * forge-kanalbestand`). Genau das war die Auflage aus P6a — „beides zusammen
     * oder keines" richtete sich gegen einen zweiten DATENWEG, nicht gegen eine
     * Weitergabe.
     *
     * **Warum nicht einfach die Insel höher mounten**, damit der Reiter sie direkt
     * liest: gemessen am 2026-08-27 stehen zwischen Reiterstreifen und Kanal-Sektion
     * **fünf** Markup-Stellen, die ein blankes `loading` lesen (Skelett-Weiche und
     * die vier Listen-Sektionen). Beide Inseln führen ein Feld dieses Namens
     * (Schnittmenge insgesamt: `loading`, `_controller`, `_unsub`, `init`,
     * `destroy`). Ein Hochziehen des `x-data` bände alle fünf still an die falsche
     * Insel — das Skelett hinge dann am Ladezustand der Kanalliste. Der Spiegel ist
     * das kleinere Übel und das einzige, das sich prüfen lässt.
     *
     * `null` und nicht `0`: „noch nicht bekannt" und „keine Kanäle" sind zwei
     * Aussagen, und nur eine davon rechtfertigt eine Ziffer. Die Sendeseite legt
     * `null` an, solange sie lädt — dieselbe Zurückhaltung, die der Repo-Reiter
     * über `settled()` ausübt (eine Zahl, die während des Ladens wächst, liest sich
     * als Bestand und ist keiner).
     */
    kanalbestand: number | null
    /**
     * Steht die Bühne zweispaltig? Dann schaltet `tab` NICHTS mehr um — Werkbank
     * und Spur sind beide sichtbar, und `?tab=` wird vom Schalter zum Sprungziel.
     *
     * Das ist NICHT dasselbe wie „breiter als xl": im App-Host gibt es kein
     * Desktop-Chassis, dort bleiben die Tabs auf jeder Breite stehen (ein iPad Pro
     * quer misst 1366 CSS-px).
     *
     * **Bis P2 (2026-08-26) las diese Insel den gerenderten `display` der
     * Tab-Leiste zurück** (`getComputedStyle(leiste).display === 'none'`) und
     * begründete das damit, der Store kenne „nur die BREITE". Die Beobachtung war
     * richtig, die Behebung falsch: statt die Quelle zu reparieren, fragte die
     * Insel ihre eigene Ausgabe. Seit P2 hat der Store drei Werte
     * (`$store.viewport.form`), und `web-breit` ist genau diese Frage —
     * Host UND Breite, an einer Stelle abgeleitet.
     */
    zweispaltig: boolean
    overview: ForgeOverview
    _base: string
    _dead: boolean
    _controller: AbortController | null
    _unsub: (() => void) | null
    _unsubKind: (() => void) | null
    _unsubSelf: (() => void) | null
    /** Meldet den `matchMedia`-Listener der xl-Schwelle wieder ab. */
    _unsubBreite: (() => void) | null
    _relaySelf: string
    /**
     * Eine der drei Listen anfordern — aus einer Bestandskachel oder aus dem
     * Segment-Umschalter. Setzt den Tab UND den Fokus.
     */
    zeigeListe(ziel: string): void
    /** Springt zu der Region, die `?tab=` benennt — nur in der zweispaltigen Form. */
    _springZuRegion(): void
    /** Ist der Sprung schon geglückt? Er passiert genau EINMAL je Seitenaufruf. */
    _gesprungen: boolean
    /** Stand `?tab=` in der Adresse? Nur dann wird überhaupt gesprungen. */
    _tabAusAdresse: boolean
    init(): void
    destroy(): void
    _boot(): Promise<void>
    _load(): Promise<void>
    retry(): void
    /**
     * Der Text im Suchfeld der Werkbank. Rein clientseitig (`forgeSearch.ts`) —
     * der Bestand liegt ohnehin vollstaendig im Speicher.
     */
    suche: string
    isEmpty(): boolean
    /** Die Repos NACH der Suche. Leeres Feld = alle, in unveraenderter Reihenfolge. */
    sichtbareRepos(): RepoRow[]
    /** Steht eine Suche an, die nichts gefunden hat? */
    ohneTreffer(): boolean
    /**
     * Wie viele Zeilen die aktive Liste NACH der Suche zeigt — ohne Scope.
     *
     * Getrennt von {@link sichtbareAnzahl}, weil {@link ohneTreffer} eine
     * Aussage ÜBER DIE SUCHE macht. Zählte sie den Scope mit, stünde
     * „Suche zurücksetzen" unter einer Liste, die der Scope geleert hat.
     */
    _sucheTreffer(): number
    /** Der angemeldete Pubkey — `''` heisst: nicht angemeldet. */
    viewer: string
    _unsubViewer: (() => void) | null
    /** In welcher Reihenfolge die Liste steht (P6). */
    sortierung: Sortierung
    /** Welcher Ausschnitt: alle, von mir, mir zugewiesen (P6). */
    scope: Scope
    /**
     * Darf überhaupt nach „mir" gefiltert werden?
     *
     * Nur mit angemeldetem Schlüssel. Ohne ihn blendet die Fläche die Auswahl
     * aus, statt eine Option anzubieten, die per Konstruktion nichts tut.
     */
    kannScope(): boolean
    /** Wie viele Zeilen die aktive Liste NACH Suche und Scope zeigt. */
    sichtbareAnzahl(): number
    /** Wie viele es ohne Suche und Scope wären — die Bezugsgrösse daneben. */
    gesamtAnzahl(): number
    /** Suche, Scope und Sortierung innerhalb der Repo-Gruppen anwenden. */
    _gefilterteGruppen(gruppen: VorgangGruppe[]): VorgangGruppe[]
    /** Suchfeld leeren. */
    sucheLoeschen(): void
    /**
     * Die fünf Texte der Suche für die AKTIVE Liste (P7b).
     *
     * Ein Bündel und nicht fünf Methoden: sie gehören zusammen und würden sonst
     * fünfmal dieselbe Weiche stellen — fünf Gelegenheiten, dass eine davon
     * hängen bleibt und „Repositories durchsuchen" über einer Issue-Liste steht.
     */
    sucheHilfe(): { name: string; platzhalter: string; zahl: string; leer: string; felder: string }
    settled(): boolean
    counts(): ForgeCounts
    repoHref(row: { naddr: string }): string
    truncatedText(): string
    // ── Workspace-weite Listen (P3) ─────────────────────────────────────────
    /**
     * Welche Liste die linke Spur zeigt: `repos`, `issues` oder `pulls`.
     *
     * **Abgeleitet, kein zweiter Zustand.** Der Tab IST die Auswahl; ein eigenes
     * Feld daneben wäre eine zweite Wahrheit, die auseinanderläuft, sobald
     * jemand nur eine von beiden setzt. In der breiten Form steht der Strom
     * ohnehin daneben — ist der Tab `activity` (der Startwert), zeigt die linke
     * Spur weiter die Repos, genau wie vor P3.
     */
    listeAktiv(): 'repos' | 'issues' | 'pulls'
    /** Die teilbare Adresse einer Übersichts-Liste (`/forge?tab=…`). */
    forgeTabHref(tab: string): string
    issueGroups(): VorgangGruppe[]
    pullGroups(): VorgangGruppe[]
}

/** Der Entwurf eines neuen Issues, wie ihn das Formular hält. */
type IssueDraft = { open: boolean; title: string; body: string; error: string; busy: boolean }

/**
 * Die Lagen des LOKALEN KLONS — nicht die des README.
 *
 * Der Unterschied ist der ganze Punkt: es gibt **einen** Klon, und README,
 * Dateibaum und Dateianzeige lesen alle aus ihm. Hiesse dieser Zustand weiter
 * `readme`, läse sich der zweite Verbraucher wie ein Sonderfall des ersten —
 * und der nächste baute sich seinen eigenen Ladeweg daneben.
 *
 * `pruefe` ist der Anfangszustand und NICHT `bereit`: ob das Repository schon
 * lokal liegt, weiss erst ein Blick in IndexedDB. Wer hier zweiwertig anfängt,
 * zeigt einem Nutzer, der es längst hat, eine Download-Aufforderung.
 */
export type KlonLage = {
    lage: 'pruefe' | 'keine-url' | 'fremd' | 'bereit' | 'laedt' | 'da' | 'leer' | 'fehler'
    /** Dateiname des gefundenen README, `''` wenn keins da ist. */
    name: string
    /** Gerendertes Markdown — nur gesetzt, wenn `istMarkdown(name)`. */
    html: string
    /** Rohtext, wenn es kein Markdown ist. */
    text: string
    fehler: KlonFehler | ''
    fortschritt: Fortschritt | null
    /** Kurz-Hash des Kopf-Commits, für „Stand". */
    commit: string
    /** Die `web`-URL, wenn das Repository woanders liegt. */
    fremdUrl: string
}

/**
 * Die Lage des Code-Browsers — Baum ODER eine geöffnete Datei, nie beides.
 *
 * `datei === ''` heisst: der Baum steht im Bild. Zwei Felder „zeigeBaum" und
 * „zeigeDatei" wären zwei Wahrheiten über dasselbe.
 */
export type CodeLage = {
    /** Aktuelles Verzeichnis, `''` = Wurzel. */
    pfad: string
    eintraege: BaumEintrag[]
    /** Geöffnete Datei (voller Pfad), `''` = keine. */
    datei: string
    art: DateiArt | ''
    /** Gerendertes Markdown. */
    html: string
    /** Klartext — bereits auf {@link ZEILEN_GRENZE} gekürzt. */
    text: string
    /** Blob-URL eines Bildes; wird beim Wechsel freigegeben. */
    bildUrl: string
    groesse: number
    gekuerzt: boolean
    /** Wahre Zeilenzahl, auch wenn gekürzt wurde. */
    zeilen: number
    laedt: boolean
    fehler: string
}

/**
 * Die Lage des PR-Diffs EINES Vorschlags (P7b).
 *
 * `quelle` ist die Antwort auf „woher käme er" und steht **ohne ein Byte Netz**
 * fest ({@link prDiffQuelle}); erst `lage: 'laedt'` fasst das Netz an. Die
 * Trennung ist der Grund, warum die Kostenansage VOR dem Download stehen kann
 * und nicht danach: die Fläche weiß beim ersten Rendern schon, ob es überhaupt
 * etwas zu holen gibt.
 */
export type PrDiffLage = {
    /**
     * `quelle` = die Ansage steht (oder die Auskunft, dass es nichts zu holen
     * gibt) · `laedt` · `da` · `fehler`. Eine Maschine, kein Bündel Flags:
     * „lädt UND Fehler" ist ein Zustand, den die Fläche nicht darstellen kann.
     */
    lage: 'quelle' | 'laedt' | 'da' | 'fehler'
    quelle: PrDiffQuelle
    diff: ParsedDiff
    stat: DiffStat
    fehler: PrDiffFehler | ''
    fortschritt: Fortschritt | null
    /**
     * Die Spitze, für die dieser Diff gilt.
     *
     * Ein 1619 verschiebt `c` UND `merge-base` — ein danach noch angezeigter
     * Diff gehörte zu einem Stand, den es nicht mehr gibt. Beim Neubau der Karte
     * entscheidet dieses Feld, ob das geladene Ergebnis mit hinüberdarf.
     */
    _spitze: string
}

const leerePrDiffLage = (quelle: PrDiffQuelle): PrDiffLage => ({
    lage: 'quelle',
    quelle,
    diff: EMPTY_DIFF,
    stat: { files: 0, additions: 0, deletions: 0 },
    fehler: '',
    fortschritt: null,
    _spitze: quelle.art === 'ladbar' ? quelle.spitze : '',
})

type ForgeRepoState = {
    loading: boolean
    error: string
    missing: boolean
    kind: SpaceKind
    tab: string
    /**
     * Steht der Steckbrief in einer eigenen SPUR (statt hinter einem
     * Aufklapper)? Dann ist er offen, und zwar unverhandelbar: seine
     * Zusammenfassung ist in dieser Form `display: none`, es gäbe also keinen
     * Weg mehr, ihn wieder aufzuziehen.
     *
     * Startwert `false` — die harmlose Ausfallrichtung, dieselbe wie bei
     * `zweispaltig` auf der Übersicht: ohne Messung bleibt es beim Aufklapper,
     * und der funktioniert auf jeder Breite.
     */
    steckbriefSpur: boolean
    /** Liest am DOM ab, welche Form der Steckbrief gerade hat. */
    _messeSteckbrief(): void
    /** Hängt den Breitenbeobachter an die Bühne — genau einmal. */
    _beobachteBreite(): void
    /** Beobachtet die Bühne, weil eine Container-Schwelle kein `matchMedia` hat. */
    _breiteBeobachter: ResizeObserver | null
    view: RepoView | null
    open: Record<string, boolean>
    /** Der angemeldete Pubkey — `''` heißt: nicht angemeldet. */
    viewer: string
    /** Laufende und gescheiterte Schreibvorgänge (aus `forgeWrite.ts`). */
    pending: PendingWrite[]
    issueDraft: IssueDraft
    /** Neu gezeichnet, wenn sich ein Riegel ändert — `isBusy` ist kein Store. */
    busyTick: number
    /**
     * Der @-Vorschlag. EIN Zustand für alle Composer dieser Seite (das Issue-
     * Anlege-Formular) — `target` sagt, welches Feld gerade tippt. Zwei offene
     * Vorschläge kann es nicht geben: es tippt immer nur ein Feld.
     */
    mention: { open: boolean; items: MentionItemLike[]; index: number; query: string; target: string }
    /**
     * Was aus der Weckmeldung wurde, je Absendeziel (`issue` oder
     * `comment:<wurzel-id>`) — auch der Fall „es ging keine raus".
     *
     * **Der leere Fall ist der wichtige.** Wer `@ceo` schreibt und absendet,
     * wartet sonst auf eine Antwort, die per Konstruktion nie kommt: das Repo
     * hängt an keinem Kanal, oder der Agent antwortet diesem Autor nicht. Ein
     * stilles Nichts wäre hier die schlechteste aller Rückmeldungen.
     */
    wakeNotice: Record<string, { tone: 'ok' | 'warn'; text: string }>
    /**
     * Der Zustand des lokalen Klons (P6) — GETEILT von README, Baum und
     * Dateianzeige. Eine Zustandsmaschine, kein Bündel Flags: „lädt UND Fehler"
     * wäre ein Zustand, den die Fläche nicht darstellen kann.
     */
    klon: KlonLage
    /** Der Code-Browser (P6). Liest aus demselben Klon wie das README. */
    code: CodeLage
    /** Was lokal in IndexedDB liegt — erst auf Nachfrage gefüllt. */
    speicher: { offen: boolean; klone: { owner: string; dtag: string; nutzdaten: number }[]; belegt: number; kontingent: number }
    codeOeffnen(pfad: string): Promise<void>
    dateiOeffnen(pfad: string): Promise<void>
    dateiSchliessen(): void
    codeHoch(): Promise<void>
    krumel(): { name: string; pfad: string }[]
    speicherUmschalten(): Promise<void>
    klonEntfernen(owner: string, dtag: string): Promise<void>
    /** Bricht den laufenden Download ab (`fetchOptions.signal` in `gitBrowser.ts`). */
    _klonAbbruch: AbortController | null
    /** Prüft, ob das Repository schon lokal liegt — OHNE Netz. */
    klonPruefen(): Promise<void>
    /** Startet den Download. Nur auf ausdrücklichen Klick. */
    klonLaden(): Promise<void>
    klonAbbrechen(): void
    /** Verwirft den lokalen Klon und lädt neu. */
    klonNeuLaden(): Promise<void>
    /** Der übersetzte Satz zum Fehlercode. */
    klonFehlerText(): string
    /** Liest aus dem LOKALEN Klon — ohne Netz. */
    _readmeLesen(): Promise<void>
    /** „12,3 MB" o. ä. — Zahl und Einheit getrennt gebildet. */
    groessenText(bytes: number): string
    /**
     * Der Text im Suchfeld der Detailseite (P7b). EIN Zustand für alle drei
     * Vorgangsreiter: es tippt immer nur einer, und drei Felder mit drei
     * Zuständen wären drei Wahrheiten über dieselbe Frage.
     */
    suche: string
    sichtbareIssues(): RepoView['issues']
    sichtbarePulls(): RepoView['pullRequests']
    sichtbarePatches(): RepoView['patches']
    /** Wie viele Vorgänge der aktive Reiter OHNE Suche hätte. */
    vorgaengeGesamt(): number
    /** Wie viele nach der Suche übrig sind. */
    vorgaengeSichtbar(): number
    /** Der zugängliche Name des Suchfelds — folgt dem Reiter. */
    detailSucheName(): string
    /** Die Zählzeile („:count von :total …") — folgt dem Reiter. */
    detailSucheZahl(): string
    /** Der Satz über null Treffern — folgt dem Reiter. */
    detailSucheLeer(): string
    _naddr: string
    _dead: boolean
    _controller: AbortController | null
    _unsub: (() => void) | null
    _unsubKind: (() => void) | null
    _unsubSelf: (() => void) | null
    _unsubViewer: (() => void) | null
    _unsubPending: (() => void) | null
    _unsubMembers: (() => void) | null
    _unsubAgents: (() => void) | null
    _relaySelf: string
    /** Mitglieder-Vorschläge aus dem Space-Directory (13534 + kind 0). */
    _members: MentionItemLike[]
    /** Agenten-Vorschläge, bereits auf Kanal und Betrachter gefiltert. */
    _agentItems: MentionItemLike[]
    /** Letzter Stand des Agenten-Verzeichnisses (Einträge + Relay-Art + Betrachter). */
    _agentView: AgentDirectoryView | null
    /** Schon angeforderte Profile — verhindert dieselbe Anfrage bei jedem Update. */
    _loadedProfiles: Set<string>
    /**
     * Die Kanäle DIESES Nutzers in diesem Space (39000 aus `roomsByUrl`).
     *
     * Der Riegel gegen einen fremdgesetzten Zielkanal: `buzz-channel` steht in
     * einem 30617, das jedes Relay-Mitglied ankündigen darf. Begründung und
     * Messung stehen an `planWake`.
     */
    _channelIds: Set<string>
    _unsubRooms: (() => void) | null
    /** Index des `@` im Entwurf, `-1` = kein offener Vorschlag. */
    _mentionStart: number
    init(): void
    destroy(): void
    _boot(): Promise<void>
    _load(): Promise<void>
    retry(): void
    toggle(id: string): void
    statusText(code: string): string
    truncatedText(): string
    /**
     * Gibt es in diesem Browser überhaupt einen Kopier-Weg?
     *
     * `navigator.clipboard` existiert **nur in sicheren Kontexten** (HTTPS oder
     * localhost). Über eine nackte HTTP-Adresse im LAN — der Fall, der bei einer
     * selbst betriebenen Instanz wirklich vorkommt — ist die Eigenschaft schlicht
     * `undefined`. Ein Knopf, der dann nichts tut, wäre schlechter als kein Knopf:
     * die Zeile ist auch ohne ihn per `select-all` mit einem Klick markiert und von
     * Hand kopierbar. Deshalb entscheidet diese Frage über das RENDERN des Knopfes,
     * nicht über sein Verhalten.
     */
    canCopyClone(): boolean
    copyClone(): void
    // ── Schreiben: die Werkzeuge EINES Vorgangs kommen aus dem Mixin ────────
    // (Kommentar, Status, Zuweisen, Review, Diff, Erwähnung, Weckruf — seit P1
    // an `forgeVorgangWerkzeuge` geteilt mit der Einzel-Insel). Diese Insel
    // behält eigenständig, was nur sie hat: das Issue-ANLEGEN.
    anlegeZiel(desktop: boolean): AnlegeForm
    toggleIssueDraft(): void
    submitIssue(): Promise<void>
    failedIssues(): FailedWriteRow[]
    /**
     * Überschreibt die Werkzeug-Form: das Ziel `issue` gehört dem Anlege-
     * Formular dieser Fläche, alle anderen Ziele (`comment:*`, `assign:*`)
     * trägt das Werkzeug.
     */
    pickMention(item: MentionItemLike): void
} & typeof forgeVorgangWerkzeuge

/** Was `_wake` über den Vorgang wissen muss, den es meldet. */
type WakeTargetInput = { art: 'issue' | 'pr'; eventId: string; what: 'issue' | 'comment' }

/**
 * Registrierung der beiden Inseln.
 *
 * Steht in DIESEM Modul und nicht in `bridge.ts` — dort bleibt eine
 * Importzeile und ein Aufruf, wie bei `wireRail`, `wirePalette`,
 * `wireDisplayPrefs` und `wireRoomSearch`.
 */

/**
 * Der Tab aus `?tab=` — die einzige Stelle, an der die Repo-Seite ihren
 * Startzustand von außen bekommt.
 *
 * Nur die beiden Werte, die die Rail verlinkt; alles andere (auch ein
 * `?tab=activity` von Hand) fällt auf den bisherigen Startwert zurück. Ein
 * ungeprüfter Query-Wert in `x-model="tab"` zeigte sonst schlicht keinen Tab.
 */
const tabFromLocation = (): string => {
    try {
        const tab = new URLSearchParams(window.location.search).get('tab')

        // `patches` seit P5 (2026-08-23). Die Rail und die Werkbank verlinken
        // gezielt auf eine Liste; ein `?tab=`, das still auf „Issues" fiele,
        // zeigte etwas anderes als die Zeile, die dorthin geführt hat.
        return tab === 'issues' || tab === 'pulls' || tab === 'patches' || tab === 'activity' || tab === 'code'
            ? tab
            : 'issues'
    } catch {
        return 'issues'
    }
}
/**
 * Die Schreib- und Anzeigewerkzeuge EINES Vorgangs (P1, GitHub-Parität).
 *
 * **Warum ein plain object und keine Basisklasse:** Zwei Inseln mit grund-
 * verschiedenem Boot teilen sich die HANDHABE an einem Vorgang — Kommentar,
 * Status, Zuweisung, Review, Diff, Erwähnung, Weckruf. Die Repo-Insel
 * (`nostrForgeRepo`) braucht davon nach dem Akkordeon-Rückbau nur Riegel,
 * Erwähnung und Weckruf (Issue-Anlegen); die Einzel-Insel
 * (`nostrForgeVorgang`) braucht alles. Ein Mixin über Objekt-Spread hält die
 * Werkzeuge an EINER Stelle, ohne einer der beiden einen Boot aufzuzwingen,
 * den die andere nicht braucht. Alpine wertet das gemergte Objekt aus;
 * `this` ist das jeweilige State-Objekt.
 *
 * **Der Issue-Entwurf (`issueDraft`) gehört NICHT hierher:** Er ist eine
 * Eigenschaft der Repo-Fläche (FAB + Kopfleiste), nicht des Vorgangs.
 * `pickMention` trägt deshalb keinen `issue`-Zweig — die Repo-Insel
 * überschreibt ihn für ihr Anlege-Formular und reicht alle anderen Ziele
 * an {@link forgeVorgangWerkzeuge.pickMention} weiter.
 */
const forgeVorgangWerkzeuge = {
    // ── Riegel ─────────────────────────────────────────────────────────────
    // **Wer nicht darf, sieht das VOR dem Absenden.** Zwei Ebenen, und sie
    // sind nicht dasselbe: `writeGate` fragt nur, ob überhaupt jemand
    // angemeldet ist (der Relay lässt kein Nicht-Mitglied bis zum Lesen
    // kommen, siehe `memberGate`), `statusGateFor` fragt zusätzlich, ob
    // dieser Mensch für DIESES Issue zuständig ist. Der zweite Riegel ist
    // der wichtige: der Relay nimmt einen Statuswechsel von jedem an und
    // zeigt ihn dann nirgends an — ein stiller Leerlauf.
    writeGate() {
        return memberGate(this.viewer)
    },
    writeHint() {
        return gateText(this.writeGate())
    },
    canWrite() {
        return this.writeGate().allowed
    },

    // ── Kommentar ──────────────────────────────────────────────────────────
    commentBusy(rootId: string) {
        // `busyTick` steht hier, damit Alpine die Bindung überhaupt neu
        // auswertet: `isBusy` liest ein Modul-`Set`, das kein Store ist.
        return this.busyTick >= 0 && isBusy(`comment:${rootId}`)
    },
    async submitComment(root, art = 'issue') {
        const draft = this.commentDraft[root.id] ?? ''
        const problem = commentDraftProblem(draft, {
            rootId: root.id,
            repoAddress: root.repoAddress,
        })
        if (problem) {
            this.commentError = { ...this.commentError, [root.id]: problemText(problem) }

            return
        }
        if (isBusy(`comment:${root.id}`)) {
            return
        }
        this.commentError = { ...this.commentError, [root.id]: '' }
        this.dismissWake(`comment:${root.id}`)
        this.busyTick += 1
        const outcome = await publishForgeComment(
            {
                repoAddress: root.repoAddress,
                rootId: root.id,
                rootAuthor: root.author,
                lastCreatedAt: root.comments.reduce(
                    (latest, comment) => Math.max(latest, comment.createdAt),
                    0,
                ),
            },
            draft,
        )
        if (this._dead) {
            return
        }
        this.busyTick += 1
        this.commentError = { ...this.commentError, [root.id]: outcome.error }
        if (!outcome.error) {
            this.commentDraft = { ...this.commentDraft, [root.id]: '' }
        }
        if (!outcome.error && outcome.id) {
            // Der Verweis zeigt auf die WURZEL: für einen Kommentar gibt
            // es keinen `buzz://`-Link, und der Agent soll ohnehin den
            // ganzen Vorgang sehen, nicht nur die letzte Zeile.
            await this._wake(`comment:${root.id}`, draft, {
                art,
                eventId: root.id,
                what: 'comment',
            })
        }
    },

    // ── Status ─────────────────────────────────────────────────────────────
    statusOptions() {
        return WRITABLE_ISSUE_STATUSES.map((code) => ({ code, label: statusLabel(code) }))
    },
    statusGateFor(row) {
        return statusGate(this.viewer, row)
    },
    canSetStatus(row) {
        return this.statusGateFor(row).allowed
    },
    statusHint(row) {
        return gateText(this.statusGateFor(row))
    },
    statusBusy(rootId: string) {
        return this.busyTick >= 0 && isBusy(`status:${rootId}`)
    },
    async setStatus(row, code) {
        if (!this.canSetStatus(row) || row.status === code || isBusy(`status:${row.id}`)) {
            return
        }
        this.busyTick += 1
        const outcome = await publishIssueStatus(
            {
                repoAddress: row.repoAddress,
                rootId: row.id,
                rootAuthor: row.author,
                // Der Stempel des GELTENDEN Status: ein neues Ereignis in
                // derselben Sekunde entschiede sonst per Id-Tiebreak, und
                // der alte Zustand könnte gewinnen.
                statusCreatedAt: this._statusCreatedAt(row.id),
            },
            code,
            // Die Nachprüfung liest, was die FLÄCHE zeigt — nicht, was der
            // Relay quittiert hat. Genau das ist der Unterschied, den
            // `OK true` verschweigt.
            () => this.view?.issues.find((issue) => issue.id === row.id)?.status ?? '',
        )
        if (this._dead) {
            return
        }
        this.busyTick += 1
        // **Nur wenn es gar nicht erst losgeflogen ist.** Ein Fehler MIT
        // Id steht bereits als rote Zeile da (`failedFor`) — ihn hier
        // zusätzlich ins Kommentarfeld zu schreiben, zeigte dieselbe
        // Meldung zweimal untereinander. Ohne Id (kein Signer, Riegel
        // greift, unbekannter Zustand) gibt es dagegen keinen Merker,
        // und ohne diese Zeile bliebe der Klick stumm.
        if (outcome.error && !outcome.id) {
            this.commentError = { ...this.commentError, [row.id]: outcome.error }
        }
    },
    /**
     * `created_at` des derzeit geltenden Statuswechsels dieses Issues.
     *
     * Aus dem Merker der Anzeige abgeleitet: `updatedAt` ist die jüngste
     * Regung überhaupt (Status ODER Kommentar). Das überschätzt den Wert
     * nie nach unten — und genau das ist gefragt, denn zu klein hieße,
     * den Gleichstand nicht zu vermeiden.
     */
    _statusCreatedAt(rootId: string) {
        const issue = this.view?.issues.find((row) => row.id === rootId)

        return issue ? issue.updatedAt : 0
    },

    // ── Zuweisen (P5/P10 — Körper unverändert, neuer Ort) ──────────────────
    istZugewiesen(row) {
        return this.viewer !== '' && row.assignees.includes(this.viewer.toLowerCase())
    },
    /**
     * Der Riegel vor dem Zuweisen — **mit sich selbst als Ziel**.
     *
     * Die Fläche bietet genau die Selbstbedienung an („Mir zuweisen" /
     * „Zuweisung entfernen"). Fremde zuzuweisen bräuchte eine Personenauswahl;
     * die Regel dafür steht in `assignGate` bereits, die Fläche dazu in der
     * Einzelansicht.
     */
    assignGateFor(row) {
        return assignGate(this.viewer, { author: row.author, repoAddress: row.repoAddress, maintainers: this.view?.repo.maintainers ?? [] }, [this.viewer])
    },
    canAssignSelf(row) {
        return this.assignGateFor(row).allowed
    },
    assignHint(row) {
        return gateTextFrom(ASSIGN_GATE_TEXTS, this.assignGateFor(row))
    },
    assignBusy(rootId: string) {
        return this.busyTick >= 0 && isBusy(`assign:${rootId}`)
    },
    /**
     * Sich selbst eintragen oder wieder austragen.
     *
     * EIN Knopf für zwei Operationen, weil es aus Sicht des Nutzers eine
     * Handlung mit zwei Richtungen ist. Der Unterschied steckt im Label
     * — und im `prior`: eine Entziehung ohne Bezug verlöre gegen eine
     * autoritative Zuweisung (`foldAssignments`, Phase 1 vor Phase 2).
     * Der Kopf kommt aus `assignmentHeads` (P1) und ist genau dieser
     * Bezug.
     */
    async toggleAssignSelf(row) {
        if (!this.canAssignSelf(row) || isBusy(`assign:${row.id}`)) {
            return
        }
        const label = this.istZugewiesen(row) ? 'unassignment' : 'assignment'
        this.busyTick += 1
        const outcome = await publishAssignment(
            {
                repoAddress: row.repoAddress,
                rootId: row.id,
                targets: [this.viewer],
                prior: row.assignmentHeads[this.viewer.toLowerCase()] ?? '',
            },
            label,
            // Die Nachprüfung liest den GEFALTETEN Ist-Zustand, nicht die
            // Zeile aus dem Klick-Augenblick: `row` ist eine Momentaufnahme,
            // `this.view` zieht mit jeder Ableitung nach. Genau darum geht es
            // — der `prior` kann zwischen Rendern und Faltung veraltet sein (F2).
            () => {
                const frisch = this.view?.issues.find((issue) => issue.id === row.id)

                return frisch?.assignees.includes(this.viewer.toLowerCase()) ?? false
            },
        )
        this.busyTick += 1
        if (outcome.error) {
            toast(outcome.error)
        }
    },
    assignPicksFor(rootId: string) {
        return this.assignPicks[rootId] ?? []
    },
    /**
     * Darf der Betrachter hier überhaupt Fremde eintragen?
     *
     * Nur für den LEEREN Zustand der Auswahl gedacht — sobald jemand
     * gewählt ist, antwortet {@link assignOthersGateFor} genauer.
     */
    darfFremdeZuweisen(row) {
        return canAssignOthers(this.viewer, {
            author: row.author,
            repoAddress: row.repoAddress,
            maintainers: this.view?.repo.maintainers ?? [],
        })
    },
    /**
     * Der Riegel gegen die TATSÄCHLICH gewählten Personen.
     *
     * Er wird bei jeder Änderung der Auswahl neu gestellt — das ist der
     * ganze Punkt: die Fläche beantwortet „wen darfst du" beim Wählen
     * und nicht erst beim Absenden.
     */
    assignOthersGateFor(row) {
        return assignGate(
            this.viewer,
            { author: row.author, repoAddress: row.repoAddress, maintainers: this.view?.repo.maintainers ?? [] },
            this.assignPicksFor(row.id).map((item) => item.pubkey),
        )
    },
    canAssignPicked(row) {
        return this.assignPicksFor(row.id).length > 0 && this.assignOthersGateFor(row).allowed
    },
    /**
     * Der Satz unter dem Knopf — auch dann, wenn noch niemand gewählt ist.
     *
     * **Der leere Fall bekommt bewusst NICHT den Gate-Satz.** Ohne Ziel
     * liefert `assignGate` den Grund `targets`, und der spräche einen
     * Nutzer an, der gerade erst hinsieht, über etwas, das er noch gar
     * nicht getan hat.
     */
    assignOthersHint(row) {
        if (this.assignPicksFor(row.id).length === 0) {
            return this.darfFremdeZuweisen(row) ? '' : t(ASSIGN_GATE_TEXTS['not-actor'])
        }

        return gateTextFrom(ASSIGN_GATE_TEXTS, this.assignOthersGateFor(row))
    },
    /**
     * Tippen im Suchfeld — dasselbe Popover, anderer Auslöser.
     *
     * Im Composer beginnt ein Vorschlag mit `@` (`mentionQueryAt`); hier
     * IST das Feld die Suche, ein Präfix wäre ein erfundenes Ritual.
     * `_mentionStart = 0` ist kein Textversatz, sondern der Merker, an
     * dem `_recomputeAgentItems` erkennt, dass eine offene Suche läuft
     * und ein spät eintreffendes 10100 noch nachgereicht werden muss.
     */
    onAssignInput(el: HTMLInputElement, rootId: string) {
        const query = el.value.trim()
        this.assignQuery = { ...this.assignQuery, [rootId]: el.value }
        const target = `assign:${rootId}`
        this._mentionStart = 0
        const items = this._mentionItemsFor(query, target)
        this.mention = { open: items.length > 0, items, index: 0, query, target }
    },
    removeAssignPick(rootId: string, pubkey: string) {
        this.assignPicks = {
            ...this.assignPicks,
            [rootId]: this.assignPicksFor(rootId).filter((item) => item.pubkey !== pubkey),
        }
    },
    /**
     * Die gewählten Personen eintragen — oder ihre Zuweisung entziehen.
     *
     * **Zwei Verben, ein Gegenstand.** `foldAssignments` addiert je
     * genanntem Schlüssel und subtrahiert je genanntem Schlüssel; eine
     * Zuweisung ersetzt also NICHT die bestehende Menge. Damit sind
     * beide Richtungen auf derselben Auswahl sinnvoll, und ein
     * versehentlich eingetragener Agent ist mit denselben zwei Klicks
     * wieder draussen. Ein Weg ohne Rückweg wäre hier besonders teuer:
     * am Relay steht das Ereignis dauerhaft.
     */
    async submitAssignOthers(row, label) {
        if (!this.canAssignPicked(row) || isBusy(`assign:${row.id}`)) {
            return
        }
        const targets = this.assignPicksFor(row.id).map((item) => item.pubkey.toLowerCase())
        const self = this.viewer.toLowerCase()
        const nurSelbst = targets.length === 1 && targets[0] === self
        this.busyTick += 1
        const outcome = await publishAssignment(
            {
                repoAddress: row.repoAddress,
                rootId: row.id,
                targets,
                prior: nurSelbst ? (row.assignmentHeads[self] ?? '') : '',
            },
            label,
            // Dieselbe Nachprüfung wie bei der Selbstbedienung, nur über
            // mehrere Namen. Die zwei Prädikate sind nicht symmetrisch
            // und dürfen es nicht sein: eine Zuweisung gilt erst, wenn
            // ALLE Genannten stehen; eine Entziehung erst, wenn KEINER
            // mehr steht.
            () => {
                const frisch = this.view?.issues.find((issue) => issue.id === row.id)
                if (!frisch) {
                    return false
                }

                return label === 'assignment'
                    ? targets.every((pk) => frisch.assignees.includes(pk))
                    : targets.some((pk) => frisch.assignees.includes(pk))
            },
        )
        this.busyTick += 1
        if (outcome.error) {
            toast(outcome.error)

            return
        }
        // Erst nach dem Erfolg leeren: schlägt es fehl, steht die Auswahl
        // noch da und der zweite Versuch kostet keinen zweiten Suchlauf.
        this.assignPicks = { ...this.assignPicks, [row.id]: [] }
        this.assignQuery = { ...this.assignQuery, [row.id]: '' }
    },

    // ── Review (P5) ────────────────────────────────────────────────────────
    approveGateFor(row) {
        return approveGate(this.viewer, {
            author: row.author,
            repoAddress: row.repoAddress,
            maintainers: this.view?.repo.maintainers ?? [],
            reviewers: row.reviewers,
            commit: row.commit,
            status: row.status,
        })
    },
    canApprove(row) {
        return this.approveGateFor(row).allowed
    },
    approveHint(row) {
        return gateTextFrom(REVIEW_GATE_TEXTS, this.approveGateFor(row))
    },
    reviewBusy(rootId: string) {
        return this.busyTick >= 0 && isBusy(`review:${rootId}`)
    },
    /**
     * Die eigene, aktuell gültige Entscheidung — `''`, wenn keine steht.
     *
     * Aus derselben gefalteten Liste, die die Reviewer-Zeile zeigt. Der
     * Knopf sagt damit „freigegeben" statt „freigeben", wenn es schon
     * getan ist; ein Klick darauf ist dann kein zweites Ereignis wert.
     */
    eigeneEntscheidung(row) {
        const self = this.viewer.toLowerCase()
        if (row.approvals.some((d) => d.author === self)) {
            return 'approval'
        }

        return row.changeRequests.some((d) => d.author === self) ? 'changes-requested' : ''
    },
    async submitReview(row, label) {
        if (!this.canApprove(row) || isBusy(`review:${row.id}`) || this.eigeneEntscheidung(row) === label) {
            return
        }
        this.busyTick += 1
        const outcome = await publishReview(
            { repoAddress: row.repoAddress, rootId: row.id, commit: row.commit },
            label,
        )
        this.busyTick += 1
        if (outcome.error) {
            toast(outcome.error)
        }
    },

    // ── PR-Diff (P7b) ──────────────────────────────────────────────────────
    //
    // Ein kind 1618 trägt seinen Diff NICHT bei sich — anders als ein
    // 1617, dessen Unified Diff im `content` steht. Es nennt zwei
    // Commit-Ids und eine clone-URL; was dazwischen liegt, weiß nur Git.
    // Deshalb ist das hier ein zweiter, ANGESAGTER Ladeweg und keine
    // Anzeige über vorhandene Daten.
    _prDiffKarteNeu(view) {
        if (!view) {
            return
        }
        const neu = {}
        for (const pr of view.pullRequests) {
            const quelle = prDiffQuelle({
                cloneUrls: pr.cloneUrls,
                // Der Link im Fremdfall kommt aus den `web`-Tags des
                // REPOS: ein 1618 trägt keine.
                webUrls: view.repo.webUrls,
                commit: pr.commit,
                mergeBase: pr.mergeBase,
                workspaceUrl: WORKSPACE_URL,
            })
            const alt = this.prDiff[pr.id]
            const spitze = quelle.art === 'ladbar' ? quelle.spitze : ''
            // Ein geladener Diff darf mit hinüber — aber nur, wenn er
            // noch zu dieser Spitze gehört. Ein 1619 verschiebt `c` und
            // `merge-base`; der alte Diff zeigte dann einen Stand, den
            // es nicht mehr gibt.
            neu[pr.id] =
                alt && alt._spitze === spitze ? { ...alt, quelle } : leerePrDiffLage(quelle)
        }
        this.prDiff = neu
    },
    prDiffVon(pr) {
        return (
            this.prDiff[pr.id] ??
            leerePrDiffLage({ art: 'unvollstaendig', fehlt: 'beides' })
        )
    },
    /**
     * **Zwei der Codes sind gar keine Fehler.** `spitze-fehlt` heißt: der
     * Endpunkt kennt diesen Commit nicht — der Vorschlag kommt aus einem
     * Fork, den NIP-34 ausdrücklich zulässt. `basis-fehlt` heißt: der
     * Vergleichspunkt liegt tiefer, als dieser Client geholt hat. Beide
     * bekommen einen Satz, der SAGT was ist, statt zu behaupten, etwas
     * sei kaputt.
     */
    prDiffFehlerText(pr) {
        const codes = {
            'nicht-angemeldet': 'Zum Laden musst du angemeldet sein — der Git-Zugang wird signiert (NIP-98).',
            'kein-zugriff': 'Der Relay hat den Zugriff abgelehnt. Entweder bist du kein Mitglied des Kanals, zu dem dieses Repository gehört, oder die Signatur ist abgelaufen.',
            netz: 'Der Git-Endpunkt war nicht erreichbar.',
            abgebrochen: 'Abgebrochen.',
            'spitze-fehlt': 'Dieser Git-Endpunkt kennt den vorgeschlagenen Stand nicht — er liegt in einer Kopie des Repositories, die hier nicht abrufbar ist.',
            'basis-fehlt': 'Der Vergleichspunkt liegt weiter zurück, als hier geholt wurde. Die Dateiliste lässt sich daraus nicht bilden.',
            unbekannt: 'Die Dateiliste liess sich nicht bilden.',
        }
        const fehler = this.prDiffVon(pr).fehler

        return fehler ? t(codes[fehler] ?? codes.unbekannt) : ''
    },
    prDiffAbbrechen(pr) {
        this._prDiffAbbruch[pr.id]?.abort()
        delete this._prDiffAbbruch[pr.id]
        const lage = this.prDiffVon(pr)
        this.prDiff = {
            ...this.prDiff,
            [pr.id]: { ...lage, lage: 'quelle', fehler: '', fortschritt: null },
        }
    },
    async prDiffLaden(pr) {
        const repo = this.view?.repo
        const lage = this.prDiffVon(pr)
        if (!repo || lage.quelle.art !== 'ladbar' || lage.lage === 'laedt') {
            return
        }
        const quelle = lage.quelle
        const abbruch = new AbortController()
        this._prDiffAbbruch[pr.id] = abbruch
        const setze = (teil) => {
            // Nur schreiben, solange DIESER Vorgang läuft: ein abgebrochener
            // Fetch feuert noch Fortschritte nach, und die schrieben sonst
            // über eine neue Lage.
            if (this._prDiffAbbruch[pr.id] === abbruch && !this._dead) {
                this.prDiff = { ...this.prDiff, [pr.id]: { ...this.prDiffVon(pr), ...teil } }
            }
        }
        setze({ lage: 'laedt', fehler: '', fortschritt: null })
        try {
            const g = await import('./gitBrowser.ts')
            const paare = await g.holePrDateipaare({
                url: quelle.url,
                owner: repo.owner,
                dtag: repo.dtag,
                basis: quelle.basis,
                spitze: quelle.spitze,
                signal: abbruch.signal,
                aufFortschritt: (f) => setze({ fortschritt: f }),
            })
            if (this._prDiffAbbruch[pr.id] !== abbruch || this._dead) {
                return
            }
            const diff = baueDiff(paare)
            setze({ lage: 'da', diff, stat: diffStat(diff), fortschritt: null })
        } catch (error) {
            if (this._prDiffAbbruch[pr.id] !== abbruch || this._dead) {
                return
            }
            // Der eigene Code gewinnt gegen die Einordnung nach Wortlaut:
            // `spitze-fehlt` ist eine AUSKUNFT (der Tip liegt in einem
            // Fork), kein Netzfehler, und `ordneFehlerEin` kennt ihn nicht.
            const eigen = error?.code ?? ''
            const code =
                eigen === 'spitze-fehlt' || eigen === 'basis-fehlt'
                    ? eigen
                    : ordneFehlerEin(error)
            // Den ORIGINALFEHLER protokollieren, nicht nur den Code —
            // dieselbe Begründung wie beim Klon.
            console.warn('[forge] PR-Diff fehlgeschlagen', code, error)
            setze(
                code === 'abgebrochen'
                    ? { lage: 'quelle', fehler: '', fortschritt: null }
                    : { lage: 'fehler', fehler: code, fortschritt: null },
            )
        } finally {
            if (this._prDiffAbbruch[pr.id] === abbruch) {
                delete this._prDiffAbbruch[pr.id]
            }
        }
    },

    // ── Adresse & Zwischenablage (P1: Route statt Query) ───────────────────
    /**
     * Die teilbare Adresse eines Vorgangs — je Zeile (Listen) oder die
     * eigene (Einzelansicht). Site-relativ, denn ein absoluter `href`
     * wäre für `wire:navigate` ein Fremdziel.
     */
    vorgangHrefFuer(row, art) {
        return vorgangPath(`/forge/${encodeURIComponent(this._naddr)}`, { art, id: row.id })
    },
    /** Die Adresse DIESES Vorgangs — die Einzelinsel kennt ihre Id. */
    vorgangHref() {
        return this.vorgangHrefFuer({ id: this._id }, this.art)
    },
    /** Der Pfad der Repo-Seite — Breadcrumbs, Zurück-Pfeil, Leerflächen. */
    repoHref() {
        return `/forge/${encodeURIComponent(this._naddr)}`
    },
    copyVorgang() {
        const href = this.vorgangHref()
        if (!href) {
            return
        }
        void navigator.clipboard.writeText(href).then(
            () => toast(t('Link zum Vorgang kopiert.'), 'success'),
            () => toast(t('Der Link liess sich nicht kopieren.')),
        )
    },
    canCopyClone() {
        return typeof navigator !== 'undefined' && typeof navigator.clipboard?.writeText === 'function'
    },

    // ── Schreib-Fehlerfläche ───────────────────────────────────────────────
    rowState(id: string) {
        return pendingState(this.pending, id)
    },
    failedFor(rootId: string) {
        const known = [
            ...(this.view?.issues.find((row) => row.id === rootId)?.comments ?? []),
            ...(this.view?.pullRequests.find((row) => row.id === rootId)?.comments ?? []),
        ]

        return [
            ...orphanedPending(this.pending, known, {
                what: 'comment',
                repoAddress: this.view?.repo.address ?? '',
                rootId,
            }).filter((entry) => entry.state === 'failed'),
            // Ein gescheiterter Statuswechsel hat NIE eine eigene Zeile in
            // der Liste — er wirkt auf die vorhandene. Er ist deshalb
            // immer „verwaist" und wird immer gezeigt.
            ...orphanedPending(this.pending, [], {
                what: 'status',
                repoAddress: this.view?.repo.address ?? '',
                rootId,
            }).filter((entry) => entry.state === 'failed'),
        ].map(toFailedRow)
    },
    dismiss(id: string) {
        dismissPending(id)
    },

    // ── @-Erwähnung (P9) ───────────────────────────────────────────────────
    //
    // Dieselbe Bedienung wie im Chat: Pfeile wählen, Enter/Tab übernimmt,
    // Escape schließt. Die Mechanik (Suchform, Ersetzen) liegt in
    // `mentionCompose.ts` und ist dort geprüft; hier steht nur, WELCHER
    // Entwurf betroffen ist.
    onComposerInput(el: HTMLTextAreaElement, target: string) {
        const treffer = mentionQueryAt(el.value, el.selectionStart ?? el.value.length)
        if (!treffer) {
            this.closeMentions()

            return
        }
        this._mentionStart = treffer.start
        const items = this._mentionItemsFor(treffer.query, target)
        this.mention = { open: items.length > 0, items, index: 0, query: treffer.query, target }
    },
    /**
     * Die gefilterte Vorschlagsliste zu einer Suche.
     *
     * Agenten vor Mitgliedern und jede Identität genau einmal — die Regel
     * steht in `mergeMentionItems` (rein, getestet), nicht hier.
     */
    _mentionItemsFor(query: string, target = '') {
        const q = query.toLowerCase()
        // **Schon Gewähltes fällt heraus — aber nur im Zuweisen-Feld.**
        // Im Composer darf man dieselbe Person zweimal erwähnen; in
        // einer Auswahl wäre der zweite Klick ein Vorschlag, der
        // sichtbar nichts tut. `target` wird ÜBERGEBEN und nicht aus
        // `this.mention` gelesen: beim Tippen ist dort noch das Ziel des
        // vorigen Feldes eingetragen.
        const gewaehlt =
            target.startsWith('assign:')
                ? new Set(this.assignPicksFor(target.slice('assign:'.length)).map((item) => item.pubkey))
                : new Set()
        const offen = (item) =>
            (!q || item.search.includes(q)) && !gewaehlt.has(item.pubkey)

        // Der Deckel liegt in `mergeMentionItems` und ist ZWEIGETEILT
        // (Agenten/Menschen getrennt) — ein gemeinsamer Schnitt auf der
        // fertigen Liste ließ Agenten die Menschen verdrängen und
        // einander dazu. Begründung dort.
        return mergeMentionItems(this._members.filter(offen), this._agentItems.filter(offen))
    },
    /**
     * Tastatur am Composer. Gibt der Vorschlag nichts her, passiert
     * nichts — insbesondere wird dann NICHT `preventDefault` gerufen, und
     * Zeilenumbruch/Tabulator verhalten sich wie immer.
     */
    mentionKey(event: KeyboardEvent) {
        if (!this.mention.open || this.mention.items.length === 0) {
            return
        }
        const anzahl = this.mention.items.length
        if (event.key === 'ArrowDown') {
            event.preventDefault()
            this.mention = { ...this.mention, index: (this.mention.index + 1) % anzahl }
        } else if (event.key === 'ArrowUp') {
            event.preventDefault()
            this.mention = { ...this.mention, index: (this.mention.index - 1 + anzahl) % anzahl }
        } else if (event.key === 'Enter' || event.key === 'Tab') {
            event.preventDefault()
            this.pickMention(this.mention.items[this.mention.index])
        } else if (event.key === 'Escape') {
            event.preventDefault()
            // `stopPropagation`: ein Escape trägt genau EINE Schicht ab —
            // der Vorschlag weg, das darunterliegende Blatt (falls eines
            // offen ist) bleibt. Zwei Schichten, zwei Tastendrücke.
            event.stopPropagation()
            this.closeMentions()
        }
    },
    /**
     * Vorschlag übernehmen: `@query` durch `nostr:npub… ` ersetzen.
     *
     * Der Fokus geht über ein **Datenattribut** zurück ins Feld und nicht
     * über `x-ref`: die Felder stehen in Schleifen, und ein `x-ref` im
     * Schleifenrumpf zeigt dort nur auf den zuletzt gerenderten.
     */
    pickMention(item) {
        if (!item) {
            return
        }
        const ziel = this.mention.target
        // **Der Zuweisen-Zweig steht VOR dem Textersatz.** Dort gibt es
        // keinen Entwurf, in den etwas gespliced würde: der Vorschlag
        // wird zum Chip, das Feld wird geleert, und die Suche bleibt
        // offen für den nächsten Namen.
        if (ziel.startsWith('assign:')) {
            const rootId = ziel.slice('assign:'.length)
            this.assignPicks = {
                ...this.assignPicks,
                [rootId]: [...this.assignPicksFor(rootId).filter((p) => p.pubkey !== item.pubkey), item],
            }
            this.assignQuery = { ...this.assignQuery, [rootId]: '' }
            this.closeMentions()
            const zurueck = this
            zurueck.$nextTick(() => {
                document
                    .querySelector<HTMLInputElement>(`[data-forge-composer="${CSS.escape(ziel)}"]`)
                    ?.focus()
            })

            return
        }
        const insert = mentionInsert(item)
        const rootId = ziel.slice('comment:'.length)
        const entwurf = this.commentDraft[rootId] ?? ''
        const ergebnis = spliceMention(entwurf, this._mentionStart, this.mention.query.length, insert)
        this.commentDraft = { ...this.commentDraft, [rootId]: ergebnis.text }
        this.closeMentions()
        const magics = this
        magics.$nextTick(() => {
            const feld = document.querySelector<HTMLTextAreaElement>(`[data-forge-composer="${CSS.escape(ziel)}"]`)
            if (feld) {
                feld.focus()
                feld.setSelectionRange(ergebnis.caret, ergebnis.caret)
            }
        })
    },
    closeMentions() {
        this.mention = { open: false, items: [], index: 0, query: '', target: '' }
        this._mentionStart = -1
    },
    /**
     * Die Agenten-Vorschläge dieser Seite neu falten.
     *
     * Kanalfilter, Betrachterfilter und der zooid-Riegel liegen vollständig
     * in `agentMentionItems` — hier steht keine Regel, nur die Übergabe.
     * Maßgeblich ist der `buzz-channel` des REPOS: trägt das Announcement
     * keinen, ist `h` leer. Kein Kanal, kein Vorschlag.
     */
    _recomputeAgentItems() {
        const view = this._agentView
        this._agentItems = view
            ? agentMentionItems({
                  agents: view.agents,
                  h: this.view?.repo.channelId ?? '',
                  viewerPubkey: view.viewerPubkey,
                  spaceKind: view.spaceKind,
                  encodeNpub: nip19.npubEncode,
                  memberItems: this._members,
                  knownChannelIds: this._channelIds,
              })
            : []
        // **Ein offener Vorschlag zieht nach.** Beide Quellen tröpfeln
        // asynchron herein: das Verzeichnis (10100) wartet auf die
        // NIP-11-Runde, der Kanal kommt erst mit dem Repo. Wer eine
        // Zehntelsekunde vorher `@` getippt hat, sähe sonst dauerhaft eine
        // Liste ohne Agenten.
        if (this._mentionStart >= 0) {
            // **Die Bedingung ist der offene SUCHBEGRIFF, nicht das offene
            // Fenster.** Wer den Namen eines Agenten tippt, dessen 10100
            // noch unterwegs ist, hat null Treffer — und mit einer
            // Bedingung auf `open` käme der Vorschlag nie mehr.
            const items = this._mentionItemsFor(this.mention.query, this.mention.target)
            this.mention = {
                ...this.mention,
                items,
                // Die Auswahl NICHT auf 0 zurücksetzen: wer gerade mit den
                // Pfeilen wählt, spränge sonst bei jedem eintreffenden
                // Profil zurück an den Anfang.
                index: Math.min(this.mention.index, Math.max(0, items.length - 1)),
                open: items.length > 0,
            }
        }
    },

    // ── Weckruf (P9) ───────────────────────────────────────────────────────
    /**
     * Die Weckmeldung — **nach** einem erfolgreich veröffentlichten
     * Beitrag, ausgelöst durch nichts als diese eine Nutzerhandlung.
     *
     * Ihr Ausgang ist ein EIGENES Ergebnis: scheitert sie, bleibt der
     * Beitrag gültig und wird als gelungen dargestellt. Der Hinweis
     * daneben sagt, was mit dem Weckruf ist — auch dann, wenn gar keiner
     * nötig oder möglich war.
     */
    async _wake(target: string, content: string, vorgang) {
        const repo = this.view?.repo
        if (!repo) {
            return
        }
        const ergebnis = await wakeMentionedAgents({
            url: WORKSPACE_URL,
            channelId: repo.channelId,
            agents: this._agentView?.agents ?? [],
            viewerPubkey: this.viewer,
            content,
            knownChannelIds: this._channelIds,
            target: {
                art: vorgang.art,
                eventId: vorgang.eventId,
                repoAddress: repo.address,
                what: vorgang.what,
            },
        })
        if (this._dead || ergebnis.code === 'none') {
            return
        }
        const namen = ergebnis.names.join(', ')
        // Jede Meldung beginnt mit dem AUSGANG („Geweckt:" / „Niemand
        // geweckt:") — die Frage des Nutzers in diesem Moment ist eine
        // einzige: „antwortet da jetzt jemand?". `:namen` kommt aus
        // `agentLabels` und ist bereits „Name (npub…)".
        const hinweis =
            ergebnis.code === 'sent'
                ? {
                      tone: 'ok',
                      text: t('Geweckt: :namen. Die Antwort erscheint im Projektkanal.', { namen }),
                  }
                : ergebnis.code === 'channel-foreign'
                  ? {
                        tone: 'warn',
                        text: t(
                            'Niemand geweckt: dieses Repository verweist auf einen Kanal, der nicht zu deinen Räumen gehört. :namen erfährt nichts von deinem Beitrag.',
                            { namen },
                        ),
                    }
                  : ergebnis.code === 'no-channel'
                    ? {
                          tone: 'warn',
                          text: t(
                              'Niemand geweckt: dieses Repository gehört zu keinem Kanal. :namen erfährt nichts von deinem Beitrag.',
                              { namen },
                          ),
                      }
                    : ergebnis.code === 'not-wakeable'
                        ? {
                              tone: 'warn',
                              text: t(
                                  'Niemand geweckt: :namen antwortet in diesem Kanal nicht auf dich. Dein Beitrag steht trotzdem.',
                                  { namen },
                              ),
                          }
                        : {
                              tone: 'warn',
                              text: t(
                                  'Niemand geweckt: die Meldung an :namen ging nicht raus — :fehler. Dein Beitrag steht trotzdem.',
                                  { namen, fehler: ergebnis.error },
                              ),
                          }
        this.wakeNotice = { ...this.wakeNotice, [target]: hinweis }
    },
    dismissWake(target: string) {
        const rest = { ...this.wakeNotice }
        delete rest[target]
        this.wakeNotice = rest
    },

    // ── Die Quellen dieser Werkzeuge ───────────────────────────────────────
    /**
     * Viewer, Schreib-Verlauf, Mitglieder, Agenten, Räume — einmal je
     * Insel, aus dem `init`. Faktoriert, weil beide Inseln dieselben fünf
     * Abos brauchen; wer die Liste hier ergänzt, ergänzt sie für beide
     * Flächen.
     */
    _abonniereSchreibQuellen(signal: AbortSignal | undefined) {
        this._unsubViewer = pubkey.subscribe((pk: string | undefined) => {
            this.viewer = pk ?? ''
        })
        this._unsubPending = forgePending.subscribe((list: PendingWrite[]) => {
            this.pending = list
        })
        if (WORKSPACE_URL && signal) {
            void loadSpaceDirectory(WORKSPACE_URL)
            watchSpaceDirectory(WORKSPACE_URL, signal)
            this._unsubMembers = deriveSpaceDirectory(WORKSPACE_URL).subscribe((dir: DirectoryView) => {
                this._members = dir.members.map((m) => ({
                    pubkey: m.pubkey,
                    npub: m.npub,
                    name: m.name,
                    picture: m.picture,
                    search: m.search,
                }))
                const fehlend = dir.members
                    .map((m) => m.pubkey)
                    .filter((pk) => !this._loadedProfiles.has(pk))
                if (fehlend.length) {
                    fehlend.forEach((pk) => this._loadedProfiles.add(pk))
                    loadMemberProfiles(WORKSPACE_URL, fehlend)
                }
                this._recomputeAgentItems()
            })
            // Die Raumliste des Nutzers — Grundlage des Kanal-Riegels.
            // Sie liegt in der Insel ohnehin vor; ein eigener REQ entsteht
            // dafür nicht.
            this._unsubRooms = roomsByUrl.subscribe((byUrl: Map<string, { h: string }[]>) => {
                this._channelIds = new Set(
                    (byUrl.get(normalizeRelayUrl(WORKSPACE_URL)) ?? []).map((room) => room.h),
                )
            })
            void listenAgentDirectory(WORKSPACE_URL, signal)
            this._unsubAgents = deriveAgentDirectory(WORKSPACE_URL).subscribe((view: AgentDirectoryView) => {
                this._agentView = view
                this._recomputeAgentItems()
            })
        }
    },
    _trenneSchreibQuellen() {
        this._unsubViewer?.()
        this._unsubPending?.()
        this._unsubMembers?.()
        this._unsubAgents?.()
        this._unsubRooms?.()
        // Die Fehlermeldung eines Schreibversuchs gehört zu DIESEM
        // Bildschirm. Wer die Seite verlässt, hat sie zur Kenntnis
        // genommen.
        clearPending()
        // Laufende PR-Diff-Downloads mitnehmen: sie holen Git-Objekte, und
        // der Download läuft weiter, auch wenn die Seite weg ist.
        for (const abbruch of Object.values(this._prDiffAbbruch ?? {}) as AbortController[]) {
            abbruch.abort()
        }
        this._prDiffAbbruch = {}
    },
}

/** Der Tab der PR-Einzelansicht: Diskussion oder Dateien (`?tab=`, P3). */
const vorgangTabFromLocation = (): string => {
    try {
        const tab = new URLSearchParams(window.location.search).get('tab')

        return tab === 'dateien' ? 'dateien' : 'diskussion'
    } catch {
        return 'diskussion'
    }
}

export function wireForge(Alpine: {
    data: (name: string, factory: (...args: unknown[]) => unknown) => void
}): void {
    Alpine.data('nostrForge', (base: unknown): ForgeState => {
        return {
            loading: true,
            error: '',
            // `'unknown'` ist ein eigener Zustand: Skeleton zeigen, NICHTS
            // entscheiden (siehe `spaceCaps.ts`). Wer hier zweiwertig anfängt,
            // baut die Mount-Falle nach.
            kind: 'unknown',
            // Der Tab kommt aus `?tab=`, wenn er dort steht — und er wird auch dorthin
            // zurückgeschrieben (siehe `init`). Beide Richtungen, weil sonst genau der
            // Fehler entsteht, gegen den `forgeTab.ts` geschrieben ist: die Adresse
            // behauptet einen Tab, der Bildschirm zeigt einen anderen. Seit P5 ist das
            // hier nicht mehr theoretisch — `/spaces?tab=workspaces` LEITET hierher.
            tab: readForgeTab(window.location.search),
            // Unbekannt, bis die Kanal-Insel darunter ihren Bestand meldet. Meldet
            // sie nie (Relay stumm, Nutzer ohne Zugang), bleibt es `null` und der
            // Reiter trägt schlicht keine Zahl — dieselbe Ausfallrichtung wie beim
            // Repo-Reiter.
            kanalbestand: null,
            // Startwert FALSCH, nicht `true`: das ist die harmlose Ausfallrichtung.
            // Ohne Messung (kein `getComputedStyle`, kein DOM) bleibt die Fläche in
            // der Tab-Form — die funktioniert auf jeder Breite, die zweispaltige
            // nicht. Dieselbe Richtung wie `viewport.ts` beim `desktop`-Flag.
            zweispaltig: false,
            overview: EMPTY_OVERVIEW,
            suche: '',
            // Startwerte, nicht aus der Adresse gelesen: Sortierung und Scope
            // sind eine ANSICHT, kein Ort. Ein geteilter Link soll dieselbe
            // Liste zeigen, nicht dieselbe Sicht darauf — und `?tab=` trägt
            // bereits die Frage, die geteilt gehört. (Anders als bei `?issue=`
            // aus P2: dort IST der Vorgang das Ziel des Links.)
            sortierung: leseSortierung(undefined),
            scope: leseScope(undefined),
            viewer: '',
            _unsubViewer: null,
            _base: String(base ?? '').replace(/\/+$/, ''),
            _dead: false,
            _controller: null,
            _unsub: null,
            _unsubKind: null,
            _unsubSelf: null,
            _unsubBreite: null,
            _gesprungen: false,
            /**
             * Stand `?tab=` WIRKLICH in der Adresse?
             *
             * `readForgeTab` liefert auch ohne Parameter einen Wert (den Startwert),
             * und der erste Entwurf sprang deshalb bei JEDEM Aufruf von `/forge` —
             * er rollte zur Aktivitätsspur und setzte den Fokus auf deren
             * Überschrift. Im Bild war das ein Fokusring um „AKTIVITÄT", den
             * niemand angefordert hatte; für die Tastatur war es ein gestohlener
             * Fokus beim bloßen Öffnen einer Seite.
             *
             * Ein Sprung ist die Antwort auf eine ANWEISUNG in der Adresse. Ohne
             * Anweisung wird nicht gesprungen.
             */
            _tabAusAdresse: new URLSearchParams(window.location.search).has(FORGE_TAB_PARAM),
            _relaySelf: '',
            /**
             * `?tab=` ohne Tabs: in der zweispaltigen Form steht schon alles im Bild,
             * ein Umschalten gäbe es also nicht mehr zu tun. Ein geteilter Link darf
             * deshalb trotzdem nicht ins Leere zeigen — er wird zum SPRUNG.
             *
             * `repos`/`activity` → die Region in den Blick rollen und ihre Überschrift
             * fokussieren (`tabindex="-1"`), damit auch ein Screenreader-Leser dort
             * ankommt und nicht nur die Bildlaufleiste.
             *
             * `workspaces` → die Kanäle stehen ab `xl` im Navigator, nicht auf der
             * Bühne. Statt von hier in die Rail-Insel hineinzugreifen (zwei Inseln, ein
             * Zustand — genau die Kopplung, die man später nicht mehr auflösen kann),
             * geht ein Fensterereignis hinaus. Wer zuhört, entscheidet die Rail; gibt
             * es sie nicht, passiert nichts.
             */
            /**
             * Eine Liste anfordern — und den Fokus mitnehmen.
             *
             * Bis zur P4-Nacharbeit stand hier nur `tab = '…'`. Auf dem Schirm war
             * das genug: die linke Spur tauscht ihre Liste, und die steht direkt
             * unter der Kachel. Für die Tastatur und die Sprachausgabe war es
             * nichts — der Fokus blieb auf der Kachel stehen, der Bereich daneben
             * wechselte lautlos seinen Inhalt, und niemand erfuhr davon.
             *
             * Das Ziel ist die Überschrift der Region. Sie trägt seit P3
             * `tabindex="-1"` und ist damit programmatisch anspringbar, ohne ein
             * zusätzlicher Halt im Tab-Lauf zu werden — dasselbe Muster, das
             * `_springZuRegion()` für den kalt geöffneten `?tab=`-Link benutzt.
             * Wiederverwendet wird der DOM-Vertrag, nicht der Code: jener Sprung
             * passiert EINMAL je Seitenaufruf (`_gesprungen`), dieser bei jedem
             * Klick. Zwei verschiedene Anlässe, zwei Methoden.
             *
             * `preventScroll`: die Kacheln und der Umschalter stehen am Kopf der
             * Bühne, die Region also ohnehin im Bild. Ein zusätzliches Rollen wäre
             * ein Ruck ohne Gewinn.
             *
             * In der Tab-Form ist die Überschrift `sr-only` — sichtbar nicht, im
             * Baum schon, und `focus()` trägt dort genauso. Deshalb wird hier auch
             * nicht auf `zweispaltig` abgefragt.
             */
            zeigeListe(ziel) {
                this.tab = ziel
                ;(this as unknown as { $nextTick(cb: () => void): void }).$nextTick(() => {
                    const wurzel = (this as unknown as { $root?: HTMLElement }).$root
                    const region = wurzel?.querySelector(`[data-forge-region="${ziel}"]`)
                    const titel = region?.querySelector<HTMLElement>('[data-forge-region-titel]')
                    // Ein verstecktes Ziel nimmt keinen Fokus an — dann bleibt er,
                    // wo er ist. Das ist die harmlose Richtung.
                    if (!titel || titel.checkVisibility?.() === false) {
                        return
                    }
                    titel.focus({ preventScroll: true })
                })
            },
            _springZuRegion() {
                if (this._gesprungen || !this.zweispaltig || !this._tabAusAdresse) {
                    return
                }
                if (this.tab === 'workspaces') {
                    window.dispatchEvent(
                        new CustomEvent('forge-zeige-kanaele', { detail: { gruppe: 'workspace' } }),
                    )
                    this._gesprungen = true

                    return
                }
                const wurzel = (this as unknown as { $root?: HTMLElement }).$root
                const region = wurzel?.querySelector(`[data-forge-region="${this.tab}"]`)
                const titel = region?.querySelector<HTMLElement>('[data-forge-region-titel]')
                if (!region || !titel) {
                    return
                }
                // ── Ein verstecktes Ziel nimmt keinen Fokus an ────────────────────
                // Beim Mount steht `loading` noch, und beide Regionen sind per
                // `x-show` aus. `focus()` auf ein `display:none`-Element tut still
                // NICHTS — der Sprung lief ins Leere, und zwar ohne Fehler.
                // (E2E-gemessen: „Der Fokus ist nicht auf der Werkbank-Überschrift
                // gelandet".) Deshalb ist der Versuch wiederholbar: er meldet sich
                // erst als erledigt, wenn der Fokus wirklich angekommen ist, und
                // `init()` ruft ihn ein zweites Mal, sobald das Laden endet.
                if (titel.checkVisibility?.() === false) {
                    return
                }
                // `block: 'start'` und nicht `center`: die Region beginnt oben, und ein
                // zentriertes Ziel schöbe ihre Überschrift aus dem Bild.
                region.scrollIntoView({ block: 'start', behavior: 'auto' })
                titel.focus({ preventScroll: true })
                this._gesprungen = document.activeElement === titel
            },
            init() {
                // Tab-Wechsel in die Adresse spiegeln (`replaceState`, keine Navigation)
                // — dieselbe Bauform und dieselbe Begründung wie auf `/spaces`: der
                // Startwert steht bewusst NICHT in der URL (saubere Adresse für den
                // Normalfall), jeder andere schon. OHNE diese Richtung behauptete die
                // Adresse nach einem Tab-Klick weiter den Tab, mit dem die Seite geöffnet
                // wurde — und ein daraus kopierter Link führte den nächsten Leser an eine
                // andere Stelle als die, die der Absender vor sich hatte.
                const syncTabParam = (v: string): void => {
                    const u = new URL(window.location.href)
                    if (v === DEFAULT_FORGE_TAB) {
                        u.searchParams.delete(FORGE_TAB_PARAM)
                    } else {
                        u.searchParams.set(FORGE_TAB_PARAM, v)
                    }
                    window.history.replaceState(window.history.state, '', u)
                }
                // EINMAL beim Mount mit dem Wert, den `readForgeTab` durchgelassen hat:
                // sonst bliebe ein verworfener Parameter in der Adresse stehen und würde
                // weitergeteilt. Der `$watch` allein räumt das nicht auf — er feuert erst
                // bei einer ÄNDERUNG.
                syncTabParam(this.tab)
                ;(this as unknown as { $watch(p: string, cb: (v: string) => void): void }).$watch('tab', syncTabParam)

                // Der angemeldete Schlüssel: Grundlage des Scopes. Als ABO und
                // nicht als einmaliges `pubkey.get()` — er kann nach dem Mount
                // eintreffen (localStorage-Rehydrierung) und sich im Betrieb
                // ändern (Abmelden). Dieselbe Bauform wie auf der Repo-Seite.
                this._unsubViewer = pubkey.subscribe((pk: string | undefined) => {
                    this.viewer = pk ?? ''
                })

                // ── Ein- oder zweispaltig? ───────────────────────────────────────
                // Gelesen, nicht zurückgemessen (P2, 2026-08-26). Hier stand ein
                // `getComputedStyle` auf die Tab-Leiste: die Insel fragte ihre eigene
                // Ausgabe, weil der Store die Frage nicht beantworten konnte. Er kann
                // es jetzt — `form` trägt HOST und BREITE.
                //
                // Der `matchMedia`-Listener bleibt, aber er liest nur noch: das
                // Alpine-`$store` ist von hier aus nicht reaktiv beobachtbar (diese
                // Insel ist ein `Alpine.data`-Objekt, kein `x-effect`), also wird der
                // abgeleitete Wert beim Schwellenwechsel nachgezogen. Die SCHWELLE
                // steht dabei weiterhin nur an einer Stelle (`DESKTOP_QUERY`).
                const formLesen = (): ForgeForm =>
                    ((window as unknown as { Alpine?: { store: (n: string) => { form?: ForgeForm } } }).Alpine?.store(
                        'viewport',
                    )?.form ?? 'web-schmal')
                const uebernehmen = (): void => {
                    this.zweispaltig = formLesen() === 'web-breit'
                }
                uebernehmen()
                const mql =
                    typeof window.matchMedia === 'function' ? window.matchMedia(DESKTOP_QUERY) : null
                mql?.addEventListener('change', uebernehmen)
                this._unsubBreite = () => mql?.removeEventListener('change', uebernehmen)

                // Der Sprung erst NACH dem ersten Alpine-Durchlauf: vorher trägt die
                // Region noch `x-cloak` und hat weder Höhe noch Position, ein
                // `scrollIntoView` liefe ins Leere. `$nextTick` statt eines Timers —
                // eine Wartezeit wäre geraten, dieser Haken ist die Zusage.
                const versucheSprung = (): void => {
                    ;(this as unknown as { $nextTick(cb: () => void): void }).$nextTick(() => {
                        this._springZuRegion()
                    })
                }
                versucheSprung()
                // Zweiter Versuch, sobald das Laden endet: vorher sind beide Regionen
                // versteckt und nehmen keinen Fokus an. `_gesprungen` sorgt dafür,
                // dass es trotzdem bei EINEM Sprung bleibt.
                ;(this as unknown as { $watch(p: string, cb: (v: boolean) => void): void }).$watch(
                    'loading',
                    (v: boolean) => {
                        if (!v) {
                            versucheSprung()
                        }
                    },
                )

                this._controller = new AbortController()
                this._unsubKind = deriveSpaceKind(WORKSPACE_URL).subscribe((kind: SpaceKind) => {
                    this.kind = kind
                })
                this._unsubSelf = deriveRelaySelf(WORKSPACE_URL).subscribe((self: string) => {
                    this._relaySelf = self
                })
                void this._boot()
            },
            destroy() {
                this._dead = true
                this._unsub?.()
                this._unsubKind?.()
                this._unsubSelf?.()
                // Ohne dies überlebte der Media-Listener jede `wire:navigate`-
                // Navigation und schriebe weiter in eine tote Insel.
                this._unsubBreite?.()
                this._unsubViewer?.()
                this._controller?.abort()
            },
            async _boot() {
                if (!WORKSPACE_URL) {
                    this.loading = false

                    return
                }
                this._unsub = deriveForgeOverview().subscribe((overview: ForgeOverview) => {
                    this.overview = overview
                })
                await this._load()
            },
            async _load() {
                this.loading = true
                try {
                    const outcome = await loadForge(this._relaySelf, this._controller?.signal)
                    if (this._dead) {
                        return
                    }
                    // Ein schweigender Relay ist kein leerer Relay. Nur wenn
                    // auch nichts im Speicher liegt — was schon da ist, ist mehr
                    // wert als eine Fehlerzeile darüber.
                    this.error =
                        outcome.complete || !this.isEmpty() ? '' : t('Die Forge ist gerade nicht erreichbar.')
                    if (this.overview.repos.length > 0 && this._controller) {
                        watchForge(
                            this.overview.repos.map((row) => row.address),
                            this._controller.signal,
                        )
                    }
                } catch {
                    this.error = t('Die Forge ist gerade nicht erreichbar.')
                } finally {
                    this.loading = false
                }
            },
            retry() {
                this.error = ''
                this._controller?.abort()
                this._controller = new AbortController()
                void this._load()
            },
            isEmpty() {
                return this.overview.repos.length === 0 && this.overview.projects.length === 0
            },
            /**
             * Darf die Oberfläche eine ZAHL behaupten?
             *
             * Erst wenn der Ladevorgang durch ist. Eine `0` während des Ladens
             * wäre dieselbe Falschaussage wie eine leere Fläche, nur mit mehr
             * Selbstbewusstsein — bis dahin steht in der Kachel ein Balken.
             */
            settled() {
                return !this.loading
            },
            counts() {
                return this.overview.counts
            },
            /**
             * Gefiltert wird beim LESEN, nicht beim Laden.
             *
             * `overview.repos` bleibt vollstaendig — die Zustandszeile oben
             * zaehlt weiter den ganzen Bestand, und das ist Absicht: „3 von 47"
             * ist eine Aussage, „3 von 3" waere eine Luege ueber den Workspace.
             */
            sichtbareRepos() {
                return sortiereRepos(filterRepos(this.overview.repos, this.suche), this.sortierung)
            },
            kannScope() {
                return this.viewer !== ''
            },
            /**
             * Die Zahlen neben der Auswahl: „12 von 47".
             *
             * Sie beantworten, was Suche und Scope gerade weggenommen haben —
             * ohne sie ist eine gefilterte Liste von einem leeren Workspace
             * nicht zu unterscheiden. Gezählt wird die AKTIVE Liste, nicht immer
             * die Repos: der Umschalter entscheidet, worüber die Zahl spricht.
             */
            sichtbareAnzahl() {
                if (this.listeAktiv() === 'repos') {
                    return this.sichtbareRepos().length
                }

                return (this.listeAktiv() === 'issues' ? this.issueGroups() : this.pullGroups()).reduce(
                    (n, gruppe) => n + gruppe.items.length,
                    0,
                )
            },
            gesamtAnzahl() {
                if (this.listeAktiv() === 'repos') {
                    return this.overview.repos.length
                }
                const roh =
                    this.listeAktiv() === 'issues' ? this.overview.issueGroups : this.overview.pullGroups

                return roh.reduce((n, gruppe) => n + gruppe.items.length, 0)
            },
            _sucheTreffer() {
                if (this.listeAktiv() === 'repos') {
                    return filterRepos(this.overview.repos, this.suche).length
                }
                const roh =
                    this.listeAktiv() === 'issues' ? this.overview.issueGroups : this.overview.pullGroups

                return roh.reduce((n, gruppe) => n + sucheVorgaenge(gruppe.items, this.suche).length, 0)
            },
            /**
             * Seit P7/4 gilt die Frage für die AKTIVE Liste, nicht mehr nur für
             * die Repos: die Suche wirkt jetzt auf allen dreien. Vorher hätte
             * eine leere Issue-Liste unter einer Suche kommentarlos dagestanden.
             */
            ohneTreffer() {
                return this.suche.trim() !== '' && this.gesamtAnzahl() > 0 && this._sucheTreffer() === 0
            },
            sucheLoeschen() {
                this.suche = ''
            },
            /**
             * **Die Texte folgen der Liste, weil die Suche es seit P7a tut.**
             *
             * `sucheVorgaenge` filtert Issues und Pull Requests genauso wie
             * `filterRepos` die Repositories — nur hiess das Feld weiterhin
             * „Repositories durchsuchen" und die Zählzeile „:count von :total
             * Repositories". Über einer Issue-Liste war beides schlicht falsch.
             *
             * Die durchsuchten FELDER sind ebenfalls verschiedene: bei einem
             * Repo Name, Kennung, Beschreibung, Themen, Adressen und Maintainer
             * (`repoHaystack`), bei einem Vorgang Titel, Rumpf, Labels, Autor
             * und die, auf die gewartet wird (`vorgangHaystack`). Ein
             * gemeinsamer Satz nennte für jede der beiden Listen Felder, die es
             * dort nicht gibt.
             */
            sucheHilfe() {
                if (this.listeAktiv() === 'repos') {
                    return {
                        name: t('Repositories durchsuchen'),
                        platzhalter: t('Name, Thema, Clone-URL, Maintainer …'),
                        zahl: t(':count von :total Repositories'),
                        leer: t('Kein Repository passt dazu.'),
                        felder: t(
                            'Gesucht wird über Name, Kennung, Beschreibung, Themen, Clone- und Web-Adressen, Relays und Maintainer — als npub oder als Hex.',
                        ),
                    }
                }
                const issues = this.listeAktiv() === 'issues'

                return {
                    name: issues ? t('Issues durchsuchen') : t('Pull Requests durchsuchen'),
                    platzhalter: t('Titel, Text, Label, Autor …'),
                    zahl: issues ? t(':count von :total Issues') : t(':count von :total Pull Requests'),
                    leer: issues ? t('Kein Issue passt dazu.') : t('Kein Pull Request passt dazu.'),
                    felder: t(
                        'Gesucht wird über Titel, Rumpftext, Labels, Verfasser und die Beteiligten, auf die gewartet wird — als npub oder als Hex.',
                    ),
                }
            },
            repoHref(row: { naddr: string }) {
                return row.naddr ? `${this._base}/${row.naddr}` : ''
            },
            truncatedText() {
                return this.overview.truncated.length === 0
                    ? ''
                    : t('Die Liste ist gekürzt — es liegen mehr Einträge auf dem Relay, als hier geladen wurden.')
            },
            listeAktiv() {
                return this.tab === 'issues' || this.tab === 'pulls' ? this.tab : 'repos'
            },
            forgeTabHref(tab: string) {
                // Der Startwert steht bewusst NICHT in der Adresse — dieselbe
                // Regel, die `syncTabParam` beim Zurückschreiben anwendet. Sonst
                // trüge ein aus der Kachel kopierter Link `?tab=activity`, und
                // der Normalfall hätte eine unnötig laute Adresse.
                return tab === DEFAULT_FORGE_TAB ? this._base : `${this._base}?${FORGE_TAB_PARAM}=${tab}`
            },
            /**
             * Scope und Sortierung wirken INNERHALB der Repo-Gruppen.
             *
             * Die Gruppierung nach Repository bleibt: sie beantwortet „wo liegt
             * das", die Sortierung „was zuerst". Eine Sortierung über die
             * Gruppengrenzen hinweg löste die Gruppierung faktisch auf — dann
             * wären zwei Ordnungen im Bild, und die Überschrift eines
             * Repositories stünde über einer Zeile, die nicht mehr zu ihm
             * gehört.
             *
             * Eine Gruppe, die durch den Scope leer wird, verschwindet — ein
             * Repo-Kopf über null Zeilen behauptete einen Bestand, den es unter
             * diesem Ausschnitt nicht gibt.
             */
            issueGroups() {
                return this._gefilterteGruppen(this.overview.issueGroups)
            },
            pullGroups() {
                return this._gefilterteGruppen(this.overview.pullGroups)
            },
            /**
             * Drei Stufen, und die Reihenfolge ist keine Geschmacksfrage:
             * **Suche → Scope → Sortierung.** Erst was gemeint ist (Text), dann
             * wessen es ist (Scope), dann in welcher Reihenfolge. Umgekehrt
             * sortierte man Zeilen, die gleich wieder wegfallen.
             *
             * Die Suche ist seit P7/4 dabei. Vorher filterte das Feld
             * ausschliesslich Repositories — auf den Reitern „Issues" und „Pull
             * Requests" tat es sichtbar nichts, obwohl der Bestand im Speicher
             * lag.
             */
            _gefilterteGruppen(gruppen: VorgangGruppe[]) {
                return gruppen
                    .map((gruppe) => ({
                        ...gruppe,
                        items: sortiereVorgaenge(
                            filtereVorgaenge(
                                sucheVorgaenge(gruppe.items, this.suche).map((row) => ({
                                    ...row,
                                    assignees: row.wartetAuf,
                                })),
                                this.scope,
                                this.viewer,
                            ),
                            this.sortierung,
                        ),
                    }))
                    .filter((gruppe) => gruppe.items.length > 0)
            },
        }
    })

    Alpine.data('nostrForgeRepo', (naddr: unknown): ForgeRepoState => {
        return {
            // Die Werkzeuge EINES Vorgangs (Kommentar, Status, Zuweisen, Review,
            // Diff, Erwähnung, Weckruf) kommen aus dem Mixin — diese Fläche
            // braucht davon nach dem Akkordeon-Rückbau (P1) Riegel, Erwähnung
            // und Weckruf fürs Issue-Anlegen; die Einzelansichten tragen
            // denselben Bestand.
            ...forgeVorgangWerkzeuge,
            // `pruefe`, nicht `bereit`: ob das Repository schon lokal liegt,
            // weiss erst ein Blick in IndexedDB (siehe `ReadmeLage`).
            klon: { lage: 'pruefe', name: '', html: '', text: '', fehler: '', fortschritt: null, commit: '', fremdUrl: '' },
            code: { pfad: '', eintraege: [], datei: '', art: '', html: '', text: '', bildUrl: '', groesse: 0, gekuerzt: false, zeilen: 0, laedt: false, fehler: '' },
            speicher: { offen: false, klone: [], belegt: 0, kontingent: 0 },
            suche: '',
            _klonAbbruch: null,
            loading: true,
            error: '',
            missing: false,
            kind: 'unknown',
            // Der Tab kommt aus `?tab=`, wenn er dort steht: die Rail verlinkt
            // „Issues · 3" und „Pull Requests · 1" gezielt auf ihre Liste, und
            // eine Zeile, die etwas anderes zeigt als ihre Beschriftung, wäre
            // schlimmer als keine. Ohne Parameter bleibt es beim bisherigen
            // Startwert.
            tab: tabFromLocation(),
            steckbriefSpur: false,
            _breiteBeobachter: null,
            view: null,
            open: {},
            viewer: '',
            pending: [],
            issueDraft: { open: false, title: '', body: '', error: '', busy: false },
            busyTick: 0,
            mention: { open: false, items: [], index: 0, query: '', target: '' },
            wakeNotice: {},
            _naddr: String(naddr ?? ''),
            _dead: false,
            _controller: null,
            _unsub: null,
            _unsubKind: null,
            _unsubSelf: null,
            _unsubViewer: null,
            _unsubPending: null,
            _unsubMembers: null,
            _unsubAgents: null,
            _relaySelf: '',
            _members: [],
            _agentItems: [],
            _agentView: null,
            _channelIds: new Set<string>(),
            _unsubRooms: null,
            _mentionStart: -1,
            _loadedProfiles: new Set<string>(),
            /**
             * Welche Form hat der Steckbrief gerade — Aufklapper oder Spur?
             *
             * Gemessen wird die `display`-Berechnung SEINER ZUSAMMENFASSUNG, nicht
             * eine Breite. Die Schwelle steht damit an genau einer Stelle
             * (`@container repo (min-width: 65rem)` in `theme.css`); eine Zahl hier
             * wäre ihr zweites Literal und liefe beim nächsten Umbau still
             * auseinander.
             *
             * **Diese Rückmessung bleibt, und der Unterschied ist der Punkt:** sie
             * fragt eine CONTAINER-Schwelle ab (`@container repo (min-width: 65rem)`),
             * und die kennt das Fenster nicht — `matchMedia` kann sie prinzipiell
             * nicht beantworten. Gefallen ist in P2 die Rückmessung der FENSTER-Breite
             * der Übersicht, für die es eine Quelle gibt. „Geometrie bleibt bei
             * Container-Queries, Chassis bei der einen Schwelle" ist die Hausregel
             * dazu (`theme.css`).
             *
             * Warum überhaupt JavaScript: es gibt keine portable CSS-Regel, die ein
             * geschlossenes `<details>` aufzieht (`::details-content` ist jünger als
             * der Browser-Boden dieses Hauses). Und es gibt keinen Ausfallpfad, der
             * dadurch schlechter würde — die ganze Repo-Fläche steht in
             * `<template x-if="view">` und existiert ohne diese Insel gar nicht.
             */
            _messeSteckbrief() {
                const wurzel = (this as unknown as { $root?: HTMLElement }).$root
                const schalter = wurzel?.querySelector('[data-forge-steckbrief-schalter]')
                this.steckbriefSpur =
                    !!schalter &&
                    typeof window.getComputedStyle === 'function' &&
                    window.getComputedStyle(schalter).display === 'none'
            },
            /**
             * Hängt den Beobachter an die Bühne — genau einmal.
             *
             * Ein `matchMedia` gibt es hier nicht: die Schwelle ist eine
             * CONTAINER-Schwelle, und die kennt das Fenster nicht. Der
             * `ResizeObserver` liefert nur das WANN; das WAS liest weiterhin
             * `_messeSteckbrief()` aus dem Stylesheet.
             *
             * Ohne `ResizeObserver` (alte Umgebung, Testdouble) bleibt es beim
             * einmaligen Messwert. Das ist die harmlose Richtung: der Aufklapper
             * steht dann auch auf einem breiten Schirm — und er funktioniert dort.
             */
            _beobachteBreite() {
                this._messeSteckbrief()
                if (this._breiteBeobachter || typeof ResizeObserver === 'undefined') {
                    return
                }
                const wurzel = (this as unknown as { $root?: HTMLElement }).$root
                const buehne = wurzel?.querySelector('.forge-repo-buehne')
                if (!buehne) {
                    // Kein Container = App-Host (die Klasse steht dort nicht). Die
                    // Spur gibt es da nicht, also gibt es auch nichts zu beobachten.
                    return
                }
                this._breiteBeobachter = new ResizeObserver(() => {
                    this._messeSteckbrief()
                })
                this._breiteBeobachter.observe(buehne)
            },
            init() {
                this._controller = new AbortController()
                this._unsubKind = deriveSpaceKind(WORKSPACE_URL).subscribe((kind: SpaceKind) => {
                    this.kind = kind
                })
                this._unsubSelf = deriveRelaySelf(WORKSPACE_URL).subscribe((self: string) => {
                    this._relaySelf = self
                })
                // Viewer, Schreib-Verlauf, Mitglieder, Agenten, Räume — die
                // geteilten Quellen der Vorgangs-Werkzeuge (dort begründet),
                // inklusive des angemeldeten Schlüssels, der NACH dem Mount
                // eintreffen kann (localStorage-Rehydrierung) und sich im
                // Betrieb ändern kann (Abmelden).
                this._abonniereSchreibQuellen(this._controller?.signal)
                // Erstwert für den Fall, dass die Fläche schon steht
                // (Kaltstart-Cache). Die Bühne selbst gibt es erst mit `view`;
                // der Beobachter hängt sich deshalb unten in `_boot` nach.
                this._messeSteckbrief()
                void this._boot()
            },
            destroy() {
                this._dead = true
                this._breiteBeobachter?.disconnect()
                this._breiteBeobachter = null
                this._unsub?.()
                this._unsubKind?.()
                this._unsubSelf?.()
                this._trenneSchreibQuellen()
                this._controller?.abort()
                // Einen laufenden Klon abbrechen: die Seite ist weg, der
                // Download nicht. Auf einem Telefon wäre das ein Datenvolumen,
                // das niemand mehr sehen wird.
                this._klonAbbruch?.abort()
                this._klonAbbruch = null
            },
            async _boot() {
                if (!WORKSPACE_URL) {
                    this.loading = false

                    return
                }
                this._unsub = deriveRepoView(this._naddr).subscribe((view: RepoView | null) => {
                    this.view = view
                    // Der `buzz-channel` des Repos ist der Kanal, gegen den die
                    // Eignung geprüft wird — er kommt mit dem Repo herein, nicht
                    // mit dem Verzeichnis.
                    this._recomputeAgentItems()
                    if (view) {
                        // Steht das Repo, ist die Frage beantwortet — auch wenn
                        // der `load` noch läuft (Kaltstart-Cache).
                        this.loading = false
                        this.missing = false
                        this.error = ''
                        // Die README-Vorprüfung GENAU EINMAL: diese Ableitung
                        // feuert bei jedem eintreffenden Ereignis neu, und ein
                        // laufender Download dürfte davon nichts merken.
                        if (this.klon.lage === 'pruefe') {
                            void this.klonPruefen()
                        }
                        // Die Bühne existiert erst mit `view`. `$nextTick`, weil
                        // Alpine das `x-if` im selben Durchlauf noch nicht
                        // ausgerollt hat — eine Wartezeit wäre geraten, dieser
                        // Haken ist die Zusage.
                        ;(this as unknown as { $nextTick(cb: () => void): void }).$nextTick(() => {
                            this._beobachteBreite()
                        })
                    }
                })
                await this._load()
            },
            async _load() {
                try {
                    // Repo-gescopt (P7/1): `loadForge` stand hier bis zum
                    // 2026-08-26 und teilte `FORGE_ROOT_LIMIT` mit jedem anderen
                    // Repo des Workspace.
                    const outcome = await loadRepoDetail(
                        this._naddr,
                        this._relaySelf,
                        this._controller?.signal,
                    )
                    if (this._dead) {
                        return
                    }
                    // Drei Ausgänge, und sie dürfen nicht zu zweien verschmelzen:
                    // Relay hat geantwortet und kennt das Repo nicht (`missing`),
                    // Relay hat NICHT geantwortet (`error`), Repo liegt schon vor.
                    this.missing = outcome.complete && !this.view
                    this.error = !outcome.complete && !this.view ? t('Die Forge ist gerade nicht erreichbar.') : ''
                    if (this.view && this._controller) {
                        watchForge([this.view.repo.address], this._controller.signal)
                    }
                } catch {
                    this.error = this.view ? '' : t('Die Forge ist gerade nicht erreichbar.')
                } finally {
                    this.loading = false
                }
            },
            retry() {
                this.error = ''
                this.missing = false
                this._controller?.abort()
                this._controller = new AbortController()
                this.loading = true
                void this._load()
            },
            /**
             * Ein Patch-Akkordeon auf- oder zuklappen — das EINZIGE, das nach
             * P1 noch auf dieser Fläche wohnt: Issues und Pull Requests sind
             * eigene Seiten (Route statt Aufklapp-Zustand), ein Patch (1617)
             * hat keine Adresse und keine Schreibwege, nur diese Anzeige.
             */
            toggle(id: string) {
                this.open = { ...this.open, [id]: !this.open[id] }
            },
            statusText(code: string) {
                return statusLabel(code)
            },

            // ── README (P6) ──────────────────────────────────────────────────
            // Der Git-Code wird DYNAMISCH geladen. Ein statischer Import zöge
            // 84 kB gzip in den Chunk, den jede Seite holt — der ganze Sinn der
            // lazy Chunks aus der Messung wäre dahin.

            groessenText(bytes: number) {
                const g = groesse(bytes)

                return `${formatNumber(g.zahl)} ${g.einheit}`
            },

            klonFehlerText() {
                const codes: Record<string, string> = {
                    'nicht-angemeldet': 'Zum Laden musst du angemeldet sein — der Git-Zugang wird signiert (NIP-98).',
                    'kein-zugriff': 'Der Relay hat den Zugriff abgelehnt. Entweder bist du kein Mitglied des Kanals, zu dem dieses Repository gehört, oder die Signatur ist abgelaufen.',
                    netz: 'Der Git-Endpunkt war nicht erreichbar.',
                    abgebrochen: 'Abgebrochen.',
                    unbekannt: 'Das Repository liess sich nicht laden.',
                }

                return this.klon.fehler ? t(codes[this.klon.fehler] ?? codes.unbekannt) : ''
            },

            /**
             * Liegt es schon lokal? Diese Frage kostet KEIN Byte Netz — und sie
             * muss vor der Download-Aufforderung stehen, sonst bekommt jemand,
             * der das Repository längst hat, eine Aufforderung zum Herunterladen.
             */
            async klonPruefen() {
                const repo = this.view?.repo
                if (!repo) {
                    return
                }
                const url = waehleCloneUrl(repo.cloneUrls)
                if (!url) {
                    this.klon = { ...this.klon, lage: 'keine-url' }

                    return
                }
                // Ein fremder Git-Host ist kein Fehler — unser NIP-98-Token
                // trägt dort nur nicht. Die Fläche zeigt dann den Link statt
                // einer Fehlermeldung.
                if (!istEigenerHost(url, WORKSPACE_URL)) {
                    this.klon = { ...this.klon, lage: 'fremd', fremdUrl: repo.webUrl || url }

                    return
                }
                try {
                    const g = await import('./gitBrowser.ts')
                    if (await g.istGeklont(repo.owner, repo.dtag)) {
                        await this._readmeLesen()

                        return
                    }
                } catch (error) {
                    console.warn('[forge] README-Vorprüfung fehlgeschlagen', error)
                }
                this.klon = { ...this.klon, lage: 'bereit' }
            },

            async klonLaden() {
                const repo = this.view?.repo
                if (!repo || this.klon.lage === 'laedt') {
                    return
                }
                const url = waehleCloneUrl(repo.cloneUrls)
                const abbruch = new AbortController()
                this._klonAbbruch = abbruch
                this.klon = { ...this.klon, lage: 'laedt', fehler: '', fortschritt: null }
                try {
                    const g = await import('./gitBrowser.ts')
                    await g.klone({
                        url,
                        owner: repo.owner,
                        dtag: repo.dtag,
                        signal: abbruch.signal,
                        aufFortschritt: (f) => {
                            // Nur setzen, solange DIESER Vorgang läuft: ein
                            // abgebrochener Clone feuert noch Ereignisse nach,
                            // und die schrieben sonst über eine neue Lage.
                            if (this._klonAbbruch === abbruch && !this._dead) {
                                this.klon = { ...this.klon, fortschritt: f }
                            }
                        },
                    })
                    if (this._klonAbbruch !== abbruch || this._dead) {
                        return
                    }
                    await this._readmeLesen()
                } catch (error) {
                    if (this._klonAbbruch !== abbruch || this._dead) {
                        return
                    }
                    const code = ordneFehlerEin(error)
                    // Den ORIGINALFEHLER protokollieren, nicht nur den Code:
                    // `unbekannt` ist per Konstruktion die Schublade für alles,
                    // was wir nicht einordnen — ohne die Meldung daneben wäre
                    // sie eine Sackgasse für jeden, der das nachstellen muss.
                    console.warn('[forge] Klon fehlgeschlagen', code, error)
                    // Ein Abbruch ist kein Fehlerzustand: die Fläche kehrt in
                    // den Ausgangszustand zurück, damit ein zweiter Versuch
                    // einen Klick entfernt ist.
                    this.klon =
                        code === 'abgebrochen'
                            ? { ...this.klon, lage: 'bereit', fehler: '', fortschritt: null }
                            : { ...this.klon, lage: 'fehler', fehler: code, fortschritt: null }
                } finally {
                    if (this._klonAbbruch === abbruch) {
                        this._klonAbbruch = null
                    }
                }
            },

            klonAbbrechen() {
                this._klonAbbruch?.abort()
                this._klonAbbruch = null
                this.klon = { ...this.klon, lage: 'bereit', fehler: '', fortschritt: null }
            },

            async klonNeuLaden() {
                const repo = this.view?.repo
                if (!repo) {
                    return
                }
                try {
                    const g = await import('./gitBrowser.ts')
                    await g.entferneKlon(repo.owner, repo.dtag)
                } catch (error) {
                    console.warn('[forge] Klon liess sich nicht entfernen', error)
                }
                this.klon = { ...this.klon, lage: 'bereit', name: '', html: '', text: '', commit: '' }
                await this.klonLaden()
            },

            // ── Der PR-Diff (P7b) ────────────────────────────────────────────
            //
            // Ein kind 1618 trägt seinen Diff NICHT bei sich — anders als ein
            // 1617, dessen Unified Diff im `content` steht. Es nennt zwei
            // Commit-Ids und eine clone-URL; was dazwischen liegt, weiß nur Git.
            // Deshalb ist das hier ein zweiter, ANGESAGTER Ladeweg und keine
            // Anzeige über vorhandene Daten.

            // ── Die Vorgangssuche der Detailseite (P7b) ──────────────────────
            //
            // Dieselben Regeln wie auf der Übersicht (`forgeSearch.ts`) und
            // derselbe Grund: der Bestand dieses Repositories liegt seit P7a
            // ohnehin vollständig und repo-gescopt im Speicher. Eine Relay-Suche
            // wäre ein Roundtrip für Daten, die schon da sind — und sie könnte
            // weniger (NIP-50 durchsucht Text, keine Pubkeys).

            sichtbareIssues() {
                return sucheVorgaenge(this.view?.issues ?? [], this.suche)
            },
            sichtbarePulls() {
                return sucheVorgaenge(this.view?.pullRequests ?? [], this.suche)
            },
            sichtbarePatches() {
                return sucheVorgaenge(this.view?.patches ?? [], this.suche)
            },
            vorgaengeGesamt() {
                if (this.tab === 'issues') {
                    return this.view?.issues.length ?? 0
                }
                if (this.tab === 'pulls') {
                    return this.view?.pullRequests.length ?? 0
                }

                return this.tab === 'patches' ? (this.view?.patches.length ?? 0) : 0
            },
            vorgaengeSichtbar() {
                if (this.tab === 'issues') {
                    return this.sichtbareIssues().length
                }
                if (this.tab === 'pulls') {
                    return this.sichtbarePulls().length
                }

                return this.tab === 'patches' ? this.sichtbarePatches().length : 0
            },
            detailSucheName() {
                if (this.tab === 'pulls') {
                    return t('Pull Requests durchsuchen')
                }

                return this.tab === 'patches' ? t('Patches durchsuchen') : t('Issues durchsuchen')
            },
            detailSucheZahl() {
                if (this.tab === 'pulls') {
                    return t(':count von :total Pull Requests')
                }

                return this.tab === 'patches'
                    ? t(':count von :total Patches')
                    : t(':count von :total Issues')
            },
            detailSucheLeer() {
                if (this.tab === 'pulls') {
                    return t('Kein Pull Request passt dazu.')
                }

                return this.tab === 'patches' ? t('Kein Patch passt dazu.') : t('Kein Issue passt dazu.')
            },


            // ── Code-Browser (P6) ────────────────────────────────────────────
            // Alles hier liest aus DEMSELBEN Klon wie das README. Kein zweiter
            // Ladeweg: nach dem Clone ist alles lokal, und das ist der einzige
            // Vorteil, den das `blob:none`-Nein übriggelassen hat.

            krumel() {
                return krumelspur(this.code.pfad)
            },

            /** Ein Verzeichnis öffnen. `''` ist die Wurzel. */
            async codeOeffnen(pfad: string) {
                this.dateiSchliessen()
                this.code = { ...this.code, laedt: true, fehler: '' }
                const repo = this.view?.repo
                if (!repo) {
                    return
                }
                try {
                    const g = await import('./gitBrowser.ts')
                    const eintraege = await g.baumEintraege(repo.owner, repo.dtag, pfad)
                    this.code = { ...this.code, pfad, eintraege: sortiereEintraege(eintraege), laedt: false }
                } catch (error) {
                    console.warn('[forge] Baum konnte nicht gelesen werden', error)
                    this.code = { ...this.code, laedt: false, fehler: t('Dieses Verzeichnis liess sich nicht lesen.') }
                }
            },

            async codeHoch() {
                await this.codeOeffnen(elternPfad(this.code.pfad))
            },

            /**
             * Eine Datei öffnen — und VOR dem Rendern entscheiden, was mit ihr
             * geschieht.
             *
             * Die Entscheidung fällt an den Bytes (`dateiArt`), nicht an der
             * Endung allein: eine 6 MB grosse `vendor.js.map` wird gar nicht
             * erst dekodiert, und ein PNG landet nicht bei „binär". Sie
             * stillschweigend in den DOM zu schieben und dort scheitern zu
             * lassen, wäre keine Entscheidung, sondern ihr Fehlen.
             */
            async dateiOeffnen(pfad: string) {
                const repo = this.view?.repo
                if (!repo) {
                    return
                }
                // Eine vorherige Blob-URL freigeben, sonst hält das Dokument
                // jedes angesehene Bild bis zum Seitenwechsel im Speicher.
                if (this.code.bildUrl) {
                    URL.revokeObjectURL(this.code.bildUrl)
                }
                this.code = { ...this.code, laedt: true, fehler: '', datei: pfad, bildUrl: '', html: '', text: '' }
                try {
                    const g = await import('./gitBrowser.ts')
                    const bytes = await g.leseBytes(repo.owner, repo.dtag, pfad)
                    const art = dateiArt(pfad.split('/').pop() ?? pfad, bytes)
                    let html = ''
                    let text = ''
                    let bildUrl = ''
                    let gekuerzt = false
                    let zeilen = 0
                    if (art === 'bild') {
                        bildUrl = URL.createObjectURL(new Blob([bytes as BlobPart], { type: bildMime(pfad) }))
                    } else if (art === 'markdown' || art === 'text') {
                        const roh = new TextDecoder('utf-8', { fatal: false }).decode(bytes)
                        const k = kuerzeZeilen(roh)
                        gekuerzt = k.gekuerzt
                        zeilen = k.zeilen
                        if (art === 'markdown' && !k.gekuerzt) {
                            await ensureRenderer()
                            html = renderMarkdown(`datei:${repo.address}:${pfad}`, k.text)
                        } else {
                            // Gekürztes Markdown wird NICHT gerendert: ein
                            // abgeschnittener Codeblock oder eine offene
                            // Tabelle ergäben Markup, das etwas anderes zeigt
                            // als die Datei enthält.
                            text = k.text
                        }
                    }
                    this.code = {
                        ...this.code,
                        datei: pfad,
                        art,
                        html,
                        text,
                        bildUrl,
                        groesse: bytes.length,
                        gekuerzt,
                        zeilen,
                        laedt: false,
                    }
                } catch (error) {
                    console.warn('[forge] Datei konnte nicht gelesen werden', error)
                    this.code = { ...this.code, laedt: false, datei: '', fehler: t('Diese Datei liess sich nicht lesen.') }
                }
            },

            dateiSchliessen() {
                if (this.code.bildUrl) {
                    URL.revokeObjectURL(this.code.bildUrl)
                }
                this.code = { ...this.code, datei: '', art: '', html: '', text: '', bildUrl: '', groesse: 0, gekuerzt: false, zeilen: 0 }
            },

            // ── Was lokal liegt ──────────────────────────────────────────────

            /**
             * Die Speicherauskunft — erst auf Nachfrage, weil sie das ganze
             * Dateisystem durchzählt.
             */
            async speicherUmschalten() {
                if (this.speicher.offen) {
                    this.speicher = { ...this.speicher, offen: false }

                    return
                }
                try {
                    const g = await import('./gitBrowser.ts')
                    const [klone, lage] = await Promise.all([g.lokaleKlone(), g.speicherLage()])
                    this.speicher = {
                        offen: true,
                        klone,
                        belegt: lage?.belegt ?? 0,
                        kontingent: lage?.kontingent ?? 0,
                    }
                } catch (error) {
                    console.warn('[forge] Speicherauskunft fehlgeschlagen', error)
                    this.speicher = { ...this.speicher, offen: true, klone: [] }
                }
            },

            async klonEntfernen(owner: string, dtag: string) {
                try {
                    const g = await import('./gitBrowser.ts')
                    await g.entferneKlon(owner, dtag)
                    const [klone, lage] = await Promise.all([g.lokaleKlone(), g.speicherLage()])
                    this.speicher = { offen: true, klone, belegt: lage?.belegt ?? 0, kontingent: lage?.kontingent ?? 0 }
                } catch (error) {
                    console.warn('[forge] Klon liess sich nicht entfernen', error)
                }
                // Wurde DIESES Repository entfernt, muss die Fläche zurück auf
                // Anfang — sonst zeigte sie einen Baum, den es nicht mehr gibt.
                const repo = this.view?.repo
                if (repo && repo.owner === owner && repo.dtag === dtag) {
                    this.dateiSchliessen()
                    this.code = { ...this.code, pfad: '', eintraege: [] }
                    this.klon = { ...this.klon, lage: 'bereit', name: '', html: '', text: '', commit: '' }
                }
            },

            /** Aus dem lokalen Klon lesen — läuft ohne Netz. */
            async _readmeLesen() {
                const repo = this.view?.repo
                if (!repo) {
                    return
                }
                try {
                    const g = await import('./gitBrowser.ts')
                    const eintraege = await g.wurzelEintraege(repo.owner, repo.dtag)
                    // NUR Dateien: ein Verzeichnis namens `readme` ist kein README.
                    const name = findeReadme(eintraege.filter((e) => e.art === 'blob').map((e) => e.name))
                    const kopf = await g.kopfCommit(repo.owner, repo.dtag)
                    if (!name) {
                        this.klon = { ...this.klon, lage: 'leer', name: '', commit: kopf?.oid.slice(0, 7) ?? '' }

                        return
                    }
                    const roh = await g.leseDatei(repo.owner, repo.dtag, name)
                    await ensureRenderer()
                    this.klon = {
                        ...this.klon,
                        lage: 'da',
                        name,
                        // Derselbe Renderer wie beim Artikel und beim Issue —
                        // `markdown-it` mit `html:false`. Ein zweiter Renderer
                        // für Fremdtext wären zwei Sicherheitszusagen.
                        html: istMarkdown(name) ? renderMarkdown(`readme:${repo.address}:${name}`, roh) : '',
                        text: istMarkdown(name) ? '' : roh,
                        commit: kopf?.oid.slice(0, 7) ?? '',
                        fehler: '',
                        fortschritt: null,
                    }
                    // Der Wurzelbaum kommt gleich mit: er liegt im selben Klon,
                    // kostet kein Netz, und der Code-Tab soll nicht erst beim
                    // Anklicken zu laden anfangen.
                    this.code = { ...this.code, eintraege: sortiereEintraege(eintraege), pfad: '', datei: '' }
                } catch (error) {
                    this.klon = { ...this.klon, lage: 'fehler', fehler: ordneFehlerEin(error), fortschritt: null }
                }
            },
            truncatedText() {
                return !this.view || this.view.truncated.length === 0
                    ? ''
                    : t('Die Liste ist gekürzt — es liegen mehr Einträge auf dem Relay, als hier geladen wurden.')
            },

            canCopyClone() {
                return typeof navigator !== 'undefined' && typeof navigator.clipboard?.writeText === 'function'
            },

            /**
             * Die Clone-URL in die Zwischenablage.
             *
             * **Mit BEIDEN Zweigen der Zusage.** `writeText` lehnt auch in einem
             * sicheren Kontext ab — ohne Fokus im Dokument oder bei verweigerter
             * Berechtigung. Ein `.then()` allein (das Muster der älteren
             * Kopier-Knöpfe im Haus) verschluckte das: kein Toast, keine
             * Fehlermeldung, und der Nutzer glaubt, es liege etwas in seiner
             * Ablage. Deshalb steht hier der zweite Zweig, und er sagt, was jetzt
             * hilft — die Zeile ist per `select-all` weiterhin mit einem Klick
             * markiert.
             */
            copyClone() {
                const url = this.view?.repo.cloneUrls[0] ?? ''
                if (!url) {
                    return
                }
                void navigator.clipboard.writeText(url).then(
                    () => toast(t('Clone-URL kopiert.'), 'success'),
                    () => toast(t('Die Clone-URL ließ sich nicht kopieren. Markiere sie mit einem Klick und kopiere sie von Hand.')),
                )
            },

            anlegeZiel(desktop) {
                return anlegeForm(desktop, this.tab, !!this.view)
            },
            toggleIssueDraft() {
                // ── Der Riegel im PFAD, nicht nur am Knopf ───────────────────
                // Seit dem 2026-08-27 steht der Anlege-Knopf auch dann da, wenn
                // dieser Mensch nicht schreiben darf — inert, mit dem Grund
                // daneben (`writeHint()`), statt ersatzlos zu fehlen. Ein
                // `aria-disabled` ist aber nur eine ANSAGE: das Element bleibt
                // klickbar und mit der Tastatur auslösbar. Der Riegel muss
                // deshalb hier liegen.
                //
                // Nur der ÖFFNEN-Weg ist verriegelt. Fiele `canWrite()` bei
                // offenem Blatt um (Abmelden), verschlösse ein Riegel über der
                // ganzen Funktion das Blatt für immer — die drei Schließwege
                // (Kreuz, Abbrechen, Escape) laufen alle hier hindurch.
                if (!this.issueDraft.open) {
                    if (!this.canWrite()) {
                        return
                    }
                    // Beim ÖFFNEN auf die Issue-Liste wechseln (P4). Das gilt
                    // weiterhin, und zwar wegen der MOBILEN Form: der FAB steht
                    // am Bildrand und ist auf jedem Reiter erreichbar — ohne
                    // diesen Wechsel legte ein Klick auf dem Code-Reiter ein
                    // Issue an, von dem danach nichts zu sehen wäre (die neue
                    // Zeile, ein abgelehnter Schreibversuch und die Weckmeldung
                    // stehen alle drei in dieser Liste).
                    //
                    // Für die DESKTOP-Form (`anlegeForm` → `kopf`) ist die Zeile
                    // ein No-op: dieser Knopf steht ausschliesslich in der
                    // Leiste über der Issue-Liste, `tab` ist dort bereits
                    // `'issues'`. Sie bleibt trotzdem stehen — sie deckt die
                    // andere Form, und eine Zuweisung des Wertes, der schon
                    // dasteht, kostet nichts.
                    this.tab = 'issues'
                }
                this.issueDraft = { ...this.issueDraft, open: !this.issueDraft.open, error: '' }
            },
            async submitIssue() {
                const repoAddress = this.view?.repo.address ?? ''
                const problem = issueDraftProblem(
                    { title: this.issueDraft.title, body: this.issueDraft.body },
                    repoAddress,
                )
                if (problem) {
                    this.issueDraft = { ...this.issueDraft, error: problemText(problem) }

                    return
                }
                // Der Riegel liegt zusätzlich im Modul (`withLock`); dieses Flag
                // ist nur seine sichtbare Seite am Knopf.
                if (this.issueDraft.busy) {
                    return
                }
                this.issueDraft = { ...this.issueDraft, busy: true, error: '' }
                this.busyTick += 1
                const titel = this.issueDraft.title.trim()
                const rumpf = this.issueDraft.body
                // Der Hinweis des VORIGEN Absendevorgangs gehört nicht zu diesem.
                this.dismissWake('issue')
                const outcome = await publishIssue(repoAddress, {
                    title: this.issueDraft.title,
                    body: this.issueDraft.body,
                })
                if (this._dead) {
                    return
                }
                this.busyTick += 1
                this.issueDraft = outcome.error
                    ? { ...this.issueDraft, busy: false, error: outcome.error }
                    : { open: false, title: '', body: '', error: '', busy: false }
                // **Erst der Beitrag, dann der Weckruf** — und nur, wenn der
                // Beitrag wirklich steht. Ein Weckruf auf ein Issue, das der
                // Relay abgelehnt hat, schickte den Agenten auf einen Vorgang,
                // den es nicht gibt.
                if (!outcome.error && outcome.id) {
                    await this._wake('issue', rumpf, {
                        art: 'issue',
                        eventId: outcome.id,
                        what: 'issue',
                    })
                }
            },
            failedIssues() {
                return orphanedPending(this.pending, this.view?.issues ?? [], {
                    what: 'issue',
                    repoAddress: this.view?.repo.address ?? '',
                })
                    .filter((entry) => entry.state === 'failed')
                    .map(toFailedRow)
            },
            /**
             * Überschreibt die Werkzeug-Form: das Ziel `issue` gehört dem
             * Anlege-Formular dieser Fläche — sein Entwurf heisst
             * `issueDraft.body`, nicht `commentDraft[<id>]`. Alle anderen Ziele
             * (`comment:*`, `assign:*`) trägt das Werkzeug; diese Fläche ruft
             * sie nicht mehr auf, aber geteilt ist geteilt.
             */
            pickMention(item: MentionItemLike) {
                if (item && this.mention.target === 'issue') {
                    const ergebnis = spliceMention(
                        this.issueDraft.body,
                        this._mentionStart,
                        this.mention.query.length,
                        mentionInsert(item),
                    )
                    this.issueDraft = { ...this.issueDraft, body: ergebnis.text }
                    this.closeMentions()
                    const magics = this
                    magics.$nextTick(() => {
                        const feld = document.querySelector<HTMLTextAreaElement>(
                            `[data-forge-composer="issue"]`,
                        )
                        if (feld) {
                            feld.focus()
                            feld.setSelectionRange(ergebnis.caret, ergebnis.caret)
                        }
                    })

                    return
                }

                forgeVorgangWerkzeuge.pickMention.call(this, item)
            },

        }
    })

/**
 * Der Leer-Zwilling eines Vorgangs (P1).
 *
 * **Warum ein Stub und kein `null`:** Die Blatt-Markups binden Dutzende
 * Ausdrücke der Form `vorgang().title`. Mit `null` WERFEN diese, solange der
 * Relay-Bestand unterwegs ist — und ein Alpine-Ausdruck, der geworfen hat,
 * erholt sich nicht mehr: der Effekt verliert seine Abhängigkeiten, und selbst
 * nach dem Eintreffen der Daten bleibt die Fläche leer. Gemessen am Buzz-Stack
 * (Plan 2026-08-27T1950, P2): Kommentarform und Statusknöpfe blieben inert.
 * Der Stub macht jeden Ausdruck wohlgeformt (`''`, `[]`), und wenn der echte
 * Vorgang eintrifft, zieht dieselbe Bindung nach.
 */
const LEERER_VORGANG: Readonly<Record<string, unknown>> = Object.freeze({
    id: '',
    title: '',
    status: '',
    author: '',
    authorName: '',
    authorPicture: '',
    timeLabel: '',
    html: '',
    content: '',
    branch: '',
    repoAddress: '',
    labels: [],
    assignees: [],
    assignmentHeads: {},
    assigneePeople: [],
    commentCount: 0,
    comments: [],
    updates: [],
    reviewers: [],
    approvals: [],
    changeRequests: [],
    reviewerPeople: [],
    shortCommit: '',
    shortMergeCommit: '',
    shortAppliedAsCommits: [],
})

    Alpine.data('nostrForgeVorgang', (naddr: unknown, art: unknown, id: unknown) => {
        return {
            ...forgeVorgangWerkzeuge,
            commentDraft: {},
            commentError: {},
            assignQuery: {},
            assignPicks: {},
            prDiff: {},
            _prDiffAbbruch: {},
            mention: { open: false, items: [], index: 0, query: '', target: '' },
            wakeNotice: {},
            busyTick: 0,
            pending: [],
            viewer: '',
            _members: [],
            _agentItems: [],
            _agentView: null,
            _channelIds: new Set<string>(),
            _loadedProfiles: new Set<string>(),
            _mentionStart: -1,
            _unsubViewer: null,
            _unsubPending: null,
            _unsubMembers: null,
            _unsubAgents: null,
            _unsubRooms: null,
            loading: true,
            error: '',
            missing: false,
            /** Ungültige Id-Form — Leerfläche OHNE Relay-Kontakt (Whitelist). */
            ungueltig: false,
            view: null,
            /** `issue` oder `pr` — aus der Route, nie aus dem Inhalt geraten. */
            art: (art === 'pr' ? 'pr' : 'issue') as VorgangArt,
            /** Nur PRs: `diskussion` | `dateien` (`?tab=`, teilbar). */
            tab: vorgangTabFromLocation(),
            _naddr: String(naddr ?? ''),
            _id: String(id ?? '').toLowerCase(),
            _relaySelf: '',
            _dead: false,
            _controller: null,
            _unsub: null,
            /** Kam das EOSE der Laderunde? Erst dann ist „nicht gefunden" gedeckt. */
            _eose: false,

            /**
             * Der EINE Vorgang aus dem View — oder sein LEER-Zwilling (nie
             * `null`, Begründung am Stub). Wer die WAHRHEIT braucht (Leer-
             * flächen, Missing-Logik), fragt {@link vorgangDa}.
             */
            vorgang() {
                return this.vorgangRoh() ?? LEERER_VORGANG
            },
            /** Der rohe Befund: Zeile oder `null` — Grundlage aller Weichen. */
            vorgangRoh() {
                if (!this.view) {
                    return null
                }

                return (
                    (this.art === 'issue' ? this.view.issues : this.view.pullRequests).find(
                        (row) => row.id === this._id,
                    ) ?? null
                )
            },
            /** Steht der EINZIG echte Vorgang? (`x-show`-Wächter des Blatts.) */
            vorgangDa() {
                return this.vorgangRoh() !== null
            },
            /**
             * `#a1b2c3d` — sieben Stellen, wie `shortCommitId`. GitHub zählt
             * Issues fortlaufend; NIP-34 kennt keine Nummern, und einen Zähler
             * zu erfinden hiesse, eine Zahl zu behaupten, die der Relay jederzeit
             * ändert. Die Kurzform der Event-Id sagt dasselbe ohne zu lügen.
             */
            shortId() {
                return this._id.slice(0, 7)
            },
            statusText(code: string) {
                return statusLabel(code)
            },

            init() {
                // Regel 1 aus P2, unverändert: nur eine 64-stellige Hex-Id
                // gilt. Eine ungültige Form kostet KEINEN Relay-Kontakt —
                // dieselbe Reihenfolge wie bei jeder Weiche dieser Fläche:
                // erst die Form fragen, dann das Netz.
                if (!HEX64.test(this._id)) {
                    this.ungueltig = true
                    this.loading = false

                    return
                }
                this._controller = new AbortController()
                this._unsubSelf = deriveRelaySelf(WORKSPACE_URL).subscribe((self: string) => {
                    this._relaySelf = self
                })
                this._abonniereSchreibQuellen(this._controller?.signal)
                // Den Kommentarentwurf ANLEGEN, bevor das Feld ihn bindet —
                // sonst steht beim ersten Rendern „undefined" im Textfeld.
                this.commentDraft = { [this._id]: '' }
                void this._boot()
            },
            destroy() {
                this._dead = true
                this._unsub?.()
                this._unsubSelf?.()
                this._trenneSchreibQuellen()
                this._controller?.abort()
            },
            async _boot() {
                if (!WORKSPACE_URL) {
                    this.loading = false

                    return
                }
                this._unsub = deriveRepoView(this._naddr).subscribe((view: RepoView | null) => {
                    this.view = view
                    if (view) {
                        // Der `buzz-channel` des Repos entscheidet die Agenten-
                        // Eignung; der Diff des EINEN Vorschlags wird hier (und
                        // nur hier) vorgehalten.
                        this._recomputeAgentItems()
                        this._prDiffKarteNeu(view)
                    }
                    this._messeMissing()
                })
                try {
                    const outcome = await loadRepoDetail(
                        this._naddr,
                        this._relaySelf,
                        this._controller?.signal,
                    )
                    if (this._dead) {
                        return
                    }
                    this._eose = outcome.complete
                    // Der Repo-Bestand selbst fehlt → dieselbe Aussage wie auf
                    // der Repo-Seite; der Vorgang allein kann nicht „fehlen"
                    // behauptet werden, wenn das Relay das Repo nicht kennt.
                    this.error = !outcome.complete && !this.view ? t('Die Forge ist gerade nicht erreichbar.') : ''
                    this._messeMissing()
                    if (this.view && this._controller) {
                        watchForge([this.view.repo.address], this._controller.signal)
                    }
                } catch {
                    if (!this._dead && !this.view) {
                        this.error = t('Die Forge ist gerade nicht erreichbar.')
                    }
                } finally {
                    this.loading = false
                }
            },
            /**
             * „Nicht gefunden" — erst eine Aussage, wenn das Relay geantwortet
             * HAT (EOSE). Zwei Gestalten mit zwei Sätzen: kennt der Relay das
             * REPO nicht, fehlt der ganze Rahmen; kennt er das Repo, nicht aber
             * den Vorgang, fehlt nur dieser. Ein gemeinsamer Satz für beide
             * wäre die Sorte Begründung, nach der man erst recht fragt.
             */
            _messeMissing() {
                if (!this._eose) {
                    this.missing = false

                    return
                }
                this.missing = !this.view || this.vorgangRoh() === null
            },
            retry() {
                this.error = ''
                this.missing = false
                this._eose = false
                this._controller?.abort()
                this._controller = new AbortController()
                this.loading = true
                void this._boot()
            },
        }
    })
}
