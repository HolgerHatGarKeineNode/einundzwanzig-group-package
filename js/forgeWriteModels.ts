/**
 * P8 — die **reine** Hälfte der Forge-Schreibrichtung: Ereignisse bauen,
 * Berechtigungen entscheiden, den optimistischen Eintrag führen.
 *
 * Kein Netz, kein Store, keine welshman-Importe, relative Importe mit `.ts` —
 * damit `node --experimental-strip-types --test forgeWriteModels.test.ts` das
 * Modul lädt. Alles Netznahe steht in `forgeWrite.ts`.
 *
 * ── Am laufenden Relay gemessen, nicht angenommen (2026-08-17, Teststack) ────
 *
 * Bevor hier eine Zeile stand, wurde geprüft, ob ein **normales Mitglied** (der
 * geseedete Nicht-Admin, nicht der Owner) die drei Aktionen überhaupt ausführen
 * darf. Ergebnis, je mit anschließendem Rücklesen über `nak req`:
 *
 * | Aktion                                     | Verdikt   | zurückgelesen |
 * |--------------------------------------------|-----------|---------------|
 * | 1621 mit `#a` auf fremdes Repo, MIT `h`     | success   | ja            |
 * | 1621 mit `#a` auf fremdes Repo, OHNE `h`    | success   | ja            |
 * | kind 1 mit `#a`+`#e`, mit und ohne `h`      | success   | ja            |
 * | 1630/1632 auf das EIGENE Issue              | success   | ja            |
 * | 1632 auf ein FREMDES Issue                  | success   | ja            |
 * | 1111 (NIP-22) als Gegenprobe                | **failed**: `restricted: unknown event kind` |
 *
 * Zwei Folgen, und beide bestimmen den Aufbau hier:
 *
 * 1. **Das Relay prüft bei 1630–1633 GAR NICHTS.** Ein Fremder darf ein
 *    `closed` auf ein beliebiges Issue schreiben, und der Relay quittiert mit
 *    `success`. Der einzige Riegel ist die clientseitige Faltung
 *    (`allowedActorsForRoot`) — und weil sie clientseitig ist, wäre ein Knopf,
 *    der Unberechtigten ein Status-Ereignis schreiben lässt, ein **stiller
 *    Leerlauf**: Relay sagt ja, kein Client zeigt es je an. Deshalb entscheidet
 *    {@link statusGate} VOR dem Absenden, nicht danach.
 * 2. **Kein `h`-Tag.** Beide Formen kommen durch; Buzz Desktop schreibt seine
 *    Issues, Kommentare und Statuswechsel ohne `h`
 *    (`features/projects/projectIssues.mjs:245`, `hooks.ts:419`,
 *    `pullRequestReviews.ts:78`). Ein `h` machte unsere Ereignisse
 *    kanal-gescopet und damit für Leser sichtbar, für die dieselbe Zeile aus
 *    Buzz Desktop sichtbar bleibt — zwei Clients, zwei Wahrheiten. Wir folgen
 *    dem Referenzclient.
 *
 * ── Die Falle, die man einmal tritt ─────────────────────────────────────────
 *
 * **`OK true` ist keine Zusage, dass die Aktion WIRKT.** Keines der drei
 * Ereignisse ist ersetzbar, der bekannte NIP-01-Fall greift also nicht direkt —
 * die gleiche Falle hat aber eine zweite Tür: `foldStatus` behält je Wurzel
 * genau EIN Status-Ereignis, das neueste, bei Gleichstand das mit der kleineren
 * Id. Zwei Statuswechsel in derselben Sekunde sind ein Münzwurf. Deshalb
 * stempelt {@link nextCreatedAt} jeden Statuswechsel mindestens eine Sekunde
 * über den bisher geltenden — dieselbe Vorsichtsmaßnahme wie im Referenzclient
 * (`nextProjectPullRequestStatusCreatedAt`) — und `forgeWrite.ts` prüft danach
 * am gefalteten Ergebnis NACH, ob die eigene Fassung wirklich steht.
 */
import { allowedActorsFor, parseRepoAddress } from './forgeModels.ts'

// ── Kinds der Schreibrichtung ───────────────────────────────────────────────

