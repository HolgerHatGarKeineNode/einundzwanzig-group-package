/**
 * **The latch over the WIRING of the meetup date card — not over its rules.**
 *   node --test --experimental-strip-types packages/einundzwanzig-group/js/calendarWiring.test.ts
 *
 * Plan: `docs/plans/2026-09-05T0125-community-features-herbst.md`, phase P2.
 *
 * ── Why this exists next to `calendarModels.test.ts` ────────────────────────────────
 *
 * That one proves what the client does with an ANSWER. It cannot see whether the
 * question is asked, whether it is asked with an author filter, or whether the island
 * that asks it is registered at all. Every one of those breaks SILENTLY: a card that is
 * never mounted, a query that never goes out and a query that comes back empty are the
 * same thing on screen — a room header without a date. That is exactly what the whole
 * surface looked like before this phase.
 *
 * The chain has five links and each is asserted below:
 *
 *   1. `calendarModels.ts` → the coordinate and the RSVP tags (rules, tested next door)
 *   2. `calendar.ts` → asks the CALENDAR relays with BOTH `authors` and `#a`
 *   3. `calendar.ts` → publishes the RSVP to the same relays
 *   4. `bridge.ts` → `wireMeetupEvent` (without it the `x-data` is never registered)
 *   5. the markup → mounts the island and both RSVP buttons call `rsvp(…)`
 *
 * ── Why AST and not `grep` ──────────────────────────────────────────────────────────
 *
 * Not theoretical here: this file's own header names `wireMeetupEvent`, and the module
 * header of `calendar.ts` names `CALENDAR_AUTHORS`, `nak req` and the author filter in
 * prose, several times, to explain why they exist. A text match would report those
 * explanations as proof. `ts.createSourceFile` sees the tree the compiler sees, and
 * comments are not in it. The scanner is the one from the P6 latch
 * (`workspaceQuelleGate.ts`), the Blade half the reader of the P4 latch
 * (`moderationSurfaceGate.ts`) — reused rather than rebuilt.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { importiertAus, liesDatei, ruftAuf } from './workspaceQuelleGate.ts'
import { flattenWhitespace, readBlade } from './moderationSurfaceGate.ts'

/**
 * The configured author, as the host writes it into the `<head>` before the island boots.
 *
 * This has to happen BEFORE `calendar.ts` is evaluated — `CALENDAR_AUTHORS` is a module
 * constant, read once off `globalThis`, exactly like `BOARD_URL` in `longformFeed.ts`.
 * Hence the dynamic import below instead of a static one: a static import is hoisted
 * above these two lines and the constant would be empty, which is why the filter
 * assertions would then pass against nothing.
 *
 * The value is the measured production key (`npub1mturmyn…`, kind 0 "Einundzwanzig
 * Portal"), so this test also fixes the SHAPE the operator has to configure: 64 hex
 * characters, not an npub.
 */
const PORTAL = 'daf83d92768b5d0005373f83e30d4203c0b747c170449e02fea611a0da125ee6'
;(globalThis as { __nostrCalendarAuthors?: string }).__nostrCalendarAuthors = PORTAL
;(globalThis as { __nostrCalendarRelays?: string }).__nostrCalendarRelays = 'wss://nos.lol'

/**
 * A FRESH evaluation of `calendar.ts`, past the ESM cache.
 *
 * The specifier goes through a variable on purpose: written as a literal,
 * `import('./calendar.ts?x')` is a module path TypeScript tries to resolve and cannot
 * (`TS2307`). The cast restores the type the runtime actually returns. Only this test
 * file does it, and only to read a module constant twice — production code has one
 * evaluation and one configuration.
 */
const freshCalendar = (specifier: string): Promise<typeof import('./calendar.ts')> =>
    import(specifier) as Promise<typeof import('./calendar.ts')>

const { calendarEventFilters, rsvpFilters, calendarConfigured, roomMeetupId, CALENDAR_AUTHORS }
    = await freshCalendar('./calendar.ts')

const JS_DIR = import.meta.dirname
const source = (name: string) => liesDatei(join(JS_DIR, name), name)

const VIEWS = join(JS_DIR, '..', 'resources', 'views')
const room = () => readBlade(join(VIEWS, '⚡room.blade.php'), '⚡room.blade.php')

/**
 * The object literal keys of every `load({...})` call in `file`.
 *
 * The identifier scanner cannot see this: `load({relays: X, …})` and `load({filters})`
 * are the same call to it, and a query that forgot its `relays` would go to the router's
 * defaults — i.e. to the space relay, which has no calendar events at all. That failure
 * is silent and looks exactly like a meetup without dates.
 */
