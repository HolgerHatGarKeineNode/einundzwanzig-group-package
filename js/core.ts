/**
 * welshman-Kern: konfiguriert die globalen Singletons EINMAL app-weit.
 *
 * welshman erzeugt keine eigenen Instanzen — `repository`, `tracker`, `pubkey`,
 * `sessions` sind globale Singletons aus `@welshman/app`; konfiguriert wird über
 * die mutierbaren Kontext-Objekte (`appContext`/`netContext`/`routerContext`).
 * Genau wie der globale App-Init des Referenz-Clients (src/routes/+layout.svelte), nur ohne
 * SvelteKit. Persistenz (IndexedDB) folgt später (Fix A, M3).
 */
import { appContext } from '@welshman/app'
import { pubkey, sign } from './welshmanSession.ts'
import { loadBlockedRelayList } from './welshmanApp.ts'
import { netContext, defaultSocketPolicies, makeSocketPolicyAuth } from '@welshman/net'
import { routerContext } from '@welshman/router'
import { always } from '@welshman/lib'
import { verifyEvent, normalizeRelayUrl, type TrustedEvent } from '@welshman/util'
import { PROFILE } from './welshmanKinds.ts'
import { guardRelayQuality } from './deadRelays.ts'
import { mayProxifyMedia } from './mediaGuard.ts'
import { mayFallbackToRaw as rawFallbackAllowed } from './imageFallback.ts'
import { initStorage } from './storage.ts'
import { watchRelayNotices } from './relayNotices.ts'
import { watchRequests } from './reqWatch.ts'
import { socketPolicyAuthHold } from './authHold.ts'
import { darfAuthBekommen as authErlaubt, leseRelayListeNachsichtig } from './articleMetrics.ts'
import { initReadState } from './readState.ts'

// M3 P1: `storageReady` für die Insel re-exportieren (bridge.ts gated den Warm-Peek darauf).
export { storageReady } from './storage.ts'

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
// Geparkte Ex-Relay-Domains aus dem Routing nehmen — Begründung, Wartungsregel und
// die Grenzen der Liste stehen in `deadRelays.ts`. Muss NACH `@welshman/app` laufen,
// das `routerContext.getRelayQuality` selbst setzt (Import oben erledigt das).
routerContext.getRelayQuality = guardRelayQuality(routerContext.getRelayQuality!)
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
 * Die Relays der ARTIKEL-SOZIALSIGNALE (P6) — **die einzigen, die nie ein AUTH
 * bekommen.**
 *
 * Gelesen direkt aus `globalThis`, wie {@link WORKSPACE} darüber: `core.ts` ist das
 * Fundament, `longformFeed.ts` baut darauf auf, ein Import zurück wäre ein Zyklus.
 * Zerlegt wird über dieselbe Funktion, die auch die Artikelfläche benutzt — eine zweite
 * Parser-Regel wäre eine zweite Wahrheit über dieselbe Zeichenkette.
 *
 * ── `…Nachsichtig` und NICHT `leseRelayListe`, und das ist hier kein Detail ──────
 *
 * `normalizeRelayUrl` **wirft** bei Müll, und dieser Ausdruck steht im **Modul-Toplevel**.
 * Am Baum nachgemessen (2026-08-21): `core.ts` wird von **elf Modulen STATISCH**
 * importiert — darunter `bridge.ts`, der Einstiegspunkt — und von **keinem einzigen
 * dynamisch. Es gibt hier also nichts, was einen Wurf auffangen könnte.** Ein Tippfehler
 * in `NOSTR_ARTICLE_METRIC_RELAYS` risse damit nicht die Artikelfläche ab, sondern die
 * **gesamte Client-Insel, beim Boot, stumm.**
 *
 * **Das war eine Eindämmungs-Regression:** dieselbe Konstante lag vor dem AUTH-Riegel nur
 * in `longformFeed.ts`, und das wird ausschließlich DYNAMISCH geladen — alle vier
 * Importstellen fangen, drei davon mit sichtbarer Fehlerzeile. Dort ist der Wurf die
 * bessere Rückmeldung und bleibt deshalb; hier wäre er ein toter Client für einen
 * Konfigurationsfehler. Die Asymmetrie folgt der Eindämmung, nicht dem Geschmack —
 * ausführlich bei {@link leseRelayListeNachsichtig}.
 *
 * Der Nebeneffekt ist zugleich eine Zusage: das Set enthält **per Konstruktion nur
 * wohlgeformte Adressen**, und genau darauf stützt sich {@link darfAuthBekommen}, wenn es
 * einen unlesbaren Eintrag als abwesend behandelt.
 */
