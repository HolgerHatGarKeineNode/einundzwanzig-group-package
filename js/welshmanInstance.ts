/**
 * Die welshman-App-Instanz — Besitzer von Repository, Pool, Tracker und Policies.
 *
 * ── Was sich mit 0.9.5 grundlegend geändert hat ──────────────────────────────────
 * In 0.8.16 waren `repository`, `tracker`, `pubkey`, `sessions` **globale Singletons**
 * aus `@welshman/app`, konfiguriert über drei mutierbare Kontextobjekte
 * (`appContext`/`netContext`/`routerContext`). Alle drei gibt es in 0.9.5 nicht mehr.
 * Stattdessen besitzt eine **App-Instanz** diese Primitive — je Identität eine, damit
 * Daten nicht zwischen Sitzungen bluten ("so data never bleeds across sessions",
 * `app/src/app.ts`).
 *
 * ── Warum `app` hier ein Stellvertreter ist und keine Instanz ────────────────────
 * Weil unsere Identität **zur Laufzeit wechselt** und 0.9.5 dafür kein reaktives
 * Primitiv anbietet (`app.user` ist eine Property, `User.pubkey` ist `readonly`). Der
 * vorgesehene Weg ist, die App zu ERSETZEN. Täten wir das mit einem exportierten
 * `let app`, zeigte jeder bereits gehaltene Import weiter auf die tote Instanz — ES-
 * Modul-Bindungen sind zwar live, aber ein `const meineApp = app` in einer beliebigen
 * Datei wäre es nicht, und `app.repository` in 40 Aufrufstellen ist genau so ein
 * Griff.
 *
 * `app` ist deshalb ein **Objekt mit Gettern**, das jeden Zugriff an die jeweils
 * aktuelle Instanz weiterreicht. Damit bleiben alle Aufrufstellen (`app.repository`,
 * `app.use(Profiles)`, `app.tracker`) unverändert richtig — vor und nach jedem
 * Identitätswechsel. Kein `Proxy`: die Oberfläche von `IApp` ist klein und bekannt,
 * und ein handgeschriebenes Getter-Objekt ist im Debugger lesbar.
 *
 * ── Die Auflage aus Risiko R4: Halter müssen mitwandern ──────────────────────────
 * Der Stellvertreter löst nur die Zugriffe, die JEDES MAL neu lesen. Er löst NICHT die
 * Module, die sich beim Boot einmal an ein konkretes Primitiv **hängen** — ein
 * `app.tracker.on('add', …)` bleibt am alten Tracker kleben, ein `pool.subscribe(…)`
 * am alten Pool. Für die gibt es {@link beiAppWechsel}: sie registrieren ihre
 * Verdrahtung einmal, und diese Datei fährt sie nach jedem Austausch erneut, nachdem
 * die alte App abgeräumt ist.
 *
 * Angeschlossen sind darüber (Stand des Sprungs, am Baum gesucht statt geschätzt):
 * `js/storage.ts` (Tracker-Listener + Repository-Spiegelung), `js/relayNotices.ts` und
 * `js/reqWatch.ts` (beide `pool.subscribe`). Wer künftig ein weiteres Modul an
 * `repository`/`tracker`/`pool` hängt, meldet es hier an — sonst hängt es nach dem
 * ersten Login an einer toten App und **meldet nichts**.
 *
 * ── Was der Austausch kostet, und warum das vertretbar ist ───────────────────────
 * Eine neue App hat ein leeres Repository. Beim **Logout** ist das verhaltensgleich zu
 * heute: `js/session.ts:302` leert den Cache ohnehin ausdrücklich (`clearCache()`),
 * damit der nächste Boot keine member-only-Räume des alten Pubkeys re-hydratisiert.
 * Beim **Login** ist es ein Zugewinn: der Gast-Zustand bleibt nicht im Repository des
 * angemeldeten Nutzers stehen. `initStorage()` füllt aus IndexedDB nach, wie bisher.
 *
 * ── Wie oft das überhaupt passiert: gemessen, nicht geschätzt ────────────────────
 * **Fast nie im laufenden Dokument.** Am Baum nachgesehen: jeder erfolgreiche Login
 * endet in `window.location.assign(await postLoginRedirect())`
 * (`js/bridge.ts:8116,8136,8206`), jeder Logout in `window.location.assign('/nostr-login')`
 * (`js/bridge.ts:8266`, im `finally`, ausdrücklich damit „nicht der ganze Modulzustand
 * stehen bleibt"). Der Regelfall ist also ein **harter Seiten-Neustart**, bei dem diese
 * Datei ohnehin frisch lädt und die Identität aus dem localStorage rekonstruiert wird.
 *
 * Der Austausch deckt die Restfälle: den Rollback eines gescheiterten Logins
 * (`bridge.ts:8140,8213` rufen `logout()` OHNE anschließende Navigation) und alles, was
 * künftig ohne Navigation umschaltet.
 *
 * **Warum das hier steht:** wer R4 ohne diese Messung liest, hält jeden der ~40
 * `app.use(...)`-Zugriffe im Modul-Toplevel für eine tickende Bombe und baut sie
 * vorsorglich um. Sie sind es nicht — der Stellvertreter deckt die Zugriffe, und die
 * wenigen echten Halter stehen unten in der Registry.
 */
