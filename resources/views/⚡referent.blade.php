<?php

use Einundzwanzig\Group\ImageProxy;
use Einundzwanzig\Group\Portal\GroupPortalPage;
use Einundzwanzig\Group\Portal\PortalLecturerDetail;
use Illuminate\Support\Facades\View;
use Livewire\Attributes\Computed;
use Livewire\Attributes\Layout;

/**
 * `/bereich/kurse/referenten/{id}` — a lecturer's profile with their courses, read-only
 * (D9, P4).
 *
 * The address sits UNDER the courses on purpose: a lecturer is reached through their
 * teaching, and the back arrow therefore leads to the courses page with its „Referenten"
 * view already selected.
 */
new #[Layout('group::einundzwanzig')] class extends GroupPortalPage
{
    public int $referentId = 0;

    public function mount(int $id): void
    {
        $this->referentId = $id;
    }

    #[Computed]
    public function referent(): ?PortalLecturerDetail
    {
        return $this->catalog()->lecturer($this->referentId);
    }

    public function teilen(): void
    {
        $referent = $this->referent();
        if ($referent === null) {
            return;
        }

        $this->shareTarget($referent->lecturer->name, $referent->lecturer->name, $referent->portalLink ?? rtrim((string) config('group.portal_url'), '/').'/de/lecturer/'.$referent->lecturer->id);
    }

    public function render()
    {
        $referent = $this->referent();
        View::share('ogImage', $referent?->lecturer->image !== null ? url(ImageProxy::url($referent->lecturer->image, 'og')) : null);

        return $this->view()->title($referent?->lecturer->name ?? __('Referent'));
    }
}; ?>

<x-group::app-shell>

    <div class="page-enter">

        <x-group::app-header :title="$this->referent?->lecturer->name ?? __('Referent')"
                             :back="route('group.bereich.kurse', ['ansicht' => 'referenten'])" />

        <x-group::portal-status :status="$this->portalStatus()" class="mb-4" />

        @if ($this->referent === null)
            <x-group::portal-leer icon="user-group"
                                  :status="$this->portalStatus()"
                                  :heading="__('Referent nicht gefunden')"
                                  :text="__('Dieses Referenten-Profil gibt es im Portal nicht (mehr).')" />
        @else
            @php($referent = $this->referent)
            @php($person = $referent->lecturer)

            <section class="surface-card p-6" data-portal-referent-kopf="{{ $person->id }}">
                <div class="flex items-start gap-4">
                    <flux:avatar circle size="lg" src="{{ ImageProxy::url($person->image) }}" name="{{ $person->name }}" />
                    <div class="min-w-0 flex-1">
                        <flux:heading size="xl" level="1" class="break-words">{{ $person->name }}</flux:heading>
                        @if ($person->subtitle !== null)
                            <flux:text class="mt-1 text-sm text-muted">{{ $person->subtitle }}</flux:text>
                        @endif
                        @if (! $referent->active)
                            {{-- An inactive profile is still readable (its courses may be
                                 running) but says so — otherwise a visitor waits for dates
                                 that are not coming. --}}
                            <span class="mt-2 inline-block">
                                <flux:badge color="zinc" size="sm" data-portal-referent-inaktiv>{{ __('Derzeit inaktiv') }}</flux:badge>
                            </span>
                        @endif
                    </div>
                </div>
                <div class="mt-4 flex flex-wrap gap-2">
                    <flux:button size="sm" icon="share" wire:click="teilen" data-portal-teilen>
                        {{ $this->nativeShare() ? __('Teilen') : __('Link teilen') }}
                    </flux:button>
                </div>
            </section>

            @if ($referent->intro !== null || $referent->description !== null)
                <section class="surface-card mt-4 p-6">
                    <flux:heading size="lg" level="2">{{ __('Über') }}</flux:heading>
                    @if ($referent->intro !== null)
                        <flux:text class="mt-3 text-sm whitespace-pre-line">{{ $referent->intro }}</flux:text>
                    @endif
                    @if ($referent->description !== null)
                        <flux:text class="mt-3 text-sm whitespace-pre-line">{{ $referent->description }}</flux:text>
                    @endif
                </section>
            @endif

            @if ($referent->courses !== [])
                <section class="surface-card mt-4 p-6" data-portal-referent-kurse>
                    <flux:heading size="lg" level="2">{{ __('Kurse') }}</flux:heading>
                    <div class="mt-3 flex flex-col gap-2">
                        @foreach ($referent->courses as $kurs)
                            <a href="{{ route('group.bereich.kurse.show', $kurs->id) }}" wire:navigate
                               wire:key="referentenkurs-{{ $kurs->id }}"
                               class="pressable flex items-center gap-3 rounded-tile border border-zinc-200 px-4 py-3 dark:border-zinc-800">
                                <flux:avatar size="sm" src="{{ ImageProxy::url($kurs->image) }}" name="{{ $kurs->name }}" />
                                <span class="flex min-w-0 flex-1 flex-col">
                                    <span class="truncate font-medium">{{ $kurs->name }}</span>
                                    @if ($kurs->nextEvent !== null)
                                        <span class="truncate text-sm text-muted">{{ $kurs->nextEvent->translatedFormat('D, d. M · H:i') }}</span>
                                    @endif
                                </span>
                                <flux:icon.chevron-right class="size-4 shrink-0 text-zinc-400" />
                            </a>
                        @endforeach
                    </div>
                </section>
            @endif

            @if ($referent->links !== [])
                <section class="surface-card mt-4 p-6">
                    <flux:heading size="lg" level="2">{{ __('Links') }}</flux:heading>
                    <div class="mt-3 flex flex-col gap-2">
                        @foreach ($referent->links as $label => $url)
                            <button type="button" wire:click="openLink(@js($url))"
                                    wire:key="referentenlink-{{ $loop->index }}"
                                    data-portal-link="{{ $label }}"
                                    class="pressable flex items-center gap-3 rounded-tile border border-zinc-200 px-4 py-3 text-start dark:border-zinc-800">
                                <flux:icon.link class="size-5 shrink-0 text-zinc-400" aria-hidden="true" />
                                <span class="flex min-w-0 flex-col">
                                    <span class="font-semibold">{{ $label }}</span>
                                    <span class="truncate text-sm text-muted">{{ $url }}</span>
                                </span>
                            </button>
                        @endforeach
                    </div>
                </section>
            @endif

            @if ($this->detailActionsView())
                <div class="mt-4">
                    @include($this->detailActionsView(), [
                        'portalLink' => $referent->portalLink ?? '',
                        'lecturerId' => $person->id,
                    ])
                </div>
            @endif
        @endif
    </div>
</x-group::app-shell>
