/**
 * Space-Verwaltung auf **Buzz**-Relays (P3 des Buzz-Migrationsplans).
 *
 * Buzz hat **kein NIP-86** — am laufenden Relay gemessen antwortet `POST /` mit
 * `405 Method Not Allowed, allow: GET,HEAD`. Jeder `manageRelay(…)`-Aufruf aus
 * `@welshman/app` scheitert dort still; genau daran hing bisher `isAdmin=false`
 * und damit die fehlende Zeile „Neuen Raum anlegen".
 *
 * Ersatz sind Buzz' **native Relay-Admin-Kinds**, ganz normale signierte Events
 * über dieselbe WebSocket-Strecke wie jede andere Nachricht:
 *
 * | Aufgabe                  | Buzz-Kind / Route              | Quelle (buzz-Repo)              |
 * |--------------------------|--------------------------------|---------------------------------|
 * | Mitglied aufnehmen       | 9030 `p` + `role`              | `handlers/relay_admin.rs:259`   |
 * | Mitglied entfernen       | 9031 `p`                       | `handlers/relay_admin.rs:309`   |
 * | Rolle aendern (nur Owner)| 9032 `p` + `role`              | `handlers/relay_admin.rs:368`   |
 * | Space-Icon setzen        | 9033 `icon`                    | `handlers/relay_admin.rs:232`   |
 * | Pubkey bannen            | 9040 `p` (+ `reason`)          | `core/kind.rs:298`              |
 * | Ban aufheben             | 9041 `p`                       | `core/kind.rs:300`              |
 * | Event loeschen (Admin)   | 9005 `e` + `h`                 | NIP-29 delete-event             |
 * | Ban-Liste lesen          | `GET /moderation/restricted`   | `router.rs:114-120`             |
 *
 * **Zwei gemessene Fallstricke**, die die Bauform hier bestimmen:
 *
 * 1. **`created_at` muss innerhalb ±120 s liegen** (`relay_admin.rs:203-213`).
 *    Deshalb wird jedes Event ERST im Moment des Sendens gebaut — `makeEvent`
 *    stempelt `created_at = now()` beim Aufruf. Kein Vorbauen, kein Cachen, kein
 *    Wiederverwenden eines Templates.
 * 2. **Rolle `admin` darf nur der Owner vergeben** (`relay_admin.rs:271-274`).
 *    Ein Admin, der einen Admin anlegen will, bekommt vom Relay
 *    `actor not authorized: only owner can grant admin role` — die Meldung wird
 *    unveraendert durchgereicht, nicht uebersetzt oder geschluckt.
 *
 * Rueckgabewert ist ueberall die **Fehlermeldung des Relays** (`''` = Erfolg) —
 * dieselbe Konvention wie bei den NIP-86-Wrappern in `members.ts`, damit die
 * Aufrufer in `bridge.ts` unveraendert bleiben.
 */
import { publishThunk, waitForThunkError } from '@welshman/app'
import { makeEvent } from '@welshman/util'
import * as nip19 from 'nostr-tools/nip19'

// ── Buzz-Kind-Konstanten ────────────────────────────────────────────────────
// Bewusst hier lokal statt in @welshman/util: das sind Buzz-Erweiterungen, kein
// NIP-Kanon. 9030-9032 stammen aus der NIP-43-Serie (relay membership admin),
// 9040/9041 sind Buzz-eigene Moderationsbefehle.

/** Buzz: Relay-Mitglied hinzufuegen (`relay_admin.rs:10`). */
export const BUZZ_ADD_MEMBER = 9030
/** Buzz: Relay-Mitglied entfernen (`relay_admin.rs:11`). */
export const BUZZ_REMOVE_MEMBER = 9031
/** Buzz: Rolle eines Mitglieds aendern — **nur Owner** (`relay_admin.rs:12`). */
export const BUZZ_CHANGE_ROLE = 9032
/** Buzz: Workspace-Profil setzen. Kann NUR das Icon (`relay_admin.rs:232-252`). */
export const BUZZ_SET_WORKSPACE_PROFILE = 9033
/** Buzz: Pubkey aus der Community bannen (`core/kind.rs:298`). */
export const BUZZ_BAN_PUBKEY = 9040
/** Buzz: Ban aufheben (`core/kind.rs:300`). */
export const BUZZ_UNBAN_PUBKEY = 9041
/** NIP-29: Event durch einen Admin loeschen lassen (kind 9005). */
export const NIP29_DELETE_EVENT = 9005

/** Buzz kennt genau diese drei Relay-Rollen (`buzz-db/src/relay_members.rs:20`). */
export type BuzzRelayRole = 'owner' | 'admin' | 'member'

/**
 * Signiert und sendet ein Admin-Event an EIN Relay; liefert die Relay-Fehlermeldung
 * (`''` = OK). Das Event entsteht hier drin — siehe Fallstrick 1 im Modulkopf.
 */
const publishAdminEvent = (url: string, kind: number, tags: string[][]): Promise<string> =>
    waitForThunkError(publishThunk({ relays: [url], event: makeEvent(kind, { tags }) }))

// ── Mitglieder ──────────────────────────────────────────────────────────────

