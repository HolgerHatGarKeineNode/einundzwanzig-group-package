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
    waitForThunkError,
    nip44EncryptToSelf,
    relaysByUrl,
    loadRelay,
} from '@welshman/app'
import { deriveItemsByKey, deriveEventsByIdByUrl, sync, localStorageProvider } from '@welshman/store'
import { Router } from '@welshman/router'
import { load, request } from '@welshman/net'
import {
    ROOMS,
    ROOM_META,
    ROOM_DELETE,
    ROOM_MEMBERS,
    ROOM_JOIN,
    ROOM_LEAVE,
    RELAY_JOIN,
    RELAY_LEAVE,
    RELAY_INVITE,
    readList,
    readRoomMeta,
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
import { spaceSupportsRooms } from './relayCaps'

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

export type RoomView = { h: string; name: string }
export type SpaceView = {
    url: string
    label: string
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

    const toView = (hs: string[]) => sortBy(nameOf, uniq(hs)).map((h) => ({ h, name: nameOf(h) }))

    return { url, label: displayRelayUrl(url), userRooms: toView(joined), otherRooms: toView(other) }
}

/**
 * Ein einziger reaktiver Snapshot aller Spaces des Users mit ihren beigetretenen
 * und entdeckbaren Räumen — die Grundlage der Space-Auswahl in den Einstellungen.
 */
export const userSpacesView: Readable<SpaceView[]> = derived(
    [userSpaceUrls, roomsByUrl, roomsById, roomMembersByUrl, pubkey],
    ([$urls, $byUrl, $byId, $members, $pk]) =>
        $urls.map((url) => buildSpaceView(url, $byUrl, $byId, $members.get(url) ?? new Map(), $pk)),
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
export const activeSpaceUrl = writable<string | null>(null)
export const activeSpaceReady = sync({
    key: 'activeSpaceUrl',
    store: activeSpaceUrl,
    storage: localStorageProvider,
})

/** Setzt den aktiven Space (aus der Einstellungsseite). */
export const setActiveSpace = (url: string): void => activeSpaceUrl.set(url)

/** Die effektive aktive Space-URL: die gewählte oder — Default — die fixierte. */
export const activeSpace: Readable<string> = derived(activeSpaceUrl, ($active) =>
    normalizeRelayUrl($active ?? DEFAULT_SPACE_URL),
)

/**
 * Der aktive Space als fertige UI-Sicht — für JEDE URL, auch wenn der User dem
 * Space (noch) nicht beigetreten ist. Rooms streamen nach dem 39000-Load ein.
 */
export const activeSpaceView: Readable<SpaceView> = derived(
    [activeSpace, roomsByUrl, roomsById, roomMembersByUrl, pubkey],
    ([$active, $byUrl, $byId, $members, $pk]) =>
        buildSpaceView($active, $byUrl, $byId, $members.get($active) ?? new Map(), $pk),
)

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

/** Live-Sub für Mitglieder-Änderungen (39002) — Join/Leave reflektiert sofort. */
export const listenRoomMembers = (url: string, signal: AbortSignal): void => {
    void request({ relays: [url], signal, filters: [{ kinds: [ROOM_MEMBERS], limit: 0 }] })
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
    waitForThunkError(publishThunk({ relays: [url], event: makeEvent(ROOM_JOIN, { tags: [['h', h]] }) }))

/** Verlässt einen Raum: Leave-Request (kind 9022) → Relay entfernt aus der 39002. */
export const leaveRoom = (url: string, h: string): Promise<string> =>
    waitForThunkError(publishThunk({ relays: [url], event: makeEvent(ROOM_LEAVE, { tags: [['h', h]] }) }))

// ── Space beitreten/verlassen (Space-Ebene, NIP-29 kind 28934/28936) ─────────

/** Fügt den Space der persönlichen 10009-Liste hinzu (`["r", url]`, nip44-self). */
const addSpaceToList = async (url: string): Promise<void> => {
    const list = get(userGroupList) ?? makeList({ kind: ROOMS })
    const event = await addToListPublicly(list, ['r', url]).reconcile(nip44EncryptToSelf)
    const relays = uniq([...Router.get().FromUser().getUrls(), ...getRelayTagValues(event.tags)])
    await waitForThunkError(publishThunk({ event, relays }))
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
    await waitForThunkError(publishThunk({ event, relays }))
}

/**
 * Tritt einem Space bei: Join-Request (kind 28934, optionaler Invite-`claim`) ans
 * Space-Relay + Aufnahme in die persönliche 10009-Liste (damit der Space in der
 * Auswahl auftaucht). AUTH läuft automatisch über die Socket-Policy. '' = Erfolg.
 */
export const joinSpace = async (url: string, claim = ''): Promise<string> => {
    const tags = claim ? [['claim', claim]] : []
    const err = await waitForThunkError(publishThunk({ relays: [url], event: makeEvent(RELAY_JOIN, { tags }) }))
    if (err) {
        return err
    }
    await addSpaceToList(url)
    return ''
}

/** Verlässt einen Space: aus der 10009 entfernen + Leave-Request (kind 28936). */
export const leaveSpace = async (url: string): Promise<string> => {
    await removeSpaceFromList(url)
    return waitForThunkError(publishThunk({ relays: [url], event: makeEvent(RELAY_LEAVE) }))
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
