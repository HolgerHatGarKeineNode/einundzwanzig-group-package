/**
 * Fassade: der App-Kontext — **in der 0.9.5-Gestalt** (`app.use(Plugin)`).
 *
 * ── Welche 0.9.5-API diese Datei vorwegnimmt ─────────────────────────────────────
 * In 0.8.16 sind Repository, Tracker, Relay-Infos, Profile, Handles, Zapper und das
 * Publizieren freistehende Module-Globals. In 0.9.5 hängt all das an **einer
 * App-Instanz** (`createApp`), und die Sammlungen sind Plugins, die über eine
 * memoisierte Registry aufgelöst werden:
 *
 *     app.use(Profiles).get(pubkey)          // statt getProfile(pubkey)
 *     app.use(Relays).forceLoad(url)         // statt forceLoadRelay(url)
 *     app.use(Thunks).publish({event, …})    // statt publishThunk({event, …})
 *     app.use(RelayManagement).forUrl(url)   // statt manageRelay(url, request)
 *     app.repository / app.tracker           // statt der Globals
 *
 * Genau diese Zugriffspfade stehen ab jetzt an den Aufrufstellen. `app` ist hier ein
 * Singleton; in P3 wird daraus ein `createApp({user, config})`.
 *
 * Auch die 0.9.5-Rückgabeform ist übernommen, wo sie an unseren Aufrufstellen ankommt:
 * eine Sammlung liefert ihren Index als **`Projection<T>`** — `.get()` für den
 * Schnappschuss, `.$` für den Store. Ein `derived([...])` bekommt also `.index.$`.
 *
 * ── Was in P3 daraus entfällt ────────────────────────────────────────────────────
 * Die Innereien. Jede Plugin-Klasse hier wird durch die gleichnamige aus
 * `@welshman/app` ersetzt, `app` durch `createApp(…)`. Die Aufrufstellen bleiben, wie
 * sie sind — das ist der Zweck dieser Datei.
 *
 * ── Wo bewusst 0.8.16 durchschlägt (P3 MUSS das wissen) ──────────────────────────
 * **Die Werte sind noch die von 0.8.16, nur der Weg dorthin ist der von 0.9.5.**
 * 0.9.5 gibt aus diesen Sammlungen `Reader`-Objekte zurück (`ProfileReader` mit
 * `.name()`, `Relay` mit `.hasNip()`), 0.8.16 gibt schlichte Datenobjekte
 * (`profile.name`, `relay.profile`). Diese Fassade dreht das NICHT — eine hier
 * handgeschriebene Reader-Klasse wäre eine Erfindung, die P3 gegen die echte Klasse
 * erst wieder prüfen müsste, und sie würde das beobachtbare Verhalten unter 0.8.16
 * ändern. P3 tauscht also die Zugriffs-Rümpfe (fertig) und die Feld-Lesungen (offen).
 *
 * Am Ende der Datei stehen die Symbole, für die 0.9.5 **kein** Gegenstück in dieser
 * Form hat; sie behalten ihre 0.8.16-Gestalt, jeweils mit Begründung.
 *
 * **Diese Datei importiert ausschließlich `@welshman/app`** (plus einen reinen
 * Typ-Import aus `svelte/store`, der beim Bauen verschwindet).
 */
import type { Readable } from 'svelte/store'
import {
    repository as repository0816,
    tracker as tracker0816,
    profilesByPubkey,
    getProfile,
    deriveProfile,
    loadProfile,
    relaysByUrl,
    getRelaysByUrl,
    getRelay,
    deriveRelay,
    loadRelay,
    forceLoadRelay,
    handlesByNip05,
    displayNip05,
    deriveHandleForPubkey,
    loadHandleForPubkey,
    zappersByLnurl,
    getZapper,
    publishThunk,
    manageRelay,
    loadBlockedRelayList as loadBlockedRelayList0816,
    userProfile as userProfile0816,
    loadUserProfile as loadUserProfile0816,
    waitForThunkCompletion as waitForThunkCompletion0816,
    tagEvent as tagEvent0816,
    tagEventForComment as tagEventForComment0816,
    tagEventForReaction as tagEventForReaction0816,
    makeUserData as makeUserData0816,
    makeOutboxLoader as makeOutboxLoader0816,
    type Thunk,
    type ThunkOptions,
} from '@welshman/app'

