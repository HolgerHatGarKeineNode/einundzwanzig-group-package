/**
 * Space/Raum-Datenschicht — portiert aus dem Referenz-Client (`src/app/groups.ts`).
 *
 * Modell (zooid/NIP-29): Ein **Space** ist eine Relay-URL (kein Event). Ein
 * **Raum** ist ein **kind-39000**-Event (ROOM_META) auf genau diesem Relay; die
 * Raum→Space-Bindung entsteht über den `tracker` (von welchem Relay das Event
 * kam), nicht über ein Tag.
 *
 * Zwei Mitgliedschafts-Ebenen: die **SPACE-Ebene** steht in der persönlichen
 * **kind-10009**-Liste des Users (`["r",url]`) und trägt nur die Space-Auswahl.
 * Die **RAUM-Ebene** ist relay-autoritativ: der Relay pflegt bei Join (9021) /
 * Leave (9022) die signierte Members-Liste **kind-39002** (`d`=h, `p`=Mitglieder)
 * — sie ist persistent und die Quelle für „bin ich Mitglied dieses Raums".
 */
import { derived, writable, get, type Readable, type Writable } from 'svelte/store'
import {
    repository,
    tracker,
    makeUserData,
    makeOutboxLoader,
    publishThunk,
    relaysByUrl,
    loadRelay,
} from './welshmanApp.ts'
import { pubkey, nip44EncryptToSelf } from './welshmanSession.ts'
import { deriveItemsByKey, deriveEventsByIdByUrl, sync, throttled, localStorageProvider } from '@welshman/store'
import { Router } from '@welshman/router'
import { AuthStatus, Pool, load, request } from '@welshman/net'
import {
    readList,
    readRoomMeta,
    makeRoomEditEvent,
    asDecryptedEvent,
    makeEvent,
    makeList,
    addToListPublicly,
    removeFromListByPredicate,
    normalizeRelayUrl,
    isRelayUrl,
    type Filter,
    type PublishedList,
    type TrustedEvent,
} from '@welshman/util'
import {
    ROOMS,
    MESSAGE,
    POLL,
    ZAP_GOAL,
    ROOM_META,
    ROOM_CREATE,
    ROOM_DELETE,
    ROOM_MEMBERS,
    ROOM_ADD_MEMBER,
    ROOM_REMOVE_MEMBER,
    ROOM_JOIN,
    ROOM_LEAVE,
    RELAY_JOIN,
    RELAY_LEAVE,
    RELAY_INVITE,
} from './welshmanKinds.ts'
import { getListTags, getRelayTagValues, getGroupTags, getTagValue, getTagValues } from './welshmanTags.ts'
import { uniq, sortBy, partition } from '@welshman/lib'
import {
    createRoomMembershipRevocations,
    roomMembershipKey,
    type RoomMembershipRead,
    type RoomMembershipRevocation,
} from './roomMembership.ts'
import {
    ROOM_RECONCILE_LIMIT,
    candidatesAreCredible,
    classifyRoomAnswer,
    confirmsRoomGone,
    probesAreConclusive,
    selectReconcileCandidates,
    shouldArmReconcileLock,
    type KnownRoomEvent,
    type RoomAnswerSignals,
    type RoomAnswerVerdict,
} from './roomReconcile.ts'
import { storageReady } from './storage.ts'
import { spaceSupportsRooms, spaceBranding, BUZZ_MESSAGE_V2 } from './relayCaps.ts'
import { spaceIsBuzzAsync } from './buzzAdmin.ts'
import { parseMeetupTags } from './meetupPresentation.ts'
import { parseForumTag, parseProjectSupportTags, withExtraTags } from './roomCategories.ts'
import type { RelayProfile } from './welshmanRelay.ts'
import { waitForPublishError } from './publishResult.ts'

export type Room = ReturnType<typeof readRoomMeta> & { id: string; url: string }

/** Room-ID = `${url}'${h}` (Trennzeichen wie im Referenz-Client). */
export const makeRoomId = (url: string, h: string): string => `${url}'${h}`

// ── Space-Membership (kind 10009) ────────────────────────────────────────────

/** Die 10009-Liste je pubkey (nur public Tags — private Entschlüsselung: später). */
export const groupListsByPubkey = deriveItemsByKey<PublishedList>({
    repository,
    filters: [{ kinds: [ROOMS] }],
    eventToItem: (event) => readList(asDecryptedEvent(event)),
    getKey: (list) => list.event.pubkey,
})

/** Die 10009-Liste des eingeloggten Users. */
export const userGroupList = makeUserData(groupListsByPubkey)

/** Space-URLs aus der 10009-Liste: `r`-Tags + drittes Element der `group`-Tags. */
export const getSpaceUrlsFromGroupList = (groupList?: PublishedList): string[] => {
    if (!groupList) {
        return []
    }
    const tags = getListTags(groupList)
    const urls = getRelayTagValues(tags)
    for (const tag of getGroupTags(tags)) {
        const url = tag[2] || ''
        if (isRelayUrl(url)) {
            urls.push(url)
        }
    }
    return uniq(urls.map(normalizeRelayUrl))
}

/**
 * Alle Spaces (Relay-URLs) des eingeloggten Users aus der 10009. Nur noch die
 * SPACE-Ebene wird aus der 10009 gelesen (Space-Auswahl); Raum-Mitgliedschaft
 * ist relay-seitig (39002, siehe unten) statt aus der persönlichen `group`-Liste.
 */
export const userSpaceUrls = derived(userGroupList, getSpaceUrlsFromGroupList)

// ── Rooms (kind 39000 / 9008) ────────────────────────────────────────────────

/** Room-Meta-Events, nach Herkunfts-Relay gruppiert (via tracker). */
export const roomMetaEventsByIdByUrl = deriveEventsByIdByUrl({
    tracker,
    repository,
    filters: [{ kinds: [ROOM_META, ROOM_DELETE] }],
})

/** Rooms je Space-URL — 39000 zu `Room` geparst, 9008-Tombstones berücksichtigt. */
export const roomsByUrl = derived(roomMetaEventsByIdByUrl, ($byUrl) => {
    const result = new Map<string, Room[]>()
    for (const [url, eventsById] of $byUrl) {
        const events = Array.from(eventsById.values()) as TrustedEvent[]
        const [metas, deletes] = partition((e: TrustedEvent) => e.kind === ROOM_META, events)

        const deletedByH = new Map<string, number>()
        for (const del of deletes) {
            for (const h of getTagValues('h', del.tags)) {
                deletedByH.set(h, Math.max(deletedByH.get(h) ?? 0, del.created_at))
            }
        }

        const rooms: Room[] = []
        for (const event of metas) {
            const meta = readRoomMeta(event)
            if ((deletedByH.get(meta.h) ?? 0) >= event.created_at) {
                continue
            }
            rooms.push({ ...meta, url, id: makeRoomId(url, meta.h) })
        }
        result.set(url, rooms)
    }
    return result
})

/** Flacher Index aller Rooms nach `id`. */
export const roomsById = derived(roomsByUrl, ($byUrl) => {
    const result = new Map<string, Room>()
    for (const rooms of $byUrl.values()) {
        for (const room of rooms) {
            result.set(room.id, room)
        }
    }
    return result
})

// ── Raum-Aktivität (`lastMessageAt`) ─────────────────────────────────────────

/**
 * Timeline-Events (kind 9/1068/9041) aller Spaces, nach Herkunfts-Relay (tracker) —
 * dieselben Kinds, die auch im Raum-Verlauf stehen (`feeds.ts roomStreamFilter`), damit
 * eine Poll oder ein Spendenziel einen Raum genauso „aktiv" macht wie eine Nachricht.
 */
const timelineEventsByIdByUrl = deriveEventsByIdByUrl({
    tracker,
    repository,
    filters: [{ kinds: [MESSAGE, BUZZ_MESSAGE_V2, POLL, ZAP_GOAL] }],
})

/**
 * Jüngster Timeline-Zeitstempel je Space-URL und Raum-`h`.
 *
 * Das Feld `lastMessageAt` war bis hierher TOTER CODE: die Sortierung der Raumliste
 * (`bridge.ts _ensureFiltered`) las es viermal, geschrieben hat es nie jemand — sie fiel
 * damit IMMER auf den alphabetischen Zweig zurück, und die „Sortierung nach letzter
 * Aktivität" existierte nur im Kommentar. Hier entsteht der Schreiber.
 *
 * `throttled(1000)`: die Quelle feuert pro eingehendem Event. Ohne Drosselung würde
 * jede Nachricht die komplette Space-Sicht neu bauen (und darüber `pushSyncState`).
 * Eine Sekunde Verzug in einer Sortierreihenfolge sieht niemand.
 */
export const lastMessageAtByUrl: Readable<Map<string, Map<string, number>>> = derived(
    throttled(1000, timelineEventsByIdByUrl),
    ($byUrl) => {
        const result = new Map<string, Map<string, number>>()
        for (const [url, eventsById] of $byUrl) {
            const byH = new Map<string, number>()
            for (const event of eventsById.values() as Iterable<TrustedEvent>) {
                const h = getTagValue('h', event.tags)
                if (h && event.created_at > (byH.get(h) ?? 0)) {
                    byH.set(h, event.created_at)
                }
            }
            result.set(url, byH)
        }
        return result
    },
)

// ── Raum-Mitgliedschaft (NIP-29 39002, relay-autoritativ) ────────────────────

/**
 * P9 — die Entzüge, die der Relay von sich aus meldet. Modul-weit und nur im
 * Speicher: eine Marke ist eine Aussage über die LAUFENDE Sitzung („der Relay hat
 * uns gerade hinausgeworfen"), keine Konfiguration. Nach einem Reload beantwortet
 * der Relay dieselbe Frage in einer halben Sekunde neu — bis dahin gilt der
 * Cache-Stand, wie bei jeder anderen Fläche auch.
 */
