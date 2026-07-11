/**
 * Room-Chat-Feed (M4, read-only) — inspiriert von `makeFeed` des Referenz-Clients,
 * aber schlank für die Alpine-Insel: statt bidirektionalem Sliding-Window-Scroller
 * eine Live-Subscription (`limit:0`) + Cursor-Pagination (`until`) über die
 * ohnehin reaktive `deriveEventsForUrl`-Ableitung. Senden kommt mit M5.
 *
 * NIP-29: Room-Nachrichten sind **kind 9** (`MESSAGE`) mit `#h`=Room-ID, auf dem
 * Space-Relay. AUTH (NIP-42) läuft automatisch über die Socket-Policy.
 */
import { derived, get, type Readable } from 'svelte/store'
import { load, request } from '@welshman/net'
import { profilesByPubkey, publishThunk, waitForThunkError, pubkey, repository, displayProfileByPubkey, handlesByNip05, zappersByLnurl } from '@welshman/app'
import { parse, renderAsHtml, ParsedType } from '@welshman/content'
import { sanitizeUrl } from '@braintree/sanitize-url'
import { MESSAGE, DELETE, REACTION, POLL, POLL_RESPONSE, ZAP_RESPONSE, ZAP_GOAL, makeEvent, sortEventsAsc, getTag, getTagValue, getLnUrl, fromMsats, zapFromEvent, type TrustedEvent, type Zap, type Zapper } from '@welshman/util'
import { groupBy, uniq, uniqBy } from '@welshman/lib'
import * as nip19 from 'nostr-tools/nip19'
import { deriveEventsForUrl } from './repository'
import { throttled } from '@welshman/store'
import { warmZappers } from './zaps'
import { roomTags, makeReaction, makeEventDelete, makeReport, makePoll, makePollResponse, makeGoal, mentionPubkeys } from './interactions'
import { getPollEndsAt, getPollResults, getPollType, isPollClosed, isPollShareQuote, ownPollSelection, pollResponseTarget, QUOTE_PREFIX, type PollOption, type PollType } from './polls'
import { getGoalSummary, getGoalTargetSats, getGoalTitle, goalProgress } from './goals'
import { proxifyImage } from './core'
import { warmProfiles } from './profiles'
import { warmHandles, verifiedNip05 } from './handles'

/** Endet die URL auf eine Bild-Extension? (wie welshmans `isImage`, ohne Query.) */
const IMAGE_URL = /\.(jpe?g|png|gif|webp)$/i

/**
 * `renderLink`-Override für welshman/content: Bild-URLs werden zu einem `<img>`
 * über den Bild-Proxy (Preset `msg`, `data-full` = `full` für die Lightbox) statt
 * zu einem Textlink. Alles andere (Web-Links, njump-Entities) bleibt ein sicherer
 * Anker. `document.createElement` escaped Attribute/Text beim `outerHTML`.
 */
const renderMessageLink = (href: string, display: string): string => {
    if (IMAGE_URL.test(href)) {
        const img = document.createElement('img')
        img.className = 'chat-image'
        img.loading = 'lazy'
        img.src = proxifyImage(href, 'msg')
        img.dataset.full = proxifyImage(href, 'full')
        img.alt = ''
        return img.outerHTML
    }
    const a = document.createElement('a')
    a.href = sanitizeUrl(href)
    a.target = '_blank'
    a.rel = 'noopener noreferrer'
    a.innerText = display
    return a.outerHTML
}

/**
 * Custom-Emoji (NIP-30) als kleines Inline-`<img>` über den Bild-Proxy. Nur
 * `https`-URLs werden zum Bild — sonst `null` → welshman rendert den Shortcode
 * als Text (kein Bild mit beliebigem `src`). `createElement` escaped Attribute.
 */
const renderEmojiImg = (name: string, url: string | undefined): string | null => {
    if (!url || !/^https:\/\//i.test(url)) {
        return null
    }
    const img = document.createElement('img')
    img.className = 'chat-emoji'
    img.loading = 'lazy'
    img.src = proxifyImage(url, 'avatar')
    img.alt = img.title = `:${name}:`
    return img.outerHTML
}

const roomFilter = (h: string) => [{ kinds: [MESSAGE], '#h': [h] }]

/** Nachrichten, Polls UND Zap-Goals eines Raums — alle zeitlich verwoben im Verlauf. */
const roomStreamFilter = (h: string) => [{ kinds: [MESSAGE, POLL, ZAP_GOAL], '#h': [h] }]

/** kind-7-Reactions eines Raums (NIP-25) — tragen `#h` vom Parent (via makeReaction). */
const roomReactionFilter = (h: string) => [{ kinds: [REACTION], '#h': [h] }]

/** kind-1018-Poll-Responses eines Raums (NIP-88) — tragen `#h` vom Poll (via makePollResponse). */
const roomPollResponseFilter = (h: string) => [{ kinds: [POLL_RESPONSE], '#h': [h] }]

/**
 * kind-9735-Zap-Receipts (NIP-57): tragen KEIN `#h` — der LNURL-Server kopiert nur
 * `p`/`e`/`bolt11`/`description` ins Receipt. Deshalb hier ungefiltert je Space-Relay;
 * die Zuordnung zur Nachricht + Validierung läuft in `aggregateZaps` über `#e`.
 */
const roomZapReceiptFilter = () => [{ kinds: [ZAP_RESPONSE] }]

