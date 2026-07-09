/**
 * Room-Chat-Feed (M4, read-only) — inspiriert von `makeFeed` des Referenz-Clients,
 * aber schlank für die Alpine-Insel: statt bidirektionalem Sliding-Window-Scroller
 * eine Live-Subscription (`limit:0`) + Cursor-Pagination (`until`) über die
 * ohnehin reaktive `deriveEventsForUrl`-Ableitung. Senden kommt mit M5.
 *
 * NIP-29: Room-Nachrichten sind **kind 9** (`MESSAGE`) mit `#h`=Room-ID, auf dem
 * Space-Relay. AUTH (NIP-42) läuft automatisch über die Socket-Policy.
 */
import { derived, type Readable } from 'svelte/store'
import { load, request } from '@welshman/net'
import { profilesByPubkey, publishThunk, waitForThunkError, pubkey, repository, displayProfileByPubkey, handlesByNip05 } from '@welshman/app'
import { parse, renderAsHtml, ParsedType } from '@welshman/content'
import { sanitizeUrl } from '@braintree/sanitize-url'
import { MESSAGE, DELETE, REACTION, makeEvent, sortEventsAsc, getTag, getTagValue, type TrustedEvent } from '@welshman/util'
import { groupBy, uniqBy } from '@welshman/lib'
import * as nip19 from 'nostr-tools/nip19'
import { deriveEventsForUrl } from './repository'
import { roomTags, makeReaction, makeEventDelete } from './interactions'
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

/** kind-7-Reactions eines Raums (NIP-25) — tragen `#h` vom Parent (via makeReaction). */
const roomReactionFilter = (h: string) => [{ kinds: [REACTION], '#h': [h] }]

/** Vorangestelltes `nostr:nevent…`/`note…` einer Reply (unser Quote-Prefix). */
const QUOTE_PREFIX = /^nostr:(?:nevent1|note1)[0-9a-z]+\n\n/

/** Aufsteigend sortierter Chat-Verlauf eines Rooms (reaktiv aus dem Repository). */
const deriveRoomMessages = (url: string, h: string): Readable<TrustedEvent[]> =>
    derived(deriveEventsForUrl(url, roomFilter(h)), (events) => sortEventsAsc(events))

/** Rohtext einer Nachricht ohne den vorangestellten Reply-Quote (für Snippets). */
const bodyWithoutQuote = (event: TrustedEvent): string =>
    getTagValue('q', event.tags) ? event.content.replace(QUOTE_PREFIX, '') : event.content

/**
 * Rendert den Nachrichtentext zu sicherer HTML (Text escaped, URLs sanitized).
 * Bei Replies wird das vorangestellte `nostr:nevent…` entfernt (trimParent) —
 * das Zitat zeigt stattdessen die kompakte Vorschau (siehe `deriveRoomChat`).
 */
const htmlCache = new Map<string, string>()
const renderMessageHtml = (event: TrustedEvent): string => {
    let html = htmlCache.get(event.id)
    if (html === undefined) {
        // welshman rendert Custom-Emoji (NIP-30) per Default als Text-Shortcode
        // (`renderEmoji` ist NICHT als Option überschreibbar) — darum Emoji-Nodes
        // mit https-URL selbst zu Inline-<img> rendern, alle anderen Nodes an
        // welshman geben (Text-Escaping, Links über den Proxy, Newlines).
        html = parse({ content: bodyWithoutQuote(event), tags: event.tags })
            .map((node) => {
                if (node.type === ParsedType.Emoji) {
                    const img = renderEmojiImg(node.value.name, node.value.url)
                    if (img !== null) {
                        return img
                    }
                }
                return renderAsHtml([node], { renderLink: renderMessageLink }).toString()
            })
            .join('')
        htmlCache.set(event.id, html)
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
const aggregateReactions = (reactions: TrustedEvent[], me: string | null | undefined): ReactionChip[] => {
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
        }
    })
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
        [deriveRoomMessages(url, h), profilesByPubkey, pubkey, handlesByNip05, deriveEventsForUrl(url, roomReactionFilter(h))],
        ([events, $profiles, $me, $handles, $reactions]) => {
        // Reactions nach Ziel-Nachricht (`#e`) bündeln — je Nachricht einmal aggregiert.
        // Reactions ohne `e`-Tag landen im ''-Bucket und werden nie abgerufen (event.id ≠ '').
        const reactionsByTarget = groupBy((r) => getTagValue('e', r.tags) ?? '', $reactions)
        // First-Paint-Seed: fehlende Autor-Profile vom geteilten Backend-Cache holen
        // (dedupliziert intern; welshman löst parallel live auf). Fire-and-forget.
        void warmProfiles(events.map((e) => e.pubkey))
        // NIP-05-Handles der Autoren lazy verifizieren (dedupliziert, fire-and-forget).
        warmHandles(events.map((e) => e.pubkey))
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
                reactions: aggregateReactions(reactionsByTarget.get(event.id) ?? [], $me),
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
    void request({ relays: [url], signal, filters: [{ kinds: [MESSAGE, REACTION, DELETE], '#h': [h], limit: 0 }] })
}

/**
 * Lädt die bestehenden Reactions (kind 7) + Tombstones (kind 5) eines Raums, damit
 * bereits vorhandene Reaction-Chips beim ersten Öffnen sichtbar sind (die Live-Sub
 * liefert nur NEUE Events). Kein `until`-Paging — Reactions sind pro Raum überschaubar.
 */
export const loadRoomReactions = (url: string, h: string): Promise<TrustedEvent[]> =>
    load({ relays: [url], filters: [{ kinds: [REACTION, DELETE], '#h': [h] }] })

/**
 * Lädt Room-Nachrichten vom Space-Relay: die jüngsten (initial) oder — mit
 * `until` — die nächstälteren. Gibt die geladenen Events zurück (für „hasMore").
 */
export const loadRoomMessages = (url: string, h: string, until?: number): Promise<TrustedEvent[]> =>
    load({ relays: [url], filters: roomFilter(h).map((f) => ({ ...f, limit: 50, ...(until ? { until } : {}) })) })

// ── Schreiben (M5) ───────────────────────────────────────────────────────────

/** Ziel einer Antwort: die zitierte Nachricht (id + Autor). */
export type ReplyTarget = { id: string; pubkey: string }

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
