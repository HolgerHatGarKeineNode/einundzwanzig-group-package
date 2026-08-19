@php
    // Geteilter Chat-Composer (P3): EINE Eingabezeile für Raum UND Thread. `$context`
    // ('room'|'thread') wählt Draft/Refs/Sende-Aktion; der Reply-Kontext + Send-Error bleiben
    // beim jeweiligen Caller (divergieren: Raum hat replyTo/editingId/sharing, Thread threadReplyTo).
    $isThread = $context === 'thread';
    $draft = $isThread ? 'threadDraft' : 'draft';
    $composerRef = $isThread ? 'threadComposer' : 'composer';
    $imageRef = $isThread ? 'threadImageInput' : 'imageInput';
    $attachment = $isThread ? 'threadAttachment' : 'attachment';
    $sendAction = $isThread ? 'sendComment()' : 'send()';
    $sendDisabled = $isThread
        ? "{$draft}.trim().length === 0 && !{$attachment}"
        : "sending || ({$draft}.trim().length === 0 && !sharing && !{$attachment})";
@endphp

{{-- Anhang-Vorschau: zugeschnittenes Bild wartet auf Senden.

     `previewUrl` (eine `data:`-URL aus den gerade zugeschnittenen Bytes, siehe
     `js/uploads.ts`) hat VORRANG vor `$img(url)`. Grund: auf einem Buzz-Space liegt der
     frische Upload unter `…/media/…` und ist auth-pflichtig; `$img()` gibt dafür
     bewusst `''` zurück (Wache in `js/mediaGuard.ts`), und die Kachel blieb leer — der
     Nutzer sah sein eigenes Bild nicht. Der Rückfall auf `$img()` bleibt für den
     Vereins-Blossom und für Anhänge ohne Vorschau-Bytes stehen.

     `data-composer` benennt den Kontext im DOM. Grund: beide Composer rendern
     dieselbe Vorschau mit demselben Text, und Tests unterschieden sie bisher über
     die DOM-REIHENFOLGE (`.first()`). Die ist mit der Desktop-Shell gekippt — der
     Thread-Composer sitzt seit dem Panel-Umbau IM Thread-Block und damit vor dem
     Raum-Composer. Eine Reihenfolge ist kein Vertrag; dieser Haken ist einer. --}}
<div x-show="{{ $attachment }}" x-cloak data-composer="{{ $context }}"
     class="surface-card mb-1 flex items-center gap-3 px-3 py-2">
    <img :src="{{ $attachment }}?.previewUrl || $img({{ $attachment }}?.url, 'msg')" alt="{{ __('Anhang-Vorschau') }}"
         class="size-14 shrink-0 rounded-tile object-cover" />
    <div class="min-w-0 flex-1 text-xs text-muted">{{ __('Bild angehängt') }}</div>
    <flux:button size="xs" variant="ghost" icon="x-mark" class="icon-btn-touch"
                 x-on:click="{{ $attachment }} = null" aria-label="{{ __('Anhang entfernen') }}" />
</div>

{{-- Verstecktes Datei-Feld → pickImage öffnet dasselbe Crop-Overlay in beiden Kontexten. --}}
<input type="file" accept="image/*" x-ref="{{ $imageRef }}" class="hidden"
       x-on:change="pickImage($event.target)" aria-hidden="true" tabindex="-1" />