const METRIK_RELAYS = new Set(
    leseRelayListeNachsichtig((globalThis as { __nostrArticleRelays?: string }).__nostrArticleRelays),
)

/**
 * Darf dieser Relay eine AUTH-Challenge von uns beantwortet bekommen?
 *
 * ── Der Befund, gegen den das steht ────────────────────────────────────────────────
 *
 * `shouldAuth` bekommt den Socket übergeben und hat ihn bis P6 ignoriert: **jeder**
 * Relay, der eine Challenge schickt, bekam ein signiertes kind 22242 — also den Pubkey
 * des Lesers, verknüpfbar mit IP, Zeitpunkt und den angefragten Filtern. Solange der
 * Radius das Vereins-Relay war, war das der dokumentierte Handel („ponytail: aggressiv").
 * **P6 macht daraus zwei fremde Betreiber, und zwar ohne jede Nutzerhandlung:**
 * `loadArticleMetrics` hängt an `loadArticles`/`loadArticle`, beide laufen beim Mount,
 * und die Vollansicht fragt mit genau EINER Artikeladresse. Das ist die Verknüpfung von
 * Identität und Lesehistorie, frei Haus.
 *
 * ── Warum eine AUSSCHLUSSliste und keine Whitelist ────────────────────────────────
 *
 * Die naheliegende Form wäre „nur unsere eigenen Relays" — und sie ist hier **nicht
 * sicher baubar**, aus einem Grund, der im Code steht und nicht in einer Meinung: die
 * Menge der eigenen Relays ist **nicht statisch**. `userSpaceUrls` (`groups.ts`) wird aus
 * der 10009-Gruppenliste des Nutzers ABGELEITET, wächst also zur Laufzeit aus dem Netz,
 * und `setActiveSpace(url)` nimmt aus den Einstellungen jede beliebige Adresse. Eine
 * Whitelist aus den drei Config-Werten wäre für genau diese Relays unvollständig — und
 * ausgerechnet dort ist AUTH zwingend: ein zooid mit `public_read=false` liefert ohne
 * AUTH **nichts**, und der Ausfall wäre **stumm** (eine hängende AUTH-Runde verschluckt
 * das EOSE, ein Mitschnitt an `Receive` sieht es nicht).
 *
 * Die Ausschlussform ist dagegen **exakt und vollständig**: sie schließt genau den
 * Radius, den P6 geöffnet hat, und lässt jeden Bestandspfad Zeichen für Zeichen, wie er
 * war — Space, Workspace/Buzz, Board, Indexer, Signer-Relays.
 *
 * ── Und sie kostet nichts, das ist gemessen ───────────────────────────────────────
 *
 * Ein Metrik-Relay liefert öffentliche Reaktionen; für ein REQ darauf braucht niemand
 * eine Identität. Am 2026-08-21 per NIP-11 nachgesehen: `nos.lol` und `relay.damus.io`
 * (die empfohlenen Werte) führen in ihrer `limitation` **gar kein `auth_required`** —
 * sie verlangen also keins. „Meldet `false`" wäre die falsche Wiedergabe eines
 * fehlenden Felds. Fiele ein künftiges
 * Metrik-Relay unter AUTH-Zwang, lieferte es hier nichts mehr — die Zähler würden
 * kleiner, nichts bräche, und das ist die richtige Richtung für einen Zähler.
 *
 * **Und sie ist die ZWISCHENLÖSUNG, nicht das Ziel.** Ihr Preis ist, dass sie fail-OPEN
 * ist für alles, was künftig dazukommt: ein neuer Fremdrelay-Pfad bekommt AUTH, ohne dass
 * jemand etwas tut und ohne dass etwas rot wird. Tragbar, weil sie exakt den Radius
 * schließt, den P6 geöffnet hat — **die Richtung bleibt die Einschlussform über
 * `userSpaceUrls`**, siehe den `ponytail`-Vermerk unten. Dieser Punkt ist damit nicht
 * erledigt, sondern zwischengelöst.
 *
 * **Was hiermit ebenfalls NICHT behoben ist, ausdrücklich:** `INDEXER_RELAYS`,
 * `DEFAULT_RELAYS` und `SIGNER_RELAYS` sind fremd und bekommen weiterhin AUTH. Bestand
 * von vor P6, Teil desselben offenen Auftrags. Wer ihn angeht, fängt bei `userSpaceUrls`
 * an — nicht bei einer Literalliste.
 */