/** Aufsteigend sortierter Chat-Verlauf eines Rooms (Nachrichten + Polls, reaktiv). */
const deriveRoomMessages = (url: string, h: string): Readable<TrustedEvent[]> =>
    derived(deriveEventsForUrl(url, roomStreamFilter(h)), (events) => {
        // Native Poll-Karten (kind 1068) zeigen die Frage bereits — die kind-9-Share-Quote,
        // die wir NUR für Flotilla mitposten, hier ausblenden, sonst erschiene sie doppelt.
        const pollIds = new Set(events.filter((e) => e.kind === POLL).map((e) => e.id))
        return sortEventsAsc(events.filter((e) => !isPollShareQuote(e, pollIds)))
    })

/** Rohtext einer Nachricht ohne den vorangestellten Reply-Quote (für Snippets + Edit-Prefill). */
export const bodyWithoutQuote = (event: TrustedEvent): string =>
    getTagValue('q', event.tags) ? event.content.replace(QUOTE_PREFIX, '') : event.content

/**
 * Rendert den Nachrichtentext zu sicherer HTML (Text escaped, URLs sanitized).
 * Bei Replies wird das vorangestellte `nostr:nevent…` entfernt (trimParent) —
 * das Zitat zeigt stattdessen die kompakte Vorschau (siehe `deriveRoomChat`).
 */
const renderMentionSpan = (pubkey: string): string => {
    const span = document.createElement('span')
    span.className = 'mention'
    span.textContent = `@${displayProfileByPubkey(pubkey)}`
    return span.outerHTML
}

const htmlCache = new Map<string, string>()
const renderMessageHtml = (event: TrustedEvent): string => {
    let html = htmlCache.get(event.id)
    if (html === undefined) {
        // welshman rendert Custom-Emoji (NIP-30) per Default als Text-Shortcode
        // (`renderEmoji` ist NICHT als Option überschreibbar) — darum Emoji-Nodes
        // mit https-URL selbst zu Inline-<img> rendern, alle anderen Nodes an
        // welshman geben (Text-Escaping, Links über den Proxy, Newlines).
        // Profil-Mentions (NIP-27) rendert welshman als gekürztes `nprofile…` —
        // wir lösen sie stattdessen zu `@Name` auf (displayProfileByPubkey).
        let hasMention = false
        html = parse({ content: bodyWithoutQuote(event), tags: event.tags })
            .map((node) => {
                if (node.type === ParsedType.Emoji) {
                    const img = renderEmojiImg(node.value.name, node.value.url)
                    if (img !== null) {
                        return img
                    }
                }
                if (node.type === ParsedType.Profile) {
                    hasMention = true
                    return renderMentionSpan(node.value.pubkey)
                }
                return renderAsHtml([node], { renderLink: renderMessageLink }).toString()
            })
            .join('')
        // Nur Mention-freie Nachrichten cachen: der Name eines Mentions lädt async
        // nach (Profil kommt später) → ein gecachtes `@npub…`-Fallback bliebe für
        // immer eingefroren. Ohne Mention ist die HTML statisch (Cache lohnt sich).
        if (!hasMention) {
            htmlCache.set(event.id, html)
        }
    }
    return html
}

const startOfDay = (d: Date): number => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()

const dayLabel = (ts: number): string => {
    const d = new Date(ts * 1000)
    const diffDays = Math.round((startOfDay(new Date()) - startOfDay(d)) / 86_400_000)
    if (diffDays === 0) {
        return 'Heute'
    }
    if (diffDays === 1) {
        return 'Gestern'
    }
    return d.toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric' })
}

const timeLabel = (ts: number): string =>
    new Date(ts * 1000).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })

/** Volles Datum+Uhrzeit für den Zeilen-Tooltip (`:title`). */
const fullTimeLabel = (ts: number): string =>
    new Date(ts * 1000).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' })

/** Kompakte Vorschau der zitierten Nachricht (aufgelöst im selben Raum). */
export type ReplyPreview = { id: string; name: string; text: string }

/**
 * Aggregierte Reaction (NIP-25) einer Nachricht: pro Emoji ein Chip mit Zähler und
 * eigenem Toggle-Zustand. `emojiUrl` ist bei Custom-Emoji (NIP-30) das proxifizierte
 * Inline-Bild, sonst ''. `content`/`emojiTag` bilden die Reaction beim Toggle
 * originalgetreu nach; `mineId` ist die eigene kind-7 (für den Delete-Toggle).
 */
export type ReactionChip = {
    key: string // Gruppierungsschlüssel (= content)
    content: string // Reaction-Content ('+', '👍', ':shortcode:')
    label: string // Anzeige für Unicode ('+'→👍, '-'→👎, sonst content)
    emojiUrl: string // proxifiziertes Custom-Emoji-Bild (https) oder ''
    emojiTag: string[] | null // ['emoji', shortcode, url] für den Toggle-Rebuild
    count: number
    mine: boolean // hat der eingeloggte User so reagiert?
    mineId: string // id der eigenen kind-7 (leer, wenn nicht mine)
    names: string // Nostr-Namen der Reagierenden (kommagetrennt) → Chip-Tooltip
}

/** `:shortcode:` → Custom-Emoji-Name, sonst null. */
const CUSTOM_EMOJI = /^:([a-z0-9_+-]+):$/i

