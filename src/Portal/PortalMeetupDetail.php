<?php

declare(strict_types=1);

namespace Einundzwanzig\Group\Portal;

/**
 * A single meetup with everything its page shows (D9, read-only).
 *
 * `links` is already resolved to `[label => url]` by the binding: the label depends on
 * the value (`t.me/…` is „Telegram", anything else „Community-Link"), and that decision
 * belongs where the field is read, not in six `@if`s in a Blade file.
 *
 * `nextEvent` is a {@see PortalEvent} rather than a second date shape — the surface
 * prints the next date exactly like a date in the Termine list, and two shapes for one
 * thing drift apart.
 */
final readonly class PortalMeetupDetail
{
    /**
     * @param  array<string, string>  $links  label => URL, in display order
     */
    public function __construct(
        public PortalMeetup $meetup,
        public ?string $intro = null,
        public array $links = [],
        public ?PortalEvent $nextEvent = null,
        /** Further dates of this meetup, ascending, WITHOUT {@see $nextEvent}. */
        public array $upcoming = [],
        public bool $rsvpEnabled = true,
        public bool $attendeesPublic = true,
        /** Does a private NIP-29 room exist for this meetup on the space? */
        public bool $hasRoom = false,
        public ?string $portalLink = null,
    ) {}

    /**
     * The room `h` of this meetup — `"m" + sha256(id)[:12]`, rename-proof.
     *
     * Identical to the production room creation and to the companion's own derivation.
     * `null` without an id or without `has_room`: the Portal is authoritative about the
     * existence (the member-only relay hands out kind 39000 only AUTH-gated), and a
     * button into a room that does not exist is worse than no button.
     */
    public function roomH(): ?string
    {
        if ($this->meetup->id === null || ! $this->hasRoom) {
            return null;
        }

        return 'm'.substr(hash('sha256', (string) $this->meetup->id), 0, 12);
    }
}
