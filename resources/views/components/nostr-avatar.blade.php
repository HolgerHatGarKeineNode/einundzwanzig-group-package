{{-- Alpine-gebundenes Profil-Avatar. flux:avatar rendert das <img> NUR server-seitig
      bei gesetztem $src → bei reinem Alpine-Bind (::src/::name) bliebe es leer (Silhouette).
      Darum natives <img> über den Bild-Proxy ($img); Fallback = Initiale aus dem Namen.
      Zweistufig bei Ladefehler: Proxy → Original → Initiale — der Original-Schritt nur,
      wenn der Proxy das Ziel nicht schon per POLICY ablehnt ($imgFallback, P7: eine
      protokoll-relative URL wie `//evil.example/x.png` würde sonst den Browser jedes
      Lesers direkt zum Angreifer schicken). `picture`/`name` sind
      Alpine-Ausdrücke (z.B. `m.picture`, `m.name`) aus dem umschließenden Scope.

      `emoji` (optional, P2/NIP-38) ist ebenfalls ein Alpine-Ausdruck und trägt das
      Status-Emoji als Plakette an die untere rechte Ecke. Ohne diesen Prop entsteht
      KEIN zusätzliches Markup — die zwei Dutzend Bestands-Aufrufer bleiben unberührt.

      ── Warum es seit P2 zwei verschachtelte <span> sind ──
      Der innere trägt `overflow-hidden` (er stanzt Bild und Initiale kreisrund) und
      würde eine Plakette an seiner Kante mit abschneiden. Die Größe wandert deshalb
      nach außen, das Runde bleibt innen. Für Aufrufer ändert sich nichts: das äußere
      Element ist wie zuvor ein `inline-flex shrink-0` mit exakt den Maßen aus `$size`. --}}
@props(['picture', 'name', 'size' => '2rem', 'emoji' => null])
<span class="relative inline-flex shrink-0" style="width: {{ $size }}; height: {{ $size }};">
    <span x-data="{ imgOrig: false, imgBroken: false }"
          class="relative inline-flex size-full items-center justify-center overflow-hidden rounded-full bg-brand-500/10 font-mono text-xs font-semibold uppercase text-brand-900 dark:text-brand-300">
        <span x-text="((({{ $name }}) || '?').trim()[0]) || '?'"></span>
        <template x-if="({{ $picture }}) && !imgBroken">
            <img alt="" class="absolute inset-0 size-full object-cover"
                 :src="imgOrig ? ({{ $picture }}) : $img({{ $picture }})"
                 x-on:error="imgOrig ? (imgBroken = true) : ($imgFallback({{ $picture }}) ? (imgOrig = true) : (imgBroken = true))" />
        </template>
    </span>
    @if ($emoji !== null)
        {{-- Status-Plakette (NIP-38 `emoji`-Tag, siehe js/userStatusData.ts). `aria-hidden`,
             weil sie nichts trägt, was ein Screenreader hier hören könnte: der Avatar steckt
             an jeder Aufrufstelle in einem Knopf mit eigenem `aria-label`, das den Inhalt
             ohnehin überschreibt. Vorgelesen wird der Status dort, wo er als TEXT steht —
             in der Profilkarte. Der Ring in Kartenfarbe stanzt die Plakette vom Avatar frei,
             damit sie auch auf einem dunklen Profilbild lesbar bleibt. --}}
        <template x-if="{{ $emoji }}">
            <span data-status-emoji aria-hidden="true"
                  class="pointer-events-none absolute -bottom-0.5 -right-0.5 inline-flex items-center justify-center rounded-full bg-white leading-none ring-2 ring-white dark:bg-zinc-900 dark:ring-zinc-900"
                  {{-- Plakette skaliert mit dem Avatar, aber gedeckelt: an einem 5rem-Avatar
                       (Profilkarte) wäre ein reines Verhältnis eine Briefmarke. --}}
                  style="min-width: 0.95em; height: 0.95em; font-size: clamp(0.6rem, calc({{ $size }} * 0.42), 1.1rem);"
                  x-text="{{ $emoji }}"></span>
        </template>
    @endif
</span>
