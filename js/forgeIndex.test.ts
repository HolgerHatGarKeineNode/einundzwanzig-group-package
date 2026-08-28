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
 * 2. **Die Gestalt der Kurve, ebenfalls deterministisch:** wächst die Arbeit
 *    noch quadratisch? Gemessen wird nicht mehr die Zeit, sondern die **Zahl der
 *    Zugriffe auf die Eingabe** — auf zwei Achsen getrennt (Notizen und Wurzeln),
 *    weil eine Regression auf der einen den Zähler der anderen kalt lässt. Bei
 *    achtfacher Eingabe ist linear exakt 8×, quadratisch ~64×. Warum seit dem
 *    2026-08-28 nicht mehr mit der Uhr gemessen wird, warum es seit dem
 *    2026-08-29 ZWEI Zähler sind und **was sie zusammen nicht decken**, steht bei
 *    {@link ZULAESSIGER_FAKTOR}. **Das ist eine Aussage über die GESTALT der
 *    Kurve, keine Laufzeit-Zusage.**
 *
 * ── Der Statusindex kam nach (Restposten P1, 2026-08-25) ───────────────────
 *
 * Hier stand, `foldStatus` scanne weiterhin je Wurzel und sei ein eigener
 * Gegenstand — mit dem Gesamtbestand als `statusEvents` kostete dasselbe
 * Fixture **8,5 / 22,5 / 83,2 ms** bei 400 / 800 / 1600 Wurzeln. Das ist
 * eingelöst: **2,1 / 3,3 / 8,2 ms**, und der Pfad wächst linear (vierfache
 * Eingabe, 3,9-facher Aufwand).
 *
 * Die Kurvenmessung unten bleibt trotzdem auf dem Notizen-Pfad (`statusEvents`
 * leer). Ein Gate, das beide Achsen zugleich misst, wird rot, wenn jemand
 * irgendeine davon anfasst, und sagt dann nicht, welche — die Trennung ist der
 * Grund, warum es überhaupt etwas festhält. Für den Statusindex steht darunter
 * ein **deterministisches** Gate, und das ist ohnehin das wichtigere.
 *
 * ── Und der Update-Index kam danach (P4, 2026-08-25) ───────────────────────
 *
 * Der Statusindex legte die dritte Achse frei: `buildPullRequests` blieb als
 * einziger überlinearer Konstruktor stehen, weil {@link toPullRequest} die
 * 1619-Updates weiter je Wurzel über den Gesamtbestand siebte — **25,8 / 87,3
 * / 287,4 ms** bei 400 / 800 / 1600 Wurzeln, Faktor ~3,4 je Verdopplung, neben
 * linearen Issues und Patches. Mit {@link indexUpdates}: **3,5 / 7,5 / 13,9
 * ms**, vierfache Eingabe bei vierfachem Aufwand.
 *
 * **Der Anteil war verdeckt, nicht abwesend** — solange `foldStatus` denselben
 * Scan fuhr, ging er in dessen Zahl unter. Das ist der Grund, warum diese
 * Datei ihre Zahlen mitschreibt: sonst sähe die nächste Achse aus wie ein
 * Regress, statt wie das, was sie ist.
 *
 * Ausführen:
 * node --experimental-strip-types --test packages/einundzwanzig-group/js/forgeIndex.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
    FORGE_COMMENT,
    GIT_ISSUE,
    GIT_PR_UPDATE,
    GIT_PULL_REQUEST,
    GIT_STATUS_CLOSED,
    buildIssues,
    commentsForRoot,
    foldAssignments,
    foldReviews,
    foldStatus,
    indexNotes,
    indexStatus,
    indexUpdates,
    repoAddressOf,
    toIssue,
    toPullRequest,
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
 * **Gezählte Arbeit statt Wanduhr** (2026-08-28, P2 des welshman-Sprungs).
 *
 * Hier stand bis heute eine Zeitmessung: zwei Grössen verschränkt, je das
 * Minimum aus fünf Runden, Schranke 20. Sie war schon zweimal repariert worden
 * und flatterte weiter — im Vollauf 3 von 6 Läufen rot, auf einem unangetasteten
 * Vorgängerstand 1 von 6. Der Fehler liegt nicht in der Schranke: **Wanduhrzeit
 * in einem parallelen Test-Runner ist kein Messinstrument.** Ein Nachbarprozess,
 * eine GC-Pause oder ein Frequenzwechsel geht ungedämpft in den Quotienten, und
 * kein Minimum über fünf Runden nimmt das heraus, wenn die Last die ganze Datei
 * überdeckt.
 *
 * Die **Zusage bleibt Wort für Wort dieselbe** — wächst die Arbeit noch
 * quadratisch? —, nur wird sie jetzt an der Arbeit selbst gemessen: die Eingabe
 * zählt mit, wie oft an ihr gearbeitet wird. Das hängt an keiner Uhr.
 *
 * Gemessen am 2026-08-28, exakt reproduzierbar — `tags`-Lesungen über alle Notizen:
 *
 * | Notizen | mit Index | ohne Index |
 * |---|---|---|
 * | 400 | 1 200 | 480 800 |
 * | 800 | 2 400 | 1 921 600 |
 * | 1 600 | 4 800 | 7 683 200 |
 * | 3 200 | 9 600 | 30 726 400 |
 *
 * Mit Index exakt `3n`; achtfache Eingabe kostet damit **exakt** das Achtfache.
 * Ohne Index: Faktor 63,8 — die Signatur des Quadrats.
 *
 * **Warum die Schranke trotzdem nicht bei 9 liegt:** der Quotient `f(8n)/f(n)`
 * ist für JEDE lineare Funktion exakt 8, unabhängig von ihrer Konstanten — ein
 * zusätzlicher linearer Durchlauf bewegt ihn also nicht. Was ihn bewegt, ist ein
 * überlinearer Anteil: ein globales Sortieren (`n·log n`) landet bei
 * 8 · log(3200)/log(400) ≈ 11,1. Die Schranke **16** lässt das durch und hat zum
 * Quadrat immer noch Faktor 4 Luft. Sie ist ein Urteil über die GESTALT der
 * Kurve, keine Laufzeit-Zusage — und sie ist deterministisch, braucht also
 * keinen Zuschlag für eine belastete Maschine.
 *
 * ── ZWEI Achsen, und wo ihre gemeinsame Grenze liegt (2026-08-29) ──────────
 *
 * **Anlass:** Der Prüfer des P2-Gates hat nicht nur gelesen, sondern die Grenze
 * des ersten Zählers gemessen — eine echte quadratische Regression in
 * `buildIssues`, die `note.tags` nie anfasst (`n²`-Schleife über die WURZELN,
 * ~10,2 Mio. Vergleiche bei 3 200). Der Notizen-Zähler blieb grün. Seitdem stehen
 * hier zwei Zähler, und diese Zeilen halten fest, was sie zusammen decken.
 *
 * **Gedeckt:**
 * - Rückfall in `O(Wurzeln × Notizen)` — jede Wiederholung, die eine Notiz
 *   mehrfach anfasst, gleich über welchen Aufrufweg (`arbeit().notizen`).
 * - Rückfall in `O(Wurzeln²)` — jede Schleife über die Wurzeln innerhalb einer
 *   Schleife über die Wurzeln, gleich welches Feld sie liest (`arbeit().wurzeln`,
 *   Proxy über ALLE Felder statt über ein ausgewähltes).
 *
 * **NICHT gedeckt — und das ist eine Grenze, keine Nachlässigkeit:**
 * - Arbeit, die **weder eine Notiz noch eine Wurzel berührt**: eine quadratische
 *   Schleife über die ERZEUGTEN `Issue`-Objekte, über Kommentar-Objekte oder rein
 *   rechnende Schleifen ohne Feldzugriff. Beide Zähler sitzen an der EINGABE.
 * - Die **Status-Achse**: die Messung fährt bewusst mit leerem `statusEvents`
 *   (Begründung oben im Modulkopf — ein Gate, das zwei Achsen zugleich misst,
 *   sagt im Fehlerfall nicht, welche). Für sie stehen die deterministischen
 *   Gates, nicht diese Kurvenmessung.
 * - Die **anderen Konstruktoren**: gemessen wird `buildIssues`.
 *   `buildPullRequests` hängt an denselben Eimern und an den deterministischen
 *   Gates weiter unten, aber nicht an dieser Kurve.
 * - **Konstantenwachstum.** Der Quotient ist gegen jede lineare Konstante blind:
 *   wer je Wurzel statt 18 nun 180 Zugriffe braucht, macht den Client dreimal
 *   langsamer und diesen Prüfstand nicht rot. Das ist der Preis dafür, eine
 *   Aussage über die GESTALT zu treffen statt über die Laufzeit.
 *
 * Wer hier eine dritte Achse ergänzt, ergänzt einen dritten Zähler — er baut
 * keine Achse in eine bestehende Zusage hinein.
 */
