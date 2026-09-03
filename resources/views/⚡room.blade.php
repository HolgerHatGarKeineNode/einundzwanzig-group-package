<?php

use Einundzwanzig\Group\ImageProxy;
use Einundzwanzig\Group\Nostr\SpaceCache;
use Illuminate\Support\Facades\View;
use Livewire\Attributes\Layout;
use Livewire\Component;

/**
 * Raum-Chat als Livewire-SFC. `$h` (Raum-ID) kommt aus dem Routen-Parameter und
 * wird via `@js($h)` an die welshman/Alpine-Insel gereicht — die einzige
 * Server→Insel-Übergabe; der ganze Chat-Zustand lebt clientseitig.
 *
 * Titel + OG-Beschreibung kommen aus dem server-seitigen Read-Cache (§10/M7):
 * server-gerenderter `<head>` für Crawler/Share-Previews, ohne die client-seitige
 * Architektur zu berühren. Cache-Miss = Fallback auf die rohe Raum-ID.
 */
new #[Layout('group::einundzwanzig')] class extends Component
{
    public string $h;

    public ?string $roomName = null;

    public string $roomAbout = '';

    public string $roomPicture = '';

    public ?string $ogImage = null;

    // Optionale Thread-Referenz aus /rooms/{h}/thread/{nevent} — die Insel öffnet
    // beim Setup den Thread als Vollansicht (direkt verlinkbarer Deep-Link, C6b).
    public ?string $nevent = null;

    public function mount(string $h, SpaceCache $cache, ?string $nevent = null): void
    {
        $this->h = $h;
        $this->nevent = $nevent;
        // Welcher Space trägt diesen Raum? `?space=workspace` an der URL zeigt auf den
        // zweiten Space (siehe `js/spaceParam.ts`) — ohne diese Weiche schlüge der
        // Cache-Blick immer im Vereins-Space nach, und ein Workspace-Raum trüge im
        // Kopf/OG-Tag seine rohe UUID statt seines Namens.
        $url = SpaceCache::urlForSpaceParam(request()->query('space'));
        $room = $cache->rooms($url)[$h] ?? null;
        $this->roomName = $room['name'] ?? null;
        $this->roomAbout = $room['about'] ?? '';
        $this->roomPicture = $room['picture'] ?? '';
        // OG-Bild: Raum-picture, sonst Space-icon (NIP-11); absolut für Crawler.
        $pic = $this->roomPicture ?: $cache->relayInfo($url)['icon'];
        $this->ogImage = $pic ? url(ImageProxy::url($pic, 'og')) : null;
    }

    public function render()
    {
        View::share('ogDescription', $this->roomAbout ?: null);
        View::share('ogImage', $this->ogImage);

        return $this->view()->title('# '.($this->roomName ?? $this->h));
    }
}; ?>

@php
    $jsVar1 = __('Durchsucht wird nur der geladene Verlauf dieses Raums: :count Nachrichten.'); $jsVar2 = __(':total Treffer im geladenen Verlauf (:count Nachrichten durchsucht).'); $jsVar3 = __('Gezeigt werden die neuesten :limit Treffer — grenze die Suche weiter ein.'); $jsVar4 = __('Angepinnt'); $jsVar5 = __('Angepinnt (:count)'); $jsVar6 = __('Angepinnte Nachrichten zeigen'); $jsVar7 = __('Angepinnte Nachrichten ausblenden'); $jsVar8 = __('Nachricht wird geladen…'); $jsVar9 = __('Trete bei…'); $jsVar10 = __('Beitreten'); $jsVar11 = __('Nachricht bearbeiten'); $jsVar12 = __('Zitieren'); $jsVar13 = __('Antwort an :name'); $jsVar14 = __('Prüfe …'); $jsVar15 = __('Sende…'); $jsVar16 = __('Trotzdem zahlen'); $jsVar17 = __('Zap senden'); $jsVar18 = __('Rechnung kopiert.'); $jsVar19 = __('Option :n verschieben'); $jsVar20 = __('Erstelle…'); $jsVar21 = __('Erstellen'); $jsVar22 = __('Frei'); $jsVar23 = __('Lade hoch…'); $jsVar24 = __('Anhängen'); $jsVar25 = __('Event-Link kopiert.'); $jsVar26 = __('npub kopiert.'); $jsVar27 = __('JSON kopiert.');
@endphp

{{-- Chat-Bühne: Kopf + Verlauf + Composer unter EINEM Alpine-Scope (M4 lesen, M5 schreiben).

     `app-frame` ist seit der Desktop-Shell die Wurzel — auch hier, obwohl der Raum
     KEINE `app-shell` trägt (er ist eine chrome-lose Detail-Ebene, siehe unten).
     Genau deshalb sind Frame und Shell zwei Bauteile: der Navigator gehört an
     BEIDE Wurzeln, die Bottom-Bar nur an eine. Unterhalb xl rendert `app-frame`
     nur `contents` → das DOM ist zeichengleich zu vorher, und Livewire sieht
     weiterhin genau eine Wurzel. --}}
<x-group::app-frame>
{{-- `2xl:me-[28rem]` bei offenem Thread: ab 1536px ist Platz für beide Spalten
     NEBENEINANDER — die Bühne rückt zur Seite, statt sich verdecken zu lassen.
     Zwischen 1280 und 1535px bleibt das Panel bewusst ein Overlay: dort fiele die
     Nachrichtenspalte sonst unter ihr Textmaß, und ein zu schmaler Verlauf ist
     schlechter als ein teilweise verdeckter. --}}