const loadOptionKeys = (file: string): string[][] => {
    const text = readFileSync(join(JS_DIR, file), 'utf8')
    const sourceFile = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)
    if (sourceFile.statements.length === 0) {
        throw new Error(`${file}: not a single statement parsed — the scanner measures nothing here.`)
    }
    const found: string[][] = []
    const walk = (node: ts.Node): void => {
        if (
            ts.isCallExpression(node)
            && ts.isIdentifier(node.expression)
            && node.expression.text === 'load'
            && node.arguments.length === 1
            && ts.isObjectLiteralExpression(node.arguments[0])
        ) {
            found.push(
                node.arguments[0].properties
                    .map((property) => (property.name && ts.isIdentifier(property.name) ? property.name.text : ''))
                    .filter((name) => name !== ''),
            )
        }
        ts.forEachChild(node, walk)
    }
    walk(sourceFile)

    return found
}

/**
 * Lower bound of identifier calls the scanner must see in `calendar.ts`.
 *
 * Calibration, not style: without it a broken scanner reports exactly what a clean tree
 * reports — "does not call `load`" is also true when nothing was read at all. **Measured
 * 2026-09-05: 25 identifier calls** (`f(…)`, never `obj.f(…)`, which is why the number is
 * far smaller than the file length suggests — an island is mostly methods). The threshold
 * sits at 12: it is meant to catch a blind scanner, not the next edit.
 */
const MIN_CALLS_ISLAND = 12

test('CALIBRATION: the scanner really reads the island', () => {
    const f = source('calendar.ts')
    assert.ok(
        f.aufrufe.length >= MIN_CALLS_ISLAND,
        `only ${f.aufrufe.length} calls seen (at least ${MIN_CALLS_ISLAND} expected) — the scanner measures nothing here`,
    )
    // And one call that has nothing to do with the claims below: otherwise a scanner
    // that only ever finds calendar names would report the same count as a healthy one.
    assert.ok(ruftAuf(f, 'formatTimestamp'), 'the scanner does not see the date being formatted')
})

test('CALIBRATION: the Blade reader really reads the room screen', () => {
    const markup = flattenWhitespace(room().active)
    assert.ok(markup.includes('x-data="nostrRoomChat('), 'the chat island is gone — the reader measures nothing here')
    assert.ok(markup.includes('$store.roomPins'), 'the pin bar is gone — the reader measures nothing here')
})

// ── CORE 1: the query goes to the calendar relays, with the author filter ───────────

test('CORE 0: the two config values arrive at the island as read, hex only', () => {
    // The chain from `config/group.php` via `partials/head.blade.php` to the module
    // constant is the one link no unit test can see and no type can catch — an `npub1…`
    // in the variable matches no event at all, and "matches nothing" reads exactly like
    // "this meetup has no dates".
    assert.ok(calendarConfigured(), 'relays or authors did not reach the island')
    assert.deepEqual(CALENDAR_AUTHORS, [PORTAL])
})

test('CORE 1: the date query carries `authors` AND `#a` — the coordinate alone is not a filter', () => {
    // The `a` tag is a claim, not a capability: measured on 2026-09-05 a plain
    // `nak req -k 31923 -l 100 wss://nos.lol` returned 100 events from 16 authors. This
    // is the assertion the mutation probe removes.
    const filters = calendarEventFilters('359')
    assert.equal(filters.length, 1, 'no filter built — is NOSTR_CALENDAR_AUTHORS reaching the island?')
    assert.ok(Array.isArray(filters[0].authors) && filters[0].authors.length > 0, 'the author filter is gone')
    assert.deepEqual(filters[0].kinds, [31923])
    assert.ok((filters[0]['#a'] ?? []).every((address) => address.startsWith('31924:')), 'the `a` filter is not a calendar coordinate')
    for (const author of filters[0].authors ?? []) {
        assert.ok(
            (filters[0]['#a'] ?? []).some((address) => address.includes(author)),
            'a configured author has no coordinate — its dates would be unfindable',
        )
    }
})

test('CORE 1b: without configured authors NOTHING is asked — no unfiltered fallback', async () => {
    // The dangerous shape would be "if no authors, drop the `authors` key and ask
    // anyway": that renders whatever a stranger points at the room. This is measured on
    // a SECOND evaluation of the module with the global cleared — the query string
    // defeats the ESM cache, which is the only way to see a module constant read twice.
    ;(globalThis as { __nostrCalendarAuthors?: string }).__nostrCalendarAuthors = ''
    try {
        const unconfigured = await freshCalendar('./calendar.ts?without-authors')
        assert.deepEqual(unconfigured.CALENDAR_AUTHORS, [], 'the second evaluation still saw the author')
        assert.equal(unconfigured.calendarConfigured(), false)
        assert.deepEqual(unconfigured.calendarEventFilters('359'), [], 'a query went out without an author filter')
    } finally {
        ;(globalThis as { __nostrCalendarAuthors?: string }).__nostrCalendarAuthors = PORTAL
    }
})

