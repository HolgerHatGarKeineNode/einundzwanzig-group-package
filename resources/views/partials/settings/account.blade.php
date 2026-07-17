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
