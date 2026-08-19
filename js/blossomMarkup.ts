/**
 * **Der Marker, mit dem in JS gebautes Markup den Blossom-Weg anmeldet.**
 *
 * Avatare und Banner stehen in Blade und bekommen ihren Ladezustand über Alpine
 * (`x-effect="$blossomBind($data, …)"`, siehe [[blossomMedia]]). Chat-Anhänge
 * (`feeds.ts`), Custom-Emoji (`feeds.ts`) und Artikelbilder (`longform.ts`) entstehen
 * dagegen als HTML-**String** in JavaScript — dort gibt es kein `x-effect`, an das
 * sich ein Zustand hängen ließe, und der String wird obendrein gecacht und mehrfach
 * eingesetzt (`htmlCache`). Eine Zustandsbindung pro Bild wäre hier also nicht nur
 * unmöglich, sie wäre auch falsch.
 *
 * Stattdessen zweistufig: das Markup trägt die geschützte URL in einem
 * **Daten-Attribut** und **kein `src`** — die Fläche stellt damit keine Anfrage. Ein
 * einzelner Beobachter am Dokument ([[blossomHydrate]]) holt sie danach über den
 * Blossom-Loader und setzt das `src` auf die fertige `blob:`-URL nach.
 *
 * ── Woran erkannt wird, dass eine URL den Weg braucht ──
 *
 * **Am leeren Rückgabewert von `proxifyImage`.** Genau dafür gibt die Wache
 * (`mediaGuard.ts`) `''` zurück: „diese URL darf weder an den Server-Proxy noch roh
 * ins `<img>`". Die Renderer müssen die Regel damit nicht kennen und nicht
 * nachbauen — sie fragen die Wache, die sie ohnehin schon fragen, und lesen ihre
 * Antwort einen Schritt genauer. Ein zweiter Ort, an dem „gehört dem Workspace"
 * entschieden wird, entstünde sonst genau dort, wo er beim nächsten Mal vergessen wird.
 *
 * **Der Marker ist keine Erlaubnis.** Was im Attribut steht, ist Fremdtext aus einem
 * Event; geladen wird es erst, wenn der Loader die URL erneut als Workspace-Medium
 * erkennt (`isProtected`). Ein präpariertes `data-blossom-src` auf einen fremden Host
 * führt deshalb zu nichts — nicht einmal zu einer Anfrage.
 */

/** Trägt die geschützte Original-URL, solange kein `src` gesetzt werden darf. */
export const BLOSSOM_SRC_ATTR = 'data-blossom-src'

/**
 * Der Bearbeitungsstand EINES Bildes. Er ist zugleich die Sperre gegen Doppelarbeit:
 * der Hydrator greift nur `img[data-blossom-src]:not([data-blossom-state])`.
 *
 * `pending` = wird geholt · `ready` = `blob:` steht im `src` · `none` = für diesen
 * Nutzer nicht verfügbar (kein Signer, kein Mitglied, 401/403). `none` ist ein
 * Endzustand, kein Fehler — und ausdrücklich kein Anlass für einen zweiten Versuch.
 */
export const BLOSSOM_STATE_ATTR = 'data-blossom-state'

export type BlossomState = 'pending' | 'ready' | 'none'

/**
 * Die URL, die ins Marker-Attribut gehört — oder `''`, wenn nichts zu markieren ist.
 *
 * @param url Die Original-URL aus dem Event.
 * @param proxified Was `proxifyImage(url, …)` daraus gemacht hat.
 */
export const blossomMarkerFor = (url: unknown, proxified: string): string =>
    typeof url === 'string' && url !== '' && proxified === '' ? url : ''

/**
 * Ein Chat-Bild als HTML-Schnipsel — der einzige Ort, an dem dieses Markup entsteht.
 *
 * Steht hier und nicht mehr in `feeds.ts`, damit die Zusage „für ein geschütztes Bild
 * entsteht KEIN `src`" an echtem Markup prüfbar ist: `feeds.ts` zieht den halben
 * welshman-Baum und ist im Browser eines Tests nicht ausführbar, dieses Modul hat
 * keine einzige Abhängigkeit.
 *
 * `document` kommt als Parameter herein (statt aus dem globalen Namensraum), damit das
 * Modul auch dort ladbar bleibt, wo es kein Dokument gibt. Gebaut wird über
 * `createElement`, weil `outerHTML` Attribute und Text dabei selbst escapt — eine
 * URL mit `"` kann das Markup so nicht aufbrechen.
 *
 * @param msgSrc `proxifyImage(href, 'msg')` — Anzeigegröße.
 * @param fullSrc `proxifyImage(href, 'full')` — Lightbox (`data-full`).
 */
export const chatImageHtml = (doc: Document, href: string, msgSrc: string, fullSrc: string): string => {
    const box = doc.createElement('span')
    box.className = 'chat-image-box'
    const img = doc.createElement('img')
    img.className = 'chat-image'
    img.loading = 'lazy'
    img.alt = ''
    const marker = blossomMarkerFor(href, msgSrc)
    if (marker === '') {
        img.src = msgSrc
        img.dataset.full = fullSrc
    } else {
        img.setAttribute(BLOSSOM_SRC_ATTR, marker)
        // Leeres `data-full` als PLATZ, nicht als Wert: der Hydrator füllt es mit
        // derselben `blob:`-URL. Blossom kennt keine Presets — der Blob IST das
        // Original, die Lightbox zeigt also genau dieselben Bytes.
        img.dataset.full = ''
    }
    box.appendChild(img)

    return box.outerHTML
}

/**
 * Ein Custom-Emoji (NIP-30) als Inline-Bild. Gleiche Zweiteilung wie oben; ein Emoji
 * vom Workspace-Relay ist genauso auth-pflichtig wie ein Avatar.
 */
export const emojiImgHtml = (doc: Document, url: string, src: string, name: string): string => {
    const img = doc.createElement('img')
    img.className = 'chat-emoji'
    img.loading = 'lazy'
    img.alt = img.title = `:${name}:`
    const marker = blossomMarkerFor(url, src)
    if (marker === '') {
        img.src = src
    } else {
        img.setAttribute(BLOSSOM_SRC_ATTR, marker)
    }

    return img.outerHTML
}
