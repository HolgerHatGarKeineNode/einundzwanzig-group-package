/**
 * Kanal-Präferenzen aus **Buzz Desktop** lesen (NIP-78, kind 30078) — die unreine
 * Hälfte: Filter, Entschlüsselung, Stores. Das Parsen und Mergen liegt in
 * `channelPrefsData.ts` und läuft dort unter `node --test`.
 *
 * Vorbild ist `readStateSync.ts`: dasselbe kind, dasselbe Krypto-Verfahren
 * (nip44 an sich selbst), dieselbe Fail-Soft-Zusage. Der Unterschied ist die
 * Richtung — hier wird **nur gelesen**. Gesetzt werden die Präferenzen weiterhin
 * in Buzz Desktop; das ist die Entscheidung des Plans, kein fehlendes Stück.
 *
 * ── Vier `d`-Tags, EIN Filter ──
 *
 * `{kinds:[30078], authors:[me], "#d":[…vier…], limit:4}`. Vier eigene
 * Subscriptions wären vier REQs für vier Events, die ohnehin zusammen ankommen.
 * `limit:4` ist exakt der Bestand: kind 30078 ist adressierbar, je `d`-Tag hält
 * das Relay genau eins.
 *
 * ── Warum ein `writable` je `d`-Tag und kein `derived` ──
 *
 * `ensurePlaintext` ist **asynchron** (NIP-46/Amber ist ein Relay-Roundtrip, kein
 * lokaler Aufruf) und kann deshalb nicht im Callback eines `derived` liegen — der
 * müsste synchron einen Wert liefern. Der Weg ist deshalb: `deriveEventsForUrl`
 * meldet neue Events → ein asynchroner Durchlauf entschlüsselt und parst →
 * das Ergebnis geht in den `writable` des jeweiligen `d`-Tags → die UI liest den
 * `writable`. Zwischenstand ist nie „leer", sondern immer der letzte gute Stand.
 *
 * ── Kein eigenes Krypto ──
 *
 * Entschlüsselt wird ausschließlich über `ensurePlaintext(event)` aus
 * `@welshman/app`. Es zieht den Signer der Session und entschlüsselt gegen
 * `event.pubkey` — bei `authors:[me]` also gegen den eigenen Schlüssel, exakt das
 * Gegenstück zu Buzz' `nip44_decrypt_from_self`
 * (`buzz/desktop/src-tauri/src/commands/identity.rs:689-700`, dort
 * `nip44::decrypt(keys.secret_key(), &keys.public_key(), …)`). Nachgeprüft, nicht
 * angenommen: die beiden Seiten leiten denselben Conversation-Key ab.
 */
import { derived, get, writable, type Readable, type Writable } from 'svelte/store'
import { ensurePlaintext, pubkey } from './welshmanSession.ts'
import { load, request } from '@welshman/net'
import { type TrustedEvent } from '@welshman/util'
import { APP_DATA } from './welshmanKinds.ts'
import { tagSpec, tagValue } from './welshmanTags.ts'
import { WORKSPACE_URL, deriveSpaceKind, hasWorkspace } from './spaceCaps.ts'
import { deriveEventsForUrl } from './repository.ts'
import {
    CHANNEL_PREFS_D,
    D_CHANNEL_MUTES,
    D_CHANNEL_SECTIONS,
    D_CHANNEL_SORT,
    D_CHANNEL_STARS,
    EMPTY_FLAGS,
    EMPTY_SECTIONS,
    EMPTY_SORT,
    applyBlob,
    flaggedIds,
    mergeFlags,
    parseChannelPrefsContent,
    sortModeForGroup,
    toWorkspaceSections,
    type Dated,
    type FlagStore,
    type SectionsStore,
    type SortStore,
} from './channelPrefsData.ts'
import type { WorkspacePrefs } from './railGroups.ts'

/**
 * Mindestpause zwischen zwei Nachladeversuchen — 30 s, dieselbe Zahl und dieselbe
 * Begründung wie `readStateSync.ts RELOAD_MIN_INTERVAL_MS`: ein Nutzer, der im
 * Sekundentakt zwischen Apps wechselt, darf keine REQ-Flut auslösen. Der Preis
 * ist eine bis zu 30 s alte Sidebar-Präferenz — deutlich unter der Zeit, die ein
 * Gerätewechsel braucht.
 */
export const RELOAD_MIN_INTERVAL_MS = 30_000

// ── Die vier Stores, einer je `d`-Tag ───────────────────────────────────────

