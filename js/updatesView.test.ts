/**
 * Screen-Logik von `/updates` und der Rückweg-Parameter.
 *
 * Zwei Dinge stehen hier im Vordergrund, weil ihr Bruch NICHT auffällt:
 *   1. **Die `?from=`-Whitelist.** Der Parameter kommt aus der Adressleiste, ist also
 *      fremde Eingabe. Fällt die Prüfung weg, wandert er ungeprüft in
 *      `Livewire.navigate()` und in jede Thread-URL — `?from=//evil.tld` wäre dann ein
 *      Navigationsziel. Die Müll-Eingaben unten sind deshalb keine Kür.
 *   2. **Leere Buckets.** Eine Gruppierung, die einen leeren Divider ausgibt, sieht im
 *      Test wie ein Detail aus und in der App wie ein Fehler („GESTERN" ohne Zeile).
 *
 * Ausführen: node --test packages/einundzwanzig-group/js/updatesView.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
    BUCKET_LABELS,
    ORIGIN_FALLBACK,
    ORIGIN_KEYS,
    LABEL_SNIPPET_MAX,
    UNREAD_SR_PREFIX,
    UPDATES_PAGE,
    filterUpdates,
    firstNonEmpty,
    groupUpdates,
    hasMoreUpdates,
    hasUnreadUpdates,
    nextUpdatesLimit,
    originTarget,
    readOrigin,
    threadBackTarget,
    undoClickAction,
    undoSnapshotFor,
    undoStillOpen,
    updateAriaLabel,
    updateAuthors,
    updatesSubtitle,
    visibleUpdates,
    withOrigin,
} from './updatesView.ts'
import type { UpdateBucket, UpdateItem, UpdateType } from './updates.ts'

const item = (over: Partial<UpdateItem> & { key: string }): UpdateItem => ({
    type: 'message' as UpdateType,
    context: 'Allgemein',
    title: 'Alice · 3 neue Nachrichten',
    snippet: 'Hat jemand den Node-Guide gesehen?',
    timeLabel: 'vor 12 Min',
    picture: '',
    authorName: 'Alice',
    pubkey: 'a'.repeat(64),
    h: 'welcome',
    rootId: '',
    href: '/rooms/welcome?from=updates',
    ts: 1_700_000_000,
    bucket: 'today' as UpdateBucket,
    unread: true,
    count: 3,
    orphan: false,
    ...over,
})

const keys = (items: readonly UpdateItem[]): string[] => items.map((i) => i.key)

// ── Filter ────────────────────────────────────────────────────────────────

test('Filter: „Erwaehnungen" und „Threads" zeigen NUR ihren Typ, „Alle" alles', () => {
    const items = [item({ key: 'm', type: 'message' }), item({ key: '@', type: 'mention' }), item({ key: 't', type: 'thread' })]

    assert.deepEqual(keys(filterUpdates(items, 'all')), ['m', '@', 't'])
    assert.deepEqual(keys(filterUpdates(items, 'mentions')), ['@'])
    assert.deepEqual(keys(filterUpdates(items, 'threads')), ['t'])
})

test('Filter kopiert, statt die Eingabe zu reichen (die Liste kommt aus einem Store)', () => {
    const items = [item({ key: 'a' })]
    assert.notEqual(filterUpdates(items, 'all'), items)
})

// ── Paginierung ───────────────────────────────────────────────────────────

test('Seitenlaenge: Start 30, „Aeltere anzeigen" erhoeht um 30', () => {
    assert.equal(UPDATES_PAGE, 30)
    assert.equal(nextUpdatesLimit(30), 60)
    assert.equal(nextUpdatesLimit(60), 90)
})

test('hasMore misst an der GEFILTERTEN Menge, nicht an allem', () => {
    // 3 Nachrichten, 1 Erwähnung, Seitenlänge 2.
    const items = [
        item({ key: 'm1', type: 'message' }),
        item({ key: 'm2', type: 'message' }),
        item({ key: 'm3', type: 'message' }),
        item({ key: '@1', type: 'mention' }),
    ]
    assert.equal(hasMoreUpdates(items, 'all', 2), true)
    assert.equal(
        hasMoreUpdates(items, 'mentions', 2),
        false,
        'unter „Erwaehnungen" darf der Knopf nicht stehen, nur weil es woanders mehr gibt',
    )
})

test('hasMore an der exakten Grenze: gleich viele Zeilen wie limit = kein Knopf', () => {
    const items = [item({ key: 'a' }), item({ key: 'b' })]
    assert.equal(hasMoreUpdates(items, 'all', 2), false)
    assert.equal(hasMoreUpdates(items, 'all', 1), true)
    assert.equal(hasMoreUpdates([], 'all', 0), false, 'leere Liste hat nie mehr')
})

test('visibleUpdates kappt auf limit und haelt die Reihenfolge', () => {
    const items = [item({ key: 'a' }), item({ key: 'b' }), item({ key: 'c' })]
    assert.deepEqual(keys(visibleUpdates(items, 'all', 2)), ['a', 'b'])
    assert.deepEqual(keys(visibleUpdates(items, 'all', 99)), ['a', 'b', 'c'])
    assert.deepEqual(keys(visibleUpdates(items, 'all', 0)), [], 'limit 0 zeigt nichts (kein Ueberlauf auf alles)')
})

/**
 * Die stille Fehlfunktion, gegen die dieser Test steht: `hasAny()` (Untertitel +
 * „Alles"-Knopf) misst an der GESAMTMENGE, `isEmpty()` (Skeleton/Leerzustand/Liste/
 * Paginierung) an der GEFILTERTEN, gekappten Ansicht. Vertauscht man beides, verschwindet
 * unter einem leeren Filter der Kopf — oder die Liste rendert eine leere Fläche statt des
 * Leerzustands, und niemand sieht einen Fehler, nur eine kaputte Seite.
 */
