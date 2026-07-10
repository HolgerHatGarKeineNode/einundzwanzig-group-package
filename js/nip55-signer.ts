/**
 * Amber NIP-55 Same-Device-Signer (Offline) — als `window.nostr`-Shim.
 *
 * Statt welshman-Interna anzufassen, stellen wir auf dem Gerät ein NIP-07-`window.nostr`
 * bereit, dessen Operationen NICHT über Relays, sondern über die native ContentResolver-
 * Bridge (Plugin `AmberSigner.*`) laufen. Damit funktioniert welshmans bestehender
 * `loginWithNip07`/`Nip07Signer`-Pfad unverändert — nur dass Amber lokal (App-zu-App)
 * signiert. ContentResolver ist synchron ⇒ `sign()` löst in-page auf, KEINE Navigation.
 *
 * Login (einmalig, sichtbar): `AmberSigner.RequestPublicKey` öffnet Amber mit der
 * vollständigen Perm-Liste; Amber merkt sie sich und liefert den pubkey per Custom-
 * Scheme-Callback zurück. Danach signiert Amber still per ContentResolver.
 * Fallback bleibt der Relay-NIP-46-Weg (nostrconnect), wenn kein lokaler Signer da ist.
 */
import { pubkey } from '@welshman/app'
import * as nip19 from 'nostr-tools/nip19'
import { nativeCall, isMobile } from './core'
import { NIP46_PERMS, permsToNip55Json } from './nip46-perms'

const AMBER_PACKAGE = 'com.greenart7c3.nostrsigner'

/** Events, unter denen der native Coordinator seine Ergebnisse zurückliefert. */
const PUBLIC_KEY_EVENT = 'AmberSigner.PublicKeyReceived'
const SIGNER_RESULT_EVENT = 'AmberSigner.SignerResult'

type SignerOp = 'sign_event' | 'nip44_encrypt' | 'nip44_decrypt'

let opSeq = 0

type EventPayload = { pubkey?: string; id?: string; event?: string; result?: string; rejected?: boolean }

/**
 * Backstop-Timeout: verlässt der Nutzer Amber ohne Ergebnis (Home/Wegwischen), kommt NIE
 * ein native-event. Großzügig (der Nutzer darf sich am Amber-Prompt Zeit lassen), aber
 * endlich — sonst hängt der Promise + Listener ewig (bes. der Login-Pfad, den welshmans
 * 30s-Sign-Timeout NICHT abdeckt).
 */
const COORDINATOR_TIMEOUT_MS = 180_000

/**
 * Öffnet einen nativen Coordinator-Call (startActivityForResult) und wartet in-page auf
 * dessen `native-event`-Rückgabe — KEINE Navigation. `belongsToRequest` blendet Events
 * fremder Anfragen aus (Weiterlauschen, z. B. bis die passende `id` kommt); `extract`
 * zieht aus der Payload den Erfolgswert oder wirft bei Ablehnung. Listener + Timeout werden
 * in JEDEM Ausgang aufgeräumt (Treffer, Ablehnung, nativeCall-Fehler, Zeitüberschreitung).
 */
function awaitCoordinatorResult<T>(
    nativeMethod: string,
    params: Record<string, unknown>,
    resultEvent: string,
    belongsToRequest: (payload: EventPayload) => boolean,
    extract: (payload: EventPayload) => T,
): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        let timer: ReturnType<typeof setTimeout>
        const cleanup = () => {
            document.removeEventListener('native-event', handler)
            clearTimeout(timer)
        }
        const handler = (e: Event) => {
            const detail = (e as CustomEvent).detail as { event?: string; payload?: EventPayload } | undefined
            const payload = detail?.payload ?? {}
            if (detail?.event !== resultEvent || !belongsToRequest(payload)) {
                return
            }
            cleanup()
            try {
                resolve(extract(payload))
            } catch (err) {
                reject(err instanceof Error ? err : new Error(String(err)))
            }
        }
        document.addEventListener('native-event', handler)
        timer = setTimeout(() => {
            cleanup()
            reject(new Error('Amber: Zeitüberschreitung — bitte erneut versuchen.'))
        }, COORDINATOR_TIMEOUT_MS)
        void nativeCall(nativeMethod, params).catch((err) => {
            cleanup()
            reject(err instanceof Error ? err : new Error(String(err)))
        })
    })
}

/**
 * Sichtbare interaktive Signer-Op via startActivityForResult — der Fallback, wenn
 * ContentResolver `authorized:false` liefert (Aktion nicht vorab gewährt, z. B. Amber-
 * Policy „manually approve"). Amber promptet den Nutzer; das Ergebnis kommt in-page als
 * `native-event` zurück (per `id` zugeordnet). Liefert das Ergebnis-Feld (signiertes Event
 * bei sign_event, Ciphertext/Klartext bei nip44).
 */
