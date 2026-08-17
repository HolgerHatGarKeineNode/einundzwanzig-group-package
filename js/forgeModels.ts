/**
 * P6 — die **reine** Hälfte der Forge: aus rohen Ereignissen Lesemodelle machen.
 *
 * Kein Netz, kein Store, keine welshman-Importe, relative Importe mit `.ts` —
 * damit `node --experimental-strip-types --test forgeModels.test.ts` das Modul
 * lädt. Alles Netznahe liegt in `forge.ts`, die Zeitleiste in `forgeActivity.ts`.
 *
 * ── Woher die Regeln stammen ────────────────────────────────────────────────
 *
 * Nicht aus NIP-34 allein: unsere Fläche muss dieselben Ereignisse lesen, die
 * **Buzz Desktop** schreibt, sonst zeigen zwei Clients am selben Relay
 * verschiedene Wahrheiten. Die Faltungsregeln sind deshalb am Referenzparser
 * abgeglichen (`/home/user/Code/buzz/desktop/src/features/projects/` —
 * `projectIssues.mjs`, `projectPullRequests.mjs`, `projectModels.ts`, gelesen
 * 2026-08-17). Wo wir abweichen, steht der Grund an der Stelle.
 *
 * ── Die drei Regeln, die man einmal falsch macht ─────────────────────────────
 *
 * 1. **Ein Status-Ereignis zählt nur von einem berechtigten Absender.** 1630–1633
 *    sind gewöhnliche, signierte Ereignisse — jedes Relay-Mitglied darf eines
 *    schreiben. Zählte jedes, könnte ein beliebiger Fremder ein Issue als
 *    „geschlossen" anzeigen lassen. Berechtigt sind der Autor der Wurzel und der
 *    Eigentümer des Repos, auf das die Wurzel per `a`-Tag zeigt
 *    (`allowedActorsForRoot`, ebenso in Buzz).
 * 2. **1619 (PR-Update) referenziert die Wurzel über ein GROSSES `E`**, Status
 *    über `e` ODER `E`. Wer nur auf `e` prüft, sieht kein einziges PR-Update.
 * 3. **Kommentare sind kind 1, nicht 1111.** Buzz registriert 1111 nicht; ein
 *    solches Ereignis wird am Relay mit `restricted: unknown event kind`
 *    abgelehnt. Am 2026-08-17 an `crates/buzz-core/src/kind.rs` gegengeprüft.
 */

// ── Kinds ───────────────────────────────────────────────────────────────────

/** NIP-34 Repository-Announcement (ersetzbar, `d` = Repo-Kennung). */
export const REPO_ANNOUNCEMENT = 30617
/** NIP-34 Repository-State (Branches/Tags/HEAD). Bei Buzz **relay-signiert**. */
export const REPO_STATE = 30618
/** NIP-MP Projekt-Gruppierung (ersetzbar, Mitglieder als `a`-Tags). */
export const PROJECT_ANNOUNCEMENT = 30621
/** NIP-34 Pull Request. */
export const GIT_PULL_REQUEST = 1618
/** Buzz-Erweiterung: PR-Update (neuer Commit auf demselben PR). */
export const GIT_PR_UPDATE = 1619
/** NIP-34 Issue. */
export const GIT_ISSUE = 1621
/** NIP-34 Status: offen / angewandt (merged) / geschlossen / Entwurf. */
export const GIT_STATUS_OPEN = 1630
export const GIT_STATUS_APPLIED = 1631
export const GIT_STATUS_CLOSED = 1632
export const GIT_STATUS_DRAFT = 1633
export const GIT_STATUS_KINDS: readonly number[] = [
    GIT_STATUS_OPEN,
    GIT_STATUS_APPLIED,
    GIT_STATUS_CLOSED,
    GIT_STATUS_DRAFT,
]
/**
 * Kommentare an Issues und PRs — **kind 1**, siehe Regel 3 im Dateikopf.
 * NIP-22 (1111) wäre spec-sauberer und ist am Ziel-Relay nicht zustellbar.
 */
export const FORGE_COMMENT = 1
/** NIP-09 Löschung. Für ersetzbare Adressen über `a`-Tags. */
export const DELETION = 5

/**
 * Das Ereignis, so weit dieses Modul es braucht.
 *
 * Bewusst ein eigener, struktureller Typ statt `TrustedEvent` aus
 * `@welshman/util`: dieses Modul muss ohne welshman ladbar bleiben (der
 * Node-Test-Runner zöge sonst `localStorage` beim Modulladen nach). Ein
 * `TrustedEvent` passt strukturell hinein.
 */
export type ForgeEvent = {
    id: string
    pubkey: string
    kind: number
    created_at: number
    content: string
    tags: string[][]
}

// ── Tag-Zugriff ─────────────────────────────────────────────────────────────

const isFilled = (value: unknown): value is string => typeof value === 'string' && value.length > 0

