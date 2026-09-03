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
 * | Befristet sperren        | 9042 `p` + `expiration`        | `moderation_commands.rs:263`    |
 * | Sperre aufheben          | 9043 `p`                       | `moderation_commands.rs:330`    |
 * | Event loeschen (Admin)   | 9005 `e` + `h`                 | NIP-29 delete-event             |
 * | Ban-Liste lesen          | `GET /moderation/restricted`   | `router.rs:117`                 |
 * | Melde-Queue lesen        | `GET /moderation/reports`      | `router.rs:114`, `bridge:2112`  |
 * | Report erledigen         | 9044 `report`+`status`+`action`| `moderation_commands.rs:366`    |
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
import { app, Relays, Thunks } from './welshmanApp.ts'
import { signer } from './welshmanSession.ts'
import { makeEvent } from '@welshman/util'
import * as nip19 from 'nostr-tools/nip19'
import { isBuzzRelay } from './relayCaps.ts'
import { nip98Url, nip98AuthHeader, httpBase, type SignedLike } from './nip98.ts'
import { waitForPublishError } from './publishResult.ts'
import { t } from './i18n.ts'
import {
    parseRestrictionList,
    type RestrictionListResult,
    type TimeoutCommand,
    type UntimeoutCommand,
} from './moderationTimeoutModels.ts'

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

// ── Relay-Modus-Weiche ──────────────────────────────────────────────────────

/**
 * Spricht dieser Space **Buzz** statt zooid? Synchroner Schnappschuss aus dem
 * bereits geladenen NIP-11-Profil (`getRelaysByUrl`, welshman-Cache).
 *
 * Ist das Profil noch nicht da, wird der Fetch angestossen und `false` gemeldet —
 * also **zooid-Verhalten als Default**. Das ist Absicht: die bestehende
 * NIP-86-Strecke darf sich durch diese Migration nicht aendern, und ein noch
 * unbekanntes Relay ist kein Buzz-Relay.
 *
 * Liegt hier (statt in `members.ts`), weil inzwischen auch die Melde-Queue
 * (`actionItems.ts`) die Weiche braucht — EINE Erkennung, nicht zwei.
 */
export const spaceIsBuzz = (url: string): boolean => {
    const profile = app.use(Relays).index.get().get(url)
    if (!profile) {
        void app.use(Relays).load(url)
        return false
    }
    return isBuzzRelay(profile)
}

/**
 * Dasselbe, aber es **wartet** auf das NIP-11-Doc.
 *
 * Fuer alles, was genau einmal beim Seiten-Aufbau laeuft (Laden/Beobachten der
 * Melde-Queue). Die synchrone Fassung liefert dort verlaesslich `false`, weil das
 * Profil beim ersten Rendern noch unterwegs ist — die Queue liefe dann dauerhaft
 * auf der 1984-Strecke und bliebe auf Buzz strukturell leer. Fuer Klick-Aktionen
 * bleibt die synchrone Fassung richtig: da ist das Profil laengst da.
 */
export const spaceIsBuzzAsync = async (url: string): Promise<boolean> => {
    const cached = app.use(Relays).index.get().get(url)
    if (cached) {
        return isBuzzRelay(cached)
    }
    // **`forceLoadRelay`, nicht `loadRelay`** — Härtung, keine belegte Fehlerbehebung:
    // welshmans `loadRelay` ist ein `makeLoadItem`-Wrapper, der sich merkt, dass diese
    // URL schon angefragt wurde, und danach sofort `undefined` liefert, OHNE erneuten
    // Fetch. `fetchRelay` schreibt zudem nur bei ERFOLG in `relaysByUrl` (Fehler landen
    // in einem leeren `catch`). Ein früher Fehlversuch könnte die Weiche damit dauerhaft
    // auf `false` nageln — `forceLoadRelay` umgeht den Merker.
    //
    // **Was das NICHT erklärt:** `buzz-moderation:95` bleibt auch damit rot. In der
    // Directory-Insel meldet `isAdmin` false und `banEvent` sendet kein 9005 (Relay-Log:
    // `report resolved` ohne vorangehendes `DELETE_EVENT processed`). Derselbe Pfad,
    // direkt per `Alpine.$data(el).removeReportedContent(r)` aufgerufen, sendet das 9005
    // und setzt `deleted_at` — gemessen. Der Unterschied liegt also nicht hier.
    return isBuzzRelay((await app.use(Relays).forceLoad(url)) ?? undefined)
}

