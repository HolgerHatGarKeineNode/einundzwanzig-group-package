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
    <div x-data="nostrRail" data-rail
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
        {{-- Ein Feld, ein Scope. Zehn Suchfelder (vier Gruppen + sieben Länder)
             wären 340px in einer Spalte mit ~600px Scrollfläche — die Rail wäre
             zur Hälfte Formular, und man müsste zum Suchen erst scrollen.
             Der Chip kostet 0px zusätzliche Höhe und macht die Gruppenstruktur
             adressierbar statt nur aufklappbar. --}}
        <label class="mx-3 mb-2 flex shrink-0 items-center gap-1.5 rounded-tile bg-zinc-100 px-2.5 py-1.5 focus-within:ring-2 focus-within:ring-accent dark:bg-zinc-800">
            <span aria-hidden="true" class="font-mono text-sm font-bold text-brand-800 dark:text-brand-400">#</span>

            <template x-if="scope.group || scope.country">
                <button type="button" x-on:click="clearScope()"
                        x-bind:aria-label="@js(__('Suchbereich aufheben: ')) + scopeLabel"
                        class="pressable inline-flex shrink-0 items-center gap-1 rounded-pill bg-brand-500/10 px-1.5 py-0.5 text-[0.7rem] font-semibold text-zinc-900 dark:text-zinc-50">
                    <span x-text="scopeLabel"></span>
                    <flux:icon.x-mark variant="micro" aria-hidden="true" class="size-3" />
                </button>
            </template>

            <input type="search" x-model="query" x-ref="prompt"
                   x-on:focus="focused = true" x-on:blur="focused = false"
                   x-on:keydown.enter.prevent="jumpToFirst()"
                   x-on:keydown.escape.prevent="onEscape($el)"
                   {{-- Der Lift hängt am `input`-Ereignis, nicht an einem `$watch` auf
                        `query` — er schreibt `query` selbst, ein Watch riefe sich rekursiv. --}}
                   x-on:input="liftToken()"
                   {{-- Platzhalter über den Sekundärtext-Token, wie das `<kbd>` weiter unten.
                        Hier stand zwischenzeitlich das Farbpaar ausgeschrieben: die Utility
                        verlor hinter einer vorangestellten Variante ihre Dark-Hälfte, der
                        Platzhalter blieb dark auf zinc-600 und lag bei 1,94:1 (WCAG 1.4.3
                        verlangt 4,5:1). Ursache war die Bauform der Utility, nicht die
                        Farbe — sie ist in `theme.css` behoben (echte Farb-Variable statt
                        eigener @utility, Begründung dort). Der Workaround kann deshalb
                        weg; eine Sonderlösung, deren Grund entfallen ist, verwirrt nur. --}}
                   class="min-w-0 flex-1 border-0 bg-transparent p-0 text-sm text-zinc-900 placeholder:text-muted focus:ring-0 dark:text-zinc-100"
                   x-bind:placeholder="scope.group || scope.country ? @js(__('Filtern…')) : @js(__('Raum springen'))"
                   aria-label="{{ __('Raum springen') }}" />

            {{-- Seit P4 öffnet ⌘K die Befehlspalette, nicht mehr dieses Feld. Die
                 Kappe blieb deshalb nicht als Dekoration stehen, sondern wurde zu
                 dem Knopf, den sie beschriftet — sonst bewürbe sie an dieser
                 Stelle eine Taste, die etwas anderes tut. Das Feld daneben bleibt,
                 was es war: der lokale Filter dieser Spalte. --}}
            <button type="button" x-show="!query && !focused"
                    x-on:click.stop.prevent="$dispatch('open-command-palette')"
                    aria-label="{{ __('Befehlspalette öffnen') }}" aria-haspopup="dialog"
                    aria-keyshortcuts="Meta+K Control+K"
                    class="pressable inline-flex h-6 shrink-0 items-center rounded bg-black/5 px-1.5 font-mono text-[0.65rem] text-muted transition-colors hover:text-zinc-900 dark:bg-white/10 dark:hover:text-zinc-100">⌘K</button>
        </label>

        {{-- Die einzige Fläche, die scrollt. `min-h-0` ist Pflicht: ohne das
             wächst ein Flex-Kind über seinen Container hinaus statt zu scrollen. --}}
        <div class="min-h-0 flex-1 overflow-y-auto px-3 pb-2">

            {{-- Vier Gruppen, feste Reihenfolge. Die zweite Achse (Mitgliedschaft)
                 wird bewusst NICHT zur Überschrift — sie ist Reihenfolge, Textgewicht
                 und eine Haarlinie INNERHALB der Gruppe. Sonst entstünden 2 × 4 × n
                 Zellen statt vier. --}}
            <x-group::rail-group group="rooms" :label="__('Räume')" />
            <x-group::rail-group group="meetups" :label="__('Meetups')" :countries="true" />
            <x-group::rail-group group="proposals" :label="__('Projektunterstützung')" />

            {{-- Der zweite Space. Existiert nur bei gesetztem `NOSTR_WORKSPACE_URL`;
                 ohne Config ist die Rail zeichengleich zu vorher. Die Räume kommen
                 aus einem EIGENEN Watch auf die Workspace-URL, nicht aus dem aktiven
                 Space — deshalb stehen hier beide nebeneinander statt abwechselnd. --}}
            <template x-if="hasWorkspaceSection">
                <div>
                    <x-group::rail-group group="workspace" :label="__('Workspace')">
                        <x-slot:suffix>
                            {{-- TEXT (11,2px), also 1.4.3 mit 4,5:1 — nicht die
                                 Icon-Schwelle. Auf dem Rail-Grund (`bg-white`, ganz
                                 oben) rechnet `brand-700` 4,40:1 und risse;
                                 `brand-800` rechnet 6,42:1. --}}
                            <span class="min-w-0 truncate text-[0.7rem] font-semibold uppercase tracking-wider text-brand-800 dark:text-brand-400"
                                  x-text="'· ' + workspaceLabel"></span>
                        </x-slot:suffix>
                    </x-group::rail-group>
                </div>
            </template>

            {{-- Leerer Filter ist ein Zustand, keine Panne — er bekommt einen Satz.
                 Und den Ort für den Tastatur-Hinweis: im Ruhezustand wäre er eine
                 stehende Zeile, die 24px Liste kostet und nach dem ersten Lesen
                 nichts mehr sagt. --}}
            <template x-if="query.trim() && rooms.length === 0">
                <div class="px-2 py-3">
                    <p class="text-sm text-muted">{{ __('Kein Raum passt zu dieser Suche.') }}</p>
                    <p class="mt-1 text-[0.7rem] text-muted">{{ __('Alt + ↑/↓ wechselt den Raum · m: p: r: w: grenzen ein') }}</p>
                </div>
            </template>

            {{-- Der Weg zu allem, was die Rail bewusst nicht kann. --}}
            <a href="{{ route('group.spaces') }}" wire:navigate
               class="pressable mt-1 flex min-h-9 items-center gap-2 rounded-tile px-2 text-sm font-medium text-muted transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100">
                <flux:icon.squares-2x2 variant="micro" class="size-4 shrink-0" />
                <span>{{ __('Alle Räume & Entdecken') }}</span>
            </a>

            {{-- Artikel (P7). Steht hier und NICHT als fünfte Rail-Gruppe: die Gruppen
                 oben sind Räume (`RailRoom` verlangt ein `h`), ein Artikel ist keiner.
                 Als Zeile neben „Alle Räume & Entdecken" beantwortet er dieselbe Frage
                 wie diese — „und was noch?" — ohne die Gruppen-Achse zu verwässern. --}}
            <a href="{{ route('group.articles') }}" wire:navigate
               class="pressable flex min-h-9 items-center gap-2 rounded-tile px-2 text-sm font-medium text-muted transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100">
                <flux:icon.document-text variant="micro" class="size-4 shrink-0" />
                <span>{{ __('Artikel') }}</span>
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

                        {{-- Abmelden, auf ausdrücklichen Nutzerwunsch (2026-07-30).
                             Ich hatte es zunächst weggelassen, weil `SettingsMergeTest`
                             „Abmelden lebt an EINEM Ort" festhält — dieser Test meint
                             aber den SETTINGS-Screen (dort waren es einmal 3 Knöpfe),
                             nicht die App. Auf Desktop ist das Profil unten links der
                             erwartete Ort dafür; der Weg über Einstellungen wäre zwei
                             Klicks für eine Aktion, die überall sonst hier sitzt.
                             Der Test zählt jetzt entsprechend nur im Seiteninhalt. --}}
                        <flux:button variant="ghost" size="sm" icon="arrow-right-start-on-rectangle"
                                     class="mt-3 w-full" x-on:click="doLogout()">{{ __('Abmelden') }}</flux:button>
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>
