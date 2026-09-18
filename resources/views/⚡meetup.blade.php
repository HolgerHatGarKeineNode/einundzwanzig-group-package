<?php

use Einundzwanzig\Group\ImageProxy;
use Einundzwanzig\Group\Portal\GroupPortalPage;
use Einundzwanzig\Group\Portal\PortalMeetupDetail;
use Illuminate\Support\Facades\View;
use Livewire\Attributes\Computed;
use Livewire\Attributes\Layout;

/**
 * `/bereich/meetups/{slug}` — one meetup, read-only (D9, P4).
 *
 * Everything on this page is readable without a key (D4): a meetup page is what a guest
 * follows from a shared link, and putting „come to our meetup" behind a login is the
 * opposite of what the surface is for.
 *
 * ── The three things that are NOT read-only, and where they went ─────────────────
 *  · Editing the meetup → the host's `portal_detail_actions` slot: on the web a link into
 *    the Portal, in the app its own editor sheet (it has the Portal token, the package
 *    does not).
 *  · RSVP → built in P5 (D12): `x-group::rsvp-termin` under the next date and under every
 *    further one. Which arm it shows — the Nostr answer, the host's REST controls or the
 *    link into the Portal — is decided from the payload's `nostr_address`,
 *    `attendees_public` and `rsvp_enabled`; the rule is `js/rsvpRule.ts`.
 *  · The room chat → an existing package route (`group.room`), reached through the auth
 *    gate: the button only appears when the Portal says a room exists (`has_room`), because
 *    the member-only relay hands out kind 39000 only AUTH-gated and a button into a room
 *    that is not there is worse than no button.
 */
new #[Layout('group::einundzwanzig')] class extends GroupPortalPage
{
    public string $slug = '';

    public function mount(string $slug): void
    {
        $this->slug = $slug;
    }

    #[Computed]
    public function meetup(): ?PortalMeetupDetail
    {
        return $this->catalog()->meetup($this->slug);
    }

    /** Share the meetup — its next date if it has one, the page otherwise. */
    public function teilen(): void
    {
        $detail = $this->meetup();
        if ($detail === null) {
            return;
        }

        $ziel = $detail->portalLink ?? $detail->meetup->portalLink((string) config('group.portal_url'));
        $text = $detail->nextEvent === null
            ? $detail->meetup->name
            : __(':name am :date', [
                'name' => $detail->meetup->name,
                'date' => $detail->nextEvent->start->translatedFormat('d.m.Y · H:i'),
            ]);

        $this->shareTarget($detail->meetup->name, $text, $detail->nextEvent?->link ?? $ziel);
    }

    /** The meetup's dates as a calendar subscription (web: the Portal's own feed). */
    public function kalender(): void
    {
        $detail = $this->meetup();
        $this->calendarFor($detail?->meetup->id, $detail?->nextEvent);
    }

    public function render()
    {
        $detail = $this->meetup();
        // OG image = the meetup logo: this page IS the shared link (D4), so the preview
        // card has to carry the meetup and not the client's generic mark.
        View::share('ogImage', $detail?->meetup->logo !== null ? url(ImageProxy::url($detail->meetup->logo, 'og')) : null);

        return $this->view()->title($detail?->meetup->name ?? __('Meetup'));
    }
}; ?>

