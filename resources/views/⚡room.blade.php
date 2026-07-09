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

    public function mount(string $h, SpaceCache $cache): void
    {
        $this->h = $h;
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
<div x-data="nostrRoomChat(@js($h))" class="mx-auto flex h-dvh w-full max-w-md md:max-w-lg lg:max-w-2xl flex-col px-4 pt-[max(env(safe-area-inset-top),1rem)] pb-[max(env(safe-area-inset-bottom),1rem)]">

    <x-group::app-header :title="'# '.($roomName ?? $h)" :back="route('group.spaces')" class="shrink-0">
        @if ($roomPicture)
            <x-slot:leading>
                <flux:avatar circle size="sm" src="{{ \Einundzwanzig\Group\ImageProxy::url($roomPicture) }}" name="{{ $roomName ?? $h }}" />
            </x-slot:leading>
        @endif
        <x-slot:actions>
            {{-- Mitglied → Verlassen (kind 9022). Beitreten liegt beim Composer. --}}
            <flux:button size="xs" variant="ghost" icon="arrow-right-start-on-rectangle"
                         x-show="joined" x-cloak x-on:click="leave()" ::disabled="joining" aria-label="Raum verlassen">
                Verlassen
            </flux:button>
        </x-slot:actions>
    </x-group::app-header>

    <div class="relative flex min-h-0 flex-1 flex-col">

        {{-- Ladefehler (Relay nicht erreichbar / AUTH-Reject): persistenter Callout + Retry. --}}
        <template x-if="error">
            <flux:callout variant="danger" icon="exclamation-triangle" class="mb-2 shrink-0">
                <flux:callout.text x-text="error"></flux:callout.text>
                <x-slot name="actions">
                    <flux:button size="sm" variant="ghost" icon="arrow-path" x-on:click="retry()">Erneut laden</flux:button>
                </x-slot>
            </flux:callout>
        </template>

        <div x-ref="scroll" x-on:scroll.debounce.50ms="onScroll()"
             role="log" aria-live="polite" aria-relevant="additions" aria-label="Chat-Verlauf"
             ::aria-busy="loading && messages.length === 0"
             class="min-h-0 flex-1 space-y-0.5 overflow-y-auto pb-4 transition-opacity"
             :class="(!firstPaintDone && messages.length > 0) ? 'opacity-0' : 'opacity-100'">

            {{-- Ältere laden (Cursor-Pagination) --}}
            <div class="py-2 text-center" x-show="hasMore && messages.length > 0" x-cloak>
                <flux:button size="xs" variant="ghost" x-on:click="loadOlder()" ::disabled="loadingMore">
                    <span x-text="loadingMore ? 'Lädt…' : 'Ältere laden'"></span>
                </flux:button>
            </div>

            {{-- Erstes Laden --}}
            <template x-if="loading && messages.length === 0">
                <div class="space-y-3 pt-4">
                    <span class="sr-only" aria-live="polite">Verlauf wird geladen…</span>
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
                    <flux:text class="mt-2">Noch keine Nachrichten in diesem Raum.</flux:text>
                </div>
            </template>

            {{-- Verlauf --}}
            <template x-for="m in messages" :key="m.id">
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
                            <span class="shrink-0 font-mono text-[0.7rem] font-semibold tracking-wide text-brand-500">Neue Nachrichten</span>
                            <flux:separator class="flex-1" />
                        </div>
                    </template>

                    {{-- Zeile: Tap blendet die Aktionen ein/aus (Touch); :title = volles Datum. --}}
                    <div :id="'msg-'+m.id" :title="m.fullTime"
                         x-on:click="activeId = (activeId===m.id ? null : m.id)"
                         class="group flex gap-2 rounded-card px-1 transition-shadow"
                         :class="[m.showAuthor ? 'mt-2.5' : '', flashId===m.id ? 'ring-2 ring-brand-500/70' : '']">
                        <div class="w-8 shrink-0">
                            <template x-if="m.showAuthor">
                                <button type="button" x-on:click.stop="$dispatch('open-profile', m.pubkey)"
                                        class="pressable" aria-label="Profil anzeigen">
                                    <x-group::nostr-avatar picture="m.picture" name="m.name" />
                                </button>
                            </template>
                            {{-- Folgezeile ohne Autor-Kopf: HH:MM erscheint links bei Hover. --}}
                            <template x-if="!m.showAuthor">
                                <div class="pt-0.5 text-right font-mono text-[0.65rem] leading-4 text-muted opacity-0 transition-opacity group-hover:opacity-100"
                                     x-text="m.time"></div>
                            </template>
                        </div>
                        <div class="min-w-0 flex-1">
                            <template x-if="m.showAuthor">
                                <div class="flex items-baseline gap-2">
                                    <button type="button" x-on:click.stop="$dispatch('open-profile', m.pubkey)"
                                            class="pressable truncate text-left text-sm font-semibold hover:underline" x-text="m.name"></button>
                                    <x-group::nostr-nip05 nip05="m.nip05" />
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
                            {{-- Reaction-Chips (C1): pro Emoji Zähler + eigener Toggle-Zustand. --}}
                            <template x-if="m.reactions.length">
                                <div class="mt-1 flex flex-wrap gap-1">
                                    <template x-for="r in m.reactions" :key="r.key">
                                        <button type="button" x-on:click.stop="toggleReaction(m, r)" :aria-pressed="r.mine"
                                                class="pressable inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs leading-none"
                                                :class="r.mine ? 'border-brand-500 bg-brand-500/15 text-brand-500' : 'border-white/10 bg-white/5 text-muted hover:border-brand-500/50'">
                                            <template x-if="r.emojiUrl"><img class="chat-emoji" :src="r.emojiUrl" :alt="r.content" loading="lazy" /></template>
                                            <template x-if="!r.emojiUrl"><span x-text="r.label"></span></template>
                                            <span x-show="r.count > 1" x-text="r.count" class="font-mono"></span>
                                        </button>
                                    </template>
                                </div>
                            </template>
                        </div>
                        {{-- Aktionen: bei Hover (Desktop) oder aktivem Tap (Touch). --}}
                        <div class="pointer-events-none flex shrink-0 items-start gap-0.5 self-start opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 focus-within:opacity-100"
                             :class="activeId===m.id && '!pointer-events-auto !opacity-100'">
                            <flux:button size="xs" variant="ghost" icon="arrow-uturn-left" class="icon-btn-touch"
                                         x-on:click.stop="setReply(m)" aria-label="Antworten" />
                            <flux:button size="xs" variant="ghost" icon="trash" class="icon-btn-touch"
                                         x-show="m.mine" x-cloak x-on:click.stop="askDelete(m)" ::disabled="deleting"
                                         aria-label="Nachricht löschen" />
                            {{-- Reaktions-Picker (C1, Web): Standard-Set als Alpine-Popover (flux:menu
                                 rendert nur menu.item-Kinder → eigene, kontrollierte Auswahl). Native
                                 App reagiert über das „…"-Modal (message-menu). --}}
                            <template x-if="!isMobile">
                                <div class="relative" x-data="{ open: false }" x-on:click.stop
                                     x-on:keydown.escape.window="open = false">
                                    <flux:button size="xs" variant="ghost" icon="face-smile"
                                                 class="icon-btn-touch" x-on:click="open = !open" aria-label="Reagieren" />
                                    <div x-show="open" x-cloak x-transition x-on:click.outside="open = false"
                                         class="surface-card absolute bottom-full right-0 z-20 mb-1 flex gap-0.5 rounded-card p-1 shadow-lg">
                                        <x-group::reaction-picker message="m" onpick="open = false" />
                                    </div>
                                </div>
                            </template>
                            {{-- „…"-Menü = gemeinsamer Andockpunkt für alle weiteren Aktionen (C1–C4).
                                 Web: Zeilen-Popover (flux:dropdown). Native App: Vollbild-Modal (openMessageMenu). --}}
                            <template x-if="!isMobile">
                                <div x-on:click.stop>
                                    <flux:dropdown position="top" align="end">
                                        <flux:button size="xs" variant="ghost" icon="ellipsis-horizontal"
                                                     class="icon-btn-touch" aria-label="Weitere Aktionen" />
                                        <flux:menu>
                                            <flux:menu.item icon="arrow-uturn-left" x-on:click="setReply(m)">Antworten</flux:menu.item>
                                            {{-- Melden: fremde Nachrichten (NIP-56 kind 1984). --}}
                                            <template x-if="!m.mine">
                                                <flux:menu.item icon="flag" x-on:click="askReport(m)">Melden</flux:menu.item>
                                            </template>
                                            {{-- Löschen: nur eigene Nachrichten (NIP-09 kind 5). --}}
                                            <template x-if="m.mine">
                                                <flux:menu.item icon="trash" variant="danger" x-on:click="askDelete(m)">Löschen</flux:menu.item>
                                            </template>
                                            {{-- C4: Kopieren/Info --}}
                                        </flux:menu>
                                    </flux:dropdown>
                                </div>
                            </template>
                            <template x-if="isMobile">
                                <flux:button size="xs" variant="ghost" icon="ellipsis-horizontal"
                                             class="icon-btn-touch" x-on:click.stop="openMessageMenu(m)"
                                             aria-label="Weitere Aktionen" />
                            </template>
                        </div>
                    </div>
                </div>
            </template>
        </div>

        {{-- Zurück ans Ende, sobald hochgescrollt — mit Zähler, wenn neue Nachrichten warten.
             Zwei Buttons: flux erkennt „Icon-only vs. Pille" server-seitig am Slot (ein
             x-show-Span bliebe immer „nicht leer" → Pfeil säße links statt zentriert). --}}
        <div class="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center" x-show="!atBottom" x-cloak
             x-transition.opacity>
            {{-- Keine ungelesenen → quadratischer Button, Pfeil zentriert. --}}
            <flux:button x-show="unread === 0" size="xs" variant="primary" square icon="arrow-down"
                         class="pointer-events-auto" x-on:click="scrollToBottom()" aria-label="Zum Ende springen" />
            {{-- Ungelesene → Pille mit Zähler. --}}
            <flux:button x-show="unread > 0" x-cloak size="xs" variant="primary" icon="arrow-down"
                         class="pointer-events-auto" x-on:click="scrollToBottom()" aria-label="Zum Ende springen">
                <span x-text="unread"></span> neue
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

        {{-- Antwort-Kontext (Zitat) über dem Composer, mit Abbrechen --}}
        <div x-show="membershipReady && joined && replyTo" x-cloak
             class="surface-card mb-1 flex items-center gap-2 border-l-2 border-brand-500/60 px-3 py-1.5">
            <div class="min-w-0 flex-1">
                <div class="text-xs font-semibold text-brand-500">Antwort an <span x-text="replyTo?.name"></span></div>
                <div class="truncate text-xs text-muted" x-text="replyTo?.text"></div>
            </div>
            <flux:button size="xs" variant="ghost" icon="x-mark" x-on:click="clearReply()" aria-label="Antwort abbrechen" />
        </div>

        <div x-show="membershipReady && joined" x-cloak class="flex items-end gap-2">
            <flux:textarea x-ref="composer" x-model="draft" rows="1" resize="none"
                           placeholder="Nachricht schreiben…" aria-label="Nachricht schreiben" class="flex-1"
                           x-on:focus="atBottom && scrollToBottom()"
                           x-on:input="autoGrow($event.target); sendError = ''"
                           x-on:keydown.enter="if (!$event.shiftKey) { $event.preventDefault(); send() }" />
            <flux:button type="button" variant="primary" icon="paper-airplane" :loading="true"
                         x-on:click="send()" ::data-loading="sending" ::disabled="sending || draft.trim().length === 0"
                         aria-label="Senden" />
        </div>

        {{-- Fehlgeschlagen: aktionable Hinweiszeile statt flüchtigem Toast (Draft ist gefüllt). --}}
        <div x-show="membershipReady && joined && sendError" x-cloak
             class="mt-1 flex items-center justify-between gap-2 rounded-tile bg-red-500/10 px-3 py-1.5 text-xs text-red-500">
            <span x-text="sendError"></span>
            <button type="button" x-on:click="send()" class="pressable shrink-0 font-semibold text-brand-500 hover:underline">
                Erneut senden
            </button>
        </div>

        <div x-show="membershipReady && !joined" x-cloak
             class="surface-card flex items-center justify-between gap-3 p-3">
            <flux:text class="text-sm text-muted">Tritt dem Raum bei, um mitzuschreiben.</flux:text>
            <flux:button size="sm" variant="primary" icon="plus" x-on:click="join()" ::disabled="joining">
                <span x-text="joining ? 'Trete bei…' : 'Beitreten'"></span>
            </flux:button>
        </div>
    </div>

    {{-- Löschen bestätigen (NIP-09 ist unwiderruflich). --}}
    <flux:modal name="delete-message" class="max-w-sm">
        <div class="space-y-4">
            <flux:heading size="lg">Nachricht löschen?</flux:heading>
            <flux:text>Das lässt sich nicht rückgängig machen.</flux:text>
            <div class="flex justify-end gap-2">
                <flux:modal.close><flux:button variant="ghost">Abbrechen</flux:button></flux:modal.close>
                <flux:button variant="danger" x-on:click="confirmDelete()" ::disabled="deleting">Löschen</flux:button>
            </div>
        </div>
    </flux:modal>

    {{-- Melden (NIP-56 kind 1984): Grund-Auswahl + optionaler Freitext. Geht ohne
         `h`/PROTECTED ans Relay (keine Group-Message). --}}
    <flux:modal name="report-message" class="max-w-sm">
        <div class="space-y-4">
            <flux:heading size="lg">Nachricht melden</flux:heading>
            <flux:select x-model="reportReason" label="Grund">
                <flux:select.option value="spam">Spam</flux:select.option>
                <flux:select.option value="illegal">Illegal</flux:select.option>
                <flux:select.option value="nudity">Nacktheit</flux:select.option>
                <flux:select.option value="profanity">Beleidigung</flux:select.option>
                <flux:select.option value="impersonation">Identitätsdiebstahl</flux:select.option>
                <flux:select.option value="other">Sonstiges</flux:select.option>
            </flux:select>
            <flux:textarea x-model="reportText" label="Details (optional)" rows="2"
                           placeholder="Was ist mit dieser Nachricht?" />
            <div class="flex justify-end gap-2">
                <flux:modal.close><flux:button variant="ghost">Abbrechen</flux:button></flux:modal.close>
                <flux:button variant="danger" x-on:click="confirmReport()" ::disabled="reporting">Melden</flux:button>
            </div>
        </div>
    </flux:modal>

    {{-- Interaktions-Menü (native App): Aktionen zur angetippten Nachricht.
         Web nutzt stattdessen das Zeilen-Popover (flux:dropdown). Einträge wachsen
         mit C1–C4; `menuFor` hält die Zielnachricht. --}}
    <flux:modal name="message-menu" class="max-w-sm">
        <div class="flex flex-col gap-1">
            <flux:heading size="sm" class="mb-1">Nachricht</flux:heading>
            {{-- Reaktions-Picker (C1, native App): Standard-Set als Emoji-Reihe. --}}
            <div class="mb-1 flex gap-1">
                <x-group::reaction-picker message="menuFor" class="px-2 py-1.5 text-xl" />
            </div>
            <flux:button variant="ghost" icon="arrow-uturn-left" class="w-full justify-start"
                         x-on:click="if (menuFor) { setReply(menuFor); closeMessageMenu() }">Antworten</flux:button>
            {{-- Melden (fremd) / Löschen (eigen): askReport/askDelete merken die Zielnachricht,
                 dann schließt das Menü-Modal (öffnet Melde- bzw. Löschen-Bestätigung). --}}
            <flux:button variant="ghost" icon="flag" class="w-full justify-start" x-show="!menuFor?.mine" x-cloak
                         x-on:click="if (menuFor) { askReport(menuFor); closeMessageMenu() }">Melden</flux:button>
            <flux:button variant="danger" icon="trash" class="w-full justify-start" x-show="menuFor?.mine" x-cloak
                         x-on:click="if (menuFor) { askDelete(menuFor); closeMessageMenu() }">Löschen</flux:button>
            {{-- C4: Kopieren/Info --}}
        </div>
    </flux:modal>

    {{-- Lightbox: Vollbild eines angeklickten Inline-Bilds (Proxy-Preset `full`).
         Klick/Esc schließt; Proxy-Fehler → Original-URL (Offline-Fallback). --}}
    <div x-show="lightboxSrc" x-cloak x-transition.opacity
         x-on:click="lightboxSrc = null" x-on:keydown.escape.window="lightboxSrc = null"
         class="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
        <img :src="lightboxSrc" alt="" class="max-h-full max-w-full rounded-card"
             x-on:error="$el.dataset.orig || ($el.dataset.orig = 1, $el.src = decodeURIComponent(($el.src.split('src=')[1] || '')))" />
    </div>

    <x-group::profile-card />
</div>
