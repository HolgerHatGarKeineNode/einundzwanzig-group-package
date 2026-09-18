<?php

declare(strict_types=1);

namespace Einundzwanzig\Group\Portal;

use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Throwable;

/**
 * The web client's {@see PortalCatalog}: Laravel `Http` against the public Portal API,
 * every list behind `Cache::flexible`.
 *
 * ── Why the cache is not a nicety (R9) ───────────────────────────────────────────
 * The Portal throttles `/api/*` at 60 requests per minute PER IP, and the group web
 * server is exactly one IP for all of its visitors. A per-visitor read would take the
 * whole instance down to a shared bucket the moment two people browse the meetups at
 * once. Every read here therefore goes through one cache entry per list, and the browser
 * never talks to the Portal at all — it asks `/suche/portal-index` for a finished index
 * (D6) and the pages render server-side.
 *
 * ── Why the payload carries its own timestamp ────────────────────────────────────
 * `Cache::flexible` serves the stale half of its window while it revalidates in the
 * background, and it does not say which half you got. A page that must show „not
 * up to date" (D9) needs to know, so the stored value is `['at' => <unix>, 'data' => …]`
 * and the age decides the {@see PortalStatus}. Without it the banner would either never
 * appear or always.
 *
 * ── The three requests, and why each one is the cheap one ────────────────────────
 *  · `/api/mobile/meetups` — 94 kB, one query, the list shape. NOT `/api/meetups`
 *    (measured 2026-09-18: 281 kB and 2.8 s cold) which only the DETAIL needs, for the
 *    intro and the social links.
 *  · `/api/meetup-events/{Y-m-d}` per month — the full date list is 4.6 MB.
 *  · `/api/courses?withDetails` and `/api/lecturers?withDetails` — public and small.
 *    `/api/meetup?search=` is deliberately unused: it requires auth (measured 401), and
 *    with a 94 kB list there is nothing to search for on the server.
 */
final class HttpPortalCatalog implements PortalCatalog
{
    use BuildsPortalIndex;

    /** Master data (meetups, courses, lecturers): one hour fresh. */
    public const TTL_STATIC = 3600;

    /** Dates: a quarter of an hour — a cancelled meetup should not stand for an hour. */
    public const TTL_EVENTS = 900;

    /**
     * How long a stale copy may still be served. Seven days is a deliberate „offline"
     * budget: what is gone from the Portal for a week is gone, and until then a
     * marked-stale list beats an empty page.
     */
    public const STALE_WINDOW = 604800;

    private PortalStatus $status = PortalStatus::Fresh;

    /** Per-request memo: the same list is read by page, filter and index. */
    private array $memo = [];

    public function status(): PortalStatus
    {
        return $this->status;
    }

    /** @return list<PortalMeetup> */
    public function meetups(): array
    {
        $rows = $this->cached('mobile-meetups', self::TTL_STATIC, fn (): array => $this->fetch('/api/mobile/meetups'));

        return array_values(array_filter(array_map(
            fn (array $row): ?PortalMeetup => $this->toMeetup($row),
            $rows ?? [],
        )));
    }