<div class="relative flex items-end gap-2">
    {{-- @-Mention-Autocomplete (C4, geteilt): Pfeile wählen, Enter/Tab übernimmt, Escape schließt.
         pickMention splict in den richtigen Draft (onComposerInput merkt sich den Kontext). --}}
    <template x-if="mentionOpen">
        <div class="surface-card absolute bottom-full left-0 z-30 mb-1 max-h-56 w-full max-w-xs overflow-y-auto rounded-card p-1 shadow-xl"
             x-on:click.stop>
            <template x-for="(item, i) in mentionItems" :key="item.pubkey">
                <button type="button" x-on:click="pickMention(item)" x-on:mouseenter="mentionIndex = i"
                        class="pressable flex w-full items-center gap-2 rounded-tile px-2 py-1.5 text-left"
                        :class="mentionIndex === i ? 'bg-brand-500/15' : ''">
                    <x-group::nostr-avatar picture="item.picture" name="item.name" />
                    <span class="truncate text-sm" x-text="item.name"></span>
                </button>
            </template>
        </div>
    </template>

    @if ($isThread)
        {{-- Thread: nur Bild anhängen. Umfrage/Zap-Ziel sind raum-scoped (eigene Kinds 1068/9041,
             keine thread-Standard-Verankerung) → hier bewusst nicht. --}}
        <flux:button type="button" variant="ghost" icon="photo" class="shrink-0 icon-btn-touch"
                     x-on:click="$refs.{{ $imageRef }}.click()" aria-label="{{ __('Bild anhängen') }}" />
    @else
        {{-- Raum: „+"-Menü bündelt Bild + Umfrage + Zap-Ziel (spart Composer-Platz). --}}
        <flux:dropdown position="top" align="start" class="shrink-0">
            <flux:button type="button" variant="ghost" icon="plus" class="icon-btn-touch" aria-label="{{ __('Anhängen') }}" />
            <flux:menu>
                <flux:menu.item icon="photo" x-on:click="$refs.{{ $imageRef }}.click()">{{ __('Bild') }}</flux:menu.item>
                <flux:menu.item icon="chart-bar" x-on:click="openPollCreate()">{{ __('Umfrage') }}</flux:menu.item>
                <template x-if="zapsEnabled">
                    <flux:menu.item icon="trophy" x-on:click="openGoalCreate()">{{ __('Zap-Ziel') }}</flux:menu.item>
                </template>
            </flux:menu>
        </flux:dropdown>
    @endif

    {{-- Emoji-Picker für den ENTWURF (C1). Nur wo mit einem echten Zeigegerät bedient
         wird und nicht in der nativen App — auf Touch liefert die Systemtastatur
         Emojis, ein Knopf wäre dort doppelt.

         `x-if` und nicht `hidden`/`x-show`: der Picker lädt emojibase nach und mountet
         ein Grid mit hunderten Knoten. Ein per CSS verstecktes `x-data` bootet trotzdem
         mit (derselbe Grund, aus dem die Rail an `$store.viewport.desktop` per x-if
         hängt — siehe viewport.ts). `$store.viewport.mouse` ist die Bedienungs-, nicht
         die Breitenfrage: ein breites Tablet ist Desktop-Layout und trotzdem Touch.

         Konstruktion wie der Reaktions-Picker der Zeile: Panel ans <body> teleportiert
         (der Composer-Container würde es abschneiden), `fixed` positioniert und nach
         OBEN aufgeklappt (reactionPopover kippt nur nach unten, wenn oben kein Platz
         ist). `reactionPopover` ist trotz des Namens der generische Panel-Positionierer;
         nicht umbenannt, weil das den Reaktionspfad angefasst hätte.

         `align: 'start'` — dieser Trigger sitzt am LINKEN Rand des Composers, der
         Reaktions-Trigger am rechten Ende einer Zeile. Mit dem Default (`'end'`,
         rechtsbündig, nach links auslaufend) lag das Panel im Desktop-Chassis zu
         189 von 354 px über der Navigations-Rail und bei 1279 px zu zwei Dritteln
         im leeren Seitenrand — es gehörte optisch zu allem außer zu seinem Knopf.
         Linksbündig wächst es in die Chat-Spalte, bündig zur Knopfkante. --}}
    <template x-if="$store.viewport.mouse">
        <div x-data="reactionPopover({ align: 'start' })" x-on:click.stop class="shrink-0">
            {{-- `::aria-expanded` (nicht `:aria-expanded`): auf einer flux:-Komponente
                 hielte Blade das einfache `:` für seine eigene PHP-Bindung. Der
                 Aufklapp-Zustand gehört an den Knopf (ARIA-APG Disclosure) — ohne ihn
                 meldet der Screenreader denselben Knopf offen wie geschlossen.
                 `!text-brand-*` mit Bang: Flux' eigenes `text-zinc-800 dark:text-white`
                 steht bei gleicher Spezifität im gebauten Stylesheet HINTER den
                 brand-Farben (Reihenfolge der @theme-Deklaration) und gewänne sonst. --}}
            <flux:button type="button" x-ref="trigger" variant="ghost" icon="face-smile" class="icon-btn-touch"
                         x-on:click="toggle()" ::aria-expanded="open"
                         ::class="open ? '!text-brand-700 dark:!text-brand-400' : ''"
                         aria-label="{{ __('Emoji einfügen') }}" />
            {{-- x-if (lazy-mount) + x-teleport getrennt verschachteln — beides auf EINEM
                 template teleportiert bei jedem Tick neu (Leak). --}}
            <template x-if="open">
                <div>
                    <template x-teleport="body">
                        {{-- x-on:click.stop: nach <body> teleportiert ist der .stop-Wrapper
                             kein Vorfahre mehr → ohne .stop schlösse ein Klick im Picker das
                             Thread-Overlay (click.outside).

                             x-init, zwei Dinge:
                             1. Fokus ins Suchfeld. Das Panel hängt am ENDE des <body> und
                                damit hinter allem in der Tab-Reihenfolge; ohne diesen Schritt
                                tabbt man aus dem Knopf erst durch Textarea und Senden. Escape
                                gibt den Fokus an den Knopf zurück (APG), sonst landete er am
                                Seitenanfang.
                             2. ResizeObserver → reposition(). Zweiter Gurt, nicht der Träger:
                                seit reposition() das nach oben öffnende Panel an seiner
                                UNTERkante verankert, überlebt eine Höhenänderung (Ladezustand →
                                volles Grid, Suchfilter, MRU-Reihe) die Position von selbst — die
                                Panelhöhe steht gar nicht mehr in der Rechnung (Begründung am
                                reactionPopover in bridge.ts). Der Beobachter deckt noch, was
                                dort nicht hingehört: eine Trigger-Bewegung, während das Panel
                                offen ist (Composer wächst beim Tippen mit). Er ruft dieselbe
                                Rechnung erneut auf; sie ist idempotent. Die globale Loop-Bremse
                                für ResizeObserver steht in bridge.ts
                                (installResizeObserverLoopFilter). --}}
                        <div x-ref="panel" x-transition.opacity :style="panelStyle"
                             x-on:click.stop
                             x-on:click.outside="closeUnless($event)"
                             x-on:keydown.escape.window="open = false; $refs.trigger?.focus()"
                             x-init="$nextTick(() => $el.querySelector('input[type=search]')?.focus());
                                     new ResizeObserver(() => reposition()).observe($el)"
                             class="surface-card fixed z-50 rounded-card p-2 shadow-xl">
                            <x-group::emoji-picker mode="insert" target="{{ $isThread ? 'thread' : 'main' }}"
                                                   onpick="open = false" />
                        </div>
                    </template>
                </div>
            </template>
        </div>
    </template>

    {{-- Ab xl eine Spur größer (15px statt 14px). NUR auf Desktop: eine Schriftgröße
         im Chat zu ändern verschiebt Zeilenumbrüche und damit die Scroll-Arithmetik
         (`atBottom`, Chip-Lane-Reservierung) — mobil bleibt es deshalb bei 14px, bis
         das jemand eigens misst. --}}
    <flux:textarea x-ref="{{ $composerRef }}" x-model="{{ $draft }}" rows="1" resize="none" class="flex-1 xl:text-[0.9375rem]"
                   placeholder="{{ $isThread ? __('Im Thread antworten…') : __('Nachricht schreiben…') }}"
                   aria-label="{{ $isThread ? __('Antwort schreiben') : __('Nachricht schreiben') }}"
                   x-on:focus="{!! $isThread ? '' : 'atBottom && scrollToBottom()' !!}"
                   x-on:input="autoGrow($event.target); sendError = ''; onComposerInput($event.target, '{{ $isThread ? 'thread' : 'main' }}')"
                   x-on:paste="pasteImage($event)"
                   x-on:keydown="
                       if (mentionOpen) {
                           if ($event.key === 'ArrowDown') { $event.preventDefault(); mentionIndex = (mentionIndex + 1) % mentionItems.length; return }
                           if ($event.key === 'ArrowUp') { $event.preventDefault(); mentionIndex = (mentionIndex - 1 + mentionItems.length) % mentionItems.length; return }
                           if ($event.key === 'Enter' || $event.key === 'Tab') { $event.preventDefault(); pickMention(mentionItems[mentionIndex]); return }
                           if ($event.key === 'Escape') { $event.preventDefault(); closeMentions(); return }
                       }
                       if ($event.key === 'Enter' && !$event.shiftKey && !isMobile) { $event.preventDefault(); {{ $sendAction }} }" />

    {{-- {!! !!} bei ::disabled: die Expression enthält `&&`; {{ }} würde es zu `&amp;&amp;`
         escapen und Alpines Ausdruck brechen. Send-Button gesplittet, weil inline-@if IN einem
         flux-Tag den Flux-Attribut-Parser bricht (Raum: Loading-Spinner; Thread: ohne). --}}
    @if ($isThread)
        <flux:button type="button" variant="primary" icon="paper-airplane" class="icon-btn-touch"
                     x-on:click="{{ $sendAction }}" ::disabled="{!! $sendDisabled !!}"
                     aria-label="{{ __('Antwort senden') }}" />
    @else
        <flux:button type="button" variant="primary" icon="paper-airplane" class="icon-btn-touch" :loading="true"
                     x-on:click="{{ $sendAction }}" ::data-loading="sending" ::disabled="{!! $sendDisabled !!}"
                     aria-label="{{ __('Senden') }}" />
    @endif
</div>
