/**
 * NIP-05-Verifizierung (PLAN4 B4) — dünne Hülle um welshmans `handles`-Layer.
 *
 * welshman erledigt die eigentliche Prüfung: `loadHandleForPubkey` lädt das
 * Profil, zieht dessen `nip05`, holt die `.well-known/nostr.json` des Handles und
 * legt sie in `handlesByNip05` ab. Verifiziert ist ein Handle NUR, wenn die dort
 * hinterlegte pubkey mit unserer übereinstimmt — sonst kein Häkchen (nie fälschlich
 * „verifiziert"). Netz-I/O bleibt lazy/fire-and-forget wie [[warmProfiles]].
 */
import { loadHandleForPubkey, displayNip05 } from '@welshman/app'

/** Bereits angestoßene Handle-Loads (pro Insel-Leben) — kein Doppel-Fetch. */
const requested = new Set<string>()

/** Fehlende Handles der übergebenen pubkeys nachladen (dedupliziert, async). */
export const warmHandles = (pubkeys: Iterable<string>): void => {
    for (const pubkey of pubkeys) {
        if (pubkey && !requested.has(pubkey)) {
            requested.add(pubkey)
            void loadHandleForPubkey(pubkey)
        }
    }
}

/**
 * Verifizierter NIP-05-Anzeige-String einer pubkey, sonst ''. Match-Regel wie
 * welshmans `deriveHandleForPubkey`: Profil-`nip05` muss existieren UND der in
 * nostr.json hinterlegte Handle muss auf genau diese pubkey zeigen.
 */
export const verifiedNip05 = (
    pubkey: string,
    profiles: Map<string, { nip05?: string }>,
    handles: Map<string, { pubkey?: string }>,
): string => {
    const nip05 = profiles.get(pubkey)?.nip05
    if (!nip05) {
        return ''
    }
    const handle = handles.get(nip05)
    return handle?.pubkey === pubkey ? displayNip05(nip05) : ''
}
