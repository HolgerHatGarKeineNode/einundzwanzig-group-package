<?php

use Livewire\Attributes\Layout;
use Livewire\Component;

/**
 * Artikelliste („Artikel", `/articles`) als Livewire-Full-Page-SFC.
 *
 * Die Klasse ist ein dünner Shell — Laden, Filtern, Sortieren und Rendern leben komplett
 * in der Alpine-Insel `nostrArticles` (welshman, client-seitig). Kein `mount()`: es gibt
 * server-seitig nichts vorzubereiten. Die Artikel stehen zwar öffentlich auf dem
 * Vereins-Relay, die Seite liegt aber wie alle anderen hinter `nostr.auth` — ein
 * server-gerenderter OG-Kopf wäre für einen Crawler unerreichbar.
 */
new #[Layout('group::einundzwanzig')] class extends Component
{
    public function render()
    {
        return $this->view()->title(__('Artikel'));
    }
}; ?>

{{--
    ── Der Entwurf dieser Fläche (P2), damit die nächste Änderung ihn nicht rät ────────

    AUFGABE. Ein Leser kommt hierher mit genau einer Frage: „Was lese ich als Nächstes?"
    Alles andere ist nachgeordnet. Daraus folgt die Hierarchie, und aus ihr alles Übrige.

    HIERARCHIE (zuerst entschieden, vor Farbe und Typografie).
      1. Der TITEL ist das Primäre jeder Karte. Er trägt vollen Textkontrast; sonst
         bekommt ihn nichts.
      2. Das Titelbild ist der Anker fürs Auge, nicht der Inhalt — es steht oben, aber es
         schreit nicht.
      3. Byline, Teaser, Datum und Lesezeit sind Sekundär- und Tertiärebene und laufen
         alle über `text-muted`. Unterschieden werden sie durch GEWICHT und GRÖSSE, nicht
         durch weitere Farben.

    LAYOUT. Raster unverändert `grid-cols-1 sm:grid-cols-2` (Mehrspaltigkeit ab `xl` ist
    P5 und hängt an der `width`-Prop von `app-shell`). Darüber der Filterkopf in der
    Bauform von `⚡spaces.blade.php`: Suchfeld, darunter eine Zeile aus Facetten-Knopf und
    grauer Trefferzahl, darunter die entfernbaren Chips. Abstände aus der 4/8-Skala
    (`gap-2`, `gap-3`, `p-4`, `mb-3`) — keine freien Pixelwerte.

    Die ERSTE Karte der unveränderten Ansicht spannt ab `sm` beide Spalten und legt Bild
    und Text nebeneinander. Sie ist die einzige Ausnahme im Raster, und sie existiert nur
    ungefiltert und in der Standard-Ordnung: die Hervorhebung behauptet „das ist der
    neueste Artikel", und unter einer Suche oder in A–Z wäre das schlicht unwahr
    (`ArticleCard.featured`, in `articleList.test.ts` festgenagelt).

    TYPOGRAFIE. Eine Familie (Inconsolata, `--font-sans` im Theme), vier Rollen:
      · Display   20 px / 700 / `leading-tight`  — nur der Titel der hervorgehobenen Karte
      · Titel     16 px / 600 / `leading-snug`   — Primärebene jeder übrigen Karte
      · Fließtext 14 px / 400 / `leading-normal` — Teaser, `text-muted`
      · Auszeichnung 12 px / 500–600            — Byline, Datum, Lesezeit, Plakette
    KEIN `font-mono`: `--font-mono` ist im Theme gar nicht definiert (`theme.css` setzt
    nur `--font-sans`), jedes `font-mono` zöge still eine zweite Schriftfamilie. Zahlen
    bekommen `tabular-nums`.

    FARBE. Fünf Rollen, alle aus dem Haus-Token-Satz — kein neuer Hex-Wert:
      · Fläche       `surface-card`  = #ffffff / #171717 (zinc-900)
      · Primärtext   zinc-900 #171717 / zinc-100 #f5f5f5 — ausschließlich der Titel
      · Sekundärtext `text-muted`    = zinc-600 #525252 / zinc-400 #a3a3a3
                     (7,81:1 auf Weiß, 7,11:1 auf zinc-900 — beide mit Reserve bis AAA)
      · Akzent       brand-800 #98480f / brand-400 #fda537 auf `brand-500/10`
                     (5,91:1; brand-700 rechnet dort nur 4,05:1 und risse — mit
                     sRGB-Komposition nachgerechnet, wie der Browser sie ausführt)
      · Ersatz-Cover die acht Paare aus `COVER_PALETTE` (P1), schlechtestes 8,34:1 gegen
                     Weiß — sie wurden genau dafür gewählt, dass Schrift darauf steht.

    SIGNATUR — „Kein Bild? Dann ist die Schrift das Bild."
    14 der 104 Artikel tragen kein `image`. Statt eine graue Lücke oder einen anonymen
    Verlauf zu zeigen, wandert bei diesen Karten der Titel selbst AUF das Cover: groß,
    weiß, links unten, auf dem deterministischen Verlauf aus `pubkey:d`. Es ist derselbe
    einzige `<h2>` — er wechselt nur seinen Platz. Damit ist nichts doppelt, die Karte hat
    keine Leerstelle, und die coverlosen Artikel werden untereinander unterscheidbar,
    statt als acht Farbflächen zu verschwimmen. Das ist die eine laute Entscheidung dieser
    Fläche; alles andere bleibt bewusst still (keine neue Bewegung, keine Schatten-Stufe,
    kein zweiter Akzent).

    DAS DATUM IST RELATIV, ABER NUR OBEN. Für die jüngsten 30 Tage steht „vor 3 Tagen",
    darüber hinaus das Datum. Der Grund ist gemessen und nicht geschmacklich: 15 der 104
    Artikel sind jünger als 30 Tage — aber **50 tragen ein Juni-2026-Datum** und weitere
    24 ein Juli-Datum (gezählt; über die Herkunft der Häufung sagt das nichts — die 50
    verteilen sich auf 17 verschiedene Tage). Eine großzügigere Schwelle schriebe „vor 2 Monaten" fünfzigmal
    untereinander und ebnete damit genau die Unterschiede ein, die das Datum bewahrt. So
    beantwortet die Angabe oben in der Liste „ist das neu?" und weiter unten „wann war
    das?". Die Regel liegt geprüft in `js/longform.ts` (`relativeDateParts`), die
    Schwelle als Konstante daneben; die VOLLANSICHT bekommt weiterhin das absolute Datum
    (Begründung bei `dateLabelListe` in `js/longformFeed.ts`).

    Dass `⚡article.blade.php` dadurch zeichengleich bleibt, ist nachgesehen und nicht
    angenommen — drei Punkte: die Vollansicht liest von allen Datumsfeldern der Zeile
    ausschließlich `article.dateLabel`, `deriveArticle` ruft `toRow` OHNE dritten Parameter
    (bekommt also `dateLabelAbsolut`), und dessen Rumpf ist zeichengleich mit der
    `dateLabel`-Funktion vor P2. Die vier neuen Zeilenfelder rührt sie nicht an.

    BEWEGUNG. Keine neue. `page-enter`, `chip-in` und `empty-state` existieren im Theme und
    werden unter `prefers-reduced-motion` dort bereits abgeschaltet; die Karten haben nur
    ihren Farbübergang beim Hover.

    ── Podcast und fehlendes Titelbild sind ZWEI Merkmale, nicht eines ─────────────────

    Am 2026-08-20 über den Bestand gemessen: 14 Episoden, 14 Artikel ohne `image` — die
    Schnittmenge ist aber **12**. Zwei Episoden bringen ein Titelbild mit, zwei
    Nicht-Episoden bringen keins. Die Karte behandelt beides deshalb unabhängig: die
    Cover-Quelle entscheidet `card.image`, die Podcast-Klasse `card.podcast`. Wer die
    beiden Mengen gleichsetzt, baut zwei kaputte Karten — eine Episode ohne Player und
    eine Textkarte mit einem.

    KEINE DAUER, und zwar als Normalfall: 0 von 14 Episoden tragen eine Länge (NIP-94 kennt
    das Feld gar nicht). **Im RUHEZUSTAND behauptet die Karte deshalb nirgends eine Länge**
    — dieses Markup enthält kein Dauer-Feld, und es enthält auch keinen Player: der
    Ruhezustand einer Episode ist ein KNOPF. Das ist nötig, weil das native Bedienelement
    ohne bekannte Länge selbst „0:00 / 0:00" in seine Leiste schreibt (am gerenderten
    Bildschirm nachgesehen, hell wie dunkel). Ein `<audio>` existiert vor dem Klick gar
    nicht im DOM; ein Test hält das mit `toHaveCount(0)` fest.

    **Nach dem Klick ist es der Zustand eines Players, den der Leser selbst geöffnet hat,
    und dann gilt die Zusage nicht mehr** — bis die Metadaten eintreffen, steht dort
    „0:00 / 0:00", und bei einem unerreichbaren Host bleibt es dabei. Die vier
    Podcast-Bridges sind fremde Hosts. Das ist hingenommen und nicht verschwiegen: ein vom
    Leser ausgelöster Ladezustand ist etwas anderes als eine Behauptung der LISTE über
    einen Artikel, den er noch nicht angefasst hat.

    Der Knopf trägt zugleich die zweite Zusage: solange niemand geklickt hat, holt die
    Liste nichts von den vier fremden Hosts — dieselbe Linie, die der Bild-Proxy zieht.
--}}

