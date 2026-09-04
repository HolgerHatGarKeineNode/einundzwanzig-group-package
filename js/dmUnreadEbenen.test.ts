/**
 * P7d — **drei Ebenen, drei Zahlen: die Tab-Pille „Räume" zählt keine Unterhaltungen mehr.**
 *
 * Run: node --test --experimental-strip-types packages/einundzwanzig-group/js/dmUnreadEbenen.test.ts
 *
 * ── Was schiefging ───────────────────────────────────────────────────────────────
 *
 * `computeUnread` ist kategorieblind — es summiert über ALLE gezählten `h`, und seit P7
 * stehen die Unterhaltungen darunter. Am Store hängt diese Summe aber an der Tab-Pille
 * „Räume", also an einer EBENE. Solange die Unterhaltungen nur in der Rail standen, fiel
 * das niemandem auf; seit sie ein eigener Abschnitt sind, ist es eine Aussage über eine
 * Ebene, die aus einer anderen gerechnet wird.
 *
 * ── Was hier gemessen wird ───────────────────────────────────────────────────────
 *
 * Die ECHTEN Funktionen aus `bridge.ts` (`plainRoomHsOf`, `countedDmHsOf`,
 * `unreadTotalsOf` — genau die, die `wireUnread` in seiner Subscription ruft) gegen das
 * ECHTE `computeUnread`. Nichts hier baut die Aufteilung nach.
 *
 * **Die Anwesenheits-Zusicherung ist die Hälfte, die zählt.** „`roomsTotal` wurde
 * kleiner" ist auch wahr, wenn die Zahl kaputt ist. Jeder Abwesenheitsfall unten hat
 * deshalb seinen Gegenfall: ein ungelesener RAUM erhöht `roomsTotal`, eine ungelesene
 * UNTERHALTUNG erhöht `dmsTotal`, und beide erhöhen die Gesamtzahl und `any`.
 *
 * Der `localStorage`-Doppel steht vor dem ersten Import: `groups.ts` bindet
 * `activeSpaceUrl` beim Modul-Eval an den Speicher, und `bridge.ts` zieht es herein.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { liesDatei, ruftAuf } from './workspaceQuelleGate.ts'

const gespeichert = new Map<string, string>()
;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string): string | null => gespeichert.get(k) ?? null,
    setItem: (k: string, v: string): void => void gespeichert.set(k, v),
    removeItem: (k: string): void => void gespeichert.delete(k),
}

const { countedDmHsOf, countedRoomHsOf, plainRoomHsOf, unreadTotalsOf } = await import('./bridge.ts')
const { computeUnread } = await import('./unread.ts')
const { roomKey } = await import('./readState.ts')
type SpaceView = import('./groups.ts').SpaceView
type ReadState = import('./readState.ts').ReadState

const URL_ = 'wss://relay.example/'
const ME = 'a'.repeat(64)
const ALICE = 'b'.repeat(64)
const NOW = Math.floor(new Date(2026, 6, 23, 12, 0, 0).getTime() / 1000)

const H_RAUM = 'allgemein'
const H_DM = '3f1c5b6a-9d2e-4c7b-8a10-6e5d4c3b2a19'

/** Nur die drei Felder, die `plainRoomHsOf`/`countedDmHsOf` lesen. */
const view = {
    url: URL_,
    userRooms: [{ h: H_RAUM, name: 'Allgemein', isDm: false, dmParticipants: [] }],
    dmRooms: [{ h: H_DM, name: 'DM', isDm: true, dmParticipants: [ME, ALICE] }],
} as unknown as SpaceView

const nachricht = (id: string, h: string) =>
    ({ id, kind: 9, created_at: NOW - 60, pubkey: ALICE, tags: [['h', h]], content: 'moin', sig: '' }) as never

const state = { [roomKey(URL_, H_RAUM)]: NOW - 3600, [roomKey(URL_, H_DM)]: NOW - 3600 } as ReadState

/** Genau der Weg, den `wireUnread` geht: zählen, dann nach Ebene aufteilen. */
const totalsFor = (events: unknown[]) => {
    const counted = { all: countedRoomHsOf(view, []), rooms: plainRoomHsOf(view), dms: countedDmHsOf(view, []) }
    const unread = computeUnread({
        url: URL_,
        joined: counted.all,
        events: events as never[],
        comments: [],
        state,
        me: ME,
    })

    return { ...unreadTotalsOf(unread, counted), any: unread.any, roh: unread.roomsTotal }
}

// ══ Die eine Zahl, um die es geht ════════════════════════════════════════════════

