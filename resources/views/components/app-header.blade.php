@props([
    'title' => '',
    'titleExpr' => null,
    'back' => null,
    'backExpr' => null,
    // Zusatzklassen für die Zurück-Aktion. Der Raum blendet sie ab xl aus: mit
    // stehender Rail gibt es kein „zurück", es gibt „woanders hin" — und der
    // Thread bringt dort seinen eigenen Schließen-Knopf mit.
    // Bewusst per CSS (`xl:hidden`) statt durch bedingtes Rendern: `x-ref="threadClose"`
    // muss im DOM bleiben, sonst liefe der Fokus-Effekt des Threads ins Leere.
    // (Und: eine Blade-Direktive gehört nicht einmal in einen Kommentar — Blade
    // kompiliert sie auch dort, was hier 33 Tests mit einem ParseError gekippt hat.)
    'backClass' => '',
])

{{-- The one header of every core screen (Start/Bereich/Postfach/Ich).
     On the left, in this order:
       1. a screen-internal `back` (e.g. room → room list): the back arrow.
       2. otherwise the brand mark (→ Start).
     On the right, after `actions`, stands the AVATAR (P2) — the one way to „Ich".
     The `subtitle`/`actions` slots are filled by the pages. `x-data` is passed through so
     that Alpine scopes (e.g. nostrAuth) can wrap the slots.

     ── The host exit (`config('group.exit')`) is gone with P2 ─────────────────────
     It existed because the chat was a full-screen takeover NEXT TO the host's own nav:
     the app showed "Meetups · Termine · Karte · Profil" and the chat replaced the whole
     screen including that bar — without an exit the user was stuck. Since Concept C there
     is exactly ONE shell in both hosts; there is no "back into the app" any more, because
     you never left it. An exit pointing at the same frame would be a claim about a border
     that no longer exists. --}}
<header {{ $attributes->class('mb-6 flex items-center gap-3') }}>
    @if ($backExpr)
        {{-- JS-Rücksprung statt Navigate: für Vollbild-Takeover, die INNERHALB derselben
             Livewire-Seite auf-/zugehen (Thread-Ansicht). Kein href/wire:navigate — die
             Alpine-Aktion baut nur das Overlay ab. `x-ref="threadClose"` ist bewusst hier:
             Der Zurück-Button ist das Fokus-Ziel (Escape-Control) beim Öffnen des Dialogs,
             und dieser Zweig existiert NUR im Thread (kein anderer Screen setzt backExpr). --}}
        <flux:button variant="ghost" size="sm" icon="arrow-left" x-on:click="{{ $backExpr }}"
                     x-ref="threadClose" :class="$backClass" aria-label="{{ __('Zurück') }}" />
    @elseif ($back)
        <flux:button variant="ghost" size="sm" icon="arrow-left" :href="$back" wire:navigate aria-label="{{ __('Zurück') }}" />
    @else
        <a href="{{ route(config('group.start_route', 'group.start')) }}" wire:navigate aria-label="{{ __('Startseite') }}" class="pressable shrink-0">
            <x-group::app-brand-mark class="size-9" />
        </a>
    @endif

    @isset($leading)
        {{ $leading }}
    @endisset

    <div class="min-w-0 flex-1">
        {{-- `titleExpr` (Alpine-Ausdruck aus umschließendem Scope) überschreibt den
             SSR-Titel nach Alpine-Init; `{{ $title }}` bleibt Fallback vor dem Hydrate. --}}
        @if ($titleExpr)
            <flux:heading level="1" size="xl" class="truncate" x-text="{{ $titleExpr }}">{{ $title }}</flux:heading>
        @else
            <flux:heading level="1" size="xl" class="truncate">{{ $title }}</flux:heading>
        @endif
        @isset($subtitle)
            {{ $subtitle }}
        @endisset
    </div>

    <div class="flex shrink-0 items-center gap-1">
        @isset($actions)
            {{ $actions }}
        @endisset

        {{-- The avatar is a component of its own because the room list builds its own
             header and carries it there as well — the reasoning lives in
             `me-avatar.blade.php`. --}}
        <x-group::me-avatar />
    </div>
</header>
