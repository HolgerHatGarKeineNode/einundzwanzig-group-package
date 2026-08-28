/**
 * Admin-Review-Queue (P3): eingegangene „Fork off!"-Meldungen (NIP-56 kind 1984)
 * eines Space. Reports werden bereits gesendet (`sendReport`, feeds.ts) — hier ist
 * die **Empfangs-/Abarbeitungs-Seite**: der Admin sieht die Meldungen und kann sie
 * verwerfen, den gemeldeten Inhalt entfernen oder den Autor bannen (Aktionen laufen
 * über die vorhandenen NIP-86-Wrapper `banEvent`/`banSpaceMember` in bridge.ts).
 *
 * Pending Join-Requests (Flotillas zweite Action-Item-Art) sind seit P4b hier mit
 * abgeleitet (`deriveSpaceJoinRequests`): zooid genehmigt Beitritte offener Räume
 * automatisch → „offene" Anfragen entstehen nur bei `closed`-Räumen (kind 9021 ohne
 * folgendes 39002-Mitglied bzw. jüngeres 9022-Leave). Annehmen/Ablehnen in bridge.ts.
 */
import { derived, writable, get, type Readable } from 'svelte/store'
import { throttled } from '@welshman/store'
import { load, request } from '@welshman/net'
import { loadProfile } from './welshmanApp.ts'
import { type TrustedEvent } from '@welshman/util'
import { REPORT, ROOM_JOIN, ROOM_LEAVE, MESSAGE } from './welshmanKinds.ts'
import { getTag, getTagValue } from './welshmanTags.ts'
import { displayProfile } from './welshmanProfile.ts'
import { sortBy } from '@welshman/lib'
import { profilesByPubkey } from './spaceProfiles.ts'
import * as nip19 from 'nostr-tools/nip19'
import { deriveEventsForUrl } from './repository.ts'
import { roomsByUrl, roomMembersByUrl } from './groups.ts'
import { spaceIsBuzz, spaceIsBuzzAsync, buzzLoadReports, type BuzzReport } from './buzzAdmin.ts'
import { toast } from './toast.ts'
import { t } from './i18n.ts'

/** NIP-56-Maschinencodes → deutsche Labels (wie das Melde-Modal). */
const REASON_LABELS: Record<string, string> = {
    spam: t('Spam'),
    profanity: t('Beleidigung'),
    impersonation: t('Identitätsdiebstahl'),
    other: t('Sonstiges'),
}

const shortNpub = (npub: string): string => `${npub.slice(0, 12)}…${npub.slice(-6)}`

/**
 * Was im Raum überhaupt gemeldet werden kann — die Kinds, die der Chat-Feed als
 * Zeile rendert und die deshalb den „Fork off!"-Knopf tragen. Dient hier nur als
 * Filter für die Store-Quelle, aus der das `h` eines gemeldeten Events kommt;
 * ein Kind zu viel oder zu wenig kostet nichts außer einem leeren `roomH`.
 */
const REPORTABLE_KINDS = [MESSAGE]

export type ReportView = {
    id: string // Report-Kennung (zooid: Event-id des 1984 · Buzz: `report_event_id`)
    reportedId: string // gemeldetes Event (Ziel von „Inhalt entfernen")
    reportedPubkey: string // gemeldeter Autor (Ziel von „Autor bannen")
    reportedName: string
    reason: string
    reasonLabel: string
    text: string // optionaler Freitext des Melders
    /**
     * Raum (`h`) des GEMELDETEN Events — '' wenn unbekannt.
     *
     * Der Report selbst trägt bewusst **kein** `h` (siehe `makeReport` in
     * `interactions.ts`: er ist keine Group-Message). Buzz verlangt für die
     * Admin-Löschung kind 9005 aber Raum-Bezug (`requires_h_channel_scope`,
     * `ingest.rs:487`).
     *
     * - **Buzz:** kommt fertig vom Relay (`channel_id` im Report-Datensatz).
     * - **zooid:** wird aus dem gemeldeten Event gelesen (dort ist das Feld für
     *   die Aktion ohnehin folgenlos — NIP-86 `banevent` kennt nur die Event-id).
     */
    roomH: string
}

// ── Buzz: native Moderations-Queue ──────────────────────────────────────────
//
// Buzz speichert kind 1984 **nicht als Event**: der Ingest schreibt den Report
// nach `moderation_reports` und kehrt vor der Speicherung zurück
// (`handlers/ingest.rs:1600-1608`) — `nak req -k 1984` liefert dort 0 Treffer.
// Die 1984-Ableitung unten findet auf Buzz also strukturell nie etwas. Gelesen
// wird stattdessen `GET /moderation/reports` (NIP-98), gehalten in diesem Store.
//
// **Kein Migrationsversuch:** alte 1984-Reports werden nicht übernommen, nicht
// umkopiert, nicht nachgebaut (Nutzerentscheidung 2026-07-28).

