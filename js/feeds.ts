/**
 * Room-Chat-Feed (M4, read-only) — inspiriert von `makeFeed` des Referenz-Clients,
 * aber schlank für die Alpine-Insel: statt bidirektionalem Sliding-Window-Scroller
 * eine Live-Subscription (`limit:0`) + Cursor-Pagination (`until`) über die
 * ohnehin reaktive `deriveEventsForUrl`-Ableitung. Senden kommt mit M5.
 *
 * NIP-29: Room-Nachrichten sind **kind 9** (`MESSAGE`) mit `#h`=Room-ID, auf dem
 * Space-Relay. AUTH (NIP-42) läuft automatisch über die Socket-Policy.
 */
import { derived, get, writable, type Readable } from 'svelte/store'
import { load, request } from '@welshman/net'
import { profilesByPubkey, publishThunk, pubkey, repository, displayProfileByPubkey, handlesByNip05, zappersByLnurl } from '@welshman/app'
import { parse, renderAsHtml, ParsedType } from '@welshman/content'
import { sanitizeUrl } from '@braintree/sanitize-url'
import { MESSAGE, COMMENT, DELETE, REACTION, POLL, POLL_RESPONSE, ZAP_RESPONSE, ZAP_GOAL, ROOM_DELETE_EVENT, makeEvent, sortEventsAsc, getTag, getTagValue, getLnUrl, fromMsats, zapFromEvent, profileHasName, type TrustedEvent, type Zap, type Zapper } from '@welshman/util'
import { groupBy, uniq, uniqBy } from '@welshman/lib'
import * as nip19 from 'nostr-tools/nip19'
import { deriveEventsForUrl } from './repository'
import { readState, roomWatermark } from './readState'
import { throttled } from '@welshman/store'
import { warmZappers } from './zaps'
import { roomTags, makeReaction, makeEventDelete, makeReport, makePoll, makePollResponse, makeGoal, makeComment, makeThreadReply, mentionPubkeys } from './interactions'
import { getPollEndsAt, getPollResults, getPollType, isPollClosed, isPollShareQuote, ownPollSelection, pollResponseTarget, QUOTE_PREFIX, type PollOption, type PollType } from './polls'
import { getGoalSummary, getGoalTargetSats, getGoalTitle, goalProgress } from './goals'
import { DEFAULT_RELAYS, proxifyImage } from './core'
import { contentEmojiTags } from './emoji'
import { linkDisplay, isPlausibleUrl } from './chatLinks'
import { firstNostrRef, refClickTarget, refThreadPath, shortenEntity, withShortRefTokens, type NostrRef } from './nostrEventLink'
import { quoteCardsEnabled } from './displayPrefs'
import { withSpace } from './spaceParam'
import { withOrigin } from './updatesView'
import { warmProfiles } from './profiles'
import { warmHandles, verifiedNip05 } from './handles'
import type { Attachment } from './uploads'
import { waitForPublishError } from './publishResult'
import { BUZZ_MESSAGE_V2 } from './relayCaps'
import { isRootMessage, isThreadReply, replyTargetIds, threadRootId } from './threading'
import { spaceIsBuzzAsync } from './buzzAdmin'
import { t } from './i18n'
import { formatTimestamp } from './locale'

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
    // Voller Anzeigetext inkl. Query/Fragment — welshmans `display` schneidet beides ab.
    a.innerText = linkDisplay(href, display)
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
const roomFilter = (h: string) => [{ kinds: [MESSAGE, BUZZ_MESSAGE_V2, POLL, ZAP_GOAL], '#h': [h] }]

/** Nachrichten, Polls UND Zap-Goals eines Raums — alle zeitlich verwoben im Verlauf. */
const roomStreamFilter = (h: string) => [{ kinds: [MESSAGE, BUZZ_MESSAGE_V2, POLL, ZAP_GOAL], '#h': [h] }]

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
 * (NIP-22, uppercase), Lotus' kind-10 und Buzz' kind-9-Antworten tragen den Root im
 * markierten `e`-Tag ({@link threadRootId}: `root`, bei Tiefe 1 ersatzweise `reply`).
 *
 * Der `reply`-Fallback ist der Buzz-Anteil und **kein** Sonderfall: eine Antwort direkt auf
 * die Wurzel trägt dort ausschließlich `reply` (Regel 1 in `threading.ts`) — die
 * NIP-10-konforme `root`-only-Form wird vom Relay angenommen und stillschweigend NICHT
 * verknüpft. Ohne den Fallback fiele genau die häufigste Antwort in den ''-Bucket.
 */
const commentRootId = (event: TrustedEvent): string =>
    getTagValue('E', event.tags) ?? threadRootId(event)

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
 * **Buzz-Antworten in einem Thread — `#e` mit Kinds, und immer nachgefiltert.**
 *
 * Auf Buzz ist eine Antwort kein eigenes Kind, sondern eine ganz normale Raum-Nachricht
 * (kind 9) mit markierten `e`-Tags. Zwei Regeln aus `threading.ts` stecken in dieser einen
 * Zeile: `#e` ist bei Buzz **markerblind** (Regel 8) — der Filter liefert also auch
 * Erwähnungen und fremde Threads zurück, weshalb jeder Aufrufer über
 * {@link commentRootId} nachfiltert. Und ein `kinds`-loser `#e`-Filter wird relayweit
 * abgelehnt (`restricted: p-gated events require #p matching your pubkey`), deshalb stehen
 * die Kinds hier explizit.
 */
const threadReplyFilter = (rootId: string) => [{ kinds: [MESSAGE, BUZZ_MESSAGE_V2], '#e': [rootId] }]

/**
 * kind-9735-Zap-Receipts (NIP-57): tragen KEIN `#h` — der LNURL-Server kopiert nur
 * `p`/`e`/`bolt11`/`description` ins Receipt. Deshalb hier ungefiltert je Space-Relay;
 * die Zuordnung zur Nachricht + Validierung läuft in `aggregateZaps` über `#e`.
 */
const roomZapReceiptFilter = () => [{ kinds: [ZAP_RESPONSE] }]

/**
 * Aufsteigend sortierter Chat-Verlauf eines Rooms (Nachrichten + Polls, reaktiv).
 *
 * **Thread-Antworten stehen hier NICHT.** Auf Buzz liegen sie im selben `#h`-Raum wie die
 * Wurzel (Regel 7) und kämen ohne diesen Schnitt doppelt an: einmal als eigene Zeile im
 * Verlauf, einmal im Thread. Das Slack-Modell zeigt sie nur im Thread.
 *
 * Der Schnitt ist **strukturell, nicht relay-abhängig** — und das ist Absicht. Er fragt
 * „trägt dieses Event einen `reply`-Marker?", nicht „ist das ein Buzz-Space?". Unsere
 * zooid-kind-9 zitieren über `q`, nie über ein markiertes `e`; dort trifft er also nichts.
 * Eine Weiche auf `isBuzzRelay` wäre hier zusätzlich gefährlich: sie meldet beim ersten
 * Rendern verlässlich `false` (NIP-11 noch unterwegs) — der Verlauf zeigte dann für einen
 * Frame jede Antwort als eigene Zeile und ruckelte sie danach weg.
 */
export const deriveRoomMessages = (url: string, h: string): Readable<TrustedEvent[]> =>
    derived(deriveEventsForUrl(url, roomStreamFilter(h)), (events) => {
        // Native Poll-Karten (kind 1068) zeigen die Frage bereits — die kind-9-Share-Quote,
        // die wir NUR für Flotilla mitposten, hier ausblenden, sonst erschiene sie doppelt.
        const pollIds = new Set(events.filter((e) => e.kind === POLL).map((e) => e.id))
        return sortEventsAsc(events.filter((e) => !isPollShareQuote(e, pollIds) && isRootMessage(e)))
    })

/**
 * Die Thread-Antworten eines Raums — der Gegenschnitt zu {@link deriveRoomMessages}.
 *
 * Speist den Antworten-Indikator (Zähler + Gesichter) an der Wurzel-Zeile, ohne eine
 * zweite Subscription zu brauchen: die Events liegen bereits im Repository, weil der
 * Raum-Filter sie mitbringt. Auf zooid ist die Liste leer (unsere Kommentare sind kind
 * 1111 und tragen kein `#h`) — die Ableitung kostet dort einen Filterdurchlauf und sonst
 * nichts.
 */
export const deriveRoomThreadReplies = (url: string, h: string): Readable<TrustedEvent[]> =>
    derived(deriveEventsForUrl(url, roomStreamFilter(h)), (events) => events.filter(isThreadReply))

/** Rohtext einer Nachricht ohne den vorangestellten Reply-Quote (für Snippets + Edit-Prefill). */
export const bodyWithoutQuote = (event: TrustedEvent): string =>
    getTagValue('q', event.tags) ? event.content.replace(QUOTE_PREFIX, '') : event.content

/**
 * Rendert den Nachrichtentext zu sicherer HTML (Text escaped, URLs sanitized).
 * Bei Replies wird das vorangestellte `nostr:nevent…` entfernt (trimParent) —
 * das Zitat zeigt stattdessen die kompakte Vorschau (siehe `deriveRoomChat`).
 */
