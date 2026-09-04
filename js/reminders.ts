/**
 * `$store.reminders` — private reminders over NIP-ER (kind 30300, P5), the impure half.
 *
 * The rules (envelope form, the encrypted content, folding, due-ness, the horizon) live
 * in `reminderModels.ts` and are testable there without a browser. What is left here is
 * what genuinely needs welshman: reading through the tracker, gating, encrypting,
 * signing, publishing — and staying subscribed so the relay can say "this one is due".
 *
 * ── Why a store and not an island ──────────────────────────────────────────────────
 *
 * The same reason the pin and the bookmark got one (`js/roomPins.ts`, `js/bookmarks.ts`):
 * the state is needed at two places that cannot see each other in the DOM — the entry in
 * the message menu inside `nostrRoomChat`, and the reminder section on `/updates`.
 * `nostrRoomChat` gains no field; the markup reads `$store.reminders.*`.
 *
 * ── The gate runs before the event exists ──────────────────────────────────────────
 *
 * The write path does not ask the gate and then decide; it asks `planReminder`
 * (`reminderModels.ts`), which asks `mayWriteKind` and answers `null` when the answer is
 * no. Gate and event body are then the same value. `canRemind` mirrors the same decision
 * for the markup — a menu entry that would do nothing is worse than no menu entry.
 *
 * For 30300 the gate needs the **NIP-11 doc**, not just the relay kind: `nip-er` in
 * `supported_extensions` and the horizon out of `limitation.max_not_before_delta`. Both
 * come from {@link deriveSpaceProfile}, which is subscribed rather than read once — the
 * documented way this class of surface breaks in this repo (`roomPins.ts` carries the
 * note after it happened there).
 *
 * ══ The one non-obvious piece of wiring: `onDuplicate` ═════════════════════════════
 *
 * NIP-ER's delivery model is that the relay re-sends the **same, unchanged** event when
 * `not_before` passes ("a due signal … is not a new event"). Buzz does exactly that: its
 * scheduler polls every 10 s and republishes the original signed event to the author's
 * open subscriptions (`buzz-relay/src/main.rs:728-848`), and its NIP-11 says
 * `due_delivery_mode: "push"`.
 *
 * **welshman swallows that signal by default, and the spec warns about precisely this**
 * ("pool-level duplicate-id filtering can otherwise drop due-time redelivery before
 * application code runs"). Measured in the installed 0.9.5, not assumed —
 * `@welshman/net` `request.js`:
 *
 *     if (tracker.track(event.id, url)) { options.onDuplicate?.(event, url) }
 *     else if … else { options.onEvent?.(event, url); events.push(event) }
 *
 * `Tracker.track` returns `true` for an id it has already seen (`tracker.js`: `const
 * seen = this.relaysById.has(eventId)`), and `requestOne` builds one tracker per request
 * — so the *first* arrival of a reminder on our live subscription takes the `onEvent`
 * branch and every redelivery, including the due signal, takes `onDuplicate`. A surface
 * wired only to `onEvent` would show a reminder as pending forever while the relay was
 * dutifully announcing it as due. `reminderDelivery.test.ts` measures both branches
 * against the installed package.
 *
 * Nothing about the data changes on redelivery — the event is already in the repository.
 * What the signal buys is a **recompute**, which is why both callbacks do the same thing.
 *
 * ── And why there is no timer next to it ───────────────────────────────────────────
 *
 * Due-ness is `not_before <= now`, so a reminder that comes due while the page sits idle
 * needs *something* to re-evaluate. That something is the relay (above) plus every other
 * event that arrives in the space — the derivation recomputes `now` on each emit. A
 * second scheduler in the client would duplicate the relay's job, and NIP-ER is explicit
 * that the relay's is best-effort anyway. **The residual limit, stated rather than
 * hidden:** against a relay that advertises `nip-er` but delivers lazily, a reminder that
 * comes due in an idle tab appears at the next navigation or reload, not at the second it
 * is due. Against Buzz — the only relay this kind is enabled on — the push arrives.
 */
