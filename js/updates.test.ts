/**
 * Die Benachrichtigungs-Liste — was eine Zeile erzeugt, was KEINE erzeugt und in welcher
 * Reihenfolge sie stehen.
 *
 * Der teure Fehler ist auch hier nicht die fehlende Zeile, sondern die falsche: eine Liste,
 * die dasselbe Ereignis zweimal zeigt, fremde Räume einblendet oder eine Zahl trägt, die
 * niemand nachzählen kann, wird nach zwei Tagen nicht mehr geöffnet. Die Gegenproben
 * (eigenes Ereignis, Selbst-Erwähnung, fremder Raum, Gast, Reaktion) sind deshalb genauso
 * verbindlich wie die Positivfälle.
 *
 * **Zeitrechnung:** alle Zeitpunkte hängen an einem lokalen Mittags-Anker
 * ({@link NOW}) und werden in Tagesschritten davon abgeleitet. Damit sind die
 * Bucket-Grenzen (lokale Tagesgrenzen) unabhängig von der Zeitzone des Testrechners; ein
 * fester Unix-Timestamp wäre es nicht.
 *
 * Ausführen: node --test --experimental-strip-types packages/einundzwanzig-group/js/updates.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { COMMENT, MESSAGE, POLL, ZAP_GOAL } from '@welshman/util'
import * as nip19 from 'nostr-tools/nip19'
import {
    CLOCK_SKEW_SEC,
    MENTION_DECODE_CAP,
    computeUpdates,
    updateBucket,
    updateTimeLabel,
    updatesCommentRootId,
    updatesMentionCandidates,
    updatesMentionsPubkey,
    type UpdateInput,
} from './updates.ts'
import { ALL_KEY, roomKey, threadKey, type ReadState } from './readState.ts'

const URL = 'wss://relay.example/'
const ME = 'a'.repeat(64)
const OTHER = 'b'.repeat(64)
const THIRD = 'd'.repeat(64)
const ROOT = 'c'.repeat(64)
const H = 'raum'

/** 23. Juli 2026, 12:00 LOKALZEIT — siehe Modul-Docstring. */
const NOW = Math.floor(new Date(2026, 6, 23, 12, 0, 0).getTime() / 1000)
const DAY = 86_400
const MIN = 60
const HOUR = 3600

const message = (id: string, createdAt: number, over: { h?: string; author?: string; kind?: number; content?: string; tags?: string[][] } = {}) =>
    ({
        id,
        kind: over.kind ?? MESSAGE,
        created_at: createdAt,
        pubkey: over.author ?? OTHER,
        tags: over.tags ?? [['h', over.h ?? H]],
        content: over.content ?? '',
        sig: '',
    }) as never

const comment = (id: string, createdAt: number, over: { rootId?: string; author?: string; content?: string; h?: string } = {}) =>
    ({
        id,
        kind: COMMENT,
        created_at: createdAt,
        pubkey: over.author ?? OTHER,
        tags: over.h ? [['E', over.rootId ?? ROOT], ['h', over.h]] : [['E', over.rootId ?? ROOT]],
        content: over.content ?? '',
        sig: '',
    }) as never

const lotusComment = (id: string, createdAt: number, rootId = ROOT) =>
    ({
        id,
        kind: 10,
        created_at: createdAt,
        pubkey: OTHER,
        tags: [['e', rootId, URL, 'root'], ['h', H]],
        content: '',
        sig: '',
    }) as never

/** Die Thread-Wurzel: alt genug, um selbst KEINE Raum-Zeile zu erzeugen (gelesen + > 24 h). */
const root = (createdAt = NOW - 10 * DAY, author = THIRD) => message(ROOT, createdAt, { author })

const mention = (pk: string): string => `Hallo nostr:${nip19.npubEncode(pk)}, schau mal`

const profiles = (entries: [string, { name?: string; picture?: string }][] = []) => new Map(entries) as never

const input = (over: Partial<UpdateInput> = {}): UpdateInput => ({
    url: URL,
    joined: [H],
    events: [],
    comments: [],
    state: {},
    me: ME,
    roomNames: { [H]: 'Allgemein' },
    profiles: profiles(),
    now: NOW,
    ...over,
})

/** Wasserzeichen, das alles vor `ts` als gelesen quittiert. */
const readUpTo = (ts: number): ReadState => ({ [roomKey(URL, H)]: ts })

// ── Regel 1: Scope — nur, wohin deep-gelinkt werden kann ────────────────────

test('Regel 1: kind 9/1068/9041 landen im Raum-Ziel /rooms/{h}?from=updates', () => {
    const state = readUpTo(NOW - HOUR)
    for (const kind of [MESSAGE, POLL, ZAP_GOAL]) {
        const [item] = computeUpdates(input({ state, events: [message('m1', NOW - MIN, { kind })] }))
        assert.equal(item.type, 'message')
        assert.equal(item.href, `/rooms/${H}?from=updates`, `kind ${kind} muss ins Raum-Ziel zeigen`)
    }
})

test('Regel 1: Reaktionen (7) und Zap-Receipts (9735) erzeugen KEINE Zeile', () => {
    // Fuer sie gibt es keinen Nachrichten-Anker (`?msg=` existiert nicht) — eine Zeile
    // fuehrte ins Leere. Der Scope ist eine Zusage der Ableitung, nicht nur des Filters.
    const state = readUpTo(NOW - HOUR)
    const items = computeUpdates(
        input({
            state,
            events: [message('r1', NOW - MIN, { kind: 7 }), message('z1', NOW - MIN, { kind: 9735 })],
            comments: [message('r2', NOW - MIN, { kind: 7 })],
        }),
    )
    assert.deepEqual(items, [])
})