/** Erster Wert eines Tags, `''` wenn keines da ist. */
export const tagValue = (event: ForgeEvent, name: string): string =>
    event.tags.find((tag) => tag[0] === name && isFilled(tag[1]))?.[1] ?? ''

/** Alle ersten Werte gleichnamiger Tags (`["p", …]`, `["t", …]`). */
export const tagValues = (event: ForgeEvent, name: string): string[] =>
    event.tags.filter((tag) => tag[0] === name && isFilled(tag[1])).map((tag) => tag[1])

/**
 * Alle Werte gleichnamiger Tags, auch mehrwertige (`["clone", a, b]`).
 *
 * Nötig, weil `maintainers` und `clone` in beiden Formen vorkommen: das gemessene
 * 30617 am Ziel-Relay trägt zehn einzelne `["maintainers", <pk>]`-Zeilen, die
 * NIP-34-Beispiele eine einzige mit zehn Werten. Wer nur `tag[1]` liest,
 * verliert im zweiten Fall neun von zehn.
 */
export const tagValuesFlat = (event: ForgeEvent, name: string): string[] =>
    event.tags.filter((tag) => tag[0] === name).flatMap((tag) => tag.slice(1)).filter(isFilled)

const HEX64 = /^[0-9a-f]{64}$/
const isPubkey = (value: string): boolean => HEX64.test(value.toLowerCase())

// ── Adressen ────────────────────────────────────────────────────────────────

/** Die Koordinate eines Repos, wie sie im `a`-Tag steht. */
export type RepoAddress = { owner: string; dtag: string }

/**
 * `30617:<owner-hex>:<repo-d>` zerlegen — `null`, wenn irgendetwas daran nicht
 * stimmt.
 *
 * Der `d`-Teil darf Doppelpunkte enthalten (NIP-01 begrenzt ihn nicht), deshalb
 * wird nur an den ERSTEN beiden Trennern geschnitten und der Rest bleibt ganz.
 * Der Eigentümer muss **kleingeschrieben** sein: `#a`-Filter vergleichen
 * bytegenau, eine großgeschriebene Koordinate fände am Relay nie ihr Repo
 * (dieselbe Regel wie NIP-MP `member-coordinate-malformed`).
 */
export const parseRepoAddress = (value: string): RepoAddress | null => {
    const first = value.indexOf(':')
    if (first < 0 || value.slice(0, first) !== String(REPO_ANNOUNCEMENT)) {
        return null
    }
    const second = value.indexOf(':', first + 1)
    if (second < 0) {
        return null
    }
    const owner = value.slice(first + 1, second)
    const dtag = value.slice(second + 1)

    return HEX64.test(owner) && dtag.length > 0 ? { owner, dtag } : null
}

/**
 * Auf welches Repo beruft sich dieses Ereignis? `''`, wenn auf keins.
 *
 * Liefert die erste **syntaktisch gültige** `30617:<owner>:<d>`-Koordinate aus den
 * `a`-Tags, normalisiert (Eigentümer klein). Jedes Blatt der Forge — Issue, PR,
 * PR-Update, Statuswechsel, Kommentar — trägt genau so seinen Bezug; ohne ihn
 * fände es keine Abfrage dieser Fläche, denn `forge.ts contentFilters` scopet
 * ausschließlich über `#a`.
 *
 * **Das ist eine Behauptung des Ereignisses, keine Tatsache.** Die Koordinate ist
 * frei wählbar: `30617:<64 beliebige Hexzeichen>:<beliebiges d>` besteht jede
 * Formprüfung, auch wenn es das Repo nie gab. Wer aus dieser Zeichenkette eine
 * Zugehörigkeit ableitet, muss zusätzlich prüfen, ob das Repo **bekannt** ist —
 * siehe `storage.ts`, `shouldPersistEvent`.
 */
export const forgeTargetAddress = (event: ForgeEvent): string => {
    for (const tag of event.tags) {
        if (tag[0] === 'a' && isFilled(tag[1]) && parseRepoAddress(tag[1]) !== null) {
            return tag[1].toLowerCase()
        }
    }

    return ''
}

/**
 * Hat dieses kind 1 die **Form** eines Forge-Kommentars — und nicht die einer
 * beliebigen Notiz?
 *
 * Die Frage stellt sich, weil Buzz Kommentare als kind 1 schreibt (Regel 3 im
 * Dateikopf): dieselbe Zahl trägt im Nostr-Alltag jede beliebige Notiz. Wer
 * kind 1 pauschal als Forge-Inhalt behandelt — etwa beim Cachen —, zieht die
 * halbe Zeitleiste der Community mit hinein.
 *
 * **Diese Prüfung allein reicht als Aufnahmekriterium NICHT.** Sie beantwortet
 * „sieht aus wie", nicht „gehört zu": ein erfundenes `a`-Ziel besteht sie
 * (siehe {@link forgeTargetAddress}). Wer damit über Aufnahme in einen Speicher
 * entscheidet, braucht die Existenzprüfung daneben.
 */
