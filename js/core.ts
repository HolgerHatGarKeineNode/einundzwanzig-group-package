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
import { verifyEvent, normalizeRelayUrl, PROFILE, type TrustedEvent } from '@welshman/util'
import { initStorage } from './storage'
import { watchRelayNotices } from './relayNotices'
import { socketPolicyAuthHold } from './authHold'
import { initReadState } from './readState'

// M3 P1: `storageReady` für die Insel re-exportieren (bridge.ts gated den Warm-Peek darauf).
export { storageReady } from './storage'

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
 * PLAN4 IMG — Bild-Proxy-URL bauen: leitet remote Nostr-Bilder über den
 * gehosteten Zuschnitt-/WebP-Proxy (`/img/{preset}`). Web = relativ (gleicher
 * Host); Mobile = absolut gegen den festen Web-Host (die App hostet den Proxy
 * nicht).
 *
 * ── Die Erlaubnisliste steht auf der AUSNAHME, nicht auf dem Normalfall ─────────
 *
 * Hier stand `if (! /^https?:\/\//i.test(src)) return src` — „nur http(s) wird
 * proxifiziert, der Rest bleibt unangetastet". Das war der falsche Herum: alles,
 * was kein Schema trug, ging **roh** ins `src`-Attribut. Eine protokoll-relative
 * URL ist genau so ein Fall, und sie ist eine vollwertige Fremdadresse —
 * `new URL('//evil.example/p.png', 'https://group.einundzwanzig.space/articles/x')`
 * ergibt gemessen `https://evil.example/p.png`. Der Browser jedes Lesers stellte
 * dann eine direkte Anfrage an den fremden Host: IP und User-Agent, still, pro
 * Leser. Die CSP hält das nicht auf (`img-src * data: blob:`), und markdown-its
 * `validateLink` auch nicht (es sperrt `javascript:|vbscript:|file:|data:`,
 * nicht `//host`).
 *
 * **Deshalb: proxifiziert wird ALLES — außer den zwei Schemata, die gar keine
 * Fremdanfrage auslösen können.** `data:` trägt die Bytes selbst (fünf Artikel im
 * Bestand hängen daran), `blob:` zeigt auf ein Objekt im selben Dokument. Beide
 * kann der Proxy nicht holen, und beide erreichen keinen fremden Host.
 *
 * Alles andere — `//host`, `http:`, ein relativer Pfad, ein unbekanntes Schema —
 * läuft durch den Proxy und scheitert dort **sichtbar** statt still: der
 * Controller verlangt `https` plus öffentlichen Host (`isSafeUrl`,
 * `ImageProxyController:246-253`) und antwortet sonst mit 400. Ergebnis für den
 * Leser ist ein kaputtes Bild — und keine Verbindung zum Angreifer.
 *
 * `trimStart()`, weil der Browser führenden Leerraum in einem `src` ignoriert:
 * ohne ihn entschiede ein vorangestelltes Leerzeichen darüber, ob ein `data:`
 * noch als `data:` erkannt wird.
 */
const IMG_PROXY_HOST = 'https://group.einundzwanzig.space'

/** Schemata ohne Fremdanfrage — die einzige Ausnahme vom Proxy. */
const INLINE_SRC = /^(?:data|blob):/i

export function proxifyImage(url: unknown, preset = 'avatar'): string {
    const src = typeof url === 'string' ? url : ''
    if (src === '' || INLINE_SRC.test(src.trimStart())) {
        return src
    }
    const base = isMobile ? IMG_PROXY_HOST : ''
    return `${base}/img/${preset}?src=${encodeURIComponent(src)}`
}

