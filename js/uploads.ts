/**
 * Blossom-Upload für Chat-Anhänge (PLAN5 C6a). Der Blob (bereits vom Cropper
 * zugeschnitten + als WebP komprimiert, siehe bridge.ts) wird hash-basiert auf
 * einen Blossom-Server geladen (BUD-Spec: `Authorization`-Event kind 24242,
 * im Browser signiert — der Server sieht nie den Key). Ergebnis: URL + NIP-92
 * `imeta`-Tag, das `sendRoomMessage` an die kind-9-Nachricht hängt.
 *
 * **Server-Wahl ist eine WEICHE, keine Konstante** (P6): Buzz nimmt nur Anhänge an,
 * die in seinem EIGENEN Medien-Speicher liegen — `imeta.rs:61` verlangt, dass die
 * `url` unter der `media_base_url` des Relays liegt, sonst
 * `invalid: imeta url must be a local /media/ path`. Ein Blob auf dem Vereins-Blossom
 * ist für ein Buzz-Relay also grundsätzlich unbrauchbar. Buzz' Medien-API ist dabei
 * selbst Blossom-kompatibel (`api/media.rs`: `PUT /upload` BUD-02, `GET /media/{sha}.{ext}`
 * BUD-01) — es wechselt nur das Ziel, nicht das Verfahren. Auf zooid-Spaces bleibt der
 * Vereins-Blossom.
 *
 * **Am laufenden Test-Relay gemessen (2026-07-29, `:3001`)**, weil an dieser Stelle
 * geraten teuer wäre:
 *  - welshmans `makeBlossomAuthEvent` genügt Buzz unverändert. Es setzt `["u", server]`,
 *    Buzz prüft `["server", …]` und nur, WENN vorhanden (`buzz-media/src/auth.rs:122`)
 *    → kein Konflikt. Ein zusätzlicher `server`-Tag änderte nichts (Variante C: HTTP 200).
 *  - **Der `X-SHA-256`-Header ist Pflicht** (BUD-11, `api/media.rs`, Schritt 3): ohne ihn
 *    antwortet Buzz **HTTP 401 `authentication failed`** — genau der heutige Client-Pfad.
 *    Mit Header: HTTP 200. welshmans `uploadBlob` sendet ihn nicht, nimmt aber eigene
 *    Header entgegen.
 *  - Der Descriptor liefert `url, sha256, size, type, uploaded, dim, blurhash, thumb`.
 *
 * Der Header geht NUR an Buzz. Für einen fremden Server wäre er ein zusätzlicher
 * Request-Header und bräuchte dessen CORS-Freigabe (`Access-Control-Allow-Headers`) —
 * fehlt sie, blockt der Browser den Upload im Preflight. Ein funktionierender Pfad
 * wird nicht auf Verdacht umgebaut.
 */
import { makeBlossomAuthEvent, uploadBlob } from '@welshman/util'
import { signer } from './welshmanSession.ts'
import { parseJson, sha256 } from '@welshman/lib'
import { spaceIsBuzzAsync } from './buzzAdmin.ts'
import { attachmentNoteFor, checkAttachment } from './attachmentPolicy.ts'
import { t } from './i18n.ts'

// ponytail: fixer Server statt kind-10063-Auflösung; Profil-Serverliste wieder einbauen,
// wenn Nutzer außerhalb des Vereins-Blossom hochladen sollen (git log hat die alte Logik).
export const BLOSSOM_SERVER = 'https://blossom.einundzwanzig.space'

export type Attachment = {
    url: string
    imetaTag: string[]
    /**
     * Vorschaubild für den Composer als `data:`-URL — die Bytes, die der Nutzer GERADE
     * zugeschnitten hat, nicht die vom Server geholten. Siehe {@link thumbDataUrl}.
     * Optional, weil `buildAttachment` (rein, ohne Canvas) es nicht setzen kann.
     */
    previewUrl?: string
    /**
     * MIME of the stored blob as the SERVER reported it. The composer decides on it
     * whether the preview is an image tile or a file row — it should not have to take
     * the `imeta` tag apart a second time for that.
     */
    mime?: string
    /** Original file name where usable ({@link sanitizeFilename}), `''` otherwise. */
    name?: string
}

/**
 * Zielmaße eines Vorschaubilds: längste Kante auf `max`, Seitenverhältnis erhalten,
 * nie vergrößern. Rein → node-testbar.
 */
