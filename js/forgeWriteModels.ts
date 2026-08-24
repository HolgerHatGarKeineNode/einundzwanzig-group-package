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
 * - `no-commit` — der Pull Request nennt keinen Commit (P5). Eine Freigabe gilt
 *   für GENAU EINEN Stand ({@link forgeModels.foldReviews}); ohne ihn gäbe es
 *   nichts, worauf sie sich bezöge, und jeder Leser verwürfe sie still.
 * - `settled` — der Vorgang ist zusammengeführt oder geschlossen. Eine Freigabe
 *   danach ändert nichts mehr; Buzz sperrt sie ebenfalls
 *   (`pullRequestReviews.ts:canReviewProjectPullRequest`).
 * - `targets` — die Operation nennt niemanden Brauchbaren oder zu viele (F3).
 *   **Keine Berechtigungsfrage**, und deshalb ein eigener Code: der Gate sagte
 *   sonst ALLOWED, `buildAssignmentTags` lieferte `[]`, und die Fläche meldete
 *   „Diese Zuweisung nennt niemanden." — bei 51 Namen. Es ging nichts raus, aber
 *   wer die Meldung las, suchte an der falschen Stelle.
 */
export type WriteGateReason = 'ok' | 'anonymous' | 'not-actor' | 'no-commit' | 'settled' | 'targets'

export type WriteGate = { allowed: boolean; reason: WriteGateReason }

const ALLOWED: WriteGate = { allowed: true, reason: 'ok' }
const ANONYMOUS: WriteGate = { allowed: false, reason: 'anonymous' }
const NOT_ACTOR: WriteGate = { allowed: false, reason: 'not-actor' }
const NO_COMMIT: WriteGate = { allowed: false, reason: 'no-commit' }
const SETTLED: WriteGate = { allowed: false, reason: 'settled' }
const TARGETS: WriteGate = { allowed: false, reason: 'targets' }

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
 *
 * **`maintainers` seit dem 2026-08-23.** Ohne sie durfte ein eingetragener Maintainer den
 * Knopf nicht sehen, während sein Statuswechsel auf der Leseseite ebenfalls verworfen
 * wurde — der Fehler war auf beiden Seiten derselbe und fiel deshalb auf keiner auf. Der
 * Default `[]` hält die alte, engere Menge; wer die Maintainer hat, reicht sie durch.
 */
export const statusGate = (
    viewer: string,
    root: { author: string; repoAddress: string; maintainers?: string[] },
): WriteGate => {
    if (!HEX64.test(viewer)) {
        return ANONYMOUS
    }

    return allowedActorsFor({
        author: root.author,
        repoAddress: root.repoAddress,
        maintainers: root.maintainers ?? [],
    }).has(viewer.toLowerCase())
        ? ALLOWED
        : NOT_ACTOR
}

/**
 * Obergrenze aus `builders.rs:1219-1223` — „between 1 and 50 assignees".
 *
 * Steht VOR {@link assignGate}, obwohl sie erst im Tag-Bau gebraucht wurde: seit
 * F3 prüft auch der Riegel gegen sie, und eine Konstante, die unterhalb ihres
 * ersten Lesers steht, ist eine Einladung in die temporale Todeszone.
 */
export const MAX_ASSIGNEES = 50