test('ABWESENHEIT: eine ungelesene Unterhaltung erhöht `roomsTotal` NICHT', () => {
    const t = totalsFor([nachricht('m1', H_DM)])

    assert.equal(t.roomsTotal, 0, 'die Tab-Pille „Räume" darf keine Unterhaltung zählen')
})

test('ANWESENHEIT: dieselbe Nachricht erhöht `dmsTotal` und die Gesamtzahl', () => {
    // Ohne diesen Fall prüft der Fall darüber nur, dass eine Zahl kleiner wurde.
    const t = totalsFor([nachricht('m1', H_DM)])

    assert.equal(t.dmsTotal, 1, 'gezählt wird sie — nur eine Ebene tiefer')
    assert.equal(t.roomsTotal + t.dmsTotal, t.roh, 'zusammen sind sie exakt das, was computeUnread liefert')
    assert.equal(t.any, true, 'der Punkt der Bottom-Nav muss weiter leuchten')
})

test('ANWESENHEIT: ein ungelesener RAUM erhöht `roomsTotal` — und `dmsTotal` nicht', () => {
    const t = totalsFor([nachricht('m2', H_RAUM)])

    assert.equal(t.roomsTotal, 1)
    assert.equal(t.dmsTotal, 0)
    assert.equal(t.any, true)
})

test('beide zusammen: jede Ebene zählt ihr eigenes, nichts doppelt, nichts verloren', () => {
    const t = totalsFor([nachricht('m1', H_DM), nachricht('m2', H_RAUM)])

    assert.equal(t.roomsTotal, 1)
    assert.equal(t.dmsTotal, 1)
    assert.equal(t.roomsTotal + t.dmsTotal, t.roh, 'die Aufteilung ist eine PARTITION, keine zweite Zählung')
    assert.equal(t.roh, 2)
})

test('KALIBRIERUNG: die beiden Listen überschneiden sich nicht und decken alles ab', () => {
    // Die Eigenschaft, auf der die Partition ruht. Fiele sie, wäre `roomsTotal + dmsTotal`
    // still zu gross (Überschneidung) oder zu klein (Lücke) — beides ohne Ausnahme.
    const rooms = plainRoomHsOf(view)
    const dms = countedDmHsOf(view, [])
    assert.deepEqual(rooms, [H_RAUM])
    assert.deepEqual(dms, [H_DM])
    assert.equal(
        rooms.some((h) => dms.includes(h)),
        false,
        'überschnitten sich die Listen, zählte `sumUnreadRooms` dieselbe Nachricht zweimal',
    )
    assert.deepEqual([...rooms, ...dms].sort(), countedRoomHsOf(view, []).sort(), 'zusammen ergeben sie `all`')
})

test('VERDRAHTUNG: `wireUnread` rechnet die drei Zahlen wirklich über `unreadTotalsOf`', () => {
    // Ohne diesen Riegel wäre alles oben grün, während die Subscription weiter
    // `store.roomsTotal = $view.roomsTotal` zuwiese — die reine Funktion prüft ihren
    // eigenen Rumpf, nicht dass jemand sie ruft.
    const quelle = liesDatei(join(import.meta.dirname, 'bridge.ts'), 'bridge.ts')
    assert.equal(ruftAuf(quelle, 'unreadTotalsOf'), true, 'die Aufteilung ist definiert, aber nicht verdrahtet')
    assert.equal(ruftAuf(quelle, 'plainRoomHsOf'), true)
    assert.equal(ruftAuf(quelle, 'countedDmHsOf'), true)
    // Kalibrierung: fail-closed, ein `false` gilt auch für eine Datei, die nie gelesen wurde.
    assert.ok(quelle.aufrufe.length > 100, 'der Scanner sieht bridge.ts überhaupt')
})

test('eine AUSGEBLENDETE Unterhaltung zählt in keiner der beiden Zahlen', () => {
    // Die Schnittmenge mit P7c: ausgeblendet fällt schon aus `counted.all`, also gibt es
    // gar keinen Schlüssel in der `rooms`-Karte, den eine der Summen lesen könnte.
    const counted = { all: countedRoomHsOf(view, [H_DM]), rooms: plainRoomHsOf(view), dms: countedDmHsOf(view, [H_DM]) }
    const unread = computeUnread({
        url: URL_,
        joined: counted.all,
        events: [nachricht('m1', H_DM)] as never[],
        comments: [],
        state,
        me: ME,
    })
    const t = unreadTotalsOf(unread, counted)

    assert.equal(t.roomsTotal, 0)
    assert.equal(t.dmsTotal, 0)
    assert.equal(unread.any, false, 'auch der Punkt bleibt aus — das ist die Zusage aus P7c')
})
