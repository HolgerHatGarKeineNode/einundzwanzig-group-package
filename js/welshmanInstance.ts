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
 * ── Die Auflage aus Risiko R4, und was die Messung daraus gemacht hat ───────────
 * Der Plan sah vor, die App bei Login/Logout zu ERSETZEN — der von 0.9.5 vorgesehene
 * Weg. **Gemessen ist das für uns falsch, siehe {@link setzeIdentitaet}:** der Wechsel
 * fällt schon beim Boot an (localStorage-Hydrierung), und jede Ableitung, die ein Modul
 * im Toplevel gebaut hat, hinge danach an der alten, leeren Instanz. In der E2E-Suite
 * waren das 172 fehlgeschlagene Fälle.
 *
 * Stattdessen wird `app.user` gesetzt. Die Instanz bleibt, Repository, Pool und Tracker
 * bleiben — es gibt also nichts, was „mitwandern" müsste.
 *
 * {@link beiAppWechsel} bleibt trotzdem — aber als das, was es ist, und nicht als das,
 * was hier bis zum 2026-08-29 stand. Der alte Text nannte `js/storage.ts` (Tracker-
 * Listener), `js/relayNotices.ts` und `js/reqWatch.ts` als angemeldet. **Nachgezählt: 0,
 * 0 und 0.** Keine dieser Dateien nennt `beiAppWechsel` oder `appStore` auch nur einmal;
 * sie greifen direkt auf `app` zu. Die Liste war nie richtig, und weil sie konkret klang,
 * hätte sie einen späteren Instanzwechsel gerade dort in Sicherheit gewiegt, wo er
 * gefährlich ist.
 *
 * Der gemessene Stand: `beiAppWechsel` hat **keinen** direkten Aufrufer außerhalb dieser
 * Datei. Sein einziger Nutzer ist {@link appStore} hier im Modul, und das wiederum nutzen
 * genau zwei Dateien — `js/welshmanApp.ts` (`userProfile`) und `js/welshmanSession.ts`
 * (der Signer-Log-Store). Beide halten einen App-EIGENEN Index fest, und für die ist die
 * Umleitung richtig.
 *
 * Was daraus folgt: Der Mechanismus feuert heute genau einmal, beim Start, und niemand
 * hängt an ihm, der es nötig hätte. Er bleibt, weil `appStore` ihn braucht — nicht, weil
 * eine Liste festgehaltener Primitive dranhinge. Wer je einen echten Instanzwechsel baut,
 * muss die Aufrufer von `app.tracker.on(…)` und `pool.subscribe(…)` selbst suchen; dieser
 * Docblock nimmt ihm das ausdrücklich nicht ab.
 *
 */
import type { Readable, Unsubscriber } from 'svelte/store'
import { readable } from 'svelte/store'
import {
    App,
    Router as Router095,
    RelayStats,
    appPolicyRelayStats,
    appPolicyCacheDecrypt,
    appPolicyLogSignerMethods,
    User,
    type AppPolicy,
    type IApp,
    type Plugin,
} from '@welshman/app'
import {
    Resolver,
    addMinimalFallbacks,
    isDVMKind,
    isEphemeralKind,
    normalizeRelayUrl,
    verifyEvent,
    PROFILE,
} from '@welshman/util'
import { SocketEvent, isRelayEvent, makeSocketPolicyAuth } from '@welshman/net'
import { guardRelayQuality } from './deadRelays.ts'
import { socketPolicyAuthHold } from './authHold.ts'
import { DEFAULT_RELAYS, INDEXER_RELAYS, WORKSPACE, WORKSPACE_ROH, darfAuthBekommen } from './relayConfig.ts'

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
/**
 * ── Die Konsolenwarnung, die den Riegel oben vor stillem Ausfall bewahrt ────────
 *
 * `WORKSPACE` ist `''` in ZWEI Lagen, die nichts miteinander zu tun haben: „kein
 * Workspace konfiguriert" (Normalfall, alles richtig) und „konfiguriert, aber die URL war
 * unbrauchbar" (Betriebsfehler). Seit die Normalisierung nachsichtig ist
 * (`js/relayConfig.ts normalisiereWorkspaceUrl`), sieht der zweite Fall aus wie der erste:
 * der Workspace-Tab fehlt, der kind-0-Riegel unten greift nie, und niemand erfährt es.
 *
 * Genau das ist der stille Ausfall, den der Wurf vorher verhindert hat — um den Preis,
 * die ganze Insel mitzunehmen. Die Warnung kauft die Diagnose zurück, ohne den Preis.
 *
 * Zwei gemeldete Lagen:
 *
 *   (A) Rohwert gesetzt, `WORKSPACE` leer  → die URL ist unbrauchbar. Einmalig beim
 *       Aufbau der Policy, weil dieser Fall keinen Socket braucht, um wahr zu sein.
 *   (B) Rohwert gesetzt, `WORKSPACE` steht, aber ein OFFENER Socket trägt denselben Host
 *       und eine andere normalisierte URL. Dann spricht die Fläche mit dem Workspace,
 *       während der Riegel auf eine andere Schreibweise vergleicht und durchlässt.
 *       Nur mit Socket entscheidbar, deshalb im Empfangspfad.
 *
 * Beide je einmal pro Seitenaufruf: eine Warnung, die pro Event feuert, ist keine.
 */
