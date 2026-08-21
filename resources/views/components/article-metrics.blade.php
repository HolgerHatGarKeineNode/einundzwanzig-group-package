@props([
    'metrics',
    'class' => '',
])

{{-- ── Sozialsignale eines Artikels (P6, LESEND) ────────────────────────────────────

     Reaktionen, Zaps und Kommentare zu einem Longform-Artikel. EIN Markup für drei
     Flächen — die Liste (`⚡articles`), die Vollansicht (`⚡article`) und die
     Autorenseite (`⚡article-author`). Stünde es dreimal, trüge dieselbe Zahl auf drei
     Flächen drei Formatierungen, und die nächste Ergänzung träfe zwei davon.

     `metrics` ist ein ALPINE-Ausdruck (String), kein PHP-Wert — z. B. `card.metriken`.
     Immer defensiv adressieren (`?.`): vor dem ersten Emit der Ableitung, auf einem
     Fremdhost ohne Datenstrang oder bei einem Bestandsobjekt aus dem Cache ist er
     `undefined`, und dann rendert hier **nichts**.

     ── Warum eine 0 nicht erscheint ─────────────────────────────────────────────────

     `x-if` je Wert, nicht `x-show` und schon gar nicht eine Zeile mit drei Nullen. Der
     Grund ist nicht Platz, sondern Wahrheitsgehalt: die Zahlen stammen von DREI Relays,
     von denen zwei fremd sind. „0 Reaktionen" wäre eine Aussage über die Welt, gedeckt
     ist aber nur „uns hat keiner eine geschickt". Am Bestand vom 2026-08-21 trifft das
     20 der 104 Artikel — der Leerfall ist der Normalfall, nicht der Rand.

     Mit `x-if` steht bei 0 gar kein Knoten im DOM: kein leerer Platzhalter, keine
     Layout-Reserve, kein Aufblitzen vor dem Alpine-Boot.

     ── Sichtbar Ziffer, für den Screenreader der ganze Satz ─────────────────────────

     Auf der Karte steht Icon + Zahl; „3 Reaktionen" ausgeschrieben sprengte die
     Meta-Zeile neben Datum und Lesezeit. Das Icon ist deshalb `aria-hidden`, und der
     Numerus-Text steht als `sr-only` daneben — dasselbe Muster wie in
     `components/unread-badge.blade.php`.

     ── `tabular-nums`, kein `font-mono` ────────────────────────────────────────────

     `--font-mono` ist im Theme **nicht definiert**. Am 2026-08-21 nachgemessen: der
     `@theme`-Block von `theme.css` setzt ausschließlich `--font-sans` (auf Inconsolata);
     die drei Vorkommen von `--font-mono` sind alle NUTZUNGEN mit Rückfall
     (`var(--font-mono, monospace)`), keine Deklaration. Ein `font-mono` zöge hier also
     eine zweite Schriftfamilie in die Karte, und gebraucht wird ohnehin nur die gleiche
     Ziffernbreite. --}}

<template x-if="{{ $metrics }}?.reaktionen > 0 || {{ $metrics }}?.zaps > 0 || {{ $metrics }}?.kommentare > 0">
    {{-- `data-artikel-metriken` ist der Anker der E2E-Tests. Ein Positions-Locator
         („das dritte Span in der Meta-Zeile") wäre bei der nächsten Ergänzung still
         falsch; das Attribut trägt ausschließlich diese Komponente. --}}
    <span data-artikel-metriken class="inline-flex flex-wrap items-center gap-x-2 gap-y-1 {{ $class }}">
        <template x-if="{{ $metrics }}?.reaktionen > 0">
            <span class="inline-flex items-center gap-1">
                <flux:icon.heart variant="micro" class="size-3.5 shrink-0" aria-hidden="true" />
                <span class="tabular-nums" aria-hidden="true" x-text="$num({{ $metrics }}.reaktionen)"></span>
                <span class="sr-only" x-text="$plural({{ $metrics }}.reaktionen, '1 Reaktion', ':count Reaktionen')"></span>
            </span>
        </template>

        {{-- Der Zap zeigt SATS, wenn welche validiert wurden, sonst die ANZAHL.

             Das ist keine Kosmetik: `zapFromEvent` prüft die Quittung gegen den
             aufgelösten LNURL-Zapper des Autors, und bis der geladen ist, kann eine Zahl
             von Quittungen bekannt sein, ohne dass ein einziger Betrag gedeckt wäre.
             „0 Sats" neben drei Quittungen wäre dann eine falsche Aussage; „3 Zaps" ist
             die richtige. Am Bestand vom 2026-08-21 fallen zusätzlich 36 von 168
             Quittungen dauerhaft durch die Prüfung, weil ihr `lnurl`-Tag nicht der
             bech32-Form entspricht, gegen die welshman vergleicht (Herleitung bei
             `summiereZaps` in `js/articleMetrics.ts`). --}}
        <template x-if="{{ $metrics }}?.zaps > 0">
            <span class="inline-flex items-center gap-1">
                <flux:icon.bolt variant="micro" class="size-3.5 shrink-0" aria-hidden="true" />
                <span class="tabular-nums"
                      aria-hidden="true"
                      x-text="{{ $metrics }}.sats > 0 ? $num({{ $metrics }}.sats) : $num({{ $metrics }}.zaps)"></span>
                <span class="sr-only"
                      x-text="{{ $metrics }}.sats > 0
                          ? $plural({{ $metrics }}.sats, '1 Sat gezappt', ':count Sats gezappt')
                          : $plural({{ $metrics }}.zaps, '1 Zap', ':count Zaps')"></span>
            </span>
        </template>

        <template x-if="{{ $metrics }}?.kommentare > 0">
            <span class="inline-flex items-center gap-1">
                <flux:icon.chat-bubble-left-ellipsis variant="micro" class="size-3.5 shrink-0" aria-hidden="true" />
                <span class="tabular-nums" aria-hidden="true" x-text="$num({{ $metrics }}.kommentare)"></span>
                <span class="sr-only" x-text="$plural({{ $metrics }}.kommentare, '1 Kommentar', ':count Kommentare')"></span>
            </span>
        </template>
    </span>
</template>
