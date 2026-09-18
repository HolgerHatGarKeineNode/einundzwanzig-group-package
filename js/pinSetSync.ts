/**
 * `$store.pinSet` — „Angeheftet" (D7/D8), the impure half: relays, decryption, stores.
 *
 * The rules (keys, merge, tombstones, caps, the publish decision, the Buzz fork) live in
 * `js/pinSet.ts` and run there under `node --test`. What is left here is what genuinely
 * needs welshman: reading per relay with an `EOSE` verdict of its own, decrypting through
 * the session signer, publishing, and the guest's local set.
 *
 * ── The one promise of this file: never write a set we have not seen ────────────
 *
 * kind 30078 is addressable — one event per `d` per author, every write replaces the whole
 * payload. Writing it from an incomplete picture deletes every pin made elsewhere. welshman
 * ships that failure in its list plugins (`forceLoad` → `undefined` → a writer with one
 * entry, no signal on the way out; measured, memory `welshman-forceload-schreibt-leere-liste`),
 * so nothing here goes through them.
 *
 * Instead: {@link readPinSet} asks EVERY target relay with `requestOne` and reports whether
 * at least one closed the read with an `EOSE`; `decidePinPublish` refuses to build an event
 * without that verdict. Fail-closed on purpose — a refused pin costs one tap, a pin written
 * blind costs the whole set.
 *
 * ── The relay set is FIXED, and it is not `activeSpace` ────────────────────────
 *
 * The user's NIP-65 **write** relays plus the **persisted** space URL (`activeSpaceUrl`,
 * i.e. what the settings screen chose), never `activeSpace`. `activeSpace` carries the
 * ephemeral workspace override (`js/groups.ts setActiveSpaceEphemeral`): a user who tapped
 * a workspace room would otherwise read and write his personal pins on the Buzz relay for
 * the rest of the session, and the next reload would read them back from the space and see
 * nothing.
 *
 * The declared write relays are read **without** the router scenario
 * (`eigeneOutboxUrls()`): that one is a randomised sample of at most three, minus every
 * relay whose live quality has dropped to zero — for a read that is reasonable, for the
 * target set of a replaceable write it is three separate hazards (finding F3 in
 * `js/follows.ts`, 88.7 % divergence between the set read and the set written, measured
 * over 20 000 draws). This module draws the set ONCE per pass and uses it for both.
 *
 * ── What this module does NOT own ──────────────────────────────────────────────
 *
 * A room of the Buzz workspace: `pinWriteRoute` sends it to `toggleChannelFlag('stars')`
 * (`js/channelPrefs.ts`), so Buzz Desktop and this client keep one truth. The union of both
 * sources is {@link pinnedKeys} — one selector for the left bar and for Start.
 */
import { derived, get, writable, type Readable, type Writable } from 'svelte/store'
import { makeEvent, normalizeRelayUrl, type Filter, type TrustedEvent } from '@welshman/util'
import { PublishStatus } from '@welshman/net'
import { RelayLists } from '@welshman/app'
import { app, Thunks, waitForThunkCompletion } from './welshmanApp.ts'
import { ensurePlaintext, nip44EncryptToSelf, pubkey } from './welshmanSession.ts'
import { requestOne } from './welshmanNet.ts'
import { APP_DATA } from './welshmanKinds.ts'
import { tagSpec, tagValue } from './welshmanTags.ts'
import { DEFAULT_SPACE_URL, activeSpaceUrl, makeRoomId, roomsById } from './groups.ts'
import { displayProfileByPubkey, profilesByPubkey } from './spaceProfiles.ts'
import { WORKSPACE_URL } from './spaceCaps.ts'
import { channelStars, subscribeWorkspacePrefs, toggleChannelFlag } from './channelPrefs.ts'
import { flaggedIds } from './channelPrefsData.ts'
import {
    EMPTY_PINS,
    MAX_PINS,
    PIN_D,
    anyRelayAccepted,
    decidePinPublish,
    isPinned as isPinnedIn,
    mergePinSets,
    pinChipFallback,
    parsePinContent,
    pinWriteRoute,
    pinnedKeysOf,
    prunePins,
    roomKeyParts,
    roomPinKey,
    roomPinLookup,
    seedDefaultPins,
    setPinEntry,
    unionPinnedKeys,
    type PinSet,
} from './pinSet.ts'

