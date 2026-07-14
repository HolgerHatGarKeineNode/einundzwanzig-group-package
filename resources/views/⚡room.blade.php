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

        {{-- throttle (nicht debounce, Schritt 6): debounce ist trailing-only → feuert bei einem
             schnellen Aufwärts-Fling nie MID-Scroll (Timer resettet jeden Frame) → der eager Prefetch
             startet erst nach dem Stopp. throttle feuert in 50ms-Intervallen WÄHREND der Geste → die
             2-Viewport-Schwelle greift rechtzeitig, der Prepend landet off-screen. --}}
        {{-- Der Virtualizer besitzt scrollTop; kein space-y (absolute Zeilen) und kein pb-4
             (paddingEnd im Virtualizer). --}}
        <div x-ref="scroll" x-on:scroll.throttle.50ms="onScroll()"
             role="log" aria-live="polite" aria-relevant="additions" aria-label="{{ __('Chat-Verlauf') }}"
             ::aria-busy="loading && messages.length === 0"
             {{-- [overflow-anchor:none]: DEFENSIV. Standard-Rezept für JS-verwaltete Chat-Scroller
                  (Slack/Discord/Telegram-Web), damit die native Browser-Scroll-Verankerung nicht als
                  zweite scrollTop-Quelle gegen virtual-core (alleiniger scrollTop-Owner) kämpft. In
                  UNSERER Architektur real vermutlich ein No-op — die Zeilen sind absolut + translateY
                  (out-of-flow, transform unterdrückt Anchoring ohnehin), auf WebKit gibt es das Feature
                  gar nicht. Der eigentliche Oszillations-Fix sitzt im scrollToFn (chatVirtualizer.ts).
                  Kostet nichts, schützt gegen künftige Layout-Änderungen → drin lassen. --}}
             class="min-h-0 flex-1 overflow-y-auto transition-opacity [overflow-anchor:none]"
             :class="(!firstPaintDone && messages.length > 0) ? 'opacity-0' : 'opacity-100'">

            {{-- Erstes Laden --}}
            <template x-if="loading && messages.length === 0">
                <div class="space-y-3 pt-4">
                    <span class="sr-only" aria-live="polite">{{ __('Verlauf wird geladen…') }}</span>
                    <template x-for="i in 6" :key="i">
                        <div class="flex gap-2">
                            <div class="skeleton size-8 shrink-0 rounded-full"></div>
                            <div class="flex-1 space-y-1.5 py-1">
                                <div class="skeleton h-3 w-24"></div>
                                <div class="skeleton h-3 w-2/3"></div>
                            </div>
                        </div>
                    </template>
                </div>
            </template>

            {{-- Leerer Raum --}}
            <template x-if="!loading && messages.length === 0">
                <div class="surface-card empty-state mt-8 p-6 text-center">
                    <flux:icon.chat-bubble-left-right class="mx-auto size-8 text-zinc-400" />
                    <flux:text class="mt-2">{{ __('Noch keine Nachrichten in diesem Raum.') }}</flux:text>
                </div>
            </template>

            {{-- Verlauf — virtualisiert via @tanstack/virtual-core (Schritt 7): nur das sichtbare
                 Fenster (virtualItems) liegt im DOM, der Spacer trägt die Gesamthöhe für die
                 Scrollbar, jede Zeile ist absolut an ihrem gemessenen Offset. Der Virtualizer besitzt
                 scrollTop (Boden-Stick via followOnAppend, Prepend-Anker keyed by Event-ID, Bild-/
                 Chip-Re-Measure via ResizeObserver). wire:ignore: der Livewire-Morph darf die
                 absolut positionierten Nodes nicht anfassen. --}}
            <div wire:ignore data-virt-spacer x-show="messages.length > 0" class="relative w-full" :style="`height:${totalSize}px`">
            <template x-for="vi in virtualItems" :key="vi.key">
                {{-- Gemessene Zeile: data-index (Virtualizer liest daraus den Item-Key), measureRow
                     registriert sie + ResizeObserver. Vertikalabstand als PADDING (in der border-box
                     → offsetHeight erfasst ihn), da absolute Items kein margin/space-y tragen. --}}
                <div :data-index="vi.index" x-init="$nextTick(() => measureRow($el))"
                     class="absolute left-0 top-0 w-full"
                     :class="messages[vi.index]?.showAuthor ? 'pt-2.5' : 'pt-0.5'"
                     :style="`transform:translateY(${vi.start}px)`">
                {{-- Reaktiver Alias m = messages[vi.index] (1-Element-x-for statt Getter → Chip-/Profil-
                     Updates schlagen live durch; leerer Fallback schützt vor Übergangs-Frames). --}}
                <template x-for="m in (messages[vi.index] ? [messages[vi.index]] : [])" :key="vi.key">
                <div>
                    <template x-if="m.divider">
                        <div class="my-3 flex items-center gap-3">
                            <flux:separator class="flex-1" />
                            <span class="font-mono text-[0.7rem] tracking-wide text-muted" x-text="m.divider"></span>
                            <flux:separator class="flex-1" />
                        </div>
                    </template>

                    {{-- Last-Read-Grenze: erste ungelesene Fremd-Nachricht seit dem letzten Besuch. --}}
                    <template x-if="m.unreadDivider">
                        <div class="my-3 flex items-center gap-3">
                            <flux:separator class="flex-1" />
                            <span class="shrink-0 font-mono text-[0.7rem] font-semibold tracking-wide text-brand-500">{{ __('Neue Nachrichten') }}</span>
                            <flux:separator class="flex-1" />
                        </div>
                    </template>

                    {{-- Zeile: Tap blendet die Aktionen ein/aus (Touch); :title = volles Datum. --}}
                    <div :id="'msg-'+m.id" :title="m.fullTime"
                         x-on:click="activeId = (activeId===m.id ? null : m.id)"
                         class="group relative flex gap-2 rounded-card px-1 transition-shadow"
                         :class="flashId===m.id ? 'ring-2 ring-brand-500/70' : ''">
                        <div class="w-8 shrink-0">
                            <template x-if="m.showAuthor">
                                <button type="button" x-on:click.stop="$dispatch('open-profile', m.pubkey)"
                                        class="pressable" aria-label="{{ __('Profil anzeigen') }}">
                                    {{-- Unaufgelöst (kind-0 noch nicht da) → ruhiges „?" statt der irreführenden
                                         npub-Initiale „n". Profile sind dank Prewarm (Schritt 4) meist warm. --}}
                                    <x-group::nostr-avatar picture="m.picture" name="m.profileReady ? m.name : ''" />
                                </button>
                            </template>
                            {{-- Folgezeile ohne Autor-Kopf: HH:MM erscheint links bei Hover. --}}
                            <template x-if="!m.showAuthor">
                                <div class="pt-0.5 text-right font-mono text-[0.65rem] leading-4 text-muted opacity-0 transition-opacity group-hover:opacity-100"
                                     x-text="m.time"></div>
                            </template>
                        </div>
                        <div class="min-w-0 flex-1">
                            {{-- items-center (nicht -baseline): das später einblendende NIP-05-Badge-Icon
                                 (16px) darf die Zeilenhöhe (text-sm ≈ 20px) NICHT vergrössern → kein
                                 vertikaler Ruck der Liste, wenn die Verifizierung spät nachlädt (Schritt 3). --}}
                            <template x-if="m.showAuthor">
                                <div class="flex items-center gap-2">
                                    <button type="button" x-on:click.stop="$dispatch('open-profile', m.pubkey)"
                                            class="pressable truncate text-left text-sm font-semibold hover:underline" x-text="m.name"></button>
                                    {{-- Fester 16px-Slot fürs Badge: reserviert den Platz IMMER, damit das
                                         spät nachladende NIP-05-Häkchen die Uhrzeit nicht nach rechts schiebt
                                         (Schritt 3). Kosten: kleine Lücke bei Autoren ohne verifiziertes NIP-05. --}}
                                    <span class="inline-flex size-4 shrink-0 items-center justify-center">
                                        <x-group::nostr-nip05 nip05="m.nip05" />
                                    </span>
                                    <span class="shrink-0 font-mono text-[0.7rem] text-muted" x-text="m.time"></span>
                                </div>
                            </template>
                            {{-- Zitat-Vorschau: Klick springt zur zitierten Original-Nachricht.
                                 Zwei-Zeilen-Komposit → rohes <button> (kein Flux-Icon-Pendant), §6. --}}
                            <template x-if="m.reply">
                                <button type="button" x-on:click.stop="scrollToMessage(m.reply.id)"
                                        class="pressable mt-0.5 mb-1 block w-full border-l-2 border-brand-500/60 pl-2 text-left hover:border-brand-500">
                                    <div class="truncate text-xs font-semibold text-brand-500" x-text="m.reply.name"></div>
                                    <div class="truncate text-xs text-muted" x-text="m.reply.text"></div>
                                </button>
                            </template>
                            {{-- Inline-Bild anklicken → Lightbox (Klick delegiert, da x-html-Inhalt). --}}
                            <div class="chat-content text-sm break-words whitespace-pre-wrap" x-html="m.html"
                                 x-on:click="if ($event.target.matches('img.chat-image')) { $event.stopPropagation(); lightboxSrc = $event.target.dataset.full }"></div>
                            {{-- Poll (C5, NIP-88 kind 1068): Optionen mit Live-Balken + Vote-Buttons.
                                 Titel steht bereits in m.html (Poll-content = Frage). Option-Button
                                 ist ein Komposit (Balken + Marker + Label + Zähler) → rohes <button>
                                 wie die Zitat-Vorschau (§6), Flux hat kein Pendant. --}}
                            <template x-if="m.poll">
                                {{-- Einfachwahl = radiogroup (exklusiv), Mehrfachwahl = group aus Checkboxen.
                                     Rolle/aria-checked tragen den Zustand → SR sagt „ausgewählt" an, nicht
                                     die dekorative Glyphe (aria-hidden). --}}
                                <div class="mt-1.5">
                                    {{-- Optionen in einer GEDECKELTEN, innen scrollbaren Box (max-h-52): jede
                                         Options-Zeile hat feste Höhe (truncate, kein Umbruch), viele Optionen
                                         scrollen INNEN statt die Nachrichtenzeile wachsen zu lassen. So ist die
                                         äußere Höhe deterministisch (Optionsanzahl × feste Zeilenhöhe, gedeckelt)
                                         und async-stabil (Tally füllt nur die Balken) → der Virtualizer-Estimate
                                         trifft exakt → kein Jitter beim Scrollen in Polls. --}}
                                    <div class="max-h-52 space-y-1.5 overflow-y-auto" :role="m.poll.multi ? 'group' : 'radiogroup'" aria-label="{{ __('Umfrageoptionen') }}">
                                        <template x-for="opt in m.poll.options" :key="opt.id">
                                            <button type="button" x-on:click.stop="votePoll(m, opt.id)" :disabled="m.poll.closed"
                                                    :role="m.poll.multi ? 'checkbox' : 'radio'" :aria-checked="opt.mine"
                                                    class="pressable relative block w-full overflow-hidden rounded-tile border text-left disabled:opacity-70"
                                                    :class="opt.mine ? 'border-brand-500' : 'border-white/10 hover:border-brand-500/50'">
                                                <div class="absolute inset-y-0 left-0 bg-brand-500/15 transition-[width] duration-300 motion-reduce:transition-none" :style="`width:${opt.pct}%`"></div>
                                                <div class="relative flex items-center justify-between gap-2 px-2 py-1.5">
                                                    <span class="flex min-w-0 items-center gap-2">
                                                        {{-- Marker signalisiert die Wahlart: Radio (●/○) bei Einfach-, Checkbox (☑/☐) bei Mehrfachwahl. --}}
                                                        <span aria-hidden="true" class="shrink-0 text-sm" :class="opt.mine ? 'text-brand-500' : 'text-muted'"
                                                              x-text="opt.mine ? (m.poll.multi ? '☑' : '●') : (m.poll.multi ? '☐' : '○')"></span>
                                                        <span class="truncate text-sm" x-text="opt.label"></span>
                                                    </span>
                                                    <span class="shrink-0 font-mono text-xs text-muted" x-text="opt.votes"></span>
                                                </div>
                                            </button>
                                        </template>
                                    </div>
                                    {{-- Footer außerhalb der Scrollbox → bleibt fix sichtbar. --}}
                                    <div class="mt-1.5 flex items-center justify-between gap-2 text-xs text-muted">
                                        <span x-text="m.poll.typeLabel + (m.poll.endsLabel ? ' · ' + m.poll.endsLabel : '')"></span>
                                        <span x-text="m.poll.voters + (m.poll.voters === 1 ? @js(__(' Stimme')) : @js(__(' Stimmen')))"></span>
                                    </div>
                                </div>
                            </template>
                            {{-- Zap-Goal (Z5, NIP-75 kind 9041): Titel steht in m.html (Goal-content),
                                 hier Details + Fortschrittsbalken (aus validiertem 9735-Tally) +
                                 „Beitragen"-Zap. Eigenes Ziel (!zappable) zeigt nur den Fortschritt. --}}
                            <template x-if="m.goal">
                                <div class="surface-card mt-1.5 space-y-2 rounded-tile border border-brand-500/20 p-3">
                                    {{-- Summary auf eine Zeile abgeschnitten (+ Hover-Tooltip für die
                                         Vollansicht): hält die Goal-Höhe fix, egal wie lang die Beschreibung
                                         ist → async-stabil, Estimate trifft → kein Jitter (Nutzer-Vorgabe). --}}
                                    <template x-if="m.goal.summary">
                                        <p class="truncate text-sm text-muted" :title="m.goal.summary" x-text="m.goal.summary"></p>
                                    </template>
                                    <div>
                                        <div class="flex items-center justify-between gap-2 font-mono text-xs tabular-nums">
                                            <span class="font-semibold text-brand-500" x-text="m.goal.raisedSats.toLocaleString('de-DE') + ' Sats'"></span>
                                            <span class="text-muted" x-text="@js(__('Ziel ')) + m.goal.targetSats.toLocaleString('de-DE')"></span>
                                        </div>
                                        {{-- Balken: role=progressbar trägt den Wert für SR; die Breite
                                             animiert nur bei motion-safe (Reduced-Motion springt). --}}
                                        <div class="mt-1 h-2 overflow-hidden rounded-full bg-white/10" role="progressbar"
                                             :aria-valuenow="m.goal.pct" aria-valuemin="0" aria-valuemax="100"
                                             aria-label="{{ __('Ziel-Fortschritt') }}"
                                             :aria-valuetext="m.goal.pct + @js(__(' Prozent — ')) + m.goal.raisedSats.toLocaleString('de-DE') + @js(__(' von ')) + m.goal.targetSats.toLocaleString('de-DE') + ' Sats'">
                                            <div class="h-full rounded-full bg-brand-500 transition-[width] duration-500 motion-reduce:transition-none"
                                                 :style="`width:${m.goal.pct}%`"></div>
                                        </div>
                                    </div>
                                    <div class="flex items-center justify-between gap-2">
                                        <span class="text-xs text-muted"
                                              x-text="m.goal.contributors + (m.goal.contributors === 1 ? @js(__(' Beitragende:r')) : @js(__(' Beitragende'))) + (m.goal.reached ? @js(__(' · Ziel erreicht 🎉')) : '')"></span>
                                        <flux:button size="xs" variant="primary" icon="bolt" class="shrink-0 icon-btn-touch"
                                                     x-show="zapsEnabled && m.zappable" x-cloak
                                                     x-on:click.stop="openZap(m)">{{ __('Beitragen') }}</flux:button>
                                    </div>
                                </div>
                            </template>
                            {{-- Grow-only Chip-Bereich (Schritt 1, plans/chat-message-cache-no-flicker.md):
                                 EIN Container um Reaction- + Zap-Zeile mit stabiler :id. bridge.ts misst
                                 im $nextTick die Höhe und hält sie als min-height — nachladende oder
                                 zurückgenommene Chips vergrössern das Item, kollabieren es aber nie
                                 (keine Motion in der Liste). Leer = Höhe 0 (kein reservierter Leerstreifen).
                                 `flow-root` = eigener BFC, damit das mt-1 der inneren Zeile INNERHALB
                                 der border-box liegt und offsetHeight es miterfasst (sonst 4px-Ruck). --}}
                            {{-- Chip-Lane mit RESERVIERTER Höhe (min-h-7 = eine Chip-Reihe): Zap-/
                                 Reaction-Chips laden async nach (throttled stores) → ohne Reservierung
                                 wüchse die Zeile beim Eintreffen von 0 auf 28px → scrollHeight ändert
                                 sich → Scrollbalken-Thumb zuckt. Der reservierte Platz fängt das ab
                                 (Chips füllen ihn, die Zeilenhöhe bleibt konstant). Reactions UND Zap in
                                 EINER umbrechenden Reihe → bei sehr vielen Chips kann eine zweite Reihe
                                 entstehen; das ist mit dem Spacer-Sync-Fix (chatVirtualizer.ts scrollToFn)
                                 aber KEINE Oszillation mehr, sondern eine einmalige, saubere Höhenkorrektur
                                 (Leseposition bleibt erhalten). Darum bewusst flex-wrap statt einer
                                 erzwungenen Ein-Reihen-Lane mit horizontalem Scrollbalken: der Balken
                                 brächte die Höhenvariabilität (Balkenhöhe) zurück und schöbe den Zap-Chip
                                 aus dem Bild. `mt-1` als Padding (flow-root/border-box → offsetHeight
                                 erfasst es). --}}
                            <div :id="'chips-'+m.id" class="mt-1 flex min-h-7 flex-wrap items-center gap-1">
                                {{-- Reaction-Chips (C1): pro Emoji Zähler + eigener Toggle-Zustand. --}}
                                <template x-for="r in m.reactions" :key="r.key">
                                    {{-- Pills homogen: feste Höhe + Mindestbreite, Emoji/Bild auf
                                         identische Größe normiert (das Inline-`chat-emoji` wäre sonst
                                         1.4em → höhere Pill als ein Unicode-Emoji). --}}
                                    <button type="button" x-on:click.stop="toggleReaction(m, r)" :aria-pressed="r.mine"
                                            :title="r.names"
                                            class="pressable inline-flex h-6 min-w-7 items-center justify-center gap-1 rounded-full border px-2 text-sm leading-none"
                                            :class="r.mine ? 'border-brand-500 bg-brand-500/15 text-brand-500' : 'border-white/10 bg-white/5 text-muted hover:border-brand-500/50'">
                                        <template x-if="r.emojiUrl"><img class="chat-emoji !size-4 shrink-0 object-contain" :src="r.emojiUrl" :alt="r.content" loading="lazy" /></template>
                                        <template x-if="!r.emojiUrl"><span x-text="r.label"></span></template>
                                        <span x-show="r.count > 1" x-text="r.count" class="font-mono text-xs"></span>
                                    </button>
                                </template>
                                {{-- ⚡-Zap-Chip (Z3): validierte 9735-Summe in Sats, Brand-Ramp,
                                     hervorgehoben wenn man selbst (mit)gezappt hat. Tap re-zappt
                                     (nur fremde Nachrichten → openZap gatet über m.zappable).
                                     Bei Goals (Z5) unterdrückt — der Fortschrittsbalken zeigt die Summe. --}}
                                <template x-if="m.zaps.count && !m.goal">
                                    <button type="button"
                                            x-on:click.stop="zapsEnabled && m.zappable && openZap(m)"
                                            :title="m.zaps.names"
                                            :aria-label="(m.zaps.mine ? @js(__('Du hast gezappt. ')) : '') + m.zaps.sats + @js(__(' Sats gezappt von ')) + m.zaps.names + (zapsEnabled && m.zappable ? @js(__(' – tippen zum erneuten Zappen')) : '')"
                                            class="pressable inline-flex h-6 min-w-7 items-center justify-center gap-1 rounded-full border px-2 text-sm leading-none transition-colors motion-reduce:transition-none"
                                            :class="m.zaps.mine ? 'border-brand-500 bg-brand-500/15 text-brand-500' : 'border-white/10 bg-white/5 text-muted hover:border-brand-500/50'">
                                        <flux:icon.bolt variant="solid" class="size-3.5 shrink-0 text-brand-500" />
                                        <span x-text="m.zaps.sats" class="font-mono text-xs tabular-nums"></span>
                                    </button>
                                </template>
                                {{-- Antworten-Indikator (C6b, Slack-Stil): erscheint an JEDER Nachricht mit
                                     ≥1 Antwort (kind 1111). Überlappende Teilnehmer-Gesichter + Zähler +
                                     „vor …" der letzten Antwort → öffnet den Thread. Passt in die reservierte
                                     Chip-Lane (h-7 = min-h-7), also kein Layout-Sprung beim Nachladen. --}}
                                <template x-if="m.thread">
                                    <button type="button" x-on:click.stop="openThread(m)"
                                            :aria-label="m.thread.count + (m.thread.count === 1 ? @js(__(' Antwort, letzte ')) : @js(__(' Antworten, letzte '))) + m.thread.lastLabel + @js(__(' — Thread öffnen'))"
                                            class="pressable group/th inline-flex h-7 items-center gap-1.5 rounded-full border border-brand-500/40 bg-brand-500/10 pl-1 pr-2.5 text-brand-500 transition-colors motion-reduce:transition-none hover:border-brand-500 hover:bg-brand-500/15">
                                        <span class="flex -space-x-1.5">
                                            <template x-for="f in m.thread.faces" :key="f.pubkey">
                                                <span class="inline-flex rounded-full ring-2 ring-white dark:ring-zinc-900">
                                                    <x-group::nostr-avatar picture="f.picture" name="f.name" size="1.15rem" />
                                                </span>
                                            </template>
                                        </span>
                                        <span class="text-xs font-semibold" x-text="m.thread.count + (m.thread.count === 1 ? @js(__(' Antwort')) : @js(__(' Antworten')))"></span>
                                        <span class="text-xs text-muted" x-text="'· ' + m.thread.lastLabel"></span>
                                        <flux:icon.chevron-right class="size-3.5 shrink-0 opacity-60 transition-transform motion-reduce:transition-none group-hover/th:translate-x-0.5" />
                                    </button>
                                </template>
                            </div>
                        </div>
                        {{-- Aktionen: schwebende Toolbar oben rechts (bei Hover/aktivem Tap).
                             `absolute` → nimmt KEINEN Layout-Platz, der Text behält die volle
                             Breite (früher drückte die Leiste ihn auf Mobile schmal). Opaker
                             surface-Hintergrund, damit sie über langem Text lesbar bleibt. --}}
                        <div class="surface-card pointer-events-none absolute right-1 top-0.5 z-10 flex items-center gap-0.5 rounded-full px-0.5 shadow-md opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 focus-within:opacity-100"
                             :class="activeId===m.id && '!pointer-events-auto !opacity-100'">
                            {{-- Zap (Z3, NIP-57): WICHTIGSTE Aktion → ganz vorne, Brand-Gelb.
                                 `!text-brand-500` überschreibt Flux' ghost-Textfarbe
                                 (text-zinc-800/white, gleiche Spezifität → sonst Reihenfolge).
                                 Nur fremde Nachrichten mit lud16; Feature-Flag-gated. --}}
                            <flux:button size="xs" variant="ghost" icon="bolt" class="icon-btn-touch !text-brand-500"
                                         x-show="zapsEnabled && m.zappable" x-cloak x-on:click.stop="openZap(m)"
                                         aria-label="Zap" />
                            <flux:button size="xs" variant="ghost" icon="arrow-uturn-left" class="icon-btn-touch"
                                         x-on:click.stop="setReply(m)" aria-label="{{ __('Antworten') }}" />
                            {{-- Im Thread antworten (C6b): öffnet den Thread dieser Nachricht (jede Nachricht
                                 ist thread-fähig). Sichtbarer Direkt-Einstieg statt versteckter Quote-Geste. --}}
                            <flux:button size="xs" variant="ghost" icon="chat-bubble-oval-left" class="icon-btn-touch"
                                         x-on:click.stop="openThread(m)" aria-label="{{ __('Im Thread antworten') }}" />
                            <flux:button size="xs" variant="ghost" icon="trash" class="icon-btn-touch"
                                         x-show="m.mine" x-cloak x-on:click.stop="askDelete(m)" ::disabled="deleting"
                                         aria-label="{{ __('Nachricht löschen') }}" />
                            {{-- Reaktions-Picker (C1, Web): volles Emoji-Panel. Teleportiert ans
                                 <body> (sonst würde der Chat-Scroll-Container es abschneiden) und
                                 `fixed` mit Flip positioniert (reactionPopover) → nie aus dem Viewport.
                                 `x-if="open"` mountet den Picker erst beim Öffnen. App: „…"-Modal. --}}
                            <template x-if="!isMobile">
                                <div x-data="reactionPopover()" x-on:click.stop>
                                    <flux:button x-ref="trigger" size="xs" variant="ghost" icon="face-smile"
                                                 class="icon-btn-touch" x-on:click="toggle()" aria-label="{{ __('Reagieren') }}" />
                                    {{-- x-if (lazy-mount) + x-teleport getrennt verschachteln — beides
                                         auf EINEM template teleportiert bei jedem Tick neu (Leak). --}}
                                    <template x-if="open">
                                        <div>
                                            <template x-teleport="body">
                                                <div x-ref="panel" x-transition.opacity :style="panelStyle"
                                                     x-on:click.outside="closeUnless($event)"
                                                     x-on:keydown.escape.window="open = false"
                                                     class="surface-card fixed z-50 rounded-card p-2 shadow-xl">
                                                    <x-group::emoji-picker message="m" onpick="open = false" />
                                                </div>
                                            </template>
                                        </div>
                                    </template>
                                </div>
                            </template>
                            {{-- „…"-Menü = gemeinsamer Andockpunkt für alle weiteren Aktionen (C1–C4).
                                 Web: Zeilen-Popover (flux:dropdown). Native App: Vollbild-Modal (openMessageMenu). --}}
                            <template x-if="!isMobile">
                                <div x-on:click.stop>
                                    <flux:dropdown position="top" align="end">
                                        <flux:button size="xs" variant="ghost" icon="ellipsis-horizontal"
                                                     class="icon-btn-touch" aria-label="{{ __('Weitere Aktionen') }}" />
                                        <flux:menu>
                                            {{-- Zap (Z3, NIP-57): WICHTIGSTE Aktion → ganz vorne. Nur fremde Nachricht mit lud16. --}}
                                            <template x-if="zapsEnabled && m.zappable">
                                                <flux:menu.item icon="bolt" x-on:click="openZap(m)">Zap</flux:menu.item>
                                            </template>
                                            <flux:menu.item icon="arrow-uturn-left" x-on:click="setReply(m)">{{ __('Antworten') }}</flux:menu.item>
                                            {{-- Im Thread antworten (C6b): öffnet den Thread dieser Nachricht. --}}
                                            <flux:menu.item icon="chat-bubble-oval-left" x-on:click="openThread(m)">{{ __('Im Thread antworten') }}</flux:menu.item>
                                            {{-- Zitieren (C3): Nachricht ohne Kommentar teilen (Quote-Only). --}}
                                            <flux:menu.item icon="chat-bubble-left-right" x-on:click="share(m)">{{ __('Zitieren') }}</flux:menu.item>
                                            {{-- Bearbeiten (C3): nur eigene Nachrichten, ≤5 min alt. --}}
                                            <template x-if="canEdit(m)">
                                                <flux:menu.item icon="pencil-square" x-on:click="startEdit(m)">{{ __('Bearbeiten') }}</flux:menu.item>
                                            </template>
                                            {{-- Fork off!: fremde Nachrichten anprangern (NIP-56 kind 1984). --}}
                                            <template x-if="!m.mine">
                                                <flux:menu.item icon="flag" x-on:click="askReport(m)">Fork off!</flux:menu.item>
                                            </template>
                                            {{-- Löschen: nur eigene Nachrichten (NIP-09 kind 5). --}}
                                            <template x-if="m.mine">
                                                <flux:menu.item icon="trash" variant="danger" x-on:click="askDelete(m)">{{ __('Löschen') }}</flux:menu.item>
                                            </template>
                                            {{-- C4: Kopieren/Info (nur lesen, kein Publish). --}}
                                            <flux:menu.separator />
                                            <flux:menu.item icon="link" x-on:click="copyNevent(m)">{{ __('Event-Link kopieren') }}</flux:menu.item>
                                            <flux:menu.item icon="user-circle" x-on:click="copyNpub(m)">{{ __('npub kopieren') }}</flux:menu.item>
                                            <flux:menu.item icon="code-bracket" x-on:click="copyJson(m)">{{ __('JSON kopieren') }}</flux:menu.item>
                                            <flux:menu.item icon="information-circle" x-on:click="openInfo(m)">{{ __('Info') }}</flux:menu.item>
                                        </flux:menu>
                                    </flux:dropdown>
                                </div>
                            </template>
                            <template x-if="isMobile">
                                <flux:button size="xs" variant="ghost" icon="ellipsis-horizontal"
                                             class="icon-btn-touch" x-on:click.stop="openMessageMenu(m)"
                                             aria-label="{{ __('Weitere Aktionen') }}" />
                            </template>
                        </div>
                    </div>
                </div>
                </template>
                </div>
            </template>
            </div>
        </div>

        {{-- Ältere laden: schwebende Affordanz oben (analog zum Jump-Button unten), damit sie die
             absolut positionierte virtuelle Liste NICHT in ihrer Geometrie verschiebt. Meist nur
             Fallback — der Eager-Prefetch (onScroll) lädt beim Hochscrollen schon von selbst. --}}
        <div class="pointer-events-none absolute inset-x-0 top-2 flex justify-center" x-show="hasMore && messages.length > 0" x-cloak
             x-transition.opacity>
            <flux:button size="xs" variant="ghost" class="pointer-events-auto surface-card icon-btn-touch shadow-md" x-on:click="loadOlder()" ::disabled="loadingMore">
                <span x-text="loadingMore ? @js(__('Lädt…')) : @js(__('Ältere laden'))"></span>
            </flux:button>
        </div>

        {{-- Zurück ans Ende, sobald hochgescrollt — mit Zähler, wenn neue Nachrichten warten.
             Zwei Buttons: flux erkennt „Icon-only vs. Pille" server-seitig am Slot (ein
             x-show-Span bliebe immer „nicht leer" → Pfeil säße links statt zentriert). --}}
        {{-- Zeigt, sobald der User nicht mehr am Boden ist (atBottom = Virtualizer.isAtEnd(60)). --}}
        <div class="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center" x-show="!atBottom" x-cloak
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
        <div x-show="!membershipReady" x-cloak class="skeleton h-11 rounded-card"></div>

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

        {{-- Anhang-Vorschau (C6a): hochgeladenes, zugeschnittenes Bild wartet auf Senden.
             Über den Proxy (Preset `msg`) angezeigt; X nimmt den Anhang zurück. --}}
        <div x-show="membershipReady && joined && attachment" x-cloak
             class="surface-card mb-1 flex items-center gap-3 px-3 py-2">
            <img :src="$img(attachment?.url, 'msg')" alt="{{ __('Anhang-Vorschau') }}"
                 class="size-14 shrink-0 rounded-tile object-cover" />
            <div class="min-w-0 flex-1 text-xs text-muted">{{ __('Bild angehängt') }}</div>
            <flux:button size="xs" variant="ghost" icon="x-mark" class="icon-btn-touch"
                         x-on:click="removeAttachment()" aria-label="{{ __('Anhang entfernen') }}" />
        </div>

        <div x-show="membershipReady && joined" x-cloak class="relative flex items-end gap-2">
            {{-- @-Mention-Autocomplete (C4): Vorschläge über dem Composer. Pfeile
                 wählen, Enter/Tab übernimmt, Escape schließt (siehe keydown unten).
                 Klick auf einen Vorschlag fügt `nostr:npub… ` ein → rendert als @Name. --}}
            <template x-if="mentionOpen">
                <div class="surface-card absolute bottom-full left-0 z-30 mb-1 max-h-56 w-full max-w-xs overflow-y-auto rounded-card p-1 shadow-xl"
                     x-on:click.stop>
                    <template x-for="(item, i) in mentionItems" :key="item.pubkey">
                        <button type="button" x-on:click="pickMention(item)" x-on:mouseenter="mentionIndex = i"
                                class="pressable flex w-full items-center gap-2 rounded-tile px-2 py-1.5 text-left"
                                :class="mentionIndex === i ? 'bg-brand-500/15' : ''">
                            <x-group::nostr-avatar picture="item.picture" name="item.name" />
                            <span class="truncate text-sm" x-text="item.name"></span>
                        </button>
                    </template>
                </div>
            </template>
            {{-- Anhängen-Menü (wie Flotilla): EIN „+"-Button bündelt Umfrage + Zap-Ziel,
                 spart Platz im Composer. Zap-Ziel nur bei aktivem Feature-Flag. --}}
            <flux:dropdown position="top" align="start" class="shrink-0">
                <flux:button type="button" variant="ghost" icon="plus" class="icon-btn-touch" aria-label="{{ __('Anhängen') }}" />
                <flux:menu>
                    <flux:menu.item icon="photo" x-on:click="$refs.imageInput.click()">{{ __('Bild') }}</flux:menu.item>
                    <flux:menu.item icon="chart-bar" x-on:click="openPollCreate()">{{ __('Umfrage') }}</flux:menu.item>
                    <template x-if="zapsEnabled">
                        <flux:menu.item icon="trophy" x-on:click="openGoalCreate()">{{ __('Zap-Ziel') }}</flux:menu.item>
                    </template>
                </flux:menu>
            </flux:dropdown>
            {{-- Verstecktes Datei-Feld (C6a): das +-Menü löst es aus, pickImage öffnet das
                 Crop-Modal. accept=image/* → Foto-/Galerie-Picker auf Mobile. --}}
            <input type="file" accept="image/*" x-ref="imageInput" class="hidden"
                   x-on:change="pickImage($event.target)" aria-hidden="true" tabindex="-1" />
            <flux:textarea x-ref="composer" x-model="draft" rows="1" resize="none"
                           placeholder="{{ __('Nachricht schreiben…') }}" aria-label="{{ __('Nachricht schreiben') }}" class="flex-1"
                           x-on:focus="atBottom && scrollToBottom()"
                           x-on:input="autoGrow($event.target); sendError = ''; onComposerInput($event.target)"
                           x-on:paste="pasteImage($event)"
                           x-on:keydown="
                               if (mentionOpen) {
                                   if ($event.key === 'ArrowDown') { $event.preventDefault(); mentionIndex = (mentionIndex + 1) % mentionItems.length; return }
                                   if ($event.key === 'ArrowUp') { $event.preventDefault(); mentionIndex = (mentionIndex - 1 + mentionItems.length) % mentionItems.length; return }
                                   if ($event.key === 'Enter' || $event.key === 'Tab') { $event.preventDefault(); pickMention(mentionItems[mentionIndex]); return }
                                   if ($event.key === 'Escape') { $event.preventDefault(); closeMentions(); return }
                               }
                               if ($event.key === 'Enter' && !$event.shiftKey) { $event.preventDefault(); send() }" />
            {{-- Zitieren (Quote-Only) darf ohne Text gesendet werden → Button dann aktiv. --}}
            <flux:button type="button" variant="primary" icon="paper-airplane" class="icon-btn-touch" :loading="true"
                         x-on:click="send()" ::data-loading="sending"
                         ::disabled="sending || (draft.trim().length === 0 && !sharing && !attachment)"
                         aria-label="{{ __('Senden') }}" />
        </div>

        {{-- Fehlgeschlagen: aktionable Hinweiszeile statt flüchtigem Toast (Draft ist gefüllt). --}}
        <div x-show="membershipReady && joined && sendError" x-cloak
             class="mt-1 flex items-center justify-between gap-2 rounded-tile bg-red-500/10 px-3 py-1.5 text-xs text-red-500">
            <span x-text="sendError"></span>
            <button type="button" x-on:click="send()" class="pressable shrink-0 font-semibold text-brand-500 hover:underline">
                {{ __('Erneut senden') }}
            </button>
        </div>

        <div x-show="membershipReady && !joined" x-cloak
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
    <div x-show="_cropSrc" x-cloak role="dialog" aria-modal="true" aria-label="{{ __('Bild zuschneiden') }}"
         x-effect="_cropSrc && $nextTick(() => $refs.cropConfirm?.focus())"
         x-on:keydown.escape.window="_cropSrc && cancelCrop()"
         class="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
        {{-- Zentrierte Karte statt Vollflächen-Wüste: klare Kopf-/Bühne-/Fuß-Struktur. --}}
        <div class="surface-card flex max-h-[90vh] w-full max-w-2xl flex-col gap-4 p-4 shadow-2xl sm:p-5"
             x-on:click.outside="cancelCrop()">
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
            <flux:button variant="ghost" icon="arrow-uturn-left" class="w-full justify-start"
                         x-on:click="if (menuFor) { setReply(menuFor); closeMessageMenu() }">{{ __('Antworten') }}</flux:button>
            {{-- Im Thread antworten (C6b): openThread schließt das Menü selbst (closeMessageMenu). --}}
            <flux:button variant="ghost" icon="chat-bubble-oval-left" class="w-full justify-start"
                         x-on:click="if (menuFor) openThread(menuFor)">{{ __('Im Thread antworten') }}</flux:button>
            {{-- Zitieren (C3): teilt ohne Kommentar; share() schließt das Menü selbst. --}}
            <flux:button variant="ghost" icon="chat-bubble-left-right" class="w-full justify-start"
                         x-on:click="if (menuFor) share(menuFor)">{{ __('Zitieren') }}</flux:button>
            {{-- Bearbeiten (C3): nur eigene Nachricht, ≤5 min alt; startEdit() schließt selbst. --}}
            <flux:button variant="ghost" icon="pencil-square" class="w-full justify-start"
                         x-show="menuFor && canEdit(menuFor)" x-cloak
                         x-on:click="if (menuFor) startEdit(menuFor)">{{ __('Bearbeiten') }}</flux:button>
            {{-- Fork off! (fremd) / Löschen (eigen): askReport/askDelete merken die Zielnachricht,
                 dann schließt das Menü-Modal (öffnet Fork-off!- bzw. Löschen-Bestätigung). --}}
            <flux:button variant="ghost" icon="flag" class="w-full justify-start" x-show="!menuFor?.mine" x-cloak
                         x-on:click="if (menuFor) { askReport(menuFor); closeMessageMenu() }">Fork off!</flux:button>
            <flux:button variant="danger" icon="trash" class="w-full justify-start" x-show="menuFor?.mine" x-cloak
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
         x-on:keydown.escape.window="threadRootId && !lightboxSrc && backFromThread()"
         class="fixed inset-0 z-50 flex justify-center"
         :class="threadFull ? 'items-stretch bg-zinc-50 dark:bg-zinc-900' : 'items-end bg-black/70 backdrop-blur-sm sm:items-center sm:p-4'">
        <div class="surface-card flex w-full max-w-2xl flex-col overflow-hidden"
             :class="threadFull ? 'h-full' : 'max-h-[92vh] rounded-t-card shadow-2xl sm:rounded-card'"
             x-on:click.outside="!lightboxSrc && !threadFull && closeThread()">
            {{-- Kopf: Zurück + Titel + Kommentar-Zahl. --}}
            <div class="flex items-center gap-2 border-b border-white/10 px-4 py-3">
                <flux:button size="xs" variant="ghost" icon="arrow-left" class="icon-btn-touch"
                             x-ref="threadClose" x-on:click="backFromThread()" aria-label="{{ __('Zurück') }}" />
                <flux:heading size="lg" class="flex-1">{{ __('Thread') }}</flux:heading>
                <span class="shrink-0 text-xs text-muted"
                      x-text="threadCount + (threadCount === 1 ? @js(__(' Antwort')) : @js(__(' Antworten')))"></span>
            </div>

            {{-- Root + Kommentare (scrollbar). --}}
            <div class="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
                {{-- Zitierte Root-Nachricht. --}}
                <template x-if="threadRoot && !threadRoot.missing">
                    <div class="surface-card rounded-tile border border-brand-500/20 p-3">
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

                {{-- Kommentar-Baum: flach mit Einrückung nach `depth` (gedeckelt). --}}
                <template x-if="threadComments.length === 0">
                    <p class="py-6 text-center text-sm text-muted">{{ __('Noch keine Antworten — antworte als erste:r.') }}</p>
                </template>
                <template x-for="c in threadComments" :key="c.id">
                    <div :style="'margin-left:' + Math.min(c.depth, 6) * 14 + 'px'"
                         class="border-l-2 border-white/10 pl-2">
                        <div class="flex items-center gap-2">
                            <x-group::nostr-avatar picture="c.picture" name="c.name" />
                            <span class="truncate text-sm font-semibold" x-text="c.name"></span>
                            <span class="inline-flex size-4 shrink-0 items-center justify-center">
                                <x-group::nostr-nip05 nip05="c.nip05" />
                            </span>
                            <span class="shrink-0 font-mono text-[0.7rem] text-muted" x-text="c.time"></span>
                        </div>
                        {{-- Bei verschachtelten Antworten: „Antwort auf <Autor>". --}}
                        <template x-if="c.replyToName">
                            <div class="text-xs text-muted">
                                {{ __('Antwort auf') }} <span class="text-brand-500" x-text="c.replyToName"></span>
                            </div>
                        </template>
                        <div class="chat-content text-sm break-words whitespace-pre-wrap" x-html="c.html"
                             x-on:click="if ($event.target.matches('img.chat-image')) { $event.stopPropagation(); lightboxSrc = $event.target.dataset.full }"></div>
                        <flux:button size="xs" variant="ghost" icon="arrow-uturn-left" class="icon-btn-touch -ml-1 mt-0.5"
                                     x-show="joined" x-cloak x-on:click="setThreadReply(c)">{{ __('Antworten') }}</flux:button>
                    </div>
                </template>
            </div>

            {{-- Composer: Root kommentieren oder auf einen Kommentar antworten. --}}
            <div class="border-t border-white/10 p-3">
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
                        <div class="flex items-end gap-2">
                            <flux:textarea x-ref="threadComposer" x-model="threadDraft" rows="1" resize="none" class="flex-1"
                                           placeholder="{{ __('Im Thread antworten…') }}" aria-label="{{ __('Antwort schreiben') }}"
                                           x-on:keydown="if ($event.key === 'Enter' && !$event.shiftKey) { $event.preventDefault(); sendComment() }" />
                            <flux:button type="button" variant="primary" icon="paper-airplane" class="icon-btn-touch"
                                         x-on:click="sendComment()"
                                         ::disabled="threadDraft.trim().length === 0"
                                         aria-label="{{ __('Antwort senden') }}" />
                        </div>
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
