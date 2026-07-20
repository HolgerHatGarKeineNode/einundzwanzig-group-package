/**
 * Pure-Tests fuer den Raum-Fingerabdruck (welshman-app-frei).
 * Laeuft ohne neue Dependency ueber Nodes eingebauten Test-Runner + TS-Type-Stripping:
 *   node --test packages/einundzwanzig-group/js/roomFingerprint.test.ts
 *
 * Der Fingerabdruck ist der Memo-Schluessel der Raumliste (`_dataSig`/`_ensureFiltered`
 * in `bridge.ts`). Er hat GENAU zwei Pflichten, und beide sind hier verankert:
 *   1. Er MUSS sich aendern, wenn sich am Raum etwas aendert (der Rename-Fehler:
 *      umbenannter Raum blieb bis zum Reload unter altem Namen stehen).
 *   2. Er DARF sich nicht aendern, wenn sich nichts geaendert hat — sonst waere der
 *      Cache abgeschafft statt repariert.
 *
 * `bridge.ts` selbst ist hier NICHT importierbar (Alpine/@welshman beim Modul-Load);
 * getestet wird deshalb der Baustein plus die `_dataSig`-Komposition unten nachgestellt.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { roomsFingerprint, type RoomLike } from './roomFingerprint.ts'

/** Ein RoomView-artiger Raum, so wie ihn `buildSpaceView` baut. */
const room = (over: RoomLike = {}): RoomLike => ({
    h: 'abc',
    name: 'Allgemein',
    about: '',
    picture: '',
    locked: false,
    isPrivate: false,
    isClosed: false,
    isHidden: false,
    isRestricted: false,
    isMeetup: false,
    meetupId: '',
    meetupSlug: '',
    isProjectSupport: false,
    proposalId: '',
    ...over,
})

// ── Pflicht 1: Aenderungen schlagen durch ───────────────────────────────────

test('UMBENENNEN aendert den Fingerabdruck (der eigentliche Fehler)', () => {
    const before = [room({ h: 'r1', name: 'Neu-1' }), room({ h: 'r2', name: 'Dev' })]
    const after = [room({ h: 'r1', name: 'Edit-1' }), room({ h: 'r2', name: 'Dev' })]

    // Gleiche Anzahl, gleiche Raum-IDs, kein neuer Zeitstempel — genau der Fall, den
    // der alte Laengen-Schluessel nicht sah.
    assert.equal(before.length, after.length)
    assert.notEqual(roomsFingerprint(before), roomsFingerprint(after))
})

test('jedes einzelne Feld bricht den Schluessel (nicht nur der Name)', () => {
    const base = [room()]
    const changed: RoomLike[] = [
        { picture: 'https://x/y.png' },
        { about: 'neu' },
        { locked: true },
        { isPrivate: true },
        { isHidden: true },
        { isMeetup: true },
        { meetupSlug: 'wien' },
        { isProjectSupport: true },
        { proposalId: 'proposal:7' },
        // Aktivitaets-Feld der Live-Sortierung: frueher ein eigener Schluessel-Teil,
        // heute einfach ein Raum-Feld — die Sortierung nach neuester Nachricht bricht
        // den Cache also weiterhin.
        { lastMessageAt: 1730000000 },
    ]
    for (const over of changed) {
        assert.notEqual(
            roomsFingerprint(base),
            roomsFingerprint([room(over)]),
            `Feld ${Object.keys(over)[0]} schlaegt nicht durch`,
        )
    }
})

test('Anlegen/Loeschen/Umsortieren aendern den Fingerabdruck', () => {
    const one = [room({ h: 'r1' })]
    const two = [room({ h: 'r1' }), room({ h: 'r2', name: 'Zwei' })]
    const swapped = [room({ h: 'r2', name: 'Zwei' }), room({ h: 'r1' })]

    assert.notEqual(roomsFingerprint(one), roomsFingerprint(two))
    assert.notEqual(roomsFingerprint(two), roomsFingerprint(swapped))
})

test('Raum-Grenzen sind mitgefaltet (Verschieben von Text zwischen Raeumen)', () => {
    const a = [room({ h: 'ab', name: 'x' }), room({ h: 'c', name: 'y' })]
    const b = [room({ h: 'a', name: 'x' }), room({ h: 'bc', name: 'y' })]
    assert.notEqual(roomsFingerprint(a), roomsFingerprint(b))
})

