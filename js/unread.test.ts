/**
 * Der Ungelesen-Punkt — was ihn anschaltet und was ihn NICHT anschaltet.
 *
 * Der teure Fehler ist hier nicht der fehlende Punkt, sondern der falsche: ein Marker,
 * der leuchtet, obwohl nichts da ist, wird nach zwei Tagen ignoriert — und dann nützt
 * auch der richtige nichts mehr. Die Gegenproben (eigene Nachricht, fremder Raum, Gast,
 * nie gelesener Thread) sind deshalb genauso verbindlich wie die Positivfälle.
 *
 * Ausführen: node --test packages/einundzwanzig-group/js/unread.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MESSAGE, COMMENT, POLL } from '@welshman/util'
import { computeUnread, unreadCommentRootId, type UnreadInput } from './unread.ts'
import { roomKey, threadKey, ALL_KEY, type ReadState } from './readState.ts'

const URL = 'wss://relay.example/'
const ME = 'a'.repeat(64)
const OTHER = 'b'.repeat(64)
const ROOT = 'c'.repeat(64)

const message = (id: string, createdAt: number, h: string, author = OTHER, kind = MESSAGE) =>
    ({ id, kind, created_at: createdAt, pubkey: author, tags: [['h', h]], content: '', sig: '' }) as never

const comment = (id: string, createdAt: number, rootId = ROOT, author = OTHER) =>
    ({ id, kind: COMMENT, created_at: createdAt, pubkey: author, tags: [['E', rootId]], content: '', sig: '' }) as never

const lotusComment = (id: string, createdAt: number, rootId = ROOT) =>
    ({
        id,
        kind: 10,
        created_at: createdAt,
        pubkey: OTHER,
        tags: [['e', rootId, URL, 'root']],
        content: '',
        sig: '',
    }) as never

const input = (over: Partial<UnreadInput> = {}): UnreadInput => ({
    url: URL,
    joined: ['raum'],
    events: [],
    comments: [],
    state: {},
    me: ME,
    ...over,
})

test('Fremde Nachricht jenseits des Wasserzeichens schaltet den Punkt an', () => {
    const state: ReadState = { [roomKey(URL, 'raum')]: 1000 }
    const view = computeUnread(input({ state, events: [message('m1', 1001, 'raum')] }))
    assert.equal(view.rooms.raum, true)
    assert.equal(view.any, true)
})

test('Genau AUF dem Wasserzeichen zaehlt nicht (sonst ist Quittieren wirkungslos)', () => {
    // NIP-01-`since` ist inklusiv; waere der Vergleich `>=`, waere die gerade gelesene
    // Nachricht im selben Moment wieder ungelesen und der Punkt ginge nie aus.
    const state: ReadState = { [roomKey(URL, 'raum')]: 1000 }
    const view = computeUnread(input({ state, events: [message('m1', 1000, 'raum')] }))
    assert.equal(view.rooms.raum, false)
    assert.equal(view.any, false)
})

test('Die eigene Nachricht macht den eigenen Raum nicht ungelesen', () => {
    const view = computeUnread(input({ events: [message('m1', 9999, 'raum', ME)] }))
    assert.equal(view.rooms.raum, false)
})

test('Polls und Spendenziele zaehlen wie Nachrichten (sie stehen im selben Verlauf)', () => {
    const view = computeUnread(input({ events: [message('p1', 9999, 'raum', OTHER, POLL)] }))
    assert.equal(view.rooms.raum, true)
})

test('Ein Raum, in dem ich nicht bin, bekommt gar keinen Schluessel', () => {
    // Sonst leuchtete die Uebersicht bei jedem der 85 fremden Meetup-Raeume auf.
    const view = computeUnread(input({ joined: ['raum'], events: [message('m1', 9999, 'fremder-raum')] }))
    assert.equal('fremder-raum' in view.rooms, false)
    assert.equal(view.any, false)
})

test('Gast: kein pubkey ⇒ nichts ist ungelesen', () => {
    const view = computeUnread(input({ me: '', events: [message('m1', 9999, 'raum')] }))
    assert.deepEqual(view, { rooms: {}, threads: {}, any: false })
})

test('`all` ist der Boden fuer Raeume ohne eigenes Wasserzeichen', () => {
    // „Alles gelesen" muss auch Raeume decken, die noch nie einzeln quittiert wurden —
    // und der frisch angelegte Account, dessen `all` auf „jetzt" steht, darf nicht von
    // 300 gecachten Nachrichten begruesst werden.
    const state: ReadState = { [ALL_KEY]: 5000 }
    const view = computeUnread(input({ state, events: [message('alt', 4999, 'raum'), message('neu', 5001, 'raum')] }))
    assert.equal(view.rooms.raum, true, 'die Nachricht NACH dem all-Wasserzeichen zaehlt')

    const nurAlt = computeUnread(input({ state, events: [message('alt', 4999, 'raum')] }))
    assert.equal(nurAlt.rooms.raum, false, 'alles vor `all` ist quittiert')
})

test('Thread-Punkt nur fuer Threads, die ich schon einmal gelesen habe', () => {
    // Ohne diese Regel waere jeder je im Space eroeffnete Thread beim ersten Blick
    // ungelesen. Wer mich erwaehnt oder mir antwortet, erreicht mich in P4 ueber die
    // Benachrichtigungs-Liste — nicht ueber diesen Punkt.
    const ungelesen = computeUnread(input({ comments: [comment('k1', 9999)] }))
    assert.equal(ungelesen.threads[ROOT], undefined, 'nie geoeffnet ⇒ kein Punkt')

    const state: ReadState = { [threadKey(ROOT)]: 1000 }
    const gelesen = computeUnread(input({ state, comments: [comment('k1', 1001)] }))
    assert.equal(gelesen.threads[ROOT], true)
    assert.equal(gelesen.any, true)
})

test('Raum-Lesen quittiert KEINEN Thread (Kommentare stehen nicht im Raum-Feed)', () => {
    // NIP-22: unsere kind-1111 tragen kein `#h` und erscheinen im Raum-Verlauf nicht.
    // Ein Raum-Wasserzeichen als Boden fuer Threads wuerde ungelesene Antworten
    // stummschalten — Flotilla macht genau das (Pfad-Praefix), wir bewusst nicht.
    const state: ReadState = { [roomKey(URL, 'raum')]: 9_999_999, [threadKey(ROOT)]: 1000 }
    const view = computeUnread(input({ state, comments: [comment('k1', 1001)] }))
    assert.equal(view.threads[ROOT], true)
})

test('Der eigene Kommentar macht den eigenen Thread nicht ungelesen', () => {
    const state: ReadState = { [threadKey(ROOT)]: 1000 }
    const view = computeUnread(input({ state, comments: [comment('k1', 1001, ROOT, ME)] }))
    assert.equal(view.threads[ROOT], undefined)
})

test('Lotus-Threads (kind 10) werden ueber den root-Marker erkannt', () => {
    assert.equal(unreadCommentRootId(lotusComment('k1', 1)), ROOT)
    const state: ReadState = { [threadKey(ROOT)]: 1000 }
    const view = computeUnread(input({ state, comments: [lotusComment('k1', 1001)] }))
    assert.equal(view.threads[ROOT], true)
})

test('`any` fasst Raeume UND Threads zusammen (der Punkt am Chat-Tab)', () => {
    const nurThread = computeUnread(
        input({ state: { [threadKey(ROOT)]: 1000 }, comments: [comment('k1', 1001)] }),
    )
    assert.equal(nurThread.rooms.raum, false)
    assert.equal(nurThread.any, true, 'ein ungelesener Thread allein reicht fuer den Tab-Punkt')

    const nichts = computeUnread(input())
    assert.equal(nichts.any, false)
})
