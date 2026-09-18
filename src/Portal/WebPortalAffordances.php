<?php

declare(strict_types=1);

namespace Einundzwanzig\Group\Portal;

use Livewire\Component;

/**
 * The web arm of {@see PortalAffordances} — everything happens in the BROWSER, this class
 * only says what should happen there.
 *
 * The three events (`group-share`, `group-open-link`) are caught by the island in
 * `js/portalPage.ts`. A server-side `navigator.share` does not exist, and a
 * `window.open()` written into a Blade `onclick` would be a second place deciding what
 * this class decides.
 */
final class WebPortalAffordances implements PortalAffordances
{
    public function share(Component $page, string $title, string $text, string $url): void
    {
        if (! $this->isHttp($url)) {
            return;
        }

        $page->dispatch('group-share', title: $title, text: $text, url: $url);
    }

    public function openLink(Component $page, string $url): void
    {
        /*
         * The scheme check is NOT decoration: these URLs come from Portal records that
         * any meetup leader may edit. `javascript:` in a `window.open()` runs in this
         * origin, and `intent:`/`nostrsigner:` would hand a foreign app a payload from
         * a web page. Fail CLOSED — an ignored link is a dead button, a passed one is a
         * hole.
         */
        if (! $this->isHttp($url)) {
            return;
        }

        $page->dispatch('group-open-link', url: $url);
    }

    public function addToCalendar(Component $page, ?int $meetupId, ?PortalEvent $event = null): void
    {
        if ($meetupId === null) {
            return;
        }

        $this->openLink($page, rtrim((string) config('group.portal_url', ''), '/').'/stream-calendar?meetup='.$meetupId);
    }

    public function canShareNatively(): bool
    {
        return false;
    }

    private function isHttp(string $url): bool
    {
        return str_starts_with($url, 'https://') || str_starts_with($url, 'http://');
    }
}