/** `channel-sections` — Sektionen und ihre Kanal-Zuordnung (Whole-Blob-LWW). */
export const channelSections: Writable<SectionsStore> = writable(EMPTY_SECTIONS)
/** `channel-sort` — Sortiermodus je Sidebar-Gruppe (Whole-Blob-LWW). */
export const channelSort: Writable<SortStore> = writable(EMPTY_SORT)
/** `channel-stars` — angeheftete Kanäle (Merge **pro Kanal** über `updatedAt`). */
export const channelStars: Writable<FlagStore> = writable(EMPTY_FLAGS)
/** `channel-mutes` — stummgeschaltete Kanäle (Merge **pro Kanal** über `updatedAt`). */
export const channelMutes: Writable<FlagStore> = writable(EMPTY_FLAGS)

/** Die `h` der angehefteten Räume. */
export const pinnedRoomIds: Readable<string[]> = derived(channelStars, flaggedIds)

/** Die `h` der stummgeschalteten Räume. */
export const mutedRoomIds: Readable<string[]> = derived(channelMutes, flaggedIds)

/**
 * Alles, was die Raumlisten über den Workspace wissen müssen, in EINEM Store —
 * damit jede Fläche ein Abo führt statt vier und nicht bei jedem der vier Events
 * die Gruppen dreimal zusätzlich neu baut.
 *
 * Die Gruppen-Schlüssel sind Buzz': `channels` für die normalen Zeilen, `starred`
 * für die angehefteten (`AppSidebar.tsx:420,432`), `section:<id>` je Sektion.
 *
 * **Nicht direkt abonnieren — {@link subscribeWorkspacePrefs} nehmen.** Ein Abo auf
 * diesen Store allein liefert ewig die leeren Startwerte, weil niemand den Netzweg
 * scharfgeschaltet hat.
 */
export const workspacePrefs: Readable<WorkspacePrefs> = derived(
    [pinnedRoomIds, mutedRoomIds, channelSort, channelSections],
    ([pinned, muted, sort, sections]): WorkspacePrefs => ({
        pinned,
        muted,
        sort: sortModeForGroup(sort, 'channels'),
        pinnedSort: sortModeForGroup(sort, 'starred'),
        sections: toWorkspaceSections(sections, sort),
    }),
)

// ── Netz ────────────────────────────────────────────────────────────────────

/** Bestand der Blobs mit ihrer Herkunftszeit — Grundlage der Whole-Blob-LWW. */
let sectionsHead: Dated<SectionsStore> | null = null
let sortHead: Dated<SortStore> | null = null

/**
 * Bereits erfolgreich entschlüsselte Events (`event.id`). Verhindert, dass jede
 * Repository-Aktualisierung denselben Signer erneut behelligt — bei NIP-46 wäre
 * das je Aktualisierung ein Relay-Roundtrip.
 *
 * **Eingetragen wird NUR nach erfolgreicher Entschlüsselung.** Beim Boot kann der
 * Signer noch fehlen (`ensurePlaintext` liefert dann ohne Fehler `undefined`);
 * würde das Event trotzdem als erledigt vermerkt, blieben die Präferenzen für die
 * ganze Sitzung aus — sichtbar als „Buzz zeigt es, wir nicht", ohne jede Meldung.
 */
const decrypted = new Set<string>()
/** Läuft gerade ein Durchlauf für dieses Event? Schützt vor Doppelaufrufen. */
const inFlight = new Set<string>()

let started = false
let armedFor = ''
let controller: AbortController | null = null
let unsubEvents: (() => void) | null = null
let lastLoadAt = 0
let warned = false

const warnOnce = (error: unknown): void => {
    if (!warned) {
        warned = true
        console.warn('[channelprefs] Kanal-Präferenzen konnten nicht gelesen werden', error)
    }
}

/** Alles zurück auf Anfang — beim Identitätswechsel Pflicht, nicht Kosmetik. */
const resetStores = (): void => {
    sectionsHead = null
    sortHead = null
    decrypted.clear()
    inFlight.clear()
    channelSections.set(EMPTY_SECTIONS)
    channelSort.set(EMPTY_SORT)
    channelStars.set(EMPTY_FLAGS)
    channelMutes.set(EMPTY_FLAGS)
}

const prefsFilter = (pk: string) => ({
    kinds: [APP_DATA],
    authors: [pk],
    '#d': [...CHANNEL_PREFS_D],
    limit: CHANNEL_PREFS_D.length,
})

/**
 * Ein Event entschlüsseln, parsen und in den passenden Store schreiben.
 *
 * Riegel pro Zeile statt eines `try` außen herum (wie
 * `readStateSync.ts loadRemoteReadState`): Autor, Kind und `d`-Tag werden einzeln
 * geprüft. Ein Relay, das auf einen `authors`-Filter etwas Fremdes zurückgibt,
 * ist damit folgenlos — und ein fremdes `d` am selben kind (unser eigener
 * Lesestand `einundzwanzig/read-state/v1`, Buzz' `read-state:<slotId>`) fällt
 * hier heraus, nicht erst im Parser.
 */
