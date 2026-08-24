/**
 * P6 — die gemischte Zeitleiste der Forge. Rein, ohne Netz, `node --test`-fähig.
 *
 * ── Warum Sätze und keine Ereignisliste ─────────────────────────────────────
 *
 * Buzz' eigene Leitlinie für Aktivitätsfeeds ist „Verb, Objekt, Ergebnis"
 * (`/home/user/Code/buzz/VISION_ACTIVITY.md`): jede Zeile ist ein Satz, den man
 * ohne Entschlüsseln liest — „X hat das Repository angelegt", „Y hat nach master
 * gepusht → ca1c707". Ein Kind-Dump erzwingt Übersetzungsarbeit beim Leser und
 * beantwortet keine der drei Fragen (was, geht es gut, muss ich eingreifen).
 *
 * **Der Text selbst steht NICHT hier.** Dieses Modul liefert Typ und Bausteine
 * (Handelnder, Objekt, Abzeichen); die Formulierung entsteht in der Oberfläche
 * über `__()`. Deutsche Sätze im JS wären an der Übersetzungsschicht vorbei.
 *
 * ── Was NICHT gebaut ist, und warum ─────────────────────────────────────────
 *
 * Buzz Desktop zeigt in derselben Leiste eine Zeile „hat einen Commit gepusht"
 * **mit Commit-Nachricht und Autorname** sowie ein Beitrags-Gitter
 * (Contribution-Heatmap). Beides speist sich dort aus einem echten `git clone`
 * (`useProjectsRepoSnapshots.ts:31-56` → `getProjectLocalRepoSnapshot` /
 * `getProjectRepoSnapshot`, „Remote snapshots are backed by a blobless
 * `git clone` per repository"), nicht aus Nostr. Ein Browser-Client hat weder
 * Checkout noch Git-Transport. Was aus Nostr **wirklich** zu holen ist, ist der
 * Push als solcher: das kind 30618 trägt Zeitpunkt, Ziel-Ref, Commit-Hash und im
 * `p`-Tag den Pusher (Buzz-Erweiterung, `api/git/manifest_event.rs:36-41`:
 * „On push, this is the pusher's pubkey from the receive-pack hook"). Genau so
 * viel behauptet {@link buildActivity} — Hash und Branch ja, Commit-Nachricht
 * nein.
 */
import {
    DELETION,
    FORGE_COMMENT,
    GIT_ISSUE,
    GIT_PATCH,
    GIT_PR_UPDATE,
    GIT_PULL_REQUEST,
    GIT_STATUS_APPLIED,
    GIT_STATUS_CLOSED,
    GIT_STATUS_DRAFT,
    GIT_STATUS_KINDS,
    GIT_STATUS_OPEN,
    REPO_ANNOUNCEMENT,
    REPO_STATE,
    allowedActorsForRoot,
    foldReviews,
    isOperationNote,
    isPubkey,
    operationOf,
    rootTitle,
    tagValue,
    tagValues,
    toRepoState,
    type ForgeEvent,
    type ForgeOperation,
    type Repo,
} from './forgeModels.ts'
import { patchSubject } from './forgeDiff.ts'

/**
 * Die Satzarten der Zeitleiste. Jede entspricht genau einer Formulierung in der
 * Oberfläche — neue Art heißt: neuer Satz, keine stille Einordnung unter
 * „sonstiges".
 */
export type ActivityType =
    | 'repo-created'
    | 'push'
    | 'issue-opened'
    | 'issue-status'
    | 'patch-opened'
    | 'patch-status'
    | 'pr-opened'
    | 'pr-updated'
    | 'pr-status'
    | 'comment'
    /**
     * Die fünf Vorgangsformen (`t`-beschriftete kind 1, siehe
     * `forgeModels.OPERATION_LABELS`). Sie standen bis zum Nachzug am
     * 2026-08-24 als `'comment'` in der Leiste — der Strom sagte „hat
     * kommentiert: Assigned this issue to Bob" und gab damit die Prosa eines
     * fremden Clients als Nutzeräußerung aus.
     */
    | 'assignment'
    | 'unassignment'
    | 'review-request'
    | 'approval'
    | 'changes-requested'