/**
 * Die `@Name`-Erwähnung — seit 2026-08-16 ein KLICKBARES `<button>`, nicht mehr ein `<span>`.
 *
 * Mit dem Profil-Chip (siehe {@link buildRefCard}) fiel der einzige Weg weg, ein im Text
 * genanntes Profil zu öffnen. Die Erwähnung selbst übernimmt das jetzt: sie ist ohnehin die
 * Stelle, auf die ein Nutzer zeigt, wenn er wissen will, wer da genannt wurde.
 *
 * Ein echtes `<button>` und nicht `role="button"` an einem `<span>`, weil Enter und Leertaste
 * dann nativ auslösen — sonst müsste JEDER `x-html`-Container zusätzlich Tastatur-Ereignisse
 * delegieren (es sind zwei: die Nachrichtenzeile und der Thread-Kopf), und ein vergessener
 * wäre eine stumme Tastaturfalle statt eines sichtbaren Fehlers.
 *
 * Bewusst OHNE `aria-label`: der zugängliche Name ist der Inhalt (`@Relay Admin`) und damit
 * genauer als jede feste Beschriftung — dieselbe Entscheidung wie bei der Zitatkarte.
 *
 * `dataset.pubkey` trägt HEX, weil das `open-profile`-Ereignis hex erwartet (ein npub-String
 * würfe im Modal beim Kodieren). Gesetzt wird beides über die DOM-API, nicht per Template-
 * String: `textContent`/`dataset` escapen, eine Zeichenkette mit `${name}` täte es nicht — und
 * dieser Name kommt aus einem fremden `kind 0`.
 */
const renderMentionSpan = (pubkey: string): string => {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'mention'
    button.dataset.pubkey = pubkey
    button.textContent = `@${displayProfileByPubkey(pubkey)}`
    return button.outerHTML
}

/**
 * Der gerenderte Nachrichtentext.
 *
 * ── Warum hier nichts mehr aus dem Text entfernt wird ──────────────────────────────────
 * Zwischen dem 2026-08-15 und dem 2026-08-16 stand hier `dropChipMention`: die eine Mention,
 * für die ein Profil-Chip über dem Text stand, wurde aus den geparsten Nodes herausgeschnitten
 * (samt angrenzender Leerstelle), damit dieselbe Person nicht zweimal untereinander steht.
 *
 * Mit dem Chip ist auch der Schnitt entfallen (Begründung bei {@link buildRefCard}): er machte
 * aus „**21Meetup** von nostr:npub1…" ein „**21Meetup** von " — ein Satz mit fehlendem Subjekt,
 * während die Person oben in einer Karte ohne Bezug zu dieser Zeile stand. Ein Renderer darf
 * Text kürzen (Snippet, Ellipse), aber keine Aussage entfernen.
 *
 * Der Cache-Schlüssel ist deshalb wieder die blanke `event.id`: die HTML einer Nachricht hängt
 * an nichts mehr außer ihrem Body.
 */
const htmlCache = new Map<string, string>()
const renderMessageHtml = (event: TrustedEvent): string => {
    const cacheKey = event.id
    let html = htmlCache.get(cacheKey)
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
                // welshman linkt jedes wort.wort und setzt https:// davor —
                // Code-Token wie `Alpine.store`, `readState.ts`, `$store.unread`
                // fallen hier durch. isPlausibleUrl entscheidet, ob der Token
                // wirklich ein Link ist (Schema oder gelistete TLD); wenn nicht,
                // fällt die Node auf Plaintext zurück. Siehe chatLinks.ts.
                if (node.type === ParsedType.Link && !isPlausibleUrl(node.raw)) {
                    return renderAsHtml(
                        [{ type: ParsedType.Text, value: node.raw, raw: node.raw }],
                        { renderLink: renderMessageLink },
                    ).toString()
                }
                return renderAsHtml([node], { renderLink: renderMessageLink }).toString()
            })
            .join('')
        // Nur Mention-freie Nachrichten cachen: der Name eines Mentions lädt async
        // nach (Profil kommt später) → ein gecachtes `@npub…`-Fallback bliebe für
        // immer eingefroren. Ohne Mention ist die HTML statisch (Cache lohnt sich).
        if (!hasMention) {
            htmlCache.set(cacheKey, html)
        }
    }
    return html
}

const startOfDay = (d: Date): number => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()

const dayLabel = (ts: number): string => {
    const d = new Date(ts * 1000)
    const diffDays = Math.round((startOfDay(new Date()) - startOfDay(d)) / 86_400_000)
    if (diffDays === 0) {
        return t('Heute')
    }
    if (diffDays === 1) {
        return t('Gestern')
    }
    return formatTimestamp(ts, { day: 'numeric', month: 'long', year: 'numeric' })
}

const timeLabel = (ts: number): string => formatTimestamp(ts, { hour: '2-digit', minute: '2-digit' })

/**
 * Volles Datum+Uhrzeit für den Zeilen-Tooltip (`:title`) — und für jede Zeile, die
 * ausserhalb des Verlaufs steht (P6a: die Trefferliste der Raumsuche). Dort ist die
 * blosse Uhrzeit wertlos: die Treffer stammen aus mehreren Tagen und stehen ohne
 * Datumstrenner untereinander.
 */
export const fullTimeLabel = (ts: number): string => formatTimestamp(ts, { dateStyle: 'medium', timeStyle: 'short' })

/** Kompakte Vorschau der zitierten Nachricht (aufgelöst im selben Raum). */
export type ReplyPreview = { id: string; name: string; text: string }

/**
 * Zitatkarte (P5): eine im Nachrichtentext referenzierte Nachricht (`nostr:nevent…`/`note…`).
 *
 * `resolved=false` ist ein vollwertiger Zustand, kein Ladefehler: die Karte steht, zeigt die
 * gekürzte Kennung und behält ihre Fläche. `href` ist IMMER gesetzt — auch unaufgelöst —
 * damit in keinem der drei Klickfälle ein toter Knopf entsteht.
 */
export type QuoteCard = {
    kind: 'event'
    id: string
    /** bech32 ohne `nostr:` (Deep-Link-Bauteil). */
    entity: string
    /** Gekürzte Kennung für den unaufgelösten Zustand. */
    short: string
    /** Thread-Deep-Link inkl. `?from=`/`?space=` — immer gesetzt. */
    href: string
    /** `true` ⇒ Klick springt im Verlauf (`scrollToMessage`), sonst Deep-Link. */
    scroll: boolean
    resolved: boolean
    /**
     * Autor der zitierten Nachricht (hex); `''`, solange unaufgelöst. Er ist der Grund, warum
     * ein aufgelöstes Zitat WARM geöffnet werden kann (`openThread` braucht id + pubkey), ein
     * unaufgelöstes dagegen über den `href` normal navigiert.
     */
    pubkey: string
    /** Anzeigename der zitierten Nachricht; `''`, solange unaufgelöst. */
    name: string
    /** Textausschnitt der zitierten Nachricht; `''`, solange unaufgelöst. */
    text: string
}

/**
 * Die eine Karte einer Nachricht (P5) — nur ZITATE, `reply` schlägt sie.
 *
 * Ein im Text referenziertes Profil (`nostr:npub…`/`nprofile…`) bekam bis 2026-08-16 einen
 * eigenen Chip über dem Text; die Begründung dafür steht bei {@link buildRefCard}, ebenso
 * warum sie nicht mehr trägt.
 */
export type RefCard = QuoteCard

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
        return t('gerade eben')
    }
    const m = Math.floor(s / 60)
    if (m < 60) {
        return t('vor :count Min', { count: m })
    }
    const h = Math.floor(m / 60)
    if (h < 24) {
        return t('vor :count Std', { count: h })
    }
    const d = Math.floor(h / 24)
    return d < 7 ? t('vor :count Tg', { count: d }) : dayLabel(ts)
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
    // Genau EINE Karte aus dem Nachrichtentext (P5): Zitat (`nostr:nevent…`/`note…`) oder
    // Profil-Chip (`nostr:npub…`/`nprofile…`). null, wenn der Text keine NIP-21-Referenz
    // trägt, die Nachricht bereits eine `reply`-Vorschau zeigt, oder der Nutzer die Karten
    // abgeschaltet hat. Bewusst ein eigenes Feld und NICHT Teil von `html`: der `htmlCache`
    // friert ein, was er aufnimmt — ein Auflösungszustand hätte dort nichts zu suchen.
    refCard: RefCard | null
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
        typeLabel: multi ? t('Mehrfachwahl') : t('Einfachwahl'),
        closed,
        endsLabel: endsAt ? `${closed ? t('Beendet') : t('Endet')} ${fullTimeLabel(endsAt)}` : '',
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

