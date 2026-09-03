/**
 * Pure-Tests des Forum-Datenmodells (welshman-frei).
 *   node --test packages/einundzwanzig-group/js/forumModels.test.ts
 *
 * Die Fixtures sind die AM TESTSTACK GEMESSENEN Formen (2026-08-17): ein 45001
 * trägt nur `["h",…]` und keinen Titel, eine Antwort ist 45003 ODER kind 9, je
 * mit `["e",<root>,"","reply"]`. Wo ein Test eine Eigenschaft der Ereignisform
 * behauptet, steht die Messung im Kopf von `forumModels.ts`.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
    DEFAULT_FORUM_SORT,
    EMPTY_TALLY,
    FORUM_COMMENT,
    FORUM_FACE_CAP,
    FORUM_POST,
    FORUM_SORTS,
    FORUM_VOTE,
    VOTE_DOWN,
    VOTE_UP,
    buildForumTopics,
    foldForumVotes,
    forumTopicPreview,
    forumTopicTitle,
    sortForumTopics,
    type ForumReplyInput,
    type ForumRootInput,
    type ForumSort,
    type ForumTombstoneInput,
    type ForumVoteInput,
} from './forumModels.ts'

const root = (over: Partial<ForumRootInput> & { id: string }): ForumRootInput => ({
    pubkey: 'a'.repeat(64),
    content: `Thema ${over.id}`,
    created_at: 1000,
    ...over,
})

const reply = (over: Partial<ForumReplyInput> & { id: string; rootId: string }): ForumReplyInput => ({
    pubkey: 'b'.repeat(64),
    created_at: 2000,
    ...over,
})

// ── Kinds ───────────────────────────────────────────────────────────────────

test('die Kind-Nummern sind die von Buzz (45001 Thema, 45002 Bewertung, 45003 Antwort)', () => {
    assert.equal(FORUM_POST, 45001)
    assert.equal(FORUM_COMMENT, 45003)
    assert.equal(FORUM_VOTE, 45002)
})

test('die zwei Inhalte einer Bewertung sind WOERTLICH `+` und `-`', () => {
    // Gegen sich selbst geprueft waere das wertlos; die Werte stehen hier als Literale,
    // weil sie am Erzeuger belegt sind (`builders.rs:456-470`) und ein dritter Wert vom
    // Relay ANGENOMMEN wuerde — die Konstante ist die einzige Stelle, die ihn ausschliesst.
    assert.equal(VOTE_UP, '+')
    assert.equal(VOTE_DOWN, '-')
})

// ── Titel & Vorschau ────────────────────────────────────────────────────────

test('der Titel ist die erste nicht-leere Zeile, die Vorschau der Rest', () => {
    const content = '\n  Wie kommt das Bier in die Flasche?  \n\nMit Druck.\nUnd Geduld.'
    assert.equal(forumTopicTitle(content), 'Wie kommt das Bier in die Flasche?')
    assert.equal(forumTopicPreview(content), 'Mit Druck. Und Geduld.')
})

test('einzeiliges Thema: kein zweiter Abdruck desselben Satzes', () => {
    assert.equal(forumTopicTitle('Nur eine Zeile'), 'Nur eine Zeile')
    assert.equal(forumTopicPreview('Nur eine Zeile'), '')
})

test('textloser Inhalt hat keinen Titel — die Fläche setzt ihren eigenen Ersatz', () => {
    assert.equal(forumTopicTitle('   \n\n  '), '')
    assert.equal(forumTopicPreview('   \n\n  '), '')
    assert.equal(forumTopicTitle(''), '')
})

test('überlanger Titel wird mit Ellipse gekürzt und bleibt einzeilig', () => {
    const long = 'x'.repeat(400)
    const title = forumTopicTitle(long)
    assert.equal(title.length, 120)
    assert.ok(title.endsWith('…'))
    assert.ok(!title.includes('\n'))
})

// ── Themenliste ─────────────────────────────────────────────────────────────

test('Antworten zählen — 45003 und kind 9 gleichermaßen (der Aufrufer löst den Root auf)', () => {
    const rows = buildForumTopics(
        [root({ id: 'r1' })],
        [reply({ id: 'c1', rootId: 'r1' }), reply({ id: 'c2', rootId: 'r1', created_at: 2500 })],
    )
    assert.equal(rows.length, 1)
    assert.equal(rows[0].replyCount, 2)
    assert.equal(rows[0].lastActivityAt, 2500)
})

test('ohne Antwort ist die letzte Aktivität die Wurzel selbst', () => {
    const rows = buildForumTopics([root({ id: 'r1', created_at: 1234 })], [])
    assert.equal(rows[0].replyCount, 0)
    assert.equal(rows[0].lastActivityAt, 1234)
})

test('eine Antwort OHNE auflösbare Wurzel erscheint NICHT als eigenes Thema', () => {
    const rows = buildForumTopics(
        [root({ id: 'r1' })],
        [reply({ id: 'c1', rootId: 'fremd' }), reply({ id: 'c2', rootId: 'r1' })],
    )
    assert.deepEqual(rows.map((row) => row.id), ['r1'])
    assert.equal(rows[0].replyCount, 1)
})

test('eine „Antwort" auf sich selbst zählt nicht', () => {
    const rows = buildForumTopics([root({ id: 'r1' })], [reply({ id: 'r1', rootId: 'r1' })])
    assert.equal(rows[0].replyCount, 0)
})

test('sortiert nach LETZTER AKTIVITÄT, nicht nach Erstellung', () => {
    const rows = buildForumTopics(
        [root({ id: 'alt', created_at: 100 }), root({ id: 'neu', created_at: 900 })],
        [reply({ id: 'c1', rootId: 'alt', created_at: 5000 })],
    )
    assert.deepEqual(rows.map((row) => row.id), ['alt', 'neu'])
})

test('bei gleicher Aktivität entscheidet die id — die Reihenfolge ist stabil', () => {
    const a = buildForumTopics([root({ id: 'b1' }), root({ id: 'a1' })], [])
    const b = buildForumTopics([root({ id: 'a1' }), root({ id: 'b1' })], [])
    assert.deepEqual(a.map((row) => row.id), ['a1', 'b1'])
    assert.deepEqual(a.map((row) => row.id), b.map((row) => row.id))
})

test('Gesichter: neueste Antwortende zuerst, ohne Wiederholung, gedeckelt', () => {
    const rows = buildForumTopics(
        [root({ id: 'r1' })],
        [
            reply({ id: 'c1', rootId: 'r1', pubkey: 'p1', created_at: 10 }),
            reply({ id: 'c2', rootId: 'r1', pubkey: 'p2', created_at: 20 }),
            reply({ id: 'c3', rootId: 'r1', pubkey: 'p2', created_at: 30 }),
            reply({ id: 'c4', rootId: 'r1', pubkey: 'p3', created_at: 40 }),
            reply({ id: 'c5', rootId: 'r1', pubkey: 'p4', created_at: 50 }),
            reply({ id: 'c6', rootId: 'r1', pubkey: 'p5', created_at: 60 }),
        ],
    )
    assert.deepEqual(rows[0].faces, ['p5', 'p4', 'p3'])
    assert.equal(rows[0].faces.length, FORUM_FACE_CAP)
})

test('dieselbe Wurzel zweimal geliefert ergibt EINE Zeile', () => {
    const rows = buildForumTopics([root({ id: 'r1' }), root({ id: 'r1' })], [])
    assert.equal(rows.length, 1)
})

// ── Bewertungen: die Falt-Regel ─────────────────────────────────────────────
//
// Der Relay hat für 45002 KEINE Dedup (im Gegensatz zu NIP-25-Reaktionen, die
// `insert_reaction_event_with_thread_metadata` mit `ON CONFLICT` bekommen). Zwei
// Stimmen desselben Pubkeys auf dasselbe Ziel sind zwei gültige, beide gespeicherte
// Ereignisse — was hier geprüft wird, ist die einzige Stelle, an der sie wieder zu
// EINER werden.

const vote = (over: Partial<ForumVoteInput> & { id: string; targetId: string }): ForumVoteInput => ({
    pubkey: 'v'.repeat(64),
    created_at: 3000,
    content: VOTE_UP,
    ...over,
})

const ZIELE = new Set(['r1', 'r2'])

test('zwei Stimmen desselben Pubkeys auf dasselbe Ziel zaehlen EINMAL — die juengere gewinnt', () => {
    const tallies = foldForumVotes(
        [
            vote({ id: 'v1', targetId: 'r1', content: VOTE_UP, created_at: 100 }),
            vote({ id: 'v2', targetId: 'r1', content: VOTE_DOWN, created_at: 200 }),
        ],
        ZIELE,
    )
    const r1 = tallies.get('r1')
    assert.equal(r1?.up, 0, 'die aeltere Zustimmung darf nicht mitzaehlen')
    assert.equal(r1?.down, 1)
    assert.equal(r1?.score, -1, 'naives Summieren ergaebe hier 0 statt -1')
})

test('zweimal DIESELBE Richtung bewegt den Punktstand um nichts', () => {
    const tallies = foldForumVotes(
        [
            vote({ id: 'v1', targetId: 'r1', created_at: 100 }),
            vote({ id: 'v2', targetId: 'r1', created_at: 200 }),
        ],
        ZIELE,
    )
    assert.equal(tallies.get('r1')?.score, 1)
    assert.equal(tallies.get('r1')?.up, 1)
})

test('bei gleicher Sekunde entscheidet die id — deterministisch, nicht Eingangsreihenfolge', () => {
    // Am Relay ist Sekundengleichheit der Normalfall (±900-s-Fenster, ganze Sekunden).
    // Die kleinere id gewinnt, dieselbe Richtung wie die Antwort-Sortierung oben.
    const beide: ForumVoteInput[] = [
        vote({ id: 'a', targetId: 'r1', content: VOTE_UP, created_at: 500 }),
        vote({ id: 'b', targetId: 'r1', content: VOTE_DOWN, created_at: 500 }),
    ]
    const vorwaerts = foldForumVotes(beide, ZIELE)
    const rueckwaerts = foldForumVotes([...beide].reverse(), ZIELE)
    assert.equal(vorwaerts.get('r1')?.score, 1, 'die kleinere id (`a`, ein +) muss gewinnen')
    assert.equal(rueckwaerts.get('r1')?.score, vorwaerts.get('r1')?.score, 'die Eingangsreihenfolge darf nichts aendern')
})

test('ein `content` ausserhalb `+`/`-` wird VERWORFEN — und stuerzt keine gueltige Stimme', () => {
    const tallies = foldForumVotes(
        [
            vote({ id: 'v1', targetId: 'r1', content: VOTE_UP, created_at: 100 }),
            // Juenger, aber unlesbar: der Relay prueft `content` nicht, also kommt so
            // etwas real an. Es darf die aeltere gueltige Stimme NICHT ueberstimmen —
            // sonst waere „Muell schreiben" ein Weg, fremde Stimmen zu loeschen.
            vote({ id: 'v2', targetId: 'r1', content: '👍', created_at: 200 }),
            vote({ id: 'v3', targetId: 'r2', content: '', created_at: 200 }),
        ],
        ZIELE,
    )
    assert.equal(tallies.get('r1')?.score, 1)
    assert.equal(tallies.get('r1')?.up, 1)
    assert.equal(tallies.has('r2'), false, 'ein Ziel ohne einzige lesbare Stimme hat gar keinen Eintrag')
})

test('eine Stimme auf ein NICHT-Forum-Ziel wird verworfen', () => {
    const tallies = foldForumVotes(
        [
            vote({ id: 'v1', targetId: 'r1' }),
            vote({ id: 'v2', targetId: 'eine-chat-nachricht' }),
        ],
        ZIELE,
    )
    assert.equal(tallies.get('r1')?.score, 1)
    assert.equal(tallies.has('eine-chat-nachricht'), false)
    assert.equal(tallies.size, 1)
})

test('verschiedene Pubkeys zaehlen einzeln — die Faltung ist je (pubkey, ziel)', () => {
    const tallies = foldForumVotes(
        [
            vote({ id: 'v1', targetId: 'r1', pubkey: 'p1' }),
            vote({ id: 'v2', targetId: 'r1', pubkey: 'p2' }),
            vote({ id: 'v3', targetId: 'r1', pubkey: 'p3', content: VOTE_DOWN }),
        ],
        ZIELE,
    )
    assert.equal(tallies.get('r1')?.up, 2)
    assert.equal(tallies.get('r1')?.down, 1)
    assert.equal(tallies.get('r1')?.score, 1)
})

test('`mine` traegt NUR die eigene Stimme — und ohne Pubkey gar keine', () => {
    const stimmen = [
        vote({ id: 'v1', targetId: 'r1', pubkey: 'ich', content: VOTE_DOWN }),
        vote({ id: 'v2', targetId: 'r1', pubkey: 'andere' }),
    ]
    assert.equal(foldForumVotes(stimmen, ZIELE, 'ich').get('r1')?.mine, -1)
    assert.equal(foldForumVotes(stimmen, ZIELE, 'andere').get('r1')?.mine, 1)
    assert.equal(foldForumVotes(stimmen, ZIELE).get('r1')?.mine, 0, 'ein Gast hat keine eigene Stimme')
})

test('EMPTY_TALLY ist unveraenderlich — sonst schriebe eine Zeile in die naechste', () => {
    // Er wird von JEDER Zeile ohne Stimmen geteilt; waere er beschreibbar, faerbte ein
    // einziges `+= 1` irgendwo den Punktstand aller unbewerteten Themen.
    assert.throws(() => {
        ;(EMPTY_TALLY as { up: number }).up = 5
    }, TypeError)
})

// ── Bewertungen in der Themenliste ──────────────────────────────────────────

test('die Zeile traegt den gefalteten Punktstand, nicht die Zahl der Ereignisse', () => {
    const rows = buildForumTopics(
        [root({ id: 'r1' })],
        [],
        [
            vote({ id: 'v1', targetId: 'r1', pubkey: 'p1', created_at: 10 }),
            vote({ id: 'v2', targetId: 'r1', pubkey: 'p1', created_at: 20 }),
            vote({ id: 'v3', targetId: 'r1', pubkey: 'p2', content: VOTE_DOWN }),
        ],
        'p1',
    )
    assert.equal(rows[0].upCount, 1, 'drei Ereignisse, zwei Waehler, eine Zustimmung')
    assert.equal(rows[0].downCount, 1)
    assert.equal(rows[0].score, 0)
    assert.equal(rows[0].myVote, 1)
})

test('eine Stimme auf eine ANTWORT zaehlt nicht auf das Thema', () => {
    const rows = buildForumTopics(
        [root({ id: 'r1' })],
        [reply({ id: 'c1', rootId: 'r1' })],
        [vote({ id: 'v1', targetId: 'c1' })],
    )
    assert.equal(rows[0].score, 0, 'die Antwort ist ein eigenes Ziel, kein Aufschlag auf die Wurzel')
})

test('ohne Bewertungen steht die Zeile auf null — der Bestandsaufrufer bleibt gueltig', () => {
    const rows = buildForumTopics([root({ id: 'r1' })], [])
    assert.equal(rows[0].score, 0)
    assert.equal(rows[0].upCount, 0)
    assert.equal(rows[0].downCount, 0)
    assert.equal(rows[0].myVote, 0)
})

// ── Sortierung ──────────────────────────────────────────────────────────────

test('FORUM_SORTS traegt WOERTLICH zwei Ordnungen, in dieser Reihenfolge', () => {
    assert.deepEqual([...FORUM_SORTS], ['activity', 'score'])
    assert.equal(FORUM_SORTS.length, 2)
})

test('DEFAULT_FORUM_SORT ist WOERTLICH `activity` — ein Forum ist keine Bestenliste', () => {
    assert.equal(DEFAULT_FORUM_SORT, 'activity')
    assert.equal(FORUM_SORTS.includes(DEFAULT_FORUM_SORT), true)
})

test('die Ordnung ist UMSCHALTBAR: dieselben Zeilen, zwei verschiedene Folgen', () => {
    const rows = buildForumTopics(
        [
            root({ id: 'alt', created_at: 100 }),
            root({ id: 'neu', created_at: 900 }),
        ],
        [reply({ id: 'c1', rootId: 'neu', created_at: 5000 })],
        [
            vote({ id: 'v1', targetId: 'alt', pubkey: 'p1' }),
            vote({ id: 'v2', targetId: 'alt', pubkey: 'p2' }),
        ],
    )
    assert.deepEqual(sortForumTopics(rows, 'activity').map((row) => row.id), ['neu', 'alt'])
    assert.deepEqual(sortForumTopics(rows, 'score').map((row) => row.id), ['alt', 'neu'])
})

test('`buildForumTopics` liefert die DEFAULT-Ordnung — nicht die zuletzt gewaehlte', () => {
    const rows = buildForumTopics(
        [root({ id: 'alt', created_at: 100 }), root({ id: 'neu', created_at: 900 })],
        [],
        [vote({ id: 'v1', targetId: 'alt' })],
    )
    assert.deepEqual(rows.map((row) => row.id), ['neu', 'alt'])
})

test('Punktgleichstand faellt auf Aktivitaet und dann auf die id zurueck — total, nicht zufaellig', () => {
    // Ohne die zweite Stufe saehe ein Forum ohne eine einzige Stimme unter „Punkte" wie
    // eine gemischte Liste aus: alle Punktstaende 0, und die Eingangsreihenfolge ist eine
    // Emit-Reihenfolge des Repositorys, keine Zusage.
    const rows = buildForumTopics(
        [root({ id: 'b', created_at: 100 }), root({ id: 'a', created_at: 100 }), root({ id: 'c', created_at: 300 })],
        [],
    )
    assert.deepEqual(sortForumTopics(rows, 'score').map((row) => row.id), ['c', 'a', 'b'])
})

test('`sortForumTopics` laesst die Eingabe unangetastet', () => {
    const rows = buildForumTopics([root({ id: 'a1' }), root({ id: 'b1' })], [])
    const vorher = rows.map((row) => row.id)
    sortForumTopics(rows, 'score')
    assert.deepEqual(rows.map((row) => row.id), vorher)
})

// ── Der Riegel: Blade gegen die Konstante ───────────────────────────────────
//
// Dieselbe Bauform und derselbe Grund wie in `articleSorts.test.ts`: die Werte stehen
// ein zweites Mal im Markup (PHP und TypeScript teilen zur Laufzeit nichts), und ein
// Tippfehler dort faellt zur Laufzeit still auf die Default-Ordnung zurueck.

const SORT_BLADE = join(import.meta.dirname, '..', 'resources', 'views', 'partials', 'forum-sortierung.blade.php')

/**
 * Die `wert`-Eintraege aus dem `$ordnungen`-Block des Partials.
 *
 * **Findet die Sonde ihren Block nicht, wirft sie** — eine Sonde, die bei unlesbarer
 * Eingabe „nichts gefunden" meldet, ist fail-open und saehe nach einem Umbau des Markups
 * wie ein bestandener Test aus.
 */