/** Unicode-Anzeige einer Standard-Reaction: '+'/leer = 👍, '-' = 👎, sonst wörtlich. */
const reactionLabel = (content: string): string => {
    if (content === '+' || content === '') {
        return '👍'
    }
    if (content === '-') {
        return '👎'
    }
    return content
}

/**
 * Gruppiert die kind-7-Reactions einer Nachricht zu Chips: dedupliziert pro
 * (Autor, Emoji), zählt, markiert die eigene Reaction. So macht es der Referenz-
 * Client (`ReactionSummary`), nur ohne Zap/Report (eigene Phasen).
 */
const aggregateReactions = (
    reactions: TrustedEvent[],
    me: string | null | undefined,
    nameOf: (pubkey: string) => string,
): ReactionChip[] => {
    const byKey = groupBy((r) => r.content, uniqBy((e) => `${e.pubkey}${e.content}`, reactions))
    return [...byKey.entries()].map(([content, events]): ReactionChip => {
        const custom = CUSTOM_EMOJI.exec(content)
        const emojiTag = custom ? getTag('emoji', events[0].tags) : undefined
        const emojiSrc = custom && emojiTag?.[2] && /^https:\/\//i.test(emojiTag[2]) ? emojiTag[2] : ''
        const mineEvent = me ? events.find((e) => e.pubkey === me) : undefined
        return {
            key: content,
            content,
            label: reactionLabel(content),
            emojiUrl: emojiSrc ? proxifyImage(emojiSrc, 'avatar') : '',
            emojiTag: emojiTag ?? null,
            count: events.length,
            mine: Boolean(mineEvent),
            mineId: mineEvent?.id ?? '',
            names: events.map((e) => nameOf(e.pubkey)).join(', '),
        }
    })
}

/** Aggregierte Zap-Sicht einer Nachricht (⚡-Chip): Anzahl, Sats-Summe, eigener Anteil. */
export type ZapSummary = {
    count: number // Anzahl valider Zaps (nach `zapFromEvent`-Prüfung)
    contributors: number // Anzahl EINDEUTIGER Zapper (Flotilla-Goal-Parität: uniq(request.pubkey))
    sats: number // Summe in Sats (bolt11-`invoiceAmount`, msats→sats)
    mine: boolean // hat der eingeloggte User (mit)gezappt?
    names: string // Namen der Zapper (kommagetrennt, dedupliziert) → Chip-Tooltip
}

/**
 * Validiert + summiert die kind-9735-Receipts EINER Nachricht — NIE roh summieren
 * (Anti-Spoof). `zapFromEvent` prüft bolt11↔`amount`-Tag, `lnurl` und den Receipt-
 * Signer (`response.pubkey === zapper.nostrPubkey`). Ohne aufgelösten Zapper (Autor-
 * lud16 noch nicht gewärmt) bleibt die Summe leer. (welshmans Selbst-Zap-Guard greift
 * hier nicht — er prüft `zapper.pubkey`, das store-geladene LNURL-Zapper nicht tragen;
 * Selbst-Zaps auf eigene Nachrichten verhindert ohnehin das `zappable`-Gate im UI.)
 */
export const aggregateZaps = (
    receipts: TrustedEvent[],
    zapper: Zapper | undefined,
    me: string | null | undefined,
    nameOf: (pubkey: string) => string,
): ZapSummary => {
    const zaps = receipts.map((r) => zapFromEvent(r, zapper)).filter((z): z is Zap => Boolean(z))
    return {
        count: zaps.length,
        contributors: uniq(zaps.map((z) => z.request.pubkey)).length,
        sats: fromMsats(zaps.reduce((sum, z) => sum + z.invoiceAmount, 0)),
        mine: zaps.some((z) => z.request.pubkey === me),
        names: uniq(zaps.map((z) => nameOf(z.request.pubkey))).join(', '),
    }
}

export type ChatMessage = {
    id: string
    pubkey: string
    created_at: number
    time: string
    fullTime: string // Datum+Uhrzeit für den Tooltip
    name: string
    nip05: string // verifizierter NIP-05-Handle (leer = kein Häkchen)
    picture: string
    html: string
    divider: string // Datums-Trenner, wenn der Tag wechselt (sonst '')
    unreadDivider: boolean // erste ungelesene Fremd-Nachricht (Last-Read-Grenze)
    showAuthor: boolean // erster Beitrag eines Autor-Blocks (Gruppierung)
    mine: boolean // vom eingeloggten User verfasst (→ löschbar, M5)
    reply: ReplyPreview | null // zitierte Nachricht (q-Tag), sonst null
    reactions: ReactionChip[] // aggregierte kind-7-Reactions (C1), leer = keine
    poll: PollView | null // NIP-88-Poll (kind 1068) mit Live-Tally + eigenem Vote (C5), sonst null
    goal: GoalView | null // NIP-75-Zap-Goal (kind 9041) mit Fortschritt aus dem Zap-Tally (Z5), sonst null
    zaps: ZapSummary // validierte kind-9735-Zap-Summe (Z3), count 0 = keine
    zappable: boolean // Autor kann Zaps empfangen (lud16/lud06) UND ist nicht man selbst
}

/** Eine Poll-Option mit Live-Zähler, Balkenbreite (0–100 %) und eigenem Vote-Zustand. */
export type PollOptionView = { id: string; label: string; votes: number; pct: number; mine: boolean }

/**
 * Render-fertige NIP-88-Poll: Optionen mit Tally, Typ-/End-Label und Wählerzahl.
 * `multi` steuert die Auswahllogik (Einfach-/Mehrfachwahl), `closed` sperrt das Voten.
 */