const roomMembershipRevocations = createRoomMembershipRevocations()

/** Members-Listen (39002) je Space-URL, nach Herkunfts-Relay (tracker). */
export const roomMembersEventsByIdByUrl = deriveEventsByIdByUrl({
    tracker,
    repository,
    filters: [{ kinds: [ROOM_MEMBERS] }],
})

/**
 * Die JÜNGSTE 39002 je Space-URL und Raum-`h`. Zwischenschritt mit einem eigenen
 * Namen, weil P9 nicht nur die Mitglieder-Menge braucht, sondern auch die
 * **Event-id** der Liste: nur an ihr ist zu erkennen, ob eine nachgelesene Liste
 * eine ANDERE ist als die, die der Relay gerade für ungültig erklärt hat
 * (siehe `roomMembership.ts`).
 *
 * 39002 ist parameterisiert-ersetzbar, im Repository liegt je (`d`, Relay-Pubkey)
 * also ohnehin nur die neueste — der `created_at`-Vergleich ist die Absicherung
 * gegen zwei Signierschlüssel desselben Relays (Buzz führt in NIP-11 eine
 * Schlüsselliste mit `current`-Flag).
 */
const roomMembersEventByUrl: Readable<Map<string, Map<string, TrustedEvent>>> = derived(
    roomMembersEventsByIdByUrl,
    ($byUrl) => {
        const result = new Map<string, Map<string, TrustedEvent>>()
        for (const [url, byId] of $byUrl) {
            const byH = new Map<string, TrustedEvent>()
            for (const event of byId.values()) {
                const trusted = event as TrustedEvent
                const h = getTagValue('d', trusted.tags)
                if (!h) {
                    continue
                }
                const known = byH.get(h)
                if (!known || known.created_at < trusted.created_at) {
                    byH.set(h, trusted)
                }
            }
            result.set(url, byH)
        }
        return result
    },
)

/**
 * Mitglieder-Pubkeys je Room-`h` und Space-URL, aus der relay-signierten
 * 39002-Liste (`d`=h, `p`=Mitglieder). Das ist die **autoritative** Quelle: der
 * Relay pflegt sie bei Join (9021) / Leave (9022) und sie übersteht Reloads.
 *
 * **P9 — eine Korrektur um den vom Relay selbst gemeldeten Entzug.** Der eigene
 * Pubkey fällt aus der Menge, solange für diesen Raum eine Entzugs-Marke steht
 * ({@link revokeRoomMembership}). Grund und Messung stehen in `roomMembership.ts`;
 * kurz: bei einem Fremd-Rauswurf aus einem PRIVATEN Raum liefert der Relay auf
 * kein REQ mehr eine 39002 — die alte Liste (auch aus der IndexedDB) behauptet
 * die Mitgliedschaft dann bis in alle Ewigkeit weiter. Die Korrektur sitzt hier
 * und nicht an einer einzelnen Fläche, damit sie für JEDEN Konsumenten gilt:
 * Composer, „Meine Räume" in Rail und Palette, Pin-Recht, Mitgliederliste.
 *
 * Fremde Pubkeys bleiben unangetastet — der Entzug ist eine Aussage über UNS.
 */
export const roomMembersByUrl: Readable<Map<string, Map<string, Set<string>>>> = derived(
    [roomMembersEventByUrl, roomMembershipRevocations, pubkey],
    ([$byUrl, $revocations, $pk]: [
        Map<string, Map<string, TrustedEvent>>,
        ReadonlyMap<string, RoomMembershipRevocation>,
        string | undefined,
    ]) => {
        const result = new Map<string, Map<string, Set<string>>>()
        for (const [url, byEvent] of $byUrl) {
            const byH = new Map<string, Set<string>>()
            for (const [h, event] of byEvent) {
                const members = new Set(getTagValues('p', event.tags))
                if ($pk && members.has($pk) && $revocations.has(roomMembershipKey(url, h))) {
                    members.delete($pk)
                }
                byH.set(h, members)
            }
            result.set(url, byH)
        }
        return result
    },
)

/** Ist der eingeloggte User Mitglied des Raums (reaktiv, relay-autoritativ)? */
export const deriveUserInRoom = (url: string, h: string): Readable<boolean> =>
    derived([roomMembersByUrl, pubkey], ([$byUrl, $pk]) =>
        Boolean($pk && $byUrl.get(normalizeRelayUrl(url))?.get(h)?.has($pk)),
    )

/** Anzeigename eines Rooms (Name oder Fallback auf `h`). */
export const displayRoom = (room: Room | undefined, h: string): string => room?.name || h

// ── Aggregierte Sicht für die UI ─────────────────────────────────────────────

export type RoomView = {
    h: string
    name: string
    /** Beschreibung (39000 `about`), '' wenn keine — für den Edit-Prefill. */
    about: string
    picture: string
    /** Aggregiert (privat|eingeschränkt|geschlossen) → Schloss-Badge. */
    locked: boolean
    // Einzel-Flags (für den Admin-Edit-Prefill, damit ein Speichern keine wegwirft).
    isPrivate: boolean
    isClosed: boolean
    isHidden: boolean
    isRestricted: boolean
    // ── Meetup-Felder (Plan E1/E2) ─────────────────────────────────────────────
    // Aus den ROH-Tags des 39000 (`room.event.tags`) gehoben — welshmans
    // `readRoomMeta` liest diese Custom-Tags nicht. Die Praesentation (Flagge,
    // Portal-Deep-Link, naechster Termin) joint der Client zur Render-Zeit ueber
    // `meetupSlug` gegen die Portal-Liste (`meetups.ts`), sie steht NICHT hier.
    /** Traegt das 39000 den `["t","meetup"]`-Marker? */
    isMeetup: boolean
    /** Stabile Meetup-id aus `["i","meetup:<id>"]` ('' wenn keins). */
    meetupId: string
    /** Slug aus `["meetup_slug","<slug>"]` — der Praesentations-Join-Schluessel. */
    meetupSlug: string
    // ── Projektunterstuetzung (Vereins-Antragsraeume) ──────────────────────────
    // Ebenfalls aus den ROH-Tags des 39000, siehe `roomCategories.ts`. Die
    // Raeume sind kategorisiert, NICHT versteckt: sie fallen aus den
    // entdeckbaren Standard-Raeumen, bleiben aber in „Meine Raeume".
    /** Traegt das 39000 den `["t","project-support"]`-Marker? */
    isProjectSupport: boolean
    /** Stabile Antrags-id aus `["i","proposal:<id>"]` ('' wenn keine). */
    proposalId: string
    // ── Forum (Buzz, P3) ───────────────────────────────────────────────────────
    /**
     * Traegt das 39000 den Buzz-Kanaltyp `["t","forum"]`? Dann rendert `/rooms/{h}`
     * eine Themenliste (45001) statt des Chat-Verlaufs (kind 9), und die Rail
     * zeigt die Zeile mit dem Forum-Icon. Quelle ist der Relay-eigene
     * `channel_type` — siehe `FORUM_CHANNEL_TYPE` in `roomCategories.ts`.
     */
    isForum: boolean
    /**
     * `created_at` des jüngsten bekannten Timeline-Events (9/1068/9041) dieses Raums,
     * `null` solange keins vorliegt. Quelle: {@link lastMessageAtByUrl}. Trägt die
     * Sortierung der Raumliste nach Aktivität.
     *
     * ACHTUNG, das ist AUTORGESETZTE Zeit (NIP-01), nicht die Uhr dieses Geräts — für
     * eine Reihenfolge genügt das, als Lese-Wasserzeichen NICHT (dafür `readState.ts`).
     */
    lastMessageAt: number | null
}
export type SpaceView = {
    url: string
    label: string
    /** NIP-11 `icon` (Space-Avatar), '' wenn keins. */
    icon: string
    /** NIP-11 `description` (Untertitel), '' wenn keine. */
    description: string
    /** NIP-11 `banner` (Kopfbild), '' wenn keins. */
    banner: string
    userRooms: RoomView[]
    otherRooms: RoomView[]
}

