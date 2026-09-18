/**
 * `x-html-stable` — Alpines `x-html` mit Identitätsgedächtnis.
 *
 * ── Warum diese Direktive existiert ────────────────────────────────────────────────
 *
 * Alpines `x-html` setzt `el.innerHTML` bei JEDEM Effect-Lauf bedingungslos neu — auch
 * wenn der String derselbe ist wie beim letzten Mal (livewire.esm.js, Direktive `html`).
 * Eine `innerHTML`-Zuweisung zerstört aber die Kindknoten und baut sie neu, selbst bei
 * identischem Markup: ein `<video>` in einer Chat-Nachricht verliert damit bei jedem
 * Refire seinen Ladestand (Poster/erster Frame, laufende Wiedergabe, `blob:`-Src des
 * Blossom-Hydrators) und startet einen neuen Load-Zyklus — für die Nutzerin das
 * „Flackern bis sich das Re-Rendering beruhigt".
 *
 * Dass der Effect überhaupt refiret, obwohl der HTML-String gleich bleibt, liegt an der
 * Objekt-Identität: refresht ein `x-for` den Zeilen-Scope mit einem NEU gemappten
 * Message-Objekt (gleicher Inhalt, anderes Objekt), meldet die Reaktivität „geändert"
 * und der Effect läuft nach. Der Raum-Feed hält die Identität inzwischen stabil
 * ({@link deriveRoomChat} cached die fertige Zeile), aber diese Direktive ist der Riegel
 * für jede Fläche, die das nicht tut oder es künftig vergisst — gemessen am Live-Fall
 * `tests/e2e/chat-video-stabilitaet.spec.ts`: eine nach dem Boot eintreffende Nachricht
 * ersetzte das Video-Element genau so (videoErsetzt=1, ein zusätzlicher mp4-Load), bis
 * beide Hälften des Fixes griffen.
 *
 * ── Semantik ───────────────────────────────────────────────────────────────────────
 *
 * Bis auf den Guard identisch zu Alpines `html`: derselbe `structural`-Priority-Effect,
 * dasselbe `destroyTree` vor dem Setzen (sonst blieben Alpine-Zustände orphaned), dasselbe
 * `initTree` danach, beides in `mutateDom`. Der Guard vergleicht den letzten gesetzten
 * String am Element — ein Setter, der nichts ändert, darf auch nichts zerstören.
 *
 * ── Wo sie eingesetzt wird ──────────────────────────────────────────────────────────
 *
 * An den Chat-Flächen, deren Inhalt aus `feeds.ts`-Strings kommt: dem Nachrichtenkörper
 * (`partials/chat-row.blade.php`) und dem Thread-Kopf (`⚡room.blade.php`). NICHT an
 * Artikel/Forge: deren HTML wechselt nur beim Wechsel des ganzen Objekts (anderer
 * Artikel, einRefreshLayout) — ein Refire mit identischem String gehört dort zu keiner
 * beobachteten Churn-Klasse, und ein ungeprüfter Tausch aller x-html-Stellen wäre selbst
 * eine blinde Änderung.
 */

/** Die Markierung, an der das Element seinen zuletzt gesetzten HTML-String erinnert. */
type StableHtmlEl = HTMLElement & { _xHtmlStableCache?: string }

/**
 * Registriert die Direktive an der Alpine-Instanz. Bewusst dünn typisiert über die
 * Struktur, die `bridge.ts registerNostrComponents` ohnehin erwartet — kein Zugriff auf
 * Alpines Typen aus node_modules (Livewire liefert sie nicht als eigenständige Typen).
 */
export const wireStableHtml = (Alpine: {
    directive: (
        name: string,
        callback: (
            el: HTMLElement,
            directives: { expression: string },
            utilities: {
                effect: (fn: () => void, options?: { priority?: string }) => void
                evaluateLater: (expression: string) => (callback: (value: unknown) => void) => void
            },
        ) => void
    ) => void
    mutateDom: (fn: () => void) => void
    destroyTree: (el: Element) => void
    initTree: (el: Element) => void
}): void => {
    Alpine.directive(
        'html-stable',
        (el, { expression }, { effect, evaluateLater }) => {
            const evaluate = evaluateLater(expression)
            effect(
                () => {
                    evaluate((value) => {
                        const html = value != null ? String(value) : ''
                        const mark = el as StableHtmlEl
                        if (mark._xHtmlStableCache === html) {
                            return
                        }
                        mark._xHtmlStableCache = html
                        Alpine.mutateDom(() => {
                            Array.from(el.children).forEach((child) => Alpine.destroyTree(child))
                            el.innerHTML = html
                            ;(el as StableHtmlEl & { _x_ignoreSelf?: boolean })._x_ignoreSelf = true
                            Alpine.initTree(el)
                            delete (el as StableHtmlEl & { _x_ignoreSelf?: boolean })._x_ignoreSelf
                        })
                    })
                },
                { priority: 'structural' },
            )
        },
    )
}
