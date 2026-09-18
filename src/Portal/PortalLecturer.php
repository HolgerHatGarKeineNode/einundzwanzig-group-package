<?php

declare(strict_types=1);

namespace Einundzwanzig\Group\Portal;

use Carbon\CarbonImmutable;

/** One lecturer of the public list (`/api/lecturers?withDetails`), read-only (D9). */
final readonly class PortalLecturer
{
    public function __construct(
        public int $id,
        public string $name,
        public ?string $image = null,
        public ?string $subtitle = null,
        public int $futureEventsCount = 0,
        public ?CarbonImmutable $nextEvent = null,
    ) {}
}
