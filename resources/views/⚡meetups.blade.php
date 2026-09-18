<?php

use Einundzwanzig\Group\Portal\GroupPortalPage;
use Einundzwanzig\Group\Portal\PortalEvent;
use Einundzwanzig\Group\Portal\PortalMeetup;
use Carbon\CarbonImmutable;
use Livewire\Attributes\Computed;
use Livewire\Attributes\Layout;
use Livewire\Attributes\Url;

/**
 * `/bereich/meetups` — the read-only meetup surface of the association portal (D9, P4).
 *
 * Three views behind ONE address (`?ansicht=`): the list, the dates („Termine") and, where
 * a host binds it, the map. One route and not three, because the meetups are one place —
 * switching the view must not change the address you share.
 *
 * ── Why this page renders SERVER-side while everything else here is an island ─────
 * The rest of this client reads Nostr, which only the browser can do (the key never leaves
 * it). The Portal is plain HTTP with public lists, and the request has to happen on the
 * SERVER: the Portal throttles at 60/min per IP (R9), and a per-visitor browser request
 * would also hand it every reader's IP. So the data comes through {@see PortalCatalog},
 * cached once for the whole instance, and the page is ordinary Livewire.
 *
 * ── Why there is no RSVP here ────────────────────────────────────────────────────
 * That is D12/P5. This phase only CARRIES the 31923 coordinate the Portal publishes
 * (`PortalEvent::$nostrAddress`); the rule which button appears for which date is built
 * where the publishing lives.
 */
