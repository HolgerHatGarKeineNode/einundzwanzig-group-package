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