const ordnungenAusBlade = (): string[] => {
    const quelle = readFileSync(SORT_BLADE, 'utf8')
    const block = /\$ordnungen\s*=\s*\[([\s\S]*?)\]\)/.exec(quelle)
    if (!block) {
        throw new Error(`Kein $ordnungen-Block in ${SORT_BLADE} gefunden — die Sonde misst nichts mehr.`)
    }

    return [...block[1]!.matchAll(/'wert'\s*=>\s*'([^']*)'/g)].map((treffer) => treffer[1]!)
}

test('die Sonde findet ihren Block ueberhaupt — sonst ist jede Aussage darunter wertlos', () => {
    assert.equal(ordnungenAusBlade().length >= 2, true, 'Der $ordnungen-Block liefert weniger als zwei Werte.')
})

test('RIEGEL: die Ordnungswerte im Umschalter sind identisch mit FORUM_SORTS — Reihenfolge inklusive', () => {
    assert.deepEqual(ordnungenAusBlade(), [...FORUM_SORTS])
})

test('jeder Wert aus dem Blade ist eine gueltige ForumSort — kein Tippfehler rutscht durch', () => {
    for (const wert of ordnungenAusBlade() satisfies string[]) {
        assert.equal(
            (FORUM_SORTS as readonly string[]).includes(wert),
            true,
            `„${wert}" steht im Umschalter, ist aber keine ForumSort — sortForumTopics faellt darauf still auf „${DEFAULT_FORUM_SORT satisfies ForumSort}" zurueck.`,
        )
    }
})

