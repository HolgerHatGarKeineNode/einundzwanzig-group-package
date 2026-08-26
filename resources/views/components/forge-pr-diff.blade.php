@props([
    /**
     * Alpine-Ausdruck, der die PR-Zeile liefert — im Regelfall schlicht `pr`.
     *
     * Ein Ausdruck und kein Wert: die Zeile steht erst zur Laufzeit fest, und
     * die Insel-Methoden (`prDiffVon`, `prDiffLaden`) nehmen sie entgegen.
     */
    'vorgang',
])

{{-- ── „Files changed" für einen Pull Request (P7b) ───────────────────────────

     **Ein PR ohne Dateiliste ist kein PR** — und genau die fehlte hier bis zu
     dieser Phase. Der Grund ist keine Nachlässigkeit, sondern das Ereignis: ein
     kind 1618 trägt seinen Diff NICHT bei sich. Es nennt zwei Commit-Ids
     (`merge-base` und `c`) und mindestens eine `clone`-URL, „where the tip
     commit can be fetched" (NIP-34). Was dazwischen liegt, weiß nur Git. Ein
     Patch (1617) ist der einfachere Fall: dort steht der Unified Diff im
     `content`, und die Anzeige kostet kein Byte Netz.

     ── Die Ansage steht VOR dem Download ───────────────────────────────────────

     Derselbe Weg wie beim README, und aus demselben gemessenen Grund: der
     Git-Endpunkt kann kein `filter=blob:none` (2026-08-24 gegen den echten
     Endpunkt: „filtering not recognized by server, ignoring"). Historie ist
     deshalb teuer — am selben Repository kostete 1 Commit 1,1 MB und zehn
     Commits 13 MB von 14 MB gesamt. Ein Reiter, der das stillschweigend
     nachlädt, gibt das Datenvolumen des Nutzers aus, ohne ihn zu fragen.
     Deshalb startet hier NICHTS von selbst.

     ── Warum das eine Komponente ist und nicht Markup in der View ──────────────

     Zwei Gründe, und der zweite ist unangenehm:

     1. Die Dateiliste ist dieselbe Bauform wie beim Patch — sie gehört einmal
        beschrieben.
     2. **Der Patch-Zweig in `⚡forge-repo.blade.php` benutzt sie trotzdem noch
        nicht.** `EmptyStatesAndA11yTest` zählt ARIA-Träger, die es im QUELLTEXT
        der View findet; wandert das Diff-Markup von dort hierher, sinkt die
        gezählte Zahl um zwei (`aria-hidden` an den zwei Zeilennummern) und der
        Test wird rot — an einer Datei, die in dieser Phase einem anderen Autor
        gehört. Die Zusammenführung ist damit fällig, aber nur GEMEINSAM mit dem
        Nachziehen jener Kalibrierung. Bis dahin steht in der View ein Verweis
        auf diese Datei.

     Derselbe blinde Fleck wirkt hier in die andere Richtung: die ARIA-Träger
     dieser Komponente sieht der Quelltext-Scanner nicht. Das ist kein Vorteil,
     den man ausnutzen sollte, sondern eine Messlücke, die im Plan steht. --}}
<section class="mt-4" data-forge-pr-diff
         :data-lage="prDiffVon({{ $vorgang }}).lage"
         :data-quelle="prDiffVon({{ $vorgang }}).quelle.art">
    {{-- Die Überschrift steht über ALLEN Lagen: sonst springt sie beim
         Zustandswechsel weg. Kein `flux:heading` — ohne `level` rendert die
         Komponente ein `<div>` ohne Überschriften-Semantik (P5, mit Rechnung). --}}
    <h4 class="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">{{ __('Geänderte Dateien') }}</h4>

    {{-- 1. Keine Adresse, die ein Browser abrufen kann. Kein Fehler, sondern
            eine Eigenschaft des Vorschlags. --}}
    <template x-if="prDiffVon({{ $vorgang }}).quelle.art === 'keine-quelle'">
        <p class="forge-mass text-sm text-muted" data-forge-pr-diff-hinweis>{{ __('Dieser Vorschlag nennt keine Adresse, aus der sich sein Stand holen liesse — es gibt nur Zugänge wie ssh oder git.') }}</p>
    </template>

    {{-- 2. **Der Fremdhost-Fall.** NIP-34 lässt ausdrücklich zu, dass der Tip in
            einem Fork auf einem fremden Host liegt; unser NIP-98-Token gilt dort
            nicht, und ob der fremde Host CORS öffnet, weiß vorher niemand.

            Das ist eine RUHIGE AUSKUNFT MIT LINK, kein Fehlerbild: `text-muted`
            wie beim README-Zwilling, kein `flux:callout variant="danger"`, kein
            Warnzeichen. Wer hier ein Fehlerbild zeigte, erklärte eine erlaubte
            Bauform des Protokolls zum Defekt dieses Clients. --}}
    <template x-if="prDiffVon({{ $vorgang }}).quelle.art === 'fremd'">
        <p class="forge-mass text-sm text-muted" data-forge-pr-diff-fremd>
            <span x-text="@js(__('Der vorgeschlagene Stand liegt auf einem fremden Git-Host (:host). Von hier lässt er sich nicht holen — der signierte Zugang gilt nur für das eigene Relay.'))
                .split(':host').join(prDiffVon({{ $vorgang }}).quelle.host)"></span>
            <template x-if="prDiffVon({{ $vorgang }}).quelle.link">
                <a :href="prDiffVon({{ $vorgang }}).quelle.link" target="_blank" rel="noopener noreferrer"
                   class="ms-1 underline" data-forge-pr-diff-fremd-link
                   x-text="@js(__('Dort öffnen'))"></a>
            </template>
        </p>
    </template>

    {{-- 3. Die zwei Punkte fehlen, zwischen denen zu rechnen wäre. Drei
            getrennte Sätze, weil es drei verschiedene Lücken sind — ein
            gemeinsamer Satz wäre die Sorte Begründung, nach der man erst recht
            fragt. --}}
    <template x-if="prDiffVon({{ $vorgang }}).quelle.art === 'unvollstaendig'">
        <p class="forge-mass text-sm text-muted" data-forge-pr-diff-hinweis
           x-text="prDiffVon({{ $vorgang }}).quelle.fehlt === 'merge-base'
               ? @js(__('Dieser Vorschlag nennt keinen Vergleichspunkt (merge-base) — ohne ihn gibt es keine zwei Stände, zwischen denen sich rechnen liesse.'))
               : (prDiffVon({{ $vorgang }}).quelle.fehlt === 'commit'
                   ? @js(__('Dieser Vorschlag nennt keinen Commit — ohne ihn ist der vorgeschlagene Stand unbekannt.'))
                   : @js(__('Dieser Vorschlag nennt weder Commit noch Vergleichspunkt — die Dateiliste lässt sich daraus nicht bilden.')))"></p>
    </template>

    {{-- 4. **Die ANSAGE vor dem Download.**
            Was hier NICHT steht, ist eine Zahl für DIESEN Vorschlag: die kennt
            vorher niemand, und der Server nennt sie nicht. Stattdessen die
            gemessene Größenordnung, ausdrücklich als Messung gekennzeichnet —
            dieselbe Regel wie beim README. --}}
    <template x-if="prDiffVon({{ $vorgang }}).quelle.art === 'ladbar' && prDiffVon({{ $vorgang }}).lage === 'quelle'">
        <div class="surface-card p-4" data-forge-pr-diff-ansage>
            <p class="forge-mass text-sm">{{ __('Die Dateiliste steht nicht im Nostr-Ereignis. Um sie zu zeigen, holt dieser Client den vorgeschlagenen Stand und seinen Vergleichspunkt aus dem Git-Endpunkt.') }}</p>
            <p class="forge-mass mt-1 text-xs text-muted">{{ __('Das sind je nach Repository mehrere Megabyte — gemessen kostete 1 Commit 1,1 MB und zehn Commits 13 MB, weil der Endpunkt keine Teilübertragung kann. Im Mobilfunknetz zählt das auf dein Datenvolumen.') }}</p>
            <div class="mt-4 flex flex-wrap items-center gap-2">
                <flux:button size="sm" variant="primary" icon="arrow-down-tray"
                             data-forge-pr-diff-start
                             x-on:click="prDiffLaden({{ $vorgang }})">{{ __('Dateiliste laden') }}</flux:button>
            </div>
        </div>
    </template>

    {{-- 5. Läuft. Abbrechbar, und der Abbruch ist echt: das Signal geht über
            `fetchOptions` in den laufenden `fetch`.

            Der Balken erscheint NUR, wenn ein Anteil berechenbar ist — `total`
            ist bei mehreren Phasen 0, und ein Balken daraus behauptete
            Stillstand, wo Arbeit läuft. --}}
    <template x-if="prDiffVon({{ $vorgang }}).lage === 'laedt'">
        <div class="surface-card p-4" data-forge-pr-diff-laeuft>
            <p class="text-sm" role="status" aria-live="polite" data-forge-pr-diff-phase
               x-text="prDiffVon({{ $vorgang }}).fortschritt && prDiffVon({{ $vorgang }}).fortschritt.phase
                   ? prDiffVon({{ $vorgang }}).fortschritt.phase
                   : @js(__('Wird geladen …'))"></p>
            <template x-if="prDiffVon({{ $vorgang }}).fortschritt && prDiffVon({{ $vorgang }}).fortschritt.anteil !== null">
                <div class="mt-2">
                    {{-- Der Wert geht ueber die EIGENSCHAFT, nicht ueber das
                         Attribut: `ui-progress` liest `value` beim Booten einmal
                         aus dem Attribut und beobachtet danach nur noch `max`.
                         Ein `x-bind:value` schriebe also genau einmal. Dieselbe
                         Herleitung wie am README-Balken. --}}
                    <flux:progress class="mt-0"
                                   x-effect="$el.value = Math.round(prDiffVon({{ $vorgang }}).fortschritt.anteil * 100)"
                                   aria-label="{{ __('Fortschritt des Downloads') }}" />
                    <p class="mt-1 text-xs text-muted" data-forge-pr-diff-zahl
                       x-text="$num(prDiffVon({{ $vorgang }}).fortschritt.geladen) + ' / ' + $num(prDiffVon({{ $vorgang }}).fortschritt.gesamt)"></p>
                </div>
            </template>
            <div class="mt-4">
                <flux:button size="sm" variant="ghost" icon="x-mark"
                             data-forge-pr-diff-abbruch
                             x-on:click="prDiffAbbrechen({{ $vorgang }})">{{ __('Abbrechen') }}</flux:button>
            </div>
        </div>
    </template>

    {{-- 6. Gescheitert. Zwei der Codes sind gar keine Fehler des Clients
            (`spitze-fehlt`, `basis-fehlt`) — der Satz dazu steht in
            `prDiffFehlerText()` und sagt, WAS ist, statt zu behaupten, etwas sei
            kaputt. --}}
    <template x-if="prDiffVon({{ $vorgang }}).lage === 'fehler'">
        <flux:callout variant="secondary" icon="information-circle" class="forge-mass" data-forge-pr-diff-fehler>
            <flux:callout.text x-text="prDiffFehlerText({{ $vorgang }})"></flux:callout.text>
            <x-slot name="actions">
                <flux:button size="sm" variant="ghost" icon="arrow-path"
                             x-on:click="prDiffLaden({{ $vorgang }})">{{ __('Erneut versuchen') }}</flux:button>
            </x-slot>
        </flux:callout>
    </template>

    {{-- 7. Da. --}}
    <template x-if="prDiffVon({{ $vorgang }}).lage === 'da'">
        <div>
            {{-- Die Kopfzeile: wie viele Dateien, wie viele Zeilen. Dieselbe
                 Bauform wie an der Patch-Zeile (P1) — das Vorzeichen steht als
                 ZEICHEN im Text und nicht nur in der Farbe (WCAG 1.4.1). --}}
            <p class="mb-2 inline-flex flex-wrap items-center gap-1.5 text-xs text-muted" data-forge-pr-diff-stat>
                <span x-text="$plural(prDiffVon({{ $vorgang }}).stat.files, '1 Datei', ':count Dateien')"></span>
                <flux:badge size="sm" color="green" data-forge-pr-diff-plus x-text="'+' + prDiffVon({{ $vorgang }}).stat.additions" />
                <flux:badge size="sm" color="red" data-forge-pr-diff-minus x-text="'−' + prDiffVon({{ $vorgang }}).stat.deletions" />
            </p>

            {{-- Kein Unterschied ist eine eigene Aussage, kein leerer Kasten. --}}
            <template x-if="prDiffVon({{ $vorgang }}).diff.files.length === 0">
                <p class="forge-mass text-sm text-muted" data-forge-pr-diff-leer>{{ __('Keine Datei unterscheidet die beiden Stände.') }}</p>
            </template>

            {{-- Gekürzt wird SICHTBAR. Eine stillschweigend gekürzte Anzeige wäre
                 eine falsche Aussage über den Vorschlag — dieselbe Regel wie beim
                 Patch. --}}
            <template x-if="prDiffVon({{ $vorgang }}).diff.truncated">
                <flux:callout variant="secondary" icon="information-circle" class="forge-mass mb-2" data-forge-pr-diff-gekuerzt>
                    <flux:callout.text>{{ __('Dieser Vergleich ist zu lang für die vollständige Anzeige — es werden nicht alle Zeilen gezeigt.') }}</flux:callout.text>
                </flux:callout>
            </template>

            <template x-if="prDiffVon({{ $vorgang }}).diff.files.length > 0">
                <div class="forge-diff" data-forge-diff>
                    <template x-for="datei in prDiffVon({{ $vorgang }}).diff.files" :key="datei.path + datei.change">
                        <div class="forge-diff-datei" data-forge-diff-datei :data-change="datei.change">
                            <div class="forge-diff-kopf">
                                {{-- Das Wort steht neben dem Pfad, nicht nur als Farbe
                                     oder Symbol. --}}
                                <span class="forge-diff-art"
                                      x-text="datei.change === 'add' ? @js(__('hinzugefügt'))
                                          : (datei.change === 'del' ? @js(__('gelöscht'))
                                          : (datei.change === 'ren' ? @js(__('umbenannt')) : @js(__('geändert'))))"></span>
                                <span class="forge-diff-pfad" x-text="datei.path"></span>
                                <span class="forge-diff-zahlen">
                                    <flux:badge size="sm" color="green" data-forge-diff-plus x-text="'+' + datei.additions" />
                                    <flux:badge size="sm" color="red" data-forge-diff-minus x-text="'−' + datei.deletions" />
                                </span>
                            </div>
                            <template x-if="datei.binary">
                                <p class="forge-diff-binaer" data-forge-diff-binaer>{{ __('Binärdatei — der Inhalt lässt sich nicht als Text zeigen.') }}</p>
                            </template>
                            {{-- Der grob degradierte Vergleich sagt es an. Die Zahlen
                                 stimmen dann noch, die Zuordnung ist gröber — das zu
                                 verschweigen hiesse, eine ungenaue Anzeige als genaue
                                 auszugeben. --}}
                            <template x-if="datei.grob">
                                <p class="forge-diff-binaer" data-forge-diff-grob>{{ __('Diese Datei war zu gross für einen zeilengenauen Vergleich — sie steht hier vollständig als ersetzt.') }}</p>
                            </template>
                            <template x-if="!datei.binary">
                                <div class="forge-diff-koerper">
                                    <template x-for="(zeile, i) in datei.lines" :key="i">
                                        <div class="forge-diff-zeile" :data-kind="zeile.kind">
                                            {{-- Zeilennummern sind Orientierung fürs Auge
                                                 und werden nicht vorgelesen — sonst läse
                                                 ein Screenreader vor jeder Codezeile zwei
                                                 Zahlen. --}}
                                            <span class="forge-diff-nr" aria-hidden="true" x-text="zeile.oldNo || ''"></span>
                                            <span class="forge-diff-nr" aria-hidden="true" x-text="zeile.newNo || ''"></span>
                                            {{-- Das Vorzeichen IM Text, nicht nur in der
                                                 Farbe (WCAG 1.4.1). --}}
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
        </div>
    </template>
</section>
