<?php

use Livewire\Attributes\Layout;
use Livewire\Attributes\Title;
use Livewire\Component;

/** Space-Wechsel (der einzige Ort dafür, §12) als Livewire-SFC. */
new #[Layout('chat::einundzwanzig')] #[Title('Space wählen')] class extends Component {}; ?>

<main class="mx-auto max-w-md px-4 py-8 pt-safe pb-28">

    <x-chat::app-header title="Space wählen" :back="route('chat.spaces')">
        <x-slot:subtitle>
            <flux:text class="text-sm">Die App zeigt immer genau diesen Space.</flux:text>
        </x-slot:subtitle>
    </x-chat::app-header>

    {{-- Auswahl des aktiven Space (der einzige Ort zum Wechseln, §12) --}}
    <div x-data="nostrSpaceSettings" class="page-enter">

        <template x-if="spaces.length === 0">
            <div class="surface-card empty-state p-6 text-center">
                <flux:icon.inbox class="mx-auto size-8 text-zinc-400" />
                <flux:text class="mt-2">Du bist noch keinem Space beigetreten.</flux:text>
            </div>
        </template>

        <flux:navlist x-show="spaces.length > 0">
            <template x-for="s in spaces" :key="s.url">
                <flux:navlist.item icon="server" x-on:click="choose(s.url)">
                    <span x-text="s.label"></span>
                    <flux:icon.check x-show="s.url === active" class="ml-auto size-4 text-brand-500" />
                </flux:navlist.item>
            </template>
        </flux:navlist>

        {{-- Mitgliedschaft im aktiven Space (Space-Ebene, kind 28934/28936) --}}
        <div class="surface-card mt-4 flex items-center justify-between gap-3 p-3">
            <div class="min-w-0">
                <flux:text class="text-sm font-medium">Mitgliedschaft</flux:text>
                <div class="truncate text-xs text-zinc-500"
                     x-text="activeJoined ? 'Du bist Mitglied dieses Space.' : 'Noch nicht beigetreten.'"></div>
            </div>
            {{-- „Space verlassen" (leaveActive, kind 28936) noch nicht freigeben —
                 Feature kommt später. leaveActive() in der Insel bleibt bestehen. --}}
            {{-- <flux:button size="sm" variant="ghost" icon="arrow-right-start-on-rectangle"
                         x-show="activeJoined" x-cloak x-on:click="leaveActive()" ::disabled="busy">Verlassen</flux:button> --}}
            <flux:button size="sm" variant="primary" icon="plus"
                         x-show="!activeJoined" x-cloak x-on:click="joinActive()" ::disabled="busy">Beitreten</flux:button>
        </div>
    </div>

    <x-chat::bottom-nav />
</main>
