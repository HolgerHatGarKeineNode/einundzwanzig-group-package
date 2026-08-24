/**
 * P7 — **der Komplexitäts-Prüfstand**. Er hält die Grenze fest, damit sie nicht
 * unbemerkt zurückwächst.
 *
 * ── Warum es ihn braucht ────────────────────────────────────────────────────
 *
 * Bis P7 lief jede Wurzel über den gesamten Notizen-Bestand, viermal. Gemessen
 * am 2026-08-24 bei 1600 Wurzeln je Kind: **2146 ms**, Faktor ~4,2 je
 * Verdopplung — quadratisch. Mit dem Index: **534 ms**. Eine Zahl in einem
 * Bericht hält das nicht; ein Prüfstand tut es.
 *
 * ── Zwei Gates, und das erste ist das wichtigere ────────────────────────────
 *
 * 1. **Strukturell und DETERMINISTISCH:** wird der Index überhaupt benutzt?
 *    `commentsForRoot(id, [], index)` liefert die Notizen aus dem Eimer, obwohl
 *    die Ereignisliste LEER ist. Wer die Durchreichung entfernt, bekommt hier
 *    `[]` — ohne Uhr, ohne Toleranz, ohne Flatterrisiko.
 * 2. **Zeitlich, mit weiter Schranke:** wächst die Arbeit noch quadratisch?
 *    Bei achtfacher Eingabe wäre quadratisch ~64×, linear ~8×. Die Schranke
 *    liegt bei 16× — weit genug für eine belastete Maschine, eng genug, um eine
 *    Rückkehr zum Quadrat zu fangen. **Das ist eine Aussage über die GESTALT
 *    der Kurve, keine Laufzeit-Zusage.**
 *
 * ── Was hier bewusst NICHT gemessen wird ────────────────────────────────────
 *
 * Der Notizen-Pfad, isoliert (`statusEvents` leer). `foldStatus` scannt seine
 * Ereignisliste weiterhin je Wurzel und ist damit die verbliebene quadratische
 * Achse — gemessen am 2026-08-24: mit dem Gesamtbestand als `statusEvents`
 * kostet dasselbe Fixture 8,5 / 22,5 / 83,2 ms bei 400 / 800 / 1600. Das ist
 * ein eigener Gegenstand und gehört nicht in einen Prüfstand für den Index:
 * er würde dann rot, wenn jemand `foldStatus` anfasst, und grün bleiben, wenn
 * jemand den Index herausnimmt. Genau verkehrt herum.
 *
 * Ausführen:
 * node --experimental-strip-types --test packages/einundzwanzig-group/js/forgeIndex.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
    FORGE_COMMENT,
    GIT_ISSUE,
    buildIssues,
    commentsForRoot,
    indexNotes,
    repoAddressOf,
    type ForgeEvent,
} from './forgeModels.ts'

const OWNER = '0adf67475ccc5ca456fd3022e46f5d526eb0af6284bf85494c0dd7847f3e5033'
const ADDR = repoAddressOf(OWNER, 'r')
const hex = (n: number): string => String(n).padStart(64, '0')

const bestand = (n: number): { roots: ForgeEvent[]; notes: ForgeEvent[] } => {
    const roots: ForgeEvent[] = []
    const notes: ForgeEvent[] = []
    for (let i = 0; i < n; i++) {
        roots.push({ id: hex(i), pubkey: OWNER, kind: GIT_ISSUE, created_at: 2_000 + i, content: 'x', tags: [['a', ADDR], ['subject', `I${i}`]] })
        notes.push({ id: hex(500_000 + i), pubkey: OWNER, kind: FORGE_COMMENT, created_at: 3_000 + i, content: 'c', tags: [['e', hex(i), '', 'root'], ['a', ADDR]] })
    }

    return { roots, notes }
}

// ── Gate 1: wird der Index überhaupt benutzt? ───────────────────────────────

test('KOMPLEXITÄT (deterministisch): der Index ersetzt den Scan, er ergänzt ihn nicht', () => {
    const { notes } = bestand(3)
    const index = indexNotes(notes)

    // Die Ereignisliste ist LEER — käme die Antwort aus ihr, wäre sie es auch.
    const aus = commentsForRoot(hex(1), [], index)
    assert.equal(aus.length, 1)
    assert.equal(aus[0].id, hex(500_001))

    // Und eine unbekannte Wurzel liefert nichts, statt in den Scan zurückzufallen:
    // ein Rückfall wäre bei grossem Bestand genau die Arbeit, die P7 abschafft.
    assert.deepEqual(commentsForRoot('unbekannt', notes, index), [])
})

test('indexNotes: EIN Eintrag je Notiz und Wurzel, auch bei `e` UND `E` auf dieselbe', () => {
    const doppelt: ForgeEvent = {
        id: hex(1), pubkey: OWNER, kind: FORGE_COMMENT, created_at: 3_000, content: 'einmal',
        tags: [['e', hex(9), '', 'root'], ['E', hex(9)], ['a', ADDR]],
    }
    // Ohne Entdopplung stünde die Notiz zweimal im Eimer — im Kommentarzähler
    // sichtbar, in der Zuweisungskette still.
    assert.equal(indexNotes([doppelt]).get(hex(9))?.length, 1)

    // Zwei verschiedene Wurzeln: die Notiz gehört in BEIDE Eimer (P1/F5).
    const zweiWurzeln: ForgeEvent = { ...doppelt, tags: [['e', hex(9)], ['e', hex(8)], ['a', ADDR]] }
    const index = indexNotes([zweiWurzeln])
    assert.equal(index.get(hex(9))?.length, 1)
    assert.equal(index.get(hex(8))?.length, 1)
})

test('indexNotes: die Eimer sind aufsteigend sortiert — die `prior`-Kette hängt daran', () => {
    const spaet: ForgeEvent = { id: hex(2), pubkey: OWNER, kind: FORGE_COMMENT, created_at: 9_000, content: '', tags: [['e', hex(0)]] }
    const frueh: ForgeEvent = { id: hex(3), pubkey: OWNER, kind: FORGE_COMMENT, created_at: 1_000, content: '', tags: [['e', hex(0)]] }
    // Gleichstand: die KLEINERE Id zuerst, wie in `sortEvents`.
    const gleichA: ForgeEvent = { id: hex(5), pubkey: OWNER, kind: FORGE_COMMENT, created_at: 5_000, content: '', tags: [['e', hex(0)]] }
    const gleichB: ForgeEvent = { id: hex(4), pubkey: OWNER, kind: FORGE_COMMENT, created_at: 5_000, content: '', tags: [['e', hex(0)]] }

    assert.deepEqual(
        indexNotes([spaet, gleichA, frueh, gleichB]).get(hex(0))?.map((e) => e.id),
        [hex(3), hex(4), hex(5), hex(2)],
    )
})

// ── Gate 2: die Gestalt der Kurve ───────────────────────────────────────────

/**
 * Beide Grössen **verschränkt** messen, dann je das Minimum.
 *
 * Hier stand zuerst „erst fünfmal klein, dann fünfmal gross". Das ist unter Last
 * die falsche Bauform, und der Vollauf hat es prompt gezeigt (rot bei Faktor
 * > 16, während der Einzellauf 5 lieferte): trifft eine langsame Phase — GC,
 * ein paralleler Prozess — nur die zweite Hälfte, geht sie ungedämpft in den
 * Quotienten. Verschränkt trifft dieselbe Phase beide Grössen, und das Minimum
 * über mehrere Runden nimmt heraus, was nur einmal störte.
 *
 * Das ist keine Toleranzaufweichung: die Schranke bleibt weit unter dem
 * Quadrat. Es ist die Messung, die repariert wurde, nicht die Zusage.
 */
