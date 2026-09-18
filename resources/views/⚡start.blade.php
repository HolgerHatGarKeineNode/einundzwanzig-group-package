<?php

use Livewire\Attributes\Layout;
use Livewire\Component;

/**
 * Start (`/start`, Concept C "One Entrance", P2) as a Livewire full-page SFC.
 *
 * A thin shell like `⚡updates.blade.php`: the page holds NO server state. It has to
 * stay that way — Start is the one route a guest reaches without a session, and on the
 * app the login state lives only in `localStorage` (D4). Anything the server decided
 * about "member or guest" would be a guess that flashes the wrong answer on every cold
 * start.
 *
 * What the tile grid shows comes from `config('group.areas')` and is therefore a SERVER
 * decision — but it is a decision about CONFIGURATION ("does this installation have a
 * board relay?"), not about the visitor. Both halves of the page render for everyone;
 * only the inbox preview and the greeting hang on the client-side login state.
 *
 * Pins ("Angeheftet", D7/D8) arrived with P3 and stand ABOVE the inbox preview. They get
 * NO placeholder while they are empty: an empty strip that explains nothing is worse than a
 * page that grows by a section. The labels of the chips are resolved in the island
 * (`$store.pinSet.rows` carries key and prefix; the display name comes from the room list,
 * the profile cache or the Portal slug), so the server renders the section's frame and not
 * one of its rows.
 */
new #[Layout('group::einundzwanzig')] class extends Component
{
    public function render()
    {
        return $this->view()->title(__('Start'));
    }
}; ?>