export const isForgeComment = (event: ForgeEvent): boolean =>
    event.kind === FORGE_COMMENT && forgeTargetAddress(event) !== ''

/** Die Koordinate eines Repos aufbauen. Eigentümer immer kleingeschrieben. */
export const repoAddressOf = (owner: string, dtag: string): string =>
    `${REPO_ANNOUNCEMENT}:${owner.toLowerCase()}:${dtag}`

// ── Ersetzbare Ereignisse und Grabsteine ────────────────────────────────────

/**
 * Je `(kind, pubkey, d)` nur den aktuellen Kopf behalten.
 *
 * **Das ist keine Vorsichtsmaßnahme, sondern gemessene Notwendigkeit:** ein
 * `nak req -k 30618` gegen `wss://buzz.einundzwanzig.space` lieferte am
 * 2026-08-17 **drei** Ereignisse mit identischem `(kind, pubkey, d)` — das Relay
 * hält die alten Fassungen und liefert sie mit aus. Ohne diese Faltung stünde
 * ein zufälliger alter Branch-Zustand in der Ansicht.
 *
 * Bei Gleichstand in `created_at` gewinnt die **kleinere** Id — dieselbe Regel,
 * die NIP-01 für ersetzbare Ereignisse vorgibt und die Buzz' Parser anwendet.
 * Ohne Tiebreak hinge die Anzeige an der Ankunftsreihenfolge.
 */
export const dedupeReplaceable = (events: ForgeEvent[]): ForgeEvent[] => {
    const heads = new Map<string, ForgeEvent>()
    for (const event of events) {
        const dtag = tagValue(event, 'd')
        if (!dtag) {
            continue
        }
        const key = `${event.kind}:${event.pubkey.toLowerCase()}:${dtag}`
        const known = heads.get(key)
        if (
            !known ||
            event.created_at > known.created_at ||
            (event.created_at === known.created_at && event.id < known.id)
        ) {
            heads.set(key, event)
        }
    }

    return [...heads.values()]
}

/**
 * Koordinate → Zeitschwelle, ab der sie als gelöscht gilt (NIP-09).
 *
 * Zwei Bedingungen, und beide sind nötig: der Grabstein muss vom **Eigentümer**
 * der Koordinate signiert sein (sonst löschte ein Fremder fremde Repos aus
 * unserer Liste weg), und er wirkt nur auf Fassungen, die **nicht neuer** sind
 * als er. Ein nach dem Löschen neu angelegtes Repo mit derselben Kennung lebt
 * also wieder — genau das ist der Sinn der Schwelle statt eines Booleans.
 */
export const deletionThresholds = (events: ForgeEvent[]): Map<string, number> => {
    const thresholds = new Map<string, number>()
    for (const event of events) {
        if (event.kind !== DELETION) {
            continue
        }
        const signer = event.pubkey.toLowerCase()
        for (const tag of event.tags) {
            if (tag[0] !== 'a' || !isFilled(tag[1])) {
                continue
            }
            const coordinate = tag[1]
            const first = coordinate.indexOf(':')
            const second = coordinate.indexOf(':', first + 1)
            if (first < 0 || second < 0) {
                continue
            }
            if (coordinate.slice(first + 1, second).toLowerCase() !== signer) {
                continue
            }
            const known = thresholds.get(coordinate)
            if (known === undefined || event.created_at > known) {
                thresholds.set(coordinate, event.created_at)
            }
        }
    }

    return thresholds
}

/** Ist die Adresse dieses ersetzbaren Ereignisses gelöscht? */
export const isAddressDeleted = (event: ForgeEvent, thresholds: Map<string, number>): boolean => {
    const dtag = tagValue(event, 'd')
    if (!dtag) {
        return false
    }
    const threshold = thresholds.get(`${event.kind}:${event.pubkey.toLowerCase()}:${dtag}`)

    return threshold !== undefined && event.created_at <= threshold
}

// ── Repository (30617) ──────────────────────────────────────────────────────

/** Ein Branch-Schutz aus dem `buzz-protect`-Tag: `[ref, regel]`. */
export type BranchProtection = { ref: string; rule: string }

