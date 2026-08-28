/**
 * Der Ungelesen-Zähler — was ihn hochzählt und was ihn NICHT hochzählt.
 *
 * Der teure Fehler ist hier nicht der fehlende Marker, sondern der falsche: ein Zähler,
 * der eine Zahl behauptet, die im Raum darunter nicht nachzuzählen ist, wird nach zwei
 * Tagen ignoriert — und dann nützt auch der richtige nichts mehr. Die Gegenproben
 * (eigene Nachricht, fremder Raum, Gast, nie gelesener Thread) sind deshalb genauso
 * verbindlich wie die Positivfälle.
 *
 * Seit P6 sind die Werte ZAHLEN statt Wahrheitswerten. Die Fälle, die den Marker nur
 * an-/ausschalten, prüfen deshalb `0` bzw. `undefined` — die Unterscheidung „Schlüssel
 * mit 0" (beigetreten, gelesen) gegen „kein Schlüssel" (nicht beigetreten) ist Teil des
 * Vertrags und wird eigens geprüft.
 *
 * Ausführen: node --test packages/einundzwanzig-group/js/unread.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MESSAGE, COMMENT, POLL } from './welshmanKinds.ts'
import {
    BADGE_CAP,
    BELL_CAP,
    EMPTY_UNREAD,
    computeUnread,
    formatUnreadCount,
    sumUnreadRooms,
    unreadCommentRootId,
    type UnreadInput,
} from './unread.ts'
import { roomKey, threadKey, ALL_KEY, type ReadState } from './readState.ts'

const URL = 'wss://relay.example/'
const ME = 'a'.repeat(64)
const OTHER = 'b'.repeat(64)
const ROOT = 'c'.repeat(64)

const message = (id: string, createdAt: number, h: string, author = OTHER, kind = MESSAGE) =>
    ({ id, kind, created_at: createdAt, pubkey: author, tags: [['h', h]], content: '', sig: '' }) as never

const comment = (id: string, createdAt: number, rootId = ROOT, author = OTHER) =>
    ({ id, kind: COMMENT, created_at: createdAt, pubkey: author, tags: [['E', rootId]], content: '', sig: '' }) as never

/**
 * `h` ist optional, aber NICHT dekorativ: Lotus' kind-10 tragen laut `feeds.ts` neben dem
 * root-Marker ein `["h", groupId, relay]` — und genau diese Events laufen durch dieselbe
 * Kommentar-Schleife wie unsere kind-1111. Ein Helfer ohne `h` liesse eine Doppelzaehlung
 * (Kommentar zaehlt zusaetzlich in den Raum) unentdeckt durch die Suite.
 */
const lotusComment = (id: string, createdAt: number, rootId = ROOT, h = '') =>
    ({
        id,
        kind: 10,
        created_at: createdAt,
        pubkey: OTHER,
        tags: h ? [['e', rootId, URL, 'root'], ['h', h, URL]] : [['e', rootId, URL, 'root']],
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
    assert.equal(view.rooms.raum, 1)
    assert.equal(view.any, true)
})

test('Genau AUF dem Wasserzeichen zaehlt nicht (sonst ist Quittieren wirkungslos)', () => {
    // NIP-01-`since` ist inklusiv; waere der Vergleich `>=`, waere die gerade gelesene
    // Nachricht im selben Moment wieder ungelesen und der Punkt ginge nie aus.
    const state: ReadState = { [roomKey(URL, 'raum')]: 1000 }
    const view = computeUnread(input({ state, events: [message('m1', 1000, 'raum')] }))
    assert.equal(view.rooms.raum, 0, 'beigetreten und gelesen ⇒ Schluessel mit 0, nicht `undefined`')
    assert.equal(view.any, false)
})

test('Die eigene Nachricht macht den eigenen Raum nicht ungelesen', () => {
    const view = computeUnread(input({ events: [message('m1', 9999, 'raum', ME)] }))
    assert.equal(view.rooms.raum, 0)
})

