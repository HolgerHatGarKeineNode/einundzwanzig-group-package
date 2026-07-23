{{-- Alpine-gebundenes Profil-Avatar. flux:avatar rendert das <img> NUR server-seitig
     bei gesetztem $src → bei reinem Alpine-Bind (::src/::name) bliebe es leer (Silhouette).
     Darum natives <img> über den Bild-Proxy ($img); Fallback = Initiale aus dem Namen.
     Zweistufig bei Ladefehler: Proxy → Original → Initiale. `picture`/`name` sind
     Alpine-Ausdrücke (z.B. `m.picture`, `m.name`) aus dem umschließenden Scope. --}}
@props(['picture', 'name', 'size' => '2rem'])
<span x-data="{ imgOrig: false, imgBroken: false }"
      class="relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-brand-500/10 font-mono text-xs font-semibold uppercase text-brand-900 dark:text-brand-300"
      style="width: {{ $size }}; height: {{ $size }};">
    <span x-text="((({{ $name }}) || '?').trim()[0]) || '?'"></span>
    <template x-if="({{ $picture }}) && !imgBroken">
        <img alt="" class="absolute inset-0 size-full object-cover"
             :src="imgOrig ? ({{ $picture }}) : $img({{ $picture }})"
             x-on:error="imgOrig ? (imgBroken = true) : (imgOrig = true)" />
    </template>
</span>
