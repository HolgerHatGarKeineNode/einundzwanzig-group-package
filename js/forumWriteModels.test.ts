/**
 * Pure-Tests des Schreibmodells der Forum-Fläche (welshman-frei).
 *   node --test packages/einundzwanzig-group/js/forumWriteModels.test.ts
 *
 * **Die Zusagen hier sind an BUZZ' QUELLCODE kalibriert, nicht an unserer
 * Herleitung.** Jeder Fall, der eine Eigenschaft der Ereignisform behauptet,
 * nennt die Fundstelle im buzz-Repo (`/home/user/Code/buzz`, `69107dc3`) — wer
 * einen Fall ändert, ändert damit eine Aussage über ein fremdes Programm und
 * muss dort nachsehen.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
    TOPIC_CONTENT_MAX_BYTES,
    buildTopicTags,
    byteLength,
    normalizeTopicContent,
    topicComposerZiel,
    topicContentProblem,
} from './forumWriteModels.ts'
import { forumTopicTitle } from './forumModels.ts'

const PK_A = 'a'.repeat(64)
const PK_B = 'b'.repeat(64)
const H = '177e0faf-0ff5-553e-aaca-84d0632084c0'

// ── Die Ereignisform ────────────────────────────────────────────────────────

test('ein Thema trägt `h` — und `h` steht ZUERST, wie in build_forum_post', () => {
    // `crates/buzz-sdk/src/builders.rs:288`
    //   let mut tags = vec![tag(&["h", &channel_id.to_string()])?];
    assert.deepEqual(buildTopicTags(H), [['h', H]])
})

test('ein Thema trägt KEINEN Titel — kein `subject`, kein `title`, kein `d`', () => {
    // Der ganze Auftrag steht und fällt damit. `build_forum_post` kennt genau
    // drei Tag-Quellen: `h`, `mention_tags` (→ `p`) und `imeta_tags` (→ `imeta`).
    // Ein Titel-Tag gibt es dort nicht, und `ForumPostCard.tsx` rendert
    // entsprechend gar keinen Titel, sondern `content.slice(0, 200)`.
    const namen = buildTopicTags(H, [PK_A, PK_B]).map(([name]) => name)
    for (const verboten of ['subject', 'title', 'd', 'name']) {
        assert.equal(namen.includes(verboten), false, `${verboten}-Tag gehört nicht an ein 45001`)
    }
    assert.deepEqual([...new Set(namen)], ['h', 'p'])
})

test('Erwähnungen werden als `p` kleingeschrieben und ohne Wiederholung geführt', () => {
    // `builders.rs:193-205 mention_tags`: `hex.to_ascii_lowercase()`, `HashSet`.
    const tags = buildTopicTags(H, [PK_A.toUpperCase(), PK_A, PK_B])
    assert.deepEqual(tags, [['h', H], ['p', PK_A], ['p', PK_B]])
})

test('leere oder nur aus Leerzeichen bestehende Erwähnungen fallen raus', () => {
    // Die Engstelle verlässt sich nicht auf ihren Aufrufer: `mentionPubkeys()`
    // liefert heute nur dekodierte Schlüssel, und morgen ruft jemand anders.
    assert.deepEqual(buildTopicTags(H, ['', '   ', PK_A]), [['h', H], ['p', PK_A]])
})

// ── Inhalt ──────────────────────────────────────────────────────────────────

test('der Inhalt wird getrimmt — wie in Buzz Desktop', () => {
    // `desktop/src-tauri/src/commands/messages.rs:515`:
    //   events::build_forum_post(channel_uuid, content.trim(), …)
    assert.equal(normalizeTopicContent('  \n Wie kommt das Bier in die Flasche? \n\n '), 'Wie kommt das Bier in die Flasche?')
})

test('ein leeres Thema ist kein Thema — und der Relay fängt das NICHT ab', () => {
    // `ingest.rs` kennt für 45001 kein `content.is_empty()`-Gate; der Riegel
    // muss im Client stehen und steht bei Buzz ebenfalls dort
    // (`ForumComposer.tsx:221`, `contentRef.current.trim()`).
    assert.equal(topicContentProblem(''), 'leer')
    assert.equal(topicContentProblem('   \n\t  '), 'leer')
    assert.equal(topicContentProblem('a'), '')
})

test('die Inhaltsgrenze ist 64 KiB in BYTES, nicht in Zeichen', () => {
    // `builders.rs:290` (`check_content(content, 64 * 1024)`) und
    // `desktop/src-tauri/src/events.rs:23`. Rusts `String::len()` zählt UTF-8.
    assert.equal(TOPIC_CONTENT_MAX_BYTES, 65_536)

    // Genau an der Grenze: erlaubt.
    assert.equal(topicContentProblem('x'.repeat(TOPIC_CONTENT_MAX_BYTES)), '')
    // Ein Byte darüber: nicht mehr.
    assert.equal(topicContentProblem('x'.repeat(TOPIC_CONTENT_MAX_BYTES + 1)), 'zu-lang')

    // **Der Fall, wegen dem hier Bytes und nicht Zeichen stehen.** 20 000
    // Vier-Byte-Emoji sind 20 000 `String.length`-Einheiten? Nein — in
    // JavaScript sind es 40 000 (UTF-16-Surrogatpaare) und in Rust 80 000
    // Bytes. Ein Riegel über `content.length` ließe sie durch, der Relay nähme
    // sie an (seine Grenze liegt bei 256 KiB), und Buzz Desktop könnte dasselbe
    // Thema nie schreiben.
    const emoji = '🍺'.repeat(20_000)
    assert.equal(byteLength(emoji), 80_000)
    assert.ok(emoji.length < TOPIC_CONTENT_MAX_BYTES, 'als JS-Länge läge es unter der Grenze')
    assert.equal(topicContentProblem(emoji), 'zu-lang', 'als BYTE-Länge liegt es darüber')
})

// ── Titel und Rumpf: EINE Regel, zwei Orte ──────────────────────────────────

test('der Titel der VORSCHAU ist zeichengleich der Titel der LISTE', () => {
    // Die Fläche zeigt beim Tippen an, was in der Liste stehen wird. Wäre das
    // eine zweite Regel („alles vor dem ersten \n"), liefe sie irgendwann
    // auseinander — spätestens beim ersten Thema, das mit einer Leerzeile
    // beginnt oder dessen erste Zeile über 120 Zeichen lang ist.
    //
    // Der Beweis ist hier bewusst über den NORMALISIERTEN Inhalt geführt: auf
    // den Draht geht `normalizeTopicContent(draft)`, die Liste liest genau das
    // zurück. Der Entwurf selbst ist ungetrimmt.
    const entwurf = '\n\n   Wie kommt das Bier in die Flasche?   \nZweite Zeile.\n'
    assert.equal(forumTopicTitle(entwurf), forumTopicTitle(normalizeTopicContent(entwurf)))
    assert.equal(forumTopicTitle(entwurf), 'Wie kommt das Bier in die Flasche?')
})

// ── Die zwei Bauformen ──────────────────────────────────────────────────────

test('Desktop bekommt den Knopf am Listenkopf, Mobil den in der unteren Leiste', () => {
    assert.equal(topicComposerZiel(true, true, true), 'kopf')
    assert.equal(topicComposerZiel(false, true, true), 'leiste')
})

test('die zwei Bauformen schließen einander aus — das ist die eigentliche Zusage', () => {
    // Zwei sichtbare Auslöser für dieselbe Handlung wären schlimmer als ein
    // schlecht platzierter. Als EINE Funktion mit EINEM Rückgabewert sind zwei
    // Formen zugleich nicht ausdrückbar, nicht nur unwahrscheinlich — dieser
    // Fall hält fest, dass es so bleibt.
    for (const desktop of [true, false]) {
        const ziel = topicComposerZiel(desktop, true, true)
        assert.equal(['kopf', 'leiste'].filter((form) => form === ziel).length, 1)
    }
})

test('kein Forum, keine Mitgliedschaft → gar kein Auslöser', () => {
    // Ein Knopf, der garantiert scheitert, ist schlimmer als keiner: der Relay
    // verlangt für ein 45001 `Scope::MessagesWrite` am Kanal
    // (`ingest.rs:390-392`), also Kanalmitgliedschaft. Ohne sie zeigt die
    // Fläche den Beitreten-Weg, den sie ohnehin schon hat.
    assert.equal(topicComposerZiel(true, false, true), 'keins')
    assert.equal(topicComposerZiel(false, false, true), 'keins')
    assert.equal(topicComposerZiel(true, true, false), 'keins')
    assert.equal(topicComposerZiel(false, true, false), 'keins')
})