/**
 * Signiert und sendet ein Admin-Event an EIN Relay; liefert die Relay-Fehlermeldung
 * (`''` = OK). Das Event entsteht hier drin — siehe Fallstrick 1 im Modulkopf.
 */
const publishAdminEvent = (url: string, kind: number, tags: string[][]): Promise<string> =>
    waitForPublishError(app.use(Thunks).publish({ relays: [url], event: makeEvent(kind, { tags }) }))

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
 * Buzz: suspend a pubkey for a while (kind 9042) — the strongest measure this client
 * offers against a person.
 *
 * **Takes a planned command, not loose arguments.** That is the difference to
 * `buzzBanPubkey` above, and it is the whole point: a 9040 without `expiration` is
 * PERMANENT, while a 9042 without it does not exist at all (`handle_timeout`,
 * `moderation_commands.rs`: `"timeout requires an expiration tag"`). The mandatory tag is
 * therefore assembled — and refused — in exactly one place, `moderationTimeoutModels.ts`,
 * where the capability gate has already decided whether this space takes the kind at all.
 * A second assembly here could drift from the first, and the failure mode of that drift is
 * a permanent ban where a timed suspension was meant.
 *
 * The kind sits in the command's TYPE (`TimeoutCommand`), not in a number at this call
 * site: a 9043 cannot be handed in here.
 */
export const buzzTimeoutPubkey = (url: string, command: TimeoutCommand): Promise<string> =>
    publishAdminEvent(url, command.kind, command.tags)

/** Buzz: lift a timed suspension (kind 9043) — a planned command as well. */
export const buzzUntimeoutPubkey = (url: string, command: UntimeoutCommand): Promise<string> =>
    publishAdminEvent(url, command.kind, command.tags)

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

// ── Sperr-Liste (HTTP, NIP-98) ──────────────────────────────────────────────
//
// The row shape (`RestrictionEntry`) and its parser live in
// `moderationTimeoutModels.ts`: `/moderation/restricted` answers with bans AND running
// timeouts in the same response, and the rule that tells one from the other belongs where
// it is decidable without a network.

/** `ws(s)://host/…` → `http(s)://host` — die Moderations-Routen liegen auf demselben Host. */
export const buzzHttpBase = httpBase

/**
 * Ein authentifizierter GET auf eine Buzz-Moderations-Route. Liefert das geparste
 * JSON — oder **wirft**.
 *
 * Alle drei Routen (`/moderation/reports`, `/audit`, `/restricted`) laufen ueber
 * `authorize_moderation_read` (`api/bridge.rs:2046`): NIP-98 plus
 * Moderations-Berechtigung. Ohne Header antwortet der Relay
 * `401 {"error":"missing Nostr auth"}` (am laufenden Relay gemessen).
 *
 * **Warum das wirft statt eine leere Liste zu liefern:** ein Messgeraet, das im
 * Defektfall „nichts gefunden" meldet, ist unbrauchbar — „keine Meldungen" und
 * „Abfrage kaputt" waeren nicht mehr unterscheidbar, weder fuer den Admin noch
 * fuer einen Test. Die Aufrufer entscheiden, was sie mit dem Fehler tun.
 *
 * Der URL entsteht **einmal** in `nip98Url` und geht unveraendert in den `u`-Tag
 * UND in `fetch` — die Signatur deckt den rohen Query-String (siehe `nip98.ts`).
 */
const buzzModerationGet = async (
    url: string,
    path: string,
    query: Record<string, string | number | undefined> = {},
): Promise<unknown> => {
    const { status, body } = await buzzModerationFetch(url, path, query)
    if (status < 200 || status >= 300) {
        // Buzz antwortet mit `{"error": "…"}`; den Originaltext fuehren statt eine
        // eigene Ursache zu erfinden.
        const detail = typeof body === 'string' ? body : ''
        throw new Error(`${path}: HTTP ${status}${detail ? ` — ${detail}` : ''}`)
    }
    return body
}

