<?php

use Livewire\Attributes\Layout;
use Livewire\Attributes\Title;
use Livewire\Component;

/**
 * Verschmolzener Einstellungen-Screen (App-Shell-Verschmelzung P5, §6): EIN Ort
 * für Konto/Identität, Space & Räume, Wallet-Einstieg, Darstellung und Abmelden.
 * Portal-agnostisch — der Web-Host zeigt genau diese Sektionen (kein Portal-Konto/
 * Meine-Inhalte/Sprache, §Umfang-Callout). Server-state-frei: die Logik sind die
 * Alpine/welshman-Inseln (nostrAuth · nostrSpaceSettings). Ersetzt die ad-hoc
 * `settings.space`-Seite als Web-Settings-Tab; `space.settings` bleibt additiv
 * bestehen (Mobile-Default), bis dessen eigener P5-Pass folgt.
 */
new #[Layout('group::einundzwanzig')] #[Title('Einstellungen')] class extends Component {}; ?>

<x-group::app-shell>

    <x-group::app-header title="{{ __('Einstellungen') }}">
        <x-slot:subtitle>
            <flux:text class="text-sm">{{ __('Konto, Space, Wallet und Darstellung an einem Ort.') }}</flux:text>
        </x-slot:subtitle>
    </x-group::app-header>

    {{-- EINE nostrAuth-Insel für die ganze Seite: Konto (npub/signerLabel) und
         Abmelden (doLogout) teilen denselben Sitzungs-Scope. Die zwischenliegende
         nostrSpaceSettings-Section bringt ihr eigenes `busy`/`ready` mit und
         shadowt korrekt (Alpine-Kind-Scope) — kein doppeltes Polling/Subscribe. --}}
    <div class="page-enter space-y-8" x-data="nostrAuth">

        {{-- ── Konto & Identität (§6.1): npub kopierbar + aktiver Signer + Neu verbinden. --}}
        <section aria-labelledby="settings-account">
            <flux:heading id="settings-account" level="2" size="sm" class="mb-2 text-muted">{{ __('Konto & Identität') }}</flux:heading>

            {{-- npub — kopierbarer Mono-Chip (wie profile-card); lokaler `copied`-State
                 gibt Feedback, npub kommt aus dem umschließenden nostrAuth-Scope. --}}
            <div class="surface-card p-3">
                <flux:text class="text-xs text-muted">{{ __('Öffentlicher Schlüssel') }}</flux:text>
                <button type="button" x-data="{ copied: false }" x-show="npub" x-cloak
                        x-on:click="navigator.clipboard.writeText(npub); copied = true; setTimeout(() => copied = false, 1500)"
                        :aria-label="copied ? @js(__('npub kopiert')) : @js(__('npub kopieren'))"
                        class="pressable group mt-1 flex w-full min-w-0 items-center gap-1.5 rounded-tile bg-brand-500/10 px-2.5 py-1.5 font-mono text-xs text-brand-600 dark:text-brand-400">
                    <span class="min-w-0 flex-1 truncate text-start" x-text="npub"></span>
                    <flux:icon.check x-show="copied" class="size-3.5 shrink-0" />
                    <flux:icon.clipboard-document x-show="!copied" class="size-3.5 shrink-0 opacity-60 transition-opacity group-hover:opacity-100" />
                </button>
            </div>

            {{-- Signer & Sitzung — Typ (welshman-`method`) + „Neu verbinden" (Perms neu
                 aufsetzen, gleicher Pfad wie der Reconnect-Nudge: /nostr-login?reconnect=1). --}}
            <div class="surface-card mt-2 flex items-center justify-between gap-3 p-3">
                <div class="min-w-0">
                    <flux:text class="text-sm font-medium">{{ __('Signer & Sitzung') }}</flux:text>
                    <div class="truncate text-xs text-muted" x-text="signerLabel"></div>
                </div>
                <flux:button size="sm" variant="ghost" icon="arrow-path"
                             :href="route('group.nostr-login', ['reconnect' => 1])" wire:navigate>
                    {{ __('Neu verbinden') }}
                </flux:button>
            </div>
        </section>

        {{-- ── Space & Räume (§6.5): der EINZIGE Ort zum Space-Wechsel (Single-Space). --}}
        <section x-data="nostrSpaceSettings" aria-labelledby="settings-space">
            <flux:heading id="settings-space" level="2" size="sm" class="mb-2 text-muted">{{ __('Space & Räume') }}</flux:heading>
            <flux:text class="mb-2 text-xs text-muted">{{ __('Die App zeigt immer genau diesen Space.') }}</flux:text>

            {{-- Lädt noch (Fix A): Skeleton statt „leer"-Flash vor der ersten Emission. --}}
            <template x-if="!ready">
                <div class="space-y-2" aria-busy="true">
                    <span class="sr-only" aria-live="polite">{{ __('Spaces werden geladen…') }}</span>
                    <template x-for="i in 3" :key="i">
                        <div class="surface-card flex items-center gap-3 p-3">
                            <div class="skeleton size-5"></div>
                            <div class="skeleton h-4 w-40"></div>
                        </div>
                    </template>
                </div>
            </template>

            <template x-if="ready && spaces.length === 0">
                <div class="surface-card empty-state p-6 text-center">
                    <flux:icon.inbox class="mx-auto size-8 text-zinc-400" />
                    <flux:text class="mt-2">{{ __('Du bist noch keinem Space beigetreten.') }}</flux:text>
                    <flux:button :href="route('home')" wire:navigate variant="primary" icon="home" class="mt-4">
                        {{ __('Zur Startseite') }}
                    </flux:button>
                </div>
            </template>

            <flux:navlist x-show="ready && spaces.length > 0">
                <template x-for="s in spaces" :key="s.url">
                    {{-- Aktiver Space nicht nur farbig/Haken (aria-hidden) markieren:
                         ::aria-current + sr-only-„aktiv" macht die Auswahl für
                         Screenreader hörbar (einziger Space-Wechsel-Ort, §Single-Space). --}}
                    <flux:navlist.item icon="server" x-on:click="choose(s.url)"
                                       ::aria-current="s.url === active ? 'true' : 'false'">
                        <span class="flex w-full items-center gap-2">
                            <span class="min-w-0 flex-1">
                                <span class="block truncate" x-text="s.label"></span>
                                <span class="block truncate font-mono text-[0.7rem] text-muted" x-text="s.url.replace(/\/$/, '')"></span>
                            </span>
                            <span class="sr-only" x-show="s.url === active">{{ __('aktiv') }}</span>
                            <flux:icon.check x-show="s.url === active" class="size-4 shrink-0 text-brand-500" />
                        </span>
                    </flux:navlist.item>
                </template>
            </flux:navlist>

            {{-- Mitgliedschaft im aktiven Space (Space-Ebene, kind 28934/28936) --}}
            <div class="surface-card mt-2 flex items-center justify-between gap-3 p-3">
                <div class="min-w-0">
                    <flux:text class="text-sm font-medium">{{ __('Mitgliedschaft') }}</flux:text>
                    <div class="truncate text-xs text-muted"
                         x-text="activeJoined ? @js(__('Du bist Mitglied dieses Space.')) : (activeIsVerein ? @js(__('Zugang über Vereinsmitgliedschaft.')) : @js(__('Noch nicht beigetreten.')))"></div>
                </div>
                <flux:button size="sm" variant="primary" icon="plus"
                             x-show="!activeJoined && !activeIsVerein" x-cloak x-on:click="joinActive()" ::disabled="busy">{{ __('Beitreten') }}</flux:button>
            </div>
        </section>

        {{-- ── Wallet (§6.3): Einstieg zur Lightning-Wallet (Betrieb bleibt eigener Tab). --}}
        <section aria-labelledby="settings-wallet">
            <flux:heading id="settings-wallet" level="2" size="sm" class="mb-2 text-muted">{{ __('Wallet') }}</flux:heading>
            <a href="{{ route('group.wallet') }}" wire:navigate
               class="surface-card pressable flex items-center justify-between gap-3 p-3">
                <span class="flex items-center gap-3">
                    <span class="flex size-9 items-center justify-center rounded-tile bg-brand-500/10">
                        <flux:icon.bolt variant="solid" class="size-5 text-brand-500" />
                    </span>
                    <span class="min-w-0">
                        <flux:text class="text-sm font-medium">{{ __('Wallet öffnen') }}</flux:text>
                        <span class="block truncate text-xs text-muted">{{ __('Lightning — Guthaben, senden & empfangen') }}</span>
                    </span>
                </span>
                <flux:icon.chevron-right class="size-4 shrink-0 text-muted" />
            </a>
        </section>

        {{-- ── Netzwerk & Relays (§6.4, read-only): NIP-65-Relayliste (kind 10002).
             Nur wo der Host es einblendet (config('group.show_relays')) — der
             Web-Client lässt es aus, der Mobile-Host schaltet es an. Editor folgt. --}}
        @if (config('group.show_relays', false))
            <section x-data="nostrRelays" aria-labelledby="settings-relays">
                <flux:heading id="settings-relays" level="2" size="sm" class="mb-2 text-muted">{{ __('Netzwerk & Relays') }}</flux:heading>
                <flux:text class="mb-2 text-xs text-muted">{{ __('Deine Relays (NIP-65).') }}</flux:text>

                <template x-if="loading">
                    <div class="surface-card space-y-2 p-3" aria-busy="true">
                        <span class="sr-only" aria-live="polite">{{ __('Relays werden geladen…') }}</span>
                        <div class="skeleton h-4 w-48"></div>
                        <div class="skeleton h-4 w-40"></div>
                    </div>
                </template>

                <template x-if="!loading && relays.length === 0">
                    <div class="surface-card p-3">
                        <flux:text class="text-sm text-muted">{{ __('Keine Relay-Liste veröffentlicht.') }}</flux:text>
                    </div>
                </template>

                <div class="surface-card divide-y divide-zinc-100 dark:divide-zinc-800" role="list"
                     x-show="!loading && relays.length > 0" x-cloak>
                    <template x-for="r in relays" :key="r.url">
                        <div class="flex items-center gap-2 p-3" role="listitem">
                            <flux:icon.server class="size-4 shrink-0 text-muted" />
                            <span class="min-w-0 flex-1 truncate font-mono text-xs" x-text="r.url.replace(/\/$/, '')"></span>
                            <span class="shrink-0 text-[0.7rem] text-muted"
                                  x-text="[r.read ? @js(__('Lesen')) : null, r.write ? @js(__('Schreiben')) : null].filter(Boolean).join(' · ')"></span>
                        </div>
                    </template>
                </div>
            </section>
        @endif

        {{-- ── Medien-Upload (Blossom, C6a): welcher Blossom-Server wird für Bild-Uploads
             genutzt? Aus dem Profil (kind 10063) oder der Standard. Read-only Anzeige zum
             Selbst-Debuggen der Server-Auflösung. --}}
        <section x-data="nostrBlossom" aria-labelledby="settings-blossom">
            <flux:heading id="settings-blossom" level="2" size="sm" class="mb-2 text-muted">{{ __('Medien-Upload (Blossom)') }}</flux:heading>
            <flux:text class="mb-2 text-xs text-muted">{{ __('Server für hochgeladene Bilder (aus deinem Profil, kind 10063).') }}</flux:text>

            <template x-if="loading">
                <div class="surface-card space-y-2 p-3" aria-busy="true">
                    <span class="sr-only" aria-live="polite">{{ __('Blossom-Server werden geladen…') }}</span>
                    <div class="skeleton h-4 w-48"></div>
                </div>
            </template>

            <div x-show="!loading" x-cloak class="space-y-2">
                {{-- Aktiver Server + Herkunft (Profil vs. Standard). --}}
                <div class="surface-card flex items-center justify-between gap-3 p-3">
                    <div class="min-w-0">
                        <flux:text class="text-sm font-medium">{{ __('Aktiver Server') }}</flux:text>
                        <div class="truncate font-mono text-xs text-brand-600 dark:text-brand-400" x-text="active"></div>
                    </div>
                    {{-- Plain-Span (flux:badge-Farbe ist Blade-Compile-Zeit, nicht reaktiv). --}}
                    <span class="shrink-0 rounded-full px-2 py-0.5 text-xs font-medium"
                          :class="isDefault ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400' : 'bg-green-500/15 text-green-600 dark:text-green-400'"
                          x-text="isDefault ? @js(__('Standard')) : @js(__('aus Profil'))"></span>
                </div>

                {{-- Hinweis, wenn kein eigener Server gefunden wurde (Debug-Hilfe). --}}
                <template x-if="isDefault">
                    <flux:text class="px-1 text-xs text-muted">
                        {{ __('Kein eigener Blossom-Server im Profil gefunden — es wird der Standard verwendet:') }}
                        <span class="font-mono" x-text="defaultServer"></span>
                    </flux:text>
                </template>

                {{-- Volle Liste (falls mehrere), erster = aktiv. --}}
                <template x-if="servers.length > 1">
                    <div class="surface-card divide-y divide-zinc-100 dark:divide-zinc-800" role="list">
                        <template x-for="(s, i) in servers" :key="s">
                            <div class="flex items-center gap-2 p-3" role="listitem">
                                <flux:icon.server class="size-4 shrink-0 text-muted" />
                                <span class="min-w-0 flex-1 truncate font-mono text-xs" x-text="s"></span>
                                <span class="shrink-0 text-[0.7rem] text-brand-500" x-show="i === 0">{{ __('aktiv') }}</span>
                            </div>
                        </template>
                    </div>
                </template>
            </div>
        </section>

        {{-- ── Darstellung (§6.6): Theme = der EINE Regler ($flux.appearance-Store,
             flackerfrei im <head>; nie hart class="dark"). --}}
        <section aria-labelledby="settings-appearance">
            <flux:heading id="settings-appearance" level="2" size="sm" class="mb-2 text-muted">{{ __('Darstellung') }}</flux:heading>
            <div class="surface-card flex items-center justify-between gap-3 p-3">
                <flux:text class="text-sm font-medium">{{ __('Theme') }}</flux:text>
                <flux:radio.group x-data variant="segmented" size="sm" x-model="$flux.appearance" aria-label="{{ __('Theme') }}">
                    <flux:radio value="light" icon="sun" aria-label="{{ __('Hell') }}" />
                    <flux:radio value="system" icon="computer-desktop" aria-label="{{ __('Automatisch') }}" />
                    <flux:radio value="dark" icon="moon" aria-label="{{ __('Dunkel') }}" />
                </flux:radio.group>
            </div>
        </section>

        {{-- ── Abmelden (§5.4/§6.10): EIN Ort, ganz unten, destruktiv. doLogout()
             räumt welshman-Session + localStorage['pubkey'] ab und leitet aus. --}}
        <section aria-labelledby="settings-logout">
            <flux:heading id="settings-logout" level="2" size="sm" class="mb-2 text-muted">{{ __('Sitzung') }}</flux:heading>
            <flux:button variant="ghost" icon="arrow-right-start-on-rectangle"
                         class="w-full justify-start text-red-600 dark:text-red-400"
                         x-on:click="doLogout()" ::disabled="busy">
                {{ __('Abmelden') }}
            </flux:button>
            <flux:text class="mt-1 px-1 text-xs text-muted">{{ __('Dein Schlüssel bleibt in deinem Signer (Amber/Bunker/Erweiterung).') }}</flux:text>
        </section>

    </div>

</x-group::app-shell>