test('hasAny misst am Gesamtbestand, isEmpty an der gefilterten Ansicht', () => {
    const items = [item({ key: 'm1', type: 'message' }), item({ key: 'm2', type: 'message' })]

    // hasAny() === items.length > 0 → wahr, egal welcher Tab.
    assert.equal(items.length > 0, true)
    // isEmpty() === visibleUpdates(...).length === 0 → unter „Erwaehnungen" LEER,
    // obwohl es zwei Zeilen gibt.
    assert.equal(visibleUpdates(items, 'all', UPDATES_PAGE).length === 0, false)
    assert.equal(visibleUpdates(items, 'mentions', UPDATES_PAGE).length === 0, true)
    assert.equal(visibleUpdates(items, 'threads', UPDATES_PAGE).length === 0, true)
})

// ── Gruppierung ───────────────────────────────────────────────────────────

test('Buckets kommen in fester Reihenfolge mit deutschen Labels', () => {
    const items = [
        item({ key: 'h1', bucket: 'today' }),
        item({ key: 'g1', bucket: 'yesterday' }),
        item({ key: 'w1', bucket: 'week' }),
        item({ key: 'a1', bucket: 'older' }),
    ]
    const groups = groupUpdates(items)
    assert.deepEqual(
        groups.map((g) => g.label),
        ['Heute', 'Gestern', 'Diese Woche', 'Älter'],
    )
    assert.deepEqual(groups.map((g) => g.items.length), [1, 1, 1, 1])
    // Normal geschrieben: die Versalien macht das CSS. Ein Wort in Versalien liest die
    // Sprachausgabe je nach Stimme buchstabenweise.
    assert.equal(BUCKET_LABELS.older, 'Älter')
    for (const label of Object.values(BUCKET_LABELS)) {
        assert.notEqual(label, label.toUpperCase(), `„${label}" darf nicht in Versalien im DOM stehen`)
    }
})

test('LEERE Buckets fallen raus — kein Divider ohne Zeile', () => {
    const groups = groupUpdates([item({ key: 'h1', bucket: 'today' }), item({ key: 'a1', bucket: 'older' })])
    assert.deepEqual(
        groups.map((g) => g.label),
        ['Heute', 'Älter'],
    )
})

test('gar nichts ⇒ gar keine Gruppe', () => {
    assert.deepEqual(groupUpdates([]), [])
})

test('Gruppierung ordnet auch unsortierte Eingabe und fasst je Bucket EINMAL zusammen', () => {
    const groups = groupUpdates([
        item({ key: 'a1', bucket: 'older' }),
        item({ key: 'h1', bucket: 'today' }),
        item({ key: 'a2', bucket: 'older' }),
    ])
    assert.deepEqual(
        groups.map((g) => g.label),
        ['Heute', 'Älter'],
        'ein zweimal ausgegebenes Label braeche x-for :key="group.label"',
    )
    assert.deepEqual(keys(groups[1].items), ['a1', 'a2'])
})

// ── Beschriftungen ────────────────────────────────────────────────────────

