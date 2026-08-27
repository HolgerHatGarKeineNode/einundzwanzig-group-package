@php
    // Geteilter Chat-Composer (P3): EINE Eingabezeile für Raum UND Thread. `$context`
    // ('room'|'thread') wählt Draft/Refs/Sende-Aktion; der Reply-Kontext + Send-Error bleiben
    // beim jeweiligen Caller (divergieren: Raum hat replyTo/editingId/sharing, Thread threadReplyTo).
    $isThread = $context === 'thread';
    $draft = $isThread ? 'threadDraft' : 'draft';
    $composerRef = $isThread ? 'threadComposer' : 'composer';
    $imageRef = $isThread ? 'threadImageInput' : 'imageInput';
    $attachment = $isThread ? 'threadAttachment' : 'attachment';
    $sendAction = $isThread ? 'sendComment()' : 'send()';
    $sendDisabled = $isThread
        ? "{$draft}.trim().length === 0 && !{$attachment}"
        : "sending || ({$draft}.trim().length === 0 && !sharing && !{$attachment})";

    // Welcher Composer die @-Vorschläge gerade füttert (`onComposerInput` merkt es
    // sich in `_mentionTarget`). Siehe die Begründung am Popover weiter unten.
    //
    // Ausgegeben wird der Ausdruck mit `{!! !!}`, nicht mit `{{ }}`: er enthält
    // `&&` und Apostrophe, die `{{ }}` zu `&amp;&amp;` bzw. `&#039;` escapte.
    // Im Browser fällt das nicht auf — der HTML-Parser dreht die Entities beim
    // Lesen des Attributs zurück, Alpine sieht wieder `&&`. Auffallen tut es
    // dem, der die Quelle liest, und dem Quelltext-Test in `ChatStatesTest`,
    // der genau diese Bedingung festhält. Eine Escape-Sequenz, die nur an
    // manchen Stellen sichtbar ist, ist der Anfang einer Suche nach dem
    // falschen Fehler.
    $mentionTarget = $isThread ? 'thread' : 'main';
    $mentionMine = "mentionOpen && _mentionTarget === '{$mentionTarget}'";
    // Ein Vorschlag in Worten — EINE Fassung für Zeilen-Label und Ansage.
    $beschreibung = fn (string $e): string => "[{$e}.name, {$e}.isAgent ? "
        . \Illuminate\Support\Js::from(__('Agent'))
        . " : null, {$e}.hint || null].filter(Boolean).join(', ')";
    $ausgewaehlt = 'mentionItems[mentionIndex]';
@endphp

{{-- Anhang-Vorschau: zugeschnittenes Bild wartet auf Senden.

     `previewUrl` (eine `data:`-URL aus den gerade zugeschnittenen Bytes, siehe
     `js/uploads.ts`) hat VORRANG vor `$img(url)`. Grund: auf einem Buzz-Space liegt der
     frische Upload unter `…/media/…` und ist auth-pflichtig; `$img()` gibt dafür
     bewusst `''` zurück (Wache in `js/mediaGuard.ts`), und die Kachel blieb leer — der
     Nutzer sah sein eigenes Bild nicht. Der Rückfall auf `$img()` bleibt für den
     Vereins-Blossom und für Anhänge ohne Vorschau-Bytes stehen.

     `data-composer` benennt den Kontext im DOM. Grund: beide Composer rendern
     dieselbe Vorschau mit demselben Text, und Tests unterschieden sie bisher über
     die DOM-REIHENFOLGE (`.first()`). Die ist mit der Desktop-Shell gekippt — der
     Thread-Composer sitzt seit dem Panel-Umbau IM Thread-Block und damit vor dem
     Raum-Composer. Eine Reihenfolge ist kein Vertrag; dieser Haken ist einer. --}}
<div x-show="{{ $attachment }}" x-cloak data-composer="{{ $context }}"
     class="surface-card mb-1 flex items-center gap-3 px-3 py-2">
    <img :src="{{ $attachment }}?.previewUrl || $img({{ $attachment }}?.url, 'msg')" alt="{{ __('Anhang-Vorschau') }}"
         class="size-14 shrink-0 rounded-tile object-cover" />
    <div class="min-w-0 flex-1 text-xs text-muted">{{ __('Bild angehängt') }}</div>
    <flux:button size="xs" variant="ghost" icon="x-mark" class="icon-btn-touch"
                 x-on:click="{{ $attachment }} = null" aria-label="{{ __('Anhang entfernen') }}" />
