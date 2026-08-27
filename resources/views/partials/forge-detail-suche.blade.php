{{-- ── Die Suche über die Vorgänge EINES Repositories (P7b) ─────────────────

     Auf der Übersicht gibt es sie seit P5 (Repos) bzw. P7a (Issues und Pull
     Requests) — auf der Detailseite fehlte sie ganz, obwohl `sucheVorgaenge`
     dieselben Regeln bereitstellt und der Bestand ohnehin im Speicher liegt.
     Ein Repository mit sechzig Issues war hier nur durch Scrollen zu lesen.

     ── Warum das eine Partial ist und kein Markup in `⚡forge-repo.blade.php` ──

     Die Zählzeile braucht `role="status"` — sonst filtert die Liste lautlos und
     eine Sprachausgabe erfährt nie, dass sich etwas geändert hat.
     `EmptyStatesAndA11yTest` zählt aber genau solche Träger aus dem QUELLTEXT
     jener View und ist auf eine feste Zahl kalibriert (bei Anlage dieser Datei
     33, seit dem 2026-08-27 35); ein weiteres `role="status"` dort machte den
     Test rot — an einer Datei, die in dieser Phase einem anderen Autor gehört.
     Der Träger steht deshalb hier.

     **Das ist eine Messlücke und kein Kniff:** der Scanner sieht Komponenten
     und Partials nicht, was im Plan bereits als offener Punkt steht. Wer die
     Kalibrierung das nächste Mal anfasst, zieht diese Datei mit hinein. --}}
{{-- ── Die Leiste trägt seit dem 2026-08-27 ZWEI Dinge ──────────────────────
     Links das Suchfeld, rechts den Anlege-Knopf — das ist Gitea's und GitHubs
     Filterleiste, und der Grund für den Umbau steht in `js/forgeAnlegen.ts`.

     Die Leiste steht deshalb jetzt auch dann, wenn es NICHTS zu durchsuchen
     gibt: ein Repository ohne Issues ist genau die Lage, in der „Neues Issue"
     am meisten zählt. Das Suchfeld trägt seine alte Bedingung jetzt selbst
     (`vorgaengeGesamt() > 0`), die Leiste die Oder-Verknüpfung — sonst stünde
     auf dem Patch-Reiter eines leeren Repositories eine leere Zeile mit 16 px
     Abstand darunter. --}}
