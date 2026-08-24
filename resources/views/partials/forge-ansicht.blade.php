{{-- ── Reihenfolge und Ausschnitt (P6, Schritt 23) ──────────────────────────
     Zwei Auswahlen und eine Zahl. Sie stehen EINMAL, über den drei Listen —
     dieselbe Stelle und derselbe Grund wie beim Segment-Umschalter darüber
     (drei Kopien im DOM waren in P3 der Fehler, den die Nacharbeit geschlossen
     hat).

     ── Der Rang ────────────────────────────────────────────────────────────
     Diese Zeile ist TERTIÄR: primär ist, welche Liste man sieht (der Umschalter
     bzw. die Reiter), sekundär die Liste selbst. Deshalb keine zweite Reihe
     44-px-Pillen — die sähe aus wie ein zweiter Umschalter und stellte die
     Frage „welches von beidem führt hier eigentlich?". Zwei kompakte native
     Auswahlen, in der Zeilenhöhe der Beschriftungen ringsum.

     ── Keine sichtbaren Beschriftungen, und warum das hier trägt ────────────
     Die gewählte Option beschreibt sich selbst („Zuletzt aktiv", „Mir
     zugewiesen"), eine Beschriftung davor wiederholte sie nur. Für die
     Sprachausgabe steht sie als `aria-label` — dieselbe Bauform wie die
     Sprachauswahl in den Einstellungen, und `flux:select` rendert dort wie hier
     ein natives `<select>` (im WebView öffnet damit der System-Picker).

     **Kein WCAG-3.2.2-Fall.** Firefox feuert `change` schon beim Durchpfeilen
     mit den Pfeiltasten — beim Sprachwechsel war das der Grund für einen
     eigenen Übernehmen-Knopf, weil dort ein Seitenneuladen folgte. Hier ändert
     sich nur die Reihenfolge einer Liste auf derselben Seite: kein
     Kontextwechsel, kein Fokusverlust, keine neue Adresse. Ein Knopf dazwischen
     wäre hier die schlechtere Wahl.

     ── Der Ausschnitt erscheint nur mit Schlüssel ───────────────────────────
     Ohne angemeldeten Nutzer gibt es kein „mir". Die Auswahl fehlt dann ganz,
     statt zwei Optionen anzubieten, die per Konstruktion nichts tun. --}}
<div class="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2" data-forge-ansicht>
    <flux:select size="sm" class="w-auto" x-model="sortierung"
                 data-forge-sortierung aria-label="{{ __('Reihenfolge der Liste') }}">
        <flux:select.option value="aktiv">{{ __('Zuletzt aktiv') }}</flux:select.option>
        <flux:select.option value="alt">{{ __('Älteste zuerst') }}</flux:select.option>
        <flux:select.option value="name">{{ __('Nach Name') }}</flux:select.option>
    </flux:select>

    {{-- `x-if` und nicht `x-show`: eine per `display:none` versteckte Auswahl
         bliebe im Formular- und im Zugänglichkeitsbaum stehen. Der Schlüssel
         trifft nach dem Mount ein (localStorage-Rehydrierung), die Auswahl
         erscheint dann. --}}
    <template x-if="kannScope()">
        <flux:select size="sm" class="w-auto" x-model="scope"
                     data-forge-scope aria-label="{{ __('Welche Vorgänge?') }}">
            <flux:select.option value="alle">{{ __('Alle Vorgänge') }}</flux:select.option>
            <flux:select.option value="von-mir">{{ __('Von mir') }}</flux:select.option>
            <flux:select.option value="zugewiesen">{{ __('Mir zugewiesen') }}</flux:select.option>
        </flux:select>
    </template>

    {{-- ── „12 von 47" ─────────────────────────────────────────────────────
         Ohne diese Zahl ist eine gefilterte Liste von einem leeren Workspace
         nicht zu unterscheiden — und genau das ist der teuerste Zustand einer
         Filterfläche.

         Das Element steht IMMER im DOM und ist nur leer, wenn nichts gefiltert
         ist. Eine `aria-live`-Region, die erst mit ihrem Text entsteht, meldet
         in mehreren Screenreadern gar nichts; sie muss vorher da sein, damit
         die Änderung eine Änderung IST. Und ohne aktiven Filter steht dort
         nichts: „47 von 47" ist keine Auskunft, sondern Lärm. --}}
    <span class="text-[0.7rem] font-semibold uppercase tracking-wider text-muted"
          role="status" aria-live="polite" data-forge-trefferzahl
          x-text="(suche.trim() !== '' || scope !== 'alle') && sichtbareAnzahl() !== gesamtAnzahl()
              ? @js(__(':n von :gesamt')).replace(':n', $num(sichtbareAnzahl())).replace(':gesamt', $num(gesamtAnzahl()))
              : ''"></span>
</div>
