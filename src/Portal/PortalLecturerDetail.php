<?php

declare(strict_types=1);

namespace Einundzwanzig\Group\Portal;

/** A lecturer profile with their courses (`/api/lecturers/{id}`). */
final readonly class PortalLecturerDetail
{
    /**
     * @param  array<string, string>  $links  label => URL (website, X, Nostr)
     * @param  list<PortalCourse>  $courses
     */
    public function __construct(
        public PortalLecturer $lecturer,
        public ?string $intro = null,
        public ?string $description = null,
        public bool $active = true,
        public array $links = [],
        public array $courses = [],
        public ?string $lightningAddress = null,
        public ?string $portalLink = null,
    ) {}
}
