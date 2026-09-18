@props([
    // 'chips' = the wrapping row on Start · 'bar' = the vertical section of the desktop
    // left bar. Two presentations of ONE list; everything else in this file is shared.
    'variant' => 'chips',
])

{{-- „Angeheftet" (D7) — the reader's own shortcuts, in the two places that show them.

     ── Why one component and not two blocks ───────────────────────────────────────────
     Since P6 the pins stand twice: as chips on Start and as a section at the top of the
     desktop left bar (D10). What they share is not the look but the TARGET TABLE — which
     path a `room:`/`article:`/`repo:`/`meetup:`/`area:` key leads to, and whether that
     path leaves the client. That table is built here in Blade, from the same `areas`
     config the Start tiles read, because `route()` belongs in Blade and the island must not
     carry a second copy of it. Written out twice it would be two answers to one question
     the moment a host redirects one area — which is exactly what `areas` allows.

     The keys and their order come from `$store.pinSet.rows` (`js/pinSetSync.ts`), the ONE
     selector over both sources: the NIP-44 blob and the Buzz `channel-stars`. The rows
     already carry the best label this device has; the display name of a room arrives late
     and re-renders when it does.

     ── Nothing renders while the set is empty ─────────────────────────────────────────
     A strip explaining that nothing is pinned would take the best row of the surface for a
     negation. Guests have pins too (`localStorage`, unioned into the account set on login),
     so this is not a member feature.

     `$store.pinSet.answered === false` is the one honest warning the list owes: the pin was
     kept locally, but no target relay confirmed the read the write hangs on
     (`decidePinPublish` refuses without an `EOSE`). Said once per surface, not per pin. --}}
@php($portalBasis = rtrim((string) config('group.portal_url', ''), '/'))
{{-- Area key → URL, built from the same `areas` config the tile grid on Start reads. A
     pinned area whose tile has no route of its own keeps its Portal URL, so the chip never
     leads somewhere that does not exist. --}}
@php($bereichsZiele = collect(config('group.areas', []))
    ->mapWithKeys(fn (array $bereich) => [
        $bereich['key'] => $bereich['route'] !== null
            ? route($bereich['route'])
            : $portalBasis.($bereich['path'] ?? '/'),
    ])->all())
{{-- A pinned MEETUP hangs on the same decision as the meetups TILE: since P4 the package
     has the page (D9), before it the area left the client. So the target is built from the
     area's target and not from a path of its own — otherwise a host that redirects the tile
     would keep a pin pointing somewhere else. --}}
@php($meetupBereich = collect(config('group.areas', []))->firstWhere('key', 'meetups'))
@php($meetupBasis = $bereichsZiele['meetups'] ?? $portalBasis)
@php($meetupExtern = ($meetupBereich['route'] ?? null) === null)

{{-- The two surfaces need different anchors: both exist in the same document at 1440 px
     (Start's chips in the stage, the bar's section in the left column), and one anchor for
     both would make every locator ambiguous. --}}
@php($anker = $variant === 'bar' ? 'data-rail-pins' : 'data-start-angeheftet')
{{-- Both sections are labelled by their own heading, so each keeps its name in the landmark
     list — two headings with one id would make the second label a lie. --}}
@php($kopfId = $variant === 'bar' ? 'rail-angeheftet' : 'start-angeheftet')

