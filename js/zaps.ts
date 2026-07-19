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
import { getTagValue, getZapResponseFilter, makeZapRequest, toMsats, type SignedEvent, type Zapper } from '@welshman/util'
import { request } from '@welshman/net'
import { uniq } from '@welshman/lib'
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

/**
 * Kann diesem Empfänger ÜBERHAUPT bezahlt werden (gültiger LNURL-Callback)? Schwächer
 * als {@link canZap}: `canZap` verlangt zusätzlich NIP-57 (`allowsNostr`+`nostrPubkey`).
 * Unterschied = „normale Lightning-Zahlung möglich" vs. „als Nostr-Zap sichtbar".
 */
export const canPay = (zapper: Zapper | undefined): zapper is Zapper => Boolean(zapper?.callback)

/**
 * LNURL-Callback + Parameter zu einer URL verbinden. Zwei Fallen, die welshmans
 * `requestZap` (`@welshman/util` Zaps.js) beide stellt und die hier bewusst geschlossen sind:
 *
 * 1. **Anfügen mit `?` ODER `&`.** LUD-06 schreibt wörtlich `<callback><?|&>amount=…` — der
 *    Callback DARF bereits einen Query-Teil tragen. Ein hart angehängtes `?` erzeugt dann eine
 *    kaputte URL und der Server sieht `amount`/`nostr` gar nicht.
 * 2. **Werte einzeln mit `encodeURIComponent`.** `encodeURI` (welshman) lässt `& = + # ? , : / $`
 *    stehen — ein Zap-Kommentar mit einem dieser Zeichen zerschneidet den `nostr=`-Parameter
 *    (Server: „invalid zap request") oder verändert still den `content` (`+` → Leerzeichen),
 *    womit die Schnorr-Signatur der 9734 nicht mehr passt (Server: „bad signature").
 *    Bewusst `encodeURIComponent` statt `URLSearchParams`: Letzteres kodiert Leerzeichen als
 *    `+`, was nur ein `x-www-form-urlencoded`-Parser richtig auflöst — `%20` verstehen beide.
 *
 * Leere Werte fallen raus (kein `&comment=`). Pure → JS-Unit-prüfbar.
 */
export const lnurlCallbackUrl = (callback: string, params: Record<string, string>): string => {
    const qs = Object.entries(params)
        .filter(([, v]) => v !== '')
        .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
        .join('&')
    return callback + (callback.includes('?') ? '&' : '?') + qs
}

/**
 * Rohe LNURL-Antwort holen und in `{invoice}` ODER `{error}` überführen.
 *
 * Bewusst KEIN `fetchJson` (welshman): reale LNURL-Server antworten im Fehlerfall mit
 * PLAIN TEXT statt LUD-06-JSON — gemessen an primal.net: HTTP 500 `error`, HTTP 406
 * `invalid zap request`, HTTP 406 `invalid zap amount`. `fetchJson` wirft dann beim
 * `JSON.parse`, `tryCatch` schluckt es, übrig bleibt „Failed to request invoice" — die
 * präzise Begründung des Servers ist weg. Also: Body als Text lesen, JSON nur VERSUCHEN,
 * und HTTP-Status + Originaltext in der Meldung führen. Keine erfundene Schuldzuweisung.
 */
const fetchInvoice = async (url: string): Promise<{ invoice?: string; error?: string }> => {
    let res: Response
    try {
        res = await fetch(url)
    } catch (e) {
        // Kommt der Request gar nicht erst raus (Offline, DNS, CORS, blockierender
        // Tracking-Schutz), ist das UNSER Ende der Leitung — nicht das des Empfängers.
        return { error: `Der Server des Empfängers war nicht erreichbar (${e instanceof Error ? e.message : String(e)}).` }
    }
    const body = (await res.text().catch(() => '')).trim()
    let json: unknown
    try {
        json = JSON.parse(body)
    } catch {
        json = undefined
    }
    const pr = (json as { pr?: unknown } | undefined)?.pr
    if (typeof pr === 'string' && pr) {
        return { invoice: pr }
    }
    return { error: invoiceRequestError(lnurlErrorReason(json) ?? body.slice(0, 200), res.status) }
}

