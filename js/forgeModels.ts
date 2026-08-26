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

/**
 * Ist das ein Nostr-Schlüssel (64 Hexstellen)?
 *
 * **Exportiert seit F1 (2026-08-24), und der Grund ist kein Stil.** Derselbe
 * Riegel wurde an drei Stellen gebraucht — hier, im Aktivitätsstrom und an der
 * Namensauflösung in `forge.ts` — und in P1 stand er nur an einer davon. Drei
 * Kopien einer Sicherheitsprüfung sind drei Gelegenheiten, eine davon zu
 * vergessen; genau das ist passiert. Ab jetzt gibt es eine Definition, und wer
 * eine vierte Stelle baut, importiert sie, statt sie abzuschreiben.
 */
export const isPubkey = (value: string): boolean => HEX64.test(value.toLowerCase())

/**
 * Sieht das aus wie eine Git-Objekt-Id? (P7, 2026-08-26)
 *
 * **Eine Formprüfung, keine Existenzaussage** — wie bei {@link parseRepoAddress}
 * gilt: die Zeichenkette ist Fremdeingabe, ihr Ziel kann es nie gegeben haben.
 *
 * `7..64` und nicht `40|64`: Git kürzt Hashes im Alltag auf sieben Stellen, und
 * die Anzeige tut es auch (`shortCommit` in `forge.ts` benutzt **diese**
 * Funktion). Enger wäre spec-treuer — Buzz' Builder verlangt volle 40 —, würde
 * aber einen gekürzten Hash aus einem fremden Client wegwerfen, obwohl er
 * lesbar und verlinkbar ist. Wichtig ist die Untergrenze: ohne sie stünde
 * `["merge-commit", "-"]` als Commit im Bild.
 */
const COMMIT_ID = /^[0-9a-f]{7,64}$/

export const isCommitId = (value: string): boolean => COMMIT_ID.test(value.toLowerCase())

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

/**
 * Repos, die denselben `euc` tragen wie dieses — **ohne es selbst** (P7/3).
 *
 * ── Warum das Wort „Fork" hier NICHT steht ──────────────────────────────────
 *
 * `["r", <commit>, "euc"]` ist der *earliest unique commit* eines Repos: zwei
 * Repos mit demselben `euc` haben nachweislich dieselbe Wurzel. Das ist eine
 * **Äquivalenz**, keine Richtung. Wer daraus „B ist ein Fork von A" macht,
 * braucht eine Reihenfolge, und die gibt es hier nicht:
 *
 * - `created_at` taugt nicht. Ein 30617 ist ersetzbar; der Zeitstempel ist der
 *   der **letzten Neuankündigung**, nicht der Entstehung. Ein Repo, das gestern
 *   seine Beschreibung geändert hat, sähe damit jünger aus als sein eigener
 *   Fork.
 * - Der `euc` selbst trägt keinen Verweis auf ein Ursprungs-Repo, und NIP-34
 *   kennt kein `fork-of`-Tag.
 *
 * Die ehrliche Aussage ist deshalb „dieselbe Historie", nicht „Original und
 * Kopie" — und genau so heißt die Funktion.
 *
 * **Ein leerer `euc` verwandtschaftet nichts.** Sonst fielen alle Repos ohne
 * `r`-Tag in eine Riesengruppe; die häufigste Angabe wäre die stärkste
 * Behauptung. Ebenso zählt die eigene Adresse nie mit — auch dann nicht, wenn
 * sie zweimal in der Liste steht.
 */
