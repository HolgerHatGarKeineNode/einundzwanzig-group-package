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

{{-- Anhang-Vorschau: zugeschnittenes Bild wartet auf Senden (Proxy-Preset `msg`). --}}
<div x-show="{{ $attachment }}" x-cloak class="surface-card mb-1 flex items-center gap-3 px-3 py-2">
    <img :src="$img({{ $attachment }}?.url, 'msg')" alt="{{ __('Anhang-Vorschau') }}"
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

    <flux:textarea x-ref="{{ $composerRef }}" x-model="{{ $draft }}" rows="1" resize="none" class="flex-1"
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
