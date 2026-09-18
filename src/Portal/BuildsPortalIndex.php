<?php

declare(strict_types=1);

namespace Einundzwanzig\Group\Portal;

use Carbon\CarbonImmutable;

/**
 * {@see PortalCatalog::search()} for every binding — ONE implementation over the four
 * list methods each binding already provides.
 *
 * Why a trait and not a second class: the index is not a data source, it is a PROJECTION
 * of the four lists. Whoever can answer `meetups()`/`events()`/`courses()`/`lecturers()`
 * can answer `search()`, and if the two bindings each wrote their own projection the web
 * palette and the app palette would sort and label differently — the one difference a
 * user would notice immediately, because the same typing would give different rows.
 */
trait BuildsPortalIndex
{
    /**
     * The window the index covers for DATES: today plus the two months the plan names
     * (current + next). The full list is 4.6 MB; a year of dates in a payload that the
     * browser loads on the first ⌘K would be paid for by every visitor.
     */
    public function indexEventWindow(): array
    {
        $today = CarbonImmutable::today();

        return [$today->toDateString(), $today->addMonth()->endOfMonth()->toDateString()];
    }

    /**
     * @param  list<string>  $types
     * @return list<PortalHit>
     */
    public function search(string $query = '', array $types = []): array
    {
        $wanted = static fn (string $type): bool => $types === [] || in_array($type, $types, true);
        $rows = [];

        if ($wanted('meetup')) {
            foreach ($this->meetups() as $meetup) {
                $rows[] = new PortalHit(
                    type: 'meetup',
                    ref: $meetup->slug,
                    title: $meetup->name,
                    subtitle: trim($meetup->city.($meetup->country !== '' ? ' · '.$meetup->country : ''), ' ·'),
                    date: $meetup->nextEventStart?->format('Y-m-d H:i') ?? '',
                );
            }
        }

        if ($wanted('event')) {
            [$from, $to] = $this->indexEventWindow();
            foreach ($this->events($from, $to) as $event) {
                /*
                 * `ref` is the meetup SLUG and not the date's id: the read-only surfaces
                 * have no page per date (D9 — the date lives on the meetup's page and in
                 * the Termine list), so the id would be a key without a door. The date
                 * itself distinguishes the row from the meetup row of the same name.
                 */
                $rows[] = new PortalHit(
                    type: 'event',
                    ref: $event->meetupSlug,
                    title: $event->meetupName,
                    subtitle: trim(($event->location ?? '') !== '' ? (string) $event->location : $event->meetupCity, ' ·'),
                    date: $event->start->format('Y-m-d H:i'),
                );
            }
        }

        if ($wanted('course')) {
            foreach ($this->courses() as $course) {
                $rows[] = new PortalHit(
                    type: 'course',
                    ref: (string) $course->id,
                    title: $course->name,
                    subtitle: $course->lecturerName ?? '',
                    date: $course->nextEvent?->format('Y-m-d H:i') ?? '',
                );
            }
        }

        if ($wanted('lecturer')) {
            foreach ($this->lecturers() as $lecturer) {
                $rows[] = new PortalHit(
                    type: 'lecturer',
                    ref: (string) $lecturer->id,
                    title: $lecturer->name,
                    subtitle: $lecturer->subtitle ?? '',
                    date: $lecturer->nextEvent?->format('Y-m-d H:i') ?? '',
                );
            }
        }

        $needle = mb_strtolower(trim($query));
        if ($needle === '') {
            return $rows;
        }

        return array_values(array_filter(
            $rows,
            static fn (PortalHit $hit): bool => str_contains(mb_strtolower($hit->title), $needle)
                || str_contains(mb_strtolower($hit->subtitle), $needle),
        ));
    }
}
