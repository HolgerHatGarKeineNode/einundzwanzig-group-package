/**
 * Pure-Tests für die NIP-88-Poll-Logik (kind 1068 Poll, kind 1018 Response).
 *   node --test packages/einundzwanzig-group/js/polls.test.ts
 *
 * ── Warum es diese Datei erst seit P4 gibt ──────────────────────────────────────
 *
 * Sie ist der Regressionsträger für den Umstieg von der handgeschriebenen Poll-Logik
 * auf `PollReader` aus `@welshman/domain`. Der Plan setzte sie als bestehend voraus
 * („`polls.test.ts` grün plus zwei neue Fälle"); nachgesehen war die gesamte
 * Poll-Auswertung — Optionen, Typ, Laufzeit, Stimmenzählung — in **keiner** Testdatei
 * abgedeckt. Ein Umbau ohne sie hätte nur zeigen können, dass der Typecheck durchgeht.
 *
 * Die Fälle sind deshalb zuerst gegen die ALTE Implementierung geschrieben und dort grün
 * gelaufen; erst danach kam die Delegation an `PollReader`. Wer sie ändert, ändert die
 * Kalibrierung mit.
 *
 * ── Die zwei Fälle, um derentwillen eine Hülle existiert ────────────────────────
 *
 * Am Ende stehen zwei Fälle, die die Hülle gegen Upstream-Fehler in `domain.Poll`
 * absichern (Details in `polls.ts`). Sie sind der Grund, warum hier nicht direkt
 * `PollReader` verwendet wird; fallen sie weg, fällt die Begründung der Hülle mit.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { POLL, POLL_RESPONSE } from './welshmanKinds.ts'
import {
    getPollType,
    getPollOptions,
    getPollEndsAt,
    isPollClosed,
    getPollResponseSelections,
    getPollResults,
    ownPollSelection,
    pollResponseTarget,
    isPollShareQuote,
    QUOTE_PREFIX,
} from './polls.ts'
import type { TrustedEvent } from '@welshman/util'

const ALICE = 'a'.repeat(64)
const BOB = 'b'.repeat(64)
const CAROL = 'c'.repeat(64)

/** Eine kind-1068-Poll mit den übergebenen Tags. */
const poll = (tags: string[][], content = 'Lieblingsfarbe?'): TrustedEvent =>
    ({ id: '1'.repeat(64), pubkey: ALICE, created_at: 1_000, kind: POLL, tags, content, sig: '' }) as TrustedEvent

/** Eine kind-1018-Response von `pubkey` auf die Optionen `ids`. */
const antwort = (pubkey: string, ids: string[], created_at = 1_100): TrustedEvent =>
    ({
        id: '2'.repeat(64),
        pubkey,
        created_at,
        kind: POLL_RESPONSE,
        tags: [['e', '1'.repeat(64)], ...ids.map((id) => ['response', id])],
        content: '',
        sig: '',
    }) as TrustedEvent

const ZWEI_OPTIONEN = [
    ['option', 'rot', 'Rot'],
    ['option', 'blau', 'Blau'],
]

// ── Optionen ───────────────────────────────────────────────────────────────────

test('getPollOptions liest id und Label aus den option-Tags', () => {
    assert.deepEqual(getPollOptions(poll(ZWEI_OPTIONEN)), [
        { id: 'rot', label: 'Rot' },
        { id: 'blau', label: 'Blau' },
    ])
})

test('getPollOptions defaultet ein fehlendes Label auf die id', () => {
    assert.deepEqual(getPollOptions(poll([['option', 'rot']])), [{ id: 'rot', label: 'rot' }])
})

test('getPollOptions ignoriert Fremdtags', () => {
    const tags = [...ZWEI_OPTIONEN, ['h', 'raum'], ['polltype', 'singlechoice']]
    assert.equal(getPollOptions(poll(tags)).length, 2)
})

// ── Poll-Typ ───────────────────────────────────────────────────────────────────

test('getPollType: ohne Tag Einfachwahl, mit multiplechoice Mehrfachwahl', () => {
    assert.equal(getPollType(poll(ZWEI_OPTIONEN)), 'singlechoice')
    assert.equal(getPollType(poll([...ZWEI_OPTIONEN, ['polltype', 'singlechoice']])), 'singlechoice')
    assert.equal(getPollType(poll([...ZWEI_OPTIONEN, ['polltype', 'multiplechoice']])), 'multiplechoice')
})

// ── Laufzeit ───────────────────────────────────────────────────────────────────