export const thumbBox = (width: number, height: number, max = 128): { width: number; height: number } => {
    const longest = Math.max(width, height)
    if (!Number.isFinite(longest) || longest <= 0) {
        return { width: max, height: max }
    }
    const factor = Math.min(1, max / longest)

    return { width: Math.max(1, Math.round(width * factor)), height: Math.max(1, Math.round(height * factor)) }
}

/**
 * Vorschaubild des zugeschnittenen Canvas als `data:`-URL. `''`, wenn der Browser
 * nicht mitspielt — dann fällt die Fläche auf den bisherigen Weg zurück.
 *
 * ── Warum `data:` und nicht `URL.createObjectURL` ──
 *
 * Ein Object-URL müsste widerrufen werden, sonst wächst der Speicher. Der Anhang wird
 * aber an sechs Stellen genullt und im Fehlerfall des Sendens WIEDER GESETZT
 * (`send()`); ein Widerruf an der falschen dieser Stellen macht die Vorschau des
 * zurückgelegten Anhangs kaputt, ein fehlender leckt. Eine `data:`-URL hat keine
 * Lebensdauer: sie hängt am Objekt und verschwindet mit ihm. Der Preis ist ihre Größe
 * — deshalb 128 px statt der 2048 px des Originals, gemessen wenige Kilobyte statt
 * mehrerer hundert. Für eine 56×56-Kachel ist das die doppelte Auflösung.
 *
 * ── Warum überhaupt lokal und nicht über den Blossom-Weg ──
 *
 * Auf einem Buzz-Space liegt der frische Upload unter `…/media/…` und ist damit
 * auth-pflichtig: `$img()` gibt für ihn `''` zurück (die Wache in [[mediaGuard]]), die
 * Kachel blieb leer — der Nutzer sah sein eigenes Bild nicht. Ihn signiert
 * zurückzuholen wäre eine Signatur-Runde und ein Netzweg für Bytes, die im Browser
 * schon liegen.
 */
export const thumbDataUrl = (doc: Document, source: CanvasImageSource & { width: number; height: number }, max = 128): string => {
    try {
        const { width, height } = thumbBox(source.width, source.height, max)
        const canvas = doc.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d')
        if (!ctx) {
            return ''
        }
        ctx.drawImage(source, 0, 0, width, height)

        return canvas.toDataURL('image/webp', 0.7)
    } catch {
        return ''
    }
}

/**
 * HTTP(S)-Origin eines Relays: `wss://host/` → `https://host`, `ws://host:3001/` →
 * `http://host:3001`. Buzz bedient Nostr-WS und Medien-REST auf DEMSELBEN Port
 * (`api/media.rs`), die Ableitung ist also keine Konvention, sondern die Adresse selbst.
 * Rein → node-testbar.
 */
export const relayHttpOrigin = (relayUrl: string): string => {
    const u = new URL(relayUrl)
    if (u.protocol === 'wss:') {
        u.protocol = 'https:'
    } else if (u.protocol === 'ws:') {
        u.protocol = 'http:'
    }
    return u.origin
}

/**
 * Wohin der Blob geht. `spaceUrl` leer (Kontext ohne Space) → Vereins-Blossom.
 *
 * **`spaceIsBuzzAsync`, nicht die synchrone Fassung.** Die synchrone liest nur den
 * NIP-11-Cache und meldet beim ersten Rendern verlässlich `false` — der erste Upload
 * eines frisch geladenen Tabs liefe damit immer auf den falschen Server und schlüge
 * mit einer Meldung fehl, die auf den Blossom zeigt statt auf die Ursache.
 */
export const uploadServerFor = async (spaceUrl: string | null | undefined): Promise<string> =>
    spaceUrl && (await spaceIsBuzzAsync(spaceUrl)) ? relayHttpOrigin(spaceUrl) : BLOSSOM_SERVER

/**
 * The sentence the composer shows about what this space's upload target accepts.
 *
 * Deliberately routed through {@link uploadServerFor} rather than asking
 * `spaceIsBuzz` a second time: the note must describe the server the NEXT upload would
 * actually reach. A second, synchronous answer to the same question is exactly the kind
 * of second truth that drifts — and the synchronous form reliably says "not Buzz" while
 * NIP-11 is still in flight, so the note would have described the wrong server on every
 * freshly loaded tab.
 */
export const attachmentNoteForSpace = async (spaceUrl?: string | null): Promise<string> =>
    attachmentNoteFor((await uploadServerFor(spaceUrl)) === BLOSSOM_SERVER ? 'blossom' : 'buzz')

