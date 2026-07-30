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
{{-- Seit der Desktop-Shell ist die Wurzel `app-frame` statt eines nackten
     `contents`-Divs. Unterhalb xl ist das dasselbe DOM wie zuvor (`app-frame`
     rendert dort ebenfalls nur `contents`), ab xl wird daraus das zweispaltige
     Grid mit dem Navigator links. `chrome=false` (Onboarding) schaltet beides
     zusammen ab — eine Regel, ein Ort. --}}
<x-group::app-frame :rail="$chrome">
    @if ($chrome)
        <x-group::status-strip />

        @isset($header)
            {{ $header }}
        @endisset
    @endif

    {{-- Die Breitenklammer bleibt für Mobil/Tablet zeichengleich stehen. Ab xl
         hebt `xl:max-w-none xl:mx-0` sie auf: die Bühne bringt ihre eigene,
         großzügigere Inhaltsspalte mit, und der Deckel wandert eine Ebene tiefer.
         `xl:overflow-y-auto` macht die Bühne zur scrollenden Fläche — ab xl
         scrollt nicht mehr das Dokument, sondern die Spalte.
         `pb-28` (Platz für die fixe Bottom-Bar) fällt ab xl weg: dort gibt es
         keine Bottom-Bar mehr, der Abstand wäre toter Boden. --}}
    <main data-tab-outlet id="buehne" {{ $attributes->class('mx-auto max-w-md px-4 pt-[max(env(safe-area-inset-top),1.5rem)] md:max-w-lg lg:max-w-2xl xl:mx-0 xl:min-h-0 xl:max-w-none xl:flex-1 xl:overflow-y-auto xl:px-8 xl:pt-6 2xl:px-12 '.($chrome ? 'pb-28 xl:pb-8' : 'pb-8')) }}>
        {{-- Ab xl bekommt der Seiteninhalt einen eigenen Lesedeckel, statt die
             ganze Spaltenbreite zu füllen — eine Bühne ohne Deckel ist Slacks
             Lesbarkeitsfehler. --}}
        <div class="xl:mx-auto xl:w-full xl:max-w-[62rem]">
            {{ $slot }}
        </div>
    </main>

    @if ($chrome)
        <x-group::bottom-nav />
    @endif
</x-group::app-frame>
