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
import { load, request } from '@welshman/net'
import { profilesByPubkey, loadProfile, manageRelay, pubkey } from '@welshman/app'
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
import { isVereinRelay } from './groups'

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
    derived(
        [
            deriveRelaySelfReady(url),
            deriveSpaceMembers(url),
            deriveSpaceMemberRoles(url),
            deriveSpaceRoles(url),
            profilesByPubkey,
        ],
        ([ready, members, memberRoles, roles, $profiles]) => {
            const roleById = new Map(roles.map((r) => [r.id, r]))
            const toRoleView = (id: string): RoleView | null => {
                const role = roleById.get(id)
                return role
                    ? { id, label: role.label || id, color: roleColor(role.color), soft: roleColorSoft(role.color) }
                    : null
            }

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

// ── Vereins-Zugang (nur EINUNDZWANZIG-Vereins-Relays) ────────────────────────

export type VereinAccess = { gated: boolean; ready: boolean; isMember: boolean }

/**
 * Vereins-Zugang für einen Space: `gated` = es ist ein EINUNDZWANZIG-Vereins-
 * Relay; `isMember` = der eingeloggte User steht in der relay-signierten
 * 13534-Mitgliederliste. `ready` (relay.self da, Fix A) verhindert einen
 * falschen „kein Mitglied"-Hinweis, solange NIP-11/13534 noch laden.
 */
export const deriveVereinAccess = (url: string): Readable<VereinAccess> =>
    derived(
        [deriveRelaySelfReady(url), deriveSpaceMembers(url), pubkey],
        ([ready, members, pk]) => ({
            gated: isVereinRelay(url),
            ready,
            isMember: Boolean(pk && members.includes(pk)),
        }),
    )

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
