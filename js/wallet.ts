/**
 * Lightning-Wallet-Adapter (ZAPS.md Z0.2) — portiert aus flotillas
 * `src/app/lightning.ts`. Kapselt NWC (`@getalby/sdk`) + WebLN. Signing/Zahlung
 * bleiben 100 % im Browser; der Server ist nie im Zahlungspfad.
 *
 * Abweichung von flotilla: Das Wallet (mit `secret`) liegt NICHT in der
 * welshman-`session` (die wird als Klartext nach localStorage gesynct), sondern
 * gehärtet in `js/secure-storage.ts` unter einem pubkey-gebundenen Key. Ein
 * In-Memory-Cache vermeidet Entschlüsselung pro Aufruf.
 */
import { pubkey } from '@welshman/app'
import { fromMsats, getLnUrl, type NWCInfo, type Wallet } from '@welshman/util'
import { bech32ToHex, fetchJson } from '@welshman/lib'
import { secureGet, secureRemove, secureSet } from './secure-storage'

// Lazy-load: @getalby/sdk erst beim ersten Wallet-Gebrauch laden, gecacht (Z0.1).
let _nwcModule: Promise<typeof import('@getalby/sdk')> | null = null
export const getNwcModule = () => (_nwcModule ??= import('@getalby/sdk'))

const walletKey = (pk: string) => `einundzwanzig:wallet:${pk}`

// In-Memory-Cache des entschlüsselten Wallets, pubkey-scoped. Der `secret` liegt
// nur hier (RAM) + verschlüsselt at-rest — nie im Klartext-Store.
let _cache: { pk: string; wallet: Wallet | null } | null = null

/** Verbundenes Wallet des aktiven pubkeys laden (oder null). */
export async function loadWallet(): Promise<Wallet | null> {
    const pk = pubkey.get()
    if (!pk) {
        return null
    }
    if (_cache?.pk === pk) {
        return _cache.wallet
    }
    const raw = await secureGet(walletKey(pk))
    const wallet = raw ? (JSON.parse(raw) as Wallet) : null
    _cache = { pk, wallet }
    return wallet
}

/** Wallet gehärtet ablegen (Mobile Keystore / Web WebCrypto at-rest). */
export async function saveWallet(wallet: Wallet): Promise<void> {
    const pk = pubkey.get()
    if (!pk) {
        throw new Error('Nicht angemeldet.')
    }
    await secureSet(walletKey(pk), JSON.stringify(wallet))
    _cache = { pk, wallet }
}

/** Wallet entfernen (bei Trennen/Logout). */
export async function clearWallet(): Promise<void> {
    const pk = pubkey.get()
    if (pk) {
        await secureRemove(walletKey(pk))
    }
    _cache = null
}

export const getWebLn = () => (window as { webln?: WebLNProvider }).webln

/** Frischer NWCClient aus dem entschlüsselten Wallet (flotilla-Muster, kein Cache). */
export const getNwcClient = async () => {
    const wallet = await loadWallet()
    if (!wallet || wallet.type !== 'nwc') {
        throw new Error('Kein NWC-Wallet verbunden')
    }
    const { nwc } = await getNwcModule()
    // `info` = gespeicherte `client.options` ({relayUrl, walletPubkey, secret, lud16}).
    // Der NWCClient-Konstruktor akzeptiert diese Felder direkt (oder eine
    // nostrWalletConnectUrl, falls je vorhanden) — ein Aufruf deckt beides.
    return new nwc.NWCClient(wallet.info)
}

// NWC = MILLISATS, WebLN = SATS. `msats` nur bei betragsloser Rechnung setzen.
export const payInvoice = async (invoice: string, msats?: number) => {
    const wallet = await loadWallet()
    if (!wallet) {
        throw new Error('Kein Wallet verbunden')
    }
    if (wallet.type === 'nwc') {
        const params: { invoice: string; amount?: number } = { invoice }
        if (msats) {
            params.amount = msats
        }
        return (await getNwcClient()).payInvoice(params)
    }
    if (msats) {
        throw new Error('WebLN kann keine Nullbetrag-Rechnung zahlen')
    }
    const webln = getWebLn()
    if (!webln) {
        throw new Error('WebLN nicht verfügbar')
    }
    await webln.enable()
    return webln.sendPayment(invoice)
}

/** Empfangs-Rechnung erzeugen. NWC: makeInvoice(msats); WebLN: makeInvoice(sats). */
export const createInvoice = async ({
    sats,
    description = 'Empfangen via Lightning',
}: {
    sats: number
    description?: string
}): Promise<string> => {
    const wallet = await loadWallet()
    if (!wallet) {
        throw new Error('Kein Wallet verbunden')
    }
    const amount = Math.floor(sats)
    if (!Number.isFinite(amount) || amount <= 0) {
        throw new Error('Ungültiger Sats-Betrag')
    }
    if (wallet.type === 'nwc') {
        const res = await (await getNwcClient()).makeInvoice({ amount: amount * 1000, description })
        if (!res.invoice) {
            throw new Error('Wallet lieferte keine Rechnung')
        }
        return res.invoice
    }
    const webln = getWebLn()
    if (!webln) {
        throw new Error('WebLN nicht verfügbar')
    }
    await webln.enable()
    const res = await webln.makeInvoice({ amount, defaultMemo: description })
    const pr = typeof res === 'string' ? res : res?.paymentRequest || res?.pr || ''
    if (!pr) {
        throw new Error('Ungültige Rechnung von WebLN')
    }
    return pr
}

export const getWalletBalance = async () => (await getNwcClient()).getBalance() // { balance } in msats

/**
 * lud16/LNURL → bolt11 über LNURL-pay (plain, KEIN Nostr-Zap — das ist Z1).
 * Direkter Fetch (kein dufflepud, Auftraggeber-Entscheidung) für das „Senden an
 * Adresse" der Wallet-Seite.
 */
export const lnurlInvoice = async (address: string, sats: number): Promise<string> => {
    const lnurl = getLnUrl(address.trim())
    if (!lnurl) {
        throw new Error('Keine gültige Lightning-Adresse')
    }
    const meta = await fetchJson(bech32ToHex(lnurl))
    if (!meta?.callback) {
        throw new Error('Lightning-Adresse antwortet nicht')
    }
    const msats = sats * 1000
    if (meta.minSendable && msats < meta.minSendable) {
        throw new Error('Betrag zu klein für diese Adresse')
    }
    if (meta.maxSendable && msats > meta.maxSendable) {
        throw new Error('Betrag zu groß für diese Adresse')
    }
    const sep = meta.callback.includes('?') ? '&' : '?'
    const res = await fetchJson(`${meta.callback}${sep}amount=${msats}`)
    if (!res?.pr) {
        throw new Error(res?.reason || 'Keine Rechnung erhalten')
    }
    return res.pr as string
}

/** Sats aus msats fürs UI (welshman-Reexport zur Bequemlichkeit). */
export { fromMsats }

/** Schmale WebLN-Provider-Typen (window.webln bringt keine Typen mit). */
type WebLNProvider = {
    enable: () => Promise<void>
    getInfo: () => Promise<{ methods?: string[]; supports?: string[]; version?: string; node?: { alias: string } }>
    sendPayment: (invoice: string) => Promise<{ preimage: string }>
    makeInvoice: (args: {
        amount: number
        defaultMemo?: string
    }) => Promise<string | { paymentRequest?: string; pr?: string }>
}

export type { NWCInfo }
