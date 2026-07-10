@props([
    'route',
    'icon',
    'label',
    'match' => null,
    'gate' => 'guest',
])

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
        x-on:mousedown.capture="$store.authGate.gateTap($event, { label: @js($label), returnUrl: $el.pathname + $el.search })"
        x-on:keydown.enter.capture="$store.authGate.gateTap($event, { label: @js($label), returnUrl: $el.pathname + $el.search })"
    @endif
    @class([
        'pressable relative flex min-h-14 flex-col items-center justify-center gap-1 py-2.5',
        'text-brand-700 dark:text-brand-400' => $active,
        'text-zinc-600 active:text-zinc-800 dark:text-zinc-400 dark:active:text-zinc-200' => ! $active,
    ])
>
    @if ($active)
        {{-- Indicator im Light-Mode brand-700 (≥3:1 auf hellem Nav-Grund), Dark brand-500. --}}
        <span class="nav-pill absolute inset-x-0 top-0 mx-auto h-1 w-8 rounded-pill bg-brand-700 dark:bg-accent" aria-hidden="true"></span>
    @endif
    <flux:icon :name="$icon" :variant="$active ? 'solid' : 'outline'" class="size-6" />
    <span class="text-[11px] font-semibold leading-none">{{ $label }}</span>
</a>
