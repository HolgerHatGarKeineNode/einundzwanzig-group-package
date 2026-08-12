<?php

use Livewire\Attributes\Layout;
use Livewire\Component;

/**
 * Artikel-Vollansicht (`/articles/{naddr}`, P7) als Livewire-Full-Page-SFC.
 *
 * `$naddr` kommt aus dem Routen-Parameter und wird via `@js($naddr)` an die Insel
 * gereicht — die einzige Server→Insel-Übergabe; Laden, Auflösen und Rendern laufen
 * client-seitig (`nostrArticle`).
 *
 * **Kein server-seitiger Titel aus dem Artikel.** Der Server kennt den Artikel nicht: er
 * liegt auf dem Board-Relay, und diese Seite hat bewusst keinen Read-Cache wie die
 * Raum-Ansicht (§10/M7). Der Seitentitel bleibt deshalb generisch; der echte Titel steht
 * als `<h1>` im Dokument, sobald der Artikel da ist.
 */
new #[Layout('group::einundzwanzig')] class extends Component
{
    public string $naddr = '';

    public function mount(string $naddr): void
    {
        $this->naddr = $naddr;
    }

    public function render()
    {
        return $this->view()->title(__('Artikel'));
    }
}; ?>

<x-group::app-shell>

    <div x-data="nostrArticle(@js($naddr))" class="page-enter">

    {{-- Der Kopf trägt den Artikeltitel, sobald er da ist — und damit die EINE `h1` des
         Dokuments (`app-header` rendert `flux:heading level="1"`). Genau dieselbe Bauart
         wie der Raum-Kopf, der den Raumnamen trägt; ein zweiter Titel im Rumpf wäre eine
         zweite `h1` mit demselben Text und für Hilfstechnik eine Dopplung.

         `json_encode` statt `Js::from` und statt `@js()`: `app-header` echot den Ausdruck
         über `{{ }}`, escaped ihn also selbst genau einmal — dieselbe Begründung wie in
         `⚡room.blade.php:92`. Vor dem Alpine-Boot steht der SSR-Titel `Artikel`. --}}
    @php($titleExpr = 'article ? (article.title || '.json_encode(__('Ohne Titel')).') : '.json_encode(__('Artikel')))

        <x-group::app-header :title="__('Artikel')" :title-expr="$titleExpr" :back="route('group.articles')" />

        @if (! config('group.board_relay_url'))
        {{-- Keine Quelle konfiguriert — und das ist etwas ANDERES als „diesen Artikel gibt
             es nicht". Ohne diese Weiche sagte die Vollansicht beides mit demselben Satz:
             ein Client ohne Artikel-Relay behauptete über jeden Link, der Relay kenne ihn
             nicht — obwohl nie einer gefragt wurde. Server-seitig wie auf der Liste, aus
             demselben Grund (das Gate steht im ausgelieferten HTML, bevor ein Script
             läuft). --}}
            <div class="surface-card empty-state px-4 py-10 text-center">
                <flux:icon.document-text class="mx-auto size-8 text-zinc-400" />
                <flux:heading class="mt-2">{{ __('Keine Artikel-Quelle eingerichtet.') }}</flux:heading>
                <flux:text class="mt-1 text-sm text-muted">{{ __('Dieser Client kennt kein Relay, auf dem Artikel liegen.') }}</flux:text>
            </div>
        @else

        {{-- Lade-Ansage: permanent im DOM, server-seitig leer — siehe die ausführliche
             Begründung in `⚡updates.blade.php`. --}}
        <span class="sr-only" aria-live="polite"
              x-text="loading ? @js(__('Artikel wird geladen…')) : ''"></span>

        {{-- Der Relay hat nicht geantwortet. Bewusst NICHT derselbe Zustand wie „gibt es
             nicht": dort steht eine Aussage über den Relay, und die ist nur gedeckt, wenn
             er wirklich geantwortet hat (`LoadOutcome.complete`, `longformFeed.ts`). Hier
             steht stattdessen der einzige ehrliche Satz — plus der Weg, es noch einmal zu
             versuchen. --}}
        <template x-if="error && !hasArticle()">
            <flux:callout variant="danger" icon="exclamation-triangle" class="mb-3">
                <flux:callout.text>{{ __('Der Artikel ist gerade nicht erreichbar.') }}</flux:callout.text>
                <x-slot name="actions">
                    <flux:button size="sm" variant="ghost" icon="arrow-path" x-on:click="retry()">{{ __('Erneut laden') }}</flux:button>
                </x-slot>
            </flux:callout>
        </template>

        {{-- Laden: server-gerendertes Skeleton (kein x-if — das existiert vor dem
             Alpine-Boot nicht im DOM). Die Balken haben die Maße des echten Kopfes,
             damit der Wechsel nicht springt. --}}
        <div x-show="loading && !hasArticle()" :aria-busy="loading" class="surface-card overflow-hidden">
            <div class="skeleton aspect-[21/9] w-full"></div>
            <div class="space-y-3 p-5">
                <div class="skeleton h-6 w-2/3"></div>
                <div class="skeleton h-3 w-1/3"></div>
                <div class="skeleton h-3 w-full"></div>
                <div class="skeleton h-3 w-full"></div>
                <div class="skeleton h-3 w-4/5"></div>
            </div>
        </div>

        {{-- „Gibt es nicht" ist ein eigener Zustand, kein Fehler: der `naddr` kann
             unlesbar sein (kaputter Link), auf ein anderes Kind zeigen oder auf einen
             Artikel, den dieser Relay nicht (mehr) hat. Alle drei enden hier, und alle
             drei haben denselben Ausweg.

             Die Unterzeile hieß „Der Link zeigt auf keinen Artikel, den dieses Relay
             kennt." — und das ist eine Aussage ÜBER den Relay. Für einen unlesbaren
             `naddr` wurde nie einer gefragt (`loadArticle` gibt dort `NOT_ASKED`
             zurück), die Aussage war also in einem der drei Fälle nicht gedeckt. Der
             neue Satz redet über den LINK und hält damit in allen dreien. Was der Relay
             gesagt oder nicht gesagt hat, entscheidet eine Ebene darüber: er kommt hier
             nur an, wenn `complete` war (sonst steht das Fehler-Callout oben). --}}
        <template x-if="missing && !hasArticle()">
            <div class="surface-card empty-state px-4 py-10 text-center">
                <flux:icon.document-text class="mx-auto size-8 text-zinc-400" />
                <flux:heading class="mt-2">{{ __('Diesen Artikel gibt es nicht.') }}</flux:heading>
                <flux:text class="mt-1 text-sm text-muted">{{ __('Dieser Link führt zu keinem Artikel.') }}</flux:text>
                <div class="mt-4">
                    <flux:button size="sm" variant="ghost" icon="arrow-left" :href="route('group.articles')" wire:navigate>{{ __('Alle Artikel') }}</flux:button>
                </div>
            </div>
        </template>

        <template x-if="hasArticle()">
            <article class="surface-card overflow-hidden">

                {{-- Titelbild. `banner`-Preset (1200×400) — dieselbe Rolle wie das
                     Space-Banner auf der Übersicht, deshalb dasselbe Preset. --}}
                <template x-if="article.image">
                    <div class="aspect-[21/9] w-full overflow-hidden bg-zinc-200/60 dark:bg-zinc-800/60">
                        <img :src="$img(article.image, 'banner')" alt="" class="size-full object-cover" />
                    </div>
                </template>

                <div class="p-5">
                    {{-- Kein Titel hier: er steht im Kopf und ist dort die `h1` (siehe
                         oben). Die Zeile darunter ist die Herkunft — wer, wann. --}}
                    <div class="flex items-center gap-2">
                        <x-group::nostr-avatar picture="article.authorPicture" name="article.authorName" size="2rem" />
                        <span class="min-w-0 flex-1 truncate text-sm text-muted" x-text="article.authorName"></span>
                        <span class="shrink-0 text-sm text-muted" x-text="article.dateLabel"></span>
                    </div>

                    {{-- Themen (`t`-Tags): 22 der 99 Artikel tragen welche. Reine Anzeige,
                         kein Filter — es gibt keine Themenliste, auf die ein Klick führen
                         könnte, und ein Link ins Leere ist schlechter als keiner. --}}
                    <template x-if="article.topics.length > 0">
                        <div class="mt-3 flex flex-wrap gap-1.5">
                            <template x-for="topic in article.topics.slice(0, 8)" :key="topic">
                                <span class="rounded-pill bg-black/5 px-2 py-0.5 text-[0.7rem] text-muted dark:bg-white/10" x-text="'#' + topic"></span>
                            </template>
                        </div>
                    </template>

                    {{-- Der Artikel selbst.

                         `x-html` ist hier bewusst gesetzt und die einzige Stelle, an der
                         diese Fläche HTML bindet. Der Wert kommt AUSSCHLIESSLICH aus
                         `renderArticleHtml` (`js/longform.ts`), also aus markdown-it mit
                         `html: false` — roher HTML-Text des Autors ist dort bereits zu
                         Entities geworden, und `javascript:`/`vbscript:`/`data:`-Links
                         sind gar nicht erst zu Ankern geworden. Wer hier eine andere
                         Quelle anbindet, hebelt genau diese Zusage aus. --}}
                    <div class="article-content mt-6" x-html="article.html"></div>
                </div>
            </article>
        </template>
        @endif
    </div>

</x-group::app-shell>
