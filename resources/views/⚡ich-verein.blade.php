<?php

use Livewire\Attributes\Layout;
use Livewire\Attributes\Title;
use Livewire\Component;

/**
 * „Ich › Verein" (`/ich/verein`, D11, P5) as a Livewire SFC.
 *
 * A thin shell like every Nostr surface of this package: the state lives in the Alpine island
 * (`nostrVereinMitgliedschaft`, `js/mitgliedschaft.ts`), the rules one level below it
 * (`js/mitgliedschaftModelle.ts`). There is no `wire:model` and no server round trip, and
 * there cannot be: every read of the association's membership API carries a NIP-98 signature,
 * and that signature is made in the browser by a key the server never sees.
 *
 * Until P5 this route rendered the JOIN FLOW (P2's interim state). The flow keeps its own
 * address (`/verein/beitritt`) and is reached from here — this page answers „where do I
 * stand?", the flow answers „how do I get in?", and they are two questions.
 */
new #[Layout('group::einundzwanzig')] #[Title('Verein')] class extends Component {}; ?>

<x-group::app-shell>

    <div class="page-enter" x-data="nostrVereinMitgliedschaft">

        <x-group::app-header :title="__('Verein')" :back="route('group.ich')" />

        {{-- The signing strip, as on the join flow: every read here signs, and a stale bunker
             connection has to be visible where the signature is asked for. --}}
        <x-group::status-strip />

        {{-- ── Not set up ───────────────────────────────────────────────────────────
             Without an association base URL the `u` tag could not name the association and
             every signature would be worthless. The row into this page is hidden in that case
             (`partials/ich/verein.blade.php`), but a hardlink still reaches it — so the page
             says so rather than showing an empty frame.

             Decided in the ISLAND (`eingerichtet`), not here, although the value comes from
             the same config key: this page has no other server state, and one value read in
             two places is one place too many. It is also the only form a run can drive — a
             spec overrides the document config, never the `serve` process's env. --}}
        <div x-show="!eingerichtet" x-cloak>
            <div class="surface-card p-6 text-center" data-verein-nicht-eingerichtet>
                <flux:text>{{ __('Die Vereins-Anbindung ist in dieser App gerade nicht eingerichtet.') }}</flux:text>
                @if (filled(config('group.verein_public_url')))
                    <flux:button variant="primary" class="mt-4 w-full" icon:trailing="arrow-up-right"
                                 href="{{ config('group.verein_public_url') }}" target="_blank" rel="external noopener">
                        {{ __('Verein im Browser öffnen') }}
                    </flux:button>
                @endif
            </div>
        </div>

        <div x-show="eingerichtet" x-cloak>
            {{-- ── Signed out ───────────────────────────────────────────────────────
                 The route is behind `nostr.auth` on the web, but in the app the login state is
                 client-only (D4) — so the island answers, not the server. --}}
            <div x-show="!angemeldet" x-cloak class="surface-card p-6" data-verein-abgemeldet>
                <flux:text>{{ __('Melde dich mit deinem Nostr-Schlüssel an, um deine Mitgliedschaft zu sehen.') }}</flux:text>
            </div>

            <div x-show="angemeldet" x-cloak class="flex flex-col gap-4">

                {{-- ── Status ───────────────────────────────────────────────────────
                     Five states, one sentence each, and the last („unbekannt") is the one a
                     surface usually forgets: the association was not reachable. Saying „kein
                     Antrag" there would be a statement about somebody's membership that
                     nobody measured. Which state it is, is decided in ONE place
                     (`mitgliedschaftModelle.mitgliedschaftZustand`) — the association reports
                     two status fields that differ exactly when a fee year goes unpaid, and a
                     surface reading only the first would call a lapsed member active. --}}
                <section class="surface-card p-6" data-verein-status x-bind:data-zustand="zustand">
                    <div class="flex items-start gap-4">
                        <span class="flex size-11 shrink-0 items-center justify-center rounded-tile bg-brand-500/10 text-brand-800 dark:text-brand-400">
                            <flux:icon.identification class="size-6" />
                        </span>
                        <div class="min-w-0 flex-1">
                            <flux:heading size="lg" level="1">{{ __('Deine Mitgliedschaft') }}</flux:heading>

                            <div x-show="laden" x-cloak class="mt-2" aria-busy="true">
                                <div class="skeleton h-4 w-48"></div>
                            </div>

                            <flux:text x-show="!laden && zustand === 'mitglied'" x-cloak
                                       class="mt-1 text-sm" data-verein-satz="mitglied">
                                {{ __('Du bist Mitglied. Danke, dass du den Verein trägst.') }}
                            </flux:text>
                            {{-- Paid for the current year, not yet active: the association
                                 reconciles at night. Neither „still open" nor a pay button —
                                 the fee box below says „paid" for the same year. --}}
                            <flux:text x-show="!laden && zustand === 'freischaltung-offen'" x-cloak
                                       class="mt-1 text-sm" data-verein-satz="freischaltung-offen">
                                {{ __('Du bist noch nicht freigeschaltet. Der Abgleich läuft automatisch.') }}
                            </flux:text>
                            <flux:text x-show="!laden && zustand === 'zahlung-offen'" x-cloak
                                       class="mt-1 text-sm" data-verein-satz="zahlung-offen">
                                {{ __('Dein Beitrag für dieses Jahr ist noch offen.') }}
                            </flux:text>
                            <flux:text x-show="!laden && zustand === 'kein-antrag'" x-cloak
                                       class="mt-1 text-sm" data-verein-satz="kein-antrag">
                                {{ __('Für deinen Schlüssel liegt noch kein Antrag vor.') }}
                            </flux:text>
                            <flux:text x-show="!laden && zustand === 'unbekannt' && !fehler" x-cloak
                                       class="mt-1 text-sm" data-verein-satz="unbekannt">
                                {{ __('Der Verein war gerade nicht erreichbar — dein Status ist damit nicht bekannt, nicht „nein".') }}
                            </flux:text>
                        </div>
                    </div>

                    {{-- ── The contribution year ────────────────────────────────────
                         Only when the association named one. A fee of „0" or a year of „—"
                         would be a number this client made up. --}}
                    <div x-show="jahr > 0" x-cloak class="mt-4 rounded-tile bg-brand-500/10 px-4 py-4 text-center"
                         data-verein-beitrag>
                        <flux:text class="text-xs font-medium uppercase tracking-wide text-muted">{{ __('Jahresbeitrag') }}</flux:text>
                        <p class="mt-1 text-3xl font-bold tabular-nums tracking-tight"
                           x-text="beitrag > 0 ? beitrag + ' ' + waehrung : '—'"></p>
                        <flux:text class="mt-1 text-xs text-muted">
                            {{ __('Beitragsjahr') }} <span x-text="jahr" data-verein-jahr></span>
                            <span x-show="bezahlt" x-cloak> · <span data-verein-bezahlt>{{ __('bezahlt') }}</span></span>
                        </flux:text>
                    </div>

                    <div class="mt-4 flex flex-wrap gap-2">
                        {{-- Into the join flow. It is the same address for „apply" and „pay":
                             the flow decides its own step from `/me` and `/config`, and a
                             second entry point would be a second answer to „where am I?". --}}
                        <flux:button x-show="zustand === 'kein-antrag' || zustand === 'zahlung-offen'" x-cloak
                                     size="sm" variant="primary" icon="arrow-right"
                                     href="{{ route('group.verein.join') }}"
                                     data-verein-beitritt>
                            <span x-text="zustand === 'zahlung-offen'
                                ? @js(__('Beitrag bezahlen'))
                                : @js(__('Mitglied werden'))"></span>
                        </flux:button>

                        {{-- The receipt of the CURRENT year, straight from `/me`: the one
                             document somebody comes to this page for. The history below costs a
                             second signature and is therefore asked for, not loaded. --}}
                        <flux:button x-show="belegUrl" x-cloak size="sm" variant="ghost"
                                     icon="arrow-top-right-on-square"
                                     x-bind:href="belegUrl" target="_blank" rel="external noopener"
                                     data-verein-beleg-aktuell>
                            {{ __('Beleg öffnen') }}
                        </flux:button>
                    </div>
                </section>

                {{-- ── The error, WITH its way out ──────────────────────────────────
                     The one promise this surface makes: no error state without a visible
                     escape. An auth failure signs ANEW and only on a press — the association
                     burned the event id of the rejected attempt (replay lock) and tolerates
                     ±60 s on `created_at`, so an automatic retry could only fail again, and an
                     automatic FRESH signature would be a bunker prompt nobody asked for. --}}
                <template x-if="fehler">
                    <flux:callout variant="danger" icon="exclamation-triangle" data-verein-fehler>
                        <flux:callout.text x-text="fehler"></flux:callout.text>
                        <x-slot name="actions">
                            <flux:button size="sm" variant="ghost" x-on:click="erneut()" data-verein-erneut>
                                <span x-text="ausweg || @js(__('Erneut versuchen'))"></span>
                            </flux:button>
                        </x-slot>
                    </flux:callout>
                </template>

                {{-- ── Belege ───────────────────────────────────────────────────────
                     Asked for, not loaded: the list is a HISTORY, nobody needs it to learn
                     whether they are a member, and it costs a second NIP-98 signature — i.e.
                     a second prompt on an Amber session. --}}
                <section class="surface-card p-6" aria-labelledby="verein-belege">
                    <div class="flex items-center justify-between gap-3">
                        <flux:heading size="lg" level="2" id="verein-belege">{{ __('Belege') }}</flux:heading>
                        <flux:button x-show="!belegeGeladen" x-cloak size="sm" variant="ghost"
                                     x-bind:disabled="belegeLaden"
                                     x-on:click="holeBelege()" data-verein-belege-laden>
                            {{ __('Belege anzeigen') }}
                        </flux:button>
                    </div>

                    <flux:text x-show="!belegeGeladen && !belegeLaden" x-cloak class="mt-2 text-sm text-muted">
                        {{ __('Deine Beitragsjahre werden erst auf Nachfrage geholt — jeder Abruf kostet eine Signatur.') }}
                    </flux:text>

                    <div x-show="belegeLaden" x-cloak class="mt-3" aria-busy="true">
                        <div class="skeleton h-4 w-40"></div>
                        <div class="skeleton mt-2 h-4 w-32"></div>
                    </div>

                    <flux:text x-show="belegeGeladen && belege.length === 0" x-cloak
                               class="mt-2 text-sm text-muted" data-verein-belege-leer>
                        {{ __('Für deinen Schlüssel ist noch kein Beitragsjahr verbucht.') }}
                    </flux:text>

                    <div x-show="belegeGeladen && belege.length > 0" x-cloak class="mt-3 flex flex-col gap-2"
                         data-verein-belege>
                        <template x-for="row in belege" :key="row.year">
                            <div class="flex items-center gap-3 rounded-tile border border-zinc-200 px-4 py-3 dark:border-zinc-800">
                                <span class="w-14 shrink-0 font-semibold tabular-nums" x-text="row.year"></span>
                                <span class="min-w-0 flex-1 truncate text-sm text-muted"
                                      x-text="(row.amount > 0 ? row.amount + ' ' + row.currency + ' · ' : '')
                                          + (row.paid ? @js(__('bezahlt')) : @js(__('offen')))"></span>
                                {{-- A receipt exists only for a settled fee — an unsettled
                                     invoice id would be a checkout link dressed up as a
                                     receipt (the association says so in its own resource). --}}
                                <template x-if="row.receiptUrl">
                                    <a x-bind:href="row.receiptUrl" target="_blank" rel="external noopener"
                                       x-bind:data-verein-beleg="row.year"
                                       class="pressable shrink-0 rounded-tile px-2 py-1 text-sm font-medium text-accent">
                                        {{ __('Beleg') }}
                                    </a>
                                </template>
                            </div>
                        </template>
                    </div>
                </section>

                {{-- The way out of the client, always available: whoever cannot get anywhere
                     here can do everything on the association's own page. It says where it
                     leads — the same handgrip as the gate and the join flow. --}}
                @if (filled(config('group.verein_public_url')))
                    <div>
                        <flux:button size="sm" variant="ghost" icon:trailing="arrow-up-right"
                                     href="{{ config('group.verein_public_url') }}" target="_blank" rel="external noopener"
                                     data-verein-extern>
                            {{ __('Verein im Browser öffnen') }}
                        </flux:button>
                        <flux:text class="mt-1 text-xs text-muted">
                            {{ Str::of(config('group.verein_public_url'))->after('://')->rtrim('/') }}
                        </flux:text>
                    </div>
                @endif
            </div>
        </div>
    </div>
</x-group::app-shell>