const applyEvent = async (pk: string, event: TrustedEvent): Promise<void> => {
    if (event.kind !== APP_DATA || event.pubkey !== pk) {
        return
    }
    const dTag = tagValue(tagSpec('d'), event.tags)
    if (!dTag || !CHANNEL_PREFS_D.includes(dTag)) {
        return
    }
    if (decrypted.has(event.id) || inFlight.has(event.id)) {
        return
    }
    inFlight.add(event.id)
    let plaintext: string | undefined
    try {
        plaintext = await ensurePlaintext(event)
    } catch (error) {
        // Fremder Schlüssel, kaputte Nutzlast, abgelehnte Signer-Anfrage: genau
        // dieses Event überspringen, den Rest des Durchlaufs nicht abbrechen.
        warnOnce(error)
        return
    } finally {
        inFlight.delete(event.id)
    }
    if (plaintext === undefined) {
        return // kein Signer (noch nicht) — bewusst NICHT als erledigt vermerken
    }
    decrypted.add(event.id)

    const parsed = parseChannelPrefsContent(dTag, plaintext)
    // `parsed === null` heißt: unlesbar. Dann bleibt der bisherige Stand stehen —
    // eine kaputte Nutzlast darf die Sidebar nie leeren (siehe `channelPrefsData.ts`).
    switch (dTag) {
        case D_CHANNEL_SECTIONS: {
            const next = applyBlob(sectionsHead, parsed ? { store: parsed as SectionsStore, createdAt: event.created_at } : null)
            if (next !== sectionsHead) {
                sectionsHead = next
                channelSections.set(next?.store ?? EMPTY_SECTIONS)
            }
            break
        }
        case D_CHANNEL_SORT: {
            const next = applyBlob(sortHead, parsed ? { store: parsed as SortStore, createdAt: event.created_at } : null)
            if (next !== sortHead) {
                sortHead = next
                channelSort.set(next?.store ?? EMPTY_SORT)
            }
            break
        }
        case D_CHANNEL_STARS:
            channelStars.set(mergeFlags(get(channelStars), parsed as FlagStore | null))
            break
        case D_CHANNEL_MUTES:
            channelMutes.set(mergeFlags(get(channelMutes), parsed as FlagStore | null))
            break
    }
}

/** Bestand holen; gedrosselt, damit ein App-Wechsel im Sekundentakt keine REQ-Flut auslöst. */
const loadPrefs = (pk: string, force = false): void => {
    const now = Date.now()
    if (!force && now - lastLoadAt < RELOAD_MIN_INTERVAL_MS) {
        return
    }
    lastLoadAt = now
    void load({ relays: [WORKSPACE_URL], filters: [prefsFilter(pk)] }).catch(warnOnce)
}

/**
 * Für DIESE Identität scharfschalten: Bestand laden, live weiterhören, und die
 * Repository-Sicht auf den Workspace-Relay abonnieren.
 *
 * `deriveEventsForUrl` liest **relay-gebunden** (über den tracker), nicht global:
 * ein 30078 mit demselben `d`-Tag von einem anderen Relay des Nutzers — etwa
 * unser eigener Lesestand aus `readStateSync.ts`, der an Outbox UND Space geht —
 * kann hier nicht hereinlaufen.
 */
const arm = (pk: string): void => {
    const key = `${pk}|${WORKSPACE_URL}`
    if (armedFor === key) {
        return
    }
    armedFor = key
    controller?.abort()
    unsubEvents?.()
    resetStores()

    unsubEvents = deriveEventsForUrl(WORKSPACE_URL, [prefsFilter(pk)]).subscribe((events: TrustedEvent[]) => {
        for (const event of events) {
            void applyEvent(pk, event).catch(warnOnce)
        }
    })

    controller = new AbortController()
    loadPrefs(pk, true)
    void request({
        relays: [WORKSPACE_URL],
        signal: controller.signal,
        filters: [{ ...prefsFilter(pk), limit: 0 }],
    }).catch(warnOnce)
}

const disarm = (): void => {
    armedFor = ''
    controller?.abort()
    controller = null
    unsubEvents?.()
    unsubEvents = null
    resetStores()
}