// Der Alt-Lesestand (`room:lastread:${url}:${h}` in localStorage) stand bis P3 hier.
// Er ist ersatzlos ENTFERNT, nicht bloß umgeleitet: es darf nur EINEN Schreibpfad für
// das Wasserzeichen geben (`readState.ts setRead`), sonst driften wieder zwei Wahrheiten
// auseinander — genau der Befund, der die ganze Ungelesen-Arbeit ausgelöst hat. Die
// Altbestände werden beim ersten Start migriert und gelöscht (`migrateLegacyLastRead`).
// Der `lastRead`-Parameter von {@link deriveRoomChat} bleibt — er speist nur noch die
// „Neu"-Trennlinie und kommt jetzt aus `roomWatermark(...)`.

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
export type ChatBuildCtx = {
    me: string | null | undefined
    $profiles: Map<string, { picture?: string; nip05?: string; lud16?: string; lud06?: string }>
    $handles: Parameters<typeof verifiedNip05>[2]
    $zappers: Map<string, Zapper>
    byId: Map<string, TrustedEvent>
    // ── P5-Karten ────────────────────────────────────────────────────────────────────
    // Aufgelöste Ereignisse der Zitatkarten, nach id. Der Bau liest AUSSCHLIESSLICH hier
    // (nicht direkt im Repository), damit `toChatMessage` eine Funktion seines Kontexts
    // bleibt und ohne Store-Runtime prüfbar ist.
    refEvents: Map<string, TrustedEvent>
    // Aktueller Raum (`h`) — Rückfall für den Deep-Link, wenn der Raum des zitierten
    // Ereignisses unbekannt ist.
    h: string
    // `window.location.search` zum Emit-Zeitpunkt: `withOrigin`/`withSpace` reichen Herkunft
    // und Space-Markierung an den Deep-Link durch (gleiche Pflicht wie `bridge.ts threadHref`).
    search: string
    // Karten überhaupt bauen? Aus = gar keine Karte, nicht bloß eine unsichtbare.
    cards: boolean
    commentsByRoot: Map<string, TrustedEvent[]>
    reactionsByTarget: Map<string, TrustedEvent[]>
    pollResponsesByTarget: Map<string, TrustedEvent[]>
    zapsByTarget: Map<string, TrustedEvent[]>
}

/**
 * Die NIP-21-Referenz eines Events, memoisiert (P5).
 *
 * Der Body eines Events ändert sich nie → einmal suchen reicht. Ohne diesen Cache liefe
 * {@link firstNostrRef} bei JEDEM Emit über JEDE Nachricht, und das sind bei zehn reaktiven
 * Quellen einige Durchläufe pro Sekunde. Gleiche Bauart und gleicher Zweck wie
 * {@link mentionPkCache}; wird zusammen mit ihm geräumt ({@link evictChatMsgCache}).
 */
const refCache = new Map<string, NostrRef | null>()
const eventRef = (event: TrustedEvent): NostrRef | null => {
    let ref = refCache.get(event.id)
    if (ref === undefined) {
        ref = firstNostrRef(bodyWithoutQuote(event))
        refCache.set(event.id, ref)
    }
    return ref
}

/**
 * Nachgeladene Zitat-Ereignisse — und der Grund, warum es diesen Store überhaupt gibt.
 *
 * **Ohne ihn bliebe jede Karte für immer im Leerzustand.** Alle Ableitungsquellen des
 * Chat-Feeds sind auf `#h` (Raum) oder einen Kind gefiltert; welshmans `deriveEventsById`
 * emittiert nur, wenn ein eintreffendes Event `matchFilters` erfüllt
 * (`@welshman/store` `repository.js:16-19`). Ein per `load({ids})` nachgeholtes Zitat aus
 * einem anderen Raum passt in KEINEN dieser Filter: es landet im Repository, ohne dass
 * `deriveRoomChat` davon erfährt. Der Store ist die fehlende Benachrichtigung — er hängt als
 * eigene Quelle in der Ableitung und emittiert genau dann, wenn ein Nachladen etwas erbracht
 * hat.
 *
 * Er wird ausschließlich ASYNCHRON beschrieben (im `then` des Ladens), nie während eines
 * Ableitungsdurchlaufs — ein synchrones `set` auf eine eigene Abhängigkeit löste den Durchlauf
 * mitten in sich selbst erneut aus.
 */
const refEventStore = writable<Map<string, TrustedEvent>>(new Map())

/** Bereits angefragte Zitat-IDs — kein zweiter Netzweg für dasselbe Ereignis. */
const refRequested = new Set<string>()

/**
 * Fehlende Zitat-Ereignisse nachladen (fire-and-forget, dedupliziert) — Muster
 * {@link warmProfiles}/`warmZappers`.
 *
 * **Relay-Wahl: Space-Relay + `DEFAULT_RELAYS`, ausdrücklich NICHT die Hints aus dem
 * `nevent`.** Ein `nevent` steht im Text einer fremden Nachricht; seine Relay-Hints sind
 * damit vom Absender frei wählbar, und ein Verbindungsversuch dorthin wäre eine vom Absender
 * gesteuerte Preisgabe der IP-Adresse jedes Lesers. Der Gegenwert wäre gering: ein Zitat aus
 * unserem Space liegt ohnehin auf dem Space-Relay. Dieselbe feste, app-eigene Relay-Menge
 * benutzt bereits {@link loadRoomZaps}. Wer die Reichweite später doch braucht, hebt die
 * Entscheidung hier auf — an einer Stelle, mit dieser Begründung davor.
 */
const warmRefEvents = (url: string, ids: string[]): void => {
    const missing = ids.filter((id) => !refRequested.has(id) && !repository.getEvent(id))
    if (missing.length === 0) {
        return
    }
    missing.forEach((id) => refRequested.add(id))
    void load({ relays: uniq([url, ...DEFAULT_RELAYS]), filters: [{ ids: missing }] })
        .then((events) => {
            const found = events.filter((e) => missing.includes(e.id))
            if (found.length === 0) {
                // Nichts gefunden: die Karte bleibt im Leerzustand — kein Emit, kein Neubau.
                return
            }
            refEventStore.update((current) => {
                const next = new Map(current)
                for (const event of found) {
                    next.set(event.id, event)
                }
                return next
            })
        })
        .catch(() => {
            // Netz/Relay weg → die Karte bleibt bei ihrer Kennung. Ein erneuter Versuch
            // käme beim nächsten Insel-Start (`refRequested` lebt nur in diesem Modul).
        })
}

/**
 * Auflösungstabelle der Zitat-Ereignisse für EINEN Ableitungsdurchlauf.
 *
 * Zwei Quellen, in dieser Reihenfolge: das Repository (synchron, deckt alles ab, was der
 * Client ohnehin schon hat) und der Nachlade-Store. Was hier fehlt, wird angefragt.
 */
const collectRefEvents = (url: string, events: TrustedEvent[], loaded: Map<string, TrustedEvent>): Map<string, TrustedEvent> => {
    const resolved = new Map<string, TrustedEvent>()
    const missing: string[] = []
    for (const event of events) {
        const ref = eventRef(event)
        if (ref?.kind !== 'event') {
            continue
        }
        const found = repository.getEvent(ref.id) ?? loaded.get(ref.id)
        if (found) {
            resolved.set(ref.id, found)
        } else {
            missing.push(ref.id)
        }
    }
    if (missing.length > 0) {
        warmRefEvents(url, uniq(missing))
    }
    return resolved
}

/**
 * Die pubkeys, deren Profil eine Karte dieses Feeds anzeigt — seit dem Wegfall des Profil-Chips
 * (2026-08-16, siehe {@link buildRefCard}) sind das nur noch die Autoren zitierter Ereignisse.
 *
 * Referenzierte Profile fehlen hier nicht: sie werden über `mentionPubkeys` gewärmt, weil ihr
 * Name jetzt IM Fließtext steht (`@Name` statt gekürztem npub) — dieselbe Quelle, aus der auch
 * jede andere Erwähnung ihren Namen bekommt.
 */
const refCardPubkeys = (events: TrustedEvent[], refEvents: Map<string, TrustedEvent>): string[] => {
    const pks: string[] = []
    for (const event of events) {
        const ref = eventRef(event)
        if (ref?.kind === 'event') {
            const quoted = refEvents.get(ref.id)
            if (quoted) {
                pks.push(quoted.pubkey)
            }
        }
    }
    return pks
}

/**
 * Die eine Karte einer Nachricht (P5) — oder `null`.
 *
 * Rangfolge, absichtlich in dieser Reihenfolge:
 * 1. Karten abgeschaltet ⇒ nichts.
 * 2. Die Nachricht zeigt bereits eine `reply`-Vorschau (q-Tag) ⇒ nichts. Sonst stünden zwei
 *    Zitate übereinander — und bei einer Antwort wäre das zweite dasselbe wie das erste.
 * 3. Ereignis-Referenz ⇒ Zitatkarte. 4. Profil-Referenz ⇒ NICHTS, siehe unten.
 *
 * ── Warum ein referenziertes Profil keine Karte mehr bekommt (2026-08-16) ───────────────
 * Bis hierher erzeugte die ERSTE dekodierbare Profil-Referenz einen Chip über dem Text, und
 * ihr `@Name`-Span im Fließtext wurde dafür entfernt (`dropChipMention`, Nutzerentscheidung
 * 2026-08-15 gegen die Dublette „Person zweimal untereinander").
 *
 * Diese Regel bricht, sobald eine Nachricht MEHRERE Personen nennt — der Normalfall einer
 * Ankündigung. Gemeldet am 2026-08-16 an einer Nachricht mit drei npubs in der Form
 * „**Raum** von nostr:npub1…": der erste Mention verschwand aus dem Satz („… von " + nichts),
 * wanderte als Karte über die Nachricht und stand dort ohne Bezug zu der Zeile, aus der er
 * stammte; die beiden anderen blieben als `@Name` inline. Ein Satz wurde also verstümmelt,
 * damit oben eine Karte stehen kann, die dieselbe Person nur benennt.
 *
 * Ein Zitat trägt FREMDEN Inhalt (Autor + Ausschnitt) und rechtfertigt die eigene Fläche.
 * Ein Profil-Chip trug nur einen Namen — denselben Namen, den der Fließtext ohnehin zeigt.
 * Deshalb fällt der Chip ganz und nicht bloß im Mehrfach-Fall: „manchmal Karte, manchmal
 * inline" wäre eine Regel, die niemand beim Schreiben im Kopf hat. Damit entfällt zugleich
 * der Grund für `dropChipMention` — der Mention bleibt immer stehen, und die Dublette von
 * 2026-08-15 kann nicht wiederkehren, weil es nichts mehr gibt, das ihn dupliziert.
 *
 * Die Profil-Erkennung selbst bleibt (`firstNostrRef`): sie hält die Priorität „Ereignis
 * schlägt Profil" und damit die Aussage, dass eine Nachricht mit npub UND nevent die
 * Zitatkarte bekommt.
 */
