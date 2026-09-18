<?php

declare(strict_types=1);

namespace Einundzwanzig\Group\Portal;

use Carbon\CarbonImmutable;

/**
 * One meetup as the read-only list needs it (D9) — a PLAIN readonly class.
 *
 * ── Why the package brings its own DTOs ──────────────────────────────────────────
 * The companion maps the same payload into `spatie/laravel-data` objects and fetches it
 * with Saloon. Neither may become a package dependency: the package is embedded by the
 * association's web app for four views (R5), and a transitive data/HTTP stack in that
 * embed is weight nobody there asked for. `readonly` + a constructor is all a view needs.
 *
 * The fields are the intersection of what the two sources can deliver — the web binding
 * reads `/api/mobile/meetups` (~94 kB, one query), the app binding maps its own cached
 * `MobileMeetupData`. Everything a DETAIL needs (intro, links, RSVP flags) lives in
 * {@see PortalMeetupDetail} and costs a second, slower request.
 */
final readonly class PortalMeetup
{
    public function __construct(
        public string $slug,
        public string $name,
        public string $city,
        /** ISO-3166-1 alpha-2, UPPER CASE ('' when unknown). */
        public string $country,
        public ?string $logo = null,
        public ?CarbonImmutable $nextEventStart = null,
        public ?int $id = null,
        public float $latitude = 0.0,
        public float $longitude = 0.0,
    ) {}

    /** Lower-case country code — what the region filter compares against. */
    public function countryCode(): string
    {
        return mb_strtolower($this->country);
    }

    /**
     * The Portal deep link, derived and not carried.
     *
     * Measured 2026-07-19 over all 304 meetups of the day: `portalLink` is 100 %
     * derivable from `country` + `slug` (`js/meetupPresentation.ts` builds it the same
     * way and the room join hangs on it). Carrying the field would be a second truth
     * about one address.
     */
    public function portalLink(string $portalUrl): string
    {
        return rtrim($portalUrl, '/').'/'.mb_strtolower($this->country !== '' ? $this->country : 'de').'/meetup/'.$this->slug;
    }
}
