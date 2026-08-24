import assert from 'node:assert/strict'
import test from 'node:test'
import {
    AKTIVITAETS_FENSTER,
    DEFAULT_SCOPE,
    DEFAULT_SORTIERUNG,
    aktivitaetJeRepo,
    balkenLohnt,
    filtereVorgaenge,
    leseScope,
    leseSortierung,
    repoRegung,
    sortiereRepos,
    sortiereVorgaenge,
} from './forgeFilter.ts'

// ── Whitelists ──────────────────────────────────────────────────────────────

test('unbekannte Werte fallen auf den Standard, bekannte kommen durch', () => {
    assert.equal(leseSortierung('name'), 'name')
    assert.equal(leseSortierung('alt'), 'alt')
    assert.equal(leseSortierung('projects'), DEFAULT_SORTIERUNG)
    assert.equal(leseSortierung(undefined), DEFAULT_SORTIERUNG)
    assert.equal(leseSortierung(null), DEFAULT_SORTIERUNG)
    assert.equal(leseScope('zugewiesen'), 'zugewiesen')
    assert.equal(leseScope('reviewer'), DEFAULT_SCOPE)
})

test('`toString` allein reicht nicht — ein Objekt ist kein Wert der Whitelist', () => {
    assert.equal(leseSortierung({ toString: () => 'name' }), 'name')
    assert.equal(leseSortierung({}), DEFAULT_SORTIERUNG)
})

// ── Repos ───────────────────────────────────────────────────────────────────

const repo = (address: string, name: string, createdAt: number, lastActivityAt?: number) => ({
    address,
    name,
    createdAt,
    lastActivityAt,
})

test('Regung: die Aktivität schlägt die Ankündigung, 0 zählt als „keine"', () => {
    assert.equal(repoRegung(repo('a', 'A', 100, 500)), 500)
    assert.equal(repoRegung(repo('a', 'A', 100, 0)), 100)
    assert.equal(repoRegung(repo('a', 'A', 100)), 100)
})

test('sortiereRepos verändert die EINGABE nicht', () => {
    const bestand = [repo('b', 'B', 2), repo('a', 'A', 1)]
    const vorher = bestand.map((r) => r.address).join(',')
    sortiereRepos(bestand, 'name')
    assert.equal(bestand.map((r) => r.address).join(','), vorher, 'die Liste wurde in-place sortiert')
})

test('„aktiv" stellt die jüngste Regung nach vorn, „alt" kehrt es um', () => {
    const bestand = [repo('a', 'A', 10, 100), repo('b', 'B', 20, 300), repo('c', 'C', 30, 200)]
    assert.deepEqual(sortiereRepos(bestand, 'aktiv').map((r) => r.address), ['b', 'c', 'a'])
    assert.deepEqual(sortiereRepos(bestand, 'alt').map((r) => r.address), ['a', 'c', 'b'])
})

test('„name" sortiert menschlich: Ärger steht bei A, nicht hinter Zulu', () => {
    const bestand = [repo('z', 'Zulu', 1), repo('ae', 'Ärger', 1), repo('b', 'Bravo', 1)]
    assert.deepEqual(sortiereRepos(bestand, 'name').map((r) => r.name), ['Ärger', 'Bravo', 'Zulu'])
})

test('STABILITÄT: bei gleicher Regung entscheidet die Adresse, nicht der Zufall', () => {
    // Drei Repos mit exakt derselben Regung. Ohne Tiebreak wäre die Reihenfolge
    // implementierungsabhängig — und die Liste spränge zwischen zwei
    // Renderdurchläufen, ohne dass sich etwas geändert hätte.
    const bestand = [repo('c', 'X', 5, 999), repo('a', 'X', 5, 999), repo('b', 'X', 5, 999)]
    assert.deepEqual(sortiereRepos(bestand, 'aktiv').map((r) => r.address), ['a', 'b', 'c'])
    assert.deepEqual(sortiereRepos([...bestand].reverse(), 'aktiv').map((r) => r.address), ['a', 'b', 'c'])
})

// ── Vorgänge ────────────────────────────────────────────────────────────────

const ICH = 'aa'.repeat(32)
const DU = 'bb'.repeat(32)

const vorgang = (id: string, title: string, author: string, assignees: string[], updatedAt: number) => ({
    id,
    title,
    author,
    assignees,
    updatedAt,
})

test('Scope „alle" lässt alles durch — dieselbe Liste, nicht nur dieselbe Länge', () => {
    const items = [vorgang('1', 'A', ICH, [], 1), vorgang('2', 'B', DU, [ICH], 2)]
    assert.deepEqual(filtereVorgaenge(items, 'alle', ICH), items)
})

test('„von mir" trifft den VERFASSER, „mir zugewiesen" die Zuweisung — und sie sind verschieden', () => {
    const meins = vorgang('1', 'Von mir', ICH, [], 1)
    const zugewiesen = vorgang('2', 'Mir zugewiesen', DU, [ICH], 2)
    const fremd = vorgang('3', 'Fremd', DU, [DU], 3)
    const items = [meins, zugewiesen, fremd]
    assert.deepEqual(filtereVorgaenge(items, 'von-mir', ICH).map((i) => i.id), ['1'])
    assert.deepEqual(filtereVorgaenge(items, 'zugewiesen', ICH).map((i) => i.id), ['2'])
})

