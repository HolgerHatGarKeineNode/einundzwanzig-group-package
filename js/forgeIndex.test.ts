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
 * ── Der Statusindex kam nach (Restposten P1, 2026-08-25) ───────────────────
 *
 * Hier stand, `foldStatus` scanne weiterhin je Wurzel und sei ein eigener
 * Gegenstand — mit dem Gesamtbestand als `statusEvents` kostete dasselbe
 * Fixture **8,5 / 22,5 / 83,2 ms** bei 400 / 800 / 1600 Wurzeln. Das ist
 * eingelöst: **2,1 / 3,3 / 8,2 ms**, und der Pfad wächst linear (vierfache
 * Eingabe, 3,9-facher Aufwand).
 *
 * Die Zeitmessung unten bleibt trotzdem auf dem Notizen-Pfad (`statusEvents`
 * leer). Ein Gate, das beide Achsen zugleich misst, wird rot, wenn jemand
 * irgendeine davon anfasst, und sagt dann nicht, welche — die Trennung ist der
 * Grund, warum es überhaupt etwas festhält. Für den Statusindex steht darunter
 * ein **deterministisches** Gate, und das ist ohnehin das wichtigere.
 *
 * Ausführen:
 * node --experimental-strip-types --test packages/einundzwanzig-group/js/forgeIndex.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
    FORGE_COMMENT,
    GIT_ISSUE,
    GIT_STATUS_CLOSED,
    buildIssues,
    commentsForRoot,
    foldAssignments,
    foldReviews,
    foldStatus,
    indexNotes,
    indexStatus,
    repoAddressOf,
    type ForgeEvent,
} from './forgeModels.ts'

const OWNER = '0adf67475ccc5ca456fd3022e46f5d526eb0af6284bf85494c0dd7847f3e5033'
const ADDR = repoAddressOf(OWNER, 'r')
const REVIEWER = 'e'.repeat(64)
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

/**
 * Eine Notiz, die der Index NICHT kennt — der Prüfstein für den Rückfall.
 *
 * **Der Punkt ist, dass Index und Rohliste auseinanderfallen.** Bis zum
 * 2026-08-25 stand hier eine unbekannte Wurzel gegen eine Rohliste, die zu ihr
 * ohnehin nichts enthielt: ein Scan-Rückfall lieferte dann zufällig ebenfalls
 * `[]`, und die Zusicherung war erfüllt, ohne etwas zu halten. Belegt per
 * Mutationsprobe — mit UND ohne Determinismus-Schutz blieb der Prüfstand 4/4
 * grün. Der Fehler lag in der Fixture, nicht in der Behauptung.
 */
const ausserhalbDesIndex = (rootId: string, over: Partial<ForgeEvent> = {}): ForgeEvent => ({
    id: hex(770_000),
    pubkey: OWNER,
    kind: FORGE_COMMENT,
    created_at: 4_000,
    content: 'nur in der Rohliste',
    tags: [['e', rootId, '', 'root'], ['a', ADDR]],
    ...over,
})

test('KOMPLEXITÄT (deterministisch): der Index ersetzt den Scan, er ergänzt ihn nicht', () => {
    const { notes } = bestand(3)
    const index = indexNotes(notes)
    const FREMD = hex(77)

    // 1. Der Index antwortet, obwohl die Ereignisliste LEER ist — käme die
    //    Antwort aus ihr, wäre sie es auch.
    const aus = commentsForRoot(hex(1), [], index)
    assert.equal(aus.length, 1)
    assert.equal(aus[0].id, hex(500_001))

    // 2. **Index und Rohliste fallen auseinander.** Der Index kennt `FREMD`
    //    nicht, die Rohliste sehr wohl. Mit Schutz: nichts. Ohne Schutz: der
    //    Scan findet die Notiz — und genau daran wird die Mutation sichtbar.
    const rohliste = [...notes, ausserhalbDesIndex(FREMD)]
    assert.deepEqual(commentsForRoot(FREMD, rohliste, index), [])

    // KONTROLLE: dieselbe Rohliste OHNE Index liefert die Notiz sehr wohl —
    // sonst prüfte der Fall darüber nur, dass hier grundsätzlich nichts kommt.
    assert.equal(commentsForRoot(FREMD, rohliste).length, 1)
})

/**
 * Dieselbe Frage an den beiden Faltungen, die den Index ebenfalls tragen — und
 * hier ist ein Rückfall die **stillere** Sorte Fehler: eine Zuweisung oder ein
 * Reviewer, die aus einer Quelle stammen, die der Aufrufer gar nicht indiziert
 * hat, tauchen ohne Fehlermeldung auf der Fläche auf.
 */
