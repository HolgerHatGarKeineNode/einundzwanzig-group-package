/**
 * **Was auf dem Bildschirm steht, muss sich aufsummieren lassen** — die zwei Ebenen des
 * Räume-Tabs gegen die Zahlen, die über ihnen stehen.
 *
 * Run: node --test --experimental-strip-types packages/einundzwanzig-group/js/dmUnreadFlaechen.test.ts
 *
 * ── Die Zusage, und warum sie einen eigenen Fall braucht ─────────────────────────
 *
 * `js/unread.ts` formuliert die Falle wörtlich: *„die Summe der sichtbaren Pillen ergäbe
 * nicht die Zahl am Tab"*. `dmUnreadEbenen.test.ts` prüft, dass die Aufteilung eine
 * PARTITION ist — `roomsTotal + dmsTotal === view.roomsTotal`. Das ist die Rechnung.
 *
 * Diese Datei prüft die andere Hälfte, und ohne sie ist die erste wertlos: dass die
 * beiden Summen über GENAU DIE ZEILEN laufen, die die jeweilige Fläche rendert. Eine
 * korrekte Partition über die falschen Mengen ergibt zwei Zahlen, die stimmen, und zwei
 * Flächen, unter denen sie nicht aufgehen.
 *
 * Die Mengen sind ausdrücklich VERSCHIEDEN gefaltet, und das ist der Anlass:
 *
 *   · `dmsTotal` faltet `countedDmHsOf(view, hidden)` — nur den HEIM-Space.
 *   · Der Abschnitt rendert `$store.dms.conversations`, also
 *     `foldDmRooms([heim, workspace], hidden)` — er zeigt AUCH Workspace-Unterhaltungen.
 *
 * Eine Workspace-Zeile steht damit in der Liste, aber in keiner Zählmenge. Dass die
 * Summe trotzdem aufgeht, hängt an einer zweiten Eigenschaft: `computeUnread` sät
 * `rooms[h]` nur für die gezählten `h`, ein Workspace-`h` hat also gar keinen Schlüssel,
 * und `unread-badge` rendert bei `undefined` per `x-if` NICHTS. Unsichtbare Pille,
 * Beitrag 0. Genau dieser Fall steht unten drin — er ist der einzige, der die Aussage
 * kippen könnte, und deshalb der wichtigste.
 *
 * ── Was diese Datei NICHT beweist ────────────────────────────────────────────────
 *
 * Sie rendert kein Blade. Die Brücke zwischen Modell und Fläche sind die zwei Riegel am
 * Ende: sie lesen die Ausdrücke aus dem Markup, mit entfernten Kommentaren. Ohne die
 * beschriebe diese Datei ein Modell, das niemand rendert.
 *
 * ── Mutationsprobe (2026-09-04) ──────────────────────────────────────────────────
 *
 * Gegen `unreadTotalsOf` in `bridge.ts` gefahren, ohne die Datei zu ändern — jede
 * Mutation wurde einzeln eingespielt, gemessen und zurückgenommen:
 *
 *   · `dmsTotal` aus `counted.all` statt `counted.dms` falten  → Fall 2, 4, Kontrolle rot
 *   · `roomsTotal` aus `counted.all` falten                    → Fall 1, 4, Kontrolle rot
 *   · den Ausgeblendet-Filter aus `countedDmHsOf` entfernen    → Fall 3 rot
 *   · im Blade `dmsTotal` durch `roomsTotal` ersetzen          → Riegel 1 rot
 *   · im Blade die Zeilen-Pille auf `threads` umhängen         → Riegel 1 rot
 *
 * **Eine Mutation hat hier ÜBERLEBT, und sie ist inzwischen anderswo geschlossen:**
 * `rooms` und `dms` in `countedHs` (`bridge.ts`) zu vertauschen liess alle acht Fälle
 * dieser Datei grün — 18 von 19 beider DM-Suiten. Der Grund ist eine Grenze dieser
 * Datei, keine Nachlässigkeit: sie baut ihr `counted` selbst aus `plainRoomHsOf`/
 * `countedDmHsOf`, den beiden exportierten Faltungen. Geprüft ist damit, dass die
 * richtigen Faltungen das Richtige tun und dass die Flächen die richtigen Zahlen
 * lesen; NICHT die Verdrahtung dazwischen.
 *
 * Die trägt seit `94dc1ed` `js/dmUnreadEbenen.test.ts`: das Objektliteral ist als
 * `countedHsOf(view, dismissed)` herausgezogen, in der Ableitung steht eine Delegation
 * ohne Feldnamen, und ein Fall behauptet beide Hälften namentlich. **Diese Datei
 * bewacht die Flächen, jene die Zuordnung — wer hier etwas ändert, prüft dort mit.**
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { foldDmRooms } from './dmModels.ts'
import { plainRoomHsOf, countedDmHsOf, unreadTotalsOf, type CountedHs } from './bridge.ts'
import type { UnreadView } from './unread.ts'
import type { SpaceView } from './groups.ts'

// ══ Die Lage: zwei Räume, drei Unterhaltungen, eine davon ausgeblendet ═══════════

const raum = (h: string) => ({ h, name: h }) as never
const dm = (h: string) => ({ h, name: 'DM', isDm: true, dmParticipants: [] }) as never

/** Der Heim-Space: zwei eigene Räume, drei Unterhaltungen. */
const heim = {
    url: 'wss://heim.test/',
    userRooms: [raum('r1'), raum('r2')],
    otherRooms: [],
    dmRooms: [dm('d1'), dm('d2'), dm('weg')],
} as unknown as SpaceView

