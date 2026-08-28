/**
 * welshman-Kern: die Boot-Seiteneffekte der Insel, GENAU EINMAL.
 *
 * ── Was der 0.9.5-Sprung aus dieser Datei herausgenommen hat ─────────────────────
 * Bis 0.8.16 war das hier auch der Ort der KONFIGURATION: `repository`, `tracker`,
 * `pubkey` waren globale Singletons, eingestellt über drei mutierbare Kontextobjekte
 * (`appContext`/`netContext`/`routerContext`). Alle drei gibt es in 0.9.5 nicht mehr —
 * eine App-Instanz bekommt ihre Konfiguration bei der Konstruktion übergeben.
 *
 * Deshalb liegt die Verdrahtung jetzt eine Schicht tiefer:
 * - **`js/relayConfig.ts`** — die Relay-Listen, der Workspace und die AUTH-Regel, alle
 *   aus `globalThis` gelesen (dieselbe Quelle wie vorher).
 * - **`js/welshmanInstance.ts`** — die App-Instanz samt Policies: der kind-0-Riegel
 *   gegen den Workspace-Relay, NIP-42-AUTH, die Sperrliste toter Relay-Domains, und
 *   der Identitätswechsel.
 *
 * Hier bleibt, was echte Seiteneffekte sind: Speicher, Lesestand, Mitschnitte. Die drei
 * Relay-Listen werden weiter von hier re-exportiert, damit ihre sechs Importeure
 * unverändert bleiben.
 */
import { pubkey } from './welshmanSession.ts'
import { app, BlockedRelayLists } from './welshmanApp.ts'
import { WORKSPACE } from './relayConfig.ts'
import { mayProxifyMedia } from './mediaGuard.ts'
import { mayFallbackToRaw as rawFallbackAllowed } from './imageFallback.ts'
import { initStorage } from './storage.ts'
import { watchRelayNotices } from './relayNotices.ts'
import { watchRequests } from './reqWatch.ts'
import { initReadState } from './readState.ts'

// Die Relay-Listen liegen seit dem 0.9.5-Sprung in `relayConfig.ts` (die App-Instanz
// braucht sie, bevor diese Datei lädt — Begründung im Modulkopf). Re-Export, damit
// `emoji.ts`, `feeds.ts`, `session.ts` und `bridge.ts` unverändert bleiben.
export { INDEXER_RELAYS, DEFAULT_RELAYS, SIGNER_RELAYS } from './relayConfig.ts'

// M3 P1: `storageReady` für die Insel re-exportieren (bridge.ts gated den Warm-Peek darauf).
export { storageReady } from './storage.ts'

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
    // Medien des Workspace-Relays gehen NIE an den Server-Proxy ([[mediaGuard]]).
    // Leerer String statt Proxy-URL: die Fläche zeigt dann ihren Rückfall (Initiale,
    // Verlauf) statt eine Anfrage zu stellen, die nur 401 werden kann.
    if (!mayProxifyMedia(src, WORKSPACE)) {
        return ''
    }
    const base = isMobile ? IMG_PROXY_HOST : ''
    return `${base}/img/${preset}?src=${encodeURIComponent(src)}`
}

/**
 * P7 — Gegenstück zu `proxifyImage` für den FEHLERFALL: entscheidet, ob der
 * Zweitversuch einer <img>-Kette die ROHE URL laden darf. Die Unterscheidung
 * („Proxy konnte nicht" vs. „Ziel ist nicht proxyfähig") und ihre Begründung
 * stehen in `imageFallback.ts`; das Modul ist Import-frei, damit es unter
 * `node --test` direkt prüfbar ist — hier nur zusammengesetzt, damit Client-Code
 * beides aus demselben Ort zieht.
 *
 * Vorgeschaltet ist dieselbe Wache wie im Proxy: für ein Medium des Workspace-Relays
 * ist auch der ROHE Zweitversuch falsch (401 ohne `Authorization`), er kostet nur eine
 * Anfrage pro Gesicht.
 */
export const mayFallbackToRaw = (url: unknown): boolean => mayProxifyMedia(url, WORKSPACE) && rawFallbackAllowed(url)

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


// Boot-Seiteneffekte GENAU EINMAL — über einen globalThis-Guard, der auch ein
// HMR-Re-Eval dieses Moduls überlebt (ein modulweites `let` würde bei HMR neu
// erzeugt → `initStorage` startete einen zweiten repository-'update'-Listener).
//
// **Was hier seit dem 0.9.5-Sprung NICHT mehr steht: die Socket-Policies.** NIP-42-AUTH
// und der AUTH-Hold gingen bis 0.8.16 über den globalen `defaultSocketPolicies`-Array
// und mussten deshalb ein Boot-Seiteneffekt sein. In 0.9.5 hat jede App ihren eigenen
// Pool mit eigenen `socketPolicies`; die beiden gehören damit in die KONSTRUKTION der
// App (`js/welshmanInstance.ts`) und nicht hierher — sonst fehlten sie der App nach dem
// ersten Identitätswechsel, und zwar stumm.
const bootGuard = globalThis as { __ezGroupBooted?: boolean }
if (!bootGuard.__ezGroupBooted) {
    bootGuard.__ezGroupBooted = true
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
    // N4: offene REQs mitführen. Der Fall „`load()` ohne jede Antwort" ist nicht
    // reproduzierbar; diese Erfassung hält ihn beim nächsten Auftreten mit Kontext
    // fest, statt ihn wieder als Anekdote zu hinterlassen. Kostet fünf Zuhörer je
    // Socket und schreibt nichts — Abruf über `window.__reqWatch()`.
    watchRequests()
    // NIP-51 kind 10006: die Blocked-Relay-Liste des Nutzers. welshman honoriert sie
    // in seinem `getRelayQuality` (0 für gelistete URLs) — nur GELADEN hat sie bisher
    // niemand, die Einstellung blieb also wirkungslos. Damit kann jeder selbst ein
    // Relay sperren, portabel über Clients, ohne dass wir Zustand halten. Läuft neben
    // `deadRelays.ts`, nicht dagegen: unsere Sperre reicht Ungelistetes an genau
    // dieses `getRelayQuality` weiter. Abo statt Einmal-Aufruf, weil der pubkey beim
    // Boot noch nicht steht (localStorage-Sync in `session.ts`) und ein Login folgen kann.
    pubkey.subscribe((pk) => {
        if (pk) {
            void app.use(BlockedRelayLists).load(pk)
        }
        // Bewusst NICHT hier: die Mute-Liste (kind 10000). Sie zu laden hätte für
        // sich genommen null Wirkung — welshman filtert damit nichts, einziger
        // Leser ist `wot.js` (wotGraph), den diese App nirgends benutzt. Wirksam
        // würde erst ein Filter in jeder Ableitung, die Fremdautoren zeigt, samt
        // Thread-Semantik, `word`/`t`-Tags und dem Nachzug der NIP-44-verschlüsselten
        // privaten Einträge. Ob persönliche Mutes im moderierten Vereinsraum gelten
        // sollen (Moderation läuft hier relay-seitig: NIP-56-Report, NIP-86-Ban),
        // ist eine offene Produktfrage — geprüft am 2026-08-19 und hier notiert,
        // damit sie nicht alle paar Monate neu geprüft wird. Dasselbe gilt für
        // Follows (kind 3): laden würde über Outbox genau die toten
        // Kontaktlisten-Domains zurückholen, gegen die `deadRelays.ts` gebaut ist.
    })
}
