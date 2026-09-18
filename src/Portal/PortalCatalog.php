<?php

declare(strict_types=1);

namespace Einundzwanzig\Group\Portal;

/**
 * The ONE seam between the package's read-only Portal surfaces (D9), the palette index
 * (D6) and whatever actually talks to the association portal.
 *
 * ── Why a contract and not just an HTTP client ───────────────────────────────────
 * Two hosts read the same data through completely different plumbing. The web client
 * talks HTTP and caches with `Cache::flexible` (one server, one IP — R9: the Portal
 * throttles at 60/min per IP, so a per-visitor request is not an option). The companion
 * has a two-tier cache with a permanent stale copy, because its pages must still render
 * in a train tunnel, and it reaches the Portal through Saloon with a user token. Neither
 * of those belongs in the package.
 *
 * ── What implementations MUST hold to ────────────────────────────────────────────
 *  · **Never throw for a missing Portal.** A failed read is a {@see PortalStatus}, not an
 *    exception — every caller here is a page that has to render something. Lists come
 *    back empty, single objects `null`, and {@see status()} says which of the three cases
 *    it was.
 *  · **Never return a half-mapped row.** A record the binding cannot map is dropped, not
 *    guessed. A meetup without a slug has no page to link to.
 *  · **`status()` is per request** and reports the WORST outcome of this request's calls
 *    ({@see PortalStatus::worst()}).
 */
interface PortalCatalog
{
    /**
     * The compact palette index (D6), optionally narrowed.
     *
     * `$query` is served by the ENDPOINT with an empty string: `/suche/portal-index`
     * hands the whole index to the browser exactly once per session and the typed query
     * never leaves the device (the decision behind D6). A non-empty `$query` filters the
     * same rows server-side — that arm exists for a caller that has the query anyway
     * (a shared link, a test) and must never be wired to a keystroke.
     *
     * @param  list<string>  $types  subset of `meetup` · `event` · `course` · `lecturer`;
     *                               empty = all four
     * @return list<PortalHit>
     */
    public function search(string $query = '', array $types = []): array;

    /**
     * All meetups, cheap list shape (the web binding reads the ~94 kB `/api/mobile/meetups`).
     *
     * @return list<PortalMeetup>
     */
    public function meetups(): array;

    /** One meetup with intro, links and its dates; `null` when unknown or unreachable. */
    public function meetup(string $slug): ?PortalMeetupDetail;

    /**
     * Meetup dates between two days, inclusive, ascending.
     *
     * Both bounds are `Y-m-d`. The full date list is 4.6 MB, so the web binding asks the
     * Portal per MONTH (`/api/meetup-events/{Y-m-d}` answers from that day to the end of
     * its month) and stitches the months this range touches.
     *
     * @return list<PortalEvent>
     */
    public function events(string $from, string $to): array;

    /**
     * @return list<PortalCourse>
     */
    public function courses(): array;

    public function course(int $id): ?PortalCourseDetail;

    /**
     * NOT in the plan's method list, and deliberately added: `ansicht=referenten` is a
     * view of its own (D3) and the palette has a `lecturers` section. Deriving the list
     * from the lecturers nested in {@see courses()} would drop every lecturer without a
     * course and would carry no `future_events_count`.
     *
     * @return list<PortalLecturer>
     */
    public function lecturers(): array;

    public function lecturer(int $id): ?PortalLecturerDetail;

    /** How good was the data of THIS request? See {@see PortalStatus}. */
    public function status(): PortalStatus;
}
