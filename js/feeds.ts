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
import { MESSAGE, COMMENT, DELETE, REACTION, POLL, POLL_RESPONSE, ZAP_RESPONSE, ZAP_GOAL, makeEvent, sortEventsAsc, getTag, getTagValue, getLnUrl, fromMsats, zapFromEvent, profileHasName, type TrustedEvent, type Zap, type Zapper } from '@welshman/util'
import { groupBy, uniq, uniqBy } from '@welshman/lib'
import * as nip19 from 'nostr-tools/nip19'
import { deriveEventsForUrl } from './repository'
import { throttled } from '@welshman/store'
import { warmZappers } from './zaps'
import { roomTags, makeReaction, makeEventDelete, makeReport, makePoll, makePollResponse, makeGoal, makeComment, mentionPubkeys } from './interactions'
import { getPollEndsAt, getPollResults, getPollType, isPollClosed, isPollShareQuote, ownPollSelection, pollResponseTarget, QUOTE_PREFIX, type PollOption, type PollType } from './polls'
import { getGoalSummary, getGoalTargetSats, getGoalTitle, goalProgress } from './goals'
import { proxifyImage } from './core'
import { warmProfiles } from './profiles'
import { warmHandles, verifiedNip05 } from './handles'
import type { Attachment } from './uploads'

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
        // Bild in einen reservierten Container wickeln: dessen Maße stehen per CSS-`aspect-ratio`
        // schon VOR dem Laden fest → kein Layout-Sprung (CLS/„Kaugummi"), wenn das Bild spät
        // dekodiert. Das Bild wird KOMPLETT gezeigt (`object-fit:contain`, ganze Grafik sichtbar,
        // Leerraum wo das Verhältnis abweicht); die Lightbox (`data-full`) zeigt es groß.
        const box = document.createElement('span')
        box.className = 'chat-image-box'
        const img = document.createElement('img')
        img.className = 'chat-image'
        img.loading = 'lazy'
        img.src = proxifyImage(href, 'msg')
        img.dataset.full = proxifyImage(href, 'full')
        img.alt = ''
        box.appendChild(img)
        return box.outerHTML
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

// Polls (1068) und Zap-Goals (9041) MIT den Nachrichten laden (nicht nur MESSAGE): sie SIND
// Timeline-Einträge und werden von deriveRoomMessages ohnehin angezeigt. Lud man sie nur über den
// separaten loadRoomPolls/-Goals nach, erschien die Poll/Goal-Zeile erst verzögert (async) und
// wuchs nach dem Paint in den Verlauf → Jitter. Im selben Query (initial + loadOlder-Paging) sind
// sie sofort da → kein verstecktes Nachpoppen. (loadRoomPolls bleibt für die 1018-Responses/Tally.)
const roomFilter = (h: string) => [{ kinds: [MESSAGE, POLL, ZAP_GOAL], '#h': [h] }]

/** Nachrichten, Polls UND Zap-Goals eines Raums — alle zeitlich verwoben im Verlauf. */
const roomStreamFilter = (h: string) => [{ kinds: [MESSAGE, POLL, ZAP_GOAL], '#h': [h] }]

/** kind-7-Reactions eines Raums (NIP-25) — tragen `#h` vom Parent (via makeReaction). */
const roomReactionFilter = (h: string) => [{ kinds: [REACTION], '#h': [h] }]

/** kind-1018-Poll-Responses eines Raums (NIP-88) — tragen `#h` vom Poll (via makePollResponse). */
const roomPollResponseFilter = (h: string) => [{ kinds: [POLL_RESPONSE], '#h': [h] }]

/**
 * Lotus' In-Chat-Thread (NIP-29 Group Chat Threading): kind 10, wurzelt an einer normalen
 * kind-9-Nachricht via `["e", rootId, relay, "root"]`, direktes Parent via
 * `["e", parentId, relay, "reply"]`, plus `["h", groupId, relay]`. Wir LESEN diese Events
 * (P4, Interop) neben unseren kind-1111-Kommentaren; unser eigener Write bleibt kind-1111.
 */
const CHAT_THREAD = 10

/**
 * Thread-Root eines Kommentars, format-übergreifend: unsere kind-1111 tragen `["E", rootId]`
 * (NIP-22, uppercase), Lotus' kind-10 tragen `["e", rootId, relay, "root"]` (NIP-29, marker).
 */
const commentRootId = (event: TrustedEvent): string =>
    getTagValue('E', event.tags) ?? event.tags.find((t) => t[0] === 'e' && t[3] === 'root')?.[1] ?? ''

