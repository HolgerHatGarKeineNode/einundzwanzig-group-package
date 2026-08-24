/**
 * Die Schreibrichtung der Forge — geprüft wird, was in der Fläche STILL bricht:
 *
 *   1. **Der Eigentümer im `p`-Tag wird nicht geglaubt, sondern gelesen.** Ein
 *      Aufrufer, der eine falsche Adresse mitgibt, erzeugt sonst ein Ereignis,
 *      dessen `a` und `p` auf verschiedene Menschen zeigen — eine
 *      Falschaussage, die kein Leser nachprüft.
 *   2. **Die Berechtigungsregel steht genau einmal.** `statusGate` und
 *      `allowedActorsForRoot` müssen dasselbe sagen; driften sie auseinander,
 *      bleibt der Riegel im Leser scharf und der im Schreiber altert unbemerkt.
 *      Ein Test hält beide zusammen.
 *   3. **Zwei Statuswechsel in derselben Sekunde sind ein Münzwurf.**
 *      `foldStatus` entscheidet bei Gleichstand über die Id — der ÄLTERE
 *      Zustand kann gewinnen. `nextCreatedAt` verhindert den Gleichstand, aber
 *      nur bis zu einem Deckel: ein fremdes Ereignis weit in der Zukunft darf
 *      uns nicht dazu bringen, selbst eines weit in der Zukunft zu schreiben.
 *   4. **Der optimistische Eintrag und sein Rückbau.** welshman zeigt die Zeile
 *      sofort und nimmt sie bei einem Fehlschlag lautlos wieder weg; der Merker
 *      muss sie dann übernehmen — und darf sie NICHT doppelt zeigen, solange
 *      welshmans Fassung noch steht.
 *   5. **Kein Warten ohne Ende.** Die Nachprüfung des Statuswechsels läuft in
 *      eine Zeitgrenze, sonst hinge der Knopf für immer.
 *
 * Ausführen:
 * node --experimental-strip-types --test packages/einundzwanzig-group/js/forgeWriteModels.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { allowedActorsForRoot, type ForgeEvent } from './forgeModels.ts'
import {
    FORGE_BODY_MAX,
    FORGE_COMMENT_KIND,
    GIT_ISSUE_KIND,
    ISSUE_TITLE_MAX,
    MAX_CREATED_AT_BUMP,
    WRITABLE_ISSUE_STATUSES,
    addPending,
    approveGate,
    assignGate,
    awaitValue,
    buildAssignmentTags,
    buildCommentTags,
    buildIssueTags,
    buildReviewTags,
    buildStatusTags,
    commentDraftProblem,
    dropPending,
    failPending,
    issueDraftProblem,
    memberGate,
    nextCreatedAt,
    orphanedPending,
    pendingState,
    statusGate,
    statusKindFor,
    type PendingWrite,
} from './forgeWriteModels.ts'

const OWNER = 'a'.repeat(64)
const AUTHOR = 'b'.repeat(64)
const STRANGER = 'c'.repeat(64)
const ROOT_ID = 'd'.repeat(64)
const ADDRESS = `30617:${OWNER}:mein-repo`

const tagsOf = (tags: string[][], name: string): string[][] => tags.filter((tag) => tag[0] === name)
const firstValue = (tags: string[][], name: string): string => tagsOf(tags, name)[0]?.[1] ?? ''

// ── Kinds ───────────────────────────────────────────────────────────────────

test('die Kinds sind die gemessenen: 1621 für das Issue, 1 für den Kommentar', () => {
    assert.equal(GIT_ISSUE_KIND, 1621)
    // NIP-22 (1111) wäre spec-sauberer und wird am Ziel-Relay mit
    // `restricted: unknown event kind` abgelehnt — am Teststack nachgemessen.
    assert.equal(FORGE_COMMENT_KIND, 1)
})

test('statusKindFor kennt genau die drei setzbaren Zustände', () => {
    assert.equal(statusKindFor('open'), 1630)
    assert.equal(statusKindFor('resolved'), 1631)
    assert.equal(statusKindFor('closed'), 1632)
    // `draft` (1633) wird GELESEN, aber nicht geschrieben — ein Zustand, den
    // die Fläche anbietet und niemand deuten kann, ist schlechter als keiner.
    assert.equal(statusKindFor('draft'), 0)
    assert.equal(statusKindFor(''), 0)
    assert.deepEqual([...WRITABLE_ISSUE_STATUSES], ['open', 'resolved', 'closed'])
})

// ── Tag-Bau ─────────────────────────────────────────────────────────────────

test('das Issue trägt a, p und subject — der Titel wird getrimmt', () => {
    const tags = buildIssueTags(ADDRESS, '  Der Otter frisst den Zwerg  ')
    assert.equal(firstValue(tags, 'a'), ADDRESS)
    assert.equal(firstValue(tags, 'p'), OWNER)
    assert.equal(firstValue(tags, 'subject'), 'Der Otter frisst den Zwerg')
})

test('der Eigentümer im p-Tag stammt aus der KOORDINATE, nicht vom Aufrufer', () => {
    // Regel 1 im Dateikopf: `a` und `p` dürfen nie auf verschiedene Menschen
    // zeigen. Deshalb gibt es gar keinen Parameter, mit dem man das trennen
    // könnte — und eine kaputte Koordinate erzeugt lieber GAR kein `p`.
    const kaputt = buildIssueTags('30617:nichthex:x', 'Titel')
    assert.equal(tagsOf(kaputt, 'p').length, 0)
    assert.equal(firstValue(kaputt, 'a'), '30617:nichthex:x')
})

test('der Kommentar markiert die Wurzel an der VIERTEN Stelle des e-Tags', () => {
    const tags = buildCommentTags(ADDRESS, ROOT_ID, AUTHOR)
    // `["e", id, <relay-hint>, "root"]` — die dritte Stelle ist der Relay-Hinweis
    // und bleibt leer. Wer den Marker dorthin schreibt, verliert ihn für jeden
    // Leser, der nach NIP-10 auswertet.
    assert.deepEqual(tagsOf(tags, 'e')[0], ['e', ROOT_ID, '', 'root'])
    assert.equal(firstValue(tags, 'a'), ADDRESS)
    assert.deepEqual(
        tagsOf(tags, 'p').map((tag) => tag[1]),
        [OWNER, AUTHOR],
    )
})

test('Empfänger werden entdoppelt und Unbrauchbares fliegt raus', () => {
    // Eigenes Issue am eigenen Repo: Eigentümer == Autor, ein `p` genügt.
    const eigen = buildCommentTags(ADDRESS, ROOT_ID, OWNER.toUpperCase())
    assert.deepEqual(
        tagsOf(eigen, 'p').map((tag) => tag[1]),
        [OWNER],
    )
    // Ein Autor, der kein Pubkey ist, erzeugt keine leere `p`-Zeile.
    const kaputt = buildCommentTags(ADDRESS, ROOT_ID, 'niemand')
    assert.deepEqual(
        tagsOf(kaputt, 'p').map((tag) => tag[1]),
        [OWNER],
    )
})

// ── Erwähnungen aus dem Rumpf (P9) ──────────────────────────────────────────

/** Ein zweiter und dritter Schlüssel, die nur als Erwähnung vorkommen. */
const AGENT = 'e'.repeat(64)
const ZWEITER_AGENT = 'f'.repeat(64)

