@props([
    'route',
    'icon',
    'label',
    'match' => null,
    'gate' => 'guest',
    'unreadDot' => false,
    // 'bottom' = die Mobil-Bottom-Bar (Icon über Label, Balken oben).
    // 'rail'   = der Desktop-Navigator (Icon neben Label, Balken links).
    // Default ist zeichengleich mit dem Markup vor der Desktop-Shell.
    'orientation' => 'bottom',
])
@php($rail = $orientation === 'rail')

{{-- Ein Tab der Shell-Nav. Aus der bottom-nav-Schleife extrahiert, damit Web
     (linke Rail) und Mobile (Bottom-Bar) DASSELBE Item-Markup teilen (§3.1/§8.2).
     Aktiv-State serverseitig via routeIs() (`match`, Fallback = `route`).

     Gate:
       'guest' → normaler wire:navigate-Link.
       'nostr' → Tap OHNE welshman-Session navigiert NICHT, sondern läuft über den
                 globalen `$store.authGate` (§4.2, in bridge.ts): eingeloggt →
                 requireAuth() gibt true, der Link navigiert normal; Gast → false,
                 der Store öffnet das Login-Sheet (P6) bzw. springt mit `?return`
                 auf den Login-View, und wir blocken die SPA-Navigation.
                 Abfang-Zeitpunkt: wire:navigate committet die SPA-Navigation schon
                 auf mousedown/keydown (rAF) — VOR dem click-Event. Ein click-
                 Handler käme zu spät. Darum in der CAPTURE-Phase auf mousedown/
                 keydown abfangen (läuft vor Livewires Listener) mit
                 stopImmediatePropagation. Server-Gate (EnsureNostrAuth) bleibt der
                 reale Schutz im Web — der Intercept ist die sanfte Ebene; auf
                 Mobile (kein Server-Gate) ist der Store der EINZIGE Schutz. --}}
{{-- `match` darf mehrere Route-Namen kommagetrennt listen (Multi-Route-Tabs wie
     Chat/Meetups/Mehr im Mobile-Host). routeIs()/Str::is splittet Kommas NICHT —
     ein roher String "meetups,meetups.show" matchte nie. Darum wie die Host-Nav
     auf ein Pattern-Array explodieren; ein Ein-Wert-`match` ergibt ein Ein-Element-
     Array → für die Web-P2-/Package-Default-Tabs (alle Ein-Routen) unverändert. --}}
@php($active = request()->routeIs(...explode(',', $match ?? $route)))
<a
    href="{{ route($route) }}"
    wire:navigate
    @if ($active) aria-current="page" @endif
    @if ($gate === 'nostr')
        {{-- returnUrl = $el.pathname+search (DOM-Anchor liefert den reinen „/…"-Pfad;
             route() rendert eine ABSOLUTE href, die sanitizeReturnUrl sonst verwürfe). --}}
        x-on:mousedown.capture="$store.authGate.gateTap($event, { label: @js(__($label)), returnUrl: $el.pathname + $el.search })"
        x-on:keydown.enter.capture="$store.authGate.gateTap($event, { label: @js(__($label)), returnUrl: $el.pathname + $el.search })"
    @endif
    {{-- Beide Geometrie-Literale stehen vollständig im Quelltext (JIT-sicher,
         Muster wie die Spaltenklasse in `bottom-nav`). --}}
    @class([
        'pressable relative flex',
        'min-h-14 flex-col items-center justify-center gap-1 py-2.5' => ! $rail,
        'min-h-9 items-center gap-2.5 rounded-tile px-2' => $rail,
        'transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800' => $rail,
        'text-brand-700 dark:text-brand-400' => $active,
        'text-zinc-600 active:text-zinc-800 dark:text-zinc-400 dark:active:text-zinc-200' => ! $active,
    ])
>
    @if ($active)
        {{-- Indicator im Light-Mode brand-700 (≥3:1 auf hellem Nav-Grund), Dark brand-500.
             Bottom-Bar: Balken OBEN quer. Rail: Balken LINKS senkrecht — dieselbe
             Rolle, an die Leserichtung der jeweiligen Nav angepasst. --}}
        <span @class([
            'nav-pill absolute rounded-pill bg-brand-700 dark:bg-accent',
            'inset-x-0 top-0 mx-auto h-1 w-8' => ! $rail,
            'inset-y-1 start-0 w-0.5' => $rail,
        ]) aria-hidden="true"></span>
    @endif
    {{-- Icon im relative-Wrapper: der Ungelesen-Punkt hängt an der ECKE DES ICONS,
         nicht an einer gerechneten Prozentposition im Tab — er bleibt damit richtig,
         wenn sich Icon-Größe oder Tab-Breite ändern. Weil er absolut positioniert
         ist, ändert er die Tab-Höhe (`min-h-14`) nicht.
         Der Punkt speist sich aus `any` (irgendwo etwas ungelesen), nicht aus einer
         Summe: auf 11-px-Beschriftungsebene ist die einzige Frage „muss ich da
         rein?". Der Ring trennt ihn vom Icon-Strich und gibt der Kontrastmessung
         einen bekannten flachen Nachbarn (Nav-Grund zinc-50/zinc-950). --}}
    <span class="relative inline-flex">
        <flux:icon :name="$icon" :variant="$active ? 'solid' : 'outline'" @class(['size-6' => ! $rail, 'size-5' => $rail]) />
        @if ($unreadDot)
            {{-- Der Ring nimmt die Farbe des jeweiligen Nav-Grundes an: die
                 Bottom-Bar sitzt auf zinc-50/zinc-950, die Rail auf white/zinc-900.
                 Ein falscher Ring sähe aus wie ein Rand am Punkt. --}}
            <x-group::unread-dot
                when="$store.unread?.any"
                :sr="false"
                :dot-class="'absolute -end-1 -top-1 ring-2 '.($rail ? 'ring-white dark:ring-zinc-900' : 'ring-zinc-50 dark:ring-zinc-950')" />
        @endif
    </span>
    {{-- Label zur Render-Zeit übersetzen: die Nav-Labels kommen aus config('group.nav'),
         die beim Boot VOR der Locale-Middleware lädt — ein `__()` in der Config löste
         darum immer die Default-Sprache auf. Hier greift die Request-Locale (z.B. „Mehr"→„More"). --}}
    <span @class([
        'font-semibold leading-none',
        'text-[11px]' => ! $rail,
        'text-sm' => $rail,
    ])>{{ __($label) }}</span>
    {{-- Der sr-only-Text steht NACH dem Label (Lesereihenfolge „Chat, ungelesene
         Nachrichten"); das <a> trägt kein aria-label, der Kindtext kommt also an. --}}
    @if ($unreadDot)
        <template x-if="$store.unread?.any">
            <span class="sr-only">, {{ __('ungelesene Nachrichten') }}</span>
        </template>
    @endif
</a>