let workspaceWarnungA = false
let workspaceWarnungB = false

const hostVon = (url: string): string => {
    try {
        return new URL(url).host
    } catch {
        return ''
    }
}

/**
 * Ist dieser Socket der Workspace-Relay? **Verglichen wird der HOST, nicht die ganze URL.**
 *
 * Bis P4 stand hier `normalizeRelayUrl(socket.url) === WORKSPACE`, und das ließ eine Lage
 * offen, die gemessen wurde: gleicher Host, andere Schreibweise — etwa der Workspace als
 * `wss://buzz.example/` konfiguriert, die Verbindung aber gegen `wss://buzz.example/nostr`.
 * Dann verglich der Riegel zwei verschiedene Zeichenketten, ließ das kind 0 durch, und der
 * Workspace-Relay konnte app-weit Profile verdrängen — genau das, was diese Policy
 * verhindern soll. Gemeldet wurde es nur in der Konsole, und eine Konsolenwarnung ist per
 * Konstruktion kein Gate.
 *
 * **Der Preis ist bekannt und gewollt:** ein FREMDER Relay, der zufällig auf demselben Host
 * unter einem anderen Pfad läuft, verliert damit ebenfalls seine kind-0-Zustellung. Das ist
 * die richtige Richtung — derselbe Host heißt derselbe Betreiber, und die Vertrauensfrage
 * ist dieselbe. Nachgezählt an der geltenden Konfiguration: **kein** eingetragener Relay
 * teilt seinen Host mit einem anderen, der Fall tritt heute also nicht ein.
 *
 * Verglichen wird `host` und nicht `hostname`: ein anderer Port ist ein anderer Dienst und
 * soll nicht mitgerissen werden. Ein leerer Host (kaputte URL) trifft nie.
 */
const istWorkspaceSocket = (socketUrl: string): boolean => {
    if (!WORKSPACE) {
        return false
    }

    const ziel = hostVon(WORKSPACE)

    return ziel !== '' && hostVon(normalizeRelayUrl(socketUrl)) === ziel
}

const meldeWorkspaceUnbrauchbar = (): void => {
    if (workspaceWarnungA || !WORKSPACE_ROH || WORKSPACE) {
        return
    }

    workspaceWarnungA = true
    console.warn(
        '[nostr] Workspace konfiguriert, aber unbrauchbar: window.__nostrWorkspace = ' +
            JSON.stringify(WORKSPACE_ROH) +
            ' ergibt keine gültige Relay-URL. Der Workspace-Tab bleibt aus, und der ' +
            'kind-0-Riegel gegen den Workspace-Relay greift nicht. Zu prüfen: ' +
            "config('group.workspace_url') bzw. NOSTR_WORKSPACE_URL.",
    )
}