const ZULAESSIGER_FAKTOR = 16

/** Gezählte Arbeit eines Laufs, getrennt nach den beiden Achsen der Eingabe. */
type Arbeit = {
    /** Lesezugriffe auf `tags` ÜBER ALLE NOTIZEN — die Achse, die der Index bedient. */
    notizen: number
    /** Property-Zugriffe ÜBER ALLE WURZELN, gleich welches Feld — die zweite Achse. */
    wurzeln: number
}

/**
 * Wie {@link bestand}, aber die Eingabe zählt mit, wie oft an ihr gearbeitet wird.
 *
 * Beide Zähler sitzen am **Datum**, nicht am Code — es ist deshalb egal, über
 * welchen Weg der Konstruktor an ein Element kommt, und keine Produktionszeile
 * wird dafür angefasst.
 *
 * - **Notizen:** ein Getter auf `tags`. Das ist die Operation, die der Index
 *   einspart — ohne ihn liest `referencesRoot` jede Notiz je Wurzel, mit ihm
 *   liest `indexByRoot` sie einmal.
 * - **Wurzeln:** ein `Proxy` mit `get`-Falle, der **jedes** Feld zählt, nicht ein
 *   ausgewähltes. Auf dieser Achse gibt es keine einzelne verräterische Operation
 *   wie `tags` bei den Notizen; was zählt, ist schlicht, **wie oft der Konstruktor
 *   eine Wurzel überhaupt anfasst**. Ein Zähler auf nur einem Feld wäre an einer
 *   Regression vorbeigelaufen, die ein anderes liest — genau die Klasse Lücke, die
 *   diesen Zähler nötig gemacht hat. Der Proxy kostet nichts Nennenswertes:
 *   57 600 Zugriffe bei n = 3 200 in 22 ms.
 */
