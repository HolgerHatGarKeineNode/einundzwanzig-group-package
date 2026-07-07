@props([
    'title' => '',
    'back' => null,
])

{{-- Einheitlicher Kopf aller Kern-Screens (Space/Directory/Einstellungen).
     Ohne `back` steht links der Brand-Mark (Link zur Startseite), sonst ein
     Zurück-Pfeil. `subtitle`/`actions`-Slots füllen die Seiten. `x-data` wird
     durchgereicht, damit Alpine-Scopes (z.B. nostrAuth) die Slots umschließen. --}}
<header {{ $attributes->class('mb-6 flex items-center gap-3') }}>
    @if ($back)
        <flux:button variant="ghost" size="sm" icon="arrow-left" :href="$back" wire:navigate aria-label="Zurück" />
    @else
        <a href="{{ route('home') }}" wire:navigate aria-label="Startseite" class="pressable shrink-0">
            <x-chat::app-brand-mark class="size-9" />
        </a>
    @endif

    <div class="min-w-0 flex-1">
        <flux:heading size="xl" class="truncate">{{ $title }}</flux:heading>
        @isset($subtitle)
            {{ $subtitle }}
        @endisset
    </div>

    @isset($actions)
        <div class="flex shrink-0 items-center gap-1">{{ $actions }}</div>
    @endisset
</header>
