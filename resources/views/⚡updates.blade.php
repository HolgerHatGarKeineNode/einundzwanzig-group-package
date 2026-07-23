<?php

use Livewire\Attributes\Layout;
use Livewire\Component;

/**
 * Benachrichtigungs-View „Neu" (`/updates`, P4) als Livewire-Full-Page-SFC.
 * Die Klasse ist ein dünner Shell — Liste, Filter und Lesestand leben komplett in
 * der Alpine-Insel `nostrUpdates` (welshman/IndexedDB, client-seitig). Kein `mount()`:
 * es gibt nichts server-seitig Vorzubereitendes (kein OG-Bild — die Seite liegt hinter
 * `nostr.auth` und wird nie geteilt/gecrawlt).
 */
new #[Layout('group::einundzwanzig')] class extends Component
{
    public function render()
    {
        return $this->view()->title(__('Neu'));
    }
}; ?>

<x-group::app-shell>

    {{-- EIN Wurzel-Element unter der Shell; der ganze Screen-Zustand hängt an
         `nostrUpdates` (Screen-Komponente) — geteilter Zustand über Screens liegt
         dagegen im Store `unread` (Namenskonvention wie authGate vs. nostrSpaces). --}}
    <div x-data="nostrUpdates" class="page-enter">

        {{-- Kopf: UP-Ziel ist die Übersicht (explizites Ziel, nie history.back() —
             der Deep-Link-Kaltstart hat keinen Stack). Subtitle + „Alles" erscheinen
             erst, wenn es überhaupt etwas gibt. --}}
        <x-group::app-header :title="__('Neu')" :back="route('group.spaces')">
            <x-slot:subtitle>
                <span class="text-xs text-muted" x-show="hasAny()" x-cloak x-text="subtitleText()"></span>
            </x-slot:subtitle>
            <x-slot:actions>
                {{-- `aria-label` ERSETZT den Kindtext („Alles") — der Screenreader hört
                     die vollständige Handlung, das Auge liest die kurze Form.
                     `hasUnread()`, NICHT `hasAny()`: gelesene Zeilen bleiben 24 h stehen,
                     die Liste ist nach dem Quittieren also nicht leer. Ein Knopf, der
                     dann weiter dasteht, verspricht eine Handlung, die nichts tut — und
                     widerspricht dem Untertitel, der daneben „Alles gelesen" sagt. --}}
                {{-- Fokus-Übergabe: der Knopf blendet sich mit dem eigenen Klick aus
                     (`hasUnread()` wird falsch) — ohne Übergabe fällt der Fokus auf
                     <body>, der Ring verschwindet und ein Screenreader verliert die
                     Position ausgerechnet in dem Moment, in dem die 10-Sekunden-Frist
                     anläuft. Ziel ist deshalb der Undo-Knopf: die Fortsetzung derselben
                     Handlung. `$nextTick`, weil `focus()` auf einem noch per `x-show`
                     versteckten Element wirkungslos wäre. Bewusst `function () {}`
                     statt einer Pfeilfunktion — ein rohes `>` in der Attributliste
                     eines `<flux:…>`-Tags ist in diesem Repo schon einmal verschluckt
                     worden. --}}
                <flux:button size="xs" variant="ghost" icon="check" class="icon-btn-touch"
                             x-show="hasUnread()" x-cloak x-ref="markAllBtn"
                             x-on:click="markAllRead(); $nextTick(function () { $refs.undoBtn?.focus() })"
                             aria-label="{{ __('Alles als gelesen markieren') }}">{{ __('Alles') }}</flux:button>
            </x-slot:actions>
        </x-group::app-header>

        {{-- Undo (Nielsen #3, Nutzerkontrolle): „Alles gelesen" ist sonst irreversibel.
             Die 10-Sekunden-Frist lebt in der Insel (`canUndo()`), NICHT in einem
             Blade-setTimeout — sonst gäbe es zwei Wahrheiten über dieselbe Frist.
             Bewusst eine INLINE-Leiste statt eines Toasts: sie steht im Dokumentfluss
             direkt hinter der auslösenden Kopf-Aktion, ist damit der nächste Tab-Stopp
             und kann weder überlagert noch verpasst werden. `role="status"` meldet sie
             an, ohne den Fokus zu stehlen. --}}
        <div x-show="canUndo()" x-cloak role="status"
             class="chip-in mb-3 flex items-center gap-3 rounded-tile bg-zinc-100 px-3 py-2 dark:bg-zinc-800">
            <flux:icon.check-circle variant="micro" class="size-4 shrink-0 text-muted" />
            <span class="min-w-0 flex-1 text-sm text-zinc-900 dark:text-zinc-100">{{ __('Alles als gelesen markiert.') }}</span>
            {{-- Gegenstück zur Übergabe oben: der Undo-Knopf blendet sich selbst aus,
                 der Fokus geht zurück auf den „Alles"-Knopf, von dem er kam. Ist der
                 nicht (mehr) sichtbar, fängt der Listen-Container (`tabindex="-1"`). --}}
            <flux:button size="xs" variant="ghost" icon="arrow-uturn-left" class="icon-btn-touch shrink-0" x-ref="undoBtn"
                         x-on:click="undoMarkAll(); $nextTick(function () { ($refs.markAllBtn?.offsetParent ? $refs.markAllBtn : $refs.list).focus() })">{{ __('Rückgängig') }}</flux:button>
        </div>

        {{-- Filter. `flux:tabs` OHNE `flux:tab.group`: ohne Panels wirft Flux beim
             Auflösen des Panels („Could not find panel…"), sobald eine Tab-Gruppe da
             ist — hier filtert der Tab nur eine Alpine-Liste, es gibt keine Panels.
             Kein `@if`/`@js()` in der Attributliste eines flux-Tags (P5-Fund: `@js()`
             wird dort nicht ausgeführt und landet wörtlich im Alpine-Ausdruck). --}}
        <flux:tabs variant="segmented" x-model="feed" class="mb-3">
            <flux:tab name="all">{{ __('Alle') }}</flux:tab>
            <flux:tab name="mentions">{{ __('Erwähnungen') }}</flux:tab>
            <flux:tab name="threads">{{ __('Threads') }}</flux:tab>
        </flux:tabs>

        {{-- Zustand 4 — Fehler. Wortlaut sagt bewusst, dass die Liste UNVOLLSTÄNDIG,
             nicht falsch ist (Nielsen #1, Systemstatus): der Gerätespeicher trägt
             weiter, auch wenn der Space gerade schweigt. --}}
        <template x-if="error">
            <flux:callout variant="danger" icon="exclamation-triangle" class="mb-3">
                <flux:callout.text>
                    {{ __('Der Space ist gerade nicht erreichbar. Ältere Hinweise stammen aus dem Gerätespeicher.') }}
                </flux:callout.text>
                <x-slot name="actions">
                    <flux:button size="sm" variant="ghost" icon="arrow-path" x-on:click="retry()">{{ __('Erneut laden') }}</flux:button>
                </x-slot>
            </flux:callout>
        </template>

        {{-- `tabindex="-1"` + `x-ref="list"`: der Auffang für die Fokus-Übergaben oben —
             ein Bedienelement, das sich selbst ausblendet, braucht ein Ziel, sonst landet
             der Fokus auf <body>. Nicht tabbierbar (-1), nur programmatisch anspringbar.
             `:aria-busy` sagt Hilfstechnik, dass der Bereich gerade befüllt wird. --}}
        <div x-ref="list" tabindex="-1" :aria-busy="loading" class="surface-card overflow-hidden">

            {{-- Lade-Ansage. Steht PERMANENT im DOM und AUSSERHALB des `x-show="loading"`-
                 Blocks, mit server-seitig LEEREM Inhalt: `aria-live` meldet Änderungen
                 INNERHALB einer bestehenden Region — ein Text, der schon beim Seitenaufbau
                 dasteht und danach nur noch versteckt wird, wird nie angesagt. So erlebt die
                 Region beim Boot eine echte Änderung („" → Text) und beim Fertigwerden die
                 Gegenbewegung. `sr-only` ist `clip`, nicht `display:none` — die Region bleibt
                 für Hilfstechnik lebendig.
                 (Abgeleitet aus der ARIA-Semantik, nicht mit einem Screenreader gegengeprüft.) --}}
            <span class="sr-only" aria-live="polite"
                  x-text="loading ? @js(__('Benachrichtigungen werden geladen…')) : ''"></span>

            {{-- Nichts (noch) zu zeigen → Laden ODER einer der beiden Leerzustände.
                 KEIN x-cloak auf diesem Wrapper: das server-gerenderte Skeleton darunter
                 muss ab dem ERSTEN Paint stehen (sonst blitzt die Fläche weiß, bis Alpine
                 bootet). Verschachtelte x-show statt `&&`-Ausdrücken. --}}
            <div x-show="isEmpty()">

                {{-- Zustand 3 — Laden. SERVER-gerendert per @for, NICHT x-if: ein
                     x-if-Template existiert vor dem Alpine-Boot gar nicht im DOM.
                     Drei Textbalken je Zeile → dieselbe Zeilenhöhe wie eine echte
                     Zeile, der Wechsel Skeleton→Liste springt nicht. --}}
                <div x-show="loading" class="divide-y divide-zinc-200/60 dark:divide-zinc-800/60">
                    @for ($i = 0; $i < 5; $i++)
                        <div class="flex items-start gap-3 px-4 py-3">
                            <div class="skeleton size-10 shrink-0 rounded-tile"></div>
                            <div class="min-w-0 flex-1 space-y-2 py-0.5">
                                <div class="skeleton h-3 w-24"></div>
                                <div class="skeleton h-3 w-2/3"></div>
                                <div class="skeleton h-3 w-1/3"></div>
                            </div>
                        </div>
                    @endfor
                </div>

                <div x-show="!loading" x-cloak>

                    {{-- Zustand 2 — leer NACH Filter. Der Ausweg steht im Zustand
                         (Nielsen #3): ein Klick zurück auf „Alle". Der Wortlaut hängt
                         am Filter selbst — `feed` ist Vertrag, ein Textbaustein aus der
                         Insel wäre eine zweite Wahrheit über dieselbe Auswahl. --}}
                    <div x-show="isFiltered()" class="empty-state px-4 py-10 text-center">
                        <flux:icon.funnel class="mx-auto size-8 text-zinc-400" />
                        <div class="mt-2">
                            <p class="text-sm text-muted" x-show="feed === 'mentions'">{{ __('Keine Erwähnungen in den letzten 30 Tagen.') }}</p>
                            <p class="text-sm text-muted" x-show="feed === 'threads'">{{ __('Keine neuen Thread-Antworten in den letzten 30 Tagen.') }}</p>
                        </div>
                        <div class="mt-4">
                            {{-- Auch dieser Knopf löscht sich selbst weg (der Leerzustand
                                 verschwindet mit dem Filter). Fokus in die Liste, die jetzt
                                 da steht — dorthin, wo das Ergebnis der Handlung liegt. --}}
                            <flux:button size="sm" variant="ghost" icon="arrow-path"
                                         x-on:click="resetFeed(); $nextTick(function () { $refs.list.focus() })">{{ __('Alle anzeigen') }}</flux:button>
                        </div>
                    </div>

                    {{-- Zustand 1 — leer, weil nichts Neues da ist. Kein leerer Screen:
                         Aussage („alles gelesen"), Erwartung („erscheint hier") und ein
                         Weg heraus. --}}
                    <div x-show="!isFiltered()" class="empty-state px-4 py-10 text-center">
                        <flux:icon.check-circle class="mx-auto size-8 text-zinc-400" />
                        <flux:heading class="mt-2">{{ __('Alles gelesen.') }}</flux:heading>
                        <flux:text class="mt-1 text-sm text-muted">{{ __('Neue Nachrichten aus deinen Räumen erscheinen hier.') }}</flux:text>
                        <div class="mt-4">
                            <flux:button size="sm" variant="ghost" icon="hashtag" :href="route('group.spaces')" wire:navigate>{{ __('Zu den Räumen') }}</flux:button>
                        </div>
                    </div>
                </div>
            </div>

            {{-- Die Liste. `groups()` liefert bereits gefüllte Buckets (HEUTE · GESTERN ·
                 DIESE WOCHE · ÄLTER), leere sind raus — dieselbe Divider-Sprache wie der
                 Chat-Verlauf, keine neue Metapher. Der Bucket-Titel ist ein echtes <h2>
                 (Screenreader springen von Gruppe zu Gruppe), kein dekorativer Balken. --}}
            <div x-show="!isEmpty()" x-cloak>
                <template x-for="group in groups()" :key="group.label">
                    <section>
                        <h2 class="px-4 pb-1 pt-4 text-[0.7rem] font-semibold uppercase tracking-wider text-muted" x-text="group.label"></h2>
                        <div class="divide-y divide-zinc-200/60 dark:divide-zinc-800/60">
                            <template x-for="item in group.items" :key="item.key">
                                {{-- GANZE Zeile = ein Button (keine verschachtelten Links) —
                                     dieselbe Regel wie room-tile. `labelFor(item)` ersetzt als
                                     aria-label den kompletten Kindtext, deshalb tragen Rail und
                                     Icons konsequent `aria-hidden`/keine eigene sr-only-Spur.
                                     „verwaist" (Raum gelöscht, Thread-Root nicht auflösbar):
                                     Zeile bleibt STEHEN, wird aber inaktiv — Muster der
                                     Thread-Liste in ⚡spaces. --}}
                                <button type="button" x-on:click="open(item)"
                                        :aria-label="labelFor(item)" :disabled="item.orphan"
                                        class="pressable relative flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-brand-500/5 disabled:cursor-default disabled:opacity-60">

                                    {{-- Die Signatur: 2-px-Herkunfts-Rail. Dasselbe grafische
                                         Motiv trägt im Verlauf die Ungelesen-Grenze und im
                                         Thread den zitierten Root — ein Motiv, eine Bedeutung:
                                         „hier hörst du auf zu wissen, was passiert ist".
                                         Farbe nach Rollenregel: brand-700 (light) / brand-400
                                         (dark) sind die Linien- und Punktfarben; brand-500 ist
                                         Fläche, brand-600 nie auf brand-getöntem Grund. --}}
                                    <span x-show="item.unread" aria-hidden="true"
                                          class="absolute inset-y-2 start-0 w-0.5 rounded-pill bg-brand-700 dark:bg-brand-400"></span>

                                    <span class="relative shrink-0">
                                        <x-group::nostr-avatar picture="item.picture" name="item.authorName" size="2.5rem" />
                                    </span>

                                    <span class="min-w-0 flex-1">
                                        {{-- ① Kontext (11px uppercase): WO ist das passiert.
                                             Unbekannter Typ → kein Icon (fail-closed), der
                                             Kontexttext trägt trotzdem. --}}
                                        <span class="mb-1 flex items-center gap-1 text-[0.7rem] font-semibold uppercase tracking-wider text-muted">
                                            <flux:icon.hashtag x-show="item.type === 'message'" class="size-3 shrink-0" />
                                            <flux:icon.at-symbol x-show="item.type === 'mention'" class="size-3 shrink-0" />
                                            <flux:icon.chat-bubble-left-right x-show="item.type === 'thread'" class="size-3 shrink-0" />
                                            <span class="truncate" x-text="item.context"></span>
                                        </span>
                                        {{-- ② Titel: der einzige Ort, an dem „ungelesen" neben
                                             der Rail mitträgt — über GEWICHT, nicht über Größe
                                             oder Farbe. Gelesen bleibt font-semibold (wie die
                                             Thread-Zeile seit P3), ungelesen geht auf font-bold:
                                             bestehende Zeilen werden nicht schwächer, nur die
                                             neuen stärker. Rohes <span> → einfaches `:class`. --}}
                                        <span class="block truncate text-sm text-zinc-900 dark:text-zinc-100"
                                              :class="item.unread ? 'font-bold' : 'font-semibold'"
                                              x-text="item.title"></span>
                                        {{-- ③ Snippet: 2 Zeilen Fließtext-Zeilenhöhe — die
                                             Entscheidungshilfe „lohnt sich das?".
                                             KEIN `block` daneben: `line-clamp-2` bringt sein
                                             eigenes `display: -webkit-box` mit, und `-webkit-
                                             line-clamp` wirkt AUSSCHLIESSLICH auf diesen
                                             display-Wert. Beide Utilities haben dieselbe
                                             Spezifität, `.block` steht im gebauten Bundle
                                             SPÄTER und gewann — die Kappung fiel still aus und
                                             eine normale Chat-Nachricht zog die Zeile (samt
                                             Rail) auf mehrere hundert Pixel. Gemessen, nicht
                                             gerechnet. --}}
                                        <span class="mt-1 text-sm leading-normal text-muted line-clamp-2" x-text="item.snippet"></span>
                                        {{-- ④ Meta --}}
                                        <span class="mt-2 block text-xs text-muted" x-text="item.timeLabel"></span>
                                    </span>

                                    <flux:icon.chevron-right class="mt-1 size-4 shrink-0 text-muted" />
                                </button>
                            </template>
                        </div>
                    </section>
                </template>
            </div>
        </div>

        {{-- Paginierung: KEIN Infinite-Scroll. Die Datenmenge ist durch das
             Cache-Fenster hart begrenzt (300 Ereignisse/Raum, 30 Tage) — endloses
             Nachladen verspräche ein Ende, das kommt, aber nicht datengetrieben ist.
             Die Hinweiszeile steht dauerhaft am Listenende, auch ohne weitere Seiten:
             sie erklärt, WARUM die Liste aufhört. --}}
        <div x-show="!isEmpty()" x-cloak class="mt-4 text-center">
            {{-- Gleiche Bauart wie oben: beim LETZTEN Klick verschwindet der Knopf unter
                 dem Fokus (`hasMore()` wird falsch). Bleibt er stehen, behält er ihn —
                 sonst fängt die Liste. `offsetParent` ist bei `display:none` null. --}}
            <flux:button x-show="hasMore()" x-cloak size="sm" variant="ghost" icon="arrow-down" x-ref="olderBtn"
                         x-on:click="older(); $nextTick(function () { ($refs.olderBtn?.offsetParent ? $refs.olderBtn : $refs.list).focus() })">{{ __('Ältere anzeigen') }}</flux:button>
            <p class="mt-2 text-xs text-muted">{{ __('Älter als 30 Tage liegt nicht im Speicher.') }}</p>
        </div>
    </div>

</x-group::app-shell>