test('erwähnte Schlüssel werden zu zusätzlichen p-Tags, in der Reihenfolge des Textes', () => {
    const tags = buildIssueTags(ADDRESS, 'Titel', [AGENT, ZWEITER_AGENT])
    assert.deepEqual(
        tagsOf(tags, 'p').map((tag) => tag[1]),
        [OWNER, AGENT, ZWEITER_AGENT],
    )
    // Und sie stehen HINTER dem `subject` — die Form des Referenzclients bleibt
    // vorne unangetastet.
    assert.equal(firstValue(tags, 'subject'), 'Titel')
})

/**
 * **Der Fall, der ohne Test still das Falsche täte.** Wer den Eigentümer seines
 * eigenen Repos im Rumpf erwähnt, bekäme zwei `p`-Zeilen auf denselben
 * Schlüssel: für jeden Leser eine Frage ohne Antwort, und für einen
 * benachrichtigenden Client womöglich zwei Meldungen für einen Vorgang.
 */
test('ein erwähnter Eigentümer doppelt seine p-Zeile nicht', () => {
    const tags = buildIssueTags(ADDRESS, 'Titel', [OWNER])
    assert.deepEqual(
        tagsOf(tags, 'p').map((tag) => tag[1]),
        [OWNER],
    )
})

test('am Kommentar entdoppelt sich die Erwähnung gegen Eigentümer UND Wurzel-Autor', () => {
    const tags = buildCommentTags(ADDRESS, ROOT_ID, AUTHOR, [AUTHOR, OWNER, AGENT])
    assert.deepEqual(
        tagsOf(tags, 'p').map((tag) => tag[1]),
        [OWNER, AUTHOR, AGENT],
    )
})