export type ActivityItem = {
    /** Stabil über Neuberechnungen — der `:key` der Liste. */
    id: string
    type: ActivityType
    createdAt: number
    /** Handelnder, kleingeschrieben; `''`, wenn ihn das Ereignis nicht nennt. */
    actor: string
    /** Repo-Koordinate, an der die Zeile hängt. */
    repoAddress: string
    /** Anzeigename des Repos (aufgelöst, sonst die Kennung aus der Koordinate). */
    repoName: string
    /** Das Objekt des Satzes: Issue-/PR-Titel, Branch, Repo-Name. */
    object: string
    /** Zweite Zeile: Beschreibung, Kommentartext — roh, die Fläche kürzt. */
    body: string
    /** Rechtsbündiges Abzeichen: Commit-Kurzhash oder Statuswort-Code. */
    badge: string
    /** Bei Statuszeilen der Code (`open`/`merged`/`closed`/`draft`), sonst `''`. */
    status: string
    /**
     * Die Personen, die der Satz NENNT — nicht der Handelnde.
     *
     * Nur die Vorgangsformen tragen sie: „hat **Bob** zugewiesen". Rohe Pubkeys,
     * kleingeschrieben; die Auflösung zu Namen passiert in `forge.ts`, wie bei
     * jedem anderen Schlüssel dieser Fläche. Optional, weil die grosse Mehrheit
     * der Zeilen niemanden nennt — ein Pflichtfeld hätte an acht Stellen ein
     * leeres Array erzwungen und dort nichts ausgesagt.
     */
    targets?: string[]
}

const SHORT_HASH = 7

const shortCommit = (commit: string): string =>
    /^[0-9a-f]{7,64}$/i.test(commit) ? commit.slice(0, SHORT_HASH) : ''

/**
 * Alle Commits, die dieser Pull Request je getragen hat: das `c` des 1618 und
 * das jedes VERTRAUTEN 1619 (F3).
 *
 * Ein fremdes 1619 zählt nicht — sonst könnte ein Unbeteiligter durch ein
 * erfundenes Update jeden beliebigen Commit nachträglich zu einem „gültigen"
 * Bezugspunkt machen und damit eine unbegründete Freigabe legitimieren. Es ist
 * dieselbe Berechtigungsmenge, die `toPullRequest` für seine Updates nimmt.
 */
const commitsOfPr = (root: ForgeEvent, events: ForgeEvent[], allowed: Set<string>): Set<string> => {
    const commits = new Set<string>()
    const initial = tagValue(root, 'c')
    if (initial) {
        commits.add(initial)
    }
    for (const event of events) {
        if (
            event.kind === GIT_PR_UPDATE &&
            allowed.has(event.pubkey.toLowerCase()) &&
            event.tags.some((tag) => (tag[0] === 'e' || tag[0] === 'E') && tag[1] === root.id)
        ) {
            const commit = tagValue(event, 'c')
            if (commit) {
                commits.add(commit)
            }
        }
    }

    return commits
}

/**
 * Der Titel eines 1617 fuer die Zeitleiste.
 *
 * Ein `subject`-Tag setzt kein bekannter Client an einem Patch — gilt aber,
 * wenn eines da ist. Sonst der `Subject:`-Header aus dem Patch-Text, der
 * RFC-5322-gefaltet sein darf (`forgeDiff.ts`).
 */
const patchTitle = (event: ForgeEvent): string =>
    tagValue(event, 'subject') || patchSubject(event.content)

const statusCodeOf = (kind: number): string => {
    switch (kind) {
        case GIT_STATUS_OPEN:
            return 'open'
        case GIT_STATUS_APPLIED:
            return 'applied'
        case GIT_STATUS_CLOSED:
            return 'closed'
        case GIT_STATUS_DRAFT:
            return 'draft'
        default:
            return ''
    }
}

