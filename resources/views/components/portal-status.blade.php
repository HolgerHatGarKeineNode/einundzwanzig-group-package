@props([
    // Einundzwanzig\Group\Portal\PortalStatus
    'status' => null,
])

{{-- The ONE banner the read-only Portal pages owe their reader (D9).

     „Nothing found" and „nothing loaded" look identical on screen and mean opposite
     things. `fresh` therefore renders NOTHING (no reassuring green bar — a banner that
     always stands is a banner nobody reads), `stale` keeps the data and says it is old,
     and `offline` is only ever shown where a list still managed to render; an empty page
     says it in its empty state instead, where the reader is already looking.

     `role="status"` and not `alert`: this is a property of the page, not an event the
     reader has to act on right now. --}}
@php($needsNotice = $status !== null && $status->needsNotice())

@if ($needsNotice)
    @php($isOffline = $status === \Einundzwanzig\Group\Portal\PortalStatus::Offline)
    <div {{ $attributes->class(['flex items-start gap-3 rounded-tile px-3 py-2 text-sm',
            'bg-amber-500/10 text-amber-900 dark:text-amber-200' => ! $isOffline,
            'bg-red-500/10 text-red-900 dark:text-red-200' => $isOffline]) }}
         role="status" data-portal-status="{{ $status->value }}">
        <flux:icon.exclamation-triangle variant="micro" class="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <span class="min-w-0">
            @if ($isOffline)
                {{ __('Das Portal antwortet gerade nicht — diese Seite zeigt, was zuletzt geladen war.') }}
            @else
                {{ __('Diese Daten sind nicht aktuell — das Portal war beim letzten Abruf nicht erreichbar.') }}
            @endif
        </span>
    </div>
@endif