test('Polls und Spendenziele zaehlen wie Nachrichten (sie stehen im selben Verlauf)', () => {
    const view = computeUnread(input({ events: [message('p1', 9999, 'raum', OTHER, POLL)] }))
    assert.equal(view.rooms.raum, 1)
})

test('Ein Raum, in dem ich nicht bin, bekommt gar keinen Schluessel', () => {
    // Sonst leuchtete die Uebersicht bei jedem der 85 fremden Meetup-Raeume auf.
    const view = computeUnread(input({ joined: ['raum'], events: [message('m1', 9999, 'fremder-raum')] }))
    assert.equal('fremder-raum' in view.rooms, false)
    assert.equal(view.any, false)
})

test('Gast: kein pubkey ⇒ nichts ist ungelesen', () => {
    const view = computeUnread(input({ me: '', events: [message('m1', 9999, 'raum')] }))
    assert.deepEqual(view, EMPTY_UNREAD)
})

test('`all` ist der Boden fuer Raeume ohne eigenes Wasserzeichen', () => {
    // „Alles gelesen" muss auch Raeume decken, die noch nie einzeln quittiert wurden —
    // und der frisch angelegte Account, dessen `all` auf „jetzt" steht, darf nicht von
    // 300 gecachten Nachrichten begruesst werden.
    const state: ReadState = { [ALL_KEY]: 5000 }
    const view = computeUnread(input({ state, events: [message('alt', 4999, 'raum'), message('neu', 5001, 'raum')] }))
    assert.equal(view.rooms.raum, 1, 'nur die Nachricht NACH dem all-Wasserzeichen zaehlt')

    const nurAlt = computeUnread(input({ state, events: [message('alt', 4999, 'raum')] }))
    assert.equal(nurAlt.rooms.raum, 0, 'alles vor `all` ist quittiert')
})

test('Thread-Punkt nur fuer Threads, die ich schon einmal gelesen habe', () => {
    // Ohne diese Regel waere jeder je im Space eroeffnete Thread beim ersten Blick
    // ungelesen. Wer mich erwaehnt oder mir antwortet, erreicht mich in P4 ueber die
    // Benachrichtigungs-Liste — nicht ueber diesen Punkt.
    const ungelesen = computeUnread(input({ comments: [comment('k1', 9999)] }))
    assert.equal(ungelesen.threads[ROOT], undefined, 'nie geoeffnet ⇒ kein Punkt')

    const state: ReadState = { [threadKey(ROOT)]: 1000 }
    const gelesen = computeUnread(input({ state, comments: [comment('k1', 1001)] }))
    assert.equal(gelesen.threads[ROOT], 1)
    assert.equal(gelesen.any, true)
})

test('Raum-Lesen quittiert KEINEN Thread (Kommentare stehen nicht im Raum-Feed)', () => {
    // NIP-22: unsere kind-1111 tragen kein `#h` und erscheinen im Raum-Verlauf nicht.
    // Ein Raum-Wasserzeichen als Boden fuer Threads wuerde ungelesene Antworten
    // stummschalten — Flotilla macht genau das (Pfad-Praefix), wir bewusst nicht.
    const state: ReadState = { [roomKey(URL, 'raum')]: 9_999_999, [threadKey(ROOT)]: 1000 }
    const view = computeUnread(input({ state, comments: [comment('k1', 1001)] }))
    assert.equal(view.threads[ROOT], 1)
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
    assert.equal(view.threads[ROOT], 1)
})

test('`any` fasst Raeume UND Threads zusammen (der Punkt am Chat-Tab)', () => {
    const nurThread = computeUnread(
        input({ state: { [threadKey(ROOT)]: 1000 }, comments: [comment('k1', 1001)] }),
    )
    assert.equal(nurThread.rooms.raum, 0)
    assert.equal(nurThread.any, true, 'ein ungelesener Thread allein reicht fuer den Tab-Punkt')

    const nichts = computeUnread(input())
    assert.equal(nichts.any, false)
})

// ── P6: aus dem Punkt wird eine Zahl ──────────────────────────────────────