new #[Layout('group::einundzwanzig')] class extends GroupPortalPage
{
    /** `liste` · `termine` · `karte` — normalised against `config('group.meetup_views')`. */
    #[Url]
    public string $ansicht = 'liste';

    #[Url(as: 'q')]
    public string $suche = '';

    /** ISO-3166-1 alpha-2, lower case ('' = every country). */
    #[Url]
    public string $land = '';

    /**
     * How many rows of the list are rendered. The Portal has 312 meetups (measured
     * 2026-09-18); rendering them all costs a Flux card and a logo request each, and on a
     * phone that is a visible paint. The sentinel at the end of the list asks for the next
     * window.
     */
    public int $sichtbar = self::FENSTER;

    private const FENSTER = 24;

    public function mount(): void
    {
        /*
         * An unknown `?ansicht=` falls back to the list instead of rendering nothing. The
         * token set is a host decision (`meetup_views` — the companion adds `karte`), so a
         * link to the map from an app build opened on the web must not end in a blank
         * surface.
         */
        if (! in_array($this->ansicht, $this->ansichten(), true)) {
            $this->ansicht = 'liste';
        }
    }

    /** @return list<string> */
    public function ansichten(): array
    {
        $views = (array) config('group.meetup_views', ['liste', 'termine']);

        return array_values(array_filter($views, static fn ($view): bool => is_string($view) && $view !== ''));
    }

    /** The host view that renders `?ansicht=karte`, or null when this host has no map. */
    public function kartenView(): ?string
    {
        $view = config('group.meetup_map_view');

        return is_string($view) && $view !== '' ? $view : null;
    }

    public function updatedSuche(): void
    {
        $this->sichtbar = self::FENSTER;
    }

    public function updatedLand(): void
    {
        $this->sichtbar = self::FENSTER;
    }

    public function updatedAnsicht(): void
    {
        $this->sichtbar = self::FENSTER;
    }

    public function mehr(): void
    {
        $this->sichtbar += self::FENSTER;
    }

    /** Out of an empty filter with one tap (the empty state offers it). */
    public function filterLeeren(): void
    {
        $this->suche = '';
        $this->land = '';
        $this->sichtbar = self::FENSTER;
    }

    /**
     * The meetups after search and country filter.
     *
     * Sorted like the Portal itself: the one with the next upcoming date first, meetups
     * without a date last, alphabetical within both — a list sorted by name alone would
     * bury exactly the information someone opens this page for.
     *
     * @return list<PortalMeetup>
     */
    #[Computed]
    public function meetups(): array
    {
        $suche = mb_strtolower(trim($this->suche));
        $land = mb_strtolower($this->land);

        $rows = array_values(array_filter(
            $this->alleMeetups(),
            static function (PortalMeetup $meetup) use ($suche, $land): bool {
                if ($land !== '' && $meetup->countryCode() !== $land) {
                    return false;
                }

                return $suche === ''
                    || str_contains(mb_strtolower($meetup->name), $suche)
                    || str_contains(mb_strtolower($meetup->city), $suche);
            },
        ));

        usort($rows, static function (PortalMeetup $a, PortalMeetup $b): int {
            return [$a->nextEventStart === null, $a->nextEventStart?->getTimestamp() ?? 0, mb_strtolower($a->name)]
                <=> [$b->nextEventStart === null, $b->nextEventStart?->getTimestamp() ?? 0, mb_strtolower($b->name)];
        });

        return $rows;
    }

    /**
     * The country codes that actually occur, plus the selected one.
     *
     * The selected code is kept even when the current filter leaves no meetup in it —
     * otherwise the select would silently jump to „all countries" and the user would see a
     * result for a question they did not ask.
     *
     * @return list<string>
     */
    #[Computed]
    public function laender(): array
    {
        $codes = [];
        foreach ($this->alleMeetups() as $meetup) {
            if ($meetup->countryCode() !== '') {
                $codes[$meetup->countryCode()] = true;
            }
        }
        if ($this->land !== '') {
            $codes[mb_strtolower($this->land)] = true;
        }

        $list = array_keys($codes);
        sort($list);

        return array_values($list);
    }

    /**
     * The dates of the „Termine" view — from today to the end of next month.
     *
     * Not „everything": the full date list is 4.6 MB and a list scrolling into next year
     * is not a surface anybody reads. The same window the palette index uses, so the two
     * cannot disagree about which date is „upcoming".
     *
     * @return list<PortalEvent>
     */
    #[Computed]
    public function termine(): array
    {
        $land = mb_strtolower($this->land);
        $von = CarbonImmutable::today();
        $bis = $von->addMonth()->endOfMonth();

        return array_values(array_filter(
            $this->catalog()->events($von->toDateString(), $bis->toDateString()),
            static fn (PortalEvent $event): bool => $land === '' || mb_strtolower($event->meetupCountry) === $land,
        ));
    }

    /**
     * The dates grouped by day, in order — the heading of a day group is the day.
     *
     * @return array<string, list<PortalEvent>>
     */
    #[Computed]
    public function tage(): array
    {
        $tage = [];
        foreach ($this->termine() as $event) {
            $tage[$event->day()][] = $event;
        }

        return $tage;
    }

    /** @return list<PortalMeetup> */
    private function alleMeetups(): array
    {
        return $this->catalog()->meetups();
    }

    public function render()
    {
        /*
         * Ask the catalog BEFORE the markup starts.
         *
         * The banner („these data are not up to date") is the FIRST thing on the page and
         * the catalog only knows its status once it has been asked — rendered in document
         * order it would always say „fresh" and the whole notice would be dead markup. Cost
         * exactly one green-for-the-wrong-reason case in `PortalSeitenTest`.
         *
         * Property access and not `$this->termine()`: the computed memoizes, so the view
         * below reads the same list instead of filtering it twice.
         */
        $this->ansicht === 'termine' ? $this->termine : $this->meetups;

        return $this->view()->title(__('Meetups'));
    }
}; ?>

