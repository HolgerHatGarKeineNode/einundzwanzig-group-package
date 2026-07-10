{{-- Raum-Kachel für die Space-Raumliste. Rein Alpine-gebunden: erwartet ein
     `room` (`{ h, name, picture, locked }`) aus dem umschließenden `x-for`-Scope.
     Raum-`picture` (kind 39000) → Avatar, sonst Brand-Hashtag-Chip (Terminal-/
     Channel-Anmutung der Marke). `locked` (NIP-29 privat/eingeschränkt) → Schloss.
     Name + Hover-Chevron; `pressable`-Feedback wie die übrigen Tiles (Directory). --}}
<button type="button"
        x-on:click="Livewire.navigate('/rooms/' + encodeURIComponent(room.h))"
        class="group pressable flex w-full items-center gap-3 rounded-tile p-2 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800">
    {{-- flux:avatar verzweigt server-seitig auf `$src` → bei reinem Alpine-Bind bliebe
         es Initialen. Darum natives `<img>` über den IMG-Proxy ($img, Zuschnitt/WebP).
         Zweistufiger Fallback: Proxy-Fehler → Original (Offline), dann → #-Chip. --}}
    <template x-if="room.picture">
        <img :src="$img(room.picture)" :alt="room.name"
             x-on:error="$el.dataset.orig ? (room.picture = '') : ($el.dataset.orig = 1, $el.src = room.picture)"
             class="size-8 shrink-0 rounded-tile object-cover" />
    </template>
    <template x-if="!room.picture">
        <span class="flex size-8 shrink-0 items-center justify-center rounded-tile bg-brand-500/10 font-mono text-base font-semibold text-brand-600 transition-colors group-hover:bg-brand-500/20 dark:text-brand-400">#</span>
    </template>
    <span class="min-w-0 flex-1 truncate font-medium" x-text="room.name"></span>
    <flux:icon.lock-closed x-show="room.locked" x-cloak class="size-4 shrink-0 text-zinc-400" aria-label="{{ __('Privater Raum') }}" />
    <flux:icon.chevron-right class="size-4 shrink-0 text-zinc-400 opacity-0 transition-opacity group-hover:opacity-100" />
</button>
