/**
 * `$store.privateMessages` — NIP-17 direct messages (P7), the impure half.
 *
 * The rules (what a conversation is, who is in it, what may be sent, where it goes) live
 * in `js/privateMessageModels.ts` and run there under `node --test`. The envelope is
 * `js/giftWrap.ts`, the delivery addresses are `js/messagingRelays.ts`. What is left here
 * is what genuinely needs welshman: a signer, subscriptions, and the wrap manager.
 *
 * ══ This is a SECOND transport, not a replacement ════════════════════════════════
 *
 * The Buzz DM channels (41010/41011/41012, `js/dms.ts`) stay exactly as they are, with
 * their history. They are two different things and the surface says so rather than
 * blurring it:
 *
 *   Buzz DM   an ordinary private CHANNEL. Messages are plaintext kind 9 on the relay,
 *             protected by its access rules. The operator can read them.
 *   NIP-17    a gift wrap. The operator sees a kind 1059 from a key nobody has ever
 *             seen, addressed to one pubkey, and nothing else.
 *
 * Existing conversations do not migrate — a NIP-17 thread starts empty. Nothing could
 * migrate them: the old messages were never encrypted to anybody.
 *
 * ══ What NIP-17 hides here, and what it does not — measured ══════════════════════
 *
 * Content and sender: hidden from everyone including the operator. The wrap is signed by
 * a throwaway key and the author is only inside the seal.
 *
 * **The recipient is not hidden from other members on a zooid space.** Measured on
 * 2026-09-05 against a local slot with a positive control
 * (`p7-messung-d-lesegatter.txt`): a member who is NOT the recipient asked
 * `{"kinds":[1059]}` with no `#p` at all and got every wrap on the relay. Buzz refuses
 * the same request — `restricted: p-gated events require #p matching your pubkey` — and
 * serves the recipient their own. So on zooid every member can count who receives
 * private messages and how many, while what is in them and who sent them stays closed.
 * That sentence is on the surface, because a client that lets its users believe otherwise
 * is worse than one with no encryption at all.
 *
 * ══ Why the reading subscription is not a detail ═════════════════════════════════
 *
 * The `{kinds:[1059], "#p":[me]}` request below is what makes an incoming wrap
 * SOLICITED. `js/wrapOrigin.ts` lets nothing else through to the signer, so a wrap that
 * arrives on any other subscription — including one a hostile relay invents — costs
 * nothing (0 of 25 measured, against 25 of 25 without the check). Change the filter and
 * the check follows it; remove the request and no message ever arrives.
 */
import { get, type Readable, type Unsubscriber } from 'svelte/store'
import { deriveEvents } from '@welshman/store'
import { WRAP, prep, type TrustedEvent } from '@welshman/util'
import { app } from './welshmanApp.ts'
import { pubkey } from './welshmanSession.ts'
import { load, request } from './welshmanNet.ts'
import { activeSpace } from './groups.ts'
import { deriveSpaceKind, type SpaceKind } from './spaceCaps.ts'
import { publishOptimistic } from './publishOptimistic.ts'
import { buildGiftWrap } from './giftWrap.ts'
import type { Readable as StoreReadable } from 'svelte/store'
import { armMessagingRelays, deriveMessagingRelays, fetchMessagingRelays, writeMessagingRelays } from './messagingRelays.ts'
import { MESSAGING_RELAYS } from './messagingRelayModels.ts'
import { mayWriteKind } from './relayCapability.ts'
import { parseDmRecipient } from './dmModels.ts'
import * as nip19 from 'nostr-tools/nip19'
import {
    DIRECT_MESSAGE,
    conversationKey,
    foldPrivateConversations,
    messageTargets,
    planPrivateMessage,
    privateConversationMessages,
    type PrivateConversation,
    type RumorLike,
} from './privateMessageModels.ts'