/**
 * The same call, but it reports the **status** instead of throwing.
 *
 * The difference is the point: "you may not ask this" (401/403) is an answer, not a
 * malfunction — and a surface that carries a moderation decision has to tell it apart from
 * "nobody is restricted". Whoever only wants a result and treats every failure alike keeps
 * using [[buzzModerationGet]] above.
 *
 * `body` is the parsed JSON on 2xx, otherwise the relay's raw response text.
 */
const buzzModerationFetch = async (
    url: string,
    path: string,
    query: Record<string, string | number | undefined> = {},
): Promise<{ status: number; body: unknown }> => {
    const sign = signer.get()
    if (!sign) {
        throw new Error(t('Nicht angemeldet — die Moderations-Abfrage braucht eine Signatur (NIP-98).'))
    }
    const target = nip98Url(url, path, query)
    const auth = await nip98AuthHeader((e) => sign.sign(e) as Promise<SignedLike>, target, 'GET')
    const res = await fetch(target, { headers: { Accept: 'application/json', Authorization: auth } })
    if (!res.ok) {
        return { status: res.status, body: await res.text().catch(() => '') }
    }
    return { status: res.status, body: await res.json() }
}

/**
 * Liest die Liste der eingeschraenkten (gebannten UND befristet gesperrten) Pubkeys
 * ueber `GET /moderation/restricted` (`router.rs:117`).
 *
 * Seit P5 **mit** NIP-98-Header — die frueher dokumentierte Luecke („bewusst ohne
 * Header, Route liefert dann nichts") ist damit geschlossen.
 *
 * ── What P4 changed here, and why ───────────────────────────────────────────
 *
 * Until now this function ended in `catch { return [] }`. "Nobody is restricted", "you may
 * not ask this at all" and "the relay is down" were one and the same answer. For the old
 * purpose that was defensible, and the comment said so: banning and unbanning (9040/9041)
 * worked whether or not this list loaded, so a toast here would have been noise. For a
 * surface that *carries* a moderation decision it is not enough — a 9042 is never readable
 * (the relay neither stores nor fans out 9042–9044), so this list is the only proof the
 * suspension took effect.
 *
 * The distinction itself lives in `parseRestrictionList` (pure, `node --test`); what stays
 * here is the way onto the network. A throw (no signer, DNS, offline) becomes
 * `unavailable` — that is not an empty list either.
 */
export const buzzLoadRestricted = async (url: string): Promise<RestrictionListResult> => {
    try {
        const { status, body } = await buzzModerationFetch(url, '/moderation/restricted')
        return parseRestrictionList(status, body)
    } catch (e) {
        return { ok: false, reason: 'unavailable', status: 0, detail: e instanceof Error ? e.message : String(e) }
    }
}

// ── Melde-Queue (native Buzz-Moderations-API) ───────────────────────────────
//
// **Der Grund fuer diesen ganzen Block:** Buzz speichert kind 1984 NICHT als
// Event. Der Ingest nimmt den Report an, schreibt ihn nach `moderation_reports`
// und kehrt VOR der Speicherung zurueck (`handlers/ingest.rs:1600-1608`) — ein
// `REQ -k 1984` liefert dort 0 Treffer, am laufenden Relay gemessen. Eine Queue,
// die auf einem 1984-REQ steht, findet auf Buzz deshalb strukturell nie etwas.
// Gelesen wird stattdessen ueber die native HTTP-Route, erledigt ueber kind 9044.

/** Ein Report, wie ihn `GET /moderation/reports` liefert (`report_json`, `api/bridge.rs:2170-2191`). */
export type BuzzReport = {
    /** Interne Report-id (UUID) — NICHT die Event-id. */
    id: string
    /** Event-id des signierten 1984 — das ist der Wert fuer den `report`-Tag von 9044. */
    report_event_id: string
    reporter_pubkey: string
    target_kind: 'event' | 'pubkey' | 'blob'
    /** Event-id, Pubkey oder Blob-Hash — je nach `target_kind`. */
    target: string
    /**
     * Raum des gemeldeten Inhalts (NIP-29 `h`), vom Relay mitgeliefert.
     *
     * **Der eigentliche Hebel dieser Umstellung:** vorher musste der Client das
     * gemeldete Event extra nachladen, nur um an dessen `h` zu kommen (Buzz'
     * Admin-Loeschung kind 9005 verlangt Raum-Bezug). Der Relay kennt es und
     * liefert es mit — der Umweg entfaellt. `null` bei Pubkey-/Blob-Reports.
     */
    channel_id: string | null
    /** NIP-56-Maschinencode (`spam`, `profanity`, …). */
    report_type: string
    /** Freitext des Melders (= `content` des 1984). */
    note: string | null
    status: 'open' | 'resolved' | 'dismissed'
    resolved_by: string | null
    resolved_at: string | null
    action_id: string | null
    /** ISO-8601-Zeitstempel (**kein** Unix-Int — Buzz liefert hier einen String). */
    created_at: string
}