/**
 * How long a read of our own set may take before the relay counts as unanswered — 6 s, the
 * same number and reasoning as `READ_TIMEOUT_MS` in `js/mutes.ts`: long enough for a cold
 * socket plus an AUTH round on a slow line, short enough that a tap does not feel broken.
 * Running out is not an error; it is the state in which nothing is written.
 */
export const READ_TIMEOUT_MS = 6_000

/**
 * Publish delay — **2 s** (D7), Buzz' own number for the same kind
 * (`channelPrefs.ts PUBLISH_DEBOUNCE_MS`). A pin is something the user just tapped and may
 * reload one second later; the 30 s of `readStateSync.ts` would make it disappear on that
 * reload.
 *
 * The window starts at the FIRST change and is not reset by further ones — a user flipping
 * several pins in a row must not be able to postpone the publish indefinitely.
 */
export const PUBLISH_DEBOUNCE_MS = 2_000

/** localStorage key of the GUEST set. Per browser, not per account — a guest has none. */
export const GUEST_PINS_KEY = 'einundzwanzigPinsGuest'

/** The filter for our own pin event. `limit: 1` is exactly the stock: one address, one event. */
export const pinFilters = (self: string): Filter[] => [
    { kinds: [APP_DATA], authors: [self], '#d': [PIN_D], limit: 1 },
]

// ── Stores ─────────────────────────────────────────────────────────────────────

/** The merged pin set of this identity (or the guest's local one). */
export const pinSet: Writable<PinSet> = writable(EMPTY_PINS)

/**
 * Did the stored payload carry a `v` this client does not understand? Then the surface may
 * still SHOW what it knows, and every write is refused (D7).
 */
export const pinSetReadOnly: Writable<boolean> = writable(false)

/** Has at least one target relay closed a read with `EOSE` for this identity? */
export const pinSetAnswered: Writable<boolean> = writable(false)

/**
 * **Has a read for this identity FINISHED** — answered or not.
 *
 * A separate store and not `answered !== false`, because "we have not looked yet" and "the
 * relay stayed silent" are two states and the surface owes different words for them. Set at
 * the end of the read pass and nowhere else: a flag set from a store callback would be true
 * within a tick of the boot, while the bar is still empty (memory:
 * `unbekannt-ist-ein-eigener-ui-zustand`).
 */
export const pinSetReady: Writable<boolean> = writable(false)

/**
 * **The one selector both surfaces read** (D7): the blob's pinned keys unioned with the
 * Buzz-starred channels of the workspace, as `room:<h>@<workspace>` keys.
 *
 * Not two lists in the markup: "angeheftet" has to mean the same thing on Start, in the
 * left bar and in every menu, and a second list is a second answer.
 */
export const pinnedKeys: Readable<string[]> = derived(
    [pinSet, channelStars],
    ([$pins, $stars]) => unionPinnedKeys(pinnedKeysOf($pins), flaggedIds($stars), WORKSPACE_URL),
)

// ── Module state ───────────────────────────────────────────────────────────────

/**
 * A sentinel that is neither a pubkey (64 hex) nor the guest (`''`) — "armed for nothing
 * yet". A plain word and NOT a `\u0000` escape: the editor writes such an escape into the
 * file as a RAW NUL byte, and a source file containing one falls out of every `grep -r`
 * silently (house finding, measured once on `js/calendar.ts`).
 */
const UNARMED = 'unarmed'

/** For which pubkey (or `''` = guest) the module is armed. */
let armedFor = UNARMED
/** The target set of the current pass — drawn once, used for read AND write (F3). */
let targets: string[] = []
/** Newest `created_at` seen for our address, the basis of the replacement bump. */
let remoteHead = 0
/** Payload that at least one relay has confirmed. */
let publishedJson: string | undefined
/** A local change is waiting for its publish. */
let dirty = false
let publishTimer: ReturnType<typeof setTimeout> | null = null
let publishRunning: Promise<void> | null = null
let warned = false

/**
 * Counts every arm/disarm. A publish captures it before its first `await` and drops out if
 * it changed — otherwise a publish still in flight during an identity switch would encrypt
 * the NEW user's set with the NEW user's signer and wipe whatever that user had.
 */