export type Repo = {
    /** `30617:<owner>:<d>` — die Kennung, mit der alles andere verknüpft ist. */
    address: string
    dtag: string
    owner: string
    name: string
    description: string
    cloneUrls: string[]
    webUrl: string
    /** `default-branch`-Tag, sonst `''` — der echte HEAD steht im 30618. */
    defaultBranch: string
    /** Pubkeys mit Schreibrecht laut Announcement. */
    maintainers: string[]
    /** Kanal-UUID aus `buzz-channel` — bei Buzz zugleich die Git-Zugriffsgrenze. */
    channelId: string
    protections: BranchProtection[]
    createdAt: number
    /** Nur als `:key` der Liste; wechselt bei jeder Neuankündigung. */
    eventId: string
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/** Ein 30617 → {@link Repo}, oder `null`, wenn es keins ist. */
export const toRepo = (event: ForgeEvent): Repo | null => {
    const dtag = tagValue(event, 'd')
    if (event.kind !== REPO_ANNOUNCEMENT || !dtag || !isPubkey(event.pubkey)) {
        return null
    }
    const owner = event.pubkey.toLowerCase()
    const channel = tagValue(event, 'buzz-channel')

    return {
        address: repoAddressOf(owner, dtag),
        dtag,
        owner,
        name: tagValue(event, 'name') || dtag,
        description: tagValue(event, 'description') || event.content,
        cloneUrls: tagValuesFlat(event, 'clone'),
        webUrl: tagValue(event, 'web'),
        defaultBranch: tagValue(event, 'default-branch'),
        maintainers: [
            ...new Set(tagValuesFlat(event, 'maintainers').map((value) => value.toLowerCase())),
        ].filter(isPubkey),
        channelId: UUID.test(channel) ? channel : '',
        // `["buzz-protect", "refs/heads/master", "push:admin"]` — je Regel eine
        // Zeile, mehrere Zeilen je Ref sind der Normalfall (am Ziel-Relay drei).
        protections: event.tags
            .filter((tag) => tag[0] === 'buzz-protect' && isFilled(tag[1]) && isFilled(tag[2]))
            .map((tag) => ({ ref: tag[1], rule: tag[2] })),
        createdAt: event.created_at,
        eventId: event.id,
    }
}

/** Alle sichtbaren Repos: Köpfe falten, Gelöschte entfernen, neueste zuerst. */
export const buildRepos = (repoEvents: ForgeEvent[], deletionEvents: ForgeEvent[] = []): Repo[] => {
    const thresholds = deletionThresholds(deletionEvents)

    return dedupeReplaceable(repoEvents.filter((event) => event.kind === REPO_ANNOUNCEMENT))
        .filter((event) => !isAddressDeleted(event, thresholds))
        .map(toRepo)
        .filter((repo): repo is Repo => repo !== null)
        .sort((a, b) => b.createdAt - a.createdAt || a.address.localeCompare(b.address))
}

// ── Repo-Zustand (30618) ────────────────────────────────────────────────────

export type GitRef = { name: string; commit: string }

export type RepoState = {
    branches: GitRef[]
    tags: GitRef[]
    /** Branch, auf den HEAD zeigt (ohne `refs/heads/`), `''` wenn unbekannt. */
    head: string
    updatedAt: number
    /** Wer den Zustand ausgelöst hat (`p`-Tag, Buzz-Erweiterung: der Pusher). */
    actor: string
}

/**
 * Ein 30618 auslesen. `refs/heads/*` und `refs/tags/*` stehen als **Tag-Namen**
 * da, nicht als Werte — eine Eigenheit von NIP-34, die man beim Überfliegen
 * übersieht.
 */
export const toRepoState = (event: ForgeEvent): RepoState => {
    const branches: GitRef[] = []
    const tags: GitRef[] = []
    let head = ''

    for (const [name, value] of event.tags) {
        if (!isFilled(name) || !isFilled(value)) {
            continue
        }
        if (name.startsWith('refs/heads/')) {
            branches.push({ name: name.slice('refs/heads/'.length), commit: value })
        } else if (name.startsWith('refs/tags/')) {
            tags.push({ name: name.slice('refs/tags/'.length), commit: value })
        } else if (name === 'HEAD') {
            head = value.replace(/^ref:\s*/, '').replace(/^refs\/heads\//, '')
        }
    }

    return {
        branches: branches.sort((a, b) => a.name.localeCompare(b.name)),
        tags: tags.sort((a, b) => a.name.localeCompare(b.name)),
        head,
        updatedAt: event.created_at,
        actor: tagValue(event, 'p').toLowerCase(),
    }
}

/**
 * Der gültige Branch-Zustand eines Repos — `null`, wenn keiner vorliegt.
 *
 * **`relaySelf` ist nicht optional, sondern der Normalfall.** Am Ziel-Relay sind
 * alle drei gemessenen 30618 vom Relay signiert (`e699af6e…` == NIP-11-`self`),
 * keines vom Repo-Eigentümer: Buzz schreibt den Zustand selbst, wenn jemand
 * pusht (`crates/buzz-relay/src/api/git/manifest_event.rs`). Wer nur den
 * Eigentümer als Autor zulässt, sieht **null** Branch-Zustände.
 *
 * Und `self` kommt aus dem NIP-11-Feld **`self`**, nicht `pubkey` — Buzz liefert
 * `pubkey: null` (am 2026-08-17 am Ziel-Relay abgefragt).
 *
 * ── Der Gleichstand: leer verliert, nicht „relay-signiert verliert" ──────────
 *
 * P11 hat ein echtes Rennen belegt: Buzz schreibt bei einer **frisch
 * reservierten** Repo-Adresse selbst ein 30618 (`emit_initial_ref_state`,
 * `side_effects.rs`, nur bei `ReserveOutcome::Reserved`) — mit `HEAD`, aber
 * **ohne einen einzigen Ref**. Fällt es in dieselbe Unix-Sekunde wie das echte,
 * entschied hier bis 2026-08-17 `a.id.localeCompare(b.id)`: ein Münzwurf über
 * den Event-Hash, und in der Hälfte der Fälle gewann der **leere** Zustand.
 *
 * **Der naheliegende Riegel wäre falsch.** „Relay-signierte 30618 grundsätzlich
 * zurückstufen" klingt robuster, dreht aber die gemessene Wirklichkeit um: am
 * Ziel-Relay ist **jeder** 30618 relay-signiert, weil Buzz den Zustand bei
 * jedem Push selbst schreibt (`api/git/manifest_event.rs`). Eine solche Regel
 * ließe ein einziges, irgendwann von einem anderen Client geschriebenes
 * owner-signiertes 30618 den echten Push-Zustand **dauerhaft** überstimmen —
 * die Branch-Anzeige fröre auf einem alten Commit ein, und nichts korrigierte
 * das je wieder. Aus einem Sekunden-Rennen würde ein Dauerfehler.
 *
 * Deshalb greift der Riegel genau dort, wo bisher der Zufall entschied: **bei
 * GLEICHEM `created_at` verliert ein Zustand ohne Refs gegen einen mit Refs**,
 * egal wer ihn signiert hat. Nur beim Gleichstand — ein NEUERER leerer Zustand
 * gewinnt weiterhin, denn ein Repo, dessen Branches gelöscht wurden, ist
 * legitim leer. Danach bleibt der Id-Vergleich als letzte, deterministische
 * Instanz.
 */
const hasRefs = (event: ForgeEvent): boolean =>
    event.tags.some(([name, value]) => isFilled(name) && isFilled(value) && name.startsWith('refs/'))

export const foldRepoState = (
    events: ForgeEvent[],
    { owner, relaySelf, dtag }: { owner: string; relaySelf: string; dtag: string },
): RepoState | null => {
    const trusted = new Set([owner.toLowerCase(), relaySelf.toLowerCase()].filter((value) => value !== ''))
    const candidates = events.filter(
        (event) =>
            event.kind === REPO_STATE &&
            tagValue(event, 'd') === dtag &&
            trusted.has(event.pubkey.toLowerCase()),
    )
    const newest = dedupeReplaceable(candidates).sort(
        (a, b) =>
            b.created_at - a.created_at ||
            Number(hasRefs(b)) - Number(hasRefs(a)) ||
            a.id.localeCompare(b.id),
    )[0]

    return newest ? toRepoState(newest) : null
}

// ── Status-Faltung (1630–1633) ──────────────────────────────────────────────

/**
 * Wer den Lebenszyklus einer Wurzel bestimmen darf: ihr Autor und der
 * Eigentümer des Repos, auf das sie zeigt.
 *
 * Siehe Regel 1 im Dateikopf. Ohne diesen Filter könnte jedes Relay-Mitglied
 * fremde Issues als geschlossen anzeigen lassen — die Anzeige wäre trivial
 * fälschbar, ohne dass irgendetwas kaputtgeht, was auffiele.
 */
export const allowedActorsForRoot = (root: ForgeEvent): Set<string> =>
    allowedActorsFor({ author: root.pubkey, repoAddress: tagValue(root, 'a') })

/**
 * Dieselbe Regel, aber auf der **Zeile** statt auf dem Ereignis.
 *
 * Die Schreibrichtung (P8) muss vor dem Absenden entscheiden, ob jemand einen
 * Statuswechsel setzen darf — und sie hat dort keine rohen Ereignisse mehr,
 * sondern die anzeigefertige Zeile mit `author` und `repoAddress`. Die Regel
 * steht deshalb genau hier, einmal; {@link allowedActorsForRoot} ist nur noch
 * ihre Ereignis-Fassung. Zwei Kopien wären der klassische Riss: der Riegel im
 * Leser bleibt scharf, der im Schreiber altert unbemerkt.
 */
export const allowedActorsFor = ({
    author,
    repoAddress,
}: {
    author: string
    repoAddress: string
}): Set<string> => {
    const allowed = new Set([author.toLowerCase()])
    const address = parseRepoAddress(repoAddress)
    if (address) {
        allowed.add(address.owner)
    }

    return allowed
}

/** Zeigt ein Tag-Paar auf diese Wurzel? `e` und `E` gelten beide (Regel 2). */
const referencesRoot = (event: ForgeEvent, rootId: string): boolean =>
    event.tags.some((tag) => (tag[0] === 'e' || tag[0] === 'E') && tag[1] === rootId)

/**
 * Das maßgebliche Status-Ereignis einer Wurzel — der **neueste** berechtigte
 * Status gewinnt, bei Gleichstand die kleinere Id.
 *
 * Der Tiebreak ist kein Zierrat: zwei Statuswechsel in derselben Sekunde sind
 * bei Automaten der Normalfall, und ohne feste Regel hinge die Anzeige an der
 * Ankunftsreihenfolge des Relays — dieselbe Zeile zeigte nach einem Reload
 * etwas anderes.
 */
export const foldStatus = (root: ForgeEvent, statusEvents: ForgeEvent[]): ForgeEvent | null => {
    const allowed = allowedActorsForRoot(root)

    return (
        statusEvents
            .filter(
                (event) =>
                    GIT_STATUS_KINDS.includes(event.kind) &&
                    allowed.has(event.pubkey.toLowerCase()) &&
                    referencesRoot(event, root.id),
            )
            .sort((a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id))[0] ?? null
    )
}

/** Zustandscode eines Issues. `open` ist der Zustand ohne Status-Ereignis. */
export type IssueStatus = 'open' | 'resolved' | 'closed' | 'draft'
/** Zustandscode eines Pull Requests. */
export type PullRequestStatus = 'open' | 'merged' | 'closed' | 'draft'

/**
 * Statuscode aus dem gefalteten Ereignis.
 *
 * **Bewusste Abweichung von Buzz Desktop:** dort fällt der Code ohne
 * Status-Ereignis auf `t`-Label-Heuristiken zurück („Triage", „In Progress",
 * „Backlog") — der Referenzparser nennt sie im eigenen Kommentar
 * „client-side heuristics, not protocol" (`projectIssues.mjs:71-72`). Wir zeigen
 * die `t`-Labels stattdessen als das, was sie sind: Labels neben dem Status. So
 * behauptet die Fläche keinen Zustand, den niemand gesetzt hat.
 */
export const issueStatusFrom = (statusEvent: ForgeEvent | null): IssueStatus => {
    switch (statusEvent?.kind) {
        case GIT_STATUS_APPLIED:
            return 'resolved'
        case GIT_STATUS_CLOSED:
            return 'closed'
        case GIT_STATUS_DRAFT:
            return 'draft'
        default:
            return 'open'
    }
}

/** Wie {@link issueStatusFrom}, nur heißt 1631 beim PR „merged". */
export const pullRequestStatusFrom = (
    root: ForgeEvent,
    statusEvent: ForgeEvent | null,
): PullRequestStatus => {
    switch (statusEvent?.kind) {
        case GIT_STATUS_APPLIED:
            return 'merged'
        case GIT_STATUS_CLOSED:
            return 'closed'
        case GIT_STATUS_DRAFT:
            return 'draft'
        case GIT_STATUS_OPEN:
            return 'open'
        default:
            // Ohne Status-Ereignis entscheidet ausnahmsweise ein Label — anders
            // als beim Issue ist „Entwurf" beim PR eine Eigenschaft, die der
            // Autor beim Anlegen mitgibt und nicht nachträglich setzt.
            return tagValues(root, 't').some((label) => label.toLowerCase() === 'draft') ? 'draft' : 'open'
    }
}

// ── Kommentare ──────────────────────────────────────────────────────────────

export type ForgeComment = {
    id: string
    author: string
    content: string
    createdAt: number
}

const toComment = (event: ForgeEvent): ForgeComment => ({
    id: event.id,
    author: event.pubkey.toLowerCase(),
    content: event.content,
    createdAt: event.created_at,
})

/** Kommentare (kind 1) zu einer Wurzel, älteste zuerst. */
export const commentsForRoot = (rootId: string, commentEvents: ForgeEvent[]): ForgeComment[] =>
    commentEvents
        .filter((event) => event.kind === FORGE_COMMENT && referencesRoot(event, rootId))
        .map(toComment)
        .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))

