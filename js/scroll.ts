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
            if (shouldLoad) {
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
