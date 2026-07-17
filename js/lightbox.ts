/**
 * Zoom-Gesten für die Bild-Lightbox (geteilte Insel: Web + Android-WebView).
 *
 * Eine Bild-Lightbox ohne Zoom ist auf dem Handy unbrauchbar, sobald das Bild Text
 * enthält (Screenshot, Fahrplan, Meme). Statt einer Fremd-Lib (kein neues Dependency)
 * rechnen wir die Transform selbst — Pointer Events decken Touch, Maus und Stift in
 * EINER Code-Bahn ab:
 *
 *  - 2-Finger-Pinch (Touch)         → Zoom um den Finger-Mittelpunkt, inkl. Mitziehen
 *  - 1-Finger-Wischen (nur gezoomt) → Pan; bei scale=1 bleibt die Geste frei
 *  - Doppeltipp / Doppelklick       → Toggle 1× ⇄ 2,5× auf den getippten Punkt
 *  - Mausrad / Trackpad-Pinch       → Zoom auf den Cursor (Trackpad-Pinch sendet
 *                                     `wheel` MIT ctrlKey; `preventDefault` hält den
 *                                     Browser davon ab, die ganze Seite zu zoomen)
 *
 * Die Bühne braucht `touch-action: none` (Tailwind `touch-none`), sonst schluckt der
 * Browser die Gesten für natives Scrollen/Seiten-Zoom, bevor wir sie sehen.
 *
 * Nur `scale`/`x`/`y`/`smooth`/`panned` liegen im reaktiven Alpine-State (die bindet
 * das Template). Die Gesten-Buchhaltung (Pointer-Map, Start-Distanz …) bleibt bewusst
 * in Closure-Variablen: pro Frame beschriebene Felder haben in einem Alpine-Proxy
 * nichts zu suchen — das wären nur unnötige Reaktivitäts-Trigger.
 */
type Point = { x: number; y: number }

const MIN_SCALE = 1
const MAX_SCALE = 6
/** Zielstufe für Doppeltipp — groß genug, dass Fließtext im Bild lesbar wird. */
const DOUBLE_TAP_SCALE = 2.5
/** Zwei Tipps gelten als Doppeltipp, wenn sie zeitlich UND örtlich nah beisammen sind. */
const DOUBLE_TAP_MS = 300
const DOUBLE_TAP_SLOP = 30
/** Ab dieser Fingerbewegung ist es ein Pan, kein Tipp (unterdrückt das Schließen). */
const TAP_SLOP = 10
/** Dauer der Doppeltipp-Animation; Pinch/Wheel laufen ohne Transition (sonst zäh). */
const SNAP_MS = 200

const distance = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y)
const midpoint = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v))

/** Bühnenmitte = Viewport-Mitte (das Overlay ist `fixed inset-0`, das Bild darin zentriert). */
const stageCenter = (): Point => ({ x: window.innerWidth / 2, y: window.innerHeight / 2 })

export type LightboxZoomState = {
    scale: number
    x: number
    y: number
    smooth: boolean
    /** Die laufende Geste hat gezogen → der folgende `click` darf NICHT schließen. */
    panned: boolean
    readonly imageStyle: string
    reset(): void
    clampPan(): void
    zoomTo(next: number, clientX: number, clientY: number, smooth: boolean): void
    toggleZoom(clientX: number, clientY: number): void
    onPointerDown(event: PointerEvent): void
    onPointerMove(event: PointerEvent): void
    onPointerUp(event: PointerEvent): void
    onWheel(event: WheelEvent): void
}

type Refs = { $refs: Record<string, HTMLElement | undefined> }