/**
 * Darf dieser Betrachter diese Menschen zuweisen — oder ihre Zuweisung entziehen?
 *
 * ── Die Regel steht nicht hier, sie steht in der Faltung ────────────────────
 *
 * Das ist der Kern von P5 und keine Formsache: `foldAssignments`
 * (`forgeModels.ts`) entscheidet beim LESEN, welche Operation gilt, und exakt
 * dieselbe Bedingung entscheidet hier, ob der Knopf offen ist. Die geteilte
 * Quelle ist `allowedActorsFor` — dieselbe Funktion, die `foldAssignments`
 * über `allowedActorsForRoot` aufruft. Liefen die beiden auseinander, entstünde
 * genau der Fehler, den der Docblock an {@link statusGate} beschreibt: der
 * Riegel im Leser bleibt scharf, der im Schreiber altert unbemerkt.
 *
 * **Warum ein offener Knopf ohne diese Prüfung KEIN kleiner Fehler wäre.** Buzz'
 * Relay prüft an einem `kind 1` gar nichts und quittiert mit `OK true`. Eine
 * unberechtigte Zuweisung geht also raus, wird angenommen — und von JEDEM
 * Client beim Lesen verworfen. Der Nutzer sähe Erfolg und hätte nichts
 * erreicht: stiller Leerlauf, kein Fehlerbild.
 *
 * ── Zwei Wege, und der zweite ist der wichtigere ────────────────────────────
 *
 * 1. **Autoritativ** — Wurzel-Autor, Repo-Eigentümer oder eingetragener
 *    Maintainer. Sie dürfen JEDEN benennen.
 * 2. **Selbstbedienung** — alle anderen dürfen genau EINEN Namen nennen, und
 *    das muss der eigene sein (`builders.rs:1163-1167`, Faltung
 *    `projectIssues.mjs:122-124`). Ohne diesen Weg könnte niemand ein Issue an
 *    sich ziehen; ohne die Ein-Namen-Grenze könnte jeder Fremde jeden zuweisen
 *    und sich selbst als Alibi mit hineinhängen.
 *
 * Die Prüfung läuft über die ROHE Zielliste, nicht über eine bereinigte —
 * dieselbe Härtung wie in der Faltung. Wer vorher aussortierte, machte aus
 * `[selbst, müll]` eine Selbstbedienung und wäre grosszügiger als die Referenz.
 *
 * **Zuweisen und Entziehen teilen diese Regel.** Sie sind zwei Operationen mit
 * einer Berechtigung — das SDK sagt für beide denselben Satz
 * (`builders.rs:1122-1128` und `:1163-1167`). Zwei Gates dafür wären zwei Orte,
 * an denen dieselbe Regel altern kann.
 *
 * @param targets Die `p`-Werte, die die Notiz nennen SOLL — roh, ungefiltert.
 */
export const assignGate = (
    viewer: string,
    root: { author: string; repoAddress: string; maintainers?: string[] },
    targets: readonly string[],
): WriteGate => {
    if (!HEX64.test(viewer)) {
        return ANONYMOUS
    }
    // **Erst der Gegenstand, dann die Berechtigung** (F3, 2026-08-24). Wer
    // niemanden nennt oder mehr Namen als das SDK zulässt, bekommt einen eigenen
    // Grund — sonst stünde der Gate offen und `buildAssignmentTags` schwiege
    // dazu mit einer Meldung, die das Gegenteil behauptet.
    //
    // Gezählt werden die BRAUCHBAREN Namen (dieselbe Bedingung wie im Tag-Bau),
    // die Selbstprüfung unten läuft weiter über die ROHE Liste. Beides ist
    // Absicht: die eine Frage lautet „gibt es überhaupt einen Gegenstand", die
    // andere „ist es ausschliesslich der eigene".
    const brauchbar = new Set(targets.map((value) => value.toLowerCase()).filter((pk) => HEX64.test(pk)))
    if (brauchbar.size === 0 || brauchbar.size > MAX_ASSIGNEES) {
        return TARGETS
    }
    const self = viewer.toLowerCase()
    if (
        allowedActorsFor({
            author: root.author,
            repoAddress: root.repoAddress,
            maintainers: root.maintainers ?? [],
        }).has(self)
    ) {
        return ALLOWED
    }
    const roh = targets.map((value) => value.toLowerCase())

    return roh.length === 1 && roh[0] === self ? ALLOWED : NOT_ACTOR
}

/**
 * Darf dieser Betrachter diesen Pull Request freigeben oder Änderungen erbitten?
 *
 * ── Dieselbe Menge wie beim Lesen, und sie kommt fertig herein ──────────────
 *
 * `reviewers` ist **kein** Parameter, den der Aufrufer zusammenstellt: es ist
 * genau die Liste, die {@link forgeModels.foldReviews} beim Lesen gefaltet hat
 * und die die Zeile ohnehin trägt (`PullRequest.reviewers`, seit P1). Damit
 * gibt es keine zweite Herleitung, die altern könnte — der Riegel liest, was
 * die Fläche zeigt.
 *
 * Die vertrauenswürdige Menge ist `reviewers` **plus** die berechtigten Akteure,
 * **ohne** den Autor — wortgleich zu `trustedReviewActors`
 * (`projectPullRequests.mjs:250-256`). Der Repo-Eigentümer darf also freigeben,
 * ohne angefragt worden zu sein; der Autor darf es nie, auch als Eigentümer
 * nicht.
 *
 * ── Zwei Gründe, die nichts mit Berechtigung zu tun haben ───────────────────
 *
 * Eine Freigabe gilt für GENAU EINEN Commit und wird von einem Push danach
 * entwertet. Ohne `commit` gäbe es nichts, worauf sie sich bezöge — sie ginge
 * raus, der Relay nähme sie, und jeder Leser verwürfe sie
 * (`foldReviews`: ohne aktuellen Commit gibt es gar keine Entscheidungen).
 * Und an einem zusammengeführten oder geschlossenen PR ändert sie nichts mehr.
 * Beides sind eigene Gründe, damit die Fläche den richtigen Satz zeigen kann
 * statt „du darfst nicht" zu behaupten, wo „hier gibt es nichts zu tun" gilt.
 */
