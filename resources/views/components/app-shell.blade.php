@props([
    'chrome' => true,
    // 'read' = Lesedeckel (62 rem) — der Default, unverändert seit der Desktop-Shell.
    // 'wide' = Bühnenbreite (96 rem) für Flächen, die RASTER zeigen statt Fließtext.
    'width' => 'read',
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
         keine Bottom-Bar mehr, der Abstand wäre toter Boden.

         ── …ABER NUR IM WEB-HOST, und das war hier ein Fehler ────────────────
         Die Begründung darüber stimmt für die Web-Shell und war im App-Host
         falsch. Dort bleibt die Bottom-Bar auf JEDER Breite stehen — genau
         darum trägt `bottom-nav.blade.php:52` ihr `xl:hidden` hinter
         `! $native`. Ab 1280 px (Tablet quer) fiel der Abstand hier trotzdem
         von 112 px auf 32 px, und die fixe Bar überlappte den Inhalt.
         Gemessen am 2026-08-23 bei `NATIVEPHP_RUNNING=true`, 1366 × 1024.

         **Der Host ist die richtige Frage, nicht die Breite** — dieselbe
         Unterscheidung wie in `app-frame.blade.php:44` und
         `bottom-nav.blade.php:41`, und aus demselben Grund: eine
         Breitenschwelle beschreibt das Chassis der Web-Shell, nicht die
         Anwesenheit einer fixen Leiste.

         Alle drei Literale (`pb-28`, `xl:pb-8`, `pb-8`) stehen weiterhin
         vollständig im Quelltext — Tailwind scannt Quelltext, ein
         zusammengesetzter Klassenname entstünde im JIT nie. --}}
    @php($nativeShell = config('nativephp-internal.running'))
    <main data-tab-outlet id="buehne" {{ $attributes->class('mx-auto max-w-md px-4 pt-[max(env(safe-area-inset-top),1.5rem)] md:max-w-lg lg:max-w-2xl xl:mx-0 xl:min-h-0 xl:max-w-none xl:flex-1 xl:overflow-y-auto xl:px-8 xl:pt-6 2xl:px-12 '.($chrome ? ($nativeShell ? 'pb-28' : 'pb-28 xl:pb-8') : 'pb-8')) }}>
        {{-- Ab xl bekommt der Seiteninhalt einen eigenen Deckel, statt die ganze
             Spaltenbreite zu füllen — eine Bühne ohne Deckel ist Slacks
             Lesbarkeitsfehler.

             ── Zwei Deckel, und warum es genau zwei sind (P5) ────────────────────
             `read` (62 rem) ist für Flächen mit FLIESSTEXT und einspaltigen Listen:
             darüber reißt die Zeilenlänge das Lesemaß von 45–75 Zeichen. `wide`
             (96 rem) ist für Flächen mit einem RASTER — Artikelkarten, Forge-Kacheln,
             Repo-Listen. Dort ist die Zeilenlänge eine Eigenschaft der Kachel und
             nicht der Bühne, und der Deckel kostet auf einem breiten Schirm nur Platz.

             **Was `wide` bei den üblichen Breiten wirklich tut, gemessen am
             gerenderten Element (2026-08-21, mit Desktop-Rail):** bei 1440 px ist die
             Inhaltsspalte 66 rem breit, bei 1700 px 80,3 rem. Der 96-rem-Deckel bindet
             dort also noch gar nicht — er ist die Obergrenze für sehr breite Schirme.
             Die messbare Wirkung bei 1440/1700 px ist, dass der 62-rem-Deckel NICHT
             mehr bindet: die Artikelliste trägt damit drei bzw. vier Spalten statt zwei.

             BEIDE Klassen stehen als volles Literal im Quelltext. Ein zusammengesetzter
             Name (`xl:max-w-[{{ $breite }}]`) entstünde erst zur Laufzeit — Tailwind
             scannt aber den QUELLTEXT, die Klasse existierte im gebauten Stylesheet
             also nie, und die Fläche fiele stumm auf die volle Spaltenbreite zurück.
             Dieselbe Regel und derselbe Grund wie beim `pb-28`/`pb-8` oben. --}}
        <div @class([
            'xl:mx-auto xl:w-full',
            'xl:max-w-[62rem]' => $width !== 'wide',
            'xl:max-w-[96rem]' => $width === 'wide',
        ])>
            {{ $slot }}
        </div>
    </main>

    @if ($chrome)
        <x-group::bottom-nav />
    @endif
</x-group::app-frame>
