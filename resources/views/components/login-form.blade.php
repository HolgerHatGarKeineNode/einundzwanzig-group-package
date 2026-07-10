@props([
    // Der „Angemeldet"/Abmelden-Zweig ist nur für die Fullscreen-Deep-Link-Route
    // relevant (ein bereits eingeloggter Nutzer landet dort per Auto-Reauth). Das
    // Login-Sheet (§4.2) öffnet ausschließlich für Gäste (authGate returned früh,
    // wenn eingeloggt) → dort weglassen, sonst stünde ein zweiter Logout im DOM.
    'showLoggedIn' => true,
])

{{-- P6 (§5.1): DER eine Login-View. Aus dem Vollbild-`⚡nostr-login` in eine
     geteilte Komponente promoted — dieselbe Blade rendert (a) das globale
     Login-Sheet (Overlay, §4.2) und (b) den `group.nostr-login`-Deep-Link
     fullscreen. Signer + Session bleiben strikt im Browser (`nostrAuth`-Insel).

     Methoden-Priorisierung plattform-adaptiv (§5.1): GENAU ein Primär-CTA, der
     Rest unter „Andere Optionen":
       native mobil  → Amber (NIP-55) primär
       Web + window.nostr → Browser-Erweiterung (NIP-07) primär
       Web ohne Erweiterung → QR-Bunker (nostrconnect://) primär
     Amber wird im Web NICHT als Marke angeboten (kein Intent-Kanal) — der
     QR-Bunker-Pfad übernimmt dort die „Signer-auf-dem-Handy"-Rolle.
     nsec ist gehärtet: hinter „Andere Optionen", roter Hinweis, Checkbox-Gate.
     Lightning-Login: existiert im Web-Client gar nicht (kein Portal). --}}
<div x-data="nostrAuth" class="page-enter">

    {{-- Eingeloggt (bzw. Session wird nach Reboot wiederhergestellt). Im
         Reconnect-Modus (?reconnect=1) NICHT zeigen — dort sollen trotz aktivem
         pubkey die Verbinden-Optionen erscheinen. --}}
    @if ($showLoggedIn)
        <template x-if="pubkey && !reconnect">
            <div class="surface-card empty-state p-6 text-center">
                <flux:icon.check-badge variant="solid" class="mx-auto size-10 text-brand-500" />
                <flux:heading size="lg" class="mt-3" x-text="reauthing ? 'Anmeldung wird wiederhergestellt…' : 'Angemeldet'"></flux:heading>
                <div class="mt-2 rounded-tile bg-zinc-100 p-2 font-mono text-xs break-all text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400" x-text="npub"></div>
                {{-- Auto-Reauth (NIP-98-Handoff) fehlgeschlagen → Grund zeigen. --}}
                <flux:text x-show="error" x-cloak class="mt-3 text-sm text-red-500" x-text="error"></flux:text>
                <flux:button variant="ghost" class="mt-4" x-on:click="doLogout()">Abmelden</flux:button>
            </div>
        </template>
    @endif

    {{-- Ausgeloggt (oder Reconnect-Modus): Login-/Verbinden-Optionen --}}
    <template x-if="!pubkey || reconnect">
        <div class="surface-card p-6" x-data="{ showMore: false, nsecOk: false }">
            <flux:heading size="xl" class="flex items-center gap-2">
                <flux:icon.bolt variant="solid" class="size-6 text-brand-500" />
                <span x-text="reconnect ? 'Neu verbinden' : 'Anmelden'"></span>
            </flux:heading>

            {{-- Reconnect-Hinweis: warum der Nutzer hier ist. --}}
            <flux:callout x-show="reconnect" x-cloak icon="arrow-path" class="mt-3">
                <flux:callout.text>Deine Amber-/Bunker-Verbindung stammt aus einer früheren Version. Verbinde einmal neu, um alle Berechtigungen (Zaps, Umfragen, Reaktionen, Admin) zu erteilen.</flux:callout.text>
            </flux:callout>

            {{-- QR-/Amber-Verbindungslauf (nostrconnect://). EINE Instanz, getriggert
                 vom Amber-Primär-CTA (mobil), vom QR-Bunker-Primär-CTA (Web ohne
                 Erweiterung) oder aus „Andere Optionen". Desktop zeigt QR (Signer
                 scannt), Mobile öffnet Amber per Deep-Link auf demselben Gerät. --}}
            <div x-show="connecting" x-cloak class="mt-4 flex flex-col items-center gap-3 text-center">
                <template x-if="mobile">
                    <flux:button variant="ghost" class="w-full" icon="arrow-top-right-on-square" x-show="connectUri" x-on:click="openAmber()">Amber erneut öffnen</flux:button>
                </template>
                <template x-if="!mobile && connectQr">
                    <img :src="connectQr" alt="nostrconnect QR-Code" class="size-56 rounded-tile bg-white p-2" />
                </template>
                <template x-if="!mobile && !connectQr">
                    <div class="skeleton size-56 rounded-tile" aria-busy="true">
                        <span class="sr-only" aria-live="polite">QR-Code wird erzeugt…</span>
                    </div>
                </template>
                <flux:text class="text-sm">Warte auf die Verbindung mit dem Signer …</flux:text>
                <flux:button variant="ghost" x-on:click="stopConnect()">Abbrechen</flux:button>
            </div>

            {{-- ── Primär-CTA (genau einer, plattform-adaptiv) ──────────────── --}}
            <div x-show="!connecting" class="mt-4 space-y-2">
                {{-- native mobil → Amber (NIP-55) --}}
                <template x-if="mobile">
                    <div class="space-y-1">
                        <flux:button variant="primary" class="w-full" icon="qr-code" x-on:click="startConnect()" ::disabled="busy">Mit Amber anmelden</flux:button>
                        <flux:text class="text-xs text-muted">Empfohlen · dein Schlüssel bleibt in Amber.</flux:text>
                    </div>
                </template>
                {{-- Web + Erweiterung → NIP-07 --}}
                <template x-if="!mobile && hasExtension">
                    <div class="space-y-1">
                        <flux:button variant="primary" class="w-full" x-on:click="loginExtension()" ::disabled="busy">
                            <span x-text="busy ? 'Verbinde…' : 'Mit Browser-Erweiterung anmelden'"></span>
                        </flux:button>
                        <flux:text class="text-xs text-muted">NIP-07 · dein Schlüssel bleibt in der Erweiterung.</flux:text>
                    </div>
                </template>
                {{-- Web ohne Erweiterung → QR-Bunker primär --}}
                <template x-if="!mobile && !hasExtension">
                    <div class="space-y-1">
                        <flux:button variant="primary" class="w-full" icon="qr-code" x-on:click="startConnect()" ::disabled="busy">Signer per QR verbinden</flux:button>
                        <flux:text class="text-xs text-muted">Keine Browser-Erweiterung gefunden (Alby, nos2x …). Verbinde deinen Signer (z. B. Amber, nsec.app) per QR.</flux:text>
                    </div>
                </template>
            </div>

            {{-- ── Andere Optionen (aufklappbar) ───────────────────────────── --}}
            <div x-show="!connecting" class="mt-4">
                <flux:button variant="ghost" size="sm" class="w-full" icon="ellipsis-horizontal" x-on:click="showMore = !showMore" ::aria-expanded="showMore">Andere Optionen</flux:button>

                <div x-show="showMore" x-cloak class="mt-3 space-y-4">
                    {{-- QR-Bunker als Sekundäroption NUR im Web-mit-Erweiterung-Fall, wo
                         er eine echte Alternative zum NIP-07-Primär-CTA ist. Auf Mobile
                         ruft der Amber-Primär-CTA bereits startConnect(), und Web-ohne-
                         Erweiterung hat den QR schon primär → dort kein Duplikat. --}}
                    <template x-if="hasExtension">
                        <flux:button variant="filled" class="w-full" icon="qr-code" x-on:click="startConnect()">Signer per QR verbinden (Bunker)</flux:button>
                    </template>

                    {{-- Bunker-URI direkt einfügen. --}}
                    <div class="space-y-2">
                        <flux:input x-model="bunkerInput" placeholder="bunker://…" x-on:keydown.enter="loginBunker()" />
                        <flux:button variant="filled" class="w-full" x-on:click="loginBunker()" ::disabled="busy">
                            <span x-text="busy ? 'Verbinde…' : 'Mit Bunker verbinden'"></span>
                        </flux:button>
                    </div>

                    {{-- nsec — gehärtet: roter Hinweis + Checkbox-Gate schaltet frei. --}}
                    <div class="space-y-2 border-t border-zinc-200 pt-4 dark:border-zinc-700">
                        <flux:callout variant="warning" icon="exclamation-triangle">
                            <flux:callout.heading>Privaten Schlüssel eingeben — unsicher</flux:callout.heading>
                            <flux:callout.text>
                                {{-- Nativ (App) kennt weder „Browser" noch NIP-07-Erweiterung → eigener Wortlaut. --}}
                                <span x-show="!mobile">Dein privater Schlüssel wird im Browser gespeichert und ist dort angreifbar. Für echte Konten nutze eine Browser-Erweiterung oder einen Signer (Amber, Bunker).</span>
                                <span x-show="mobile" x-cloak>Dein privater Schlüssel wird auf diesem Gerät gespeichert und ist dort angreifbar. Für echte Konten nutze Amber oder einen Bunker.</span>
                            </flux:callout.text>
                        </flux:callout>
                        <flux:checkbox x-model="nsecOk" label="Ich verstehe das Risiko" />
                        <flux:input type="password" x-model="keyInput" placeholder="nsec1… oder 64-stelliger hex-Key" x-on:keydown.enter="nsecOk && loginNsec()" ::disabled="!nsecOk" />
                        <flux:button variant="danger" class="w-full" x-on:click="loginNsec()" ::disabled="!nsecOk || busy">
                            <span x-text="busy ? 'Melde an…' : 'Trotzdem anmelden (unsicher)'"></span>
                        </flux:button>
                    </div>
                </div>
            </div>

            {{-- „Neu bei Nostr?" (§5.1): dezent-sekundäres Erklär-Panel, KEIN
                 Registrieren-Wizard. Verweist auf einen Signer, der den Schlüssel
                 verwahrt — mobil Amber (F-Droid), im Web eine Browser-Erweiterung.
                 (Reicher Gast-Onboarding-Ausbau → P7 §5.2/§5.4.) --}}
            <div x-show="!connecting" x-data="{ showHelp: false }" class="mt-4 border-t border-zinc-200 pt-3 text-center dark:border-zinc-700">
                <flux:button variant="ghost" size="sm" x-on:click="showHelp = !showHelp" ::aria-expanded="showHelp">Neu bei Nostr?</flux:button>
                <div x-show="showHelp" x-cloak class="mt-2 space-y-2 text-left">
                    <flux:text class="text-sm">Nostr ist ein offenes Netzwerk ohne zentrales Konto. Statt Passwort besitzt du einen Schlüssel, den ein Signer sicher verwahrt und für dich signiert.</flux:text>
                    <flux:link x-show="mobile" href="https://f-droid.org/packages/com.greenart7c3.nostrsigner/" external>Amber-Signer installieren (F-Droid)</flux:link>
                    <flux:text x-show="!mobile" class="text-sm">Im Browser: installiere eine Signer-Erweiterung wie <flux:link href="https://getalby.com" external>Alby</flux:link> oder nos2x und lade diese Seite neu.</flux:text>
                </div>
            </div>

            <template x-if="error">
                <flux:callout variant="danger" icon="exclamation-triangle" class="mt-4">
                    <flux:callout.text x-text="error"></flux:callout.text>
                </flux:callout>
            </template>
        </div>
    </template>

</div>