// ── Rücknahme (NIP-09-Grabstein auf die eigene Stimme) ──────────────────────
//
// Die Fläche bietet drei Zustände: `+`, `−` und KEINE Stimme. Der Weg zurück ist ein
// kind 5 auf die Ereignis-Id der Stimme. Dass welshman das trägt, ist keine Annahme:
// `Repository.isDeletedById` vergleicht **kein** `created_at` (der Kommentar der
// Implementierung nennt genau diesen Fall), und `isDeletedByAddress` — die Fassung MIT
// Vergleich — gilt nur für adressierbare Kinds, zu denen 45002 nicht gehört.

const grabstein = (
    over: Partial<ForumTombstoneInput> & { targetIds: readonly string[] },
): ForumTombstoneInput => ({
    pubkey: 'v'.repeat(64),
    created_at: 4000,
    ...over,
})

test('ein zurueckgenommener Vote zaehlt NICHT mehr', () => {
    const tallies = foldForumVotes(
        [vote({ id: 'v1', targetId: 'r1' })],
        ZIELE,
        '',
        [grabstein({ targetIds: ['v1'] })],
    )
    assert.equal(tallies.has('r1'), false, 'ohne verbleibende Stimme gibt es gar keinen Eintrag')
})

test('die Ruecknahme wirkt auch dann, wenn das Repository die Stimme noch liefert', () => {
    // Der Grund, warum diese Regel hier steht und nicht dem Repository ueberlassen ist:
    // `deriveEventsByIdForUrl` fuegt im `tracker.add`-Zweig ein Ereignis per Id wieder
    // ein, OHNE `isDeleted` zu fragen. Dann liegt die geloeschte Stimme in genau dieser
    // Liste — und ohne diese Regel zaehlte sie wieder mit.
    const tallies = foldForumVotes(
        [vote({ id: 'v1', targetId: 'r1', pubkey: 'p1' }), vote({ id: 'v2', targetId: 'r1', pubkey: 'p2' })],
        ZIELE,
        '',
        [grabstein({ pubkey: 'p1', targetIds: ['v1'] })],
    )
    assert.equal(tallies.get('r1')?.up, 1, 'nur die Stimme von p2 bleibt')
    assert.equal(tallies.get('r1')?.score, 1)
})

