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
        $url = SpaceCache::spaceUrl();
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

{{-- Chat-Bühne: Kopf + Verlauf + Composer unter EINEM Alpine-Scope (M4 lesen, M5 schreiben). --}}
<div x-data="nostrRoomChat(@js($h), @js($roomName ?? $h), @js($nevent))" class="mx-auto flex h-dvh w-full max-w-md md:max-w-lg lg:max-w-2xl flex-col px-4 pt-[max(env(safe-area-inset-top),1rem)] pb-[max(env(safe-area-inset-bottom),1rem)]">

    {{-- P2: Der Raum ist eine chrome-lose Detail-Ebene (kein Tab, keine Bottom-Nav)
         und rendert daher den globalen Signer/Reconnect-Strip selbst — die app-shell
         (die ihn sonst trägt) fehlt hier bewusst. `fixed` → kein Flex-Einfluss,
         liegt im Root-Div (Livewire-SFC: genau eine Wurzel). --}}
    <x-group::status-strip />

    <x-group::app-header :title="'# '.($roomName ?? $h)" :title-expr="json_encode('# ').' + roomName'" :back="route('group.spaces')" class="shrink-0">
        @if ($roomPicture)
            <x-slot:leading>
                <flux:avatar circle size="sm" src="{{ \Einundzwanzig\Group\ImageProxy::url($roomPicture) }}" name="{{ $roomName ?? $h }}" />
            </x-slot:leading>
        @endif
        <x-slot:actions>
            {{-- Mitglied → Verlassen (kind 9022). Beitreten liegt beim Composer. --}}
            <flux:button size="xs" variant="ghost" icon="arrow-right-start-on-rectangle" class="icon-btn-touch"
                         x-show="joined" x-cloak x-on:click="leave()" ::disabled="joining" aria-label="{{ __('Raum verlassen') }}">
                {{ __('Verlassen') }}
            </flux:button>
        </x-slot:actions>
    </x-group::app-header>

    <div class="relative flex min-h-0 flex-1 flex-col">

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
        <div x-ref="scroll" wire:ignore x-on:scroll.throttle.50ms="onScroll()"
             role="log" aria-live="polite" aria-relevant="additions" aria-label="{{ __('Chat-Verlauf') }}"
             ::aria-busy="loading && messages.length === 0"
             class="flex flex-col-reverse min-h-0 flex-1 overflow-y-auto px-1 pb-2 transition-opacity"
             :class="(!firstPaintDone && messages.length > 0) ? 'opacity-0' : 'opacity-100'">

            {{-- Erstes Laden: SERVER-SEITIG gerendertes Skeleton (kein x-cloak/x-if, statische
                 Rows via @for) → steht ab dem ERSTEN Paint da. Sonst blitzte der Chat-Bereich
                 beim F5 weiß auf, bis Alpine bootet (~165ms) und die x-if/x-for-Templates
                 auswertet. `x-show` blendet es aus, sobald Nachrichten geladen sind. --}}
            <div x-show="loading && messages.length === 0" class="space-y-3 pt-4">
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

            {{-- Leerer Raum --}}
            <template x-if="!loading && messages.length === 0">
                <div class="surface-card empty-state mt-8 p-6 text-center">
                    <flux:icon.chat-bubble-left-right class="mx-auto size-8 text-zinc-400" />
                    <flux:text class="mt-2">{{ __('Noch keine Nachrichten in diesem Raum.') }}</flux:text>
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

        {{-- Lade-Spinner oben, während der Auto-Scroller (createScroller) ältere Nachrichten
             nachzieht — reines Feedback; das Laden selbst passiert beim Hochscrollen von allein. --}}
        <div class="pointer-events-none absolute inset-x-0 top-2 flex justify-center" x-show="loadingMore" x-cloak
             x-transition.opacity>
            <span class="surface-card rounded-full px-3 py-1 text-xs text-muted shadow-md">{{ __('Lädt ältere…') }}</span>
        </div>

        {{-- Zurück ans Ende, sobald hochgescrollt — mit Zähler, wenn neue Nachrichten warten.
             Zwei Buttons: flux erkennt „Icon-only vs. Pille" server-seitig am Slot (ein
             x-show-Span bliebe immer „nicht leer" → Pfeil säße links statt zentriert). --}}
        {{-- Zeigt, sobald der User nicht mehr am Boden ist (atBottom = Math.abs(scrollTop) < 60, column-reverse). --}}
        <div class="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center" x-show="firstPaintDone && !atBottom" x-cloak
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

    {{-- Fehler (Relay lehnt ab, AUTH etc.) erscheinen als globaler Toast. --}}

    {{-- Composer nur für Mitglieder; sonst Beitreten-Hinweis. Mitgliedschaft ist
         relay-seitig (NIP-29 39002) und persistent. `membershipReady` verhindert,
         dass der Hinweis kurz aufblitzt, bevor die Members-Liste geladen ist.
         Senden ist eine reine Alpine-Aktion (welshman signiert im Browser). --}}
    <div class="shrink-0 pt-2">
        {{-- SSR-sichtbar (kein x-cloak): der Composer-Platz zeigt beim F5 sofort ein Skeleton
             statt weiß, bis die Mitgliedschaft geladen ist. --}}
        <div x-show="!membershipReady" class="skeleton h-11 rounded-card"></div>

        {{-- Compose-Kontext über dem Composer: Antworten (replyTo), Zitieren (sharing)
             oder Bearbeiten (editingId) — mit Abbrechen. --}}
        <div x-show="membershipReady && joined && (replyTo || editingId)" x-cloak
             class="surface-card mb-1 flex items-center gap-2 border-l-2 border-brand-500/60 px-3 py-1.5">
            <div class="min-w-0 flex-1">
                <div class="text-xs font-semibold text-brand-500"
                     x-text="editingId ? @js(__('Nachricht bearbeiten')) : (sharing ? @js(__('Zitieren')) : (@js(__('Antwort an ')) + (replyTo?.name ?? '')))"></div>
                <div class="truncate text-xs text-muted" x-show="replyTo" x-text="replyTo?.text"></div>
            </div>
            <flux:button size="xs" variant="ghost" icon="x-mark" class="icon-btn-touch"
                         x-on:click="editingId ? cancelEdit() : clearReply()" aria-label="{{ __('Abbrechen') }}" />
        </div>

        {{-- Anhang-Vorschau + Eingabezeile (@-Mentions, Bild, Umfrage/Zap-Ziel): geteilter Composer.
             Sanftes Opacity-Einblenden statt hartem Aufploppen, sobald die Mitgliedschaft (39002)
             geladen ist (membershipReady). --}}
        <div x-show="membershipReady && joined" x-cloak x-transition.opacity.duration.200ms>
            @include('group::partials.chat-composer', ['context' => 'room'])
        </div>

        {{-- Fehlgeschlagen: aktionable Hinweiszeile statt flüchtigem Toast (Draft ist gefüllt). --}}
        <div x-show="membershipReady && joined && sendError" x-cloak
             class="mt-1 flex items-center justify-between gap-2 rounded-tile bg-red-500/10 px-3 py-1.5 text-xs text-red-500">
            <span x-text="sendError"></span>
            <button type="button" x-on:click="send()" class="pressable shrink-0 font-semibold text-brand-500 hover:underline">
                {{ __('Erneut senden') }}
            </button>
        </div>

        <div x-show="membershipReady && !joined" x-cloak x-transition.opacity.duration.200ms
             class="surface-card flex items-center justify-between gap-3 p-3">
            <flux:text class="text-sm text-muted">{{ __('Tritt dem Raum bei, um mitzuschreiben.') }}</flux:text>
            <flux:button size="sm" variant="primary" icon="plus" class="icon-btn-touch" x-on:click="join()" ::disabled="joining">
                <span x-text="joining ? @js(__('Trete bei…')) : @js(__('Beitreten'))"></span>
            </flux:button>
        </div>
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
                    <flux:button variant="primary" icon="bolt" x-on:click="confirmZap()" ::disabled="zapping">
                        <span x-text="zapping ? @js(__('Sende…')) : @js(__('Zap senden'))"></span>
                    </flux:button>
                </div>
            </div>

            {{-- QR-Fallback (kein Wallet): Rechnung als QR + kopierbar, Live-Warten.
                 Sanfte Erscheinung (kurze Opacity-Transition, ZAPS.md Z6). --}}
            <div x-show="zapInvoice" x-cloak x-transition.opacity.duration.200ms class="space-y-3">
                <flux:text class="text-sm text-muted" role="status">{{ __('Mit einer Lightning-Wallet scannen oder Rechnung kopieren — die Zahlung wird automatisch erkannt.') }}</flux:text>
                <div class="flex justify-center">
                    <img :src="zapQr" alt="{{ __('Lightning-Rechnung als QR-Code') }}" class="rounded-tile bg-white p-2" width="256" height="256" />
                </div>
                <div class="flex items-center gap-2">
                    <flux:input readonly ::value="zapInvoice" class="flex-1 font-mono text-xs" />
                    <flux:button size="sm" variant="ghost" icon="clipboard" x-ref="zapCopyBtn" x-on:click="copy(zapInvoice, @js(__('Rechnung')))" aria-label="{{ __('Rechnung kopieren') }}" />
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
                              :aria-label="@js(__('Option ')) + (i + 1) + @js(__(' verschieben'))">
                            <flux:icon.bars-3 variant="micro" />
                        </span>
                        {{-- ::attr (escaped) rendert den Wert LITERAL → `@js()` würde
                             roh ins DOM leaken (Alpine: „Invalid token"). Js::from via
                             {{ }} liefert das lokalisierte JS-String-Literal zur Compile-Zeit. --}}
                        <flux:input x-model="opt.value" class="flex-1" ::placeholder="{{ \Illuminate\Support\Js::from(__('Option ')) }} + (i + 1)" />
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
                    <span x-text="goalBusy ? @js(__('Erstelle…')) : @js(__('Erstellen'))"></span>
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
                    { label: @js(__('Frei')), v: NaN },
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
                    <span x-text="uploadingImage ? @js(__('Lade hoch…')) : @js(__('Anhängen'))"></span>
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
            {{-- Zap (Z3, NIP-57): WICHTIGSTE Aktion → ganz vorne, Brand-Gelb (`!text-brand-500`
                 überschreibt ghost-Textfarbe). openZap schließt das Menü selbst. --}}
            <flux:button variant="ghost" icon="bolt" class="w-full justify-start !text-brand-500"
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
            {{-- Fork off! (fremd) / Löschen (eigen): askReport/askDelete merken die Zielnachricht,
                 dann schließt das Menü-Modal (öffnet Fork-off!- bzw. Löschen-Bestätigung). --}}
            <flux:button variant="ghost" icon="flag" class="w-full justify-start" x-show="!menuFor?.mine" x-cloak
                         x-on:click="if (menuFor) { askReport(menuFor); closeMessageMenu() }">Fork off!</flux:button>
            <flux:button variant="danger" icon="trash" class="w-full justify-start" x-show="!_menuInThread && menuFor?.mine" x-cloak
                         x-on:click="if (menuFor) { askDelete(menuFor); closeMessageMenu() }">{{ __('Löschen') }}</flux:button>
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
                    <button type="button" x-on:click="copy(infoFor.nevent, @js(__('Event-Link')))"
                            class="pressable surface-card block w-full truncate rounded-tile px-2 py-1.5 text-left font-mono text-xs"
                            x-text="infoFor.nevent"></button>
                </div>
                <div class="space-y-1">
                    <flux:text class="text-xs text-muted">{{ __('Autor (npub)') }}</flux:text>
                    <button type="button" x-on:click="copy(infoFor.npub, 'npub')"
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
                        <flux:button size="xs" variant="ghost" icon="clipboard" class="icon-btn-touch" x-on:click="copy(infoFor.json, 'JSON')">{{ __('Kopieren') }}</flux:button>
                    </div>
                    <pre class="surface-card max-h-60 overflow-auto rounded-tile p-2 text-xs"><code x-text="infoFor.json"></code></pre>
                </div>
                <div class="flex justify-end">
                    <flux:modal.close><flux:button variant="ghost">{{ __('Schließen') }}</flux:button></flux:modal.close>
                </div>
            </div>
        </template>
    </flux:modal>

    {{-- Thread-Ansicht (C6b, NIP-22 kind 1111): In-Room-Overlay statt eigener Route.
         Zeigt den zitierten Root + den verschachtelten Kommentar-Baum; kommentieren
         läuft über den eigenen Composer (Root oder Antwort auf einen Kommentar).
         Web + Mobile teilen dieses Panel (eine View, kein Fork). --}}
    {{-- `!lightboxSrc`-Guard: wird ein Inline-Bild IM Thread groß angesehen, darf das
         Schließen der Lightbox (Escape/Klick) NICHT auch den Thread abbauen. Der Thread
         steht im DOM VOR der Lightbox → sein window-Escape-Listener feuert zuerst und
         sieht `lightboxSrc` noch gesetzt; der Lightbox-Klick trägt zusätzlich `.stop`. --}}
    {{-- Zwei Modi: aus dem Chat geöffnet = Modal über gedimmtem Raum (threadFull=false);
         aus der Übersicht/Deep-Link = OPAKE Vollansicht (threadFull=true), Raum dahinter
         nicht sichtbar. „Zurück" führt entsprechend (Modal schließen bzw. zur Übersicht). --}}
    <div x-show="threadRootId" x-cloak role="dialog" aria-modal="true" aria-label="{{ __('Thread') }}"
         x-effect="threadRootId && $nextTick(() => $refs.threadClose?.focus())"
         x-on:keydown.escape.window="threadRootId && !lightboxSrc && !_cropSrc && backFromThread()"
         class="fixed inset-0 z-50 flex justify-center"
         :class="threadFull ? 'items-stretch bg-zinc-50 dark:bg-zinc-900' : 'items-end bg-black/70 backdrop-blur-sm sm:items-center sm:p-4'">
        <div class="surface-card flex w-full max-w-2xl flex-col overflow-hidden"
             :class="threadFull ? 'h-full' : 'max-h-[92vh] rounded-t-card shadow-2xl sm:rounded-card'"
             x-on:click.outside="!lightboxSrc && !_cropSrc && !threadFull && closeThread()">
            {{-- Kopf: Zurück + Titel + Kommentar-Zahl.
                 pt via safe-area-inset NUR in der Vollansicht (h-full berührt die Status-Leiste);
                 im Bottom-Sheet (max-h-92vh, items-end) liegt der Kopf nie am oberen Rand. --}}
            <div class="flex items-center gap-2 border-b border-white/10 px-4 pb-3"
                 :class="threadFull ? 'pt-[max(env(safe-area-inset-top),1rem)]' : 'pt-3'">
                <flux:button size="xs" variant="ghost" icon="arrow-left" class="icon-btn-touch"
                             x-ref="threadClose" x-on:click="backFromThread()" aria-label="{{ __('Zurück') }}" />
                <flux:heading size="lg" class="flex-1">{{ __('Thread') }}</flux:heading>
                <span class="shrink-0 text-xs text-muted"
                      x-text="threadCount + (threadCount === 1 ? @js(__(' Antwort')) : @js(__(' Antworten')))"></span>
            </div>

            {{-- Root + Kommentare (scrollbar). --}}
            <div x-ref="threadScroll" class="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
                {{-- Zitierte Root-Nachricht. `sticky top-0` hält sie beim Scrollen oben,
                     damit immer klar ist, in welchem Thread man ist. surface-card ist opak,
                     Kommentare scrollen darunter durch; z-10 über die Kommentare. --}}
                <template x-if="threadRoot && !threadRoot.missing">
                    <div class="surface-card sticky top-0 z-10 rounded-tile border border-brand-500/20 p-3">
                        <div class="mb-1 flex items-center gap-2">
                            <x-group::nostr-avatar picture="threadRoot.picture" name="threadRoot.name" />
                            <span class="truncate text-sm font-semibold" x-text="threadRoot.name"></span>
                            <span class="inline-flex size-4 shrink-0 items-center justify-center">
                                <x-group::nostr-nip05 nip05="threadRoot.nip05" />
                            </span>
                            <span class="shrink-0 font-mono text-[0.7rem] text-muted" x-text="threadRoot.time"></span>
                        </div>
                        <div class="chat-content text-sm break-words whitespace-pre-wrap" x-html="threadRoot.html"
                             x-on:click="if ($event.target.matches('img.chat-image')) { $event.stopPropagation(); lightboxSrc = $event.target.dataset.full }"></div>
                    </div>
                </template>
                <template x-if="threadRoot?.missing">
                    <div class="rounded-tile border border-white/10 p-3 text-sm text-muted">
                        {{ __('Originalnachricht (noch) nicht verfügbar.') }}
                    </div>
                </template>

                {{-- Kommentar-Liste: flach + chronologisch (Slack-Stil, P3 4.2) — keine
                     depth-Einrückung; Eltern-Bezug über die „Antwort auf <Autor>"-Zeile. --}}
                <template x-if="threadComments.length === 0">
                    <p class="py-6 text-center text-sm text-muted">{{ __('Noch keine Antworten — antworte als erste:r.') }}</p>
                </template>
                {{-- Kommentare durch die GETEILTE Raum-Message-Row (P3 4.2): erben Mentions/Crop/
                     Lightbox/Reaktionen/Zaps/Toolbar. `context='thread'` gatet Raum-only-Aktionen
                     (openThread/Zitieren/Bearbeiten/Löschen) aus und routet Antworten→setThreadReply.
                     `m` ist der Schleifenname, den das Partial erwartet. --}}
                <template x-for="m in threadComments" :key="m.id">
                    <div :class="m.showAuthor ? 'pt-2.5' : 'pt-0.5'">
                        @include('group::partials.chat-row', ['context' => 'thread'])
                    </div>
                </template>
            </div>

            {{-- Composer: Root kommentieren oder auf einen Kommentar antworten.
                 pb via safe-area-inset: das Thread-Overlay ist `fixed inset-0` und erbt NICHT
                 das pb des Root-Containers (Zeile 58), sonst läge der Composer auf der
                 Android-3-Button-Leiste / iOS-Home-Indicator. Gleicher Wert wie Root-Container
                 (Zeile 58), damit die Tailwind-Klasse garantiert im kompilierten CSS liegt. --}}
            <div class="border-t border-white/10 px-3 pt-3 pb-[max(env(safe-area-inset-bottom),1rem)]">
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
                        {{-- Anhang-Vorschau + Eingabezeile (@-Mentions, Bild-Anhang): geteilter Composer.
                             context='thread' → sendComment(), threadDraft/threadComposer, kein Poll/Zap-Ziel. --}}
                        @include('group::partials.chat-composer', ['context' => 'thread'])
                    </div>
                </template>
                {{-- Nicht-Mitglied: Beitreten DIREKT aus dem Thread (v.a. Vollansicht aus der
                     Übersicht, wo man den Raum noch nicht betreten hat). join() ist die
                     bestehende Raum-Beitritts-Aktion; nach Beitritt erscheint der Composer. --}}
                <template x-if="!joined">
                    <div class="flex items-center justify-between gap-3">
                        <flux:text class="text-sm text-muted">{{ __('Tritt dem Raum bei, um zu antworten.') }}</flux:text>
                        <flux:button size="sm" variant="primary" icon="plus" class="shrink-0 icon-btn-touch"
                                     x-on:click="join()" ::disabled="joining">
                            <span x-text="joining ? @js(__('Trete bei…')) : @js(__('Beitreten'))"></span>
                        </flux:button>
                    </div>
                </template>
            </div>
        </div>
    </div>

    {{-- Lightbox: Vollbild eines angeklickten Inline-Bilds (Proxy-Preset `full`).
         Klick/Esc schließt; Proxy-Fehler → Original-URL (Offline-Fallback). --}}
    <div x-show="lightboxSrc" x-cloak x-transition.opacity
         x-on:click.stop="lightboxSrc = null" x-on:keydown.escape.window="lightboxSrc = null"
         class="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
        <img :src="lightboxSrc" alt="" class="max-h-full max-w-full rounded-card"
             x-on:error="$el.dataset.orig || ($el.dataset.orig = 1, $el.src = decodeURIComponent(($el.src.split('src=')[1] || '')))" />
    </div>

    <x-group::profile-card />
</div>
