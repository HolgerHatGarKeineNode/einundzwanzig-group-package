/**
 * Scanner for the P4 latch: **is there an operable "remove member" or "ban member"
 * anywhere in the markup?**
 *
 * Runs inside `npm run test:unit` through `moderationSurfaceGate.test.ts`:
 *   node --test --experimental-strip-types packages/einundzwanzig-group/js/moderationSurfaceGate.test.ts
 *
 * Plan: `docs/plans/2026-09-03T1915-buzz-kind-ernte.md`, phase P4, step 1.
 *
 * ── What it guards, and why a latch rather than a comment ───────────────────
 *
 * The association does not remove or ban its members (decision 2026-09-03); the timed
 * suspension is the strongest measure the client offers. That decision has now been made
 * twice, because the first time it was carried out at one markup site and the reason was
 * never written down — a screenshot showing two live entries in the member menu is what
 * re-opened it. Comments alone are what failed here. This scanner is the part that
 * notices.
 *
 * ── Why the handler NAME and not the label ──────────────────────────────────
 *
 * `__('Entfernen')` still labels a button that must keep working: removing a single
 * foreign **message** (`admin-delete-message`). It hits content, not a person, and is
 * deliberately untouched. The label is therefore not the subject; the click handler is.
 * `banMember(`, `removeMember(`, `kickRoomMember(`, `askBanAuthor(`, `confirmBanAuthor(`
 * and `banReportedUser(` each name exactly one action against a person.
 *
 * The two labels that carry no other meaning — `__('Bannen')` and `__('Autor bannen')` —
 * are checked too, so a hand-rolled `<button>` without one of those handlers would still
 * be seen.
 *
 * ── Word boundaries, because one name contains another ──────────────────────
 *
 * `unbanMember(` **contains** `banMember(`. Lifting a ban has to stay reachable (existing
 * suspensions must be liftable), so a substring match would report a violation on the
 * very button the phase keeps. Every needle is matched as a regular expression with `\b`
 * in front of it.
 *
 * ── What the scanner cannot do ──────────────────────────────────────────────
 *
 * It reads text, not a tree — Blade is not JavaScript and the AST scanner of
 * `workspaceQuelleGate.ts` cannot see it. A handler reached through a computed name
 * (`this[action](m)`) would pass. That is a deliberate circumvention, not the quiet
 * repetition of a pattern, and this latch is built against the second.
 *
 * The one construct it does understand is the Blade comment `{{-- … --}}`, because that
 * is what the four disabled sites are wrapped in. Blade itself does not nest those
 * comments (its compiler uses the same non-greedy match), so neither does this.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Blade comments removed — the same expression Blade's own compiler uses
 * (`/\{\{--(.*?)--\}\}/s`), so what remains here is what the compiler would emit.
 */
export const stripBladeComments = (source: string): string => source.replace(/\{\{--[\s\S]*?--\}\}/g, '')

/** A file with its markup as the compiler would see it. */
export type BladeSource = { file: string; active: string }

/**
 * Read one Blade file and hand back its **active** markup — **throwing** when there is
 * nothing to measure.
 *
 * Fail-closed for the reason every scanner in this package is: a probe that reports
 * "nothing found" because it read nothing looks exactly like a clean tree.
 */
export const readBlade = (path: string, file: string): BladeSource => {
    const raw = readFileSync(path, 'utf8')
    if (raw.trim() === '') {
        throw new Error(`${file}: empty — the scanner measures nothing here.`)
    }
    const active = stripBladeComments(raw)
    if (active.trim() === '') {
        throw new Error(`${file}: only comments left after stripping — the scanner measures nothing here.`)
    }

    return { file, active }
}

/**
 * Lower bound of Blade files the sweep must see.
 *
 * **Measured 2026-09-03: 76 files** under `resources/views`. The threshold sits at 50: it
 * is meant to catch a walker that lost the tree, not the next new screen.
 */
export const MIN_BLADE_FILES = 50

/** Every Blade file under `resources/views`, recursively, sorted — **throwing** when too few. */
export const collectBlades = (root: string): string[] => {
    const walk = (dir: string): string[] =>
        readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
            const path = join(dir, entry.name)
            if (entry.isDirectory()) {
                return walk(path)
            }

            return entry.isFile() && entry.name.endsWith('.blade.php') ? [path] : []
        })

    const files = walk(root).sort()
    if (files.length < MIN_BLADE_FILES) {
        throw new Error(
            `The scanner sees only ${files.length} Blade files under ${root} (at least ${MIN_BLADE_FILES} expected). `
                + 'It is not measuring what it is meant to measure.',
        )
    }

    return files
}

/** Does the active markup call `name(`? Word-bounded — `unbanMember(` is not `banMember(`. */
export const callsHandler = (source: BladeSource, name: string): boolean =>
    new RegExp(`\\b${name}\\s*\\(`).test(source.active)

/**
 * All runs of whitespace collapsed to one space.
 *
 * For any claim about a SENTENCE in the source. Comments are line-wrapped, so a phrase
 * spanning two lines has a newline and indentation in the middle of it and a plain
 * `includes` misses it — the documented way a source-text test goes red for its own
 * blindness rather than for the change it was meant to catch.
 */
export const flattenWhitespace = (source: string): string => source.replace(/\s+/g, ' ')

/** Does the active markup carry the translated label `__('…')`? */
export const showsLabel = (source: BladeSource, label: string): boolean =>
    source.active.includes(`__('${label}')`)