test('zweimal derselbe erwähnte Schlüssel ergibt EINE p-Zeile', () => {
    const tags = buildCommentTags(ADDRESS, ROOT_ID, AUTHOR, [AGENT, AGENT])
    assert.deepEqual(
        tagsOf(tags, 'p').map((tag) => tag[1]),
        [OWNER, AUTHOR, AGENT],
    )
})

/**
 * `buzz-acp` vergleicht den zweiten Tag-Wert als **rohe** Zeichenkette gegen den
 * Hex-Pubkey des Agenten (`filter.rs:392-396`). Groß geschrieben trifft er
 * nicht — das Ereignis sähe aber vollkommen richtig aus.
 */
test('erwähnte Schlüssel werden kleingeschrieben', () => {
    const tags = buildIssueTags(ADDRESS, 'Titel', [AGENT.toUpperCase()])
    assert.deepEqual(
        tagsOf(tags, 'p').map((tag) => tag[1]),
        [OWNER, AGENT],
    )
})

test('was kein 64-hex ist, wird kein p-Tag', () => {
    // npub, nprofile, leerer Wert: alles Formen, die im Event richtig aussehen
    // und niemanden erreichen.
    const tags = buildIssueTags(ADDRESS, 'Titel', ['npub1abc', '', 'ab', `${AGENT}xx`])
    assert.deepEqual(
        tagsOf(tags, 'p').map((tag) => tag[1]),
        [OWNER],
    )
})

test('der Statuswechsel hat dieselbe Adressierung wie der Kommentar', () => {
    // Die Aussage steckt im Kind, nicht in den Tags — beide müssen deshalb
    // identisch adressieren, sonst fände `foldStatus` den Wechsel nicht.
    assert.deepEqual(buildStatusTags(ADDRESS, ROOT_ID, AUTHOR), buildCommentTags(ADDRESS, ROOT_ID, AUTHOR))
    // **Und er nimmt keine Erwähnungen entgegen.** Ein Statuswechsel hat keinen
    // Rumpf (`content: ''`); ein vierter Parameter wäre die Einladung, ihn mit
    // dem Rumpf des ISSUES zu füllen — dann bekäme jeder dort Erwähnte bei jedem
    // Klick auf „Geschlossen" eine neue Benachrichtigung.
    //
    // Geprüft wird das an der WIRKUNG, nicht an `buildStatusTags.length`: ein
    // Parameter mit Vorgabewert zählt in `Function.length` nicht mit, die
    // Stelligkeit bliebe also bei 3, und die Mutation „reich das vierte Argument
    // durch" wäre grün geblieben. Genau so gemessen, bevor diese Zeilen hier
    // standen.
    const mitViertem = buildStatusTags as unknown as (
        repoAddress: string,
        rootId: string,
        rootAuthor: string,
        mentioned?: readonly string[],
    ) => string[][]
    assert.deepEqual(
        mitViertem(ADDRESS, ROOT_ID, AUTHOR, [AGENT]),
        buildCommentTags(ADDRESS, ROOT_ID, AUTHOR),
    )
})

