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
    // Rücksprung host-aware aus EINER Quelle (der nav-Registry, P3): Ist die Wallet
    // ein eigener Bottom-Nav-Peer-Tab (Web + Mobile), ist sie KEINE Settings-
    // Unterseite → kein Zurück-Pfeil (man bleibt im Tab). Nur wenn die Wallet NICHT
    // in der Nav steht (z.B. Package-Default), ist sie ein Hub-Sub-Screen → zurück
    // zum verschmolzenen Settings-Hub. Deckungsgleich mit der Registry-Sichtbarkeit
    // (dort ist die `wallet`-Sektion genau dann ausgeblendet). Kein @mobile/@web-Seam.
    $walletIsNavTab = collect(config('group.nav', []))
        ->contains(fn (array $tab): bool => ($tab['route'] ?? null) === 'group.wallet');
    $backToHub = $walletIsNavTab ? null : route('group.settings');
@endphp

<x-group::app-shell>
    <x-group::app-header title="{{ __('Wallet') }}" :back="$backToHub">
        <x-slot:subtitle>
            <flux:text class="text-sm">{{ __('Lightning — Guthaben, senden & empfangen.') }}</flux:text>
        </x-slot:subtitle>
    </x-group::app-header>

    <x-group::wallet />
</x-group::app-shell>
