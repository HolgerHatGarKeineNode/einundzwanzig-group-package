/**
 * Der Ladeweg für auth-pflichtige Medien: `fetch` mit Blossom-Header → `blob:`-URL.
 * Die Form des Auth-Events steht in [[blossomAuth]], die Verdrahtung an Alpine in
 * `bridge.ts`, die Fläche in `components/nostr-avatar.blade.php`.
 *
 * **Fabrik statt Modul-Singleton**: alles Netz-, Zeit- und Browser-Nahe kommt als
 * Abhängigkeit herein. Damit ist der ganze Ablauf unter `node --test` prüfbar — ohne
 * `fetch`, ohne `URL.createObjectURL`, ohne Signer. Die eine echte Instanz baut
 * `bridge.ts`.
 *
 * ── Die vier Regeln, die dieses Modul einhalten MUSS ──
 *
 * 1. **Eine Signatur pro Origin und Zeitfenster.** Ein Auth-Event mit `server`-Tag
 *    deckt alle Blobs eines Hosts ab (gemessen, siehe [[blossomAuth]]). Bei NIP-46
 *    kostet jede Signatur eine Nutzer-Bestätigung: eine Maintainer-Zeile mit zehn
 *    Gesichtern darf nicht zehn Abfragen auslösen. Deshalb Cache **und**
 *    In-Flight-Bündelung — zehn gleichzeitige Anfragen warten auf DIESELBE Signatur.
 * 2. **Kein Wiederhol-Sturm.** 401/403/404 heißt „für diesen Nutzer nicht verfügbar":
 *    gemerkt, Initiale, fertig. Kein zweiter Versuch für dieselbe URL.
 * 3. **`blob:` wieder freigeben.** Sonst wächst der Speicher mit jedem Raumwechsel.
 *    Der Cache ist nach BLOB-URL gedeckelt und gibt beim Verdrängen frei.
 * 4. **Ohne Signer-Sitzung wird nicht einmal signiert.** Gast, ausgeloggt, Signer
 *    verweigert → still die Initiale. Das ist der korrekte Zustand, kein Fehler:
 *    diese Bilder sind ohne Mitgliedschaft schlicht nicht lesbar.
 */
import { blossomAuthHeader, isAuthEventUsable, makeBlossomAuthTemplate, mediaOriginOf, type SignedLike, type SignFn } from './blossomAuth.ts'

/** Nur das, was dieses Modul von einer `fetch`-Antwort braucht. */
export type BlossomResponse = {
    ok: boolean
    status: number
    blob: () => Promise<unknown>
}

export type BlossomDeps = {
    /** Braucht diese URL den Blossom-Weg? (Bild-Origin == Origin des Space-Relays.) */
    isProtected: (url: string) => boolean
    /**
     * Der Pubkey der laufenden Sitzung, `''` wenn keine da ist.
     *
     * **Kein `hasSession(): boolean`.** Ein Auth-Event mit `server`-Tag ist kein
     * Ticket für ein Bild, sondern ein Lese-Bearer für den ganzen Medien-Endpunkt,
     * 45 Minuten lang. Ein bloßes „ja/nein" könnte den Wechsel von Alice zu Bob nicht
     * erkennen — und ohne Seiten-Reload läge Alices Bearer weiter im Modul. Die
     * Identität ist deshalb Teil der Frage, nicht nur ihre Anwesenheit.
     */
    sessionPubkey: () => string
    /** Der Signer der Sitzung — derselbe Weg wie bei jedem Publish. */
    sign: SignFn
    /** `fetch`, auf das Nötige verengt. */
    fetchMedia: (url: string, authorization: string) => Promise<BlossomResponse>
    createObjectURL: (blob: unknown) => string
    revokeObjectURL: (objectUrl: string) => void
    /** Sekunden seit Epoch. */
    now: () => number
    /** Wie viele `blob:`-URLs gleichzeitig offen bleiben dürfen. */
    maxCached?: number
    /** Wartezeit nach einer abgelehnten/fehlgeschlagenen Signatur (Sekunden). */
    signCooldownSeconds?: number
}

/** Der Zustand, den die Avatar-Fläche für ein Bild führt (Alpine-`x-data`). */
export type AvatarState = {
    imgOrig: boolean
    imgBroken: boolean
    needsAuth: boolean
    authSrc: string
}