function intentSignerOp(op: SignerOp, payload: string, currentUser: string, counterparty?: string): Promise<string> {
    const id = `op-${++opSeq}-${Math.random().toString(36).slice(2)}`
    return awaitCoordinatorResult(
        'AmberSigner.RequestSignerOp',
        { type: op, payload, currentUser, pubkey: counterparty, id, amberPackage: AMBER_PACKAGE },
        SIGNER_RESULT_EVENT,
        (p) => p.id === id,
        (p) => {
            const value = op === 'sign_event' ? p.event : p.result
            if (p.rejected || value == null) {
                throw new Error('Amber: Anfrage abgelehnt.')
            }
            return value
        },
    )
}

/** npub oder hex → validierter hex-pubkey (wirft bei ungültig). */
export function normalizePubkey(input: string): string {
    const trimmed = input.trim()
    const hex = trimmed.startsWith('npub1') ? (nip19.decode(trimmed).data as string) : trimmed
    const lower = hex.toLowerCase()
    if (!/^[0-9a-f]{64}$/.test(lower)) {
        throw new Error('Ungültiger pubkey von Amber.')
    }
    return lower
}

/** Ist ein lokaler NIP-55-Signer (Amber) installiert? Nur auf dem Gerät sinnvoll. */
export async function nip55Available(): Promise<boolean> {
    if (!isMobile) {
        return false
    }
    try {
        const res = (await nativeCall('AmberSigner.IsInstalled', { amberPackage: AMBER_PACKAGE })) as { installed?: boolean } | null
        return res?.installed === true
    } catch {
        return false
    }
}

type CrResult = { authorized?: boolean; rejected?: boolean; result?: string; event?: string } | null

/**
 * Installiert `window.nostr`, gebacked von der nativen Amber-Bridge. Muss auf dem Gerät
 * VOR welshmans Signer-Rekonstruktion laufen (session.ts Boot).
 *
 * Jede Operation versucht zuerst den SYNCHRONEN ContentResolver (offline, still); ist die
 * Aktion NICHT vorab gewährt (authorized:false, z. B. Amber-Policy „manually approve"),
 * fällt sie auf den sichtbaren interaktiven Intent-Prompt zurück (statt Sackgasse). Das
 * deckt die KOMPLETTE Signier-Fläche ab, die welshmans Nip07Signer nutzt: `signEvent`
 * (JEDER Event-Kind) + `nip44` encrypt/decrypt. `getPublicKey` liest nur den welshman-
 * pubkey (kein Prompt). `nip04` nutzt der Client nicht (Stub).
 */
export function installNip55WindowNostr(): void {
    const currentUser = () => pubkey.get() ?? ''
    // ContentResolver zuerst; bei authorized:false → interaktiver Intent-Fallback.
    const crThenFallback = async (
        crMethod: string,
        crParams: Record<string, unknown>,
        field: 'result' | 'event',
        fallback: () => Promise<string>,
    ): Promise<string> => {
        const res = (await nativeCall(crMethod, { ...crParams, currentUser: currentUser(), amberPackage: AMBER_PACKAGE })) as CrResult
        if (res?.rejected) {
            throw new Error('Amber: Anfrage abgelehnt.')
        }
        if (res?.authorized && res[field] != null) {
            return res[field] as string
        }
        return fallback()
    }
    const win = window as unknown as { nostr?: unknown }
    win.nostr = {
        getPublicKey: async () => currentUser(),
        signEvent: async (event: unknown) => {
            const eventJson = JSON.stringify(event)
            return JSON.parse(
                await crThenFallback('AmberSigner.SignEvent', { event: eventJson }, 'event', () =>
                    intentSignerOp('sign_event', eventJson, currentUser()),
                ),
            )
        },
        nip44: {
            encrypt: (pk: string, plaintext: string) =>
                crThenFallback('AmberSigner.Nip44Encrypt', { plaintext, pubkey: pk }, 'result', () =>
                    intentSignerOp('nip44_encrypt', plaintext, currentUser(), pk),
                ),
            decrypt: (pk: string, ciphertext: string) =>
                crThenFallback('AmberSigner.Nip44Decrypt', { ciphertext, pubkey: pk }, 'result', () =>
                    intentSignerOp('nip44_decrypt', ciphertext, currentUser(), pk),
                ),
        },
        nip04: {
            encrypt: async () => {
                throw new Error('nip04 wird nicht unterstützt.')
            },
            decrypt: async () => {
                throw new Error('nip04 wird nicht unterstützt.')
            },
        },
    }
}

/**
 * Sichtbarer Amber-Login (get_public_key + Perms merken) via startActivityForResult.
 * Der native Coordinator registriert die App in Amber (nötig fürs ContentResolver-
 * Signieren) und liefert den pubkey async als `native-event` zurück — IN-PAGE, ohne
 * Navigation. Resolved mit dem hex-pubkey; rejected bei Ablehnung/Abbruch/Fehler.
 */
export function startNip55Login(): Promise<string> {
    return awaitCoordinatorResult(
        'AmberSigner.RequestPublicKey',
        { permissions: permsToNip55Json(NIP46_PERMS), appName: 'EINUNDZWANZIG', amberPackage: AMBER_PACKAGE },
        PUBLIC_KEY_EVENT,
        () => true,
        (payload) => {
            if (payload.rejected || !payload.pubkey) {
                throw new Error('Amber-Login abgebrochen oder abgelehnt.')
            }
            return normalizePubkey(String(payload.pubkey))
        },
    )
}
