/**
 * NIP-46-Berechtigungen (welshman-app-frei, damit unit-testbar).
 *
 * Amber-Default ist Policy 1 „jede Anfrage einzeln bestätigen" — es werden NUR die
 * hier explizit gelisteten Kinds ohne weiteren Prompt signiert; jeder fehlende Kind
 * löst mitten im Flow eine neue Amber-Abfrage aus (die im Hintergrund oft nicht
 * sichtbar aufpoppt → Nutzer steckt fest). Ambers „basic"-Policy deckt NIP-29-Gruppen
 * NICHT ab. Deshalb: JEDEN Kind, den der Client je signiert, hier vollständig listen,
 * damit ein Amber-Nutzer nur EINMAL bestätigt. Ein nacktes `sign_event` ohne `:kind`
 * verwirft Amber beim Parsen — jeder Kind muss einzeln stehen.
 *
 * Kinds (Beleg = Client-Aufrufstelle):
 * - nip44 encrypt/decrypt: private 10009-Space-Liste (groups.ts) + NIP-46-Transport. Kein nip04 im Client.
 * - 0   PROFILE — Zap-Empfangsadresse publizieren (profiles.ts, ZAPS.md Z4)
 * - 5   DELETE — Nachricht/Reaktion löschen (interactions.ts)
 * - 7   REACTION — Emoji-Reaktion (interactions.ts)
 * - 9   MESSAGE — NIP-29-Gruppen-Chat (feeds.ts)
 * - 1018/1068 POLL_RESPONSE/POLL — NIP-88-Umfragen (interactions.ts)
 * - 1111 COMMENT — NIP-22-Thread-Kommentar (interactions.ts `sendComment`)
 * - 1984 REPORT — melden (interactions.ts)
 * - 9000/9001 ROOM_ADD_MEMBER/ROOM_REMOVE_MEMBER — NIP-29 Raum-Mitglieder (Admin, groups.ts)
 * - 9002/9007/9008 ROOM_EDIT_META/ROOM_CREATE/ROOM_DELETE — NIP-29 Raum-Verwaltung (Admin, groups.ts)
 * - 9005 ROOM_DELETE_EVENT — NIP-29 fremde Nachricht live entfernen (Admin, feeds.ts)
 * - 9021/9022 ROOM_JOIN/ROOM_LEAVE — NIP-29 (groups.ts)
 * - 9041 ZAP_GOAL — NIP-75-Spendenziel (interactions.ts)
 * - 9734 ZAP_REQUEST — NIP-57 (zaps.ts)
 * - 10009 ROOMS-Liste — NIP-51 (groups.ts)
 * - 22242 CLIENT_AUTH — NIP-42 member-only-zooid (core.ts)
 * - 27235 HTTP_AUTH — KRITISCH: Server-Login-Handoff (session.ts) UND NIP-86-Relay-Admin (members.ts)
 * - 28934/28936 RELAY_JOIN/RELAY_LEAVE — NIP-29 Space beitreten/verlassen (groups.ts)
 * - 30078 APP_DATA — Lesestand (NIP-78, readState.ts). Publiziert wird er erst in P6;
 *   die Berechtigung steht trotzdem SCHON JETZT hier, weil welshman die Rechte einer
 *   bestehenden NIP-46-Verbindung nie nachverhandelt (siehe nip46PermsAreStale). Wer
 *   heute koppelt, bekäme den Prompt sonst genau dann, wenn P6 zum ersten Mal quittiert.
 */
export const NIP46_PERMS = [
    'nip44_encrypt',
    'nip44_decrypt',
    'sign_event:0',
    'sign_event:5',
    'sign_event:7',
    'sign_event:9',
    'sign_event:1018',
    'sign_event:1068',
    'sign_event:1111',
    'sign_event:1984',
    'sign_event:9000',
    'sign_event:9001',
    'sign_event:9002',
    'sign_event:9005',
    'sign_event:9007',
    'sign_event:9008',
    'sign_event:9021',
    'sign_event:9022',
    'sign_event:9041',
    'sign_event:9734',
    'sign_event:10009',
    'sign_event:22242',
    'sign_event:27235',
    'sign_event:28934',
    'sign_event:28936',
    'sign_event:30078',
].join(',')

/** localStorage-Key des zuletzt gewährten Perms-Strings (Reconnect-Nudge). */
export const NIP46_PERMS_KEY = 'nip46_perms_granted'

/**
 * Reine Staleness-Entscheidung: Ist der aktive Signer NIP-46 und weichen seine
 * zuletzt gewährten Perms von der aktuellen Liste ab? welshman verhandelt beim
 * Reload NICHT neu — eine bestehende Amber/Bunker-Verbindung behält also ihre alten
 * (evtl. unvollständigen) Rechte, bis der Nutzer einmal neu verbindet. Den gewährten
 * STRING zu vergleichen (statt einer Versionsnummer) invalidiert bei JEDER künftigen
 * Perm-Änderung automatisch. Nsec/NIP-07 sind nie „stale" (kein Remote-Perm-Modell).
 */
export function nip46PermsAreStale(method: string | undefined, granted: string | null): boolean {
    if (method !== 'nip46') {
        return false
    }
    return granted !== NIP46_PERMS
}

/**
 * NIP46_PERMS-String → Ambers NIP-55-`permissions`-JSON-Array (Intent-Extra beim
 * get_public_key). "sign_event:9,nip44_encrypt" → [{"type":"sign_event","kind":9},
 * {"type":"nip44_encrypt"}]. Pure & testbar.
 */
export function permsToNip55Json(permsCsv: string): string {
    const perms = permsCsv
        .split(',')
        .map((p) => p.trim())
        .filter(Boolean)
        .map((p) => {
            const [type, kind] = p.split(':')
            return kind !== undefined ? { type, kind: Number(kind) } : { type }
        })
    return JSON.stringify(perms)
}
