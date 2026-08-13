/**
 * P5 — die Insel des Vereins-Onboardings: Statuten → Antrag → Zahlung → Warten
 * → Zugang, ohne die App zu verlassen (Ausnahme: der Checkout-Zweig).
 *
 * ── Warum ein eigenes Modul und nicht `bridge.ts` ────────────────────────────
 * Gleiche Begründung wie bei `palette.ts` und `displayPrefs.ts`: ein eigener
 * Geltungsbereich, eine eigene Insel, eine Registrierungszeile in
 * `registerNostrComponents`. `bridge.ts` weiß von diesem Flow nur, dass es ihn
 * gibt. Die REINE Logik (Schritt-Entscheid, Fehler→Ausweg, Wartezeit,
 * Nachfass-Plan) liegt noch eine Ebene tiefer in `vereinFlow.ts` — ohne einen
 * einzigen Import und damit unter `node --test` prüfbar.
 *
 * ── Die drei Zusicherungen, an denen der Weg hängt ───────────────────────────
 *
 * 1. **Der `u`-Tag zielt auf den VEREIN, nicht auf unseren Proxy.** Der Verein
 *    vergleicht ihn byteweise gegen seinen eigenen Origin plus Request-URI
 *    (`hash_equals`, case-sensitiv, inklusive Query). Ein für unsere Proxy-Route
 *    signiertes Event käme dort nie durch — und unser Proxy prüft dieselbe
 *    Zeichenkette vorab, damit der Fehler hier auffällt und nicht erst nach dem
 *    Netzwerk-Roundtrip (`app/Support/VereinNip98.php`, Schritt 3).
 *
 * 2. **Der Body geht als String raus und derselbe String wird gehasht.** Zwei
 *    `JSON.stringify`-Aufrufe auf dasselbe Objekt sind zwei Byte-Folgen; der
 *    `payload`-Tag passte dann zur einen und der Body zur anderen. Deshalb
 *    entsteht der Body genau EINMAL (`vereinFlow.applicationBody`) und wandert
 *    unverändert in `sign()` UND in `fetch()`.
 *
 * 3. **Kein Retry mit demselben Event.** Der Verein brennt die Event-ID nach dem
 *    ersten Versuch für 150 s. Ein zweiter Versuch mit demselben Ausweis ergäbe
 *    ein „Authentifizierung fehlgeschlagen", obwohl der erste Versuch die Akte
 *    längst angelegt haben kann. Jeder Wiederholungsweg in dieser Datei signiert
 *    neu — es gibt keine Ausnahme.
 */
import { get } from 'svelte/store'
import { signer, pubkey } from '@welshman/app'
import { Pool } from '@welshman/net'
import { activeSpace } from './groups'
import { deriveVereinAccess, watchSpaceDirectory, type VereinAccess } from './members'
import { spaceIsBuzzAsync } from './buzzAdmin'
import { reconnectDue } from './reconnectGap'
import { loadWallet, payInvoice } from './wallet'
import { nip98AuthHeader, type SignedLike } from './nip98'
import { isMobile, nativeBrowserInApp } from './core'
import { t } from './i18n'
import {
    applicationBody,
    canPayInApp,
    escapeLabel,
    followUpDelay,
    formatCharCount,
    formatRetry,
    formatWait,
    mapVereinError,
    OPAQUE_REDIRECT_STATUS,
    readConfig,
    readInvoice,
    readMe,
    safeExternalUrl,
    shouldFollowUpOnResume,
    statutesSegments,
    vereinView,
    waitSentenceSegments,
    type ConfigData,
    type InvoiceData,
    type Segment,
    type VereinError,
    type VereinPhase,
    type WaitStage,
} from './vereinFlow'

// ── Konfiguration aus dem Dokument ───────────────────────────────────────────

type VereinWindowConfig = {
    /** Origin der Vereins-API — Ziel des `u`-Tags. Leer = Flow nicht eingerichtet. */
    api?: string
    /** Origin des Proxys. Leer = derselbe Origin wie die Seite (Web-Instanz). */
    proxy?: string
    /** Wartezeit bis zur Freischaltung in Minuten — der EINE Wert, der sich ändert. */
    activationMinutes?: number
    /** Öffentliche Vereinsseite — der Ausweg, wenn der Weg im Client nicht trägt. */
    publicUrl?: string
}

const conf = (): VereinWindowConfig => (window as { __nostrVerein?: VereinWindowConfig }).__nostrVerein ?? {}

/** Pfad-Präfix der Mitglieds-API des Vereins — identisch zum Proxy (P4). */
const API_PREFIX = '/api/v1/membership'

/** Präfix unserer eigenen Proxy-Routen (`bootstrap/app.php`). */
const PROXY_PREFIX = '/api/verein'

const csrfToken = (): string =>
    document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')?.content ?? ''

// ── Aufruf über den Proxy ────────────────────────────────────────────────────

type ProxyResult = { ok: boolean; status: number; body: unknown; retryAfter: string | null }

/**
 * Ein Aufruf an den Verein, über unseren Proxy.
 *
 * Was hier NICHT passiert: kein Retry, kein Header-Cache, kein zweites
 * Serialisieren. Was passiert: `u` auf den Verein, `payload` über den rohen
 * Body, `X-CSRF-TOKEN` (der Proxy liegt in der `web`-Gruppe, ohne den Header
 * gibt es 419) und `Content-Type: application/json` — exakt, sonst weist der
 * Proxy die Anfrage schon vor dem Netz mit 415 ab.
 *
 * `needsAuth: false` gilt nur für `GET /config`: der Endpunkt verlangt beim
 * Verein kein NIP-98, und unser Proxy reicht dort auch keinen
 * `Authorization`-Header weiter. Ein Ausweis wäre also nicht bloß überflüssig,
 * sondern eine verschenkte Signatur.
 */