/**
 * Direkter Eltern-Kommentar: Lotus' kind-10 markiert ihn `["e", parentId, relay, "reply"]`;
 * unsere kind-1111 tragen den Parent im ersten kleinen `e` (NIP-22, ohne Marker). Der
 * Reply-Marker hat Vorrang → bei kind-10 wird nicht fälschlich der Root-`e` als Parent gelesen.
 */
const commentParentId = (event: TrustedEvent): string =>
    event.tags.find((t) => t[0] === 'e' && t[3] === 'reply')?.[1] ?? getTagValue('e', event.tags) ?? ''

/**
 * kind-1111-Kommentare (NIP-22, C6b) — flotilla-kompatibel OHNE `#h` (Kommentare sind
 * keine Group-Events). Ungescopt je Space-Relay geladen; die Zuordnung zur Nachricht
 * läuft über den Thread-Root `["E", rootId]` (uppercase), nicht `#h`. Zusätzlich Lotus'
 * kind-10 In-Chat-Threads (P4) — dieselben Kanäle, gebündelt über {@link commentRootId}.
 */
const roomCommentFilter = () => [{ kinds: [COMMENT, CHAT_THREAD] }]

/**
 * kind-9735-Zap-Receipts (NIP-57): tragen KEIN `#h` — der LNURL-Server kopiert nur
 * `p`/`e`/`bolt11`/`description` ins Receipt. Deshalb hier ungefiltert je Space-Relay;
 * die Zuordnung zur Nachricht + Validierung läuft in `aggregateZaps` über `#e`.
 */
const roomZapReceiptFilter = () => [{ kinds: [ZAP_RESPONSE] }]

/** Aufsteigend sortierter Chat-Verlauf eines Rooms (Nachrichten + Polls, reaktiv). */
export const deriveRoomMessages = (url: string, h: string): Readable<TrustedEvent[]> =>
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

/** Ein Gesicht (Teilnehmer) im Antworten-Indikator eines Threads. */
export type ThreadFace = { pubkey: string; name: string; picture: string }

/**
 * Slack-artige Thread-Zusammenfassung EINER Nachricht (C6b): Anzahl Antworten,
 * bis zu 3 Teilnehmer-Gesichter (jüngste zuerst) und ein relatives „vor …"-Label
 * der letzten Antwort. `null`, wenn es keine Kommentare (kind 1111) an dieser Nachricht gibt.
 */
export type ThreadSummary = { count: number; faces: ThreadFace[]; lastLabel: string }

/** Relatives Zeit-Label („vor 3 Min" / „vor 2 Std" / Datum) für den Antworten-Indikator. */
const relativeTime = (ts: number): string => {
    const s = Math.floor(Date.now() / 1000) - ts
    if (s < 60) {
        return 'gerade eben'
    }
    const m = Math.floor(s / 60)
    if (m < 60) {
        return `vor ${m} Min`
    }
    const h = Math.floor(m / 60)
    if (h < 24) {
        return `vor ${h} Std`
    }
    const d = Math.floor(h / 24)
    return d < 7 ? `vor ${d} Tg` : dayLabel(ts)
}

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

/**
 * Baut die Slack-artige Antworten-Zusammenfassung einer Nachricht aus ihren
 * kind-1111-Kommentaren (dem ganzen Thread, per Root-`E` gebündelt): Zähler,
 * bis zu 3 EINDEUTIGE Teilnehmer-Gesichter (jüngste zuerst) und das relative
 * „vor …"-Label der letzten Antwort. `null` = keine Antworten (kein Indikator).
 */