/**
 * What this module is NOT allowed to import — and why that is a measurement, not taste.
 *
 * `/messages` is the only reader of this store, so the module is loaded with `import()`
 * from `bridge.ts` and lives in that screen's chunk rather than in the app chunk of every
 * page. Rolldown decides the chunk graph from what the boot graph and the lazy graph
 * SHARE, and four modules turned out to be the ones that tip it. Measured on 2026-09-05,
 * one probe build per import, boot chunks in the built manifest:
 *
 *   `./members.ts`        → 9 boot chunks
 *   `./profiles.ts`       → 8
 *   `./spaceProfiles.ts`  → 7
 *   `./i18n.ts`           → 7
 *   nothing of the four   → **6**, the established number
 *
 * Every extra boot chunk is an HTTP request on every page in both hosts, and
 * `bundleGrenze.nodetest.ts` asserts the 6 exactly, because the number is a decision.
 * (`./groups.ts`, `./spaceCaps.ts`, `./dmModels.ts`, `./relayCapability.ts`,
 * `./repository.ts`, `./publishOptimistic.ts` were probed the same way and stay at 6, so
 * they are imported normally.)
 *
 * So the four arrive as parameters instead. The object is built in `bridge.ts`, which is
 * in the boot graph anyway; nothing about it is reactive and nothing is optional — a
 * missing field would be a silent half-working screen, so the type has no `?`.
 */
export type PrivateMessagesDeps = {
    t: (text: string) => string
    displayProfileByPubkey: (pubkey: string) => string
    profilesByPubkey: StoreReadable<unknown>
    warmProfiles: (pubkeys: string[]) => unknown
    deriveSpaceDirectory: (url: string) => StoreReadable<{ members: { pubkey: string; name: string; picture?: string }[] }>
    watchSpaceDirectory: (url: string, signal: AbortSignal) => unknown
}

const noop = (): void => {}

/** How many people the picker offers at once — a dialog list, not a directory. */
const MAX_SUGGESTIONS = 8

/** One row in the conversation list. */
export type ConversationRow = PrivateConversation & { title: string }

/** One message in the open conversation. */
export type MessageRow = {
    id: string
    author: string
    name: string
    mine: boolean
    at: number
    content: string
}

type Candidate = { pubkey: string; name: string; picture?: string }

export type PrivateMessagesStore = {
    /** Has a relay answered for the current space and identity? */
    ready: boolean
    busy: boolean
    /** Literal, already translated wording; `''` = none. */
    error: string
    /** May this user send a gift wrap on the active space at all? */
    canSend: boolean
    /** May this user publish a messaging relay list here? Buzz says no. */
    canListRelays: boolean
    me: string
    spaceUrl: string
    /** The reader's own kind-10050 list. */
    myRelays: string[]
    conversations: ConversationRow[]
    /** The conversation in view; `''` = the list. */
    openKey: string
    messages: MessageRow[]
    draft: string
    /** The person picker for a new conversation. */
    picking: boolean
    picked: string[]
    personDraft: string
    directory: Candidate[]
    mount(): void
    unmount(): void
    openConversation(key: string): void
    closeConversation(): void
    send(): Promise<void>
    startPicking(): void
    stopPicking(): void
    pick(pubkey: string): void
    unpick(pubkey: string): void
    addPersonDraft(): void
    beginConversation(): void
    suggestions(): Candidate[]
    nameOf(pubkey: string): string
    titleOf(others: readonly string[]): string
    publishOwnRelays(): Promise<void>
    dismissError(): void
}

/** Every gift wrap addressed to us. THE filter that makes an incoming wrap solicited. */
export const wrapFilters = (self: string) => [{ kinds: [WRAP], '#p': [self] }]

/**
 * Every kind-14 rumor this session has unwrapped.
 *
 * Straight off the repository and deliberately NOT `deriveEventsForUrl`: a rumor's
 * origin is copied from its wrap by the wrap manager, and our own outgoing message is
 * added to the manager before it has been anywhere, so it has no origin at all yet. A
 * relay-bound derivation would leave the sender staring at a message that did not appear.
 *
 * There is no contamination risk in reading the repository directly here: a kind 14 can
 * only enter it through `WrapManager.add`, which runs exactly once per wrap that our own
 * signer opened.
 */
const derivePrivateRumors = (): Readable<TrustedEvent[]> =>
    deriveEvents({ repository: app.repository, filters: [{ kinds: [DIRECT_MESSAGE] }] })

