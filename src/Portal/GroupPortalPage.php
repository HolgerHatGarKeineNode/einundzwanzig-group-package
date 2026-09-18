<?php

declare(strict_types=1);

namespace Einundzwanzig\Group\Portal;

use Livewire\Component;

/**
 * Base of the read-only Portal pages (D9): meetups list/detail, Termine, courses,
 * lecturers.
 *
 * ── What it carries and why exactly this ─────────────────────────────────────────
 *  1. **The catalog, resolved once per request.** Five surfaces read the same lists; a
 *     second `app(PortalCatalog::class)` per computed property would be a second status.
 *  2. **The status banner.** A read-only page over a foreign API has three outcomes
 *     (fresh · stale · offline, {@see PortalStatus}) and has to say which one it shows.
 *     The page renders the data FIRST and the banner above it — a stale list is worth
 *     more than an error screen.
 *  3. **The three affordances** as Livewire actions, so a Blade file never asks whether
 *     it runs in the app.
 *
 * ── What it deliberately does NOT carry ──────────────────────────────────────────
 * No writes. Creating and editing Portal content needs a Portal token, and the package
 * knows nothing about one; the app keeps those flows and reaches them through the
 * `portal_detail_actions` slot. And no RSVP — that is D12/P5 and hangs on a 31923 this
 * phase only carries (`PortalEvent::$nostrAddress`).
 */
abstract class GroupPortalPage extends Component
{
    /**
     * Was „Erneut versuchen" pressed in this request? Only relevant for the app arm,
     * which gives haptic/dialog feedback after the re-render.
     */
    protected bool $retrying = false;

    private ?PortalCatalog $catalog = null;

    protected function catalog(): PortalCatalog
    {
        return $this->catalog ??= app(PortalCatalog::class);
    }

    protected function affordances(): PortalAffordances
    {
        return app(PortalAffordances::class);
    }

    /**
     * Does this host share through a native sheet? Read by the surface for the LABEL only
     * („Teilen" vs. „Link teilen").
     *
     * Public because a Blade view cannot call a protected method (its compiled closure is
     * not inside this class), and it returns a BOOLEAN on purpose: every public method of
     * a Livewire component is callable from the client, so what leaves here must be a
     * scalar and must not do anything.
     */
    public function nativeShare(): bool
    {
        return $this->affordances()->canShareNatively();
    }

    /**
     * The status of THIS render. Read after the data — the catalog only knows it once it
     * has been asked, so a banner computed before the list would always say `fresh`.
     */
    public function portalStatus(): PortalStatus
    {
        return $this->catalog()->status();
    }

    /**
     * „Erneut versuchen": the re-render reads the catalog again, and failures are never
     * cached, so there is nothing to invalidate here. The flag exists for the app's
     * native feedback (`dehydrate()` in its own binding of the pages).
     */
    public function retry(): void
    {
        $this->retrying = true;
    }

    // ── The affordances as actions ──────────────────────────────────────────────

    public function openLink(string $url): void
    {
        $this->affordances()->openLink($this, $url);
    }

    protected function shareTarget(string $title, string $text, string $url): void
    {
        $this->affordances()->share($this, $title, $text, $url);
    }

    protected function calendarFor(?int $meetupId, ?PortalEvent $event = null): void
    {
        $this->affordances()->addToCalendar($this, $meetupId, $event);
    }

    /**
     * The host view a detail page ends with — „Im Portal bearbeiten" on the web, the
     * editor sheets in the app (`config('group.portal_detail_actions')`, null = nothing).
     *
     * Public for the same two reasons as {@see nativeShare()}: Blade needs it, and a
     * config string is a safe thing to hand a client that calls it as an action.
     */
    public function detailActionsView(): ?string
    {
        $view = config('group.portal_detail_actions');

        return is_string($view) && $view !== '' ? $view : null;
    }
}