/**
 * Wartet, bis NativePHPs POST-Shim scharf ist. **Ohne dieses Gate verliert jeder
 * frühe Bridge-Aufruf seinen Body.**
 *
 * Android kann POST-Bodies in `shouldInterceptRequest` nicht lesen; NativePHP legt
 * deshalb einen eigenen fetch/XHR-Shim darüber — aber erst in `onPageFinished`. Ein
 * `fetch` davor kommt bei Laravel mit LEEREM Body an: `$request->all()` ist leer, die
 * Antwort ist `400 MISSING_METHOD` — und weil `nativeCall` daraus einen Throw macht,
 * sieht der Aufrufer nur ein unerklärliches Fehlschlagen.
 *
 * Am Gerät gemessen (Emulator, Release-Build, 2026-07-22): der Shim wird nach ~131 ms
 * scharf, ein `AmberSigner.SignEvent` feuerte bei 111 ms und bekam
 * `{"status":"error","code":"MISSING_METHOD"}`; derselbe Aufruf nach dem Shim → HTTP 200.
 * Das Fenster trifft JEDEN Bridge-Aufruf, auch `SecureStorage.Get` (Wallet/NWC laden) —
 * dort sieht es aus, als seien die Einstellungen verschwunden.
 *
 * Polling statt Event, weil NativePHP keins anbietet. Der Timeout ist eine Notbremse:
 * lieber ein später Versuch mit unsicherem Ausgang als eine Bridge, die ewig hängt
 * (z. B. wenn eine künftige NativePHP-Version das Flag nicht mehr setzt).
 */
const POST_SHIM_TIMEOUT_MS = 10_000
const POST_SHIM_POLL_MS = 10

const postShimReady = async (): Promise<void> => {
    const shimAktiv = () => (globalThis as { __nphpPostPatched?: boolean }).__nphpPostPatched === true
    if (shimAktiv()) {
        return
    }
    const deadline = Date.now() + POST_SHIM_TIMEOUT_MS
    while (!shimAktiv() && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, POST_SHIM_POLL_MS))
    }
}

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
    // Pflicht vor JEDEM Bridge-POST — siehe postShimReady.
    await postShimReady()
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

// ZAPS.md Z1 — kein dufflepud-Proxy (Auftraggeber-Entscheidung 2026-07-10): leer
// ⇒ welshman holt LNURL-Zapper- (NIP-57) und NIP-05-Handle-Infos DIREKT aus dem
// Browser (Fallback-Zweig in `zappers.js`/`handles.js`). Trade-off: die Empfänger-
// lud16-Domain sieht die IP des Zappers; bewusst akzeptiert (keine eigene Proxy-
// Infra). Proxy nachrüsten = diese eine Zeile auf eine URL setzen.
appContext.dufflepudUrl = ''
routerContext.getIndexerRelays = always(INDEXER_RELAYS)
routerContext.getDefaultRelays = always(DEFAULT_RELAYS)
/**
 * Die Workspace-URL, normalisiert — oder `''`, wenn kein zweiter Space konfiguriert
 * ist. Bewusst direkt aus `globalThis` statt aus `groups.ts` importiert: `core.ts`
 * ist das Fundament, `groups.ts` baut darauf auf; ein Import zurück wäre ein Zyklus.
 */
const WORKSPACE = (() => {
    const raw = (globalThis as { __nostrWorkspace?: string }).__nostrWorkspace
    return raw ? normalizeRelayUrl(raw) : ''
})()

/**
 * **Kein kind-0 vom Workspace-Relay ins Repository.**
 *
 * Buzz legt beim Onboarding eigene Profile an (am Prod-Relay nachgesehen: generierte
 * Namen, eigene Bilder, Zeitstempel von heute). kind 0 ist ersetzbar, im Repository
 * gewinnt pro Pubkey der jüngste Zeitstempel — das Buzz-Profil verdrängt damit
 * app-weit das echte, denn `profilesByPubkey` hat EINE Quelle pro Pubkey.
 *
 * **Warum die Abwehr hier steht und nicht bei den Ladeaufrufen:** genau das war der
 * erste Versuch, und er reichte nicht. Es genügt nicht, kind 0 nicht mehr aktiv beim
 * Space-Relay anzufragen — welshmans `loadProfile` routet Profil-Abfragen auch zu
 * Relays, auf denen der Autor schon gesehen wurde. Wer im Workspace schreibt, WIRD
 * dort gesehen; die Anfrage geht also weiterhin an Buzz, nur über einen anderen Weg.
 * Messbar: der Test `das Buzz-Profil verdrängt das echte Nostr-Profil nicht` blieb
 * mit der Lade-Weiche allein rot, sobald er im Dateiverbund lief.
 *
 * `isEventValid` ist der EINE Punkt, durch den jedes eingehende Event geht — hier
 * greift die Regel unabhängig davon, wer die Abfrage gestellt hat. Alle anderen Kinds
 * des Workspace-Relays (Nachrichten, Räume, Mitgliederlisten) bleiben unangetastet.
 */