const messeVerschraenkt = (klein: number, gross: number, runden = 5): { klein: number; gross: number } => {
    const a = bestand(klein)
    const b = bestand(gross)
    const best = { klein: Infinity, gross: Infinity }
    for (let i = 0; i < runden; i++) {
        let t = performance.now()
        const kleineIssues = buildIssues(a.roots, [], a.notes)
        best.klein = Math.min(best.klein, performance.now() - t)

        t = performance.now()
        const grosseIssues = buildIssues(b.roots, [], b.notes)
        best.gross = Math.min(best.gross, performance.now() - t)

        // Kalibrierung IN der Messung: eine Runde, die nichts baut, misst nichts.
        assert.equal(kleineIssues.length, klein)
        assert.equal(grosseIssues.length, gross)
    }

    return best
}

test('KOMPLEXITÄT (zeitlich): achtfache Eingabe kostet nicht das Vielfache eines Quadrats', () => {
    const { klein, gross } = messeVerschraenkt(400, 3_200)

    // Untergrenze als Kalibrierung: ist die kleine Messung 0, ist der Quotient
    // bedeutungslos und der Test grün, ohne etwas zu prüfen.
    assert.ok(klein > 0, 'die Basismessung war nicht messbar — der Quotient sagt dann nichts')

    const faktor = gross / klein
    // linear ≈ 8, quadratisch ≈ 64. 20 ist weit genug für eine belastete
    // Maschine und eng genug, um die Rückkehr zum Quadrat zu fangen — die
    // Mutationsprobe „Index entfernt" landete bei weit darüber.
    assert.ok(faktor < 20, `achtfache Eingabe kostete das ${faktor.toFixed(1)}-fache — das riecht nach O(m·n)`)
})
