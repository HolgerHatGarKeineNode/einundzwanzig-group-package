@props([
    'when',
    'sr' => true,
    'dotClass' => '',
])

{{-- Ungelesen-Marker (P3): EIN Punkt, KEINE Zahl. Die Zahl ist bewusst vertagt
     (P6) — das Wasserzeichen sitzt heute auf autorgesetztem `created_at`, und eine
     Zahl, die einmal falsch war, wird nie wieder geglaubt. Der Punkt beantwortet
     die einzige Frage, die eine Listenzeile stellt: „muss ich da rein?".

     `when` ist ein ALPINE-Ausdruck (String), kein PHP-Wert. Quelle ist der globale
     Store aus dem Datenstrang:
         Alpine.store('unread') → { rooms: Record<h, bool>, threads: Record<id, bool>, any: bool }
     IMMER defensiv adressieren (`$store.unread?.rooms?.[…]`): fehlt der Store —
     Gast, Ladephase, Fremdhost ohne Datenstrang — ist der Ausdruck `undefined`,
     also falsy, und es rendert NICHTS. Kein Punkt ist der korrekte Zustand für
     „weiß ich noch nicht"; „alles ungelesen beim Laden" wäre der schlimmere Fehler.

     `x-if`, nicht `x-show`: die Template-Kinder stehen server-seitig gar nicht im
     DOM. Damit gibt es weder einen leeren Platzhalter im Layout noch ein Aufblitzen
     des Punktes vor dem Alpine-Boot (ein `x-cloak` erübrigt sich).

     `sr=false` setzen, wenn das umschließende interaktive Element ein `aria-label`
     trägt — das ERSETZT den Kindtext, ein sr-only wäre dort totes Markup. Dann
     gehört der Hinweis stattdessen in den aria-label-Ausdruck.

     Farbe (§4.6-Rollenregel): brand-700 (light) / brand-400 (dark) sind die
     Linien- und Punktfarben. brand-500 ist Fläche, brand-600 Icon/Hover — beide
     hier NICHT zulässig. Als Grafikobjekt gilt WCAG 1.4.11 (≥ 3:1) gegen den
     ECHTEN Untergrund. Erwartet (GERECHNET, NICHT GEMESSEN): brand-700 #c05c08 auf
     weißer Kachel ≈ 4,4:1, auf Hover-zinc-100 ≈ 4,0:1; brand-400 #fda537 auf
     zinc-900 ≈ 9,1:1. Verbindlich ist erst die Messung im gerenderten Baum
     (`tests/e2e/a11y-contrast.spec.ts` im Host-Repo). --}}
<template x-if="{{ $when }}">
    <span class="inline-flex shrink-0 items-center">
        <span aria-hidden="true"
              class="size-2 shrink-0 rounded-full bg-brand-700 dark:bg-brand-400 {{ $dotClass }}"></span>
        @if ($sr)
            <span class="sr-only">, {{ __('ungelesene Nachrichten') }}</span>
        @endif
    </span>
</template>
