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
        if (!pubkey.get() && !location.pathname.startsWith('/nostr-login')) {
            window.location.assign('/nostr-login')
        }
    })
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
    const result = await broker.connect(connectSecret)
    const pk = await broker.getPublicKey()
    if (pk && ['ack', connectSecret].includes(result)) {
        broker.cleanup()
        loginWithNip46(pk, clientSecret, signerPubkey, broker.params.relays)
    } else {
        throw new Error('Bunker-Verbindung fehlgeschlagen.')
    }
}

/**
 * NIP-46-Berechtigungen, die der Remote-Signer (Amber) beim Verbinden gewährt —
 * begrenzt auf unseren Verein-Kern-Scope: nip44 (verschlüsselte Listen), Chat
 * (kind 9), Löschen (5), Space/Room-Liste (10009), AUTH (22242), Room-Join (9021).
 */
const NIP46_PERMS = [
    'nip44_encrypt',
    'nip44_decrypt',
    'sign_event:9',
    'sign_event:5',
    'sign_event:10009',
    'sign_event:22242',
    'sign_event:9021',
].join(',')

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
    } finally {
        broker.cleanup()
    }
}

/** CSRF-Token aus dem Meta-Tag (Laravel `web`-Middleware verlangt ihn). */
function csrfToken(): string {
    return document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')?.content ?? ''
}

/**
 * NIP-98-Handoff: signiert ein Auth-Event über die Login-URL + Server-Nonce mit
 * dem aktiven Signer und lässt Laravel die Signatur verifizieren. Der Key bleibt
 * im Browser; die Session trägt danach den beglaubigten pubkey. Gibt die
 * Ziel-URL nach erfolgreichem Login zurück.
 */
export async function handoffToServer(): Promise<string> {
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
        dropSession(pk)
    }
}
