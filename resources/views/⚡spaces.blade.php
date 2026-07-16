<?php

use Einundzwanzig\Group\ImageProxy;
use Einundzwanzig\Group\Nostr\SpaceCache;
use Illuminate\Support\Facades\View;
use Livewire\Attributes\Layout;
use Livewire\Component;

/**
 * Space-Seite (Single-Space §12) als Livewire-Full-Page-SFC. Die Klasse ist ein
 * dünner Shell — der reaktive Zustand lebt in der welshman/Alpine-Insel (`x-data`).
 * Titel + OG-Bild kommen aus dem NIP-11-Read-Cache (B5): Space-Name statt „Space",
 * Space-icon als OG. Cache-Miss = Fallback „Space"/Marken-OG; die Insel füllt live.
 */
new #[Layout('group::einundzwanzig')] class extends Component
{
    public string $spaceName = 'Space';

    public ?string $ogImage = null;

    public function mount(SpaceCache $cache): void
    {
        $info = $cache->relayInfo(SpaceCache::spaceUrl());
        $this->spaceName = $info['name'] ?: 'Space';
        $this->ogImage = $info['icon'] ? url(ImageProxy::url($info['icon'], 'og')) : null;
    }

    public function render()
    {
        View::share('ogImage', $this->ogImage);

        return $this->view()->title($this->spaceName);
    }
}; ?>

