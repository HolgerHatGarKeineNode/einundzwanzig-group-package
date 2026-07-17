{{-- ── Medien-Upload (Blossom): fixer Vereins-Server (alle Nutzer sind Mitglieder),
     keine Profil-Auflösung (kind 10063). Read-only Anzeige. --}}
<section aria-labelledby="settings-blossom">
    <flux:heading id="settings-blossom" level="2" size="sm" class="mb-2 text-muted">{{ __('Medien-Upload (Blossom)') }}</flux:heading>
    <flux:text class="mb-2 text-xs text-muted">{{ __('Server für hochgeladene Bilder.') }}</flux:text>

    <div class="surface-card flex items-center justify-between gap-3 p-3">
        <div class="min-w-0">
            <flux:text class="text-sm font-medium">{{ __('Aktiver Server') }}</flux:text>
            <div class="truncate font-mono text-xs text-brand-600 dark:text-brand-400">blossom.einundzwanzig.space</div>
        </div>
        <flux:badge color="green" size="sm">{{ __('Vereins-Server') }}</flux:badge>
    </div>
</section>