/** Der Workspace: eine Unterhaltung, die die Fläche zeigt und niemand zählt. */
const workspace = {
    url: 'wss://workspace.test/',
    userRooms: [],
    otherRooms: [],
    dmRooms: [dm('w1')],
} as unknown as SpaceView

const AUSGEBLENDET = ['weg']

const counted: CountedHs = (() => {
    const rooms = plainRoomHsOf(heim)
    const dms = countedDmHsOf(heim, AUSGEBLENDET)

    return { all: [...rooms, ...dms], rooms, dms }
})()

/**
 * Die `rooms`-Karte, so wie `computeUnread` sie baut: EIN Schlüssel je gezähltem `h`,
 * und keiner für alles andere. Die Zahlen sind frei gewählt und absichtlich verschieden,
 * damit keine zwei Summen zufällig gleich sind.
 */
const view: UnreadView = {
    rooms: { r1: 3, r2: 5, d1: 7, d2: 11, weg: 0 },
    threads: {},
    any: true,
    roomsTotal: 26,
    threadsTotal: 2,
}

/** Was der Abschnitt WIRKLICH rendert — dieselbe Faltung wie `$store.dms.conversations`. */
const zeilenImAbschnitt = foldDmRooms([heim, workspace], AUSGEBLENDET)

/** Die Pille an einer Zeile: `$store.unread?.rooms?.[room.h]`, fehlend ⇒ kein Knoten. */
const pille = (h: string): number => view.rooms[h] ?? 0

const totals = unreadTotalsOf(view, counted)

// ══ Die vier Fälle ═══════════════════════════════════════════════════════════════

test('1 — die Tab-Pille „Räume" ist die Summe der Pillen an den Raum-Zeilen', () => {
    const sichtbar = plainRoomHsOf(heim).reduce((sum, h) => sum + pille(h), 0)

    assert.equal(sichtbar, 8, 'Vorbedingung: 3 + 5, sonst misst der Fall die falsche Menge')
    assert.equal(totals.roomsTotal, sichtbar, 'die Zahl am Tab zählt etwas anderes als die Zeilen darunter')
})

test('2 — der Badge am Abschnitt ist die Summe der Pillen an den Unterhaltungs-Zeilen', () => {
    const sichtbar = zeilenImAbschnitt.reduce((sum, room) => sum + pille(room.h), 0)

    assert.equal(sichtbar, 18, 'Vorbedingung: 7 + 11, die Workspace-Zeile trägt 0')
    assert.equal(totals.dmsTotal, sichtbar, 'der Badge zählt etwas anderes als die Zeilen darunter')
})

test('3 — eine ausgeblendete Unterhaltung ist weder Zeile noch Zahl', () => {
    // Der Fall, der die Faltung von einer blossen Aufzählung unterscheidet: `weg` steht
    // im `dmRooms` des Space und in der `rooms`-Karte, aber der Nutzer hat sie mit 41012
    // weggelegt. Stünde sie in einer der beiden Mengen, wäre die Aussage falsch — und
    // zwar in verschiedene Richtungen, deshalb beide Prüfungen.
    assert.equal(zeilenImAbschnitt.some((room) => room.h === 'weg'), false, 'sie darf keine Zeile bekommen')
    assert.equal(counted.dms.includes('weg'), false, 'und in keiner Zählmenge stehen')
})

