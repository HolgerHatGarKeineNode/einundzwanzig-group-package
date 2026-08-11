/**
 * `nostrDisplayPrefs` — Darstellungs-Schalter der Oberfläche, derzeit genau einer:
 * Nostr-Zitat- und Profilkarten im Chat (P5).
 *
 * ── Warum ein eigenes Modul und eine eigene Insel ────────────────────────────────────
 * Kein Zustand in `nostrRoomChat` (`bridge.ts`). Die Einstellung gilt app-weit und nicht je
 * Raum; sie in der Rauminsel zu halten wäre der falsche Geltungsbereich, und die Rauminsel
 * existiert auf dem Einstellungen-Screen gar nicht. Gleiches Vorgehen wie die Befehlspalette
 * aus P4 (`palette.ts`): eine `Alpine.data`-Komponente, eine Registrierungszeile in
 * `registerNostrComponents` — mehr weiß `bridge.ts` davon nicht.
 *
 * ── Warum ein Svelte-Store und nicht nur localStorage ───────────────────────────────
 * `feeds.ts` muss auf das Umschalten REAGIEREN (die Karten entstehen in `deriveRoomChat`,
 * nicht im Template). Ein reiner localStorage-Wert wäre nicht reaktiv; ein `writable` hängt
 * sich als weitere Ableitungsquelle ein, genau wie Profile oder Handles. localStorage ist
 * nur die Persistenz daneben, mit dem hausüblichen `e21:`-Präfix
 * (`emoji.ts:97`, `readState.ts:485`/`:547`).
 */
import { writable } from 'svelte/store'

const QUOTE_CARDS_KEY = 'e21:quote-cards'

/**
 * Gespeicherter Wert, Default AN.
 *
 * Nur ein ausdrückliches `'0'` schaltet ab — fehlender Schlüssel, kaputter Inhalt oder
 * gesperrter Storage (Privatmodus) bedeuten „noch nie entschieden" und damit den Default.
 * Ein `try` ist Pflicht: `localStorage` wirft in manchen WebView-Konfigurationen schon beim
 * Lesen.
 */
const readQuoteCards = (): boolean => {
    try {
        return localStorage.getItem(QUOTE_CARDS_KEY) !== '0'
    } catch {
        return true
    }
}

/**
 * Zeigt der Chat Zitat- und Profilkarten? Quelle der Wahrheit für `feeds.ts`.
 *
 * Ist der Wert `false`, entsteht in `deriveRoomChat` erst gar keine Karte — sie wird nicht
 * bloß unsichtbar geschaltet. Damit fallen auch die Auflösungs- und Nachladewege weg: wer
 * die Fläche abschaltet, zahlt ihre Relay-Anfragen nicht.
 */
export const quoteCardsEnabled = writable<boolean>(readQuoteCards())

/** Schalter umlegen: Store zuerst (die Oberfläche folgt sofort), Persistenz danach. */
export const setQuoteCardsEnabled = (enabled: boolean): void => {
    quoteCardsEnabled.set(enabled)
    try {
        localStorage.setItem(QUOTE_CARDS_KEY, enabled ? '1' : '0')
    } catch {
        // Kein Storage → die Wahl gilt für diese Sitzung, aber nicht darüber hinaus.
    }
}

type DisplayPrefsState = {
    quoteCards: boolean
    init(): void
}

/**
 * Die Insel hinter der `surface-card`-Zeile in den Einstellungen.
 *
 * `$watch` statt `x-on:change`: `x-model` und ein zusätzlicher Change-Handler lauschen auf
 * DASSELBE Ereignis, die Reihenfolge hinge dann an der Attributreihenfolge im Markup.
 * `$watch` beobachtet stattdessen den bereits geschriebenen Wert und ist damit von dieser
 * Reihenfolge unabhängig.
 */
const createDisplayPrefs = (): DisplayPrefsState => ({
    quoteCards: readQuoteCards(),
    init(): void {
        ;(this as unknown as { $watch: (prop: string, cb: (value: boolean) => void) => void }).$watch(
            'quoteCards',
            (value: boolean) => setQuoteCardsEnabled(value),
        )
    },
})

export function wireDisplayPrefs(Alpine: { data: (name: string, factory: (...args: unknown[]) => unknown) => void }): void {
    Alpine.data('nostrDisplayPrefs', createDisplayPrefs as (...args: unknown[]) => unknown)
}