<x-group::app-shell>

    <div class="page-enter">

        {{-- `:back` to the list, and an explicit target instead of `history.back()`: a
             cold start from a shared link has no stack to go back in. --}}
        <x-group::app-header :title="$this->meetup?->meetup->name ?? __('Meetup')"
                             :back="route('group.bereich.meetups')" />

        <x-group::portal-status :status="$this->portalStatus()" class="mb-4" />

        @if ($this->meetup === null)
            <x-group::portal-leer icon="map-pin"
                                  :status="$this->portalStatus()"
                                  :heading="__('Meetup nicht gefunden')"
                                  :text="__('Dieses Meetup ist nicht (mehr) im Portal gelistet.')" />
        @else
            @php($detail = $this->meetup)
            @php($meetup = $detail->meetup)
            @php($portalLink = $detail->portalLink ?? $meetup->portalLink((string) config('group.portal_url')))

            <section class="surface-card p-6" data-portal-meetup-kopf="{{ $meetup->slug }}">
                <div class="flex items-start gap-4">
                    <flux:avatar size="lg" src="{{ ImageProxy::url($meetup->logo) }}" name="{{ $meetup->name }}" />
                    <div class="min-w-0 flex-1">
                        <flux:heading size="xl" level="1" class="break-words">{{ $meetup->name }}</flux:heading>
                        <flux:text class="mt-1 text-sm text-muted">{{ $meetup->city }}{{ $meetup->country !== '' ? ' · '.$meetup->country : '' }}</flux:text>
                    </div>
                </div>

                <div class="mt-4 flex flex-wrap gap-2">
                    @if ($detail->roomH() !== null)
                        {{-- Into the meetup's private NIP-29 room. A HARD load through the
                             auth gate and NOT `wire:navigate`: in the app the welshman
                             island boots only on a full document load, and the gate sends a
                             guest to the login instead of into a 302 (`nav-tab` uses the
                             same rule). --}}
                        <flux:button size="sm" variant="primary" icon="chat-bubble-left-right"
                                     href="{{ route('group.room', $detail->roomH()) }}"
                                     data-portal-raum="{{ $detail->roomH() }}"
                                     x-on:click="$store.authGate?.gateTap($event, { label: @js($meetup->name) })">
                            {{ __('Zum Raum-Chat') }}
                        </flux:button>
                    @endif
                    <flux:button size="sm" icon="share" wire:click="teilen" data-portal-teilen>
                        {{ $this->nativeShare() ? __('Teilen') : __('Link teilen') }}
                    </flux:button>
                    @if ($meetup->id !== null)
                        <flux:button size="sm" variant="ghost" icon="calendar-days" wire:click="kalender" data-portal-kalender>
                            {{ __('Zum Kalender') }}
                        </flux:button>
                    @endif
                </div>
            </section>

            @if ($detail->nextEvent !== null)
                @php($next = $detail->nextEvent)
                <section class="surface-card mt-4 p-6" data-portal-naechster-termin>
                    <flux:heading size="lg" level="2">{{ __('Nächster Termin') }}</flux:heading>
                    <div class="mt-3 flex items-center gap-3">
                        <span class="flex size-11 shrink-0 items-center justify-center rounded-tile bg-brand-500/10 text-brand-800 dark:text-brand-400">
                            <flux:icon.calendar-days class="size-6" />
                        </span>
                        <div class="min-w-0">
                            <span class="font-semibold">{{ $next->start->translatedFormat('l, d. F Y · H:i') }}</span>
                            @if ($next->location !== null)
                                <flux:text class="truncate text-sm text-muted">{{ $next->location }}</flux:text>
                            @endif
                        </div>
                    </div>
                    @if ($next->description !== null)
                        <flux:text class="mt-3 text-sm whitespace-pre-line">{{ $next->description }}</flux:text>
                    @endif
                    {{-- The counts, and ONLY when the Portal publishes them
                         (`attendees_public`): a „0 Zusagen" over a meetup that deliberately
                         hides its list would be a number invented by this client.
                         These are the PORTAL's counters (REST RSVPs plus the Nostr ones its
                         ingest has already picked up); the Nostr counter below is what this
                         client sees on the relays right now, which is the faster of the two
                         and the only one that moves on a tap. --}}
                    @if ($detail->attendeesPublic && $next->attendees !== null)
                        <div class="mt-3 flex items-center gap-2 text-sm text-muted" data-portal-zusagen>
                            <flux:icon.users variant="micro" class="size-4" aria-hidden="true" />
                            <span>{{ trans_choice('{0}Noch keine Zusagen|{1}:count Zusage|[2,*]:count Zusagen', $next->attendees, ['count' => $next->attendees]) }}</span>
                            @if (($next->mightAttendees ?? 0) > 0)
                                <span aria-hidden="true">·</span>
                                <span>{{ __(':count mal „vielleicht"', ['count' => $next->mightAttendees]) }}</span>
                            @endif
                        </div>
                    @endif
                    {{-- „Zusagen" (D12/P5). Which arm appears is decided by the component: the
                         Nostr one for a date the Portal published on a meetup that allows a
                         public answer, the Portal link-out resp. the host's REST controls
                         otherwise. `portalLink` is the meetup's page and not the date's
                         `link` — the latter is the ORGANISER's own address (a Telegram post,
                         a Luma page) and answering there is not answering the Portal. --}}
                    <div class="mt-4">
                        <x-group::rsvp-termin :address="$next->nostrAddress"
                                              :attendees-public="$detail->attendeesPublic"
                                              :rsvp-enabled="$detail->rsvpEnabled && $next->rsvpEnabled"
                                              :event-id="$next->id"
                                              :portal-link="$portalLink" />
                    </div>

                    @if ($next->link !== null)
                        <div class="mt-4">
                            <flux:button size="sm" variant="ghost" icon="arrow-top-right-on-square"
                                         wire:click="openLink(@js($next->link))" data-portal-termin-link>
                                {{ __('Zum Termin') }}
                            </flux:button>
                        </div>
                    @endif
                </section>
            @endif

            @if ($detail->upcoming !== [])
                <section class="surface-card mt-4 p-6">
                    <flux:heading size="lg" level="2">{{ __('Weitere Termine') }}</flux:heading>
                    <div class="mt-3 flex flex-col gap-3">
                        @foreach ($detail->upcoming as $event)
                            <div wire:key="weiterer-{{ $event->start->getTimestamp() }}" class="flex items-center gap-3">
                                <span class="flex size-10 shrink-0 items-center justify-center rounded-tile bg-brand-500/10 text-brand-800 dark:text-brand-400">
                                    <flux:icon.calendar-days class="size-5" />
                                </span>
                                <div class="min-w-0 flex-1">
                                    <span class="font-semibold">{{ $event->start->translatedFormat('D, d. M · H:i') }}</span>
                                    @if ($event->location !== null)
                                        <flux:text class="truncate text-sm text-muted">{{ $event->location }}</flux:text>
                                    @endif
                                </div>
                                {{-- The compact arm on the further dates too: the store batches
                                     them into the SAME relay query as the next one, so a second
                                     date costs no second round trip — and somebody who can only
                                     make the date in three weeks should not have to wait for it
                                     to become the next one. --}}
                                <x-group::rsvp-termin kompakt
                                                      class="shrink-0"
                                                      :address="$event->nostrAddress"
                                                      :attendees-public="$detail->attendeesPublic"
                                                      :rsvp-enabled="$detail->rsvpEnabled && $event->rsvpEnabled"
                                                      :event-id="$event->id"
                                                      :portal-link="$portalLink" />
                            </div>
                        @endforeach
                    </div>
                </section>
            @endif

            @if ($detail->intro !== null)
                <section class="surface-card mt-4 p-6">
                    <flux:heading size="lg" level="2">{{ __('Über das Meetup') }}</flux:heading>
                    {{-- The intro is MARKDOWN in the Portal and is rendered as TEXT here,
                         with line breaks preserved. Not `{!! !!}`: the field is edited by
                         meetup leaders, so it is foreign input, and a markdown renderer in
                         this package would be a dependency (and an HTML sink) for one
                         paragraph. `whitespace-pre-line` keeps what the author intended
                         about structure; the link syntax stays visible, which is honest. --}}
                    <flux:text class="mt-3 text-sm whitespace-pre-line">{{ $detail->intro }}</flux:text>
                </section>
            @endif

            @if ($detail->links !== [])
                <section class="surface-card mt-4 p-6">
                    <flux:heading size="lg" level="2">{{ __('Links') }}</flux:heading>
                    <div class="mt-3 flex flex-col gap-2">
                        @foreach ($detail->links as $label => $url)
                            {{-- A BUTTON and not an `<a>`: in the app these have to open in
                                 the in-app browser resp. hand a messenger link to the
                                 installed app (`PortalAffordances::openLink`), and the
                                 scheme check lives there. Portal data is foreign input. --}}
                            <button type="button" wire:click="openLink(@js($url))"
                                    wire:key="link-{{ $loop->index }}"
                                    data-portal-link="{{ $label }}"
                                    class="pressable flex items-center gap-3 rounded-tile border border-zinc-200 px-4 py-3 text-start dark:border-zinc-800">
                                <flux:icon.link class="size-5 shrink-0 text-zinc-400" aria-hidden="true" />
                                <span class="flex min-w-0 flex-col">
                                    <span class="font-semibold">{{ $label }}</span>
                                    <span class="truncate text-sm text-muted">{{ $url }}</span>
                                </span>
                            </button>
                        @endforeach
                    </div>
                </section>
            @endif

            {{-- The host's block: „Im Portal bearbeiten" (web) resp. the editor sheets (app).
                 Nothing at all when a host binds nothing — an empty section would promise an
                 action this client does not have. --}}
            @if ($this->detailActionsView())
                <div class="mt-4">
                    @include($this->detailActionsView(), [
                        'portalLink' => $portalLink,
                        'meetupId' => $meetup->id,
                        'meetupSlug' => $meetup->slug,
                    ])
                </div>
            @endif
        @endif
    </div>
</x-group::app-shell>
