@props([
    // Der Gruppenschlüssel aus `railGroups.ts` — 'rooms' | 'meetups' | 'proposals' | 'workspace'.
    'group',
    'label',
    // Nur die Meetup-Gruppe trägt die Länder-Chips.
    'countries' => false,
    // Ziel des Sektionsnamens. Gesetzt heißt: der Name wird zum Link, das Chevron
    // bleibt für Auf/Zu zuständig (P1, zwei getrennte Trefferflächen).
    'headingHref' => null,
    // Beschriftung des Icon-Knopfes neben Zahl und Lupe; null = kein Knopf.
    'overviewLabel' => null,
    // Tooltip des Sektionsnamens: ein GANZER Satz mit dem Platzhalter `:wert`,
    // dazu der Alpine-Ausdruck, der ihn füllt. Zwei Props statt einem fertigen
    // Ausdruck, damit `@js()` HIER läuft — es escapt für den Attributkontext
    // (Anfuehrungszeichen als Entity); ein durchgereichter Ausdruck bräuchte den
    // ungeschützten Echo-Ausdruck, und der ist eine Injektionsfläche.
    'headingTitle' => null,
    'headingTitleValue' => null,
    // Rendert den Forge-Baum zwischen Angehefteten und Sektionen (nur 'workspace').
    'tree' => false,
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
{{-- `groupTotal()` statt `groupFor().total`: im Workspace zählen die Repos und
     Projekte mit (Begründung dort). Das löst zugleich die Existenzfrage — ein
     Workspace mit Repos, aber ohne sichtbare Kanäle hatte `total === 0` und
     verschwand samt Baum. Eine Zahl, eine Bedingung, keine zwei Wahrheiten
     darüber, ob diese Sektion etwas enthält. --}}
@php($present = 'groupTotal('.json_encode($group).') > 0')

<template x-if="{{ $present }} || @js($group) === 'rooms'">
    <section class="pt-2">
        <div class="flex min-h-7 items-center gap-1 px-2">
            {{-- ── Zwei Trefferflächen, wenn der Name ein Ziel hat (P1) ────────
                 Das Chevron klappt, der Name führt zur Übersicht. Getrennte
                 Elemente statt eines Buttons mit zwei Bedeutungen: ein Klick auf
                 den Namen darf nicht zusätzlich klappen, und ein `<a>` in einem
                 `<button>` wäre ungültiges HTML und für die Tastatur kaputt.
                 `aria-expanded`/`aria-controls` sitzen dort, wo geklappt wird. --}}
            {{-- ── EINE Chevron-Spalte für die ganze Rail (Design-Pass 2026-08-17b) ──
                 P1 vergrößerte NUR das Chevron des Workspace-Kopfes auf 24×24 und
                 ließ die drei übrigen Köpfe stehen. Ergebnis am Gesamtbild: das
                 Chevron stand 2 px rechts von den anderen, die Beschriftung 12 px
                 — sichtbar schief, und zwar nur, wenn man alle vier Köpfe
                 nebeneinander sieht. Gemessen (1440 px, Rail-Innenbreite 295 px):

                     Kopf         Glyph-x   Zielfläche      Beschriftung-x
                     rooms        20,00     237,56 × 20,8   36
                     meetups      20,00     244,28 × 20,8   36
                     proposals    20,00     244,28 × 20,8   36
                     workspace    22,00      24,00 × 24,0   48

                 Die 20,8 px Höhe der ersten drei sind zugleich ein BESTEHENDER
                 Verstoß gegen WCAG 2.2 SC 2.5.8 (24×24): P1 hat einen von vier
                 Fällen geheilt. Also nicht die Vergrößerung zurücknehmen, sondern
                 sie auf alle vier ziehen — halb umgestellt ist der schlechteste
                 Zustand.

                 Die Zahlen danach, alle vier gleich: Zielfläche ab x = 12
                 (`-ms-2` zieht sie über das `px-2` der Kopfzeile hinaus), 24×24,
                 Glyph bei x = 18, Beschriftung bei x = 40. x = 12 ist keine neue
                 Erfindung: es ist EXAKT die Spalte, in der die Chevrons der
                 Forge-Baumzeilen schon stehen (`rail-forge-row`, Ebene 0, gemessen
                 18). Damit hat jedes Auf/Zu in dieser Spalte dieselbe Kante — und
                 der Baum musste dafür nicht angefasst werden.

                 Das Chevron sitzt in beiden Zweigen in derselben 24-px-Hülle. Im
                 `headingHref`-Fall ist die Hülle der Knopf selbst; ohne Ziel ist
                 der ganze Streifen der Knopf (große Trefferfläche bleibt), und die
                 Hülle steht darin — sie gibt dem Knopf zugleich seine 24 px Höhe.

                 Hover jetzt einheitlich über die TEXTFARBE, nicht über eine
                 Fläche. P1 hatte dem Chevron die Flächen-Hover der beiden
                 Icon-Knöpfe am Zeilenende gegeben; das stellt es zu den AKTIONEN,
                 wo es nicht hingehört. Die Regel dieser Zeile ist jetzt: der Kopf
                 (Chevron + Name) reagiert mit Farbe, die zwei Aktionen am Ende mit
                 Fläche. `text-muted` steht deshalb am KNOPF bzw. am LINK und NICHT
                 mehr am Beschriftungs-Span — sonst gewönne dessen eigene
                 `color`-Deklaration gegen den Hover des Elternteils, und genau das
                 war der Fall: der Workspace-Name, der einzige anklickbare
                 Sektionsname der Rail, hatte gar keine Hover-Rückmeldung. --}}
            <button type="button"
                    x-on:click="toggleGroup(@js($group))"
                    x-bind:aria-expanded="isOpen(@js($group)) ? 'true' : 'false'"
                    aria-controls="{{ $id }}"
                    @if ($headingHref)
                        aria-label="{{ __('Bereich :label auf- oder zuklappen', ['label' => $label]) }}"
                        class="pressable -ms-2 inline-flex size-6 shrink-0 items-center justify-center rounded text-muted transition-colors hover:text-zinc-900 dark:hover:text-zinc-100"
                    @else
                        class="pressable -ms-2 flex min-w-0 flex-1 items-center gap-1 rounded text-start text-muted transition-colors hover:text-zinc-900 dark:hover:text-zinc-100"
                    @endif>
                <span aria-hidden="true" class="inline-flex size-6 shrink-0 items-center justify-center">
                    <flux:icon.chevron-right variant="micro"
                                             class="size-3 shrink-0 transition-transform"
                                             x-bind:class="isOpen(@js($group)) ? 'rotate-90' : ''" />
                </span>
                @unless ($headingHref)
                    <span class="min-w-0 truncate text-[0.7rem] font-semibold uppercase tracking-wider">{{ $label }}</span>
                @endunless
            </button>

            @if ($headingHref)
                {{-- Die Herkunft steht im `title`, nicht in der Zeile. Sie ist die
                     Antwort auf eine Frage, die genau einmal gestellt wird („welches
                     Relay ist das?"), und stand bis hierher in jedem Bildaufbau —
                     bei 295 px Rail-Innenbreite hat sie den Sektionsnamen mit sich
                     gerissen: gemessen `scrollWidth`/`clientWidth` 55/44 für
                     „Workspace" und 160/126 für „· buzz.einundzwanzig.space", also
                     BEIDE Teile gekappt und kein ganzes Wort mehr übrig. --}}
                {{-- `data-rail-gruppenkopf`: Sprungziel für `/forge?tab=workspaces`
                     ab `xl`, wo die Forge-Bühne keinen Kanäle-Tab mehr hat (der
                     Zuhörer steht in `desktop-rail.blade.php`). Generisch über den
                     Gruppenschlüssel statt als Sonderfall für „workspace" — eine
                     künftige Gruppe bekommt dasselbe, ohne zweite Regel. --}}
                <a href="{{ $headingHref }}" wire:navigate data-rail-gruppenkopf="{{ $group }}"
                   @if ($headingTitle && $headingTitleValue)
                       x-bind:title="@js($headingTitle).split(':wert').join({{ $headingTitleValue }})"
                   @endif
                   {{-- `min-h-6`: der Namens-Link ist eine eigene Zielfläche und lag
                        bei 19,7 px Höhe — SC 2.5.8 verlangt 24, und die
                        Abstands-Ausnahme greift nicht, das Chevron liegt 4 px daneben. --}}
                   class="pressable flex min-h-6 min-w-0 flex-1 items-center rounded text-start text-muted transition-colors hover:text-zinc-900 dark:hover:text-zinc-100">
                    <span class="min-w-0 truncate text-[0.7rem] font-semibold uppercase tracking-wider">{{ $label }}</span>
                </a>
            @endif

            {{-- Bestand grau, immer. Bei ZUGEKLAPPTER Gruppe zusätzlich die
                 Ungelesen-Summe — der einzige Ort, an dem sie erscheint. --}}
            <span class="shrink-0 font-mono text-[0.7rem] tabular-nums text-muted"
                  x-text="groupTotal(@js($group))"></span>
            <template x-if="!isOpen(@js($group))">
                <x-group::unread-badge :count="'groupUnread(\''.$group.'\')'" size="sm" :sr="false" />
            </template>

            @if ($overviewLabel && $headingHref)
                {{-- Der zweite von drei Wegen zur Übersicht. Ein nacktes Icon ohne
                     Namen wäre ein Rätsel — `aria-label` UND `title`, damit es
                     Screenreader ankündigen und die Maus es beim Verweilen zeigt. --}}
                <a href="{{ $headingHref }}" wire:navigate
                   aria-label="{{ $overviewLabel }}" title="{{ $overviewLabel }}"
                   class="pressable inline-flex size-6 shrink-0 items-center justify-center rounded text-muted transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100">
                    <flux:icon.code-bracket variant="micro" aria-hidden="true" class="size-3.5" />
                </a>
            @endif

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

            {{-- ── Angeheftete zuerst (P3, NIP-78) ─────────────────────────────
                 Was der Nutzer in Buzz Desktop angeheftet hat (`channel-stars`),
                 steht oben und wird NIE gekappt. Nur die Gruppe `workspace` kann
                 hier etwas haben — die Präferenzen beschreiben Buzz-Kanäle, der
                 zooid-Arm bleibt unverändert.

                 KEINE eigene Überschrift: dieselbe Begründung wie bei der Haarlinie
                 unten — ein zweites Sektionslabel brächte eine Achse zurück, die der
                 Gruppenschnitt gerade entfernt hat. Die Zeile selbst trägt stattdessen
                 ein Nadel-Icon (nicht-farbliches Merkmal, WCAG 1.4.1) und den Zustand
                 im `aria-label` der Zeile (seit 2026-08-17, siehe `rail-room-row.blade.php`);
                 die Position allein wäre für Screenreader nichts. --}}
            <template x-for="room in groupFor(@js($group)).pinned" :key="room.h">
                <x-group::rail-room-row />
            </template>

            <template x-if="groupFor(@js($group)).pinned.length && (groupFor(@js($group)).sections.length || groupFor(@js($group)).joined.length || groupFor(@js($group)).others.length)">
                <div class="my-1 border-t border-zinc-200/60 dark:border-zinc-800/60"></div>
            </template>

            @if ($tree)
                {{-- ── Der Forge-Baum (P1) ─────────────────────────────────────
                     EINE flache Liste, keine Verschachtelung im Markup: Alpine
                     kennt keine rekursiven Templates, und eine flache Liste ist
                     hier ohnehin die richtige Form — sie ist EXAKT dieselbe
                     Folge, die `railTargets` der Tastatur gibt (`railForge.ts`).
                     Die Ebenen trägt `node.depth` als Einrückung: 12px je Stufe,
                     nicht 16 — drei Ebenen in einer ~290px-Spalte lassen dem
                     Namen sonst nichts übrig. Der maßgebliche Wert steht in
                     `rail-forge-row.blade.php` (`node.depth * 12`); wer eine
                     weitere Ebene einwebt (P2, Foren), nimmt ihn von dort.

                     Was der Baum enthält, entscheidet `buildForgeNav`: keine
                     Repos → keine Zeile; ein Projekt mit einem Repo → eine
                     Zeile; Zähler nur bei > 0; ab fünf Einträgen die Faltung mit
                     sichtbarem aktivem Pfad. Kein Blade-Ausdruck entscheidet
                     hier etwas mit. --}}
                <template x-for="node in forgeRows" :key="node.id">
                    <x-group::rail-forge-row />
                </template>

                <template x-if="forgeRows.length && (groupFor(@js($group)).sections.length || groupFor(@js($group)).joined.length || groupFor(@js($group)).others.length)">
                    <div class="my-1 border-t border-zinc-200/60 dark:border-zinc-800/60"></div>
                </template>
            @endif

            {{-- ── Sektionen (P7, `channel-sections`) ──────────────────────────
                 Die benannten Untergliederungen aus Buzz Desktop, in der
                 Reihenfolge ihres `order` (`orderedSections`, aufgelöst in
                 `channelPrefs.ts`). Leere Sektionen liefert `buildGroups` gar
                 nicht erst — bei uns wäre eine Überschrift ohne Zeilen eine
                 Beschriftung über nichts, weil man hier nichts hineinziehen kann.

                 HIER trägt eine Überschrift, anders als bei „angeheftet" und
                 „nicht beigetreten": die beiden sind Zustände, die die Zeile
                 selbst zeigt (Nadel, Kontraststufe) — eine Sektion ist ein NAME,
                 den der Nutzer vergeben hat. Ohne ihn wäre die Gruppierung
                 unsichtbar und damit sinnlos.

                 Statischer <p>, kein Auf/Zu-Knopf: der Klappzustand je Sektion
                 wäre neuer, zu persistierender Zustand — und die Gruppe darüber
                 klappt bereits. Dieselbe Form wie die Sektionsköpfe der Bühne
                 („Meine Räume"/„Meine Meetups" in ⚡spaces.blade.php), nur eine
                 Stufe kleiner als der Gruppenkopf: Bestand grau und mono, damit
                 die Zahl nicht mit einer Ungelesen-Pille verwechselt wird.

                 `sec.icon` ist ein EMOJI (Buzz lässt es aus einem Emoji-Picker
                 wählen), deshalb `x-text` + `aria-hidden` — für Screenreader
                 trägt der Name. --}}
            <template x-for="sec in groupFor(@js($group)).sections" :key="sec.id">
                <div class="mt-1">
                    <p class="flex items-baseline gap-1 px-2 pb-0.5 text-[0.7rem] font-semibold text-muted">
                        <span x-show="sec.icon" x-cloak aria-hidden="true" class="shrink-0" x-text="sec.icon"></span>
                        <span class="min-w-0 truncate" x-text="sec.name"></span>
                        <span class="shrink-0 font-mono font-normal tabular-nums" x-text="sec.rooms.length"></span>
                    </p>
                    <div class="space-y-px">
                        <template x-for="room in sec.rooms" :key="room.h">
                            <x-group::rail-room-row />
                        </template>
                    </div>
                </div>
            </template>

            {{-- Haarlinie zwischen der letzten Sektion und dem Rest-Block: die
                 Kanäle OHNE Sektionszuordnung stehen unter den Sektionen (Buzz'
                 Gruppe „Channels", `AppSidebar.tsx:731`) und brauchen dieselbe
                 Grenze, die auch die Angehefteten vom Rest trennt. --}}
            <template x-if="groupFor(@js($group)).sections.length && (groupFor(@js($group)).joined.length || groupFor(@js($group)).others.length)">
                <div class="my-1 border-t border-zinc-200/60 dark:border-zinc-800/60"></div>
            </template>

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

            <template x-if="!({{ $present }})">
                <p class="px-2 py-1.5 text-[0.7rem] text-muted">{{ __('Kein Treffer in dieser Gruppe.') }}</p>
            </template>
        </div>
    </section>
</template>