export type BlossomLoader = {
    needsAuth: (url: unknown) => boolean
    /** `blob:`-URL oder `''` — `''` heißt immer „zeig die Initiale". */
    load: (url: unknown) => Promise<string>
    /** Alle offenen `blob:`-URLs freigeben (Abmelden, Testende). */
    revokeAll: () => void
}

const DEFAULT_MAX_CACHED = 200
const DEFAULT_SIGN_COOLDOWN = 60

export const makeBlossomLoader = (deps: BlossomDeps): BlossomLoader => {
    const maxCached = deps.maxCached ?? DEFAULT_MAX_CACHED
    const signCooldown = deps.signCooldownSeconds ?? DEFAULT_SIGN_COOLDOWN
    /** Die Sitzung, zu der der aktuelle Zustand gehört. Wechselt sie, ist er hinfällig. */
    let sitzung = deps.sessionPubkey()

    /** origin → zuletzt signiertes Auth-Event (wird wiederverwendet, solange gültig). */
    const authByOrigin = new Map<string, SignedLike>()
    /** origin → laufende Signatur. Bündelt gleichzeitige Anfragen auf EINE Bestätigung. */
    const signingByOrigin = new Map<string, Promise<string>>()
    /** origin → Sekunde, ab der wieder signiert werden darf (nach Ablehnung). */
    const signBlockedUntil = new Map<string, number>()
    /** URL → `blob:`-URL, in Einfügereihenfolge (die älteste fliegt zuerst raus). */
    const blobByUrl = new Map<string, string>()
    /** URL → laufender Ladevorgang. */
    const loadingByUrl = new Map<string, Promise<string>>()
    /** URLs, die der Server für diesen Nutzer abgelehnt hat. Endgültig, siehe Regel 2. */
    const rejected = new Set<string>()

    const remember = (url: string, objectUrl: string): void => {
        blobByUrl.set(url, objectUrl)
        while (blobByUrl.size > maxCached) {
            const oldest = blobByUrl.keys().next().value as string | undefined
            if (oldest === undefined) {
                break
            }
            const stale = blobByUrl.get(oldest)
            blobByUrl.delete(oldest)
            if (stale) {
                deps.revokeObjectURL(stale)
            }
        }
    }

    /**
     * Alles wegwerfen, was zu einer Sitzung gehört: die `blob:`-URLs (sonst wächst der
     * Speicher und die Medien des vorigen Nutzers bleiben abrufbar), **und** die Mittel,
     * sie erneut zu holen — Auth-Events, Ablehnungen, Sperrfristen. Vorher räumte das
     * Abmelden nur die Blobs: die Bilder waren weg, der Bearer nicht.
     */
    const raeumen = (): void => {
        for (const objectUrl of blobByUrl.values()) {
            deps.revokeObjectURL(objectUrl)
        }
        blobByUrl.clear()
        authByOrigin.clear()
        rejected.clear()
        signBlockedUntil.clear()
    }

    /**
     * Hat die Sitzung gewechselt, ist der ganze Zustand hinfällig.
     *
     * Steht hier und nicht nur im Abmelde-Pfad der App, weil dieser Pfad ausfallen
     * kann: `doLogout` navigiert nach einem Netzfehler nicht mehr (in `bridge.ts`
     * behoben), und ohne den Seiten-Reload überlebt der Modulzustand den Wechsel.
     * Eine Zusicherung, die an einem gelingenden Reload hängt, ist keine.
     */
    const sitzungPruefen = (): void => {
        const jetzt = deps.sessionPubkey()
        if (jetzt !== sitzung) {
            sitzung = jetzt
            raeumen()
        }
    }

    /**
     * Der `Authorization`-Wert für einen Host — signiert höchstens einmal je
     * Zeitfenster. `''` heißt „geht gerade nicht" und ist KEIN Fehler: der Aufrufer
     * fällt still auf die Initiale zurück und darf es später wieder versuchen (nach
     * dem Login zum Beispiel), ohne dass etwas endgültig gemerkt wurde.
     */
    const headerFor = async (origin: string): Promise<string> => {
        // **Die Sitzungsfrage steht VOR dem Cache-Treffer**, nicht dahinter. Genau
        // andersherum war sie unerreichbar, sobald einmal signiert worden war: nach
        // dem Abmelden lieferte der Cache Alices Bearer weiter — 45 Minuten lang, an
        // wen auch immer die Seite danach zeigte.
        if (deps.sessionPubkey() === '') {
            return ''
        }
        const cached = authByOrigin.get(origin)
        if (isAuthEventUsable(cached, deps.now())) {
            return blossomAuthHeader(cached as SignedLike)
        }
        const running = signingByOrigin.get(origin)
        if (running) {
            return running
        }
        if ((signBlockedUntil.get(origin) ?? 0) > deps.now()) {
            return ''
        }
        const pending = (async (): Promise<string> => {
            try {
                const signed = await deps.sign(makeBlossomAuthTemplate(origin, deps.now()))
                if (!signed?.sig) {
                    throw new Error('kein signiertes Auth-Event')
                }
                authByOrigin.set(origin, signed)
                return blossomAuthHeader(signed)
            } catch {
                // Abgelehnt oder Signer weg. Eine Sperrfrist statt eines Merkers: der
                // Nutzer darf seine Meinung ändern, aber nicht pro Avatar gefragt werden.
                signBlockedUntil.set(origin, deps.now() + signCooldown)
                return ''
            } finally {
                signingByOrigin.delete(origin)
            }
        })()
        signingByOrigin.set(origin, pending)
        return pending
    }

    const fetchOne = async (url: string): Promise<string> => {
        const origin = mediaOriginOf(url)
        const authorization = await headerFor(origin)
        if (!authorization) {
            return ''
        }
        let response: BlossomResponse
        try {
            response = await deps.fetchMedia(url, authorization)
        } catch {
            // Netzfehler: NICHT als Ablehnung merken, aber auch nicht wiederholen —
            // der nächste Seitenaufbau versucht es erneut.
            return ''
        }
        if (!response.ok) {
            rejected.add(url)
            if (response.status === 401) {
                // Einzige Erklärung neben „kein Mitglied": das Auth-Event ist doch
                // abgelaufen. Einmal wegwerfen, damit das nächste Bild frisch signiert —
                // diese URL bleibt trotzdem gemerkt, sonst entstünde eine Schleife.
                authByOrigin.delete(origin)
            }
            return ''
        }
        try {
            const objectUrl = deps.createObjectURL(await response.blob())
            remember(url, objectUrl)
            return objectUrl
        } catch {
            return ''
        }
    }

    return {
        needsAuth: (url: unknown): boolean => typeof url === 'string' && url !== '' && deps.isProtected(url),

        load: async (url: unknown): Promise<string> => {
            sitzungPruefen()
            if (typeof url !== 'string' || url === '' || !deps.isProtected(url)) {
                return ''
            }
            const cached = blobByUrl.get(url)
            if (cached) {
                return cached
            }
            if (rejected.has(url)) {
                return ''
            }
            const running = loadingByUrl.get(url)
            if (running) {
                return running
            }
            const pending = fetchOne(url).finally(() => {
                loadingByUrl.delete(url)
            })
            loadingByUrl.set(url, pending)
            return pending
        },

        revokeAll: (): void => {
            raeumen()
        },
    }
}