const buildThreadSummary = (
    comments: TrustedEvent[],
    $profiles: Map<string, { picture?: string }>,
    nameOf: (pubkey: string) => string,
): ThreadSummary | null => {
    if (comments.length === 0) {
        return null
    }
    const newestFirst = sortEventsAsc(comments).reverse()
    const faces = uniqBy((c) => c.pubkey, newestFirst)
        .slice(0, 3)
        .map((c): ThreadFace => ({ pubkey: c.pubkey, name: nameOf(c.pubkey), picture: $profiles.get(c.pubkey)?.picture ?? '' }))
    return { count: comments.length, faces, lastLabel: relativeTime(newestFirst[0].created_at) }
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
    profileReady: boolean // kind-0 des Autors geladen (sonst npub-Fallback → ruhiger Platzhalter)
    html: string
    divider: string // Datums-Trenner, wenn der Tag wechselt (sonst '')
    unreadDivider: boolean // erste ungelesene Fremd-Nachricht (Last-Read-Grenze)
    showAuthor: boolean // erster Beitrag eines Autor-Blocks (Gruppierung)
    mine: boolean // vom eingeloggten User verfasst (→ löschbar, M5)
    reply: ReplyPreview | null // zitierte Nachricht (q-Tag), im Fenster aufgelöst — sonst null
    thread: ThreadSummary | null // Slack-artige Antworten-Zusammenfassung (kind 1111, C6b); null = keine Antworten
    reactions: ReactionChip[] // aggregierte kind-7-Reactions (C1), leer = keine
    poll: PollView | null // NIP-88-Poll (kind 1068) mit Live-Tally + eigenem Vote (C5), sonst null
    goal: GoalView | null // NIP-75-Zap-Goal (kind 9041) mit Fortschritt aus dem Zap-Tally (Z5), sonst null
    zaps: ZapSummary // validierte kind-9735-Zap-Summe (Z3), count 0 = keine
    zappable: boolean // Autor kann Zaps empfangen (lud16/lud06) UND ist nicht man selbst
    replyToName?: string // NUR Thread-Kommentare (P3): Elternautor (NIP-22 kleines `e`) für die
    // „Antwort auf <Autor>"-Zeile; im Raum-Feed undefined (dort trägt `reply` den q-Quote).
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
 * Aggregations-Kontext für {@link toChatMessage}: die je-Nachricht gebündelten Reaktionen/
 * Zaps/Poll-Responses/Kommentare + Profile/Handles/Zapper. Der Thread-Feed reicht leere
 * Aggregations-Maps (Reaktionen/Zaps folgen in P3 Schritt 5) → reply/thread/reactions/poll/
 * goal/zaps kommen neutral heraus, ohne Sonderpfad.
 */
type ChatBuildCtx = {
    me: string | null | undefined
    $profiles: Map<string, { picture?: string; nip05?: string; lud16?: string; lud06?: string }>
    $handles: Parameters<typeof verifiedNip05>[2]
    $zappers: Map<string, Zapper>
    byId: Map<string, TrustedEvent>
    commentsByRoot: Map<string, TrustedEvent[]>
    reactionsByTarget: Map<string, TrustedEvent[]>
    pollResponsesByTarget: Map<string, TrustedEvent[]>
    zapsByTarget: Map<string, TrustedEvent[]>
}

/**
 * Baut die positions-UNABHÄNGIGEN ChatMessage-Felder eines Events — der gemeinsame Kern von
 * Raum- und Thread-Feed (P3 4.1, „gleiches Model"). divider/showAuthor/unreadDivider hängen von
 * der Position in der Liste ab und kommen aus dem aufrufenden Fold. Leere Aggregations-Maps
 * (Thread) → reply/thread/reactions/poll/goal neutral (null/leer), zappable=false.
 */
const toChatMessage = (event: TrustedEvent, ctx: ChatBuildCtx): Omit<ChatMessage, 'divider' | 'unreadDivider' | 'showAuthor'> => {
    const nameOf = displayProfileByPubkey
    const mine = event.pubkey === ctx.me
    const quotedId = getTagValue('q', event.tags)
    const quoted = quotedId ? ctx.byId.get(quotedId) : undefined
    const reply: ReplyPreview | null = quoted
        ? { id: quoted.id, name: nameOf(quoted.pubkey), text: snippet(bodyWithoutQuote(quoted)) }
        : null
    // Threading (C6b, Slack-Modell): JEDE Nachricht ist thread-fähig — der Thread wurzelt an
    // ihr selbst (event.id), Kommentare (kind 1111) tragen ["E", event.id]. null = keine Antworten.
    const thread = buildThreadSummary(ctx.commentsByRoot.get(event.id) ?? [], ctx.$profiles, nameOf)
    const profile = ctx.$profiles.get(event.pubkey)
    // Zapper (lud16/lud06 → lnurl). `||` (nicht `??`): leeres lud16 muss auf lud06 durchfallen,
    // sonst Store-Miss und `aggregateZaps` zählt nichts.
    const lnurl = getLnUrl(profile?.lud16 || profile?.lud06 || '')
    const zapper = lnurl ? ctx.$zappers.get(lnurl) : undefined
    // Zap-Tally einmal — Nachrichten-Chip UND (kind 9041) Goal-Fortschritt teilen die Summe.
    const zaps = aggregateZaps(ctx.zapsByTarget.get(event.id) ?? [], zapper, ctx.me, nameOf)
    return {
        id: event.id,
        pubkey: event.pubkey,
        created_at: event.created_at,
        // name/nip05/picture/profileReady/html/time/fullTime — geteilter Personen-Baustein.
        ...personFields(event, ctx.$profiles, ctx.$handles),
        mine,
        reply,
        thread,
        reactions: aggregateReactions(ctx.reactionsByTarget.get(event.id) ?? [], ctx.me, nameOf),
        poll: event.kind === POLL ? buildPollView(event, ctx.pollResponsesByTarget.get(event.id) ?? [], ctx.me) : null,
        goal: event.kind === ZAP_GOAL ? buildGoalView(event, zaps) : null,
        zaps,
        zappable: !mine && Boolean(lnurl),
    }
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
            throttled(200, deriveEventsForUrl(url, roomCommentFilter())),
        ],
        ([events, $profiles, $me, $handles, $reactions, $pollResponses, $zaps, $zappers, $comments]) => {
        // Reactions nach Ziel-Nachricht (`#e`) bündeln — je Nachricht einmal aggregiert.
        // Reactions ohne `e`-Tag landen im ''-Bucket und werden nie abgerufen (event.id ≠ '').
        const reactionsByTarget = groupBy((r) => getTagValue('e', r.tags) ?? '', $reactions)
        // Poll-Responses nach Ziel-Poll (`["e", pollId]`) bündeln — je Poll einmal getallyt.
        const pollResponsesByTarget = groupBy((r) => pollResponseTarget(r), $pollResponses)
        // Zap-Receipts (9735) nach Ziel-Nachricht (`#e`) bündeln — je Nachricht validiert
        // getallyt. 9735 trägt kein `#h`, `#e` ist der einzige verlässliche Raumbezug.
        const zapsByTarget = groupBy((r) => getTagValue('e', r.tags) ?? '', $zaps)
        // NIP-22-Kommentare (kind 1111, C6b) nach Thread-Root (`["E", rootId]`) bündeln —
        // ALLE Kommentare eines Threads (auch verschachtelte) teilen dieses Root-`E`, also
        // ist die Bucket-Größe die Gesamt-Thread-Zahl der zitierten Nachricht.
        const commentsByRoot = groupBy(commentRootId, $comments)
        // First-Paint-Seed: fehlende Autor- UND erwähnte Profile (NIP-27) vom geteilten
        // Backend-Cache holen (dedupliziert intern; welshman löst parallel live auf).
        // Ohne die Mention-Pubkeys blieben extern referenzierte @-Mentions (Nicht-
        // Mitglieder/gepastete npubs) dauerhaft als gekürztes npub statt @Name. Fire-and-forget.
        void warmProfiles([
            ...events.map((e) => e.pubkey),
            ...events.flatMap((e) => mentionPubkeys(bodyWithoutQuote(e))),
            ...$comments.map((c) => c.pubkey), // Kommentar-Autoren → Gesichter im Antworten-Indikator (C6b)
        ])
        // NIP-05-Handles der Autoren lazy verifizieren (dedupliziert, fire-and-forget).
        warmHandles(events.map((e) => e.pubkey))
        // Zapper (LNURL-pay-Meta) der Autoren lazy laden — nötig, um ihre 9735-Receipts
        // zu validieren (Signer-Check) und den ⚡-Chip zu summieren (dedupliziert intern).
        warmZappers(events.map((e) => e.pubkey))
        // Index für die Reply-Auflösung im selben Raum (q-Tag → zitierte Nachricht).
        const byId = new Map(events.map((e) => [e.id, e]))
        const ctx: ChatBuildCtx = { me: $me, $profiles, $handles, $zappers, byId, commentsByRoot, reactionsByTarget, pollResponsesByTarget, zapsByTarget }

        let prevDay = ''
        let prevPubkey = ''
        let unreadShown = false
        return events.map((event, idx): ChatMessage => {
            const day = dayLabel(event.created_at)
            const divider = day !== prevDay ? day : ''
            const showAuthor = event.pubkey !== prevPubkey || divider !== ''
            prevDay = day
            prevPubkey = event.pubkey
            // Trennlinie vor der ersten Fremd-Nachricht jenseits der Last-Read-Grenze.
            // `idx > 0`: keine Grenze, wenn ohnehin der ganze Verlauf ungelesen ist.
            const unreadDivider = !unreadShown && lastRead > 0 && idx > 0 && event.created_at > lastRead && event.pubkey !== $me
            if (unreadDivider) {
                unreadShown = true
            }
            return { divider, unreadDivider, showAuthor, ...toChatMessage(event, ctx) }
        })
    },
    )

