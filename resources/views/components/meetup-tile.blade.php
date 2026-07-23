{{-- Meetup-Raum-Kachel. Wie `room-tile`, aber mit der Meetup-Signatur: das
     Länderflaggen-Emoji als PIN an der Ecke des Logos — Logo + Flagge lesen als
     eine Einheit, das Auge scannt eine lange Liste nach Land/Stadt. Kein Logo
     (41/304) → die Flagge wird selbst zum Avatar (groß, brand-getönt); fehlt auch
     die Flagge (Join lädt noch async) → Initiale. Präsentation (Flagge/Stadt/
     Termin) kommt aus `meetup(room.meetupSlug)` und ist NULL-tolerant.

     Erwartet `room` (RoomView, isMeetup=true) aus dem x-for-Scope sowie die
     nostrSpaces-Helfer `meetup`/`fmtEventDate`/`isEventSoon`/`isAdmin` etc. per
     Alpine-Expression-Scope (wie room-tile `room` nutzt — KEIN lokales x-data,
     damit Parent-Methoden zuverlässig auflösen). Rohes <button> → einfaches
     `:attr`-Binding. --}}
<div class="group flex items-center gap-1 rounded-tile hover:bg-zinc-100 dark:hover:bg-zinc-800">
    <button type="button"
            x-on:click="Livewire.navigate('/rooms/' + encodeURIComponent(room.h))"
            {{-- Der aria-label ERSETZT den Kindtext des Buttons — ein sr-only im
                 Ungelesen-Marker käme hier nie an. Darum hängt der Hinweis am Label
                 selbst; defensiv gegen einen fehlenden `unread`-Store (dann ''). --}}
            :aria-label="room.name + (meetup(room.meetupSlug)?.city ? ' — {{ __('Meetup in') }} ' + meetup(room.meetupSlug).city : ' — {{ __('Meetup') }}') + ($store.unread?.rooms?.[room.h] ? '{{ __(', ungelesene Nachrichten') }}' : '')"
            class="pressable flex min-w-0 flex-1 items-center gap-2.5 rounded-tile p-1.5 text-left">

        {{-- Logo + Flaggen-Pin (Signatur). --}}
        <span class="relative shrink-0">
            {{-- Logo vorhanden: Proxy → Original → (bei erneutem Fehler) Flagge/Initiale. --}}
            <template x-if="room.picture">
                <img :src="$img(room.picture)" alt=""
                     x-on:error="$el.dataset.orig ? (room.picture = '') : ($el.dataset.orig = 1, $el.src = room.picture)"
                     class="size-10 rounded-tile object-cover ring-1 ring-black/5 dark:ring-white/10" />
            </template>
            {{-- Kein Logo, aber Flagge: Flagge groß als Avatar. --}}
            <template x-if="!room.picture && meetup(room.meetupSlug)?.flag">
                <span class="flex size-10 items-center justify-center rounded-tile bg-brand-500/10 text-2xl leading-none" x-text="meetup(room.meetupSlug).flag"></span>
            </template>
            {{-- Weder Logo noch Flagge (Join lädt noch): Initiale auf Brand-Tint. --}}
            <template x-if="!room.picture && !meetup(room.meetupSlug)?.flag">
                <span class="flex size-10 items-center justify-center rounded-tile bg-brand-500/10 text-base font-semibold text-brand-700 dark:text-brand-400"
                      x-text="(room.name || '#').slice(0, 1).toUpperCase()"></span>
            </template>
            {{-- Flaggen-Pin an der unteren Ecke (nur wenn Logo UND Flagge da).
                 aria-hidden: das Land steht schon im aria-label des Buttons. --}}
            <template x-if="room.picture && meetup(room.meetupSlug)?.flag">
                <span aria-hidden="true"
                      class="absolute -bottom-1 -end-1 rounded-full bg-white px-0.5 text-sm leading-none ring-2 ring-white dark:bg-zinc-900 dark:ring-zinc-900"
                      x-text="meetup(room.meetupSlug).flag"></span>
            </template>
        </span>

        {{-- Name + Meta (Stadt · Termin). Hierarchie durch Kontrast: Name kräftig,
             Meta muted; „Termin bald" (≤7 Tage) trägt den einen Brand-Akzent. --}}
        <span class="min-w-0 flex-1">
            <span class="block truncate font-medium" x-text="room.name"></span>
            <span class="mt-0.5 flex items-center gap-1 text-[0.8rem] leading-tight text-muted">
                <template x-if="meetup(room.meetupSlug)?.city">
                    <span class="inline-flex min-w-0 items-center gap-1">
                        <flux:icon.map-pin class="size-3.5 shrink-0" />
                        <span class="truncate" x-text="meetup(room.meetupSlug).city"></span>
                    </span>
                </template>
                <template x-if="meetup(room.meetupSlug)?.city && fmtEventDate(meetup(room.meetupSlug)?.nextEventStart || '')">
                    <span aria-hidden="true" class="text-zinc-300 dark:text-zinc-600">·</span>
                </template>
                <template x-if="fmtEventDate(meetup(room.meetupSlug)?.nextEventStart || '')">
                    <span class="inline-flex shrink-0 items-center gap-1"
                          :class="isEventSoon(meetup(room.meetupSlug)?.nextEventStart || '') ? 'font-semibold text-brand-700 dark:text-brand-400' : ''">
                        <flux:icon.calendar-days class="size-3.5 shrink-0" />
                        <span x-text="fmtEventDate(meetup(room.meetupSlug)?.nextEventStart || '')"></span>
                    </span>
                </template>
                <template x-if="!meetup(room.meetupSlug)?.city && !fmtEventDate(meetup(room.meetupSlug)?.nextEventStart || '')">
                    <span>{{ __('Meetup') }}</span>
                </template>
            </span>
        </span>

        <flux:icon.lock-closed x-show="room.locked" x-cloak class="size-4 shrink-0 text-zinc-400" aria-label="{{ __('Privater Raum') }}" />
        {{-- Ungelesen: identische Position wie in `room-tile` (vor dem Chevron) —
             beide Kachelvarianten lesen sich dadurch gleich. `sr=false`: der
             Hinweis steckt im aria-label des Buttons (siehe oben). --}}
        <x-group::unread-dot when="$store.unread?.rooms?.[room.h]" :sr="false" />
        <flux:icon.chevron-right class="size-4 shrink-0 text-zinc-400 opacity-0 transition-opacity group-hover:opacity-100" />
    </button>

    {{-- Admin-Aktionen (identisch zu room-tile): Bearbeiten/Mitglieder/Löschen. --}}
    <template x-if="isAdmin">
        <div class="shrink-0 pr-1" x-on:click.stop>
            <flux:dropdown position="bottom" align="end">
                <flux:button size="xs" variant="ghost" icon="ellipsis-vertical" class="icon-btn-touch" aria-label="{{ __('Raum verwalten') }}" />
                <flux:menu>
                    <flux:menu.item icon="pencil-square" x-on:click="openRoomEdit(room)">{{ __('Bearbeiten') }}</flux:menu.item>
                    <flux:menu.item icon="users" x-on:click="openRoomMembers(room)">{{ __('Mitglieder') }}</flux:menu.item>
                    <flux:menu.separator />
                    <flux:menu.item variant="danger" icon="trash" x-on:click="askDeleteRoom(room)">{{ __('Löschen') }}</flux:menu.item>
                </flux:menu>
            </flux:dropdown>
        </div>
    </template>
</div>