const zaehlbestand = (n: number): { roots: ForgeEvent[]; notes: ForgeEvent[]; arbeit: () => Arbeit } => {
    let notizen = 0
    let wurzeln = 0
    const roots: ForgeEvent[] = []
    const notes: ForgeEvent[] = []
    for (let i = 0; i < n; i++) {
        const wurzel: ForgeEvent = { id: hex(i), pubkey: OWNER, kind: GIT_ISSUE, created_at: 2_000 + i, content: 'x', tags: [['a', ADDR], ['subject', `I${i}`]] }
        roots.push(
            new Proxy(wurzel, {
                get(ziel, feld, empfaenger) {
                    // Symbole zählen nicht mit: sie stammen aus Sprach-Protokollen
                    // (`Symbol.toPrimitive`, Iteration) und nicht aus der Arbeit am Datum.
                    if (typeof feld === 'string') {
                        wurzeln++
                    }

                    return Reflect.get(ziel, feld, empfaenger)
                },
            }),
        )
        const tags = [['e', hex(i), '', 'root'], ['a', ADDR]]
        notes.push({
            id: hex(500_000 + i),
            pubkey: OWNER,
            kind: FORGE_COMMENT,
            created_at: 3_000 + i,
            content: 'c',
            get tags(): string[][] {
                notizen++

                return tags
            },
        })
    }

    return { roots, notes, arbeit: () => ({ notizen, wurzeln }) }
}

/** Beide Zähler für einen vollständigen `buildIssues`-Lauf über `n` Wurzeln und `n` Notizen. */
const arbeitMitIndex = (n: number): Arbeit => {
    const { roots, notes, arbeit } = zaehlbestand(n)
    const issues = buildIssues(roots, [], notes)
    // Kalibrierung IN der Messung: ein Lauf, der nichts baut, misst nichts.
    assert.equal(issues.length, n)
    assert.ok(arbeit().notizen > 0, 'kein einziger Notiz-Zugriff gezählt — der Zähler sitzt an der falschen Stelle')
    assert.ok(arbeit().wurzeln > 0, 'kein einziger Wurzel-Zugriff gezählt — der Proxy greift nicht')

    return arbeit()
}

