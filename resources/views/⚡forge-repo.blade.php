<?php

use Livewire\Attributes\Layout;
use Livewire\Component;

/**
 * Ein Repository der Forge (`/forge/{naddr}`, P6) als Livewire-Full-Page-SFC.
 *
 * `$naddr` kommt aus dem Routen-Parameter und wird via `@js($naddr)` an die Insel
 * gereicht — die einzige Server→Insel-Übergabe; Laden, Falten und Rendern laufen
 * client-seitig (`nostrForgeRepo`).
 *
 * **Kein server-seitiger Titel aus dem Repository.** Der Server kennt es nicht: es
 * liegt auf dem Workspace-Relay hinter NIP-42. Der Seitentitel bleibt deshalb
 * generisch; der echte Name steht als `<h1>` im Kopf, sobald er da ist.
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
        return $this->view()->title(__('Repository'));
    }
}; ?>

{{-- `width="wide"` (P5): die Repo-Seite ist die dichteste Tabelle des Clients —
     Dateibaum, Branches, Issues, Pull Requests. Fließtext gibt es hier nur in den
     Kommentaren, und die deckeln sich über ihre eigene Spalte. Der Lesedeckel von
     62 rem zwang die Tabellen in eine Breite, in der Spalten umbrachen, während
     rechts Platz stand.

     KEINE Ortskarten-Leiste: das hier ist eine Detail-Ebene, kein Ort. Der Weg
     zurück steht im `app-header` (Pfeil auf die Forge-Übersicht), genau wie in der
     Artikel-Vollansicht. Eine Ortsleiste über einer Detailseite behauptete, man sei
     an einem der drei Orte angekommen — man ist eine Ebene darunter. --}}
<x-group::app-shell width="wide">

    <div x-data="nostrForgeRepo(@js($naddr))" class="page-enter">

        {{-- `json_encode` statt `@js()`: `app-header` echot den Ausdruck über `{{ }}`
             und escapt ihn damit selbst genau einmal — dieselbe Begründung wie in
             `⚡article.blade.php` und `⚡room.blade.php` (dort jeweils beim
             `$titleExpr`).

             **Auf das SYMBOL geankert, nicht auf die Zeile** (2026-08-21): hier stand
             `⚡article.blade.php:44` und `⚡room.blade.php:92`. Die Raum-Zeile war schon
             vor P3 falsch (nachgemessen an `HEAD`: dort steht ein Satz über den
             Thread-Wechsel), die Artikel-Zeile ist es durch den P3-Umbau geworden. Beide
             zeigten weiterhin plausibel aussehend ins Leere, ohne dass irgendein Test rot
             wurde — genau der Grund, warum neue Verweise im Haus auf ein eindeutiges
             Symbol zeigen und nicht auf eine Zahl. `grep -n 'titleExpr = '` findet beide
             Stellen unabhängig von jedem Verschub. --}}
        @php($titleExpr = 'view ? view.repo.name : '.json_encode(__('Repository')))

        <x-group::app-header :title="__('Repository')" :title-expr="$titleExpr" :back="route('group.forge')" />

        @if (! config('group.workspace_url'))
            {{-- Keine Quelle konfiguriert — und das ist etwas ANDERES als „dieses
                 Repository gibt es nicht". Ohne diese Weiche behauptete ein Client
                 ohne Workspace über jeden Link, der Relay kenne ihn nicht, obwohl nie
                 einer gefragt wurde. Server-seitig, aus demselben Grund wie auf der
                 Übersicht. --}}
            {{-- Gleiche Bauform wie alle Leerzustände der Forge: Icon in getönter
                 Kachel (zinc-400 auf Weiß misst 2,52:1 und verschwindet), Fließtext auf
                 Lesemaß gedeckelt, Kinder-Reihenfolge für die gestaffelte Einblendung
                 aus `theme.css` unverändert. --}}
            <div class="surface-card empty-state px-6 py-12 text-center">
                <span class="mx-auto flex size-12 items-center justify-center rounded-tile bg-zinc-100 dark:bg-zinc-800">
                    <flux:icon.code-bracket-square class="size-6 text-zinc-500 dark:text-zinc-400" />
                </span>
                <flux:heading class="mt-4">{{ __('Keine Forge-Quelle eingerichtet.') }}</flux:heading>
                <flux:text class="mx-auto mt-1.5 max-w-sm text-sm text-muted">{{ __('Dieser Client kennt kein Relay, auf dem Repositories liegen.') }}</flux:text>
            </div>
        @else
            <div>
                <template x-if="error">
                    <flux:callout variant="danger" icon="exclamation-triangle" class="mb-3">
                        <flux:callout.text x-text="error"></flux:callout.text>
                        <x-slot name="actions">
                            <flux:button size="sm" variant="ghost" icon="arrow-path" x-on:click="retry()">{{ __('Erneut laden') }}</flux:button>
                        </x-slot>
                    </flux:callout>
                </template>

                {{-- Der Relay HAT geantwortet und kennt dieses Repository nicht. Eine
                     Aussage über den Relay, und erst jetzt ist sie gedeckt — deshalb
                     `missing` und nicht `view === null`: die Ableitung meldet ihren
                     ersten Wert, bevor das Netz antwortet. --}}
                <template x-if="missing">
                    <div class="surface-card empty-state px-6 py-12 text-center" data-forge-missing>
                        <span class="mx-auto flex size-12 items-center justify-center rounded-tile bg-zinc-100 dark:bg-zinc-800">
                            <flux:icon.code-bracket class="size-6 text-zinc-500 dark:text-zinc-400" />
                        </span>
                        <flux:heading class="mt-4">{{ __('Dieses Repository kennt der Workspace nicht.') }}</flux:heading>
                        <flux:text class="mx-auto mt-1.5 max-w-sm text-sm text-muted">{{ __('Vielleicht wurde es entfernt, oder der Link zeigt auf ein anderes Relay.') }}</flux:text>
                        <div class="mt-5">
                            <flux:button size="sm" variant="ghost" icon="arrow-left" :href="route('group.forge')" wire:navigate>{{ __('Zur Forge') }}</flux:button>
                        </div>
                    </div>
                </template>

                {{-- Skeleton SERVER-gerendert (nicht x-if): vor dem Alpine-Boot
                     existierte der Inhalt eines Templates gar nicht im DOM. --}}
                <div x-show="loading && !view" class="space-y-3">
                    <div class="surface-card space-y-2 p-4">
                        <div class="skeleton h-4 w-1/3"></div>
                        <div class="skeleton h-3 w-2/3"></div>
                        <div class="skeleton h-3 w-1/2"></div>
                    </div>
                </div>

                <template x-if="view">
                    <div>
                        {{-- ── Kopf des Repositories ──────────────────────────────
                             Zwei Teile mit unterschiedlichem Rang statt eines
                             Formulars: oben die Identität (Beschreibung + der Befehl,
                             mit dem man an das Repository kommt), unten das Datenblatt.

                             Das Datenblatt ist EINSPALTIG mit Haarlinien-Zeilen und
                             nicht mehr `sm:grid-cols-2`. Grund ist der reale Bestand:
                             am Ziel-Relay hat ein Repository oft nur EINEN dieser
                             Einträge (das leere Testrepo hat genau „Branches"). Ein
                             zweispaltiges Raster stellte diesen einen Eintrag neben
                             eine leere Hälfte und sah aus, als fehle etwas. Eine
                             Zeilenliste ist bei einem Eintrag genauso richtig wie bei
                             dreien.

                             Die Kante sitzt OBEN und die immer vorhandene Zeile
                             („Branches") steht als erste ohne Kante — `divide-y` oder
                             `first:` wären hier falsch: die bedingten Zeilen hängen an
                             `<template x-if>`, und Alpine lässt das Template als Kind
                             im DOM stehen. Welches Kind das erste IST, hängt damit an
                             den Daten; welches immer da ist, weiß dagegen die View. --}}
                        <div class="surface-card overflow-hidden">
                            <div class="p-4">
                                <p x-show="view.repo.description" class="forge-mass text-sm text-zinc-700 dark:text-zinc-300" x-text="view.repo.description"></p>

                                {{-- Clone-URL. Kein Link: sie gehört in ein Terminal,
                                     nicht in einen Browser-Tab — der Git-Endpunkt
                                     beantwortet einen Browser-GET nicht sinnvoll.
                                     `select-all` macht das Kopieren zu einem Klick.
                                     Genau deshalb steht sie hier als BEFEHL: die Zeile
                                     zeigt, was man mit ihr tut, statt sie als Feldwert
                                     abzulegen. `git clone` ist ein Programmaufruf und
                                     wird nicht übersetzt — das Dollarzeichen ist ein
                                     Zeichen, kein Wort, und `aria-hidden`, damit die
                                     Sprachausgabe nicht „Dollar" vorliest. --}}
                                <template x-if="view.repo.cloneUrls.length > 0">
                                    <div class="mt-3 flex items-baseline gap-2 rounded-tile bg-zinc-100 px-3 py-2 text-xs dark:bg-zinc-800">
                                        <span aria-hidden="true" class="shrink-0 select-none font-semibold text-muted">$</span>
                                        <span aria-hidden="true" class="shrink-0 select-none text-muted">git clone</span>
                                        <span class="min-w-0 select-all break-all font-semibold" data-forge-clone x-text="view.repo.cloneUrls[0]"></span>

                                        {{-- Kopieren mit einem Klick — aber nur, wo es
                                             auch etwas tut. `navigator.clipboard` gibt es
                                             ausschließlich in sicheren Kontexten (HTTPS
                                             oder localhost); über eine nackte
                                             HTTP-Adresse im LAN ist es `undefined`. Dort
                                             erscheint dieser Knopf gar nicht erst, und es
                                             bleibt bei der bisherigen `select-all`-Zeile:
                                             ein Klick markiert sie ganz. Ein sichtbarer
                                             Knopf, der nichts bewirkt, wäre der
                                             schlechtere Tausch — er nimmt dem Nutzer die
                                             Gewissheit, ob er kopiert hat oder nicht.

                                             `items-baseline` der Zeile trüge den Knopf
                                             auf der Schriftlinie und damit zu hoch —
                                             `self-center` stellt ihn auf die Mitte. --}}
                                        <template x-if="canCopyClone()">
                                            <flux:button size="xs" variant="ghost" icon="clipboard-document"
                                                         class="icon-btn-touch shrink-0 self-center"
                                                         data-forge-clone-copy
                                                         x-on:click="copyClone()"
                                                         aria-label="{{ __('Clone-URL kopieren') }}" />
                                        </template>
                                    </div>
                                </template>
                            </div>

                            <dl class="text-sm">
                                {{-- Branch-Zustand aus dem kind 30618. Er ist
                                     relay-signiert; fehlt er, sagt die Fläche das,
                                     statt einen Branch zu raten. Immer gerendert —
                                     und deshalb die Zeile ohne Oberkante. --}}
                                <div class="flex flex-col gap-1 border-t border-zinc-200 px-4 py-3 sm:flex-row sm:gap-4 dark:border-zinc-800">
                                    <dt class="shrink-0 pt-0.5 text-[0.7rem] font-semibold uppercase tracking-wider text-muted sm:w-44">{{ __('Branches') }}</dt>
                                    <dd class="min-w-0 flex-1">
                                        <template x-if="view.repo.state && view.repo.state.branches.length > 0">
                                            <ul class="flex flex-wrap gap-1.5">
                                                {{-- Der Kurzhash trägt die Markenfarbe, der Ref
                                                     daneben nicht: das Git-Objekt ist der eine
                                                     Akzent dieser Seite. Gemessen brand-800 auf
                                                     brand-500/10 = 5,92:1 (hell), brand-300 auf
                                                     zinc-900 = 9,56:1 (dunkel), gerechnet mit
                                                     `p2-kontrast.mjs`. Vorher stand hier
                                                     brand-700 mit 4,05:1 bzw. 3,89:1 auf der
                                                     15%-Fläche — beides unter den 4,5:1 aus
                                                     WCAG 1.4.3. --}}
                                                <template x-for="branch in view.repo.state.branches" :key="branch.name">
                                                    <li class="inline-flex items-center gap-1.5 rounded-pill bg-zinc-100 px-2 py-0.5 text-xs dark:bg-zinc-800"
                                                        data-forge-branch :data-branch="branch.name">
                                                        <flux:icon.code-bracket-square variant="micro" class="size-3.5 shrink-0 text-zinc-500 dark:text-zinc-400" />
                                                        <span class="font-semibold" x-text="branch.name"></span>
                                                        <span class="rounded-pill bg-brand-500/10 px-1.5 font-semibold tracking-tight text-brand-800 dark:text-brand-300"
                                                              x-text="branch.commit.slice(0, 7)"></span>
                                                        <template x-if="view.repo.state.head === branch.name">
                                                            <span class="text-[0.65rem] font-semibold uppercase tracking-wider text-muted">{{ __('HEAD') }}</span>
                                                        </template>
                                                    </li>
                                                </template>
                                            </ul>
                                        </template>
                                        <template x-if="!view.repo.state || view.repo.state.branches.length === 0">
                                            <span class="text-xs text-muted" data-forge-no-state>{{ __('Noch kein Branch-Zustand veröffentlicht.') }}</span>
                                        </template>
                                    </dd>
                                </div>

                                {{-- Branch-Schutz aus `buzz-protect`. Eine
                                     Buzz-Erweiterung, kein NIP-34 — sie steht hier,
                                     weil sie beantwortet, warum ein Push abgelehnt
                                     wird.

                                     NEUTRAL statt Amber, und das ist kein Geschmack:
                                     Tailwinds amber-500 (#fe9a00) misst gegen die
                                     Hausmarke brand-500 (#f7931a) 1,08:1 — für das Auge
                                     dasselbe Orange. Zwei verschiedene Bedeutungen
                                     (Git-Objekt vs. Schutzregel) trugen damit dieselbe
                                     Farbe, und Amber kommt zudem aus Tailwinds Rampe,
                                     nicht aus der des Hauses. Träger der Aussage ist das
                                     Schloss plus der Regelname im Text. --}}
                                <template x-if="view.repo.protections.length > 0">
                                    <div class="flex flex-col gap-1 border-t border-zinc-200 px-4 py-3 sm:flex-row sm:gap-4 dark:border-zinc-800">
                                        <dt class="shrink-0 pt-0.5 text-[0.7rem] font-semibold uppercase tracking-wider text-muted sm:w-44">{{ __('Geschützte Branches') }}</dt>
                                        <dd class="flex min-w-0 flex-1 flex-wrap gap-1.5">
                                            <template x-for="rule in view.repo.protections" :key="rule.ref + rule.rule">
                                                <span data-forge-protection
                                                      class="inline-flex items-center gap-1.5 rounded-pill bg-zinc-100 px-2 py-0.5 text-xs text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100">
                                                    <flux:icon.lock-closed variant="micro" class="size-3.5 shrink-0 text-zinc-500 dark:text-zinc-400" />
                                                    <span x-text="rule.ref.replace('refs/heads/', '') + ': ' + rule.rule"></span>
                                                </span>
                                            </template>
                                        </dd>
                                    </div>
                                </template>

                                {{-- Beteiligte. Speist sich aus den `maintainers`-Tags
                                     des Announcements — die einzigen Personen, die das
                                     Ereignis selbst benennt. --}}
                                <template x-if="view.repo.people.length > 0">
                                    <div class="flex flex-col gap-1 border-t border-zinc-200 px-4 py-3 sm:flex-row sm:gap-4 dark:border-zinc-800">
                                        <dt class="shrink-0 pt-0.5 text-[0.7rem] font-semibold uppercase tracking-wider text-muted sm:w-44">{{ __('Maintainer') }}</dt>
                                        <dd class="flex min-w-0 flex-1 flex-wrap items-center gap-1">
                                            <template x-for="person in view.repo.people.slice(0, 12)" :key="person.pubkey">
                                                <span data-forge-person :data-pubkey="person.pubkey" :title="person.name">
                                                    <x-group::nostr-avatar picture="person.picture" name="person.name" size="1.75rem" />
                                                </span>
                                            </template>
                                            <template x-if="view.repo.people.length > 12">
                                                <span class="ms-1 text-xs text-muted"
                                                      x-text="'+' + (view.repo.people.length - 12)"></span>
                                            </template>
                                        </dd>
                                    </div>
                                </template>
                            </dl>
                        </div>

                        <flux:tabs variant="segmented" x-model="tab" class="mb-3 mt-4">
                            <flux:tab name="issues">{{ __('Issues') }}</flux:tab>
                            <flux:tab name="pulls">{{ __('Pull Requests') }}</flux:tab>
                            <flux:tab name="activity">{{ __('Aktivität') }}</flux:tab>
                        </flux:tabs>

                        <template x-if="truncatedText()">
                            <flux:callout variant="secondary" icon="information-circle" class="mb-3">
                                <flux:callout.text x-text="truncatedText()"></flux:callout.text>
                            </flux:callout>
                        </template>

                        {{-- ── Issues ───────────────────────────────────────────── --}}
                        <div x-show="tab === 'issues'" x-cloak>
                            {{-- ── Schreibzeile (P8) ──────────────────────────────
                                 **Wer nicht darf, sieht das hier — vor dem Klick.**
                                 Es gibt bewusst kein Formular, das erst beim
                                 Absenden scheitert: entweder steht der Knopf da,
                                 oder es steht der Grund da, warum nicht.

                                 Der Knopf liegt ÜBER der Liste und nicht in einer
                                 Zeile. Ein zweiter `button` in der Kopfzeile eines
                                 Issues machte aus dem `getByRole('button')` der
                                 Lese-Spec einen Strict-Mode-Treffer auf zwei
                                 Elemente — dieselbe Begründung wie am
                                 Aufklapp-Knopf weiter unten. --}}
                            <div class="mb-3 space-y-2">
                                <template x-if="canWrite()">
                                    <div>
                                        <flux:button size="sm" variant="ghost" icon="plus"
                                                     x-on:click="toggleIssueDraft()"
                                                     ::aria-expanded="issueDraft.open ? 'true' : 'false'">{{ __('Neues Issue') }}</flux:button>

                                        <template x-if="issueDraft.open">
                                            <div class="surface-card mt-2 space-y-3 p-4" data-forge-issue-form>
                                                <flux:input label="{{ __('Titel') }}" x-model="issueDraft.title"
                                                            maxlength="256" placeholder="{{ __('Worum geht es?') }}" />
                                                {{-- @-Erwähnung (P9): `relative` trägt das absolut
                                                     positionierte Popover, `data-forge-composer`
                                                     ist der Weg des Fokus zurück ins Feld
                                                     (x-ref taugt dafür in einem x-for nicht). --}}
                                                <div class="relative">
                                                    <flux:textarea label="{{ __('Beschreibung') }}" x-model="issueDraft.body" rows="4"
                                                                   data-forge-composer="issue"
                                                                   x-on:input="onComposerInput($event.target, 'issue')"
                                                                   x-on:keydown="mentionKey($event)"
                                                                   placeholder="{{ __('Optional. Markdown wird gerendert. @ erwähnt jemanden.') }}" />
                                                    @include('group::partials.forge-mention-popover', [
                                                        'targetExpr' => "'issue'",
                                                        'targetLabel' => 'issue',
                                                    ])
                                                </div>

                                                <div x-show="issueDraft.error" x-cloak role="alert" data-forge-issue-error
                                                     class="flex items-start gap-2 rounded-tile border border-red-500/40 bg-red-500/5 px-3 py-2 text-xs text-red-600 dark:text-red-400">
                                                    <flux:icon.exclamation-triangle class="mt-0.5 size-4 shrink-0" />
                                                    <span x-text="issueDraft.error"></span>
                                                </div>

                                                <div class="flex flex-wrap items-center gap-2">
                                                    {{-- Der Name des Knopfes WECHSELT NICHT, wenn er
                                                         fliegt — er wird nur unbedienbar, und der
                                                         Zustand steht als eigener Text daneben. Ein
                                                         Knopf, der beim Drücken seinen Namen ändert,
                                                         ist für die Sprachausgabe ein anderer Knopf. --}}
                                                    <flux:button size="sm" variant="primary"
                                                                 data-forge-issue-submit
                                                                 x-on:click="submitIssue()"
                                                                 ::disabled="issueDraft.busy">{{ __('Issue anlegen') }}</flux:button>
                                                    <flux:button size="sm" variant="ghost"
                                                                 x-on:click="toggleIssueDraft()"
                                                                 ::disabled="issueDraft.busy">{{ __('Abbrechen') }}</flux:button>
                                                    <span x-show="issueDraft.busy" x-cloak role="status"
                                                          class="text-xs text-muted">{{ __('Wird gesendet …') }}</span>
                                                </div>
                                            </div>
                                        </template>
                                    </div>
                                </template>

                                <template x-if="!canWrite()">
                                    <p class="text-xs text-muted" data-forge-write-hint x-text="writeHint()"></p>
                                </template>

                                @include('group::partials.forge-wake-notice', [
                                    'target' => "'issue'",
                                    'label' => 'issue',
                                ])

                                {{-- Ein Issue, das der Relay abgelehnt hat. welshman
                                     nimmt die Herkunft des Ereignisses bei einem
                                     Fehlschlag wieder weg (`tracker.removeRelay`) —
                                     die optimistische Zeile verschwände sonst
                                     LAUTLOS, und „war da, ist weg" ist von „hat nie
                                     funktioniert" nicht zu unterscheiden. --}}
                                <template x-for="row in failedIssues()" :key="row.id">
                                    <div role="alert" data-forge-write-failed="issue"
                                         class="flex items-start gap-2 rounded-tile border border-red-500/40 bg-red-500/5 px-3 py-2 text-xs text-red-600 dark:text-red-400">
                                        <flux:icon.exclamation-triangle class="mt-0.5 size-4 shrink-0" />
                                        <span class="min-w-0 flex-1">
                                            <span class="font-semibold" x-text="row.label"></span>
                                            <span x-text="' — ' + row.error"></span>
                                        </span>
                                        <button type="button" x-on:click="dismiss(row.id)"
                                                class="shrink-0 font-medium underline">{{ __('Verwerfen') }}</button>
                                    </div>
                                </template>
                            </div>

                            <template x-if="view.issues.length === 0">
                                <div class="surface-card empty-state px-6 py-12 text-center" data-forge-empty="issues">
                                    <span class="mx-auto flex size-12 items-center justify-center rounded-tile bg-zinc-100 dark:bg-zinc-800">
                                        <flux:icon.exclamation-circle class="size-6 text-zinc-500 dark:text-zinc-400" />
                                    </span>
                                    <flux:heading class="mt-4">{{ __('Noch keine Issues.') }}</flux:heading>
                                    <flux:text class="mx-auto mt-1.5 max-w-sm text-sm text-muted">{{ __('Sobald jemand ein Issue eröffnet, erscheint es hier.') }}</flux:text>
                                </div>
                            </template>

                            <ul x-show="view.issues.length > 0" class="surface-card">
                                <template x-for="issue in view.issues" :key="issue.id">
                                    <li class="border-b border-zinc-200 last:border-b-0 dark:border-zinc-800" data-forge-issue :data-status="issue.status" :data-id="issue.id">
                                        {{-- Die ganze Zeile schaltet den Rumpf auf. Ein
                                             `button` und kein `div` mit Klick-Handler:
                                             sie ist mit der Tastatur erreichbar und
                                             meldet ihren Zustand.

                                             GENAU EIN `button` je Zeile — die aufgeklappte
                                             Fläche darunter ist für P8 („Kommentieren",
                                             „Status setzen") vorgesehen, und deren Knöpfe
                                             gehören in den Rumpf, nicht in die Kopfzeile.
                                             Ein zweiter Knopf HIER machte aus dem
                                             `getByRole('button')` der E2E-Spec einen
                                             Strict-Mode-Treffer auf zwei Elemente. --}}
                                        <button type="button" class="pressable flex w-full flex-wrap items-start gap-3 p-4 text-start"
                                                x-on:click="toggle(issue.id)" :aria-expanded="open[issue.id] ? 'true' : 'false'">
                                            {{-- Der Statusknoten: GEFÜLLT heißt offen, ein
                                                 Ring heißt erledigt. Er ersetzt das immer
                                                 gleiche Ausrufezeichen, das in einer Liste
                                                 aus Issues nichts unterschied. Die Form
                                                 trägt die Aussage, nicht die Farbe (WCAG
                                                 1.4.1) — und daneben steht sie ohnehin als
                                                 Wort. Gemessen: zinc-900 auf Weiß 17,93:1,
                                                 der Ring in zinc-500 4,74:1 (hell) bzw.
                                                 zinc-400 auf zinc-900 7,11:1 (dunkel), also
                                                 über den 3:1 aus WCAG 1.4.11. --}}
                                            <span aria-hidden="true" class="mt-1 flex size-4 shrink-0 items-center justify-center">
                                                <span class="size-2.5 rounded-full"
                                                      :class="issue.status === 'open'
                                                          ? 'bg-zinc-900 dark:bg-zinc-100'
                                                          : 'ring-[1.5px] ring-zinc-500 dark:ring-zinc-400'"></span>
                                            </span>
                                            <span class="min-w-0 flex-1">
                                                <span class="block font-semibold leading-snug" x-text="issue.title || @js(__('Ohne Titel'))"></span>
                                                <span class="mt-1 block text-xs text-muted">
                                                    <span x-text="issue.authorName"></span>
                                                    <span x-text="' · ' + issue.timeLabel"></span>
                                                </span>
                                                <template x-if="issue.labels.length > 0">
                                                    <span class="mt-1.5 flex flex-wrap gap-1">
                                                        <template x-for="label in issue.labels.slice(0, 6)" :key="label">
                                                            <span class="rounded-pill bg-zinc-100 px-2 py-0.5 text-[0.7rem] text-muted dark:bg-zinc-800" x-text="label"></span>
                                                        </template>
                                                    </span>
                                                </template>
                                            </span>
                                            {{-- Auf schmalen Schirmen eine EIGENE Zeile
                                                 (`basis-full`), erst ab `sm` wieder rechts
                                                 neben dem Titel.

                                                 Vorher stand sie dort immer, `shrink-0`
                                                 neben einem `flex-1`-Titel — und
                                                 „GESCHLOSSEN" samt Commit-Kurzform und
                                                 Zähler nahm auf einem 390-px-Schirm gut
                                                 die halbe Breite. Ein vierzeiliger Umbruch
                                                 eines Titels, der in zwei gepasst hätte,
                                                 am Gerät gesehen (2026-08-20).

                                                 `ps-7` setzt sie unter den Titel statt
                                                 unter den Statuspunkt: 16 px Punkt + 12 px
                                                 Abstand. --}}
                                            <span class="flex shrink-0 basis-full items-center gap-2.5 ps-7 sm:basis-auto sm:ps-0">
                                                {{-- Der optimistische Eintrag sagt, dass er noch
                                                     unterwegs ist. Ein `span` INNERHALB des
                                                     bestehenden Knopfes, kein zweiter Knopf. --}}
                                                <template x-if="rowState(issue.id) === 'sending'">
                                                    <span data-forge-row-state="sending"
                                                          class="text-[0.7rem] font-semibold uppercase tracking-wider text-muted">{{ __('Wird gesendet …') }}</span>
                                                </template>
                                                <span class="text-[0.7rem] font-semibold uppercase tracking-wider"
                                                      :class="issue.status === 'open' ? 'text-forge-offen' : 'text-forge-ruhend'"
                                                      x-text="statusText(issue.status)"></span>
                                                <template x-if="issue.commentCount > 0">
                                                    <span class="inline-flex items-center gap-1 text-xs text-muted">
                                                        <flux:icon.chat-bubble-left-ellipsis variant="micro" class="size-4" />
                                                        <span x-text="issue.commentCount"></span>
                                                    </span>
                                                </template>
                                            </span>
                                        </button>

                                        <template x-if="open[issue.id]">
                                            <div class="border-t border-zinc-200 px-4 py-3 dark:border-zinc-800">
                                                {{-- `x-html` ist hier bewusst gesetzt. Der
                                                     Wert kommt AUSSCHLIESSLICH aus
                                                     `renderArticleHtml` (`js/longform.ts`),
                                                     also aus markdown-it mit `html: false`:
                                                     roher HTML-Text des Autors ist dort
                                                     bereits zu Entities geworden,
                                                     `javascript:`-Links sind gar nicht erst
                                                     zu Ankern geworden. Solange der
                                                     Renderer-Chunk noch lädt, ist `html`
                                                     leer und der Rohtext steht daneben —
                                                     als TEXT, nie als HTML. --}}
                                                <div x-show="issue.html" class="article-content forge-mass" x-html="issue.html"></div>
                                                <p x-show="!issue.html" class="whitespace-pre-wrap text-sm" x-text="issue.content"></p>

                                                <template x-if="issue.comments.length > 0">
                                                    <ul class="mt-3 space-y-2">
                                                        <template x-for="comment in issue.comments" :key="comment.id">
                                                            <li class="rounded-tile bg-zinc-100 p-3 dark:bg-zinc-800"
                                                                :class="rowState(comment.id) === 'sending' ? 'opacity-60' : ''">
                                                                <p class="text-xs text-muted">
                                                                    <span class="font-medium" x-text="comment.authorName"></span>
                                                                    <span x-text="' · ' + comment.timeLabel"></span>
                                                                    <template x-if="rowState(comment.id) === 'sending'">
                                                                        <span data-forge-row-state="sending"
                                                                              class="ms-1 font-semibold uppercase tracking-wider">{{ __('Wird gesendet …') }}</span>
                                                                    </template>
                                                                </p>
                                                                <div x-show="comment.html" class="article-content forge-mass mt-1" x-html="comment.html"></div>
                                                            </li>
                                                        </template>
                                                    </ul>
                                                </template>

                                                {{-- ── Gescheiterte Schreibversuche an DIESEM Issue ──
                                                     Kommentar wie Statuswechsel. Der Statuswechsel
                                                     hat nie eine eigene Zeile in der Liste — er
                                                     wirkt auf die vorhandene —, deshalb ist das
                                                     hier der einzige Ort, an dem sein Scheitern
                                                     überhaupt sichtbar werden kann. --}}
                                                <template x-for="row in failedFor(issue.id)" :key="row.id">
                                                    <div role="alert" data-forge-write-failed="root"
                                                         class="mt-3 flex items-start gap-2 rounded-tile border border-red-500/40 bg-red-500/5 px-3 py-2 text-xs text-red-600 dark:text-red-400">
                                                        <flux:icon.exclamation-triangle class="mt-0.5 size-4 shrink-0" />
                                                        <span class="min-w-0 flex-1">
                                                            <span class="font-semibold" x-text="row.label"></span>
                                                            <span x-text="(row.label ? ' — ' : '') + row.error"></span>
                                                        </span>
                                                        <button type="button" x-on:click="dismiss(row.id)"
                                                                class="shrink-0 font-medium underline">{{ __('Verwerfen') }}</button>
                                                    </div>
                                                </template>

                                                {{-- ── Status setzen (P8) ────────────────────────
                                                     Der Riegel ist NICHT kosmetisch: der Relay
                                                     nimmt ein 1630–1633 von jedem an (am Teststack
                                                     gemessen), angezeigt wird aber nur, was
                                                     `foldStatus` durchlässt — der Autor der Wurzel
                                                     und der Eigentümer des Repos. Ein Knopf für
                                                     alle anderen schriebe ein Ereignis, das kein
                                                     Client je zeigt: ein stiller Leerlauf. --}}
                                                <div class="mt-3 border-t border-zinc-200 pt-3 dark:border-zinc-800">
                                                    <template x-if="canSetStatus(issue)">
                                                        <div class="flex flex-wrap items-center gap-2" data-forge-status-actions>
                                                            <span class="text-[0.7rem] font-semibold uppercase tracking-wider text-muted">{{ __('Status setzen') }}</span>
                                                            <template x-for="opt in statusOptions()" :key="opt.code">
                                                                <flux:button size="xs" variant="ghost"
                                                                             x-on:click="setStatus(issue, opt.code)"
                                                                             ::disabled="statusBusy(issue.id) || issue.status === opt.code"
                                                                             ::data-forge-status-option="opt.code">
                                                                    <span x-text="opt.label"></span>
                                                                </flux:button>
                                                            </template>
                                                            <span x-show="statusBusy(issue.id)" x-cloak role="status"
                                                                  class="text-xs text-muted">{{ __('Wird gesendet …') }}</span>
                                                        </div>
                                                    </template>
                                                    <template x-if="!canSetStatus(issue)">
                                                        <p class="text-xs text-muted" data-forge-status-hint x-text="statusHint(issue)"></p>
                                                    </template>
                                                </div>

                                                {{-- ── Kommentieren (P8) ───────────────────────── --}}
                                                <div class="mt-3 border-t border-zinc-200 pt-3 dark:border-zinc-800">
                                                    <template x-if="canWrite()">
                                                        <div class="space-y-2" data-forge-comment-form>
                                                            {{-- @-Erwähnung (P9). Das Ziel des Vorschlags heißt
                                                                 `comment:<wurzel-id>` und steht erst zur Laufzeit
                                                                 fest — deshalb ein Ausdruck und kein fester Wert. --}}
                                                            <div class="relative">
                                                                <flux:textarea label="{{ __('Kommentar') }}" rows="2"
                                                                               x-model="commentDraft[issue.id]"
                                                                               ::data-forge-composer="'comment:' + issue.id"
                                                                               x-on:input="onComposerInput($event.target, 'comment:' + issue.id)"
                                                                               x-on:keydown="mentionKey($event)"
                                                                               placeholder="{{ __('Antwort schreiben … @ erwähnt jemanden.') }}" />
                                                                @include('group::partials.forge-mention-popover', [
                                                                    'targetExpr' => "'comment:' + issue.id",
                                                                    'targetLabel' => 'comment',
                                                                ])
                                                            </div>
                                                            <div x-show="commentError[issue.id]" x-cloak role="alert" data-forge-comment-error
                                                                 class="flex items-start gap-2 rounded-tile border border-red-500/40 bg-red-500/5 px-3 py-2 text-xs text-red-600 dark:text-red-400">
                                                                <flux:icon.exclamation-triangle class="mt-0.5 size-4 shrink-0" />
                                                                <span x-text="commentError[issue.id]"></span>
                                                            </div>
                                                            <div class="flex flex-wrap items-center gap-2">
                                                                <flux:button size="xs" variant="primary"
                                                                             x-on:click="submitComment(issue, 'issue')"
                                                                             ::disabled="commentBusy(issue.id)">{{ __('Kommentieren') }}</flux:button>
                                                                <span x-show="commentBusy(issue.id)" x-cloak role="status"
                                                                      class="text-xs text-muted">{{ __('Wird gesendet …') }}</span>
                                                            </div>
                                                            @include('group::partials.forge-wake-notice', [
                                                                'target' => "'comment:' + issue.id",
                                                                'label' => 'comment',
                                                            ])
                                                        </div>
                                                    </template>
                                                    <template x-if="!canWrite()">
                                                        <p class="text-xs text-muted" data-forge-write-hint x-text="writeHint()"></p>
                                                    </template>
                                                </div>
                                            </div>
                                        </template>
                                    </li>
                                </template>
                            </ul>
                        </div>

                        {{-- ── Pull Requests ────────────────────────────────────── --}}
                        <div x-show="tab === 'pulls'" x-cloak>
                            <template x-if="view.pullRequests.length === 0">
                                <div class="surface-card empty-state px-6 py-12 text-center" data-forge-empty="pulls">
                                    <span class="mx-auto flex size-12 items-center justify-center rounded-tile bg-zinc-100 dark:bg-zinc-800">
                                        <flux:icon.arrows-right-left class="size-6 text-zinc-500 dark:text-zinc-400" />
                                    </span>
                                    <flux:heading class="mt-4">{{ __('Noch keine Pull Requests.') }}</flux:heading>
                                    <flux:text class="mx-auto mt-1.5 max-w-sm text-sm text-muted">{{ __('Sobald jemand einen Pull Request eröffnet, erscheint er hier.') }}</flux:text>
                                </div>
                            </template>

                            <ul x-show="view.pullRequests.length > 0" class="surface-card">
                                <template x-for="pr in view.pullRequests" :key="pr.id">
                                    <li class="border-b border-zinc-200 last:border-b-0 dark:border-zinc-800" data-forge-pr :data-status="pr.status" :data-id="pr.id">
                                        <button type="button" class="pressable flex w-full flex-wrap items-start gap-3 p-4 text-start"
                                                x-on:click="toggle(pr.id)" :aria-expanded="open[pr.id] ? 'true' : 'false'">
                                            {{-- Derselbe Statusknoten wie bei den Issues:
                                                 gefüllt = offen, Ring = zusammengeführt oder
                                                 geschlossen. Ein Zeichen, eine Bedeutung —
                                                 über beide Listen hinweg. --}}
                                            <span aria-hidden="true" class="mt-1 flex size-4 shrink-0 items-center justify-center">
                                                <span class="size-2.5 rounded-full"
                                                      :class="pr.status === 'open'
                                                          ? 'bg-zinc-900 dark:bg-zinc-100'
                                                          : 'ring-[1.5px] ring-zinc-500 dark:ring-zinc-400'"></span>
                                            </span>
                                            <span class="min-w-0 flex-1">
                                                <span class="block font-semibold leading-snug" x-text="pr.title || @js(__('Ohne Titel'))"></span>
                                                {{-- Ein ganzer Satz, kein Feldsalat: wer
                                                     hat ihn eröffnet, und aus welchem
                                                     Branch. Die Teile stehen als
                                                     Platzhalter im Katalog, damit der Satz
                                                     übersetzbar bleibt. --}}
                                                <span class="mt-1 block text-xs text-muted"
                                                      x-text="(pr.branch
                                                          ? @js(__(':name hat ihn eröffnet aus :branch.')).split(':branch').join(pr.branch)
                                                          : @js(__(':name hat ihn eröffnet.'))).split(':name').join(pr.authorName)
                                                          + ' · ' + pr.timeLabel"></span>
                                            </span>
                                            {{-- Auf schmalen Schirmen eine EIGENE Zeile
                                                 (`basis-full`), erst ab `sm` wieder rechts
                                                 neben dem Titel.

                                                 Vorher stand sie dort immer, `shrink-0`
                                                 neben einem `flex-1`-Titel — und
                                                 „GESCHLOSSEN" samt Commit-Kurzform und
                                                 Zähler nahm auf einem 390-px-Schirm gut
                                                 die halbe Breite. Ein vierzeiliger Umbruch
                                                 eines Titels, der in zwei gepasst hätte,
                                                 am Gerät gesehen (2026-08-20).

                                                 `ps-7` setzt sie unter den Titel statt
                                                 unter den Statuspunkt: 16 px Punkt + 12 px
                                                 Abstand. --}}
                                            <span class="flex shrink-0 basis-full items-center gap-2.5 ps-7 sm:basis-auto sm:ps-0">
                                                <template x-if="pr.shortCommit">
                                                    <span class="rounded-pill bg-brand-500/10 px-2 py-0.5 text-xs font-semibold tracking-tight text-brand-800 dark:text-brand-300"
                                                          x-text="pr.shortCommit"></span>
                                                </template>
                                                <span class="text-[0.7rem] font-semibold uppercase tracking-wider"
                                                      :class="pr.status === 'open' ? 'text-forge-offen' : (pr.status === 'applied' || pr.status === 'merged' ? 'text-forge-erledigt' : 'text-forge-ruhend')"
                                                      x-text="statusText(pr.status)"></span>
                                                <template x-if="pr.commentCount > 0">
                                                    <span class="inline-flex items-center gap-1 text-xs text-muted">
                                                        <flux:icon.chat-bubble-left-ellipsis variant="micro" class="size-4" />
                                                        <span x-text="pr.commentCount"></span>
                                                    </span>
                                                </template>
                                            </span>
                                        </button>

                                        <template x-if="open[pr.id]">
                                            <div class="border-t border-zinc-200 px-4 py-3 dark:border-zinc-800">
                                                <div x-show="pr.html" class="article-content forge-mass" x-html="pr.html"></div>
                                                <p x-show="!pr.html" class="whitespace-pre-wrap text-sm" x-text="pr.content"></p>

                                                <template x-if="pr.updates.length > 0">
                                                    <ul class="mt-3 space-y-1">
                                                        <template x-for="update in pr.updates" :key="update.id">
                                                            {{-- Kein `font-mono`: die App IST durchgehend
                                                                 Inconsolata (`--font-sans` in `theme.css`),
                                                                 aber `--font-mono` überschreibt das Theme
                                                                 NICHT — die Klasse landet auf Tailwinds
                                                                 Default-Stack und setzte den Hash damit in
                                                                 eine zweite, fremde Schrift. --}}
                                                            <li class="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
                                                                <flux:icon.arrow-path variant="micro" class="size-3.5 shrink-0" />
                                                                <span x-text="update.authorName"></span>
                                                                <span x-text="update.timeLabel"></span>
                                                                <template x-if="update.shortCommit">
                                                                    <span class="rounded-pill bg-brand-500/10 px-1.5 py-0.5 font-semibold tracking-tight text-brand-800 dark:text-brand-300"
                                                                          x-text="update.shortCommit"></span>
                                                                </template>
                                                            </li>
                                                        </template>
                                                    </ul>
                                                </template>

                                                <template x-if="pr.comments.length > 0">
                                                    <ul class="mt-3 space-y-2">
                                                        <template x-for="comment in pr.comments" :key="comment.id">
                                                            <li class="rounded-tile bg-zinc-100 p-3 dark:bg-zinc-800"
                                                                :class="rowState(comment.id) === 'sending' ? 'opacity-60' : ''">
                                                                <p class="text-xs text-muted">
                                                                    <span class="font-medium" x-text="comment.authorName"></span>
                                                                    <span x-text="' · ' + comment.timeLabel"></span>
                                                                    <template x-if="rowState(comment.id) === 'sending'">
                                                                        <span data-forge-row-state="sending"
                                                                              class="ms-1 font-semibold uppercase tracking-wider">{{ __('Wird gesendet …') }}</span>
                                                                    </template>
                                                                </p>
                                                                <div x-show="comment.html" class="article-content forge-mass mt-1" x-html="comment.html"></div>
                                                            </li>
                                                        </template>
                                                    </ul>
                                                </template>

                                                <template x-for="row in failedFor(pr.id)" :key="row.id">
                                                    <div role="alert" data-forge-write-failed="root"
                                                         class="mt-3 flex items-start gap-2 rounded-tile border border-red-500/40 bg-red-500/5 px-3 py-2 text-xs text-red-600 dark:text-red-400">
                                                        <flux:icon.exclamation-triangle class="mt-0.5 size-4 shrink-0" />
                                                        <span class="min-w-0 flex-1">
                                                            <span class="font-semibold" x-text="row.label"></span>
                                                            <span x-text="(row.label ? ' — ' : '') + row.error"></span>
                                                        </span>
                                                        <button type="button" x-on:click="dismiss(row.id)"
                                                                class="shrink-0 font-medium underline">{{ __('Verwerfen') }}</button>
                                                    </div>
                                                </template>

                                                {{-- ── Kommentieren (P8) ─────────────────────────
                                                     **Nur kommentieren, nicht anlegen.** Ein Pull
                                                     Request setzt einen gepushten Branch voraus;
                                                     ein Browser-Client hat kein Git und könnte
                                                     dessen `c`-Commit nur erfinden. Ein „Neuer
                                                     Pull Request"-Knopf wäre hier also eine
                                                     Attrappe — den Statuswechsel eines PR
                                                     verantwortet aus demselben Grund, wer ihn
                                                     gepusht hat, nicht diese Fläche. --}}
                                                <div class="mt-3 border-t border-zinc-200 pt-3 dark:border-zinc-800">
                                                    <template x-if="canWrite()">
                                                        <div class="space-y-2" data-forge-comment-form>
                                                            {{-- @-Erwähnung (P9). Das Ziel des Vorschlags heißt
                                                                 `comment:<wurzel-id>` und steht erst zur Laufzeit
                                                                 fest — deshalb ein Ausdruck und kein fester Wert. --}}
                                                            <div class="relative">
                                                                <flux:textarea label="{{ __('Kommentar') }}" rows="2"
                                                                               x-model="commentDraft[pr.id]"
                                                                               ::data-forge-composer="'comment:' + pr.id"
                                                                               x-on:input="onComposerInput($event.target, 'comment:' + pr.id)"
                                                                               x-on:keydown="mentionKey($event)"
                                                                               placeholder="{{ __('Antwort schreiben … @ erwähnt jemanden.') }}" />
                                                                @include('group::partials.forge-mention-popover', [
                                                                    'targetExpr' => "'comment:' + pr.id",
                                                                    'targetLabel' => 'comment',
                                                                ])
                                                            </div>
                                                            <div x-show="commentError[pr.id]" x-cloak role="alert" data-forge-comment-error
                                                                 class="flex items-start gap-2 rounded-tile border border-red-500/40 bg-red-500/5 px-3 py-2 text-xs text-red-600 dark:text-red-400">
                                                                <flux:icon.exclamation-triangle class="mt-0.5 size-4 shrink-0" />
                                                                <span x-text="commentError[pr.id]"></span>
                                                            </div>
                                                            <div class="flex flex-wrap items-center gap-2">
                                                                <flux:button size="xs" variant="primary"
                                                                             x-on:click="submitComment(pr, 'pr')"
                                                                             ::disabled="commentBusy(pr.id)">{{ __('Kommentieren') }}</flux:button>
                                                                <span x-show="commentBusy(pr.id)" x-cloak role="status"
                                                                      class="text-xs text-muted">{{ __('Wird gesendet …') }}</span>
                                                            </div>
                                                            @include('group::partials.forge-wake-notice', [
                                                                'target' => "'comment:' + pr.id",
                                                                'label' => 'comment',
                                                            ])
                                                        </div>
                                                    </template>
                                                    <template x-if="!canWrite()">
                                                        <p class="text-xs text-muted" data-forge-write-hint x-text="writeHint()"></p>
                                                    </template>
                                                </div>
                                            </div>
                                        </template>
                                    </li>
                                </template>
                            </ul>
                        </div>

                        {{-- ── Aktivität ────────────────────────────────────────── --}}
                        <div x-show="tab === 'activity'" x-cloak>
                            <template x-if="view.activityGroups.length === 0">
                                <div class="surface-card empty-state px-6 py-12 text-center" data-forge-empty="activity">
                                    <span class="mx-auto flex size-12 items-center justify-center rounded-tile bg-zinc-100 dark:bg-zinc-800">
                                        <flux:icon.clock class="size-6 text-zinc-500 dark:text-zinc-400" />
                                    </span>
                                    <flux:heading class="mt-4">{{ __('Noch keine Aktivität.') }}</flux:heading>
                                    <flux:text class="mx-auto mt-1.5 max-w-sm text-sm text-muted">{{ __('Sobald jemand etwas pusht oder ein Issue eröffnet, erscheint es hier.') }}</flux:text>
                                </div>
                            </template>

                            {{-- Dieselbe Ref-Spur wie auf der Übersicht — Begründung der
                                 Geometrie und der `:last-child`-Kante steht dort
                                 ausführlich (`⚡forge.blade.php`, Abschnitt „Die
                                 Ref-Spur"). Zwei Zeitleisten im selben Produkt dürfen
                                 nicht zwei Bauformen haben.

                                 Das gilt auch für die Tages-Trenner: dieselben vier
                                 Buckets, dieselben Wörter, dasselbe <h2>. Der einzige
                                 Unterschied zur Übersicht ist, dass hier KEIN Repo-Name
                                 in der Zeile steht — er ist für alle Zeilen derselbe
                                 und steht bereits im Seitenkopf. --}}
                            <div x-show="view.activityGroups.length > 0" class="surface-card px-4 pb-2">
                                <template x-for="bucket in view.activityGroups" :key="bucket.label">
                                    <section>
                                        <h2 class="pb-1 pt-4 text-[0.7rem] font-semibold uppercase tracking-wider text-muted"
                                            x-text="bucket.label"></h2>
                                        <ol>
                                            <template x-for="row in bucket.items" :key="row.id">
                                                <li class="group relative flex gap-3 py-3" data-forge-activity :data-type="row.type">
                                                    <span aria-hidden="true"
                                                          class="absolute start-[0.875rem] top-[1.625rem] h-full w-px bg-zinc-200 group-last:hidden dark:bg-zinc-800"></span>
                                                    {{-- `self-start`: siehe Begründung in
                                                         `⚡forge.blade.php` — ohne sie streckt sich die
                                                         Hülle auf die Zeilenhöhe, der Ring wird oval
                                                         und die Unterlage frisst den Faden. --}}
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
                                                        <p class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
                                                            {{-- KURZ in der Zeile, VOLL im Tooltip —
                                                                 Begründung in `⚡forge.blade.php`. --}}
                                                            <span x-text="row.timeLabel" x-bind:title="row.fullLabel"></span>
                                                            <template x-if="row.badge">
                                                                <span class="rounded-pill bg-brand-500/10 px-1.5 py-0.5 font-semibold tracking-tight text-brand-800 dark:text-brand-300"
                                                                      x-text="row.badge"></span>
                                                            </template>
                                                            <template x-if="row.statusLabel">
                                                                <span class="rounded-pill bg-zinc-100 px-1.5 py-0.5 font-medium dark:bg-zinc-800"
                                                                      x-text="row.statusLabel"></span>
                                                            </template>
                                                        </p>
                                                        <template x-if="row.body">
                                                            <p class="forge-mass mt-1.5 line-clamp-2 text-sm text-zinc-700 dark:text-zinc-300" x-text="row.body"></p>
                                                        </template>
                                                    </div>
                                                </li>
                                            </template>
                                        </ol>
                                    </section>
                                </template>
                            </div>
                        </div>
                    </div>
                </template>
            </div>
        @endif
    </div>

</x-group::app-shell>
