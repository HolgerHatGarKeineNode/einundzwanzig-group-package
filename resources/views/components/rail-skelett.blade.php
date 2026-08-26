{{-- ── Der Platzhalter des Navigators ──────────────────────────────────────────────

     Er existiert für genau ein Fenster: vom ERSTEN Paint bis zum Alpine-Boot. In
     dieser Zeit gibt es die echte Rail nicht — sie steht in einem
     `<template x-if="$store.viewport?.desktop">` (`desktop-rail.blade.php`), und der
     Inhalt eines `x-if`-Templates ist bis zum Boot **kein DOM-Knoten**.

     ── Was ohne ihn passierte ──────────────────────────────────────────────────────
     Das Chassis (`app-frame.blade.php`) ist ab `xl` ein Grid mit
     `grid-cols-[20rem_minmax(0,1fr)]`. Ohne Rail war die Bühne das ERSTE Kind im
     Fluss und landete per Auto-Placement in Spur 1 — also in den 20 rem, die für den
     Navigator gedacht sind: `#buehne` **320 px statt 1120 px**, `x = 0`, Ortskarte
     **80 px**, Beschriftung auf „C…" gekürzt.

     **Die Messreihe dazu steht an EINER Stelle** — im Kopf von
     `tests/e2e/desktop-boot-geometrie.spec.ts`, zusammen mit den Tests, die sie
     reproduzieren. Hier stand sie ein zweites Mal und ist prompt auseinandergelaufen:
     die Zahlen blieben auf einer verworfenen ersten Instrumentfassung stehen, während
     `app-frame.blade.php` und die Spec längst auf der reproduzierbaren Reihe standen.
     Eine Zahl, die an drei Orten steht, ist an zweien falsch, sobald jemand einen
     korrigiert. Die drei Werte oben bleiben, weil genau sie dort als Literal
     assertiert werden (Kernbeweis und Negativkontrolle).

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
     bewusst — ein Zeichen im Platzhalter behauptet Inhalt, den es noch nicht gibt.

     KORRIGIERT (P6b, 2026-08-27): hier stand als Begründung, der Prompt trage
     `font-mono` und `--font-mono` sei „im Haus-Theme nicht gesetzt". BEIDE Hälften
     stimmen nicht mehr. Die Variable IST gesetzt — Tailwind v4 liefert sie selbst
     mit, das Haus überschreibt nur `--font-sans` (in P4 am gebauten Stylesheet
     nachgemessen, sieben Kommentare mit derselben Behauptung korrigiert). Und der
     Prompt trägt seit P6b kein `font-mono` mehr: am gerenderten Baum stand er in
     `ui-monospace`, während der Rest der Rail in `Inconsolata` läuft — eine zweite
     Schriftfamilie für ein `#`. Der Grund, ihn hier NICHT zu vervielfältigen, bleibt
     unverändert; nur trägt ihn jetzt die Platzhalter-Regel und kein Schriftbefund.

     ── Höhen kommen aus der TYPO, nicht aus Pixeln ─────────────────────────────────
     Die beiden Kopfzeilen reservieren ihre Höhe über die echten Textklassen
     (`text-sm` → 20 px Zeilenbox, `text-xs` → 16,8 px): der Balken liegt als
     `inline-block` IN der Zeile und ändert sie nicht. Ändert jemand die Typo der
     Rail, folgt der Platzhalter — eine hart notierte `h-[16.8px]` täte das nicht.

     ── Die Maßzusage, und WORAN sie hängt ─────────────────────────────────────────
     Am gerenderten Element abgeglichen (1440×900), Blockhöhen Kopf · Suchfeld · Liste
     · Fußzeile. Sie sind KONFIGURATIONSABHÄNGIG, und die erste Fassung dieses
     Docblocks hat genau das verschwiegen — sie schrieb „64,8 / 36 / 527,2 / 264"
     (die Zahlen von damals, vor der Typo-Leiter)
     unbedingt hin, obwohl das nur für eine von drei Lagen stimmt:

       | Lage | Kopf | Suchfeld | Liste | Fußzeile |
       |---|---|---|---|---|
       | mit `workspace_url`, Space ungeladen | 60 | 36 | 532 | 264 |
       | ohne `workspace_url`, Space ungeladen | 60 | 36 | 570 | **226** |
       | mit `workspace_url`, Space MIT Beschreibung | **64** | 36 | **528** | 264 |

     Die ersten beiden Lagen trifft der Platzhalter zahlengleich — er trägt dieselben
     Config-Bedingungen wie `desktop-rail.blade.php`. Die dritte kann er nicht
     treffen: die Beschreibung ist ein Relay-Datum. Dort wächst der Kopf um 4 px,
     die Liste gibt dieselben 4 px ab, Suchfeld und Fußzeile stehen still.

     NACHGEZOGEN 2026-08-26 (P4, Typo-Leiter): der Betrag war 4,8 px, solange die
     Beschreibungszeile `text-[0.7rem]` trug (Zeilenbox 16,8 px). Seit der
     Zusammenlegung auf vier Schriftstufen trägt sie `text-xs` (16 px) — alle Höhen
     dieser Fläche sind damit ganzzahlig, und die Grenze, ab der die Liste vollständig
     federt, liegt bei glatt 380 px statt bei 380,8.

     **Quelle aller drei Zeilen:** `tests/e2e/desktop-boot-geometrie.spec.ts` misst sie
     bei jedem Lauf und hält jede als Literal fest — die zweite Lage über einen eigenen
     `serve` ohne `NOSTR_WORKSPACE_URL`, weil die Bedingung server-seitig entschieden
     wird und eine DOM-Simulation sie nicht prüfen würde. Keine der Zahlen hier ist
     abgeschrieben; sie stehen alle im Test.

     ── Warum `aria-hidden` und ohne jedes bedienbare Element ───────────────────────
     Er trägt keine Information. Ein Screenreader liest ihn nicht, und es gibt nichts
     darin, was Fokus annehmen könnte — sonst stünden zwei Dutzend leere Tab-Stopps
     vor dem Inhalt, für die Dauer des Bootfensters, ohne Ziel. (Hier stand „für
     250 ms" — eine Zahl, die keine Messung stützte; das Fenster ist je nach Drosselung
     ein Vielfaches davon, siehe die Reihe in `desktop-boot-geometrie.spec.ts`.)

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

     ── Was er auf einem TELEFON kostet ────────────────────────────────────────────
     Unterhalb `xl` ist er `hidden` — kein Layout, kein Paint, keine Insel. Im DOM
     steht er trotzdem, und das ist der Preis: **139 Elemente** (am gerenderten Element
     gezählt) und **unter 1 kB auf der Leitung** nach gzip. Die Schranke hält
     `RailSkelettTest` bei jedem Lauf; hier stand zuvor eine exakte Byte-Zahl aus einem
     Wegwerf-Skript, das niemand wieder ausführen kann — und eine Elementzahl (154),
     die aus gezählten spitzen Klammern statt aus Elementen stammte und deshalb schlicht
     falsch war.

     Server-seitig lässt sich der Preis nicht vermeiden: welche Breite der Browser hat,
     weiß erst der Browser. Für weniger als ein Kilobyte ist das gekauft; wer die Zahl
     bewegt, bewegt vor allem die Zeilenzahl der Liste oben. --}}
