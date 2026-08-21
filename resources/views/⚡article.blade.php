<?php

use Livewire\Attributes\Layout;
use Livewire\Component;

/**
 * Artikel-Vollansicht (`/articles/{naddr}`, P7) als Livewire-Full-Page-SFC.
 *
 * `$naddr` kommt aus dem Routen-Parameter und wird via `@js($naddr)` an die Insel
 * gereicht — die einzige Server→Insel-Übergabe; Laden, Auflösen und Rendern laufen
 * client-seitig (`nostrArticle`).
 *
 * **Kein server-seitiger Titel aus dem Artikel.** Der Server kennt den Artikel nicht: er
 * liegt auf dem Board-Relay, und diese Seite hat bewusst keinen Read-Cache wie die
 * Raum-Ansicht (§10/M7). Der Seitentitel bleibt deshalb generisch; der echte Titel steht
 * als `<h1>` im Dokument, sobald der Artikel da ist.
 */
new #[Layout('group::einundzwanzig')] class extends Component
{
    public string $naddr = '';

    public function mount(string $naddr): void
    {
        $this->naddr = $naddr;
    }

    public function render()
    {
        return $this->view()->title(__('Artikel'));
    }
}; ?>

{{--
    ── Der Entwurf dieser Fläche (P3), damit die nächste Änderung ihn nicht rät ────────

    AUFGABE. Ein Leser kommt hierher mit genau EINER Frage: „Was steht da?" Erst wenn er
    fertig ist, kommen zwei weitere dazu: „Wer hat das geschrieben?" und „Wie gebe ich es
    weiter?". Die Reihenfolge ist nicht Geschmack, sie ist die Reihenfolge, in der die
    Fragen entstehen — und sie bestimmt die ganze Fläche.

    HIERARCHIE (zuerst entschieden, vor Farbe und Typografie).
      1. Der ARTIKELTEXT ist das Primäre. Alles andere weicht ihm aus. Die 72ch-Deckelung
         von `.article-content` bleibt unangetastet; kein Element darf sie aufweichen.
      2. Die HERKUNFT steht zweimal, und das ist keine Dopplung, sondern zwei Fragen:
         oben als knappe Byline („von wem, wann, wie lang" — man entscheidet, ob man
         liest), unten als Autorenkarte („wer ist das, wie erreiche ich ihn" — man
         entscheidet, ob man folgt). Sie tragen verschiedene Felder.
      3. Die HANDGRIFFE (Teilen, Bild vergrößern, Lesestand) sind tertiär. Sie müssen
         erreichbar sein und dürfen nie um Aufmerksamkeit mit dem Text konkurrieren.

    LAYOUT. **Eine DOM-Reihenfolge, zwei Anordnungen — kein Duplikat.** Unterhalb `xl`
    läuft alles untereinander: Artikel, dann Autorenkarte. Ab `xl` legt ein Raster
    (`minmax(0,1fr) 18rem`) dieselben zwei Knoten nebeneinander, und die Karte wird
    `sticky top-6`. Es gibt sie also genau einmal im Dokument — eine zweite Fassung für
    Mobil hätte jeden Fokus-Stopp verdoppelt, und ein per `hidden` versteckter Zwilling
    bleibt für die Tastatur erreichbar.

    Drei Fallen an dieser Stelle, alle drei bewusst umgangen:
      · `xl:items-start` ist PFLICHT — Raster-Kinder strecken sich sonst auf Zeilenhöhe,
        und `position: sticky` hat dann nichts, woran es kleben könnte.
      · Die Karte darf KEINE eigene Höhe bekommen (`h-full` o. ä.): eine definite
        Cross-Size schlägt `align-self: start`, und das Kleben fiele wieder aus.
      · Das Raster steht AUSSERHALB der `<article class="… overflow-hidden">`. Ein
        `overflow: hidden` zwischen Sticky-Element und Scroll-Behälter macht `sticky`
        wirkungslos — und das `overflow-hidden` der Artikelkarte muss bleiben, es
        beschneidet das Titelbild auf die Kartenrundung.

    Die Deckelung der Bühne (`app-shell`, `xl:max-w-[62rem]`) fällt dafür NICHT: 36rem
    Textspalte + 18rem Karte + 2rem Spalt = 56rem. Das `width`-Prop ist P5.

    Abstände ausschließlich aus der 4/8-Skala: `gap-2`, `gap-3`, `mt-4`, `mt-6`, `p-5`,
    `xl:gap-8`, `xl:top-6`. Kein freier Pixelwert.

    TYPOGRAFIE. Eine Familie (Inconsolata, `--font-sans` im Theme), vier Rollen:
      · Titel      20 px / 600  — die `h1` im Kopf, einmal im Dokument
      · Fließtext  16 px / 1.7  — `.article-content`, unverändert aus P7
      · Auszeichnung 14 px / 400–500 — Byline, Autorenname, Website
      · Kleinschrift 12 px / 500 — Lesestand, Themen, Grundangaben
    KEIN `font-mono`: `--font-mono` ist im Theme nicht definiert (`theme.css` setzt nur
    `--font-sans`), jedes `font-mono` zöge still eine zweite Schriftfamilie herein.
    Zahlen bekommen `tabular-nums` — sonst wackelt der Lesestand bei jedem Zählerschritt.

    FARBE. Fünf Rollen, alle aus dem Haus-Token-Satz — kein neuer Hex-Wert:
      · Fläche       `surface-card`  = #ffffff / #171717 (zinc-900)
      · Primärtext   zinc-800 #262626 / zinc-200 #e5e5e5 — der Artikeltext, aus
                     `.article-content`; nichts sonst bekommt diesen Kontrast
      · Sekundärtext `text-muted`    = zinc-600 #525252 / zinc-400 #a3a3a3
                     (7,81:1 auf Weiß, 7,11:1 auf zinc-900 — beide bis AAA)
      · Akzent       brand-500 #f7931a — **an genau zwei Stellen**: die Leseleiste und
                     der Blitz des Lightning-Einstiegs. Ein dritter Akzent nähme beiden
                     ihre Bedeutung.
      · Kante        zinc-200 / zinc-800 für die Trennlinien der Karte
    Der INERTE Zustand bekommt bewusst KEINE eigene Farbe: er behält `text-muted` (also
    vollen Lesekontrast) und wird über eine gestrichelte Kante und den Cursor kenntlich.
    „Still grau" ist genau das, was er nicht sein soll.

    SIGNATUR — „Die Leseleiste zählt herunter, nicht hoch."
    Der Lesefortschritt hat hier zwei Kanäle, und der zweite ist der eigentliche Einfall.
    Sichtbar bleibt eine 2-px-Haarlinie an der Fensterkante — konventionell, still, ohne
    Beschriftung. Die ZAHL daneben steht aber nicht in Prozent, sondern in Minuten, und
    sie zählt herunter: die Lesezeit-Angabe der Byline („7 Min Lesezeit") wird beim
    Scrollen zu „noch 4 Min". Das ist dieselbe Angabe, die die Karte in der Liste zeigt —
    sie wird hier nur lebendig, statt ein zweites Element zu bekommen. Der Grund ist die
    Frage dahinter: „38 %" muss man erst in „schaffe ich das noch?" umrechnen; die
    Minuten sind die Antwort. Und der Bestand macht sie wertvoll — 57 der 104 Artikel
    haben nicht einmal eine Überschrift, dort steht sehr oft „noch 1 Min".

    **Die Leiste erscheint nur, wenn es eine Strecke gibt** (`leseVerfolgbar`). Ein
    Artikel, der ganz ins Fenster passt, bekommt keine — eine Leiste, die dauerhaft auf
    100 % steht, ist kein Fortschritt, sondern Dekor. Die Rechnung dazu liegt geprüft in
    `js/articleReader.ts` (`leseFortschritt`), inklusive der Zusage, dass dabei nie ein
    `NaN` entsteht.

    BEWEGUNG. Genau eine: die Breite der Leseleiste, 150 ms `ease-out`. Unter
    `prefers-reduced-motion` springt sie (`motion-reduce:transition-none`) — die Angabe
    bleibt vollständig, nur der Weg dorthin fällt weg. Sonst keine neue Animation.

    DER INERTE ZUSTAND, ein Muster für zwei Fälle. Ein Knopf, der nicht kann, wird hier
    weder versteckt noch ausgegraut: er bleibt lesbar, trägt `aria-disabled="true"` und
    sagt beim Antippen, WARUM — als Toast, nicht als `title`. Ein Tooltip täte das auf
    einem Telefon nicht, ein verschwundener Knopf ließe den Nutzer suchen, ein grauer
    ließe ihn zweimal tippen. Und `aria-disabled` statt `disabled`, damit der Knopf seinen
    Fokus behält: sonst käme eine Tastatur nie an die Begründung. Zwei Stellen benutzen
    es: Teilen ohne `naddr` und der Lightning-Einstieg ohne `lud16` (vier der zwölf
    Autoren — die Podcast-Bridges — haben keine).

    **„Inert" ist aber nicht dasselbe wie „unbekannt", und das war ein Fehler in diesem
    Entwurf.** Am laufenden Client gesehen: solange das kind 0 eines Autors unterwegs war,
    stand unter JEDEM Artikel „Keine Lightning-Adresse" — auch unter denen von Autoren,
    die eine haben; die Zeile sprang um, sobald das Profil eintraf. Das ist dieselbe
    Klasse Fehler wie „Diesen Artikel gibt es nicht" über einen Relay, der nie geantwortet
    hat, und sie wird hier genauso gelöst: der Lightning-Einstieg hat DREI Zustände
    (`ja` · `nein` · `unbekannt`, siehe `ArticleAuthor.lightning`), und bei `unbekannt`
    steht gar keine Zeile. Schweigen ist die einzige Anzeige, die nichts Ungedecktes
    behauptet.

    WAS HIER BEWUSST NICHT STEHT. Ein Inhaltsverzeichnis (57 der 104 Artikel haben gar
    keine Überschrift, nur 33 haben ≥3 H2 — es wäre für 71 von 104 tot), Sozialsignale
    (P6), das `width`-Prop (P5). Die Themen bleiben im Textfluss unter der Byline und
    wandern NICHT ins Aside: sie gehören zum Artikel, nicht zum Drumherum.
--}}

<x-group::app-shell>

    <div x-data="nostrArticle(@js($naddr), @js(route('group.articles')))" class="page-enter">

    {{-- Der Kopf trägt den Artikeltitel, sobald er da ist — und damit die EINE `h1` des
         Dokuments (`app-header` rendert `flux:heading level="1"`). Genau dieselbe Bauart
         wie der Raum-Kopf, der den Raumnamen trägt; ein zweiter Titel im Rumpf wäre eine
         zweite `h1` mit demselben Text und für Hilfstechnik eine Dopplung.

         `json_encode` statt `Js::from` und statt `@js()`: `app-header` echot den Ausdruck
         über `{{ }}`, escaped ihn also selbst genau einmal — dieselbe Begründung wie in
         `⚡room.blade.php` (Titel-Ausdruck des Raum-Kopfes). Vor dem Alpine-Boot steht
         der SSR-Titel `Artikel`. --}}
    @php($titleExpr = 'article ? (article.title || '.json_encode(__('Ohne Titel')).') : '.json_encode(__('Artikel')))

        <x-group::app-header :title="__('Artikel')" :title-expr="$titleExpr" :back="route('group.articles')">
            {{-- Teilen steht im Kopf und nicht im Nachspann: es ist die eine Handlung,
                 die man an JEDER Stelle des Textes treffen kann, und der Kopf ist die
                 einzige Zeile, die auf allen Breiten an derselben Stelle sitzt.
                 Erscheint erst mit dem Artikel — vorher gäbe es nichts zu teilen. --}}
            <x-slot name="actions">
                <template x-if="hasArticle()">
                    {{-- EIN Knopf, zwei Beschriftungen — welche, entscheidet `canShare`
                         einmal beim Mount. Wo `navigator.share` fehlt (jeder
                         Desktop-Firefox, jeder unsichere Kontext), heißt der Knopf
                         „Link kopieren" und tut genau das; eine Beschriftung, die etwas
                         anderes verspricht als die Handlung, wäre schlimmer als der
                         fehlende Systemdialog.

                         Ohne `naddr` bleibt er stehen, trägt `aria-disabled` und nennt
                         beim Antippen den Grund (`teilenAusloesen`). Das INERTE Muster
                         dieser Fläche, zum ersten von zwei Malen. --}}
                    <flux:button size="sm" variant="ghost" icon="link"
                                 x-bind:aria-label="canShare ? @js(__('Artikel teilen')) : @js(__('Link kopieren'))"
                                 x-bind:aria-disabled="teilZiel().teilbar ? null : 'true'"
                                 x-on:click="teilenAusloesen()" />
                </template>
            </x-slot>
        </x-group::app-header>

        @if (! config('group.board_relay_url'))
        {{-- Keine Quelle konfiguriert — und das ist etwas ANDERES als „diesen Artikel gibt
             es nicht". Ohne diese Weiche sagte die Vollansicht beides mit demselben Satz:
             ein Client ohne Artikel-Relay behauptete über jeden Link, der Relay kenne ihn
             nicht — obwohl nie einer gefragt wurde. Server-seitig wie auf der Liste, aus
             demselben Grund (das Gate steht im ausgelieferten HTML, bevor ein Script
             läuft). --}}
            <div class="surface-card empty-state px-4 py-10 text-center">
                <flux:icon.document-text class="mx-auto size-8 text-zinc-400" />
                <flux:heading class="mt-2">{{ __('Keine Artikel-Quelle eingerichtet.') }}</flux:heading>
                <flux:text class="mt-1 text-sm text-muted">{{ __('Dieser Client kennt kein Relay, auf dem Artikel liegen.') }}</flux:text>
            </div>
        @else

        {{-- ── Die Leseleiste ───────────────────────────────────────────────────────
             Zwei Kästen, und beide haben einen Grund: der äußere ist `fixed` an der
             Fensterkante und trägt `pt-safe`, damit die Linie auf einem Gerät mit
             Aussparung UNTER der Uhr sitzt statt hinter ihr (dieselbe Bauform wie
             `status-strip.blade.php`); der innere ist die Linie selbst und wächst.

             `aria-hidden`: die Leiste sagt nichts, was nicht ohnehin da wäre — die
             Scroll-Position ist für Hilfstechnik ein gelöstes Problem. Eine Live-Region,
             die bei jedem Scrollschritt „39 Prozent" ansagt, wäre feindselig.
             `pointer-events-none`, weil eine 2-px-Linie über dem Text nichts abfangen darf.

             `z-30`: über dem Inhalt, unter Modal, Lightbox und Statusband (z-50).

             **`xl:left-[20rem]` ist keine Feinabstimmung, sondern eine Korrektur.** Am
             laufenden Client gesehen (1440×900): `inset-x-0` legt die Leiste über die
             GANZE Fensterbreite, also auch über die Desktop-Rail — und dort liest sie
             sich, als lade die Navigation. Der Fortschritt gehört zum Artikel, also
             beginnt er, wo die Bühne beginnt. `20rem` ist zeichengleich die Rail-Spalte
             aus `components/app-frame.blade.php`
             (`xl:grid-cols-[20rem_minmax(0,1fr)]`); dass beide Zahlen dieselbe bleiben,
             hält `js/articleReaderMarkup.test.ts` fest — sonst driftet die Kopie hier
             beim nächsten Rail-Umbau still auseinander. --}}
        <div x-show="leseVerfolgbar" x-cloak aria-hidden="true" data-leseleiste
             class="pointer-events-none fixed inset-x-0 top-0 z-30 pt-safe xl:left-[20rem]">
            {{-- Der ANKER sitzt am Rahmen, die FÜLLUNG trägt den Wert — und das ist keine
                 Kosmetik, sondern eine Lehre aus dem eigenen Test: die Füllung ist bei
                 0 % null Pixel breit, und ein Element ohne Fläche gilt jeder
                 Sichtbarkeitsprüfung als unsichtbar. Ein Test, der „ist die Leiste da?"
                 an der Füllung fragt, bekommt am Anfang jedes Artikels „nein" — für die
                 falsche Ursache. Zwei Fragen, zwei Anker. --}}
            <div class="h-0.5 bg-brand-500 transition-[width] duration-150 ease-out motion-reduce:transition-none"
                 x-bind:style="`width: ${lesefortschritt}%`" data-leseleiste-fuellung></div>
        </div>

        {{-- Lade-Ansage: permanent im DOM, server-seitig leer — siehe die ausführliche
             Begründung in `⚡updates.blade.php`. --}}
        <span class="sr-only" aria-live="polite"
              x-text="loading ? @js(__('Artikel wird geladen…')) : ''"></span>

        {{-- Der Relay hat nicht geantwortet. Bewusst NICHT derselbe Zustand wie „gibt es
             nicht": dort steht eine Aussage über den Relay, und die ist nur gedeckt, wenn
             er wirklich geantwortet hat (`LoadOutcome.complete`, `longformFeed.ts`). Hier
             steht stattdessen der einzige ehrliche Satz — plus der Weg, es noch einmal zu
             versuchen. --}}
        <template x-if="error && !hasArticle()">
            <flux:callout variant="danger" icon="exclamation-triangle" class="mb-3">
                <flux:callout.text>{{ __('Der Artikel ist gerade nicht erreichbar.') }}</flux:callout.text>
                <x-slot name="actions">
                    <flux:button size="sm" variant="ghost" icon="arrow-path" x-on:click="retry()">{{ __('Erneut laden') }}</flux:button>
                </x-slot>
            </flux:callout>
        </template>

        {{-- Laden: server-gerendertes Skeleton (kein x-if — das existiert vor dem
             Alpine-Boot nicht im DOM). Die Balken haben die Maße des echten Kopfes,
             damit der Wechsel nicht springt. --}}
        <div x-show="loading && !hasArticle()" :aria-busy="loading" class="surface-card overflow-hidden">
            <div class="skeleton aspect-[21/9] w-full"></div>
            <div class="space-y-3 p-5">
                <div class="skeleton h-6 w-2/3"></div>
                <div class="skeleton h-3 w-1/3"></div>
                <div class="skeleton h-3 w-full"></div>
                <div class="skeleton h-3 w-full"></div>
                <div class="skeleton h-3 w-4/5"></div>
            </div>
        </div>

        {{-- „Gibt es nicht" ist ein eigener Zustand, kein Fehler: der `naddr` kann
             unlesbar sein (kaputter Link), auf ein anderes Kind zeigen oder auf einen
             Artikel, den dieser Relay nicht (mehr) hat. Alle drei enden hier, und alle
             drei haben denselben Ausweg.

             Die Unterzeile hieß „Der Link zeigt auf keinen Artikel, den dieses Relay
             kennt." — und das ist eine Aussage ÜBER den Relay. Für einen unlesbaren
             `naddr` wurde nie einer gefragt (`loadArticle` gibt dort `NOT_ASKED`
             zurück), die Aussage war also in einem der drei Fälle nicht gedeckt. Der
             neue Satz redet über den LINK und hält damit in allen dreien. Was der Relay
             gesagt oder nicht gesagt hat, entscheidet eine Ebene darüber: er kommt hier
             nur an, wenn `complete` war (sonst steht das Fehler-Callout oben). --}}
        <template x-if="missing && !hasArticle()">
            <div class="surface-card empty-state px-4 py-10 text-center">
                <flux:icon.document-text class="mx-auto size-8 text-zinc-400" />
                <flux:heading class="mt-2">{{ __('Diesen Artikel gibt es nicht.') }}</flux:heading>
                <flux:text class="mt-1 text-sm text-muted">{{ __('Dieser Link führt zu keinem Artikel.') }}</flux:text>
                <div class="mt-4">
                    <flux:button size="sm" variant="ghost" icon="arrow-left" :href="route('group.articles')" wire:navigate>{{ __('Alle Artikel') }}</flux:button>
                </div>
            </div>
        </template>

        <template x-if="hasArticle()">
            {{-- Das Raster steht bewusst HIER und nicht in der Artikelkarte — siehe die
                 drei Sticky-Fallen im Entwurf oben. `xl:items-start` ist keine
                 Feinabstimmung, ohne es klebt nichts. --}}
            <div class="xl:grid xl:grid-cols-[minmax(0,1fr)_18rem] xl:items-start xl:gap-8">

            <article class="surface-card overflow-hidden">

                {{-- Titelbild. `banner`-Preset (1200×400) — dieselbe Rolle wie das
                     Space-Banner auf der Übersicht, deshalb dasselbe Preset. --}}
                <template x-if="article.image">
                    <div class="aspect-[21/9] w-full overflow-hidden bg-zinc-200/60 dark:bg-zinc-800/60">
                        <img :src="$img(article.image, 'banner')" alt="" class="size-full object-cover" />
                    </div>
                </template>

                <div class="p-5">
                    {{-- Kein Titel hier: er steht im Kopf und ist dort die `h1` (siehe
                         oben). Die Zeile darunter ist die Herkunft — wer, wann, wie lang.

                         Der Name ist ein `<button>` und kein `<span>`: er öffnet die
                         Profilkarte, die im Haus an sechs Stellen über `open-profile`
                         aufgeht. Ein echtes `<button>` statt `role="button"`, damit Enter
                         und Leertaste nativ auslösen — dieselbe Begründung wie bei der
                         `.mention` im Chat. --}}
                    <div class="flex items-center gap-2">
                        <x-group::nostr-avatar picture="article.authorPicture" name="article.authorName" size="2rem" />
                        <button type="button" class="pressable min-w-0 flex-1 truncate text-start text-sm text-muted hover:text-zinc-800 dark:hover:text-zinc-200"
                                x-on:click="$dispatch('open-profile', article.pubkey)"
                                x-text="article.authorName"
                                x-bind:aria-label="@js(__('Profil öffnen: :name')).split(':name').join(article.authorName)"></button>
                        <span class="shrink-0 text-sm text-muted" x-text="article.dateLabel"></span>
                    </div>

                    {{-- ── Der Lesestand, die Signatur dieser Fläche ────────────────────
                         EIN Element für zwei Zustände. Am Anfang die Angabe, die auch die
                         Liste zeigt („7 Min Lesezeit"); sobald gescrollt wird, dieselbe
                         Angabe als Rest („noch 4 Min"), am Ende „Ende erreicht". Kein
                         zweites Element, keine Prozentzahl — die Minuten sind die Antwort
                         auf die Frage, die hinter der Prozentzahl steckt.

                         Welche der drei Formen gilt, entscheidet `lesestandForm`
                         (`js/articleReader.ts`, unter `node --test` festgenagelt); den
                         Satz baut `lesestandText()` in der Insel. Eine dreifache
                         Ternär-Kette hier wäre dieselbe Regel ein zweites Mal, nur
                         ungeprüft.

                         `readingMinutes === 0` heißt „keine Angabe" (so wie in der Zeile)
                         — dann fällt die ganze Zeile weg statt „0 Min" zu behaupten.
                         `tabular-nums`, damit die Zahl beim Herunterzählen nicht wackelt;
                         **kein `font-mono`**, `--font-mono` ist im Theme nicht definiert.
                         `aria-live="polite"` steht hier bewusst NICHT: die Zahl ändert
                         sich beim Scrollen fortlaufend, und eine Ansage je Schritt wäre
                         Lärm. Der Wert ist als Text vorhanden und jederzeit lesbar. --}}
                    <template x-if="article.readingMinutes > 0">
                        <p class="mt-2 text-xs tabular-nums text-muted" data-lesestand x-text="lesestandText()"></p>
                    </template>

                    {{-- Themen (`t`-Tags): 22 der 104 Artikel tragen welche. Reine Anzeige,
                         kein Filter — es gibt keine Themenliste, auf die ein Klick führen
                         könnte, und ein Link ins Leere ist schlechter als keiner.
                         Sie bleiben im Textfluss und wandern NICHT ins Aside: sie gehören
                         zum Artikel, nicht zum Drumherum. --}}
                    <template x-if="article.topics.length > 0">
                        <div class="mt-3 flex flex-wrap gap-1.5">
                            <template x-for="topic in article.topics.slice(0, 8)" :key="topic">
                                <span class="rounded-pill bg-black/5 px-2 py-0.5 text-[0.7rem] text-muted dark:bg-white/10" x-text="'#' + topic"></span>
                            </template>
                        </div>
                    </template>

                    {{-- Der Artikel selbst.

                         `x-html` ist hier bewusst gesetzt und die einzige Stelle, an der
                         diese Fläche HTML bindet. Der Wert kommt AUSSCHLIESSLICH aus
                         `renderArticleHtml` (`js/longform.ts`), also aus markdown-it mit
                         `html: false` — roher HTML-Text des Autors ist dort bereits zu
                         Entities geworden, und `javascript:`/`vbscript:`/`data:`-Links
                         sind gar nicht erst zu Ankern geworden. Wer hier eine andere
                         Quelle anbindet, hebelt genau diese Zusage aus.

                         **Seit P3 schreibt der Renderer eigene Attribute** (`class`,
                         `data-full` am Bild). Alpines `x-html` ruft `initTree()` auf dem
                         eingefügten Teilbaum — ein Attribut, das mit `x-`, `@` oder `:`
                         beginnt, wäre dort ein sofort ausgeführter Ausdruck. Dass die
                         Ausgabe über den ganzen Formen-Satz keines trägt, ist der
                         Kernbeweis in `js/articleRenderSicherheit.test.ts`, und er ist
                         mutationsgeprüft.

                         `data-artikel-text` ist der Anker der Fortschritt-Messung
                         (`bridge.ts`, `messeLesefortschritt`) — ein eigenes Attribut und
                         NICHT die Klasse `.article-content`, damit die Messung nicht an
                         einem Stilnamen hängt. Findet die Sonde ihn nicht, meldet sie
                         „nicht verfolgbar" statt 0 %; der Riegel dagegen steht in
                         `js/articleReaderMarkup.test.ts`.

                         Der Klick-Auslöser folgt EXAKT dem Chat-Muster
                         (`partials/chat-row.blade.php`): er prüft den Selektor und liest
                         `dataset.full`. Die Klasse unterscheidet sich (`article-image`
                         statt `chat-image`), weil `.chat-image` ein `width: 100%` setzt,
                         gegen das `.article-content img` gar keine Deklaration hält —
                         jedes Inline-Bild würde sonst auf Spaltenbreite hochskaliert.
                         Begründung im Kopf von `ARTICLE_IMAGE_CLASS`. --}}
                    <div class="article-content mt-6" data-artikel-text x-html="article.html"
                         x-on:click="
                             if ($event.target.matches('img.article-image')) {
                                 $event.stopPropagation();
                                 lightboxSrc = $event.target.dataset.full || null
                             }
                         "></div>
                </div>
            </article>

            {{-- ── Der Nachspann: wer hat das geschrieben? ──────────────────────────
                 Unterhalb `xl` steht er unter dem Text — dort, wo die Frage entsteht.
                 Ab `xl` wird daraus die zweite Rasterspalte, und sie klebt (`sticky`).
                 **Es ist derselbe Knoten, nicht eine zweite Fassung**: ein per `hidden`
                 versteckter Zwilling bliebe für die Tastatur erreichbar und verdoppelte
                 jeden Fokus-Stopp. Keine eigene Höhe (kein `h-full`) — sonst fiele das
                 Kleben aus. --}}
            <aside class="mt-4 xl:sticky xl:top-6 xl:mt-0">
                <div class="surface-card p-4">
                    <flux:heading size="sm" class="mb-3">{{ __('Über den Autor') }}</flux:heading>

                    <div class="flex items-center gap-2">
                        <x-group::nostr-avatar picture="article.author.picture" name="article.author.name" size="2.5rem" />
                        <div class="min-w-0 flex-1">
                            <div class="flex min-w-0 items-center gap-1">
                                <span class="min-w-0 truncate text-sm font-medium" x-text="article.author.name"></span>
                                <x-group::nostr-nip05 nip05="article.author.nip05" />
                            </div>
                            <div x-show="article.author.nip05" x-cloak class="truncate text-xs text-muted" x-text="article.author.nip05"></div>
                        </div>
                    </div>

                    {{-- Bio, auf vier Zeilen gedeckelt. Das ist keine Kürzung des Inhalts:
                         der vollständige Text steht in der Profilkarte, die der Knopf
                         darunter öffnet. Eine ungedeckelte Bio in einer 18rem-Spalte
                         schöbe die Autorenkarte über die Höhe des Artikels hinaus. --}}
                    <p x-show="article.author.about" x-cloak
                       class="mt-3 line-clamp-4 whitespace-pre-wrap break-words text-sm text-muted"
                       x-text="article.author.about"></p>

                    {{-- Website — eigene Zeile, lange URLs truncaten statt auszulaufen.
                         Der Wert ist bereits sanitisiert (`sanitizeUrl` in
                         `longformFeed.ts`); `about:blank` kommt hier gar nicht an. --}}
                    <a x-show="article.author.website" x-cloak :href="article.author.website"
                       target="_blank" rel="noopener noreferrer"
                       class="pressable mt-3 flex min-w-0 items-center gap-2 rounded-tile border border-zinc-200 px-3 py-2 text-sm text-brand-800 hover:bg-brand-500/5 dark:border-zinc-800 dark:text-brand-400">
                        <flux:icon.globe-alt class="size-4 shrink-0" />
                        <span class="min-w-0 truncate" x-text="article.author.website"></span>
                        <flux:icon.arrow-up-right class="ml-auto size-3.5 shrink-0 opacity-50" />
                    </a>

                    {{-- ── Der Lightning-Einstieg, in zwei Zuständen ───────────────────
                         MIT Adresse: der Knopf öffnet die Profilkarte, in der die
                         Lightning-Adresse kopierbar steht. Er zahlt (noch) nicht selbst —
                         das Publizieren eines Zap-Requests ist P7 und braucht ein eigenes
                         GO. Was er heute leistet, ist der Weg zur Adresse, und die
                         Beschriftung sagt genau das.

                         OHNE Adresse: derselbe Knopf, `aria-disabled`, gestrichelte Kante
                         statt Fläche — und beim Antippen der GRUND als Toast. Vier der
                         zwölf Autoren sind hier: die Podcast-Bridges haben ein kind 0
                         (auf `purplepag.es`), aber kein `lud16`. Ein verschwundener Knopf
                         ließe den Nutzer suchen, ein grauer ohne Erklärung zweimal tippen,
                         ein Tooltip wäre auf dem Telefon unerreichbar.

                         **UNBEKANNT: gar keine Zeile.** Das kind 0 des Autors trifft
                         asynchron ein — oft deutlich nach dem Artikel, weil die zwölf
                         Autoren auf ihren eigenen Relays stehen. Solange es fehlt, ist
                         jede Aussage über eine Zahlungsadresse ungedeckt. Am laufenden
                         Client gesehen: bis das Profil da war, stand hier „Keine
                         Lightning-Adresse" — auch unter Artikeln von Autoren, die eine
                         haben. Das ist derselbe Fehler wie „gibt es nicht" über einen
                         Relay, der nie geantwortet hat, und er wird hier genauso gelöst:
                         solange nichts bekannt ist, wird nichts behauptet.

                         `article.author.lightning` kommt aus `buildArticleAuthor` und ist
                         DER Befund, nicht die Adresse — die steht bewusst nirgends in
                         dieser Datei (Zahlungsfelder haben im Haus eine eigene
                         Herkunftsregel, `js/zapTargetSources.test.ts`). --}}
                    <template x-if="article.author.lightning !== 'unbekannt'">
                        <button type="button" data-lightning-einstieg
                                x-bind:data-lightning-zustand="article.author.lightning"
                                x-bind:aria-disabled="article.author.lightning === 'ja' ? null : 'true'"
                                x-bind:class="article.author.lightning === 'ja'
                                    ? 'border-brand-500/30 bg-brand-500/5 hover:bg-brand-500/10'
                                    : 'border-dashed border-zinc-300 cursor-not-allowed dark:border-zinc-700'"
                                x-on:click="article.author.lightning === 'ja'
                                    ? $dispatch('open-profile', article.pubkey)
                                    : keineLightningAdresse()"
                                class="pressable mt-2 flex w-full min-w-0 items-center gap-2 rounded-tile border px-3 py-2 text-start">
                            {{-- `::class` und nicht `x-bind:class`: `flux:icon` ist eine
                                 Flux-KOMPONENTE, und `::attr` ist dort die Hauskonvention
                                 (`desktop-rail`, `⚡spaces`, `⚡room` schreiben es genauso). --}}
                            <flux:icon.bolt variant="solid" class="size-4 shrink-0"
                                            ::class="article.author.lightning === 'ja' ? 'text-brand-500' : 'text-muted'" />
                            <span class="min-w-0 flex-1 text-sm text-muted"
                                  x-text="article.author.lightning === 'ja'
                                      ? @js(__('Lightning-Adresse anzeigen'))
                                      : @js(__('Keine Lightning-Adresse'))"></span>
                        </button>
                    </template>

                    <flux:button size="sm" variant="ghost" icon="user" class="mt-2 w-full"
                                 x-on:click="$dispatch('open-profile', article.pubkey)">{{ __('Profil öffnen') }}</flux:button>
                </div>
            </aside>

            </div>
        </template>

        {{-- Die Lightbox — dieselbe Fläche wie im Chat, seit P3 eine Komponente. Ihr
             Vertrag ist eine einzige Zusage: der umschließende Scope führt `lightboxSrc`.
             `nostrArticle` tut das. --}}
        <x-group::lightbox-overlay />
        @endif
    </div>

</x-group::app-shell>
