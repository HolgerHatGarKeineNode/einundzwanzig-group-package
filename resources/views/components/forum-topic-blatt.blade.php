{{-- ══ Ein Thema verfassen — die MOBIL-Bauform ═════════════════════════════════

     Ein Knopf in der UNTEREN Zone plus ein Blatt, das von unten hereinkommt.
     Bewusst NICHT die Desktop-Form, und die drei Gründe stehen ausgeschrieben in
     `js/forumWriteModels.ts` (`topicComposerZiel`):

       1. Der Kopf der Liste ist auf dem Telefon nach drei Zeilen weggescrollt —
          ein Auslöser dort ist nach dem ersten Wischen unerreichbar.
       2. Die untere Zone ist der Daumenbereich und in jedem anderen Kanaltyp
          genau die Stelle, an der man etwas verfasst. Dieselbe Stelle für
          dieselbe Absicht.
       3. Ein Aufklapper am Listenkopf schöbe die Liste unter die
          Bildschirmtastatur und stünde selbst zur Hälfte darunter.

     Die Blattform ist die des Hauses: unten angeschlagen, ab `sm` mittig —
     wörtlich dieselbe wie `components/login-sheet.blade.php` und das
     „Neues Issue"-Blatt in `⚡forge-repo.blade.php`. Es gibt im Haus genau eine
     Blattform, und das ist sie.

     ── Die drei Dialogregeln ─────────────────────────────────────────────────
     `x-trap.noscroll` fängt den Fokus, sperrt den Hintergrund-Bildlauf und gibt
     den Fokus beim Loslassen an den auslösenden Knopf zurück (Alpines
     Fokus-Plugin, `returnFocus` ist dort der Standard). Escape muss der Aufruf
     selbst erledigen: das Plugin setzt `escapeDeactivates: false`.

     **Das Blatt bleibt im DOM, das FORMULAR nicht.** `x-trap` braucht ein
     stehendes Element, an dem es hängen kann; die Felder hängen am `x-if` darin.
     Der Schließen-Knopf steht AUSSERHALB dieses `x-if` — damit hat die Falle in
     jedem Zustand mindestens ein Ziel.

     ── Zählung ───────────────────────────────────────────────────────────────
     Eine Komponente, also bewusst nicht in der ARIA-Trägerzählung von
     `tests/Feature/EmptyStatesAndA11yTest.php` (`'room' => 37`). Begründung wie
     beim Lightbox-Overlay; nachgemessen fällt `⚡room.blade.php` von 38 auf 37
     (der gefallene Träger ist das Info-Icon der gelöschten Hinweiszeile). --}}

<div data-forum-topic-form-ziel="leiste">
    {{-- Der Auslöser, dort wo im Chat der Composer steht. Volle Breite: er ist
         die einzige Handlung dieser Zone, und ein zentrierter kleiner Knopf
         wäre in der Daumenzone schlechter zu treffen als eine Leiste. --}}
    <flux:button variant="primary" icon="pencil-square" class="w-full icon-btn-touch"
                 data-forum-topic-trigger="leiste"
                 x-on:click="toggleTopicDraft()"
                 aria-haspopup="dialog"
                 ::aria-expanded="topicOpen ? 'true' : 'false'">{{ __('Neues Thema') }}</flux:button>

    <div x-show="topicOpen" x-cloak
         class="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
         role="dialog" aria-modal="true" aria-label="{{ __('Neues Thema') }}"
         data-forum-topic-blatt
         x-trap.noscroll="topicOpen"
         x-on:keydown.escape.prevent.stop="if (topicOpen && !topicBusy) { toggleTopicDraft() }">
        {{-- Der Schleier schließt bei Tipp. Kein `button`: er ist ein
             Ausweichziel, keine Handlung — der Fokusring bliebe sonst an einer
             leeren Fläche hängen. Für die Tastatur gibt es Escape und das Kreuz. --}}
        <div x-show="topicOpen" x-transition.opacity class="absolute inset-0 bg-black/40"
             x-on:click="if (!topicBusy) { toggleTopicDraft() }"></div>

        <div x-show="topicOpen"
             x-transition:enter="transition ease-out duration-300 motion-reduce:duration-150"
             x-transition:enter-start="opacity-0 translate-y-full sm:translate-y-4 sm:scale-95 motion-reduce:translate-y-0! motion-reduce:scale-100!"
             x-transition:enter-end="opacity-100 translate-y-0 sm:scale-100"
             x-transition:leave="transition ease-in duration-200 motion-reduce:duration-150"
             x-transition:leave-start="opacity-100 translate-y-0 sm:scale-100"
             x-transition:leave-end="opacity-0 translate-y-full sm:translate-y-4 sm:scale-95 motion-reduce:translate-y-0! motion-reduce:scale-100!"
             class="surface-card relative z-10 max-h-[90dvh] w-full overflow-y-auto rounded-t-sheet pb-safe sm:max-w-lg sm:rounded-sheet">
            <div class="flex items-center justify-between gap-2 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
                {{-- `h2`: das Blatt ist ein eigener Abschnitt, und die Überschrift
                     ist der Name, den `aria-label` oben wiederholt. --}}
                <h2 class="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{{ __('Neues Thema') }}</h2>
                <flux:button size="sm" variant="ghost" icon="x-mark" square
                             class="icon-btn-touch"
                             x-on:click="toggleTopicDraft()"
                             ::disabled="topicBusy"
                             aria-label="{{ __('Schließen') }}" />
            </div>
            <template x-if="topicOpen">
                <div class="p-4" x-init="$nextTick(() => $refs.topicBlattFeld?.focus())">
                    @include('group::partials.forum-topic-felder', ['context' => 'blatt'])
                </div>
            </template>
        </div>
    </div>
</div>