test('KOMPLEXITÄT (deterministisch): auch die Faltungen fallen nicht in den Scan zurück', () => {
    const FREMD = hex(78)
    const root: ForgeEvent = {
        id: FREMD, pubkey: OWNER, kind: GIT_ISSUE, created_at: 2_000, content: '',
        tags: [['a', ADDR], ['subject', 'Wurzel ausserhalb des Index']],
    }
    // Ein leerer Index: er kennt KEINE Wurzel. Die Rohliste kennt beide Notizen.
    const leererIndex = indexNotes([])
    const zuweisung = ausserhalbDesIndex(FREMD, {
        id: hex(780_001),
        tags: [['e', FREMD, '', 'root'], ['a', ADDR], ['p', OWNER], ['t', 'assignment']],
    })
    const anfrage = ausserhalbDesIndex(FREMD, {
        id: hex(780_002),
        tags: [['e', FREMD, '', 'root'], ['a', ADDR], ['p', REVIEWER], ['t', 'review-request']],
    })
    const rohliste = [zuweisung, anfrage]

    assert.deepEqual(foldAssignments(root, rohliste, [], leererIndex).assignees, [])
    assert.deepEqual(foldReviews(root, rohliste, 'a'.repeat(40), [], leererIndex).reviewers, [])

    // KONTROLLE: ohne Index findet dieselbe Rohliste beides — die Zusicherungen
    // oben messen also den Rückfall und nicht die Leere der Fixture.
    assert.deepEqual(foldAssignments(root, rohliste).assignees, [OWNER])
    assert.deepEqual(foldReviews(root, rohliste, 'a'.repeat(40)).reviewers, [REVIEWER])
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

// ── Gate 1b: derselbe Schutz für den Statusindex ────────────────────────────

/**
 * `foldStatus` trägt die Berechtigungsentscheidung dieser Fläche. Der Eingriff
 * aus dem Restposten wechselt ausschliesslich den EINGANG — Filter und
 * Sortierung sind Zeichen für Zeichen dieselben geblieben. Dass die Regel
 * unverändert gilt, belegen die bestehenden Fälle in `forgeModels.test.ts`
 * (Berechtigung, Tiebreak, Maintainer-Erweiterung); hier steht nur, dass der
 * Index den Scan wirklich ERSETZT.
 *
 * Die Fixture lässt Index und Rohliste auseinanderfallen — dieselbe Lehre wie
 * beim Notizen-Gate: eine unbekannte Wurzel gegen eine Rohliste, die zu ihr
 * nichts enthält, prüft gar nichts.
 */
test('KOMPLEXITÄT (deterministisch): auch `foldStatus` fällt nicht in den Scan zurück', () => {
    const FREMD = hex(79)
    const root: ForgeEvent = {
        id: FREMD, pubkey: OWNER, kind: GIT_ISSUE, created_at: 2_000, content: '',
        tags: [['a', ADDR], ['subject', 'Wurzel ausserhalb des Index']],
    }
    const wechsel: ForgeEvent = {
        id: hex(790_001), pubkey: OWNER, kind: GIT_STATUS_CLOSED, created_at: 5_000, content: '',
        tags: [['e', FREMD], ['a', ADDR]],
    }

    // Leerer Index: er kennt keine Wurzel. Die Rohliste kennt den Wechsel.
    assert.equal(foldStatus(root, [wechsel], [], indexStatus([])), null)

    // KONTROLLE: ohne Index findet dieselbe Rohliste ihn sehr wohl — sonst
    // prüfte die Zusicherung darüber nur die Leere der Fixture.
    assert.equal(foldStatus(root, [wechsel])?.id, wechsel.id)

    // Und mit dem passenden Index ebenfalls: der Riegel sperrt nicht alles aus.
    assert.equal(foldStatus(root, [], [], indexStatus([wechsel]))?.id, wechsel.id)
})

test('indexStatus: nimmt NUR Statuswechsel auf — eine Notiz gehört in den anderen Eimer', () => {
    const wurzel = hex(80)
    const wechsel: ForgeEvent = {
        id: hex(800_001), pubkey: OWNER, kind: GIT_STATUS_CLOSED, created_at: 5_000, content: '',
        tags: [['e', wurzel]],
    }
    const notiz: ForgeEvent = {
        id: hex(800_002), pubkey: OWNER, kind: FORGE_COMMENT, created_at: 5_000, content: 'kein Status',
        tags: [['e', wurzel]],
    }

    assert.deepEqual(indexStatus([wechsel, notiz]).get(wurzel)?.map((e) => e.id), [wechsel.id])
    assert.deepEqual(indexNotes([wechsel, notiz]).get(wurzel)?.map((e) => e.id), [notiz.id])
})

test('indexStatus: dieselben zwei Eigenschaften — entdoppelt und aufsteigend sortiert', () => {
    const wurzel = hex(81)
    const status = (id: number, created_at: number, tags: string[][]): ForgeEvent => ({
        id: hex(id), pubkey: OWNER, kind: GIT_STATUS_CLOSED, created_at, content: '', tags,
    })
    // `e` UND `E` auf dieselbe Wurzel: EIN Eintrag, sonst zählte der Wechsel
    // doppelt — beim Notizen-Index war genau das der stille Teil.
    assert.equal(indexStatus([status(810_001, 5_000, [['e', wurzel], ['E', wurzel]])]).get(wurzel)?.length, 1)

    // Gleichstand: die kleinere Id zuerst.
    const eimer = indexStatus([
        status(810_005, 5_000, [['e', wurzel]]),
        status(810_004, 5_000, [['e', wurzel]]),
        status(810_003, 1_000, [['e', wurzel]]),
    ])
    assert.deepEqual(eimer.get(wurzel)?.map((e) => e.id), [hex(810_003), hex(810_004), hex(810_005)])
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
