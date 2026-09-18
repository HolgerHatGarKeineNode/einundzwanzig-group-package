<?php

use Livewire\Attributes\Layout;
use Livewire\Component;

/**
 * The Postfach (`/postfach`, D5) as a Livewire full-page SFC — ONE page with five
 * segments: Alles · Erwähnungen · Threads · Direkt · Erinnerungen.
 *
 * The class is a thin shell — list, segment choice and read state all live in the Alpine
 * island `nostrUpdates` (welshman/IndexedDB, client-side). No `mount()`: there is nothing
 * to prepare server-side (no OG image — the page sits behind `nostr.auth` and is never
 * shared or crawled).
 *
 * **The chosen segment stands in the ADDRESS (`?ansicht=`) and is decided in the browser
 * all the same.** The server does NOT read the parameter: a server-rendered difference per
 * segment would be a second truth about the same state, and the island keeps that state
 * across `wire:navigate` anyway. It is read in `bridge.ts` (`feedFromSearch`) and written
 * back with `replaceState` — a segment change is not a page change.
 *
 * **Why the „Direkt" segment is a `<template x-if>` and not an `x-show`:** it carries
 * `nostrPrivateMessages`, and that store arms the NIP-17 wrap subscription. Alpine
 * initialises `x-data` inside CSS-hidden elements as well — under `x-show` the decryption
 * would run in all five segments. That is exactly what D5 forbids.
 */
