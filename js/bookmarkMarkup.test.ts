/**
 * **The latch between the rule and the two remove buttons on the bookmark screen.**
 *   node --test --experimental-strip-types packages/einundzwanzig-group/js/bookmarkMarkup.test.ts
 *
 * ── The defect this was written for (review finding P2/1, 2026-09-03) ───────
 *
 * The screen renders two kinds of row, and each one carries a remove button: messages
 * (`e`) at the top, everything else (`a`/`t`/`r`) below. The link row asked
 * `!link.set` from the start, the message row did not — so a message that lives only in
 * somebody else's 30003 set showed an armed remove button. A click rewrote our own,
 * possibly empty, 10003, left the foreign set alone, left the row standing, and still
 * put a signed event on the wire. `bookmarkModels.test.ts` now proves that such a write
 * produces no event body; **it cannot prove that the button is gone**, and a button that
 * does nothing is its own defect.
 *
 * Two nearly identical places drifting apart is exactly what happened once, so the fix
 * is not "add the missing condition" but "make it one condition": both buttons ask
 * `$store.bookmarks.canRemove(…)`. This file is what keeps them there.
 *
 * ── Why a source probe, and why it throws ───────────────────────────────────
 *
 * Blade is not JavaScript, so the AST scanner of `bookmarkVerdrahtung.test.ts` cannot
 * see it, and the store itself is not loadable under `node --test`. Bauform therefore as
 * in `medienProfilMarkup.test.ts`: **a probe that cannot find its subject THROWS.** One
 * that reports "not found" would be fail-open and would look like a passing test after
 * the next rename.
 *
 * The anchors are `data-bookmark-remove="entry"` and `…="link"` and not the button text:
 * both buttons carry the same `aria-label`, so a text anchor would measure whichever
 * came first.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const VIEW = join(import.meta.dirname, '..', 'resources', 'views', '⚡bookmarks.blade.php')

/** Source of the screen — **throwing** on a missing or empty file. */
const lies = (): string => {
    const raw = readFileSync(VIEW, 'utf8')
    if (raw.trim() === '') {
        throw new Error(`${VIEW} is empty — the probe measures nothing.`)
    }

    return raw
}

/**
 * The one element carrying `data-bookmark-remove="<which>"` — **throwing**.
 *
 * Cut from the anchor back to the opening `<flux:button` and forward to the closing
 * `/>`, so the attributes of the neighbouring rows cannot leak into the match. The
 * attribute is searched **with its value**: a bare name would also hit
 * `data-bookmark-removex` and report "found" while the subject is gone.
 */
const removeButton = (which: string): string => {
    const source = lies()
    const anchor = `data-bookmark-remove="${which}"`
    const at = source.indexOf(anchor)
    if (at < 0) {
        throw new Error(`${anchor} is no longer in ⚡bookmarks.blade.php — the probe measures nothing.`)
    }
    if (source.indexOf(anchor, at + 1) >= 0) {
        throw new Error(`${anchor} appears twice — the probe cannot tell which row it measures.`)
    }
    const from = source.lastIndexOf('<flux:button', at)
    const to = source.indexOf('/>', at)
    if (from < 0 || to < 0) {
        throw new Error(`${anchor} no longer hangs on a <flux:button …/> — the probe measures nothing.`)
    }

    return source.slice(from, to)
}

test('CALIBRATION: the probe really sees both remove buttons', () => {
    // Without this a broken probe reports the same as a healthy tree. Two independent
    // marks per button: the anchor (found by `removeButton`, which throws otherwise) and
    // an attribute that has nothing to do with the claim under test.
    for (const which of ['entry', 'link']) {
        const button = removeButton(which)
        assert.match(button, /x-bind:disabled="\$store\.bookmarks\.busy"/, `the ${which} button lost its busy binding`)
        assert.match(button, /x-cloak/, `the ${which} button lost its x-cloak`)
    }
})

test('CORE: both remove buttons ask the SAME question — `canRemove`', () => {
    // The fix for the review finding. `canRemove` folds two things the markup used to
    // carry separately: may this user write at all, and is this entry in the list we
    // actually write. An entry from a foreign 30003 set fails the second half.
    assert.match(
        removeButton('entry'),
        /x-show="\$store\.bookmarks\?\.canRemove\(entry\.id\)"/,
        'the message row does not gate its remove button on `canRemove`',
    )
    assert.match(
        removeButton('link'),
        /x-show="\$store\.bookmarks\?\.canRemove\(link\.value\)"/,
        'the link row does not gate its remove button on `canRemove`',
    )
})

test('… and neither of them falls back to the bare write permission', () => {
    // This is the shape of the bug, stated so it cannot come back by a different route:
    // `canBookmark` answers "may this user write a bookmark list", which is true for a
    // logged-in member on a resolved space — including for an entry they cannot remove.
    for (const which of ['entry', 'link']) {
        const button = removeButton(which)
        assert.equal(
            /x-show="[^"]*canBookmark/.test(button),
            false,
            `the ${which} button is back on the bare write permission — that was the defect`,
        )
    }
})

test('both buttons still act through `toggle`, on the value of their own row', () => {
    // Otherwise the two could agree on the condition and disagree on the subject — the
    // link row removing an entry id, or vice versa.
    assert.match(removeButton('entry'), /x-on:click="\$store\.bookmarks\.toggle\(entry\.id\)"/)
    assert.match(removeButton('link'), /x-on:click="\$store\.bookmarks\.toggle\(link\.value\)"/)
})
