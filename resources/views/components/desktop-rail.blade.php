{{-- „Deine Leiste" (Plan „Desktop-Shell" P4, reshaped by P6/D10) — die linke Spalte ab `xl`.

     ── What P6 made of it ────────────────────────────────────────────────────
     Start, then the reader's pins, then the space's room groups (collapsible, as
     before). The footer is gone; the identity moved into the command bar above
     the stage (`command-bar.blade.php`). Alt+↑/↓ still walks `railTargets`
     (`js/rail.ts`), so the keyboard order is unchanged — the two new blocks stand
     ABOVE the list the jump list is built from and add nothing to it: Start and a
     pin are single targets, not rows of a group, and a jump list mixing both would
     no longer be „the next room".

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

         Nur vorhandene öffentliche Insel-API: `zeigeKanaele`/`kanalSprungErledigt`.

         ── Warum ZWEI Attribute und nicht ein `$nextTick` im Zuhörer ──────────
         Bis 2026-08-27 stand der Fokus hier direkt im `$nextTick`. Das war
         wirkungslos, seit es ihn gibt: das Ereignis trifft ein, BEVOR die
         Workspace-Sektion existiert. Gemessen mit einer Sonde am Zuhörer —
         `document.querySelectorAll('[data-rail-gruppenkopf]').length` war im
         Moment des Ereignisses **0**, und nach zwei `requestAnimationFrame`
         immer noch 0. Der Kopf hängt an `<template x-if="hasWorkspaceSection">`,
         und die Bedingung wird erst wahr, wenn die Workspace-Daten eingetroffen
         sind. `focus()` und `scrollIntoView()` liefen auf `undefined`.

         Unsichtbar blieb das, weil die Gruppe trotzdem aufging: `toggleGroup`
         setzt nur einen Zustand und braucht kein DOM. Der Sprung SAH also
         funktionierend aus und löste seine Hauptzusage nie ein.

         Ein `x-effect` auf `hasWorkspaceSection` wäre der naheliegende Bau und
         ist GEMESSEN gescheitert: Alpine wertet ihn nicht neu aus, wenn dieser
         Getter wahr wird. Er liest `hasWorkspace()`, eine Funktion ausserhalb
         des Alpine-Datenobjekts — also ausserhalb jeder Abhängigkeitsverfolgung.
         Der Effect stand korrekt im DOM (`x-effect`-Attribut nachgewiesen),
         `kanalSprungOffen` und `hasWorkspaceSection` waren beide `true`, der Kopf
         war da (`koepfe: 1`) — und er lief trotzdem nicht.

         Deshalb zwei Auslöser auf EINE Methode (`vollzieheKanalSprung`):
         hier für die warme Lage (Sektion steht schon), und ein `x-init` am Kopf
         selbst (`rail-group.blade.php`) für die kalte — dort meldet sich der Kopf,
         sobald es ihn gibt. Der Merker sorgt dafür, dass nur einer von beiden
         zieht. --}}
    <div x-data="nostrRail" data-rail
         x-on:forge-zeige-kanaele.window="
             zeigeKanaele()
             $nextTick(() => vollzieheKanalSprung($el.querySelector('[data-rail-gruppenkopf=&quot;workspace&quot;]')))
         "
         class="hidden min-h-0 flex-col border-e border-zinc-200 bg-white xl:col-start-1 xl:row-start-1 xl:flex dark:border-border dark:bg-zinc-950">

        {{-- ══ THE DIRECT CHILDREN OF `[data-rail]` ARE THE THREE LAYOUT BLOCKS ═════
             Header · search field · list, and nothing else. Until P6 there was a fourth,
             the footer; it is gone with the command bar (the note where it stood says
             why). The placeholder (`rail-skelett.blade.php`) mirrors exactly these three,
             and `tests/e2e/desktop-boot-geometrie.spec.ts` compares them block for block —
             its `bloecke()` throws on any other count, because a pairwise comparison of
             two differently long lists is not a comparison.

             Non-layout attachments (store lifecycles, overlays) therefore go INSIDE one
             of the three, not next to them. A visibility filter in the test would not be
             an alternative: an empty `<ui-modal>` is not `display:none`, so it would pass
             such a filter and the invariant would only look intact. --}}

        {{-- Space-Kopf: „wo bin ich" gehört an den Anfang der Ortsspalte. --}}
        <div class="flex shrink-0 items-center gap-2.5 px-4 pt-4 pb-3">
            <x-group::nostr-avatar picture="space?.icon" name="spaceLabel" size="2rem" />
            <div class="min-w-0 flex-1">
                <div class="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100" x-text="spaceLabel"></div>
                {{-- `data-rail-space-beschreibung`: der Anker, an dem
                     `desktop-boot-geometrie.spec.ts` wartet, bevor sie den Rail-Kopf
                     misst. Die Beschreibung ist ein Relay-Datum und trifft nach dem
                     Boot asynchron ein (`x-show`); ein Test, der nur auf `[data-rail]`
                     wartet, misst manchmal den ungewachsenen Kopf (60 statt 64 px) —
                     siehe `vergleich()` in der Spec-Datei. --}}
                <div x-show="space?.description" x-cloak data-rail-space-beschreibung
                     class="truncate text-xs text-muted" x-text="space?.description"></div>
            </div>
        </div>

        {{-- Die Signatur des Clients: der `#`-Prompt. Tippen filtert die Liste
             darunter, Enter springt in den ersten Treffer. `type=search` gibt dem
             Feld die native Leeren-Geste; `#` ist Dekoration und deshalb
             aria-hidden — das Label steht am Input. --}}
        {{-- ══ KEIN `font-mono` IN DER RAIL — die eine Begründung für elf Stellen ══
             Gefallen sind in P6b elf Träger: die vier `#`-Glyphen (hier, Raumzeile,
             Forge-Zeile, Raumkachel), vier Zähler, der `⌘K`-Chip, der npub in der
             Fußzeile und der Hinweis im Erwähnungs-Popover.

             Der Grund ist gemessen, nicht stilistisch (`p6b-rail-VORHER.log`, am
             gerenderten Baum bei 1440 px): der Rumpf läuft in **`Inconsolata`**,
             jeder `font-mono`-Träger lief in **`ui-monospace`**. Das war eine ZWEITE
             Schriftfamilie — der Kanon lässt zwei zu, das Haus hat sich aber auf
             EINE festgelegt (Nutzerentscheid 2026-08-26: „Inconsolata bleibt
             überall"). Und sie kaufte nichts ein: Inconsolata IST eine Zellenschrift,
             die Ziffern stehen ohnehin im Raster.

             Was BLEIBT, ist `tabular-nums`. Es schaltet keine Familie um, sondern
             eine Zifferngestalt — in einer Zellenschrift heute wirkungslos, aber die
             richtige Zusage an der richtigen Stelle, falls der Rumpf je proportional
             wird. Eine Klasse, die nichts kostet und eine Absicht festhält, ist kein
             toter Vorrat.

             NACHGEZOGEN am 2026-08-27 (der Restposten, den diese Stelle gemeldet
             hat): `unread-badge.blade.php` und `nostr-avatar.blade.php`. Beide
             rendern auch ausserhalb dieser Fläche, deshalb bekamen sie eine eigene
             Messung statt eines Nachzugs — die Zahlen stehen in den Bauteilen.
             Das hier notierte Risiko („FESTE Geometrie, wo ein Familienwechsel die
             Glyphenbreite ändert") hat sich NICHT bestätigt: `min-w-*` ist ein
             Boden, kein Deckel, und der Wechsel geht ohnehin in die schmalere
             Richtung (md „99+" 33,61 → 30,02 px, einstellig 0 px Änderung). --}}
        {{-- Ein Feld, ein Scope. Zehn Suchfelder (vier Gruppen + sieben Länder)
             wären 340px in einer Spalte mit ~600px Scrollfläche — die Rail wäre
             zur Hälfte Formular, und man müsste zum Suchen erst scrollen.
             Der Chip kostet 0px zusätzliche Höhe und macht die Gruppenstruktur
             adressierbar statt nur aufklappbar. --}}
        <label class="mx-3 mb-2 flex shrink-0 items-center gap-1.5 rounded-tile border border-zinc-300 bg-zinc-100 px-2.5 py-1.5 focus-within:ring-2 focus-within:ring-accent dark:border-border-chip dark:bg-zinc-900">
            <span aria-hidden="true" class="text-sm font-bold text-brand-800 dark:text-brand-400">#</span>

            <template x-if="scope.group || scope.country">
                <button type="button" x-on:click="clearScope()"
                        x-bind:aria-label="@js(__('Suchbereich aufheben: :label')).split(':label').join(scopeLabel)"
                        class="pressable inline-flex shrink-0 items-center gap-1 rounded-pill bg-brand-500/10 px-1.5 py-0.5 text-xs font-semibold text-zinc-900 dark:text-zinc-50">
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
                    class="pressable inline-flex h-6 shrink-0 items-center rounded-pill border border-zinc-300 px-2 text-[11px] leading-none text-muted transition-colors hover:text-zinc-900 dark:border-border-strong dark:hover:text-zinc-100">⌘K</button>
        </label>

        {{-- Die einzige Fläche, die scrollt. `min-h-0` ist Pflicht: ohne das
             wächst ein Flex-Kind über seinen Container hinaus statt zu scrollen. --}}
        {{-- `data-rail-scroller`: die Raumliste braucht einen Anker, seit die Fußzeile
             darunter eigene Zeilen mit denselben Beschriftungen trägt. `buzz-rail-forge`
             prüft damit, was von „Regel 1" bleibt — im SCROLLER steht kein flacher
             Forge-Eintrag; er ist eine Fläche des Clients, kein Raum. --}}
        <div data-rail-scroller class="min-h-0 flex-1 overflow-y-auto px-3 pb-2">

            {{-- ══ „Deine Leiste" begins with Start, then the pins (P6/D10) ═══════════
                 The order is the answer to „what is mine, what is the space's": Start is
                 the one surface that renders for everyone (D4) and the place every other
                 way starts from; below it the shortcuts the reader placed himself; below
                 those the space's own room groups, unchanged.

                 Start stands HERE and not in the command bar above, although the bar is
                 where the three global affordances live: Start is a PLACE, and places are
                 what this column is for. The bar carries search, inbox and identity — none
                 of which is a place in the space.

                 Not a `flux:navlist.item`: the navlist below is the landmark of the ROOM
                 LIST („Räume und Bereiche"), and a client surface inside it would claim to
                 be a room group. Same distinction the „Alle Räume & Entdecken" row at the
                 foot of this scroller already makes, and the same class signature. --}}
            {{-- P3 (Entwurf C `.rail a`): die Startzeile ist 44 px hoch, radius 10 —
                  dieselbe Zeilenform wie die Raumzeilen. `xl:`-Varianten statt Austausch
                  der Basis: `min-h-9 … rounded-tile` ist die signierte Geometrie der
                  Drittblock-Messung in RailSkelettTest (Positivkontrolle der Fußzeilen-
                  Negation) und bleibt als Grundstand erhalten; ab `xl` — wo allein die
                  Rail existiert — tragen die Varianten das Entwurfsmaß. Zwei Varianten-
                  getrennte Utilities konkurrieren nicht miteinander.

                  Der AKTIVE Zustand hängt am Pfad wie der aktive Raum (`roomHFromPath`
                  liest die URL, weil `wire:navigate` Alpine neu aufbaut, die Adressleiste
                  nicht): Fläche im accent-wash, Gewicht 800 — Farbe, Fläche
                  UND Gewicht, nie Farbe allein (WCAG 1.4.1). Der Aktivtext ist
                  je Theme der lesbare Orangeton: brand-800 im Light (6,09:1 auf
                  brand-50), Orange #f7931a im Dark (7,44:1 auf #241a0d). Farbe
                  und Gewicht stehen im
                  x-bind und nicht in der Basis: eine Basis-`text-*` davor verlöre gegen die
                  gebundene Farbe je nach Build-Reihenfolge — dieselbe Falle, die
                  `rail-room-row` für die Mitgliedschaftsstufen dokumentiert. --}}
            @php($startPfad = (string) parse_url(route(config('group.start_route', 'group.start')), PHP_URL_PATH))
            <a href="{{ route(config('group.start_route', 'group.start')) }}" wire:navigate data-rail-start
               x-bind:aria-current="window.location.pathname === @js($startPfad) ? 'page' : null"
               class="pressable flex min-h-9 items-center gap-2 rounded-tile px-2 text-sm transition-colors hover:bg-zinc-100 xl:min-h-11 xl:rounded-btn dark:hover:bg-zinc-800"
               x-bind:class="window.location.pathname === @js($startPfad)
                   ? 'bg-accent-wash font-extrabold text-brand-800 dark:text-accent'
                   : 'font-medium text-zinc-900 dark:text-zinc-100'">
                <flux:icon.home variant="micro" class="sw-18 size-5 shrink-0" />
                <span>{{ __('Start') }}</span>
            </a>

            {{-- The pins — the SAME list Start shows as chips, from the same selector and
                 with the same target table (`pin-list.blade.php`, `$store.pinSet.rows`).
                 Nothing renders while the set is empty. --}}
            <x-group::pin-list variant="bar" />

            {{-- ── Where the conversation store is mounted (P8) ────────────────────
                 It was mounted right here until P7, for the Buzz DM channels: their
                 dismissed-conversation state (30622) had to be known before the first row
                 rendered. That transport is gone, and the NIP-17 store that replaced it is
                 mounted once for the whole app in `app-frame.blade.php` — it feeds this
                 group AND the list on `/spaces`, and its wrap subscription is the one
                 request that costs the signer, so it gets exactly one bracket.

                 Nothing is left here on purpose: a second mount would be a second reason
                 to keep that subscription alive, and the rail is the wrong owner for it —
                 the NativePHP host never renders this column server-side and the web
                 client only from `xl` up. --}}

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
            {{-- ══ DAS LANDMARK DER RAUMLISTE — hier trägt `flux:navlist` wirklich ══
                 Gemessen und dabei die eigene Annahme korrigiert: die Rail hatte
                 sehr wohl ein `<nav>` — aber das der FUSSZEILE (the vertical set of nav
                 tabs, gone since P2). Die Raumliste selbst stand in keinem
                 (`p6b-rail-VORHER.log`: `scrollerIstNav: false`). Das eigentliche
                 Navigationsangebot des Clients — vier Gruppen, Räume, Forge-Baum —
                 war also kein Landmark, während die kleine Linkreihe darunter eines
                 war. Wer per Landmark springt, landet im Fuss und nicht in der Liste.

                 `flux:navlist` rendert genau das: `<nav class="flex flex-col
                 overflow-visible min-h-auto">`. Das ist die eine Stelle in diesem
                 Umbau, an der die Komponente einen MECHANISMUS mitbringt und nicht
                 nur Klassen — deshalb wird sie hier genommen und an den drei anderen
                 Stellen mit Rechnung abgelehnt (siehe `rail-group.blade.php`).

                 Der Name ist NICHT „Navigation": es gibt bereits ein
                 `aria-label="Hauptnavigation"` in der Fusszeile derselben Spalte.
                 Zwei Landmarks gleichen Typs brauchen unterscheidbare Namen, sonst
                 sind sie in der Landmark-Liste nicht auseinanderzuhalten.

                 `flex flex-col` ist neu an dieser Stelle — vorher lag hier Blockfluss.
                 Deshalb ist die Geometrie vorher/nachher gemessen und nicht
                 abgeschätzt (`p6b-rail-VORHER.log` / `-NACHHER.log`). --}}
            <flux:navlist aria-label="{{ __('Räume und Bereiche') }}">
            <x-group::rail-group group="rooms" :label="__('Räume')" />

            {{-- Der zweite Space. Existiert nur bei gesetztem `NOSTR_WORKSPACE_URL`;
                 ohne Config ist die Rail zeichengleich zu vorher. Die Räume kommen
                 aus einem EIGENEN Watch auf die Workspace-URL, nicht aus dem aktiven
                 Space — deshalb stehen hier beide nebeneinander statt abwechselnd. --}}
            {{-- Since P1 the workspace IS the Forge: no separate `Forge` entry at the
                 foot any more, the tree lives in this section. Three ways lead to
                 the overview page — the section NAME (since the icon removal of
                 2026-09-18 the only labeled way in this column), the fold row that
                 appears once collapsing kicks in, and the command palette
                 (`command-palette.blade.php`, action `forge`). Until that removal a
                 `</>` icon link to the same target stood next to the name; a
                 production user report about an unnameable entry in this bar buried
                 it — the full reasoning sits at its former place in
                 `rail-group.blade.php`. --}}
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
                                         heading-href="{{ route('group.bereich.forge') }}"
                                         :heading-title="__('Forge auf :wert')"
                                         heading-title-value="workspaceLabel" />
                </div>
            </template>

            {{-- ── Encrypted conversations (P8, NIP-17) ────────────────────────────
                 In THIRD place and therefore before the two directories: "who am I
                 talking to" is the third place of work next to ROOMS and FORGE. The block
                 order here MUST match `RAIL_GROUP_ORDER` — same rule and same reason as
                 above (the eye reads the block order, Alt+↑/↓ walks `railTargets`).

                 ── What changed with P8 ─────────────────────────────────────────────
                 Until P7 the Buzz DM channels stood here: a channel with an `h` whose
                 messages lie in PLAINTEXT on the relay. They are gone without replacement
                 — a conversation in this house is always a NIP-17 gift wrap the operator
                 cannot open. The rows therefore come from
                 `$store.privateMessages.conversations` and lead to `/messages`, not to
                 `/rooms/{h}`: an encrypted conversation has no `h` on any relay
                 (`rail.ts`, `toRailDms`).

                 ── What changed with P3 (D5) ────────────────────────────────────────
                 The ROWS are gone. `$store.privateMessages` is no longer mounted outside
                 the Postfach's „Direkt" segment, because its `mount()` arms the wrap
                 subscription and every envelope it answers with costs the user's signer two
                 `nip44.decrypt`. A rail that lists conversations has paid for that on every
                 page — and there is no cheaper version of the list: the participants sit
                 inside the seal.

                 What is left is the group with ONE row that leads there. The group keeps its
                 place in `RAIL_GROUP_ORDER` (the eye reads the block order, Alt+↑/↓ walks
                 `railTargets`), so nothing about the rail's geometry or its keyboard order
                 moves; P6 rebuilds this column anyway.

                 `rail.ts toRailDms` therefore has no source any more and yields an empty
                 list — which is why the row below is plain markup and not a `rail-group`
                 row. --}}
            <flux:navlist.item :href="route('group.postfach', ['ansicht' => 'direkt'])" wire:navigate
                               icon="lock-closed" data-rail-dm>
                {{ __('Verschlüsselt') }}
            </flux:navlist.item>

            <x-group::rail-group group="meetups" :label="__('Meetups')" :countries="true" />
            <x-group::rail-group group="proposals" :label="__('Projektunterstützung')" />
            </flux:navlist>

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
                    <p class="mt-1 text-xs text-muted">{{ __('Alt + ↑/↓ wechselt den Raum · m: p: r: f: grenzen ein') }}</p>
                </div>
            </template>

            {{-- Der Weg zu allem, was die Rail bewusst nicht kann. --}}
            {{-- Der Weg zu allem, was die Rail bewusst nicht kann. Dasselbe Zeilenmaß
                  wie Start oben (44 px, radius 10, `xl:`-Varianten über der signierten
                  Basis — Begründung dort). --}}
            <a href="{{ route('group.bereich.chat') }}" wire:navigate
               class="pressable mt-1 flex min-h-9 items-center gap-2 rounded-tile px-2 text-sm font-medium text-muted transition-colors hover:bg-zinc-100 hover:text-zinc-900 xl:min-h-11 xl:rounded-btn dark:hover:bg-zinc-800 dark:hover:text-zinc-100">
                <flux:icon.squares-2x2 variant="micro" class="sw-18 size-5 shrink-0" />
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

        {{-- ══ THE FOOTER IS GONE WITH P6, AND THIS IS WHERE IT STOOD ═══════════════
             P2 had already taken the four area rows, the vertical set of nav tabs and the
             bell out of it; what was left was ONE row, the identity, „until P6 builds the
             command bar" (its own note said so). The bar exists now
             (`command-bar.blade.php`), it carries the avatar at the top right of the stage,
             and a second avatar in the bottom left of the same window would be the third
             form of the same thing — the drift Concept C removed.

             **That is why this column now has THREE direct children and not four**: header
             · search field · list. The placeholder (`rail-skelett.blade.php`) mirrors
             exactly those three, and `tests/e2e/desktop-boot-geometrie.spec.ts` compares
             them block for block — its `bloecke()` throws on any other count.

             Whoever wants to put an overlay in this column again: NOT as a direct child of
             `[data-rail]`, and no longer into a footer that does not exist. The scroller is
             the wrong host (it scrolls away), so a new one needs its own decision — and a
             fourth block needs the placeholder and the spec changed in the SAME edit. The
             most expensive boot jump in this file so far was 38 px, from exactly that
             mistake. --}}
    </div>
</template>