netContext.isEventValid = (event: TrustedEvent, url: string) => {
    if (WORKSPACE && event.kind === PROFILE && normalizeRelayUrl(url) === WORKSPACE) {
        return false
    }
    return verifyEvent(event)
}

/**
 * NIP-42-AUTH: sobald ein Signer aktiv ist, signiert welshman AUTH-Challenges
 * (kind 22242) automatisch — nötig für zooid-Spaces mit `public_read=false`.
 * Buffer/Reconnect bringt welshman über `defaultSocketPolicies` selbst mit.
 * ponytail: aggressiv (jeder AUTH-fragende Relay) — bei Bedarf auf eine
 * Whitelist der Space-URLs (userSpaceUrls) einschränken (Privacy, M6).
 */
// Boot-Seiteneffekte GENAU EINMAL — über einen globalThis-Guard, der auch ein
// HMR-Re-Eval dieses Moduls überlebt (ein modulweites `let` würde bei HMR neu
// erzeugt → der AUTH-Policy-Push liefe doppelt, und `initStorage` startete einen
// zweiten repository-'update'-Listener). Die Kontext-Zuweisungen oben sind reine,
// idempotente Sets → die dürfen ruhig re-laufen; nur diese zwei nicht.
const bootGuard = globalThis as { __ezGroupBooted?: boolean }
if (!bootGuard.__ezGroupBooted) {
    bootGuard.__ezGroupBooted = true
    defaultSocketPolicies.push(
        makeSocketPolicyAuth({
            sign,
            shouldAuth: () => Boolean(pubkey.get()),
        }),
        // Doppelte REQs während der AUTH-Runde streichen — siehe `authHold.ts`. Steht
        // NEBEN welshmans `socketPolicyAuthBuffer`, nicht an dessen Stelle: der bleibt
        // der Zustellweg, diese Policy löscht nur den ersten, ohnehin abgelehnten Versuch.
        socketPolicyAuthHold,
    )
    // M3 P1: Kaltstart-Cache aus IndexedDB in die welshman-repository spiegeln,
    // BEVOR der erste Raum öffnet (Room-init gated auf `storageReady`). Idempotent.
    initStorage()
    // P3: Lesestand (Wasserzeichen pro Raum/Thread) laden — eigene pubkey-DB, plus
    // die einmalige Migration der Alt-Keys `room:lastread:*` aus localStorage.
    // Gleicher Guard, gleiche fail-soft-Zusage wie der Cache: ein Speicherfehler
    // kostet Lesestand, nie den Chat. Gast (kein pubkey): öffnet keine DB.
    // BEWUSST hier und nicht in der Insel: der Ungelesen-Punkt hängt in der
    // App-Shell (Bottom-Nav) auf JEDER Seite, nicht nur auf denen mit Raum-Insel.
    initReadState()
    // Relay-NOTICEs mitschneiden. Sie sind das EINZIGE, was Buzz zu einem
    // ratenbegrenzt verworfenen Event sagt — ein `OK` kommt dann nie, und ohne diesen
    // Mitschnitt liefe jede betroffene Mutation in eine Zeitgrenze ohne Begründung.
    // Muss VOR der ersten Verbindung stehen, greift aber auch später (siehe Modul).
    watchRelayNotices()
}
