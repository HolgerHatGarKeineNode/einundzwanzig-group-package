/**
 * Kanal-Präferenzen aus **Buzz Desktop** lesen (NIP-78, kind 30078) — die unreine
 * Hälfte: Filter, Entschlüsselung, Stores. Das Parsen und Mergen liegt in
 * `channelPrefsData.ts` und läuft dort unter `node --test`.
 *
 * The model is `readStateSync.ts`: same kind, same crypto (nip44 to self), same
 * fail-soft promise.
 *
 * ── Both directions since P4 — but only TWO of the four blobs ──────────────
 *
 * Until P4 this module only READ, and the paragraph here said so: preferences were
 * set in Buzz Desktop. Since P4 muting and starring a room are set HERE as well,
 * through {@link toggleChannelFlag} → {@link publishChannelFlags}.
 *
 * **Written are `channel-stars` and `channel-mutes`, never `channel-sections` or
 * `channel-sort`.** The first two merge per channel over `updatedAt`, the other two
 * are whole-blob LWW — writing one of them would replace the section layout and the
 * channel sorting the user set in Buzz Desktop wholesale. The prohibition is not a
 * rule of this file but a return value: `planChannelPrefsPublish` hands out no plan
 * for the two blob tags, and this module has no other way to build an event.
 *
 * The write path is bound to the same workspace as the read path — the `d` tags
 * describe Buzz channels, and a room of the zooid space has no preference here.
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
import { ensurePlaintext, nip44EncryptToSelf, pubkey } from './welshmanSession.ts'
import { app, Thunks, waitForThunkCompletion } from './welshmanApp.ts'
import { PublishStatus } from '@welshman/net'
import { load, request } from './welshmanNet.ts'
import { makeEvent, type TrustedEvent } from '@welshman/util'
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
    anyRelayAccepted,
    applyBlob,
    decideChannelPrefsPublish,
    flaggedIds,
    mergeFlags,
    parseChannelPrefsContent,
    publishEpochUnchanged,
    setFlag,
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

/**
 * Counts every arm/disarm. A publish captures it before its first `await` and drops
 * out if it changed — otherwise a publish still in flight during an identity switch
 * would encrypt the NEW user's (empty) store with the NEW user's signer and wipe the
 * preferences of whoever just logged in.
 */
let armEpoch = 0