let armEpoch = 0

const nowSec = (): number => Math.floor(Date.now() / 1000)

const warnOnce = (error: unknown): void => {
    if (!warned) {
        warned = true
        console.warn('[pins] Angeheftetes konnte nicht gelesen oder geschrieben werden', error)
    }
}

/** The persisted space URL — the settings choice, NOT `activeSpace` (module header). */
export const persistedSpaceUrl = (): string => normalizeRelayUrl(get(activeSpaceUrl) ?? DEFAULT_SPACE_URL)

/**
 * The pin key of a room — **the one place a surface learns which relay belongs into it.**
 *
 * A `room:` key carries its relay, because the same `h` on two relays is two rooms. Which
 * relay that is, is not a property of the row: it is the workspace for a workspace room and
 * the PERSISTED space for everything else (never `activeSpace`, see the module header). Every
 * surface that can pin a room goes through here, so a key built from the ephemeral space —
 * one no other device resolves — cannot come into existence.
 */
export const roomPinKeyFor = (h: string, workspace = false): string =>
    roomPinKey(h, workspace && WORKSPACE_URL !== '' ? WORKSPACE_URL : persistedSpaceUrl())

/**
 * The fixed target set: declared NIP-65 write relays + the persisted space URL.
 *
 * Read straight off the `RelayLists` projection and not through the router scenario — see
 * the module header (F3). The space URL is always in the set, so a user without a kind
 * 10002 still has exactly one place where his pins live instead of none.
 */
export const pinRelayTargets = (self: string): string[] => {
    const declared = self ? app.use(RelayLists).writeUrls(self).get() : []
    const urls = [...declared.map((url) => normalizeRelayUrl(url)), persistedSpaceUrl()]

    return Array.from(new Set(urls.filter((url) => url !== '')))
}

// ── Guest set (localStorage) ───────────────────────────────────────────────────

/**
 * The guest's pins. A guest has no key, so there is nothing to encrypt and nowhere to
 * publish — the set lives in this browser until he signs in, and {@link arm} then UNIONS it
 * into the account's set (D7). Not "migrates": the account's own statements win every key
 * they share, because they carry a real `at` and the guest's may be older.
 */
const readGuestPins = (): PinSet => {
    try {
        const raw = localStorage.getItem(GUEST_PINS_KEY)
        const parsed = raw ? parsePinContent(raw) : null

        return parsed && !parsed.readOnly ? parsed.store : EMPTY_PINS
    } catch {
        return EMPTY_PINS
    }
}

const writeGuestPins = (store: PinSet): void => {
    try {
        localStorage.setItem(GUEST_PINS_KEY, JSON.stringify({ v: 1, pins: store.pins }))
    } catch {
        // Private mode, full quota: the set stays in this tab's memory. A guest pin is a
        // convenience, not a promise — and it is the only state in this module that is
        // allowed to be lost.
    }
}

// ── Reading ────────────────────────────────────────────────────────────────────

/** What a read of our own pin event came back with. */
export type PinRead = {
    /** **Did at least one relay send `EOSE`?** `false` means: do not write anything. */
    answered: boolean
    store: PinSet
    /** Did any relay's payload carry an unknown `v`? Then every write is refused. */
    readOnly: boolean
    /** Newest `created_at` seen — the basis of the replacement bump. */
    head: number
}

/**
 * Read our own pin event from ONE relay and report its `EOSE`.
 *
 * `requestOne` and not `load`: the loader batches and de-duplicates by filter, so a merged
 * answer from a batch already in flight would be the state from *before* somebody else's
 * write — and it gives no `EOSE` of its own to hang the verdict on.
 *
 * Absence of `EOSE` is the fail-closed case and it has three causes measured in this repo:
 * a hanging AUTH round swallows it, an offline tab never gets it, a `CLOSED` ends the
 * request without one. All three mean the same: we do not know what the relay holds.
 */
const readFromRelay = async (url: string, self: string): Promise<{ answered: boolean; events: TrustedEvent[] }> => {
    let answered = false
    try {
        const events = await requestOne({
            relay: url,
            filters: pinFilters(self),
            autoClose: true,
            onEose: () => {
                answered = true
            },
            signal: AbortSignal.timeout(READ_TIMEOUT_MS),
        })

        return { answered, events }
    } catch {
        return { answered: false, events: [] }
    }
}

