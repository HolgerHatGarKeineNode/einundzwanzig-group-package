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
import { nativeCall, isMobile } from './core'
import { NIP46_PERMS, permsToNip55Json } from './nip46-perms'

const AMBER_PACKAGE = 'com.greenart7c3.nostrsigner'

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

/** Fehler, wenn Amber eine per ContentResolver angefragte Aktion NICHT vorab gewährt hat. */
export class Nip55NotAuthorizedError extends Error {
    constructor() {
        super('Amber: Aktion nicht vorab erlaubt — bitte neu verbinden und alle Berechtigungen gewähren.')
        this.name = 'Nip55NotAuthorizedError'
    }
}

type CrResult = { authorized?: boolean; rejected?: boolean; result?: string; event?: string } | null

/** Wertet eine ContentResolver-Antwort aus: wirft bei Ablehnung/fehlender Autorisierung, sonst liefert das Feld. */
function readCr(res: CrResult, field: 'result' | 'event'): string {
    if (res?.rejected) {
        throw new Error('Amber: Anfrage abgelehnt.')
    }
    if (!res?.authorized || res[field] == null) {
        throw new Nip55NotAuthorizedError()
    }
    return res[field] as string
}

/**
 * Installiert `window.nostr`, gebacked von der nativen Amber-ContentResolver-Bridge.
 * Muss auf dem Gerät VOR welshmans Signer-Rekonstruktion laufen (core.ts, Boot).
 * `getPubkey` liest den aktuellen welshman-pubkey (überlebt Reload via localStorage).
 */
export function installNip55WindowNostr(): void {
    const currentUser = () => pubkey.get() ?? ''
    // Jeder ContentResolver-Aufruf trägt implizit currentUser + amberPackage und wird
    // durch readCr (wirft bei Ablehnung/fehlender Autorisierung) ausgewertet — hier gebündelt.
    const call = async (method: string, extra: Record<string, unknown>, field: 'result' | 'event') =>
        readCr((await nativeCall(method, { ...extra, currentUser: currentUser(), amberPackage: AMBER_PACKAGE })) as CrResult, field)
    const win = window as unknown as { nostr?: unknown }
    win.nostr = {
        getPublicKey: async () => currentUser(),
        signEvent: async (event: unknown) => JSON.parse(await call('AmberSigner.SignEvent', { event: JSON.stringify(event) }, 'event')),
        nip44: {
            encrypt: (pk: string, plaintext: string) => call('AmberSigner.Nip44Encrypt', { plaintext, pubkey: pk }, 'result'),
            decrypt: (pk: string, ciphertext: string) => call('AmberSigner.Nip44Decrypt', { ciphertext, pubkey: pk }, 'result'),
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
 * Startet den einmaligen sichtbaren Amber-Login (get_public_key + Perms merken).
 * Amber liefert den pubkey per Custom-Scheme-Callback an `callbackUrl` zurück;
 * die Callback-Route ruft dann `loginWithNip55(pubkey)`.
 */
export async function startNip55Login(callbackUrl: string): Promise<void> {
    await nativeCall('AmberSigner.RequestPublicKey', {
        permissions: permsToNip55Json(NIP46_PERMS),
        callbackUrl,
        appName: 'EINUNDZWANZIG',
        amberPackage: AMBER_PACKAGE,
    })
}
