/**
 * kind 10050 (NIP-17 messaging relay lists) — the impure half of P7.
 *
 * The rules live in `js/messagingRelayModels.ts` and run there under `node --test`.
 * What is left here is what genuinely needs welshman: reading through the tracker,
 * publishing, and — above all — deciding whether the relay actually **answered** before
 * anything replaceable is overwritten.
 *
 * ══ The EOSE verdict, and why it is not `forceLoad` ══════════════════════════════
 *
 * Same shape as `js/mutes.ts` from P6, same reason. welshman's own
 * `MessagingRelayLists.update()` builds its writer from `await forceLoad(pubkey)`, and
 * `makeForceLoadItem` is `await loadItem(key); return getItem(key)` — an offline tab, a
 * dead socket or an AUTH round that swallowed the `EOSE` all end with `undefined`, the
 * writer starts empty, and the published 10050 contains only what this device added.
 * There is no signal on the way out.
 *
 * So {@link readOwnMessagingRelays} reports whether an `EOSE` arrived and
 * `planMessagingRelayWrite` refuses to build an event body without it. Fail-closed: a
 * refused edit costs a click, a blind write costs every relay the user entered elsewhere.
 *
 * ══ One space, one list ═════════════════════════════════════════════════════════
 *
 * Read and write both go to the **active space relay** and nowhere else — the same
 * decision as `js/bookmarks.ts` and `js/mutes.ts`, and the same trade-off: a NIP-17 list
 * is global by protocol, but the outbox route needs a kind-10002 list many members do
 * not have, and carrying an association member's list onto public relays publishes where
 * they can be reached to everyone. Reversing it is one `relays` array here.
 *
 * **On a Buzz space there is no list at all.** Buzz has no constant for kind 10050 and
 * answers `restricted: unknown event kind` (measured with kind 10000 as the positive
 * control, `p7-messung-c-kind10050.txt`). `mayWriteKind` refuses it before signing, the
 * surface says so in words, and `privateMessages.ts` falls back to the space relay so
 * the transport still works between members of that space. What does not work there is
 * interop: a foreign client has no way to learn where to deliver.
 */
import { get, type Readable } from 'svelte/store'
import { derived } from 'svelte/store'
import { makeEvent, type TrustedEvent } from '@welshman/util'
import { requestOne, load, request } from './welshmanNet.ts'
import { deriveEventsForUrl } from './repository.ts'
import { publishOptimistic } from './publishOptimistic.ts'
import { pubkey } from './welshmanSession.ts'
import {
    MESSAGING_RELAYS,
    messagingRelayUrls,
    messagingRelayWriteConfirmed,
    ownMessagingRelayList,
    planMessagingRelayWrite,
    type RelayListEventLike,
} from './messagingRelayModels.ts'
import type { SpaceKind } from './spaceCaps.ts'

const noop = (): void => {}

/**
 * How long a read of our own list may take before we call it unanswered.
 *
 * Six seconds, the same number and the same reasoning as `READ_TIMEOUT_MS` in
 * `js/mutes.ts`: long enough for a cold socket plus an AUTH round on a slow line, short
 * enough that an edit does not feel broken. Running out is not an error — it is the
 * state in which nothing is written.
 */
export const READ_TIMEOUT_MS = 6_000

/** Every 10050 of one author. */
export const messagingRelayFilters = (self: string) => [{ kinds: [MESSAGING_RELAYS], authors: [self] }]

/** What a read of our own list came back with. */
export type MessagingRelayRead = {
    /** **Did a relay send `EOSE`?** `false` means: do not write anything. */
    answered: boolean
    list: RelayListEventLike | null
}

/**
 * Read our own messaging relay list from one relay, and report whether it answered.
 *
 * `requestOne` and not `load`, for the reason spelled out in `mutes.ts`: the loader
 * batches and de-duplicates by filter, so a merged answer from a batch already in flight
 * would be the state from *before* somebody else's write — and it has no `EOSE` of its
 * own to hang the verdict on.
 */
export const readOwnMessagingRelays = async (url: string, self: string): Promise<MessagingRelayRead> => {
    if (!url || !self) {
        return { answered: false, list: null }
    }
    let answered = false
    let events: TrustedEvent[] = []
    try {
        events = await requestOne({
            relay: url,
            filters: messagingRelayFilters(self),
            autoClose: true,
            onEose: () => {
                answered = true
            },
            signal: AbortSignal.timeout(READ_TIMEOUT_MS),
        })
    } catch {
        return { answered: false, list: null }
    }

    return {
        answered,
        list: ownMessagingRelayList(events as unknown as (RelayListEventLike & { id: string })[], self),
    }
}

/** For which `url|pubkey` the live subscription is armed — `''` = for none. */
let armedFor = ''
let liveController: AbortController | null = null

