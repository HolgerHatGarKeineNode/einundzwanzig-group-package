{{-- Der Navigator (Plan „Desktop-Shell", P4) — die linke Spalte ab `xl`.

     ── Warum `<template x-if>` und nicht `hidden xl:flex` ────────────────────
     Alpine initialisiert `x-data` auch in Elementen, die per CSS versteckt sind.
     Ein reines `hidden xl:flex` bootete `nostrRail` deshalb auf JEDEM Telefon mit
     — samt Relay-Subscription für eine Spalte, die dort niemand je sieht. `x-if`
     entscheidet über die EXISTENZ des Knotens; das ist der Unterschied, auf den
     es hier ankommt. Der Store dahinter hört auf `matchMedia`, siehe `viewport.ts`.

     ── Warum `nostrRail` und nicht `nostrSpaces` ─────────────────────────────
     Die Rail steht auf JEDER Seite, auch auf `/rooms/{h}`. `nostrSpaces.init()`
     ruft als erstes `clearEphemeralSpace()` — auf einer Raumseite risse das den
     Workspace-Kontext weg, der Verlauf bliebe leer. `nostrRail` ist die lesende
     Alternative: sie abonniert `activeSpace`/`activeSpaceView`, mutiert nie.

     ── Was die Rail bewusst NICHT kann ──────────────────────────────────────
     Kategorien, Filter, Raum-Verwaltung, den Segment-Umschalter. Sie ist eine
     Sprungliste, keine zweite Raumübersicht. Für alles andere führt „Alle Räume"
     auf `/spaces`. Der Segment-Umschalter bleibt dort auch technisch: `flux:tabs`
     und `flux:tab.panel` müssen im selben Baum stehen — ein `flux:tab` ohne sein
     Panel wirft und reißt die ganze Insel mit. --}}
<template x-if="$store.viewport?.desktop">
    {{-- `xl:col-start-1 xl:row-start-1`: dieselbe Zelle, die `rail-skelett` bis zum
         Boot hält. Ausdrücklich statt per Auto-Placement — der Grund steht bei der
         Bühne in `app-frame.blade.php`. --}}
    {{-- ── `/forge?tab=workspaces` ohne Tabs (P4) ────────────────────────────
         Ab `xl` hat die Forge-Bühne keinen Kanäle-Tab mehr — die Kanäle stehen
         hier, im Foren-Zweig. Ein geteilter Link auf diesen Tab darf deshalb
         nicht ins Leere zeigen: die Forge-Insel schickt ein FENSTEREREIGNIS,
         und dieser Zuhörer öffnet die Gruppe und rollt sie in den Blick.

         Ein Ereignis statt eines direkten Zugriffs, weil sonst zwei Inseln
         denselben Zustand schrieben — und die Forge-Insel müsste wissen, dass
         es die Rail gibt. Gibt es sie nicht (Telefon, App), hört niemand zu,
         und es passiert nichts. Das ist der richtige Ausgang, kein Fehler.

         Nur vorhandene öffentliche Insel-API: `isOpen`/`toggleGroup`. Ein
         `openGroup` gibt es nicht, deshalb die Bedingung davor — `toggleGroup`
         unbedingt aufzurufen schlösse eine bereits offene Gruppe. --}}
    <div x-data="nostrRail" data-rail
         x-on:forge-zeige-kanaele.window="
             if (! isOpen('workspace')) { toggleGroup('workspace') }
             $nextTick(() => {
                 const gruppe = $el.querySelector('#rail-group-workspace')
                 gruppe?.scrollIntoView({ block: 'nearest' })
                 $el.querySelector('[data-rail-gruppenkopf=&quot;workspace&quot;]')?.focus({ preventScroll: true })
             })
         "
         class="hidden min-h-0 flex-col border-e border-zinc-200 bg-white xl:col-start-1 xl:row-start-1 xl:flex dark:border-zinc-800 dark:bg-zinc-900">

        {{-- Space-Kopf: „wo bin ich" gehört an den Anfang der Ortsspalte. --}}
        <div class="flex shrink-0 items-center gap-2.5 px-4 pt-4 pb-3">
            <x-group::nostr-avatar picture="space?.icon" name="spaceLabel" size="2rem" />
            <div class="min-w-0 flex-1">
                <div class="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100" x-text="spaceLabel"></div>
                <div x-show="space?.description" x-cloak class="truncate text-[0.7rem] text-muted" x-text="space?.description"></div>
            </div>
        </div>

        {{-- Die Signatur des Clients: der `#`-Prompt. Tippen filtert die Liste
             darunter, Enter springt in den ersten Treffer. `type=search` gibt dem
             Feld die native Leeren-Geste; `#` ist Dekoration und deshalb
             aria-hidden — das Label steht am Input. --}}
        {{-- Ein Feld, ein Scope. Zehn Suchfelder (vier Gruppen + sieben Länder)
             wären 340px in einer Spalte mit ~600px Scrollfläche — die Rail wäre
             zur Hälfte Formular, und man müsste zum Suchen erst scrollen.
             Der Chip kostet 0px zusätzliche Höhe und macht die Gruppenstruktur
             adressierbar statt nur aufklappbar. --}}
        <label class="mx-3 mb-2 flex shrink-0 items-center gap-1.5 rounded-tile bg-zinc-100 px-2.5 py-1.5 focus-within:ring-2 focus-within:ring-accent dark:bg-zinc-800">
            <span aria-hidden="true" class="font-mono text-sm font-bold text-brand-800 dark:text-brand-400">#</span>

            <template x-if="scope.group || scope.country">
                <button type="button" x-on:click="clearScope()"
                        x-bind:aria-label="@js(__('Suchbereich aufheben: :label')).split(':label').join(scopeLabel)"
                        class="pressable inline-flex shrink-0 items-center gap-1 rounded-pill bg-brand-500/10 px-1.5 py-0.5 text-[0.7rem] font-semibold text-zinc-900 dark:text-zinc-50">
                    <span x-text="scopeLabel"></span>
                    <flux:icon.x-mark variant="micro" aria-hidden="true" class="size-3" />
                </button>
            </template>

            <input type="search" x-model="query" x-ref="prompt"
                   x-on:focus="focused = true" x-on:blur="focused = false"
                   x-on:keydown.enter.prevent="jumpToFirst()"
                   x-on:keydown.escape.prevent="onEscape($el)"
                   {{-- Der Lift hängt am `input`-Ereignis, nicht an einem `$watch` auf
                        `query` — er schreibt `query` selbst, ein Watch riefe sich rekursiv. --}}
                   x-on:input="liftToken()"
                   {{-- Platzhalter über den Sekundärtext-Token, wie das `<kbd>` weiter unten.
                        Hier stand zwischenzeitlich das Farbpaar ausgeschrieben: die Utility
                        verlor hinter einer vorangestellten Variante ihre Dark-Hälfte, der
                        Platzhalter blieb dark auf zinc-600 und lag bei 1,94:1 (WCAG 1.4.3
                        verlangt 4,5:1). Ursache war die Bauform der Utility, nicht die
                        Farbe — sie ist in `theme.css` behoben (echte Farb-Variable statt
                        eigener @utility, Begründung dort). Der Workaround kann deshalb
                        weg; eine Sonderlösung, deren Grund entfallen ist, verwirrt nur. --}}
                   class="min-w-0 flex-1 border-0 bg-transparent p-0 text-sm text-zinc-900 placeholder:text-muted focus:ring-0 dark:text-zinc-100"
                   x-bind:placeholder="scope.group || scope.country ? @js(__('Filtern…')) : @js(__('Raum springen'))"
                   aria-label="{{ __('Raum springen') }}" />

            {{-- Seit P4 öffnet ⌘K die Befehlspalette, nicht mehr dieses Feld. Die
                 Kappe blieb deshalb nicht als Dekoration stehen, sondern wurde zu
                 dem Knopf, den sie beschriftet — sonst bewürbe sie an dieser
                 Stelle eine Taste, die etwas anderes tut. Das Feld daneben bleibt,
                 was es war: der lokale Filter dieser Spalte. --}}
            <button type="button" x-show="!query && !focused"
                    x-on:click.stop.prevent="$dispatch('open-command-palette')"
                    aria-label="{{ __('Befehlspalette öffnen') }}" aria-haspopup="dialog"
                    aria-keyshortcuts="Meta+K Control+K"
                    class="pressable inline-flex h-6 shrink-0 items-center rounded bg-black/5 px-1.5 font-mono text-[0.65rem] text-muted transition-colors hover:text-zinc-900 dark:bg-white/10 dark:hover:text-zinc-100">⌘K</button>
        </label>

        {{-- Die einzige Fläche, die scrollt. `min-h-0` ist Pflicht: ohne das
             wächst ein Flex-Kind über seinen Container hinaus statt zu scrollen. --}}
        {{-- `data-rail-scroller`: die Raumliste braucht einen Anker, seit die Fußzeile
             darunter eigene Zeilen mit denselben Beschriftungen trägt. `buzz-rail-forge`
             prüft damit, was von „Regel 1" bleibt — im SCROLLER steht kein flacher
             Forge-Eintrag; er ist eine Fläche des Clients, kein Raum. --}}
        <div data-rail-scroller class="min-h-0 flex-1 overflow-y-auto px-3 pb-2">

            {{-- Vier Gruppen, feste Reihenfolge. Die zweite Achse (Mitgliedschaft)
                 wird bewusst NICHT zur Überschrift — sie ist Reihenfolge, Textgewicht
                 und eine Haarlinie INNERHALB der Gruppe. Sonst entstünden 2 × 4 × n
                 Zellen statt vier.

                 ── Die Folge steht in `railGroups.ts`, nicht hier (P2) ──────────
                 Diese Blockfolge MUSS `RAIL_GROUP_ORDER` entsprechen: dieselbe
                 Konstante ordnet die Sprungliste von Alt+↑/↓ (`railTargets`).
                 Wer hier umstellt und dort nicht, baut die zweite, konkurrierende
                 Ordnung — das Auge sieht eine Folge, die Tastatur läuft eine
                 andere. Der Workspace steht seit P2 an zweiter Stelle;
                 die Begründung steht an der Konstante, damit sie EINEN Ort hat.
                 `railGroups.test.ts` hält die Konstante fest, `buzz-rail-forge`
                 hält Markup und Tastatur gegen sie. --}}
            <x-group::rail-group group="rooms" :label="__('Räume')" />

            {{-- Der zweite Space. Existiert nur bei gesetztem `NOSTR_WORKSPACE_URL`;
                 ohne Config ist die Rail zeichengleich zu vorher. Die Räume kommen
                 aus einem EIGENEN Watch auf die Workspace-URL, nicht aus dem aktiven
                 Space — deshalb stehen hier beide nebeneinander statt abwechselnd. --}}
            {{-- Seit P1 IST der Workspace die Forge: kein eigener `Forge`-Eintrag mehr
                 unten, sondern der Baum in dieser Sektion. Drei Wege führen auf die
                 Übersichtsseite, weil ein nacktes Icon allein zu wenig wäre: der
                 Sektionsname, das `</>`-Icon daneben und — sobald gefaltet wird — die
                 Zeile „Alle Projekte · N". Ein vierter steht in der Befehlspalette
                 (`command-palette.blade.php`, Aktion `forge`). --}}
            {{-- ── Der Relay-Host ist aus der Zeile heraus und in den Tooltip ──
                 Bis 2026-08-17 stand hinter „WORKSPACE" der Name des Workspace-
                 Relays. Bei 295 px Rail-Innenbreite kappte das BEIDE Teile
                 (gemessen: „Workspace" 55 px in einen 44-px-Kasten,
                 „· buzz.einundzwanzig.space" 160 px in 126) — der Kopf las sich
                 als „WORKSP… · BUZZ.EINUNDZWANZIG…", und kein ganzes Wort blieb
                 stehen, während die drei Nachbarköpfe vollständig lesbar waren.

                 Es gibt genau EINEN Workspace (Entscheid 2026-08-17), die Herkunft
                 ist also keine Unterscheidung, sondern eine einmalige Auskunft. Sie
                 gehört damit an den Ort für einmalige Auskünfte: den `title` des
                 Sektionsnamens. Der Wert kommt aus `workspaceLabel` und nicht aus
                 der Server-Config — der Tooltip soll das Relay nennen, mit dem die
                 Fläche gerade WIRKLICH spricht.

                 Der Nebeneffekt, offen gesagt: dieser Span war der einzige kleine
                 Marken-TEXT der Rail und damit der namentliche Träger des
                 Kontrast-Ankers (`desktop-a11y-contrast.spec.ts`). Der Anker zeigt
                 jetzt auf den `#`-Prompt oben — dieselbe Farbe, dieselbe
                 Größenklasse, aber ohne Abhängigkeit von Relay und Ladezustand. --}}
            {{-- ── „Workspace" heißt seit P5 „Forge" ────────────────────────────
                 Umbenannt wurde die BESCHRIFTUNG, nicht der Gruppenschlüssel: `group`
                 bleibt `workspace`, weil derselbe Schlüssel in `RAIL_GROUP_ORDER`
                 (Markup-Reihenfolge UND Alt+↑/↓), in `railTargets` und in gespeicherten
                 Faltungszuständen steht. Ihn mitzuziehen wäre eine Datenmigration für
                 einen Anzeigenamen.

                 Warum überhaupt: die Sektion führt seit P1 den Forge-Baum (Repos,
                 Issues, Pull Requests, gebundene Kanäle), und ihr Kopf verlinkt auf die
                 Forge-Übersicht. „Workspace" beschrieb den Relay, nicht den Inhalt —
                 und der Nutzer hat Chat, Artikel und Forge als die drei Flächen dieses
                 Clients benannt. Ein Ort, der in der Ortsleiste „Forge" heißt und im
                 Navigator „Workspace", sind für den Leser zwei Orte (Nielsen #4).

                 Das Scope-Kürzel zieht mit: `f:` ist neu, `w:` bleibt als Alias gültig
                 (`js/railGroups.ts`). --}}
            <template x-if="hasWorkspaceSection">
                <div>
                    <x-group::rail-group group="workspace" :label="__('Forge')"
                                         :tree="true"
                                         heading-href="{{ route('group.forge') }}"
                                         :overview-label="__('Forge-Übersicht öffnen')"
                                         :heading-title="__('Forge auf :wert')"
                                         heading-title-value="workspaceLabel" />
                </div>
            </template>

            <x-group::rail-group group="meetups" :label="__('Meetups')" :countries="true" />
            <x-group::rail-group group="proposals" :label="__('Projektunterstützung')" />

            {{-- Leerer Filter ist ein Zustand, keine Panne — er bekommt einen Satz.
                 Und den Ort für den Tastatur-Hinweis: im Ruhezustand wäre er eine
                 stehende Zeile, die 24px Liste kostet und nach dem ersten Lesen
                 nichts mehr sagt. --}}
            <template x-if="query.trim() && rooms.length === 0">
                <div class="px-2 py-3">
                    <p class="text-sm text-muted">{{ __('Kein Raum passt zu dieser Suche.') }}</p>
                    {{-- `f:` statt `w:` seit P5 — das ist auch das Kürzel, das die Lupe ins Feld
                         schreibt (`scopeToken`). `w:` funktioniert weiter, steht hier aber
                         nicht: ein Hilfetext nennt EINEN Weg, sonst muss der Leser sich
                         fragen, worin der Unterschied besteht. --}}
                    <p class="mt-1 text-[0.7rem] text-muted">{{ __('Alt + ↑/↓ wechselt den Raum · m: p: r: f: grenzen ein') }}</p>
                </div>
            </template>

            {{-- Der Weg zu allem, was die Rail bewusst nicht kann. --}}
            <a href="{{ route('group.spaces') }}" wire:navigate
               class="pressable mt-1 flex min-h-9 items-center gap-2 rounded-tile px-2 text-sm font-medium text-muted transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100">
                <flux:icon.squares-2x2 variant="micro" class="size-4 shrink-0" />
                <span>{{ __('Alle Räume & Entdecken') }}</span>
            </a>

            {{-- Hier stand bis 2026-08-20 die Zeile „Artikel". Sie ist in die FUSSZEILE
                 gezogen, nicht gelöscht — der Grund steht dort. Was an dieser Stelle
                 weiterhin gilt: sie gehört nicht in die Gruppenliste oben, denn die
                 Gruppen sind Räume (`RailRoom` verlangt ein `h`) und ein Artikel ist
                 keiner.

                 Und hier stand bis P1 ein eigener „Forge"-Eintrag. Er ist weggefallen,
                 weil er den Workspace zweimal beschrieb: die Repos liegen auf demselben
                 Relay wie die Kanäle darüber, und der Repo-Kanal `0V_…` stand flach
                 daneben, obwohl das 30617 per `buzz-channel` sagt, wohin er gehört.
                 `buzz-rail-forge` hält das als „Regel 1" fest. Die Übersichtsseite ist
                 NICHT weggefallen — sie hängt am Sektionskopf (Name + `</>`-Icon), an
                 der Faltungszeile und in der Befehlspalette. --}}
        </div>

        {{-- Fußzeile: Artikel, darunter die Nav-Ziele, darunter Glocke und Identität. --}}
        <div class="shrink-0 border-t border-zinc-200 px-3 py-2 dark:border-zinc-800">
            {{-- ── „Artikel" steht HIER und nicht mehr im Scroller ──────────────────
                 Die Artikel sind eine Fläche des Clients, aber keine Räume — und der
                 Scroller darüber ist eine Raumliste. An deren Ende hing die Zeile
                 faktisch hinter vier Gruppen (Räume · Workspace · Meetups ·
                 Projektunterstützung), und deren Länge bestimmt der Relay, nicht das
                 Layout: auf einem Space mit vielen Meetup-Gruppen war sie nur nach dem
                 Durchscrollen aller vier zu erreichen. Die Fußzeile ist `shrink-0` und
                 damit die einzige Fläche der Rail, die IMMER sichtbar ist — genau das
                 Versprechen, das eine Hauptfläche braucht.

                 ── Warum sie NICHT wie die Nav-Tabs darunter aussieht ───────────────
                 Die Tabs darunter kommen aus `config('group.nav')` und sind in allen
                 Hosts dieselbe Menge; diese Zeile ist es nicht. Sie trägt deshalb
                 weiterhin die leisere Form aus dem Scroller (Micro-Icon, `font-medium`,
                 `text-muted`) statt Markenfarbe und Aktiv-Balken. Die Trennung trägt
                 Gewicht und Icon-Größe, KEINE weitere Haarlinie: die Fußzeile hat
                 bereits zwei, und eine dritte auf so engem Raum wäre Gitter statt
                 Gliederung.

                 ── Aktiv-Zustand, den es vorher nicht gab ───────────────────────────
                 Solange die Zeile im Scroller lag, war sie meist unsichtbar und ein
                 Marker sinnlos. Sichtbar stehend muss sie „du bist hier" beantworten
                 (Nielsen #1). Sie tut das über Textgewicht und Vordergrundfarbe plus
                 `aria-current` — nicht über den brand-Ton der Nav-Tabs, der zur
                 Registry-Sprache gehört. Die Vollansichten zählen mit: wer einen
                 Artikel liest, ist unter „Artikel".

                 ── Die Forge-Zeile steht seit P5 daneben ────────────────────────────
                 Hier stand bis dahin die Begründung, warum es sie NICHT gibt:
                 `buzz-rail-forge` hielt als „Regel 1" fest, dass die Rail keinen Link
                 namens „Forge" trägt, weil ein solcher Eintrag am Fuß des Scrollers den
                 Workspace ein zweites Mal beschrieben hätte — die Repos liegen auf
                 demselben Relay wie die Kanäle in der Sektion darüber.

                 **Die Regel ist in P5 begründet ERSETZT, nicht umgangen.** Was sich
                 geändert hat, ist die Voraussetzung, auf der sie stand: die Sektion
                 heißt jetzt selbst „Forge", und der Client hat mit der Ortskarten-Leiste
                 eine Ebene bekommen, auf der Chat, Artikel und Forge gleichrangig
                 nebeneinander stehen. Die Rail-Fußzeile ist die Desktop-Entsprechung
                 dieser Ebene — dort fehlte von den dreien genau einer. Ein Ort, der auf
                 jeder Bühne in der Leiste steht und im Navigator nur als Sektionskopf
                 im Scroller, ist an zwei Stellen verschieden wichtig.

                 Die alte Sorge bleibt beantwortet: die Zeile beschreibt den Workspace
                 NICHT ein zweites Mal, denn der Sektionskopf oben trägt jetzt denselben
                 Namen und führt an dasselbe Ziel. Zwei Wege zu einem Ort sind kein
                 Duplikat, sondern der Normalfall dieser Rail — die Artikel-Zeile
                 daneben ist auch in der Befehlspalette erreichbar. --}}
            {{-- `mb-2` = 8px aus der Abstands-Skala, nicht 4: die Nav-Tabs darunter
                 stehen mit `gap-0.5` (2px) dicht beieinander. Ein 4px-Absatz läse sich
                 als unsauberer Zeilenabstand innerhalb EINER Liste; 8px sind der
                 sichtbare Unterschied zwischen „andere Gruppe" und „nächste Zeile".
                 Das ist die Trennung, die hier die Haarlinie ersetzt. --}}
            <div class="mb-2">
                {{-- Die Vollansichten zählen mit: wer einen Artikel liest oder auf der
                     Autorenseite steht, ist unter „Artikel". Dieselbe Regel wie in der
                     Ortskarten-Leiste, und aus demselben Grund. --}}
                @php($articlesActive = request()->routeIs('group.articles', 'group.article', 'group.articles.author'))
                {{-- `data-rail-fuss`: die beiden Zeilen brauchen einen EINDEUTIGEN Anker.
                     Ihre Beschriftungen („Artikel", „Forge") stehen auf derselben Seite
                     noch zweimal — in der Ortskarten-Leiste und am Sektionskopf des
                     Scrollers. Ein Test, der auf den Text zielt, misst dann irgendeine
                     der drei Stellen. --}}
                <a href="{{ route('group.articles') }}" wire:navigate data-rail-fuss="artikel"
                   @if ($articlesActive) aria-current="page" @endif
                   @class([
                       'pressable flex min-h-9 items-center gap-2 rounded-tile px-2 text-sm transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800',
                       'font-semibold text-zinc-900 dark:text-zinc-100' => $articlesActive,
                       'font-medium text-muted hover:text-zinc-900 dark:hover:text-zinc-100' => ! $articlesActive,
                   ])>
                    <flux:icon.document-text variant="micro" class="size-4 shrink-0" />
                    <span>{{ __('Artikel') }}</span>
                </a>

                {{-- Forge — dieselbe leise Form wie die Artikel-Zeile darüber (Micro-Icon,
                     `font-medium`, `text-muted`) und ausdrücklich NICHT die Markenfarbe
                     der Nav-Tabs darunter: die kommen aus `config('group.nav')` und sind
                     in allen Hosts dieselbe Menge, diese beiden Zeilen sind es nicht.

                     Nur bei konfigurierter Quelle, wie die Forge-Ortskarte: ohne
                     `workspace_url` führt `/forge` in einen erklärenden Leerzustand, und
                     eine Zeile in einen Leerzustand ist ein Ort ohne Inhalt. --}}
                @if (config('group.workspace_url'))
                    @php($forgeActive = request()->routeIs('group.forge', 'group.forge.repo'))
                    <a href="{{ route('group.forge') }}" wire:navigate data-rail-fuss="forge"
                       @if ($forgeActive) aria-current="page" @endif
                       @class([
                           'pressable mt-0.5 flex min-h-9 items-center gap-2 rounded-tile px-2 text-sm transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800',
                           'font-semibold text-zinc-900 dark:text-zinc-100' => $forgeActive,
                           'font-medium text-muted hover:text-zinc-900 dark:hover:text-zinc-100' => ! $forgeActive,
                       ])>
                        <flux:icon.code-bracket-square variant="micro" class="size-4 shrink-0" />
                        <span>{{ __('Forge') }}</span>
                    </a>
                @endif
            </div>

            <x-group::bottom-nav orientation="rail" />

            <div x-data="nostrAuth" class="mt-2 flex items-center gap-1 border-t border-zinc-200 pt-2 dark:border-zinc-800">
                <a href="{{ route('group.updates') }}" wire:navigate
                   :aria-label="$store.unread?.updates ? @js(__('Neu, :hints')).split(':hints').join($plural($store.unread.updates, '1 ungelesener Hinweis', ':count ungelesene Hinweise')) : ($store.unread?.updates === undefined && $store.unread?.any ? @js(__('Neu, ungelesene Nachrichten')) : @js(__('Neu')))"
                   class="pressable relative flex size-9 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-black/5 dark:hover:bg-white/5">
                    <flux:icon.bell class="size-5 text-muted" />
                    <x-group::unread-badge count="$store.unread?.updates" :cap="9" size="sm" :sr="false"
                                           badge-class="absolute end-0.5 top-0.5 ring-2 ring-white dark:ring-zinc-900" />
                    <x-group::unread-dot when="$store.unread?.updates === undefined && $store.unread?.any" :sr="false"
                                         dot-class="absolute end-1.5 top-1.5 ring-2 ring-white dark:ring-zinc-900" />
                </a>

                {{-- Identität unten links — die eingeführte Desktop-Konvention. Das
                     Popover-Markup ist dasselbe wie im Mobil-Kopf, nur der Ursprung
                     kehrt sich um: es öffnet nach OBEN (`bottom-full`), sonst führe
                     es aus dem Fenster. --}}
                <div x-data="{ open: false }" class="relative min-w-0 flex-1">
                    <button type="button" x-on:click="open = !open" aria-haspopup="true" :aria-expanded="open"
                            :aria-label="@js(__('Angemeldet als :name')).split(':name').join(myName)"
                            class="pressable flex w-full min-w-0 items-center gap-2 rounded-tile px-1.5 py-1 transition-colors hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:hover:bg-white/5">
                        <x-group::nostr-avatar picture="myPicture" name="myName" size="1.75rem" />
                        <span class="min-w-0 flex-1 truncate text-start text-sm font-semibold text-zinc-900 dark:text-zinc-100" x-text="myName"></span>
                        <x-group::nostr-nip05 nip05="myNip05" />
                        <flux:icon.chevron-up variant="micro" class="size-4 shrink-0 text-muted transition-transform" ::class="open ? 'rotate-180' : ''" />
                    </button>

                    <div x-show="open" x-cloak x-transition
                         x-on:click.outside="open = false" x-on:keydown.escape.window="open = false"
                         class="surface-card absolute bottom-full start-0 z-30 mb-2 w-72 origin-bottom-left p-4 shadow-lg">
                        <div class="flex items-start gap-3">
                            <x-group::nostr-avatar picture="myPicture" name="myName" size="2.75rem" />
                            <div class="min-w-0 flex-1">
                                <div class="flex min-w-0 items-center gap-1">
                                    <span class="min-w-0 truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100" x-text="myName"></span>
                                    <x-group::nostr-nip05 nip05="myNip05" />
                                </div>
                                <div x-show="myNip05" x-cloak class="truncate text-xs text-muted" x-text="myNip05"></div>
                            </div>
                        </div>

                        <p x-show="myAbout" x-cloak class="mt-3 line-clamp-3 text-sm leading-normal text-muted" x-text="myAbout"></p>

                        <div class="mt-3 border-t border-zinc-200/60 pt-3 dark:border-zinc-800/60">
                            <button type="button" x-on:click="copy(npub, @js(__('npub kopiert.')))" aria-label="{{ __('npub kopieren') }}"
                                    class="pressable group/npub flex w-full items-start gap-2 rounded-tile text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
                                <span class="min-w-0 flex-1 break-all font-mono text-[0.7rem] leading-relaxed text-muted" x-text="npub"></span>
                                <flux:icon.clipboard variant="micro" class="mt-0.5 size-3.5 shrink-0 text-muted transition-colors group-hover/npub:text-brand-500" />
                            </button>
                            <div x-show="signerLabel" x-cloak class="mt-1.5 inline-flex items-center gap-1 rounded-full bg-brand-500/10 px-2 py-0.5 text-[0.7rem] font-medium text-brand-800 dark:text-brand-400">
                                <flux:icon.key variant="micro" class="size-3 shrink-0" />
                                <span x-text="@js(__('Angemeldet über :signer')).split(':signer').join(signerLabel)"></span>
                            </div>
                        </div>

                        {{-- Abmelden, auf ausdrücklichen Nutzerwunsch (2026-07-30).
                             Ich hatte es zunächst weggelassen, weil `SettingsMergeTest`
                             „Abmelden lebt an EINEM Ort" festhält — dieser Test meint
                             aber den SETTINGS-Screen (dort waren es einmal 3 Knöpfe),
                             nicht die App. Auf Desktop ist das Profil unten links der
                             erwartete Ort dafür; der Weg über Einstellungen wäre zwei
                             Klicks für eine Aktion, die überall sonst hier sitzt.
                             Der Test zählt jetzt entsprechend nur im Seiteninhalt. --}}
                        <flux:button variant="ghost" size="sm" icon="arrow-right-start-on-rectangle"
                                     class="mt-3 w-full" x-on:click="doLogout()">{{ __('Abmelden') }}</flux:button>
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>