export const verwandteRepos = <T extends { address: string; euc: string }>(
    repo: T,
    alle: readonly T[],
): T[] => {
    const euc = repo.euc.toLowerCase()
    if (!isCommitId(euc)) {
        return []
    }
    const gesehen = new Set<string>([repo.address])

    return alle.filter((kandidat) => {
        if (kandidat.euc.toLowerCase() !== euc || gesehen.has(kandidat.address)) {
            return false
        }
        gesehen.add(kandidat.address)

        return true
    })
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
    /**
     * **Der Zustand ist diesem Repository nicht zuzuordnen — es wird keiner
     * behauptet** (N1, 2026-08-24).
     *
     * Ist er gesetzt, sind `branches`, `tags` und `head` leer. Das ist NICHT
     * dasselbe wie „es gibt keinen Zustand": es gibt einen, wir wissen nur
     * nicht, ob er zu diesem Repo gehört. Die Fläche muss beide Fälle
     * unterscheiden, sonst tauscht sie eine falsche Behauptung gegen eine
     * andere („noch nichts veröffentlicht", obwohl sehr wohl gepusht wurde).
     */
    ambiguous: boolean
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
        /**
         * Der Pusher — **nur, wenn es ein Schlüssel ist** (F1, 2026-08-24).
         *
         * Der `p`-Tag eines 30618 ist Fremdeingabe wie jeder andere Tag. Stand
         * hier `["p","Bob"]`, reichte dieses Feld den Rohwert bis in
         * `displayPubkey` durch — und das **wirft** einen SyntaxError
         * (`npubEncode('Bob')`: „Input string must contain hex characters in
         * even length", am 2026-08-24 nachgestellt). Der Wurf passiert in einem
         * `derived()`-Callback, und svelte hält seine `subscriber_queue`
         * modulweit: danach liefert **jeder** Store der Seite nichts mehr aus,
         * auch völlig unbeteiligte. Ein einziges Ereignis genügte, die Insel war
         * bis zum Reload tot — und beim nächsten Reload liegt es wieder da.
         *
         * `''` heisst „das Ereignis nennt ihn nicht", und genau das ist bei
         * einem unbrauchbaren Wert die richtige Auskunft. Der zweite Riegel
         * sitzt in `forge.ts` an `nameOf`; dieser hier ist der an der Quelle.
         */
        actor: isPubkey(tagValue(event, 'p')) ? tagValue(event, 'p').toLowerCase() : '',
        // Ein einzelnes Ereignis ist nie mehrdeutig — die Mehrdeutigkeit
        // entsteht erst aus dem Repo-BESTAND (siehe {@link foldRepoState}).
        ambiguous: false,
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

/**
 * **Bekannte Kante (N1, 2026-08-24): bei relay-signiertem Zustand ist die
 * Zuordnung mehrdeutig, und zwar prinzipiell.**
 *
 * Ein 30618 trägt keinen Eigentümer und kein `a`
 * (`api/git/manifest_event.rs:1-18`), der Relay signiert alle mit demselben
 * Schlüssel (`api/git/transport.rs:2009`) und trägt das nackte `repo_id` als
 * `d` ein. Repositories sind aber über `(owner, d)` gekeyt
 * (`api/git/binding.rs:36`) — zwei Eigentümer dürfen dasselbe `d` führen.
 *
 * Folge: haben „demo" von X und „demo" von Y beide relay-signierte Zustände,
 * sieht jede der beiden Repo-Flächen unter Umständen den Zustand der anderen.
 * **Das ist clientseitig nicht auflösbar**; die Reparatur wäre ein `a`-Tag am
 * 30618 auf Relay-Seite. Hier wird deshalb NICHT geraten — eine erfundene
 * Zuordnung wäre genau dann falsch, wenn es darauf ankommt.
 *
 * Auflösbar ist der andere Fall: ein **eigentümer-signiertes** 30618 gehört
 * eindeutig zum Repo dieses Eigentümers, und genau das leistet der Filter unten
 * über `trusted` — ein fremder Eigentümer mit gleichem `d` fällt heraus.
 *
 * ── Was `dtagGeteilt` entscheidet, und warum es von aussen kommt ────────────
 *
 * **Die Mehrdeutigkeit ist an den Ereignissen NICHT ablesbar.** Zwei
 * relay-signierte 30618 mit gleichem `d` sind der Normalfall — der Relay hält
 * alte Fassungen und liefert sie mit aus (gemessen: drei Stück zu EINEM Repo,
 * siehe {@link dedupeReplaceable}). Ob die zwei zu einem Repo oder zu zweien
 * gehören, steht in keinem Tag. Die Auskunft hat nur, wer den REPO-BESTAND
 * kennt — also der Aufrufer. Deshalb ist es ein Parameter und keine Ableitung:
 * eine hier erfundene Heuristik („mehr als eins ⇒ verdächtig") hätte den
 * Normalfall zerschossen.
 *
 * **Und hier stand bis zum 2026-08-24 ein Satz, der für diese Funktion nicht
 * stimmte.** Er lautete, es werde „nicht geraten" — während
 * `dedupeReplaceable` + `.sort()[0]` sehr wohl eine Wahl trafen: bei zwei
 * gleichnamigen Repos bekam Alices Zweig-Anzeige Bobs Commit, ohne Marker und
 * ohne zweiten Eintrag. Der Strom machte den Fehler zur selben Zeit sichtbar
 * (zwei Zeilen, zwei Schlüssel), diese Fläche löste ihn still auf. Zwei
 * Politiken für dieselbe Mehrdeutigkeit, und die sichere lag auf der
 * unwichtigeren Fläche.
 *
 * **Die Regel jetzt, bei geteiltem `d`: nur Selbstbezeugtes zählt.** Ein
 * eigentümer-signiertes 30618 ist eindeutig — es gilt. Bleibt nur
 * relay-signiertes übrig, wird **kein Zustand behauptet**; die Funktion liefert
 * dann einen Marker mit leeren Refs ({@link RepoState.ambiguous}) statt `null`,
 * damit die Fläche „nicht zuzuordnen" von „nichts veröffentlicht"
 * unterscheiden kann. Ein fail-closed, das beides zu „nichts da" verschmilzt,
 * tauschte nur eine falsche Aussage gegen eine andere.
 *
 * @param dtagGeteilt Trägt ein ANDERES sichtbares Repo dasselbe `d`? Der
 *   Aufrufer weiss das, diese Funktion nicht.
 */
export const foldRepoState = (
    events: ForgeEvent[],
    {
        owner,
        relaySelf,
        dtag,
        dtagGeteilt = false,
    }: { owner: string; relaySelf: string; dtag: string; dtagGeteilt?: boolean },
): RepoState | null => {
    const ownerKey = owner.toLowerCase()
    const trusted = new Set([ownerKey, relaySelf.toLowerCase()].filter((value) => value !== ''))
    const candidates = events.filter(
        (event) =>
            event.kind === REPO_STATE &&
            tagValue(event, 'd') === dtag &&
            trusted.has(event.pubkey.toLowerCase()),
    )
    // Bei geteiltem Namen bleibt nur, was der Eigentümer selbst bezeugt hat.
    const zulaessig = dtagGeteilt
        ? candidates.filter((event) => event.pubkey.toLowerCase() === ownerKey)
        : candidates
    const newest = dedupeReplaceable(zulaessig).sort(
        (a, b) =>
            b.created_at - a.created_at ||
            Number(hasRefs(b)) - Number(hasRefs(a)) ||
            a.id.localeCompare(b.id),
    )[0]
    if (newest) {
        return toRepoState(newest)
    }
    // Es gab etwas, es war nur nicht zuzuordnen — das ist eine andere Auskunft
    // als „es gibt nichts", und die Fläche muss beide auseinanderhalten.
    if (candidates.length > 0) {
        return { branches: [], tags: [], head: '', updatedAt: 0, actor: '', ambiguous: true }
    }

    return null
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
    index?: RootIndex,
): ForgeEvent | null => {
    const allowed = allowedActorsForRoot(root, maintainers)
    /*
     * **Nur der EINGANG wechselt, nicht die Regel** (Restposten P1, 2026-08-25).
     *
     * Ohne Index wie bisher die ganze Liste; mit Index der Eimer dieser Wurzel,
     * den {@link indexStatus} vorsortiert und entdoppelt hat. Filter und
     * Sortierung darunter sind Zeichen für Zeichen dieselben geblieben — auch
     * die `referencesRoot`-Prüfung, die der Eimer bereits garantiert. Sie
     * kostet einen Vergleich je Kandidat und macht den Vergleich mit dem alten
     * Pfad führbar; sie wegzulassen wäre eine zweite Änderung in einem Eingriff,
     * der ausdrücklich keine sein soll.
     *
     * `foldStatus` trägt die Berechtigungsentscheidung dieser Fläche. Was hier
     * geändert wird, ist die Reihenfolge des Nachschlagens — nichts sonst.
     */
    const kandidaten = index ? (index.get(root.id) ?? []) : statusEvents

    return (
        kandidaten
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

// ── Was beim Anwenden/Mergen herauskam (1631) ───────────────────────────────

/**
 * Wo ein Pull Request oder Patch gelandet ist — die Auskunft aus dem 1631.
 *
 * Beide Felder sind leer, solange kein gültiges 1631 vorliegt; das ist der
 * Normalfall und keine Lücke.
 */
export type MergeInfo = {
    /** `merge-commit` — der Merge-Commit, wenn zusammengeführt wurde. */
    mergeCommit: string
    /** `applied-as-commits` — die Commits, als die angewandt wurde. */
    appliedAsCommits: string[]
}

const KEINE_MERGE_INFO: MergeInfo = { mergeCommit: '', appliedAsCommits: [] }

/**
 * `merge-commit` und `applied-as-commits` aus dem **gefalteten** Status lesen
 * (P7/2, NIP-34).
 *
 * ── Drei Dinge, die man hier falsch macht ───────────────────────────────────
 *
 * 1. **Nur ein 1631 trägt sie.** NIP-34 nennt beide Tags ausdrücklich unter
 *    „Status: Applied/Merged"; Buzz' Builder lehnt sie an jedem anderen Status
 *    sogar ab (`builders.rs:1386-1390`: „only apply to the merged/resolved
 *    status"). Ein `merge-commit` an einem 1632 ist deshalb kein Merge, sondern
 *    eine Behauptung, die kein Schreiber dieses Protokolls erzeugt — sie wird
 *    verworfen, nicht angezeigt.
 * 2. **Der Absender muss berechtigt sein.** Diese Funktion prüft das NICHT
 *    selbst: sie bekommt das Ergebnis von {@link foldStatus}, und dort sitzt
 *    Regel 1 des Dateikopfs. Wer sie mit einem beliebigen Ereignis aufruft,
 *    umgeht den Riegel — deshalb nimmt sie `ForgeEvent | null` und nicht eine
 *    Liste.
 * 3. **Nicht über den `r`-Tag gehen.** Buzz schreibt zu jedem Merge- und
 *    Anwendungs-Commit zusätzlich ein `["r", <commit>]` (`builders.rs:1412,1422`)
 *    — dasselbe Tag trägt am 30617 den `euc` und am 1631 laut Spec den
 *    „earliest unique commit id of repo". Ein `r`-Tag ist hier also mehrdeutig;
 *    die benannten Tags sind es nicht.
 *
 * Mehrwertig **und** wiederholt einwertig werden beide gelesen
 * (`tagValuesFlat`): die Spec schreibt `["applied-as-commits", c1, c2, …]`, ein
 * anderer Client darf es auch zeilenweise sagen.
 */
export const mergeInfoOf = (statusEvent: ForgeEvent | null): MergeInfo => {
    if (!statusEvent || statusEvent.kind !== GIT_STATUS_APPLIED) {
        return KEINE_MERGE_INFO
    }
    const mergeCommit = tagValue(statusEvent, 'merge-commit').toLowerCase()

    return {
        mergeCommit: isCommitId(mergeCommit) ? mergeCommit : '',
        appliedAsCommits: [
            ...new Set(
                tagValuesFlat(statusEvent, 'applied-as-commits')
                    .map((wert) => wert.toLowerCase())
                    .filter(isCommitId),
            ),
        ],
    }
}

/**
 * Der `merge-base` eines 1618/1619 — der jüngste gemeinsame Vorfahr mit dem
 * Zielbranch (NIP-34, optional).
 *
 * **Der Schlüssel zum PR-Diff**, und der Grund, warum das Feld gelesen wird,
 * obwohl heute noch nichts es zeigt: ein 1618 trägt keinen Patch, nur einen
 * Tip-Commit. Was ein PR *ändert*, ist die Strecke `merge-base..tip` — ohne die
 * Basis wäre der Vergleichspunkt geraten.
 */
export const mergeBaseOf = (event: ForgeEvent): string => {
    const wert = tagValue(event, 'merge-base').toLowerCase()

    return isCommitId(wert) ? wert : ''
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
/**
 * Die drei Label, die ohne genannte Person **keine** Operation sein können.
 *
 * Das ist keine Erfindung, sondern die Invariante des SDK: eine Zuweisung ohne
 * Zugewiesene lässt sich gar nicht bauen (`builders.rs:1219-1223` — „between 1
 * and 50 assignees are required"), und eine Review-Anfrage ohne Angefragten
 * ebenso wenig (`pullRequestReviews.ts:110-113` — „Select at least one
 * reviewer."). Wer `["t","assignment"]` ohne `p` schreibt, hat also nicht eine
 * kaputte Zuweisung geschrieben, sondern **keine**.
 */
const LABELS_MIT_PERSON: ReadonlySet<string> = new Set([
    ASSIGNMENT_LABEL,
    UNASSIGNMENT_LABEL,
    REVIEW_REQUEST_LABEL,
])

/**
 * Trägt das Ereignis dieses Label **und** das, was das Label braucht?
 *
 * ── Warum es diese zweite Hälfte gibt (2026-08-24) ──────────────────────────
 *
 * Die fünf Label sind gewöhnliche englische Wörter. Ein Client, der Hashtags aus
 * dem Fliesstext in `t`-Tags spiegelt, macht aus „#approval nötig" eine Notiz,
 * die für uns eine Vorgangsform ist — und sie verschwindet dann aus
 * Kommentarliste, Zähler und Leiste. Für den Schreiber ist das sichtbar (sein
 * Beitrag erscheint nicht), für alle anderen nicht.
 *
 * **Gemessen, wie real das ist:** keiner der beiden Clients an diesem Relay tut
 * es. Unser eigener Kommentar-Schreiber setzt überhaupt kein `t`
 * (`forgeWriteModels.buildCommentTags` — nur `e`, `a`, `p`), und Buzz setzt `t`
 * ausschliesslich für ausdrücklich gewählte Vorgänge
 * (`features/projects/hooks.ts:352-371`, `issueAssignments.ts:104-112`,
 * `pullRequestReviews.ts:125-134`). Der Pfad braucht einen DRITTEN Client.
 *
 * **Warum das Label trotzdem das Erkennungsmerkmal bleibt.** Die naheliegende
 * Alternative wäre, eine Notiz erst dann auszuschliessen, wenn die Faltung sie
 * auch ANERKENNT. Das dreht den Fehler aber in die gefährlichere Richtung: eine
 * abgelehnte Zuweisung — also genau die, die ein Angreifer schreibt — käme als
 * Kommentar zurück, mitsamt ihrer Maschinenprosa („Assigned this issue to Bob")
 * und, bei leerem Rumpf, als leere Sprechblase. Ein hypothetisches
 * Falsch-Positiv eines dritten Clients gegen ein angreifer-steuerbares
 * Falsch-Negativ zu tauschen, ist das schlechtere Geschäft.
 *
 * **Was stattdessen passiert:** für die drei Label, bei denen das SDK selbst
 * eine Mindestform erzwingt, wird sie hier verlangt. „#assignment" in einem
 * Fliesstext ohne `p`-Tag ist damit wieder ein gewöhnlicher Kommentar. Für
 * `approval`/`changes-requested` gibt es keine solche Invariante — dort bleibt
 * es beim blossen Label, und das ist die verbleibende, bewusst getragene Kante.
 */
const traegtOperation = (event: ForgeEvent, label: string): boolean =>
    !LABELS_MIT_PERSON.has(label) || tagValues(event, 'p').length > 0

export const isOperationNote = (event: ForgeEvent): boolean => {
    for (const label of labelsOf(event)) {
        if (OPERATION_LABELS.has(label) && traegtOperation(event, label)) {
            return true
        }
    }

    return false
}

/**
 * Welche Vorgangsform eine Notiz trägt — `''`, wenn keine oder keine eindeutige.
 *
 * **Strenger als Buzz, und mit Absicht.** Buzz wertet die drei Kategorien
 * unabhängig aus: eine Notiz darf zugleich Review-Anfrage und Freigabe sein, und
 * die Zeitleiste zeigt dann die eine (`projectPullRequestCommentTimelineKind`,
 * `projectPullRequests.mjs:84-94`). Für EINEN Satz in der Aktivitätsleiste gibt
 * es diese Wahl nicht — man müsste eine Kategorie küren. Deshalb hier: mehr als
 * eine Kategorie, oder ein widersprüchliches Paar, ergibt keine Aussage.
 *
 * Das kostet nichts, was jemand wirklich schreibt (Buzz setzt je Notiz genau ein
 * Label, `builders.rs:1236` und `pullRequestReviews.ts:129,181`), und es
 * verhindert, dass ein fremder Client durch Label-Stapelung bestimmt, welchen
 * Satz unsere Leiste über ihn bildet.
 *
 * **Nicht zu verwechseln mit der Faltung.** Diese Funktion sagt nur, was
 * DRAUFSTEHT. Ob es auch GILT, entscheiden {@link foldAssignments} und
 * {@link foldReviews} — und die Aktivitätsleiste muss dieselbe Frage stellen,
 * sonst zeigt sie eine Freigabe, die kein Leser je anerkennt.
 */
export type ForgeOperation =
    | ''
    | 'assignment'
    | 'unassignment'
    | 'review-request'
    | 'approval'
    | 'changes-requested'

export const operationOf = (event: ForgeEvent): ForgeOperation => {
    const labels = labelsOf(event)
    // Dieselbe Mindestform wie {@link isOperationNote} — sonst liefen die beiden
    // Funktionen auseinander, und die Notiz wäre an einer Fläche ein Vorgang und
    // an der anderen ein Gespräch.
    const hat = (label: string): boolean => labels.has(label) && traegtOperation(event, label)
    const istZuweisung = hat(ASSIGNMENT_LABEL)
    const istEntzug = hat(UNASSIGNMENT_LABEL)
    const istAnfrage = hat(REVIEW_REQUEST_LABEL)
    const istFreigabe = hat(APPROVAL_LABEL)
    const istEinspruch = hat(CHANGES_REQUESTED_LABEL)

    // Widersprüchliche Paare zuerst: sie heben sich auf, wie in der Faltung.
    if (istZuweisung && istEntzug) {
        return ''
    }
    if (istFreigabe && istEinspruch) {
        return ''
    }
    const kategorien = (istZuweisung || istEntzug ? 1 : 0) + (istAnfrage ? 1 : 0) + (istFreigabe || istEinspruch ? 1 : 0)
    if (kategorien !== 1) {
        return ''
    }
    if (istZuweisung) {
        return ASSIGNMENT_LABEL
    }
    if (istEntzug) {
        return UNASSIGNMENT_LABEL
    }
    if (istAnfrage) {
        return REVIEW_REQUEST_LABEL
    }

    return istFreigabe ? APPROVAL_LABEL : CHANGES_REQUESTED_LABEL
}

/**
 * Die Notizen aller Wurzeln, **einmal** nach `e`/`E` einsortiert (P7).
 *
 * ── Was das ersetzt ─────────────────────────────────────────────────────────
 *
 * Bis P7 lief jede Wurzel mit {@link notesForRoot} über den GESAMTEN Bestand —
 * und das viermal (Kommentare, letzte Regung, Zuweisungen, Reviews). Bei `m`
 * Wurzeln und `n` Notizen ergab das `O(m·n)`. Gemessen am 2026-08-24
 * (1600 Wurzeln je Kind, je zwei Notizen): **2146 ms**, Faktor ~4,2 je
 * Verdopplung, also sauber quadratisch.
 *
 * **Erreichbar war der grosse Fall über keinen Weg** — `FORGE_ROOT_LIMIT = 200`
 * je Kind über den Draht, `FORGE_ROOT_CAP_TOTAL`/`FORGE_META_CAP_TOTAL` in
 * `js/storage.ts` deckeln den Cache. Gebaut ist es trotzdem: eine Grenze, die
 * nur durch zwei fremde Konstanten hält, ist keine Eigenschaft dieses Moduls.
 *
 * ── Zwei Eigenschaften, die die Faltung voraussetzt ─────────────────────────
 *
 * 1. **Die Ordnung ist dieselbe wie vorher** — aufsteigend nach `created_at`,
 *    bei Gleichstand die kleinere Id (Buzz' `sortEvents`). Sie ist bei den
 *    Zuweisungen TRAGEND: die `prior`-Kette entscheidet nach dieser Reihenfolge,
 *    wer bei einem Konflikt gewinnt. Sortiert wird einmal je Eimer statt einmal
 *    je Abfrage.
 * 2. **Ein Ereignis steht höchstens EINMAL in einem Eimer.** Eine Notiz darf
 *    dieselbe Wurzel zweimal nennen (`["e",x]` und `["E",x]`); `notesForRoot`
 *    filterte mit `some()` und lieferte sie deshalb einfach. Ohne die
 *    Entdopplung hier zählte sie ab P7 doppelt — im Kommentarzähler sichtbar,
 *    in der Zuweisungskette still.
 *
 * **`indizieren` heisst nicht `Verhalten ändern`:** die Faltungsregeln bleiben
 * Byte für Byte dieselben. Was hier entsteht, ist ausschliesslich eine andere
 * Reihenfolge des Nachschlagens.
 */
export type RootIndex = ReadonlyMap<string, readonly ForgeEvent[]>

/**
 * Der gemeinsame Kern beider Indizes: Ereignisse nach ihrer Wurzel einsortieren.
 *
 * **Ein Bauteil, zwei Anwendungen** — Notizen (kind 1) und Statuswechsel
 * (1630–1633). Sie unterscheiden sich ausschliesslich im Kind-Filter; die zwei
 * Eigenschaften, auf die sich die Faltungen verlassen, sind für beide dieselben
 * und stehen deshalb genau einmal hier. Zwei Kopien wären zwei Orte, an denen
 * eine davon vergessen wird — und beim Notizen-Index war genau die
 * Entdopplung der Punkt, der ohne Absicht still gefehlt hätte.
 */
const indexByRoot = (events: readonly ForgeEvent[], gilt: (event: ForgeEvent) => boolean): RootIndex => {
    const eimer = new Map<string, ForgeEvent[]>()
    for (const event of events) {
        if (!gilt(event)) {
            continue
        }
        // Eigenschaft 2: je Wurzel höchstens einmal, auch bei `e` UND `E`.
        const wurzeln = new Set<string>()
        for (const tag of event.tags) {
            if ((tag[0] === 'e' || tag[0] === 'E') && isFilled(tag[1])) {
                wurzeln.add(tag[1])
            }
        }
        for (const wurzel of wurzeln) {
            const liste = eimer.get(wurzel)
            if (liste) {
                liste.push(event)
            } else {
                eimer.set(wurzel, [event])
            }
        }
    }
    // Eigenschaft 1: aufsteigend, bei Gleichstand die kleinere Id.
    for (const liste of eimer.values()) {
        liste.sort((a, b) => a.created_at - b.created_at || a.id.localeCompare(b.id))
    }

    return eimer
}

export const indexNotes = (commentEvents: readonly ForgeEvent[]): RootIndex =>
    indexByRoot(commentEvents, (event) => event.kind === FORGE_COMMENT)

/**
 * Dasselbe für die Statuswechsel (1630–1633) — der zweite überlineare Scan.
 *
 * **Der Restposten aus P7.** `foldStatus` lief weiter je Wurzel über seine
 * ganze Ereignisliste; gemessen mit dem Gesamtbestand als `statusEvents`:
 * 8,5 / 22,5 / 83,2 ms bei 400 / 800 / 1600 Wurzeln. Herausgehalten wurde er
 * damals bewusst — eine Signaturänderung an einer gerade sicherheitsgeprüften
 * Faltung gehört nicht in denselben Commit wie ein Performance-Umbau.
 *
 * **Die Faltungsregel selbst bleibt unangetastet**: {@link foldStatus} filtert
 * und sortiert unverändert weiter, nur über einen kleineren Eingang. Der Eimer
 * enthält per Konstruktion genau die Ereignisse, für die `referencesRoot`
 * wahr ist — die Prüfung bleibt trotzdem stehen, damit der Vergleich mit dem
 * alten Pfad Zeile für Zeile zu führen ist.
 */
export const indexStatus = (statusEvents: readonly ForgeEvent[]): RootIndex =>
    indexByRoot(statusEvents, (event) => GIT_STATUS_KINDS.includes(event.kind))

/**
 * Und dasselbe für die PR-Updates (1619) — die dritte Achse derselben Bauart.
 *
 * **Warum sie erst jetzt auffiel:** solange {@link foldStatus} je Wurzel über
 * den Gesamtbestand lief, verdeckte sein Anteil den hier. Nach dem Statusindex
 * blieb `buildPullRequests` als einziger überlinearer Konstruktor stehen,
 * gemessen 25,8 / 87,3 / 287,4 ms bei 400 / 800 / 1600 Wurzeln, während Issues
 * und Patches linear wurden. Ein verdeckter Anteil ist kein abwesender.
 *
 * **Die Berechtigungsprüfung bleibt, wo sie ist.** Sie steht in
 * {@link toPullRequest} und wird hier ausdrücklich NICHT vorgezogen: der Index
 * ist wurzelunabhängig, `allowedActorsForRoot` ist es nicht — ein 1619, das für
 * PR A unzulässig ist, kann für PR B zulässig sein. Wer die Prüfung in den
 * Index zöge, müsste sie je Wurzel erneut fällen und hätte nichts gewonnen
 * ausser einem zweiten Ort, an dem sie steht.
 */
export const indexUpdates = (updateEvents: readonly ForgeEvent[]): RootIndex =>
    indexByRoot(updateEvents, (event) => event.kind === GIT_PR_UPDATE)

/**
 * Die Indizes, die ein Konstruktor an seine Wurzel-Bauer weiterreicht.
 *
 * **Ein Bündel statt weiterer Stellungsparameter.** `toPullRequest` hat schon
 * fünf; drei weitere, alle vom selben Typ und alle optional, wären an der
 * Aufrufstelle nicht mehr auseinanderzuhalten — und eine vertauschte
 * Reihenfolge fiele nirgends auf, weil die Indizes strukturell gleich
 * aussehen. Benannte Felder machen den Fehler unmöglich statt unwahrscheinlich.
 *
 * Alle Felder sind optional: ohne sie verhalten sich die Bauer wie vor dem
 * Index — sie sind weiterhin einzeln aufrufbar (Tests, Einzelabfragen).
 * `updates` nutzt allein {@link toPullRequest}; Issues und Patches kennen
 * keine 1619.
 */
export type ForgeIndex = { notes?: RootIndex; status?: RootIndex; updates?: RootIndex }

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
const notesForRoot = (rootId: string, commentEvents: ForgeEvent[], index?: RootIndex): ForgeEvent[] => {
    // Der Index ist vorsortiert und entdoppelt — dieselbe Liste, nur nicht
    // jedes Mal neu erarbeitet. Ohne ihn bleibt der alte Weg: die Funktion ist
    // weiterhin allein aufrufbar (Tests, Einzelabfragen).
    const gebucht = index?.get(rootId)
    if (gebucht) {
        return [...gebucht]
    }
    if (index) {
        return []
    }

    return commentEvents
        .filter((event) => event.kind === FORGE_COMMENT && referencesRoot(event, rootId))
        .sort((a, b) => a.created_at - b.created_at || a.id.localeCompare(b.id))
}

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
const lastNoteAt = (rootId: string, commentEvents: ForgeEvent[], index?: RootIndex): number => {
    if (index) {
        // Der Eimer ist aufsteigend sortiert — die letzte Regung ist sein Ende.
        const gebucht = index.get(rootId)

        return gebucht && gebucht.length > 0 ? gebucht[gebucht.length - 1].created_at : 0
    }

    return commentEvents.reduce(
        (newest, event) =>
            event.kind === FORGE_COMMENT && referencesRoot(event, rootId)
                ? Math.max(newest, event.created_at)
                : newest,
        0,
    )
}

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
    index?: RootIndex,
): AssignmentState => {
    const allowed = allowedActorsForRoot(root, maintainers)
    const uncausedSelf: AssignmentOperation[] = []
    const authoritative: AssignmentOperation[] = []
    const causalSelf: AssignmentOperation[] = []

    for (const event of notesForRoot(root.id, commentEvents, index)) {
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
    index?: RootIndex,
): ReviewState => {
    const author = root.pubkey.toLowerCase()
    const allowed = allowedActorsForRoot(root, maintainers)
    const notes = notesForRoot(root.id, commentEvents, index)

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

/** Ein Reviewer mit seiner Entscheidung zum aktuellen Commit. */
export type ReviewerRow = {
    pubkey: string
    /** `''` = angefragt, aber noch nicht entschieden. */
    decision: '' | 'approved' | 'changes-requested'
}

/**
 * Die Reviewer-Zeile als LISTE — angefragte Reviewer zuerst, danach jeder, der
 * entschieden hat, ohne angefragt worden zu sein.
 *
 * **Warum das hier steht und nicht als `.some()` im Markup.** Genau diese Frage
 * („hat dieser Reviewer schon?") stand bis zum Nachzug als Alpine-Ausdruck in
 * `⚡forge-repo.blade.php` — dreimal je Zeile, ungetestet, und die zweite Hälfte
 * fehlte ganz: der Repo-Eigentümer darf freigeben, ohne je angefragt worden zu
 * sein ({@link foldReviews}, Regel 2). Er stand damit in KEINEM Chip und tauchte
 * nur in der Zahl daneben auf — zwei Darstellungen desselben Bestands, die
 * auseinanderlaufen. Hier ist es eine Liste, ein Test und eine Wahrheit.
 *
 * Die Reihenfolge ist nicht kosmetisch: wer angefragt wurde, gehört nach vorn,
 * auch wenn er noch nicht entschieden hat — das ist die offene Erwartung, und
 * sie ist die Information, die man auf einer PR-Zeile sucht.
 */
export const reviewerRows = (
    reviewers: readonly string[],
    approvals: readonly ReviewDecision[],
    changeRequests: readonly ReviewDecision[],
): ReviewerRow[] => {
    const decisionOf = new Map<string, ReviewerRow['decision']>()
    for (const decision of changeRequests) {
        decisionOf.set(decision.author, 'changes-requested')
    }
    // Freigaben zuletzt: `foldReviews` behält je Entscheider ohnehin nur EINE
    // Entscheidung, die beiden Listen können sich also gar nicht überschneiden.
    // Die Reihenfolge steht hier trotzdem fest, statt sich auf diese Zusage einer
    // anderen Funktion zu verlassen.
    for (const decision of approvals) {
        decisionOf.set(decision.author, 'approved')
    }

    const rows: ReviewerRow[] = reviewers.map((pubkey) => ({
        pubkey,
        decision: decisionOf.get(pubkey) ?? '',
    }))
    const bekannt = new Set(reviewers)
    for (const [pubkey, decision] of decisionOf) {
        if (!bekannt.has(pubkey)) {
            rows.push({ pubkey, decision })
        }
    }

    return rows
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
export const commentsForRoot = (
    rootId: string,
    commentEvents: ForgeEvent[],
    index?: RootIndex,
): ForgeComment[] =>
    notesForRoot(rootId, commentEvents, index)
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
    index: ForgeIndex = {},
): Issue => {
    const status = foldStatus(root, statusEvents, maintainers, index.status)
    const comments = commentsForRoot(root.id, commentEvents, index.notes)
    // Die ROHE Liste, nicht `comments`: die Faltung braucht genau die Notizen,
    // die `commentsForRoot` gerade herausgeworfen hat.
    const assignments = foldAssignments(root, commentEvents, maintainers, index.notes)

    return {
        id: root.id,
        title: rootTitle(root),
        content: root.content,
        author: root.pubkey.toLowerCase(),
        createdAt: root.created_at,
        updatedAt: Math.max(
            root.created_at,
            status?.created_at ?? 0,
            lastNoteAt(root.id, commentEvents, index.notes),
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
): Issue[] => {
    // EINMAL je Aufruf, nicht je Wurzel (P7 für die Notizen, Restposten P1 für
    // die Statuswechsel). Siehe {@link indexByRoot}.
    const index: ForgeIndex = { notes: indexNotes(commentEvents), status: indexStatus(statusEvents) }

    return issueEvents
        .filter((event) => event.kind === GIT_ISSUE)
        .map((root) => toIssue(root, statusEvents, commentEvents, maintainersOf(tagValue(root, 'a')), index))
        .sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id))
}

// ── Pull Request (1618 + 1619) ──────────────────────────────────────────────

export type PullRequestUpdate = {
    id: string
    author: string
    content: string
    commit: string
    /** `merge-base` dieses Standes — ein Rebase verschiebt ihn (P7/2). */
    mergeBase: string
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
    /**
     * Aktueller Commit: aus dem jüngsten vertrauten 1619, sonst aus dem 1618.
     *
     * **Hier stand bis P7 ein `targetBranch` daneben** (`target-branch`-Tag).
     * Es war per Konstruktion leer: den Tag schreibt weder NIP-34 noch Buzz —
     * `build_git_pull_request` setzt `branch-name`, `merge-base`, `c`, `clone`,
     * `subject`, `t`, `a`, `p`, `r`, `h`, `e`, mehr nicht. Ein Feld, das nie
     * einen Wert hat, ist keine Lücke im Bild, sondern eine falsche Zusage im
     * Modell: die Fläche fragt es ab, bekommt `''` und zeigt „unbekannt", wo
     * gar nichts unbekannt ist.
     *
     * **Was an seine Stelle tritt:** die Basis, nicht der Name. `merge-base`
     * ({@link mergeBase}) benennt den Punkt, gegen den dieser PR gerechnet wird
     * — als Commit-Id und damit prüfbar. Wer trotzdem einen Branch-NAMEN zeigen
     * will, nimmt den des Repos (`default-branch` am 30617, sonst `HEAD` am
     * 30618); das ist eine Auskunft über das Repository, nicht über den PR, und
     * gehört deshalb nicht an dieses Modell.
     */
    commit: string
    /**
     * Jüngster gemeinsamer Vorfahr mit dem Zielbranch (`merge-base`), `''` wenn
     * keiner genannt ist. Aus dem jüngsten vertrauten 1619, sonst aus dem 1618 —
     * dieselbe Regel wie beim Commit, denn ein Rebase verschiebt beides.
     */
    mergeBase: string
    /** Wo dieser PR gelandet ist — leer, solange kein 1631 vorliegt. */
    merge: MergeInfo
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
    index: ForgeIndex = {},
): PullRequest => {
    const allowed = allowedActorsForRoot(root, maintainers)
    const status = foldStatus(root, statusEvents, maintainers, index.status)
    const comments = commentsForRoot(root.id, commentEvents, index.notes)
    // Nur der EINGANG wechselt: der Eimer statt der ganzen Liste. Sieb und
    // Sortierung darunter sind unverändert — auch `referencesRoot`, obwohl der
    // Eimer sie garantiert (siehe {@link indexUpdates}).
    const updateKandidaten = index.updates ? (index.updates.get(root.id) ?? []) : updateEvents
    const updates = updateKandidaten
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
            mergeBase: mergeBaseOf(event),
            createdAt: event.created_at,
        }))
    const newestUpdate = updates[updates.length - 1]
    // Der Commit, auf den der PR HEUTE zeigt. Er steht vor der Faltung fest,
    // weil `foldReviews` ihn braucht: eine Freigabe gilt genau für diesen einen
    // Stand und wird von einem Push danach entwertet.
    const commit = newestUpdate?.commit || tagValue(root, 'c')
    const reviews = foldReviews(root, commentEvents, commit, maintainers, index.notes)

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
            lastNoteAt(root.id, commentEvents, index.notes),
        ),
        repoAddress: tagValue(root, 'a'),
        labels: tagValues(root, 't'),
        status: pullRequestStatusFrom(root, status),
        reviewers: reviews.reviewers,
        approvals: reviews.approvals,
        changeRequests: reviews.changeRequests,
        branch: tagValue(root, 'branch-name'),
        commit,
        // Dieselbe Regel wie beim Commit: der jüngste vertraute Stand gewinnt.
        // Ein Rebase schreibt ein 1619 mit neuem `c` UND neuem `merge-base` —
        // die alte Basis gehört dann zu einem Diff, den es nicht mehr gibt.
        // `||` und nicht `??`: ein 1619 ohne `merge-base` liefert `''`, und dann
        // ist die Angabe der Wurzel die beste vorhandene.
        mergeBase: newestUpdate?.mergeBase || mergeBaseOf(root),
        merge: mergeInfoOf(status),
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
): PullRequest[] => {
    const index: ForgeIndex = {
        notes: indexNotes(commentEvents),
        status: indexStatus(statusEvents),
        updates: indexUpdates(updateEvents),
    }

    return pullRequestEvents
        .filter((event) => event.kind === GIT_PULL_REQUEST)
        .map((root) =>
            toPullRequest(
                root,
                updateEvents,
                statusEvents,
                commentEvents,
                maintainersOf(tagValue(root, 'a')),
                index,
            ),
        )
        .sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id))
}

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
    /**
     * Als was dieser Patch angewandt wurde — aus dem 1631 (P7/2).
     *
     * Beim Patch ist `appliedAsCommits` der Normalfall und `mergeCommit` die
     * Ausnahme: `git am` erzeugt Commits, keinen Merge. Beides steht trotzdem
     * da, weil NIP-34 beides an demselben Kind erlaubt und ein Client, der nur
     * eins liest, den anderen Weg still verschweigt.
     */
    merge: MergeInfo
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
    index: ForgeIndex = {},
): Patch => {
    const status = foldStatus(root, statusEvents, maintainers, index.status)
    const comments = commentsForRoot(root.id, commentEvents, index.notes)
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
        updatedAt: Math.max(root.created_at, status?.created_at ?? 0, lastNoteAt(root.id, commentEvents, index.notes)),
        repoAddress: tagValue(root, 'a'),
        labels,
        status: patchStatusFrom(status),
        commit: tagValue(root, 'commit'),
        parentCommit: tagValue(root, 'parent-commit'),
        merge: mergeInfoOf(status),
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
): Patch[] => {
    const index: ForgeIndex = { notes: indexNotes(commentEvents), status: indexStatus(statusEvents) }

    return patchEvents
        .filter((event) => event.kind === GIT_PATCH)
        .map((root) => toPatch(root, statusEvents, commentEvents, maintainersOf(tagValue(root, 'a')), index))
        .sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id))
}