/**
 * Dieselbe Arbeit, aber index-frei — der Zustand VOR P7, aus denselben
 * Produktionsfunktionen gebaut, ohne eine Zeile zu mutieren. `toIssue` nimmt den
 * Index als optionalen Parameter; lässt man ihn weg, fällt `notesForRoot` auf den
 * Scan über die ganze Notizliste zurück (`forgeModels.ts:1401`).
 */
const arbeitOhneIndex = (n: number): number => {
    const { roots, notes, arbeit } = zaehlbestand(n)
    const issues = roots.map((root) => toIssue(root, [], notes))
    assert.equal(issues.length, n)

    return arbeit().notizen
}

test('KOMPLEXITÄT (gezählt, Notizen-Achse): achtfache Eingabe kostet nicht das Vielfache eines Quadrats', () => {
    const klein = arbeitMitIndex(400).notizen
    const gross = arbeitMitIndex(3_200).notizen

    const faktor = gross / klein
    assert.ok(
        faktor < ZULAESSIGER_FAKTOR,
        `achtfache Eingabe kostete das ${faktor.toFixed(1)}-fache an Notiz-Zugriffen (${klein} → ${gross}) — das riecht nach O(m·n). ` +
            'linear = exakt 8, n·log n ≈ 11,1, quadratisch ≈ 64.',
    )
})

/**
 * **Die zweite Achse — und warum sie eine EIGENE Zusage braucht.**
 *
 * Anlass ist eine Messung des Prüfers am P2-Gate (2026-08-29): er baute eine
 * echte quadratische Regression in `buildIssues`, die `note.tags` **nicht**
 * anfasst — eine `n²`-Schleife über die Wurzeln, rund 10,2 Mio. Vergleiche bei
 * 3 200 Wurzeln. Der Fall darüber blieb **grün**. Er ist eine Zusage über die
 * Notizen-Achse, nicht über Quadratik überhaupt, und die alte Wanduhrmessung
 * hätte diese Entgleisung gesehen. Der Tausch war trotzdem richtig — ein Melder,
 * der ohne jede Regression 3 von 6 Läufen feuert, kann keine zuordnen —, aber er
 * hat eine Lücke hinterlassen, und die wird hier geschlossen, nicht bloss notiert.
 *
 * **Gemessen wird `arbeit().wurzeln`: jeder Property-Zugriff auf eine Wurzel.**
 * Heute sind das **exakt 18 je Wurzel** und über alle vier Grössen konstant
 * (7 200 / 14 400 / 28 800 / 57 600 bei 400 / 800 / 1 600 / 3 200), verteilt auf
 * `tags` 6, `id` 5, `pubkey` 3, `created_at` 2, `kind` 1, `content` 1.
 *
 * **Die Schranke ist dieselbe 16, und aus demselben Grund** — nicht aus Bequemlichkeit:
 * die Wurzel-Achse wächst heute streng linear, `f(8n)/f(n)` ist damit exakt 8,
 * unabhängig davon, ob je Wurzel 18 oder 25 Zugriffe anfallen. Ein `n·log n`-Anteil
 * (etwa ein zusätzliches Sortieren der Wurzeln) landet bei 8 · log(3 200)/log(400)
 * ≈ 11,1 und darf durch; quadratisch landet bei ~64 und darf nicht. Zwischen 11,1
 * und 64 ist 16 die gleiche Wahl wie auf der anderen Achse — Faktor 4 Luft zum
 * Quadrat, und deterministisch, also ohne Zuschlag für eine belastete Maschine.
 */
test('KOMPLEXITÄT (gezählt, Wurzel-Achse): auch die Arbeit AN DEN WURZELN wächst nicht quadratisch', () => {
    const klein = arbeitMitIndex(400).wurzeln
    const gross = arbeitMitIndex(3_200).wurzeln

    const faktor = gross / klein
    assert.ok(
        faktor < ZULAESSIGER_FAKTOR,
        `achtfache Eingabe kostete das ${faktor.toFixed(1)}-fache an Wurzel-Zugriffen (${klein} → ${gross}) — ` +
            'irgendwo läuft eine Schleife über die Wurzeln INNERHALB einer Schleife über die Wurzeln. ' +
            'linear = exakt 8, n·log n ≈ 11,1, quadratisch ≈ 64. Die Notizen-Achse daneben sieht so etwas NICHT.',
    )
})

