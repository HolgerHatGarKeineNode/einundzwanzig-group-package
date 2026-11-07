/**
 * The standard emoji catalogue for the picker — the pure half of `emoji.ts`, kept apart
 * because `emoji.ts` touches welshman (and `localStorage`) on import, while this is the
 * part worth testing against the real emojibase files under `node --test`.
 */

/** Ein wählbares Standard-Emoji: `u` = Unicode-Zeichen, `label`+`tags` = Suchindex (deutsch). */
export type StdEmoji = { u: string; label: string; tags: string[] }

/** Eine Kategorie des Standard-Sets (emojibase-Gruppe), ohne die Skin-Tone-Komponenten. */
export type EmojiGroup = { key: string; name: string; icon: string; emojis: StdEmoji[] }

/**
 * Ein Custom-Emoji (NIP-30): `url` bleibt roh fürs Reaction-Event (`["emoji",…]`),
 * `src` ist die proxifizierte https-Bild-URL für die Anzeige im Picker.
 */
export type CustomEmoji = { shortcode: string; url: string; src: string }

/**
 * emojibase locales the picker ships, one per app language that emojibase has
 * (`config('group.locales')`: de, en, es, hu, lv, nl, pl, pt — emojibase has no `lv`).
 */
export const EMOJI_LOCALES = ['de', 'en', 'es', 'hu', 'nl', 'pl', 'pt'] as const
export type EmojiLocale = (typeof EMOJI_LOCALES)[number]

/**
 * The emojibase locale for a page language (`<html lang>`): its primary subtag if
 * emojibase has it, otherwise English. Region forms collapse to the language
 * (`pt-BR` → `pt`, `en-GB` → `en`): the app's languages carry no region, and
 * emojibase's `en-gb` would differ only in a handful of British spellings.
 */
export const emojibaseLocale = (lang: string): EmojiLocale => {
    const primary = lang.trim().toLowerCase().split(/[-_]/)[0] ?? ''
    return (EMOJI_LOCALES as readonly string[]).includes(primary) ? (primary as EmojiLocale) : 'en'
}

/** One entry of `emojibase-data/<locale>/compact.json` (the fields used here). */
export type CompactEmoji = { group?: number; order: number; label: string; unicode: string; hexcode: string; tags?: string[] }
/** `emojibase-data/<locale>/messages.json` (the fields used here). */
export type EmojiMessages = { groups: { key: string; message: string; order: number }[] }
/** `emojibase-data/versions/emoji.json`: Emoji version ("15.1") → hexcodes introduced in it. */
export type EmojiVersions = Record<string, string[]>

/**
 * Newest Emoji version the picker offers. An emoji the device font has no glyph for
 * renders as an empty box ("tofu") in the grid and in search results — measured on the
 * release APK on an Android 16 emulator: 🫫 U+1FAEB (Emoji 18 per emojibase) at
 * smileys position 12. emojibase-data 18 brought 17 such entries into `de/compact.json`.
 * Raise this when the system fonts of the devices we ship to catch up.
 */
export const MAX_EMOJI_VERSION = 16

/** Hexcodes of every emoji newer than `maxVersion`, from emojibase's own version table. */
export const hexcodesNewerThan = (versions: EmojiVersions, maxVersion: number): Set<string> => {
    const newer = new Set<string>()
    for (const [version, hexcodes] of Object.entries(versions)) {
        if (Number(version) > maxVersion) {
            for (const hexcode of hexcodes) {
                newer.add(hexcode)
            }
        }
    }
    return newer
}

/**
 * The picker groups: emojibase groups in their order, without the skin-tone components
 * group and without emoji newer than {@link MAX_EMOJI_VERSION}. The search runs over
 * these groups, so it inherits the filter.
 *
 * Tags are lowercased because {@link searchEmojis} compares them against a lowercased
 * query (plain `toLowerCase` on both sides; locale-specific casing only differs for
 * Turkish, Azerbaijani and Lithuanian, none of which the picker ships). Since emojibase-data 18 keywords keep their CLDR casing (German nouns: "Liebe",
 * "Herz") — 6650 capitalised tags in `de/compact.json` instead of 259 in v17 — and
 * without this step those tags would no longer match.
 */
/**
 * emojibase ships some category names lowercase ("smileys & emotion" in en and pt), while
 * de, es, nl … start with a capital. The tabs show the name as tooltip and accessible name,
 * so the first letter is raised for every locale alike.
 */
export const capitalizeFirst = (text: string): string =>
    text.length === 0 ? text : text.charAt(0).toLocaleUpperCase() + text.slice(1)

export const buildEmojiGroups = (
    list: CompactEmoji[],
    messages: EmojiMessages,
    versions: EmojiVersions,
    maxVersion = MAX_EMOJI_VERSION,
): EmojiGroup[] => {
    const tooNew = hexcodesNewerThan(versions, maxVersion)
    return messages.groups
        .filter((g) => g.key !== 'component')
        .sort((a, b) => a.order - b.order)
        .map((g) => {
            const emojis = list
                .filter((e) => e.group === g.order && Boolean(e.unicode) && !tooNew.has(e.hexcode))
                .sort((a, b) => a.order - b.order)
                .map((e) => ({ u: e.unicode, label: e.label, tags: (e.tags ?? []).map((t) => t.toLowerCase()) }))
            return { key: g.key, name: capitalizeFirst(g.message), icon: emojis[0]?.u ?? '·', emojis }
        })
        .filter((g) => g.emojis.length > 0)
}

/**
 * The current label of every offered emoji, keyed by the emoji itself. The recent-emoji
 * list (MRU) is keyed by the emoji character, not by a label, so it survives a language
 * switch; its stored label is replaced by the current language's one with this.
 */
export const labelsByEmoji = (groups: EmojiGroup[]): Map<string, string> =>
    new Map(groups.flatMap((g) => g.emojis.map((e) => [e.u, e.label] as const)))

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
