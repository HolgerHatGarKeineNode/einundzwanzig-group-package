@php
    /**
     * Die FELDER eines neuen Forum-Themas — geteilt zwischen den zwei Bauformen
     * (`components/forum-topic-inline.blade.php` am Desktop,
     * `components/forum-topic-blatt.blade.php` auf dem Telefon).
     *
     * ── Warum EIN Feld und nicht Titel + Rumpf ─────────────────────────────
     *
     * Weil ein `kind 45001` genau EIN Feld hat. Der Beleg steht nicht in einer
     * Herleitung, sondern im Erzeuger selbst: `crates/buzz-sdk/src/builders.rs:284`
     * (`build_forum_post`) baut die Tags als `["h", <uuid>]` plus optionale
     * `p`/`imeta` — **kein `subject`, kein `title`, kein `d`**. Buzz Desktop
     * schreibt dasselbe Ereignis ein zweites Mal
     * (`desktop/src-tauri/src/events.rs:317`) und stellt davor einen Composer mit
     * einem einzigen `useState("")` (`ForumComposer.tsx:53`), Platzhalter „Write
     * your post…".
     *
     * Ein Titelfeld hier würde also entweder in den Rumpf gefaltet (dann ist es
     * ein Etikett auf einer Textzeile) oder in ein eigenes Tag geschrieben (dann
     * sieht es in Buzz Desktop niemand). Beides wäre gelogen. Stattdessen sagt
     * die Fläche, was WIRKLICH passiert: die erste Zeile wird der Titel der
     * Liste — und zeigt ihn live, gerechnet mit **derselben** Funktion, aus der
     * die Liste ihn baut (`topicTitlePreview()` → `forumTopicTitle`).
     *
     * ── Zwei Kontexte, ein Feld ────────────────────────────────────────────
     *
     * `$context` ('inline'|'blatt') trennt nur die HAKEN, nicht das Verhalten:
     * die beiden Bauformen stehen nie gleichzeitig im DOM (`x-if` auf
     * `topicComposerZiel(...)`), aber die Haken sollen trotzdem sagen, welche
     * gerade misst — eine Reihenfolge ist kein Vertrag, ein `data-`-Attribut
     * schon.
     */
    $ref = $context === 'blatt' ? 'topicBlattFeld' : 'topicInlineFeld';
@endphp

<div class="space-y-2" data-forum-topic-form="{{ $context }}">
    {{-- `flux:textarea` mit `label`: der Flux-Default trägt die Beschriftung
         selbst und verdrahtet `for`/`id`. Ein handgebautes <label> daneben wäre
         ein zweites Muster für dieselbe Sache. --}}
    <flux:textarea :label="__('Thema')" x-ref="{{ $ref }}" x-model="topicDraft" rows="5"
                   data-forum-topic-input="{{ $context }}"
                   x-on:input="topicError = ''"
                   {{-- Strg/Cmd+Enter sendet. KEIN blankes Enter: ein Thema ist
                        mehrzeilig gemeint (erste Zeile Titel, Rest Rumpf), und
                        genau dort wäre Enter-zum-Senden die Taste, die den
                        Absatz frisst. Der Chat-Composer darf das, weil dort
                        eine Nachricht typisch einzeilig ist. --}}
                   x-on:keydown.enter.meta="submitTopic()"
                   x-on:keydown.enter.ctrl="submitTopic()"
                   placeholder="{{ __('Erste Zeile: der Titel. Danach dein Text.') }}" />

    {{-- Was daraus in der Liste wird — live, und mit der Funktion der Liste
         gerechnet. `x-show` statt `x-if`: der Satz erscheint mit dem ersten
         Zeichen und soll dabei nicht die Höhe des Blattes springen lassen.

         `aria-live="polite"`: für die Sprachausgabe ist das die einzige
         Auskunft darüber, dass die erste Zeile eine Sonderrolle hat. Ohne sie
         wäre der Hinweis rein visuell. --}}
    <p class="text-xs text-muted" x-show="topicDraft.trim() !== ''" x-cloak
       aria-live="polite" data-forum-topic-titelvorschau>
        <span>{{ __('Titel in der Liste:') }}</span>
        <span class="font-semibold text-zinc-700 dark:text-zinc-200" x-text="topicTitlePreview()"></span>
    </p>

    {{-- Der AUSGANG. Er ist hier kein Beiwerk, sondern die Zusage:

         Buzz beantwortet ein ratenbegrenztes EVENT mit einer nackten `NOTICE`
         statt mit dem von NIP-01 verlangten `OK`. welshman ordnet
         Publish-Ergebnisse über die Event-Id aus dem `OK` zu — ohne `OK` bliebe
         der Thunk für immer `pending`, der Knopf für immer inert, und der
         Nutzer wartete auf ein Verdikt, das nie kommt. `waitForPublishError`
         (`js/publishResult.ts`) macht daraus nach 20 s einen Endzustand und
         hängt den echten NOTICE-Wortlaut an, wenn in der Zeit einer kam. Dieser
         Kasten ist die Stelle, an der das ankommt.

         `flux:callout variant="danger"` statt eines nachgebauten roten Kastens —
         dieselbe Regel wie im Issue-Blatt der Forge. --}}
    <flux:callout variant="danger" icon="exclamation-triangle" inline
                  x-show="topicError" x-cloak role="alert" data-forum-topic-error>
        <flux:callout.text class="text-xs!" x-text="topicError"></flux:callout.text>
    </flux:callout>

    <div class="flex flex-wrap items-center gap-2">
        {{-- Der Name des Knopfes WECHSELT NICHT, wenn er fliegt — er wird nur
             unbedienbar, und der Zustand steht als eigener Text daneben. Ein
             Knopf, der beim Drücken seinen Namen ändert, ist für die
             Sprachausgabe ein anderer Knopf (dieselbe Regel wie am
             Issue-Blatt). --}}
        <flux:button size="sm" variant="primary" data-forum-topic-submit="{{ $context }}"
                     x-on:click="submitTopic()"
                     ::disabled="topicBusy || topicDraft.trim().length === 0">{{ __('Thema anlegen') }}</flux:button>
        <flux:button size="sm" variant="ghost" data-forum-topic-cancel="{{ $context }}"
                     x-on:click="toggleTopicDraft()"
                     ::disabled="topicBusy">{{ __('Abbrechen') }}</flux:button>
        <span x-show="topicBusy" x-cloak role="status" class="text-xs text-muted">{{ __('Wird gesendet …') }}</span>
    </div>
</div>