/**
 * Nimmt einen Pubkey als Relay-Mitglied auf (kind 9030) — der Buzz-Ersatz fuer
 * NIP-86 `allowpubkey`. Idempotent: ein Re-Add am selben Ziel ist relay-seitig
 * ein stiller No-op und ueberschreibt eine bestehende Rolle NICHT
 * (`relay_admin.rs:279-289`) — zum Hochstufen dient [[buzzChangeRole]].
 */
export const buzzAddMember = (url: string, pubkey: string, role: BuzzRelayRole = 'member'): Promise<string> =>
    publishAdminEvent(url, BUZZ_ADD_MEMBER, [
        ['p', pubkey],
        ['role', role],
    ])

/** Entfernt einen Pubkey aus der Relay-Mitgliedschaft (kind 9031). */
export const buzzRemoveMember = (url: string, pubkey: string): Promise<string> =>
    publishAdminEvent(url, BUZZ_REMOVE_MEMBER, [['p', pubkey]])

/**
 * Aendert die Rolle eines bestehenden Mitglieds (kind 9032). **Nur der Owner**
 * darf das; ein Admin bekommt die Relay-Meldung unveraendert zurueck.
 */
export const buzzChangeRole = (url: string, pubkey: string, role: BuzzRelayRole): Promise<string> =>
    publishAdminEvent(url, BUZZ_CHANGE_ROLE, [
        ['p', pubkey],
        ['role', role],
    ])

// ── Moderation ──────────────────────────────────────────────────────────────

/** Bannt einen Pubkey aus der Community (kind 9040), optional mit Begruendung. */
export const buzzBanPubkey = (url: string, pubkey: string, reason = ''): Promise<string> =>
    publishAdminEvent(url, BUZZ_BAN_PUBKEY, reason ? [['p', pubkey], ['reason', reason]] : [['p', pubkey]])

/** Hebt einen Community-Ban auf (kind 9041). */
export const buzzUnbanPubkey = (url: string, pubkey: string): Promise<string> =>
    publishAdminEvent(url, BUZZ_UNBAN_PUBKEY, [['p', pubkey]])

/**
 * Loescht ein fremdes Event als Admin (NIP-29 kind 9005). Buzz verlangt fuer 9005
 * einen Raum-Bezug (`requires_h_channel_scope`, `handlers/ingest.rs:487`) — ohne
 * bekanntes `h` ist die Admin-Loeschung auf Buzz nicht adressierbar, dann bleibt
 * nur das Ausblenden im Client. Der Aufrufer reicht das `h` durch, wenn er es hat.
 */
export const buzzDeleteEvent = (url: string, id: string, h = ''): Promise<string> =>
    publishAdminEvent(url, NIP29_DELETE_EVENT, h ? [['e', id], ['h', h]] : [['e', id]])

// ── Space-Metadaten ─────────────────────────────────────────────────────────

/**
 * Setzt das Space-Icon (kind 9033). Buzz' 9033 kann **ausschliesslich** das Icon
 * (`relay_admin.rs:232-252`) — Name und Beschreibung eines Buzz-Space sind
 * Deployment-Konfiguration und ueber die Nostr-Strecke nicht aenderbar.
 */
export const buzzSetIcon = (url: string, icon: string): Promise<string> =>
    publishAdminEvent(url, BUZZ_SET_WORKSPACE_PROFILE, [['icon', icon]])

// ── Ban-Liste (HTTP, NIP-98) ────────────────────────────────────────────────

export type BuzzRestrictedEntry = { pubkey: string; reason: string }

/** `ws(s)://host/…` → `http(s)://host` — die Moderations-Routen liegen auf demselben Host. */
export const buzzHttpBase = (url: string): string => url.replace(/^ws/, 'http').replace(/\/+$/, '')

/**
 * Liest die Liste der eingeschraenkten (gebannten/getimeouteten) Pubkeys ueber
 * `GET /moderation/restricted` (`router.rs:114-120`).
 *
 * **Bewusst ohne NIP-98-Header:** Ein NIP-98-Event zu bauen hiesse, den Signer
 * fuer eine HTTP-Route zu bemuehen, die nur eine Anzeige-Liste liefert. Antwortet
 * die Route mit 401/403 (oder gar nicht), liefert diese Funktion eine leere Liste
 * statt zu werfen — die Ban-Verwaltung zeigt dann nichts an, aber Bannen und
 * Entbannen (9040/9041) funktionieren unabhaengig davon weiter. Das ist die
 * bekannte Luecke, kein stiller Fehlschlag: siehe Bericht zu P3.
 */
export const buzzLoadRestricted = async (url: string): Promise<BuzzRestrictedEntry[]> => {
    try {
        const res = await fetch(`${buzzHttpBase(url)}/moderation/restricted`, {
            headers: { Accept: 'application/json' },
        })
        if (!res.ok) {
            return []
        }
        const body = (await res.json()) as { restricted?: unknown; pubkey?: unknown }
        const rows = Array.isArray(body) ? body : Array.isArray(body.restricted) ? body.restricted : []
        return (rows as { pubkey?: string; reason?: string }[])
            .filter((r) => typeof r.pubkey === 'string' && r.pubkey.length === 64)
            .map((r) => ({ pubkey: r.pubkey as string, reason: r.reason ?? '' }))
    } catch {
        return []
    }
}

/** npub aus einem Hex-Pubkey (Anzeige in der Ban-Liste). */
export const buzzNpub = (pubkey: string): string => nip19.npubEncode(pubkey)
