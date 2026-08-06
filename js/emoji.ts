/**
 * Emoji-Datenschicht für den Reaktions-Picker (C1). Zwei Quellen:
 *  1. Standard-Set (Unicode) aus `emojibase-data` — lazy als eigener Vite-Chunk
 *     geladen (0 KB im Initial-Bundle), gruppiert + für die Suche indiziert.
 *  2. Custom-Emoji (NIP-30) DEINES Profils: kind 10030 (User Emoji List) plus die
 *     referenzierten kind-30030-Sets → als eigener Picker-Tab.
 * Reiner Client-Layer; keine Svelte-/Alpine-Abhängigkeit.
 */
import { load } from '@welshman/net'
import { repository, pubkey } from '@welshman/app'
import type { Filter, TrustedEvent } from '@welshman/util'
import { DEFAULT_RELAYS, proxifyImage } from './core'
import { emojiTagsForContent } from './emojiTags'
// `?url`: Vite gibt nur den Pfad zurück und kopiert die Datei unverändert ins Build,
// statt sie in ein JS-Modul zu verwandeln. Begründung an `loadEmojiGroups()`.
import compactUrl from 'emojibase-data/de/compact.json?url'
import messagesUrl from 'emojibase-data/de/messages.json?url'

/** NIP-30-Kinds: kuratierte User-Liste bzw. benanntes Emoji-Set. */
const USER_EMOJI_LIST = 10030
const EMOJI_SET = 30030

/** Ein wählbares Standard-Emoji: `u` = Unicode-Zeichen, `label`+`tags` = Suchindex (deutsch). */
export type StdEmoji = { u: string; label: string; tags: string[] }

/** Eine Kategorie des Standard-Sets (emojibase-Gruppe), ohne die Skin-Tone-Komponenten. */
export type EmojiGroup = { key: string; name: string; icon: string; emojis: StdEmoji[] }

/**
 * Ein Custom-Emoji (NIP-30): `url` bleibt roh fürs Reaction-Event (`["emoji",…]`),
 * `src` ist die proxifizierte https-Bild-URL für die Anzeige im Picker.
 */
export type CustomEmoji = { shortcode: string; url: string; src: string }

type CompactEmoji = { group?: number; order: number; label: string; unicode: string; tags?: string[] }
type EmojiMessages = { groups: { key: string; message: string; order: number }[] }

let groupsPromise: Promise<EmojiGroup[]> | null = null

/**
 * Lädt & indiziert das Standard-Emoji-Set einmalig (memoized).
 *
 * `?url` + `fetch` statt eines direkten JSON-Imports, und das ist der Unterschied
 * zwischen „geht auf" und „lädt gefühlt drei Sekunden". Ein `import(…json)` schiebt
 * die Datei durch Vites Modul-Transformation: aus 600 kB JSON wird ein ES-Modul mit
 * JS-Objektliteral. Im Dev-Server gemessen **4,2 MB**, die der Browser als
 * JavaScript parsen muss — siebenmal die Nutzlast, und JS-Parsing ist pro Byte
 * teurer als `JSON.parse`. Im Produktions-Build fällt der Aufwand kleiner aus
 * (89 kB gzip), bleibt aber ein JS-Literal.
 *
 * Mit `?url` liefert Vite nur den Pfad und kopiert die Datei unangetastet ins
 * Build. Der Dev-Server reicht sie statisch durch, `fetch` + `.json()` nutzt den
 * nativen Parser. Die Datei bleibt ein eigener, lazy geladener Brocken — sie liegt
 * jetzt nur in `assets/` statt in einem JS-Chunk.
 *
 * Die Skin-Tone-Komponenten-Gruppe (`component`) wird verworfen (keine Skin-Tones).
 */
