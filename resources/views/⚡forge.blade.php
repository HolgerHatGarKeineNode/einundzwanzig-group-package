<?php

use Livewire\Attributes\Layout;
use Livewire\Component;

/**
 * Forge-Übersicht („Forge", `/forge`, P6) als Livewire-Full-Page-SFC.
 *
 * Dünner Shell: Laden, Falten und Rendern leben komplett in der Alpine-Insel
 * `nostrForge` (welshman, client-seitig). Kein `mount()` — server-seitig ist
 * nichts vorzubereiten, die Daten liegen auf dem Workspace-Relay hinter NIP-42.
 *
 * **Ob es die Fläche gibt, entscheidet der SERVER** (`config('group.workspace_url')`),
 * nicht die Insel: das Gate steht im ausgelieferten HTML, bevor ein Script läuft.
 * Wie sie sich verhält — Buzz oder nicht, erreichbar oder nicht — entscheidet die
 * Insel dreiwertig über `deriveSpaceKind` (`js/spaceCaps.ts`). Genau diese
 * Trennung verhindert die Mount-Falle: kein NIP-11 im kritischen Pfad.
 */
new #[Layout('group::einundzwanzig')] class extends Component
{
    public function render()
    {
        return $this->view()->title(__('Forge'));
    }
}; ?>