/** Kürzt eine Relay-URL für die Anzeige (Schema/Trailing-Slash weg). */
export const displayRelayUrl = (url: string): string =>
    url.replace(/^wss?:\/\//, '').replace(/\/$/, '')

/**
 * Baut die UI-Sicht EINES Space: beigetretene (Mitglied laut 39002) vs.
 * entdeckbare Räume. Mitgliedschaft ist relay-autoritativ und persistent.
 */
const buildSpaceView = (
    url: string,
    byUrl: Map<string, Room[]>,
    byId: Map<string, Room>,
    membersByH: Map<string, Set<string>>,
    pk: string | undefined,
    profile: RelayProfile | undefined,
    lastByH: Map<string, number>,
): SpaceView => {
    const nameOf = (h: string) => displayRoom(byId.get(makeRoomId(url, h)), h)
    const isMember = (h: string) => Boolean(pk && membersByH.get(h)?.has(pk))

    const joined: string[] = []
    const other: string[] = []
    for (const room of byUrl.get(url) ?? []) {
        if (room.livekit) {
            continue
        }
        ;(isMember(room.h) ? joined : other).push(room.h)
    }

    const toView = (hs: string[]): RoomView[] =>
        sortBy(nameOf, uniq(hs)).map((h) => {
            const room = byId.get(makeRoomId(url, h))
            // Meetup-Marker/-Schluessel aus den ROH-Tags des 39000 heben (readRoomMeta
            // liest sie nicht). Fehlt das Event (Warm-Render-Race), bleibt es kein Meetup.
            const meetup = parseMeetupTags(room?.event?.tags ?? [])
            const projectSupport = parseProjectSupportTags(room?.event?.tags ?? [])
            return {
                h,
                name: displayRoom(room, h),
                about: room?.about ?? '',
                picture: room?.picture ?? '',
                locked: Boolean(room?.isPrivate || room?.isRestricted || room?.isClosed),
                isPrivate: Boolean(room?.isPrivate),
                isClosed: Boolean(room?.isClosed),
                isHidden: Boolean(room?.isHidden),
                isRestricted: Boolean(room?.isRestricted),
                isMeetup: meetup.isMeetup,
                meetupId: meetup.meetupId,
                meetupSlug: meetup.meetupSlug,
                isProjectSupport: projectSupport.isProjectSupport,
                proposalId: projectSupport.proposalId,
                isForum: parseForumTag(room?.event?.tags ?? []),
                lastMessageAt: lastByH.get(h) ?? null,
            }
        })

    const brand = spaceBranding(displayRelayUrl(url), profile)
    return { url, ...brand, userRooms: toView(joined), otherRooms: toView(other) }
}

/**
 * Liefert das NIP-11-Profil eines Relays aus dem Store und stößt das Laden an,
 * falls es noch fehlt. `loadRelay` cached (Erfolg 1h, Fehler-Backoff, Pending
 * dedupliziert) → gefahrlos aus reaktiven Derives/Rebuilds aufrufbar.
 */
export const ensureRelayProfile = (
    relays: Map<string, RelayProfile>,
    url: string,
): RelayProfile | undefined => {
    if (!relays.has(url)) {
        void loadRelay(url)
    }
    return relays.get(url)
}

/**
 * Ein einziger reaktiver Snapshot aller Spaces des Users mit ihren beigetretenen
 * und entdeckbaren Räumen — die Grundlage der Space-Auswahl in den Einstellungen.
 */
export const userSpacesView: Readable<SpaceView[]> = derived(
    [userSpaceUrls, roomsByUrl, roomsById, roomMembersByUrl, pubkey, relaysByUrl, lastMessageAtByUrl],
    ([$urls, $byUrl, $byId, $members, $pk, $relays, $lastAt]) =>
        $urls.map((url) =>
            buildSpaceView(
                url,
                $byUrl,
                $byId,
                $members.get(url) ?? new Map(),
                $pk,
                ensureRelayProfile($relays, url),
                $lastAt.get(url) ?? new Map(),
            ),
        ),
)

// ── Aktiver Space (Single-Space-Fokus, §12) ─────────────────────────────────

/**
 * Fixierter Default-Space: eine hardcodierte Relay-URL (§12). Die App fokussiert
 * IMMER genau diesen Space — unabhängig von der 10009-Mitgliedschaft; gewechselt
 * wird nur in den Einstellungen. Überschreibbar via `window.__nostrSpace` (E2E);
 * Prod setzt hier die echte Vereins-Relay-URL.
 * ponytail: hardcodiert auf den lokalen Test-Relay — Upgrade: aus Server-Config
 * injizieren, sobald die produktive Space-URL feststeht.
 */
const spaceOverride = (globalThis as { __nostrSpace?: string }).__nostrSpace
export const DEFAULT_SPACE_URL = normalizeRelayUrl(spaceOverride ?? 'ws://localhost:3334/')

/**
 * Die EINUNDZWANZIG-Vereins-Relays: der fixierte Default-Space (lokaler
 * Test-Relay bzw. via `__nostrSpace` der prod-Relay) plus der öffentliche
 * `group.einundzwanzig.space`. Nur für diese zeigt die UI Nicht-Mitgliedern den
 * Vereins-Beitritts-Hinweis (Zugang via verein.einundzwanzig.space).
 */
export const VEREIN_RELAY_URLS = uniq([
    DEFAULT_SPACE_URL,
    normalizeRelayUrl('wss://group.einundzwanzig.space/'),
])

/** Ist die URL ein EINUNDZWANZIG-Vereins-Relay (gated auf Vereinsmitglieder)? */
export const isVereinRelay = (url: string): boolean => VEREIN_RELAY_URLS.includes(normalizeRelayUrl(url))

/**
 * Die vom User gewählte Space-URL, in localStorage persistiert. Null = Default.
 * Es gibt KEINE Space-Rail und KEINE „Space wählen"-Pflicht — der Default-Space
 * lädt sofort; gewechselt wird nur in den Einstellungen (`/settings/space`).
 */
/**
 * Der zweite, FESTE Space des Tabs „Workspaces" (`WORKSPACE_URL`) und die Frage,
 * ob er überhaupt konfiguriert ist (`hasWorkspace`) — **definiert in
 * `spaceCaps.ts`**, hier nur unverändert weitergereicht, damit kein Aufrufer sich
 * ändern muss.
 *
 * Warum dort und nicht hier: `spaceCaps.ts` trägt die zweite Gating-Ebene
 * (`deriveSpaceKind`) und ist die schlankere Datei — sie zieht nichts aus dem
 * Gruppen-Graphen nach. Importierte `spaceCaps.ts` von hier, entstünde ein Zirkel.
 * Die Abhaengigkeit zeigt deshalb in genau eine Richtung: `groups.ts` → `spaceCaps.ts`.
 * (Bis P1/P2 des Plans `js-insel-testbar-machen` stand hier zusätzlich, diese Datei
 * sei aus `node --test` gar nicht ladbar — endungslose Importe und ein
 * localStorage-Zugriff beim Laden. Beides ist behoben, siehe unten.)
 */
export { WORKSPACE_URL, hasWorkspace } from './spaceCaps.ts'

/** localStorage-Schlüssel der persistierten Space-Wahl. Historisch ohne `e21:`-Präfix. */
const ACTIVE_SPACE_KEY = 'activeSpaceUrl'

/** Der eigentliche Speicher hinter {@link activeSpaceUrl} — nur über die Fassade erreichbar. */
const activeSpaceStore = writable<string | null>(null)

let activeSpaceSyncStarted = false

/**
 * Startet die localStorage-Bindung von {@link activeSpaceUrl} — beim ERSTEN
 * Zugriff, nicht beim Modul-Eval. Idempotent.
 *
 * **Warum verzögert:** welshmans `sync()` liest `localStorage` sofort. In
 * `node --experimental-strip-types` gibt es das nicht, und der Wurf beim Modul-Eval
 * war der einzige *ungefangene* der Insel — er sperrte `groups.ts` und alles, was
 * es zieht (`bridge`, `rail`, `palette`, `members`, `verein`, `roomPins`,
 * `roomSearch`, `actionItems`, `index`), aus jedem reinen Test aus. Plan
 * `js-insel-testbar-machen`, P2.
 *
 * **Warum das den Zeitpunkt nicht verschiebt — gemessen, nicht angenommen.** Der
 * erste Zugriff auf {@link activeSpaceUrl} passiert weiter unten in DIESER Datei:
 * `pushSyncState.subscribe(…)` steht im Modul-Toplevel und hängt über
 * `activeSpaceView` → `activeSpace` an diesem Store. Die Bindung startet also im
 * selben Modul-Eval wie vorher, nur ein paar Zeilen später. Kein Leser sieht einen
 * anderen Wert als vorher, und die Hydrierung war auch vorher schon asynchron
 * (`sync` ist `async`) — sie war beim ersten Leser AUSSERHALB dieser Datei
 * (`alpine:init`) längst durch und ist es weiterhin.
 *
 * **Das ist eine tragende Annahme, kein Zufall.** Verschwände dieser
 * Toplevel-Abonnent, rutschte die Bindung auf den ersten Leser bei `alpine:init` —
 * und der sähe dann für einen Microtask `null`, was `activeSpace` auf
 * {@link DEFAULT_SPACE_URL} abbildet: jeder Abonnent liefe einmal gegen den
 * falschen Space an (Raum-Abos, Ungelesen-Ableitung, NIP-11). Festgehalten in
 * `activeSpacePersistenz.test.ts` — der erste Fall dort wird rot, sobald der bloße
 * Import die gespeicherte Wahl nicht mehr hydriert.
 *
 * Ein `try` braucht es hier nicht: `sync` ist `async`, ein fehlendes `localStorage`
 * kommt als Rejection zurück, nicht als Wurf.
 */
const ensureActiveSpaceSync = (): void => {
    if (activeSpaceSyncStarted) {
        return
    }
    activeSpaceSyncStarted = true
    void sync({
        key: ACTIVE_SPACE_KEY,
        store: activeSpaceStore,
        storage: localStorageProvider,
    }).catch(() => {
        // Kein/gesperrtes `localStorage` (node, Privatmodus) → die Wahl gilt nur für
        // diese Sitzung. Gleiche fail-soft-Zusage wie `readQuoteCards` in `displayPrefs.ts`.
    })
}

/**
 * Die vom User gewählte Space-URL, in localStorage persistiert. Null = Default.
 * Es gibt KEINE Space-Rail und KEINE „Space wählen"-Pflicht — der Default-Space
 * lädt sofort; gewechselt wird nur in den Einstellungen (`/settings/space`).
 *
 * Fassade um einen `writable`: jeder Zugriff — `subscribe`, `get()`, `derived(…)`,
 * `set` — läuft durch {@link ensureActiveSpaceSync} und startet damit die
 * localStorage-Bindung. Die Wache sitzt bewusst an dieser einen Engstelle und
 * nicht an den ~10 Aufrufern: ein neuer Leser kann sie nicht vergessen.
 */
export const activeSpaceUrl: Writable<string | null> = {
    subscribe: (run, invalidate) => {
        ensureActiveSpaceSync()

        return activeSpaceStore.subscribe(run, invalidate)
    },
    set: (value) => {
        ensureActiveSpaceSync()
        activeSpaceStore.set(value)
    },
    update: (updater) => {
        ensureActiveSpaceSync()
        activeSpaceStore.update(updater)
    },
}

/** Setzt den aktiven Space (aus der Einstellungsseite) — persistiert die Wahl. */
export const setActiveSpace = (url: string): void => activeSpaceUrl.set(url)

/**
 * Setzt den aktiven Space **nur für diese Sitzung** — der localStorage bleibt, wie er
 * ist. Für den Workspaces-Tab: dort ist der Space-Wechsel eine Navigation, keine Wahl.
 *
 * **Warum das nicht kosmetisch ist:** `activeSpaceUrl` wird persistiert (`sync` auf
 * `localStorage`), und dieser Eintrag schlägt beim nächsten Start die Konfiguration.
 * Würde ein Klick auf einen Workspace-Raum ihn schreiben, startete die App nach einem
 * Reload oder Absturz im Workspace statt im Vereins-Space — ohne dass der Nutzer das je
 * gewählt hat, und ohne Hinweis. Genau dieses Muster („die Konfiguration stimmte, der
 * Browser nicht") hat lokal schon einmal eine Dreiviertelstunde Fehlersuche gekostet.
 *
 * Der Trick ist der `sync`-Mechanismus selbst: er schreibt bei jeder Store-Änderung.
 * Also wird hier NICHT der Store gesetzt, sondern ein Override daneben gehalten, den
 * `activeSpace` vorrangig liest.
 */
export const ephemeralSpaceUrl = writable<string | null>(null)

export const setActiveSpaceEphemeral = (url: string): void => ephemeralSpaceUrl.set(url)

/** Verlässt einen ephemeren Space wieder — zurück auf die persistierte Wahl. */
export const clearEphemeralSpace = (): void => ephemeralSpaceUrl.set(null)

/**
 * Die effektive aktive Space-URL. Vorrang von oben nach unten:
 *   1. ein ephemerer Space (Workspaces-Tab, nur diese Sitzung)
 *   2. die persistierte Wahl aus den Einstellungen
 *   3. der konfigurierte Default
 *
 * Der ephemere Vorrang ist bewusst NICHT persistiert — siehe
 * {@link setActiveSpaceEphemeral}. Ein harter Reload landet damit immer wieder auf
 * der persistierten Wahl, nie in einem Workspace.
 */
export const activeSpace: Readable<string> = derived(
    [ephemeralSpaceUrl, activeSpaceUrl],
    ([$ephemeral, $active]) => normalizeRelayUrl($ephemeral ?? $active ?? DEFAULT_SPACE_URL),
)

/**
 * Der aktive Space als fertige UI-Sicht — für JEDE URL, auch wenn der User dem
 * Space (noch) nicht beigetreten ist. Rooms streamen nach dem 39000-Load ein.
 */
export const activeSpaceView: Readable<SpaceView> = derived(
    [activeSpace, roomsByUrl, roomsById, roomMembersByUrl, pubkey, relaysByUrl, lastMessageAtByUrl],
    ([$active, $byUrl, $byId, $members, $pk, $relays, $lastAt]) =>
        // NIP-11 auch für den aktiven Space anstoßen — inkl. Vereins-Relays, die
        // sonst nie geladen würden (nur `groupSpaceChoices` lädt non-verein).
        buildSpaceView(
            $active,
            $byUrl,
            $byId,
            $members.get($active) ?? new Map(),
            $pk,
            ensureRelayProfile($relays, $active),
            $lastAt.get($active) ?? new Map(),
        ),
)

/**
 * Dieselbe Sicht für eine **feste** Space-URL — die Grundlage des Workspaces-Tabs.
 *
 * `activeSpaceView` oben hängt an `activeSpace` und beantwortet damit „was zeigt die
 * App gerade". Der Workspaces-Tab braucht etwas anderes: die Räume eines ZWEITEN
 * Space, **während** der erste aktiv bleibt. Das geht ohne Umbau, weil die gesamte
 * Datenschicht pro Relay-URL indiziert ist (`roomsByUrl`, `roomMembersByUrl`,
 * `lastMessageAtByUrl`) — es ist derselbe Aufbau, nur mit konstanter URL statt Store.
 *
 * Wer sie nutzt, muss die Räume selbst anstoßen ({@link watchSpaceRooms}) — diese
 * Ableitung liest nur.
 */
export const deriveSpaceViewFor = (url: string): Readable<SpaceView> => {
    const normalized = normalizeRelayUrl(url)
    return derived(
        [roomsByUrl, roomsById, roomMembersByUrl, pubkey, relaysByUrl, lastMessageAtByUrl],
        ([$byUrl, $byId, $members, $pk, $relays, $lastAt]) =>
            buildSpaceView(
                normalized,
                $byUrl,
                $byId,
                $members.get(normalized) ?? new Map(),
                $pk,
                ensureRelayProfile($relays, normalized),
                $lastAt.get(normalized) ?? new Map(),
            ),
    )
}

/**
 * Zustand für den nativen Push-Worker (Android): aktiver Space + die Räume, in
 * denen der User Mitglied ist. Der Worker kennt weder Login noch
 * Mitgliedschaft — beides lebt ausschliesslich hier im Client.
 *
 * Der Weg geht über localStorage + ein Event statt über einen direkten Aufruf,
 * weil das mobile Layout der Companion-App (Meetups) dieses Bundle gar nicht
 * lädt und den Stand trotzdem mitsynchronisieren muss. Abgeholt wird beides in
 * `partials/push-sync.blade.php` (Companion-Repo).
 */
export const pushSyncState: Readable<{
    relay: string
    rooms: string[]
    names: Record<string, string>
}> = derived(activeSpaceView, ($space) => ({
    relay: $space.url,
    rooms: $space.userRooms.map((room) => room.h),
    // Nur für den Notification-Titel: der Worker kennt sonst bloss die Raum-ID
    // (`eegreyplugough8`) und schriebe „Neue Nachricht". Der Name steht im
    // 39000-Event des Relays und ist damit nur hier bekannt.
    names: Object.fromEntries($space.userRooms.map((room) => [room.h, room.name])),
}))

// Zuletzt geschriebener Push-Zustand — Wächter gegen Leerlauf-Schreibvorgänge.
// `activeSpaceView` emittiert seit `lastMessageAt` auch bei bloßer Raum-AKTIVITÄT
// (gedrosselt, aber regelmäßig); der abgeleitete Push-Zustand (Relay + Raumliste +
// Namen) ändert sich dabei fast nie. Ohne diesen Vergleich schriebe jede Nachrichten-
// welle localStorage neu und weckte den Android-Worker per `push-sync`-Event, obwohl
// er exakt denselben Zustand schon hat.
let lastPushSyncJson: string | null = null

pushSyncState.subscribe(($state) => {
    try {
        const json = JSON.stringify($state)
        if (json === lastPushSyncJson) {
            return
        }
        lastPushSyncJson = json
        localStorage.setItem('pushSync', json)
        // Die Mitgliedschaft (39002) streamt erst NACH dem Seitenaufbau ein — ohne
        // dieses Event hätte der Sync beim App-Start immer eine leere Raumliste
        // gesehen und den Worker abbestellt.
        window.dispatchEvent(new CustomEvent('push-sync'))
    } catch (e) {
        // localStorage/Event nicht verfügbar → der Worker behält seinen letzten Stand.
    }
})

/** Space-Auswahl in den Einstellungen: der fixe Default + beigetretene Spaces. */
export const spaceChoices: Readable<string[]> = derived(userSpaceUrls, ($urls) =>
    uniq([DEFAULT_SPACE_URL, ...$urls]),
)

/**
 * Space-Auswahl, gefiltert auf NIP-29-fähige Relays: nur ein Group-Relay kann
 * Räume tragen. Support kommt aus dem NIP-11-Info-Doc (`supported_nips`), das
 * welshman via `loadRelay` in `relaysByUrl` cached (Erfolg 1h, Fehler mit
 * Backoff, Pending dedupliziert) — der `loadRelay`-Aufruf im derived ist daher
 * unbedenklich und triggert den Nachlauf selbst neu, sobald sich die Auswahl
 * ändert oder ein Profil eintrifft. Die Filter-Entscheidung selbst liegt rein
 * in `spaceSupportsRooms` (welshman-frei, testbar).
 */
export const groupSpaceChoices: Readable<string[]> = derived([spaceChoices, relaysByUrl], ([$urls, $byUrl]) =>
    $urls.filter((url) => {
        const isVerein = isVereinRelay(url)
        if (!isVerein && !$byUrl.has(url)) {
            void loadRelay(url)
        }
        return spaceSupportsRooms(isVerein, $byUrl.get(url))
    }),
)

// ── Laden ────────────────────────────────────────────────────────────────────

/** Lädt die 10009-Liste des Users über dessen Outbox-Relays. */
export const loadUserGroupList = (): Promise<void> | undefined => {
    const pk = pubkey.get()
    return pk ? makeOutboxLoader(ROOMS)(pk) : undefined
}

/**
 * Lädt Raum-Metas (39000/9008) + Mitglieder-Listen (39002) vom Space-Relay.
 *
 * **P9:** Was hier hereinkommt, ist frisch vom Relay gelesen — also der zweite Weg,
 * auf dem eine Entzugs-Marke fallen kann (der erste ist {@link reloadRoomMembership}
 * nach einem Beitritt). Das deckt den Fall ab, dass ein Admin den Nutzer wieder
 * hinzufügt, während die App offen ist: der Relay meldet das von sich aus nicht,
 * aber der nächste Raumwechsel oder Vordergrund-Resync liest die Liste neu.
 */
export const loadSpaceRooms = (url: string): Promise<unknown> =>
    load({ relays: [url], filters: [{ kinds: [ROOM_META, ROOM_DELETE, ROOM_MEMBERS] }] }).then((events) => {
        confirmRoomMembershipFromSpaceRead(url, events as TrustedEvent[])
        return events
    })

/**
 * Live-Sub auf die Räume (39000/9008/39002) eines Space: lädt Bestand UND bleibt
 * offen (kein CLOSE) → überlebt langsames NIP-42-AUTH auf `public_read=false`-
 * Relays (welshman replayt den gepufferten REQ nach AUTH). Ein One-Shot-`load`
 * läuft dagegen ins Timeout, sendet CLOSE und die Räume erscheinen nie. */
export const watchSpaceRooms = (url: string, signal: AbortSignal): void => {
    void request({ relays: [url], signal, filters: [{ kinds: [ROOM_META, ROOM_DELETE, ROOM_MEMBERS] }] })
    // Die Live-Sub ist rein ADDITIV — sie kann einen Raum nur hinzufügen, nie
    // entfernen. Der zweite, abgleichende REQ steht hier und nicht beim Aufrufer,
    // weil das die einzige Engstelle ist, durch die JEDE Raumliste geht
    // (`rail.ts`, `bridge.ts`, `palette.ts`, Heim-Space wie Workspace).
    void reconcileSpaceRooms(url)
}

// ── Abgleich: was der Relay nicht mehr liefert, fliegt raus ──────────────────

/**
 * Zeitfenster nach einem TRAGFÄHIGEN Abgleich, in dem nicht erneut gefragt wird.
 *
 * `watchSpaceRooms` läuft pro Seitenaufbau mehrfach für dieselbe URL (Rail und
 * Raumliste abonnieren beide, der Workspace zusätzlich). Ein Abgleich pro Space
 * und Minute reicht; die Räume ändern sich nicht im Sekundentakt.
 *
 * Was die Sperre setzen darf, entscheidet {@link shouldArmReconcileLock} und
 * ausdrücklich NICHT das Verdikt allein — die Begründung (samt Messung) steht dort.
 * Kurz: ein Lauf, der nichts vergleichen konnte, ist kein Erfolg, den man sich
 * merken müsste.
 */
const ROOM_RECONCILE_COOLDOWN_MS = 60_000

/**
 * Zeitbudget eines Abgleich-REQ. Großzügig, weil davor eine NIP-42-Runde liegen kann,
 * die auf eine Signatur aus einem entfernten Bunker wartet.
 */
const ROOM_RECONCILE_TIMEOUT_MS = 20_000

/**
 * Zeitbudget für das Spiegeln des IndexedDB-Cache in das repository.
 *
 * Rein lokale Arbeit (`ensureAuthReady()` ist nur ein localStorage-Sync, danach zwei
 * IndexedDB-`getAll`) — fünf Sekunden sind hier keine Netzfrist, sondern ein
 * Notausstieg, damit ein hängender Speicher nicht die In-Flight-Marke behält und
 * den Abgleich dauerhaft abwürgt.
 */
const ROOM_RECONCILE_HYDRATE_MS = 5_000

/** url → Zeitpunkt des letzten tragfähigen Abgleichs. */
const roomReconcileDoneAt = new Map<string, number>()

/** Läuft gerade ein Abgleich für diese URL? Verhindert Doppelabfragen beim Mount. */
const roomReconcileInFlight = new Set<string>()

/**
 * Wartet, bis der IndexedDB-Cache in das repository gespiegelt ist. `false` = nicht
 * rechtzeitig fertig.
 *
 * **`storageReady` wird hier absichtlich erst im Funktionsrumpf gelesen.** Es ist ein
 * `export let`, das `initStorage()` neu zuweist; ein modulweites `const x =
 * storageReady` fror den anfänglichen `Promise.resolve()`-Platzhalter ein und
 * „wartete" dann auf nichts. Dieselbe Bauform wie `forge.ts forgeCacheReady`.
 */
const awaitCacheHydration = async (): Promise<boolean> => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const expired = new Promise<false>((resolve) => {
        timer = setTimeout(() => resolve(false), ROOM_RECONCILE_HYDRATE_MS)
    })
    try {
        // `storageReady` rejectet nie (fail-soft, siehe `storage.ts`).
        return await Promise.race([storageReady.then(() => true), expired])
    } finally {
        clearTimeout(timer)
    }
}

