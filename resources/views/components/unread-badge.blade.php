@props([
    'count',
    'cap' => 99,
    'size' => 'md',
    'sr' => true,
    'srOne' => null,
    'srMany' => null,
    'badgeClass' => '',
])

{{-- Geometrie als GANZER String je Größe, nicht als anhängbare Einzelklassen: stünden
     `h-5` und `h-4` gleichzeitig in der Klassenliste, entschiede die Reihenfolge im
     GEBAUTEN Bundle, nicht die im Markup — genau die Falle, die in P4 `line-clamp-2`
     gegen `block` verlieren ließ (gemessen, nicht vermutet). Beide Literale stehen
     hier im Quelltext, der Tailwind-JIT findet sie also.
     `sm` sitzt an der Glocke: dort ist das 44-px-Ziel der umschließende `<a>`, die
     Pille selbst ist Anzeige. Sie bleibt bewusst unter den 20 px, die §9 Nr. 6 für
     frei stehende Zeilen-Pillen verlangt — 20 px neben einem 20-px-Icon in einer
     44-px-Fläche wäre kein Zähler mehr, sondern ein zweites Icon. --}}
@php($geometry = match ($size) {
    'sm' => 'h-4 min-w-4 px-1 text-[0.65rem]',
    default => 'h-5 min-w-5 px-1.5 text-[0.7rem]',
})

{{-- Ungelesen-ZÄHLER (P6, §4.1) — die Pille, die in P3 noch ein Punkt war
     (`unread-dot`, dort weiterhin für die Bottom-Nav: auf 11-px-Beschriftungsebene
     ist die einzige Frage „muss ich da rein?", eine Ziffer wäre dort unlesbar).

     `count` ist ein ALPINE-Ausdruck (String), kein PHP-Wert — z. B.
     `$store.unread?.rooms?.[room.h]`. IMMER defensiv adressieren: fehlt der Store
     (Gast, Ladephase, Fremdhost ohne Datenstrang), ist der Ausdruck `undefined`,
     also falsy, und es rendert NICHTS. Genauso bei 0. Kein Zähler ist der korrekte
     Zustand für „weiß ich noch nicht"; ein Badge, das von 0 auf 7 springt, ist
     schlimmer als 300 ms Leere.

     `x-if`, nicht `x-show`: bei 0 steht kein Knoten im DOM — kein leerer
     Platzhalter, keine Layout-Reserve, kein Aufblitzen vor dem Alpine-Boot.

     KEINE Formatierung hier: die Cap-Stufe (99+ in Listen, 9+ an der Glocke) kommt
     als String aus `$store.unread.capped(n, cap)`. Der Grund ist nicht Ästhetik —
     eine zweite Formatierungsregel im Template wäre eine zweite Wahrheit über
     dieselbe Zahl. Das Template liest, es rechnet nicht.

     Farbe (§4.6-Rollenregel): `bg-brand-500` ist FLÄCHE, `text-zinc-950` die Ziffer
     darauf — identisch in Light und Dark, weil die Fläche deckend ist und den
     Untergrund damit nicht mehr sehen kann. `brand-500` als TEXT auf getönter
     Fläche wäre unzulässig (2,7:1), `brand-800`/`brand-900` sind die Textfarben auf
     Tint. Die Pillenfläche selbst liegt gegen Weiß unter 3:1 — deshalb trägt die
     ZIFFER die Bedeutung, nicht die Pillenform; ein zahlloser Marker (Punkt) fällt
     unter 1.4.11 und nutzt darum brand-700/brand-400 (siehe `unread-dot`).
     Verbindlich ist die Messung im gerenderten Baum, nicht diese Rechnung:
     `tests/e2e/a11y-contrast.spec.ts` (Host-Repo) misst beide Themes.

     `sr=false` setzen, wenn das umschließende interaktive Element ein `aria-label`
     trägt — das ERSETZT den Kindtext, ein sr-only wäre dort totes Markup. Dann
     gehört der Zählhinweis in den aria-label-Ausdruck.

     Der sr-Text nennt die ECHTE Zahl, nicht die gekappte: „150 ungelesene
     Nachrichten" ist für einen Screenreader brauchbarer als „99+". Die
     Numerus-Verzweigung steht bewusst im Template (Muster wie „N Antwort/Antworten"
     in `⚡spaces`) — sie ist Textbau, keine Ableitung über den Zählwert. --}}
<template x-if="{{ $count }}">
    <span class="inline-flex shrink-0 items-center">
        <span aria-hidden="true"
              class="chip-in inline-flex shrink-0 items-center justify-center rounded-pill bg-brand-500 font-mono font-bold leading-none text-zinc-950 tabular-nums {{ $geometry }} {{ $badgeClass }}"
              x-text="$store.unread.capped({{ $count }}, {{ $cap }})"></span>
        @if ($sr)
            <span class="sr-only"
                  x-text="', ' + {{ $count }} + ({{ $count }} === 1 ? @js(' '.($srOne ?? __('ungelesene Nachricht'))) : @js(' '.($srMany ?? __('ungelesene Nachrichten'))))"></span>
        @endif
    </span>
</template>
