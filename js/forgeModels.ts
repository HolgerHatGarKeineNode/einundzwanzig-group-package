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

/**
 * Der EINZIGE Import dieses Moduls, und er ist beabsichtigt.
 *
 * Bis zum 2026-08-23 kam `forgeModels.ts` ohne aus. Der Titel eines kind 1617
 * steht aber in keinem Tag, sondern im `Subject:`-Header des Patch-TEXTES
 * (siehe {@link GIT_PATCH}) — das ist Wissen über das Diff-Format, nicht über
 * das Ereignismodell, und es steht deshalb in `forgeDiff.ts`. Die Alternative
 * wäre gewesen, den Titel vom Aufrufer hereinreichen zu lassen; dann läge die
 * Titelregel ausserhalb des Modells, das sie beschreibt.
 *
 * Beide Module sind rein und relativ importiert — `node --test` lädt sie
 * unverändert.
 */
import { patchSubject } from './forgeDiff.ts'

// ── Kinds ───────────────────────────────────────────────────────────────────

/** NIP-34 Repository-Announcement (ersetzbar, `d` = Repo-Kennung). */
export const REPO_ANNOUNCEMENT = 30617
/** NIP-34 Repository-State (Branches/Tags/HEAD). Bei Buzz **relay-signiert**. */
export const REPO_STATE = 30618
/** NIP-MP Projekt-Gruppierung (ersetzbar, Mitglieder als `a`-Tags). */
export const PROJECT_ANNOUNCEMENT = 30621
/** NIP-34 Pull Request. */
export const GIT_PULL_REQUEST = 1618
/**
 * NIP-34 PR-Update (neuer Commit auf demselben PR).
 *
 * Hier stand bis zum 2026-08-23 „Buzz-Erweiterung". Das war überholt: 1618, 1619 und
 * 10317 sind Standard-NIP-34, keine Hauszusätze. Der Irrtum ist harmlos geblieben, weil
 * am Verhalten nichts hing — aber ein Kommentar, der ein Standard-Kind für eine
 * Eigenheit erklärt, lädt dazu ein, es bei der nächsten Aufräumrunde herauszuwerfen.
 */
export const GIT_PR_UPDATE = 1619
/** NIP-34 Issue. */
export const GIT_ISSUE = 1621
/**
 * NIP-34 Patch — die `git format-patch`-Ausgabe steht **im `content`**.
 *
 * Das ist die einzige Codeanzeige dieses Protokolls, die ohne Git-Zugriff
 * auskommt: kein Clone, keine HTTP-Brücke, keine Auth, kein CORS. Amethyst
 * liest und rendert sie (`nip34Git/patch/GitPatchEvent.kt:146`), Buzz nimmt sie
 * an (`buzz-core/src/kind.rs:609`, in `ALL_KINDS`), hat einen Builder
 * (`buzz-sdk/src/builders.rs:1018`) und einen CLI-Sendeweg — und Buzz Desktop
 * zählt sie in seiner Aktivität (`projectActivity.mjs:84-99`). Bis zum
 * 2026-08-23 waren wir der einzige der drei Clients, der sie nicht sah.
 *
 * **Ein 1617 trägt KEIN `subject`-Tag.** Am Builder gegengeprüft
 * (`build_git_patch`): `a`, `r`/euc, `p`, `e`, `t`, `commit`, `parent-commit`,
 * `commit-pgp-sig`, `committer` — mehr nicht. Der Titel kann deshalb NUR aus
 * dem `Subject:`-Header des Inhalts kommen, und der ist RFC-5322-faltbar; das
 * Lesen davon steht in `forgeDiff.ts`.
 */
