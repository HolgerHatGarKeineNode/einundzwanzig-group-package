{{-- ── Ordnung der Themenliste (P3) ────────────────────────────────────────────
     `Aktivität | Punkte` — er ORDNET die Liste um, er filtert sie nicht und lädt
     nichts nach. Der Umschalter steht EINMAL, über der Liste, und nur wenn es
     überhaupt mehr als ein Thema zu ordnen gibt: ein Umschalter über einer Zeile
     ist eine Handlung ohne sichtbare Wirkung.

     ── Warum `flux:radio.group variant="segmented"` und keine Handarbeit ───────
     Weil „genau eines aus zwei" eine Radiogruppe IST, und weil im Haus die
     Flux-Komponente den Vorrang hat, wo es eine gibt. Die Bauform ist wörtlich
     die von `partials/forge-listen-umschalter.blade.php`; dort steht auch
     nachgelesen (nicht vermutet), dass Flux zur Laufzeit `role="radiogroup"` /
     `role="radio"` setzt und NICHT `role="tab"`
     (`vendor/livewire/flux-pro/dist/flux.js:15920`, `:15953`).

     ── Warum NICHT `x-model`, obwohl `topicSort` ein zuweisbares Feld ist ──────
     Weil der Weg hinein und der Weg heraus bei dieser Komponente verschiedene
     Mechanismen sind, und nur einer davon gemessen ist: hinein über die
     `value`-EIGENSCHAFT von `ui-radio-group` (`flux.js:2124`, per
     `Object.defineProperty` — ein Attribut täte hier nichts), heraus über
     `change`. Genau diese zwei Richtungen fährt der Forge-Umschalter seit seinem
     Flux-Angleich, und das ist die einzige Fassung, die in diesem Repo im Browser
     belegt ist. `x-model` wäre die kürzere Zeile und eine unbelegte Annahme über
     das Ereignis, das Flux feuert.

     ── Die Werte stehen hier ein ZWEITES Mal, und das ist gehalten ────────────
     PHP und TypeScript teilen zur Laufzeit nichts; die Beschriftungen müssen
     durch `__()` und damit durch Blade. `forumModels.test.ts` liest den
     `$ordnungen`-Block dieser Datei und hält ihn gegen `FORUM_SORTS`,
     Reihenfolge inklusive — dieselbe Bauform wie bei `⚡articles.blade.php`.
     Ohne diesen Riegel fiele ein Tippfehler zur Laufzeit still auf die
     Default-Ordnung zurück.

     ── Zählung ───────────────────────────────────────────────────────────────
     Ein Partial, also bewusst nicht in der ARIA-Trägerzählung von
     `tests/Feature/EmptyStatesAndA11yTest.php` (`'room' => 37`) — dieselbe Regel
     und derselbe Grund wie bei den zwei Themen-Composer-Bauformen. --}}
@php($ordnungen = [
    ['wert' => 'activity', 'label' => __('Aktivität')],
    ['wert' => 'score', 'label' => __('Punkte')],
])
<div x-show="topics.length > 1" x-cloak class="flex justify-end pb-2" data-forum-sortierung>
    {{-- `h-13!` wie am Forge-Umschalter: Flux' Schiene ist `h-10` bei `p-1`, das
         Segment darin also 32 px. 3,25 rem minus 2 × 4 px Polster ergibt exakt
         44 px — Apples HIG. Das `!` ist nötig, weil `h-10` aus demselben
         Utility-Layer kommt und bei gleicher Spezifität sonst die
         Quellreihenfolge im GEBAUTEN Stylesheet entschiede. --}}
    <flux:radio.group variant="segmented" class="h-13!"
                      aria-label="{{ __('Wie sortieren?') }}"
                      x-effect="$el.value = topicSort"
                      x-on:change="$event.target.value !== topicSort && (topicSort = $event.target.value)">
        @foreach ($ordnungen as $ordnung)
            <flux:radio value="{{ $ordnung['wert'] }}" data-forum-sortierung-wert="{{ $ordnung['wert'] }}">
                {{-- Die Marke ist Zierrat für die Sprachausgabe — sie hört
                     `aria-checked`, das `UIRadio` selbst pflegt. Fürs Auge ist sie
                     der Zustandsträger, der nicht an der Farbe hängt: Flux
                     markiert das gewählte Segment allein über Fläche und
                     Textfarbe, und im dunklen Modus misst der Daumen
                     (`bg-white/20`) gegen die Schiene (`bg-white/10`) gerechnete
                     1,91:1 — unter den 3:1 aus WCAG 1.4.11 für einen Zustand. --}}
                <span aria-hidden="true"
                      class="size-2 shrink-0 rounded-full border border-current [ui-radio[data-checked]_&]:bg-current"></span>
                <span>{{ $ordnung['label'] }}</span>
            </flux:radio>
        @endforeach
    </flux:radio.group>
</div>
