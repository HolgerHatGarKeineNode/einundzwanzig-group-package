/**
 * **Pure tests for the rendering decision behind a chat attachment.**
 *
 *   node --test --experimental-strip-types packages/einundzwanzig-group/js/chatAttachments.test.ts
 *
 * ── Why this file exists, stated as the measurement that forced it ─────────────────
 *
 * P5 added ~400 lines of pure, node-testable logic and not one unit case. The review
 * removed three rules from those modules, rebuilt, and ran the whole P5 E2E spec plus
 * the rendered Pest cases: **nothing turned red**. Two of the three lived here.
 *
 * The heavy one is `attachmentRenderKind`'s `ownMedia` condition. It is not a cosmetic
 * rule and not a test gap — it is a security promise with no latch behind it. Drop it,
 * and a `<video src>` pointing at a FOREIGN host plays in the reader's browser, fetched
 * directly, with no proxy in between: exactly the IP leak `mediaGuard.ts` was built to
 * prevent for images. The rule is right today and stays right only until somebody
 * rearranges this function — and until this file existed, nobody would have noticed.
 *
 * The file therefore asserts the DIRECTION of each decision, not just the happy value:
 * for every "yes" there is the neighbouring "no" that must not flip with it.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
    attachmentIndex,
    attachmentRenderKind,
    attachmentTypeLabel,
    fileCardLabels,
    formatByteSize,
    type AttachmentInfo,
} from './chatAttachments.ts'

/** A ready-made `imeta` record; the fields a case does not care about stay neutral. */
const info = (over: Partial<AttachmentInfo> = {}): AttachmentInfo => ({
    url: 'https://relay.test/media/abc.pdf',
    mime: 'application/pdf',
    name: '',
    size: 0,
    ...over,
})

// ── attachmentRenderKind — the `ownMedia` condition ────────────────────────────────

test('a video on our own media becomes a player', () => {
    assert.equal(attachmentRenderKind('https://relay.test/media/a.mp4', info({ mime: 'video/mp4' }), true), 'video')
})

test('THE SAME video on a FOREIGN host becomes a file card, never a player', () => {
    // The whole point: identical url shape, identical imeta, only `ownMedia` differs.
    // A `<video src>` would fetch from that host out of the reader's browser — the leak
    // the image proxy exists to prevent. A card is a link: one click, one conscious
    // navigation, no automatic request.
    assert.equal(attachmentRenderKind('https://foreign.test/a.mp4', info({ mime: 'video/mp4' }), false), 'file')
})

test('the video extension alone does not earn a player either', () => {
    // No `m` field (a foreign client that wrote a bare `imeta`), foreign host: the
    // extension fallback must be subject to the same condition as the MIME.
    assert.equal(attachmentRenderKind('https://foreign.test/a.webm', info({ mime: '' }), false), 'file')
    assert.equal(attachmentRenderKind('https://relay.test/media/a.webm', info({ mime: '' }), true), 'video')
})

test('a non-video attachment is a card on both sides of the condition', () => {
    // Control: `ownMedia` must decide the VIDEO question and nothing else. If a `false`
    // here started producing `link`, the condition would have grown a second job.
    assert.equal(attachmentRenderKind('https://relay.test/media/a.pdf', info(), true), 'file')
    assert.equal(attachmentRenderKind('https://foreign.test/a.pdf', info(), false), 'file')
})

// ── attachmentRenderKind — a link is not an attachment ─────────────────────────────

test('a url the message does not declare stays a plain link', () => {
    // A message body may carry any link. Turning it into a card would hide the address
    // the reader is about to visit — the thing `chatLinks.ts linkDisplay` keeps visible.
    assert.equal(attachmentRenderKind('https://example.org/paper.pdf', undefined, false), 'link')
    assert.equal(attachmentRenderKind('https://example.org/clip.mp4', undefined, true), 'link')
})

test('an image needs no imeta and keeps the behaviour it had before P5', () => {
    assert.equal(attachmentRenderKind('https://example.org/cat.jpg', undefined, false), 'image')
    assert.equal(attachmentRenderKind('https://example.org/cat.PNG', undefined, false), 'image')
})

test('an image is recognised by its imeta even when the url has no extension', () => {
    assert.equal(attachmentRenderKind('https://relay.test/media/abc', info({ mime: 'image/webp' }), true), 'image')
})

// ── attachmentIndex ────────────────────────────────────────────────────────────────

test('imeta fields are read into the index, keyed by url', () => {
    const index = attachmentIndex([
        ['imeta', 'url https://relay.test/media/a.pdf', 'm application/pdf', 'size 193', 'filename Protokoll.pdf'],
        ['e', 'not-an-imeta'],
    ])
    assert.deepEqual(index.get('https://relay.test/media/a.pdf'), {
        url: 'https://relay.test/media/a.pdf',
        mime: 'application/pdf',
        name: 'Protokoll.pdf',
        size: 193,
    })
})