export const createLightboxZoom = (): LightboxZoomState => {
    /** Aktive Finger/Zeiger, `pointerId → Position`. Zwei davon = Pinch. */
    const pointers = new Map<number, Point>()
    /** Finger-Abstand und Transform beim Pinch-Start — die Geste rechnet relativ dazu. */
    let startDistance = 0
    let startScale = 1
    let startMid: Point = { x: 0, y: 0 }
    let startTranslate: Point = { x: 0, y: 0 }
    /** Cursor-minus-Translate beim Pan-Start; Pan = `clientX - panAnchor.x`. */
    let panAnchor: Point = { x: 0, y: 0 }
    let downAt: Point = { x: 0, y: 0 }
    let lastTapAt = 0
    let lastTapPos: Point = { x: 0, y: 0 }

    return {
        scale: 1,
        x: 0,
        y: 0,
        smooth: false,
        panned: false,

        get imageStyle(): string {
            const cursor = this.scale > MIN_SCALE ? 'grab' : 'zoom-in'
            const transition = this.smooth ? `transform ${SNAP_MS}ms ease-out` : 'none'
            return `transform: translate3d(${this.x}px, ${this.y}px, 0) scale(${this.scale}); cursor: ${cursor}; transition: ${transition}`
        },

        /**
         * Zurück auf Ausgangsgröße. Läuft per `x-effect` bei JEDEM Wechsel von
         * `lightboxSrc` — sonst erbte das nächste Bild Zoom und Versatz des vorigen.
         * Liest bewusst KEINEN reaktiven State (nur Schreiben) → kein Effect-Loop.
         */
        reset() {
            this.scale = 1
            this.x = 0
            this.y = 0
            this.smooth = false
            this.panned = false
            pointers.clear()
            startDistance = 0
            lastTapAt = 0
        },

        /**
         * Hält das Bild am Viewport gefangen: nur so weit schiebbar, wie es über den
         * Rand hinausragt. Ohne das lässt sich das Bild ins Nichts schieben.
         */
        clampPan() {
            const img = (this as unknown as Refs).$refs.img
            if (!img) {
                return
            }
            const maxX = Math.max(0, (img.offsetWidth * this.scale - window.innerWidth) / 2)
            const maxY = Math.max(0, (img.offsetHeight * this.scale - window.innerHeight) / 2)
            this.x = clamp(this.x, -maxX, maxX)
            this.y = clamp(this.y, -maxY, maxY)
        },

        /**
         * Skaliert auf `next` und hält dabei den Punkt (`clientX`/`clientY`) unter
         * Finger/Cursor ortsfest — sonst „flüchtet" das Bild beim Zoomen aus der Hand.
         *
         * Ein Bildpunkt landet bei `screen = center + translate + scale · p`. Damit der
         * Punkt `s` fix bleibt, muss `translate' = (s - center) - k · ((s - center) - translate)`
         * mit `k = next / scale` gelten.
         */
        zoomTo(next: number, clientX: number, clientY: number, smooth: boolean) {
            const target = clamp(next, MIN_SCALE, MAX_SCALE)
            const k = target / this.scale
            const c = stageCenter()
            this.smooth = smooth
            this.x = clientX - c.x - k * (clientX - c.x - this.x)
            this.y = clientY - c.y - k * (clientY - c.y - this.y)
            this.scale = target
            if (target <= MIN_SCALE) {
                // Ganz herausgezoomt gibt es keinen Versatz — sonst bliebe das Bild schief.
                this.x = 0
                this.y = 0
            } else {
                this.clampPan()
            }
        },

        toggleZoom(clientX: number, clientY: number) {
            this.zoomTo(this.scale > MIN_SCALE ? MIN_SCALE : DOUBLE_TAP_SCALE, clientX, clientY, true)
        },

        onPointerDown(event: PointerEvent) {
            const surface = event.currentTarget as HTMLElement
            surface.setPointerCapture?.(event.pointerId)
            pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
            this.smooth = false
            this.panned = false
            downAt = { x: event.clientX, y: event.clientY }

            if (pointers.size === 1) {
                panAnchor = { x: event.clientX - this.x, y: event.clientY - this.y }
                return
            }
            if (pointers.size === 2) {
                const [a, b] = [...pointers.values()]
                startDistance = distance(a, b)
                startScale = this.scale
                startMid = midpoint(a, b)
                startTranslate = { x: this.x, y: this.y }
            }
        },

        onPointerMove(event: PointerEvent) {
            if (!pointers.has(event.pointerId)) {
                return
            }
            pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })

            if (pointers.size >= 2) {
                if (startDistance <= 0) {
                    return
                }
                const [a, b] = [...pointers.values()]
                const target = clamp((startDistance > 0 ? distance(a, b) / startDistance : 1) * startScale, MIN_SCALE, MAX_SCALE)
                const k = target / startScale
                const c = stageCenter()
                const m = midpoint(a, b)
                // Zoom um den START-Mittelpunkt, plus die Drift des Mittelpunkts seither:
                // so zoomt und schiebt derselbe Zwei-Finger-Griff gleichzeitig.
                this.scale = target
                this.x = startMid.x - c.x - k * (startMid.x - c.x - startTranslate.x) + (m.x - startMid.x)
                this.y = startMid.y - c.y - k * (startMid.y - c.y - startTranslate.y) + (m.y - startMid.y)
                this.clampPan()
                this.panned = true
                return
            }

            if (this.scale > MIN_SCALE) {
                this.x = event.clientX - panAnchor.x
                this.y = event.clientY - panAnchor.y
                this.clampPan()
                this.panned = true
                return
            }

            // Ungezoomt wird nicht gepannt — wir merken uns nur, ob aus dem Tipp ein
            // Ziehen wurde, damit der abschließende `click` die Lightbox nicht schließt.
            if (distance(downAt, { x: event.clientX, y: event.clientY }) > TAP_SLOP) {
                this.panned = true
            }
        },

        onPointerUp(event: PointerEvent) {
            pointers.delete(event.pointerId)
            if (pointers.size < 2) {
                startDistance = 0
            }
            if (pointers.size === 1) {
                // Ein Finger bleibt liegen: er wird zum neuen Pan-Anker, sonst springt
                // das Bild beim Übergang Pinch → Pan.
                const [p] = [...pointers.values()]
                panAnchor = { x: p.x - this.x, y: p.y - this.y }
                return
            }
            if (pointers.size > 0) {
                return
            }

            // Doppeltipp nur für Finger/Stift — die Maus hat ihr eigenes `dblclick`.
            if (this.panned || event.pointerType === 'mouse') {
                return
            }
            const now = Date.now()
            const pos = { x: event.clientX, y: event.clientY }
            if (now - lastTapAt < DOUBLE_TAP_MS && distance(lastTapPos, pos) < DOUBLE_TAP_SLOP) {
                this.toggleZoom(pos.x, pos.y)
                lastTapAt = 0
                // Der zweite Tipp darf nicht als „Klick daneben" die Lightbox schließen.
                this.panned = true
                return
            }
            lastTapAt = now
            lastTapPos = pos
        },

        onWheel(event: WheelEvent) {
            // Ohne preventDefault scrollt die Seite hinter dem Overlay bzw. der Browser
            // zoomt beim Trackpad-Pinch (= wheel + ctrlKey) das ganze Dokument.
            event.preventDefault()
            // Zeilen-Modus (klassische Mausräder) liefert ~3 statt ~100 → auf px normieren.
            const dy = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY
            // Trackpad-Pinch liefert feine Deltas → kräftigerer Faktor als beim Mausrad.
            const factor = Math.exp(-dy * (event.ctrlKey ? 0.01 : 0.0015))
            this.zoomTo(this.scale * factor, event.clientX, event.clientY, false)
        },
    }
}
