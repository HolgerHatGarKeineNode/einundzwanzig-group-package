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
 * ── Die Einheit ist REM, und das ist der Kern (P2, 2026-08-26) ───────────────
 * Hier stand `(min-width: 1280px)`. Tailwind v4 emittiert `@media (width>=80rem)`
 * — am gebauten Stylesheet nachgesehen, es gibt dort KEINE einzige px-Schwelle.
 * Bei 16 px Standardschrift fallen 80rem und 1280px exakt zusammen; deshalb ist
 * das Paar jahrelang nicht auseinandergelaufen, obwohl es nie dasselbe MASS hatte.
 *
 * `rem` in einer MEDIA QUERY bezieht sich auf den INITIALEN Wert von `font-size`,
 * also auf die Standardschrift des BROWSERS — nicht auf `html { font-size }`.
 * Stellt ein Nutzer sie auf 20 px (eine reguläre Barrierefreiheits-Einstellung,
 * genau der Fall von WCAG 1.4.4), greift `xl:` erst ab 1600 px, ein px-Literal
 * hier aber weiter ab 1280 px.
 *
 * **Das Band dazwischen ist gemessen, nicht gerechnet.** Am gebauten Stylesheet,
 * im Browser, mit der Standardschrift über CDP auf 20 px gestellt (derselbe Weg
 * wie chrome://settings): zwischen 1280 und 1599 px sagt der Store „Desktop",
 * während `hidden xl:flex` noch `display: none` liefert — **320 px breit**,
 * binär eingegrenzt. Bei 16 px meldet dieselbe Sonde null Widersprüche
 * (Negativkontrolle). Protokoll:
 * `docs/plans/2026-08-26T1912-forge-buzz-gitea-sprache/p2-band-messung.log`
 * (App-Repo).
 *
 * **Was in dem Band passierte, ist nicht kosmetisch.** `⚡room.blade.php` schaltet
 * an genau diesem Flag `role` zwischen `complementary` und `dialog`, entfernt
 * `aria-modal` und setzt den Fokus NUR im Nicht-Desktop-Zweig. Im Band wäre das
 * Thread-Panel also ein nicht-modaler `complementary` — in einem Layout, das
 * mobil rendert und ihn bildfüllend zeigt.
 *
 * Die Schwelle steht hier weiterhin als zweites Literal — CSS und JS haben keinen
 * gemeinsamen Ort dafür. Neu ist, dass beide dieselbe EINHEIT tragen und dass ein
 * Riegel das misst statt es zu behaupten (`tests/e2e/desktop-schwelle.spec.ts`,
 * Host-Repo: die JS-Abfrage und eine echte `xl:`-Utility müssen bei 16 px UND bei
 * 20 px Standardschrift an derselben Breite umschlagen).
 *
 * `matchMedia` statt `resize`-Listener: der Browser feuert nur beim ÜBERSCHREITEN
 * der Schwelle, nicht bei jedem Pixel. Kein Debounce nötig, kein Layout-Thrash.
 */

export const DESKTOP_QUERY = '(min-width: 80rem)'

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

/**
 * Die FORM, in der dieser Client gerade rendert — drei Werte, nicht zwei
 * (P2, 2026-08-26).
 *
 * Warum kein Boolean: die Frage hat zwei unabhängige Achsen, und sie werden
 * regelmässig verwechselt. `desktop` beantwortet allein die BREITE. Im
 * App-Host ab der xl-Schwelle steht es auf `true`, obwohl es dort weder Rail
 * noch zweispaltige Bühne gibt — wer daraus „zweispaltig" schliesst, blendet
 * auf einem grossen Tablet die Kanalliste aus, ohne dass eine zweite Spur sie
 * auffängt. Genau deshalb hat `js/forge.ts` bis P2 am DOM zurückgemessen
 * (`getComputedStyle(leiste).display === 'none'`): der Store konnte die Frage
 * nicht beantworten, also fragte die Insel das Stylesheet.
 *
 * Mit drei Werten kann er sie beantworten. Der HOST kommt vom Server
 * (`Einundzwanzig\Group\Chassis::istApp()`, die eine Stelle, die den
 * NativePHP-Schalter liest, hereingereicht als `nativeApp`), die BREITE aus
 * `DESKTOP_QUERY` — und die misst seit P2 in `rem` wie Tailwind.
 *
 *   · `app`        — NativePHP-Host. Immer schmal, unabhängig von der Breite.
 *   · `web-schmal` — Web-Host unterhalb der xl-Schwelle.
 *   · `web-breit`  — Web-Host ab der xl-Schwelle: Rail und zweispaltige Bühne.
 *
 * `desktop` bleibt daneben bestehen und bedeutet unverändert „die BREITE reicht"
 * — daran hängt u. a. das Zeigegerät-unabhängige Panel-Verhalten im Raum.
 */
export type ViewportForm = 'app' | 'web-schmal' | 'web-breit'

export type ViewportStore = {
    desktop: boolean
    mouse: boolean
    /** Siehe {@link ViewportForm}. Abgeleitet, nie eigenständig gesetzt. */
    form: ViewportForm
    init(): void
}

/** Die EINE Ableitung der Form — hier, damit sie nicht an drei Orten entsteht. */
export const formOf = (nativeApp: boolean, desktop: boolean): ViewportForm =>
    nativeApp ? 'app' : desktop ? 'web-breit' : 'web-schmal'

/**
 * Registriert `$store.viewport`. Idempotent — `registerNostrComponents` kann
 * mehrfach laufen (Muster wie `wireUnread`), der zweite Lauf findet den Store
 * bereits vor und hängt keinen zweiten Listener an.
 *
 * `nativeApp` = `isMobile` aus `core.ts` (das NativePHP-Flag `window.__nostrMobile`).
 * Es wird HEREINGEREICHT statt importiert, damit dieses Modul frei von welshman
 * bleibt: `core.ts` konfiguriert beim Import die welshman-Kontexte und fasst
 * `localStorage` an.
 *
 * **Der Grund hat sich am 2026-08-22 geändert, die Entscheidung nicht.** Bis dahin
 * machte ein Import hier `viewport.ts` unter `node --test` unladbar; seit P2 des Plans
 * `js-insel-testbar-machen` lädt `core.ts` (Exit 0), gibt beim Laden aber weiterhin
 * einen gefangenen `getItem`-Fehler aus. Der Kontext-Aufbau selbst bleibt ein
 * Nebeneffekt, den ein Test dieses Moduls nicht will — deshalb wird `nativeApp`
 * weiterhin hereingereicht.
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

    const desktop = mql?.matches ?? false
    Alpine.store('viewport', {
        desktop,
        mouse: !nativeApp && (pointer?.matches ?? false),
        form: formOf(nativeApp, desktop),
    })
    const store = Alpine.store('viewport') as ViewportStore

    // `addEventListener('change')` statt des veralteten `addListener`. Kein
    // Abmelden: der Store lebt so lange wie das Dokument, und `wire:navigate`
    // tauscht nur den Body — der Listener überlebt die Navigation und muss das
    // auch, sonst stünde die Rail nach dem ersten Raumwechsel auf dem falschen Fuß.
    mql?.addEventListener('change', (e: MediaQueryListEvent) => {
        store.desktop = e.matches
        // `form` wird MITGEZOGEN und nicht als Getter gebaut: Alpines Reaktivität
        // hängt an der Zuweisung, und ein `get form()` auf dem Store-Objekt wäre
        // beim Ableiten in Blade (`$store.viewport.form === 'web-breit'`) zwar
        // korrekt, aber nicht als Abhängigkeit erfasst — die Fläche bliebe stehen.
        store.form = formOf(nativeApp, e.matches)
    })
    // Das Zeigegerät wechselt seltener als die Breite, aber es wechselt: ein
    // abgedocktes 2-in-1, ein angestecktes Trackpad, DevTools-Geräteemulation.
    // `nativeApp` kann sich zur Laufzeit nicht ändern und bleibt darum außen vor.
    pointer?.addEventListener('change', (e: MediaQueryListEvent) => {
        store.mouse = !nativeApp && e.matches
    })
}