/** NIP-34 Issue (1621) — die einzige Wurzel, die ein Browser-Client anlegen kann. */
export const GIT_ISSUE_KIND = 1621
/** Kommentar an Issue **und** PR: kind 1, nicht 1111 (siehe Modulkopf). */
export const FORGE_COMMENT_KIND = 1

/**
 * Die Lebenszyklus-Zustände, die diese Fläche **setzen** kann.
 *
 * `draft` (1633) fehlt bewusst: bei einem Issue benennt es nichts, was ein
 * Leser unterscheiden könnte — im Referenzclient ist „Draft" eine
 * PR-Eigenschaft, die der Autor beim Anlegen mitgibt. Ein Zustand, den die
 * Fläche anbietet und niemand deuten kann, ist schlechter als sein Fehlen.
 * Gelesen wird 1633 trotzdem (`issueStatusFrom`), nur nicht geschrieben.
 */
export type WritableIssueStatus = 'open' | 'resolved' | 'closed'

const STATUS_KINDS: Record<WritableIssueStatus, number> = {
    open: 1630,
    resolved: 1631,
    closed: 1632,
}

/** Statuscode → Kind. `0` bei allem, was nicht setzbar ist (auch `draft`). */
export const statusKindFor = (status: string): number =>
    STATUS_KINDS[status as WritableIssueStatus] ?? 0

/** Die setzbaren Zustände in Anzeigereihenfolge. */
export const WRITABLE_ISSUE_STATUSES: readonly WritableIssueStatus[] = ['open', 'resolved', 'closed']

// ── Grenzen ─────────────────────────────────────────────────────────────────

/**
 * Höchstlänge des Issue-Titels.
 *
 * 256 wie im Referenzclient (`projectIssues.mjs:261`) — und darunter liegt die
 * echte Grenze des Relays: `max_string_len: 512` aus dem NIP-11 des Teststacks
 * gilt für jeden Tag-Wert. Wer den Titel bis 512 zuließe, bekäme die Ablehnung
 * erst vom Relay, und Buzz Desktop zeigte den Titel dann trotzdem gekürzt.
 */
export const ISSUE_TITLE_MAX = 256
/**
 * Höchstlänge von Rumpf und Kommentar.
 *
 * `max_content_len: 65536` steht im NIP-11 des Relays; hier bewusst darunter,
 * damit die Fläche die Grenze zieht und nicht der Relay mit einer englischen
 * Meldung.
 */
export const FORGE_BODY_MAX = 32_000

// ── Entwurfsprüfung ─────────────────────────────────────────────────────────

/**
 * Was an einem Entwurf nicht stimmt — `''` heißt „in Ordnung".
 *
 * Codes statt Sätze: die Fläche übersetzt sie, dieses Modul bleibt sprachfrei
 * (dieselbe Trennung wie zwischen `forgeActivity.ts` und `forge.ts`).
 */
export type DraftProblem = '' | 'title-required' | 'title-too-long' | 'body-required' | 'body-too-long' | 'target-invalid'

const HEX64 = /^[0-9a-f]{64}$/i

/** Ist das eine brauchbare Repo-Koordinate mit auflösbarem Eigentümer? */
const repoOk = (repoAddress: string): boolean => parseRepoAddress(repoAddress) !== null

/** Der Entwurf eines neuen Issues. Titel ist Pflicht, der Rumpf nicht. */
export const issueDraftProblem = (
    { title, body }: { title: string; body: string },
    repoAddress: string,
): DraftProblem => {
    if (!repoOk(repoAddress)) {
        return 'target-invalid'
    }
    const subject = title.trim()
    if (subject.length === 0) {
        return 'title-required'
    }
    if (subject.length > ISSUE_TITLE_MAX) {
        return 'title-too-long'
    }

    return body.trim().length > FORGE_BODY_MAX ? 'body-too-long' : ''
}

/** Der Entwurf eines Kommentars. Inhalt ist Pflicht, ein leerer wäre Rauschen. */
export const commentDraftProblem = (
    content: string,
    { rootId, repoAddress }: { rootId: string; repoAddress: string },
): DraftProblem => {
    if (!repoOk(repoAddress) || !HEX64.test(rootId)) {
        return 'target-invalid'
    }
    const body = content.trim()
    if (body.length === 0) {
        return 'body-required'
    }

    return body.length > FORGE_BODY_MAX ? 'body-too-long' : ''
}

