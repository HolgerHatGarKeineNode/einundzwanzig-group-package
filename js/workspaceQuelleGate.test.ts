/**
 * **P6-Riegel: eine Quelle statt zweier.**
 *
 * Die DoD-Zeile lautet: „Die mobile Kanalliste und `forgeRows` kommen aus
 * **derselben** Funktion, gehalten von einer Zusicherung, die bei Trennung rot
 * wird." Genau das steht hier — und zwar über die VERDRAHTUNG, nicht über das
 * Verhalten der reinen Funktion (`workspaceModel.test.ts` deckt das andere).
 *
 * Ausführen (Repo-Root):
 *   node --experimental-strip-types --test packages/einundzwanzig-group/js/workspaceQuelleGate.test.ts
 *
 * **Warum das Verhalten allein nicht reicht** — es ist der Kern dieser Phase:
 * baut jemand in `bridge.ts` wieder eine eigene Liste aus `buildWorkspaceList`,
 * dann liefert `buildWorkspaceModel` weiterhin exakt das Richtige. Jeder
 * Verhaltenstest über die reine Funktion bleibt grün; nur fragt niemand sie mehr.
 * So sind die zwei Datenwege vor P6 entstanden.
 *
 * Scanner + Begründung für den AST-Weg: `workspaceQuelleGate.ts`.
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
    MIN_AUFRUFE,
    importiertAus,
    lies,
    liesDatei,
    ruftAuf,
    sammleModule,
    type Quellenbefund,
} from './workspaceQuelleGate.ts'

const JS_DIR = dirname(fileURLToPath(import.meta.url))

/** Das Modul, das die Frage seit P6 als einziges beantwortet. */
const MODELL_MODUL = './workspaceModel.ts'
const MODELL_FUNKTION = 'buildWorkspaceModel'

/**
 * Die beiden Funktionen, die VOR P6 die je eigene Fassung gebaut haben. Sie
 * gehören seither ausschließlich nach `workspaceModel.ts`; ein Aufruf in einer
 * der beiden Inseln IST die Trennung, die dieser Riegel fangen soll.
 */
const ALTE_QUELLEN = ['buildWorkspaceList', 'buildForgeNav']

/**
 * Die zwei Inseln, die dieselbe Frage stellen — mobil und Desktop.
 *
 * `mussRufen` ist die Verdrahtungs-Zusage je Insel. Für `rail.ts` stehen die zwei
 * Zustands-Prädikate mit drin, und das ist kein Beiwerk: `isMuted`/`isPinned`
 * waren VOR P6 in beiden Inseln eigenhändig ausgeschrieben
 * (`(this.prefs.muted ?? []).includes(h)` gegen `this.muted.includes(h)`), dazu
 * ein drittes Mal in `groupUnread()`. Ein Rückfall in die Inline-Fassung wäre
 * verhaltensgleich und deshalb von keinem Verhaltenstest zu fangen — nur von
 * dieser Zeile. Die mobile Insel steht nicht in dieser Liste, weil ihre Zeilen
 * den Zustand fertig mitbringen; sie fragt ihn gar nicht mehr.
 */
const INSELN = [
    {
        datei: 'bridge.ts',
        fassung: 'mobile Kanalliste (nostrWorkspaceRooms)',
        fremdaufruf: 'splitMine',
        mussRufen: [MODELL_FUNKTION],
    },
    {
        datei: 'rail.ts',
        fassung: 'Desktop-Rail (forgeRows)',
        fremdaufruf: 'buildGroups',
        mussRufen: [MODELL_FUNKTION, 'isChannelMuted', 'isChannelPinned'],
    },
]

const befundFuer = (datei: string): Quellenbefund => liesDatei(join(JS_DIR, datei), datei)