test('Regel 1: Kommentare (1111) und Lotus-Threads (10) landen im Thread-Ziel mit nevent', () => {
    const state = readUpTo(NOW - HOUR)
    const expected = `/rooms/${H}/thread/${nip19.neventEncode({ id: ROOT, relays: [URL], author: THIRD })}?from=updates`

    const [nip22] = computeUpdates(input({ state, events: [root()], comments: [comment('k1', NOW - MIN)] }))
    assert.equal(nip22.type, 'thread')
    assert.equal(nip22.rootId, ROOT)
    assert.equal(nip22.href, expected)

    const [lotus] = computeUpdates(input({ state, events: [root()], comments: [lotusComment('k2', NOW - MIN)] }))
    assert.equal(lotus.href, expected, 'kind 10 wird ueber den root-Marker demselben Thread zugeordnet')
    assert.equal(updatesCommentRootId(lotusComment('k2', 1)), ROOT)
})

// ── Regel 2: Aggregation ───────────────────────────────────────────────────

test('Regel 2: drei Nachrichten in einem Raum ergeben EINE Zeile mit count 3', () => {
    const state = readUpTo(NOW - HOUR)
    const items = computeUpdates(
        input({
            state,
            events: [message('m1', NOW - 3 * MIN), message('m2', NOW - 2 * MIN), message('m3', NOW - MIN, { author: THIRD })],
            profiles: profiles([[THIRD, { name: 'Carol' }]]),
        }),
    )
    assert.equal(items.length, 1)
    assert.equal(items[0].count, 3)
    assert.equal(items[0].ts, NOW - MIN, 'ts ist die juengste Aktivitaet')
    assert.equal(items[0].pubkey, THIRD, 'Autor/Avatar kommen vom juengsten Ereignis')
    assert.equal(items[0].title, 'Carol · 3 neue Nachrichten')
    assert.equal(items[0].key, `message:${H}`)
})

test('Regel 2: zwei Kommentare eines Roots ergeben EINE Thread-Zeile, zwei Erwaehnungen ZWEI Zeilen', () => {
    const state = readUpTo(NOW - HOUR)
    const aggregiert = computeUpdates(
        input({ state, events: [root()], comments: [comment('k1', NOW - 2 * MIN), comment('k2', NOW - MIN)] }),
    )
    assert.equal(aggregiert.length, 1)
    assert.equal(aggregiert[0].count, 2)
    assert.equal(aggregiert[0].title, '2 neue Antworten')
    assert.equal(aggregiert[0].key, `thread:${ROOT}`)

    const erwaehnt = computeUpdates(
        input({
            state,
            events: [message('m1', NOW - 2 * MIN, { content: mention(ME) }), message('m2', NOW - MIN, { content: mention(ME) })],
        }),
    )
    assert.equal(erwaehnt.length, 2, 'Erwaehnungen werden NIE aggregiert')
    assert.deepEqual(erwaehnt.map((i) => i.key), ['mention:m2', 'mention:m1'])
})

// ── Regel 3: eine Erwähnung erscheint nur einmal ───────────────────────────

test('Regel 3: eine Erwaehnung steht NICHT zusaetzlich in der Raum-Aggregation', () => {
    const state = readUpTo(NOW - HOUR)
    const items = computeUpdates(
        input({
            state,
            events: [message('m1', NOW - 3 * MIN), message('m2', NOW - 2 * MIN, { content: mention(ME) }), message('m3', NOW - MIN)],
            profiles: profiles([[OTHER, { name: 'Bob' }]]),
        }),
    )
    const zeilen = items.map((i) => i.key).sort()
    assert.deepEqual(zeilen, ['mention:m2', `message:${H}`])
    const raum = items.find((i) => i.type === 'message')!
    assert.equal(raum.count, 2, 'die erwaehnende Nachricht zaehlt in der Sammelzeile NICHT mit')
    assert.equal(items.find((i) => i.type === 'mention')!.title, 'Bob hat dich erwähnt')
})

test('Regel 3: ist die Erwaehnung das einzige Neue, gibt es keine zusaetzliche Raum-Zeile', () => {
    const state = readUpTo(NOW - HOUR)
    const items = computeUpdates(input({ state, events: [message('m1', NOW - MIN, { content: mention(ME) })] }))
    assert.equal(items.length, 1)
    assert.equal(items[0].type, 'mention')
})

test('Regel 3: dasselbe gilt im Thread — Erwaehnung raus aus der Antworten-Zaehlung', () => {
    const state = readUpTo(NOW - HOUR)
    const items = computeUpdates(
        input({
            state,
            events: [root()],
            comments: [comment('k1', NOW - 2 * MIN), comment('k2', NOW - MIN, { content: mention(ME) })],
        }),
    )
    assert.equal(items.length, 2)
    const thread = items.find((i) => i.type === 'thread')!
    assert.equal(thread.count, 1)
    const erwaehnung = items.find((i) => i.type === 'mention')!
    assert.equal(erwaehnung.rootId, ROOT, 'die Erwaehnung im Thread zielt auf den Thread')
    assert.equal(erwaehnung.context, 'Allgemein · Thread')
})

// ── Regel 4: eigene Beiträge / Selbst-Erwähnung ────────────────────────────

