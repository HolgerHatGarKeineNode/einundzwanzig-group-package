// Virtualisiertes Chat-Fenster auf Basis des framework-agnostischen
// @tanstack/virtual-core (kein React/Framework-Mount). Nur das sichtbare Fenster
// liegt im DOM → der loadOlder-Prepend fügt keine 50 komplexen Zeilen mehr auf
// einmal ein (Batch-Layout-Ruckeln weg), und der DOM wächst nicht unbegrenzt.
//
// `anchorTo: 'end'` aktiviert in virtual-core drei Dinge, die zusammen unsere
// gesamte handgeschriebene Scroll-Logik ersetzen (Schritt 7,
// plans/chat-message-cache-no-flicker.md):
//   1. Prepend/Append-Kompensation, keyed by Event-ID: bei jeder count-/Edge-Key-
//      Änderung wird der Item am aktuellen Offset gemerkt und nach dem Update über
//      seinen Key wieder an dieselbe Viewport-Position gerückt → kein Sprung beim
//      Laden älterer Nachrichten. (ersetzt die Anker-Logik)
//   2. `wasAtEnd`-Adjust: wächst ein Item (Bild-Load, spät nachladende Chips),
//      während man am Boden klebt, wird der Boden gehalten. (ersetzt onMediaLoad)
//   3. Above-viewport-Adjust + backward-scroll-Skip: wächst Inhalt oberhalb der
//      Leseposition, bleibt sie stehen; beim Hochscrollen wird NICHT nachjustiert
//      (kein Kampf gegen die Geste). (ersetzt Grow-only + Gesten-Latch)
// `followOnAppend` klebt bei neuen eigenen/fremden Nachrichten an den Boden, wenn
// man dort steht. Pflicht: stabiler getItemKey = Event-ID (haben wir).
import {
    Virtualizer,
    elementScroll,
    observeElementRect,
    observeElementOffset,
    type VirtualItem,
} from '@tanstack/virtual-core'

// Schlanke, gerenderte Zeile für den Alpine-State (kein TanStack-Interna-Objekt in
// Alpines Reactivity-Proxy spiegeln — nur die vier Werte, die das Template braucht).
export interface VirtualRow {
    key: string
    index: number
    start: number
    size: number
}

export interface ChatVirtualizer {
    /** Nach jedem Messages-Update aufrufen (neue Länge) → Prepend/Append-Anker anwenden. */
    update(count: number): void
    /** Pro gerenderter Zeile einmal (Alpine x-init) → misst die Zeile + beobachtet Höhenänderungen. */
    measureRow(node: HTMLElement): void
    /** An den Boden springen (neue Nachricht / „Zum Ende"-Button). */
    scrollToEnd(smooth?: boolean): void
    /** First Paint: an den wachsenden Boden kleben bis die Messung stabil ist, dann onDone (Reveal). */
    scrollToEndSettled(onDone: () => void): void
    /** Zu einer Nachricht scrollen (Zitat-Sprung), zentriert. */
    scrollToIndex(index: number): void
    /** Steht der Nutzer (nahe) am Boden? threshold in px. */
    isAtEnd(threshold?: number): boolean
    /** Ein paar Frames ans Ende nachziehen (async nachladende Chips/Bilder wachsen 1-2 Frames verzögert). */
    stickToEndBriefly(): void
    destroy(): void
}

