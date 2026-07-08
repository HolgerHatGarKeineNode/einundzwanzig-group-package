<?php

use Livewire\Attributes\Layout;
use Livewire\Attributes\Title;
use Livewire\Component;

/** Directory (Mitglieder + Rollen des aktiven Space) als Livewire-SFC. */
new #[Layout('chat::einundzwanzig')] #[Title('Mitglieder')] class extends Component {}; ?>

<main class="mx-auto max-w-md px-4 py-8 pt-safe pb-28">

    {{-- Kopf: zurück zum Space + Titel --}}
    <x-chat::app-header title="Mitglieder" :back="route('chat.spaces')" />

    {{-- Vereins-Gate: Nicht-Vereinsmitglieder auf einem EINUNDZWANZIG-Vereins-Relay --}}
    <x-chat::verein-gate context="Die Mitgliederliste" class="mb-4" />

    {{-- Directory des AKTIVEN Space (§12). Gated auf relay.self (Fix A). --}}
    <div x-data="nostrDirectory" class="page-enter space-y-4">

        {{-- Suche — für Nicht-Vereinsmitglieder ausgeblendet: die Mitgliederliste
             liefert der Relay nicht aus, eine Suche liefe ins Leere. --}}
        <flux:input x-show="!gatedOut" x-model="query" icon="magnifying-glass" placeholder="Mitglied suchen…" clearable />

        {{-- Admin-Werkzeuge (nur wenn der Relay dem User NIP-86-Methoden erlaubt) --}}
        <div x-show="isAdmin" x-cloak class="flex flex-wrap gap-2">
            <flux:button size="sm" variant="primary" icon="plus" x-on:click="openRoleCreate()">Rolle</flux:button>
            <flux:modal.trigger name="roles-list">
                <flux:button size="sm" variant="ghost" icon="swatch">Rollen verwalten</flux:button>
            </flux:modal.trigger>
            <flux:modal.trigger name="banned">
                <flux:button size="sm" variant="ghost" icon="no-symbol" x-on:click="loadBanned()">Gebannt</flux:button>
            </flux:modal.trigger>
            <flux:modal.trigger name="invite">
                <flux:button size="sm" variant="ghost" icon="user-plus" x-on:click="loadInvite()">Einladen</flux:button>
            </flux:modal.trigger>
        </div>

        {{-- Ladezustand (relay.self / NIP-11 noch nicht da) — Skeleton statt „leer" --}}
        <template x-if="!ready">
            <div class="space-y-2">
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
        <template x-if="ready && members.length === 0 && !gatedOut">
            <div class="surface-card empty-state p-6 text-center">
                <flux:icon.users class="mx-auto size-8 text-zinc-400" />
                <flux:text class="mt-2">Noch keine Mitglieder in diesem Space.</flux:text>
            </div>
        </template>

        {{-- Mitglieder-Grid --}}
        <template x-if="ready && members.length > 0">
            <div class="list-stagger space-y-2">
                <template x-for="m in filtered()" :key="m.pubkey">
                    <div class="surface-card flex items-center gap-3 p-3">
                        <flux:avatar circle size="sm" ::src="m.picture || null" ::name="m.name" />
                        <div class="min-w-0 flex-1">
                            <div class="truncate font-semibold" x-text="m.name"></div>
                            <div class="truncate font-mono text-xs text-zinc-500" x-text="m.short"></div>
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
                                <flux:button size="xs" variant="ghost" icon="ellipsis-vertical" aria-label="Mitglied verwalten" />
                                <flux:menu>
                                    <flux:menu.item icon="swatch" x-on:click="openMemberRoles(m)">Rollen bearbeiten</flux:menu.item>
                                    <flux:menu.separator />
                                    <flux:menu.item icon="user-minus" x-on:click="removeMember(m)">Entfernen</flux:menu.item>
                                    <flux:menu.item variant="danger" icon="no-symbol" x-on:click="banMember(m)">Bannen</flux:menu.item>
                                </flux:menu>
                            </flux:dropdown>
                        </div>
                    </div>
                </template>

                {{-- Suche ohne Treffer --}}
                <template x-if="filtered().length === 0">
                    <div class="surface-card p-4 text-center text-sm text-zinc-500">
                        Kein Mitglied passt zu „<span x-text="query"></span>".
                    </div>
                </template>
            </div>
        </template>

        {{-- ── Admin-Modals (NIP-86) ─────────────────────────────────────────── --}}

        {{-- Rolle anlegen/bearbeiten (HSL via native range, §6) --}}
        <flux:modal name="role-form" class="max-w-sm">
            <div class="space-y-4">
                <flux:heading size="lg" x-text="roleForm.id ? 'Rolle bearbeiten' : 'Neue Rolle'"></flux:heading>

                <flux:input label="Bezeichnung" x-model="roleForm.label" placeholder="z.B. Vorstand" />
                <flux:textarea label="Beschreibung" x-model="roleForm.description" rows="2" placeholder="Optional" />

                <div>
                    <flux:text class="mb-1 text-sm font-medium">Farbe</flux:text>
                    <div class="flex items-center gap-3">
                        <flux:badge x-bind:style="`color:hsl(${roleForm.hue},70%,${roleForm.lightness*100}%);background-color:hsl(${roleForm.hue},70%,${roleForm.lightness*100}%,0.15)`">
                            <span x-text="roleForm.label || 'Vorschau'"></span>
                        </flux:badge>
                    </div>
                    <label class="mt-2 block text-xs text-zinc-500">Farbton</label>
                    <input type="range" min="0" max="360" step="1" x-model.number="roleForm.hue" class="w-full accent-brand-500" />
                    <label class="mt-1 block text-xs text-zinc-500">Helligkeit</label>
                    <input type="range" min="0.2" max="0.8" step="0.01" x-model.number="roleForm.lightness" class="w-full accent-brand-500" />
                </div>

                <div class="flex justify-end gap-2">
                    <flux:modal.close><flux:button variant="ghost">Abbrechen</flux:button></flux:modal.close>
                    <flux:button variant="primary" x-on:click="saveRole()" ::disabled="busy || !roleForm.label.trim()">Speichern</flux:button>
                </div>
            </div>
        </flux:modal>

        {{-- Rollen verwalten (Liste, bearbeiten/löschen) --}}
        <flux:modal name="roles-list" class="max-w-sm">
            <div class="space-y-4">
                <flux:heading size="lg">Rollen</flux:heading>
                <template x-if="rolesFull.length === 0">
                    <flux:text class="text-sm text-zinc-500">Noch keine Rollen definiert.</flux:text>
                </template>
                <div class="space-y-2">
                    <template x-for="role in rolesFull" :key="role.id">
                        <div class="surface-card flex items-center gap-2 p-2">
                            <flux:badge size="sm" x-bind:style="`color:hsl(${parseFloat(role.color.hue)||0},70%,${(parseFloat(role.color.lightness)||0.5)*100}%);background-color:hsl(${parseFloat(role.color.hue)||0},70%,${(parseFloat(role.color.lightness)||0.5)*100}%,0.15)`">
                                <span x-text="role.label || role.id"></span>
                            </flux:badge>
                            <span class="min-w-0 flex-1 truncate text-xs text-zinc-500" x-text="role.description"></span>
                            <flux:button size="xs" variant="ghost" icon="pencil-square" x-on:click="openRoleEdit(role)" aria-label="Bearbeiten" />
                            <flux:button size="xs" variant="ghost" icon="trash" x-on:click="removeRole(role.id)" ::disabled="busy" aria-label="Löschen" />
                        </div>
                    </template>
                </div>
                <flux:button variant="primary" icon="plus" class="w-full" x-on:click="openRoleCreate()">Neue Rolle</flux:button>
            </div>
        </flux:modal>

        {{-- Rollen eines Mitglieds zuweisen (Toggle je Rolle) --}}
        <flux:modal name="member-roles" class="max-w-sm">
            <div class="space-y-4" x-show="editingMember">
                <flux:heading size="lg">Rollen von <span x-text="editingMember?.name"></span></flux:heading>
                <template x-if="roles.length === 0">
                    <flux:text class="text-sm text-zinc-500">Erst eine Rolle anlegen.</flux:text>
                </template>
                <div class="space-y-1">
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
                <flux:heading size="lg">Einladen</flux:heading>
                <flux:text class="text-sm text-zinc-500">Teile diesen Link — er führt direkt in den Space.</flux:text>
                <template x-if="inviteBusy">
                    <div class="skeleton h-10 rounded-tile"></div>
                </template>
                <div x-show="!inviteBusy && inviteLink" x-cloak class="flex items-center gap-2">
                    <flux:input readonly x-model="inviteLink" class="flex-1 font-mono text-xs" />
                    <flux:button variant="primary" icon="clipboard" x-on:click="copyInvite()" aria-label="Kopieren" />
                </div>
            </div>
        </flux:modal>

        {{-- Gebannte Mitglieder --}}
        <flux:modal name="banned" class="max-w-sm">
            <div class="space-y-4">
                <flux:heading size="lg">Gebannt</flux:heading>
                <template x-if="banned.length === 0">
                    <flux:text class="text-sm text-zinc-500">Niemand gebannt.</flux:text>
                </template>
                <div class="space-y-2">
                    <template x-for="b in banned" :key="b.pubkey">
                        <div class="surface-card flex items-center gap-2 p-2">
                            <div class="min-w-0 flex-1">
                                <div class="truncate font-mono text-xs text-zinc-500" x-text="b.short"></div>
                                <div class="truncate text-xs text-zinc-500" x-text="b.reason"></div>
                            </div>
                            <flux:button size="xs" variant="ghost" x-on:click="unbanMember(b.pubkey)" ::disabled="busy">Entbannen</flux:button>
                            <flux:button size="xs" variant="primary" x-on:click="restoreMember(b.pubkey)" ::disabled="busy">Wiederaufnehmen</flux:button>
                        </div>
                    </template>
                </div>
            </div>
        </flux:modal>

    </div>

    <x-chat::bottom-nav />
</main>