/**
 * Kommentar auf die vom Server erlaubte Länge kürzen (LUD-12 `commentAllowed`, in Zeichen).
 * Nach CODE-POINTS kürzen (`Array.from`), nicht nach UTF-16-Einheiten: sonst zerschneidet
 * `slice(0,max)` ein astrales Emoji (Surrogate-Paar) und `encodeURIComponent` wirft URIError.
 * `0`/fehlend = Server erlaubt keinen Kommentar → leer.
 */
export const clipComment = (zapper: Zapper, comment = ''): string => {
    const max = Number((zapper as { commentAllowed?: number }).commentAllowed ?? 0)
    const c = comment.trim()
    return c && max > 0 ? Array.from(c).slice(0, max).join('') : ''
}

/**
 * Vollständige URL für einen Plain-LNURL-Pay-Callback (LUD-06/16, OHNE NIP-57): `amount`
 * in Millisats, plus `comment` falls der Server ihn erlaubt (LUD-12). Pure → JS-Unit-prüfbar.
 */
export const plainInvoiceUrl = (zapper: Zapper, sats: number, comment = ''): string =>
    lnurlCallbackUrl(zapper.callback ?? '', { amount: String(toMsats(sats)), comment: clipComment(zapper, comment) })

/**
 * Plain-LNURL-Pay OHNE 9734 (kein Nostr-Zap): holt eine bolt11 nur über amount(+comment).
 * Für Empfänger, deren Lightning-Adresse NIP-57 NICHT unterstützt (z. B. bitrefill.com).
 * Es entsteht KEIN 9735-Receipt → der Zap ist im Raum nicht sichtbar. Wirft deutsche Fehler.
 */
export const requestPlainInvoice = async ({ zapper, sats, comment }: { zapper: Zapper; sats: number; comment?: string }): Promise<string> => {
    if (!zapper.callback) {
        throw new Error('Empfänger hat keinen Zahlungs-Endpoint.')
    }
    const res = await fetchInvoice(plainInvoiceUrl(zapper, sats, comment ?? ''))
    if (!res.invoice) {
        throw new Error(res.error ?? invoiceRequestError())
    }
    return res.invoice
}

/**
 * Plain-Auto-Pay (nostrless): Rechnung holen → über das verbundene Wallet zahlen. KEIN
 * Receipt-Load (es gibt kein 9735). `deps` injizierbar für Stub-Tests (wie {@link payZapAuto}).
 */
export const payZapPlain = async (
    { zapper, sats, comment }: { zapper: Zapper; sats: number; comment?: string },
    { request: req = requestPlainInvoice, pay = walletPayInvoice }: { request?: typeof requestPlainInvoice; pay?: typeof walletPayInvoice } = {},
): Promise<void> => {
    const invoice = await req({ zapper, sats, comment })
    await pay(invoice)
}

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
 * Relays fürs `["relays", …]`-Tag der 9734 — dorthin publiziert der LNURL-Server des
 * EMPFÄNGERS das 9735-Receipt (NIP-57).
 *
 * flotilla nimmt hier `url ? [url] : Router.ForPubkey(pubkey)`, also im Raum AUSSCHLIESSLICH
 * das Space-Relay. Wir nehmen zusätzlich die Relays des Empfängers — **nicht** weil das
 * Space-Relay das Receipt abwiese (tut es nicht: zooids `OnEvent` ruft
 * `AllowRecipientEvent` VOR dem Auth-Check, und kind 9735 mit `p` auf ein Mitglied wird
 * ohne NIP-42 angenommen, `zooid/instance.go:181-206`+345), sondern weil ein einziges
 * Zielrelay ein Single Point of Failure für einen bereits BEZAHLTEN Zap ist: ist es kurz
 * weg, ist der Zap verloren, nicht nur unsichtbar. Und ein Receipt, das nur auf einem
 * geschlossenen Relay liegt, existiert für jeden anderen Client des Empfängers nicht.
 * Redundanz kostet hier nichts und ist NIP-57-üblich (`relays` ist bewusst eine Liste).
 */
