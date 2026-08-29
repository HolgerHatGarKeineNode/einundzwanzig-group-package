/**
 * Jitter-freies „lade mehr, wenn nahe am Rand" — portiert aus Flotilla (`src/lib/html.ts`
 * `createScroller`). Eine schlichte rAF-Schleife statt Scroll-Event-Rechnerei: prüft alle
 * `delay` ms, ob der Scroll-Container innerhalb `threshold` px vor dem Rand steht, und ruft
 * dann `onScroll` (das ältere/neuere Nachrichten nachlädt). Ersetzt den TanStack-Virtualizer-
 * Prefetch-Backstop — zusammen mit dem `flex-col-reverse`-Container (nativer Boden-Pin)
 * verschwindet die ResizeObserver-Nachmess-Rechnerei, die das Ruckeln verursacht hat.
 *
 * `reverse=false` (Default): feuert am WEITEN Rand (oben/älteste in column-reverse) → loadOlder.
 * `reverse=true`: feuert am NAHEN Rand (unten/neueste) → loadNewer (aktuell nicht gebraucht,
 * unsere Live-Sub liefert Neues; für einen späteren Vorwärts-Feed vorbereitet).
 * column-reverse liefert je nach Browser negatives `scrollTop` → durchweg `Math.abs`.
 */
export type Scroller = { stop: () => void }

/**
 * Ab wie vielen Pixeln Überschuss gilt ein Container als scrollbar. Klein, weil die Frage
 * binär ist — sie trennt „der Nutzer KANN scrollen" von „er kann es nicht"; Sub-Pixel-
 * Rundung soll dabei nicht als Scrollbarkeit durchgehen.
 */
const SCROLLBAR_SCHWELLE = 1

/**
 * Der Prefetch-Riegel (P4): **nachladen nur als Reaktion, nicht auf Verdacht.**
 *
 * ── Der Defekt, gemessen ────────────────────────────────────────────────────────
 *
 * Beim blossen Öffnen eines Raums flogen ältere Seiten los, ohne dass jemand gescrollt
 * hatte (`room.spec.ts` „D1: das blosse Öffnen lädt KEINE ältere Seite nach", am Draht
 * gezählt: `loadOlder` feuerte 1× unter 0.8.16 und 2× unter 0.9.5).
 *
 * ── Was NICHT die Ursache war, obwohl es plausibel klang ────────────────────────
 *
 * Die Diagnose lautete: der Verlauf füllt den Viewport nicht, also ist man am neuesten
 * UND am ältesten Rand zugleich, und die Nähe-Prüfung ist bedeutungslos. Daraus folgte
 * die Empfehlung, erst zu prüfen, wenn der Log überhaupt scrollbar ist.
 *
 * **Im Browser nachgemessen, im Moment des Öffnens von „scroll":**
 *
 *   scrollHeight 3317 · clientHeight 578 · scrollTop 0 · flex-direction column-reverse
 *   → Überschuss 2739 px, der Log IST scrollbar (5,7 Viewports Inhalt)
 *
 * Ein reiner Scrollbarkeits-Guard hätte hier also **nicht gegriffen**. Der Auslöser ist
 * das Verhältnis zur Schwelle: der Abstand zum ältesten Rand beträgt beim Öffnen
 * `3317 − 0 − 578 = 2739 px` und liegt damit unter `threshold` (3000). Die Bedingung ist
 * formal richtig — 2739 px SIND nah — und trotzdem falsch, weil niemand sich bewegt hat.
 *
 * ── Der Riegel, der daraus folgt ────────────────────────────────────────────────
 *
 * Geladen wird nur, wenn zusätzlich EINES gilt:
 *
 *   • `offset > 0` — der Nutzer hat den Log verlassen, das Nachladen ist eine Reaktion.
 *   • der Log ist gar nicht scrollbar — dann KANN er sich nicht bewegen, und Nachladen ist
 *     die einzige Möglichkeit, den Viewport überhaupt zu füllen. Diese Hälfte ist der
 *     Grund, warum der Riegel nicht bloss `offset > 0` prüft: sonst bliebe ein Raum, dessen
 *     erste Seite kürzer als der Viewport ist, für immer bei einer Seite stehen.
 *
 * Der Riegel sitzt hier und nicht in `loadOlder`: dort stehen die Zustands-Guards
 * (`hasMore` & Co.), und eine Geometriebedingung würde der „Ältere laden"-Knopf miterben —
 * für den sie falsch wäre, denn ein Knopfdruck IST die Nutzerbewegung.
 */
const darfNachladen = (element: HTMLElement, offset: number): boolean => {
    const scrollbar = element.scrollHeight > element.clientHeight + SCROLLBAR_SCHWELLE

    return offset > 0 || !scrollbar
}

export const createScroller = (
    element: HTMLElement,
    onScroll: () => unknown,
    { delay = 300, threshold = 3000, reverse = false }: { delay?: number; threshold?: number; reverse?: boolean } = {},
): Scroller => {
    let done = false

    const check = async (): Promise<void> => {
        // Unsichtbar (Overlay zu / Tab weg) → nicht laden, aber weiter pollen.
        const visible = element.offsetParent !== null && element.clientHeight > 0
        if (visible) {
            const { scrollHeight, scrollTop, clientHeight } = element
            const offset = Math.abs(scrollTop)
            const shouldLoad = reverse ? offset < threshold : offset + clientHeight + threshold > scrollHeight
            if (shouldLoad && darfNachladen(element, offset)) {
                await onScroll()
            }
        }
        await new Promise((resolve) => setTimeout(resolve, delay))
        if (!done) {
            requestAnimationFrame(() => void check())
        }
    }

    requestAnimationFrame(() => void check())

    return {
        stop: () => {
            done = true
        },
    }
}