/**
 * Baut URL + NIP-92-`imeta`-Tag aus dem Blossom-Ergebnis. Rein (kein Netzwerk/Store) →
 * als JS-Unit testbar. Die Server-URL ist **untrusted** (Antwort des konfigurierten
 * Servers): `new URL(...).href` normalisiert sie (entfernt eingeschleuste Whitespace/
 * Newlines, die sonst als Fremdtext in den publizierten Nachrichten-Content lecken
 * würden) und `protocol` wird auf http(s) beschränkt. Fehlt dem LETZTEN Pfad-Segment
 * die Bild-Endung, wird sie aus dem MIME ergänzt (sonst erkennt `renderMessageLink`
 * das Bild nicht) — vor dem Query, nicht am rohen String. `dim` (BxH) nur, wenn bekannt.
 *
 * **`size` ist Pflicht, nicht optional.** Buzz verlangt `url`, `m`, `x` UND `size`
 * (`imeta.rs:161`) und gleicht die Zahl gegen die gespeicherte Blob-Größe ab
 * (`verify_imeta_blobs`, Schritt 3) — ein geschätzter Wert wäre schlimmer als keiner.
 * NIP-92 sieht das Feld ohnehin vor, deshalb steht es auf BEIDEN Strecken drin und
 * nicht nur im Buzz-Zweig.
 */
export const buildAttachment = (rawUrl: string, mime: string, hash: string, size: number, dim?: string, filename?: string): Attachment => {
    const u = new URL(rawUrl)
    if (u.protocol !== 'https:' && u.protocol !== 'http:') {
        throw new Error(t('Ungültige Upload-URL vom Server'))
    }
    const lastSegment = u.pathname.split('/').pop() ?? ''
    if (!lastSegment.includes('.')) {
        u.pathname = u.pathname.replace(/\/+$/, '') + '.' + (mime.split('/')[1] || 'webp')
    }
    const url = u.href
    const imetaTag = ['imeta', `url ${url}`, `m ${mime}`, `x ${hash}`]
    if (Number.isInteger(size) && size > 0) {
        imetaTag.push(`size ${size}`)
    }
    if (dim) {
        imetaTag.push(`dim ${dim}`)
    }
    const cleanName = sanitizeFilename(filename)
    if (cleanName !== '') {
        imetaTag.push(`filename ${cleanName}`)
    }
    return { url, imetaTag, mime, name: cleanName }
}

/**
 * The original file name for the `filename` field of the `imeta` tag — or `''`.
 *
 * **Why the file card cannot simply read the URL:** both servers name the blob after its
 * content hash. A 190-byte PDF comes back as `…/media/794abaa4…f47b.pdf` (measured
 * 2026-09-05, `p5-endpunkt-buzz-roh.txt`); that is a checksum, and the only place the
 * reader's `Vereinsprotokoll.pdf` still exists is the sender's browser.
 *
 * **The three rules are Buzz's, taken from its validator** (`handlers/imeta.rs:140-154`),
 * not invented here: 1–255 characters, no path separator, no control character. A tag
 * that breaks any of them makes the relay reject the whole MESSAGE — a bad file name
 * would not lose a label, it would lose the post. Anything unusable is therefore dropped
 * rather than repaired: a name is a nicety, the message is not.
 */
const sanitizeFilename = (raw: string | undefined): string => {
    if (typeof raw !== 'string') {
        return ''
    }
    const clean = raw
        .replace(/[\u0000-\u001f\u007f]/g, '')
        .replace(/[\\/]/g, '')
        .trim()

    return clean.length >= 1 && clean.length <= 255 ? clean : ''
}

/**
 * BUD-02-Descriptor, wie ihn beide Server zurückgeben. Alle Felder optional, weil die
 * Antwort eines fremden Servers **untrusted** ist — die lokalen Werte (Blob-Hash/-Größe/
 * -MIME) sind der Fallback.
 */
type BlobDescriptor = { url?: string; sha256?: string; size?: number; type?: string; dim?: string }

/** Kanonischer SHA-256: 64 Zeichen, klein, hex. Alles andere fällt auf den lokalen Hash zurück. */
const HEX64 = /^[0-9a-f]{64}$/

/**
 * The refusal in the words the SERVER used — the two of them speak different channels.
 *
 * Measured 2026-09-05 (`p5-endpunkt-*`): Blossom (khatru `blossomError`) puts its reason
 * in the `X-Reason` header and usually leaves the body empty; **Buzz sets no `X-Reason`
 * at all** and answers `{"error":"disallowed content type: audio/mpeg"}` with HTTP 415,
 * or `{"error":"media contains metadata or a non-canonical metadata channel"}` with 422.
 * Reading only the header left the Buzz half of the toast at a bare status code; reading
 * the raw body put a JSON object in front of the user. Hence: header first, then the
 * `error` field of a JSON body, then the raw text.
 */