export const GIT_PATCH = 1617
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
 * `@welshman/util`: dieses Modul bleibt bewusst frei von welshman. Ein
 * `TrustedEvent` passt strukturell hinein.
 *
 * **Die ursprüngliche Begründung ist überholt** — sie lautete, der Node-Test-Runner
 * zöge sonst `localStorage` beim Modulladen nach. Gemessen am 2026-08-22 lädt
 * `@welshman/util` (wie `@welshman/app` und `@welshman/net`) unter node fehlerfrei.
 * Was bleibt: ein Typ ohne Paket-Abhängigkeit hält den Test unabhängig von
 * welshman-Versionen.
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
    /**
     * Alle `web`-URLs, nicht nur die erste.
     *
     * `webUrl` bleibt daneben stehen, weil die Fläche genau einen Link zeigt.
     * Gesucht wird aber über alle: NIP-34 erlaubt `["web", a, b]` mehrwertig
     * **und** wiederholt einwertig, und wer nur die erste Form liest, findet
     * ein Repo nicht über seine zweite Adresse.
     */
    webUrls: string[]
    /**
     * Die Relays, die der Autor laut `relays`-Tag auf Patches und Issues
     * beobachtet. Wird nicht angezeigt — die Fläche liest genau einen
     * Workspace —, ist aber Teil des Suchheuhaufens: wer ein Repo über die
     * Adresse seines Heimat-Relays sucht, sucht danach.
     */
    relays: string[]
    /**
     * Earliest Unique Commit (`["r", <commit>, "euc"]`).
     *
     * Die Identität eines Repos über Forks hinweg. Sie steht nirgends im Bild,
     * ist aber suchbar: einen Commit-Hash aus einem fremden Client einzufügen
     * und beim Repo zu landen, ist genau der Weg, den ein `euc` möglich macht.
     */
    euc: string
    /** `t`-Tags des Announcements — Themen, und Teil des Suchheuhaufens. */
    hashtags: string[]
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
        webUrls: tagValuesFlat(event, 'web'),
        relays: tagValuesFlat(event, 'relays'),
        // `["r", <commit>, "euc"]` — das dritte Feld unterscheidet ihn vom
        // gewöhnlichen `r`, das Buzz am Patch auch für den Commit-Hash setzt.
        euc: event.tags.find((tag) => tag[0] === 'r' && tag[2] === 'euc')?.[1] ?? '',
        hashtags: tagValues(event, 't'),
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
 *
 * ── N2: reicht der Gleichstand? Ja — und das ist jetzt belegt, nicht vereinfacht
 *
 * Die offene Frage war: kann ein LEERES 30618 mit HÖHEREM `created_at` einen
 * echten Push-Zustand verdecken? Zwei Quellen kommen dafür in Frage, und sie
 * enden verschieden.
 *
 * **1. Der Relay — ausgeschlossen, gemessen.** `emit_initial_ref_state` hängt an
 * `reserved_by_this_attempt`, also am *erfolgreichen INSERT* in
 * `git_repo_names` (`side_effects.rs`, `ON CONFLICT … DO NOTHING RETURNING`).
 * Die Zeile entsteht einmal je `(community, repo_id)`; ein Re-Announce landet
 * auf `AlreadyOwned` und emittiert nichts. Gelöscht wird sie nur auf dem
 * Rollback-Pfad nach einem gescheiterten `seed_manifest_pointer` — der kehrt mit
 * `Err` zurück, BEVOR die Emission drankäme, ein freigegebener Name hat also nie
 * ein 30618 gesehen — und beim vollständigen Community-Purge, der `events`
 * gleich mit leert. Am Teststack nachgestellt (2026-08-18, `n2-probe`):
 * Ankündigung → ein relay-signiertes 30618 mit `created_at=1787007186`, danach
 * ein Re-Announce mit neuerem `created_at` → **weiterhin genau ein** 30618,
 * unverändert `1787007186`. Der zweite Weg zum leeren Relay-Zustand ist ein Push,
 * der alle Refs entfernt — der ist echt und soll gewinnen.
 *
 * **2. Der Eigentümer — möglich, aber ein Riegel wäre der schlechtere Tausch.**
 * Ein owner-signiertes 30618 nimmt Buzz von jedem Repo-Eigentümer an
 * (`Scope::ReposWrite`); am Teststack durchgelaufen, `created_at` nur durch ein
 * Server-Zeitfenster begrenzt („event timestamp too far from server time", bei
 * +100 000 s abgelehnt, bei +60 s angenommen). Ein Fremdclient kann also ein
 * leeres, jüngeres 30618 neben den relay-signierten Push-Zustand legen, und die
 * Branch-Anzeige geht leer.
 *
 * **Warum trotzdem kein Riegel.** Der einzige Riegel, der hier griffe, wäre
 * „über Autorengrenzen hinweg schlägt MIT Refs immer OHNE Refs" (nach
 * {@link dedupeReplaceable} vergleicht diese Sortierung ohnehin nur noch je
 * einen Kandidaten pro Autor). Er würde den Fehler nicht abschaffen, sondern
 * umdrehen — und dabei verschlimmern:
 *
 * - **Ohne Riegel** zeigt die Fläche vorübergehend KEINE Branches. Der nächste
 *   Push schreibt ein relay-signiertes 30618 mit noch höherem `created_at` und
 *   die Anzeige ist von selbst wieder richtig. Ein sichtbarer, selbstheilender
 *   Fehler.
 * - **Mit Riegel** gewänne umgekehrt ein alter owner-signierter Zustand MIT Refs
 *   gegen den relay-signierten LEEREN eines Pushs, der alle Branches entfernt
 *   hat. Die Fläche zeigte dann einen Branch auf einem Commit, den es nicht mehr
 *   gibt — und zwar dauerhaft: ein Repo ohne Branches hat keinen „nächsten
 *   Push", der es korrigierte. Ein unsichtbarer, bleibender Fehler.
 *
 * Das ist dieselbe Abwägung, die schon die pauschale Zurückstufung
 * relay-signierter Zustände gekippt hat: aus einem Rennen darf kein Dauerzustand
 * werden. Der Gleichstand bleibt deshalb der ganze Riegel — nicht als bewusste
 * Vereinfachung, sondern als die belegt bessere von zwei Regeln.
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
/**
 * Nachschlagen der `maintainers` zu einer Repo-Adresse (`30617:<pubkey>:<d>`).
 *
 * Eine FUNKTION statt einer Map, damit der Aufrufer entscheidet, woher der Bestand kommt
 * — die Übersichtsfläche hat alle Repos zur Hand, die Detailfläche genau eines. Beide
 * bauen ihre Antwort selbst; dieses Modul bleibt frei von einer Bestandshaltung.
 */
export type MaintainerLookup = (repoAddress: string) => string[]

/**
 * Die Nachschlagefunktion zu einer Liste von Repos — der Normalfall der Aufrufer.
 *
 * `Repo.maintainers` ist beim Bauen bereits kleingeschrieben und entdoppelt
 * (`buildRepos`), hier wird nichts nachgereinigt. Eine unbekannte Adresse liefert `[]`
 * und damit die alte, engere Menge — kein Wurf, kein stiller Sonderweg.
 */
export const maintainerLookupFor = (repos: { address: string; maintainers: string[] }[]): MaintainerLookup => {
    const byAddress = new Map(repos.map((repo) => [repo.address, repo.maintainers]))

    return (repoAddress) => byAddress.get(repoAddress) ?? []
}

