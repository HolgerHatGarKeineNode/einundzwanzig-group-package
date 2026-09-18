@props([
    /** The 31923 coordinate the Portal published for this date, or null (`nostr_address`). */
    'address' => null,
    /** `attendees_public` of the meetup — D12a forbids a NOSTR answer where it is false. */
    'attendeesPublic' => true,
    /** `rsvp_enabled` of the meetup — false switches every RSVP off, both paths. */
    'rsvpEnabled' => true,
    /** The Portal's `meetup_events.id` — the only thing the app's REST arm needs. */
    'eventId' => null,
    /** Where „Im Portal zusagen" leads. Without it the link-out is left out. */
    'portalLink' => null,
    /** One row of a list instead of a block on a page: no explaining prose, no counter line. */
    'kompakt' => false,
    /**
     * An ALPINE EXPRESSION that evaluates to the coordinate, for the one surface where the
     * server does not know it: the next-date row on Start reads its date out of the palette
     * index in the browser (D4 — Start holds no server state). With `ausdruck` set the
     * server-side arm decision is skipped and the Nostr arm is always rendered; the
     * surrounding island gates its visibility and registers the address with the store.
     */
    'ausdruck' => null,
])

{{-- ══ „Zusagen" for a Portal date (D12/D12a, P5) ═══════════════════════════════════

     ── The rule is split, and the split is the design ─────────────────────────────────
     The SERVER decides which ARM is rendered, the browser decides whether the Nostr arm may
     actually be pressed. That is not a division of labour by taste: `rsvp_enabled`,
     `attendees_public` and `nostr_address` come out of the Portal payload and are known
     here, while „is the 31923 really on the relays, from a configured author, neither
     cancelled nor over" can only be answered by a client that talks to the relays. Both
     halves live in ONE place each — `js/rsvpRule.ts` for the decision,
     `js/rsvpTermine.ts` for the relay round.

     Deciding the arm on the SERVER also keeps the app's REST controls out of the DOM of
     every date that has a coordinate: they are a Livewire component with server state and a
     Portal request per mount, and mounting them „just in case" behind an `x-show` would pay
     for sixty of them on the Termine list.

     ── The three arms ─────────────────────────────────────────────────────────────────
       `rsvp_enabled = false`      nothing at all. The Portal refuses both paths
                                   (`MeetupEventController::rsvp` → 422), so a button here
                                   would be a promise this client cannot keep.
       Nostr arm                   a coordinate, a public guest list and RSVP switched on:
                                   the island below. It publishes a kind 31925 to the
                                   calendar relays AND the user's own write relays.
       REST arm                    no coordinate, or the meetup keeps its attendance
                                   private. On the web that is the link into the Portal; in
                                   the app it is `config('group.portal_rsvp_view')` — its own
                                   REST controls, which the Portal still accepts. --}}

@php($nostrArm = $ausdruck !== null || ($rsvpEnabled && $attendeesPublic && is_string($address) && $address !== ''))
@php($restView = config('group.portal_rsvp_view'))

@if (! $rsvpEnabled)
    {{-- Nothing. Deliberately not even a sentence: „Anmeldung ist deaktiviert" would be a
         notice about an absence on a page full of dates, and the meetup that switched it off
         says so on its own page. --}}