test('CORE 1b2: a room with no meetup binding asks nothing either', () => {
    assert.deepEqual(calendarEventFilters(''), [])
})

test('CORE 1c: … and the RSVP query is deliberately NOT author-filtered', () => {
    const filters = rsvpFilters('31923:x:meetup-event-1')
    assert.equal(filters.length, 1)
    assert.deepEqual(filters[0].kinds, [31925])
    assert.equal(filters[0].authors, undefined, 'an RSVP is everyone\'s to write — filtering it counts nobody')
    assert.deepEqual(rsvpFilters(''), [], 'no address, no query')
})

test('CORE 2: every relay query names its relays explicitly', () => {
    // Without `relays` the router answers with its defaults — the SPACE relay, which
    // holds no calendar events at all. Silent, and indistinguishable from "no dates".
    const calls = loadOptionKeys('calendar.ts')
    assert.ok(calls.length >= 2, `only ${calls.length} load(…) calls seen — dates and RSVPs are two`)
    for (const keys of calls) {
        assert.ok(keys.includes('relays'), `a load(…) without \`relays\`: ${keys.join(',')}`)
        assert.ok(keys.includes('filters'), `a load(…) without \`filters\`: ${keys.join(',')}`)
    }
    const f = source('calendar.ts')
    assert.ok(importiertAus(f, 'load', './welshmanNet.ts'), 'the app-bound loader is gone — the free one throws')
})

// ── CORE 3: the RSVP is published, and through the rollback path ────────────────────

test('CORE 3: the island publishes its RSVP through `publishSpreadOptimistic`', () => {
    const f = source('calendar.ts')
    // The SPREAD variant, not the flat one, and that is the assertion: the flat
    // `publishOptimistic` reports a partial result as a failure, and `calendar.ts` writes
    // to several relays where the partial result is the ordinary case.
    assert.ok(importiertAus(f, 'publishSpreadOptimistic', './publishOptimistic.ts'), 'the publish path is gone')
    assert.ok(ruftAuf(f, 'publishSpreadOptimistic'), '… and is never called: the button would do nothing')
    assert.equal(
        ruftAuf(f, 'publishOptimistic'),
        false,
        'back on the flat variant — a partial result would be reported as a failure and rolled back',
    )
    // The tags are the pure module's business, not this file's — one place decides.
    assert.ok(importiertAus(f, 'makeRsvpTags', './calendarModels.ts'))
    assert.ok(ruftAuf(f, 'makeRsvpTags'))
})

test('CORE 3d: the reading-side author check goes through the pure function', () => {
    // Not a style point. The filter that goes out and the check on the way back are two
    // halves of the same promise, and with both in place removing either one leaves every
    // test green (measured: only removing BOTH turns the E2E red). Routing the second
    // half through `keepOwnAuthors` makes it falsifiable on its own —
    // `calendarModels.test.ts` does that.
    const f = source('calendar.ts')
    assert.ok(importiertAus(f, 'keepOwnAuthors', './calendarModels.ts'), 'the reading-side check is gone')
    assert.ok(ruftAuf(f, 'keepOwnAuthors'))
})

test('CORE 3e: the date is rendered in a NAMED time zone', () => {
    // A meetup happens in one place at one o'clock. Without `usableTimeZone` the house
    // formatter converts into the reader's zone and, on an unusable `start_tzid`, falls
    // back to local time silently — measured: the Indianapolis meetup starting 19:00
    // local rendered as "Do., 17. Sept., 01:00" with nothing saying which clock that was.
    const f = source('calendar.ts')
    assert.ok(importiertAus(f, 'usableTimeZone', './calendarModels.ts'), 'the zone check is gone')
    assert.ok(ruftAuf(f, 'usableTimeZone'))
})