/**
 * Decrypt one event and merge it in — with the per-line gate `channelPrefs.ts applyEvent`
 * uses: author, kind and `d` are checked individually. A relay that answers an `authors`
 * filter with something foreign is thus without consequence, and a foreign `d` on the same
 * kind (our own read state, Buzz' `read-state:<slot>`) falls out here, not in the parser.
 *
 * The head is recorded from the RAW event, **before** the decryption gate: an event we
 * cannot read still occupies the address, and our next write has to outrank it.
 */
const applyEvent = async (self: string, event: TrustedEvent, into: { store: PinSet; readOnly: boolean; head: number }): Promise<void> => {
    if (event.kind !== APP_DATA || event.pubkey !== self) {
        return
    }
    if (tagValue(tagSpec('d'), event.tags) !== PIN_D) {
        return
    }
    if (event.created_at > into.head) {
        into.head = event.created_at
    }
    let plaintext: string | undefined
    try {
        plaintext = await ensurePlaintext(event)
    } catch (error) {
        // Foreign key, broken payload, a refused signer request: skip THIS event, do not
        // abort the pass.
        warnOnce(error)

        return
    }
    if (plaintext === undefined) {
        return // no signer (yet) — deliberately not treated as read
    }
    const parsed = parsePinContent(plaintext)
    if (!parsed) {
        return // unreadable → keep what we have; a broken payload must never empty the bar
    }
    if (parsed.readOnly) {
        into.readOnly = true

        return
    }
    into.store = mergePinSets(into.store, parsed.store)
}

/**
 * Read our own set from ALL targets and merge every answer.
 *
 * Every relay is asked, and the verdict is "at least one answered" — the plan's rule (D7).
 * That is weaker than `js/follows.ts`, which requires EVERY target to answer, and the
 * difference is deliberate: a contact list is a social graph others depend on, a pin set is
 * this user's own furniture. The cost of the weaker rule is named rather than hidden — a
 * relay that stayed silent may hold a pin this write drops; the tombstone rule means it
 * comes back on the next merge, because its `at` is still the newest statement about that
 * key.
 */
export const readPinSet = async (self: string, urls: readonly string[], base: PinSet): Promise<PinRead> => {
    const into = { store: base, readOnly: false, head: remoteHead }
    let answered = false
    for (const url of urls) {
        const answer = await readFromRelay(url, self)
        answered = answered || answer.answered
        for (const event of answer.events) {
            await applyEvent(self, event, into)
        }
    }

    return { answered, store: into.store, readOnly: into.readOnly, head: into.head }
}

// ── Arming ─────────────────────────────────────────────────────────────────────

const resetState = (): void => {
    armEpoch += 1
    targets = []
    remoteHead = 0
    publishedJson = undefined
    dirty = false
    if (publishTimer) {
        clearTimeout(publishTimer)
        publishTimer = null
    }
    pinSetReadOnly.set(false)
    pinSetAnswered.set(false)
    pinSetReady.set(false)
}

/**
 * The default seed (D8) — `area:wallet` by default, overridable by the host through
 * `window.__nostrDefaultPins` so the companion can seed something else without a second
 * code path. Read at call time, not at module load: the host writes it in the `<head>`,
 * which is before the boot, but a test changes it between passes.
 */
const defaultPinKeys = (): string[] => {
    const raw = (globalThis as { __nostrDefaultPins?: unknown }).__nostrDefaultPins

    return Array.isArray(raw) ? raw.filter((key): key is string => typeof key === 'string') : ['area:wallet']
}

/**
 * Arm for this identity: seed the default locally, union the guest set in, then read.
 *
 * The seed is **local only**. Publishing it would make a fresh device announce a pin the
 * user never made — and a device whose read came back empty for any other reason would
 * publish a set consisting of exactly the default, over a full one (R2). `decidePinPublish`
 * refuses that, and `at: 0` makes the seed lose every merge it ever takes part in.
 */
