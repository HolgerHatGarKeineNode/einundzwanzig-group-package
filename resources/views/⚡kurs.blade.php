<?php

use Einundzwanzig\Group\ImageProxy;
use Einundzwanzig\Group\Portal\GroupPortalPage;
use Einundzwanzig\Group\Portal\PortalCourseDetail;
use Illuminate\Support\Facades\View;
use Livewire\Attributes\Computed;
use Livewire\Attributes\Layout;

/**
 * `/bereich/kurse/{id}` — one course with its lecturer and its upcoming dates, read-only
 * (D9, P4). Guest-readable: a course date is exactly the thing somebody forwards.
 *
 * Numeric id and no slug, because the Portal's courses have none (`/api/courses/{id}`);
 * the route pins that with `whereNumber`.
 */
new #[Layout('group::einundzwanzig')] class extends GroupPortalPage
{
    public int $kursId = 0;

    public function mount(int $id): void
    {
        $this->kursId = $id;
    }

    #[Computed]
    public function kurs(): ?PortalCourseDetail
    {
        return $this->catalog()->course($this->kursId);
    }

    public function teilen(): void
    {
        $kurs = $this->kurs();
        if ($kurs === null) {
            return;
        }

        $this->shareTarget($kurs->name, $kurs->name, $kurs->portalLink ?? rtrim((string) config('group.portal_url'), '/').'/de/course/'.$kurs->id);
    }

    public function render()
    {
        $kurs = $this->kurs();
        View::share('ogImage', $kurs?->image !== null ? url(ImageProxy::url($kurs->image, 'og')) : null);

        return $this->view()->title($kurs?->name ?? __('Kurs'));
    }
}; ?>

<x-group::app-shell>

    <div class="page-enter">

        <x-group::app-header :title="$this->kurs?->name ?? __('Kurs')"
                             :back="route('group.bereich.kurse')" />

        <x-group::portal-status :status="$this->portalStatus()" class="mb-4" />

        @if ($this->kurs === null)
            <x-group::portal-leer icon="academic-cap"
                                  :status="$this->portalStatus()"
                                  :heading="__('Kurs nicht gefunden')"
                                  :text="__('Diesen Kurs gibt es im Portal nicht (mehr).')" />
        @else
            @php($kurs = $this->kurs)
            @php($portalLink = $kurs->portalLink ?? rtrim((string) config('group.portal_url'), '/').'/de/course/'.$kurs->id)

            <section class="surface-card p-6" data-portal-kurs-kopf="{{ $kurs->id }}">
                <div class="flex items-start gap-4">
                    <flux:avatar size="lg" src="{{ ImageProxy::url($kurs->image) }}" name="{{ $kurs->name }}" />
                    <div class="min-w-0 flex-1">
                        <flux:heading size="xl" level="1" class="break-words">{{ $kurs->name }}</flux:heading>
                        @if ($kurs->lecturer !== null)
                            <a href="{{ route('group.bereich.referenten.show', $kurs->lecturer->id) }}" wire:navigate
                               data-portal-kurs-referent="{{ $kurs->lecturer->id }}"
                               class="pressable mt-1 inline-flex items-center gap-2 text-sm text-muted">
                                <flux:avatar circle size="xs" src="{{ ImageProxy::url($kurs->lecturer->image) }}" name="{{ $kurs->lecturer->name }}" />
                                <span class="truncate">{{ $kurs->lecturer->name }}</span>
                            </a>
                        @endif
                    </div>
                </div>
                <div class="mt-4 flex flex-wrap gap-2">
                    <flux:button size="sm" icon="share" wire:click="teilen" data-portal-teilen>
                        {{ $this->nativeShare() ? __('Teilen') : __('Link teilen') }}
                    </flux:button>
                </div>
            </section>

            @if ($kurs->description !== null)
                <section class="surface-card mt-4 p-6">
                    <flux:heading size="lg" level="2">{{ __('Über den Kurs') }}</flux:heading>
                    {{-- Portal markdown as TEXT with its line breaks — same rule and same
                         reason as the meetup intro: foreign input, no HTML sink, no markdown
                         dependency in a package that four association views embed. --}}
                    <flux:text class="mt-3 text-sm whitespace-pre-line">{{ $kurs->description }}</flux:text>
                </section>
            @endif

            @if ($kurs->events !== [])
                <section class="surface-card mt-4 p-6" data-portal-kurs-termine>
                    <flux:heading size="lg" level="2">{{ __('Termine') }}</flux:heading>
                    <div class="mt-3 flex flex-col gap-3">
                        @foreach ($kurs->events as $termin)
                            <div wire:key="kurstermin-{{ $termin->id }}" class="flex items-center gap-3">
                                <span class="flex size-10 shrink-0 items-center justify-center rounded-tile bg-brand-500/10 text-brand-800 dark:text-brand-400">
                                    <flux:icon.calendar-days class="size-5" />
                                </span>
                                <div class="min-w-0 flex-1">
                                    <span class="font-semibold">{{ $termin->from->translatedFormat('l, d. F Y · H:i') }}</span>
                                    @if ($termin->location !== null)
                                        <flux:text class="truncate text-sm text-muted">{{ $termin->location }}</flux:text>
                                    @endif
                                </div>
                                @if ($termin->link !== null)
                                    <flux:button size="xs" variant="ghost" icon="arrow-top-right-on-square"
                                                 class="icon-btn-touch shrink-0"
                                                 wire:click="openLink(@js($termin->link))"
                                                 :aria-label="__('Zum Termin')" />
                                @endif
                            </div>
                        @endforeach
                    </div>
                </section>
            @endif

            @if ($this->detailActionsView())
                <div class="mt-4">
                    @include($this->detailActionsView(), ['portalLink' => $portalLink, 'courseId' => $kurs->id])
                </div>
            @endif
        @endif
    </div>
</x-group::app-shell>
