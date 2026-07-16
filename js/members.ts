/**
 * Space-Directory: Mitglieder + Rollen — portiert aus dem Referenz-Client
 * `src/app/members.ts`. Lese-Teil (M3) + Admin-Mutationen via `manageRelay`/
 * NIP-86 (M6): Rollen, Member-Zuweisung, Ban/Entfernen, Admin-Erkennung.
 *
 * Autoritativ ist die **relay-signierte** Mitgliederliste (13534) und die
 * Rollendefinitionen (33534, app-lokal). Beide filtert `deriveRelaySignedEvents`
 * auf `pubkey === relay.self`. Rollen-Zuweisungen stehen als Extra-Werte an den
 * `["member", pubkey, ...roleIds]`-Tags der 13534.
 */
import { derived, writable, type Readable } from 'svelte/store'
import { throttled } from '@welshman/store'
import { load, request } from '@welshman/net'
import { profilesByPubkey, loadProfile, manageRelay, pubkey, handlesByNip05 } from '@welshman/app'
import {
    RELAY_MEMBERS,
    ManagementMethod,
    getTags,
    getTagValue,
    getTagValues,
    displayProfile,
    type PublishedProfile,
} from '@welshman/util'
import { first, randomId, sortBy, uniq } from '@welshman/lib'
import * as nip19 from 'nostr-tools/nip19'
import { deriveRelaySignedEvents, deriveRelaySelfReady } from './repository'
import { isVereinRelay, roomMembersByUrl } from './groups'
import { warmHandles, verifiedNip05 } from './handles'

/** RELAY_ROLE ist app-lokal (kein welshman-Kanon) — als Konstante mitgenommen. */
export const RELAY_ROLE = 33534

// ── Rollenfarbe (HSL) ────────────────────────────────────────────────────────

/**
 * HSL-Tupel aus dem `["color", hue, saturation, lightness]`-Tag; leere
 * Komponenten füllt der Client mit Defaults (lesbar in Light & Dark).
 */
export type SpaceRoleColor = { hue: string; saturation: string; lightness: string }

const DEFAULT_SATURATION = 0.7
const DEFAULT_LIGHTNESS = 0.5

const roleColorValue = (value: string, fallback: number): number => {
    const parsed = parseFloat(value)
    return isNaN(parsed) ? fallback : parsed
}

export const parseRoleColor = (tags: string[][]): SpaceRoleColor => {
    const tag = first(getTags('color', tags)) ?? []
    return { hue: tag[1] ?? '', saturation: tag[2] ?? '', lightness: tag[3] ?? '' }
}

/** `hue, saturation%, lightness%` einer Rollenfarbe (mit Defaults für leere Werte). */
const roleColorParts = (color: SpaceRoleColor): string => {
    const h = roleColorValue(color.hue, 0)
    const s = roleColorValue(color.saturation, DEFAULT_SATURATION)
    const l = roleColorValue(color.lightness, DEFAULT_LIGHTNESS)
    return `${h}, ${s * 100}%, ${l * 100}%`
}

/** `hsl(...)`-String aus einer Rollenfarbe (mit Defaults für leere Werte). */
export const roleColor = (color: SpaceRoleColor): string => `hsl(${roleColorParts(color)})`

/** Durchscheinende Tönung derselben Farbe als Badge-Hintergrund. */
export const roleColorSoft = (color: SpaceRoleColor): string => `hsl(${roleColorParts(color)}, 0.15)`

// ── Rollen (33534) & Mitglieder (13534) ──────────────────────────────────────

export type SpaceRole = {
    id: string
    label: string
    description: string
    color: SpaceRoleColor
    order: number
}

/** Die relay-signierten Rollendefinitionen eines Space, nach `order` sortiert. */
export const deriveSpaceRoles = (url: string): Readable<SpaceRole[]> =>
    derived(deriveRelaySignedEvents(url, [{ kinds: [RELAY_ROLE] }]), ($events) => {
        const roles: SpaceRole[] = []
        for (const event of $events) {
            const id = getTagValue('d', event.tags)
            if (id) {
                roles.push({
                    id,
                    label: getTagValue('label', event.tags) ?? '',
                    description: getTagValue('description', event.tags) ?? '',
                    color: parseRoleColor(event.tags),
                    order: parseInt(getTagValue('order', event.tags) ?? '0', 10) || 0,
                })
            }
        }
        return sortBy((r) => [r.order, r.label] as [number, string], roles)
    })

