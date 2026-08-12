<?php

use Livewire\Attributes\Layout;
use Livewire\Component;

/**
 * Artikelliste („Artikel", `/articles`, P7) als Livewire-Full-Page-SFC.
 *
 * Die Klasse ist ein dünner Shell — Laden, Sortieren und Rendern leben komplett in der
 * Alpine-Insel `nostrArticles` (welshman, client-seitig). Kein `mount()`: es gibt
 * server-seitig nichts vorzubereiten. Die Artikel stehen zwar öffentlich auf dem
 * Vereins-Relay, die Seite liegt aber wie alle anderen hinter `nostr.auth` — ein
 * server-gerenderter OG-Kopf wäre für einen Crawler unerreichbar.
 */
new #[Layout('group::einundzwanzig')] class extends Component
{
    public function render()
    {
        return $this->view()->title(__('Artikel'));
    }
}; ?>

<x-group::app-shell>

    {{-- Der Basis-Pfad kommt aus `route()`, nicht als Literal in die Insel: die Route
         heißt an genau einer Stelle `/articles`, und das ist `routes/group.php`. --}}
    <div x-data="nostrArticles(@js(route('group.articles')))" class="page-enter">

        <x-group::app-header :title="__('Artikel')" :back="route('group.spaces')" />

        {{-- Ob es überhaupt eine Quelle gibt, entscheidet der SERVER — nicht die Insel.

             Das ist kein Stil, sondern die Voraussetzung dafür, dass das Skeleton unten
             ab dem ersten Paint dasteht: der Inhalt eines `<template x-if>` existiert vor
             dem Alpine-Boot GAR NICHT im DOM, und ein `x-show` auf dem Leerzustand ließe
             ihn bis zum Boot aufblitzen. Beide Zweige stehen deshalb hinter `@if`.

             Folge für Tests: ein E2E-Lauf, der Artikel prüfen will, setzt
             `NOSTR_BOARD_URL` in der ENV des Servers — genau wie `fixtures.ts` es für
             `NOSTR_SPACE_URL` und `NOSTR_PROFILE_INDEXER` bereits tut. Ein reines
             `window.__nostrBoard` per `addInitScript` reicht hier NICHT. --}}
        @if (! config('group.board_relay_url'))
            {{-- Keine Quelle konfiguriert. Das ist kein Fehler, sondern eine bewusste
                 Konfiguration: dieses Package läuft in mehreren Hosts, und nicht jeder
                 hat ein Artikel-Relay. Deshalb ein erklärender Leerzustand statt einer
                 Fehlermeldung — und kein einziger REQ. --}}
            <div class="surface-card empty-state px-4 py-10 text-center">
                <flux:icon.document-text class="mx-auto size-8 text-zinc-400" />
                <flux:heading class="mt-2">{{ __('Keine Artikel-Quelle eingerichtet.') }}</flux:heading>
                <flux:text class="mt-1 text-sm text-muted">{{ __('Dieser Client kennt kein Relay, auf dem Artikel liegen.') }}</flux:text>
            </div>
        @else
            <div>
                {{-- Fehler: die Liste ist UNVOLLSTÄNDIG, nicht falsch — was schon im
                     Gerätespeicher liegt, steht weiter da. Gleicher Wortlaut-Bau wie
                     auf `/updates`. --}}
                <template x-if="error">
                    <flux:callout variant="danger" icon="exclamation-triangle" class="mb-3">
                        <flux:callout.text>{{ __('Die Artikel sind gerade nicht erreichbar.') }}</flux:callout.text>
                        <x-slot name="actions">
                            <flux:button size="sm" variant="ghost" icon="arrow-path" x-on:click="retry()">{{ __('Erneut laden') }}</flux:button>
                        </x-slot>
                    </flux:callout>
                </template>

                {{-- `:aria-busy` sagt Hilfstechnik, dass hier gerade befüllt wird. --}}
                <div :aria-busy="loading">

                    {{-- Lade-Ansage. Steht PERMANENT im DOM und mit server-seitig LEEREM
                         Inhalt: `aria-live` meldet Änderungen INNERHALB einer bestehenden
                         Region — ein Text, der schon beim Seitenaufbau dasteht und danach
                         nur versteckt wird, wird nie angesagt (dieselbe Begründung wie in
                         `⚡updates.blade.php`). --}}
                    <span class="sr-only" aria-live="polite"
                          x-text="loading ? @js(__('Artikel werden geladen…')) : ''"></span>

                    <div x-show="isEmpty()">

                        {{-- Laden: SERVER-gerendert per @for, NICHT x-if — ein
                             x-if-Template existiert vor dem Alpine-Boot nicht im DOM, die
                             Fläche bliebe bis dahin weiß. Drei Balken je Karte ergeben
                             dieselbe Höhe wie eine echte Zeile. --}}
                        <div x-show="loading" class="grid grid-cols-1 gap-3 sm:grid-cols-2">
                            @for ($i = 0; $i < 6; $i++)
                                <div class="surface-card overflow-hidden">
                                    <div class="skeleton aspect-[16/9] w-full"></div>
                                    <div class="space-y-2 p-4">
                                        <div class="skeleton h-4 w-3/4"></div>
                                        <div class="skeleton h-3 w-full"></div>
                                        <div class="skeleton h-3 w-1/3"></div>
                                    </div>
                                </div>
                            @endfor
                        </div>

                        {{-- Leer und fertig geladen: Aussage, Erwartung, Ausweg — kein
                             nackter Bildschirm (Nielsen #1/#3). --}}
                        <div x-show="!loading" x-cloak class="surface-card empty-state px-4 py-10 text-center">
                            <flux:icon.document-text class="mx-auto size-8 text-zinc-400" />
                            <flux:heading class="mt-2">{{ __('Noch keine Artikel.') }}</flux:heading>
                            <flux:text class="mt-1 text-sm text-muted">{{ __('Sobald jemand einen Artikel veröffentlicht, erscheint er hier.') }}</flux:text>
                            <div class="mt-4">
                                <flux:button size="sm" variant="ghost" icon="hashtag" :href="route('group.spaces')" wire:navigate>{{ __('Zu den Räumen') }}</flux:button>
                            </div>
                        </div>
                    </div>

                    {{-- Die Liste. Karten statt Zeilen: ein Artikel bringt ein Titelbild
                         mit (85 von 99 tragen ein `image`-Tag), und eine Kachel zeigt es,
                         ohne die Zeilenhöhe der übrigen Screens zu brechen. Zwei Spalten
                         ab `sm` — mehr wäre auf dem Telefon eine Briefmarkengalerie. --}}
                    <div x-show="!isEmpty()" x-cloak class="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <template x-for="row in items" :key="row.id">
                            {{-- GANZE Karte = ein Link (keine verschachtelten Links) —
                                 dieselbe Regel wie `room-tile`. Fehlt der `naddr` (Artikel
                                 ohne `d`-Tag), liefert `href()` einen leeren String; das
                                 `|| null` entfernt das Attribut, und ein <a> ohne href ist
                                 weder anklickbar noch fokussierbar. Ein toter Link, der
                                 aussieht wie ein lebender, wäre die schlechtere Antwort. --}}
                            <a :href="href(row) || null" wire:navigate
                               class="surface-card pressable group flex flex-col overflow-hidden transition-colors hover:bg-brand-500/5">

                                <template x-if="row.image">
                                    <div class="aspect-[16/9] w-full overflow-hidden bg-zinc-200/60 dark:bg-zinc-800/60">
                                        {{-- `$img(…, 'msg')` ist der bestehende Bild-Proxy
                                             (600 px, WebP). Rohe Fremd-URLs gehen nie
                                             direkt ins `src`. `loading="lazy"`: bis zu 99
                                             Karten. --}}
                                        <img :src="$img(row.image, 'msg')" alt="" loading="lazy"
                                             class="size-full object-cover" />
                                    </div>
                                </template>

                                <div class="flex min-w-0 flex-1 flex-col gap-2 p-4">
                                    <h2 class="line-clamp-2 text-base font-semibold text-zinc-900 dark:text-zinc-100" x-text="row.title || @js(__('Ohne Titel'))"></h2>

                                    {{-- Vorschau: `summary`-Tag, sonst Fließtext aus dem
                                         Artikel. IMMER `x-text` — der Teaser ist Fremdtext
                                         und wird nie als HTML gebunden. --}}
                                    <p class="line-clamp-3 text-sm leading-normal text-muted" x-text="row.teaser"></p>

                                    <div class="mt-auto flex items-center gap-2 pt-1">
                                        <x-group::nostr-avatar picture="row.authorPicture" name="row.authorName" size="1.5rem" />
                                        <span class="min-w-0 flex-1 truncate text-xs text-muted" x-text="row.authorName"></span>
                                        <span class="shrink-0 text-xs text-muted" x-text="row.dateLabel"></span>
                                    </div>
                                </div>
                            </a>
                        </template>
                    </div>
                </div>
            </div>
        @endif
    </div>

</x-group::app-shell>