// ── Berechtigung ────────────────────────────────────────────────────────────

test('ohne Anmeldung ist jede Schreibaktion gesperrt — mit Grund', () => {
    assert.deepEqual(memberGate(''), { allowed: false, reason: 'anonymous' })
    assert.deepEqual(memberGate('keinpubkey'), { allowed: false, reason: 'anonymous' })
    assert.deepEqual(memberGate(AUTHOR), { allowed: true, reason: 'ok' })
    assert.deepEqual(statusGate('', { author: AUTHOR, repoAddress: ADDRESS }), {
        allowed: false,
        reason: 'anonymous',
    })
})

test('den Status setzen darf der Autor der Wurzel und der Eigentümer des Repos', () => {
    const root = { author: AUTHOR, repoAddress: ADDRESS }
    assert.equal(statusGate(AUTHOR, root).allowed, true)
    assert.equal(statusGate(OWNER, root).allowed, true)
    assert.equal(statusGate(AUTHOR.toUpperCase(), root).allowed, true)
    assert.deepEqual(statusGate(STRANGER, root), { allowed: false, reason: 'not-actor' })
})

test('Schreib-Riegel und Lese-Riegel sagen dasselbe (eine Regel, zwei Türen)', () => {
    // Regel 2 im Dateikopf. Der Relay prüft bei 1630–1633 NICHTS (am Teststack
    // gemessen: ein Fremder bekam `success`) — driften diese beiden auseinander,
    // schreibt die Fläche Ereignisse, die sie selbst nie anzeigt.
    const root: ForgeEvent = {
        id: ROOT_ID,
        pubkey: AUTHOR,
        kind: 1621,
        created_at: 1,
        content: '',
        tags: [['a', ADDRESS]],
    }
    const erlaubt = allowedActorsForRoot(root)
    for (const kandidat of [AUTHOR, OWNER, STRANGER]) {
        assert.equal(
            statusGate(kandidat, { author: root.pubkey, repoAddress: ADDRESS }).allowed,
            erlaubt.has(kandidat),
            `Uneinigkeit über ${kandidat.slice(0, 4)}…`,
        )
    }
})

// ── Entwurfsprüfung ─────────────────────────────────────────────────────────

test('ein Issue ohne Titel geht nicht raus, eines ohne Rumpf schon', () => {
    assert.equal(issueDraftProblem({ title: '   ', body: 'Text' }, ADDRESS), 'title-required')
    assert.equal(issueDraftProblem({ title: 'Titel', body: '' }, ADDRESS), '')
    assert.equal(issueDraftProblem({ title: 'x'.repeat(ISSUE_TITLE_MAX + 1), body: '' }, ADDRESS), 'title-too-long')
    assert.equal(issueDraftProblem({ title: 'x'.repeat(ISSUE_TITLE_MAX), body: '' }, ADDRESS), '')
    assert.equal(issueDraftProblem({ title: 'T', body: 'x'.repeat(FORGE_BODY_MAX + 1) }, ADDRESS), 'body-too-long')
})

test('ein unadressierbares Ziel wird VOR dem Absenden erkannt', () => {
    assert.equal(issueDraftProblem({ title: 'T', body: '' }, '30617:xx:y'), 'target-invalid')
    assert.equal(issueDraftProblem({ title: 'T', body: '' }, ''), 'target-invalid')
    assert.equal(commentDraftProblem('Hallo', { rootId: 'kurz', repoAddress: ADDRESS }), 'target-invalid')
    assert.equal(commentDraftProblem('Hallo', { rootId: ROOT_ID, repoAddress: 'unfug' }), 'target-invalid')
})

