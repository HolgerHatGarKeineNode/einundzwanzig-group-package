@php
    /**
     * Ein Vorschlag, in Worten — EINE Fassung für zwei Verbraucher.
     *
     * Der `aria-label` der Zeile und die Ansage der Live-Region müssen dasselbe
     * sagen; zwei getrennt gepflegte Ausdrücke liefen unweigerlich auseinander.
     * `$eintrag` ist der JS-Ausdruck für den gemeinten Datensatz, `beschreibung()`
     * baut daraus „Name, Agent, npub1…".
     */
    $beschreibung = fn (string $e): string => "[{$e}.name, {$e}.isAgent ? "
        . \Illuminate\Support\Js::from(__('Agent'))
        . " : null, {$e}.hint || null].filter(Boolean).join(', ')";
    $ausgewaehlt = 'mention.items[mention.index]';
@endphp
{{-- @-Vorschlagsliste eines Forge-Composers (P9).

     `$targetExpr` ist ein **JS-Ausdruck**, kein Wert: die Kommentarfelder stehen
     in einem `x-for`, ihr Ziel heißt `'comment:' + issue.id` und ist erst zur
     Laufzeit bekannt. `$targetLabel` ist die statische Entsprechung fürs
     Datenattribut ('issue' bzw. 'comment') — ein Locator braucht etwas, das im
     Markup steht.

     Der Zustand `mention` ist EINER für die ganze Seite; `mention.target`
     entscheidet, welcher Composer sein Popover zeigt. Es tippt immer nur ein
     Feld, es kann also nie zwei offene geben — anders als im Chat, wo Raum- und
     Thread-Composer denselben Zustand teilen.

     Ohne Agenten-Verzeichnis (zooid, oder Repo ohne `buzz-channel`) enthält die
     Liste nur Menschen: der Riegel steht in `agentMentionItems`, nicht hier. --}}

{{-- **Die Ansage, weil die kanonische Form hier verschlossen ist.**

     Das Muster für eine Vorschlagsliste an einem Eingabefeld ist die
     APG-Editable-Combobox: `role="combobox"` auf dem Feld, `aria-expanded`,
     `aria-activedescendant`. Der Composer ist aber ein `<textarea>`, und für das
     gilt laut „ARIA in HTML" (W3C, geprüft 2026-08-23): „No `role` other than
     `textbox`". Ein `role="combobox"` wäre dort nicht konform, und `aria-expanded`
     hängt an genau dieser Rolle.

     Bleibt die höfliche Live-Region. Sie sagt beim Öffnen und bei jedem Pfeil,
     WAS gerade ausgewählt ist und an welcher Stelle — inhaltlich dasselbe, was
     `aria-activedescendant` transportiert hätte. Sie steht AUSSERHALB des `x-if`
     und ist damit schon da, bevor Text hineinkommt: eine Live-Region, die
     gemeinsam mit ihrem Inhalt entsteht, wird von mehreren Screenreadern
     verschluckt. --}}
<div class="sr-only" role="status" aria-live="polite" data-forge-mention-ansage="{{ $targetLabel }}"
     x-text="mention.open && mention.target === ({!! $targetExpr !!}) && {{ $ausgewaehlt }}
         ? {!! \Illuminate\Support\Js::from(__('Vorschlag :position von :anzahl: :eintrag')) !!}
             .replace(':position', mention.index + 1)
             .replace(':anzahl', mention.items.length)
             .replace(':eintrag', () => {!! $beschreibung($ausgewaehlt) !!})
         : ''"></div>