export function createChatVirtualizer(config: {
    getScrollElement: () => HTMLElement | null
    getKey: (index: number) => string
    onChange: (rows: VirtualRow[], totalSize: number) => void
    getSpacerElement?: () => HTMLElement | null
    estimateSize?: number
    // Content-bewusster Höhen-Estimate pro Zeile (Autor-Header/Bild-Box/Chips) — hält
    // getTotalSize() nah an der realen Höhe, BEVOR die Zeile vermessen wird → die Messung
    // korrigiert kaum noch → der Scrollbalken-Thumb zuckt beim Scrollen nicht. Fehlt der
    // Callback, bleibt der flache Estimate (nur der First-Paint-Sprung war damit sichtbar).
    estimateRow?: (index: number) => number
}): ChatVirtualizer {
    const estimate = config.estimateSize ?? 64
    let destroyed = false

    // Ein einziges Options-Objekt: setOptions baut sein internes `merged` frisch aus
    // Defaults + den hier übergebenen Werten, daher muss bei jedem Update das VOLLE
    // Objekt rein. count wird mutiert, getKey/estimateSize lesen live.
    const options = {
        count: 0,
        getScrollElement: config.getScrollElement,
        estimateSize: (index: number) => config.estimateRow?.(index) ?? estimate,
        getItemKey: (index: number) => config.getKey(index),
        // WURZEL-FIX gegen das Thumb-Pendeln: virtual-core wendet Mess-Korrekturen
        // (applyScrollAdjustment/scrollToEnd/reconcile) SYNCHRON an, indem es scrollTop gegen
        // die DOM-scrollHeight setzt — aber unsere Spacer-Höhe hängt an Alpines reaktivem
        // `:style="height:${totalSize}px"` und wird erst einen Frame SPÄTER gesetzt. Jede
        // wachsende Zeile (ASCII-Messung, Chip-/Poll-/Goal-Nachladung) korrigierte also gegen
        // die noch ALTE, zu kleine scrollHeight → Browser klampt scrollTop → der geklampte Wert
        // fließt via Scroll-Event zurück → nächster Frame wächst der Spacer → Korrektur überschießt
        // = Oszillation. Indem wir den Spacer HIER (im scrollToFn, das virtual-core direkt VOR
        // jedem Scroll ruft) imperativ auf getTotalSize() setzen, läuft jede Korrektur gegen die
        // bereits gewachsene Höhe → kein Klamp, kein Rückkopplungs-Pendeln. Alpines `:style`
        // setzt danach denselben Wert (idempotent). Vorbild: der Prepend-Pfad in update() (unten).
        scrollToFn: (offset: number, opts: { adjustments?: number; behavior?: ScrollBehavior }, instance: Virtualizer<HTMLElement, HTMLElement>) => {
            const spacer = config.getSpacerElement?.()
            if (spacer) {
                spacer.style.height = instance.getTotalSize() + 'px'
            }
            elementScroll(offset, opts, instance)
        },
        observeElementRect,
        observeElementOffset,
        overscan: 8,
        paddingEnd: 12, // Luft unter der letzten Nachricht (ersetzt das frühere pb-4 am Container)
        anchorTo: 'end' as const,
        followOnAppend: true,
        scrollEndThreshold: 80,
        onChange: () => flush(),
    }

    // Aktuelles Fenster + Gesamthöhe nach Alpine spiegeln. Wird sowohl von virtual-core
    // (onChange bei Scroll/Resize/Measure) als auch von uns synchron nach setOptions gerufen.
    const flush = () => {
        const rows = v.getVirtualItems().map((it: VirtualItem) => ({
            key: String(it.key),
            index: it.index,
            start: it.start,
            size: it.size,
        }))
        config.onChange(rows, v.getTotalSize())
    }

    // _willUpdate bindet das Scroll-Element (nur beim null→element-Übergang) UND wendet den
    // pendingScrollAnchor an. Beides MUSS nach Alpines DOM-Commit laufen: (a) beim ersten Mal
    // existiert $refs.scroll erst NACH init() (rAF = nächster Frame → da), sonst bindet nichts
    // → onChange feuert nie → leere Liste; (b) der Anker-/Boden-Scroll muss gegen den bereits
    // GEWACHSENEN Spacer laufen (totalSize kommt aus flush()), sonst klampt der Browser scrollTop.
    const raf: (cb: () => void) => void =
        typeof requestAnimationFrame !== 'undefined' ? requestAnimationFrame : (cb) => setTimeout(cb, 0)
    const commit = () => {
        raf(() => {
            v._willUpdate() // bindet (falls nötig) + wendet pendingScrollAnchor an
            flush() // korrigiertes Fenster nach dem Scroll/Bind
        })
    }

    const v = new Virtualizer<HTMLElement, HTMLElement>(options)
    const unmount = v._didMount()
    commit() // erste Bindung, sobald $refs.scroll im nächsten Frame da ist

    return {
        update(count) {
            options.count = count
            v.setOptions(options) // erfasst den Anker (prev vs. next Edge-Keys) + setzt pendingScrollAnchor
            flush() // Fenster + totalSize nach Alpine (Spacer wächst im Microtask)
            // pendingScrollAnchor[0] !== null = KEY-Anker (Prepend älterer Nachrichten). NUR dann
            // synchron anwenden — sonst öffnet der rAF ein Fenster, in dem ein natives Scroll-Event
            // (schneller Aufwärts-Fling) den erfassten newOffset auf den alten DOM-scrollTop
            // zurücksetzt → Prepend-Korrektur verloren → Sprung (und der weiter niedrige scrollTop
            // triggert den Prefetch erneut → kaskadierendes Nachladen). Damit der synchrone Scroll
            // nicht am (noch nicht von Alpine gewachsenen) Spacer klampt, die Höhe hier imperativ setzen.
            // First Paint/Append (followOnAppend, key=null) + Erstbindung bleiben beim rAF-commit — der
            // gibt Spacer/Zeilen Zeit zu rendern (der synchrone Pfad ließ den First-Paint driften).
            const pending = (v as unknown as { pendingScrollAnchor: [unknown, ...unknown[]] | null }).pendingScrollAnchor
            if (v.scrollElement && pending && pending[0] !== null) {
                const spacer = config.getSpacerElement?.()
                if (spacer) {
                    spacer.style.height = v.getTotalSize() + 'px'
                }
                v._willUpdate()
            } else {
                commit()
            }
        },
        measureRow(node) {
            v.measureElement(node)
        },
        scrollToEnd(smooth = false) {
            v.scrollToEnd({ behavior: smooth ? 'smooth' : 'auto' })
        },
        // First Paint: an den WACHSENDEN Boden kleben, während sich die Zeilen async vermessen
        // (Estimate 64 → reale Höhe lässt totalSize wachsen), DANN onDone (Reveal). Die Liste ist bis
        // dahin opacity-0, das fightet also keine User-Geste.
        //
        // Abbruchbedingung: NICHT über getDistanceFromEnd — das re-pinnende scrollToEnd macht die
        // Distanz JEDEN Frame ~0, also wäre sie ein wertloses Signal (Settle endete in Frame 2, bevor
        // die Messung, die ~1-2 Frames nachhinkt, totalSize fertig wachsen lässt → Reveal am
        // teilgemessenen Boden → Drift). Stattdessen: totalSize muss STABIL sein (Messung fertig) UND
        // ein paar Frames vergangen (Messung hatte Zeit zu starten); harte Frame-Deckel als Backstop.
        scrollToEndSettled(onDone) {
            let stableFrames = 0
            let frames = 0
            let lastTotal = -1
            const step = () => {
                // Nach destroy() (Raumwechsel) sofort abbrechen: sonst liefe der Loop auf dem toten
                // Virtualizer weiter und riefe onDone → firstPaintDone=true auf der WIEDERVERWENDETEN
                // Component, sodass der neue Raum sein Settle überspränge und am Estimate-Boden driftete.
                if (destroyed) {
                    return
                }
                v.scrollToEnd({ behavior: 'auto' })
                const total = v.getTotalSize()
                stableFrames = total === lastTotal ? stableFrames + 1 : 0
                lastTotal = total
                frames += 1
                // fertig: totalSize seit 3 Frames unverändert UND ≥6 Frames gelaufen (Messung sicher
                // durch), ODER 30-Frame-Deckel (~0,5s) als Backstop bei nie ganz ruhender Höhe.
                if ((frames >= 6 && stableFrames >= 3) || frames >= 30) {
                    onDone()
                    return
                }
                raf(step)
            }
            raf(step)
        },
        scrollToIndex(index) {
            v.scrollToIndex(index, { align: 'center', behavior: 'smooth' })
        },
        isAtEnd(threshold) {
            return v.isAtEnd(threshold)
        },
        // Async nachladende Chips (Zap/Reaction) und Bilder lassen eine bestehende Zeile 1-2 Frames
        // NACH dem Emit wachsen — der count ändert sich nicht, also greift weder followOnAppend noch
        // der synchrone wasAtEnd-Adjust (der läuft VOR dem Chip-Render). Stand man am Boden, würde
        // die wachsende (auch die letzte) Zeile den Inhalt nach oben schieben → „springt hoch". Darum
        // über ein paar Frames erneut ans Ende pinnen. NUR aus dem Emit heraus aufgerufen, wenn man
        // WIRKLICH am Boden stand (enge isAtEnd-Schwelle) → kein Kampf gegen eine Aufwärts-Geste.
        stickToEndBriefly() {
            let n = 0
            const step = () => {
                if (destroyed) {
                    return
                }
                v.scrollToEnd({ behavior: 'auto' })
                if (++n < 5) {
                    raf(step)
                }
            }
            raf(step)
        },
        destroy() {
            destroyed = true // laufenden scrollToEndSettled-Loop stoppen (kein onDone auf totem _virt)
            unmount()
        },
    }
}