import type { Readable, Unsubscriber } from 'svelte/store'
import { readable } from 'svelte/store'
import {
    App,
    Router as Router095,
    RelayStats,
    appPolicyRelayStats,
    appPolicyWraps,
    appPolicyCacheDecrypt,
    appPolicyLogSignerMethods,
    makeAppPolicyAuth,
    type AppPolicy,
    type IApp,
    type Plugin,
    type User,
} from '@welshman/app'
import { Resolver, isDVMKind, isEphemeralKind, normalizeRelayUrl, verifyEvent, PROFILE } from '@welshman/util'
import { SocketEvent, isRelayEvent } from '@welshman/net'
import { guardRelayQuality } from './deadRelays.ts'
import { socketPolicyAuthHold } from './authHold.ts'
import { DEFAULT_RELAYS, INDEXER_RELAYS, WORKSPACE, darfAuthBekommen } from './relayConfig.ts'

/**
 * **Kein kind-0 vom Workspace-Relay ins Repository** (Risiko R3 des Sprung-Plans).
 *
 * Buzz legt beim Onboarding eigene Profile an (am Prod-Relay nachgesehen: generierte
 * Namen, eigene Bilder, Zeitstempel von heute). kind 0 ist ersetzbar, im Repository
 * gewinnt pro Pubkey der jüngste Zeitstempel — das Buzz-Profil verdrängt damit app-weit
 * das echte, denn die Profil-Sammlung hat EINE Quelle pro Pubkey.
 *
 * **Warum die Abwehr an der Ingest-Policy hängt und nicht bei den Ladeaufrufen:** genau
 * das war der erste Versuch, und er reichte nicht. Es genügt nicht, kind 0 nicht mehr
 * aktiv beim Space-Relay anzufragen — welshmans Profil-Lader routet Profil-Abfragen auch
 * zu Relays, auf denen der Autor schon gesehen wurde. Wer im Workspace schreibt, WIRD
 * dort gesehen; die Anfrage geht also weiterhin an Buzz, nur über einen anderen Weg.
 * Messbar: der Test `das Buzz-Profil verdrängt das echte Nostr-Profil nicht` blieb mit
 * der Lade-Weiche allein rot, sobald er im Dateiverbund lief.
 *
 * ── Warum diese Policy und nicht `isEventValid` ──────────────────────────────────
 * Bis 0.8.16 stand die Regel im globalen `netContext.isEventValid`. **Den Slot gibt es
 * in 0.9.5 nicht mehr** — `isEventValid` ist dort eine Option JE REQUEST
 * (`net/src/request.js:24`). Die Regel darauf zu verteilen hieße, sie an 91
 * `load`/`request`-Aufrufstellen in 16 Dateien zu hängen und den oben dokumentierten
 * Fehlschlag zu wiederholen; eine vergessene Stelle fiele still auf `verifyEvent`
 * zurück und meldete nichts.
 *
 * `appPolicyIngest` ist der Ersatz und **nachgemessen der eine Punkt**, an dem
 * empfangene Fremdevents ins Repository gehen. Die drei anderen `repository.publish`-
 * Aufrufer in 0.9.5 sind es nicht: `net/adapter.js:73` ist der `LocalAdapter` (unser
 * eigenes Senden an den lokalen Pseudo-Relay), `app/plugins/thunk.js:222,299` ist das
 * optimistische Publizieren eigener Events.
 *
 * **Die eine bekannte Lücke, benannt statt verschwiegen:** `net/wrapManager.js:42`
 * schreibt entpackte NIP-59-Rumors direkt ins Repository. Ein kind 0, das als Gift Wrap
 * vom Workspace käme, ginge daran vorbei. Das ist heute kein realer Pfad (Buzz wrappt
 * keine Profile) und war unter `isEventValid` genauso offen — der Wrap selbst wird
 * geprüft, sein Inhalt nicht. Festgehalten, damit es niemand für neu hält.
 */
