{{-- ── Die Ortskarten-Leiste (P5) ──────────────────────────────────────────────────

     Die drei Hauptflächen des Clients — Chat · Artikel · Forge — als ORTE, nicht als
     Tabs. Sie steht auf allen dreien, und zwar aus zwei Gründen:

       1. Ohne sie käme man von `/articles` nach `/forge` nur über den Umweg Chat. Eine
          Leiste, die nur an einem der drei Orte hängt, ist eine Navigation, die in eine
          Richtung funktioniert.
       2. Stünde sie nur auf `/spaces`, wäre Chat immer der aktive Ort — `aria-current`
          wäre eine Konstante und die Zusage „der aktive Ort ist ausgezeichnet" nicht
          prüfbar. Ein Beweis, der nur einen Zustand kennt, ist keiner.

     ── Warum `<a>` und ausdrücklich KEIN `flux:tab` ────────────────────────────────
     Das hier ist Navigation zwischen SEITEN. `role="tab"` verspricht ein `tabpanel` im
     selben Dokument, das beim Aktivieren sichtbar wird; hier verlässt der Klick die
     Seite. Flux setzt in `initializeTab` unbedingt `role="tab"` — auch auf `<a>`, auch
     ohne Panel —, und das ist nicht wegkonfigurierbar (WCAG 4.1.2). Deshalb rohes
     Markup: `<nav>` + `<a wire:navigate>` + `aria-current="page"`. Der aktive Ort steht
     damit im ausgelieferten HTML, nicht erst nach dem Alpine-Boot.

     ── Der Aktiv-Zustand trägt VIER Merkmale, nur eines davon ist Farbe ────────────
     Fläche (getönt), Textgewicht (600 statt 500), Icon-Variante (solid statt outline)
     und die Standlinie unten. WCAG 1.4.1 verlangt, dass Farbe nicht der einzige Träger
     ist; Gewicht, Icon-Form und die An-/Abwesenheit der Linie tun das hier auch ohne
     jede Farbwahrnehmung.

     ── Die Kontrastwerte, und WIE sie gemessen sind ────────────────────────────────
     Alle fünf am gerenderten Element, im Ruhezustand, gegen das GEBAUTE Stylesheet —
     festgenagelt von `tests/e2e/a11y-ortskarten.spec.ts`, das genau diese Träger
     namentlich führt. Die Zahlen hier sind also keine Behauptung, sondern die Ausgabe
     eines Tests, der rot wird, wenn sie nicht mehr stimmen.

     **Methode, damit ein Nachrechner nicht raten muss:** WCAG-2.x-Luminanz auf sRGB,
     gemessen über `tests/e2e/support/contrast.ts` (`measure`/`COLOR_SRC`) — Vordergrund
     UND Untergrund werden schichtweise bis zum ersten opaken Vorfahren komponiert, die
     wirksame `opacity` wird mitgeführt, und die Schwelle kommt aus der Rolle des
     Trägers (Text 4,5:1 · Grafik/Icon 3:1).

     | Träger | hell | dunkel | Schwelle |
     |---|---|---|---|
     | Standlinie `brand-800` / `brand-500` | **5,70** | **6,94** | 3 (1.4.11) |
     | Ortsname `brand-800` / `brand-400`   | **5,70** | **8,06** | 4,5 (1.4.3) |
     | Unterzeile `text-muted`              | **6,94** | **6,32** | 4,5 |
     | Icon `brand-800` / `brand-400`       | **5,70** | **8,06** | 3 |
     | Ortsname inaktiv                     | **17,93** | **16,44** | 4,5 |

     Untergrund der aktiven Karte, komponiert: `rgb(250, 240, 228)` hell,
     `rgb(46, 31, 12)` dunkel — die getönte Fläche, nicht die Seite dahinter. Genau
     daran scheiterte die erste Fassung dieser Tabelle: sie war mit einem
     selbstgebauten Parser gewonnen, und **Chromium serialisiert `bg-brand-500/10` als
     `oklab(…)`**, nicht als `rgb()`. Wer alle Zahlen für 0–255-Komponenten hält, liest
     `0.75` als „fast schwarz" und komponiert einen erfundenen Untergrund. Alle fünf
     Werte waren dadurch falsch (zu niedrig, also nicht geschönt — aber falsch).

     **Warum `brand-800` und nicht `brand-700` wie beim Nav-Balken.** Auch das ist
     nachgemessen statt behauptet: `brand-700` liefert auf dieser getönten Karte
     **3,91:1**. Das hält 1.4.11, aber der Nav-Balken hält auf seinem ungetönten Grund
     4,40:1 — dieselbe Farbe verliert hier also einen halben Punkt an die Tönung.
     `brand-800` bringt ihn auf 5,70 zurück, kostet bei 2 px Höhe optisch nichts und
     gibt der Linie denselben Ton wie dem aktiven Ortsnamen. Das ist keine Abweichung
     von der Hauskonvention, sondern ihre Anwendung: derselbe Ton auf anderem Grund ist
     ein anderer Wert.

     `brand-500` als Linienfarbe im HELLEN wäre zu hell (Rollenregel des Hauses). Die
     Paarung hier ist `bg-brand-800 dark:bg-accent` und damit im hellen Theme EINEN
     Schritt dunkler als der Nav-Balken (`nav-tab.blade.php`: `bg-brand-700`) — die
     Herleitung steht oben bei der Standlinie. Gleiche Rollenlogik, anderer Untergrund,
     deshalb ein anderer Wert.

     ── Die Unterzeile: die eine Auffälligkeit dieser Leiste ────────────────────────
     Jede Karte trägt eine Unterzeile, die von der ersten Pixelzeile an ihre endgültige
     Höhe hat (`h-5`, 20 px). Darin liegen ZWEI Spans übereinander (beide absolut, in
     derselben Box): die statische Zeile und die Live-Zeile. Kommt eine Zahl, wird sie
     HINEINgeblendet — 150 ms Opazität, sonst nichts. Kommt keine, bleibt die statische
     Zeile stehen. Kein Skeleton, kein Platzhalter, kein Sprung.

     Warum kein Skeleton: ein Skeleton ist die Zusage „hier kommt gleich etwas". Für
     diese Zahlen ist sie nicht gedeckt — sie kommen von zwei verschiedenen Relays,
     eines hinter NIP-42, und Schweigen ist ein möglicher Ausgang. Ein Skeleton, das nie
     zur Zahl wird, ist eine Falschaussage über den Systemzustand (Nielsen #1). Die
     Regel, wann eine Zahl überhaupt zählt, steht geprüft in `js/ortskarten.ts`
     (`zeigeLive`) — `0` und `null` sind derselbe Fall.

     ── Die zwei `{!! !!}` und die Bedingung, unter der sie sicher sind ─────────────
     Zweimal wird `$ort['live']` ROH ausgegeben (im `:aria-label` und im `x-text`). Roh
     muss es sein, weil dort ein ALPINE-AUSDRUCK steht und `{{ }}` dessen Anführungs-
     zeichen escapen würde — der Ausdruck käme als Text im Attribut an.

     **Das ist genau so lange unbedenklich, wie `$orte` ein dateilokales Literal ist.**
     Die Tabelle steht sechzig Zeilen weiter oben, im selben `@php`-Block, und enthält
     keinen Request-, Config-, Übersetzungs- oder Datenbankwert. Sobald einer dieser
     Wege sie speist, sind das ZWEI Injektionspunkte in einen Ausdruck, den Alpine
     auswertet — `x-html`/`x-text` rufen `initTree()`, und ein Ausdruck ist dort ein
     Ausführungspfad, kein Text (dieselbe Grenze, die `js/longform.ts:36-43` für den
     Markdown-Renderer beschreibt). Wer die Tabelle je von außen füllt, muss den
     Ausdruck vorher gegen eine Whitelist prüfen oder auf `{{ }}` umstellen und die
     Anführungszeichen anders lösen. Der `statisch`-Wert daneben geht bewusst durch
     `@js()` und ist deshalb von dieser Bedingung nicht betroffen.

     ── Der Screenreader bekommt EINEN Satz, nicht zwei Zeilen ──────────────────────
     Beide Spans liegen im DOM, also läse ein Screenreader ohne Zutun „Artikel Vom
     Verein 104 Artikel". Deshalb ist der ganze Unterzeilen-Kasten `aria-hidden`, und
     der Link trägt ein `:aria-label`, das den Ortsnamen mit der GERADE geltenden
     Unterzeile verbindet. Der sichtbare Name steht darin vorn (WCAG 2.5.3, Label in
     Name), und was die Kürzung auf schmalen Geräten optisch abschneidet, bleibt hörbar.

     ── Warum jede `match`-Liste GENAU EINEN Eintrag hat ────────────────────────────
     Sie enthielt zuerst auch die Detail-Routen (`group.room`, `group.article`,
     `group.articles.author`, `group.forge.repo`) — nach dem Vorbild der Rail-Fußzeile,
     die „wer einen Artikel liest, ist unter Artikel" so löst.

     **Für diese Leiste war das vier Zeilen Konfiguration ohne Wirkung.** Sie steht auf
     genau drei Flächen (`⚡spaces`, `⚡articles`, `⚡forge`); auf den Detail-Ebenen wird
     sie bewusst NICHT eingebunden — dort führt der `app-header` zurück, und eine
     Ortsleiste über einer Detailseite behauptete, man sei an einem der drei Orte
     angekommen, statt eine Ebene darunter. Die eigene E2E belegt es sogar ausdrücklich:
     auf der Autorenseite ist `[data-ortskarte]` count 0.

     Der Unterschied zur Rail-Fußzeile ist kein Widerspruch, sondern folgt aus der
     Fläche: die Rail steht auf JEDER Desktop-Seite, auch auf den Detail-Ebenen — dort
     beantwortet ihr `aria-current` eine Frage, die sich wirklich stellt. Ihre
     Match-Listen bleiben deshalb mehrteilig.

     ── Die Forge-Karte hängt an der Server-Config ──────────────────────────────────
     Ohne `group.workspace_url` gibt es keine Forge-Quelle; `⚡forge.blade.php` zeigt
     dort einen erklärenden Leerzustand. Eine Ortskarte, die in einen Leerzustand führt,
     ist ein Ort ohne Inhalt — deshalb entfällt sie, und die Leiste hat zwei Spalten.
     BEIDE Spaltenzahlen stehen als volles Literal im Quelltext (`grid-cols-3` /
     `grid-cols-2`): Tailwind scannt Quelltext, ein zusammengesetzter Klassenname
     entstünde im JIT nie.

     **Mit einer Ausnahme, und die ist keine Bequemlichkeit:** steht man GERADE auf
     einer Forge-Route, wird die Karte auch ohne Config gerendert. Die Route bleibt per
     Adresszeile erreichbar, und eine Leiste, in der KEINE Karte `aria-current` trägt,
     beantwortet „wo bin ich" mit Schweigen — das ist schlechter als eine Karte, die
     ehrlich an einen erklärten Leerzustand führt. Die Zusage „genau eine Karte ist
     aktiv" gilt damit auf jeder Fläche, auf der die Leiste steht.

     ── Damit gelten für „zeige Forge" ZWEI Regeln, und das ist gewollt ─────────────
     Die Forge-ZEILE der Rail-Fußzeile (`desktop-rail.blade.php`) erscheint NUR bei
     gesetzter Config, ohne diese Ausnahme. Beides beantwortet verschiedene Fragen:

       · Die Rail-Zeile fragt „kann ich dorthin gehen?" — ohne Config ist die Antwort
         nein, und ein dauerhafter Link in einen Leerzustand wäre ein leeres Versprechen
         auf jeder Desktop-Seite.
       · Die Ortskarte fragt zusätzlich „wo bin ich gerade?" — und wer die Adresse von
         Hand geöffnet hat, IST dort. Diese Frage verschwindet nicht, nur weil die
         Konfiguration fehlt.

     Eine gemeinsame Regel müsste eine der beiden Fragen falsch beantworten. --}}
@php($hatForge = (bool) config('group.workspace_url') || request()->routeIs('group.forge', 'group.forge.repo'))
@php($orte = array_values(array_filter([
    [
        'key' => 'chat',
        'route' => 'group.spaces',
        'match' => ['group.spaces'],
        'icon' => 'chat-bubble-left-right',
        'label' => __('Chat'),
        'statisch' => __('Räume'),
        // Der Ungelesen-Stand ist die einzige Zahl dieser Karte, die zum Handeln
        // auffordert — eine Raumzahl beantwortet keine Frage, die jemand hat.
        'live' => "\$plural(ungelesen(), '1 ungelesen', ':count ungelesen')",
        'wert' => 'ungelesen()',
    ],
    [
        'key' => 'artikel',
        'route' => 'group.articles',
        'match' => ['group.articles'],
        'icon' => 'document-text',
        'label' => __('Artikel'),
        // „Vom Verein" statt einer Gattungsbezeichnung: kind 30023 kommt in diesem
        // Client ausschließlich vom Vereins-Relay (Kuratierungsregel), und das ist die
        // Auskunft, die der Kartenname „Artikel" noch nicht gibt.
        'statisch' => __('Vom Verein'),
        'live' => "\$plural(artikelZahl, '1 Artikel', ':count Artikel')",
        'wert' => 'artikelZahl',
    ],
    $hatForge ? [
        'key' => 'forge',
        'route' => 'group.forge',
        'match' => ['group.forge'],
        'icon' => 'code-bracket-square',
        'label' => __('Forge'),
        'statisch' => __('Repos'),
        'live' => "\$plural(repoZahl, '1 Repo', ':count Repos')",
        'wert' => 'repoZahl',
    ] : null,
])))

<nav x-data="nostrOrtskarten" aria-label="{{ __('Bereiche') }}"
     @class([
         'mb-4 grid gap-2',
         'grid-cols-3' => $hatForge,
         'grid-cols-2' => ! $hatForge,
     ])>
    @foreach ($orte as $ort)
        @php($aktiv = request()->routeIs(...$ort['match']))
        <a href="{{ route($ort['route']) }}" wire:navigate
           @if ($aktiv) aria-current="page" @endif
           data-ortskarte="{{ $ort['key'] }}"
           {{-- Der eine Satz für den Screenreader: Ortsname + geltende Unterzeile.
                `.split().join()` statt `:name`-Ersetzung im Ausdruck — dieselbe
                Bauform wie im Profil-Chip; ein `__()` mit Platzhalter bleibt damit
                ein einziger Übersetzungsschlüssel. --}}
           :aria-label="@js(__(':ort — :stand')).split(':ort').join(@js($ort['label']))
               .split(':stand').join(zeigt({{ $ort['wert'] }}) ? {!! $ort['live'] !!} : @js($ort['statisch']))"
           @class([
               'pressable relative flex min-h-16 flex-col justify-between overflow-hidden rounded-card border p-3 transition-colors',
               'border-brand-500/40 bg-brand-500/10 dark:bg-brand-500/15' => $aktiv,
               'border-zinc-200 bg-white shadow-card hover:bg-brand-500/5 dark:border-zinc-800 dark:bg-zinc-900 dark:shadow-none' => ! $aktiv,
           ])>

            {{-- Standlinie: nur der aktive Ort hat sie. Ein Grafikobjekt, das den
                 Zustand allein tragen könnte — siehe die Kontrastwerte oben. --}}
            @if ($aktiv)
                <span data-ortskarte-linie class="absolute inset-x-0 bottom-0 h-0.5 bg-brand-800 dark:bg-accent" aria-hidden="true"></span>
            @endif

            <span class="flex min-w-0 items-center gap-2">
                <flux:icon :name="$ort['icon']" :variant="$aktiv ? 'solid' : 'outline'"
                           @class([
                               'size-5 shrink-0',
                               'text-brand-800 dark:text-brand-400' => $aktiv,
                               'text-muted' => ! $aktiv,
                           ]) />
                <span data-ortskarte-name @class([
                    'min-w-0 truncate text-sm leading-snug',
                    'font-semibold text-brand-800 dark:text-brand-400' => $aktiv,
                    'font-medium text-zinc-900 dark:text-zinc-100' => ! $aktiv,
                ])>{{ $ort['label'] }}</span>
            </span>

            {{-- Der Unterzeilen-Kasten. `h-5` (20 px) ist die Höhe von Anfang an —
                 beide Kinder sind absolut und können sie nicht ändern. `aria-hidden`,
                 weil der Link seinen Satz oben schon trägt.

                 ── Die Startwerte stehen im `style`, NICHT in einer Klasse ──────────
                 Erster Entwurf band die Opazität über `x-bind:class`. Das ergab einen
                 Zustand, den es nicht geben darf: **vor dem Alpine-Boot trägt der Span
                 gar keine Opazitätsklasse** und steht damit auf 1. Beim ersten
                 Durchlauf setzt Alpine ihn auf 0 — und weil `transition-opacity` schon
                 dranhängt, ist das keine stille Korrektur, sondern eine sichtbare
                 150-ms-Blende. Gemessen (2026-08-21, Sonde auf `getComputedStyle`):
                 unmittelbar nach dem Mount stand die Live-Zeile in ALLEN DREI Karten
                 auf `opacity: 0.5611` — mitten im Ausblenden.

                 Bei leerem Text fällt das nicht auf. Es fällt auf, sobald die Zahl beim
                 ersten Durchlauf schon da ist (warmer Cache): dann kommen BEIDE Spans
                 von 1, und für eine Blendenlänge steht der Live-Text über dem
                 statischen. Im Screenshot las sich das als „VoamrVteikeeln" — zwei
                 Zeilen übereinander, also genau der Zustand, den dieser Kasten
                 verhindern soll.

                 `x-bind:style` statt `x-bind:class` löst beides an der Wurzel: der
                 SERVER liefert `opacity:1` bzw. `opacity:0` mit, Alpine schreibt beim
                 ersten Durchlauf denselben Wert und löst deshalb keine Transition aus.
                 Bewegung entsteht erst, wenn sich der Wert wirklich ändert. Objekt-
                 Syntax, damit Alpine die vorhandene Deklaration ersetzt statt das
                 ganze Attribut zu überschreiben. --}}
            <span class="relative mt-1 block h-5" aria-hidden="true">
                <span data-ortskarte-statisch style="opacity:1"
                      class="absolute inset-x-0 top-0 truncate text-xs font-medium leading-5 text-muted transition-opacity duration-150 ease-out motion-reduce:transition-none"
                      x-bind:style="{ opacity: zeigt({{ $ort['wert'] }}) ? 0 : 1 }">{{ $ort['statisch'] }}</span>
                <span data-ortskarte-live style="opacity:0"
                      class="absolute inset-x-0 top-0 truncate text-xs font-medium leading-5 tabular-nums text-muted transition-opacity duration-150 ease-out motion-reduce:transition-none"
                      x-bind:style="{ opacity: zeigt({{ $ort['wert'] }}) ? 1 : 0 }"
                      x-text="zeigt({{ $ort['wert'] }}) ? {!! $ort['live'] !!} : ''"></span>
            </span>
        </a>
    @endforeach
</nav>