/**
 * Öffnet eine Live-Subscription für NEUE Room-Events (bleibt bis abort offen):
 * Nachrichten (kind 9), Reactions (kind 7), Tombstones (kind 5), Poll(-Responses)
 * und Goals — alle `#h`. Kommentare (kind 1111) tragen KEIN `#h` (flotilla-kompatibel)
 * → eigener, ungescopter Filter, damit der Live-Antworten-Zähler ohne separate Sub kommt.
 */
export const listenRoom = (url: string, h: string, signal: AbortSignal): void => {
    void request({
        relays: [url],
        signal,
        filters: [
            { kinds: [MESSAGE, REACTION, DELETE, POLL, POLL_RESPONSE, ZAP_GOAL], '#h': [h], limit: 0 },
            { kinds: [COMMENT, CHAT_THREAD], limit: 0 },
        ],
    })
}

/**
 * Lädt NUR die Poll-Responses (kind 1018) eines Raums fürs Tally — NICHT die Poll-Events
 * (kind 1068) selbst. Die Poll-KARTE (1068) ist eine große, variabel hohe Timeline-Zeile
 * und kommt jetzt ausschließlich übers gepagte `roomFilter` (limit:50 + loadOlder), damit
 * sie IMMER im gerade geladenen Fenster liegt → sofort via measureRow vermessen → kein
 * Off-screen-Estimate → kein mittiger Scroll-Sprung. (Vorher lud dies ALLE 1068 ungepaged
 * ins Repository, wodurch mittige Polls als nur-geschätzte Off-screen-Zeilen erschienen.)
 * Die 1018-Responses tragen kein Layout → raumweit laden ist unschädlich und hält das Tally
 * einer gerade eingepagten Poll sofort korrekt.
 */