const buildRefCard = (event: TrustedEvent, ctx: ChatBuildCtx, reply: ReplyPreview | null): RefCard | null => {
    if (!ctx.cards || reply) {
        return null
    }
    const ref = eventRef(event)
    if (ref === null || ref.kind === 'profile') {
        return null
    }
    const quoted = ctx.refEvents.get(ref.id)
    const resolved = Boolean(quoted)
    // Der Deep-Link steht auch ohne aufgelöstes Ereignis: die Ziel-ID steckt in der Kennung
    // selbst, `openThread` lädt daraus per id. So bleibt kein Klickfall ohne Wirkung. Der
    // Zielraum ist nur bei aufgelöstem Ereignis bekannt; sonst leer (→ Rückfall auf `ctx.h`).
    const quotedRoom = quoted ? (getTagValue('h', quoted.tags) ?? '') : ''
    const base = refThreadPath(ref.entity, quotedRoom, ctx.h)
    return {
        kind: 'event',
        id: ref.id,
        entity: ref.entity,
        short: shortenEntity(ref.entity),
        href: withSpace(withOrigin(base, ctx.search), ctx.search),
        // `scroll` nur bei nachweislicher Anwesenheit im geladenen Fenster (`byId`) —
        // `scrollToMessage` kehrt sonst wortlos zurück (`bridge.ts:4106-4108`).
        scroll: refClickTarget(resolved, ctx.byId.has(ref.id)) === 'scroll',
        resolved,
        pubkey: quoted?.pubkey ?? '',
        name: quoted ? displayProfileByPubkey(quoted.pubkey) : '',
        text: quoted ? withShortRefTokens(snippet(bodyWithoutQuote(quoted))) : '',
    }
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
    const card = buildRefCard(event, ctx, reply)
    return {
        id: event.id,
        pubkey: event.pubkey,
        created_at: event.created_at,
        // name/nip05/picture/profileReady/html/time/fullTime — geteilter Personen-Baustein.
        ...personFields(event, ctx.$profiles, ctx.$handles),
        mine,
        reply,
        refCard: card,
        thread,
        reactions: aggregateReactions(ctx.reactionsByTarget.get(event.id) ?? [], ctx.me, nameOf),
        poll: event.kind === POLL ? buildPollView(event, ctx.pollResponsesByTarget.get(event.id) ?? [], ctx.me) : null,
        goal: event.kind === ZAP_GOAL ? buildGoalView(event, zaps) : null,
        zaps,
        zappable: !mine && Boolean(lnurl),
    }
}

/**
 * Result-Memoization für {@link toChatMessage} im Raum-Feed. Der derived-Store recomputet bei
 * JEDEM Input-Emit (Nachrichten-, Profil-, Reaction-, Zap-, Kommentar-Welle) die GANZE Liste —
 * beim Kaltstart ~20× über bis zu ~70 Events, obwohl zwischen zwei Emits fast alle Events
 * UNVERÄNDERT sind (nur EIN Event/Profil kam neu). Wir cachen die gebaute ChatMessage pro
 * event.id und bauen nur neu, wenn sich ein Input GENAU DIESES Events geändert hat.
 *
 * Change-Detection per Key. WICHTIG: welshmans Profil-/Handle-/Zapper-Stores (`deriveItemsByKey`,
 * @welshman/store repository.js) mutieren EINE Map IN-PLACE und emittieren sie per selber Referenz
 * — die Map-REFERENZ taugt NICHT als Buster (bliebe konstant → alles stale). Der EINZELWERT
 * `get(pubkey)` bustet dagegen (neues Item-Objekt pro Update). Also granular pro pubkey:
 *  - profileRefs: `$profiles.get(pk)` für ALLE pubkeys, deren Profil (Name/Avatar/nip05-Feld/lud16)
 *    ins Rendering einfließt — Autor + zitierter Reply-Autor + NIP-27-Mentions + Thread-Kommentatoren
 *    (Faces) + Reaktoren (Chip-Tooltip). Ein reiner Autor-Key ließ Nicht-Autor-Namen für immer auf
 *    dem npub-Fallback einfrieren (Review-Fund #1–#3/#5) — unterläuft genau den Mention-Skip des htmlCache.
 *  - fp: nip05-Verifikationsergebnis des Autors (deckt das spät verifizierte Häkchen: hängt an
 *    $handles, nicht am Autor-Profil-Feld) + je ein billiger ordnungsabhängiger Hash über die
 *    Aggregat-Bucket-Event-IDs (reactions/zaps/comments/poll-responses; `groupBy` liefert pro Compute
 *    NEUE Array-Refs → Referenzvergleich unbrauchbar). ponytail: 32-bit-Hash, Kollision ~bucketSize/2³²
 *    ⇒ schlimmstenfalls EIN Emit lang stale Chip-Zähler (rein visuell, KEIN Konsens-/Signaturpfad).
 *  - me: eingeloggter pubkey (stabil). quoted: Event-Ref des Zitats (undefined→Event, sobald das
 *    zitierte Event spät nachlädt → reply wechselt null→Vorschau).
 *
 * Zapper-Meta ($zappers.get(lnurl)) IST im Key (gegated auf „hat Zap-Receipts"): sie validiert die
 * Zap-SUMME (Signer-Check gegen zapper.nostrPubkey), und der Zapper lädt fast IMMER erst NACH den
 * 9735-Receipts nach → ohne ihn im Key bliebe der ⚡-Chip für immer auf 0 (Cache-Hit auf die count-0-
 * Message, auch nach Reload). Der Ref bustet, sobald der Zapper auflöst → Neubau → Chip erscheint.
 *
 * ponytail — bewusst NICHT im Key (Hover-only, kein sichtbares Feld):
 *  - `zaps.names` (Zapper-Anzeigename im Zap-Chip-TOOLTIP, aus dem eingebetteten `request.pubkey`) —
 *    dessen kind-0 wird nicht mal gewärmt (warmProfiles deckt Zapper nicht), zeigt also ohnehin oft
 *    npub; die Memoization verschärft das nur im engen Fall „Zapper-Profil lädt via anderen Pfad".
 * Hover-only (auf der Touch-WebView praktisch unsichtbar), selbstkorrigierend beim nächsten Message-
 * relevanten Emit. Den request.pubkey pro Zap-Receipt zu extrahieren lohnt fürs Tooltip-Feld nicht.
 *
 * Nur der Raum-Feed nutzt den Cache; der Thread-Feed baut direkt (Kommentare = kind 1111,
 * disjunkte IDs; klein & selten offen → Memoization lohnt dort nicht, hält den Cache-Kontext eindeutig).
 */
type ChatMsgFields = Omit<ChatMessage, 'divider' | 'unreadDivider' | 'showAuthor'>
type ChatMsgMemo = {
    profileRefs: unknown[]
    me: string | null | undefined
    quoted: unknown
    /** Aufgelöstes Ereignis der Zitatkarte (P5) — bustet, sobald es nachlädt. */
    refQuoted: unknown
    zapperRef: unknown
    fp: string
    msg: ChatMsgFields
}
const chatMsgCache = new Map<string, ChatMsgMemo>()

/** NIP-27-Mention-pubkeys sind event-invariant (Body ändert sich nie) → einmal parsen + cachen. */
const mentionPkCache = new Map<string, string[]>()
const eventMentionPks = (event: TrustedEvent): string[] => {
    let pks = mentionPkCache.get(event.id)
    if (pks === undefined) {
        pks = mentionPubkeys(bodyWithoutQuote(event))
        mentionPkCache.set(event.id, pks)
    }
    return pks
}

/** Profil-Werte-Refs aller pubkeys, deren Name/Avatar ins Rendering DIESER Message einfließt. */
const renderedProfileRefs = (
    event: TrustedEvent,
    ctx: ChatBuildCtx,
    quoted: TrustedEvent | undefined,
    refQuoted: TrustedEvent | undefined,
): unknown[] => {
    const pks = new Set<string>()
    pks.add(event.pubkey)
    if (quoted) {
        pks.add(quoted.pubkey)
    }
    // Autor der ZITATKARTE (P5). Referenzierte PERSONEN stecken bereits in `eventMentionPks`
    // (dieselben `nostr:npub…`/`nprofile…`-Token) — seit dem Wegfall des Profil-Chips ist das
    // sogar der einzige Weg, auf dem ihr Name in die Zeile kommt. Der Autor eines zitierten
    // EREIGNISSES steht dagegen in keinem der anderen Zweige: ohne ihn bliebe sein Name auf dem
    // npub-Fallback stehen, sobald die Karte einmal gebaut ist.
    if (refQuoted) {
        pks.add(refQuoted.pubkey)
    }
    for (const pk of eventMentionPks(event)) {
        pks.add(pk)
    }
    for (const c of ctx.commentsByRoot.get(event.id) ?? []) {
        pks.add(c.pubkey)
    }
    for (const r of ctx.reactionsByTarget.get(event.id) ?? []) {
        pks.add(r.pubkey)
    }
    const refs: unknown[] = []
    for (const pk of pks) {
        refs.push(ctx.$profiles.get(pk))
    }
    return refs
}

