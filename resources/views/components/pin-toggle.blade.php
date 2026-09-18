@props([
    // ALPINE EXPRESSION that yields the pin key (`area:…`, `room:<h>@<relay>`,
    // `article:<coord>`, `repo:<coord>`, `meetup:<slug>`, `person:<hex>`). An expression and
    // not a value, because every caller sits inside an `x-for` or an island scope — the key
    // is `'room:' + room.h + '@' + url`, never a literal from the server.
    'schluessel',
    // What is being pinned, for the accessible name: „Raum", „Artikel", „Repository", …
    // The name has to say WHAT, otherwise a list of rows announces a dozen identical buttons.
    'was',
    // 'icon' = the bare pin glyph (rows, headers) · 'menu' = a `flux:menu.item` for a menu
    // that already exists.
    'form' => 'icon',
    'size' => 'xs',
])

{{-- ── "Anheften" on every object (P3, D7/D8) ─────────────────────────────────────

     ONE component for all five kinds of object, and the reason is not thrift: D7 promises
     that "pinned" means the same thing everywhere. Five hand-written buttons would be five
     opportunities to read the state from a different source — and exactly one of them would
     be the one a user taps.

     The state comes from `$store.pinSet` (`js/pinSetSync.ts`) only, which carries the union
     of the reader's own 30078 set and Buzz' `channel-stars`. Writing goes through `toggle()`,
     which routes on its own: a room of the Buzz workspace ends up in `channel-stars` (so Buzz
     Desktop sees the same pin), everything else in the reader's own set.

     ── Visible for GUESTS, deliberately ────────────────────────────────────────────
     A guest has no key; his set lives in `localStorage` and is unioned into the account set
     on login (D7). So the button works — it just publishes nothing. A greyed-out control
     would be the wrong answer here.

     ── What the button does NOT do ─────────────────────────────────────────────────
     It reports no success. A toast per pin would be pure noise on a chip row one curates; the
     chip row on Start IS the feedback. If the write fails (no `EOSE` from any target relay)
     the pin stays local and `$store.pinSet.answered` is `false` — the surface on Start says
     that once, instead of repeating it at every button.

     The two sentences are built HERE in PHP and inserted as a JS literal — NOT with `@js()`
     in the attribute list of a `<flux:…>` tag. That is a house finding, not taste: there the
     directive is NOT executed and lands verbatim in the Alpine expression (P5 finding;
     `ReportFixesTest` holds that no `@js(` ever reaches the rendered HTML). `Js::from` is what
     `@js` compiles to; Blade escapes the quotes to `&quot;`, and the HTML parser decodes them
     again before Alpine sees them.

     Whole sentences with a `:was` placeholder instead of concatenation — the house rule
     `I18nCatalogGateTest` enforces: the translator gets the sentence, not the fragment. --}}
@php($labelAn = __(':was anheften', ['was' => $was]))
@php($labelAus = __('Anheftung von :was aufheben', ['was' => $was]))

@if ($form === 'menu')
    <flux:menu.item icon="map-pin" x-on:click="$store.pinSet?.toggle({{ $schluessel }})">
        <span x-text="$store.pinSet?.has({{ $schluessel }}) ? {{ \Illuminate\Support\Js::from($labelAus) }} : {{ \Illuminate\Support\Js::from($labelAn) }}"></span>
    </flux:menu.item>
@else
    {{-- `icon-btn-touch`: the house utility for iconic targets — 44 px on a coarse pointer,
         compact for a mouse (WCAG 2.5.5). `aria-pressed` makes the state audible without a
         second element telling it; the `aria-label` REPLACES the button's child text and
         therefore carries WHAT is being pinned. --}}
    <flux:button size="{{ $size }}" variant="ghost"
                 data-pin-toggle
                 x-bind:data-pin-key="{{ $schluessel }}"
                 x-bind:aria-pressed="$store.pinSet?.has({{ $schluessel }}) ? 'true' : 'false'"
                 x-bind:aria-label="$store.pinSet?.has({{ $schluessel }}) ? {{ \Illuminate\Support\Js::from($labelAus) }} : {{ \Illuminate\Support\Js::from($labelAn) }}"
                 x-on:click.stop.prevent="$store.pinSet?.toggle({{ $schluessel }})"
                 {{ $attributes->class('icon-btn-touch shrink-0') }}>
        {{-- Solid = pinned, outline = not. The SHAPE carries the state as well, not only the
             colour (WCAG 1.4.1) — and `aria-pressed` carries it for the screen reader.
             Two icons instead of `::variant`: `flux:icon` picks the SVG file at compile time,
             so an Alpine binding on `variant` lands as a meaningless attribute and never
             switches (house finding, measured three times). --}}
        <span x-show="$store.pinSet?.has({{ $schluessel }})" x-cloak>
            <flux:icon.map-pin variant="solid" class="size-4 text-brand-600 dark:text-brand-400" />
        </span>
        <span x-show="!$store.pinSet?.has({{ $schluessel }})">
            <flux:icon.map-pin class="size-4 text-muted" />
        </span>
    </flux:button>
@endif
