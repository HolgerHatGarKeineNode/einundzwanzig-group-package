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
import { getZapResponseFilter, makeZapRequest, requestZap, toMsats, type SignedEvent, type Zapper } from '@welshman/util'
import { load, request } from '@welshman/net'
import { Router } from '@welshman/router'
import { payInvoice as walletPayInvoice } from './wallet'

/** Standard-Zap-Kommentar (flotilla legt den Reaktions-Emoji in den 9734-`content`). */
export const DEFAULT_ZAP_CONTENT = '⚡'

/**
 * Rohe Zap-Fehler (Netzwerk/Wallet/LNURL) in eine kurze, deutsche, handlungsleitende
 * Meldung übersetzen (ZAPS.md Z6). Bereits eingedeutschte Fehler aus dem Z1/Z2-Pfad
 * (createZapInvoice etc.) reicht die Funktion durch — sie mappt nur die generischen
 * Roh-Fehler von `fetch`/`NWCClient`/WebLN, die sonst englisch/kryptisch beim Nutzer
 * landen. Pure Funktion → als JS-Unit ohne Runtime prüfbar.
 */
export const mapZapError = (error: unknown): string => {
    const raw = error instanceof Error ? error.message : String(error ?? '')
    const s = raw.toLowerCase()
    if (s.includes('kein aktiver signer')) {
        return 'Bitte zuerst anmelden, um zu zappen.'
    }
    if (s.includes('failed to fetch') || s.includes('networkerror') || s.includes('load failed')) {
        return 'Zapper nicht erreichbar — bitte später erneut versuchen.'
    }
    if (s.includes('rechnung') || s.includes('lnurl') || s.includes('callback')) {
        return raw // schon deutsch aus createZapInvoice / requestZap
    }
    if (s.includes('insufficient') || s.includes('balance')) {
        return 'Zahlung fehlgeschlagen — Wallet-Guthaben reicht nicht.'
    }
    if (s.includes('reject') || s.includes('denied') || s.includes('unauthorized')) {
        return 'Wallet hat die Zahlung abgelehnt.'
    }
    if (s.includes('nullbetrag') || s.includes('webln')) {
        return raw // schon deutsch (payInvoice-Guard)
    }
    if (s.includes('kann keine zaps')) {
        return raw // schon deutsch (canZap-Gate)
    }
    return raw || 'Zap fehlgeschlagen.'
}

/** Zapper (LNURL-pay-Metadaten) des Empfängers auflösen; undefined ohne lud16/lud06. */
export const resolveZapper = (pubkey: string): Promise<Zapper | undefined> => loadZapperForPubkey(pubkey)

/** Pubkeys, deren Zapper bereits (an)geladen wurden — verhindert Reload-Spam pro Deriver-Tick. */
const warmedZappers = new Set<string>()

/**
 * Zapper der Nachrichtenautoren vorwärmen (fire-and-forget, je Pubkey genau einmal):
 * füllt welshmans `zappersByLnurl`, damit der Feed-Tally (Z3) ihre 9735-Receipts über
 * `zapFromEvent` validieren (Signer-Check) und summieren kann. `loadZapperForPubkey`
 * löst intern Profil → lnurl → Zapper auf.
 */
export const warmZappers = (pubkeys: string[]): void => {
    for (const pk of pubkeys) {
        if (!warmedZappers.has(pk)) {
            warmedZappers.add(pk)
            void loadZapperForPubkey(pk)
        }
    }
}

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

/**
 * kind-9734 bauen + im Browser signieren (Muster `session.ts` `handoffToServer`).
 * Bekommt die Ziel-`relays` fertig übergeben (statt selbst `zapRelays` zu rufen),
 * damit `createZapInvoice` denselben — für Profil-Zaps nicht-deterministischen —
 * Relay-Satz ins `relays`-Tag UND in die spätere Receipt-Subscription (Z2) legt.
 */
export const buildZapRequest = async ({ pubkey, zapper, sats, content, eventId, relays }: Omit<ZapRequestInput, 'url'> & { relays: string[] }): Promise<SignedEvent> => {
    const activeSigner = signer.get()
    if (!activeSigner) {
        throw new Error('Kein aktiver Signer.')
    }
    return activeSigner.sign(zapRequestTemplate({ pubkey, zapper, sats, relays, content, eventId }))
}

/**
 * Vollständiger Z1-Pfad: Zapper auflösen → 9734 bauen/signieren → LNURL-Callback →
 * bolt11. Wirft deutsche Fehler. Zahlung (`payInvoice`) + Receipt-Live-Sub folgen in
 * Z2; `zapper` + `relays` werden für den dortigen `getZapResponseFilter`/`load`
 * mit zurückgegeben (identischer Relay-Satz wie im 9734-`relays`-Tag).
 */