test('getPollEndsAt liest den Timestamp und verwirft Unsinn', () => {
    assert.equal(getPollEndsAt(poll([...ZWEI_OPTIONEN, ['endsAt', '1700000000']])), 1_700_000_000)
    assert.equal(getPollEndsAt(poll(ZWEI_OPTIONEN)), undefined)
    assert.equal(getPollEndsAt(poll([...ZWEI_OPTIONEN, ['endsAt', 'morgen']])), undefined)
    assert.equal(getPollEndsAt(poll([...ZWEI_OPTIONEN, ['endsAt', '']])), undefined)
})

test('isPollClosed: abgelaufen ja, Zukunft nein, ohne endsAt nie', () => {
    const jetzt = Math.floor(Date.now() / 1000)
    assert.equal(isPollClosed(poll([...ZWEI_OPTIONEN, ['endsAt', String(jetzt - 60)]])), true)
    assert.equal(isPollClosed(poll([...ZWEI_OPTIONEN, ['endsAt', String(jetzt + 3_600)]])), false)
    assert.equal(isPollClosed(poll(ZWEI_OPTIONEN)), false)
    assert.equal(isPollClosed(poll([...ZWEI_OPTIONEN, ['endsAt', 'morgen']])), false)
})

// ── Auswahl einer Response ─────────────────────────────────────────────────────

test('getPollResponseSelections: Einfachwahl nimmt nur die erste', () => {
    assert.deepEqual(getPollResponseSelections(antwort(BOB, ['rot', 'blau']), 'singlechoice'), ['rot'])
})

test('getPollResponseSelections: Mehrfachwahl nimmt alle und dedupliziert', () => {
    assert.deepEqual(getPollResponseSelections(antwort(BOB, ['rot', 'blau', 'rot']), 'multiplechoice'), ['rot', 'blau'])
})

// ── Stimmenzählung ────────────────────────────────────────────────────────────

test('getPollResults zählt je Option und meldet die Wählerzahl', () => {
    const ergebnis = getPollResults(poll(ZWEI_OPTIONEN), [antwort(BOB, ['rot']), antwort(CAROL, ['blau'])])
    assert.deepEqual(ergebnis, {
        options: [
            { id: 'rot', label: 'Rot', votes: 1 },
            { id: 'blau', label: 'Blau', votes: 1 },
        ],
        voters: 2,
    })
})

test('getPollResults zählt pro Wähler nur die jüngste Response', () => {
    const ergebnis = getPollResults(poll(ZWEI_OPTIONEN), [
        antwort(BOB, ['rot'], 1_100),
        antwort(BOB, ['blau'], 1_200),
    ])
    assert.deepEqual(ergebnis.options.map((o) => o.votes), [0, 1])
    assert.equal(ergebnis.voters, 1)
})

test('getPollResults ignoriert Stimmen auf unbekannte Options-IDs', () => {
    const ergebnis = getPollResults(poll(ZWEI_OPTIONEN), [antwort(BOB, ['gruen'])])
    assert.deepEqual(ergebnis.options.map((o) => o.votes), [0, 0])
    assert.equal(ergebnis.voters, 1, 'der Wähler zählt trotzdem — er hat abgestimmt')
})

test('getPollResults: Mehrfachwahl summiert mehrere Optionen desselben Wählers', () => {
    const tags = [...ZWEI_OPTIONEN, ['polltype', 'multiplechoice']]
    const ergebnis = getPollResults(poll(tags), [antwort(BOB, ['rot', 'blau'])])
    assert.deepEqual(ergebnis.options.map((o) => o.votes), [1, 1])
    assert.equal(ergebnis.voters, 1)
})

test('getPollResults: Einfachwahl zählt trotz zweier response-Tags nur eine Stimme', () => {
    const ergebnis = getPollResults(poll(ZWEI_OPTIONEN), [antwort(BOB, ['rot', 'blau'])])
    assert.deepEqual(ergebnis.options.map((o) => o.votes), [1, 0])
})

test('getPollResults ohne Responses: alles null, niemand hat gewählt', () => {
    const ergebnis = getPollResults(poll(ZWEI_OPTIONEN), [])
    assert.deepEqual(ergebnis.options.map((o) => o.votes), [0, 0])
    assert.equal(ergebnis.voters, 0)
})

// ── eigene Stimme ─────────────────────────────────────────────────────────────

test('ownPollSelection liefert die jüngste eigene Wahl', () => {
    const responses = [antwort(BOB, ['rot'], 1_100), antwort(BOB, ['blau'], 1_200), antwort(CAROL, ['rot'], 1_300)]
    assert.deepEqual(ownPollSelection(poll(ZWEI_OPTIONEN), responses, BOB), ['blau'])
})