    public function meetup(string $slug): ?PortalMeetupDetail
    {
        $rows = $this->cached(
            'map-meetups',
            self::TTL_STATIC,
            fn (): array => $this->fetch('/api/meetups', ['withIntro' => 1, 'withLogos' => 1], timeout: 20),
        );

        $found = null;
        foreach ($rows ?? [] as $row) {
            if ($this->slugOf($row) === $slug) {
                $found = $row;
                break;
            }
        }

        if ($found === null) {
            return null;
        }

        $meetup = new PortalMeetup(
            slug: $slug,
            name: (string) ($found['name'] ?? ''),
            city: (string) ($found['city'] ?? ''),
            country: mb_strtoupper((string) ($found['country'] ?? '')),
            logo: $this->nonEmpty($found['logo'] ?? null),
            nextEventStart: $this->date($found['next_event']['start'] ?? null),
            id: isset($found['id']) ? (int) $found['id'] : null,
            latitude: (float) ($found['latitude'] ?? 0),
            longitude: (float) ($found['longitude'] ?? 0),
        );

        /*
         * The dates of THIS meetup come from the same window the Termine list uses — one
         * source for one fact. The next date is taken from `next_event` (the Portal
         * computes it and knows about cancellations), the rest is everything after it.
         */
        [$from, $to] = $this->indexEventWindow();
        $dates = array_values(array_filter(
            $this->events($from, $to),
            static fn (PortalEvent $event): bool => $event->meetupSlug === $slug,
        ));
        $next = $dates[0] ?? null;
        $upcoming = $next === null ? [] : array_values(array_slice($dates, 1));

        return new PortalMeetupDetail(
            meetup: $meetup,
            intro: $this->nonEmpty($found['intro'] ?? null),
            links: $this->socialLinks($found),
            nextEvent: $next,
            upcoming: $upcoming,
            rsvpEnabled: (bool) ($found['rsvp_enabled'] ?? true),
            attendeesPublic: (bool) ($found['attendees_public'] ?? true),
            hasRoom: (bool) ($found['has_room'] ?? false),
            portalLink: $this->nonEmpty($found['portalLink'] ?? null) ?? $meetup->portalLink($this->base()),
        );
    }

    /** @return list<PortalEvent> */
    public function events(string $from, string $to): array
    {
        $start = CarbonImmutable::parse($from)->startOfDay();
        $end = CarbonImmutable::parse($to)->endOfDay();
        if ($end->lessThan($start)) {
            return [];
        }

        $events = [];
        /*
         * One request per MONTH: `/api/meetup-events/{Y-m-d}` answers from that day to the
         * end of ITS month (measured). Asking for the whole range in one call would mean
         * the 4.6 MB full list.
         */
        for ($month = $start->startOfMonth(); $month->lessThanOrEqualTo($end); $month = $month->addMonth()->startOfMonth()) {
            $day = $month->lessThan($start) ? $start : $month;
            $rows = $this->cached(
                'events:'.$day->toDateString(),
                self::TTL_EVENTS,
                fn (): array => $this->fetch('/api/meetup-events/'.$day->toDateString()),
            );

            foreach ($rows ?? [] as $row) {
                $event = $this->toEvent($row);
                if ($event === null || $event->start->greaterThan($end) || $event->start->lessThan($start)) {
                    continue;
                }
                $events[] = $event;
            }
        }

        usort($events, static fn (PortalEvent $a, PortalEvent $b): int => $a->start->getTimestamp() <=> $b->start->getTimestamp());

        return $events;
    }

    /** @return list<PortalCourse> */
    public function courses(): array
    {
        $rows = $this->cached(
            'courses',
            self::TTL_STATIC,
            fn (): array => $this->fetch('/api/courses', ['withDetails' => 1]),
        );

        return array_values(array_filter(array_map(
            fn (array $row): ?PortalCourse => $this->toCourse($row),
            $rows ?? [],
        )));
    }

    public function course(int $id): ?PortalCourseDetail
    {
        $row = $this->cached(
            'course:'.$id,
            self::TTL_EVENTS,
            fn (): array => $this->fetch('/api/courses/'.$id),
        );

        if ($row === null || ! isset($row['id'])) {
            return null;
        }

        $events = [];
        foreach ($row['events'] ?? [] as $event) {
            if (! isset($event['id'], $event['from'])) {
                continue;
            }
            $events[] = new PortalCourseEvent(
                id: (int) $event['id'],
                from: $this->date($event['from']) ?? CarbonImmutable::now(),
                to: $this->date($event['to'] ?? null),
                link: $this->nonEmpty($event['link'] ?? null),
                location: $this->venueLabel($event['venue'] ?? null),
            );
        }

        return new PortalCourseDetail(
            id: (int) $row['id'],
            name: (string) ($row['name'] ?? ''),
            description: $this->nonEmpty($row['description'] ?? null),
            image: $this->image($row['image'] ?? null),
            portalLink: $this->nonEmpty($row['portalLink'] ?? null),
            lecturer: isset($row['lecturer']['id']) ? $this->toLecturer($row['lecturer']) : null,
            events: $events,
        );
    }

