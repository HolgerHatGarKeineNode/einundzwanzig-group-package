<?php

use Livewire\Attributes\Layout;
use Livewire\Attributes\Title;
use Livewire\Component;

/** Invite einlösen (`/join?r=&c=`) als Livewire-SFC. Beitritt signiert im Browser. */
new #[Layout('chat::einundzwanzig')] #[Title('Einladung')] class extends Component {}; ?>

<main class="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-10 pt-safe">
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
                <flux:heading size="xl" class="mt-3">Einladung</flux:heading>
                <flux:text class="mt-1">Du wurdest zu diesem Space eingeladen:</flux:text>
                <div class="mt-2 truncate rounded-tile bg-zinc-100 p-2 font-mono text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400" x-text="label"></div>

                <template x-if="error">
                    <flux:callout variant="danger" icon="exclamation-triangle" class="mt-4">
                        <flux:callout.text x-text="error"></flux:callout.text>
                    </flux:callout>
                </template>

                <flux:button variant="primary" class="mt-5 w-full" icon="arrow-right"
                             x-on:click="accept()" ::disabled="joining">
                    <span x-text="joining ? 'Trete bei…' : 'Space beitreten'"></span>
                </flux:button>
                <flux:button variant="ghost" size="sm" class="mt-2" :href="route('chat.spaces')" wire:navigate>Abbrechen</flux:button>
            </div>
        </template>

    </div>
</main>