/** Ein REQ, dessen Signale ausgewertet werden — breite Abfrage wie Einzelprobe. */
type RoomReqResult = RoomAnswerSignals & { rooms: TrustedEvent[] }

/**
 * Ein REQ an EINEN Relay, mit Zeitbudget, der neben den Ereignissen auch mitschreibt,
 * WIE die Antwort endete.
 *
 * Bewusst `request` und nicht `load()`:
 *  - `load` bündelt (200 ms) und **vereinigt** Filter fremder Aufrufer
 *    (`unionFilters`) — die Antwort wäre dann nicht mehr die auf meine Frage.
 *  - `load` reicht **kein `onClosed`** durch (`LoadOptions` in
 *    `@welshman/net request.d.ts`) — genau das Signal, das eine abgelehnte Antwort
 *    von einer leeren trennt.
 *
 * Das eigene `AbortSignal.timeout` ist Pflicht: `request` reicht immer ein Signal an
 * `requestOne` durch, womit dessen eingebauter 30-s-Notausstieg NICHT greift — ohne
 * das Budget bliebe der REQ bei einem schweigenden Relay ewig offen.
 */
const requestRooms = async (url: string, filter: Filter): Promise<RoomReqResult> => {
    let sawEose = false
    let sawClosed = false
    let sawDisconnect = false
    const seen = new Map<string, TrustedEvent>()
    try {
        await request({
            relays: [url],
            autoClose: true,
            signal: AbortSignal.timeout(ROOM_RECONCILE_TIMEOUT_MS),
            filters: [filter],
            onEvent: (event: TrustedEvent) => {
                seen.set(event.id, event)
            },
            onEose: () => {
                sawEose = true
            },
            onClosed: () => {
                sawClosed = true
            },
            onDisconnect: () => {
                sawDisconnect = true
            },
        })
    } catch {
        // `AbortSignal.timeout` lässt `request` regulär auflösen; hier landet nur, was
        // der Adapter selbst wirft. Ein Wurf ist keine Antwort → nichts ableiten.
        sawDisconnect = true
    }
    const rooms = Array.from(seen.values()).filter((event) => event.kind === ROOM_META)
    return {
        // NACH dem REQ gelesen, nicht davor: `AuthStatus.Ok` entsteht erst mit dem
        // `OK true` des Relays auf unser kind 22242, und welshmans Auth-Puffer hält
        // den REQ genau so lange zurück. Vorher gefragt stünde hier bei jedem
        // Kaltstart `None`, und der Abgleich liefe nie.
        //
        // `has()` vor `get()`, weil `Pool.get(url)` einen Socket ANLEGT, wenn keiner
        // da ist (`pool.js`) — nach einem REQ ist er da, aber eine Messung darf keine
        // Verbindung erzeugen.
        relayAuthenticated: relayHasAuthenticatedUs(url),
        sawEose,
        sawClosed,
        sawDisconnect,
        roomCount: rooms.length,
        rooms,
    }
}