/**
 * Push-Zeilen aus den 30618 eines Repos.
 *
 * **Ein 30618 ist nicht automatisch ein Push.** Buzz schreibt beim Anlegen eines
 * Repos ein leeres Ref-State-Ereignis (`side_effects.rs:2839`, „Fires once per
 * announce"); am Ziel-Relay stehen deshalb drei 30618 zu einem einzigen echten
 * Push. Gezählt wird nur, was einen Ref **neu setzt oder verschiebt** — die
 * Zeile behauptet sonst eine Handlung, die niemand ausgeführt hat.
 *
 * Ein gelöschter Ref erzeugt bewusst keine Zeile: der Löschvorgang ist am 30618
 * nicht vom „Relay hat den Zustand neu aufgebaut" zu unterscheiden.
 */
const pushItems = (stateEvents: ForgeEvent[], repo: Repo, relaySelf: string): ActivityItem[] => {
    /**
     * **Wer einen Branch-Zustand behaupten darf** (F2, 2026-08-24).
     *
     * Dieselbe Menge wie in `foldRepoState` (`forgeModels.ts:557`): der
     * Repo-Eigentümer und der Relay selbst — bei Buzz schreibt der Relay das
     * 30618, nicht der Mensch. Bis zum 2026-08-24 filterte diese Funktion NUR
     * nach `d`, und der Handelnde kam aus dem `p`-Tag: jedes Relay-Mitglied
     * konnte damit „«Opfer» hat gepusht nach master → deadbee" in die Leiste
     * schreiben. Dasselbe Ereignis wies der Steckbrief daneben korrekt ab — die
     * beiden Flächen widersprachen sich, und die falsche war die auffälligere.
     *
     * Ohne bekanntes `relaySelf` (NIP-11 noch unterwegs, oder kein Buzz) bleibt
     * der Eigentümer übrig. Das ist eng, aber nie falsch — und es ist genau die
     * Auskunft, die `foldRepoState` in derselben Lage gibt.
     */
    const trusted = new Set(
        [repo.owner.toLowerCase(), relaySelf.toLowerCase()].filter((value) => value !== ''),
    )
    const ordered = stateEvents
        .filter(
            (event) =>
                event.kind === REPO_STATE &&
                tagValue(event, 'd') === repo.dtag &&
                trusted.has(event.pubkey.toLowerCase()),
        )
        .sort((a, b) => a.created_at - b.created_at || a.id.localeCompare(b.id))

    const seen = new Map<string, string>()
    const items: ActivityItem[] = []

    for (const event of ordered) {
        const state = toRepoState(event)
        const moved = [...state.branches, ...state.tags].filter(
            (ref) => seen.get(ref.name) !== ref.commit,
        )
        for (const ref of [...state.branches, ...state.tags]) {
            seen.set(ref.name, ref.commit)
        }
        if (moved.length === 0) {
            continue
        }
        // Ein Push kann mehrere Refs bewegen; die Zeile nennt den ersten und
        // zählt den Rest nicht mit — mehr wäre erfunden, weniger unterschlagen.
        const first = moved[0]
        items.push({
            id: `push:${event.id}`,
            type: 'push',
            createdAt: event.created_at,
            actor: state.actor,
            repoAddress: repo.address,
            repoName: repo.name,
            object: first.name,
            body: '',
            badge: shortCommit(first.commit),
            status: '',
        })
    }

    return items
}

export type ActivityInput = {
    /** Die sichtbaren Repos — sie liefern Namen und begrenzen den Bestand. */
    repos: Repo[]
    /** Rohe Ereignisse: 30617, 30618, 1621, 1617, 1618, 1619, 1630–1633, 1. */
    events: ForgeEvent[]
    /**
     * Der Pubkey des Relays aus NIP-11 (`self`) — er signiert die 30618.
     *
     * Optional, weil er beim ersten Aufbau noch fehlt; dann bleibt als
     * vertrauenswürdiger Absender nur der Repo-Eigentümer übrig. Siehe
     * {@link pushItems}.
     */
    relaySelf?: string
}