test('CORE 3b: the join is built, not guessed', () => {
    const f = source('calendar.ts')
    assert.ok(importiertAus(f, 'meetupCalendarAddress', './calendarModels.ts'))
    assert.ok(ruftAuf(f, 'meetupCalendarAddress'))
    // Both marker shapes: `["i","meetup:<id>"]` on zooid, `about` prefix on Buzz. Losing
    // the second one makes the card silently dead on every Buzz workspace.
    assert.ok(importiertAus(f, 'parseMeetupTags', './meetupPresentation.ts'))
    assert.ok(ruftAuf(f, 'parseMeetupTags'))
    assert.ok(importiertAus(f, 'parseAboutMarker', './roomAbout.ts'), 'the Buzz fallback marker is gone')
    assert.ok(ruftAuf(f, 'parseAboutMarker'))
})

test('CORE 3c: the HTTP source is still reached — it is the fallback, not a leftover', () => {
    const f = source('calendar.ts')
    assert.ok(importiertAus(f, 'getMeetupPresentation', './meetups.ts'))
    assert.ok(ruftAuf(f, 'getMeetupPresentation'))
    assert.ok(ruftAuf(f, 'loadMeetupPresentations'), 'the portal list is never fetched — the fallback is empty')
})

// ── CORE 4: registration ───────────────────────────────────────────────────────────

test('CORE 3f: the rollback goes through the pure rule, not through an inline `if`', () => {
    /*
     * This assertion lives in the CALENDAR latch although it is about
     * `publishOptimistic.ts`, and that is deliberate: the calendar is the only caller
     * that writes to several relays, so it is the only one for which "rolled back" and
     * "went wrong" come apart at all. The other 16 callers use one relay, where the two
     * are the same question.
     *
     * It exists because the mutation probe found the gap: changing the condition back to
     * `if (outcome.error)` — the shape that deletes an event a relay is holding — left
     * EVERY test in this repository green. The pure rule has its own cases in
     * `publishResult.test.ts`; this is the half that says it is actually called.
     */
    const f = source('publishOptimistic.ts')
    assert.ok(
        importiertAus(f, 'rollBackAfterPublish', './publishResult.ts'),
        'the rollback rule is inlined again — a partial publish would be deleted locally',
    )
    assert.ok(ruftAuf(f, 'rollBackAfterPublish'), '… and it is never called')
})

test('CORE 4: the island is registered — an unregistered `x-data` renders nothing', () => {
    const f = source('bridge.ts')
    assert.ok(importiertAus(f, 'wireMeetupEvent', './calendar.ts'), 'bridge.ts does not import the island')
    assert.ok(ruftAuf(f, 'wireMeetupEvent'), '… and never wires it into `registerNostrComponents`')
})

// ── CORE 5: the markup ─────────────────────────────────────────────────────────────

test('CORE 5: the room mounts the card and both buttons answer', () => {
    const markup = flattenWhitespace(room().active)
    assert.ok(markup.includes('x-data="nostrMeetupEvent('), 'the date card is not mounted')
    assert.ok(markup.includes("rsvp('accepted')"), 'the accept button does not answer')
    assert.ok(markup.includes("rsvp('declined')"), 'the decline button does not answer')
    // The three states are what makes the fallback visible instead of looking broken.
    assert.ok(markup.includes("source === 'http'"), 'the fallback state is not rendered as such')
    assert.ok(markup.includes("source === 'nostr'"), 'the attendance count is not gated on the signed date')
})

test('CORE 5c: the time zone is printed, always — an unlabelled time is the defect', () => {
    const markup = flattenWhitespace(room().active)
    assert.ok(markup.includes('x-text="dateZone"'), 'the date carries no zone label')
    assert.ok(markup.includes('x-text="dateLabel"'), 'the date itself is gone')
})

test('CORE 5d: the card says what pressing the button does — and what the count is worth', () => {
    // Everything the operator documentation lays out (`config/group.php`, `.env.example`)
    // is read by whoever RUNS this; the person who actually enters into it read it
    // nowhere. The sentence carries both halves: a signed, public, permanent event on
    // third-party relays that declining replaces rather than recalls, and a counter that
    // counts signatures rather than people.
    const markup = flattenWhitespace(room().active)
    assert.ok(
        markup.includes('data-testid="meetup-event-disclosure"'),
        'the RSVP has no disclosure next to it',
    )
    assert.ok(markup.includes('signiertes, öffentliches Ereignis'), 'the disclosure does not say it is public')
    assert.ok(markup.includes('zählt Signaturen, nicht Personen'), 'the disclosure does not qualify the counter')
})

test('CORE 5e: a partial publish has its OWN line, separate from the error', () => {
    // The measured case: one relay took the RSVP, the other timed out. Rendering that as
    // an error would be a lie about a write that happened and is public.
    const markup = flattenWhitespace(room().active)
    assert.ok(markup.includes('x-text="partialLabel()"'), 'a partial result has no line of its own')
    assert.ok(markup.includes('x-if="partial"'), 'the partial line is not gated on a partial result')
    assert.ok(markup.includes('x-if="error"'), 'the error line is gone')
    assert.ok(markup.includes('variant="warning"'), 'the partial result is not distinguished from an error')
})

