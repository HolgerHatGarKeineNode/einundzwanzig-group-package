{{-- ── Segment-Umschalter der linken Spur (P3) ─────────────────────────────
     `Repositories | Issues | Pull Requests` — er FILTERT eine Liste, er
     wechselt keine Fläche: die Aktivitätsspur daneben bleibt stehen.

     **Eine Button-Gruppe und ausdrücklich KEIN `role="group"`.** Zwei Gründe,
     und der zweite gibt den Ausschlag:
       · Fachlich: ein Tablist verspricht „hier wechselt der Inhalt der Fläche".
         Hier bleibt die halbe Fläche stehen.
       · Gemessen: `desktop-forge.spec.ts:397-411` hält
         `getByRole('tab')).toHaveCount(0)` auf Desktop als stehende Zusage fest.
         Eine Button-Gruppe hält sie grün ohne Anpassung; ein Tablist kehrte die
         Aussage still um und verlangte zusätzlich Pfeiltasten-Navigation.

     Nur in der zweispaltigen Form: unterhalb davon führt die Tab-Reihe, und die
     Bestandskacheln darüber sind der Weg in die beiden Listen. Zwei Umschalter
     für dieselbe Frage auf einem Schirm wären eine doppelte Wahrheit.

     `aria-pressed` statt `aria-current`: es ist ein Schalter, kein Ort. Die
     Auszeichnung ist die einzige nicht-visuelle Angabe, welche Liste steht —
     die Farbe trägt sie nicht allein (WCAG 1.4.1), das Wort steht daneben. --}}
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
             nichts nach. --}}
        <a :href="forgeTabHref('{{ $segment['wert'] }}')"
           x-on:click.prevent="tab = '{{ $segment['wert'] }}'"
           data-forge-liste="{{ $segment['wert'] }}"
           ::aria-pressed="listeAktiv() === '{{ $segment['wert'] }}' ? 'true' : 'false'"
           class="rounded-pill px-3 py-1 text-xs font-semibold transition"
           :class="listeAktiv() === '{{ $segment['wert'] }}'
               ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
               : 'bg-zinc-100 text-muted hover:text-zinc-900 dark:bg-zinc-800 dark:hover:text-zinc-100'">{{ $segment['label'] }}</a>
    @endforeach
</div>
