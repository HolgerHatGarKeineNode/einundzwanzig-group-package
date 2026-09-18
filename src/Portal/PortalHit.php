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
    ) {}

    /**
     * The JSON shape of one index row — SHORT keys on purpose.
     *
     * Measured over the production lists (312 meetups, ~650 dates, 46 courses, 119
     * lecturers) the four long keys cost about a fifth of the payload. The browser side
     * (`js/portalIndex.ts`) names them once.
     *
     * @return array{t: string, r: string, n: string, s: string, d: string}
     */
    public function toIndexRow(): array
    {
        return ['t' => $this->type, 'r' => $this->ref, 'n' => $this->title, 's' => $this->subtitle, 'd' => $this->date];
    }
}
