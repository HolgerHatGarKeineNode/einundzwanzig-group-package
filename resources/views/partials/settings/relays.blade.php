{{-- ── Netzwerk & Relays (§6.4, read-only): NIP-65-Relayliste (kind 10002).
     Sichtbarkeit steuert die Settings-Registry (Web lässt es aus, Mobile
     schaltet es an) — kein config-@if mehr im Partial. Editor folgt. --}}
<section x-data="nostrRelays" aria-labelledby="settings-relays">
    <flux:heading id="settings-relays" level="2" size="sm" class="mb-2 text-muted">{{ __('Netzwerk & Relays') }}</flux:heading>
    <flux:text class="mb-2 text-xs text-muted">{{ __('Deine Relays (NIP-65).') }}</flux:text>

    <template x-if="loading">
        <div class="surface-card space-y-2 p-3" aria-busy="true">
            <span class="sr-only" aria-live="polite">{{ __('Relays werden geladen…') }}</span>
            <div class="skeleton h-4 w-48"></div>
            <div class="skeleton h-4 w-40"></div>
        </div>
    </template>

    <template x-if="!loading && relays.length === 0">
        <div class="surface-card p-3">
            <flux:text class="text-sm text-muted">{{ __('Keine Relay-Liste veröffentlicht.') }}</flux:text>
        </div>
    </template>

    <div class="surface-card divide-y divide-zinc-100 dark:divide-zinc-800" role="list"
         x-show="!loading && relays.length > 0" x-cloak>
        <template x-for="r in relays" :key="r.url">
            <div class="flex items-center gap-2 p-3" role="listitem">
                <flux:icon.server class="size-4 shrink-0 text-muted" />
                <span class="min-w-0 flex-1 truncate font-mono text-xs" x-text="r.url.replace(/\/$/, '')"></span>
                <span class="shrink-0 text-[0.7rem] text-muted"
                      x-text="[r.read ? @js(__('Lesen')) : null, r.write ? @js(__('Schreiben')) : null].filter(Boolean).join(' · ')"></span>
            </div>
        </template>
    </div>
</section>