/** Mitglieder-Pubkeys aus der relay-signierten 13534-Liste. */
export const deriveSpaceMembers = (url: string): Readable<string[]> =>
    derived(deriveRelaySignedEvents(url, [{ kinds: [RELAY_MEMBERS] }]), ([event]) =>
        uniq(getTagValues('member', event?.tags ?? [])),
    )

/** Map<pubkey, roleId[]> aus den Extra-Werten der `member`-Tags (13534). */
export const deriveSpaceMemberRoles = (url: string): Readable<Map<string, string[]>> =>
    derived(deriveRelaySignedEvents(url, [{ kinds: [RELAY_MEMBERS] }]), ([event]) => {
        const memberRoles = new Map<string, string[]>()
        if (event) {
            for (const tag of getTags('member', event.tags)) {
                const pubkey = tag[1]
                if (pubkey) {
                    memberRoles.set(pubkey, tag.slice(2))
                }
            }
        }
        return memberRoles
    })

// ── Aggregierte UI-Sicht ─────────────────────────────────────────────────────

export type RoleView = { id: string; label: string; color: string; soft: string }
export type MemberView = {
    pubkey: string
    npub: string
    short: string
    name: string
    nip05: string // verifizierter NIP-05-Handle (leer = kein Häkchen)
    picture: string
    roles: RoleView[]
    roleIds: string[] // rohe Zuweisungen (für die Admin-Zuweisungs-UI)
    search: string
}
/** `roles` = alle Rollen des Space (für Verwaltung/Zuweisung, nicht nur belegte). */
export type DirectoryView = { ready: boolean; members: MemberView[]; roles: RoleView[] }

/** Kurzform eines npub für die Anzeige ohne Profil. */
const shortNpub = (npub: string): string => `${npub.slice(0, 12)}…${npub.slice(-6)}`

/**
 * Ein einziger reaktiver Snapshot des Directorys: `ready` (Fix A: relay.self da)
 * + Mitglieder mit aufgelösten Rollen und Profilnamen. Die Insel braucht so nur
 * EIN `subscribe`. Solange `ready` false ist, zeigt die UI einen Skeleton statt
 * einer (falschen) leeren Liste.
 */
export const deriveSpaceDirectory = (url: string): Readable<DirectoryView> =>
    // Profile gethrottlet: das Neubauen aller Views (npubEncode/displayProfile je
    // Mitglied) läuft sonst bei JEDEM eintrudelnden Profil (O(N²) über die
    // Ladezeit). Die Insel zeigt die Liste ohnehin erst, wenn alle Profile
    // geladen sind ([[settleMemberProfiles]]) — dann steht der finale, alphabetisch
    // sortierte Snapshot in EINEM Rutsch, ohne progressives Umsortieren.
    derived(
        [
            deriveRelaySelfReady(url),
            deriveSpaceMembers(url),
            deriveSpaceMemberRoles(url),
            deriveSpaceRoles(url),
            throttled(300, profilesByPubkey),
            throttled(300, handlesByNip05),
        ],
        ([ready, members, memberRoles, roles, $profiles, $handles]) => {
            const roleById = new Map(roles.map((r) => [r.id, r]))
            const toRoleView = (id: string): RoleView | null => {
                const role = roleById.get(id)
                return role
                    ? { id, label: role.label || id, color: roleColor(role.color), soft: roleColorSoft(role.color) }
                    : null
            }

            // NIP-05-Handles der Mitglieder lazy verifizieren (dedupliziert, async).
            warmHandles(members)

            const views = members.map((pubkey): MemberView => {
                const npub = nip19.npubEncode(pubkey)
                const profile = $profiles.get(pubkey) as PublishedProfile | undefined
                const name = displayProfile(profile, shortNpub(npub))
                const roleIds = memberRoles.get(pubkey) ?? []
                const memberRoleViews = roleIds.map(toRoleView).filter((r): r is RoleView => r !== null)
                return {
                    pubkey,
                    npub,
                    short: shortNpub(npub),
                    name,
                    nip05: verifiedNip05(pubkey, $profiles, $handles),
                    picture: profile?.picture ?? '',
                    roles: memberRoleViews,
                    roleIds,
                    search: `${name} ${npub}`.toLowerCase(),
                }
            })

            const allRoles = roles
                .map((r) => toRoleView(r.id))
                .filter((r): r is RoleView => r !== null)
            return { ready, members: sortBy((m) => m.name.toLowerCase(), views), roles: allRoles }
        },
    )

// ── Raum-Mitglieder (P4b: die relay-signierte 39002-Liste EINES Raums) ───────

export type RoomMemberView = { pubkey: string; npub: string; short: string; name: string; picture: string }

