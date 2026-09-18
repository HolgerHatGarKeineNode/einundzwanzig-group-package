<?php

declare(strict_types=1);

namespace Einundzwanzig\Group\Portal;

/**
 * One row of the palette index (D6) — the COMPACT shape, and that is its whole point.
 *
 * The index is loaded ONCE per palette session and filtered in the browser, so its size
 * is the cost of the feature: title, one subtitle, one date, one target. A full meetup
 * record per row would multiply 94 kB by the four lists for nothing anybody types.
 *
 * `type` is the palette SECTION (`meetup` · `event` · `course` · `lecturer`), `ref` the
 * slug resp. the numeric id as a string — the browser builds the href from both and never
 * sees a server-side URL table.
 */
final readonly class PortalHit
{
    public function __construct(
        public string $type,
        public string $ref,
        public string $title,
        /** City · country, the lecturer's subtitle, the course's lecturer — '' when none. */
        public string $subtitle = '',
        /** `Y-m-d H:i` of the relevant date, '' when the row has none. */
        public string $date = '',
        /**
         * The 31923 coordinate of a DATE row, '' for everything else (P5).
         *
         * It is here because the palette action „Zusagen" publishes the kind 31925 from the
         * palette itself (D12/P5) and an RSVP needs the coordinate it answers. The
         * alternative was a request per row at the moment somebody presses Enter — against a
         * Portal that throttles 60/min per IP for the whole instance (R9), for a list of a
         * dozen rows.
         *
         * Measured cost: the value is `31923:<64 hex>:meetup-event-<id>`, ~90 bytes, and only
         * dates carry one. It is the same 64 hex characters on every row (the Portal's
         * publishing key), so it is the most compressible part of the whole payload.
         */
        public string $address = '',
    ) {}

    /**
     * The JSON shape of one index row — SHORT keys on purpose.
     *
     * Measured over the production lists (312 meetups, ~650 dates, 46 courses, 119
     * lecturers) the four long keys cost about a fifth of the payload. The browser side
     * (`js/portalIndex.ts`) names them once.
     *
     * `a` is OMITTED where it is empty instead of being sent as `""`: three quarters of the
     * rows have no coordinate (meetups, courses, lecturers), and an empty key on each of
     * them is payload for nothing.
     *
     * @return array{t: string, r: string, n: string, s: string, d: string, a?: string}
     */
    public function toIndexRow(): array
    {
        $row = ['t' => $this->type, 'r' => $this->ref, 'n' => $this->title, 's' => $this->subtitle, 'd' => $this->date];

        if ($this->address !== '') {
            $row['a'] = $this->address;
        }

        return $row;
    }
}