/**
 * Hat der Relay unsere Identität für die laufende Verbindung bestätigt (NIP-42)?
 *
 * Die Begründung, warum das eine Vorbedingung der ganzen Ableitung ist — samt der
 * Draht-Messung an beiden Relays — steht bei `roomReconcile.ts RoomAnswerVerdict`.
 * Hier steht nur, WO die Antwort herkommt: `AuthState.status` wird auf `Ok` gesetzt,
 * sobald der Relay das signierte kind 22242 mit `OK true` quittiert
 * (`@welshman/net auth.js`), und beim Verbindungsverlust wieder auf `None`.
 */
const relayHasAuthenticatedUs = (url: string): boolean => {
    const pool = Pool.get()
    return pool.has(url) && pool.get(url).auth.status === AuthStatus.Ok
}

/**
 * Gleicht die lokal bekannten Räume eines Space gegen den Relay-Bestand ab und
 * entfernt, was der Relay nachweislich nicht mehr führt.
 *
 * Zwei Stufen — breite Abfrage schlägt vor, Einzelprobe entscheidet; die vollständige
 * Begründung samt Messung steht im Kopf von `roomReconcile.ts` und gehört dorthin,
 * weil sie ohne welshman testbar ist.
 *
 * Aufgeräumt wird in beiden Schichten: `repository.removeEvent` entfernt das Ereignis
 * aus dem Speicher UND meldet es über den `update`-Event als `removed` —
 * `storage.ts syncEvents` löscht es daraufhin aus der IndexedDB. Ohne den zweiten
 * Teil wäre der Raum beim nächsten Kaltstart wieder da.
 */
export const reconcileSpaceRooms = async (url: string): Promise<RoomAnswerVerdict | 'skipped'> => {
    const doneAt = roomReconcileDoneAt.get(url)
    if (roomReconcileInFlight.has(url) || (doneAt !== undefined && Date.now() - doneAt < ROOM_RECONCILE_COOLDOWN_MS)) {
        return 'skipped'
    }
    roomReconcileInFlight.add(url)
    try {
        return await runRoomReconcile(url)
    } finally {
        roomReconcileInFlight.delete(url)
    }
}

