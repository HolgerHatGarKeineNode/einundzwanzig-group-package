/**
 * welshman-Kern: konfiguriert die globalen Singletons EINMAL app-weit.
 *
 * welshman erzeugt keine eigenen Instanzen — `repository`, `tracker`, `pubkey`,
 * `sessions` sind globale Singletons aus `@welshman/app`; konfiguriert wird über
 * die mutierbaren Kontext-Objekte (`appContext`/`netContext`/`routerContext`).
 * Genau wie der globale App-Init des Referenz-Clients (src/routes/+layout.svelte), nur ohne
 * SvelteKit. Persistenz (IndexedDB) folgt später (Fix A, M3).
 */
import { appContext, pubkey, sign } from '@welshman/app'
import { netContext, defaultSocketPolicies, makeSocketPolicyAuth } from '@welshman/net'
import { routerContext } from '@welshman/router'
import { always } from '@welshman/lib'
import { verifyEvent, type TrustedEvent } from '@welshman/util'

/**
 * Relay-Override für Tests/Self-Hosting: setzt `window.__nostrRelays` VOR dem
 * Laden (E2E via addInitScript) auf einen lokalen zooid. Ohne Override die
 * öffentlichen Defaults (aus dem Referenz-Client übernommen). NativePHP/Web identisch.
 */
type RelayOverride = { indexer?: string[]; default?: string[]; signer?: string[] }
const relayOverride = (globalThis as { __nostrRelays?: RelayOverride }).__nostrRelays

/**
 * Plattform-Flag der Insel: der Host setzt `window.__nostrMobile` im <head>
 * (aus `config('nativephp-internal.running')`) VOR dem Boot. Web = false.
 * Steuert das Login-Verhalten: auf dem Gerät gibt es kein NIP-98-Server-Gate
 * (§7, lokale single-user-Instanz), die Insel gated client-seitig.
 */
export const isMobile = Boolean((globalThis as { __nostrMobile?: boolean }).__nostrMobile)

/**
 * NativePHP-Mobile-Bridge: ruft eine registrierte Bridge-Function DIREKT über
 * den lokalen `/_native/api/call`-Endpoint auf — genau der Weg, den NativePHPs
 * eigenes `#nativephp`-JS-Modul intern nutzt. Bewusst OHNE Livewire-Roundtrip:
 * ein `$wire`-Call morpht/pool-t und schluckte den ersten Tap; der direkte
 * fetch feuert sofort. Nur in der nativen App (isMobile); im Web ein No-op.
 */
export async function nativeCall(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    if (!isMobile) {
        return null
    }
    const res = await fetch('/_native/api/call', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRF-TOKEN': document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') ?? '',
        },
        body: JSON.stringify({ method, params }),
    })
    const result = await res.json()
    if (result.status === 'error') {
        throw new Error(result.message || 'Native call failed')
    }
    return result.data
}

/** URL im System-Browser öffnen (verlässt die App; auch Custom-Schemes wie nostrconnect://). */
export const nativeBrowserOpen = (url: string): Promise<unknown> => nativeCall('Browser.Open', { url })

/** URL eingebettet öffnen (Android Custom Tab / iOS SFSafariViewController) — für Webseiten. */
export const nativeBrowserInApp = (url: string): Promise<unknown> => nativeCall('Browser.OpenInApp', { url })

export const INDEXER_RELAYS = relayOverride?.indexer ?? [
    'wss://purplepag.es/',
    'wss://relay.damus.io/',
    'wss://indexer.coracle.social/',
]

export const DEFAULT_RELAYS = relayOverride?.default ?? [
    'wss://relay.primal.net/',
    'wss://theforest.nostr1.com/',
    'wss://nostr.oxtr.dev/',
    'wss://nos.lol/',
]

// relay.nsec.app ist tot — dauerhaft ausgeschlossen (Anweisung).
export const SIGNER_RELAYS = relayOverride?.signer ?? [
    'wss://bucket.coracle.social/',
    'wss://relay.primal.net/',
    'wss://nos.lol/',
]

appContext.dufflepudUrl = 'https://dufflepud.coracle.social'
routerContext.getIndexerRelays = always(INDEXER_RELAYS)
routerContext.getDefaultRelays = always(DEFAULT_RELAYS)
netContext.isEventValid = (event: TrustedEvent, _url: string) => verifyEvent(event)

/**
 * NIP-42-AUTH: sobald ein Signer aktiv ist, signiert welshman AUTH-Challenges
 * (kind 22242) automatisch — nötig für zooid-Spaces mit `public_read=false`.
 * Buffer/Reconnect bringt welshman über `defaultSocketPolicies` selbst mit.
 * ponytail: aggressiv (jeder AUTH-fragende Relay) — bei Bedarf auf eine
 * Whitelist der Space-URLs (userSpaceUrls) einschränken (Privacy, M6).
 */
defaultSocketPolicies.push(
    makeSocketPolicyAuth({
        sign,
        shouldAuth: () => Boolean(pubkey.get()),
    }),
)