test('Mehrere fremde Nachrichten zaehlen EINZELN — auch vom selben Autor', () => {
    // Regel 6: gezaehlt werden Ereignisse, nicht Autoren. „3" muss heissen, dass im Raum
    // drei Nachrichten stehen — sonst kann der Nutzer die Pille nicht nachzaehlen.
    const state: ReadState = { [roomKey(URL, 'raum')]: 1000 }
    const view = computeUnread(
        input({
            state,
            events: [message('m1', 1001, 'raum'), message('m2', 1002, 'raum'), message('m3', 1003, 'raum')],
        }),
    )
    assert.equal(view.rooms.raum, 3)
    assert.equal(view.roomsTotal, 3)
})

test('Gelesene Nachrichten zaehlen nicht mit — nur die jenseits des Wasserzeichens', () => {
    const state: ReadState = { [roomKey(URL, 'raum')]: 1000 }
    const view = computeUnread(
        input({ state, events: [message('alt', 999, 'raum'), message('grenze', 1000, 'raum'), message('neu', 1001, 'raum')] }),
    )
    assert.equal(view.rooms.raum, 1)
})

test('roomsTotal summiert ueber Raeume, threadsTotal ueber Threads — ohne Ueberschneidung', () => {
    // Regel 5 in Zahlform: ein Kommentar zaehlt in seinen Thread und NIE zusaetzlich in
    // den Raum. Die beiden Tab-Pillen zeigen deshalb disjunkte Mengen.
    const ROOT2 = 'd'.repeat(64)
    const state: ReadState = {
        [roomKey(URL, 'a')]: 1000,
        [roomKey(URL, 'b')]: 1000,
        [threadKey(ROOT)]: 1000,
        [threadKey(ROOT2)]: 1000,
    }
    const view = computeUnread(
        input({
            state,
            joined: ['a', 'b', 'c'],
            events: [message('m1', 1001, 'a'), message('m2', 1002, 'a'), message('m3', 1001, 'b')],
            comments: [comment('k1', 1001, ROOT), comment('k2', 1002, ROOT), comment('k3', 1001, ROOT2)],
        }),
    )
    assert.deepEqual(view.rooms, { a: 2, b: 1, c: 0 }, 'der stille Raum behaelt seinen Schluessel mit 0')
    assert.deepEqual(view.threads, { [ROOT]: 2, [ROOT2]: 1 })
    assert.equal(view.roomsTotal, 3)
    assert.equal(view.threadsTotal, 3)
    assert.equal(view.any, true)
})

test('Ein Raum, in dem ich nicht bin, zaehlt auch nicht in die Tab-Summe', () => {
    const view = computeUnread(
        input({ joined: ['raum'], events: [message('m1', 9999, 'fremder-raum'), message('m2', 9998, 'fremder-raum')] }),
    )
    assert.equal('fremder-raum' in view.rooms, false)
    assert.equal(view.roomsTotal, 0)
    assert.equal(view.any, false)
})

test('Mehrere Antworten im selben Thread zaehlen einzeln', () => {
    const state: ReadState = { [threadKey(ROOT)]: 1000 }
    const view = computeUnread(input({ state, comments: [comment('k1', 1001), comment('k2', 1002)] }))
    assert.equal(view.threads[ROOT], 2)
    assert.equal(view.threadsTotal, 2)
})

test('Ein gelesener Thread bekommt KEINEN Schluessel (anders als ein Raum)', () => {
    // Bewusste Asymmetrie: `joined` ist klein und bekannt, die Menge je gelesener Threads
    // waechst grow-only mit. Nullen fuer jeden davon waeren Ballast, den niemand liest.
    const state: ReadState = { [threadKey(ROOT)]: 9999 }
    const view = computeUnread(input({ state, comments: [comment('k1', 1001)] }))
    assert.equal(ROOT in view.threads, false)
    assert.equal(view.threadsTotal, 0)
})

