<?php

use Einundzwanzig\Group\ImageProxy;
use Einundzwanzig\Group\Nostr\SpaceCache;
use Illuminate\Support\Facades\View;
use Livewire\Attributes\Layout;
use Livewire\Component;

/** Directory (Mitglieder + Rollen des aktiven Space) als Livewire-SFC. */
new #[Layout('group::einundzwanzig')] class extends Component
{
    public ?string $ogImage = null;

    public function mount(SpaceCache $cache): void
    {
        // OG-Bild = Space-icon (NIP-11), konsistent zur Space-Seite (B5).
        $icon = $cache->relayInfo(SpaceCache::spaceUrl())['icon'];
        $this->ogImage = $icon ? url(ImageProxy::url($icon, 'og')) : null;
    }

    public function render()
    {
        View::share('ogImage', $this->ogImage);

        return $this->view()->title(__('Mitglieder'));
    }
}; ?>

<x-group::app-shell>

    {{-- Kopf: Brand-Mark (kein :back — gleichrangiger Bottom-Nav-Tab, §Bottom-Nav) --}}
    <x-group::app-header title="{{ __('Mitglieder') }}" />

    {{-- Vereins-Gate: Nicht-Vereinsmitglieder auf einem EINUNDZWANZIG-Vereins-Relay --}}
    <x-group::verein-gate context="{{ __('Die Mitgliederliste') }}" class="mb-4" />

    {{-- Directory des AKTIVEN Space (§12). Gated auf relay.self (Fix A). --}}
    <div x-data="nostrDirectory" class="page-enter space-y-4">

        {{-- Suche — für Nicht-Vereinsmitglieder ausgeblendet: die Mitgliederliste
             liefert der Relay nicht aus, eine Suche liefe ins Leere. Wrapper-Div,
             weil flux:input x-show sonst nur ans innere <input> hängt (Icon bliebe). --}}
        {{-- `x-ref` landet auf dem <input> selbst (flux:input reicht die Attribute
             dorthin durch) — der Treffer-Leerzustand weiter unten gibt den Fokus
             hierher zurück, wenn er sich selbst wegräumt. --}}
        <div x-show="!gatedOut">
            <flux:input x-ref="search" x-model="query" icon="magnifying-glass" placeholder="{{ __('Mitglied suchen…') }}" clearable />
        </div>

        {{-- Admin-Werkzeuge (nur wenn der Relay dem User NIP-86-Methoden erlaubt) --}}
        <div x-show="isAdmin" x-cloak class="flex flex-wrap gap-2">
            {{-- Melde-Queue (P3, NIP-56 kind 1984). Count-Badge signalisiert offene
                 Meldungen; reports werden in der Insel geladen + live gehalten.

                 `moderation-audit-open` (P1) startet den Abruf der Moderations-Historie in
                 der Insel weiter unten im Dialog: sie liegt AUSSERHALB dieser Scope-Kette,
                 also wird gesendet statt aufgerufen. Erst beim Klick, weil jeder Abruf
                 eine NIP-98-Signatur kostet — dieselbe Regel wie bei `loadBanned()`. --}}
            <flux:modal.trigger name="action-items">
                <flux:button size="sm" variant="ghost" icon="flag" x-on:click="$dispatch('moderation-audit-open')">
                    <span class="inline-flex items-center gap-1.5">
                        {{ __('Meldungen & Beitritte') }}
                        <span x-show="reports.length + joinRequests.length" x-cloak x-text="reports.length + joinRequests.length"
                              class="rounded-full bg-red-500/15 px-1.5 py-0.5 text-xs font-semibold text-red-500"></span>
                    </span>
                </flux:button>
            </flux:modal.trigger>
            {{-- Space-Metadaten (Name/Beschreibung/Icon, NIP-86 changerelay*). openSpaceEdit
                 belegt aus dem NIP-11 vor + öffnet das Modal selbst (kein modal.trigger nötig). --}}
            <flux:button size="sm" variant="ghost" icon="pencil-square" x-on:click="openSpaceEdit()">{{ __('Space') }}</flux:button>
            <flux:button size="sm" variant="primary" icon="plus" x-on:click="openRoleCreate()">{{ __('Rolle') }}</flux:button>
            <flux:modal.trigger name="roles-list">
                <flux:button size="sm" variant="ghost" icon="swatch">{{ __('Rollen verwalten') }}</flux:button>
            </flux:modal.trigger>
            {{-- Bestehende Sperren: seit P4 stehen hier befristete Sperren (9042) NEBEN
                 den Bannen, die ältere Clients gesetzt haben. Beide müssen sichtbar und
                 aufhebbar bleiben, deshalb bleibt der Reiter — nur seine Beschriftung
                 folgt dem, was er heute zeigt. Die Abfrage feuert erst beim Klick. --}}
            <flux:modal.trigger name="banned">
                <flux:button size="sm" variant="ghost" icon="no-symbol" x-on:click="loadBanned()">{{ __('Gesperrt') }}</flux:button>
            </flux:modal.trigger>
            <flux:modal.trigger name="invite">
                <flux:button size="sm" variant="ghost" icon="user-plus" x-on:click="loadInvite()">{{ __('Einladen') }}</flux:button>
            </flux:modal.trigger>
        </div>

        {{-- Ladezustand: Skeleton, bis relay.self da UND alle Mitglieder-Profile
             geladen sind (profilesReady). Erst dann rendert die Liste in EINEM
             Rutsch — kein progressives Umsortieren/Flackern, im Mobile-WebView
             kein Repaint-Sturm (schwarzer Bildschirm). --}}
        <template x-if="!profilesReady">
            <div class="space-y-2" aria-busy="true">
                <span class="sr-only" aria-live="polite">{{ __('Mitglieder werden geladen…') }}</span>
                <template x-for="i in 4" :key="i">
                    <div class="surface-card flex items-center gap-3 p-3">
                        <div class="skeleton size-9 rounded-full"></div>
                        <div class="flex-1 space-y-1.5">
                            <div class="skeleton h-3.5 w-32"></div>
                            <div class="skeleton h-2.5 w-20"></div>
                        </div>
                    </div>
                </template>
            </div>
        </template>

        {{-- Geladen, aber keine Mitglieder. Für Nicht-Vereinsmitglieder ausgeblendet
             (kein falsches „keine Mitglieder" — die Gate-Karte oben erklärt es).

             `authed` zusätzlich zu `gatedOut`, weil `gatedOut` den Gast NICHT
             erfasst: es ist `isVereinGatedOut`, und dessen `ready` wird ohne Signer
             nie wahr (die 13534 ist selbst AUTH-pflichtig, p4-messung.md 20.4).
             Gemessen am 2026-08-15 stand einem Gast hier deshalb „Noch keine
             Mitglieder in diesem Space." auf dem Schirm, obwohl der Space Mitglieder
             hat — er darf die Liste nur nicht lesen. Das ist genau der Fehler, den
             der Kommentar oben verhindern wollte, nur für die Zielgruppe, an die
             `gatedOut` nicht heranreicht. --}}
        <template x-if="profilesReady && members.length === 0 && !gatedOut && $store.authGate?.authed">
            <div class="surface-card empty-state p-6 text-center">
                <flux:icon.users class="mx-auto size-8 text-zinc-400" />
                <flux:text class="mt-2">{{ __('Noch keine Mitglieder in diesem Space.') }}</flux:text>
                {{-- Genau EIN Weg — und nur für den, der ihn gehen darf: einladen
                     kann ausschließlich ein Relay-Admin (NIP-86). Für alle anderen
                     bleibt der Zustand bewusst handlungslos; ein Knopf, der beim
                     Drücken am Relay abprallt, ist schlimmer als kein Knopf.
                     Derselbe Auslöser wie in der Admin-Leiste oben (`invite`-Modal
                     + `loadInvite()`), kein zweiter Pfad zur selben Sache. --}}
                <div x-show="isAdmin" x-cloak class="mt-4">
                    <flux:modal.trigger name="invite">
                        <flux:button size="sm" variant="ghost" icon="user-plus" x-on:click="loadInvite()">{{ __('Mitglied einladen') }}</flux:button>
                    </flux:modal.trigger>
                </div>
            </div>
        </template>

        {{-- Mitglieder-Grid --}}
        <template x-if="profilesReady && members.length > 0">
            <div class="list-stagger space-y-2">
                <template x-for="(m, idx) in filtered()" :key="m.pubkey">
                    <div class="surface-card flex items-center gap-3 p-3" :style="`--i:${idx}`">
                        <button type="button" x-on:click="$dispatch('open-profile', m.pubkey)"
                                class="pressable shrink-0" aria-label="{{ __('Profil anzeigen') }}">
                            {{-- Status-Emoji (NIP-38) als Plakette; der Text steht unten in der Zeile. --}}
                            <x-group::nostr-avatar picture="m.picture" name="m.name" emoji="statusOf(m.pubkey).emoji" />
                        </button>
                        <div class="min-w-0 flex-1">
                            <div class="flex items-center gap-1.5">
                                <button type="button" x-on:click="$dispatch('open-profile', m.pubkey)"
                                        class="pressable min-w-0 truncate text-left font-semibold hover:underline" x-text="m.name"></button>
                                <x-group::nostr-nip05 nip05="m.nip05" />
                            </div>
                            {{-- Verifizierter Handle ersetzt die npub-Kurzform, sonst npub. --}}
                            <div class="truncate font-mono text-xs text-muted" x-text="m.nip05 || m.short"></div>
                            {{-- NIP-38-Status (P2). Drei Zustände, nicht zwei: solange die Relay-Art
                                 unbekannt ist (`statusPending`, aus js/spaceCaps.ts), steht hier ein
                                 Platzhalter — „hat keinen Status" und „weiß ich noch nicht" dürfen
                                 nicht gleich aussehen. Im zooid-Arm ist beides leer und die Zeile
                                 sieht aus wie vorher. --}}
                            <template x-if="statusPending">
                                <div data-status-skeleton aria-hidden="true" class="skeleton mt-1 h-3 w-28 rounded-full"></div>
                            </template>
                            <template x-if="!statusPending && (statusOf(m.pubkey).text || statusOf(m.pubkey).emoji)">
                                <div data-user-status class="mt-0.5 flex items-center gap-1 text-xs text-muted">
                                    <span x-show="statusOf(m.pubkey).emoji" x-text="statusOf(m.pubkey).emoji"></span>
                                    <span class="min-w-0 truncate" x-text="statusOf(m.pubkey).text"></span>
                                </div>
                            </template>
                            <div class="mt-1 flex flex-wrap gap-1" x-show="m.roles.length > 0">
                                <template x-for="role in m.roles" :key="role.id">
                                    <flux:badge size="sm" ::style="`color:${role.color};background-color:${role.soft}`">
                                        <span x-text="role.label"></span>
                                    </flux:badge>
                                </template>
                            </div>
                        </div>

                        {{-- Admin-Aktionen je Mitglied (NIP-86) --}}
                        <div x-show="isAdmin" x-cloak class="shrink-0">
                            <flux:dropdown position="bottom" align="end">
                                <flux:button size="xs" variant="ghost" icon="ellipsis-vertical" class="icon-btn-touch" aria-label="{{ __('Mitglied verwalten') }}" />
                                <flux:menu>
                                    <flux:menu.item icon="swatch" x-on:click="openMemberRoles(m)">{{ __('Rollen bearbeiten') }}</flux:menu.item>
                                    {{-- Timed suspension (Buzz kind 9042) — the strongest measure this
                                         surface offers. Separator and entry both hang on `canTimeout`:
                                         a zooid space has no timeout command, and a divider at the end
                                         of the menu would then separate nothing. One flux child per
                                         `template x-if` — a wrapper div swallows flux:menu (same rule
                                         and same reason as in `partials/chat-row.blade.php`). --}}
                                    <template x-if="canTimeout">
                                        <flux:menu.separator />
                                    </template>
                                    <template x-if="canTimeout">
                                        <flux:menu.item icon="clock" x-on:click="openTimeout(m)">{{ __('Befristet sperren') }}</flux:menu.item>
                                    </template>
                                    {{-- no removal or ban of members here — the association does not remove
                                         or ban its members (decision 2026-09-03); the timed suspension above
                                         is the strongest measure this surface offers. The write paths stay
                                         (`removeMember`/`banMember` in `js/bridge.ts`, `removeSpaceMember`/
                                         `banSpaceMember` in `js/members.ts`): they carry the zooid arm and
                                         are unused capability, not dead code.
                                    <flux:menu.item icon="user-minus" x-on:click="removeMember(m)">{{ __('Entfernen') }}</flux:menu.item>
                                    <flux:menu.item variant="danger" icon="no-symbol" x-on:click="banMember(m)">{{ __('Bannen') }}</flux:menu.item>
                                    --}}
                                </flux:menu>
                            </flux:dropdown>
                        </div>
                    </div>
                </template>

                {{-- Suche ohne Treffer. Bis hierher eine graue Zeile ohne Ausweg —
                     jetzt dieselbe Form wie jeder andere Leerzustand des Clients und
                     derselbe Ausweg wie in ⚡updates: der Filter, der die Liste
                     geleert hat, ist auch der Weg zurück.
                     Der Fokus MUSS mitwandern: der Knopf räumt mit dem Zustand sich
                     selbst weg, der Fokus fiele sonst auf <body>. Ziel ist das
                     Suchfeld — dort steht das, was der Nutzer als Nächstes ändert.

                     ERST fokussieren, DANN leeren — die Reihenfolge ist der ganze
                     Punkt und keine Stilfrage. `query = ''` löst das umschließende
                     `x-if` auf, und Alpine entfernt den Knopf synchron im
                     Reaktivitäts-Effekt. `$nextTick` schiebt seinen Rückruf dagegen
                     in einen MAKRO-Task (`queueMicrotask` → `setTimeout` →
                     `releaseNextTicks`, Alpine 3.15.12). Der Rückruf läuft dann zwar
                     — der `tickStack` ist global —, aber `$refs` ist ein DOM-AUFSTIEG
                     vom Handler-Element (`findClosest` bricht bei `!el.parentElement`
                     ab). Am detachierten Knopf liefert er einen LEEREN Proxy, und
                     `undefined?.focus()` schweigt. Gemessen: 0 focus()-Aufrufe,
                     `document.activeElement` blieb `<body>`.
                     Synchron gibt es das Problem nicht: der Knopf hängt beim
                     Fokussieren noch im Baum, und das Entfernen eines Teilbaums, der
                     das fokussierte Feld NICHT enthält, rührt den Fokus nicht an. --}}
                <template x-if="filtered().length === 0">
                    <div class="surface-card empty-state p-6 text-center">
                        <flux:icon.magnifying-glass class="mx-auto size-8 text-zinc-400" />
                        <flux:text class="mt-2 text-sm text-muted">{{ __('Kein Mitglied passt zu „') }}<span x-text="query"></span>{{ __('".') }}</flux:text>
                        <div class="mt-4">
                            <flux:button size="sm" variant="ghost" icon="arrow-path"
                                         x-on:click="$refs.search?.focus(); query = ''">{{ __('Suche leeren') }}</flux:button>
                        </div>
                    </div>
                </template>
            </div>
        </template>

        {{-- ── Admin-Modals (NIP-86) ─────────────────────────────────────────── --}}

        {{-- Rolle anlegen/bearbeiten (HSL via native range, §6) --}}
        <flux:modal name="role-form" class="max-w-sm">
            <div class="space-y-4">
                <flux:heading size="lg" x-text="roleForm.id ? @js(__('Rolle bearbeiten')) : @js(__('Neue Rolle'))"></flux:heading>

                <flux:input label="{{ __('Bezeichnung') }}" x-model="roleForm.label" placeholder="{{ __('z.B. Vorstand') }}" />
                <flux:textarea label="{{ __('Beschreibung') }}" x-model="roleForm.description" rows="2" placeholder="{{ __('Optional') }}" />

                <div>
                    <flux:text class="mb-1 text-sm font-medium">{{ __('Farbe') }}</flux:text>
                    <div class="flex items-center gap-3">
                        <flux:badge x-bind:style="`color:hsl(${roleForm.hue},70%,${roleForm.lightness*100}%);background-color:hsl(${roleForm.hue},70%,${roleForm.lightness*100}%,0.15)`">
                            <span x-text="roleForm.label || @js(__('Vorschau'))"></span>
                        </flux:badge>
                    </div>
                    <label class="mt-2 block text-xs text-muted">{{ __('Farbton') }}</label>
                    <input type="range" min="0" max="360" step="1" x-model.number="roleForm.hue" class="w-full accent-brand-500" />
                    <label class="mt-1 block text-xs text-muted">{{ __('Helligkeit') }}</label>
                    <input type="range" min="0.2" max="0.8" step="0.01" x-model.number="roleForm.lightness" class="w-full accent-brand-500" />
                </div>

                <div class="flex justify-end gap-2">
                    <flux:modal.close><flux:button variant="ghost">{{ __('Abbrechen') }}</flux:button></flux:modal.close>
                    <flux:button variant="primary" x-on:click="saveRole()" ::disabled="busy || !roleForm.label.trim()">{{ __('Speichern') }}</flux:button>
                </div>
            </div>
        </flux:modal>

        {{-- Rollen verwalten (Liste, bearbeiten/löschen) --}}
        <flux:modal name="roles-list" class="max-w-sm">
            <div class="space-y-4">
                <flux:heading size="lg">{{ __('Rollen') }}</flux:heading>
                <template x-if="rolesFull.length === 0">
                    <flux:text class="text-sm text-muted">{{ __('Noch keine Rollen definiert.') }}</flux:text>
                </template>
                <div class="space-y-2">
                    <template x-for="role in rolesFull" :key="role.id">
                        <div class="surface-card flex items-center gap-2 p-2">
                            <flux:badge size="sm" x-bind:style="`color:hsl(${parseFloat(role.color.hue)||0},70%,${(parseFloat(role.color.lightness)||0.5)*100}%);background-color:hsl(${parseFloat(role.color.hue)||0},70%,${(parseFloat(role.color.lightness)||0.5)*100}%,0.15)`">
                                <span x-text="role.label || role.id"></span>
                            </flux:badge>
                            <span class="min-w-0 flex-1 truncate text-xs text-muted" x-text="role.description"></span>
                            <flux:button size="xs" variant="ghost" icon="pencil-square" class="icon-btn-touch" x-on:click="openRoleEdit(role)" aria-label="{{ __('Bearbeiten') }}" />
                            <flux:button size="xs" variant="ghost" icon="trash" class="icon-btn-touch" x-on:click="removeRole(role.id)" ::disabled="busy" aria-label="{{ __('Löschen') }}" />
                        </div>
                    </template>
                </div>
                <flux:button variant="primary" icon="plus" class="w-full" x-on:click="openRoleCreate()">{{ __('Neue Rolle') }}</flux:button>
            </div>
        </flux:modal>

        {{-- Rollen eines Mitglieds zuweisen (Toggle je Rolle) --}}
        <flux:modal name="member-roles" class="max-w-sm">
            <div class="space-y-4" x-show="editingMember">
                <flux:heading size="lg">{{ __('Rollen von') }} <span x-text="editingMember?.name"></span></flux:heading>
                <template x-if="roles.length === 0">
                    <flux:text class="text-sm text-muted">{{ __('Erst eine Rolle anlegen.') }}</flux:text>
                </template>
                <div class="space-y-1">
                    {{-- Zeilen-Toggle (Check/Plus-Icon + farbiges Rollen-Badge) → rohes <button>,
                         kein Flux-Icon-Pendant für dieses Komposit, §6. --}}
                    <template x-for="role in roles" :key="role.id">
                        {{-- `x-bind:disabled`, nicht `::disabled`: der `::`-Escape gilt nur für
                             Komponenten-Tags. Auf diesem <button> war die Bindung tot — die
                             Rollen-Umschaltung ließ sich während eines laufenden Schreibvorgangs
                             mehrfach auslösen. --}}
                        <button type="button" x-on:click="toggleMemberRole(role.id)" x-bind:disabled="busy"
                                class="pressable flex w-full items-center gap-2 rounded-tile p-2 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800">
                            <flux:icon.check-circle variant="solid" class="size-5 text-brand-500" x-show="memberHasRole(role.id)" x-cloak />
                            <flux:icon.plus-circle class="size-5 text-zinc-400" x-show="!memberHasRole(role.id)" />
                            <flux:badge size="sm" ::style="`color:${role.color};background-color:${role.soft}`"><span x-text="role.label"></span></flux:badge>
                        </button>
                    </template>
                </div>
            </div>
        </flux:modal>

        {{-- Einladungs-Link generieren (Claim aus kind 28935) --}}
        <flux:modal name="invite" class="max-w-sm">
            <div class="space-y-4">
                <flux:heading size="lg">{{ __('Einladen') }}</flux:heading>
                <flux:text class="text-sm text-muted">{{ __('Teile diesen Link — er führt direkt in den Space.') }}</flux:text>
                <template x-if="inviteBusy">
                    <div class="skeleton h-10 rounded-tile"></div>
                </template>
                <div x-show="!inviteBusy && inviteLink" x-cloak class="flex items-center gap-2">
                    <flux:input readonly x-model="inviteLink" class="flex-1 font-mono text-xs" />
                    <flux:button variant="primary" icon="clipboard" x-on:click="copyInvite()" aria-label="{{ __('Kopieren') }}" />
                </div>
            </div>
        </flux:modal>

        {{-- Bestehende Sperren: befristete Sperren (9042, aufhebbar per 9043) und die
             Banns älterer Clients (aufhebbar per 9041/NIP-86). Diese Oberfläche bannt
             nicht mehr — anzeigen und aufheben muss sie beides trotzdem. --}}
        <flux:modal name="banned" class="max-w-sm">
            <div class="space-y-4">
                <flux:heading size="lg">{{ __('Gesperrt') }}</flux:heading>
                {{-- Ein Fehlgrund ist KEINE leere Liste: „niemand ist gesperrt" und „du
                     darfst diese Abfrage nicht" sagen dem Moderator das Gegenteil
                     voneinander. Deshalb zwei getrennte Zustände. --}}
                <template x-if="bannedError">
                    <flux:callout variant="danger" icon="exclamation-triangle">
                        <flux:callout.text x-text="bannedError"></flux:callout.text>
                    </flux:callout>
                </template>
                <template x-if="!bannedError && banned.length === 0">
                    <flux:text class="text-sm text-muted">{{ __('Niemand gesperrt.') }}</flux:text>
                </template>
                <div class="space-y-2">
                    <template x-for="b in banned" :key="b.pubkey">
                        <div class="surface-card flex items-center gap-2 p-2">
                            <div class="min-w-0 flex-1">
                                <div class="truncate font-mono text-xs text-muted" x-text="b.short"></div>
                                <div class="truncate text-xs text-muted" x-text="b.reason"></div>
                                <div x-show="b.until" x-cloak class="truncate text-xs text-muted">{{ __('Bis') }} <span x-text="b.until"></span></div>
                            </div>
                            {{-- Befristete Sperre: EIN Knopf (9043). Ein „Wiederaufnehmen"
                                 gibt es hier nicht — die Mitgliedschaft war nie weg. --}}
                            <template x-if="!b.banned">
                                <flux:button size="xs" variant="ghost" class="icon-btn-touch" x-on:click="liftTimeout(b.pubkey)" ::disabled="busy">{{ __('Sperre aufheben') }}</flux:button>
                            </template>
                            {{-- Ban aus einem älteren Client: aufheben UND wieder aufnehmen,
                                 wie bisher. Ein Wrapper-Div, weil `template x-if` genau EIN
                                 Wurzelelement trägt. --}}
                            <template x-if="b.banned">
                                <div class="flex shrink-0 gap-2">
                                    <flux:button size="xs" variant="ghost" class="icon-btn-touch" x-on:click="unbanMember(b.pubkey)" ::disabled="busy">{{ __('Entbannen') }}</flux:button>
                                    <flux:button size="xs" variant="primary" class="icon-btn-touch" x-on:click="restoreMember(b.pubkey)" ::disabled="busy">{{ __('Wiederaufnehmen') }}</flux:button>
                                </div>
                            </template>
                        </div>
                    </template>
                </div>
            </div>
        </flux:modal>

        {{-- Befristet sperren (P4, Buzz kind 9042). Die Dauer ist WÄHLBAR — ausdrücklicher
             Nutzerwunsch vom 2026-09-03, kein fester Wert im Code. Was das Auswahlfeld
             liefert, sind Sekunden; die Umrechnung Dauer → `expiration` steht als reine
             Funktion in `js/moderationTimeoutModels.ts` und nicht in dieser Datei.

             Das Ereignis entsteht erst beim Klick auf „Sperren": Buzz nimmt
             Moderationsbefehle nur innerhalb von ±120 s an (`MAX_COMMAND_SKEW_SECS`), ein
             vorbereitetes Ereignis wäre beim Absenden abgelaufen. --}}
        <flux:modal name="member-timeout" class="max-w-sm">
            <div class="space-y-4">
                <flux:heading size="lg">{{ __('Befristet sperren') }}</flux:heading>
                <flux:text class="text-sm text-muted">
                    {{ __('Das Mitglied kann bis zum Ablauf nichts schreiben. Es bleibt Mitglied — entfernt oder gebannt wird niemand.') }}
                </flux:text>
                <div class="truncate text-sm font-medium" x-text="timeoutTarget?.name"></div>
                <flux:select x-model="timeoutDuration" label="{{ __('Dauer') }}">
                    <flux:select.option value="3600">{{ __('1 Stunde') }}</flux:select.option>
                    <flux:select.option value="86400">{{ __('1 Tag') }}</flux:select.option>
                    <flux:select.option value="259200">{{ __('3 Tage') }}</flux:select.option>
                    <flux:select.option value="604800">{{ __('7 Tage') }}</flux:select.option>
                    <flux:select.option value="2592000">{{ __('30 Tage') }}</flux:select.option>
                </flux:select>
                <flux:input x-model="timeoutReason" label="{{ __('Grund (optional)') }}" placeholder="{{ __('Wird dem Mitglied mitgeteilt') }}" />
                <div class="flex justify-end gap-2">
                    <flux:modal.close><flux:button variant="ghost">{{ __('Abbrechen') }}</flux:button></flux:modal.close>
                    <flux:button variant="danger" x-on:click="confirmTimeout()" ::disabled="busy">{{ __('Sperren') }}</flux:button>
                </div>
            </div>
        </flux:modal>

        {{-- Space-Metadaten bearbeiten (P2, NIP-86 changerelay*): Icon-Upload mit
             Vorschau + Name + Beschreibung. Nur geänderte Felder werden gesendet. --}}
        <flux:modal name="space-edit" class="max-w-sm">
            <div class="space-y-4">
                <flux:heading size="lg">{{ __('Space bearbeiten') }}</flux:heading>

                {{-- Icon: runde Vorschau + „Ändern". Verstecktes File-Input via x-ref; die
                     Datei wird erst beim Speichern hochgeladen (Abbrechen lädt nichts).
                     `$img` (P7): remote Icon-URLs (beim Bearbeiten vorbefüllt) über den
                     Proxy, die data:-URL einer frisch gewählten Datei unverändert. --}}
                <div class="flex items-center gap-3">
                    <div class="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                        <img x-show="spaceIconPreview" :src="$img(spaceIconPreview)" alt="" class="size-full object-cover" />
                        <flux:icon.server x-show="!spaceIconPreview" class="size-6 text-zinc-400" />
                    </div>
                    <flux:button size="sm" variant="ghost" icon="photo" x-on:click="$refs.spaceIcon.click()">{{ __('Icon ändern') }}</flux:button>
                    <input type="file" accept="image/*" class="hidden" x-ref="spaceIcon" x-on:change="pickSpaceIcon($event.target)" />
                </div>

                <flux:input label="{{ __('Name') }}" x-model="spaceForm.name" placeholder="{{ __('Space-Name') }}" />
                <flux:textarea label="{{ __('Beschreibung') }}" x-model="spaceForm.description" rows="2" placeholder="{{ __('Optional') }}" />

                <div class="flex justify-end gap-2">
                    <flux:modal.close><flux:button variant="ghost">{{ __('Abbrechen') }}</flux:button></flux:modal.close>
                    <flux:button variant="primary" x-on:click="saveSpace()" ::disabled="spaceSaving">{{ __('Speichern') }}</flux:button>
                </div>
            </div>
        </flux:modal>

        {{-- Melde-Queue (P3, NIP-56 kind 1984): eingegangene „Fork off!"-Meldungen.
             Je Meldung: verwerfen (banevent Report), Inhalt entfernen (banevent
             gemeldetes Event + Report), Autor bannen (banpubkey + Report). --}}
        <flux:modal name="action-items" class="max-w-md">
            <div class="space-y-4">
                <flux:heading size="lg">{{ __('Meldungen & Beitritte') }}</flux:heading>

                {{-- Beitritts-Queue (P4b): offene 9021 für closed-Räume. Annehmen=kind 9000
                     (→ Mitglied, fällt aus der Queue), Ablehnen=banevent auf den Request. --}}
                <template x-if="joinRequests.length > 0">
                    <div class="space-y-2">
                        <p class="text-[0.7rem] font-semibold uppercase tracking-wider text-muted">{{ __('Beitritts-Anfragen') }}</p>
                        <template x-for="j in joinRequests" :key="j.id">
                            <div class="surface-card flex items-center gap-2 p-2">
                                <div class="min-w-0 flex-1">
                                    <button type="button" x-on:click="$dispatch('open-profile', j.pubkey)"
                                            class="pressable block max-w-full truncate text-left text-sm font-medium hover:underline" x-text="j.name"></button>
                                    <div class="truncate text-xs text-muted">{{ __('für Raum') }} #<span x-text="j.roomName"></span></div>
                                </div>
                                <flux:button size="xs" variant="primary" icon="check" class="icon-btn-touch shrink-0" x-on:click="acceptJoin(j)" ::disabled="busy" aria-label="{{ __('Annehmen') }}" />
                                <flux:button size="xs" variant="ghost" icon="x-mark" class="icon-btn-touch shrink-0" x-on:click="rejectJoin(j)" ::disabled="busy" aria-label="{{ __('Ablehnen') }}" />
                            </div>
                        </template>
                    </div>
                </template>

                {{-- Melde-Queue (P3, NIP-56 kind 1984): eingegangene „Fork off!"-Meldungen.
                     Trenn-Überschrift nur, wenn es Meldungen gibt (sonst verwaist). --}}
                <p x-show="reports.length > 0" class="text-[0.7rem] font-semibold uppercase tracking-wider text-muted">{{ __('Meldungen') }}</p>
                <template x-if="reports.length === 0 && joinRequests.length === 0">
                    <flux:text class="text-sm text-muted">{{ __('Keine offenen Meldungen oder Beitritte.') }}</flux:text>
                </template>
                <div class="space-y-2">
                    <template x-for="r in reports" :key="r.id">
                        <div class="surface-card space-y-2 p-3">
                            <div class="flex items-center gap-2">
                                <flux:badge size="sm" color="red"><span x-text="r.reasonLabel"></span></flux:badge>
                                {{-- Gemeldeter Autor: Klick öffnet das Profil (wie im Grid). --}}
                                <button type="button" x-on:click="$dispatch('open-profile', r.reportedPubkey)"
                                        class="pressable min-w-0 flex-1 truncate text-left text-sm font-medium hover:underline" x-text="r.reportedName"></button>
                            </div>
                            {{-- Optionaler Freitext des Melders. --}}
                            <p x-show="r.text" x-cloak class="text-sm text-muted" x-text="r.text"></p>
                            <div class="flex flex-wrap justify-end gap-2">
                                <flux:button size="xs" variant="ghost" x-on:click="dismissReport(r)" ::disabled="busy">{{ __('Verwerfen') }}</flux:button>
                                <flux:button size="xs" variant="ghost" icon="trash" x-on:click="removeReportedContent(r)" ::disabled="busy">{{ __('Inhalt entfernen') }}</flux:button>
                                {{-- „Autor bannen" (banpubkey) NICHT angeboten.
                                     no removal or ban of members here — the association does not remove or
                                     ban its members (decision 2026-09-03); the timed suspension in the member
                                     menu (Buzz kind 9042) is the strongest measure this surface offers.
                                     „Inhalt entfernen" stays: it hits content, not a person. The write path
                                     stays (JS `banReportedUser`).
                                <flux:button size="xs" variant="danger" icon="no-symbol" x-on:click="banReportedUser(r)" ::disabled="busy">{{ __('Autor bannen') }}</flux:button>
                                --}}
                            </div>
                        </div>
                    </template>
                </div>

                {{-- Moderations-Historie (P1, `GET /moderation/audit`): was tatsächlich
                     getan wurde, nach Tagen gruppiert. Bis hierher war eine ausgeführte
                     Maßnahme nirgends nachlesbar — 9042/9043 werden vom Relay ausgeführt
                     und weder gespeichert noch gefanoutet, die Audit-Zeile ist der einzige
                     Beleg.

                     Eigene Insel (`nostrModerationAudit`, Begründung in ihrem Kopf); der
                     Abruf startet auf `moderation-audit-open` vom Auslöser oben.

                     **Ohne Moderationsrechte antwortet der Relay 403.** Daraus wird eine
                     leere Liste (`auditDays`), und dann steht hier NICHTS: kein
                     Fehlerzustand, und auch kein „noch keine Maßnahmen" — das wäre für
                     jemanden, der nur nicht hinsehen darf, schlicht falsch. --}}
                <div x-data="nostrModerationAudit" x-on:moderation-audit-open.window="load()">
                    <template x-if="days.length > 0">
                        <div class="space-y-3">
                            <p class="text-[0.7rem] font-semibold uppercase tracking-wider text-muted">{{ __('Moderations-Verlauf') }}</p>
                            <template x-for="d in days" :key="d.key">
                                <div class="space-y-2">
                                    <p class="text-xs font-medium text-muted" x-text="d.label"></p>
                                    <template x-for="e in d.entries" :key="e.id">
                                        <div class="surface-card space-y-1 p-3">
                                            <div class="flex flex-wrap items-center gap-2">
                                                <flux:badge size="sm"><span x-text="actionLabel(e.action)"></span></flux:badge>
                                                {{-- Betroffenes Mitglied: Klick öffnet das Profil (wie in der
                                                     Melde-Queue darüber). Bei einer Maßnahme gegen INHALT statt
                                                     gegen eine Person ist `targetPubkey` leer — dann bleibt die
                                                     Zeile bei Badge und Uhrzeit. --}}
                                                <button type="button" x-show="e.targetPubkey" x-on:click="$dispatch('open-profile', e.targetPubkey)"
                                                        class="pressable min-w-0 flex-1 truncate text-left text-sm font-medium hover:underline"
                                                        x-text="nameOf(e.targetPubkey)"></button>
                                                <span class="ms-auto shrink-0 text-xs text-muted" x-text="timeLabel(e.createdAt)"></span>
                                            </div>
                                            {{-- Der Grund, den der Moderator mitgegeben hat (`public_reason`);
                                                 fehlt er, steht dort der Maschinencode. --}}
                                            <p x-show="e.reason" x-cloak class="text-sm text-muted" x-text="e.reason"></p>
                                        </div>
                                    </template>
                                </div>
                            </template>
                        </div>
                    </template>
                </div>
            </div>
        </flux:modal>


    </div>

</x-group::app-shell>
