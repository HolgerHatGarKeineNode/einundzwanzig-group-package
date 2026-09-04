/**
 * Space-Directory: Mitglieder + Rollen — portiert aus dem Referenz-Client
 * `src/app/members.ts`. Lese-Teil (M3) + Admin-Mutationen via NIP-86 (`ManagementApi`)/
 * NIP-86 (M6): Rollen, Member-Zuweisung, Ban/Entfernen, Admin-Erkennung.
 *
 * Autoritativ ist die **relay-signierte** Mitgliederliste (13534) und die
 * Rollendefinitionen (33534, app-lokal). Beide filtert `deriveRelaySignedEvents`
 * auf `pubkey === relay.self`. Rollen-Zuweisungen stehen als Extra-Werte an den
 * `["member", pubkey, ...roleIds]`-Tags der 13534.
 */
import { derived, writable, type Readable } from 'svelte/store'
import { throttled } from '@welshman/store'
import { load, request } from './welshmanNet.ts'
import { app, Handles, Profiles, RelayManagement, Relays } from './welshmanApp.ts'
import { pubkey } from './welshmanSession.ts'
import { RELAY_MEMBERS } from './welshmanKinds.ts'
import { matchTags, tagSpec, tagValue, tagValues } from './welshmanTags.ts'
import { displayProfile } from './welshmanProfile.ts'
import { first, randomId, sortBy, uniq } from '@welshman/lib'
import * as nip19 from 'nostr-tools/nip19'
import { deriveRelaySignedEvents, deriveRelaySelfReady } from './repository.ts'
import { isVereinRelay, roomMembersByUrl } from './groups.ts'
import { isBuzzRelay } from './relayCaps.ts'
import {
    spaceIsBuzzAsync,
    buzzAddMember,
    buzzRemoveMember,
    buzzBanPubkey,
    buzzUnbanPubkey,
    buzzChangeRole,
    buzzDeleteEvent,
    buzzLoadRestricted,
    buzzResolveReport,
    buzzTimeoutPubkey,
    buzzUntimeoutPubkey,
    type BuzzRelayRole,
} from './buzzAdmin.ts'
import { planTimeout, planUntimeout, type RestrictionListFailure } from './moderationTimeoutModels.ts'
import type { SpaceKind } from './spaceCaps.ts'
import { formatTimestamp } from './locale.ts'
import { warmHandles, verifiedNip05 } from './handles.ts'
import { loadSpaceProfiles, profilesByPubkey, purgeSpaceLocalProfiles } from './spaceProfiles.ts'
import { t } from './i18n.ts'

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
    const tag = first(matchTags(tagSpec('color'), tags)) ?? []
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
            const id = tagValue(tagSpec('d'), event.tags)
            if (id) {
                roles.push({
                    id,
                    label: tagValue(tagSpec('label'), event.tags) ?? '',
                    description: tagValue(tagSpec('description'), event.tags) ?? '',
                    color: parseRoleColor(event.tags),
                    order: parseInt(tagValue(tagSpec('order'), event.tags) ?? '0', 10) || 0,
                })
            }
        }
        return sortBy((r) => [r.order, r.label] as [number, string], roles)
    })

/** Mitglieder-Pubkeys aus der relay-signierten 13534-Liste. */
export const deriveSpaceMembers = (url: string): Readable<string[]> =>
    derived(deriveRelaySignedEvents(url, [{ kinds: [RELAY_MEMBERS] }]), ([event]) =>
        uniq(tagValues(tagSpec('member'), event?.tags ?? [])),
    )