/**
 * Die gemischte Zeitleiste, neueste zuerst.
 *
 * **Was nicht zu einem bekannten Repo gehört, fällt raus.** Ein `a`-Tag auf ein
 * Repo, das wir nicht sehen, ergäbe eine Zeile über ein Objekt ohne Namen; und
 * ein Fremder könnte die Leiste mit Ereignissen auf beliebige Koordinaten
 * fluten. Ausnahme sind die 30617/30618 selbst — sie tragen kein `a`, sie SIND
 * das Repo.
 */
export const buildActivity = ({ repos, events, relaySelf = '' }: ActivityInput): ActivityItem[] => {
    const byAddress = new Map(repos.map((repo) => [repo.address, repo]))
    const roots = new Map<string, ForgeEvent>()
    for (const event of events) {
        if (event.kind === GIT_ISSUE || event.kind === GIT_PULL_REQUEST || event.kind === GIT_PATCH) {
            roots.set(event.id, event)
        }
    }

    const nameOf = (address: string): string => byAddress.get(address)?.name ?? ''
    /** Je Wurzel die Menge, die eine Freigabe aussprechen darf — siehe unten. */
    const trustedByRoot = new Map<string, Set<string>>()
    /** Je PR-Wurzel alle Commits, die sie je getragen hat — siehe F3 unten. */
    const commitsByRoot = new Map<string, Set<string>>()
    const items: ActivityItem[] = []

    for (const repo of repos) {
        items.push({
            id: `repo:${repo.eventId}`,
            type: 'repo-created',
            createdAt: repo.createdAt,
            actor: repo.owner,
            repoAddress: repo.address,
            repoName: repo.name,
            object: repo.name,
            body: repo.description,
            badge: '',
            status: '',
        })
        items.push(...pushItems(events, repo, relaySelf))
    }

    for (const event of events) {
        const repoAddress = tagValue(event, 'a')
        if (event.kind === REPO_ANNOUNCEMENT || event.kind === REPO_STATE || event.kind === DELETION) {
            continue
        }

        if (event.kind === GIT_ISSUE || event.kind === GIT_PULL_REQUEST || event.kind === GIT_PATCH) {
            if (!byAddress.has(repoAddress)) {
                continue
            }
            const istPatch = event.kind === GIT_PATCH
            items.push({
                id: `root:${event.id}`,
                type: istPatch ? 'patch-opened' : event.kind === GIT_ISSUE ? 'issue-opened' : 'pr-opened',
                createdAt: event.created_at,
                actor: event.pubkey.toLowerCase(),
                repoAddress,
                repoName: nameOf(repoAddress),
                // Ein 1617 trägt kein `subject`-Tag; sein Titel steht im
                // `Subject:`-Header des Patch-Textes. `rootTitle` fiele sonst
                // auf die erste Inhaltszeile zurück — und die lautet bei jedem
                // `git format-patch` „From <sha> Mon Sep 17 00:00:00 2001".
                object: istPatch ? patchTitle(event) : rootTitle(event),
                // Der ROHE Patchtext gehört nicht in die Zeitleiste: `body` ist
                // die zweite Zeile einer Aktivitätszeile, und ein Diff darin
                // wäre unlesbarer Zeichensalat. Statt dessen die Kennzahlen.
                body: istPatch ? '' : event.content,
                badge: istPatch
                    ? shortCommit(tagValue(event, 'commit') || tagValue(event, 'c'))
                    : event.kind === GIT_PULL_REQUEST
                      ? shortCommit(tagValue(event, 'c'))
                      : '',
                status: '',
            })
            continue
        }

        // Ab hier hängt alles an einer Wurzel: PR-Update, Statuswechsel,
        // Kommentar. Ohne auflösbare Wurzel gibt es keinen Satz — „jemand hat
        // etwas kommentiert" ist keine Information, sondern Rauschen.
        //
        // **ALLE auflösbaren Wurzeln, nicht die erste** (F5, 2026-08-24). Hier
        // stand `.find(…)`, während jede Faltung mit `referencesRoot` arbeitet
        // und damit JEDES `e`/`E` gelten lässt (ebenso Buzz,
        // `projectIssues.mjs:107-110`). Eine Notiz mit zwei `e`-Tags wirkte
        // deshalb in der Faltung auf beide Wurzeln, in der Leiste aber nur auf
        // die erste — die zweite bekam ihre Zeile nie, und ein Fremder konnte
        // durch Voranstellen eines fremden `e` bestimmen, an welcher Wurzel sein
        // Beitrag erscheint. Entdoppelt über die Id, damit ein zweifach
        // genanntes `e` keine zwei Zeilen ergibt.
        const rootIds = new Set(
            event.tags
                .filter((tag) => tag[0] === 'e' || tag[0] === 'E')
                .map((tag) => tag[1] ?? '')
                .filter((id) => roots.has(id)),
        )
        //
        // **Jede Zeile im inneren Lauf ist wurzel-qualifiziert** (`…:${root.id}`).
        // Dieselbe Notiz kann an zwei Wurzeln hängen und ergibt dann zwei Zeilen;
        // mit einem gemeinsamen Schlüssel verwirft `x-for` die zweite still — und
        // still ist genau die Eigenschaft, die man hier nicht will. Beim Bau
        // zuerst nur an der Vorgangszeile gesetzt und vom Test aufgedeckt.
        for (const rootId of rootIds) {
        const root = roots.get(rootId) as ForgeEvent
        const rootAddress = tagValue(root, 'a')
        if (!byAddress.has(rootAddress)) {
            continue
        }
        const isPr = root.kind === GIT_PULL_REQUEST
        const isPatch = root.kind === GIT_PATCH

        if (event.kind === GIT_PR_UPDATE) {
            // Dieselbe Berechtigungsprüfung wie bei den Statuswechseln: ein
            // fremdes 1619 darf den PR nicht auf einen anderen Commit umbiegen.
            if (
                !isPr ||
                !allowedActorsForRoot(root, byAddress.get(rootAddress)?.maintainers ?? []).has(
                    event.pubkey.toLowerCase(),
                )
            ) {
                continue
            }
            items.push({
                id: `update:${event.id}:${root.id}`,
                type: 'pr-updated',
                createdAt: event.created_at,
                actor: event.pubkey.toLowerCase(),
                repoAddress: rootAddress,
                repoName: nameOf(rootAddress),
                object: isPatch ? patchTitle(root) : rootTitle(root),
                body: event.content,
                badge: shortCommit(tagValue(event, 'c')),
                status: '',
            })
            continue
        }

        if (GIT_STATUS_KINDS.includes(event.kind)) {
            // Seit dem 2026-08-23 zählen auch die `maintainers` des Repos — NIP-34 erklärt
            // ihren Statuswechsel für gültig, und `byAddress` hat das Repo ohnehin schon
            // in der Hand (die Zeile darüber prüft mit ihm die Zugehörigkeit).
            if (
                !allowedActorsForRoot(root, byAddress.get(rootAddress)?.maintainers ?? []).has(
                    event.pubkey.toLowerCase(),
                )
            ) {
                continue
            }
            items.push({
                id: `status:${event.id}:${root.id}`,
                type: isPr ? 'pr-status' : isPatch ? 'patch-status' : 'issue-status',
                createdAt: event.created_at,
                actor: event.pubkey.toLowerCase(),
                repoAddress: rootAddress,
                repoName: nameOf(rootAddress),
                object: isPatch ? patchTitle(root) : rootTitle(root),
                body: event.content,
                badge: '',
                status: statusCodeOf(event.kind),
            })
            continue
        }

        if (event.kind === FORGE_COMMENT) {
            // **Die Frage „ist das ein Gespräch?" wird mit DEMSELBEN Prädikat
            // gestellt wie in `commentsForRoot` — `isOperationNote`, nicht
            // `operationOf(…) === ''`.** Die beiden sind nicht dasselbe: eine
            // Notiz mit `assignment` UND `unassignment` trägt Vorgangslabel
            // (also kein Gespräch), lässt sich aber keinem Satz zuordnen.
            // Über `operationOf` gefragt, wäre sie hier als Kommentar
            // durchgerutscht, während `commentsForRoot` sie ausschliesst —
            // genau die Asymmetrie, die dieser Nachzug beseitigt. Erst beim
            // Test aufgefallen, nicht beim Schreiben.
            const operation = operationOf(event)

            // ── Der gewöhnliche Gesprächsbeitrag ────────────────────────────
            if (!isOperationNote(event)) {
                items.push({
                    id: `comment:${event.id}:${root.id}`,
                    type: 'comment',
                    createdAt: event.created_at,
                    actor: event.pubkey.toLowerCase(),
                    repoAddress: rootAddress,
                    repoName: nameOf(rootAddress),
                    object: isPatch ? patchTitle(root) : rootTitle(root),
                    body: event.content,
                    badge: '',
                    status: '',
                })
                continue
            }

            // Beschriftet, aber nicht eindeutig einzuordnen ({@link operationOf}
            // ist dort strenger als Buzz). Kein Gespräch, kein benennbarer
            // Vorgang — also kein Satz, statt einen zu erfinden.
            if (operation === '') {
                continue
            }

            // ── Vorgangsformen: eigener Satz, gleiche Vertrauensprüfung ─────
            //
            // **Warum sie NICHT einfach unterdrückt werden.** Die naheliegende
            // Reparatur wäre `continue` — sie sind ja keine Kommentare. Aber
            // dieser Strom beantwortet „was ist hier passiert", und eine
            // Zuweisung ist genau das. Sie herauszuwerfen hiesse, dieselbe
            // Fläche auf die andere Art falsch zu machen: aus einem falschen
            // Satz würde eine Lücke, und eine Lücke sieht man nicht. Sie fliegen
            // aus `comments` (dort sind sie kein Gesprächsbeitrag) und bleiben
            // hier (hier sind sie ein Vorgang) — dasselbe Ereignis, zwei
            // Fragen, zwei Antworten.
            //
            // **Und warum sie durch dieselbe Prüfung müssen wie ein
            // Statuswechsel.** Ein `["t","approval"]` ist ein gewöhnliches
            // kind 1; der Relay prüft daran nichts. Ohne Riegel könnte jeder
            // Fremde die Leiste mit „X hat freigegeben" füllen, während die
            // PR-Zeile daneben (aus {@link foldReviews}) nichts davon anerkennt.
            // Genau diese Schere ist der Grund, warum die Prüfung hier steht und
            // nicht nur in der Faltung.
            const signer = event.pubkey.toLowerCase()
            const allowed = allowedActorsForRoot(root, byAddress.get(rootAddress)?.maintainers ?? [])
            const genannte = tagValues(event, 'p').map((value) => value.toLowerCase())
            /** Nur bei Freigabe/Einspruch belegt — der Commit, für den sie gilt (F3). */
            let entscheidungsCommit = ''

            if (operation === 'assignment' || operation === 'unassignment') {
                // Dieselbe Regel wie `foldAssignments`: autoritativ oder
                // Selbstbedienung mit genau einem `p`, und der ist der Signierer.
                const selbst = genannte.length === 1 && genannte[0] === signer
                if (!allowed.has(signer) && !selbst) {
                    continue
                }
            } else if (operation === 'review-request') {
                if (!allowed.has(signer)) {
                    continue
                }
            } else {
                // ── Freigabe / Einspruch ────────────────────────────────────
                //
                // **F4 (2026-08-24): NUR an einem Pull Request.** `foldReviews`
                // wird ausschliesslich aus `toPullRequest` gerufen; ein Issue
                // und ein Patch kennen gar keine Reviewer. Die Leiste rannte
                // hier auch über Issue- und Patch-Wurzeln und erfand damit eine
                // Freigabe für ein Objekt, das keine haben kann — die Zeile
                // hatte auf der Detailfläche kein Gegenstück.
                if (!isPr) {
                    continue
                }
                // Reviewer oder berechtigter Akteur, nie der Autor der Wurzel
                // selbst — `trustedReviewActors` bei Buzz.
                //
                // Die Reviewer-Menge hängt nicht am Commit, deshalb reicht ein
                // `foldReviews(..., '')`: es kehrt vor der Entscheidungsschleife
                // um. Gemerkt je Wurzel, sonst liefe die Faltung einmal PRO
                // Notiz über den gesamten Bestand.
                const autor = root.pubkey.toLowerCase()
                let vertraut = trustedByRoot.get(root.id)
                if (!vertraut) {
                    vertraut = new Set(foldReviews(root, events, '').reviewers)
                    for (const actor of allowed) {
                        if (actor !== autor) {
                            vertraut.add(actor)
                        }
                    }
                    trustedByRoot.set(root.id, vertraut)
                }
                if (!vertraut.has(signer) || signer === autor) {
                    continue
                }
                // ── F3 (2026-08-24): der Commit gehört zur Aussage ───────────
                //
                // `foldReviews` verlangt zusätzlich, dass sich die Entscheidung
                // auf den AKTUELLEN Commit bezieht; die Leiste prüfte das nicht.
                // Ergebnis: die PR-Zeile zählte null Freigaben, während die
                // Leiste „hat freigegeben" sagte — genau das Häkchen für
                // ungesehenen Code, das der Docblock an {@link foldReviews}
                // ausschliessen will.
                //
                // **Von den zwei zulässigen Fixen ist dies BEIDES, und das ist
                // eine Entscheidung, keine Unentschlossenheit:**
                //
                //  1. *Nie gültig* — die Notiz nennt einen Commit, der an diesem
                //     PR nie stand. Dafür gibt es keine historische Lesart; so
                //     eine Zeile ist nicht „veraltet", sie ist unbegründet. Sie
                //     fällt heraus.
                //  2. *Nachträglich entwertet* — die Notiz galt für einen Stand,
                //     den ein späterer Push abgelöst hat. Das IST Historie, und
                //     eine Leiste ist eine Chronik: die Zeile bleibt, trägt aber
                //     den Commit als Abzeichen, damit ein Leser sie einordnen
                //     kann. Bis heute stand dort `badge: ''`, also gar nichts.
                //
                // Die Unterscheidung ist billig: `commitsOfPr` sammelt einmal je
                // Wurzel alle Commits, die dieser PR je getragen hat (1618 plus
                // jedes vertraute 1619).
                const bezug = tagValue(event, 'c') || tagValue(root, 'c')
                let bekannt = commitsByRoot.get(root.id)
                if (!bekannt) {
                    bekannt = commitsOfPr(root, events, allowed)
                    commitsByRoot.set(root.id, bekannt)
                }
                if (!bekannt.has(bezug)) {
                    continue
                }
                entscheidungsCommit = bezug
            }

            items.push({
                // **Wurzel-qualifiziert** (F5): dieselbe Notiz kann über zwei
                // `e`-Tags an zwei Wurzeln hängen, und zwei Zeilen brauchen zwei
                // Schlüssel — sonst verwirft `x-for` die zweite still.
                id: `operation:${event.id}:${root.id}`,
                type: operation,
                createdAt: event.created_at,
                actor: signer,
                repoAddress: rootAddress,
                repoName: nameOf(rootAddress),
                object: isPatch ? patchTitle(root) : rootTitle(root),
                // Der Rumpf einer Vorgangsnotiz ist die Prosa eines FREMDEN
                // Clients („Assigned this issue to …") — auf Englisch, neben
                // einem deutschen Satz, der dasselbe schon sagt. Genau dieser
                // Text war der sichtbare Teil des Fehlers; er kommt nicht als
                // zweite Zeile zurück.
                body: '',
                // Bei einer Freigabe der Commit, für den sie gilt — siehe F3.
                // Bei allem anderen leer.
                badge: entscheidungsCommit === '' ? '' : shortCommit(entscheidungsCommit),
                status: '',
                // **F1: nur Schlüssel.** Ein `["p","Bob"]` lief bis zum
                // 2026-08-24 bis in `npubEncode` und riss die ganze Insel mit;
                // der Riegel stand in `foldAssignments` und war beim Bau dieser
                // Fläche nicht mitgenommen worden.
                targets: genannte.filter(isPubkey),
            })
        }
        }
    }

    return items.sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id))
}
