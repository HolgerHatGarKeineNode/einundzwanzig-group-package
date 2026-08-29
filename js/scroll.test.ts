/**
 * Pure-Tests für den rAF-Scroller (`createScroller`) — vor allem für den Prefetch-Riegel
 * aus P4.
 *   node --test packages/einundzwanzig-group/js/scroll.test.ts
 *
 * Der Riegel entscheidet auf JEDER Chat-Fläche, ob eine ältere Seite fliegt. Sein
 * Verhaltensnachweis am Draht steht in `tests/e2e/room.spec.ts` (die beiden D1-Fälle:
 * „das blosse Öffnen lädt KEINE ältere Seite nach" und „Ältere laden automatisch beim
 * Hochscrollen"). Hier steht die Entscheidungstabelle daneben — sie läuft in
 * Millisekunden und benennt, WELCHE Lage jeweils gemeint ist, statt nur zwei Endpunkte
 * zu prüfen.
 *
 * Die Maße der ersten Zeile sind nicht ausgedacht: sie sind im Browser beim Öffnen des
 * Raums „scroll" gemessen worden (scrollHeight 3317, clientHeight 578, scrollTop 0). An
 * genau dieser Lage ist die naheliegende Diagnose gescheitert — der Log ist scrollbar,
 * ein reiner Scrollbarkeits-Guard hätte sie durchgelassen.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createScroller } from './scroll.ts'

/** Ein Container-Doppel: nur die vier Felder, die der Scroller liest. */
const container = (scrollHeight: number, clientHeight: number, scrollTop: number): HTMLElement =>
    ({ scrollHeight, clientHeight, scrollTop, offsetParent: {} }) as unknown as HTMLElement

/**
 * Lässt den Scroller genau einen Durchlauf machen und meldet, ob nachgeladen wurde.
 *
 * `requestAnimationFrame` und `setTimeout` werden ersetzt: der echte rAF liefe in Node
 * nicht, und der echte Timer machte aus einem 1-ms-Test einen 300-ms-Test. Der zweite
 * rAF-Aufruf wird verschluckt — sonst liefe die Schleife weiter und der Test endete nie.
 */
const einDurchlauf = async (element: HTMLElement, optionen?: Parameters<typeof createScroller>[2]): Promise<boolean> => {
    const g = globalThis as unknown as { requestAnimationFrame?: (cb: () => void) => number }
    const echterRaf = g.requestAnimationFrame
    let rafZaehler = 0
    g.requestAnimationFrame = (cb: () => void) => {
        rafZaehler += 1
        if (rafZaehler === 1) {
            cb()
        }
        return rafZaehler
    }

    let geladen = false
    const scroller = createScroller(element, () => {
        geladen = true
    }, optionen)

    // Der Durchlauf ist async (await onScroll, await Timer) — ein paar Microtasks abwarten.
    for (let i = 0; i < 5; i++) {
        await Promise.resolve()
    }
    scroller.stop()
    g.requestAnimationFrame = echterRaf

    return geladen
}

test('RIEGEL: der gemessene Öffnen-Fall lädt NICHT nach (scrollbar, aber unbewegt)', async () => {
    // Im Browser gemessen beim Öffnen von „scroll".
    assert.equal(await einDurchlauf(container(3317, 578, 0)), false)
})

test('KALIBRIERUNG: ohne den Riegel WÜRDE dieselbe Lage nachladen', async () => {
    // Die alte Bedingung, hier nachgerechnet: 0 + 578 + 3000 = 3578 > 3317.
    // Wäre das falsch, prüfte der Fall darüber eine Lage, die ohnehin nie geladen hätte.
    const { scrollHeight, clientHeight, scrollTop } = container(3317, 578, 0)
    assert.equal(Math.abs(scrollTop) + clientHeight + 3000 > scrollHeight, true)
})

test('nach einer Nutzerbewegung wird nachgeladen', async () => {
    // Derselbe Container, nur hochgescrollt: jetzt ist es eine Reaktion.
    assert.equal(await einDurchlauf(container(3317, 578, 400)), true)
})

test('ein nicht scrollbarer Log lädt nach — er KANN sich nicht bewegen', async () => {
    assert.equal(await einDurchlauf(container(578, 578, 0)), true)
    assert.equal(await einDurchlauf(container(400, 578, 0)), true, 'Inhalt kürzer als der Viewport')
})

test('ein Überschuss von einem Pixel gilt noch nicht als scrollbar', async () => {
    assert.equal(await einDurchlauf(container(579, 578, 0)), true, 'ein Pixel ist Rundung, nicht Scrollbarkeit')
    assert.equal(await einDurchlauf(container(580, 578, 0)), false, 'zwei Pixel: scrollbar, also unbewegt kein Prefetch')
})

test('weit weg vom ältesten Rand wird auch nach Bewegung nicht geladen', async () => {
    // Abstand 20000 - 800 - 578 … deutlich über threshold: die alte Bedingung greift nicht.
    assert.equal(await einDurchlauf(container(20_000, 578, 800)), false)
})

test('nahe am ältesten Rand nach Bewegung: geladen', async () => {
    // Abstand = 20000 - 17000 - 578 = 2422 < 3000.
    assert.equal(await einDurchlauf(container(20_000, 578, 17_000)), true)
})

test('unsichtbarer Container lädt nie — auch nicht mit passender Geometrie', async () => {
    const unsichtbar = { scrollHeight: 400, clientHeight: 0, scrollTop: 0, offsetParent: null } as unknown as HTMLElement
    assert.equal(await einDurchlauf(unsichtbar), false)
})

test('reverse: am neuesten Rand ohne Bewegung wird nicht geladen', async () => {
    // reverse feuert bei offset < threshold; beim Öffnen ist offset 0.
    assert.equal(await einDurchlauf(container(3317, 578, 0), { reverse: true }), false)
    // Nach einer Bewegung innerhalb der Schwelle schon.
    assert.equal(await einDurchlauf(container(3317, 578, 100), { reverse: true }), true)
})
