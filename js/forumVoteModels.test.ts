/**
 * Pure tests of the vote write plan — the gate, the three kinds of click, the refusals
 * and the event shapes.
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
import { DELETE } from './welshmanKinds.ts'
import { buildRetractionTags, buildVoteTags, planForumVote } from './forumVoteModels.ts'

const H = '3f2a1c88-0000-4000-8000-000000000001'
const TARGET = 'a'.repeat(64)
const MY_VOTE = 'b'.repeat(64)
const MY_OLDER_VOTE = 'c'.repeat(64)

// ── Der Riegel ──────────────────────────────────────────────────────────────

test('auf einem BUZZ-Space wird gebaut — das ist die Gegenprobe zu allem darunter', () => {
    // Ohne diesen Fall belegte jedes `null` weiter unten nur, dass die Funktion immer
    // `null` liefert.
    const plan = planForumVote(0, [], 1, H, TARGET, 'buzz')
    assert.equal(plan?.action, 'cast')
    assert.equal(plan?.events[0]?.kind, FORUM_VOTE)
})

test('auf einem zooid-Space wird NICHT gebaut — dort waere ein 45002 dauerhafter Muell', () => {
    // zooid hat keine Kind-Allowlist: es nimmt das Ereignis AN, speichert es und liefert
    // es aus. Niemand liest es je, und niemand sammelt es wieder ein.
    assert.equal(planForumVote(0, [], 1, H, TARGET, 'other'), null)
})

test('`unknown` sperrt — solange das NIP-11-Doc unterwegs ist, wird nicht geraten', () => {
    assert.equal(planForumVote(0, [], 1, H, TARGET, 'unknown'), null)
    assert.equal(planForumVote(0, [], -1, H, TARGET, 'unknown'), null)
})

test('der Riegel gilt AUCH fuer die Ruecknahme — sie ist ein Schreibvorgang wie jeder andere', () => {
    // Gefragt wird nach 45002 und nicht nach kind 5: kind 5 steht bewusst nicht in der
    // Tabelle und wuerde ueberall `false` liefern, die Ruecknahme waere also unmoeglich
    // statt sicher. Die Begruendung steht bei `planForumVote`.
    assert.equal(planForumVote(1, [MY_VOTE], 1, H, TARGET, 'other'), null)
    assert.equal(planForumVote(1, [MY_VOTE], 1, H, TARGET, 'unknown'), null)
    assert.equal(planForumVote(1, [MY_VOTE], 1, H, TARGET, 'buzz')?.action, 'retract')
})

// ── Die Ereignisform: Stimme ────────────────────────────────────────────────

test('`content` ist WOERTLICH `+` bzw. `-` — nichts anderes verlaesst diese Funktion', () => {
    assert.equal(planForumVote(0, [], 1, H, TARGET, 'buzz')?.events[0]?.content, VOTE_UP)
    assert.equal(planForumVote(0, [], -1, H, TARGET, 'buzz')?.events[0]?.content, VOTE_DOWN)
})

test('die Tags einer Stimme sind `h` zuerst und GENAU EIN `e`', () => {
    const tags = planForumVote(0, [], 1, H, TARGET, 'buzz')?.events[0]?.tags ?? []
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

// ── Die Ereignisform: Rücknahme ─────────────────────────────────────────────

test('ein Klick auf den bereits gedrueckten Pfeil NIMMT ZURUECK — kind 5 auf die Stimme', () => {
    const plan = planForumVote(1, [MY_VOTE], 1, H, TARGET, 'buzz')
    assert.equal(plan?.action, 'retract')
    assert.equal(plan?.events.length, 1)
    assert.equal(plan?.events[0]?.kind, DELETE)
    assert.equal(plan?.events[0]?.content, '')
    assert.deepEqual(plan?.events[0]?.tags, [
        ['k', String(FORUM_VOTE)],
        // Das Ziel ist die eigene STIMME, nicht das Thema. Ein `e`-Tag auf das Thema
        // waere eine Loeschung des Themas — der Relay fuehrt sie kind-agnostisch aus.
        ['e', MY_VOTE],
        ['h', H],
    ])
})

test('die Ruecknahme trifft GENAU EIN Ziel je Grabstein — Buzz nimmt nicht mehr', () => {
    // `ingest.rs:2477-2489`. Zwei `e`-Tags in einem kind 5 waeren deshalb kein
    // Doppelschlag, sondern ein abgelehntes oder halb ausgefuehrtes Ereignis.
    const plan = planForumVote(-1, [MY_VOTE, MY_OLDER_VOTE], -1, H, TARGET, 'buzz')
    assert.equal(plan?.events.length, 2, 'zwei eigene Stimmen ergeben ZWEI Grabsteine')
    for (const body of plan?.events ?? []) {
        assert.equal(body.tags.filter((tag) => tag[0] === 'e').length, 1)
    }
    assert.deepEqual(
        plan?.events.map((body) => body.tags.find((tag) => tag[0] === 'e')?.[1]),
        [MY_VOTE, MY_OLDER_VOTE],
        'in der Reihenfolge der Liste — neueste zuerst',
    )
})

test('`buildRetractionTags` ist die einzige Quelle dieser Form', () => {
    assert.deepEqual(buildRetractionTags(H, MY_VOTE), [
        ['k', String(FORUM_VOTE)],
        ['e', MY_VOTE],
        ['h', H],
    ])
})

test('eine kaputte Stimm-Id faellt aus der Ruecknahme, der Rest laeuft weiter', () => {
    const plan = planForumVote(1, ['nicht-hex', MY_VOTE], 1, H, TARGET, 'buzz')
    assert.equal(plan?.events.length, 1)
    assert.equal(plan?.events[0]?.tags.find((tag) => tag[0] === 'e')?.[1], MY_VOTE)
})

// ── Die Verweigerungen ──────────────────────────────────────────────────────

test('die Ruecknahme dessen, was nie abgegeben wurde, schreibt nichts', () => {
    // Zwei Wege in denselben Zustand: gar keine Stimme, oder eine Stimme ohne bekannte
    // Id. Beide sind ein Schreibvorgang ohne Wirkung — und ein kind 5 ohne Ziel waere
    // ein signiertes Ereignis, das nichts tut und trotzdem fuer immer beim Relay liegt.
    assert.equal(planForumVote(0, [], 1, H, TARGET, 'buzz')?.action, 'cast')
    assert.equal(planForumVote(1, [], 1, H, TARGET, 'buzz'), null)
    assert.equal(planForumVote(-1, [], -1, H, TARGET, 'buzz'), null)
})

test('der WECHSEL der Richtung schreibt eine neue Stimme, keinen Grabstein', () => {
    // Die alte Stimme bleibt beim Relay stehen; verdeckt wird sie von der Falt-Regel.
    // Ein Grabstein waere hier ein zweites Ereignis fuer eine Wirkung, die die Faltung
    // ohnehin hat.
    const runter = planForumVote(1, [MY_VOTE], -1, H, TARGET, 'buzz')
    assert.equal(runter?.action, 'cast')
    assert.equal(runter?.events[0]?.content, VOTE_DOWN)
    assert.equal(planForumVote(-1, [MY_VOTE], 1, H, TARGET, 'buzz')?.events[0]?.content, VOTE_UP)
})

test('ohne Kanal-Uuid wird nicht gebaut — `h` ist am Relay Pflicht', () => {
    assert.equal(planForumVote(0, [], 1, '', TARGET, 'buzz'), null)
    assert.equal(planForumVote(1, [MY_VOTE], 1, '', TARGET, 'buzz'), null)
})

test('ein Ziel, das keine 64-stellige Hex-Id ist, wird abgelehnt', () => {
    // `validate_forum_vote_target` verlangt genau das (`ingest.rs:1001-1046`). Der Riegel
    // steht trotzdem hier: ein Ereignis, das der Relay ohnehin ablehnt, ist eine
    // Signatur-Anfrage an das Geraet des Nutzers, die niemand beantworten muss.
    assert.equal(planForumVote(0, [], 1, H, '', 'buzz'), null)
    assert.equal(planForumVote(0, [], 1, H, 'a'.repeat(63), 'buzz'), null)
    assert.equal(planForumVote(0, [], 1, H, 'A'.repeat(64), 'buzz'), null, 'Grossbuchstaben sind keine `to_hex()`-Ausgabe')
    assert.equal(planForumVote(0, [], 1, H, `${'a'.repeat(63)}z`, 'buzz'), null)
})