// ── Issue (1621) ────────────────────────────────────────────────────────────

export type Issue = {
    id: string
    title: string
    content: string
    author: string
    createdAt: number
    /** Letzte Regung: Kommentar oder Statuswechsel, sonst die Erstellung. */
    updatedAt: number
    repoAddress: string
    labels: string[]
    status: IssueStatus
    commentCount: number
    comments: ForgeComment[]
}

/**
 * Titel einer Wurzel: `subject`-Tag, sonst die erste Zeile des Inhalts.
 *
 * Leer bleibt leer — die Fläche setzt dann ihren eigenen Ersatztext ein. Hier
 * einen englischen Vorgabetext einzusetzen (wie Buzz es tut) hieße, eine
 * unübersetzbare Zeichenkette durch die Übersetzungsschicht zu schmuggeln.
 */
export const rootTitle = (root: ForgeEvent): string =>
    tagValue(root, 'subject') || root.content.split('\n')[0]?.trim() || ''

export const toIssue = (
    root: ForgeEvent,
    statusEvents: ForgeEvent[] = [],
    commentEvents: ForgeEvent[] = [],
): Issue => {
    const status = foldStatus(root, statusEvents)
    const comments = commentsForRoot(root.id, commentEvents)

    return {
        id: root.id,
        title: rootTitle(root),
        content: root.content,
        author: root.pubkey.toLowerCase(),
        createdAt: root.created_at,
        updatedAt: Math.max(
            root.created_at,
            status?.created_at ?? 0,
            ...comments.map((comment) => comment.createdAt),
        ),
        repoAddress: tagValue(root, 'a'),
        labels: tagValues(root, 't'),
        status: issueStatusFrom(status),
        commentCount: comments.length,
        comments,
    }
}