const call = async (path: string, method: string, body?: string, needsAuth = true): Promise<ProxyResult> => {
    const { api = '', proxy = '' } = conf()

    if (api === '') {
        // Fail closed statt fail confusing: ohne Basis-URL könnten wir den
        // `u`-Tag nicht auf den Verein setzen, und jede Signatur wäre wertlos.
        // Derselbe Satz wie im Proxy (`VereinProxyController::forward`) — dort
        // fehlt die Basis-URL oder der API-Schlüssel, hier die Basis-URL. Für
        // den Nutzer ist das EIN Zustand: diese Installation ist für den
        // Beitritt nicht eingerichtet, dauerhaft, und niemand am Bildschirm
        // kann etwas daran tun. Zwei Formulierungen dafür („eingerichtet" /
        // „konfiguriert") waren im Deutschen nicht zu unterscheiden und
        // zwangen es/pt/pl zu einem erfundenen Unterschied.
        return { ok: false, status: 503, body: { message: t('Die Vereins-Anbindung ist nicht eingerichtet.') }, retryAfter: null }
    }

    const headers: Record<string, string> = {
        Accept: 'application/json',
        'X-CSRF-TOKEN': csrfToken(),
        'X-Requested-With': 'XMLHttpRequest',
    }

    if (body !== undefined) {
        headers['Content-Type'] = 'application/json'
    }

    if (needsAuth) {
        const s = signer.get()

        if (!s) {
            return { ok: false, status: 403, body: { message: t('Nicht angemeldet.') }, retryAfter: null }
        }

        /*
         * Das Signieren liegt INNERHALB des try — und das ist keine Formalie.
         *
         * Vorher stand dieser `await` davor, und nur `fetch` war abgesichert. Drei
         * ganz gewöhnliche Fälle werfen hier aber: die Erweiterung lehnt ab (NIP-07
         * „Reject"), der Bunker antwortet nicht (NIP-46 läuft in den Timeout), oder
         * `crypto.subtle` fehlt, weil die Seite nicht in einem sicheren Kontext
         * läuft — dann wirft schon `sha256Hex` für den `payload`-Tag.
         *
         * Die Ablehnung lief dann aus `call()` heraus, an jedem Aufrufer vorbei.
         * Folge, am laufenden Client gemessen: `busy` blieb stehen, `::disabled`
         * sperrte Antrag, Zahlung und Wallet DAUERHAFT, und `error` blieb `null` —
         * also erschien kein Ausweg. Nur ein Neuladen half. Im Wartezustand
         * dieselbe Ursache mit anderer Wirkung: der Plan endete still, während die
         * Fläche weiter „Wir fragen automatisch weiter nach." behauptete.
         *
         * Das ist die eine Zusicherung, die diese Strecke gibt: jeder
         * Fehlerzustand hat einen sichtbaren Ausweg. Ein Wurf, der an allen
         * Aufrufern vorbeigeht, kann sie nicht einhalten.
         *
         * Abgebildet auf 401 — nicht weil der Verein geantwortet hätte (er wurde
         * nie gefragt), sondern weil der Ausweg derselbe und der einzig richtige
         * ist: neu signieren. Ein Wiederholen mit demselben Ausweis gäbe es hier
         * ohnehin nicht, es wurde ja keiner erzeugt.
         */
        try {
            // Der signierte URL ist die ZIEL-Adresse beim Verein, nicht unsere
            // Proxy-Route. Siehe Zusicherung 1 im Modulkopf.
            headers.Authorization = await nip98AuthHeader(
                (e) => s.sign(e) as Promise<SignedLike>,
                `${api.replace(/\/+$/, '')}${API_PREFIX}${path}`,
                method,
                body,
            )
        } catch {
            // Kein eigener Satz: `mapVereinError(401)` trägt bereits „Der Ausweis
            // wurde abgelehnt. Bitte noch einmal signieren." — das stimmt für alle
            // drei Ursachen, und die Copy bleibt unangetastet.
            return { ok: false, status: 401, body: null, retryAfter: null }
        }
    }

    let res: Response

    try {
        res = await fetch(`${proxy.replace(/\/+$/, '')}${PROXY_PREFIX}${path}`, {
            method,
            headers,
            body,
            credentials: 'same-origin',
            // Umleitungen nicht folgen: der Proxy reicht ein 3xx unverfälscht
            // durch, hält den `Location`-Header aber zurück. `redirect: 'follow'`
            // liefe dann gegen dieselbe Adresse noch einmal.
            redirect: 'manual',
        })
    } catch {
        return { ok: false, status: 504, body: null, retryAfter: null }
    }

    /*
     * Eine undurchsichtige Umleitung ist KEINE 3xx-Antwort, die man lesen könnte.
     * `redirect: 'manual'` liefert im Browser `status: 0`, `type:
     * 'opaqueredirect'` und abgeräumte Header — ohne diese Normalisierung fiele
     * der Fall in den Sammelzweig „Unerwartete Antwort" und der eigens dafür
     * gebaute 3xx-Zweig wäre unerreichbarer Code. (In Node verhält sich dieselbe
     * Option anders und liefert `302`; deshalb steht hier beides.)
     */
    if (res.type === 'opaqueredirect') {
        return { ok: false, status: OPAQUE_REDIRECT_STATUS, body: null, retryAfter: null }
    }

    let parsed: unknown = null

    try {
        parsed = await res.json()
    } catch {
        parsed = null
    }

    return { ok: res.ok, status: res.status, body: parsed, retryAfter: res.headers.get('Retry-After') }
}

// ── Kleiner Speicher über den Checkout-Ausflug hinweg ────────────────────────

/**
 * Der Checkout führt aus der App heraus. Was dort begonnen wurde, muss die
 * Rückkehr überleben — sonst steht der Nutzer nach der Zahlung wieder am Anfang
 * und erzeugt eine zweite Rechnung aus einem Kontingent von drei pro Tag.
 *
 * `localStorage` und nicht `sessionStorage`: der In-App-Browser kann als eigener
 * Kontext zurückkommen, und ein Neuladen der Seite gehört zum normalen Weg.
 * Hausüblicher `e21:`-Präfix, an den Pubkey gebunden — ein Kontowechsel darf den
 * Vorgang eines anderen Schlüssels nicht erben.
 */
type Progress = {
    year: number | null
    checkoutUrl: string | null
    paymentSentAt: number
    /**
     * Ist eine Zahlung RAUS — oder liegt bloss eine Rechnung vor?
     *
     * Der Eintrag traegt zwei verschiedene Dinge, und sie zu vermengen war ein
     * Fehler: die Checkout-Adresse muss den Ausflug ueberleben (sonst kostet
     * jede Rueckkehr eine weitere Rechnung aus einem Kontingent von drei pro
     * Tag), ABER allein eine erzeugte Rechnung ist noch kein Zahlvorgang.
     *
     * Ohne diese Unterscheidung genuegte „Rechnung erzeugen" + Neuladen, um
     * dauerhaft im Wartezustand zu landen — ohne dass je etwas geoeffnet oder
     * gezahlt wurde. Gefunden vom eigenen F3-Regressionstest, nicht vermutet.
     */
    sent: boolean
}

/**
 * `null`, solange kein Pubkey feststeht. Ein Sammelschlüssel („anon") wäre
 * schlimmer als kein Speicher: der nächste Nutzer an diesem Gerät erbte einen
 * fremden Zahlvorgang samt Checkout-Adresse. Der Rücksprung aus dem Checkout
 * hängt ohnehin nicht daran — er trägt `?schritt=warten` in der Adresse.
 */
const progressKey = (): string | null => {
    const pk = pubkey.get()

    return pk ? `e21:verein:${pk}` : null
}

const readProgress = (): Progress | null => {
    const key = progressKey()

    if (!key) {
        return null
    }

    try {
        const raw = localStorage.getItem(key)

        return raw ? (JSON.parse(raw) as Progress) : null
    } catch {
        return null
    }
}

const writeProgress = (value: Progress | null): void => {
    const key = progressKey()

    if (!key) {
        return
    }

    try {
        if (value) {
            localStorage.setItem(key, JSON.stringify(value))
        } else {
            localStorage.removeItem(key)
        }
    } catch {
        // Kein Storage (Privatmodus) → der Vorgang gilt für diese Sitzung. Der
        // Wartezustand fasst dann über `/me` nach, das ist die Wahrheit ohnehin.
    }
}

/**
 * `/config` wird gecacht, nicht pro Seitenaufruf gezogen.
 *
 * Der Endpunkt ist beim Verein der ENGSTE Pfad: er verlangt kein NIP-98, fällt
 * damit beim Rate-Limit auf die IP zurück und teilt 30/min über ALLE Nutzer
 * unseres Proxys. Beitrag und Statuten ändern sich einmal im Jahr — sechs
 * Stunden Cache sind dagegen kein Risiko, ein Abruf pro Seitenaufruf schon.
 */
const CONFIG_KEY = 'e21:verein:config'
const CONFIG_TTL_MS = 6 * 60 * 60 * 1000

const readCachedConfig = (): ConfigData | null => {
    try {
        const raw = localStorage.getItem(CONFIG_KEY)

        if (!raw) {
            return null
        }

        const parsed = JSON.parse(raw) as { at: number; data: ConfigData }

        return Date.now() - parsed.at < CONFIG_TTL_MS ? parsed.data : null
    } catch {
        return null
    }
}

