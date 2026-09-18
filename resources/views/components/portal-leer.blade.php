@props([
    'icon' => 'map-pin',
    'heading' => '',
    'text' => '',
    // Einundzwanzig\Group\Portal\PortalStatus — decides WHICH empty state this is.
    'status' => null,
    // The page action that clears the filters, or null for no offer. A NAME and not a
    // boolean: the properties differ per page (`land`/`suche` here, nothing there), and a
    // `$set()` chain in the markup would put that knowledge in the wrong place.
    'reset' => null,
])

{{-- The empty state of a read-only Portal surface — and it is TWO states, not one.

     A list can be empty because the filter excludes everything (an ANSWER: „try another
     region") or because the Portal did not answer (a FAILURE: „try again"). Rendering the
     first sentence over the second is the lie this component exists to prevent — the
     reader would keep changing a filter that was never the reason.

     The failure branch therefore carries the retry action and the honest sentence; the
     answer branch carries the filter hint. `wire:click="retry"` sits on the page base
     (`GroupPortalPage::retry()`) — failures are never cached, so the re-render really is
     a new attempt. --}}
@php($offline = $status === \Einundzwanzig\Group\Portal\PortalStatus::Offline)

<div {{ $attributes->class('surface-card empty-state flex flex-col items-center gap-3 p-8 text-center') }}
     data-portal-leer="{{ $offline ? 'fehler' : 'leer' }}">
    @if ($offline)
        <flux:icon.cloud class="size-8 text-muted" aria-hidden="true" />
        <flux:heading size="lg">{{ __('Portal nicht erreichbar') }}</flux:heading>
        <flux:text class="max-w-xs text-sm text-muted">
            {{ __('Das EINUNDZWANZIG-Portal antwortet gerade nicht. Versuche es später noch einmal.') }}
        </flux:text>
        <flux:button size="sm" icon="arrow-path" wire:click="retry" data-portal-retry>
            {{ __('Erneut versuchen') }}
        </flux:button>
    @else
        <flux:icon :name="$icon" class="size-8 text-muted" aria-hidden="true" />
        <flux:heading size="lg">{{ $heading }}</flux:heading>
        @if ($text !== '')
            <flux:text class="max-w-xs text-sm text-muted">{{ $text }}</flux:text>
        @endif
        @if ($reset !== null)
            {{-- One tap out of the empty region instead of „open the select and scroll":
                 the active country filter is the app's onboarding region on first open, so
                 the emptiness is often not even a choice the user made. --}}
            <flux:button size="sm" variant="ghost" icon="x-mark" data-portal-filter-zuruecksetzen
                         wire:click="{{ $reset }}">
                {{ __('Filter zurücksetzen') }}
            </flux:button>
        @endif
    @endif
</div>
