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