export const approveGate = (
    viewer: string,
    pr: {
        author: string
        repoAddress: string
        maintainers?: string[]
        reviewers: readonly string[]
        commit: string
        status: string
    },
): WriteGate => {
    if (!HEX64.test(viewer)) {
        return ANONYMOUS
    }
    if (pr.status !== 'open' && pr.status !== 'draft') {
        return SETTLED
    }
    if (!HEX40_OR_64.test(pr.commit)) {
        return NO_COMMIT
    }
    const self = viewer.toLowerCase()
    const author = pr.author.toLowerCase()
    if (self === author) {
        return NOT_ACTOR
    }
    const trusted = new Set(pr.reviewers.map((value) => value.toLowerCase()))
    for (const actor of allowedActorsFor({
        author: pr.author,
        repoAddress: pr.repoAddress,
        maintainers: pr.maintainers ?? [],
    })) {
        if (actor !== author) {
            trusted.add(actor)
        }
    }

    return trusted.has(self) ? ALLOWED : NOT_ACTOR
}

/** Ein Commit-Hash, wie NIP-34 ihn führt: SHA-1 (40) oder SHA-256 (64). */
const HEX40_OR_64 = /^[0-9a-f]{40}([0-9a-f]{24})?$/i

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
 * Erwähnte Pubkeys als zusätzliche `p`-Tags — **ohne** die schon gesetzten zu
 * doppeln.
 *
 * `mentioned` kommt aus `mentionPubkeys` (`interactions.ts`), also aus dem
 * Rumpf des Beitrags. Übergeben statt hier geparst, weil dieses Modul rein
 * bleibt (`mentionPubkeys` hängt über `interactions.ts` an welshman); dass der
 * Weg vom Rumpf bis ins Tag wirklich trägt, hält `forgeMentionTags.test.ts`
 * fest — mit den ECHTEN Funktionen, nicht mit einem Nachbau.
 *
 * Drei Eigenschaften, und jede hat einen Grund:
 *
 * - **Nur 64-hex.** `buzz-acp` vergleicht den zweiten Tag-Wert als rohe
 *   Zeichenkette gegen den Hex-Pubkey des Agenten (`filter.rs:392-396`). Ein
 *   npub an dieser Stelle weckt niemanden, sieht aber im Event richtig aus.
 * - **Kleingeschrieben und dedupliziert**, gegen die bereits vorhandenen
 *   `p`-Zeilen (Eigentümer, Wurzel-Autor) und gegeneinander. Zwei `p`-Zeilen auf
 *   denselben Schlüssel sind für jeden Leser eine Frage ohne Antwort.
 * - **Reihenfolge stabil**: erstes Auftreten im Text. Sie ist Teil der
 *   Ereignis-Id; eine Umsortierung nach Laune machte zwei gleiche Beiträge zu
 *   zwei verschiedenen Ereignissen.
 */
const mentionTags = (tags: string[][], mentioned: readonly string[]): string[][] => {
    const gesetzt = new Set(tags.filter((tag) => tag[0] === 'p').map((tag) => tag[1]))
    for (const roh of mentioned) {
        const pubkey = roh.toLowerCase()
        if (!HEX64.test(pubkey) || gesetzt.has(pubkey)) {
            continue
        }
        gesetzt.add(pubkey)
        tags.push(['p', pubkey])
    }

    return tags
}

/**
 * Tags eines neuen Issues (1621).
 *
 * Form 1:1 wie `buildGitIssueTags` im Referenzclient: `a` auf das Repo, `p` auf
 * dessen Eigentümer (damit es in seiner Inbox auftaucht), `subject` als Titel.
 * Der Eigentümer wird NICHT vom Aufrufer geglaubt, sondern aus der Koordinate
 * gelesen — eine `p`-Zeile, die auf jemand anderen zeigt als das `a`, wäre eine
 * Falschaussage, die kein Leser prüft.
 *
 * `mentioned` sind die im Rumpf erwähnten Schlüssel (NIP-27). Sie stehen HINTER
 * dem `subject`, weil das `subject` zur Form des Referenzclients gehört und ein
 * Leser, der nur die ersten Tags liest, sie dort erwartet.
 */