<x-group::app-shell width="wide">

    {{-- ONE root element under the shell (Livewire's contract). `bereit` is the skeleton
         switch: it is `false` until Alpine has booted, and from then on
         `$store.authGate.authed` decides. The placeholder below is SERVER-rendered and
         deliberately carries NO `x-cloak` — it has to stand from the first paint, otherwise
         the surface flashes empty. --}}
    <div x-data="{ bereit: false, init() { this.bereit = true } }" class="page-enter">

        <x-group::app-header :title="__('Start')" />

        {{-- ── State 0: we do not know yet ──────────────────────────────────────────
             Two placeholder lines at the height of the greeting. No guessing: neither
             "welcome back" nor "please sign in" stands here until the store answers. --}}
        <div x-show="!bereit" class="surface-card mb-6 p-4" aria-busy="true">
            <div class="skeleton h-4 w-40"></div>
            <div class="skeleton mt-2 h-3 w-64"></div>
        </div>

        {{-- ── Guest (D4) ──────────────────────────────────────────────────────────
             The public tiles below navigate, the gated ones open the login sheet. That is
             why an invitation stands here and not a barrier. --}}
        <template x-if="bereit && !$store.authGate?.authed">
            <div class="surface-card mb-6 p-4">
                <flux:heading size="lg">{{ __('Willkommen bei EINUNDZWANZIG') }}</flux:heading>
                <flux:text class="mt-1 text-sm text-muted">
                    {{ __('Artikel und Meetups kannst du ohne Anmeldung lesen. Für Chat, Wallet und dein Postfach brauchst du deinen Nostr-Schlüssel.') }}
                </flux:text>
                <div class="mt-3">
                    {{-- Through the store and not straight to the login view: the sheet
                         (P6) intercepts the same event and keeps the user on the page. The
                         way back is Start, so exactly this address. --}}
                    <flux:button size="sm" variant="primary" icon="key" data-start-anmelden
                                 x-on:click="$store.authGate.requireAuth({ label: @js(__('Start')), returnUrl: '/start' })">
                        {{ __('Anmelden') }}
                    </flux:button>
                </div>
            </div>
        </template>

        {{-- ── „Angeheftet" (D7/D8) ─────────────────────────────────────────────────
             The chips stand above the inbox preview: they are what the user chose, the
             preview is what happened to him.

             The list itself — which keys, in which order, with which target and which
             honest warning — lives in `x-group::pin-list` since P6: the desktop left bar
             shows the same set (D10), and the target table is the one thing the two must
             not answer differently. What stands HERE is only where it appears.

             ── Why the chips step aside from `xl` up ──────────────────────────────────
             From there the left bar carries the pins, on EVERY page and not just on this
             one. Two lists of the same keys in one glance is the doubling that P5 already
             ruled out for the room list — its case in `desktop-rail-groups.spec.ts` is called
             „Ab 1280 px zeigt die Bühne die Raumliste nicht mehr — die Rail trägt sie".
             The argument is the same: the bar is the place for places.

             Per CSS and not per `x-if`, for the reason that precedent names: below `xl` the
             block has to stay character-identical, and a second breakpoint condition in
             Alpine would be a second truth about the same threshold.

             **In the web host only.** The app renders no left bar at any width (it has no
             `xl` shell at all — `Chassis::istApp()` gates the frame), so hiding the chips
             there would simply delete them on a tablet in landscape. Same question and same
             answer as in `me-avatar.blade.php`: the host, not the width. --}}
        <x-group::pin-list variant="chips"
                           class="{{ \Einundzwanzig\Group\Chassis::istApp() ? '' : 'xl:hidden' }}" />

        {{-- ── „Dein nächster Termin" (D12/P5) ──────────────────────────────────────
             ONE row: the next date of a meetup the reader has a relation to — one he pinned
             (D7) or whose room he joined — with its answer right there.

             Everything about this row is decided in the browser, and it has to be: the pinned
             meetups live in a NIP-44 blob only this device can read, the joined rooms are
             relay state, and Start holds no server state at all (D4). The dates come from the
             index the palette already loads once per session (`/suche/portal-index`), so this
             row costs no request of its own. Reasoning in `js/rsvpTermine.ts`.

             Shown to guests as well — a guest has pins in `localStorage` — but the answer
             needs a key, and without one the store reports `offen: false` and the row shows
             the Portal way instead of two buttons nobody can press.

             `x-show` on the section and not `<template x-if>`: the island IS what resolves the
             address, so it has to boot before there is anything to gate on. --}}
        <section class="mb-6" x-data="nostrNaechsterTermin" x-show="address" x-cloak
                 aria-labelledby="start-naechster-termin" data-start-naechster-termin>
            <h2 id="start-naechster-termin" class="mb-2 text-[0.7rem] font-semibold uppercase tracking-wider text-muted">
                {{ __('Dein nächster Termin') }}
            </h2>

            <div class="surface-card flex flex-col">
                <a x-bind:href="href" wire:navigate data-start-termin-link
                   class="pressable flex items-center gap-3 p-4 text-start">
                    <span class="flex size-10 shrink-0 items-center justify-center rounded-tile bg-brand-500/10 text-brand-800 dark:text-brand-400">
                        <flux:icon.calendar-days class="size-5" />
                    </span>
                    <span class="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span class="truncate font-medium" x-text="name"></span>
                        {{-- The date comes out of the index as `Y-m-d H:i` and is formatted in
                             the ISLAND (`formatTimestamp`), so it reads like every other date in
                             this client instead of like a database column — and so the format
                             follows the active language without a second table in Blade. --}}
                        <span class="truncate text-sm text-muted"
                              x-text="dateLabel + (location ? ' · ' + location : '')"></span>
                    </span>
                    <flux:icon.chevron-right class="size-4 shrink-0 text-zinc-400" />
                </a>
                <div class="px-4 pb-3">
                    <x-group::rsvp-termin kompakt ausdruck="address" />
                </div>
            </div>
        </section>

        {{-- ── Member: the inbox preview ────────────────────────────────────────────
             `<template x-if>` and NOT `x-show`: Alpine initialises `x-data` inside
             CSS-hidden elements too, so the updates island would open subscriptions for a
             guest who never sees them.

             **No DM row with content and no DM count** (D5). A NIP-17 wrap can only be
             answered by decrypting it — any number here would cost the signer exactly what
             D5 sets out to avoid. The row at the bottom is therefore neutral and only
             leads there.

             `limit = 3` via `x-init`: the preview shows three rows, the full list is one
             tap away. --}}
        <template x-if="bereit && $store.authGate?.authed">
            <section class="mb-6" aria-labelledby="start-postfach">
                <div class="mb-2 flex items-center justify-between gap-3">
                    <h2 id="start-postfach" class="text-[0.7rem] font-semibold uppercase tracking-wider text-muted">
                        {{ __('Postfach') }}
                    </h2>
                    <a href="{{ route('group.postfach') }}" wire:navigate data-start-postfach
                       class="pressable rounded-tile px-1.5 py-1 text-sm font-medium text-accent">
                        {{ __('Alles ansehen') }}
                    </a>
                </div>

                <div class="surface-card overflow-hidden" x-data="nostrUpdates" x-init="limit = 3">

                    {{-- Due reminders first: they have a deadline, the notices below do
                         not. The same store as in the Postfach — two islands would be two
                         truths about "is that one done already?". --}}
                    <div x-data="{
                             init() { $store.reminders?.mount() },
                             destroy() { $store.reminders?.unmount() },
                         }">
                        <template x-for="row in ($store.reminders?.due ?? []).slice(0, 2)" :key="row.d">
                            <a :href="row.href || @js(route('group.postfach'))" wire:navigate
                               class="pressable flex items-start gap-3 border-b border-zinc-200/60 px-4 py-3 text-left transition-colors hover:bg-brand-500/5 dark:border-zinc-800/60">
                                <flux:icon.clock class="mt-0.5 size-5 shrink-0 text-muted" />
                                <span class="min-w-0 flex-1">
                                    <span class="block truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100" x-text="row.preview || row.note"></span>
                                    <span class="mt-1 block text-xs text-muted" x-text="row.timeLabel"></span>
                                </span>
                            </a>
                        </template>
                    </div>

                    {{-- Mentions and thread replies. The filter excludes `message`: an
                         ordinary room message is not a notice ABOUT ME, and over three rows
                         it would otherwise win against the two kinds that are. The filter
                         lives here and not in the island because it is a property of THIS
                         preview, not of the updates surface. --}}
                    <template x-for="item in items.filter(function (i) { return i.type !== 'message' }).slice(0, 3)" :key="item.key">
                        <button type="button" x-on:click="open(item)" :aria-label="labelFor(item)" :disabled="item.orphan"
                                class="pressable flex w-full items-start gap-3 border-b border-zinc-200/60 px-4 py-3 text-left transition-colors hover:bg-brand-500/5 disabled:cursor-default disabled:opacity-60 dark:border-zinc-800/60">
                            <span class="shrink-0">
                                <x-group::nostr-avatar picture="item.picture" name="item.authorName" size="2.25rem" />
                            </span>
                            <span class="min-w-0 flex-1">
                                <span class="block truncate text-sm text-zinc-900 dark:text-zinc-100"
                                      :class="item.unread ? 'font-bold' : 'font-semibold'" x-text="item.title"></span>
                                <span class="mt-1 block truncate text-sm text-muted" x-text="item.snippet"></span>
                            </span>
                        </button>
                    </template>

                    {{-- The preview's empty state. `loading` gets no surface of its own:
                         three rows shimmering for half a second are more restlessness than
                         information on the start page. --}}
                    <template x-if="!loading && ($store.reminders?.due ?? []).length === 0 && items.filter(function (i) { return i.type !== 'message' }).length === 0">
                        <p class="px-4 py-6 text-center text-sm text-muted">{{ __('Nichts Neues für dich.') }}</p>
                    </template>

                    {{-- The neutral row for the encrypted conversations (D5): it leads
                         there, it counts nothing and it shows nothing. --}}
                    <a href="{{ route('group.postfach', ['ansicht' => 'direkt']) }}" wire:navigate data-start-direkt
                       class="pressable flex items-center gap-3 px-4 py-3 text-sm font-medium text-muted transition-colors hover:bg-brand-500/5 hover:text-zinc-900 dark:hover:text-zinc-100">
                        <flux:icon.lock-closed variant="micro" class="size-4 shrink-0" />
                        <span>{{ __('Verschlüsselte Nachrichten öffnen') }}</span>
                    </a>
                </div>
            </section>
        </template>

        {{-- ── "Alle Bereiche" ──────────────────────────────────────────────────────
             The tiles come from `config('group.areas')`. A tile whose `requires` key is
             empty does NOT appear at all — an area without a source would be a place
             without content (the same rule the rail's forge row follows).

             `gate === 'nostr'` runs through the same store as the bottom nav: a guest's tap
             opens the login sheet instead of letting him run into a server redirect.
             Intercepted in the CAPTURE phase, because `wire:navigate` commits on
             `mousedown` already.

             Areas without a `route` leave the client (`portal_url` + `path`): the Portal
             pages for meetups and courses are built in P4 (D9). They do NOT get a
             `target=_blank` — inside the app's WebView that would be a window without a way
             back; `rel="external"` marks them for `wire:navigate`, which then does not
             treat them as an SPA destination. --}}
        @php($portal = rtrim((string) config('group.portal_url', ''), '/'))
        @php($beschriftung = [
            'chat' => __('Chat'),
            'meetups' => __('Meetups'),
            'artikel' => __('Artikel'),
            'forge' => __('Forge'),
            'leute' => __('Leute'),
            'wallet' => __('Wallet'),
            'kurse' => __('Kurse'),
            'verein' => __('Verein'),
        ])
        <section aria-labelledby="start-bereiche">
            <h2 id="start-bereiche" class="mb-2 text-[0.7rem] font-semibold uppercase tracking-wider text-muted">
                {{ __('Alle Bereiche') }}
            </h2>

            <div class="grid grid-cols-2 gap-2 sm:grid-cols-3" data-start-bereiche>
                @foreach (config('group.areas', []) as $bereich)
                    @php($schluessel = $bereich['requires'] ?? null)
                    @continue($schluessel !== null && blank(config('group.'.$schluessel)))
                    @php($label = $beschriftung[$bereich['key']] ?? $bereich['key'])
                    @php($ziel = $bereich['route'] !== null ? route($bereich['route']) : $portal.($bereich['path'] ?? '/'))
                    <a href="{{ $ziel }}"
                       data-start-bereich="{{ $bereich['key'] }}"
                       @if ($bereich['route'] !== null) wire:navigate @else rel="external noopener" @endif
                       @if (($bereich['gate'] ?? 'guest') === 'nostr')
                           x-data
                           x-on:mousedown.capture="$store.authGate.gateTap($event, { label: @js($label), returnUrl: $el.pathname + $el.search })"
                           x-on:keydown.enter.capture="$store.authGate.gateTap($event, { label: @js($label), returnUrl: $el.pathname + $el.search })"
                       @endif
                       class="pressable surface-card flex min-h-24 flex-col items-start justify-between gap-2 p-3 transition-colors hover:bg-brand-500/5">
                        <span class="flex size-10 shrink-0 items-center justify-center rounded-tile bg-brand-500/10 text-brand-700 dark:text-brand-400">
                            <flux:icon :name="$bereich['icon']" class="size-5" />
                        </span>
                        <span class="flex min-w-0 items-center gap-1">
                            <span class="min-w-0 truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">{{ $label }}</span>
                            @if ($bereich['route'] === null)
                                {{-- Made visible, not only announced: whoever taps here
                                     leaves the client. The sr-only text stands next to it
                                     because an icon alone carries no name. --}}
                                <flux:icon.arrow-top-right-on-square variant="micro" class="size-3.5 shrink-0 text-muted" />
                                <span class="sr-only">{{ __('(öffnet das Portal)') }}</span>
                            @endif
                        </span>
                    </a>
                @endforeach
            </div>
        </section>
    </div>

</x-group::app-shell>
