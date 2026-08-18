/**
 * Profil-Herkunft: **das native Nostr-Profil gewinnt FELDWEISE, das Space-Profil
 * füllt nur Lücken.** Die Regeln stehen import-frei in [[profileMerge]]; hier steht
 * das Laufzeit-Drumherum: die zweite Quelle, ihr Store und die zwei Namen, die die
 * Anzeige-Module statt der welshman-Originale importieren.
 *
 * ── Drei Ebenen, jede mit eigener Aufgabe ──
 *
 * 1. **Repository bleibt sauber.** kind 0 vom Workspace-Relay kommt gar nicht hinein
 *    (`core.ts`, `netContext.isEventValid`), und was aus alten Sitzungen in der
 *    IndexedDB liegt, räumt {@link purgeSpaceLocalProfiles} weg. Grund unverändert:
 *    kind 0 ist ersetzbar, der jüngste Zeitstempel gewinnt, und das Space-Profil ist
 *    gemessen fast immer das jüngere.
 * 2. **Zweite, getrennte Quelle.** {@link loadSpaceProfiles} holt dieselben kind 0 mit
 *    einem request-lokalen `isEventValid` und legt sie in einem eigenen Store ab.
 * 3. **Merge erst beim Anzeigen.** {@link profilesByPubkey} und
 *    {@link displayProfileByPubkey} tragen absichtlich dieselben Namen wie ihre
 *    Vorbilder in `@welshman/app`: die Anzeige-Module tauschen nur den Import-Pfad,
 *    die Aufrufstellen bleiben, wie sie sind.
 *
 * **Ein gemergtes Profil ist ein ANZEIGE-Objekt.** Es wird nie signiert, nie
 * publiziert und nie ins Repository geschrieben. Wer ein Profil BEARBEITET, arbeitet
 * weiter mit `userProfile` aus `@welshman/app` (siehe `profiles.ts`).
 */
import { get, derived, writable, type Readable } from 'svelte/store'
import { profilesByPubkey as nativeProfilesByPubkey, deriveProfile, getProfile, repository, tracker, loadProfile } from '@welshman/app'
import { throttled } from '@welshman/store'
import { request } from '@welshman/net'
import { PROFILE, displayProfile, displayPubkey, profileHasName, readProfile, verifyEvent, type Profile, type TrustedEvent } from '@welshman/util'
import { mergeProfileForDisplay, newestByPubkey, sanitizeSpaceProfile, isSpaceLocalOnly } from './profileMerge.ts'

/**
 * Entfernt alle kind-0, die ausschließlich vom Workspace-Relay stammen, und stößt für
 * die betroffenen Pubkeys ein frisches `loadProfile` an (Outbox + Indexer-Fallback).
 * Liefert die Zahl der entfernten Profile — für Log/Test, nicht für die UI.
 *
 * **Bleibt trotz Merge, und zwar bewusst.** Der Merge passiert eine Ebene höher; im
 * Repository gäbe es weiterhin nur EIN kind 0 pro Pubkey, und ein aus einer älteren
 * Sitzung dort liegendes Space-Profil wäre fast immer das jüngere. Der Aufräumer hält
 * die native Quelle sauber, damit der Merge überhaupt etwas Echtes hat, das gewinnt.
 * Was er entfernt, ist seit dieser Änderung nicht mehr verloren: dieselben Profile
 * kommen über {@link loadSpaceProfiles} als Anzeige-Rückfallebene zurück.
 */
export const purgeSpaceLocalProfiles = (spaceUrl: string): number => {
    let removed = 0
    for (const event of repository.query([{ kinds: [PROFILE] }]) as TrustedEvent[]) {
        if (isSpaceLocalOnly(tracker.getRelays(event.id), spaceUrl)) {
            repository.removeEvent(event.id)
            void loadProfile(event.pubkey)
            removed++
        }
    }
    return removed
}

// ── Die zweite Quelle ───────────────────────────────────────────────────────

const spaceProfiles = writable<Map<string, Profile>>(new Map())

/** Space-lokale Profile (pubkey → Profil). Getrennt vom Repository, nur zum Anzeigen. */
export const spaceProfilesByPubkey: Readable<Map<string, Profile>> = { subscribe: spaceProfiles.subscribe }