const refusalReason = (headerReason: string | null, body: string): string => {
    if (headerReason) {
        return headerReason
    }
    const parsed = parseJson<{ error?: unknown }>(body)

    return typeof parsed?.error === 'string' && parsed.error.trim() !== '' ? parsed.error.trim() : body.trim()
}

/**
 * Lädt einen Bild-Blob hoch und gibt URL + `imeta`-Tag zurück. `spaceUrl` entscheidet das
 * Ziel (siehe {@link uploadServerFor}); `dim` = BxH des zugeschnittenen Canvas.
 * Wirft mit der Server-/Netzwerkmeldung bei Fehlschlag (bridge zeigt sie als Toast).
 *
 * Since P5 it carries any blob, not only an image, and `filename` passes the original
 * file name through to the `imeta` tag (set for non-image attachments only).
 *
 * **Die Metadaten kommen bevorzugt aus dem Descriptor des Servers**, nicht aus dem lokalen
 * Blob: Buzz gleicht `m` und `size` gegen die gespeicherte Sidecar-Datei ab
 * (`verify_imeta_blobs`). Reicht der Server einen anderen (gesnifften) MIME oder eine andere
 * Größe zurück als der Browser meint, gewinnt der Server — sonst lehnt er die eigene Datei
 * beim Publizieren ab. Fehlt ein Feld, bleibt der lokale Wert.
 *
 * **The pre-check sits AFTER the server choice, not before it** (P5): which file kinds
 * get through depends on the target and not on the client — the two servers were
 * measured to be differently strict ([[attachmentPolicy]]). It refuses only what is
 * certain to fail; everything else stays the server's decision.
 */
export const uploadAttachment = async (blob: Blob, spaceUrl?: string | null, dim?: string, filename?: string): Promise<Attachment> => {
    const activeSigner = signer.get()
    if (!activeSigner) {
        throw new Error(t('Kein aktiver Signer — bitte anmelden.'))
    }
    const server = await uploadServerFor(spaceUrl)
    const isOwnRelay = server !== BLOSSOM_SERVER
    const verdict = checkAttachment({ type: blob.type, size: blob.size, name: filename ?? '' }, isOwnRelay ? 'buzz' : 'blossom')
    if (!verdict.ok) {
        throw new Error(verdict.reason)
    }
    const host = new URL(server).host
    const hash = await sha256(await blob.arrayBuffer())
    const authEvent = await activeSigner.sign(makeBlossomAuthEvent({ action: 'upload', server, hashes: [hash] }))
    // BUD-11: Buzz verlangt den Hash zusätzlich als Header und antwortet ohne ihn mit 401
    // (gemessen). Nur auf der eigenen Strecke setzen — siehe CORS-Begründung im Modulkopf.
    const headers: Record<string, string> = isOwnRelay ? { 'X-SHA-256': hash } : {}

    // `uploadBlob` ist ein nacktes `fetch` (welshman): Netzfehler → TypeError ("Failed to fetch",
    // NIE beim Server angekommen); HTTP-Fehler → Response mit res.ok=false, Grund im `X-Reason`-
    // Header (Blossom BUD-06, Body oft leer). Beides so aufbereiten, dass der Toast dem Nutzer den
    // Server nennt und WOHER der Fehler stammt (Netz vs. Server-Ablehnung).
    let res: Response
    try {
        res = await uploadBlob(server, blob, { authEvent, headers })
    } catch {
        throw new Error(t('Blossom-Server :host nicht erreichbar (Netzwerkfehler) — bitte erneut versuchen.', { host }))
    }
    const text = await res.text()
    if (!res.ok) {
        const reason = refusalReason(res.headers.get('X-Reason'), text)
        throw new Error(t(':host lehnte den Upload ab (HTTP :status:reason).', { host, status: res.status, reason: reason ? `: ${reason}` : '' }))
    }
    const task = parseJson<BlobDescriptor>(text)
    if (!task?.url) {
        throw new Error(t(':host lieferte keine Upload-URL:reason.', { host, reason: text.trim() ? `: ${text.trim()}` : '' }))
    }
    return buildAttachment(
        task.url,
        typeof task.type === 'string' && task.type.includes('/') ? task.type : blob.type,
        typeof task.sha256 === 'string' && HEX64.test(task.sha256) ? task.sha256 : hash,
        Number.isInteger(task.size) && (task.size as number) > 0 ? (task.size as number) : blob.size,
        dim ?? (typeof task.dim === 'string' ? task.dim : undefined),
        filename,
    )
}
