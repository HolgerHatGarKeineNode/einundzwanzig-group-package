<?php

declare(strict_types=1);

namespace Einundzwanzig\Group\Portal;

use Carbon\CarbonImmutable;

/** A date of a course, as `/api/courses/{id}` nests them (ascending by `from`). */
final readonly class PortalCourseEvent
{
    public function __construct(
        public int $id,
        public CarbonImmutable $from,
        public ?CarbonImmutable $to = null,
        public ?string $link = null,
        /** „Venue · City" as far as the API delivers it; null when it delivers neither. */
        public ?string $location = null,
    ) {}
}
