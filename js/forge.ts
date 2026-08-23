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
import { formatTimestamp } from './locale.ts'
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
import { buildActivity, type ActivityItem } from './forgeActivity.ts'
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
    buildIssues,
    buildProjects,
    buildPullRequests,
    buildRepos,
    foldRepoState,
    maintainerLookupFor,
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
} from './forgeWrite.ts'

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
    unclaimed: [],
    counts: { projects: 0, repos: 0, pullRequests: 0, issues: 0 },
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
        verb: t(ACTIVITY_VERBS[item.type]),
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
                // Die Übersicht mischt Repos — hier nennt die Zeile ihr Repo,
                // aber nur beim Wechsel.
                activityGroups: toActivityGroups(
                    buildActivity({ repos, events: all }).slice(0, ACTIVITY_LIMIT),
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
            // Eine Uhr für diesen Emit — siehe `toActivityGroups`.
            const now = Math.floor(Date.now() / 1000)
            const deletions = all.filter((event) => event.kind === DELETION)
            const repo = buildRepos(all, deletions).find(
                (candidate) => candidate.owner === address.owner && candidate.dtag === address.dtag,
            )
            if (!repo) {
                return null
            }

            // Genau ein Repo auf dieser Fläche — die Nachschlagefunktion baut sich aus ihm.
            const maintainersOf = maintainerLookupFor([repo])
            const issues = buildIssues(all, all, all, maintainersOf).filter(
                (issue) => issue.repoAddress === repo.address,
            )
            const pulls = buildPullRequests(all, all, all, all, maintainersOf).filter(
                (pr) => pr.repoAddress === repo.address,
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
                activityGroups: toActivityGroups(
                    buildActivity({ repos: [repo], events: all }).slice(0, ACTIVITY_LIMIT),
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
    /**
     * Der @-Vorschlag. EIN Zustand für alle Composer dieser Seite (ein Issue-
     * Formular plus je ein Kommentarfeld pro Vorgang) — `target` sagt, welcher
     * gerade tippt. Zwei offene Vorschläge kann es nicht geben: es tippt immer
     * nur ein Feld.
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
    // ── Schreiben ───────────────────────────────────────────────────────────
    writeGate(): WriteGate
    writeHint(): string
    canWrite(): boolean
    toggleIssueDraft(): void
    submitIssue(): Promise<void>
    commentBusy(rootId: string): boolean
    submitComment(
        root: { id: string; title?: string; author: string; repoAddress: string; comments: { createdAt: number }[] },
        art?: 'issue' | 'pr',
    ): Promise<void>
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
    // ── @-Erwähnung + Weckmeldung ───────────────────────────────────────────
    onComposerInput(el: HTMLTextAreaElement, target: string): void
    mentionKey(event: KeyboardEvent): void
    pickMention(item: MentionItemLike): void
    closeMentions(): void
    _mentionItemsFor(query: string): MentionItemLike[]
    _recomputeAgentItems(): void
    _wake(target: string, content: string, vorgang: WakeTargetInput): Promise<void>
    dismissWake(target: string): void
}

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
            // Der Tab kommt aus `?tab=`, wenn er dort steht — und er wird auch dorthin
            // zurückgeschrieben (siehe `init`). Beide Richtungen, weil sonst genau der
            // Fehler entsteht, gegen den `forgeTab.ts` geschrieben ist: die Adresse
            // behauptet einen Tab, der Bildschirm zeigt einen anderen. Seit P5 ist das
            // hier nicht mehr theoretisch — `/spaces?tab=workspaces` LEITET hierher.
            tab: readForgeTab(window.location.search),
            overview: EMPTY_OVERVIEW,
            _base: String(base ?? '').replace(/\/+$/, ''),
            _dead: false,
            _controller: null,
            _unsub: null,
            _unsubKind: null,
            _unsubSelf: null,
            _relaySelf: '',
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
                // ── Zwei Quellen für den @-Vorschlag ────────────────────────
                //
                // Dieselben wie im Chat (`bridge.ts`), und aus demselben Grund
                // hier noch einmal statt geteilt: der Chat hängt an einem RAUM,
                // diese Fläche am Workspace. Was sie teilen, sind die reinen
                // Regeln (`agentMentionItems`, `mergeMentionItems`,
                // `mentionCompose.ts`) — nicht die Anbindung.
                //
                // Der Kanal für die Eignungsprüfung ist der `buzz-channel` des
                // REPOS und steht erst mit `view` fest; deshalb faltet
                // `_recomputeAgentItems` auch dort noch einmal.
                const signal = this._controller?.signal
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
                        // Der Agentenvorschlag borgt sich Avatar und Profilnamen
                        // aus dieser Liste (ein 10100 trägt kein Bild).
                        this._recomputeAgentItems()
                    })
                    // Die Raumliste des Nutzers — Grundlage des Kanal-Riegels.
                    // Sie liegt in der Insel ohnehin vor (Rail/Palette lesen
                    // dieselbe Quelle); ein eigener REQ entsteht dafür nicht.
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
                void this._boot()
            },
            destroy() {
                this._dead = true
                this._unsub?.()
                this._unsubKind?.()
                this._unsubSelf?.()
                this._unsubViewer?.()
                this._unsubPending?.()
                this._unsubMembers?.()
                this._unsubAgents?.()
                this._unsubRooms?.()
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

            // ── @-Erwähnung im Forge-Composer ───────────────────────────────
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
                const items = this._mentionItemsFor(treffer.query)
                this.mention = { open: items.length > 0, items, index: 0, query: treffer.query, target }
            },
            /**
             * Die gefilterte Vorschlagsliste zu einer Suche.
             *
             * Eigene Funktion, weil sie an ZWEI Stellen gebraucht wird: beim Tippen
             * und beim Nachziehen einer Quelle. Agenten vor Mitgliedern und jede
             * Identität genau einmal — die Regel steht in `mergeMentionItems`
             * (rein, getestet), nicht hier.
             */
            _mentionItemsFor(query: string) {
                const q = query.toLowerCase()

                // Der Deckel liegt in `mergeMentionItems` und ist ZWEIGETEILT
                // (Agenten/Menschen getrennt) — ein gemeinsamer Schnitt auf der
                // fertigen Liste ließ Agenten die Menschen verdrängen und
                // einander dazu. Begründung dort.
                return mergeMentionItems(
                    this._members.filter((item) => !q || item.search.includes(q)),
                    this._agentItems.filter((item) => !q || item.search.includes(q)),
                )
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
                    this.pickMention(this.mention.items[this.mention.index]!)
                } else if (event.key === 'Escape') {
                    event.preventDefault()
                    this.closeMentions()
                }
            },
            /**
             * Vorschlag übernehmen: `@query` durch `nostr:npub… ` ersetzen.
             *
             * Der Fokus geht über ein **Datenattribut** zurück ins Feld und nicht
             * über `x-ref`: die Kommentarfelder stehen in einem `x-for`, und ein
             * `x-ref` im Schleifenrumpf zeigt dort nur auf den zuletzt
             * gerenderten. Der Haken ist eindeutig, die Referenz wäre es nicht.
             */
            pickMention(item: MentionItemLike) {
                if (!item) {
                    return
                }
                const ziel = this.mention.target
                const insert = mentionInsert(item)
                const istIssue = ziel === 'issue'
                const rootId = istIssue ? '' : ziel.slice('comment:'.length)
                const entwurf = istIssue ? this.issueDraft.body : (this.commentDraft[rootId] ?? '')
                const { text, caret } = spliceMention(entwurf, this._mentionStart, this.mention.query.length, insert)
                if (istIssue) {
                    this.issueDraft = { ...this.issueDraft, body: text }
                } else {
                    this.commentDraft = { ...this.commentDraft, [rootId]: text }
                }
                this.closeMentions()
                const magics = this as unknown as { $nextTick: (cb: () => void) => void }
                magics.$nextTick(() => {
                    const feld = document.querySelector<HTMLTextAreaElement>(
                        `[data-forge-composer="${CSS.escape(ziel)}"]`,
                    )
                    if (feld) {
                        feld.focus()
                        feld.setSelectionRange(caret, caret)
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
             * Kanalfilter, Betrachterfilter und der zooid-Riegel liegen
             * vollständig in `agentMentionItems` — hier steht keine Regel, nur
             * die Übergabe. Maßgeblich ist der `buzz-channel` des REPOS: trägt
             * das Announcement keinen, ist `h` leer, und `agentServesChannel`
             * liefert für jeden Agenten `false`. Kein Kanal, kein Vorschlag.
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
                // Liste ohne Agenten — die Vorschläge werden je Tastendruck
                // berechnet und nie wieder angefasst. Im E2E genau so
                // aufgeschlagen: derselbe Test, einmal grün, einmal rot.
                if (this._mentionStart >= 0) {
                    // **Die Bedingung ist der offene SUCHBEGRIFF, nicht das offene
                    // Fenster.** Der schlimmste Fall ist gerade der, in dem das
                    // Fenster ZU ist: wer den Namen eines Agenten tippt, dessen
                    // 10100 noch unterwegs ist, hat null Treffer — und mit einer
                    // Bedingung auf `open` käme der Vorschlag nie mehr, auch wenn
                    // das Profil eine Sekunde später eintrifft.
                    const items = this._mentionItemsFor(this.mention.query)
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
            /**
             * Die Weckmeldung — **nach** einem erfolgreich veröffentlichten
             * Beitrag, ausgelöst durch nichts als diese eine Nutzerhandlung.
             *
             * Ihr Ausgang ist ein EIGENES Ergebnis: scheitert sie, bleibt der
             * Beitrag gültig und wird als gelungen dargestellt. Der Hinweis
             * daneben sagt, was mit dem Weckruf ist — auch dann, wenn gar keiner
             * nötig oder möglich war.
             */
            async _wake(target: string, content: string, vorgang: WakeTargetInput) {
                const repo = this.view?.repo
                if (!repo) {
                    return
                }
                const ergebnis: WakeResult = await wakeMentionedAgents({
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
                // ── Warum jede dieser Zeilen mit dem AUSGANG beginnt ──────────
                //
                // Die Frage des Nutzers in diesem Moment ist eine einzige:
                // „antwortet da jetzt jemand?". Bis 2026-08-23 stand die Antwort
                // in drei von vier Nullfällen hinter einem Gedankenstrich am
                // Satzende — davor die Begründung, die er erst braucht, wenn er
                // die Antwort schon kennt. Jetzt trägt jede Meldung sie in den
                // ersten beiden Wörtern („Geweckt:" / „Niemand geweckt:"), und
                // der Grund folgt.
                //
                // Und sie tun es mit EINEM Verb. Vorher hießen derselbe Vorgang
                // „Weckmeldung", „benachrichtigt", „Benachrichtigung", „ging
                // nicht raus" und „reagiert niemand auf dich" — fünf Wörter für
                // eine Sache, während die Fläche daneben „Agent" und „antwortet
                // auf Erwähnung" sagt. Ein Nutzer, der eine Oberfläche lernt,
                // lernt ihre Wörter; wechseln sie, lernt er nichts.
                //
                // `:namen` kommt aus `agentLabels` und ist bereits „Name (npub…)".
                // Die alten Fassungen setzten das noch einmal in Klammern —
                // „(ceo (npub1abc…wxyz))" — und die doppelte Klammer las sich wie
                // ein Tippfehler. Der Name steht jetzt im Satz.
                const hinweis =
                    ergebnis.code === 'sent'
                        ? {
                              tone: 'ok' as const,
                              text: t('Geweckt: :namen. Die Antwort erscheint im Projektkanal.', { namen }),
                          }
                        : ergebnis.code === 'channel-foreign'
                          ? {
                                tone: 'warn' as const,
                                text: t(
                                    'Niemand geweckt: dieses Repository verweist auf einen Kanal, der nicht zu deinen Räumen gehört. :namen erfährt nichts von deinem Beitrag.',
                                    { namen },
                                ),
                            }
                          : ergebnis.code === 'no-channel'
                          ? {
                                tone: 'warn' as const,
                                text: t(
                                    'Niemand geweckt: dieses Repository gehört zu keinem Kanal. :namen erfährt nichts von deinem Beitrag.',
                                    { namen },
                                ),
                            }
                          : ergebnis.code === 'not-wakeable'
                            ? {
                                  tone: 'warn' as const,
                                  text: t(
                                      'Niemand geweckt: :namen antwortet in diesem Kanal nicht auf dich. Dein Beitrag steht trotzdem.',
                                      { namen },
                                  ),
                              }
                            : {
                                  tone: 'warn' as const,
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
        }
    })
}