export const loadRoomPolls = (url: string, h: string): Promise<TrustedEvent[]> =>
    load({ relays: [url], filters: [{ kinds: [POLL_RESPONSE], '#h': [h] }] })

/**
 * Lädt die bestehenden Reactions (kind 7) + Tombstones (kind 5) eines Raums, damit
 * bereits vorhandene Reaction-Chips beim ersten Öffnen sichtbar sind (die Live-Sub
 * liefert nur NEUE Events). Kein `until`-Paging — Reactions sind pro Raum überschaubar.
 */
export const loadRoomReactions = (url: string, h: string): Promise<TrustedEvent[]> =>
    load({ relays: [url], filters: [{ kinds: [REACTION, DELETE], '#h': [h] }] })

/**
 * Lädt die bestehenden NIP-22-Kommentare (kind 1111) des Space-Relays, damit die
 * Antworten-Indikatoren schon beim ersten Öffnen stimmen (die Live-Sub liefert nur
 * Neues). OHNE `#h` (flotilla-kompatibel), Zuordnung über `["E", rootId]`.
 * ponytail: ungescopt je Relay — bei sehr vielen Threads später auf sichtbare Roots
 * (`#E`) eingrenzen; für die aktuelle Space-Größe unschädlich.
 */
export const loadRoomComments = (url: string): Promise<TrustedEvent[]> =>
    load({ relays: [url], filters: [{ kinds: [COMMENT, CHAT_THREAD] }] })

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
 * Publiziert ein Event optimistisch (der Thunk legt es sofort ins Repository → die UI
 * zeigt es ohne Round-Trip) und wartet auf die Relay-Bestätigung. Bei Reject wird das
 * optimistisch eingelegte Event zurückgenommen (welshman tut das nur bei Abort, nicht
 * bei Relay-Reject — sonst bliebe es sichtbar, obwohl es das Relay nie erreicht hat).
 * Gibt '' bei Erfolg, sonst die übersetzte Relay-Fehlermeldung. Der gemeinsame Kern von
 * Nachricht/Antwort/Reaction/Kommentar/Goal/Vote (Raum- UND Thread-Publish, P3 4.1).
 */
const publishOptimistic = async (url: string, event: Parameters<typeof publishThunk>[0]['event']): Promise<string> => {
    const thunk = publishThunk({ relays: [url], event })
    const err = await waitForThunkError(thunk)
    if (err) {
        repository.removeEvent(thunk.event.id)
    }
    return err ? mapRelayError(err) : ''
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
    attachment?: Attachment,
): Promise<string> => {
    const tags: string[][] = roomTags(h, url)
    let body = content
    if (reply) {
        const nevent = nip19.neventEncode({ id: reply.id, relays: [url], author: reply.pubkey, kind: MESSAGE })
        tags.push(['q', reply.id, url, reply.pubkey], ['p', reply.pubkey, url])
        body = `nostr:${nevent}\n\n${content}`
    }
    withMentionTags(tags, content, url)
    if (attachment) {
        // NIP-92: `imeta`-Tag ans Event. Die URL zusätzlich in den Text (mit Leerzeile
        // getrennt) — `renderMessageLink` macht Bild-URLs zu <img>, deshalb muss sie im
        // Content stehen (nicht nur im Tag). Anhang-ohne-Kommentar → URL steht allein.
        tags.push(attachment.imetaTag)
        body = body ? `${body}\n\n${attachment.url}` : attachment.url
    }
    return publishOptimistic(url, makeEvent(MESSAGE, { content: body, tags }))
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
    return publishOptimistic(
        url,
        makeEvent(MESSAGE, {
            content: prefix + content,
            created_at: original.created_at,
            tags: withMentionTags([...preserved, ...roomTags(h, url)], content, url),
        }),
    )
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
    return publishOptimistic(url, makeReaction(target, content, url, emojiTag ? [emojiTag] : []))
}