export const allowedActorsForRoot = (root: ForgeEvent, maintainers: string[] = []): Set<string> =>
    allowedActorsFor({ author: root.pubkey, repoAddress: tagValue(root, 'a'), maintainers })

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
    maintainers = [],
}: {
    author: string
    repoAddress: string
    /**
     * Die `maintainers` des 30617, auf das die Wurzel zeigt.
     *
     * **Ohne sie war diese Funktion spec-widrig, und zwar STILL.** NIP-34 sagt wörtlich:
     * gültig ist der jüngste Status *„from either the issue/patch author **or a
     * maintainer**"*. Wir liessen bis zum 2026-08-23 nur Autor und Repo-Eigentümer zu und
     * verwarfen alles andere kommentarlos — schloss ein eingetragener Maintainer ein
     * Issue, blieb die Zeile „offen", und nichts wies darauf hin. Kein Fehler, keine
     * Meldung, kein Weg, es zu bemerken.
     *
     * Der Default `[]` hält die Funktion aufrufbar, wo kein Repo zur Hand ist (Tests,
     * Ableitungen ohne Bestand). Er ist bewusst KEINE Einladung, ihn wegzulassen: wer die
     * Maintainer hat und nicht durchreicht, stellt den alten Fehler wieder her.
     */
    maintainers?: string[]
}): Set<string> => {
    const allowed = new Set([author.toLowerCase()])
    const address = parseRepoAddress(repoAddress)
    if (address) {
        allowed.add(address.owner)
    }
    for (const maintainer of maintainers) {
        allowed.add(maintainer.toLowerCase())
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
export const foldStatus = (
    root: ForgeEvent,
    statusEvents: ForgeEvent[],
    maintainers: string[] = [],
): ForgeEvent | null => {
    const allowed = allowedActorsForRoot(root, maintainers)

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
 * Zustandscode eines Patches.
 *
 * `applied` und nicht `merged`: NIP-34 nennt 1631 „Applied/Merged", und beim
 * Patch ist die Handlung das Anwenden (`git am`), nicht das Zusammenführen
 * eines Branches. Dasselbe Kind, drei Flächen, drei Wörter — genau wie 1631
 * beim Issue „resolved" heisst.
 */
export type PatchStatus = 'open' | 'applied' | 'closed' | 'draft'

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

/**
 * Wie {@link issueStatusFrom}, nur heißt 1631 beim Patch „applied".
 *
 * Ohne Status-Ereignis ist ein Patch **offen**, und ein Label ändert daran
 * nichts: `["t", "root"]` und `["t", "root-revision"]` sind die einzigen
 * `t`-Werte, die Buzz an einem 1617 setzt (`build_git_patch`), und beide sagen
 * etwas über die Stellung in der Serie, nicht über den Lebenszyklus. Beim PR
 * gibt es die Label-Ausnahme für `draft`; hier gäbe es nichts, worauf sie
 * zeigen könnte.
 */
export const patchStatusFrom = (statusEvent: ForgeEvent | null): PatchStatus => {
    switch (statusEvent?.kind) {
        case GIT_STATUS_APPLIED:
            return 'applied'
        case GIT_STATUS_CLOSED:
            return 'closed'
        case GIT_STATUS_DRAFT:
            return 'draft'
        default:
            return 'open'
    }
}

// ── Vorgangsformen: Zuweisung, Reviewer, Freigabe ───────────────────────────

/**
 * Die fünf `t`-Label, mit denen Buzz **Vorgangsformen** in kind 1 unterbringt.
 *
 * ── Warum das überhaupt kind 1 ist ──────────────────────────────────────────
 *
 * NIP-34 kennt weder Zuweisung noch Review. Buzz erfindet dafür **kein** Kind,
 * sondern beschriftet einen gewöhnlichen Kommentar: „labeled text notes stay
 * readable for any client that treats them as plain comments"
 * (`projectIssues.mjs:3-7`). Das ist die Wahl, die uns den Fehler eingebrockt
 * hat, den P1 repariert — und zugleich der Grund, warum sie richtig war: ein
 * eigenes Kind hätte Buzz' Relay abgelehnt, wie es 1111 ablehnt.
 *
 * **Und das Rust-SDK ist hier NICHT die Quelle.** Für die Zuweisung schon
 * (`buzz-sdk/src/builders.rs:1122-1246` baut sie), für Reviewer und Freigaben
 * nicht: dort gibt es kein Review-Ereignis, „approval" ist im Rust-Baum
 * ausschließlich das Workflow-Kind 46030/46031 und hat mit Git nichts zu tun.
 * Die Reviewer-Semantik ist eine reine **Client-Konvention** und lebt in
 * `desktop/src/features/projects/pullRequestReviews.ts` und
 * `projectPullRequests.mjs:150-300`. Wer sie im SDK sucht, findet nichts und
 * schließt daraus das Falsche.
 *
 * Konsequenz für jede Fläche: der Relay setzt nichts davon durch. Er quittiert
 * jede Freigabe mit `OK true`, auch die eines Unbeteiligten — sichtbar wird sie
 * nur, wenn der Signierer die Faltung unten passiert. Ein Knopf ohne
 * vorgelagerten Riegel erzeugt also kein Fehlerbild, sondern **stillen
 * Leerlauf** (das ist P5, nicht P1).
 */
export const ASSIGNMENT_LABEL = 'assignment'
export const UNASSIGNMENT_LABEL = 'unassignment'
export const REVIEW_REQUEST_LABEL = 'review-request'
export const APPROVAL_LABEL = 'approval'
export const CHANGES_REQUESTED_LABEL = 'changes-requested'

/**
 * Alle fünf als Menge — der Ausschluss in {@link commentsForRoot}.
 *
 * Sie stehen hier **einmal**. Eine zweite Liste an der Anzeigestelle wäre der
 * Riss, den dieses Projekt schon mehrfach hatte: der Zähler bliebe korrekt und
 * das Band alterte, oder umgekehrt.
 */
export const OPERATION_LABELS: ReadonlySet<string> = new Set([
    ASSIGNMENT_LABEL,
    UNASSIGNMENT_LABEL,
    REVIEW_REQUEST_LABEL,
    APPROVAL_LABEL,
    CHANGES_REQUESTED_LABEL,
])

/** Die `t`-Label eines Ereignisses, kleingeschrieben — wie Buzz sie vergleicht. */
const labelsOf = (event: ForgeEvent): Set<string> =>
    new Set(tagValues(event, 't').map((label) => label.toLowerCase()))

/**
 * Ist das eine Vorgangsform und **kein** Gesprächsbeitrag?
 *
 * Der Vergleich läuft kleingeschrieben, weil Buzz es so tut
 * (`projectPullRequests.mjs:180-184`, `projectIssues.mjs:114`). Ein `["t","Approval"]`
 * aus einem dritten Client zählte sonst als Kommentar hier und als Freigabe dort.
 */
export const isOperationNote = (event: ForgeEvent): boolean => {
    for (const label of labelsOf(event)) {
        if (OPERATION_LABELS.has(label)) {
            return true
        }
    }

    return false
}

/**
 * Alle kind-1-Notizen an einer Wurzel, **älteste zuerst** — Vorgangsformen
 * eingeschlossen.
 *
 * Dieselbe Ordnung wie Buzz' `sortEvents` (`shared/api/relayClientShared.ts:92-103`):
 * aufsteigend nach `created_at`, bei Gleichstand die kleinere Id. Der Tiebreak
 * ist bei Zuweisungen **tragend**, nicht kosmetisch: die `prior`-Kette unten
 * entscheidet nach dieser Reihenfolge, wer bei einem Konflikt gewinnt. Ohne
 * feste Regel hinge das Ergebnis an der Ankunftsreihenfolge des Relays.
 */
const notesForRoot = (rootId: string, commentEvents: ForgeEvent[]): ForgeEvent[] =>
    commentEvents
        .filter((event) => event.kind === FORGE_COMMENT && referencesRoot(event, rootId))
        .sort((a, b) => a.created_at - b.created_at || a.id.localeCompare(b.id))

/**
 * Die letzte Regung an einer Wurzel aus ihren Notizen — **inklusive** der
 * Vorgangsformen.
 *
 * **Das ist der Grund, warum es diese Funktion gibt.** `updatedAt` speiste sich
 * bis P1 aus `comments`; mit dem Label-Ausschluss unten hörte eine Zuweisung
 * damit auf, die Zeile in der Liste nach oben zu ziehen — die Sortierung hätte
 * sich still geändert, ohne dass ein Test es gesehen hätte. Eine Zuweisung IST
 * Bewegung am Vorgang; nur ein Gesprächsbeitrag ist sie nicht.
 */
const lastNoteAt = (rootId: string, commentEvents: ForgeEvent[]): number =>
    commentEvents.reduce(
        (newest, event) =>
            event.kind === FORGE_COMMENT && referencesRoot(event, rootId)
                ? Math.max(newest, event.created_at)
                : newest,
        0,
    )

/** Der Zustand der Zuweisungen einer Wurzel. */
export type AssignmentState = {
    /** Die aktuell Zugewiesenen, in der Reihenfolge ihrer ersten Zuweisung. */
    assignees: string[]
    /**
     * Je Pubkey die Id der zuletzt für ihn wirksamen Operation.
     *
     * Wird in P1 von keiner Fläche angezeigt und steht trotzdem hier: das ist
     * der Wert, den ein `["prior", …]`-Tag beim Schreiben tragen muss
     * (`builders.rs:1240-1243`). Ihn später aus einer zweiten Faltung zu holen
     * hiesse, dieselbe Kette zweimal zu laufen — und beim zweiten Mal anders.
     */
    heads: Record<string, string>
}

type AssignmentOperation = {
    id: string
    isAssignment: boolean
    pubkeys: string[]
    prior?: string
}

/**
 * Die Zuweisungen einer Wurzel — **geordnet gefaltet**, nicht gefiltert.
 *
 * Referenz ist Buzz' eigene Faltung (`projectIssues.mjs:99-165`), Regel für
 * Regel nachgelesen und nicht nachempfunden. Vier Dinge daran macht man falsch,
 * wenn man sie nicht liest:
 *
 * **1. Wer darf zuweisen.** Der Wurzel-Autor und der Repo-Eigentümer dürfen
 * **jeden** benennen; alle anderen nur **sich selbst** — erkennbar daran, dass
 * genau EIN `p`-Tag dasteht und es der Signierer ist (`builders.rs:1163-1167`,
 * Faltung `projectIssues.mjs:122-124`). Ohne diese Selbstbedienungs-Ausnahme
 * könnte niemand ein Issue an sich ziehen; ohne den Ein-Tag-Riegel könnte
 * jeder Fremde jeden zuweisen und hinge sich selbst als Alibi mit hinein.
 *
 * **2. `assignment` und `unassignment` schliessen einander aus.** Trägt eine
 * Notiz beide Label (oder keins), wird sie übersprungen statt geraten
 * (`projectIssues.mjs:116`). Eine Notiz, die zugleich zuweist und entzieht, hat
 * keine definierte Wirkung — und eine geratene wäre schlimmer als keine.
 *
 * **3. Die drei Phasen sind KEINE Sortierung, sondern eine Rangfolge.**
 * Erst die Selbstbedienung ohne `prior`, dann die autoritativen Operationen,
 * zuletzt die kausalen Selbstbedienungen. Sinn: eine Entscheidung des Autors
 * oder Eigentümers schlägt eine unverkettete Selbstzuweisung — aber der
 * Betroffene kann sie danach überstimmen, **wenn** er sich ausdrücklich auf
 * genau diese Entscheidung beruft (`prior`). Damit kann ein
 * selbstgewählter Zeitstempel die Autorität nicht aushebeln, und der
 * Zugewiesene bleibt trotzdem handlungsfähig.
 *
 * **4. Der Konfliktfall — zwei Operationen, ein `prior`.** Die offene Frage des
 * Plans, am Referenzparser beantwortet statt geraten: die Kette wird in der
 * Ordnung aus {@link notesForRoot} abgelaufen, die erste passende Operation
 * gewinnt und **verschiebt den Kopf**. Die zweite mit demselben `prior` findet
 * den Kopf nicht mehr vor und fällt heraus. Erster gewinnt, deterministisch,
 * ohne Sonderregel.
 *
 * ── Eine bewusste Abweichung von Buzz ───────────────────────────────────────
 *
 * `allowedActorsForRoot` ist bei uns die **weitere** Menge: sie enthält seit dem
 * 2026-08-23 auch die eingetragenen `maintainers` des 30617, weil NIP-34 das für
 * Statuswechsel verlangt. Buzz kennt nur Autor + Eigentümer. Ein Maintainer darf
 * hier also zuweisen; bei Buzz Desktop wird seine Zuweisung nicht angezeigt. Das
 * ist dieselbe, bereits getroffene Entscheidung wie bei `foldStatus` — sie hier
 * anders zu treffen hiesse, zwei Berechtigungsbegriffe an einer Fläche zu führen.
 *
 * ── Und eine Härtung gegenüber Buzz ─────────────────────────────────────────
 *
 * Ein `p`-Wert, der kein 64-stelliger Hex-Schlüssel ist, landet **nicht** in
 * `assignees`. Buzz nimmt ihn auf; bei uns geriete er in `peopleOf`/`nameOf` und
 * die Fläche zeigte eine erfundene Person. Der Riegel greift erst bei der
 * WIRKUNG, nicht bei der Vertrauensfrage: `isSelfOperation` und die
 * `prior`-Prüfung laufen über die rohe Liste, exakt wie bei Buzz. Andernfalls
 * machte das Aussortieren aus einer Zwei-Tag-Notiz eine Selbstbedienung und wir
 * wären **grosszügiger** als die Referenz statt strenger.
 */
export const foldAssignments = (
    root: ForgeEvent,
    commentEvents: ForgeEvent[],
    maintainers: string[] = [],
): AssignmentState => {
    const allowed = allowedActorsForRoot(root, maintainers)
    const uncausedSelf: AssignmentOperation[] = []
    const authoritative: AssignmentOperation[] = []
    const causalSelf: AssignmentOperation[] = []

    for (const event of notesForRoot(root.id, commentEvents)) {
        const labels = labelsOf(event)
        const isAssignment = labels.has(ASSIGNMENT_LABEL)
        const isUnassignment = labels.has(UNASSIGNMENT_LABEL)
        // Regel 2: beide oder keins ist keine Zuweisungsoperation.
        if (isAssignment === isUnassignment) {
            continue
        }
        const signer = event.pubkey.toLowerCase()
        const pubkeys = tagValues(event, 'p').map((value) => value.toLowerCase())
        const isSelfOperation = pubkeys.length === 1 && pubkeys[0] === signer
        // Regel 1: autoritativ oder Selbstbedienung — sonst zählt sie nicht.
        if (!allowed.has(signer) && !isSelfOperation) {
            continue
        }
        const operation: AssignmentOperation = { id: event.id.toLowerCase(), isAssignment, pubkeys }
        if (allowed.has(signer)) {
            authoritative.push(operation)
            continue
        }
        const priors = event.tags.filter((tag) => tag[0] === 'prior')
        if (priors.length === 0) {
            uncausedSelf.push(operation)
            continue
        }
        // Mehrere `prior` sind keine Kette, sondern eine Behauptung über zwei
        // Vergangenheiten — und ein nicht-hexadezimaler Wert kann keinen Kopf
        // treffen. Beides fällt heraus, statt eine Auswahl zu erfinden.
        const prior = (priors[0]?.[1] ?? '').toLowerCase()
        if (priors.length !== 1 || !HEX64.test(prior)) {
            continue
        }
        causalSelf.push({ ...operation, prior })
    }

    const assignees = new Set<string>()
    const heads = new Map<string, string>()
    // Regel 3 + 4: die Rangfolge der drei Phasen, innerhalb jeder die Zeitordnung.
    for (const operation of [...uncausedSelf, ...authoritative, ...causalSelf]) {
        if (operation.prior !== undefined && heads.get(operation.pubkeys[0] ?? '') !== operation.prior) {
            continue
        }
        for (const pubkey of operation.pubkeys) {
            if (!isPubkey(pubkey)) {
                continue
            }
            if (operation.isAssignment) {
                assignees.add(pubkey)
            } else {
                assignees.delete(pubkey)
            }
            heads.set(pubkey, operation.id)
        }
    }

    return { assignees: [...assignees], heads: Object.fromEntries(heads) }
}

/** Eine getroffene Review-Entscheidung, auf einen Commit bezogen. */
export type ReviewDecision = {
    id: string
    author: string
    createdAt: number
    /** Der Commit, für den sie gilt — `c` der Notiz, sonst der des 1618. */
    commit: string
    decision: 'approved' | 'changes-requested'
}

/** Reviewer und Entscheidungen eines Pull Requests. */
export type ReviewState = {
    /** Angefragte Reviewer, ohne den Autor des PR. */
    reviewers: string[]
    /** Je Reviewer die jüngste Freigabe zum AKTUELLEN Commit, älteste zuerst. */
    approvals: ReviewDecision[]
    /** Dasselbe für „Änderungen erbeten". */
    changeRequests: ReviewDecision[]
}

const EMPTY_REVIEWS: ReviewState = { reviewers: [], approvals: [], changeRequests: [] }

/**
 * Reviewer und Freigaben eines Pull Requests — nach Buzz' **Client-Konvention**
 * (`projectPullRequests.mjs:223-296`), nicht nach einer Spezifikation. Es gibt
 * keine; siehe den Kopf bei {@link APPROVAL_LABEL}.
 *
 * Drei Regeln, jede mit einer Ausfallrichtung, die man sonst baut:
 *
 * **1. Reviewer = `p` der Wurzel PLUS `p` vertrauter `review-request`-Notizen,
 * minus der Autor.** Wer nur die Wurzel liest, sieht keinen nachträglich
 * angefragten Reviewer; wer jede Anfrage zählt, lässt jeden Fremden sich selbst
 * zum Reviewer erklären. Der Autor fliegt zuletzt heraus — sein eigener `p`-Tag
 * am 1618 ist Zustellung, keine Anfrage.
 *
 * **2. Entscheiden darf, wer Reviewer ist ODER berechtigter Akteur — aber nie
 * der Autor.** `trustedActors` bei Buzz (`:250-256`). Der Repo-Eigentümer darf
 * also freigeben, ohne vorher angefragt worden zu sein; der Autor darf seinen
 * eigenen PR nicht freigeben, auch wenn er Eigentümer ist.
 *
 * **3. Eine Freigabe gilt für EINEN Commit.** Sie trägt entweder ein eigenes
 * `c` oder erbt das des 1618; stimmt es nicht mit dem aktuellen überein, zählt
 * sie nicht mehr (`:265-274`). Genau das ist der Sinn: ein Push nach der
 * Freigabe entwertet sie, sonst zeigte die Fläche ein Häkchen für Code, den
 * niemand gesehen hat. Ohne aktuellen Commit gibt es deshalb **gar keine**
 * Entscheidungen — nicht etwa alle.
 *
 * Je Entscheider bleibt die jüngste Notiz stehen (Gleichstand: die GRÖSSERE Id,
 * wie bei Buzz `:271`) — jemand darf seine Meinung ändern.
 *
 * @param currentCommit Der Commit, auf den der PR heute zeigt (jüngstes
 *   vertrautes 1619, sonst das `c` des 1618). Leer heisst: keine Entscheidungen.
 */
export const foldReviews = (
    root: ForgeEvent,
    commentEvents: ForgeEvent[],
    currentCommit: string,
    maintainers: string[] = [],
): ReviewState => {
    const author = root.pubkey.toLowerCase()
    const allowed = allowedActorsForRoot(root, maintainers)
    const notes = notesForRoot(root.id, commentEvents)

    // Regel 1
    const reviewers = new Set(
        tagValues(root, 'p')
            .map((value) => value.toLowerCase())
            .filter(isPubkey),
    )
    for (const note of notes) {
        if (!labelsOf(note).has(REVIEW_REQUEST_LABEL) || !allowed.has(note.pubkey.toLowerCase())) {
            continue
        }
        for (const pubkey of tagValues(note, 'p').map((value) => value.toLowerCase())) {
            if (isPubkey(pubkey)) {
                reviewers.add(pubkey)
            }
        }
    }
    reviewers.delete(author)

    if (!currentCommit) {
        return { ...EMPTY_REVIEWS, reviewers: [...reviewers] }
    }

    // Regel 2
    const trusted = new Set(reviewers)
    for (const actor of allowed) {
        if (actor !== author) {
            trusted.add(actor)
        }
    }

    // Regel 3
    const initialCommit = tagValue(root, 'c')
    const byAuthor = new Map<string, ReviewDecision>()
    for (const note of notes) {
        const labels = labelsOf(note)
        const isApproval = labels.has(APPROVAL_LABEL)
        const isChangeRequest = labels.has(CHANGES_REQUESTED_LABEL)
        if (isApproval === isChangeRequest) {
            continue
        }
        const key = note.pubkey.toLowerCase()
        if (!trusted.has(key)) {
            continue
        }
        const commit = tagValue(note, 'c') || initialCommit
        if (commit !== currentCommit) {
            continue
        }
        const existing = byAuthor.get(key)
        const decision: ReviewDecision = {
            id: note.id,
            author: key,
            createdAt: note.created_at,
            commit,
            decision: isApproval ? 'approved' : 'changes-requested',
        }
        if (
            !existing ||
            decision.createdAt > existing.createdAt ||
            (decision.createdAt === existing.createdAt && decision.id > existing.id)
        ) {
            byAuthor.set(key, decision)
        }
    }

    const decisions = [...byAuthor.values()].sort(
        (a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id),
    )

    return {
        reviewers: [...reviewers],
        approvals: decisions.filter((decision) => decision.decision === 'approved'),
        changeRequests: decisions.filter((decision) => decision.decision === 'changes-requested'),
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

/**
 * Gesprächsbeiträge (kind 1) zu einer Wurzel, älteste zuerst — **ohne die
 * Vorgangsformen**.
 *
 * ── Der Fehler, den dieser Ausschluss behebt ────────────────────────────────
 *
 * `referencesRoot` nimmt jedes `e`/`E` auf die Wurzel, und eine Zuweisungsnotiz
 * trägt genau dieses `["e", <id>, "", "root"]`. Sie war damit ein Kommentar wie
 * jeder andere: sie stand in der Liste und sie zählte. Gemessen am 2026-08-24
 * vor dem Eingriff, an allen drei Zählstellen — Issue **3** statt 1, Pull
 * Request **3** statt 1, Patch **2** statt 1.
 *
 * Und es war nicht nur die Zahl: eine Zuweisungsnotiz darf bis 64 KiB Freitext
 * tragen (`builders.rs:1223`) und **darf leer sein**. Die Sonde zeigte genau
 * das — der dritte „Kommentar" war die leere Zeichenkette, also eine leere
 * Sprechblase auf der Fläche, ohne Autor-Aussage und ohne Anlass.
 *
 * ── Wo wir bewusst von Buzz abweichen ───────────────────────────────────────
 *
 * Buzz **behält** die Notizen in `comments` und markiert sie (`isApproval`,
 * `isTrustedReviewRequest`, …); erst die Zeitleiste rendert sie anders
 * (`projectPullRequests.mjs:328-346`). Wir werfen sie hier heraus. Folge, die
 * man kennen muss: **ihr Freitext erscheint in P1 nirgends.** Wer einer
 * Zuweisung eine Begründung mitgibt, sieht sie in dieser Fläche nicht — das
 * Band zeigt WER, nicht WARUM. Das ist der Preis der einfacheren Zusage „was in
 * `comments` steht, ist ein Gesprächsbeitrag"; eine Vorgangs-Zeitleiste wäre
 * eine eigene Fläche und keine Fussnote an dieser.
 */
export const commentsForRoot = (rootId: string, commentEvents: ForgeEvent[]): ForgeComment[] =>
    notesForRoot(rootId, commentEvents)
        .filter((event) => !isOperationNote(event))
        .map(toComment)

// ── Issue (1621) ────────────────────────────────────────────────────────────

export type Issue = {
    id: string
    title: string
    content: string
    author: string
    createdAt: number
    /**
     * Letzte Regung: Notiz (Kommentar **oder** Zuweisung) oder Statuswechsel,
     * sonst die Erstellung. Zur Begründung siehe {@link lastNoteAt}.
     */
    updatedAt: number
    repoAddress: string
    labels: string[]
    status: IssueStatus
    /**
     * Die aktuell Zugewiesenen ({@link foldAssignments}).
     *
     * Steht neben `labels` und nicht darin: ein Label ist Fremdtext aus dem
     * `t`-Tag der Wurzel, ein Zugewiesener ist ein Schlüssel aus einer
     * gefalteten Operationskette. Sie sehen auf der Fläche ähnlich aus und
     * entstehen völlig verschieden.
     */
    assignees: string[]
    /** Je Zugewiesenem der Kopf seiner Operationskette — Schreibseite (P5). */
    assignmentHeads: Record<string, string>
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
    maintainers: string[] = [],
): Issue => {
    const status = foldStatus(root, statusEvents, maintainers)
    const comments = commentsForRoot(root.id, commentEvents)
    // Die ROHE Liste, nicht `comments`: die Faltung braucht genau die Notizen,
    // die `commentsForRoot` gerade herausgeworfen hat.
    const assignments = foldAssignments(root, commentEvents, maintainers)

    return {
        id: root.id,
        title: rootTitle(root),
        content: root.content,
        author: root.pubkey.toLowerCase(),
        createdAt: root.created_at,
        updatedAt: Math.max(
            root.created_at,
            status?.created_at ?? 0,
            lastNoteAt(root.id, commentEvents),
        ),
        repoAddress: tagValue(root, 'a'),
        labels: tagValues(root, 't'),
        status: issueStatusFrom(status),
        assignees: assignments.assignees,
        assignmentHeads: assignments.heads,
        commentCount: comments.length,
        comments,
    }
}

/** Alle Issues eines Bestands, zuletzt bewegte zuerst. */
export const buildIssues = (
    issueEvents: ForgeEvent[],
    statusEvents: ForgeEvent[] = [],
    commentEvents: ForgeEvent[] = [],
    maintainersOf: MaintainerLookup = () => [],
): Issue[] =>
    issueEvents
        .filter((event) => event.kind === GIT_ISSUE)
        .map((root) => toIssue(root, statusEvents, commentEvents, maintainersOf(tagValue(root, 'a'))))
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
    /** Angefragte Reviewer ohne den Autor ({@link foldReviews}). */
    reviewers: string[]
    /** Freigaben zum AKTUELLEN Commit, je Reviewer die jüngste. */
    approvals: ReviewDecision[]
    /** „Änderungen erbeten" zum aktuellen Commit, je Reviewer die jüngste. */
    changeRequests: ReviewDecision[]
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
    maintainers: string[] = [],
): PullRequest => {
    const allowed = allowedActorsForRoot(root, maintainers)
    const status = foldStatus(root, statusEvents, maintainers)
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
    // Der Commit, auf den der PR HEUTE zeigt. Er steht vor der Faltung fest,
    // weil `foldReviews` ihn braucht: eine Freigabe gilt genau für diesen einen
    // Stand und wird von einem Push danach entwertet.
    const commit = newestUpdate?.commit || tagValue(root, 'c')
    const reviews = foldReviews(root, commentEvents, commit, maintainers)

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
            lastNoteAt(root.id, commentEvents),
        ),
        repoAddress: tagValue(root, 'a'),
        labels: tagValues(root, 't'),
        status: pullRequestStatusFrom(root, status),
        reviewers: reviews.reviewers,
        approvals: reviews.approvals,
        changeRequests: reviews.changeRequests,
        branch: tagValue(root, 'branch-name'),
        targetBranch: tagValue(root, 'target-branch'),
        commit,
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
    maintainersOf: MaintainerLookup = () => [],
): PullRequest[] =>
    pullRequestEvents
        .filter((event) => event.kind === GIT_PULL_REQUEST)
        .map((root) =>
            toPullRequest(
                root,
                updateEvents,
                statusEvents,
                commentEvents,
                maintainersOf(tagValue(root, 'a')),
            ),
        )
        .sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id))

// ── Patch (1617) ────────────────────────────────────────────────────────────

export type Patch = {
    id: string
    /** Aus dem `Subject:`-Header; `''`, wenn keiner da ist (siehe {@link GIT_PATCH}). */
    title: string
    /** Der ROHE `git format-patch`-Text. Gelesen wird er in `forgeDiff.ts`. */
    content: string
    author: string
    createdAt: number
    updatedAt: number
    repoAddress: string
    labels: string[]
    status: PatchStatus
    /** Commit, den der Patch erzeugt (`commit`-Tag), sonst `''`. */
    commit: string
    /** Eltern-Commit (`parent-commit`), sonst `''`. */
    parentCommit: string
    /** `["t","root"]` — erster Patch einer neuen Serie. */
    isRoot: boolean
    /** `["t","root-revision"]` — erster Patch einer Neufassung. */
    isRootRevision: boolean
    /** `["e", <id>, "", "reply"]` — der Vorgänger in der Serie, sonst `''`. */
    inReplyTo: string
    commentCount: number
    comments: ForgeComment[]
}

/**
 * Ein 1617 → {@link Patch}.
 *
 * **Der Status läuft durch denselben Riegel wie bei Issue und PR** — Autor der
 * Wurzel, Repo-Eigentümer, eingetragene Maintainer. Ein Patch ist für NIP-34
 * dieselbe Art Wurzel wie ein Issue („from either the issue/patch author or a
 * maintainer"); ihn hier laxer zu behandeln hiesse, denselben Fehler, der am
 * 2026-08-23 in `allowedActorsFor` behoben wurde, an einer neuen Stelle wieder
 * einzuführen.
 *
 * **Serien werden NICHT zusammengefasst.** Ein `git format-patch` über drei
 * Commits erzeugt drei 1617, verkettet über `["e", <vorgänger>, "", "reply"]`.
 * Sie zu einer Zeile zu falten hiesse, eine Kette zu laufen, die im Bestand
 * lückenhaft sein kann (der Vorgänger liegt auf einem anderen Relay) — und aus
 * einer Lücke würde still eine falsche Serienlänge. Die Marker stehen deshalb
 * am Modell, die Fläche zeigt sie an, und jede Wurzel bleibt ihre eigene Zeile.
 */
export const toPatch = (
    root: ForgeEvent,
    statusEvents: ForgeEvent[] = [],
    commentEvents: ForgeEvent[] = [],
    maintainers: string[] = [],
): Patch => {
    const status = foldStatus(root, statusEvents, maintainers)
    const comments = commentsForRoot(root.id, commentEvents)
    const labels = tagValues(root, 't')

    return {
        id: root.id,
        // Ein `subject`-Tag setzt zwar kein bekannter Client an einem 1617,
        // ausgeschlossen ist es aber nicht — steht eines da, gilt es, wie bei
        // jeder anderen Wurzel auch (`rootTitle`).
        title: tagValue(root, 'subject') || patchSubject(root.content),
        content: root.content,
        author: root.pubkey.toLowerCase(),
        createdAt: root.created_at,
        updatedAt: Math.max(root.created_at, status?.created_at ?? 0, lastNoteAt(root.id, commentEvents)),
        repoAddress: tagValue(root, 'a'),
        labels,
        status: patchStatusFrom(status),
        commit: tagValue(root, 'commit'),
        parentCommit: tagValue(root, 'parent-commit'),
        isRoot: labels.some((label) => label.toLowerCase() === 'root'),
        isRootRevision: labels.some((label) => label.toLowerCase() === 'root-revision'),
        inReplyTo: root.tags.find((tag) => tag[0] === 'e' && tag[3] === 'reply')?.[1] ?? '',
        commentCount: comments.length,
        comments,
    }
}

/** Alle Patches eines Bestands, zuletzt bewegte zuerst. */
export const buildPatches = (
    patchEvents: ForgeEvent[],
    statusEvents: ForgeEvent[] = [],
    commentEvents: ForgeEvent[] = [],
    maintainersOf: MaintainerLookup = () => [],
): Patch[] =>
    patchEvents
        .filter((event) => event.kind === GIT_PATCH)
        .map((root) => toPatch(root, statusEvents, commentEvents, maintainersOf(tagValue(root, 'a'))))
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