    /** @return list<PortalLecturer> */
    public function lecturers(): array
    {
        $rows = $this->cached(
            'lecturers',
            self::TTL_STATIC,
            fn (): array => $this->fetch('/api/lecturers', ['withDetails' => 1]),
        );

        return array_values(array_filter(array_map(
            fn (array $row): ?PortalLecturer => $this->toLecturer($row),
            $rows ?? [],
        )));
    }

    public function lecturer(int $id): ?PortalLecturerDetail
    {
        $row = $this->cached(
            'lecturer:'.$id,
            self::TTL_EVENTS,
            fn (): array => $this->fetch('/api/lecturers/'.$id),
        );

        if ($row === null || ! isset($row['id'])) {
            return null;
        }

        $lecturer = $this->toLecturer($row);
        if ($lecturer === null) {
            return null;
        }

        $courses = array_values(array_filter(array_map(
            fn (array $course): ?PortalCourse => $this->toCourse($course),
            $row['courses'] ?? [],
        )));

        return new PortalLecturerDetail(
            lecturer: $lecturer,
            intro: $this->nonEmpty($row['intro'] ?? null),
            description: $this->nonEmpty($row['description'] ?? null),
            active: (bool) ($row['active'] ?? true),
            links: $this->lecturerLinks($row),
            courses: $courses,
            lightningAddress: $this->nonEmpty($row['lightning_address'] ?? null),
            portalLink: $this->base().'/de/lecturer/'.$lecturer->id,
        );
    }

    // ── Reading ─────────────────────────────────────────────────────────────────

    /**
     * One cached list, with the honest age.
     *
     * The stored shape is `['at' => <unix>, 'data' => <json>]`; anything older than its
     * TTL that still comes out of the cache means `Cache::flexible` served the stale half,
     * and the page says so. A throw from the fetch (Portal down, DNS, timeout) means
     * `offline` — never an exception into a page that has to render.
     *
     * @return array<int|string, mixed>|null
     */
    private function cached(string $name, int $ttl, callable $fetch): ?array
    {
        if (array_key_exists($name, $this->memo)) {
            return $this->memo[$name];
        }

        $key = 'group:portal:v1:'.$name;

        try {
            $stored = Cache::flexible($key, [$ttl, self::STALE_WINDOW], static function () use ($fetch): array {
                /*
                 * `now()` and not `time()`: the age below is compared against the clock the
                 * CACHE keeps its expiry on, and that clock is Carbon's. With `time()` the
                 * two drift apart wherever Carbon is set (every test that travels in time),
                 * and the stale banner would be measured against a clock nobody else uses.
                 */
                return ['at' => now()->getTimestamp(), 'data' => $fetch()];
            });
        } catch (Throwable) {
            $this->status = $this->status->worst(PortalStatus::Offline);

            return $this->memo[$name] = null;
        }

        if (! is_array($stored) || ! array_key_exists('data', $stored)) {
            $this->status = $this->status->worst(PortalStatus::Offline);

            return $this->memo[$name] = null;
        }

        if (now()->getTimestamp() - (int) ($stored['at'] ?? 0) > $ttl) {
            $this->status = $this->status->worst(PortalStatus::Stale);
        }

        return $this->memo[$name] = is_array($stored['data']) ? $stored['data'] : null;
    }

    /**
     * One GET against the Portal. Throws on anything that is not a 2xx with JSON — the
     * caller turns that into a {@see PortalStatus}.
     *
     * @param  array<string, mixed>  $query
     * @return array<int|string, mixed>
     */
    private function fetch(string $path, array $query = [], int $timeout = 10): array
    {
        $response = Http::baseUrl($this->base())
            ->acceptJson()
            ->timeout($timeout)
            ->retry(1, 200, throw: false)
            ->get($path, $query)
            ->throw();

        $json = $response->json();

        if (! is_array($json)) {
            throw new \RuntimeException('portal: '.$path.' answered no JSON array');
        }

        return $json;
    }