const isHex64 = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v)

/**
 * Holt die Meldungen des Space ueber `GET /moderation/reports`
 * (`router.rs:114`, Handler `api/bridge.rs:2112`).
 *
 * `status` und `limit` sind die einzigen Parameter der Route
 * (`ModerationReadQuery`); `limit` wird relay-seitig gedeckelt (`clamp_limit`).
 * Wirft bei Auth-/Netzfehlern — siehe [[buzzModerationGet]].
 */
export const buzzLoadReports = async (url: string, status = 'open', limit = 100): Promise<BuzzReport[]> => {
    const body = await buzzModerationGet(url, '/moderation/reports', { status, limit })
    if (!Array.isArray(body)) {
        throw new Error(t('/moderation/reports: unerwartete Antwortform (kein Array)'))
    }
    // Nur Reports mit brauchbarer Event-id: der `report`-Tag von 9044 verlangt
    // 64-hex (`extract_report_tag`), ein kaputter Eintrag waere ein Knopf, der
    // garantiert scheitert.
    return (body as BuzzReport[]).filter((r) => isHex64(r?.report_event_id))
}

/** Erlaubte `status`-Werte von kind 9044 (`moderation_commands.rs:379-383`). */
export type BuzzResolveStatus = 'resolved' | 'dismissed'
/** Erlaubte `action`-Werte von kind 9044 (`moderation_commands.rs:384-392`). */
export type BuzzResolveAction = 'delete' | 'kick' | 'ban' | 'timeout' | 'dismiss' | 'escalate'

/** Buzz: Report erledigen (`KIND_MODERATION_RESOLVE_REPORT`, `moderation_commands.rs:366`). */
export const BUZZ_RESOLVE_REPORT = 9044

/**
 * Erledigt einen Report (kind 9044). `reportEventId` ist die **Event-id des 1984**
 * (`BuzzReport.report_event_id`), nicht die interne UUID.
 *
 * **Kopplungsregel des Relays** (`moderation_commands.rs:393-397`): `action=dismiss`
 * geht NUR mit `status=dismissed` und umgekehrt. Verstoesse weist der Relay ab
 * (`invalid: action 'dismiss' pairs only with status 'dismissed'`) — die Paarung
 * wird deshalb hier schon erzwungen, statt dem Nutzer eine Relay-Fehlermeldung zu
 * zeigen, die er nicht deuten kann.
 *
 * **9044 vollstreckt nichts.** Der Handler schreibt eine Audit-Zeile und setzt die
 * Report-Zeile auf `resolved`/`dismissed` (`moderation_commands.rs:430-473`) — er
 * loescht kein Event und bannt niemanden. Die eigentliche Massnahme (9005-Loeschung,
 * 9040-Ban) ist ein eigenes Event und muss zusaetzlich gesendet werden.
 */
export const buzzResolveReport = (
    url: string,
    reportEventId: string,
    status: BuzzResolveStatus,
    action: BuzzResolveAction,
    reason = '',
): Promise<string> => {
    if ((action === 'dismiss') !== (status === 'dismissed')) {
        return Promise.resolve(t('Ungültige Kombination: „dismiss" gehört zu „dismissed" (und nur dazu).'))
    }
    if (!isHex64(reportEventId)) {
        return Promise.resolve(t('Ungültige Report-Kennung (erwartet 64-stellige Event-id).'))
    }
    const tags = [
        ['report', reportEventId],
        ['status', status],
        ['action', action],
    ]
    return publishAdminEvent(url, BUZZ_RESOLVE_REPORT, reason ? [...tags, ['reason', reason]] : tags)
}

/** npub aus einem Hex-Pubkey (Anzeige in der Ban-Liste). */
export const buzzNpub = (pubkey: string): string => nip19.npubEncode(pubkey)
