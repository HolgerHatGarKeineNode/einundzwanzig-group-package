{{-- Trefferliste der Workspace-Suche (P5, NIP-50).

     ── Warum sie AUSSERHALB von `flux:command.items` steht ──────────────────
     `flux:command` ist ein `<ui-select filter>`, und dieser Filter blendet jede
     `ui-option` aus, deren `textContent` den Suchtext nicht als Teilzeichenkette
     enthält. Genau das dürfen Relay-Treffer nicht durchlaufen: Postgres stemmt
     („meetups" findet „Meetup"), Flux' Teilzeichenkette nicht — die Zeile
     verschwände wieder, nachdem der Relay sie zu Recht geliefert hat. Es ist
     derselbe Fehler wie welshmans `matchFilters` (siehe `js/spaceSearch.ts`),
     nur eine Ebene höher.

     Zweite Folge derselben Bauart: hier entsteht KEINE `ui-option`. Ohne aktive
     Option kehrt Flux' Enter-Handler sofort zurück, und `onEnter()` am Feld
     löst die Suche aus, statt in den erstbesten Raum zu springen (die
     Begründung im Ganzen steht bei `visibleSections` in `js/paletteItems.ts`).
     Navigiert wird deshalb per Tab und Klick/Enter auf echten Knöpfen.

     ── Was diese Fläche unterscheidbar machen muss ──────────────────────────
     Zwei Quellen mit verschiedenen Eigenschaften stehen untereinander:
     „Sofort" kommt aus dem geladenen Bestand (findet Teilwörter, aber nur, was
     schon da ist), „Am Relay gefunden" kommt vom Relay (findet den ganzen
     Bestand, aber nur ganze Wörter). Wer das nicht sieht, hält die eine Hälfte
     für kaputt. Deshalb tragen beide Blöcke eine Überschrift MIT ihrer
     Einschränkung, nicht nur einen Namen. --}}

@php($ws = 'flex w-full items-center gap-2 rounded-lg px-2 py-2 text-start text-sm hover:bg-zinc-100 focus-visible:bg-zinc-100 focus-visible:outline-none dark:hover:bg-zinc-800 dark:focus-visible:bg-zinc-800')
@php($headStyle = 'px-2 pt-3 pb-1 text-[0.6875rem] font-semibold uppercase tracking-wider text-muted')