    private function base(): string
    {
        return rtrim((string) config('group.portal_url', ''), '/');
    }

    // ── Mapping ─────────────────────────────────────────────────────────────────

    /** @param array<string, mixed> $row */
    private function toMeetup(array $row): ?PortalMeetup
    {
        $slug = $this->slugOf($row);
        if ($slug === null) {
            return null;
        }

        return new PortalMeetup(
            slug: $slug,
            name: (string) ($row['name'] ?? ''),
            city: (string) ($row['city'] ?? ''),
            country: mb_strtoupper((string) ($row['country'] ?? '')),
            logo: $this->nonEmpty($row['logo'] ?? null),
            nextEventStart: $this->date($row['next_event_start'] ?? null),
            id: isset($row['id']) ? (int) $row['id'] : null,
            latitude: (float) ($row['latitude'] ?? 0),
            longitude: (float) ($row['longitude'] ?? 0),
        );
    }

    /** @param array<string, mixed> $row */
    private function toEvent(array $row): ?PortalEvent
    {
        $start = $this->date($row['start'] ?? null);
        $slug = $this->slugOf(['portalLink' => $row['meetup.portalLink'] ?? null]);
        if ($start === null || $slug === null) {
            return null;
        }

        return new PortalEvent(
            start: $start,
            meetupName: (string) ($row['meetup.name'] ?? ''),
            meetupSlug: $slug,
            id: isset($row['id']) ? (int) $row['id'] : null,
            meetupCity: (string) ($row['meetup.city'] ?? ''),
            meetupCountry: mb_strtoupper((string) ($row['meetup.country'] ?? '')),
            meetupLogo: $this->nonEmpty($row['meetup.logo'] ?? null),
            location: $this->nonEmpty($row['location'] ?? null),
            description: $this->nonEmpty($row['description'] ?? null),
            link: $this->nonEmpty($row['link'] ?? null),
            attendees: isset($row['attendees']) ? (int) $row['attendees'] : null,
            mightAttendees: isset($row['might_attendees']) ? (int) $row['might_attendees'] : null,
            nostrAddress: $this->nonEmpty($row['nostr_address'] ?? null),
            rsvpEnabled: (bool) ($row['meetup.rsvp_enabled'] ?? true),
            /*
             * The payload has no `attendees_public` of its own on a DATE: the Portal
             * expresses it by sending `attendees`/`might_attendees` as `null`
             * (`MeetupEventController::153-168`, read 2026-09-18). Derived here, once, so
             * that the RSVP rule reads a flag instead of inferring one — and `array_key_exists`
             * rather than `isset`, because `isset` cannot tell „absent" from „null" and this
             * is exactly the distinction being read.
             */
            attendeesPublic: ! array_key_exists('attendees', $row) || $row['attendees'] !== null,
        );
    }

    /** @param array<string, mixed> $row */
    private function toCourse(array $row): ?PortalCourse
    {
        if (! isset($row['id'])) {
            return null;
        }

        return new PortalCourse(
            id: (int) $row['id'],
            name: (string) ($row['name'] ?? ''),
            image: $this->image($row['image'] ?? null),
            description: $this->nonEmpty($row['description'] ?? null),
            nextEvent: $this->date($row['next_event'] ?? null),
            lecturerName: $this->nonEmpty($row['lecturer']['name'] ?? null),
            lecturerId: isset($row['lecturer']['id']) ? (int) $row['lecturer']['id'] : null,
        );
    }

    /** @param array<string, mixed> $row */
    private function toLecturer(array $row): ?PortalLecturer
    {
        if (! isset($row['id'])) {
            return null;
        }

        return new PortalLecturer(
            id: (int) $row['id'],
            name: (string) ($row['name'] ?? ''),
            image: $this->image($row['image'] ?? null),
            subtitle: $this->nonEmpty($row['subtitle'] ?? null),
            futureEventsCount: (int) ($row['future_events_count'] ?? 0),
            nextEvent: $this->date($row['next_event'] ?? null),
        );
    }