@php
    /**
     * Die drei Ordnungen der Liste, übersetzt.
     *
     * Die WERTE spiegeln `ARTICLE_SORTS` aus `js/articleSorts.ts` wörtlich. Sie sind die
     * EINZIGE verbliebene Kopie dieser Liste — `bridge.ts` importiert die Konstanten seit
     * P2-Nachbesserung, statt `'newest'` dreimal auszuschreiben. PHP und TypeScript teilen
     * zur Laufzeit nichts, also lässt sich diese letzte Kopie nicht beseitigen; sie wird
     * deshalb GEHALTEN und nicht behauptet: `js/articleSorts.test.ts` liest diesen Block
     * aus der Datei und vergleicht ihn mit `ARTICLE_SORTS`, **Reihenfolge inklusive**.
     * Vier Mutationsproben stehen dahinter (verdrehter Wert, vertauschte Reihenfolge,
     * rückkehrendes Literal in `bridge.ts`, und die Sonde selbst kaputt — sie wirft dann,
     * statt zu bestehen).
     *
     * Hier stand vorher, ein „Server-Test in `LongformReaderTest.php`" halte beide Seiten
     * zusammen. **Das war falsch** — dort steht keine einzige Zusicherung auf einen
     * Sortierwert. Der Satz bleibt als Warnung stehen: eine falsche Deckungszusage ist
     * schlimmer als eine fehlende, weil der nächste Leser nicht nachprüft.
     *
     * Die BESCHRIFTUNGEN stehen hier und nicht in `bridge.ts`, weil `__()` nur zur
     * Render-Zeit die Request-Locale sieht — dieselbe Aufteilung wie bei den Rail-Gruppen
     * und den Suchfeld-Platzhaltern.
     *
     * @var list<array{value: string, label: string}> $sortOptions
     */
    $sortOptions = [
        ['value' => 'newest', 'label' => __('Neueste')],
        ['value' => 'author', 'label' => __('Nach Autor')],
        ['value' => 'title', 'label' => __('A–Z')],
    ];