<template x-if="workspaceActive">
    <div data-space-search
         class="min-h-0 flex-1 overflow-y-auto border-t border-zinc-200 bg-white px-1 pb-2 dark:border-zinc-800 dark:bg-zinc-900 sm:max-h-[52dvh] sm:flex-none">

        {{-- Dreiwertiges Gating (P1): `unknown` ist ein eigener Zustand. Hier
             hängt das Skeleton, und es entscheidet NICHTS — weder „kann NIP-50"
             noch „kann es nicht". --}}
        <template x-if="spaceKind === 'unknown'">
            <div data-space-search-skeleton role="status" aria-live="polite" class="space-y-2 px-2 py-3">
                <span class="sr-only">{{ __('Workspace wird geprüft…') }}</span>
                <div class="h-3 w-1/3 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800"></div>
                <div class="h-3 w-2/3 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800"></div>
            </div>
        </template>

        {{-- Nach allen Versuchen kein Buzz-Relay (oder gar keine Antwort). Ein
             sichtbarer Hinweis statt eines ewig drehenden Skeletons. --}}
        <template x-if="spaceKind === 'other'">
            <p data-space-search-unsupported class="px-2 py-3 text-sm text-muted">
                {{ __('Dieser Workspace beantwortet keine Volltextsuche. Die Sofort-Treffer unten stammen aus dem bereits geladenen Bestand.') }}
            </p>
        </template>

        {{-- ── Sofort-Treffer ────────────────────────────────────────────────
             Ohne Netz, bei jedem Tastendruck. Sie sind der Grund, warum das
             fehlende Typeahead des Relays nicht wie ein Defekt wirkt. --}}
        <template x-if="query.trim() !== '' && instantHits.length > 0">
            <div>
                <div class="{{ $headStyle }}">{{ __('Sofort — aus dem geladenen Bestand') }}</div>
                <template x-for="hit in instantHits" :key="'instant:' + hit.id">
                    <button type="button" data-space-search-instant
                            x-bind:data-kind="hit.sort"
                            x-on:click="openInstant(hit)"
                            class="{{ $ws }}">
                        <span aria-hidden="true" class="w-[1ch] shrink-0 text-center font-mono text-xs text-muted"
                              x-text="hit.sort === 'room' ? '#' : '›'"></span>
                        <span class="min-w-0 flex-1">
                            <span class="block truncate font-medium">
                                <template x-for="(part, i) in hit.nameSegments" :key="'n' + i">
                                    <span x-text="part.text" x-bind:class="part.hit ? 'bg-brand-500/25 rounded-sm' : ''"></span>
                                </template>
                            </span>
                            <span class="block truncate text-[0.7rem] text-muted">
                                <template x-for="(part, i) in hit.segments" :key="'s' + i">
                                    <span x-text="part.text" x-bind:class="part.hit ? 'bg-brand-500/25 rounded-sm' : ''"></span>
                                </template>
                            </span>
                        </span>
                    </button>
                </template>
            </div>
        </template>

        {{-- ── Relay-Treffer ─────────────────────────────────────────────────
             Fünf Zustände, und sie sind bewusst nicht auf zwei zusammengelegt:
             „noch nicht gesucht", „läuft", „abgelehnt", „unvollständig" und
             „fertig". Besonders die letzten beiden auseinanderzuhalten ist der
             Punkt — „keine Treffer" darf nicht dastehen, wenn in Wahrheit
             niemand geantwortet hat. --}}
        <div class="{{ $headStyle }}">{{ __('Am Relay gefunden — ganze Wörter') }}</div>

        <template x-if="!searchRan && !searching">
            <p data-space-search-idle class="px-2 pb-2 text-[0.75rem] text-muted">
                {{ __('Mit ↵ den ganzen Workspace durchsuchen. Der Relay findet ganze Wörter, keine Wortanfänge — „meetup“ statt „meet“.') }}
            </p>
        </template>

        <template x-if="searching">
            <p data-space-search-busy role="status" aria-live="polite" class="px-2 pb-2 text-[0.75rem] text-muted">
                {{ __('Wird am Relay gesucht…') }}
            </p>
        </template>

        {{-- Eine Ablehnung wird angezeigt, nicht verschluckt: `request({onClosed})`
             liefert den Originaltext des Relays, und der steht hier — ohne eine
             Ursache zu erfinden, die wir nicht kennen. --}}
        <template x-if="searchRejected !== null">
            <p data-space-search-rejected role="alert"
               class="mx-2 mb-2 rounded-lg bg-red-500/10 px-2 py-1.5 text-[0.75rem] text-red-700 dark:text-red-300">
                <span>{{ __('Der Relay hat die Suche abgelehnt:') }}</span>
                <span class="font-mono" x-text="searchRejected"></span>
            </p>
        </template>

        <template x-if="!searching && searchRan && searchRejected === null && !searchComplete">
            <p data-space-search-incomplete role="status"
               class="px-2 pb-2 text-[0.75rem] text-muted">
                {{ __('Der Relay hat nicht vollständig geantwortet — das Ergebnis kann unvollständig sein. Mit ↵ erneut versuchen.') }}
            </p>
        </template>

        <template x-if="!searching && searchRan && searchComplete && searchHitCount === 0">
            <p data-space-search-empty role="status" class="px-2 pb-2 text-[0.75rem] text-muted">
                {{ __('Keine Treffer im Workspace.') }}
            </p>
        </template>

        {{-- Nachrichten --}}
        <template x-for="hit in searchMessages" :key="'msg:' + hit.id">
            <button type="button" data-space-search-message
                    x-bind:data-h="hit.h"
                    x-on:click="openMessageHit(hit)"
                    class="{{ $ws }}">
                <span aria-hidden="true" class="w-[1ch] shrink-0 text-center font-mono text-xs text-muted">›</span>
                <span class="min-w-0 flex-1">
                    <span class="block truncate text-[0.7rem] font-semibold text-muted" x-text="hit.name"></span>
                    <span class="block truncate">
                        <template x-for="(part, i) in hit.segments" :key="'m' + i">
                            <span x-text="part.text" x-bind:class="part.hit ? 'bg-brand-500/25 rounded-sm' : ''"></span>
                        </template>
                    </span>
                </span>
            </button>
        </template>

        {{-- Personen. Die Treffer stehen NUR hier in der Insel — ins Repository
             kommt kein kind 0 vom Workspace-Relay (`js/core.ts`), und das bleibt
             auch so: der Riegel dort wird über einen anderen Aufruf erreicht als
             der am Request (Begründung in `js/spaceSearch.ts`, Punkt 5). --}}
        <template x-if="searchPeople.length > 0">
            <div class="{{ $headStyle }}">{{ __('Personen') }}</div>
        </template>
        <template x-for="person in searchPeople" :key="'person:' + person.pubkey">
            <button type="button" data-space-search-person
                    x-bind:data-pubkey="person.pubkey"
                    x-on:click="openPersonHit(person)"
                    class="{{ $ws }}">
                <span aria-hidden="true" class="w-[1ch] shrink-0 text-center font-mono text-xs text-muted">{{ '@' }}</span>
                <span class="min-w-0 flex-1">
                    <span class="block truncate font-medium">
                        <template x-for="(part, i) in person.nameSegments" :key="'p' + i">
                            <span x-text="part.text" x-bind:class="part.hit ? 'bg-brand-500/25 rounded-sm' : ''"></span>
                        </template>
                    </span>
                </span>
            </button>
        </template>
    </div>
</template>