export const loadEmojiGroups = (): Promise<EmojiGroup[]> => {
    if (!groupsPromise) {
        groupsPromise = Promise.all([
            fetch(compactUrl).then((r) => r.json() as Promise<CompactEmoji[]>),
            fetch(messagesUrl).then((r) => r.json() as Promise<EmojiMessages>),
        ]).then(([list, groups]) => {
            return groups.groups
                .filter((g) => g.key !== 'component')
                .sort((a, b) => a.order - b.order)
                .map((g) => {
                    const emojis = list
                        .filter((e) => e.group === g.order && Boolean(e.unicode))
                        .sort((a, b) => a.order - b.order)
                        .map((e) => ({ u: e.unicode, label: e.label, tags: e.tags ?? [] }))
                    return { key: g.key, name: g.message, icon: emojis[0]?.u ?? '·', emojis }
                })
                .filter((g) => g.emojis.length > 0)
        })
    }
    return groupsPromise
}

/**
 * Zuletzt benutztes Emoji (MRU): Standard (nur `u`) oder Custom (shortcode + rohe
 * `url` fürs Re-Reagieren + proxifizierte `src` fürs Bild). In `localStorage`
 * gehalten — reiner Client-Komfort, keine Nostr-Persistenz nötig.
 */
export type RecentEmoji =
    | { u: string; label: string; custom?: false }
    | { shortcode: string; url: string; src: string; custom: true }

const RECENT_KEY = 'e21:recent-emoji'
const RECENT_MAX = 24

const recentKey = (e: RecentEmoji): string => (e.custom ? `:${e.shortcode}:` : e.u)

/** Die MRU-Liste (neueste zuerst); leer, wenn noch nichts benutzt oder kein Storage. */
export const loadRecentEmojis = (): RecentEmoji[] => {
    try {
        const raw = localStorage.getItem(RECENT_KEY)
        const parsed = raw ? (JSON.parse(raw) as unknown) : []
        return Array.isArray(parsed) ? (parsed as RecentEmoji[]) : []
    } catch {
        return []
    }
}

/** Ein benutztes Emoji nach vorn schieben (dedupe, gedeckelt), Liste zurückgeben. */
export const pushRecentEmoji = (emoji: RecentEmoji): RecentEmoji[] => {
    const key = recentKey(emoji)
    const next = [emoji, ...loadRecentEmojis().filter((e) => recentKey(e) !== key)].slice(0, RECENT_MAX)
    try {
        localStorage.setItem(RECENT_KEY, JSON.stringify(next))
    } catch {
        // Kein Storage (Privatmodus) → MRU bleibt für diese Sitzung ephemer.
    }
    return next
}