/** Alle Issues eines Bestands, zuletzt bewegte zuerst. */
export const buildIssues = (
    issueEvents: ForgeEvent[],
    statusEvents: ForgeEvent[] = [],
    commentEvents: ForgeEvent[] = [],
): Issue[] =>
    issueEvents
        .filter((event) => event.kind === GIT_ISSUE)
        .map((root) => toIssue(root, statusEvents, commentEvents))
        .sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id))

// ── Pull Request (1618 + 1619) ──────────────────────────────────────────────

export type PullRequestUpdate = {
    id: string
    author: string
    content: string
    commit: string
    createdAt: number
}

export type PullRequest = {
    id: string
    title: string
    content: string
    author: string
    createdAt: number
    updatedAt: number
    repoAddress: string
    labels: string[]
    status: PullRequestStatus
    /** Quell-Branch (`branch-name`), `''` wenn keiner angegeben ist. */
    branch: string
    /** Ziel-Branch (`target-branch`). */
    targetBranch: string
    /** Aktueller Commit: aus dem jüngsten vertrauten 1619, sonst aus dem 1618. */
    commit: string
    cloneUrls: string[]
    updateCount: number
    updates: PullRequestUpdate[]
    commentCount: number
    comments: ForgeComment[]
}

/**
 * Ein PR-Zustand aus 1618 + allen 1619 + Status + Kommentaren.
 *
 * Die Updates sind der eigentliche Grund, warum ein PR nicht einfach „ein Issue
 * mit anderem Kind" ist: sie zeigen den Commit um, auf den der PR verweist. Ein
 * fremdes 1619 dürfte das nicht können — deshalb laufen sie durch dieselbe
 * Berechtigungsprüfung wie die Statuswechsel (Regel 1).
 */
