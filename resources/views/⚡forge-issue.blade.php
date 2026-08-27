<?php

use Livewire\Attributes\Layout;
use Livewire\Component;

/**
 * Die Einzelansicht eines Issues (`/forge/{naddr}/issues/{id}`, GitHub-Parität P1/P2).
 *
 * Dünne Hülle nach dem Muster von `⚡forge-repo`: `$naddr` und `$id` kommen aus
 * der Route, alles Weitere läuft client-seitig in der Insel
 * (`nostrForgeVorgang`). Der Server kennt das Relay-Datum nicht (NIP-42) — der
 * Seitentitel bleibt generisch, der echte steht als `<h1>`, sobald er da ist.
 */
new #[Layout('group::einundzwanzig')] class extends Component
{
    public string $naddr = '';

    public string $id = '';

    public function mount(string $naddr, string $id): void
    {
        $this->naddr = $naddr;
        // Kleinschreibung vor der Insel: Hex ist case-insensitive, Whitelist
        // und Ableitung arbeiten durchgehend klein.
        $this->id = strtolower($id);
    }

    public function render()
    {
        return $this->view()->title(__('Issue'));
    }
}; ?>

{{-- `width="wide"` wie die Repo-Seite: der Diskussionsfaden ist Fließtext auf
     Lesemaß, aber Kopf und Sidebar brauchen die Breite — dieselbe Abwägung wie
     am Code-Tab der Repo-Seite (dort begründet an `app-shell`). --}}