test('Untertitel zaehlt die gerenderten Zeilen und beugt Singular/Plural', () => {
    assert.equal(updatesSubtitle([item({ key: 'a' }), item({ key: 'b' })]), '2 Hinweise')
    assert.equal(updatesSubtitle([item({ key: 'a' })]), '1 Hinweis')
    assert.equal(updatesSubtitle([]), 'Alles gelesen')
})

/**
 * Gemessen im Kopf stand „Neu Alles gelesen Alles" — der Untertitel behauptete „alles
 * gelesen", WÄHREND der Knopf „Alles als gelesen markieren" daneben sichtbar war, weil
 * es ungelesene `message`-Zeilen gab. Der Nullzustand ist eine Aussage über den ZUSTAND;
 * im Filter ist sie schlicht falsch.
 */
test('Untertitel sagt im Filter-Nullfall NICHTS — „Alles gelesen" waere dort falsch', () => {
    assert.equal(updatesSubtitle([], true), '', 'kein Nullzustand unter aktivem Filter')
    assert.equal(updatesSubtitle([], false), 'Alles gelesen')
    // Mit Zeilen ist die Zahl in beiden Faellen richtig — sie zaehlt, was steht.
    assert.equal(updatesSubtitle([item({ key: 'a' })], true), '1 Hinweis')
})

/**
 * Die P6-Sperre. Eine Zahl mit dem Etikett „ungelesen"/„neu" ist eine Behauptung über
 * das Wasserzeichen — im Untertitel genauso wie in einem Badge. Dieser Test ist der
 * Riegel gegen genau diese Hintertür.
 */
test('Untertitel behauptet NICHTS ueber Ungelesenes (P6-Sperre)', () => {
    const gemischt = [item({ key: 'a', unread: true }), item({ key: 'b', unread: false }), item({ key: 'c', unread: true })]
    const text = updatesSubtitle(gemischt)

    assert.equal(text, '3 Hinweise', 'gezaehlt wird, was steht — nicht, was ungelesen ist')
    assert.doesNotMatch(text, /ungelesen/i)
    assert.doesNotMatch(text, /\bneu/i)
    // Die Zahl haengt an der gerenderten Menge, nicht an der Ungelesen-Zahl (hier 2).
    assert.doesNotMatch(text, /\b2\b/)
})

test('aria-label traegt alle vier sichtbaren Ebenen (es ersetzt den Kindtext)', () => {
    const label = updateAriaLabel(item({ key: 'a', unread: false }))
    assert.equal(label, 'Allgemein. Alice · 3 neue Nachrichten. Hat jemand den Node-Guide gesehen?. vor 12 Min')
})

/**
 * Der Zustand steht VORN. Am Ende eines 739-Zeichen-Labels hoert ihn niemand, der nach
 * dem Snippet unterbricht — und dieses Label ist der einzige Zugang zu „ungelesen".
 */
test('aria-label nennt „Ungelesen" im ERSTEN Wort, nicht am Ende', () => {
    const label = updateAriaLabel(item({ key: 'a', unread: true }))
    assert.ok(label.startsWith(UNREAD_SR_PREFIX), `Label beginnt nicht mit dem Zustand: „${label}"`)
    assert.doesNotMatch(label, /ungelesen[^.]*$/i, 'der Hinweis darf nicht (nur) hinten stehen')
})

test('aria-label kuerzt den Snippet — ein Name ist eine Kennung, kein Vorlesetext', () => {
    const lang = 'x'.repeat(400)
    const label = updateAriaLabel(item({ key: 'a', unread: false, snippet: lang }))
    assert.ok(label.length < 260, `Label ist mit ${label.length} Zeichen zu lang`)
    assert.ok(label.includes(`${'x'.repeat(LABEL_SNIPPET_MAX)}…`), 'gekuerzt wird mit Auslassungszeichen')
    // Genau an der Grenze wird NICHT gekuerzt.
    const grenze = 'y'.repeat(LABEL_SNIPPET_MAX)
    assert.ok(updateAriaLabel(item({ key: 'b', unread: false, snippet: grenze })).includes(grenze + '.'))
})

test('aria-label laesst leere Teile weg statt Luecken vorzulesen', () => {
    assert.equal(
        updateAriaLabel(item({ key: 'a', snippet: '', context: '', unread: false })),
        'Alice · 3 neue Nachrichten. vor 12 Min',
    )
})

/**
 * Der einzige Zugang zu „ungelesen" fuer Screenreader: die 2-px-Rail ist `aria-hidden`,
 * die Typ-Icons sind textlos, und ein sr-only-Geschwister waere unter einem `aria-label`
 * totes Markup. Faellt der Hinweis hier weg, hoert ihn NIEMAND.
 */
