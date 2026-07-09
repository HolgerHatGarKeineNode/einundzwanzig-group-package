@props([
    // Alpine-Ausdruck der Ziel-Nachricht (z.B. `m` in der Zeile, `menuFor` im Modal).
    'message' => 'm',
    // Optionaler Alpine-Ausdruck NACH dem Reagieren (z.B. `open = false`, um das Popover zu schließen).
    'onpick' => '',
])

{{-- C1-Reaktions-Picker: das Standard-Emoji-Set (NIP-25) als Button-Reihe. Genutzt
     vom Web-Popover UND vom nativen „…"-Modal — eine Quelle, kein Duplikat. flux:menu
     rendert rohe Kinder nicht klickbar, darum eigene Buttons statt eines Flux-Menüs.
     Space-Custom-Emoji (NIP-30) werden gerendert + getoggelt, hier aber (noch) nicht
     als Picker-Quelle angeboten. Bitcoin-nah: 🤙 ⚡. --}}
@php
    $reactionSet = ['👍', '❤️', '😂', '🎉', '🤙', '⚡'];
@endphp
@foreach ($reactionSet as $emoji)
    <button type="button"
            x-on:click="react({{ $message }}, @js($emoji)){{ $onpick ? '; '.$onpick : '' }}"
            {{ $attributes->merge(['class' => 'pressable rounded-tile px-1.5 py-1 text-lg hover:bg-brand-500/15']) }}
            aria-label="Mit {{ $emoji }} reagieren">{{ $emoji }}</button>
@endforeach