/**
 * Ein Wert, der sowohl heiß gelesen (`get()`) als auch abonniert (`$`) werden kann —
 * die 0.9.5-Form für alles, was eine Plugin-Sammlung als Ganzes herausgibt.
 */
export type Projection<T> = {
    get: () => T
    $: Readable<T>
}

/**
 * Nur der Store-Teil einer `Projection`.
 *
 * 0.9.5 gibt an JEDER Sammlung beides heraus. Wir führen `get` nur dort, wo ein
 * Schnappschuss tatsächlich gelesen wird (heute: `Relays`, zweimal in
 * `js/buzzAdmin.ts`). Für die übrigen wäre es Symmetrie ohne Aufrufstelle — und jede
 * Zeile hier ist eine Verpflichtung, die P3 einlösen muss. Kommt eine Aufrufstelle,
 * kommt `get` mit ihr; die Form an den Aufrufstellen (`.index.$`) ist in beiden
 * Fällen dieselbe wie in 0.9.5.
 */
export type ProjectionStore<T> = Pick<Projection<T>, '$'>

const projection = <T>($: Readable<T>, read: () => T): Projection<T> => ({ get: read, $ })

const projectionStore = <T>($: Readable<T>): ProjectionStore<T> => ({ $ })

/**
 * `new (app) => T` — die 0.9.5-Signatur eines Plugins.
 *
 * **Konstruktor-Parameter-Properties (`constructor(readonly app: IApp) {}`) sind hier
 * verboten**, so knapp sie wären: die Testtore fahren `node --experimental-strip-types`,
 * und der Strip-Only-Modus lehnt sie mit `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX` ab. `tsc`
 * sieht das nicht — der Typecheck bleibt grün, während 18 Testdateien nicht mehr laden.
 */
export type Plugin<T> = new (app: IApp) => T

export interface IApp {
    repository: typeof repository0816
    tracker: typeof tracker0816
    use: <T>(Ctor: Plugin<T>) => T
}

/**
 * Kind-0-Profile, nach Pubkey. In 0.9.5 `DerivedPlugin<ProfileReader>`; hier liefern
 * `get`/`one` weiterhin das schlichte 0.8.16-Profilobjekt (siehe Modulkopf).
 */
export class Profiles {
    readonly app: IApp

    constructor(app: IApp) {
        this.app = app
    }

    index = projectionStore(profilesByPubkey)
    get = getProfile
    one = deriveProfile
    load = loadProfile
}

/** NIP-11-Relay-Profile, nach URL. In 0.9.5 `LoadableMapPlugin<Relay>`. */
export class Relays {
    readonly app: IApp

    constructor(app: IApp) {
        this.app = app
    }

    index = projection(relaysByUrl, getRelaysByUrl)
    get = getRelay
    one = deriveRelay
    load = loadRelay
    forceLoad = forceLoadRelay
}

/** NIP-05-Handles, nach Kennung. In 0.9.5 `LoadableMapPlugin<Handle>`. */
export class Handles {
    readonly app: IApp

    constructor(app: IApp) {
        this.app = app
    }

    index = projectionStore(handlesByNip05)
    forPubkey = deriveHandleForPubkey
    loadForPubkey = loadHandleForPubkey
    display = displayNip05
}

/** Lightning-Zapper, nach lnurl. In 0.9.5 `LoadableMapPlugin<Zapper>`. */
export class Zappers {
    readonly app: IApp

    constructor(app: IApp) {
        this.app = app
    }

    index = projectionStore(zappersByLnurl)
    get = getZapper
}

/** Optimistisches Publizieren. In 0.9.5 der Thunk-Manager der App-Instanz. */
export class Thunks {
    readonly app: IApp

    constructor(app: IApp) {
        this.app = app
    }

    publish = (options: ThunkOptions): Thunk => publishThunk(options)
}

/** Hängt einen optionalen Grund an — die `withReason`-Regel von 0.9.5, Zeichen für Zeichen. */
const mitGrund = (wert: string, grund?: string): string[] => (grund === undefined ? [wert] : [wert, grund])