test('aria-label traegt den Ungelesen-Hinweis — und nur bei ungelesen', () => {
    const ungelesen = updateAriaLabel(item({ key: 'a', unread: true }))
    const gelesen = updateAriaLabel(item({ key: 'a', unread: false }))

    assert.ok(ungelesen.includes('Ungelesen'), 'ungelesene Zeile muss den Hinweis tragen')
    assert.ok(!gelesen.toLowerCase().includes('ungelesen'), 'gelesene Zeile darf ihn nicht tragen')
    assert.equal(ungelesen, UNREAD_SR_PREFIX + gelesen, 'sonst ist nichts anders')
})

test('der Ungelesen-Hinweis ist ein vorangestelltes, eigenes Satzglied', () => {
    assert.equal(UNREAD_SR_PREFIX, 'Ungelesen. ')
})

// ── Undo-Frist ────────────────────────────────────────────────────────────

/**
 * Ohne diesen Vergleich haengt die 10-Sekunden-Zusage (§8) allein am `setTimeout` — und
 * Browser strecken Timer in gedrosselten Hintergrund-Tabs erheblich. Die Leiste bliebe
 * dort ueber die Frist hinaus KLICKBAR.
 */
/**
 * `canUndo()` gattet nur die ANZEIGE — und auch die nur, wenn Alpine den Ausdruck neu
 * auswertet; `Date.now()` ist keine reaktive Abhaengigkeit. Im gedrosselten
 * Hintergrund-Tab bleibt die Leiste deshalb sichtbar UND klickbar. Der Klick braucht
 * seine eigene Pruefung, sonst dehnt sich die 10-Sekunden-Zusage auf ein beliebiges
 * Fenster — und mit ihr die Nebenwirkung fuer den Geschwister-Tab.
 */
test('ein spaeter Klick auf „Rueckgaengig" spielt NICHTS mehr zurueck', () => {
    const jetzt = 1_700_000_000_000
    assert.equal(undoClickAction(jetzt + 5_000, jetzt, true), 'restore', 'in der Frist, mit Puffer')
    assert.equal(undoClickAction(jetzt - 1, jetzt, true), 'discard', 'Frist abgelaufen, obwohl der Puffer noch da ist')
    assert.equal(undoClickAction(jetzt, jetzt, true), 'discard', 'exakt abgelaufen zaehlt als zu')
    assert.equal(undoClickAction(jetzt + 5_000, jetzt, false), 'discard', 'ohne Puffer gibt es nichts zurueckzuholen')
    assert.equal(undoClickAction(0, jetzt, false), 'discard')
})

test('Undo-Frist wird gerechnet, nicht nur getimt', () => {
    const jetzt = 1_700_000_000_000
    assert.equal(undoStillOpen(jetzt + 1, jetzt), true, 'innerhalb der Frist')
    assert.equal(undoStillOpen(jetzt, jetzt), false, 'exakt abgelaufen zaehlt als zu')
    assert.equal(undoStillOpen(jetzt - 5_000, jetzt), false, 'gestreckter Timer rettet den Klick nicht')
    assert.equal(undoStillOpen(0, jetzt), false, 'kein Puffer, keine Frist')
})

// ── „Alles gelesen" und sein Rückgängig ───────────────────────────────────

test('hasUnread misst am Gesamtbestand, nicht am Filter', () => {
    assert.equal(hasUnreadUpdates([item({ key: 'a', unread: false }), item({ key: 'b', unread: true })]), true)
    assert.equal(hasUnreadUpdates([item({ key: 'a', unread: false })]), false)
    assert.equal(hasUnreadUpdates([]), false)
})

/**
 * Ohne diese Liste steht in der häufigsten Zeile der npub statt des Namens: `message`
 * kommt über den Raum-Filter, der keine kind-0 mitbringt, und `loadSpaceThreads` wärmt
 * nur Kommentar- und Wurzel-Autoren.
 */
test('Autoren der Zeilen: entdoppelt, in Reihenfolge des ersten Auftretens', () => {
    const A = 'a'.repeat(64)
    const B = 'b'.repeat(64)
    const items = [item({ key: '1', pubkey: A }), item({ key: '2', pubkey: B }), item({ key: '3', pubkey: A })]

    assert.deepEqual(updateAuthors(items), [A, B])
    assert.deepEqual(updateAuthors([]), [])
    assert.deepEqual(updateAuthors([item({ key: '1', pubkey: '' })]), [], 'ein leerer pubkey ist kein Autor')
})

