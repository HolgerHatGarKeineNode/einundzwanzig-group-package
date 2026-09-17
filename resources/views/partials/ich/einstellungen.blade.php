{{-- `settings_route` and not `group.ich.einstellungen` hard: a host may mount the
     sections elsewhere, and this row has to follow that decision — the same config
     line the command palette reads. --}}
<x-group::ich-row :href="route(config('group.settings_route', 'group.ich.einstellungen'))" icon="cog-6-tooth"
                  :label="__('Einstellungen')" :hint="__('Konto, Space, Darstellung und Sprache')" />