/** Map<pubkey, roleId[]> aus den Extra-Werten der `member`-Tags (13534). */
export const deriveSpaceMemberRoles = (url: string): Readable<Map<string, string[]>> =>
    derived(deriveRelaySignedEvents(url, [{ kinds: [RELAY_MEMBERS] }]), ([event]) => {
        const memberRoles = new Map<string, string[]>()
        if (event) {
            for (const tag of matchTags(tagSpec('member'), event.tags)) {
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
            throttled(300, app.use(Handles).index.$),
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
                const profile = $profiles.get(pubkey)
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
        // bräche die GANZE Liste (wie im Report-Pfad).
        //
        // **Die Begründung von früher gilt nicht mehr:** hier stand, `roomMembersByUrl`
        // sei „nicht self-gefiltert". Seit P5 des 0.9.5-Sprungs ist es das — die Quelle
        // ist `app.use(Rooms).membership`, und das verlangt `pubkey === relay.self`.
        // Gemessen ist auch, dass `Rooms` kaputte `p`-Werte selbst verwirft (`hexTags`):
        // eine 39002 mit `["p","KAPUTT"]` kommt hier gar nicht mehr an.
        //
        // Der Filter bleibt trotzdem stehen — er kostet nichts und ist die letzte Wache
        // vor einem Wurf, der die ganze Liste nimmt. Wer ihn entfernt, verlässt sich
        // darauf, dass jede künftige Quelle dieser Ableitung ebenso filtert.
        const pubkeys = [...($byUrl.get(url)?.get(h) ?? new Set<string>())].filter((pk) => /^[0-9a-f]{64}$/.test(pk))
        const views = pubkeys.map((pk): RoomMemberView => {
            if (!$profiles.has(pk)) {
                app.use(Profiles).load(pk)
            }
            const npub = nip19.npubEncode(pk)
            const profile = $profiles.get(pk)
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

export type VereinAccess = { gated: boolean; ready: boolean; isMember: boolean; isGuest: boolean }

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
            isGuest: !pk,
        }),
    )

/** Gate/„keine Räume"-Hinweis zeigen? Nur wenn Vereins-Relay, fertig geladen
 *  (kein Flackern, siehe [[spaceDirectoryLoaded]]) und der User kein Mitglied ist. */
export const isVereinGatedOut = (a: VereinAccess): boolean => a.gated && a.ready && !a.isMember

/**
 * Dasselbe Gate für den Fall OHNE Signer — und bewusst **ohne** `ready`.
 *
 * `ready` ist ein Flacker-Schutz: es wartet darauf, dass die AUTH-pflichtige
 * Directory fertig ist, damit niemand „kein Mitglied" zu sehen bekommt, während
 * sein Signer noch arbeitet. Für einen Gast ist das kein Zwischenzustand, sondern
 * der Endzustand: **es gibt keinen Signer, auf den man warten könnte.**
 *
 * Und er wird auch nie eintreten — gemessen am 2026-08-15: der Relay beantwortet
 * den Directory-REQ eines signerlosen Clients mit
 * `CLOSED … auth-required:`, und welshmans `socketPolicyAuthBuffer`
 * (`policy.js:64-67`) **entfernt genau diese Nachricht aus der Empfangsschlange**
 * („we'll retry it"), damit sie nach dem AUTH wiederholt werden kann. Ohne Signer
 * kommt das AUTH nie, der Retry nie, und damit weder `onEose` noch `onClosed` —
 * `spaceDirectoryLoaded` bleibt für diese URL für immer leer. Der Kommentar an
 * [[spaceDirectoryLoaded]] rechnet mit dem `restricted:`-CLOSED (angemeldetes
 * Nicht-Mitglied) und trifft dafür zu; der signerlose Fall fällt hindurch.
 *
 * Ein Gate, dessen Sichtbarkeit an Daten hinter derselben Sperre hängt, ist genau
 * dann unsichtbar, wenn es gebraucht wird. Deshalb hier die Trennung.
 */
export const isVereinGuestGated = (a: VereinAccess): boolean => a.gated && a.isGuest

// ── Admin (NIP-86, `app.use(RelayManagement).forUrl(url)`) ──────────────────

/**
 * Admin-Erkennung + Cache-Invalidierung (Fix C). Der Relay beantwortet
 * `supportedmethods` pubkey-abhängig — Admin = nicht-leere Methodenliste. Der
 * Referenz-Client memoiziert das und wird nach Rollenwechseln stale; hier hält
 * eine per-URL-`writable` den Zustand, und `refreshSpaceAdmin` fragt bewusst neu
 * (nach jeder Rollen-/Member-Mutation und beim Login-Wechsel).
 */
const adminByUrl = new Map<string, ReturnType<typeof writable<boolean>>>()

const nip86AdminStore = (url: string): ReturnType<typeof writable<boolean>> => {
    if (!adminByUrl.has(url)) {
        adminByUrl.set(url, writable(false))
    }
    return adminByUrl.get(url)!
}

export const refreshSpaceAdmin = (url: string): void => {
    const store = adminByUrl.get(url)
    if (!store) {
        return
    }
    if (!pubkey.get()) {
        store.set(false)
        return
    }
    // Die Weiche MUSS auf das NIP-11-Doc warten. Die synchrone `spaceIsBuzz`
    // liefert beim ersten Rendern verlässlich `false` — das Profil ist da noch
    // unterwegs, sie stößt das Laden nur an. Mit ihr als Wächter feuerte der
    // NIP-86-Probe-Aufruf also GEGEN BUZZ, quittiert mit `405 Method Not Allowed`.
    // Das kostete den Nutzer bei jedem Seitenaufbau eine Signatur-Anfrage im
    // Signer für ein NIP-98-Event, das niemand auswertet.
    void spaceIsBuzzAsync(url).then((isBuzz) => {
        if (isBuzz) {
            return
        }
        app.use(RelayManagement)
            .forUrl(url)
            .supportedMethods()
            .then((res) => store.set(Boolean((res.result as unknown[] | undefined)?.length)))
            .catch(() => store.set(false))
    })
}

/** Relay-weite Rollen, die auf Buzz Admin-Rechte tragen (13534, `["member",<pk>,<role>]`). */
const BUZZ_ADMIN_ROLES = ['owner', 'admin']

/**
 * Ist der eingeloggte User Admin dieses Space? (reaktiv)
 *
 * - **zooid:** unverändert der NIP-86-`supportedmethods`-Probe.
 * - **Buzz:** direkt aus der relay-signierten 13534. Buzz baut sie als
 *   `["member", <pubkey>, <role>]` — also exakt in der Tag-Form, die zooid auch
 *   nutzt, weshalb {@link deriveSpaceMemberRoles} hier ohne Änderung
 *   weiterverwendet werden kann. Admin = Rolle `owner` oder `admin`. Das ist
 *   obendrein besser als der Probe-Aufruf: kein Round-Trip, und die Live-Sub auf
 *   13534 aktualisiert den Status von selbst.
 *
 * Buzz hat kein NIP-86 (`POST /` → 405), der Probe-Aufruf würde dort still
 * scheitern und `isAdmin` dauerhaft auf false nageln.
 */
export const deriveUserIsSpaceAdmin = (url: string): Readable<boolean> => {
    const nip86 = nip86AdminStore(url)
    // Ohne Vorab-Weiche: `refreshSpaceAdmin` wartet selbst auf das NIP-11-Doc und
    // bricht auf Buzz ab. Eine synchrone Prüfung HIER wäre der Auslöser des
    // 405-Aufrufs — sie sagt beim ersten Rendern immer „kein Buzz".
    refreshSpaceAdmin(url)
    return derived(
        [app.use(Relays).one(url), deriveSpaceMemberRoles(url), pubkey, nip86],
        ([relay, memberRoles, pk, isNip86Admin]) => {
            if (!isBuzzRelay(relay)) {
                return isNip86Admin
            }
            if (!pk) {
                return false
            }
            return (memberRoles.get(pk) ?? []).some((role) => BUZZ_ADMIN_ROLES.includes(role))
        },
    )
}

/** Extrahiert die Fehlermeldung aus einer NIP-86-Antwort ('' = Erfolg). */
type ManageResult = { error?: string }
const manageError = (res: ManageResult): string => res.error ?? ''

// Rollen (kind 33534). Hier stand bis zum P1-Review-Gate, das seien relay-spezifische
// Erweiterungen, die der Referenz-Client nicht kenne. **Das war falsch:**
// `@welshman/util@0.9.5` bringt `makeCreateRole`/`makeEditRole`/`makeDeleteRole`/
// `makeAssignRole`/`makeUnassignRole` mit, alle fünf als benannte `ManagementApi`-
// Methoden und mit genau unserer Parameterreihenfolge. Die Aufrufe unten stehen
// deshalb in der Zielform. Die `as ManagementMethod`-Casts, die 0.8.16 verlangte,
// sind ersatzlos weg — in 0.9.5 ist `method` ein schlichter String.
//
/**
 * ── Warum diese zwei Aufrufe über `send` gehen und nicht über `createRole`/`editRole` ──
 *
 * 0.9.5 hat die fünf Rollen-Methoden als benannte Methoden an `ManagementApi` — aber es
 * typisiert **`color: number` und `order: number`** (`util/src/Nip86.ts`). Wir schicken
 * ein **HSL-Tripel als Array** und `order` als **String**. Das ist keine Nachlässigkeit,
 * sondern die Wire-Form, die unser Relay erwartet; sie darf sich nicht ändern.
 *
 * Der andere Weg wäre gewesen, die Umformung in den Adapter zu legen und `number` zu
 * versprechen, während ein Array über die Leitung geht. Das wäre eine Lüge im Typsystem
 * — und zwar an der Stelle, an der der nächste Leser sie am wenigsten vermutet.
 * `send` sagt stattdessen wörtlich, was gesendet wird.
 *
 * **`deleteRole`, `assignRole` und `unassignRole` bleiben benannt** — bei ihnen stimmen
 * unsere Werte mit der 0.9.5-Signatur überein.
 */
const roleParams = (id: string, label: string, description: string, color: SpaceRoleColor, order: number): unknown[] => [
    id,
    label,
    description,
    [color.hue, color.saturation, color.lightness],
    order.toString(),
]

export const createRole = async (
    url: string,
    label: string,
    description: string,
    color: SpaceRoleColor,
    order: number,
): Promise<string> =>
    manageError(
        await app
            .use(RelayManagement)
            .forUrl(url)
            .send({ method: 'createrole', params: roleParams(randomId(), label, description, color, order) }),
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
        await app
            .use(RelayManagement)
            .forUrl(url)
            .send({ method: 'editrole', params: roleParams(id, label, description, color, order) }),
    )

export const deleteRole = async (url: string, id: string): Promise<string> =>
    manageError(await app.use(RelayManagement).forUrl(url).deleteRole(id))

export const assignRole = async (url: string, pubkey: string, roleId: string): Promise<string> =>
    manageError(await app.use(RelayManagement).forUrl(url).assignRole(pubkey, roleId))

export const unassignRole = async (url: string, pubkey: string, roleId: string): Promise<string> =>
    manageError(await app.use(RelayManagement).forUrl(url).unassignRole(pubkey, roleId))

// ── Mutationen: die Weiche ist ÜBERALL asynchron ─────────────────────────────
//
// `spaceIsBuzzAsync`, nie die synchrone Fassung. Die synchrone liest nur den
// NIP-11-Cache und meldet `false`, solange das Doc nicht da ist — sie stößt das
// Laden bloß an. Eine Mutation lief damit gegen Buzz auf der NIP-86-Strecke, und
// das scheitert STILL: `POST /` antwortet 405, die Antwort trägt kein `error`-Feld,
// also liefert `manageError` einen Leerstring — und der Aufrufer hält den
// Fehlschlag für einen Erfolg.
//
// Am laufenden Relay belegt (2026-07-30): Die Melde-Queue meldete „Inhalt
// entfernt", der Report wurde per 9044 auf `resolved` gesetzt — aber in der
// Datenbank des Test-Stacks lag **kein einziges 9005 vom Client**, und die
// gemeldete Nachricht war noch da. Kein Toast, kein Log, nichts.
//
// Es ist dieselbe Falle wie bei der Admin-Erkennung, beim Upload-Ziel und beim
// Raum-Menü — dort jeweils schon so gelöst. Deshalb hier durchgängig, nicht nur
// an der einen Stelle, an der es aufgefallen ist.
export const addSpaceMember = async (url: string, pubkey: string): Promise<string> =>
    (await spaceIsBuzzAsync(url))
        ? await buzzAddMember(url, pubkey)
        : manageError(await app.use(RelayManagement).forUrl(url).allowPubkey(pubkey))

export const removeSpaceMember = async (url: string, pubkey: string): Promise<string> =>
    (await spaceIsBuzzAsync(url))
        ? await buzzRemoveMember(url, pubkey)
        : manageError(await app.use(RelayManagement).forUrl(url).unallowPubkey(pubkey))

export const banSpaceMember = async (url: string, pubkey: string, reason = ''): Promise<string> =>
    (await spaceIsBuzzAsync(url))
        ? await buzzBanPubkey(url, pubkey, reason)
        : manageError(await app.use(RelayManagement).forUrl(url).banPubkey(pubkey, reason || undefined))

export const unbanSpaceMember = async (url: string, pubkey: string): Promise<string> =>
    (await spaceIsBuzzAsync(url))
        ? await buzzUnbanPubkey(url, pubkey)
        : manageError(await app.use(RelayManagement).forUrl(url).unbanPubkey(pubkey))

/**
 * **Timed suspension** (Buzz kind 9042) — the strongest measure this surface offers
 * against a person. `''` on success, otherwise the relay's wording or the gate's refusal.
 *
 * ── Why there is no `spaceIsBuzzAsync` here ─────────────────────────────────
 *
 * The neighbours above ask for the relay kind themselves because they have **two** arms
 * (a Buzz kind or NIP-86). This measure has one: 9042 is Buzz dialect, zooid has no
 * counterpart — and zooid would not reject the command, it would **store** it as a
 * permanent, unreadable event and suspend nobody. The decision therefore falls in the P1
 * gate (`mayWriteKind`), and it falls **as a return value**: `planTimeout` hands back the
 * event body or `null`. A caller that publishes without it has nothing to publish.
 *
 * `now` is a parameter and is read at the call, not before: Buzz accepts moderation
 * commands only within ±120 s (`MAX_COMMAND_SKEW_SECS`), so the event must not be
 * prepared ahead of time.
 */
export const timeoutSpaceMember = async (
    url: string,
    pubkey: string,
    durationSecs: number,
    spaceKind: SpaceKind,
    reason = '',
    nowSecs: number = Math.floor(Date.now() / 1000),
): Promise<string> => {
    const command = planTimeout(pubkey, durationSecs, nowSecs, spaceKind, reason)
    if (!command) {
        return t('Dieser Space kennt keine befristete Sperre (nur Buzz-Spaces unterstützen das).')
    }

    return await buzzTimeoutPubkey(url, command)
}

/** Lifts a timed suspension (Buzz kind 9043). Same construction, its own gate. */
export const untimeoutSpaceMember = async (url: string, pubkey: string, spaceKind: SpaceKind): Promise<string> => {
    const command = planUntimeout(pubkey, spaceKind)
    if (!command) {
        return t('Dieser Space kennt keine befristete Sperre (nur Buzz-Spaces unterstützen das).')
    }

    return await buzzUntimeoutPubkey(url, command)
}

/**
 * Rolle eines bestehenden Mitglieds setzen (Buzz kind 9032, **nur Owner**). Auf
 * zooid gibt es dafür kein Gegenstück — dort sind Rollen benannte 33534-Labels
 * ohne Rechtewirkung, die Rechte stehen in der Relay-TOML. Deshalb liefert der
 * zooid-Zweig eine klare Absage statt einer stillen Nicht-Aktion.
 */
export const setSpaceMemberRole = async (url: string, pubkey: string, role: BuzzRelayRole): Promise<string> =>
    (await spaceIsBuzzAsync(url))
        ? await buzzChangeRole(url, pubkey, role)
        : t('Dieser Space kennt keine Relay-Rollen (nur Buzz-Spaces unterstützen das).')

// Event-Moderation (NIP-86 banevent): entfernt EIN Event relay-seitig (löscht es +
// trägt die id in die Banned-Events-Liste). Das ist die Admin-Löschung fremder
// Nachrichten — im Gegensatz zum eigenen kind-5-Delete braucht sie kein Signatur-
// Recht am Event, nur den Admin-Status am Relay. '' = Erfolg.
/**
 * Wie eine Meldung erledigt wurde — die Entscheidung, nicht die Vollstreckung.
 * Die eigentliche Maßnahme (Löschen, Bannen) ist ein eigener Aufruf.
 */
export type ReportResolution = 'dismiss' | 'delete' | 'ban'

/**
 * Schließt eine **Meldung** ab. `id` ist die Report-Kennung aus `ReportView.id`
 * (zooid: Event-id des 1984 · Buzz: `report_event_id`). '' = Erfolg.
 *
 * - **Buzz:** kind 9044. Der Relay setzt die Report-Zeile auf `resolved`/`dismissed`
 *   und schreibt eine Audit-Zeile; er löscht und bannt dabei **nichts**. Die
 *   Kopplungsregel `action=dismiss` ⇔ `status=dismissed` steckt in der Abbildung
 *   unten.
 *
 *   Ohne 9044 wäre das ein **No-op mit Erfolgsmeldung**: ein Report ist auf Buzz
 *   kein abfragbares Event (der Ingest schreibt ihn nach `moderation_reports` und
 *   kehrt vorher zurück, `ingest.rs:1600-1608`), also gäbe es nichts zu bannen — die
 *   Meldung bliebe in der Relay-Datenbank ewig offen stehen.
 *
 * - **zooid:** NIP-86 `banevent` auf das Report-Event, wie bisher — dort IST der
 *   Report ein Event, und der Bann nimmt ihn aus der Queue.
 */
export const resolveReport = async (
    url: string,
    id: string,
    resolution: ReportResolution,
    reason = '',
): Promise<string> => {
    if (!(await spaceIsBuzzAsync(url))) {
        return manageError(await app.use(RelayManagement).forUrl(url).banEvent(id, 'dismissed by admin'))
    }
    return resolution === 'dismiss'
        ? await buzzResolveReport(url, id, 'dismissed', 'dismiss', reason)
        : await buzzResolveReport(url, id, 'resolved', resolution, reason)
}

/**
 * `h` ist auf Buzz **Pflicht**: kind 9005 ist kanal-gescopt und wird ohne `h` mit
 * `requires_h_channel_scope` abgewiesen (`ingest.rs:487`). Auf zooid ist der
 * Parameter bedeutungslos — NIP-86 `banevent` kennt nur die Event-id.
 */
export const banEvent = async (url: string, id: string, reason = '', h = ''): Promise<string> =>
    (await spaceIsBuzzAsync(url))
        ? await buzzDeleteEvent(url, id, h)
        : manageError(await app.use(RelayManagement).forUrl(url).banEvent(id, reason || undefined))

// Space-Metadaten (NIP-86 changerelay*): editiert Name/Beschreibung/Icon des
// Relay-NIP-11-Info-Docs. Der Aufrufer sendet nur die GEÄNDERTEN Felder (wie der
// Referenz-Client SpaceEdit) — jede Methode ist ein eigener NIP-86-Call. Der
// Icon-Wert ist eine bereits hochgeladene URL. '' = Erfolg.
export const setRelayName = async (url: string, name: string): Promise<string> =>
    manageError(await app.use(RelayManagement).forUrl(url).changeRelayName(name))

export const setRelayDescription = async (url: string, description: string): Promise<string> =>
    manageError(await app.use(RelayManagement).forUrl(url).changeRelayDescription(description))

export const setRelayIcon = async (url: string, icon: string): Promise<string> =>
    manageError(await app.use(RelayManagement).forUrl(url).changeRelayIcon(icon))

/**
 * One standing restriction, in the shape the surface renders.
 *
 * `banned` separates the two kinds: a **ban** (permanent, set by an older client or
 * another tool — this surface does not ban any more) from a running **timed suspension**.
 * `until` is the end of the suspension in the active language, and is filled for the
 * timed one only.
 */
export type RestrictedMember = {
    pubkey: string
    npub: string
    short: string
    reason: string
    banned: boolean
    until: string
}

/**
 * The answer to a restriction query: the list **or** a reason why there is none.
 *
 * Two fields rather than a throw, because the surface has to show both and an empty array
 * would be the wrong answer: "nobody is restricted" and "you may not ask this" are
 * different statements (see [[buzzLoadRestricted]]).
 */
export type RestrictedList = { entries: RestrictedMember[]; error: string }

/** One sentence per failure — the 403 says in as many words that the permission is missing. */
const restrictionFailureText = (reason: RestrictionListFailure): string =>
    reason === 'forbidden' || reason === 'unauthorized'
        ? t('Keine Berechtigung, die Sperrliste dieses Space zu lesen.')
        : t('Die Sperrliste konnte nicht geladen werden.')

const asRestricted = (pubkey: string, reason: string, banned: boolean, until: string): RestrictedMember => {
    const npub = nip19.npubEncode(pubkey)

    return { pubkey, npub, short: shortNpub(npub), reason, banned, until }
}

/**
 * Loads the standing restrictions fresh as a promise (no store cache).
 *
 * **Buzz:** `GET /moderation/restricted` — one answer carrying bans AND running timed
 * suspensions, and the only proof that a 9042 took effect (the relay neither stores nor
 * fans out 9042–9044). A failure is reported as text, never as an empty list.
 *
 * **zooid:** NIP-86 `listbannedpubkeys` as before. There is no timed suspension there, so
 * every row is a ban.
 */
export const loadRestrictedMembers = async (url: string): Promise<RestrictedList> => {
    if (await spaceIsBuzzAsync(url)) {
        const result = await buzzLoadRestricted(url)
        if (!result.ok) {
            return { entries: [], error: restrictionFailureText(result.reason) }
        }

        return {
            entries: result.entries.map((entry) =>
                asRestricted(
                    entry.pubkey,
                    entry.reason,
                    entry.banned,
                    entry.mutedUntil === null
                        ? ''
                        : formatTimestamp(entry.mutedUntil, { dateStyle: 'medium', timeStyle: 'short' }),
                ),
            ),
            error: '',
        }
    }

    try {
        const res = (await app.use(RelayManagement).forUrl(url).listBannedPubkeys()) as {
            result?: { pubkey: string; reason?: string }[]
        }

        return {
            entries: (res.result ?? []).map(({ pubkey, reason }) => asRestricted(pubkey, reason ?? '', true, '')),
            error: '',
        }
    } catch {
        return { entries: [], error: t('Die Sperrliste konnte nicht geladen werden.') }
    }
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
 * kind 0 zusätzlich vom SPACE-Relay holen — auf zwei getrennten Wegen.
 *
 * Auf zooid geht es direkt ins Repository: dort veröffentlichen Mitglieder ihr Profil
 * oft am Space-Relay, und es ist dasselbe Profil wie im nativen Nostr.
 *
 * Buzz legt beim Onboarding ein EIGENES kind-0 an (gemessen: `display_name` wie `ceo`
 * oder `nostr-specialist`, eigenes Bild, junger Zeitstempel). Das gehört NICHT ins
 * gemeinsame Repository — kind 0 ist ersetzbar, der jüngste Zeitstempel gewinnt, und
 * das Buzz-Profil verdrängte damit app-weit das echte. Es landet stattdessen in der
 * zweiten Quelle ([[loadSpaceProfiles]]) und füllt beim ANZEIGEN nur die Lücken, die
 * das native Profil offen lässt. `purgeSpaceLocalProfiles` bleibt daneben stehen: es
 * hält das Repository frei von Buzz-kind-0 aus älteren Sitzungen.
 */
const loadProfilesFromSpace = async (url: string, pubkeys: string[]): Promise<void> => {
    if (await spaceIsBuzzAsync(url)) {
        purgeSpaceLocalProfiles(url)
        await loadSpaceProfiles(url, pubkeys)
        return
    }
    await load({ relays: [url], filters: [{ kinds: [0], authors: pubkeys }] })
}

/**
 * Lädt die kind-0-Profile der Mitglieder nach (Namen/Avatare) — über die
 * Outbox-Relais der jeweiligen Autoren und, wo es passt, zusätzlich vom Space-Relay
 * (siehe [[loadProfilesFromSpace]]).
 */
export const loadMemberProfiles = (url: string, pubkeys: string[]): void => {
    if (pubkeys.length === 0) {
        return
    }
    void loadProfilesFromSpace(url, pubkeys)
    for (const pubkey of pubkeys) {
        app.use(Profiles).load(pubkey)
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
    const loads = Promise.all([loadProfilesFromSpace(url, pubkeys), ...pubkeys.map((pubkey) => app.use(Profiles).load(pubkey))])
    await Promise.race([loads, timeout])
}
