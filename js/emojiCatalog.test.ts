/**
 * The picker catalogue against the REAL emojibase files (`node --test`), not a fixture:
 * the regression this guards came from a data update, so the data is the input.
 *   node --test --experimental-strip-types packages/einundzwanzig-group/js/emojiCatalog.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import {
    buildEmojiGroups,
    hexcodesNewerThan,
    MAX_EMOJI_VERSION,
    searchEmojis,
    type CompactEmoji,
    type EmojiMessages,
    type EmojiVersions,
} from './emojiCatalog.ts'

const require = createRequire(import.meta.url)
const readJson = <T>(path: string): T => JSON.parse(readFileSync(require.resolve(path), 'utf8')) as T

const compact = readJson<CompactEmoji[]>('emojibase-data/de/compact.json')
const messages = readJson<EmojiMessages>('emojibase-data/de/messages.json')
const versions = readJson<EmojiVersions>('emojibase-data/versions/emoji.json')

/** 🫫 U+1FAEB, the tofu box reported from the release APK (smileys position 12). */
const CRACKING_FACE = String.fromCodePoint(0x1faeb)

const allUnicode = (groups: ReturnType<typeof buildEmojiGroups>): Set<string> =>
    new Set(groups.flatMap((g) => g.emojis.map((e) => e.u)))

test('CONTROL: the data really contains emoji newer than the picker limit, U+1FAEB among them', () => {
    const tooNew = hexcodesNewerThan(versions, MAX_EMOJI_VERSION)
    assert.ok(tooNew.has('1FAEB'), 'U+1FAEB is not newer than the limit in this data — the test would measure nothing')
    assert.ok(compact.some((e) => tooNew.has(e.hexcode)), 'compact.json carries no too-new emoji — the test would measure nothing')
    // Without the limit the same builder does offer it — the filter is what removes it.
    assert.ok(allUnicode(buildEmojiGroups(compact, messages, versions, Infinity)).has(CRACKING_FACE))
})

test('no emoji newer than the limit is in the picker groups (U+1FAEB in particular)', () => {
    const groups = buildEmojiGroups(compact, messages, versions)
    const tooNew = hexcodesNewerThan(versions, MAX_EMOJI_VERSION)
    const offered = new Set(groups.flatMap((g) => g.emojis.map((e) => e.u)))
    const leaked = compact.filter((e) => tooNew.has(e.hexcode) && offered.has(e.unicode)).map((e) => e.hexcode)
    assert.deepEqual(leaked, [])
    assert.equal(offered.has(CRACKING_FACE), false)
})

test('a search for "gesicht" (its German label word) does not return U+1FAEB, but does return faces', () => {
    const groups = buildEmojiGroups(compact, messages, versions)
    const hits = searchEmojis('gesicht', groups, [], 10_000).map((e) => ('u' in e ? e.u : ''))
    assert.ok(hits.length > 50, `the search found only ${hits.length} faces — it measures nothing`)
    assert.equal(hits.includes(CRACKING_FACE), false)
})

test('the v18 tag-casing fix holds: a lowercased query matches a capitalised CLDR tag', () => {
    const groups = buildEmojiGroups(compact, messages, versions)
    assert.ok(compact.some((e) => (e.tags ?? []).includes('Liebe')), 'no capitalised "Liebe" tag in the data — control')
    assert.ok(searchEmojis('liebe', groups, [], 10_000).length >= 30)
})