import { throttled } from '@welshman/store'
import { makeEvent, type Filter, type TrustedEvent } from '@welshman/util'
import { get } from 'svelte/store'
import { app } from './welshmanApp.ts'
import { pubkey, nip44EncryptToSelf, ensurePlaintext } from './welshmanSession.ts'
import { load, request } from './welshmanNet.ts'
import { deriveEventsForUrl } from './repository.ts'
import { activeSpace } from './groups.ts'
import { WORKSPACE_URL, deriveSpaceKind, deriveSpaceProfile, type SpaceKind, type SpaceProfile } from './spaceCaps.ts'
import { workspaceRoomHref } from './spaceParam.ts'
import { bodyWithoutQuote, fullTimeLabel } from './feeds.ts'
import { publishOptimistic } from './publishOptimistic.ts'
import { dispatchModal } from './modal.ts'
import { mayWriteKind } from './relayCapability.ts'
import { maxNotBeforeDelta } from './relayCaps.ts'
import { t } from './i18n.ts'
import {
    EVENT_REMINDER,
    availableDelays,
    buildReminderEvent,
    dueReminders,
    foldReminders,
    makeReminderD,
    pendingReminders,
    planReminder,
    reminderTargetFor,
    type Reminder,
    type ReminderContent,
    type ReminderEventLike,
    type ReminderStatus,
} from './reminderModels.ts'

/** One reminder as the `/updates` screen renders it. */
export type ReminderRow = {
    /** Address component — the key every write on this reminder is addressed by. */
    d: string
    /** Event id of the head; the second deduplication key NIP-ER prescribes. */
    id: string
    /** The author's own note, or `''`. */
    note: string
    /** Cached text of the message this reminder points at, or `''`. */
    preview: string
    /** Where the row jumps to; `''` while the target message is unknown. */
    href: string
    /** Due time, humanised. */
    timeLabel: string
}

/** One entry of the duration menu. `label` is already translated. */
export type DelayChoice = { key: string; label: string; seconds: number }

type RemindersStore = {
    /** Has the first read of the active space happened? */
    ready: boolean
    loading: boolean
    busy: boolean
    /** Literal relay wording, `''` = none. */
    error: string
    /** May this user write a reminder on the active space at all? */
    canRemind: boolean
    /** The durations this relay's horizon allows — empty when it states none. */
    delays: DelayChoice[]
    /** Message id the dialog is open for; `''` = closed. */
    forId: string
    /** Reminders whose time has come. */
    due: ReminderRow[]
    /** Reminders still waiting. */
    upcoming: ReminderRow[]
    mount(): void
    unmount(): void
    /** Open the duration dialog for one message. */
    openFor(id: string): void
    closeDialog(): void
    /** Write the reminder the dialog is about, `seconds` from now. */
    create(seconds: number): Promise<void>
    /** Replace a reminder with its terminal state. */
    finish(d: string, status: ReminderStatus): Promise<void>
    dismissError(): void
}

const noop = (): void => {}

/** Name of the Flux modal that carries the duration choice (`components/reminder-modal.blade.php`). */
const REMINDER_MODAL = 'reminder'

/**
 * What went wrong on the way to a signed reminder, in the user's language.
 *
 * Two kinds of failure end up here and they deserve different answers:
 *
 *  - **The signer said no or is not there.** `welshmanSession` throws German sentences
 *    the user can act on („Kein aktiver Signer."), and an Amber/bunker rejection carries
 *    its own wording. Those go through verbatim — same convention as the literal relay
 *    wording everywhere else in this package.
 *  - **The signer answered something impossible.** {@link buildReminderEvent} refuses an
 *    empty or echoed ciphertext rather than publishing the private note in the clear, and
 *    marks its throws with a `reminder:` prefix. That message is an internal English
 *    diagnosis; the user gets a translated sentence instead.
 */
const encryptionFailure = (error: unknown): string => {
    const message = error instanceof Error ? error.message : ''

    return !message || message.startsWith('reminder:')
        ? t('Die Erinnerung konnte nicht verschlüsselt werden.')
        : message
}

/** Both directions of one author's reminders, from one relay. */
const reminderFilters = (self: string): Filter[] => [{ kinds: [EVENT_REMINDER], authors: [self] }]

