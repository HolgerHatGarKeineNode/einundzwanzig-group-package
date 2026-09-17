<?php

use Livewire\Attributes\Layout;
use Livewire\Component;

/**
 * „Ich" (`/ich`, D3) as a Livewire full-page SFC — the avatar in the app header points
 * here.
 *
 * NO server gate, like Start: the sections gate client-side. A guest who taps the
 * avatar must land on a page that explains what an account gives him, not on a login
 * screen he did not ask for (D4).
 *
 * The entries come from `config('group.ich')` and render as
 * `group::partials.ich.<key>`. A host injects its own with a `view:` prefix — the
 * companion's "Meine Inhalte" is exactly that. Same mechanism and the same reason as
 * the settings registry: visibility and order are one config line per host.
 *
 * P3 fills this page out (wallet balance from `js/wallet.ts`, association status);
 * P2 builds the place and the ways out of it.
 */
new #[Layout('group::einundzwanzig')] class extends Component
{
    public function render()
    {
        return $this->view()->title(__('Ich'));
    }
}; ?>

<x-group::app-shell>

    {{-- ONE `nostrAuth` island for the whole page — the same construction as the settings
         hub: the `identitaet`/`session` sections hang on this scope, and sections with a
         scope of their own shadow it correctly as a child scope. --}}
    <div class="page-enter space-y-3" x-data="nostrAuth">

        <x-group::app-header :title="__('Ich')" />

        @foreach (config('group.ich', []) as $eintrag)
            @if (str_starts_with($eintrag, 'view:'))
                {{-- A host-injected entry: a view of the HOST, not of the package.
                     `@includeIf` is fail-soft — a typo in the registry skips the entry
                     instead of ending the page with a 500. --}}
                @includeIf(substr($eintrag, 5))
            @else
                @includeIf('group::partials.ich.'.$eintrag)
            @endif
        @endforeach

        {{-- Sign out at the very bottom, in ONE place — the same rule as in the settings
             hub, and only for members: a sign-out button for a guest is an action without
             an object. --}}
        <template x-if="$store.authGate?.authed">
            <div class="pt-3">
                <flux:button variant="ghost" size="sm" icon="arrow-right-start-on-rectangle"
                             class="w-full" x-on:click="doLogout()">{{ __('Abmelden') }}</flux:button>
            </div>
        </template>
    </div>

</x-group::app-shell>
