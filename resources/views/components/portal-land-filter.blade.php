@props([
    // list<string> — lower-case ISO-3166-1 alpha-2 codes that actually occur
    'laender' => [],
    'land' => '',
])

{{-- The region filter of the Portal lists.

     `variant="listbox"` and not a native `<select>`: the Android WebView renders the
     system dialog of a native select in its own light theme regardless of the page, and
     this surface is the same markup in the app as on the web (measured in the companion,
     where the same rule stands on every select).

     The FLAG is built from the country code with regional indicator symbols instead of
     shipping a table: `de` → 🇩🇪 is `U+1F1E6 + (letter - 'a')` per letter, which is the
     whole rule. A table of 249 entries would be a second truth about something arithmetic. --}}
@php
    $flagge = static function (string $code): string {
        if (strlen($code) !== 2 || preg_match('/^[a-z]{2}$/', $code) !== 1) {
            return '🏳️';
        }

        return mb_chr(0x1F1E6 + (ord($code[0]) - 97), 'UTF-8').mb_chr(0x1F1E6 + (ord($code[1]) - 97), 'UTF-8');
    };
@endphp

<flux:select variant="listbox" :prefix="__('Region')" wire:model.live="land" data-portal-land
             :aria-label="__('Region wählen')" {{ $attributes }}>
    <flux:select.option value="">🌍 {{ __('Alle Länder') }}</flux:select.option>
    @foreach ($laender as $code)
        <flux:select.option value="{{ $code }}">{{ $flagge($code) }} {{ strtoupper($code) }}</flux:select.option>
    @endforeach
</flux:select>