/**
 * Die Mitglieder EINES Raums (39002-Set aus [[roomMembersByUrl]]) als aufgelöste
 * Views (Name/Avatar), alphabetisch. Profile werden lazy nachgewärmt; `throttled`
 * verhindert das Neubauen bei jedem eintrudelnden Profil.
 */
export const deriveRoomMemberViews = (url: string, h: string): Readable<RoomMemberView[]> =>
    derived([roomMembersByUrl, throttled(300, profilesByPubkey)], ([$byUrl, $profiles]) => {
        // 64-hex filtern: ein kaputter p-Wert ließe npubEncode im derived-map werfen und
        // bräche die GANZE Liste (wie im Report-Pfad). 39002 ist zwar relay-kuratiert,
        // roomMembersByUrl aber nicht self-gefiltert → defensiv.
        const pubkeys = [...($byUrl.get(url)?.get(h) ?? new Set<string>())].filter((pk) => /^[0-9a-f]{64}$/.test(pk))
        const views = pubkeys.map((pk): RoomMemberView => {
            if (!$profiles.has(pk)) {
                loadProfile(pk)
            }
            const npub = nip19.npubEncode(pk)
            const profile = $profiles.get(pk) as PublishedProfile | undefined
            return {
                pubkey: pk,
                npub,
                short: shortNpub(npub),
                name: displayProfile(profile, shortNpub(npub)),
                picture: profile?.picture ?? '',
            }
        })
        return sortBy((m) => m.name.toLowerCase(), views)
    })

// ── Vereins-Zugang (nur EINUNDZWANZIG-Vereins-Relays) ────────────────────────

export type VereinAccess = { gated: boolean; ready: boolean; isMember: boolean }

/**
 * Pro Space-URL: ist die relay-signierte Directory (13534/33534) **fertig**
 * geladen? „Fertig" = der Relay hat den REQ nach dem NIP-42-AUTH abgeschlossen,
 * per **EOSE** (Mitglied → Liste inkl. eigenem Pubkey ist da) ODER per **CLOSED**
 * (`restricted:` für Nicht-Mitglieder — sie dürfen die Liste gar nicht lesen).
 * Beides feuert erst NACH AUTH → kein „kein Mitglied"-Flash bei langsamem Signer,
 * und für Mitglieder ist die Liste schon eingetroffen, wenn das Signal kommt →
 * kein Flackern (isMember steht bereits fest, bevor `ready` wahr wird).
 */
export const spaceDirectoryLoaded = writable(new Set<string>())

const markDirectoryLoaded = (url: string): void =>
    spaceDirectoryLoaded.update((s) => (s.has(url) ? s : new Set(s).add(url)))

/**
 * Live-Sub auf die relay-signierte Directory (13534/33534): lädt den Bestand UND
 * bleibt offen (kein Client-CLOSE). Entscheidend bei langsamem NIP-42-AUTH:
 * welshmans Auth-Buffer puffert den REQ und replayt ihn NACH AUTH — ein
 * One-Shot-`load` würde beim Timeout ein CLOSE senden und damit aus dem
 * Replay-Buffer fallen (→ die Liste käme nie an, Gate bliebe hängen). `onEose`/
 * `onClosed` (post-AUTH) markieren die URL als fertig geladen.
 */
export const watchSpaceDirectory = (url: string, signal: AbortSignal): void => {
    void request({
        relays: [url],
        signal,
        filters: [{ kinds: [RELAY_MEMBERS, RELAY_ROLE] }],
        onEose: () => markDirectoryLoaded(url),
        onClosed: () => markDirectoryLoaded(url),
    })
}

/**
 * Vereins-Zugang für einen Space: `gated` = es ist ein EINUNDZWANZIG-Vereins-
 * Relay; `isMember` = der eingeloggte User steht in der relay-signierten
 * 13534-Mitgliederliste. `ready` = NIP-11-`self` da **und** die AUTH-pflichtige
 * Directory fertig geladen ([[spaceDirectoryLoaded]]) — sonst falscher/flackernder
 * „kein Mitglied"-Hinweis, solange der (evtl. langsame) Signer + der Read laufen.
 */
export const deriveVereinAccess = (url: string): Readable<VereinAccess> =>
    derived(
        [deriveRelaySelfReady(url), spaceDirectoryLoaded, deriveSpaceMembers(url), pubkey],
        ([selfReady, loaded, members, pk]) => ({
            gated: isVereinRelay(url),
            ready: selfReady && loaded.has(url),
            isMember: Boolean(pk && members.includes(pk)),
        }),
    )

