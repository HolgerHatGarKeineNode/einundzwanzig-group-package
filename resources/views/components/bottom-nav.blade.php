{{-- Bottom-Nav der Hauptscreens (Räume/Mitglieder/Einstellungen), §12 mobile-
     first. Fixiert am unteren Rand, in der max-w-md-Spalte zentriert — skaliert
     auf Desktop mit. Optik an einundzwanzig-mobile-app angeglichen: pro Tab ein
     Aktiv-Pill (nav-pill) oben, solid/outline-Icon-Wechsel und Akzentfarbe. --}}
@php
    $items = [
        ['route' => 'chat.spaces', 'match' => 'chat.spaces', 'icon' => 'chat-bubble-left-right', 'label' => 'Räume'],
        ['route' => 'chat.directory', 'match' => 'chat.directory', 'icon' => 'users', 'label' => 'Mitglieder'],
        ['route' => 'chat.space.settings', 'match' => 'chat.space.settings', 'icon' => 'cog-6-tooth', 'label' => 'Einstellungen'],
    ];
@endphp

<nav class="fixed inset-x-0 bottom-0 z-40 mx-auto max-w-md border-t border-zinc-200 bg-zinc-50/90 px-2 pb-safe backdrop-blur-md dark:border-zinc-800 dark:bg-zinc-950/90">
    <div class="grid grid-cols-3">
        @foreach ($items as $item)
            @php($active = request()->routeIs($item['match']))
            <a
                href="{{ route($item['route']) }}"
                wire:navigate
                @if ($active) aria-current="page" @endif
                @class([
                    'pressable relative flex flex-col items-center justify-center gap-1 py-2.5',
                    'text-accent' => $active,
                    'text-zinc-500 active:text-zinc-700 dark:text-zinc-400 dark:active:text-zinc-200' => ! $active,
                ])
            >
                @if ($active)
                    <span class="nav-pill absolute inset-x-0 top-0 mx-auto h-1 w-8 rounded-full bg-accent" aria-hidden="true"></span>
                @endif
                <flux:icon :name="$item['icon']" :variant="$active ? 'solid' : 'outline'" class="size-6" />
                <span class="text-[11px] font-semibold leading-none">{{ $item['label'] }}</span>
            </a>
        @endforeach
    </div>
</nav>