<div x-data="nostrRoomChat(@js($h), @js($roomName ?? $h), @js($nevent))"
     :class="threadRootId ? '2xl:me-[28rem]' : ''"
     class="mx-auto flex h-dvh w-full max-w-md md:max-w-lg lg:max-w-2xl flex-col px-4 pt-[max(env(safe-area-inset-top),1rem)] pb-[max(env(safe-area-inset-bottom),1rem)] xl:mx-0 xl:h-full xl:min-h-0 xl:max-w-none xl:px-8 xl:pt-6 xl:transition-[margin] xl:duration-200 2xl:px-12">

    {{-- P2: Der Raum ist eine chrome-lose Detail-Ebene (kein Tab, keine Bottom-Nav)
         und rendert daher den globalen Signer/Reconnect-Strip selbst — die app-shell
         (die ihn sonst trägt) fehlt hier bewusst. `fixed` → kein Flex-Einfluss,
         liegt im Root-Div (Livewire-SFC: genau eine Wurzel). --}}
    <x-group::status-strip />

    {{-- EIN geteilter Kopf für Raum UND Thread (der Thread ERBT die Shell, ist kein eigenes
         Overlay): Titel, Zurück-Aktion und Actions wechseln nur reaktiv per `threadRootId`.
         Dadurch bewegt sich der Zurück-Button nie, der Hintergrund ist identisch und es gibt
         KEIN Überblenden beim Wechsel Raum↔Thread — es ist dieselbe DOM-Shell.
         `titleExpr`: im Thread „# Raum · Thread", sonst „# Raum". `backExpr`: im Thread zurück
         in den Raum (warm, backFromThread), sonst per Livewire.navigate zur Raumliste. --}}
    @php
        // json_encode (NICHT Js::from): app-header echot titleExpr/backExpr via `{{ }}` — Js::from
        // wäre bereits attributsicher und würde hier ein zweites Mal escaped. json_encode liefert
        // ein rohes JS-String-Literal ("…"), das `{{ }}` genau EINMAL escaped (wie der Raum-Titel zuvor).
        $hashName = json_encode('# ').' + roomName';
        // ':room · Thread' ist EIN Schlüssel (er steht schon im Katalog, `js/updates.ts`
        // benutzt ihn) statt „# Raum" + „ · Thread" — sonst legte die deutsche Stellung
        // fest, auf welcher Seite des Trenners der Raumname steht.
        // `.split().join()`, weil `roomName` aus einem fremden 39000 kommt.
        $titleExpr = 'threadRootId ? ('.json_encode(__(':room · Thread')).'.split('.json_encode(':room').').join('.$hashName.')) : ('.$hashName.')';
        // Zwei getrennte Rückwege, die NICHT vertauscht werden dürfen:
        //  - Thread offen → backFromThread(): warmer In-Place-Abbau. Der Thread pusht
        //    bewusst keinen History-Eintrag, ein history.back() spränge hier am Raum
        //    vorbei direkt in die Übersicht (gemessen 2026-07-22).
        //  - sonst → backFromRoom(<UP-Ziel>): history.back(), wenn dieser Tab einen
        //    App-internen Vorgänger hat (dann kommt die Übersicht samt Filter aus der
        //    URL zurück), sonst Livewire.navigate auf das UP-Ziel (Deep-Link-Kaltstart).
        // Das UP-Ziel ist seit P4 DATUM, keine Konstante: `originHref()` liest die
        // Herkunft aus `?from=` (Whitelist updates|spaces|room) — wer aus „Neu" hierher
        // gesprungen ist, will nach „Neu" zurück. Ohne/mit ungültigem Parameter bleibt
        // es bei der Raumliste, die deshalb weiterhin aus route() kommt und nicht als
        // zweites Literal im JS steht.
        $backExpr = 'threadRootId ? backFromThread() : backFromRoom(originHref('.json_encode(route('group.spaces')).'))';
    @endphp
    <x-group::app-header :title="'# '.($roomName ?? $h)" :title-expr="$titleExpr" :back-expr="$backExpr"
                         back-class="xl:hidden" class="shrink-0">
        @if ($roomPicture)
            <x-slot:leading>
                <flux:avatar circle size="sm" src="{{ \Einundzwanzig\Group\ImageProxy::url($roomPicture) }}" name="{{ $roomName ?? $h }}" />
            </x-slot:leading>
        @endif
        <x-slot:subtitle>
            {{-- Im Thread: Antwort-Zahl unter dem Titel (gleiche Singular/Plural-Logik wie zuvor). --}}
            <span x-show="threadRootId" x-cloak class="text-xs text-muted"
                  x-text="$plural(threadCount, '1 Antwort', ':count Antworten')"></span>
            {{-- Herkunft, aber nur wenn sie überrascht: `spaceHint` ist LEER, solange der Raum
                 im Vereins-Space liegt — für so gut wie jeden Raum ändert sich hier nichts.
                 Steht der Nutzer dagegen in einem Workspace-Raum, sagte ihm bis hierher
                 nichts, wo er ist: der Kopf zeigt nur `# Raumname`, und der Navigator trägt
                 oben weiter den Vereins-Space (am 1440px-Lauf gemessen). --}}
            <span x-show="!threadRootId && spaceHint" x-cloak data-space-hint
                  class="truncate text-xs text-muted" x-text="spaceHint"></span>
        </x-slot:subtitle>
        <x-slot:actions>
            {{-- Suche im geladenen Verlauf (P6a). Der Knopf steht im Kopf, die Fläche unten in
                 der Verlaufsspalte — deshalb ein Ereignis statt eines geteilten Zustands
                 (dasselbe Muster wie `open-command-palette` aus der Bottom-Bar).
                 Sichtbar genau dann, wenn die Verlaufsspalte selbst sichtbar ist: unterhalb xl
                 verdrängt ein offener Thread den Verlauf, und eine Suche, deren Ergebnisliste
                 hinter einem Thread liegt, wäre ein Knopf ins Nichts. --}}
            {{-- `aria-expanded`/Aktiv-Zustand hängen an einer MELDUNG der Insel
                 (`room-search-state`), nicht an einem zweiten eigenen Schalter: der Knopf
                 steht ausserhalb ihres Scopes und wüsste sonst nichts davon, wenn die
                 Fläche über Escape oder ✕ zugeht. Statisches `aria-expanded="false"` steht
                 im Markup, damit es vor dem Alpine-Boot stimmt (gleiche Begründung wie
                 `role`/`aria-modal` am Thread-Panel weiter unten). --}}
            <flux:button size="xs" variant="ghost" icon="magnifying-glass" square class="icon-btn-touch"
                         x-show="!threadRootId || $store.viewport?.desktop" x-cloak
                         x-data="{ expanded: false }"
                         x-on:room-search-state.window="expanded = $event.detail.open"
                         aria-expanded="false" aria-controls="room-search-panel"
                         x-bind:aria-expanded="expanded ? 'true' : 'false'"
                         x-bind:class="expanded ? 'bg-brand-500/15 text-brand-500!' : ''"
                         x-on:click="$dispatch('open-room-search')" aria-label="{{ __('Im Raum suchen') }}" />
            {{-- Mitglied → Verlassen (kind 9022). Nur im Raum, nicht im Thread. Beitreten liegt beim Composer. --}}
            <flux:button size="xs" variant="ghost" icon="arrow-right-start-on-rectangle" class="icon-btn-touch"
                         x-show="joined && !threadRootId" x-cloak x-on:click="leave()" ::disabled="joining" aria-label="{{ __('Raum verlassen') }}">
                {{ __('Verlassen') }}
            </flux:button>
        </x-slot:actions>
    </x-group::app-header>

    {{-- Raum-Feed. Unterhalb xl: nur sichtbar, wenn KEIN Thread offen ist — der Thread
         tauscht denselben Mittelbereich, teilt aber Kopf + Bühne (identisches Layout,
         kein Overlay, kein Überblenden).
         Ab xl: IMMER sichtbar. Der Thread legt sich als eigene Spalte rechts daneben,
         und ein Feed, der beim Öffnen einer Antwort verschwindet, wäre auf einem
         Monitor mit 1900px Breite eine Zumutung — genau der mobile Reflex, der auf
         Desktop schlecht altert. --}}
    <div x-show="!threadRootId || $store.viewport?.desktop" class="relative flex min-h-0 flex-1 flex-col">

        {{-- ── Suche im geladenen Verlauf (P6a) ────────────────────────────────────────
             Eigene Insel (`js/roomSearch.ts`), kein Zustand in `nostrRoomChat` — wie
             Befehlspalette (P4) und Darstellungs-Schalter (P5). Sie steht IMMER im DOM
             (nur die Fläche darin ist geschaltet), weil sie sonst das Öffnen-Ereignis aus
             dem Kopf gar nicht hören könnte.

             Die einzige Naht zur Rauminsel ist `scrollToMessage(hit.id)` weiter unten: eine
             bestehende Methode über die Scope-Kette, genau wie sie die Zitat-Vorschau in
             `chat-row` schon benutzt.

             Es wird KEIN Relay gefragt — weder beim Öffnen noch beim Tippen. Gesucht wird im
             Speicher, in derselben Menge, die der Verlauf darunter rendert (Begründung im
             Kopf von `js/roomSearch.ts`). Deshalb ist „nichts gefunden" hier auch keine
             Aussage über den Raum, sondern nur über den geladenen Ausschnitt — und genau das
             steht unter dem Feld, nicht in einer Fußnote. --}}
        <div x-data="nostrRoomSearch(@js($h))"
             x-on:open-room-search.window="toggle(); $nextTick(() => open && $refs.searchInput?.focus())"
             class="shrink-0">
            <div x-show="open" x-cloak x-transition.opacity.duration.150ms
                 id="room-search-panel" role="search"
                 x-on:keydown.escape.stop.prevent="close()"
                 class="surface-card mb-2 flex flex-col gap-1.5 p-2">

                <div class="flex items-center gap-2">
                    {{-- Wrapper-Div: `flux:input` reicht alles ausser `class` an das innere
                         <input> durch (Stub `flux/input/index.blade.php`), die Breite muss
                         also aussen sitzen. `x-ref` landet dagegen genau richtig, nämlich
                         auf dem <input> selbst (gleiches Vorgehen wie in ⚡directory). --}}
                    <div class="min-w-0 flex-1">
                        {{-- `class:input` statt `class`: der Stub legt `class` an die HÜLLE
                             und nur `class:input` ans <input>. Was hier hin muss, ist das
                             Abschalten der browsereigenen Löschtaste von `type="search"` —
                             sonst stünden drei Knöpfe nebeneinander, von denen zwei dasselbe
                             tun (die native, unbeschriftete und die eigene daneben). Bewusst
                             hier und nicht in `theme.css`: die Rail und der Emoji-Filter
                             benutzen dieselbe Eingabeart OHNE eigenen Löschknopf, dort ist
                             die native Taste die einzige. --}}
                        <flux:input type="search" size="sm" icon="magnifying-glass"
                                    class:input="[&::-webkit-search-cancel-button]:hidden"
                                    x-ref="searchInput" x-model="query"
                                    autocomplete="off" autocorrect="off" spellcheck="false"
                                    placeholder="{{ __('Nachricht finden…') }}"
                                    aria-label="{{ __('Im Raum suchen') }}" />
                    </div>
                    {{-- Eigener Leeren-Knopf statt Flux' `clearable`: dessen Beschriftung
                         kommt aus Flux' eigenem Katalog („Clear input", `input/clearable`)
                         und liegt damit ausserhalb unserer Sprachdateien — ein englisches
                         Label mitten in einer deutschen Fläche. Eigenes Symbol, nicht
                         zweimal `x-mark`: leeren und schliessen stünden sonst zeichengleich
                         nebeneinander. --}}
                    <flux:button size="sm" variant="ghost" icon="backspace" square class="icon-btn-touch shrink-0"
                                 x-show="query !== ''" x-cloak x-on:click="clear(); $refs.searchInput?.focus()"
                                 aria-label="{{ __('Eingabe leeren') }}" />
                    <flux:button size="sm" variant="ghost" icon="x-mark" square class="icon-btn-touch shrink-0"
                                 x-on:click="close()" aria-label="{{ __('Suche schließen') }}" />
                </div>

                {{-- Die Grenze, immer sichtbar — auch bei null Treffern und auch ohne Eingabe.
                     `role="status"` meldet sie zusätzlich dem Screenreader, sobald sich die
                     Zahl ändert. Sie nennt den GEMESSENEN Umfang des geladenen Verlaufs;
                     der Kaltstart-Cache liefert davon höchstens 300 Nachrichten je Raum und
                     nichts älter als 30 Tage (`js/storage.ts:138-139`), im Laufe der Sitzung
                     wächst er durch Nachladen. Deshalb steht hier die laufende Zahl und nicht
                     die Konstante — sie wäre nur beim Kaltstart wahr. --}}
                <p role="status" class="px-1 text-xs text-muted"
                   x-text="query.trim() === ''
                       ? @js($jsVar1).replace(':count', searched)
                       : @js($jsVar2).replace(':total', total).replace(':count', searched)"></p>

                {{-- Null Treffer ist NICHT „gibt es nicht". Der Satz sagt, was fehlt und was
                     dagegen hilft — Nachladen passiert beim Hochscrollen von selbst. --}}
                <p x-show="query.trim() !== '' && total === 0" x-cloak class="px-1 text-xs text-muted">
                    {{ __('Ältere Nachrichten sind erst durchsuchbar, wenn sie geladen sind — scroll dazu im Verlauf nach oben.') }}
                </p>

                <p x-show="capped" x-cloak class="px-1 text-xs text-muted"
                   x-text="@js($jsVar3).replace(':limit', limit)"></p>

                {{-- Trefferliste. Gedeckelte Höhe: die Fläche sitzt ÜBER dem Verlauf und darf
                     ihn nicht verdrängen. Klick springt in den Verlauf und lässt die Liste
                     stehen — wer sucht, prüft meist mehr als einen Treffer. --}}
                <ul x-show="hits.length > 0" x-cloak class="max-h-64 overflow-y-auto">
                    <template x-for="hit in hits" :key="hit.id">
                        <li>
                            <button type="button" x-on:click="scrollToMessage(hit.id)"
                                    class="pressable block w-full rounded-tile px-2 py-1.5 text-left hover:bg-brand-500/5">
                                <span class="flex items-baseline gap-2">
                                    <span class="min-w-0 truncate text-xs font-semibold">
                                        <template x-for="(seg, i) in hit.nameSegments" :key="i">
                                            <span :class="seg.hit ? 'rounded-sm bg-brand-500/25' : ''" x-text="seg.text"></span>
                                        </template>
                                    </span>
                                    <span class="ms-auto shrink-0 font-mono text-[0.7rem] text-muted" x-text="hit.time"></span>
                                </span>
                                <span class="mt-0.5 block text-sm break-words">
                                    <template x-for="(seg, i) in hit.segments" :key="i">
                                        <span :class="seg.hit ? 'rounded-sm bg-brand-500/25 font-semibold' : ''" x-text="seg.text"></span>
                                    </template>
                                </span>
                            </button>
                        </li>
                    </template>
                </ul>
            </div>
        </div>

        {{-- ── Lesezeichen (P2) ───────────────────────────────────────────────────────
             Der Raum RENDERT keine Lesezeichen-Fläche, aber sein Nachrichtenmenü liest
             `$store.bookmarks.isBookmarked(…)` — und ein Store, den niemand mountet,
             hat nie eine Liste gelesen: der Eintrag hieße dann in jedem Raum „Merken",
             auch für längst Gemerktes.

             Ein eigenes, leeres Element und kein zweites Lebenszyklus-Paar am Pin-Balken
             darüber: der ist an `x-show` gebunden und trägt seine eigene Begründung; zwei
             Aufgaben an einem `x-data` wären beim nächsten Umbau des Balkens still mit
             verschoben. `hidden` statt `x-cloak` — es gibt hier nichts anzuzeigen, auch
             nicht kurz.

             Ohne `h`-Argument, anders als beim Pin: die Lesezeichenliste gehört dem
             NUTZER und nicht dem Raum, sie wird beim Raumwechsel also nicht neu
             aufgezogen. Der Zähler in `mount`/`unmount` deckt trotzdem denselben
             `wire:navigate`-Fall ab (neuer Body VOR dem Abräumen des alten). --}}
        <div x-data="{
                 init() { $store.bookmarks?.mount() },
                 destroy() { $store.bookmarks?.unmount() },
             }" hidden></div>

        {{-- ── Angepinnte Nachrichten (P6b) ───────────────────────────────────────────
             Der Zustand liegt in `$store.roomPins` (js/roomPins.ts), NICHT in
             `nostrRoomChat` — er wird an zwei Stellen gebraucht, die einander im DOM nicht
             sehen: hier und im Nachrichten-Menü. Zwei Inseln bräuchten zwei Wahrheiten;
             ausführliche Begründung im Kopf von `roomPins.ts`.

             Der Pin ist NICHT portabel: NIP-29 kennt kein Pin-Kind, zooid benutzt
             9010→39005, Buzz 40004. Fremde Clients sehen ihn nicht, und zwischen den beiden
             Relay-Arten ist er nicht übertragbar. Bewusste Entscheidung des Plans, hier
             notiert, weil hier die Fläche steht, die ihn verspricht.

             An- und Abmelden laufen über `init()`/`destroy()` AM `x-data`-Objekt, nicht
             über ein `x-destroy`-Attribut: **eine solche Direktive gibt es in Alpine
             nicht.** Alpine wertet beim Aufräumen ausschliesslich `reactiveData["destroy"]`
             aus (`vendor/livewire/livewire/dist/livewire.esm.js`, im `x-data`-Handler);
             ein `x-destroy="…"` wäre ein totes Attribut gewesen — lautlos, und der Store
             hinge nach dem ersten Raumwechsel an einem Raum, den niemand mehr sieht.

             `unmount($h)` mit Raum-Argument, weil `wire:navigate` den neuen Body VOR dem
             Abräumen des alten einhängt (Begründung an `unmount` in `roomPins.ts`).

             Im Thread ausgeblendet: gepinnt wird im RAUM, und eine Leiste über einer
             Thread-Spalte zeigte Nachrichten, die dort nicht stehen. --}}
        <div x-data="{
                 init() { $store.roomPins?.mount(@js($h)) },
                 destroy() { $store.roomPins?.unmount(@js($h)) },
             }"
             x-show="!threadRootId && $store.roomPins?.entries?.length" x-cloak
             class="mb-2 shrink-0">
            <div class="surface-card flex flex-col gap-1 p-2">
                <div class="flex items-center gap-2 px-1">
                    <flux:icon.map-pin variant="micro" class="text-brand-500" />
                    {{-- Zahl statt bloßem Wort: die Leiste ist einklappbar, und eingeklappt
                         wäre „Angepinnt" ohne Zahl eine Fläche, die nichts sagt. --}}
                    <span class="text-xs font-semibold"
                          x-text="$store.roomPins.entries.length === 1
                                  ? @js($jsVar4)
                                  : @js($jsVar5).replace(':count', $store.roomPins.entries.length)"></span>
                    {{-- Das Icon wird GEDREHT, nicht getauscht: `flux:button` löst seinen
                         `icon`-Prop serverseitig auf (`flux/button/index.blade.php`:
                         `$iconLeading = $icon ??= $iconLeading`), ein `x-bind:icon` wäre
                         also ein totes Attribut. Dieselbe Lösung wie in
                         `components/desktop-rail.blade.php:159`. --}}
                    <flux:button size="xs" variant="ghost" square class="icon-btn-touch ms-auto"
                                 x-bind:aria-expanded="$store.roomPins.collapsed ? 'false' : 'true'"
                                 aria-expanded="true" aria-controls="room-pin-list"
                                 x-on:click="$store.roomPins.collapsed = !$store.roomPins.collapsed"
                                 x-bind:aria-label="$store.roomPins.collapsed ? @js($jsVar6) : @js($jsVar7)">
                        <flux:icon.chevron-up variant="micro" class="size-4 shrink-0 transition-transform"
                                              x-bind:class="$store.roomPins.collapsed ? 'rotate-180' : ''" />
                    </flux:button>
                </div>

                {{-- Wörtliche Begründung des Relays. Sie wird NICHT übersetzt und nicht
                     geschönt: die drei Ablehnungen von zooid („you are not authorized to
                     manage groups", „group metadata cannot be set directly", „you are not a
                     member of this relay") sind unterscheidbar, und nur der Originaltext
                     trägt diese Unterscheidung bis zum Nutzer. --}}
                <template x-if="$store.roomPins.error">
                    <flux:callout variant="danger" icon="exclamation-triangle" class="mx-1">
                        <flux:callout.text x-text="$store.roomPins.error"></flux:callout.text>
                        <x-slot name="actions">
                            <flux:button size="sm" variant="ghost" x-on:click="$store.roomPins.dismissError()">{{ __('Verstanden') }}</flux:button>
                        </x-slot>
                    </flux:callout>
                </template>

                <ul x-show="!$store.roomPins.collapsed" id="room-pin-list" class="max-h-40 overflow-y-auto">
                    <template x-for="pin in $store.roomPins.entries" :key="pin.id">
                        <li class="flex items-center gap-1">
                            {{-- Springt in den Verlauf — `scrollToMessage` kommt über die
                                 Alpine-Scope-Kette aus `nostrRoomChat`, genau wie bei der
                                 Suche (P6a) und der Zitat-Vorschau. Lesender Gebrauch einer
                                 bestehenden Fähigkeit, kein neuer Zustand.
                                 Solange die Nachricht noch nachgeladen wird (`resolved`
                                 false), ist der Knopf abgeschaltet: ein Sprung ins Leere
                                 kehrt wortlos zurück und sähe aus wie ein defekter Knopf. --}}
                            <button type="button" x-on:click="scrollToMessage(pin.id)"
                                    x-bind:disabled="!pin.resolved"
                                    class="pressable min-w-0 flex-1 rounded-tile px-2 py-1.5 text-left hover:bg-brand-500/5 disabled:opacity-60">
                                <span class="flex items-baseline gap-2">
                                    <span class="min-w-0 truncate text-xs font-semibold" x-text="pin.name"></span>
                                    <span class="ms-auto shrink-0 font-mono text-[0.7rem] text-muted" x-text="pin.time"></span>
                                </span>
                                <span class="mt-0.5 block truncate text-sm"
                                      x-text="pin.resolved ? pin.text : @js($jsVar8)"></span>
                            </button>
                            <template x-if="$store.roomPins.canUnpin(pin.id)">
                                <flux:button size="xs" variant="ghost" icon="x-mark" square class="icon-btn-touch"
                                             x-bind:disabled="$store.roomPins.busy"
                                             x-on:click="$store.roomPins.toggle(pin.id)"
                                             aria-label="{{ __('Loslösen') }}" />
                            </template>
                        </li>
                    </template>
                </ul>
            </div>
        </div>

        {{-- Ladefehler (Relay nicht erreichbar / AUTH-Reject): persistenter Callout + Retry. --}}
        <template x-if="error">
            <flux:callout variant="danger" icon="exclamation-triangle" class="mb-2 shrink-0">
                <flux:callout.text x-text="error"></flux:callout.text>
                <x-slot name="actions">
                    <flux:button size="sm" variant="ghost" icon="arrow-path" x-on:click="retry()">{{ __('Erneut laden') }}</flux:button>
                </x-slot>
            </flux:callout>
        </template>

        {{-- Verlauf (Flotilla-Ansatz): `flex-col-reverse` pinnt den Boden (neueste) NATIV —
             scrollTop 0 = Boden, ältere voranstellen verschiebt die Leseposition nicht → kein
             Ruckeln, kein Virtualizer, keine Höhenmessung. Ältere lädt ein rAF-Scroller
             (createScroller, bridge setup) automatisch nahe am oberen (ältesten) Rand.
             `wire:ignore`: der Livewire-Morph darf die Alpine-gerenderte Liste nicht anfassen. --}}
        {{-- KEIN `.throttle`/`.debounce` auf dem Scroll-Handler: Alpines throttle feuert nur auf
             der leading edge und verwirft das letzte Event einer Serie — also genau das, das am
             Boden ankommt. `atBottom` blieb dann auf dem vorletzten Wert stehen und der „Zum
             Ende"-Pfeil klebte fest. onScroll() ist reine Arithmetik; markRead/loadOlder sind
             selbst geguardet → ungedrosselt ist billig genug (Scroll-Events sind rAF-getaktet). --}}
        {{-- P3: Im FORUM-Kanal (`["t","forum"]` im 39000) rendert dieselbe Fläche
             eine Themenliste statt des Verlaufs — siehe den Block direkt darunter.
             `x-show` und nicht `x-if`, weil der Verlauf beim Wechsel weder neu
             gebaut noch neu abonniert werden soll: `isForum` kippt erst, wenn das
             39000 vom Relay da ist (typisch nach dem ersten Frame). --}}
        <div x-ref="scroll" wire:ignore x-on:scroll="onScroll()" x-show="!isForum"
             role="log" aria-live="polite" aria-relevant="additions" aria-label="{{ __('Chat-Verlauf') }}"
             {{-- `x-bind:` ausgeschrieben, nicht `::`. Der `::`-Escape ist eine BLADE-Regel
                  für Komponenten-Tags; auf einem normalen <div> reicht Blade ihn wörtlich
                  durch und Alpine kennt ihn nicht — das Attribut war hier tot, die
                  Ladeansage kam bei keinem Screenreader an. --}}
             x-bind:aria-busy="loading && messages.length === 0"
             {{-- Ab xl bekommt die Verlaufsspalte einen Deckel und wird zentriert. Der
                  Deckel sitzt am SCROLL-Container selbst, nicht an einem Wrapper darin:
                  `flex-col-reverse` pinnt den Boden nativ, und ein zwischengeschobenes
                  Wrapper-Div machte aus den Nachrichten EIN Flex-Kind — die Umkehrung
                  griffe dann auf den Wrapper statt auf die Zeilen, und die Pinnung wäre weg.
                  Nebeneffekt, gewollt: die Bildlaufleiste sitzt an der Spaltenkante,
                  nicht am Fensterrand. --}}
             class="flex flex-col-reverse min-h-0 flex-1 overflow-y-auto px-1 pb-2 transition-opacity xl:mx-auto xl:w-full xl:max-w-[62rem]"
             :class="(!firstPaintDone && messages.length > 0) ? 'opacity-0' : 'opacity-100'">

            {{-- Erstes Laden: SERVER-SEITIG gerendertes Skeleton (kein x-cloak/x-if, statische
                 Rows via @for) → steht ab dem ERSTEN Paint da. Sonst blitzte der Chat-Bereich
                 beim F5 weiß auf, bis Alpine bootet (~165ms) und die x-if/x-for-Templates
                 auswertet. `x-show` blendet es aus, sobald Nachrichten geladen sind. --}}
            {{-- `authed` im Guard, nicht nur `loading`: der Relay beantwortet jeden
                 REQ eines signerlosen Clients mit `CLOSED auth-required` (gemessen
                 2026-08-15, P4) — es kommt also nie ein EOSE mit Inhalt.

                 `loading` kippt trotzdem, nur eben ohne Ergebnis: nach **3401 ms**
                 (gemessen), weil welshmans `load()` einen 3-Sekunden-Timeout hat
                 (`request.js:226`) und dann mit LEERER Liste resolved — das
                 `CLOSED` selbst hat der Auth-Buffer verschluckt (`policy.js:62-67`).
                 Dieser Guard deckt also genau das Fenster DAVOR: ohne ihn stand ein
                 Gast 3,4 Sekunden lang vor 18 Skelett-Zeilen, also vor dem
                 Versprechen, dass gleich etwas kommt (per Mutation belegt: ohne
                 Guard 18 sichtbare Skelette bei ms=0, mit Guard 0). Was danach
                 kommt, regelt der Guard an der Leerzustands-Karte weiter unten.
                 Was er stattdessen sieht, steht im Fuß (verein-gate). --}}
            <div x-show="loading && messages.length === 0 && $store.authGate?.authed" class="space-y-3 pt-4">
                <span class="sr-only" aria-live="polite">{{ __('Verlauf wird geladen…') }}</span>
                @for ($i = 0; $i < 6; $i++)
                    <div class="flex gap-2">
                        <div class="skeleton size-8 shrink-0 rounded-full"></div>
                        <div class="flex-1 space-y-1.5 py-1">
                            <div class="skeleton h-3 w-24"></div>
                            <div class="skeleton h-3 w-2/3"></div>
                        </div>
                    </div>
                @endfor
            </div>

            {{-- Leerer Raum. Eine Aussage, EIN Weg — und der Weg ist kein Link: der
                 Raum IST schon das Ziel, es fehlt nur der erste Satz. Der Knopf
                 übergibt darum den Fokus dorthin, wo das Ergebnis der Handlung
                 entsteht (dieselbe Regel wie in ⚡updates), statt irgendwohin zu
                 navigieren.

                 WELCHES Ziel, hängt am Zustand des Fußes: Mitglied → das Textfeld;
                 angemeldet, aber nicht beigetreten → der Beitreten-Knopf. Das wird
                 entschieden und nicht geraten: `.focus()` auf ein per `x-show`
                 verborgenes Element ist ein stiller No-Op, der Fokus fiele dann
                 auf <body>.

                 Der dritte Fall (Gast → gatender Composer) ist mit P4 entfallen —
                 aber NICHT, weil der Gast diese Karte nie erreichte. Genau das
                 stand hier zuerst und war falsch: gemessen am 2026-08-15 kippt
                 `loading` für ihn nach **3401 ms**, und danach stand die Karte
                 dauerhaft auf seinem Schirm (bei ms≈3401/7453/15523 gleich).

                 Warum sie kippt: `loading = false` hängt im `.finally()` von
                 `loadRoomMessages()` (`js/bridge.ts`, `loadRoomMessages`), und welshmans `load()`
                 trägt einen 3-Sekunden-Timeout (`@welshman/net` `request.js:226`,
                 `makeLoader({delay: 200, timeout: 3000, threshold: 0.5})`). Der
                 Timeout bricht den Request ab und **resolved mit leerer Liste** —
                 das `CLOSED auth-required` des Relays hat der Auth-Buffer vorher
                 aus der Empfangsschlange entfernt (`policy.js:62-67`). Der Client
                 kann „abgelehnt" und „nichts da" also gar nicht auseinanderhalten.

                 Deshalb der `authed`-Guard an der Karte: für einen Nutzer OHNE
                 Signer ist `messages.length === 0` keine Aussage über den Raum,
                 sondern nur die Quittung einer verweigerten Leseanfrage — und
                 „Noch keine Nachrichten in diesem Raum." wäre dann dieselbe
                 Unwahrheit wie das zurückgebaute „Du liest mit", nur andersherum
                 (belegt: der Messraum hatte GENAU EINE echte Nachricht). Für
                 Angemeldete bleibt die Karte unverändert — dort ist die Aussage
                 so belastbar wie zuvor. Sein Fuß ist das verein-gate. --}}
            {{-- P11: `&& !gatedOut` — wurde der Read vom Relay abgewiesen
                 (`CLOSED restricted:`), ist `messages.length === 0` KEINE Aussage
                 über den Raum, sondern die Quittung der verweigerten Anfrage —
                 dieselbe Unwahrheit wie beim Gast, nur eine Zielgruppe weiter
                 (gemessen: Messraum trug GENAU EINE echte Nachricht, die Karte
                 behauptete trotzdem „Noch keine Nachrichten", p11-05). Die
                 Ersatzfläche ist das room-gate weiter unten im Fuß. --}}
            <template x-if="!loading && messages.length === 0 && $store.authGate?.authed && !gatedOut">
                <div class="surface-card empty-state mt-8 p-6 text-center">
                    <flux:icon.chat-bubble-left-right class="mx-auto size-8 text-zinc-400" />
                    <flux:text class="mt-2">{{ __('Noch keine Nachrichten in diesem Raum.') }}</flux:text>
                    <div class="mt-4">
                        <flux:button size="sm" variant="ghost" icon="pencil-square"
                                     x-on:click="(joined ? $refs.composer : $refs.joinButton)?.focus()">{{ __('Schreib die erste.') }}</flux:button>
                    </div>
                </div>
            </template>

            {{-- Verlauf: Full-DOM, newest-first als direkte Flex-Items (messagesReversed) im
                 flex-col-reverse-Container → neweste am Boden, Boden nativ gepinnt. Kein Virtualizer,
                 keine Höhenmessung → kein Ruckeln. Vertikalabstand als pt-* pro Zeile. --}}
            <template x-for="m in messagesReversed" :key="m.id">
                <div :class="m.showAuthor ? 'pt-2.5' : 'pt-0.5'">
                    @include('group::partials.chat-row', ['context' => 'room'])
                </div>
            </template>
        </div>

        {{-- ── Forum: die Themenliste (P3) ──────────────────────────────────────
             Ein Forum ist kein Verlauf, und deshalb sieht es auch nicht aus wie
             einer: normale Leserichtung (oben die jüngste AKTIVITÄT, nicht die
             jüngste Erstellung), kein Auto-Scroll, kein Boden-Pin, keine
             Ungelesen-Pille am Ende. Sortierung und Zähler kommen aus
             `buildForumTopics` (`js/forumModels.ts`) — der Relay liefert für
             Forum-Wurzeln KEINE Zusammenfassung (kein 39005, am Teststack
             abgefragt), die Zahl ist also gerechnet und nicht abgeschrieben.

             `role="list"`: die Zeilen sind Sprungmarken in eine Liste von Themen,
             kein `log` wie der Chat — ein `aria-live` wäre hier falsch, weil
             nichts unten „ankommt". --}}
        <div x-show="isForum" x-cloak
             class="min-h-0 flex-1 overflow-y-auto px-1 pb-2 xl:mx-auto xl:w-full xl:max-w-[62rem]">

            {{-- Skeleton, solange der Bestand lädt — dieselbe Regel wie beim Verlauf:
                 nur für Angemeldete, sonst verspricht die Fläche einem Gast etwas,
                 das der Relay ihm gar nicht liefert (`CLOSED auth-required`). --}}
            <div x-show="topicsLoading && topics.length === 0 && $store.authGate?.authed" class="space-y-3 pt-4">
                <span class="sr-only" aria-live="polite">{{ __('Themen werden geladen…') }}</span>
                @for ($i = 0; $i < 4; $i++)
                    <div class="surface-card space-y-2 p-3">
                        <div class="skeleton h-3 w-2/3"></div>
                        <div class="skeleton h-3 w-1/3"></div>
                    </div>
                @endfor
            </div>

            {{-- Der Weg zum eigenen Thema — DESKTOP-Bauform, am Kopf der Liste,
                 wie Buzz Desktop (`ForumView.tsx:184-197`). Die mobile Form steht
                 unten in der Composer-Zone; welche gilt, sagt
                 `topicComposerZiel($store.viewport.desktop)`, und weil das EINE
                 Funktion mit EINEM Rückgabewert ist, können nie beide stehen.

                 `x-if` und nicht `x-show`: das Feld darin trägt `x-ref` und
                 `data-`-Haken, ein per CSS verstecktes Duplikat wäre ein
                 Strict-Mode-Treffer auf zwei Elemente. --}}
            <template x-if="membershipReady && topicComposerZiel($store.viewport.desktop) === 'kopf'">
                <div><x-group::forum-topic-inline /></div>
            </template>

            {{-- Leeres Forum. Der Satz bleibt eine AUSKUNFT und trägt bewusst
                 keinen zweiten „Schreib das erste Thema"-Knopf: der Weg dorthin
                 steht seit 2026-08-27 direkt darüber (Desktop) bzw. in der
                 unteren Zone (Mobil), und ein dritter Auslöser für dieselbe
                 Handlung wäre genau die Doppelung, gegen die
                 `topicComposerZiel()` gebaut ist. --}}
            <template x-if="!topicsLoading && topics.length === 0 && $store.authGate?.authed && !gatedOut">
                <div class="surface-card empty-state mt-8 p-6 text-center">
                    <flux:icon.chat-bubble-oval-left class="mx-auto size-8 text-zinc-400" />
                    <flux:text class="mt-2">{{ __('Noch keine Themen in diesem Forum.') }}</flux:text>
                </div>
            </template>

            {{-- Der Ordnungs-Umschalter (P3). Er steht ÜBER der Liste und in einem
                 eigenen Partial — die Werte darin hält `forumModels.test.ts` gegen
                 `FORUM_SORTS`, Reihenfolge inklusive. --}}
            @include('group::partials.forum-sortierung')

            <ul role="list" class="space-y-2 py-2" x-show="topics.length > 0" x-cloak>
                {{-- `sortedTopics()` und nicht `topics`: die Ableitung liefert die
                     Default-Ordnung (letzte Aktivität), die Wahl des Nutzers wird erst
                     hier angewandt. Als Methode gelesen, damit Alpine BEIDE Quellen —
                     die Zeilen und die gewählte Ordnung — als Abhängigkeit sieht. --}}
                <template x-for="topic in sortedTopics()" :key="topic.id">
                    {{-- Zeile = Bewertungsspalte + Karte, nebeneinander. Die Spalte
                         steht NEBEN der Karte und nicht darin, weil die Karte selbst ein
                         `<button>` ist und ein Knopf im Knopf kein gültiges HTML wäre —
                         der Browser bräche ihn aus dem Elternteil heraus. --}}
                    <li class="flex items-start gap-2">
                        <x-group::forum-vote topic="topic" />
                        {{-- Die ganze Karte ist der Knopf: ein Thema hat genau ein Ziel
                             (seinen Thread), also gibt es auch nur eine Trefferfläche.
                             `aria-label` trägt den ganzen Satz inklusive Antwortzahl —
                             der sichtbare Titel allein sagt einer Sprachausgabe nicht,
                             dass hier ein Thread wartet. --}}
                        <button type="button" x-on:click="openTopic(topic)"
                                {{-- Der Satz wird aus ZWEI Katalogschlüsseln gebaut und nicht
                                     aus einem mit hartem „Antworten": die Zahl steht sonst in
                                     jeder Sprache im Plural, auch bei genau einer Antwort.
                                     `$plural` entscheidet über `Intl.PluralRules` (siehe
                                     `lang/README.md`). --}}
                                x-bind:aria-label="@js(__('Thema :title öffnen'))
                                    .split(':title').join(topic.title || @js(__('Ohne Titel')))
                                    + ' — ' + $plural(topic.replyCount, '1 Antwort', ':count Antworten')"
                                {{-- `min-w-0 flex-1` statt `w-full`: in der Flex-Zeile
                                     neben der Bewertungsspalte rechnete `w-full` gegen
                                     die volle Zeilenbreite und die Karte liefe über.
                                     `min-w-0` ist die Bedingung dafür, dass `truncate`
                                     und `line-clamp` darin überhaupt greifen — ein
                                     Flex-Kind hat als Mindestbreite sonst seinen
                                     Inhalt. --}}
                                class="pressable surface-card flex min-w-0 flex-1 flex-col gap-1 p-3 text-start transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800">
                            <span class="flex min-w-0 items-start gap-2">
                                <x-group::nostr-avatar picture="topic.picture" name="topic.authorName" size="1.5rem" />
                                <span class="min-w-0 flex-1">
                                    <span class="line-clamp-2 text-sm font-semibold break-words"
                                          x-text="topic.title || @js(__('Ohne Titel'))"></span>
                                    <span class="mt-0.5 block truncate text-xs text-muted" x-show="topic.preview"
                                          x-text="topic.preview"></span>
                                </span>
                            </span>
                            <span class="flex items-center gap-2 text-xs text-muted">
                                <span class="truncate" x-text="topic.authorName"></span>
                                <span aria-hidden="true">·</span>
                                {{-- Antwortzahl inline hinter der Beschriftung, nicht
                                     rechtsbündig: sie ist BESTAND, keine Aufmerksamkeit
                                     (die Regel aus `rail-forge-row`). --}}
                                <span x-text="$plural(topic.replyCount, '1 Antwort', ':count Antworten')"></span>
                                <span aria-hidden="true">·</span>
                                <span x-bind:title="topic.lastFullLabel" x-text="topic.lastLabel"></span>
                                {{-- Der OPTIMISTISCHE Merker. `publishThunk` legt das
                                     Ereignis synchron in den `repository` und trägt die
                                     Ziel-URL im `tracker` ein — die Zeile steht also
                                     schon, bevor der Relay etwas gesagt hat. Ohne diesen
                                     Zusatz sähe sie aus wie jede andere, und beim
                                     Fehlschlag verschwände sie wieder, ohne dass jemand
                                     wüsste, dass sie je vorläufig war.

                                     KEIN eigener `·`-Trenner davor: die zwei vorhandenen
                                     tragen `aria-hidden="true"` und stehen damit in der
                                     kalibrierten Trägerzählung (`EmptyStatesAndA11yTest`,
                                     `'room' => 37`). Ein dritter hätte sie ohne
                                     inhaltlichen Grund bewegt.

                                     `text-brand-800`, NICHT `text-brand-600`. Hier stand
                                     zuerst brand-600, und das war ein echter Fehler:
                                     #e87706 auf der weissen `surface-card` hält
                                     **2,97:1**, WCAG 1.4.3 verlangt 4,5:1 für normalen
                                     Text. brand-800 (#98480f) hält 6,42:1. Das ist die
                                     Rollenregel dieses Hauses („brand-700 = Linie/Grafik,
                                     brand-800 = Text", `theme.css`), und der Dunkelzweig
                                     war nie betroffen (brand-400 auf zinc-900: 8,95:1). --}}
                                <span x-show="topicSending.includes(topic.id)" x-cloak
                                      class="font-semibold text-brand-800 dark:text-brand-400"
                                      data-forum-topic-pending>{{ __('Wird gesendet …') }}</span>
                            </span>
                        </button>
                    </li>
                </template>
            </ul>
        </div>

        {{-- Lade-Spinner oben, während der Auto-Scroller (createScroller) ältere Nachrichten
             nachzieht — reines Feedback; das Laden selbst passiert beim Hochscrollen von allein. --}}
        <div class="pointer-events-none absolute inset-x-0 top-2 flex justify-center" x-show="loadingMore && !isForum" x-cloak
             x-transition.opacity>
            <span class="surface-card rounded-full px-3 py-1 text-xs text-muted shadow-md">{{ __('Lädt ältere…') }}</span>
        </div>

        {{-- Zurück ans Ende, sobald hochgescrollt — mit Zähler, wenn neue Nachrichten warten.
             Zwei Buttons: flux erkennt „Icon-only vs. Pille" server-seitig am Slot (ein
             x-show-Span bliebe immer „nicht leer" → Pfeil säße links statt zentriert). --}}
        {{-- Zeigt, sobald der User nicht mehr am Boden ist (atBottom = Math.abs(scrollTop) < 60, column-reverse). --}}
        <div class="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center" x-show="firstPaintDone && !atBottom && !isForum" x-cloak
             x-transition.opacity>
            {{-- Keine ungelesenen → quadratischer Button, Pfeil zentriert. --}}
            <flux:button x-show="unread === 0" size="xs" variant="primary" square icon="arrow-down"
                         class="pointer-events-auto icon-btn-touch" x-on:click="scrollToBottom()" aria-label="{{ __('Zum Ende springen') }}" />
            {{-- Ungelesene → Pille mit Zähler. --}}
            <flux:button x-show="unread > 0" x-cloak size="xs" variant="primary" icon="arrow-down"
                         class="pointer-events-auto icon-btn-touch" x-on:click="scrollToBottom()" aria-label="{{ __('Zum Ende springen') }}">
                <span x-text="unread"></span> {{ __('neue') }}
            </flux:button>
        </div>
    </div>

    {{-- Thread-Mittelbereich (C6b, NIP-22 kind 1111): tauscht denselben Bereich wie der Raum-Feed,
         teilt aber Kopf + status-strip + Bühne → identisches Layout, KEIN Overlay, kein Überblenden.
         `role="dialog"` + Fokus-/Escape-Verwaltung bleiben (fokussierte Sub-Ansicht). Der Escape-Guard
         (`!lightboxSrc && !_cropSrc`) verhindert, dass ein Lightbox-/Cropper-Schließen den Thread mitreißt. --}}
    {{-- Ab xl ist derselbe Block KEIN Dialog mehr, sondern eine begleitende Spalte:
         `role`/`aria-modal` wechseln reaktiv mit `$store.viewport.desktop`. Das ist
         keine Kosmetik — `aria-modal="true"` sagt Screenreadern, der Rest der Seite
         sei inert. Solange der Feed daneben sichtbar UND bedienbar ist, wäre das
         schlicht gelogen.
         Ebenso der Fokus-Fang: einen Fokus zu stehlen ist im Vollbild-Takeover
         richtig (es gibt nichts anderes) und in einem Nebenpanel falsch.
         Escape schließt in BEIDEN Formen — der Guard gegen Lightbox/Cropper bleibt. --}}
    {{-- `role`/`aria-modal` stehen STATISCH im Markup und werden von Alpine nur
         überschrieben. Zwei Gründe, und der zweite ist gemessen:
         1. Ohne JS (und in der Zeit vor dem Alpine-Boot) ist die Rolle korrekt da.
         2. `::role` funktioniert hier NICHT. Der `::`-Escape ist eine BLADE-Regel für
            Komponenten-Tags (`<flux:button ::disabled>`); auf einem normalen <div>
            reicht Blade `::role` unverändert durch, und Alpine kennt kein `::`.
            Ergebnis wäre ein Element ganz ohne Rolle — gemessen an 19 roten E2E-Tests,
            die `getByRole('dialog', { name: 'Thread' })` nicht mehr fanden.
         Deshalb ausgeschrieben `x-bind:` — unmissverständlich, keine Blade-Interaktion. --}}
    <div x-show="threadRootId" x-cloak
         role="dialog" aria-modal="true"
         x-bind:role="$store.viewport?.desktop ? 'complementary' : 'dialog'"
         x-bind:aria-modal="$store.viewport?.desktop ? null : 'true'"
         aria-label="{{ __('Thread') }}"
         x-effect="threadRootId && !$store.viewport?.desktop && $nextTick(() => $refs.threadClose?.focus())"
         x-on:keydown.escape.window="threadRootId && !lightboxSrc && !_cropSrc && backFromThread()"
         class="relative flex min-h-0 flex-1 flex-col
                xl:fixed xl:inset-y-0 xl:end-0 xl:z-40 xl:w-[26rem] xl:flex-none
                xl:border-s xl:border-zinc-200 xl:bg-white xl:pb-4 xl:shadow-pop
                2xl:w-[28rem] dark:xl:border-zinc-800 dark:xl:bg-zinc-900">

        {{-- Panel-Kopf: existiert NUR ab xl. Darunter trägt der geteilte Seitenkopf
             den Titel und den Zurück-Pfeil (`x-ref="threadClose"`) — hier wäre er
             eine zweite Überschrift. Ab xl gibt es diesen Kopf nicht mehr über dem
             Thread, also braucht die Spalte ihren eigenen Namen und ihren eigenen
             Ausgang. --}}
        <div class="hidden shrink-0 items-center gap-2 border-b border-zinc-200 px-4 py-3 xl:flex dark:border-zinc-800">
            <flux:icon.chat-bubble-left-right variant="micro" class="size-4 shrink-0 text-muted" />
            <span class="min-w-0 flex-1 truncate text-sm font-semibold">{{ __('Thread') }}</span>
            <span class="shrink-0 font-mono text-[0.7rem] tabular-nums text-muted"
                  x-text="threadComments.length"></span>
            <flux:button variant="ghost" size="sm" icon="x-mark" x-on:click="backFromThread()"
                         aria-label="{{ __('Thread schließen') }}" />
        </div>

        {{-- Root + Kommentare (scrollbar). px-1 wie der Raum-Verlauf. --}}
        <div x-ref="threadScroll" class="min-h-0 flex-1 space-y-3 overflow-y-auto px-1 py-3 xl:px-4">
            {{-- Zitat-Anker statt Karte: der Root ist untergeordneter KONTEXT, kein Inhalt.
                 Ein linker brand-Rail ist die klassische Zitat-Metapher und trägt Bedeutung
                 („dies ist die zitierte Ursprungsnachricht") — kein voller Rahmen, keine
                 Card-Elevation, kein separater „mehr anzeigen"-Block. Die Kopf-Leiste selbst
                 ist der Toggle: eingeklappt = 1 Zeile Auszug → minimale Extra-Höhe. Opaker
                 zinc-Grund, damit die Kommentare beim Scrollen sauber DAHINTER verschwinden. --}}
            <template x-if="threadRoot && !threadRoot.missing">
                <div x-data="{ expanded: false, overflow: false }"
                     x-effect="threadRoot; expanded = false; $nextTick(() => { overflow = $refs.rootBody ? $refs.rootBody.scrollHeight > $refs.rootBody.clientHeight : false })"
                     class="sticky top-0 z-10 rounded-r-card border-l-2 border-brand-500/60 bg-zinc-100 py-2 pr-2 pl-3 dark:bg-zinc-800">
                    {{-- Ganze Kopf-Leiste tappbar. Nur ein Toggle, wenn wirklich Überlauf → sonst
                         disabled (keine falsche Affordance, aus dem Tab-Fokus). --}}
                    <button type="button" x-on:click="overflow && (expanded = ! expanded)"
                            :disabled="!overflow" :aria-expanded="overflow ? expanded : null"
                            class="pressable flex w-full items-center gap-2 rounded text-left enabled:hover:bg-brand-500/5 disabled:cursor-default">
                        <x-group::nostr-avatar picture="threadRoot.picture" name="threadRoot.name" size="1.25rem" />
                        <span class="truncate text-xs font-semibold" x-text="threadRoot.name"></span>
                        <span class="inline-flex size-3.5 shrink-0 items-center justify-center">
                            <x-group::nostr-nip05 nip05="threadRoot.nip05" />
                        </span>
                        <span class="ml-auto shrink-0 font-mono text-[0.7rem] text-muted" x-text="threadRoot.time"></span>
                        <flux:icon.chevron-down x-show="overflow" x-cloak class="size-3.5 shrink-0 text-muted transition-transform" ::class="expanded ? 'rotate-180' : ''" />
                    </button>
                    {{-- Auszug unter dem Namen eingerückt (Avatar 1.25rem + gap-2 = 1.75rem).
                         text-muted = untergeordnet, aber AA-tragfähig; Links/Mentions bleiben brand.

                         Der Mention-Zweig im Klick-Handler ist hier nicht Kür, sondern die Bedingung
                         dafür, dass der Kopf dieselbe Erwähnung wie jede Kommentarzeile behandelt:
                         Der Thread-ROOT rendert NICHT über `chat-row`, sondern über dieses eigene
                         Markup (`personFields` ohne Karte) — ein Handler nur in `chat-row` ließe die
                         Erwähnung genau hier tot. `.stop`, weil die Kopf-Leiste darüber selbst
                         ein Klickziel ist (Auf-/Zuklappen). --}}
                    <div x-ref="rootBody" class="chat-content mt-0.5 pl-7 text-sm break-words whitespace-pre-wrap text-muted"
                         :class="expanded ? '' : 'line-clamp-1'" x-html="threadRoot.html"
                         x-on:click="
                             if ($event.target.matches('img.chat-image')) {
                                 $event.stopPropagation();
                                 lightboxSrc = $event.target.dataset.full
                             } else {
                                 const mention = $event.target.closest('button.mention[data-pubkey]');
                                 if (mention) { $event.stopPropagation(); $dispatch('open-profile', mention.dataset.pubkey) }
                             }
                         "></div>
                </div>
            </template>
            <template x-if="threadRoot?.missing">
                {{-- Gleiche Anker-Form, aber neutraler zinc-Rail (kein brand): inert, kein Inhalt. --}}
                <div class="sticky top-0 z-10 rounded-r-card border-l-2 border-zinc-300 bg-zinc-100 py-2 pr-2 pl-3 text-xs text-muted dark:border-zinc-700 dark:bg-zinc-800">
                    {{ __('Originalnachricht (noch) nicht verfügbar.') }}
                </div>
            </template>

            {{-- Kommentar-Liste: flach + chronologisch (Slack-Stil, P3 4.2). Kommentare durch die
                 GETEILTE Raum-Message-Row → erben Mentions/Crop/Lightbox/Reaktionen/Zaps/Toolbar.
                 `context='thread'` gatet Raum-only-Aktionen aus und routet Antworten→setThreadReply. --}}
            <template x-if="threadComments.length === 0">
                <p class="py-6 text-center text-sm text-muted">{{ __('Noch keine Antworten — antworte als erste:r.') }}</p>
            </template>
            <template x-for="m in threadComments" :key="m.id">
                <div :class="m.showAuthor ? 'pt-2.5' : 'pt-0.5'">
                    @include('group::partials.chat-row', ['context' => 'thread'])
                </div>
            </template>
        </div>

        {{-- Thread-Composer. Er steht INNERHALB des Thread-Blocks, nicht daneben:
             unterhalb xl ist das visuell dasselbe wie zuvor (er war schon immer der
             letzte `shrink-0`-Streifen derselben Flex-Spalte), ab xl ist es Pflicht —
             der Thread ist dort ein `fixed` Panel, und ein Composer, der draußen
             bliebe, klebte am Fuß der Bühne statt am Fuß seines Threads.
             context='thread' → sendComment(), threadDraft/threadComposer. --}}
        <div x-show="threadRootId" x-cloak class="shrink-0 pt-2 xl:px-4">
            <template x-if="joined">
                <div>
                    {{-- Antwort-Kontext (verschachtelt) mit Abbrechen. --}}
                    <div x-show="threadReplyTo" x-cloak
                         class="mb-1 flex items-center gap-2 border-l-2 border-brand-500/60 px-2 py-1 text-xs">
                        <span class="min-w-0 flex-1 truncate text-muted">
                            {{ __('Antwort auf') }} <span class="text-brand-500" x-text="threadReplyTo?.name"></span>
                        </span>
                        <flux:button size="xs" variant="ghost" icon="x-mark" class="icon-btn-touch"
                                     x-on:click="clearThreadReply()" aria-label="{{ __('Abbrechen') }}" />
                    </div>
                    @include('group::partials.chat-composer', ['context' => 'thread'])
                </div>
            </template>
            {{-- Nicht-Mitglied: Beitreten direkt aus dem Thread. Nur für ANGEMELDETE
                 — einem Gast fehlt nicht die Mitgliedschaft, sondern der Signer.
                 Der Thread ist ein eigener Landeplatz (`/rooms/{h}/thread/{nevent}`
                 ist teilbar), also braucht er denselben Gast-Fuß wie der Raum und
                 nicht einen Knopf, der beim Signieren ins Leere läuft. --}}
            {{-- P11: `&& !gatedOut` — für ein Relay-Nicht-Mitglied scheitert `join()`
                 nachweislich (`restricted:`); der Knopf gehört nur denen, deren Join
                 durchgehen kann (Angemeldete MIT Relay-Mitgliedschaft, ohne Raum-Mitgliedschaft). --}}
            <template x-if="!joined && $store.authGate?.authed && !gatedOut">
                <div class="surface-card flex items-center justify-between gap-3 p-3">
                    <flux:text class="text-sm text-muted">{{ __('Tritt dem Raum bei, um zu antworten.') }}</flux:text>
                    <flux:button size="sm" variant="primary" icon="plus" class="shrink-0 icon-btn-touch"
                                 x-on:click="join()" ::disabled="joining">
                        <span x-text="joining ? @js($jsVar9) : @js($jsVar10)"></span>
                    </flux:button>
                </div>
            </template>

            {{-- Gast im Thread: dieselbe ehrliche Aussage wie am Raum-Fuß.
                 Der Thread ist ein eigener, teilbarer Landeplatz
                 (`/rooms/{h}/thread/{nevent}`) — wer ihn auslässt, hinterlässt
                 genau dort wieder eine wortlose leere Fläche.
                 `x-if` statt `x-show`, und `threadRootId` MIT in die Bedingung: die
                 Gate-Insel startet beim Mount einen eigenen Directory-Sub, und das
                 Thread-Panel hängt an einem `x-show` — ohne den Zusatz stünde eine
                 zweite, unsichtbare Gate-Karte samt zweitem Sub auf JEDER Raumseite
                 eines Gastes. (Gemessen: zwei `nostrVereinGate`-Inseln im DOM, die
                 zweite in einem `display:none`-Vorfahren.) --}}
            <template x-if="threadRootId && !joined && ! $store.authGate?.authed">
                <x-group::verein-gate context="{{ __('Räume und Chat') }}" />
            </template>

            {{-- P11: dasselbe Relay-Gate für den restricted-Fall — der Thread ist
                 ein eigener teilbarer Landeplatz (P4-Logik, s. o.), also braucht er
                 die Aussage genauso. `threadRootId` in der Bedingung aus demselben
                 Grund wie beim Gast-Gate: keine stille zweite Karte im DOM; die
                 room-gate-Komponente startet zwar keine eigene Sub, einheitlich
                 bleibt es trotzdem. --}}
            <template x-if="threadRootId && gatedOut">
                <x-group::room-gate />
            </template>
        </div>
    </div>

    {{-- Fehler (Relay lehnt ab, AUTH etc.) erscheinen als globaler Toast. --}}

    {{-- Composer nur für Mitglieder; sonst Beitreten-Hinweis. Mitgliedschaft ist
         relay-seitig (NIP-29 39002) und persistent. `membershipReady` verhindert,
         dass der Hinweis kurz aufblitzt, bevor die Members-Liste geladen ist.
         Senden ist eine reine Alpine-Aktion (welshman signiert im Browser). --}}
    {{-- Ab xl bleibt der Raum-Composer stehen, während ein Thread offen ist — dort ist
         der Thread eine Spalte daneben, kein Ersatz. Wer im Thread antwortet, benutzt
         den Composer IM Panel; wer in den Raum schreibt, diesen hier. Zwei Composer
         nebeneinander sind kein Widerspruch, sondern zwei Ziele. --}}
    {{-- Gleicher Deckel und gleiche Zentrierung wie der Verlauf darüber — sonst stünde
         der Composer auf einer 1900px-Bühne unter einer 992px-Spalte. --}}
    <div x-show="!threadRootId || $store.viewport?.desktop" class="shrink-0 pt-2 xl:mx-auto xl:w-full xl:max-w-[62rem]">
        {{-- SSR-sichtbar (kein x-cloak): der Composer-Platz zeigt beim F5 sofort ein Skeleton
             statt weiß, bis die Mitgliedschaft geladen ist. --}}
        <div x-show="!membershipReady" class="skeleton h-11 rounded-card"></div>

        {{-- Hier stand bis P4 die Gast-Einstiegszeile („Du liest mit. Zum
             Mitschreiben anmelden.", schließbar, mit eigenem localStorage-Schlüssel).
             Sie ist entfernt, weil ihre Prämisse gemessen falsch war: ein Gast liest
             NICHT mit. Beide Prod-Relays und die lokale Instanz beantworten jeden
             REQ eines signerlosen Clients mit `CLOSED auth-required` — die Zeile
             stand über einer leeren Bühne und behauptete das Gegenteil. Was an
             ihrer Stelle steht, ist das verein-gate weiter unten. --}}

        {{-- Compose-Kontext über dem Composer: Antworten (replyTo), Zitieren (sharing)
             oder Bearbeiten (editingId) — mit Abbrechen. --}}
        <div x-show="membershipReady && joined && (replyTo || editingId)" x-cloak
             class="surface-card mb-1 flex items-center gap-2 border-l-2 border-brand-500/60 px-3 py-1.5">
            <div class="min-w-0 flex-1">
                <div class="text-xs font-semibold text-brand-500"
                     x-text="editingId ? @js($jsVar11) : (sharing ? @js($jsVar12) : @js($jsVar13).split(':name').join(replyTo?.name ?? ''))"></div>
                <div class="truncate text-xs text-muted" x-show="replyTo" x-text="replyTo?.text"></div>
            </div>
            <flux:button size="xs" variant="ghost" icon="x-mark" class="icon-btn-touch"
                         x-on:click="editingId ? cancelEdit() : clearReply()" aria-label="{{ __('Abbrechen') }}" />
        </div>

        {{-- Anhang-Vorschau + Eingabezeile (@-Mentions, Bild, Umfrage/Zap-Ziel): geteilter Composer.
             Sanftes Opacity-Einblenden statt hartem Aufploppen, sobald die Mitgliedschaft (39002)
             geladen ist (membershipReady). --}}
        {{-- Im FORUM steht hier KEIN Chat-Composer.

             Nicht aus Bequemlichkeit, sondern weil er das Falsche täte: Er
             schickte eine kind-9-Wurzel in den Kanal, und ein Forum-Thema ist ein
             45001. Buzz Desktop listet ausschließlich 45001 als Thema — die
             Nachricht verschwände also spurlos, bei uns wie dort. Ein Composer,
             dessen Ergebnis niemand je sieht, ist schlimmer als keiner.

             Antworten IN einem Thema gehen sehr wohl: der Thread-Composer schickt
             ein kind 9 mit `["e",<root>,"","reply"]`, und genau diese Form nimmt
             der Relay im Forumkanal an und liest Buzz Desktop als Forum-Antwort
             (`get_forum_thread` fragt `kinds:[9,45003]`) — beides am Teststack
             gemessen.

             **Themen ANLEGEN steht seit 2026-08-27 hier** — aber in der MOBILEN
             Bauform, und nur in ihr. Hier stand bis dahin der Satz „Neue Themen
             werden hier noch nicht verfasst"; er ist ersatzlos gefallen, weil
             der Weg jetzt existiert. Welche der zwei Bauformen erscheint,
             entscheidet `topicComposerZiel($store.viewport.desktop)` — EINE
             Funktion mit EINEM Rückgabewert, damit zwei sichtbare Auslöser für
             dieselbe Handlung nicht ausdrückbar sind (Herleitung in
             `js/forumWriteModels.ts`). Die Desktop-Form steht am KOPF DER LISTE,
             nicht hier. --}}
        <div x-show="membershipReady && joined && !isForum" x-cloak x-transition.opacity.duration.200ms>
            @include('group::partials.chat-composer', ['context' => 'room'])
        </div>
        <template x-if="membershipReady && topicComposerZiel($store.viewport.desktop) === 'leiste'">
            <div><x-group::forum-topic-blatt /></div>
        </template>

        {{-- Fehlgeschlagen: aktionable Hinweiszeile statt flüchtigem Toast (Draft ist gefüllt). --}}
        <div x-show="membershipReady && joined && sendError" x-cloak
             class="mt-1 flex items-center justify-between gap-2 rounded-tile bg-red-500/10 px-3 py-1.5 text-xs text-red-500">
            <span x-text="sendError"></span>
            <button type="button" x-on:click="send()" class="pressable shrink-0 font-semibold text-brand-500 hover:underline">
                {{ __('Erneut senden') }}
            </button>
        </div>

        {{-- Beitreten — nur für ANGEMELDETE Nicht-Mitglieder. Einem Gast fehlt nicht
             die Mitgliedschaft, sondern der Signer: `join()` würde ein kind 9021
             signieren wollen und im Nichts enden. Deshalb trägt der Gast-Zweig
             darunter seinen eigenen Zustand.
             `join()` löst diesen Knopf selbst auf (die 39002 kommt zurück, `joined`
             kippt) — ohne die Fokus-Übergabe fiele der Fokus auf <body>. Ist der
             Composer noch verborgen, ist `.focus()` ein No-Op und es bleibt beim
             Status quo, also kein Rückschritt. --}}
        {{-- P11: `&& !gatedOut` — der Knopf scheitert für ein Relay-Nicht-Mitglied
             garantiert (`join()` → `CLOSED restricted`, P4: p4-raw-join-nichtmitglied.log);
             die Ersatzfläche ist das room-gate darunter. Für Angemeldete MIT
             Relay-Mitgliedschaft ohne Raum-Mitgliedschaft bleibt alles wie zuvor. --}}
        <div x-show="membershipReady && !joined && $store.authGate?.authed && !gatedOut" x-cloak x-transition.opacity.duration.200ms
             class="surface-card flex items-center justify-between gap-3 p-3">
            <flux:text class="text-sm text-muted">{{ __('Tritt dem Raum bei, um mitzuschreiben.') }}</flux:text>
            <flux:button size="sm" variant="primary" icon="plus" class="icon-btn-touch" x-ref="joinButton"
                         x-on:click="join().then(() => $nextTick(() => $refs.composer?.focus()))" ::disabled="joining">
                <span x-text="joining ? @js($jsVar9) : @js($jsVar10)"></span>
            </flux:button>
        </div>

        {{-- P11: Relay-Gate — der Relay hat den Read abgewiesen; Raumzustand
             unbekannt, also weder Leerkarte darüber noch ein Beitreten-Knopf.
             `x-if` wie beim Gast-Gate: kein Grund, die Karte für Mitglieder im
             DOM zu tragen. Kein Knopf: es gibt keine Handlung, die von hier aus
             gelingen kann (Anmeldung vorhanden, Join scheitert nachweislich). --}}
        <template x-if="gatedOut">
            <x-group::room-gate />
        </template>

        {{-- Gast: die Aussage statt eines Composers, der nichts kann.

             Hier stand bis P4 ein feld-förmiger Gast-Composer. Er war gut gebaut,
             aber er versprach eine Bühne, die es nicht gibt: ohne Signer gibt es
             kein NIP-42-AUTH und ohne AUTH keinen Lesezugriff, der Raum bleibt
             also leer. Ein Schreibfeld über einem leeren Verlauf lädt zu etwas ein,
             das erst nach der Anmeldung überhaupt beginnt.

             KEINE Bindung mehr an `membershipReady`: für einen Gast ist die
             Mitgliedschaft keine offene Frage — und der 39002-REQ, aus dem der
             Zustand käme, wird ihm ohnehin verweigert.

             `x-if` statt `x-show`: die Gate-Insel startet beim Mount einen eigenen
             Directory-Sub. Mit `x-show` liefe der bei JEDEM Raumbesuch mit, auch
             für Mitglieder, die die Fläche nie sehen. --}}
        <template x-if="! $store.authGate?.authed">
            <x-group::verein-gate context="{{ __('Räume und Chat') }}" />
        </template>
    </div>

    {{-- Löschen bestätigen (NIP-09 ist unwiderruflich). --}}
    <flux:modal name="delete-message" class="max-w-sm">
        <div class="space-y-4">
            <flux:heading size="lg">{{ __('Nachricht löschen?') }}</flux:heading>
            <flux:text>{{ __('Das lässt sich nicht rückgängig machen.') }}</flux:text>
            <div class="flex justify-end gap-2">
                <flux:modal.close><flux:button variant="ghost">{{ __('Abbrechen') }}</flux:button></flux:modal.close>
                <flux:button variant="danger" x-on:click="confirmDelete()" ::disabled="deleting">{{ __('Löschen') }}</flux:button>
            </div>
        </div>
    </flux:modal>

    {{-- Fork off! (NIP-56 kind 1984): Grund-Auswahl + optionaler Freitext. Geht ohne
         `h`/PROTECTED ans Relay (keine Group-Message). --}}
    <flux:modal name="report-message" class="max-w-sm">
        <div class="space-y-4">
            <flux:heading size="lg">Fork off! 🍴</flux:heading>
            <flux:select x-model="reportReason" label="{{ __('Grund') }}">
                <flux:select.option value="spam">{{ __('Spam') }}</flux:select.option>
                <flux:select.option value="profanity">{{ __('Beleidigung') }}</flux:select.option>
                <flux:select.option value="impersonation">{{ __('Identitätsdiebstahl') }}</flux:select.option>
                <flux:select.option value="other">{{ __('Sonstiges') }}</flux:select.option>
            </flux:select>
            <flux:textarea x-model="reportText" label="{{ __('Details (optional)') }}" rows="2"
                           placeholder="{{ __('Was ist mit dieser Nachricht?') }}" />
            <div class="flex justify-end gap-2">
                <flux:modal.close><flux:button variant="ghost">{{ __('Abbrechen') }}</flux:button></flux:modal.close>
                <flux:button variant="danger" x-on:click="confirmReport()" ::disabled="reporting">Fork off!</flux:button>
            </div>
        </div>
    </flux:modal>

    {{-- Admin: fremde Nachricht entfernen (NIP-86 banevent). Relay-seitige Löschung,
         unwiderruflich. Nur erreichbar, wenn isAdmin die Menü-Einträge freigibt. --}}
    <flux:modal name="admin-delete-message" class="max-w-sm">
        <div class="space-y-4">
            <flux:heading size="lg">{{ __('Nachricht entfernen?') }}</flux:heading>
            <flux:text>{{ __('Als Admin entfernst du diese fremde Nachricht relay-seitig für alle. Das lässt sich nicht rückgängig machen.') }}</flux:text>
            <div class="flex justify-end gap-2">
                <flux:modal.close><flux:button variant="ghost">{{ __('Abbrechen') }}</flux:button></flux:modal.close>
                <flux:button variant="danger" x-on:click="confirmAdminDelete()" ::disabled="moderating">{{ __('Entfernen') }}</flux:button>
            </div>
        </div>
    </flux:modal>

    {{-- Admin: Autor bannen (NIP-86 banpubkey) — NICHT angeboten.
         no removal or ban of members here — the association does not remove or ban its
         members (decision 2026-09-03); the timed suspension on the member screen
         (`⚡directory.blade.php`, Buzz kind 9042) is the strongest measure this surface
         offers, and there is no escalation step above it. Removing a single MESSAGE
         (`admin-delete-message` above) is deliberately untouched: it hits content, not a
         person. The write path stays (JS `confirmBanAuthor`) — it carries the zooid arm.
    <flux:modal name="ban-author" class="max-w-sm">
        <div class="space-y-4">
            <flux:heading size="lg">{{ __('Autor bannen?') }}</flux:heading>
            <flux:text>{{ __('Der Autor verliert die Mitgliedschaft im Space und alle seine bisherigen Nachrichten werden relay-seitig gelöscht. Das lässt sich nicht rückgängig machen.') }}</flux:text>
            <div class="flex justify-end gap-2">
                <flux:modal.close><flux:button variant="ghost">{{ __('Abbrechen') }}</flux:button></flux:modal.close>
                <flux:button variant="danger" x-on:click="confirmBanAuthor()" ::disabled="moderating">{{ __('Bannen') }}</flux:button>
            </div>
        </div>
    </flux:modal>
    --}}

    {{-- Zap senden (Z3, NIP-57): Sats-Presets + Freibetrag + Emoji/Kommentar. Wallet
         verbunden → Auto-Pay; sonst QR-Fallback (bolt11 + Live-Receipt-Erkennung).
         Inline-Sheet am nostrRoomChat-Root-Scope (kein eigenes Island — nur EINE
         Modal-Instanz). Modal-Close bricht die offene QR-Sub ab (closeZap). --}}
    <flux:modal name="zap-message" class="max-w-sm" x-on:close="closeZap()">
        <div class="space-y-4">
            <div class="flex items-center gap-2">
                <flux:icon.bolt variant="solid" class="size-6 text-brand-500" />
                <flux:heading size="lg">{{ __('Zap senden') }}</flux:heading>
            </div>
            <flux:text class="text-sm text-muted" x-show="zapFor" x-cloak>
                {{ __('An') }} <span class="text-strong" x-text="zapFor?.name"></span>
            </flux:text>

            {{-- Empfänger wird geprüft (Zapper-Auflösung im Hintergrund, kann wegen NIP-42-AUTH
                 an die Outbox-Relays kurz dauern). Sheet ist schon offen → der Nutzer sieht sofort etwas. --}}
            <div x-show="zapResolving" x-cloak class="flex items-center gap-2 text-xs text-muted" role="status">
                <flux:icon.arrow-path class="size-4 shrink-0 animate-spin" />
                <span>{{ __('Empfänger wird geprüft …') }}</span>
            </div>

            {{-- Empfänger nicht bezahlbar: gültige Adresse, aber kein erreichbarer LNURL-Endpoint.
                 role="alert" → Screenreader kündigt den async auftauchenden Grund an, warum „Senden" aus bleibt. --}}
            {{-- Prüfung scheiterte bei UNS (Timeout/Netz) — bewusst KEINE Aussage über den
                 Empfänger, sondern ein erneuter Versuch. --}}
            <div x-show="zapResolveFailed" x-cloak role="alert"
                 class="flex items-start gap-2 rounded-tile border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
                <flux:icon.exclamation-triangle class="mt-0.5 size-4 shrink-0" />
                <span class="flex-1">{{ __('Der Empfänger konnte gerade nicht geprüft werden (Zeitüberschreitung).') }}</span>
                <button type="button" x-on:click="openZap(zapFor)" class="shrink-0 font-medium underline">{{ __('Erneut versuchen') }}</button>
            </div>

            <div x-show="zapUnavailable" x-cloak role="alert"
                 class="flex items-start gap-2 rounded-tile border border-red-500/40 bg-red-500/5 px-3 py-2 text-xs text-red-600 dark:text-red-400">
                <flux:icon.exclamation-triangle class="mt-0.5 size-4 shrink-0" />
                <span>{{ __('Der Zahlungs-Endpoint des Empfängers ist nicht erreichbar. Bitte später erneut versuchen.') }}</span>
            </div>

            {{-- Nostrless-Hinweis (Empfänger ohne NIP-57, z. B. bitrefill.com): zahlen geht,
                 aber es entsteht KEIN Nostr-Event → der Zap ist im Raum NICHT sichtbar.
                 `!zapInvoice` → im QR-Zustand übernimmt der QR-eigene Nostrless-Text (keine Dopplung).
                 role="status" → async Einblendung wird angesagt (wie die Prüf-Box). --}}
            <div x-show="zapNostrless && !zapInvoice" x-cloak role="status"
                 class="flex items-start gap-2 rounded-tile border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
                <flux:icon.exclamation-triangle class="mt-0.5 size-4 shrink-0" />
                <span>{{ __('Diese Lightning-Adresse unterstützt keine Nostr-Zaps. Du kannst trotzdem zahlen — die Zahlung erscheint dann aber nicht als Zap im Raum.') }}</span>
            </div>

            {{-- Eingabe-Zustand (solange keine QR-Rechnung offen ist). --}}
            <div x-show="!zapInvoice" class="space-y-4">
                {{-- Sats-Presets: 21 hervorgehoben (EINUNDZWANZIG). Als Radiogroup ausgezeichnet
                     (exklusive Betragswahl) → SR sagt „ausgewählt" an, nicht nur „Button". --}}
                <div class="grid grid-cols-4 gap-2" role="radiogroup" aria-label="{{ __('Betrag wählen') }}">
                    <template x-for="p in zapPresets" :key="p">
                        <button type="button" x-on:click="zapAmount = p" role="radio" :aria-checked="zapAmount === p"
                                class="pressable rounded-tile border px-2 py-2 font-mono text-sm tabular-nums transition-colors motion-reduce:transition-none"
                                :class="zapAmount === p ? 'border-brand-500 bg-brand-500/15 text-brand-500' : 'border-white/10 bg-white/5 text-muted hover:border-brand-500/50'"
                                x-text="p"></button>
                    </template>
                </div>
                <flux:input type="number" min="1" x-model.number="zapAmount" label="{{ __('Betrag (Sats)') }}" />
                <flux:input x-model="zapContent" label="{{ __('Kommentar') }}" placeholder="⚡" />
                <div class="flex justify-end gap-2">
                    <flux:modal.close><flux:button variant="ghost">{{ __('Abbrechen') }}</flux:button></flux:modal.close>
                    <flux:button variant="primary" icon="bolt" x-on:click="confirmZap()" ::disabled="zapping || zapResolving || zapUnavailable || zapResolveFailed">
                        <span x-text="zapResolving ? @js($jsVar14) : (zapping ? @js($jsVar15) : (zapNostrless ? @js($jsVar16) : @js($jsVar17)))"></span>
                    </flux:button>
                </div>
            </div>

            {{-- QR-Fallback (kein Wallet): Rechnung als QR + kopierbar, Live-Warten.
                 Sanfte Erscheinung (kurze Opacity-Transition, ZAPS.md Z6). --}}
            <div x-show="zapInvoice" x-cloak x-transition.opacity.duration.200ms class="space-y-3">
                <flux:text x-show="!zapNostrless" class="text-sm text-muted" role="status">{{ __('Mit einer Lightning-Wallet scannen oder Rechnung kopieren — die Zahlung wird automatisch erkannt.') }}</flux:text>
                <flux:text x-show="zapNostrless" x-cloak class="text-sm text-muted" role="status">{{ __('Mit einer Lightning-Wallet scannen oder Rechnung kopieren. Danach das Fenster schließen — diese Zahlung erscheint nicht als Zap im Raum.') }}</flux:text>
                <div class="flex justify-center">
                    <img :src="zapQr" alt="{{ __('Lightning-Rechnung als QR-Code') }}" class="rounded-tile bg-white p-2" width="256" height="256" />
                </div>
                <div class="flex items-center gap-2">
                    <flux:input readonly ::value="zapInvoice" class="flex-1 font-mono text-xs" />
                    <flux:button size="sm" variant="ghost" icon="clipboard" x-ref="zapCopyBtn" x-on:click="copy(zapInvoice, @js($jsVar18))" aria-label="{{ __('Rechnung kopieren') }}" />
                </div>
                <a href="{{ route('group.wallet') }}" wire:navigate class="block text-center text-sm text-brand-500 hover:underline">{{ __('Wallet verbinden für 1-Klick-Zaps') }}</a>
                <flux:modal.close><flux:button variant="ghost" class="w-full">{{ __('Fertig') }}</flux:button></flux:modal.close>
            </div>
        </div>
    </flux:modal>

    {{-- Umfrage erstellen (C5, NIP-88 kind 1068): Frage + ≥2 Optionen + Einfach-/
         Mehrfachwahl + optionales Enddatum. Publiziert mit `["h", h]` in den Raum
         (erscheint als Poll-Karte im Verlauf). Poll-Erstellen ist Teil von C5. --}}
    <flux:modal name="create-poll" class="max-w-md">
        <div class="space-y-4">
            <flux:heading size="lg">{{ __('Umfrage erstellen') }}</flux:heading>
            <flux:input x-model="pollTitle" label="{{ __('Frage') }}" placeholder="{{ __('Was möchtest du fragen?') }}" />
            <div class="space-y-2">
                <flux:label>{{ __('Optionen') }}</flux:label>
                {{-- Zeile = Drop-Zone; nur der Griff ist draggable (so bleibt das Input
                     frei bedienbar). Live-Reorder beim Drüberziehen (pollReorder). --}}
                <template x-for="(opt, i) in pollOptionList" :key="opt.id">
                    <div class="flex items-center gap-2 transition-opacity"
                         x-on:dragover.prevent="pollReorder(opt.id)" x-on:drop.prevent="pollDragEnd()"
                         :class="_draggedOption === opt.id ? 'opacity-40' : ''">
                        <span draggable="true" x-on:dragstart="pollDragStart(opt.id)" x-on:dragend="pollDragEnd()"
                              class="shrink-0 cursor-grab text-muted active:cursor-grabbing" role="button"
                              :aria-label="@js($jsVar19).replace(':n', i + 1)">
                            <flux:icon.bars-3 variant="micro" />
                        </span>
                        {{-- ::attr (escaped) rendert den Wert LITERAL → `@js()` würde
                             roh ins DOM leaken (Alpine: „Invalid token"). Js::from via
                             {{ }} liefert das lokalisierte JS-String-Literal zur Compile-Zeit. --}}
                        <flux:input x-model="opt.value" class="flex-1" ::placeholder="{{ \Illuminate\Support\Js::from(__('Option :n')) }}.replace(':n', i + 1)" />
                        <flux:button size="sm" variant="ghost" icon="minus-circle"
                                     x-on:click="removePollOption(opt.id)" aria-label="{{ __('Option entfernen') }}" />
                    </div>
                </template>
                <flux:button size="sm" variant="ghost" icon="plus-circle" x-on:click="addPollOption()">
                    {{ __('Option hinzufügen') }}
                </flux:button>
            </div>
            <flux:select x-model="pollTypeSel" label="{{ __('Auswahl') }}">
                <flux:select.option value="singlechoice">{{ __('Einfachwahl') }}</flux:select.option>
                <flux:select.option value="multiplechoice">{{ __('Mehrfachwahl') }}</flux:select.option>
            </flux:select>
            <flux:input type="datetime-local" x-model="pollEndsAt" label="{{ __('Endet am (optional)') }}" />
            <div class="flex justify-end gap-2">
                <flux:modal.close><flux:button variant="ghost">{{ __('Abbrechen') }}</flux:button></flux:modal.close>
                <flux:button variant="primary" x-on:click="submitPoll()" ::disabled="pollBusy">{{ __('Erstellen') }}</flux:button>
            </div>
        </div>
    </flux:modal>

    {{-- Zap-Ziel erstellen (Z5, NIP-75 kind 9041): Titel + optionale Details + Sats-Ziel.
         Publiziert mit `["h", h]` in den Raum (erscheint als Ziel-Karte im Verlauf);
         Beitragen läuft über den bestehenden Zap-Pfad (openZap auf die Ziel-Nachricht). --}}
    <flux:modal name="create-goal" class="max-w-md">
        <div class="space-y-4">
            <div class="flex items-center gap-2">
                <flux:icon.trophy variant="solid" class="size-6 text-brand-500" />
                <flux:heading size="lg">{{ __('Zap-Ziel erstellen') }}</flux:heading>
            </div>
            <flux:input x-model="goalTitle" label="{{ __('Titel') }}" placeholder="{{ __('Wofür sammelst du?') }}" />
            <flux:textarea x-model="goalSummary" label="{{ __('Details (optional)') }}" rows="2" placeholder="{{ __('Worum geht es?') }}" />
            <flux:input type="number" min="1" x-model.number="goalTargetSats" label="{{ __('Ziel (Sats)') }}" />
            <div class="flex justify-end gap-2">
                <flux:modal.close><flux:button variant="ghost">{{ __('Abbrechen') }}</flux:button></flux:modal.close>
                <flux:button variant="primary" icon="trophy" x-on:click="submitGoal()" ::disabled="goalBusy">
                    <span x-text="goalBusy ? @js($jsVar20) : @js($jsVar21)"></span>
                </flux:button>
            </div>
        </div>
    </flux:modal>

    {{-- Bild zuschneiden (C6a): eigenes Overlay statt flux:modal, damit cropperjs auf
         einem sofort sichtbaren Container fester Höhe initialisiert (eine Modal-Transition
         lieferte 0px → versetzte Doppelanzeige). `_cropSrc` steuert Sichtbarkeit; cropperjs
         übernimmt das <img>. A11y-Basis: role/aria-modal, Escape schließt, Initialfokus.
         `x-effect` fokussiert die Bestätigen-Taste, sobald das Overlay erscheint. --}}
    {{-- z-[60] > Thread-Overlay (z-50): der Cropper wird auch AUS dem Thread heraus geöffnet
         und liegt dann darüber. Beide Overlays haben `.window`-Escape- bzw. `click.outside`-
         Handler; damit ein „nur den Zuschnitt abbrechen"-ESC/Klick NICHT auch den Thread abreißt,
         stoppt der Cropper (früher im DOM → feuert zuerst) die Propagation, und die Thread-
         Handler tragen zusätzlich den `!_cropSrc`-Guard (analog zum bestehenden `!lightboxSrc`). --}}
    <div x-show="_cropSrc" x-cloak role="dialog" aria-modal="true" aria-label="{{ __('Bild zuschneiden') }}"
         x-effect="_cropSrc && $nextTick(() => $refs.cropConfirm?.focus())"
         x-on:keydown.escape.window="if (_cropSrc) { $event.stopImmediatePropagation(); cancelCrop() }"
         class="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
        {{-- Zentrierte Karte statt Vollflächen-Wüste: klare Kopf-/Bühne-/Fuß-Struktur. --}}
        <div class="surface-card flex max-h-[90vh] w-full max-w-2xl flex-col gap-4 p-4 shadow-2xl sm:p-5"
             x-on:click.outside="$event.stopImmediatePropagation(); cancelCrop()">
            <div class="flex items-center gap-2">
                <flux:icon.scissors variant="solid" class="size-5 text-brand-500" />
                <flux:heading size="lg">{{ __('Bild zuschneiden') }}</flux:heading>
            </div>

            {{-- Crop-Bühne mit FESTER Höhe: cropperjs misst den Container beim Init —
                 ohne konkrete Höhe (flex-1) berechnete es das Layout auf 0px → Bug. --}}
            <div class="h-[55vh] overflow-hidden rounded-card bg-black/40">
                <img x-ref="cropImg" :src="_cropSrc" alt="" class="block max-w-full" style="max-height:55vh" />
            </div>

            {{-- Werkzeugleiste: Seitenverhältnisse (Frei/quadratisch/quer/hoch) + Drehen/Spiegeln. --}}
            <div class="flex flex-wrap items-center justify-center gap-2" role="group" aria-label="{{ __('Zuschnitt-Werkzeuge') }}">
                <template x-for="r in [
                    { label: @js($jsVar22), v: NaN },
                    { label: '1:1', v: 1 },
                    { label: '4:3', v: 4/3 },
                    { label: '3:4', v: 3/4 },
                    { label: '16:9', v: 16/9 },
                ]" :key="r.label">
                    <button type="button" x-on:click="setCropRatio(r.v)"
                            class="pressable rounded-tile border px-3 py-1.5 text-sm font-medium tabular-nums transition-colors motion-reduce:transition-none"
                            :aria-pressed="Number.isNaN(r.v) ? Number.isNaN(cropRatio) : cropRatio === r.v"
                            :class="(Number.isNaN(r.v) ? Number.isNaN(cropRatio) : cropRatio === r.v)
                                ? 'border-brand-500 bg-brand-500/15 text-brand-500'
                                : 'border-white/10 bg-white/5 text-muted hover:border-brand-500/50'"
                            x-text="r.label"></button>
                </template>
                <div class="mx-1 h-6 w-px bg-white/10" aria-hidden="true"></div>
                <flux:button size="sm" variant="ghost" icon="arrow-path" x-on:click="rotateCrop()"
                             aria-label="{{ __('Um 90° drehen') }}" />
                <flux:button size="sm" variant="ghost" icon="arrows-right-left" x-on:click="flipCrop()"
                             aria-label="{{ __('Horizontal spiegeln') }}" />
            </div>

            <div class="flex justify-end gap-2">
                <flux:button variant="ghost" x-on:click="cancelCrop()" ::disabled="uploadingImage">{{ __('Abbrechen') }}</flux:button>
                <flux:button variant="primary" icon="check" x-ref="cropConfirm" x-on:click="confirmCrop()"
                             ::data-loading="uploadingImage" ::disabled="uploadingImage">
                    <span x-text="uploadingImage ? @js($jsVar23) : @js($jsVar24)"></span>
                </flux:button>
            </div>
        </div>
    </div>

    {{-- Interaktions-Menü (native App): Aktionen zur angetippten Nachricht.
         Web nutzt stattdessen das Zeilen-Popover (flux:dropdown). Einträge wachsen
         mit C1–C4; `menuFor` hält die Zielnachricht. --}}
    <flux:modal name="message-menu" class="max-w-sm">
        <div class="flex flex-col gap-1">
            <flux:heading size="sm" class="mb-1">{{ __('Nachricht') }}</flux:heading>
            {{-- Reaktions-Picker (C1, native App): volles Emoji-Panel. react() schließt
                 das Modal selbst (closeMessageMenu) → kein onpick nötig. --}}
            {{-- OPTIMIZE: erst mounten, wenn das Menü offen ist (menuFor truthy). Ohne
                 x-if lief emojiPicker().init() beim Raum-Render und lud compact.json
                 (590kB) sofort in den Kaltstart. Vgl. Web-Popover-Vorbild oben. --}}
            <div class="mb-1">
                <template x-if="menuFor">
                    <x-group::emoji-picker message="menuFor" />
                </template>
            </div>
            {{-- Zap (Z3, NIP-57): WICHTIGSTE Aktion → ganz vorne, Brand-Gelb (`text-brand-500!`
                 überschreibt ghost-Textfarbe). openZap schließt das Menü selbst. --}}
            <flux:button variant="ghost" icon="bolt" class="w-full justify-start text-brand-500!"
                         x-show="zapsEnabled && menuFor?.zappable" x-cloak
                         x-on:click="if (menuFor) openZap(menuFor)">Zap</flux:button>
            {{-- Antworten: im Thread verschachtelte Kommentar-Antwort (setThreadReply), sonst Raum-q-Reply. --}}
            <flux:button variant="ghost" icon="arrow-uturn-left" class="w-full justify-start"
                         x-on:click="if (menuFor) { _menuInThread ? setThreadReply(menuFor) : setReply(menuFor); closeMessageMenu() }">{{ __('Antworten') }}</flux:button>
            {{-- Raum-only (x-show="!_menuInThread"): an einem Thread-Kommentar (kind 1111) würden diese
                 kind-9-Aktionen malformte Events erzeugen (Sub-Thread/Quote/Edit/Delete). Deshalb im Thread aus. --}}
            <flux:button variant="ghost" icon="chat-bubble-oval-left" class="w-full justify-start" x-show="!_menuInThread" x-cloak
                         x-on:click="if (menuFor) openThread(menuFor)">{{ __('Im Thread antworten') }}</flux:button>
            <flux:button variant="ghost" icon="chat-bubble-left-right" class="w-full justify-start" x-show="!_menuInThread" x-cloak
                         x-on:click="if (menuFor) share(menuFor)">{{ __('Zitieren') }}</flux:button>
            <flux:button variant="ghost" icon="pencil-square" class="w-full justify-start"
                         x-show="!_menuInThread && menuFor && canEdit(menuFor)" x-cloak
                         x-on:click="if (menuFor) startEdit(menuFor)">{{ __('Bearbeiten') }}</flux:button>
            {{-- Anpinnen/Loslösen (P6b) — dieselben zwei Bedingungen wie im Web-Popover
                 (`partials/chat-row.blade.php`), Begründung dort. Gelesen wird aus
                 `$store.roomPins`; `nostrRoomChat` bekommt dafür kein eigenes Feld. --}}
            {{-- `::disabled` an `busy` — Begründung wie im Web-Popover
                 (`partials/chat-row.blade.php`): ohne die Bindung wäre der Eintrag
                 während eines laufenden Pin/Unpin ein stiller Blindgänger. --}}
            <flux:button variant="ghost" icon="map-pin" class="w-full justify-start"
                         x-show="!_menuInThread && menuFor && $store.roomPins?.canPin && !$store.roomPins?.isPinned(menuFor.id)" x-cloak
                         ::disabled="$store.roomPins.busy"
                         x-on:click="if (menuFor) { $store.roomPins.toggle(menuFor.id); closeMessageMenu() }">{{ __('Anpinnen') }}</flux:button>
            <flux:button variant="ghost" icon="map-pin" class="w-full justify-start"
                         x-show="!_menuInThread && menuFor && $store.roomPins?.canUnpin(menuFor.id)" x-cloak
                         ::disabled="$store.roomPins.busy"
                         x-on:click="if (menuFor) { $store.roomPins.toggle(menuFor.id); closeMessageMenu() }">{{ __('Loslösen') }}</flux:button>
            {{-- Merken (P2, NIP-51) — dieselben Bedingungen wie im Web-Popover
                 (`partials/chat-row.blade.php`), Begründung dort. Ohne `!_menuInThread`:
                 ein `["e", <id>]` ist kind-agnostisch, an einem Thread-Kommentar
                 entsteht dieselbe gültige Liste wie an einer Nachricht. --}}
            <flux:button variant="ghost" icon="bookmark" class="w-full justify-start"
                         x-show="menuFor && $store.bookmarks?.canBookmark && !$store.bookmarks?.isBookmarked(menuFor.id)" x-cloak
                         ::disabled="$store.bookmarks.busy"
                         x-on:click="if (menuFor) { $store.bookmarks.toggle(menuFor.id); closeMessageMenu() }">{{ __('Merken') }}</flux:button>
            <flux:button variant="ghost" icon="bookmark-slash" class="w-full justify-start"
                         x-show="menuFor && $store.bookmarks?.canBookmark && $store.bookmarks?.isBookmarked(menuFor.id)" x-cloak
                         ::disabled="$store.bookmarks.busy"
                         x-on:click="if (menuFor) { $store.bookmarks.toggle(menuFor.id); closeMessageMenu() }">{{ __('Nicht mehr merken') }}</flux:button>
            {{-- Fork off! (fremd) / Löschen (eigen): askReport/askDelete merken die Zielnachricht,
                 dann schließt das Menü-Modal (öffnet Fork-off!- bzw. Löschen-Bestätigung). --}}
            <flux:button variant="ghost" icon="flag" class="w-full justify-start" x-show="!menuFor?.mine" x-cloak
                         x-on:click="if (menuFor) { askReport(menuFor); closeMessageMenu() }">Fork off!</flux:button>
            <flux:button variant="danger" icon="trash" class="w-full justify-start" x-show="!_menuInThread && menuFor?.mine" x-cloak
                         x-on:click="if (menuFor) { askDelete(menuFor); closeMessageMenu() }">{{ __('Löschen') }}</flux:button>
            {{-- Moderation (P1, NIP-86): nur Admins, nur fremde Nachrichten. Wirkt in Raum UND
                 Thread (banevent kind-agnostisch). askAdminDelete merkt das Ziel, dann schließt
                 das Menü-Modal (öffnet die Bestätigung). --}}
            <flux:button variant="danger" icon="trash" class="w-full justify-start" x-show="isAdmin && !menuFor?.mine" x-cloak
                         x-on:click="if (menuFor) { askAdminDelete(menuFor); closeMessageMenu() }">{{ __('Nachricht entfernen') }}</flux:button>
            {{-- „Autor bannen" (banpubkey) NICHT angeboten.
                 no removal or ban of members here — the association does not remove or ban
                 its members (decision 2026-09-03); the timed suspension on the member screen
                 (`⚡directory.blade.php`, Buzz kind 9042) is the strongest measure this
                 surface offers. „Nachricht entfernen" above stays operable: it hits content,
                 not a person. The write path stays (JS `confirmBanAuthor`).
            <flux:button variant="danger" icon="no-symbol" class="w-full justify-start" x-show="isAdmin && !menuFor?.mine" x-cloak
                         x-on:click="if (menuFor) { askBanAuthor(menuFor); closeMessageMenu() }">{{ __('Autor bannen') }}</flux:button>
            --}}
            {{-- C4: Kopieren/Info (nur lesen). copy*/openInfo schließen das Menü selbst. --}}
            <flux:separator class="my-1" />
            <flux:button variant="ghost" icon="link" class="w-full justify-start"
                         x-on:click="if (menuFor) copyNevent(menuFor)">{{ __('Event-Link kopieren') }}</flux:button>
            <flux:button variant="ghost" icon="user-circle" class="w-full justify-start"
                         x-on:click="if (menuFor) copyNpub(menuFor)">{{ __('npub kopieren') }}</flux:button>
            <flux:button variant="ghost" icon="code-bracket" class="w-full justify-start"
                         x-on:click="if (menuFor) copyJson(menuFor)">{{ __('JSON kopieren') }}</flux:button>
            <flux:button variant="ghost" icon="information-circle" class="w-full justify-start"
                         x-on:click="if (menuFor) openInfo(menuFor)">{{ __('Info') }}</flux:button>
        </div>
    </flux:modal>

    {{-- Nachricht-Info (C4): Roh-Event, Zeitpunkt, gesehene Relays. Nur lesen. --}}
    <flux:modal name="message-info" class="max-w-lg">
        <template x-if="infoFor">
            <div class="space-y-4">
                <flux:heading size="lg">{{ __('Nachricht-Details') }}</flux:heading>
                <div class="space-y-1">
                    <flux:text class="text-xs text-muted">{{ __('Erstellt') }}</flux:text>
                    <flux:text class="text-sm" x-text="infoFor.createdAt"></flux:text>
                </div>
                <div class="space-y-1">
                    <flux:text class="text-xs text-muted">{{ __('Event-Link') }}</flux:text>
                    <button type="button" x-on:click="copy(infoFor.nevent, @js($jsVar25))"
                            class="pressable surface-card block w-full truncate rounded-tile px-2 py-1.5 text-left font-mono text-xs"
                            x-text="infoFor.nevent"></button>
                </div>
                <div class="space-y-1">
                    <flux:text class="text-xs text-muted">{{ __('Autor (npub)') }}</flux:text>
                    <button type="button" x-on:click="copy(infoFor.npub, @js($jsVar26))"
                            class="pressable surface-card block w-full truncate rounded-tile px-2 py-1.5 text-left font-mono text-xs"
                            x-text="infoFor.npub"></button>
                </div>
                <div class="space-y-1" x-show="infoFor.seenOn.length">
                    <flux:text class="text-xs text-muted">{{ __('Gesehen auf') }}</flux:text>
                    <div class="flex flex-wrap gap-1">
                        <template x-for="relay in infoFor.seenOn" :key="relay">
                            <flux:badge size="sm" x-text="relay"></flux:badge>
                        </template>
                    </div>
                </div>
                <div class="space-y-1">
                    <div class="flex items-center justify-between">
                        <flux:text class="text-xs text-muted">{{ __('Roh-Event') }}</flux:text>
                        <flux:button size="xs" variant="ghost" icon="clipboard" class="icon-btn-touch" x-on:click="copy(infoFor.json, @js($jsVar27))">{{ __('Kopieren') }}</flux:button>
                    </div>
                    <pre class="surface-card max-h-60 overflow-auto rounded-tile p-2 text-xs"><code x-text="infoFor.json"></code></pre>
                </div>
                <div class="flex justify-end">
                    <flux:modal.close><flux:button variant="ghost">{{ __('Schließen') }}</flux:button></flux:modal.close>
                </div>
            </div>
        </template>
    </flux:modal>

    {{-- Lightbox: Vollbild eines angeklickten Inline-Bilds. Sie liegt seit P3 in
         `components/lightbox-overlay.blade.php`, weil die Artikel-Vollansicht dieselbe
         Fläche braucht. Der Vertrag steht dort im Dateikopf; erfüllt wird er hier von
         `nostrRoom`, das `lightboxSrc` führt. --}}
    <x-group::lightbox-overlay />

</div>
</x-group::app-frame>
