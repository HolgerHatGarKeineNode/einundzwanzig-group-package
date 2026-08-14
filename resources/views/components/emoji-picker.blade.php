@props([
    // Alpine-Ausdruck der Ziel-Nachricht (`m` in der Zeile, `menuFor` im Modal).
    // Nur im Modus 'react' benutzt.
    'message' => 'm',
    // Optionaler Alpine-Ausdruck NACH dem Reagieren (Web-Popover: `open = false`).
    // Das native Modal schließt react() selbst (closeMessageMenu) — dort leer.
    'onpick' => '',
    // 'react' = Reaktion auf die Ziel-Nachricht (kind 7) · 'insert' = Emoji in den
    // Nachrichten-Entwurf des Composers. EINE Komponente, weil sich die beiden Modi
    // nur im Klick-Handler unterscheiden — Grid, Suche, Tabs, MRU sind identisch.
    // (Keine doppelt-geschweiften Echo-Klammern in diesem Block — auch nicht im
    // Kommentar: Blade kompiliert sie IN @props mit, und heraus fällt ein
    // PHP-Syntaxfehler, der auf die Hash-Datei zeigt statt auf diese Zeile.)
    'mode' => 'react',
    // Nur im Modus 'insert': welcher Composer ('main'|'thread') den Picker geöffnet
    // hat. Steht im Markup fest, statt zur Laufzeit erraten zu werden.
    'target' => 'main',
])

@php
    $after = $onpick ? '; '.$onpick : '';
    $isInsert = $mode === 'insert';
    // Emoji-Tile-Verhalten einmal definiert (MRU-Reihe + Grid teilen es sich).
    // Custom-Emoji originalgetreu (`:shortcode:` + roher emoji-Tag), Standard mit Label
    // für die MRU. `{!! !!}`: die Ausdrücke enthalten Anführungszeichen → nicht escapen.
    // Beide Modi haben dieselbe Signatur (content, emojiTag?, label?) — im Insert-Modus
    // dient das emojiTag NUR der MRU; das Event-Tag leitet der Sendepfad aus dem Text ab.
    $pick = $isInsert
        ? "(e.custom ? insertEmoji('$target', ':' + e.shortcode + ':', ['emoji', e.shortcode, e.url]) : insertEmoji('$target', e.u, undefined, e.label))$after"
        : "(e.custom ? react($message, ':' + e.shortcode + ':', ['emoji', e.shortcode, e.url]) : react($message, e.u, undefined, e.label))$after";
    // aria-label übersetzbar: EIN Präfix-Key + der Emoji-Token am Ende (Fragment-
    // Übersetzung „Mit … reagieren" bräche in jeder Zielsprache die Grammatik).
    // Einfach-gequotetes JS-Literal (das Attribut :aria-label ist doppelt gequotet).
    $pickPrefix = "'".str_replace("'", "\\'", $isInsert ? __('Einfügen: ') : __('Reagieren mit '))."'";
    $pickLabel = "$pickPrefix + (e.custom ? (':' + e.shortcode + ':') : e.label)";
    $pickTitle = 'e.custom ? e.shortcode : e.label';
@endphp

{{-- C1-Emoji-Picker: „Zuletzt benutzt"-Reihe + Suche + Kategorie-Tabs + volles
     Standard-Set (emojibase, lazy) + ein erster Tab „Deine Emojis" (NIP-30 aus
     deinem Profil). Eine Quelle für Web-Popover UND natives „…"-Modal.
     `react()`/{{ $message }} kommen per Alpine-Scope-Chain von der Insel. --}}