<section aria-labelledby="{{ $kopfId }}"
     {{ $attributes->class(['mb-4' => $variant === 'chips', 'pt-2' => $variant === 'bar']) }}
     x-data="{
         ziel(row) {
             if (row.prefix === 'area') { return (@js($bereichsZiele))[row.value] ?? '/start' }
             if (row.prefix === 'room') { return '/rooms/' + encodeURIComponent(row.value.slice(0, row.value.lastIndexOf('@'))) }
             if (row.prefix === 'article') { return '/articles/' + encodeURIComponent(row.value) }
             if (row.prefix === 'repo') { return '/forge/' + encodeURIComponent(row.value) }
             if (row.prefix === 'meetup') { return @js(rtrim((string) $meetupBasis, '/')) + '/' + encodeURIComponent(row.value) }
             return '/start'
         },
         extern(row) { return row.prefix === 'meetup' && @js($meetupExtern) },
     }"
     x-show="($store.pinSet?.rows ?? []).length > 0" x-cloak>

    @if ($variant === 'bar')
        {{-- The heading of a left-bar section, in the vocabulary of the room group heads
             next to it (`rail-group.blade.php`): uppercase, `text-xs`, muted. NOT a
             collapsible group — a pin is a shortcut the reader placed there himself, and
             putting it behind a chevron would answer a question nobody asked. --}}
        {{-- P3 (Entwurf C `screen-desktop`): die Sektion heißt „Deine Leiste" —
             das ist die Aussage des Artboards über diesen Block: was HIER steht,
             hat der Leser selbst dorthin gelegt (Start-Kachel anheften, Raum
             anheften). „Angeheftet" beschrieb die Technik (NIP-78/30078),
             „Deine Leiste" den Ort. Bewusst KEIN „anpassen"-Text-Link wie im
             Artboard: dort führt er zu einer Verwaltung der Leiste, die es hier
             nicht gibt — die Verwaltung sind die Zeilenmenüs (anheften/aufheben)
             direkt an den Einträgen. Ein Link ohne wahrhaftiges Ziel wäre eine
             Falschzusage (Nielsen #2). --}}
        <h2 id="{{ $kopfId }}" class="flex min-h-7 items-center px-2 text-xs font-semibold uppercase tracking-[0.08em] text-muted">
            {{ __('Deine Leiste') }}
        </h2>
    @else
        <h2 id="{{ $kopfId }}" class="mb-2 text-xs font-bold uppercase tracking-[0.08em] text-muted">
            {{ __('Angeheftet') }}
        </h2>
    @endif

    <div {{ $anker }} @class(['flex flex-wrap gap-2' => $variant === 'chips'])>
        <template x-for="row in ($store.pinSet?.rows ?? [])" :key="row.key">
            {{-- Two forms of the same link, and NOT one with a bound `wire:navigate`:
                 Livewire decides at click time whether an anchor is an SPA target by asking
                 for the ATTRIBUTE, and an attribute Alpine binds to `null` still has to be
                 removed in time. A pin that leaves the client (the Portal meetup page,
                 where a host redirects that area) must not be handed to the SPA router at
                 all. Same split as the reminder rows: two templates, one wrapper.

                 A pin is a link and not a button: it navigates. The type icon is
                 `aria-hidden` — the label carries the name, the icon only helps the eye
                 sort a mixed list. --}}
            <span class="contents">
                <template x-if="!extern(row)">
                    <a x-bind:href="ziel(row)" wire:navigate x-bind:data-pin-chip="row.key"
                       @class([
                           {{-- P2 (Entwurf C §2 `.chip`): 32 px hoch, Pill-Radius, Chip-Rahmen
                                #2f2f33, Text fg-2 #d4d4d4 in 14 px — keine Tint-Fläche
                                mehr, der Chip ist Kontur („keine Deko": Struktur kommt aus
                                Rahmen und Abstand). Typ-Icon Orange 14 px. --}}
                           'pressable inline-flex h-8 max-w-full items-center gap-1.5 rounded-pill border border-zinc-300 bg-white px-3 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 dark:border-border-chip dark:bg-transparent dark:text-zinc-300 dark:hover:bg-white/5' => $variant === 'chips',
                           'pressable flex min-h-11 w-full items-center gap-2 rounded-btn px-2 py-1 text-sm text-zinc-900 transition-colors hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800' => $variant === 'bar',
                       ])>
                        <span aria-hidden="true" class="shrink-0 text-accent">
                            <span x-show="row.prefix === 'room'"><flux:icon.hashtag variant="micro" class="size-4" /></span>
                            <span x-show="row.prefix === 'person'"><flux:icon.user variant="micro" class="size-4" /></span>
                            <span x-show="row.prefix === 'article'"><flux:icon.document-text variant="micro" class="size-4" /></span>
                            <span x-show="row.prefix === 'repo'"><flux:icon.code-bracket variant="micro" class="size-4" /></span>
                            <span x-show="row.prefix === 'area'"><flux:icon.squares-2x2 variant="micro" class="size-4" /></span>
                            <span x-show="row.prefix === 'meetup'"><flux:icon.map-pin variant="micro" class="size-4" /></span>
                        </span>
                        <span class="min-w-0 truncate" x-text="row.label"></span>
                        {{-- P2-Nachtrag (Entwurf C `screen-mobileweb`): der Ungelesen-Zähler
                             am Raum-Pin — dieselbe 18-px-Pille wie an der Befehlsleiste,
                             Datenlage `$store.unread.rooms` (Dennis-P2-Notiz). Nur in der
                             CHIPS-Form: die Rail-Zeile desselben Pins trägt ihren Zähler
                             schon über `rail-room-row`. Der Schlüssel ist derselbe Schnitt
                             wie in `ziel()` — ohne Relay-Suffix, so liegt der Raum im
                             Store. Kein Raum-Pin → falsy → kein Badge. --}}
                        @if ($variant === 'chips')
                            <x-group::unread-badge size="bar" :sr="false"
                                                   :count="'row.prefix === \'room\' ? $store.unread?.rooms?.[row.value.slice(0, row.value.lastIndexOf(\'@\'))] : null'" />
                        @endif
                    </a>
                </template>
                <template x-if="extern(row)">
                    <a x-bind:href="ziel(row)" rel="external noopener" x-bind:data-pin-chip="row.key"
                       @class([
                           {{-- P2 (Entwurf C §2 `.chip`): 32 px hoch, Pill-Radius, Chip-Rahmen
                                #2f2f33, Text fg-2 #d4d4d4 in 14 px — keine Tint-Fläche
                                mehr, der Chip ist Kontur („keine Deko": Struktur kommt aus
                                Rahmen und Abstand). Typ-Icon Orange 14 px. --}}
                           'pressable inline-flex h-8 max-w-full items-center gap-1.5 rounded-pill border border-zinc-300 bg-white px-3 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 dark:border-border-chip dark:bg-transparent dark:text-zinc-300 dark:hover:bg-white/5' => $variant === 'chips',
                           'pressable flex min-h-11 w-full items-center gap-2 rounded-btn px-2 py-1 text-sm text-zinc-900 transition-colors hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800' => $variant === 'bar',
                       ])>
                        <flux:icon.map-pin variant="micro" aria-hidden="true" class="size-4 shrink-0" />
                        <span class="min-w-0 truncate" x-text="row.label"></span>
                        <flux:icon.arrow-top-right-on-square variant="micro" class="size-3.5 shrink-0" />
                        <span class="sr-only">{{ __('(öffnet das Portal)') }}</span>
                    </a>
                </template>
            </span>
        </template>
    </div>

    <p x-show="$store.pinSet?.ready && !$store.pinSet?.answered" x-cloak
       data-angeheftet-unbestaetigt
       @class(['mt-2 text-xs text-muted' => $variant === 'chips', 'mt-1 px-2 text-xs text-muted' => $variant === 'bar'])>
        {{ __('Kein Relay hat deine Anheftungen bestätigt — sie gelten bis dahin nur auf diesem Gerät.') }}
    </p>
</section>