test('Grossschreibung trennt nicht: hex ist case-insensitiv, und es gibt EINE Meinung dazu', () => {
    // Genau die Klasse, an der P5/F1 hing: Builder schrieb klein, Faltung
    // verglich byteweise. Hier ist beides dieselbe Zeile.
    const items = [vorgang('1', 'A', ICH.toUpperCase(), [ICH.toUpperCase()], 1)]
    assert.equal(filtereVorgaenge(items, 'von-mir', ICH).length, 1)
    assert.equal(filtereVorgaenge(items, 'zugewiesen', ICH).length, 1)
    assert.equal(filtereVorgaenge(items, 'von-mir', ICH.toUpperCase()).length, 1)
})

test('OHNE angemeldeten Schlüssel filtert nichts — fail-open, nicht Leerzustand', () => {
    const items = [vorgang('1', 'A', ICH, [], 1), vorgang('2', 'B', DU, [DU], 2)]
    assert.equal(filtereVorgaenge(items, 'von-mir', '').length, 2)
    assert.equal(filtereVorgaenge(items, 'zugewiesen', '').length, 2)
})

test('ein Vorgang ohne `assignees` wirft nicht — er trifft nur nicht', () => {
    const kaputt = { id: '1', title: 'A', author: DU, updatedAt: 1 } as unknown as ReturnType<typeof vorgang>
    assert.equal(filtereVorgaenge([kaputt], 'zugewiesen', ICH).length, 0)
})

test('sortiereVorgaenge: neueste zuerst, Titel menschlich, Tiebreak über die Id', () => {
    const items = [vorgang('c', 'Beta', DU, [], 5), vorgang('a', 'Alpha', DU, [], 9), vorgang('b', 'Alpha', DU, [], 5)]
    assert.deepEqual(sortiereVorgaenge(items, 'aktiv').map((i) => i.id), ['a', 'b', 'c'])
    assert.deepEqual(sortiereVorgaenge(items, 'alt').map((i) => i.id), ['b', 'c', 'a'])
    assert.deepEqual(sortiereVorgaenge(items, 'name').map((i) => i.id), ['a', 'b', 'c'])
})

// ── Aktivitätsbalken ────────────────────────────────────────────────────────

const JETZT = 1_800_000_000
const TAG = 24 * 60 * 60

test('das Fenster sind dreissig Tage, und es schneidet wirklich', () => {
    assert.equal(AKTIVITAETS_FENSTER, 30 * TAG)
    const karte = aktivitaetJeRepo(
        [
            { repoAddress: 'a', createdAt: JETZT - 1 * TAG },
            { repoAddress: 'a', createdAt: JETZT - 29 * TAG },
            { repoAddress: 'a', createdAt: JETZT - 31 * TAG },
        ],
        JETZT,
    )
    assert.equal(karte.get('a')?.anzahl, 2, 'das 31 Tage alte Ereignis zählt mit')
})

test('die letzte Regung kennt das Fenster NICHT — sie ist die jüngste überhaupt', () => {
    const karte = aktivitaetJeRepo([{ repoAddress: 'a', createdAt: JETZT - 400 * TAG }], JETZT)
    assert.equal(karte.get('a')?.anzahl, 0, 'ausserhalb des Fensters zählt es nicht')
    assert.equal(karte.get('a')?.letzteRegung, JETZT - 400 * TAG, 'als Regung gilt es sehr wohl')
})

test('normalisiert wird auf das AKTIVSTE Repo, nicht auf die Summe', () => {
    const karte = aktivitaetJeRepo(
        [
            ...Array.from({ length: 8 }, () => ({ repoAddress: 'a', createdAt: JETZT - TAG })),
            ...Array.from({ length: 2 }, () => ({ repoAddress: 'b', createdAt: JETZT - TAG })),
        ],
        JETZT,
    )
    assert.equal(karte.get('a')?.anteil, 1)
    assert.equal(karte.get('b')?.anteil, 0.25, '2 von 8, nicht 2 von 10')
})

test('ein Ereignis in der ZUKUNFT zählt mit und verschiebt das Fenster nicht', () => {
    const karte = aktivitaetJeRepo(
        [
            { repoAddress: 'a', createdAt: JETZT + 5 * TAG },
            { repoAddress: 'a', createdAt: JETZT - 31 * TAG },
        ],
        JETZT,
    )
    assert.equal(karte.get('a')?.anzahl, 1)
    assert.equal(karte.get('a')?.letzteRegung, JETZT + 5 * TAG)
})

test('ein Ereignis ohne Repo-Adresse fällt heraus, statt eine namenlose Gruppe zu bilden', () => {
    const karte = aktivitaetJeRepo([{ repoAddress: '', createdAt: JETZT }], JETZT)
    assert.equal(karte.size, 0)
})

test('KEIN Balken bei genau einem aktiven Repo — er wäre immer voll', () => {
    const eins = aktivitaetJeRepo([{ repoAddress: 'a', createdAt: JETZT }], JETZT)
    assert.equal(balkenLohnt(eins), false)

    // Ein zweites Repo, das NUR ausserhalb des Fensters etwas erlebt hat, macht
    // den Balken noch nicht sinnvoll: im Fenster ist weiterhin genau eines aktiv.
    const einsPlusLeiche = aktivitaetJeRepo(
        [{ repoAddress: 'a', createdAt: JETZT }, { repoAddress: 'b', createdAt: JETZT - 90 * TAG }],
        JETZT,
    )
    assert.equal(balkenLohnt(einsPlusLeiche), false)

    const zwei = aktivitaetJeRepo(
        [{ repoAddress: 'a', createdAt: JETZT }, { repoAddress: 'b', createdAt: JETZT - TAG }],
        JETZT,
    )
    assert.equal(balkenLohnt(zwei), true)
})

test('ein leerer Bestand ergibt eine leere Karte und keinen Balken', () => {
    const karte = aktivitaetJeRepo([], JETZT)
    assert.equal(karte.size, 0)
    assert.equal(balkenLohnt(karte), false)
})