/**
 * Die zum Boot bekannten EIGENEN Relays — sie stechen die Metrik-Sperre.
 *
 * Aus `globalThis` und nicht aus `groups.ts`: `core.ts` ist das Fundament, `groups.ts`
 * baut darauf auf, und ein Import zurück wäre ein Zyklus mitten in den Boot-
 * Seiteneffekten dieser Datei. Dieselbe Quelle, aus der das Head-Partial sie schreibt.
 *
 * Leere Einträge fallen in `darfAuthBekommen` durch (`if (eintrag && …)`), eine fehlende
 * Konfiguration erzeugt hier also keine leere Rückausnahme.
 */
const EIGENE_RELAYS = [
    (globalThis as { __nostrSpace?: string }).__nostrSpace ?? '',
    (globalThis as { __nostrWorkspace?: string }).__nostrWorkspace ?? '',
    (globalThis as { __nostrBoard?: string }).__nostrBoard ?? '',
]

const darfAuthBekommen = (url: string): boolean => authErlaubt(url, METRIK_RELAYS, EIGENE_RELAYS)

/**
 * NIP-42-AUTH: sobald ein Signer aktiv ist, signiert welshman AUTH-Challenges
 * (kind 22242) automatisch — nötig für zooid-Spaces mit `public_read=false`.
 * Buffer/Reconnect bringt welshman über `defaultSocketPolicies` selbst mit.
 * ponytail: aggressiv (jeder AUTH-fragende Relay AUSSER den Metrik-Relais, siehe
 * {@link darfAuthBekommen}) — bei Bedarf auf eine Whitelist der Space-URLs
 * (userSpaceUrls) einschränken (Privacy, M6).
 */
// Boot-Seiteneffekte GENAU EINMAL — über einen globalThis-Guard, der auch ein
// HMR-Re-Eval dieses Moduls überlebt (ein modulweites `let` würde bei HMR neu
// erzeugt → der AUTH-Policy-Push liefe doppelt, und `initStorage` startete einen
// zweiten repository-'update'-Listener). Die Kontext-Zuweisungen oben sind reine,
// idempotente Sets → die dürfen ruhig re-laufen; nur diese zwei nicht.
//
// EINE Ausnahme, die hier falsch beschrieben stand: `getRelayQuality` wird nicht
// GESETZT, sondern UMHÜLLT (`guardRelayQuality(routerContext.getRelayQuality!)`).
// Ein HMR-Re-Eval wickelt den Wrapper in sich selbst. Die Wirkung ist harmlos —
// jede Schicht prüft dasselbe `Set` und reicht Unbekanntes durch, das Ergebnis
// bleibt gleich —, aber „idempotent" ist es nicht, und der Satz darüber hätte
// den nächsten Leser vom Nachsehen abgehalten.
const bootGuard = globalThis as { __ezGroupBooted?: boolean }
if (!bootGuard.__ezGroupBooted) {
    bootGuard.__ezGroupBooted = true
    defaultSocketPolicies.push(
        makeSocketPolicyAuth({
            sign,
            // `socket` wird ausgewertet, nicht ignoriert — die Begründung steht bei
            // {@link darfAuthBekommen}. Ohne diese Prüfung bekäme jedes konfigurierte
            // Metrik-Relay beim bloßen Öffnen einer Artikelfläche den Pubkey des Lesers.
            shouldAuth: (socket) => Boolean(pubkey.get()) && darfAuthBekommen(socket.url),
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
            void loadBlockedRelayList(pk)
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
