/**
 * **Ein Beobachter für alle in JS gebauten Bilder, die der Relay nur signiert
 * herausgibt.**
 *
 * Das Markup meldet sich mit `data-blossom-src` an ([[blossomMarkup]]); hier wird es
 * abgeholt. Warum ein einzelner Beobachter am Dokument und nicht ein Aufruf je
 * Einsetzstelle: die HTML-Strings entstehen in `feeds.ts`, `longformFeed.ts` und
 * `forge.ts`, werden gecacht und an mindestens sieben Stellen per `x-html` eingesetzt
 * — teils in Alpine-Templates, die niemand von JS aus anfasst. Eine Regel, die an
 * jeder Einsetzstelle einzeln eingehalten werden muss, wird irgendwo nicht eingehalten
 * (dieselbe Begründung wie bei der Wache in [[mediaGuard]]).
 *
 * ── Die vier Eigenschaften, auf die es ankommt ──
 *
 * 1. **Kein Wiederhol-Sturm.** Jedes Bild bekommt beim Anfassen SOFORT — vor dem
 *    ersten `await` — sein `data-blossom-state`, und der Selektor greift nur
 *    Zustandslose. Ein zweiter Beobachter-Lauf während des Ladens sieht das Bild
 *    also nicht mehr. Scheitert der Ladeweg (kein Signer, kein Mitglied, 401), ist
 *    `none` ein Endzustand; wiederholt wird nichts.
 * 2. **Kein hängender Ladezustand.** `load()` liefert `''` statt zu werfen; jeder
 *    Ausgang endet in `ready` oder `none`, auch der geworfene.
 * 3. **Kein Zyklus.** Beobachtet wird ausschließlich `childList`/`subtree` — das
 *    Setzen von `src` und `data-blossom-state` sind Attribut-Mutationen und lösen
 *    den Beobachter deshalb nicht erneut aus.
 * 4. **Der Sitzungswechsel räumt auf.** Beim Ab-/Anmelden werden die `blob:`-URLs
 *    widerrufen ([[blossomInstance]]); ein `src`, das darauf zeigt, ist danach ein
 *    kaputtes Bild. `rescan()` nimmt beides zurück (Zustand UND `src`) und lässt die
 *    Bilder für die neue Identität neu entscheiden — auch in die andere Richtung: was
 *    als Gast still leer blieb, erscheint nach dem Anmelden ohne Seiten-Neuaufbau.
 *
 * Der Preis ist ein `querySelectorAll` je Mutations-Bündel. MutationObserver bündelt
 * pro Microtask, ein Chat-Nachladen mit 50 Zeilen ist also EIN Lauf, nicht 50.
 */
import { BLOSSOM_SRC_ATTR, BLOSSOM_STATE_ATTR } from './blossomMarkup.ts'

/** Nur das, was der Hydrator von einem Element braucht — ein echtes `Element` erfüllt es. */
export type BlossomImageEl = {
    getAttribute: (name: string) => string | null
    setAttribute: (name: string, value: string) => void
    removeAttribute: (name: string) => void
    hasAttribute: (name: string) => boolean
}

/** Nur das, was der Hydrator von einer Wurzel braucht — `document` erfüllt es. */
export type BlossomRoot = {
    querySelectorAll: (selectors: string) => Iterable<BlossomImageEl>
}

/** `blossomMedia.load` — `''` heißt „für diesen Nutzer nicht verfügbar". */
export type BlossomLoad = (url: string) => Promise<string>

/** Unbearbeitete Marker-Bilder. Der Zustand IST die Sperre gegen Doppelarbeit. */
const OFFEN = `img[${BLOSSOM_SRC_ATTR}]:not([${BLOSSOM_STATE_ATTR}])`

/** Alle Marker-Bilder, unabhängig vom Zustand (für `rescan`). */
const ALLE = `img[${BLOSSOM_SRC_ATTR}]`

