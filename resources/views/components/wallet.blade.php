{{-- ZAPS.md Z0.4 — vollwertige Lightning-Wallet-Insel: Verbinden (NWC/WebLN),
     Hero-Balance, Senden (bolt11 oder lud16) und Empfangen (Rechnung + QR).
     AAA-Design (Brand-Ramp #f7931a, surface-card/rounded-tile/pressable). Der
     Secret liegt gehärtet in secure-storage (nie Klartext), Zahlung 100 % im
     Browser. Alpine-Insel `nostrWallet` (js/bridge.ts). Flux-Alpine-Bind IMMER
     `::attr` (doppelter Doppelpunkt) — einfaches `:attr` würde PHP-evaluiert. --}}
<div x-data="nostrWallet" class="space-y-5">
    {{-- Feature-Flag aus (z. B. iOS-Build): Lightning hart deaktiviert. --}}
    <div x-show="!zapsEnabled" x-cloak
         class="surface-card rounded-card p-5 text-sm text-muted">
        {{ __('Lightning-Funktionen sind in dieser App-Version deaktiviert.') }}
    </div>

    <div x-show="zapsEnabled" class="space-y-5">
        {{-- ============ NICHT VERBUNDEN: Verbinden-Karte ============ --}}
        <div x-show="!connected" x-cloak
             class="surface-card rounded-card overflow-hidden p-6">
            <div class="mb-4 flex items-center gap-3">
                <span class="flex size-11 items-center justify-center rounded-tile bg-brand-500/10">
                    <flux:icon.bolt variant="solid" class="size-6 text-brand-500" />
                </span>
                <div>
                    <flux:heading size="lg">{{ __('Wallet verbinden') }}</flux:heading>
                    {{-- Ehrlich getrennt: Native = Geräte-Keystore (Keychain/Keystore),
                         Web = verschlüsselt im Browser (WebCrypto at-rest). Nie am Server. --}}
                    <flux:subheading>
                        {{ config('nativephp-internal.running')
                            ? __('Nostr Wallet Connect (NWC) — dein Secret bleibt sicher im Geräte-Keystore.')
                            : __('Nostr Wallet Connect (NWC) — dein Secret bleibt verschlüsselt in diesem Browser, nie auf dem Server.') }}
                    </flux:subheading>
                </div>
            </div>

            <flux:input type="password" x-model="connectUrl"
                        :label="__('Verbindungs-Secret')"
                        placeholder="nostr+walletconnect://…"
                        autocomplete="off" />

            <div class="mt-4 flex flex-wrap items-center gap-2">
                <flux:button variant="primary" icon="bolt" x-on:click="connectNwc()" ::disabled="busy">
                    {{ __('Verbinden') }}
                </flux:button>
                <flux:button x-show="weblnAvailable" x-cloak variant="ghost"
                             x-on:click="connectWebln()" ::disabled="busy">
                    {{ __('Browser-Wallet (WebLN)') }}
                </flux:button>
            </div>

            <p class="mt-3 text-xs text-muted">
                {{ __('Den NWC-String bekommst du in deiner Wallet-App (z. B. Alby Hub) unter „Verbindungen“.') }}
            </p>
        </div>

        {{-- ============ VERBUNDEN: Hero-Balance ============ --}}
        <div x-show="connected" x-cloak class="space-y-4 page-enter">
            {{-- Hero-Balance-Karte: Guthaben groß, Brand-Glow. --}}
            <div class="relative overflow-hidden rounded-card bg-gradient-to-br from-brand-500/15 via-brand-500/5 to-transparent p-6 shadow-card ring-1 ring-brand-500/20">
                <div class="flex items-start justify-between">
                    <div class="flex items-center gap-2 text-sm font-medium text-brand-600 dark:text-brand-400">
                        <flux:icon.bolt variant="solid" class="size-4" />
                        <span>{{ __('Guthaben') }}</span>
                    </div>
                    <flux:button size="xs" variant="ghost" icon="arrow-path"
                                 x-on:click="refreshBalance()"
                                 :aria-label="__('Guthaben aktualisieren')" />
                </div>

                <div class="mt-2 flex items-baseline gap-2">
                    <span class="text-4xl font-bold tabular-nums tracking-tight"
                          x-text="balanceSats === null ? '—' : balanceSats.toLocaleString('de-DE')"></span>
                    <span class="text-lg font-medium text-muted">{{ __('Sats') }}</span>
                </div>

                <div class="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted">
                    <span class="inline-flex items-center gap-1 rounded-tile bg-white/50 px-2 py-1 dark:bg-zinc-900/50"
                          x-text="walletType === 'nwc' ? 'NWC' : 'WebLN'"></span>
                    <span x-show="relayUrl" x-cloak class="inline-flex items-center gap-1 truncate font-mono"
                          x-text="displayRelay()"></span>
                </div>

                {{-- lud16-Empfangsadresse (kopierbar). --}}
                <button type="button" x-show="lud16" x-cloak
                        x-on:click="copy(lud16, 'Lightning-Adresse')"
                        :aria-label="__('Lightning-Adresse kopieren')"
                        class="pressable mt-3 flex w-full min-w-0 items-center gap-2 rounded-tile border border-brand-500/30 bg-brand-500/5 px-3 py-2">
                    <flux:icon.bolt variant="solid" class="size-4 shrink-0 text-brand-500" />
                    <span class="min-w-0 truncate font-mono text-xs" x-text="lud16"></span>
                    <flux:icon.clipboard-document class="ml-auto size-3.5 shrink-0 opacity-50" />
                </button>
            </div>

            {{-- Primär-Aktionen: Senden / Empfangen als große Tiles. --}}
            <div class="grid grid-cols-2 gap-3">
                <button type="button" x-on:click="openSend()"
                        class="pressable flex flex-col items-center gap-2 rounded-tile border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
                    <span class="flex size-10 items-center justify-center rounded-full bg-brand-500/10">
                        <flux:icon.arrow-up-right class="size-5 text-brand-500" />
                    </span>
                    <span class="text-sm font-medium">{{ __('Senden') }}</span>
                </button>
                <button type="button" x-on:click="openReceive()"
                        class="pressable flex flex-col items-center gap-2 rounded-tile border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
                    <span class="flex size-10 items-center justify-center rounded-full bg-brand-500/10">
                        <flux:icon.arrow-down-left class="size-5 text-brand-500" />
                    </span>
                    <span class="text-sm font-medium">{{ __('Empfangen') }}</span>
                </button>
            </div>

            <div class="flex justify-end">
                <flux:button size="sm" variant="ghost" icon="link-slash" x-on:click="disconnect()">
                    {{ __('Trennen') }}
                </flux:button>
            </div>
        </div>

        {{-- Fehleranzeige (deutsch). --}}
        <div x-show="error" x-cloak
             class="rounded-tile border border-red-500/30 bg-red-500/5 px-3 py-2 text-sm text-red-600 dark:text-red-400"
             x-text="error"></div>
    </div>

    {{-- ============ Senden-Modal ============ --}}
    <flux:modal name="wallet-send" class="max-w-sm">
        <div class="space-y-4">
            <flux:heading size="lg">{{ __('Senden') }}</flux:heading>
            <flux:input x-model="payReq"
                        :label="__('Rechnung oder Lightning-Adresse')"
                        placeholder="lnbc… / name@domain" autocomplete="off" />
            <flux:input type="number" min="1" x-model.number="payAmountSats"
                        :label="__('Betrag (Sats)')"
                        :description="__('Nur bei Lightning-Adresse oder betragsloser Rechnung nötig.')" />
            <div class="flex justify-end gap-2">
                <flux:modal.close><flux:button variant="ghost">{{ __('Abbrechen') }}</flux:button></flux:modal.close>
                <flux:button variant="primary" icon="bolt" x-on:click="sendPayment()" ::disabled="paying">
                    {{ __('Zahlen') }}
                </flux:button>
            </div>
        </div>
    </flux:modal>

    {{-- ============ Empfangen-Modal ============ --}}
    <flux:modal name="wallet-receive" class="max-w-sm">
        <div class="space-y-4">
            <flux:heading size="lg">{{ __('Empfangen') }}</flux:heading>

            {{-- Eingabe (noch keine Rechnung). --}}
            <div x-show="!recvInvoice" class="space-y-4">
                <flux:input type="number" min="1" x-model.number="recvAmountSats"
                            :label="__('Betrag (Sats)')" placeholder="21" />
                <flux:input x-model="recvMemo" :label="__('Verwendungszweck (optional)')"
                            placeholder="{{ __('Wofür?') }}" />
                <div class="flex justify-end gap-2">
                    <flux:modal.close><flux:button variant="ghost">{{ __('Abbrechen') }}</flux:button></flux:modal.close>
                    <flux:button variant="primary" x-on:click="createReceiveInvoice()" ::disabled="receiving">
                        {{ __('Rechnung erstellen') }}
                    </flux:button>
                </div>
            </div>

            {{-- Ergebnis: QR + kopierbare bolt11. --}}
            <div x-show="recvInvoice" x-cloak class="space-y-3">
                <div class="flex justify-center">
                    <img :src="recvQr" :alt="__('QR-Code der Rechnung')"
                         class="size-56 rounded-tile bg-white p-2" />
                </div>
                <button type="button" x-on:click="copy(recvInvoice, 'Rechnung')"
                        :aria-label="__('Rechnung kopieren')"
                        class="pressable flex w-full min-w-0 items-center gap-2 rounded-tile border border-zinc-200 px-3 py-2 dark:border-zinc-800">
                    <span class="min-w-0 truncate font-mono text-xs" x-text="recvInvoice"></span>
                    <flux:icon.clipboard-document class="ml-auto size-3.5 shrink-0 opacity-50" />
                </button>
                <div class="flex justify-end gap-2">
                    <flux:button variant="ghost" x-on:click="openReceive()">{{ __('Neue Rechnung') }}</flux:button>
                    <flux:modal.close><flux:button variant="primary">{{ __('Fertig') }}</flux:button></flux:modal.close>
                </div>
            </div>
        </div>
    </flux:modal>
</div>
