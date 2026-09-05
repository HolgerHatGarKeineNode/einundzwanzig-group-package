/**
 * **Pure tests for the upload policy — the sentence and the refusal, per target.**
 *
 *   node --test --experimental-strip-types packages/einundzwanzig-group/js/attachmentPolicy.test.ts
 *
 * The module encodes a measurement (`p5-endpunkt-messungen.md`): Buzz refuses `audio/*`
 * and executables outright, the association's Blossom has no MIME allowlist at all. The
 * cases below fix the DIRECTION of every rule — for each refusal the neighbouring
 * acceptance, and the same file against the other target. A policy that refused
 * everything would satisfy a one-sided test and break the feature.
 *
 * Note on what is deliberately NOT asserted: that an MP4 with embedded metadata is
 * refused. It is not — and must not be. Whether an MP4 is metadata-free is a walk over
 * its box tree, which only the relay can do; the browser refuses only what is certain to
 * fail. See the module header of `attachmentPolicy.ts` for the direction and its reason.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BLOSSOM_MAX_BYTES, attachmentNoteFor, checkAttachment, type UploadCandidate } from './attachmentPolicy.ts'

const file = (over: Partial<UploadCandidate> = {}): UploadCandidate => ({
    type: 'application/pdf',
    size: 1024,
    name: 'protokoll.pdf',
    ...over,
})

// ── checkAttachment, target buzz ───────────────────────────────────────────────────

test('Buzz: audio is refused before a byte leaves the browser', () => {
    // Measured: HTTP 415 `disallowed content type: audio/mpeg`. The refusal is compiled
    // into the relay (`validation.rs:200-206`) and cannot be configured away, so turning
    // it into a sentence up front costs nothing and saves a technical status code.
    const verdict = checkAttachment(file({ type: 'audio/mpeg', name: 'sprachnachricht.mp3' }), 'buzz')
    assert.equal(verdict.ok, false)
    assert.match(verdict.ok === false ? verdict.reason : '', /Audiodateien/)
})

test('Buzz: every audio subtype is refused, not just mpeg', () => {
    for (const type of ['audio/mp4', 'audio/ogg', 'audio/webm', 'AUDIO/WAV']) {
        assert.equal(checkAttachment(file({ type }), 'buzz').ok, false, type)
    }
})

test('Buzz: executables and active content are refused', () => {
    for (const type of ['application/x-executable', 'application/x-msdownload', 'text/javascript', 'application/vnd.android.package-archive']) {
        const verdict = checkAttachment(file({ type }), 'buzz')
        assert.equal(verdict.ok, false, type)
        assert.match(verdict.ok === false ? verdict.reason : '', /Programme/)
    }
})

test('Buzz: documents, archives, images and video pass the pre-check', () => {
    // The other direction, and the one that matters: a policy that refused everything
    // would pass every case above and would have broken the whole phase.
    for (const type of ['application/pdf', 'application/zip', 'image/png', 'video/mp4', 'text/plain']) {
        assert.equal(checkAttachment(file({ type }), 'buzz').ok, true, type)
    }
})

test('Buzz: an MP4 is NOT pre-judged on its metadata', () => {
    // The browser cannot walk an MP4 box tree, and the relay's 422 is a normal answer,
    // not a fault. Refusing video here would refuse the files Buzz does take.
    assert.equal(checkAttachment(file({ type: 'video/mp4', size: 50 * 1024 * 1024 }), 'buzz').ok, true)
})

test('Buzz: an unknown or empty MIME is passed on, not refused', () => {
    // `File.type` is a hint and is regularly empty. Buzz decides from the bytes and
    // stores an unrecognisable file as `application/octet-stream` — measured. A browser
    // guessing wrong here would block a file the relay accepts, and the user could not
    // argue with it.
    assert.equal(checkAttachment(file({ type: '' }), 'buzz').ok, true)
    assert.equal(checkAttachment(file({ type: 'application/x-something-new' }), 'buzz').ok, true)
})

test('Buzz: a MIME with parameters is judged on its type/subtype', () => {
    assert.equal(checkAttachment(file({ type: 'audio/mpeg; codecs="mp3"' }), 'buzz').ok, false)
    assert.equal(checkAttachment(file({ type: 'TEXT/PLAIN; charset=utf-8' }), 'buzz').ok, true)
})

// ── checkAttachment, target blossom ────────────────────────────────────────────────

test('Blossom: the same audio file that Buzz refuses goes through', () => {
    // This IS the difference the note in the composer exists for. Blossom has no MIME
    // allowlist (`blossom-members/main.go:203-219` checks size, membership, quota — and
    // nothing else); measured against a locally built copy of that source.
    assert.equal(checkAttachment(file({ type: 'audio/mpeg' }), 'blossom').ok, true)
    assert.equal(checkAttachment(file({ type: 'application/x-executable' }), 'blossom').ok, true)
})

test('Blossom: the size ceiling is the only refusal, and it is at 1 GiB', () => {
    assert.equal(checkAttachment(file({ size: BLOSSOM_MAX_BYTES }), 'blossom').ok, true)
    const verdict = checkAttachment(file({ size: BLOSSOM_MAX_BYTES + 1 }), 'blossom')
    assert.equal(verdict.ok, false)
    assert.match(verdict.ok === false ? verdict.reason : '', /1 GB/)
})

test('Buzz is not given a size ceiling of its own', () => {
    // Its caps are configuration (`max_file_bytes`, `max_video_bytes`), so a number here
    // would be a claim about a server this client never reads. The relay answers 413.
    assert.equal(checkAttachment(file({ size: BLOSSOM_MAX_BYTES * 4 }), 'buzz').ok, true)
})

// ── attachmentNoteFor ──────────────────────────────────────────────────────────────

test('the two targets get two different sentences', () => {
    assert.notEqual(attachmentNoteFor('buzz'), attachmentNoteFor('blossom'))
})

test('the Buzz sentence names the three things that separate it from Blossom', () => {
    const note = attachmentNoteFor('buzz')
    assert.match(note, /MP4/)
    assert.match(note, /Metadaten/)
    assert.match(note, /Audiodateien/)
})

test('the Blossom sentence states the ceiling and claims nothing about file kinds', () => {
    // The wording was narrowed after the review: the 1 GB is a compiled-in constant of
    // the source, but "any file type" rested on a locally built stand-in for the
    // production service. Every measured statement stays, the unmeasured one goes.
    const note = attachmentNoteFor('blossom')
    assert.match(note, /1 GB/)
    assert.doesNotMatch(note, /Dateiart/)
})
