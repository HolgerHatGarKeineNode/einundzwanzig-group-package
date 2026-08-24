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
const pushItems = (stateEvents: ForgeEvent[], repo: Repo): ActivityItem[] => {
    const ordered = stateEvents
        .filter((event) => event.kind === REPO_STATE && tagValue(event, 'd') === repo.dtag)
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
export const buildActivity = ({ repos, events }: ActivityInput): ActivityItem[] => {
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
        items.push(...pushItems(events, repo))
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
        const root = event.tags
            .filter((tag) => tag[0] === 'e' || tag[0] === 'E')
            .map((tag) => roots.get(tag[1] ?? ''))
            .find((candidate): candidate is ForgeEvent => candidate !== undefined)
        if (!root) {
            continue
        }
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
                id: `update:${event.id}`,
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
                id: `status:${event.id}`,
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
                    id: `comment:${event.id}`,
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
                // Freigabe / Einspruch: Reviewer oder berechtigter Akteur, nie
                // der Autor der Wurzel selbst — `trustedReviewActors` bei Buzz.
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
            }

            items.push({
                id: `operation:${event.id}`,
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
                badge: '',
                status: '',
                targets: genannte,
            })
        }
    }

    return items.sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id))
}