<x-group::app-shell width="wide">

    <div x-data="nostrForgeVorgang(@js($naddr), 'issue', @js($id))" data-forge-einzel="issue">
    <div class="page-enter">

        @php($titelExpr = 'vorgang() ? (\'#\' + shortId() + \' \' + (vorgang().title || '.json_encode(__('Ohne Titel')).')) : '.json_encode(__('Issue')))

        {{-- Zurück auf DIESE Repo-Seite — nicht auf die Forge-Übersicht: die
             Einzelansicht ist eine Ebene UNTER dem Repo (GitHub: issue → repo).
             Die Krümelspur darunter sagt dasselbe für Fremde, die über einen
             geteilten Link landen. --}}
        <x-group::app-header :title="__('Issue')" :title-expr="$titelExpr"
                             :back="route('group.forge.repo', ['naddr' => $naddr])">
            <x-slot name="subtitle">
                <nav class="mt-1 flex items-center gap-1.5 text-xs text-muted xl:hidden"
                     aria-label="{{ __('Pfad') }}" data-forge-kruemel>
                    <a href="{{ route('group.forge') }}" wire:navigate
                       class="pressable rounded-tile px-1 py-0.5 -mx-1 font-semibold hover:text-zinc-900 dark:hover:text-zinc-100">{{ __('Forge') }}</a>
                    <span aria-hidden="true">/</span>
                    <a :href="repoHref()" wire:navigate
                       class="pressable rounded-tile px-1 py-0.5 -mx-1 min-w-0 truncate hover:text-zinc-900 dark:hover:text-zinc-100"
                       x-text="view ? view.repo.name : ''"></a>
                    <span aria-hidden="true">/</span>
                    <span class="min-w-0 truncate" aria-current="page">{{ __('Issue') }}</span>
                </nav>
            </x-slot>
        </x-group::app-header>

        @if (! config('group.workspace_url'))
            {{-- Keine Quelle konfiguriert — dieselbe Weiche und Bauform wie auf
                 der Repo-Seite: „kein Relay" ist etwas ANDERES als „nicht gefunden". --}}
            <div class="surface-card empty-state px-6 py-12 text-center">
                <span class="mx-auto flex size-12 items-center justify-center rounded-tile bg-zinc-100 dark:bg-zinc-800">
                    <flux:icon.ticket class="size-6 text-zinc-500 dark:text-zinc-400" />
                </span>
                <flux:heading size="lg" class="mt-4">{{ __('Keine Forge-Quelle eingerichtet.') }}</flux:heading>
                <flux:text class="mx-auto mt-1 max-w-sm text-sm text-muted">{{ __('Dieser Client kennt kein Relay, auf dem Repositories liegen.') }}</flux:text>
            </div>
        @else
            {{-- Ungültige Adresse: KEIN Relay-Kontakt — die Whitelist (Hex64)
                 ist reine Formprüfung, sie steht vor dem Boot. --}}
            <template x-if="ungueltig">
                <div class="surface-card empty-state px-6 py-12 text-center" data-forge-einzel-ungueltig>
                    <span class="mx-auto flex size-12 items-center justify-center rounded-tile bg-zinc-100 dark:bg-zinc-800">
                        <flux:icon.ticket class="size-6 text-zinc-500 dark:text-zinc-400" />
                    </span>
                    <flux:heading size="lg" class="mt-4">{{ __('Diese Adresse nennt keinen Issue.') }}</flux:heading>
                    <flux:text class="mx-auto mt-1 max-w-sm text-sm text-muted">{{ __('Der Link ist unvollständig oder beschädigt — die Nummer des Issues fehlt oder hat die falsche Form.') }}</flux:text>
                    <div class="mt-4">
                        <flux:button size="sm" variant="ghost" icon="arrow-left" ::href="repoHref()" wire:navigate>{{ __('Zum Repository') }}</flux:button>
                    </div>
                </div>
            </template>

            <template x-if="error">
                <flux:callout variant="danger" icon="exclamation-triangle" class="mb-4">
                    <flux:callout.text x-text="error"></flux:callout.text>
                    <x-slot name="actions">
                        <flux:button size="sm" variant="ghost" icon="arrow-path" x-on:click="retry()">{{ __('Erneut laden') }}</flux:button>
                    </x-slot>
                </flux:callout>
            </template>

            {{-- Das Relay HAT geantwortet — Repo oder Vorgang sind nicht zu finden.
                 Zwei Sätze für zwei Gestalten (siehe `_messeMissing` in der Insel):
                 fehlt das REPO, fehlt der ganze Rahmen; fehlt nur der Vorgang,
                 geht es zurück zur Liste desselben Repos. --}}
            <template x-if="missing && !view">
                <div class="surface-card empty-state px-6 py-12 text-center" data-forge-einzel-fehlt="repo">
                    <span class="mx-auto flex size-12 items-center justify-center rounded-tile bg-zinc-100 dark:bg-zinc-800">
                        <flux:icon.code-bracket class="size-6 text-zinc-500 dark:text-zinc-400" />
                    </span>
                    <flux:heading size="lg" class="mt-4">{{ __('Dieses Repository kennt der Workspace nicht.') }}</flux:heading>
                    <flux:text class="mx-auto mt-1 max-w-sm text-sm text-muted">{{ __('Vielleicht wurde es entfernt, oder der Link zeigt auf ein anderes Relay.') }}</flux:text>
                    <div class="mt-4">
                        <flux:button size="sm" variant="ghost" icon="arrow-left" href="{{ route('group.forge') }}" wire:navigate>{{ __('Zur Forge') }}</flux:button>
                    </div>
                </div>
            </template>

            <template x-if="missing && view">
                <div class="surface-card empty-state px-6 py-12 text-center" data-forge-einzel-fehlt="vorgang">
                    <span class="mx-auto flex size-12 items-center justify-center rounded-tile bg-zinc-100 dark:bg-zinc-800">
                        <flux:icon.ticket class="size-6 text-zinc-500 dark:text-zinc-400" />
                    </span>
                    <flux:heading size="lg" class="mt-4">{{ __('Diesen Issue gibt es nicht (mehr).') }}</flux:heading>
                    <flux:text class="mx-auto mt-1 max-w-sm text-sm text-muted">{{ __('Vielleicht wurde er entfernt, oder der Link zeigt auf ein anderes Relay.') }}</flux:text>
                    <div class="mt-4">
                        <flux:button size="sm" variant="ghost" icon="arrow-left" ::href="repoHref()" wire:navigate>{{ __('Zum Repository') }}</flux:button>
                    </div>
                </div>
            </template>

            {{-- Lade-Skelett: Struktur der Zielfläche, solange der Relay noch
                 schweigt — dieselbe Bauform wie auf der Repo-Seite. --}}
            <template x-if="loading && !error">
                <div class="surface-card mb-4 animate-pulse p-6" aria-hidden="true" data-forge-einzel-skelett>
                    <div class="h-5 w-2/3 rounded-tile bg-zinc-200 dark:bg-zinc-700"></div>
                    <div class="mt-3 h-3 w-1/3 rounded-tile bg-zinc-100 dark:bg-zinc-800"></div>
                    <div class="mt-6 h-20 rounded-tile bg-zinc-100 dark:bg-zinc-800"></div>
                </div>
            </template>

            <div x-show="vorgangDa()" x-cloak>
                {{-- ── Kopf: Titel, Nummer, Zustand — GitHub-Form ─────────────
                     Die Überschrift ist EIN Satz mit zwei Gewichten: Titel
                     getragen, `#kurz` als Verweis auf dasselbe in grau. KEINE
                     fortlaufende Nummer — NIP-34 zählt nicht, und ein
                     erfundener Zähler loge über Daten, die der Relay ändert
                     (Kürzungsmuster `shortCommit`, sieben Stellen). --}}
                <div class="xl:grid xl:grid-cols-[minmax(0,1fr)_18rem] xl:items-start xl:gap-8" data-forge-einzel-blatt>
                    <div class="min-w-0">

                        <h1 class="flex flex-wrap items-center gap-x-2 gap-y-1 text-xl font-semibold text-zinc-900 md:text-2xl dark:text-zinc-100"
                            data-forge-einzel-titel>
                            <span class="min-w-0" x-text="vorgang().title || @js(__('Ohne Titel'))"></span>
                            <span class="font-normal text-muted">#<span x-text="shortId()"></span></span>
                        </h1>

                        <div class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
                            <x-group::forge-status-badge status="vorgang().status" label="statusText(vorgang().status)" wort="immer" />
                            <p class="text-sm text-muted">
                                <span x-text="@js(__('Von :name')).split(':name').join(vorgang().authorName)"></span>
                                <span x-text="' · ' + vorgang().timeLabel"></span>
                            </p>
                            <template x-if="canCopyClone()">
                                <flux:button size="xs" variant="ghost" icon="link"
                                             data-forge-vorgang-copy x-on:click="copyVorgang()">{{ __('Link kopieren') }}</flux:button>
                            </template>
                        </div>

                        {{-- ── Der Eröffnungsbeitrag — Karte mit Kopfzeile ────
                             GitHub-Form: eine Karte, ihr Kopf nennt Menschen und
                             Zeit, ihr Rumpf trägt den Text. Kein neues
                             `forge-*`-CSS: Kopfzeile ist ein Streifen aus
                             Tailwind-Utilitys auf der `surface-card`. --}}
                        <article class="surface-card mt-4" data-forge-einzel-op>
                            <header class="flex items-center gap-2 border-b border-zinc-200 px-4 py-2.5 dark:border-zinc-800">
                                <x-group::nostr-avatar picture="vorgang().authorPicture ?? ''" name="vorgang().authorName" size="1.5rem" lazy />
                                <span class="text-sm font-semibold text-zinc-900 dark:text-zinc-100" x-text="vorgang().authorName"></span>
                                <span class="text-xs text-muted" x-text="vorgang().timeLabel"></span>
                                <template x-if="rowState(vorgang().id) === 'sending'">
                                    <span data-forge-row-state="sending"
                                          class="ms-auto text-xs font-semibold uppercase tracking-wider">{{ __('Wird gesendet …') }}</span>
                                </template>
                            </header>
                            {{-- `x-html` ist gesetzt wie auf der Repo-Seite: der Wert
                                 kommt AUSSCHLIESSLICH aus `renderArticleHtml`
                                 (markdown-it, `html: false`); Rohtext steht als
                                 Text daneben, solange der Renderer lädt. --}}
                            <div class="px-4 py-3">
                                <div x-show="vorgang().html" class="article-content forge-mass" x-html="vorgang().html"></div>
                                <p x-show="!vorgang().html" class="whitespace-pre-wrap text-sm" x-text="vorgang().content"></p>
                            </div>
                        </article>

                        {{-- ── Die Kommentare — dieselbe Kartenform wie der OP ──
                             Eine Timeline, keine Einzelkarte pro Absender: jede
                             Karte ist für sich adressierbar over den Autor. --}}
                        <template x-if="vorgang().comments.length > 0">
                            <ul class="mt-4 space-y-4" data-forge-einzel-kommentare>
                                <template x-for="comment in vorgang().comments" :key="comment.id">
                                    <li class="surface-card" :class="rowState(comment.id) === 'sending' ? 'opacity-60' : ''">
                                        <header class="flex items-center gap-2 border-b border-zinc-200 px-4 py-2.5 dark:border-zinc-800">
                                            <x-group::nostr-avatar picture="comment.authorPicture ?? ''" name="comment.authorName" size="1.5rem" lazy />
                                            <span class="text-sm font-semibold text-zinc-900 dark:text-zinc-100" x-text="comment.authorName"></span>
                                            <span class="text-xs text-muted" x-text="comment.timeLabel"></span>
                                            <template x-if="rowState(comment.id) === 'sending'">
                                                <span data-forge-row-state="sending"
                                                      class="ms-auto text-xs font-semibold uppercase tracking-wider">{{ __('Wird gesendet …') }}</span>
                                            </template>
                                        </header>
                                        <div class="px-4 py-3">
                                            <div x-show="comment.html" class="article-content forge-mass" x-html="comment.html"></div>
                                            <p x-show="!comment.html" class="whitespace-pre-wrap text-sm" x-text="comment.content"></p>
                                        </div>
                                    </li>
                                </template>
                            </ul>
                        </template>

                        {{-- Gescheiterte Schreibversuche an DIESEM Vorgang —
                             unverändert aus dem Akkordeon-Rumpf übernommen. --}}
                        <template x-for="row in failedFor(vorgang().id)" :key="row.id">
                            <flux:callout variant="danger" icon="exclamation-triangle" inline
                                          class="mt-4" role="alert" data-forge-write-failed="root">
                                <flux:callout.text class="text-xs!">
                                    <span class="font-semibold" x-text="row.label"></span>
                                    <span x-text="(row.label ? ' — ' : '') + row.error"></span>
                                </flux:callout.text>
                                <x-slot name="actions">
                                    <flux:button size="xs" variant="ghost" class="icon-btn-touch shrink-0" x-on:click="dismiss(row.id)">{{ __('Verwerfen') }}</flux:button>
                                </x-slot>
                            </flux:callout>
                        </template>

                        {{-- ── Die Antwortzone — GitHub-Form: Karte, Komponist,
                             Statusverben in der Fusszeile. Die Riegel stehen
                             VOR dem Absenden (Haus-Muster, unverändert). --}}
                        <div class="surface-card mt-6" data-forge-einzel-antwort>
                            <template x-if="canWrite()">
                                <div class="p-4" data-forge-comment-form>
                                    <div class="relative">
                                        <flux:textarea label="{{ __('Kommentar') }}" rows="4"
                                                       x-model="commentDraft[vorgang().id]"
                                                       ::data-forge-composer="'comment:' + vorgang().id"
                                                       x-on:input="onComposerInput($event.target, 'comment:' + vorgang().id)"
                                                       x-on:keydown="mentionKey($event)"
                                                       placeholder="{{ __('Antwort schreiben … @ erwähnt jemanden.') }}" />
                                        @include('group::partials.forge-mention-popover', [
                                            'targetExpr' => "'comment:' + vorgang().id",
                                            'targetLabel' => 'comment',
                                        ])
                                    </div>
                                    <flux:callout variant="danger" icon="exclamation-triangle" inline
                                                  x-show="commentError[vorgang().id]" x-cloak role="alert" data-forge-comment-error>
                                        <flux:callout.text class="text-xs!" x-text="commentError[vorgang().id]"></flux:callout.text>
                                    </flux:callout>

                                    {{-- Statusverben wie GitHub am Komponisten:
                                         ein HAUPTWort je Zustand. `resolved` ist
                                         die dritte, deutsche Form — sie bleibt
                                         Angebot, nicht Attrappe: der Riegel
                                         (`canSetStatus`) entscheidet, der Satz
                                         daneben begründet.
                                         `data-forge-status-actions` trägt NUR
                                         der erlaubte Zweig — der Anker ist die
                                         Zusage „hier stehen Knöpfe", nicht
                                         „hier steht eine Leiste". --}}
                                    <div class="mt-3 flex flex-wrap items-center gap-2">
                                        <flux:button size="sm" variant="primary"
                                                     x-on:click="submitComment(vorgang(), 'issue')"
                                                     ::disabled="commentBusy(vorgang().id)">{{ __('Kommentieren') }}</flux:button>
                                        <span x-show="commentBusy(vorgang().id)" x-cloak role="status"
                                              class="text-xs text-muted">{{ __('Wird gesendet …') }}</span>

                                        <template x-if="canSetStatus(vorgang())">
                                            <span class="ms-auto flex flex-wrap items-center gap-2" data-forge-status-actions>
                                                <flux:button size="sm" variant="ghost"
                                                             x-on:click="setStatus(vorgang(), vorgang().status === 'open' ? 'closed' : 'open')"
                                                             ::disabled="statusBusy(vorgang().id)"
                                                             ::data-forge-status-ziel="vorgang().status === 'open' ? 'closed' : 'open'">
                                                    <span x-text="vorgang().status === 'open' ? @js(__('Issue schließen')) : @js(__('Issue erneut öffnen'))"></span>
                                                </flux:button>
                                                <template x-if="vorgang().status !== 'resolved'">
                                                    <flux:button size="sm" variant="ghost"
                                                                 x-on:click="setStatus(vorgang(), 'resolved')"
                                                                 ::disabled="statusBusy(vorgang().id)"
                                                                 data-forge-status-option="resolved">{{ __('Als gelöst markieren') }}</flux:button>
                                                </template>
                                            </span>
                                        </template>
                                    </div>
                                    <template x-if="!canSetStatus(vorgang())">
                                        <p class="mt-2 text-xs text-muted" data-forge-status-hint x-text="statusHint(vorgang())"></p>
                                    </template>

                                    @include('group::partials.forge-wake-notice', [
                                        'target' => "'comment:' + vorgang().id",
                                        'label' => 'comment',
                                    ])
                                </div>
                            </template>
                            <template x-if="!canWrite()">
                                <p class="p-4 text-sm text-muted" data-forge-write-hint x-text="writeHint()"></p>
                            </template>
                        </div>
                    </div>

                    {{-- ── Die Sidebar — ab xl rechts (GitHub), darunter im Strom.
                         dieselben Blöcke und Riegel wie bislang im Rumpf; nur
                         ihr ORT ist neu. `sticky`, damit lange Threads die
                         Zuweisung nicht wegschieben. --}}
                    <aside class="mt-8 space-y-6 xl:mt-0" aria-label="{{ __('Details') }}" data-forge-einzel-seitenspur>
                        {{-- Zuweisungen --}}
                        <section data-forge-assign-block>
                            <h2 class="text-xs font-semibold uppercase tracking-wider text-muted">{{ __('Zuständige') }}</h2>
                            <template x-if="vorgang().assigneePeople.length > 0">
                                <div class="mt-2">
                                    <x-group::forge-personen-stapel
                                        personen="vorgang().assigneePeople"
                                        anker="data-forge-assignee"
                                        data-forge-assignees
                                        :deckel="8"
                                        :sr-eins="__('Zugewiesen an :namen')"
                                        :sr-viele="__(':count Zuständige: :namen')" />
                                    <ul class="mt-2 space-y-1">
                                        <template x-for="person in vorgang().assigneePeople" :key="person.pubkey">
                                            <li class="flex items-center gap-2 text-sm" data-forge-assign-name>
                                                <x-group::nostr-avatar picture="person.picture" name="person.name" size="1.25rem" lazy />
                                                <span class="min-w-0 truncate" x-text="person.name"></span>
                                            </li>
                                        </template>
                                    </ul>
                                </div>
                            </template>
                            <p x-show="vorgang().assigneePeople.length === 0" class="mt-2 text-sm text-muted">{{ __('Niemand ist zuständig.') }}</p>

                            <div class="mt-3 flex flex-wrap items-center gap-2">
                                <flux:button size="xs" variant="ghost"
                                             data-forge-assign-self
                                             x-on:click="toggleAssignSelf(vorgang())"
                                             ::aria-disabled="canAssignSelf(vorgang()) ? null : 'true'"
                                             ::data-forge-assign-art="istZugewiesen(vorgang()) ? 'unassignment' : 'assignment'"
                                             ::class="canAssignSelf(vorgang()) ? '' : 'opacity-60'">
                                    <span x-text="istZugewiesen(vorgang()) ? @js(__('Zuweisung entfernen')) : @js(__('Mir zuweisen'))"></span>
                                </flux:button>
                                <span x-show="assignBusy(vorgang().id)" x-cloak role="status"
                                      class="text-xs text-muted">{{ __('Wird gesendet …') }}</span>
                            </div>
                            <template x-if="!canAssignSelf(vorgang())">
                                <p class="mt-1 text-xs text-muted" data-forge-assign-hint x-text="assignHint(vorgang())"></p>
                            </template>

                            {{-- Fremde zuweisen — unverändert aus dem Rumpf
                                 (Suchfeld, Chips, zwei Verben); only der Ort
                                 ist neu. --}}
                            <div class="mt-4" data-forge-assign-others>
                                <span class="text-xs font-semibold uppercase tracking-wider text-muted">{{ __('Personen zuweisen') }}</span>
                                <div class="relative mt-2 w-full sm:max-w-xs">
                                    <flux:input type="search" size="sm" icon="magnifying-glass"
                                                class:input="[&::-webkit-search-cancel-button]:hidden"
                                                autocomplete="off" autocorrect="off" spellcheck="false"
                                                aria-label="{{ __('Person oder Agent suchen') }}"
                                                placeholder="{{ __('Name oder Agent …') }}"
                                                data-forge-assign-suche
                                                ::data-forge-composer="'assign:' + vorgang().id"
                                                ::value="assignQuery[vorgang().id] ?? ''"
                                                x-on:input="onAssignInput($event.target, vorgang().id)"
                                                x-on:keydown="mentionKey($event)" />
                                    @include('group::partials.forge-mention-popover', [
                                        'targetExpr' => "'assign:' + vorgang().id",
                                        'targetLabel' => 'assign',
                                    ])
                                </div>
                                <template x-if="assignPicksFor(vorgang().id).length > 0">
                                    <div class="mt-2">
                                        <ul class="flex flex-wrap gap-2" data-forge-assign-auswahl>
                                            <template x-for="pick in assignPicksFor(vorgang().id)" :key="pick.pubkey">
                                                <li class="flex items-center gap-1.5 rounded-full bg-zinc-100 py-1 pl-2 pr-1 dark:bg-zinc-800"
                                                    data-forge-assign-chip :data-agent="pick.isAgent ? 'true' : null">
                                                    <span class="max-w-40 truncate text-sm" x-text="pick.name"></span>
                                                    <template x-if="pick.isAgent">
                                                        <span aria-hidden="true" data-forge-assign-chip-marke
                                                              class="rounded-full bg-brand-500/15 px-1.5 py-0.5 text-xs font-semibold uppercase tracking-wide text-brand-800 dark:text-brand-300">{{ __('Agent') }}</span>
                                                    </template>
                                                    <button type="button" data-forge-assign-chip-weg
                                                            class="pressable flex size-7 shrink-0 items-center justify-center rounded-full text-zinc-500 dark:text-zinc-400"
                                                            x-on:click="removeAssignPick(vorgang().id, pick.pubkey)"
                                                            :aria-label="@js(__(':name aus der Auswahl entfernen')).replace(':name', pick.name)">
                                                        <flux:icon.x-mark variant="micro" class="size-4" />
                                                    </button>
                                                </li>
                                            </template>
                                        </ul>
                                        <div class="mt-2 flex flex-wrap items-center gap-2">
                                            <flux:button size="xs" variant="ghost"
                                                         data-forge-assign-senden="assignment"
                                                         x-on:click="submitAssignOthers(vorgang(), 'assignment')"
                                                         ::aria-disabled="canAssignPicked(vorgang()) ? null : 'true'"
                                                         ::class="canAssignPicked(vorgang()) ? '' : 'opacity-60'">
                                                {{ __('Zuweisen') }}
                                            </flux:button>
                                            <flux:button size="xs" variant="ghost"
                                                         data-forge-assign-senden="unassignment"
                                                         x-on:click="submitAssignOthers(vorgang(), 'unassignment')"
                                                         ::aria-disabled="canAssignPicked(vorgang()) ? null : 'true'"
                                                         ::class="canAssignPicked(vorgang()) ? '' : 'opacity-60'">
                                                {{ __('Zuweisung entfernen') }}
                                            </flux:button>
                                        </div>
                                    </div>
                                </template>
                                <template x-if="assignOthersHint(vorgang()) !== ''">
                                    <p class="mt-1 text-xs text-muted" data-forge-assign-others-hint
                                       x-text="assignOthersHint(vorgang())"></p>
                                </template>
                            </div>
                        </section>

                        {{-- Labels --}}
                        <section data-forge-labels>
                            <h2 class="text-xs font-semibold uppercase tracking-wider text-muted">{{ __('Labels') }}</h2>
                            <template x-if="vorgang().labels.length > 0">
                                <ul class="mt-2 flex flex-wrap gap-1.5">
                                    <template x-for="label in vorgang().labels" :key="label">
                                        <li><flux:badge size="sm" variant="pill" x-text="label" /></li>
                                    </template>
                                </ul>
                            </template>
                            <p x-show="vorgang().labels.length === 0" class="mt-2 text-sm text-muted">{{ __('Keine Labels.') }}</p>
                        </section>
                    </aside>
                </div>
            </div>
        @endif
    </div>
    </div>
</x-group::app-shell>
