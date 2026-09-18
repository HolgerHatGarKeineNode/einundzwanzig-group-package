<?php

use Einundzwanzig\Group\ImageProxy;
use Einundzwanzig\Group\Portal\GroupPortalPage;
use Einundzwanzig\Group\Portal\PortalCourse;
use Einundzwanzig\Group\Portal\PortalLecturer;
use Livewire\Attributes\Computed;
use Livewire\Attributes\Layout;
use Livewire\Attributes\Url;

/**
 * `/bereich/kurse` — the association's courses and lecturers, read-only (D9, P4).
 *
 * Two views behind one address (`?ansicht=kurse|referenten`): a course is taught by a
 * lecturer and a lecturer is found through their courses, so these are two ways into the
 * same body of data and not two pages. Guest-readable, like the meetups (D4).
 *
 * The search runs on the SERVER over the cached list and NOT against the Portal's
 * `?search=`: that parameter exists, but the list is small enough to filter here, and one
 * cached list beats one Portal request per keystroke (R9 — 60/min per IP for the whole
 * instance).
 */
new #[Layout('group::einundzwanzig')] class extends GroupPortalPage
{
    #[Url]
    public string $ansicht = 'kurse';

    #[Url(as: 'q')]
    public string $suche = '';

    public function mount(): void
    {
        if (! in_array($this->ansicht, ['kurse', 'referenten'], true)) {
            $this->ansicht = 'kurse';
        }
    }

    public function filterLeeren(): void
    {
        $this->suche = '';
    }

    /**
     * The courses, filtered by name and lecturer, upcoming dates first.
     *
     * @return list<PortalCourse>
     */
    #[Computed]
    public function kurse(): array
    {
        $suche = mb_strtolower(trim($this->suche));

        $rows = array_values(array_filter(
            $this->catalog()->courses(),
            static fn (PortalCourse $course): bool => $suche === ''
                || str_contains(mb_strtolower($course->name), $suche)
                || str_contains(mb_strtolower((string) $course->lecturerName), $suche),
        ));

        usort($rows, static fn (PortalCourse $a, PortalCourse $b): int =>
            [$a->nextEvent === null, $a->nextEvent?->getTimestamp() ?? 0, mb_strtolower($a->name)]
            <=> [$b->nextEvent === null, $b->nextEvent?->getTimestamp() ?? 0, mb_strtolower($b->name)]);

        return $rows;
    }

    /**
     * The lecturers, filtered by name and subtitle. Whoever has upcoming dates first —
     * the list is a way to a course, not a directory.
     *
     * @return list<PortalLecturer>
     */
    #[Computed]
    public function referenten(): array
    {
        $suche = mb_strtolower(trim($this->suche));

        $rows = array_values(array_filter(
            $this->catalog()->lecturers(),
            static fn (PortalLecturer $lecturer): bool => $suche === ''
                || str_contains(mb_strtolower($lecturer->name), $suche)
                || str_contains(mb_strtolower((string) $lecturer->subtitle), $suche),
        ));

        usort($rows, static fn (PortalLecturer $a, PortalLecturer $b): int =>
            [$a->nextEvent === null, $a->nextEvent?->getTimestamp() ?? 0, mb_strtolower($a->name)]
            <=> [$b->nextEvent === null, $b->nextEvent?->getTimestamp() ?? 0, mb_strtolower($b->name)]);

        return $rows;
    }

    public function render()
    {
        // Same reason as on the meetups page: the status banner stands above the list, and a
        // catalog that has not been asked yet reports „fresh".
        $this->ansicht === 'referenten' ? $this->referenten : $this->kurse;

        return $this->view()->title(__('Kurse'));
    }
}; ?>

