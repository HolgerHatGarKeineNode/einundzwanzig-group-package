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
import {
    FORUM_COMMENT,
    FORUM_FACE_CAP,
    FORUM_POST,
    buildForumTopics,
    forumTopicPreview,
    forumTopicTitle,
    type ForumReplyInput,
    type ForumRootInput,
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

test('die Kind-Nummern sind die von Buzz (45001 Thema, 45003 Antwort)', () => {
    assert.equal(FORUM_POST, 45001)
    assert.equal(FORUM_COMMENT, 45003)
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