test('Regel 4: eigene Nachrichten und eigene Kommentare erzeugen keine Zeile', () => {
    const items = computeUpdates(
        input({
            state: readUpTo(NOW - HOUR),
            events: [message('m1', NOW - MIN, { author: ME }), root()],
            comments: [comment('k1', NOW - MIN, { author: ME })],
        }),
    )
    assert.deepEqual(items, [])
})

test('Regel 4: die Selbst-Erwaehnung im eigenen Beitrag zaehlt nie (DV-5)', () => {
    const items = computeUpdates(
        input({ state: readUpTo(NOW - HOUR), events: [message('m1', NOW - MIN, { author: ME, content: mention(ME) })] }),
    )
    assert.deepEqual(items, [])
})

test('Regel 4: die Erwaehnung EINES ANDEREN ist fuer mich keine Erwaehnung', () => {
    const items = computeUpdates(
        input({ state: readUpTo(NOW - HOUR), events: [message('m1', NOW - MIN, { content: mention(THIRD) })] }),
    )
    assert.equal(items.length, 1)
    assert.equal(items[0].type, 'message', 'sie zaehlt als normale Nachricht, nicht als Erwaehnung')
    assert.equal(updatesMentionsPubkey(mention(THIRD), ME), false)
})

// ── Regel 5: nur beigetretene Räume ────────────────────────────────────────

test('Regel 5: ein Raum, in dem ich nicht bin, erzeugt keine Zeile — auch nicht als verwaiste', () => {
    // Sonst stuende die Liste voll mit den 83 fremden Meetup-Raeumen.
    const items = computeUpdates(
        input({
            state: readUpTo(NOW - HOUR),
            joined: [H],
            events: [message('m1', NOW - MIN, { h: 'fremder-raum' })],
            roomNames: { [H]: 'Allgemein', 'fremder-raum': 'Fremd' },
        }),
    )
    assert.deepEqual(items, [])
})

test('Regel 5: ein Thread ohne zuordenbaren Raum wird uebersprungen, nicht als verwaist gefuehrt', () => {
    // Weder die Wurzel im Cache noch ein `h` am Kommentar ⇒ niemand kann sagen, ob der
    // Thread ueberhaupt zu einem meiner Raeume gehoert.
    const items = computeUpdates(input({ state: readUpTo(NOW - HOUR), comments: [comment('k1', NOW - MIN)] }))
    assert.deepEqual(items, [])
})

test('Regel 5: das `h` des Kommentars traegt den Thread, wenn die Wurzel nicht im Cache liegt', () => {
    const items = computeUpdates(input({ state: readUpTo(NOW - HOUR), comments: [comment('k1', NOW - MIN, { h: H })] }))
    assert.equal(items.length, 1)
    assert.equal(items[0].h, H)
})

// ── Regel 6: created_at > watermark, nicht >= ──────────────────────────────

test('Regel 6: genau AUF dem Wasserzeichen ist nicht ungelesen', () => {
    const state = readUpTo(NOW - HOUR)
    const [item] = computeUpdates(input({ state, events: [message('m1', NOW - HOUR)] }))
    assert.equal(item.unread, false, 'sonst waere das gerade Quittierte sofort wieder neu')

    const [danach] = computeUpdates(input({ state, events: [message('m1', NOW - HOUR + 1)] }))
    assert.equal(danach.unread, true)
})

test('Regel 6: der Vergleich gilt an BEIDEN Stellen — Sichtbarkeitsfenster und Zeilen-Zustand', () => {
    // `created_at > wm` steht zweimal im Code: einmal als Sichtbarkeitsfenster (zusammen
    // mit der 24-h-Frist), einmal beim Aufteilen der Zeile in ungelesen/gelesen. Ein
    // Ereignis GENAU auf einem 25 h alten Wasserzeichen ist gelesen UND aelter als 24 h,
    // darf die Zeile also gar nicht erst erzeugen. Waere das Fenster `>=`, stuende es da.
    const raum = computeUpdates(input({ state: readUpTo(NOW - 25 * HOUR), events: [message('m1', NOW - 25 * HOUR)] }))
    assert.deepEqual(raum, [])

    const thread = computeUpdates(
        input({
            state: { [roomKey(URL, H)]: NOW - 25 * HOUR, [threadKey(ROOT)]: NOW - 25 * HOUR },
            events: [root()],
            comments: [comment('k1', NOW - 25 * HOUR)],
        }),
    )
    assert.deepEqual(thread, [])
})

test('Regel 6: `all` ist der Boden fuer Raeume ohne eigenes Wasserzeichen', () => {
    const state: ReadState = { [ALL_KEY]: NOW - HOUR }
    const [item] = computeUpdates(input({ state, events: [message('m1', NOW - MIN)] }))
    assert.equal(item.unread, true)
})

// ── Regel 7: Gelesenes bleibt 24 h ─────────────────────────────────────────

test('Regel 7: Gelesenes juenger als 24 h bleibt in der Liste — mit unread:false', () => {
    // Die Liste ist ein Verlauf, keine Inbox: wer gerade gelesen hat, soll es wiederfinden.
    const state = readUpTo(NOW)
    const items = computeUpdates(input({ state, events: [message('m1', NOW - 2 * HOUR)], profiles: profiles([[OTHER, { name: 'Bob' }]]) }))
    assert.equal(items.length, 1)
    assert.equal(items[0].unread, false)
    assert.equal(items[0].title, 'Bob · 1 Nachricht', 'gelesene Zeilen behaupten nichts „Neues"')
})