/** Gate/„keine Räume"-Hinweis zeigen? Nur wenn Vereins-Relay, fertig geladen
 *  (kein Flackern, siehe [[spaceDirectoryLoaded]]) und der User kein Mitglied ist. */
export const isVereinGatedOut = (a: VereinAccess): boolean => a.gated && a.ready && !a.isMember

// ── Admin (NIP-86 manageRelay) ───────────────────────────────────────────────

/**
 * Admin-Erkennung + Cache-Invalidierung (Fix C). Der Relay beantwortet
 * `supportedmethods` pubkey-abhängig — Admin = nicht-leere Methodenliste. Der
 * Referenz-Client memoiziert das und wird nach Rollenwechseln stale; hier hält
 * eine per-URL-`writable` den Zustand, und `refreshSpaceAdmin` fragt bewusst neu
 * (nach jeder Rollen-/Member-Mutation und beim Login-Wechsel).
 */
const adminByUrl = new Map<string, ReturnType<typeof writable<boolean>>>()

export const refreshSpaceAdmin = (url: string): void => {
    const store = adminByUrl.get(url)
    if (!store) {
        return
    }
    if (!pubkey.get()) {
        store.set(false)
        return
    }
    manageRelay(url, { method: ManagementMethod.SupportedMethods, params: [] })
        .then((res) => store.set(Boolean(res.result?.length)))
        .catch(() => store.set(false))
}

/** Ist der eingeloggte User Admin dieses Space? (reaktiv, invalidierbar) */
export const deriveUserIsSpaceAdmin = (url: string): Readable<boolean> => {
    if (!adminByUrl.has(url)) {
        adminByUrl.set(url, writable(false))
        refreshSpaceAdmin(url)
    }
    return adminByUrl.get(url)!
}

/** Extrahiert die Fehlermeldung aus einer manageRelay-Antwort ('' = Erfolg). */
type ManageResult = { error?: string }
const manageError = (res: ManageResult): string => res.error ?? ''

// Rollen (kind 33534). `createrole`/… sind relay-spezifische Erweiterungen
// (nicht im ManagementMethod-Enum) — der Referenz-Client castet ebenso.
const roleColorParams = (color: SpaceRoleColor): string =>
    [color.hue, color.saturation, color.lightness] as unknown as string

export const createRole = async (
    url: string,
    label: string,
    description: string,
    color: SpaceRoleColor,
    order: number,
): Promise<string> =>
    manageError(
        await manageRelay(url, {
            method: 'createrole' as ManagementMethod,
            params: [randomId(), label, description, roleColorParams(color), order.toString()],
        }),
    )

export const editRole = async (
    url: string,
    id: string,
    label: string,
    description: string,
    color: SpaceRoleColor,
    order: number,
): Promise<string> =>
    manageError(
        await manageRelay(url, {
            method: 'editrole' as ManagementMethod,
            params: [id, label, description, roleColorParams(color), order.toString()],
        }),
    )

export const deleteRole = async (url: string, id: string): Promise<string> =>
    manageError(await manageRelay(url, { method: 'deleterole' as ManagementMethod, params: [id] }))

export const assignRole = async (url: string, pubkey: string, roleId: string): Promise<string> =>
    manageError(await manageRelay(url, { method: 'assignrole' as ManagementMethod, params: [pubkey, roleId] }))

export const unassignRole = async (url: string, pubkey: string, roleId: string): Promise<string> =>
    manageError(await manageRelay(url, { method: 'unassignrole' as ManagementMethod, params: [pubkey, roleId] }))

// Mitglieder (NIP-86 allow/ban)
export const addSpaceMember = async (url: string, pubkey: string): Promise<string> =>
    manageError(await manageRelay(url, { method: ManagementMethod.AllowPubkey, params: [pubkey] }))

export const removeSpaceMember = async (url: string, pubkey: string): Promise<string> =>
    manageError(await manageRelay(url, { method: ManagementMethod.UnallowPubkey, params: [pubkey] }))

export const banSpaceMember = async (url: string, pubkey: string, reason = ''): Promise<string> =>
    manageError(
        await manageRelay(url, {
            method: ManagementMethod.BanPubkey,
            params: reason ? [pubkey, reason] : [pubkey],
        }),
    )

export const unbanSpaceMember = async (url: string, pubkey: string): Promise<string> =>
    manageError(await manageRelay(url, { method: ManagementMethod.UnbanPubkey, params: [pubkey] }))

