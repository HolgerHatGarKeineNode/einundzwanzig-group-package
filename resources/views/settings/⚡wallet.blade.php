<?php

use Livewire\Attributes\Layout;
use Livewire\Attributes\Title;
use Livewire\Component;

/**
 * Lightning-Wallet (ZAPS.md Z0) als Gruppen-Page unter dem `nostr.auth`-Gate —
 * die Wallet ist nostr-account-gebunden (pubkey), gehört also NICHT in die
 * Laravel-`['auth','verified']`-Account-Settings (die eine verifizierte E-Mail
 * verlangen, was nostr-User nicht haben). Gleiches Layout wie `⚡space` (Bottom-
 * Nav, kein Dead-End). Server-state-frei: die Logik ist die Alpine/welshman-Insel.
 */
new #[Layout('group::einundzwanzig')] #[Title('Wallet')] class extends Component {}; ?>

<main class="mx-auto max-w-md px-4 py-8 pt-safe pb-28 md:max-w-lg lg:max-w-2xl">
    <x-group::app-header title="Wallet" :back="route('group.space.settings')">
        <x-slot:subtitle>
            <flux:text class="text-sm">Lightning — Guthaben, senden &amp; empfangen.</flux:text>
        </x-slot:subtitle>
    </x-group::app-header>

    <x-group::wallet />

    <x-group::bottom-nav />
</main>