/**
 * Alle noch unbearbeiteten Marker-Bilder unter `root` holen.
 *
 * Das zurückgegebene Promise ist für Tests da (es wartet auf alle Ladevorgänge); im
 * Betrieb läuft der Aufruf ungewartet — jedes Bild schreibt sein Ergebnis selbst in
 * den DOM, sobald es da ist.
 */
export const hydrateBlossomImages = async (root: BlossomRoot, load: BlossomLoad): Promise<void> => {
    const laufend: Promise<void>[] = []
    for (const el of root.querySelectorAll(OFFEN)) {
        const url = el.getAttribute(BLOSSOM_SRC_ATTR) ?? ''
        // SYNCHRON und als Erstes: ab hier greift der Selektor dieses Bild nicht mehr.
        el.setAttribute(BLOSSOM_STATE_ATTR, 'pending')
        if (url === '') {
            el.setAttribute(BLOSSOM_STATE_ATTR, 'none')
            continue
        }
        laufend.push(
            load(url).then(
                (objectUrl: string) => {
                    if (objectUrl === '') {
                        el.setAttribute(BLOSSOM_STATE_ATTR, 'none')

                        return
                    }
                    el.setAttribute('src', objectUrl)
                    // `data-full` nur füllen, wenn das Markup es vorgesehen hat (Chat-Bild
                    // mit Lightbox); ein Emoji hat keins und bekommt auch keins.
                    if (el.hasAttribute('data-full')) {
                        el.setAttribute('data-full', objectUrl)
                    }
                    el.setAttribute(BLOSSOM_STATE_ATTR, 'ready')
                },
                () => {
                    el.setAttribute(BLOSSOM_STATE_ATTR, 'none')
                },
            ),
        )
    }
    await Promise.all(laufend)
}

/**
 * Ein MutationObserver, auf das Nötige verengt (injiziert → ohne Browser prüfbar).
 *
 * Generisch über das Ziel, weil der echte `MutationObserver.observe` einen `Node`
 * verlangt, der Test aber irgendein Objekt übergibt. Ein fest verdrahtetes `object`
 * hier wäre für den echten Observer zu weit (kontravariant) und der Compiler lehnte
 * die Verdrahtung in `bridge.ts` ab.
 */
export type ObserverLike<T> = {
    observe: (target: T, options: { childList: boolean; subtree: boolean }) => void
    disconnect: () => void
}

export type ObserverFactory<T> = (onMutation: () => void) => ObserverLike<T>

export type BlossomHydration = {
    /** Zustand UND `src` aller Marker-Bilder zurücksetzen und neu entscheiden. */
    rescan: () => void
    stop: () => void
}

/**
 * Den Beobachter aufsetzen: einmal alles Vorhandene, danach jede Einfügung.
 *
 * @param target Was beobachtet wird (im Betrieb `document.body`); `root` bleibt die
 *   Wurzel, unter der gesucht wird (`document`) — beides zu trennen kostet nichts und
 *   macht den Testaufbau eindeutig.
 */
export const startBlossomHydration = <T>(root: BlossomRoot, load: BlossomLoad, makeObserver: ObserverFactory<T>, target: T): BlossomHydration => {
    void hydrateBlossomImages(root, load)
    const observer = makeObserver(() => {
        void hydrateBlossomImages(root, load)
    })
    observer.observe(target, { childList: true, subtree: true })

    return {
        rescan: (): void => {
            for (const el of root.querySelectorAll(ALLE)) {
                // Das `src` MUSS mit weg: es zeigt auf eine `blob:`-URL, die beim
                // Sitzungswechsel widerrufen wurde. Bliebe es stehen, zeigte die Fläche
                // dem nächsten Nutzer ein kaputtes Bild statt gar keines.
                el.removeAttribute('src')
                el.removeAttribute(BLOSSOM_STATE_ATTR)
            }
            void hydrateBlossomImages(root, load)
        },
        stop: (): void => {
            observer.disconnect()
        },
    }
}
