/**
 * Pure NIP-75-Zap-Goal-Logik (kind 9041) — bewusst **welshman-app-frei** (nur
 * `@welshman/util`), damit die Getter + der Fortschritts-Vergleich als reine
 * JS-Unit ohne Browser prüfbar sind. Der publish-nahe Builder (`makeGoal`) liegt
 * in `interactions.ts`; die Render-Verdichtung (`buildGoalView`, Zap-Tally) in
 * `feeds.ts`.
 *
 * **Betrags-Konvention (ZAPS.md):** das `["amount", …]`-Tag eines Goals trägt das
 * Ziel in **Sats** (nicht Millisats) — direkt vergleichbar mit der `fromMsats`-
 * konvertierten Zap-Summe. `ponytail:` folgt der Plan-Vorgabe (Sats), nicht NIP-75s
 * msats; Upgrade-Pfad wäre eine `toMsats`-Zeile hier + im Vergleich, falls Interop
 * mit msats-Goals nötig wird.
 */
import { getTagValue, type TrustedEvent } from '@welshman/util'

/** Titel des Goals = `content` (NIP-75: Titel steht im Content, nicht in einem Tag). */
export const getGoalTitle = (event: TrustedEvent): string => event.content

/** Optionale Beschreibung aus `["summary", …]` (leer, wenn nicht gesetzt). */
export const getGoalSummary = (event: TrustedEvent): string => getTagValue('summary', event.tags) ?? ''

/** Ziel-Betrag in **Sats** aus `["amount", …]`; 0 bei fehlendem/kaputtem Wert. */
export const getGoalTargetSats = (event: TrustedEvent): number => {
    const raw = getTagValue('amount', event.tags)
    if (!raw) {
        return 0
    }
    const sats = parseInt(raw, 10)
    return Number.isFinite(sats) && sats > 0 ? sats : 0
}

/** Fortschritt eines Goals: `pct` (0–100, gedeckelt) + `reached` (Ziel erreicht?). */
export type GoalProgress = { pct: number; reached: boolean }

/**
 * Reiner Fortschritts-Vergleich: gesammelte Sats gegen das Ziel. Ohne Ziel (0)
 * kein Balken (0 %/nicht erreicht) — ein Goal ohne `amount` ist unvollständig.
 * `pct` wird **abgerundet und bei 99 gedeckelt**, solange das Ziel nicht erreicht
 * ist — sonst zeigten Balken/aria bei z.B. 999/1000 (=99,9 %) volle 100 %, während
 * „Ziel erreicht" ausbleibt (Balken widerspräche dem Status). Erst `reached` → 100.
 */
export const goalProgress = (targetSats: number, raisedSats: number): GoalProgress => {
    if (targetSats <= 0) {
        return { pct: 0, reached: false }
    }
    const reached = raisedSats >= targetSats
    return { pct: reached ? 100 : Math.min(99, Math.floor((raisedSats / targetSats) * 100)), reached }
}
