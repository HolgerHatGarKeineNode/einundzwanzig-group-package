<?php

declare(strict_types=1);

namespace Einundzwanzig\Group\Portal;

use Carbon\CarbonImmutable;

/**
 * One meetup date (`/api/meetup-events/{Y-m-d}`) as the read-only pages need it.
 *
 * ── Why the meetup is flattened into four fields ─────────────────────────────────
 * The API delivers the meetup of a date as literal dotted keys (`meetup.name`,
 * `meetup.city`, …) on the top level, and the app's DTO re-nests them. The read-only
 * surfaces here need exactly four of them — name, slug, city, logo — and a nested
 * {@see PortalMeetup} whose other half is empty would invite code that reads the empty
 * half.
 *
 * `nostrAddress` is the 31923 coordinate the Portal published for this date (P1) or
 * `null`. P4 only CARRIES it; the RSVP rule that reads it is P5. It stands here because
 * the index and the detail page are built from the same DTO and P5 would otherwise have
 * to re-shape both.
 */
final readonly class PortalEvent
{
    public function __construct(
        public CarbonImmutable $start,
        public string $meetupName,
        public string $meetupSlug,
        public ?int $id = null,
        public string $meetupCity = '',
        public string $meetupCountry = '',
        public ?string $meetupLogo = null,
        public ?string $location = null,
        public ?string $description = null,
        public ?string $link = null,
        /** null = the count is deliberately hidden (`attendees_public=false`). */
        public ?int $attendees = null,
        public ?int $mightAttendees = null,
        public ?string $nostrAddress = null,
        public bool $rsvpEnabled = true,
    ) {}

    /** Day bucket of the Termine list — `Y-m-d` in the display timezone. */
    public function day(): string
    {
        return $this->start->toDateString();
    }
}
