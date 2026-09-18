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
    {{-- Aktiv-Farbe `brand-800`, nicht `brand-700`: sie färbt hier das LABEL (der
         `<span>` weiter unten) und fällt damit unter 1.4.3 (≥ 4,5:1). `brand-700`
         liegt auf beiden Nav-Gründen darunter — gemessen 4,21:1 auf der Bottom-Bar
         (zinc-50) und gerechnet 4,40:1 auf der Rail (weiß). `brand-800` schafft
         6,15:1 bzw. 6,42:1. Der Balken darunter bleibt `brand-700`: er ist ein
         Grafikobjekt (1.4.11, ≥ 3:1) und trägt dort mit gemessenen 4,21:1.

         P2 (Entwurf C): im Dunkeln trägt brand-400 (#fda537, die Link-Stufe des
         Entwurfs) 9,9:1 auf bg-elevated — dieselbe Klassenregel, der dunkle Zweig
         läuft jetzt bewusst auf der hellsten Orange-Stufe des Entwurfs. --}}
    @class([
        'pressable relative flex',
        'min-h-14 flex-col items-center justify-center gap-1 py-2.5' => ! $rail,
        'min-h-9 items-center gap-2.5 rounded-tile px-2' => $rail,
        'transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800' => $rail,
        'text-brand-800 dark:text-brand-400' => $active,
        'text-zinc-600 active:text-zinc-800 dark:text-zinc-400 dark:active:text-zinc-200' => ! $active,
    ])
>
    @if ($active && $rail)
        {{-- Indicator NUR noch in der Rail (Balken links). P2 (Entwurf C): die
             Bottom-Bar des Artboards `screen-mobileweb` hat KEINEN Balken — der
             aktive Zustand trägt Farbe + Schriftgewicht des Labels, mehr nicht.
             Light-Mode brand-700 (≥3:1 auf hellem Nav-Grund), Dark brand-500. --}}
        <span @class([
            'nav-pill absolute rounded-pill bg-brand-700 dark:bg-accent',
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
         einen bekannten flachen Nachbarn (Nav-Grund zinc-50/zinc-950).

         ── The encrypted conversations were a SECOND source (P8) — and are not any more ─
         Until P3 this read `|| ($store.privateMessages?.unreadTotal ?? 0) > 0`, because the
         wrap store was mounted on every page and a NIP-17 conversation has no `h` to be
         keyed by. D5 ends that: `nostrPrivateMessages` now mounts ONLY inside the Postfach's
         „Direkt" segment, so the term could only ever be true while the user is already
         looking at the conversations — a signal about the screen he is on, paid for with two
         `nip44.decrypt` per envelope.

         The term is therefore gone rather than merely inert: a dot fed from decrypted
         messages is the door through which a count comes back (D5: "no DM count anywhere").
         The price is named — an unread conversation leaves this dot dark.

         ── P2 (Entwurf C): die Bottom-Bar trägt den Punkt nicht mehr, sondern
         die ZÄHLER-PILLE des Artboards (18 px, Orange, dunkle Ziffer) — siehe
         unten beim Label. Der Punkt lebt in der Rail weiter. --}}
@php($punkt = '$store.unread?.any')
    <span class="relative inline-flex">
        {{-- P2 (Entwurf C §2 `.tab`): Stroke-Icon in BEIDEN Zuständen — das
             Artboard zeichnet keinen outline/solid-Wechsel; der aktive Zustand
             trägt Farbe und Gewicht, nicht die Glyphenform. `sw-18` setzt die
             Strichstärke des Entwurfs (1.8) gegen Heroicons' 1.5-Attribut. --}}
        <flux:icon :name="$icon" variant="outline" @class(['size-6 sw-18' => ! $rail, 'size-5' => $rail]) />
        @if ($unreadDot && $rail)
            {{-- Der Ring nimmt die Farbe des jeweiligen Nav-Grundes an: die
                 Bottom-Bar sitzt auf zinc-50/zinc-950, die Rail auf white/zinc-900.
                 Ein falscher Ring sähe aus wie ein Rand am Punkt. --}}
            <x-group::unread-dot
                :when="$punkt"
                :sr="false"
                :dot-class="'absolute -end-1 -top-1 ring-2 '.($rail ? 'ring-white dark:ring-zinc-900' : 'ring-zinc-50 dark:ring-zinc-950')" />
        @endif
    </span>
    {{-- Label zur Render-Zeit übersetzen: die Nav-Labels kommen aus config('group.nav'),
         die beim Boot VOR der Locale-Middleware lädt — ein `__()` in der Config löste
         darum immer die Default-Sprache auf. Hier greift die Request-Locale (z.B. „Mehr"→„More"). --}}
    <span @class([
        'leading-none',
        'text-[11px] font-bold' => ! $rail,
        'text-[11px] font-extrabold' => ! $rail && $active,
        'text-sm font-semibold' => $rail,
    ])>{{ __($label) }}</span>
    @if ($unreadDot && ! $rail)
        {{-- ── P2 (Entwurf C): die Postfach-Pille des Artboards ──────────────────
             18 px hoch, Pill-Radius, Orange mit DUNKLER Ziffer (#0b0b0c auf
             #f7931a = 8,6:1). Die Zahl ist `postfach` — die Updates, die den
             LESER adressieren: dieselbe Ebene, die laut Store-Doku das
             Inbox-Icon der Befehlsleiste speist, ohne Template-Arithmetik über
             Ebenen zu summieren (Hausregel: das Template liest, es rechnet
             nicht). Raum-Ungelesene bleiben in den Raum-Zeilen sichtbar; eine
             DM-Summe steht hier bewusst NICHT (D5).

             Position wie Artboard: `top:4px; left:calc(50% + 6px)` — am TAB,
             nicht am Icon, damit die Pille unabhängig von Icons und Label
             immer dieselbe Ecke hat. Der sr-Text der Komponente nennt die
             ECHTE Zahl (Lesereihenfolge „Postfach, 3 ungelesene Nachrichten";
             das <a> trägt kein aria-label, der Kindtext kommt an). --}}
        <span class="absolute left-[calc(50%+6px)] top-1 flex">
            <x-group::unread-badge count="$store.unread?.postfach" :cap="9"
                                   badgeClass="h-[18px]! min-w-[18px]! px-[5px]! text-[11px]! font-extrabold!" />
        </span>
    @endif
</a>
