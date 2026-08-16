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
                 selbst; defensiv gegen einen fehlenden `unread`-Store (dann '').
                 Seit P6 mit der ZAHL, und zwar der ungekappten: „150 ungelesene
                 Nachrichten" ist für einen Screenreader brauchbarer als „99+". --}}
            :aria-label="room.name + (meetup(room.meetupSlug)?.city ? ' — {{ __('Meetup in') }} ' + meetup(room.meetupSlug).city : ' — {{ __('Meetup') }}') + ($store.unread?.rooms?.[room.h] ? ', ' + $store.unread.rooms[room.h] + ($store.unread.rooms[room.h] === 1 ? ' {{ __('ungelesene Nachricht') }}' : ' {{ __('ungelesene Nachrichten') }}') : '')"
            class="pressable flex min-w-0 flex-1 items-center gap-2.5 rounded-tile p-1.5 text-left">

        {{-- Logo + Flaggen-Pin (Signatur). --}}
        <span class="relative shrink-0" x-data="{ imgOrig: false, imgBroken: false }">
            {{-- Logo vorhanden: Proxy → Original → (bei erneutem Fehler) Flagge/Initiale.
                 Original-Schritt nur bei proxyfähigem Ziel ($imgFallback, P7) — die
                 Policy des Proxys entscheidet, nicht der Ladefehler allein.

                 Zustand im Alpine-Scope und `src` GEBUNDEN statt imperativ gesetzt: das
                 `dataset`-Muster von vorher überlebte kein Re-Render des umschließenden
                 `x-for` — Alpine wendete `$img(room.picture)` erneut an, das Bild sprang
                 auf die gescheiterte Proxy-URL zurück, und der zweite Ladefehler löschte
                 es. Vollständige Herleitung samt Messung in `room-tile.blade.php`; diese
                 Kachel trug denselben Fehler zeichengleich. --}}
            <template x-if="room.picture && !imgBroken">
                <img :src="imgOrig ? room.picture : $img(room.picture)" alt=""
                     x-on:error="imgOrig ? (imgBroken = true) : ($imgFallback(room.picture) ? (imgOrig = true) : (imgBroken = true))"
                     class="size-10 rounded-tile object-cover ring-1 ring-black/5 dark:ring-white/10" />
            </template>
            {{-- Kein Logo, aber Flagge: Flagge groß als Avatar. --}}
            <template x-if="(!room.picture || imgBroken) && meetup(room.meetupSlug)?.flag">
                <span class="flex size-10 items-center justify-center rounded-tile bg-brand-500/10 text-2xl leading-none" x-text="meetup(room.meetupSlug).flag"></span>
            </template>
            {{-- Weder Logo noch Flagge (Join lädt noch): Initiale auf Brand-Tint.
                 Die Initiale ist TEXT, kein Zeichen-Ornament: 16px/600 ist keine
                 „große Schrift" im Sinne von 1.4.3 (die beginnt bei 18,66px fett),
                 also gilt 4,5:1. Auf dem Tint (`brand-500/10` über Weiß) rechnet
                 `brand-700` 4,05:1 und risse; `brand-800` rechnet 5,92:1 und ist
                 zugleich gemessen (5,91:1 am gleichen Träger der Raum-Kacheln). --}}
            <template x-if="(!room.picture || imgBroken) && !meetup(room.meetupSlug)?.flag">
                <span class="flex size-10 items-center justify-center rounded-tile bg-brand-500/10 text-base font-semibold text-brand-800 dark:text-brand-400"
                      x-text="(room.name || '#').slice(0, 1).toUpperCase()"></span>
            </template>
            {{-- Flaggen-Pin an der unteren Ecke (nur wenn ein SICHTBARES Logo da ist und
                 eine Flagge). `!imgBroken` gehört zwingend dazu: ohne das stünde bei
                 kaputtem Logo die große Flagge (Zweig oben) UND dieser Pin zugleich — die
                 Flagge doppelt an einer Kachel. Vor 2026-08-16 schaltete sich der Pin
                 selbst ab, weil der Fehlerpfad `room.picture = ''` setzte; diese Zeile ist
                 mit dem Umbau zu Recht entfallen (sie schrieb in das abgeleitete RoomView
                 zurück), und die Bedingung muss den Wegfall hier nachvollziehen. Gemessen
                 als `toHaveCount(1)` → `Received: 2`.
                 aria-hidden: das Land steht schon im aria-label des Buttons. --}}
            <template x-if="room.picture && !imgBroken && meetup(room.meetupSlug)?.flag">
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
                    {{-- „Bald"-Hervorhebung: die Farbe trägt hier das Datum, also TEXT
                         (1.4.3, ≥ 4,5:1) — `brand-700` läge auf der Kachel bei 4,40:1
                         (weiß) bzw. 4,21:1 (zinc-50), `brand-800` bei 6,42:1 / 6,15:1.
                         Das Kalender-Icon daneben erbt die Farbe und bleibt damit
                         ebenfalls über seinen 3:1. --}}
                    <span class="inline-flex shrink-0 items-center gap-1"
                          :class="isEventSoon(meetup(room.meetupSlug)?.nextEventStart || '') ? 'font-semibold text-brand-800 dark:text-brand-400' : ''">
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
             beide Kachelvarianten lesen sich dadurch gleich. §4.3: die Pille steht
             LINKS vom Schloss? Nein — hier wie dort RECHTS davon, direkt vor dem
             Chevron; die Reihenfolge Schloss→Zähler ist in beiden Kacheln dieselbe
             und war es schon beim Punkt. Eine Kachel, die als einzige umsortiert,
             bräche die Wiedererkennung, die §4.3 eigentlich meint.
             `sr=false`: der Hinweis steckt im aria-label des Buttons (siehe oben). --}}
        <x-group::unread-badge count="$store.unread?.rooms?.[room.h]" :sr="false" />
        <flux:icon.chevron-right class="size-4 shrink-0 text-zinc-400 opacity-0 transition-opacity group-hover:opacity-100" />
    </button>

    {{-- KEIN Verwalten-Menü. Diese Kachel zeigt ausschließlich Meetup-Räume, und die
         werden vom Vereins-Portal erzeugt und gepflegt (`["t","meetup"]` + `meetup_slug`).
         Ihr 39000 ist abgeleitet: wer es hier von Hand ändert oder den Raum löscht,
         bricht die Bindung zur Quelle, ohne dass die Quelle davon erfährt — beim
         nächsten Abgleich steht der Raum wieder da, nur mit widersprüchlichen Daten.
         Begründung ausführlich in `room-tile.blade.php`.

         Nur die Oberfläche, nicht das Recht: der Relay erlaubt einem Admin beides
         weiterhin. Wer es hart verhindern will, braucht eine Regel am Relay. --}}
</div>