test('ein FREMDER Grabstein loescht meine Stimme nicht', () => {
    // Autorenpruefung wie in `Repository.isDeletedById` (`some(spec({pubkey: …}))`).
    // Ohne sie koennte jeder jede Stimme dieser Flaeche mit einem kind 5 entfernen, das
    // der Relay selbst nie ausgefuehrt haette.
    const tallies = foldForumVotes(
        [vote({ id: 'v1', targetId: 'r1', pubkey: 'p1' })],
        ZIELE,
        '',
        [grabstein({ pubkey: 'angreifer', targetIds: ['v1'] })],
    )
    assert.equal(tallies.get('r1')?.score, 1)
})

test('die Ruecknahme in DERSELBEN Sekunde wirkt — kein `created_at`-Vergleich', () => {
    // Genau der Fall, an dem die erste P3-Fassung vorbeigebaut hat. Ein Fehlklick wird
    // Sekunden spaeter zurueckgenommen, und `created_at` ist ganzsekuendig.
    const tallies = foldForumVotes(
        [vote({ id: 'v1', targetId: 'r1', created_at: 500 })],
        ZIELE,
        '',
        [grabstein({ targetIds: ['v1'], created_at: 500 })],
    )
    assert.equal(tallies.has('r1'), false)
})

test('eine Ruecknahme auf einem ANDEREN Ziel laesst meine Stimme hier in Ruhe', () => {
    // Der Grabstein nennt eine Stimm-Id und traegt keinen Bezug zum Thema. Wer daraus
    // eine Regel „alles Aeltere dieses Autors ist weg" machte, loeschte seine Stimmen
    // auf FREMDEN Themen gleich mit — deshalb wirkt hier nur die Id.
    const tallies = foldForumVotes(
        [
            vote({ id: 'v1', targetId: 'r1', created_at: 100 }),
            vote({ id: 'v2', targetId: 'r2', created_at: 200 }),
        ],
        ZIELE,
        '',
        [grabstein({ targetIds: ['v2'], created_at: 300 })],
    )
    assert.equal(tallies.get('r1')?.score, 1, 'die aeltere Stimme auf dem anderen Thema bleibt')
    assert.equal(tallies.has('r2'), false)
})

