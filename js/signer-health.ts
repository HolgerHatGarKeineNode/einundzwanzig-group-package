/**
 * Signer-Health (NIP-46 „antwortet nicht") — abgeleitet aus welshmans globalem
 * `signerLog`. welshman hüllt JEDEN Signer (auch den NIP-46-Bunker) in
 * `wrapSigner`; jede Operation (sign/encrypt, inkl. NIP-42-AUTH) hinterlässt
 * einen Eintrag `{started_at, finished_at?, ok?}`. Ein Remote-Signer, der nicht
 * antwortet, erzeugt Einträge, die „pending" bleiben oder mit `ok:false` enden.
 *
 * Schwellen 1:1 aus `SignerStatus.svelte` des Referenz-Clients. Kein Auto-
 * Reconnect (gibt es dort auch nicht) — die UI rät zum Neu-Anmelden.
 */
import { readable, type Readable } from 'svelte/store'
import { signerLog, type SignerLogEntry } from '@welshman/app'

export type SignerHealth = 'ok' | 'slow' | 'disconnected'

const RECENT_MS = 10_000

/** Bewertet den Log-Snapshot zu genau einem Gesundheitszustand. */
const evaluate = (log: SignerLogEntry[], now: number): SignerHealth => {
    const pending = log.filter((x) => !x.finished_at)
    const recent = log.filter((x) => x.finished_at && x.finished_at > now - RECENT_MS)
    if (recent.length === 0) {
        return pending.length > 10 ? 'slow' : 'ok'
    }
    const failures = recent.filter((x) => !x.ok)
    if (failures.length === recent.length) {
        return 'disconnected'
    }
    const avg = recent.reduce((s, x) => s + (x.finished_at! - x.started_at), 0) / recent.length
    if (failures.length > 3 || avg > 1000 || pending.length > 10) {
        return 'slow'
    }
    return 'ok'
}

/**
 * Reaktiver Gesundheitszustand des aktiven Signers. Recomputet bei jeder Log-
 * Änderung UND getickt (2 s), damit ein hängender Signer auch ohne neues
 * Log-Event als `slow`/`disconnected` sichtbar wird.
 */
export const signerHealth: Readable<SignerHealth> = readable<SignerHealth>('ok', (set) => {
    const recompute = () => set(evaluate(signerLog.get(), Date.now()))
    const unsub = signerLog.subscribe(recompute)
    const tick = setInterval(recompute, 2_000)
    return () => {
        unsub()
        clearInterval(tick)
    }
})

/** Klartext-Meldung je Zustand (Deutsch, für Callout/Pill). '' = alles gut. */
export const signerHealthLabel = (health: SignerHealth): string => {
    switch (health) {
        case 'disconnected':
            return 'Signer antwortet nicht — bitte neu anmelden.'
        case 'slow':
            return 'Signer antwortet langsam …'
        default:
            return ''
    }
}
