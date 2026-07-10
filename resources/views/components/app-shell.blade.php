@props([
    'chrome' => true,
])

{{-- Die EINE Shell (§3.1). Verschmilzt Shell A (mobile.blade Companion) und
     Shell B (einundzwanzig.blade Chat-Takeover) zu einem Chassis: Chat ist ein
     Tab darin, kein Vollbild-Takeover mehr. Der Doc-Layout (`einundzwanzig.blade`,
     html/head/body/scripts) bleibt drumherum — app-shell ist der Body-Rumpf.

     Aufbau:
       status-strip  ← beide Signer-Banner, global, eine Höhe
       $header       ← kontextueller <x-group::app-header> der Seite (optional)
       <main …>      ← wire:navigate-Ziel, der Tab-Inhalt ($slot)
       bottom-nav    ← config-getriebene Nav (§8.2)

     `chrome=false` (Onboarding): rendert nur den nackten main-Outlet — eine
     Regel, ein Ort (§3.1). FAB kommt erst mit P7, hier bewusst weggelassen.
     Der Outlet steht einmal; nur das padding-bottom hängt an der fixen Nav
     (pb-28 mit Chrome, pb-8 ohne). Beide Literale bleiben im Quelltext → JIT.

     EIN Wurzel-Element (`display:contents`, layout-neutral): die Shell dient in
     P2 als Root eines Livewire-Full-Page-SFC (`group::spaces` etc.), und Livewire
     erlaubt nur genau eine Wurzel je Komponente. status-strip/nav sind `fixed`,
     `main` bleibt im Fluss — der Wrapper erzeugt keine Box, das Layout ist
     identisch zu den drei vorherigen Geschwistern. --}}
<div class="contents">
    @if ($chrome)
        <x-group::status-strip />

        @isset($header)
            {{ $header }}
        @endisset
    @endif

    <main data-tab-outlet {{ $attributes->class('mx-auto max-w-md px-4 pt-[max(env(safe-area-inset-top),1.5rem)] md:max-w-lg lg:max-w-2xl '.($chrome ? 'pb-28' : 'pb-8')) }}>
        {{ $slot }}
    </main>

    @if ($chrome)
        <x-group::bottom-nav />
    @endif
</div>
