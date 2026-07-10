@props([
    // Alpine-Ausdruck der Ziel-Nachricht (`m` in der Zeile, `menuFor` im Modal).
    'message' => 'm',
    // Optionaler Alpine-Ausdruck NACH dem Reagieren (Web-Popover: `open = false`).
    // Das native Modal schließt react() selbst (closeMessageMenu) — dort leer.
    'onpick' => '',
])

@php
    $after = $onpick ? '; '.$onpick : '';
    // Emoji-Tile-Verhalten einmal definiert (MRU-Reihe + Grid teilen es sich).
    // Custom-Emoji originalgetreu (`:shortcode:` + roher emoji-Tag), Standard mit Label
    // für die MRU. `{!! !!}`: die Ausdrücke enthalten Anführungszeichen → nicht escapen.
    $pick = "(e.custom ? react($message, ':' + e.shortcode + ':', ['emoji', e.shortcode, e.url]) : react($message, e.u, undefined, e.label))$after";
    // aria-label übersetzbar: EIN Präfix-Key + der Emoji-Token am Ende (Fragment-
    // Übersetzung „Mit … reagieren" bräche in jeder Zielsprache die Grammatik).
    // Einfach-gequotetes JS-Literal (das Attribut :aria-label ist doppelt gequotet).
    $pickPrefix = "'".str_replace("'", "\\'", __('Reagieren mit '))."'";
    $pickLabel = "$pickPrefix + (e.custom ? (':' + e.shortcode + ':') : e.label)";
    $pickTitle = 'e.custom ? e.shortcode : e.label';
@endphp

{{-- C1-Emoji-Picker: „Zuletzt benutzt"-Reihe + Suche + Kategorie-Tabs + volles
     Standard-Set (emojibase, lazy) + ein erster Tab „Deine Emojis" (NIP-30 aus
     deinem Profil). Eine Quelle für Web-Popover UND natives „…"-Modal.
     `react()`/{{ $message }} kommen per Alpine-Scope-Chain von der Insel. --}}
<div x-data="emojiPicker()"
     {{ $attributes->merge(['class' => 'flex w-[min(21rem,86vw)] flex-col gap-2']) }}>

    {{-- „Zuletzt benutzt" (MRU): dynamisch, leer beim ersten Gebrauch → keine Reihe. --}}
    <template x-if="recent.length">
        <div class="flex items-center gap-0.5 overflow-x-auto" role="group" aria-label="{{ __('Zuletzt benutzt') }}"
             style="scrollbar-width: thin;">
            <template x-for="e in recent" :key="e.custom ? ':' + e.shortcode : e.u">
                <button type="button"
                        x-on:click="{!! $pick !!}"
                        :aria-label="{!! $pickLabel !!}"
                        :title="{!! $pickTitle !!}"
                        class="pressable flex size-9 shrink-0 items-center justify-center rounded-tile text-xl leading-none hover:bg-brand-500/15">
                    <template x-if="e.custom"><img :src="e.src" :alt="e.shortcode" loading="lazy" class="size-6 object-contain" /></template>
                    <template x-if="!e.custom"><span x-text="e.u"></span></template>
                </button>
            </template>
        </div>
    </template>

    {{-- Suchfeld: eigenes Styling (Flux passt hier nicht), Auto-Fokus beim Öffnen. --}}
    <div class="relative">
        <svg class="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted"
             viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true">
            <circle cx="9" cy="9" r="6" /><path d="m14 14 4 4" stroke-linecap="round" />
        </svg>
        <input x-model.debounce.150ms="search" type="search"
               placeholder="{{ __('Emoji suchen…') }}" aria-label="{{ __('Emoji suchen') }}"
               class="w-full rounded-tile border border-white/10 bg-white/5 py-1.5 pl-8 pr-3 text-sm text-white placeholder:text-muted focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/40" />
    </div>

    {{-- Kategorie-Tabs: aktiver Tab mit Bitcoin-Underline. Bei aktiver Suche verborgen. --}}
    <div x-show="ready && !search.trim()" class="-mx-0.5 flex gap-0.5 overflow-x-auto px-0.5 pb-1"
         role="tablist" aria-label="{{ __('Emoji-Kategorien') }}" style="scrollbar-width: thin;">
        <template x-for="t in tabs" :key="t.key">
            <button type="button" role="tab" x-on:click="activeTab = t.key" :aria-selected="activeTab === t.key"
                    :title="t.name" :aria-label="t.name"
                    class="pressable relative shrink-0 rounded-tile px-1.5 pb-1.5 pt-1 text-lg leading-none transition-colors"
                    :class="activeTab === t.key ? 'text-white' : 'opacity-55 hover:opacity-100'">
                <span x-text="t.icon"></span>
                <span x-show="activeTab === t.key"
                      class="absolute inset-x-1 -bottom-0.5 h-0.5 rounded-full bg-brand-500"></span>
            </button>
        </template>
    </div>

    {{-- Emoji-Grid: nur das aktive Segment (aktiver Tab oder Suchtreffer). --}}
    <div class="grid max-h-48 grid-cols-8 gap-0.5 overflow-y-auto overscroll-contain pr-0.5"
         style="scrollbar-width: thin;" aria-live="polite">
        <template x-for="e in results" :key="e.custom ? ':' + e.shortcode : e.u">
            <button type="button"
                    x-on:click="{!! $pick !!}"
                    :aria-label="{!! $pickLabel !!}"
                    :title="{!! $pickTitle !!}"
                    class="pressable flex aspect-square items-center justify-center rounded-tile text-xl leading-none hover:bg-brand-500/15">
                <template x-if="e.custom">
                    <img :src="e.src" :alt="e.shortcode" loading="lazy" class="size-6 object-contain" />
                </template>
                <template x-if="!e.custom"><span x-text="e.u"></span></template>
            </button>
        </template>
    </div>

    {{-- Zustände: Laden / leer. --}}
    <template x-if="!ready">
        <p class="py-6 text-center text-xs text-muted">{{ __('Emojis laden…') }}</p>
    </template>
    <template x-if="ready && !results.length">
        <p class="py-6 text-center text-xs text-muted"
           x-text="(activeTab === 'custom' && customTotal > 0) ? @js(__('Emojis laden…')) : (search.trim() ? (@js(__('Keine Treffer für „')) + search.trim() + '“') : @js(__('Keine Custom-Emojis in deinem Profil')))"></p>
    </template>
</div>