export type PollView = {
    multi: boolean
    typeLabel: string // 'Einfachwahl' | 'Mehrfachwahl'
    closed: boolean
    endsLabel: string // '' oder 'Endet …'/'Beendet …'
    voters: number
    options: PollOptionView[]
}

/**
 * Baut die Render-Sicht einer Poll aus dem kind-1068-Event + ihren kind-1018-Responses:
 * Stimmen (jüngste je Wähler zählt), Balkenbreite relativ zur Gewinner-Option, eigener
 * Vote markiert. Pure Logik aus `polls.ts`; hier nur zur UI-Form verdichtet.
 */
const buildPollView = (event: TrustedEvent, responses: TrustedEvent[], me: string | null | undefined): PollView => {
    const { options, voters } = getPollResults(event, responses)
    const mine = new Set(ownPollSelection(event, responses, me))
    const maxVotes = Math.max(...options.map((o) => o.votes), 1)
    const endsAt = getPollEndsAt(event)
    const closed = isPollClosed(event)
    const multi = getPollType(event) === 'multiplechoice'
    return {
        multi,
        typeLabel: multi ? 'Mehrfachwahl' : 'Einfachwahl',
        closed,
        endsLabel: endsAt ? `${closed ? 'Beendet' : 'Endet'} ${fullTimeLabel(endsAt)}` : '',
        voters,
        options: options.map((o) => ({
            id: o.id,
            label: o.label,
            votes: o.votes,
            pct: Math.round((o.votes / maxVotes) * 100),
            mine: mine.has(o.id),
        })),
    }
}

/**
 * Render-fertiges NIP-75-Zap-Goal: Titel/Details, Ziel + gesammelte Sats (aus dem
 * validierten 9735-Tally, `ZapSummary`), Fortschritt (0–100 %) und Beitragenden-Zahl.
 */
export type GoalView = {
    title: string
    summary: string
    targetSats: number
    raisedSats: number
    pct: number
    reached: boolean
    contributors: number
}

/**
 * Verdichtet ein kind-9041-Event + seinen Zap-Tally zur Goal-Karte. `zaps` ist die
 * bereits validierte `aggregateZaps`-Summe der Receipts mit `#e` = goal.id (dieselbe
 * Anti-Spoof-Pipeline wie Nachrichten-Zaps) — hier NUR gegen das Ziel verglichen.
 */
const buildGoalView = (event: TrustedEvent, zaps: ZapSummary): GoalView => {
    const targetSats = getGoalTargetSats(event)
    const { pct, reached } = goalProgress(targetSats, zaps.sats)
    return {
        title: getGoalTitle(event),
        summary: getGoalSummary(event),
        targetSats,
        raisedSats: zaps.sats,
        pct,
        reached,
        contributors: zaps.contributors,
    }
}

/** Last-Read-Timestamp pro Raum (localStorage, Single-Device — kein Nostr-Kind). */
const lastReadKey = (url: string, h: string): string => `room:lastread:${url}:${h}`

export const readRoomLastRead = (url: string, h: string): number => {
    const v = Number(localStorage.getItem(lastReadKey(url, h)))
    return Number.isFinite(v) ? v : 0
}

export const writeRoomLastRead = (url: string, h: string, ts: number): void => {
    try {
        localStorage.setItem(lastReadKey(url, h), String(ts))
    } catch {
        // localStorage nicht verfügbar (Private-Mode/Quota) — Divider bleibt aus, kein Fehler.
    }
}

/** Snippet aus Rohtext: Whitespace kollabiert + auf Länge gekürzt. */
const snippet = (text: string, max = 120): string => {
    const clean = text.replace(/\s+/g, ' ').trim()
    return clean.length > max ? `${clean.slice(0, max)}…` : clean
}

/**
 * Aggregierte Chat-Sicht: Nachrichten mit aufgelösten Profilen, Datums-Dividern
 * und Autor-Gruppierung — die Insel braucht nur EIN `subscribe`. HTML wird je
 * Event einmal geparst (Cache), Namen fließen reaktiv aus `profilesByPubkey`.
 */