<x-group::app-shell width="wide">

    <div class="page-enter">

        <x-group::app-header :title="__('Kurse')" />

        <flux:tabs wire:model.live="ansicht" variant="segmented" class="mb-4 w-full" data-seg data-kurse-ansichten>
            <flux:tab name="kurse" data-kurse-ansicht="kurse">{{ __('Kurse') }}</flux:tab>
            <flux:tab name="referenten" data-kurse-ansicht="referenten">{{ __('Referenten') }}</flux:tab>
        </flux:tabs>

        <x-group::portal-status :status="$this->portalStatus()" class="mb-4" />

        <div class="mb-4">
            <flux:input wire:model.live.debounce.300ms="suche"
                        type="search"
                        icon="magnifying-glass"
                        data-portal-suche
                        clearable
                        :aria-label="$ansicht === 'referenten' ? __('Referent suchen') : __('Kurs oder Referent suchen')"
                        :placeholder="$ansicht === 'referenten' ? __('Referent suchen …') : __('Kurs oder Referent suchen …')" />
        </div>

        @if ($ansicht === 'referenten')
            @if ($this->referenten === [])
                <x-group::portal-leer icon="user-group"
                                      :status="$this->portalStatus()"
                                      :heading="__('Keine Referenten gefunden')"
                                      :text="__('Versuche eine andere Suche.')"
                                      :reset="$suche !== '' ? 'filterLeeren' : null" />
            @else
                <div class="list-stagger flex flex-col gap-3" data-portal-referenten>
                    @foreach ($this->referenten as $referent)
                        <a href="{{ route('group.bereich.referenten.show', $referent->id) }}" wire:navigate
                           wire:key="referent-{{ $referent->id }}"
                           data-portal-referent="{{ $referent->id }}"
                           class="surface-card pressable flex items-center gap-3 p-4">
                            <flux:avatar circle src="{{ ImageProxy::url($referent->image) }}" name="{{ $referent->name }}" />
                            <span class="flex min-w-0 flex-1 flex-col gap-0.5">
                                <span class="truncate font-medium">{{ $referent->name }}</span>
                                @if ($referent->subtitle !== null)
                                    <span class="truncate text-sm text-muted">{{ $referent->subtitle }}</span>
                                @endif
                                @if ($referent->nextEvent !== null)
                                    <span class="mt-1 w-fit">
                                        <flux:badge color="orange" size="sm">{{ $referent->nextEvent->translatedFormat('D, d. M · H:i') }}</flux:badge>
                                    </span>
                                @endif
                            </span>
                            <flux:icon.chevron-right class="size-4 shrink-0 text-zinc-400" />
                        </a>
                    @endforeach
                </div>
            @endif
        @else
            @if ($this->kurse === [])
                <x-group::portal-leer icon="academic-cap"
                                      :status="$this->portalStatus()"
                                      :heading="__('Keine Kurse gefunden')"
                                      :text="__('Versuche eine andere Suche.')"
                                      :reset="$suche !== '' ? 'filterLeeren' : null" />
            @else
                <div class="list-stagger flex flex-col gap-3" data-portal-kurse>
                    @foreach ($this->kurse as $kurs)
                        <a href="{{ route('group.bereich.kurse.show', $kurs->id) }}" wire:navigate
                           wire:key="kurs-{{ $kurs->id }}"
                           data-portal-kurs="{{ $kurs->id }}"
                           class="surface-card pressable flex items-center gap-3 p-4">
                            <flux:avatar src="{{ ImageProxy::url($kurs->image) }}" name="{{ $kurs->name }}" />
                            <span class="flex min-w-0 flex-1 flex-col gap-0.5">
                                <span class="truncate font-medium">{{ $kurs->name }}</span>
                                @if ($kurs->lecturerName !== null)
                                    <span class="truncate text-sm text-muted">{{ $kurs->lecturerName }}</span>
                                @endif
                                @if ($kurs->nextEvent !== null)
                                    <span class="mt-1 w-fit">
                                        <flux:badge color="orange" size="sm">{{ $kurs->nextEvent->translatedFormat('D, d. M · H:i') }}</flux:badge>
                                    </span>
                                @endif
                            </span>
                            <flux:icon.chevron-right class="size-4 shrink-0 text-zinc-400" />
                        </a>
                    @endforeach
                </div>
            @endif
        @endif
    </div>
</x-group::app-shell>
