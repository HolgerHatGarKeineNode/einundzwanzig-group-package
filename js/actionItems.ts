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
import { derived, type Readable } from 'svelte/store'
import { throttled } from '@welshman/store'
import { load, request } from '@welshman/net'
import { profilesByPubkey, loadProfile } from '@welshman/app'
import {
    REPORT,
    ROOM_JOIN,
    ROOM_LEAVE,
    MESSAGE,
    POLL,
    COMMENT,
    getTag,
    getTagValue,
    displayProfile,
    type TrustedEvent,
    type PublishedProfile,
} from '@welshman/util'
import { sortBy } from '@welshman/lib'
import * as nip19 from 'nostr-tools/nip19'
import { deriveEventsForUrl } from './repository'
import { roomsByUrl, roomMembersByUrl } from './groups'

/** NIP-56-Maschinencodes → deutsche Labels (wie das Melde-Modal). */
const REASON_LABELS: Record<string, string> = {
    spam: 'Spam',
    profanity: 'Beleidigung',
    impersonation: 'Identitätsdiebstahl',
    other: 'Sonstiges',
}

const shortNpub = (npub: string): string => `${npub.slice(0, 12)}…${npub.slice(-6)}`

/**
 * Was im Raum überhaupt gemeldet werden kann — die Kinds, die der Chat-Feed als
 * Zeile rendert und die deshalb den „Fork off!"-Knopf tragen. Dient hier nur als
 * Filter für die Store-Quelle, aus der das `h` eines gemeldeten Events kommt;
 * ein Kind zu viel oder zu wenig kostet nichts außer einem leeren `roomH`.
 */
const REPORTABLE_KINDS = [MESSAGE, POLL, COMMENT]

export type ReportView = {
    id: string // Report-Event (Ziel von „Verwerfen")
    reportedId: string // gemeldetes Event (Ziel von „Inhalt entfernen")
    reportedPubkey: string // gemeldeter Autor (Ziel von „Autor bannen")
    reportedName: string
    reason: string
    reasonLabel: string
    text: string // optionaler Freitext des Melders
    /**
     * Raum (`h`) des GEMELDETEN Events — '' solange das Event nicht vorliegt.
     *
     * Der Report selbst trägt bewusst **kein** `h` (siehe `makeReport` in
     * `interactions.ts`: er ist keine Group-Message). Buzz verlangt für die
     * Admin-Löschung kind 9005 aber Raum-Bezug (`requires_h_channel_scope`,
     * `ingest.rs:487`). Das `h` wird deshalb — nach der Hausregel „kein eigenes
     * `h` raten, vom Parent übernehmen" (`parentRoomTags`) — aus dem gemeldeten
     * Event gelesen. Auf zooid ist das Feld folgenlos: dessen NIP-86 `banevent`
     * kennt nur die Event-ID.
     */
    roomH: string
}

/**
 * Die offenen Meldungen des Space, neueste zuerst. Autoren-Profile werden lazy
 * nachgewärmt (Name/Avatar). `throttled`, damit das Neubauen nicht bei jedem
 * eintrudelnden Profil läuft. Ableitung rein aus der `repository` (via
 * `deriveEventsForUrl`) — geladen wird über `loadSpaceReports`/`watchSpaceReports`.
 */
export const deriveSpaceReports = (url: string): Readable<ReportView[]> =>
    derived(
        [
            deriveEventsForUrl(url, [{ kinds: [REPORT] }]),
            // Die gemeldeten Events selbst — Quelle des `h` (siehe ReportView.roomH).
            // Eigene Store-Quelle, damit die Queue neu rechnet, sobald ein per
            // [[loadReportedEvents]] nachgeladenes Ziel eintrifft.
            deriveEventsForUrl(url, [{ kinds: REPORTABLE_KINDS }]),
            throttled(300, profilesByPubkey),
        ],
        ([events, reportable, $profiles]) => {
            const byId = new Map((reportable as TrustedEvent[]).map((e) => [e.id, e]))
            const sorted = sortBy((e: TrustedEvent) => -e.created_at, events)
            return sorted.map((e): ReportView => {
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
                const profile = reportedPubkey ? ($profiles.get(reportedPubkey) as PublishedProfile | undefined) : undefined
                const reason = eTag[2] ?? ''
                const reportedId = eTag[1] ?? ''
                const reported = reportedId ? byId.get(reportedId) : undefined
                return {
                    id: e.id,
                    reportedId,
                    reportedPubkey,
                    reportedName: reportedPubkey ? displayProfile(profile, shortNpub(npub)) : '?',
                    reason,
                    reasonLabel: REASON_LABELS[reason] ?? (reason || 'Meldung'),
                    text: e.content,
                    roomH: reported ? (getTagValue('h', reported.tags) ?? '') : '',
                }
            })
        },
    )

/** Lädt die Meldungen (kind 1984) des Space frisch vom Relay. */
export const loadSpaceReports = (url: string): Promise<unknown> =>
    load({ relays: [url], filters: [{ kinds: [REPORT] }] })

/**
 * Lädt die GEMELDETEN Events zu einer Menge von Report-Zielen nach — sie liefern
 * das `h`, das die Admin-Löschung auf Buzz braucht (kind 9005, siehe
 * [[ReportView.roomH]]). Auf der Directory-Seite lädt sonst niemand Raum-Inhalte,
 * die Ziele wären also nie im Repository.
 *
 * Gezielt per `ids`-Filter statt breiter Raum-Abfrage: das ist genau ein REQ über
 * die offenen Meldungen, unabhängig von der Größe der Räume. Leere Liste → No-op.
 */
export const loadReportedEvents = (url: string, ids: string[]): void => {
    if (ids.length === 0) {
        return
    }
    void load({ relays: [url], filters: [{ ids }] })
}

/** Live-Sub auf neue Meldungen (kind 1984) — Nachzügler erscheinen sofort. */
export const watchSpaceReports = (url: string, signal: AbortSignal): void => {
    void request({ relays: [url], signal, filters: [{ kinds: [REPORT], limit: 0 }] })
}

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
                const profile = $profiles.get(join.pubkey) as PublishedProfile | undefined
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