new #[Layout('group::einundzwanzig')] class extends Component
{
    public function render()
    {
        return $this->view()->title(__('Postfach'));
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
        {{-- NO `:back`: the Postfach is a slot of the bottom bar, so it sits on the same
             level as Start — between them there is no "back", there is "somewhere else".
             Until P2 it was a sub-screen of the room list and had one. --}}
        <x-group::app-header :title="__('Postfach')">
            <x-slot:subtitle>
                <span class="text-xs text-muted" x-show="isNotices() && hasAny()" x-cloak x-text="subtitleText()"></span>
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
                {{-- `isNotices()` in front of it (P3): "mark all read" acts on the watermark of
                     the NOTICES. In „Direkt" the button would act on a list that is not there,
                     in „Erinnerungen" on rows that carry a „done" of their own. --}}
                <flux:button size="xs" variant="ghost" icon="check" class="icon-btn-touch"
                             x-show="isNotices() && hasUnread()" x-cloak x-ref="markAllBtn"
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
        {{-- `isNotices()` in front of it (P3): the bar belongs to the notice list, and its
             focus hand-back targets `$refs.list` — which is `display:none` in „Direkt", where
             `focus()` would go nowhere. --}}
        <div x-show="isNotices() && canUndo()" x-cloak role="status"
             class="chip-in mb-3 flex items-center gap-3 rounded-tile bg-zinc-100 px-3 py-2 dark:bg-zinc-800">
            <flux:icon.check-circle variant="micro" class="size-4 shrink-0 text-muted" />
            <span class="min-w-0 flex-1 text-sm text-zinc-900 dark:text-zinc-100">{{ __('Alles als gelesen markiert.') }}</span>
            {{-- Gegenstück zur Übergabe oben: der Undo-Knopf blendet sich selbst aus,
                 der Fokus geht zurück auf den „Alles"-Knopf, von dem er kam. Ist der
                 nicht (mehr) sichtbar, fängt der Listen-Container (`tabindex="-1"`). --}}
            <flux:button size="xs" variant="ghost" icon="arrow-uturn-left" class="icon-btn-touch shrink-0" x-ref="undoBtn"
                         x-on:click="undoMarkAll(); $nextTick(function () { ($refs.markAllBtn?.offsetParent ? $refs.markAllBtn : $refs.list).focus() })">{{ __('Rückgängig') }}</flux:button>
        </div>

        {{-- ── Fällige Erinnerungen (P5, NIP-ER kind 30300) ──────────────────────────

             **Warum hier und nicht in `computeUpdates`:** eine Erinnerung ist keine
             Benachrichtigung über jemand anderen. `UpdateItem` trägt `unread`, `count`,
             `bucket`, `orphan` und einen Autor — für eine selbst gestellte Erinnerung ist
             davon nichts wahr, und `computeUpdates` entscheidet alles am Lesestand
             (kind 30078), an dem eine Erinnerung nicht teilnimmt. Sie stünde also als
             Sonderfall in einer Funktion, deren ganze Zusage die einheitliche Behandlung
             ist. Deshalb ein eigener Abschnitt auf demselben SCHIRM — das ist es, was
             „erscheint über die Updates-Fläche" heißt.

             Der Abschnitt steht ÜBER den Reitern, weil die Reiter Fremd-Aktivität filtern
             („Erwähnungen", „Threads") und eine eigene Erinnerung in keinen der beiden
             fiele. Er erscheint nur, wenn etwas fällig ist; nichts Fälliges heißt keine
             Fläche, kein Leerzustand, keine Zeile.

             Der Zustand liegt in `$store.reminders` (js/reminders.ts) und nicht in
             `nostrUpdates`: derselbe Store trägt den Menü-Eintrag im Raum, und zwei
             Inseln wären zwei Wahrheiten über „ist die schon erledigt?". --}}
        {{-- Since P3 this section stands in TWO segments: under „Alles" with the DUE reminders
             (they carry a deadline, the notices below them do not) and under „Erinnerungen"
             with the waiting ones on top of that. It does NOT stand under
             „Erwähnungen"/„Threads" — those filter somebody else's activity, and a reminder of
             one's own falls into neither. Nor under „Direkt": there the surface belongs to the
             conversation.

             The store's mount sits OUTSIDE the segment condition: `$store.reminders` reads the
             reader's own kind 30300, which costs no foreign signer call, and the number on the
             segment bar needs it in every segment. --}}
        <div x-data="{
                 init() { $store.reminders?.mount() },
                 destroy() { $store.reminders?.unmount() },
             }">
            <template x-if="(feed === 'all' || feed === 'erinnerungen') && ($store.reminders?.due ?? []).length > 0">
                <section class="surface-card mb-3 overflow-hidden" aria-labelledby="reminders-heading">
                    <h2 id="reminders-heading"
                        class="flex items-center gap-2 px-4 pb-1 pt-4 text-[0.7rem] font-semibold uppercase tracking-wider text-muted">
                        <flux:icon.clock variant="micro" class="size-4" />
                        {{ __('Erinnerungen') }}
                    </h2>

                    {{-- Fehler des Relays, wörtlich — gleiche Bauart wie überall im Haus.
                         Er steht HIER und nicht nur im Dialog: „Erledigt" wird von dieser
                         Fläche aus geklickt, und eine abgelehnte Ersetzung ließe die Zeile
                         sonst kommentarlos stehen. --}}
                    <template x-if="$store.reminders?.error">
                        <flux:callout variant="danger" icon="exclamation-triangle" class="mx-4 mb-3">
                            <flux:callout.text x-text="$store.reminders.error"></flux:callout.text>
                            <x-slot name="actions">
                                <flux:button size="sm" variant="ghost" x-on:click="$store.reminders.dismissError()">{{ __('Verstanden') }}</flux:button>
                            </x-slot>
                        </flux:callout>
                    </template>

                    <div class="divide-y divide-zinc-200/60 dark:divide-zinc-800/60">
                        <template x-for="row in $store.reminders.due" :key="row.d">
                            <div class="flex items-start gap-2 px-2">
                                {{-- Zwei Formen wie beim Lesezeichen: aufgelöst ein Link,
                                     sonst ein inertes Feld. Eine Erinnerung kann älter
                                     sein als jedes geladene Fenster, und ein Link ins
                                     Nichts wäre die zweitfalsche Auskunft. --}}
                                <template x-if="row.href">
                                    <a :href="row.href" wire:navigate
                                       class="pressable flex min-w-0 flex-1 items-start gap-3 rounded-tile px-2 py-3 text-left transition-colors hover:bg-brand-500/5">
                                        <span class="min-w-0 flex-1">
                                            <span class="block text-sm leading-normal text-zinc-900 line-clamp-2 dark:text-zinc-100"
                                                  x-text="row.preview || row.note"></span>
                                            <span class="mt-2 block text-xs text-muted" x-text="row.timeLabel"></span>
                                        </span>
                                        <flux:icon.chevron-right class="mt-1 size-4 shrink-0 text-muted" />
                                    </a>
                                </template>
                                <template x-if="!row.href">
                                    <div class="min-w-0 flex-1 px-2 py-3">
                                        <p class="text-sm leading-normal text-zinc-900 line-clamp-2 dark:text-zinc-100"
                                           x-text="row.preview || row.note || @js(__('(Nachricht wird geladen…)'))"></p>
                                        <p class="mt-2 text-xs text-muted" x-text="row.timeLabel"></p>
                                    </div>
                                </template>

                                {{-- `::disabled` an `busy`, sonst ist der Knopf während
                                     eines laufenden Schreibvorgangs ein stiller
                                     Blindgänger — `finish()` verwirft den Klick dann, und
                                     das Fenster endet erst mit dem Verdikt des Relays.
                                     Dieselbe Bindung wie an der Pin-Leiste. --}}
                                <flux:button size="xs" variant="ghost" icon="check" class="icon-btn-touch mt-3 shrink-0"
                                             ::disabled="$store.reminders.busy"
                                             x-on:click="$store.reminders.finish(row.d, 'done')"
                                             aria-label="{{ __('Erinnerung erledigt') }}" />
                                <flux:button size="xs" variant="ghost" icon="x-mark" class="icon-btn-touch mt-3 shrink-0"
                                             ::disabled="$store.reminders.busy"
                                             x-on:click="$store.reminders.finish(row.d, 'cancelled')"
                                             aria-label="{{ __('Erinnerung verwerfen') }}" />
                            </div>
                        </template>
                    </div>
                </section>
            </template>
        </div>

        {{-- Filter. `flux:tabs` OHNE `flux:tab.group`: ohne Panels wirft Flux beim
             Auflösen des Panels („Could not find panel…"), sobald eine Tab-Gruppe da
             ist — hier filtert der Tab nur eine Alpine-Liste, es gibt keine Panels.
             Am 2026-08-28 nachgemessen und BESTÄTIGT: mit `flux:tab.group` und ohne
             Panels wirft Flux beim Laden 3× `Could not find panel...`, einen je Reiter
             (Messprotokoll im Kommentar an der Reiterreihe in `⚡forge.blade.php`).
             Diese Bar teilt mit `/forge` auch den zweiten, bis dahin unbemerkten
             Defekt derselben Bauform: Flux' MutationObserver in `UITabs.mount()` ruft
             `closest("ui-tab-group").showPanel(…)` ohne Null-Check. Auf `/updates`
             gemessen identisch reproduzierbar (`prepend` in `<ui-tabs>` ⇒
             `Cannot read properties of null (reading 'showPanel')`) — nur fasst hier
             kein Test die Leiste von aussen an, deshalb war die Fläche nie rot.
             Abgesichert von `js/fluxTabsPanellos.ts` (Herleitung in dessen Kopf).
             Kein `@if`/`@js()` in der Attributliste eines flux-Tags (P5-Fund: `@js()`
             wird dort nicht ausgeführt und landet wörtlich im Alpine-Ausdruck). --}}
        {{-- ── The five segments (D5) ─────────────────────────────────────────────────
             Order as in the plan: Alles · Erwähnungen · Threads · Direkt · Erinnerungen.

             **The bar SCROLLS (`overflow-x-auto`), it does not shrink.** Five entries do not
             fit into the 358 px of the content column at 390 px — `flux:tabs` is `inline-flex`
             and does not clip, so the result would be horizontal overflow on the main surface
             (the same measurement that keeps a third tab out of `dm-list.blade.php`). Scrolled
             rather than wrapped, because a two-line segment bar above the list costs more
             height than the fifth label is worth.

             **The count stands on three segments only.** „Alles" gets none (it would be the
             length of the list right below it) and „Direkt" gets none — a number about
             encrypted messages exists only after decrypting (D5). `segmentCount()` in the
             island decides that, not this markup: a number that must not be shown belongs in a
             function that says no. `x-text` with an empty string at 0 — a „0" next to a tab is
             a statement nobody needs. --}}
        <div class="-mx-1 mb-3 overflow-x-auto px-1">
            <flux:tabs variant="segmented" x-model="feed" data-postfach-segmente>
                <flux:tab name="all">{{ __('Alle') }}</flux:tab>
                <flux:tab name="mentions">
                    {{ __('Erwähnungen') }}
                    <span class="ms-1 font-normal tabular-nums text-muted"
                          x-text="segmentCount('mentions') > 0 ? segmentCount('mentions') : ''"></span>
                </flux:tab>
                <flux:tab name="threads">
                    {{ __('Threads') }}
                    <span class="ms-1 font-normal tabular-nums text-muted"
                          x-text="segmentCount('threads') > 0 ? segmentCount('threads') : ''"></span>
                </flux:tab>
                <flux:tab name="direkt">{{ __('Direkt') }}</flux:tab>
                <flux:tab name="erinnerungen">
                    {{ __('Erinnerungen') }}
                    <span class="ms-1 font-normal tabular-nums text-muted"
                          x-text="segmentCount('erinnerungen', ($store.reminders?.due ?? []).length) > 0 ? segmentCount('erinnerungen', ($store.reminders?.due ?? []).length) : ''"></span>
                </flux:tab>
            </flux:tabs>
        </div>

        {{-- ── Segment „Direkt" (D5) ──────────────────────────────────────────────────
             `<template x-if>` and NOT `x-show`: it carries `nostrPrivateMessages`, and Alpine
             initialises `x-data` inside CSS-hidden elements as well. The full derivation is in
             the partial's header — it is the reason this phase exists. --}}
        <template x-if="feed === 'direkt'">
            <div>
                @include('group::partials.postfach.direkt')
            </div>
        </template>

        {{-- ── Segment „Erinnerungen": the ones still waiting ────────────────────────
             The DUE ones already stand above (under „Alles" as well); what is added here is
             what is still to come. Without this list the segment would be empty whenever
             nothing is due, although the user has set reminders — and "nothing due" is not the
             same statement as "none set". --}}
        <template x-if="feed === 'erinnerungen'">
            <div>
                <template x-if="($store.reminders?.upcoming ?? []).length > 0">
                    <section class="surface-card mb-3 overflow-hidden" aria-labelledby="reminders-upcoming">
                        <h2 id="reminders-upcoming"
                            class="flex items-center gap-2 px-4 pb-1 pt-4 text-[0.7rem] font-semibold uppercase tracking-wider text-muted">
                            <flux:icon.clock variant="micro" class="size-4" />
                            {{ __('Noch nicht fällig') }}
                        </h2>
                        <div class="divide-y divide-zinc-200/60 dark:divide-zinc-800/60">
                            <template x-for="row in ($store.reminders?.upcoming ?? [])" :key="row.d">
                                <div class="flex items-start gap-2 px-2" data-erinnerung-offen>
                                    <div class="min-w-0 flex-1 px-2 py-3">
                                        <p class="text-sm leading-normal text-zinc-900 line-clamp-2 dark:text-zinc-100"
                                           x-text="row.preview || row.note || @js(__('(Nachricht wird geladen…)'))"></p>
                                        <p class="mt-2 text-xs text-muted" x-text="row.timeLabel"></p>
                                    </div>
                                    {{-- „Verwerfen" only: a reminder that is not due yet cannot
                                         be finished — that would be a statement about a
                                         deadline that is still running. --}}
                                    <flux:button size="xs" variant="ghost" icon="x-mark" class="icon-btn-touch mt-3 shrink-0"
                                                 ::disabled="$store.reminders.busy"
                                                 x-on:click="$store.reminders.finish(row.d, 'cancelled')"
                                                 aria-label="{{ __('Erinnerung verwerfen') }}" />
                                </div>
                            </template>
                        </div>
                    </section>
                </template>

                {{-- The segment's empty state — with the way IN, not just the observation.
                     Reminders are created from the message menu inside a room. --}}
                <template x-if="($store.reminders?.due ?? []).length === 0 && ($store.reminders?.upcoming ?? []).length === 0">
                    <div class="surface-card empty-state px-4 py-10 text-center">
                        <flux:icon.clock class="mx-auto size-8 text-zinc-400" />
                        <flux:heading class="mt-2">{{ __('Keine Erinnerungen.') }}</flux:heading>
                        <flux:text class="mt-1 text-sm text-muted">{{ __('Im Menü einer Nachricht kannst du dich später erinnern lassen.') }}</flux:text>
                    </div>
                </template>
            </div>
        </template>

        {{-- Zustand 4 — Fehler. Wortlaut sagt bewusst, dass die Liste UNVOLLSTÄNDIG,
             nicht falsch ist (Nielsen #1, Systemstatus): der Gerätespeicher trägt
             weiter, auch wenn der Space gerade schweigt. --}}
        <template x-if="isNotices() && error">
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
        {{-- `x-show` and NOT `x-if` (P3): this block contains no `x-data` island at all, so it
             costs nothing while hidden — and `x-ref="list"` has to exist in EVERY segment,
             because the focus hand-backs above fall back to it. An `x-if` would turn
             `$refs.list.focus()` into a throw while „Direkt" is open. The „Direkt" segment
             carries an `x-if` for the opposite reason: it contains exactly such an island. --}}
        <div x-show="isNotices()" x-ref="list" tabindex="-1" :aria-busy="loading" class="surface-card overflow-hidden">

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
                            <flux:button size="sm" variant="ghost" icon="hashtag" :href="route('group.bereich.chat')" wire:navigate>{{ __('Zu den Räumen') }}</flux:button>
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
        <div x-show="isNotices() && !isEmpty()" x-cloak class="mt-4 text-center">
            {{-- Gleiche Bauart wie oben: beim LETZTEN Klick verschwindet der Knopf unter
                 dem Fokus (`hasMore()` wird falsch). Bleibt er stehen, behält er ihn —
                 sonst fängt die Liste. `offsetParent` ist bei `display:none` null. --}}
            <flux:button x-show="hasMore()" x-cloak size="sm" variant="ghost" icon="arrow-down" x-ref="olderBtn"
                         x-on:click="older(); $nextTick(function () { ($refs.olderBtn?.offsetParent ? $refs.olderBtn : $refs.list).focus() })">{{ __('Ältere anzeigen') }}</flux:button>
            <p class="mt-2 text-xs text-muted">{{ __('Älter als 30 Tage liegt nicht im Speicher.') }}</p>
        </div>
    </div>

</x-group::app-shell>