test('leerer Wert und fehlender Wert sind unterscheidbar', () => {
    assert.notEqual(roomsFingerprint([room({ picture: '' })]), roomsFingerprint([room({ picture: null })]))
    assert.notEqual(roomsFingerprint([room({ picture: null })]), roomsFingerprint([room({ picture: undefined })]))
})

// ── Pflicht 2: der Cache haelt, solange nichts passiert ─────────────────────

test('gleicher Inhalt in NEUEN Objekten ⇒ gleicher Schluessel (Cache haelt)', () => {
    // Die Datenschicht baut die RoomViews bei jedem Store-Lauf frisch — der
    // Schluessel darf an Objekt-IDENTITAET nicht haengen, sonst rechnete die Liste
    // bei jedem Effect-Durchlauf neu.
    const a = [room({ h: 'r1', name: 'Allgemein' }), room({ h: 'r2', name: 'Dev' })]
    const b = [room({ h: 'r1', name: 'Allgemein' }), room({ h: 'r2', name: 'Dev' })]
    assert.equal(roomsFingerprint(a), roomsFingerprint(b))
})

test('Feld-Reihenfolge im Objekt ist keine Aenderung', () => {
    const a: RoomLike = { h: 'r1', name: 'A', locked: false }
    const b: RoomLike = { locked: false, name: 'A', h: 'r1' }
    assert.equal(roomsFingerprint([a]), roomsFingerprint([b]))
})

test('leere Liste und fehlende Liste sind stabil', () => {
    assert.equal(roomsFingerprint([]), roomsFingerprint(undefined))
    assert.equal(roomsFingerprint(null), roomsFingerprint(undefined))
})

// ── Die `_dataSig`-Komposition (nachgestellt, wie in bridge.ts) ─────────────

/** 1:1 die Zusammensetzung aus `_dataSig()` — ohne Alpine/welshman. */
const dataSig = (state: {
    roomQuery: string
    roomCountry: string
    roomType: string
    userRooms: RoomLike[]
    otherRooms: RoomLike[]
    meetups: Record<string, unknown>
}): string =>
    [
        state.roomQuery.trim().toLowerCase(),
        state.roomCountry,
        state.roomType,
        roomsFingerprint(state.userRooms),
        roomsFingerprint(state.otherRooms),
        Object.keys(state.meetups).length,
    ].join('|')

const baseState = () => ({
    roomQuery: '',
    roomCountry: '',
    roomType: 'rooms',
    userRooms: [room({ h: 'r1', name: 'Neu-1' })],
    otherRooms: [room({ h: 'r2', name: 'Dev' })],
    meetups: {},
})

test('_dataSig: Umbenennen in „Meine Raeume" bricht den Schluessel', () => {
    const before = dataSig(baseState())
    const state = baseState()
    state.userRooms = [room({ h: 'r1', name: 'Edit-1' })]
    assert.notEqual(before, dataSig(state))
})

test('_dataSig: Umbenennen in „Andere Raeume" bricht den Schluessel', () => {
    const before = dataSig(baseState())
    const state = baseState()
    state.otherRooms = [room({ h: 'r2', name: 'Dev umbenannt' })]
    assert.notEqual(before, dataSig(state))
})

test('_dataSig: Filter (Suche/Land/Modus) bleiben Teil des Schluessels', () => {
    const before = dataSig(baseState())
    for (const patch of [{ roomQuery: 'de' }, { roomCountry: 'AT' }, { roomType: 'meetups' }]) {
        assert.notEqual(before, dataSig({ ...baseState(), ...patch }))
    }
    // Nur Gross-/Kleinschreibung + Rand-Leerzeichen der Suche: derselbe Filter.
    assert.equal(dataSig({ ...baseState(), roomQuery: 'DE' }), dataSig({ ...baseState(), roomQuery: ' de ' }))
})

test('_dataSig: unveraenderte Daten ⇒ identischer Schluessel', () => {
    assert.equal(dataSig(baseState()), dataSig(baseState()))
})