const arm = (self: string): void => {
    if (armedFor === self) {
        return
    }
    armedFor = self
    resetState()
    const epoch = armEpoch
    const guest = readGuestPins()
    // Guest pins union into the account set; the default seed fills what neither holds.
    const base = seedDefaultPins(defaultPinKeys(), mergePinSets(EMPTY_PINS, guest))
    pinSet.set(base)
    if (!self) {
        // A guest has no address to read, so his set is complete the moment it is loaded.
        pinSetReady.set(true)

        return
    }
    targets = pinRelayTargets(self)
    // Warm the NIP-65 list so a later pass can widen the target set. `load` and never
    // `forceLoad`/`update`: the writing half of that plugin is what publishes empty lists.
    void app.use(RelayLists).load(self).catch(() => undefined)
    void readPinSet(self, targets, base)
        .then((read) => {
            if (epoch !== armEpoch) {
                return // identity changed while we were reading
            }
            remoteHead = Math.max(remoteHead, read.head)
            pinSetReadOnly.set(read.readOnly)
            pinSetAnswered.set(read.answered)
            pinSet.set(prunePins(read.store, nowSec()))
            pinSetReady.set(true)
        })
        .catch((error) => {
            // The pass is over either way — a surface that keeps showing a skeleton after a
            // failed read tells the user nothing at all.
            if (epoch === armEpoch) {
                pinSetReady.set(true)
            }
            warnOnce(error)
        })
}

let started = false

/**
 * Idempotent entry point — armed on the FIRST subscriber, like `initChannelPrefs`.
 *
 * No surface → no subscription → no REQ. Called through {@link subscribePinned} (and by the
 * Alpine store), never from `core.ts`: `core.ts` runs on every page, and the pin set is
 * only read where something shows it.
 */
export function initPinSet(): void {
    if (started) {
        return
    }
    started = true
    try {
        pubkey.subscribe((next: string | undefined) => {
            arm(next ?? '')
        })
        // A change of the persisted space is a change of the target set — the space URL is
        // always one of the targets, so a settings change has to re-read.
        activeSpaceUrl.subscribe(() => {
            const self = get(pubkey) ?? ''
            if (armedFor === self && self !== '') {
                armedFor = UNARMED
                arm(self)
            }
        })
    } catch (error) {
        warnOnce(error)
    }
    if (typeof document !== 'undefined') {
        // A tab that goes away must not swallow the last toggle. Gated on `dirty`, so an
        // ordinary app switch costs nothing.
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden' && dirty) {
                void publishPinSet()
            }
        })
    }
}

/**
 * **The one entry for a surface**: arms the pin path (and the Buzz preference path, because
 * {@link pinnedKeys} unions both) and subscribes to the union. Returns the unsubscriber.
 */
export const subscribePinned = (listener: (keys: string[]) => void): (() => void) => {
    initPinSet()
    // `channel-stars` is the other half of the union; without this the starred channels
    // would stay empty on every surface that does not also show the room list.
    const unsubPrefs = subscribeWorkspacePrefs(() => undefined)
    const unsubKeys = pinnedKeys.subscribe(listener)

    return () => {
        unsubKeys()
        unsubPrefs()
    }
}

// ── Writing ────────────────────────────────────────────────────────────────────

/**
 * Publish the set, if it changed since the last confirmed write.
 *
 * Order: re-read the targets (fetch + merge, D7) → decide → encrypt → publish → remember.
 * The re-read is not an optimisation: a second device may have pinned something a moment
 * ago, and kind 30078 has no union on the relay. It is also where the `EOSE` verdict comes
 * from that `decidePinPublish` demands.
 *
 * **No retry loop** — same decision as `channelPrefs.ts`: a permanently refusing relay
 * would be re-asked forever. A failed publish keeps its {@link dirty} mark, so the next
 * toggle or tab switch retries once, bounded by user action rather than by a timer.
 */