const createStore = (): { store: RemindersStore; bind: (reactive: RemindersStore) => void } => {
    let unsubSpace: () => void = noop
    let unsubPubkey: () => void = noop
    let unsubSource: () => void = noop
    let unsubKind: () => void = noop
    let unsubProfile: () => void = noop
    /** For which `url|pubkey` the read side is armed — `null` = for none. */
    let armedFor: string | null = null
    let controller: AbortController | null = null
    let url = ''
    /** The raw 30300 of this relay, unfolded and still encrypted. */
    let rawEvents: ReminderEventLike[] = []
    /** Ciphertext → plaintext, filled asynchronously; `undefined` = unreadable. */
    const plaintextById = new Map<string, string | undefined>()
    /** Ids a decryption is already running for. */
    const decrypting = new Set<string>()
    /** Ids of target messages already fetched — never a second REQ for the same one. */
    const requested = new Set<string>()
    /** Three-valued space kind; `'unknown'` denies (see the module header). */
    let spaceKind: SpaceKind = 'unknown'
    let profile: SpaceProfile | undefined
    /** How many island nodes hold the store; see `roomPins.ts` for the `wire:navigate` race. */
    let mounts = 0

    /** Every write goes here: the raw object before {@link bind}, the reactive proxy after. */
    let self: RemindersStore

    const store: RemindersStore = {
        ready: false,
        loading: false,
        busy: false,
        error: '',
        canRemind: false,
        delays: [],
        forId: '',
        due: [],
        upcoming: [],

        mount(): void {
            mounts++
            if (unsubSpace !== noop) {
                return
            }
            unsubSpace = activeSpace.subscribe((nextUrl: string) => {
                if (!nextUrl) {
                    return
                }
                unsubKind()
                unsubKind = deriveSpaceKind(nextUrl).subscribe((kind: SpaceKind) => {
                    spaceKind = kind
                    recomputePermission()
                })
                // The NIP-11 doc decides two things this surface cannot guess: whether the
                // relay runs the NIP-ER scheduler at all, and how far ahead it accepts a
                // due time. Subscribed, not read once — it arrives late.
                unsubProfile()
                unsubProfile = deriveSpaceProfile(nextUrl).subscribe((doc: SpaceProfile | undefined) => {
                    profile = doc
                    recomputePermission()
                })
                armSource(nextUrl)
            })
            // The pubkey is a second, independent arrival — same trap as in `bookmarks.ts`:
            // armed on the space alone, the first pass would take the guest branch and
            // `armedFor` would never change again.
            unsubPubkey = pubkey.subscribe(() => {
                recomputePermission()
                armSource(url)
            })
        },

        /**
         * Two latches, same reason as `roomPins.unmount`: `wire:navigate` inserts the new
         * body **before** it tears the old one down.
         */
        unmount(): void {
            mounts = Math.max(0, mounts - 1)
            if (mounts > 0) {
                return
            }
            teardown()
        },

        /**
         * Open the duration dialog for one message.
         *
         * The modal is addressed the same way the message menu is (`dispatchModal`,
         * `js/modal.ts`) rather than through a field the markup watches: Flux modals are
         * driven by an event, and a second mechanism next to it would be a second truth
         * about whether the dialog is open.
         */
        openFor(id: string): void {
            if (!self.canRemind || !id) {
                return
            }
            self.forId = id
            self.error = ''
            dispatchModal(REMINDER_MODAL)
        },

        closeDialog(): void {
            self.forId = ''
            dispatchModal(REMINDER_MODAL, false)
        },

        async create(seconds: number): Promise<void> {
            const targetId = self.forId
            if (self.busy || !targetId || !url) {
                return
            }
            // The preview is taken from the repository, not handed in by the markup: the
            // markup holds rendered HTML (`ChatMessage.html`), and putting that into the
            // encrypted payload would store markup where a sentence belongs — and would
            // then be rendered as text on the reminder row. `bodyWithoutQuote` is the same
            // source the chat row itself is built from.
            const message = app.repository.getEvent(targetId) as TrustedEvent | undefined
            const target = reminderTargetFor(targetId, url, message ? bodyWithoutQuote(message) : '')
            if (!target) {
                return
            }
            // THE GATE, and it comes back as the plan or as `null`. `canRemind` mirrors the
            // same decision for the markup, but a store method must not trust a field the
            // markup could have gone stale on.
            const plan = planReminder(
                makeReminderD(),
                { target, status: 'pending' },
                seconds,
                { nowSecs: Math.floor(Date.now() / 1000), spaceKind, profile },
            )
            if (!plan) {
                return
            }
            self.busy = true
            self.error = ''
            try {
                const built = await buildReminderEvent(plan, nip44EncryptToSelf)
                const failure = await publishOptimistic(
                    url,
                    makeEvent(built.kind, { content: built.content, tags: built.tags }),
                )
                self.error = failure
                if (!failure) {
                    self.forId = ''
                    dispatchModal(REMINDER_MODAL, false)
                }
            } catch (error) {
                self.error = encryptionFailure(error)
            } finally {
                self.busy = false
            }
        },

        async finish(d: string, status: ReminderStatus): Promise<void> {
            if (self.busy || !d || !url || status === 'pending') {
                return
            }
            const current = folded().find((reminder) => reminder.d === d)
            if (!current) {
                return
            }
            // The terminal replacement keeps target and note — the reminder stays readable
            // in its own history until the relay's `expiration` collects it — but it drops
            // `not_before`, which is what takes it out of the relay's due query.
            const content: ReminderContent = {
                ...(current.target ? { target: current.target } : {}),
                status,
                ...(current.note ? { note: current.note } : {}),
            }
            const plan = planReminder(d, content, null, {
                nowSecs: Math.floor(Date.now() / 1000),
                spaceKind,
                profile,
            })
            if (!plan) {
                return
            }
            self.busy = true
            self.error = ''
            try {
                const built = await buildReminderEvent(plan, nip44EncryptToSelf)
                self.error = await publishOptimistic(
                    url,
                    makeEvent(built.kind, { content: built.content, tags: built.tags }),
                )
            } catch (error) {
                self.error = encryptionFailure(error)
            } finally {
                self.busy = false
            }
        },

        dismissError(): void {
            self.error = ''
        },
    }

    self = store

    const folded = (): Reminder[] => foldReminders(rawEvents, get(pubkey) ?? '', plaintextById)

    const teardown = (): void => {
        controller?.abort()
        controller = null
        unsubSource()
        unsubKind()
        unsubProfile()
        unsubPubkey()
        unsubSpace()
        unsubSource = noop
        unsubKind = noop
        unsubProfile = noop
        unsubPubkey = noop
        unsubSpace = noop
        armedFor = null
        url = ''
        rawEvents = []
        plaintextById.clear()
        decrypting.clear()
        requested.clear()
        spaceKind = 'unknown'
        profile = undefined
        self.ready = false
        self.loading = false
        self.busy = false
        self.error = ''
        self.canRemind = false
        self.delays = []
        self.forId = ''
        self.due = []
        self.upcoming = []
    }

    /**
     * Read source, backlog load and live subscription for one `(url, pubkey)` pair.
     *
     * The live REQ is where the due signal comes in, so it is deliberately **not**
     * `autoClose` and deliberately carries `onDuplicate` next to `onEvent` — the module
     * header explains why that is the whole delivery path and not a defensive extra.
     *
     * The filter is `{kinds:[30300], authors:[self]}` and the `authors` is mandatory, not
     * tidiness: 30300 is author-only on the relay, and a REQ that names only author-only
     * kinds without `authors:[self]` is closed outright with
     * `restricted: author-only kinds require authors=[self]`
     * (`buzz-relay/src/handlers/req.rs:197-201`).
     */
    const armSource = (nextUrl: string): void => {
        if (!nextUrl) {
            return
        }
        const self_ = get(pubkey) ?? ''
        const key = `${nextUrl}|${self_}`
        if (armedFor === key) {
            return
        }
        armedFor = key
        url = nextUrl
        if (!self_) {
            // A guest has no reminders, and could not decrypt them if they had.
            rawEvents = []
            self.ready = true
            recompute()

            return
        }
        self.loading = true
        unsubSource()
        unsubSource = throttled(300, deriveEventsForUrl(nextUrl, reminderFilters(self_))).subscribe(
            (events: TrustedEvent[]) => {
                rawEvents = events as unknown as ReminderEventLike[]
                recompute()
            },
        )
        controller?.abort()
        controller = new AbortController()
        void load({ relays: [nextUrl], filters: reminderFilters(self_) }).then(() => {
            self.loading = false
            self.ready = true
            recompute()
        })
        void request({
            relays: [nextUrl],
            signal: controller.signal,
            filters: reminderFilters(self_).map((filter) => ({ ...filter, limit: 0 })),
            onEvent: () => recompute(),
            onDuplicate: () => recompute(),
        })
    }

    const recomputePermission = (): void => {
        self.canRemind = Boolean(get(pubkey)) && mayWriteKind(EVENT_REMINDER, spaceKind, profile)
        self.delays = availableDelays(maxNotBeforeDelta(profile)).map((delay) => ({
            key: delay.key,
            label: t(delay.key),
            seconds: delay.seconds,
        }))
    }

    /** One reminder → one row, plus a targeted fetch for a message we do not have. */
    const toRow = (reminder: Reminder, workspace: boolean): ReminderRow => {
        const targetId = reminder.target?.id ?? ''
        const event = targetId ? (app.repository.getEvent(targetId) as TrustedEvent | undefined) : undefined
        const h = event?.tags.find((tag) => tag[0] === 'h' && tag[1])?.[1] ?? ''

        return {
            d: reminder.d,
            id: reminder.id,
            note: reminder.note,
            // The cached preview is the fallback, the live message the better answer: the
            // author may have edited it since the reminder was made.
            preview: event ? bodyWithoutQuote(event) : (reminder.target?.preview ?? ''),
            href: h ? (workspace ? workspaceRoomHref(h) : `/rooms/${encodeURIComponent(h)}`) : '',
            timeLabel: reminder.notBefore === null ? '' : fullTimeLabel(reminder.notBefore),
        }
    }

    /**
     * Rows out of the raw events — and the two asynchronous fills that follow.
     *
     * `now` is read here, on every emit. That is the whole local enforcement of
     * `not_before` (NIP-ER makes it a MUST) and the reason no timer is needed for the
     * common case: every event that arrives in this space re-answers the question.
     */
    const recompute = (): void => {
        const me = get(pubkey) ?? ''
        const now = Math.floor(Date.now() / 1000)
        const all = folded()
        const workspace = Boolean(WORKSPACE_URL) && url === WORKSPACE_URL

        self.due = dueReminders(all, now).map((reminder) => toRow(reminder, workspace))
        self.upcoming = pendingReminders(all, now).map((reminder) => toRow(reminder, workspace))

        // Decrypt what we have not decrypted yet. Each answer re-enters here, so a
        // reminder appears as soon as its own plaintext is available rather than after
        // the slowest one.
        if (me) {
            for (const event of rawEvents) {
                if (event.pubkey !== me || plaintextById.has(event.id) || decrypting.has(event.id)) {
                    continue
                }
                decrypting.add(event.id)
                void ensurePlaintext(event)
                    .then((plaintext) => {
                        plaintextById.set(event.id, plaintext)
                        recompute()
                    })
                    .catch(() => {
                        // An unreadable reminder is ignored, not shown half-empty
                        // (NIP-ER: "Clients MUST ignore plaintext they cannot decrypt").
                        plaintextById.set(event.id, undefined)
                        recompute()
                    })
                    .finally(() => decrypting.delete(event.id))
            }
        }

        // …and fetch the messages the rows point at. `.then(recompute)` is required, not
        // decoration: the derivation above listens on `{kinds:[30300]}` and a fetched
        // **message** matches neither — the same mistake `roomPins.ts` documents.
        const missing = [...self.due, ...self.upcoming]
            .map((row) => all.find((reminder) => reminder.d === row.d)?.target?.id ?? '')
            .filter((id) => id && !app.repository.getEvent(id) && !requested.has(id))
        if (missing.length > 0 && url) {
            missing.forEach((id) => requested.add(id))
            void load({ relays: [url], filters: [{ ids: missing }] }).then(() => recompute())
        }
    }

    return {
        store,
        bind: (reactive: RemindersStore): void => {
            self = reactive
        },
    }
}

export function wireReminders(Alpine: { store: (name: string, value?: unknown) => unknown }): void {
    if (Alpine.store('reminders')) {
        return
    }
    const { store, bind } = createStore()
    Alpine.store('reminders', store)
    // From here the store writes only into the reactive proxy — same reason and same
    // shape as `wireBookmarks`/`wireRoomPins`: a closure that keeps mutating the raw
    // object changes values Alpine never hears about.
    bind(Alpine.store('reminders') as RemindersStore)
}