test('ein leerer Kommentar ist kein Kommentar', () => {
    assert.equal(commentDraftProblem('  \n ', { rootId: ROOT_ID, repoAddress: ADDRESS }), 'body-required')
    assert.equal(commentDraftProblem('Hallo', { rootId: ROOT_ID, repoAddress: ADDRESS }), '')
})

// ── Zeitstempel ─────────────────────────────────────────────────────────────

test('nextCreatedAt bricht den Gleichstand — aber nur bis zum Deckel', () => {
    // Regel 3. Gleiche Sekunde: eine drauf, sonst entscheidet der Id-Tiebreak.
    assert.equal(nextCreatedAt(1000, 1000), 1001)
    // Der bisherige Stand ist älter: kein Grund, die Uhr zu verlassen.
    assert.equal(nextCreatedAt(1000, 900), 1000)
    assert.equal(nextCreatedAt(1000, 0), 1000)
    // Knapp in der Zukunft (Uhr-Drift zwischen zwei Clients): noch mitgehen.
    assert.equal(nextCreatedAt(1000, 1000 + MAX_CREATED_AT_BUMP - 1), 1000 + MAX_CREATED_AT_BUMP)
    // Weit in der Zukunft: NICHT mitgehen. Sonst schriebe ein fremdes Ereignis
    // mit Datum in zehn Jahren uns dieselbe Lüge in den eigenen Stempel; die
    // Nachprüfung meldet den Wechsel dann ehrlich als nicht durchgesetzt.
    assert.equal(nextCreatedAt(1000, 1000 + MAX_CREATED_AT_BUMP + 5), 1000)
    assert.equal(nextCreatedAt(1000, 99_999_999), 1000)
})

// ── Optimistischer Eintrag ──────────────────────────────────────────────────

const entry = (over: Partial<PendingWrite> = {}): PendingWrite => ({
    id: 'e'.repeat(64),
    what: 'issue',
    state: 'sending',
    error: '',
    repoAddress: ADDRESS,
    rootId: '',
    label: 'Titel',
    content: '',
    author: AUTHOR,
    createdAt: 1000,
    ...over,
})

test('der Merker nimmt auf, markiert und gibt wieder frei', () => {
    const eins = addPending([], entry())
    assert.equal(eins.length, 1)
    assert.equal(pendingState(eins, entry().id), 'sending')

    const gescheitert = failPending(eins, entry().id, 'restricted: not a relay member')
    assert.equal(pendingState(gescheitert, entry().id), 'failed')
    assert.equal(gescheitert[0].error, 'restricted: not a relay member')
    // Der Rückbau ist vollständig — kein Rest, kein „war mal da".
    assert.deepEqual(dropPending(gescheitert, entry().id), [])
    assert.equal(pendingState([], entry().id), '')
})

test('dieselbe Id kommt nie zweimal in den Merker', () => {
    // Ein Doppelklick erzeugt zwar keinen zweiten Flug (das verhindert der
    // Riegel in `forgeWrite.ts`), aber ein Retry auf dieselbe Id darf den
    // Eintrag ersetzen statt ihn zu verdoppeln.
    const zweimal = addPending(addPending([], entry()), entry({ state: 'failed', error: 'x' }))
    assert.equal(zweimal.length, 1)
    assert.equal(zweimal[0].state, 'failed')
})

test('was die Liste schon zeigt, zeigt der Merker NICHT noch einmal', () => {
    // Regel 4: `publishThunk` legt das Ereignis synchron in den `repository` und
    // trackt die Ziel-URL — die Zeile steht also bereits. Ein zweiter Eintrag
    // daneben wäre dieselbe Nachricht doppelt.
    const list = [entry()]
    const bekannt = [{ id: entry().id }]
    assert.deepEqual(orphanedPending(list, bekannt, { what: 'issue', repoAddress: ADDRESS }), [])
    // Erst wenn welshman die Herkunft bei einem Fehlschlag zurückzieht und die
    // Zeile verschwindet, übernimmt der Merker.
    assert.equal(orphanedPending(list, [], { what: 'issue', repoAddress: ADDRESS }).length, 1)
})