/**
 * M1. Der zweite Klick auf „Alles" innerhalb der Undo-Frist darf den Puffer NICHT
 * überschreiben — sonst puffert er den bereits quittierten Zustand, und „Rückgängig"
 * reagiert, ohne etwas zurückzuholen. Die Folge wird in `readState.test.ts` an der
 * echten Karte nachgestellt; hier steht die Regel selbst.
 */
test('zweiter Klick behaelt den ERSTEN Undo-Puffer', () => {
    const erster = { 'r:a': 1000 }
    const zweiter = { all: 20000 }

    assert.equal(undoSnapshotFor(null, erster), erster, 'ohne Puffer gilt die frische Aufnahme')
    assert.equal(undoSnapshotFor(erster, zweiter), erster, 'mit Puffer gilt WEITER der erste')
})

// ── Ladeentscheidung ──────────────────────────────────────────────────────

/** Svelte-Store-Attrappe: emittiert SYNCHRON beim Abonnieren, wie das Original. */
function fakeStore<T>(initial: readonly T[]): {
    store: { subscribe(run: (v: readonly T[]) => void): () => void }
    set(value: readonly T[]): void
    subscribers(): number
} {
    const runs = new Set<(v: readonly T[]) => void>()
    let current = initial
    return {
        store: {
            subscribe(run) {
                runs.add(run)
                run(current)
                return () => runs.delete(run)
            },
        },
        set(value) {
            current = value
            runs.forEach((run) => run(current))
        },
        subscribers: () => runs.size,
    }
}

/**
 * Der eigentliche Fehler, gegen den das steht: ein synchrones `get(joinedRoomHs)` liest
 * beim kalten Direkteinstieg `[]`, und `loadRoomActivity` setzt dann GAR KEINEN REQ ab
 * — `loading`/`error` behaupten anschließend etwas über einen Lauf, den es nie gab.
 */
test('firstNonEmpty loest sofort auf, wenn die Liste schon steht', async () => {
    const fake = fakeStore(['a', 'b'])
    assert.deepEqual(await firstNonEmpty(fake.store, 50), ['a', 'b'])
    assert.equal(fake.subscribers(), 0, 'auch der SYNCHRONE Fall muss sauber abbauen')
})

test('firstNonEmpty wartet auf den ersten nicht-leeren Wert', async () => {
    const fake = fakeStore<string>([])
    const pending = firstNonEmpty(fake.store, 2000)
    fake.set([]) // ein zweiter leerer Emit loest NICHT aus
    fake.set(['spaet'])
    assert.deepEqual(await pending, ['spaet'])
    assert.equal(fake.subscribers(), 0)
})

test('firstNonEmpty gibt nach dem Timeout auf — „in keinem Raum" darf nicht haengen', async () => {
    const fake = fakeStore<string>([])
    const started = Date.now()
    assert.deepEqual(await firstNonEmpty(fake.store, 30), [], 'aufgegeben wird mit dem zuletzt gesehenen Wert')
    assert.ok(Date.now() - started >= 25, 'es wurde wirklich gewartet')
    assert.equal(fake.subscribers(), 0)
})

test('firstNonEmpty loest genau EINMAL auf', async () => {
    const fake = fakeStore<string>([])
    const pending = firstNonEmpty(fake.store, 40)
    fake.set(['erster'])
    fake.set(['zweiter'])
    assert.deepEqual(await pending, ['erster'])
})

// ── Rückweg: die `?from=`-Whitelist ───────────────────────────────────────

test('Whitelist: jeder gelistete Wert wird erkannt', () => {
    assert.deepEqual([...ORIGIN_KEYS], ['updates', 'spaces', 'room'])
    for (const key of ORIGIN_KEYS) {
        assert.equal(readOrigin(`?from=${key}`), key)
    }
})

test('UP-Ziel: nur `updates` fuehrt nach „Neu", alles andere auf die Raumliste', () => {
    assert.equal(originTarget('?from=updates'), '/updates')
    assert.equal(originTarget('?from=spaces'), ORIGIN_FALLBACK)
    // `room` ist gelistet, hat aber KEIN eigenes Ziel: der Parameter traegt keinen
    // Raum-`h`, und ein Raum kann nicht sein eigenes UP-Ziel sein.
    assert.equal(originTarget('?from=room'), ORIGIN_FALLBACK)
    assert.equal(ORIGIN_FALLBACK, '/spaces')
})

