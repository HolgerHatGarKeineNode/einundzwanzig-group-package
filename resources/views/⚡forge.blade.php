<?php

use Livewire\Attributes\Layout;
use Livewire\Component;

/**
 * Forge-Übersicht („Forge", `/forge`, P6) als Livewire-Full-Page-SFC.
 *
 * Dünner Shell: Laden, Falten und Rendern leben komplett in der Alpine-Insel
 * `nostrForge` (welshman, client-seitig). Kein `mount()` — server-seitig ist
 * nichts vorzubereiten, die Daten liegen auf dem Workspace-Relay hinter NIP-42.
 *
 * **Ob es die Fläche gibt, entscheidet der SERVER** (`config('group.workspace_url')`),
 * nicht die Insel: das Gate steht im ausgelieferten HTML, bevor ein Script läuft.
 * Wie sie sich verhält — Buzz oder nicht, erreichbar oder nicht — entscheidet die
 * Insel dreiwertig über `deriveSpaceKind` (`js/spaceCaps.ts`). Genau diese
 * Trennung verhindert die Mount-Falle: kein NIP-11 im kritischen Pfad.
 */
new #[Layout('group::einundzwanzig')] class extends Component
{
    public function render()
    {
        return $this->view()->title(__('Forge'));
    }
}; ?>

{{-- `width="wide"`: diese Fläche zeigt ein RASTER (Kennzahlen, darunter Listen),
     keinen Fließtext. Der 62-rem-Lesedeckel ließ auf einem 1440er-Schirm rechts
     eine Handbreit leer, während die Kacheln sich drängten. --}}
{{-- ── Der HOST entscheidet, nicht die Breite (P4) ────────────────────────────
     Dieselbe Frage und dieselbe Antwort wie in `bottom-nav.blade.php:52` und
     `app-frame.blade.php:41`: ab `xl` trägt der Navigator links die Ortswechsel
     und die Kanäle — aber NUR im Web-Host, denn die NativePHP-App hat kein
     Desktop-Chassis. Ein iPad Pro quer misst 1366 CSS-px und läge über `xl`;
     dort bliebe die App ohne Rail und ohne Tabs zurück.

     Deshalb steht hier eine Host-Bedingung und KEIN neuer Breakpoint. --}}