test('Der Nullfall traegt alle Schluessel und alle Nullen', () => {
    const view = computeUnread(input({ joined: ['a', 'b'] }))
    assert.deepEqual(view, { rooms: { a: 0, b: 0 }, threads: {}, any: false, roomsTotal: 0, threadsTotal: 0 })
})

// ── Cap-Formatierung (§4.1/§4.2) ──────────────────────────────────────────

test('Pillen-Cap 99: exakt bis zur Schwelle, erst darueber das Plus', () => {
    assert.equal(formatUnreadCount(0), '', 'bei 0 steht keine Pille — der leere Text laesst sie verschwinden')
    assert.equal(formatUnreadCount(1), '1')
    assert.equal(formatUnreadCount(98), '98')
    assert.equal(formatUnreadCount(BADGE_CAP), '99', 'genau 99 kennen wir genau — `99+` waere gelogen')
    assert.equal(formatUnreadCount(BADGE_CAP + 1), '99+')
    assert.equal(formatUnreadCount(4711), '99+')
})

test('Glocken-Cap 9: dieselbe Regel, andere Schwelle', () => {
    assert.equal(formatUnreadCount(0, BELL_CAP), '')
    assert.equal(formatUnreadCount(1, BELL_CAP), '1')
    assert.equal(formatUnreadCount(BELL_CAP, BELL_CAP), '9')
    assert.equal(formatUnreadCount(BELL_CAP + 1, BELL_CAP), '9+')
    assert.equal(formatUnreadCount(12, BELL_CAP), '9+', '§4.1 Nr. 6: 12 Hinweise passen nicht dreistellig in den Kopf')
})

test('Unsinn wird still zu einer leeren Pille, nie zu einer Zahl', () => {
    // Das Template ruft blind auf: `threads[rootId]` ist fuer einen gelesenen Thread
    // `undefined`, und ein `?? 0` an jeder Aufrufstelle waere die schlechtere Zusage.
    for (const wert of [undefined, null, Number.NaN, -1, -99, Number.NEGATIVE_INFINITY, 0.4]) {
        assert.equal(formatUnreadCount(wert), '', `${String(wert)} darf keine Pille erzeugen`)
    }
    assert.equal(formatUnreadCount(Number.POSITIVE_INFINITY), '', 'unendlich ist keine zaehlbare Menge')
})

test('Gebrochene Zahlen werden abgeschnitten, nicht gerundet', () => {
    assert.equal(formatUnreadCount(3.7), '3')
    assert.equal(formatUnreadCount(99.9), '99')
})

test('Eine Cap unter 1 erzeugt keine `0+`-Pille', () => {
    assert.equal(formatUnreadCount(5, 0), '1+')
    assert.equal(formatUnreadCount(1, 0), '1')
})

test('Lotus-Kommentar MIT `h` zaehlt in den Thread — und NIE zusaetzlich in den Raum', () => {
    // Der Fall, der ohne eigenen Anker durchrutscht: Lotus' kind-10 tragen ein
    // `["h", groupId, relay]` (feeds.ts) und laufen durch DIESELBE Kommentar-Schleife.
    // Wer dort das `h`-Muster der Nachrichten-Schleife hineinkopiert, zaehlt denselben
    // Kommentar zweimal — einmal im Thread und einmal im Raum. Die Tab-Pillen „Raeume"
    // und „Threads" waeren dann nicht mehr disjunkt und ihre Summe groesser als der
    // Bestand: die Zahl liesse sich nicht mehr nachzaehlen, und genau das ist der
    // Fehler, der eine Zahl dauerhaft verbrennt.
    const state: ReadState = { [roomKey(URL, 'raum')]: 1000, [threadKey(ROOT)]: 1000 }
    const view = computeUnread(input({ state, comments: [lotusComment('k1', 1001, ROOT, 'raum')] }))

    assert.equal(view.threads[ROOT], 1, 'der Thread zaehlt')
    assert.equal(view.threadsTotal, 1)
    assert.equal(view.rooms.raum, 0, 'der Raum zaehlt NICHT mit — Kommentare stehen nicht im Raum-Feed')
    assert.equal(view.roomsTotal, 0, 'sonst waere die Summe der beiden Tab-Pillen groesser als der Bestand')
})