export const deriveRoomChat = (url: string, h: string, lastRead = 0): Readable<ChatMessage[]> =>
    derived(
        [
            // Nachrichten UNgedrosselt: neue/eigene Message + scrollToBottom bleiben sofort.
            deriveRoomMessages(url, h),
            // Zweite Welle (nicht warmgehalten): Profile, NIP-05, Reactions, Poll-Responses,
            // Zap-Receipts, Zapper laden beim Kaltstart als Event-Burst nach. Gedrosselt, damit
            // der Chip-Einblende-Burst zu wenigen Emits zusammenfällt → weniger Layout-Shifts
            // und Anker-Scans (Muster: members.ts deriveSpaceDirectory). Reihenfolge = Destructuring.
            throttled(200, profilesByPubkey),
            pubkey,
            throttled(200, handlesByNip05),
            throttled(200, deriveEventsForUrl(url, roomReactionFilter(h))),
            throttled(200, deriveEventsForUrl(url, roomPollResponseFilter(h))),
            throttled(200, deriveEventsForUrl(url, roomZapReceiptFilter())),
            throttled(200, zappersByLnurl),
        ],
        ([events, $profiles, $me, $handles, $reactions, $pollResponses, $zaps, $zappers]) => {
        // Reactions nach Ziel-Nachricht (`#e`) bündeln — je Nachricht einmal aggregiert.
        // Reactions ohne `e`-Tag landen im ''-Bucket und werden nie abgerufen (event.id ≠ '').
        const reactionsByTarget = groupBy((r) => getTagValue('e', r.tags) ?? '', $reactions)
        // Poll-Responses nach Ziel-Poll (`["e", pollId]`) bündeln — je Poll einmal getallyt.
        const pollResponsesByTarget = groupBy((r) => pollResponseTarget(r), $pollResponses)
        // Zap-Receipts (9735) nach Ziel-Nachricht (`#e`) bündeln — je Nachricht validiert
        // getallyt. 9735 trägt kein `#h`, `#e` ist der einzige verlässliche Raumbezug.
        const zapsByTarget = groupBy((r) => getTagValue('e', r.tags) ?? '', $zaps)
        // First-Paint-Seed: fehlende Autor- UND erwähnte Profile (NIP-27) vom geteilten
        // Backend-Cache holen (dedupliziert intern; welshman löst parallel live auf).
        // Ohne die Mention-Pubkeys blieben extern referenzierte @-Mentions (Nicht-
        // Mitglieder/gepastete npubs) dauerhaft als gekürztes npub statt @Name. Fire-and-forget.
        void warmProfiles([...events.map((e) => e.pubkey), ...events.flatMap((e) => mentionPubkeys(bodyWithoutQuote(e)))])
        // NIP-05-Handles der Autoren lazy verifizieren (dedupliziert, fire-and-forget).
        warmHandles(events.map((e) => e.pubkey))
        // Zapper (LNURL-pay-Meta) der Autoren lazy laden — nötig, um ihre 9735-Receipts
        // zu validieren (Signer-Check) und den ⚡-Chip zu summieren (dedupliziert intern).
        warmZappers(events.map((e) => e.pubkey))
        const nameOf = displayProfileByPubkey
        // Index für die Reply-Auflösung im selben Raum (q-Tag → zitierte Nachricht).
        const byId = new Map(events.map((e) => [e.id, e]))

        let prevDay = ''
        let prevPubkey = ''
        let unreadShown = false
        return events.map((event, idx): ChatMessage => {
            const day = dayLabel(event.created_at)
            const divider = day !== prevDay ? day : ''
            const showAuthor = event.pubkey !== prevPubkey || divider !== ''
            prevDay = day
            prevPubkey = event.pubkey

            const mine = event.pubkey === $me
            // Trennlinie vor der ersten Fremd-Nachricht jenseits der Last-Read-Grenze.
            // `idx > 0`: keine Grenze, wenn ohnehin der ganze Verlauf ungelesen ist.
            const unreadDivider = !unreadShown && lastRead > 0 && idx > 0 && event.created_at > lastRead && !mine
            if (unreadDivider) {
                unreadShown = true
            }

            const quotedId = getTagValue('q', event.tags)
            const quoted = quotedId ? byId.get(quotedId) : undefined
            const reply: ReplyPreview | null = quoted
                ? { id: quoted.id, name: nameOf(quoted.pubkey), text: snippet(bodyWithoutQuote(quoted)) }
                : null

            const profile = $profiles.get(event.pubkey)
            // Zapper des Autors aus dem gewärmten `zappersByLnurl`-Store (lud16/lud06 → lnurl).
            // Ohne aufgelösten Zapper zählt `aggregateZaps` nichts (Signer nicht prüfbar).
            // `||` (nicht `??`): welshmans makeProfile bevorzugt lud16, fällt aber bei
            // LEEREM lud16 auf lud06 zurück — der Store ist dann unter der lud06-lnurl
            // gekeyt. `??` würde `lud16: ''` nicht durchfallen lassen → Store-Miss.
            const lnurl = getLnUrl(profile?.lud16 || profile?.lud06 || '')
            const zapper = lnurl ? $zappers.get(lnurl) : undefined
            // Zap-Tally einmal berechnen — Nachrichten-Chip UND (bei kind 9041) der
            // Goal-Fortschritt speisen sich aus derselben validierten Summe.
            const zaps = aggregateZaps(zapsByTarget.get(event.id) ?? [], zapper, $me, nameOf)
            return {
                id: event.id,
                pubkey: event.pubkey,
                created_at: event.created_at,
                time: timeLabel(event.created_at),
                fullTime: fullTimeLabel(event.created_at),
                name: nameOf(event.pubkey),
                nip05: verifiedNip05(event.pubkey, $profiles, $handles),
                picture: profile?.picture ?? '',
                html: renderMessageHtml(event),
                divider,
                unreadDivider,
                showAuthor,
                mine,
                reply,
                reactions: aggregateReactions(reactionsByTarget.get(event.id) ?? [], $me, nameOf),
                poll: event.kind === POLL ? buildPollView(event, pollResponsesByTarget.get(event.id) ?? [], $me) : null,
                goal: event.kind === ZAP_GOAL ? buildGoalView(event, zaps) : null,
                zaps,
                zappable: !mine && Boolean(lnurl),
            }
        })
    },
    )

/**
 * Öffnet eine Live-Subscription für NEUE Room-Events (bleibt bis abort offen):
 * Nachrichten (kind 9), Reactions (kind 7) und Tombstones (kind 5) — alle `#h`.
 * So erscheinen Fremd-Reactions und -Löschungen live, ohne separate Subscription.
 */
