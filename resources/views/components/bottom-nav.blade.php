{{-- Shell-Nav, config-getrieben (§8.2): iteriert `config('group.nav')` und
     rendert je Eintrag <x-group::nav-tab>. Die Tab-Menge ist damit eine
     Config-Zeile je Host (Web 3 · Mobile 4), das Item-Markup bleibt geteilt.
     Default-Config = die drei package-nativen Tabs → altes Layout unverändert.

     Fixiert am unteren Rand, in der max-w-md-Spalte zentriert (skaliert auf
     Desktop mit). @web wird dieselbe Komponente in P2 zur linken Rail — hier
     bleibt sie zunächst die Bottom-Bar (additiv). --}}
@props([
    // 'bottom' = die fixe Bar am unteren Rand (Mobil, unverändert).
    // 'rail'   = derselbe Tab-Satz senkrecht in der Fußzeile des Desktop-Navigators.
    'orientation' => 'bottom',
])
@php($items = config('group.nav', []))
@php($rail = $orientation === 'rail')

{{-- Rail-Form: kein `fixed`, kein Raster, keine Backdrop-Frage — eine schlichte
     senkrechte Liste in der Rail-Fußzeile. Sie rendert NUR innerhalb der Rail,
     die selbst schon hinter `$store.viewport.desktop` steht; ein zweites
     Breakpoint-Gate wäre hier eine zweite Wahrheit. --}}
@if ($rail)
    <nav aria-label="{{ __('Hauptnavigation') }}" class="flex flex-col gap-0.5">
        @foreach ($items as $item)
            <x-group::nav-tab
                orientation="rail"
                :route="$item['route']"
                :match="$item['match'] ?? null"
                :icon="$item['icon']"
                :label="$item['label']"
                :gate="$item['gate'] ?? 'guest'"
                :unread-dot="($item['key'] ?? null) === 'chat'"
            />
        @endforeach
    </nav>
@else

{{-- backdrop-blur nur auf Web: eine fixe Nav mit backdrop-filter über
     scrollendem Inhalt ist der klassische Mobile-WebView-Scroll-Killer (Blur wird
     pro Frame neu berechnet → Ruckeln/schwarze Flächen). Auf Native daher opaker
     Hintergrund ohne Blur. --}}
@php($native = \Einundzwanzig\Group\Chassis::istApp())
<nav
    aria-label="Hauptnavigation"
    @class([
        {{-- ── EINE stetige Breite statt dreier Schwellen (P5, aus P2/6) ─────────
             Hier stand `max-w-md md:max-w-lg lg:max-w-2xl`: drei Viewport-Schwellen
             an EINEM Bauteil, neben der einen Chassis-Schwelle `xl`. Am gebauten
             Stand nachgemessen sprang die Bar dadurch zweimal — bei 768 px um
             64 px (448 → 512) und bei 1024 px um **160 px** (512 → 672). Ein
             Sprung dieser Größe in der Hauptnavigation ist keine Anpassung, den
             sieht man.

             `min(100%, clamp(28rem, 66vw, 42rem))` trifft beide alten Endwerte und
             füllt den Weg dazwischen stetig: unter 678 px liegt die alte 28-rem-
             Decke (und `min(100%,…)` gibt auf schmalen Geräten die volle Breite
             frei), ab 1018 px die alte 42-rem-Decke. Die 66 vw sind aus den alten
             Sprungpunkten gerechnet: 32rem/48rem = 66,7 %, 42rem/64rem = 65,6 %.

             Eine Container-Query wäre hier FALSCH und nicht bloß unnötig: die Bar
             ist `position: fixed`, ihr Bezugsrahmen IST das Ansichtsfenster —
             und ein Vorfahre mit `container-type` würde sie sogar aus ihm
             herausreissen. Die Hausregel „Geometrie über Container-Queries"
             meint Flächen im Fluss; für ein fixiertes Element ist die
             viewport-relative Einheit die richtige Antwort. Was hier fiel, sind
             die SCHWELLEN, nicht die Bezugsgröße. --}}
        'fixed inset-x-0 bottom-0 z-40 mx-auto w-[min(100%,clamp(28rem,66vw,42rem))] border-t border-zinc-200 px-2 pb-safe dark:border-zinc-800',
        'bg-zinc-50 dark:bg-zinc-950' => $native,
        'bg-zinc-50/90 backdrop-blur-md dark:bg-zinc-950/90' => ! $native,
        // Ab xl trägt der Navigator dieselben Ziele senkrecht — zwei Navigationen
        // gleichzeitig wären eine zu viel. In der NativePHP-App gibt es kein
        // Desktop-Chassis (siehe app-frame), dort bleibt die Bar auf JEDER Breite.
        'xl:hidden' => ! $native,
    ])
>
    {{-- Statische Spaltenklasse (JIT-sicher, beide Literale im Quelltext) je realer
         Tab-Zahl: Web 3 · Mobile 4. --}}
    @php($cols = count($items) === 4 ? 'grid-cols-4' : 'grid-cols-3')
    {{-- P4: Die Lupe ist der mobile Eingang in die Befehlspalette — hier gibt es
         kein ⌘K. Bewusst NEBEN dem Raster statt als weiterer Eintrag in
         `config('group.nav')`: die Spaltenklasse hängt an `count($items)`, ein
         zusätzlicher Eintrag verschöbe sie in drei Hosts gleichzeitig. Als feste
         Spalte davor bleibt das Raster unverändert, in jedem Host. --}}
    <div class="flex items-stretch">
        <button type="button" data-palette-open
                x-data
                x-on:click="$dispatch('open-command-palette')"
                aria-label="{{ __('Suchen und springen') }}"
                aria-haspopup="dialog"
                class="pressable flex min-h-14 w-14 shrink-0 flex-col items-center justify-center gap-1 text-zinc-600 active:text-zinc-800 dark:text-zinc-400 dark:active:text-zinc-200">
            <flux:icon.magnifying-glass class="size-6" />
            <span class="text-[11px] font-semibold leading-none">{{ __('Suche') }}</span>
        </button>

        <div class="grid flex-1 {{ $cols }}">
            {{-- `unreadDot` ist eine reine LESE-Ableitung aus dem bestehenden `key`
                 (existiert in allen drei Nav-Registries: Package-Default, Web-Host,
                 Mobile-Host-Unified). Die Config bleibt unangetastet, kein Eintrag
                 kommt hinzu, `count($items)` und damit die Spaltenklasse ändern sich
                 nicht. Fehlt der Key in einer fremden Registry, ist das Ergebnis
                 `false` → kein Punkt, kein Fehler. --}}
            @foreach ($items as $item)
                <x-group::nav-tab
                    :route="$item['route']"
                    :match="$item['match'] ?? null"
                    :icon="$item['icon']"
                    :label="$item['label']"
                    :gate="$item['gate'] ?? 'guest'"
                    :unread-dot="($item['key'] ?? null) === 'chat'"
                />
            @endforeach
        </div>
    </div>
</nav>
@endif