@php($native = \Einundzwanzig\Group\Chassis::istApp())
<x-group::app-shell width="wide">

    {{-- Der Basis-Pfad kommt aus `route()`, nicht als Literal: die Route heißt an
         genau einer Stelle `/forge`, und das ist `routes/group.php`. --}}
    <div x-data="nostrForge(@js(route('group.forge')))" class="page-enter">

        <x-group::app-header :title="__('Forge')" :back="route('group.spaces')" />

        {{-- ── Die Ortsleiste endet ab `xl` (P4) ──────────────────────────────
             Gemessen am gebauten Stand: auf `/forge` @1920 trugen ZWEI sichtbare
             Elemente `aria-current="page"` mit demselben `href=/forge` — die
             Rail-Zeile (295 px) und die Ortskarte (496 px); bei 1279 px genau
             eines. Zwei „du bist hier"-Markierungen auf dasselbe Ziel sind keine
             Redundanz, sondern eine Zweideutigkeit: welche ist DIE aktuelle?

             Die Begründung im Kopf von `ortskarten.blade.php` („die Rail-Zeile
             fragt *kann ich dorthin gehen*, die Ortskarte *wo bin ich*") trägt
             unterhalb `xl` vollständig — dort gibt es die Rail nicht. Ab `xl`
             trägt sie nicht mehr, weil die Rail-Zeile selbst `aria-current`
             setzt und damit beide Fragen beantwortet.

             Dazu die Größenordnung: bei 1920 px maß jede der drei Karten 496 px
             Breite und 70 px Höhe — für die Wörter „Chat", „Artikel", „Forge".

             NUR auf dieser Fläche: `/articles` und `/spaces` binden dieselbe
             Komponente ein und behalten sie, solange niemand dort dasselbe
             gemessen und entschieden hat. Die Klasse kommt deshalb von HIER und
             steht nicht in der Komponente. --}}
        <x-group::ortskarten :class="$native ? null : 'xl:hidden'" />

        @if (! config('group.workspace_url'))
            {{-- Kein Workspace konfiguriert. Kein Fehler, sondern eine bewusste
                 Konfiguration: dieses Package läuft in mehreren Hosts, und nicht
                 jeder hat ein Buzz-Relay daneben. Erklärender Leerzustand statt
                 Fehlermeldung — und kein einziger REQ. --}}
            {{-- Leerzustände tragen das Icon in einer getönten Kachel statt frei
                 schwebend: eine 8er-Glyphe in zinc-400 auf weißer Fläche misst 2,52:1
                 und verschwindet — die Kachel gibt ihr eine Kante und hebt die Glyphe
                 selbst auf zinc-500 (4,74:1 hell, 7,11:1 dunkel). Der Fließtext bekommt
                 `max-w-sm`, damit die Zeile auch auf 1280px im Lesemaß bleibt und nicht
                 quer über die halbe Karte läuft. Die Reihenfolge der KINDER bleibt
                 Icon → Überschrift → Text → Aktion: daran hängt die gestaffelte
                 Einblendung aus `theme.css` (`.empty-state > :nth-child(n)`). --}}
            <div class="surface-card empty-state px-6 py-12 text-center">
                <span class="mx-auto flex size-12 items-center justify-center rounded-tile bg-zinc-100 dark:bg-zinc-800">
                    <flux:icon.code-bracket-square class="size-6 text-zinc-500 dark:text-zinc-400" />
                </span>
                <flux:heading size="lg" class="mt-4">{{ __('Keine Forge-Quelle eingerichtet.') }}</flux:heading>
                <flux:text class="mx-auto mt-1 max-w-sm text-sm text-muted">{{ __('Dieser Client kennt kein Relay, auf dem Repositories liegen.') }}</flux:text>
            </div>
        @else
            <div>
                {{-- Fehler: die Liste ist UNVOLLSTÄNDIG, nicht falsch — was schon im
                     Speicher liegt, steht weiter da. Gleicher Wortlaut-Bau wie auf
                     `/articles` und `/updates`. --}}
                <template x-if="error">
                    <flux:callout variant="danger" icon="exclamation-triangle" class="forge-mass mb-4">
                        <flux:callout.text x-text="error"></flux:callout.text>
                        <x-slot name="actions">
                            <flux:button size="sm" variant="ghost" icon="arrow-path" x-on:click="retry()">{{ __('Erneut laden') }}</flux:button>
                        </x-slot>
                    </flux:callout>
                </template>

                {{-- Der Workspace hat sich nicht als Buzz zu erkennen gegeben. Das ist
                     KEIN Fehler und blockiert nichts: NIP-34 ist ein offener Standard.
                     Es hat aber eine Folge, die man kennen muss — ohne NIP-11-`self`
                     lässt sich der relay-signierte Branch-Zustand (30618) nicht
                     zuordnen. Deshalb ein Hinweis statt einer stillen Lücke.
                     `kind === 'unknown'` sagt hier bewusst NICHTS: da ist das Dokument
                     noch unterwegs. --}}
                <template x-if="kind === 'other'">
                    <flux:callout variant="warning" icon="information-circle" class="forge-mass mb-4">
                        <flux:callout.text>{{ __('Der Workspace hat sich nicht als Buzz-Relay gemeldet. Repositories und Issues werden trotzdem gelesen; der Branch-Zustand kann fehlen.') }}</flux:callout.text>
                    </flux:callout>
                </template>

                <div :aria-busy="loading">

                    {{-- Lade-Ansage. Steht PERMANENT im DOM und server-seitig LEER:
                         `aria-live` meldet Änderungen INNERHALB einer bestehenden
                         Region — ein Text, der schon beim Seitenaufbau dasteht und
                         danach nur versteckt wird, wird nie angesagt. --}}
                    <span class="sr-only" aria-live="polite"
                          x-text="loading ? @js(__('Die Forge wird geladen…')) : ''"></span>

                    {{-- ── Die Zustandszeile ───────────────────────────────────────
                         Drei Zahlen in EINER Zeile — bis P4 war das eine Karte mit
                         drei Zellen.

                         Warum sie weicht, gemessen statt geschätzt: bei 1920 px maß
                         die Karte 1504 × 86,8 px; eine Zelle war 375,5 px breit und
                         trug eine einstellige Zahl. Zusammen mit der Ortsleiste
                         darüber (70 px) standen 156,8 px Höhe über der Falz für drei
                         Zahlen und eine Navigation, die die Rail schon führt.

                         Was BLEIBT, und zwar unverändert: die Regel, dass eine `0`
                         eine Aussage ist („es gibt keine Issues") und deshalb erst
                         erscheinen darf, wenn der Relay geantwortet hat. Bis dahin
                         steht ein Balken. Eine `0` während des Ladens wäre dieselbe
                         Lüge, nur andersherum — `settled()` entscheidet das, nicht
                         die Bauform der Zeile.

                         Die Icons sind mit den Kacheln gegangen. In einer Zeile aus
                         Wort und Zahl trägt eine Glyphe nichts bei, was das Wort
                         nicht schon sagt. (Die Falle mit dem dynamischen Icon-Namen —
                         `<flux:icon :name="…">` statt `<flux:icon.{{ … }}>`, sonst
                         500er beim Rendern — steht weiter dokumentiert an
                         `nav-tab.blade.php:85`.)

                         `tabular-nums` ist NICHT nötig und steht deshalb nicht da:
                         die Hausschrift ist Inconsolata, eine Zellenschrift — jede
                         Ziffer belegt bereits exakt eine Zelle (gemessen 7,00 px bei
                         14 px, 8,00 px bei 16 px). --}}
                    <div class="mb-4 flex flex-wrap items-baseline gap-x-6 gap-y-1" data-forge-zustandszeile>
                        {{-- ── Die Kacheln sind seit P3 LINKS ──────────────────────
                             `tab` ist der Zielwert der Übersichts-Whitelist, nicht der
                             Feldname: die Kachel „Pull Requests" liest `counts.pullRequests`
                             und führt nach `?tab=pulls`. Zwei Namen für dieselbe Sache, und
                             genau deshalb steht die Zuordnung hier EINMAL in der Tabelle
                             statt zweimal im Markup.

                             `wire:navigate` fehlt mit Absicht: das Ziel ist dieselbe Seite,
                             ein Nachladen wäre reine Arbeit. Der Klick bleibt in der Insel
                             (`x-on:click.prevent`), die Adresse schreibt der `?tab=`-Abgleich
                             ohnehin zurück. Das `href` steht trotzdem echt da — für
                             Mittelklick, „Link kopieren" und alles, was kein Klick ist. --}}
                        @php($tiles = [
                            ['key' => 'repos', 'label' => __('Repositories'), 'tab' => 'repos'],
                            ['key' => 'pullRequests', 'label' => __('Pull Requests'), 'tab' => 'pulls'],
                            ['key' => 'issues', 'label' => __('Issues'), 'tab' => 'issues'],
                        ])
                        {{-- ── Was eine Kachel von der Patch-Zelle unterscheidet ──────
                             Drei dieser vier Zellen führen irgendwohin, die vierte
                             nicht. Bis zur P4-Nacharbeit war das im RUHEZUSTAND
                             nicht zu sehen: an den echten gerenderten Knoten
                             gemessen waren Beschriftung (11,2 px / 600 / zinc-600 /
                             versal / 0,56 px Sperrung) und Zahl (16 px / 600 /
                             zinc-900) zeichengleich. Es unterschieden sie nur
                             `cursor: pointer` und 4 px Höhe — beides sieht nur, wer
                             eine Maus hat. Für den Daumen und für die Tastatur war
                             die Patch-Zelle ein toter Link.

                             Der Träger ist jetzt eine LINIE, keine Farbe: die drei
                             Links unterstreichen ihre Beschriftung gepunktet, die
                             Patch-Zelle nicht. Eine Linie ist da oder nicht da —
                             das überlebt Graustufen, Farbenblindheit und ein
                             invertiertes Display (WCAG 1.4.1). Die Polsterung ist
                             an allen VIER Zellen dieselbe, damit die Linie der
                             einzige Unterschied bleibt und die Zeile nicht springt. --}}
                        @foreach ($tiles as $tile)
                            <a :href="forgeTabHref('{{ $tile['tab'] }}')"
                               x-on:click.prevent="zeigeListe('{{ $tile['tab'] }}')"
                               data-forge-kachel="{{ $tile['tab'] }}"
                               class="pressable text-btn-touch -mx-1 flex items-baseline gap-1.5 rounded-tile px-1 py-0.5 hover:bg-zinc-100 dark:hover:bg-zinc-800">
                                <span class="text-xs font-semibold uppercase tracking-wider text-muted underline decoration-dotted underline-offset-4">{{ $tile['label'] }}</span>
                                {{-- Der Balken hat die Zeilenhöhe der Zahl, damit die Zeile
                                     beim Eintreffen der Zahl nicht springt. `align-baseline`
                                     hält ihn auf der Schriftlinie der Beschriftung. --}}
                                <span x-show="!settled()" class="skeleton inline-block h-4 w-6 align-baseline"></span>
                                <span x-show="settled()" x-cloak data-forge-tile="{{ $tile['key'] }}"
                                      class="text-base font-semibold leading-5 text-zinc-900 dark:text-zinc-100"
                                      x-text="$num(counts().{{ $tile['key'] }})"></span>
                            </a>
                        @endforeach
                        {{-- Patches (1617) — anders als die drei darüber NUR, wenn es
                             welche gibt. Eine `0` ist bei Repos, Issues und PRs eine
                             Aussage („noch keine"); bei Patches wäre sie eine Spalte,
                             die in den meisten Workspaces nie etwas sagt. Viele
                             arbeiten ausschliesslich mit Pull Requests und werden nie
                             ein 1617 sehen. --}}
                        {{-- **Die vierte Zelle bleibt KEIN Link, und das ist eine
                             Entscheidung.** Es gibt keine workspace-weite Patch-Liste —
                             P3 baut Issues und Pull Requests. Eine Kachel, die aussieht
                             wie ihre drei Nachbarn und beim Antippen nichts tut oder auf
                             eine andere Liste führt, wäre schlimmer als eine, die
                             erkennbar nur zählt. Sie erscheint ohnehin nur, wenn es
                             Patches GIBT — in den meisten Workspaces nie.

                             Damit trägt das Raster drei Zellen (alle Links) oder vier
                             (drei Links, eine Zahl). --}}
                        <span x-show="settled() && counts().patches > 0" x-cloak
                              data-forge-zelle="patches"
                              class="text-btn-touch -mx-1 flex items-baseline gap-1.5 px-1 py-0.5">
                            {{-- KEINE gepunktete Linie, kein `pressable`, kein
                                 `rounded-tile`-Anfassbereich: diese Zelle zählt nur.
                                 Der Unterschied zu ihren drei Nachbarn ist damit im
                                 Ruhezustand sichtbar — und zwar ohne Farbe. --}}
                            <span class="text-xs font-semibold uppercase tracking-wider text-muted">{{ __('Patches') }}</span>
                            <span data-forge-tile="patches"
                                  class="text-base font-semibold leading-5 text-zinc-900 dark:text-zinc-100"
                                  x-text="$num(counts().patches)"></span>
                        </span>
                    </div>

                    {{-- `flux:tabs` OHNE `flux:tab.group`: ohne Panels wirft Flux beim
                         Auflösen des Panels, sobald eine Tab-Gruppe da ist — hier
                         schaltet der Tab nur eine Alpine-Liste um. Gleiche Bauart wie
                         auf `/updates`. --}}
                    {{-- Vierter Tab „Workspaces" (P5): die KANÄLE des Workspace-Relays.
                         Er stand bis P5 als dritter Tab auf `/spaces`, neben „Räume" und
                         „Threads" — also neben den Räumen eines ANDEREN Relays. Das war
                         die falsche Nachbarschaft: die Bar dort gliedert den Vereins-Chat,
                         und ein Eintrag darin, der auf ein zweites Relay zeigt, machte aus
                         einer Gliederung eine Aufzählung. Hier steht er neben drei
                         Geschwistern, die alle dieselbe Quelle lesen.

                         Er steht als LETZTER und nicht als erster: die drei anderen Tabs
                         beantworten „was ist hier passiert / woran wird gearbeitet", der
                         vierte „wo wird darüber geredet". Das ist die Reihenfolge, in der
                         jemand eine Forge betritt. --}}
                    {{-- ── `scrollable` ist die Reparatur, nicht Zierat ────────────────
                         Ohne das Attribut rendert Flux ein nacktes `<ui-tabs>` mit
                         `inline-flex p-1` (`flux-pro/stubs/…/tabs.blade.php:66-68`) — also
                         OHNE Overflow-Container. Die Tabs tragen `whitespace-nowrap
                         flex-1`; `flex-1` heisst Basis 0, aber `whitespace-nowrap` hebt die
                         minimale Inhaltsbreite auf max-content, und ein `inline-flex`-Kasten
                         ohne Breitenzwang wächst auf die Summe der Eigenbreiten.

                         Gemessen bei 320 px mit den vier alten Tabs: die Bar war 409 px
                         breit in einem 288-px-Kasten, das Dokument scrollte 105 px
                         waagerecht. Der Fehler bestand bis Viewport < 425 px (de) bzw.
                         < 439 px (nl/hu) — also auf JEDEM gängigen Telefon im Hochformat,
                         iPhone 15 Pro Max eingeschlossen.

                         **Drei Tabs allein heilen es nicht.** In acht Sprachen gemessen:
                         de/en/es/pt/pl passen mit 2 bis 9 px Luft, nl/hu/lv laufen mit
                         +12 px über. Ein Entwurf, der an zwei Pixeln hängt, ist keiner —
                         ein Wort, das um zwei Zeichen wächst, kippt ihn zurück.

                         Mit `scrollable` ist der Dokument-Überlauf in allen 16 gemessenen
                         Fällen 0, und wo es nicht gebraucht wird, entsteht gar keine
                         Scroll-Fläche. `scrollable:fade` ist ebenfalls nicht Deko: ohne die
                         Maske wird die letzte Beschriftung hart abgeschnitten und liest sich
                         als Renderfehler statt als „hier geht es weiter".
                         `scrollable:scrollbar="hide"` bewusst NICHT — bei 12 px Überlauf ist
                         der Balken die einzige Affordanz neben der Maske.

                         ── Die Beschriftung heisst „Kanäle", der Bezeichner bleibt ────────
                         `name="workspaces"` ist unverändert: er steht in geteilten Links, in
                         der serverseitigen Weiterleitung aus `⚡spaces.blade.php` und in
                         `OrtskartenTest.php`. Umbenannt wird nur, was der Mensch liest.

                         Und es ist ein EIGENER Übersetzungsschlüssel, nicht das vorhandene
                         `__('Räume')`. Der bezeichnet an vier Stellen die Chat-Räume des
                         Vereins-Relays (`ortskarten`, `command-palette`, `desktop-rail`,
                         `⚡spaces`); ihn mitzubenutzen hiesse, zwei verschiedene Dinge
                         dauerhaft aneinanderzubinden — ab `xl` stünden „Räume" (Rail) und
                         „Räume" (Tab) gleichzeitig im Bild, für zwei verschiedene Relays.
                         „Kanäle" ist zugleich das Wort, das dieses Paket in seinen
                         Wake-Meldungen ohnehin benutzt („dieses Repository gehört zu keinem
                         Kanal") und das Buzz selbst verwendet. --}}
                    {{-- ── Ab `xl` schaltet hier nichts mehr um (P4) ────────────────────
                         Drei Inhalte, die nebeneinander passen, brauchen keinen
                         Umschalter: bei 1920 px maß die Bar 409 px in einer 1504 px
                         breiten Zeile. Ab `xl` stehen Werkbank und Spur gleichzeitig,
                         die Kanäle führt die Rail.

                         ── Warum ein eigener WRAPPER und nicht `class="xl:hidden"` am
                         `flux:tabs` ────────────────────────────────────────────────
                         Mit `scrollable` rendert der Stub drei verschachtelte Kästen
                         (`flux-pro/stubs/resources/views/flux/tabs.blade.php:53-64`), und
                         `$attributes->class(...)` landet am INNERSTEN (`<ui-tabs>`). Ein
                         `xl:hidden` dort blendete die Tabs aus und liesse die äussere
                         Hülle stehen — eine leere graue Leiste mit `rounded-lg` und
                         `bg-zinc-800/5`. Der Wrapper trifft alle drei Kästen.

                         Er ist zugleich der Messpunkt der Insel: `nostrForge` liest
                         seinen gerenderten `display`, um zu wissen, ob die Bühne
                         zweispaltig steht. So gibt es KEIN drittes Literal der
                         xl-Schwelle — CSS und `viewport.ts` führen sie schon, und der
                         Modulkopf dort nennt das ausdrücklich als Risiko. --}}
                    {{-- ── Flux' DEFAULT-Variante, kein `segmented` (P1, 2026-08-26) ───
                         Die Segment-Variante markierte den aktiven Reiter allein über
                         seine FLÄCHE: `data-selected:bg-white` auf einer Schiene aus
                         `bg-zinc-800/5` über dem Seitengrund. Gerechnet mit
                         `p2-kontrast.mjs` (Negativkontrolle im selben Lauf) sind das
                         1,15:1 hell (`white` auf `zinc-50 + zinc-800@0.05`) und 1,93:1
                         dunkel (`white@0.2` auf `zinc-950 + white@0.1`) — WCAG 1.4.11
                         verlangt 3:1 für ein Bedienelement, das seinen Zustand über ein
                         Grafikobjekt trägt. Die Default-Variante trägt ihn über einen
                         2-px-Unterstrich in `--color-accent-content`: **4,21:1 hell**
                         (brand-700 auf zinc-50) und **10,01:1 dunkel** (brand-400 auf
                         zinc-950).

                         Zwei Stellen braucht Flux' Default trotzdem als Korrektur, und
                         beide sind gerechnet, nicht geschmacklich — sie stehen in
                         `theme.css` bei `.forge-reiterbank`: die INAKTIVE Beschriftung
                         (Flux: `text-zinc-400`, hell 2,42:1 — reisst 1.4.3) und das WORT
                         des aktiven Reiters (accent-content als TEXT misst hell 4,21:1
                         und bliebe 0,29 unter den 4,5 aus 1.4.3; die Hausregel
                         „brand-700 = Linie, brand-800 = Text" hebt es auf 6,15:1). Die
                         LINIE bleibt unangetastet — für sie gilt 1.4.11 mit 3:1, und die
                         hält sie.

                         (Der Attributname steht hier bewusst nicht ausgeschrieben: die
                         Abnahme dieser Phase misst sein Verschwinden mit `grep -c` über
                         diese Datei, und ein Zitat im Kommentar wäre dort ein Treffer.)

                         Zweiter Gewinn, und er ist mobil der grössere: der Reiter selbst
                         wächst von 32 auf 40 px. Die Segment-Variante steckt ihre Knöpfe in eine
                         Schiene mit `p-1`, die Default-Variante gibt ihnen die vollen
                         `h-10`. Unterhalb `xl` ist diese Reihe die EINZIGE Navigation
                         zwischen Aktivität, Repositories und Kanälen.

                         `data-forge-reiter` ist der Anker für die eine Korrektur, die
                         Flux' Default braucht (inaktive Beschriftung, `theme.css`).

                         Die Icons stehen erst ab `lg`: mobil zählt jede Ziffer Breite,
                         und die Reihe soll ohne Scrollen lesbar bleiben.
                         `max-lg:[&>svg]:hidden` trifft das Icon am gerenderten `<button>`
                         — die Klasse aus `$attributes` landet dort (`flux/tab/index`),
                         das Icon ist sein direktes Kind. KEIN `::variant` am Icon: das
                         löst zur Compile-Zeit auf und wäre eine tote Bindung.

                         Nur „Repositories" trägt eine Zahl. „Aktivität" hat keine
                         Bestandsgrösse, die etwas beantwortet, und die Kanalzahl lebt in
                         einer ANDEREN Alpine-Insel (`nostrWorkspaceRooms`, unten in
                         dieser Datei) — sie hier zu zeigen hiesse, einen zweiten Datenweg
                         für dieselbe Zahl zu bauen. Das ist P6, Schritt 3. --}}
                    <div data-forge-tabs data-forge-reiter @class(['mb-4', 'xl:hidden' => ! $native])>
                        <flux:tabs scrollable scrollable:fade x-model="tab">
                            <flux:tab name="activity" icon="clock" class="max-lg:[&>svg]:hidden">{{ __('Aktivität') }}</flux:tab>
                            <flux:tab name="repos" icon="code-bracket-square" class="max-lg:[&>svg]:hidden">
                                {{ __('Repositories') }}
                                {{-- Bei 0 steht KEINE Pille — nicht die Ziffer „0".
                                     `settled()` (= `!loading`) hält sie zusätzlich
                                     zurück, solange noch geladen wird: eine Zahl, die
                                     während des Ladens wächst, liest sich als Bestand
                                     und ist keiner. Dieselbe Begründung, die die
                                     Zustandszeile dieser Fläche schon führt. --}}
                                <template x-if="settled() && counts().repos > 0">
                                    <flux:badge size="sm" class="ms-1.5" x-text="$num(counts().repos)" />
                                </template>
                            </flux:tab>
                            <flux:tab name="workspaces" icon="hashtag" class="max-lg:[&>svg]:hidden">{{ __('Kanäle') }}</flux:tab>
                        </flux:tabs>
                    </div>

                    {{-- Kürzungshinweis. Er steht nur da, wenn eine Liste GENAU am
                         Limit ankam — dann kann sie gekürzt sein, und das ist eine
                         Aussage über den Bestand, die die Fläche schuldet. --}}
                    <template x-if="tab !== 'workspaces' && truncatedText()">
                        <flux:callout variant="secondary" icon="information-circle" class="forge-mass mb-4" data-forge-truncated>
                            <flux:callout.text x-text="truncatedText()"></flux:callout.text>
                        </flux:callout>
                    </template>

                    {{-- ══ DIE BÜHNE ══════════════════════════════════════════════════
                         Ab `xl` im Web-Host zwei Spuren nebeneinander statt drei Tabs
                         hintereinander: WERKBANK (der Zustand je Repository) links,
                         AKTIVITÄTSSPUR (was zuletzt geschah) rechts. Die Kanäle führt
                         der Navigator.

                         ── Die Rangfolge, und warum nicht umgekehrt ──────────────────
                         Die Rail ist ein INDEX — sie beantwortet „wo ist das Ding" und
                         trägt Repos, Issues, Pull Requests, Projekte und Foren als
                         Baum. Ein Index kann Zustand nicht zeigen. Die eine Frage, die
                         die Bühne beantworten kann und die Rail nicht, ist „wie steht
                         es?". Deshalb bekommt der Zustand die breite Spur, und der
                         Strom bekommt die schmale — nicht aus Platznot, sondern weil
                         seine Zeilen einzelne SÄTZE sind und bei 45–75 Zeichen bleiben
                         müssen.

                         ── Die Klassen stehen NUR im Web-Host ────────────────────────
                         `forge-buehne` ist der benannte Container, an dem alle
                         Schwellen in `theme.css` hängen. Ohne ihn feuert dort keine
                         einzige `@container forge`-Regel — die App bleibt also
                         einspaltig, auf JEDER Breite, ohne dass die Host-Bedingung ein
                         zweites Mal ausgeschrieben werden müsste. Eine Bedingung, ein
                         Ort.

                         (`forge-werkbank` steht dagegen unbedingt: die Zeichenspalten
                         der Repo-Zeile sind auch in einer breiten App richtig.) --}}
                    {{-- ── ZWEI Elemente, und das ist keine Verschachtelung aus Bequemlichkeit ──
                         Ein Element ist sein EIGENER Container und wird von der eigenen
                         `@container`-Regel nicht getroffen — Container-Queries gelten für
                         NACHFAHREN. Standen `forge-buehne` (Container) und `forge-raster`
                         (Raster) am selben Knoten, blieb das Raster einspaltig, und zwar
                         lautlos: `grid-template-columns` meldete `1504px` statt
                         `1fr 30rem`, nichts wurde rot, die Bühne sah nur aus wie vorher.
                         Gemessen am 2026-08-23, deshalb steht es hier. --}}
                    <div @class(['forge-buehne' => ! $native])>
                    <div @class(['forge-raster' => ! $native])>

                    {{-- Ladezustand: SERVER-gerendert per @for, NICHT x-if — der Inhalt
                         eines `x-if`-Templates existiert vor dem Alpine-Boot gar nicht
                         im DOM, die Fläche bliebe bis dahin weiß. --}}
                    {{-- `tab !== 'workspaces'`: der vierte Tab liest eine ANDERE
                         Datenschicht (NIP-29-Raumsicht statt 30617/30618) und bringt
                         seinen eigenen Ladezustand mit. Ohne diesen Ausschluss stünden
                         beim Öffnen eines kalten `/forge?tab=workspaces` das
                         Forge-Skelett UND die Raumliste gleichzeitig da — ein Skelett
                         für Daten, auf die diese Fläche gar nicht wartet. --}}
                    <div x-show="(zweispaltig || tab !== 'workspaces') && loading && isEmpty()" class="forge-voll surface-card px-4">
                        @for ($i = 0; $i < 4; $i++)
                            {{-- Formgleich zur fertigen Ref-Spur: gleicher Avatar-Ort,
                                 gleiche Zeilenhöhe. Ein Skelett, das anders gebaut ist
                                 als das Ergebnis, lässt die Liste beim Eintreffen der
                                 Daten springen. --}}
                            <div class="flex gap-3 py-3">
                                <div class="skeleton size-7 shrink-0 rounded-full"></div>
                                <div class="min-w-0 flex-1 space-y-2">
                                    <div class="skeleton h-3.5 w-2/3"></div>
                                    <div class="skeleton h-3 w-1/3"></div>
                                </div>
                            </div>
                        @endfor
                    </div>

                    {{-- ══ SPALTE 1: die drei Listen ═══════════════════════════════════
                         Eine Klammer um Repositories, Issues und Pull Requests — und
                         damit die Stelle, an der der Umschalter EINMAL steht statt
                         dreimal (die Herleitung steht im Partial).

                         Sie bringt nebenbei Bestimmtheit ins Raster: bis hierher
                         entschied das Auto-Placement anhand dessen, welche Sektionen
                         gerade `x-show` durchließ, welches Kind in Spalte 1 landete.
                         Das ging gut, weil immer genau eine der drei Listen sichtbar
                         ist — aber es war eine Eigenschaft der Daten, keine des
                         Layouts. Jetzt ist die Klammer immer da und immer Spalte 1;
                         die Aktivitätsspur ist immer Spalte 2.

                         `min-w-0`, damit die Zeichenspalten der Werkbank die Spur
                         nicht aufreißen, sondern in ihrem eigenen Überlauf bleiben. --}}
                    <div class="min-w-0">
                    @include('group::partials.forge-listen-umschalter')
                    @include('group::partials.forge-ansicht')

                    {{-- ── Die Suche über den Bestand (P5, listenbewusst seit P7b) ──
                         **Rein clientseitig.** Der Bestand liegt ohnehin vollständig
                         im Speicher — `overviewFilters` lädt alle 30617 des Workspace
                         in einem Zug, und `loadForge` die Vorgänge dazu. Eine
                         Relay-Suche wäre ein zusätzlicher Roundtrip für Daten, die
                         schon da sind, und sie könnte WENIGER: NIP-50 durchsucht den
                         indizierten Text, nicht die clone-URL, nicht die
                         Maintainer-Pubkeys und nicht den `euc`. Die Regeln stehen in
                         `js/forgeSearch.ts`.

                         ── Warum das Feld hier steht und nicht mehr in der Repo-Region
                         Seit P7a filtert dieselbe Eingabe auch Issues und Pull Requests
                         (`sucheVorgaenge` in `issueGroups()`/`pullGroups()`). Das Feld
                         stand aber INNERHALB von `data-forge-region="repos"` — einer
                         Sektion, die bei `listeAktiv() !== 'repos'` per `x-show`
                         verschwindet. Die Vorgangssuche war damit gebaut, verdrahtet
                         und **für niemanden erreichbar**; nur die Beschriftung zu
                         korrigieren hätte einen Text repariert, den kein Nutzer je
                         sieht. Gemessen am Markup, nicht vermutet.

                         Das Feld steht NUR da, wenn es etwas zu durchsuchen gibt:
                         ein Suchfeld über einer leeren Liste ist eine Aufforderung
                         ins Nichts. `gesamtAnzahl()` und nicht `overview.repos.length`
                         — die Frage gilt der AKTIVEN Liste. --}}
                    <div x-show="gesamtAnzahl() > 0" class="mb-4 flex items-center gap-2" data-forge-suche>
                        <div class="min-w-0 flex-1">
                            {{-- `aria-label` und nicht nur `placeholder`: ein
                                 Platzhalter ist kein zugänglicher Name, er
                                 verschwindet beim Tippen, und K3 misst genau das.
                                 Dieser Defekt ist in diesem Projekt schon dreimal
                                 behoben worden.

                                 Name UND Platzhalter folgen der aktiven Liste. Ein
                                 Feld, das „Repositories durchsuchen" heisst und
                                 Issues filtert, ist derselbe Fehler in Grün.

                                 `class:input` statt `class`: der Flux-Stub legt
                                 `class` an die HÜLLE. Was ans <input> muss, ist das
                                 Abschalten der browsereigenen Löschtaste von
                                 `type="search"` — sonst stehen zwei Knöpfe
                                 nebeneinander, die dasselbe tun. Gleiche Begründung
                                 wie in `⚡room.blade.php:207`. --}}
                            <flux:input type="search" size="sm" icon="magnifying-glass"
                                        class:input="[&::-webkit-search-cancel-button]:hidden"
                                        x-ref="sucheFeld" x-model="suche"
                                        autocomplete="off" autocorrect="off" spellcheck="false"
                                        data-forge-suche-feld
                                        ::placeholder="sucheHilfe().platzhalter"
                                        ::aria-label="sucheHilfe().name" />
                        </div>
                        {{-- Eigener Leeren-Knopf statt Flux' `clearable`: dessen
                             Beschriftung kommt aus Flux' eigenem Katalog („Clear
                             input") und liegt ausserhalb unserer Sprachdateien —
                             ein englisches Label mitten in einer deutschen Fläche.
                             Dieselbe Entscheidung wie im Raum. --}}
                        <flux:button size="sm" variant="ghost" icon="backspace" square class="icon-btn-touch shrink-0"
                                     x-show="suche !== ''" x-cloak
                                     x-on:click="sucheLoeschen(); $refs.sucheFeld?.focus()"
                                     data-forge-suche-leeren
                                     aria-label="{{ __('Eingabe leeren') }}" />
                    </div>

                    {{-- Die Grenze der Suche, sobald eine läuft. `role="status"`
                         meldet sie dem Screenreader, sobald sich die Zahl ändert —
                         sonst filterte die Liste lautlos.

                         „:count von :total" und nicht „:count Treffer": die
                         Gesamtzahl bleibt im Bild, damit niemand die gefilterte
                         Liste für den Bestand des Workspace hält. Das Substantiv
                         folgt der aktiven Liste — `sichtbareAnzahl()` und
                         `gesamtAnzahl()` zählen sie ohnehin schon. --}}
                    <p x-show="suche.trim() !== '' && gesamtAnzahl() > 0" x-cloak
                       role="status" class="mb-2 px-1 text-xs text-muted" data-forge-suche-zahl
                       x-text="sucheHilfe().zahl.split(':count').join($num(sichtbareAnzahl())).split(':total').join($num(gesamtAnzahl()))"></p>

                    {{-- Null Treffer ist eine eigene Aussage, kein leerer Kasten.
                         Sie nennt auch, WORÜBER gesucht wurde — sonst rät der
                         Leser, warum sein Begriff nicht zieht.

                         Steht ebenfalls ausserhalb der Regionen: bis P7b zeigte
                         eine erfolglose Issue-Suche den GENERISCHEN Leerzustand
                         („Noch keine Issues.") und behauptete damit etwas über den
                         Workspace, was nur über die Suche galt. --}}
                    <template x-if="ohneTreffer()">
                        <div class="surface-card empty-state px-6 py-10 text-center" data-forge-empty="suche">
                            <span class="mx-auto flex size-12 items-center justify-center rounded-tile bg-zinc-100 dark:bg-zinc-800">
                                <flux:icon.magnifying-glass class="size-6 text-zinc-500 dark:text-zinc-400" />
                            </span>
                            <flux:heading size="lg" class="mt-4" x-text="sucheHilfe().leer"></flux:heading>
                            <flux:text class="mx-auto mt-1 max-w-sm text-sm text-muted" x-text="sucheHilfe().felder"></flux:text>
                            <flux:button size="sm" variant="ghost" class="mt-4" x-on:click="sucheLoeschen()">{{ __('Suche zurücksetzen') }}</flux:button>
                        </div>
                    </template>


                    {{-- ── Repositories ────────────────────────────────────────────── --}}
                    {{-- `listeAktiv()` kam mit P3 dazu: die linke Spur trägt jetzt DREI
                         Listen. In der Tab-Form entscheidet `tab` allein; in der
                         zweispaltigen zeigt sie bei `tab === 'activity'` (dem Startwert)
                         weiter die Repos — genau wie vor P3. Ein eigener Zustand für die
                         Auswahl wäre eine zweite Wahrheit neben dem Tab. --}}
                    <section x-show="(zweispaltig || tab === 'repos') && listeAktiv() === 'repos' && !(loading && isEmpty())" x-cloak
                             id="forge-werkbank" class="forge-werkbank scroll-mt-6" data-forge-region="repos">
                        {{-- Sichtbar nur in der zweispaltigen Form — in der Tab-Form sagt
                             der Tab bereits, was man sieht. Für Screenreader steht sie in
                             BEIDEN Formen im DOM (siehe `.forge-regionstitel`).
                             `tabindex="-1"`: Ziel des `?tab=`-Sprungs, nicht des Tab-Laufs. --}}
                        <h2 class="forge-regionstitel" tabindex="-1" data-forge-region-titel>{{ __('Repositories') }}</h2>
                        {{-- ── Gerettet aus dem entfallenen Projekte-Tab (2026-08-23) ──────
                             Diese Zeile war die EINZIGE Stelle im ganzen Paket, die eine
                             Projekt-Koordinate ohne zugehöriges 30617 benennt. Der
                             Rail-Baum verschluckt sie (`railForge.ts`: ein Projekt ohne
                             eigene Repos wird übersprungen) — mit dem Tab wäre die Auskunft
                             ersatzlos verschwunden, und niemand wüsste mehr, dass das Relay
                             unvollständig ist.

                             Sie steht jetzt hier, weil sie eine Aussage über den
                             REPOSITORY-Bestand ist: „es gibt Repositories, die hierher
                             gehören und die du nicht siehst". Über alle Projekte summiert
                             statt je Projekt aufgeführt — die Projekte selbst haben auf
                             dieser Fläche keinen Ort mehr, die Zahl schon.

                             `overview.projects` bleibt geladen (die Rail liest es ab `xl`),
                             die Summe kostet also keine zusätzliche Anfrage. --}}
                        <template x-if="overview.projects.reduce((n, p) => n + p.missingAddresses.length, 0) > 0">
                            <flux:callout variant="secondary" icon="information-circle" class="forge-mass mb-4" data-forge-fehlende-projekt-repos>
                                <flux:callout.text
                                    x-text="$plural(overview.projects.reduce((n, p) => n + p.missingAddresses.length, 0), '1 Repository eines Projekts liegt nicht auf diesem Relay.', ':count Repositories von Projekten liegen nicht auf diesem Relay.')"></flux:callout.text>
                            </flux:callout>
                        </template>

                        <template x-if="overview.repos.length === 0">
                            <div class="surface-card empty-state px-6 py-12 text-center" data-forge-empty="repos">
                                <span class="mx-auto flex size-12 items-center justify-center rounded-tile bg-zinc-100 dark:bg-zinc-800">
                                    <flux:icon.code-bracket class="size-6 text-zinc-500 dark:text-zinc-400" />
                                </span>
                                <flux:heading size="lg" class="mt-4">{{ __('Noch keine Repositories.') }}</flux:heading>
                                <flux:text class="mx-auto mt-1 max-w-sm text-sm text-muted">{{ __('Sobald jemand ein Repository ankündigt, erscheint es hier.') }}</flux:text>
                            </div>
                        </template>

                        {{-- ── Die Werkbank: das Zustandsboard ────────────────────────
                             Bis zu einer Werkbankbreite von 48 rem ist das dieselbe
                             gestapelte Zeile wie auf dem Telefon; darüber wird sie zur
                             ZEICHENSPALTEN-Zeile. Ein Markup, zwei Formen — die
                             Umschaltung steht in `theme.css` unter
                             `@container werkbank`, samt der Rechnung, warum 48 rem und
                             nicht weniger.

                             ── Die Signatur dieser Fläche ──────────────────────────────
                             Die Spalten sind in `ch` deklariert, nicht in Pixeln, und
                             das ist hier keine Spielerei: `--font-sans` ist Inconsolata,
                             eine Zellenschrift (gemessen exakt 7,00 px je Glyphe bei
                             14 px). `ch` IST damit die Zelle. Refs, Zähler und Namen
                             stehen dadurch untereinander wie in einem `git status` über
                             den ganzen Workspace — ohne `<table>`, ohne `tabular-nums`
                             und ohne eine zweite Schriftfamilie (die es hier auch nicht
                             geben darf). KORRIGIERT 2026-08-26: hier stand,
                             `--font-mono` sei „nicht definiert" — das ist am
                             GEBAUTEN Stylesheet falsch. Tailwind v4 liefert die
                             Variable selbst mit (`--font-mono: ui-monospace, …`),
                             und `.font-mono{font-family:var(--font-mono)}` greift.
                             Das Haus überschreibt nur `--font-sans`. Die Regel
                             bleibt also dieselbe — aber aus dem umgekehrten Grund:
                             `font-mono` zöge eine fremde Schrift ein, WEIL die
                             Variable definiert ist.

                             KEIN `subgrid`: die Spaltenbreiten sind feste Zeichenmaße,
                             also fluchten unabhängige Zeilen ohnehin. `subgrid` legt bei
                             abweichender Kinderzahl lautlos ein Kind auf ein anderes —
                             ein Risiko ohne Gegenwert.

                             ── Die Zahlen und ihre Wörter ──────────────────────────────
                             Gestapelt steht „12 Issues" als ganzer Text da. In der
                             Spaltenform trägt die Spaltenüberschrift das Wort, in der
                             Zelle steht die nackte Ziffer — und das Wort bleibt als
                             `sr-only` erhalten. Ein Screenreader liest also in BEIDEN
                             Formen „12 Issues" und nie „12 3 4". Umgeschaltet wird das
                             in CSS (`.forge-zahl` / `.forge-wort`), nicht im DOM: doppelt
                             vorgehaltener Text wäre zwei Stellen für dieselbe Aussage. --}}
                        {{-- `sichtbareRepos()` und nicht `overview.repos`: die Suche
                             filtert beim LESEN. Bleibt nichts übrig, tritt der
                             Leerzustand der Suche an die Stelle der Tabelle — eine
                             Kopfzeile über null Zeilen wäre eine Tabelle, die
                             Spalten verspricht und keine hat. --}}
                        <div x-show="sichtbareRepos().length > 0" class="surface-card">
                            {{-- Die Spaltenüberschriften. `aria-hidden`, weil jede Zelle
                                 ihr Wort selbst mitbringt — sonst läse ein Screenreader
                                 die Beschriftung zweimal. Sie sind Orientierung fürs
                                 Auge, keine Tabellensemantik: das hier ist eine LISTE
                                 von Links, keine Datentabelle, und `role="table"` würde
                                 eine Navigation versprechen, die es nicht gibt. --}}
                            {{-- ── Derselbe Kopfstreifen wie die anderen Karten (P5) ─────
                                 `forge-kartenstreifen` gibt ihm Fläche und oberen Radius
                                 der Karte — dieselbe Bauform wie `.forge-kartenkopf` an
                                 der Vorgangsliste und `.forge-diff-kopf` am Diff. Was er
                                 NICHT übernimmt, ist deren Flex-Layout: dieser Kopf ist
                                 ein SPALTENkopf und trägt die `ch`-Spuren
                                 (`.forge-kopfzeile`, `30ch 62ch`). Ein `display: flex`
                                 darüber hätte die Fluchtlinie zerstört, die
                                 `desktop-forge.spec.ts` bewacht.

                                 Deshalb sind es zwei Klassen und nicht eine: die eine
                                 sagt „ich bin ein Kartenkopf", die andere „ich bin ein
                                 Spaltenraster". --}}
                            <div class="forge-kopfzeile forge-kartenstreifen border-b border-zinc-200 px-4 py-2 dark:border-zinc-800" aria-hidden="true">
                                {{-- Die erste Spur (Glyphe) und die Namensspur bleiben LEER:
                                     der Regionstitel „Repositories" steht zwei Zeilen
                                     höher, ein Spaltenkopf „REPOSITORY" darunter wäre
                                     dasselbe Wort ein drittes Mal (Zustandszeile,
                                     Regionstitel, Spaltenkopf). Beschriftet wird nur, was
                                     ohne Beschriftung mehrdeutig ist — die Zahlen. --}}
                                <span></span>
                                <span></span>
                                <span></span>
                                {{-- ── Die Schriftgröße gehört an die KINDER, nicht an das Raster ──
                                     `ch` löst gegen die EIGENE Schriftgröße des Elements auf.
                                     Stand `text-[0.7rem]` hier an `.forge-daten`, rechnete
                                     dieselbe Spur `16ch` gegen 11,2 px statt gegen 14 px — die
                                     Kopfzeile war schmaler als die Zellen darunter, und die
                                     Spalten standen um 56 px versetzt. Am Bildschirm gesehen,
                                     von keiner Zusage gefangen; deshalb bewacht
                                     `desktop-forge.spec.ts` jetzt die Fluchtlinie. --}}
                                <span class="forge-daten font-semibold uppercase tracking-wider text-muted">
                                    {{-- „Branch" und nicht „Ref": die Zelle zeigt den HEAD des
                                         Repositories, und das Haus übersetzt „Branches" seit je
                                         in jede der sieben Sprachen (Ramas · Ramos · Gałęzie ·
                                         Ágak · Zari). Ein untranslatiertes „Ref" wäre der
                                         einzige Spaltenkopf, der nur Englischsprachige lesen. --}}
                                    <span class="text-xs">{{ __('Branch') }}</span>
                                    <span class="forge-zelle-zahl text-xs">{{ __('Issues') }}</span>
                                    <span class="forge-zelle-zahl text-xs">{{ __('PRs') }}</span>
                                    <span class="forge-zelle-zahl text-xs">{{ __('Maintainer') }}</span>
                                </span>
                            </div>

                            <template x-for="repo in sichtbareRepos()" :key="repo.address">
                                {{-- GANZE Zeile = ein Link (keine verschachtelten Links) —
                                     dieselbe Regel wie `room-tile` und die Artikelkarte.

                                     ── KEIN `flux:table`, und das ist GEMESSEN ────────────────
                                     Der Plan sah für die Desktop-Fassung dieser Liste
                                     `flux:table` mit `x-slot:header` vor. Die Komponente
                                     rendert `<table><tbody><tr><td>` — und ein `<a>`, das eine
                                     ganze Tabellenzeile umschliesst, überlebt das PARSEN nicht.
                                     Am echten Parser nachgemessen
                                     (`p5-fluxtable-sonden.log`, Sonde A):

                                       <a><tr>  → A landet als LEERES Geschwister neben der
                                                  Tabelle (`DIV > A`), die Zeile darunter
                                                  (`DIV > TABLE > TBODY > TR`). `tr.closest('a')`
                                                  ist danach **null**.
                                       <button><tr> → dasselbe Bild.
                                       <a><li>  → **bleibt** verschachtelt (Positivkontrolle im
                                                  selben Lauf; ohne sie misst die Sonde sich
                                                  selbst).

                                     Das ist kein Flux-Mangel, sondern das Foster-Parenting des
                                     HTML-Parsers. Die Folge wäre nicht „sieht anders aus",
                                     sondern: die Zeile ist kein Bedienelement mehr — lautlos.
                                     Ersatz wäre ein Link je Zelle (vier Ziele für dasselbe
                                     Repo) oder ein Link in der Namenszelle mit einer
                                     aufgespannten Überlagerung; beides tauscht ein sauberes
                                     Bedienelement gegen eine Attrappe.

                                     Dazu käme eine ZWEITE Fassung im selben Baum (mobil
                                     gestapelt, Desktop Tabelle), weil `flux:table`
                                     `whitespace-nowrap` und `overflow-auto` einbackt und mobil
                                     die Überlauf-Zusage bräche. Gemessen (Sonde B): eine
                                     zweite, versteckte Fassung verdoppelt `[data-forge-repo]`
                                     von **6 auf 12**. Ehrlich dazu, weil es die Ablehnung
                                     schwächt: `.filter({hasText})` und `.click()` überstehen
                                     das (gemessen 1 bzw. „kein Fehler") — die rohe Zählung
                                     nicht. Und P3 hat für genau diese Frage schon entschieden:
                                     **ein DOM, zwei ausgezeichnete Bilder.**

                                     Was `flux:table` an dieser Stelle KÖNNEN sollte — Kopf im
                                     selben Rahmen, eine Haarlinie darunter — leistet
                                     `.forge-kartenstreifen` (Kopf) und `.forge-zeile` (Raster),
                                     ohne Tabellensemantik zu behaupten, die diese Liste nicht
                                     hat. Die Ablehnung steht hier und nicht nur im Plan, damit
                                     der nächste Leser sie am Gegenstand findet. --}}
                                <a :href="repoHref(repo) || null" wire:navigate data-forge-repo :data-naddr="repo.naddr"
                                   class="forge-zeile pressable group border-b border-zinc-200 p-4 transition-colors last:border-b-0 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/60">
                                    <span class="forge-glyphe flex size-9 shrink-0 items-center justify-center rounded-tile bg-brand-500/10 text-brand-800 dark:text-brand-300">
                                        <flux:icon.code-bracket class="size-5" />
                                    </span>
                                    <div class="forge-text min-w-0">
                                        {{-- ── Der Aktivitätsbalken (P6, Schritt 25) ──────────────
                                             **Er steht auf der NAMENSZEILE und nicht in einer
                                             eigenen Datenspalte, und das ist gerechnet.** Eine
                                             fünfte Spalte hätte die Zeile bei 48 rem (der
                                             Schwelle, ab der es die Spaltenform überhaupt gibt)
                                             auf 32 Zeichen für Name UND Beschreibung gedrückt —
                                             der Lesekanon beginnt bei 45. Eine Zahl, die einen
                                             Fliesstext unter sein Maß drückt, ist zu teuer.
                                             Hier kostet sie nur die NAMENSZEILE etwas, und ein
                                             Name ist eine Beschriftung, kein Fliesstext.

                                             Nebenbei löst der Ort das Problem, an dem die
                                             Maintainer-Ziffer krankte: die Datenspalten gibt es
                                             erst ab ~1624 px Fensterbreite, die Textzelle
                                             IMMER. Der Balken steht damit auch auf dem Telefon.

                                             Rechtsbündig, damit alle Balken derselben Kante
                                             folgen — sonst gäbe es nichts zu vergleichen, und
                                             ein Vergleichsbild ohne gemeinsame Grundlinie ist
                                             Dekoration.

                                             Kein Balken bei nur EINEM aktiven Repository
                                             (`overview.aktivitaetsbalken`): er wäre immer voll.
                                             Und kein Balken bei 0 Ereignissen — dort steht die
                                             Zeile ruhig, statt eine leere Schiene zu zeigen. --}}
                                        <p class="flex items-baseline gap-3 leading-snug">
                                            <span class="min-w-0 flex-1 text-base font-semibold" x-text="repo.name"></span>
                                            <template x-if="overview.aktivitaetsbalken && repo.activityCount > 0">
                                                {{-- Die Zahl trägt die Aussage, der Balken zeigt
                                                     sie (WCAG 1.4.1). `aria-hidden` an der
                                                     Schiene: die Sprachausgabe hört den ganzen
                                                     Satz aus dem `sr-only`-Text daneben, nicht
                                                     „Grafik". --}}
                                                <span class="flex shrink-0 items-center gap-1.5 text-xs text-muted">
                                                    <span aria-hidden="true" class="forge-balken" data-forge-balken
                                                          :data-anteil="Math.round(repo.activityShare * 100)">
                                                        <span class="forge-balken-fuellung"
                                                              :style="'width:' + Math.max(4, Math.round(repo.activityShare * 100)) + '%'"></span>
                                                    </span>
                                                    <span aria-hidden="true" x-text="$num(repo.activityCount)"></span>
                                                    <span class="sr-only"
                                                          x-text="$plural(repo.activityCount, '1 Ereignis in den letzten 30 Tagen', ':count Ereignisse in den letzten 30 Tagen')"></span>
                                                </span>
                                            </template>
                                        </p>
                                        {{-- `forge-mass` deckelt bei 62 Zeichen. Ohne ihn
                                             maß diese Zeile bei 1920 px 1422 px = 203
                                             Zeichen; der Lesekanon endet bei 75. --}}
                                        <p class="forge-mass mt-1 line-clamp-2 text-sm text-muted" x-text="repo.description"></p>
                                    </div>
                                    <span class="forge-rinne" aria-hidden="true"></span>
                                    <span class="forge-daten text-xs text-muted">
                                        {{-- Der Ref trägt als einziges Element hier die
                                             Markenfarbe: er ist die Kennung des
                                             Repositories, die Zählungen sind Beiwerk.
                                             Gemessen brand-800 auf brand-500/10 = 5,92:1
                                             hell, brand-300 auf zinc-900 = 9,56:1 dunkel —
                                             das alte brand-700 lag bei 4,05:1 und riss
                                             damit WCAG 1.4.3.

                                             Die Zelle steht IMMER da, auch ohne 30618:
                                             in einer Spaltenform ist eine fehlende Zelle
                                             ein Loch, das die Spalten verschiebt. Ohne Ref
                                             steht ein Gedankenstrich — und für den
                                             Screenreader das ausgeschriebene „kein Ref
                                             bekannt", denn ein „–" allein ist keine
                                             Auskunft. --}}
                                        {{-- ── Hier bleibt es HANDARBEIT, und das ist gerechnet ──
                                             Für einen Chip gibt es `flux:badge`, und an drei
                                             anderen Stellen dieser Datei steht er jetzt auch.
                                             NICHT hier: diese Pille steht in `forge-daten`,
                                             und deren Spalten sind in `ch` deklariert
                                             (`theme.css`, `.forge-daten`) — sie fluchten ohne
                                             `<table>` und ohne `subgrid`, weil jede Zelle
                                             dieselbe Schriftgröße hat. `flux:badge` setzt
                                             `text-sm` (bzw. `text-xs` bei `size="sm"`) selbst
                                             und überschriebe damit die 12 px der Datenspalte;
                                             die Fluchtlinie, die `desktop-forge.spec.ts` als
                                             Zusage hält, hinge dann an einer Zahl aus einem
                                             Vendor-Stub. Der Chip trägt deshalb weiter nur
                                             Fläche und Radius, keine eigene Schriftgröße. --}}
                                        <span class="min-w-0 truncate">
                                            <template x-if="repo.state && repo.state.head">
                                                <span class="inline-flex max-w-full items-center gap-1 truncate rounded-pill bg-brand-500/10 px-1.5 py-0.5 font-semibold text-brand-800 dark:text-brand-300">
                                                    <flux:icon.code-bracket-square variant="micro" aria-hidden="true" class="size-3.5 shrink-0" />
                                                    <span class="truncate" x-text="repo.state.head"></span>
                                                </span>
                                            </template>
                                            <template x-if="!(repo.state && repo.state.head)">
                                                <span>
                                                    <span aria-hidden="true">&ndash;</span>
                                                    <span class="sr-only">{{ __('Kein Branch-Zustand bekannt') }}</span>
                                                </span>
                                            </template>
                                        </span>
                                        <span class="forge-zelle-zahl">
                                            <span class="forge-zahl font-semibold text-zinc-900 dark:text-zinc-100" aria-hidden="true" x-text="repo.issueCount"></span>
                                            <span class="forge-wort" x-text="$plural(repo.issueCount, '1 Issue', ':count Issues')"></span>
                                        </span>
                                        <span class="forge-zelle-zahl">
                                            <span class="forge-zahl font-semibold text-zinc-900 dark:text-zinc-100" aria-hidden="true" x-text="repo.pullRequestCount"></span>
                                            <span class="forge-wort" x-text="$plural(repo.pullRequestCount, '1 Pull Request', ':count Pull Requests')"></span>
                                        </span>
                                        {{-- ── Gesichter statt Ziffer (P6, Schritt 24) ────────
                                             Die Daten lagen die ganze Zeit vollständig vor —
                                             `RepoRow.people` trägt Schlüssel, Namen und Bild —,
                                             gerendert wurde davon nur `.length`. Und das auch
                                             nur in der Spaltenform, also oberhalb ~1624 px
                                             Fensterbreite; auf jedem Telefon stand statt der
                                             Zahl das Wort und sonst nichts.

                                             Der Stapel steht jetzt in BEIDEN Formen, und der
                                             Satz („3 Maintainer") wird zum `sr-only`-Namen der
                                             Zelle statt zu einer zweiten sichtbaren Fassung
                                             derselben Auskunft. Damit entfällt hier das
                                             `forge-zahl`/`forge-wort`-Paar — die beiden anderen
                                             Zellen behalten es, sie zeigen echte Zahlen.

                                             `peopleOf` ist der EINE Auflösungsweg (kein zweiter
                                             gebaut): ein Schlüssel ohne bekanntes Profil fällt
                                             dort auf die gekürzte npub-Form zurück, und der
                                             Avatar bildet seine Initiale daraus. Das ist die
                                             bewusste Rückfallebene, kein Defekt.

                                             Drei Gesichter, dann eine Zahl: bei zwölf
                                             Maintainern sind zwölf 20-px-Kreise in einer
                                             84-px-Zelle nicht mehr Personen, sondern Textur. --}}
                                        <span class="forge-zelle-zahl">
                                            <span class="forge-stapel" aria-hidden="true">
                                                <template x-for="person in repo.people.slice(0, 3)" :key="person.pubkey">
                                                    <span class="forge-stapel-platz" :title="person.name">
                                                        <x-group::nostr-avatar picture="person.picture" name="person.name" size="1.25rem" />
                                                    </span>
                                                </template>
                                                <template x-if="repo.people.length > 3">
                                                    <span class="ms-1 text-xs font-semibold text-muted"
                                                          x-text="'+' + (repo.people.length - 3)"></span>
                                                </template>
                                                <template x-if="repo.people.length === 0">
                                                    <span class="text-muted">&ndash;</span>
                                                </template>
                                            </span>
                                            {{-- `forge-wort` und NICHT `sr-only`: die Klasse ist in
                                                 der gestapelten Form sichtbar und in der Spaltenform
                                                 visuell versteckt, aber im Vorlesebaum (siehe
                                                 `theme.css` — sie wird dort NICHT `display:none`,
                                                 sondern auf 1 px geklemmt). Damit steht neben dem
                                                 Gesicht auf dem Telefon das Wort „1 Maintainer",
                                                 während in der Spaltenform der Spaltenkopf es schon
                                                 sagt — und die Sprachausgabe hört es in BEIDEN Formen
                                                 genau einmal. Ein zusätzliches `sr-only` daneben
                                                 hätte es in der gestapelten Form doppelt vorgelesen. --}}
                                            <span class="forge-wort" x-text="$plural(repo.people.length, '1 Maintainer', ':count Maintainer')"></span>
                                        </span>
                                    </span>
                                </a>
                            </template>
                        </div>
                    </section>

                    {{-- ── Issues, workspace-weit (P3) ─────────────────────────────
                         Die inhaltlich grösste Lücke vor P3: „was liegt insgesamt
                         offen?" war nur repo-für-repo beantwortbar. Die Antwort lag
                         die ganze Zeit im Speicher — `loadForge` lädt die Vorgänge
                         ALLER Repos, gezählt wurden sie schon, gezeigt nicht. --}}
                    <section x-show="(zweispaltig || tab === 'issues') && listeAktiv() === 'issues' && !(loading && isEmpty())" x-cloak
                             id="forge-issues" class="forge-werkbank scroll-mt-6" data-forge-region="issues">
                        <h2 class="forge-regionstitel" tabindex="-1" data-forge-region-titel>{{ __('Issues') }}</h2>
                        @include('group::partials.forge-vorgangsliste', [
                            'art' => 'issues',
                            'quelle' => 'issueGroups()',
                            'leerTitel' => __('Noch keine Issues.'),
                            'leerText' => __('Sobald jemand in einem Repository dieses Workspace ein Issue eröffnet, erscheint es hier.'),
                        ])
                    </section>

                    {{-- ── Pull Requests, workspace-weit (P3) ──────────────────────── --}}
                    <section x-show="(zweispaltig || tab === 'pulls') && listeAktiv() === 'pulls' && !(loading && isEmpty())" x-cloak
                             id="forge-pulls" class="forge-werkbank scroll-mt-6" data-forge-region="pulls">
                        <h2 class="forge-regionstitel" tabindex="-1" data-forge-region-titel>{{ __('Pull Requests') }}</h2>
                        @include('group::partials.forge-vorgangsliste', [
                            'art' => 'pulls',
                            'quelle' => 'pullGroups()',
                            'leerTitel' => __('Noch keine Pull Requests.'),
                            'leerText' => __('Ein Pull Request entsteht beim Pushen eines Branches — dieser Client kann keinen anlegen.'),
                        ])
                    </section>
                    </div>{{-- /Spalte 1 --}}

                    {{-- ── Aktivität ───────────────────────────────────────────────
                         Jede Zeile ist ein SATZ: wer, was, woran — und rechts das
                         Ergebnis (Commit-Kurzhash oder Statuswort). Das folgt Buzz'
                         eigener Leitlinie „Verb, Objekt, Ergebnis" und ist der Grund,
                         warum hier kein Kind und keine Event-Id steht. --}}
                    <section x-show="(zweispaltig || tab === 'activity') && !(loading && isEmpty())" x-cloak
                             id="forge-spur" class="scroll-mt-6" data-forge-region="activity">
                        <h2 class="forge-regionstitel" tabindex="-1" data-forge-region-titel>{{ __('Aktivität') }}</h2>
                        <template x-if="overview.activityGroups.length === 0">
                            <div class="surface-card empty-state px-6 py-12 text-center" data-forge-empty="activity">
                                <span class="mx-auto flex size-12 items-center justify-center rounded-tile bg-zinc-100 dark:bg-zinc-800">
                                    <flux:icon.clock class="size-6 text-zinc-500 dark:text-zinc-400" />
                                </span>
                                <flux:heading size="lg" class="mt-4">{{ __('Noch keine Aktivität.') }}</flux:heading>
                                <flux:text class="mx-auto mt-1 max-w-sm text-sm text-muted">{{ __('Sobald jemand ein Repository anlegt, etwas pusht oder ein Issue eröffnet, erscheint es hier.') }}</flux:text>
                            </div>
                        </template>

                        {{-- ── Die Ref-Spur ───────────────────────────────────────
                             EINE Karte mit einem durchgehenden Faden statt zehn
                             gestapelter Kärtchen. Zehn gleich große Kästen sind der
                             Grund, warum die Fläche vorher wie ein Datenabzug aussah:
                             sie behaupten zehn gleichrangige Dinge, wo eine Historie
                             gemeint ist. Der Faden bindet die Zeilen zusammen und macht
                             den Avatar-Rhythmus zur linken Spalte.

                             GEOMETRIE, und warum sie ohne `:first-child` auskommt:
                             Alpine hängt die Zeilen eines `x-for` HINTER das
                             `<template>`; das Template bleibt als erstes Kind im DOM.
                             `li:first-child` trifft damit nie eine echte Zeile — und
                             `divide-y` gäbe der ersten sichtbaren Zeile eine Oberkante.
                             Deshalb zeichnet jede Zeile nur das Stück UNTER ihrem
                             Knoten: vom Knotenmittelpunkt (0,75rem Innenabstand +
                             0,875rem halbe Avatarhöhe = 1,625rem) über die volle
                             Zeilenhöhe. Weil jede Zeile denselben Innenabstand hat,
                             endet das Stück exakt im Mittelpunkt des nächsten Knotens.
                             Die letzte Zeile zeichnet nichts — `:last-child` trifft mit
                             `x-for` zuverlässig, im Gegensatz zu `:first-child`.

                             ── Die Tages-Trenner ──────────────────────────────────
                             Dieselbe Bucket-Sprache wie `/updates` (HEUTE · GESTERN ·
                             DIESE WOCHE · ÄLTER), leere Buckets liefert das Modell gar
                             nicht erst aus, und der Titel ist eine echte Überschrift —
                             Screenreader springen damit von Gruppe zu Gruppe.

                             Seit P4 ein <h3> und nicht mehr <h2>: die Spur hat jetzt
                             selbst einen Regionstitel (<h2> „Aktivität", oben). Bliebe
                             der Trenner ein <h2>, stünden Region und Gruppe auf
                             derselben Ebene, und die Gliederung behauptete vier
                             gleichrangige Abschnitte statt einer Region mit vier
                             Gruppen. Kein
                             dekorativer Balken und keine zweite Ordnung: zwei
                             Zeitleisten im selben Produkt dürfen nicht zwei Sprachen
                             sprechen. Der Faden endet an jedem Trenner, weil jede
                             Gruppe ihr eigenes <ol> hat — `group-last:hidden` trifft
                             dort die jeweils letzte Zeile. --}}
                        <div x-show="overview.activityGroups.length > 0" class="surface-card px-4 pb-2">
                            <template x-for="bucket in overview.activityGroups" :key="bucket.label">
                                <section>
                                    <h3 class="pb-1 pt-4 text-xs font-semibold uppercase tracking-wider text-muted"
                                        x-text="bucket.label"></h3>
                                    {{-- ── Die Zeitleiste ist jetzt ein BAUTEIL (P5) ──────────────
                                         Hier stand eine handgezogene Linie:
                                         `absolute start-[0.875rem] top-[1.625rem] h-full w-px`.
                                         Zwei Magic Numbers, die den halben Avatar und den
                                         Innenabstand nachrechneten — sie mussten bei jeder
                                         Änderung der Avatargröße mitgepflegt werden, und
                                         gemessen trug die Linie 1,26:1.

                                         `flux:timeline` zieht Leit- und Folgelinie selbst.

                                         ── `status="complete"` ist BEWUSST nicht im Einsatz ───
                                         Der Plan sah es vor: Flux färbt bei
                                         `data-flux-timeline-status=complete` Knoten und Linie in
                                         `bg-accent`, ein Abschluss bekäme also eine Markierung
                                         ohne neue Hausfarbe. Am gebauten Stand angesehen
                                         (`p5-zeitleiste-desktop-complete.png`, Zustand für den
                                         Blick erzwungen) färbt sich die FOLGElinie — das ist das
                                         Stück UNTER dem Knoten. Diese Liste läuft neueste zuerst;
                                         unter einem Knoten stehen die ÄLTEREN Ereignisse. Die
                                         Tönung behauptet damit „ab hier abgeschlossen" über
                                         Zeilen, die mit dem Abschluss nichts zu tun haben.

                                         Eine Zeitleiste mit Fortschritts-Semantik läuft von alt
                                         nach neu; unsere ist ein Journal. Das Zustandswort steht
                                         ohnehin als TEXT in derselben Zeile
                                         (`forge-status-badge`, `wort="immer"`) — es sagt dasselbe
                                         richtig, und ein zweiter Träger wäre nach Rams einer zu
                                         viel.

                                         ── `x-bind:` AUSGESCHRIEBEN, und warum genau hier ─────
                                         Die Hausregel „auf Flux-Komponenten bindet man mit
                                         `::`" gilt für `flux:timeline` NICHT. Gemessen am
                                         Compiler (`Blade::compileString`): Flux FALTET die
                                         meisten Bauteile beim Kompilieren ein, und nur dieser
                                         Faltungs-Pfad wandelt `::attr` in `:attr`.
                                         `flux:badge`, `flux:table`, `flux:tooltip`,
                                         `flux:popover`, `flux:tabs` werden gefaltet —
                                         `flux:timeline*` als einziges NICHT, es bleibt eine
                                         echte Blade-Komponente. Dort landet `::data-type`
                                         wörtlich im HTML und ist ein TOTES Attribut: Alpine
                                         bindet `:` und `x-bind:`, nicht `::`.
                                         Beleg: `p5-bindungsformen.log`. Die E2E-Anker dieser
                                         Zeile (`data-forge-activity`, `data-type`) wären
                                         lautlos verschwunden. --}}
                                    <flux:timeline align="start" class="pb-2">
                                        <template x-for="row in bucket.items" :key="row.id">
                                            {{-- Nebenbefund für den nächsten, der hier bindet:
                                                 `status` ist ein PHP-Prop und damit Compile-Zeit.
                                                 Ein Laufzeitwert muss `data-flux-timeline-status`
                                                 DIREKT binden — Flux' CSS hängt ohnehin am
                                                 Attribut, nicht am Prop. --}}
                                            <flux:timeline.item data-forge-activity
                                                                x-bind:data-type="row.type">
                                                {{-- ── Der Knoten: Avatar auf Desktop, Punkt mobil ──
                                                     28-px-Avatar plus 12-px-Rinne kosten mobil 40 px
                                                     von rund 330 px Textbreite. Auf Desktop ist „wer"
                                                     die schnellere Frage als „was" und der Avatar
                                                     bleibt der Knoten; mobil trägt der Name im Satz
                                                     dieselbe Auskunft, und der Platz gehört dem Text.

                                                     `zweispaltig` ist die CHASSIS-Schwelle, nicht die
                                                     Geometrie: hier wechselt nicht ein Maß, sondern
                                                     das gezeigte DING. Die Hausregel („Geometrie über
                                                     Container-Queries") ist damit nicht verletzt,
                                                     sondern nicht berührt. --}}
                                                <flux:timeline.indicator variant="bare">
                                                    <template x-if="zweispaltig">
                                                        {{-- Der Ring markiert Ereignisse, die ein echtes
                                                             Git-Objekt erzeugt haben; dieselbe Aussage
                                                             trägt der Kurzhash als TEXT in der Metazeile.
                                                             Die deckende Unterlage von früher entfällt:
                                                             die Linie hört jetzt am Knoten auf, statt
                                                             hinter ihm durchzulaufen. --}}
                                                        <span class="block rounded-full"
                                                              x-bind:class="row.badge ? 'ring-2 ring-brand-700 dark:ring-brand-500' : ''">
                                                            <x-group::nostr-avatar picture="row.actorPicture" name="row.actorName" size="1.75rem" />
                                                        </span>
                                                    </template>
                                                    <template x-if="!zweispaltig">
                                                        <span class="block size-2 rounded-full bg-zinc-300 dark:bg-zinc-600"
                                                              x-bind:class="row.badge ? 'ring-2 ring-brand-700 dark:ring-brand-500' : ''"></span>
                                                    </template>
                                                </flux:timeline.indicator>
                                                <flux:timeline.content class="min-w-0 py-3">
                                                <p class="text-sm leading-snug">
                                                    {{-- Der ROHE Schlüssel im `title` (F6, 2026-08-24).
                                                         Ein Anzeigename stammt aus einem kind 0, das
                                                         jeder für sich selbst schreibt: „kein Profil
                                                         bekannt" und „Profil behauptet, ich sei X" sind
                                                         am Text nicht zu unterscheiden. Die Chips im
                                                         Vorgangsband tragen den Schlüssel längst
                                                         (`:title`), die Zeitleistenzeile trug ihn nicht
                                                         — wer nachsehen will, konnte es hier als
                                                         einziger Stelle nicht.
                                                         `x-bind:title` ausgeschrieben: auf normalem HTML
                                                         ist die Blade-Kurzform kein Binding. --}}
                                                    <span class="font-semibold" x-text="row.actorName"
                                                          x-bind:title="row.actor"></span>
                                                    <span class="text-muted" x-text="' ' + row.verb + ' '"></span>
                                                    <span class="font-medium" x-text="row.object"></span>
                                                </p>
                                                {{-- Kurzhash und Statuswort stehen HIER und nicht
                                                     mehr rechts in der Zeile. Als Flex-Geschwister
                                                     des Satzes schnitten sie ihm auf schmalen
                                                     Fenstern die Breite ab und standen mitten im
                                                     Satzbau („hat einen [ca1c707] Pull Request
                                                     eröffnet") — bei 360px nachgesehen. In der
                                                     Metazeile sind sie ruhiger Beleg statt
                                                     Blickfang. --}}
                                                {{-- ── `<div>` und nicht mehr `<p>` ──────────────────
                                                     Diese Zeile trägt seit dem Flux-Angleich zwei
                                                     `flux:badge`, und die rendern über
                                                     `flux:button-or-div` ein `<div>`
                                                     (`flux/button-or-div.blade.php` — ein `<span>`
                                                     gibt es dort nicht, nur `<div>` oder, mit
                                                     `as="button"`, `<button>`). Ein `<div>` in einem
                                                     `<p>` ist kein Stilfehler, sondern ein PARSE-
                                                     Fehler: der Parser schließt das `<p>` vor dem
                                                     `<div>`, und alles danach fällt aus dem
                                                     Flex-Kasten heraus. Also trägt die Zeile jetzt
                                                     ein `<div>` — es ist ohnehin eine Metazeile aus
                                                     Marken, kein Absatz Fließtext, und weder `<p>`
                                                     noch `<div>` bringen eine Rolle mit. --}}
                                                <div class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
                                                    {{-- KURZ in der Zeile („vor 3 Std"), VOLL im
                                                         Tooltip. Der Trenner über der Gruppe sagt
                                                         bereits, welcher Tag gemeint ist; ein
                                                         zweiter absoluter Zeitstempel je Zeile
                                                         wiederholte ihn nur — zwanzig Mal dieselbe
                                                         Jahreszahl untereinander. Wer die Minute
                                                         braucht, bekommt sie über `title`.
                                                         `x-bind:title` ausgeschrieben: auf normalem
                                                         HTML ist die Blade-Kurzform kein Binding. --}}
                                                    {{-- `data-forge-zeit` (P6): der Prüfstand griff
                                                         bis hierher auf „das erste `span[title]` der
                                                         Zeile" — und das ist seit dem P1-Nachzug der
                                                         Personen-Chip mit dem ROHEN Schlüssel im
                                                         `title`, nicht die Zeit. Ein Anker, der die
                                                         Position beschreibt statt der Sache, wandert
                                                         mit dem nächsten Einschub weiter. --}}
                                                    <span data-forge-zeit x-text="row.timeLabel" x-bind:title="row.fullLabel"></span>
                                                    {{-- Der Repo-Name steht nur, wo er sich ÄNDERT
                                                         (`showRepoName` aus `groupTimeline`) — und
                                                         nach jedem Trenner wieder. In einer Liste,
                                                         die zehnmal dasselbe Repo betrifft, ist die
                                                         Wiederholung kein Kontext, sondern Rauschen;
                                                         der Wechsel dagegen ist genau die
                                                         Information, die man sucht. --}}
                                                    <template x-if="row.showRepoName">
                                                        <span><span aria-hidden="true">·</span> <span x-text="row.repoName"></span></span>
                                                    </template>
                                                    {{-- ── Der Repo-Name trägt die Marke — jetzt WIRKLICH ───
                                                         Hier stand `class="bg-brand-500/10 … text-brand-800"` an
                                                         einem `flux:badge` und daneben die Behauptung „5,91:1 hell,
                                                         9,47:1 dunkel". Beide Zahlen waren falsch, und zwar aus
                                                         einem Grund, der nichts mit Rechnen zu tun hat: die Klassen
                                                         kamen nie an.

                                                         Flux setzt seine Default-Farben über dieselben
                                                         Utility-Klassen. Bei gleicher Spezifität entscheidet die
                                                         Quellreihenfolge im GEBAUTEN Stylesheet, und dort steht
                                                         `.bg-zinc-400/15` HINTER `.bg-brand-500/10`. Real gerendert
                                                         und am Bauteil gemessen (Laravel-gerendert, Canvas-Sonde,
                                                         Negativkontrolle im selben Lauf): **#404040 auf #f1f1f1 =
                                                         9,18:1 hell** und **#e5e5e5 auf #4e4e4e = 6,61:1 dunkel** —
                                                         das sind Flux' Graustufen.

                                                         WCAG war damit nie in Gefahr, im Gegenteil. Verloren war
                                                         die MARKE: die Repo-Pille sah aus wie die Zustandspille
                                                         drei Elemente weiter — dieselbe byte-gleiche Chip-Form, die
                                                         P3 in der Vorgangszeile gerade beseitigt hat.

                                                         `.forge-anker` ist die Antwort und schon da: eine
                                                         UNGESCHICHTETE Regel schlägt jede `@layer`, und sie trägt
                                                         genau diese Rolle („der eine getönte Anker in einer grauen
                                                         Zeile"). Gemessen: **5,92:1 hell** (brand-800 auf
                                                         brand-500/10 über Weiß) und **9,61:1 dunkel** (brand-300 auf demselben
                                                         Tint über zinc-900) — beides am gerenderten Bauteil, nicht
                                                         gerechnet. --}}
                                                    <template x-if="row.badge">
                                                        <flux:badge size="sm" class="forge-anker font-semibold tracking-tight"
                                                                    x-text="row.badge" />
                                                    </template>
                                                    {{-- ── Der Zustand: EINE Form für die ganze Forge ───────
                                                         Die Pille stand bis P1 (2026-08-26) nur hier. Sie ist
                                                         jetzt `x-group::forge-status-badge` und trägt denselben
                                                         Zustand in der Issue-, PR-, Patch- und
                                                         Vorgangslistenzeile — dort ersetzt sie den grauen
                                                         Statuspunkt UND das versale Zustandswort. Die
                                                         Begründung für die farblose Bauform steht in der
                                                         Komponente.

                                                         `wort="immer"`: in der Aktivitätsspur bleibt das Wort
                                                         auf jeder Breite sichtbar. Die Spur ist eine Liste von
                                                         SÄTZEN, kein Raster — hier ist der Zustand Teil der
                                                         Aussage und nicht eine Spalte, die mobil in eine eigene
                                                         Zeile umbricht.

                                                         `row.status` ist der rohe Code aus `statusCodeOf()`
                                                         (`forgeActivity.ts:93`), `row.statusLabel` das übersetzte
                                                         Wort — die Fläche rät nichts. --}}
                                                    <template x-if="row.statusLabel">
                                                        <x-group::forge-status-badge status="row.status" label="row.statusLabel" wort="immer" />
                                                    </template>
                                                </div>
                                                {{-- Zweite Zeile: IMMER `x-text`. Der Rumpf ist
                                                     Fremdtext und wird hier nie als HTML
                                                     gebunden — gerendert wird Markdown nur auf
                                                     der Repo-Seite, über den Artikel-Renderer. --}}
                                                <template x-if="row.body">
                                                    <p class="mt-1 line-clamp-2 text-sm text-zinc-700 dark:text-zinc-300" x-text="row.body"></p>
                                                </template>
                                                </flux:timeline.content>
                                            </flux:timeline.item>
                                        </template>
                                    </flux:timeline>
                                </section>
                            </template>
                        </div>
                    </section>

                    {{-- ── Workspaces: die Kanäle des Workspace-Relays (P5) ────────────
                         Wortgleich aus `⚡spaces.blade.php` hierher gezogen; geändert
                         sind nur die Feldnamen (die Insel heißt jetzt
                         `nostrWorkspaceRooms` und braucht kein `workspace`-Präfix mehr)
                         und zwei `font-mono`, die hier nicht wieder mitwandern: das Theme
                         definiert `--font-mono` gar nicht, jedes `font-mono` zöge also
                         eine zweite Schriftfamilie. Zahlen bekommen `tabular-nums`.

                         `x-show` und nicht `x-if` am Panel: die Insel darunter hält zwei
                         Abos auf das Workspace-Relay. Ein `x-if` baute sie bei jedem
                         Tab-Wechsel neu auf und öffnete sie jedes Mal erneut. Diese Seite
                         spricht ohnehin ausschließlich mit diesem Relay — es gibt nichts
                         zu sparen, nur etwas zu zerbrechen. --}}
                    {{-- `data-forge-workspaces`: der Panel ist ein schlichtes `<div>` und
                         kein `flux:tab.panel` (diese Bar fährt ohne `flux:tab.group`, siehe
                         die Begründung an der Bar). Er trägt deshalb keine `tabpanel`-Rolle,
                         über die ein Test ihn fassen könnte — der Anker steht hier. --}}
                    {{-- Ab `xl` im Web-Host entfällt dieser Panel: die Kanäle stehen im
                         Foren-Zweig des Navigators (`desktop-rail.blade.php:162`,
                         `rail-forge-row.blade.php`, `node.kind === 'forum'`). Zwei Listen
                         derselben Kanäle im selben Bild wären zwei Orte, an denen sie
                         auseinanderlaufen können.

                         `x-show` und nicht `x-if` bleibt: die Begründung unten (zwei Abos,
                         die ein `x-if` bei jedem Tab-Wechsel neu aufbaut) gilt unverändert.
                         `zweispaltig` wechselt nur beim Überschreiten der xl-Schwelle, also
                         genau dann nicht. --}}
                    <section x-show="!zweispaltig && tab === 'workspaces'" x-cloak x-data="nostrWorkspaceRooms" data-forge-workspaces>
                        {{-- `surface-card` statt einer nachgebauten Kante: hier stand
                             `rounded-card border border-zinc-200 dark:border-zinc-800` —
                             Zeichen für Zeichen die Hälfte dessen, was `surface-card`
                             ohnehin ausrollt (`theme.css:201`), nur ohne dessen Schatten.
                             Zwei Schreibweisen für dieselbe Oberfläche laufen früher oder
                             später auseinander; an 127 Stellen im Paket steht die andere.

                             KEIN `flux:card`, und das ist gerechnet: die Komponente backt
                             `p-6` und einen anderen Dunkelgrund ein (`bg-white/10` statt
                             `zinc-900`). 31 der 127 `surface-card` stehen in der Forge —
                             tauschte man die, sähe genau diese eine Fläche anders aus als
                             die 96 übrigen im selben Client. Der Bruch wäre größer als der
                             Gewinn. --}}
                        <div class="surface-card p-1">
                            {{-- Kopfzeile: Name des Workspace-Relays aus dem NIP-11-Doc. --}}
                            <div class="flex items-baseline justify-between px-2 py-1.5">
                                <span class="text-xs font-semibold uppercase tracking-wide text-muted"
                                      x-text="label || @js(__('Workspace'))"></span>
                                <span class="text-xs tabular-nums text-muted" x-text="rooms.length"></span>
                            </div>

                            {{-- Lädt noch. --}}
                            <template x-if="loading">
                                <p class="px-2 py-3 text-sm text-muted">{{ __('Räume werden geladen…') }}</p>
                            </template>

                            {{-- Geladen, aber leer: ein Zustand, keine Lücke. --}}
                            <template x-if="!loading && rooms.length === 0">
                                <p class="px-2 py-3 text-sm text-muted">{{ __('Dieser Workspace hat noch keine Räume.') }}</p>
                            </template>

                            {{-- Die Räume. Eigene Zeile statt `x-group::room-tile`: die Kachel
                                 dort hängt am `nostrSpaces`-Scope des AKTIVEN Space (isAdmin,
                                 openRoomEdit, _logo) — hier wäre das der falsche Space.

                                 ── Kanal-Präferenzen aus Buzz Desktop (NIP-78) ─────────────
                                 Diese Liste ist unterhalb von `xl` die EINZIGE Raumliste des
                                 Workspace — die Rail gibt es dort nicht. Sie wendet deshalb
                                 dieselben Präferenzen an wie die Rail: `buildWorkspaceList`
                                 (node-getestet) ordnet angeheftet · beigetreten · entdeckbar
                                 und sortiert innerhalb nach dem in Buzz gesetzten Modus.

                                 **Stumm ist keine Opazität** (gleiche Regel wie in
                                 `rail-room-row.blade.php`): die Zeile fällt auf die
                                 `text-muted`-Stufe und trägt die durchgestrichene Glocke als
                                 nicht-farbliches Merkmal (WCAG 1.4.1) plus sr-only-Text.
                                 Einen Ungelesen-Zähler gibt es auf dieser Fläche nicht — der
                                 Ungelesen-Store folgt dem AKTIVEN Space (`deriveUnread` in
                                 bridge.ts), und der ist hier der Vereins-Space. Es gibt hier
                                 also auch keine Summe, die die Stummschaltung auslassen
                                 müsste; die Zahl im Kopf ist der Bestand, und stumme Räume
                                 bleiben in der Liste stehen. --}}
                            <template x-for="room in rooms" :key="room.h">
                                <div class="group flex items-center gap-1 rounded-tile hover:bg-zinc-100 dark:hover:bg-zinc-800">
                                    <button type="button"
                                            class="flex min-h-[2.75rem] flex-1 items-center gap-3 rounded-tile px-2 py-2 text-start"
                                            x-on:click="openRoom(room); Livewire.navigate(roomHref(room))"
                                            {{-- Dieselbe Reparatur wie in `rail-room-row.blade.php`: kein sr-only-Fragment
                                                 (', angeheftet' / ', stummgeschaltet') mehr, das an den sichtbaren Namen
                                                 angehängt wird — drei ganze Übersetzungsschlüssel mit `:name`-Platzhalter
                                                 im `aria-label`, `null` ohne Pin/Stumm (Attribut entfällt, Standard-Name
                                                 aus dem sichtbaren `x-text` bleibt). --}}
                                            x-bind:aria-label="isPinned(room) && isMuted(room)
                                                ? @js(__(':name, angeheftet und stummgeschaltet')).split(':name').join(room.name)
                                                : (isPinned(room)
                                                    ? @js(__(':name, angeheftet')).split(':name').join(room.name)
                                                    : (isMuted(room)
                                                        ? @js(__(':name, stummgeschaltet')).split(':name').join(room.name)
                                                        : null))">
                                        <span class="flex size-8 shrink-0 items-center justify-center rounded-tile bg-brand-500/10 text-base font-semibold text-brand-800 transition-colors group-hover:bg-brand-500/20 dark:text-brand-400">#</span>
                                        <span class="min-w-0 flex-1 truncate" x-text="room.name"
                                              x-bind:class="isMuted(room) ? 'font-normal text-muted' : 'font-medium'"></span>
                                        <template x-if="isPinned(room)">
                                            <span class="inline-flex shrink-0 items-center">
                                                <flux:icon.map-pin variant="micro" aria-hidden="true" class="size-4 text-zinc-400" />
                                            </span>
                                        </template>
                                        <template x-if="isMuted(room)">
                                            <span class="inline-flex shrink-0 items-center">
                                                <flux:icon.bell-slash variant="micro" aria-hidden="true" class="size-4 text-zinc-400" />
                                            </span>
                                        </template>
                                        <template x-if="room.locked">
                                            <flux:icon.lock-closed variant="micro" class="size-4 shrink-0 text-zinc-400" />
                                        </template>
                                        <flux:icon.chevron-right class="size-4 shrink-0 text-zinc-400 opacity-0 transition-opacity group-hover:opacity-100" />
                                    </button>
                                </div>
                            </template>
                        </div>
                    </section>
                    </div>
                    </div>
                </div>
            </div>
        @endif
    </div>

</x-group::app-shell>
