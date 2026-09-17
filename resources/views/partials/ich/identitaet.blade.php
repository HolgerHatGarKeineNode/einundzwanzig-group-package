{{-- Identity — who am I, and what am I signed in with.

     No `x-data` of its own: the page wraps all sections in ONE `nostrAuth` island, exactly
     like the settings hub. A second scope here would be a second poll for the same kind 0.

     For a GUEST the invitation stands here instead of an empty avatar. The decision is made
     client-side (`$store.authGate.authed`), because the app knows its login only from
     `localStorage` — the same rule as on Start. --}}
<div class="surface-card overflow-hidden">
    <template x-if="$store.authGate?.authed">
        <div class="flex items-start gap-3 p-4">
            <x-group::nostr-avatar picture="myPicture" name="myName" size="3rem"
                                   presence="$store.presence?.mine" />
            <div class="min-w-0 flex-1">
                <div class="flex min-w-0 items-center gap-1">
                    <span class="min-w-0 truncate text-base font-semibold text-zinc-900 dark:text-zinc-100" x-text="myName"></span>
                    <x-group::nostr-nip05 nip05="myNip05" />
                </div>
                {{-- npub: one-click copy, as in the old profile popover — the same
                     `copy()` path, so there is exactly one truth about "copied". --}}
                <button type="button" x-on:click="copy(npub, @js(__('npub kopiert.')))" aria-label="{{ __('npub kopieren') }}"
                        class="pressable mt-1 flex w-full items-start gap-2 rounded-tile text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
                    <span class="min-w-0 flex-1 break-all text-[0.7rem] leading-relaxed text-muted" x-text="npub"></span>
                    <flux:icon.clipboard variant="micro" class="mt-0.5 size-3.5 shrink-0 text-muted" />
                </button>
                <div x-show="signerLabel" x-cloak class="mt-1.5 inline-flex items-center gap-1 rounded-full bg-brand-500/10 px-2 py-0.5 text-[0.7rem] font-medium text-brand-800 dark:text-brand-400">
                    <flux:icon.key variant="micro" class="size-3 shrink-0" />
                    <span x-text="@js(__('Angemeldet über :signer')).split(':signer').join(signerLabel)"></span>
                </div>
            </div>
        </div>
    </template>

    <template x-if="!$store.authGate?.authed">
        <div class="p-4">
            <flux:heading size="lg">{{ __('Noch nicht angemeldet') }}</flux:heading>
            <flux:text class="mt-1 text-sm text-muted">{{ __('Mit deinem Nostr-Schlüssel gehören dir Postfach, Lesezeichen und Wallet.') }}</flux:text>
            <div class="mt-3">
                <flux:button size="sm" variant="primary" icon="key" data-ich-anmelden
                             x-on:click="$store.authGate.requireAuth({ label: @js(__('Ich')), returnUrl: '/ich' })">
                    {{ __('Anmelden') }}
                </flux:button>
            </div>
        </div>
    </template>
</div>