<x-group::app-shell>

    {{-- Genau EIN fixierter Space + seine Räume (kein Multi-Space-Layout, §12).
         Der `nostrSpaces`-Scope umschließt auch den Header, damit dessen Titel den
         echten Space-Namen (NIP-11) zeigen kann (B1). --}}
    <div x-data="nostrSpaces" class="page-enter">

        {{-- NIP-11-Kopfbild (B6): breiter Space-Banner über dem Header, wenn der
             Relay `banner` liefert. Proxifiziert (banner-Preset, 3:1), Fade nach
             unten hält den Header darunter lesbar. Kein Banner → nichts (kein
             Platzhalter). Dekorativ → einstufiger onerror (Bild weg statt Chip). --}}
        <template x-if="space?.banner">
            <div class="relative mb-4 overflow-hidden rounded-card ring-1 ring-black/5 dark:ring-white/10">
                <img :src="$img(space.banner, 'banner')" alt="" loading="lazy"
                     class="h-28 w-full object-cover md:h-32"
                     x-on:error="$el.parentElement.remove()" />
                <div class="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-zinc-50 to-transparent dark:from-zinc-950"></div>
            </div>
        </template>

        {{-- Kopf: echter Space-Name (NIP-11, Fallback „Space") + NIP-11-Beschreibung
             + wer bin ich + Abmelden. Space-Identität lebt NUR hier (kein doppelter
             Name in der Karte darunter). --}}
        <x-group::app-header title="{{ __('Space') }}" :title-expr="'space?.label || ' . json_encode(__('Space'))" x-data="nostrAuth">
            <x-slot:subtitle>
                <div x-show="space?.description" x-cloak class="truncate text-xs text-muted" x-text="space?.description"></div>
                <div class="truncate font-mono text-xs text-muted" x-text="npub"></div>
            </x-slot:subtitle>
            <x-slot:actions>
                <flux:button variant="ghost" size="sm" x-on:click="doLogout()">{{ __('Abmelden') }}</flux:button>
            </x-slot:actions>
        </x-group::app-header>

        {{-- Vereins-Gate: Nicht-Vereinsmitglieder auf einem EINUNDZWANZIG-Vereins-Relay --}}
        <x-group::verein-gate context="{{ __('Räume und Chat') }}" class="mb-4" />

        {{-- Erstes Laden: Space-Meta noch nicht da → Skeleton-Card statt nackte Fläche. --}}
        <div x-show="!space && loading" x-cloak class="surface-card p-4" aria-busy="true">
            <span class="sr-only" aria-live="polite">{{ __('Space wird geladen…') }}</span>
            <div class="flex items-center gap-2">
                <div class="skeleton size-4"></div>
                <div class="skeleton h-4 w-32"></div>
            </div>
            <div class="mt-3 space-y-2">
                <div class="skeleton h-4 w-40"></div>
                <div class="skeleton h-4 w-28"></div>
                <div class="skeleton h-4 w-36"></div>
            </div>
        </div>

        {{-- Räume UND Threads als Tabs OBEN (Flux, Alpine-getrieben): die Räume-Liste kann
             lang werden — ein Tab-Umschalter hält beide auf einer Ebene, ohne Scrollen.
             Kein Bottom-Nav (das bräuchte ein neues Mobile-App-Icon). Erster Tab = Räume. --}}
        <div x-show="space" x-cloak>
            <flux:tab.group>
                <flux:tabs variant="segmented" class="w-full" x-model="tab">
                    <flux:tab name="rooms" icon="hashtag">
                        {{ __('Räume') }}
                        <span x-show="((space?.userRooms.length ?? 0) + (space?.otherRooms.length ?? 0)) > 0" x-cloak
                              class="ml-1.5 rounded-full bg-brand-500/10 px-1.5 font-mono text-[0.65rem] font-semibold text-brand-600 dark:text-brand-400"
                              x-text="(space.userRooms.length + space.otherRooms.length)"></span>
                    </flux:tab>
                    <flux:tab name="threads" icon="chat-bubble-left-right">
                        {{ __('Threads') }}
                        <span x-show="threads.length > 0" x-cloak
                              class="ml-1.5 rounded-full bg-brand-500/10 px-1.5 font-mono text-[0.65rem] font-semibold text-brand-600 dark:text-brand-400"
                              x-text="threads.length"></span>
                    </flux:tab>
                </flux:tabs>

                {{-- Tab „Räume" --}}
                <flux:tab.panel name="rooms" class="mt-3">
                    {{-- Admin (P4): neuen Raum anlegen (NIP-29 9007/9002). --}}
                    <div x-show="isAdmin" x-cloak class="mb-2 flex justify-end">
                        <flux:button size="sm" variant="primary" icon="plus" x-on:click="openRoomCreate()">{{ __('Raum') }}</flux:button>
                    </div>
                    <div class="surface-card overflow-hidden p-3">
                        {{-- Räume laden noch --}}
                        <template x-if="loading && space && space.userRooms.length === 0 && space.otherRooms.length === 0">
                            <div class="space-y-2 p-2">
                                <div class="skeleton h-8 rounded-tile"></div>
                                <div class="skeleton h-8 rounded-tile"></div>
                            </div>
                        </template>

                        {{-- Vereins-gated: die Räume liefert der Relay gar nicht aus → erklärende Zeile. --}}
                        <template x-if="!loading && space && space.userRooms.length === 0 && space.otherRooms.length === 0 && gatedOut">
                            <div class="empty-state py-6 text-center">
                                <flux:icon.lock-closed class="mx-auto size-8 text-zinc-400" />
                                <flux:text class="mt-2 text-sm">{{ __('Räume sind nur für Vereinsmitglieder sichtbar.') }}</flux:text>
                            </div>
                        </template>

                        {{-- Wirklich leer: Icon + Text (empty-state) statt grauer Zeile — konsistent zu Room/Directory. --}}
                        <template x-if="!loading && space && space.userRooms.length === 0 && space.otherRooms.length === 0 && !gatedOut">
                            <div class="empty-state py-6 text-center">
                                <flux:icon.hashtag class="mx-auto size-8 text-zinc-400" />
                                <flux:text class="mt-2 text-sm">{{ __('Dieser Space hat noch keine Räume.') }}</flux:text>
                            </div>
                        </template>

                        {{-- Meine Räume (beigetreten laut 39002) --}}
                        <template x-if="(space?.userRooms.length ?? 0) > 0">
                            <div>
                                <p class="px-2 pb-1 text-[0.7rem] font-semibold uppercase tracking-wider text-muted">{{ __('Meine Räume') }}</p>
                                <div class="space-y-0.5">
                                    <template x-for="room in space.userRooms" :key="room.h">
                                        <x-group::room-tile />
                                    </template>
                                </div>
                            </div>
                        </template>

                        {{-- Entdeckbare Räume --}}
                        <template x-if="(space?.otherRooms.length ?? 0) > 0">
                            <div :class="(space?.userRooms.length ?? 0) > 0 ? 'mt-3' : ''">
                                <p class="px-2 pb-1 text-[0.7rem] font-semibold uppercase tracking-wider text-muted">{{ __('Andere Räume') }}</p>
                                <div class="space-y-0.5">
                                    <template x-for="room in space.otherRooms" :key="room.h">
                                        <x-group::room-tile />
                                    </template>
                                </div>
                            </div>
                        </template>
                    </div>
                </flux:tab.panel>

                {{-- Tab „Threads" (C6b): aktive Threads des Space, RAUMÜBERGREIFEND. Klick öffnet
                     den Thread direkt im jeweiligen Raum (Deep-Link ?thread=). Slack-Stil:
                     Gesichter + Autor + Raum-Badge + „N Antworten · vor …". --}}
                <flux:tab.panel name="threads" class="mt-3">
                    <div class="surface-card overflow-hidden">
                        <template x-if="threads.length === 0">
                            <div class="empty-state py-8 text-center">
                                <flux:icon.chat-bubble-left-right class="mx-auto size-8 text-zinc-400" />
                                <flux:text class="mt-2 text-sm">{{ __('Noch keine Threads. Antworte im Thread auf eine Nachricht, um einen zu starten.') }}</flux:text>
                            </div>
                        </template>
                        <div x-show="threads.length > 0" x-cloak class="divide-y divide-zinc-200/60 dark:divide-zinc-800/60">
                            <template x-for="t in threads" :key="t.rootId">
                                <button type="button"
                                        x-on:click="Livewire.navigate('/rooms/' + encodeURIComponent(t.roomH) + '/thread/' + t.nevent)"
                                        :disabled="!t.roomH"
                                        :aria-label="(t.authorName || @js(__('Nachricht'))) + ': ' + t.snippet + ' — ' + t.count + @js(__(' Antworten, öffnen'))"
                                        class="pressable flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-brand-500/5 disabled:cursor-default disabled:opacity-60">
                                    {{-- Teilnehmer-Gesichter (jüngste zuerst, überlappend). --}}
                                    <span class="mt-0.5 flex shrink-0 -space-x-2">
                                        <template x-for="f in t.faces" :key="f.pubkey">
                                            <span class="inline-flex rounded-full ring-2 ring-white dark:ring-zinc-900">
                                                <x-group::nostr-avatar picture="f.picture" name="f.name" size="1.6rem" />
                                            </span>
                                        </template>
                                    </span>
                                    <span class="min-w-0 flex-1">
                                        <span class="truncate text-sm font-semibold" x-text="t.authorName || @js(__('Nachricht'))"></span>
                                        <span class="mt-0.5 block truncate text-sm text-muted" x-text="t.snippet || @js(__('(Nachricht wird geladen…)'))"></span>
                                        <span class="mt-1 block text-xs">
                                            <span class="font-semibold text-brand-600 dark:text-brand-400" x-text="t.count + (t.count === 1 ? @js(__(' Antwort')) : @js(__(' Antworten')))"></span>
                                            <span class="text-muted" x-text="' · ' + t.lastLabel"></span>
                                        </span>
                                    </span>
                                    <flux:icon.chevron-right class="mt-1 size-4 shrink-0 text-muted" />
                                </button>
                            </template>
                        </div>
                    </div>
                </flux:tab.panel>
            </flux:tab.group>
        </div>

        {{-- ── Raum-Verwaltung (P4, Admin) ──────────────────────────────────── --}}

        {{-- Raum anlegen/bearbeiten (NIP-29 9007/9002). Leeres roomForm.h = Anlegen. --}}
        <flux:modal name="room-form" class="max-w-sm">
            <div class="space-y-4">
                <flux:heading size="lg" x-text="roomForm.h ? @js(__('Raum bearbeiten')) : @js(__('Neuer Raum'))"></flux:heading>

                {{-- Raumbild: runde-eckige Vorschau + „wählen". Upload erst beim Speichern. --}}
                <div class="flex items-center gap-3">
                    <div class="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-tile bg-zinc-100 dark:bg-zinc-800">
                        <img x-show="roomForm.picture" :src="roomForm.picture" alt="" class="size-full object-cover" />
                        <span x-show="!roomForm.picture" class="font-mono text-lg font-semibold text-zinc-400">#</span>
                    </div>
                    <flux:button size="sm" variant="ghost" icon="photo" x-on:click="$refs.roomPic.click()">{{ __('Bild wählen') }}</flux:button>
                    <input type="file" accept="image/*" class="hidden" x-ref="roomPic" x-on:change="pickRoomPicture($event.target)" />
                </div>

                <flux:input label="{{ __('Name') }}" x-model="roomForm.name" placeholder="{{ __('z.B. Allgemein') }}" />
                <flux:textarea label="{{ __('Beschreibung') }}" x-model="roomForm.about" rows="2" placeholder="{{ __('Optional') }}" />

                {{-- Native Checkboxen (zuverlässiges x-model) statt Flux-Komponente.
                     „closed" = Beitritt braucht Admin-Freigabe → Anfragen landen in der
                     Beitritts-Queue (Mitglieder-Tab → Meldungen/Beitritte). --}}
                <label class="flex items-center gap-2 text-sm">
                    <input type="checkbox" x-model="roomForm.isPrivate" class="accent-brand-500" />
                    {{ __('Privater Raum (nur Mitglieder)') }}
                </label>
                <label class="flex items-center gap-2 text-sm">
                    <input type="checkbox" x-model="roomForm.isClosed" class="accent-brand-500" />
                    {{ __('Beitritt nur mit Freigabe') }}
                </label>

                <div class="flex justify-end gap-2">
                    <flux:modal.close><flux:button variant="ghost">{{ __('Abbrechen') }}</flux:button></flux:modal.close>
                    <flux:button variant="primary" x-on:click="saveRoom()" ::disabled="roomSaving || !roomForm.name.trim()">{{ __('Speichern') }}</flux:button>
                </div>
            </div>
        </flux:modal>

        {{-- Raum löschen (NIP-29 9008 → 39000-Tombstone). --}}
        <flux:modal name="delete-room" class="max-w-sm">
            <div class="space-y-4">
                <flux:heading size="lg">{{ __('Raum löschen?') }}</flux:heading>
                <flux:text>{{ __('Dieser Raum wird für alle entfernt. Das lässt sich nicht rückgängig machen.') }}</flux:text>
                <div class="surface-card rounded-tile p-2 text-sm font-medium" x-text="pendingRoomDelete?.name"></div>
                <div class="flex justify-end gap-2">
                    <flux:modal.close><flux:button variant="ghost">{{ __('Abbrechen') }}</flux:button></flux:modal.close>
                    <flux:button variant="danger" x-on:click="confirmDeleteRoom()" ::disabled="roomSaving">{{ __('Löschen') }}</flux:button>
                </div>
            </div>
        </flux:modal>

        {{-- Raum-Mitglieder (P4b): 39002-Liste + Hinzufügen (npub → 9000)/Entfernen (9001).
             x-on:close räumt die Live-Subscription ab. --}}
        <flux:modal name="room-members" class="max-w-sm" x-on:close="closeRoomMembers()">
            <div class="space-y-4">
                <flux:heading size="lg">{{ __('Mitglieder') }} <span class="text-muted" x-text="membersRoom ? '# ' + membersRoom.name : ''"></span></flux:heading>

                {{-- Hinzufügen per npub/hex. --}}
                <div class="flex items-end gap-2">
                    <flux:input class="flex-1" label="{{ __('npub hinzufügen') }}" x-model="memberNpub" placeholder="npub1…" />
                    <flux:button variant="primary" icon="user-plus" x-on:click="addRoomMemberByNpub()" ::disabled="memberBusy || !memberNpub.trim()" aria-label="{{ __('Hinzufügen') }}" />
                </div>

                <template x-if="roomMembers.length === 0">
                    <flux:text class="text-sm text-muted">{{ __('Noch keine Mitglieder in diesem Raum.') }}</flux:text>
                </template>
                <div class="space-y-2">
                    <template x-for="m in roomMembers" :key="m.pubkey">
                        <div class="surface-card flex items-center gap-3 p-2">
                            <button type="button" x-on:click="$dispatch('open-profile', m.pubkey)" class="pressable shrink-0" aria-label="{{ __('Profil anzeigen') }}">
                                <x-group::nostr-avatar picture="m.picture" name="m.name" />
                            </button>
                            <div class="min-w-0 flex-1">
                                <div class="truncate text-sm font-medium" x-text="m.name"></div>
                                <div class="truncate font-mono text-xs text-muted" x-text="m.short"></div>
                            </div>
                            <flux:button size="xs" variant="ghost" icon="user-minus" class="icon-btn-touch shrink-0" x-on:click="kickRoomMember(m.pubkey)" ::disabled="memberBusy" aria-label="{{ __('Entfernen') }}" />
                        </div>
                    </template>
                </div>
            </div>
        </flux:modal>

        <x-group::profile-card />
    </div>

</x-group::app-shell>
