<?php

use Livewire\Attributes\Layout;
use Livewire\Attributes\Title;
use Livewire\Component;

/** Invite einlösen (`/join?r=&c=`) als Livewire-SFC. Beitritt signiert im Browser. */
new #[Layout('group::einundzwanzig')] #[Title('Einladung')] class extends Component {}; ?>

<main class="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-10 pt-safe">
    {{-- P2: Interstitial ohne app-shell → Signer/Reconnect-Strip selbst tragen
         (Beitritt signiert Events; der Banner darf hier nicht fehlen). `fixed`,
         kein Einfluss auf das zentrierte Flex-Layout, bleibt im Root-<main>. --}}
    <x-group::status-strip />

    {{-- `@js(request()->fullUrl())` gibt der Insel den Link inkl. ?r=&c= mit. --}}
    <div x-data="nostrInvite(@js(request()->fullUrl()))" class="page-enter">

        {{-- Ungültiger Link --}}
        <template x-if="error && !space">
            <flux:callout variant="danger" icon="exclamation-triangle">
                <flux:callout.text x-text="error"></flux:callout.text>
            </flux:callout>
        </template>

        {{-- Einladung --}}
        <template x-if="space">
            <div class="surface-card empty-state p-6 text-center">
                <flux:icon.envelope-open variant="solid" class="mx-auto size-10 text-brand-500" />
                <flux:heading size="xl" class="mt-3">{{ __('Einladung') }}</flux:heading>
                <flux:text class="mt-1">{{ __('Du wurdest zu diesem Space eingeladen:') }}</flux:text>
                <div class="mt-2 truncate rounded-tile bg-zinc-100 p-2 font-mono text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400" x-text="label"></div>

                <template x-if="error">
                    <flux:callout variant="danger" icon="exclamation-triangle" class="mt-4">
                        <flux:callout.text x-text="error"></flux:callout.text>
                    </flux:callout>
                </template>

                <flux:button variant="primary" class="mt-5 w-full" icon="arrow-right"
                             x-on:click="accept()" ::disabled="joining">
                    <span x-text="joining ? @js(__('Trete bei…')) : @js(__('Space beitreten'))"></span>
                </flux:button>
                <flux:button variant="ghost" size="sm" class="mt-2" :href="route('group.spaces')" wire:navigate>{{ __('Abbrechen') }}</flux:button>
            </div>
        </template>

    </div>
</main>
