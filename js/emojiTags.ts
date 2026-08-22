/**
 * NIP-30-Tag-Ableitung für ausgehende Nachrichten — die reine Hälfte von
 * `emoji.ts`. Eigenes Modul, weil `emoji.ts` beim Import welshman (und damit
 * `localStorage`) anfasst; diese Regel ist aber genau die, die man testen will.
 *
 * **Seit dem 2026-08-22 lädt `emoji.ts` unter `node --test`** (P2 des Plans
 * `js-insel-testbar-machen`), gibt dabei aber weiterhin einen gefangenen
 * `getItem`-Fehler aus und zieht den halben App-Boot mit. Die Trennung bleibt deshalb
 * richtig — nur nicht mehr aus Gründen der Ladbarkeit.
 */

/** Alles, was zum Bauen eines `emoji`-Tags nötig ist (strukturell = `CustomEmoji`). */
export type EmojiRef = { shortcode: string; url: string }

/**
 * NIP-30-Shortcode im Fließtext. **Zeichengleich mit welshmans `parseEmoji`**
 * (`/^:(\w+):/i`) — und das ist der eigentliche Vertrag: was der Empfangs-Renderer
 * nicht als Emoji-Node erkennt, braucht auch kein Tag. `\w` deckt exakt NIP-30s
 * „alphanumeric characters and underscores" ab.
 */
const SHORTCODE = /:(\w+):/g

/**
 * Die `["emoji", shortcode, url]`-Tags (NIP-30) für einen zu sendenden Text.
 *
 * **Abgeleitet aus dem finalen Content, nicht aus einer mitgeführten Auswahlliste.**
 * Der Entwurf ist frei editierbar: ein eingefügtes `:shortcode:` kann wieder gelöscht,
 * eins von Hand getippt oder hineinkopiert werden. Eine „ich habe X eingefügt"-Liste
 * liefe damit auseinander — nach oben (Tag für ein Emoji, das nicht mehr im Text
 * steht) wie nach unten (getipptes Emoji ohne Tag, beim Empfänger nur Text).
 *
 * Nur BEKANNTE Shortcodes bekommen ein Tag: die URL steht ausschließlich in
 * `custom`, und diese Beschränkung nimmt gleichzeitig dem groben Regex-Scan die
 * Zähne (ein `:foo:` mitten in einer URL erzeugt kein Tag, solange `foo` kein
 * bekanntes Emoji ist). Dedupliziert (ein Tag je Shortcode, auch bei Mehrfach-
 * verwendung); die Tags sind frische String-Arrays, nie ein Alpine-Proxy.
 */
export const emojiTagsForContent = (content: string, custom: EmojiRef[]): string[][] => {
    if (custom.length === 0 || !content.includes(':')) {
        return []
    }
    const byShortcode = new Map(custom.map((e) => [e.shortcode, e.url]))
    const tags: string[][] = []
    const seen = new Set<string>()
    for (const [, shortcode] of content.matchAll(SHORTCODE)) {
        const url = byShortcode.get(shortcode)
        if (url && !seen.has(shortcode)) {
            seen.add(shortcode)
            tags.push(['emoji', shortcode, url])
        }
    }
    return tags
}
