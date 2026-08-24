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

     ── Warum `role="status"` am äußeren, IMMER vorhandenen Knoten hängt ────────

     Vorher trug ihn der Kasten selbst, und der entsteht per `x-if` erst in dem
     Moment, in dem sein Text schon drinsteht. Eine Live-Region, die gemeinsam
     mit ihrem Inhalt in den Baum kommt, ist genau der Fall, den mehrere
     Screenreader nicht als Änderung sehen — sie lesen nichts vor. Die Region
     muss vorher dastehen und danach gefüllt werden; deshalb der leere Wrapper
     (ohne Klassen, also ohne Höhe und ohne Abstand) und das `x-if` darin.

     `$target` ist der Schlüssel im `wakeNotice`-Verzeichnis ('issue' oder
     `comment:<id>`) — als JS-Ausdruck, weil er bei Kommentaren erst zur Laufzeit
     feststeht.

     ── Flux-Angleich: `flux:callout` statt eines nachgebauten Kastens ─────────

     Hier stand `rounded-tile border px-3 py-2` mit zwei von Hand geschriebenen
     Farbsätzen (`border-emerald-500/40 bg-emerald-500/5 …` bzw. die Amber-Fassung)
     — also eine dritte Bauform für „Hinweis in einem Kasten", neben den
     `flux:callout` in `⚡forge.blade.php` und `⚡forge-repo.blade.php`.

     **ZWEI Zweige und nicht eine Bindung**, und das ist keine Bequemlichkeit:
     `variant` ist eine Blade-Prop und wird zur COMPILE-Zeit aufgelöst
     (`flux/callout/index.blade.php` schlägt daraus den Farbsatz nach). Ein
     `:variant="…"` wäre dieselbe tote Bindung wie `::variant` an `flux:icon`.
     Zwei Zweige lösen zugleich das Symbolproblem, das ohnehin zwei verlangte
     (siehe unten) — es sind also nicht zwei Probleme, sondern eines.

     `inline` hält den Kasten einzeilig: Text links, „Verwerfen" rechts, wie
     vorher. `data-tone` bleibt GEBUNDEN statt in den Zweig hineingeschrieben —
     `buzz-forge-mentions.spec.ts` liest den echten Wert (fünf Zusagen), und ein
     dritter Ton fiele sonst stumm auf „warn". --}}
<div role="status" data-forge-wake-status="{{ $label }}">
    {{-- **Zwei Symbole, weil der Ton sonst nur eine Farbe ist.**

         Bis 2026-08-23 stand hier EIN `information-circle` für beide Fälle.
         Gemessen war der gerenderte Kasten in „jemand wurde geweckt" und
         „niemand wurde geweckt" bis auf den Farbton identisch: gleiche Höhe
         (36 px), gleiche Schrift (12 px/400), gleicher Pfad im SVG. Wer die
         Farbe nicht sieht oder nicht unterscheidet, musste den 12-px-Satz
         lesen — und der Nullfall ist hier die eigentliche Information.

         Die beiden Symbole sind nicht frei gewählt, sondern die schon
         etablierte Sprache dieser Datei: `exclamation-triangle` steht in
         `⚡forge-repo.blade.php` an jeder Fehler- und Fehlschlagzeile. --}}
    <template x-if="wakeNotice[{!! $target !!}] && wakeNotice[{!! $target !!}].tone === 'ok'">
        <flux:callout variant="success" icon="check-circle" inline class="mt-2"
                      data-forge-wake-notice="{{ $label }}"
                      ::data-tone="wakeNotice[{!! $target !!}].tone">
            <flux:callout.text class="text-xs!" x-text="wakeNotice[{!! $target !!}].text"></flux:callout.text>
            <x-slot name="actions">
                @include('group::partials.forge-wake-verwerfen', ['target' => $target])
            </x-slot>
        </flux:callout>
    </template>

    <template x-if="wakeNotice[{!! $target !!}] && wakeNotice[{!! $target !!}].tone !== 'ok'">
        <flux:callout variant="warning" icon="exclamation-triangle" inline class="mt-2"
                      data-forge-wake-notice="{{ $label }}"
                      ::data-tone="wakeNotice[{!! $target !!}].tone">
            <flux:callout.text class="text-xs!" x-text="wakeNotice[{!! $target !!}].text"></flux:callout.text>
            <x-slot name="actions">
                @include('group::partials.forge-wake-verwerfen', ['target' => $target])
            </x-slot>
        </flux:callout>
    </template>
</div>
