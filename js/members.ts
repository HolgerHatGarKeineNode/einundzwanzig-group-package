/**
 * Space-Directory: Mitglieder — portiert aus dem Referenz-Client
 * `src/app/members.ts`. Lese-Teil (M3) + Admin-Mutationen (M6): Member-Zuweisung,
 * Ban/Entfernen, Admin-Erkennung.
 *
 * Autoritativ ist die **relay-signierte** Mitgliederliste (13534), gefiltert von
 * `deriveRelaySignedEvents` auf `pubkey === relay.self`. Am `member`-Tag steht
 * hinter dem Pubkey die Relay-Rolle (`["member", pubkey, "owner"|"admin"|"member"]`)
 * — daran hängt die Admin-Erkennung.
 *
 * **Benannte Rollen (kind 33534) gibt es nicht mehr** (Nutzerentscheidung
 * 2026-07-28). Buzz kennt sie ohnehin nicht; die zooid-seitigen Label/Farben sind
 * ersatzlos entfallen. Die drei Relay-Rollen aus der 13534 bleiben.
 *
 * **Zwei Relay-Strecken (P3, Buzz-Migration).** Die Mutationen laufen je nach
 * Relay über zwei verschiedene Protokolle — die Weiche steckt ausschließlich in
 * diesem Modul, die exportierten Signaturen sind identisch, damit `bridge.ts` und
 * die Blades unberührt bleiben:
 *
 * - **zooid (Default):** NIP-86 `manageRelay` — unverändert wie bisher.
 * - **Buzz:** native Relay-Admin-Kinds (`buzzAdmin.ts`). Buzz hat kein NIP-86;
 *   am laufenden Relay gemessen antwortet `POST /` mit `405 Method Not Allowed`.
 *   Jeder `manageRelay`-Aufruf scheiterte dort still, weshalb `isAdmin` false blieb
 *   und „Neuen Raum anlegen" gar nicht erst gerendert wurde.
 *
 * Erkannt wird der Modus am NIP-11-`software`-Feld ([[isBuzzRelay]]); alles
 * Unbekannte bleibt auf der zooid-Strecke.
 */
import { derived, writable, type Readable } from 'svelte/store'
import { throttled } from '@welshman/store'
import { load, request } from '@welshman/net'
import {
    profilesByPubkey,
    loadProfile,
    manageRelay,
    pubkey,
    handlesByNip05,
    getRelaysByUrl,
    loadRelay,
    deriveRelay,
} from '@welshman/app'
import {
    RELAY_MEMBERS,
    ManagementMethod,
    getTags,
    getTagValue,
    getTagValues,
    displayProfile,
    type PublishedProfile,
} from '@welshman/util'
import { sortBy, uniq } from '@welshman/lib'
import * as nip19 from 'nostr-tools/nip19'
import { deriveRelaySignedEvents, deriveRelaySelfReady } from './repository'
import { isBuzzRelay } from './relayCaps'
import {
    buzzAddMember,
    buzzRemoveMember,
    buzzChangeRole,
    buzzBanPubkey,
    buzzUnbanPubkey,
    buzzDeleteEvent,
    buzzSetIcon,
    buzzLoadRestricted,
    type BuzzRelayRole,
} from './buzzAdmin'
import { isVereinRelay, roomMembersByUrl } from './groups'
import { warmHandles, verifiedNip05 } from './handles'

// ── Mitglieder (13534) ───────────────────────────────────────────────────────

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

