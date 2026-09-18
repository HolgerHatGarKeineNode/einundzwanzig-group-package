<?php

declare(strict_types=1);

namespace Einundzwanzig\Group\Portal;

/** A course with description, lecturer and its upcoming dates (`/api/courses/{id}`). */
final readonly class PortalCourseDetail
{
    /**
     * @param  list<PortalCourseEvent>  $events
     */
    public function __construct(
        public int $id,
        public string $name,
        public ?string $description = null,
        public ?string $image = null,
        public ?string $portalLink = null,
        public ?PortalLecturer $lecturer = null,
        public array $events = [],
    ) {}
}