test('ownPollSelection ist leer ohne Pubkey und ohne eigene Stimme', () => {
    const responses = [antwort(CAROL, ['rot'])]
    assert.deepEqual(ownPollSelection(poll(ZWEI_OPTIONEN), responses, undefined), [])
    assert.deepEqual(ownPollSelection(poll(ZWEI_OPTIONEN), responses, null), [])
    assert.deepEqual(ownPollSelection(poll(ZWEI_OPTIONEN), responses, BOB), [])
})

test('pollResponseTarget liest das e-Tag, sonst leer', () => {
    assert.equal(pollResponseTarget(antwort(BOB, ['rot'])), '1'.repeat(64))
    assert.equal(pollResponseTarget({ ...antwort(BOB, ['rot']), tags: [] } as TrustedEvent), '')
})

// ── Share-Quote ───────────────────────────────────────────────────────────────

test('isPollShareQuote erkennt die reine Zitat-Nachricht', () => {
    const ids = new Set(['1'.repeat(64)])
    const quote = (content: string, q = '1'.repeat(64)) =>
        ({ id: '9'.repeat(64), pubkey: ALICE, created_at: 1, kind: 9, tags: [['q', q]], content, sig: '' }) as TrustedEvent

    assert.equal(isPollShareQuote(quote('nostr:note1abcdef\n\n'), ids), true)
    assert.equal(isPollShareQuote(quote('nostr:note1abcdef\n\nmein Kommentar'), ids), false, 'echtes Textzitat bleibt sichtbar')
    assert.equal(isPollShareQuote(quote('nostr:note1abcdef\n\n', 'f'.repeat(64)), ids), false, 'q zeigt auf eine fremde Poll')
})

test('QUOTE_PREFIX greift nur am Anfang und nur bei nevent/note', () => {
    assert.match('nostr:nevent1abc\n\n', QUOTE_PREFIX)
    assert.match('nostr:note1abc\n\n', QUOTE_PREFIX)
    assert.doesNotMatch('Text davor nostr:note1abc\n\n', QUOTE_PREFIX)
    assert.doesNotMatch('nostr:npub1abc\n\n', QUOTE_PREFIX)
})

// ── Die zwei Fälle, um derentwillen die Hülle existiert ───────────────────────
//
// Sie prüfen NICHT unsere Regeln, sondern dass die Normalisierung vor `PollReader`
// greift. Ohne sie wäre nicht belegt, dass die Hülle etwas tut — und die nächste
// Aufräum-Runde entfernte sie als überflüssige Schicht. Beide Erwartungen sind gegen
// das installierte `@welshman/domain` gemessen; das ungeschützte Verhalten steht als
// Kommentar dabei, damit ein späterer Upstream-Fix hier sichtbar wird statt still.

test('R5-Abweichung 1: ein nacktes option-Tag erzeugt KEINE namenlose Geist-Option', () => {
    // PollReader.options() ungeschützt: [{}, {id:"blau",label:"Blau"}]
    const kaputt = poll([['option'], ['option', 'blau', 'Blau']])

    assert.deepEqual(getPollOptions(kaputt), [{ id: 'blau', label: 'Blau' }])

    // …und sie darf auch nicht durch results() zurückkommen:
    // PollReader.results() ungeschützt: options[0] === {votes: 0}
    const ergebnis = getPollResults(kaputt, [antwort(BOB, ['blau'])])
    assert.equal(ergebnis.options.length, 1)
    assert.deepEqual(ergebnis.options, [{ id: 'blau', label: 'Blau', votes: 1 }])
    assert.equal(ergebnis.voters, 1)
})

test('R5-Abweichung 2: ein unbekannter polltype fällt auf Einfachwahl, nicht auf Mehrfachwahl', () => {
    // PollReader.pollType() ungeschützt: "quatsch" — und results() vergleicht
    // `pollType === "singlechoice"`, zählt also im Mehrfachwahl-Zweig.
    const kaputt = poll([...ZWEI_OPTIONEN, ['polltype', 'quatsch']])

    assert.equal(getPollType(kaputt), 'singlechoice')

    // Ein Wähler mit zwei response-Tags bekäme sonst ZWEI Stimmen.
    const ergebnis = getPollResults(kaputt, [antwort(BOB, ['rot', 'blau'])])
    assert.deepEqual(
        ergebnis.options.map((o) => o.votes),
        [1, 0],
        'Einfachwahl zählt nur die erste Auswahl',
    )
    assert.equal(ergebnis.voters, 1)

    // Gegenprobe: ein GÜLTIGES multiplechoice muss weiterhin beide zählen —
    // die Normalisierung darf nicht pauschal alles auf Einfachwahl drücken.
    const echt = poll([...ZWEI_OPTIONEN, ['polltype', 'multiplechoice']])
    assert.deepEqual(
        getPollResults(echt, [antwort(BOB, ['rot', 'blau'])]).options.map((o) => o.votes),
        [1, 1],
    )
})
