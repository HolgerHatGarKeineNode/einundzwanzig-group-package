{{-- Eine Raumzeile im Desktop-Navigator. GENAU EIN Wurzelelement — Alpine erlaubt
     in `x-for`/`x-if` nur eines, und Livewire zählt es bei der Wurzelprüfung der
     umgebenden Full-Page-Komponente mit. Der Button und die optionale Stadtzeile
     teilen sich deshalb einen Wrapper. Steht innerhalb eines `x-for="room in …"`
     im `nostrRail`-Scope — die Komponente nimmt bewusst keine Props: sie liest
     `room` und `activeRoomH` aus dem umschließenden Alpine-Scope, genau wie die
     Zeilen der Mobil-Liste es tun.

     ── Dichte ───────────────────────────────────────────────────────────────
     `min-h-8` (32px), nicht `h-8`: bei erzwungener Zeilenhöhe (WCAG 1.4.12) muss
     die Zeile wachsen dürfen. 20px ist Favicon-Maß — dort wird ein Markenzeichen
     als Farb-/Formmarke erkannt, nicht gelesen; 24px kostete zwei sichtbare Räume.
     Die 44px-Zielgröße bleibt an `(pointer: coarse)` in `theme.css` — sie ist eine
     Zeiger-, keine Breitenfrage.

     ── Mitgliedschaft ist eine Kontraststufe, keine Überschrift ─────────────
     Zwei Kanäle: Gewicht UND Helligkeit, beide ≥7:1. **Keine Opazität** — die
     risse den Kontrast. Dass „Meine/Andere" nicht mehr als Sektionslabel auftritt,
     ist der Grund, warum die Rail vier Gruppen hat statt 2 × 4 × n Zellen.

     ── Aktiver Zustand ─────────────────────────────────────────────────────
     Fläche + Gewicht + Balken, KEIN Markentext. Der Balken ist zugleich das
     nicht-farbliche Unterscheidungsmerkmal (WCAG 1.4.1), `aria-current` trägt es
     für Screenreader.

     ── Richtigstellung 2026-08-14 (P2 des Restposten-Plans) ─────────────────
     Hier stand als BEGRÜNDUNG: „`brand-800` auf `bg-brand-500/10` wurde im Repo mit
     4,41:1 gemessen und liegt damit unter 4,5:1." Die Zahl gehört zu einer anderen
     Fläche. Sie stammt aus dem Kopf des Kontrast-Ankers (`a11y-contrast.spec.ts`,
     Tab-Badge auf dem Segment-Control von `flux:tabs`), nicht von einer Rail-Zeile.
     Auf dem Rail-Grund (`bg-white`, `desktop-rail.blade.php:24`) misst dieselbe
     Paarung **5,91:1** im gerenderten Baum — gerechnet 5,92:1. Sie RISSE also nicht,
     sie trüge.
     Die Gestaltungsentscheidung „kein Markentext in der aktiven Zeile" bleibt
     trotzdem stehen: sie ist als solche zu entscheiden und wurde in diesem Auftrag
     nicht neu aufgerollt. Was fällt, ist nur ihre falsche Begründung — eine an
     Fläche A gemessene Zahl trägt keine Regel an Fläche B. --}}
<div>
<button type="button" x-on:click="openRoom(room)"
        x-bind:aria-current="room.h === activeRoomH ? 'page' : null"
        class="pressable group relative flex min-h-8 w-full items-center gap-2 rounded-tile px-2 py-1 text-start transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800"
        x-bind:class="room.h === activeRoomH
            ? 'bg-brand-500/10 font-semibold text-zinc-900 dark:text-zinc-50'
            : (room.joined ? 'font-medium text-zinc-800 dark:text-zinc-100' : 'font-normal text-muted')">

    <span x-show="room.h === activeRoomH" aria-hidden="true"
          class="absolute inset-y-1 start-0 w-0.5 rounded-pill bg-brand-700 dark:bg-brand-500"></span>

    {{-- Logo-Box: 20px, immer dieselbe Geometrie. Räume OHNE Bild zeigen exakt das
         `#` von vorher — kein getönter Chip, keine neue Form. Nur Räume MIT Bild
         tauschen das Zeichen gegen ihre Marke. Fallback-Kette wie in `room-tile`:
         Proxy → Original → `#`; der Original-Schritt nur bei proxyfähigem Ziel
         ($imgFallback, P7 — Policy schlägt Ladefehler). --}}
    <span x-data="{ imgOrig: false, imgBroken: false }"
          class="relative inline-flex size-5 shrink-0 items-center justify-center overflow-hidden rounded-md">
        <template x-if="!room.picture || imgBroken">
            <span aria-hidden="true" class="font-mono text-sm text-muted">#</span>
        </template>
        <template x-if="room.picture && !imgBroken">
            <img alt="" class="size-full object-cover"
                 x-bind:src="imgOrig ? room.picture : $img(room.picture)"
                 x-on:error="imgOrig ? (imgBroken = true) : ($imgFallback(room.picture) ? (imgOrig = true) : (imgBroken = true))" />
        </template>
    </span>

    <span class="min-w-0 flex-1 truncate text-sm" x-text="railName(room)"></span>

    {{-- Flagge RECHTS vom Namen, nicht als Eck-Pin: an einer 20px-Box läge ein Pin
         bei ~10px und wäre ein Farbfleck. Rechtsbündig entsteht eine Flaggenspalte,
         die man mit einem Blick scannt. Ausgeblendet, sobald ein Land gescopt ist —
         in einer Liste, die nur 🇩🇪 enthält, trägt 🇩🇪 keine Information. --}}
    <span x-show="roomFlag(room) && !scope.country" x-cloak aria-hidden="true"
          class="shrink-0 text-[0.875rem] leading-none" x-text="roomFlag(room)"></span>

    <flux:icon.lock-closed x-show="room.locked" x-cloak variant="micro" aria-hidden="true"
                           class="size-3.5 shrink-0 text-muted" />

    <x-group::unread-badge count="$store.unread?.rooms?.[room.h]" size="sm" :sr="false" />
</button>

{{-- Trefferbegründung: traf die Suche über die STADT und nicht über den Namen,
     steht die Stadt darunter. Ohne das findet der Nutzer eine Zeile, in der sein
     Suchwort nicht vorkommt — und traut der Suche nicht mehr. Erscheint NUR im
     Trefferfall; im Ruhezustand wäre es eine zweite Textspalte in 280px. --}}
<template x-if="cityHint(room)">
        <div class="-mt-0.5 mb-0.5 ps-9 text-[0.7rem] text-muted" x-text="cityHint(room)"></div>
    </template>
</div>