test('Regel 7: Gelesenes aelter als 24 h faellt raus', () => {
    const state = readUpTo(NOW)
    assert.deepEqual(computeUpdates(input({ state, events: [message('m1', NOW - 25 * HOUR)] })), [])
})

test('Regel 7: UNGELESENES faellt nie wegen Alter raus', () => {
    const state = readUpTo(NOW - 30 * DAY)
    const items = computeUpdates(input({ state, events: [message('m1', NOW - 10 * DAY)] }))
    assert.equal(items.length, 1)
    assert.equal(items[0].unread, true)
    assert.equal(items[0].bucket, 'older')
})

test('Regel 7: eine Zeile traegt entweder das Ungelesene ODER das Gelesene der letzten 24 h', () => {
    // Disjunkte Mengen ⇒ `count` ist eindeutig: 2 ungelesene, das gelesene zaehlt nicht mit.
    const state = readUpTo(NOW - HOUR)
    const [item] = computeUpdates(
        input({ state, events: [message('alt', NOW - 2 * HOUR), message('m1', NOW - 2 * MIN), message('m2', NOW - MIN)] }),
    )
    assert.equal(item.unread, true)
    assert.equal(item.count, 2)
})

// ── Regel 8: Sortierung ────────────────────────────────────────────────────

test('Regel 8: Buckets vor ts, ts absteigend innerhalb des Buckets', () => {
    const state = readUpTo(NOW - 30 * DAY)
    const items = computeUpdates(
        input({
            state,
            joined: [H, 'b', 'c', 'd'],
            roomNames: { [H]: 'Heute', b: 'Gestern', c: 'Woche', d: 'Aelter' },
            events: [
                message('m4', NOW - 10 * DAY, { h: 'd' }),
                message('m2', NOW - 26 * HOUR, { h: 'b' }),
                message('m1', NOW - MIN),
                message('m3', NOW - 3 * DAY, { h: 'c' }),
            ],
        }),
    )
    assert.deepEqual(items.map((i) => i.bucket), ['today', 'yesterday', 'week', 'older'])
})

test('Regel 8: bei GLEICHEM ts im selben Bucket gewinnt die Erwaehnung', () => {
    const state = readUpTo(NOW - HOUR)
    const items = computeUpdates(
        input({
            state,
            joined: [H, 'b'],
            roomNames: { [H]: 'Allgemein', b: 'Zweiter' },
            events: [message('m1', NOW - MIN, { h: 'b' }), message('m2', NOW - MIN, { content: mention(ME) })],
        }),
    )
    assert.deepEqual(items.map((i) => i.type), ['mention', 'message'])
})

test('Regel 8: KEIN globales Vorziehen — die aeltere Erwaehnung bleibt unten', () => {
    const state = readUpTo(NOW - 30 * DAY)
    const items = computeUpdates(
        input({
            state,
            joined: [H, 'b'],
            roomNames: { [H]: 'Allgemein', b: 'Zweiter' },
            events: [message('alt', NOW - 5 * DAY, { content: mention(ME) }), message('neu', NOW - MIN, { h: 'b' })],
        }),
    )
    assert.deepEqual(items.map((i) => i.type), ['message', 'mention'])
})

// ── Regel 9: Thread-Wasserzeichen ──────────────────────────────────────────

test('Regel 9: ein nie geoeffneter Thread meldet sich (anders als beim Punkt) — Boden ist das Raum-Wasserzeichen', () => {
    // `unread.ts` Regel 4 unterdrueckt nie geoeffnete Threads bewusst und verweist dafuer
    // auf DIESE Liste. Wuerde die Unterdrueckung hier wiederholt, haette die Antwort auf
    // einen fremd eroeffneten Thread gar keinen Ort mehr.
    const state = readUpTo(NOW - HOUR)
    const gemeldet = computeUpdates(input({ state, events: [root()], comments: [comment('k1', NOW - MIN)] }))
    assert.equal(gemeldet.length, 1)
    assert.equal(gemeldet[0].unread, true)

    const vorDemRaumLesen = computeUpdates(input({ state, events: [root()], comments: [comment('k1', NOW - 2 * HOUR)] }))
    assert.equal(vorDemRaumLesen.length, 1)
    assert.equal(vorDemRaumLesen[0].unread, false, 'vor dem Raum-Wasserzeichen ⇒ gelesen, kein Alarm')
})

test('Regel 9: existiert ein t:-Wasserzeichen, gilt NUR dieses', () => {
    const state: ReadState = { [roomKey(URL, H)]: NOW - HOUR, [threadKey(ROOT)]: NOW - 2 * MIN }
    const items = computeUpdates(
        input({ state, events: [root()], comments: [comment('k1', NOW - 3 * MIN), comment('k2', NOW - MIN)] }),
    )
    assert.equal(items.length, 1)
    assert.equal(items[0].count, 1, 'nur der Kommentar nach dem Thread-Wasserzeichen ist neu')
    assert.equal(items[0].unread, true)
})

// ── Regel 10: verwaist ─────────────────────────────────────────────────────

test('Regel 10: Raum ohne Namen ⇒ verwaist, Zeile bleibt stehen', () => {
    const items = computeUpdates(input({ state: readUpTo(NOW - HOUR), roomNames: {}, events: [message('m1', NOW - MIN)] }))
    assert.equal(items.length, 1, 'die Zeile verschwindet NICHT')
    assert.equal(items[0].orphan, true)
    assert.equal(items[0].title, 'Nachricht nicht mehr verfügbar')
    assert.equal(items[0].context, 'Unbekannter Raum')
    assert.equal(items[0].snippet !== undefined, true)
})

