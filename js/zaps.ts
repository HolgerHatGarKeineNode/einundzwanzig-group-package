/**
 * Zap-Request-/LNURL-Kern (ZAPS.md Z1, NIP-57) — dünne Orchestrierung über den
 * welshman-Zap-Layer (`@welshman/util`+`@welshman/app`, nicht neu geschrieben).
 * Löst aus einem Empfänger-Pubkey den Zapper (LNURL-pay-Metadaten) auf, baut die
 * signierte kind-9734-Zap-Request und holt beim LNURL-Callback eine bolt11.
 *
 * Portiert aus flotillas `Zap.svelte`/`ZapInvoice.svelte`/`ZapButton.svelte`.
 * Keine Zahlung (das ist Z2), keine UI (Z3). Signing bleibt 100 % im Browser; das
 * 9735-Receipt publiziert der LNURL-Server des Empfängers — nicht der EINUNDZWANZIG-
 * Server, der an diesem Pfad gar nicht beteiligt ist.
 */
import { loadZapperForPubkey, signer } from '@welshman/app'
import { makeZapRequest, requestZap, toMsats, type SignedEvent, type Zapper } from '@welshman/util'
import { Router } from '@welshman/router'

/** Standard-Zap-Kommentar (flotilla legt den Reaktions-Emoji in den 9734-`content`). */
export const DEFAULT_ZAP_CONTENT = '⚡'

/** Zapper (LNURL-pay-Metadaten) des Empfängers auflösen; undefined ohne lud16/lud06. */
export const resolveZapper = (pubkey: string): Promise<Zapper | undefined> => loadZapperForPubkey(pubkey)

/**
 * Vorabgate (flotilla `ZapButton`): Kann der Empfänger Nostr-Zaps annehmen?
 * `getZapResponseFilter` wirft ohne `nostrPubkey` — daher hier zwingend vor jedem
 * Receipt-Filter/Zap prüfen, sonst Uncaught im Sheet (Z2/Z3).
 */
export const canZap = (zapper: Zapper | undefined): zapper is Zapper =>
    Boolean(zapper?.allowsNostr && zapper.nostrPubkey)

/**
 * Empfänger-Relays fürs `["relays", …]`-Tag der 9734 (wohin das Receipt soll):
 * im Raum das Space-Relay (`url`), sonst die Router-Relays des Empfängers.
 */
export const zapRelays = (pubkey: string, url?: string): string[] =>
    url ? [url] : Router.get().ForPubkey(pubkey).getUrls()

export type ZapTemplateInput = {
    pubkey: string
    zapper: Zapper
    sats: number
    relays: string[]
    content?: string
    eventId?: string
}

/**
 * Unsignierte kind-9734-Zap-Request bauen (pure, nur `@welshman/util`). Getrennt von
 * `buildZapRequest`, damit die Tag-Form (relays/amount-msats/lnurl/p/e) als JS-Unit
 * ohne Signer/Runtime prüfbar ist. `sats*1000 = msats` (Draht = Millisats).
 */
export const zapRequestTemplate = ({ pubkey, zapper, sats, relays, content = DEFAULT_ZAP_CONTENT, eventId }: ZapTemplateInput) =>
    makeZapRequest({ pubkey, zapper, msats: toMsats(sats), relays, content, eventId })

export type ZapRequestInput = {
    pubkey: string
    zapper: Zapper
    sats: number
    content?: string
    eventId?: string
    /** Space-Relay im Raum; ohne dieses routet welshman zum Empfänger. */
    url?: string
}

/** kind-9734 bauen + im Browser signieren (Muster `session.ts` `handoffToServer`). */
export const buildZapRequest = async ({ pubkey, zapper, sats, content, eventId, url }: ZapRequestInput): Promise<SignedEvent> => {
    const activeSigner = signer.get()
    if (!activeSigner) {
        throw new Error('Kein aktiver Signer.')
    }
    return activeSigner.sign(zapRequestTemplate({ pubkey, zapper, sats, relays: zapRelays(pubkey, url), content, eventId }))
}

/**
 * Vollständiger Z1-Pfad: Zapper auflösen → 9734 bauen/signieren → LNURL-Callback →
 * bolt11. Wirft deutsche Fehler. Zahlung (`payInvoice`) + Receipt-Live-Sub folgen in
 * Z2; der `zapper` wird für den dortigen `getZapResponseFilter` mit zurückgegeben.
 */
export const createZapInvoice = async (
    input: Omit<ZapRequestInput, 'zapper'> & { zapper?: Zapper },
): Promise<{ invoice: string; event: SignedEvent; zapper: Zapper }> => {
    const zapper = input.zapper ?? (await resolveZapper(input.pubkey))
    if (!canZap(zapper)) {
        throw new Error('Dieser Empfänger kann keine Zaps annehmen.')
    }
    const event = await buildZapRequest({ ...input, zapper })
    const res = await requestZap({ zapper, event })
    if (!res.invoice) {
        throw new Error(res.error ? `Rechnung abgelehnt: ${res.error}` : 'Rechnung konnte nicht abgerufen werden.')
    }
    return { invoice: res.invoice, event, zapper }
}
