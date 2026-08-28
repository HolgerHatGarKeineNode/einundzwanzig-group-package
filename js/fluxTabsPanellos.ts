/**
 * **Schutzhülle für `flux:tabs` OHNE `flux:tab.group`.**
 *
 * Vier Flächen dieser App benutzen `flux:tabs` als reinen ALPINE-FILTER, ohne Panels:
 * `⚡forge`, `⚡forge-repo`, `⚡forge-pull`, `⚡updates`. Flux verträgt das an einer
 * Stelle nicht — und die Stelle ist eine andere als die, die der Blade-Kommentar dort
 * seit jeher nennt.
 *
 * ── Der Fehler ──────────────────────────────────────────────────────────────────────
 *
 * `UITabs.mount()` (flux-pro 2.17.0, `dist/flux.js:16134-16139`, wortgleich in
 * `flux.module.js:16133-16138` und `flux.min.js`) hängt einen MutationObserver an das
 * eigene `<ui-tabs>` und ruft in JEDEM Durchlauf ungeprüft:
 *
 *     selected.el.closest("ui-tab-group").showPanel(selected.value)
 *
 * Ohne Tab-Gruppe ist `closest(…)` strukturell `null` ⇒
 * `TypeError: Cannot read properties of null (reading 'showPanel')`.
 * Bemerkenswert: `initializeTab()` zwei Funktionen weiter oben fragt dieselbe Gruppe
 * mit `?.` ab und steigt bei `null` sauber aus — die Panel-losen Tabs sind dort also
 * ausdrücklich vorgesehen. Nur der Observer hat den Null-Check nicht.
 *
 * **Ausgelöst wird er von einer `childList`-Mutation an `<ui-tabs>` SELBST** — gemessen
 * am 2026-08-28 (`/forge` @320 px, chromium):
 *   - nur den letzten Reiter fokussieren, ohne DOM-Eingriff  → kein Fehler
 *   - `prepend` in `<ui-tabs-scroll-area>` (Elternebene)      → kein Fehler
 *   - `prepend` in `<ui-tabs>`, ohne jeden Fokus              → **Fehler**
 * Der Observer läuft ohne `subtree`; alles, was tiefer passiert (die `x-if`-Badges in
 * den Reitern), erreicht ihn nicht. Auf `/updates` ist dieselbe Messung derselbe
 * Fehler — die Fläche ist nur deshalb nie rot geworden, weil dort niemand `<ui-tabs>`
 * von aussen anfasst.
 *
 * ── Warum nicht einfach `flux:tab.group` ergänzen ───────────────────────────────────
 *
 * Am selben Tag am realen Baum gemessen, beide Varianten:
 *   - `flux:tab.group` OHNE Panels ⇒ **3× `pageerror: Could not find panel...`** schon
 *     beim Laden (einer je Reiter, aus dem `queueMicrotask` in `initializeTab`), und
 *     `aria-controls` bleibt an allen drei Reitern leer. Die Behauptung im
 *     Blade-Kommentar ist damit BESTÄTIGT.
 *   - `flux:tab.group` MIT Panels ⇒ kein Wurf, `aria-controls` korrekt — aber
 *     `UITabGroup.walkPanels()` läuft über `this.children` und überspringt nur
 *     `ui-tab-group`/`ui-tabs`. Mit `scrollable` ist das direkte Kind der Gruppe nicht
 *     `<ui-tabs>`, sondern der Scroll-WRAPPER des Stubs. Der gilt Flux damit als Panel:
 *     er bekommt beim Laden `role="tabpanel"` (falsche ARIA über der Tablist) und bei
 *     der ersten Mutation `hidden` — gemessen `areaSichtbar: false`, die ganze
 *     Reiterbank verschwindet. `scrollable` + `tab.group` sind in dieser Flux-Version
 *     unverträglich, und `scrollable` ist hier die 1.4.10-Reparatur, nicht Zierat.
 *   - Unabhängig davon passt das Panel-Modell fachlich nicht: ab `xl` zeigt `/forge`
 *     MEHRERE Sektionen gleichzeitig (`zweispaltig || tab === '…'`), die Reiterreihe
 *     ist dort ausgeblendet. Panels können „alle gleichzeitig" nicht.
 *
 * ── Was diese Datei tut ─────────────────────────────────────────────────────────────
 *
 * Sie schiebt NACH Flux' Boot ein leeres `<ui-tab-group style="display:contents">`
 * als direkten Elternteil zwischen `<ui-tabs>` und dessen Wrapper. Damit ist
 * `closest("ui-tab-group")` nicht mehr `null`, und `showPanel()` läuft ins Leere:
 * `walkPanels()` sieht als einziges Kind `<ui-tabs>` und überspringt es — null Panels,
 * kein Zeigen, kein Verstecken, keine fremde ARIA. `display: contents` hält die
 * Hülle aus dem Layout heraus.
 *
 * **Warum NACH dem Boot und nicht im Blade:** stünde die Gruppe schon im gelieferten
 * HTML, fände `initializeTab()`s `queueMicrotask` sie und verlangte Panels — genau der
 * `Could not find panel...`-Wurf von oben. Erst wenn dieser Microtask durch ist, ist
 * die leere Gruppe harmlos. Deshalb läuft der Einbau in einem MAKROtask nach
 * `customElements.whenDefined('ui-tabs')`: das Upgrade eines bereits verbundenen
 * Elements passiert synchron beim `define`, `mount()` und der Panel-Microtask hängen
 * daran als Microtasks — ein Makrotask danach ist garantiert hinter beiden.
 *
 * ── Und warum die Hülle vor jeder Navigation wieder VERSCHWINDET ────────────────────
 *
 * Livewires `navigate` legt für den Zurück-Knopf einen HTML-Schnappschuss der noch
 * stehenden Seite an — `document.documentElement.outerHTML`, in
 * `updateCurrentPageHtmlInHistoryStateForLaterBackButtonClicks()` bzw.
 * `updateCurrentPageHtmlInSnapshotCacheForLaterBackButtonClicks()`
 * (`livewire.esm.js:12636-12643`, gerufen in `navigateTo()` bzw. im popstate-Zweig,
 * `:13286` / `:13348`). Eine eingebaute Hülle steht in diesem Schnappschuss mit drin.
 * Beim Zurückgehen wird er wieder eingesetzt — und dann findet `initializeTab()` beim
 * ERSTEN Anfassen der Reiter eine Gruppe ohne Panels vor und wirft genau den
 * `Could not find panel...`, den die Bauform vermeiden will. Gemessen am 2026-08-28 im
 * vollen chromium-Lauf: `updates.spec.ts` Anker 2 und Anker 3 (beide navigieren
 * ZURÜCK auf `/updates`) wurden davon rot, je 3× — einer pro Reiter.
 *
 * Deshalb wird die Hülle auf `livewire:navigating` synchron wieder ausgebaut. Beide
 * Schnappschuss-Stellen liegen im Ablauf NACH diesem Ereignis (es ist die Weiterleitung
 * von `alpine:navigating`, `livewire.esm.js:14517`), der gespeicherte HTML-Stand ist
 * damit immer hüllenfrei.
 *
 * ── Das Bereitschaftssignal ist eine JS-Eigenschaft, kein Attribut ──────────────────
 *
 * Aus demselben Grund taugt `role="tab"` nicht als Prüfung, ob Flux die Leiste schon
 * angefasst hat: das Attribut überlebt den Schnappschuss und wäre nach einer
 * Rück-Navigation da, bevor Flux irgendetwas getan hat. `el._initialized` setzt
 * `UITabs.initializeTabs()` dagegen als Eigenschaft auf dem Element
 * (`flux.js:16141-16149`) — die kann kein serialisierter Baum mitbringen.
 */