const sameRefs = (a: unknown[], b: unknown[]): boolean => {
    if (a.length !== b.length) {
        return false
    }
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) {
            return false
        }
    }
    return true
}

/**
 * Cache-Einträge der genannten Event-IDs freigeben (Raumwechsel/Teardown) — sonst wächst der
 * modul-globale Cache über eine lange WebView-Session monoton (je ChatMessage inkl. html-String).
 */
export const evictChatMsgCache = (ids: Iterable<string>): void => {
    for (const id of ids) {
        chatMsgCache.delete(id)
        mentionPkCache.delete(id)
        refCache.delete(id)
    }
}

/**
 * Billiger ordnungsabhängiger Fingerprint eines Aggregat-Buckets. Leer/undefined → '0'; ein nicht-
 * leerer Bucket liefert IMMER das Format `LEN:HASH` (LEN ≥ 1) und kann so nie versehentlich mit dem
 * Leer-Sentinel `'0'` kollidieren, selbst wenn der Polynom-Hash zufällig 0 ergibt (Review-Fund #4).
 */
const bucketFp = (evs?: TrustedEvent[]): string => {
    if (!evs || evs.length === 0) {
        return '0'
    }
    let h = evs.length
    for (const e of evs) {
        h = (Math.imul(h, 31) + parseInt(e.id.slice(0, 8), 16)) >>> 0
    }
    return `${evs.length}:${h}`
}

export const memoedToChatMessage = (event: TrustedEvent, ctx: ChatBuildCtx): ChatMsgFields => {
    const quotedId = getTagValue('q', event.tags)
    const quoted = quotedId ? ctx.byId.get(quotedId) : undefined
    // Das aufgelöste Ereignis der ZITATKARTE (P5) — undefined, solange es fehlt. Genau dieser
    // Wechsel undefined→Event ist der Moment, in dem die Karte aus dem Leerzustand in die
    // Vorschau kippt; ohne ihn im Key bliebe sie für immer bei ihrer Kennung stehen, obwohl
    // das Ereignis längst da ist. Derselbe Fehler wie beim eingefrorenen Mention-Namen
    // (Review-Fund #1–#3/#5) und beim ⚡-Chip ohne Zapper.
    const ref = ctx.cards ? eventRef(event) : null
    const refQuoted = ref?.kind === 'event' ? ctx.refEvents.get(ref.id) : undefined
    const profileRefs = renderedProfileRefs(event, ctx, quoted, refQuoted)
    // Zapper-Ref in den Key — ABER NUR wenn dieses Event Zap-Receipts hat. Ohne aufgelösten
    // Zapper zählt aggregateZaps 0 (der Receipt-Signer-Check gegen zapper.nostrPubkey schlägt
    // fehl). Der Zapper lädt via warmZappers fast IMMER erst NACH den 9735-Receipts nach
    // (async Profil→lnurl→Zapper) → stünde er nicht im Key, bliebe der ⚡-Chip für immer auf 0
    // (Cache-Hit auf die count-0-Message, auch nach Reload). undefined bei leerem Bucket → kein
    // Extra-Recompute, wenn zappersByLnurl für die Zapper ANDERER Autoren emittiert. Genau das
    // ist zugleich die Selbstheilung: sobald der Zapper auflöst, bustet der Ref → Neubau → Chip.
    const profile = ctx.$profiles.get(event.pubkey)
    const lnurl = ctx.zapsByTarget.get(event.id)?.length ? getLnUrl(profile?.lud16 || profile?.lud06 || '') : ''
    const zapperRef = lnurl ? ctx.$zappers.get(lnurl) : undefined
    // Im Key, weil SICHTBAR und aus keiner anderen Zutat folgend: der Karten-Schalter
    // (aus ⇒ gar keine Karte). Hier stand daneben das spät verifizierte NIP-05-Häkchen des
    // Profil-Chips; mit dem Chip ist es entfallen (siehe `buildRefCard`). Das Häkchen des
    // AUTORS bleibt — es hängt an `$handles`, nicht am Profil-Wert, und wird eine Zeile
    // weiter unten eingerechnet.
    const fp =
        `${ctx.cards ? '1' : '0'}` +
        `|${verifiedNip05(event.pubkey, ctx.$profiles, ctx.$handles)}` +
        `|${bucketFp(ctx.reactionsByTarget.get(event.id))}|${bucketFp(ctx.zapsByTarget.get(event.id))}` +
        `|${bucketFp(ctx.commentsByRoot.get(event.id))}|${bucketFp(ctx.pollResponsesByTarget.get(event.id))}`
    const hit = chatMsgCache.get(event.id)
    if (
        hit &&
        hit.me === ctx.me &&
        hit.quoted === quoted &&
        hit.refQuoted === refQuoted &&
        hit.zapperRef === zapperRef &&
        hit.fp === fp &&
        sameRefs(hit.profileRefs, profileRefs)
    ) {
        return hit.msg
    }
    const msg = toChatMessage(event, ctx)
    chatMsgCache.set(event.id, { profileRefs, me: ctx.me, quoted, refQuoted, zapperRef, fp, msg })
    return msg
}

/**
 * Aggregierte Chat-Sicht: Nachrichten mit aufgelösten Profilen, Datums-Dividern
 * und Autor-Gruppierung — die Insel braucht nur EIN `subscribe`. HTML wird je
 * Event einmal geparst (Cache), Namen fließen reaktiv aus `profilesByPubkey`.
 *
 * `lastRead` ist seit P3 die **Wall-Clock** des Geräts beim letzten Quittieren
 * (`readState.ts roomWatermark`), nicht mehr das `created_at` der jüngsten gelesenen
 * Nachricht. Für die Trennlinie ändert das nichts an der Frage („was kam, seit ich
 * zuletzt unten stand?"), wohl aber an der Manipulierbarkeit: ein Event mit
 * `created_at = now + 1 Jahr` konnte vorher den ganzen Verlauf quittieren.
 */
export const deriveRoomChat = (url: string, h: string, lastRead = 0): Readable<ChatMessage[]> =>
    derived(
        [
            // Nachrichten LEADING-EDGE-gedrosselt (100ms): `throttle` feuert den ersten Emit
            // einer Ruhephase SOFORT (Tools.ts:987) → eine einzeln gesendete/eintreffende Nachricht
            // erscheint im Ruhezustand ohne Latenz; nur wenn im letzten 100ms-Fenster schon ein
            // Emit war, wartet sie bis zum trailing edge (≤100ms) — NIE gedroppt, scrollToBottom
            // pinnt ohnehin nativ (column-reverse). NUR ein Kaltstart-Burst (der Verlauf streamt
            // Event für Event herein) fällt so von ~25 auf ~8 Recomputes zusammen — jeder Recompute
            // baut die GANZE Liste neu + ruft warmProfiles/Handles/Zappers. 340ms-Block im CPU-Profil.
            throttled(100, deriveRoomMessages(url, h)),
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
            // Buzz-Antworten (kind 9 mit `reply`-Marker) — auf zooid immer leer.
            throttled(200, deriveRoomThreadReplies(url, h)),
            // P5: nachgeladene Zitat-Ereignisse. Diese Quelle ist PFLICHT, nicht Beiwerk —
            // ohne sie erfährt der Feed nie, dass ein per `load({ids})` geholtes Zitat
            // angekommen ist (jede andere Quelle hier ist auf `#h` oder einen Kind gefiltert
            // und passt auf ein raumfremdes Ereignis nicht), und die Karte bliebe für immer
            // im Leerzustand. Siehe {@link refEventStore}.
            throttled(200, refEventStore),
            // Der Abschalter. Ungedrosselt: er hängt an einem Klick, nicht an einer Welle.
            quoteCardsEnabled,
        ],
        ([events, $profiles, $me, $handles, $reactions, $pollResponses, $zaps, $zappers, $nip22Comments, $threadReplies, $refEvents, $cards]) => {
        // Beide Antwort-Formate in EINEN Strom: kind-1111/kind-10 (zooid) und Buzz'
        // kind-9-Antworten. `commentRootId` liest den Root aus beiden, der Rest des Feeds
        // sieht keinen Unterschied — Zähler, Gesichter und „zuletzt geantwortet" gelten für
        // beide Relay-Arten aus derselben Codezeile.
        const $comments = $threadReplies.length > 0 ? [...$nip22Comments, ...$threadReplies] : $nip22Comments
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
        // P5: zitierte Ereignisse auflösen (Repository + bereits Nachgeladenes) und Fehlendes
        // anfragen. Abgeschaltet ⇒ leere Tabelle, kein Auflösen, kein Nachladen — der Schalter
        // spart die Relay-Anfragen mit, nicht nur die Fläche. Steht VOR dem Profil-Wärmen,
        // damit der Autor eines gerade aufgelösten Zitats in derselben Runde mitgewärmt wird.
        const refEvents = $cards ? collectRefEvents(url, events, $refEvents) : new Map<string, TrustedEvent>()
        const cardPubkeys = $cards ? refCardPubkeys(events, refEvents) : []
        // First-Paint-Seed: fehlende Autor- UND erwähnte Profile (NIP-27) vom geteilten
        // Backend-Cache holen (dedupliziert intern; welshman löst parallel live auf).
        // Ohne die Mention-Pubkeys blieben extern referenzierte @-Mentions (Nicht-
        // Mitglieder/gepastete npubs) dauerhaft als gekürztes npub statt @Name. Fire-and-forget.
        void warmProfiles([
            ...events.map((e) => e.pubkey),
            ...events.flatMap((e) => mentionPubkeys(bodyWithoutQuote(e))),
            ...$comments.map((c) => c.pubkey), // Kommentar-Autoren → Gesichter im Antworten-Indikator (C6b)
            ...cardPubkeys, // P5: Person des Profil-Chips + Autor der Zitatkarte
        ])
        // NIP-05-Handles lazy verifizieren (dedupliziert, fire-and-forget): Autoren UND die
        // Personen der Karten — ein Profil-Chip trägt dasselbe Häkchen wie eine Autorenzeile,
        // und ohne diesen Zusatz bliebe es dort für immer aus.
        warmHandles([...events.map((e) => e.pubkey), ...cardPubkeys])
        // Zapper (LNURL-pay-Meta) der Autoren lazy laden — nötig, um ihre 9735-Receipts
        // zu validieren (Signer-Check) und den ⚡-Chip zu summieren (dedupliziert intern).
        warmZappers(events.map((e) => e.pubkey))
        // Index für die Reply-Auflösung im selben Raum (q-Tag → zitierte Nachricht).
        const byId = new Map(events.map((e) => [e.id, e]))
        const ctx: ChatBuildCtx = {
            me: $me,
            $profiles,
            $handles,
            $zappers,
            byId,
            refEvents,
            h,
            search: window.location.search,
            cards: $cards,
            commentsByRoot,
            reactionsByTarget,
            pollResponsesByTarget,
            zapsByTarget,
        }

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
            return { divider, unreadDivider, showAuthor, ...memoedToChatMessage(event, ctx) }
        })
    },
    )