test('`mineIds` traegt ALLE eigenen Stimmen auf dem Ziel, neueste zuerst', () => {
    // Das ist die Liste, die eine Ruecknahme abarbeiten muss. Nur die Gewinnerin zu
    // loeschen liesse die davor wieder gewinnen — aus „zurueckgenommen" wuerde
    // „Meinung geaendert".
    const tallies = foldForumVotes(
        [
            vote({ id: 'alt', targetId: 'r1', pubkey: 'ich', content: VOTE_UP, created_at: 100 }),
            vote({ id: 'neu', targetId: 'r1', pubkey: 'ich', content: VOTE_DOWN, created_at: 200 }),
            vote({ id: 'fremd', targetId: 'r1', pubkey: 'andere' }),
        ],
        ZIELE,
        'ich',
    )
    assert.deepEqual(tallies.get('r1')?.mineIds, ['neu', 'alt'])
    assert.equal(tallies.get('r1')?.mine, -1, '`mineIds[0]` ist die Stimme, die der Pfeil zeigt')
})

test('nach der Ruecknahme ALLER eigenen Stimmen lebt die vorherige nicht wieder auf', () => {
    // Der Fall, gegen den `mineIds` gebaut ist: `+`, dann `−`, dann zurueckgenommen.
    // Beide Grabsteine zusammen ergeben „keine Stimme"; nur der auf `neu` ergaebe `+`.
    const stimmen = [
        vote({ id: 'alt', targetId: 'r1', pubkey: 'ich', content: VOTE_UP, created_at: 100 }),
        vote({ id: 'neu', targetId: 'r1', pubkey: 'ich', content: VOTE_DOWN, created_at: 200 }),
    ]
    const nurNeu = foldForumVotes(stimmen, ZIELE, 'ich', [grabstein({ pubkey: 'ich', targetIds: ['neu'] })])
    assert.equal(nurNeu.get('r1')?.mine, 1, 'Gegenprobe: EIN Grabstein laesst die alte Stimme gewinnen')

    const beide = foldForumVotes(stimmen, ZIELE, 'ich', [
        grabstein({ pubkey: 'ich', targetIds: ['neu'] }),
        grabstein({ pubkey: 'ich', targetIds: ['alt'] }),
    ])
    assert.equal(beide.has('r1'), false)
})

