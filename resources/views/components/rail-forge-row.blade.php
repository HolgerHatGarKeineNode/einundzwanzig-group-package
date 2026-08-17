{{-- Eine Zeile des Forge-Baums (P1). GENAU EIN Wurzelelement — Alpine erlaubt in
     `x-for` nur eines. Steht innerhalb eines `x-for="node in forgeRows"` im
     `nostrRail`-Scope und nimmt bewusst keine Props: sie liest `node` aus dem
     umschließenden Scope, genau wie `rail-room-row` ihr `room` liest.

     ── Warum eine eigene Zeile und nicht `rail-room-row` ────────────────────
     Nur eine der fünf Zeilenarten ist überhaupt ein Raum. Die übrigen tragen
     eine Adresse statt eines `h`, ein Chevron statt eines Avatars und einen
     Zähler statt einer Ungelesen-Pille. Die Kanal-Zeile behält deshalb die
     Merkmale, die sie mit der flachen Liste teilt (Avatar-Box mit `#`-Fallback,
     Ungelesen-Pille, aktiver Balken), aber sie steht hier — eine Komponente mit
     zwei völlig verschiedenen Formen wäre schwerer zu lesen als zwei.

     ── DREI Register, nicht fünf Sorten (Design-Pass 2026-08-17) ────────────
     Bis hierher sahen alle fünf Sorten gleich aus: `text-sm`, dieselbe
     Icon-Größe, dieselbe Farbe — nur das Glyph unterschied sie. In einer 295px
     schmalen Spalte ist das zu wenig; am gerenderten Baum war „Issues" von
     „E2E-General" nicht zu unterscheiden. Die fünf Sorten sind aber gar nicht
     fünf gleichrangige Dinge, sondern drei Register:

       BEHÄLTER   `project` — hat kein Ziel, klappt nur, steht über einer Liste.
                  Trägt deshalb den Satz des SEKTIONSKOPFES (11,2px, versal,
                  gesperrt), nicht den einer Zeile. Ein Projekt ist eine
                  Überschrift, keine Sprungmarke — und sieht jetzt so aus.
       ZIEL       `repo`, `room` — die Orte, an die man geht. Voller Zeilensatz
                  (14px), stärkste Farbe, echtes Objekt-Icon. Das Repository ist
                  das primäre Objekt dieser Fläche; alles andere hängt daran.
       MERKMAL    `issues`, `pulls`, `more` — kein Name aus den Daten, sondern
                  ein Wort aus dem Katalog plus eine Zahl. Sie sind EIGENSCHAFTEN
                  der Zeile darüber, keine Geschwister davon: deshalb steht die
                  Zahl direkt hinter dem Wort (`Issues · 12`) und nicht am
                  rechten Spaltenrand.

     ── Warum der Zähler nach INNEN gewandert ist ────────────────────────────
     Rechtsbündig gesetzt behauptet eine Zahlenspalte, dass die Zahlen
     vergleichbar sind. Die Issues von Repo A und die Pull Requests von Repo B
     sind das nicht. Am Screenshot war zwischen „Issues" und der Zahl ein 150px
     breites Loch — die Zahl gehörte optisch zu nichts mehr. Die Regel, die
     daraus folgt und für die ganze Rail gilt:

       BESTAND (Issues, PRs, Projekte) steht INLINE hinter seiner Beschriftung.
       AUFMERKSAMKEIT (ungelesen) steht RECHTSBÜNDIG.

     Damit ist die rechte Kante der Spalte allein den Ungelesen-Pillen
     vorbehalten, und die beiden Zahlenarten sind nie zu verwechseln. Der
     Mittelpunkt ist Interpunktion, kein Textfragment — er steht als Markup da
     und läuft nicht durch `__()`; für Screenreader trägt ohnehin der `aria-label`
     des Knopfes den ganzen Satz („Issues des Repositorys öffnen (12)").

     ── Einrückung + Führungslinie ──────────────────────────────────────────
     12px je Ebene als Inline-Style (Tailwind kann keine dynamischen Klassen).
     Vorher waren es 8px OHNE Linie — am gerenderten Baum lagen Projekt-, Repo-
     und Merkmalszeile dadurch praktisch auf einer Höhe, die Ebene war nicht mehr
     lesbar. Die Führungslinie leistet hier mehr als jede Einrückung: sie kostet
     1px Breite und macht die Zugehörigkeit eindeutig, statt sie zu andeuten.

     Sie wird je Zeile gezeichnet, eine Linie je VORFAHREN-Ebene, weil das
     Markup eine FLACHE Liste ist (`flattenForgeNav`) — es gibt keine
     Verschachtelung, an der ein CSS-Nachbarselektor greifen könnte. Das geht
     auf, weil die flache Liste eine Tiefensuche ist: alles zwischen einem
     Elternknoten und seinem nächsten Geschwister ist sein Teilbaum. Die Linie
     der Ebene k sitzt bei `12k` — genau unter der Chevron-Mitte des Vorfahren
     auf Ebene k−1. Sie tropft also aus dem Chevron heraus, dem sie gehört.

     Die absolut positionierten Linien hängen am Padding-BOX der Zeile; das
     `padding-inline-start` derselben Zeile verschiebt sie deshalb nicht.

     Kontrast der Linie: zinc-300 auf Weiß 1,48:1, zinc-700 auf zinc-900 1,73:1
     (`p2-kontrast.mjs`). Das ist Absicht und kein Verstoß gegen 1.4.11: die
     Linie ist REDUNDANT — Einrückung, Icon, Register und DOM-Reihenfolge tragen
     die Hierarchie bereits vollständig. Sie ist eine Lesehilfe, kein
     Informationsträger, und liegt bewusst eine Stufe über der dekorativen
     Haarlinie des Hauses (zinc-200 = 1,26:1), damit sie ihre Arbeit tut.

     ── Zwei Trefferflächen, wo es zwei Bedeutungen gibt ─────────────────────
     Hat ein Knoten Kinder, klappt das Chevron und der Name führt auf sein Ziel —
     dieselbe Trennung wie am Sektionskopf. Ein Knoten ohne Ziel (Projektzeile)
     klappt auch über den Namen: sonst wäre der halbe Streifen tot.

     Das Chevron ist 24×24 (vorher 16×16). WCAG 2.2 SC 2.5.8 verlangt 24×24 CSS-px,
     und die Ausnahme „genügend Abstand" greift hier nicht: der Namensknopf liegt
     unmittelbar daneben. 16px war also ein echter Verstoß, kein Geschmack. Das
     Glyph bleibt bei 12px — größer wäre die Zeile mehr Chevron als Text.

     ── Eine Icon-Spalte, eine Textkante ────────────────────────────────────
     Alle Icons sitzen in einer 20px-Box, auch die 14px-Glyphen. Vorher war die
     Kanal-Zeile 20px breit (Logo-Box) und alle anderen 14px — die Namen einer
     Ebene begannen dadurch an zwei verschiedenen Stellen. Eine ausgefranste
     Textkante ist das, was eine Navigation billig aussehen lässt.

     ── Der Name steht ganz im `title` ───────────────────────────────────────
     Gekürzt wird in der MITTE (`nodeName`), weil bei diesen Namen das Ende die
     Information trägt (`middleTruncate`, Begründung dort). Für Screenreader
     trägt der ungekürzte `node.label` im `aria-label` — eine abgeschnittene
     Mitte ist für sie kein Name. --}}
{{-- `data-node-id`: die Knoten-id am Markup, wie `data-rail` an der Spalte.

     Kein Schmuck, sondern die Antwort auf eine echte Zweideutigkeit: die Zeilen
     `issues`/`pulls` tragen ihre Beschriftung aus dem Katalog („Issues des
     Repositorys öffnen (1)") und NENNEN ihr Repo nicht — bei zwei Repos mit je
     einem Issue sind zwei Zeilen wortgleich. Solange alles zugeklappt startete,
     fiel das nicht auf; seit P2 die Repo-Zeilen offen stehen, stehen beide
     zugleich da. Für den Menschen löst das die Einrückung unter dem Repo-Namen
     — für einen Test-Locator nicht, und `.first()` wäre dort geraten statt
     gemeint. Die id ist die Koordinate (`30617:<owner>:<d>#issues`) und damit
     genau die Zeile, die gemeint ist. --}}
<div class="relative flex min-h-8 w-full items-center"
     x-bind:data-node-id="node.id"
     x-bind:style="node.depth > 0 ? 'padding-inline-start:' + (node.depth * 12) + 'px' : null">

    {{-- Führungslinien: eine je Vorfahren-Ebene. `x-for` über einen Zahlenbereich
         (Alpine, 1-basiert) — keine Daten nötig, `node.depth` sagt alles. --}}
    <template x-for="lvl in node.depth" :key="lvl">
        <span aria-hidden="true"
              class="pointer-events-none absolute inset-y-0 w-px bg-zinc-300 dark:bg-zinc-700"
              x-bind:style="'inset-inline-start:' + (lvl * 12) + 'px'"></span>
    </template>

    {{-- Chevron: eigener Knopf, nur bei Knoten MIT Kindern. Reserviert bei
         Blättern denselben Platz (`size-6`), damit die Namen einer Ebene
         untereinander stehen statt zu springen. `relative`, damit er über der
         Führungslinie liegt, die an seiner linken Kante entlangläuft. --}}
    <template x-if="node.children.length > 0">
        <button type="button" x-on:click.stop="toggleNode(node)"
                x-bind:aria-expanded="isNodeOpen(node) ? 'true' : 'false'"
                x-bind:aria-label="@js(__('Eintrag :name auf- oder zuklappen')).split(':name').join(node.label)"
                class="pressable relative inline-flex size-6 shrink-0 items-center justify-center rounded text-muted transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100">
            <flux:icon.chevron-right variant="micro" aria-hidden="true"
                                     class="size-3 shrink-0 transition-transform"
                                     x-bind:class="isNodeOpen(node) ? 'rotate-90' : ''" />
        </button>
    </template>
    <template x-if="node.children.length === 0">
        <span aria-hidden="true" class="inline-block size-6 shrink-0"></span>
    </template>

    <button type="button" x-on:click="openNode(node)"
            x-bind:aria-current="node.id === activeTargetId ? 'page' : null"
            x-bind:aria-label="node.kind === 'issues'
                ? @js(__('Issues des Repositorys öffnen (:count)')).split(':count').join(node.count)
                : (node.kind === 'pulls'
                    ? @js(__('Pull Requests des Repositorys öffnen (:count)')).split(':count').join(node.count)
                    : (node.kind === 'more'
                        ? @js(__('Alle Projekte anzeigen (:count)')).split(':count').join(node.count)
                        : node.label))"
            x-bind:title="node.label || null"
            class="pressable group relative flex min-h-8 min-w-0 flex-1 items-center gap-2 rounded-tile px-2 py-1 text-start transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800"
            x-bind:class="node.id === activeTargetId
                ? 'bg-brand-500/10 font-semibold text-zinc-900 dark:text-zinc-50'
                : (node.kind === 'project'
                    ? 'font-semibold text-muted'
                    : (node.kind === 'room' && isMuted(node.room)
                        ? 'font-normal text-muted'
                        : (node.kind === 'repo'
                            ? 'font-medium text-zinc-800 dark:text-zinc-100'
                            : 'font-normal text-muted')))">

        <span x-show="node.id === activeTargetId" aria-hidden="true"
              class="absolute inset-y-1 start-0 w-0.5 rounded-pill bg-brand-700 dark:bg-brand-500"></span>

        {{-- Icon je Sorte, alle in derselben 20px-Box (siehe „Eine Icon-Spalte"
             oben). Die Glyphen bleiben in der kleinen Stufe (`micro`, 14px),
             weil drei Ebenen sonst mehr Icon als Text sind. Der Kanal behält die
             Logo-Box der flachen Liste — dieselbe Geometrie, damit ein Kanal im
             Baum wie ein Kanal aussieht und nicht wie ein neuer Gegenstand.

             `rectangle-stack` für das Projekt und NICHT `squares-2x2`: das steht
             in derselben Spalte schon an „Alle Räume & Entdecken"
             (`desktop-rail.blade.php`). Zwei Bedeutungen auf einem Glyph in
             EINER Spalte ist kein Detail — es ist die Sorte Fehler, die man
             nicht benennen, aber sehen kann. Ein Stapel ist ohnehin die
             richtigere Aussage: ein Projekt ist ein Bündel von Repositories. --}}
        <template x-if="node.kind === 'room'">
            <span x-data="{ imgOrig: false, imgBroken: false }"
                  class="relative inline-flex size-5 shrink-0 items-center justify-center overflow-hidden rounded-md">
                <template x-if="!node.room.picture || imgBroken">
                    <span aria-hidden="true" class="font-mono text-sm text-muted">#</span>
                </template>
                <template x-if="node.room.picture && !imgBroken">
                    <img alt="" class="size-full object-cover"
                         x-bind:src="imgOrig ? node.room.picture : $img(node.room.picture)"
                         x-on:error="imgOrig ? (imgBroken = true) : ($imgFallback(node.room.picture) ? (imgOrig = true) : (imgBroken = true))" />
                </template>
            </span>
        </template>
        <template x-if="node.kind === 'repo'">
            <span aria-hidden="true" class="inline-flex size-5 shrink-0 items-center justify-center">
                <flux:icon.folder variant="micro" class="size-4" />
            </span>
        </template>
        <template x-if="node.kind === 'project'">
            <span aria-hidden="true" class="inline-flex size-5 shrink-0 items-center justify-center">
                <flux:icon.rectangle-stack variant="micro" class="size-3.5" />
            </span>
        </template>
        <template x-if="node.kind === 'issues'">
            <span aria-hidden="true" class="inline-flex size-5 shrink-0 items-center justify-center">
                <flux:icon.exclamation-circle variant="micro" class="size-3.5" />
            </span>
        </template>
        <template x-if="node.kind === 'pulls'">
            <span aria-hidden="true" class="inline-flex size-5 shrink-0 items-center justify-center">
                <flux:icon.arrows-right-left variant="micro" class="size-3.5" />
            </span>
        </template>
        <template x-if="node.kind === 'more'">
            <span aria-hidden="true" class="inline-flex size-5 shrink-0 items-center justify-center">
                <flux:icon.ellipsis-horizontal variant="micro" class="size-3.5" />
            </span>
        </template>

        {{-- Beschriftung UND Bestand in EINER Gruppe: sie sind zusammen die
             Aussage der Zeile, deshalb ist die Gruppe das `flex-1`-Kind und
             nicht der Name allein. Alles danach (Glocke, Ungelesen-Pille) bleibt
             dadurch rechtsbündig, ohne dass hier ein `ms-auto` nötig wäre.

             Beschriftung aus den Daten, wo es einen Namen gibt — aus dem Katalog,
             wo es keinen gibt. `railForge.ts` bleibt sprachfrei und liefert für
             diese drei Sorten bewusst ein leeres `label`. --}}
        <span class="flex min-w-0 flex-1 items-baseline gap-1">
            <span class="min-w-0 truncate"
                  x-bind:class="node.kind === 'project'
                      ? 'text-[0.7rem] uppercase tracking-wide'
                      : 'text-sm'"
                  x-text="node.kind === 'issues' ? @js(__('Issues'))
                        : (node.kind === 'pulls' ? @js(__('Pull Requests'))
                        : (node.kind === 'more' ? @js(__('Alle Projekte')) : nodeName(node)))"></span>

            {{-- Bestand, nie als Ungelesen-Pille: es sind Bestände, keine
                 Neuigkeiten. `buildForgeNav` liefert `0` gar nicht erst (Regel 5).
                 `aria-hidden`, weil der `aria-label` des Knopfes die Zahl schon
                 im ganzen Satz trägt — zweimal vorgelesen wäre sie Lärm. --}}
            <template x-if="node.count > 0">
                <span aria-hidden="true" class="shrink-0 whitespace-nowrap font-mono text-[0.7rem] tabular-nums text-muted">·&nbsp;<span x-text="node.count"></span></span>
            </template>
        </span>

        {{-- Ein Kanal im Baum ist derselbe Kanal wie in der flachen Liste: stumm
             bleibt stumm, ungelesen bleibt ungelesen. Ohne das wäre die
             Stummschaltung an einer Stelle wirksam und an der anderen nicht. --}}
        <template x-if="node.kind === 'room' && isMuted(node.room)">
            <span class="inline-flex shrink-0 items-center">
                <flux:icon.bell-slash variant="micro" aria-hidden="true" class="size-3.5 text-muted" />
            </span>
        </template>
        <template x-if="node.kind === 'room'">
            <x-group::unread-badge count="!isMuted(node.room) && $store.unread?.rooms?.[node.room.h]" size="sm" :sr="false" />
        </template>
    </button>
</div>
