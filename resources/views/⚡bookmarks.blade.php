<?php

use Livewire\Attributes\Layout;
use Livewire\Component;

/**
 * Lesezeichen-View (`/bookmarks`, P2) als Livewire-Full-Page-SFC.
 * Dünner Shell wie `⚡updates.blade.php`: Liste, Rechte und Schreibpfad liegen
 * vollständig im Alpine-Store `bookmarks` (js/bookmarks.ts), die reinen Regeln
 * daneben in `js/bookmarkModels.ts`. Kein `mount()` — es gibt nichts server-seitig
 * vorzubereiten (kein OG-Bild: die Seite liegt hinter `nostr.auth` und wird nie
 * geteilt oder gecrawlt).
 */
new #[Layout('group::einundzwanzig')] class extends Component
{
    public function render()
    {
        return $this->view()->title(__('Lesezeichen'));
    }
}; ?>

<x-group::app-shell>

    {{-- EIN Wurzel-Element unter der Shell. Anders als `/updates` hat dieser Screen
         KEINE eigene Insel: der ganze Zustand liegt im Store `bookmarks`, weil ihn
         auch das Nachrichten-Menü im Raum liest (Begründung im Kopf von
         `js/bookmarks.ts`). Eine zweite Insel wäre eine zweite Wahrheit über
         „ist das gemerkt?".

         `init`/`destroy` halten den Store am Leben, solange dieser Screen steht —
         dasselbe Muster wie die Pin-Leiste in `⚡room.blade.php`. Der Zähler in
         `mount`/`unmount` deckt dabei ab, dass `wire:navigate` den neuen Body
         EINHÄNGT, bevor es den alten abräumt. --}}
    <div x-data="{
             init() { $store.bookmarks?.mount() },
             destroy() { $store.bookmarks?.unmount() },
         }"
         class="page-enter">

        {{-- Kopf: UP-Ziel ist die Übersicht (explizites Ziel, nie history.back() —
             der Deep-Link-Kaltstart hat keinen Stack). --}}
        <x-group::app-header :title="__('Lesezeichen')" :back="route('group.spaces')" />

        {{-- Fehler des Relays, wörtlich. Gleiche Bauart wie die Pin-Leiste: der
             Originalwortlaut ist bei einer Ablehnung die einzige ehrliche Auskunft,
             die wir haben. --}}
        <template x-if="$store.bookmarks?.error">
            <flux:callout variant="danger" icon="exclamation-triangle" class="mb-3">
                <flux:callout.text x-text="$store.bookmarks.error"></flux:callout.text>
                <x-slot name="actions">
                    <flux:button size="sm" variant="ghost" x-on:click="$store.bookmarks.dismissError()">{{ __('Verstanden') }}</flux:button>
                </x-slot>
            </flux:callout>
        </template>

        {{-- Der private Teil einer NIP-51-Liste ist verschlüsselt. Dieser Client
             entschlüsselt ihn nicht (und verschlüsselt ihn nie neu — er kann hier
             also nicht verloren gehen), zeigt ihn folglich auch nicht. Eine Fläche,
             die Einträge stillschweigend weglässt, ist der schlechtere Fehler:
             deshalb steht die Tatsache da, statt verborgen zu bleiben. --}}
        <template x-if="$store.bookmarks?.hasPrivate">
            <flux:callout variant="secondary" icon="lock-closed" class="mb-3">
                <flux:callout.text>{{ __('Diese Liste hat einen privaten Teil, den dieser Client nicht anzeigt. Er bleibt unangetastet.') }}</flux:callout.text>
            </flux:callout>
        </template>

        {{-- `tabindex="-1"` + `x-ref="list"`: Auffang für Fokus-Übergaben, nicht
             tabbierbar. `:aria-busy` sagt Hilfstechnik, dass gerade befüllt wird. --}}
        <div x-ref="list" tabindex="-1" :aria-busy="$store.bookmarks?.loading" class="surface-card overflow-hidden">

            {{-- Lade-Ansage. Steht PERMANENT im DOM und AUSSERHALB des Lade-Blocks,
                 server-seitig LEER: `aria-live` meldet Änderungen INNERHALB einer
                 bestehenden Region — ein Text, der schon beim Seitenaufbau dasteht,
                 wird nie angesagt. Gleiche Begründung wie in `⚡updates`. --}}
            <span class="sr-only" aria-live="polite"
                  x-text="$store.bookmarks?.loading ? @js(__('Lesezeichen werden geladen…')) : ''"></span>

            {{-- Nichts zu zeigen → Laden ODER Leerzustand. KEIN x-cloak auf diesem
                 Wrapper: das server-gerenderte Skeleton darunter muss ab dem ERSTEN
                 Paint stehen, sonst blitzt die Fläche weiß, bis Alpine bootet. --}}
            <div x-show="!($store.bookmarks?.entries?.length || $store.bookmarks?.links?.length)">

                {{-- Laden. SERVER-gerendert per @for, NICHT x-if: ein x-if-Template
                     existiert vor dem Alpine-Boot gar nicht im DOM. --}}
                <div x-show="!$store.bookmarks || $store.bookmarks.loading || !$store.bookmarks.ready"
                     class="divide-y divide-zinc-200/60 dark:divide-zinc-800/60">
                    @for ($i = 0; $i < 4; $i++)
                        <div class="flex items-start gap-3 px-4 py-3">
                            <div class="skeleton size-10 shrink-0 rounded-tile"></div>
                            <div class="min-w-0 flex-1 space-y-2 py-0.5">
                                <div class="skeleton h-3 w-24"></div>
                                <div class="skeleton h-3 w-2/3"></div>
                            </div>
                        </div>
                    @endfor
                </div>

                {{-- Leer: Aussage, Erwartung und ein Weg heraus (kein leerer Screen). --}}
                <div x-show="$store.bookmarks?.ready && !$store.bookmarks.loading" x-cloak
                     class="empty-state px-4 py-10 text-center">
                    <flux:icon.bookmark class="mx-auto size-8 text-zinc-400" />
                    <flux:heading class="mt-2">{{ __('Noch nichts gemerkt.') }}</flux:heading>
                    <flux:text class="mt-1 text-sm text-muted">{{ __('Über „Merken“ im Nachrichtenmenü landet eine Nachricht hier.') }}</flux:text>
                    <div class="mt-4">
                        <flux:button size="sm" variant="ghost" icon="hashtag" :href="route('group.spaces')" wire:navigate>{{ __('Zu den Räumen') }}</flux:button>
                    </div>
                </div>
            </div>

            {{-- Die gemerkten NACHRICHTEN. Ganze Zeile = ein Link (keine
                 verschachtelten Interaktiven) — dieselbe Regel wie room-tile und die
                 Updates-Liste. Der Lösen-Knopf steht daneben, nicht darin. --}}
            <div x-show="$store.bookmarks?.entries?.length" x-cloak
                 class="divide-y divide-zinc-200/60 dark:divide-zinc-800/60">
                <template x-for="entry in $store.bookmarks.entries" :key="entry.id">
                    <div class="flex items-start gap-2 px-2">

                        {{-- Ein Lesezeichen kann älter sein als jedes geladene Fenster.
                             Solange die Nachricht fehlt, bleibt die Zeile STEHEN und
                             sagt es — verschwinden wäre die falsche Auskunft, und ein
                             Link ins Nichts die zweitfalsche. Deshalb zwei Formen:
                             aufgelöst ein Link, sonst ein inertes Feld. --}}
                        <template x-if="entry.resolved && entry.href">
                            <a :href="entry.href" wire:navigate
                               class="pressable flex min-w-0 flex-1 items-start gap-3 rounded-tile px-2 py-3 text-left transition-colors hover:bg-brand-500/5">
                                <span class="min-w-0 flex-1">
                                    <span class="mb-1 flex items-center gap-2 text-[0.7rem] font-semibold uppercase tracking-wider text-muted">
                                        <span class="truncate" x-text="entry.name"></span>
                                        <span x-show="entry.set" x-cloak x-text="entry.set"
                                              class="shrink-0 rounded-pill bg-black/5 px-1.5 py-0.5 normal-case dark:bg-white/10"></span>
                                    </span>
                                    <span class="mt-1 block text-sm leading-normal text-zinc-900 line-clamp-2 dark:text-zinc-100" x-text="entry.text"></span>
                                    <span class="mt-2 block text-xs text-muted" x-text="entry.time"></span>
                                </span>
                                <flux:icon.chevron-right class="mt-1 size-4 shrink-0 text-muted" />
                            </a>
                        </template>
                        <template x-if="!(entry.resolved && entry.href)">
                            <div class="min-w-0 flex-1 px-2 py-3 text-sm text-muted">{{ __('(Nachricht wird geladen…)') }}</div>
                        </template>

                        {{-- Lösen. **`canRemove` und nicht `canBookmark`** — der
                             Unterschied ist der zwischen einem Knopf und einer Lüge:
                             eine Nachricht, die nur in einem FREMDEN 30003-Set steht,
                             erscheint hier als gewöhnliche Zeile, ist aber von hier aus
                             nicht lösbar (dieser Client schreibt keine Sets). Der Klick
                             hätte unser eigenes — womöglich leeres — 10003 neu
                             geschrieben, das Set nicht angefasst, die Zeile stehen
                             gelassen und trotzdem ein signiertes Ereignis abgesetzt.
                             Dieselbe Bedingung trägt die Link-Zeile weiter unten; beide
                             lesen dieselbe Methode, damit sie nicht auseinanderlaufen.

                             `disabled` an `busy`, sonst ist der Knopf während eines
                             laufenden Schreibvorgangs ein stiller Blindgänger —
                             `toggle()` verwirft den Klick dann, und das Fenster endet
                             erst mit dem Verdikt des Relays. Dieselbe Bindung wie an
                             der Pin-Leiste. --}}
                        <flux:button size="xs" variant="ghost" icon="x-mark" class="icon-btn-touch mt-3 shrink-0"
                                     data-bookmark-remove="entry"
                                     x-show="$store.bookmarks?.canRemove(entry.id)" x-cloak
                                     x-bind:disabled="$store.bookmarks.busy"
                                     x-on:click="$store.bookmarks.toggle(entry.id)"
                                     aria-label="{{ __('Nicht mehr merken') }}" />
                    </div>
                </template>
            </div>

            {{-- Alles, was keine Nachricht ist: Adressen, Themen, Links. Sie stammen
                 aus Listen, die ein FREMDER Client geschrieben hat — dieser hier legt
                 sie nie an. Sie trotzdem zu zeigen ist der Punkt: eine Fläche, die
                 fremde Einträge verschweigt und beim nächsten Schreiben unangetastet
                 mitführt, lässt den Nutzer glauben, sie seien weg.

                 Nur `r` wird zum Link, und nur durch `sanitizeUrl` (in der Insel,
                 nicht hier): `javascript:` in einem `href` wäre eine Skript-Injektion
                 über ein einziges fremdes Tag. --}}
            <div x-show="$store.bookmarks?.links?.length" x-cloak
                 class="border-t border-zinc-200/60 dark:border-zinc-800/60">
                <h2 class="px-4 pb-1 pt-4 text-[0.7rem] font-semibold uppercase tracking-wider text-muted">{{ __('Weitere Lesezeichen') }}</h2>
                <div class="divide-y divide-zinc-200/60 dark:divide-zinc-800/60">
                    <template x-for="link in $store.bookmarks.links" :key="link.type + ':' + link.value">
                        <div class="flex items-center gap-2 px-2">
                            <template x-if="link.href">
                                <a :href="link.href" target="_blank" rel="noopener noreferrer"
                                   class="pressable flex min-w-0 flex-1 items-center gap-3 rounded-tile px-2 py-3 transition-colors hover:bg-brand-500/5">
                                    <flux:icon.link variant="micro" class="size-4 shrink-0 text-muted" />
                                    <span class="min-w-0 flex-1 truncate text-sm text-zinc-900 dark:text-zinc-100" x-text="link.value"></span>
                                </a>
                            </template>
                            <template x-if="!link.href">
                                <div class="flex min-w-0 flex-1 items-center gap-3 px-2 py-3">
                                    <flux:icon.hashtag variant="micro" class="size-4 shrink-0 text-muted" />
                                    <span class="min-w-0 flex-1 truncate text-sm text-zinc-900 dark:text-zinc-100" x-text="link.value"></span>
                                </div>
                            </template>
                            {{-- Dieselbe Bedingung wie an der Nachrichten-Zeile, und
                                 dieselbe Begründung dort: nur was in der eigenen 10003
                                 steht, ist von hier aus lösbar. --}}
                            <flux:button size="xs" variant="ghost" icon="x-mark" class="icon-btn-touch shrink-0"
                                         data-bookmark-remove="link"
                                         x-show="$store.bookmarks?.canRemove(link.value)" x-cloak
                                         x-bind:disabled="$store.bookmarks.busy"
                                         x-on:click="$store.bookmarks.toggle(link.value)"
                                         aria-label="{{ __('Nicht mehr merken') }}" />
                        </div>
                    </template>
                </div>
            </div>
        </div>
    </div>

</x-group::app-shell>