test('`mineIds` enthaelt keine zurueckgenommene Stimme — sonst schriebe die Ruecknahme sie erneut', () => {
    const tallies = foldForumVotes(
        [
            vote({ id: 'weg', targetId: 'r1', pubkey: 'ich', created_at: 100 }),
            vote({ id: 'da', targetId: 'r1', pubkey: 'ich', created_at: 200 }),
        ],
        ZIELE,
        'ich',
        [grabstein({ pubkey: 'ich', targetIds: ['weg'] })],
    )
    assert.deepEqual(tallies.get('r1')?.mineIds, ['da'])
})

test('die Zeile reicht `myVoteIds` durch — der Schreibpfad liest nichts anderes', () => {
    const rows = buildForumTopics(
        [root({ id: 'r1' })],
        [],
        [vote({ id: 'v1', targetId: 'r1', pubkey: 'ich' })],
        'ich',
    )
    assert.deepEqual(rows[0].myVoteIds, ['v1'])
    assert.equal(rows[0].myVote, 1)

    const zurueck = buildForumTopics(
        [root({ id: 'r1' })],
        [],
        [vote({ id: 'v1', targetId: 'r1', pubkey: 'ich' })],
        'ich',
        [grabstein({ pubkey: 'ich', targetIds: ['v1'] })],
    )
    assert.deepEqual(zurueck[0].myVoteIds, [])
    assert.equal(zurueck[0].myVote, 0)
    assert.equal(zurueck[0].score, 0)
})