/**
 * Honoriert ein eingehendes NIP-29-`delete-event` (kind 9005, nur von `can_manage`-
 * Admins signiert — das Relay gatet die Annahme, siehe zooid `CheckWrite`): entfernt
 * die per `e`-Tag referenzierten Ziel-Events aus dem Repository, worauf der abgeleitete
 * Feed OHNE sie re-emittiert → Live-Löschung ohne Reload. Nötig, weil welshmans
 * Repository von sich aus NUR kind-5 (NIP-09, gleicher Autor) honoriert, NICHT 9005
 * (Beleg: @welshman/app dist/net/src/repository.js `publish`, Zweig `event.kind === DELETE`).
 */
const honorDeleteEvent = (event: TrustedEvent): void => {
    if (event.kind !== ROOM_DELETE_EVENT) {
        return
    }
    for (const tag of event.tags) {
        if (tag[0] === 'e' && tag[1]) {
            repository.removeEvent(tag[1])
        }
    }
}

/**
 * Öffnet eine Live-Subscription für NEUE Room-Events (bleibt bis abort offen):
 * Nachrichten (kind 9), Reactions (kind 7), Tombstones (kind 5), Poll(-Responses)
 * und Goals — alle `#h`. Kommentare (kind 1111) tragen KEIN `#h` (flotilla-kompatibel)
 * → eigener, ungescopter Filter, damit der Live-Antworten-Zähler ohne separate Sub kommt.
 *
 * `onClosed` (P11): feuert mit dem CLOSED-GRUND des Relays, wenn eine Sub nicht mit
 * EOSE, sondern mit `["CLOSED", id, reason]` abgewiesen wird. `request` spreadd seine
 * Optionen an jedes `requestOne` durch, und `requestOne.onClosed(reason, url)` ist der
 * einzige Punkt, an dem der Grund noch vorhanden ist (`load()`/`makeLoader` ruft sein
 * `onClose` ohne Argument und zusätzlich im Timeout-Pfad — dort sind „abgelehnt" und
 * „Zeit übergelaufen" nicht unterscheidbar). Gemessen in P11: für ein angemeldetes
 * Relay-Nicht-Mitglied kommt für JEDE Sub dieser Seite `restricted: you are not a
 * member of this relay` (p11-02/p11-05), für einen Gast wird `auth-required:` vorher
 * vom Auth-Buffer aus der Empfangsschlange entfernt und onClosed feuert nie
 * (p11-04). Kein zusätzlicher Request — die Live-Sub läuft ohnehin.
 */
export const listenRoom = (url: string, h: string, signal: AbortSignal, onClosed?: (reason: string) => void): void => {
    void request({
        relays: [url],
        signal,
        onEvent: honorDeleteEvent,
        onClosed,
        filters: [
            { kinds: [MESSAGE, REACTION, DELETE, POLL, POLL_RESPONSE, ZAP_GOAL, ROOM_DELETE_EVENT], '#h': [h], limit: 0 },
            { kinds: [COMMENT, CHAT_THREAD], limit: 0 },
        ],
    })
}

/**
 * Admin-Live-Löschung EINER fremden Nachricht (NIP-29 kind 9005, `delete-event`): baut ein
 * 9005 mit `h`=Raum-ID + `e`=Ziel-Event-ID und publiziert es ans Space-Relay. zooid nimmt
 * 9005 nur von `can_manage`-Admins an (CheckWrite), löscht das Ziel serverseitig und
 * broadcastet das 9005 an alle offenen `listenRoom`-Subscriber → `honorDeleteEvent` lässt es
 * dort live verschwinden. ERGÄNZT (ersetzt nicht) den NIP-86-`banEvent`: 9005 propagiert live
 * an Clients, `banEvent` trägt die id zusätzlich in die relay-seitige Bann-Liste (verhindert
 * Re-Publish desselben Events). '' = Erfolg.
 */
export const moderateDeleteMessage = (url: string, h: string, id: string): Promise<string> =>
    waitForPublishError(publishThunk({ relays: [url], event: makeEvent(ROOM_DELETE_EVENT, { tags: [['h', h], ['e', id]] }) }))

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
 * Selbstreparatur gegen „Limbo"-Nachrichten: lädt die GESPEICHERTEN NIP-29-9005
 * (delete-event) eines Raums — bewusst OHNE `limit:0`, also echte Historie, anders als
 * die live-only `listenRoom` — und schleust jedes durch `honorDeleteEvent`. Ein Client,
 * der beim Live-Broadcast des 9005 offline/geschlossen war, holt die Löschung so beim
 * nächsten Öffnen/Reconnect nach: das Ziel fliegt aus dem `repository` (→ Feed re-emittiert
 * ohne es) und via `syncEvents.removed` aus der IDB. Läuft im Room-Load neben
 * loadRoomMessages/loadRoomReactions, damit es vor/mit dem ersten Paint wirkt.
 */
export const loadRoomDeletes = async (url: string, h: string): Promise<void> => {
    const deletes = await load({ relays: [url], filters: [{ kinds: [ROOM_DELETE_EVENT], '#h': [h] }] })
    for (const event of deletes) {
        honorDeleteEvent(event)
    }
}

/**
 * Lädt die bestehenden NIP-22-Kommentare (kind 1111) des Space-Relays, damit die
 * Antworten-Indikatoren schon beim ersten Öffnen stimmen (die Live-Sub liefert nur
 * Neues). OHNE `#h` (flotilla-kompatibel), Zuordnung über `["E", rootId]`.
 * ponytail: ungescopt je Relay — bei sehr vielen Threads später auf sichtbare Roots
 * (`#E`) eingrenzen; für die aktuelle Space-Größe unschädlich.
 *
 * Der Filter trug bis P3 GAR KEIN `limit` und lief damit in die zooid-Falle: fehlt das
 * `limit`, greift der Relay-Deckel nicht und die SQL bekommt gar keins
 * (`zooid/events.go:104-106` und `:239-240`) — dieser Aufruf zog bei JEDEM Raum-Öffnen
 * sämtliche Kommentare des Relays. Der Wert entspricht exakt zooids eigenem Maximum
 * (`instance.go:319`); sortiert wird `created_at DESC` (`events.go:165`), es kommen also
 * die jüngsten. Für jeden Space unter 1000 Kommentaren ändert sich am Ergebnis nichts —
 * nur die Abfrage ist jetzt begrenzt.
 */
const COMMENT_LOAD_LIMIT = 1000

export const loadRoomComments = (url: string): Promise<TrustedEvent[]> =>
    load({ relays: [url], filters: [{ kinds: [COMMENT, CHAT_THREAD], limit: COMMENT_LOAD_LIMIT }] })

