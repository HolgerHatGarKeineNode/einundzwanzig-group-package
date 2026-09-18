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
         class="hidden min-h-0 flex-col border-e border-zinc-200 bg-white xl:col-start-1 xl:row-start-1 xl:flex dark:border-zinc-800 dark:bg-zinc-900">

        {{-- ══ THE DIRECT CHILDREN OF `[data-rail]` ARE THE FOUR LAYOUT BLOCKS ══════
             Header · search field · list · footer, and nothing else. The placeholder
             (`rail-skelett.blade.php`) mirrors exactly these four, and
             `tests/e2e/desktop-boot-geometrie.spec.ts` compares them block for block —
             its `bloecke()` throws on any other count, because a pairwise comparison of
             two differently long lists is not a comparison.

             Non-layout attachments (store lifecycles, overlays) therefore go INSIDE one
             of the four, not next to them — the DM store lifecycle at the top of the
             scroller, the DM dialog at the end of the footer, each with its own note.
             A visibility filter in the test would not be an alternative: an empty
             `<ui-modal>` is not `display:none`, so it would pass such a filter and the
             invariant would only look intact. --}}

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
        <label class="mx-3 mb-2 flex shrink-0 items-center gap-1.5 rounded-tile bg-zinc-100 px-2.5 py-1.5 focus-within:ring-2 focus-within:ring-accent dark:bg-zinc-800">
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
                    class="pressable inline-flex h-6 shrink-0 items-center rounded bg-black/5 px-1.5 text-xs text-muted transition-colors hover:text-zinc-900 dark:bg-white/10 dark:hover:text-zinc-100">⌘K</button>
        </label>

        {{-- Die einzige Fläche, die scrollt. `min-h-0` ist Pflicht: ohne das
             wächst ein Flex-Kind über seinen Container hinaus statt zu scrollen. --}}
        {{-- `data-rail-scroller`: die Raumliste braucht einen Anker, seit die Fußzeile
             darunter eigene Zeilen mit denselben Beschriftungen trägt. `buzz-rail-forge`
             prüft damit, was von „Regel 1" bleibt — im SCROLLER steht kein flacher
             Forge-Eintrag; er ist eine Fläche des Clients, kein Raum. --}}
        <div data-rail-scroller class="min-h-0 flex-1 overflow-y-auto px-3 pb-2">

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
                                         heading-href="{{ route('group.bereich.forge') }}"
                                         :overview-label="__('Forge-Übersicht öffnen')"
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
            <a href="{{ route('group.bereich.chat') }}" wire:navigate
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
            {{-- ══ What stood here until P2, and why it is gone ══════════════════════
                 Four area rows (Artikel · Forge · Lesezeichen · Verschlüsselt), the
                 vertical set of nav tabs from `config('group.nav')`, and a bell.

                 All three blocks answered the same question — "where else?" — and each in
                 its own way: the rows quietly, the tabs in brand colour, the bell as an
                 icon with a number. Three vocabularies for one question, on 20 rem of
                 width, next to a room list that already fills the same surface.

                 Since Concept C the answer exists once: Start carries "Alle Bereiche", the
                 command palette (⌘K) finds every place from every page, and the Postfach is
                 a slot of the bar, resp. an icon of the command bar from P6 on. The `nav`
                 registry is gone from every host with this phase.

                 **What REMAINS is the identity at the bottom left** — the established
                 desktop convention and, until P6 builds the command bar, the only avatar
                 place on the desktop. The rail also keeps its room groups; P6 reshapes it
                 into "Deine Leiste" (Start + pins + collapsible groups). --}}
            {{-- `data-rail-fuss-profil`: the unambiguous anchor of the ONE row the footer
                 still carries. The geometry class is no good for that — `flex items-center
                 gap-1` occurs four times in this rail, and a test on it counted arbitrary
                 rows (measured 4 instead of 1). Same construction and same reason as the
                 former `data-rail-fuss`. --}}
            <div x-data="nostrAuth" data-rail-fuss-profil class="flex items-center gap-1">

                {{-- Identität unten links — die eingeführte Desktop-Konvention. Das
                     Popover-Markup ist dasselbe wie im Mobil-Kopf, nur der Ursprung
                     kehrt sich um: es öffnet nach OBEN (`bottom-full`), sonst führe
                     es aus dem Fenster. --}}
                <div x-data="{ open: false }" class="relative min-w-0 flex-1">
                    <button type="button" x-on:click="open = !open" aria-haspopup="true" :aria-expanded="open"
                            :aria-label="@js(__('Angemeldet als :name')).split(':name').join(myName)"
                            class="pressable flex w-full min-w-0 items-center gap-2 rounded-tile px-1.5 py-1 transition-colors hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:hover:bg-white/5">
                        {{-- Der eigene Präsenzpunkt (P6). Er liest `mine` und NICHT
                             `byPubkey[<eigener pubkey>]`: der Relay fanoutet das eigene 20001 nicht
                             zuverlässig an die eigene Verbindung zurück, und was hier stehen soll, ist
                             ohnehin die andere Auskunft — „das sendest du gerade über dich". Ist der
                             Store nicht angemeldet (kein Raum offen), steht dort nichts. --}}
                        <x-group::nostr-avatar picture="myPicture" name="myName" size="1.75rem"
                                               presence="$store.presence?.mine" />
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

                        <div class="mt-3 border-t border-zinc-200 pt-3 dark:border-zinc-800">
                            <button type="button" x-on:click="copy(npub, @js(__('npub kopiert.')))" aria-label="{{ __('npub kopieren') }}"
                                    class="pressable group/npub flex w-full items-start gap-2 rounded-tile text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
                                <span class="min-w-0 flex-1 break-all text-xs leading-relaxed text-muted" x-text="npub"></span>
                                <flux:icon.clipboard variant="micro" class="mt-0.5 size-3.5 shrink-0 text-muted transition-colors group-hover/npub:text-brand-500" />
                            </button>
                            <div x-show="signerLabel" x-cloak class="mt-1.5 inline-flex items-center gap-1 rounded-full bg-brand-500/10 px-2 py-0.5 text-xs font-medium text-brand-800 dark:text-brand-400">
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

            {{-- ══ WHERE THE DM DIALOG WENT ═════════════════════════════════════════
                 `<x-group::dm-modal />` stood here, at the end of the footer. It is gone
                 with the Buzz DM channels (P8): a conversation is created in the person
                 picker on `/messages` now, and the rail's `+` button jumps there.

                 **Nothing changes for this column's geometry, and that is why this note
                 stands here and not only in the commit.** A closed `flux:modal` is a
                 `<dialog>` in the UA's `display:none` state — no line box, no height. The
                 footer measured 302 px with and without it (264 without the workspace),
                 pinned down in `desktop-boot-geometrie.spec.ts`.

                 Whoever ever puts an overlay here again: NOT as a direct child of
                 `[data-rail]`. That set of children IS the measured column (four blocks,
                 see the note at the top of this file); a fifth entry breaks the
                 block-by-block comparison against the placeholder. The footer was the host
                 because it is the one block that never collapses, never scrolls and is
                 always there (`shrink-0`). --}}
        </div>
    </div>
</template>
