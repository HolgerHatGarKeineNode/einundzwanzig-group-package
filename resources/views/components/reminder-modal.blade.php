{{-- P5 — Erinnerungs-Dialog (NIP-ER, kind 30300).

     **Warum eine Komponente und nicht ein Block in `⚡room.blade.php`:** die Datei hat
     eine kalibrierte ARIA-Trägerzahl (`tests/Feature/EmptyStatesAndA11yTest.php`), und
     `flux:modal` bringt seine Träger selbst mit. Neue Flächen gehören deshalb in eine
     Komponente oder ein Partial — dieselbe Regel und derselbe Grund wie beim
     Lightbox-Overlay, den Ortskarten und den Forum-Blättern.

     Der ganze Zustand liegt im Store `reminders` (`js/reminders.ts`); hier wird nur
     gelesen. `nostrRoomChat` bekommt dafür kein eigenes Feld — dieselbe Bauart wie beim
     Pin und beim Lesezeichen.

     **Die Dauer-Auswahl kommt aus dem Relay, nicht aus dieser Datei.**
     `$store.reminders.delays` ist bereits gegen `limitation.max_not_before_delta` aus
     dem NIP-11-Doc gefiltert (`availableDelays` in `reminderModels.ts`). Eine hier
     ausgeschriebene Liste wäre still falsch, sobald ein Betreiber den Horizont senkt:
     der Relay lehnte das Ereignis mit `invalid: not_before too far in future` ab —
     nach dem Signatur-Prompt. Ist die Liste leer, steht der Hinweis darunter statt
     eines Knopfes, der nichts tut. --}}
<flux:modal name="reminder" class="max-w-sm">
    <div class="flex flex-col gap-3">
        <div class="flex items-center gap-2">
            <flux:icon.clock variant="solid" class="size-5 text-brand-500" />
            <flux:heading size="sm">{{ __('Erinnere mich') }}</flux:heading>
        </div>

        {{-- Die Privatheits-Zusage gehört an die Fläche, die sie gibt: der Inhalt ist
             NIP-44 an den eigenen Schlüssel verschlüsselt, der Relay sieht nur, DASS
             zu diesem Zeitpunkt etwas fällig wird. Das steht so in NIP-ER („The relay
             learns that an author has a reminder due at a time. It does not learn what
             the reminder is about.") und ist genau die Erwartung, die ein Nutzer sonst
             falsch bildet. --}}
        <flux:text class="text-sm text-muted">{{ __('Nur du kannst sie lesen — der Space kennt nur den Zeitpunkt.') }}</flux:text>

        {{-- Fehler des Relays, wörtlich. Gleiche Bauart wie Pin-Leiste und
             Lesezeichen: der Originalwortlaut ist bei einer Ablehnung die einzige
             ehrliche Auskunft, die wir haben. --}}
        <template x-if="$store.reminders?.error">
            <flux:callout variant="danger" icon="exclamation-triangle">
                <flux:callout.text x-text="$store.reminders.error"></flux:callout.text>
                <x-slot name="actions">
                    <flux:button size="sm" variant="ghost" x-on:click="$store.reminders.dismissError()">{{ __('Verstanden') }}</flux:button>
                </x-slot>
            </flux:callout>
        </template>

        <div class="flex flex-col gap-1">
            {{-- `::disabled` an `busy` — sonst ist der Eintrag ein STILLER Blindgänger:
                 `create()` verwirft einen Klick, solange ein Schreibvorgang läuft, und
                 dieses Fenster endet erst mit dem Verdikt des Relays. Dieselbe Bindung
                 wie beim Pin und beim Lesezeichen. --}}
            <template x-for="choice in ($store.reminders?.delays ?? [])" :key="choice.key">
                <flux:button variant="ghost" icon="clock" class="w-full justify-start"
                             ::disabled="$store.reminders.busy"
                             x-on:click="$store.reminders.create(choice.seconds)">
                    <span x-text="choice.label"></span>
                </flux:button>
            </template>
        </div>

        <template x-if="($store.reminders?.delays ?? []).length === 0">
            <flux:text class="text-sm text-muted">{{ __('Dieser Space nennt keinen Zeitraum für Erinnerungen.') }}</flux:text>
        </template>

        <div class="flex justify-end">
            <flux:button variant="ghost" x-on:click="$store.reminders.closeDialog()">{{ __('Abbrechen') }}</flux:button>
        </div>
    </div>
</flux:modal>
