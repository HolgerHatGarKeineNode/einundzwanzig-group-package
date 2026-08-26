{{-- ── Eine workspace-weite Vorgangsliste, nach Repository gruppiert (P3) ───
     Erwartet: $art ('issues'|'pulls'), $titel, $quelle (Insel-Ausdruck),
     $leerTitel, $leerText.

     **Warum gruppiert und nicht flach:** eine flache Liste über alle Repos
     beantwortet „was liegt offen" und nimmt die Antwort auf „wo" wieder weg —
     zwanzig Zeilen mit zwanzigmal demselben Repo-Präfix. Die Gruppe nennt das
     Repo einmal, und ihr Kopf ist zugleich der Weg dorthin.

     **Kosten: keine zusätzliche Abfrage.** `loadForge` lädt die Vorgänge ALLER
     Repos ohnehin (`contentFilters`); bis P3 wurden sie nur gezählt. Die Decke
     von `FORGE_ROOT_LIMIT` gilt je Kind über alle Repos zusammen — deshalb
     trägt diese Fläche denselben Kürzungshinweis wie die Repo-Liste, oben
     ausserhalb der Regionen. --}}
<template x-if="{{ $quelle }}.length === 0">
    <div class="surface-card empty-state px-6 py-12 text-center" data-forge-empty="{{ $art }}">
        <span class="mx-auto flex size-12 items-center justify-center rounded-tile bg-zinc-100 dark:bg-zinc-800">
            <flux:icon.inbox class="size-6 text-zinc-500 dark:text-zinc-400" />
        </span>
        <flux:heading class="mt-4">{{ $leerTitel }}</flux:heading>
        <flux:text class="mx-auto mt-1.5 max-w-sm text-sm text-muted">{{ $leerText }}</flux:text>
    </div>
</template>

<template x-for="gruppe in {{ $quelle }}" :key="gruppe.address">
    <section class="mb-4" data-forge-gruppe :data-address="gruppe.address">
        {{-- Der Gruppenkopf ist der Weg ins Repository — dieselbe Liste, dort
             aber mit Rumpf, Kommentaren und Schreibfeld. Die Zahl daneben sagt,
             ob sich das Antippen lohnt. --}}
        <div class="mb-1.5 flex items-baseline justify-between gap-3">
            <a :href="gruppe.href || null" wire:navigate data-forge-gruppe-link
               class="min-w-0 truncate text-sm font-semibold text-zinc-900 hover:underline dark:text-zinc-100"
               x-text="gruppe.name"></a>
            <span class="shrink-0 text-xs text-muted" x-text="$num(gruppe.items.length)"></span>
        </div>
        <ul class="surface-card">
            <template x-for="row in gruppe.items" :key="row.id">
                <li class="border-b border-zinc-200 last:border-b-0 dark:border-zinc-800">
                    {{-- Die ganze Zeile ist der Link — Ziel ist die P2-Adresse
                         (`?issue=`/`?pr=`), also derselbe Verweis, den der
                         Kopier-Knopf auf der Repo-Seite liefert. Er wird nicht
                         neu zusammengesetzt, sondern kommt aus `withVorgang`. --}}
                    {{-- Zwei Ränge, dieselbe Bauform wie auf der Repo-Seite (P3):
                         Typ-Glyphe · Titel oben, EINE graue Metazeile darunter,
                         Zustand rechts. Die schmale und die breite Fassung stehen
                         als je eigenes `grid-template-areas` in `theme.css`.

                         Die Typ-Glyphe zahlt sich HIER am deutlichsten aus: auf
                         `/forge` folgen die Issue-Region und die PR-Region auf
                         EINER scrollenden Fläche aufeinander, und beide sind nach
                         Repository gruppiert — wer mitten in der Liste steht, hat
                         die Regionsüberschrift längst nach oben geschoben.

                         `$art` ist `issues` oder `pulls`; die Glyphe kommt aus dem
                         Aufruf, nicht aus der Zeile. --}}
                    <a :href="row.href || null" wire:navigate data-forge-vorgang-link :data-id="row.id"
                       class="forge-vorgangskopf pressable block w-full p-3 text-start">
                        <span class="forge-vorgangszeile">
                            @if ($art === 'issues')
                                <flux:icon.ticket variant="micro" class="forge-vz-glyphe size-4 shrink-0" />
                            @else
                                <flux:icon.arrows-right-left variant="micro" class="forge-vz-glyphe size-4 shrink-0" />
                            @endif

                            <span class="forge-vz-titel block text-sm font-medium leading-snug"
                                  x-text="row.title || @js(__('Ohne Titel'))"></span>

                            <span class="forge-vz-meta block text-xs text-muted">
                                <span x-text="row.authorName"></span>
                                <span x-text="' · ' + row.timeLabel"></span>
                            </span>

                            <span class="forge-vz-leute">
                                <template x-if="row.commentCount > 0">
                                    <span class="inline-flex items-center gap-1 text-xs text-muted">
                                        <flux:icon.chat-bubble-left-ellipsis variant="micro" class="size-4" />
                                        <span x-text="row.commentCount"></span>
                                    </span>
                                </template>
                            </span>

                            <x-group::forge-status-badge klasse="forge-vz-zustand"
                                                         status="row.status" label="row.statusLabel" />
                        </span>
                    </a>
                </li>
            </template>
        </ul>
    </section>
</template>