const buzzReportsByUrl = writable(new Map<string, BuzzReport[]>())

const setBuzzReports = (url: string, reports: BuzzReport[]): void =>
    buzzReportsByUrl.update((m) => new Map(m).set(url, reports))

/**
 * Wirft einen erledigten Report sofort aus dem lokalen Store — die Zeile
 * verschwindet, ohne auf den nächsten Abruf zu warten. Der Relay bleibt die
 * Wahrheit; [[loadSpaceReports]] zieht direkt danach nach.
 */
export const forgetBuzzReport = (url: string, reportEventId: string): void =>
    buzzReportsByUrl.update((m) => new Map(m).set(url, (m.get(url) ?? []).filter((r) => r.report_event_id !== reportEventId)))

/**
 * Ein Buzz-Report-Datensatz → `ReportView`. Rein (keine Stores, keine Netz-Zugriffe),
 * damit die Abbildung testbar bleibt — `authorOf`/`nameOf` reichen die beiden
 * Dinge herein, die aus der Umgebung kommen.
 *
 * **Was der Relay mitliefert und was nicht:** `channel_id` ist da — der frühere
 * Umweg „gemeldetes Event nachladen, nur um an sein `h` zu kommen" entfällt damit
 * vollständig. Der **Autor** des gemeldeten Events steht dagegen NICHT im
 * Datensatz (`report_json`, `api/bridge.rs:2170-2191`, am laufenden Relay
 * gegengeprüft): bei `target_kind: "event"` ist `target` die Event-id, mehr nicht.
 * Der Name ist deshalb eine **Anzeige-Zugabe** — fehlt er, bleibt die Queue voll
 * bedienbar (Verwerfen und Inhalt entfernen brauchen ihn nicht).
 */
export const mapBuzzReport = (
    r: BuzzReport,
    authorOf: (eventId: string) => string,
    nameOf: (pubkey: string) => string,
): ReportView => {
    const reportedId = r.target_kind === 'event' ? r.target : ''
    const reportedPubkey = r.target_kind === 'pubkey' ? r.target : reportedId ? authorOf(reportedId) : ''
    return {
        id: r.report_event_id,
        reportedId,
        reportedPubkey,
        reportedName: reportedPubkey ? nameOf(reportedPubkey) : '?',
        reason: r.report_type,
        reasonLabel: REASON_LABELS[r.report_type] ?? (r.report_type || t('Meldung')),
        text: r.note ?? '',
        roomH: r.channel_id ?? '',
    }
}

/** `created_at` ist bei Buzz ein ISO-8601-**String**, kein Unix-Int. Neueste zuerst. */
const buzzReportOrder = (r: BuzzReport): number => -Date.parse(r.created_at || '')

/**
 * Die offenen Meldungen des Space, neueste zuerst. Autoren-Profile werden lazy
 * nachgewärmt (Name/Avatar). `throttled`, damit das Neubauen nicht bei jedem
 * eintrudelnden Profil läuft.
 *
 * **Zwei Quellen, eine Liste.** Der Store vereint die zooid-Ableitung (kind 1984
 * aus der `repository`) mit dem Buzz-Store oben. Bewusst als Vereinigung statt
 * als Entweder-Oder auf `spaceIsBuzz(url)`: die Relay-Erkennung hängt am
 * NIP-11-Doc, das beim ersten Rendern noch unterwegs sein kann — eine Weiche
 * hier würde je nach Ladereihenfolge die falsche Quelle festzurren. Auf zooid
 * bleibt der Buzz-Teil leer (er wird nie befüllt), auf Buzz der 1984-Teil.
 */
