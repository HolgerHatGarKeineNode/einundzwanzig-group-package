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
 * `null`. P4 only CARRIED it; since P5 it is the first condition of the RSVP rule
 * (`js/rsvpRule.ts`). It stands here because the index and the detail page are built from
 * the same DTO and P5 would otherwise have to re-shape both.
 *
 * `attendeesPublic` is EXPLICIT and not derived from `attendees === null` at the reading
 * end, although the payload expresses it that way. The RSVP rule needs the flag as a flag
 * (D12a: no Nostr answer where the meetup hides its attendance), and „the count happens to
 * be absent" is a different statement from „this meetup keeps its guest list private" — the
 * app binding, which maps its own DTO, can say the second one directly. Derived ONCE at the
 * mapping boundary, never at a call site.
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
        public bool $attendeesPublic = true,
    ) {}

    /** Day bucket of the Termine list — `Y-m-d` in the display timezone. */
    public function day(): string
    {
        return $this->start->toDateString();
    }

    /**
     * The Portal page of this date's MEETUP — derived, exactly as {@see PortalMeetup::portalLink()}
     * derives it from the same two fields.
     *
     * A date has no Portal page of its own; the Portal shows it on the meetup. Not to be
     * confused with {@see $link}, which is the ORGANISER's own address (a Telegram post, a
     * Luma page) — answering there is not answering the Portal.
     */
    public function portalLink(string $portalUrl): string
    {
        $country = mb_strtolower($this->meetupCountry !== '' ? $this->meetupCountry : 'de');

        return rtrim($portalUrl, '/').'/'.$country.'/meetup/'.$this->meetupSlug;
    }
}