@elseif ($nostrArm)
    <div x-data="{
             get adresse() { return {{ $ausdruck ?? Js::from($address) }} || '' },
             init() { $store.rsvpTermine?.track(this.adresse) },
             get zeile() { return $store.rsvpTermine?.row(this.adresse) ?? {} },
             get wartet() { return $store.rsvpTermine?.wartet?.address === this.adresse },
         }"
         x-show="zeile.offen || zeile.myStatus"
         x-cloak
         x-bind:data-rsvp-termin="adresse"
         {{ $attributes->merge(['class' => 'flex flex-col gap-2']) }}>

        {{-- The counter, and only on the block form: in a list row the number would compete
             with the date for the same 40 px. „N kommen" carries colour, so it is TEXT in the
             sense of 1.4.3 — `brand-800`/`brand-400`, like the date of the meetup tile. --}}
        @unless ($kompakt)
            <div class="flex items-center gap-2 text-sm">
                <flux:icon.users variant="micro" class="size-4 shrink-0 text-muted" aria-hidden="true" />
                <span class="font-semibold text-brand-800 dark:text-brand-400"
                      data-rsvp-zaehler
                      x-text="$plural(zeile.attending ?? 0, '1 kommt über Nostr', ':count kommen über Nostr')"></span>
            </div>
        @endunless

        <div class="flex flex-wrap items-center gap-1.5">
            {{-- `aria-pressed` and not a class of its own: the two buttons are ONE toggle with
                 two states, and a screen reader should hear the current one rather than only
                 see it. The static `false` stands in the markup so that it is right before
                 Alpine boots — same rule as the search button in the header. --}}
            <flux:button size="sm" variant="ghost" icon="check" class="text-btn-touch"
                         data-rsvp-ja
                         aria-pressed="false"
                         x-bind:aria-pressed="zeile.myStatus === 'accepted' ? 'true' : 'false'"
                         x-bind:class="zeile.myStatus === 'accepted' ? 'bg-brand-500/15 text-brand-500!' : ''"
                         x-bind:disabled="zeile.busy || ! zeile.offen"
                         x-on:click="$store.rsvpTermine?.rsvp(adresse, 'accepted')">
                {{ __('Zusagen') }}
            </flux:button>
            <flux:button size="sm" variant="ghost" icon="x-mark" class="text-btn-touch"
                         data-rsvp-nein
                         aria-pressed="false"
                         x-bind:aria-pressed="zeile.myStatus === 'declined' ? 'true' : 'false'"
                         x-bind:class="zeile.myStatus === 'declined' ? 'bg-brand-500/15 text-brand-500!' : ''"
                         x-bind:disabled="zeile.busy || ! zeile.offen"
                         x-on:click="$store.rsvpTermine?.rsvp(adresse, 'declined')">
                {{ __('Absagen') }}
            </flux:button>
        </div>

        {{-- ── The disclosure, once per device, as a STEP ────────────────────────────
             A press writes a signed, public, permanent event to relays this client does not
             own, and one query against the coordinate returns the complete guest list
             (measured at a foreign coordinate: 13 pubkeys). „Absagen" REPLACES the answer at
             the relay; it does not recall what has already propagated.

             The room's date card states the same thing as a standing line next to its single
             button. Here the button often stands in a list of sixty rows, where a sentence
             per row is not readable — so the sentence appears ONCE, in front of the first
             answer, and the same tap carries that answer out („Verstanden & zusagen"). The
             acknowledgement lives in `localStorage` and belongs to the DEVICE, not to the
             account: what it explains is a property of the mechanism, not of a key.

             `x-show` and not `<template x-if>`: the panel belongs to THIS row and its two
             buttons must keep their focus order next to the row's own. --}}
        <div x-show="wartet" x-cloak data-rsvp-hinweis
             class="surface-card border border-brand-500/30 p-3 text-sm">
            <p class="text-muted">
                {{ __('Eine Zusage ist ein signiertes, öffentliches Ereignis auf fremden Relays — sie bleibt dort, auch nach einer Absage. Der Zähler ist ungeprüft: er zählt Signaturen, nicht Personen.') }}
            </p>
            <div class="mt-3 flex flex-wrap gap-2">
                <flux:button size="sm" variant="primary" data-rsvp-hinweis-ok
                             x-on:click="$store.rsvpTermine?.hinweisBestaetigen()">
                    {{ __('Verstanden & zusagen') }}
                </flux:button>
                <flux:button size="sm" variant="ghost" data-rsvp-hinweis-abbruch
                             x-on:click="$store.rsvpTermine?.hinweisAbbrechen()">
                    {{ __('Abbrechen') }}
                </flux:button>
            </div>
        </div>

        {{-- PARTIAL result: some relays took the answer, others did not. Not an error and not
             a success — the answer IS out there, just not everywhere, and the reader is told
             where. On the recommended two-relay configuration this is the ORDINARY case
             (measured 2026-09-05: `relay.damus.io` answered 5 of 8 attempts with `503` while
             `nos.lol` took the same event). `warning`, not `danger`: nothing failed that the
             user has to repair. --}}
        <p x-show="zeile.partial" x-cloak data-rsvp-teilweise
           class="text-xs text-amber-700 dark:text-amber-400"
           x-text="$store.rsvpTermine?.partialLabel(adresse) ?? ''"></p>

        <p x-show="zeile.error" x-cloak data-rsvp-fehler
           class="text-xs text-red-700 dark:text-red-400" x-text="zeile.error"></p>
    </div>

    {{-- The honest line for the state this arm cannot serve: the Portal says it published a
         date, and the relays do not hold it (measured after P1's deploy: 670 events carry a
         coordinate, nos.lol answered for 369 of them). Without it the block would simply be
         absent and read as „this date cannot be answered" — while the Portal's own page can.

         `zeile.ready` is what tells „the relays answered and hold nothing" from „we have not
         asked yet" — without it this button would flash on every page load before the first
         answer arrives. --}}
    @if ($ausdruck === null && $portalLink !== null && $portalLink !== '')
        <div x-data="{ adresse: @js($address), get zeile() { return $store.rsvpTermine?.row(this.adresse) ?? {} } }"
             x-show="zeile.ready && ! zeile.offen && ! zeile.myStatus" x-cloak
             data-rsvp-ausweich class="mt-1">
            <flux:button size="sm" variant="ghost" icon="arrow-top-right-on-square"
                         href="{{ $portalLink }}" target="_blank" rel="external noopener"
                         data-rsvp-portal-link>
                {{ __('Im Portal zusagen') }}
            </flux:button>
            <span class="sr-only">{{ __('(öffnet das Portal)') }}</span>
        </div>
    @endif
@elseif (is_string($restView) && $restView !== '' && $eventId !== null)
    {{-- The host's own arm (the app): its REST RSVP controls. In scope: `$eventId` and
         `$portalLink`. Rendered for a date WITHOUT a coordinate and for a meetup that keeps
         its attendance private — the two cases D12 leaves to the REST path. --}}
    @include($restView, ['eventId' => $eventId, 'portalLink' => $portalLink])
@elseif ($portalLink !== null && $portalLink !== '')
    {{-- The web's arm: the Portal's own RSVP. Marked as leaving the client — a tab that
         navigates away without saying so is the worse surprise. --}}
    <div data-rsvp-nur-portal>
        <flux:button size="sm" variant="ghost" icon="arrow-top-right-on-square"
                     href="{{ $portalLink }}" target="_blank" rel="external noopener"
                     data-rsvp-portal-link>
            {{ __('Im Portal zusagen') }}
        </flux:button>
        <span class="sr-only">{{ __('(öffnet das Portal)') }}</span>
    </div>
@endif