/**
 * **Die Positivkontrolle, dauerhaft in der Suite.**
 *
 * Ein Prüfstand für „nicht quadratisch" ist wertlos, solange niemand gezeigt hat,
 * dass er ein Quadrat auch sieht. Der Fall oben liefe grün, wenn der Zähler
 * hinge, wenn `buildIssues` nichts mehr baute oder wenn die Fixture keine
 * Notizen mehr trüge. Dieser Fall schliesst das aus — und zwar mit demselben
 * Ausdruck, an dem der Fall oben hängt.
 *
 * Kleinere Grössen als oben (200 → 1 600, ebenfalls achtfach): der Quotient
 * hängt nicht an der absoluten Grösse, 1 600² gezählte Zugriffe kosten aber
 * schon 0,2 s.
 */
test('KALIBRIERUNG: derselbe Massstab schlägt bei der index-freien Variante an', () => {
    const klein = arbeitOhneIndex(200)
    const gross = arbeitOhneIndex(1_600)
    const faktor = gross / klein

    assert.ok(
        faktor >= ZULAESSIGER_FAKTOR,
        `Die index-freie Variante kam auf Faktor ${faktor.toFixed(1)} (${klein} → ${gross}) und wäre damit durch die ` +
            `Schranke ${ZULAESSIGER_FAKTOR} gerutscht. Dann misst der Prüfstand oben nichts mehr — gemessen waren es 63,8.`,
    )
    // Und die Gegenprobe zur Behauptung „derselbe Massstab": die index-freie
    // Variante muss auch absolut sehr viel mehr Arbeit leisten als die indizierte.
    assert.ok(gross > arbeitMitIndex(1_600).notizen * 100, 'ohne Index wird kaum mehr gearbeitet als mit — dann misst der Zähler nicht die Ersparnis')
})

/**
 * **Die Positivkontrolle für den WURZEL-Zähler — und ihre ehrliche Grenze.**
 *
 * Für die Notizen-Achse liess sich die überlineare Variante aus den
 * Produktionsfunktionen selbst bauen (`toIssue` ohne Index). Auf der Wurzel-Achse
 * gibt es kein solches Gegenstück — es gab dort nie einen quadratischen Zustand,
 * den man wieder herstellen könnte. Diese Kontrolle prüft deshalb ausdrücklich
 * **nur das Messinstrument**: sieht der Proxy-Zähler eine `n²`-Schleife über die
 * Wurzeln, wenn es sie gibt? Sie ist keine Aussage über `buildIssues`.
 *
 * Nachgebaut ist genau die Regression des Prüfers: jede Wurzel gegen jede,
 * verglichen über `id` — **ohne** eine einzige Notiz anzufassen. Die zweite
 * Zusicherung hält fest, dass der Notizen-Zähler dabei stillbleibt: das ist die
 * gemessene Lücke, und sie steht hier als Fall, nicht nur als Satz im Kommentar.
 */
test('KALIBRIERUNG: der Wurzel-Zähler sieht eine n²-Schleife über die Wurzeln, der Notiz-Zähler nicht', () => {
    const quadratischUeberWurzeln = (n: number): Arbeit => {
        const { roots, notes, arbeit } = zaehlbestand(n)
        let treffer = 0
        for (const a of roots) {
            for (const b of roots) {
                if (a.id === b.id) {
                    treffer++
                }
            }
        }
        // Wirkungskontrolle: eine Schleife, die nicht läuft, misst nichts.
        assert.equal(treffer, n)
        assert.equal(notes.length, n)

        return arbeit()
    }

    const klein = quadratischUeberWurzeln(200)
    const gross = quadratischUeberWurzeln(1_600)
    const faktor = gross.wurzeln / klein.wurzeln

    assert.ok(
        faktor >= ZULAESSIGER_FAKTOR,
        `Die n²-Schleife über die Wurzeln kam auf Faktor ${faktor.toFixed(1)} (${klein.wurzeln} → ${gross.wurzeln}) und ` +
            `wäre durch die Schranke ${ZULAESSIGER_FAKTOR} gerutscht — dann misst der Wurzel-Prüfstand oben nichts.`,
    )
    // Und die Aussage über die LÜCKE: derselbe Vorgang lässt den Notiz-Zähler kalt.
    // Genau daran ist die Regression des Prüfers vorbeigelaufen.
    assert.equal(gross.notizen, 0, 'die Wurzel-Schleife hat Notizen angefasst — dann belegt dieser Fall die Lücke nicht')
})