/**
 * Die Brücke zur Fläche: schreibt den Ladezustand EINES Bildes in den Alpine-Zustand
 * eines Avatars. `bridge.ts` hängt sie als `$blossomBind($data, url)` in ein
 * `x-effect`; hier steht sie, damit die Zustandsfolge ohne Browser prüfbar ist.
 *
 * **Wichtig ist, was NICHT passiert:** solange `authSrc` leer ist, meldet die Fläche
 * über `needsAuth` „noch kein Bild" und erzeugt **kein** `<img>`. Ohne diese
 * Zwischenstufe liefe pro Avatar erst der Bild-Proxy und dann die rohe URL in je ein
 * 401 — zwei Anfragen pro Gesicht, und am Ende doch die Initiale.
 */
export const bindAvatarState = (loader: BlossomLoader, state: AvatarState, url: unknown): void => {
    state.imgOrig = false
    state.imgBroken = false
    state.authSrc = ''
    state.needsAuth = loader.needsAuth(url)
    if (!state.needsAuth) {
        return
    }
    void loader.load(url).then((objectUrl: string) => {
        state.authSrc = objectUrl
        // Kein Bild heisst Initiale — und zwar erst jetzt, nicht schon beim Start:
        // ein sofortiges `imgBroken` liesse den Avatar bei jedem Rendern flackern.
        state.imgBroken = objectUrl === ''
    })
}
