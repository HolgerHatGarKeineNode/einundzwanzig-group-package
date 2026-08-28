/**
 * Fassade: Identität und Signieren — **die eine Stelle, an der der Identitätswechsel
 * entschieden wird.**
 *
 * ── Was 0.9.5 hier weggenommen hat ───────────────────────────────────────────────
 * Die Stores `pubkey`/`signer`/`sessions` gibt es nicht mehr. Eine App-Instanz ist an
 * **genau eine** Identität gebunden: `app.user` ist eine `User`-Property (Pubkey +
 * Signer), kein Store, und `User.pubkey` ist `readonly`. Login/Logout sind
 * Anwendungssache über die Handler-Registry (`registerSessionHandler`,
 * `nip01`/`nip07`/`nip46`/`nip55`/`pomade`).
 *
 * ── Warum die Stores hier trotzdem weiterleben ───────────────────────────────────
 * Weil **29 Dateien** sie reaktiv lesen — `pubkey` steht in `derived([...])`-Listen quer
 * durch das Paket. 0.9.5 bietet für den Wechsel kein reaktives Primitiv an; sein Weg ist,
 * die App zu ERSETZEN. Genau das passiert hier: die Stores sind die Wahrheit über „wer
 * ist angemeldet", und jede Änderung an ihnen tauscht die App-Instanz aus
 * ({@link setzeIdentitaet} in `js/welshmanInstance.ts`, Risiko R4 des Sprung-Plans).
 *
 * Die Kopplung läuft über ein Abo und nicht über die `loginWith*`-Funktionen, und das
 * ist wichtig: `js/session.ts` bindet `pubkey` und `sessions` per `sync()` an den
 * localStorage. Nach einem Reload kommt die Identität also aus dem Speicher, ohne dass
 * irgendein `loginWith*` läuft — das Abo deckt beide Wege mit einer Regel ab.
 *
 * ── Das persistierte Session-Format bleibt das von 0.8.16, mit Absicht ───────────
 * 0.8.16 speichert flach (`{method, pubkey, secret?, handler:{pubkey,relays}}`), 0.9.5
 * verschachtelt (`{method, data}`). Beides steht unter demselben localStorage-Schlüssel
 * `sessions`. Würden wir auf die neue Form umstellen, wäre **jeder angemeldete Nutzer
 * beim nächsten Deploy ausgeloggt** — sein gespeicherter Eintrag passte auf keinen
 * Handler mehr, und bei NIP-46 wäre auch das Bunker-Geheimnis verloren.
 *
 * Deshalb: das Format auf der Platte bleibt, und {@link signerFuerSession} übersetzt es
 * beim Lesen in die 0.9.5-Handler-Form. Die Registry wird dabei wirklich benutzt
 * (`getSignerFromSession`), nicht umgangen — nur die Serialisierung ist unsere.
 *
 * ── Abgrenzung zu `js/session.ts` ────────────────────────────────────────────────
 * Dort liegt UNSERE Login-Logik (Signer-Auswahl, NIP-46-Broker, localStorage-Bindung,
 * Logout-Aufräumen). Hier liegt nur der welshman-Zugang, den `session.ts` und die Leser
 * gemeinsam benutzen. Wer Login auslösen will, ruft `js/session.ts` — nicht die
 * `loginWith*` von hier.
 */
import { derived, get, writable, type Readable } from 'svelte/store'
import { withGetter, type ReadableWithGetter, type WritableWithGetter } from '@welshman/store'
import {
    User,
    getSignerFromSession,
    nip01,
    nip07,
    nip46,
    toSession,
    Logger,
    Plaintext,
} from '@welshman/app'
import type { ISigner } from '@welshman/signer'
import { getPubkey, type StampedEvent } from '@welshman/util'
import { app, appStore, setzeIdentitaet } from './welshmanInstance.ts'

/**
 * Eine gespeicherte Sitzung in **unserem** Format — das flache von 0.8.16, siehe
 * Modulkopf. `method` ist das Feld, das `js/session.ts` liest (Signer-Label,
 * NIP-46-Perms-Nudge, das NIP-55-Gate auf dem Gerät).
 */
