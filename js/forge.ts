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
 * 3. **Grabsteine werden über `#a` gescopet**, in Blöcken zu höchstens 100
 *    Werten. Ein unscoped `{kinds:[5]}` zöge die gesamte Löschhistorie der
 *    Community — dieselbe Vorsicht wie in Buzz' `projectEnumeration.ts:117-150`.
 * 4. **Keine Boundary-Bucket-Paginierung.** Buzz braucht Vollständigkeit, weil
 *    seine Push-Policy daran hängt; eine Leseliste nicht. Statt dessen
 *    `limit:500` und ein **ehrlicher Hinweis**, wenn genau so viele Ereignisse
 *    ankamen ({@link ForgeOverview.truncated}) — eine stillschweigend gekürzte
 *    Liste ist eine falsche Aussage über den Bestand.
 */
import { deriveRelay, displayProfileByPubkey, profilesByPubkey, pubkey } from '@welshman/app'
import { load, request } from '@welshman/net'
import { throttled } from '@welshman/store'
import type { Filter, TrustedEvent } from '@welshman/util'
import * as nip19 from 'nostr-tools/nip19'
import { derived, readable, writable, type Readable } from 'svelte/store'
import { proxifyImage } from './core'
import { t } from './i18n'
import { toast } from './toast'
import { formatTimestamp } from './locale'
import { warmProfiles } from './profiles'
import { deriveEventsForUrl } from './repository'
import { WORKSPACE_URL, deriveSpaceKind, type SpaceKind } from './spaceCaps.ts'
import { buildActivity, type ActivityItem } from './forgeActivity.ts'
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
    buildIssues,
    buildProjects,
    buildPullRequests,
    buildRepos,
    foldRepoState,
    truncatedLists,
    unclaimedRepos,
    type ForgeEvent,
    type Issue,
    type Project,
    type PullRequest,
    type Repo,
    type RepoState,
} from './forgeModels.ts'
import {
    WRITABLE_ISSUE_STATUSES,
    commentDraftProblem,
    issueDraftProblem,
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
    publishForgeComment,
    publishIssue,
    publishIssueStatus,
} from './forgeWrite'

// ── Grenzen ─────────────────────────────────────────────────────────────────

/** Obergrenze der Bestandslisten. Buzz deckelt selbst auf `max_limit: 1000`. */
export const FORGE_LIST_LIMIT = 500
/** Obergrenze für Issues und PRs je Repo (wie im Referenzclient). */
export const FORGE_ROOT_LIMIT = 200
/** Höchstzahl `#a`-Werte je Grabstein-Anfrage. */
export const TOMBSTONE_CHUNK = 100
/** Wie viele Zeilen die Zeitleiste höchstens zeigt (wie im Referenzclient: 30). */
export const ACTIVITY_LIMIT = 50

// ── `naddr` ─────────────────────────────────────────────────────────────────

/**
 * `naddr` eines Repos — die Kennung in der URL.
 *
 * Wie beim Artikel (`longform.ts:385`) und aus demselben Grund: ein 30617 ist
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

/** Repos, Projekte und Branch-Zustände — der Bestand der Übersichtsseite. */
const overviewFilters = (relaySelf: string): Filter[] => [
    { kinds: [REPO_ANNOUNCEMENT], limit: FORGE_LIST_LIMIT },
    { kinds: [PROJECT_ANNOUNCEMENT], limit: FORGE_LIST_LIMIT },
    // Der `authors`-Filter ist hier die eigentliche Aussage: siehe Eigenheit 1
    // im Modulkopf. Ohne bekanntes `self` bleibt er weg — dann liefert der Relay
    // alle 30618 und `foldRepoState` sortiert die unberechtigten selbst aus.
    relaySelf
        ? { kinds: [REPO_STATE], authors: [relaySelf], limit: FORGE_LIST_LIMIT }
        : { kinds: [REPO_STATE], limit: FORGE_LIST_LIMIT },
]