test('Regel 10: Wurzel nicht im Cache ist NICHT verwaist — der Deep-Link traegt', () => {
    // Der Cache-Deckel (300 Ereignisse / 30 Tage, `storage.ts`) laesst JEDE Antwort auf
    // einen aelteren Thread regulaer in diesen Zustand fallen. `loadThread` holt die Wurzel
    // frisch per `{ids:[rootId]}` vom Relay, `deriveThread` haelt so lange einen Platzhalter
    // — „nicht im Cache" ist nicht „geloescht". Die Zeile als „nicht mehr verfuegbar" zu
    // deaktivieren waere eine Falschaussage ueber einen lebenden Thread.
    const items = computeUpdates(input({ state: readUpTo(NOW - HOUR), comments: [comment('k1', NOW - MIN, { h: H })] }))
    assert.equal(items.length, 1)
    assert.equal(items[0].orphan, false)
    assert.equal(items[0].title, '1 neue Antwort', 'die Zeile sagt, was sie ist')
    assert.equal(
        items[0].href,
        `/rooms/${H}/thread/${nip19.neventEncode({ id: ROOT, relays: [URL] })}?from=updates`,
        'ohne gecachte Wurzel fehlt nur der optionale author-Hint (NIP-19), die Relay-Hint genuegt',
    )
    assert.equal(items[0].snippet !== undefined && items[0].pubkey === OTHER, true, 'Inhalt kommt aus dem Kommentar, nicht aus der Wurzel')
})

test('Regel 10: Gegenfall — fehlt der RAUMNAME, ist auch die Thread-Zeile verwaist', () => {
    const items = computeUpdates(
        input({ state: readUpTo(NOW - HOUR), roomNames: {}, events: [root()], comments: [comment('k1', NOW - MIN)] }),
    )
    assert.equal(items.length, 1)
    assert.equal(items[0].orphan, true)
    assert.equal(items[0].title, 'Nachricht nicht mehr verfügbar')
    assert.equal(items[0].context, 'Unbekannter Raum · Thread')
})

test('Regel 10: mit Raumname UND Wurzel ist nichts verwaist', () => {
    const [item] = computeUpdates(input({ state: readUpTo(NOW - HOUR), events: [root()], comments: [comment('k1', NOW - MIN)] }))
    assert.equal(item.orphan, false)
    assert.equal(item.context, 'Allgemein · Thread')
})

test('Regel 10/12: auch die verwaiste Zeile traegt ?from=updates', () => {
    const [item] = computeUpdates(input({ state: readUpTo(NOW - HOUR), roomNames: {}, events: [message('m1', NOW - MIN)] }))
    assert.equal(item.href.endsWith('?from=updates'), true)
})

// ── Regel 11: deutsches Zeit-Label ─────────────────────────────────────────

test('Regel 11: timeLabel ist deutsch, relativ und rein aus ts+now', () => {
    assert.equal(updateTimeLabel(NOW - 5, NOW), 'gerade eben')
    assert.equal(updateTimeLabel(NOW - 59, NOW), 'gerade eben')
    assert.equal(updateTimeLabel(NOW - 12 * MIN, NOW), 'vor 12 Min')
    assert.equal(updateTimeLabel(NOW - HOUR, NOW), 'vor 1 Std')
    assert.equal(updateTimeLabel(NOW - 23 * HOUR, NOW), 'vor 23 Std')
    assert.equal(updateTimeLabel(NOW - 26 * HOUR, NOW), 'gestern')
    assert.equal(updateTimeLabel(NOW - 5 * DAY, NOW), '18. Juli 2026')
    assert.equal(updateTimeLabel(NOW + 600, NOW), 'gerade eben', 'ein zukuenftiges created_at wird geklemmt')
})

test('Regel 11: die Zeile traegt das Label ihres juengsten Ereignisses', () => {
    const [item] = computeUpdates(input({ state: readUpTo(NOW - DAY), events: [message('m1', NOW - 12 * MIN)] }))
    assert.equal(item.timeLabel, 'vor 12 Min')
})

// ── Buckets ────────────────────────────────────────────────────────────────

test('Bucket-Grenzen: heute / gestern / diese Woche / aelter', () => {
    assert.equal(updateBucket(NOW, NOW), 'today')
    assert.equal(updateBucket(NOW - 11 * HOUR, NOW), 'today', '01:00 desselben Tages ist heute')
    assert.equal(updateBucket(NOW - 13 * HOUR, NOW), 'yesterday', '23:00 des Vortages ist gestern')
    assert.equal(updateBucket(NOW - 2 * DAY, NOW), 'week')
    assert.equal(updateBucket(NOW - 6 * DAY, NOW), 'week')
    assert.equal(updateBucket(NOW - 7 * DAY, NOW), 'older')
    assert.equal(updateBucket(NOW + DAY, NOW), 'today', 'zukuenftiges created_at faellt nach heute')
})

// ── Gast + Inhalt der Zeile ────────────────────────────────────────────────

test('Gast: kein pubkey ⇒ leere Liste', () => {
    assert.deepEqual(computeUpdates(input({ me: '', events: [message('m1', NOW - MIN)] })), [])
})