// ── Berechtigung ────────────────────────────────────────────────────────────

/**
 * Warum jemand nicht darf. `'ok'` heißt: darf.
 *
 * - `anonymous` — niemand angemeldet, es gibt keinen Signer.
 * - `not-actor` — angemeldet, aber für DIESE Wurzel nicht zuständig.
 */
export type WriteGateReason = 'ok' | 'anonymous' | 'not-actor'

export type WriteGate = { allowed: boolean; reason: WriteGateReason }

const ALLOWED: WriteGate = { allowed: true, reason: 'ok' }
const ANONYMOUS: WriteGate = { allowed: false, reason: 'anonymous' }
const NOT_ACTOR: WriteGate = { allowed: false, reason: 'not-actor' }

/**
 * Darf dieser Betrachter ein Issue anlegen oder kommentieren?
 *
 * **Angemeldet sein genügt — und das ist eine Messung, keine Annahme.** Der
 * Relay ist `restricted_writes: true` **und** `auth_required: true`; ein
 * Nicht-Mitglied scheitert schon am AUTH (`restricted: not a relay member`) und
 * bekommt danach `auth-required: not authenticated` auf jedes EVENT. Es kann
 * dann aber auch nichts LESEN — wer die Forge-Fläche überhaupt gefüllt sieht,
 * ist Mitglied. Eine zusätzliche Mitgliedsprüfung im Client wäre also eine
 * zweite Wahrheit über dieselbe Sache, und die falsche von beiden gewönne
 * irgendwann.
 */
export const memberGate = (viewer: string): WriteGate => (HEX64.test(viewer) ? ALLOWED : ANONYMOUS)

/**
 * Wer den Lebenszyklus einer Wurzel bestimmen darf — als **Zeile**, nicht als
 * Ereignis.
 *
 * Dieselbe Regel wie {@link allowedActorsForRoot} in `forgeModels.ts`, nur mit
 * den Feldern, die die Anzeigeschicht ohnehin führt (`author`, `repoAddress`).
 * Die Regel selbst steht genau einmal, dort.
 */
export const statusGate = (
    viewer: string,
    root: { author: string; repoAddress: string },
): WriteGate => {
    if (!HEX64.test(viewer)) {
        return ANONYMOUS
    }

    return allowedActorsFor(root).has(viewer.toLowerCase()) ? ALLOWED : NOT_ACTOR
}

// ── Zeitstempel ─────────────────────────────────────────────────────────────

/**
 * Wie weit ein Zeitstempel höchstens in die Zukunft geschoben wird.
 *
 * Ohne Deckel wäre der Bump ein Hebel für Fremde: der Relay prüft bei 1630–1633
 * **keine** Berechtigung, ein beliebiges Mitglied kann also ein Status-Ereignis
 * mit einem Stempel in der Zukunft hinlegen und jeden folgenden Wechsel zwingen,
 * es zu überbieten — unsere Fläche schriebe dann selbst in die Zukunft.
 *
 * **Wie weit „Zukunft" überhaupt reicht, ist gemessen, nicht der Spec entnommen**
 * (Teststack, 2026-08-17): der Relay nimmt `created_at` bis etwa **±900 s** um
 * seine eigene Uhr an — `+900` kam durch, `+1000` wurde mit
 * `invalid: event timestamp too far from server time` abgelehnt, rückwärts `−120`
 * durch und `−3600` abgelehnt. Das NIP-11-Feld `max_not_before_delta: 31536000`
 * beschreibt also **nicht** dieses Fenster; wer danach ginge, baute einen Test,
 * der am Relay scheitert (genau so passiert).
 *
 * Der Hebel ist damit auf eine Viertelstunde begrenzt, und dieser Deckel liegt
 * bequem darin: bei Überschreitung bleibt der Stempel bei `now`, der Wechsel
 * setzt sich nicht durch, und die Nachprüfung in `forgeWrite.ts` sagt das
 * ehrlich, statt Erfolg zu behaupten.
 */