test('der Merker verwechselt weder Art noch Repo noch Wurzel', () => {
    const list = [
        entry({ id: '1'.repeat(64), what: 'issue' }),
        entry({ id: '2'.repeat(64), what: 'comment', rootId: ROOT_ID }),
        entry({ id: '3'.repeat(64), what: 'comment', rootId: 'f'.repeat(64) }),
        entry({ id: '4'.repeat(64), what: 'comment', rootId: ROOT_ID, repoAddress: `30617:${OWNER}:anderes` }),
    ]
    const treffer = orphanedPending(list, [], { what: 'comment', repoAddress: ADDRESS, rootId: ROOT_ID })
    assert.deepEqual(
        treffer.map((item) => item.id),
        ['2'.repeat(64)],
    )
    // Ohne `rootId` im Bereich zählt jede Wurzel dieses Repos.
    assert.equal(orphanedPending(list, [], { what: 'comment', repoAddress: ADDRESS }).length, 2)
})

// ── Nachprüfung ─────────────────────────────────────────────────────────────

test('awaitValue wartet, bis die Faltung nachgezogen hat', async () => {
    let gelesen = 0
    const geschlafen: number[] = []
    const ergebnis = await awaitValue({
        read: () => (gelesen++ < 2 ? 'open' : 'closed'),
        accept: (value) => value === 'closed',
        timeoutMs: 1000,
        stepMs: 100,
        sleep: async (ms) => {
            geschlafen.push(ms)
        },
    })
    assert.deepEqual(ergebnis, { ok: true, value: 'closed' })
    assert.deepEqual(geschlafen, [100, 100])
})

test('awaitValue gibt auf, statt ewig zu warten', async () => {
    // Regel 5. Ohne Grenze bliebe der Knopf für immer gesperrt — genau die
    // Falle, die `waitForPublishError` eine Ebene tiefer schon einmal stellt.
    let runden = 0
    const ergebnis = await awaitValue({
        read: () => 'open',
        accept: (value) => value === 'closed',
        timeoutMs: 500,
        stepMs: 100,
        sleep: async () => {
            runden++
        },
    })
    assert.deepEqual(ergebnis, { ok: false, value: 'open' })
    assert.equal(runden, 5)
})

test('awaitValue schläft gar nicht, wenn der Wert schon stimmt', async () => {
    let runden = 0
    const ergebnis = await awaitValue({
        read: () => 'closed',
        accept: (value) => value === 'closed',
        timeoutMs: 500,
        stepMs: 100,
        sleep: async () => {
            runden++
        },
    })
    assert.deepEqual(ergebnis, { ok: true, value: 'closed' })
    assert.equal(runden, 0)
})

// ── P5: die Riegel vor Zuweisen und Freigeben ───────────────────────────────

const REVIEWER = 'e'.repeat(64)
const MAINTAINER = 'f'.repeat(64)
const COMMIT = '1'.repeat(40)
const ISSUE = { author: AUTHOR, repoAddress: ADDRESS }

/**
 * **Warum diese Riegel schwerer wiegen als eine Formularprüfung.**
 *
 * Buzz' Relay prüft an einem `kind 1` gar nichts und quittiert mit `OK true`.
 * Eine unberechtigte Zuweisung geht also raus, wird angenommen — und von JEDEM
 * Client beim Lesen verworfen. Ohne sichtbaren Riegel sähe der Nutzer Erfolg und
 * hätte nichts erreicht: stiller Leerlauf, kein Fehlerbild.
 */
test('assignGate: autoritativ darf jeden benennen — Autor, Eigentümer, Maintainer', () => {
    assert.equal(assignGate(AUTHOR, ISSUE, [STRANGER]).allowed, true)
    assert.equal(assignGate(OWNER, ISSUE, [STRANGER]).allowed, true)
    assert.equal(
        assignGate(MAINTAINER, { ...ISSUE, maintainers: [MAINTAINER] }, [STRANGER]).allowed,
        true,
    )
    // KONTROLLE: derselbe Mensch OHNE Eintrag in der Maintainer-Liste ist ein Fremder.
    assert.equal(assignGate(MAINTAINER, ISSUE, [STRANGER]).reason, 'not-actor')
})