<div x-data="emojiPicker()"
     {{ $attributes->merge(['class' => 'flex w-[min(21rem,86vw)] flex-col gap-2']) }}>

    {{-- „Zuletzt benutzt" (MRU): dynamisch, leer beim ersten Gebrauch → keine Reihe. --}}
    <template x-if="recent.length">
        <div class="flex items-center gap-0.5 overflow-x-auto" role="group" aria-label="{{ __('Zuletzt benutzt') }}"
             style="scrollbar-width: thin;">
            {{-- Zwei Schleifen wie im Grid darunter, aus demselben Grund (dort die
                 Begründung samt Messung). Hier sind es nur bis zu acht Kacheln, aber
                 dieselbe Verzweigung zweimal im Markup zu haben, hieße auch, sie
                 zweimal pflegen zu müssen — und die MRU ist der einzige Ort, an dem
                 Custom und Standard REGELMÄSSIG gemischt auftreten. --}}
            <template x-for="e in recent.filter((x) => x.custom)" :key="':' + e.shortcode">
                <button type="button"
                        x-on:click="{!! $pick !!}"
                        :aria-label="{!! $pickLabel !!}"
                        :title="{!! $pickTitle !!}"
                        class="pressable flex size-9 shrink-0 items-center justify-center rounded-tile text-xl leading-none hover:bg-brand-500/15">
                    <img :src="e.src" :alt="e.shortcode" loading="lazy" class="size-6 object-contain" />
                </button>
            </template>
            <template x-for="e in recent.filter((x) => !x.custom)" :key="e.u">
                <button type="button"
                        x-on:click="{!! $pick !!}"
                        :aria-label="{!! $pickLabel !!}"
                        :title="{!! $pickTitle !!}"
                        class="pressable flex size-9 shrink-0 items-center justify-center rounded-tile text-xl leading-none hover:bg-brand-500/15">
                    <span x-text="e.u"></span>
                </button>
            </template>
        </div>
    </template>

    {{-- Suchfeld: eigenes Styling (Flux passt hier nicht).

         `text-zinc-800 dark:text-white` statt `text-white`: im HELLEN Theme stand hier
         weißer Text auf der weißen Karte (`bg-white/5` über `surface-card` = #FFFFFF) —
         gemessen 1:1, also unsichtbar, während das Grid darunter munter filterte. Der
         Screenshot dazu liegt im Bericht. WCAG 1.4.3 verlangt 4,5:1; zinc-800 misst im
         gerenderten Baum 13,88:1 — gegen die HEUTIGE Feldfläche `bg-zinc-100`, nicht
         gegen Weiß (auf Weiß wären es gerechnet 15,13:1). Hier standen bis 2026-08-14
         „14.7:1 auf Weiß": weder der Untergrund noch die Zahl. Es ist zugleich die
         Tinte, die die Icon-Knöpfe daneben tragen.
         Betrifft beide Modi der Komponente (Reagieren wie Einfügen) — die Reaktions-
         Ansicht war genauso betroffen, das ist kein Nebeneffekt, sondern derselbe Fehler.

         FLÄCHE (B14): vorher `bg-white/5`. Auf der weißen Karte komponierte das zu
         exakt #FFFFFF — das Feld hatte im hellen Theme keinerlei Grenze und las sich
         als Bildunterschrift über dem Grid, nicht als Eingabe. Die leicht vertiefte
         Fläche (`bg-zinc-100`, dark `bg-white/10`) trennt es vom Kartengrund.

         KANTE über das Haus-Token (`border-control-edge`, definiert in `theme.css`)
         statt über eigene Werte. Dieses Feld ist keine Flux-Komponente, die
         System-Regel dort greift also nicht auf es — es zeigt aber auf denselben
         Wert und kann damit nicht mehr vom Rest abweichen. Hier standen vorher zwei
         hart kodierte Stufen; die waren nötig, solange das Feld als einziges die
         Norm erfüllte, und ihr Grund ist mit der systemweiten Kante entfallen.

         Platzhalterfarbe wieder über den Sekundärtext-Token (hinter der
         Platzhalter-Variante). Das ging monatelang NICHT: die Utility verlor hinter
         einer vorangestellten Variante ihre Dark-Hälfte, im dunklen Theme blieben
         gemessene 1,74:1 gegen geforderte 4,5:1. Ursache war die Bauform der Utility,
         nicht die Farbe; sie ist in `theme.css` behoben (echte Farb-Variable statt
         eigener Utility, Begründung dort). Diese Stelle ist zugleich der lebende
         Nachweis, dass der Variantenfall trägt — der Kontrast-Anker misst genau
         diesen Platzhalter in beiden Themes und wird rot, wenn die Falle
         zurückkehrt. --}}
    <div class="relative">
        <svg class="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted"
             viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true">
            <circle cx="9" cy="9" r="6" /><path d="m14 14 4 4" stroke-linecap="round" />
        </svg>
        <input x-model.debounce.150ms="search" type="search"
               placeholder="{{ __('Emoji suchen…') }}" aria-label="{{ __('Emoji suchen') }}"
               class="w-full rounded-tile border border-control-edge bg-zinc-100 py-1.5 pl-8 pr-3 text-sm text-zinc-800 placeholder:text-muted focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/40 dark:bg-white/10 dark:text-white" />
    </div>

    {{-- Kategorie-Tabs: aktiver Tab mit Bitcoin-Underline. Bei aktiver Suche verborgen.

         Der Unterstrich trägt den Aktiv-Zustand und fällt damit unter WCAG 1.4.11
         (≥ 3:1). Als `bg-brand-500` lag er auf der weißen Karte bei 2,21:1 — derselbe
         Fall, den der Kontrast-Anker für die Zähler-Pille schon notiert hat („gegen
         Weiß ~2,3:1, als Grafikobjekt unzulässig"). `bg-brand-700 dark:bg-brand-400`
         ist die im Repo eingeführte Paarung für genau diese Schwelle (unread-dot,
         nav-tab, rail-room-row) — und weil sie es ist, findet der Anker den Unterstrich
         jetzt über dieselbe Klassen-Regel wie die anderen Flächen.

         `text-white` am aktiven Tab ist ersatzlos weg: die Beschriftung ist ein
         Farb-Emoji, `color` malt daran nichts. Im hellen Theme wäre es weiß auf Weiß
         gewesen — eine Regel, die nur deshalb nie aufgefallen ist, weil sie ohnehin
         wirkungslos war. Aktiv = volle Deckkraft + Unterstrich, das reicht.

         Deckkraft der inaktiven Tabs von 55 % auf 70 %: 55 % liegt im Band, in dem
         Material 3 DEAKTIVIERTE Elemente zeichnet (38 %) — ein bedienbarer Tab darf
         nicht aussehen wie ein gesperrter. 70 % hält den Abstand zum aktiven Tab
         (100 % + Unterstrich) und bleibt lesbar. Eine Kontrastzahl gibt es dafür
         bewusst nicht, siehe die Begründung im Kontrast-Anker. --}}
    <div x-show="ready && !search.trim()" class="-mx-0.5 flex gap-0.5 overflow-x-auto px-0.5 pb-1"
         role="tablist" aria-label="{{ __('Emoji-Kategorien') }}" style="scrollbar-width: thin;">
        <template x-for="t in tabs" :key="t.key">
            <button type="button" role="tab" x-on:click="activeTab = t.key" :aria-selected="activeTab === t.key"
                    :title="t.name" :aria-label="t.name"
                    class="pressable relative shrink-0 rounded-tile px-1.5 pb-1.5 pt-1 text-lg leading-none transition-colors"
                    :class="activeTab === t.key ? '' : 'opacity-70 hover:opacity-100'">
                <span x-text="t.icon"></span>
                <span x-show="activeTab === t.key"
                      class="absolute inset-x-1 -bottom-0.5 h-0.5 rounded-full bg-brand-700 dark:bg-brand-400"></span>
            </button>
        </template>
    </div>

    {{-- Emoji-Grid: nur das aktive Segment (aktiver Tab oder Suchtreffer).

         ZWEI Schleifen statt einer, und das ist der Grund, warum dieses Panel schnell
         aufgeht. Vorher lief EINE Schleife über `results` und entschied je Kachel per
         `<template x-if="e.custom">` / `<template x-if="!e.custom">` zwischen Bild und
         Zeichen. Gemessen: 171 Kacheln erzeugten 347 Template-Knoten, und der Aufbau
         dauerte 148 ms — bei nur 18 ms Modul-Eval und 0,6 ms Indizierung. Die Zeit lag
         also fast vollständig im Markup, nicht in den Daten. Jedes `<template>` ist
         eine eigene Alpine-Reaktivitätseinheit samt DOM-Klon; zwei je Kachel sind der
         teuerste Teil des Panels.

         Vorsortiert nach Darstellungsart braucht keine Kachel mehr eine Verzweigung.
         Custom zuerst: im Custom-Tab ist die zweite Liste leer, in den Standard-Tabs
         die erste, und nur bei aktiver Suche sind beide gefüllt — dort gehören die
         eigenen Emojis nach vorn. --}}
    <div class="grid max-h-48 grid-cols-8 gap-0.5 overflow-y-auto overscroll-contain pr-0.5"
         style="scrollbar-width: thin;" aria-live="polite">
        <template x-for="e in customResults" :key="':' + e.shortcode">
            <button type="button"
                    x-on:click="{!! $pick !!}"
                    :aria-label="{!! $pickLabel !!}"
                    :title="{!! $pickTitle !!}"
                    class="pressable flex aspect-square items-center justify-center rounded-tile text-xl leading-none hover:bg-brand-500/15">
                <img :src="e.src" :alt="e.shortcode" loading="lazy" class="size-6 object-contain" />
            </button>
        </template>
        <template x-for="e in standardResults" :key="e.u">
            <button type="button"
                    x-on:click="{!! $pick !!}"
                    :aria-label="{!! $pickLabel !!}"
                    :title="{!! $pickTitle !!}"
                    class="pressable flex aspect-square items-center justify-center rounded-tile text-xl leading-none hover:bg-brand-500/15">
                <span x-text="e.u"></span>
            </button>
        </template>
    </div>

    {{-- Zustände: Laden / leer. --}}
    <template x-if="!ready">
        <p class="py-6 text-center text-xs text-muted">{{ __('Emojis laden…') }}</p>
    </template>
    <template x-if="ready && !results.length">
        <p class="py-6 text-center text-xs text-muted"
           x-text="(activeTab === 'custom' && customTotal > 0) ? @js(__('Emojis laden…')) : (search.trim() ? (@js(__('Keine Treffer für „')) + search.trim() + '“') : @js(__('Keine Custom-Emojis in deinem Profil')))"></p>
    </template>
</div>
