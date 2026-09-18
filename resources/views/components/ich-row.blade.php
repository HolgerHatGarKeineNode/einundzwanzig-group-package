@props([
    'href',
    'icon',
    'label',
    'hint' => null,
    // 'external' = leaves the client (host page, Portal): no `wire:navigate`, and the
    // destination is announced. Same rule as the area tiles on Start.
    'external' => false,
])

{{-- One row of the „Ich" page. The entries come from `config('group.ich')` and each
     renders `group::partials.ich.<key>` (or a host view behind a `view:` prefix); this
     component is the shared geometry so a host-injected row cannot look different from
     a package one.

     `min-h-14` = 56 px: comfortably above the 44 px touch target, and the same height
     the list rows of the settings hub carry. --}}
<a href="{{ $href }}" data-ich-ziel="{{ $label }}"
   @if ($external) rel="external noopener" @else wire:navigate @endif
   {{ $attributes->class('pressable flex min-h-14 items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-brand-500/5') }}>
    <span class="flex size-9 shrink-0 items-center justify-center rounded-tile bg-brand-500/10 text-brand-700 dark:text-brand-400">
        <flux:icon :name="$icon" class="size-5" />
    </span>
    <span class="min-w-0 flex-1">
        <span class="block truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">{{ $label }}</span>
        @if ($hint)
            <span class="mt-0.5 block truncate text-xs text-muted">{{ $hint }}</span>
        @endif
    </span>
    {{-- Optional slot BEFORE the chevron: a value the row carries (the wallet balance since
         P3). In the slot and not as a `value` prop, because what stands there is an Alpine
         island of the calling partial — a prop would have to be an expression the row then
         evaluates in its own scope. --}}
    {{ $trailing ?? '' }}
    @if ($external)
        <flux:icon.arrow-top-right-on-square variant="micro" class="size-4 shrink-0 text-muted" />
        <span class="sr-only">{{ __('(öffnet das Portal)') }}</span>
    @else
        <flux:icon.chevron-right class="size-4 shrink-0 text-muted" />
    @endif
</a>