test('assignGate: ein Fremder darf genau sich selbst — und nur allein', () => {
    assert.equal(assignGate(STRANGER, ISSUE, [STRANGER]).allowed, true)
    assert.equal(assignGate(STRANGER, ISSUE, [REVIEWER]).reason, 'not-actor')
    // Der Alibi-Fall: sich selbst mit hineinhängen macht es nicht zur Selbstbedienung.
    assert.equal(assignGate(STRANGER, ISSUE, [STRANGER, REVIEWER]).reason, 'not-actor')
})

/**
 * Dieselbe Härtung wie in der Faltung (`foldAssignments`): geprüft wird die ROHE
 * Liste. Wer vorher aussortierte, machte aus `[selbst, müll]` eine
 * Selbstbedienung — und wäre grosszügiger als der Referenzparser statt strenger.
 */
test('assignGate: die Selbstprüfung zählt die ROHEN Ziele, nicht die brauchbaren', () => {
    assert.equal(assignGate(STRANGER, ISSUE, [STRANGER, 'kein-schluessel']).reason, 'not-actor')
})

test('assignGate: ohne Anmeldung und ohne Ziel bleibt der Knopf zu', () => {
    assert.equal(assignGate('', ISSUE, [STRANGER]).reason, 'anonymous')
    assert.equal(assignGate(AUTHOR, ISSUE, []).reason, 'not-actor')
})

/**
 * **Der Riegel liest, was die Fläche zeigt.** `reviewers` ist genau die Liste,
 * die `foldReviews` beim Lesen gefaltet hat und die die Zeile trägt — keine
 * zweite Herleitung, die altern könnte.
 */
const PR = { author: AUTHOR, repoAddress: ADDRESS, reviewers: [REVIEWER], commit: COMMIT, status: 'open' }

test('approveGate: angefragter Reviewer und Repo-Eigentümer dürfen, der Autor nie', () => {
    assert.equal(approveGate(REVIEWER, PR).allowed, true)
    // Der Eigentümer darf, ohne angefragt worden zu sein (`trustedReviewActors`).
    assert.equal(approveGate(OWNER, PR).allowed, true)
    // Der Autor nicht — auch dann nicht, wenn er der Eigentümer ist.
    assert.equal(approveGate(AUTHOR, PR).reason, 'not-actor')
    assert.equal(approveGate(OWNER, { ...PR, author: OWNER }).reason, 'not-actor')
    // Und ein Unbeteiligter erst recht nicht.
    assert.equal(approveGate(STRANGER, PR).reason, 'not-actor')
})

/**
 * Zwei Gründe, die NICHTS mit Berechtigung zu tun haben — und die deshalb eigene
 * Codes tragen: die Fläche soll „hier gibt es nichts zu tun" sagen können statt
 * „du darfst nicht".
 */
test('approveGate: ohne Commit und an einem erledigten PR gibt es nichts freizugeben', () => {
    assert.equal(approveGate(REVIEWER, { ...PR, commit: '' }).reason, 'no-commit')
    assert.equal(approveGate(REVIEWER, { ...PR, commit: 'kein-hash' }).reason, 'no-commit')
    for (const status of ['merged', 'closed']) {
        assert.equal(approveGate(REVIEWER, { ...PR, status }).reason, 'settled')
    }
    // KONTROLLE: am Entwurf darf man sehr wohl — Buzz sperrt nur merged/closed.
    assert.equal(approveGate(REVIEWER, { ...PR, status: 'draft' }).allowed, true)
    // Die Reihenfolge der Gründe ist eine Aussage: „erledigt" schlägt „kein
    // Commit", weil an einem geschlossenen PR auch ein Commit nichts änderte.
    assert.equal(approveGate(REVIEWER, { ...PR, status: 'merged', commit: '' }).reason, 'settled')
})

