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
 * ── A call needs no parentheses, and that hole was measured ─────────────────
 *
 * The first version of this scanner asked for `\bNAME\s*\(` — a name **followed by a
 * bracket**. The review put one line back into the member menu, outside every comment
 * block:
 *
 *     <flux:menu.item icon="user-minus" x-on:click="removeMember">{{ __('Entfernen') }}</flux:menu.item>
 *
 * and all six cases of `moderationSurfaceGate.test.ts` stayed green. The button works:
 * Alpine calls an expression that evaluates to a function, brackets or not. Read in the
 * build this project actually ships — Alpine 3.15.12, bundled inside Livewire at
 * `vendor/livewire/livewire/dist/livewire.esm.js`, **not** in a `node_modules/alpinejs`
 * (there is none: Alpine comes with Livewire here):
 *
 *   - `:3993` — the `x-on` directive evaluates with `{ scope: { "$event": e }, params: [e] }`
 *   - `:1871` — the evaluator hands its result to `runIfTypeOfFunction`
 *   - `:1881` — `if (shouldAutoEvaluateFunctions && typeof value === "function")`
 *     → `value.apply(scope2, params)`
 *   - `:1791` — `var shouldAutoEvaluateFunctions = true`, the default
 *
 * So `x-on:click="removeMember"` calls `removeMember(clickEvent)`.
 *
 * **Why exactly the two removal handlers slipped through and the ban handlers would not:**
 * `banMember` and `askBanAuthor` are covered a second time by {@link showsLabel}
 * (`__('Bannen')`, `__('Autor bannen')`). `removeMember` and `kickRoomMember` carry
 * `__('Entfernen')`, and that label rightly is **not** on the forbidden list — it also
 * belongs to the message-removal button, which stays operable. Both safeguards together
 * therefore let those two names pass in an ordinary Alpine shorthand.
 *
 * {@link callsHandler} now asks two questions: the bracketed call anywhere in the active
 * markup, **or** the bare name inside the value of an `x-on:…` / `@…` attribute. The
 * second one also covers the shorthand's relatives (`@click.prevent`, a ternary, a `&&`),
 * because Alpine auto-calls whatever the whole expression evaluates to.
 *
 * ── What the scanner cannot do ──────────────────────────────────────────────
 *
 * It reads text, not a tree — Blade is not JavaScript and the AST scanner of
 * `workspaceQuelleGate.ts` cannot see it. A handler reached through a computed name
 * (`this[action](m)`) would pass. That is a deliberate circumvention, not the quiet
 * repetition of a pattern, and this latch is built against the second.
 *
 * The one construct it does understand is the Blade comment `{{-- … --}}`, because that is
 * what the disabled sites are wrapped in — **six comment blocks holding seven elements,
 * across four files** (member menu: two entries · report queue · room member list ·
 * ban-author modal · room action sheet · chat-row menu). Blade itself does not nest those
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

/**
 * The value of every `x-on:…` / `@…` attribute in the active markup.
 *
 * Both quote styles: only double quotes occur in this tree today (318 `x-on:click` against
 * 0 single-quoted event attributes, counted 2026-09-03), but the rule has to survive the
 * next hand, not describe the current one. Modifiers ride along in the attribute name
 * (`@click.prevent`, `x-on:keydown.escape.window`).
 */
const eventExpressions = (source: BladeSource): string[] => {
    const pattern = /(?:x-on:|@)[A-Za-z][\w:.-]*\s*=\s*(?:"([^"]*)"|'([^']*)')/g
    const values: string[] = []
    for (const match of source.active.matchAll(pattern)) {
        values.push(match[1] ?? match[2] ?? '')
    }

    return values
}

/**
 * Does the active markup run `name` on an event?
 *
 * Two questions, because **a call needs no parentheses** (see the module header, with the
 * lines in our own Alpine build):
 *
 *  1. `NAME(` anywhere in the active markup — the ordinary call.
 *  2. `NAME` as a bare identifier inside an `x-on:…` / `@…` expression — the shorthand
 *     Alpine auto-calls with the click event.
 *
 * Word-bounded in both: `unbanMember` is not `banMember`, and lifting a restriction has to
 * stay reachable.
 */
export const callsHandler = (source: BladeSource, name: string): boolean => {
    const bounded = new RegExp(`\\b${name}\\b`)

    return new RegExp(`\\b${name}\\s*\\(`).test(source.active)
        || eventExpressions(source).some((expression) => bounded.test(expression))
}

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
