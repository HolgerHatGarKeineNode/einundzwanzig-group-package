/**
 * Viewport-Store — die EINE Antwort auf „läuft dieser Client gerade im
 * Desktop-Chassis?".
 *
 * Warum ein Store und nicht `hidden xl:flex` am Markup: Alpine initialisiert
 * `x-data` auch in Elementen, die per CSS versteckt sind. Ein reines
 * `hidden xl:flex` an der Rail bootete die Rail-Insel deshalb auf JEDEM Telefon
 * mit — samt Relay-Subscription für eine Spalte, die niemand sieht. Das
 * `<template x-if="$store.viewport.desktop">` an der Rail ist die einzige
 * Konstruktion, die das verhindert: `x-if` entscheidet über die EXISTENZ des
 * Knotens, nicht über seine Sichtbarkeit.
 *
 * Die Schwelle ist zeichengleich mit Tailwinds `xl` (1280px). Sie steht hier ein
 * zweites Mal als Literal — bewusst: CSS und JS haben keinen gemeinsamen Ort
 * dafür, und ein auseinanderlaufendes Paar wäre ein stiller Fehler (Rail-Markup
 * ohne Grid oder Grid ohne Rail-Markup). Wer `xl` verschiebt, verschiebt hier mit.
 *
 * `matchMedia` statt `resize`-Listener: der Browser feuert nur beim ÜBERSCHREITEN
 * der Schwelle, nicht bei jedem Pixel. Kein Debounce nötig, kein Layout-Thrash.
 */

export const DESKTOP_QUERY = '(min-width: 1280px)'

export type ViewportStore = {
    desktop: boolean
    init(): void
}

/**
 * Registriert `$store.viewport`. Idempotent — `registerNostrComponents` kann
 * mehrfach laufen (Muster wie `wireUnread`), der zweite Lauf findet den Store
 * bereits vor und hängt keinen zweiten Listener an.
 */
export function wireViewport(Alpine: { store: (name: string, value?: unknown) => unknown }): void {
    if (Alpine.store('viewport')) {
        return
    }

    // SSR-/jsdom-Sicherheit: ohne matchMedia (Node-Tests, alte WebViews) bleibt
    // der Client im Mobil-Chassis. Das ist die richtige Ausfallrichtung — das
    // schmale Layout funktioniert auf jeder Breite, das breite nicht.
    const mql = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
        ? window.matchMedia(DESKTOP_QUERY)
        : null

    Alpine.store('viewport', { desktop: mql?.matches ?? false })
    const store = Alpine.store('viewport') as ViewportStore

    // `addEventListener('change')` statt des veralteten `addListener`. Kein
    // Abmelden: der Store lebt so lange wie das Dokument, und `wire:navigate`
    // tauscht nur den Body — der Listener überlebt die Navigation und muss das
    // auch, sonst stünde die Rail nach dem ersten Raumwechsel auf dem falschen Fuß.
    mql?.addEventListener('change', (e: MediaQueryListEvent) => {
        store.desktop = e.matches
    })
}