export const toPullRequest = (
    root: ForgeEvent,
    updateEvents: ForgeEvent[] = [],
    statusEvents: ForgeEvent[] = [],
    commentEvents: ForgeEvent[] = [],
): PullRequest => {
    const allowed = allowedActorsForRoot(root)
    const status = foldStatus(root, statusEvents)
    const comments = commentsForRoot(root.id, commentEvents)
    const updates = updateEvents
        .filter(
            (event) =>
                event.kind === GIT_PR_UPDATE &&
                allowed.has(event.pubkey.toLowerCase()) &&
                referencesRoot(event, root.id),
        )
        .sort((a, b) => a.created_at - b.created_at || a.id.localeCompare(b.id))
        .map((event) => ({
            id: event.id,
            author: event.pubkey.toLowerCase(),
            content: event.content,
            commit: tagValue(event, 'c'),
            createdAt: event.created_at,
        }))
    const newestUpdate = updates[updates.length - 1]

    return {
        id: root.id,
        title: rootTitle(root),
        content: root.content,
        author: root.pubkey.toLowerCase(),
        createdAt: root.created_at,
        updatedAt: Math.max(
            root.created_at,
            status?.created_at ?? 0,
            ...updates.map((update) => update.createdAt),
            ...comments.map((comment) => comment.createdAt),
        ),
        repoAddress: tagValue(root, 'a'),
        labels: tagValues(root, 't'),
        status: pullRequestStatusFrom(root, status),
        branch: tagValue(root, 'branch-name'),
        targetBranch: tagValue(root, 'target-branch'),
        commit: newestUpdate?.commit || tagValue(root, 'c'),
        cloneUrls: tagValuesFlat(root, 'clone'),
        updateCount: updates.length,
        updates,
        commentCount: comments.length,
        comments,
    }
}

/** Alle Pull Requests eines Bestands, zuletzt bewegte zuerst. */
export const buildPullRequests = (
    pullRequestEvents: ForgeEvent[],
    updateEvents: ForgeEvent[] = [],
    statusEvents: ForgeEvent[] = [],
    commentEvents: ForgeEvent[] = [],
): PullRequest[] =>
    pullRequestEvents
        .filter((event) => event.kind === GIT_PULL_REQUEST)
        .map((root) => toPullRequest(root, updateEvents, statusEvents, commentEvents))
        .sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id))

// ── Projekt (30621, NIP-MP) ─────────────────────────────────────────────────

export type Project = {
    address: string
    dtag: string
    owner: string
    name: string
    description: string
    createdAt: number
    eventId: string
    /** Alle Mitglieds-Koordinaten, auch die unauflösbaren. */
    memberAddresses: string[]
    /** Die davon auflösbaren Repos. */
    repos: Repo[]
    /**
     * Koordinaten, zu denen kein Repo vorliegt.
     *
     * **Sichtbar machen statt verschlucken.** Ein Projekt, das drei Repos nennt
     * und zwei anzeigt, sieht aus wie ein Projekt mit zwei Repos — der Leser
     * merkt nicht, dass ihm etwas fehlt. Der Grund kann harmlos sein (das Repo
     * liegt auf einem anderen Relay) oder nicht (Zugriffsgrenze); beides ist
     * eine Aussage, keine Leerstelle.
     */
    missingAddresses: string[]
}

