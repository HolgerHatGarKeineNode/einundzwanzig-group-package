{{-- ── Segment-Umschalter der linken Spur (P3 · P4-Nacharbeit · Flux-Angleich) ──
     `Repositories | Issues | Pull Requests` — er FILTERT eine Liste, er
     wechselt keine Fläche: die Aktivitätsspur daneben bleibt stehen.

     ── Bis zum Flux-Angleich stand hier HANDARBEIT, und die Begründung dafür
        war zu eng gedacht ────────────────────────────────────────────────────
     Der alte Kommentar argumentierte: ein `role="tablist"` kehrte
     `desktop-forge.spec.ts:397-411` (`getByRole('tab')).toHaveCount(0)`) still
     um, also drei handgebaute `<a>`-Pillen. Richtig war nur die Hälfte — die
     Zusage gilt weiter, aber sie verlangt keine Handarbeit: `flux:radio.group
     variant="segmented"` rendert `<ui-radio-group>` / `<ui-radio>`, und die
     bekommen zur Laufzeit `role="radiogroup"` bzw. `role="radio"`. Am Bundle
     nachgelesen, nicht vermutet: `vendor/livewire/flux-pro/dist/flux.js:15920`
     (`setAttribute(this, "role", "radiogroup")`) und `:15953`
     (`"role", "radio"`). `role="tab"` setzt dort einzig `UITabs` (`:16127`,
     `:16170`) — eine andere Klasse, ein anderes Element.

     Im SERVER-HTML steht ohnehin gar keine Rolle (beide setzt erst das Skript),
     womit auch `ForgeVorgangAdresseTest.php:99` grün bleibt: das prüft die
     Quelle auf `role="tab"`, und die trägt keines.

     Und die Rolle ist fachlich die richtigere: „genau eines aus drei" IST eine
     Radiogruppe. Sie bringt die Pfeiltasten-Navigation von sich aus mit
     (`flux.js:15909-15918`) — vorher waren es drei einzelne Tab-Stopps.

     ── Was der Tausch KOSTET, und wie es aufgefangen ist ────────────────────
     `<a href>` fällt weg: Mittelklick und „Link kopieren" gehen an DIESEN drei
     Bedienelementen verloren. Die drei Adressen bleiben trotzdem auf demselben
     Schirm teilbar — die Bestandskacheln darüber
     (`⚡forge.blade.php`, `data-forge-kachel`) führen als echte `<a href>` auf
     dieselben drei Ziele `?tab=repos|issues|pulls`, eins zu eins.

     Zweitens: Flux markiert den gewählten Reiter allein über Fläche und
     Textfarbe. Im dunklen Modus misst der Daumen (`bg-white/20`) gegen die
     Schiene (`bg-white/10`) gerechnete 1,91:1 und liegt damit unter den 3:1 aus
     WCAG 1.4.11 für einen Zustand. Deshalb bleibt die MARKE aus der
     P4-Nacharbeit erhalten — gefüllt oder hohl, gezeichnet aus `currentColor`,
     also ohne eine einzige neue Farbe. Sie hängt jetzt an Flux' eigenem
     Zustands-Attribut (`ui-radio[data-checked]`) statt an einem
     Alpine-Ausdruck; genau dieses Selektormuster benutzt Flux im
     Segment-Stub selbst (`flux/radio/variants/segmented.blade.php`).

     ── Warum `h-13!` und nicht Flux' Vorgabe ────────────────────────────────
     Flux' Segment-Schiene ist `h-10` (40 px) bei `p-1`, das Segment darin also
     32 px hoch; mit `size="sm"` sind es 32 / 24 px. WCAG 2.5.8 wäre damit
     erfüllt (24 × 24), Apples HIG (44 × 44) nicht. `h-13` = 3,25 rem = 52 px
     minus 2 × 4 px Schienenpolster ergibt exakt 44 px am Segment — der Wert,
     den die Handarbeit vorher hatte (`text-sm` + `py-3` = 20 + 24). Das `!`
     ist nötig, weil `h-10` aus demselben Utility-Layer kommt: bei gleicher
     Spezifität entschiede sonst die Quellreihenfolge im GEBAUTEN Stylesheet,
     und die ist kein Ort für eine Zusage.

     ── Der Zustand kommt aus `listeAktiv()`, nicht aus `tab` ────────────────
     `x-model="tab"` wäre falsch: `tab` trägt auch `activity`, `workspaces`,
     `patches` und `code`, und bei keinem davon wäre ein Segment markiert —
     obwohl die Repo-Liste darunter steht. `listeAktiv()` bildet genau das ab,
     ist aber eine Methode und damit für `x-model` nicht zuweisbar. Deshalb
     zwei Richtungen von Hand:

       · hinein: `x-effect` schreibt auf die `value`-EIGENSCHAFT von
         `ui-radio-group` (`flux.js:2124` definiert sie per
         `Object.defineProperty`). Ein Attribut täte hier nichts.
       · heraus: `x-on:change`. Der Setter und der Melder sind bei Flux
         gegeneinander verriegelt (`detangle()`, `flux.js`), ein
         programmatisches Setzen meldet also gar nichts. Der Vergleich gegen
         `listeAktiv()` steht trotzdem da — er kostet nichts und fängt zugleich
         den Klick auf das bereits gewählte Segment ab, der sonst den Fokus
         grundlos in die Überschrift risse.

     `zeigeListe()` bleibt unverändert der einzige Weg, der `tab` setzt und den
     Fokus in die Regionsüberschrift trägt (`desktop-forge-feinschliff.spec.ts`
     prüft beides über `[data-forge-liste="repos"]`).

     Er steht EINMAL, über den drei Listen — nicht dreimal, je einmal in jeder.
     Nur in der zweispaltigen Form: unterhalb davon führt die Tab-Reihe, und die
     Bestandskacheln darüber sind der Weg in die beiden Listen. --}}
<div x-show="zweispaltig" x-cloak class="mb-3" data-forge-listen-umschalter>
    @php($segmente = [
        ['wert' => 'repos', 'label' => __('Repositories')],
        ['wert' => 'issues', 'label' => __('Issues')],
        ['wert' => 'pulls', 'label' => __('Pull Requests')],
    ])
    <flux:radio.group variant="segmented" class="h-13!"
                      aria-label="{{ __('Welche Liste?') }}"
                      x-effect="$el.value = listeAktiv()"
                      x-on:change="$event.target.value !== listeAktiv() && zeigeListe($event.target.value)">
        @foreach ($segmente as $segment)
            <flux:radio value="{{ $segment['wert'] }}" data-forge-liste="{{ $segment['wert'] }}">
                {{-- Die Marke ist Zierrat für die Sprachausgabe — sie hört
                     `aria-checked`, das `UIRadio` selbst pflegt. Für das Auge ist
                     sie der Zustandsträger, der nicht an der Farbe hängt. --}}
                <span aria-hidden="true"
                      class="size-2 shrink-0 rounded-full border border-current [ui-radio[data-checked]_&]:bg-current"></span>
                <span>{{ $segment['label'] }}</span>
            </flux:radio>
        @endforeach
    </flux:radio.group>
</div>