// ─── C6b: NIP-22-Thread-Ansicht (kind 1111 COMMENT) ────────────────────────────

/** Der Root eines Threads (die zitierte Nachricht). `missing`: noch nicht (nach)geladen. */
export type ThreadRoot = {
    id: string
    pubkey: string
    name: string
    picture: string
    profileReady: boolean
    nip05: string
    html: string
    time: string
    fullTime: string
    missing: boolean
}

/** Render-fertige Thread-Sicht: aufgelöster Root + flache chronologische Kommentar-Liste.
 *  Kommentare sind vollwertige {@link ChatMessage} (P3 4.2) → sie rendern durch die geteilte
 *  Raum-Message-Row (Reaktionen/Zaps/Toolbar/Crop geerbt); `replyToName` trägt den Eltern-Bezug. */
export type ThreadView = { rootId: string; root: ThreadRoot; comments: ChatMessage[]; count: number }

/** Personen-/Render-Felder eines Events (geteilt von Root + Kommentar). */
const personFields = (
    event: TrustedEvent,
    $profiles: Map<string, { picture?: string; nip05?: string }>,
    $handles: Parameters<typeof verifiedNip05>[2],
) => {
    const profile = $profiles.get(event.pubkey)
    return {
        name: displayProfileByPubkey(event.pubkey),
        picture: profile?.picture ?? '',
        profileReady: profileHasName(profile),
        nip05: verifiedNip05(event.pubkey, $profiles, $handles),
        html: renderMessageHtml(event),
        time: timeLabel(event.created_at),
        fullTime: fullTimeLabel(event.created_at),
    }
}

/**
 * Baut aus den kind-1111-Events die flache CHRONOLOGISCHE Kommentar-Liste (Slack-Stil, P3 4.2) als
 * vollwertige {@link ChatMessage} (via {@link toChatMessage}) → sie rendern durch die geteilte
 * Raum-Message-Row. divider/showAuthor werden wie im Raum-Feed gruppiert; `unreadDivider` gibt es im
 * Thread nicht. Der Elternautor (`replyToName`) kommt aus dem kleinen `["e"]` (NIP-22, direktes
 * Parent); leer, wenn das Parent der Root ist ODER außerhalb des Threads liegt (Waise sortiert per
 * Zeit ein). `ctx` trägt (im Thread) leere Aggregations-Maps → reactions/zaps/poll/goal neutral,
 * bis P3 Schritt 5 sie füllt.
 */
const buildCommentList = (comments: TrustedEvent[], rootId: string, ctx: ChatBuildCtx): ChatMessage[] => {
    const byId = new Map(comments.map((c) => [c.id, c]))
    let prevDay = ''
    let prevPubkey = ''
    return sortEventsAsc(comments).map((c): ChatMessage => {
        const day = dayLabel(c.created_at)
        const divider = day !== prevDay ? day : ''
        const showAuthor = c.pubkey !== prevPubkey || divider !== ''
        prevDay = day
        prevPubkey = c.pubkey
        const parentId = commentParentId(c)
        const parent = parentId && parentId !== rootId ? byId.get(parentId) : undefined
        return {
            divider,
            unreadDivider: false,
            showAuthor,
            replyToName: parent ? displayProfileByPubkey(parent.pubkey) : '',
            ...toChatMessage(c, ctx),
        }
    })
}

/**
 * Reaktive Thread-Sicht zu `rootId`: der aufgelöste Root (per id, raumübergreifend im
 * Repository gefunden) + alle Kommentare (kind 1111) mit `["E", rootId]`, flach chronologisch.
 * Kommentare laden über `#E` (Thread-Root-Tag). Reaktionen/Zaps (P3 Schritt 5): Kommentar-
 * Reaktionen (kind 7) tragen `#h` (via makeReaction vom Kommentar-`h`) → über `roomReactionFilter(h)`
 * mitgeladen; Zap-Receipts (9735) tragen kein `#h` → per `#e` der Kommentar-IDs geladen (bridge).
 * Beide werden client-seitig nach Ziel (`#e`) gebündelt und je Kommentar aggregiert wie im Raum.
 */
