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
     ECHTEN Untergrund.

     GEMESSEN im gerenderten Baum (`tests/e2e/a11y-contrast.spec.ts` im Host-Repo,
     Lauf 2026-08-14) — und die Messung ist verbindlich, nicht die Rechnung:
       · hell:   brand-700 #c05c08 auf zinc-50  = 4,21:1
       · dunkel: brand-400 #fda537 auf zinc-950 = 10,01:1
     Der Punkt sitzt dort, wo er heute rendert: in der Bottom-Nav, und die steht auf
     zinc-50 bzw. zinc-950. Hier stand bis 2026-08-14 „auf weißer Kachel ≈ 4,4:1 /
     auf zinc-900 ≈ 9,1:1" — beides gerechnete Werte für Untergründe, auf denen der
     Punkt gar nicht landet. Die gerechneten Werte für die genannten Flächen wären
     4,40:1 (weiß), 4,03:1 (Hover-zinc-100) und 9,06:1 (zinc-900); alle vier tragen
     die 3:1, der Befund war also nie falsch — nur der Untergrund. --}}
<template x-if="{{ $when }}">
    <span class="inline-flex shrink-0 items-center">
        <span aria-hidden="true"
              class="size-2 shrink-0 rounded-full bg-brand-700 dark:bg-brand-400 {{ $dotClass }}"></span>
        @if ($sr)
            <span class="sr-only">, {{ __('ungelesene Nachrichten') }}</span>
        @endif
    </span>
</template>