/** Momentaufnahme für Funktionen ohne Store-Kontext ({@link displayProfileByPubkey}). */
export const getSpaceProfile = (pubkey: string): Profile | undefined => get(spaceProfiles).get(pubkey)

const HEX64 = /^[0-9a-f]{64}$/
/** Ein REQ trägt höchstens so viele Autoren — dieselbe Blockgröße wie der Backend-Cache. */
const CHUNK = 100
/**
 * Not-Aus für eine Runde. Nicht bloß Vorsicht: hängt die NIP-42-Runde, verschluckt
 * welshman EOSE **und** CLOSED — ohne Frist löste die Zusage nie auf, und Buzz
 * verlangt AUTH für jedes REQ (gemessen: ohne Signer `auth-required: not
 * authenticated`, also bleibt die Fläche für Anonyme bei der npub-Initiale).
 */
const REQUEST_TIMEOUT_MS = 8000

/** Schon angefragt (`url|pubkey`) — ein zweiter Anlauf brächte dasselbe Ergebnis. */
const requested = new Set<string>()

/**
 * kind 0 vom Space-Relay holen, **ohne** sie ins Repository zu lassen.
 *
 * Der Riegel gegen Verdrängung sitzt in `core.ts` an `netContext.isEventValid` und
 * greift socket-weit — er wirkt also auch für diesen Aufruf und muss hier nicht
 * wiederholt werden. `request()` erlaubt daneben ein **request-lokales**
 * `isEventValid`, das nur an den eigenen Aufrufer ausliefert (`@welshman/net`,
 * `requestOne`: `options.isEventValid || netContext.isEventValid`). Diese Trennung ist
 * der ganze Trick: die Events kommen bei uns an und trotzdem nicht ins Repository.
 *
 * Zwei Fallen, die hier bewusst adressiert sind:
 * - **`load()` statt `request()` funktionierte NICHT.** `makeLoader` reicht nur die
 *   LOADER-Optionen an `requestOne` weiter (`@welshman/net` `request.js:198`); ein
 *   `isEventValid` am einzelnen Aufruf fiele dort unter den Tisch, und der
 *   Kontext-Riegel verwürfe die Events wieder.
 * - **`isEventValid: () => true` wäre falsch** — das ersetzte auch die
 *   Signaturprüfung, und ein Relay könnte ein kind 0 für einen fremden Pubkey
 *   unterschieben. Es bleibt bei `verifyEvent`.
 *
 * `dropSelfHostedMedia` entscheidet der AUFRUFER und nicht dieses Modul: die
 * Buzz-Erkennung (`spaceIsBuzzAsync`, `buzzAdmin.ts`) hängt an einer Kette
 * endungsloser Importe und machte jedes Modul, das hier importiert, unter
 * `node --test` unladbar — genau die Falle, die `spaceCaps.ts` in seinem Modulkopf
 * beschreibt. Beide heutigen Aufrufer sprechen ohnehin mit einem Buzz-Relay und
 * übergeben `true`; siehe {@link sanitizeSpaceProfile} für den gemessenen Grund.
 */
export const loadSpaceProfiles = async (
    spaceUrl: string,
    pubkeys: Iterable<string>,
    dropSelfHostedMedia: boolean,
): Promise<number> => {
    if (!spaceUrl) {
        return 0
    }
    const fresh = [...new Set(pubkeys)].filter((pk) => HEX64.test(pk) && !requested.has(`${spaceUrl}|${pk}`))
    if (fresh.length === 0) {
        return 0
    }
    // VOR dem Warten merken: sonst schickt jeder Re-Derive dieselbe Runde noch einmal.
    fresh.forEach((pk) => requested.add(`${spaceUrl}|${pk}`))

    let added = 0
    for (let i = 0; i < fresh.length; i += CHUNK) {
        const authors = fresh.slice(i, i + CHUNK)
        let events: TrustedEvent[] = []
        try {
            events = (await request({
                relays: [spaceUrl],
                filters: [{ kinds: [PROFILE], authors }],
                autoClose: true,
                signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
                isEventValid: (event: TrustedEvent) => verifyEvent(event),
            })) as TrustedEvent[]
        } catch {
            // Relay weg, AUTH abgelehnt, Zeit abgelaufen: die Fläche bleibt bei dem,
            // was das native Profil hergibt. Ein Anzeige-Zusatz darf nichts umwerfen.
            continue
        }
        if (events.length === 0) {
            continue
        }
        spaceProfiles.update((current) => {
            const next = new Map(current)
            for (const [pubkey, event] of newestByPubkey(events)) {
                const previous = next.get(pubkey)?.event
                if (previous && previous.created_at >= event.created_at) {
                    continue
                }
                next.set(pubkey, sanitizeSpaceProfile(readProfile(event), spaceUrl, dropSelfHostedMedia))
                added++
            }
            return next
        })
    }
    return added
}