export const zapRelays = (pubkey: string, url?: string): string[] => {
    const recipient = Router.get().ForPubkey(pubkey).getUrls()
    return uniq([...recipient, ...(url ? [url] : [])])
}

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
    const res = await requestZapInvoice({ zapper, event })
    if (!res.invoice) {
        throw new Error(res.error ?? invoiceRequestError())
    }
    return { invoice: res.invoice, event, zapper, relays }
}

/**
 * LNURL-Callback der 9734 (NIP-57 Schritt „zap request → invoice"). Ersetzt welshmans
 * `requestZap`, weil dessen `encodeURI`-Query den `nostr`-Parameter bei Kommentaren mit
 * `& = + #` zerstört (siehe {@link lnurlCallbackUrl}); welshman selbst bleibt unangetastet.
 * Wertet über {@link fetchInvoice} HTTP-Status UND rohen Body aus, damit die ECHTE
 * Begründung des Empfänger-Servers beim Nutzer ankommt statt eines generischen „ging nicht".
 */
export const requestZapInvoice = async ({ zapper, event }: { zapper: Zapper; event: SignedEvent }): Promise<{ invoice?: string; error?: string }> => {
    if (!zapper.callback) {
        return { error: 'Empfänger hat keinen Zahlungs-Endpoint.' }
    }
    return fetchInvoice(
        lnurlCallbackUrl(zapper.callback, {
            amount: getTagValue('amount', event.tags) ?? '',
            nostr: JSON.stringify(event),
            lnurl: zapper.lnurl,
        }),
    )
}

/**
 * Fehlergrund aus einer LNURL-Antwort ziehen. LUD-06 sieht `{status:"ERROR", reason}` vor,
 * reale Server (u. a. Alby) antworten aber auch mit `{error, message}` oder `{detail}` — ohne
 * diese Varianten fiele der echte Grund unter den Tisch und {@link invoiceRequestError} zeigte
 * nur den generischen Text. Pure → JS-Unit-prüfbar.
 */
export const lnurlErrorReason = (res: unknown): string | undefined => {
    const r = (res ?? {}) as Record<string, unknown>
    for (const key of ['reason', 'message', 'detail', 'error']) {
        const v = r[key]
        if (typeof v === 'string' && v.trim()) {
            return v.trim()
        }
    }
    return undefined
}

/**
 * Meldung, wenn der LNURL-Server des EMPFÄNGERS keine bolt11 liefert (ZAPS.md Z6).
 *
 * Gibt den Originaltext des Servers (und den HTTP-Status) weiter, statt eine Ursache zu
 * ERFINDEN. Die frühere Fassung behauptete „das Problem liegt beim Empfänger (nicht an dir,
 * deiner Wallet oder dem NWC)" — das war nachweislich falsch: der Server liefert oft eine
 * präzise Begründung (`invalid zap request`, `invalid zap amount`), die wir nur weggeworfen
 * hatten, weil sie als PLAIN TEXT statt als LUD-06-JSON kommt. Wer die Ursache nicht kennt,
 * benennt sie nicht. Pure Funktion → JS-Unit-prüfbar.
 */
