<?php

use Livewire\Attributes\Layout;
use Livewire\Attributes\Title;
use Livewire\Component;

/**
 * Lightning-Wallet (ZAPS.md Z0) als Gruppen-Page unter dem `nostr.auth`-Gate —
 * die Wallet ist nostr-account-gebunden (pubkey), gehört also NICHT in die
 * Laravel-`['auth','verified']`-Account-Settings (die eine verifizierte E-Mail
 * verlangen, was nostr-User nicht haben). Server-state-frei: die Logik ist die
 * Alpine/welshman-Insel.
 */
new #[Layout('group::einundzwanzig')] #[Title('Wallet')] class extends Component {}; ?>

@php
    // The way back is host-aware and derived from ONE source — since P2 that is the AREAS
    // registry and no longer `nav` (the bottom bar has three fixed slots, and the wallet is
    // none of them).
    //
    // If the wallet is an area of its own it is NOT a settings sub-page: the arrow leads
    // back to where its tile stands (Start). If it is NOT among the areas it is a
    // sub-screen of the settings hub and the arrow leads there — congruent with the
    // registry's own visibility (that is exactly when the `wallet` section is shown). No
    // @mobile/@web seam.
    $walletIstBereich = collect(config('group.areas', []))
        ->contains(fn (array $bereich): bool => ($bereich['key'] ?? null) === 'wallet');
    $backToHub = $walletIstBereich
        ? route(config('group.start_route', 'group.start'))
        : route(config('group.settings_route', 'group.ich.einstellungen'));
@endphp

<x-group::app-shell>
    <x-group::app-header title="{{ __('Wallet') }}" :back="$backToHub">
        <x-slot:subtitle>
            <flux:text class="text-sm">{{ __('Lightning — Guthaben, senden & empfangen.') }}</flux:text>
        </x-slot:subtitle>
    </x-group::app-header>

    <x-group::wallet />
</x-group::app-shell>
