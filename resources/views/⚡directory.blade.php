<?php

use Einundzwanzig\Group\ImageProxy;
use Einundzwanzig\Group\Nostr\SpaceCache;
use Illuminate\Support\Facades\View;
use Livewire\Attributes\Layout;
use Livewire\Component;

/** Directory (Mitglieder + Rollen des aktiven Space) als Livewire-SFC. */
new #[Layout('group::einundzwanzig')] class extends Component
{
    public ?string $ogImage = null;

    public function mount(SpaceCache $cache): void
    {
        // OG-Bild = Space-icon (NIP-11), konsistent zur Space-Seite (B5).
        $icon = $cache->relayInfo(SpaceCache::spaceUrl())['icon'];
        $this->ogImage = $icon ? url(ImageProxy::url($icon, 'og')) : null;
    }

    public function render()
    {
        View::share('ogImage', $this->ogImage);

        return $this->view()->title(__('Mitglieder'));
    }
}; ?>

<x-group::app-shell>

    {{-- Kopf: Brand-Mark (kein :back — gleichrangiger Bottom-Nav-Tab, §Bottom-Nav) --}}
    <x-group::app-header title="{{ __('Mitglieder') }}" />

    {{-- Vereins-Gate: Nicht-Vereinsmitglieder auf einem EINUNDZWANZIG-Vereins-Relay --}}
    <x-group::verein-gate context="{{ __('Die Mitgliederliste') }}" class="mb-4" />

    {{-- Directory des AKTIVEN Space (§12). Gated auf relay.self (Fix A). --}}
    <div x-data="nostrDirectory" class="page-enter space-y-4">

        {{-- Suche — für Nicht-Vereinsmitglieder ausgeblendet: die Mitgliederliste
             liefert der Relay nicht aus, eine Suche liefe ins Leere. Wrapper-Div,
             weil flux:input x-show sonst nur ans innere <input> hängt (Icon bliebe). --}}
        <div x-show="!gatedOut">
            <flux:input x-model="query" icon="magnifying-glass" placeholder="{{ __('Mitglied suchen…') }}" clearable />
        </div>

        {{-- Admin-Werkzeuge (nur wenn der Relay dem User NIP-86-Methoden erlaubt) --}}
        <div x-show="isAdmin" x-cloak class="flex flex-wrap gap-2">
            <flux:button size="sm" variant="primary" icon="plus" x-on:click="openRoleCreate()">{{ __('Rolle') }}</flux:button>
            <flux:modal.trigger name="roles-list">
                <flux:button size="sm" variant="ghost" icon="swatch">{{ __('Rollen verwalten') }}</flux:button>
            </flux:modal.trigger>
            <flux:modal.trigger name="banned">
                <flux:button size="sm" variant="ghost" icon="no-symbol" x-on:click="loadBanned()">{{ __('Gebannt') }}</flux:button>
            </flux:modal.trigger>
            <flux:modal.trigger name="invite">
                <flux:button size="sm" variant="ghost" icon="user-plus" x-on:click="loadInvite()">{{ __('Einladen') }}</flux:button>
            </flux:modal.trigger>
        </div>

        {{-- Ladezustand: Skeleton, bis relay.self da UND alle Mitglieder-Profile
             geladen sind (profilesReady). Erst dann rendert die Liste in EINEM
             Rutsch — kein progressives Umsortieren/Flackern, im Mobile-WebView
             kein Repaint-Sturm (schwarzer Bildschirm). --}}
        <template x-if="!profilesReady">
            <div class="space-y-2" aria-busy="true">
                <span class="sr-only" aria-live="polite">{{ __('Mitglieder werden geladen…') }}</span>
                <template x-for="i in 4" :key="i">
                    <div class="surface-card flex items-center gap-3 p-3">
                        <div class="skeleton size-9 rounded-full"></div>
                        <div class="flex-1 space-y-1.5">
                            <div class="skeleton h-3.5 w-32"></div>
                            <div class="skeleton h-2.5 w-20"></div>
                        </div>
                    </div>
                </template>
            </div>
        </template>

        {{-- Geladen, aber keine Mitglieder. Für Nicht-Vereinsmitglieder ausgeblendet
             (kein falsches „keine Mitglieder" — die Gate-Karte oben erklärt es). --}}
        <template x-if="profilesReady && members.length === 0 && !gatedOut">
            <div class="surface-card empty-state p-6 text-center">
                <flux:icon.users class="mx-auto size-8 text-zinc-400" />
                <flux:text class="mt-2">{{ __('Noch keine Mitglieder in diesem Space.') }}</flux:text>
            </div>
        </template>

        {{-- Mitglieder-Grid --}}
        <template x-if="profilesReady && members.length > 0">
            <div class="list-stagger space-y-2">
                <template x-for="(m, idx) in filtered()" :key="m.pubkey">
                    <div class="surface-card flex items-center gap-3 p-3" :style="`--i:${idx}`">
                        <button type="button" x-on:click="$dispatch('open-profile', m.pubkey)"
                                class="pressable shrink-0" aria-label="{{ __('Profil anzeigen') }}">
                            <x-group::nostr-avatar picture="m.picture" name="m.name" />
                        </button>
                        <div class="min-w-0 flex-1">
                            <div class="flex items-center gap-1.5">
                                <button type="button" x-on:click="$dispatch('open-profile', m.pubkey)"
                                        class="pressable min-w-0 truncate text-left font-semibold hover:underline" x-text="m.name"></button>
                                <x-group::nostr-nip05 nip05="m.nip05" />
                            </div>
                            {{-- Verifizierter Handle ersetzt die npub-Kurzform, sonst npub. --}}
                            <div class="truncate font-mono text-xs text-muted" x-text="m.nip05 || m.short"></div>
                            <div class="mt-1 flex flex-wrap gap-1" x-show="m.roles.length > 0">
                                <template x-for="role in m.roles" :key="role.id">
                                    <flux:badge size="sm" ::style="`color:${role.color};background-color:${role.soft}`">
                                        <span x-text="role.label"></span>
                                    </flux:badge>
                                </template>
                            </div>
                        </div>

                        {{-- Admin-Aktionen je Mitglied (NIP-86) --}}
                        <div x-show="isAdmin" x-cloak class="shrink-0">
                            <flux:dropdown position="bottom" align="end">
                                <flux:button size="xs" variant="ghost" icon="ellipsis-vertical" class="icon-btn-touch" aria-label="{{ __('Mitglied verwalten') }}" />
                                <flux:menu>
                                    <flux:menu.item icon="swatch" x-on:click="openMemberRoles(m)">{{ __('Rollen bearbeiten') }}</flux:menu.item>
                                    <flux:menu.separator />
                                    <flux:menu.item icon="user-minus" x-on:click="removeMember(m)">{{ __('Entfernen') }}</flux:menu.item>
                                    <flux:menu.item variant="danger" icon="no-symbol" x-on:click="banMember(m)">{{ __('Bannen') }}</flux:menu.item>
                                </flux:menu>
                            </flux:dropdown>
                        </div>
                    </div>
                </template>

                {{-- Suche ohne Treffer --}}
                <template x-if="filtered().length === 0">
                    <div class="surface-card p-4 text-center text-sm text-muted">
                        {{ __('Kein Mitglied passt zu „') }}<span x-text="query"></span>{{ __('".') }}
                    </div>
                </template>
            </div>
        </template>

        {{-- ── Admin-Modals (NIP-86) ─────────────────────────────────────────── --}}

        {{-- Rolle anlegen/bearbeiten (HSL via native range, §6) --}}
        <flux:modal name="role-form" class="max-w-sm">
            <div class="space-y-4">
                <flux:heading size="lg" x-text="roleForm.id ? @js(__('Rolle bearbeiten')) : @js(__('Neue Rolle'))"></flux:heading>

                <flux:input label="{{ __('Bezeichnung') }}" x-model="roleForm.label" placeholder="{{ __('z.B. Vorstand') }}" />
                <flux:textarea label="{{ __('Beschreibung') }}" x-model="roleForm.description" rows="2" placeholder="{{ __('Optional') }}" />

                <div>
                    <flux:text class="mb-1 text-sm font-medium">{{ __('Farbe') }}</flux:text>
                    <div class="flex items-center gap-3">
                        <flux:badge x-bind:style="`color:hsl(${roleForm.hue},70%,${roleForm.lightness*100}%);background-color:hsl(${roleForm.hue},70%,${roleForm.lightness*100}%,0.15)`">
                            <span x-text="roleForm.label || @js(__('Vorschau'))"></span>
                        </flux:badge>
                    </div>
                    <label class="mt-2 block text-xs text-muted">{{ __('Farbton') }}</label>
                    <input type="range" min="0" max="360" step="1" x-model.number="roleForm.hue" class="w-full accent-brand-500" />
                    <label class="mt-1 block text-xs text-muted">{{ __('Helligkeit') }}</label>
                    <input type="range" min="0.2" max="0.8" step="0.01" x-model.number="roleForm.lightness" class="w-full accent-brand-500" />
                </div>

                <div class="flex justify-end gap-2">
                    <flux:modal.close><flux:button variant="ghost">{{ __('Abbrechen') }}</flux:button></flux:modal.close>
                    <flux:button variant="primary" x-on:click="saveRole()" ::disabled="busy || !roleForm.label.trim()">{{ __('Speichern') }}</flux:button>
                </div>
            </div>
        </flux:modal>

        {{-- Rollen verwalten (Liste, bearbeiten/löschen) --}}
        <flux:modal name="roles-list" class="max-w-sm">
            <div class="space-y-4">
                <flux:heading size="lg">{{ __('Rollen') }}</flux:heading>
                <template x-if="rolesFull.length === 0">
                    <flux:text class="text-sm text-muted">{{ __('Noch keine Rollen definiert.') }}</flux:text>
                </template>
                <div class="space-y-2">
                    <template x-for="role in rolesFull" :key="role.id">
                        <div class="surface-card flex items-center gap-2 p-2">
                            <flux:badge size="sm" x-bind:style="`color:hsl(${parseFloat(role.color.hue)||0},70%,${(parseFloat(role.color.lightness)||0.5)*100}%);background-color:hsl(${parseFloat(role.color.hue)||0},70%,${(parseFloat(role.color.lightness)||0.5)*100}%,0.15)`">
                                <span x-text="role.label || role.id"></span>
                            </flux:badge>
                            <span class="min-w-0 flex-1 truncate text-xs text-muted" x-text="role.description"></span>
                            <flux:button size="xs" variant="ghost" icon="pencil-square" class="icon-btn-touch" x-on:click="openRoleEdit(role)" aria-label="{{ __('Bearbeiten') }}" />
                            <flux:button size="xs" variant="ghost" icon="trash" class="icon-btn-touch" x-on:click="removeRole(role.id)" ::disabled="busy" aria-label="{{ __('Löschen') }}" />
                        </div>
                    </template>
                </div>
                <flux:button variant="primary" icon="plus" class="w-full" x-on:click="openRoleCreate()">{{ __('Neue Rolle') }}</flux:button>
            </div>
        </flux:modal>

        {{-- Rollen eines Mitglieds zuweisen (Toggle je Rolle) --}}
        <flux:modal name="member-roles" class="max-w-sm">
            <div class="space-y-4" x-show="editingMember">
                <flux:heading size="lg">{{ __('Rollen von') }} <span x-text="editingMember?.name"></span></flux:heading>
                <template x-if="roles.length === 0">
                    <flux:text class="text-sm text-muted">{{ __('Erst eine Rolle anlegen.') }}</flux:text>
                </template>
                <div class="space-y-1">
                    {{-- Zeilen-Toggle (Check/Plus-Icon + farbiges Rollen-Badge) → rohes <button>,
                         kein Flux-Icon-Pendant für dieses Komposit, §6. --}}
                    <template x-for="role in roles" :key="role.id">
                        <button type="button" x-on:click="toggleMemberRole(role.id)" ::disabled="busy"
                                class="pressable flex w-full items-center gap-2 rounded-tile p-2 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800">
                            <flux:icon.check-circle variant="solid" class="size-5 text-brand-500" x-show="memberHasRole(role.id)" x-cloak />
                            <flux:icon.plus-circle class="size-5 text-zinc-400" x-show="!memberHasRole(role.id)" />
                            <flux:badge size="sm" ::style="`color:${role.color};background-color:${role.soft}`"><span x-text="role.label"></span></flux:badge>
                        </button>
                    </template>
                </div>
            </div>
        </flux:modal>

        {{-- Einladungs-Link generieren (Claim aus kind 28935) --}}
        <flux:modal name="invite" class="max-w-sm">
            <div class="space-y-4">
                <flux:heading size="lg">{{ __('Einladen') }}</flux:heading>
                <flux:text class="text-sm text-muted">{{ __('Teile diesen Link — er führt direkt in den Space.') }}</flux:text>
                <template x-if="inviteBusy">
                    <div class="skeleton h-10 rounded-tile"></div>
                </template>
                <div x-show="!inviteBusy && inviteLink" x-cloak class="flex items-center gap-2">
                    <flux:input readonly x-model="inviteLink" class="flex-1 font-mono text-xs" />
                    <flux:button variant="primary" icon="clipboard" x-on:click="copyInvite()" aria-label="{{ __('Kopieren') }}" />
                </div>
            </div>
        </flux:modal>

        {{-- Gebannte Mitglieder --}}
        <flux:modal name="banned" class="max-w-sm">
            <div class="space-y-4">
                <flux:heading size="lg">{{ __('Gebannt') }}</flux:heading>
                <template x-if="banned.length === 0">
                    <flux:text class="text-sm text-muted">{{ __('Niemand gebannt.') }}</flux:text>
                </template>
                <div class="space-y-2">
                    <template x-for="b in banned" :key="b.pubkey">
                        <div class="surface-card flex items-center gap-2 p-2">
                            <div class="min-w-0 flex-1">
                                <div class="truncate font-mono text-xs text-muted" x-text="b.short"></div>
                                <div class="truncate text-xs text-muted" x-text="b.reason"></div>
                            </div>
                            <flux:button size="xs" variant="ghost" class="icon-btn-touch" x-on:click="unbanMember(b.pubkey)" ::disabled="busy">{{ __('Entbannen') }}</flux:button>
                            <flux:button size="xs" variant="primary" class="icon-btn-touch" x-on:click="restoreMember(b.pubkey)" ::disabled="busy">{{ __('Wiederaufnehmen') }}</flux:button>
                        </div>
                    </template>
                </div>
            </div>
        </flux:modal>

        <x-group::profile-card />

    </div>

</x-group::app-shell>