test('a MIME with parameters is reduced to type/subtype', () => {
    // Blossom answered exactly this for a text file (measured, `p5-endpunkt-*`). Left
    // whole, every `startsWith`/`split('/')` downstream would have to know about it.
    const index = attachmentIndex([['imeta', 'url https://relay.test/a.txt', 'm text/plain; charset=utf-8', 'size 46']])
    assert.equal(index.get('https://relay.test/a.txt')?.mime, 'text/plain')
})

test('an imeta without a usable url is dropped, not stored under an empty key', () => {
    // The map is looked up BY url; an entry under `''` could only be found by a link
    // that has no address.
    assert.equal(attachmentIndex([['imeta', 'm application/pdf', 'size 12']]).size, 0)
    assert.equal(attachmentIndex([['imeta', 'url ftp://relay.test/a.pdf', 'm application/pdf']]).size, 0)
})

test('an unusable size does not become a number', () => {
    const index = attachmentIndex([['imeta', 'url https://relay.test/a.pdf', 'size nonsense']])
    assert.equal(index.get('https://relay.test/a.pdf')?.size, 0)
})

// ── formatByteSize ─────────────────────────────────────────────────────────────────

test('bytes below a kilobyte are shown as bytes', () => {
    // The branch the review deleted without anything turning red.
    assert.equal(formatByteSize(1), '1 B')
    assert.equal(formatByteSize(193), '193 B')
    assert.equal(formatByteSize(1023), '1.023 B')
})

test('the unit steps at the kibibyte boundaries, measured on both sides', () => {
    assert.equal(formatByteSize(1024), '1 KB')
    assert.equal(formatByteSize(1024 * 1024), '1 MB')
    assert.equal(formatByteSize(1024 * 1024 * 1024), '1 GB')
    assert.equal(formatByteSize(1536 * 1024), '1,5 MB')
})

test('one byte below a boundary does not print the boundary in the smaller unit', () => {
    // The defect this case was written for: 1 048 575 B is 1023.999 KB, so the first cut
    // of `formatByteSize` picked KB and then rounded the number to 1024 — `1.024 KB`,
    // which is a figure nobody writes. The unit has to be chosen from the rounded value.
    assert.equal(formatByteSize(1024 * 1024 - 1), '1 MB')
    assert.equal(formatByteSize(1024 * 1024 * 1024 - 1), '1 GB')
})

test('a size that says nothing renders as nothing', () => {
    // A card without a size says nothing rather than claiming zero bytes.
    assert.equal(formatByteSize(0), '')
    assert.equal(formatByteSize(-5), '')
    assert.equal(formatByteSize(Number.NaN), '')
})

// ── attachmentTypeLabel ────────────────────────────────────────────────────────────

test('the type label is the subtype in capitals', () => {
    assert.equal(attachmentTypeLabel('application/pdf'), 'PDF')
    assert.equal(attachmentTypeLabel('application/zip'), 'ZIP')
    assert.equal(attachmentTypeLabel('text/plain; charset=utf-8'), 'PLAIN')
})

test('the fallback MIME of both servers produces no label at all', () => {
    // `application/octet-stream` is what Buzz and Blossom answer for anything they could
    // not sniff (both measured). Printing `OCTET-STREAM` would name an implementation
    // detail; the card then shows its size alone.
    assert.equal(attachmentTypeLabel('application/octet-stream'), '')
    assert.equal(attachmentTypeLabel(''), '')
})

test('vendor and structured-suffix noise is stripped', () => {
    assert.equal(attachmentTypeLabel('application/x-tar'), 'TAR')
    assert.equal(attachmentTypeLabel('image/svg+xml'), 'SVG')
})

// ── fileCardLabels ─────────────────────────────────────────────────────────────────

test('the card is labelled from the imeta file name, not from the url', () => {
    // Both servers name the blob after its content hash — measured: a 193-byte PDF comes
    // back as `…/media/794abaa4….pdf`. That is a checksum, not a file name.
    const labels = fileCardLabels('https://relay.test/media/794abaa4f6f06fc5.pdf', info({ name: 'Protokoll.pdf', size: 193 }))
    assert.equal(labels.name, 'Protokoll.pdf')
    assert.equal(labels.detail, 'PDF · 193 B')
})

test('without a file name the last path segment carries the label', () => {
    const labels = fileCardLabels('https://example.org/reports/jahresbericht.pdf', info({ name: '' }))
    assert.equal(labels.name, 'jahresbericht.pdf')
})

test('a percent-encoded segment is decoded for display', () => {
    const labels = fileCardLabels('https://example.org/Gesch%C3%A4ftsbericht.pdf', info({ name: '' }))
    assert.equal(labels.name, 'Geschäftsbericht.pdf')
})

test('a card never ends up without a name', () => {
    const labels = fileCardLabels('https://example.org/', info({ name: '' }))
    assert.notEqual(labels.name, '')
})

test('the detail line drops the parts it does not know', () => {
    assert.equal(fileCardLabels('https://relay.test/a', info({ mime: 'application/octet-stream', size: 0 })).detail, '')
    assert.equal(fileCardLabels('https://relay.test/a', info({ mime: 'application/octet-stream', size: 2048 })).detail, '2 KB')
    assert.equal(fileCardLabels('https://relay.test/a', info({ mime: 'application/zip', size: 0 })).detail, 'ZIP')
})
