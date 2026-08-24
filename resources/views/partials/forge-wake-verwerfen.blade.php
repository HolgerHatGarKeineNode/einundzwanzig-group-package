{{-- Der Verwerfen-Knopf der Weckmeldung — EIN Ort für zwei Tonlagen.

     `forge-wake-notice` muss den Kasten in zwei Zweige spalten (`variant` ist
     eine Blade-Prop und wird zur Compile-Zeit aufgelöst). Der Knopf darin ist in
     beiden Zweigen derselbe, und er trägt zwei gemessene Zusagen — die gehören
     an genau eine Stelle, nicht zweimal kopiert.

     ── Die Zahlen, die an ihm hängen ─────────────────────────────────────────
     `buzz-agent-mention-form.spec.ts` misst `[data-forge-wake-notice="issue"]
     button` in beiden Tonlagen:
       · feiner Zeiger  ≥ 24 × 24 px (WCAG 2.5.8) — `flux:button size="xs"` ist
         `h-6`, also exakt 24 px (`flux/button/index.blade.php:84`). Als nacktes
         `underline`-Wort maß der Knopf vorher 54 × 16 px und riss die Grenze.
       · grober Zeiger  ≥ 44 × 44 px (Apple HIG) — dafür `icon-btn-touch`, das
         Haus-Utility hinter `@media (pointer: coarse)`. `min-height` schlägt die
         feste `h-6`, der Knopf wächst also wirklich.

     `flux:button` bringt seinen Fokusring selbst mit; `pressable` (das ihn für
     Nicht-Flux-Flächen nachrüstete) ist damit überflüssig geworden. --}}
<flux:button size="xs" variant="ghost" class="icon-btn-touch shrink-0"
             x-on:click="dismissWake({!! $target !!})">{{ __('Verwerfen') }}</flux:button>