export const publishPinSet = async (): Promise<void> => {
    if (publishRunning) {
        return publishRunning
    }
    const self = get(pubkey) ?? ''
    if (!dirty || !self || armedFor !== self) {
        return
    }
    const epoch = armEpoch
    const run = (async (): Promise<void> => {
        try {
            const read = await readPinSet(self, targets, get(pinSet))
            if (epoch !== armEpoch) {
                return
            }
            remoteHead = Math.max(remoteHead, read.head)
            pinSetAnswered.set(read.answered)
            pinSetReadOnly.set(read.readOnly)
            pinSet.set(read.store)
            const decision = decidePinPublish({
                store: read.store,
                self,
                answered: read.answered,
                readOnly: read.readOnly,
                nowSec: nowSec(),
                remoteHead,
                lastPublishedJson: publishedJson,
                capturedEpoch: epoch,
                currentEpoch: armEpoch,
            })
            if (!decision.go) {
                // `stale` keeps the pending mark (the set belongs to an identity that is no
                // longer here and `resetState` has already cleared it); `unanswered` keeps
                // it too, because the next pass may get the verdict. The three cheap
                // reasons clear it — there is nothing to send.
                if (decision.reason !== 'stale' && decision.reason !== 'unanswered') {
                    dirty = false
                }

                return
            }
            const content = await nip44EncryptToSelf(decision.plan.json)
            // Asked a SECOND time: the signer round trip is the longer of the two awaits,
            // and on NIP-46 it happens on someone else's machine.
            if (epoch !== armEpoch) {
                return
            }
            const thunk = app.use(Thunks).publish({
                event: makeEvent(APP_DATA, {
                    content,
                    tags: decision.plan.tags,
                    created_at: decision.plan.createdAt,
                }),
                relays: targets,
            })
            await waitForThunkCompletion(thunk)
            if (!anyRelayAccepted(thunk.results, PublishStatus.Success)) {
                return // stays dirty — the next toggle tries once more
            }
            publishedJson = decision.plan.json
            remoteHead = Math.max(remoteHead, decision.plan.createdAt)
            dirty = false
        } catch (error) {
            // No signer, no network, a refused encryption: fail-soft like every other path
            // here. The local store keeps carrying the display.
            warnOnce(error)
        } finally {
            publishRunning = null
        }
    })()
    publishRunning = run

    return run
}

const schedulePublish = (): void => {
    if (publishTimer) {
        return
    }
    publishTimer = setTimeout(() => {
        publishTimer = null
        void publishPinSet()
    }, PUBLISH_DEBOUNCE_MS)
}

/**
 * Set or clear ONE pin.
 *
 * A room of the Buzz workspace goes to `channel-stars` instead ({@link pinWriteRoute}) —
 * one truth per object, and that one is shared with Buzz Desktop.
 *
 * The local store is written first and the network follows: the chip has to appear within
 * the frame, and our entry carries a fresh `at`, so no relay answer can contradict it.
 * A guest writes to localStorage and nowhere else.
 */
export const setPin = (key: string, on: boolean): void => {
    // A workspace room is refused here rather than delegated: `toggleChannelFlag` TOGGLES,
    // it does not set, so a `setPin(key, false)` routed into it would do the opposite of
    // what it says. {@link togglePin} is the entry for those keys.
    if (pinWriteRoute(key, WORKSPACE_URL) === 'stars') {
        return
    }
    const self = get(pubkey) ?? ''
    const next = setPinEntry(get(pinSet), key, on, nowSec())
    if (next === get(pinSet)) {
        return // key this client does not understand — nothing written anywhere
    }
    pinSet.set(next)
    if (!self) {
        writeGuestPins(next)

        return
    }
    dirty = true
    schedulePublish()
}

/**
 * Flip one pin — **the entry point of every surface**. Reading the current value here and
 * not in each island keeps the menus from growing their own idea of "already pinned".
 *
 * For a Buzz workspace room the state comes from `channel-stars`, so the flip is delegated
 * whole (that path reads its own current value).
 */
export const togglePin = (key: string): void => {
    if (pinWriteRoute(key, WORKSPACE_URL) === 'stars') {
        const parts = roomKeyParts(key)
        if (parts) {
            toggleChannelFlag('stars', parts.h)
        }

        return
    }
    setPin(key, !isPinnedIn(get(pinSet), key))
}

// ── The Alpine store ───────────────────────────────────────────────────────────

export type PinRow = {
    key: string
    prefix: string
    /** The identifying part after the prefix — `h@relay`, a coordinate, a slug, a hex key. */
    value: string
    /**
     * What the chip says: a room name or a profile name where this device has one, the
     * identifying part of the key where it has not ({@link pinChipFallback}).
     *
     * Resolved here and not in the markup because the two sources are stores: `roomsById`
     * (kind 39000 of every space seen) and the profile cache. Both are derived views over the
     * repository — reading them costs no request; a name simply arrives late, and the chip
     * re-renders when it does.
     */
    label: string
}