export type Session = {
    method: string
    pubkey: string
    secret?: string
    handler?: { pubkey: string; relays: string[] }
}

/**
 * Der angemeldete Pubkey, reaktiv. An localStorage gebunden von `js/session.ts`.
 *
 * `withGetter`, weil 24 Leser `pubkey.get()` synchron aufrufen — das kam in 0.8.16
 * daher, dass welshman seine Stores selbst so verpackte (`app/src/session.js:19`). Der
 * Helfer liegt unverändert in `@welshman/store`; die Aufrufstellen bleiben, wie sie sind.
 */
export const pubkey: WritableWithGetter<string | undefined> = withGetter(writable<string | undefined>(undefined))

/** Alle bekannten Sitzungen, nach Pubkey. Ebenfalls an localStorage gebunden. */
export const sessions: WritableWithGetter<Record<string, Session>> = withGetter(
    writable<Record<string, Session>>({}),
)

/**
 * Aus einer gespeicherten Sitzung den Signer bauen — über die 0.9.5-Handler-Registry.
 *
 * `pomade` und `nip55` fehlen hier bewusst: `pomade` benutzen wir nicht, und unser
 * NIP-55-Login (Amber same-device) läuft über den `nip07`-Weg mit einem eigenen
 * `window.nostr`-Shim (`js/nip55-signer.ts`) — so steht es seit jeher in den
 * gespeicherten Sitzungen und daran ändert der Sprung nichts.
 */
const signerFuerSession = (session: Session | undefined): ISigner | undefined => {
    if (!session) {
        return undefined
    }
    switch (session.method) {
        case 'nip01':
            return session.secret
                ? (getSignerFromSession(toSession(nip01, { secret: session.secret })) as ISigner)
                : undefined
        case 'nip07':
            return getSignerFromSession(toSession(nip07, {})) as ISigner
        case 'nip46':
            return session.secret && session.handler
                ? (getSignerFromSession(
                      toSession(nip46, {
                          clientSecret: session.secret,
                          signerPubkey: session.handler.pubkey,
                          relays: session.handler.relays,
                      }),
                  ) as ISigner)
                : undefined
        default:
            return undefined
    }
}

/**
 * Der aktive Signer, reaktiv — abgeleitet aus Pubkey + Sitzung, genau wie in 0.8.16.
 *
 * **Bewusst `new User(pk, signer)` und nicht `User.fromSigner(signer)`:** letzteres ist
 * `async` und fragt den Signer nach seinem Pubkey. Bei NIP-07 wäre das ein Aufruf an die
 * Browser-Erweiterung bei jedem Boot — bei NIP-46 sogar ein Netz-Roundtrip zum Bunker,
 * bevor die Oberfläche überhaupt weiss, wer angemeldet ist. Wir kennen den Pubkey
 * bereits: er steht im Store und kommt aus dem localStorage. Genau so machte es 0.8.16.
 */
export const signer: ReadableWithGetter<ISigner | undefined> = withGetter(
    derived([pubkey, sessions], ([$pubkey, $sessions]) =>
        $pubkey ? signerFuerSession($sessions[$pubkey]) : undefined,
    ),
)

/**
 * Die Kopplung: jede Änderung an Pubkey oder Sitzung setzt die App-Identität neu.
 *
 * Steht im Modul-Toplevel, weil sie ab dem ersten Import gelten muss — `js/session.ts`
 * hydriert die Stores aus dem localStorage in einem Microtask nach dem Modul-Eval, und
 * bis dahin darf keine Anfrage mit der falschen Identität hinausgehen.
 *
 * `setzeIdentitaet` ist gegen Wiederholung mit demselben Nutzer geschützt, dieses Abo
 * feuert also nicht bei jedem Store-Schreiben eine neue App.
 */
signer.subscribe(($signer) => {
    const pk = get(pubkey)
    setzeIdentitaet(pk && $signer ? new User(pk, $signer) : undefined)
})