export const createZapInvoice = async (
    input: Omit<ZapRequestInput, 'zapper'> & { zapper?: Zapper },
): Promise<{ invoice: string; event: SignedEvent; zapper: Zapper; relays: string[] }> => {
    const zapper = input.zapper ?? (await resolveZapper(input.pubkey))
    if (!canZap(zapper)) {
        throw new Error('Dieser Empfänger kann keine Zaps annehmen.')
    }
    const relays = zapRelays(input.pubkey, input.url)
    const event = await buildZapRequest({ ...input, zapper, relays })
    const res = await requestZap({ zapper, event })
    if (!res.invoice) {
        throw new Error(res.error ? `Rechnung abgelehnt: ${res.error}` : 'Rechnung konnte nicht abgerufen werden.')
    }
    return { invoice: res.invoice, event, zapper, relays }
}

/**
 * Zahlweg des Zap-Buttons (ZAPS.md Z2, flotilla `ZapButton`-Router): `'info'` wenn der
 * Empfänger keine Nostr-Zaps annehmen kann, `'auto'` bei verbundenem Wallet (Z2a),
 * sonst `'invoice'` (QR-Fallback, Z2b). `canZap` (allowsNostr UND nostrPubkey) gatet,
 * weil `getZapResponseFilter` ohne `nostrPubkey` wirft.
 */
export type ZapMethod = 'info' | 'auto' | 'invoice'

export const chooseZapMethod = (zapper: Zapper | undefined, hasWallet: boolean): ZapMethod =>
    !canZap(zapper) ? 'info' : hasWallet ? 'auto' : 'invoice'

type ZapPayInput = Omit<ZapRequestInput, 'zapper'> & { zapper?: Zapper }

/**
 * Z2a Auto-Pay (flotilla `Zap.svelte` `sendZap`): Rechnung holen (Z1) → über das
 * verbundene Wallet zahlen → das 9735-Receipt **einmalig** nachladen, damit es ins
 * lokale Repository/Tally fließt (Z3). Zahlt zuerst — schlägt `pay` fehl, wird das
 * Receipt nicht geladen (Reihenfolge ist der Kern des Auto-Pay). `deps` injizierbar
 * für Stub-Tests; Default = echter Z1-Pfad + echtes Wallet + welshman-`load`.
 */
export const payZapAuto = async (
    input: ZapPayInput,
    {
        createInvoice = createZapInvoice,
        pay = walletPayInvoice,
        loadReceipt = load,
    }: { createInvoice?: typeof createZapInvoice; pay?: typeof walletPayInvoice; loadReceipt?: typeof load } = {},
): Promise<Awaited<ReturnType<typeof createZapInvoice>>> => {
    const result = await createInvoice(input)
    await pay(result.invoice)
    await loadReceipt({
        relays: result.relays,
        filters: [getZapResponseFilter({ zapper: result.zapper, pubkey: input.pubkey, eventId: input.eventId })],
    })
    return result
}

export type WatchZapReceiptInput = {
    zapper: Zapper
    pubkey: string
    eventId?: string
    /**
     * Exakt der `relays`-Satz aus `createZapInvoice` (= 9734-`relays`-Tag) — NICHT neu
     * berechnen: `zapRelays` ist für Profil-Zaps (ohne `url`) über `Router.ForPubkey`
     * nicht-deterministisch, sonst lauscht die Sub woanders als der LNURL-Server das
     * 9735 publiziert und `onReceived` feuert nie (Sheet hängt trotz Zahlung).
     */
    relays: string[]
    /** Aufrufer (Z3-Sheet) besitzt den Controller und bricht bei Close/Erfolg ab. */
    signal: AbortSignal
    onReceived: () => void
}

/**
 * Z2b QR-Fallback-Live-Sub (flotilla `ZapInvoice.svelte`): auf das 9735-Receipt zum
 * offenen Invoice lauschen und `onReceived` **genau einmal** feuern. Kein eigener
 * Abort — der Aufrufer schließt die Subscription über `signal`. `sub` injizierbar für Tests.
 */
export const watchZapReceipt = (
    { zapper, pubkey, eventId, relays, signal, onReceived }: WatchZapReceiptInput,
    sub: typeof request = request,
): void => {
    let fired = false
    sub({
        relays,
        signal,
        filters: [getZapResponseFilter({ zapper, pubkey, eventId })],
        onEvent: () => {
            if (!fired) {
                fired = true
                onReceived()
            }
        },
    })
}