/** Merkmal der eingezogenen Hülle — Anker für Tests, Idempotenz und den Ausbau. */
export const HUELLE_MARKER = 'data-flux-tabs-panellos'

/** So oft wird nach einem Anlass nachgefasst, bis Flux die Leisten initialisiert hat. */
const VERSUCHE = 30
const ABSTAND_MS = 16

/** Hat Flux dieses `<ui-tabs>` schon initialisiert? Siehe Modulkopf (JS-Eigenschaft). */
function fluxIstDurch(tabs: Element): boolean {
    return Array.from(tabs.querySelectorAll('a, button')).some(
        (el) => (el as Element & { _initialized?: boolean })._initialized === true,
    )
}

/**
 * Zieht die Schutzhülle um jedes Panel-lose, bereits initialisierte `<ui-tabs>`.
 *
 * Idempotent: ein `<ui-tabs>`, das schon (echt oder per Hülle) in einer Gruppe steht,
 * wird übersprungen. Ist Flux noch nicht durch, wird NICHT eingebaut — das ist die
 * fail-safe Richtung: ohne Hülle bleibt der Ausgangszustand, eine zu früh eingebaute
 * Hülle erzeugte den zweiten Fehler.
 *
 * @returns Zahl der neu eingezogenen Hüllen
 */