export const deriveThread = (url: string, rootId: string, h: string): Readable<ThreadView> =>
    derived(
        [
            deriveEventsForUrl(url, [{ ids: [rootId] }]),
            // kind-1111 bündelt per Root-`#E`; Lotus' kind-10 trägt den Root im kleinen `e`
            // (marker "root") → nur per `#e` filterbar (P4). Client-seitig über commentRootId
            // gebündelt, sodass fremde kind-10 anderer Wurzeln nicht durchrutschen.
            deriveEventsForUrl(url, [
                { kinds: [COMMENT], '#E': [rootId] },
                { kinds: [CHAT_THREAD], '#e': [rootId] },
            ]),
            throttled(200, profilesByPubkey),
            pubkey,
            throttled(200, handlesByNip05),
            throttled(200, deriveEventsForUrl(url, roomReactionFilter(h))),
            throttled(200, deriveEventsForUrl(url, roomZapReceiptFilter())),
            throttled(200, zappersByLnurl),
        ],
        ([rootEvents, rawComments, $profiles, $me, $handles, $reactions, $zaps, $zappers]) => {
            // Nur Kommentare, die WIRKLICH an diesem Root wurzeln: kind-10 kommt per `#e`
            // (matcht jedes e-Tag) → die mit rootId nur als Reply-Parent (fremder Thread)
            // fielen sonst rein. commentRootId liest den Root formatspezifisch (E bzw. e/root).
            const commentEvents = rawComments.filter((c) => commentRootId(c) === rootId)
            void warmProfiles([...rootEvents, ...commentEvents].map((e) => e.pubkey))
            warmHandles([...rootEvents, ...commentEvents].map((e) => e.pubkey))
            warmZappers(commentEvents.map((e) => e.pubkey)) // Zapper der Kommentar-Autoren → 9735-Validierung/⚡-Chip
            const rootEvent = rootEvents.find((e) => e.id === rootId)
            const root: ThreadRoot = rootEvent
                ? { id: rootEvent.id, pubkey: rootEvent.pubkey, missing: false, ...personFields(rootEvent, $profiles, $handles) }
                : { id: rootId, pubkey: '', name: '', picture: '', profileReady: false, nip05: '', html: '', time: '', fullTime: '', missing: true }
            const ctx: ChatBuildCtx = {
                me: $me,
                $profiles,
                $handles,
                $zappers,
                byId: new Map(), // Kommentare tragen kein q-Zitat → reply bleibt null (Eltern-Bezug via replyToName)
                commentsByRoot: new Map(), // Kommentare wurzeln keinen Sub-Thread → thread bleibt null
                reactionsByTarget: groupBy((r) => getTagValue('e', r.tags) ?? '', $reactions),
                pollResponsesByTarget: new Map(),
                zapsByTarget: groupBy((r) => getTagValue('e', r.tags) ?? '', $zaps),
            }
            return { rootId, root, comments: buildCommentList(commentEvents, rootId, ctx), count: commentEvents.length }
        },
    )

/**
 * Lädt Root (per id) + bestehende Kommentare eines Threads: unsere kind-1111 (`#E`) UND
 * Lotus' kind-10 (`#e`, P4) — die Live-Sub liefert nur Neues. Root-Load per id trägt auch
 * raumfremde/ältere Wurzeln.
 */
export const loadThread = (url: string, rootId: string): Promise<TrustedEvent[]> =>
    load({ relays: [url], filters: [{ ids: [rootId] }, { kinds: [COMMENT], '#E': [rootId] }, { kinds: [CHAT_THREAD], '#e': [rootId] }] })

/** Live-Sub für NEUE Kommentare eines offenen Threads (kind-1111 `#E` + Lotus' kind-10 `#e`), bis abort. */
export const listenThread = (url: string, rootId: string, signal: AbortSignal): void => {
    void request({ relays: [url], signal, filters: [{ kinds: [COMMENT], '#E': [rootId], limit: 0 }, { kinds: [CHAT_THREAD], '#e': [rootId], limit: 0 }] })
}

/**
 * Ein Thread in der Space-Übersicht (Startseite): der Wurzel-Beitrag + Aktivität.
 * `ready=false`, solange die Wurzel-Nachricht (kind 9) noch nicht (per id) geladen ist.
 */
export type SpaceThread = {
    rootId: string
    nevent: string // bech32-Referenz auf die Wurzel → direkt verlinkbarer Pfad /rooms/{h}/thread/{nevent}
    roomH: string // Raum (h-Tag der Wurzel) — Name löst die Startseite aus ihren Raumdaten auf
    authorName: string
    snippet: string
    count: number
    faces: ThreadFace[]
    lastLabel: string
    lastTs: number
}

