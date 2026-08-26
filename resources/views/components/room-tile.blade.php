{{-- Raum-Kachel für die Space-Raumliste. Rein Alpine-gebunden: erwartet ein
     `room` (RoomView: `{ h, name, about, picture, locked, isPrivate, … }`) aus dem
     umschließenden `x-for`-Scope. Raum-`picture` (kind 39000) → Avatar, sonst
     Brand-Hashtag-Chip. `locked` (NIP-29 privat/eingeschränkt) → Schloss. Für Admins
     (P4) trägt die Kachel ein „…"-Menü (Bearbeiten/Löschen) — `isAdmin`/`openRoomEdit`/
     `askDeleteRoom` liegen im umschließenden nostrSpaces-Scope; fehlt der Scope
     (Fremdnutzung), ist `isAdmin` undefined → das Menü bleibt einfach aus. Container
     statt reiner Button, damit das Dropdown NICHT als Button-in-Button verschachtelt wird. --}}
<div class="group flex items-center gap-1 rounded-tile hover:bg-zinc-100 dark:hover:bg-zinc-800">
    <button type="button"
            x-on:click="Livewire.navigate('/rooms/' + encodeURIComponent(room.h))"
            class="pressable flex min-w-0 flex-1 items-center gap-2.5 rounded-tile p-1.5 text-left">
        {{-- flux:avatar verzweigt server-seitig auf `$src` → bei reinem Alpine-Bind bliebe
              es Initialen. Darum natives `<img>` über den IMG-Proxy ($img, Zuschnitt/WebP).
              Zweistufiger Fallback: Proxy-Fehler → Original (Offline), dann → #-Chip.
              Der Original-Schritt nur, wenn der Proxy das Ziel nicht schon per POLICY
              ablehnt ($imgFallback, P7) — sonst wäre eine protokoll-relative picture-URL
              ein direkter Abruf beim Angreifer-Host. --}}
        {{-- Avatar im relative-Wrapper: trägt bei einem beigetretenen Meetup ein
              dezentes Flaggen-Badge an der Ecke (Land-Marker), ohne die Zeilenhöhe zu
              ändern — der Pin ist absolut positioniert. Normale Räume: kein Badge. --}}
        {{-- Der Fallback-Zustand lebt im Alpine-Scope, NICHT im `dataset` — und `src` wird
             gebunden statt imperativ gesetzt. Das ist der Unterschied zwischen einem Bild,
             das nach dem Rückfall stehen bleibt, und einem, das verschwindet:

             Bis 2026-08-16 stand hier `$el.dataset.orig = 1, $el.src = room.picture`. Die
             `:src`-Bindung daneben kennt das `dataset` nicht — beim nächsten Re-Render des
             umschließenden `x-for` (jede eintreffende Relay-Welle löst eins aus) wendet
             Alpine wieder `$img(room.picture)` an und schickt das Bild zurück auf die
             Proxy-URL, die gerade gescheitert war. Der zweite Ladefehler traf dann auf ein
             gesetztes `dataset.orig`, wurde als „auch das Original ist kaputt" gedeutet und
             löschte das Bild. Gemessen: 11 von 40 Läufen unter Last, mit Rekorder bis zum
             zurückspringenden `src` belegt.

             Reaktiv gebunden führt dasselbe Re-Render die Kachel in den bereits erreichten
             Zustand zurück statt an den Anfang. `imgBroken` statt `room.picture = ''`, weil
             der Fehlerpfad sonst in das abgeleitete `RoomView` zurückschreibt — ein
             Darstellungsfehler darf keine Daten verändern.

             `$imgFallback` bleibt das EINZIGE Tor zum Original (P7-Sicherheitsgrenze: eine
             protokoll-relative `picture`-URL schickte den Browser jedes Lesers sonst direkt
             zum Angreifer-Host). Der Umbau verschiebt den Aufruf, er umgeht ihn nicht. --}}
        <span class="relative shrink-0" x-data="{ imgOrig: false, imgBroken: false }">
            <template x-if="room.picture && !imgBroken">
                <img :src="imgOrig ? room.picture : $img(room.picture)" :alt="room.name"
                     x-on:error="imgOrig ? (imgBroken = true) : ($imgFallback(room.picture) ? (imgOrig = true) : (imgBroken = true))"
                     class="size-8 rounded-tile object-cover" />
            </template>
            <template x-if="!room.picture || imgBroken">
                <span class="flex size-8 items-center justify-center rounded-tile bg-brand-500/10 text-base font-semibold text-brand-800 transition-colors group-hover:bg-brand-500/20 dark:text-brand-400">#</span>
            </template>
            {{-- Meetup-Marker: kleines Flaggen-Badge (aria-hidden — der Raumname trägt
                 die Info; Join lädt async → null-tolerant, Badge erscheint dann). --}}
            <template x-if="room.isMeetup && meetup(room.meetupSlug)?.flag">
                <span aria-hidden="true"
                      class="absolute -bottom-0.5 -end-0.5 rounded-full bg-white text-xs leading-none ring-2 ring-white dark:bg-zinc-900 dark:ring-zinc-900"
                      x-text="meetup(room.meetupSlug).flag"></span>
            </template>
        </span>
        <span class="min-w-0 flex-1 truncate font-medium" x-text="room.name"></span>
        <flux:icon.lock-closed x-show="room.locked" x-cloak class="size-4 shrink-0 text-zinc-400" aria-label="{{ __('Privater Raum') }}" />
        {{-- Ungelesen: ZÄHLER-Pille rechts, vor dem Chevron (P6 §4.1, vorher Punkt).
             Der Raumname bleibt bewusst font-medium — die Zeile trägt schon Avatar,
             Flaggen-Pin, Schloss und Chevron; ein fünftes Signal machte die Liste
             unruhig, und die Ziffer ist eindeutig genug. Der Button hat KEIN
             aria-label, darum trägt der sr-only-Text der Komponente hier. --}}
        <x-group::unread-badge count="$store.unread?.rooms?.[room.h]" />
        <flux:icon.chevron-right class="size-4 shrink-0 text-zinc-400 opacity-0 transition-opacity group-hover:opacity-100" />
    </button>

    {{-- Admin-Aktionen (P4): Bearbeiten/Löschen. `.stop`, damit der Klick nicht die
         Raum-Navigation der Kachel auslöst. --}}
    {{-- KEIN Verwalten-Menü für Meetup- und Antragsräume.

         Beide werden NICHT von Hand angelegt, sondern dynamisch aus einer anderen
         Quelle erzeugt und gepflegt: Meetup-Räume tragen `["t","meetup"]` samt
         `meetup_slug` aus dem Vereins-Portal, Antragsräume `["t","project-support"]`
         samt `["i","proposal:<id>"]`. Ihr 39000 ist damit ABGELEITET — wer es hier
         von Hand bearbeitet oder den Raum löscht, bricht die Bindung zur Quelle,
         ohne dass die Quelle davon erfährt. Beim nächsten Abgleich steht der Raum
         wieder da, nur mit widersprüchlichen Daten; ein gelöschter Raum lässt einen
         Antrag ins Leere zeigen.

         Nur die Oberfläche, nicht das Recht: der Relay erlaubt einem Admin beides
         weiterhin, ein anderer Client oder `nak` kommt daran vorbei. Wer das hart
         verhindern will, braucht eine Regel am Relay — dieselbe Abgrenzung wie bei
         der Buzz-Ausblendung unten.

         Der Marker liegt am Raum (`RoomView.isMeetup` / `.isProjectSupport`,
         `js/groups.ts`), nicht an der Kachel — die Bedingung gilt deshalb überall
         gleich, egal in welcher Liste die Kachel steht. --}}
    {{-- Der Platz des Menüs wird für JEDE Zeile reserviert, sobald der Nutzer Admin
         ist — auch für die abgeleiteten Räume ohne Menü. Sonst rutschen Schloss und
         Ungelesen-Pille genau in den Zeilen nach rechts, in denen das Menü fehlt, und
         die Liste bekommt zwei verschiedene rechte Kanten (vom Nutzer gemeldet,
         2026-07-30). Ein Nicht-Admin sieht nirgends ein Menü — dort ist die Spalte
         durchgehend weg und die Kante wieder einheitlich. --}}
    <template x-if="isAdmin">
        <div class="flex min-w-11 shrink-0 items-center justify-center pr-1" x-on:click.stop>
            <template x-if="!room.isMeetup && !room.isProjectSupport">
            <flux:dropdown position="bottom" align="end">
                <flux:button size="xs" variant="ghost" icon="ellipsis-vertical" class="icon-btn-touch" aria-label="{{ __('Raum verwalten') }}" />
                {{-- „Mitglieder" und „Löschen" gibt es nur auf zooid-Spaces (`!isBuzz`):

                     * Löschen: Buzz entfernt den Raum STILL, ohne Tombstone-Event (am
                       laufenden Relay gemessen — nach einem 9008 ist das 39000 weg, aber
                       kein Lösch-Event existiert). Clients, die das 39000 gecacht haben,
                       zeigen den Raum dauerhaft weiter; beim Nutzer bereits als „alte
                       verwaiste Räume" aufgetreten. Ein Menüpunkt, dessen Wirkung bei
                       allen anderen unsichtbar bleibt, ist eine Falle.
                     * Mitglieder: auf einem Buzz-Space kommen Mitgliedschaften aus dem
                       Sync der Vereinsmitglieder (kind 9030) und dem Selbst-Beitritt —
                       eine Raum-Mitgliederliste zu pflegen führt in die Irre.

                     Nur die Oberfläche, nicht das Recht: der Relay erlaubt einem Admin
                     beides weiterhin, ein anderer Client oder `nak` kommt daran vorbei. --}}
                <flux:menu>
                    <flux:menu.item icon="pencil-square" x-on:click="openRoomEdit(room)">{{ __('Bearbeiten') }}</flux:menu.item>
                    <template x-if="!isBuzz">
                        <flux:menu.item icon="users" x-on:click="openRoomMembers(room)">{{ __('Mitglieder') }}</flux:menu.item>
                    </template>
                    <template x-if="!isBuzz">
                        <flux:menu.item variant="danger" icon="trash" x-on:click="askDeleteRoom(room)">{{ __('Löschen') }}</flux:menu.item>
                    </template>
                </flux:menu>
                </flux:dropdown>
            </template>
        </div>
    </template>
</div>
