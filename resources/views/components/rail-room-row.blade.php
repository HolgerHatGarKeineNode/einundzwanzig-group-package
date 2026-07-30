{{-- Eine Raumzeile im Desktop-Navigator. Steht innerhalb eines `x-for="room in …"`
     im `nostrRail`-Scope — die Komponente nimmt bewusst keine Props: sie liest
     `room` und `activeRoomH` aus dem umschließenden Alpine-Scope, genau wie die
     Zeilen der Mobil-Liste es tun.

     ── Dichte ───────────────────────────────────────────────────────────────
     `min-h-8` statt `h-8`: bei erzwungener Zeilenhöhe (WCAG 1.4.12) muss die
     Zeile wachsen dürfen, sonst wird der Text abgeschnitten. 32px ist die
     Desktop-Dichte; die 44px-Zielgröße gilt weiterhin, aber gebunden an
     `(pointer: coarse)` in `theme.css` — sie ist eine Zeiger-, keine Breitenfrage.

     ── Aktiver Zustand: Fläche + Gewicht + Balken, KEIN Markentext ──────────
     `brand-800` auf `bg-brand-500/10` liegt bei 4,41:1 und damit unter 4,5:1
     (im Repo gemessen, siehe `a11y-contrast.spec.ts`). Die aktive Zeile trägt
     deshalb normale Textfarbe in kräftigerem Gewicht; die Marke steckt in der
     Fläche und im Balken links. Der Balken ist zugleich das nicht-farbliche
     Unterscheidungsmerkmal (WCAG 1.4.1) — `aria-current` trägt es für
     Screenreader. --}}
<button type="button" x-on:click="openRoom(room.h)"
        :aria-current="room.h === activeRoomH ? 'page' : null"
        class="pressable relative flex min-h-8 w-full items-center gap-2 rounded-tile px-2 py-1 text-start transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800"
        :class="room.h === activeRoomH ? 'bg-brand-500/10 font-semibold text-zinc-900 dark:text-zinc-50' : 'font-medium text-zinc-700 dark:text-zinc-300'">
    <span x-show="room.h === activeRoomH" aria-hidden="true"
          class="absolute inset-y-1 start-0 w-0.5 rounded-pill bg-brand-700 dark:bg-brand-500"></span>
    <span aria-hidden="true" class="shrink-0 font-mono text-sm text-muted">#</span>
    <span class="min-w-0 flex-1 truncate text-sm" x-text="room.name || room.h"></span>
    {{-- Schloss wie in der Mobil-Kachel: `locked` aggregiert privat/geschlossen/
         eingeschränkt. Nur Anzeige, deshalb aria-hidden — die Zeile führt ohnehin
         in den Raum, und der Relay entscheidet dort über den Zutritt. --}}
    <flux:icon.lock-closed x-show="room.locked" x-cloak variant="micro" aria-hidden="true" class="size-3.5 shrink-0 text-muted" />
    <x-group::unread-badge count="$store.unread?.rooms?.[room.h]" size="sm" :sr="false" />
</button>