test('Snippet ist Rohtext ohne Zitat-Praefix und ohne Kuerzung', () => {
    const lang = 'x'.repeat(500)
    const zitat = message('m1', NOW - MIN, {
        content: `nostr:${nip19.noteEncode(ROOT)}\n\n${lang}`,
        tags: [['h', H], ['q', ROOT]],
    })
    const [item] = computeUpdates(input({ state: readUpTo(NOW - HOUR), events: [zitat] }))
    assert.equal(item.snippet, lang, 'das vorangestellte Zitat gehoert nicht ins Snippet')
    assert.equal(item.snippet.length, 500, 'gekuerzt wird in der View (line-clamp), nicht hier')
})

test('Autorname faellt auf den gekuerzten npub zurueck, Avatar auf den leeren String', () => {
    const [item] = computeUpdates(input({ state: readUpTo(NOW - HOUR), events: [message('m1', NOW - MIN)] }))
    assert.equal(item.picture, '')
    assert.match(item.authorName, /^npub1.+….+$/)

    const [mitProfil] = computeUpdates(
        input({
            state: readUpTo(NOW - HOUR),
            events: [message('m1', NOW - MIN)],
            profiles: profiles([[OTHER, { name: 'Bob', picture: 'https://example.test/b.png' }]]),
        }),
    )
    assert.equal(mitProfil.authorName, 'Bob')
    assert.equal(mitProfil.picture, 'https://example.test/b.png')
})

test('Singular/Plural stimmen in beiden Zustaenden', () => {
    const eine = computeUpdates(
        input({ state: readUpTo(NOW - HOUR), events: [message('m1', NOW - MIN)], profiles: profiles([[OTHER, { name: 'Bob' }]]) }),
    )
    assert.equal(eine[0].title, 'Bob · 1 neue Nachricht')

    const eineAntwort = computeUpdates(input({ state: readUpTo(NOW - HOUR), events: [root()], comments: [comment('k1', NOW - MIN)] }))
    assert.equal(eineAntwort[0].title, '1 neue Antwort')

    const geleseneAntwort = computeUpdates(input({ state: readUpTo(NOW), events: [root()], comments: [comment('k1', NOW - 2 * HOUR)] }))
    assert.equal(geleseneAntwort[0].title, '1 Antwort')
})

// ── F1: kein Wurf aus der Ableitung ────────────────────────────────────────
//
// Ein Wurf aus `computeUpdates` verlaesst den `derived`-Callback und bricht svelte 5.56.4s
// globale `subscriber_queue` DAUERHAFT — ein danach gesetzter, voellig unabhaengiger
// `writable` erreicht seine Subscriber nicht mehr (selbst nachgemessen 2026-07-23). Ein
// einziges Fremd-Event mit krummem Tag-Wert legte damit den gesamten welshman→Alpine-
// Zustand des Tabs still: Chat, Ungelesen-Punkt, Mitgliederliste. Diese Tests sind der
// Riegel davor, nicht Kosmetik.

/** Faengt `console.warn` fuer die Dauer von `fn` ein — der Riegel soll protokollieren, nicht schlucken. */
const withCapturedWarnings = <T>(fn: () => T): { result: T; warnings: number } => {
    const original = console.warn
    let warnings = 0
    console.warn = () => {
        warnings++
    }
    try {
        return { result: fn(), warnings }
    } finally {
        console.warn = original
    }
}

test('F1: krummes E-Tag wirft nicht und reisst die uebrigen Zeilen nicht mit', () => {
    // `neventEncode({id:'nicht-hex'})` wirft „Input string must contain hex characters in
    // even length" (gemessen). Jedes Raum-Mitglied kann so ein kind-1111 publizieren,
    // zooid prueft Tag-Werte nicht.
    const state = readUpTo(NOW - HOUR)
    const build = () =>
        computeUpdates(
            input({
                state,
                joined: [H, 'b'],
                roomNames: { [H]: 'Allgemein', b: 'Zweiter' },
                events: [root(), message('m1', NOW - MIN, { h: 'b' })],
                comments: [
                    comment('bad1', NOW - MIN, { rootId: 'nicht-hex', h: H }),
                    comment('bad2', NOW - MIN, { rootId: 'abc', h: H }),
                    comment('bad3', NOW - MIN, { rootId: 'a'.repeat(63), h: H }),
                    comment('gut', NOW - MIN),
                ],
            }),
        )
    assert.doesNotThrow(build)
    const keys = build().map((i) => i.key).sort()
    assert.deepEqual(keys, ['message:b', `thread:${ROOT}`], 'die drei krummen Kommentare fallen raus, die guten Zeilen stehen')
})

test('F1: gross geschriebenes E-Tag wird normalisiert, nicht in zwei Threads gespalten', () => {
    // `A×64` laeuft durch `neventEncode` durch (bech32 kodiert die Bytes, der nevent ist
    // identisch), spaltete als roher Gruppierungsschluessel aber denselben Thread in zwei
    // Zeilen und passte nicht zum byte-genauen `#E`-Filter am Relay.
    assert.equal(updatesCommentRootId(comment('x', 1, { rootId: ROOT.toUpperCase() }) as never), ROOT)
    const items = computeUpdates(
        input({
            state: readUpTo(NOW - HOUR),
            events: [root()],
            comments: [comment('k1', NOW - 2 * MIN, { rootId: ROOT.toUpperCase() }), comment('k2', NOW - MIN)],
        }),
    )
    assert.equal(items.length, 1, 'EINE Zeile, nicht zwei')
    assert.equal(items[0].key, `thread:${ROOT}`)
    assert.equal(items[0].count, 2)
    assert.equal(items[0].href.includes(nip19.neventEncode({ id: ROOT, relays: [URL], author: THIRD })), true)
})