// Event-Moderation (NIP-86 banevent): entfernt EIN Event relay-seitig (löscht es +
// trägt die id in die Banned-Events-Liste). Das ist die Admin-Löschung fremder
// Nachrichten — im Gegensatz zum eigenen kind-5-Delete braucht sie kein Signatur-
// Recht am Event, nur den Admin-Status am Relay. '' = Erfolg.
export const banEvent = async (url: string, id: string, reason = ''): Promise<string> =>
    manageError(
        await manageRelay(url, {
            method: ManagementMethod.BanEvent,
            params: reason ? [id, reason] : [id],
        }),
    )

// Space-Metadaten (NIP-86 changerelay*): editiert Name/Beschreibung/Icon des
// Relay-NIP-11-Info-Docs. Der Aufrufer sendet nur die GEÄNDERTEN Felder (wie der
// Referenz-Client SpaceEdit) — jede Methode ist ein eigener manageRelay-Call. Der
// Icon-Wert ist eine bereits hochgeladene URL. '' = Erfolg.
export const setRelayName = async (url: string, name: string): Promise<string> =>
    manageError(await manageRelay(url, { method: ManagementMethod.ChangeRelayName, params: [name] }))

export const setRelayDescription = async (url: string, description: string): Promise<string> =>
    manageError(await manageRelay(url, { method: ManagementMethod.ChangeRelayDescription, params: [description] }))

export const setRelayIcon = async (url: string, icon: string): Promise<string> =>
    manageError(await manageRelay(url, { method: ManagementMethod.ChangeRelayIcon, params: [icon] }))

export type BannedMember = { pubkey: string; npub: string; short: string; reason: string }

/** Lädt die Ban-Liste (`listbannedpubkeys`) frisch als Promise (kein Store-Cache). */
export const loadBannedMembers = async (url: string): Promise<BannedMember[]> => {
    const res = (await manageRelay(url, { method: ManagementMethod.ListBannedPubkeys, params: [] })) as {
        result?: { pubkey: string; reason?: string }[]
    }
    return (res.result ?? []).map(({ pubkey, reason }) => {
        const npub = nip19.npubEncode(pubkey)
        return { pubkey, npub, short: shortNpub(npub), reason: reason ?? '' }
    })
}

// ── Laden ────────────────────────────────────────────────────────────────────

/** Lädt Mitglieder- und Rollen-Events (13534/33534) vom Space-Relay. */
export const loadSpaceDirectory = (url: string): Promise<unknown> =>
    load({ relays: [url], filters: [{ kinds: [RELAY_MEMBERS, RELAY_ROLE] }] })

/** Live-Sub auf 13534/33534 — Admin-Änderungen (Rollen/Member) sofort sichtbar. */
export const listenSpaceDirectory = (url: string, signal: AbortSignal): void => {
    void request({ relays: [url], signal, filters: [{ kinds: [RELAY_MEMBERS, RELAY_ROLE], limit: 0 }] })
}

/**
 * Lädt die kind-0-Profile der Mitglieder nach (Namen/Avatare) — vom Space-Relay
 * (dort veröffentlichen Mitglieder ihr Profil oft direkt) UND über die
 * Outbox-Relais der jeweiligen Autoren.
 */
export const loadMemberProfiles = (url: string, pubkeys: string[]): void => {
    if (pubkeys.length === 0) {
        return
    }
    load({ relays: [url], filters: [{ kinds: [0], authors: pubkeys }] })
    for (const pubkey of pubkeys) {
        loadProfile(pubkey)
    }
}

/**
 * Wie [[loadMemberProfiles]], aber awaitbar: resolved erst, wenn ALLE Profile
 * geladen sind (oder ein Sicherheits-Timeout greift). Die Directory-Insel wartet
 * darauf und rendert die Mitgliederliste dann in EINEM Rutsch — so gibt es kein
 * progressives Umsortieren (Flackern) und keinen halb-gerenderten Riesen-`x-for`,
 * der im Mobile-WebView den Compositor überlastet (schwarzer Bildschirm).
 * `loadProfile` bringt Timeout+Backoff selbst mit (hängt nie ewig); der
 * Gesamt-Timeout ist nur ein Not-Aus gegen einzelne Ausreißer.
 */
export const settleMemberProfiles = async (url: string, pubkeys: string[]): Promise<void> => {
    if (pubkeys.length === 0) {
        return
    }
    const timeout = new Promise<void>((resolve) => setTimeout(resolve, 8000))
    const loads = Promise.all([
        load({ relays: [url], filters: [{ kinds: [0], authors: pubkeys }] }),
        ...pubkeys.map((pubkey) => loadProfile(pubkey)),
    ])
    await Promise.race([loads, timeout])
}
