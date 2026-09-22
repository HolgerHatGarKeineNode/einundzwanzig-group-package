@props([
    // ALPINE EXPRESSION that yields the pin key (`area:…`, `room:<h>@<relay>`,
    // `article:<coord>`, `repo:<coord>`, `meetup:<slug>`, `person:<hex>`). An expression and
    // not a value, because every caller sits inside an `x-for` or an island scope — the key
    // is `'room:' + room.h + '@' + url`, never a literal from the server.
    'schluessel',
    // What is being pinned, for the accessible name: „Raum", „Artikel", „Repository", …
    // The name has to say WHAT, otherwise a list of rows announces a dozen identical buttons.
    // Either `was` (one static word, the caller's list is uniform) or `wasExpr` — see below.
    'was' => null,
    // ALPINE EXPRESSION yielding that same word, for lists that are MIXED by necessity:
    // the pin bar holds rooms, articles, repos, meetups, areas and people side by side, and
    // no single static word names them all. The sentence stays whole and the `:was`
    // placeholder is filled where the word is known — the row — via `.split(':was')
    // .join(…)`, exactly the shape `rail-room-row` uses for `:name` (whole catalog key,
    // no fragment concatenation, `I18nCatalogGateTest` reads both forms).
    'wasExpr' => null,
    // 'icon' = the bare pin glyph (rows, headers) · 'menu' = a `flux:menu.item` for a menu
    // that already exists · 'chip' = a small × that sits INSIDE a chip (the pinned row on
    // Start, `pin-list`), where every row is pinned by definition.
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
     `I18nCatalogGateTest` enforces: the translator gets the sentence, not the fragment.

     With `wasExpr` the placeholder stays in the sentence and the row fills it at runtime;
     the two branches below are ONE answer about how a pin is named, not two. `Js::from`
     strings pass through `{{ }}` (Blade escapes the quotes, the HTML parser decodes them
     again — the measured finding at the top of this block). --}}
@php
    if ($wasExpr === null) {
        $labelAus = (string) \Illuminate\Support\Js::from(__('Anheftung von :was aufheben', ['was' => $was ?? __('Eintrag')]));
        $labelAn = (string) \Illuminate\Support\Js::from(__(':was anheften', ['was' => $was ?? __('Eintrag')]));
    } else {
        $labelAus = (string) \Illuminate\Support\Js::from(__('Anheftung von :was aufheben')).".split(':was').join({$wasExpr})";
        $labelAn = (string) \Illuminate\Support\Js::from(__(':was anheften')).".split(':was').join({$wasExpr})";
    }
@endphp

@if ($form === 'menu')
    <flux:menu.item icon="pin" x-on:click="$store.pinSet?.toggle({{ $schluessel }})">
        <span x-text="$store.pinSet?.has({{ $schluessel }}) ? {{ $labelAus }} : {{ $labelAn }}"></span>
    </flux:menu.item>
@elseif ($form === 'chip')
    {{-- The unpin control as part of the chip (v1.13.0 device sighting): a pin glyph next to
         the chip read as a stray map marker, not as a button. Inside a chip that is pinned by
         definition the action is "take it out", and × says that without a legend.

         Same contract as the icon form — `data-pin-toggle`/`data-pin-key`, `aria-pressed`,
         the bound `aria-label` („Anheftung von :was aufheben") — so every reader of the toggle
         keeps working. 24 × 24 (`size-6`), not the 44 px `icon-btn-touch` floor: that would
         burst the 32 px chip, and 24 × 24 is WCAG 2.5.8's own minimum. A plain `<button>`
         with `pressable`, so the host focus rules (`button.pressable:focus-visible`) paint its
         indicator like every other tappable surface. --}}
    <button type="button"
            data-pin-toggle
            x-bind:data-pin-key="{{ $schluessel }}"
            x-bind:aria-pressed="$store.pinSet?.has({{ $schluessel }}) ? 'true' : 'false'"
            x-bind:aria-label="$store.pinSet?.has({{ $schluessel }}) ? {{ $labelAus }} : {{ $labelAn }}"
            x-on:click.stop.prevent="$store.pinSet?.toggle({{ $schluessel }})"
            {{ $attributes->class('pressable inline-flex size-6 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-white/10 dark:hover:text-zinc-100') }}>
        <flux:icon.x-mark variant="micro" class="size-4" />
    </button>
@else
    {{-- `icon-btn-touch`: the house utility for iconic targets — 44 px on a coarse pointer,
         compact for a mouse (WCAG 2.5.5). `aria-pressed` makes the state audible without a
         second element telling it; the `aria-label` REPLACES the button's child text and
         therefore carries WHAT is being pinned. --}}
    <flux:button size="{{ $size }}" variant="ghost"
                 data-pin-toggle
                 x-bind:data-pin-key="{{ $schluessel }}"
                 x-bind:aria-pressed="$store.pinSet?.has({{ $schluessel }}) ? 'true' : 'false'"
                 x-bind:aria-label="$store.pinSet?.has({{ $schluessel }}) ? {{ $labelAus }} : {{ $labelAn }}"
                 x-on:click.stop.prevent="$store.pinSet?.toggle({{ $schluessel }})"
                 {{ $attributes->class('icon-btn-touch shrink-0') }}>
        {{-- Solid = pinned, outline = not. The SHAPE carries the state as well, not only the
             colour (WCAG 1.4.1) — and `aria-pressed` carries it for the screen reader.
             Two icons instead of `::variant`: `flux:icon` picks the SVG file at compile time,
             so an Alpine binding on `variant` lands as a meaningless attribute and never
             switches (house finding, measured three times). --}}
        <span x-show="$store.pinSet?.has({{ $schluessel }})" x-cloak>
            <flux:icon.pin variant="solid" class="size-4 text-brand-600 dark:text-brand-400" />
        </span>
        <span x-show="!$store.pinSet?.has({{ $schluessel }})">
            <flux:icon.pin class="size-4 text-muted" />
        </span>
    </flux:button>
@endif
