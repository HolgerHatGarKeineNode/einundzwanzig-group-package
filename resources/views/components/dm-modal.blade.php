{{-- P7 — Direktnachrichten auf Buzz (Kommando-Kinds 41010/41011/41012).

     **Warum eine Komponente und kein Block in `desktop-rail.blade.php`:** dieselbe Regel
     und derselbe Grund wie beim Erinnerungs-Dialog — `flux:modal` bringt seine
     ARIA-Träger selbst mit, und neue Flächen gehören deshalb in eine eigene Datei.

     Der ganze Zustand liegt im Store `dms` (`js/dms.ts`), die Regeln in `dmModels.ts`;
     hier wird nur gelesen.

     ── P7b: kein `nostrRail`-Scope mehr ─────────────────────────────────────────
     Die Liste kam bis hierher aus `groupFor('dms')` — einer METHODE der Alpine-Komponente
     `nostrRail` (`js/rail.ts`), nicht des Stores. Damit war diese Datei nur dort mountbar,
     wo die Rail steht, und die Rail rendert der NativePHP-Host serverseitig nie
     (`app-frame.blade.php:44`). Sie liest jetzt `$store.dms.conversations`; der Store
     faltet sie mit derselben `foldDmRooms` aus `dmModels.ts`, aus der auch die Spalte
     gebaut wird — eine Wahrheit über „welche Unterhaltungen habe ich", zwei Leser.

     Nebeneffekt, der kein Verlust ist: die Liste hängt nicht mehr am FILTERTEXT der Rail.
     Über `groupFor('dms')` schrumpfte sie mit, sobald oben in der Spalte etwas im
     Suchfeld stand.

     **Gemountet ist die Komponente weiterhin nur in `desktop-rail.blade.php`.** Der Umzug
     an eine Stelle, die auf dem Telefon existiert (`einundzwanzig.blade.php` trägt dort
     `login-sheet` und `command-palette`), ist eine Designentscheidung und ab jetzt eine
     reine Blade-Zeile — dieser Datei ist der Ort gleichgültig.

     ── Was diese Fläche NICHT ist ───────────────────────────────────────────────
     Sie ist kein Chat. Ein Buzz-DM-Kanal ist ein Kanal mit einem `h`; gelesen und
     geschrieben wird er über `/rooms/{h}` mit derselben Chat-Fläche wie jeder andere
     Raum. Diese Datei eröffnet, erweitert und blendet aus — mehr nicht. --}}