export type PinSetStore = {
    /** Has a read for this identity completed (answered or not)? */
    ready: boolean
    /** Is every write refused because the stored payload is from a newer client? */
    readOnly: boolean
    /** Did a relay answer? A `false` here is why a pin may refuse to be written. */
    answered: boolean
    /**
     * The reader's own pubkey, so a surface can leave the action off their own row. `''` for a
     * guest — whose pins work all the same, they just stay local.
     */
    me: string
    /** The pinned keys in display order — blob ∪ Buzz stars. */
    keys: string[]
    rows: PinRow[]
    count: number
    max: number
    has(key: string): boolean
    toggle(key: string): void
    /** {@link roomPinKeyFor}, reachable from the markup. */
    roomKey(h: string, workspace?: boolean): string
}

/**
 * Keys → chip rows, with the best label this device has.
 *
 * A derived store and not a function called from the markup: the two name sources arrive
 * late (a room's kind 39000, a person's kind 0), and a function would be re-evaluated by
 * Alpine only when something else changed.
 */
export const pinRows: Readable<PinRow[]> = derived(
    [pinnedKeys, roomsById, profilesByPubkey],
    ([$keys, $rooms]) =>
        $keys.map((key): PinRow => {
            const at = key.indexOf(':')
            const prefix = at < 1 ? '' : key.slice(0, at)
            const value = at < 1 ? key : key.slice(at + 1)
            // `roomPinLookup` and not `$rooms.get(h)`: the index is keyed by
            // `makeRoomId(url, h)`, so the bare `h` never hits (P7 fix — see the docblock
            // over `roomPinLookup`). `|| fallback` and not `?? fallback`: a room whose
            // kind 39000 carries no name has `name === ''`, and an empty chip is worse
            // than one showing the `h`.
            const label = prefix === 'room'
                ? (roomPinLookup(key, $rooms, makeRoomId)?.name || pinChipFallback(key))
                : prefix === 'person'
                    ? (displayProfileByPubkey(value) || pinChipFallback(key))
                    : pinChipFallback(key)

            return { key, prefix, value, label }
        }),
)

/**
 * `$store.pinSet` — a STORE and not an island, for the reason every other store of this
 * series carries: the state is needed in places that never see each other in the DOM (the
 * Start chips, the left bar, the room menus, the profile card, the article and repo
 * headers). Two islands would be two truths about "is this pinned".
 */
export function wirePinSet(Alpine: { store: (name: string, value?: unknown) => unknown }): void {
    if (Alpine.store('pinSet')) {
        return
    }
    const store: PinSetStore = {
        ready: false,
        readOnly: false,
        answered: false,
        me: '',
        keys: [],
        rows: [],
        count: 0,
        max: MAX_PINS,
        has(key: string): boolean {
            return this.keys.includes(key)
        },
        toggle(key: string): void {
            togglePin(key)
        },
        roomKey(h: string, workspace = false): string {
            return roomPinKeyFor(h, workspace)
        },
    }
    Alpine.store('pinSet', store)
    // From here only the reactive proxy is written — same reason and same shape as
    // `wireMutes`/`wireBookmarks`: a closure mutating the raw object changes values Alpine
    // never hears about.
    const reactive = Alpine.store('pinSet') as PinSetStore
    initPinSet()
    subscribeWorkspacePrefs(() => undefined)
    pinnedKeys.subscribe((keys) => {
        reactive.keys = keys
        reactive.count = keys.length
    })
    pinRows.subscribe((rows) => {
        reactive.rows = rows
    })
    pinSetReadOnly.subscribe((value) => {
        reactive.readOnly = value
    })
    pinSetAnswered.subscribe((value) => {
        reactive.answered = value
    })
    // `ready` comes from its own store and NOT from the line above: `answered` emits its
    // initial `false` synchronously on subscribe, so a `ready = true` here would be true a
    // tick after boot, with an empty bar behind it.
    pinSetReady.subscribe((value) => {
        reactive.ready = value
    })
    pubkey.subscribe((next: string | undefined) => {
        reactive.me = next ?? ''
    })
}
