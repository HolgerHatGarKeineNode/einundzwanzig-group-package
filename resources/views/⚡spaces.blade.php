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
new #[Layout('group::einundzwanzig')] #[Title('Space')] class extends Component {}; ?>

<main class="mx-auto max-w-md px-4 py-8 pt-safe pb-28 md:max-w-lg lg:max-w-2xl">

    {{-- Genau EIN fixierter Space + seine Räume (kein Multi-Space-Layout, §12).
         Der `nostrSpaces`-Scope umschließt auch den Header, damit dessen Titel den
         echten Space-Namen (NIP-11) zeigen kann (B1). --}}
    <div x-data="nostrSpaces" class="page-enter">

        {{-- Kopf: echter Space-Name (NIP-11, Fallback „Space") + NIP-11-Beschreibung
             + wer bin ich + Abmelden. Space-Identität lebt NUR hier (kein doppelter
             Name in der Karte darunter). --}}
        <x-group::app-header title="Space" title-expr="space?.label || 'Space'" x-data="nostrAuth">
            <x-slot:subtitle>
                <div x-show="space?.description" x-cloak class="truncate text-xs text-muted" x-text="space?.description"></div>
                <div class="truncate font-mono text-xs text-muted" x-text="npub"></div>
            </x-slot:subtitle>
            <x-slot:actions>
                <flux:button variant="ghost" size="sm" x-on:click="doLogout()">Abmelden</flux:button>
            </x-slot:actions>
        </x-group::app-header>

        {{-- Vereins-Gate: Nicht-Vereinsmitglieder auf einem EINUNDZWANZIG-Vereins-Relay --}}
        <x-group::verein-gate context="Räume und Chat" class="mb-4" />

        {{-- Erstes Laden: Space-Meta noch nicht da → Skeleton-Card statt nackte Fläche. --}}
        <div x-show="!space && loading" x-cloak class="surface-card p-4" aria-busy="true">
            <span class="sr-only" aria-live="polite">Space wird geladen…</span>
            <div class="flex items-center gap-2">
                <div class="skeleton size-4"></div>
                <div class="skeleton h-4 w-32"></div>
            </div>
            <div class="mt-3 space-y-2">
                <div class="skeleton h-4 w-40"></div>
                <div class="skeleton h-4 w-28"></div>
                <div class="skeleton h-4 w-36"></div>
            </div>
        </div>

        <div x-show="space" x-cloak class="surface-card overflow-hidden">
            {{-- Karten-Kopf: Eyebrow „Räume" + Zähler geben der Liste eine Identität
                 (Terminal-/Channel-Anmutung: mono, Brand-Ramp). --}}
            <div class="flex items-center justify-between gap-2 border-b border-zinc-200/80 px-4 py-3 dark:border-zinc-800/80">
                <div class="flex items-center gap-2">
                    <flux:icon.hashtag variant="solid" class="size-4 text-brand-500" />
                    <span class="text-xs font-semibold uppercase tracking-[0.2em] text-brand-600 dark:text-brand-400">Räume</span>
                </div>
                <span x-show="((space?.userRooms.length ?? 0) + (space?.otherRooms.length ?? 0)) > 0" x-cloak
                      class="rounded-full bg-brand-500/10 px-2 py-0.5 font-mono text-xs font-semibold text-brand-600 dark:text-brand-400"
                      x-text="(space.userRooms.length + space.otherRooms.length)"></span>
            </div>

            <div class="p-3">
                {{-- Räume laden noch --}}
                <template x-if="loading && space && space.userRooms.length === 0 && space.otherRooms.length === 0">
                    <div class="space-y-2 p-2">
                        <div class="skeleton h-8 rounded-tile"></div>
                        <div class="skeleton h-8 rounded-tile"></div>
                    </div>
                </template>

                {{-- Vereins-gated: die Räume liefert der Relay gar nicht aus → erklärende Zeile. --}}
                <template x-if="!loading && space && space.userRooms.length === 0 && space.otherRooms.length === 0 && gatedOut">
                    <div class="empty-state py-6 text-center">
                        <flux:icon.lock-closed class="mx-auto size-8 text-zinc-400" />
                        <flux:text class="mt-2 text-sm">Räume sind nur für Vereinsmitglieder sichtbar.</flux:text>
                    </div>
                </template>

                {{-- Wirklich leer: Icon + Text (empty-state) statt grauer Zeile — konsistent zu Room/Directory. --}}
                <template x-if="!loading && space && space.userRooms.length === 0 && space.otherRooms.length === 0 && !gatedOut">
                    <div class="empty-state py-6 text-center">
                        <flux:icon.hashtag class="mx-auto size-8 text-zinc-400" />
                        <flux:text class="mt-2 text-sm">Dieser Space hat noch keine Räume.</flux:text>
                    </div>
                </template>

                {{-- Meine Räume (beigetreten laut 39002) --}}
                <template x-if="(space?.userRooms.length ?? 0) > 0">
                    <div>
                        <p class="px-2 pb-1 text-[0.7rem] font-semibold uppercase tracking-wider text-muted">Meine Räume</p>
                        <div class="space-y-0.5">
                            <template x-for="room in space.userRooms" :key="room.h">
                                <x-group::room-tile />
                            </template>
                        </div>
                    </div>
                </template>

                {{-- Entdeckbare Räume --}}
                <template x-if="(space?.otherRooms.length ?? 0) > 0">
                    <div :class="(space?.userRooms.length ?? 0) > 0 ? 'mt-3' : ''">
                        <p class="px-2 pb-1 text-[0.7rem] font-semibold uppercase tracking-wider text-muted">Andere Räume</p>
                        <div class="space-y-0.5">
                            <template x-for="room in space.otherRooms" :key="room.h">
                                <x-group::room-tile />
                            </template>
                        </div>
                    </div>
                </template>
            </div>
        </div>
    </div>

    <x-group::bottom-nav />
</main>