export type MemberView = {
    pubkey: string
    npub: string
    short: string
    name: string
    nip05: string // verifizierter NIP-05-Handle (leer = kein Häkchen)
    picture: string
    search: string
}
export type DirectoryView = { ready: boolean; members: MemberView[] }

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
            throttled(300, profilesByPubkey),
            throttled(300, handlesByNip05),
        ],
        ([ready, members, $profiles, $handles]) => {
            // NIP-05-Handles der Mitglieder lazy verifizieren (dedupliziert, async).
            warmHandles(members)

            const views = members.map((pubkey): MemberView => {
                const npub = nip19.npubEncode(pubkey)
                const profile = $profiles.get(pubkey) as PublishedProfile | undefined
                const name = displayProfile(profile, shortNpub(npub))
                return {
                    pubkey,
                    npub,
                    short: shortNpub(npub),
                    name,
                    nip05: verifiedNip05(pubkey, $profiles, $handles),
                    picture: profile?.picture ?? '',
                    search: `${name} ${npub}`.toLowerCase(),
                }
            })

            return { ready, members: sortBy((m) => m.name.toLowerCase(), views) }
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
        filters: [{ kinds: [RELAY_MEMBERS] }],
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

// ── Relay-Modus-Weiche (zooid/NIP-86 ↔ Buzz-native Kinds) ───────────────────

/**
 * Spricht dieser Space **Buzz** statt zooid? Synchroner Schnappschuss aus dem
 * bereits geladenen NIP-11-Profil (`getRelaysByUrl`, welshman-Cache).
 *
 * Ist das Profil noch nicht da, wird der Fetch angestossen und `false` gemeldet —
 * also **zooid-Verhalten als Default**. Das ist Absicht: die bestehende
 * NIP-86-Strecke darf sich durch diese Migration nicht aendern, und ein noch
 * unbekanntes Relay ist kein Buzz-Relay.
 */
const spaceIsBuzz = (url: string): boolean => {
    const profile = getRelaysByUrl().get(url)
    if (!profile) {
        void loadRelay(url)
        return false
    }
    return isBuzzRelay(profile)
}

// ── Admin-Erkennung ─────────────────────────────────────────────────────────

/**
 * zooid-Zweig (NIP-86): Der Relay beantwortet `supportedmethods` pubkey-abhaengig
 * — Admin = nicht-leere Methodenliste. Der Referenz-Client memoiziert das und
 * wird nach Rollenwechseln stale; hier haelt eine per-URL-`writable` den Zustand,
 * und `refreshSpaceAdmin` fragt bewusst neu (nach jeder Member-Mutation und beim
 * Login-Wechsel).
 *
 * Auf **Buzz** wird dieser Probe-Aufruf gar nicht erst gestartet: dort gibt es
 * kein NIP-86 (`POST /` → `405 Method Not Allowed`), der Aufruf wuerde still
 * scheitern und `isAdmin` dauerhaft auf false nageln — genau der Bug, den P3
 * behebt.
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
    if (!store || spaceIsBuzz(url)) {
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

/**
 * Ist der eingeloggte User Admin dieses Space? (reaktiv)
 *
 * - **Buzz:** direkt aus der relay-signierten 13534. Buzz baut sie als
 *   `["member", <pubkey>, <role>]` (`buzz-db/src/lib.rs:3595`) — also exakt in der
 *   Tag-Form, die zooid auch nutzt, weshalb [[deriveSpaceMemberRoles]] hier ohne
 *   Aenderung weiterverwendet werden kann. Admin = Rolle `owner` oder `admin`.
 *   Das ist obendrein besser als der alte Probe-Aufruf: kein Round-Trip, und die
 *   Live-Sub auf 13534 aktualisiert den Status von selbst.
 * - **zooid:** unveraendert der NIP-86-`supportedmethods`-Probe.
 */
const BUZZ_ADMIN_ROLES = ['owner', 'admin']

export const deriveUserIsSpaceAdmin = (url: string): Readable<boolean> => {
    const nip86 = nip86AdminStore(url)
    if (!spaceIsBuzz(url)) {
        refreshSpaceAdmin(url)
    }
    return derived(
        [deriveRelay(url), deriveSpaceMemberRoles(url), pubkey, nip86],
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

/** Extrahiert die Fehlermeldung aus einer manageRelay-Antwort ('' = Erfolg). */
type ManageResult = { error?: string }
const manageError = (res: ManageResult): string => res.error ?? ''

// Mitglieder — zooid: NIP-86 allow/ban · Buzz: native Kinds 9030/9031/9040/9041.
// Die Signaturen bleiben identisch, damit `bridge.ts` und die Blades unberuehrt
// bleiben; die Weiche steckt ausschliesslich hier.
export const addSpaceMember = async (url: string, pubkey: string): Promise<string> =>
    spaceIsBuzz(url)
        ? await buzzAddMember(url, pubkey)
        : manageError(await manageRelay(url, { method: ManagementMethod.AllowPubkey, params: [pubkey] }))

export const removeSpaceMember = async (url: string, pubkey: string): Promise<string> =>
    spaceIsBuzz(url)
        ? await buzzRemoveMember(url, pubkey)
        : manageError(await manageRelay(url, { method: ManagementMethod.UnallowPubkey, params: [pubkey] }))

export const banSpaceMember = async (url: string, pubkey: string, reason = ''): Promise<string> =>
    spaceIsBuzz(url)
        ? await buzzBanPubkey(url, pubkey, reason)
        : manageError(
              await manageRelay(url, {
                  method: ManagementMethod.BanPubkey,
                  params: reason ? [pubkey, reason] : [pubkey],
              }),
          )

export const unbanSpaceMember = async (url: string, pubkey: string): Promise<string> =>
    spaceIsBuzz(url)
        ? await buzzUnbanPubkey(url, pubkey)
        : manageError(await manageRelay(url, { method: ManagementMethod.UnbanPubkey, params: [pubkey] }))

/**
 * Rolle eines bestehenden Mitglieds setzen (Buzz kind 9032, **nur Owner**). Auf
 * zooid gibt es dafuer kein Gegenstueck — dort sind Rollen benannte 33534-Labels
 * ohne Rechtewirkung, die Rechte stehen in der Relay-TOML. Deshalb liefert der
 * zooid-Zweig eine klare Absage statt einer stillen Nicht-Aktion.
 */
export const setSpaceMemberRole = async (
    url: string,
    pubkey: string,
    role: BuzzRelayRole,
): Promise<string> =>
    spaceIsBuzz(url)
        ? await buzzChangeRole(url, pubkey, role)
        : 'Dieser Space kennt keine Relay-Rollen (nur Buzz-Spaces unterstützen das).'

// Event-Moderation (NIP-86 banevent): entfernt EIN Event relay-seitig (löscht es +
// trägt die id in die Banned-Events-Liste). Das ist die Admin-Löschung fremder
// Nachrichten — im Gegensatz zum eigenen kind-5-Delete braucht sie kein Signatur-
// Recht am Event, nur den Admin-Status am Relay. '' = Erfolg.
/**
 * Verwirft ein **Report-Event** (kind 1984) relay-seitig.
 *
 * - **zooid:** NIP-86 `banevent` — löscht den Report und merkt seine id vor.
 * - **Buzz:** No-op mit Erfolg. Am laufenden Relay gemessen ist ein Report dort
 *   **gar kein abfragbares Event**: der Ingest nimmt kind 1984 an, schreibt ihn in
 *   die `moderation_reports`-Tabelle und kehrt vorher zurück
 *   (`handlers/ingest.rs:1600-1608`) — ein `REQ -k 1984` liefert 0 Treffer. Es gibt
 *   also nichts zu löschen, und der einzige Weg wäre kind 9005, das ohne `h`
 *   abgewiesen wird (`invalid: channel-scoped events must include an h tag`) — ein
 *   `h` hat der Report per Definition nicht. Ein Fehler-Toast wäre hier eine
 *   Falschmeldung; das lokale Ausblenden bleibt korrekt.
 */
export const dismissReportEvent = async (url: string, id: string): Promise<string> =>
    spaceIsBuzz(url)
        ? ''
        : manageError(
              await manageRelay(url, { method: ManagementMethod.BanEvent, params: [id, 'dismissed by admin'] }),
          )

export const banEvent = async (url: string, id: string, reason = '', h = ''): Promise<string> =>
    spaceIsBuzz(url)
        ? await buzzDeleteEvent(url, id, h)
        : manageError(
              await manageRelay(url, {
                  method: ManagementMethod.BanEvent,
                  params: reason ? [id, reason] : [id],
              }),
          )

// Space-Metadaten (NIP-86 changerelay*): editiert Name/Beschreibung/Icon des
// Relay-NIP-11-Info-Docs. Der Aufrufer sendet nur die GEÄNDERTEN Felder (wie der
// Referenz-Client SpaceEdit) — jede Methode ist ein eigener manageRelay-Call. Der
// Icon-Wert ist eine bereits hochgeladene URL. '' = Erfolg.
// Buzz hat fuer Name/Beschreibung KEIN Gegenstueck: sein kind 9033
// (`set workspace profile`) setzt ausschliesslich das Icon
// (`handlers/relay_admin.rs:232-252`). Beides sind dort Deployment-Konfiguration.
// Der Buzz-Zweig meldet das als Text zurueck, statt so zu tun, als sei es passiert.
const BUZZ_NO_META = 'Buzz-Spaces können Name und Beschreibung nicht über Nostr ändern (nur das Icon).'

export const setRelayName = async (url: string, name: string): Promise<string> =>
    spaceIsBuzz(url)
        ? BUZZ_NO_META
        : manageError(await manageRelay(url, { method: ManagementMethod.ChangeRelayName, params: [name] }))

export const setRelayDescription = async (url: string, description: string): Promise<string> =>
    spaceIsBuzz(url)
        ? BUZZ_NO_META
        : manageError(await manageRelay(url, { method: ManagementMethod.ChangeRelayDescription, params: [description] }))

export const setRelayIcon = async (url: string, icon: string): Promise<string> =>
    spaceIsBuzz(url)
        ? await buzzSetIcon(url, icon)
        : manageError(await manageRelay(url, { method: ManagementMethod.ChangeRelayIcon, params: [icon] }))

export type BannedMember = { pubkey: string; npub: string; short: string; reason: string }

/**
 * Lädt die Ban-Liste frisch als Promise (kein Store-Cache).
 * zooid: NIP-86 `listbannedpubkeys`. Buzz: `GET /moderation/restricted`.
 */
export const loadBannedMembers = async (url: string): Promise<BannedMember[]> => {
    const rows = spaceIsBuzz(url)
        ? await buzzLoadRestricted(url)
        : (
              (await manageRelay(url, { method: ManagementMethod.ListBannedPubkeys, params: [] })) as {
                  result?: { pubkey: string; reason?: string }[]
              }
          ).result ?? []
    return rows.map(({ pubkey, reason }) => {
        const npub = nip19.npubEncode(pubkey)
        return { pubkey, npub, short: shortNpub(npub), reason: reason ?? '' }
    })
}

// ── Laden ────────────────────────────────────────────────────────────────────

/** Lädt die Mitglieder-Events (13534) vom Space-Relay. */
export const loadSpaceDirectory = (url: string): Promise<unknown> =>
    load({ relays: [url], filters: [{ kinds: [RELAY_MEMBERS] }] })

/** Live-Sub auf die 13534 — Member-Änderungen sofort sichtbar. */
export const listenSpaceDirectory = (url: string, signal: AbortSignal): void => {
    void request({ relays: [url], signal, filters: [{ kinds: [RELAY_MEMBERS], limit: 0 }] })
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
