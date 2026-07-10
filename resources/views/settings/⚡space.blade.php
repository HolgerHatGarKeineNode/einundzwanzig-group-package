<?php

use Livewire\Attributes\Layout;
use Livewire\Attributes\Title;
use Livewire\Component;

/** Space-Wechsel (der einzige Ort dafür, §12) als Livewire-SFC. */
new #[Layout('group::einundzwanzig')] #[Title('Space wählen')] class extends Component {}; ?>

<x-group::app-shell>

    {{-- Bottom-Nav-Tab: Brand-Mark-Header (kein :back — gleichrangig zu Space, §Bottom-Nav)
         + Abmelden hier verfügbar (Flow Settings→Logout, D5). --}}
    <x-group::app-header title="Space wählen" x-data="nostrAuth">
        <x-slot:subtitle>
            <flux:text class="text-sm">Die App zeigt immer genau diesen Space.</flux:text>
        </x-slot:subtitle>
        <x-slot:actions>
            <flux:button variant="ghost" size="sm" x-on:click="doLogout()">Abmelden</flux:button>
        </x-slot:actions>
    </x-group::app-header>

    {{-- Auswahl des aktiven Space (der einzige Ort zum Wechseln, §12) --}}
    <div x-data="nostrSpaceSettings" class="page-enter">

        {{-- Lädt noch (Fix A): Skeleton statt „leer"-Flash vor der ersten Emission. --}}
        <template x-if="!ready">
            <div class="space-y-2" aria-busy="true">
                <span class="sr-only" aria-live="polite">Spaces werden geladen…</span>
                <template x-for="i in 3" :key="i">
                    <div class="surface-card flex items-center gap-3 p-3">
                        <div class="skeleton size-5"></div>
                        <div class="skeleton h-4 w-40"></div>
                    </div>
                </template>
            </div>
        </template>

        <template x-if="ready && spaces.length === 0">
            <div class="surface-card empty-state p-6 text-center">
                <flux:icon.inbox class="mx-auto size-8 text-zinc-400" />
                <flux:text class="mt-2">Du bist noch keinem Space beigetreten.</flux:text>
                {{-- Keine Sackgasse (D5): zurück zur Startseite → Beitritts-/Vereinsflow.
                     Interner wire:navigate-Link (funktioniert in Web UND WebView). --}}
                <flux:button :href="route('home')" wire:navigate variant="primary" icon="home" class="mt-4">
                    Zur Startseite
                </flux:button>
            </div>
        </template>

        <flux:navlist x-show="ready && spaces.length > 0">
            <template x-for="s in spaces" :key="s.url">
                {{-- Slot-Inhalt = eigene Flex-Zeile: Flux wickelt den Slot in ein
                     flex-1-BLOCK-Div — ein ml-auto-Icon bräche dort in eine neue
                     Zeile um (Item verschiebt sich, Haken nicht mittig). --}}
                <flux:navlist.item icon="server" x-on:click="choose(s.url)">
                    <span class="flex w-full items-center gap-2">
                        {{-- Name (NIP-11) + technische Relay-URL darunter, damit klar
                             ist, WO der Space liegt. URL mono/muted, Trailing-Slash weg. --}}
                        <span class="min-w-0 flex-1">
                            <span class="block truncate" x-text="s.label"></span>
                            <span class="block truncate font-mono text-[0.7rem] text-muted" x-text="s.url.replace(/\/$/, '')"></span>
                        </span>
                        <flux:icon.check x-show="s.url === active" class="size-4 shrink-0 text-brand-500" />
                    </span>
                </flux:navlist.item>
            </template>
        </flux:navlist>

        {{-- Mitgliedschaft im aktiven Space (Space-Ebene, kind 28934/28936) --}}
        <div class="surface-card mt-4 flex items-center justify-between gap-3 p-3">
            <div class="min-w-0">
                <flux:text class="text-sm font-medium">Mitgliedschaft</flux:text>
                <div class="truncate text-xs text-muted"
                     x-text="activeJoined ? 'Du bist Mitglied dieses Space.' : (activeIsVerein ? 'Zugang über Vereinsmitgliedschaft.' : 'Noch nicht beigetreten.')"></div>
            </div>
            {{-- „Space verlassen" (leaveActive, kind 28936) noch nicht freigeben —
                 Feature kommt später. leaveActive() in der Insel bleibt bestehen. --}}
            {{-- <flux:button size="sm" variant="ghost" icon="arrow-right-start-on-rectangle"
                         x-show="activeJoined" x-cloak x-on:click="leaveActive()" ::disabled="busy">Verlassen</flux:button> --}}
            {{-- Vereins-Relays haben keinen NIP-29-Selbst-Beitritt → Button ausblenden. --}}
            <flux:button size="sm" variant="primary" icon="plus"
                         x-show="!activeJoined && !activeIsVerein" x-cloak x-on:click="joinActive()" ::disabled="busy">Beitreten</flux:button>
        </div>
    </div>

    {{-- Wallet (ZAPS.md Z0): Einstieg zur Lightning-Wallet. Auf Mobile ist dieses
         Space-Settings der einzige „Einstellungen"-Tab (Bottom-Nav) → die Wallet
         MUSS hier verlinkt sein, sonst ist die Account-Settings-Sektion
         (settings/wallet) am Gerät nicht erreichbar. --}}
    <a href="{{ route('group.wallet') }}" wire:navigate
       class="surface-card pressable mt-4 flex items-center justify-between gap-3 p-3">
        <span class="flex items-center gap-3">
            <span class="flex size-9 items-center justify-center rounded-tile bg-brand-500/10">
                <flux:icon.bolt variant="solid" class="size-5 text-brand-500" />
            </span>
            <span class="min-w-0">
                <flux:text class="text-sm font-medium">Wallet</flux:text>
                <span class="block truncate text-xs text-muted">Lightning — Guthaben, senden &amp; empfangen</span>
            </span>
        </span>
        <flux:icon.chevron-right class="size-4 shrink-0 text-muted" />
    </a>

    {{-- Darstellung: Theme-Switch bindet an Flux' geteilten appearance-Store
         ($flux.appearance → localStorage `flux.appearance`, im <head> flackerfrei
         angewandt). Im Portal-WebView same-origin → automatisch in sync. --}}
    <div class="surface-card mt-4 flex items-center justify-between gap-3 p-3">
        <flux:text class="text-sm font-medium">Darstellung</flux:text>
        <flux:radio.group x-data variant="segmented" size="sm" x-model="$flux.appearance">
            <flux:radio value="light" icon="sun" aria-label="Hell" />
            <flux:radio value="system" icon="computer-desktop" aria-label="Automatisch" />
            <flux:radio value="dark" icon="moon" aria-label="Dunkel" />
        </flux:radio.group>
    </div>

</x-group::app-shell>
