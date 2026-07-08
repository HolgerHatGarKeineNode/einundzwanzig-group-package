{{-- Raum-Kachel für die Space-Raumliste. Rein Alpine-gebunden: erwartet ein
     `room` (`{ h, name }`) aus dem umschließenden `x-for`-Scope. Brand-Hashtag-Chip
     (Terminal-/Channel-Anmutung der Marke) + Name + Hover-Chevron; `pressable`-Feedback
     wie die übrigen Tiles (Directory). --}}
<button type="button"
        x-on:click="Livewire.navigate('/rooms/' + encodeURIComponent(room.h))"
        class="group pressable flex w-full items-center gap-3 rounded-tile p-2 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800">
    <span class="flex size-8 shrink-0 items-center justify-center rounded-tile bg-brand-500/10 font-mono text-base font-semibold text-brand-600 transition-colors group-hover:bg-brand-500/20 dark:text-brand-400">#</span>
    <span class="min-w-0 flex-1 truncate font-medium" x-text="room.name"></span>
    <flux:icon.chevron-right class="size-4 shrink-0 text-zinc-400 opacity-0 transition-opacity group-hover:opacity-100" />
</button>
