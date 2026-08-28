<?php

use Livewire\Attributes\Layout;
use Livewire\Component;

/**
 * Die Einzelansicht eines Pull Requests (`/forge/{naddr}/pulls/{id}`,
 * GitHub-Parität P1/P3). Dünne Hülle wie `⚡forge-issue` — dieselbe Insel
 * `nostrForgeVorgang`, nur die Art und der Tab-Reichtum (Diskussion/Dateien)
 * unterscheiden die Flächen.
 */
new #[Layout('group::einundzwanzig')] class extends Component
{
    public string $naddr = '';

    public string $id = '';

    public function mount(string $naddr, string $id): void
    {
        $this->naddr = $naddr;
        $this->id = strtolower($id);
    }

    public function render()
    {
        return $this->view()->title(__('Pull Request'));
    }
}; ?>

<x-group::app-shell width="wide">

    <div x-data="nostrForgeVorgang(@js($naddr), 'pr', @js($id))" data-forge-einzel="pull">
    <div class="page-enter">

        @php($titelExpr = 'vorgang() ? (\'#\' + shortId() + \' \' + (vorgang().title || '.json_encode(__('Ohne Titel')).')) : '.json_encode(__('Pull Request')))

        <x-group::app-header :title="__('Pull Request')" :title-expr="$titelExpr"
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
                    <span class="min-w-0 truncate" aria-current="page">{{ __('Pull Request') }}</span>
                </nav>
            </x-slot>
        </x-group::app-header>

        @if (! config('group.workspace_url'))
            <div class="surface-card empty-state px-6 py-12 text-center">
                <span class="mx-auto flex size-12 items-center justify-center rounded-tile bg-zinc-100 dark:bg-zinc-800">
                    <flux:icon.arrows-right-left class="size-6 text-zinc-500 dark:text-zinc-400" />
                </span>
                <flux:heading size="lg" class="mt-4">{{ __('Keine Forge-Quelle eingerichtet.') }}</flux:heading>
                <flux:text class="mx-auto mt-1 max-w-sm text-sm text-muted">{{ __('Dieser Client kennt kein Relay, auf dem Repositories liegen.') }}</flux:text>
            </div>
        @else
            <template x-if="ungueltig">
                <div class="surface-card empty-state px-6 py-12 text-center" data-forge-einzel-ungueltig>
                    <span class="mx-auto flex size-12 items-center justify-center rounded-tile bg-zinc-100 dark:bg-zinc-800">
                        <flux:icon.arrows-right-left class="size-6 text-zinc-500 dark:text-zinc-400" />
                    </span>
                    <flux:heading size="lg" class="mt-4">{{ __('Diese Adresse nennt keinen Pull Request.') }}</flux:heading>
                    <flux:text class="mx-auto mt-1 max-w-sm text-sm text-muted">{{ __('Der Link ist unvollständig oder beschädigt — die Nummer des Vorschlags fehlt oder hat die falsche Form.') }}</flux:text>
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

            {{-- Zwei Gestalten des „nicht gefunden" (siehe `_messeMissing` in
                 der Insel) — dieselbe Trennung wie beim Issue. --}}
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
                        <flux:icon.arrows-right-left class="size-6 text-zinc-500 dark:text-zinc-400" />
                    </span>
                    <flux:heading size="lg" class="mt-4">{{ __('Diesen Pull Request gibt es nicht (mehr).') }}</flux:heading>
                    <flux:text class="mx-auto mt-1 max-w-sm text-sm text-muted">{{ __('Vielleicht wurde er entfernt, oder der Link zeigt auf ein anderes Relay.') }}</flux:text>
                    <div class="mt-4">
                        <flux:button size="sm" variant="ghost" icon="arrow-left" ::href="repoHref()" wire:navigate>{{ __('Zum Repository') }}</flux:button>
                    </div>
                </div>
            </template>

            <template x-if="loading && !error">
                <div class="surface-card mb-4 animate-pulse p-6" aria-hidden="true" data-forge-einzel-skelett>
                    <div class="h-5 w-2/3 rounded-tile bg-zinc-200 dark:bg-zinc-700"></div>
                    <div class="mt-3 h-3 w-1/3 rounded-tile bg-zinc-100 dark:bg-zinc-800"></div>
                    <div class="mt-6 h-20 rounded-tile bg-zinc-100 dark:bg-zinc-800"></div>
                </div>
            </template>

            <div x-show="vorgangDa()" x-cloak>
                <div class="xl:grid xl:grid-cols-[minmax(0,1fr)_18rem] xl:items-start xl:gap-8" data-forge-einzel-blatt>
                    <div class="min-w-0">

                        <h1 class="flex flex-wrap items-center gap-x-2 gap-y-1 text-xl font-semibold text-zinc-900 md:text-2xl dark:text-zinc-100"
                            data-forge-einzel-titel>
                            <span class="min-w-0" x-text="vorgang().title || @js(__('Ohne Titel'))"></span>
                            <span class="font-normal text-muted">#<span x-text="shortId()"></span></span>
                        </h1>

                        <div class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
                            <x-group::forge-status-badge status="vorgang().status" label="statusText(vorgang().status)" wort="immer" />
                            <p class="min-w-0 text-sm text-muted">
                                <span class="truncate"
                                      x-text="(vorgang().branch
                                          ? @js(__('Von :name aus :branch')).split(':name').join(vorgang().authorName).split(':branch').join(vorgang().branch)
                                          : @js(__('Von :name')).split(':name').join(vorgang().authorName))"></span>
                                <span x-text="' · ' + vorgang().timeLabel"></span>
                            </p>
                            <template x-if="vorgang().shortMergeCommit || vorgang().shortCommit">
                                <flux:badge size="sm" class="shrink-0 tracking-tight" icon="arrows-pointing-in"
                                            data-forge-anker="merge"
                                            x-text="vorgang().shortMergeCommit || vorgang().shortCommit" />
                            </template>
                            <template x-if="canCopyClone()">
                                <flux:button size="xs" variant="ghost" icon="link"
                                             data-forge-vorgang-copy x-on:click="copyVorgang()">{{ __('Link kopieren') }}</flux:button>
                            </template>
                        </div>

                        {{-- ── Tabs: Diskussion / Dateien — GitHub-Form ──────────
                             `?tab=dateien` ist teilbar (dasselbe Muster wie die
                             Repo-Tabs); die Whitelist steht in der Insel
                             (`vorgangTabFromLocation`). --}}
                        <flux:tabs x-model="tab" class="mt-4 mb-0" data-forge-einzel-tabs>
                            <flux:tab name="diskussion" icon="chat-bubble-left-right">{{ __('Diskussion') }}</flux:tab>
                            <flux:tab name="dateien" icon="document-text">{{ __('Dateien') }}</flux:tab>
                        </flux:tabs>

                        {{-- ── Diskussion ────────────────────────────────────────── --}}
                        <div x-show="tab === 'diskussion'" x-cloak>
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
                                <div class="px-4 py-3">
                                    <div x-show="vorgang().html" class="article-content forge-mass" x-html="vorgang().html"></div>
                                    <p x-show="!vorgang().html" class="whitespace-pre-wrap text-sm" x-text="vorgang().content"></p>
                                </div>
                            </article>

                            {{-- Wo dieser Vorschlag gelandet ist — GitHub nennt es
                                 die Merge-Box; wir zeigen die ANKUNFT als Karten
                                 unter dem OP (Daten: merge-commit, applied-as). --}}
                            <template x-if="vorgang().shortMergeCommit || vorgang().shortAppliedAsCommits.length > 0">
                                <div class="surface-card mt-4 p-4" data-forge-landung>
                                    <template x-if="vorgang().shortMergeCommit">
                                        <p class="flex flex-wrap items-center gap-1.5 text-sm">
                                            <span class="text-muted">{{ __('Zusammengeführt als') }}</span>
                                            <flux:badge size="sm" class="tracking-tight" data-forge-merge-commit
                                                        x-text="vorgang().shortMergeCommit" />
                                        </p>
                                    </template>
                                    <template x-if="vorgang().shortAppliedAsCommits.length > 0">
                                        <p class="mt-1 flex flex-wrap items-center gap-1.5 text-sm">
                                            <span class="text-muted">{{ __('Angewandt als') }}</span>
                                            <template x-for="c in vorgang().shortAppliedAsCommits" :key="c">
                                                <flux:badge size="sm" class="tracking-tight" data-forge-applied-as x-text="c" />
                                            </template>
                                        </p>
                                    </template>
                                </div>
                            </template>

                            {{-- Updates = Commits dieses Vorschlags (kind 1631).
                                 Kein eigener Tab: die Datenlage ist eine Liste,
                                 kein Browse-Modus — GitHub-„Commits"-Tab entfällt
                                 bewusst (Abgleich im Plan). --}}
                            <template x-if="vorgang().updates.length > 0">
                                <ul class="surface-card mt-4 divide-y divide-zinc-200 dark:divide-zinc-800" data-forge-pr-updates>
                                    <template x-for="update in vorgang().updates" :key="update.id">
                                        <li class="flex flex-wrap items-center gap-x-2 gap-y-1 px-4 py-2.5 text-sm">
                                            <flux:icon.arrow-path variant="micro" class="size-3.5 shrink-0 text-muted" />
                                            <span x-text="update.authorName"></span>
                                            <span class="text-xs text-muted" x-text="update.timeLabel"></span>
                                            <template x-if="update.shortCommit">
                                                <span class="rounded-pill bg-brand-500/10 px-1.5 py-0.5 font-semibold tracking-tight text-brand-800 dark:text-brand-300"
                                                      x-text="update.shortCommit"></span>
                                            </template>
                                        </li>
                                    </template>
                                </ul>
                            </template>

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

                            {{-- Freigeben / Änderungen erbitten — GitHub trägt die
                                 Review-Verben in die Merge-Box; hier stehen sie
                                 über dem Komponisten. Riegel + Satz unverändert
                                 aus dem Rumpf. --}}
                            <div class="surface-card mt-6 p-4" data-forge-review-block>
                                <div class="flex flex-wrap items-center gap-2">
                                    <flux:button size="sm" variant="ghost" icon="check"
                                                 data-forge-approve
                                                 x-on:click="submitReview(vorgang(), 'approval')"
                                                 ::aria-disabled="canApprove(vorgang()) && eigeneEntscheidung(vorgang()) !== 'approval' ? null : 'true'"
                                                 ::class="canApprove(vorgang()) && eigeneEntscheidung(vorgang()) !== 'approval' ? '' : 'opacity-60'">
                                        <span x-text="eigeneEntscheidung(vorgang()) === 'approval' ? @js(__('Freigegeben')) : @js(__('Freigeben'))"></span>
                                    </flux:button>
                                    <flux:button size="sm" variant="ghost" icon="arrow-uturn-left"
                                                 data-forge-request-changes
                                                 x-on:click="submitReview(vorgang(), 'changes-requested')"
                                                 ::aria-disabled="canApprove(vorgang()) && eigeneEntscheidung(vorgang()) !== 'changes-requested' ? null : 'true'"
                                                 ::class="canApprove(vorgang()) && eigeneEntscheidung(vorgang()) !== 'changes-requested' ? '' : 'opacity-60'">
                                        <span x-text="eigeneEntscheidung(vorgang()) === 'changes-requested' ? @js(__('Änderungen erbeten')) : @js(__('Änderungen erbitten'))"></span>
                                    </flux:button>
                                    <span x-show="reviewBusy(vorgang().id)" x-cloak role="status"
                                          class="text-xs text-muted">{{ __('Wird gesendet …') }}</span>
                                </div>
                                <template x-if="!canApprove(vorgang())">
                                    <p class="mt-1 text-xs text-muted" data-forge-review-hint
                                       x-text="approveHint(vorgang())"></p>
                                </template>
                            </div>

                            {{-- Antwortzone — unverändert die Issue-Bauform. Ein
                                 PR Statuswechsel ist hier NICHT angeboten: den
                                 verantwortet, wer ihn gepusht hat (Begründung
                                 stand am Rumpf, unverändert gültig). --}}
                            <div class="surface-card mt-4" data-forge-einzel-antwort>
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
                                        <div class="mt-3 flex flex-wrap items-center gap-2">
                                            <flux:button size="sm" variant="primary"
                                                         x-on:click="submitComment(vorgang(), 'pr')"
                                                         ::disabled="commentBusy(vorgang().id)">{{ __('Kommentieren') }}</flux:button>
                                            <span x-show="commentBusy(vorgang().id)" x-cloak role="status"
                                                  class="text-xs text-muted">{{ __('Wird gesendet …') }}</span>
                                        </div>
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

                        {{-- ── Dateien — „Files changed", unverändert die
                             Komponente ( Ladeweg mit Ansage, kein Autostart). --}}
                        <div x-show="tab === 'dateien'" x-cloak data-forge-einzel-dateien>
                            <x-group::forge-pr-diff vorgang="vorgang()" />
                        </div>
                    </div>

                    {{-- Sidebar: Reviewer + Freigaben --}}
                    <aside class="mt-8 space-y-6 xl:mt-0" aria-label="{{ __('Details') }}" data-forge-einzel-seitenspur>
                        <section data-forge-reviewers-block>
                            <h2 class="text-xs font-semibold uppercase tracking-wider text-muted">{{ __('Reviewer') }}</h2>
                            <template x-if="vorgang().reviewerPeople.length > 0">
                                <div class="mt-2">
                                    <x-group::forge-personen-stapel
                                        personen="vorgang().reviewerPeople"
                                        entscheidung="person.decision"
                                        anker="data-forge-reviewer"
                                        data-forge-reviewers
                                        :deckel="8"
                                        :sr-eins="__('Reviewer: :namen')"
                                        :sr-viele="__(':count Reviewer: :namen')" />
                                    <ul class="mt-2 space-y-1">
                                        <template x-for="person in vorgang().reviewerPeople" :key="person.pubkey">
                                            <li class="flex items-center gap-2 text-sm" data-forge-reviewer-name>
                                                <x-group::nostr-avatar picture="person.picture" name="person.name" size="1.25rem" lazy />
                                                <span class="min-w-0 truncate" x-text="person.name"></span>
                                                {{-- Die Entscheidung als WORT, nicht nur als Plakette am
                                                     Gesicht (1.4.1): Häkchen = freigegeben, Pfeil = Änderungen. --}}
                                                <span class="ms-auto shrink-0 text-xs text-muted"
                                                      x-text="person.decision === 'approved' ? @js(__('freigegeben')) : (person.decision === 'changes-requested' ? @js(__('Änderungen erbeten')) : '')"></span>
                                            </li>
                                        </template>
                                    </ul>
                                </div>
                            </template>
                            <p x-show="vorgang().reviewerPeople.length === 0" class="mt-2 text-sm text-muted">{{ __('Keine Reviewer angefragt.') }}</p>
                            <template x-if="vorgang().approvals.length > 0">
                                <p class="mt-2 text-xs text-muted" data-forge-approvals
                                   x-text="$plural(vorgang().approvals.length, '1 Freigabe', ':count Freigaben')"></p>
                            </template>
                        </section>
                    </aside>
                </div>
            </div>
        @endif
    </div>
    </div>
</x-group::app-shell>
