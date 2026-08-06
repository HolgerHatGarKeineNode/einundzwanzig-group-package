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

/**
 * „Wird dieser Client mit einem echten Zeigegerät bedient?" — Maus/Trackpad, das
 * hovern und pixelgenau treffen kann. Beide Bedingungen zusammen, weil einzeln
 * jede von ihnen lügt: ein Touch-Laptop meldet `hover: hover` (Trackpad) UND hat
 * einen Finger; ein Stift meldet `pointer: fine` ohne Hover. Die Konjunktion ist
 * die etablierte Formel für „kein Touch-Primärgerät".
 *
 * Das ist NICHT dasselbe wie {@link DESKTOP_QUERY}: Breite ist Layout, Zeigegerät
 * ist Bedienung. Ein 1400px breites Tablet ist Desktop-Layout und Touch-Bedienung.
 */
export const POINTER_QUERY = '(hover: hover) and (pointer: fine)'

export type ViewportStore = {
    desktop: boolean
    mouse: boolean
    init(): void
}

/**
 * Registriert `$store.viewport`. Idempotent — `registerNostrComponents` kann
 * mehrfach laufen (Muster wie `wireUnread`), der zweite Lauf findet den Store
 * bereits vor und hängt keinen zweiten Listener an.
 *
 * `nativeApp` = `isMobile` aus `core.ts` (das NativePHP-Flag `window.__nostrMobile`).
 * Es wird HEREINGEREICHT statt importiert, damit dieses Modul frei von welshman
 * bleibt: `core.ts` konfiguriert beim Import die welshman-Kontexte und fasst
 * `localStorage` an — ein Import hier machte `viewport.ts` unter `node --test`
 * unladbar.
 */
export function wireViewport(
    Alpine: { store: (name: string, value?: unknown) => unknown },
    { nativeApp = false }: { nativeApp?: boolean } = {},
): void {
    if (Alpine.store('viewport')) {
        return
    }

    // SSR-/jsdom-Sicherheit: ohne matchMedia (Node-Tests, alte WebViews) bleibt
    // der Client im Mobil-Chassis. Das ist die richtige Ausfallrichtung — das
    // schmale Layout funktioniert auf jeder Breite, das breite nicht.
    const query = (q: string): MediaQueryList | null =>
        typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(q) : null

    const mql = query(DESKTOP_QUERY)
    // Ohne matchMedia ist `mouse` FALSCH — die andere Ausfallrichtung als bei
    // `desktop`, und aus demselben Grund: nimm die harmlose Seite. Was an `mouse`
    // hängt (Emoji-Button), ist Zusatzkomfort für Mauszeiger; fehlt er, tippt man
    // Emojis über die native Tastatur. Stünde `mouse` versehentlich auf `true`,
    // bekäme jedes Telefon einen unbedienbaren Knopf samt schwerem Picker-Boot.
    const pointer = query(POINTER_QUERY)

    Alpine.store('viewport', {
        desktop: mql?.matches ?? false,
        mouse: !nativeApp && (pointer?.matches ?? false),
    })
    const store = Alpine.store('viewport') as ViewportStore

    // `addEventListener('change')` statt des veralteten `addListener`. Kein
    // Abmelden: der Store lebt so lange wie das Dokument, und `wire:navigate`
    // tauscht nur den Body — der Listener überlebt die Navigation und muss das
    // auch, sonst stünde die Rail nach dem ersten Raumwechsel auf dem falschen Fuß.
    mql?.addEventListener('change', (e: MediaQueryListEvent) => {
        store.desktop = e.matches
    })
    // Das Zeigegerät wechselt seltener als die Breite, aber es wechselt: ein
    // abgedocktes 2-in-1, ein angestecktes Trackpad, DevTools-Geräteemulation.
    // `nativeApp` kann sich zur Laufzeit nicht ändern und bleibt darum außen vor.
    pointer?.addEventListener('change', (e: MediaQueryListEvent) => {
        store.mouse = !nativeApp && e.matches
    })
}