<template x-if="mention.open && mention.target === ({!! $targetExpr !!})">
    <div data-forge-mention-popover="{{ $targetLabel }}" role="listbox" aria-label="{{ __('Vorschläge für die Erwähnung') }}"
         class="surface-card absolute bottom-full left-0 z-30 mb-1 max-h-56 w-full max-w-xs overflow-y-auto rounded-card p-1 shadow-xl"
         x-on:click.stop>
        <template x-for="(item, i) in mention.items" :key="item.pubkey">
            {{-- `data-agent` ist der Haken für die Tests: „hier steht kein
                 Agentenvorschlag" ist nur prüfbar, wenn die Zeile im Ja-Fall ein
                 eigenes Merkmal trägt.

                 `x-effect` + `scrollIntoView`: die Liste ist auf `max-h-56`
                 gedeckelt (224 px), eine Zeile ist 48 px hoch — sichtbar sind
                 also gut vier von bis zu dreizehn Einträgen (5 Agenten + 8
                 Menschen, getrennte Deckel). Ohne diese Zeile blieb `scrollTop`
                 beim Blättern auf 0: ab dem fünften Pfeildruck wanderte die
                 Auswahl aus dem Fenster und der Nutzer blätterte blind
                 (gemessen 2026-08-23: ab Index 4 außerhalb, scrollHeight 595 zu
                 clientHeight 224). `block: 'nearest'` scrollt nur, wenn nötig,
                 und zieht keine Vorfahren mit. --}}
            <button type="button" x-on:click="pickMention(item)" x-on:mouseenter="mention.index = i"
                    {{-- `tabindex="-1"`: eine Option ist kein eigener Tabstopp. Die
                     Tastaturbedienung dieser Liste läuft über ↑/↓/Enter am
                     Composer (durchgespielt 2026-08-23, funktioniert in beiden
                     Flächen) — Tab wird dort abgefangen und übernimmt den
                     Vorschlag, man kann also gar nicht vorwärts hineintabben.
                     Rückwärts ging es aber sehr wohl: das Popover steht im DOM
                     VOR dem Feld, Shift+Tab landete mitten in der Liste, und
                     dort tun die Pfeiltasten nichts mehr (der Handler hängt am
                     Feld). Sieben transiente Tabstopps, die anders funktionieren
                     als die Liste, aus der sie stammen. Kein Verlust an
                     Bedienbarkeit: derselbe Vorschlag bleibt über die Pfeile
                     erreichbar, und Klicken/Tippen ist unberührt. --}}
                    role="option" tabindex="-1" :aria-selected="mention.index === i ? 'true' : 'false'"
                    :aria-label="{!! $beschreibung('item') !!}"
                    x-effect="mention.index === i && $el.scrollIntoView({ block: 'nearest' })"
                    class="pressable flex w-full items-center gap-2 rounded-tile px-2 py-1.5 text-left"
                    :data-agent="item.isAgent ? 'true' : null"
                    :class="mention.index === i ? 'bg-brand-500/15' : ''">
                <x-group::nostr-avatar picture="item.picture" name="item.name" />
                <span class="min-w-0 flex-1">
                    <span class="block truncate text-sm" x-text="item.name"></span>
                    {{-- **Der Name allein ist keine Identität.** Ein Agentenprofil
                         (kind 10100) ist selbstsigniert: jedes Relay-Mitglied darf
                         eins publizieren, und Buzz sagt ausdrücklich, dass die
                         Durchsetzung relay-seitig fehlt (`buzz-cli/src/commands/
                         channels.rs:1030-1035`). Zwei Einträge dürfen „ceo" heißen.
                         Deshalb steht der Schlüssel IMMER daneben — nicht erst,
                         wenn eine Dublette auffällt: wer erst dann warnt, warnt
                         genau dann nicht, wenn der echte Eintrag noch fehlt.

                         `text-xs` (12 px) und nicht `text-[10px]`: 10 px steht auf
                         keiner Stufe der Haus-Typoskala (12·14·16·18·20·24·…), und
                         der Schlüssel ist hier nicht Beiwerk, sondern das einzige
                         Merkmal, an dem zwei gleichnamige Einträge auseinandergehen.
                         12 px ist zugleich die Größe, in der dieses Haus einen npub
                         sonst schon zeigt (`login-form.blade.php:33`). --}}
                    {{-- ── Der Haken zeigt auf die BEDEUTUNG, nicht auf die Form ──
                         `data-forge-mention-schluessel` und nicht `span.font-mono`:
                         genau dieser Selektor stand bis zum 2026-08-27 in
                         `buzz-agent-mention-form.spec.ts` und zeigte seit P6b
                         (`e8ec3d1`) ins Leere — dort sind elf `font-mono`-Träger
                         gefallen, weil sie eine zweite Schriftfamilie einbrachten.
                         Eine Schriftklasse ist eine Formentscheidung und darf
                         wechseln; WAS hier steht, wechselt nicht. Der Name sagt es:
                         der Schlüssel ist das einzige Merkmal, an dem zwei
                         gleichnamige Agentenprofile auseinandergehen. --}}
                    <template x-if="item.hint">
                        <span data-forge-mention-schluessel class="block truncate text-xs text-muted" x-text="item.hint"></span>
                    </template>
                </span>
                {{-- Erkennbar als Maschine: der Vorschlag verhält sich beim
                     Absenden wie jeder andere, aber am anderen Ende antwortet
                     ein Prozess — und nur für ihn entsteht die Weckmeldung.

                     `text-brand-800` statt `text-brand-600`: gemessen am
                     gerenderten Chip stand brand-600 auf der getönten Fläche bei
                     **2,36:1** (markierte Zeile) bzw. 2,63:1 (unmarkiert) — WCAG
                     1.4.3 verlangt 4,5:1 für Text dieser Größe. Die beiden
                     `brand-500/15`-Schichten (Zeilenmarkierung UND Chipfläche)
                     addieren sich unter dem Text; brand-800 hält damit 5,12:1
                     bzw. 5,72:1. Der Dunkelzweig war nie betroffen (6,61:1). --}}
                {{-- Derselbe Haken aus demselben Grund. Der Prüfstand griff das
                     Abzeichen bis hierher als `> span:last-child` — das hält nur
                     so lange, wie niemand ein zweites Element anhängt, und es
                     sagt nirgends, WAS gemessen wird. --}}
                <template x-if="item.isAgent">
                    <span aria-hidden="true" data-forge-mention-marke
                          class="shrink-0 rounded-full bg-brand-500/15 px-1.5 py-0.5 text-xs font-semibold uppercase tracking-wide text-brand-800 dark:text-brand-300"
                          title="{{ __('Headless Agent — antwortet auf Erwähnung') }}">{{ __('Agent') }}</span>
                </template>
            </button>
        </template>
    </div>
</template>
