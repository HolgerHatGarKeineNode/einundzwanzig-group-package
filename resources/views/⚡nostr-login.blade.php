<?php

use Livewire\Attributes\Layout;
use Livewire\Attributes\Title;
use Livewire\Component;

/** Nostr-Login (öffentlich) als Livewire-SFC. Signer + Session leben im Browser. */
new #[Layout('chat::einundzwanzig')] #[Title('Anmelden')] class extends Component
{
    /**
     * Öffnet Amber (oder einen anderen nostrconnect-Handler) per nativem
     * ACTION_VIEW-Intent. Nötig, weil die WebView Custom-Schemes
     * (nostrconnect://) NICHT selbst an externe Apps weiterreicht — ein
     * `<a href>` verpufft dort. Nur auf dem Gerät; im Web-/Test-Kontext ohne
     * NativePHP-Extension ein No-op (der Button ist dort ohnehin aus). Das
     * mobile-browser-Plugin bringt der Host (Portal) mit.
     */
    public function openAmber(string $uri): void
    {
        // Fire-and-forget: KEIN Re-Render. Sonst morpht Livewire das DOM auf den
        // Server-Stand zurück und verwirft den reinen Alpine-Client-State
        // (connecting/connectUri) — genau das schluckte den ersten Klick, sodass
        // Amber erst beim zweiten öffnete.
        $this->skipRender();

        if (function_exists('nativephp_call') && str_starts_with($uri, 'nostrconnect://')) {
            \Native\Mobile\Facades\Browser::open($uri);
        }
    }
}; ?>

<main class="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-10 pt-safe">
    <div x-data="nostrAuth" class="page-enter">

        {{-- Eingeloggt --}}
        <template x-if="pubkey">
            <div class="surface-card empty-state p-6 text-center">
                <flux:icon.check-badge variant="solid" class="mx-auto size-10 text-brand-500" />
                <flux:heading size="lg" class="mt-3">Angemeldet</flux:heading>
                <div class="mt-2 rounded-tile bg-zinc-100 p-2 font-mono text-xs break-all text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400" x-text="npub"></div>
                <flux:button variant="ghost" class="mt-4" x-on:click="doLogout()">Abmelden</flux:button>
            </div>
        </template>

        {{-- Ausgeloggt: Login-Optionen --}}
        <template x-if="!pubkey">
            <div class="surface-card p-6">
                <flux:heading size="xl" class="flex items-center gap-2">
                    <flux:icon.bolt variant="solid" class="size-6 text-brand-500" />
                    Anmelden
                </flux:heading>
                <flux:text class="mt-1 mb-5">Melde dich mit deinem Nostr-Signer an — per Browser-Erweiterung, Amber oder Bunker.</flux:text>

                {{-- NIP-07 (nur wenn Extension vorhanden) --}}
                <flux:button x-show="hasExtension" variant="primary" class="w-full" x-on:click="loginExtension()" ::disabled="busy">
                    Mit Browser-Erweiterung (NIP-07)
                </flux:button>

                {{-- Signer-Methode: Flux managed die Tab-Auswahl --}}
                <flux:tab.group class="mt-4">
                    <flux:tabs variant="segmented" class="w-full">
                        <flux:tab name="nsec" icon="key">Schlüssel</flux:tab>
                        <flux:tab name="bunker" icon="link">Bunker</flux:tab>
                        <flux:tab name="amber" icon="qr-code" x-on:click="stopConnect()">Amber</flux:tab>
                    </flux:tabs>

                    <flux:tab.panel name="nsec" class="mt-3 space-y-2">
                        <flux:callout variant="warning" icon="exclamation-triangle">
                            <flux:callout.heading>Experimentell &amp; unsicher — nur für Tests</flux:callout.heading>
                            <flux:callout.text>Dein privater Schlüssel wird im Browser gespeichert und ist dort angreifbar. Für echte Konten nutze eine Browser-Erweiterung, Amber oder einen Bunker.</flux:callout.text>
                        </flux:callout>
                        <flux:input type="password" x-model="keyInput" placeholder="nsec1… oder 64-stelliger hex-Key" x-on:keydown.enter="loginNsec()" />
                        <flux:button variant="danger" class="w-full" x-on:click="loginNsec()" ::disabled="busy">Trotzdem anmelden (unsicher)</flux:button>
                    </flux:tab.panel>

                    <flux:tab.panel name="bunker" class="mt-3 space-y-2">
                        <flux:input x-model="bunkerInput" placeholder="bunker://…" x-on:keydown.enter="loginBunker()" />
                        <flux:button variant="primary" class="w-full" x-on:click="loginBunker()" ::disabled="busy">Verbinden</flux:button>
                    </flux:tab.panel>

                    {{-- Amber via nostrconnect: Desktop zeigt QR (Amber scannt), Mobile
                         öffnet Amber per Deep-Link auf demselben Gerät. Rückkanal beide
                         Male über die Signer-Relays. --}}
                    <flux:tab.panel name="amber" class="mt-3">
                        <template x-if="!connecting">
                            <flux:button variant="primary" class="w-full" icon="qr-code" x-on:click="startConnect()">Mit Amber verbinden</flux:button>
                        </template>
                        <template x-if="connecting">
                            <div class="flex flex-col items-center gap-3 text-center">
                                {{-- Mobile: startConnect() öffnet Amber bereits automatisch
                                     per nativem Intent (WebView reicht nostrconnect:// nicht
                                     selbst weiter). Der Button ist nur Fallback zum erneuten
                                     Öffnen, falls Amber nicht ansprang. --}}
                                <template x-if="mobile">
                                    <flux:button variant="ghost" class="w-full" icon="arrow-top-right-on-square" x-show="connectUri" x-on:click="openAmber()">Amber erneut öffnen</flux:button>
                                </template>
                                {{-- Desktop: QR zum Scannen mit Amber --}}
                                <template x-if="!mobile && connectQr">
                                    <img :src="connectQr" alt="nostrconnect QR-Code" class="size-56 rounded-tile bg-white p-2" />
                                </template>
                                <template x-if="!mobile && !connectQr">
                                    <flux:text>QR-Code wird erzeugt…</flux:text>
                                </template>
                                <flux:text class="text-sm">Warte auf die Verbindung mit Amber …</flux:text>
                                <flux:button variant="ghost" x-on:click="stopConnect()">Abbrechen</flux:button>
                            </div>
                        </template>
                    </flux:tab.panel>
                </flux:tab.group>

                <template x-if="error">
                    <flux:callout variant="danger" icon="exclamation-triangle" class="mt-4">
                        <flux:callout.text x-text="error"></flux:callout.text>
                    </flux:callout>
                </template>
            </div>
        </template>

    </div>
</main>
