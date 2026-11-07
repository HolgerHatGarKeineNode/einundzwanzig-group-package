/**
 * The picker catalogue against the REAL emojibase files (`node --test`), not a fixture:
 * the regression this guards came from a data update, so the data is the input.
 *   node --test --experimental-strip-types packages/einundzwanzig-group/js/emojiCatalog.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import {
    buildEmojiGroups,
    EMOJI_LOCALES,
    emojibaseLocale,
    hexcodesNewerThan,
    labelsByEmoji,
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

// ── Locale ────────────────────────────────────────────────────────────────────

test('locale resolution: app language → emojibase locale', () => {
    const table: [string, string][] = [
        ['de', 'de'], ['en', 'en'], ['es', 'es'], ['hu', 'hu'], ['nl', 'nl'], ['pl', 'pl'], ['pt', 'pt'],
        ['lv', 'en'], // app language without emojibase data
        ['pt-BR', 'pt'], ['pt_BR', 'pt'], ['en-GB', 'en'], ['DE', 'de'], [' es ', 'es'],
        ['fr', 'en'], ['xx-YY', 'en'], ['', 'en'],
    ]
    assert.deepEqual(table.map(([lang]) => [lang, emojibaseLocale(lang)]), table)
})

const groupsFor = (locale: string) =>
    buildEmojiGroups(
        readJson<CompactEmoji[]>(`emojibase-data/${locale}/compact.json`),
        readJson<EmojiMessages>(`emojibase-data/${locale}/messages.json`),
        versions,
    )

test('English data gives English group names and finds "face"', () => {
    const groups = groupsFor('en')
    assert.equal(groups[0]?.name, 'smileys & emotion')
    const hits = searchEmojis('face', groups, [], 10_000).map((e) => ('u' in e ? e.u : ''))
    assert.ok(hits.includes('😀'), '"face" does not find 😀 (grinning face)')
    assert.ok(hits.length > 50)
})

for (const locale of EMOJI_LOCALES) {
    test(`${locale}: no emoji newer than the limit, and lowercased tags match a lowercased query`, () => {
        const list = readJson<CompactEmoji[]>(`emojibase-data/${locale}/compact.json`)
        const groups = groupsFor(locale)
        const tooNew = hexcodesNewerThan(versions, MAX_EMOJI_VERSION)
        const offered = new Set(groups.flatMap((g) => g.emojis.map((e) => e.u)))
        assert.deepEqual(list.filter((e) => tooNew.has(e.hexcode) && offered.has(e.unicode)).map((e) => e.hexcode), [])
        assert.equal(offered.has(CRACKING_FACE), false)
        // Every capitalised tag must still be found by its lowercased form.
        const capitalised = list.find((e) => !tooNew.has(e.hexcode) && (e.tags ?? []).some((t) => t !== t.toLowerCase()))
        if (capitalised) {
            const tag = capitalised.tags!.find((t) => t !== t.toLowerCase())!
            const hits = searchEmojis(tag.toLowerCase(), groups, [], 10_000).map((e) => ('u' in e ? e.u : ''))
            assert.ok(hits.includes(capitalised.unicode), `${locale}: "${tag}" not found by its lowercase form`)
        }
    })
}

test('MRU labels follow the language: same emoji key, current label', () => {
    assert.equal(labelsByEmoji(groupsFor('en')).get('😀'), 'grinning face')
    assert.equal(labelsByEmoji(groupsFor('de')).get('😀'), 'grinsendes Gesicht')
})

/**
 * `loadEmojiGroups` itself cannot run here (Vite `?url` imports + fetch), so its wiring is
 * read from the source: every shipped locale has its own static import pair naming that
 * locale, and the default locale comes from `<html lang>` — not a hardcoded `de`.
 */
test('emoji.ts: one static data import per locale, locale taken from the page', () => {
    const source = readFileSync(join(import.meta.dirname, 'emoji.ts'), 'utf8')
    for (const locale of EMOJI_LOCALES) {
        const line = source.split('\n').find((l) => l.trimStart().startsWith(`${locale}: () =>`))
        assert.ok(line, `no EMOJI_DATA entry for ${locale}`)
        assert.ok(line.includes(`'emojibase-data/${locale}/compact.json?url'`), `${locale} does not load its own compact.json`)
        assert.ok(line.includes(`'emojibase-data/${locale}/messages.json?url'`), `${locale} does not load its own messages.json`)
    }
    assert.match(source, /loadEmojiGroups = \(locale: EmojiLocale = emojibaseLocale\(islandLocale\(\)\)\)/)
})
