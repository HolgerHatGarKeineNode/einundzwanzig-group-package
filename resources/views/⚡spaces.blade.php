<?php

use Livewire\Attributes\Layout;
use Livewire\Attributes\Title;
use Livewire\Component;

/**
 * Space-Seite (Single-Space §12) als Livewire-Full-Page-SFC. Die Klasse ist ein
 * dünner Shell — der reaktive Zustand lebt in der welshman/Alpine-Insel (`x-data`).
 * Server-Seam für spätere Cache-Vorteile (§10): hier könnten gecachte Space-/Room-
 * Daten in `mount()` geladen und via `@js(...)` an die Insel gereicht werden.
 */
new #[Layout('chat::einundzwanzig')] #[Title('Space')] class extends Component {}; ?>

<main class="mx-auto max-w-md px-4 py-8 pt-safe pb-28">

    {{-- Kopf: Marke + wer bin ich + Abmelden (Navigation liegt in der Bottom-Nav) --}}
    <x-chat::app-header title="Space" x-data="nostrAuth">
        <x-slot:subtitle>
            <div class="truncate font-mono text-xs text-zinc-500" x-text="npub"></div>
        </x-slot:subtitle>
        <x-slot:actions>
            <flux:button variant="ghost" size="sm" x-on:click="doLogout()">Abmelden</flux:button>
        </x-slot:actions>
    </x-chat::app-header>

    {{-- Genau EIN fixierter Space + seine Räume (kein Multi-Space-Layout, §12) --}}
    <div x-data="nostrSpaces" class="page-enter" x-show="space">
        <div class="surface-card p-4">
            <div class="flex items-center gap-2">
                <flux:icon.server variant="solid" class="size-4 text-brand-500" />
                <span class="truncate font-semibold" x-text="space?.label"></span>
            </div>

            {{-- Räume laden noch --}}
            <template x-if="loading && space && space.userRooms.length === 0 && space.otherRooms.length === 0">
                <div class="mt-3 space-y-2">
                    <div class="skeleton h-4 w-32"></div>
                    <div class="skeleton h-4 w-24"></div>
                </div>
            </template>

            {{-- Geladen, aber der Space hat keine Räume --}}
            <template x-if="!loading && space && space.userRooms.length === 0 && space.otherRooms.length === 0">
                <flux:text class="mt-3 text-sm text-zinc-500">Dieser Space hat noch keine Räume.</flux:text>
            </template>

            <flux:navlist class="mt-3">
                <template x-for="room in space?.userRooms ?? []" :key="room.h">
                    <flux:navlist.item icon="hashtag" class="cursor-pointer" x-on:click="Livewire.navigate('/rooms/' + encodeURIComponent(room.h))"><span x-text="room.name"></span></flux:navlist.item>
                </template>

                <flux:navlist.group heading="Andere Räume" x-show="(space?.otherRooms.length ?? 0) > 0">
                    <template x-for="room in space?.otherRooms ?? []" :key="room.h">
                        <flux:navlist.item icon="hashtag" class="cursor-pointer" x-on:click="Livewire.navigate('/rooms/' + encodeURIComponent(room.h))"><span x-text="room.name"></span></flux:navlist.item>
                    </template>
                </flux:navlist.group>
            </flux:navlist>
        </div>
    </div>

    <x-chat::bottom-nav />
</main>
