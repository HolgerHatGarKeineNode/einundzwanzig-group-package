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