/** `["emoji", shortcode, url]`-Tags → Custom-Emoji-Liste (nur sichere https-Bilder). */
const emojisFromTags = (tags: string[][]): CustomEmoji[] =>
    tags
        .filter((t) => t[0] === 'emoji' && t[1] && t[2] && /^https:\/\//i.test(t[2]))
        .map((t) => ({ shortcode: t[1], url: t[2], src: proxifyImage(t[2], 'avatar') }))

const firstEvent = (filter: Filter): TrustedEvent | undefined =>
    repository.query([filter])[0]

const customEmojiCache = new Map<string, Promise<CustomEmoji[]>>()

/**
 * Letzter FERTIG geladener Custom-Emoji-Satz + der Pubkey, für den er gilt. Das
 * ist der synchrone Schnappschuss, den der Sendepfad liest (siehe
 * {@link knownCustomEmojis}) — bewusst neben dem Promise-Cache, nicht statt seiner.
 */
let loadedFor = ''
let loadedEmojis: CustomEmoji[] = []

/**
 * Lädt „alle Custom-Emojis, die dein Nostr-Profil nutzt" (NIP-30): die eigene
 * kind-10030-Liste plus die per `["a", "30030:…"]` referenzierten Sets. Ergebnis
 * ist pro Pubkey memoized (der Picker öffnet oft, die Liste ändert sich selten);
 * dedupliziert per Shortcode. Ohne eingeloggten Pubkey leer.
 */
export const loadUserCustomEmojis = (pk = pubkey.get()): Promise<CustomEmoji[]> => {
    if (!pk) {
        return Promise.resolve([])
    }
    const cached = customEmojiCache.get(pk)
    if (cached) {
        return cached
    }
    const promise = (async () => {
        await load({ filters: [{ kinds: [USER_EMOJI_LIST], authors: [pk] }], relays: DEFAULT_RELAYS })
        const list = firstEvent({ kinds: [USER_EMOJI_LIST], authors: [pk] })
        if (!list) {
            return []
        }
        const collected = emojisFromTags(list.tags)
        const addrs = list.tags
            .filter((t) => t[0] === 'a' && t[1]?.startsWith(`${EMOJI_SET}:`))
            .map((t) => t[1].split(':'))
            .filter((parts) => parts.length >= 3)
        if (addrs.length > 0) {
            await load({
                filters: addrs.map(([, author, d]) => ({ kinds: [EMOJI_SET], authors: [author], '#d': [d] })),
                relays: DEFAULT_RELAYS,
            })
            for (const [, author, d] of addrs) {
                const set = firstEvent({ kinds: [EMOJI_SET], authors: [author], '#d': [d] })
                if (set) {
                    collected.push(...emojisFromTags(set.tags))
                }
            }
        }
        const seen = new Set<string>()
        const unique = collected.filter((e) => (seen.has(e.shortcode) ? false : seen.add(e.shortcode)))
        // Synchronen Schnappschuss mitziehen (siehe knownCustomEmojis).
        loadedFor = pk
        loadedEmojis = unique
        return unique
    })()
    customEmojiCache.set(pk, promise)
    return promise
}

/**
 * Synchroner Schnappschuss der bekannten Custom-Emojis des angemeldeten Nutzers —
 * leer, solange {@link loadUserCustomEmojis} noch läuft oder der Pubkey wechselte.
 *
 * **Warum synchron und nicht `await loadUserCustomEmojis()`:** der Sendepfad darf
 * nie auf einen Relay-Load warten. Derselbe Load hängt am member-only-Space
 * bekanntermaßen (deshalb wird er beim Raum-Init vorgewärmt und im Picker bewusst
 * entkoppelt geladen) — ein `await` hier hieße: eine Nachricht mit `:shortcode:`
 * geht gar nicht raus, bis das Relay antwortet. Die harmlose Ausfallrichtung ist
 * „Nachricht geht raus, das Emoji bleibt für Empfänger Text".
 */
export const knownCustomEmojis = (pk = pubkey.get()): CustomEmoji[] =>
    pk && pk === loadedFor ? loadedEmojis : []

/**
 * Die NIP-30-Tags eines zu sendenden Textes, gegen den Schnappschuss der eigenen
 * Custom-Emojis. Die Regel selbst steht pur (und damit testbar) in `emojiTags.ts`;
 * hier kommt nur die Datenquelle dazu.
 */
export const contentEmojiTags = (content: string): string[][] =>
    emojiTagsForContent(content, knownCustomEmojis())

/**
 * Flache Volltext-Suche über Standard- + Custom-Emojis (Label, Keywords, Shortcode).
 * Begrenzt auf `limit` Treffer — das Grid soll nicht tausende Knoten rendern.
 */
export const searchEmojis = (
    query: string,
    groups: EmojiGroup[],
    custom: CustomEmoji[],
    limit = 90,
): (StdEmoji | (CustomEmoji & { custom: true }))[] => {
    const q = query.trim().toLowerCase()
    if (!q) {
        return []
    }
    const hits: (StdEmoji | (CustomEmoji & { custom: true }))[] = []
    for (const e of custom) {
        if (e.shortcode.toLowerCase().includes(q)) {
            hits.push({ ...e, custom: true })
        }
    }
    for (const g of groups) {
        for (const e of g.emojis) {
            if (e.label.toLowerCase().includes(q) || e.tags.some((t) => t.includes(q))) {
                hits.push(e)
                if (hits.length >= limit) {
                    return hits
                }
            }
        }
    }
    return hits.slice(0, limit)
}
