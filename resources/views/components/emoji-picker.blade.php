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
            <template x-for="e in recent" :key="e.custom ? ':' + e.shortcode : e.u">
                <button type="button"
                        x-on:click="{!! $pick !!}"
                        :aria-label="{!! $pickLabel !!}"
                        :title="{!! $pickTitle !!}"
                        class="pressable flex size-9 shrink-0 items-center justify-center rounded-tile text-xl leading-none hover:bg-brand-500/15">
                    <template x-if="e.custom"><img :src="e.src" :alt="e.shortcode" loading="lazy" class="size-6 object-contain" /></template>
                    <template x-if="!e.custom"><span x-text="e.u"></span></template>
                </button>
            </template>
        </div>
    </template>

    {{-- Suchfeld: eigenes Styling (Flux passt hier nicht).

         `text-zinc-800 dark:text-white` statt `text-white`: im HELLEN Theme stand hier
         weißer Text auf der weißen Karte (`bg-white/5` über `surface-card` = #FFFFFF) —
         gemessen 1:1, also unsichtbar, während das Grid darunter munter filterte. Der
         Screenshot dazu liegt im Bericht. WCAG 1.4.3 verlangt 4.5:1; zinc-800 auf Weiß
         misst 14.7:1 und ist zugleich die Tinte, die die Icon-Knöpfe daneben tragen.
         Betrifft beide Modi der Komponente (Reagieren wie Einfügen) — die Reaktions-
         Ansicht war genauso betroffen, das ist kein Nebeneffekt, sondern derselbe Fehler.

         FLÄCHE UND KANTE (B14): vorher `border-white/10 bg-white/5`. Auf der weißen
         Karte komponieren BEIDE zu exakt #FFFFFF — das Feld hatte im hellen Theme
         keinerlei Grenze und las sich als Bildunterschrift über dem Grid, nicht als
         Eingabe. Die Werte hier sind nicht erfunden, sondern vom Eingabefeld dieser App
         abgelesen (Flux-Textarea im Composer, gemessen): hell `border-zinc-200`, dunkel
         `border-white/10 bg-white/10`. Dazu im hellen Theme eine leicht vertiefte
         Fläche (`bg-zinc-100`) — auf weißem Grund trägt die Kante allein zu wenig,
         auf dem grauen Seitengrund der App trägt sie. Damit sieht das Feld aus wie
         jedes andere Feld hier, statt wie eine Sonderlösung.

         Platzhalterfarbe als ausgeschriebenes Paar statt über die `text-muted`-Utility:
         die VERLIERT ihre Dark-Hälfte, sobald sie hinter einer weiteren Variante steht.
         Im gebauten Stylesheet stand für die Platzhalter-Variante wörtlich
         `::placeholder:where(){color:zinc-400}` — ein leeres `:where()` matcht nie, die
         `.dark`-Bedingung aus dem @custom-variant ist beim @apply verlorengegangen.
         Ergebnis war zinc-600 auf dem dunklen Feld: im Kalibrierlauf des Kontrast-Ankers
         gemessene 1,74:1 gegen die geforderten 4,5:1 (1.4.3) — auf der alten, dunkleren
         Feldfläche entsprechend noch etwas weniger. Dieselbe Lücke stand im
         Rail-Suchfeld (`desktop-rail.blade.php`, gemessen 1,94:1) und ist dort
         mitbehoben.

         Der kaputte Klassenname steht hier bewusst NICHT ausgeschrieben: Tailwind
         scannt Blade als reinen Text und erzeugt aus einem Kommentar echte Regeln —
         der erklärende Hinweis hielte die tote Regel sonst im gebauten CSS am
         Leben (nachgewiesen: nach dem Fix blieb sie allein wegen dieses Kommentars
         übrig). --}}
    <div class="relative">
        <svg class="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted"
             viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true">
            <circle cx="9" cy="9" r="6" /><path d="m14 14 4 4" stroke-linecap="round" />
        </svg>
        <input x-model.debounce.150ms="search" type="search"
               placeholder="{{ __('Emoji suchen…') }}" aria-label="{{ __('Emoji suchen') }}"
               class="w-full rounded-tile border border-zinc-200 bg-zinc-100 py-1.5 pl-8 pr-3 text-sm text-zinc-800 placeholder:text-zinc-600 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/40 dark:border-white/10 dark:bg-white/10 dark:text-white dark:placeholder:text-zinc-400" />
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

    {{-- Emoji-Grid: nur das aktive Segment (aktiver Tab oder Suchtreffer). --}}
    <div class="grid max-h-48 grid-cols-8 gap-0.5 overflow-y-auto overscroll-contain pr-0.5"
         style="scrollbar-width: thin;" aria-live="polite">
        <template x-for="e in results" :key="e.custom ? ':' + e.shortcode : e.u">
            <button type="button"
                    x-on:click="{!! $pick !!}"
                    :aria-label="{!! $pickLabel !!}"
                    :title="{!! $pickTitle !!}"
                    class="pressable flex aspect-square items-center justify-center rounded-tile text-xl leading-none hover:bg-brand-500/15">
                <template x-if="e.custom">
                    <img :src="e.src" :alt="e.shortcode" loading="lazy" class="size-6 object-contain" />
                </template>
                <template x-if="!e.custom"><span x-text="e.u"></span></template>
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
