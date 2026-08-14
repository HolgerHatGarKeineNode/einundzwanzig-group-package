@props([
    // Der Gruppenschlüssel aus `railGroups.ts` — 'rooms' | 'meetups' | 'proposals' | 'workspace'.
    'group',
    'label',
    // Nur die Meetup-Gruppe trägt die Länder-Chips.
    'countries' => false,
])

{{-- Ein Abschnitt des Desktop-Navigators. Steht im `nostrRail`-Scope und liest die
     fertig gebaute Gruppe über `groupFor('<key>')` — die Gruppierung selbst ist
     reine, node-getestete Logik (`js/railGroups.ts`), kein Blade-Ausdruck.

     ── Zu heißt nicht weg ───────────────────────────────────────────────────
     Ein geschlossener Kopf trägt die Ungelesen-SUMME seiner Zeilen als deckende
     Pille. Ist die Gruppe offen, tragen die Zeilen die Pillen und der Kopf zeigt
     nur den grauen Bestand. Ein Zähler, ein Ort.

     ── Der Auf/Zu-Zustand liegt in localStorage, nicht nur in Alpine ────────
     `wire:navigate` baut die Insel bei JEDEM Raumwechsel neu auf — reiner
     Alpine-State wäre nach jedem Klick wieder Default. Die Gruppe des aktiven
     Raums klappt zusätzlich immer auf: sonst beantwortet die Rail „wo bin ich"
     nicht mehr, ihren ersten Zweck.

     ── Die Lupe ist ein GESCHWISTER-Button, nicht verschachtelt ─────────────
     Ein Button in einem Button ist ungültiges HTML und für die Tastatur nicht
     erreichbar. Sie ist immer da, nicht nur bei Hover — sonst existiert sie für
     Tastaturnutzer gar nicht. --}}
@php($id = 'rail-group-'.$group)

<template x-if="groupFor(@js($group)).total > 0 || @js($group) === 'rooms'">
    <section class="pt-2">
        <div class="flex min-h-7 items-center gap-1 px-2">
            <button type="button"
                    x-on:click="toggleGroup(@js($group))"
                    x-bind:aria-expanded="isOpen(@js($group)) ? 'true' : 'false'"
                    aria-controls="{{ $id }}"
                    class="pressable -ms-1 flex min-w-0 flex-1 items-center gap-1 rounded px-1 py-0.5 text-start">
                <flux:icon.chevron-right variant="micro" aria-hidden="true"
                                         class="size-3 shrink-0 text-muted transition-transform"
                                         x-bind:class="isOpen(@js($group)) ? 'rotate-90' : ''" />
                <span class="min-w-0 truncate text-[0.7rem] font-semibold uppercase tracking-wider text-muted">{{ $label }}</span>
                @isset($suffix)
                    {{ $suffix }}
                @endisset
            </button>

            {{-- Bestand grau, immer. Bei ZUGEKLAPPTER Gruppe zusätzlich die
                 Ungelesen-Summe — der einzige Ort, an dem sie erscheint. --}}
            <span class="shrink-0 font-mono text-[0.7rem] tabular-nums text-muted"
                  x-text="groupFor(@js($group)).total"></span>
            <template x-if="!isOpen(@js($group))">
                <x-group::unread-badge :count="'groupUnread(\''.$group.'\')'" size="sm" :sr="false" />
            </template>

            <button type="button" x-on:click="scopeToGroup(@js($group))"
                    class="pressable inline-flex size-6 shrink-0 items-center justify-center rounded text-muted transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                    x-bind:aria-label="@js(__('In :label suchen', ['label' => $label]))">
                <flux:icon.magnifying-glass variant="micro" aria-hidden="true" class="size-3.5" />
            </button>
        </div>

        <div id="{{ $id }}" x-show="isOpen(@js($group))" x-cloak class="mt-0.5 space-y-px">
            @if ($countries)
                {{-- Länder als umbrechende Chip-Reihe, NICHT als Untergruppen: 20 Länder
                     wären als Zeilen ~660px, als Chips ~136px. Es ist das einzige Element
                     der Rail, das in zwei Dimensionen skaliert — deshalb ungekappt.
                     Fläche statt Ring (1.4.11), `aria-label` mit Ländernamen (1.1.1). --}}
                <template x-if="countryOptions.length > 1">
                    <div class="flex flex-wrap gap-1 px-2 pb-1.5">
                        <template x-for="c in countryOptions" :key="c.country">
                            <button type="button" x-on:click="toggleCountry(c.country)"
                                    x-bind:aria-label="c.name + ' (' + c.count + ')'"
                                    x-bind:aria-pressed="scope.country === c.country ? 'true' : 'false'"
                                    class="pressable inline-flex items-center gap-1 rounded-pill px-1.5 py-0.5 text-[0.7rem] transition-colors"
                                    x-bind:class="scope.country === c.country
                                        ? 'bg-brand-500/10 font-semibold text-zinc-900 dark:text-zinc-50'
                                        : 'bg-zinc-100 text-muted hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700'">
                                <span aria-hidden="true" x-text="c.flag"></span>
                                <span class="font-mono tabular-nums" x-text="c.count"></span>
                            </button>
                        </template>
                    </div>
                </template>
            @endif

            <template x-for="room in groupFor(@js($group)).joined" :key="room.h">
                <x-group::rail-room-row />
            </template>

            {{-- Haarlinie statt zweiter Überschrift: die Kontraststufe darunter sagt
                 bereits „nicht beigetreten". Ein zweites Sektionslabel brächte die
                 Achse zurück, die der Gruppenschnitt gerade entfernt hat. --}}
            <template x-if="groupFor(@js($group)).joined.length && groupFor(@js($group)).others.length">
                <div class="my-1 border-t border-zinc-200/60 dark:border-zinc-800/60"></div>
            </template>

            <template x-for="room in groupFor(@js($group)).others" :key="room.h">
                <x-group::rail-room-row />
            </template>

            {{-- Kappungs-Fußzeile: nennt die Zahl und bietet den Weg dorthin an.
                 Eine stille Kappung liest sich wie „mehr gibt es nicht". --}}
            <template x-if="groupFor(@js($group)).hiddenCount > 0">
                <button type="button" x-on:click="scopeToGroup(@js($group))"
                        class="pressable flex min-h-7 w-full items-center gap-1 rounded-tile px-2 text-start text-[0.7rem] text-muted transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100">
                    <span x-text="@js(__('Noch :count — tippen zum Filtern')).replace(':count', groupFor(@js($group)).hiddenCount)"></span>
                </button>
            </template>

            <template x-if="groupFor(@js($group)).total === 0">
                <p class="px-2 py-1.5 text-[0.7rem] text-muted">{{ __('Kein Treffer in dieser Gruppe.') }}</p>
            </template>
        </div>
    </section>
</template>