/**
 * Der Buzz-Gegenpart zu {@link loadRoomComments} für die Space-Startseite: Antworten sind
 * dort kind-9-Raum-Nachrichten und lassen sich **nicht** gezielt abfragen — es gibt keinen
 * Filter „hat irgendein `e`-Tag". Also die jüngsten Raum-Nachrichten des Relays holen und
 * client-seitig auf Antworten schneiden.
 *
 * **Hier steht eine Weiche, obwohl der Rest des Lesepfads ohne auskommt** — und zwar aus
 * Kostengründen, nicht aus Korrektheitsgründen: auf zooid fände dieser Query nie eine
 * Antwort (unsere Kommentare sind kind 1111) und zöge trotzdem bei jedem Besuch der
 * Startseite bis zu 1000 Nachrichten. Ein falsches `false` (NIP-11 noch unterwegs) kostet
 * hier nichts als einen späteren Nachzieher: die Ableitung liest ohnehin reaktiv weiter,
 * und der Raum-Besuch lädt dieselben Events erneut.
 */
const loadSpaceThreadReplies = async (url: string): Promise<TrustedEvent[]> => {
    if (!(await spaceIsBuzzAsync(url))) {
        return []
    }
    const events = await load({ relays: [url], filters: [{ kinds: [MESSAGE, BUZZ_MESSAGE_V2], limit: COMMENT_LOAD_LIMIT }] })
    return events.filter(isThreadReply)
}

/**
 * Lädt bestehende kind-9735-Zap-Receipts für die übergebenen Nachrichten-IDs, damit
 * ⚡-Chips beim Öffnen/Nachladen sofort stimmen (die Live-Sub liefert nur Neues).
 * 9735 trägt KEIN `#h` (der LNURL-Server kopiert nur `p`/`e`/`bolt11`/`description`)
 * → Filter zwingend über `#e` (Message-IDs), nicht `#h`. Leere ID-Liste = kein Load.
 * ponytail: One-shot pro neuer ID; eigene Zaps landen ohnehin sofort (payZapAuto/
 * watchZapReceipt) — eine separate Live-Sub auf Fremd-Zaps wäre erst nötig, wenn
 * Echtzeit-Tally fremder Zaps ohne Feed-Reload gefordert ist.
 *
 * Gelesen wird aus Space-Relay UND öffentlichen Default-Relays — eine HEURISTIK,
 * bewusst kein exakter Gegensatz zum Schreibziel: `zaps.ts` `zapRelays` schickt das
 * Receipt an `Router.ForPubkey(empfänger)`, also dessen NIP-65-Relays (ohne Fallback,
 * `getPolicy() = addNoFallbacks`), die hier gar nicht bekannt sind. Nur das Space-Relay
 * abzufragen wäre aber sicher zu eng: Receipts eines Clients mit anderem `relays`-Tag
 * oder bei kurz weggebrochenem Space-Relay blieben dauerhaft unsichtbar. Rest-Lücke:
 * ein Receipt, das ausschließlich auf einem exotischen Empfänger-Relay liegt, sieht
 * dieser historische Load nicht — der EIGENE frische Zap dagegen schon, der lauscht in
 * `payZapAuto`/`watchZapReceipt` auf exakt dem Satz aus dem `relays`-Tag.
 */
export const loadRoomZaps = (url: string, eventIds: string[]): Promise<TrustedEvent[]> =>
    eventIds.length
        ? load({ relays: uniq([url, ...DEFAULT_RELAYS]), filters: [{ kinds: [ZAP_RESPONSE], '#e': eventIds }] })
        : Promise.resolve([])

/**
 * Lädt Room-Nachrichten vom Space-Relay: die jüngsten (initial) oder — mit
 * `until` — die nächstälteren. Gibt die geladenen Events zurück (für „hasMore").
 */
export const loadRoomMessages = (url: string, h: string, until?: number): Promise<TrustedEvent[]> =>
    load({ relays: [url], filters: roomFilter(h).map((f) => ({ ...f, limit: 50, ...(until ? { until } : {}) })) })

// ── Raumübergreifende Aktivität (P3, Ungelesen-Punkt) ────────────────────────
//
// Bis hierher gab es KEINE raumübergreifende Subscription: `watchSpaceRooms` holt nur
// Raum-Metadaten (39000/9008/39002), `listenRoom` nur den EINEN offenen Raum. Der
// Ungelesen-Punkt eines NICHT geöffneten Raums bewegte sich damit ausschließlich beim
// Kaltstart aus dem Cache — live nie. Die zwei Filter hier schließen genau diese Lücke:
// S1 holt einmal nach, S2 bleibt offen.

/**
 * Räume je REQ-Filter. Ein Nutzer ist typischerweise in wenigen Räumen (auf Prod
 * gemessen: Median 2, Maximum 9), aber ein Admin kann überall Mitglied sein — die
 * Chunkung hält den Filter auch in diesem Fall unter jeder plausiblen Relay-Grenze.
 * Alle Chunks reisen in EINEM REQ (ein Socket, eine AUTH-Challenge, ein EOSE).
 */
export const ROOM_ACTIVITY_CHUNK = 40

/**
 * Deckel des Nachhol-Loads je Chunk.
 *
 * **`limit` ist hier PFLICHT, nicht Kosmetik.** zooid deckelt fremde REQs auf 1000
 * Events — aber nur, wenn der Filter selbst ein `limit` trägt: ohne `limit` ist
 * `filter.Limit == 0`, der Vergleich gegen das Maximum greift nicht und die SQL bekommt
 * gar kein `LIMIT` (`zooid/events.go:104-106` und `:239-240`, gegengelesen am Prod-Branch
 * `feat/postgres-support`). Ein limitloser raumübergreifender Filter zöge also den
 * kompletten Bestand.
 *
 * Truncation ist dabei ein Feature, kein Verlust: liefert ein Chunk exakt `limit`
 * Events, ist mindestens ein Raum darin ungelesen — und mehr als „da ist etwas" sagt
 * ein Punkt ohnehin nicht.
 */
export const ROOM_ACTIVITY_LIMIT = 200

const chunk = <T>(items: readonly T[], size: number): T[][] => {
    const out: T[][] = []
    for (let i = 0; i < items.length; i += size) {
        out.push(items.slice(i, i + size))
    }
    return out
}

/**
 * S1 — Nachhol-Load der Aktivität in den BEIGETRETENEN Räumen (`h`-Liste aus der
 * relay-signierten 39002, nicht aus dem Raumbestand des Relays: die gegateten
 * Meetup-Räume sind für Nicht-Mitglieder serverseitig ohnehin unsichtbar).
 *
 * `since` je Chunk = das NIEDRIGSTE Wasserzeichen seiner Räume, plus 1: NIP-01-`since`
 * ist INKLUSIV, ohne die 1 käme das zuletzt Gelesene bei jedem Start erneut.
 */
export const loadRoomActivity = async (url: string, hs: string[]): Promise<TrustedEvent[]> => {
    const state = get(readState)
    const filters = chunk(hs, ROOM_ACTIVITY_CHUNK).flatMap((group) => [
        {
            kinds: [MESSAGE, BUZZ_MESSAGE_V2, POLL, ZAP_GOAL],
            '#h': group,
            since: Math.min(...group.map((h) => roomWatermark(state, url, h))) + 1,
            limit: ROOM_ACTIVITY_LIMIT,
        },
        // Tombstones derselben Räume — BEWUSST ohne `since`. Wurde eine Nachricht
        // gelöscht, während dieses Gerät geschlossen war, liegt das 9005/5 irgendwo in
        // der Historie; ein `since` am Lesestand ließe genau die Löschungen aus, die
        // dieser Client noch nie gesehen hat. Ohne sie stünde die entfernte Nachricht
        // raumübergreifend weiter in der Liste — und `/updates` druckt anders als der
        // Ungelesen-Punkt ihren VOLLEN TEXT nach. Kind 5 genügt im Repository
        // (`query` blendet Tombstone-Ziele selbst aus), 9005 braucht zusätzlich
        // {@link honorDeleteEvent} unten. `limit` ist Pflicht (zooid-Falle, siehe oben).
        { kinds: [DELETE, ROOM_DELETE_EVENT], '#h': group, limit: ROOM_ACTIVITY_LIMIT },
    ])
    if (filters.length === 0) {
        return []
    }
    const events = await load({ relays: [url], filters })
    events.forEach(honorDeleteEvent)
    return events
}

/**
 * S2 — Live-Delta derselben Räume, offen solange die App läuft.
 *
 * `limit: 0` ist hier KEIN vergessener Deckel, sondern die Live-only-Zusage: zooid
 * unterscheidet ein explizites `limit:0` (`filter.LimitZero` → gar keine gespeicherte
 * Abfrage, `zooid/events.go:100-102`) von einem FEHLENDEN Limit (voller Scan). Genau
 * dieselbe Form nutzt `listenRoom` seit jeher.
 */