<div data-rail-skelett aria-hidden="true" x-data x-show="!$store.viewport?.desktop"
     class="hidden min-h-0 flex-col border-e border-zinc-200 bg-white xl:col-start-1 xl:row-start-1 xl:flex dark:border-zinc-800 dark:bg-zinc-900">

    {{-- Space-Kopf. Klassen zeichengleich mit `desktop-rail.blade.php` — mit EINER
         Abweichung, und die ist der Kern der Sache.

         Die echte Rail trägt hier ZWEI Zeilen, die zweite hinter
         `x-show="space?.description"`. Ob es sie gibt, weiß erst der Browser: die
         Beschreibung kommt aus den Space-Metadaten vom Relay. Der Server kann diese
         Bedingung also NICHT tragen — anders als die Forge-Zeile unten, die an einer
         Config hängt.

         Deshalb reserviert der Platzhalter hier nur die SICHERE Grundhöhe: eine
         Titelzeile. Die Kopfhöhe wird damit vom Avatar bestimmt (32 px) und nicht vom
         Textblock, und das ist **die Untergrenze, die in jedem Fall gilt** — am
         gerenderten Element gemessen (1440×900): ohne Beschreibung 60 px, mit
         Beschreibung 64 px (bis 2026-08-26: 64,8 px, siehe oben).

         Die Richtung ist gewählt, nicht übrig geblieben: der Platzhalter darf WACHSEN,
         wenn die Beschreibung eintrifft, aber nie SCHRUMPFEN. Ein Schrumpfen zöge den
         Inhalt darunter nach oben — der Leser verliert die Stelle, und es liest sich
         wie „da war etwas und ist weg". Die vorige Fassung reservierte beide Zeilen und
         hatte damit genau diesen Fehler in der häufigeren Richtung.

         Was bleibt, sind 4 px Wachstum, sobald eine Beschreibung ankommt. Das ist
         Client-Datum und von keinem server-gerenderten Platzhalter einzufangen; es
         steht als Zahl im Test, damit es nicht stillschweigend wächst. --}}
    <div class="flex shrink-0 items-center gap-2.5 px-4 pt-4 pb-3">
        <div class="skeleton size-8 shrink-0 rounded-full"></div>
        <div class="min-w-0 flex-1">
            <div class="text-sm"><span class="skeleton inline-block h-2.5 w-32 rounded-pill align-middle"></span></div>
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

         DREI Gruppen zu sieben Zeilen. Am gerenderten Element gemessen (1440×900,
         Sonde 2026-08-21): Inhaltshöhe **788 px** bei einer Scrollfläche von 532 px,
         also beschnitten — genau die Zusage. Hier stand zuerst eine GERECHNETE 756 px;
         die Rechnung hatte das `pt-2` je Gruppe vergessen. Deshalb steht jetzt der
         gemessene Wert da: 3 × 260 (Gruppe) + 8 (`pb-2` des Containers).

         Die Zeilen füllen die Fläche damit bis zu einem Fenster von rund 1160 px
         (900 + 788 − 532) und lassen darüber Luft. Eine Zahl, die JEDE Fensterhöhe
         füllt, gibt es nicht — der Platzhalter füllt die üblichen, statt hundert leere
         Zeilen zu rendern. --}}
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
                    <div class="text-xs"><span class="skeleton inline-block h-2 w-16 rounded-pill align-middle"></span></div>
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

    {{-- Fußzeile — und hier trägt der Platzhalter DIESELBEN Bedingungen wie die
         Fläche, die er vertritt. Nicht ähnliche, dieselben:

           · Die Artikel-Zeile steht unbedingt, wie dort.
           · Die Forge-Zeile hängt an `config('group.workspace_url')` — zeichengleich
             mit `desktop-rail.blade.php`. Die Config ist `env('NOSTR_WORKSPACE_URL')`
             OHNE Default; in einer Installation ohne Workspace fehlt die Zeile also.
           · Die Nav-Zeilen kommen aus `config('group.nav')`, weil
             `bottom-nav.blade.php` genau darüber iteriert.

             **Nicht, weil ein Host heute vier hätte** — hier stand „Web hat drei,
             Mobile vier", und das ist nachgesehen falsch: `config/group.php` im Host
             führt chat/wallet/settings, das Paket chat/members/settings, beide also
             DREI. Die Vier stammte aus dem `grid-cols-4`-Zweig in
             `bottom-nav.blade.php`, war also aus einem Kommentar extrapoliert statt
             gezählt. Der Grund für die Kopplung ist trotzdem gültig und liegt eine
             Ebene höher: die Zahl ist eine KONFIGURATION, kein Systemwert. Eine
             Konstante daneben wäre auch dann falsch gebaut, wenn sie heute zufällig
             stimmt — und `RailSkelettTest` prüft die Kopplung deshalb gegen mehrere
             Längen und nicht gegen die heutige Drei.
           · Die Profilzeile steht unbedingt, wie dort.

         Die erste Fassung schrieb zwei Flächenzeilen und drei Nav-Zeilen als feste
         Zahlen hin. Gemessen ergab das ohne Workspace eine Fußzeile von 264 statt 226
         und damit **38 px Sprung beim Boot** — derselbe Fehler, gegen den diese ganze
         Datei geschrieben ist, nur eine Ebene tiefer. Wer hier eine Zeile ergänzt,
         ergänzt sie in `desktop-rail.blade.php` mit; `desktop-boot-geometrie.spec.ts`
         misst beide Konfigurationen gegeneinander. --}}
    <div class="shrink-0 border-t border-zinc-200 px-3 py-2 dark:border-zinc-800">
        <div class="mb-2">
            @php($flaechen = config('group.workspace_url') ? [0, 1] : [0])
            @foreach ($flaechen as $i)
                <div @class(['flex min-h-9 items-center gap-2 rounded-tile px-2', 'mt-0.5' => $i > 0])>
                    <div class="skeleton size-4 shrink-0 rounded"></div>
                    <div class="text-sm"><span class="skeleton inline-block h-2 w-14 rounded-pill align-middle"></span></div>
                </div>
            @endforeach
        </div>

        {{-- Die Balkenbreiten wechseln je Zeile; bei mehr Nav-Einträgen als Breiten
             fängt die Folge von vorn an. Alle Werte als volle Literale im Quelltext. --}}
        @php($navBreiten = ['w-12', 'w-20', 'w-24', 'w-16'])
        <div class="flex flex-col gap-0.5">
            @foreach (array_keys(config('group.nav', [])) as $n)
                <div class="flex min-h-9 items-center gap-2.5 rounded-tile px-2">
                    <div class="skeleton size-5 shrink-0 rounded"></div>
                    <div class="text-sm"><span class="skeleton inline-block h-2 rounded-pill align-middle {{ $navBreiten[$n % count($navBreiten)] }}"></span></div>
                </div>
            @endforeach
        </div>

        <div class="mt-2 flex items-center gap-1 border-t border-zinc-200 pt-2 dark:border-zinc-800">
            <div class="skeleton size-9 shrink-0 rounded-full"></div>
            <div class="min-w-0 flex-1 px-1.5 text-sm"><span class="skeleton inline-block h-2.5 w-24 rounded-pill align-middle"></span></div>
        </div>
    </div>
</div>
