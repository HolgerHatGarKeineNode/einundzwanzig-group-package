<?php

use Livewire\Attributes\Layout;
use Livewire\Component;

/**
 * Ein Repository der Forge (`/forge/{naddr}`, P6) als Livewire-Full-Page-SFC.
 *
 * `$naddr` kommt aus dem Routen-Parameter und wird via `@js($naddr)` an die Insel
 * gereicht — die einzige Server→Insel-Übergabe; Laden, Falten und Rendern laufen
 * client-seitig (`nostrForgeRepo`).
 *
 * **Kein server-seitiger Titel aus dem Repository.** Der Server kennt es nicht: es
 * liegt auf dem Workspace-Relay hinter NIP-42. Der Seitentitel bleibt deshalb
 * generisch; der echte Name steht als `<h1>` im Kopf, sobald er da ist.
 */
new #[Layout('group::einundzwanzig')] class extends Component
{
    public string $naddr = '';

    public function mount(string $naddr): void
    {
        // ── Alt-Link-Kompat (P1, GitHub-Parität) ─────────────────────────
        // `/forge/{naddr}?issue=<hex>` ist seit P1 eine Adresse der EINZEL-
        // route. Der Server kennt dafür alles Nötige — naddr im Pfad, Id im
        // Query; ein Relay-Zugang ist nicht erforderlich („Existenz prüfen"
        // ist eine andere Frage als „URL umbiegen"). Nur eine GÜLTIGE
        // Hex64-Id leitet um, und nur bei genau EINEM Ziel (`?issue=` UND
        // `?pr=` ist keine Adresse — Regel 2 aus P2, unverändert).
        $issue = strtolower((string) request()->query('issue', ''));
        $pull = strtolower((string) request()->query('pr', ''));
        $istIssue = preg_match('/^[0-9a-f]{64}$/', $issue) === 1;
        $istPull = preg_match('/^[0-9a-f]{64}$/', $pull) === 1;

        if ($istIssue xor $istPull) {
            redirect()->to(
                '/forge/'.rawurlencode($naddr).'/'.($istIssue ? 'issues' : 'pulls').'/'.($istIssue ? $issue : $pull),
                302,
            );
        }

        $this->naddr = $naddr;
    }

    public function render()
    {
        return $this->view()->title(__('Repository'));
    }
}; ?>

{{-- `width="wide"` (P5): die Repo-Seite ist die dichteste Tabelle des Clients —
     Dateibaum, Branches, Issues, Pull Requests. Fließtext gibt es hier nur in den
     Kommentaren, und die deckeln sich über ihre eigene Spalte. Der Lesedeckel von
     62 rem zwang die Tabellen in eine Breite, in der Spalten umbrachen, während
     rechts Platz stand.

     KEINE Ortskarten-Leiste: das hier ist eine Detail-Ebene, kein Ort. Der Weg
     zurück steht im `app-header` (Pfeil auf die Forge-Übersicht), genau wie in der
     Artikel-Vollansicht. Eine Ortsleiste über einer Detailseite behauptete, man sei
     an einem der drei Orte angekommen — man ist eine Ebene darunter. --}}
