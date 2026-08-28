/**
 * Headless Buzz-Agenten im @-Autocomplete — die **unreine** Hälfte: laden,
 * live halten, ableiten. Parsen und Filtern steht in `agentDirectoryData.ts`
 * und läuft dort unter `node --test`.
 *
 * ── Zwei Riegel gegen zooid, nicht einer ────────────────────────────────────
 *
 * 1. **Hier**: es geht überhaupt erst ein REQ raus, wenn `deriveSpaceKind(url)`
 *    auf `'buzz'` steht. Auf einem zooid-Space landet also nie ein 10100 im
 *    Repository — es gibt schlicht nichts, aus dem ein Vorschlag entstehen
 *    könnte.
 * 2. **In `agentMentionItems`** (rein, getestet): auch mit gefüllten Einträgen
 *    liefert alles außer `spaceKind === 'buzz'` die leere Liste.
 *
 * Der zweite Riegel ist der belastbare — er hängt nicht daran, ob jemand später
 * eine zweite Ladestelle baut. Der erste spart nur Netz.
 *
 * ── Warum auf `'unknown'` gewartet und nicht abgebrochen wird ───────────────
 *
 * Beim Mount steht die Weiche IMMER auf `'unknown'` (NIP-11 ist unterwegs). Wer
 * das als „kein Buzz" liest, schickt nie einen REQ, und die Agenten erscheinen
 * erst nach einem Reload — die Mount-Falle aus `spaceCaps.ts`. Deshalb dasselbe
 * Warten wie in `userStatus.ts`: der Store läuft garantiert aus `'unknown'`
 * heraus (Backoff, danach `'other'`), das Warten endet also immer.
 */
import { derived, type Readable } from 'svelte/store'
import { throttled } from '@welshman/store'
import { load, request } from '@welshman/net'
import { pubkey } from './welshmanSession.ts'
import type { TrustedEvent } from '@welshman/util'
import { deriveEventsForUrl } from './repository.ts'
import { deriveSpaceKind, type SpaceKind } from './spaceCaps.ts'
import { AGENT_PROFILE, parseAgentProfiles, type AgentEntry } from './agentDirectoryData.ts'

/** Was die Fläche braucht, um Vorschläge zu bauen — in EINEM Abo. */
export type AgentDirectoryView = {
    agents: AgentEntry[]
    spaceKind: SpaceKind
    viewerPubkey: string
}

const filters = [{ kinds: [AGENT_PROFILE] }]

/**
 * Wartet, bis die Relay-Art feststeht, und meldet, ob es Buzz ist. Wortgleich
 * zum Vorbild in `userStatus.ts` (dort modul-privat); das Abmelden ist
 * zweigeteilt, weil `subscribe` synchron zurückrufen kann.
 */
const whenSpaceKindKnown = (url: string): Promise<boolean> =>
    new Promise((resolve) => {
        let settled = false
        let unsubscribe: (() => void) | null = null
        unsubscribe = deriveSpaceKind(url).subscribe((kind) => {
            if (settled || kind === 'unknown') {
                return
            }
            settled = true
            resolve(kind === 'buzz')
            unsubscribe?.()
        })
        if (settled) {
            unsubscribe()
        }
    })

/**
 * Bestand holen und live halten — beides nur auf einem Buzz-Space.
 *
 * `signal` ist der Abbruch-Griff des Raums: verlässt der Nutzer ihn, endet das
 * Abo mit ihm. Ein `limit` fehlt bewusst: 10100 ist ersetzbar (NIP-01,
 * 10000–19999), der Relay hält je Autor genau eins, und wie viele Agenten es
 * gibt, weiß der Client vorher nicht.
 */
export const listenAgentDirectory = async (url: string, signal: AbortSignal): Promise<void> => {
    if (!(await whenSpaceKindKnown(url))) {
        return
    }
    if (signal.aborted) {
        return
    }
    void load({ relays: [url], filters })
    void request({ relays: [url], signal, filters: [{ kinds: [AGENT_PROFILE], limit: 0 }] })
}

/**
 * Die Verzeichnis-Sicht eines Space: geparste Agenten + Relay-Art + eigener
 * Pubkey. Gedrosselt, weil die 10100 beim Kaltstart einzeln hereintröpfeln und
 * jeder Durchlauf alle Einträge neu parst.
 */
export const deriveAgentDirectory = (url: string): Readable<AgentDirectoryView> =>
    derived(
        [deriveSpaceKind(url), throttled(300, deriveEventsForUrl(url, filters)), pubkey],
        ([spaceKind, events, viewerPubkey]: [SpaceKind, unknown, string | null | undefined]) => ({
            agents: parseAgentProfiles(events as TrustedEvent[]),
            spaceKind,
            viewerPubkey: viewerPubkey ?? '',
        }),
    )
