@props([
    'title' => '',
    'titleExpr' => null,
    'back' => null,
])

{{-- Einheitlicher Kopf aller Kern-Screens (Space/Directory/Einstellungen).
     Links steht — in dieser Reihenfolge:
       1. screen-interner `back` (z.B. Raum → Raumliste): Zurück-Pfeil.
       2. Host-Rücksprung (config('group.exit') gesetzt, z.B. Mobile-App-Tab):
          sichtbarer „‹ {label}"-Ausgang zurück in die Host-App — der Chat ist
          ein Vollbild-Takeover, ohne diesen Ausgang säße der Nutzer fest.
       3. sonst der Brand-Mark (eigenständiger Web-Client → Startseite).
     `subtitle`/`actions`-Slots füllen die Seiten. `x-data` wird durchgereicht,
     damit Alpine-Scopes (z.B. nostrAuth) die Slots umschließen. --}}
@php($exit = config('group.exit'))
<header {{ $attributes->class('mb-6 flex items-center gap-3') }}>
    @if ($back)
        <flux:button variant="ghost" size="sm" icon="arrow-left" :href="$back" wire:navigate aria-label="Zurück" />
    @elseif ($exit)
        <a href="{{ route($exit['route']) }}" wire:navigate aria-label="Zurück zu {{ $exit['label'] }}"
           class="pressable -ms-1 inline-flex shrink-0 items-center gap-0.5 rounded-full py-1.5 pe-3 ps-1.5 text-sm font-semibold text-accent">
            <flux:icon.chevron-left variant="micro" class="size-5" />
            <span>{{ $exit['label'] }}</span>
        </a>
    @else
        <a href="{{ route('home') }}" wire:navigate aria-label="Startseite" class="pressable shrink-0">
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
            <flux:heading size="xl" class="truncate" x-text="{{ $titleExpr }}">{{ $title }}</flux:heading>
        @else
            <flux:heading size="xl" class="truncate">{{ $title }}</flux:heading>
        @endif
        @isset($subtitle)
            {{ $subtitle }}
        @endisset
    </div>

    @isset($actions)
        <div class="flex shrink-0 items-center gap-1">{{ $actions }}</div>
    @endisset
</header>
