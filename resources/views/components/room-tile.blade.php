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
             Zweistufiger Fallback: Proxy-Fehler → Original (Offline), dann → #-Chip. --}}
        {{-- Avatar im relative-Wrapper: trägt bei einem beigetretenen Meetup ein
             dezentes Flaggen-Badge an der Ecke (Land-Marker), ohne die Zeilenhöhe zu
             ändern — der Pin ist absolut positioniert. Normale Räume: kein Badge. --}}
        <span class="relative shrink-0">
            <template x-if="room.picture">
                <img :src="$img(room.picture)" :alt="room.name"
                     x-on:error="$el.dataset.orig ? (room.picture = '') : ($el.dataset.orig = 1, $el.src = room.picture)"
                     class="size-8 rounded-tile object-cover" />
            </template>
            <template x-if="!room.picture">
                <span class="flex size-8 items-center justify-center rounded-tile bg-brand-500/10 font-mono text-base font-semibold text-brand-800 transition-colors group-hover:bg-brand-500/20 dark:text-brand-400">#</span>
            </template>
            {{-- Meetup-Marker: kleines Flaggen-Badge (aria-hidden — der Raumname trägt
                 die Info; Join lädt async → null-tolerant, Badge erscheint dann). --}}
            <template x-if="room.isMeetup && meetup(room.meetupSlug)?.flag">
                <span aria-hidden="true"
                      class="absolute -bottom-0.5 -end-0.5 rounded-full bg-white text-[0.7rem] leading-none ring-2 ring-white dark:bg-zinc-900 dark:ring-zinc-900"
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
    <template x-if="isAdmin">
        <div class="shrink-0 pr-1" x-on:click.stop>
            <flux:dropdown position="bottom" align="end">
                <flux:button size="xs" variant="ghost" icon="ellipsis-vertical" class="icon-btn-touch" aria-label="{{ __('Raum verwalten') }}" />
                <flux:menu>
                    <flux:menu.item icon="pencil-square" x-on:click="openRoomEdit(room)">{{ __('Bearbeiten') }}</flux:menu.item>
                    <flux:menu.item icon="users" x-on:click="openRoomMembers(room)">{{ __('Mitglieder') }}</flux:menu.item>
                    <flux:menu.separator />
                    <flux:menu.item variant="danger" icon="trash" x-on:click="askDeleteRoom(room)">{{ __('Löschen') }}</flux:menu.item>
                </flux:menu>
            </flux:dropdown>
        </div>
    </template>
</div>