export const listenRoom = (url: string, h: string, signal: AbortSignal): void => {
    void request({
        relays: [url],
        signal,
        filters: [{ kinds: [MESSAGE, REACTION, DELETE, POLL, POLL_RESPONSE, ZAP_GOAL], '#h': [h], limit: 0 }],
    })
}

/**
 * Lädt bestehende Polls (kind 1068) + Poll-Responses (kind 1018) eines Raums beim
 * ersten Öffnen (die Live-Sub liefert nur Neues). Kein Paging — Polls sind pro Raum
 * überschaubar; das Tally braucht alle Responses.
 */
export const loadRoomPolls = (url: string, h: string): Promise<TrustedEvent[]> =>
    load({ relays: [url], filters: [{ kinds: [POLL, POLL_RESPONSE], '#h': [h] }] })

/**
 * Lädt bestehende Zap-Goals (kind 9041) eines Raums beim ersten Öffnen (die Live-Sub
 * liefert nur Neues). Die Beiträge (9735 mit `#e` = goal.id) kommen über `loadRoomZaps`
 * (die Goal-IDs stecken als Feed-Nachrichten in der ID-Liste). Kein Paging.
 */
export const loadRoomGoals = (url: string, h: string): Promise<TrustedEvent[]> =>
    load({ relays: [url], filters: [{ kinds: [ZAP_GOAL], '#h': [h] }] })

/**
 * Lädt die bestehenden Reactions (kind 7) + Tombstones (kind 5) eines Raums, damit
 * bereits vorhandene Reaction-Chips beim ersten Öffnen sichtbar sind (die Live-Sub
 * liefert nur NEUE Events). Kein `until`-Paging — Reactions sind pro Raum überschaubar.
 */
export const loadRoomReactions = (url: string, h: string): Promise<TrustedEvent[]> =>
    load({ relays: [url], filters: [{ kinds: [REACTION, DELETE], '#h': [h] }] })

/**
 * Lädt bestehende kind-9735-Zap-Receipts für die übergebenen Nachrichten-IDs, damit
 * ⚡-Chips beim Öffnen/Nachladen sofort stimmen (die Live-Sub liefert nur Neues).
 * 9735 trägt KEIN `#h` (der LNURL-Server kopiert nur `p`/`e`/`bolt11`/`description`)
 * → Filter zwingend über `#e` (Message-IDs), nicht `#h`. Leere ID-Liste = kein Load.
 * ponytail: One-shot pro neuer ID; eigene Zaps landen ohnehin sofort (payZapAuto/
 * watchZapReceipt) — eine separate Live-Sub auf Fremd-Zaps wäre erst nötig, wenn
 * Echtzeit-Tally fremder Zaps ohne Feed-Reload gefordert ist.
 */
export const loadRoomZaps = (url: string, eventIds: string[]): Promise<TrustedEvent[]> =>
    eventIds.length ? load({ relays: [url], filters: [{ kinds: [ZAP_RESPONSE], '#e': eventIds }] }) : Promise.resolve([])

/**
 * Lädt Room-Nachrichten vom Space-Relay: die jüngsten (initial) oder — mit
 * `until` — die nächstälteren. Gibt die geladenen Events zurück (für „hasMore").
 */
export const loadRoomMessages = (url: string, h: string, until?: number): Promise<TrustedEvent[]> =>
    load({ relays: [url], filters: roomFilter(h).map((f) => ({ ...f, limit: 50, ...(until ? { until } : {}) })) })

// ── Schreiben (M5) ───────────────────────────────────────────────────────────

/** Ziel einer Antwort: die zitierte Nachricht (id + Autor). */
export type ReplyTarget = { id: string; pubkey: string }

/**
 * Hängt `["p", pk, url]`-Tags für jede `nostr:npub…`-Mention (NIP-08/27) im Text an,
 * ohne bereits gesetzte p-Tags (z.B. den Reply-Autor) zu doppeln. Mutiert & liefert
 * dasselbe Array zurück (Aufrufer bauen ihre Tag-Liste ohnehin frisch).
 */
const withMentionTags = (tags: string[][], content: string, url: string): string[][] => {
    const seen = new Set(tags.filter((t) => t[0] === 'p').map((t) => t[1]))
    for (const pk of mentionPubkeys(content)) {
        if (!seen.has(pk)) {
            tags.push(['p', pk, url])
        }
    }
    return tags
}

/** Rohe Relay-Ablehnung → kurzer, handlungsleitender deutscher Text. */
const mapRelayError = (raw: string): string => {
    const s = raw.toLowerCase()
    if (s.includes('rate') && s.includes('limit')) {
        return 'Zu viele Nachrichten in kurzer Zeit — kurz warten und erneut senden.'
    }
    if (s.includes('auth')) {
        return 'Am Relay nicht angemeldet — bitte erneut senden.'
    }
    if (s.includes('restrict') || s.includes('blocked') || s.includes('not allowed') || s.includes('forbidden')) {
        return 'Nachricht vom Relay abgelehnt — du bist evtl. kein Mitglied dieses Raums.'
    }
    return raw || 'Konnte nicht gesendet werden.'
}

