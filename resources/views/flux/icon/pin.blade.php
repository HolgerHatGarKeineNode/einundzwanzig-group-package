{{-- Credit: Lucide (https://lucide.dev), icon "pin" from lucide v1.16.0.

     ISC License — Copyright (c) 2026 Lucide Icons and Contributors.
     Permission to use, copy, modify, and/or distribute this software for any purpose with or
     without fee is hereby granted, provided that the above copyright notice and this
     permission notice appear in all copies. THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR
     DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
     MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL,
     DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS
     OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS
     ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.

     ── Why a thumbtack and not Heroicons' `map-pin` ─────────────────────────────────────
     "Pinned" used to be drawn as `map-pin`. In an app full of meetups and maps that glyph
     reads as "location", and next to a pinned chip on Start it looked like a stray marker
     (user report after the v1.13.0 device sighting). Heroicons has no thumbtack, so this
     one comes from Lucide, registered for the `flux:` prefix by `GroupServiceProvider` —
     every host of the package gets it without a copy of its own.

     ── `solid` = the same outline, filled ─────────────────────────────────────────────
     Lucide draws strokes only and has no solid set; the host copies of Lucide icons throw
     on `solid`. This one does not, because the pin toggle carries its state in the SHAPE
     as well as the colour (WCAG 1.4.1): filled = pinned, outline = not. The needle is a
     bare line and stays a stroke in both. --}}

@props([
    'variant' => 'outline',
])

@php
    $classes = Flux::classes('shrink-0')->add(
        match ($variant) {
            'outline' => '[:where(&)]:size-6',
            'solid' => '[:where(&)]:size-6',
            'mini' => '[:where(&)]:size-5',
            'micro' => '[:where(&)]:size-4',
        },
    );

    $strokeWidth = match ($variant) {
        'outline', 'solid' => 2,
        'mini' => 2.25,
        'micro' => 2.5,
    };
@endphp

<svg
    {{ $attributes->class($classes) }}
    data-flux-icon
    data-icon-pin
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="{{ $variant === 'solid' ? 'currentColor' : 'none' }}"
    stroke="currentColor"
    stroke-width="{{ $strokeWidth }}"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    data-slot="icon"
>
    <path d="M12 17v5" />
    <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
</svg>