const createStore = (
    deps: PrivateMessagesDeps,
): { store: PrivateMessagesStore; bind: (reactive: PrivateMessagesStore) => void; start: () => void } => {
    const { t, displayProfileByPubkey, profilesByPubkey, warmProfiles, deriveSpaceDirectory, watchSpaceDirectory } = deps
    let spaceKind: SpaceKind = 'unknown'
    let rumors: RumorLike[] = []
    let mounts = 0
    /** For which `urls|pubkey` the wrap subscription is armed — `''` = for none. */
    let armedWrapsFor = ''
    let wrapController: AbortController | null = null
    let dirController: AbortController | null = null
    let unsubRumors: Unsubscriber = noop
    let unsubDirectory: Unsubscriber = noop
    let unsubOwnRelays: Unsubscriber = noop
    let unsubKind: Unsubscriber = noop
    /** Every write goes here: the raw object before {@link bind}, the reactive proxy after. */
    let self: PrivateMessagesStore

    const me = (): string => get(pubkey) ?? ''

    const store: PrivateMessagesStore = {
        ready: false,
        busy: false,
        error: '',
        canSend: false,
        canListRelays: false,
        me: '',
        spaceUrl: '',
        myRelays: [],
        conversations: [],
        openKey: '',
        messages: [],
        draft: '',
        picking: false,
        picked: [],
        personDraft: '',
        directory: [],

        mount(): void {
            mounts += 1
            armWraps()
        },

        unmount(): void {
            mounts = Math.max(0, mounts - 1)
            if (mounts === 0) {
                // The wrap subscription is the one thing that costs the signer, so it is
                // dropped as soon as no surface is reading it. The Buzz DM channels are
                // unaffected — they are a different transport entirely.
                wrapController?.abort()
                wrapController = null
                armedWrapsFor = ''
                self.picking = false
            }
        },

        openConversation(key: string): void {
            self.openKey = key
            self.draft = ''
            recomputeMessages()
        },

        closeConversation(): void {
            self.openKey = ''
            self.messages = []
        },

        /**
         * Send the draft into the open conversation.
         *
         * One rumor, one wrap per participant INCLUDING the sender. The sender's copy is
         * not a nicety: NIP-17 has no sent folder, and without it a second device of the
         * author never sees what the author wrote.
         */
        async send(): Promise<void> {
            const row = self.conversations.find((entry) => entry.key === self.openKey)
            if (self.busy || !row) {
                return
            }
            await deliver(self.draft, row.others, () => {
                self.draft = ''
            })
        },

        startPicking(): void {
            self.picking = true
            self.picked = []
            self.personDraft = ''
            armDirectory(self.spaceUrl)
        },

        stopPicking(): void {
            self.picking = false
            self.picked = []
            self.personDraft = ''
            disarmDirectory()
        },

        pick(who: string): void {
            if (who && who !== me() && !self.picked.includes(who)) {
                self.picked = [...self.picked, who]
            }
            self.personDraft = ''
        },

        unpick(who: string): void {
            self.picked = self.picked.filter((entry) => entry !== who)
        },

        addPersonDraft(): void {
            const parsed = parseDmRecipient(self.personDraft, nip19.decode)
            if (parsed) {
                self.pick(parsed)
            }
        },

        /**
         * Open the conversation with the picked people — without sending anything.
         *
         * A NIP-17 conversation has no existence of its own; it is the set of people in
         * it. So "starting" one is a purely local act, and the row appears in the list
         * only once a message has actually been exchanged. The empty view in between is
         * honest: there is nothing on any relay yet.
         */
        beginConversation(): void {
            if (self.picked.length === 0) {
                return
            }
            const participants = [...self.picked, me()]
            self.openKey = conversationKey(participants)
            self.picking = false
            self.draft = ''
            recompute()
            recomputeMessages()
        },

        suggestions(): Candidate[] {
            const query = self.personDraft.trim().toLowerCase()
            const taken = new Set([me(), ...self.picked])
            const rows = self.directory.filter((candidate) => !taken.has(candidate.pubkey))
            const hits =
                query === ''
                    ? rows
                    : rows.filter(
                          (candidate) =>
                              candidate.name.toLowerCase().includes(query) || candidate.pubkey.startsWith(query),
                      )

            return hits.slice(0, MAX_SUGGESTIONS)
        },

        nameOf(who: string): string {
            return displayProfileByPubkey(who)
        },

        titleOf(others: readonly string[]): string {
            if (others.length === 0) {
                return t('Nur du')
            }

            return others.map((who) => self.nameOf(who)).join(', ')
        },

        /**
         * Publish the active space relay as our messaging relay.
         *
         * One button and not a free-form editor, on purpose: this client reads private
         * messages on exactly one relay (the active space), so a list naming anything
         * else would be a promise it does not keep. The list is what a FOREIGN client
         * reads to find us — writing an address we do not listen on is worse than
         * writing none.
         */
        async publishOwnRelays(): Promise<void> {
            if (self.busy || !self.spaceUrl) {
                return
            }
            self.busy = true
            self.error = ''
            try {
                const result = await writeMessagingRelays(self.spaceUrl, [self.spaceUrl], spaceKind, {
                    unanswered: t('Der Space hat die Liste nicht ausgeliefert. Es wurde nichts geändert.'),
                    notApplied: t('Der Space hat die Änderung nicht übernommen.'),
                })
                if (result.error) {
                    self.error = result.error
                }
            } finally {
                self.busy = false
            }
        },

        dismissError(): void {
            self.error = ''
        },
    }

    self = store

    /**
     * Seal, wrap and publish one message.
     *
     * Each wrap goes to its own recipient's messaging relays, falling back to the active
     * space (`messageTargets`). The sender's own copy is added to the wrap manager
     * BEFORE it is published: that puts the rumor in the repository at once, so the
     * message appears immediately, and it also stops `Wraps` from decrypting our own
     * wrap when the relay echoes it back (`enqueue` skips a wrap whose rumor it knows).
     */
    const deliver = async (text: string, recipients: readonly string[], onSent: () => void): Promise<void> => {
        const author = me()
        const signer = app.user?.signer
        if (!signer || !self.spaceUrl) {
            return
        }
        const draft = planPrivateMessage({
            text,
            recipients,
            self: author,
            spaceKind,
            now: Math.round(Date.now() / 1000),
        })
        if (!draft) {
            return
        }
        self.busy = true
        self.error = ''
        try {
            // One rumor for every wrap — the same id everywhere, so the receivers and
            // the sender's own devices agree that this is ONE message.
            const rumor = prep(draft.template as never, author)
            let landed = 0
            let lastError = ''
            for (const recipient of draft.wrapFor) {
                const listed = await fetchMessagingRelays(self.spaceUrl, recipient)
                const targets = messageTargets(listed, self.spaceUrl)
                if (targets.length === 0) {
                    continue
                }
                const wrap = await buildGiftWrap({
                    sender: signer,
                    recipient,
                    template: rumor as never,
                    now: Math.round(Date.now() / 1000),
                })
                if (recipient === author) {
                    app.wrapManager.add({ recipient, wrap, rumor: rumor as never })
                }
                const failure = await publishOptimistic(targets, wrap)
                if (failure) {
                    lastError = failure
                } else {
                    landed += 1
                }
            }
            if (landed === 0) {
                self.error = lastError || t('Die Nachricht konnte nirgends zugestellt werden.')

                return
            }
            if (lastError) {
                // Partial delivery is a real state, not an error: one participant's relay
                // may be down while the others took it. Saying nothing would be a lie in
                // the other direction.
                self.error = t('Nicht alle Beteiligten konnten erreicht werden.')
            }
            onSent()
            recompute()
            recomputeMessages()
        } finally {
            self.busy = false
        }
    }

    const recompute = (): void => {
        const author = me()
        const rows = foldPrivateConversations(rumors, author)
        const known = new Set(rows.map((row) => row.key))
        self.conversations = rows.map((row) => ({ ...row, title: self.titleOf(row.others) }))
        // A conversation the reader just opened from the picker has no messages yet, so
        // the fold does not know it. Keeping the key alive is what lets the first message
        // be written at all.
        if (self.openKey && !known.has(self.openKey)) {
            const others = self.openKey.split(',').filter((who) => who !== author)
            self.conversations = [
                {
                    key: self.openKey,
                    participants: self.openKey.split(','),
                    others,
                    lastAt: 0,
                    preview: '',
                    count: 0,
                    title: self.titleOf(others),
                },
                ...self.conversations,
            ]
        }
        void warmProfiles(Array.from(new Set(self.conversations.flatMap((row) => row.others))))
    }

    const recomputeMessages = (): void => {
        const author = me()
        if (!self.openKey) {
            self.messages = []

            return
        }
        self.messages = privateConversationMessages(rumors, author, self.openKey).map((rumor) => ({
            id: rumor.id,
            author: rumor.pubkey,
            name: self.nameOf(rumor.pubkey),
            mine: rumor.pubkey === author,
            at: rumor.created_at,
            content: rumor.content,
        }))
    }

    /**
     * Ask for our own wraps.
     *
     * Backlog through `load`, live through an open `request` — the same pair as every
     * other reading surface here. Both carry `{kinds:[1059], "#p":[me]}`, which is also
     * the shape Buzz requires: it refuses any kind-1059 request whose `#p` is not the
     * authenticated pubkey (measured, `p7-messung-d-lesegatter.txt`).
     */
    const armWraps = (): void => {
        const author = me()
        const urls = Array.from(new Set([...(self.myRelays ?? []), self.spaceUrl].filter(Boolean)))
        const key = `${urls.join('|')}|${author}`
        if (mounts === 0 || armedWrapsFor === key || urls.length === 0 || !author) {
            return
        }
        armedWrapsFor = key
        wrapController?.abort()
        wrapController = new AbortController()
        void load({ relays: urls, filters: wrapFilters(author) }).catch(noop)
        void request({
            relays: urls,
            signal: wrapController.signal,
            filters: wrapFilters(author).map((filter) => ({ ...filter, limit: 0 })),
        }).catch(noop)
    }

    const armDirectory = (url: string): void => {
        if (dirController || !url) {
            return
        }
        dirController = new AbortController()
        watchSpaceDirectory(url, dirController.signal)
        unsubDirectory = deriveSpaceDirectory(url).subscribe((dir) => {
            self.directory = dir.members.map((member) => ({
                pubkey: member.pubkey,
                name: member.name,
                picture: member.picture,
            }))
        })
    }

    const disarmDirectory = (): void => {
        dirController?.abort()
        dirController = null
        unsubDirectory()
        unsubDirectory = noop
        self.directory = []
    }

    const recomputePermission = (): void => {
        self.me = me()
        self.canSend = Boolean(self.me) && mayWriteKind(WRAP, spaceKind)
        self.canListRelays = Boolean(self.me) && mayWriteKind(MESSAGING_RELAYS, spaceKind)
    }

    const armSpace = (url: string): void => {
        const author = me()
        self.spaceUrl = url
        armMessagingRelays(url, author)
        unsubOwnRelays()
        unsubOwnRelays = deriveMessagingRelays(url, author).subscribe((urls: string[]) => {
            self.myRelays = urls
            armWraps()
        })
        armWraps()
    }

    const start = (): void => {
        unsubRumors = derivePrivateRumors().subscribe((events: TrustedEvent[]) => {
            rumors = events as unknown as RumorLike[]
            self.ready = true
            recompute()
            recomputeMessages()
        })
        activeSpace.subscribe((url: string) => {
            if (!url) {
                return
            }
            // The relay kind decides whether we may write at all, and it arrives late.
            // Subscribed rather than read once — the documented way this kind of surface
            // breaks in this repo.
            unsubKind()
            unsubKind = deriveSpaceKind(url).subscribe((kind: SpaceKind) => {
                spaceKind = kind
                recomputePermission()
            })
            armSpace(url)
        })
        // The pubkey is a second, independent arrival: the session store can resolve
        // after `activeSpace` has already emitted.
        pubkey.subscribe(() => {
            recomputePermission()
            armedWrapsFor = ''
            armSpace(self.spaceUrl)
            recompute()
            recomputeMessages()
        })
        // A participant's display name arrives with their profile, long after the row.
        profilesByPubkey.subscribe(() => {
            if (self.conversations.length > 0 || self.messages.length > 0) {
                recompute()
                recomputeMessages()
            }
        })
    }

    return {
        store,
        bind: (reactive: PrivateMessagesStore): void => {
            self = reactive
        },
        start,
    }
}

export function wirePrivateMessages(
    Alpine: { store: (name: string, value?: unknown) => unknown },
    deps: PrivateMessagesDeps,
): void {
    if (Alpine.store('privateMessages')) {
        return
    }
    const { store, bind, start } = createStore(deps)
    Alpine.store('privateMessages', store)
    // From here the store writes only into the reactive proxy — same reason and same
    // shape as `wireMutes`/`wireBookmarks`: a closure that keeps mutating the raw object
    // changes values Alpine never hears about.
    bind(Alpine.store('privateMessages') as PrivateMessagesStore)
    start()
}
