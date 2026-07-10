{{-- Shell-Nav, config-getrieben (§8.2): iteriert `config('group.nav')` und
     rendert je Eintrag <x-group::nav-tab>. Die Tab-Menge ist damit eine
     Config-Zeile je Host (Web 3 · Mobile 4), das Item-Markup bleibt geteilt.
     Default-Config = die drei package-nativen Tabs → altes Layout unverändert.

     Fixiert am unteren Rand, in der max-w-md-Spalte zentriert (skaliert auf
     Desktop mit). @web wird dieselbe Komponente in P2 zur linken Rail — hier
     bleibt sie zunächst die Bottom-Bar (additiv). --}}
@php($items = config('group.nav', []))

{{-- backdrop-blur nur auf Web: eine fixe Nav mit backdrop-filter über
     scrollendem Inhalt ist der klassische Mobile-WebView-Scroll-Killer (Blur wird
     pro Frame neu berechnet → Ruckeln/schwarze Flächen). Auf Native daher opaker
     Hintergrund ohne Blur. --}}
@php($native = config('nativephp-internal.running'))
<nav
    aria-label="Hauptnavigation"
    @class([
        'fixed inset-x-0 bottom-0 z-40 mx-auto max-w-md border-t border-zinc-200 px-2 pb-safe md:max-w-lg lg:max-w-2xl dark:border-zinc-800',
        'bg-zinc-50 dark:bg-zinc-950' => $native,
        'bg-zinc-50/90 backdrop-blur-md dark:bg-zinc-950/90' => ! $native,
    ])
>
    {{-- Statische Spaltenklasse (JIT-sicher, beide Literale im Quelltext) je realer
         Tab-Zahl: Web 3 · Mobile 4. --}}
    @php($cols = count($items) === 4 ? 'grid-cols-4' : 'grid-cols-3')
    <div class="grid {{ $cols }}">
        @foreach ($items as $item)
            <x-group::nav-tab
                :route="$item['route']"
                :match="$item['match'] ?? null"
                :icon="$item['icon']"
                :label="$item['label']"
                :gate="$item['gate'] ?? 'guest'"
            />
        @endforeach
    </div>
</nav>