/** Zum Signieren aus Fremdcode. 0.9.5: `User.require(app).sign(event)`. */
export const sign = async (event: StampedEvent) => {
    const user = app.user
    if (!user) {
        throw new Error('Kein aktiver Signer.')
    }

    return user.sign(event)
}

/** NIP-44 an sich selbst (verschlüsselte eigene Daten). 0.9.5: Methode am `User`. */
export const nip44EncryptToSelf = async (payload: string): Promise<string> => {
    const user = app.user
    if (!user) {
        throw new Error('Kein aktiver Signer.')
    }

    return user.nip44EncryptToSelf(payload)
}

/** Klartext-Cache um eine Entschlüsselung. 0.9.5: `app.use(Plaintext).ensure(…)`. */
export const ensurePlaintext = (ciphertext: string, decrypt: () => Promise<string>): Promise<string> =>
    app.use(Plaintext).ensure(ciphertext, decrypt)

const login = (session: Session): void => {
    sessions.update(($sessions) => ({ ...$sessions, [session.pubkey]: session }))
    pubkey.set(session.pubkey)
}

/** NIP-01: roher Schlüssel im localStorage. Nur für Tests — siehe `js/session.ts`. */
export const loginWithNip01 = (secret: string): void =>
    login({ method: 'nip01', pubkey: getPubkey(secret), secret })

/** NIP-07: Browser-Erweiterung. Auf dem Gerät zugleich unser NIP-55-Weg (Amber-Shim). */
export const loginWithNip07 = (pk: string): void => login({ method: 'nip07', pubkey: pk })

/** NIP-46: Bunker/nostrconnect. `clientSecret` und Signer-Relays gehören zur Sitzung. */
export const loginWithNip46 = (
    pk: string,
    clientSecret: string,
    signerPubkey: string,
    relays: string[],
): void => login({ method: 'nip46', pubkey: pk, secret: clientSecret, handler: { pubkey: signerPubkey, relays } })

/**
 * Sitzung beenden. Räumt den Signer ab, falls er etwas hält (der NIP-46-Broker hält eine
 * Relay-Verbindung), und leert die Stores — der App-Austausch folgt über das Abo oben.
 */
export const dropSession = (pk: string): void => {
    const aktiv = get(signer) as (ISigner & { cleanup?: () => void }) | undefined
    if (get(pubkey) === pk) {
        aktiv?.cleanup?.()
    }
    sessions.update(($sessions) => {
        const rest = { ...$sessions }
        delete rest[pk]

        return rest
    })
    pubkey.update(($pubkey) => ($pubkey === pk ? undefined : $pubkey))
}

/**
 * Signer-Diagnose (`js/signer-health.ts`).
 *
 * In 0.8.16 war das ein eigener Store mit aggregierten Einträgen
 * (`{started_at, finished_at?, ok?}`). In 0.9.5 schreibt `appPolicyLogSignerMethods`
 * einen **Ereignisstrom** in den `Logger` der App: je Operation ZWEI Zeilen mit
 * derselben `id` — erst `status: 'pending'`, dann `'success'` oder `'failure'`.
 *
 * **Die Aggregation macht bewusst der Leser, nicht dieser Adapter.** Sie ist die Logik
 * von `signer-health.ts` (welche Operation gilt als hängend, was ist „kürzlich"), und
 * eine Hülle hier hätte sie nur verdeckt und zweimal übersetzt.
 *
 * `appStore`, weil der Logger der App-Instanz gehört: nach einem Identitätswechsel soll
 * das Protokoll das des neuen Signers sein.
 */
export type SignerLogEntry = {
    id: string
    at: number
    method: string
    status: 'pending' | 'success' | 'failure'
    error?: unknown
}

export const signerLog: ReadableWithGetter<SignerLogEntry[]> = withGetter(
    appStore<SignerLogEntry[]>(
    (a) =>
        derived(a.use(Logger).messages.$, ($messages) =>
                $messages.filter((m) => m.source === 'signer') as unknown as SignerLogEntry[],
            ),
        [],
    ),
)
