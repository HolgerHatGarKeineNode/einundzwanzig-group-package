{{-- Autor-Profil-Karte (PLAN4 B3) als Identitätskarte: Banner-Header, überlappender
     Ring-Avatar (Brand-Glow), kopierbare Mono-Chips für npub/Lightning. Eigene
     Alpine-Insel, geöffnet per `open-profile`-Window-Event ($dispatch aus Chat/
     Directory mit der pubkey). Daten reaktiv aus welshman (deriveProfile +
     verifizierter NIP-05-Handle, lazy). Einmal pro Seite einbinden. --}}
<div x-data="nostrProfileCard" x-on:open-profile.window="open($event.detail)">
    <flux:modal name="profile-card" class="max-w-sm overflow-hidden">
        {{-- Flux-Modal-Padding (p-6) aufheben, damit der Banner randlos blutet. --}}
        <div class="-m-6">
            {{-- Banner-Header. Ohne Banner: Brand-Verlauf statt leerer Fläche. --}}
            <div class="relative h-28 bg-gradient-to-br from-brand-500/30 via-brand-500/10 to-transparent">
                <template x-if="banner">
                    <img :src="$img(banner, 'full')" alt="" class="absolute inset-0 size-full object-cover" />
                </template>
                {{-- Scrim Banner → Kartengrund, damit der Avatar sauber aufsitzt. --}}
                <div class="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-white to-transparent dark:from-zinc-900"></div>
            </div>

            <div class="px-6 pb-6">
                {{-- Avatar überlappt den Banner-Rand; der Ring stanzt ihn frei (Brand-Glow). --}}
                <div class="-mt-12 mb-3">
                    <div class="inline-block rounded-full ring-4 ring-white dark:ring-zinc-900" style="box-shadow: var(--shadow-glow)">
                        <x-group::nostr-avatar picture="picture" name="name" size="5rem" />
                    </div>
                </div>

                <div class="flex items-center gap-1.5">
                    <flux:heading size="xl" class="min-w-0 break-words" x-text="name"></flux:heading>
                    <x-group::nostr-nip05 nip05="nip05" />
                </div>

                {{-- Verifizierter NIP-05-Handle (nur bei bestätigtem Match, PLAN4 B4). --}}
                <div x-show="nip05" x-cloak class="mt-0.5 truncate text-sm text-muted" x-text="nip05"></div>

                {{-- npub — kopierbarer Mono-Chip (npub ist ein Wert zum Kopieren). --}}
                <button type="button" x-on:click="copy(npub, 'npub')" aria-label="{{ __('npub kopieren') }}"
                        class="pressable group mt-1.5 inline-flex max-w-full items-center gap-1.5 rounded-tile bg-brand-500/10 px-2.5 py-1 font-mono text-xs text-brand-800 dark:text-brand-400">
                    <span class="min-w-0 truncate" x-text="npub"></span>
                    <flux:icon.clipboard-document class="size-3.5 shrink-0 opacity-60 transition-opacity group-hover:opacity-100" />
                </button>

                {{-- Bio --}}
                <flux:text x-show="about" x-cloak class="mt-3 whitespace-pre-wrap break-words text-sm" x-text="about"></flux:text>

                {{-- Website — eigene volle Zeile, lange URLs truncaten statt auszulaufen. --}}
                <a x-show="website" x-cloak :href="website" target="_blank" rel="noopener noreferrer"
                   class="pressable mt-3 flex min-w-0 items-center gap-2 rounded-tile border border-zinc-200 px-3 py-2 text-sm text-brand-800 hover:bg-brand-500/5 dark:border-zinc-800 dark:text-brand-400">
                    <flux:icon.globe-alt class="size-4 shrink-0" />
                    <span class="min-w-0 truncate" x-text="website"></span>
                    <flux:icon.arrow-up-right class="ml-auto size-3.5 shrink-0 opacity-50" />
                </a>

                {{-- Lightning — kopierbarer ⚡-Chip. Reine Anzeige, KEINE Zaps (PLAN §1). --}}
                <button type="button" x-show="lud16" x-cloak x-on:click="copy(lud16, @js(__('Lightning-Adresse')))"
                        aria-label="{{ __('Lightning-Adresse kopieren') }}"
                        class="pressable mt-2 flex w-full min-w-0 items-center gap-2 rounded-tile border border-brand-500/30 bg-brand-500/5 px-3 py-2">
                    <flux:icon.bolt variant="solid" class="size-4 shrink-0 text-brand-500" />
                    <span class="min-w-0 truncate font-mono text-xs" x-text="lud16"></span>
                    <flux:icon.clipboard-document class="ml-auto size-3.5 shrink-0 opacity-50" />
                </button>
            </div>
        </div>
    </flux:modal>
</div>