const runRoomReconcile = async (url: string): Promise<RoomAnswerVerdict | 'skipped'> => {
    // ── Erst hydrieren, dann fragen ──────────────────────────────────────────────
    //
    // DIE Zeile, an der der Reload-Pfad hing. `watchSpaceRooms` läuft beim Einhängen
    // der Insel; `storage.ts initStorage` spiegelt den IndexedDB-Cache aber ASYNCHRON
    // in das repository. Wer den Bestands-Schnappschuss synchron zieht, sieht nach
    // einem Reload ein leeres repository — der Geisterraum existiert dort nur im
    // Cache, steht damit nicht im Schnappschuss und kann nicht in die Kandidatenliste
    // geraten. Gemessen (buzz-test, 2026-08-19): nach Reload Kachel=1/Cache=vorhanden
    // über 30 s; erst nach einem Einhängen OHNE Reload Kachel=0/Cache=leer.
    //
    // Das Warten kostet nichts, was der Schnappschuss vorher gewonnen hätte: er soll
    // nur vor NEU eintreffenden Ereignissen schützen (siehe unten), und die kommen
    // ohnehin erst mit dem REQ.
    const cacheHydrated = await awaitCacheHydration()
    if (!cacheHydrated) {
        // Ohne hydrierten Cache ist die lokale Seite des Vergleichs unbekannt. Ein Lauf
        // ohne Vergleichsbasis soll gar nicht erst laufen — und vor allem nicht sperren.
        return 'skipped'
    }

    // Der Bestand wird VOR der Frage festgehalten, nicht danach. Sonst gäbe es ein
    // Rennen mit genau der falschen Fehlerrichtung: ein Raum, der zwischen EOSE und
    // Auswertung neu eintrifft (fremdes 9007+9002 über die Live-Sub), stünde im
    // Bestand, aber nicht in der Antwort — und wäre sofort wieder gelöscht, ohne
    // dass ihn je wieder etwas nachliefert.
    const knownBefore = repository
        .query([{ kinds: [ROOM_META] }])
        .map((event: TrustedEvent) => ({ id: event.id, h: getTagValue('d', event.tags) || '' }))

    // ── Stufe 1: breite Abfrage ─────────────────────────────────────────────────
    // NUR 39000. Die 9008 der Live-Sub interessieren hier nicht — sie bedienen den
    // Grabstein-Weg in `roomsByUrl` und blähten diese Antwort nur auf. Auf zooid
    // überleben sie dauerhaft, dort wäre die Zählung sonst über Jahre von Altlasten
    // dominiert statt von Räumen.
    const scan = await requestRooms(url, { kinds: [ROOM_META], limit: ROOM_RECONCILE_LIMIT })
    const verdict = classifyRoomAnswer(scan)

    const presentHs = new Set<string>()
    for (const event of scan.rooms) {
        const h = getTagValue('d', event.tags)
        if (h) {
            presentHs.add(h)
        }
    }

    // Die Herkunft wird JETZT gelesen, nicht beim Schnappschuss: der Abgleich-REQ
    // selbst hat gerade Herkunftszeilen ergänzt, und je mehr Relays für ein
    // Ereignis bekannt sind, desto eher schützt der Herkunfts-Riegel es.
    const known: KnownRoomEvent[] = knownBefore.map((room) => ({
        ...room,
        relays: Array.from(tracker.getRelays(room.id)),
    }))
    const candidates = selectReconcileCandidates(url, known, presentHs, verdict)
    const credible = candidatesAreCredible(candidates)

    // ── Stufe 2: Einzelprobe je Kandidat ────────────────────────────────────────
    // Eine Abfrage der Kardinalität 1 (`#d` auf ein parameterisiert-ersetzbares Kind)
    // kann nicht gekappt sein — das ist der Grund, warum hier entschieden wird und
    // nicht oben. Parallel, weil Kandidaten selten und dann meist einer sind.
    //
    // ── Warum `#d` und NICHT `#h` — und was dieser Weg dafür einhandelt ─────────
    //
    // `#h` wäre die naheliegende Adressierung und ist trotzdem falsch: Buzz
    // beantwortet ein `#h`-REQ auf einen gelöschten ODER unzugänglichen Kanal mit
    // `CLOSED restricted: not a channel member` (gemessene Tabelle in `roomGate.ts`).
    // Für diese Stufe ist ein CLOSED eine Nicht-Antwort — der Abgleich bestätigte
    // dann NIE einen gelöschten Raum, und der Mechanismus wäre wirkungslos. `#d`
    // erzeugt stattdessen sauberes `EOSE` mit null Zeilen (am Relay gemessen,
    // 2026-08-19, :3004), also genau die Auskunft, die hier gebraucht wird.
    //
    // **Der Preis, und er ist nicht theoretisch:** Buzz repariert einen falschen
    // Negativbefund seines 10-s-Zugriffscaches nur auf dem `#h`-Pfad.
    // `resolve_request_local_access` (`buzz-relay/src/handlers/req.rs:130-170`) läuft
    // in einem `if let Some(ch_id) = channel_id`, und `channel_id` stammt aus
    // `extract_channel_id_from_filters` (`:1029-1049`), das ausschließlich auf `h`
    // matcht. Beide Stufen hier sind `#h`-frei und sehen deshalb nur den
    // (möglicherweise veralteten) Vektor aus `get_accessible_channel_ids_cached`.
    //
    // Auf einem Multi-Pod-Buzz kann ein FRISCH AUFGENOMMENES Mitglied damit einen
    // Raum verlieren, den es hat: der Pod, der den Beitritt schrieb, ist nicht der,
    // der liest, und bis zum TTL-Ablauf fehlt der Kanal in beiden Stufen. Das ist die
    // eine Lage, in der die Einzelprobe strukturell irrt — sie ist eng (≤10 s
    // Cache-TTL, gegen 60 s Sperre) und heilt sich selbst: der nächste Abgleich
    // findet den Raum wieder, und die Live-Sub liefert das 39000 ohnehin neu. Wer sie
    // schließen will, braucht eine dritte Stufe (z. B. ein `#h`-REQ als Gegenprobe,
    // dessen CLOSED dann als „doch da" zu lesen wäre) — bewusst nicht gebaut: sie
    // machte den häufigen Fall langsamer, um einen Fall zu decken, der von selbst
    // vergeht.
    let probes: RoomAnswerSignals[] = []
    if (credible && candidates.length > 0) {
        probes = await Promise.all(
            candidates.map((room) => requestRooms(url, { kinds: [ROOM_META], '#d': [room.h], limit: 1 })),
        )
        candidates.forEach((room, i) => {
            if (confirmsRoomGone(probes[i])) {
                repository.removeEvent(room.id)
            }
        })
    }

    if (
        shouldArmReconcileLock({
            verdict,
            cacheHydrated,
            knownCount: known.length,
            candidatesCredible: credible,
            // Ohne diese Zeile sperrte auch ein Lauf, dessen Einzelprobe in CLOSED
            // oder Timeout lief — dieselbe Form wie der behobene Reload-Defekt, nur
            // eine Stufe tiefer (Begründung bei `probesAreConclusive`).
            probesConclusive: probesAreConclusive(probes),
        })
    ) {
        roomReconcileDoneAt.set(url, Date.now())
    }
    return verdict
}

/**
 * Live-Sub für Mitglieder-Änderungen (39002) — auf zooid reflektiert das Join/Leave sofort.
 *
 * **Auf Buzz reicht sie NICHT**, und das ist keine Latenzfrage: Buzz speichert die
 * Gruppen-Events kanal-gescopt und schickt sie deshalb gar nicht über den globalen
 * Fan-out (`NOSTR.md:124`: „live global subscriptions won't receive these via fan-out.
 * Clients discover groups via historical REQ queries"). Am Test-Relay nachgemessen
 * (2026-07-29): nach einem angenommenen 9021 kam über `{kinds:[39002], limit:0}` in
 * 19 s **kein einziges Event**, während ein historisches REQ die aktualisierte Liste
 * (mit dem neuen Pubkey) sofort lieferte und `channel_members` die Zeile führte. Wer
 * hier auf die Live-Sub wartet, wartet auf etwas, das nie kommt — daher
 * {@link reloadRoomMembership} nach dem Join.
 */
export const listenRoomMembers = (url: string, signal: AbortSignal): void => {
    void request({ relays: [url], signal, filters: [{ kinds: [ROOM_MEMBERS], limit: 0 }] })
}

/**
 * Anzahl der Nachlade-Versuche und Abstand für {@link reloadRoomMembership}.
 *
 * Ein einzelnes REQ direkt nach dem `OK` ist zu ungeduldig — gemessen: das erste REQ
 * unmittelbar nach dem 9021 lieferte noch die ALTE Liste, wenige hundert Millisekunden
 * später die neue. Das `OK` quittiert die Annahme des Join-Requests, nicht die
 * Neuausstellung der relay-signierten 39002.
 */
const MEMBERSHIP_RELOAD_ATTEMPTS = 8
const MEMBERSHIP_RELOAD_DELAY_MS = 400

/**
 * Lädt die relay-signierte Mitgliederliste EINES Raums nach, bis `pubkey` den
 * erwarteten Zustand hat (oder das Budget aufgebraucht ist). Liefert `true`, wenn
 * der Zustand bestätigt ist.
 *
 * `expectMember` schaltet die Richtung: `true` nach einem Beitritt (warten, bis der
 * Pubkey DRINSTEHT), `false` nach einem Austritt (warten, bis er WEG ist). Beide
 * Wege brauchen es, weil Buzz die aktualisierte 39002 in keinem der beiden Fälle
 * über den Fan-out schickt.
 *
 * **Bewusst OHNE Relay-Weiche.** Auf zooid ist das ein billiges Zusatz-REQ, das nichts
 * ändert — die Live-Sub ist dort ohnehin meist schneller, der erste Versuch bestätigt
 * dann sofort. Eine Weiche wäre hier Komplexität ohne Gegenwert.
 *
 * **Kein optimistisches Umschalten.** Die Mitgliedschaft bleibt relay-autoritativ (siehe
 * Modulkopf) — hier wird nur GELESEN, und zwar genau das Event, auf das die Ableitung
 * ohnehin hört. Der `#d`-Filter ist bei beiden Relays SQL-seitig auflösbar (39002 ist
 * parameterisiert-ersetzbar), das Nachladen kostet also einen indizierten Zugriff.
 */