<x-group::app-shell>

    {{-- Der Basis-Pfad kommt aus `route()`, nicht als Literal: die Route heißt an
         genau einer Stelle `/forge`, und das ist `routes/group.php`. --}}
    <div x-data="nostrForge(@js(route('group.forge')))" class="page-enter">

        <x-group::app-header :title="__('Forge')" :back="route('group.spaces')" />

        @if (! config('group.workspace_url'))
            {{-- Kein Workspace konfiguriert. Kein Fehler, sondern eine bewusste
                 Konfiguration: dieses Package läuft in mehreren Hosts, und nicht
                 jeder hat ein Buzz-Relay daneben. Erklärender Leerzustand statt
                 Fehlermeldung — und kein einziger REQ. --}}
            {{-- Leerzustände tragen das Icon in einer getönten Kachel statt frei
                 schwebend: eine 8er-Glyphe in zinc-400 auf weißer Fläche misst 2,52:1
                 und verschwindet — die Kachel gibt ihr eine Kante und hebt die Glyphe
                 selbst auf zinc-500 (4,74:1 hell, 7,11:1 dunkel). Der Fließtext bekommt
                 `max-w-sm`, damit die Zeile auch auf 1280px im Lesemaß bleibt und nicht
                 quer über die halbe Karte läuft. Die Reihenfolge der KINDER bleibt
                 Icon → Überschrift → Text → Aktion: daran hängt die gestaffelte
                 Einblendung aus `theme.css` (`.empty-state > :nth-child(n)`). --}}
            <div class="surface-card empty-state px-6 py-12 text-center">
                <span class="mx-auto flex size-12 items-center justify-center rounded-tile bg-zinc-100 dark:bg-zinc-800">
                    <flux:icon.code-bracket-square class="size-6 text-zinc-500 dark:text-zinc-400" />
                </span>
                <flux:heading class="mt-4">{{ __('Keine Forge-Quelle eingerichtet.') }}</flux:heading>
                <flux:text class="mx-auto mt-1.5 max-w-sm text-sm text-muted">{{ __('Dieser Client kennt kein Relay, auf dem Repositories liegen.') }}</flux:text>
            </div>
        @else
            <div>
                {{-- Fehler: die Liste ist UNVOLLSTÄNDIG, nicht falsch — was schon im
                     Speicher liegt, steht weiter da. Gleicher Wortlaut-Bau wie auf
                     `/articles` und `/updates`. --}}
                <template x-if="error">
                    <flux:callout variant="danger" icon="exclamation-triangle" class="mb-3">
                        <flux:callout.text x-text="error"></flux:callout.text>
                        <x-slot name="actions">
                            <flux:button size="sm" variant="ghost" icon="arrow-path" x-on:click="retry()">{{ __('Erneut laden') }}</flux:button>
                        </x-slot>
                    </flux:callout>
                </template>

                {{-- Der Workspace hat sich nicht als Buzz zu erkennen gegeben. Das ist
                     KEIN Fehler und blockiert nichts: NIP-34 ist ein offener Standard.
                     Es hat aber eine Folge, die man kennen muss — ohne NIP-11-`self`
                     lässt sich der relay-signierte Branch-Zustand (30618) nicht
                     zuordnen. Deshalb ein Hinweis statt einer stillen Lücke.
                     `kind === 'unknown'` sagt hier bewusst NICHTS: da ist das Dokument
                     noch unterwegs. --}}
                <template x-if="kind === 'other'">
                    <flux:callout variant="warning" icon="information-circle" class="mb-3">
                        <flux:callout.text>{{ __('Der Workspace hat sich nicht als Buzz-Relay gemeldet. Repositories und Issues werden trotzdem gelesen; der Branch-Zustand kann fehlen.') }}</flux:callout.text>
                    </flux:callout>
                </template>

                <div :aria-busy="loading">

                    {{-- Lade-Ansage. Steht PERMANENT im DOM und server-seitig LEER:
                         `aria-live` meldet Änderungen INNERHALB einer bestehenden
                         Region — ein Text, der schon beim Seitenaufbau dasteht und
                         danach nur versteckt wird, wird nie angesagt. --}}
                    <span class="sr-only" aria-live="polite"
                          x-text="loading ? @js(__('Die Forge wird geladen…')) : ''"></span>

                    {{-- ── Kennzahlen ──────────────────────────────────────────────
                         Vier Kacheln statt vier Leermeldungen. Eine `0` in einer
                         Kachel ist eine AUSSAGE („es gibt keine Issues"); eine leere
                         Fläche ist ein Loch, das der Leser als Ladefehler deutet.
                         Deshalb erscheint die Zahl erst, wenn der Relay geantwortet
                         hat — bis dahin steht ein Balken. Eine `0` während des Ladens
                         wäre dieselbe Lüge, nur andersherum. --}}
                    {{-- EINE Karte mit vier Zellen, nicht vier Karten: die vier Zahlen
                         sind vier Messwerte an DEMSELBEN Gegenstand (dieser Workspace),
                         und vier gleich schwere Kacheln nebeneinander sagen genau das
                         nicht. Getrennt wird mit Haarlinien statt mit Abstand.

                         Die Trennlinien kommen aus dem Index, nicht aus `divide-*`:
                         `divide-y` zieht seine Kante über `> * + *` und kennt die
                         Spaltenzahl nicht — im 2-Spalten-Raster bekäme die Zelle oben
                         RECHTS eine Oberkante, obwohl sie in der ersten Zeile steht.
                         Die Farbe steht unbedingt an jeder Zelle, geschaltet wird nur
                         die BREITE; eine Kante mit Breite 0 ist unsichtbar, und so
                         braucht keine der Bedingungen einen zweiten Dark-Zweig. --}}
                    <div class="surface-card mb-4 grid grid-cols-2 overflow-hidden sm:grid-cols-4">
                        @php($tiles = [
                            ['key' => 'projects', 'label' => __('Projekte'), 'icon' => 'rectangle-stack'],
                            ['key' => 'repos', 'label' => __('Repositories'), 'icon' => 'code-bracket'],
                            ['key' => 'pullRequests', 'label' => __('Pull Requests'), 'icon' => 'arrows-right-left'],
                            ['key' => 'issues', 'label' => __('Issues'), 'icon' => 'exclamation-circle'],
                        ])
                        @foreach ($tiles as $i => $tile)
                            <div @class([
                                'border-zinc-200 px-4 py-3 dark:border-zinc-800',
                                // 2. und 4. Zelle: linke Kante in BEIDEN Rastern.
                                'border-s' => $i % 2 === 1,
                                // 3. Zelle: linke Kante erst, wenn sie in dieselbe Zeile rutscht.
                                'sm:border-s' => $i === 2,
                                // Untere Reihe des 2-Spalten-Rasters — im 4er-Raster gibt es sie nicht.
                                'border-t sm:border-t-0' => $i >= 2,
                            ])>
                                <div class="flex items-start justify-between gap-2">
                                    <span class="text-[0.7rem] font-semibold uppercase tracking-wider text-muted">{{ $tile['label'] }}</span>
                                    {{-- `<flux:icon :name="…">` und NICHT `<flux:icon.{{ … }}>`: der
                                         Tag-Name einer Blade-Komponente wird beim KOMPILIEREN
                                         aufgelöst, ein Echo darin landet wörtlich im Namen. Das
                                         Ergebnis war ein 500er („Flux component [icon.1] does not
                                         exist") — und zwar erst beim Rendern, `view:cache` hatte
                                         die Datei anstandslos übersetzt. Dieselbe Form wie
                                         `nav-tab.blade.php:85`.

                                         zinc-500 statt zinc-400 im Hellen: zinc-400 auf Weiß misst
                                         2,52:1 und liegt damit unter den 3:1 aus WCAG 1.4.11,
                                         zinc-500 hält 4,74:1 (gerechnet mit `p2-kontrast.mjs`).
                                         Im Dunklen bleibt zinc-400 — dort sind es 7,11:1. --}}
                                    <flux:icon :name="$tile['icon']" variant="micro" class="size-4 shrink-0 text-zinc-500 dark:text-zinc-400" />
                                </div>
                                {{-- Die Zahl ist die Aussage der Kachel und trägt deshalb das
                                     volle Gewicht — auch und gerade als `0`. `tabular-nums`
                                     hält die vier Zellen bei wechselnden Ziffern in Reihe. --}}
                                <div class="mt-2 h-9">
                                    <div x-show="!settled()" class="skeleton mt-1.5 h-6 w-10"></div>
                                    <span x-show="settled()" x-cloak data-forge-tile="{{ $tile['key'] }}"
                                          class="block text-4xl font-bold leading-none tabular-nums tracking-tight text-zinc-900 dark:text-zinc-100"
                                          x-text="$num(counts().{{ $tile['key'] }})"></span>
                                </div>
                            </div>
                        @endforeach
                    </div>

                    {{-- `flux:tabs` OHNE `flux:tab.group`: ohne Panels wirft Flux beim
                         Auflösen des Panels, sobald eine Tab-Gruppe da ist — hier
                         schaltet der Tab nur eine Alpine-Liste um. Gleiche Bauart wie
                         auf `/updates`. --}}
                    <flux:tabs variant="segmented" x-model="tab" class="mb-3">
                        <flux:tab name="activity">{{ __('Aktivität') }}</flux:tab>
                        <flux:tab name="projects">{{ __('Projekte') }}</flux:tab>
                        <flux:tab name="repos">{{ __('Repositories') }}</flux:tab>
                    </flux:tabs>

                    {{-- Kürzungshinweis. Er steht nur da, wenn eine Liste GENAU am
                         Limit ankam — dann kann sie gekürzt sein, und das ist eine
                         Aussage über den Bestand, die die Fläche schuldet. --}}
                    <template x-if="truncatedText()">
                        <flux:callout variant="secondary" icon="information-circle" class="mb-3" data-forge-truncated>
                            <flux:callout.text x-text="truncatedText()"></flux:callout.text>
                        </flux:callout>
                    </template>

                    {{-- Ladezustand: SERVER-gerendert per @for, NICHT x-if — der Inhalt
                         eines `x-if`-Templates existiert vor dem Alpine-Boot gar nicht
                         im DOM, die Fläche bliebe bis dahin weiß. --}}
                    <div x-show="loading && isEmpty()" class="surface-card px-4">
                        @for ($i = 0; $i < 4; $i++)
                            {{-- Formgleich zur fertigen Ref-Spur: gleicher Avatar-Ort,
                                 gleiche Zeilenhöhe. Ein Skelett, das anders gebaut ist
                                 als das Ergebnis, lässt die Liste beim Eintreffen der
                                 Daten springen. --}}
                            <div class="flex gap-3 py-3">
                                <div class="skeleton size-7 shrink-0 rounded-full"></div>
                                <div class="min-w-0 flex-1 space-y-2">
                                    <div class="skeleton h-3.5 w-2/3"></div>
                                    <div class="skeleton h-3 w-1/3"></div>
                                </div>
                            </div>
                        @endfor
                    </div>

                    {{-- ── Aktivität ───────────────────────────────────────────────
                         Jede Zeile ist ein SATZ: wer, was, woran — und rechts das
                         Ergebnis (Commit-Kurzhash oder Statuswort). Das folgt Buzz'
                         eigener Leitlinie „Verb, Objekt, Ergebnis" und ist der Grund,
                         warum hier kein Kind und keine Event-Id steht. --}}
                    <div x-show="tab === 'activity' && !(loading && isEmpty())" x-cloak>
                        <template x-if="overview.activity.length === 0">
                            <div class="surface-card empty-state px-6 py-12 text-center" data-forge-empty="activity">
                                <span class="mx-auto flex size-12 items-center justify-center rounded-tile bg-zinc-100 dark:bg-zinc-800">
                                    <flux:icon.clock class="size-6 text-zinc-500 dark:text-zinc-400" />
                                </span>
                                <flux:heading class="mt-4">{{ __('Noch keine Aktivität.') }}</flux:heading>
                                <flux:text class="mx-auto mt-1.5 max-w-sm text-sm text-muted">{{ __('Sobald jemand ein Repository anlegt, etwas pusht oder ein Issue eröffnet, erscheint es hier.') }}</flux:text>
                            </div>
                        </template>

                        {{-- ── Die Ref-Spur ───────────────────────────────────────
                             EINE Karte mit einem durchgehenden Faden statt zehn
                             gestapelter Kärtchen. Zehn gleich große Kästen sind der
                             Grund, warum die Fläche vorher wie ein Datenabzug aussah:
                             sie behaupten zehn gleichrangige Dinge, wo eine Historie
                             gemeint ist. Der Faden bindet die Zeilen zusammen und macht
                             den Avatar-Rhythmus zur linken Spalte.

                             GEOMETRIE, und warum sie ohne `:first-child` auskommt:
                             Alpine hängt die Zeilen eines `x-for` HINTER das
                             `<template>`; das Template bleibt als erstes Kind im DOM.
                             `li:first-child` trifft damit nie eine echte Zeile — und
                             `divide-y` gäbe der ersten sichtbaren Zeile eine Oberkante.
                             Deshalb zeichnet jede Zeile nur das Stück UNTER ihrem
                             Knoten: vom Knotenmittelpunkt (0,75rem Innenabstand +
                             0,875rem halbe Avatarhöhe = 1,625rem) über die volle
                             Zeilenhöhe. Weil jede Zeile denselben Innenabstand hat,
                             endet das Stück exakt im Mittelpunkt des nächsten Knotens.
                             Die letzte Zeile zeichnet nichts — `:last-child` trifft mit
                             `x-for` zuverlässig, im Gegensatz zu `:first-child`. --}}
                        <div x-show="overview.activity.length > 0" class="surface-card px-4">
                            <ol>
                                <template x-for="row in overview.activity" :key="row.id">
                                    <li class="group relative flex gap-3 py-3"
                                        data-forge-activity :data-type="row.type">
                                        <span aria-hidden="true"
                                              class="absolute start-[0.875rem] top-[1.625rem] h-full w-px bg-zinc-200 group-last:hidden dark:bg-zinc-800"></span>
                                        {{-- Deckende Unterlage: der Avatar selbst ist mit
                                             `bg-brand-500/10` halbtransparent, der Faden
                                             liefe sonst sichtbar durch ihn hindurch. Der
                                             Ring markiert die Ereignisse, die ein echtes
                                             Git-Objekt erzeugt haben (Push, PR-Update) —
                                             dieselbe Aussage trägt der Kurzhash als TEXT
                                             in der Metazeile, die Farbe ist also nie der
                                             alleinige Träger (WCAG 1.4.1). Gemessen:
                                             brand-700 auf Weiß 4,40:1, brand-500 auf
                                             zinc-900 7,81:1 — beide über den 3:1 aus
                                             1.4.11. --}}
                                        {{-- `self-start` ist PFLICHT, nicht Feinschliff: als
                                             Flex-Kind streckt sich diese Hülle sonst auf die
                                             volle Zeilenhöhe (`align-items: stretch`). Am
                                             Bildschirm nachgesehen war der Ring dann eine
                                             ELLIPSE, und die deckende Unterlage verschluckte
                                             den Faden über und unter dem Avatar — der Faden
                                             sah aus, als träfe er die Knoten nicht. --}}
                                        <span class="relative shrink-0 self-start rounded-full bg-white dark:bg-zinc-900"
                                              :class="row.badge ? 'ring-2 ring-brand-700 dark:ring-brand-500' : ''">
                                            <x-group::nostr-avatar picture="row.actorPicture" name="row.actorName" size="1.75rem" />
                                        </span>
                                        <div class="min-w-0 flex-1">
                                            <p class="text-sm leading-snug">
                                                <span class="font-semibold" x-text="row.actorName"></span>
                                                <span class="text-muted" x-text="' ' + row.verb + ' '"></span>
                                                <span class="font-medium" x-text="row.object"></span>
                                            </p>
                                            {{-- Kurzhash und Statuswort stehen HIER und nicht
                                                 mehr rechts in der Zeile. Als Flex-Geschwister
                                                 des Satzes schnitten sie ihm auf schmalen
                                                 Fenstern die Breite ab und standen mitten im
                                                 Satzbau („hat einen [ca1c707] Pull Request
                                                 eröffnet") — bei 360px nachgesehen. In der
                                                 Metazeile sind sie ruhiger Beleg statt
                                                 Blickfang. --}}
                                            <p class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
                                                <span x-text="row.timeLabel"></span>
                                                <template x-if="row.repoName">
                                                    <span><span aria-hidden="true">·</span> <span x-text="row.repoName"></span></span>
                                                </template>
                                                <template x-if="row.badge">
                                                    <span class="rounded-pill bg-brand-500/10 px-1.5 py-0.5 font-semibold tracking-tight text-brand-800 dark:text-brand-300"
                                                          x-text="row.badge"></span>
                                                </template>
                                                <template x-if="row.statusLabel">
                                                    <span class="rounded-pill bg-zinc-100 px-1.5 py-0.5 font-medium dark:bg-zinc-800"
                                                          x-text="row.statusLabel"></span>
                                                </template>
                                            </p>
                                            {{-- Zweite Zeile: IMMER `x-text`. Der Rumpf ist
                                                 Fremdtext und wird hier nie als HTML
                                                 gebunden — gerendert wird Markdown nur auf
                                                 der Repo-Seite, über den Artikel-Renderer. --}}
                                            <template x-if="row.body">
                                                <p class="mt-1.5 line-clamp-2 text-sm text-zinc-700 dark:text-zinc-300" x-text="row.body"></p>
                                            </template>
                                        </div>
                                    </li>
                                </template>
                            </ol>
                        </div>
                    </div>

                    {{-- ── Projekte ────────────────────────────────────────────────
                         Wir erfinden KEIN Projekt aus einem Repository ohne 30621
                         (Buzz Desktop tut das und zeigt deshalb „Projects 1", obwohl
                         kein einziges Projekt-Ereignis existiert). Stattdessen sagt
                         der Leerzustand, wo diese Repositories stehen. --}}
                    <div x-show="tab === 'projects' && !(loading && isEmpty())" x-cloak>
                        <template x-if="overview.projects.length === 0">
                            <div class="surface-card empty-state px-6 py-12 text-center" data-forge-empty="projects">
                                <span class="mx-auto flex size-12 items-center justify-center rounded-tile bg-zinc-100 dark:bg-zinc-800">
                                    <flux:icon.rectangle-stack class="size-6 text-zinc-500 dark:text-zinc-400" />
                                </span>
                                <flux:heading class="mt-4">{{ __('Noch keine Projekte.') }}</flux:heading>
                                <flux:text class="mx-auto mt-1.5 max-w-sm text-sm text-muted">{{ __('Ein Projekt bündelt mehrere Repositories. Einzelne Repositories stehen im Tab „Repositories".') }}</flux:text>
                                <div class="mt-5">
                                    <flux:button size="sm" variant="ghost" icon="code-bracket" x-on:click="tab = 'repos'">{{ __('Zu den Repositories') }}</flux:button>
                                </div>
                            </div>
                        </template>

                        {{-- Eine Liste in EINER Karte. Die Trennkante sitzt UNTEN und wird
                             an der letzten Zeile abgeschaltet — nicht oben mit `divide-y`
                             oder `first:`: Alpines `x-for` lässt das `<template>` als
                             erstes Kind stehen, `:first-child` trifft damit nie eine
                             echte Zeile, `:last-child` dagegen schon. Dieselbe
                             Konstruktion wie in der Ref-Spur weiter oben. --}}
                        <div x-show="overview.projects.length > 0" class="surface-card">
                            <template x-for="project in overview.projects" :key="project.address">
                                <div class="border-b border-zinc-200 p-4 last:border-b-0 dark:border-zinc-800" data-forge-project :data-address="project.address">
                                    <div class="flex items-start gap-3">
                                        <span class="flex size-9 shrink-0 items-center justify-center rounded-tile bg-brand-500/10 text-brand-800 dark:text-brand-300">
                                            <flux:icon.rectangle-stack class="size-5" />
                                        </span>
                                        <div class="min-w-0 flex-1">
                                            <p class="font-semibold" x-text="project.name"></p>
                                            <p class="mt-0.5 line-clamp-2 text-sm text-muted" x-text="project.description"></p>
                                        </div>
                                        <span class="shrink-0 text-xs text-muted" x-text="project.dateLabel"></span>
                                    </div>

                                    <ul class="mt-2.5 flex flex-wrap gap-1.5 ps-12">
                                        <template x-for="repo in project.repoNaddrs" :key="repo.naddr || repo.name">
                                            <li>
                                                <a :href="repo.naddr ? repoHref(repo) : null" wire:navigate
                                                   class="pressable inline-flex items-center gap-1 rounded-pill bg-zinc-100 px-2 py-0.5 text-xs transition-colors hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700">
                                                    <flux:icon.code-bracket variant="micro" class="size-3.5" />
                                                    <span x-text="repo.name"></span>
                                                </a>
                                            </li>
                                        </template>
                                    </ul>

                                    {{-- Eine Koordinate, zu der kein Repository vorliegt,
                                         wird BENANNT statt verschluckt: ein Projekt, das
                                         drei Repositories nennt und zwei zeigt, sieht aus
                                         wie eins mit zweien. --}}
                                    <template x-if="project.missingAddresses.length > 0">
                                        <p class="mt-2 ps-12 text-xs text-muted"
                                           x-text="$plural(project.missingAddresses.length, '1 Repository des Projekts liegt nicht auf diesem Relay.', ':count Repositories des Projekts liegen nicht auf diesem Relay.')"></p>
                                    </template>
                                </div>
                            </template>
                        </div>
                    </div>

                    {{-- ── Repositories ────────────────────────────────────────────── --}}
                    <div x-show="tab === 'repos' && !(loading && isEmpty())" x-cloak>
                        <template x-if="overview.repos.length === 0">
                            <div class="surface-card empty-state px-6 py-12 text-center" data-forge-empty="repos">
                                <span class="mx-auto flex size-12 items-center justify-center rounded-tile bg-zinc-100 dark:bg-zinc-800">
                                    <flux:icon.code-bracket class="size-6 text-zinc-500 dark:text-zinc-400" />
                                </span>
                                <flux:heading class="mt-4">{{ __('Noch keine Repositories.') }}</flux:heading>
                                <flux:text class="mx-auto mt-1.5 max-w-sm text-sm text-muted">{{ __('Sobald jemand ein Repository ankündigt, erscheint es hier.') }}</flux:text>
                            </div>
                        </template>

                        <div x-show="overview.repos.length > 0" class="surface-card">
                            <template x-for="repo in overview.repos" :key="repo.address">
                                {{-- GANZE Zeile = ein Link (keine verschachtelten Links) —
                                     dieselbe Regel wie `room-tile` und die Artikelkarte. --}}
                                <a :href="repoHref(repo) || null" wire:navigate data-forge-repo :data-naddr="repo.naddr"
                                   class="pressable group flex items-start gap-3 border-b border-zinc-200 p-4 transition-colors last:border-b-0 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/60">
                                    <span class="flex size-9 shrink-0 items-center justify-center rounded-tile bg-brand-500/10 text-brand-800 dark:text-brand-300">
                                        <flux:icon.code-bracket class="size-5" />
                                    </span>
                                    <div class="min-w-0 flex-1">
                                        <p class="font-semibold" x-text="repo.name"></p>
                                        <p class="mt-0.5 line-clamp-2 text-sm text-muted" x-text="repo.description"></p>
                                        {{-- Der aktuelle Ref steht VOR den Zählungen und trägt
                                             als einziges Element hier die Markenfarbe: er ist
                                             die Kennung des Repositories, die Zählungen sind
                                             Beiwerk. Gemessen brand-800 auf brand-500/10 =
                                             5,92:1 hell, brand-300 auf zinc-900 = 9,56:1
                                             dunkel — das alte brand-700 lag bei 4,05:1 und
                                             riss damit WCAG 1.4.3. --}}
                                        <p class="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-muted">
                                            <template x-if="repo.state && repo.state.head">
                                                <span class="inline-flex items-center gap-1 rounded-pill bg-brand-500/10 px-1.5 py-0.5 font-semibold text-brand-800 dark:text-brand-300">
                                                    <flux:icon.code-bracket-square variant="micro" class="size-3.5" />
                                                    <span x-text="repo.state.head"></span>
                                                </span>
                                            </template>
                                            <span x-text="$plural(repo.issueCount, '1 Issue', ':count Issues')"></span>
                                            <span aria-hidden="true">·</span>
                                            <span x-text="$plural(repo.pullRequestCount, '1 Pull Request', ':count Pull Requests')"></span>
                                            <span aria-hidden="true">·</span>
                                            <span x-text="$plural(repo.people.length, '1 Maintainer', ':count Maintainer')"></span>
                                        </p>
                                    </div>
                                    <flux:icon.chevron-right class="mt-1 size-4 shrink-0 text-zinc-500 transition-transform group-hover:translate-x-0.5 dark:text-zinc-400" />
                                </a>
                            </template>
                        </div>
                    </div>
                </div>
            </div>
        @endif
    </div>

</x-group::app-shell>