export const watchRoomActivity = (url: string, hs: string[], signal: AbortSignal): void => {
    const filters = chunk(hs, ROOM_ACTIVITY_CHUNK).map((group) => ({
        // DELETE/ROOM_DELETE_EVENT gehören in denselben Live-Filter wie beim offenen Raum
        // (`listenRoom`): löscht ein Admin, während dieser Client auf `/updates` steht,
        // muss die Zeile SOFORT verschwinden — nicht erst, wenn jemand genau diesen Raum
        // öffnet. `onEvent: honorDeleteEvent` ist dabei Pflicht, nicht Zierde: kind 9005
        // ist kein NIP-09-Tombstone, das Repository entfernt sein Ziel nicht von selbst.
        kinds: [MESSAGE, POLL, ZAP_GOAL, DELETE, ROOM_DELETE_EVENT],
        '#h': group,
        limit: 0,
    }))
    if (filters.length > 0) {
        void request({ relays: [url], signal, onEvent: honorDeleteEvent, filters })
    }
}

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
        return t('Zu viele Nachrichten in kurzer Zeit — kurz warten und erneut senden.')
    }
    if (s.includes('auth')) {
        return t('Am Relay nicht angemeldet — bitte erneut senden.')
    }
    if (s.includes('restrict') || s.includes('blocked') || s.includes('not allowed') || s.includes('forbidden')) {
        return t('Nachricht vom Relay abgelehnt — du bist evtl. kein Mitglied dieses Raums.')
    }
    return raw || t('Konnte nicht gesendet werden.')
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
    const err = await waitForPublishError(thunk)
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
    // NIP-30: `["emoji", code, url]` für jeden bekannten `:shortcode:` im Text. Aus
    // `content`, nicht aus `body` — der nevent-Präfix und die Anhang-URL sind kein
    // Nutzertext (dieselbe Wahl wie bei withMentionTags).
    tags.push(...contentEmojiTags(content))
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
    waitForPublishError(
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
            // NIP-30-Tags aus dem BEARBEITETEN Text neu ableiten (nicht aus dem Original
            // übernehmen): beim Bearbeiten kann ein `:shortcode:` dazukommen oder wegfallen.
            tags: [
                ...withMentionTags([...preserved, ...roomTags(h, url)], content, url),
                ...contentEmojiTags(content),
            ],
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

/**
 * Personen-/Render-Felder eines Events (geteilt von Root + Kommentar).
 *
 * Hier stand bis 2026-08-16 ein vierter Parameter `chipPubkey`, mit dem der Aufrufer die eine
 * Mention benannte, die der Profil-Chip ersetzte. Mit dem Chip ist er entfallen — der Text
 * einer Nachricht ist jetzt an jeder Aufrufstelle derselbe, egal ob Raum-Feed, Thread-Root
 * oder Kommentar (Begründung bei {@link buildRefCard}).
 */
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
            // gebündelt, sodass fremde kind-10 anderer Wurzeln nicht durchrutschen. Buzz'
            // kind-9-Antworten kommen über denselben `#e`-Filter mit.
            deriveEventsForUrl(url, [
                { kinds: [COMMENT], '#E': [rootId] },
                { kinds: [CHAT_THREAD], '#e': [rootId] },
                ...threadReplyFilter(rootId),
            ]),
            throttled(200, profilesByPubkey),
            pubkey,
            throttled(200, handlesByNip05),
            throttled(200, deriveEventsForUrl(url, roomReactionFilter(h))),
            throttled(200, deriveEventsForUrl(url, roomZapReceiptFilter())),
            throttled(200, zappersByLnurl),
            // P5: dieselbe Zeile (`chat-row`) rendert Raum UND Thread — also trägt der Thread
            // dieselben Karten und braucht dieselben zwei Quellen. Ohne sie zeigte ein
            // Kommentar mit Zitat eine Karte, die nie auflöst.
            throttled(200, refEventStore),
            quoteCardsEnabled,
        ],
        ([rootEvents, rawComments, $profiles, $me, $handles, $reactions, $zaps, $zappers, $refEvents, $cards]) => {
            // Nur Kommentare, die WIRKLICH an diesem Root wurzeln: kind-10 kommt per `#e`
            // (matcht jedes e-Tag) → die mit rootId nur als Reply-Parent (fremder Thread)
            // fielen sonst rein. commentRootId liest den Root formatspezifisch (E bzw. e/root).
            const commentEvents = rawComments.filter((c) => commentRootId(c) === rootId)
            const refEvents = $cards ? collectRefEvents(url, commentEvents, $refEvents) : new Map<string, TrustedEvent>()
            const cardPubkeys = $cards ? refCardPubkeys(commentEvents, refEvents) : []
            // Autoren der Wurzel + aller Kommentare, dazu die Personen der Karten (P5).
            const feedPubkeys = [...rootEvents, ...commentEvents].map((e) => e.pubkey).concat(cardPubkeys)
            void warmProfiles(feedPubkeys)
            warmHandles(feedPubkeys)
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
                refEvents,
                h,
                search: window.location.search,
                cards: $cards,
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
    load({
        relays: [url],
        filters: [
            { ids: [rootId] },
            { kinds: [COMMENT], '#E': [rootId] },
            { kinds: [CHAT_THREAD], '#e': [rootId] },
            ...threadReplyFilter(rootId),
        ],
    })

/**
 * Live-Sub für NEUE Kommentare eines offenen Threads (kind-1111 `#E` + Lotus' kind-10 `#e`
 * + Buzz' kind-9-Antworten per `#e`), bis abort.
 */
export const listenThread = (url: string, rootId: string, signal: AbortSignal): void => {
    void request({
        relays: [url],
        signal,
        filters: [
            { kinds: [COMMENT], '#E': [rootId], limit: 0 },
            { kinds: [CHAT_THREAD], '#e': [rootId], limit: 0 },
            ...threadReplyFilter(rootId).map((f) => ({ ...f, limit: 0 })),
        ],
    })
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
            throttled(300, deriveEventsForUrl(url, [{ kinds: [MESSAGE, BUZZ_MESSAGE_V2, POLL, ZAP_GOAL] }])),
            throttled(300, profilesByPubkey),
        ],
        ([nip22Comments, timeline, $profiles]) => {
            // Der Timeline-Strom enthält auf Buzz BEIDE Rollen: Wurzeln und Antworten. Der
            // Schnitt läuft über den `reply`-Marker, nicht über die Relay-Art — sonst zählte
            // eine Antwort sich selbst als eigenen Thread mit 0 Antworten (Geisterzeile).
            const roots = timeline.filter(isRootMessage)
            const comments = [...nip22Comments, ...timeline.filter(isThreadReply)]
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
    const comments = [...(await loadRoomComments(url)), ...(await loadSpaceThreadReplies(url))]
    const rootIds = uniq(comments.map(commentRootId).filter((id): id is string => Boolean(id)))
    const roots = rootIds.length > 0 ? await load({ relays: [url], filters: [{ ids: rootIds }] }) : []
    // Profile der Kommentar-Autoren (Gesichter) UND der Wurzel-Autoren (Snippet-Name) vorwärmen.
    void warmProfiles([...comments.map((c) => c.pubkey), ...roots.map((r) => r.pubkey)])
}

/**
 * Kommentiert `target` (Thread-Root ODER Eltern-Kommentar). Optimistisch: der Thunk legt
 * den Kommentar sofort ins Repository (erscheint via `deriveThread`); bei Relay-Reject
 * zurückgenommen. Gibt '' bei Erfolg, sonst den Fehler.
 *
 * **Die einzige Threading-Weiche im Client — und sie ist unvermeidlich.** zooid bekommt ein
 * kind-1111 (NIP-22), Buzz eine kind-9-Raum-Nachricht mit markierten `e`-Tags. Buzz weist
 * kind 1111 hart ab (`restricted: unknown event kind`, am laufenden Relay gemessen); ohne
 * die Weiche wäre Antworten dort keine eingeschränkte Funktion, sondern eine kaputte.
 *
 * **`spaceIsBuzzAsync`, nicht die synchrone Fassung.** Die synchrone liest nur den
 * NIP-11-Cache und meldet beim ersten Rendern verlässlich `false` — die erste Antwort eines
 * frischen Tabs liefe damit immer ins falsche Format. Dieselbe Falle hat in diesem Umbau
 * schon Upload, Admin-Erkennung und Raum-Menü erwischt.
 *
 * `rootH` ist auf Buzz **Pflicht** (eine Antwort ohne `h` ist keine Raum-Nachricht). Fehlt
 * es, bleibt der NIP-22-Pfad die einzig ehrliche Antwort: er scheitert am Relay sichtbar,
 * statt ein `["h",""]` zu erfinden, das der Relay schweigend in den falschen Kanal legt.
 */
export const sendComment = async (url: string, target: TrustedEvent, content: string, attachment?: Attachment, rootH?: string): Promise<string> => {
    // NIP-30-Tags einmal ableiten und in BEIDE Zweige geben — ein Custom-Emoji darf
    // nicht davon abhängen, ob der Space zooid (kind 1111) oder Buzz (kind 9) ist.
    const emojiTags = contentEmojiTags(content)
    if (rootH && (await spaceIsBuzzAsync(url))) {
        const { rootId, parentId } = replyTargetIds(target)
        return publishOptimistic(url, makeThreadReply(rootId, parentId, rootH, url, content, attachment, emojiTags))
    }
    return publishOptimistic(url, makeComment(target, content, url, attachment, rootH, emojiTags))
}

/**
 * Nimmt die eigene Reaction zurück (kind 5 auf die eigene kind-7). Das Repository
 * blendet die referenzierte Reaction sofort aus (Chip verschwindet). Gibt '' bei
 * Erfolg, sonst den Fehler; bei Reject bleibt die Reaction bis zum Reload verdeckt
 * (das Relay hat den Tombstone nie erhalten — wie beim Nachricht-Löschen).
 */
export const removeReaction = (url: string, reaction: TrustedEvent): Promise<string> =>
    waitForPublishError(publishThunk({ relays: [url], event: makeEventDelete(reaction, url) })).then((err) =>
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
    waitForPublishError(publishThunk({ relays: [url], event: makeReport(target, reason, content) })).then((err) =>
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
    const err = await waitForPublishError(thunk)
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
