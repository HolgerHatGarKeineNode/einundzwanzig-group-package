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

/**
 * Setzt das Relay NIP-70 („protected events", `["-"]`-Tag) durch? Aus dem
 * NIP-11-`supported_nips` (von welshman auf `string[]` normalisiert). Rein &
 * welshman-frei → testbar. Fehlendes Profil → false (kein PROTECTED, wie beim
 * Referenz-Client).
 */
export const hasNip70 = (profile?: { supported_nips?: string[] }): boolean =>
    profile?.supported_nips?.includes('70') ?? false

/** Space-Branding aus dem NIP-11-Info-Doc (Anzeigename, Avatar, Untertitel, Kopfbild). */
export type SpaceBranding = { label: string; icon: string; description: string; banner: string }

/**
 * Ein Space hat kein Meta-Event — sein „Name" kommt aus dem NIP-11-Info-Doc des
 * Relays: `name` als Anzeigename (Fallback: gekürzte Relay-URL), `icon` als
 * Space-Avatar, `description` als Untertitel, `banner` als Kopfbild.
 * Rein & welshman-frei → testbar.
 */
export const spaceBranding = (
    fallbackLabel: string,
    profile?: { name?: string; icon?: string; description?: string; banner?: string },
): SpaceBranding => ({
    label: profile?.name?.trim() || fallbackLabel,
    icon: profile?.icon?.trim() || '',
    description: profile?.description?.trim() || '',
    banner: profile?.banner?.trim() || '',
})
