{{-- Bottom-Nav der Hauptscreens (Räume/Mitglieder/Einstellungen), §12 mobile-
     first. Fixiert am unteren Rand, in der max-w-md-Spalte zentriert — skaliert
     auf Desktop mit. Nicht im Raum (Full-Screen-Chat) oder auf Auth-Seiten. --}}
<flux:navbar
    class="fixed inset-x-0 bottom-0 z-40 mx-auto max-w-md justify-around border-t border-zinc-200 bg-zinc-50/95 px-2 pb-safe backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/95">
    <flux:navbar.item icon="chat-bubble-left-right" :href="route('chat.spaces')" :current="request()->routeIs('chat.spaces')" wire:navigate>Räume</flux:navbar.item>
    <flux:navbar.item icon="users" :href="route('chat.directory')" :current="request()->routeIs('chat.directory')" wire:navigate>Mitglieder</flux:navbar.item>
    <flux:navbar.item icon="cog-6-tooth" :href="route('chat.space.settings')" :current="request()->routeIs('chat.space.settings')" wire:navigate>Einstellungen</flux:navbar.item>
</flux:navbar>