export const buildIssueTags = (
    repoAddress: string,
    title: string,
    mentioned: readonly string[] = [],
): string[][] => {
    const owner = parseRepoAddress(repoAddress)?.owner ?? ''
    const tags: string[][] = [['a', repoAddress]]
    if (owner) {
        tags.push(['p', owner])
    }
    tags.push(['subject', title.trim()])

    return mentionTags(tags, mentioned)
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
export const buildCommentTags = (
    repoAddress: string,
    rootId: string,
    rootAuthor: string,
    mentioned: readonly string[] = [],
): string[][] =>
    mentionTags(
        [
            ['e', rootId, '', 'root'],
            ['a', repoAddress],
            ...recipientsFor(repoAddress, rootAuthor).map((pk) => ['p', pk]),
        ],
        mentioned,
    )

/**
 * Tags eines Statuswechsels (1630/1631/1632). Gleiche Form wie der Kommentar —
 * die Aussage steckt im Kind, nicht in den Tags.
 *
 * **Ohne erwähnte Schlüssel, und das ist kein Vergessen.** Ein Statuswechsel hat
 * keinen Rumpf: `publishIssueStatus` sendet `content: ''` (`forgeWrite.ts`), es
 * gibt also nichts, worin jemand jemanden erwähnen könnte. Ein Parameter für
 * eine Zeichenkette, die per Konstruktion leer ist, wäre eine Einladung, ihn
 * später mit etwas anderem zu füllen — etwa dem Rumpf des Issues, dessen Status
 * gerade wechselt. Dann bekäme jeder dort Erwähnte bei jedem Klick auf
 * „Geschlossen" eine neue Benachrichtigung, und ein geweckter Agent liefe für
 * einen Vorgang an, den er längst gesehen hat.
 */
export const buildStatusTags = (repoAddress: string, rootId: string, rootAuthor: string): string[][] =>
    buildCommentTags(repoAddress, rootId, rootAuthor)

/**
 * Die Rümpfe der Vorgangsnotizen — **bewusst englisch und bewusst NICHT durch
 * `t()`**.
 *
 * Das ist kein Oberflächentext, sondern eine Interop-Nutzlast. Buzz Desktop und
 * `buzz` CLI lesen dieselben Ereignisse; sie rendern ihre eigene Satzform und
 * zeigen den Rumpf nur dort, wo sie eine Notiz als gewöhnlichen Kommentar
 * behandeln. Schrieben wir Deutsch, stünde in einem fremden Client ein
 * deutscher Satz mitten in einer englischen Zeitleiste. Schrieben wir gar
 * nichts, erschiene dort eine leere Sprechblase — genau der Fehler, den P1 auf
 * unserer Seite behoben hat.
 *
 * Deshalb wörtlich die Sätze des Referenzclients
 * (`issueAssignments.ts:74-77`, `pullRequestReviews.ts:179-192`). Unsere eigene
 * Fläche zeigt sie seit P1 ohnehin nicht mehr an.
 */
export const OPERATION_CONTENT = {
    assignment: 'Assigned this issue to',
    unassignment: 'Unassigned',
    approval: 'Approved these changes',
    'changes-requested': 'Requested changes',
} as const

/**
 * Tags einer Zuweisung oder Entziehung (kind 1, `t`-beschriftet).
 *
 * Form wörtlich aus `builders.rs:1234-1246`: `["e", <root>, "", "root"]`,
 * `["a", <repo>]`, ein `["p", …]` je Genannten, `["t", <label>]`, optional
 * `["prior", <event-id>]`.
 *
 * ── `prior` ist der Grund, warum P1 die Köpfe mitgeliefert hat ──────────────
 *
 * Eine Selbstbedienung OHNE `prior` verliert gegen eine autoritative
 * Entscheidung — sie läuft in der Faltung in der ERSTEN Phase, die Autorität
 * danach (`projectIssues.mjs:149-153`). Wer sich einer Zuweisung entziehen
 * will, muss sich ausdrücklich auf sie berufen. `heads[viewer]` aus
 * `foldAssignments` ist genau dieser Bezug; fehlt er, wird kein `prior`
 * gesetzt, und das Ereignis ist dann eine unverkettete Selbstbedienung — was
 * beim ERSTEN Zugriff auf ein unzugewiesenes Issue auch richtig ist.
 *
 * Die Namen werden kleingeschrieben, entdoppelt und auf Schlüsselform geprüft:
 * ein `p`, das kein Schlüssel ist, käme über die Faltung nie zurück und stünde
 * nur als Müll im Ereignis. Das SDK verlangt zwischen 1 und 50 Namen
 * (`builders.rs:1219-1223`); dieselbe Grenze gilt hier, sonst baute die Fläche
 * ein Ereignis, das der Referenzclient gar nicht erst erzeugen könnte.
 */
export const buildAssignmentTags = ({
    repoAddress,
    rootId,
    targets,
    label,
    prior = '',
}: {
    repoAddress: string
    rootId: string
    targets: readonly string[]
    label: 'assignment' | 'unassignment'
    prior?: string
}): string[][] => {
    const namen = [...new Set(targets.map((value) => value.toLowerCase()).filter((pk) => HEX64.test(pk)))]
    if (namen.length === 0 || namen.length > MAX_ASSIGNEES) {
        return []
    }
    const tags: string[][] = [
        ['e', rootId, '', 'root'],
        ['a', repoAddress],
        ...namen.map((pk) => ['p', pk]),
        ['t', label],
    ]
    if (HEX64.test(prior.toLowerCase())) {
        tags.push(['prior', prior.toLowerCase()])
    }

    return tags
}

/**
 * Tags einer Freigabe oder eines Änderungswunsches (kind 1, `t`-beschriftet).
 *
 * **Das `c` ist keine Zierde, sondern die halbe Aussage.** `foldReviews`
 * verwirft jede Entscheidung, deren Commit nicht der aktuelle ist — ohne dieses
 * Tag erbte die Notiz stillschweigend das `c` des 1618 und wirkte damit auf
 * einen Stand, den der Freigebende womöglich nie gesehen hat. Es steht hier
 * explizit, damit die Aussage den Commit trägt, für den sie gemeint war
 * (`pullRequestReviews.ts:196-215` setzt es aus demselben Grund).
 *
 * Kein `p`-Tag: die Empfänger einer Review-Entscheidung sind Autor und
 * Eigentümer, und die stehen bereits am 1618. Ein zusätzliches `p` hier machte
 * aus jeder Freigabe eine Erwähnung — und weckte damit Agenten
 * (`forgeWake.ts`), die nichts damit zu tun haben.
 */
export const buildReviewTags = ({
    repoAddress,
    rootId,
    commit,
    label,
}: {
    repoAddress: string
    rootId: string
    commit: string
    label: 'approval' | 'changes-requested'
}): string[][] => [
    ['e', rootId, '', 'root'],
    ['a', repoAddress],
    ['t', label],
    // **UNVERÄNDERT durchgereicht, nicht kleingeschrieben** (F1, 2026-08-24).
    //
    // Hier stand `commit.toLowerCase()`, und das war eine zweite Meinung über
    // denselben Wert: `foldReviews` vergleicht BYTEWEISE gegen das `c` des 1618
    // (ebenso Buzz, `projectPullRequests.mjs:265-274`). Ein grossgeschriebener
    // Commit öffnete damit den Gate — die Formprüfung ist case-insensitiv —,
    // das Ereignis ginge raus, der Relay quittierte mit `OK true`, und die
    // Faltung erkennte NICHTS an. Genau die Klasse, gegen die P5 gebaut wurde.
    //
    // Der Wert kommt aus `PullRequest.commit`, also aus demselben Tag, gegen das
    // später verglichen wird. Ihn unterwegs anzufassen kann nur schaden: an
    // dieser Kette gibt es genau eine Schreibweise, und das ist die des
    // Erzeugers. Die Formprüfung im Gate bleibt case-insensitiv — sie beschreibt
    // die GESTALT eines Commits, nicht seine Identität.
    ['c', commit],
]

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
 * **Seit F2 (2026-08-24) generisch**, weil die Zuweisung dieselbe Frage stellt
 * und ihre Antwort ein `boolean` ist („bin ich zugewiesen?"). Der Typ war auf
 * `string` genagelt, ohne dass irgendetwas im Rumpf das brauchte — eine
 * Zeichenkette daraus zu machen wäre eine Verrenkung um eine Signatur herum
 * gewesen, die nichts festhält. Bestehende Aufrufer leiten `string` weiterhin
 * ab, ihr Verhalten ändert sich nicht.
 *
 * Uhr und Schlaf sind Parameter, damit die Funktion ohne echte Zeit prüfbar ist.
 */
export const awaitValue = async <T>({
    read,
    accept,
    timeoutMs,
    stepMs,
    sleep,
}: {
    read: () => T
    accept: (value: T) => boolean
    timeoutMs: number
    stepMs: number
    sleep: (ms: number) => Promise<void>
}): Promise<{ ok: boolean; value: T }> => {
    let waited = 0
    let value = read()
    while (!accept(value) && waited < timeoutMs) {
        await sleep(stepMs)
        waited += stepMs
        value = read()
    }

    return { ok: accept(value), value }
}