/** Antwort einer NIP-86-Anfrage — namens- und formgleich in 0.8.16 und 0.9.5. */
export type ManagementResponse = { result?: unknown; error?: string }

/**
 * NIP-86-Client für EINEN Relay. Nachbildung von `ManagementApi` aus 0.9.5-util:
 * `send` für beliebige Methoden, benannte Methoden für die, die 0.9.5 benennt.
 *
 * **In 0.9.5 ist `method` ein schlichter String** — das `ManagementMethod`-Enum von
 * 0.8.16 gibt es dort nicht mehr, und die `as ManagementMethod`-Casts, die
 * `js/members.ts` dafür brauchte, entfallen ersatzlos.
 *
 * **Die fünf Rollen-Methoden sind KEIN Relay-Eigenbau.** Hier stand bis zum
 * P1-Review-Gate das Gegenteil. Gemessen in `@welshman/util@0.9.5`
 * (`dist/util/src/Nip86.js:34-53`, `Nip86.d.ts:62-66`): `makeCreateRole`,
 * `makeEditRole`, `makeDeleteRole`, `makeAssignRole` und `makeUnassignRole` existieren
 * dort, stehen als benannte Methoden an `ManagementApi`, und **unsere
 * Parameterreihenfolge ist bereits die von 0.9.5**. Sie stehen deshalb unten als
 * benannte Methoden und nicht als `send`-Aufrufe — sonst müsste P3 fünf Aufrufstellen
 * ein zweites Mal umbauen, also genau das tun, was P1 verhindern soll.
 *
 * **P3 muss hier nachziehen:** 0.9.5 typisiert `color: number` und `order: number`.
 * Wir übergeben ein HSL-Tripel (`roleColorParams` in `js/members.ts`, als String
 * gecastet) und `order.toString()` — die zooid-Wire-Form. Die echte `ManagementApi`
 * wird das nicht mehr annehmen; entweder wandert die Umformung dorthin oder die
 * betroffenen Aufrufe gehen über `send`.
 */
export class ManagementApi {
    readonly url: string

    constructor(url: string) {
        this.url = url
    }

    send = (request: { method: string; params: unknown[] }): Promise<ManagementResponse> =>
        manageRelay(this.url, request as unknown as Parameters<typeof manageRelay>[1]) as Promise<ManagementResponse>

    supportedMethods = (): Promise<ManagementResponse> => this.send({ method: 'supportedmethods', params: [] })

    // Die benannten Methoden bauen ihre Anfrage genau wie die 0.9.5-Builder: ein
    // optionaler Grund wird angehängt, sonst bleibt die Parameterliste einelementig
    // (`["<wert>"]` bzw. `["<wert>", "<grund>"]`, NIP-86).
    banPubkey = (pubkey: string, reason?: string) => this.send({ method: 'banpubkey', params: mitGrund(pubkey, reason) })
    unbanPubkey = (pubkey: string, reason?: string) =>
        this.send({ method: 'unbanpubkey', params: mitGrund(pubkey, reason) })
    allowPubkey = (pubkey: string, reason?: string) =>
        this.send({ method: 'allowpubkey', params: mitGrund(pubkey, reason) })
    unallowPubkey = (pubkey: string, reason?: string) =>
        this.send({ method: 'unallowpubkey', params: mitGrund(pubkey, reason) })
    listBannedPubkeys = () => this.send({ method: 'listbannedpubkeys', params: [] })
    banEvent = (id: string, reason?: string) => this.send({ method: 'banevent', params: mitGrund(id, reason) })
    changeRelayName = (name: string) => this.send({ method: 'changerelayname', params: [name] })
    changeRelayDescription = (description: string) =>
        this.send({ method: 'changerelaydescription', params: [description] })
    changeRelayIcon = (iconUrl: string) => this.send({ method: 'changerelayicon', params: [iconUrl] })

    // Rollen. Die Rümpfe bauen denselben Request-Body wie vorher — `color`/`order`
    // kommen als String herein, weil das die zooid-Wire-Form ist (siehe Modulkopf).
    createRole = (id: string, label: string, description: string, color: string, order: string) =>
        this.send({ method: 'createrole', params: [id, label, description, color, order] })