// ── Teilsumme hinter einer Zeile (Entdecken-Zeile Projektunterstuetzung) ────
//
// Der Anlass ist eine Umbau-Falle, keine Formatierungsfrage: seit die Antragsraeume
// samt der BEIGETRETENEN vollstaendig hinter ihrer Entdecken-Zeile liegen, ist die
// Pille an dieser Zeile der EINZIGE Ort, an dem ihr Ungelesenes noch sichtbar ist.
// Faellt sie aus oder zaehlt sie falsch, verschluckt der Umbau Nachrichten.

test('sumUnreadRooms faltet genau die ausgewaehlten Raeume', () => {
    const rooms = { a: 3, b: 0, c: 7, d: 1 }

    assert.equal(sumUnreadRooms(rooms, ['a', 'c']), 10)
    assert.equal(sumUnreadRooms(rooms, ['b']), 0, 'gelesener Raum steuert 0 bei')
    assert.equal(sumUnreadRooms(rooms, []), 0, 'leere Auswahl → keine Pille')
})

test('sumUnreadRooms vertraegt fehlende Schluessel und einen leeren Store', () => {
    // Der Normalfall an der Entdecken-Zeile: hinter ihr liegen auch FREMDE Raeume
    // (Vorstandsblick). Die haben nach `computeUnread` Regel 1 gar keinen Schluessel
    // — sie duerfen die Summe weder werfen noch zu NaN machen.
    const rooms = { a: 4 }

    assert.equal(sumUnreadRooms(rooms, ['a', 'fremd', 'auch-fremd']), 4)
    assert.equal(sumUnreadRooms(undefined, ['a']), 0, 'Store noch nicht befuellt → 0, keine Ausnahme')
    assert.equal(sumUnreadRooms(null, ['a']), 0)
    assert.equal(sumUnreadRooms({ a: Number.NaN } as never, ['a']), 0, 'Unsinn zaehlt nicht als Zahl')
})

test('Ein Raum, der zweimal in der Auswahl steht, zaehlt einmal', () => {
    // `_proposalPool()` dedupliziert selbst ueber `h`; die Summe verlaesst sich
    // trotzdem nicht darauf. Doppelt gezaehlt waere die Zahl groesser als die
    // Tab-Pille — genau die Divergenz, die eine Zahl unbrauchbar macht.
    assert.equal(sumUnreadRooms({ a: 5 }, ['a', 'a']), 5)
})

test('Die Pille an der Zeile ist eine PARTITION von roomsTotal, keine zweite Zaehlung', () => {
    // Der eigentliche Beleg fuer den Umbau: „Meine Raeume" zeigt die Standard-Raeume,
    // die Entdecken-Zeile die Antragsraeume — zusammen ergeben sie exakt die Zahl an
    // der Tab-Pille „Raeume". Und `roomsTotal` selbst bleibt kategorieblind: dass ein
    // beigetretener Antragsraum aus einer LISTE verschwindet, aendert an `joined`
    // nichts, denn `joinedRoomHs` faellt aus `userRooms` ohne Kategorie-Filter.
    const state: ReadState = {
        [roomKey(URL, 'welcome')]: 1000,
        [roomKey(URL, 'antrag-1')]: 1000,
        [roomKey(URL, 'antrag-2')]: 1000,
    }
    const view = computeUnread(
        input({
            joined: ['welcome', 'antrag-1', 'antrag-2'],
            state,
            events: [
                message('m1', 1001, 'welcome'),
                message('m2', 1002, 'antrag-1'),
                message('m3', 1003, 'antrag-1'),
                message('m4', 1004, 'antrag-2'),
            ],
        }),
    )

    const proposals = ['antrag-1', 'antrag-2']
    const standard = ['welcome']

    assert.equal(view.roomsTotal, 4, 'die Tab-Pille zaehlt ALLE beigetretenen Raeume, auch die Antraege')
    assert.equal(sumUnreadRooms(view.rooms, proposals), 3, 'die Pille an der Entdecken-Zeile')
    assert.equal(sumUnreadRooms(view.rooms, standard), 1)
    assert.equal(
        sumUnreadRooms(view.rooms, proposals) + sumUnreadRooms(view.rooms, standard),
        view.roomsTotal,
        'kein Ereignis faellt zwischen die beiden Orte, keins wird doppelt gezeigt',
    )
    assert.ok(sumUnreadRooms(view.rooms, proposals) <= view.roomsTotal, 'eine Teilsumme kann nie ueber der Gesamtsumme liegen')
})