/**
 * Keep our own list current on this space, once per identity.
 *
 * The backlog comes through the `load`; the open subscription is what makes a list
 * edited on another device arrive without a reload — which matters more here than for a
 * mute list, because this one decides where messages are delivered.
 */
export const armMessagingRelays = (url: string, self: string): void => {
    const key = `${url}|${self}`
    if (armedFor === key) {
        return
    }
    armedFor = key
    liveController?.abort()
    liveController = null
    if (!url || !self) {
        return
    }
    liveController = new AbortController()
    void load({ relays: [url], filters: messagingRelayFilters(self) }).catch(noop)
    void request({
        relays: [url],
        signal: liveController.signal,
        filters: messagingRelayFilters(self).map((filter) => ({ ...filter, limit: 0 })),
    }).catch(noop)
}

/**
 * The messaging relays of ONE pubkey on this space, reactively.
 *
 * Used for two different questions with the same answer shape: "where can I be reached"
 * (the reader's own list, on the settings surface) and "where does this message go"
 * (the recipient's list, on send). Relay-bound through the tracker, so a 10050 that
 * reached us from a different space cannot leak into this space's answer.
 */
export const deriveMessagingRelays = (url: string, who: string): Readable<string[]> =>
    derived(deriveEventsForUrl(url, [{ kinds: [MESSAGING_RELAYS], authors: who ? [who] : [] }]), ($events) =>
        messagingRelayUrls(
            ownMessagingRelayList($events as unknown as (RelayListEventLike & { id: string })[], who),
        ),
    )

/**
 * Read somebody else's messaging relays once, for a send.
 *
 * Not derived: a send needs an answer NOW, and the reactive store would hand back an
 * empty list while the request is still in flight — which is indistinguishable from "has
 * no list" and would silently route the message to the fallback. The repository is
 * consulted first so a conversation that is already open costs no round trip.
 */
export const fetchMessagingRelays = async (url: string, who: string): Promise<string[]> => {
    if (!url || !who) {
        return []
    }
    const cached = get(deriveMessagingRelays(url, who))
    if (cached.length > 0) {
        return cached
    }
    try {
        const events = await requestOne({
            relay: url,
            filters: messagingRelayFilters(who),
            autoClose: true,
            signal: AbortSignal.timeout(READ_TIMEOUT_MS),
        })

        return messagingRelayUrls(
            ownMessagingRelayList(events as unknown as (RelayListEventLike & { id: string })[], who),
        )
    } catch {
        return []
    }
}

/** What a write attempt did. `''` = the relay took it and handed it back. */
export type MessagingRelayWriteResult = {
    error: string
    /** `true` only when a re-read showed the new list. */
    confirmed: boolean
}

/**
 * The two already-translated sentences this module can produce.
 *
 * Passed in rather than resolved through `./i18n.ts`, and the reason is the chunk graph
 * rather than layering: this module sits in the lazy `/messages` graph, and importing
 * `i18n.ts` there splits it out of the app chunk into a seventh boot chunk — one HTTP
 * request on every page in both hosts, for two strings. Measured per import on
 * 2026-09-05; the table is in the header of `js/privateMessages.ts`.
 */
export type MessagingRelayTexts = {
    /** The relay never delivered the list, so nothing was written. */
    unanswered: string
    /** The relay took the event but did not hand the new list back. */
    notApplied: string
}

/**
 * Replace our own messaging relay list.
 *
 * Order: read our own list → plan → publish → re-read to see whether the relay meant its
 * `OK`. The read is not an optimisation: without its `answered` verdict the plan refuses,
 * and that refusal is the whole protection against replacing a list we have not seen.
 */
export const writeMessagingRelays = async (
    url: string,
    urls: readonly string[],
    spaceKind: SpaceKind,
    texts: MessagingRelayTexts,
): Promise<MessagingRelayWriteResult> => {
    const self = get(pubkey) ?? ''
    const answer = await readOwnMessagingRelays(url, self)
    const plan = planMessagingRelayWrite({
        list: answer.list,
        listAnswered: answer.answered,
        urls,
        self,
        spaceKind,
        now: Math.round(Date.now() / 1000),
    })
    if (!plan) {
        // Silent for every reason but this one — the user has to learn that nothing was
        // written, or they will believe in a list that does not exist.
        return {
            error: answer.answered ? '' : texts.unanswered,
            confirmed: false,
        }
    }
    const failure = await publishOptimistic(
        url,
        makeEvent(plan.kind, { content: plan.content, tags: plan.tags, created_at: plan.created_at }),
    )
    if (failure) {
        return { error: failure, confirmed: false }
    }
    const after = await readOwnMessagingRelays(url, self)
    const confirmed = messagingRelayWriteConfirmed(after.list, messagingRelayUrls({ ...plan, pubkey: self } as RelayListEventLike))

    return {
        error: confirmed ? '' : texts.notApplied,
        confirmed,
    }
}
