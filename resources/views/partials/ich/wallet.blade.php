{{-- Wallet. P2 links only; the balance itself arrives with P3 (it comes from
     `js/wallet.ts` and needs a mounted island, not a server value). --}}
<x-group::ich-row :href="route('group.bereich.wallet')" icon="bolt"
                  :label="__('Wallet')" :hint="__('Guthaben, senden und empfangen')" />