test('4 — die WORKSPACE-Zeile steht in der Liste, trägt keine Pille und verschiebt keine Summe', () => {
    // Der einzige Fall, der die Zusage kippen könnte: die Fläche zeigt mehr Zeilen als
    // die Zahl zählt. Er geht nur auf, weil `computeUnread` für ein ungezähltes `h`
    // keinen Schlüssel sät und `unread-badge` bei `undefined` gar nicht rendert.
    assert.equal(zeilenImAbschnitt.some((room) => room.h === 'w1'), true, 'die Zeile ist da')
    assert.equal(counted.dms.includes('w1'), false, 'gezählt wird sie nicht')
    assert.equal(view.rooms.w1, undefined, 'und genau deshalb hat sie keine Pille')

    // Und die Klammer um alles: die drei Ebenen sind zusammen der ganze Bestand.
    assert.equal(totals.roomsTotal + totals.dmsTotal, view.roomsTotal, 'die Aufteilung ist keine Partition mehr')
})

test('CONTROL: die Zahlen sind verschieden — der Fall kann überhaupt scheitern', () => {
    // Ohne diesen Fall wären 1 und 2 auch dann grün, wenn beide Summen zufällig dieselbe
    // Zahl trügen (z. B. weil beide über `counted.all` liefen und 26 lieferten).
    assert.notEqual(totals.roomsTotal, totals.dmsTotal)
    assert.notEqual(totals.roomsTotal, view.roomsTotal)
    assert.notEqual(totals.dmsTotal, view.roomsTotal)
})

// ══ Die Brücke zum Markup — sonst beschreibt alles oben ein Modell ohne Fläche ════

const VIEWS = join(import.meta.dirname, '..', 'resources', 'views', 'components')

/**
 * Eine Blade-Datei ohne ihre Kommentare.
 *
 * Nicht Zierrat: `dm-list.blade.php` ERKLÄRT die Trennung der beiden Zahlen in Prosa und
 * nennt `roomsTotal` und `dmsTotal` dort mehrfach. Eine rohe Textsuche fände also ihre
 * eigene Begründung. Der Kontrollfall unten beweist, dass gestrippt wird.
 */
const ohneKommentare = (datei: string): string =>
    readFileSync(join(VIEWS, datei), 'utf8').replace(/\{\{--[\s\S]*?--\}\}/g, '')

test('RIEGEL: der Abschnitts-Badge liest `dmsTotal`, die Zeile ihre eigene Raum-Zahl', () => {
    const markup = ohneKommentare('dm-list.blade.php')

    assert.ok(markup.includes('count="$store.unread?.dmsTotal"'), 'der Kopf trägt keinen dmsTotal-Badge')
    assert.ok(
        markup.includes('count="$store.unread?.rooms?.[room.h]"'),
        'die Zeile liest nicht die Karte, über die dmsTotal gefaltet wird',
    )
    // Die Abwesenheits-Zusage daneben: die Ebene darf die Zahl der anderen nicht zeigen.
    assert.equal(markup.includes('roomsTotal'), false, 'der Abschnitt zeigt die Zahl der Raum-Ebene')
})

test('RIEGEL: die Tab-Pille „Räume" liest `roomsTotal`, und nur sie', () => {
    const seite = readFileSync(join(VIEWS, '..', '⚡spaces.blade.php'), 'utf8').replace(/\{\{--[\s\S]*?--\}\}/g, '')

    assert.ok(seite.includes('count="$store.unread?.roomsTotal"'), 'der Räume-Tab trägt seine Zahl nicht mehr')
    assert.equal(seite.includes('dmsTotal'), false, 'die Seite zeigt die DM-Zahl ein zweites Mal')
})

test('CONTROL: der Kommentar-Entferner entfernt wirklich', () => {
    const roh = readFileSync(join(VIEWS, 'dm-list.blade.php'), 'utf8')

    // Gegen ein Wort geprüft, das AUSSCHLIESSLICH in der Prosa vorkommen kann — nicht
    // gegen `roomsTotal`: das steht dort ebenfalls in der Prosa, könnte aber durch eine
    // Regression auch im MARKUP landen, und dann meldete dieser Fall „der Entferner ist
    // kaputt", während in Wahrheit der Riegel daneben zu Recht rot wird. Ein
    // Kontrollfall, der bei einem echten Befund mitfällt, macht die Ursache unlesbar.
    assert.ok(roh.includes('{{--'), 'Vorbedingung: die Datei trägt Blade-Kommentare')
    assert.ok(roh.includes('kategorieblind'), 'Vorbedingung: das Wort steht in der Prosa')
    assert.equal(
        ohneKommentare('dm-list.blade.php').includes('kategorieblind'),
        false,
        'nach dem Strippen darf keine Prosa mehr übrig sein, die den Riegel füttert',
    )
})