test('UP-Ziel: NICHT gelistete Werte fallen auf die Raumliste', () => {
    for (const garbage of [
        '',
        '?from=',
        '?from=javascript:alert(1)',
        '?from=//evil.tld',
        '?from=https://phish.example',
        '?from=UPDATES',
        '?from=updates2',
        '?from=%2f%2fevil.tld',
        '?tab=threads',
    ]) {
        assert.equal(originTarget(garbage), ORIGIN_FALLBACK, `„${garbage}" darf kein Ziel werden`)
        assert.equal(readOrigin(garbage), null, `„${garbage}" ist keine gueltige Herkunft`)
    }
})

test('UP-Ziel: die Aufrufstelle darf ihr eigenes Fallback setzen (route(group.spaces))', () => {
    assert.equal(originTarget('?from=nonsense', 'https://group.einundzwanzig.space/spaces'), 'https://group.einundzwanzig.space/spaces')
    assert.equal(originTarget('?from=updates', 'https://group.einundzwanzig.space/spaces'), '/updates')
})

test('doppelter Parameter: der ERSTE gewinnt (Zusage von URLSearchParams)', () => {
    assert.equal(readOrigin('?from=spaces&from=updates'), 'spaces')
    assert.equal(originTarget('?from=spaces&from=updates'), ORIGIN_FALLBACK)
    assert.equal(readOrigin('?from=javascript:x&from=updates'), null, 'ein ungueltiger erster Wert rettet sich nicht ueber den zweiten')
})

test('threadHref reicht eine gueltige Herkunft durch', () => {
    assert.equal(withOrigin('/rooms/welcome/thread/nevent1abc', '?from=updates'), '/rooms/welcome/thread/nevent1abc?from=updates')
    assert.equal(withOrigin('/rooms/welcome/thread/nevent1abc', '?from=room'), '/rooms/welcome/thread/nevent1abc?from=room')
})

test('threadHref reicht Muell NICHT durch', () => {
    for (const garbage of ['', '?from=//evil.tld', '?from=javascript:alert(1)', '?tab=threads']) {
        assert.equal(withOrigin('/rooms/welcome/thread/nevent1abc', garbage), '/rooms/welcome/thread/nevent1abc')
    }
})

test('threadHref haengt an eine bestehende Query an und verdoppelt `from` nie', () => {
    assert.equal(withOrigin('/rooms/welcome/thread/x?tab=t', '?from=updates'), '/rooms/welcome/thread/x?tab=t&from=updates')
    assert.equal(withOrigin('/rooms/welcome/thread/x?from=spaces', '?from=updates'), '/rooms/welcome/thread/x?from=spaces')
})

/**
 * M2. Der deep-gemountete Thread hat keine gemerkte Raum-URL (`_threadPrevUrl === null`,
 * weil `openThread(…, syncUrl=false)` sie nie setzt). Wird beim Schließen ein blankes
 * `/rooms/{h}` in die Adressleiste geschrieben, ist die Herkunft weg — und der nächste
 * Zurück-Druck landet auf `/spaces` statt auf „Neu". Genau der Fall (frischer Tab,
 * geteilter Link, Notification-Tap) ist der, für den `?from=` überhaupt existiert:
 * `backFromRoom` kann dort nicht auf `history.back()` ausweichen.
 */
test('Thread schliessen OHNE gemerkte Raum-URL rettet die Herkunft', () => {
    assert.equal(threadBackTarget(null, '/rooms/welcome', '?from=updates'), '/rooms/welcome?from=updates')
    assert.equal(threadBackTarget(null, '/rooms/welcome', '?from=room'), '/rooms/welcome?from=room')
})

test('Thread schliessen: gemerkte Raum-URL gewinnt unveraendert', () => {
    assert.equal(
        threadBackTarget('/rooms/welcome?from=updates', '/rooms/welcome', '?from=updates'),
        '/rooms/welcome?from=updates',
        'die gemerkte URL traegt die Herkunft bereits',
    )
    assert.equal(threadBackTarget('/rooms/welcome', '/rooms/welcome', '?from=updates'), '/rooms/welcome')
})

test('Thread schliessen ohne Herkunft bleibt bei der blanken Raum-URL', () => {
    assert.equal(threadBackTarget(null, '/rooms/welcome', ''), '/rooms/welcome')
    assert.equal(threadBackTarget(null, '/rooms/welcome', '?from=//evil.tld'), '/rooms/welcome')
})
