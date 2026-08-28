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
import { signerLog, type SignerLogEntry } from './welshmanSession.ts'
import { t } from './i18n.ts'

export type SignerHealth = 'ok' | 'slow' | 'disconnected'

const RECENT_MS = 10_000

/**
 * Eine Signer-Operation, aus dem Ereignisstrom zusammengesetzt.
 *
 * **Warum die Aggregation seit dem 0.9.5-Sprung hier steht:** welshman protokolliert
 * nicht mehr eine Zeile je Operation mit `started_at`/`finished_at`/`ok`, sondern ZWEI
 * mit derselben `id` — erst `status: 'pending'`, danach `'success'` oder `'failure'`
 * (`app/src/policy.js:104-121`). Der Ereignisstrom ist die Rohform; welche Operation als
 * hängend gilt und was „kürzlich" heisst, ist die Frage DIESER Datei und gehört deshalb
 * hierher und nicht in den Session-Adapter.
 */
type Operation = { started_at: number; finished_at?: number; ok?: boolean }

/** Die Zeilen eines Protokolls zu Operationen falten (Schlüssel ist die `id`). */
const falten = (log: SignerLogEntry[]): Operation[] => {
    const nach = new Map<string, Operation>()
    for (const zeile of log) {
        const bestand = nach.get(zeile.id)
        if (zeile.status === 'pending') {
            nach.set(zeile.id, { ...bestand, started_at: zeile.at })
        } else if (bestand) {
            bestand.finished_at = zeile.at
            bestand.ok = zeile.status === 'success'
        } else {
            // Abschluss ohne gesehenen Beginn (das Protokoll ist auf 1000 Zeilen
            // gekappt) — als Operation ohne Dauer werten, nicht verwerfen: ihr
            // Ausgang ist das, worauf es hier ankommt.
            nach.set(zeile.id, { started_at: zeile.at, finished_at: zeile.at, ok: zeile.status === 'success' })
        }
    }

    return [...nach.values()]
}

/** Bewertet den Log-Snapshot zu genau einem Gesundheitszustand. */
const evaluate = (log: SignerLogEntry[], now: number): SignerHealth => {
    const operationen = falten(log)
    const pending = operationen.filter((x) => !x.finished_at)
    const recent = operationen.filter((x) => x.finished_at && x.finished_at > now - RECENT_MS)
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
    let letzter: SignerLogEntry[] = []
    const recompute = () => set(evaluate(letzter, Date.now()))
    const unsub = signerLog.subscribe(($log) => {
        letzter = $log
        recompute()
    })
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
            return t('Signer antwortet nicht — bitte neu anmelden.')
        case 'slow':
            return t('Signer antwortet langsam …')
        default:
            return ''
    }
}
