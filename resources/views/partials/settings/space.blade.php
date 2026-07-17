{{-- ── Space & Räume (§6.5): der EINZIGE Ort zum Space-Wechsel (Single-Space). --}}
<section x-data="nostrSpaceSettings" aria-labelledby="settings-space">
    <flux:heading id="settings-space" level="2" size="sm" class="mb-2 text-muted">{{ __('Space & Räume') }}</flux:heading>
    <flux:text class="mb-2 text-xs text-muted">{{ __('Die App zeigt immer genau diesen Space.') }}</flux:text>

    {{-- Lädt noch (Fix A): Skeleton statt „leer"-Flash vor der ersten Emission. --}}
    <template x-if="!ready">
        <div class="space-y-2" aria-busy="true">
            <span class="sr-only" aria-live="polite">{{ __('Spaces werden geladen…') }}</span>
            <template x-for="i in 3" :key="i">
                <div class="surface-card flex items-center gap-3 p-3">
                    <div class="skeleton size-5"></div>
                    <div class="skeleton h-4 w-40"></div>
                </div>
            </template>
        </div>
    </template>

    <template x-if="ready && spaces.length === 0">
        <div class="surface-card empty-state p-6 text-center">
            <flux:icon.inbox class="mx-auto size-8 text-zinc-400" />
            <flux:text class="mt-2">{{ __('Du bist noch keinem Space beigetreten.') }}</flux:text>
            <flux:button :href="route('home')" wire:navigate variant="primary" icon="home" class="mt-4">
                {{ __('Zur Startseite') }}
            </flux:button>
        </div>
    </template>

    <flux:navlist x-show="ready && spaces.length > 0">
        <template x-for="s in spaces" :key="s.url">
            {{-- Aktiver Space nicht nur farbig/Haken (aria-hidden) markieren:
                 ::aria-current + sr-only-„aktiv" macht die Auswahl für
                 Screenreader hörbar (einziger Space-Wechsel-Ort, §Single-Space). --}}
            <flux:navlist.item icon="server" x-on:click="choose(s.url)"
                               ::aria-current="s.url === active ? 'true' : 'false'">
                <span class="flex w-full items-center gap-2">
                    <span class="min-w-0 flex-1">
                        <span class="block truncate" x-text="s.label"></span>
                        <span class="block truncate font-mono text-[0.7rem] text-muted" x-text="s.url.replace(/\/$/, '')"></span>
                    </span>
                    <span class="sr-only" x-show="s.url === active">{{ __('aktiv') }}</span>
                    <flux:icon.check x-show="s.url === active" class="size-4 shrink-0 text-brand-500" />
                </span>
            </flux:navlist.item>
        </template>
    </flux:navlist>

    {{-- Mitgliedschaft im aktiven Space (Space-Ebene, kind 28934/28936) --}}
    <div class="surface-card mt-2 flex items-center justify-between gap-3 p-3">
        <div class="min-w-0">
            <flux:text class="text-sm font-medium">{{ __('Mitgliedschaft') }}</flux:text>
            <div class="truncate text-xs text-muted"
                 x-text="activeJoined ? @js(__('Du bist Mitglied dieses Space.')) : (activeIsVerein ? @js(__('Zugang über Vereinsmitgliedschaft.')) : @js(__('Noch nicht beigetreten.')))"></div>
        </div>
        <flux:button size="sm" variant="primary" icon="plus"
                     x-show="!activeJoined && !activeIsVerein" x-cloak x-on:click="joinActive()" ::disabled="busy">{{ __('Beitreten') }}</flux:button>
    </div>
</section>