const ingestMitWorkspaceRiegel: AppPolicy = (app) =>
    app.pool.subscribe((socket) => {
        const onReceive = (message: unknown) => {
            if (!isRelayEvent(message as never)) {
                return
            }
            const event = (message as [string, string, { kind: number; id: string }])[2]
            if (isDVMKind(event.kind) || isEphemeralKind(event.kind)) {
                return
            }
            // Die eine Regel, um derentwillen diese Policy existiert.
            if (WORKSPACE && event.kind === PROFILE && normalizeRelayUrl(socket.url) === WORKSPACE) {
                return
            }
            if (!verifyEvent(event as never)) {
                return
            }
            app.tracker.track(event.id, socket.url)
            app.repository.publish(event as never)
        }

        socket.on(SocketEvent.Receive, onReceive)

        return () => socket.off(SocketEvent.Receive, onReceive)
    })

/**
 * Der Relay-Router mit unserer Sperrliste für geparkte Ex-Relay-Domains.
 *
 * 0.9.5 baut den `Resolver` im Konstruktor von `Router` und speist ihn mit
 * `RelayStats.getQuality` (`app/plugins/router.js:20-23`). Genau diese Funktion hat
 * `core.ts` bis 0.8.16 über `routerContext.getRelayQuality` umhüllt. Der Platz dafür ist
 * jetzt hier: die Unterklasse ersetzt den Resolver durch einen mit demselben
 * Routen-Auflöser und umhüllter Güte-Funktion. Alles Ungelistete geht unverändert an
 * welshmans eigene Bewertung — **inklusive der Blocked-Relay-Liste des Nutzers**
 * (kind 10006), die dort einfließt.
 *
 * Kein Umhüllen des `getQuality` am `RelayStats`-Plugin selbst: das ist welshmans
 * Zustand, und ein Monkey-Patch daran gälte auch für jeden anderen Leser.
 */
export class Router extends Router095 {
    constructor(app: IApp) {
        super(app)
        this.resolver = new Resolver(this.resolveRoute, {
            getRelayQuality: guardRelayQuality((url: string) => app.use(RelayStats).getQuality(url)),
            getDefaultRelays: app.config.getDefaultRelays,
        })
    }
}