<div x-show="['issues', 'pulls', 'patches'].includes(tab) && (vorgaengeGesamt() > 0 || anlegeZiel($store.viewport.desktop) === 'kopf')" x-cloak
     class="mb-4 flex items-center gap-2" data-forge-detail-suche>
    <div class="min-w-0 flex-1" x-show="vorgaengeGesamt() > 0">
        {{-- `aria-label` und nicht nur `placeholder` — ein Platzhalter ist kein
             zugänglicher Name und verschwindet beim Tippen. Name und Platzhalter
             folgen dem Reiter: „Issues durchsuchen" über einer PR-Liste wäre
             derselbe Fehler, den P7b auf der Übersicht gerade behebt. --}}
        <flux:input type="search" size="sm" icon="magnifying-glass"
                    class:input="[&::-webkit-search-cancel-button]:hidden"
                    x-ref="detailSucheFeld" x-model="suche"
                    autocomplete="off" autocorrect="off" spellcheck="false"
                    data-forge-detail-suche-feld
                    {{-- **`@js()` gehoert NICHT in ein Komponenten-Attribut.** Hier
                         stand `::placeholder="@js(__('Titel, Text, Label, Autor …'))"`,
                         und die Direktive wurde nie kompiliert: Blade wertet
                         Direktiven im Vorlagentext aus, die Attributwerte eines
                         Komponenten-Tags dagegen als Zeichenketten. Alpine bekam
                         woertlich `@js(...)` zu sehen und warf „Invalid or
                         unexpected token" — im Browser sichtbar, im Build und im
                         Typecheck lautlos.

                         Der Platzhalter ist ohnehin ueber alle drei Reiter derselbe,
                         also ein schlichtes Blade-Echo. Der NAME wechselt und bleibt
                         eine Alpine-Bindung — ein Ausdruck, keine Direktive. --}}
                    placeholder="{{ __('Titel, Text, Label, Autor …') }}"
                    ::aria-label="detailSucheName()" />
    </div>
    <flux:button size="sm" variant="ghost" icon="backspace" square class="icon-btn-touch shrink-0"
                 x-show="suche !== ''" x-cloak
                 x-on:click="suche = ''; $refs.detailSucheFeld?.focus()"
                 data-forge-detail-suche-leeren
                 aria-label="{{ __('Eingabe leeren') }}" />

    {{-- ══ DIE DESKTOP-FORM DES ANLEGE-KNOPFES ═══════════════════════════════
         `ms-auto`: ohne Suchfeld (leeres Repository) fällt die `flex-1`-Spur
         weg, und der Knopf stünde links. Mit Suchfeld ist die Klasse ein No-op.

         **Beschriftet und nicht nur bezeichnet.** Der FAB trägt sein „Neues
         Issue" im `aria-label`; hier steht es im Wort. Genau das war der
         Befund: das runde Plus unten rechts sieht niemand, weil es weder in
         der Leserichtung liegt noch sagt, was es tut. Der Name ist WÖRTLICH
         derselbe geblieben — sechs E2E-Fälle finden den Knopf über
         `getByRole('button', { name: 'Neues Issue' })`, und eine Sprachausgabe
         kennt ihn unter diesem Namen.

         `variant="primary"` und `size="sm"` sind Flux' Default-Wege; die Fläche
         ist `--color-accent` (brand-500) mit `--color-accent-foreground`
         (zinc-950) = 8,66:1, also weit über 4,5:1 (WCAG 1.4.3). Die KANTE des
         Knopfes misst gegen die Karte nur 2,20:1 — das ist hier zulässig, weil
         nicht die Fläche den Knopf identifiziert, sondern seine Beschriftung
         (WCAG 1.4.11 verlangt die 3:1 nur für Information, die zum Erkennen
         nötig IST). Beim FAB ist das anders, er trägt kein Wort; dessen Fläche
         misst deshalb 4,40:1 gegen den Grund und bleibt, wie sie ist.

         ── Gesperrt heisst inert, nicht abwesend ──────────────────────────────
         Bis heute verschwand der Knopf ohne Schreibrecht ganz. Das nahm dem
         Leser die Auskunft, dass hier überhaupt etwas anzulegen ist. Jetzt
         bleibt er stehen, trägt `aria-disabled` (Haus-Muster, siehe
         `⚡article.blade.php:119-126`) und verweist per `aria-describedby` auf
         den Satz, der den Grund nennt. `disabled` wäre falsch: ein solcher
         Knopf ist nicht fokussierbar und könnte seinen eigenen Hinweis nicht
         mehr ansagen.

         Der eigentliche Riegel liegt nicht hier, sondern in `toggleIssueDraft()`
         — `aria-disabled` ist eine Ansage, keine Sperre.

         `::attr` und nicht `:attr`: das ist ein Flux-KOMPONENTEN-Tag, Blade
         escapt den doppelten Doppelpunkt zu einem einfachen. Auf rohem HTML
         (dem FAB) steht deshalb dort `x-bind:` ausgeschrieben. --}}
    <template x-if="anlegeZiel($store.viewport.desktop) === 'kopf'">
        <flux:button size="sm" variant="primary" icon="plus" class="text-btn-touch ms-auto shrink-0"
                     data-forge-anlegen data-forge-anlegen-kopf
                     x-on:click="toggleIssueDraft()"
                     aria-haspopup="dialog"
                     ::aria-expanded="issueDraft.open ? 'true' : 'false'"
                     ::aria-disabled="canWrite() ? null : 'true'"
                     ::aria-describedby="canWrite() ? null : 'forge-schreibhinweis'">{{ __('Neues Issue') }}</flux:button>
    </template>
</div>

{{-- „:count von :total" und nicht „:count Treffer": die Gesamtzahl bleibt im
     Bild, damit niemand die gefilterte Liste für den Bestand des Repositories
     hält. --}}
<p x-show="['issues', 'pulls', 'patches'].includes(tab) && suche.trim() !== '' && vorgaengeGesamt() > 0" x-cloak
   role="status" class="mb-2 px-1 text-xs text-muted" data-forge-detail-suche-zahl
   x-text="detailSucheZahl().split(':count').join($num(vorgaengeSichtbar())).split(':total').join($num(vorgaengeGesamt()))"></p>

{{-- Null Treffer ist eine eigene Aussage. Ohne sie stünde hier der generische
     Leerzustand („Noch keine Issues.") und behauptete etwas über das
     Repository, was nur über die Suche gilt. --}}
<template x-if="['issues', 'pulls', 'patches'].includes(tab) && suche.trim() !== '' && vorgaengeGesamt() > 0 && vorgaengeSichtbar() === 0">
    <div class="surface-card empty-state px-6 py-10 text-center" data-forge-detail-suche-leer>
        <span class="mx-auto flex size-12 items-center justify-center rounded-tile bg-zinc-100 dark:bg-zinc-800">
            <flux:icon.magnifying-glass class="size-6 text-zinc-500 dark:text-zinc-400" />
        </span>
        <flux:heading size="lg" class="mt-4" x-text="detailSucheLeer()"></flux:heading>
        <flux:text class="mx-auto mt-1 max-w-sm text-sm text-muted">{{ __('Gesucht wird über Titel, Rumpftext, Labels, Verfasser und die Beteiligten, auf die gewartet wird — als npub oder als Hex.') }}</flux:text>
        <flux:button size="sm" variant="ghost" class="mt-4" x-on:click="suche = ''">{{ __('Suche zurücksetzen') }}</flux:button>
    </div>
</template>
