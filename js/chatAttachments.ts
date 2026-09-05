/**
 * **How an attachment URL in a message body is meant to be shown.**
 *
 * A chat message carries its attachment twice: as a bare URL in the body (so every
 * foreign client shows something) and as a NIP-92 `imeta` tag with MIME, hash, size and
 * — since this phase — the original file name. The renderer in `feeds.ts` sees only the
 * URL; this module is what turns the pair back into a decision.
 *
 * Kept free of welshman and of the DOM on purpose: the decision has to be arguable
 * under `node --test`, and `feeds.ts` pulls half the welshman tree.
 *
 * ── Why the decision is not simply "does the URL end in .pdf" ───────────────────────
 *
 * Because a message body may contain any link, and a link is not an attachment. Turning
 * every `https://example.org/paper.pdf` into a file card would hide the address the
 * reader is about to visit — the very thing `chatLinks.ts linkDisplay` exists to keep
 * visible. So a file card is built ONLY for a URL the message itself declares as its
 * attachment via `imeta`. Everything else stays the anchor it is today.
 *
 * Images are the one exception, and they keep the behaviour they already had: an image
 * extension is enough, with or without `imeta`. That path runs through the image proxy
 * (`proxifyImage`), so it does not reach a foreign host from the reader's browser.
 *
 * ── Why a video needs one more condition than a file ────────────────────────────────
 *
 * A `<video src>` fetches from wherever the src points, straight out of the reader's
 * browser and without the proxy that covers images. For a foreign host that is the IP
 * leak the proxy was built to avoid. A player is therefore only built for media this
 * house serves itself — the workspace relay (fetched signed through the Blossom loader)
 * or the association's own Blossom. Any other video stays a file card: one click, one
 * conscious navigation, no automatic request.
 */
import { formatNumber } from './locale.ts'
import { t } from './i18n.ts'

/** What a single `imeta` tag says about one attachment. */
export type AttachmentInfo = {
    url: string
    /** `m` field, lower-cased and without parameters (`text/plain; charset=utf-8` → `text/plain`). */
    mime: string
    /** `filename` field, or `''` when the sender did not set one. */
    name: string
    /** `size` field in bytes, `0` when absent or unusable. */
    size: number
}

/** How `feeds.ts` should render a link token. */
export type AttachmentRenderKind = 'image' | 'video' | 'file' | 'link'

/** Image extensions the message renderer already turned into `<img>` before this phase. */
export const IMAGE_URL = /\.(jpe?g|png|gif|webp)$/i

/**
 * Video extensions used as a fallback when the sender wrote no `imeta` `m` field.
 * Wider than Buzz stores (only MP4) because a message may come from any client and the
 * association's Blossom stores whatever it is given.
 */
export const VIDEO_URL = /\.(mp4|m4v|webm|mov)$/i

/** Fields of one `imeta` tag, `key value` per entry (NIP-92). First occurrence wins. */
const imetaFields = (tag: string[]): Map<string, string> => {
    const fields = new Map<string, string>()
    for (const entry of tag.slice(1)) {
        if (typeof entry !== 'string') {
            continue
        }
        const at = entry.indexOf(' ')
        if (at > 0 && !fields.has(entry.slice(0, at))) {
            fields.set(entry.slice(0, at), entry.slice(at + 1).trim())
        }
    }

    return fields
}

/**
 * Every `imeta` of an event, keyed by its `url`.
 *
 * A tag without a usable `url` is dropped rather than kept with an empty key: the map is
 * looked up BY url, and an entry under `''` could only ever be found by a link that has
 * no address.
 */
export const attachmentIndex = (tags: string[][]): Map<string, AttachmentInfo> => {
    const index = new Map<string, AttachmentInfo>()
    for (const tag of tags) {
        if (!Array.isArray(tag) || tag[0] !== 'imeta') {
            continue
        }
        const fields = imetaFields(tag)
        const url = fields.get('url') ?? ''
        if (!/^https?:\/\//i.test(url) || index.has(url)) {
            continue
        }
        const size = Number(fields.get('size'))
        index.set(url, {
            url,
            mime: (fields.get('m') ?? '').toLowerCase().split(';')[0].trim(),
            name: fields.get('filename') ?? '',
            size: Number.isFinite(size) && size > 0 ? Math.round(size) : 0,
        })
    }

    return index
}

/**
 * The rendering decision for one link token.
 *
 * @param ownMedia Whether this house serves the URL itself — see the module header for
 *   why a player hangs on this and a file card does not.
 */
export const attachmentRenderKind = (href: string, info: AttachmentInfo | undefined, ownMedia: boolean): AttachmentRenderKind => {
    if (IMAGE_URL.test(href) || info?.mime.startsWith('image/')) {
        return 'image'
    }
    if (!info) {
        return 'link'
    }
    const isVideo = info.mime ? info.mime.startsWith('video/') : VIDEO_URL.test(href)

    return isVideo && ownMedia ? 'video' : 'file'
}

/**
 * Byte count as a short, locale-formatted string. `0` yields `''` — a file card without
 * a size says nothing instead of claiming zero bytes.
 *
 * The unit stays untranslated and is not a catalogue key: `B`, `KB`, `MB`, `GB` are
 * symbols, identical across the seven locales of this house. Only the NUMBER is
 * localised, and that is what {@link formatNumber} is for — `1,2 MB` under `de`,
 * `1.2 MB` under `en`.
 */
export const formatByteSize = (bytes: number): string => {
    if (!Number.isFinite(bytes) || bytes <= 0) {
        return ''
    }
    if (bytes < 1024) {
        return `${formatNumber(bytes)} B`
    }
    if (bytes < 1024 * 1024) {
        return `${formatNumber(Math.round(bytes / 1024))} KB`
    }
    if (bytes < 1024 * 1024 * 1024) {
        return `${formatNumber(Math.round((bytes / (1024 * 1024)) * 10) / 10)} MB`
    }

    return `${formatNumber(Math.round((bytes / (1024 * 1024 * 1024)) * 10) / 10)} GB`
}

/**
 * Short type label for a file card: the subtype in capitals (`PDF`, `ZIP`), because the
 * full MIME type is noise for a reader and the subtype is what people call the format.
 *
 * `application/octet-stream` is the MIME both servers fall back to for anything they
 * could not sniff — printing `OCTET-STREAM` would name an implementation detail, so it
 * yields `''` and the card shows the size alone.
 */
export const attachmentTypeLabel = (mime: string): string => {
    const subtype = (mime || '').toLowerCase().split(';')[0].trim().split('/')[1] ?? ''
    if (subtype === '' || subtype === 'octet-stream') {
        return ''
    }

    return subtype.replace(/^x-/, '').replace(/\+.*$/, '').toUpperCase()
}

/**
 * Name and second line of a file card.
 *
 * The name comes from the `imeta` `filename` if the sender set one; otherwise from the
 * URL's last path segment. NOT from the URL alone as a rule, because both servers name
 * the blob after its hash: the URL of a 190-byte PDF is
 * `…/794abaa4….pdf`, which is a checksum, not a file name (measured, `p5-endpunkt-*`).
 */
export const fileCardLabels = (href: string, info: AttachmentInfo): { name: string; detail: string } => {
    let name = info.name
    if (name === '') {
        try {
            name = decodeURIComponent(new URL(href).pathname.split('/').pop() ?? '')
        } catch {
            name = ''
        }
    }
    const detail = [attachmentTypeLabel(info.mime), formatByteSize(info.size)].filter(Boolean).join(' · ')

    return { name: name || t('Datei'), detail }
}