const writeCachedConfig = (data: ConfigData): void => {
    try {
        localStorage.setItem(CONFIG_KEY, JSON.stringify({ at: Date.now(), data }))
    } catch {
        // s.o. — ohne Cache wird einmal mehr gefragt, das ist alles.
    }
}

// ── Directory: gelesen, ungelesen, ungelesbar ────────────────────────────────

/**
 * Wie lange auf EOSE/CLOSED der relay-signierten Mitgliederliste gewartet wird,
 * bevor der Lesevorgang als GESCHEITERT gilt.
 *
 * Ein toter Relay wirft nicht — welshman meldet keinen Fehler, die Antwort
 * bleibt schlicht aus. Ohne diese Frist gäbe es nur „noch nicht gelesen", und
 * ein dauerhaft stummer Relay sähe für immer aus wie ein langsamer. 12 s liegen
 * weit über jedem gemessenen EOSE und deutlich unter der Geduld eines Nutzers,
 * der gerade Geld überwiesen hat.
 */
const DIRECTORY_TIMEOUT_MS = 12_000

/**
 * Mindestabstand zwischen zwei Socket-Abrissen gegen Buzz.
 *
 * Der Abriss ist ein Eingriff in eine GETEILTE Verbindung, nicht in eine eigene
 * — siehe die Begruendung in `_reconnectDirectory`. Eine Minute liegt weit
 * unter dem dichtesten Plan-Abstand ab Runde 5 und deckelt zugleich den Fall,
 * den der Plan nicht sieht: einen Nutzer, der zwischen zwei Apps hin- und
 * herwechselt.
 */
const RECONNECT_MIN_GAP_MS = 60_000

/**
 * Der Pfad, auf den der Verein nach der Checkout-Zahlung zurückwirft.
 *
 * Absolut zusammengesetzt (`origin + RETURN_PATH`) und ohne Query, weil der
 * Verein die Adresse gegen eine **serverseitige Allowlist** prüft: eine
 * Abweichung um ein Zeichen ist dort ein 422, und der Nutzer bekäme statt einer
 * Rechnung eine Fehlermeldung. Die Route selbst liegt im Package
 * (`routes/group.php`, `group.verein.return`) und setzt im Wartezustand ab.
 */
export const RETURN_PATH = '/verein/zurueck'

// ── Die Insel ────────────────────────────────────────────────────────────────

/** Stabile leere Feldfehler-Liste (siehe `errorFields()`). */
const NO_FIELDS: Record<string, string[]> = Object.freeze({})

type Unsub = (() => void) | null

type VereinState = {
    // Schritt
    phase: VereinPhase
    stage: WaitStage | null
    busy: string
    error: VereinError | null

    // Fakten aus /config
    fee: number | null
    currency: string
    year: number | null
    statutesUrl: string
    statutesVersion: string
    statutesAdoptedAt: string
    applicationTextMax: number
    optionalFields: string[]

    // Eingaben
    statutesConfirmed: boolean
    applicationText: string
    email: string
    noEmail: boolean
    nip05: string

    // Zahlung
    bolt11: string | null
    checkoutUrl: string | null
    hasWallet: boolean

    // Warten
    waitText: string
    attempts: number
    exhausted: boolean
    memberSince: boolean
    /**
     * Läuft gerade eine Nachfass-Runde?
     *
     * Bewusst NICHT `busy`: `busy` ist die Sperre der Handlungen des Nutzers und
     * wird an drei Stellen als Wiedereintritts-Schutz gelesen
     * (`submitApplication`, `startPayment`, `payWithWallet` steigen bei
     * `busy !== ''` still aus). Der Nachfass-Plan läuft aber von selbst, im
     * Hintergrund und ohne Zutun — würde er `busy` setzen, träfe ein Klick des
     * Nutzers zufällig in ein offenes Zeitfenster und täte lautlos nichts.
     * Genau die Stille, die dieser Wert sichtbar machen soll.
     */
    checking: boolean

    // intern
    _access: VereinAccess
    _dirFailed: boolean
    _loaded: boolean
    _paid: boolean
    _statutesAccepted: boolean
    _paymentSent: boolean
    _lastAttemptAt: number
    /**
     * Hat DIESER Browser den Zahlvorgang selbst begonnen — oder bestaetigt der
     * Verein eine Zahlung? Nur dann laeuft irgendetwas automatisch (und damit
     * signierend). Ein blosser Adressparameter reicht nicht.
     */
    _selfInitiated: boolean
    /** Zeitpunkt des letzten Socket-Abrisses (Buzz), fuer die Mindestpause. */
    _lastReconnectAt: number
    /** Wartezeit aus einem `Retry-After` (ms), gilt für GENAU die nächste Runde. */
    _retryAfterMs: number | null
    _timer: number | null
    _dirTimer: number | null
    _unsubSpace: Unsub
    _unsubAccess: Unsub
    _controller: AbortController | null
    _onVisible: (() => void) | null

    init(startInWaiting?: boolean): void
    destroy(): void
    // Handlungen
    acceptStatutes(): void
    backToStatutes(): void
    abortPayment(): void
    submitApplication(): Promise<void>
    startPayment(): Promise<void>
    payWithWallet(): Promise<void>
    openCheckout(e?: Event): void
    newInvoice(): Promise<void>
    checkNow(): Promise<void>
    dismissError(): void
    resolveError(): Promise<void>
    openExternal(url: string, e: Event): boolean
    // Ableitungen fürs Markup
    feeLabel(): string
    hasFlow(): boolean
    errorAction(): string
    errorFields(): Record<string, string[]>
    fieldLabel(field: string): string
    retryLine(): string
    statutesSegments(): Segment[]
    charCountLine(): string
    waitSegments(): Segment[]
    payInApp(): boolean
    stepState(step: string): 'done' | 'active' | 'todo'
    // Innenleben
    _boot(): Promise<void>
    _applyConfig(cfg: ConfigData): void
    _applyInvoice(invoice: InvoiceData): void
    _markPaymentSent(): void
    _scheduleFollowUp(): void
    _followUp(): Promise<void>
    _watchDirectory(url: string): void
    _reconnectDirectory(): Promise<void>
    _recompute(): void
    _fail(error: VereinError): void
    _runFollowUp(): Promise<void>
}

