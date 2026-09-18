<?php

declare(strict_types=1);

namespace Einundzwanzig\Group\Portal;

use Livewire\Component;

/**
 * The three things a read-only Portal page wants to DO — and the one seam where web and
 * app answer them differently (D9).
 *
 * ── Why this is not solved with `target="_blank"` and be done ─────────────────────
 * On the web, sharing is `navigator.share` with a clipboard fallback, opening a link is a
 * new tab, and „add to calendar" is the Portal's own subscribable `.ics` feed. In the
 * NativePHP build all three are native calls (`Share`, `Browser::inApp`, the calendar
 * editor), and two of them MUST be native: an in-app browser keeps the user inside the
 * app, and a messenger link (`t.me`, `signal.me`) has to reach the installed app through
 * an intent instead of stranding in a WebView tab.
 *
 * ── Why every method takes the calling component ─────────────────────────────────
 * The web arm has no server-side effect at all: it can only ask the BROWSER to do
 * something, and the way from a Livewire action into the browser is the component's own
 * `dispatch()`. Handing the component in keeps the seam at one place instead of giving
 * the pages an `if (Chassis::istApp())` each.
 */
interface PortalAffordances
{
    /**
     * Share a target. Web dispatches `group-share` (the island calls `navigator.share`
     * and falls back to the clipboard); the app hands it to the native share sheet.
     */
    public function share(Component $page, string $title, string $text, string $url): void;

    /**
     * Open an address that leaves this surface. Web opens a tab, the app its in-app
     * browser — except for messenger hosts, which go to the system browser so their app
     * can take the intent.
     *
     * Implementations MUST ignore anything that is not `http(s)`: the URLs come from
     * Portal data, and a `nostrsigner:`/`intent:` scheme would be intent injection.
     */
    public function openLink(Component $page, string $url): void;

    /**
     * „Add to calendar" for the dates of ONE meetup.
     *
     * The web arm opens the Portal's subscribable feed (`/stream-calendar?meetup=<id>`,
     * `text/calendar`) — the Portal owns the dates, so it owns their `.ics`. The app
     * builds a single-event file and hands it to the native editor.
     *
     * `$meetupId` may be null (older cached payloads have no id); implementations then do
     * nothing, and the surface does not offer the button in the first place.
     */
    public function addToCalendar(Component $page, ?int $meetupId, ?PortalEvent $event = null): void;

    /**
     * Does this host have a native share sheet? Read by the surface for the LABEL only
     * („Teilen" vs. „Link kopieren") — never for the decision, which lives above.
     */
    public function canShareNatively(): bool;
}