export const MAX_CREATED_AT_BUMP = 60

/**
 * Ein `created_at`, das echt über `previous` liegt — solange das ehrlich bleibt.
 *
 * Nostr-Zeitstempel sind ganze Sekunden. Zwei Statuswechsel innerhalb derselben
 * Sekunde landen in `foldStatus` im Id-Tiebreak — ein Münzwurf, bei dem der
 * ÄLTERE Zustand gewinnen kann. Derselbe Griff wie im Referenzclient
 * (`nextProjectPullRequestStatusCreatedAt`, `nextProjectIssueCommentCreatedAt`),
 * nur mit dem Deckel aus {@link MAX_CREATED_AT_BUMP}.
 */
export const nextCreatedAt = (now: number, previous: number): number =>
    previous + 1 - now > MAX_CREATED_AT_BUMP ? now : Math.max(now, previous + 1)

// ── Tag-Bau ─────────────────────────────────────────────────────────────────

/**
 * Tags eines neuen Issues (1621).
 *
 * Form 1:1 wie `buildGitIssueTags` im Referenzclient: `a` auf das Repo, `p` auf
 * dessen Eigentümer (damit es in seiner Inbox auftaucht), `subject` als Titel.
 * Der Eigentümer wird NICHT vom Aufrufer geglaubt, sondern aus der Koordinate
 * gelesen — eine `p`-Zeile, die auf jemand anderen zeigt als das `a`, wäre eine
 * Falschaussage, die kein Leser prüft.
 */
export const buildIssueTags = (repoAddress: string, title: string): string[][] => {
    const owner = parseRepoAddress(repoAddress)?.owner ?? ''
    const tags: string[][] = [['a', repoAddress]]
    if (owner) {
        tags.push(['p', owner])
    }
    tags.push(['subject', title.trim()])

    return tags
}

/**
 * Empfänger eines Kommentars oder Statuswechsels: Repo-Eigentümer und Autor der
 * Wurzel, kleingeschrieben, ohne Dopplung und ohne Leerwerte.
 */
const recipientsFor = (repoAddress: string, rootAuthor: string): string[] => {
    const owner = parseRepoAddress(repoAddress)?.owner ?? ''

    return [...new Set([owner, rootAuthor.toLowerCase()])].filter((pk) => HEX64.test(pk))
}

/**
 * Tags eines Kommentars (kind 1) an Issue ODER Pull Request.
 *
 * `["e", rootId, "", "root"]` — der Marker ist die vierte Stelle, nicht die
 * dritte; die dritte ist der Relay-Hinweis und bleibt leer. `commentsForRoot`
 * liest nur `tag[1]`, Buzz Desktop wertet den Marker aus.
 */
export const buildCommentTags = (repoAddress: string, rootId: string, rootAuthor: string): string[][] => [
    ['e', rootId, '', 'root'],
    ['a', repoAddress],
    ...recipientsFor(repoAddress, rootAuthor).map((pk) => ['p', pk]),
]

/**
 * Tags eines Statuswechsels (1630/1631/1632). Gleiche Form wie der Kommentar —
 * die Aussage steckt im Kind, nicht in den Tags.
 */
export const buildStatusTags = (repoAddress: string, rootId: string, rootAuthor: string): string[][] =>
    buildCommentTags(repoAddress, rootId, rootAuthor)

// ── Optimistischer Eintrag ──────────────────────────────────────────────────

/**
 * Was gerade unterwegs ist — oder unterwegs WAR und gescheitert ist.
 *
 * ── Warum es diesen Merker überhaupt braucht ────────────────────────────────
 *
 * welshman zeigt den optimistischen Eintrag von selbst: `publishThunk` legt das
 * Ereignis synchron in den `repository` und trägt die Ziel-URL im `tracker` ein
 * (`@welshman/app/…/thunk.js:174-178`), und `deriveEventsForUrl` liest genau
 * diese Kombination — die Zeile steht also da, bevor der Relay antwortet.
 *
 * Bei einem Fehlschlag ruft welshman `tracker.removeRelay(id, url)`
 * (`thunk.js:100,108,113`) und die Zeile **verschwindet wieder** — lautlos.
 * Genau das ist zu wenig: „war da, ist weg" ist für den Schreibenden nicht von
 * „hat nie funktioniert" zu unterscheiden. Dieser Merker hält den Eintrag über
 * den Fehlschlag hinaus fest, samt Begründung des Relays, und die Fläche zeigt
 * ihn als fehlgeschlagen an.
 */