export function ziehePanelloseTabsHuelle(wurzel: ParentNode): number {
    let gezogen = 0

    for (const tabs of Array.from(wurzel.querySelectorAll('ui-tabs'))) {
        if (tabs.closest('ui-tab-group')) {
            continue
        }
        if (!fluxIstDurch(tabs)) {
            continue
        }
        const elternteil = tabs.parentNode
        if (!elternteil) {
            continue
        }

        const huelle = document.createElement('ui-tab-group')
        huelle.setAttribute(HUELLE_MARKER, '')
        huelle.style.display = 'contents'
        // Einschieben und Umhängen im SELBEN Task: `UIElement.connectedCallback`
        // erkennt das über sein `wasDisconnected`-Flag als Verschiebung und mountet
        // `<ui-tabs>` nicht neu (flux.js:2007-2024) — der Observer, die Auswahl und
        // die Alpine-Bindung bleiben unangetastet.
        elternteil.insertBefore(huelle, tabs)
        huelle.appendChild(tabs)
        gezogen++
    }

    return gezogen
}

/**
 * Baut jede eigene Hülle wieder aus — SYNCHRON, damit Livewires HTML-Schnappschuss
 * für den Zurück-Knopf sie nicht mitnimmt (Begründung im Modulkopf). Echte
 * `flux:tab.group`-Gruppen aus dem Blade bleiben unangetastet: sie tragen den Marker
 * nicht.
 *
 * @returns Zahl der ausgebauten Hüllen
 */
export function loesePanelloseTabsHuelle(wurzel: ParentNode): number {
    let geloest = 0

    for (const huelle of Array.from(wurzel.querySelectorAll(`ui-tab-group[${HUELLE_MARKER}]`))) {
        const elternteil = huelle.parentNode
        if (!elternteil) {
            continue
        }
        while (huelle.firstChild) {
            elternteil.insertBefore(huelle.firstChild, huelle)
        }
        huelle.remove()
        geloest++
    }

    return geloest
}

/**
 * Verdrahtet Ein- und Ausbau für die ganze Sitzung.
 *
 * Ohne DOM (node) ein No-op — `index.ts` ruft diese Funktion beim Modul-Eval, und ein
 * Toplevel-`document`-Zugriff sperrte den Sammel-Einstieg der Insel aus jedem reinen
 * Test aus (gleiche Begründung wie bei `setupFlashToast`).
 */
export function beobachtePanellosTabs(): void {
    if (typeof document === 'undefined' || typeof customElements === 'undefined') {
        return
    }

    // Nachfassen statt einmalig raten: nach einem Body-Swap kann Flux die neuen
    // Leisten später initialisieren, als der erste Makrotask liegt. Die Schleife
    // endet, sobald jede Leiste in einer Gruppe steht — oder nach VERSUCHE Runden.
    const einbauen = (rest: number = VERSUCHE): void => {
        setTimeout(() => {
            ziehePanelloseTabsHuelle(document)
            const offen = Array.from(document.querySelectorAll('ui-tabs')).some((t) => !t.closest('ui-tab-group'))
            if (rest > 0 && offen) {
                einbauen(rest - 1)
            }
        }, ABSTAND_MS)
    }

    // Erster Boot: das Upgrade eines bereits verbundenen Elements passiert synchron
    // beim `define`, `mount()` und der Panel-Microtask hängen daran als Microtasks —
    // ein Makrotask danach ist garantiert hinter beiden.
    void customElements.whenDefined('ui-tabs').then(() => einbauen())

    document.addEventListener('livewire:navigating', () => {
        loesePanelloseTabsHuelle(document)
        // Bleibt die Navigation doch aus (abgebrochener Fetch), kommt die Hülle
        // eine Runde später von selbst zurück — der Schnappschuss ist zu diesem
        // Zeitpunkt längst gezogen, er entsteht synchron in demselben Task.
        einbauen()
    })
    document.addEventListener('livewire:navigated', () => einbauen())
}