/**
 * Sendet eine Nachricht (kind 9) in einen Room. Signiert im Browser, publiziert
 * via Thunk (optimistisch: der Thunk legt das Event sofort ins Repository, die
 * Live-Sub bestätigt es). Gibt die Fehlermeldung des Relays zurück, '' bei Erfolg.
 *
 * Ist `reply` gesetzt, wird nach NIP-18-Manier zitiert: `q`+`p`-Tags plus ein
 * vorangestelltes `nostr:nevent…` im Content (kein NIP-10 e-reply — so macht es
 * auch der Referenz-Client für NIP-29-Rooms).
 */
export const sendRoomMessage = async (
    url: string,
    h: string,
    content: string,
    reply?: ReplyTarget,
): Promise<string> => {
    const tags: string[][] = roomTags(h, url)
    let body = content
    if (reply) {
        const nevent = nip19.neventEncode({ id: reply.id, relays: [url], author: reply.pubkey, kind: MESSAGE })
        tags.push(['q', reply.id, url, reply.pubkey], ['p', reply.pubkey, url])
        body = `nostr:${nevent}\n\n${content}`
    }
    withMentionTags(tags, content, url)
    const thunk = publishThunk({ relays: [url], event: makeEvent(MESSAGE, { content: body, tags }) })
    const err = await waitForThunkError(thunk)
    if (err) {
        // welshman entfernt das optimistisch eingelegte Event bei einem Relay-Reject
        // NICHT selbst (nur bei Abort) — sonst bliebe die Nachricht sichtbar UND der
        // Draft käme zurück (Doppel-Look). Die id ist ohne PoW über das Signieren stabil.
        repository.removeEvent(thunk.event.id)
    }
    return err ? mapRelayError(err) : ''
}

/**
 * Löscht eine eigene Nachricht (kind 5, NIP-09). Das `h`-Tag routet den Tombstone
 * in den Raum; das Repository blendet die referenzierte Nachricht sofort aus.
 * Der Tombstone braucht `created_at > Nachricht` (Repository-Regel) — sonst greift
 * das Löschen direkt nach dem Senden (gleiche Unix-Sekunde) nicht.
 */
export const deleteRoomMessage = (url: string, h: string, id: string, createdAt: number): Promise<string> =>
    waitForThunkError(
        publishThunk({
            relays: [url],
            event: makeEvent(DELETE, {
                created_at: Math.max(Math.floor(Date.now() / 1000), createdAt + 1),
                tags: [['k', String(MESSAGE)], ['e', id], ...roomTags(h, url)],
            }),
        }),
    )

/**
 * Bearbeitet eine eigene Nachricht: Nostr kennt kein Edit-Event, also **Delete des
 * Alten + Re-Publish mit demselben `created_at`** (so wie der Referenz-Client) — die
 * neue Fassung behält die Position im Verlauf. War die Nachricht eine Antwort/Zitat,
 * bleiben `q`/`p`-Tag und der `nostr:nevent…`-Präfix erhalten. `content` ist der
 * bearbeitete Klartext (ohne Präfix). Optimistisch: der Tombstone blendet das Alte
 * sofort aus, die Neufassung erscheint via Live-Sub.
 */
export const editRoomMessage = async (
    url: string,
    h: string,
    original: TrustedEvent,
    content: string,
): Promise<string> => {
    // Reply-/Zitat-Kontext des Originals bewahren: q/p-Tags + vorangestelltes nevent.
    const preserved = original.tags.filter((t) => t[0] === 'q' || t[0] === 'p')
    const prefix = getTagValue('q', original.tags) ? (QUOTE_PREFIX.exec(original.content)?.[0] ?? '') : ''
    // Original löschen (kind 5, `h` vom Original + PROTECTED); fire-and-forget, der
    // Tombstone landet optimistisch sofort im Repository. ponytail: schlägt der
    // Re-Publish unten fehl, ist das Alte bereits weg (wie beim Referenz-Client) —
    // der Nutzer bekommt den Text zum erneuten Senden zurück (bridge).
    void publishThunk({ relays: [url], event: makeEventDelete(original, url) })
    const thunk = publishThunk({
        relays: [url],
        event: makeEvent(MESSAGE, {
            content: prefix + content,
            created_at: original.created_at,
            tags: withMentionTags([...preserved, ...roomTags(h, url)], content, url),
        }),
    })
    const err = await waitForThunkError(thunk)
    if (err) {
        repository.removeEvent(thunk.event.id)
        return mapRelayError(err)
    }
    return ''
}

/**
 * Reagiert auf eine Nachricht (kind 7, NIP-25). `content` = Unicode-Emoji bzw.
 * `:shortcode:` für Custom-Emoji (NIP-30) mit `emojiTag` = `['emoji', code, url]`.
 * Optimistisch (Thunk legt die kind-7 sofort ins Repository → Chip erscheint);
 * bei Relay-Reject wird sie zurückgenommen. Gibt '' bei Erfolg, sonst den Fehler.
 */
export const sendReaction = async (
    url: string,
    target: TrustedEvent,
    content: string,
    emojiTag?: string[],
): Promise<string> => {
    const thunk = publishThunk({ relays: [url], event: makeReaction(target, content, url, emojiTag ? [emojiTag] : []) })
    const err = await waitForThunkError(thunk)
    if (err) {
        repository.removeEvent(thunk.event.id)
    }
    return err ? mapRelayError(err) : ''
}

/**
 * Nimmt die eigene Reaction zurück (kind 5 auf die eigene kind-7). Das Repository
 * blendet die referenzierte Reaction sofort aus (Chip verschwindet). Gibt '' bei
 * Erfolg, sonst den Fehler; bei Reject bleibt die Reaction bis zum Reload verdeckt
 * (das Relay hat den Tombstone nie erhalten — wie beim Nachricht-Löschen).
 */