test('F1: der Riegel faengt auch Wuerfe, die die Hex-Pruefung gar nicht kennt', () => {
    // Zweite Haelfte des Fixes: die Hex-Pruefung schliesst den heute bekannten Pfad, nicht
    // den naechsten. `buildItem` ruft mit `neventEncode` UND `displayPubkey`→`npubEncode`
    // zwei Kodierer auf, die bei krummen Eingaben werfen. Hier: ein Ereignis mit kaputtem
    // pubkey — seine Zeile faellt weg, die Zeile des anderen Raums bleibt unversehrt.
    const state = readUpTo(NOW - HOUR)
    const build = () =>
        computeUpdates(
            input({
                state,
                joined: [H, 'b'],
                roomNames: { [H]: 'Allgemein', b: 'Zweiter' },
                events: [message('kaputt', NOW - MIN, { author: 'zz' }), message('gut', NOW - MIN, { h: 'b' })],
            }),
        )
    // Ein Wurf laesst diesen Test von selbst fallen — `withCapturedWarnings` reicht ihn
    // durch (und stellt `console.warn` im `finally` wieder her).
    const { result, warnings } = withCapturedWarnings(build)
    assert.deepEqual(result.map((i) => i.key), ['message:b'], 'die gute Zeile ueberlebt die kaputte')
    assert.equal(warnings, 1, 'der uebersprungene Eintrag wird protokolliert, nicht still geschluckt')
})

// ── F3: Zukunfts-Zeitstempel ──────────────────────────────────────────────
//
// `created_at` ist autorgesetzt (NIP-01), zooid prueft es nicht — eine falsch gestellte
// Uhr genuegt. Zwei Schaeden, beide gemessen: (a) `markAllRead` schreibt die Wall-Clock,
// das Ereignis blieb DAUERHAFT ungelesen und der Knopf war eine Handlung ohne Wirkung;
// (b) in der gelesenen Zeile lieferte es Titel, Snippet, Avatar und mit `ts = now` den
// ersten Platz — ueber ein Jahr lang, weil die 24-h-Frist ab dem BEHAUPTETEN Zeitpunkt
// laeuft. Deshalb traegt Zukunftsdatiertes gar nichts mehr bei (Regel 11).

test('F3: Alles-gelesen wirkt auch gegen ein zukunftsdatiertes Ereignis', () => {
    const state: ReadState = { [ALL_KEY]: NOW }
    const events = [message('zukunft', NOW + HOUR)]

    assert.deepEqual(computeUpdates(input({ state, events })), [], 'keine Zeile, kein Punkt, nichts zu quittieren')

    // Die Uhr laeuft weiter: ein Deckel auf `min(created_at, now)` allein wuerde die Zeile
    // eine Sekunde spaeter wieder ungelesen machen. Genau das darf nicht passieren.
    const spaeter = computeUpdates(input({ state, events, now: NOW + 5 * MIN }))
    assert.deepEqual(spaeter, [], 'auch fuenf Minuten spaeter noch still')
})

test('F3: ein Fremder kann die Zeile eines Raums nicht besetzen', () => {
    // Das reproduzierte Szenario: `all = NOW` (alles gelesen), ein Ereignis 400 Tage in der
    // Zukunft in raum1, ein echtes 30 s altes in raum2. Vor Regel 11 stand die Attrappe auf
    // Platz 1 (`ts-now: 0`) und verdraengte die echte Nachricht — ueber ein Jahr lang.
    const items = computeUpdates(
        input({
            state: { [ALL_KEY]: NOW },
            joined: ['raum1', 'raum2'],
            roomNames: { raum1: 'Raum 1', raum2: 'Raum 2' },
            events: [
                message('fake', NOW + 400 * DAY, { h: 'raum1', content: 'ICH BESETZE DIE ZEILE' }),
                message('echt', NOW - 30, { h: 'raum2', content: 'echte neue nachricht' }),
            ],
        }),
    )
    assert.deepEqual(items.map((i) => i.h), ['raum2'], 'nur die echte Zeile steht — und zwar auf Platz 1')
    assert.equal(items[0].snippet, 'echte neue nachricht')
})

test('F3: Zukunftsdatiertes zaehlt auch in einer Sammelzeile nicht mit', () => {
    // Weder Zaehler noch Snippet: die Zeile gehoert dem juengsten ECHTEN Ereignis.
    const items = computeUpdates(
        input({
            state: readUpTo(NOW - HOUR),
            events: [
                message('echt1', NOW - 2 * MIN, { content: 'zweitjuengste' }),
                message('echt2', NOW - MIN, { content: 'juengste echte' }),
                message('fake', NOW + HOUR, { content: 'ICH BESETZE DIE ZEILE' }),
            ],
        }),
    )
    assert.equal(items.length, 1)
    assert.equal(items[0].count, 2, 'die Attrappe erhoeht den Zaehler nicht')
    assert.equal(items[0].snippet, 'juengste echte')
    assert.equal(items[0].ts, NOW - MIN)
})