export const invoiceRequestError = (rawError?: string, status?: number): string => {
    const detail = [status && status >= 400 ? `HTTP ${status}` : '', rawError?.trim()].filter(Boolean).join(': ')
    return detail
        ? `Der Server des Empfängers hat keine Rechnung ausgestellt — ${detail}`
        : 'Der Server des Empfängers hat keine Rechnung ausgestellt (ohne Begründung).'
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
 * verbundene Wallet zahlen → auf das 9735-Receipt lauschen, damit es ins lokale
 * Repository/Tally fließt (Z3). Zahlt zuerst — schlägt `pay` fehl, wird nicht auf das
 * Receipt gewartet (Reihenfolge ist der Kern des Auto-Pay). `deps` injizierbar für
 * Stub-Tests; Default = echter Z1-Pfad + echtes Wallet + welshman-`request`.
 *
 * **Abweichung 1 von flotilla — LAUSCHEN statt EINMAL LADEN.** flotilla macht direkt nach
 * `payInvoice` genau ein `await load({relays, filters})`. Das ist ein Rennen, das der Client
 * fast immer verliert: der LNURL-Server stellt das 9735 erst aus, NACHDEM die Zahlung
 * settled ist (typisch 1–3 s), `load` (`@welshman/net` `makeLoader({timeout: 3000,
 * threshold: 0.5})`, `autoClose`) kommt aber schon beim EOSE zurück — bei leerem Ergebnis
 * nach Bruchteilen einer Sekunde. Danach fragt niemand mehr nach: `bridge.ts` lädt Receipts
 * per `loadRoomZaps` nur je Nachricht EINMAL (`_zapLoadedIds`) und für 9735 gibt es keine
 * Live-Sub (kein `#h`, nicht im `listenRoom`-Filter). Ergebnis: bezahlt, aber kein ⚡-Chip
 * bis zum nächsten Reload. Darum hier dieselbe Live-Subscription wie im QR-Pfad
 * ({@link watchZapReceipt}) — EIN Mechanismus für beide Zahlwege statt zwei.
 *
 * **Abweichung 2 von flotilla — Zahlung ≠ Bestätigung.** flotilla hat `payInvoice` und
 * `load` in EINEM try/catch: kippt der Receipt-Schritt, sieht der Nutzer einen Fehler-Toast
 * trotz gezahltem Zap und zappt ein zweites Mal. Ab `pay` darf nichts mehr werfen; ob das
 * Receipt kam, ist eine SEPARATE Aussage (`receiptSeen`) für „Zap gesendet ⚡" vs.
 * „Bezahlt ⚡ — Bestätigung steht noch aus".
 */
export const payZapAuto = async (
    input: ZapPayInput,
    {
        createInvoice = createZapInvoice,
        pay = walletPayInvoice,
        subscribe = request,
    }: { createInvoice?: typeof createZapInvoice; pay?: typeof walletPayInvoice; subscribe?: typeof request } = {},
): Promise<Awaited<ReturnType<typeof createZapInvoice>> & { receiptSeen: boolean }> => {
    const result = await createInvoice(input)
    await pay(result.invoice)
    // AB HIER IST DAS GELD WEG — ab hier darf NICHTS mehr werfen.
    const receiptSeen = await awaitZapReceipt(
        { zapper: result.zapper, pubkey: input.pubkey, eventId: input.eventId, relays: result.relays },
        subscribe,
    )
    return { ...result, receiptSeen }
}

/**
 * So lange wartet der AUFRUFER auf das Receipt, bevor er „Bestätigung steht noch aus"
 * meldet (ms). Kurz gehalten: der Nutzer soll nicht auf einen fremden Server warten
 * müssen, dessen Zahlung längst durch ist. Deckt den typischen Fall (1–3 s) ab.
 */
export const RECEIPT_WAIT = 4000

/**
 * So lange lauscht die Subscription im HINTERGRUND weiter (ms), auch nachdem der Aufrufer
 * schon „steht noch aus" gemeldet hat. Trifft das Receipt später ein, landet es trotzdem
 * im Repository und der ⚡-Chip erscheint ohne Reload — genau der Fall, der vorher
 * dauerhaft verloren ging.
 */
export const RECEIPT_WINDOW = 30000

/**
 * Auf das 9735 zu einer eben bezahlten Rechnung lauschen. Löst mit `true` auf, sobald es
 * eintrifft, sonst nach {@link RECEIPT_WAIT} mit `false` — die Subscription läuft danach
 * bis {@link RECEIPT_WINDOW} weiter. Wirft nie (nach der Zahlung darf nichts mehr kippen).
 */
export const awaitZapReceipt = (
    { zapper, pubkey, eventId, relays }: Omit<WatchZapReceiptInput, 'signal' | 'onReceived'>,
    sub: typeof request = request,
): Promise<boolean> =>
    new Promise((resolve) => {
        const controller = new AbortController()
        const closeSub = setTimeout(() => controller.abort(), RECEIPT_WINDOW)
        const answer = setTimeout(() => resolve(false), RECEIPT_WAIT)
        try {
            watchZapReceipt(
                {
                    zapper,
                    pubkey,
                    eventId,
                    relays,
                    signal: controller.signal,
                    onReceived: () => {
                        clearTimeout(answer)
                        clearTimeout(closeSub)
                        controller.abort()
                        resolve(true)
                    },
                },
                sub,
            )
        } catch {
            clearTimeout(answer)
            clearTimeout(closeSub)
            resolve(false)
        }
    })

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