// ── Gate 1c: derselbe Schutz für den Update-Index ───────────────────────────

/**
 * Die 1619-Updates sind der dritte Eimer — und ein Rückfall ist hier NICHT nur
 * eine Frage der Laufzeit.
 *
 * Ein Update zeigt den Commit um, auf den ein PR verweist, und `foldReviews`
 * entwertet daran jede Freigabe. Ein Update, das aus einer Quelle stammt, die
 * der Aufrufer nie indiziert hat, verschiebt also still eine
 * Berechtigungsentscheidung — sichtbar nur daran, dass eine Freigabe
 * verschwindet, die eben noch stand.
 *
 * Fixture nach derselben Lehre wie oben: Index und Rohliste fallen
 * auseinander, und jede Zusicherung trägt ihre Gegenprobe.
 */
test('KOMPLEXITÄT (deterministisch): auch `toPullRequest` fällt nicht in den Scan zurück', () => {
    const FREMD = hex(81)
    const ROOT_COMMIT = 'a'.repeat(40)
    const NEUER_COMMIT = 'b'.repeat(40)
    const root: ForgeEvent = {
        id: FREMD, pubkey: OWNER, kind: GIT_PULL_REQUEST, created_at: 2_000, content: '',
        tags: [['a', ADDR], ['subject', 'PR ausserhalb des Index'], ['c', ROOT_COMMIT]],
    }
    const update: ForgeEvent = {
        id: hex(810_001), pubkey: OWNER, kind: GIT_PR_UPDATE, created_at: 6_000, content: '',
        tags: [['e', FREMD, '', 'root'], ['a', ADDR], ['c', NEUER_COMMIT]],
    }

    // Leerer Index: er kennt keine Wurzel. Die Rohliste kennt das Update.
    const ohneEimer = toPullRequest(root, [update], [], [], [], { updates: indexUpdates([]) })
    assert.equal(ohneEimer.updateCount, 0)
    // Und damit zeigt der PR weiter auf seinen Ausgangs-Commit — die Zahl oben
    // allein liesse offen, ob nur der Zähler oder die Faltung betroffen ist.
    assert.equal(ohneEimer.commit, ROOT_COMMIT)

    // KONTROLLE: ohne Index sieht dieselbe Rohliste das Update sehr wohl —
    // sonst prüften die Zusicherungen darüber nur die Leere der Fixture.
    const ohneIndex = toPullRequest(root, [update])
    assert.equal(ohneIndex.updateCount, 1)
    assert.equal(ohneIndex.commit, NEUER_COMMIT)

    // Und mit dem passenden Eimer ebenfalls: der Riegel sperrt nicht alles aus.
    const mitEimer = toPullRequest(root, [], [], [], [], { updates: indexUpdates([update]) })
    assert.equal(mitEimer.updateCount, 1)
    assert.equal(mitEimer.commit, NEUER_COMMIT)
})

test('indexUpdates: nimmt NUR 1619 auf — Status und Notiz gehören in andere Eimer', () => {
    const wurzel = hex(82)
    const update: ForgeEvent = {
        id: hex(820_001), pubkey: OWNER, kind: GIT_PR_UPDATE, created_at: 5_000, content: '',
        tags: [['e', wurzel]],
    }
    const wechsel: ForgeEvent = {
        id: hex(820_002), pubkey: OWNER, kind: GIT_STATUS_CLOSED, created_at: 5_000, content: '',
        tags: [['e', wurzel]],
    }
    const notiz: ForgeEvent = {
        id: hex(820_003), pubkey: OWNER, kind: FORGE_COMMENT, created_at: 5_000, content: '',
        tags: [['e', wurzel]],
    }
    const alle = [update, wechsel, notiz]

    assert.deepEqual(indexUpdates(alle).get(wurzel)?.map((e) => e.id), [update.id])
    assert.deepEqual(indexStatus(alle).get(wurzel)?.map((e) => e.id), [wechsel.id])
    assert.deepEqual(indexNotes(alle).get(wurzel)?.map((e) => e.id), [notiz.id])
})
