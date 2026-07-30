{{-- Der Navigator (Plan „Desktop-Shell", P4) — die linke Spalte ab `xl`.

     ── Warum `<template x-if>` und nicht `hidden xl:flex` ────────────────────
     Alpine initialisiert `x-data` auch in Elementen, die per CSS versteckt sind.
     Ein reines `hidden xl:flex` bootete `nostrRail` deshalb auf JEDEM Telefon mit
     — samt Relay-Subscription für eine Spalte, die dort niemand je sieht. `x-if`
     entscheidet über die EXISTENZ des Knotens; das ist der Unterschied, auf den
     es hier ankommt. Der Store dahinter hört auf `matchMedia`, siehe `viewport.ts`.

     ── Warum `nostrRail` und nicht `nostrSpaces` ─────────────────────────────
     Die Rail steht auf JEDER Seite, auch auf `/rooms/{h}`. `nostrSpaces.init()`
     ruft als erstes `clearEphemeralSpace()` — auf einer Raumseite risse das den
     Workspace-Kontext weg, der Verlauf bliebe leer. `nostrRail` ist die lesende
     Alternative: sie abonniert `activeSpace`/`activeSpaceView`, mutiert nie.

     ── Was die Rail bewusst NICHT kann ──────────────────────────────────────
     Kategorien, Filter, Raum-Verwaltung, den Segment-Umschalter. Sie ist eine
     Sprungliste, keine zweite Raumübersicht. Für alles andere führt „Alle Räume"
     auf `/spaces`. Der Segment-Umschalter bleibt dort auch technisch: `flux:tabs`
     und `flux:tab.panel` müssen im selben Baum stehen — ein `flux:tab` ohne sein
     Panel wirft und reißt die ganze Insel mit. --}}
<template x-if="$store.viewport?.desktop">
    <div x-data="nostrRail"
         class="hidden min-h-0 flex-col border-e border-zinc-200 bg-white xl:flex dark:border-zinc-800 dark:bg-zinc-900">

        {{-- Space-Kopf: „wo bin ich" gehört an den Anfang der Ortsspalte. --}}
        <div class="flex shrink-0 items-center gap-2.5 px-4 pt-4 pb-3">
            <x-group::nostr-avatar picture="space?.icon" name="spaceLabel" size="2rem" />
            <div class="min-w-0 flex-1">
                <div class="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100" x-text="spaceLabel"></div>
                <div x-show="space?.description" x-cloak class="truncate text-[0.7rem] text-muted" x-text="space?.description"></div>
            </div>
        </div>

        {{-- Die Signatur des Clients: der `#`-Prompt. Tippen filtert die Liste
             darunter, Enter springt in den ersten Treffer. `type=search` gibt dem
             Feld die native Leeren-Geste; `#` ist Dekoration und deshalb
             aria-hidden — das Label steht am Input. --}}
        <label class="mx-3 mb-2 flex shrink-0 items-center gap-1.5 rounded-tile bg-zinc-100 px-2.5 py-1.5 focus-within:ring-2 focus-within:ring-accent dark:bg-zinc-800">
            <span aria-hidden="true" class="font-mono text-sm font-bold text-brand-800 dark:text-brand-400">#</span>
            <input type="search" x-model="query" x-ref="prompt"
                   x-on:focus="focused = true" x-on:blur="focused = false"
                   x-on:keydown.enter.prevent="jumpToFirst()"
                   x-on:keydown.escape="query = ''; $el.blur()"
                   class="min-w-0 flex-1 border-0 bg-transparent p-0 text-sm text-zinc-900 placeholder:text-muted focus:ring-0 dark:text-zinc-100"
                   placeholder="{{ __('Raum springen') }}" aria-label="{{ __('Raum springen') }}" />
            {{-- Das Kürzel steht nur, solange das Feld leer und unfokussiert ist —
                 danach ist es Ballast neben dem eigenen Text. `aria-hidden`, weil
                 die Tastaturbedienung ohnehin über das Label läuft und ein
                 vorgelesenes „Meta K" hier nichts erklärt. --}}
            <kbd x-show="!query && !focused" aria-hidden="true"
                 class="shrink-0 rounded bg-black/5 px-1 font-mono text-[0.65rem] text-muted dark:bg-white/10">⌘K</kbd>
        </label>

        {{-- Die zweite Hälfte der Tastaturbedienung. Einmal genannt, nicht als
             Dauer-Hinweis: die Zeile verschwindet, sobald gefiltert wird. --}}
        <p x-show="!query" class="mb-2 px-3 text-[0.65rem] text-muted">
            {{ __('Alt + ↑/↓ wechselt den Raum') }}
        </p>

        {{-- Die einzige Fläche, die scrollt. `min-h-0` ist Pflicht: ohne das
             wächst ein Flex-Kind über seinen Container hinaus statt zu scrollen. --}}
        <div class="min-h-0 flex-1 overflow-y-auto px-3 pb-2">

            {{-- Meine Räume --}}
            <template x-if="userRooms.length">
                <div class="mb-3">
                    <div class="flex items-center justify-between px-2 pb-1">
                        <span class="text-[0.7rem] font-semibold uppercase tracking-wider text-muted">{{ __('Meine Räume') }}</span>
                        <span class="font-mono text-[0.7rem] tabular-nums text-muted" x-text="userRooms.length"></span>
                    </div>
                    <template x-for="room in userRooms" :key="room.h">
                        <x-group::rail-room-row />
                    </template>
                </div>
            </template>

            {{-- Andere Räume des Space --}}
            <template x-if="otherRooms.length">
                <div class="mb-3">
                    <div class="flex items-center justify-between px-2 pb-1">
                        <span class="text-[0.7rem] font-semibold uppercase tracking-wider text-muted">{{ __('Andere Räume') }}</span>
                        <span class="font-mono text-[0.7rem] tabular-nums text-muted" x-text="otherRooms.length"></span>
                    </div>
                    <template x-for="room in otherRooms" :key="room.h">
                        <x-group::rail-room-row />
                    </template>
                </div>
            </template>

            {{-- Leerer Filter ist ein Zustand, keine Panne — er bekommt einen Satz. --}}
            <template x-if="query.trim() && matchCount === 0">
                <p class="px-2 py-3 text-sm text-muted">{{ __('Kein Raum passt zu dieser Suche.') }}</p>
            </template>

            {{-- Der Weg zu allem, was die Rail bewusst nicht kann. --}}
            <a href="{{ route('group.spaces') }}" wire:navigate
               class="pressable mt-1 flex min-h-9 items-center gap-2 rounded-tile px-2 text-sm font-medium text-muted transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100">
                <flux:icon.squares-2x2 variant="micro" class="size-4 shrink-0" />
                <span>{{ __('Alle Räume & Entdecken') }}</span>
            </a>
        </div>

        {{-- Fußzeile: die drei Nav-Ziele, darunter Glocke und Identität. --}}
        <div class="shrink-0 border-t border-zinc-200 px-3 py-2 dark:border-zinc-800">
            <x-group::bottom-nav orientation="rail" />

            <div x-data="nostrAuth" class="mt-2 flex items-center gap-1 border-t border-zinc-200 pt-2 dark:border-zinc-800">
                <a href="{{ route('group.updates') }}" wire:navigate
                   :aria-label="$store.unread?.updates ? @js(__('Neu, ')) + $store.unread.updates + ($store.unread.updates === 1 ? @js(' '.__('ungelesener Hinweis')) : @js(' '.__('ungelesene Hinweise'))) : ($store.unread?.updates === undefined && $store.unread?.any ? @js(__('Neu, ungelesene Nachrichten')) : @js(__('Neu')))"
                   class="pressable relative flex size-9 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-black/5 dark:hover:bg-white/5">
                    <flux:icon.bell class="size-5 text-muted" />
                    <x-group::unread-badge count="$store.unread?.updates" :cap="9" size="sm" :sr="false"
                                           badge-class="absolute end-0.5 top-0.5 ring-2 ring-white dark:ring-zinc-900" />
                    <x-group::unread-dot when="$store.unread?.updates === undefined && $store.unread?.any" :sr="false"
                                         dot-class="absolute end-1.5 top-1.5 ring-2 ring-white dark:ring-zinc-900" />
                </a>

                {{-- Identität unten links — die eingeführte Desktop-Konvention. Das
                     Popover-Markup ist dasselbe wie im Mobil-Kopf, nur der Ursprung
                     kehrt sich um: es öffnet nach OBEN (`bottom-full`), sonst führe
                     es aus dem Fenster. --}}
                <div x-data="{ open: false }" class="relative min-w-0 flex-1">
                    <button type="button" x-on:click="open = !open" aria-haspopup="true" :aria-expanded="open"
                            :aria-label="@js(__('Angemeldet als ')) + myName"
                            class="pressable flex w-full min-w-0 items-center gap-2 rounded-tile px-1.5 py-1 transition-colors hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:hover:bg-white/5">
                        <x-group::nostr-avatar picture="myPicture" name="myName" size="1.75rem" />
                        <span class="min-w-0 flex-1 truncate text-start text-sm font-semibold text-zinc-900 dark:text-zinc-100" x-text="myName"></span>
                        <x-group::nostr-nip05 nip05="myNip05" />
                        <flux:icon.chevron-up variant="micro" class="size-4 shrink-0 text-muted transition-transform" ::class="open ? 'rotate-180' : ''" />
                    </button>

                    <div x-show="open" x-cloak x-transition
                         x-on:click.outside="open = false" x-on:keydown.escape.window="open = false"
                         class="surface-card absolute bottom-full start-0 z-30 mb-2 w-72 origin-bottom-left p-4 shadow-lg">
                        <div class="flex items-start gap-3">
                            <x-group::nostr-avatar picture="myPicture" name="myName" size="2.75rem" />
                            <div class="min-w-0 flex-1">
                                <div class="flex min-w-0 items-center gap-1">
                                    <span class="min-w-0 truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100" x-text="myName"></span>
                                    <x-group::nostr-nip05 nip05="myNip05" />
                                </div>
                                <div x-show="myNip05" x-cloak class="truncate text-xs text-muted" x-text="myNip05"></div>
                            </div>
                        </div>

                        <p x-show="myAbout" x-cloak class="mt-3 line-clamp-3 text-sm leading-normal text-muted" x-text="myAbout"></p>

                        <div class="mt-3 border-t border-zinc-200/60 pt-3 dark:border-zinc-800/60">
                            <button type="button" x-on:click="copy(npub, 'npub')" aria-label="{{ __('npub kopieren') }}"
                                    class="pressable group/npub flex w-full items-start gap-2 rounded-tile text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
                                <span class="min-w-0 flex-1 break-all font-mono text-[0.7rem] leading-relaxed text-muted" x-text="npub"></span>
                                <flux:icon.clipboard variant="micro" class="mt-0.5 size-3.5 shrink-0 text-muted transition-colors group-hover/npub:text-brand-500" />
                            </button>
                            <div x-show="signerLabel" x-cloak class="mt-1.5 inline-flex items-center gap-1 rounded-full bg-brand-500/10 px-2 py-0.5 text-[0.7rem] font-medium text-brand-800 dark:text-brand-400">
                                <flux:icon.key variant="micro" class="size-3 shrink-0" />
                                <span x-text="@js(__('Angemeldet über ')) + signerLabel"></span>
                            </div>
                        </div>

                        {{-- KEIN „Abmelden" hier. Der Screen `group.settings` ist der
                             EINE Ort dafür (`nostrAuth`-Teardown, festgehalten in
                             `SettingsMergeTest`) — und er hängt in dieser Rail eine
                             Zeile weiter oben als eigenes Nav-Ziel. Ein zweiter
                             Logout-Knopf auf JEDER Seite wäre genau die Doppelung,
                             die dort einmal von 3 auf 1 zurückgebaut wurde. Das
                             Popover ist eine Identitätskarte, kein Kontomenü. --}}
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>