    /**
     * The slug, read out of `portalLink` (`…/<country>/meetup/<slug>`) or taken straight
     * from the field when the endpoint carries it (`/api/mobile/meetups` does).
     */
    private function slugOf(array $row): ?string
    {
        $slug = $this->nonEmpty($row['slug'] ?? null);
        if ($slug !== null) {
            return $slug;
        }

        $link = $this->nonEmpty($row['portalLink'] ?? null);
        if ($link === null) {
            return null;
        }

        $last = basename(parse_url($link, PHP_URL_PATH) ?: '');

        return $last === '' ? null : $last;
    }

    /**
     * External links of a meetup as `[label => url]`.
     *
     * `url` is `telegram_link ?? webpage` in the map payload (the Portal's own
     * `MeetupMapController`), hence the `t.me` check and the de-duplication against
     * `website` — the same rule the companion's DTO applies, and the only place it lives
     * in this package.
     *
     * @param  array<string, mixed>  $row
     * @return array<string, string>
     */
    private function socialLinks(array $row): array
    {
        $links = [];
        $url = $this->nonEmpty($row['url'] ?? null);
        $website = $this->nonEmpty($row['website'] ?? null);

        if ($url !== null) {
            $links[str_contains($url, 't.me/') ? __('Telegram') : __('Community-Link')] = $url;
        }
        if ($website !== null && $website !== $url) {
            $links[__('Website')] = $website;
        }
        if (($twitter = $this->nonEmpty($row['twitter_username'] ?? null)) !== null) {
            $links[__('X (Twitter)')] = 'https://x.com/'.ltrim($twitter, '@');
        }
        if (($nostr = $this->nonEmpty($row['nostr'] ?? null)) !== null) {
            $links[__('Nostr')] = 'https://njump.me/'.$nostr;
        }
        if (($signal = $this->nonEmpty($row['signal'] ?? null)) !== null) {
            $links[__('Signal')] = $signal;
        }
        if (($simplex = $this->nonEmpty($row['simplex'] ?? null)) !== null) {
            $links[__('SimpleX')] = $simplex;
        }

        return $links;
    }

    /**
     * @param  array<string, mixed>  $row
     * @return array<string, string>
     */
    private function lecturerLinks(array $row): array
    {
        $links = [];
        if (($website = $this->nonEmpty($row['website'] ?? null)) !== null) {
            $links[__('Website')] = $website;
        }
        if (($twitter = $this->nonEmpty($row['twitter_username'] ?? null)) !== null) {
            $links[__('X (Twitter)')] = 'https://x.com/'.ltrim($twitter, '@');
        }
        if (($nostr = $this->nonEmpty($row['nostr'] ?? null)) !== null) {
            $links[__('Nostr')] = 'https://njump.me/'.$nostr;
        }

        return $links;
    }

    /** „Venue · City" as far as the payload carries it. */
    private function venueLabel(mixed $venue): ?string
    {
        if (! is_array($venue)) {
            return null;
        }

        $name = $this->nonEmpty($venue['name'] ?? null);
        $city = $this->nonEmpty($venue['city']['name'] ?? null);

        if ($name === null) {
            return $city;
        }

        return $city === null ? $name : $name.' · '.$city;
    }

    /**
     * The Portal answers `/img/einundzwanzig.png` for anything WITHOUT an own image, and
     * that file does not exist (404). Treated as „no image" so the surface shows its
     * initial instead of a broken picture — measured behaviour, same rule as the app's DTO.
     */
    private function image(mixed $value): ?string
    {
        $image = $this->nonEmpty($value);

        return $image === null || str_contains($image, '/img/einundzwanzig') ? null : $image;
    }

    private function nonEmpty(mixed $value): ?string
    {
        if (! is_string($value)) {
            return null;
        }
        $trimmed = trim($value);

        return $trimmed === '' ? null : $trimmed;
    }

    private function date(mixed $value): ?CarbonImmutable
    {
        if (! is_string($value) || trim($value) === '') {
            return null;
        }

        try {
            return CarbonImmutable::parse($value);
        } catch (Throwable) {
            return null;
        }
    }
}