test('CORE 5b: the card is NOT gated on `room.isMeetup` — that flag is false on Buzz', () => {
    // `RoomView.isMeetup` comes from the 39000's own tags. Buzz builds the 39000 itself
    // and drops foreign markers, so the marker lives in `about` there. A markup gate on
    // that flag would switch the whole surface off for every Buzz workspace, silently.
    const markup = flattenWhitespace(room().active)
    const mount = markup.slice(markup.indexOf('x-data="nostrMeetupEvent('))
    const cardBlock = mount.slice(0, mount.indexOf('</div>'))
    assert.equal(cardBlock.includes('isMeetup'), false, 'the card gates on isMeetup — dead on Buzz')
})

test('COUNTER-PROOF: the scanner does NOT see a name that only stands in a comment', () => {
    // Without this case every assertion above would also pass on a scanner that cannot
    // tell code from prose — and then it would pass on an island that merely *mentions*
    // the publish. `calendar.ts` names `pickNextCalendarEvent` in code and
    // `leseRelayListe` (the STRICT reader) only in its header, as the thing it
    // deliberately does not use; `articleMetrics.ts` is where the strict one lives.
    const f = source('calendar.ts')
    assert.equal(ruftAuf(f, 'leseRelayListe'), false, 'there the name stands in a comment only')
    assert.ok(ruftAuf(f, 'leseRelayListeNachsichtig'), 'the lenient reader IS called')
    assert.ok(ruftAuf(f, 'pickNextCalendarEvent'), 'a real call is found')
})

// ── The join, on BOTH relay shapes ──────────────────────────────────────────────────

test('BUZZ HALF: the meetup id is read out of the `about` prefix, not only out of a tag', () => {
    /*
     * This is a BEHAVIOUR test and not a structural one, and it is here because the Buzz
     * half of the join has no other cover: `meetup-calendar.spec.ts` is not in
     * `BUZZ_SPECS` (`playwright.config.ts`), so the Buzz arm never runs it.
     *
     * The two shapes exist because the two relays store the marker differently, and the
     * caller must not have to know which relay it is looking at:
     *
     *   zooid passes a 9007's extra tags into the 39000 unchanged → `["i","meetup:<id>"]`
     *   Buzz builds the 39000 itself from a fixed tag set and DROPS foreign markers, so
     *   `scripts/sync-meetup-rooms.sh` writes the id into `about` instead.
     *
     * Losing the second branch makes the card silently dead on every Buzz workspace —
     * and `RoomView.isMeetup` is false there for the same reason, which is why the markup
     * must not gate on it either (CORE 5b).
     */
    // zooid: the marker tag.
    assert.equal(
        roomMeetupId({ event: { tags: [['t', 'meetup'], ['i', 'meetup:359']] }, about: '' }),
        '359',
    )
    // Buzz: the `about` prefix, exactly the form `buildAboutMarker` writes.
    assert.equal(
        roomMeetupId({ event: { tags: [['t', 'stream']] }, about: 'einundzwanzig:meetup:359 — Indy Bitcoin Meetup' }),
        '359',
    )
    // Buzz without free text.
    assert.equal(roomMeetupId({ event: null, about: 'einundzwanzig:meetup:e2e-berlin' }), 'e2e-berlin')
})

test('BUZZ HALF: the tag wins over the prefix when a room carries both', () => {
    // A room can legitimately carry both (a zooid room whose `about` was written by the
    // sync script). One place has to decide, and the tag is the one the relay guarantees.
    assert.equal(
        roomMeetupId({
            event: { tags: [['i', 'meetup:tag-wins']] },
            about: 'einundzwanzig:meetup:about-loses',
        }),
        'tag-wins',
    )
})

test('BUZZ HALF: an ordinary room resolves to "" and a foreign prefix is not a meetup', () => {
    assert.equal(roomMeetupId(undefined), '')
    assert.equal(roomMeetupId({ event: { tags: [] }, about: '' }), '')
    assert.equal(roomMeetupId({ event: { tags: [] }, about: 'Ein ganz normaler Raum' }), '')
    // A different category under the same prefix must not be read as a meetup — the
    // proposal rooms use `einundzwanzig:proposal:<id>`.
    assert.equal(roomMeetupId({ event: { tags: [] }, about: 'einundzwanzig:proposal:87' }), '')
})