const meldeWorkspaceAbweichung = (socketUrl: string): void => {
    if (workspaceWarnungB || !WORKSPACE) {
        return
    }

    const normalisiert = normalizeRelayUrl(socketUrl)

    if (normalisiert === WORKSPACE) {
        return
    }

    const host = hostVon(normalisiert)

    if (!host || host !== hostVon(WORKSPACE)) {
        return
    }

    workspaceWarnungB = true
    console.warn(
        '[nostr] Workspace-Relay unter abweichender Schreibweise in Benutzung: Socket ' +
            JSON.stringify(normalisiert) +
            ' vs. konfiguriert ' +
            JSON.stringify(WORKSPACE) +
            ' (Rohwert ' +
            JSON.stringify(WORKSPACE_ROH) +
            '). Der kind-0-Riegel greift trotzdem — er vergleicht den Host. Die ' +
            'Konfiguration sollte auf die tatsächlich verwendete URL nachgezogen werden, ' +
            'sonst zeigen Relay-Auswahl und Riegel auf verschiedene Adressen.',
    )
}

const ingestMitWorkspaceRiegel: AppPolicy = (app) => {
    meldeWorkspaceUnbrauchbar()

    return app.pool.subscribe((socket) => {
        const onReceive = (message: unknown) => {
            if (!isRelayEvent(message as never)) {
                return
            }
            const event = (message as [string, string, { kind: number; id: string }])[2]
            if (isDVMKind(event.kind) || isEphemeralKind(event.kind)) {
                return
            }
            // Die eine Regel, um derentwillen diese Policy existiert.
            if (event.kind === PROFILE) {
                meldeWorkspaceAbweichung(socket.url)

                if (istWorkspaceSocket(socket.url)) {
                    return
                }
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
}

/**
 * Der Relay-Auflöser der App — **mit unserer Sperrliste UND einer Rückfallebene.**
 *
 * Eine Policy und keine `Router`-Unterklasse, und der Grund ist der halbe Nutzen:
 * `app.use(X)` memoisiert nach Konstruktor-Identität. Eine Unterklasse bekäme nur, wer
 * sie ausdrücklich anfordert — welshman selbst löst intern `app.use(Router)` auf
 * (`plugins/network.js loadUsingOutbox`, `plugins/profiles.js`, jeder Writer). Unsere
 * Sperre hätte für genau die Pfade nicht gegolten, für die sie gebaut ist.
 *
 * ── Zwei Dinge werden hier gesetzt ───────────────────────────────────────────────
 *
 * **1. `getRelayQuality` mit der Sperrliste geparkter Ex-Relay-Domains.** Das ist der
 * Ersatz für `routerContext.getRelayQuality`, den `core.ts` bis 0.8.16 umhüllte.
 * Begründung, Wartungsregel und Grenzen stehen in `deadRelays.ts`. Alles Ungelistete
 * geht unverändert an welshmans eigene Bewertung — inklusive der Blocked-Relay-Liste
 * des Nutzers (kind 10006).
 *
 * **2. `policy: addMinimalFallbacks` — und das ist ein REGRESSIONSFIX, kein Geschmack.**
 * Die Rümpfe gegeneinander gelesen:
 *
 *     0.8.16  `relayLists.js loadUsingOutbox`:
 *             Router.FromRelays(writeRelays).policy(addMinimalFallbacks).limit(8).getUrls()
 *     0.9.5   `network.js loadUsingOutbox`:
 *             (await Router.resolve([...relays(hints), outbox(pubkey)])).getUrls()
 *
 * 0.9.5 verlässt sich auf die Voreinstellung von `RelayScenario`, und die ist
 * `addNoFallbacks` (`util/src/RelaySelection.js:42`). **Ein Autor ohne kind-10002-Liste
 * hat damit gar keine Relays, und sein Profil wird nie geladen.** Gemessen in der
 * E2E-Suite: die NIP-05-Häkchen blieben aus, weil `Handles.loadForPubkey` auf
 * `Profiles.load` wartet und das leer zurückkam; ebenso die Zap- und
 * Lightning-Einstiege, die am `lud16` aus demselben Profil hängen.
 *
 * `addMinimalFallbacks` fügt **genau einen** Default-Relay hinzu, und nur wenn sonst
 * nichts übrig bliebe — es weitet also keine Auswahl, die ohnehin trägt. Das Limit
 * bleibt bei der 0.9.5-Voreinstellung (3); die 8 von 0.8.16 galten nur für diesen einen
 * Lader, nicht für jede Auswahl.
 */
const resolverPolicy: AppPolicy = (app) => {
    const router = app.use(Router095)
    const original = router.resolver
    router.resolver = new Resolver(router.resolveRoute, {
        getRelayQuality: guardRelayQuality((url: string) => app.use(RelayStats).getQuality(url)),
        getDefaultRelays: app.config.getDefaultRelays,
        policy: addMinimalFallbacks,
    })

    return () => {
        router.resolver = original
    }
}

/**
 * NIP-42-AUTH: sobald ein Signer aktiv ist, signiert welshman AUTH-Challenges
 * (kind 22242) automatisch — nötig für zooid-Spaces mit `public_read=false`.
 *
 * **Bewusst NICHT `makeAppPolicyAuth`**, so nah es läge: das prüft `app.user` EINMAL bei
 * der Konstruktion und gibt ohne Nutzer ein `noop` zurück (`app/src/policy.js:20-22`).
 * Unsere App entsteht beim Modul-Eval, und da ist noch niemand angemeldet — der
 * Pubkey kommt erst einen Microtask später aus dem localStorage. Die Policy wäre also
 * für die ganze Sitzung tot, und zwar **stumm**: ein zooid mit `public_read=false`
 * lieferte einfach nichts.
 *
 * Diese Fassung liest den Nutzer bei JEDER Challenge neu. Ersetzt zugleich das
 * voreingestellte `appPolicyAuthUnlessBlocked` — unsere Relay-Regel ist strenger und
 * begründet in {@link darfAuthBekommen}.
 */
const authPolicy: AppPolicy = (app) => {
    const policy = makeSocketPolicyAuth({
        sign: (event) => User.require(app).sign(event),
        shouldAuth: (socket) => Boolean(app.user) && darfAuthBekommen(socket.url),
    })
    app.pool.socketPolicies.push(policy)

    return () => {
        const index = app.pool.socketPolicies.indexOf(policy)
        if (index !== -1) {
            app.pool.socketPolicies.splice(index, 1)
        }
    }
}

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
 * Workspace-Riegel (R3) und `appPolicyAuthUnlessBlocked` durch unsere engere AUTH-Regel.
 *
 * ── `appPolicyWraps` fehlt hier ABSICHTLICH, und das ist kein Versehen ───────────
 * Sie stand kurzzeitig mit in der Liste, aus der Überlegung, „nicht nebenbei etwas
 * abzuschalten, das das Framework voraussetzt". **Diese Überlegung deckt das
 * Abschalten, nicht das Einschalten** — und hier wäre es ein Einschalten gewesen:
 * unter 0.8.16 gab es bei uns keine NIP-59-Entpackung, `core.ts` des Vorstands kennt
 * weder `Wraps` noch `Nip59`. Paketweit gibt es **null** Treffer für `1059`, `WRAP`,
 * `Nip59` oder `Wraps` ausserhalb dieser Datei; wir haben schlicht kein Gift-Wrap-Feature.
 *
 * **Was sie gekostet hätte, an der echten App-Instanz gemessen:** `isRelayEvent` prüft
 * nur `m[0] === "EVENT"`, nicht die Subscription-ID — jeder verbundene Relay kann also
 * ein korrekt signiertes kind 1059 mit unserem `p`-Tag schieben, ohne dass wir gefragt
 * haben. Der Ingest publiziert es, `appPolicyWraps` reicht es an `Wraps.enqueue`, und
 * das entschlüsselt **am Signer des Nutzers**. Gemessen: 25 unaufgeforderte Wraps →
 * **25 erzwungene `nip44.decrypt`-Aufrufe**. Bei NIP-46 ist das je ein Bunker-Roundtrip,
 * bei NIP-55 potenziell eine Aufforderung auf dem Signiergerät. Die zweite Hälfte ist
 * genauso unangenehm: ein entpackter Rumor ist **unsigniert** und landet trotzdem im
 * Repository — und `MESSAGE` steht in `PERSIST_KINDS` (`js/storage.ts:133`), wandert
 * also auf die Platte.
 *
 * Wer diese Liste das nächste Mal gegen `defaultAppPolicies` abgleicht: sie gehört hier
 * erst wieder hinein, wenn es eine Fläche gibt, die NIP-59 tatsächlich liest — und dann
 * mit einer Herkunftsprüfung davor, nicht als Voreinstellung.
 *
 * ZAPS.md Z1 — kein dufflepud-Proxy (Auftraggeber-Entscheidung 2026-07-10): leer
 * ⇒ welshman holt LNURL-Zapper- (NIP-57) und NIP-05-Handle-Infos DIREKT aus dem Browser
 * (Fallback-Zweig in `zappers.js`/`handles.js`). Trade-off: die Empfänger-lud16-Domain
 * sieht die IP des Zappers; bewusst akzeptiert (keine eigene Proxy-Infra). Proxy
 * nachrüsten = diese eine Zeile auf eine URL setzen.
 */
const policies: AppPolicy[] = [
    // ZUERST: die anderen Policies lösen `app.use(Router)` mit auf, und der soll seinen
    // fertigen Auflöser vorfinden.
    resolverPolicy,
    ingestMitWorkspaceRiegel,
    appPolicyRelayStats,
    authPolicy,
    authHoldPolicy,
]

/**
 * Die zwei Policies, die den **Signer umhüllen** statt am Pool zu hängen.
 *
 * `appPolicyCacheDecrypt` (Klartext-Cache vor jeder Entschlüsselung) und
 * `appPolicyLogSignerMethods` (Signer-Protokoll für `js/signer-health.ts`) rufen beide
 * `user.wrapSigner(...)`. Ohne Nutzer sind sie ein `noop` — sie können deshalb nicht in
 * der Liste oben stehen, wo sie einmal bei der Konstruktion liefen. Sie laufen bei jedem
 * Identitätswechsel neu, gegen den dann aktuellen Signer.
 */
const signerPolicies: AppPolicy[] = [appPolicyCacheDecrypt, appPolicyLogSignerMethods]

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

/** Die Abräumer der signer-gebundenen Policies der aktuellen Identität. */
const signerAbbau: Unsubscriber[] = []

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
 * Die Identität wechseln.
 *
 * ── Warum die App dabei NICHT ersetzt wird, obwohl 0.9.5 das vorsieht ────────────
 * Der erste Entwurf tat genau das — eine App gehört einem Nutzer, also tausch sie aus.
 * **Gemessen ist das falsch, und der Fehler ist verheerend und still:**
 *
 * Der Wechsel passiert nicht erst beim Login, sondern schon beim **Boot**. `js/session.ts`
 * hydriert `pubkey`/`sessions` aus dem localStorage in einem Microtask nach dem
 * Modul-Eval — die Identität springt also einmal von „niemand" auf „der gespeicherte
 * Nutzer", noch bevor die Oberfläche steht. Zu diesem Zeitpunkt haben aber schon Dutzende
 * Module ihre Ableitungen im Toplevel gebaut (`derived([app.use(Profiles).index.$, …])`
 * in `js/spaceProfiles.ts`, `js/groups.ts`, `js/feeds.ts` …). Die hängen danach alle an
 * der ALTEN, leeren Instanz.
 *
 * An der Sonde nachgestellt: **1 Instanzwechsel beim Boot**, und die Toplevel-Ableitung
 * zeigte danach nachweislich auf die alte App. In der E2E-Suite waren das **172
 * fehlgeschlagene Fälle** — die Insel bootete, lud auch, nur las niemand mehr mit.
 *
 * ── Was stattdessen passiert ─────────────────────────────────────────────────────
 * `App.user` ist eine schreibbare Property (nur `User.pubkey` ist `readonly`). Die
 * Instanz bleibt also, und mit ihr Repository, Pool, Tracker und jede Ableitung darauf.
 * Neu angewendet werden nur die Policies, die am SIGNER hängen — die AUTH-Policy liest
 * ihren Nutzer ohnehin zur Laufzeit.
 *
 * **Der Preis, benannt:** die 0.9.5-Zusage „data never bleeds across sessions" gilt damit
 * nicht mehr über die Instanz. Sie gilt bei uns über den Logout: `js/session.ts:302` leert
 * Event-Cache und Lesestand ausdrücklich, bevor die Sitzung fällt, und danach navigiert
 * `js/bridge.ts:8266` hart auf `/nostr-login` — der Modulzustand ist dann ohnehin weg.
 * Genau so verhielt sich 0.8.16 auch.
 */
export const setzeIdentitaet = (user?: User): void => {
    if (aktuelleApp.user === user) {
        return
    }
    for (const abbau of signerAbbau.splice(0)) {
        abbau()
    }
    aktuelleApp.user = user
    if (user) {
        for (const policy of signerPolicies) {
            signerAbbau.push(policy(aktuelleApp))
        }
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