<flux:modal name="dm" class="max-w-md">
    <div class="flex flex-col gap-4">
        <div class="flex items-center gap-2">
            <flux:icon.chat-bubble-left-right variant="solid" class="size-5 text-brand-500" />
            <flux:heading size="sm">
                <span x-show="$store.dms?.mode !== 'add'">{{ __('Neue Unterhaltung') }}</span>
                <span x-show="$store.dms?.mode === 'add'" x-cloak>{{ __('Person hinzufügen') }}</span>
            </flux:heading>
        </div>

        {{-- ── Die Zusage, die diese Fläche schuldet ────────────────────────────
             Ein Buzz-DM ist privat wie ein privater KANAL (Zugriffsregeln des Relays),
             nicht wie NIP-17 (Gift Wrap). Die Nachrichten liegen als gewöhnliche kind 9
             im Klartext auf dem Relay. Wer „DM" liest und Ende-zu-Ende-Verschlüsselung
             annimmt, ist von der Oberfläche in die Irre geführt worden, nicht vom Relay
             — deshalb steht der Satz hier und nicht in einer Fußnote. --}}
        <flux:text class="text-sm text-muted">{{ __('Nachrichten liegen unverschlüsselt auf diesem Relay — geschützt durch seine Zugriffsregeln, nicht durch Ende-zu-Ende-Verschlüsselung.') }}</flux:text>

        {{-- P7: since there IS an encrypted way now, the sentence above owes the reader
             the other half. Two transports live side by side — this dialog opens a Buzz
             channel, `/messages` opens a NIP-17 conversation — and a user told only that
             this one is unencrypted has been given a warning without an alternative. --}}
        <flux:text class="text-sm text-muted" data-dm-verschluesselt-hinweis>
            {{ __('Ende-zu-Ende-verschlüsselt geht es hier:') }}
            <a href="{{ route('group.messages') }}" wire:navigate class="underline hover:no-underline">{{ __('Verschlüsselt') }}</a>
        </flux:text>

        {{-- ── „Person hinzufügen" erzeugt eine NEUE Unterhaltung ────────────────
             `handle_dm_add_member` legt mit der VEREINIGTEN Teilnehmerliste einen neuen
             Kanal an, statt den alten zu erweitern („creates NEW DM — DM sets are
             immutable", `command_executor.rs:527-533`). Die bisherige Unterhaltung
             bleibt mit ihrem Verlauf bestehen. Ein Text, der das Gegenteil nahelegt,
             wäre eine Falschaussage über die Wirkung des Knopfes. --}}
        <template x-if="$store.dms?.mode === 'add'">
            <flux:callout variant="warning" icon="information-circle">
                <flux:callout.text>{{ __('Das eröffnet eine NEUE Unterhaltung mit allen Beteiligten. Die bisherige bleibt mit ihrem Verlauf bestehen — Buzz kann eine bestehende Runde nicht erweitern.') }}</flux:callout.text>
            </flux:callout>
        </template>

        {{-- Fehler des Relays, wörtlich. Gleiche Bauart wie beim Erinnerungs-Dialog:
             der Originalwortlaut ist bei einer Ablehnung die einzige ehrliche Auskunft,
             die wir haben. --}}
        <template x-if="$store.dms?.error">
            <flux:callout variant="danger" icon="exclamation-triangle">
                <flux:callout.text x-text="$store.dms.error"></flux:callout.text>
                <x-slot name="actions">
                    <flux:button size="sm" variant="ghost" x-on:click="$store.dms.dismissError()">{{ __('Verstanden') }}</flux:button>
                </x-slot>
            </flux:callout>
        </template>

        {{-- Die bereits Beteiligten, wenn eine Runde erweitert wird. Nur zum Lesen —
             entfernen kann man niemanden: der Relay kennt dafür kein Kommando, und die
             Vereinsentscheidung vom 2026-09-03 („wir entfernen keine Mitglieder")
             gälte hier ohnehin. --}}
        <template x-if="$store.dms?.mode === 'add' && $store.dms.forParticipants.length">
            <div class="flex flex-col gap-1">
                <flux:text class="text-xs font-semibold uppercase tracking-wider text-muted">{{ __('Bereits dabei') }}</flux:text>
                <p class="text-sm" x-text="$store.dms.titleOf($store.dms.forParticipants)"></p>
            </div>
        </template>

        {{-- ── Die Gewählten ────────────────────────────────────────────────────
             Als entfernbare Chips und nicht als Zeile Text: wer sich vertippt hat, muss
             genau EINEN Eintrag zurücknehmen können, ohne die Auswahl neu zu bauen. --}}
        <template x-if="($store.dms?.picked ?? []).length">
            <div class="flex flex-wrap gap-1">
                <template x-for="pk in $store.dms.picked" :key="pk">
                    <button type="button" x-on:click="$store.dms.unpick(pk)"
                            x-bind:aria-label="@js(__('“:name” aus der Auswahl nehmen')).split(':name').join($store.dms.nameOf(pk))"
                            class="pressable inline-flex min-h-6 items-center gap-1 rounded-pill bg-zinc-100 px-2 py-0.5 text-xs text-zinc-800 transition-colors hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700">
                        <span x-text="$store.dms.nameOf(pk)"></span>
                        <flux:icon.x-mark variant="micro" aria-hidden="true" class="size-3" />
                    </button>
                </template>
            </div>
        </template>

        {{-- ── Das Personenfeld ─────────────────────────────────────────────────
             Zwei Wege in dieselbe Auswahl: tippen (Name aus dem Space-Verzeichnis) oder
             einen Schlüssel einfügen (`npub1…` oder 64 Hex). Enter nimmt den Eintrag,
             wenn das Feld einen Schlüssel trägt — sonst wählt man aus der Liste
             darunter. `x-on:keydown.enter.prevent`, damit Enter nicht das Modal
             abschickt und den Dialog schließt. --}}
        <flux:field>
            <flux:label>{{ __('Person') }}</flux:label>
            <flux:input x-model="$store.dms.draft"
                        x-on:keydown.enter.prevent="$store.dms.addDraft()"
                        x-bind:disabled="$store.dms.busy || $store.dms.remaining() <= 0"
                        placeholder="{{ __('Name, npub… oder öffentlicher Schlüssel') }}" />
            <flux:description>
                <span x-show="$store.dms?.remaining() > 0"
                      x-text="@js(__('Noch :count weitere möglich (9 Beteiligte insgesamt).')).replace(':count', $store.dms?.remaining() ?? 0)"></span>
                <span x-show="$store.dms?.remaining() <= 0" x-cloak>{{ __('Mehr als 9 Beteiligte nimmt der Space nicht an.') }}</span>
            </flux:description>
        </flux:field>

        {{-- Vorschläge aus dem Space-Verzeichnis (13534/33534). Der Watch läuft nur,
             solange dieser Dialog offen ist — dieselbe Sparsamkeit wie in der
             Befehlspalette. --}}
        <template x-if="($store.dms?.suggestions() ?? []).length">
            <div class="flex max-h-48 flex-col gap-px overflow-y-auto">
                <template x-for="c in $store.dms.suggestions()" :key="c.pubkey">
                    <button type="button" x-on:click="$store.dms.pick(c.pubkey)"
                            x-bind:disabled="$store.dms.busy || $store.dms.remaining() <= 0"
                            class="pressable flex min-h-9 w-full items-center gap-2 rounded-tile px-2 text-start text-sm transition-colors hover:bg-zinc-100 disabled:opacity-50 dark:hover:bg-zinc-800">
                        <span class="inline-flex size-6 shrink-0 items-center justify-center overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                            <template x-if="c.picture">
                                <img alt="" class="size-full object-cover" x-bind:src="$img(c.picture)" />
                            </template>
                            <template x-if="!c.picture">
                                <flux:icon.user variant="micro" aria-hidden="true" class="size-3.5 text-muted" />
                            </template>
                        </span>
                        <span class="min-w-0 flex-1 truncate" x-text="c.name"></span>
                    </button>
                </template>
            </div>
        </template>

        <div class="flex justify-end gap-2">
            <flux:button variant="ghost" x-on:click="$store.dms.closeDialog()">{{ __('Abbrechen') }}</flux:button>
            {{-- `x-bind:disabled` an `busy` UND an der leeren Auswahl: `submit()` verwirft
                 beides still, und ein Knopf, der nichts tut, ist ein Blindgänger. --}}
            <flux:button variant="primary"
                         x-bind:disabled="$store.dms.busy || $store.dms.picked.length === 0"
                         x-on:click="$store.dms.submit()">
                <span x-show="$store.dms?.mode !== 'add'">{{ __('Unterhaltung eröffnen') }}</span>
                <span x-show="$store.dms?.mode === 'add'" x-cloak>{{ __('Neue Runde eröffnen') }}</span>
            </flux:button>
        </div>

        {{-- ── Die bestehenden Unterhaltungen ───────────────────────────────────
             Nur im Modus „neu": beim Erweitern einer Runde wäre eine Liste daneben eine
             zweite Handlung im selben Dialog. Die Zeilen kommen aus
             `$store.dms.conversations` — derselben Faltung (`foldDmRooms`), aus der die
             Spalte gebaut wird; ausgeblendete sind dort bereits heraus.

             Die Liste ist NUR aufgezogen, solange dieser Dialog offen ist (`openNew`
             armiert, `closeDialog` räumt ab) — dieselbe Sparsamkeit wie beim
             Space-Verzeichnis eine Blockhöhe darüber.

             Hier und nicht an der Rail-Zeile selbst: die Zeile ist EIN Knopf (ein
             verschachtelter zweiter wäre ungültiges Markup), und ein Menü, das erst beim
             Überfahren erscheint, ist auf einer 290px-Spalte mit der Tastatur schwer
             erreichbar. Zwei Handlungen an zwei Unterhaltungen im Jahr rechtfertigen
             keine eigene Mechanik in der Spalte. --}}
        <template x-if="$store.dms?.mode !== 'add' && ($store.dms?.conversations ?? []).length">
            <div class="flex flex-col gap-1 border-t border-zinc-200 pt-3 dark:border-zinc-800">
                <flux:text class="text-xs font-semibold uppercase tracking-wider text-muted">{{ __('Meine Unterhaltungen') }}</flux:text>
                <template x-for="room in $store.dms.conversations" :key="room.h">
                    <div class="flex min-h-9 items-center gap-2">
                        <span class="min-w-0 flex-1 truncate text-sm" x-text="$store.dms.displayName(room)"></span>
                        <flux:button size="sm" variant="ghost" icon="user-plus"
                                     x-bind:disabled="$store.dms.busy"
                                     x-bind:aria-label="@js(__('Person zu “:name” hinzufügen')).split(':name').join($store.dms.displayName(room))"
                                     x-on:click="$store.dms.openAdd(room.h, room.spaceUrl, room.dmParticipants ?? [])" />
                        <flux:button size="sm" variant="ghost" icon="eye-slash"
                                     x-bind:disabled="$store.dms.busy"
                                     x-bind:aria-label="@js(__('“:name” ausblenden')).split(':name').join($store.dms.displayName(room))"
                                     x-on:click="$store.dms.hide(room.h, room.spaceUrl)" />
                    </div>
                </template>
                {{-- Ausblenden löscht nichts: der Relay setzt `hidden_at` auf der eigenen
                     Mitgliedschaftszeile, die Unterhaltung bleibt für alle anderen stehen
                     und kommt zurück, sobald man dieselbe Runde erneut eröffnet. --}}
                <flux:text class="text-xs text-muted">{{ __('Ausblenden entfernt die Unterhaltung nur aus deiner Spalte — gelöscht wird nichts.') }}</flux:text>
            </div>
        </template>
    </div>
</flux:modal>