@endphp

{{-- `width="wide"`: die Liste ist ein RASTER. Der Fließtext dieser Fläche steht in
     den Karten und ist dort auf `line-clamp` gedeckelt — die Bühne muss ihn nicht
     zusätzlich einengen. Ab `xl` trägt sie damit drei, ab `2xl` vier Spalten. --}}
<x-group::app-shell width="wide">

    {{-- Der Basis-Pfad kommt aus `route()`, nicht als Literal in die Insel: die Route
         heißt an genau einer Stelle `/articles`, und das ist `routes/group.php`. --}}
    <div x-data="nostrArticles(@js(route('group.articles')), @js($sortOptions))" class="page-enter">

        <x-group::app-header :title="__('Artikel')" :back="route('group.spaces')" />

        <x-group::ortskarten />

        {{-- Ob es überhaupt eine Quelle gibt, entscheidet der SERVER — nicht die Insel.

             Das ist kein Stil, sondern die Voraussetzung dafür, dass das Skeleton unten
             ab dem ersten Paint dasteht: der Inhalt eines `<template x-if>` existiert vor
             dem Alpine-Boot GAR NICHT im DOM, und ein `x-show` auf dem Leerzustand ließe
             ihn bis zum Boot aufblitzen. Beide Zweige stehen deshalb hinter `@if`.

             Folge für Tests: ein E2E-Lauf, der Artikel prüfen will, setzt
             `NOSTR_BOARD_URL` in der ENV des Servers — genau wie `fixtures.ts` es für
             `NOSTR_SPACE_URL` und `NOSTR_PROFILE_INDEXER` bereits tut. Ein reines
             `window.__nostrBoard` per `addInitScript` reicht hier NICHT. --}}
        @if (! config('group.board_relay_url'))
            {{-- Keine Quelle konfiguriert. Das ist kein Fehler, sondern eine bewusste
                 Konfiguration: dieses Package läuft in mehreren Hosts, und nicht jeder
                 hat ein Artikel-Relay. Deshalb ein erklärender Leerzustand statt einer
                 Fehlermeldung — und kein einziger REQ. --}}
            <div class="surface-card empty-state px-4 py-10 text-center">
                <flux:icon.document-text class="mx-auto size-8 text-zinc-400" />
                <flux:heading class="mt-2">{{ __('Keine Artikel-Quelle eingerichtet.') }}</flux:heading>
                <flux:text class="mt-1 text-sm text-muted">{{ __('Dieser Client kennt kein Relay, auf dem Artikel liegen.') }}</flux:text>
            </div>
        @else
            <div>
                {{-- Fehler: die Liste ist UNVOLLSTÄNDIG, nicht falsch — was schon im
                     Gerätespeicher liegt, steht weiter da. Gleicher Wortlaut-Bau wie
                     auf `/updates`. --}}
                <template x-if="error">
                    <flux:callout variant="danger" icon="exclamation-triangle" class="mb-3">
                        <flux:callout.text>{{ __('Die Artikel sind gerade nicht erreichbar.') }}</flux:callout.text>
                        <x-slot name="actions">
                            <flux:button size="sm" variant="ghost" icon="arrow-path" x-on:click="retry()">{{ __('Erneut laden') }}</flux:button>
                        </x-slot>
                    </flux:callout>
                </template>

                {{-- `:aria-busy` sagt Hilfstechnik, dass hier gerade befüllt wird. --}}
                <div :aria-busy="loading">

                    {{-- Lade-Ansage. Steht PERMANENT im DOM und mit server-seitig LEEREM
                         Inhalt: `aria-live` meldet Änderungen INNERHALB einer bestehenden
                         Region — ein Text, der schon beim Seitenaufbau dasteht und danach
                         nur versteckt wird, wird nie angesagt (dieselbe Begründung wie in
                         `⚡updates.blade.php`). --}}
                    <span class="sr-only" aria-live="polite"
                          x-text="loading ? @js(__('Artikel werden geladen…')) : ''"></span>

                    <div x-show="isEmpty()">

                        {{-- Laden: SERVER-gerendert per @for, NICHT x-if — ein
                             x-if-Template existiert vor dem Alpine-Boot nicht im DOM, die
                             Fläche bliebe bis dahin weiß. Die Balken bilden die Karte von
                             unten nach: Cover, Titel, zwei Teaser-Zeilen, Meta. --}}
                        <div x-show="loading" class="grid grid-cols-1 gap-3 sm:grid-cols-2">
                            @for ($i = 0; $i < 6; $i++)
                                <div class="surface-card overflow-hidden">
                                    <div class="skeleton aspect-[16/9] w-full"></div>
                                    <div class="space-y-2 p-4">
                                        <div class="skeleton h-3 w-1/4"></div>
                                        <div class="skeleton h-4 w-3/4"></div>
                                        <div class="skeleton h-3 w-full"></div>
                                        <div class="skeleton h-3 w-1/3"></div>
                                    </div>
                                </div>
                            @endfor
                        </div>

                        {{-- Leer und fertig geladen: Aussage, Erwartung, Ausweg — kein
                             nackter Bildschirm (Nielsen #1/#3).

                             `&& !error` ist der Kern von B3: „Noch keine Artikel." ist eine
                             Aussage ÜBER den Relay. Wenn er nicht geantwortet hat, ist sie
                             nicht gedeckt — und stünde sonst direkt unter dem Callout, das
                             das Gegenteil sagt. Ein Bildschirm, zwei widersprechende
                             Sätze: genau das, was der Leser nicht auflösen kann. --}}
                        <div x-show="!loading && !error" x-cloak class="surface-card empty-state px-4 py-10 text-center">
                            <flux:icon.document-text class="mx-auto size-8 text-zinc-400" />
                            <flux:heading class="mt-2">{{ __('Noch keine Artikel.') }}</flux:heading>
                            <flux:text class="mt-1 text-sm text-muted">{{ __('Sobald jemand einen Artikel veröffentlicht, erscheint er hier.') }}</flux:text>
                            <div class="mt-4">
                                <flux:button size="sm" variant="ghost" icon="hashtag" :href="route('group.spaces')" wire:navigate>{{ __('Zu den Räumen') }}</flux:button>
                            </div>
                        </div>
                    </div>

                    {{-- ── Filterkopf: Suche · Ordnung · Trefferzahl · Chips ─────────────

                         Erscheint erst mit dem Bestand — ein Suchfeld über einer leeren
                         Liste ist ein Werkzeug ohne Gegenstand.

                         Die Suche läuft über den GELADENEN Bestand, und das ist hier kein
                         Notbehelf, sondern die bessere Lösung: der Relay kann NIP-50
                         nicht — und er sagt es nicht. Ein `search`-Schlüssel wird lautlos
                         verworfen und liefert beliebige Artikel statt `CLOSED`. Eine
                         serverseitige Suche wäre also nicht leer, sondern FALSCH POSITIV.
                         Bei 104 Artikeln (Deckel: `ARTICLE_LOAD_LIMIT = 200`) liegt ohnehin
                         alles im Speicher. Die Laufzeit-Begründung steht im Modulkopf von
                         `js/articleList.ts`. --}}
                    <div x-show="!isEmpty()" x-cloak class="mb-3 space-y-2">
                        {{-- Der Platzhalter hängt an einem ROHEN Wrapper-Element, nicht am
                             Flux-Attribut: Blade führt `@js()` in einer
                             Komponenten-Attributliste NICHT aus (es landete wörtlich im
                             Alpine-Ausdruck und der Platzhalter bliebe leer — im Haus am
                             kompilierten View gemessen). Das Kind erbt den Alpine-Scope,
                             `x-model="query"` trifft also weiterhin nostrArticles.

                             `x-show` steht am Wrapper oben und NICHT am `flux:input` — am
                             Flux-Tag bliebe das Icon stehen. --}}
                        <div x-data="{ ph: @js(__('Artikel suchen…')) }">
                            <flux:input x-model="query" icon="magnifying-glass" clearable
                                        ::placeholder="ph" />
                        </div>

                        <div class="flex flex-wrap items-center gap-2">
                            {{-- Ordnung → Alpine-Popover, KEIN `flux:dropdown` (das
                                 verschluckt rohe Kinder) und kein `flux:tabs` (drei
                                 Beschriftungen passen bei 320 px nicht in eine
                                 Segmented-Bar). Bauform 1:1 vom Land-Filter in
                                 `⚡spaces.blade.php`. --}}
                            <div x-data="{ open: false }" class="relative">
                                <button type="button" x-on:click="open = !open"
                                        aria-haspopup="true" :aria-expanded="open"
                                        class="pressable inline-flex min-h-[2.75rem] items-center gap-2 rounded-pill px-3 text-sm font-medium ring-1 ring-inset transition-colors"
                                        {{-- Abweichende Ordnung: `brand-800`, nicht
                                             `brand-700`. Die Farbe trägt die Beschriftung
                                             (14 px/500) — TEXT, also 1.4.3 mit 4,5:1. Auf
                                             dem eigenen Tint (`brand-500/10` über Weiß)
                                             rechnet brand-700 4,05:1 und risse,
                                             brand-800 5,91:1. Der `ring-brand-500/30`
                                             bleibt: er ist die Grenze eines Bedienelements
                                             (1.4.11) und hier nicht der Prüfgegenstand. --}}
                                        :class="sort !== 'newest' ? 'bg-brand-500/10 text-brand-800 ring-brand-500/30 dark:text-brand-400' : 'text-zinc-700 ring-black/10 hover:bg-black/5 dark:text-zinc-200 dark:ring-white/15 dark:hover:bg-white/5'">
                                    <flux:icon.bars-arrow-down variant="micro" class="size-4" />
                                    {{-- Ohne diesen Zusatz hieße der Knopf für eine
                                         Sprachausgabe nur „Neueste" — ein Wort ohne
                                         Gegenstand (WCAG 2.4.6). --}}
                                    <span class="sr-only">{{ __('Sortierung') }}</span>
                                    <span x-text="sortLabel()"></span>
                                    <flux:icon.chevron-down variant="micro" class="size-4 text-muted transition-transform" ::class="open ? 'rotate-180' : ''" />
                                </button>

                                <div x-show="open" x-cloak x-transition
                                     x-on:click.outside="open = false" x-on:keydown.escape.window="open = false"
                                     class="surface-card absolute start-0 z-30 mt-2 w-56 max-w-[calc(100vw-2rem)] p-1 shadow-lg">
                                    <template x-for="option in sortOptions()" :key="option.value">
                                        <button type="button" x-on:click="sort = option.value; open = false"
                                                class="pressable flex min-h-[2.75rem] w-full items-center gap-2 rounded-tile px-2 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
                                                {{-- Ausgewählte Zeile: die Farbe trägt den
                                                     Zeilentext (TEXT, 1.4.3, 4,5:1) — auf
                                                     der weißen Popover-Karte rechnet
                                                     brand-700 4,40:1 und risse,
                                                     brand-800 6,42:1. Das Häkchen daneben
                                                     behält `brand-700`: es ist ein
                                                     Grafikobjekt (1.4.11, ≥ 3:1) und trägt
                                                     dort mit 4,40:1. --}}
                                                :class="sort === option.value ? 'font-semibold text-brand-800 dark:text-brand-400' : ''">
                                            <span class="flex-1" x-text="option.label"></span>
                                            <flux:icon.check x-show="sort === option.value" x-cloak class="size-4 shrink-0 text-brand-700 dark:text-brand-400" />
                                        </button>
                                    </template>
                                </div>
                            </div>

                            {{-- Trefferzahl — die graue Zahl aus dem Hausmuster, am Ende
                                 der Zeile, in der die Bedienelemente stehen, die sie
                                 verändern.

                                 NUR bei aktiver Suche: eine andere Ordnung ändert die
                                 Anzahl nicht, die Zahl sagte dort also nichts. Bei 0
                                 Treffern keine Zahl — das sagt der Leerzustand darunter
                                 besser und mit einem Ausweg.

                                 `tabular-nums` statt `font-mono` (siehe Kopf). --}}
                            <span x-show="query.trim() !== '' && cards.length > 0" x-cloak
                                  class="ms-auto shrink-0 text-xs tabular-nums text-muted"
                                  x-text="$plural(cards.length, '1 Artikel', ':count Artikel')"></span>
                        </div>

                        {{-- Aktive Filter sichtbar und entfernbar. Der Chip zeigt den
                             Suchtext selbst — „was habe ich eigentlich gesucht?" ist die
                             Frage, die ein Filter ohne Anzeige offen lässt (Nielsen #6:
                             erkennen statt erinnern). --}}
                        <div x-show="hasFilter()" x-cloak class="flex flex-wrap items-center gap-1.5">
                            <template x-if="query.trim()">
                                <button type="button" x-on:click="query = ''"
                                        class="chip-in pressable inline-flex items-center gap-1 rounded-pill bg-zinc-100 py-1 pe-1.5 ps-2.5 text-xs font-medium text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700">
                                    <span>„<span x-text="query.trim()"></span>"</span>
                                    <flux:icon.x-mark variant="micro" class="size-3.5" />
                                </button>
                            </template>
                            <button type="button" x-on:click="clearFilters()"
                                    class="pressable ms-0.5 rounded-pill px-2 py-1 text-xs font-semibold text-accent hover:underline">
                                {{ __('Filter leeren') }}
                            </button>
                        </div>
                    </div>

                    {{-- Ergebnis-Ansage für Hilfstechnik (WCAG 4.1.3, Statusmeldungen).

                         Ohne sie ändert sich beim Tippen die halbe Seite, und wer nicht
                         hinsieht, erfährt nichts davon — der Fokus bleibt im Suchfeld,
                         also gibt es kein Ereignis, das eine Sprachausgabe von sich aus
                         meldet. Die Trefferzahl daneben ist keine Live-Region und wäre als
                         eine auch nutzlos: sie steht bei 0 Treffern gar nicht da.

                         PERMANENT im DOM und server-seitig LEER, aus demselben Grund wie
                         die Lade-Ansage oben: `aria-live` meldet Änderungen INNERHALB einer
                         bestehenden Region — ein Text, der schon beim Seitenaufbau
                         dasteht, wird nie angesagt.

                         Ohne Suchtext bleibt sie leer: das bloße Umsortieren ändert die
                         Menge nicht und ist keine Meldung wert. --}}
                    <span class="sr-only" aria-live="polite"
                          x-text="query.trim() === '' ? '' : (cards.length === 0 ? @js(__('Kein Artikel passt zu dieser Suche.')) : $plural(cards.length, '1 Artikel', ':count Artikel'))"></span>

                    {{-- Suche ohne Treffer. Ein EIGENER Zustand, nicht derselbe wie „Noch
                         keine Artikel." — der eine ist eine Aussage über den Relay, der
                         andere über die Suche. Sie zu vermischen hieße, dem Leser zu
                         sagen, es gebe nichts, während 104 Artikel danebenliegen. Deshalb
                         nennt der Text auch, WORÜBER gesucht wurde und WIE VIEL. --}}
                    <div x-show="!isEmpty() && cards.length === 0" x-cloak
                         class="surface-card empty-state px-4 py-10 text-center">
                        <flux:icon.magnifying-glass class="mx-auto size-8 text-zinc-400" />
                        <flux:heading class="mt-2">{{ __('Kein Artikel passt zu dieser Suche.') }}</flux:heading>
                        <flux:text class="mt-1 text-sm text-muted">
                            <span x-text="$plural(items.length, 'Durchsucht wurde 1 Artikel — Titel, Kurzfassung, Text und Autor.', 'Durchsucht wurden :count Artikel — Titel, Kurzfassung, Text und Autor.')"></span>
                        </flux:text>
                        <div class="mt-4">
                            <flux:button size="sm" variant="ghost" icon="x-mark" x-on:click="clearFilters()">{{ __('Filter leeren') }}</flux:button>
                        </div>
                    </div>

                    {{-- ── Die Liste ────────────────────────────────────────────────────

                         Zwei Spalten ab `sm` — mehr wäre auf dem Telefon eine
                         Briefmarkengalerie.

                         ── Drei ab `xl`, vier ab `2xl` (P5) ────────────────────────
                         Möglich geworden durch `width="wide"` an der `app-shell`: der
                         Lesedeckel von 62 rem ließ ab `xl` nur zwei Spalten zu, ohne dass
                         die Karten breiter wurden — rechts stand Bühne leer.

                         **Gemessen am gerenderten Raster (2026-08-21, mit Desktop-Rail):**
                         bei 1440 px drei Spuren zu je 21,5 rem (344 px), bei 1700 px vier
                         zu je 19,5 rem (312 px). Die Karte wird also mit der vierten
                         Spalte um 2 rem SCHMALER, nicht breiter — das ist der Preis, und
                         er ist bei 19,5 rem noch bezahlbar: der Titel steht auf
                         `line-clamp-2`, und die Karten einer Zeile bleiben über `h-full`
                         gleich hoch, egal wie oft er umbricht.

                         UNTERHALB von `xl` ändert sich nichts — `grid-cols-1` und
                         `sm:grid-cols-2` stehen unverändert da. Das ist die Zusage der
                         Phase: Desktop wird eigenständig optimiert, das Telefon bleibt,
                         wie es abgenommen wurde.

                         `items-start` fehlt bewusst: die Karten sollen in einer Rasterzeile
                         GLEICH hoch sein. Getragen wird das von `h-full` an der Karte und
                         `mt-auto` an der Meta-Zeile — nicht von einer festen Höhe. --}}
                    <div x-show="!isEmpty() && cards.length > 0" x-cloak data-artikel-raster
                         class="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                        <template x-for="card in cards" :key="card.id">
                            {{-- `<article>`, nicht `<a>`: eine Podcast-Karte trägt ZWEI
                                 Handlungen (Text lesen, Folge hören), und ein Player
                                 INNERHALB eines Links wäre verschachtelte Interaktion —
                                 unbedienbar mit Tastatur und ungültig. Der Link umschließt
                                 stattdessen Cover und Text; der Player steht darunter und
                                 außerhalb. Für die 90 Textkarten ist damit weiterhin
                                 praktisch die ganze Karte ein Link. --}}
                            {{-- `sm:col-span-2` bleibt bei ZWEI Spalten, auch in den
                                 breiteren Rastern (P5 nachgerechnet): bei `xl` sind das
                                 zwei von drei, bei `2xl` zwei von vier — die
                                 hervorgehobene Karte behält ihre Nebenkarten, statt die
                                 Zeile allein zu füllen. Ein `xl:col-span-3` hätte auf
                                 96 rem einen 64-rem-Banner ergeben, unter dem der Rest
                                 der Liste wie eine Fußnote aussieht. --}}
                            <article class="surface-card flex h-full flex-col overflow-hidden"
                                     :class="card.featured ? 'sm:col-span-2' : ''">

                                <a :href="href(card) || null" wire:navigate
                                   class="pressable flex min-w-0 flex-1 flex-col transition-colors hover:bg-brand-500/5"
                                   {{-- Hervorgehobene Karte ab `sm`: Bild links, Text
                                        rechts. `min-h-60` (240 px, aus der 8er-Skala) ist
                                        der Boden für den Fall, dass der Text kurz ist —
                                        ohne ihn schrumpfte die Bahn auf Byline-Höhe. --}}
                                   :class="card.featured ? 'sm:min-h-60 sm:flex-row' : ''">

                                    {{-- ── Cover ────────────────────────────────────────
                                         Der Verlauf liegt IMMER darunter, auch unter einem
                                         echten Titelbild: scheitert das Bild im Browser
                                         (fremder Host, 404, abgelehnter Proxy), steht dort
                                         nie ein weißes Loch. Er kostet nichts — er ist
                                         deterministisch aus `pubkey:d` gerechnet (P1). --}}
                                    <div class="relative w-full shrink-0 overflow-hidden"
                                         :class="card.featured ? 'aspect-[16/9] sm:aspect-auto sm:w-5/12' : 'aspect-[16/9]'"
                                         :style="'background-image: ' + card.coverCss">

                                        {{-- `$img(…, 'msg')` ist der bestehende Bild-Proxy
                                             (600 px, WebP).

                                             Hier stand „Rohe Fremd-URLs gehen nie direkt
                                             ins `src`" — das war **falsch**, solange
                                             `proxifyImage` nur `http(s)` erwischte: ein
                                             `image`-Tag `//evil.example/p.png` lief roh
                                             durch und holte für jeden Leser dieser LISTE
                                             ein Bild vom fremden Host, ohne einen Klick.
                                             Die Zusage stimmt erst, seit die Erlaubnis auf
                                             der Ausnahme steht (`core.ts`, `INLINE_SRC`):
                                             alles außer `data:`/`blob:` geht durch den
                                             Proxy. Eine falsche Sicherheitszusage im
                                             Kommentar trägt die nächste Entscheidung —
                                             deshalb steht der Grund hier und nicht nur die
                                             Behauptung.

                                             `loading="lazy"`: bis zu 200 Karten. --}}
                                        <template x-if="card.image">
                                            <img :src="$img(card.image, 'msg')" alt="" loading="lazy"
                                                 class="size-full object-cover" />
                                        </template>

                                        {{-- SIGNATUR: ohne Titelbild wird der Titel selbst
                                             zum Bild. Derselbe einzige `<h2>` wie unten im
                                             Textblock, nur an einem anderen Platz —
                                             deshalb `x-if` und nicht `x-show`: es darf
                                             immer nur EINE Überschrift je Karte im DOM
                                             stehen. Weiß auf der Palette aus P1
                                             (schlechtestes Paar 8,34:1). --}}
                                        {{-- `w-full break-words` am inneren Span ist kein
                                             Zierrat: er ist Flex-Kind eines
                                             `items-end`-Containers, und `line-clamp`
                                             schaltet ihn auf `-webkit-box`. Ohne die
                                             Breite bemisst er sich am Inhalt statt am
                                             Cover — ein langes Wort lief dann über den
                                             Rand und wurde vom `overflow-hidden` glatt
                                             abgeschnitten. Am gerenderten Bildschirm
                                             gesehen: „Heute veröffentlicht" verlor auf der
                                             hervorgehobenen Karte sein letztes Zeichen
                                             (Cover dort nur 5/12 der Kartenbreite, Titel
                                             bei 24 px). `break-words` ist für eine
                                             deutschsprachige Fläche der Normalfall, nicht
                                             der Rand: Komposita sind hier lang. --}}
                                        <template x-if="! card.image">
                                            <h2 class="absolute inset-0 flex items-end p-4 text-lg font-bold leading-tight text-white"
                                                :class="card.featured ? 'sm:p-5 sm:text-2xl' : ''">
                                                {{-- Die Trefferhervorhebung ist `white/20`
                                                     und nicht `/25`: über JEDE Farbe der
                                                     Palette gerechnet (beide Endpunkte
                                                     jedes Paars, der Verlauf liegt
                                                     dazwischen) hält weiße Schrift auf
                                                     `/25` im schlechtesten Fall nur
                                                     4,42:1 und risse 1.4.3 — der Titel
                                                     ist hier 18 px fett und damit noch
                                                     KEIN „großer Text" (dafür bräuchte er
                                                     14 pt fett = 18,66 px). Auf `/20`
                                                     sind es 5,03:1. --}}
                                                <span class="line-clamp-3 w-full break-words"><template x-for="(part, index) in card.titleParts" :key="index"><span :class="part.hit ? 'rounded-sm bg-white/20' : ''" x-text="part.text"></span></template><template x-if="card.titleParts.length === 0"><span>{{ __('Ohne Titel') }}</span></template></span>
                                            </h2>
                                        </template>

                                        {{-- Podcast-Plakette. DECKENDE Fläche, und der
                                             Grund ist nachgerechnet: die Plakette kann auf
                                             einem beliebigen fremden Titelbild landen.
                                             Deckend rechnet weiße Schrift auf `zinc-950`
                                             19,80:1 — unabhängig davon, was darunter liegt.
                                             Ein `zinc-950/70` hielte zwar ebenfalls (über
                                             einem rein weißen Bild, dem schlechtesten Fall,
                                             noch 7,57:1), aber der Wert HINGE dann am
                                             fremden Bild, und ein Wert, der von unbekanntem
                                             Fremdinhalt abhängt, ist keiner, den man
                                             hinschreiben kann. (Hier stand vorher „2,8:1"
                                             für den transparenten Fall — das war in
                                             LINEARER Helligkeit gerechnet statt in sRGB,
                                             wie der Browser komponiert, und damit falsch.
                                             Die Entscheidung bleibt, ihre Begründung ist
                                             korrigiert.)

                                             Kopfhörer-Symbol UND Wort — Farbe/Form allein
                                             wäre der alleinige Informationsträger
                                             (WCAG 1.4.1). --}}
                                        <template x-if="card.podcast">
                                            <span class="absolute start-3 top-3 inline-flex items-center gap-1 rounded-pill bg-zinc-950 px-2 py-1 text-xs font-semibold text-white">
                                                <flux:icon.microphone variant="micro" class="size-3.5" />
                                                {{ __('Podcast') }}
                                            </span>
                                        </template>
                                    </div>

                                    {{-- ── Textblock ────────────────────────────────── --}}
                                    <div class="flex min-w-0 flex-1 flex-col gap-2 p-4">

                                        {{-- Byline ÜBER dem Titel: bei zwölf Autoren, von
                                             denen vier 93 der 104 Artikel schreiben, ist
                                             „von wem" ein echtes Auswahlkriterium und kein
                                             Nachsatz. --}}
                                        <div class="flex min-w-0 items-center gap-2">
                                            <x-group::nostr-avatar picture="card.authorPicture" name="card.authorName" size="1.25rem" />
                                            <span class="min-w-0 truncate text-xs font-semibold text-muted"><template x-for="(part, index) in card.authorParts" :key="index"><span :class="part.hit ? 'rounded-sm bg-brand-500/25 text-brand-800 dark:text-brand-300' : ''" x-text="part.text"></span></template></span>
                                        </div>

                                        {{-- Der Titel — hier nur, wenn ein Titelbild das
                                             Cover belegt (siehe Signatur oben). --}}
                                        <template x-if="card.image">
                                            {{-- Das `line-clamp` steht VOLLSTÄNDIG in der
                                                 Bindung, nicht halb in der statischen
                                                 Klasse: zwei gleichrangige
                                                 `line-clamp-*`-Utilities am selben
                                                 Element entscheidet die Reihenfolge im
                                                 GEBAUTEN Stylesheet, nicht die Absicht —
                                                 im Haus schon einmal passiert
                                                 (`line-clamp-2` verlor gegen `block`).
                                                 So ist immer genau eine da.

                                                 Kein Zeilenumbruch zwischen `<h2>` und
                                                 dem `<template>`: sonst steht ein
                                                 Leerraum-Textknoten als erstes Kind der
                                                 Überschrift. --}}
                                            <h2 class="break-words font-semibold leading-snug text-zinc-900 dark:text-zinc-100"
                                                :class="card.featured ? 'line-clamp-3 text-xl font-bold leading-tight' : 'line-clamp-2 text-base'"><template x-for="(part, index) in card.titleParts" :key="index"><span :class="part.hit ? 'rounded-sm bg-brand-500/25 text-brand-800 dark:text-brand-300' : ''" x-text="part.text"></span></template><template x-if="card.titleParts.length === 0"><span>{{ __('Ohne Titel') }}</span></template>
                                            </h2>
                                        </template>

                                        {{-- Vorschau: `summary`-Tag, sonst Fließtext aus dem
                                             Artikel (12 von 104 haben kein `summary`). Der
                                             Teaser ist Fremdtext und wird NIE als HTML
                                             gebunden — jedes Stück geht durch `x-text`. --}}
                                        <p x-show="card.teaserParts.length > 0"
                                           class="line-clamp-3 break-words text-sm leading-normal text-muted"><template x-for="(part, index) in card.teaserParts" :key="index"><span :class="part.hit ? 'rounded-sm bg-brand-500/25 text-brand-800 dark:text-brand-300' : ''" x-text="part.text"></span></template></p>

                                        {{-- Meta-Zeile. `mt-auto` drückt sie in allen
                                             Karten einer Rasterzeile auf dieselbe Höhe.

                                             Die Lesezeit erscheint NUR, wenn es eine gibt
                                             (`> 0`): `0` heißt „keine Angabe", und „0 Min."
                                             wäre keine Angabe, sondern ein Fehler. Eine
                                             DAUER steht hier bewusst nirgends — keine der
                                             14 Episoden trägt eine. --}}
                                        <div class="mt-auto flex flex-wrap items-center gap-x-1.5 gap-y-1 pt-1 text-xs text-muted">
                                            {{-- `<time>` statt `<span>`: die Beschriftung
                                                 ist für die jüngsten 30 Tage RELATIV
                                                 („vor 3 Wochen"), und die ist für eine
                                                 Maschine keine Datumsangabe. Das
                                                 `datetime`-Attribut trägt den Zeitpunkt
                                                 weiter, ohne ihn auf den Bildschirm zu
                                                 schreiben. --}}
                                            <time :datetime="card.dateIso" x-text="card.dateLabel"></time>
                                            <template x-if="card.readingMinutes > 0">
                                                <span class="inline-flex items-center gap-1.5">
                                                    <span aria-hidden="true">·</span>
                                                    <span class="tabular-nums" x-text="$plural(card.readingMinutes, '1 Min. Lesezeit', ':count Min. Lesezeit')"></span>
                                                </span>
                                            </template>
                                            {{-- Sozialsignale (P6). Ohne Trennpunkt davor: die Komponente
                                                 rendert bei einem Artikel ohne jedes Signal GAR NICHTS, und
                                                 ein Punkt, der auf nichts zeigt, stünde dann allein am
                                                 Zeilenende. Der Abstand kommt aus dem `gap-x` der Zeile. --}}
                                            <x-group::article-metrics metrics="card.metriken" />
                                        </div>
                                    </div>
                                </a>

                                {{-- ── Player: AUSSERHALB des Links, und erst auf Klick ──

                                     ── Warum im Ruhezustand ein KNOPF steht und kein Player

                                     Zwei Gründe. Der erste ist am Bildschirm GEMESSEN, der
                                     zweite folgt STRUKTURELL — der Unterschied gehört
                                     hingeschrieben, weil er zählt.

                                     (1) KEINE DAUER, also auch keine Zeitanzeige. Null von
                                     14 Episoden des Bestands tragen eine Länge — NIP-94
                                     kennt das Feld gar nicht. Ein nativer `<audio controls>`
                                     schreibt in diesem Zustand „0:00 / 0:00" in seine
                                     Leiste (am gerenderten Bildschirm nachgesehen, hell wie
                                     dunkel). Das ist genau die Null, die diese Fläche nicht
                                     behaupten soll: sie sieht aus wie eine Angabe und ist
                                     keine.

                                     **Die Zusage gilt für den Ruhezustand, und nur dafür.**
                                     Nach dem Klick holt der Browser die Länge aus der Datei
                                     — sofern er sie erreicht. Bis dahin steht in der
                                     Leiste „0:00 / 0:00", bei einem unerreichbaren Host
                                     dauerhaft, und die vier Podcast-Bridges sind fremde
                                     Hosts. Das ist hingenommen: ein Ladezustand, den der
                                     Leser selbst ausgelöst hat, ist etwas anderes als eine
                                     Behauptung der Liste über einen Artikel, den er noch
                                     nicht angefasst hat. Was hier gelöst ist, ist das
                                     Zweite; das Erste ist der Preis des nativen Players und
                                     wäre nur mit einem nachgebauten zu vermeiden.

                                     (2) KEIN FREMD-REQUEST OHNE ZUTUN. Solange der Knopf
                                     steht, existiert gar kein `<audio>` im DOM — das ist
                                     im E2E mit `toHaveCount(0)` festgehalten. Dass ein
                                     Element, das es nicht gibt, auch nichts lädt, ist
                                     danach Struktur und keine Messung; ein Netz-Mitschnitt
                                     wurde dafür NICHT gefahren. `preload="none"` hätte
                                     dasselbe versprochen — aber als Zusage an eine
                                     Browser-Heuristik statt als Abwesenheit des Elements.
                                     Dieselbe Linie zieht der Bild-Proxy eine Ebene höher.

                                     Danach das NATIVE Bedienelement statt eines eigenen: es
                                     bringt Tastaturbedienung, Sprachausgabe-Namen,
                                     Lautstärke und die Systemintegration mit. Ein
                                     nachgebauter Player hätte davon nichts.

                                     `aria-label` an BEIDEN: zwei Episoden auf demselben
                                     Bildschirm hießen sonst beide „Folge anhören". Der
                                     sichtbare Text steht am Anfang des Namens — sonst
                                     bräche WCAG 2.5.3 (Label in Name). --}}
                                <template x-if="card.podcast">
                                    <div class="border-t border-zinc-200 px-4 py-3 dark:border-zinc-800" x-data="{ spielt: false }">
                                        <button type="button" x-show="!spielt" x-on:click="spielt = true"
                                                :aria-label="@js(__('Folge anhören')) + ': ' + (card.title || @js(__('Ohne Titel')))"
                                                class="pressable inline-flex min-h-[2.75rem] w-full items-center justify-center gap-2 rounded-pill bg-zinc-100 px-3 text-sm font-semibold text-zinc-800 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700">
                                            <flux:icon.play variant="micro" class="size-4" />
                                            {{ __('Folge anhören') }}
                                        </button>
                                        <template x-if="spielt">
                                            <audio controls autoplay preload="metadata" class="w-full"
                                                   :src="card.podcast.url"
                                                   :aria-label="@js(__('Folge anhören')) + ': ' + (card.title || @js(__('Ohne Titel')))"></audio>
                                        </template>
                                    </div>
                                </template>
                            </article>
                        </template>
                    </div>
                </div>
            </div>
        @endif
    </div>

</x-group::app-shell>
