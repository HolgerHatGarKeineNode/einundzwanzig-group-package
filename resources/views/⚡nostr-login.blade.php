<?php

use Livewire\Attributes\Layout;
use Livewire\Attributes\Title;
use Livewire\Component;

/**
 * Nostr-Login (öffentlich) als Livewire-SFC. Signer + Session leben im Browser.
 * Amber wird auf dem Gerät direkt aus der Insel über die NativePHP-Bridge
 * geöffnet (Browser.Open) — kein Livewire-Roundtrip, der den ersten Tap schluckt.
 */
new #[Layout('group::einundzwanzig')] #[Title('Anmelden')] class extends Component {}; ?>

<main class="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-10 pt-safe">
    {{-- P2: Login-Interstitial ohne app-shell → Signer-Health-Strip selbst tragen,
         damit ein langsamer/hängender NIP-46-Signer WÄHREND des Handshakes sichtbar
         bleibt. `fixed`, kein Einfluss aufs zentrierte Layout, im Root-<main>. --}}
    <x-group::status-strip />

    {{-- P6: DER eine Login-View (§5.1). Deep-Link/Fallback-Route rendert dieselbe
         `login-form` fullscreen wie das globale Login-Sheet (§4.2). --}}
    <x-group::login-form />
</main>