/** Issues, PRs, PR-Updates, Statuswechsel und Kommentare zu gegebenen Repos. */
const contentFilters = (addresses: string[]): Filter[] =>
    addresses.length === 0
        ? []
        : [
              { kinds: [GIT_ISSUE], '#a': addresses, limit: FORGE_ROOT_LIMIT },
              { kinds: [GIT_PULL_REQUEST], '#a': addresses, limit: FORGE_ROOT_LIMIT },
              { kinds: [GIT_PR_UPDATE], '#a': addresses, limit: FORGE_LIST_LIMIT },
              { kinds: [...GIT_STATUS_KINDS], '#a': addresses, limit: FORGE_LIST_LIMIT },
              // Eigenheit 2: kind 1, nicht 1111.
              { kinds: [FORGE_COMMENT], '#a': addresses, limit: FORGE_LIST_LIMIT },
          ]

/** Grabsteine, gescopet über `#a` (Eigenheit 3). */
const tombstoneFilters = (addresses: string[]): Filter[] => {
    const filters: Filter[] = []
    for (let i = 0; i < addresses.length; i += TOMBSTONE_CHUNK) {
        filters.push({ kinds: [DELETION], '#a': addresses.slice(i, i + TOMBSTONE_CHUNK) })
    }

    return filters
}

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
    /**
     * Die Maintainer mit aufgelöstem Namen und Bild.
     *
     * Getrennt von `maintainers` (den rohen Pubkeys), weil die Fläche Menschen
     * zeigt und keine Hex-Ketten — und weil ein `x-for` über die rohen Schlüssel
     * die Initiale aus einer Hex-Ziffer bilden würde.
     */
    people: { pubkey: string; name: string; picture: string }[]
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
}

export type ForgeOverview = {
    repos: RepoRow[]
    projects: ProjectRow[]
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
    activity: ActivityRow[]
    /**
     * Welche Listen genau am Limit ankamen und deshalb gekürzt sein KÖNNTEN.
     * Leer = keine Kürzung. Siehe Eigenheit 4 im Modulkopf.
     */
    truncated: string[]
}

const EMPTY_OVERVIEW: ForgeOverview = {
    repos: [],
    projects: [],
    unclaimed: [],
    counts: { projects: 0, repos: 0, pullRequests: 0, issues: 0 },
    activity: [],
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
const nameOf = (pubkey: string): string => (pubkey ? displayProfileByPubkey(pubkey) : '')

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
    'pr-opened': 'hat einen Pull Request eröffnet:',
    'pr-updated': 'hat einen Pull Request aktualisiert:',
    'pr-status': 'hat den Status eines Pull Requests geändert:',
    comment: 'hat kommentiert:',
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
    timeLabel: string
    statusLabel: string
}