export const deriveSpaceReports = (url: string): Readable<ReportView[]> =>
    derived(
        [
            deriveEventsForUrl(url, [{ kinds: [REPORT] }]),
            // Die gemeldeten Events selbst — auf zooid Quelle des `h`, auf Buzz nur
            // noch Quelle des Autoren-NAMENS (das `h` kommt dort aus `channel_id`).
            deriveEventsForUrl(url, [{ kinds: REPORTABLE_KINDS }]),
            throttled(300, profilesByPubkey),
            buzzReportsByUrl,
        ],
        ([events, reportable, $profiles, $buzz]) => {
            const byId = new Map((reportable as TrustedEvent[]).map((e) => [e.id, e]))
            const nameOf = (pk: string): string => {
                if (!$profiles.has(pk)) {
                    loadProfile(pk)
                }
                return displayProfile($profiles.get(pk), shortNpub(nip19.npubEncode(pk)))
            }
            const buzzViews = sortBy(buzzReportOrder, $buzz.get(url) ?? []).map((r) =>
                mapBuzzReport(r, (id) => byId.get(id)?.pubkey ?? '', nameOf),
            )
            const sorted = sortBy((e: TrustedEvent) => -e.created_at, events)
            return buzzViews.concat(sorted.map((e): ReportView => {
                const eTag = getTag('e', e.tags) ?? []
                // `p` ist UNGEPRÜFTER Relay-Input (Reports sind nicht relay-signiert, jedes
                // Mitglied publiziert sie): ein kaputter Pubkey (odd-length/non-hex) ließe
                // nip19.npubEncode im derived-map() werfen → die GANZE Queue bräche dauerhaft.
                // Darum strikt auf 64-hex validieren; ungültig → als „unbekannt" behandeln.
                const rawPubkey = getTagValue('p', e.tags) ?? ''
                const reportedPubkey = /^[0-9a-f]{64}$/.test(rawPubkey) ? rawPubkey : ''
                // Autor-Profil nachwärmen (einmal je pubkey, solange nicht bekannt).
                if (reportedPubkey && !$profiles.has(reportedPubkey)) {
                    loadProfile(reportedPubkey)
                }
                const npub = reportedPubkey ? nip19.npubEncode(reportedPubkey) : ''
                const profile = reportedPubkey ? $profiles.get(reportedPubkey) : undefined
                const reason = eTag[2] ?? ''
                const reportedId = eTag[1] ?? ''
                const reported = reportedId ? byId.get(reportedId) : undefined
                return {
                    id: e.id,
                    reportedId,
                    reportedPubkey,
                    reportedName: reportedPubkey ? displayProfile(profile, shortNpub(npub)) : '?',
                    reason,
                    reasonLabel: REASON_LABELS[reason] ?? (reason || t('Meldung')),
                    text: e.content,
                    roomH: reported ? (getTagValue('h', reported.tags) ?? '') : '',
                }
            }))
        },
    )

/**
 * Lädt die Meldungen des Space frisch vom Relay.
 *
 * - **Buzz:** `GET /moderation/reports?status=open` (NIP-98-signiert). Ein
 *   Fehlschlag wird als Toast gemeldet, NICHT als leere Liste geschluckt — sonst
 *   sähe ein Admin bei kaputter Auth dasselbe wie bei „keine Meldungen".
 * - **zooid:** REQ auf kind 1984 wie bisher.
 *
 * Die Weiche wartet hier auf das NIP-11-Doc ([[spaceIsBuzzAsync]]): das läuft
 * einmal beim Seitenaufbau, und die synchrone Erkennung würde in genau diesem
 * Moment noch `false` liefern.
 */
export const loadSpaceReports = async (url: string): Promise<unknown> => {
    if (!(await spaceIsBuzzAsync(url))) {
        return load({ relays: [url], filters: [{ kinds: [REPORT] }] })
    }
    try {
        setBuzzReports(url, await buzzLoadReports(url))
    } catch (e) {
        toast(t('Melde-Queue nicht abrufbar: :reason', { reason: e instanceof Error ? e.message : String(e) }))
    }
    return undefined
}

/**
 * Lädt die GEMELDETEN Events zu einer Menge von Report-Zielen nach.
 *
 * **Nur noch die zooid-Strecke.** Dort ist das der einzige Weg an das `h` des
 * gemeldeten Events. Auf Buzz liefert der Relay `channel_id` im Report-Datensatz
 * mit — der Umweg ist dort ersatzlos weg (und wäre auch brüchig: nach dem Löschen
 * gibt es das Ziel-Event nicht mehr). Leere Liste → No-op.
 */
export const loadReportedEvents = (url: string, ids: string[]): void => {
    if (ids.length === 0 || spaceIsBuzz(url)) {
        return
    }
    void load({ relays: [url], filters: [{ ids }] })
}

/**
 * Sekunden zwischen zwei Abrufen der Buzz-Queue. Reports haben keinen Push-Kanal:
 * sie sind kein Event, also kann kein REQ sie liefern (siehe oben). Bleibt Polling.
 * 20 s ist der Kompromiss aus „ein Admin merkt eine neue Meldung zeitnah" und
 * „drei signierte NIP-98-Abrufe pro Minute reichen als Last".
 */
const BUZZ_POLL_SECONDS = 20

