<?php

declare(strict_types=1);

namespace Einundzwanzig\Group\Portal;

use Carbon\CarbonImmutable;

/** One course of the public list (`/api/courses?withDetails`), read-only (D9). */
final readonly class PortalCourse
{
    public function __construct(
        public int $id,
        public string $name,
        public ?string $image = null,
        public ?string $description = null,
        public ?CarbonImmutable $nextEvent = null,
        public ?string $lecturerName = null,
        public ?int $lecturerId = null,
    ) {}
}