export const reloadRoomMembership = async (
    url: string,
    h: string,
    pubkey: string,
    expectMember = true,
): Promise<boolean> => {
    for (let attempt = 0; attempt < MEMBERSHIP_RELOAD_ATTEMPTS; attempt++) {
        const events = await load({ relays: [url], filters: [{ kinds: [ROOM_MEMBERS], '#d': [h] }] })
        const listed = events.some((e) => e.tags.some((t) => t[0] === 'p' && t[1] === pubkey))
        // Frisch vom Relay gelesen — also die einzige Sorte Liste, die eine
        // Entzugs-Marke aufheben darf (P9, siehe `roomMembership.ts`). Ohne diesen
        // Aufruf käme nach einem Wiederbeitritt kein Composer zurück.
        confirmRoomMembership(url, h, events as TrustedEvent[], pubkey)
        if (listed === expectMember) {
            return true
        }
        await new Promise((resolve) => setTimeout(resolve, MEMBERSHIP_RELOAD_DELAY_MS))
    }
    return false
}

// ── P9: Nachführung bei FREMDVERURSACHTEN Mitgliedschaftsänderungen ──────────

/**
 * Hebt aus einer Menge frisch geladener Events die jüngste 39002 eines Raums und
 * beantwortet damit die einzige Frage, die die Marke aufheben kann: „welche Liste,
 * und stehe ich drin?". `null` = für diesen Raum kam nichts — und genau das ist
 * die Antwort des Relays nach einem Rauswurf aus einem privaten Raum.
 */
const readMembership = (events: TrustedEvent[], h: string, pk: string): RoomMembershipRead | null => {
    let newest: TrustedEvent | undefined
    for (const event of events) {
        if (event.kind !== ROOM_MEMBERS || getTagValue('d', event.tags) !== h) {
            continue
        }
        if (!newest || newest.created_at < event.created_at) {
            newest = event
        }
    }
    if (!newest) {
        return null
    }

    // `created_at` gehört dazu, seit die Marke die ORDNUNG prüft (N3) — eine
    // andere Id allein beweist nicht, dass die Liste auch die neuere ist.
    return {
        listEventId: newest.id,
        listsMe: getTagValues('p', newest.tags).includes(pk),
        createdAt: newest.created_at,
    }
}

/**
 * Legt eine frisch vom Relay gelesene Liste vor. Bestätigt sie die Mitgliedschaft,
 * fällt die Entzugs-Marke; sonst bleibt sie stehen. Fasst nichts an, wo keine
 * Marke steht.
 */
const confirmRoomMembership = (url: string, h: string, events: TrustedEvent[], pk?: string): void => {
    const me = pk ?? pubkey.get()
    if (!me) {
        return
    }
    roomMembershipRevocations.confirm(
        roomMembershipKey(normalizeRelayUrl(url), h),
        readMembership(events, h, me),
    )
}

/**
 * Dasselbe für einen Space-weiten Lesevorgang ({@link loadSpaceRooms}): jede
 * gelieferte 39002 wird ihrem Raum vorgelegt. Räume, für die nichts kam, bleiben
 * unangetastet — Schweigen ist kein Mitgliedschaftsbeweis.
 */
const confirmRoomMembershipFromSpaceRead = (url: string, events: TrustedEvent[]): void => {
    const me = pubkey.get()
    if (!me) {
        return
    }
    for (const event of events) {
        if (event.kind !== ROOM_MEMBERS) {
            continue
        }
        const h = getTagValue('d', event.tags)
        if (h) {
            confirmRoomMembership(url, h, events, me)
        }
    }
}

/**
 * Der Relay hat den Zugriff auf einen Raum entzogen oder verweigert — die eigene
 * Mitgliedschaft gilt ab sofort als **unbestätigt** und wird aktiv neu erfragt.
 *
 * Das ist die Nachführung, die P9 gefehlt hat: Ein Fremd-Rauswurf (kind 9001)
 * erzeugt am Draht **genau ein** Signal an den Betroffenen — das `CLOSED
 * restricted: channel access revoked` auf seine laufende Raum-Sub (gemessen
 * 2026-08-17 am Buzz-Teststack: 11 ms nach dem 9001 im offenen, 61 ms im privaten
 * Raum). Eine aktualisierte 39002 kommt über die Live-Sub **nie**.
 *
 * Die Marke fällt SOFORT (synchron), das Nachladen läuft danach:
 *  - **offener Raum** — das REQ liefert +202 ms die neue Liste ohne den eigenen
 *    Pubkey; die Marke wird dadurch nicht aufgehoben (sie listet uns nicht), und
 *    die Daten sagen ohnehin dasselbe. Ein Wiederbeitritt hebt sie auf.
 *  - **privater Raum** — das REQ liefert `EOSE` und **0 Events** (sechs Versuche
 *    über 13,7 s gemessen). Ohne die Marke bliebe die alte Liste die einzige
 *    Aussage, und die behauptet die Mitgliedschaft weiter. Genau hier saß der
 *    stehengebliebene Composer.
 *
 * Aufgerufen wird das bei JEDEM `restricted:`-CLOSED der Raum-Sub, nicht nur beim
 * Entzugs-Grund: „kein Zugriff" ist über die Mitgliedschaft dieselbe Aussage wie
 * „Zugriff entzogen" — wir können sie nicht mehr belegen. Die sichere Annahme ist
 * „kein Mitglied"; ein Composer, dessen Absenden am Relay scheitert, ist schlechter
 * als ein fehlender Composer.
 */
export const revokeRoomMembership = async (url: string, h: string): Promise<void> => {
    const normalized = normalizeRelayUrl(url)
    const stale = get(roomMembersEventByUrl).get(normalized)?.get(h)
    roomMembershipRevocations.revoke(roomMembershipKey(normalized, h), stale?.id ?? '', stale?.created_at ?? 0)
    const pk = pubkey.get()
    if (!pk) {
        return
    }
    const events = await load({ relays: [url], filters: [{ kinds: [ROOM_MEMBERS], '#d': [h] }] })
    confirmRoomMembership(url, h, events as TrustedEvent[], pk)
}

// ── Beitreten / Verlassen (NIP-29, relay-seitig) ─────────────────────────────

/**
 * Tritt einem Raum bei: Join-Request (kind 9021) ans Space-Relay. Offene Räume
 * genehmigt zooid automatisch und trägt den User in die relay-signierte
 * Members-Liste (39002) ein — die Mitgliedschaft ist damit **relay-autoritativ
 * und übersteht Reloads**. Kein optimistischer Fake; `deriveUserInRoom` flippt,
 * sobald die aktualisierte 39002 (via Live-Sub) eintrifft. '' = Erfolg.
 */
export const joinRoom = (url: string, h: string): Promise<string> =>
    waitForPublishError(publishThunk({ relays: [url], event: makeEvent(ROOM_JOIN, { tags: [['h', h]] }) }))

/** Verlässt einen Raum: Leave-Request (kind 9022) → Relay entfernt aus der 39002. */
export const leaveRoom = (url: string, h: string): Promise<string> =>
    waitForPublishError(publishThunk({ relays: [url], event: makeEvent(ROOM_LEAVE, { tags: [['h', h]] }) }))

// ── Raum-Verwaltung (Admin, NIP-29 9007/9002/9008 → relay-signierte 39000) ───
// Nur `can_manage`-Admins dürfen diese Moderations-Events schreiben; der Relay
// verarbeitet sie in `OnEventSaved` zum relay-signierten 39000 (bzw. Tombstone).

export type RoomInput = {
    h: string
    name: string
    about: string
    picture: string
    isPrivate: boolean
    isClosed: boolean
    isHidden: boolean
    isRestricted: boolean
    /**
     * Zusatz-Tags fuers 9002, die welshmans `makeRoomEditEvent` nicht kennt —
     * z. B. Kategorie-Marker beim ANLEGEN (`projectSupportTags(id)` aus
     * `roomCategories.ts`). Beim Edit braucht man sie nicht: dort kopiert
     * `makeRoomEditEvent` die Tags des vorhandenen 39000 ohnehin mit.
     * Weggelassen → das Event ist byte-gleich zu vorher.
     */
    extraTags?: string[][]
}

/**
 * Baut das 9002-Meta-Event via welshmans `makeRoomEditEvent`. Entscheidend beim
 * Bearbeiten: zooid ersetzt das 39000 KOMPLETT aus den 9002-Tags → makeRoomEditEvent
 * kopiert die bestehenden Tags des vorhandenen 39000 (`pictureMeta`, fremde/relay-
 * gesetzte) mit, sonst gingen sie bei jeder Änderung verloren. Beim Anlegen (kein
 * `existing`) baut es das Event allein aus dem Input.
 *
 * `input.extraTags` werden DANACH angehaengt (`withExtraTags`) — `makeRoomEditEvent`
 * selbst bleibt unangetastet. Der Tag-Erhalt laeuft davor und unveraendert ab; die
 * Anhaenge-Stufe dedupliziert auf Name+Wert, ein beim Edit mitkopierter Marker wird
 * also nicht verdoppelt. Ohne `extraTags` gibt `withExtraTags` dasselbe Event
 * unveraendert zurueck.
 */
const roomMetaEvent = (url: string, input: RoomInput) => {
    const existing = get(roomsById).get(makeRoomId(url, input.h))
    return withExtraTags(
        makeRoomEditEvent({ ...input, pictureMeta: existing?.pictureMeta, event: existing?.event }),
        input.extraTags,
    )
}

/** „bereits vorhanden"-Antworten des Relays (idempotenter Retry über gleiches `h`). */
const isAlreadyError = (err: string): boolean => /already|duplicate/i.test(err)