/**
 * NIP-42-AUTH: sobald ein Signer aktiv ist, signiert welshman AUTH-Challenges
 * (kind 22242) automatisch — nötig für zooid-Spaces mit `public_read=false`.
 *
 * `makeAppPolicyAuth` ist ein No-op ohne `app.user` (`app/src/policy.js:20-22`), die
 * Prüfung auf einen aktiven Pubkey erledigt es also selbst; unser Prädikat entscheidet
 * nur noch über den Relay. Ersetzt das voreingestellte `appPolicyAuthUnlessBlocked` —
 * unsere Regel ist strenger und begründet in {@link darfAuthBekommen}.
 */
const authPolicy = makeAppPolicyAuth((socket) => darfAuthBekommen(socket.url))

/**
 * Doppelte REQs während der AUTH-Runde streichen — siehe `authHold.ts`. Steht NEBEN
 * welshmans `socketPolicyAuthBuffer`, nicht an dessen Stelle: der bleibt der Zustellweg,
 * diese Policy löscht nur den ersten, ohnehin abgelehnten Versuch.
 *
 * In 0.8.16 ging das über den globalen `defaultSocketPolicies`-Array. In 0.9.5 hat jede
 * App ihren eigenen Pool mit eigenen `socketPolicies` — die Policy gehört also in die
 * Konstruktion und nicht in einen Boot-Seiteneffekt, sonst fehlte sie der App nach dem
 * ersten Identitätswechsel.
 */
const authHoldPolicy: AppPolicy = (app) => {
    app.pool.socketPolicies.push(socketPolicyAuthHold)

    return () => {
        const index = app.pool.socketPolicies.indexOf(socketPolicyAuthHold)
        if (index !== -1) {
            app.pool.socketPolicies.splice(index, 1)
        }
    }
}

/**
 * Unsere Policy-Liste. Bewusst NICHT `createApp` (das nimmt `defaultAppPolicies`):
 * zwei der sechs Voreinstellungen ersetzen wir — `appPolicyIngest` durch den
 * Workspace-Riegel (R3) und `appPolicyAuthUnlessBlocked` durch unsere engere
 * AUTH-Regel. Die übrigen vier bleiben in ihrer Reihenfolge, damit wir nicht nebenbei
 * etwas abschalten, das das Framework voraussetzt.
 *
 * ZAPS.md Z1 — kein dufflepud-Proxy (Auftraggeber-Entscheidung 2026-07-10): leer
 * ⇒ welshman holt LNURL-Zapper- (NIP-57) und NIP-05-Handle-Infos DIREKT aus dem Browser
 * (Fallback-Zweig in `zappers.js`/`handles.js`). Trade-off: die Empfänger-lud16-Domain
 * sieht die IP des Zappers; bewusst akzeptiert (keine eigene Proxy-Infra). Proxy
 * nachrüsten = diese eine Zeile auf eine URL setzen.
 */
const policies: AppPolicy[] = [
    ingestMitWorkspaceRiegel,
    appPolicyRelayStats,
    appPolicyWraps,
    appPolicyCacheDecrypt,
    appPolicyLogSignerMethods,
    authPolicy,
    authHoldPolicy,
]

const baueApp = (user?: User): App =>
    new App({
        user,
        policies,
        config: {
            dufflepudUrl: '',
            getIndexerRelays: () => INDEXER_RELAYS,
            getDefaultRelays: () => DEFAULT_RELAYS,
        },
    })

let aktuelleApp = baueApp()

/** Verdrahtungen, die an einem konkreten Primitiv hängen — siehe Modulkopf, R4. */
type Verdrahtung = { anschliessen: () => void; abbau?: Unsubscriber }
const verdrahtungen: Verdrahtung[] = []

/**
 * Ein Modul an die jeweils AKTUELLE App anschließen.
 *
 * Ruft `anschliessen` sofort auf und danach nach jedem Identitätswechsel erneut. Wer
 * einen Abräumer braucht, gibt ihn aus `anschliessen` zurück — er läuft, bevor die neue
 * App steht.
 *
 * **Für alles gedacht, was ein Primitiv FESTHÄLT**, nicht für gewöhnliche Zugriffe: ein
 * `app.repository.getEvent(id)` liest über den Stellvertreter immer die aktuelle App und
 * braucht hier nichts.
 */