/**
 * Idempotenter Einstieg. Tut nichts ohne konfigurierten Workspace
 * ({@link hasWorkspace}, synchron und ohne Netz) und nichts ohne angemeldete
 * Identität — die Präferenzen sind persönlich und verschlüsselt.
 *
 * **Die zweite Ebene ist `deriveSpaceKind`.** Losgelaufen wird erst, wenn der
 * Workspace-Relay sich als Buzz zu erkennen gegeben hat; `'unknown'` heißt
 * warten, nicht „nein" (genau die Mount-Falle, die `spaceCaps.ts` auflöst). Der
 * Preis ist benannt: fällt NIP-11 nach allen Wiederholungen auf `'other'`, laden
 * wir die Präferenzen nicht — dann ist der Relay aber ohnehin nicht erreichbar,
 * und eine REQ hätte auch nichts gebracht.
 *
 * **Aufgerufen wird das aus jeder Fläche, die die Präferenzen anzeigt** — über
 * {@link subscribeWorkspacePrefs}, nicht aus `core.ts` oder `index.ts`.
 *
 * Bis P7 stand der Aufruf allein in der Rail (`rail.ts init()`), und die Rail gibt
 * es erst ab `xl`: auf dem Telefon lief der Netzweg nie. Seit P7 wendet auch die
 * Bühne (Tab „Workspaces" in `⚡spaces.blade.php`) die Präferenzen an, es gibt also
 * zwei Konsumentinnen. Der naheliegende Umzug nach `core.ts` wäre trotzdem falsch:
 * `core.ts` läuft beim Modulladen auf JEDER Seite — auch auf `/articles`,
 * `/verein`, `/updates`, wo keine der beiden Flächen existiert. Der Netzweg hinge
 * dann am Seitenaufruf statt am Empfänger.
 *
 * Gebunden ist er deshalb an den ERSTEN ABONNENTEN (dasselbe Muster, mit dem
 * `spaceCaps.ts` sein `forceLoadRelay` auslöst): keine Fläche → kein Abo → kein
 * REQ. Auf einem Gerät ohne jede Präferenz-Fläche bleibt es damit bei null
 * Netzverkehr, ohne dass irgendwo eine Breakpoint-Bedingung dupliziert wird.
 */
export function initChannelPrefs(): void {
    if (started || !hasWorkspace()) {
        return
    }
    started = true

    let isBuzz = false
    let pk = ''

    const reevaluate = (): void => {
        if (isBuzz && pk) {
            arm(pk)
        } else if (armedFor !== '') {
            disarm()
        }
    }

    try {
        deriveSpaceKind(WORKSPACE_URL).subscribe((kind) => {
            isBuzz = kind === 'buzz'
            reevaluate()
        })
        // Der Identitätswechsel MUSS die Stores leeren: die Blobs sind persönlich,
        // und eine stehengebliebene Stummschaltung des Vorbesitzers wäre eine
        // Aussage über Räume, die der neue Nutzer nie getroffen hat.
        pubkey.subscribe((next: string | undefined) => {
            pk = next ?? ''
            reevaluate()
        })
    } catch (error) {
        warnOnce(error)
    }

    // Rückweg aus dem Hintergrund: in Buzz Desktop gesetzte Präferenzen sollen nach
    // einem Tab-Wechsel da sein, nicht erst nach einem Neustart. Dieselbe Stelle,
    // an der `readStateSync.ts` seinen Fremdstand nachlädt.
    if (typeof document !== 'undefined') {
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible' && isBuzz && pk) {
                loadPrefs(pk)
            }
        })
    }
}

/**
 * **Der einzige Einstieg für eine Fläche**: schaltet den Netzweg scharf (idempotent,
 * siehe {@link initChannelPrefs}) und abonniert {@link workspacePrefs}. Gibt den
 * Abmelder zurück — die Fläche ruft ihn in `destroy()`.
 *
 * Beide Konsumentinnen gehen hier durch: die Rail (`rail.ts`, ab `xl`) und die
 * Bühne (`nostrSpaces` in `bridge.ts`, auf jedem Viewport). Damit steht die
 * Bedingung „lädt nur, wenn es einen Empfänger gibt" an EINER Stelle statt in
 * zwei Inseln — und sie steht dort, wo sie geprüft werden kann.
 *
 * Der Netzweg selbst bleibt modulweit stehen (er überlebt `wire:navigate`); das
 * Abmelden löst nur dieses eine Abo, nicht die Subscription am Relay. Das ist
 * gewollt: zwischen zwei Seiten eines Klicks denselben REQ neu aufzuziehen kostet
 * mehr, als er einbringt.
 */
export const subscribeWorkspacePrefs = (listener: (prefs: WorkspacePrefs) => void): (() => void) => {
    initChannelPrefs()

    return workspacePrefs.subscribe(listener)
}
