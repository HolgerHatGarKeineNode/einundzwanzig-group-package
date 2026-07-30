/**
 * Die Buzz-Threading-Regeln — die Tag-Form beim Schreiben und ihr Gegenstück beim Lesen.
 *
 * **Warum dieser Test wichtiger ist, als er aussieht:** Buzz lehnt eine falsch getaggte
 * Antwort meistens NICHT ab — es nimmt sie an und verknüpft sie still nicht (kein
 * `thread_metadata`, kein Zähler, kein NOTICE). Ein Fehler in dieser Datei erzeugt also
 * keinen roten Test im Betrieb, sondern Antworten, die niemand je wiederfindet. Die
 * Erwartungen unten sind am laufenden Relay gemessen (2026-07-28, `ws://localhost:3001`)
 * und in `threading.ts` mit Fundstellen belegt.
 *
 * Ausführen: node --test --experimental-strip-types packages/einundzwanzig-group/js/threading.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
    THREAD_REPLY_MARKER,
    THREAD_ROOT_MARKER,
    isRootMessage,
    isThreadReply,
    replyTargetIds,
    threadParentId,
    threadRootId,
    threadTags,
} from './threading.ts'

const ROOT = 'a'.repeat(64)
const PARENT = 'b'.repeat(64)
const OTHER = 'c'.repeat(64)

const tagged = (tags: string[][]) => ({ tags })

// ── Schreiben: die drei Ebenen ────────────────────────────────────────────

test('Wurzel-Nachricht: gar keine Thread-Tags', () => {
    // Eine Wurzel ist eine ganz normale Raum-Nachricht — `threadTags` wird für sie nie
    // aufgerufen. Der Test hält fest, wie die andere Seite sie erkennt.
    assert.equal(isRootMessage(tagged([['h', 'raum']])), true)
    assert.equal(isThreadReply(tagged([['h', 'raum']])), false)
    assert.equal(threadRootId(tagged([['h', 'raum']])), '')
})

test('Antwort auf die Wurzel: EIN `reply`-Tag — niemals `root` (Buzz-Regel 1)', () => {
    // Der teuerste Unterschied zu NIP-10. NIP-10 schreibt für den direkten Reply auf die
    // Wurzel ein einzelnes ROOT-markiertes Tag vor; Buzz verknüpft so ein Event nicht und
    // sagt nichts. Wer diese Zeile „standardkonform" repariert, verliert still Antworten.
    assert.deepEqual(threadTags(ROOT, ROOT), [['e', ROOT, '', 'reply']])
    assert.equal(
        threadTags(ROOT, ROOT).some((t) => t[3] === THREAD_ROOT_MARKER),
        false,
        'kein root-Marker bei Tiefe 1',
    )
})

test('Antwort auf eine Antwort: `root` UND `reply` (Buzz-Regel 2)', () => {
    assert.deepEqual(threadTags(ROOT, PARENT), [
        ['e', ROOT, '', 'root'],
        ['e', PARENT, '', 'reply'],
    ])
})

test('Ein leeres Parent zählt als „direkt auf die Wurzel"', () => {
    // Die Aufrufstelle kennt bei einer Top-Level-Antwort oft nur die Wurzel.
    assert.deepEqual(threadTags(ROOT, ''), [['e', ROOT, '', 'reply']])
})

test('Der Marker steht auf Index 3, der leere Relay-Hint auf Index 2 (Buzz-Regeln 3+4)', () => {
    // Buzz liest `tag[3]` und verlangt `tag.len() >= 4`. Fiele der leere Hint weg, rutschte
    // der Marker auf Index 2 — das Event wäre annehmbar, aber unverknüpft.
    for (const tag of [...threadTags(ROOT, ROOT), ...threadTags(ROOT, PARENT)]) {
        assert.equal(tag.length, 4, `${JSON.stringify(tag)} muss genau 4 Positionen haben`)
        assert.equal(tag[0], 'e')
        assert.equal(tag[2], '', 'Position 2 (Relay-Hint) bleibt leer, existiert aber')
        assert.ok(
            tag[3] === THREAD_ROOT_MARKER || tag[3] === THREAD_REPLY_MARKER,
            `nur root/reply sind gültige Marker, nicht ${tag[3]}`,
        )
    }
})

test('KEINE p-Tags fürs Threading (Buzz-Regel 6)', () => {
    // Buzz wertet `p` nie aus. Ein p-Tag hier wäre kein Fehler am Relay, aber eine
    // stillschweigende Zusage an Leser, die niemand einlöst.
    for (const tag of [...threadTags(ROOT, ROOT), ...threadTags(ROOT, PARENT)]) {
        assert.notEqual(tag[0], 'p')
    }
})

// ── Lesen: Wurzel und Parent aus fremden Events ───────────────────────────

test('Tiefe 1: die Wurzel wird aus dem `reply`-Marker gelesen', () => {
    const reply = tagged([['h', 'raum'], ['e', ROOT, '', 'reply']])
    assert.equal(threadRootId(reply), ROOT)
    assert.equal(threadParentId(reply), ROOT, 'bei Tiefe 1 IST der Parent die Wurzel')
    assert.equal(isThreadReply(reply), true)
})

test('Tiefe 2: `root` gewinnt gegen `reply` — sonst zerfiele ein Thread in Ebenen', () => {
    const nested = tagged([
        ['h', 'raum'],
        ['e', ROOT, '', 'root'],
        ['e', PARENT, '', 'reply'],
    ])
    assert.equal(threadRootId(nested), ROOT)
    assert.equal(threadParentId(nested), PARENT)
})

test('Tag-Reihenfolge ist egal — gelesen wird der Marker, nicht die Position', () => {
    const umgedreht = tagged([
        ['e', PARENT, '', 'reply'],
        ['e', ROOT, '', 'root'],
        ['h', 'raum'],
    ])
    assert.equal(threadRootId(umgedreht), ROOT)
    assert.equal(threadParentId(umgedreht), PARENT)
})

test('Markerlose und `mention`-`e`-Tags sind KEINE Antwort (Buzz-Regel 3)', () => {
    // Genau so verhält sich das Relay: es nimmt solche Events an, legt aber keine
    // Thread-Verknüpfung an. Der Client muss dieselbe Grenze ziehen, sonst zeigt er
    // Antworten, die es serverseitig gar nicht gibt.
    const ohneMarker = tagged([['h', 'raum'], ['e', ROOT]])
    const mention = tagged([['h', 'raum'], ['e', ROOT, '', 'mention']])
    for (const event of [ohneMarker, mention]) {
        assert.equal(isThreadReply(event), false)
        assert.equal(isRootMessage(event), true)
        assert.equal(threadRootId(event), '')
    }
})

test('Ein `root`-Marker OHNE `reply` gilt trotzdem als dieser Thread', () => {
    // Buzz verknüpft so ein Event nicht (Regel 1) — wir SCHREIBEN es deshalb nie. Wenn ein
    // fremder, NIP-10-konformer Client es doch tut, ordnen wir es beim Lesen dem richtigen
    // Thread zu, statt es unter den Tisch fallen zu lassen. Es bleibt aber keine „Antwort"
    // im Sinne der Zähler — die zählen, was Buzz auch zählt.
    const nurRoot = tagged([['h', 'raum'], ['e', ROOT, '', 'root']])
    assert.equal(threadRootId(nurRoot), ROOT)
    assert.equal(isThreadReply(nurRoot), false, 'ohne reply-Marker keine Antwort — wie beim Relay')
})

test('Ein leerer Tag-Wert wird ignoriert (Fremd-Events sind nicht validiert)', () => {
    const kaputt = tagged([['e', '', '', 'reply'], ['e', OTHER, '', 'reply']])
    assert.equal(threadParentId(kaputt), OTHER, 'der erste BRAUCHBARE Marker gewinnt')
})

// ── Die Gegenprobe: Schreiben und Lesen passen zusammen ───────────────────

test('Was `threadTags` schreibt, liest `threadRootId`/`threadParentId` zurück', () => {
    const direkt = tagged([['h', 'raum'], ...threadTags(ROOT, ROOT)])
    assert.equal(threadRootId(direkt), ROOT)
    assert.equal(threadParentId(direkt), ROOT)

    const tief = tagged([['h', 'raum'], ...threadTags(ROOT, PARENT)])
    assert.equal(threadRootId(tief), ROOT)
    assert.equal(threadParentId(tief), PARENT)

    // Und beide sind für den Raum-Feed Antworten, nicht Wurzeln.
    assert.equal(isRootMessage(direkt), false)
    assert.equal(isRootMessage(tief), false)
})

// ── `replyTargetIds`: derselbe Aufruf für Wurzel und Antwort ───────────────

test('Antwort auf die WURZEL: rootId = parentId = die Wurzel selbst → ein reply-Tag', () => {
    const wurzel = { id: ROOT, tags: [['h', 'raum']] }
    const { rootId, parentId } = replyTargetIds(wurzel)

    assert.equal(rootId, ROOT)
    assert.equal(parentId, ROOT)
    // Und die daraus gebaute Form ist die einzige, die Buzz bei Tiefe 1 verknüpft.
    assert.deepEqual(threadTags(rootId, parentId), [['e', ROOT, '', THREAD_REPLY_MARKER]])
})

test('Antwort auf eine ANTWORT: die Wurzel kommt aus deren Tags, NICHT aus ihrer id', () => {
    // Die Antwort der Tiefe 1 trägt nur `reply` (Regel 1) — dort steht die Wurzel.
    const antwort = { id: PARENT, tags: [['h', 'raum'], ['e', ROOT, '', THREAD_REPLY_MARKER]] }
    const { rootId, parentId } = replyTargetIds(antwort)

    assert.equal(rootId, ROOT, 'die Wurzel des Threads, nicht das Ziel')
    assert.equal(parentId, PARENT)
    assert.deepEqual(threadTags(rootId, parentId), [
        ['e', ROOT, '', THREAD_ROOT_MARKER],
        ['e', PARENT, '', THREAD_REPLY_MARKER],
    ])
})

test('Der Fehler, der Antworten verschwinden ließe: target.id als Wurzel bei Tiefe ≥ 2', () => {
    // Genau das entsteht ohne `replyTargetIds` — `root` zeigt auf eine ANTWORT statt auf
    // die Wurzel. Buzz lehnt das hart ab („root tag does not match thread ancestry"), die
    // Antwort ist weg. Hier steht der Unterschied als Tatsache, nicht als Kommentar.
    const antwort = { id: PARENT, tags: [['e', ROOT, '', THREAD_REPLY_MARKER]] }
    const falsch = threadTags(antwort.id, antwort.id)
    const richtig = threadTags(replyTargetIds(antwort).rootId, replyTargetIds(antwort).parentId)

    assert.notDeepEqual(falsch, richtig)
    assert.equal(threadRootId({ tags: falsch }), PARENT, 'die falsche Form wurzelt an der Antwort')
    assert.equal(threadRootId({ tags: richtig }), ROOT, 'die richtige an der Wurzel')
})

test('Antwort der Tiefe 3: die Wurzel bleibt die Wurzel (root-Marker gewinnt vor reply)', () => {
    // Ein Tiefe-2-Event trägt BEIDE Marker. Wer darauf antwortet, muss `root` lesen —
    // läse er `reply`, wanderte die „Wurzel" mit jeder Ebene weiter und der Thread zerfiele.
    const tief = { id: OTHER, tags: [['e', ROOT, '', THREAD_ROOT_MARKER], ['e', PARENT, '', THREAD_REPLY_MARKER]] }
    const { rootId, parentId } = replyTargetIds(tief)

    assert.equal(rootId, ROOT)
    assert.equal(parentId, OTHER)
})