// ── P5: die Tags der neuen Operationen ──────────────────────────────────────

test('buildAssignmentTags: Form wörtlich aus dem SDK, mit Wurzel-Marker an vierter Stelle', () => {
    const tags = buildAssignmentTags({ repoAddress: ADDRESS, rootId: ROOT_ID, targets: [REVIEWER], label: 'assignment' })

    assert.deepEqual(tags[0], ['e', ROOT_ID, '', 'root'])
    assert.deepEqual(tags[1], ['a', ADDRESS])
    assert.deepEqual(tagsOf(tags, 'p'), [['p', REVIEWER]])
    assert.equal(firstValue(tags, 't'), 'assignment')
    // Ohne `prior` steht keins da — eine leere Kette ist keine Kette.
    assert.deepEqual(tagsOf(tags, 'prior'), [])
})

/**
 * `prior` ist der Grund, warum P1 die Köpfe mitgeliefert hat: eine
 * Selbstbedienung OHNE Bezug verliert gegen eine autoritative Entscheidung
 * (`projectIssues.mjs:149-153`). Wer sich entziehen will, muss sich auf sie
 * berufen.
 */
test('buildAssignmentTags: `prior` nur, wenn es eine Ereignis-Id ist', () => {
    const mit = buildAssignmentTags({
        repoAddress: ADDRESS, rootId: ROOT_ID, targets: [STRANGER], label: 'unassignment', prior: ROOT_ID,
    })
    assert.deepEqual(tagsOf(mit, 'prior'), [['prior', ROOT_ID]])

    const ohne = buildAssignmentTags({
        repoAddress: ADDRESS, rootId: ROOT_ID, targets: [STRANGER], label: 'unassignment', prior: 'unsinn',
    })
    assert.deepEqual(tagsOf(ohne, 'prior'), [])
})

test('buildAssignmentTags: Müll fliegt raus, Dopplungen auch, und ohne Namen gibt es kein Ereignis', () => {
    const tags = buildAssignmentTags({
        repoAddress: ADDRESS, rootId: ROOT_ID,
        targets: [REVIEWER, REVIEWER.toUpperCase(), 'kein-schluessel'], label: 'assignment',
    })
    assert.deepEqual(tagsOf(tags, 'p'), [['p', REVIEWER]])

    // Leer und über der SDK-Grenze: beides ergibt KEINE Tags — die Fläche baut
    // dann kein Ereignis, statt eines zu senden, das der Referenzclient gar
    // nicht erst erzeugen könnte.
    assert.deepEqual(buildAssignmentTags({ repoAddress: ADDRESS, rootId: ROOT_ID, targets: [], label: 'assignment' }), [])
    const zuViele = Array.from({ length: 51 }, (_, i) => String(i).padStart(64, '0'))
    assert.deepEqual(buildAssignmentTags({ repoAddress: ADDRESS, rootId: ROOT_ID, targets: zuViele, label: 'assignment' }), [])
})

/**
 * Das `c` ist die halbe Aussage: `foldReviews` verwirft jede Entscheidung, deren
 * Commit nicht der aktuelle ist. Ohne das Tag erbte die Notiz still das `c` des
 * 1618 und wirkte auf einen Stand, den der Freigebende nie gesehen hat.
 */
test('buildReviewTags: trägt den Commit — und KEIN `p`', () => {
    const tags = buildReviewTags({ repoAddress: ADDRESS, rootId: ROOT_ID, commit: COMMIT, label: 'approval' })

    assert.deepEqual(tags[0], ['e', ROOT_ID, '', 'root'])
    assert.equal(firstValue(tags, 't'), 'approval')
    assert.equal(firstValue(tags, 'c'), COMMIT)
    // Ein `p` machte aus jeder Freigabe eine Erwähnung — und weckte Agenten,
    // die nichts damit zu tun haben (`forgeWake.ts`).
    assert.deepEqual(tagsOf(tags, 'p'), [])
})
