{{-- ══ Ein Thema verfassen — die DESKTOP-Bauform ═══════════════════════════════

     Ein Aufklapper am KOPF der Themenliste. Das ist wörtlich die Form, die Buzz
     Desktop hat: `ForumView.tsx:184-197` rendert dort einen Knopf über die volle
     Breite mit gestricheltem Rahmen („Start a new post…"), der beim Klick an
     derselben Stelle den Composer ausklappt (`isComposerOpen`), mit „Abbrechen"
     und dem Absenden im Composer selbst. Beim Wechsel des Kanals fällt er
     zurück (`ForumView.tsx:118-125`) — bei uns erledigt das `teardown()`.

     ── Warum am Desktop ein Aufklapper und kein Blatt ─────────────────────────

     Weil die Liste daneben stehen bleiben soll. Wer am Desktop ein Thema
     eröffnet, hat die Liste im Blick und schreibt gegen sie — ein modales Blatt
     legte einen Schleier über genau die Information, wegen der man schreibt
     („steht das nicht schon irgendwo?"). Auf dem Telefon ist das anders, und
     deshalb steht dort etwas anderes: `components/forum-topic-blatt.blade.php`.

     ── Was diese Datei NICHT enthält ─────────────────────────────────────────

     Die Felder. Die stehen genau einmal, in
     `partials/forum-topic-felder.blade.php`, und werden von beiden Bauformen
     eingebunden. Die Trennung Desktop/Mobil ist eine Frage der HÜLLE (Aufklapper
     gegen Blatt, Kopf gegen Leiste) — dieselbe Frage zweimal zu beantworten wäre
     der dokumentierte Hauptfehler dieses Hauses. Zwei Kopien der Felder wären
     die andere Hälfte desselben Fehlers.

     ── Und was die ZÄHLUNG angeht ────────────────────────────────────────────

     This file is a component and therefore deliberately absent from the ARIA
     carrier count of `tests/Feature/EmptyStatesAndA11yTest.php`
     (`'room' => 37`) — the same rule and the same reason as for the lightbox
     overlay and the reminder dialog: a component embedded from several places
     would have to be counted there more than once. Its own latch is its
     behavioural promise (`tests/e2e/buzz-forum.spec.ts`), not this number.
     Measured: `⚡room.blade.php` drops from 38 to 37, and one-sidedly — the one
     carrier that fell away is the info icon of the deleted notice row, none was
     added. --}}

{{-- `sticky top-0`, weil Buzz Desktop den Streifen ebenfalls stehen lässt: dort
     liegt er in einem eigenen `border-b`-Kopf ÜBER dem Scrollbereich
     (`ForumView.tsx:163-198`, `<div className="border-b … p-4">` als Geschwister
     des `flex-1 overflow-y-auto`). Unsere Themenliste ist EIN Scrollcontainer —
     ein Element darin, das nicht klebt, wäre nach drei Zeilen weg, und der Weg
     zum eigenen Thema hinge davon ab, wo jemand gerade steht.

     Der Grund fürs Kleben statt fürs Umbauen in einen zweiten Container: der
     Container trägt die Breitenklammer (`xl:mx-auto xl:max-w-[62rem]`), und ein
     zweiter daneben müsste sie zeichengleich wiederholen. Zwei Zeichenketten,
     die übereinstimmen müssen, sind eine Absprache, die niemand prüft.

     Der Untergrund ist der des Seitenrumpfs (`bg-zinc-50 dark:bg-zinc-950`,
     `einundzwanzig.blade.php:24`) — ohne ihn schienen die Themenkarten beim
     Scrollen durch den Streifen hindurch. --}}
<div class="sticky top-0 z-10 bg-zinc-50 pt-1 pb-2 dark:bg-zinc-950" data-forum-topic-form-ziel="kopf">
    {{-- Zugeklappt: der Streifen, der einlädt. `border-dashed` wie bei Buzz —
         die gestrichelte Kante sagt „hier ist noch nichts, hier könnte etwas
         von dir stehen", ohne wie eine gefüllte Karte auszusehen.

         `x-bind:aria-expanded` AUSGESCHRIEBEN, nicht `::aria-expanded`: der
         doppelte Doppelpunkt ist die Blade-Konvention für KOMPONENTEN-Tags
         (`<flux:…>`); auf rohem HTML gibt Blade ihn wörtlich aus und Alpine
         schreibt ein Attribut namens `:aria-expanded`. Das echte entstünde nie
         — lautlos, kein Test würde rot. --}}
    <button type="button" data-forum-topic-trigger="kopf"
            x-show="!topicOpen"
            x-on:click="toggleTopicDraft()"
            x-bind:aria-expanded="topicOpen ? 'true' : 'false'"
            {{-- Die gestrichelte Kante ist die EINZIGE Begrenzung dieses Knopfes
                 (keine Füllung) — damit fällt sie unter WCAG 1.4.11 und braucht
                 3:1 gegen ihren Untergrund. Gerechnet gegen die vier Lagen, in
                 denen sie steht:
                   zinc-500 auf zinc-50   4,63:1   ·  auf weiss (hover)  4,83:1
                   zinc-500 auf zinc-950  4,12:1   ·  auf zinc-800 (hover) 3,08:1
                 Der naheliegende `border-zinc-300`/`dark:border-zinc-700` (die
                 Kante der Chat-Karten) hielte hier **1,42:1** bzw. **1,91:1** —
                 an einer Karte trägt daneben eine Füllung die Abgrenzung, an
                 diesem Knopf nicht. Die Hover-Stufen gehen jeweils EINE Stufe in
                 Richtung Kontrast (zinc-600 hell 7,41:1, zinc-400 dunkel 5,81:1),
                 damit das Zeigegerät eine sichtbare Rückmeldung hat. --}}
            class="pressable w-full rounded-card border border-dashed border-zinc-500 px-4 py-3 text-start text-sm text-muted transition-colors hover:border-zinc-600 hover:bg-white hover:text-zinc-700 dark:border-zinc-500 dark:hover:border-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200">
        {{ __('Neues Thema verfassen …') }}
    </button>

    {{-- Aufgeklappt. `x-if` und nicht `x-show`: die Felder tragen einen `x-ref`
         und `data-`-Haken; ein per CSS verstecktes Duplikat wäre in
         `getByRole`/`locator` ein Strict-Mode-Treffer auf zwei Elemente, sobald
         irgendwann eine dritte Fläche dazukommt. Und `x-effect` fokussiert das
         Feld beim Aufklappen — der Klick auf den Streifen ist die Absicht zu
         schreiben, nicht die Absicht, ein Feld zu suchen. --}}
    <template x-if="topicOpen">
        <div class="surface-card p-3"
             x-init="$nextTick(() => $refs.topicInlineFeld?.focus())"
             x-on:keydown.escape.stop="if (!topicBusy) { toggleTopicDraft() }">
            @include('group::partials.forum-topic-felder', ['context' => 'inline'])
        </div>
    </template>
</div>
