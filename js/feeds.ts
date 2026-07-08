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
import { profilesByPubkey, publishThunk, waitForThunkError, pubkey, repository } from '@welshman/app'
import { parse, renderAsHtml } from '@welshman/content'
import { MESSAGE, DELETE, makeEvent, sortEventsAsc, displayProfile, getTagValue, type TrustedEvent } from '@welshman/util'
import * as nip19 from 'nostr-tools/nip19'
import { deriveEventsForUrl } from './repository'

const roomFilter = (h: string) => [{ kinds: [MESSAGE], '#h': [h] }]

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
        html = renderAsHtml(parse({ content: bodyWithoutQuote(event), tags: event.tags })).toString()
        htmlCache.set(event.id, html)
    }
    return html
}

const shortNpub = (npub: string): string => `${npub.slice(0, 12)}…${npub.slice(-6)}`

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

export type ChatMessage = {
    id: string
    pubkey: string
    created_at: number
    time: string
    fullTime: string // Datum+Uhrzeit für den Tooltip
    name: string
    picture: string
    html: string
    divider: string // Datums-Trenner, wenn der Tag wechselt (sonst '')
    unreadDivider: boolean // erste ungelesene Fremd-Nachricht (Last-Read-Grenze)
    showAuthor: boolean // erster Beitrag eines Autor-Blocks (Gruppierung)
    mine: boolean // vom eingeloggten User verfasst (→ löschbar, M5)
    reply: ReplyPreview | null // zitierte Nachricht (q-Tag), sonst null
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
    derived([deriveRoomMessages(url, h), profilesByPubkey, pubkey], ([events, $profiles, $me]) => {
        const nameOf = (pk: string) => displayProfile($profiles.get(pk), shortNpub(nip19.npubEncode(pk)))
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
                picture: profile?.picture ?? '',
                html: renderMessageHtml(event),
                divider,
                unreadDivider,
                showAuthor,
                mine,
                reply,
            }
        })
    })

/** Öffnet eine Live-Subscription für NEUE Room-Nachrichten (bleibt bis abort offen). */
export const listenRoom = (url: string, h: string, signal: AbortSignal): void => {
    void request({ relays: [url], signal, filters: roomFilter(h).map((f) => ({ ...f, limit: 0 })) })
}

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
    const tags: string[][] = [['h', h]]
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
                tags: [['k', String(MESSAGE)], ['e', id], ['h', h]],
            }),
        }),
    )
