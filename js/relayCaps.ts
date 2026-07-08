/**
 * Relay-Fähigkeiten aus dem NIP-11-Info-Doc. Bewusst OHNE welshman-Importe, damit
 * die Logik rein (ohne Browser-/Store-Runtime) testbar bleibt.
 */

/** NIP-29 = relaybasierte Gruppen. Nur ein solches Relay kann Räume tragen. */
const NIP29 = '29'

/**
 * Darf dieser Space in der Auswahl stehen? Ein Space ist genau dann brauchbar,
 * wenn sein Relay NIP-29 spricht (`supported_nips` enthält 29).
 * - Vereins-Relays sind per Definition Group-Relays → immer true (ihr NIP-11
 *   kann fehlen/langsam sein).
 * - Solange das Profil noch nicht geladen ist (`undefined`) → optimistisch true,
 *   damit beim Boot nichts wegflackert.
 * - Erst ein geladenes Profil OHNE 29 fällt raus.
 *
 * `supported_nips` ist von welshman auf `string[]` normalisiert (siehe fetchRelay).
 */
export const spaceSupportsRooms = (isVerein: boolean, profile?: { supported_nips?: string[] }): boolean => {
    if (isVerein || !profile) {
        return true
    }
    return profile.supported_nips?.includes(NIP29) ?? false
}
