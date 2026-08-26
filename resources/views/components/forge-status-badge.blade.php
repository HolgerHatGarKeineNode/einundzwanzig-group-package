@props([
    /** Alpine-Ausdruck, der den ROHEN Statuscode liefert (`open`, `applied`, `merged`,
        `resolved`, `closed`, `draft`) — nicht das Wort. */
    'status',
    /** Alpine-Ausdruck, der das ÜBERSETZTE Wort liefert (`statusText(…)`/`row.statusLabel`). */
    'label',
    /** `ab-sm` = mobil nur die Glyphe plus `sr-only`-Wort, ab `sm` mit Wort.
        `immer` = das Wort steht auf jeder Breite. */
    'wort' => 'ab-sm',
    /**
     * Zusätzliche Klassen für die Pille — z. B. das Rasterfeld der Vorgangszeile
     * (`forge-vz-zustand`).
     *
     * **Ein eigener Prop und NICHT `$attributes`,** und das ist gemessen: auf
     * einem Flux-Tag ist `:attributes="$attributes"` KEINE Laravel-Attributbeutel-
     * Zusammenführung. Flux' Precompiler macht daraus ein Alpine-Bind, und im
     * gerenderten Baum stand wörtlich `bind:attributes=""` — ein totes Attribut.
     * Die Klasse des Aufrufers kam nie an, die Pille bekam `grid-area: auto` und
     * wurde vom Browser automatisch platziert. Sie sah dabei fast richtig aus,
     * was den Fund gefährlich macht: ein Layout-Zufall, der wie Absicht aussieht.
     *
     * Das ist dieselbe Falle wie `::attr` gegen `:attr` in diesem Haus, nur eine
     * Ebene höher — auf Flux-Tags gilt: Werte interpolieren, keine Beutel reichen.
     */
    'klasse' => '',
])

{{-- ── EINE Zustandsform für die ganze Forge (P1, 2026-08-26) ─────────────────
     Bis hierher trug jede Vorgangszeile ZWEI Zustandsträger: einen grauen Punkt
     am Zeilenanfang (gefüllt = offen, Ring = erledigt) und 400 px weiter rechts
     dasselbe noch einmal als versales Wort. Der Punkt ist gefallen; diese Pille
     ist übrig — die Form, die in der Aktivitätsspur schon stand und dort seit
     dem Flux-Angleich gemessen ist.

     ── Warum die Pille KEINE Farbe trägt ───────────────────────────────────────
     `flux:badge` bringt seinen eigenen Grund mit (`bg-zinc-400/15` hell,
     `dark:bg-zinc-400/40`). Auf dem misst `--color-forge-ruhend` (zinc-400) im
     dunklen Modus 3,18:1 und reißt WCAG 1.4.3; Flux' eigener Vordergrund trägt
     mit 9,25:1 hell (zinc-700) und 6,42:1 dunkel (zinc-200). Die Hausfarbe
     überlebt den Untergrundwechsel also nicht, Flux' Default schon.

     WCAG 1.4.1 bleibt erfüllt, weil die vier Zustände die GLYPHE unterscheidet
     und nicht die Farbe — geschlossen und Entwurf teilten sich vorher ohnehin
     einen Farbwert.

     ── Mobil nur die Glyphe ────────────────────────────────────────────────────
     Die Vorgangszeile bricht mobil in eine eigene Zeile um; „ZUSAMMENGEFÜHRT"
     neben Commit-Kurzform und Kommentarzahl nahm auf 390 px die halbe Breite.
     `sr-only` ist `clip`, kein `display:none` — das Wort bleibt für die
     Sprachausgabe da, es verschwindet nur aus dem Bild. Und weil ein
     `position:absolute`-Kind kein Flex-Item ist, kostet es auch keine
     `gap`-Lücke neben der Glyphe.

     ── `::data-status` und nicht `:data-status` ────────────────────────────────
     Auf einer Flux-KOMPONENTE ist der einfache Doppelpunkt eine PHP-Bindung;
     Blade kompilierte den Ausdruck dann als PHP und die Seite stürbe mit
     `Undefined constant`. Der doppelte Doppelpunkt erzeugt das literale
     Attribut, das Alpine dann bindet.

     Kein `aria-hidden="true"` an den Glyphen: `flux:icon` schreibt es selbst in
     das `<svg>` (`flux/icon/*.blade.php`, jeder Variantenzweig). Ein zweites
     hier erzeugte dasselbe Attribut zweimal am selben Tag. --}}
{{-- `data-forge-status` ist der EINE Anker dieser Pille. Bis P3 trug die
     Patch-Zeile daneben ein zweites, eigenes `data-forge-patch-status`; es war in
     keinem Test referenziert (geprüft: 0 Treffer im ganzen E2E-Baum) und ist mit
     dem Umbau in diesem einen aufgegangen. Wer die Sorte braucht, liest sie am
     `<li>`: das trägt unverändert `data-forge-issue` / `-pr` / `-patch`. --}}
<flux:badge size="sm" class="gap-1 {{ $klasse }}" data-forge-status ::data-status="{{ $status }}">
    <template x-if="{{ $status }} === 'open'">
        <flux:icon.exclamation-circle variant="micro" class="size-3.5 shrink-0" />
    </template>
    <template x-if="{{ $status }} === 'applied' || {{ $status }} === 'merged' || {{ $status }} === 'resolved'">
        <flux:icon.check-circle variant="micro" class="size-3.5 shrink-0" />
    </template>
    <template x-if="{{ $status }} === 'closed'">
        <flux:icon.x-circle variant="micro" class="size-3.5 shrink-0" />
    </template>
    <template x-if="{{ $status }} === 'draft'">
        <flux:icon.pencil-square variant="micro" class="size-3.5 shrink-0" />
    </template>
    <span @class(['sr-only sm:not-sr-only' => $wort === 'ab-sm']) x-text="{{ $label }}"></span>
</flux:badge>