/** Eine Gruppe gleichartiger Vorgänge, die zu EINEM Repository gehören. */
export type RepoGruppe<T> = {
    /** `30617:<owner>:<d>` — die Identität, an der die Gruppe hängt. */
    address: string
    /** Anzeigename des Repos. */
    name: string
    items: T[]
}

/**
 * Vorgänge nach Repository gruppieren — die Grundlage der workspace-weiten Listen (P3).
 *
 * ── Warum gruppiert und nicht flach ─────────────────────────────────────────
 *
 * Eine flache Liste über alle Repos beantwortet „was liegt offen" und nimmt
 * dabei die Antwort auf „wo" wieder weg: zwanzig Zeilen, jede mit einem
 * Repo-Namen als Präfix, sind zwanzigmal dieselbe Information neben der, die man
 * sucht. Die Gruppe nennt das Repo EINMAL.
 *
 * ── Zwei Regeln, die man beim Nachbauen anders macht ────────────────────────
 *
 * 1. **Die Reihenfolge der Repos kommt von aussen, nicht aus den Vorgängen.**
 *    `buildRepos` sortiert bereits (neueste Ankündigung zuerst); hier noch einmal
 *    zu sortieren hiesse, dieselbe Frage an zwei Orten zu beantworten — und beim
 *    nächsten Mal an einem davon anders. Innerhalb der Gruppe bleibt die
 *    Reihenfolge der Eingabe erhalten (`buildIssues` sortiert nach Bewegung).
 * 2. **Leere Gruppen fallen weg.** Ein Repo ohne Issues ist in einer
 *    Issue-Liste keine Aussage, sondern eine Zeile, die man überliest. Wer die
 *    Null sehen will, sieht sie in der Repo-Liste daneben.
 *
 * Ein Vorgang, dessen `repoAddress` in `repos` nicht vorkommt, fällt heraus —
 * die Aufrufer filtern zwar schon darauf, aber eine Gruppierung, die eine
 * unbekannte Koordinate zu einer namenlosen Gruppe machte, wäre eine stille
 * Einladung für fremde `a`-Tags.
 */
export const gruppiereNachRepo = <T extends { repoAddress: string }>(
    items: readonly T[],
    repos: readonly { address: string; name: string }[],
): RepoGruppe<T>[] => {
    const gruppen = new Map<string, RepoGruppe<T>>()
    for (const repo of repos) {
        gruppen.set(repo.address, { address: repo.address, name: repo.name, items: [] })
    }
    for (const item of items) {
        gruppen.get(item.repoAddress)?.items.push(item)
    }

    return [...gruppen.values()].filter((gruppe) => gruppe.items.length > 0)
}

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
