<?php

use Livewire\Attributes\Layout;
use Livewire\Component;

/**
 * Autorenseite (`/articles/autor/{autor}`, P4) als Livewire-Full-Page-SFC.
 *
 * `$autor` kommt aus dem Routen-Parameter und wird via `@js($autor)` an die Insel
 * gereicht — die einzige Server→Insel-Übergabe. Deuten, Auflösen, Laden und Rendern
 * laufen client-seitig (`nostrArticleAuthor`).
 *
 * **Der Server deutet den Parameter bewusst NICHT.** Eine npub zu dekodieren hieße, einen
 * bech32-Decoder in PHP zu halten, und eine NIP-05-Adresse aufzulösen hieße, dass der
 * SERVER eine Verbindung zu einer fremden, vom Besucher gewählten Domain aufbaut — eine
 * Anfrage aus dem Rechenzentrum statt aus dem Browser, mit der IP des Servers und ohne
 * jede Ratenbegrenzung. Beides ist hier falsch. Der Parameter wird deshalb roh
 * durchgereicht und ausschließlich in der Insel geprüft.
 *
 * **Kein server-seitiger Titel aus dem Profil.** Wie bei der Vollansicht: der Server kennt
 * das kind 0 nicht. Der Seitentitel bleibt generisch, der echte Name steht als `<h1>` im
 * Dokument, sobald das Profil da ist.
 */
new #[Layout('group::einundzwanzig')] class extends Component
{
    public string $autor = '';

    public function mount(string $autor): void
    {
        $this->autor = $autor;
    }

    public function render()
    {
        return $this->view()->title(__('Autor'));
    }
}; ?>