@php($native = \Einundzwanzig\Group\Chassis::istApp())
<x-group::app-shell width="wide">

    {{-- ── Warum die Insel und `page-enter` seit P4 ZWEI Elemente sind ─────────
         Der Handlungsknopf (unten) ist `position: fixed`. Ein Vorfahr mit
         `transform` macht daraus ein `absolute` gegen diesen Vorfahren — und
         `page-enter` trägt 0,3 s lang genau das (`page-in`: `translateY(8px)`
         → `0`). Der Knopf sprang damit beim Seitenaufbau an eine andere Stelle.
         Die Insel bleibt die Alpine-Wurzel; die Einblendung umfasst nur noch
         den scrollenden Inhalt, was ohnehin richtig ist: ein Handlungsknopf
         blendet nicht mit ein, er ist da. --}}
    <div x-data="nostrForgeRepo(@js($naddr))">
    <div class="page-enter">

        {{-- `json_encode` statt `@js()`: `app-header` echot den Ausdruck über `{{ }}`
             und escapt ihn damit selbst genau einmal — dieselbe Begründung wie in
             `⚡article.blade.php` und `⚡room.blade.php` (dort jeweils beim
             `$titleExpr`).

             **Auf das SYMBOL geankert, nicht auf die Zeile** (2026-08-21): hier stand
             `⚡article.blade.php:44` und `⚡room.blade.php:92`. Die Raum-Zeile war schon
             vor P3 falsch (nachgemessen an `HEAD`: dort steht ein Satz über den
             Thread-Wechsel), die Artikel-Zeile ist es durch den P3-Umbau geworden. Beide
             zeigten weiterhin plausibel aussehend ins Leere, ohne dass irgendein Test rot
             wurde — genau der Grund, warum neue Verweise im Haus auf ein eindeutiges
             Symbol zeigen und nicht auf eine Zahl. `grep -n 'titleExpr = '` findet beide
             Stellen unabhängig von jedem Verschub. --}}
        @php($titleExpr = 'view ? view.repo.name : '.json_encode(__('Repository')))

        {{-- ── Krümelspur (P6, Schritt 27) ──────────────────────────────────────
             **Nur unterhalb `xl`, und das ist keine Geometriefrage.** Ab `xl`
             steht der Navigator links und zeigt Workspace, Forge und das
             geöffnete Repository als Baum — die Spur wäre dort eine zweite
             Antwort auf dieselbe Frage. Die Bedingung ist damit „gibt es die
             Rail", nicht „wie breit ist die Bühne", und dafür ist `xl:hidden`
             das richtige Werkzeug: dieselbe Mechanik und derselbe Grund wie beim
             Zurück-Pfeil des Raums (`app-header`, `backClass`). Die
             Container-Query-Regel des Hauses gilt der GEOMETRIE der Bühne; das
             Chassis entscheidet weiterhin der Breakpoint.

             **Was sie dem Zurück-Pfeil daneben voraus hat:** der Pfeil sagt
             „zurück", die Spur sagt WOHIN. `aria-label` des Pfeils ist
             „Zurück" — für jemanden, der über einen geteilten Link hier
             gelandet ist, ist das keine Ortsangabe.

             Eine `nav` mit Liste, nicht eine Reihe loser Links: der Weg IST
             eine Struktur (dieselbe Bauform wie die Pfad-Krümelspur im
             Code-Reiter weiter unten). Der letzte Krümel ist kein Link und
             trägt `aria-current="page"` — er ist der Ort, an dem man steht. --}}
        <x-group::app-header :title="__('Repository')" :title-expr="$titleExpr" :back="route('group.forge')">
            <x-slot name="subtitle">
                <nav class="mt-1 flex items-center gap-1.5 text-xs text-muted xl:hidden"
                     aria-label="{{ __('Pfad') }}" data-forge-kruemel>
                    <a href="{{ route('group.forge') }}" wire:navigate
                       class="pressable rounded-tile px-1 py-0.5 -mx-1 font-semibold hover:text-zinc-900 dark:hover:text-zinc-100">{{ __('Forge') }}</a>
                    <span aria-hidden="true">/</span>
                    {{-- `truncate` plus `min-w-0`: ein Repo-Name ist Fremdtext und
                         kann beliebig lang sein — ohne Deckel schöbe er die Spur
                         über den Rand und risse den 320-px-Wächter. --}}
                    <span class="min-w-0 truncate" aria-current="page" x-text="view ? view.repo.name : ''"></span>
                </nav>
            </x-slot>
        </x-group::app-header>

        @if (! config('group.workspace_url'))
            {{-- Keine Quelle konfiguriert — und das ist etwas ANDERES als „dieses
                 Repository gibt es nicht". Ohne diese Weiche behauptete ein Client
                 ohne Workspace über jeden Link, der Relay kenne ihn nicht, obwohl nie
                 einer gefragt wurde. Server-seitig, aus demselben Grund wie auf der
                 Übersicht. --}}
            {{-- Gleiche Bauform wie alle Leerzustände der Forge: Icon in getönter
                 Kachel (zinc-400 auf Weiß misst 2,52:1 und verschwindet), Fließtext auf
                 Lesemaß gedeckelt, Kinder-Reihenfolge für die gestaffelte Einblendung
                 aus `theme.css` unverändert. --}}
            <div class="surface-card empty-state px-6 py-12 text-center">
                <span class="mx-auto flex size-12 items-center justify-center rounded-tile bg-zinc-100 dark:bg-zinc-800">
                    <flux:icon.code-bracket-square class="size-6 text-zinc-500 dark:text-zinc-400" />
                </span>
                <flux:heading size="lg" class="mt-4">{{ __('Keine Forge-Quelle eingerichtet.') }}</flux:heading>
                <flux:text class="mx-auto mt-1 max-w-sm text-sm text-muted">{{ __('Dieser Client kennt kein Relay, auf dem Repositories liegen.') }}</flux:text>
            </div>
        @else
            <div>
                <template x-if="error">
                    <flux:callout variant="danger" icon="exclamation-triangle" class="mb-4">
                        <flux:callout.text x-text="error"></flux:callout.text>
                        <x-slot name="actions">
                            <flux:button size="sm" variant="ghost" icon="arrow-path" x-on:click="retry()">{{ __('Erneut laden') }}</flux:button>
                        </x-slot>
                    </flux:callout>
                </template>

                {{-- Der Relay HAT geantwortet und kennt dieses Repository nicht. Eine
                     Aussage über den Relay, und erst jetzt ist sie gedeckt — deshalb
                     `missing` und nicht `view === null`: die Ableitung meldet ihren
                     ersten Wert, bevor das Netz antwortet. --}}
                <template x-if="missing">
                    <div class="surface-card empty-state px-6 py-12 text-center" data-forge-missing>
                        <span class="mx-auto flex size-12 items-center justify-center rounded-tile bg-zinc-100 dark:bg-zinc-800">
                            <flux:icon.code-bracket class="size-6 text-zinc-500 dark:text-zinc-400" />
                        </span>
                        <flux:heading size="lg" class="mt-4">{{ __('Dieses Repository kennt der Workspace nicht.') }}</flux:heading>
                        <flux:text class="mx-auto mt-1 max-w-sm text-sm text-muted">{{ __('Vielleicht wurde es entfernt, oder der Link zeigt auf ein anderes Relay.') }}</flux:text>
                        <div class="mt-4">
                            <flux:button size="sm" variant="ghost" icon="arrow-left" :href="route('group.forge')" wire:navigate>{{ __('Zur Forge') }}</flux:button>
                        </div>
                    </div>
                </template>

                {{-- Skeleton SERVER-gerendert (nicht x-if): vor dem Alpine-Boot
                     existierte der Inhalt eines Templates gar nicht im DOM. --}}
                <div x-show="loading && !view" class="space-y-3">
                    <div class="surface-card space-y-2 p-4">
                        <div class="skeleton h-4 w-1/3"></div>
                        <div class="skeleton h-3 w-2/3"></div>
                        <div class="skeleton h-3 w-1/2"></div>
                    </div>
                </div>

                <template x-if="view">
                    {{-- ══ WERKBANK UND ÜBER-SPUR (GitHub-Parität, 2026-08-27) ═══════
                         WERKBANK = woran man arbeitet (Code, Issues, Pull Requests,
                         Aktivität, Patches). ÜBER-SPUR = was man nachschlägt
                         (Beschreibung, Clone-Befehl, Branches, Schutzregeln,
                         Maintainer) — GitHubs „About"-Spalte.

                         Seit der GitHub-Parität: KEIN Aufklapper mehr. Das README
                         steht in der HAUPTSPALTE des Code-Reiters unter der
                         Dateiliste (wie GitHub), die Über-Karte steht schmal UNTER
                         der Werkbank (wie GitHubs mobiles About) und breit in der
                         Spur daneben. Ein `<details>`-Zwilling mit Rückmesserei
                         (`_messeSteckbrief`, `steckbriefSpur`) ist damit ersatzlos
                         gefallen.

                         ── Die Klassen stehen NUR im Web-Host ─────────────────────────
                         Ohne `forge-repo-buehne` feuert keine einzige
                         `@container repo`-Regel; die App bleibt einspaltig, ohne
                         dass die Host-Bedingung ein zweites Mal ausgeschrieben
                         würde. Eine Bedingung, ein Ort.

                         ── ZWEI Elemente, nicht eines ─────────────────────────────────
                         Ein Element ist sein eigener Container und wird von der eigenen
                         `@container`-Regel nicht getroffen. Standen Container und Raster
                         am selben Knoten, blieb das Raster lautlos einspaltig (am
                         2026-08-23 an `.forge-raster` gemessen: `grid-template-columns`
                         meldete `1504px` statt `1fr 30rem`). --}}
                    <div @class(['forge-repo-buehne' => ! $native])>
                    <div @class(['forge-repo-raster' => ! $native])>

                    {{-- ── SPUR 1: die Werkbank ───────────────────────────────────────
                         Alles, woran man arbeitet. `min-w-0`, damit die dichten Inhalte
                         (Diff, Dateibaum) die Spur nicht aufreißen, sondern in ihrem
                         eigenen `overflow-x` scrollen. --}}
                    <div class="forge-repo-werkbank min-w-0">

                        {{-- `scrollable scrollable:fade` — dieselbe Heilung, die P1 der
                             Übersicht gegeben hat, und hier bis zum 2026-08-23 NICHT
                             angekommen: das Vendor-Attribut stand nur an
                             `⚡forge.blade.php`. Mit dem vierten Tab wäre die Leiste
                             sonst genau in die Falle gelaufen, die P1 gemessen und
                             behoben hat — bei 320 px lief sie schon mit DREI Tabs in
                             nl/hu/lv über.

                             Warum ein vierter Tab und keine Zusammenlegung mit „Pull
                             Requests": ein Patch und ein PR sind verschiedene Dinge.
                             Der PR verweist auf einen Branch in einem Repository, das
                             man klonen muss; der Patch TRÄGT seine Änderung mit sich.
                             Wer sie in eine Liste wirft, muss in jeder Zeile erklären,
                             welche Sorte gerade gemeint ist. --}}
                        {{-- ── Die Leiste KLEBT (P4) ──────────────────────────────────
                             Deckender Seitengrund, **kein** `backdrop-blur`: ein
                             `backdrop-filter` über scrollendem Inhalt wird pro Frame neu
                             berechnet und ist der klassische Mobile-WebView-Scroll-Killer
                             — dieselbe Begründung, aus der die Bottom-Nav ihn auf Native
                             ausschaltet (`components/bottom-nav.blade.php`).

                             `top: 0` meint beide Male die Oberkante der scrollenden
                             Fläche: unterhalb `xl` das Dokument, ab `xl` die Bühne
                             (`app-shell.blade.php`, `xl:overflow-y-auto`). Die Regel
                             musste deshalb NACH der zweiten Spur gebaut werden — der
                             Scrollport wechselt mit ihr, und ein vorher gesetztes
                             `sticky` hätte man zweimal gebaut. Zwischen Leiste und
                             Scrollport liegt kein `overflow: hidden`; die Bühne und das
                             Raster setzen keines, und die Karten mit `overflow-hidden`
                             sind Geschwister, keine Vorfahren.

                             Die Maße stehen in `theme.css` bei `.forge-reiterbank`. --}}
                        {{-- ── Flux' DEFAULT-Variante, kein `segmented` (P1, 2026-08-26) ──
                             Die Begründung steht ausgeschrieben an der Reiterreihe in
                             `⚡forge.blade.php` — kurz: `segmented` markiert den aktiven
                             Reiter allein über seine Fläche und misst dabei 1,15:1 hell /
                             1,93:1 dunkel gegen die Schiene, WCAG 1.4.11 verlangt 3:1.
                             Der Unterstrich der Default-Variante misst 4,21:1 / 10,01:1.
                             Und der Reiter wächst von 32 auf 40 px — hier zählt das
                             doppelt: unterhalb `xl` ist diese Reihe die einzige
                             Navigation durch fünf Bereiche.

                             `data-forge-reiter` trägt die beiden gerechneten Korrekturen
                             an Flux' Default (inaktive Beschriftung, Wortfarbe des
                             aktiven Reiters) — beide in `theme.css` bei
                             `.forge-reiterbank`. --}}
                        <div class="forge-reiterbank" data-forge-reiter>
                        <flux:tabs scrollable scrollable:fade x-model="tab" class="mb-0">
                            {{-- ── Die Reihenfolge ist die Rangfolge (P4) ─────────────
                                 „Issues" zuerst, „Code" auf drei. Der Code-Reiter lädt
                                 bis 8,3 MB Repository-Klon (gemessen am grössten Repo
                                 dieses Relays) und gehört damit nicht auf Position 1 —
                                 der erste Reiter ist der, den man am häufigsten will,
                                 nicht der teuerste. „Patches" steht hinten: die Form ist
                                 selten und wird gesucht, nicht überflogen.

                                 **Kein Verhaltenswechsel.** Der Startwert kommt aus
                                 `tabFromLocation()` und ist seit jeher `issues`
                                 (`js/forge.ts`); `x-model="tab"` wählt nach dem Namen,
                                 nicht nach der Position. --}}
                            {{-- ── Zahlen an drei Reitern, an zweien bewusst nicht ──────
                                 „Issues", „Pull Requests" und „Patches" führen einen
                                 BESTAND — die Zahl beantwortet „lohnt sich der Griff
                                 dorthin". „Code" führt keinen (ein Baum hat keine
                                 sinnvolle Kopfzahl), „Aktivität" auch nicht: die Spur ist
                                 endlos und ihre Länge sagt nichts.

                                 Bei 0 steht KEINE Pille — nicht die Ziffer „0". Eine
                                 Null, die 300 ms später auf 47 springt, ist eine
                                 Falschaussage mit Selbstbewusstsein; dieselbe Regel wie
                                 an der Ungelesen-Pille (`unread-badge.blade.php`). Und
                                 der Leerzustand darunter sagt es ohnehin mit einem Satz.
                                 Der ganze Reiterstreifen steht innerhalb
                                 `<template x-if="view">` (`:161`) — vor dem ersten
                                 Ertrag existiert er also gar nicht.

                                 Die Zahl steht IM Accessible Name („Issues 12"), nicht
                                 hinter einem `aria-hidden`. Sie ist Bestand, keine
                                 Benachrichtigung; wer die Reiterreihe hört, will sie
                                 hören. Playwright-Sonden mit `exact: true` müssen deshalb
                                 auf ein `/^Name/` umgestellt sein — geschehen in
                                 `forge-patches.spec.ts`.

                                 Icons erst ab `lg` (`max-lg:[&>svg]:hidden`): mobil
                                 müssen fünf Reiter lesbar bleiben. Die Klasse aus
                                 `$attributes` landet am gerenderten `<button>`
                                 (`flux/tab/index.blade.php`), das Icon ist sein direktes
                                 Kind. KEIN `::variant` am Icon — das löst zur
                                 Compile-Zeit auf und wäre eine tote Bindung.

                                 Die fünf Zeichen sind KEINE Neuerfindung: jedes steht
                                 schon im Leerzustand seines eigenen Bereichs
                                 (`arrows-right-left`, `code-bracket`, `clock`,
                                 `document-text` — je aus dem Leerzustand ihres
                                 Bereichs). Ein zweites Symbol für dieselbe Sache wäre
                                 Nielsen #4.

                                 **Ausnahme „Issues", korrigiert mit P3:** der Reiter
                                 trug `exclamation-circle`, und genau dieses Zeichen
                                 bedeutet in JEDER Vorgangszeile „Zustand: offen"
                                 (Zustandspille aus P1). Ein Zeichen, zwei Bedeutungen,
                                 gleichzeitig im Bild — dieselbe Fehlerklasse, die P3
                                 bei den drei byte-gleichen Chips behebt. Issue heisst
                                 jetzt überall `ticket`: am Reiter, am Zeilenanfang und
                                 in der workspace-weiten Liste. --}}
                            <flux:tab name="code" icon="code-bracket" class="max-lg:[&>svg]:hidden">{{ __('Code') }}</flux:tab>
                            <flux:tab name="issues" icon="ticket" class="max-lg:[&>svg]:hidden">
                                {{ __('Issues') }}
                                <template x-if="view.issues.length > 0">
                                    <flux:badge size="sm" class="ms-1.5" x-text="$num(view.issues.length)" />
                                </template>
                            </flux:tab>
                            <flux:tab name="pulls" icon="arrows-right-left" class="max-lg:[&>svg]:hidden">
                                {{ __('Pull Requests') }}
                                <template x-if="view.pullRequests.length > 0">
                                    <flux:badge size="sm" class="ms-1.5" x-text="$num(view.pullRequests.length)" />
                                </template>
                            </flux:tab>
                            <flux:tab name="activity" icon="clock" class="max-lg:[&>svg]:hidden">{{ __('Aktivität') }}</flux:tab>
                            <flux:tab name="patches" icon="document-text" class="max-lg:[&>svg]:hidden">
                                {{ __('Patches') }}
                                <template x-if="view.patches.length > 0">
                                    <flux:badge size="sm" class="ms-1.5" x-text="$num(view.patches.length)" />
                                </template>
                            </flux:tab>
                        </flux:tabs>
                        </div>

                        <template x-if="truncatedText()">
                            <flux:callout variant="secondary" icon="information-circle" class="mb-4">
                                <flux:callout.text x-text="truncatedText()"></flux:callout.text>
                            </flux:callout>
                        </template>

                        {{-- Die Vorgangssuche steht ÜBER den drei Listen und nicht in
                             jeder einzelnen: eine Eingabe, drei Reiter, ein Zustand.
                             Die Herleitung — auch die, warum das ein Partial ist —
                             steht in der eingebundenen Datei. --}}
                        @include('group::partials.forge-detail-suche')

                        {{-- ── Issues ───────────────────────────────────────────── --}}
                        <div x-show="tab === 'issues'" x-cloak>
                            {{-- ── Wer nicht darf, sieht das hier — vor dem Klick ──
                                 Es gibt bewusst kein Formular, das erst beim
                                 Absenden scheitert: entweder steht der Knopf da,
                                 oder es steht der Grund da, warum nicht.

                                 **Der Knopf selbst steht seit P4 nicht mehr hier.**
                                 Seit dem 2026-08-27 steht er in ZWEI Formen: am
                                 Desktop beschriftet in der Filterleiste direkt
                                 darüber, im Mobil-Chassis als rundes Plus am
                                 unteren Bildrand. Welche gilt, sagt
                                 `js/forgeAnlegen.ts`.
                                 Was HIER bleibt, ist alles, was nach dem Schließen
                                 des Blattes noch etwas zu sagen hat: der Grund einer
                                 Verweigerung, die Weckmeldung und ein
                                 fehlgeschlagener Schreibversuch. Ein Fehler, der mit
                                 dem Blatt verschwände, wäre von „hat funktioniert"
                                 nicht zu unterscheiden. --}}
                            <div class="mb-4 space-y-2">

                                {{-- `id` seit dem 2026-08-27: beide Anlege-Formen
                                     verweisen im gesperrten Zustand per
                                     `aria-describedby` hierher. Der Satz steht
                                     genau EINMAL — ein zweiter, versteckter
                                     Träger für die Sprachausgabe wäre eine
                                     zweite Wahrheit über denselben Grund.

                                     Er lebt im `x-if`, also existiert die `id`
                                     genau dann, wenn ein Knopf sie nennt. Ein
                                     `aria-describedby` ins Leere wäre still
                                     wirkungslos — hier kann es das nicht sein,
                                     weil beide Bedingungen `canWrite()` sind. --}}
                                <template x-if="!canWrite()">
                                    <p id="forge-schreibhinweis" class="text-xs text-muted" data-forge-write-hint x-text="writeHint()"></p>
                                </template>

                                @include('group::partials.forge-wake-notice', [
                                    'target' => "'issue'",
                                    'label' => 'issue',
                                ])

                                {{-- Ein Issue, das der Relay abgelehnt hat. welshman
                                     nimmt die Herkunft des Ereignisses bei einem
                                     Fehlschlag wieder weg (`tracker.removeRelay`) —
                                     die optimistische Zeile verschwände sonst
                                     LAUTLOS, und „war da, ist weg" ist von „hat nie
                                     funktioniert" nicht zu unterscheiden. --}}
                                <template x-for="row in failedIssues()" :key="row.id">
                                    {{-- ── Vom Handkasten auf `flux:callout` ───────────────
                                         Hier stand ein zweiter, selbst gezeichneter Fehlerkasten
                                         (roter 1-px-Rahmen auf getönter Fläche), während dieselbe
                                         Datei denselben Anlass — Ladefehler, README-Fehler,
                                         Klon-Fehler — bereits dreimal als `flux:callout
                                         variant="danger"` zeigt. Zwei Bauformen für dieselbe
                                         Aussage sind genau der Grund, aus dem die Fläche
                                         selbstgebaut wirkte.

                                         Gemessen wandert der Text nach OBEN: 5,91:1 hell
                                         (red-700 auf red-50) und 8,14:1 dunkel (red-300 auf
                                         `red-400/10` über zinc-900) gegen vorher 4,54:1 und
                                         6,14:1 — der helle Wert lag 0,04 über der Grenze.

                                         `role="alert"` und `data-forge-write-failed` bleiben
                                         am Element: an beiden hängen Zusagen (`buzz-forge-
                                         write.spec.ts`, und die Rolle zählt der a11y-Riegel
                                         in `EmptyStatesAndA11yTest.php`). --}}
                                    <flux:callout variant="danger" icon="exclamation-triangle" inline
                                                  role="alert" data-forge-write-failed="issue">
                                        <flux:callout.text class="text-xs!">
                                            <span class="font-semibold" x-text="row.label"></span>
                                            <span x-text="' — ' + row.error"></span>
                                        </flux:callout.text>
                                        <x-slot name="actions">
                                            <flux:button size="xs" variant="ghost" class="icon-btn-touch shrink-0" x-on:click="dismiss(row.id)">{{ __('Verwerfen') }}</flux:button>
                                        </x-slot>
                                    </flux:callout>
                                </template>
                            </div>

                            <template x-if="view.issues.length === 0">
                                <div class="surface-card empty-state px-6 py-12 text-center" data-forge-empty="issues">
                                    <span class="mx-auto flex size-12 items-center justify-center rounded-tile bg-zinc-100 dark:bg-zinc-800">
                                        <flux:icon.exclamation-circle class="size-6 text-zinc-500 dark:text-zinc-400" />
                                    </span>
                                    <flux:heading size="lg" class="mt-4">{{ __('Noch keine Issues.') }}</flux:heading>
                                    <flux:text class="mx-auto mt-1 max-w-sm text-sm text-muted">{{ __('Sobald jemand ein Issue eröffnet, erscheint es hier.') }}</flux:text>
                                </div>
                            </template>

                            <section x-show="sichtbareIssues().length > 0" class="surface-card">
                                {{-- ── EIN Kasten, Kopf UND Liste (P5) ──────────────────────────
                                     Diese Liste hatte gar keinen Kopf: sie begann ohne
                                     Ansage mit ihrer ersten Zeile. Der Reiter darüber
                                     nennt zwar die Art, aber er gehört zur Navigation und
                                     endet mit ihr — zwischen ihm und der Liste steht der
                                     Meldungsblock. Der Kopfstreifen sagt, wo die Liste
                                     ANFÄNGT, und er trägt die Zahl, die der Reiter nicht
                                     trägt.

                                     `aria-hidden` ist er NICHT — anders als der Kopf der
                                     Werkbank. Er enthält eine Angabe, die sonst nirgends
                                     steht (die Anzahl), und wer die Fläche vorgelesen
                                     bekommt, hört sie sonst nie.

                                     Die Bauform ist `.forge-kartenkopf`, dieselbe wie beim
                                     Diff-Kopf und der workspace-weiten Liste. --}}
                                <div class="forge-kartenkopf">
                                    <span class="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{{ __('Issues') }}</span>
                                    <span class="shrink-0 text-xs text-muted" x-text="$num(sichtbareIssues().length)"></span>
                                </div>
                                <ul>
                                <template x-for="issue in sichtbareIssues()" :key="issue.id">
                                    {{-- `data-forge-issue` + `data-id`/`data-status`: die E2E-Anker
                                         der Zeile. Das Sprungziel eines geteilten Links ist seit P1
                                         die EIGENE ROUTE (`/forge/{naddr}/issues/{id}`) — kein
                                         Zeilen-Fokus und kein `tabindex` mehr nötig. --}}
                                    <li class="border-b border-zinc-200 last:border-b-0 dark:border-zinc-800"
                                        data-forge-issue tabindex="-1"
                                        :data-status="issue.status" :data-id="issue.id">
                                        {{-- Die ganze Zeile ist der LINK auf die Einzelansicht —
                                             seit P1 (GitHub-Parität): kein Akkordeon mehr, kein
                                             `button`, sondern `wire:navigate` auf die Route. Ein
                                             `a` trägt Tastatur und Fokus von selbst. --}}
                                        {{-- ── ZWEI RÄNGE, ZWEI AUSGEZEICHNETE FASSUNGEN (P3) ──────
                                              Rang 1: Typ-Glyphe · Titel · Labels.
                                              Rang 2: EINE graue Metazeile.
                                              Rechts: die Zustandspille aus P1.

                                              Bis P3 standen hier vier Blockzeilen —
                                              Titel, Autorsatz, Labelband,
                                              Zuweisungsband — und keine davon war als
                                              Rang ausgezeichnet: alle vier trugen
                                              dasselbe `text-muted` bzw. dieselbe
                                              Chip-Form.

                                              Die schmale und die breite Fassung stehen
                                              als je EIGENES `grid-template-areas` in
                                              `theme.css` (`.forge-vorgangszeile`). Der
                                              DOM ist derselbe: ein zweites Markup für
                                              mobil hiesse ein zweites
                                              `[data-forge-assignees]`, und das wäre ein
                                              Strict-Mode-Treffer auf zwei Elemente. --}}
                                        <a :href="vorgangHrefFuer(issue, 'issue')" wire:navigate data-forge-vorgang-link
                                           class="forge-vorgangskopf pressable block w-full p-4 text-start">
                                            <span class="forge-vorgangszeile">
                                                {{-- ── Die Typ-Glyphe (P3/2) ──────────────────
                                                     `ticket` und NICHT `exclamation-circle`:
                                                     das Ausrufezeichen im Kreis bedeutet in
                                                     dieser Zeile bereits „Zustand: offen"
                                                     (Zustandspille, P1). Ein Zeichen mit zwei
                                                     Bedeutungen in EINER Zeile ist Nielsen #4 —
                                                     und es wäre derselbe Fehler, den P3 bei den
                                                     drei byte-gleichen Chips gerade behebt.
                                                     Der Reiter „Issues" trägt seit P3 dasselbe
                                                     `ticket`, damit Issue genau ein Zeichen hat.

                                                     **Ehrlich zum Nutzen:** innerhalb der
                                                     Issue-Liste wiederholt sich die Glyphe und
                                                     trägt dort keine Zeileninformation. Sie
                                                     zahlt sich an drei anderen Stellen aus:
                                                     auf `/forge` folgen Issue- und PR-Region
                                                     auf EINER scrollenden Fläche aufeinander;
                                                     ein geteilter `?issue=`-Link führt zu einer
                                                     einzelnen Zeile ohne Reiter-Kontext; und
                                                     sie gibt der Metazeile darunter die
                                                     Fluchtlinie, aus der die Liste als Liste
                                                     liest statt als gestapelte Absätze. --}}
                                                <flux:icon.ticket variant="micro" class="forge-vz-glyphe size-4 shrink-0"
                                                             ::class="issue.status === 'open' ? 'text-emerald-600 dark:text-emerald-400' : (issue.status === 'closed' ? 'text-red-600 dark:text-red-400' : 'text-purple-600 dark:text-purple-400')" />

                                                {{-- ── EIN Rang: Titel und Labels in EINER Zelle ──
                                                     Die Labels hatten bis zur Nachbesserung ein
                                                     eigenes Rasterfeld unter dem Titel. Das war
                                                     ein DRITTER Rang — im Bild unübersehbar,
                                                     auch wenn die Schriftgrösse dieselbe blieb.
                                                     Jetzt fliessen sie inline hinter dem Titel
                                                     und brechen mit ihm um; das ist zugleich
                                                     die Gitea-Form.

                                                     Der Deckel von 6 ist grosszügig: welche noch
                                                     ins Bild passen, entscheidet der Umbruch,
                                                     nicht eine zweite Zahl. --}}
                                                <span class="forge-vz-titel">
                                                    <span class="forge-vz-name" x-text="issue.title || @js(__('Ohne Titel'))"></span>
                                                    <template x-if="issue.labels.length > 0">
                                                        <span class="forge-vz-labels" data-forge-labels>
                                                            <template x-for="label in issue.labels.slice(0, 6)" :key="label">
                                                                <flux:badge size="sm" variant="pill" x-text="label" />
                                                            </template>
                                                            <template x-if="issue.labels.length > 6">
                                                                <span class="ms-1 text-xs text-muted"
                                                                      x-text="'+' + (issue.labels.length - 6)"></span>
                                                            </template>
                                                        </span>
                                                    </template>
                                                </span>

                                                {{-- ── Rang 2: EINE Metazeile ─────────────────
                                                     Wer, wann — mehr nicht. Der optimistische
                                                     Sendehinweis hängt hier mit dran, weil er
                                                     dieselbe Frage beantwortet („in welchem
                                                     Zustand ist dieser Eintrag gerade"). --}}
                                                <span class="forge-vz-meta block text-xs text-muted">
                                                    <span class="font-semibold tracking-tight" x-text="'#' + issue.id.slice(0, 7)"></span>
                                                    <span x-text="issue.authorName"></span>
                                                    <span x-text="' · ' + issue.timeLabel"></span>
                                                    <template x-if="rowState(issue.id) === 'sending'">
                                                        <span data-forge-row-state="sending"
                                                              class="ms-1 font-semibold uppercase tracking-wider">{{ __('Wird gesendet …') }}</span>
                                                    </template>
                                                </span>

                                                {{-- Personen und Kommentarzahl in EINER
                                                     Fluchtlinie rechts. `data-forge-assignees`
                                                     wandert mit — der Anker ist E2E-bewacht. --}}
                                                <span class="forge-vz-leute">
                                                    <template x-if="issue.assigneePeople.length > 0">
                                                        <x-group::forge-personen-stapel
                                                            personen="issue.assigneePeople"
                                                            anker="data-forge-assignee"
                                                            data-forge-assignees
                                                            :sr-eins="__('Zugewiesen an :namen')"
                                                            :sr-viele="__(':count Zuständige: :namen')" />
                                                    </template>
                                                    <template x-if="issue.commentCount > 0">
                                                        <span class="inline-flex items-center gap-1 text-xs text-muted">
                                                            <flux:icon.chat-bubble-left-ellipsis variant="micro" class="size-4" />
                                                            <span x-text="issue.commentCount"></span>
                                                        </span>
                                                    </template>
                                                </span>

                                                <x-group::forge-status-badge klasse="forge-vz-zustand"
                                                                             status="issue.status" label="statusText(issue.status)" />
                                            </span>
                                        </a>

                                    </li>
                                </template>
                            </ul>
                            </section>
                        </div>

                        {{-- ── Code (P6) ────────────────────────────────────────
                             Liest aus DEMSELBEN Klon wie das README. Es gibt
                             genau einen Ladeweg — das ist der einzige Vorteil,
                             den das `blob:none`-Nein übriggelassen hat, und hier
                             wird er eingelöst: kein Byte Netz für Baum und Datei. --}}
                        <div x-show="tab === 'code'" x-cloak data-forge-code :data-lage="klon.lage">
                            {{-- Nicht geklont: dieselbe Ansage wie beim README,
                                 und derselbe Knopf — es ist derselbe Download. --}}
                            <template x-if="klon.lage !== 'da' && klon.lage !== 'leer'">
                                <div class="surface-card p-4" data-forge-code-ansage>
                                    <p class="forge-mass text-sm" x-show="klon.lage === 'bereit'">{{ __('Der Dateibaum steht nicht im Nostr-Ereignis. Um ihn zu zeigen, lädt dieser Client das ganze Repository herunter — derselbe Download wie fürs README.') }}</p>
                                    <p class="forge-mass text-sm" x-show="klon.lage === 'laedt'">{{ __('Wird geladen …') }}</p>
                                    <p class="forge-mass text-sm text-muted" x-show="klon.lage === 'fremd' || klon.lage === 'keine-url'">{{ __('Von hier lässt sich dieses Repository nicht laden — siehe den Hinweis über den Reitern.') }}</p>
                                    <div class="mt-4" x-show="klon.lage === 'bereit'">
                                        <flux:button size="sm" variant="primary" icon="arrow-down-tray"
                                                     x-on:click="klonLaden()" data-forge-code-start>{{ __('Repository laden') }}</flux:button>
                                    </div>
                                </div>
                            </template>

                            <template x-if="klon.lage === 'da' || klon.lage === 'leer'">
                                <div>
                                    {{-- ── Krümelspur ─────────────────────────
                                         Eine `nav` mit Liste, nicht eine Reihe
                                         loser Links: der Weg IST eine Struktur,
                                         und ein Screenreader soll ihn als solche
                                         hören. --}}
                                    {{-- ── Hier bleibt es HANDARBEIT, und zwar aus dem
                                         Datenmodell heraus ──────────────────────────────
                                         Für einen Pfad gibt es `flux:breadcrumbs` samt
                                         `flux:breadcrumbs.item`. Die Komponente rendert
                                         ihre Stufe aber ENTWEDER als `<a href>` ODER als
                                         toten Text — einen Zweig für einen Knopf hat sie
                                         nicht (`flux/breadcrumbs/item.blade.php`, die
                                         einzige Verzweigung dort ist `if ($href)`).

                                         Dieser Weg HAT keine Adressen: `codeOeffnen(pfad)`
                                         öffnet ein Verzeichnis im geklonten Repository,
                                         das nur im Speicher der Insel existiert. Ihm URLs
                                         anzudichten, damit die Komponente passt, wäre eine
                                         Verhaltensänderung — der Auftrag heißt Bauform
                                         tauschen, nicht Funktion.

                                         (Die Krümelspur im SEITENKOPF, `data-forge-kruemel`,
                                         hat echte Adressen. Sie bleibt trotzdem: sie steht
                                         im `subtitle`-Slot des App-Kopfes auf `text-xs`,
                                         `flux:breadcrumbs.item` setzt `text-sm font-medium`
                                         fest — sie brächte eine zweite Schriftgröße in eine
                                         Kopfzeile, die eine hat.) --}}
                                    <nav class="mb-2 flex flex-wrap items-center gap-1 text-sm" data-forge-krumel
                                         aria-label="{{ __('Pfad im Repository') }}">
                                        <button type="button" class="pressable rounded-tile px-1.5 py-0.5 font-semibold hover:bg-zinc-100 dark:hover:bg-zinc-800"
                                                x-on:click="codeOeffnen('')" data-forge-krumel-wurzel>{{ __('Wurzel') }}</button>
                                        <template x-for="(k, i) in krumel()" :key="k.pfad">
                                            <span class="flex items-center gap-1">
                                                <span aria-hidden="true" class="text-muted">/</span>
                                                <button type="button" class="pressable rounded-tile px-1.5 py-0.5 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                                                        :class="i === krumel().length - 1 && !code.datei ? 'font-semibold' : ''"
                                                        x-on:click="code.datei ? dateiSchliessen() : codeOeffnen(k.pfad)"
                                                        x-text="k.name"></button>
                                            </span>
                                        </template>
                                    </nav>

                                    <p x-show="code.fehler" x-cloak class="forge-mass mb-2 text-sm text-red-600 dark:text-red-400"
                                       role="alert" data-forge-code-fehler x-text="code.fehler"></p>

                                    {{-- ── Der Baum ───────────────────────── --}}
                                    <template x-if="!code.datei">
                                        <ul class="surface-card" data-forge-baum>
                                            {{-- Eine Ebene höher — nur, wenn es eine gibt. --}}
                                            <template x-if="code.pfad !== ''">
                                                <li class="border-b border-zinc-200 dark:border-zinc-800">
                                                    <button type="button" class="pressable flex w-full items-center gap-3 p-3 text-start"
                                                            x-on:click="codeHoch()" data-forge-baum-hoch>
                                                        <flux:icon.arrow-up class="size-4 shrink-0 text-muted" />
                                                        <span class="text-sm">{{ __('Eine Ebene höher') }}</span>
                                                    </button>
                                                </li>
                                            </template>
                                            <template x-for="e in code.eintraege" :key="e.name">
                                                <li class="border-b border-zinc-200 last:border-b-0 dark:border-zinc-800">
                                                    <button type="button" class="pressable flex w-full items-center gap-3 p-3 text-start"
                                                            data-forge-baum-eintrag :data-art="e.art" :data-name="e.name"
                                                            x-on:click="e.art === 'tree' ? codeOeffnen(code.pfad ? code.pfad + '/' + e.name : e.name) : dateiOeffnen(code.pfad ? code.pfad + '/' + e.name : e.name)">
                                                        {{-- Die Glyphe ist Zierrat, das Wort trägt:
                                                             `sr-only` sagt die Art an, damit ein
                                                             Screenreader Ordner und Datei
                                                             unterscheidet (WCAG 1.4.1). --}}
                                                        <template x-if="e.art === 'tree'">
                                                            <flux:icon.folder class="size-4 shrink-0 text-brand-800 dark:text-brand-300" />
                                                        </template>
                                                        <template x-if="e.art !== 'tree'">
                                                            <flux:icon.document class="size-4 shrink-0 text-muted" />
                                                        </template>
                                                        <span class="min-w-0 flex-1 truncate text-sm" x-text="e.name"></span>
                                                        <span class="sr-only" x-text="e.art === 'tree' ? @js(__('Verzeichnis')) : @js(__('Datei'))"></span>
                                                    </button>
                                                </li>
                                            </template>
                                            <template x-if="code.eintraege.length === 0 && !code.laedt">
                                                <li class="p-4 text-sm text-muted" data-forge-baum-leer>{{ __('Dieses Verzeichnis ist leer.') }}</li>
                                            </template>
                                        </ul>
                                    </template>

                                    {{-- ── Die Datei ──────────────────────────
                                         Was mit ihr geschieht, ist VOR dem
                                         Rendern entschieden (`dateiArt`): Bilder
                                         an der Endung, Grösse vor Inhalt, die
                                         NUL-Prüfung zuletzt. Eine 6-MB-Karte
                                         wird gar nicht erst dekodiert. --}}
                                    <template x-if="code.datei">
                                        <div class="surface-card" data-forge-datei :data-art="code.art">
                                            <div class="flex flex-wrap items-baseline justify-between gap-2 border-b border-zinc-200 p-3 dark:border-zinc-800">
                                                <span class="text-sm font-semibold" data-forge-datei-name x-text="code.datei"></span>
                                                <span class="flex items-center gap-2 text-xs text-muted">
                                                    <span data-forge-datei-groesse x-text="groessenText(code.groesse)"></span>
                                                    <flux:button size="xs" variant="ghost" icon="x-mark" square
                                                                 x-on:click="dateiSchliessen()" data-forge-datei-zu
                                                                 aria-label="{{ __('Datei schliessen') }}" />
                                                </span>
                                            </div>

                                            <div x-show="code.laedt" class="skeleton m-3 h-24 rounded-tile"></div>

                                            {{-- Zu gross: NICHT rendern, und den Grund
                                                 mit der Zahl nennen. Ein Kasten, der
                                                 sich beim Öffnen aufhängt, ist keine
                                                 Entscheidung. --}}
                                            <template x-if="code.art === 'zu-gross'">
                                                <p class="forge-mass p-4 text-sm text-muted" data-forge-datei-hinweis
                                                   x-text="@js(__('Diese Datei ist mit :groesse zu gross für die Anzeige. Sie liegt vollständig im lokalen Klon.')).replace(':groesse', groessenText(code.groesse))"></p>
                                            </template>

                                            {{-- Binär: dasselbe, mit anderem Grund. --}}
                                            <template x-if="code.art === 'binaer'">
                                                <p class="forge-mass p-4 text-sm text-muted" data-forge-datei-hinweis>{{ __('Diese Datei ist keine Textdatei — ihr Inhalt lässt sich nicht als Text zeigen.') }}</p>
                                            </template>

                                            <template x-if="code.art === 'bild'">
                                    {{-- ── README (P6, seit der GitHub-Parität in der HAUPTSPALTE) ──
                                         GitHub zeigt das README unter der Dateiliste,
                                         nicht in der Seitenspur — genau hier steht es jetzt.
                                         Die Lagen (Ansage vor dem Download, Fortschritt,
                                         Fehler, leer, da) sind unverändert; ein NIP-34-
                                         Repository enthält keinen Code, der Relay kann
                                         keine Teilübertragung (Begründung unten mitgereist). --}}
                                    {{-- ── README (P6) ───────────────────────────────────────
                                    **Ein NIP-34-Repository enthält keinen Code.** Das
                                    30617 trägt clone-URLs, das 30618 Ref-Namen — mehr
                                    nicht. Wer eine Datei zeigen will, muss Git sprechen.

                                    Und der Server kann `filter=blob:none` NICHT (am
                                    2026-08-24 gemessen: `warning: filtering not
                                    recognized by server, ignoring`). Es gibt deshalb
                                    nur eine Bauform: einmal das ganze Repository holen,
                                    danach ist alles lokal. Das ist ein bewusster
                                    Download, kein Nebenbei — auf einem Telefon im
                                    Mobilfunknetz ist es das Datenvolumen des Nutzers.
                                    Deshalb startet hier NICHTS von selbst. --}}
                                    <section class="mt-4" data-forge-readme :data-lage="klon.lage">
                                    {{-- Der Titel steht über ALLEN Lagen: sonst springt
                                    die Überschrift beim Zustandswechsel weg. --}}
                                    <h2 class="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">{{ __('README') }}</h2>

                                    {{-- 1. Wird noch geprüft, ob es schon lokal liegt.
                                    Kein Netz, deshalb sehr kurz — aber nicht
                                    „bereit" behaupten, solange es unbekannt ist. --}}
                                    <div x-show="klon.lage === 'pruefe'" class="skeleton h-16 rounded-tile"></div>

                                    {{-- 2. Keine brauchbare clone-URL. Kein Fehler,
                                    sondern eine Eigenschaft des Repositories. --}}
                                    <template x-if="klon.lage === 'keine-url'">
                                    <p class="forge-mass text-sm text-muted" data-forge-readme-hinweis>{{ __('Dieses Repository nennt keine Adresse, die ein Browser abrufen kann — es gibt nur Zugänge wie ssh oder git.') }}</p>
                                    </template>

                                    {{-- 3. Liegt woanders. Unser signierter Zugang gilt
                                    nur für den eigenen Relay; ein fremder Host
                                    ist kein Defekt, sondern ein Link. --}}
                                    <template x-if="klon.lage === 'fremd'">
                                    <p class="forge-mass text-sm text-muted" data-forge-readme-hinweis>
                                    <span>{{ __('Dieses Repository liegt auf einem fremden Git-Host. Von hier lässt es sich nicht laden — der signierte Zugang gilt nur für das eigene Relay.') }}</span>
                                    <template x-if="klon.fremdUrl">
                                    <a :href="klon.fremdUrl" target="_blank" rel="noopener noreferrer"
                                    class="ms-1 underline" x-text="@js(__('Dort öffnen'))"></a>
                                    </template>
                                    </p>
                                    </template>

                                    {{-- 4. Die ANSAGE vor dem Download.
                                    Was hier NICHT steht, ist eine Zahl für DIESES
                                    Repository: die kennt vorher niemand, und der
                                    Server nennt sie nicht. Eine erfundene Zahl
                                    wäre schlimmer als keine. Stattdessen die
                                    Größenordnung mit ihrem gemessenen Beleg —
                                    ausdrücklich als Beispiel gekennzeichnet. --}}
                                    <template x-if="klon.lage === 'bereit'">
                                    <div class="surface-card p-4" data-forge-readme-ansage>
                                    <p class="forge-mass text-sm">{{ __('Das README steht nicht im Nostr-Ereignis. Um es zu zeigen, lädt dieser Client das ganze Repository herunter — der Relay kann keine Teilübertragung.') }}</p>
                                    <p class="forge-mass mt-1 text-xs text-muted">{{ __('Das sind je nach Repository mehrere Megabyte (beim grössten hier gemessen: 8,3 MB). Im Mobilfunknetz zählt das auf dein Datenvolumen.') }}</p>
                                    <div class="mt-4 flex flex-wrap items-center gap-2">
                                    <flux:button size="sm" variant="primary" icon="arrow-down-tray"
                                    x-on:click="klonLaden()" data-forge-readme-start>{{ __('Repository laden und README zeigen') }}</flux:button>
                                    </div>
                                    </div>
                                    </template>

                                    {{-- 5. Läuft. Abbrechbar — und der Abbruch ist echt:
                                    das Signal geht über `fetchOptions` in den
                                    laufenden `fetch`, nicht in ein Weggucken.

                                    Der Balken erscheint NUR, wenn ein Anteil
                                    berechenbar ist. `total` ist bei mehreren
                                    Phasen 0; ein Balken daraus behauptete
                                    Stillstand, wo Arbeit läuft. Dann steht die
                                    rohe Zahl da — die ist immer wahr. --}}
                                    <template x-if="klon.lage === 'laedt'">
                                    <div class="surface-card p-4" data-forge-readme-laeuft>
                                    <p class="text-sm" role="status" aria-live="polite" data-forge-readme-phase
                                    x-text="klon.fortschritt && klon.fortschritt.phase
                                    ? klon.fortschritt.phase
                                    : @js(__('Wird geladen …'))"></p>
                                    <template x-if="klon.fortschritt && klon.fortschritt.anteil !== null">
                                    <div class="mt-2">
                                    {{-- ── `flux:progress` statt zweier `<div>` ────────────
                                    Hier stand ein handgebauter Balken samt eigenem
                                    `role="progressbar"` und den drei `aria-value*`.
                                    Das kann Flux, und zwar deckungsgleich:
                                    `ui-progress` setzt Rolle, `aria-valuemin`,
                                    `aria-valuenow` und `aria-valuemax` selbst und
                                    hält sie bei jedem Wert nach
                                    (`vendor/livewire/flux-pro/dist/flux.js:10623`
                                    und `:10639`). Auch die FARBE ist dieselbe: der
                                    Stub greift `var(--color-accent)`, und das zeigt
                                    in diesem Haus auf `--color-brand-500`
                                    (`theme.css:47`) — genau das `bg-brand-500`, das
                                    hier von Hand stand.

                                    Der Wert geht über die EIGENSCHAFT, nicht über
                                    das Attribut: `ui-progress` liest `value` beim
                                    Booten einmal aus dem Attribut und beobachtet
                                    danach nur noch `max` (`attributeFilter: ["max"]`).
                                    Ein `x-bind:value` schriebe also genau einmal.
                                    `x-effect` schreibt auf die von `Controllable`
                                    definierte Eigenschaft und damit bei jedem Tick.

                                    **Das kostet den a11y-Riegel vier Träger** — die
                                    Rolle und die drei `aria-value*` stehen ab jetzt
                                    im Vendor-Stub statt in dieser Quelle. Sie sind
                                    nicht weg, sie sind nur nicht mehr HIER zählbar;
                                    der Diff in `EmptyStatesAndA11yTest.php` ist
                                    entsprechend einseitig (vier Deletions, keine
                                    Addition). `aria-label` bleibt an Ort und Stelle:
                                    einen Namen bringt `ui-progress` nicht mit. --}}
                                    {{-- Der Name ist STATISCH und steht deshalb als schlichtes
                                    Attribut: das alte `:aria-label="@js(…)"` war eine
                                    Alpine-Bindung auf ein Zeichenketten-Literal. Auf einer
                                    Flux-Komponente wäre derselbe Doppelpunkt eine
                                    PHP-Bindung und schriebe die Anführungszeichen von
                                    `Js::from()` mit in das Attribut. --}}
                                    <flux:progress class="mt-0"
                                    x-effect="$el.value = Math.round(klon.fortschritt.anteil * 100)"
                                    aria-label="{{ __('Fortschritt des Downloads') }}" />
                                    <p class="mt-1 text-xs text-muted" data-forge-readme-zahl
                                    x-text="$num(klon.fortschritt.geladen) + ' / ' + $num(klon.fortschritt.gesamt)"></p>
                                    </div>
                                    </template>
                                    {{-- Kein Anteil: dann die rohe Zahl, ohne Balken. --}}
                                    <template x-if="klon.fortschritt && klon.fortschritt.anteil === null && klon.fortschritt.geladen > 0">
                                    <p class="mt-1 text-xs text-muted" data-forge-readme-zahl
                                    x-text="$plural(klon.fortschritt.geladen, '1 Objekt', ':count Objekte')"></p>
                                    </template>
                                    <div class="mt-4">
                                    <flux:button size="sm" variant="ghost" icon="x-mark"
                                    x-on:click="klonAbbrechen()" data-forge-readme-abbruch>{{ __('Abbrechen') }}</flux:button>
                                    </div>
                                    </div>
                                    </template>

                                    {{-- 6. Fehler. Der Grund steht ausgeschrieben — kein
                                    „Fehler beim Laden". --}}
                                    <template x-if="klon.lage === 'fehler'">
                                    <flux:callout variant="danger" icon="exclamation-triangle" class="forge-mass" data-forge-readme-fehler>
                                    <flux:callout.text x-text="klonFehlerText()"></flux:callout.text>
                                    <x-slot name="actions">
                                    <flux:button size="sm" variant="ghost" icon="arrow-path" x-on:click="klonLaden()">{{ __('Erneut versuchen') }}</flux:button>
                                    </x-slot>
                                    </flux:callout>
                                    </template>

                                    {{-- 7. Geladen, aber es GIBT kein README. Eine eigene
                                    Aussage: ein leerer Kasten sähe aus wie ein
                                    Fehler. --}}
                                    <template x-if="klon.lage === 'leer'">
                                    <p class="forge-mass text-sm text-muted" data-forge-readme-hinweis>{{ __('Dieses Repository hat keine README-Datei in seinem Wurzelverzeichnis.') }}</p>
                                    </template>

                                    {{-- 8. Da. --}}
                                    <template x-if="klon.lage === 'da'">
                                    <div class="surface-card p-4" data-forge-readme-inhalt>
                                    <div class="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                                    <span class="text-xs font-semibold text-muted" x-text="klon.name" data-forge-readme-name></span>
                                    <span class="flex items-center gap-2">
                                    {{-- Woher der Inhalt stammt, als Kurz-Hash. Ohne
                                    ihn behauptete die Fläche Aktualität, die sie
                                    nicht kennt: der Klon ist ein Stand, kein Live-Blick. --}}
                                    <template x-if="klon.commit">
                                    <span class="text-xs text-muted" data-forge-readme-commit
                                    x-text="@js(__('Stand :commit')).replace(':commit', klon.commit)"></span>
                                    </template>
                                    <flux:button size="xs" variant="ghost" icon="arrow-path"
                                    x-on:click="klonNeuLaden()" data-forge-readme-neu
                                    aria-label="{{ __('Repository neu laden') }}" />
                                    </span>
                                    </div>
                                    {{-- Derselbe Renderer wie Artikel und Issue
                                    (`markdown-it`, `html:false`). Ein zweiter
                                    für Fremdtext wären zwei Sicherheitszusagen. --}}
                                    <div x-show="klon.html" class="article-content forge-mass" x-html="klon.html"></div>
                                    <pre x-show="klon.text" class="forge-mass overflow-x-auto whitespace-pre-wrap text-sm" x-text="klon.text"></pre>
                                    </div>
                                    </template>
                                    </section>
                                                {{-- `alt` ist der DATEINAME: ein
                                                     erfundener Bildinhalt wäre eine
                                                     Behauptung über etwas, das wir
                                                     nicht kennen. --}}
                                                <img :src="code.bildUrl" :alt="code.datei" data-forge-datei-bild
                                                     class="max-h-[32rem] max-w-full object-contain p-4" />
                                            </template>

                                            <template x-if="code.gekuerzt">
                                                <p class="forge-mass border-b border-zinc-200 px-4 py-2 text-xs text-muted dark:border-zinc-800"
                                                   data-forge-datei-gekuerzt
                                                   x-text="@js(__('Gezeigt werden :gezeigt von :gesamt Zeilen.')).replace(':gezeigt', $num(3000)).replace(':gesamt', $num(code.zeilen))"></p>
                                            </template>

                                            <div x-show="code.html" class="article-content forge-mass p-4" x-html="code.html"></div>
                                            <pre x-show="code.text" data-forge-datei-text
                                                 class="overflow-x-auto whitespace-pre p-4 text-xs leading-relaxed"><code x-text="code.text"></code></pre>
                                        </div>
                                    </template>

                                    {{-- ── Was lokal liegt ────────────────────
                                         Mit Baum und Dateianzeige wird das Öffnen
                                         mehrerer Repositories zum Normalfall. Wer
                                         Daten auf dem Gerät ablegt, sagt wo und
                                         wie viel — und lässt sie wieder entfernen.

                                         Die Zahl je Klon ist die SUMME DER
                                         DATEIGRÖSSEN, gemessen, nicht geschätzt.
                                         Was IndexedDB darum herum verwaltet, sagt
                                         der Browser nur für den ganzen Ursprung;
                                         deshalb steht diese Zahl getrennt daneben
                                         und nicht anteilig auf die Repos verteilt. --}}
                                    <div class="mt-4">
                                        <flux:button size="xs" variant="ghost" icon="circle-stack"
                                                     x-on:click="speicherUmschalten()" data-forge-speicher-schalter
                                                     ::aria-expanded="speicher.offen ? 'true' : 'false'">{{ __('Lokal gespeichert') }}</flux:button>
                                        <template x-if="speicher.offen">
                                            <div class="surface-card mt-2 p-3" data-forge-speicher>
                                                <p class="text-xs text-muted" data-forge-speicher-ursprung
                                                   x-show="speicher.kontingent > 0"
                                                   x-text="@js(__('Dieser Ursprung belegt :belegt von :kontingent, die der Browser ihm zugesteht.')).replace(':belegt', groessenText(speicher.belegt)).replace(':kontingent', groessenText(speicher.kontingent))"></p>
                                                <p class="text-xs text-muted" x-show="speicher.kontingent === 0">{{ __('Wie viel Speicher der Browser diesem Ursprung zugesteht, sagt er hier nicht.') }}</p>
                                                <ul class="mt-2 divide-y divide-zinc-200 dark:divide-zinc-800">
                                                    <template x-for="k in speicher.klone" :key="k.owner + '/' + k.dtag">
                                                        <li class="flex flex-wrap items-center justify-between gap-2 py-2" data-forge-speicher-klon :data-dtag="k.dtag">
                                                            <span class="min-w-0 flex-1 truncate text-sm" x-text="k.dtag"></span>
                                                            <span class="text-xs text-muted" x-text="groessenText(k.nutzdaten)"></span>
                                                            <flux:button size="xs" variant="ghost" icon="trash"
                                                                         x-on:click="klonEntfernen(k.owner, k.dtag)"
                                                                         data-forge-speicher-entfernen>{{ __('Entfernen') }}</flux:button>
                                                        </li>
                                                    </template>
                                                    <template x-if="speicher.klone.length === 0">
                                                        <li class="py-2 text-sm text-muted" data-forge-speicher-leer>{{ __('Es liegt nichts lokal.') }}</li>
                                                    </template>
                                                </ul>
                                            </div>
                                        </template>
                                    </div>
                                </div>
                            </template>
                        </div>

                        {{-- ── Patches (1617, P5) ────────────────────────────────
                             **Der Diff steht IM Ereignis.** Ein kind 1617 trägt die
                             `git format-patch`-Ausgabe als `content` — kein Clone,
                             keine HTTP-Brücke, keine Auth. Das ist die einzige
                             Codeanzeige von NIP-34, die ein Browser-Client ohne
                             Git-Zugriff überhaupt zeigen kann, und bis zum
                             2026-08-23 waren wir der einzige von drei Clients
                             (Amethyst, Buzz Desktop, wir), der sie nicht zeigte.

                             Gelesen wird der Text in `js/forgeDiff.ts`, nicht hier:
                             derselbe Leser trägt später den PR-Diff und die
                             Buzz-Diff-Nachricht (kind 40008). --}}
                        <div x-show="tab === 'patches'" x-cloak>
                            <template x-if="view.patches.length === 0">
                                <div class="surface-card empty-state px-6 py-12 text-center" data-forge-empty="patches">
                                    <span class="mx-auto flex size-12 items-center justify-center rounded-tile bg-zinc-100 dark:bg-zinc-800">
                                        <flux:icon.document-text class="size-6 text-zinc-500 dark:text-zinc-400" />
                                    </span>
                                    <flux:heading size="lg" class="mt-4">{{ __('Noch keine Patches.') }}</flux:heading>
                                    <flux:text class="mx-auto mt-1 max-w-sm text-sm text-muted">{{ __('Ein Patch trägt seine Änderung selbst — sobald jemand einen einreicht, steht er hier.') }}</flux:text>
                                </div>
                            </template>

                            <section x-show="sichtbarePatches().length > 0" class="surface-card">
                                {{-- Kopfstreifen wie oben bei den Issues (P5). --}}
                                <div class="forge-kartenkopf">
                                    <span class="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{{ __('Patches') }}</span>
                                    <span class="shrink-0 text-xs text-muted" x-text="$num(sichtbarePatches().length)"></span>
                                </div>
                                <ul>
                                <template x-for="patch in sichtbarePatches()" :key="patch.id">
                                    <li class="border-b border-zinc-200 last:border-b-0 dark:border-zinc-800" data-forge-patch :data-status="patch.status" :data-id="patch.id">
                                        {{-- Zwei Ränge wie an der Issue- und der PR-Zeile.
                                             Hier fielen zwei Blockzeilen weg: der Serienmarker
                                             stand als eigene Versalzeile unter dem Autorsatz,
                                             obwohl er dieselbe Frage beantwortet („woher kommt
                                             dieser Eintrag") und deshalb in die Metazeile
                                             gehört. --}}
                                        <button type="button" class="forge-vorgangskopf pressable block w-full p-4 text-start"
                                                x-on:click="toggle(patch.id)" :aria-expanded="open[patch.id] ? 'true' : 'false'">
                                            <span class="forge-vorgangszeile">
                                                {{-- Typ-Glyphe: dasselbe Zeichen wie am Reiter
                                                     „Patches". Ein Patch TRÄGT seine Änderung als
                                                     Text mit sich — ein Dokument, kein Verweis
                                                     auf einen Branch. --}}
                                                <flux:icon.document-text variant="micro" class="forge-vz-glyphe size-4 shrink-0" />

                                                <span class="forge-vz-titel">
                                                    <span class="forge-vz-name" data-forge-patch-titel
                                                          x-text="patch.title || @js(__('Ohne Titel'))"></span>
                                                </span>

                                                <span class="forge-vz-meta flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
                                                    <span class="font-semibold tracking-tight" x-text="'#' + pr.id.slice(0, 7)"></span>
                                                    <span class="min-w-0 truncate"
                                                          x-text="@js(__(':name hat ihn eingereicht.')).split(':name').join(patch.authorName) + ' · ' + patch.timeLabel"></span>
                                                    {{-- Serien-Marker. Ein `git format-patch` über
                                                         drei Commits erzeugt DREI Ereignisse; das
                                                         Modell fasst sie bewusst nicht zusammen
                                                         (die Kette kann im Bestand Lücken haben,
                                                         und aus einer Lücke würde still eine
                                                         falsche Serienlänge). Der Marker sagt
                                                         wenigstens, dass es eine Serie gibt —
                                                         seit P3 als Wort IN der Metazeile statt
                                                         als eigene Versalzeile darunter. --}}
                                                    <template x-if="patch.isRoot || patch.isRootRevision || patch.inReplyTo">
                                                        <span data-forge-patch-serie
                                                              x-text="'· ' + (patch.isRootRevision
                                                                  ? @js(__('Beginn einer Neufassung'))
                                                                  : (patch.isRoot ? @js(__('Beginn einer Serie')) : @js(__('Teil einer Serie'))))"></span>
                                                    </template>
                                                    {{-- Die Kennzahlen des Diffs. `+`/`−` stehen
                                                         als ZEICHEN da und nicht nur als Farbe
                                                         (WCAG 1.4.1); die Farbe kam mit P1 und
                                                         ist gemessen (5,20–6,20:1 hell,
                                                         5,83–6,21:1 dunkel). --}}
                                                    <template x-if="patch.stat.files > 0">
                                                        <span class="inline-flex shrink-0 items-center gap-1.5" data-forge-patch-stat>
                                                            <span x-text="$plural(patch.stat.files, '1 Datei', ':count Dateien')"></span>
                                                            <flux:badge size="sm" color="green" data-forge-stat-plus x-text="'+' + patch.stat.additions" />
                                                            <flux:badge size="sm" color="red" data-forge-stat-minus x-text="'−' + patch.stat.deletions" />
                                                        </span>
                                                    </template>
                                                    {{-- Der Anker, eckig und in Mono — dieselbe
                                                         Bauform wie an der PR-Zeile. --}}
                                                    <template x-if="patch.shortCommit">
                                                        <flux:badge size="sm" class="forge-anker shrink-0 tracking-tight"
                                                                    data-forge-anker="head"
                                                                    x-text="patch.shortCommit" />
                                                    </template>
                                                </span>

                                                <span class="forge-vz-leute">
                                                    <template x-if="patch.commentCount > 0">
                                                        <span class="inline-flex items-center gap-1 text-xs text-muted">
                                                            <flux:icon.chat-bubble-left-ellipsis variant="micro" class="size-4" />
                                                            <span x-text="patch.commentCount"></span>
                                                        </span>
                                                    </template>
                                                </span>

                                                <x-group::forge-status-badge klasse="forge-vz-zustand"
                                                                             status="patch.status" label="statusText(patch.status)" />
                                            </span>
                                        </button>

                                        <template x-if="open[patch.id]">
                                            <div class="border-t border-zinc-200 px-4 py-3 dark:border-zinc-800">
                                                {{-- Die Commit-Beschreibung. `x-text`, NICHT
                                                     `x-html`: das ist Klartext aus einer
                                                     Commit-Nachricht, kein Markdown. Durch
                                                     den Renderer geschickt, würden Sternchen
                                                     zu Kursiv und Unterstriche verschwänden
                                                     aus Variablennamen. --}}
                                                <p x-show="patch.body" class="forge-mass whitespace-pre-wrap text-sm" data-forge-patch-body x-text="patch.body"></p>

                                                {{-- ── Wo dieser Patch gelandet ist (P7b) ────────
                                                     Derselbe Pfad wie beim Pull Request: ein
                                                     1631 trägt `merge-commit` und
                                                     `applied-as-commits`, und `mergeRow()` in
                                                     `forge.ts` bildet beide Wurzelarten über
                                                     dieselbe Funktion ab. Bei einem Patch ist
                                                     „angewandt als" der häufigere der beiden —
                                                     ein Patch wird gecherrypickt, nicht
                                                     gemerged. --}}
                                                <template x-if="patch.shortMergeCommit || patch.shortAppliedAsCommits.length > 0">
                                                    <p class="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted"
                                                       data-forge-landung>
                                                        <template x-if="patch.shortMergeCommit">
                                                            <span class="inline-flex items-center gap-1.5">
                                                                <span>{{ __('Zusammengeführt als') }}</span>
                                                                <flux:badge size="sm" class="forge-anker tracking-tight"
                                                                            data-forge-merge-commit
                                                                            x-text="patch.shortMergeCommit" />
                                                            </span>
                                                        </template>
                                                        <template x-if="patch.shortAppliedAsCommits.length > 0">
                                                            <span class="inline-flex flex-wrap items-center gap-1.5">
                                                                <span>{{ __('Angewandt als') }}</span>
                                                                <template x-for="c in patch.shortAppliedAsCommits" :key="c">
                                                                    <flux:badge size="sm" class="forge-anker tracking-tight"
                                                                                data-forge-applied-as
                                                                                x-text="c" />
                                                                </template>
                                                            </span>
                                                        </template>
                                                    </p>
                                                </template>

                                                {{-- ── Warum dieses Diff-Markup hier NOCH einmal steht
                                                     Dieselbe Bauform liegt seit P7b als Komponente
                                                     vor (`components/forge-pr-diff.blade.php`) und
                                                     gehört genau einmal beschrieben. Der Tausch ist
                                                     hier trotzdem NICHT gemacht, und der Grund ist
                                                     kein technischer: `EmptyStatesAndA11yTest` zählt
                                                     ARIA-Träger aus dem QUELLTEXT dieser Datei —
                                                     wandern die beiden `aria-hidden` an den
                                                     Zeilennummern in eine Komponente, sinkt die
                                                     kalibrierte Zahl von 33 auf 31 und der Test wird
                                                     rot. Die Zusammenführung ist fällig, aber nur
                                                     GEMEINSAM mit dem Nachziehen jener Zahl. --}}
                                                {{-- Der gekürzte Diff sagt es an. Eine
                                                     stillschweigend gekürzte Datei wäre eine
                                                     falsche Aussage über den Patch. --}}
                                                <template x-if="patch.diff.truncated">
                                                    <flux:callout variant="secondary" icon="information-circle" class="forge-mass mt-4" data-forge-patch-gekuerzt>
                                                        <flux:callout.text>{{ __('Dieser Patch ist zu lang für die vollständige Anzeige — es werden nicht alle Zeilen gezeigt.') }}</flux:callout.text>
                                                    </flux:callout>
                                                </template>

                                                <template x-if="patch.diff.files.length > 0">
                                                    <div class="forge-diff mt-4" data-forge-diff>
                                                        <template x-for="datei in patch.diff.files" :key="datei.path + datei.change">
                                                            <div class="forge-diff-datei" data-forge-diff-datei :data-change="datei.change">
                                                                <div class="forge-diff-kopf">
                                                                    {{-- Das Wort steht neben dem Pfad, nicht
                                                                         nur als Farbe oder Symbol. --}}
                                                                    <span class="forge-diff-art"
                                                                          x-text="datei.change === 'add' ? @js(__('hinzugefügt'))
                                                                              : (datei.change === 'del' ? @js(__('gelöscht'))
                                                                              : (datei.change === 'ren' ? @js(__('umbenannt')) : @js(__('geändert'))))"></span>
                                                                    <span class="forge-diff-pfad" x-text="datei.path"></span>
                                                                    {{-- Grün/Rot wie in der Patch-Zeile (P1) —
                                                                         und im selben Zug fällt hier das
                                                                         `text-forge-erledigt`, das drei Zeilen
                                                                         tiefer im Diff-KÖRPER dieselbe Sache
                                                                         schon grün tönte. Das Vorzeichen bleibt
                                                                         als Zeichen im Text (WCAG 1.4.1). --}}
                                                                    <span class="forge-diff-zahlen">
                                                                        <flux:badge size="sm" color="green" data-forge-diff-plus x-text="'+' + datei.additions" />
                                                                        <flux:badge size="sm" color="red" data-forge-diff-minus x-text="'−' + datei.deletions" />
                                                                    </span>
                                                                </div>
                                                                <template x-if="datei.binary">
                                                                    <p class="forge-diff-binaer" data-forge-diff-binaer>{{ __('Binärdatei — der Inhalt lässt sich nicht als Text zeigen.') }}</p>
                                                                </template>
                                                                <template x-if="!datei.binary">
                                                                    <div class="forge-diff-koerper">
                                                                        <template x-for="(zeile, i) in datei.lines" :key="i">
                                                                            <div class="forge-diff-zeile" :data-kind="zeile.kind">
                                                                                {{-- Zeilennummern sind
                                                                                     Orientierung fürs Auge und
                                                                                     werden nicht vorgelesen —
                                                                                     sonst läse ein Screenreader
                                                                                     vor jeder Codezeile zwei
                                                                                     Zahlen. --}}
                                                                                <span class="forge-diff-nr" aria-hidden="true" x-text="zeile.oldNo || ''"></span>
                                                                                <span class="forge-diff-nr" aria-hidden="true" x-text="zeile.newNo || ''"></span>
                                                                                {{-- Das Vorzeichen IM Text, nicht
                                                                                     nur in der Farbe. Ohne es
                                                                                     wäre die Bedeutung allein
                                                                                     farbcodiert. --}}
                                                                                <span class="forge-diff-zeichen" x-text="zeile.kind === 'add' ? '+' : (zeile.kind === 'del' ? '-' : ' ')"></span>
                                                                                <span class="forge-diff-text" x-text="zeile.text"></span>
                                                                            </div>
                                                                        </template>
                                                                    </div>
                                                                </template>
                                                            </div>
                                                        </template>
                                                    </div>
                                                </template>

                                                {{-- Kommentare — dieselbe Bauform wie bei
                                                     Issue und PR. --}}
                                                <template x-if="patch.comments.length > 0">
                                                    <ul class="mt-4 space-y-3 border-t border-zinc-200 pt-3 dark:border-zinc-800">
                                                        <template x-for="comment in patch.comments" :key="comment.id">
                                                            <li class="text-sm">
                                                                <p class="text-xs text-muted">
                                                                    <span class="font-semibold" x-text="comment.authorName"></span>
                                                                    <span x-text="' · ' + comment.timeLabel"></span>
                                                                </p>
                                                                <div x-show="comment.html" class="article-content forge-mass mt-1" x-html="comment.html"></div>
                                                            </li>
                                                        </template>
                                                    </ul>
                                                </template>
                                            </div>
                                        </template>
                                    </li>
                                </template>
                            </ul>
                            </section>
                        </div>

                        {{-- ── Pull Requests ────────────────────────────────────── --}}
                        <div x-show="tab === 'pulls'" x-cloak>
                            <template x-if="view.pullRequests.length === 0">
                                <div class="surface-card empty-state px-6 py-12 text-center" data-forge-empty="pulls">
                                    <span class="mx-auto flex size-12 items-center justify-center rounded-tile bg-zinc-100 dark:bg-zinc-800">
                                        <flux:icon.arrows-right-left class="size-6 text-zinc-500 dark:text-zinc-400" />
                                    </span>
                                    <flux:heading size="lg" class="mt-4">{{ __('Noch keine Pull Requests.') }}</flux:heading>
                                    <flux:text class="mx-auto mt-1 max-w-sm text-sm text-muted">{{ __('Sobald jemand einen Pull Request eröffnet, erscheint er hier.') }}</flux:text>
                                </div>
                            </template>

                            <section x-show="sichtbarePulls().length > 0" class="surface-card">
                                {{-- Kopfstreifen wie oben bei den Issues (P5). --}}
                                <div class="forge-kartenkopf">
                                    <span class="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{{ __('Pull Requests') }}</span>
                                    <span class="shrink-0 text-xs text-muted" x-text="$num(sichtbarePulls().length)"></span>
                                </div>
                                <ul>
                                <template x-for="pr in sichtbarePulls()" :key="pr.id">
                                    {{-- `data-forge-pr` + `data-id`/`data-status`: die E2E-Anker der Zeile.
                                         Das Sprungziel eines geteilten Links ist seit P1 die EIGENE
                                         ROUTE (`/forge/{naddr}/pulls/{id}`) — siehe die Issue-Zeile. --}}
                                    <li class="border-b border-zinc-200 last:border-b-0 dark:border-zinc-800"
                                        data-forge-pr tabindex="-1"
                                        :data-status="pr.status" :data-id="pr.id">
                                        {{-- Die ganze Zeile ist der LINK auf die Einzelansicht — seit P1
                                             (GitHub-Parität): kein Akkordeon, kein `button`, sondern
                                             `wire:navigate` auf die Route. --}}
                                        <a :href="vorgangHrefFuer(pr, 'pr')" wire:navigate data-forge-vorgang-link
                                           class="forge-vorgangskopf pressable block w-full p-4 text-start">
                                            <span class="forge-vorgangszeile">
                                                {{-- Typ-Glyphe: dasselbe Zeichen wie am Reiter
                                                     „Pull Requests". Zwei Pfeile gegeneinander —
                                                     das ist die Sache selbst, und es kollidiert
                                                     mit keinem der vier Zustandszeichen. --}}
                                                <flux:icon.arrows-right-left variant="micro" class="forge-vz-glyphe size-4 shrink-0"
                                                             ::class="pr.status === 'open' || pr.status === 'draft' ? 'text-emerald-600 dark:text-emerald-400' : (pr.status === 'closed' ? 'text-red-600 dark:text-red-400' : 'text-purple-600 dark:text-purple-400')" />

                                                <span class="forge-vz-titel">
                                                    <span class="forge-vz-name" x-text="pr.title || @js(__('Ohne Titel'))"></span>
                                                </span>

                                                {{-- ── Rang 2: EIN Satz, EIN Anker ────────────
                                                     Wer hat ihn eröffnet, aus welchem Branch,
                                                     wann — als ganzer Satz, nicht als Feldsalat.
                                                     Die Teile stehen als Platzhalter im Katalog,
                                                     damit der Satz übersetzbar bleibt. --}}
                                                <span class="forge-vz-meta flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
                                                    <span class="min-w-0 truncate"
                                                          x-text="(pr.branch
                                                              ? @js(__(':name hat ihn eröffnet aus :branch.')).split(':branch').join(pr.branch)
                                                              : @js(__(':name hat ihn eröffnet.'))).split(':name').join(pr.authorName)
                                                              + ' · ' + pr.timeLabel"></span>
                                                    {{-- ── Der Anker: RECHTECK mit Mono-Ziffern ──
                                                         Die zweite der drei Chip-Rollen, und die
                                                         einzige, die eckig bleibt. Er ist der
                                                         Punkt, an dem das Auge in einer grauen
                                                         Zeile einrastet (brand-800 auf
                                                         `bg-brand-500/10`, gemessen 5,92:1).

                                                         GENAU EINER je Zeile, und er zeigt die
                                                         Sache, die gerade zählt: ist der PR
                                                         zusammengeführt, ist das der
                                                         MERGE-Commit — der Kopf-Commit
                                                         beantwortet dann nichts mehr. Sonst der
                                                         Kopf-Commit.

                                                         `shortMergeCommit`/`shortCommit` und
                                                         NICHT `…​.slice(0, 7)` im Markup: die
                                                         Kürzung trägt die Formprüfung mit, sonst
                                                         würde aus `["merge-commit","master"]`
                                                         eine Pille namens „master".

                                                         `applied-as-commits` (eine Liste) und
                                                         `merge-base` gehören nicht in eine
                                                         Zeilenübersicht — sie stehen im
                                                         aufgeklappten Rumpf (P7b). --}}
                                                    <template x-if="pr.shortMergeCommit">
                                                        <flux:badge size="sm" class="forge-anker shrink-0 tracking-tight"
                                                                    icon="arrows-pointing-in" data-forge-anker="merge"
                                                                    x-text="pr.shortMergeCommit" />
                                                    </template>
                                                    <template x-if="!pr.shortMergeCommit && pr.shortCommit">
                                                        <flux:badge size="sm" class="forge-anker shrink-0 tracking-tight"
                                                                    data-forge-anker="head"
                                                                    x-text="pr.shortCommit" />
                                                    </template>
                                                </span>

                                                <span class="forge-vz-leute">
                                                    {{-- Reviewer als Gesichter mit Plakette statt
                                                         als Chip-Zeile mit Versalwort. Wer
                                                         freigegeben hat, trägt ein Häkchen; wer
                                                         Änderungen erbittet, ein Ausrufezeichen.
                                                         Die Aussage hängt an der FORM (1.4.1).

                                                         Die Freigabezahl daneben bleibt: eine
                                                         Freigabe kann von jemandem kommen, der nie
                                                         angefragt wurde (der Repo-Eigentümer darf
                                                         das) — ohne sie verschwände seine Freigabe
                                                         zwischen den Gesichtern. --}}
                                                    <template x-if="pr.reviewerPeople.length > 0">
                                                        <x-group::forge-personen-stapel
                                                            personen="pr.reviewerPeople"
                                                            entscheidung="person.decision"
                                                            anker="data-forge-reviewer"
                                                            data-forge-reviewers
                                                            :sr-eins="__('Reviewer: :namen')"
                                                            :sr-viele="__(':count Reviewer: :namen')" />
                                                    </template>
                                                    <template x-if="pr.approvals.length > 0">
                                                        <span class="text-xs text-muted" data-forge-approvals
                                                              x-text="$plural(pr.approvals.length, '1 Freigabe', ':count Freigaben')"></span>
                                                    </template>
                                                    <template x-if="pr.commentCount > 0">
                                                        <span class="inline-flex items-center gap-1 text-xs text-muted">
                                                            <flux:icon.chat-bubble-left-ellipsis variant="micro" class="size-4" />
                                                            <span x-text="pr.commentCount"></span>
                                                        </span>
                                                    </template>
                                                </span>

                                                <x-group::forge-status-badge klasse="forge-vz-zustand"
                                                                             status="pr.status" label="statusText(pr.status)" />
                                            </span>
                                        </a>
                                    </li>
                                </template>
                            </ul>
                            </section>
                        </div>

                        {{-- ── Aktivität ────────────────────────────────────────── --}}
                        <div x-show="tab === 'activity'" x-cloak>
                            <template x-if="view.activityGroups.length === 0">
                                <div class="surface-card empty-state px-6 py-12 text-center" data-forge-empty="activity">
                                    <span class="mx-auto flex size-12 items-center justify-center rounded-tile bg-zinc-100 dark:bg-zinc-800">
                                        <flux:icon.clock class="size-6 text-zinc-500 dark:text-zinc-400" />
                                    </span>
                                    <flux:heading size="lg" class="mt-4">{{ __('Noch keine Aktivität.') }}</flux:heading>
                                    <flux:text class="mx-auto mt-1 max-w-sm text-sm text-muted">{{ __('Sobald jemand etwas pusht oder ein Issue eröffnet, erscheint es hier.') }}</flux:text>
                                </div>
                            </template>

                            {{-- Dieselbe Ref-Spur wie auf der Übersicht — Begründung der
                                 Geometrie und der `:last-child`-Kante steht dort
                                 ausführlich (`⚡forge.blade.php`, Abschnitt „Die
                                 Ref-Spur"). Zwei Zeitleisten im selben Produkt dürfen
                                 nicht zwei Bauformen haben.

                                 Das gilt auch für die Tages-Trenner: dieselben vier
                                 Buckets, dieselben Wörter, dasselbe <h2>. Der einzige
                                 Unterschied zur Übersicht ist, dass hier KEIN Repo-Name
                                 in der Zeile steht — er ist für alle Zeilen derselbe
                                 und steht bereits im Seitenkopf. --}}
                            <div x-show="view.activityGroups.length > 0" class="surface-card px-4 pb-2">
                                <template x-for="bucket in view.activityGroups" :key="bucket.label">
                                    <section>
                                        <h2 class="pb-1 pt-4 text-xs font-semibold uppercase tracking-wider text-muted"
                                            x-text="bucket.label"></h2>
                                        {{-- ── Dieselbe Zeitleiste wie auf der Übersicht (P5) ──────
                                             `flux:timeline` statt der handgezogenen Linie; die
                                             ganze Herleitung steht in `⚡forge.blade.php` an der
                                             Aktivitätsspur (zwei Magic Numbers, die 1,26:1-Linie,
                                             die Alpine-Template-Falle und der Grund, warum
                                             `status="complete"` hier NICHT gesetzt ist).

                                             `x-bind:` ausgeschrieben und nicht `::`: `flux:timeline*`
                                             wird als einziges Flux-Bauteil NICHT gefaltet, und nur
                                             der Faltungs-Pfad wandelt `::attr` in `:attr`. Auf einer
                                             ungefalteten Komponente bleibt `::` wörtlich im HTML
                                             stehen und ist ein totes Attribut. --}}
                                        {{-- Der BEZUGSRAHMEN des Knotens (P7b-N). Ein Element kann seinen
                                             eigenen Container nicht abfragen, deshalb die Hülle. --}}
                                        <div class="forge-zeitleiste">
                                        <flux:timeline align="start" class="pb-2">
                                            <template x-for="row in bucket.items" :key="row.id">
                                                <flux:timeline.item data-forge-activity x-bind:data-type="row.type">
                                                    {{-- Avatar auf breiter Spur, Marke auf schmaler:
                                                         28 px Knoten plus 12 px Rinne kosten schmal
                                                         40 px Textbreite; der Name steht ohnehin im
                                                         Satz. Entschieden wird das über
                                                         `@container zeitleiste` — bis zum 2026-08-27
                                                         stand hier `x-if="zweispaltig"`, und das Feld
                                                         gibt es in `nostrForgeRepo` NICHT. Beide Zweige
                                                         warfen, KEINER rendete. Herleitung in
                                                         `theme.css` an `.forge-zeitleiste`. --}}
                                                    <flux:timeline.indicator variant="bare">
                                                        {{-- BEIDE Knoten stehen im DOM; welcher SICHTBAR ist,
                                                             entscheidet `@container zeitleiste` in
                                                             `theme.css`. Kein `x-if` mehr — die Herleitung
                                                             steht dort und an der Klasse. --}}
                                                        <span class="forge-knoten-marke"
                                                              x-bind:class="row.badge ? 'ring-2 ring-brand-700 dark:ring-brand-500' : ''"></span>
                                                        {{-- Der Ring markiert Ereignisse, die ein echtes
                                                             Git-Objekt erzeugt haben; dieselbe Aussage trägt
                                                             der Kurzhash als TEXT in der Metazeile. --}}
                                                        <span class="forge-knoten-gesicht"
                                                              x-bind:class="row.badge ? 'ring-2 ring-brand-700 dark:ring-brand-500' : ''">
                                                            <x-group::nostr-avatar picture="row.actorPicture" name="row.actorName" size="1.75rem" lazy />
                                                        </span>
                                                    </flux:timeline.indicator>
                                                    <flux:timeline.content class="min-w-0 py-3">
                                                    <p class="text-sm leading-snug">
                                                        {{-- Roher Schlüssel im `title` — dieselbe
                                                             Begründung wie in `⚡forge.blade.php` (F6). --}}
                                                        <span class="font-semibold" x-text="row.actorName"
                                                              x-bind:title="row.actor"></span>
                                                        <span class="text-muted" x-text="' ' + row.verb + ' '"></span>
                                                        <span class="font-medium" x-text="row.object"></span>
                                                    </p>
                                                    {{-- `<div>` und nicht `<p>`, und beide Marken von
                                                         Flux: identisch zur Aktivitätszeile auf
                                                         `⚡forge.blade.php` — es ist derselbe Strom,
                                                         nur auf ein Repository verengt. Die Herleitung
                                                         steht dort (Kurzfassung: `flux:badge` rendert
                                                         ein `<div>`, und ein `<div>` in einem `<p>`
                                                         schließt das `<p>` beim Parsen vorzeitig). --}}
                                                    <div class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
                                                        {{-- KURZ in der Zeile, VOLL im Tooltip —
                                                             Begründung in `⚡forge.blade.php`. --}}
                                                        <span x-text="row.timeLabel" x-bind:title="row.fullLabel"></span>
                                                        <template x-if="row.badge">
                                                            <flux:badge size="sm" class="bg-brand-500/10 font-semibold tracking-tight text-brand-800 dark:bg-brand-500/10 dark:text-brand-300"
                                                                        x-text="row.badge" />
                                                        </template>
                                                        <template x-if="row.statusLabel">
                                                            <flux:badge size="sm" x-text="row.statusLabel" />
                                                        </template>
                                                    </div>
                                                    <template x-if="row.body">
                                                        <p class="forge-mass mt-1 line-clamp-2 text-sm text-zinc-700 dark:text-zinc-300" x-text="row.body"></p>
                                                    </template>
                                                    </flux:timeline.content>
                                                </flux:timeline.item>
                                            </template>
                                        </flux:timeline>
                                        </div>
                                    </section>
                                </template>
                            </div>
                        </div>
                    </div>{{-- /forge-repo-werkbank --}}

                    <aside class="forge-repo-spur min-w-0" aria-label="{{ __('Über dieses Repository') }}">
                        {{-- ── Kopf des Repositories ──────────────────────────────
                             Zwei Teile mit unterschiedlichem Rang statt eines
                             Formulars: oben die Identität (Beschreibung + der Befehl,
                             mit dem man an das Repository kommt), unten das Datenblatt.

                             Das Datenblatt ist EINSPALTIG mit Haarlinien-Zeilen und
                             nicht mehr `sm:grid-cols-2`. Grund ist der reale Bestand:
                             am Ziel-Relay hat ein Repository oft nur EINEN dieser
                             Einträge (das leere Testrepo hat genau „Branches"). Ein
                             zweispaltiges Raster stellte diesen einen Eintrag neben
                             eine leere Hälfte und sah aus, als fehle etwas. Eine
                             Zeilenliste ist bei einem Eintrag genauso richtig wie bei
                             dreien.

                             Die Kante sitzt OBEN und die immer vorhandene Zeile
                             („Branches") steht als erste ohne Kante — `divide-y` oder
                             `first:` wären hier falsch: die bedingten Zeilen hängen an
                             `<template x-if>`, und Alpine lässt das Template als Kind
                             im DOM stehen. Welches Kind das erste IST, hängt damit an
                             den Daten; welches immer da ist, weiß dagegen die View. --}}
                        <div class="surface-card overflow-hidden">
                            <div class="p-4">
                                <p x-show="view.repo.description" class="forge-mass text-sm text-zinc-700 dark:text-zinc-300" x-text="view.repo.description"></p>

                                {{-- Clone-URL. Kein Link: sie gehört in ein Terminal,
                                     nicht in einen Browser-Tab — der Git-Endpunkt
                                     beantwortet einen Browser-GET nicht sinnvoll.
                                     `select-all` macht das Kopieren zu einem Klick.
                                     Genau deshalb steht sie hier als BEFEHL: die Zeile
                                     zeigt, was man mit ihr tut, statt sie als Feldwert
                                     abzulegen. `git clone` ist ein Programmaufruf und
                                     wird nicht übersetzt — das Dollarzeichen ist ein
                                     Zeichen, kein Wort, und `aria-hidden`, damit die
                                     Sprachausgabe nicht „Dollar" vorliest. --}}
                                <template x-if="view.repo.cloneUrls.length > 0">
                                    <div class="mt-4 flex items-baseline gap-2 rounded-tile bg-zinc-100 px-3 py-2 text-xs dark:bg-zinc-800">
                                        <span aria-hidden="true" class="shrink-0 select-none font-semibold text-muted">$</span>
                                        <span aria-hidden="true" class="shrink-0 select-none text-muted">git clone</span>
                                        <span class="min-w-0 select-all break-all font-semibold" data-forge-clone x-text="view.repo.cloneUrls[0]"></span>

                                        {{-- Kopieren mit einem Klick — aber nur, wo es
                                             auch etwas tut. `navigator.clipboard` gibt es
                                             ausschließlich in sicheren Kontexten (HTTPS
                                             oder localhost); über eine nackte
                                             HTTP-Adresse im LAN ist es `undefined`. Dort
                                             erscheint dieser Knopf gar nicht erst, und es
                                             bleibt bei der bisherigen `select-all`-Zeile:
                                             ein Klick markiert sie ganz. Ein sichtbarer
                                             Knopf, der nichts bewirkt, wäre der
                                             schlechtere Tausch — er nimmt dem Nutzer die
                                             Gewissheit, ob er kopiert hat oder nicht.

                                             `items-baseline` der Zeile trüge den Knopf
                                             auf der Schriftlinie und damit zu hoch —
                                             `self-center` stellt ihn auf die Mitte. --}}
                                        <template x-if="canCopyClone()">
                                            <flux:button size="xs" variant="ghost" icon="clipboard-document"
                                                         class="icon-btn-touch shrink-0 self-center"
                                                         data-forge-clone-copy
                                                         x-on:click="copyClone()"
                                                         aria-label="{{ __('Clone-URL kopieren') }}" />
                                        </template>
                                    </div>
                                </template>
                            </div>

                            <dl class="text-sm">
                                {{-- Branch-Zustand aus dem kind 30618. Er ist
                                     relay-signiert; fehlt er, sagt die Fläche das,
                                     statt einen Branch zu raten. Immer gerendert —
                                     und deshalb die Zeile ohne Oberkante. --}}
                                <div class="flex flex-col gap-1 border-t border-zinc-200 px-4 py-3 sm:flex-row sm:gap-4 dark:border-zinc-800">
                                    <dt class="shrink-0 pt-0.5 text-xs font-semibold uppercase tracking-wider text-muted sm:w-44">{{ __('Branches') }}</dt>
                                    <dd class="min-w-0 flex-1">
                                        <template x-if="view.repo.state && view.repo.state.branches.length > 0">
                                            <ul class="flex flex-wrap gap-1.5">
                                                {{-- Der Kurzhash trägt die Markenfarbe, der Ref
                                                     daneben nicht: das Git-Objekt ist der eine
                                                     Akzent dieser Seite. Gemessen brand-800 auf
                                                     brand-500/10 = 5,92:1 (hell), brand-300 auf
                                                     zinc-900 = 9,56:1 (dunkel), gerechnet mit
                                                     `p2-kontrast.mjs`. Vorher stand hier
                                                     brand-700 mit 4,05:1 bzw. 3,89:1 auf der
                                                     15%-Fläche — beides unter den 4,5:1 aus
                                                     WCAG 1.4.3. --}}
                                                {{-- ── `flux:badge` statt Hauspille ──────────────────
                                                     Die Marke selbst kommt jetzt von Flux; sie steht
                                                     IN einem `<li>` statt selbst eines zu sein, weil
                                                     `flux:badge` über `flux:button-or-div` rendert
                                                     und dort nur `<div>` oder `<button>` zur Wahl
                                                     stehen — ein `<div>` als direktes Kind eines
                                                     `<ul>` wäre ungültig.

                                                     Gemessen tut ihr das gut: Flux' eigener
                                                     Vordergrund misst 9,25:1 hell (zinc-700 auf
                                                     `bg-zinc-400/15`) und 6,42:1 dunkel (zinc-200 auf
                                                     `bg-zinc-400/40`) gegen die 7,03:1 / 5,81:1 der
                                                     Hauspille. Der KURZHASH behält seine Markenfarbe
                                                     (die Herleitung darüber gilt unverändert) und
                                                     bleibt ein `<span>` — eine Marke in einer Marke
                                                     wäre zwei Bauteile für eine Aussage. --}}
                                                <template x-for="branch in view.repo.state.branches" :key="branch.name">
                                                    <li>
                                                        {{-- `::data-branch`: siehe die Herleitung an
                                                             `data-forge-status` in `⚡forge.blade.php` — auf
                                                             einer Flux-Komponente ist ein einfacher
                                                             Doppelpunkt eine PHP-Bindung, kein Alpine-Bind. --}}
                                                        <flux:badge size="sm" class="gap-1.5"
                                                                    data-forge-branch ::data-branch="branch.name">
                                                            <flux:icon.code-bracket-square variant="micro" class="size-3.5 shrink-0 text-zinc-500 dark:text-zinc-400" />
                                                            <span class="font-semibold" x-text="branch.name"></span>
                                                            <span class="rounded-pill bg-brand-500/10 px-1.5 font-semibold tracking-tight text-brand-800 dark:text-brand-300"
                                                                  x-text="branch.commit.slice(0, 7)"></span>
                                                            <template x-if="view.repo.state.head === branch.name">
                                                                <span class="text-xs font-semibold uppercase tracking-wider text-muted">{{ __('HEAD') }}</span>
                                                            </template>
                                                        </flux:badge>
                                                    </li>
                                                </template>
                                            </ul>
                                        </template>
                                        {{-- ── Drei Lagen, nicht zwei (N1, 2026-08-24) ──────────
                                             „Es gibt keinen Zustand" und „der Zustand ist diesem
                                             Repository nicht zuzuordnen" sind verschiedene
                                             Auskünfte, und die zweite gab es hier nicht.

                                             Ein 30618 nennt seinen Eigentümer nicht, und
                                             Repositories sind über `(owner, d)` gekeyt — zwei
                                             gleichnamige Repos teilen sich also den
                                             relay-signierten Zustand, ohne dass ein Client sie
                                             trennen könnte. Bis zum 2026-08-24 bekam der eine
                                             stillschweigend den Commit des anderen angezeigt.

                                             Jetzt wird keiner behauptet — aber auch nicht „noch
                                             nichts veröffentlicht" behauptet, denn gepusht wurde
                                             sehr wohl. Der Satz sagt, WARUM nichts dasteht. --}}
                                        <template x-if="view.repo.state && view.repo.state.ambiguous">
                                            <span class="text-xs text-muted" data-forge-state-mehrdeutig>{{ __('Ein zweites Repository trägt denselben Namen. Der veröffentlichte Branch-Zustand nennt keinen Eigentümer und lässt sich deshalb keinem von beiden zuordnen.') }}</span>
                                        </template>
                                        <template x-if="(!view.repo.state && true) || (view.repo.state && !view.repo.state.ambiguous && view.repo.state.branches.length === 0)">
                                            <span class="text-xs text-muted" data-forge-no-state>{{ __('Noch kein Branch-Zustand veröffentlicht.') }}</span>
                                        </template>
                                    </dd>
                                </div>

                                {{-- ── Tags aus dem kind 30618 (P7b) ──────────────────────
                                     Sie wurden seit jeher geparst (`toRepoState`:
                                     `refs/tags/*` stehen als TAG-NAMEN da, nicht als
                                     Werte — eine NIP-34-Eigenheit, die man beim
                                     Überfliegen übersieht) und **nirgends** angezeigt.

                                     ── DREI Lagen, und keine zwei davon dürfen denselben
                                        Satz bekommen ──────────────────────────────────
                                     `state === null` heißt „es liegt gar kein
                                     veröffentlichter Ref-Zustand vor".
                                     `state.ambiguous === true` heißt etwas ganz anderes:
                                     es liegt einer vor, er nennt aber keinen Eigentümer,
                                     und ein zweites Repository trägt denselben Namen —
                                     dann sind `branches` UND `tags` leer, obwohl sehr
                                     wohl gepusht wurde. Der dritte Fall ist der
                                     langweilige: Zustand da, nur eben ohne Tags.

                                     Wer die drei zusammenlegt, tauscht eine falsche
                                     Behauptung gegen eine andere. --}}
                                <div class="flex flex-col gap-1 border-t border-zinc-200 px-4 py-3 sm:flex-row sm:gap-4 dark:border-zinc-800">
                                    <dt class="shrink-0 pt-0.5 text-xs font-semibold uppercase tracking-wider text-muted sm:w-44">{{ __('Tags') }}</dt>
                                    <dd class="min-w-0 flex-1">
                                        <template x-if="view.repo.state && view.repo.state.tags.length > 0">
                                            <ul class="flex flex-wrap gap-1.5">
                                                {{-- Dieselbe Bauform wie eine Zelle höher bei den
                                                     Branches: `flux:badge` mit dem brand-getönten
                                                     Kurzhash darin. Das Zeichen unterscheidet die
                                                     beiden Rollen — ein Tag ist ein Etikett, ein
                                                     Branch eine Linie. --}}
                                                <template x-for="tag in view.repo.state.tags" :key="tag.name">
                                                    <li>
                                                        <flux:badge size="sm" class="gap-1.5"
                                                                    data-forge-tag ::data-tag="tag.name">
                                                            <flux:icon.tag variant="micro" class="size-3.5 shrink-0 text-zinc-500 dark:text-zinc-400" />
                                                            <span class="font-semibold" x-text="tag.name"></span>
                                                            <span class="rounded-pill bg-brand-500/10 px-1.5 font-semibold tracking-tight text-brand-800 dark:text-brand-300"
                                                                  x-text="tag.commit.slice(0, 7)"></span>
                                                        </flux:badge>
                                                    </li>
                                                </template>
                                            </ul>
                                        </template>
                                        <template x-if="!view.repo.state">
                                            <span class="text-xs text-muted" data-forge-tags-kein-zustand>{{ __('Zu diesem Repository liegt noch kein veröffentlichter Ref-Zustand vor — deshalb steht hier auch keine Tag-Liste.') }}</span>
                                        </template>
                                        <template x-if="view.repo.state && view.repo.state.ambiguous">
                                            <span class="text-xs text-muted" data-forge-tags-mehrdeutig>{{ __('Ein zweites Repository trägt denselben Namen. Der veröffentlichte Ref-Zustand nennt keinen Eigentümer — welche Tags zu diesem hier gehören, ist deshalb nicht zu sagen.') }}</span>
                                        </template>
                                        <template x-if="view.repo.state && !view.repo.state.ambiguous && view.repo.state.tags.length === 0">
                                            <span class="text-xs text-muted" data-forge-tags-leer>{{ __('Dieses Repository hat noch keinen Tag veröffentlicht.') }}</span>
                                        </template>
                                    </dd>
                                </div>

                                {{-- ── Themen (P7b) ───────────────────────────────────────
                                     Die `t`-Tags des 30617. Sie wurden gelesen und waren
                                     seit P5 sogar suchbar (`forgeSearch.ts`) — nur nie im
                                     Bild. Ein Suchbegriff, der Treffer liefert und dessen
                                     Grundlage man nirgends sieht, ist eine Fläche, die
                                     mehr weiß als sie sagt.

                                     Keine Leerzeile, wenn es keine gibt: ein Repository
                                     ohne Themen ist der Normalfall und keine Lücke. --}}
                                <template x-if="view.repo.hashtags.length > 0">
                                    <div class="flex flex-col gap-1 border-t border-zinc-200 px-4 py-3 sm:flex-row sm:gap-4 dark:border-zinc-800">
                                        <dt class="shrink-0 pt-0.5 text-xs font-semibold uppercase tracking-wider text-muted sm:w-44">{{ __('Themen') }}</dt>
                                        <dd class="flex min-w-0 flex-1 flex-wrap gap-1.5">
                                            <template x-for="thema in view.repo.hashtags" :key="thema">
                                                {{-- `variant="pill"` — die dritte Chip-Rolle aus
                                                     P3: Label-artig und damit rund, während der
                                                     Git-Anker eckig bleibt. --}}
                                                <flux:badge size="sm" variant="pill" data-forge-thema x-text="thema" />
                                            </template>
                                        </dd>
                                    </div>
                                </template>

                                {{-- ── Gleiche Historie (P7b) ─────────────────────────────
                                     Repos mit demselben `["r", <commit>, "euc"]` haben
                                     nachweislich dieselbe Wurzel.

                                     **Hier steht NICHT „Fork von X", und das ist keine
                                     Wortwahl, sondern eine Aussage über das Protokoll.**
                                     Der `euc` ist eine ÄQUIVALENZ ohne Richtung. Eine
                                     Richtung wäre nur aus `created_at` zu holen — und das
                                     ist am ersetzbaren 30617 der Zeitpunkt der letzten
                                     Neuankündigung, nicht der Entstehung: ein Repo, das
                                     gestern seine Beschreibung geändert hat, sähe damit
                                     jünger aus als sein eigener Fork. Ein `fork-of`-Tag
                                     kennt NIP-34 nicht. Eine Fläche, die „Fork von X"
                                     schreibt, behauptet also etwas, das im Ereignis nicht
                                     steht. --}}
                                <template x-if="view.verwandte.length > 0">
                                    <div class="flex flex-col gap-1 border-t border-zinc-200 px-4 py-3 sm:flex-row sm:gap-4 dark:border-zinc-800">
                                        <dt class="shrink-0 pt-0.5 text-xs font-semibold uppercase tracking-wider text-muted sm:w-44">{{ __('Gleiche Historie') }}</dt>
                                        <dd class="min-w-0 flex-1">
                                            <ul class="flex flex-wrap gap-1.5" data-forge-verwandte>
                                                <template x-for="andere in view.verwandte" :key="andere.address">
                                                    <li>
                                                        <a :href="'{{ route('group.forge') }}/' + andere.naddr" wire:navigate
                                                           class="forge-anker pressable inline-flex items-center gap-1.5 rounded-tile px-2 py-1 text-xs"
                                                           {{-- EINFACHER Doppelpunkt: das hier ist ein
                                                                normales `<a>`, keine Flux-Komponente.
                                                                `::data-…` erzeugte auf gewöhnlichem
                                                                HTML lautlos ein totes Attribut. --}}
                                                           data-forge-verwandt :data-address="andere.address">
                                                            <flux:icon.arrows-right-left variant="micro" class="size-3.5 shrink-0" />
                                                            <span class="font-semibold" x-text="andere.name"></span>
                                                            <span class="text-muted" x-text="andere.ownerName"></span>
                                                        </a>
                                                    </li>
                                                </template>
                                            </ul>
                                            <p class="mt-1 text-xs text-muted">{{ __('Diese Repositories teilen den ersten Commit (euc). Welches davon zuerst da war, sagt das Protokoll nicht.') }}</p>
                                        </dd>
                                    </div>
                                </template>

                                {{-- Branch-Schutz aus `buzz-protect`. Eine
                                     Buzz-Erweiterung, kein NIP-34 — sie steht hier,
                                     weil sie beantwortet, warum ein Push abgelehnt
                                     wird.

                                     NEUTRAL statt Amber, und das ist kein Geschmack:
                                     Tailwinds amber-500 (#fe9a00) misst gegen die
                                     Hausmarke brand-500 (#f7931a) 1,08:1 — für das Auge
                                     dasselbe Orange. Zwei verschiedene Bedeutungen
                                     (Git-Objekt vs. Schutzregel) trugen damit dieselbe
                                     Farbe, und Amber kommt zudem aus Tailwinds Rampe,
                                     nicht aus der des Hauses. Träger der Aussage ist das
                                     Schloss plus der Regelname im Text. --}}
                                <template x-if="view.repo.protections.length > 0">
                                    <div class="flex flex-col gap-1 border-t border-zinc-200 px-4 py-3 sm:flex-row sm:gap-4 dark:border-zinc-800">
                                        <dt class="shrink-0 pt-0.5 text-xs font-semibold uppercase tracking-wider text-muted sm:w-44">{{ __('Geschützte Branches') }}</dt>
                                        <dd class="flex min-w-0 flex-1 flex-wrap gap-1.5">
                                            <template x-for="rule in view.repo.protections" :key="rule.ref + rule.rule">
                                                {{-- `flux:badge` — dieselbe Marke wie bei den Branches
                                                     eine Zelle höher, jetzt auch dieselbe Bauform.
                                                     Hier ohne `<li>`-Hülle: das Elternelement ist ein
                                                     `<dd>`, und ein `<div>` darin ist zulässig. --}}
                                                <flux:badge size="sm" class="gap-1.5" data-forge-protection>
                                                    <flux:icon.lock-closed variant="micro" class="size-3.5 shrink-0 text-zinc-500 dark:text-zinc-400" />
                                                    <span x-text="rule.ref.replace('refs/heads/', '') + ': ' + rule.rule"></span>
                                                </flux:badge>
                                            </template>
                                        </dd>
                                    </div>
                                </template>

                                {{-- Beteiligte. Speist sich aus den `maintainers`-Tags
                                     des Announcements — die einzigen Personen, die das
                                     Ereignis selbst benennt. --}}
                                <template x-if="view.repo.people.length > 0">
                                    <div class="flex flex-col gap-1 border-t border-zinc-200 px-4 py-3 sm:flex-row sm:gap-4 dark:border-zinc-800">
                                        <dt class="shrink-0 pt-0.5 text-xs font-semibold uppercase tracking-wider text-muted sm:w-44">{{ __('Maintainer') }}</dt>
                                        <dd class="flex min-w-0 flex-1 flex-wrap items-center gap-1">
                                            <template x-for="person in view.repo.people.slice(0, 12)" :key="person.pubkey">
                                                <span data-forge-person :data-pubkey="person.pubkey" :title="person.name">
                                                    <x-group::nostr-avatar picture="person.picture" name="person.name" size="1.75rem" />
                                                </span>
                                            </template>
                                            <template x-if="view.repo.people.length > 12">
                                                <span class="ms-1 text-xs text-muted"
                                                      x-text="'+' + (view.repo.people.length - 12)"></span>
                                            </template>
                                        </dd>
                                    </div>
                                </template>
                            </dl>
                        </div>

                    </aside>
                    </div>{{-- /forge-repo-raster --}}
                    </div>{{-- /forge-repo-buehne --}}
                </template>
            </div>
        @endif
    </div>{{-- /page-enter --}}

    {{-- ══ DER HANDLUNGSKNOPF — DIE MOBILE BAUFORM ══════════════════════════════
         Die EINE schöpferische Handlung dieser Fläche. Bis P4 war sie eine
         Geisterzeile über der Issue-Liste: unsichtbar, solange man auf einem der
         vier anderen Reiter stand, und auf dem Telefon erst nach dem Rollen.

         ── Seit dem 2026-08-27 ist das die MOBILE von ZWEI Formen ──────────────
         P4 hat den Knopf hierher geholt und dabei EINE Bauform für ZWEI Flächen
         gebaut — genau die Fehlerklasse, die P2 und P3 anderswo behoben haben.
         Ein FAB ist mobile Sprache: er liegt im Daumenbereich, direkt über der
         Bottom-Nav. Am Desktop gibt es diese Nav nicht (`xl:hidden`), und der
         Knopf schwebte dort über nichts, weit unterhalb der Zeile, in der jemand
         eine Liste liest. Der Nutzer hat ihn auf der Live-Seite gesucht und nicht
         gefunden.

         Die Desktop-Form steht jetzt in der Filterleiste über der Issue-Liste
         (`partials/forge-detail-suche.blade.php`), beschriftet, wie bei Gitea
         und GitHub. WELCHE Form gilt, entscheidet EINE Funktion mit EINEM
         Rückgabewert (`js/forgeAnlegen.ts`) — zwei Knöpfe zugleich sind damit
         nicht ausdrückbar. Beide tragen `data-forge-anlegen`; darauf misst der
         Riegel in `tests/e2e/desktop-forge-anlegen.spec.ts`.

         **Nur hier, nicht auf `/forge`.** Die Übersicht bleibt auf ihrer Ebene
         lesend — aus diesem Client geht kein `kind 30617` und kein `kind 30621`
         hinaus (Nutzerentscheidung vom 2026-08-24). Ein Knopf dort hätte nichts
         anzulegen.

         **Ausserhalb von `page-enter` und ausserhalb der Bühne**, und beides aus
         demselben Grund: `position: fixed` bricht an jedem Vorfahren mit
         `transform` (die 0,3-s-Einblendung) und an jedem mit `contain: layout`
         (das bringt `container-type: inline-size` der Bühne mit). Ein Knopf, der
         beim Seitenaufbau springt oder am Rand der Bühne statt am Rand des
         Fensters klebt, ist kein fester Bezugspunkt mehr.

         ── Gesperrt heisst inert, nicht abwesend (2026-08-27) ─────────────────
         Hier stand `x-if="!!view && canWrite()"` mit der Begründung, ein toter
         Knopf sei schlechter als keiner; den Grund sage ja die Issue-Liste im
         Satz. Das war für einen Knopf ohne Wort schlüssig und ist trotzdem die
         falsche Ausfallrichtung: der Satz erklärt eine Verweigerung, von der man
         gar nicht weiss, dass sie eine ist — wer den Knopf nie gesehen hat,
         erfährt nicht, dass hier überhaupt etwas anzulegen ist (Nielsen #6:
         erkennen statt erinnern). Jetzt steht er in BEIDEN Formen, inert und mit
         Verweis auf denselben Satz.

         `x-if` und nicht `x-show` bleibt: die Form wechselt nur an der
         Chassis-Schwelle, und ein `x-show`-verstecktes Duplikat wäre in
         `getByRole` ein Strict-Mode-Treffer auf zwei Elemente. Der Auslöser
         bleibt bei offenem Blatt stehen, `anlegeZiel` hängt nicht an
         `issueDraft`. --}}
    <template x-if="anlegeZiel($store.viewport.desktop) === 'fab'">
        {{-- Die Breitenklammer steht ZEICHENGLEICH an drei Stellen: hier, an
             `main` (`components/app-shell.blade.php`) und an der Bottom-Nav
             (`components/bottom-nav.blade.php`). Ausgeschrieben und nicht
             zusammengesetzt — Tailwind scannt den Quelltext, ein zur Laufzeit
             gebauter Klassenname existierte im Stylesheet nie. --}}
        <div class="forge-fab-spur mx-auto max-w-md md:max-w-lg lg:max-w-2xl xl:max-w-none">
        {{-- `x-bind:aria-expanded` AUSGESCHRIEBEN, nicht `::aria-expanded`.
             Der doppelte Doppelpunkt ist die Konvention für Blade-KOMPONENTEN
             (`<flux:…>`), wo Blade ihn zu einem einfachen escapt; auf rohem HTML
             gibt Blade ihn wörtlich aus, Alpine liest ihn als Bindung für ein
             Attribut namens `:aria-expanded` und schreibt genau das. Das echte
             `aria-expanded` entsteht nie — lautlos, kein Test wird rot.

             Hier stand bis zur P4-Nacharbeit die falsche Form. Ich habe sie in
             derselben Runde erst bei P3 gemessen und dann an meinem eigenen Knopf
             wiedergefunden; im ganzen Paket sind es genau diese zwei Stellen
             (gezählt über alle 86 `::attr=`-Vorkommen beider Repos, 84 davon auf
             `<flux:…>` und damit richtig).

             `aria-expanded` ist auf `role="button"` zulässig — anders als
             `aria-pressed` auf einem Link, siehe die Herleitung im
             Listen-Umschalter. --}}
        <button type="button" class="forge-fab pressable" data-forge-fab data-forge-anlegen
                x-on:click="toggleIssueDraft()"
                aria-haspopup="dialog"
                x-bind:aria-expanded="issueDraft.open ? 'true' : 'false'"
                x-bind:aria-disabled="canWrite() ? null : 'true'"
                x-bind:aria-describedby="canWrite() ? null : 'forge-schreibhinweis'"
                aria-label="{{ __('Neues Issue') }}">
            {{-- Die Glyphe ist Zierrat, das `aria-label` trägt. Ein Knopf ohne
                 sichtbares Wort braucht einen zugänglichen Namen, und der ist hier
                 wörtlich derselbe wie vorher an der Zeile — geteilte Prüfstände und
                 Sprachausgabe finden ihn unverändert unter „Neues Issue". --}}
            <flux:icon.plus class="size-6" />
        </button>
        </div>
    </template>

    {{-- ══ DAS BLATT ════════════════════════════════════════════════════════════
         Unten angeschlagen auf dem Telefon, mittig ab `sm` — dieselbe Bauform wie
         das Anmeldeblatt (`components/login-sheet.blade.php`), damit es im Haus
         genau eine Blattform gibt.

         ── Die drei Dialogregeln ──────────────────────────────────────────────────
         `x-trap.noscroll` fängt den Fokus, sperrt den Hintergrund-Bildlauf und gibt
         den Fokus beim Loslassen an den auslösenden Knopf zurück (Alpines
         Fokus-Plugin, mit Livewire ausgeliefert; `returnFocus` ist dort der
         Standard). Escape muss der Aufruf selbst erledigen: das Plugin setzt
         `escapeDeactivates: false`, ein alleiniges Verlassen des Fokusrings ließe
         also ein offenes Blatt ohne Falle zurück.

         **Das Blatt bleibt im DOM, das FORMULAR nicht.** `x-trap` braucht ein
         stehendes Element, an dem es hängen kann; die dokumentierte Zusage „nach
         dem Absenden ist `[data-forge-issue-form]` weg" hängt dagegen am `x-if`
         darin. Der Schließen-Knopf steht ausserhalb dieses `x-if` — damit hat die
         Falle in jedem Zustand mindestens ein Ziel.

         ── Bewegung ───────────────────────────────────────────────────────────────
         240 ms hinein, 180 ms hinaus, `ease-out` beim Erscheinen. Unter
         `prefers-reduced-motion` neutralisieren die `motion-reduce:*`-Utilities
         Schub UND Skalierung in den Start-/Endzuständen; es bleibt ein reiner
         Deckkraft-Übergang. --}}
    <div x-show="issueDraft.open" x-cloak
         class="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
         role="dialog" aria-modal="true" aria-label="{{ __('Neues Issue') }}"
         data-forge-issue-blatt
         x-trap.noscroll="issueDraft.open"
         x-on:keydown.escape.prevent.stop="if (issueDraft.open && !issueDraft.busy) { toggleIssueDraft() }">
        {{-- Der Schleier schließt bei Tipp. Kein `button`: er ist ein
             Ausweichziel, keine Handlung — der Fokusring bliebe sonst an einer
             leeren Fläche hängen. Für die Tastatur gibt es Escape und den
             Schließen-Knopf. --}}
        <div x-show="issueDraft.open" x-transition.opacity class="absolute inset-0 bg-black/40"
             x-on:click="if (!issueDraft.busy) { toggleIssueDraft() }"></div>

        <div x-show="issueDraft.open"
             x-transition:enter="transition ease-out duration-300 motion-reduce:duration-150"
             x-transition:enter-start="opacity-0 translate-y-full sm:translate-y-4 sm:scale-95 motion-reduce:translate-y-0! motion-reduce:scale-100!"
             x-transition:enter-end="opacity-100 translate-y-0 sm:scale-100"
             x-transition:leave="transition ease-in duration-200 motion-reduce:duration-150"
             x-transition:leave-start="opacity-100 translate-y-0 sm:scale-100"
             x-transition:leave-end="opacity-0 translate-y-full sm:translate-y-4 sm:scale-95 motion-reduce:translate-y-0! motion-reduce:scale-100!"
             class="surface-card relative z-10 max-h-[90dvh] w-full overflow-y-auto rounded-t-sheet pb-safe sm:max-w-lg sm:rounded-sheet">
            <div class="flex items-center justify-between gap-2 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
                {{-- `h2`: das Blatt ist ein eigener Abschnitt, und die Überschrift
                     ist der Name, den `aria-label` oben wiederholt. --}}
                <h2 class="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{{ __('Neues Issue') }}</h2>
                <flux:button size="sm" variant="ghost" icon="x-mark" square
                             class="icon-btn-touch"
                             x-on:click="toggleIssueDraft()"
                             ::disabled="issueDraft.busy"
                             aria-label="{{ __('Schließen') }}" />
            </div>
            <template x-if="issueDraft.open">
                <div class="space-y-3 p-4" data-forge-issue-form>
                    <flux:input label="{{ __('Titel') }}" x-model="issueDraft.title"
                                maxlength="256" placeholder="{{ __('Worum geht es?') }}" />
                    {{-- @-Erwähnung (P9): `relative` trägt das absolut
                         positionierte Popover, `data-forge-composer`
                         ist der Weg des Fokus zurück ins Feld
                         (x-ref taugt dafür in einem x-for nicht). --}}
                    <div class="relative">
                        <flux:textarea label="{{ __('Beschreibung') }}" x-model="issueDraft.body" rows="4"
                                       data-forge-composer="issue"
                                       x-on:input="onComposerInput($event.target, 'issue')"
                                       x-on:keydown="mentionKey($event)"
                                       placeholder="{{ __('Optional. Markdown wird gerendert. @ erwähnt jemanden.') }}" />
                        @include('group::partials.forge-mention-popover', [
                            'targetExpr' => "'issue'",
                            'targetLabel' => 'issue',
                        ])
                    </div>

                    {{-- Fehlermeldung als `flux:callout variant="danger"` statt als
                         nachgebauter roter Kasten — Herleitung an der ersten Fundstelle
                         dieser Datei (Suchwort `Vom Handkasten`). --}}
                    <flux:callout variant="danger" icon="exclamation-triangle" inline
                                  x-show="issueDraft.error" x-cloak role="alert" data-forge-issue-error>
                        <flux:callout.text class="text-xs!" x-text="issueDraft.error"></flux:callout.text>
                    </flux:callout>

                    <div class="flex flex-wrap items-center gap-2">
                        {{-- Der Name des Knopfes WECHSELT NICHT, wenn er
                             fliegt — er wird nur unbedienbar, und der
                             Zustand steht als eigener Text daneben. Ein
                             Knopf, der beim Drücken seinen Namen ändert,
                             ist für die Sprachausgabe ein anderer Knopf. --}}
                        <flux:button size="sm" variant="primary"
                                     data-forge-issue-submit
                                     x-on:click="submitIssue()"
                                     ::disabled="issueDraft.busy">{{ __('Issue anlegen') }}</flux:button>
                        <flux:button size="sm" variant="ghost"
                                     x-on:click="toggleIssueDraft()"
                                     ::disabled="issueDraft.busy">{{ __('Abbrechen') }}</flux:button>
                        <span x-show="issueDraft.busy" x-cloak role="status"
                              class="text-xs text-muted">{{ __('Wird gesendet …') }}</span>
                    </div>
                </div>
            </template>
        </div>
    </div>
    </div>{{-- /Insel --}}

</x-group::app-shell>
