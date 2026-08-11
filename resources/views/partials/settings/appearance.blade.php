{{-- ── Darstellung (§6.6): Theme = der EINE Regler ($flux.appearance-Store,
     flackerfrei im <head>; nie hart class="dark"). --}}
<section aria-labelledby="settings-appearance">
    <flux:heading id="settings-appearance" level="2" size="sm" class="mb-2 text-muted">{{ __('Darstellung') }}</flux:heading>
    <div class="surface-card flex items-center justify-between gap-3 p-3">
        <flux:text class="text-sm font-medium">{{ __('Theme') }}</flux:text>
        <flux:radio.group x-data variant="segmented" size="sm" x-model="$flux.appearance" aria-label="{{ __('Theme') }}">
            <flux:radio value="light" icon="sun" aria-label="{{ __('Hell') }}" />
            <flux:radio value="system" icon="computer-desktop" aria-label="{{ __('Automatisch') }}" />
            <flux:radio value="dark" icon="moon" aria-label="{{ __('Dunkel') }}" />
        </flux:radio.group>
    </div>

    {{-- Zitat- und Profilkarten (P5). Eigene Insel `nostrDisplayPrefs` als Kind-Scope der
         umgebenden `nostrAuth`-Insel (dasselbe Vorgehen wie das `x-data` am Theme-Regler);
         der Schalter schreibt über `$watch` nach `localStorage` UND in den Store, an dem der
         Chat-Feed hängt. `aria-label` ist Pflicht, nicht Zierrat: ohne ihn hat der Schalter
         für `getByRole('switch', …)` keinen Namen (die Suite kennt kein `data-testid`). --}}
    <div class="surface-card mt-2 flex items-center justify-between gap-3 p-3" x-data="nostrDisplayPrefs">
        <div class="min-w-0">
            <flux:text class="text-sm font-medium">{{ __('Zitat- und Profilkarten') }}</flux:text>
            <div class="text-xs text-muted">{{ __('Verlinkte Nachrichten und Profile im Chat als Karte zeigen statt als Link.') }}</div>
        </div>
        <flux:switch x-model="quoteCards" aria-label="{{ __('Zitat- und Profilkarten') }}" />
    </div>
</section>
