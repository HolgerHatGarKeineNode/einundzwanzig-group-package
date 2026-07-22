/**
 * Anzeige von Links im Nachrichtentext. Bewusst OHNE welshman-Importe, damit die
 * Logik rein (ohne Browser-/Store-Runtime) testbar bleibt — wie `relayCaps.ts`.
 */

/**
 * Anzeigetext eines Links — die VOLLSTÄNDIGE URL, nichts abgeschnitten.
 *
 * welshmans eigener `renderLink` zeigt nur `host + pathname` und schneidet damit
 * Schema, Query und Fragment ab: aus `https://fountain.fm/episode/abc?t=1234` wird
 * `fountain.fm/episode/abc`. Wer auf einen Link tippt, muss aber sehen, wohin er
 * geht — ein verschluckter `?t=`-Parameter ist ein anderes Ziel als das angezeigte,
 * und ohne Schema ist `http` nicht von `https` zu unterscheiden.
 *
 * Deshalb hier aus der echten URL neu zusammengesetzt: Schema, Host, Pfad, Query,
 * Fragment. Zwei Feinheiten bleiben:
 * - Ein nacktes `/` als ganzer Pfad entfällt (welshman-Verhalten, `example.com` statt
 *   `example.com/`).
 * - `//` nur bei Schemas MIT Host — `mailto:jemand@example.com` bekommt keins.
 *
 * Nicht parsebare URLs behalten welshmans `fallback` — nie eine leere Linkbeschriftung.
 */
export const linkDisplay = (href: string, fallback: string): string => {
    let url: URL
    try {
        url = new URL(href)
    } catch {
        return fallback
    }
    const authority = url.host ? '//' + url.host : ''
    const display = url.protocol + authority + url.pathname.replace(/^\/$/, '') + url.search + url.hash
    return display || fallback
}
