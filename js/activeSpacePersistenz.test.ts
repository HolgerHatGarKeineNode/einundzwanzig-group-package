/**
 * Die localStorage-Bindung von `activeSpaceUrl` (`groups.ts`) — die zwei
 * Zusicherungen, die der verzögerte `sync()` aus P2 halten muss.
 *
 * **Warum es diesen Test gibt.** Bis P2 lief `sync({key:'activeSpaceUrl', …})` im
 * Modul-Toplevel. Der Aufruf war der letzte *ungefangene* `localStorage`-Zugriff der
 * Insel und sperrte `groups.ts` samt neun abhängiger Module aus jedem reinen Test
 * aus. Er hängt jetzt am ersten Zugriff auf den Store.
 *
 * **Was dabei kippen kann.** Der erste Zugriff passiert heute im Modul-Toplevel von
 * `groups.ts` selbst: `pushSyncState.subscribe(…)` hängt über `activeSpaceView` →
 * `activeSpace` an diesem Store. Deshalb ist die gespeicherte Wahl nach dem Import
 * bereits hydriert — genau wie vorher. Verschwände dieser Abonnent (oder würde er
 * in eine Funktion verschoben), rutschte die Bindung auf den ersten Leser bei
 * `alpine:init`. Der sähe einen Microtask lang `null`, und `activeSpace` bildet
 * `null` auf den Default-Space ab: jeder Abonnent liefe einmal gegen den falschen
 * Space an (Raum-Abos, Ungelesen-Ableitung, NIP-11). Der erste Fall unten wird
 * genau dann rot.
 *
 * **Warum hier ein `localStorage`-Doppel steht und das trotzdem nicht die im Plan
 * verworfene Variante ist.** Verworfen wurde ein Stub in der *Testinfrastruktur*,
 * an dem dann jeder künftige Test hinge. Hier ist der Speicher der **Gegenstand**
 * der Prüfung — ohne ihn gäbe es nichts zu messen. Er lebt in dieser Datei und wird
 * gesetzt, bevor `groups.ts` überhaupt geladen ist; kein anderer Test sieht ihn.
 *
 * Ausführen: node --experimental-strip-types --test packages/einundzwanzig-group/js/activeSpacePersistenz.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { get } from 'svelte/store'

const KEY = 'activeSpaceUrl'
const GESPEICHERT = 'wss://buzz.einundzwanzig.space/'
const NEUE_WAHL = 'wss://group.einundzwanzig.space/'

/** Minimaler `localStorage`, nur die drei Methoden, die `@welshman/lib` anfasst. */
const daten = new Map<string, string>([[KEY, JSON.stringify(GESPEICHERT)]])
;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string): string | null => daten.get(k) ?? null,
    setItem: (k: string, v: string): void => void daten.set(k, v),
    removeItem: (k: string): void => void daten.delete(k),
}

// Bewusst NACH dem Speicher und als dynamischer Import: `groups.ts` liest die Wahl
// beim Modul-Eval, ein statischer Import liefe davor.
const { activeSpaceUrl, setActiveSpace } = await import('./groups.ts')

/**
 * **Der Kern.** Nach dem blossen Import steht die gespeicherte Wahl schon im Store —
 * ohne dass ein Leser auf irgendetwas warten müsste.
 */
test('der Import allein hydriert die gespeicherte Wahl', () => {
    assert.equal(get(activeSpaceUrl), GESPEICHERT)
})

/** Die zweite Hälfte von `sync()`: jede Änderung landet im Speicher. */
test('eine neue Wahl wird persistiert', async () => {
    // Abonnent offen halten: `get()` meldet sich sofort wieder ab, und welshmans
    // Persistenz hängt an einer laufenden Subscription.
    const stop = activeSpaceUrl.subscribe(() => {})
    setActiveSpace(NEUE_WAHL)
    // `sync()` schreibt aus einer async-Subscription — einen Tick abwarten.
    await new Promise((r) => setTimeout(r, 0))
    stop()

    assert.equal(daten.get(KEY), JSON.stringify(NEUE_WAHL))
})