</div>

{{-- Verstecktes Datei-Feld → pickImage öffnet dasselbe Crop-Overlay in beiden Kontexten. --}}
<input type="file" accept="image/*" x-ref="{{ $imageRef }}" class="hidden"
       x-on:change="pickImage($event.target)" aria-hidden="true" tabindex="-1" />

<div class="relative flex items-end gap-2">
    {{-- @-Mention-Autocomplete (C4, geteilt): Pfeile wählen, Enter/Tab übernimmt, Escape schließt.
         pickMention splict in den richtigen Draft (onComposerInput merkt sich den Kontext).

         ── EIN Escape trägt GENAU EINE Schicht ab (2026-08-27) ──────────────────
         Die Escape-Zeile unten trägt `stopPropagation()`, und das ist keine
         Vorsorge: der Schaden war am gebauten Stand gemessen. Über diesem
         Composer liegt ein Fenster-Horcher (`⚡room.blade.php`,
         `x-on:keydown.escape.window="threadRootId && … && backFromThread()"`).
         Ohne die Zeile stieg dasselbe Ereignis dorthin auf, und `closeThread()`
         setzt `threadDraft = ''` und verwirft `threadAttachment` — ein
         Tastendruck, der die Vorschlagsliste wegklicken sollte, löschte den
         getippten Entwurf.

         Gemessen (Sonde 2026-08-27, zooid, Raum `welcome`, 1279 px UND 1440 px,
         beide gleich):
             vorher   threadRootId=283508…, threadDraft="Mein langer Entwurf @ali"
             nachher  threadRootId=null,     threadDraft=""

         Der `if (mentionOpen)`-Rahmen trägt die andere Hälfte: steht KEIN
         Vorschlag offen, läuft Escape durch und verlässt den Thread, wie es soll.
         Zwei Schichten, zwei Tastendrücke (Nielsen #3).

         **Der Cropper (`⚡room.blade.php:1150`) ist NICHT betroffen, und das
         gehört hierher, damit niemand ihn ohne Not „mitrepariert".**

         Die naheliegende Begründung wäre „die Zustände schliessen einander aus,
         das Overlay ist `aria-modal` und zieht den Fokus auf `cropConfirm`".
         **Sie ist gemessen FALSCH** — meine erste Sonde legte sie nahe, drei
         Wiederholungen haben sie widerlegt: bei gesetztem `_cropSrc` steht das
         Overlay sichtbar, `activeElement` bleibt aber über vier Sekunden das
         Textfeld hier, und ein Escape trifft nachweislich diesen Handler
         (Ereignis-Mitschnitt: `["textarea"]`, kein `window`).

         Der wahre Grund ist ein härterer: **der Thread-Horcher ist gegen genau
         diese Überlagerung gebaut.** Er trägt `!_cropSrc` in seiner eigenen
         Bedingung, und der Cropper ruft zusätzlich `stopImmediatePropagation`.
         Bei offenem Zuschnitt kann `backFromThread()` also gar nicht feuern.
         Nachgemessen im Thread, mit Entwurf und offenem Cropper:

             Escape 1  crop → null,  Thread bleibt, Entwurf bleibt
             Escape 2  Thread → null (keine Liste offen — so soll es sein)

         Auch das ist „eine Schicht pro Tastendruck", nur schon vorher richtig.

         Der Schwesterfall in der Forge (`js/forge.ts mentionKey`) ist am
         2026-08-27 aus demselben Grund gefixt worden; dort war es ein Regress
         aus P4. Der Riegel für BEIDE Hälften hier steht in
         `tests/e2e/chat-escape-schichtung.spec.ts`. --}}
    {{-- **Die Ansage, weil die kanonische Form hier verschlossen ist.**

         Das Muster für eine Vorschlagsliste an einem Eingabefeld ist die
         APG-Editable-Combobox: `role="combobox"` am Feld, `aria-expanded`,
         `aria-activedescendant`. Der Composer ist aber eine `<textarea>`, und für
         die gilt laut „ARIA in HTML" (W3C, geprüft 2026-08-23): „No `role` other
         than `textbox`". Ein `role="combobox"` wäre dort nicht konform, und
         `aria-expanded` hängt an genau dieser Rolle.

         Bleibt die höfliche Live-Region: sie sagt beim Öffnen und bei jedem Pfeil,
         WAS ausgewählt ist und an welcher Stelle. Sie steht AUSSERHALB des `x-if`
         und ist damit schon da, bevor Text hineinkommt — eine Live-Region, die
         gemeinsam mit ihrem Inhalt entsteht, wird von mehreren Screenreadern
         verschluckt. --}}
    <div class="sr-only" role="status" aria-live="polite" data-mention-ansage="{{ $context }}"
         x-text="{!! $mentionMine !!} && {!! $ausgewaehlt !!}
             ? {!! \Illuminate\Support\Js::from(__('Vorschlag :position von :anzahl: :eintrag')) !!}
                 .replace(':position', mentionIndex + 1)
                 .replace(':anzahl', mentionItems.length)
                 .replace(':eintrag', () => {!! $beschreibung($ausgewaehlt) !!})
             : ''"></div>

    <template x-if="{!! $mentionMine !!}">
        {{-- `data-mention-popover` grenzt die Vorschläge im DOM ab. Ohne den Haken
             träfe ein `getByText('…')` im Negativbeweis auch die Mitgliederliste der
             Seite, und „im Popover steht kein Agent" wäre nicht von „auf der Seite
             steht der Name nirgends" zu unterscheiden.

             Der WERT ist der Kontext, nicht bloß ein Marker — und die Bedingung
             oben trägt denselben Kontext ein zweites Mal. Grund: `mentionOpen` ist
             EIN Zustand für beide Composer; bis 2026-08-23 stand bei offenem
             Popover deshalb IMMER ein zweiter, identischer Block im DOM (der des
             anderen Composers). Beim Bau der Spec traf `.first()` genau den
             unsichtbaren — der Test meldete „hidden" und sah aus wie ein
             Produktfehler. Solange die Liste nur `div` war, war das ein reines
             Test-Ärgernis. Mit `role="listbox"` wird daraus ein zweites,
             wortgleiches Listenfeld im Barrierefreiheitsbaum, sobald das
             Thread-Panel offen ist. `_mentionTarget` weiß, welcher Composer
             gerade tippt (`onComposerInput` setzt es); nur der zeigt seine Liste. --}}
        <div data-mention-popover="{{ $context }}" role="listbox" aria-label="{{ __('Vorschläge für die Erwähnung') }}"
             class="surface-card absolute bottom-full left-0 z-30 mb-1 max-h-56 w-full max-w-xs overflow-y-auto rounded-card p-1 shadow-xl"
             x-on:click.stop>
            <template x-for="(item, i) in mentionItems" :key="item.pubkey">
                {{-- `data-agent` ist der Haken für die Tests: ein Agentenvorschlag darf
                     auf einem zooid-Space GAR NICHT entstehen, und „gar nicht" ist nur
                     prüfbar, wenn die Zeile im Ja-Fall ein eigenes Merkmal trägt.

                     `x-effect` + `scrollIntoView`: die Liste ist auf `max-h-56`
                     gedeckelt (224 px), eine Zeile ist 48 px hoch — sichtbar sind
                     gut vier von bis zu dreizehn Einträgen (5 Agenten + 8 Menschen,
                     getrennte Deckel). Ohne diese Zeile blieb `scrollTop` beim
                     Blättern auf 0: ab dem fünften Pfeildruck wanderte die Auswahl
                     aus dem Fenster und der Nutzer blätterte blind (gemessen
                     2026-08-23: ab Index 4 außerhalb, scrollHeight 595 zu
                     clientHeight 224). `block: 'nearest'` scrollt nur, wenn nötig,
                     und zieht keine Vorfahren mit. --}}
                <button type="button" x-on:click="pickMention(item)" x-on:mouseenter="mentionIndex = i"
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
                        role="option" tabindex="-1" :aria-selected="mentionIndex === i ? 'true' : 'false'"
                        :aria-label="{!! $beschreibung('item') !!}"
                        x-effect="mentionIndex === i && $el.scrollIntoView({ block: 'nearest' })"
                        class="pressable flex w-full items-center gap-2 rounded-tile px-2 py-1.5 text-left"
                        :data-agent="item.isAgent ? 'true' : null"
                        :class="mentionIndex === i ? 'bg-brand-500/15' : ''">
                    <x-group::nostr-avatar picture="item.picture" name="item.name" />
                    <span class="min-w-0 flex-1">
                        <span class="block truncate text-sm" x-text="item.name"></span>
                        {{-- Der Schlüssel gehört zum Agentenvorschlag wie der Name:
                             ein 10100 ist selbstsigniert, zwei Einträge dürfen „ceo"
                             heißen, und welcher der gemeinte Prozess ist, sagt allein
                             der Schlüssel. Begründung an `MentionItemLike.hint`.

                             `text-xs` (12 px) statt `text-[10px]`: 10 px steht auf
                             keiner Stufe der Haus-Typoskala, und der Schlüssel ist
                             hier nicht Beiwerk, sondern das einzige Merkmal, an dem
                             zwei gleichnamige Einträge auseinandergehen. 12 px zeigt
                             dieses Haus einen npub ohnehin schon
                             (`login-form.blade.php:33`). --}}
                        <template x-if="item.hint">
                            <span class="block truncate font-mono text-xs text-muted" x-text="item.hint"></span>
                        </template>
                    </span>
                    {{-- Erkennbar als Maschine: der Vorschlag verhält sich beim Senden wie
                         jeder andere, aber am anderen Ende antwortet ein Prozess.

                         `text-brand-800` statt `text-brand-600`: gemessen am
                         gerenderten Chip stand brand-600 auf der getönten Fläche bei
                         **2,36:1** (markierte Zeile) bzw. 2,63:1 (unmarkiert) — WCAG
                         1.4.3 verlangt 4,5:1. Die beiden `brand-500/15`-Schichten
                         (Zeilenmarkierung UND Chipfläche) addieren sich unter dem
                         Text; brand-800 hält 5,12:1 bzw. 5,72:1. Der Dunkelzweig war
                         nie betroffen (6,61:1). --}}
                    <template x-if="item.isAgent">
                        <span aria-hidden="true"
                              class="shrink-0 rounded-full bg-brand-500/15 px-1.5 py-0.5 text-xs font-semibold uppercase tracking-wide text-brand-800 dark:text-brand-300"
                              title="{{ __('Headless Agent — antwortet auf Erwähnung') }}">{{ __('Agent') }}</span>
                    </template>
                </button>
            </template>
        </div>
    </template>

    @if ($isThread)
        {{-- Thread: nur Bild anhängen. Umfrage/Zap-Ziel sind raum-scoped (eigene Kinds 1068/9041,
             keine thread-Standard-Verankerung) → hier bewusst nicht. --}}
        <flux:button type="button" variant="ghost" icon="photo" class="shrink-0 icon-btn-touch"
                     x-on:click="$refs.{{ $imageRef }}.click()" aria-label="{{ __('Bild anhängen') }}" />
    @else
        {{-- Raum: „+"-Menü bündelt Bild + Umfrage + Zap-Ziel (spart Composer-Platz). --}}
        <flux:dropdown position="top" align="start" class="shrink-0">
            <flux:button type="button" variant="ghost" icon="plus" class="icon-btn-touch" aria-label="{{ __('Anhängen') }}" />
            <flux:menu>
                <flux:menu.item icon="photo" x-on:click="$refs.{{ $imageRef }}.click()">{{ __('Bild') }}</flux:menu.item>
                <flux:menu.item icon="chart-bar" x-on:click="openPollCreate()">{{ __('Umfrage') }}</flux:menu.item>
                <template x-if="zapsEnabled">
                    <flux:menu.item icon="trophy" x-on:click="openGoalCreate()">{{ __('Zap-Ziel') }}</flux:menu.item>
                </template>
            </flux:menu>
        </flux:dropdown>
    @endif

    {{-- Emoji-Picker für den ENTWURF (C1). Nur wo mit einem echten Zeigegerät bedient
         wird und nicht in der nativen App — auf Touch liefert die Systemtastatur
         Emojis, ein Knopf wäre dort doppelt.

         `x-if` und nicht `hidden`/`x-show`: der Picker lädt emojibase nach und mountet
         ein Grid mit hunderten Knoten. Ein per CSS verstecktes `x-data` bootet trotzdem
         mit (derselbe Grund, aus dem die Rail an `$store.viewport.desktop` per x-if
         hängt — siehe viewport.ts). `$store.viewport.mouse` ist die Bedienungs-, nicht
         die Breitenfrage: ein breites Tablet ist Desktop-Layout und trotzdem Touch.

         Konstruktion wie der Reaktions-Picker der Zeile: Panel ans <body> teleportiert
         (der Composer-Container würde es abschneiden), `fixed` positioniert und nach
         OBEN aufgeklappt (reactionPopover kippt nur nach unten, wenn oben kein Platz
         ist). `reactionPopover` ist trotz des Namens der generische Panel-Positionierer;
         nicht umbenannt, weil das den Reaktionspfad angefasst hätte.

         `align: 'start'` — dieser Trigger sitzt am LINKEN Rand des Composers, der
         Reaktions-Trigger am rechten Ende einer Zeile. Mit dem Default (`'end'`,
         rechtsbündig, nach links auslaufend) lag das Panel im Desktop-Chassis zu
         189 von 354 px über der Navigations-Rail und bei 1279 px zu zwei Dritteln
         im leeren Seitenrand — es gehörte optisch zu allem außer zu seinem Knopf.
         Linksbündig wächst es in die Chat-Spalte, bündig zur Knopfkante. --}}
    <template x-if="$store.viewport.mouse">
        <div x-data="reactionPopover({ align: 'start' })" x-on:click.stop class="shrink-0">
            {{-- `::aria-expanded` (nicht `:aria-expanded`): auf einer flux:-Komponente
                 hielte Blade das einfache `:` für seine eigene PHP-Bindung. Der
                 Aufklapp-Zustand gehört an den Knopf (ARIA-APG Disclosure) — ohne ihn
                 meldet der Screenreader denselben Knopf offen wie geschlossen.
                 `text-brand-*!` mit Bang: Flux' eigenes `text-zinc-800 dark:text-white`
                 steht bei gleicher Spezifität im gebauten Stylesheet HINTER den
                 brand-Farben (Reihenfolge der @theme-Deklaration) und gewänne sonst. --}}
            <flux:button type="button" x-ref="trigger" variant="ghost" icon="face-smile" class="icon-btn-touch"
                         x-on:click="toggle()" ::aria-expanded="open"
                         ::class="open ? 'text-brand-700! dark:text-brand-400!' : ''"
                         aria-label="{{ __('Emoji einfügen') }}" />
            {{-- x-if (lazy-mount) + x-teleport getrennt verschachteln — beides auf EINEM
                 template teleportiert bei jedem Tick neu (Leak). --}}
            <template x-if="open">
                <div>
                    <template x-teleport="body">
                        {{-- x-on:click.stop: nach <body> teleportiert ist der .stop-Wrapper
                             kein Vorfahre mehr → ohne .stop schlösse ein Klick im Picker das
                             Thread-Overlay (click.outside).

                             x-init, zwei Dinge:
                             1. Fokus ins Suchfeld. Das Panel hängt am ENDE des <body> und
                                damit hinter allem in der Tab-Reihenfolge; ohne diesen Schritt
                                tabbt man aus dem Knopf erst durch Textarea und Senden. Escape
                                gibt den Fokus an den Knopf zurück (APG), sonst landete er am
                                Seitenanfang.
                             2. ResizeObserver → reposition(). Zweiter Gurt, nicht der Träger:
                                seit reposition() das nach oben öffnende Panel an seiner
                                UNTERkante verankert, überlebt eine Höhenänderung (Ladezustand →
                                volles Grid, Suchfilter, MRU-Reihe) die Position von selbst — die
                                Panelhöhe steht gar nicht mehr in der Rechnung (Begründung am
                                reactionPopover in bridge.ts). Der Beobachter deckt noch, was
                                dort nicht hingehört: eine Trigger-Bewegung, während das Panel
                                offen ist (Composer wächst beim Tippen mit). Er ruft dieselbe
                                Rechnung erneut auf; sie ist idempotent. Die globale Loop-Bremse
                                für ResizeObserver steht in bridge.ts
                                (installResizeObserverLoopFilter). --}}
                        <div x-ref="panel" x-transition.opacity :style="panelStyle"
                             x-on:click.stop
                             x-on:click.outside="closeUnless($event)"
                             x-on:keydown.escape.window="open = false; $refs.trigger?.focus()"
                             x-init="$nextTick(() => $el.querySelector('input[type=search]')?.focus());
                                     new ResizeObserver(() => reposition()).observe($el)"
                             class="surface-card fixed z-50 rounded-card p-2 shadow-xl">
                            <x-group::emoji-picker mode="insert" target="{{ $isThread ? 'thread' : 'main' }}"
                                                   onpick="open = false" />
                        </div>
                    </template>
                </div>
            </template>
        </div>
    </template>

    {{-- Ab xl eine Spur größer (15px statt 14px). NUR auf Desktop: eine Schriftgröße
         im Chat zu ändern verschiebt Zeilenumbrüche und damit die Scroll-Arithmetik
         (`atBottom`, Chip-Lane-Reservierung) — mobil bleibt es deshalb bei 14px, bis
         das jemand eigens misst. --}}
    <flux:textarea x-ref="{{ $composerRef }}" x-model="{{ $draft }}" rows="1" resize="none" class="flex-1 xl:text-[0.9375rem]"
                   placeholder="{{ $isThread ? __('Im Thread antworten…') : __('Nachricht schreiben…') }}"
                   aria-label="{{ $isThread ? __('Antwort schreiben') : __('Nachricht schreiben') }}"
                   x-on:focus="{!! $isThread ? '' : 'atBottom && scrollToBottom()' !!}"
                   x-on:input="autoGrow($event.target); sendError = ''; onComposerInput($event.target, '{{ $isThread ? 'thread' : 'main' }}')"
                   x-on:paste="pasteImage($event)"
                   x-on:keydown="
                       if (mentionOpen) {
                           if ($event.key === 'ArrowDown') { $event.preventDefault(); mentionIndex = (mentionIndex + 1) % mentionItems.length; return }
                           if ($event.key === 'ArrowUp') { $event.preventDefault(); mentionIndex = (mentionIndex - 1 + mentionItems.length) % mentionItems.length; return }
                           if ($event.key === 'Enter' || $event.key === 'Tab') { $event.preventDefault(); pickMention(mentionItems[mentionIndex]); return }
                           if ($event.key === 'Escape') { $event.preventDefault(); $event.stopPropagation(); closeMentions(); return }
                       }
                       if ($event.key === 'Enter' && !$event.shiftKey && !isMobile) { $event.preventDefault(); {{ $sendAction }} }" />

    {{-- {!! !!} bei ::disabled: die Expression enthält `&&`; {{ }} würde es zu `&amp;&amp;`
         escapen und Alpines Ausdruck brechen. Send-Button gesplittet, weil inline-@if IN einem
         flux-Tag den Flux-Attribut-Parser bricht (Raum: Loading-Spinner; Thread: ohne). --}}
    @if ($isThread)
        <flux:button type="button" variant="primary" icon="paper-airplane" class="icon-btn-touch"
                     x-on:click="{{ $sendAction }}" ::disabled="{!! $sendDisabled !!}"
                     aria-label="{{ __('Antwort senden') }}" />
    @else
        <flux:button type="button" variant="primary" icon="paper-airplane" class="icon-btn-touch" :loading="true"
                     x-on:click="{{ $sendAction }}" ::data-loading="sending" ::disabled="{!! $sendDisabled !!}"
                     aria-label="{{ __('Senden') }}" />
    @endif
</div>
