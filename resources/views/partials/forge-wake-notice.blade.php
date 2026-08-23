{{-- Was aus der Weckmeldung wurde (P9) — auch dann, wenn keine entstand.

     **Das ist die Stelle, die „kein stilles Nichts" einlöst.** Ein Git-Ereignis
     weckt einen headless Agenten nie (der Relay ignoriert `h` an NIP-34-Events,
     `ingest.rs:425-437`); die Weckmeldung ist ein zweiter, eigener Vorgang. Geht
     sie nicht raus — kein `buzz-channel` am Repo, kein weckbarer Agent, Relay
     abgelehnt —, dann wartet der Nutzer sonst auf eine Antwort, die per
     Konstruktion nie kommt.

     Der Beitrag selbst bleibt in JEDEM dieser Fälle gültig und steht in der
     Liste. Deshalb ist dieser Block `role="status"` und nicht `role="alert"`:
     er meldet den Ausgang eines Nebenvorgangs, keinen Fehlschlag.

     ── Warum `role="status"` jetzt am äußeren, IMMER vorhandenen Knoten hängt ──

     Vorher trug ihn der Kasten selbst, und der entsteht per `x-if` erst in dem
     Moment, in dem sein Text schon drinsteht. Eine Live-Region, die gemeinsam
     mit ihrem Inhalt in den Baum kommt, ist genau der Fall, den mehrere
     Screenreader nicht als Änderung sehen — sie lesen nichts vor. Die Region
     muss vorher dastehen und danach gefüllt werden; deshalb der leere Wrapper
     (ohne Klassen, also ohne Höhe und ohne Abstand) und das `x-if` darin.

     `$target` ist der Schlüssel im `wakeNotice`-Verzeichnis ('issue' oder
     `comment:<id>`) — als JS-Ausdruck, weil er bei Kommentaren erst zur Laufzeit
     feststeht. --}}
<div role="status" data-forge-wake-status="{{ $label }}">
    <template x-if="wakeNotice[{!! $target !!}]">
        <div data-forge-wake-notice="{{ $label }}"
             :data-tone="wakeNotice[{!! $target !!}].tone"
             :class="wakeNotice[{!! $target !!}].tone === 'ok'
                 ? 'border-emerald-500/40 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400'
                 : 'border-amber-500/40 bg-amber-500/5 text-amber-700 dark:text-amber-400'"
             class="mt-2 flex items-start gap-2 rounded-tile border px-3 py-2 text-xs">
            {{-- **Zwei Symbole, weil der Ton sonst nur eine Farbe ist.**

                 Bis 2026-08-23 stand hier EIN `information-circle` für beide
                 Fälle. Gemessen war der gerenderte Kasten in „jemand wurde
                 geweckt" und „niemand wurde geweckt" bis auf den Farbton
                 identisch: gleiche Höhe (36 px), gleiche Schrift (12 px/400),
                 gleicher Pfad im SVG. Wer die Farbe nicht sieht oder nicht
                 unterscheidet, musste den 12-px-Satz lesen, um den Ausgang zu
                 kennen — und der Nullfall ist hier die eigentliche Information.

                 Die beiden Symbole sind nicht frei gewählt, sondern die schon
                 etablierte Sprache dieser Datei: `exclamation-triangle` steht in
                 `⚡forge-repo.blade.php` an jeder Fehler- und Fehlschlagzeile.

                 Zwei `x-if` statt einer Bindung: `flux:icon.*` wählt seine SVG
                 zur COMPILE-Zeit; ein gebundener Name bliebe eine tote Bindung
                 (dieselbe Falle wie `::variant`). --}}
            <template x-if="wakeNotice[{!! $target !!}].tone === 'ok'">
                <flux:icon.check-circle class="mt-0.5 size-4 shrink-0" />
            </template>
            <template x-if="wakeNotice[{!! $target !!}].tone !== 'ok'">
                <flux:icon.exclamation-triangle class="mt-0.5 size-4 shrink-0" />
            </template>
            <span class="min-w-0 flex-1" x-text="wakeNotice[{!! $target !!}].text"></span>
            {{-- Zielfläche statt nackter Textzeile: als reines `underline`-Wort maß
                 der Knopf 54 × **16** px und riss damit die 24 × 24 px aus WCAG
                 2.5.8. `px-2 py-1` hebt ihn auf 24 px Höhe, `icon-btn-touch` auf
                 44 × 44 px, sobald der Zeiger grob ist (Haus-Utility, greift nur
                 unter `pointer: coarse`). `pressable` bringt den sichtbaren
                 Fokusring mit, den ein Nicht-Flux-Knopf sonst nicht hat. --}}
            <button type="button" x-on:click="dismissWake({!! $target !!})"
                    class="pressable icon-btn-touch shrink-0 rounded-tile px-2 py-1 font-medium underline">{{ __('Verwerfen') }}</button>
        </div>
    </template>
</div>
