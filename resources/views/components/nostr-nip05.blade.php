{{-- NIP-05-Häkchen (PLAN4 B4). `nip05` ist ein Alpine-Ausdruck (z.B. `m.nip05`),
     der den VERIFIZIERTEN Handle liefert (leer = kein Match → kein Badge). Die
     Verifizierung passiert client-seitig in welshman; hier nur die Anzeige.
     Nur das Häkchen als Default; `:label="true"` zeigt zusätzlich den Handle-Text. --}}
@props(['nip05', 'label' => false])
<span x-show="{{ $nip05 }}" x-cloak class="chip-in inline-flex min-w-0 items-center gap-1 text-brand-500"
      :title="@js(__('NIP-05 verifiziert: ')) + ({{ $nip05 }})">
    <flux:icon.check-badge variant="solid" class="size-4 shrink-0" />
    @if ($label)
        <span class="min-w-0 truncate text-xs text-muted" x-text="{{ $nip05 }}"></span>
    @endif
</span>
