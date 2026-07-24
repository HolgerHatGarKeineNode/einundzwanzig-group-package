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

/**
 * Ist das ein Link-Token, das wir als echten Link rendern wollen?
 *
 * **Warum diese Funktion existiert:** welshmans `parseLink` linkt jedes `wort.wort`
 * (parser.js Regex #2 „without a protocol") und setzt `https://` davor. Das macht
 * aus Code-Snippets (`Alpine.store`, `readState.ts`, `$store.unread`) URLs. Wir
 * filtern post-parse: nur was hier `true` liefert, wird zu einem Anker, alles andere
 * fällt auf Plaintext zurück.
 *
 * **Strikte Policy:** ausschließlich `http://` und `https://`. Kein TLD-Raten,
 * keine Whitelist, keine Heuristik für nackte `domain.tld`. Wer eine Adresse
 * meint, schreibt das Schema davor — damit endet jede Diskussion, ob `fountain.fm`
 * noch eine Domain ist oder `.fm` eine Code-Endung.
 *
 * Rein, ohne welshman-Importe, unter `node --test` lauffähig. Die Diagnose „hat der
 * Parser da eine echte URL erkannt?" muss ohne Browser-Stubs beantwortbar bleiben.
 *
 * @param raw `raw`-Feld der geparsten Node (der Original-String, NICHT das
 *   URL-Objekt — welshman hat Schema-less bereits `https://` vorgesetzt)
 */
export const isPlausibleUrl = (raw: string): boolean =>
    typeof raw === 'string' && /^https?:\/\//i.test(raw)
