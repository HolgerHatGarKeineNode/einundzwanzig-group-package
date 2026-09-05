/**
 * **What each upload target accepts — measured at both endpoints, not assumed.**
 *
 * The chat composer has ONE file button, but it can end up talking to one of two
 * servers ({@link uploadServerFor}), and those two do not accept the same files. This
 * module is the single place where that difference is written down, so the same
 * sentence drives the pre-check, the error text and the note in the surface.
 *
 * ── The measurements this module encodes (2026-09-05, artifacts `p5-endpunkt-*`) ──
 *
 * Both were run as real `PUT /upload` calls, one per file, against a local Buzz test
 * stack and against a locally built copy of the association's Blossom server
 * (`blossom-members`, khatru v0.19.1). Nothing was written to the production service.
 *
 * | file | Buzz | Blossom |
 * |---|---|---|
 * | PNG | 200, descriptor with `dim`/`blurhash`/`thumb` | 200 |
 * | PDF | 200, descriptor without preview fields | 200 |
 * | text without magic bytes | 200 as `application/octet-stream`, `.bin` | 200 as `text/plain; charset=utf-8` |
 * | ZIP | 200 | 200 |
 * | MP4 straight out of ffmpeg | **422** `media contains metadata or a non-canonical metadata channel` | 200 |
 * | MP4 built with `-map_metadata -1 -fflags +bitexact` | 200, descriptor with `dim` and `duration` | 200 |
 * | MP3 | **415** `disallowed content type: audio/mpeg` | 200 |
 * | ELF binary | **415** `disallowed content type: application/x-executable` | 200 |
 *
 * ── Two rules follow from that, and only two ──
 *
 * 1. **Reject up front only what is certain to fail.** Audio and the executable/active
 *    content deny list are compiled into Buzz (`buzz-media/src/validation.rs:87-103`
 *    and `:200-206`) and cannot be configured away, so refusing them in the browser
 *    turns a technical 415 into a sentence. Everything else is the server's call.
 * 2. **Never predict what only the server can know.** Whether an MP4 is metadata-free
 *    is a walk over its box tree; a size cap is configuration. Both stay with the
 *    server, and the failure is reported, not anticipated.
 *
 * The direction of the check is therefore deliberately **fail-open**: an unknown MIME
 * type is passed on. A browser that guesses wrong here would block a file the relay
 * would have taken, and the user has no way to argue with it.
 */
import { t } from './i18n.ts'

/** Which of the two servers the blob is headed for ({@link uploadServerFor}). */
export type UploadTarget = 'buzz' | 'blossom'

/** Result of the pre-check: either it may go, or it may not and there is a reason. */
export type AttachmentVerdict = { ok: true } | { ok: false; reason: string }

/** Just the parts of a `File` this module reads — so it is testable without a browser. */
export type UploadCandidate = { type: string; size: number; name: string }

/**
 * MIME types Buzz refuses outright on the generic file path
 * (`buzz-media/src/validation.rs:87-103`, `BLOCKED_FILE_MIME_TYPES`).
 *
 * `image/svg+xml` is on Buzz's list but is NOT repeated here, and that is measured, not
 * an oversight: the deny list only applies to what `infer` sniffed, and `infer` does not
 * recognise SVG. The probe went through with HTTP 200 and was stored as
 * `application/octet-stream`/`.bin`, which Buzz then serves as a download
 * (`validation.rs:230 serve_inline`). Listing it here would refuse a file the relay
 * accepts.
 */
const BUZZ_BLOCKED_MIME: readonly string[] = [
    'application/xhtml+xml',
    'application/javascript',
    'text/javascript',
    'application/x-msdownload',
    'application/x-executable',
    'application/vnd.microsoft.portable-executable',
    'application/x-mach-binary',
    'application/x-sharedlib',
    'application/x-elf',
    'application/x-msi',
    'application/vnd.android.package-archive',
    'application/x-apple-diskimage',
]

/** Size ceiling of the association's Blossom server (`blossom-members/main.go:31`). */
export const BLOSSOM_MAX_BYTES = 1024 * 1024 * 1024

/**
 * May this file be sent to that target?
 *
 * The MIME type is taken from the browser's `File.type`, which is a hint and may be
 * empty — an empty type is never refused here, because Buzz decides from the bytes
 * anyway and would take an unrecognisable file as `application/octet-stream`.
 */
export const checkAttachment = (file: UploadCandidate, target: UploadTarget): AttachmentVerdict => {
    const mime = (file.type || '').toLowerCase().split(';')[0].trim()
    if (target === 'blossom') {
        return file.size > BLOSSOM_MAX_BYTES
            ? { ok: false, reason: t('Die Datei ist größer als 1 GB — so viel nimmt der Vereins-Server nicht an.') }
            : { ok: true }
    }
    if (mime.startsWith('audio/')) {
        return { ok: false, reason: t('Dieser Relay nimmt keine Audiodateien an — auch keine Sprachnachrichten.') }
    }
    if (BUZZ_BLOCKED_MIME.includes(mime)) {
        return { ok: false, reason: t('Dieser Relay nimmt Programme und ausführbare Dateien nicht an.') }
    }

    return { ok: true }
}

/**
 * The sentence the surface shows so that „the same button behaves differently per
 * relay" is stated instead of concealed.
 *
 * Deliberately without byte figures for Buzz: its caps are configuration
 * (`max_file_bytes`, `max_video_bytes`), and a number printed here would be a claim
 * about a server this client does not read. Blossom's ceiling is a compiled-in
 * constant and is therefore named.
 */
export const attachmentNoteFor = (target: UploadTarget): string =>
    target === 'buzz'
        ? t('Dieser Relay nimmt Bilder, MP4-Videos ohne eingebettete Metadaten sowie Dokumente und Archive an — keine Audiodateien und keine Programme.')
        : t('Der Vereins-Server nimmt jede Dateiart bis 1 GB an.')