export type PendingWrite = {
    /** Die Ereignis-Id — schon vor dem Signieren bekannt (`prep` hasht). */
    id: string
    what: 'issue' | 'comment' | 'status'
    state: 'sending' | 'failed'
    /** Begründung des Relays, nur bei `failed` gefüllt. */
    error: string
    repoAddress: string
    /** Wurzel, an der es hängt — `''` beim Issue (es IST die Wurzel). */
    rootId: string
    /** Titel (Issue) bzw. Zielzustand (Status); leer beim Kommentar. */
    label: string
    content: string
    author: string
    createdAt: number
}

/** Einen Eintrag aufnehmen. Eine Id kommt nie zweimal vor. */
export const addPending = (list: readonly PendingWrite[], entry: PendingWrite): PendingWrite[] => [
    ...list.filter((item) => item.id !== entry.id),
    entry,
]

/** Einen Eintrag als gescheitert markieren — mit der Begründung des Relays. */
export const failPending = (list: readonly PendingWrite[], id: string, error: string): PendingWrite[] =>
    list.map((item) => (item.id === id ? { ...item, state: 'failed' as const, error } : item))

/** Einen Eintrag zurücknehmen (Erfolg, oder der Nutzer wischt ihn weg). */
export const dropPending = (list: readonly PendingWrite[], id: string): PendingWrite[] =>
    list.filter((item) => item.id !== id)

/**
 * Die Einträge, die die Fläche SELBST rendern muss.
 *
 * Alles, was schon als Zeile im gefalteten Bestand steht, fällt raus — sonst
 * stünde jeder gerade gesendete Beitrag doppelt da (einmal aus welshmans
 * optimistischem `repository.publish`, einmal aus diesem Merker). Übrig bleibt
 * genau der Fehlerfall, den welshman aus der Ableitung entfernt hat.
 */
export const orphanedPending = (
    list: readonly PendingWrite[],
    known: readonly { id: string }[],
    scope: { what: PendingWrite['what']; repoAddress: string; rootId?: string },
): PendingWrite[] => {
    const seen = new Set(known.map((row) => row.id))

    return list.filter(
        (item) =>
            item.what === scope.what &&
            item.repoAddress === scope.repoAddress &&
            (scope.rootId === undefined || item.rootId === scope.rootId) &&
            !seen.has(item.id),
    )
}

/** Steht diese Id gerade in Flug? (Für den „wird gesendet"-Vermerk an der Zeile.) */
export const pendingState = (list: readonly PendingWrite[], id: string): PendingWrite['state'] | '' =>
    list.find((item) => item.id === id)?.state ?? ''

// ── Nachprüfung ─────────────────────────────────────────────────────────────

/**
 * Auf ein Ergebnis warten, das erst über eine gedrosselte Ableitung eintrifft.
 *
 * Gebraucht für die Nachprüfung des Statuswechsels: der Relay hat `OK true`
 * gesagt, aber ob unsere Fassung sich auch DURCHSETZT, entscheidet die Faltung —
 * und die sieht das Ereignis erst nach dem `throttled(300)` der Ableitung.
 * Ohne Warten stünde hier ein Ergebnis von vor dem Schreiben.
 *
 * Uhr und Schlaf sind Parameter, damit die Funktion ohne echte Zeit prüfbar ist.
 */
export const awaitValue = async ({
    read,
    accept,
    timeoutMs,
    stepMs,
    sleep,
}: {
    read: () => string
    accept: (value: string) => boolean
    timeoutMs: number
    stepMs: number
    sleep: (ms: number) => Promise<void>
}): Promise<{ ok: boolean; value: string }> => {
    let waited = 0
    let value = read()
    while (!accept(value) && waited < timeoutMs) {
        await sleep(stepMs)
        waited += stepMs
        value = read()
    }

    return { ok: accept(value), value }
}
