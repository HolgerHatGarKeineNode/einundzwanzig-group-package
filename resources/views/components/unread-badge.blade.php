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
{{-- ── KEIN `font-mono` (Restposten aus P6b, 2026-08-27) ───────────────────────
     P6b hat elf Träger in der Rail fallen lassen und diesen einen ausdrücklich
     stehen gelassen: die Ziffer sitze „in einer FESTEN Geometrie, wo ein
     Familienwechsel die Glyphenbreite ändert". Das GEFÜRCHTETE Risiko ist jetzt
     gemessen (Chromium, `--font-sans`/`--font-mono` aus dem gebauten Bundle,
     Animation ausgelaufen — `chip-in` skaliert sonst noch auf 0,8 und alle Werte
     sind 20 % zu klein):

     | Pille          | mit `font-mono` | ohne  | Δ Box   |
     |----------------|-----------------|-------|---------|
     | md „1"         | 20,00 px        | 20,00 | 0       |
     | md „42"        | 26,41 px        | 24,02 | −2,39   |
     | md „99+"       | 33,61 px        | 30,02 | −3,59   |
     | sm „1"         | 16,00 px        | 16,00 | 0       |
     | sm „9+"        | 22,41 px        | 20,02 | −2,39   |

     Die Geometrie ist gar nicht fest: `min-w-*` ist ein BODEN, `px-*` lässt die
     Pille mitwachsen. Bei einstelliger Ziffer greift der Boden und die Box
     ändert sich um 0 px; mehrstellig wird sie SCHMALER. Überlaufen kann in
     dieser Richtung nichts. Die Höhe bleibt 20/16 px, die Zeilenbox der Ziffer
     fällt von 14 auf 12 px und sitzt damit lockerer statt enger.

     Der Grund für den Wechsel ist derselbe wie in der Rail: `font-mono` ist hier
     keine Zusage auf gleichbreite Ziffern, sondern ein Familienwechsel. Gemessen
     mit `CSS.getPlatformFontsForNode` rendert die Ziffer heute in **Liberation
     Mono**, der Raumname daneben in **Inconsolata** — zwei Zellenschriften in
     einer Zeile, 6,000 gegen 7,201 px Dickte je Zeichen bei 12 px (an 200
     Ziffern gemessen), also +20,0 %. Das Haus hat sich auf eine
     festgelegt (Nutzerentscheid 2026-08-26: „Inconsolata bleibt überall").

     `tabular-nums` BLEIBT: es schaltet eine Zifferngestalt, keine Familie. --}}
@php($geometry = match ($size) {
    'sm' => 'h-4 min-w-4 px-1 text-xs',
    default => 'h-5 min-w-5 px-1.5 text-xs',
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
     Fläche wäre unzulässig (gerechnet 2,12:1 auf `brand-500/10` über Weiß; die hier
     bis 2026-08-14 notierten 2,7:1 gehören zu `brand-600` auf derselben Fläche —
     2,74:1, dem Anlassfall des Kontrast-Ankers. Die Folgerung stimmt, die Zahl war
     die eines anderen Vordergrunds), `brand-800`/`brand-900` sind die Textfarben auf
     Tint. Die Pillenfläche selbst liegt gegen Weiß bei 2,30:1 und damit unter den
     3:1 aus 1.4.11 — deshalb trägt die
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
              class="chip-in inline-flex shrink-0 items-center justify-center rounded-pill bg-brand-500 font-bold leading-none text-zinc-950 tabular-nums {{ $geometry }} {{ $badgeClass }}"
              x-text="$store.unread.capped({{ $count }}, {{ $cap }})"></span>
        @if ($sr)
            <span class="sr-only"
                  x-text="', ' + {{ $count }} + ({{ $count }} === 1 ? @js(' '.($srOne ?? __('ungelesene Nachricht'))) : @js(' '.($srMany ?? __('ungelesene Nachrichten'))))"></span>
        @endif
    </span>
</template>