export const removeReaction = (url: string, reaction: TrustedEvent): Promise<string> =>
    waitForThunkError(publishThunk({ relays: [url], event: makeEventDelete(reaction, url) })).then((err) =>
        err ? mapRelayError(err) : '',
    )

/**
 * Meldet eine fremde Nachricht (kind 1984, NIP-56). `reason` = NIP-56-Code,
 * `content` = optionaler Freitext. Publiziert ans Space-Relay (AUTH automatisch);
 * gibt '' bei Erfolg, sonst die übersetzte Relay-Fehlermeldung.
 */
export const sendReport = (
    url: string,
    target: Pick<TrustedEvent, 'id' | 'pubkey'>,
    reason: string,
    content: string,
): Promise<string> =>
    waitForThunkError(publishThunk({ relays: [url], event: makeReport(target, reason, content) })).then((err) =>
        err ? mapRelayError(err) : '',
    )

/**
 * Postet zusätzlich zur Poll eine kind-9-Nachricht, die das Poll als `nostr:nevent…`
 * zitiert — **nur für Flotilla-Kompatibilität**: dessen Chat-Feed lädt kind-1068 nicht
 * direkt, ohne diese Quote bliebe die Poll dort unsichtbar. Unser eigener Feed blendet
 * die Quote via `isPollShareQuote` wieder aus (keine Doppelanzeige). Fire-and-forget:
 * scheitert die Quote, besteht die Poll trotzdem; die (lokal ohnehin verdeckte) Quote
 * braucht keinen Rollback.
 */
const publishPollShareQuote = (url: string, h: string, poll: TrustedEvent): void => {
    const nevent = nip19.neventEncode({ id: poll.id, relays: [url], author: poll.pubkey, kind: POLL })
    const tags = [['q', poll.id, url, poll.pubkey], ['p', poll.pubkey, url], ...roomTags(h, url)]
    void publishThunk({ relays: [url], event: makeEvent(MESSAGE, { content: `nostr:${nevent}\n\n`, tags }) })
}

/**
 * Erstellt eine NIP-88-Poll (kind 1068) im Raum. Optimistisch (die Poll erscheint
 * sofort via Live-Sub/Repository); gibt '' bei Erfolg, sonst die Relay-Fehlermeldung.
 * Nach Erfolg wird eine Flotilla-kompatible Share-Quote nachgeschoben (siehe oben).
 */
export const sendPoll = async (
    url: string,
    h: string,
    params: { title: string; options: PollOption[]; pollType: PollType; endsAt?: number },
): Promise<string> => {
    // Die Poll wird optimistisch aus dem Repository gerendert (roomStreamFilter zieht
    // kind-1068). welshman entfernt sie bei Relay-Reject NICHT selbst → sonst bliebe die
    // Karte sichtbar, obwohl sie das Relay nie erreicht hat (wie sendRoomMessage).
    const thunk = publishThunk({ relays: [url], event: makePoll(params, h, url) })
    const err = await waitForThunkError(thunk)
    if (err) {
        repository.removeEvent(thunk.event.id)
        return mapRelayError(err)
    }
    publishPollShareQuote(url, h, thunk.event)
    return ''
}

/**
 * Erstellt ein NIP-75-Zap-Goal (kind 9041) im Raum (ZAPS.md Z5). Optimistisch (die
 * Goal-Karte erscheint sofort via Repository/Live-Sub); gibt '' bei Erfolg, sonst die
 * Relay-Fehlermeldung und rollt die optimistische Karte zurück (wie `sendPoll`). Keine
 * Flotilla-Share-Quote — Goals sind kein Poll-Sonderfall.
 */
export const sendGoal = async (
    url: string,
    h: string,
    params: { title: string; summary?: string; targetSats: number },
): Promise<string> => {
    const thunk = publishThunk({ relays: [url], event: makeGoal(params, h, url) })
    const err = await waitForThunkError(thunk)
    if (err) {
        repository.removeEvent(thunk.event.id)
        return mapRelayError(err)
    }
    return ''
}

/**
 * Stimmt über eine Poll ab (kind 1018). Jeder Aufruf publiziert eine neue Response;
 * das Tally zählt pro Wähler nur die jüngste. Optimistisch: die Response landet sofort
 * im Repository (Balken/eigener Vote aktualisieren), bei Relay-Reject Rollback.
 */
export const sendPollResponse = async (url: string, poll: TrustedEvent, selectedIds: string[]): Promise<string> => {
    // `created_at` strikt über die jüngste eigene Response bumpen, damit ein Umwählen
    // in derselben Sekunde das Tally sicher überschreibt (latest-per-pubkey = strikt größer).
    const me = get(pubkey)
    const prev = me
        ? repository
              .query([{ kinds: [POLL_RESPONSE], '#e': [poll.id], authors: [me] }])
              .reduce((max, e) => Math.max(max, e.created_at), 0)
        : 0
    const createdAt = Math.max(Math.floor(Date.now() / 1000), prev + 1)
    const thunk = publishThunk({ relays: [url], event: makePollResponse(poll, selectedIds, url, createdAt) })
    const err = await waitForThunkError(thunk)
    if (err) {
        repository.removeEvent(thunk.event.id)
    }
    return err ? mapRelayError(err) : ''
}