// ── Buzz-Antworten: kind 9 im selben `#h`-Strom wie die Wurzeln ────────────

/**
 * Eine Buzz-Antwort ist eine Raum-Nachricht mit `reply`-Marker — sie kommt durch
 * `input.events`, nicht durch `input.comments`. Das ist der ganze Unterschied.
 */
const buzzReply = (id: string, createdAt: number, h: string, rootId = ROOT, author = OTHER) =>
    ({
        id,
        kind: MESSAGE,
        created_at: createdAt,
        pubkey: author,
        tags: [['h', h], ['e', rootId, '', 'reply']],
        content: '',
        sig: '',
    }) as never

test('Buzz-Antwort zaehlt in ihren THREAD, nicht in den Raum', () => {
    // Regel 5/6 in Buzz-Form: der Raum-Feed zeigt die Antwort nicht (sie steht im Thread),
    // also darf die Raum-Pille sie auch nicht behaupten. Ohne den Schnitt zaehlte dieselbe
    // Antwort im Raum — eine Zahl, die im Raum darunter nicht nachzuzaehlen waere.
    const state: ReadState = { [roomKey(URL, 'raum')]: 1000, [threadKey(ROOT)]: 1000 }
    const view = computeUnread(input({ state, events: [buzzReply('r1', 1001, 'raum')] }))

    assert.equal(view.rooms.raum, 0, 'kein Raum-Punkt fuer eine Thread-Antwort')
    assert.equal(view.threads[ROOT], 1)
    assert.equal(view.roomsTotal, 0)
    assert.equal(view.threadsTotal, 1)
})

test('Wurzel und Antwort im selben Strom werden getrennt gezaehlt', () => {
    const state: ReadState = { [roomKey(URL, 'raum')]: 1000, [threadKey(ROOT)]: 1000 }
    const view = computeUnread(
        input({ state, events: [message('m1', 1001, 'raum'), buzzReply('r1', 1002, 'raum')] }),
    )

    assert.equal(view.rooms.raum, 1, 'nur die Wurzel')
    assert.equal(view.threads[ROOT], 1, 'nur die Antwort')
    assert.equal(view.roomsTotal + view.threadsTotal, 2, 'kein Ereignis doppelt, keins verloren')
})

test('Buzz-Antwort in einem NIE gelesenen Thread zaehlt nirgends (Regel 4 gilt auch hier)', () => {
    // Ohne `t:`-Wasserzeichen gibt es keinen Thread-Punkt. Der Fehler waere, sie
    // ersatzweise dem Raum zuzuschlagen — dann leuchtete jeder je eroeffnete Thread
    // als Raum-Nachricht auf, und zwar dauerhaft.
    const state: ReadState = { [roomKey(URL, 'raum')]: 1000 }
    const view = computeUnread(input({ state, events: [buzzReply('r1', 1001, 'raum')] }))

    assert.equal(view.rooms.raum, 0)
    assert.equal(view.threads[ROOT], undefined)
    assert.equal(view.any, false)
})

test('Die Wurzel einer Buzz-Antwort wird aus dem `reply`-Marker gelesen (Tiefe 1)', () => {
    // Bei Tiefe 1 gibt es KEINEN root-Marker (Buzz-Regel 1). Ein Leser, der nur `root`
    // kennt, faende hier '' und liesse die Antwort still fallen.
    assert.equal(unreadCommentRootId(buzzReply('r1', 1, 'raum')), ROOT)
})