    editRole = (id: string, label: string, description: string, color: string, order: string) =>
        this.send({ method: 'editrole', params: [id, label, description, color, order] })

    deleteRole = (id: string) => this.send({ method: 'deleterole', params: [id] })

    assignRole = (pubkey: string, roleId: string) =>
        this.send({ method: 'assignrole', params: [pubkey, roleId] })

    unassignRole = (pubkey: string, roleId: string) =>
        this.send({ method: 'unassignrole', params: [pubkey, roleId] })
}

/** NIP-86-Relay-Management. In 0.9.5: `app.use(RelayManagement).forUrl(url)`. */
export class RelayManagement {
    readonly app: IApp

    constructor(app: IApp) {
        this.app = app
    }

    forUrl = (url: string): ManagementApi => new ManagementApi(url)
}

/** Kind-10006-Blockierlisten. In 0.9.5 `DerivedPlugin<BlockedRelayListReader>`. */
export class BlockedRelayLists {
    readonly app: IApp

    constructor(app: IApp) {
        this.app = app
    }

    load = loadBlockedRelayList0816
}

/**
 * Die App-Instanz. In 0.9.5 entsteht sie über `createApp({user, config})` und besitzt
 * Repository, Pool, Tracker und WrapManager pro Identität; hier zeigt sie auf die
 * 0.8.16-Globals. `use` ist wie dort memoisiert — ein Plugin wird je App genau einmal
 * gebaut.
 */
class App implements IApp {
    repository = repository0816
    tracker = tracker0816

    private singletons = new Map<Plugin<unknown>, unknown>()

    use = <T>(Ctor: Plugin<T>): T => {
        let instanz = this.singletons.get(Ctor as unknown as Plugin<unknown>) as T | undefined
        if (!instanz) {
            instanz = new Ctor(this)
            this.singletons.set(Ctor as unknown as Plugin<unknown>, instanz)
        }

        return instanz
    }
}

export const app: IApp = new App()

// ── Ohne Gegenstück in dieser Form: bewusst in der 0.8.16-Gestalt ───────────────
//
// `userProfile`/`loadUserProfile` hängen am eingeloggten Nutzer. In 0.9.5 ist eine App
// an EINE Identität gebunden (`app.user` ist eine Property, kein Store), das Gegenstück
// wäre `app.use(Profiles).one(app.user.pubkey)`. Unsere Identität wechselt zur Laufzeit
// und wird reaktiv gelesen — dieselbe Wurzel wie bei `js/welshmanSession.ts`, dort
// ausführlich begründet.
export const userProfile = userProfile0816
export const loadUserProfile = loadUserProfile0816

// In 0.9.5 eine Methode am Thunk selbst (`thunk.waitForCompletion()`), in 0.8.16 eine
// freie Funktion. Der Thunk von 0.8.16 hat die Methode nicht; sie ihm hier anzuhängen
// hieße, ein fremdes Objekt zu verändern.
export const waitForThunkCompletion = waitForThunkCompletion0816

// Tag-Bau mit App-Wissen (Relay-Hints aus dem Tracker). In 0.9.5 erledigen das die
// Writer aus `@welshman/domain` (`Comment`/`Reaction` mit `.setParent(event)`), die
// zugleich den Inhalt bauen — ein anderer Zuschnitt, keine Umbenennung.
export const tagEvent = tagEvent0816
export const tagEventForComment = tagEventForComment0816
export const tagEventForReaction = tagEventForReaction0816

// Nutzerdaten- und Outbox-Lader. In 0.9.5 ersatzlos aufgegangen in den Plugins selbst
// (jedes `DerivedPlugin` bringt `load`/`forceLoad` über das Outbox-Modell mit) bzw. in
// `Rooms`. Beide Aufrufstellen liegen in `js/groups.ts`, das P5 ohnehin ersetzt.
export const makeUserData = makeUserData0816
export const makeOutboxLoader = makeOutboxLoader0816

export type { Thunk, ThunkOptions }
