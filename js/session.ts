/**
 * Nostr-Login: Signer-Auswahl + welshman-Session. Signing bleibt zu 100 % im
 * Browser — der Server sieht später nur den (via NIP-98 verifizierten) pubkey.
 *
 * Portiert aus dem Referenz-Client (LogIn*.svelte + src/app/session.ts). welshman hält die
 * globalen Stores `pubkey`/`sessions`/`signer`; wir binden `pubkey`+`sessions`
 * an localStorage, damit der Login einen Reload überlebt. Der Signer selbst wird
 * NICHT persistiert — er wird nach Reload aus der Session rekonstruiert.
 */
import {
    pubkey,
    sessions,
    signer,
    loginWithNip01,
    loginWithNip07,
    loginWithNip46,
    dropSession,
} from '@welshman/app'
import { getNip07, Nip46Broker } from '@welshman/signer'
import { makeSecret, makeHttpAuth } from '@welshman/util'
import { sync, localStorageProvider } from '@welshman/store'
import { bytesToHex } from '@welshman/lib'
import * as nip19 from 'nostr-tools/nip19'
import { SIGNER_RELAYS, isMobile } from './core'
import { NIP46_PERMS, NIP46_PERMS_KEY, nip46PermsAreStale } from './nip46-perms'
import { installNip55WindowNostr } from './nip55-signer'
import { runScheduledPortalHandoff } from './portal-handoff'
import { clearWallet } from './wallet'

/** Bindet pubkey + sessions an localStorage. Auflösen = initialer Load fertig. */
export const authReady = Promise.all([
    sync({ key: 'pubkey', store: pubkey, storage: localStorageProvider }),
    sync({ key: 'sessions', store: sessions, storage: localStorageProvider }),
])

/**
 * Mobiles Präsenz-Gate. Auf dem Gerät kann der Server nicht per NIP-98 gaten
 * (§7) — `EnsureNostrAuth` lässt Mobile durch. Ohne dieses Gate rendert der Chat
 * mit „Abmelden"-Kopf, aber ohne Signer (leerer Screen). Also erzwingt die Insel
 * die eigene Anmeldung: kein welshman-pubkey → zurück zum Login.
 * ponytail: Pfad-Check statt Route-Flag — der Chat hat genau eine öffentliche
 * Seite (/nostr-login), und die Insel lädt nur im Chat-Layout.
 */
if (isMobile) {
    authReady.then(() => {
        const pk = pubkey.get()
        // Wiederhergestellte NIP-55-Session (Methode nip07 auf dem Gerät = unser
        // Amber-Offline-Login, echte Extension gibt es nicht) → `window.nostr`-Shim
        // installieren, BEVOR welshman den Signer für die erste Signatur rekonstruiert.
        if (pk && sessions.get()[pk]?.method === 'nip07') {
            installNip55WindowNostr()
        }
        if (!pk && !location.pathname.startsWith('/nostr-login')) {
            window.location.assign('/nostr-login')
        }
        // Single-Login: einen nach dem Login vorgemerkten Portal-Handoff hier auf
        // der stabilen Zielseite ausführen (der Shim ist oben schon installiert).
        if (pk) {
            void runScheduledPortalHandoff()
        }
    })
}

/**
 * NIP-55-Login (Amber same-device, offline): installiert den `window.nostr`-Shim
 * (ContentResolver-Bridge) und meldet welshman per NIP-07 mit dem von Amber
 * gelieferten pubkey an. Aufgerufen aus der Amber-Callback-Route, nachdem Amber
 * den Login bestätigt + die Perms gemerkt hat.
 */
export function loginWithNip55(pk: string): void {
    installNip55WindowNostr()
    loginWithNip07(pk)
}

/** NIP-07: Browser-Extension (`window.nostr`). Nur im Web verfügbar. */
export async function loginWithExtension(): Promise<void> {
    const pk = await getNip07()?.getPublicKey()
    if (!pk) {
        throw new Error('Keine NIP-07-Erweiterung gefunden (window.nostr).')
    }
    loginWithNip07(pk)
}

/**
 * nsec1… oder 64-stelliger hex-Key. UNSICHER, nur für Tests: der Key liegt im
 * Klartext im localStorage und ist für jedes XSS/kompromittierte Dependency
 * lesbar. Echte Konten nutzen NIP-07 (Extension) oder NIP-46 (Amber/Bunker).
 */
export function loginWithSecretKey(input: string): void {
    const trimmed = input.trim()
    let secret: string
    if (trimmed.startsWith('nsec1')) {
        const { type, data } = nip19.decode(trimmed)
        if (type !== 'nsec') {
            throw new Error('Ungültiger nsec-Key.')
        }
        secret = bytesToHex(data as Uint8Array)
    } else if (/^[0-9a-f]{64}$/i.test(trimmed)) {
        secret = trimmed.toLowerCase()
    } else {
        throw new Error('Bitte einen nsec1…- oder 64-stelligen hex-Key eingeben.')
    }
    loginWithNip01(secret)
}

/** NIP-46: Bunker-URI (`bunker://…`). Remote-Signer, Key verlässt den Signer nie. */
export async function loginWithBunker(bunkerUri: string): Promise<void> {
    const { signerPubkey, connectSecret, relays } = Nip46Broker.parseBunkerUrl(bunkerUri.trim())
    const clientSecret = makeSecret()
    const broker = new Nip46Broker({
        relays: relays.length ? relays : SIGNER_RELAYS,
        clientSecret,
        signerPubkey,
    })
    const result = await broker.connect(connectSecret, NIP46_PERMS)
    const pk = await broker.getPublicKey()
    if (pk && ['ack', connectSecret].includes(result)) {
        broker.cleanup()
        loginWithNip46(pk, clientSecret, signerPubkey, broker.params.relays)
        markNip46PermsFresh()
    } else {
        throw new Error('Bunker-Verbindung fehlgeschlagen.')
    }
}

