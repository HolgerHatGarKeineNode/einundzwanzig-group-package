/**
 * Emoji-Datenschicht für den Reaktions-Picker (C1). Zwei Quellen:
 *  1. Standard-Set (Unicode) aus `emojibase-data` — lazy als eigener Vite-Chunk
 *     geladen (0 KB im Initial-Bundle), gruppiert + für die Suche indiziert.
 *  2. Custom-Emoji (NIP-30) DEINES Profils: kind 10030 (User Emoji List) plus die
 *     referenzierten kind-30030-Sets → als eigener Picker-Tab.
 * Reiner Client-Layer; keine Svelte-/Alpine-Abhängigkeit.
 */
import { load } from './welshmanNet.ts'
import { app } from './welshmanApp.ts'
import { pubkey } from './welshmanSession.ts'
import type { Filter, TrustedEvent } from '@welshman/util'
import { DEFAULT_RELAYS, proxifyImage } from './core.ts'
import { emojiTagsForContent } from './emojiTags.ts'
import { buildEmojiGroups, emojibaseLocale, type CompactEmoji, type CustomEmoji, type EmojiGroup, type EmojiLocale, type EmojiMessages, type EmojiVersions } from './emojiCatalog.ts'
import { islandLocale } from './locale.ts'

/** NIP-30-Kinds: kuratierte User-Liste bzw. benanntes Emoji-Set. */
const USER_EMOJI_LIST = 10030
const EMOJI_SET = 30030

export type { CustomEmoji, EmojiGroup, StdEmoji } from './emojiCatalog.ts'
export { labelsByEmoji, searchEmojis } from './emojiCatalog.ts'

/**
 * Per-locale data files as STATIC `?url` imports — one literal per file, so Vite emits
 * one asset per locale and the browser fetches only the chosen one. (A template-string
 * import would not be analysed; `import.meta.glob` would need a relative path into
 * `node_modules`, which differs between the host and the app that link this package.)
 */
const EMOJI_DATA: Record<EmojiLocale, () => Promise<[{ default: string }, { default: string }]>> = {
    de: () => Promise.all([import('emojibase-data/de/compact.json?url'), import('emojibase-data/de/messages.json?url')]),
    en: () => Promise.all([import('emojibase-data/en/compact.json?url'), import('emojibase-data/en/messages.json?url')]),
    es: () => Promise.all([import('emojibase-data/es/compact.json?url'), import('emojibase-data/es/messages.json?url')]),
    hu: () => Promise.all([import('emojibase-data/hu/compact.json?url'), import('emojibase-data/hu/messages.json?url')]),
    nl: () => Promise.all([import('emojibase-data/nl/compact.json?url'), import('emojibase-data/nl/messages.json?url')]),
    pl: () => Promise.all([import('emojibase-data/pl/compact.json?url'), import('emojibase-data/pl/messages.json?url')]),
    pt: () => Promise.all([import('emojibase-data/pt/compact.json?url'), import('emojibase-data/pt/messages.json?url')]),
}

const groupsByLocale = new Map<EmojiLocale, Promise<EmojiGroup[]>>()

/**
 * Lädt & indiziert das Standard-Emoji-Set einmalig (memoized).
 *
 * Per language: the locale comes from `<html lang>` ({@link emojibaseLocale}), and each
 * locale is loaded and cached on its own, so only its files are fetched.
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
 * Der `?url`-Import steht DYNAMISCH hier drin und nicht statisch am Dateikopf, und
 * das ist kein Stil: Playwright sammelt seine Testdateien in **Node**, nicht im
 * Browser. Mehrere Logic-Specs importieren `feeds.ts`, das transitiv dieses Modul
 * zieht — ein Suffix-Import am Dateikopf wird dabei von Node ausgewertet und wirft
 * `Module … needs an import attribute of "type: json"`. Das riss die gesamte
 * Test-Collection mit, bevor ein einziger Test lief (`npx playwright test`, ohne
 * Pfad-Filter). Dynamisch importiert wird die Zeile nur ausgeführt, wenn jemand
 * wirklich Emojis lädt — in Node also nie. Vite behandelt beide Formen gleich.
 *
 * Die Skin-Tone-Komponenten-Gruppe (`component`) wird verworfen (keine Skin-Tones).
 *
 * The third file, `versions/emoji.json`, maps each Emoji version to its hexcodes;
 * {@link buildEmojiGroups} uses it to leave out emoji newer than the device fonts
 * draw (see `MAX_EMOJI_VERSION` there).
 */
export const loadEmojiGroups = (locale: EmojiLocale = emojibaseLocale(islandLocale())): Promise<EmojiGroup[]> => {
    let groups = groupsByLocale.get(locale)
    if (!groups) {
        groups = Promise.all([
            EMOJI_DATA[locale](),
            import('emojibase-data/versions/emoji.json?url'),
        ]).then(([[compact, messages], versions]) => Promise.all([
            fetch(compact.default).then((r) => r.json() as Promise<CompactEmoji[]>),
            fetch(messages.default).then((r) => r.json() as Promise<EmojiMessages>),
            fetch(versions.default).then((r) => r.json() as Promise<EmojiVersions>),
        ])).then(([list, messageData, versionData]) => buildEmojiGroups(list, messageData, versionData))
        groupsByLocale.set(locale, groups)
    }
    return groups
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
    app.repository.query([filter])[0]

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
 * dedupliziert per Shortcode.
 *
 * OHNE PUBKEY leer — und ohne Cache-Eintrag, denn ohne Schlüssel gibt es keinen,
 * unter dem er stehen könnte. Wer vorwärmt, muss deshalb warten, bis der Pubkey
 * steht: ein zu früher Aufruf sieht aus wie erledigt, hinterlässt aber nichts, und
 * der volle Load samt der vier DEFAULT_RELAYS unten passiert dann erst beim Öffnen
 * des Pickers. Jede dieser Verbindungen kann NIP-42-AUTH verlangen, und AUTH läuft
 * über den Signer — bei einem NIP-46-Bunker ein Roundtrip pro Relay. Der Aufrufer
 * im Raum-Init hält sich daran (s. `warmCustomEmojis` in bridge.ts).
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