export const beiAppWechsel = (anschliessen: () => Unsubscriber | void): Unsubscriber => {
    const eintrag: Verdrahtung = {
        anschliessen: () => {
            eintrag.abbau = anschliessen() ?? undefined
        },
    }
    verdrahtungen.push(eintrag)
    eintrag.anschliessen()

    // Abmelden, damit ein Store, den niemand mehr abonniert, nicht ewig in der Registry
    // stehen bleibt — sonst wüchse sie mit jedem Mount einer Fläche.
    return () => {
        eintrag.abbau?.()
        const index = verdrahtungen.indexOf(eintrag)
        if (index !== -1) {
            verdrahtungen.splice(index, 1)
        }
    }
}

/**
 * Die Identität wechseln — der 0.9.5-Weg (R4): eine App gehört genau einem Nutzer, also
 * wird sie ersetzt statt umgestellt.
 *
 * Reihenfolge, und sie ist nicht beliebig: erst die Halter abräumen (sie hängen noch an
 * den alten Primitiven), dann die alte App abräumen (`cleanup()` löst ihre Policies), dann
 * die neue setzen, dann die Halter neu anschließen. Andersherum liefe eine Verdrahtung
 * kurz doppelt oder gegen einen bereits geschlossenen Pool.
 */
export const setzeIdentitaet = (user?: User): void => {
    if (aktuelleApp.user?.pubkey === user?.pubkey && aktuelleApp.user === user) {
        return
    }
    for (const eintrag of verdrahtungen) {
        eintrag.abbau?.()
        eintrag.abbau = undefined
    }
    const alt = aktuelleApp
    aktuelleApp = baueApp(user)
    alt.cleanup()
    for (const eintrag of verdrahtungen) {
        eintrag.anschliessen()
    }
}

/**
 * Ein Store, der an ein Primitiv der jeweils aktuellen App gebunden ist.
 *
 * Für Ableitungen im Modul-Toplevel: `derived([app.use(Profiles).index.$, …])` griffe
 * den Index EINER App und bliebe nach einem Austausch am alten hängen. `appStore`
 * bindet die Ableitung stattdessen bei jedem Wechsel neu.
 *
 * Nur nötig, wo eine Store-REFERENZ festgehalten wird. Ein `app.use(X).get(k)` im
 * Funktionsrumpf liest über den Stellvertreter ohnehin die aktuelle App.
 */
export const appStore = <T>(bau: (app: IApp) => Readable<T>, leer: T): Readable<T> =>
    readable<T>(leer, (set) => {
        let inner: Unsubscriber | undefined

        return beiAppWechsel(() => {
            inner = bau(app).subscribe(set)

            return () => {
                inner?.()
                inner = undefined
            }
        })
    })

/**
 * Der Stellvertreter. Jeder Zugriff geht an die aktuelle Instanz — siehe Modulkopf.
 * `use` ist dadurch automatisch je App memoisiert, wie in 0.9.5 vorgesehen.
 */
export const app: IApp = {
    get user() {
        return aktuelleApp.user
    },
    get config() {
        return aktuelleApp.config
    },
    get netContext() {
        return aktuelleApp.netContext
    },
    get pool() {
        return aktuelleApp.pool
    },
    get tracker() {
        return aktuelleApp.tracker
    },
    get repository() {
        return aktuelleApp.repository
    },
    get wrapManager() {
        return aktuelleApp.wrapManager
    },
    use: <T>(Ctor: Plugin<T>): T => aktuelleApp.use(Ctor),
    onCleanup: (unsubscriber: Unsubscriber): void => aktuelleApp.onCleanup(unsubscriber),
}
