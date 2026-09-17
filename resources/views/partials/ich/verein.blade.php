{{-- Ich › Verein (D11). Without a configured association API there is nothing to
     show and nothing to join — the row disappears instead of leading into an empty
     surface (same rule as the Forge tile on Start). --}}
@if (filled(config('group.verein_api_url')))
    <x-group::ich-row :href="route('group.ich.verein')" icon="identification"
                      :label="__('Verein')" :hint="__('Mitgliedschaft und Beitrag')" />
@endif
