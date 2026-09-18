<?php

use Livewire\Attributes\Layout;
use Livewire\Attributes\Title;
use Livewire\Component;

/**
 * Verschmolzener Einstellungen-Screen (§6): EIN Settings-Ort. Die Sektionen sind
 * geteilte Partials unter `partials/settings/`, die die `config('group.settings')`-
 * Registry (geordnete Section-Keys) iteriert — Sichtbarkeit + Reihenfolge sind
 * damit eine Config-Zeile je Host (Web ohne wallet/relays, Mobile ohne wallet mit
 * relays). Server-state-frei: die Logik sind die Alpine/welshman-Inseln
 * (nostrAuth · nostrSpaceSettings · nostrRelays).
 */
new #[Layout('group::einundzwanzig')] #[Title('Einstellungen')] class extends Component {}; ?>

<x-group::app-shell>

    <x-group::app-header title="{{ __('Einstellungen') }}">
        <x-slot:subtitle>
            <flux:text class="text-sm">{{ __('Konto, Space, Wallet und Darstellung an einem Ort.') }}</flux:text>
        </x-slot:subtitle>
    </x-group::app-header>

    {{-- EINE nostrAuth-Insel für die ganze Seite: die Sektionen `account`/`session`
         hängen an diesem Scope (npub/signerLabel/doLogout); Sektionen mit eigenem
         Scope (`space`/`relays`/`appearance`) shadowen korrekt als Alpine-Kind-Scope
         — kein doppeltes Polling. `@includeIf` ist fail-soft: ein Tippfehler in der
         Registry überspringt die Sektion (kein 500). --}}
    <div class="page-enter space-y-8" x-data="nostrAuth">
        @foreach (config('group.settings', []) as $section)
            @if (str_starts_with($section, 'view:'))
                {{-- Host-injected section (P2): a view of the HOST, not a package
                     partial. That is how `twenty-one-companion` folds its app-only
                     settings (region, push, portal connection, about) into this one
                     hub instead of keeping a second, thinner settings screen — two
                     places for one thing, depending on which way you came. --}}
                @includeIf(substr($section, 5))
            @else
                @includeIf('group::partials.settings.'.$section)
            @endif
        @endforeach
    </div>

</x-group::app-shell>
