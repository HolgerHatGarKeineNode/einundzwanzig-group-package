/**
 * Pure tests of the vote write plan — the gate, the refusals and the event shape.
 *
 *   node --experimental-strip-types --test packages/einundzwanzig-group/js/forumVoteModels.test.ts
 *
 * **What this file exists to prove is a NEGATIVE**: that `mayWriteKind` runs before an
 * event body exists. A gate call whose result is dropped looks exactly like one that is
 * honoured, so an AST scan over the write path cannot tell them apart. Here the gate's
 * answer *is* the return value, and the promise becomes an assertion.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { FORUM_VOTE, VOTE_DOWN, VOTE_UP } from './forumModels.ts'
import { buildVoteTags, planForumVote } from './forumVoteModels.ts'

const H = '3f2a1c88-0000-4000-8000-000000000001'
const TARGET = 'a'.repeat(64)

// ── Der Riegel ──────────────────────────────────────────────────────────────

test('auf einem BUZZ-Space wird gebaut — das ist die Gegenprobe zu allem darunter', () => {
    // Ohne diesen Fall belegte jedes `null` weiter unten nur, dass die Funktion immer
    // `null` liefert.
    const plan = planForumVote(0, 1, H, TARGET, 'buzz')
    assert.notEqual(plan, null)
    assert.equal(plan?.kind, FORUM_VOTE)
})

test('auf einem zooid-Space wird NICHT gebaut — dort waere ein 45002 dauerhafter Muell', () => {
    // zooid hat keine Kind-Allowlist: es nimmt das Ereignis AN, speichert es und liefert
    // es aus. Niemand liest es je, und niemand sammelt es wieder ein.
    assert.equal(planForumVote(0, 1, H, TARGET, 'other'), null)
})

test('`unknown` sperrt — solange das NIP-11-Doc unterwegs ist, wird nicht geraten', () => {
    assert.equal(planForumVote(0, 1, H, TARGET, 'unknown'), null)
    assert.equal(planForumVote(0, -1, H, TARGET, 'unknown'), null)
})

// ── Die Ereignisform ────────────────────────────────────────────────────────

test('`content` ist WOERTLICH `+` bzw. `-` — nichts anderes verlaesst diese Funktion', () => {
    assert.equal(planForumVote(0, 1, H, TARGET, 'buzz')?.content, VOTE_UP)
    assert.equal(planForumVote(0, -1, H, TARGET, 'buzz')?.content, VOTE_DOWN)
})

test('die Tags sind `h` zuerst und GENAU EIN `e`', () => {
    const tags = planForumVote(0, 1, H, TARGET, 'buzz')?.tags ?? []
    assert.deepEqual(tags, [
        ['h', H],
        ['e', TARGET],
    ])
    // Der Grund für „genau eins", nicht bloss die Zahl: der Relay nimmt bei 45002 das
    // ERSTE passende `e`-Tag (`find_map` ohne `.rev()`), bei NIP-25-Reaktionen das
    // LETZTE. Bei einem einzigen Tag sind beide dasselbe und die Frage entfaellt.
    assert.equal(tags.filter((tag) => tag[0] === 'e').length, 1)
})

test('`buildVoteTags` ist die einzige Quelle dieser Form', () => {
    assert.deepEqual(buildVoteTags(H, TARGET), [
        ['h', H],
        ['e', TARGET],
    ])
})

// ── Die Verweigerungen ──────────────────────────────────────────────────────

test('ein zweiter Klick auf DIESELBE Richtung schreibt nichts', () => {
    // Der Riegel gegen die doppelte Zaehlung sitzt hier und nicht am Knopf: der Relay hat
    // fuer 45002 keine Dedup, ein zweites Ereignis waere dort eine zweite Zeile — die
    // Falt-Regel wuerfe sie zwar weg, aber erst NACH dem Signieren und Senden.
    assert.equal(planForumVote(1, 1, H, TARGET, 'buzz'), null)
    assert.equal(planForumVote(-1, -1, H, TARGET, 'buzz'), null)
})

test('der WECHSEL der Richtung wird sehr wohl geschrieben', () => {
    assert.equal(planForumVote(1, -1, H, TARGET, 'buzz')?.content, VOTE_DOWN)
    assert.equal(planForumVote(-1, 1, H, TARGET, 'buzz')?.content, VOTE_UP)
})

test('ohne Kanal-Uuid wird nicht gebaut — `h` ist am Relay Pflicht', () => {
    assert.equal(planForumVote(0, 1, '', TARGET, 'buzz'), null)
})

test('ein Ziel, das keine 64-stellige Hex-Id ist, wird abgelehnt', () => {
    // `validate_forum_vote_target` verlangt genau das (`ingest.rs:1001-1046`). Der Riegel
    // steht trotzdem hier: ein Ereignis, das der Relay ohnehin ablehnt, ist eine
    // Signatur-Anfrage an das Geraet des Nutzers, die niemand beantworten muss.
    assert.equal(planForumVote(0, 1, H, '', 'buzz'), null)
    assert.equal(planForumVote(0, 1, H, 'a'.repeat(63), 'buzz'), null)
    assert.equal(planForumVote(0, 1, H, 'A'.repeat(64), 'buzz'), null, 'Grossbuchstaben sind keine `to_hex()`-Ausgabe')
    assert.equal(planForumVote(0, 1, H, `${'a'.repeat(63)}z`, 'buzz'), null)
})