function markNip46PermsFresh(): void {
    try {
        localStorage.setItem(NIP46_PERMS_KEY, NIP46_PERMS)
    } catch {
        // localStorage nicht verfügbar (Private Mode o.ä.) — Nudge bleibt dann aktiv, unkritisch.
    }
}

/**
 * Store-/localStorage-Adapter um die reine `nip46PermsAreStale`-Entscheidung: liest
 * den aktiven Signer-Typ (welshman-`sessions`) und den zuletzt gewährten Perms-String.
 * Steuert den Reconnect-Nudge (bridge.ts). Die Kernlogik liegt in nip46-perms.ts.
 */
export function nip46PermsStale(): boolean {
    const pk = pubkey.get()
    if (!pk) {
        return false
    }
    const method = sessions.get()[pk]?.method
    return nip46PermsAreStale(method, localStorage.getItem(NIP46_PERMS_KEY))
}

/**
 * NIP-46 via `nostrconnect://` (Amber-QR-Flow): Der Client erzeugt eine Connect-URL,
 * zeigt sie als QR-Code, Amber scannt und stellt die Verbindung her. Umgekehrt zum
 * `bunker://`-Flow (dort liefert der Signer die URL). `onUrl` bekommt die URL, sobald
 * sie bereit ist (→ QR rendern); das Promise löst nach erfolgreichem Login auf.
 * Abbruch (Tab-Wechsel/Unmount) über das `signal`.
 */
export async function loginWithNostrConnect(
    onUrl: (url: string) => void,
    signal: AbortSignal,
): Promise<void> {
    const clientSecret = makeSecret()
    const broker = new Nip46Broker({ clientSecret, relays: SIGNER_RELAYS })
    try {
        const url = await broker.makeNostrconnectUrl({
            name: 'EINUNDZWANZIG',
            url: window.location.origin,
            perms: NIP46_PERMS,
        })
        onUrl(url)
        const response = await broker.waitForNostrconnect(url, signal)
        const pk = await broker.getPublicKey()
        // connect() kann Relays gewechselt haben → die aktuellen des Brokers persistieren.
        loginWithNip46(pk, clientSecret, response.event.pubkey, broker.params.relays)
        markNip46PermsFresh()
    } finally {
        broker.cleanup()
    }
}

/** CSRF-Token aus dem Meta-Tag (Laravel `web`-Middleware verlangt ihn). */
function csrfToken(): string {
    return document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')?.content ?? ''
}

let handoffInFlight: Promise<string> | null = null

/**
 * NIP-98-Handoff: signiert ein Auth-Event über die Login-URL + Server-Nonce mit
 * dem aktiven Signer und lässt Laravel die Signatur verifizieren. Der Key bleibt
 * im Browser; die Session trägt danach den beglaubigten pubkey. Gibt die
 * Ziel-URL nach erfolgreichem Login zurück.
 *
 * Serialisiert: nie zwei parallele Handoffs. Auto-Reauth (bridge.ts) und ein
 * manueller Login/Reconnect könnten sonst gleichzeitig je eine Challenge holen;
 * das langsame Amber-Signieren verbreitert das Fenster, in dem der zweite GET die
 * Nonce des ersten überholt. Ein modulweites In-Flight-Promise bündelt überlappende
 * Aufrufe auf denselben Roundtrip. (Server-seitig zusätzlich per Cache-Nonce robust.)
 */
export function handoffToServer(): Promise<string> {
    return (handoffInFlight ??= doHandoff().finally(() => {
        handoffInFlight = null
    }))
}

async function doHandoff(): Promise<string> {
    const activeSigner = signer.get()
    if (!activeSigner) {
        throw new Error('Kein aktiver Signer für den Server-Login.')
    }

    const challengeRes = await fetch('/nostr/challenge', {
        headers: { Accept: 'application/json' },
    })
    if (!challengeRes.ok) {
        throw new Error('Challenge konnte nicht geladen werden.')
    }
    const { challenge, url } = (await challengeRes.json()) as { challenge: string; url: string }

    const template = await makeHttpAuth(url, 'POST')
    template.tags.push(['challenge', challenge])
    const event = await activeSigner.sign(template)

    const loginRes = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            'X-CSRF-TOKEN': csrfToken(),
        },
        body: JSON.stringify({ event }),
    })
    const data = (await loginRes.json()) as { ok?: boolean; error?: string; redirect?: string }
    if (!loginRes.ok || !data.ok) {
        throw new Error(data.error ?? 'Server-Login fehlgeschlagen.')
    }
    return data.redirect ?? '/spaces'
}

/** Beendet die Laravel-Session (Gegenstück zum NIP-98-Handoff). */
export async function logoutServer(): Promise<void> {
    await fetch('/nostr/logout', {
        method: 'POST',
        headers: { 'X-CSRF-TOKEN': csrfToken(), Accept: 'application/json' },
    })
}

/** Aktive Session beenden (Signer-Cleanup + Store leeren → localStorage folgt). */
export function logout(): void {
    const pk = pubkey.get()
    if (pk) {
        // Wallet-Secret aus der gehärteten Ablage entfernen — VOR dropSession,
        // solange pubkey.get() noch den pubkey-gebundenen Key auflöst (Z0.3).
        void clearWallet()
        dropSession(pk)
    }
}
