{{-- ── Segment-Umschalter der linken Spur (P3, überarbeitet P4-Nacharbeit) ──
     `Repositories | Issues | Pull Requests` — er FILTERT eine Liste, er
     wechselt keine Fläche: die Aktivitätsspur daneben bleibt stehen.

     **Eine Button-Gruppe und ausdrücklich KEIN `role="tablist"`.** Zwei Gründe,
     und der zweite gibt den Ausschlag:
       · Fachlich: ein Tablist verspricht „hier wechselt der Inhalt der Fläche".
         Hier bleibt die halbe Fläche stehen.
       · Gemessen: `desktop-forge.spec.ts:397-411` hält
         `getByRole('tab')).toHaveCount(0)` auf Desktop als stehende Zusage fest.
         Eine Gruppe hält sie grün ohne Anpassung; ein Tablist kehrte die
         Aussage still um und verlangte zusätzlich Pfeiltasten-Navigation.
     (Hier stand bis zur P4-Nacharbeit „ausdrücklich KEIN `role="group"`" —
     während das Markup darunter eines trug. Gemeint war immer `tablist`; die
     Gruppe ist gewollt, sie gibt den drei Links einen gemeinsamen Namen.)

     Er steht EINMAL, über den drei Listen — nicht dreimal, je einmal in jeder.
     Bis zur P4-Nacharbeit war er in alle drei Regionen eingebunden: drei Kopien
     im DOM, eine davon sichtbar. Für die Sprachausgabe war das harmlos (zwei
     sind `display: none`), für jeden Prüfstand nicht — `[data-forge-liste=…]`
     löste auf drei Elemente auf und riss jeden Zugriff in Playwrights
     Strict-Mode. Genau da bin ich beim Nachmessen selbst hineingelaufen.

     Nur in der zweispaltigen Form: unterhalb davon führt die Tab-Reihe, und die
     Bestandskacheln darüber sind der Weg in die beiden Listen. Zwei Umschalter
     für dieselbe Frage auf einem Schirm wären eine doppelte Wahrheit. --}}
<div x-show="zweispaltig" x-cloak class="mb-3 flex flex-wrap gap-1" role="group"
     aria-label="{{ __('Welche Liste?') }}" data-forge-listen-umschalter>
    @php($segmente = [
        ['wert' => 'repos', 'label' => __('Repositories')],
        ['wert' => 'issues', 'label' => __('Issues')],
        ['wert' => 'pulls', 'label' => __('Pull Requests')],
    ])
    @foreach ($segmente as $segment)
        {{-- Ein `a` und kein `button`: das Ziel ist eine echte, teilbare Adresse
             (`/forge?tab=issues`). Mittelklick und „Link kopieren" tun damit das,
             was jeder erwartet; der Klick selbst bleibt in der Insel und lädt
             nichts nach.

             ── `aria-current`, NICHT `aria-pressed` (P4-Nacharbeit) ──────────
             Hier stand `::aria-pressed`, und das war gleich zweimal falsch:

             1. **Die Schreibweise.** Der doppelte Doppelpunkt ist die Konvention
                für Blade-KOMPONENTEN (`<flux:…>`), wo Blade ihn zu einem
                einfachen escapt. Auf rohem HTML gibt Blade ihn wörtlich aus,
                Alpine liest ihn als Bindung für ein Attribut namens
                `:aria-pressed` und schreibt genau das. Am gebauten Stand
                gemessen: `getAttributeNames()` liefert `::aria-pressed` UND
                `:aria-pressed`, `getAttribute('aria-pressed')` liefert `null`.
                Das Attribut war also nie da.

             2. **Das Attribut selbst.** `aria-pressed` ist laut W3C
                (`html-aria`, geprüft 2026-08-24 an der Quelle) auf einem `a`
                mit `href` NICHT zulässig — es gilt nur für `role="button"`.
                Bloß die Schreibweise zu reparieren hätte ein syntaktisch
                gültiges Attribut erzeugt, das die Sprachausgabe trotzdem
                ignoriert: ein Fix, der nichts behebt. `aria-current` ist ein
                GLOBALES Attribut und auf jedem Element zulässig — und es ist
                hier auch fachlich richtiger, als der alte Kommentar behauptete:
                der aktive Eintrag IST der aktuelle Ort, die Adresse wechselt
                sichtbar auf `?tab=…` mit.

             `false` statt `'false'`: Alpine ENTFERNT ein Attribut bei einem
             booleschen Falsch. `aria-current="false"` an zwei von drei Links
             wäre Lärm; das Attribut steht genau am aktuellen.

             ── Der Zustand hängt nicht mehr an der Farbe (WCAG 1.4.1) ────────
             Vorher unterschieden sich aktiv und inaktiv NUR durch vertauschte
             Vorder- und Hintergrundfarbe. Jetzt trägt ihn eine FORM: die Marke
             links ist gefüllt oder hohl. Sie zeichnet sich aus `currentColor`,
             hat also immer den Kontrast des Textes daneben und kommt ohne eine
             einzige neue Farbe aus. Dazu das Schriftgewicht (700 gegen 600).
             Beide Marken sind gleich breit — beim Umschalten rückt nichts.

             ── 44 px hoch ───────────────────────────────────────────────────
             WCAG 2.5.8 verlangt 24 × 24; die Zeile maß vorher gemessene 24 px
             und lag damit exakt auf der Grenze. Apples HIG verlangt 44 × 44,
             und das kostet hier nichts: der Umschalter ist EINE Zeile über
             einer Liste, keine dichte Tabelle. `text-sm` (14 px, Zeilenhöhe
             20 px) plus `py-3` (2 × 12 px) ergibt genau 44. --}}
        <a :href="forgeTabHref('{{ $segment['wert'] }}')"
           x-on:click.prevent="zeigeListe('{{ $segment['wert'] }}')"
           data-forge-liste="{{ $segment['wert'] }}"
           x-bind:aria-current="listeAktiv() === '{{ $segment['wert'] }}' ? 'true' : false"
           class="pressable inline-flex items-center gap-2 rounded-pill px-3 py-3 text-sm transition"
           :class="listeAktiv() === '{{ $segment['wert'] }}'
               ? 'bg-zinc-900 font-bold text-white dark:bg-zinc-100 dark:text-zinc-900'
               : 'bg-zinc-100 font-semibold text-muted hover:text-zinc-900 dark:bg-zinc-800 dark:hover:text-zinc-100'">
            {{-- Die Marke ist Zierrat für die Sprachausgabe — sie hört
                 `aria-current`. Für das Auge ist sie der Zustandsträger. --}}
            <span aria-hidden="true" class="size-2 shrink-0 rounded-full border border-current"
                  :class="listeAktiv() === '{{ $segment['wert'] }}' ? 'bg-current' : ''"></span>
            <span>{{ $segment['label'] }}</span>
        </a>
    @endforeach
</div>