// ── Was die Anzeige-Module importieren ──────────────────────────────────────

/**
 * Wie `profilesByPubkey` aus `@welshman/app`, nur gemergt.
 *
 * Die native Seite ist **innen** gedrosselt: `deriveItemsByKey` feuert pro
 * eingetroffenem Profil-Event, und jeder Emit kostet hier eine Kopie der Map. Ohne
 * die Drosselung an dieser Stelle liefe das Befüllen eines großen Raums quadratisch —
 * die Aufrufer drosseln zwar auch, aber erst NACH dieser Rechnung.
 *
 * Ohne ein einziges Space-Profil wird die native Map unverändert durchgereicht: kein
 * Kopieren, keine neue Identität, exakt das bisherige Verhalten.
 */
export const profilesByPubkey: Readable<Map<string, Profile>> = derived(
    [throttled(200, nativeProfilesByPubkey), spaceProfiles],
    ([$native, $local]: [Map<string, Profile>, Map<string, Profile>]) => {
        if ($local.size === 0) {
            return $native
        }
        const merged = new Map($native)
        for (const [pubkey, local] of $local) {
            const value = mergeProfileForDisplay($native.get(pubkey), local)
            if (value) {
                merged.set(pubkey, value)
            }
        }
        return merged
    },
)

/**
 * Wie `displayProfileByPubkey` aus `@welshman/app`, nur mit dem Space-Profil als
 * Rückfallebene. Reihenfolge: nativer Name → Space-Name → gekürzte npub.
 *
 * Achtung beim Einsatz in abgeleiteten Flächen: das ist eine FUNKTION, kein Store.
 * Sie zieht nur nach, wenn die umgebende Ableitung ohnehin neu rechnet — deshalb
 * hängen die Listen-Flächen zusätzlich an {@link profilesByPubkey}.
 */
export const displayProfileByPubkey = (pubkey: string): string => {
    if (!pubkey) {
        return ''
    }
    const native = getProfile(pubkey)
    if (profileHasName(native)) {
        return displayProfile(native, displayPubkey(pubkey))
    }
    const local = getSpaceProfile(pubkey)
    if (profileHasName(local)) {
        return displayProfile(local, displayPubkey(pubkey))
    }
    return displayProfile(native, displayPubkey(pubkey))
}

/** Natives + Space-Profil eines Pubkeys als EIN Anzeige-Objekt (Momentaufnahme). */
export const getMergedProfile = (pubkey: string): Profile | undefined =>
    mergeProfileForDisplay(getProfile(pubkey), getSpaceProfile(pubkey))

/**
 * Wie `deriveProfile` aus `@welshman/app`, nur gemergt — für Flächen, die EIN Profil
 * zeigen statt einer Liste (Profilkarte, eigenes Profil im Kopf).
 *
 * `deriveProfile` stößt nebenbei `loadProfile` an; das bleibt so, weil das native
 * Profil weiterhin die Hauptquelle ist. Das Space-Profil kommt nur dazu, wenn es
 * ohnehin schon geladen wurde — dieser Store fragt von sich aus **nichts** an.
 */
export const deriveMergedProfile = (pubkey: string): Readable<Profile | undefined> =>
    derived([deriveProfile(pubkey), spaceProfiles], ([$native, $local]: [Profile | undefined, Map<string, Profile>]) =>
        mergeProfileForDisplay($native, $local.get(pubkey)),
    )