const createVerein = (startInWaiting = false): VereinState => ({
    phase: 'laden',
    stage: null,
    busy: '',
    error: null,

    fee: null,
    currency: '',
    year: null,
    statutesUrl: '',
    statutesVersion: '',
    statutesAdoptedAt: '',
    applicationTextMax: 2000,
    optionalFields: [],

    statutesConfirmed: false,
    applicationText: '',
    email: '',
    noEmail: false,
    nip05: '',

    bolt11: null,
    checkoutUrl: null,
    hasWallet: false,

    waitText: '',
    attempts: 0,
    exhausted: false,
    memberSince: false,
    checking: false,

    _access: { gated: false, ready: false, isMember: false },
    _dirFailed: false,
    _loaded: false,
    _paid: false,
    _statutesAccepted: false,
    _paymentSent: false,
    _lastAttemptAt: 0,
    _selfInitiated: false,
    _lastReconnectAt: 0,
    _retryAfterMs: null,
    _timer: null,
    _dirTimer: null,
    _unsubSpace: null,
    _unsubAccess: null,
    _controller: null,
    _onVisible: null,

    init(startInWaitingArg = startInWaiting) {
        this.waitText = formatWait(conf().activationMinutes ?? 0, t) ?? ''

        // Der Rücksprung aus dem Checkout setzt hier ab: der Vorgang gilt als
        // begonnen, noch bevor `/me` geantwortet hat. Sonst zeigte die Seite für
        // einen Moment wieder den Zahlschritt — mit einem Knopf, der eine zweite
        // Rechnung aus einem Kontingent von drei pro Tag zöge.
        const saved = readProgress()

        // Nur ein AUSDRUECKLICH als gesendet vermerkter Vorgang zaehlt. Eine bloss
        // erzeugte Rechnung ist keine Zahlung — siehe `Progress.sent`.
        const sent = saved?.sent === true

        if (startInWaitingArg || sent) {
            this._paymentSent = true
        }

        // Die Adresse wird IMMER zurueckgeholt (dafuer gibt es den Eintrag), aber
        // sie hat den Speicher passiert und ist damit keine Antwort des Vereins
        // mehr, sondern eine Eingabe — sie wird geprüft, bevor sie je in
        // `window.open` landet.
        this.checkoutUrl = safeExternalUrl(saved?.checkoutUrl)

        // Der echte Ruecksprung heisst „jetzt nachsehen": `0` laesst
        // `shouldFollowUpOnResume` sofort greifen. Ein gewoehnlicher Seitenaufruf
        // respektiert dagegen den Abstand zur letzten Runde.
        this._lastAttemptAt = startInWaitingArg ? 0 : (saved?.paymentSentAt ?? 0)

        /*
         * F4 — der Adressparameter DARF den Wartezustand zeigen, aber er darf
         * nicht den signierenden Nachfass-Plan starten.
         *
         * `?schritt=warten` ist eine Angabe von außen: ein Link genügte, um beim
         * eingeloggten Empfänger bis zu neun `POST …/refresh` auszulösen — jeder
         * mit frischer Signatur, bei NIP-46 jeder mit einem Bestätigungs-Prompt.
         * Ein Fremder bestimmte damit, dass der Signer des Opfers arbeitet.
         *
         * Der Riegel ist ein BELEG statt einer Prüfung des Parameters: automatisch
         * gefragt wird nur, wenn dieser Browser eine Zahlung selbst auf den Weg
         * gebracht hat (`Progress.sent`, gesetzt in `_markPaymentSent` — also
         * nachdem die Wallet gezahlt hat oder der Checkout WIRKLICH aufging) oder
         * wenn der Verein selbst eine Zahlung bestätigt (`_paid` aus `/me`, siehe
         * `_boot`). Beides kann ein Link nicht fälschen.
         *
         * Eine bloss erzeugte Rechnung zählt ausdrücklich NICHT — das war der
         * Fehler, den der eigene F3-Regressionstest aufgedeckt hat: der Eintrag
         * entstand schon beim Erzeugen, und damit genügte „Rechnung erzeugen" plus
         * Neuladen, um dauerhaft im Wartezustand zu landen.
         *
         * Der echte Rücksprung funktioniert unverändert: wer bezahlt hat, hat den
         * Beleg. Wer ihn nicht hat (anderes Gerät, Privatmodus), sieht weiterhin
         * den Wartezustand — nur entscheidet dann `/me` statt der Adresszeile, und
         * „Jetzt prüfen" bleibt als ausdrückliche Handlung erreichbar.
         */
        this._selfInitiated = sent

        this._recompute()

        this._unsubSpace = activeSpace.subscribe((url: string) => {
            this._watchDirectory(url)
        })

        // Rückkehr in die App. Der In-App-Browser kommt NICHT von selbst zurück
        // und das Deep-Link-Schema wertet niemand aus — der Sichtbarkeitswechsel
        // ist das einzige Signal, das verlässlich kommt.
        this._onVisible = () => {
            if (document.visibilityState !== 'visible') {
                return
            }

            const wartet = this.phase === 'warten' || this._paymentSent || this._paid

            /*
             * `exhausted` gilt HIER GENAUSO — das war F5.
             *
             * Ohne diese Bedingung war jeder Wechsel in den Vordergrund eine
             * weitere Runde, unbegrenzt oft, und jede davon riss auf Buzz den
             * Socket ab (`_reconnectDirectory` → `Pool.remove`). Ein Abriss
             * nimmt JEDE andere Subscription auf demselben Relay mit und kostet
             * ein NIP-42-AUTH, also wieder eine Signatur. Die Deckelung des
             * Plans war damit über den Umweg App-Wechsel aufgehoben.
             *
             * Nach dem Plan bleibt „Jetzt prüfen" — eine ausdrückliche Handlung
             * des Nutzers ist die richtige Erlaubnis für etwas, das eine
             * gemeinsam genutzte Verbindung abreißt. `_selfInitiated` gilt
             * ebenso, sonst wäre der Sichtbarkeitswechsel das Schlupfloch für F4.
             */
            if (wartet && this._selfInitiated && !this.exhausted && shouldFollowUpOnResume(this._lastAttemptAt, Date.now())) {
                void this._followUp()
            }
        }

        document.addEventListener('visibilitychange', this._onVisible)

        void this._boot()
    },

    destroy() {
        this._unsubSpace?.()
        this._unsubAccess?.()
        this._controller?.abort()

        if (this._timer !== null) {
            window.clearTimeout(this._timer)
        }

        if (this._dirTimer !== null) {
            window.clearTimeout(this._dirTimer)
        }

        if (this._onVisible) {
            document.removeEventListener('visibilitychange', this._onVisible)
        }
    },

    // ── Handlungen ──────────────────────────────────────────────────────────

    /**
     * Schritt 2 → 3. Die Zustimmung wird hier nur vermerkt, gesendet wird sie mit
     * dem Antrag: `POST /applications` trägt `statutes_accepted` selbst, ein
     * eigener Aufruf davor wäre eine Signatur ohne Gegenwert.
     */
    acceptStatutes() {
        this.statutesConfirmed = true
        this.error = null
        this._recompute()
    },

    /** Zurück zu Schritt 2 — über den Entscheid, nie durch Setzen von `phase`. */
    backToStatutes() {
        this.statutesConfirmed = false
        this.error = null
        this._recompute()
    },

    /** Schritt 3 — `POST /applications`. 201 = erste Zustimmung, 200 = Wiederholung. */
    async submitApplication() {
        if (this.busy !== '') {
            return
        }

        this.busy = t('Antrag wird gesendet…')
        this.error = null

        // EINMAL serialisieren — derselbe String wird gehasht und gesendet.
        const body = applicationBody({
            applicationText: this.applicationText,
            email: this.email,
            noEmail: this.noEmail,
            nip05: this.nip05,
        })

        /*
         * `busy` faellt im `finally`, nicht auf dem Erfolgspfad.
         *
         * `busy` ist nicht bloss eine Beschriftung: `::disabled="busy !== ''"`
         * haengt daran. Bleibt es stehen, ist der Knopf fuer immer gesperrt —
         * und weil `error` in diesem Fall leer bleibt, sieht der Nutzer nicht
         * einmal, WARUM. Das darf an keinem Rueckgabepfad haengen, auch nicht an
         * einem, der heute nicht wirft.
         */
        let res: ProxyResult

        try {
            res = await call('/applications', 'POST', body)
        } finally {
            this.busy = ''
        }

        if (!res.ok) {
            this._fail(mapVereinError(res.status, res.body, res.retryAfter, t))

            return
        }

        this._statutesAccepted = true
        this._recompute()

        // Direkt weiter zur Rechnung: der Nutzer hat gerade zugestimmt, ein
        // zusätzlicher Klick „jetzt bezahlen" fügt nichts hinzu.
        await this.startPayment()
    },

    /** Schritt 4 — Rechnung erzeugen und die Weiche stellen. */
    async startPayment() {
        if (this.busy !== '' || this.year === null) {
            if (this.year === null) {
                this._fail(mapVereinError(404, null, null, t))
            }

            return
        }

        // Gleicher Wortstamm wie der Knopf, der hierher führt („Zahlung starten"):
        // eine Handlung behält ihren Namen über den ganzen Weg, sonst liest sich
        // der Laufzustand wie ein anderer Vorgang.
        this.busy = t('Zahlung wird vorbereitet…')
        this.error = null

        // Die Rückkehr-Adresse: absolut, weil der Verein sie gegen eine
        // serverseitige Allowlist prüft. Kein Query-Anhang — jede Abweichung
        // vom eingetragenen Wert fällt dort mit 422 durch.
        const returnUrl = `${window.location.origin}${RETURN_PATH}`
        const body = JSON.stringify({ return_url: returnUrl })

        // `finally` aus demselben Grund wie in `submitApplication`: `busy` sperrt
        // die Fläche, ein stehengebliebenes `busy` ohne Fehlermeldung ist eine
        // Sackgasse ohne Ausweg.
        let res: ProxyResult

        try {
            res = await call(`/payments/${this.year}/invoice`, 'POST', body)
        } finally {
            this.busy = ''
        }

        if (!res.ok) {
            const mapped = mapVereinError(res.status, res.body, res.retryAfter, t)

            // Kontingent erschöpft (3/Tag pro Pubkey beim Verein): der Ausweg ist
            // die zuletzt erzeugte Checkout-Adresse, keine vierte Rechnung —
            // warten hilft hier nicht, das Fenster ist ein Tag lang.
            this._fail(res.status === 429 && this.checkoutUrl ? { ...mapped, escape: 'checkout' } : mapped)

            return
        }

        this._applyInvoice(readInvoice(res.body))
    },

    /** In der App zahlen. Scheitert das, bleibt der Checkout als Ausweg. */
    async payWithWallet() {
        if (this.busy !== '' || !this.bolt11) {
            return
        }

        this.busy = t('Zahlung läuft…')
        this.error = null

        try {
            // Kein `msats`: die Rechnung des Vereins trägt einen Betrag.
            await payInvoice(this.bolt11)
        } catch (e) {
            this._fail({
                status: 0,
                message: e instanceof Error && e.message ? e.message : t('Die Zahlung aus der Wallet ist gescheitert.'),
                escape: this.checkoutUrl ? 'checkout' : 'neue-rechnung',
            })

            return
        } finally {
            // Ein Ausstieg fuer alle drei Wege (Erfolg, gefangener Fehler,
            // unerwarteter Wurf) — `busy` sperrt die Flaeche, es darf an keinem
            // Rueckgabepfad haengenbleiben.
            this.busy = ''
        }

        this._markPaymentSent()
    },

    /**
     * Checkout im In-App-Browser (Mobile) bzw. neuem Tab (Web).
     *
     * ── Erst öffnen, DANN den Wartezustand betreten ─────────────────────────
     * Vorher lief `_markPaymentSent()` VOR dem Öffnen. Blockte der Browser das
     * Popup oder scheiterte die native Bridge, war der Nutzer damit dauerhaft im
     * Wartezustand — persistent über einen Reload hinweg, der Zahlschritt nicht
     * mehr erreichbar — und nach Ablauf des Plans behauptete die Fläche, jemand
     * aus dem Vorstand sehe sich seine Zahlung an. Es gab keine Zahlung. Das ist
     * die unangenehmste Sorte Falschaussage, weil sie beruhigt.
     *
     * `window.open` gibt `null` zurück, wenn nichts geöffnet wurde — das ist das
     * Signal, und es wird jetzt ausgewertet statt verworfen. Zusätzlich bleibt
     * der Wartezustand verlassbar (siehe [[abortPayment]]), denn „geöffnet" ist
     * nicht dasselbe wie „bezahlt".
     */
    openCheckout(e?: Event) {
        const url = safeExternalUrl(this.checkoutUrl)

        if (!url) {
            return
        }

        if (!this.openExternal(url, e ?? new Event('click'))) {
            this._fail({
                status: 0,
                message: t('Der Checkout konnte nicht geöffnet werden.'),
                escape: 'erneut',
            })

            return
        }

        this._markPaymentSent()
    },

    /**
     * Zurück aus dem Wartezustand in den Zahlschritt.
     *
     * Der Gegenpol zu [[openCheckout]]: der Checkout kann geöffnet worden sein,
     * ohne dass jemand gezahlt hat — abgebrochen, falsche Wallet, Tab
     * geschlossen. Ohne diesen Weg wäre der Wartezustand eine Sackgasse, in der
     * die Fläche auf eine Zahlung wartet, die es nicht gibt.
     *
     * Der lokale Beleg wird dabei gelöscht: er ist die Behauptung „hier läuft
     * ein Vorgang", und die stimmt dann nicht mehr.
     */
    abortPayment() {
        if (this._timer !== null) {
            window.clearTimeout(this._timer)
            this._timer = null
        }

        this._paymentSent = false
        this._selfInitiated = false
        this.exhausted = false
        this.attempts = 0
        this.error = null

        // Der Eintrag wird NICHT geloescht, nur zurueckgestuft: die
        // Checkout-Adresse bleibt gueltig, und eine weitere Rechnung aus dem
        // Kontingent von drei pro Tag waere der falsche Preis fuer einen
        // Abbruch.
        writeProgress({ year: this.year, checkoutUrl: this.checkoutUrl, paymentSentAt: 0, sent: false })
        this._recompute()
    },

    /** Ausweg „Rechnung abgelaufen" — neu erzeugen, nie dieselbe wiederverwenden. */
    async newInvoice() {
        this.bolt11 = null
        this.checkoutUrl = null
        this.error = null
        await this.startPayment()
    },

    /** „Jetzt prüfen" — eine Runde von Hand, auch nach Ablauf des Nachfass-Plans. */
    async checkNow() {
        // Eine ausdrueckliche Handlung des Nutzers ist die staerkste Erlaubnis,
        // die es gibt — sie schaltet den Plan auch dann frei, wenn kein lokaler
        // Beleg vorliegt (anderes Geraet, Privatmodus).
        this._selfInitiated = true
        this.exhausted = false
        this.attempts = 0
        this.error = null
        await this._followUp()
    },

    dismissError() {
        this.error = null
    },

    /** Den benannten Ausweg gehen. Jeder Zweig endet in einer Handlung, keiner in Stille. */
    async resolveError() {
        const escape = this.error?.escape
        const retryAfter = this.error?.retryAfter

        this.error = null

        switch (escape) {
            case 'neu-signieren':
            case 'erneut':
                // Neu SIGNIEREN, nicht neu senden: das alte Event ist beim Verein
                // für 150 s verbrannt. `_followUp` baut jeden Ausweis neu.
                await this._followUp()

                return
            case 'abwarten':
                // Der Knopf zum 429 fasst NICHT sofort nach — das erzeugte nur das
                // nächste 429 und verbrannte eine weitere frische Signatur. Er
                // stellt die Uhr auf `Retry-After` und zeigt damit an, dass etwas
                // passiert; gefragt wird, wenn der Verein wieder bereit ist.
                this._retryAfterMs = (retryAfter ?? 30) * 1000
                this._scheduleFollowUp()

                return
            case 'korrigieren':
                this.phase = 'antrag'

                return
            case 'neue-rechnung':
                await this.newInvoice()

                return
            case 'checkout':
                this.openCheckout()

                return
            case 'neu-anmelden':
                window.location.assign('/nostr-login?reconnect=1')

                return
            case 'neu-laden':
                window.location.reload()

                return
            case 'zurueck':
                this.statutesConfirmed = false
                this._loaded = false
                await this._boot()

                return
            case 'extern':
            default:
                this.openExternal(conf().publicUrl ?? 'https://verein.einundzwanzig.space/', new Event('click'))
        }
    },

    /**
     * Vereins-Link öffnen: nativ über die In-App-Browser-Bridge, im Web normal.
     *
     * Gibt zurück, ob das Öffnen ANGENOMMEN wurde. Im Web ist das exakt:
     * `window.open` liefert `null`, wenn der Popup-Blocker zugeschlagen hat.
     * Nativ ist es optimistisch — die Bridge antwortet asynchron, ein
     * synchrones Ja/Nein gibt es dort nicht; deshalb bleibt [[abortPayment]]
     * auch dann der Ausweg, wenn nichts aufging.
     *
     * Nicht-http(s)-Adressen werden gar nicht erst geöffnet, egal woher sie
     * kommen (siehe `safeExternalUrl`).
     */
    openExternal(url: string, e: Event): boolean {
        if (!safeExternalUrl(url)) {
            return false
        }

        if (isMobile) {
            e.preventDefault?.()
            void nativeBrowserInApp(url)

            return true
        }

        return window.open(url, '_blank', 'noopener') !== null
    },

    // ── Ableitungen fürs Markup ─────────────────────────────────────────────

    feeLabel() {
        if (this.fee === null) {
            return ''
        }

        return this.currency ? `${this.fee} ${this.currency}` : String(this.fee)
    },

    hasFlow() {
        return (conf().api ?? '') !== ''
    },

    /**
     * Die Wallet/Checkout-Weiche — **die eine Stelle**, die sie beantwortet.
     *
     * Vorher stand die Regel zweimal da: einmal hier in `canPayInApp` (ueber alle
     * 2^10 Eingaben geprueft) und einmal als `bolt11 && hasWallet` direkt im
     * Markup. Zwei Formulierungen derselben Regel sind kein Fehler, solange sie
     * uebereinstimmen — sie sind ein Fehler, sobald sich eine aendert. Und
     * geschuetzt war nur die eine: eine Mutation an `canPayInApp` traf keinen
     * einzigen Fall, weil die Flaeche die Frage selbst beantwortete.
     *
     * Jetzt liest das Markup nur noch das Ergebnis. Damit deckt der Reduzierer-
     * Test auch die Flaeche ab, und die Weiche kann nicht mehr an einer Stelle
     * korrigiert und an der anderen vergessen werden.
     *
     * Bewusst eine Methode und kein Feld: nichts am Zustandsautomaten aendert
     * sich, `_recompute` kennt die Frage nicht, es gibt kein drittes Feld, das
     * mit `bolt11`/`hasWallet` synchron gehalten werden muesste — genau das waere
     * wieder eine zweite Wahrheit. Alpine wertet den Aufruf bei jeder Aenderung
     * der gelesenen Felder neu aus, wie bei `feeLabel()` und `stepState()` auch.
     */
    payInApp() {
        return canPayInApp({ bolt11: this.bolt11, checkoutUrl: this.checkoutUrl, invoiceId: null }, this.hasWallet)
    },

    /** Beschriftung des sichtbaren Auswegs — nie leer, solange ein Fehler steht. */
    errorAction() {
        return this.error ? escapeLabel(this.error.escape, t) : ''
    },

    /**
     * Feldfehler aus einem 422, unverändert. Leeres Objekt = keine.
     *
     * Die Konstante statt `?? {}`: ein frisches Objekt pro Auswertung ist für
     * Alpines `x-for` jedes Mal eine neue Liste, die es abbaut und neu aufbaut.
     */
    errorFields() {
        return this.error?.fields ?? NO_FIELDS
    },

    /**
     * Der Feldname eines 422 in der Sprache des Formulars.
     *
     * Der Verein antwortet mit seinen eigenen Schlüsseln (`nip05_handle`,
     * `application_text`). Die unverfälscht anzuzeigen ist gut gemeint — „damit
     * der Nutzer weiß, WAS er ändern soll" — trifft aber daneben: im Formular
     * steht kein Feld namens `nip05_handle`, und ein Fehler, dessen Bezugspunkt
     * man erst raten muss, ist keiner mit Ausweg. Die MELDUNG bleibt
     * unverfälscht; nur die Überschrift bekommt den Namen, der im Formular
     * darüber steht.
     *
     * Unbekannte Schlüssel fallen auf den Rohwert zurück: ein neues Feld beim
     * Verein soll sichtbar bleiben, nicht stillschweigend verschwinden.
     */
    fieldLabel(field: string) {
        switch (field) {
            case 'email':
                return t('E-Mail')
            case 'no_email':
                return t('E-Mail-Adresse angeben')
            case 'nip05_handle':
                return t('Nostr-Adresse / NIP-05')
            case 'application_text':
                return t('Nachricht an den Vorstand')
            case 'statutes_accepted':
                return t('Zustimmung zu den Statuten')
            default:
                return field
        }
    },

    /*
     * ── Die vier ganzen Sätze ────────────────────────────────────────────────
     *
     * Sie stehen hier und nicht mehr im Markup, weil dort ein reaktives
     * `<span x-text>` mitten im Satz stand und ihn damit für jeden Übersetzer in
     * Bruchstücke zerlegte (die lange Begründung: `vereinFlow.ts`, Abschnitt
     * „Ganze Sätze fürs Markup"). Methoden und nicht Felder, aus demselben Grund
     * wie bei `feeLabel()`/`payInApp()`: Alpine wertet sie bei jeder Änderung
     * der gelesenen Felder neu aus, und es entsteht kein zweiter Zustand, der
     * mit `error`/`waitText` synchron gehalten werden müsste.
     *
     * **Zwei davon liefern Stücke statt einer Zeichenkette** (`…Segments()`),
     * weil in ihnen ein Teilstück ausgezeichnet wird. Der Satz bleibt trotzdem
     * EIN Katalogeintrag — geteilt wird erst hinter `t()`, an den
     * Platzhaltern. Das Markup rendert jedes Stück als `x-text`; `x-html` kommt
     * an keiner Stelle vor, und für die beiden Werte aus `GET /config` ist das
     * der eigentliche Punkt.
     */

    /** Die Wartebremse nach einem 429 — leer, solange keine steht. */
    retryLine() {
        return this.error?.retryAfter ? formatRetry(this.error.retryAfter, t) : ''
    },

    /** Fassung und Beschlussdatum der Statuten als ein Satz, in Stücken. */
    statutesSegments() {
        return statutesSegments(this.statutesVersion, this.statutesAdoptedAt, t)
    },

    /** Der Zeichenzähler unter dem Nachrichtenfeld. */
    charCountLine() {
        return formatCharCount(this.applicationText.length, this.applicationTextMax, t)
    },

    /** Die Dauer im Wartezustand — nur gezeigt, wenn `waitText` steht. */
    waitSegments() {
        return waitSentenceSegments(this.waitText, t)
    },

    /**
     * Zustand einer Fortschritts-Marke. Der Weg wird VOLLSTÄNDIG gezeigt, auch
     * die noch nicht erreichten Schritte — wer weiß, wie viel noch kommt, bricht
     * seltener ab. `laden` färbt noch nichts ein: da ist nichts erledigt.
     */
    stepState(step: string) {
        const order = ['statuten', 'antrag', 'zahlung', 'warten']
        const current = this.phase === 'freigeschaltet' ? order.length : order.indexOf(this.phase)
        const index = order.indexOf(step)

        if (current < 0 || index < 0) {
            return 'todo'
        }

        return index < current ? 'done' : index === current ? 'active' : 'todo'
    },

    // ── Innenleben ──────────────────────────────────────────────────────────

    /** `/config` (gecacht) und `/me` holen. Erst danach gilt irgendetwas als bekannt. */
    async _boot() {
        const cached = readCachedConfig()

        if (cached) {
            this._applyConfig(cached)
        }

        const [cfg, me] = await Promise.all([
            cached ? Promise.resolve(null) : call('/config', 'GET', undefined, false),
            call('/me', 'GET'),
        ])

        if (cfg) {
            if (!cfg.ok) {
                this._fail(mapVereinError(cfg.status, cfg.body, cfg.retryAfter, t))
            } else {
                const parsed = readConfig(cfg.body)
                this._applyConfig(parsed)
                writeCachedConfig(parsed)
            }
        }

        if (me.ok) {
            const parsed = readMe(me.body)
            this._statutesAccepted = parsed.statutesAccepted
            this._paid = parsed.paid

            if (parsed.year !== null) {
                this.year = parsed.year
            }
        } else if (me.status !== 404) {
            // 404 heißt hier „noch keine Akte" — das ist der Normalfall für einen
            // Gast und kein Fehler. Alles andere ist einer.
            this._fail(mapVereinError(me.status, me.body, me.retryAfter, t))
        }

        // `loadWallet` entschlüsselt aus dem gehärteten Speicher und kann werfen
        // (fehlender Keystore, gesperrter Storage, beschädigter Eintrag). Ein
        // Wurf hier riss den ganzen Boot mit und ließ die Fläche in `laden`
        // stehen — ohne Fehler und ohne Ausweg. Keine Wallet ist der ehrliche
        // Rückfall: der Checkout-Zweig trägt den Nutzer weiter.
        try {
            this.hasWallet = Boolean(await loadWallet())
        } catch {
            this.hasWallet = false
        }
        this._loaded = true
        this._recompute()

        // Nachfassen, sobald es überhaupt etwas zu erwarten gibt — und das ist
        // NICHT nur „gerade bezahlt".
        //
        // Der zweite Fall ist der, den man leicht übersieht: jemand hat gestern
        // bezahlt und wartet auf den nächtlichen Abgleich. Für ihn ist `paid`
        // wahr und `paymentSent` falsch (nichts gespeichert, kein Rücksprung).
        // Ohne diese Bedingung liefe für ihn kein Plan, also auch kein
        // Reconnect — und auf Buzz bliebe sein Socket nach dem
        // fehlgeschlagenen AUTH dauerhaft blind. Er säße vor einem Bildschirm,
        // der sich nie ändert, obwohl er längst freigeschaltet ist.
        // Eine vom VEREIN bestaetigte Zahlung ist der zweite Beleg neben dem
        // lokalen Eintrag — die kann ein Link nicht fälschen (`readMe` uebernimmt
        // nur ein ausdrueckliches `paid: true`). Genau dieser Fall traegt den
        // Nutzer, der gestern gezahlt hat und heute auf den Abgleich wartet.
        if (this._paid) {
            this._selfInitiated = true
        }

        if (this._paid || this._paymentSent) {
            this._scheduleFollowUp()
        }
    },

    _applyConfig(cfg: ConfigData) {
        this.fee = cfg.fee
        this.currency = cfg.currency ?? ''
        this.year = cfg.year
        this.statutesUrl = cfg.statutesUrl ?? ''
        this.statutesVersion = cfg.statutesVersion ?? ''
        this.statutesAdoptedAt = cfg.statutesAdoptedAt ?? ''
        this.applicationTextMax = cfg.applicationTextMax
        this.optionalFields = cfg.optionalFields
        this._recompute()
    },

    _applyInvoice(invoice: InvoiceData) {
        this.bolt11 = invoice.bolt11
        this.checkoutUrl = invoice.checkoutUrl

        // `sent: false` — die Adresse wird aufgehoben, mehr behauptet der Eintrag
        // an dieser Stelle nicht.
        writeProgress({ year: this.year, checkoutUrl: this.checkoutUrl, paymentSentAt: this._lastAttemptAt, sent: false })

        // Fehlendes Feld und `null` sind derselbe Fall — beide führen in den
        // Checkout. Fehlt AUCH der Checkout, ist der Weg im Client zu Ende und
        // der Ausweg ist der Browser; das ist ein Fehlerzustand mit Ausweg, kein
        // stiller Stillstand.
        // Dieselbe Ableitung wie das Markup — `bolt11`/`checkoutUrl` stehen oben
        // bereits, ein zweiter direkter `canPayInApp`-Aufruf waere wieder eine
        // eigene Formulierung derselben Frage.
        if (!this.payInApp() && !this.checkoutUrl) {
            this._fail({
                status: 0,
                message: t('Der Verein hat keine Zahlungsmöglichkeit geliefert.'),
                escape: 'extern',
            })
        }

        this._recompute()
    },

    /** Zahlung ist raus → Wartezustand, Nachfass-Plan starten. */
    _markPaymentSent() {
        this._paymentSent = true
        // Ab hier hat DIESER Browser den Vorgang begonnen — der Plan darf laufen.
        this._selfInitiated = true
        this._lastAttemptAt = Date.now()
        this.attempts = 0
        this.exhausted = false
        writeProgress({ year: this.year, checkoutUrl: this.checkoutUrl, paymentSentAt: this._lastAttemptAt, sent: true })
        this._recompute()
        this._scheduleFollowUp()
    },

    _scheduleFollowUp() {
        if (this._timer !== null) {
            window.clearTimeout(this._timer)
            this._timer = null
        }

        /*
         * Nichts läuft automatisch, was dieser Browser nicht selbst begonnen hat
         * oder was der Verein nicht bestätigt hat — siehe [[_selfInitiated]].
         * Ohne diesen Riegel genügte ein Link mit `?schritt=warten`, um beim
         * eingeloggten Empfänger bis zu neun signierte Aufrufe auszulösen; mit
         * NIP-46 sind das bis zu neun Bestätigungs-Prompts, die ein Fremder
         * bestellt hat.
         */
        if (!this._selfInitiated) {
            return
        }

        // Ein 429 gibt `Retry-After` mit. Der Wert gilt für genau die nächste
        // Runde und wird dabei verbraucht; danach greift wieder der Plan.
        const forced = this._retryAfterMs
        this._retryAfterMs = null

        // `followUpDelay` befragt den Plan IMMER — auch wenn ein `Retry-After`
        // vorliegt. Das war der Fehler der ersten Fassung (`forced ?? planned`):
        // der Plan ist die einzige Abbruchbedingung, und wer ihn überspringt,
        // hebt die Deckelung genau im Lastfall auf. Details in `vereinFlow.ts`.
        const delay = followUpDelay(this.attempts, forced)

        if (delay === null) {
            this.exhausted = true
            this._recompute()

            return
        }

        this._timer = window.setTimeout(() => {
            void this._followUp()
        }, delay)
    },

    /**
     * Einen Fehler setzen — und, falls er eine Wartezeit vorschreibt, diese
     * gleich mit. Eine einzige Stelle dafür, damit ein `Retry-After` nicht an
     * einem der Aufrufwege verloren geht und der Client dann rät.
     */
    _fail(error: VereinError) {
        this.error = error
        this._retryAfterMs = error.retryAfter !== undefined ? error.retryAfter * 1000 : null
    },

    /**
     * Eine Runde Nachfassen. Was sie tut, hängt davon ab, worauf gerade gewartet
     * wird — und das ist der Grund, warum es EINE Runde ist und nicht zwei
     * Schleifen: solange die Zahlung nicht bestätigt ist, kostet jede Runde eine
     * HTTP-Signatur; danach kostet sie nur noch einen Relay-Handschlag.
     */
    async _followUp() {
        this._lastAttemptAt = Date.now()
        this.attempts += 1
        // Ab hier ist die Runde SICHTBAR. Vorher tat „Jetzt prüfen" am Bildschirm
        // nichts: `busy` wird auf diesem Weg nie gesetzt, der Knopf blieb also
        // unverändert, und ob überhaupt etwas passiert war, erfuhr der Nutzer
        // frühestens beim Stufenwechsel — der oft ausbleibt. Ein Knopf ohne
        // Rückmeldung ist ein Knopf, den man ein zweites Mal drückt.
        this.checking = true

        try {
            await this._runFollowUp()
        } finally {
            this.checking = false
        }
    },

    /** Der Inhalt einer Runde — abgetrennt, damit `checking` genau einen Ein- und
     *  einen Ausstieg hat und kein Rückgabepfad ihn stehen lässt. */
    async _runFollowUp() {
        if (!this._paid) {
            if (this.year === null) {
                this._scheduleFollowUp()

                return
            }

            const res = await call(`/payments/${this.year}/refresh`, 'POST', JSON.stringify({}))

            if (res.ok) {
                this.error = null

                // `refresh` liest den Zahlungsstand beim Zahlungsdienstleister
                // neu ein und antwortet mit dem Ergebnis. Der Client übernimmt
                // NUR ein ausdrückliches `paid: true` — ein fehlendes Feld ist
                // „nicht bekannt", nie „bezahlt". Eine frisch gelieferte
                // Rechnung wird dabei mitgenommen: nach einem Ablauf steht dort
                // eine neue BOLT11, und ohne sie führte der Wallet-Knopf gegen
                // eine tote Rechnung.
                this._paid = readMe(res.body).paid

                const refreshed = readInvoice(res.body)

                if (refreshed.bolt11 || refreshed.checkoutUrl) {
                    this.bolt11 = refreshed.bolt11
                    this.checkoutUrl = refreshed.checkoutUrl ?? this.checkoutUrl
                }
            } else {
                this._fail(mapVereinError(res.status, res.body, res.retryAfter, t))
            }
        }

        if (this._paid) {
            this.error = null
            writeProgress(null)
            await this._reconnectDirectory()
        }

        this._recompute()

        if (!this._access.isMember) {
            this._scheduleFollowUp()
        }
    },

    /**
     * Die relay-signierte Mitgliederliste beobachten — und den Lesezustand von
     * einem Lesefehler trennen.
     */
    _watchDirectory(url: string) {
        this._unsubAccess?.()
        this._controller?.abort()

        if (this._dirTimer !== null) {
            window.clearTimeout(this._dirTimer)
        }

        this._dirFailed = false
        this._access = { gated: false, ready: false, isMember: false }
        this._controller = new AbortController()

        watchSpaceDirectory(url, this._controller.signal)

        this._unsubAccess = deriveVereinAccess(url).subscribe((a: VereinAccess) => {
            this._access = a

            if (a.ready) {
                this._dirFailed = false
            }

            if (a.isMember && !this.memberSince) {
                this.memberSince = true
                writeProgress(null)

                if (this._timer !== null) {
                    window.clearTimeout(this._timer)
                    this._timer = null
                }
            }

            this._recompute()
        })

        this._dirTimer = window.setTimeout(() => {
            if (!this._access.ready) {
                this._dirFailed = true
                this._recompute()
            }
        }, DIRECTORY_TIMEOUT_MS)
    },

    /**
     * Nach der Freischaltung **einen Reconnect**, nicht nur ein neues REQ.
     *
     * P2 hat gemessen: auf Buzz bleibt ein Socket, dessen NIP-42-AUTH als
     * Nicht-Mitglied fehlgeschlagen ist, dauerhaft blind — `AuthState::Failed`
     * ist terminal, der Socket wird aber NICHT geschlossen. Er ist
     * transportgesund und antwortet auf nichts mehr. Ein REQ über denselben
     * Socket liefe also auch nach der Aufnahme ins Leere, und der wartende
     * Nutzer bekäme seine Freischaltung nie zu sehen.
     *
     * `Pool.remove()` räumt den Socket ab und löscht ihn aus der Registry; der
     * nächste `request()` legt einen neuen an, der AUTH sauber durchläuft.
     *
     * Auf zooid ist das nicht nötig (dort prüft der Relay die Mitgliedschaft je
     * REQ neu) — deshalb wird der Abriss dort auch nicht gemacht: er kostet
     * einen NIP-42-Handschlag und damit eine Signatur, und ein Abriss trifft
     * jede andere Subscription auf demselben Relay mit.
     */
    async _reconnectDirectory() {
        const url = get(activeSpace)

        if (!url || this._access.isMember) {
            return
        }

        /*
         * Der Abriss hat eine MINDESTPAUSE — das war die zweite Haelfte von F5.
         *
         * `Pool.remove()` raeumt den Socket ab, und das trifft jede andere
         * Subscription auf demselben Relay mit: sie haelt eine Referenz auf den
         * abgeraeumten Socket und wird nicht wiederbelebt. Dazu kostet jeder
         * Neuaufbau ein NIP-42-AUTH, also eine Signatur. Das ist der Preis
         * dafuer, dass ein Buzz-Socket nach fehlgeschlagenem AUTH dauerhaft
         * blind bleibt (P2) — er ist es wert, aber nicht beliebig oft.
         *
         * Unterhalb der Pause wird nur neu beobachtet statt abgerissen: auf
         * zooid ist das ohnehin der ganze Vorgang, und auf Buzz kostet es
         * nichts, wenn der Socket seit dem letzten Abriss gesund ist.
         */
        const abrissFaellig = reconnectDue(Date.now(), this._lastReconnectAt, RECONNECT_MIN_GAP_MS)

        if (abrissFaellig && (await spaceIsBuzzAsync(url))) {
            this._lastReconnectAt = Date.now()
            this._controller?.abort()
            Pool.get().remove(url)
        }

        this._watchDirectory(url)
    },

    /** Der Schritt-Entscheid — die einzige Stelle, die `phase`/`stage` setzt. */
    _recompute() {
        const view = vereinView({
            loaded: this._loaded,
            statutesAccepted: this._statutesAccepted,
            paid: this._paid,
            statutesConfirmed: this.statutesConfirmed,
            paymentSent: this._paymentSent,
            exhausted: this.exhausted,
            dirGated: this._access.gated,
            dirReady: this._access.ready,
            dirMember: this._access.isMember,
            dirFailed: this._dirFailed,
        })

        this.phase = view.phase
        this.stage = view.stage
    },
})

export function wireVerein(Alpine: { data: (name: string, factory: (...args: unknown[]) => unknown) => void }): void {
    Alpine.data('nostrVerein', createVerein as (...args: unknown[]) => unknown)
}
