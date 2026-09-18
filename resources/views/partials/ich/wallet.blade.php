{{-- Wallet (D8): the balance stands in the row, the way in is the row itself.

     The number comes from `js/wallet.ts` through the small island `nostrWalletGuthaben` —
     NOT from `nostrWallet`, whose `init()` subscribes to the profile, resolves NIP-05
     against a foreign domain and holds a timer, all for a screen this row only links to
     (derivation at the island in `bridge.ts`).

     Three states, and the middle one is the reason this is not a one-liner:
       · loading   — a skeleton in the place of the number, so the row does not jump
       · connected — the amount, or just „verbunden" when the wallet type has no balance
                     command (WebLN); an invented 0 would be the worse answer
       · no wallet — the hint that stood here before P3

     The row itself is `x-group::ich-row` like its neighbours, so a host-injected row cannot
     look different from a package one; the balance rides in its slot. --}}
<div x-data="nostrWalletGuthaben">
    <x-group::ich-row :href="route('group.bereich.wallet')" icon="bolt" :label="__('Wallet')"
                      :hint="__('Guthaben, senden und empfangen')">
        <x-slot:trailing>
            <span class="flex shrink-0 items-center gap-2" data-wallet-guthaben>
                <span x-show="loading" class="skeleton h-3 w-16"></span>
                <span x-show="!loading && connected && balanceSats !== null" x-cloak
                      class="text-sm font-semibold tabular-nums text-zinc-900 dark:text-zinc-100"
                      data-wallet-betrag
                      x-text="new Intl.NumberFormat(document.documentElement.lang || 'de').format(balanceSats) + ' sats'"></span>
                <span x-show="!loading && connected && balanceSats === null" x-cloak
                      class="text-xs text-muted">{{ __('verbunden') }}</span>
                <span x-show="!loading && !connected" x-cloak
                      class="text-xs text-muted">{{ __('nicht verbunden') }}</span>
            </span>
        </x-slot:trailing>
    </x-group::ich-row>
</div>