const toActivityRows = (
    items: ActivityItem[],
    profiles: Map<string, { picture?: string }>,
): ActivityRow[] =>
    items.map((item) => ({
        ...item,
        actorName: nameOf(item.actor),
        // ROH wie im Profil — `x-group::nostr-avatar` proxifiziert selbst; ein
        // hier schon proxifizierter Wert liefe zweimal durch den Proxy.
        actorPicture: profiles.get(item.actor)?.picture ?? '',
        verb: t(ACTIVITY_VERBS[item.type]),
        timeLabel: timeLabel(item.createdAt),
        statusLabel: statusLabel(item.status),
    }))

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
            const deletions = all.filter((event) => event.kind === DELETION)
            const repos = buildRepos(all, deletions)
            const projects = buildProjects(all, repos, deletions)
            const addresses = new Set(repos.map((repo) => repo.address))
            const issues = buildIssues(all, all, all).filter((issue) => addresses.has(issue.repoAddress))
            const pulls = buildPullRequests(all, all, all, all).filter((pr) => addresses.has(pr.repoAddress))

            const issuesByRepo = new Map<string, number>()
            for (const issue of issues) {
                issuesByRepo.set(issue.repoAddress, (issuesByRepo.get(issue.repoAddress) ?? 0) + 1)
            }
            const pullsByRepo = new Map<string, number>()
            for (const pr of pulls) {
                pullsByRepo.set(pr.repoAddress, (pullsByRepo.get(pr.repoAddress) ?? 0) + 1)
            }

            const rows: RepoRow[] = repos.map((repo) => ({
                ...repo,
                naddr: naddrForRepo(repo.owner, repo.dtag, WORKSPACE_URL ? [WORKSPACE_URL] : []),
                ownerName: nameOf(repo.owner),
                dateLabel: dateLabel(repo.createdAt),
                state: foldRepoState(all, { owner: repo.owner, relaySelf: relaySelf as string, dtag: repo.dtag }),
                issueCount: issuesByRepo.get(repo.address) ?? 0,
                pullRequestCount: pullsByRepo.get(repo.address) ?? 0,
                people: peopleOf(repo.maintainers, profiles as Map<string, { picture?: string }>),
            }))
            const byAddress = new Map(rows.map((row) => [row.address, row]))

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
                counts: {
                    projects: projects.length,
                    repos: repos.length,
                    pullRequests: pulls.length,
                    issues: issues.length,
                },
                activity: toActivityRows(
                    buildActivity({ repos, events: all }).slice(0, ACTIVITY_LIMIT),
                    profiles as Map<string, { picture?: string }>,
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
    const base = await load({
        relays: [WORKSPACE_URL],
        filters: [
            { kinds: [REPO_ANNOUNCEMENT], limit: FORGE_LIST_LIMIT },
            { kinds: [PROJECT_ANNOUNCEMENT], limit: FORGE_LIST_LIMIT },
        ],
        signal,
    })

    const addresses = repoAddressesOf(base)
    if (addresses.length === 0 || signal?.aborted) {
        return
    }

    await load({
        relays: [WORKSPACE_URL],
        filters: [
            { kinds: [GIT_ISSUE], '#a': addresses, limit: FORGE_ROOT_LIMIT },
            { kinds: [GIT_PULL_REQUEST], '#a': addresses, limit: FORGE_ROOT_LIMIT },
            ...tombstoneFilters(addresses),
        ],
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
    html: string
    timeLabel: string
}

export type IssueRow = Omit<Issue, 'comments'> & {
    authorName: string
    timeLabel: string
    html: string
    comments: CommentRow[]
}

export type PullRequestRow = Omit<PullRequest, 'comments' | 'updates'> & {
    authorName: string
    timeLabel: string
    html: string
    shortCommit: string
    comments: CommentRow[]
    updates: { id: string; authorName: string; shortCommit: string; timeLabel: string; html: string }[]
}

export type RepoView = {
    repo: RepoRow
    issues: IssueRow[]
    pullRequests: PullRequestRow[]
    activity: ActivityRow[]
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
        renderer = (await import('./longform')).renderArticleHtml
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
 * `longformFeed.ts:160`.
 */
const htmlCache = new Map<string, string>()

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

const toCommentRow = (comment: { id: string; author: string; content: string; createdAt: number }): CommentRow => ({
    id: comment.id,
    author: comment.author,
    authorName: nameOf(comment.author),
    html: renderMarkdown(comment.id, comment.content),
    timeLabel: timeLabel(comment.createdAt),
})

const SHORT_HASH = 7
const shortCommit = (commit: string): string =>
    /^[0-9a-f]{7,64}$/i.test(commit) ? commit.slice(0, SHORT_HASH) : ''

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
            const deletions = all.filter((event) => event.kind === DELETION)
            const repo = buildRepos(all, deletions).find(
                (candidate) => candidate.owner === address.owner && candidate.dtag === address.dtag,
            )
            if (!repo) {
                return null
            }

            const issues = buildIssues(all, all, all).filter((issue) => issue.repoAddress === repo.address)
            const pulls = buildPullRequests(all, all, all, all).filter((pr) => pr.repoAddress === repo.address)
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
                state: foldRepoState(all, { owner: repo.owner, relaySelf: relaySelf as string, dtag: repo.dtag }),
                issueCount: issues.length,
                pullRequestCount: pulls.length,
                people: peopleOf(repo.maintainers, profiles as Map<string, { picture?: string }>),
            }

            return {
                repo: row,
                issues: issues.map((issue) => ({
                    ...issue,
                    authorName: nameOf(issue.author),
                    timeLabel: timeLabel(issue.createdAt),
                    html: renderMarkdown(issue.id, issue.content),
                    comments: issue.comments.map(toCommentRow),
                })),
                pullRequests: pulls.map((pr) => ({
                    ...pr,
                    authorName: nameOf(pr.author),
                    timeLabel: timeLabel(pr.createdAt),
                    html: renderMarkdown(pr.id, pr.content),
                    shortCommit: shortCommit(pr.commit),
                    comments: pr.comments.map(toCommentRow),
                    updates: pr.updates.map((update) => ({
                        id: update.id,
                        authorName: nameOf(update.author),
                        shortCommit: shortCommit(update.commit),
                        timeLabel: timeLabel(update.createdAt),
                        html: renderMarkdown(update.id, update.content),
                    })),
                })),
                activity: toActivityRows(
                    buildActivity({ repos: [repo], events: all }).slice(0, ACTIVITY_LIMIT),
                    profiles as Map<string, { picture?: string }>,
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
 * mit dem sie nie gesprochen hat (Messtabelle in `longformFeed.ts:239-258`).
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

    let complete = false
    const base = await load({
        relays: [WORKSPACE_URL],
        filters: overviewFilters(relaySelf),
        signal,
        onEose: () => {
            complete = true
        },
    })
    warm(base)

    const addresses = repoAddressesOf(base)
    if (addresses.length === 0 || signal?.aborted) {
        return { complete, count: base.length }
    }

    const rest = await load({
        relays: [WORKSPACE_URL],
        filters: [...contentFilters(addresses), ...tombstoneFilters(addresses)],
        signal,
    })
    warm(rest)

    return { complete, count: base.length + rest.length }
}

/**
 * Live bleiben, solange die Fläche offen ist.
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
export const watchForge = (addresses: string[], signal: AbortSignal): void => {
    if (!WORKSPACE_URL || addresses.length === 0) {
        return
    }
    void request({
        relays: [WORKSPACE_URL],
        filters: contentFilters(addresses).map((filter) => ({ ...filter, limit: 0 })),
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
    overview: ForgeOverview
    _base: string
    _dead: boolean
    _controller: AbortController | null
    _unsub: (() => void) | null
    _unsubKind: (() => void) | null
    _unsubSelf: (() => void) | null
    _relaySelf: string
    init(): void
    destroy(): void
    _boot(): Promise<void>
    _load(): Promise<void>
    retry(): void
    isEmpty(): boolean
    settled(): boolean
    counts(): ForgeCounts
    repoHref(row: { naddr: string }): string
    truncatedText(): string
}

/** Der Entwurf eines neuen Issues, wie ihn das Formular hält. */
type IssueDraft = { open: boolean; title: string; body: string; error: string; busy: boolean }

type ForgeRepoState = {
    loading: boolean
    error: string
    missing: boolean
    kind: SpaceKind
    tab: string
    view: RepoView | null
    open: Record<string, boolean>
    /** Der angemeldete Pubkey — `''` heißt: nicht angemeldet. */
    viewer: string
    /** Laufende und gescheiterte Schreibvorgänge (aus `forgeWrite.ts`). */
    pending: PendingWrite[]
    issueDraft: IssueDraft
    /** Kommentarentwurf je Wurzel-Id. */
    commentDraft: Record<string, string>
    /** Fehler des Kommentarentwurfs je Wurzel-Id. */
    commentError: Record<string, string>
    /** Neu gezeichnet, wenn sich ein Riegel ändert — `isBusy` ist kein Store. */
    busyTick: number
    _naddr: string
    _dead: boolean
    _controller: AbortController | null
    _unsub: (() => void) | null
    _unsubKind: (() => void) | null
    _unsubSelf: (() => void) | null
    _unsubViewer: (() => void) | null
    _unsubPending: (() => void) | null
    _relaySelf: string
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
    // ── Schreiben ───────────────────────────────────────────────────────────
    writeGate(): WriteGate
    writeHint(): string
    canWrite(): boolean
    toggleIssueDraft(): void
    submitIssue(): Promise<void>
    commentBusy(rootId: string): boolean
    submitComment(root: { id: string; author: string; repoAddress: string; comments: { createdAt: number }[] }): Promise<void>
    statusOptions(): { code: WritableIssueStatus; label: string }[]
    statusGateFor(row: { author: string; repoAddress: string }): WriteGate
    canSetStatus(row: { author: string; repoAddress: string }): boolean
    statusHint(row: { author: string; repoAddress: string }): string
    statusBusy(rootId: string): boolean
    setStatus(row: IssueRow, code: WritableIssueStatus): Promise<void>
    _statusCreatedAt(rootId: string): number
    rowState(id: string): string
    failedIssues(): FailedWriteRow[]
    failedFor(rootId: string): FailedWriteRow[]
    dismiss(id: string): void
}

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

        return tab === 'issues' || tab === 'pulls' ? tab : 'issues'
    } catch {
        return 'issues'
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
            tab: 'activity',
            overview: EMPTY_OVERVIEW,
            _base: String(base ?? '').replace(/\/+$/, ''),
            _dead: false,
            _controller: null,
            _unsub: null,
            _unsubKind: null,
            _unsubSelf: null,
            _relaySelf: '',
            init() {
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
            repoHref(row: { naddr: string }) {
                return row.naddr ? `${this._base}/${row.naddr}` : ''
            },
            truncatedText() {
                return this.overview.truncated.length === 0
                    ? ''
                    : t('Die Liste ist gekürzt — es liegen mehr Einträge auf dem Relay, als hier geladen wurden.')
            },
        }
    })

    Alpine.data('nostrForgeRepo', (naddr: unknown): ForgeRepoState => {
        return {
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
            view: null,
            open: {},
            viewer: '',
            pending: [],
            issueDraft: { open: false, title: '', body: '', error: '', busy: false },
            commentDraft: {},
            commentError: {},
            busyTick: 0,
            _naddr: String(naddr ?? ''),
            _dead: false,
            _controller: null,
            _unsub: null,
            _unsubKind: null,
            _unsubSelf: null,
            _unsubViewer: null,
            _unsubPending: null,
            _relaySelf: '',
            init() {
                this._controller = new AbortController()
                this._unsubKind = deriveSpaceKind(WORKSPACE_URL).subscribe((kind: SpaceKind) => {
                    this.kind = kind
                })
                this._unsubSelf = deriveRelaySelf(WORKSPACE_URL).subscribe((self: string) => {
                    this._relaySelf = self
                })
                // Der angemeldete Schlüssel ist eine Quelle wie jede andere: er
                // kann NACH dem Mount eintreffen (localStorage-Rehydrierung) und
                // sich im Betrieb ändern (Abmelden). Ein einmaliges `pubkey.get()`
                // im `init` wäre genau die Schnappschuss-Falle, an der schon die
                // Relay-Erkennung hing.
                this._unsubViewer = pubkey.subscribe((pk: string | undefined) => {
                    this.viewer = pk ?? ''
                })
                this._unsubPending = forgePending.subscribe((list: PendingWrite[]) => {
                    this.pending = list
                })
                void this._boot()
            },
            destroy() {
                this._dead = true
                this._unsub?.()
                this._unsubKind?.()
                this._unsubSelf?.()
                this._unsubViewer?.()
                this._unsubPending?.()
                this._controller?.abort()
                // Die Fehlermeldung eines Schreibversuchs gehört zu DIESEM
                // Bildschirm. Wer die Seite verlässt, hat sie zur Kenntnis
                // genommen; sie auf der nächsten Seite wieder aufzuschlagen wäre
                // eine Nachricht ohne Zusammenhang.
                clearPending()
            },
            async _boot() {
                if (!WORKSPACE_URL) {
                    this.loading = false

                    return
                }
                this._unsub = deriveRepoView(this._naddr).subscribe((view: RepoView | null) => {
                    this.view = view
                    if (view) {
                        // Steht das Repo, ist die Frage beantwortet — auch wenn
                        // der `load` noch läuft (Kaltstart-Cache).
                        this.loading = false
                        this.missing = false
                        this.error = ''
                    }
                })
                await this._load()
            },
            async _load() {
                try {
                    const outcome = await loadForge(this._relaySelf, this._controller?.signal)
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
            toggle(id: string) {
                const next = !this.open[id]
                this.open = { ...this.open, [id]: next }
                // Den Kommentarentwurf ANLEGEN, bevor das Feld ihn bindet: ein
                // `x-model` auf einen noch nicht existierenden Schlüssel schreibt
                // beim ersten Rendern `undefined` ins Textfeld — sichtbar als das
                // Wort „undefined" im leeren Formular.
                if (next && this.commentDraft[id] === undefined) {
                    this.commentDraft = { ...this.commentDraft, [id]: '' }
                }
            },
            statusText(code: string) {
                return statusLabel(code)
            },
            truncatedText() {
                return !this.view || this.view.truncated.length === 0
                    ? ''
                    : t('Die Liste ist gekürzt — es liegen mehr Einträge auf dem Relay, als hier geladen wurden.')
            },

            // Begründung am Typ. Bewusst eine Frage an `navigator`, nicht ein
            // gemerkter Wert: der Kontext einer Seite ändert sich nicht, und ein
            // Schnappschuss im `init` wäre eine Kopie ohne Gewinn.
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

            // ── Schreiben ───────────────────────────────────────────────────
            //
            // **Wer nicht darf, sieht das VOR dem Absenden.** Die Fläche rendert
            // deshalb nirgends ein Formular, dessen Absenden absehbar scheitert —
            // sie zeigt stattdessen den Grund. Zwei Ebenen, und sie sind nicht
            // dasselbe: `writeGate` fragt nur, ob überhaupt jemand angemeldet ist
            // (der Relay lässt kein Nicht-Mitglied bis zum Lesen kommen, siehe
            // `memberGate`), `statusGateFor` fragt zusätzlich, ob dieser Mensch
            // für DIESES Issue zuständig ist. Der zweite Riegel ist der wichtige:
            // der Relay nimmt einen Statuswechsel von jedem an und zeigt ihn
            // dann nirgends an — ein stiller Leerlauf.
            writeGate() {
                return memberGate(this.viewer)
            },
            writeHint() {
                return gateText(this.writeGate())
            },
            canWrite() {
                return this.writeGate().allowed
            },
            toggleIssueDraft() {
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
            },
            commentBusy(rootId: string) {
                // `busyTick` steht hier, damit Alpine die Bindung überhaupt neu
                // auswertet: `isBusy` liest ein Modul-`Set`, das kein Store ist.
                return this.busyTick >= 0 && isBusy(`comment:${rootId}`)
            },
            async submitComment(root) {
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
            },
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
            async setStatus(row: IssueRow, code: WritableIssueStatus) {
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
            rowState(id: string) {
                return pendingState(this.pending, id)
            },
            failedIssues() {
                return orphanedPending(this.pending, this.view?.issues ?? [], {
                    what: 'issue',
                    repoAddress: this.view?.repo.address ?? '',
                })
                    .filter((entry) => entry.state === 'failed')
                    .map(toFailedRow)
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
        }
    })
}