/**
 * Vergibt die Raum-ID (`h`) — **immer eine UUIDv4**, auf beiden Relay-Arten.
 *
 * zooid ist die ID egal (opaker String, welshmans `randomId()` reichte). **Buzz
 * übernimmt ein mitgeschicktes `h` nur, wenn es als UUID parst** — dann legt es den
 * Kanal unter genau dieser ID an (`ingest.rs:2132 create_channel_with_id`). Parst es
 * nicht, fällt der Wert still weg und das Relay mintet eine eigene UUID; die
 * nachfolgenden 9002/9021 zeigten dann auf einen Raum, den es nicht gibt — Raum ohne
 * Namen, Ersteller nicht drin, keine Fehlermeldung. Am laufenden Buzz gemessen:
 * `h=k3f9x2m7q1` → Kanal `ea57c807-…`; `h=11111111-2222-4333-8444-555555555555` →
 * Kanal exakt so.
 *
 * Eine UUID ist auch für zooid ein gültiges `h`, deshalb EIN Pfad statt einer Weiche.
 */
export const newRoomId = (): string => crypto.randomUUID()

/**
 * Tags des 9007 auf **Buzz**. Anders als bei zooid trägt das Create-Event dort die
 * Metadaten schon selbst — und `name` ist PFLICHT: ein 9007 mit nur `h` beantwortet
 * Buzz mit `invalid: channel name is required` (`ingest.rs:2085-2097`, am laufenden
 * Relay gegengeprüft). Die NIP-29-Flag-Tags (`["private"]`) kennt Buzz hier nicht, es
 * will `["visibility","private"|"open"]` (`buzz-sdk/src/builders.rs:674-699`).
 */
const buzzCreateTags = (h: string, input: RoomInput): string[][] => {
    const tags = [['h', h], ['name', input.name], ['visibility', input.isPrivate ? 'private' : 'open']]
    if (input.about) {
        tags.push(['about', input.about])
    }
    return tags
}

/**
 * Legt einen neuen Raum an. `h` MUSS vom Aufrufer stabil vergeben sein
 * (openRoomCreate mintet es einmalig) — so vervollständigt ein Retry nach partiellem
 * Fehler denselben Raum, statt einen zweiten Waisen anzulegen. „already/duplicate"
 * wird daher toleriert. '' = Erfolg.
 *
 * **zooid:** 9007 (Create, nur `h`) → 9002 (Metadaten) → 9021 (der Ersteller tritt
 * bei und erscheint in „Meine Räume").
 *
 * **Buzz:** 9007 trägt Name/Sichtbarkeit/Beschreibung selbst (s. `buzzCreateTags`) →
 * 9002 für den Rest. **Kein 9021** — der Ersteller steht nach dem 9007 bereits als
 * `owner` in der 39002 (`ingest.rs:1806`, gemessen). Schlimmer als überflüssig wäre
 * es: auf einem privaten Raum antwortet Buzz dem Beitritt mit
 * `restricted: channel is private` (`ingest.rs:2189`) — das Anlegen meldete einen
 * Fehler, obwohl der Raum fertig dasteht.
 */
export const createRoom = async (url: string, input: RoomInput): Promise<string> => {
    const h = input.h || newRoomId()
    const isBuzz = await spaceIsBuzzAsync(url)
    const createTags = isBuzz ? buzzCreateTags(h, input) : [['h', h]]
    const createErr = await waitForPublishError(publishThunk({ relays: [url], event: makeEvent(ROOM_CREATE, { tags: createTags }) }))
    if (createErr && !isAlreadyError(createErr)) {
        return createErr
    }
    const metaErr = await waitForPublishError(publishThunk({ relays: [url], event: roomMetaEvent(url, { ...input, h }) }))
    if (metaErr) {
        return metaErr
    }
    if (isBuzz) {
        // Nachladen, sonst bleibt der frische Raum unsichtbar: Buzz schiebt die
        // relay-signierte 39000 NICHT in die offene Live-Sub. Gemessen — der Raum lag
        // sofort am Relay und stand nach dem Anlegen 16 s lang nicht in der Liste,
        // erschien aber nach einem Reload sofort unter „Meine Räume". Ein zweiter REQ
        // holt ihn ohne Reload. zooid braucht das nicht, dort kommt er über die Sub.
        await loadSpaceRooms(url)
        return ''
    }
    const joinErr = await joinRoom(url, h)
    return joinErr && !isAlreadyError(joinErr) ? joinErr : ''
}

/**
 * Ändert die Raum-Metadaten (kind 9002, bestehende 39000-Tags werden bewahrt).
 *
 * Auf **Buzz** danach nachladen, aus demselben Grund wie beim Anlegen: die neu
 * signierte 39000 kommt nicht über die offene Live-Sub. Gemessen — der umbenannte
 * Raum trug in der Liste 25 s lang weiter den ALTEN Namen, obwohl das 9002 am Relay
 * lag. „Bearbeiten" ist auf einem Buzz-Space der einzige verbliebene Menüpunkt der
 * Kachel (Mitglieder/Löschen sind gegatet) — ohne das Nachladen wirkte er wirkungslos.
 */
export const editRoomMeta = async (url: string, input: RoomInput): Promise<string> => {
    const err = await waitForPublishError(publishThunk({ relays: [url], event: roomMetaEvent(url, input) }))
    if (err) {
        return err
    }
    if (await spaceIsBuzzAsync(url)) {
        await loadSpaceRooms(url)
    }
    return ''
}

/** Löscht einen Raum (kind 9008 → 39000-Tombstone, roomsByUrl blendet ihn aus). */
export const deleteRoom = (url: string, h: string): Promise<string> =>
    waitForPublishError(publishThunk({ relays: [url], event: makeEvent(ROOM_DELETE, { tags: [['h', h]] }) }))

// ── Raum-Mitglieder (Admin, NIP-29 9000/9001 → relay-signierte 39002) ────────

/** Fügt einen Pubkey der Raum-Mitgliederliste hinzu (kind 9000 put-user → 39002).
 *  Setzt Space-Mitgliedschaft (allowpubkey) voraus — der Aufrufer stellt das sicher. */
export const addRoomMember = (url: string, h: string, pubkey: string): Promise<string> =>
    waitForPublishError(publishThunk({ relays: [url], event: makeEvent(ROOM_ADD_MEMBER, { tags: [['h', h], ['p', pubkey]] }) }))

/** Entfernt einen Pubkey aus der Raum-Mitgliederliste (kind 9001 remove-user → 39002). */
export const removeRoomMember = (url: string, h: string, pubkey: string): Promise<string> =>
    waitForPublishError(publishThunk({ relays: [url], event: makeEvent(ROOM_REMOVE_MEMBER, { tags: [['h', h], ['p', pubkey]] }) }))

// ── Space beitreten/verlassen (Space-Ebene, NIP-29 kind 28934/28936) ─────────

/** Fügt den Space der persönlichen 10009-Liste hinzu (`["r", url]`, nip44-self). */
const addSpaceToList = async (url: string): Promise<void> => {
    const list = get(userGroupList) ?? makeList({ kind: ROOMS })
    const event = await addToListPublicly(list, ['r', url]).reconcile(nip44EncryptToSelf)
    const relays = uniq([...Router.get().FromUser().getUrls(), ...getRelayTagValues(event.tags)])
    await waitForPublishError(publishThunk({ event, relays }))
}

/** Entfernt den Space aus der 10009-Liste (`r`- oder `group`-Tag). */
const removeSpaceFromList = async (url: string): Promise<void> => {
    const list = get(userGroupList)
    if (!list) {
        return
    }
    const pred = (t: string[]) => normalizeRelayUrl(t[t[0] === 'r' ? 1 : 2] ?? '') === url
    const event = await removeFromListByPredicate(list, pred).reconcile(nip44EncryptToSelf)
    const relays = uniq([url, ...Router.get().FromUser().getUrls(), ...getRelayTagValues(event.tags)])
    await waitForPublishError(publishThunk({ event, relays }))
}

/**
 * Tritt einem Space bei: Join-Request (kind 28934, optionaler Invite-`claim`) ans
 * Space-Relay + Aufnahme in die persönliche 10009-Liste (damit der Space in der
 * Auswahl auftaucht). AUTH läuft automatisch über die Socket-Policy. '' = Erfolg.
 */
export const joinSpace = async (url: string, claim = ''): Promise<string> => {
    const tags = claim ? [['claim', claim]] : []
    const err = await waitForPublishError(publishThunk({ relays: [url], event: makeEvent(RELAY_JOIN, { tags }) }))
    if (err) {
        return err
    }
    await addSpaceToList(url)
    return ''
}

/** Verlässt einen Space: aus der 10009 entfernen + Leave-Request (kind 28936). */
export const leaveSpace = async (url: string): Promise<string> => {
    await removeSpaceFromList(url)
    return waitForPublishError(publishThunk({ relays: [url], event: makeEvent(RELAY_LEAVE) }))
}

/** Ist der Space in der persönlichen 10009-Liste (reaktiv)? */
export const deriveUserInSpace = (url: string): Readable<boolean> =>
    derived(userSpaceUrls, ($urls) => $urls.includes(normalizeRelayUrl(url)))

// ── Invites (kind 28935 RELAY_INVITE / Link `?r=&c=`) ────────────────────────

export type InviteData = { url: string; claim: string }

/** Parst einen Invite-Link `…/join?r=<relay>&c=<claim>` (Fallback: reine URL). */
export const parseInviteLink = (invite: string): InviteData | undefined => {
    try {
        const params = new URL(invite).searchParams
        const url = normalizeRelayUrl(params.get('r') ?? '')
        if (isRelayUrl(url)) {
            return { url, claim: params.get('c') ?? '' }
        }
    } catch {
        // kein URL — als reine Relay-URL versuchen
    }
    const url = normalizeRelayUrl(invite)
    return isRelayUrl(url) ? { url, claim: '' } : undefined
}

/** Holt den Invite-Claim (kind 28935 `["claim", …]`) vom Space-Relay ('' = keiner). */
export const loadSpaceInviteClaim = async (url: string): Promise<string> => {
    const events = (await load({ relays: [url], filters: [{ kinds: [RELAY_INVITE] }] })) as TrustedEvent[]
    return getTagValue('claim', events[0]?.tags ?? []) ?? ''
}
