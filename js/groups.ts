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
import { derived, writable, get, type Readable } from 'svelte/store'
import {
    repository,
    tracker,
    pubkey,
    makeUserData,
    makeOutboxLoader,
    publishThunk,
    nip44EncryptToSelf,
    relaysByUrl,
    loadRelay,
} from '@welshman/app'
import { deriveItemsByKey, deriveEventsByIdByUrl, sync, throttled, localStorageProvider } from '@welshman/store'
import { Router } from '@welshman/router'
import { load, request } from '@welshman/net'
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
    readList,
    readRoomMeta,
    makeRoomEditEvent,
    asDecryptedEvent,
    makeEvent,
    makeList,
    addToListPublicly,
    removeFromListByPredicate,
    getListTags,
    getRelayTagValues,
    getGroupTags,
    getTagValue,
    getTagValues,
    normalizeRelayUrl,
    isRelayUrl,
    type PublishedList,
    type TrustedEvent,
} from '@welshman/util'
import { uniq, sortBy, partition } from '@welshman/lib'
import { spaceSupportsRooms, spaceBranding, BUZZ_MESSAGE_V2 } from './relayCaps'
import { spaceIsBuzzAsync } from './buzzAdmin'
import { parseMeetupTags } from './meetupPresentation'
import { parseProjectSupportTags, withExtraTags } from './roomCategories'
import type { RelayProfile } from '@welshman/util'
import { waitForPublishError } from './publishResult'

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

/** Members-Listen (39002) je Space-URL, nach Herkunfts-Relay (tracker). */
export const roomMembersEventsByIdByUrl = deriveEventsByIdByUrl({
    tracker,
    repository,
    filters: [{ kinds: [ROOM_MEMBERS] }],
})

/**
 * Mitglieder-Pubkeys je Room-`h` und Space-URL, aus der relay-signierten
 * 39002-Liste (`d`=h, `p`=Mitglieder). Das ist die **autoritative** Quelle: der
 * Relay pflegt sie bei Join (9021) / Leave (9022) und sie übersteht Reloads.
 */
export const roomMembersByUrl: Readable<Map<string, Map<string, Set<string>>>> = derived(
    roomMembersEventsByIdByUrl,
    ($byUrl) => {
        const result = new Map<string, Map<string, Set<string>>>()
        for (const [url, byId] of $byUrl) {
            const byH = new Map<string, Set<string>>()
            for (const event of byId.values()) {
                const { tags } = event as TrustedEvent
                const h = getTagValue('d', tags)
                if (h) {
                    byH.set(h, new Set(getTagValues('p', tags)))
                }
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
 * Der zweite, FESTE Space des Tabs „Workspaces" — ein Buzz-Relay neben dem
 * zooid-Space. Aus `config('group.workspace_url')` per `window.__nostrWorkspace`
 * injiziert (siehe `partials/head.blade.php`); **leer = das Feature ist aus**.
 *
 * Bewusst KEIN Store und keine Liste: es ist genau einer, konfiguriert, nicht
 * wählbar. Damit bleibt die App beim Single-Space-Fokus (§12) und bekommt nur eine
 * zweite, klar benannte Bühne daneben.
 */
const workspaceOverride = (globalThis as { __nostrWorkspace?: string }).__nostrWorkspace
export const WORKSPACE_URL = workspaceOverride ? normalizeRelayUrl(workspaceOverride) : ''

/** Ist der Workspaces-Tab konfiguriert? Steuert, ob er überhaupt im DOM erscheint. */
export const hasWorkspace = (): boolean => WORKSPACE_URL !== ''

export const activeSpaceUrl = writable<string | null>(null)
export const activeSpaceReady = sync({
    key: 'activeSpaceUrl',
    store: activeSpaceUrl,
    storage: localStorageProvider,
})

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

/** Lädt Raum-Metas (39000/9008) + Mitglieder-Listen (39002) vom Space-Relay. */
export const loadSpaceRooms = (url: string): Promise<unknown> =>
    load({ relays: [url], filters: [{ kinds: [ROOM_META, ROOM_DELETE, ROOM_MEMBERS] }] })

/**
 * Live-Sub auf die Räume (39000/9008/39002) eines Space: lädt Bestand UND bleibt
 * offen (kein CLOSE) → überlebt langsames NIP-42-AUTH auf `public_read=false`-
 * Relays (welshman replayt den gepufferten REQ nach AUTH). Ein One-Shot-`load`
 * läuft dagegen ins Timeout, sendet CLOSE und die Räume erscheinen nie. */
export const watchSpaceRooms = (url: string, signal: AbortSignal): void => {
    void request({ relays: [url], signal, filters: [{ kinds: [ROOM_META, ROOM_DELETE, ROOM_MEMBERS] }] })
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
        if (listed === expectMember) {
            return true
        }
        await new Promise((resolve) => setTimeout(resolve, MEMBERSHIP_RELOAD_DELAY_MS))
    }
    return false
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
