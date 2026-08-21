{{-- ── Der Platzhalter des Navigators ──────────────────────────────────────────────

     Er existiert für genau ein Fenster: vom ERSTEN Paint bis zum Alpine-Boot. In
     dieser Zeit gibt es die echte Rail nicht — sie steht in einem
     `<template x-if="$store.viewport?.desktop">` (`desktop-rail.blade.php`), und der
     Inhalt eines `x-if`-Templates ist bis zum Boot **kein DOM-Knoten**.

     ── Was ohne ihn passierte, gemessen statt vermutet ─────────────────────────────
     Das Chassis (`app-frame.blade.php`) ist ab `xl` ein Grid mit
     `grid-cols-[20rem_minmax(0,1fr)]`. Ohne Rail war die Bühne das ERSTE Kind im
     Fluss und landete per Auto-Placement in Spur 1 — also in den 20 rem, die für den
     Navigator gedacht sind. Am 2026-08-21 auf `/articles` gemessen (Playwright,
     JS-Antwort um 600 ms verzögert, 1440 px):

       · `#buehne` **320 px statt 1120 px** breit, `x = 0`
       · Ortskarte **80 px** statt 346,7 px, Beschriftung auf „C…" gekürzt
       · **35 von 172 Frames**, Dauer **685–718 ms**; ungedrosselt 166–175 ms
       · **CLS 0,3865** — der Layout-Shift-Eintrag benennt als Quelle wörtlich
         `DIV.contents xl:flex xl:min-h-0 xl:fle…`, also die Bühne selbst
       · bei 1279 px (unter `xl`, kein Grid): 0 kaputte Frames, CLS 0,0000

     Die Breite des Fensters spielte dabei keine Rolle: bei 1920 px war die Bühne
     ebenfalls 320 px breit. Das ist keine Skalierungsfrage, sondern eine Spur.

     ── Warum ein Platzhalter und nicht `x-cloak` an der Ortskarten-Leiste ──────────
     `x-cloak` hätte in derselben Zeitspanne GAR NICHTS gezeigt. Eine tote Seite ist
     nicht besser als eine springende — sie ist dieselbe Falschaussage über den
     Systemzustand (Nielsen #1), nur leiser.

     ── Warum ein Skeleton hier ehrlich ist ─────────────────────────────────────────
     `ortskarten.blade.php` begründet ausführlich, warum es dort KEINS gibt: ein
     Skeleton ist die Zusage „hier kommt gleich etwas", und für Zahlen von zwei
     Relays ist Schweigen ein möglicher Ausgang. Hier ist die Zusage gedeckt: ob die
     Rail kommt, entscheidet `matchMedia` beim Boot — kein Netz, kein Relay, kein
     Ausgang „nie". Ab 1280 px kommt sie immer.

     ── Die Bauform: was der Server WEISS, zeichnet er; was nur der Client weiß,
        RESERVIERT er ─────────────────────────────────────────────────────────────
     Deshalb ist das hier kein grauer Geisterblock, sondern die Rail selbst, nur
     leer: dieselbe Kante (`border-e`), dieselbe Fläche, dasselbe Suchfeld-Chrome,
     dieselbe Fußzeilen-Haarlinie. Ein Balken steht nur dort, wo Text aus welshman
     nachkommt. Der Wechsel ist damit „Balken → Schrift" in einem Rahmen, der sich
     nicht bewegt.

     KEIN Text, kein einziges Zeichen. Der `#`-Prompt des echten Suchfelds fehlt hier
     bewusst — er trägt dort `font-mono`, und `--font-mono` ist im Haus-Theme nicht
     gesetzt (`theme.css` überschreibt nur `--font-sans`), Tailwind liefert seinen
     eigenen Default. Das Zeichen käme also in einer ZWEITEN Schriftfamilie und
     wechselte beim Austausch sichtbar die Form. Ein Befund am Bestand, kein Grund,
     ihn zu vervielfältigen.

     ── Höhen kommen aus der TYPO, nicht aus Pixeln ─────────────────────────────────
     Die beiden Kopfzeilen reservieren ihre Höhe über die echten Textklassen
     (`text-sm` → 20 px Zeilenbox, `text-[0.7rem]` → 16,8 px): der Balken liegt als
     `inline-block` IN der Zeile und ändert sie nicht. Ändert jemand die Typo der
     Rail, folgt der Platzhalter — eine hart notierte `h-[16.8px]` täte das nicht.

     Am gerenderten Element abgeglichen (1440×900): Kopf 64,8 · Suchfeld 36 (+8 mb)
     · Fußzeile 264. `desktop-boot-geometrie.spec.ts` hält das fest.

     ── Warum `aria-hidden` und ohne jedes bedienbare Element ───────────────────────
     Er trägt keine Information. Ein Screenreader liest ihn nicht, und es gibt nichts
     darin, was Fokus annehmen könnte — sonst stünden 20 leere Tab-Stopps vor dem
     Inhalt, für 250 ms, ohne Ziel.

     ── Bewegung ───────────────────────────────────────────────────────────────────
     Keine neue. `.skeleton` bringt sein Schimmern mit und ist unter
     `prefers-reduced-motion` in `theme.css` bereits abgeschaltet. Kein Überblenden
     beim Austausch: eine Blende wäre dasselbe Flackern, nur langsamer.

     ── Das Verschwinden ───────────────────────────────────────────────────────────
     `x-show="!$store.viewport?.desktop"` — dieselbe Bedingung, die die echte Rail
     ENTSTEHEN lässt, nur negiert. Beide laufen im selben synchronen
     `Alpine.start()`-Durchlauf, es gibt also keinen Frame dazwischen (gemessen: kein
     Frame mit zwei Spalten-1-Knoten). Bootet Alpine gar nicht, bleibt der
     Platzhalter stehen — die Geometrie stimmt dann immer noch, und das ist die
     richtige Ausfallrichtung.

     Das leere `x-data` ist eine Alpine-Komponente ohne Zustand: kein Store, kein
     Abo, kein welshman. Genau das, was `desktop-rail.blade.php` mit `x-if` vermeiden
     wollte, ist hier also nicht der Fall.

     ── Was er auf einem TELEFON kostet, gemessen ──────────────────────────────────
     Unterhalb `xl` ist er `hidden` — kein Layout, kein Paint, keine Insel. Im DOM
     steht er trotzdem, und das ist der Preis: **154 Elemente, 13.076 Bytes roh von
     300.048 der Seite — nach gzip 538 Bytes**, also 1,5 % der ausgelieferten
     37 kB (`/articles`, am 2026-08-21 gemessen). Server-seitig lässt sich das nicht
     vermeiden: welche Breite der Browser hat, weiß erst der Browser. Für einen
     halben Kilobyte auf der Leitung ist das gekauft; wer die Zahl bewegt, bewegt vor
     allem die Zeilenzahl der Liste oben. --}}
<div data-rail-skelett aria-hidden="true" x-data x-show="!$store.viewport?.desktop"
     class="hidden min-h-0 flex-col border-e border-zinc-200 bg-white xl:col-start-1 xl:row-start-1 xl:flex dark:border-zinc-800 dark:bg-zinc-900">

    {{-- Space-Kopf. Klassen zeichengleich mit `desktop-rail.blade.php`. --}}
    <div class="flex shrink-0 items-center gap-2.5 px-4 pt-4 pb-3">
        <div class="skeleton size-8 shrink-0 rounded-full"></div>
        <div class="min-w-0 flex-1">
            <div class="text-sm"><span class="skeleton inline-block h-2.5 w-32 rounded-pill align-middle"></span></div>
            <div class="text-[0.7rem]"><span class="skeleton inline-block h-2 w-20 rounded-pill align-middle"></span></div>
        </div>
    </div>

    {{-- Suchfeld: das Chrome ist echt (der Server weiß, dass es da sein wird), der
         Inhalt reserviert. Die 24 px des ⌘K-Knopfs bestimmen die Kastenhöhe (36) —
         deshalb steht dort ein Block dieser Höhe und nicht bloß ein dünner Balken.
         Er trägt die RUHIGE Fläche des echten Knopfs (`bg-black/5`), nicht das
         Schimmern: dass die Kappe kommt, ist keine offene Frage. --}}
    <div class="mx-3 mb-2 flex shrink-0 items-center gap-1.5 rounded-tile bg-zinc-100 px-2.5 py-1.5 dark:bg-zinc-800">
        <div class="min-w-0 flex-1 text-sm"><span class="skeleton inline-block h-2 w-24 rounded-pill align-middle"></span></div>
        <div class="h-6 w-7 shrink-0 rounded bg-black/5 dark:bg-white/10"></div>
    </div>

    {{-- Die Liste. `overflow-hidden` statt `overflow-y-auto`: ein Platzhalter
         scrollt nicht, und eine Scrollleiste an einer Fläche ohne Inhalt wäre ein
         Bedienangebot ohne Gegenstand. Bewusst mehr Zeilen als sichtbar — die
         unterste wird an der Kante abgeschnitten, genau wie in der echten Liste.
         Das ist die einzige Stelle, an der der Platzhalter etwas behauptet: dass
         unten weitergeht. Für eine Raumliste ab 1280 px trägt diese Zusage.

         DREI Gruppen zu sieben Zeilen — zusammen 756 px. Die Scrollfläche ist bei
         900 px Fenster 527 px hoch (gemessen); die Zeilen reichen damit bis zu einem
         Fenster von gut 1170 px und werden darunter beschnitten. Eine Zahl, die
         JEDE Fensterhöhe füllt, gibt es nicht — der Platzhalter füllt die üblichen
         und lässt darüber hinaus lieber Luft, als hundert leere Zeilen zu rendern. --}}
    <div class="min-h-0 flex-1 overflow-hidden px-3 pb-2">
        {{-- Die Balkenbreiten stehen als VOLLE Literale (`w-28`, `w-36`, …) im
             Quelltext, nicht als ein zur Laufzeit gebautes `w-` plus Zahl: Tailwind
             scannt Quelltext, ein zusammengesetzter Name existierte im gebauten
             Stylesheet nie und der Balken fiele auf `auto` zurück. Dieselbe Regel
             wie bei `grid-cols-3`/`grid-cols-2` in `ortskarten.blade.php`. --}}
        @foreach ([
            ['w-28', 'w-32', 'w-24', 'w-36', 'w-28', 'w-32', 'w-24'],
            ['w-32', 'w-24', 'w-28', 'w-36', 'w-24', 'w-32', 'w-28'],
            ['w-24', 'w-32', 'w-28', 'w-24', 'w-36', 'w-28', 'w-32'],
        ] as $gruppe)
            <section class="pt-2">
                {{-- Gruppenkopf: `min-h-7`, Chevron-Kasten `size-6`, Beschriftung
                     0,7 rem — dieselbe Zeile wie in `rail-group.blade.php`. --}}
                <div class="flex min-h-7 items-center gap-1 px-2">
                    <span class="inline-flex size-6 shrink-0 items-center justify-center">
                        <span class="skeleton size-3 rounded"></span>
                    </span>
                    <div class="text-[0.7rem]"><span class="skeleton inline-block h-2 w-16 rounded-pill align-middle"></span></div>
                </div>

                @foreach ($gruppe as $breite)
                    {{-- Raumzeile: `min-h-8`, Symbolkasten `size-5`, Name `text-sm` —
                         dieselbe Zeile wie in `rail-room-row.blade.php`. Die Breiten
                         wechseln, weil Raumnamen das auch tun; eine Spalte gleich
                         langer Balken sähe aus wie ein Strichcode, nicht wie eine
                         Liste. --}}
                    <div class="flex min-h-8 items-center gap-2 rounded-tile px-2 py-1">
                        <div class="skeleton size-5 shrink-0 rounded-md"></div>
                        <div class="min-w-0 flex-1 text-sm"><span class="skeleton inline-block h-2 rounded-pill align-middle {{ $breite }}"></span></div>
                    </div>
                @endforeach
            </section>
        @endforeach
    </div>

    {{-- Fußzeile. Höhe 264 px und damit zeichengleich zur echten: zwei Flächenzeilen
         (Artikel/Forge), drei Nav-Zeilen, die Profilzeile hinter der Haarlinie. Alle
         `min-h-9`, alle Abstände wie dort. --}}
    <div class="shrink-0 border-t border-zinc-200 px-3 py-2 dark:border-zinc-800">
        <div class="mb-2">
            @foreach ([0, 1] as $i)
                <div @class(['flex min-h-9 items-center gap-2 rounded-tile px-2', 'mt-0.5' => $i > 0])>
                    <div class="skeleton size-4 shrink-0 rounded"></div>
                    <div class="text-sm"><span class="skeleton inline-block h-2 w-14 rounded-pill align-middle"></span></div>
                </div>
            @endforeach
        </div>

        <div class="flex flex-col gap-0.5">
            @foreach (['w-12', 'w-20', 'w-24'] as $breite)
                <div class="flex min-h-9 items-center gap-2.5 rounded-tile px-2">
                    <div class="skeleton size-5 shrink-0 rounded"></div>
                    <div class="text-sm"><span class="skeleton inline-block h-2 rounded-pill align-middle {{ $breite }}"></span></div>
                </div>
            @endforeach
        </div>

        <div class="mt-2 flex items-center gap-1 border-t border-zinc-200 pt-2 dark:border-zinc-800">
            <div class="skeleton size-9 shrink-0 rounded-full"></div>
            <div class="min-w-0 flex-1 px-1.5 text-sm"><span class="skeleton inline-block h-2.5 w-24 rounded-pill align-middle"></span></div>
        </div>
    </div>
</div>