/** Newest `created_at` seen at the relay, per `d` tag — the basis of the bump. */
const remoteHead = new Map<string, number>()
/** Payload that at least one relay has confirmed, per `d` tag. */
const publishedJson = new Map<string, string>()
/** Kinds changed locally since their last confirmed publish. */
const dirty = new Set<ChannelFlagKind>()
const publishTimers = new Map<ChannelFlagKind, ReturnType<typeof setTimeout>>()
const publishInFlight = new Map<ChannelFlagKind, Promise<void>>()

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
    // The write state is personal too, and it is the dangerous half: a `remoteHead`
    // or a `publishedJson` carried over from the previous identity would make the
    // next publish of the NEW user either unreplaceable or a silent no-op.
    armEpoch += 1
    remoteHead.clear()
    publishedJson.clear()
    dirty.clear()
    for (const timer of publishTimers.values()) {
        clearTimeout(timer)
    }
    publishTimers.clear()
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
    // The relay head is recorded from the RAW event, before the decryption gate —
    // exactly where Buzz records it (`channelMutesSync.ts:126-127`). An event we
    // cannot read still occupies the address, and our next write has to outrank it.
    if (event.created_at > (remoteHead.get(dTag) ?? 0)) {
        remoteHead.set(dTag, event.created_at)
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

// ── Write half (P4) ─────────────────────────────────────────────────────────

/** Which of the two WRITABLE blobs a call means. */
export type ChannelFlagKind = 'stars' | 'mutes'

const D_FOR: Readonly<Record<ChannelFlagKind, string>> = {
    stars: D_CHANNEL_STARS,
    mutes: D_CHANNEL_MUTES,
}

const storeFor = (kind: ChannelFlagKind): Writable<FlagStore> =>
    kind === 'stars' ? channelStars : channelMutes

const nowSec = (): number => Math.floor(Date.now() / 1000)

/**
 * Publish delay: **2 s**, and the number is Buzz' own (`channelMutesSync.ts:23`).
 *
 * `readStateSync.ts` waits 30 s for the same kind on the same relay, and that is right
 * there and wrong here: a read watermark is worth nothing to look at, a mute is
 * something the user just clicked and might reload one second later. A 30 s window
 * would make the preference disappear on that reload — the exact failure this phase
 * exists to remove.
 *
 * The window starts at the FIRST change and is not reset by further ones (the rule of
 * `readStateSync.ts schedulePublish`): a user flipping several rooms in a row would
 * otherwise be able to postpone the publish indefinitely.
 */
export const PUBLISH_DEBOUNCE_MS = 2_000

/**
 * Fetch our own blob from the relay and merge it in BEFORE publishing — Buzz does the
 * same (`channelMutesSync.ts fetchOwnBlobBeforePublish`), and without it the per-channel
 * merge would be a promise this client cannot keep.
 *
 * The case: a second device muted a DIFFERENT channel a moment ago and its event has
 * not reached our live subscription yet. Publishing our own store then replaces the
 * address and drops the other statement — kind 30078 is addressable, there is no union
 * on the relay. With the pre-fetch the foreign entry runs through {@link applyEvent}
 * and thus through `mergeFlags`, and the published store carries both.
 *
 * Fail-soft in Buzz' direction: a failing fetch keeps the local store as the merge base
 * instead of blocking the write.
 */
const mergeOwnBlobBeforePublish = async (pk: string): Promise<void> => {
    try {
        const events: TrustedEvent[] = await load({ relays: [WORKSPACE_URL], filters: [prefsFilter(pk)] })
        for (const event of events) {
            await applyEvent(pk, event)
        }
    } catch (error) {
        warnOnce(error)
    }
}

/**
 * Publish one of the two writable blobs, if it changed since the last confirmed write.
 *
 * Order: merge the relay's copy in → plan → encrypt → publish → remember. The plan is
 * where `sections`/`sort` are refused; this function has no other way to build an event.
 *
 * **No retry loop.** Same decision as `readStateSync.ts publishReadState`: a permanently
 * refusing relay would otherwise be re-asked every couple of seconds forever. A failed
 * publish keeps its {@link dirty} mark instead, so the next tab switch retries it once —
 * bounded by user action, not by a timer.
 *
 * The publish itself carries welshman's own abort after 30 s
 * (`@welshman/app thunk.js:186,207`), so a Buzz rate limiter that answers with NOTICE
 * instead of OK cannot park this promise forever.
 */
export const publishChannelFlags = async (kind: ChannelFlagKind): Promise<void> => {
    const running = publishInFlight.get(kind)
    if (running) {
        return running
    }
    const pk = pubkey.get() ?? ''
    if (!dirty.has(kind) || !pk || armedFor !== `${pk}|${WORKSPACE_URL}`) {
        return
    }
    const epoch = armEpoch
    const dTag = D_FOR[kind]
    const run = (async (): Promise<void> => {
        try {
            await mergeOwnBlobBeforePublish(pk)
            // Everything that can be decided WITHOUT a relay is decided in the pure half,
            // where a `node --test` can ask about it — including the two skips no browser
            // test can produce (`stale`, `not-writable`).
            const decision = decideChannelPrefsPublish({
                dTag,
                store: get(storeFor(kind)),
                nowSec: nowSec(),
                remoteHead: remoteHead.get(dTag) ?? 0,
                lastPublishedJson: publishedJson.get(dTag),
                capturedEpoch: epoch,
                currentEpoch: armEpoch,
            })
            if (!decision.go) {
                // `stale` keeps the pending mark: the store this publish was about belongs
                // to an identity that is no longer here, and the mark is per kind, not per
                // identity — `resetStores` has already cleared it.
                if (decision.reason !== 'stale') {
                    dirty.delete(kind)
                }

                return
            }
            const { plan } = decision
            const content = await nip44EncryptToSelf(plan.json)
            // Asked a SECOND time: the signer round trip is the longer of the two awaits,
            // and at NIP-46 it is a relay round trip on someone else's machine.
            if (!publishEpochUnchanged(epoch, armEpoch)) {
                return
            }
            const thunk = app.use(Thunks).publish({
                event: makeEvent(APP_DATA, { content, tags: plan.tags, created_at: plan.createdAt }),
                relays: [WORKSPACE_URL],
            })
            await waitForThunkCompletion(thunk)
            if (!anyRelayAccepted(thunk.results, PublishStatus.Success)) {
                return // stays dirty — the next tab switch tries once more
            }
            publishedJson.set(dTag, plan.json)
            remoteHead.set(dTag, Math.max(remoteHead.get(dTag) ?? 0, plan.createdAt))
            dirty.delete(kind)
        } catch (error) {
            // No signer, no network, a refused encryption: fail-soft like every other
            // path in this module. The local store keeps carrying the display.
            warnOnce(error)
        } finally {
            publishInFlight.delete(kind)
        }
    })()
    publishInFlight.set(kind, run)

    return run
}

const schedulePublish = (kind: ChannelFlagKind): void => {
    if (publishTimers.has(kind)) {
        return
    }
    publishTimers.set(kind, setTimeout(() => {
        publishTimers.delete(kind)
        void publishChannelFlags(kind)
    }, PUBLISH_DEBOUNCE_MS))
}

/**
 * Set or clear the flag of ONE channel and schedule the publish.
 *
 * The local store is written first and the network follows — the switch has to answer
 * within the frame, and a preference that only appears after a relay round trip reads
 * as broken. The relay's answer cannot contradict it either: our entry carries a fresh
 * `updatedAt` and wins every per-channel merge against the older remote one.
 *
 * Silently does nothing without an armed workspace: the preferences are Buzz' blobs,
 * and a room of the zooid space has no place in them (the standing one-workspace
 * decision, see {@link arm}).
 */
export const setChannelFlag = (kind: ChannelFlagKind, h: string, on: boolean): void => {
    const pk = pubkey.get() ?? ''
    if (h === '' || pk === '' || armedFor !== `${pk}|${WORKSPACE_URL}`) {
        return
    }
    const store = storeFor(kind)
    store.set(setFlag(get(store), h, on, nowSec()))
    dirty.add(kind)
    schedulePublish(kind)
}

/**
 * Flip the flag of one channel — **the entry point of both room lists** (the rail and
 * the mobile channel list). Reading the current value here rather than in each island
 * keeps the two surfaces from growing their own idea of what "already muted" means.
 */
export const toggleChannelFlag = (kind: ChannelFlagKind, h: string): void => {
    setChannelFlag(kind, h, !(get(storeFor(kind)).channels[h]?.on ?? false))
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
    //
    // The other direction is the flush of the write half: a tab that goes away must not
    // swallow the last toggle. Gated on {@link dirty}, so an ordinary app switch costs
    // nothing — without that gate every `hidden` would pay for two REQs and two
    // decryptions in `mergeOwnBlobBeforePublish`, for a store nobody touched.
    if (typeof document !== 'undefined') {
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden') {
                void publishChannelFlags('stars')
                void publishChannelFlags('mutes')

                return
            }
            if (isBuzz && pk) {
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