<x-group::app-shell width="wide">

    <div class="page-enter">

        {{-- NO `:back`: „Meetups" is an area tile of Start, on the same level — between them
             there is no „back", there is „somewhere else" (same rule as the Postfach). --}}
        <x-group::app-header :title="__('Meetups')" />

        {{-- The view switch. Only the views this host HAS (`meetup_views`); the map is the
             one that a host binds (`meetup_map_view`) and the web does not. --}}
        @if (count($this->ansichten()) > 1)
            <flux:tabs wire:model.live="ansicht" variant="segmented" class="mb-4 w-full" data-meetups-ansichten>
                @foreach ($this->ansichten() as $view)
                    <flux:tab name="{{ $view }}" data-meetups-ansicht="{{ $view }}">
                        @switch($view)
                            @case('termine') {{ __('Termine') }} @break
                            @case('karte') {{ __('Karte') }} @break
                            @default {{ __('Liste') }}
                        @endswitch
                    </flux:tab>
                @endforeach
            </flux:tabs>
        @endif

        {{-- ── The one honest sentence about the data (D9) ───────────────────────────
             Read AFTER the lists above have been resolved — the catalog only knows its
             status once it has been asked. „stale" keeps the list and says it is old;
             „offline" has no list to keep, so the empty state below carries the message. --}}
        <x-group::portal-status :status="$this->portalStatus()" class="mb-4" />

        @if ($ansicht === 'karte')
            @if ($this->kartenView())
                {{-- The host's map. `$meetups` is in scope; the view brings its own Leaflet
                     (lazy — it is ~150 kB and nothing else on this page needs it). --}}
                @include($this->kartenView(), ['meetups' => $this->meetups])
            @else
                {{-- No map in this host (web). Instead of a blank tab: the Portal's own map,
                     marked as leaving the client. Not a silent redirect — a tab that
                     navigates away without saying so is the worse surprise. --}}
                <div class="surface-card empty-state flex flex-col items-center gap-3 p-8 text-center">
                    <flux:icon.map class="size-8 text-muted" />
                    <flux:heading size="lg">{{ __('Karte im Portal') }}</flux:heading>
                    <flux:text class="max-w-xs text-sm text-muted">
                        {{ __('Die Meetup-Karte liegt im Portal — dort steht sie mit allen Orten und Filtern.') }}
                    </flux:text>
                    <flux:button size="sm" icon="arrow-top-right-on-square" data-meetups-karte-extern
                                 href="{{ rtrim((string) config('group.portal_url'), '/') }}/de/map"
                                 target="_blank" rel="external noopener">
                        {{ __('Karte öffnen (öffnet das Portal)') }}
                    </flux:button>
                </div>
            @endif
        @elseif ($ansicht === 'termine')
            {{-- ── Termine ─────────────────────────────────────────────────────────
                 Grouped by day, and every row leads to its MEETUP: a date has no page of
                 its own (D9 — it is shown on the meetup and here), and a row that leads
                 nowhere is not a row. --}}
            <div class="mb-4">
                <x-group::portal-land-filter :laender="$this->laender" :land="$land" />
            </div>

            @if ($this->termine === [])
                <x-group::portal-leer icon="calendar-days"
                                      :status="$this->portalStatus()"
                                      :heading="__('Keine Termine')"
                                      :text="$land !== ''
                                          ? __('Für diese Region sind bis Ende des nächsten Monats keine Termine eingetragen.')
                                          : __('Bis Ende des nächsten Monats sind keine Meetup-Termine eingetragen.')"
                                      :reset="$land !== '' ? 'filterLeeren' : null" />
            @else
                <div class="flex flex-col gap-6">
                    @foreach ($this->tage as $tag => $eventsDesTages)
                        <section wire:key="tag-{{ $tag }}" class="list-stagger flex flex-col gap-2">
                            <flux:heading size="sm" level="2" class="text-muted">
                                {{ $eventsDesTages[0]->start->translatedFormat('l, d. F') }}
                            </flux:heading>
                            @foreach ($eventsDesTages as $event)
                                <a href="{{ route('group.bereich.meetups.show', $event->meetupSlug) }}" wire:navigate
                                   wire:key="termin-{{ $tag }}-{{ $loop->index }}"
                                   data-portal-termin="{{ $event->meetupSlug }}"
                                   class="surface-card pressable flex items-center gap-3 p-4 text-start">
                                    <flux:avatar size="sm" src="{{ \Einundzwanzig\Group\ImageProxy::url($event->meetupLogo) }}" name="{{ $event->meetupName }}" />
                                    <span class="flex min-w-0 flex-1 flex-col gap-0.5">
                                        <span class="truncate font-medium">{{ $event->meetupName }}</span>
                                        <span class="truncate text-sm text-muted">
                                            {{ $event->start->format('H:i') }}{{ $event->location !== null ? ' · '.$event->location : '' }}
                                        </span>
                                    </span>
                                    <flux:icon.chevron-right class="size-4 shrink-0 text-zinc-400" />
                                </a>
                            @endforeach
                        </section>
                    @endforeach
                </div>
            @endif
        @else
            {{-- ── Liste ───────────────────────────────────────────────────────────── --}}
            <div class="mb-4 flex flex-col gap-2">
                {{-- `aria-label` NEXT to the placeholder: the placeholder disappears on the
                     first keystroke and does not count as an accessible name (WCAG 4.1.2). --}}
                <flux:input wire:model.live.debounce.300ms="suche"
                            type="search"
                            icon="magnifying-glass"
                            data-portal-suche
                            clearable
                            :aria-label="__('Meetup oder Stadt suchen')"
                            :placeholder="__('Meetup oder Stadt suchen …')" />
                <x-group::portal-land-filter :laender="$this->laender" :land="$land" />
            </div>

            @if ($this->meetups === [])
                <x-group::portal-leer icon="map-pin"
                                      :status="$this->portalStatus()"
                                      :heading="__('Keine Meetups gefunden')"
                                      :text="__('Versuche eine andere Suche oder einen anderen Länderfilter.')"
                                      :reset="$land !== '' || $suche !== '' ? 'filterLeeren' : null" />
            @else
                <div class="list-stagger flex flex-col gap-3" data-portal-meetups>
                    @foreach (array_slice($this->meetups, 0, $sichtbar) as $meetup)
                        <a href="{{ route('group.bereich.meetups.show', $meetup->slug) }}" wire:navigate
                           wire:key="meetup-{{ $meetup->slug }}"
                           data-portal-meetup="{{ $meetup->slug }}"
                           class="surface-card pressable flex items-center gap-3 p-4">
                            <flux:avatar src="{{ \Einundzwanzig\Group\ImageProxy::url($meetup->logo) }}" name="{{ $meetup->name }}" />
                            <span class="flex min-w-0 flex-1 flex-col gap-0.5">
                                <span class="truncate font-medium">{{ $meetup->name }}</span>
                                <span class="truncate text-sm text-muted">{{ $meetup->city }}{{ $meetup->country !== '' ? ' · '.$meetup->country : '' }}</span>
                                @if ($meetup->nextEventStart !== null)
                                    <span class="mt-1 w-fit">
                                        <flux:badge color="orange" size="sm">{{ $meetup->nextEventStart->translatedFormat('D, d. M · H:i') }}</flux:badge>
                                    </span>
                                @endif
                            </span>
                            <flux:icon.chevron-right class="size-4 shrink-0 text-zinc-400" />
                        </a>
                    @endforeach
                </div>

                @if (count($this->meetups) > $sichtbar)
                    {{-- The next window. The sentinel asks for it ~400 px before it becomes
                         visible (native IntersectionObserver, no library); the BUTTON inside
                         it is not decoration — without it the list would be unreachable for
                         anyone on a keyboard or with JS off. --}}
                    <div wire:key="mehr-{{ $sichtbar }}" class="mt-4 flex justify-center"
                         x-data="{ io: null,
                                   init() {
                                       this.io = new IntersectionObserver((entries) => {
                                           if (entries[0].isIntersecting) { $wire.mehr() }
                                       }, { rootMargin: '400px' })
                                       this.io.observe($el)
                                   },
                                   destroy() { this.io?.disconnect() } }">
                        <flux:button size="sm" variant="ghost" wire:click="mehr" data-portal-mehr>
                            {{ __('Mehr laden') }}
                        </flux:button>
                    </div>
                @endif
            @endif
        @endif
    </div>
</x-group::app-shell>
