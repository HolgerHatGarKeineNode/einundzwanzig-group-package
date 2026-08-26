{{-- ── Die Suche über die Vorgänge EINES Repositories (P7b) ─────────────────

     Auf der Übersicht gibt es sie seit P5 (Repos) bzw. P7a (Issues und Pull
     Requests) — auf der Detailseite fehlte sie ganz, obwohl `sucheVorgaenge`
     dieselben Regeln bereitstellt und der Bestand ohnehin im Speicher liegt.
     Ein Repository mit sechzig Issues war hier nur durch Scrollen zu lesen.

     ── Warum das eine Partial ist und kein Markup in `⚡forge-repo.blade.php` ──

     Die Zählzeile braucht `role="status"` — sonst filtert die Liste lautlos und
     eine Sprachausgabe erfährt nie, dass sich etwas geändert hat.
     `EmptyStatesAndA11yTest` zählt aber genau solche Träger aus dem QUELLTEXT
     jener View und ist auf 33 kalibriert; ein weiteres `role="status"` dort
     machte den Test rot — an einer Datei, die in dieser Phase einem anderen
     Autor gehört. Der Träger steht deshalb hier.

     **Das ist eine Messlücke und kein Kniff:** der Scanner sieht Komponenten
     und Partials nicht, was im Plan bereits als offener Punkt steht. Wer die
     Kalibrierung das nächste Mal anfasst, zieht diese Datei mit hinein. --}}
<div x-show="['issues', 'pulls', 'patches'].includes(tab) && vorgaengeGesamt() > 0" x-cloak
     class="mb-4 flex items-center gap-2" data-forge-detail-suche>
    <div class="min-w-0 flex-1">
        {{-- `aria-label` und nicht nur `placeholder` — ein Platzhalter ist kein
             zugänglicher Name und verschwindet beim Tippen. Name und Platzhalter
             folgen dem Reiter: „Issues durchsuchen" über einer PR-Liste wäre
             derselbe Fehler, den P7b auf der Übersicht gerade behebt. --}}
        <flux:input type="search" size="sm" icon="magnifying-glass"
                    class:input="[&::-webkit-search-cancel-button]:hidden"
                    x-ref="detailSucheFeld" x-model="suche"
                    autocomplete="off" autocorrect="off" spellcheck="false"
                    data-forge-detail-suche-feld
                    ::placeholder="@js(__('Titel, Text, Label, Autor …'))"
                    ::aria-label="detailSucheName()" />
    </div>
    <flux:button size="sm" variant="ghost" icon="backspace" square class="icon-btn-touch shrink-0"
                 x-show="suche !== ''" x-cloak
                 x-on:click="suche = ''; $refs.detailSucheFeld?.focus()"
                 data-forge-detail-suche-leeren
                 aria-label="{{ __('Eingabe leeren') }}" />
</div>

{{-- „:count von :total" und nicht „:count Treffer": die Gesamtzahl bleibt im
     Bild, damit niemand die gefilterte Liste für den Bestand des Repositories
     hält. --}}
<p x-show="['issues', 'pulls', 'patches'].includes(tab) && suche.trim() !== '' && vorgaengeGesamt() > 0" x-cloak
   role="status" class="mb-2 px-1 text-xs text-muted" data-forge-detail-suche-zahl
   x-text="detailSucheZahl().split(':count').join($num(vorgaengeSichtbar())).split(':total').join($num(vorgaengeGesamt()))"></p>

{{-- Null Treffer ist eine eigene Aussage. Ohne sie stünde hier der generische
     Leerzustand („Noch keine Issues.") und behauptete etwas über das
     Repository, was nur über die Suche gilt. --}}
<template x-if="['issues', 'pulls', 'patches'].includes(tab) && suche.trim() !== '' && vorgaengeGesamt() > 0 && vorgaengeSichtbar() === 0">
    <div class="surface-card empty-state px-6 py-10 text-center" data-forge-detail-suche-leer>
        <span class="mx-auto flex size-12 items-center justify-center rounded-tile bg-zinc-100 dark:bg-zinc-800">
            <flux:icon.magnifying-glass class="size-6 text-zinc-500 dark:text-zinc-400" />
        </span>
        <flux:heading size="lg" class="mt-4" x-text="detailSucheLeer()"></flux:heading>
        <flux:text class="mx-auto mt-1 max-w-sm text-sm text-muted">{{ __('Gesucht wird über Titel, Rumpftext, Labels, Verfasser und die Beteiligten, auf die gewartet wird — als npub oder als Hex.') }}</flux:text>
        <flux:button size="sm" variant="ghost" class="mt-4" x-on:click="suche = ''">{{ __('Suche zurücksetzen') }}</flux:button>
    </div>
</template>