/**
 * Hält die Meldungen aktuell — Nachzügler erscheinen ohne Neuladen.
 *
 * - **Buzz:** Polling (`setInterval`), abgeräumt am `signal`. Kein REQ möglich.
 * - **zooid:** Live-Sub auf kind 1984 wie bisher.
 */
export const watchSpaceReports = async (url: string, signal: AbortSignal): Promise<void> => {
    if (!(await spaceIsBuzzAsync(url))) {
        void request({ relays: [url], signal, filters: [{ kinds: [REPORT], limit: 0 }] })
        return
    }
    if (signal.aborted) {
        return
    }
    const timer = setInterval(() => void loadSpaceReports(url), BUZZ_POLL_SECONDS * 1000)
    signal.addEventListener('abort', () => clearInterval(timer), { once: true })
}

/**
 * Der aktuelle Schnappschuss der Buzz-Queue eines Space — für Tests und für
 * Aufrufer, die nach einer Aktion ohne Store-Abo nachsehen wollen.
 */
export const getBuzzReports = (url: string): BuzzReport[] => get(buzzReportsByUrl).get(url) ?? []

// ── Beitritts-Queue (P4b/P3b: offene Join-Requests, nur bei `closed`-Räumen) ──
// zooid trägt Beitritte offener Räume automatisch in die 39002 ein → keine offene
// Anfrage. Bei `closed`-Räumen bleibt der 9021 pending, bis ein Admin per kind 9000
// freigibt. „offen" = jüngster 9021 je (Raum, pubkey), pubkey NICHT in der 39002 und
// kein jüngeres 9022 (zurückgezogen).

export type JoinRequestView = {
    id: string // 9021-Event (Ziel von „Ablehnen" = banEvent)
    h: string
    roomName: string
    pubkey: string // Ziel von „Annehmen" = addRoomMember(h, pubkey)
    name: string
}

export const deriveSpaceJoinRequests = (url: string): Readable<JoinRequestView[]> =>
    derived(
        [deriveEventsForUrl(url, [{ kinds: [ROOM_JOIN, ROOM_LEAVE] }]), roomMembersByUrl, roomsByUrl, throttled(300, profilesByPubkey)],
        ([events, $members, $rooms, $profiles]) => {
            // Jüngsten Join je (h,pubkey) + jüngsten Leave-Zeitpunkt sammeln.
            const joins = new Map<string, TrustedEvent>()
            const leaves = new Map<string, number>()
            for (const e of events) {
                const h = getTagValue('h', e.tags)
                if (!h) {
                    continue
                }
                const key = `${h}'${e.pubkey}`
                if (e.kind === ROOM_JOIN) {
                    const prev = joins.get(key)
                    if (!prev || e.created_at > prev.created_at) {
                        joins.set(key, e)
                    }
                } else {
                    leaves.set(key, Math.max(leaves.get(key) ?? 0, e.created_at))
                }
            }
            const views: JoinRequestView[] = []
            for (const [key, join] of joins) {
                const h = getTagValue('h', join.tags) ?? ''
                const room = ($rooms.get(url) ?? []).find((r) => r.h === h)
                // NUR closed-Räume erzeugen offene Anfragen (offene genehmigt zooid
                // automatisch → nie pending). Fehlt der Raum noch (39000 nicht geladen),
                // ebenfalls überspringen → kein „pending"-Flash vor dem 39002/39000-Load.
                if (!room?.isClosed) {
                    continue
                }
                if ($members.get(url)?.get(h)?.has(join.pubkey)) {
                    continue // schon Mitglied (angenommen)
                }
                if ((leaves.get(key) ?? 0) > join.created_at) {
                    continue // Anfrage zurückgezogen
                }
                if (!$profiles.has(join.pubkey)) {
                    loadProfile(join.pubkey)
                }
                const npub = nip19.npubEncode(join.pubkey)
                const profile = $profiles.get(join.pubkey)
                views.push({
                    id: join.id,
                    h,
                    roomName: room.name || h,
                    pubkey: join.pubkey,
                    name: displayProfile(profile, shortNpub(npub)),
                })
            }
            return sortBy((v) => `${v.roomName} ${v.name}`.toLowerCase(), views)
        },
    )

/** Lädt Beitritts-Anfragen (9021/9022) des Space. */
export const loadSpaceJoinRequests = (url: string): Promise<unknown> =>
    load({ relays: [url], filters: [{ kinds: [ROOM_JOIN, ROOM_LEAVE] }] })

/** Live-Sub auf Beitritts-Anfragen — neue erscheinen sofort. */
export const watchSpaceJoinRequests = (url: string, signal: AbortSignal): void => {
    void request({ relays: [url], signal, filters: [{ kinds: [ROOM_JOIN, ROOM_LEAVE], limit: 0 }] })
}
