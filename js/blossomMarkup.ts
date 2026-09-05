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
 * Which attribute the hydrator fills once the blob is there. Absent means `src`, which
 * is what every image and every video wants.
 *
 * It exists for exactly one shape: the file card is an `<a>`, and its address lives in
 * `href`. Giving the anchor an `src` would be a dead attribute; giving the hydrator a
 * second selector would be a second place to forget.
 */
export const BLOSSOM_TARGET_ATTR = 'data-blossom-attr'

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
 * A chat video as an HTML snippet — same two-step construction as {@link chatImageHtml}.
 *
 * `preload="metadata"` and no `autoplay`: the element must not pull the whole file into
 * a reader's connection before anyone asked for it. For a workspace blob there is
 * nothing to preload anyway until the hydrator has fetched it — the marker branch emits
 * no `src` at all, so the player shows its controls over an empty frame and stays inert.
 *
 * `playsinline` is not decoration on mobile Safari: without it a tap hands the video to
 * the full-screen player and takes the reader out of the conversation.
 *
 * **The unprotected branch uses the RAW url, not `proxyVerdict`.** The proxy behind
 * `proxifyImage` is an IMAGE proxy (`/img/{preset}?src=…`) — a video routed through it
 * would come back re-encoded or not at all. Its return value is read here for one thing
 * only, the same thing {@link blossomMarkerFor} reads it for: `''` means "this belongs
 * to the workspace relay, do not put it in a `src`".
 *
 * @param proxyVerdict `proxifyImage(href, …)` — used as a verdict, never as an address.
 */
export const chatVideoHtml = (doc: Document, href: string, proxyVerdict: string): string => {
    const box = doc.createElement('span')
    box.className = 'chat-video-box'
    const video = doc.createElement('video')
    video.className = 'chat-video'
    video.controls = true
    video.preload = 'metadata'
    video.setAttribute('playsinline', '')
    const marker = blossomMarkerFor(href, proxyVerdict)
    if (marker === '') {
        video.src = href
    } else {
        video.setAttribute(BLOSSOM_SRC_ATTR, marker)
    }
    box.appendChild(video)

    return box.outerHTML
}

/**
 * A generic attachment as a download card: name on top, type and size underneath.
 *
 * **The card is an `<a>` and not a button with a handler**, so the browser's own
 * "open in new tab", "copy address" and "save as" keep working, and so the reader can
 * see where it goes before clicking.
 *
 * **The marker branch leaves the anchor without `href` on purpose.** An `<a>` without
 * an address is not focusable and not activatable — which is the correct state while
 * the blob has not been fetched yet, and the truthful one if the reader is not a member
 * and it never will be. The hydrator fills `href` (see {@link BLOSSOM_TARGET_ATTR}), and
 * the same CSS rule that hides a failed image marks this card as unavailable.
 *
 * `download` is a hint, not a guarantee: it is ignored cross-origin, and the
 * association's Blossom is a different origin than the app. The card therefore also
 * carries `target="_blank"`, so an inline-rendered PDF opens beside the conversation
 * instead of replacing it.
 *
 * @param proxyVerdict `proxifyImage(href, …)` — read as a verdict only, exactly as in
 *   {@link chatVideoHtml}; the address written into `href` is always the raw url.
 */
export const chatFileHtml = (doc: Document, href: string, proxyVerdict: string, name: string, detail: string): string => {
    const card = doc.createElement('a')
    card.className = 'chat-file'
    card.rel = 'noopener noreferrer'
    card.target = '_blank'
    card.setAttribute('download', '')
    const marker = blossomMarkerFor(href, proxyVerdict)
    if (marker === '') {
        card.href = href
    } else {
        card.setAttribute(BLOSSOM_SRC_ATTR, marker)
        card.setAttribute(BLOSSOM_TARGET_ATTR, 'href')
    }
    const label = doc.createElement('span')
    label.className = 'chat-file-name'
    label.textContent = name
    card.appendChild(label)
    if (detail !== '') {
        const meta = doc.createElement('span')
        meta.className = 'chat-file-meta'
        meta.textContent = detail
        card.appendChild(meta)
    }

    return card.outerHTML
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