test('F3: der zugestandene Uhrenversatz von 60 s bleibt unangetastet', () => {
    // Der Nachbar-Stack deckelt mit `CLOCK_SKEW_SECONDS = 60` (RelayPollWorker.kt) — beide
    // Haelften des Systems muessen gleich rechnen, sonst driften Web- und Push-Meldung.
    // Dieselbe Schwelle gilt fuer „ungelesen" UND fuer „darf seine Zeile vertreten": es
    // gibt keinen Zwischenzustand, in dem ein Ereignis zaehlt, aber nicht sichtbar ist.
    assert.equal(CLOCK_SKEW_SEC, 60)
    const state: ReadState = { [ALL_KEY]: NOW - HOUR }
    const knappVor = computeUpdates(input({ state, events: [message('m1', NOW + 30)] }))
    assert.equal(knappVor.length, 1, 'eine leicht vorgehende Uhr kostet keine Meldung')
    assert.equal(knappVor[0].unread, true)
    assert.equal(knappVor[0].ts, NOW, 'nur der Sortierschluessel wird auf jetzt gedeckelt')

    const weitVor = computeUpdates(input({ state, events: [message('m1', NOW + 5 * MIN)] }))
    assert.deepEqual(weitVor, [], 'jenseits der Toleranz traegt das Ereignis gar nichts bei')
})

test('F3: die Regel gilt im Thread genauso und nimmt normalen Ereignissen nichts', () => {
    const state: ReadState = { [ALL_KEY]: NOW }
    const zukunft = computeUpdates(input({ state, events: [root()], comments: [comment('k1', NOW + HOUR)] }))
    assert.deepEqual(zukunft, [])

    // Gegenprobe: ein regulaer datiertes Ereignis hinter dem Wasserzeichen bleibt ungelesen.
    const normal = computeUpdates(input({ state: { [ALL_KEY]: NOW - HOUR }, events: [message('m1', NOW - MIN)] }))
    assert.equal(normal[0].unread, true)
})

// ── B3: der Erwähnungs-Scan darf nicht am Inhalt hängen ────────────────────
//
// Gemessen (Mittel aus 3 Läufen, 50 Ereignisse, gleiche Bytezahl): normaler Text 1 ms,
// Inhalt aus `nostr:npub1x `-Attrappen 197 ms (16 KB/Ereignis) bzw. 691 ms (64 KB) —
// Faktor ~700. Teuer ist nicht das Suchen, sondern jeder fehlschlagende `nip19.decode`
// samt Error-Stack. Bei 300 ms Drosselung stünde der Main-Thread, solange die Ereignisse
// ungelesen sind. Geprüft wird deshalb der AUFWAND (Anzahl der Dekodier-Versuche), nicht
// die Zeit — eine Zeitschranke wäre auf fremder Hardware eine Behauptung, kein Anker.

test('B3: npub-Attrappen loesen keinen einzigen Dekodier-Versuch aus', () => {
    const attrappen = 'nostr:npub1x '.repeat(10_000)
    assert.deepEqual(updatesMentionCandidates(attrappen), [], 'nichts davon wird dekodiert')
    assert.equal(updatesMentionsPubkey(attrappen, ME), false)
})

test('B3: auch gueltig lange npub-Token werden nicht dekodiert — verglichen wird der eigene Schluessel', () => {
    // Der npub-Zweig kehrt die Frage um: der eigene Schluessel wird EINMAL kodiert und
    // gesucht. Fremde npubs sind damit gratis, egal wie viele es sind.
    const fremde = `nostr:${nip19.npubEncode(OTHER)} `.repeat(500)
    assert.deepEqual(updatesMentionCandidates(fremde), [])
    assert.equal(updatesMentionsPubkey(fremde, ME), false)
    assert.equal(updatesMentionsPubkey(fremde + mention(ME), ME), true, 'die echte Erwaehnung wird trotzdem gefunden')
})

test('B3: nprofile-Token sind laengen-vorgefiltert und gedeckelt', () => {
    const echt = nip19.nprofileEncode({ pubkey: ME })
    assert.equal(updatesMentionsPubkey(`Hallo nostr:${echt}`, ME), true, 'nprofile bleibt eine Erwaehnung')

    const zuKurz = 'nostr:nprofile1abc '.repeat(1000)
    assert.deepEqual(updatesMentionCandidates(zuKurz), [], 'zu kurz fuer einen Profil-Zeiger ⇒ kein decode')

    const viele = `nostr:${nip19.nprofileEncode({ pubkey: OTHER })} `.repeat(MENTION_DECODE_CAP + 20)
    assert.equal(updatesMentionCandidates(viele).length, MENTION_DECODE_CAP, 'der Deckel greift')
})

test('B3: die Grenze am Token-Ende bleibt scharf (kein blosses includes)', () => {
    // `nostr:<mein npub>xyz` ist ein ANDERES, kaputtes Token — ein reines `includes` haette
    // es als Erwaehnung gezaehlt und waere damit faelschbar.
    const angehaengt = `nostr:${nip19.npubEncode(ME)}xyz`
    assert.equal(updatesMentionsPubkey(angehaengt, ME), false)
    assert.equal(updatesMentionsPubkey(`nostr:${nip19.npubEncode(ME)}.`, ME), true, 'Satzzeichen beendet das Token')
})

test('B3: der Scan bleibt an der Ableitung wirksam — Attrappen erzeugen keine Erwaehnungs-Zeile', () => {
    const items = computeUpdates(
        input({
            state: readUpTo(NOW - HOUR),
            events: [message('m1', NOW - MIN, { content: 'nostr:npub1x '.repeat(5_000) })],
        }),
    )
    assert.deepEqual(items.map((i) => i.type), ['message'], 'Attrappen sind Text, keine Erwaehnung')
})