{{--
    ── Der Entwurf dieser Fläche (P4), damit die nächste Änderung ihn nicht rät ────────

    AUFGABE. Wer hier ankommt, kommt fast immer aus einem Artikel und hat zwei Fragen, in
    dieser Reihenfolge: „Wer ist das?" und „Was hat der oder die sonst geschrieben?" Die
    zweite ist die eigentliche — die erste beantwortet ein Blick, die zweite ist der Grund
    für die Seite. Und sie ist der Grund, warum das hier eine ROUTE ist und kein Drawer:
    diese Adresse ist teilbar, die Fremdvorlage `discover.einundzwanzig.space` hat für
    dasselbe gar keine URL.

    HIERARCHIE (zuerst entschieden, vor Farbe und Typografie).
      1. Die ARTIKELLISTE ist das Primäre. Sie bekommt die Fläche.
      2. Die IDENTITÄT ist sekundär und bleibt kompakt: Name und die zwei Zahlen stehen im
         Seitenkopf (also in der Zeile, die es ohnehin gibt), alles Weitere in EINER Karte
         darunter. Keine Statistik-Kachelreihe — eine große Zahl mit kleiner Beschriftung
         ist die Vorlagen-Antwort, und bei einem Autor mit einem Artikel wäre sie komisch.
      3. Die HANDGRIFFE (Website, Lightning, Profil öffnen) sind tertiär und stehen
         zusammen am Fuß der Karte.

    LAYOUT. Eine Spalte, keine Bühne im Bühnenraum. Kopf (zurück · Avatar · Name +
    „55 Artikel · seit 2026") → Autorenkarte, sofern sie etwas trägt → Artikel, nach
    MONAT gegliedert, je Monat ein 1-/2-spaltiges Raster (`sm:grid-cols-2`, wie die
    Liste). Abstände ausschließlich aus der 4/8-Skala; nachgezählt über die Datei (ohne
    Kommentare): `gap-1`, `gap-1.5`, `gap-2`, `gap-3`, `mb-3`, `mb-4`, `mt-0.5`, `mt-1`,
    `mt-2`, `mt-3`, `mt-4`, `p-4`, `pt-1`, `px-2/3/4`, `py-1/2/3/10`, `space-y-2`,
    `space-y-8` — **kein einziger freier Pixelwert**. Das `width`-Prop der Bühne ist P5
    und wird hier nicht angefasst.

    TYPOGRAFIE. Eine Familie (Inconsolata, `--font-sans` im Theme), vier Rollen:
      · Autorname   20 px / 600 — die `h1`, aus `app-header`, einmal im Dokument
      · Kartentitel 16 px / 600 — `<h3>`, siehe unten zur Ebene
      · Auszeichnung 14 px / 400–500 — Bio, Website
      · Monatsmarke & Grundangaben 12 px / 600 — leichtes `tracking`, `tabular-nums`
    KEIN `uppercase` an der Monatsmarke: „AUGUST 2026" schriee, und ein Monatsname ist ein
    Wort, keine Marke. KEIN `font-mono`: `--font-mono` ist im Theme nicht definiert
    (`theme.css` setzt nur `--font-sans`), jedes `font-mono` zöge still eine zweite
    Schriftfamilie herein. Zahlen bekommen `tabular-nums` — die Marken stehen sonst
    unterschiedlich breit untereinander, und genau das soll man an ihnen ablesen können.

    FARBE. Fünf Rollen, alle aus dem Haus-Token-Satz — kein neuer Hex-Wert:
      · Fläche       `surface-card`  = #ffffff / #171717 (zinc-900)
      · Primärtext   zinc-900 #18181b / zinc-100 #f4f4f5 — nur die Kartentitel
      · Sekundärtext `text-muted`    = zinc-600 #525252 / zinc-400 #a3a3a3
                     (7,81:1 auf Weiß, 7,11:1 auf zinc-900 — beide bis AAA)
      · Kante        zinc-200 #e5e5e5 / zinc-800 #262626 — Haarlinie der Monatsmarke,
                     Trennlinie des Podcast-Fußes, Rahmen der Website-Zeile
      · Akzent       brand-500 #f7931a — an GENAU EINER Stelle: der Blitz des
                     Lightning-Einstiegs. Die Monatsmarke bekommt bewusst keinen — sie ist
                     Struktur, nicht Betonung, und ein zweiter Akzent nähme dem ersten
                     seine Bedeutung.
    Der INERTE Lightning-Zustand behält `text-muted` (vollen Lesekontrast) und wird über
    eine gestrichelte Kante und den Cursor kenntlich — dasselbe Muster wie in der
    Vollansicht. „Still grau" ist genau das, was er nicht sein soll.

    SIGNATUR — „Der Monat ist die Wirbelsäule, nicht ein Abzeichen."
    Die Liste ist chronologisch, also IST ihre Reihenfolge die Zeit. Deshalb bekommt sie
    als einzige Gliederung Monatsmarken: „August 2026" in der Sprache des Lesers, mit
    einer Haarlinie, die bis zum Rand läuft. Das ist kein Dekor und kein `01 / 02 / 03` —
    eine Nummerierung über einer Liste, die keine Reihenfolge hat, wäre genau das. Hier
    trägt die Marke Information, und sie zeigt beim Vielschreiber die eigentliche
    Geschichte seines Bestands: angefangen im Februar, monatelang still, im Juni losgelegt.

    **Hier stand zuerst „das JAHR ist die Wirbelsäule" — der Bestand hat das widerlegt.**
    Am 2026-08-21 nachgemessen (`nak req -k 30023 --limit 300`, 104 Artikel, 12 Autoren):
    **zehn von zwölf Autoren haben genau EINEN Jahrgang**, der Vielschreiber mit 55
    Artikeln eingeschlossen — seine Artikel liegen alle in 2026. Eine Marke über 55 Karten
    ist keine Gliederung, sondern eine Beschriftung. Nach Monat entstehen dort fünf Gruppen
    (28 · 17 · 8 · 1 · 1), und bei den vier Autoren, die 93 der 104 Artikel schreiben,
    5 · 2 · 2 · 4. Die vollständige Messtabelle steht bei `nachMonat` in
    `js/articleAuthor.ts`, zusammen mit der Bedingung, unter der Jahr wieder die richtige
    Körnung wäre.

    **Die Bedingung ist die Zahl der MARKEN auf einer Seite, nicht die Spanne eines
    Autors.** Hier stand „längste Spanne heute: elf Monate" — falsch gemessen und die
    falsche Größe dazu. Nachgemessen am 2026-08-21 sind es **20 Monate**
    (`acbcec47…`, 2024-12 bis 2026-07), und genau dieser Autor bekommt trotzdem drei
    Marken, weil er drei Artikel hat. Die Spanne belastet die Fläche also gar nicht; die
    Marken tun es. Heute stehen höchstens fünf auf einer Seite (der Vielschreiber), und
    Jahr würde erst ab rund zwei Dutzend richtig. Die Rechnung steht bei `nachMonat`.

    Beim Autor mit einem Artikel schrumpft die Wirbelsäule auf einen Wirbel und stört
    nicht — dorthin fiele jede Gliederung zurück. Das „seit 2026" im Kopf bleibt die
    gröbere Aussage und doppelt die Marke damit nicht.

    BEWEGUNG. Keine neue. `page-enter` und `chip-in` sind Bestand, `prefers-reduced-motion`
    respektieren sie bereits.

    WAS HIER BEWUSST NICHT STEHT — vier Weglassungen, jede mit ihrem Grund:
      · **Kein `sticky` an der Monatsmarke.** Sie müsste sich gegen eine Chrome-Höhe
        absetzen, die es in zwei Varianten gibt (Statusband an/aus) und die ab `xl` in
        einem anderen Scroll-Behälter steht. Das ist dieselbe Kopplung, die in P3 als
        `xl:left-[20rem]` einmal nachträglich korrigiert werden musste. Die Marke trägt
        ihre Aufgabe auch ohne — und eine Kopplung, die man nicht braucht, geht nicht
        kaputt.
      · **Kein Ersatz-Banner.** Hat der Autor keins, steht dort nichts. Ein gerechneter
        Verlauf wäre die dritte Vorlagen-Antwort in Folge, und die Verläufe der
        Artikeldeckel darunter tragen die Farbigkeit dieser Seite bereits.
      · **Keine Suche, keine Sortierung.** Ein Autor hat hier zwischen einem und 55
        Artikeln; die Monatsmarken sind die Gliederung, die diese Menge braucht. Beides
        steht auf `/articles`, wo es 104 sortiert.
      · **Keine Autoren-Byline auf den Karten.** Auf DIESER Seite wäre sie 55-mal dieselbe
        Zeile — die Antwort auf eine Frage, die der Seitenkopf schon beantwortet hat.

    ZUR KARTE, ehrlich: sie ist eine zweite, schlankere Fassung der Karte aus
    `⚡articles.blade.php` (ohne Treffer-Hervorhebung, ohne „Featured", ohne Byline). Das
    ist bewusst und trotzdem eine Kopie. **Der Moment, sie zu einer Komponente zu
    verschmelzen, ist P6** — dort bekommen BEIDE Karten dieselben neuen Zähler, und ab da
    kostet die Kopie mehr, als sie spart.

    ── Der Ausgangspunkt fehlt noch, und das ist Absicht ───────────────────────────────
    Es verlinkt heute nichts hierher: die Navigation ist P5, und diese Phase fasst weder
    `⚡article.blade.php` noch `⚡articles.blade.php` an. Die Seite ist über ihre URL
    erreichbar — das ist genau die Eigenschaft, für die sie gebaut wurde.
--}}

<x-group::app-shell>

    <div x-data="nostrArticleAuthor(@js($autor), @js(route('group.articles')))" class="page-enter">

        {{-- Der Kopf trägt den Autorennamen, sobald er da ist — und damit die EINE `h1`
             des Dokuments. Gleiche Bauart wie die Vollansicht und der Raum-Kopf.
             `json_encode` statt `@js()`: `app-header` echot den Ausdruck über ein
             doppelt geschweiftes Echo und escaped ihn damit selbst genau einmal. Vor dem Alpine-Boot steht der SSR-Titel. --}}
        @php($titleExpr = 'autor ? autor.name : '.json_encode(__('Autor')))

        <x-group::app-header :title="__('Autor')" :title-expr="$titleExpr" :back="route('group.articles')">
            {{-- Der Avatar steht im KOPF und nicht noch einmal in der Karte darunter: er
                 gehört zum Namen, und der Name steht hier. Erst sichtbar, wenn die Adresse
                 aufgelöst ist — vorher gibt es niemanden abzubilden. --}}
            <x-slot name="leading">
                <template x-if="hatAutor() && autor">
                    <span class="flex shrink-0 items-center">
                        <x-group::nostr-avatar picture="autor?.picture ?? ''" name="autor?.name ?? ''" size="2.25rem" />
                    </span>
                </template>
            </x-slot>

            {{-- ── Die zwei Zahlen, die nur diese Seite beantworten kann ──────────────
                 „12 Artikel · seit 2019" — eine Zeile, keine Kachelreihe. Beide Werte
                 stammen aus DENSELBEN Zeilen, die unten stehen (`autorGrunddaten`); eine
                 Zahl aus einer zweiten Quelle weicht früher oder später von der Liste
                 darunter ab, und dann glaubt der Leser der Zahl.

                 `seitJahr === 0` heißt „keine Angabe" und lässt den Teil weg — dieselbe
                 Regel wie bei `readingMinutes`. „seit 1970" wäre keine Angabe, sondern ein
                 Fehler.

                 `tabular-nums`, damit die Zahlen nicht wackeln, wenn beim Nachladen aus
                 „1 Artikel" ein „11 Artikel" wird. --}}
            <x-slot name="subtitle">
                <template x-if="hatAutor() && anzahl > 0">
                    <p class="mt-0.5 truncate text-xs font-medium tabular-nums text-muted" data-autor-zahlen>
                        <span x-text="$plural(anzahl, '1 Artikel', ':count Artikel')"></span><template x-if="seitJahr > 0"><span> · <span x-text="@js(__('seit :jahr')).split(':jahr').join(seitJahr)"></span></span></template>
                    </p>
                </template>
            </x-slot>
        </x-group::app-header>

        @if (! config('group.board_relay_url'))
            {{-- Keine Quelle konfiguriert — server-seitig entschieden, wortgleich zur
                 Liste und zur Vollansicht. Es ist etwas ANDERES als „diesen Autor gibt es
                 nicht": ohne Relay wurde nie jemand gefragt. --}}
            <div class="surface-card empty-state px-4 py-10 text-center">
                <flux:icon.document-text class="mx-auto size-8 text-zinc-400" />
                <flux:heading class="mt-2">{{ __('Keine Artikel-Quelle eingerichtet.') }}</flux:heading>
                <flux:text class="mt-1 text-sm text-muted">{{ __('Dieser Client kennt kein Relay, auf dem Artikel liegen.') }}</flux:text>
            </div>
        @else

            {{-- Lade-Ansage: permanent im DOM, server-seitig leer — siehe die ausführliche
                 Begründung in `⚡updates.blade.php`. Zwei Phasen, zwei Sätze: die Adresse
                 auflösen ist etwas anderes als Artikel holen, und bei einer NIP-05-Adresse
                 dauert das erste sichtbar lang. --}}
            <span class="sr-only" aria-live="polite"
                  x-text="aufloesend ? @js(__('Autor wird gesucht…')) : (loading ? @js(__('Artikel werden geladen…')) : '')"></span>

            {{-- ── Die vier Fehlzustände ──────────────────────────────────────────────
                 Vier Ausgänge, vier Sätze, vier Symbole — und nur EINER bietet einen
                 zweiten Versuch an. Das ist der ganze Punkt dieser Aufteilung: „die Domain
                 kennt den Namen nicht" wird beim zehnten Versuch nicht besser, „die Domain
                 hat nicht geantwortet" vielleicht schon. Ein gemeinsamer Satz „Autor nicht
                 gefunden" hätte dem Leser genau diese Entscheidung abgenommen.

                 Symbol UND Text tragen die Unterscheidung (WCAG 1.4.1): das Symbol allein
                 wäre der alleinige Informationsträger. `data-autor-fehler` ist der Anker
                 der Tests — ein eigenes Attribut und NICHT die Überschrift, damit die
                 Prüfung nicht an einer Formulierung hängt.

                 **Die Domain steht als Text da, der rohe Parameter NIE.** In eine URL wird
                 auch mal ein `nsec` getippt; was die Insel nicht im Zustand hält, kann kein
                 Markup rendern. Die Domain ist gegen ein enges Muster geprüft (kein Port,
                 keine Zugangsdaten, kein Pfad — `articleAuthor.ts`) und geht durch
                 `x-text`, nie durch `x-html`. --}}

            {{-- (1) Gar keine Adresse. Nennt die beiden Formen, die gehen. --}}
            <template x-if="fehler === 'format'">
                <div data-autor-fehler="format" class="surface-card empty-state px-4 py-10 text-center">
                    <flux:icon.question-mark-circle class="mx-auto size-8 text-zinc-400" />
                    <flux:heading class="mt-2">{{ __('Das ist keine Autoren-Adresse.') }}</flux:heading>
                    <flux:text class="mt-1 text-sm text-muted">{{ __('Eine Autorenseite steht unter einer npub oder unter einer NIP-05-Adresse wie name@domain.tld.') }}</flux:text>
                    <div class="mt-4">
                        <flux:button size="sm" variant="ghost" icon="arrow-left" :href="route('group.articles')" wire:navigate>{{ __('Alle Artikel') }}</flux:button>
                    </div>
                </div>
            </template>

            {{-- (2) Sieht aus wie eine npub, ist aber keine. Die häufigste Ursache ist ein
                 Link, der beim Weitergeben ein Zeichen verloren hat — das steht da, weil es
                 dem Leser sagt, wo er suchen muss. --}}
            <template x-if="fehler === 'npub'">
                <div data-autor-fehler="npub" class="surface-card empty-state px-4 py-10 text-center">
                    <flux:icon.link-slash class="mx-auto size-8 text-zinc-400" />
                    <flux:heading class="mt-2">{{ __('Diese npub lässt sich nicht lesen.') }}</flux:heading>
                    <flux:text class="mt-1 text-sm text-muted">{{ __('Meist fehlt oder verrutscht ein Zeichen — der Link ist unterwegs beschädigt worden.') }}</flux:text>
                    <div class="mt-4">
                        <flux:button size="sm" variant="ghost" icon="arrow-left" :href="route('group.articles')" wire:navigate>{{ __('Alle Artikel') }}</flux:button>
                    </div>
                </div>
            </template>

            {{-- (3) Die Domain hat geantwortet und kennt den Namen nicht. Das ist eine
                 Auskunft, kein Fehler — deshalb KEIN „Erneut versuchen". --}}
            <template x-if="fehler === 'nip05-unbekannt'">
                <div data-autor-fehler="nip05-unbekannt" class="surface-card empty-state px-4 py-10 text-center">
                    <flux:icon.identification class="mx-auto size-8 text-zinc-400" />
                    <flux:heading class="mt-2">{{ __('Diese Domain kennt den Namen nicht.') }}</flux:heading>
                    <flux:text class="mt-1 text-sm text-muted">
                        <span x-text="@js(__(':domain führt für diese Adresse keinen Eintrag.')).split(':domain').join(fehlerDomain)"></span>
                    </flux:text>
                    <div class="mt-4">
                        <flux:button size="sm" variant="ghost" icon="arrow-left" :href="route('group.articles')" wire:navigate>{{ __('Alle Artikel') }}</flux:button>
                    </div>
                </div>
            </template>

            {{-- (4) Der EINZIGE wiederholbare Fehlzustand — und der einzige mit einem
                 Knopf. `retry()` fängt beim Deuten der Adresse an, nicht beim Laden: der
                 Fehler entsteht VOR jedem Artikel. --}}
            <template x-if="fehler === 'nip05-fehlgeschlagen'">
                <div data-autor-fehler="nip05-fehlgeschlagen" class="surface-card empty-state px-4 py-10 text-center">
                    <flux:icon.signal-slash class="mx-auto size-8 text-zinc-400" />
                    <flux:heading class="mt-2">{{ __('Diese Domain hat nicht geantwortet.') }}</flux:heading>
                    <flux:text class="mt-1 text-sm text-muted">
                        <span x-text="@js(__(':domain war nicht erreichbar oder hat keine gültige Antwort geschickt.')).split(':domain').join(fehlerDomain)"></span>
                    </flux:text>
                    <div class="mt-4 flex flex-wrap items-center justify-center gap-2">
                        <flux:button size="sm" variant="primary" icon="arrow-path" x-on:click="retry()">{{ __('Erneut versuchen') }}</flux:button>
                        <flux:button size="sm" variant="ghost" icon="arrow-left" :href="route('group.articles')" wire:navigate>{{ __('Alle Artikel') }}</flux:button>
                    </div>
                </div>
            </template>

            {{-- Der Relay hat nicht geantwortet. Getrennt von den vier oben: das ist eine
                 Aussage über den ARTIKEL-Relay, nicht über die Adresse. Nur, solange auch
                 nichts im Speicher liegt — was schon da ist, ist mehr wert als eine
                 Fehlerzeile darüber. --}}
            <template x-if="error && anzahl === 0">
                <flux:callout variant="danger" icon="exclamation-triangle" class="mb-3">
                    <flux:callout.text>{{ __('Die Artikel sind gerade nicht erreichbar.') }}</flux:callout.text>
                    <x-slot name="actions">
                        <flux:button size="sm" variant="ghost" icon="arrow-path" x-on:click="retry()">{{ __('Erneut laden') }}</flux:button>
                    </x-slot>
                </flux:callout>
            </template>

            {{-- Laden: server-gerendertes Skeleton (kein `x-if` — das existiert vor dem
                 Alpine-Boot nicht im DOM). Es steht für BEIDE Phasen: Adresse auflösen und
                 Artikel holen. Zwei verschiedene Skelette für zwei Phasen desselben
                 Wartens wären zwei Ladeanimationen hintereinander. --}}
            <div x-show="(aufloesend || loading) && anzahl === 0 && fehler === ''" :aria-busy="aufloesend || loading"
                 class="grid grid-cols-1 gap-3 sm:grid-cols-2">
                @for ($i = 0; $i < 4; $i++)
                    <div class="surface-card overflow-hidden">
                        <div class="skeleton aspect-[16/9] w-full"></div>
                        <div class="space-y-2 p-4">
                            <div class="skeleton h-4 w-3/4"></div>
                            <div class="skeleton h-3 w-full"></div>
                            <div class="skeleton h-3 w-1/3"></div>
                        </div>
                    </div>
                @endfor
            </div>

            {{-- ── Die Autorenkarte ───────────────────────────────────────────────────
                 Sie erscheint erst, wenn sie etwas TRÄGT. Solange das kind 0 unterwegs ist,
                 wäre sie eine leere Box mit einem Knopf; und „hat keine Bio" von „wissen wir
                 noch nicht" zu unterscheiden ist auf dieser Fläche dieselbe Pflicht wie beim
                 Lightning-Zustand. `lightning !== 'unbekannt'` IST der Befund „Profil ist
                 da" (so definiert in `ArticleAuthor.lightning`) — deshalb steht ein Profil
                 ohne jedes Feld trotzdem als Karte da, mit der ehrlichen Zeile „Keine
                 Lightning-Adresse".

                 Ein Autor ganz OHNE kind 0 bekommt keine Karte und trotzdem seine
                 Artikelliste. Das ist der DoD-Fall, und er ist hier kein Sonderweg, sondern
                 dieselbe Bedingung. --}}
            <template x-if="hatAutor() && autor && (autor.banner || autor.about || autor.website || autor.nip05 || autor.lightning !== 'unbekannt')">
                <section class="surface-card mb-4 overflow-hidden" data-autor-karte>

                    {{-- Banner. `banner`-Preset (1200×400) — dieselbe Rolle wie das
                         Space-Banner und das Titelbild der Vollansicht, deshalb dasselbe
                         Preset. KEIN Ersatzverlauf: hat der Autor keins, steht hier nichts
                         (siehe Entwurf). --}}
                    <template x-if="autor.banner">
                        <div class="aspect-[4/1] w-full overflow-hidden bg-zinc-200/60 dark:bg-zinc-800/60">
                            <img :src="$img(autor.banner, 'banner')" alt="" class="size-full object-cover" />
                        </div>
                    </template>

                    <div class="p-4">
                        {{-- Der NIP-05-Handle. Er steht HIER und nicht im Kopf: im Kopf
                             steht der Name, und der Handle ist die Antwort auf eine andere
                             Frage („ist das wirklich der?"). Das Häkchen erscheint nur bei
                             bestätigtem Match — die Prüfung macht welshman
                             (`handles.ts`, `verifiedNip05`). --}}
                        <div x-show="autor.nip05" x-cloak class="flex min-w-0 items-center gap-1">
                            <x-group::nostr-nip05 nip05="autor.nip05" />
                            <span class="min-w-0 truncate text-sm text-muted" x-text="autor.nip05"></span>
                        </div>

                        {{-- Bio, auf sechs Zeilen gedeckelt. Keine Kürzung des Inhalts: der
                             vollständige Text steht in der Profilkarte, die der Knopf unten
                             öffnet. Sechs statt der vier aus der Vollansicht — dort steht
                             die Karte in einer 18rem-Spalte neben dem Artikel, hier über
                             der ganzen Breite. --}}
                        <p x-show="autor.about" x-cloak
                           class="mt-2 line-clamp-6 whitespace-pre-wrap break-words text-sm text-muted"
                           x-text="autor.about"></p>

                        {{-- Website — der Wert ist bereits sanitisiert (`sanitizeUrl` in
                             `longformFeed.ts`); `about:blank` kommt hier gar nicht an. --}}
                        <a x-show="autor.website" x-cloak :href="autor.website"
                           target="_blank" rel="noopener noreferrer"
                           class="pressable mt-3 flex min-w-0 items-center gap-2 rounded-tile border border-zinc-200 px-3 py-2 text-sm text-brand-800 hover:bg-brand-500/5 dark:border-zinc-800 dark:text-brand-400">
                            <flux:icon.globe-alt class="size-4 shrink-0" />
                            <span class="min-w-0 truncate" x-text="autor.website"></span>
                            <flux:icon.arrow-up-right class="ml-auto size-3.5 shrink-0 opacity-50" />
                        </a>

                        {{-- ── Das vollständige Profil auf media. ─────────────────────
                             Diese Seite beantwortet „wer ist das?" nur so weit, wie ein
                             kind 0 es hergibt. Die Creator-Seite im eigenen Ökosystem
                             trägt mehr (Feed, Medien, Pinnwand) — der Verweis führt
                             dorthin, statt Leser auf njump abzugeben.

                             STELLUNG: direkt hinter der Website-Zeile, weil er zu
                             derselben Klasse gehört („dieselbe Person, woanders") und
                             deren Bauform übernimmt. VOR dem Lightning-Einstieg, weil der
                             den einzigen brand-500-Akzent dieser Fläche trägt — ein
                             Fremdziel darunter überholte ihn optisch.

                             `medienUrl()` liest den VERIFIZIERTEN Handle; ist er nicht
                             bestätigt, trägt die Adresse die npub (`medienProfil.ts`).
                             Ohne Konfiguration entsteht die Zeile server-seitig gar
                             nicht, ohne Ziel entfällt das `href` — ein `<a>` ohne `href`
                             ist kein Tabstopp, dieselbe Regel wie bei `href(card)`.
                             `$extern(...)`: `target="_blank"` allein verpufft in der
                             nativen WebView. --}}
                        @if (config('group.media_public_url'))
                            @php($medienHost = (string) Str::of((string) config('group.media_public_url'))->after('://')->before('/'))
                            <a x-show="medienUrl()" x-cloak :href="medienUrl() || null"
                               x-on:click="$extern(medienUrl(), $event)"
                               target="_blank" rel="noopener noreferrer" data-medien-profil="autor"
                               class="pressable mt-2 flex min-w-0 items-center gap-2 rounded-tile border border-zinc-200 px-3 py-2 text-sm text-brand-800 hover:bg-brand-500/5 dark:border-zinc-800 dark:text-brand-400">
                                <flux:icon.user-circle class="size-4 shrink-0" />
                                <span class="min-w-0 truncate">{{ __('Profil auf :host ansehen', ['host' => $medienHost]) }}</span>
                                <flux:icon.arrow-up-right class="ml-auto size-3.5 shrink-0 opacity-50" />
                            </a>
                        @endif

                        {{-- ── Der Lightning-Einstieg, dreiwertig ─────────────────────
                             `ja` = Adresse vorhanden, der Knopf führt zur Profilkarte, in
                             der sie kopierbar steht. `nein` = Profil da, aber ohne Adresse:
                             derselbe Knopf, `aria-disabled` statt `disabled` (er behält
                             seinen Fokus, sonst käme eine Tastatur nie an die Begründung),
                             gestrichelte Kante, und beim Antippen der GRUND als Toast.
                             **`unbekannt` = gar keine Zeile** — solange das kind 0
                             unterwegs ist, ist jede Aussage über eine Zahlungsadresse
                             ungedeckt. Vier der zwölf Autoren (die Podcast-Bridges) haben
                             wirklich keine; für die ist `nein` richtig.

                             `article.author.lightning` heißt hier `autor.lightning`, ist
                             aber dasselbe Feld aus derselben Funktion — DER Befund, nie die
                             Adresse. Die steht bewusst nirgends in dieser Datei
                             (`zapTargetSources.test.ts`). --}}
                        <template x-if="autor.lightning !== 'unbekannt'">
                            <button type="button" data-lightning-einstieg
                                    x-bind:data-lightning-zustand="autor.lightning"
                                    x-bind:aria-disabled="autor.lightning === 'ja' ? null : 'true'"
                                    x-bind:class="autor.lightning === 'ja'
                                        ? 'border-brand-500/30 bg-brand-500/5 hover:bg-brand-500/10'
                                        : 'border-dashed border-zinc-300 cursor-not-allowed dark:border-zinc-700'"
                                    x-on:click="autor.lightning === 'ja'
                                        ? $dispatch('open-profile', autor.pubkey)
                                        : keineLightningAdresse()"
                                    class="pressable mt-2 flex w-full min-w-0 items-center gap-2 rounded-tile border px-3 py-2 text-start">
                                {{-- `::class` und nicht `x-bind:class`: `flux:icon` ist eine
                                     Flux-KOMPONENTE, und `::attr` ist dort die
                                     Hauskonvention. --}}
                                <flux:icon.bolt variant="solid" class="size-4 shrink-0"
                                                ::class="autor.lightning === 'ja' ? 'text-brand-500' : 'text-muted'" />
                                <span class="min-w-0 flex-1 text-sm text-muted"
                                      x-text="autor.lightning === 'ja'
                                          ? @js(__('Lightning-Adresse anzeigen'))
                                          : @js(__('Keine Lightning-Adresse'))"></span>
                            </button>
                        </template>

                        <flux:button size="sm" variant="ghost" icon="user" class="mt-2 w-full"
                                     x-on:click="$dispatch('open-profile', autor.pubkey)">{{ __('Profil öffnen') }}</flux:button>
                    </div>
                </section>
            </template>

            {{-- Leerzustand. Er redet über den RELAY („liegt hier noch kein Artikel"), nicht
                 über den Menschen — dieser Client kennt genau ein Artikel-Relay, und was
                 jemand anderswo geschrieben hat, weiß er nicht. `istLeer()` steht erst,
                 wenn der Relay geantwortet hat; vorher ist die Frage nicht entschieden. --}}
            <template x-if="istLeer()">
                <div class="surface-card empty-state px-4 py-10 text-center">
                    <flux:icon.document-text class="mx-auto size-8 text-zinc-400" />
                    <flux:heading class="mt-2">{{ __('Von diesem Autor liegt hier noch kein Artikel.') }}</flux:heading>
                    <flux:text class="mt-1 text-sm text-muted">{{ __('Sobald einer auf diesem Relay erscheint, steht er hier.') }}</flux:text>
                    <div class="mt-4">
                        <flux:button size="sm" variant="ghost" icon="arrow-left" :href="route('group.articles')" wire:navigate>{{ __('Alle Artikel') }}</flux:button>
                    </div>
                </div>
            </template>

            {{-- ── Die Artikel, nach Monat ─────────────────────────────────────────
                 SIGNATUR dieser Fläche. Die Marke ist ein `<h2>` und kein `<div>`: sie
                 gliedert das Dokument wirklich, und eine Sprachausgabe springt damit von
                 Monat zu Monat. Die Kartentitel sind deshalb `<h3>` — eine Ebene tiefer als
                 auf `/articles`, wo sie unter der `h1` direkt als `h2` stehen. Eine
                 Überschriftenebene, die eine Gliederung nur behauptet, wäre schlimmer als
                 keine.

                 Die Haarlinie ist `flex-1` und läuft bis zum Rand — sie trennt nicht zwei
                 Blöcke, sie ist der Balken, an dem der Monat hängt. --}}
            {{-- Der Abstand zwischen den Monatsgruppen sitzt am WRAPPER (`space-y-8`) und
                 nicht als `first:mt-0` an der Sektion. Der Grund ist eine Hauslehre:
                 Alpine lässt das `<template>` als ERSTES Kind stehen und hängt die
                 erzeugten Knoten dahinter — `first:` träfe damit nie eine Sektion,
                 sondern dauerhaft das unsichtbare Template. `space-y-*` rechnet über
                 `:not(:last-child)` und ist davon unberührt: das Template ist
                 `display:none`, ein Rand daran wirkt nicht, und die letzte Sektion
                 bekommt korrekt keinen. --}}
            <div class="space-y-8">
            <template x-for="gruppe in gruppen" :key="gruppe.jahr * 12 + gruppe.monat">
                <section>
                    <h2 class="mb-3 flex items-center gap-3">
                        {{-- Beschriftet wird der MONAT in der Sprache des Lesers
                             („August 2026"), maschinenlesbar daneben steht `YYYY-MM`.
                             Zwei Träger, zwei Zwecke: der Mensch liest den Namen, eine
                             Prüfung greift an der Zahl und hängt damit nicht an einer
                             Locale. Kein `uppercase` — ein Monatsname ist ein Wort, keine
                             Marke; versal gesetzt schriee er. `tabular-nums` für die
                             Jahreszahl, damit die Marken gleich breit untereinander
                             stehen. --}}
                        <span class="shrink-0 text-xs font-semibold tracking-[0.04em] tabular-nums text-muted"
                              x-text="gruppe.label"
                              :data-monatsmarke="gruppe.jahr + '-' + String(gruppe.monat).padStart(2, '0')"></span>
                        <span aria-hidden="true" class="h-px flex-1 bg-zinc-200 dark:bg-zinc-800"></span>
                    </h2>

                    <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <template x-for="card in gruppe.artikel" :key="card.id">
                            {{-- `<article>` und nicht `<a>`: eine Podcast-Karte trägt zwei
                                 Handlungen (lesen, hören), und ein Player INNERHALB eines
                                 Links wäre verschachtelte Interaktion. Gleiche Bauart wie
                                 auf `/articles`. --}}
                            <article class="surface-card flex h-full flex-col overflow-hidden">
                                <a :href="href(card) || null" wire:navigate
                                   class="pressable flex min-w-0 flex-1 flex-col transition-colors hover:bg-brand-500/5">

                                    {{-- Deckel. Der Verlauf liegt IMMER darunter, auch unter
                                         einem echten Titelbild: scheitert das Bild (fremder
                                         Host, 404, abgelehnter Proxy), steht dort nie ein
                                         weißes Loch. Er ist deterministisch aus `pubkey:d`
                                         gerechnet und kostet nichts. --}}
                                    <div class="relative aspect-[16/9] w-full shrink-0 overflow-hidden"
                                         :style="'background-image: ' + card.coverCss">

                                        {{-- `$img(…, 'msg')`: alles außer `data:`/`blob:`
                                             geht durch den Proxy (`core.ts`, `INLINE_SRC`).
                                             `loading="lazy"` — ein Vielschreiber bringt 55
                                             Karten mit. --}}
                                        <template x-if="card.image">
                                            <img :src="$img(card.image, 'msg')" alt="" loading="lazy"
                                                 class="size-full object-cover" />
                                        </template>

                                        {{-- Ohne Titelbild wird der Titel selbst zum Bild —
                                             dieselbe Signatur wie in der Liste, damit eine
                                             Karte hier nicht anders aussieht als dort.
                                             `x-if` und nicht `x-show`: es darf immer nur EINE
                                             Überschrift je Karte im DOM stehen.
                                             `bg-white/20` und nicht `/25`: über jede Farbe der
                                             Palette gerechnet hält weiße Schrift auf `/25` im
                                             schlechtesten Fall nur 4,42:1 — der Titel ist hier
                                             18 px fett und damit noch KEIN „großer Text". --}}
                                        <template x-if="! card.image">
                                            <h3 class="absolute inset-0 flex items-end p-4 text-lg font-bold leading-tight text-white">
                                                <span class="line-clamp-3 w-full break-words"
                                                      x-text="card.title || @js(__('Ohne Titel'))"></span>
                                            </h3>
                                        </template>

                                        {{-- Podcast-Plakette. DECKENDE Fläche: sie kann auf
                                             einem beliebigen fremden Titelbild landen, und
                                             deckend rechnet weiße Schrift auf `zinc-950`
                                             19,80:1 — unabhängig davon, was darunter liegt.
                                             Symbol UND Wort (WCAG 1.4.1). --}}
                                        <template x-if="card.podcast">
                                            <span class="absolute start-3 top-3 inline-flex items-center gap-1 rounded-pill bg-zinc-950 px-2 py-1 text-xs font-semibold text-white">
                                                <flux:icon.microphone variant="micro" class="size-3.5" />
                                                {{ __('Podcast') }}
                                            </span>
                                        </template>
                                    </div>

                                    <div class="flex min-w-0 flex-1 flex-col gap-2 p-4">
                                        {{-- Der Titel — hier nur, wenn ein Titelbild den
                                             Deckel belegt (siehe oben). --}}
                                        <template x-if="card.image">
                                            <h3 class="line-clamp-2 break-words text-base font-semibold leading-snug text-zinc-900 dark:text-zinc-100"
                                                x-text="card.title || @js(__('Ohne Titel'))"></h3>
                                        </template>

                                        {{-- Vorschau: `summary`-Tag, sonst Fließtext aus dem
                                             Artikel. Fremdtext, deshalb `x-text` und nie
                                             `x-html`. --}}
                                        <p x-show="card.teaser" x-cloak
                                           class="line-clamp-3 break-words text-sm leading-normal text-muted"
                                           x-text="card.teaser"></p>

                                        {{-- Meta-Zeile. `mt-auto` drückt sie in allen Karten
                                             einer Rasterzeile auf dieselbe Höhe. KEINE
                                             Autoren-Byline: auf dieser Seite wäre sie 55-mal
                                             derselbe Name. Die Lesezeit erscheint nur, wenn
                                             es eine gibt — `0` heißt „keine Angabe". Eine
                                             DAUER steht nirgends: keine der 14 Episoden
                                             trägt eine. --}}
                                        <div class="mt-auto flex flex-wrap items-center gap-x-1.5 gap-y-1 pt-1 text-xs text-muted">
                                            <time :datetime="card.dateIso" x-text="card.dateLabel"></time>
                                            <template x-if="card.readingMinutes > 0">
                                                <span class="inline-flex items-center gap-1.5">
                                                    <span aria-hidden="true">·</span>
                                                    <span class="tabular-nums" x-text="$plural(card.readingMinutes, '1 Min. Lesezeit', ':count Min. Lesezeit')"></span>
                                                </span>
                                            </template>
                                            {{-- Sozialsignale (P6) — dieselbe Komponente wie in der
                                                 Liste. Zwei Bauwege für dieselbe Zahl wären zwei
                                                 Wahrheiten über denselben Artikel. --}}
                                            <x-group::article-metrics metrics="card.metriken" />
                                        </div>
                                    </div>
                                </a>

                                {{-- Player: AUSSERHALB des Links, und erst auf Klick. Solange
                                     der Knopf steht, existiert gar kein `<audio>` im DOM —
                                     kein Fremd-Request ohne Zutun. Danach das NATIVE
                                     Bedienelement: es bringt Tastatur, Sprachausgabe-Namen,
                                     Lautstärke und Systemintegration mit.
                                     `aria-label` an BEIDEN: zwei Episoden auf demselben
                                     Bildschirm hießen sonst beide „Folge anhören"; der
                                     sichtbare Text steht am Anfang des Namens (WCAG 2.5.3). --}}
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
                </section>
            </template>
            </div>
        @endif
    </div>

</x-group::app-shell>