/** Höchstzahl Mitglieder je Projekt (NIP-MP `member-cap`). */
export const MAX_PROJECT_MEMBERS = 64

/**
 * Projekte auflösen: Mitglieds-`a`-Tags auf die vorhandenen Repos abbilden.
 *
 * Ein Projekt mit `buzz-visibility: unlisted` fliegt raus — so hält es auch Buzz
 * Desktop, und ein Projekt, das nur bei uns erschiene, wäre eine Abweichung mit
 * Datenschutz-Anschein.
 */
export const buildProjects = (
    projectEvents: ForgeEvent[],
    repos: Repo[],
    deletionEvents: ForgeEvent[] = [],
): Project[] => {
    const thresholds = deletionThresholds(deletionEvents)
    const byAddress = new Map(repos.map((repo) => [repo.address, repo]))

    return dedupeReplaceable(projectEvents.filter((event) => event.kind === PROJECT_ANNOUNCEMENT))
        .filter((event) => !isAddressDeleted(event, thresholds))
        .filter((event) => tagValue(event, 'buzz-visibility') !== 'unlisted')
        .filter((event) => isPubkey(event.pubkey))
        .map((event) => {
            const owner = event.pubkey.toLowerCase()
            const dtag = tagValue(event, 'd')
            const memberAddresses = [
                ...new Set(
                    event.tags
                        .filter((tag) => tag[0] === 'a' && isFilled(tag[1]))
                        .map((tag) => tag[1])
                        .filter((address) => parseRepoAddress(address) !== null),
                ),
            ]
                .slice(0, MAX_PROJECT_MEMBERS)
                .sort()

            return {
                address: `${PROJECT_ANNOUNCEMENT}:${owner}:${dtag}`,
                dtag,
                owner,
                name: tagValue(event, 'name') || dtag,
                description: tagValue(event, 'description') || event.content,
                createdAt: event.created_at,
                eventId: event.id,
                memberAddresses,
                repos: memberAddresses
                    .map((address) => byAddress.get(address))
                    .filter((repo): repo is Repo => repo !== undefined),
                missingAddresses: memberAddresses.filter((address) => !byAddress.has(address)),
            }
        })
        .sort((a, b) => b.createdAt - a.createdAt || a.address.localeCompare(b.address))
}

// ── Kürzung ─────────────────────────────────────────────────────────────────

/** Welche Listen am Limit ankamen und deshalb gekürzt sein KÖNNEN. */
export type TruncationInput = {
    repos: number
    issues: number
    pulls: number
    /** Limit der Bestandslisten (Repos, Projekte, Zustände). */
    listLimit: number
    /** Limit für Issues und Pull Requests. */
    rootLimit: number
}

/**
 * Welche Listen sind womöglich gekürzt?
 *
 * **„Genau am Limit" heißt nicht sicher gekürzt, aber es heißt „nicht
 * beweisbar vollständig"** — und genau das schuldet die Fläche dem Leser. Eine
 * stillschweigend abgeschnittene Liste ist eine falsche Aussage über den
 * Bestand; ein Hinweis, der bei 499 von 500 schon erscheint, wäre die andere.
 * Deshalb `>=` auf den exakten Wert und kein Sicherheitsabstand.
 *
 * Steht hier und nicht in `forge.ts`, damit die Entscheidung prüfbar ist, ohne
 * 500 Repositories an einem Relay anzulegen.
 */
export const truncatedLists = ({ repos, issues, pulls, listLimit, rootLimit }: TruncationInput): string[] => {
    const out: string[] = []
    if (repos >= listLimit) {
        out.push('repos')
    }
    if (issues >= rootLimit) {
        out.push('issues')
    }
    if (pulls >= rootLimit) {
        out.push('pulls')
    }

    return out
}

/**
 * Repos, die kein Projekt für sich beansprucht.
 *
 * Die Fläche zeigt beides nebeneinander — sonst verschwände ein Repo, sobald
 * jemand ein Projekt darum baut, aus der Repo-Liste. Beansprucht gilt nur, wenn
 * der Projekt-Eigentümer das Repo besitzt oder in dessen `maintainers` steht;
 * sonst könnte ein Fremder ein Repo aus der Liste ziehen, indem er ein Projekt
 * anlegt, das darauf zeigt.
 */
export const unclaimedRepos = (repos: Repo[], projects: Project[]): Repo[] => {
    const claimed = new Set(
        projects.flatMap((project) =>
            project.repos
                .filter((repo) => repo.owner === project.owner || repo.maintainers.includes(project.owner))
                .map((repo) => repo.address),
        ),
    )

    return repos.filter((repo) => !claimed.has(repo.address))
}