/**
 * Reaktive Liste ALLER aktiven Threads eines Space (Startseite, C6b): gruppiert die
 * kind-1111-Kommentare nach Thread-Root (`["E"]`), löst je Root die Wurzel-Nachricht
 * (kind 9, per id im Repository) für Snippet/Autor/Raum auf und sortiert nach letzter
 * Aktivität. Wurzel-Events kommen über `loadSpaceThreads`; die kind-9-Ableitung als
 * Dependency sorgt dafür, dass die Liste nachzieht, sobald Wurzeln eintreffen.
 */
export const deriveSpaceThreads = (url: string): Readable<SpaceThread[]> =>
    derived(
        [
            throttled(300, deriveEventsForUrl(url, roomCommentFilter())),
            // Wurzeln gegen ALLE Timeline-Kinds auflösen (wie roomStreamFilter) — Threads können
            // an Nachricht (9), Poll (1068) ODER Zap-Goal (9041) wurzeln, nicht nur kind-9.
            throttled(300, deriveEventsForUrl(url, [{ kinds: [MESSAGE, POLL, ZAP_GOAL] }])),
            throttled(300, profilesByPubkey),
        ],
        ([comments, roots, $profiles]) => {
            const byId = new Map(roots.map((r) => [r.id, r]))
            const byRoot = groupBy(commentRootId, comments)
            const out: SpaceThread[] = []
            for (const [rootId, cs] of byRoot.entries()) {
                const root = rootId ? byId.get(rootId) : undefined
                // Nur Threads mit AUFLÖSBARER Wurzel in unserem Space zeigen — sonst blieben
                // Geister-Zeilen (fremde flotilla-Wurzeln kind-11/1, noch nicht geladene Roots)
                // dauerhaft als „(wird geladen…)" stehen und verfälschten den Zähler.
                if (!root) {
                    continue
                }
                const newestFirst = sortEventsAsc(cs).reverse()
                const faces = uniqBy((c) => c.pubkey, newestFirst)
                    .slice(0, 3)
                    .map((c): ThreadFace => ({ pubkey: c.pubkey, name: displayProfileByPubkey(c.pubkey), picture: $profiles.get(c.pubkey)?.picture ?? '' }))
                out.push({
                    rootId: root.id,
                    nevent: nip19.neventEncode({ id: root.id, relays: [url], author: root.pubkey }),
                    roomH: getTagValue('h', root.tags) ?? '',
                    authorName: displayProfileByPubkey(root.pubkey),
                    snippet: snippet(bodyWithoutQuote(root)),
                    count: cs.length,
                    faces,
                    lastLabel: relativeTime(newestFirst[0].created_at),
                    lastTs: newestFirst[0].created_at,
                })
            }
            return out.sort((a, b) => b.lastTs - a.lastTs)
        },
    )

/**
 * Lädt die Threads-Übersicht eines Space (Startseite): alle Kommentare (kind 1111),
 * dann ihre Wurzel-Nachrichten (kind 9, per id — raumübergreifend), plus Vorwärmen
 * der beteiligten Profile (Gesichter/Autor). Fire-and-forget beim Betreten der Startseite.
 */
export const loadSpaceThreads = async (url: string): Promise<void> => {
    const comments = await loadRoomComments(url)
    const rootIds = uniq(comments.map(commentRootId).filter((id): id is string => Boolean(id)))
    const roots = rootIds.length > 0 ? await load({ relays: [url], filters: [{ ids: rootIds }] }) : []
    // Profile der Kommentar-Autoren (Gesichter) UND der Wurzel-Autoren (Snippet-Name) vorwärmen.
    void warmProfiles([...comments.map((c) => c.pubkey), ...roots.map((r) => r.pubkey)])
}

/**
 * Kommentiert `target` (Thread-Root ODER Eltern-Kommentar) mit einem kind-1111 (NIP-22).
 * Optimistisch: der Thunk legt den Kommentar sofort ins Repository (erscheint via
 * `deriveThread`); bei Relay-Reject zurückgenommen. Gibt '' bei Erfolg, sonst den Fehler.
 */
export const sendComment = async (url: string, target: TrustedEvent, content: string, attachment?: Attachment, rootH?: string): Promise<string> => {
    return publishOptimistic(url, makeComment(target, content, url, attachment, rootH))
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
    return publishOptimistic(url, makeGoal(params, h, url))
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
    return publishOptimistic(url, makePollResponse(poll, selectedIds, url, createdAt))
}