describe('P6-Riegel: mobile Kanalliste und forgeRows kommen aus derselben Funktion', () => {
    // ── Kalibrierung ────────────────────────────────────────────────────────
    //
    // Ohne sie ist jedes „ruft die alte Quelle nicht auf" wertlos: ein Scanner,
    // der nichts sieht, meldet dasselbe wie ein sauberer Baum.

    for (const insel of INSELN) {
        test(`KALIBRIERUNG: der Scanner sieht ${insel.datei} wirklich`, () => {
            const befund = befundFuer(insel.datei)
            assert.ok(
                befund.aufrufe.length >= MIN_AUFRUFE,
                `Nur ${befund.aufrufe.length} Aufrufe in ${insel.datei} gesehen (erwartet mindestens ${MIN_AUFRUFE}).`,
            )
            // Ein Aufruf, der mit diesem Riegel NICHTS zu tun hat: findet der
            // Scanner ihn nicht, misst er die Datei nicht.
            assert.ok(
                ruftAuf(befund, insel.fremdaufruf),
                `${insel.datei} ruft ${insel.fremdaufruf}() nicht auf — der Scanner liest die falsche Datei.`,
            )
        })
    }

    test('fail-closed: eine leere Datei lässt den Scanner werfen, statt „keine Aufrufe" zu melden', () => {
        assert.throws(() => lies('leer.ts', ''), /keine einzige Anweisung/)
        assert.throws(() => lies('nurkommentar.ts', '// nichts\n'), /keine einzige Anweisung/)
    })

    test('KALIBRIERUNG: ein Name in Kommentar, String oder Regex ist KEIN Aufruf — ein Aufruf ist einer', () => {
        // Das ist die Positivkontrolle für den Verbots-Teil weiter unten, und sie
        // ist nicht theoretisch: `bridge.ts` nennt `buildWorkspaceList` in der
        // Erklärung am Import, um zu sagen, dass es dort NICHT mehr steht. Ein
        // Textmuster meldete diesen Kommentar als Verstoß.
        const getarnt = [
            '/* buildWorkspaceList(x) im Blockkommentar */',
            '// buildWorkspaceList(x) in der Zeile',
            'const s = "buildWorkspaceList(x)"',
            'const r = /[/*]buildWorkspaceList/',
            'export const nichts = () => s + String(r)',
        ].join('\n')
        assert.equal(ruftAuf(lies('getarnt.ts', getarnt), 'buildWorkspaceList'), false)

        const echt = 'import { buildWorkspaceList } from "./railGroups.ts"\nexport const x = () => buildWorkspaceList([], {})'
        const echtBefund = lies('echt.ts', echt)
        assert.equal(ruftAuf(echtBefund, 'buildWorkspaceList'), true)
        assert.equal(importiertAus(echtBefund, 'buildWorkspaceList', './railGroups.ts'), true)
    })

    // ── Kernbeweis ──────────────────────────────────────────────────────────

    for (const insel of INSELN) {
        test(`KERNBEWEIS: ${insel.fassung} zieht aus ${MODELL_FUNKTION}`, () => {
            const befund = befundFuer(insel.datei)
            assert.ok(
                importiertAus(befund, MODELL_FUNKTION, MODELL_MODUL),
                `${insel.datei} importiert ${MODELL_FUNKTION} nicht aus ${MODELL_MODUL}.`,
            )
            for (const name of insel.mussRufen) {
                assert.ok(
                    ruftAuf(befund, name),
                    `${insel.datei} ruft ${name}() nicht auf — die ${insel.fassung} hat wieder einen eigenen Datenweg.`,
                )
            }
        })

        test(`KERNBEWEIS: ${insel.datei} baut die Liste NICHT mehr selbst`, () => {
            const befund = befundFuer(insel.datei)
            for (const alt of ALTE_QUELLEN) {
                assert.equal(
                    ruftAuf(befund, alt),
                    false,
                    `${insel.datei} ruft ${alt}() direkt auf. Das ist der zweite Datenweg, den P6 aufgelöst hat — `
                        + `die Frage „welche Kanäle hat dieser Workspace?" gehört ausschließlich in ${MODELL_MODUL}.`,
                )
            }
        })
    }

    test('GEGENPROBE: die alten Quellen sind nicht gelöscht, sondern EINGEZOGEN', () => {
        // Ohne diese Zeile wäre der Verbots-Test auch dann grün, wenn jemand die
        // Repo-Bindung und die Sortierung ersatzlos entfernt hätte.
        const modell = befundFuer('workspaceModel.ts')
        for (const alt of ALTE_QUELLEN) {
            assert.ok(
                ruftAuf(modell, alt),
                `workspaceModel.ts ruft ${alt}() nicht auf — die Logik ist nicht eingezogen, sondern weg.`,
            )
        }
    })

    test('KERNBEWEIS: im ganzen Produktivcode ruft GENAU EINE Datei die alten Quellen auf', () => {
        // Breiter als die zwei Inseln: eine dritte Fläche, die morgen ihre eigene
        // Kanalliste baut, wäre derselbe Fehler an einem neuen Ort — und stünde
        // hier, ohne dass jemand diesen Test anfassen müsste.
        const module = sammleModule(JS_DIR)
        const aufrufer = module.filter((datei) =>
            ALTE_QUELLEN.some((alt) => ruftAuf(befundFuer(datei), alt)),
        )
        assert.deepEqual(
            aufrufer,
            ['workspaceModel.ts'],
            `Diese Dateien bauen die Workspace-Liste selbst: ${aufrufer.join(', ')}. Erlaubt ist ${MODELL_MODUL}.`,
        )
    })
})
