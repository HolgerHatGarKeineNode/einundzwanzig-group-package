/**
 * **Tests for the half of `uploads.ts` that P5 added — and for the target switch that
 * never had a case at all.**
 *
 *   node --test --experimental-strip-types packages/einundzwanzig-group/js/uploads.test.ts
 *
 * ── The file-name rule, and why it is not cosmetic ─────────────────────────────────
 *
 * `sanitizeFilename` is private, so it is exercised where it is used: through
 * `buildAttachment`, which is where its output lands in the `imeta` tag. The review
 * removed its path-separator strip, rebuilt and ran the whole P5 spec — nothing turned
 * red. What the rule guards is stated in its own docblock: Buzz validates `filename`
 * (`handlers/imeta.rs:140-154`) and rejects the WHOLE EVENT on a bad one. A file called
 * `../etc/passwd` would therefore not lose its label, it would lose the post.
 *
 * ── `uploadServerFor`: no network is touched here ──────────────────────────────────
 *
 * The empty-space branch never asks. The other two seed welshman's NIP-11 index
 * (`app.use(Relays).set(...)`) before calling, so `spaceIsBuzzAsync` takes its cached
 * path and returns without a fetch — the same seam `dmZielSpace.test.ts` uses. A case
 * here that reached the network would be a hermeticity break, not a stronger test.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Relay } from '@welshman/domain'
import { app, Relays } from './welshmanApp.ts'
import { BLOSSOM_SERVER, attachmentNoteForSpace, buildAttachment, relayHttpOrigin, uploadServerFor } from './uploads.ts'

const HASH = 'a'.repeat(64)
const MEDIA = 'https://relay.test/media/' + HASH + '.pdf'

/** The `imeta` entries as a map — the same shape the renderer reads back out. */
const fields = (tag: string[]): Map<string, string> =>
    new Map(tag.slice(1).map((entry) => [entry.slice(0, entry.indexOf(' ')), entry.slice(entry.indexOf(' ') + 1)]))

// ── the file name in the imeta ─────────────────────────────────────────────────────

test('a plain file name travels into the imeta', () => {
    const tag = fields(buildAttachment(MEDIA, 'application/pdf', HASH, 193, undefined, 'Protokoll 2026.pdf').imetaTag)
    assert.equal(tag.get('filename'), 'Protokoll 2026.pdf')
})

test('path separators are stripped, because the relay rejects the whole event over them', () => {
    // Buzz: "imeta filename must not contain path separators or control characters".
    // The event is refused, not the tag — so the name is cleaned, never passed through.
    const forward = fields(buildAttachment(MEDIA, 'application/pdf', HASH, 193, undefined, '../../etc/passwd').imetaTag)
    assert.equal(forward.get('filename'), '....etcpasswd')
    assert.doesNotMatch(forward.get('filename') ?? '', /[\\/]/)

    const backward = fields(buildAttachment(MEDIA, 'application/pdf', HASH, 193, undefined, 'C:\\Users\\me\\akte.pdf').imetaTag)
    assert.doesNotMatch(backward.get('filename') ?? '', /[\\/]/)
})

test('control characters are stripped for the same reason', () => {
    const tag = fields(buildAttachment(MEDIA, 'application/pdf', HASH, 193, undefined, 'akte\u0000\u001f\u007f.pdf').imetaTag)
    assert.equal(tag.get('filename'), 'akte.pdf')
})

test('a name that cannot be repaired is dropped rather than sent broken', () => {
    // A name is a nicety, the message is not: anything that would still break the
    // relay's rule leaves the tag without a `filename` instead of losing the post.
    for (const raw of ['', '   ', '/', '\u0000', 'x'.repeat(256)]) {
        const tag = fields(buildAttachment(MEDIA, 'application/pdf', HASH, 193, undefined, raw).imetaTag)
        assert.equal(tag.has('filename'), false, JSON.stringify(raw))
    }
})

test('the length limit is measured on both sides of the relay boundary', () => {
    assert.equal(fields(buildAttachment(MEDIA, 'application/pdf', HASH, 1, undefined, 'y'.repeat(255)).imetaTag).has('filename'), true)
    assert.equal(fields(buildAttachment(MEDIA, 'application/pdf', HASH, 1, undefined, 'y'.repeat(256)).imetaTag).has('filename'), false)
})

test('no file name means no filename entry — an image keeps the tag it always had', () => {
    const tag = buildAttachment(MEDIA, 'image/webp', HASH, 900, '640x480').imetaTag
    assert.deepEqual(tag, ['imeta', `url ${MEDIA}`, 'm image/webp', `x ${HASH}`, 'size 900', 'dim 640x480'])
})

test('the attachment carries mime and name for the composer preview', () => {
    const attachment = buildAttachment(MEDIA, 'application/pdf', HASH, 193, undefined, 'Protokoll.pdf')
    assert.equal(attachment.mime, 'application/pdf')
    assert.equal(attachment.name, 'Protokoll.pdf')
})

// ── uploadServerFor: the switch that had no case before P5 ─────────────────────────

const BUZZ = 'wss://buzz.upload.test/'
const ZOOID = 'wss://zooid.upload.test/'

test('without a space the blob goes to the association Blossom', () => {
    return uploadServerFor(null).then((server) => {
        assert.equal(server, BLOSSOM_SERVER)
    })
})

test('an empty space url is the same case', async () => {
    assert.equal(await uploadServerFor(''), BLOSSOM_SERVER)
    assert.equal(await uploadServerFor(undefined), BLOSSOM_SERVER)
})

test('a Buzz space keeps the blob on its own relay', async () => {
    // Buzz refuses any `imeta` whose url is not under its own `media_base_url`
    // (`imeta.rs:61`), so a blob on the Blossom would be unusable there.
    app.use(Relays).set(BUZZ, new Relay(BUZZ, { software: 'https://github.com/block/buzz' }))
    assert.equal(await uploadServerFor(BUZZ), 'https://buzz.upload.test')
})

test('a zooid space keeps using the association Blossom', async () => {
    // The branch that was untested before this file existed.
    app.use(Relays).set(ZOOID, new Relay(ZOOID, { software: 'https://github.com/coracle-social/zooid' }))
    assert.equal(await uploadServerFor(ZOOID), BLOSSOM_SERVER)
})

test('the http origin is derived from the relay address, both schemes', () => {
    assert.equal(relayHttpOrigin('wss://buzz.example/'), 'https://buzz.example')
    assert.equal(relayHttpOrigin('ws://localhost:3001/'), 'http://localhost:3001')
})

// ── attachmentNoteForSpace: the note follows the SAME switch ───────────────────────

test('the note describes the server the next upload would really reach', async () => {
    // One truth, not two: the note goes through `uploadServerFor`. A second, synchronous
    // answer to "is this Buzz?" would drift from the one the upload uses — and the
    // synchronous form reliably says "not Buzz" while NIP-11 is still in flight.
    const onBuzz = await attachmentNoteForSpace(BUZZ)
    const onZooid = await attachmentNoteForSpace(ZOOID)
    assert.match(onBuzz, /Audiodateien/)
    assert.match(onZooid, /1 GB/)
    assert.notEqual(onBuzz, onZooid)
})

test('without a space the note is the Blossom one', async () => {
    assert.equal(await attachmentNoteForSpace(null), await attachmentNoteForSpace(ZOOID))
})
