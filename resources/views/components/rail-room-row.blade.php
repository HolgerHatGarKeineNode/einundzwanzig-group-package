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
     Die Gestaltungsentscheidung „kein Markentext in der aktiven Zeile" blieb damals
     stehen — eine an Fläche A gemessene Zahl trägt keine Regel an Fläche B.

     ── Entscheidung 2026-08-15 (P9.1 des Restposten-Plans) ──────────────────
     Zinc bleibt; der Verzicht ist neu begründet. Die Zahl steht inzwischen fest
     (5,91:1 gerendert, 5,92:1 gerechnet — `brand-800` trüge die AA-Schwelle 4,5),
     aber sie entscheidet die Frage nicht allein: Die Rail hält ALLE Zustands-
     farben bei ≥7:1 („Mitgliedschaft ist eine Kontraststufe", Abschnitt oben;
     E36: 15,13 · 7,81 · 16,44 · 7,11). `brand-800` bliebe die einzige Zeile
     unter dem hausinternen 7:1-Ziel — die AA-Schwelle ist im Client die Grenze,
     nicht der Anspruch. Die Marke bleibt reserviert auf Balken (`brand-700`,
     1.4.11) und Tonfläche; die aktiven Nav-Tabs derselben Rail tragen dagegen
     Markentext (6,15:1) — andere Schicht (Navigation), andere Aktiv-Sprache.

     ── Stumm & angeheftet (P3, NIP-78 aus Buzz Desktop) ─────────────────────
     Beides nur im Workspace-Arm; `isMuted`/`isPinned` liefern im zooid-Arm
     immer `false` (`rail.ts`, gespeist aus `channelPrefs.ts`).

     **Stumm ist KEINE Opazität.** Buzz dimmt seine stummen Zeilen mit
     `opacity-50` (`SidebarSection.tsx:294-300`) — das ist hier verboten, siehe
     „Mitgliedschaft ist eine Kontraststufe" oben: Opazität risse den Kontrast.
     Stumm fällt deshalb auf dieselbe ≥7:1-Stufe wie „nicht beigetreten"
     (`font-normal text-muted`) und wird durch die durchgestrichene Glocke
     eindeutig — sonst wäre ein stummer Mitgliedsraum von einem fremden Raum
     nicht zu unterscheiden. Die Glocke ist zugleich das nicht-farbliche
     Merkmal (WCAG 1.4.1), der `aria-label` des Buttons trägt es für Screenreader.

     ── Korrektur 2026-08-17 (I18n-Gate) ──────────────────────────────────────
     Hier stand je ein sr-only-Fragment (`', angeheftet'` / `', stummgeschaltet'`),
     das an den sichtbaren Namen angehängt wurde — für Screenreader also dieselbe
     Verkettung wie `__('In ') . $label . __(' suchen')`, nur über den DOM statt
     über PHP zusammengesetzt: nicht in jeder Sprache ist „Name, angeheftet" die
     richtige Wortstellung, und `I18nCatalogGateTest` verbietet genau das. Die drei
     möglichen Zustände (angeheftet / stumm / beides) tragen jetzt je einen EIGENEN,
     ganzen Übersetzungsschlüssel mit `:name`-Platzhalter im `aria-label` des Buttons
     — kein Fragment, das eine andere Sprache in die deutsche Reihenfolge zwingt.
     `aria-label` ERSETZT den Kindtext des Buttons (daher `room.name`, nicht die
     gekürzte `railName(room)` — eine abgeschnittene Mitte ist für einen Screenreader
     kein Name). Ohne Pin/Stumm bleibt der aria-label-Ausdruck `null`: Alpine entfernt
     das Attribut dann ganz, und die weit häufigere unmarkierte Zeile bleibt exakt wie
     vorher (Name aus dem sichtbaren `x-text`).

     **Der Ungelesen-Zähler entfällt bei stumm.** Genau die Zahl fordert zum
     Hineinschauen auf; bliebe sie stehen, wäre die Stummschaltung Optik. Die
     Gruppen-Summe am Kopf lässt denselben Raum aus (`rail.ts groupUnread`). --}}
<div>
<button type="button" x-on:click="openRoom(room)"
        {{-- Anker fuer Tests (P7): der `h` der Zeile, sonst nirgends im Markup. Die
             Zusage „genau DIESE Kanal-Id steht jetzt in der Rail" ist ohne ihn nicht
             pruefbar — der sichtbare Name einer Unterhaltung ist der des Gegenuebers,
             nicht ihre UUID, und ein `href` hat die Zeile nicht (sie navigiert ueber
             `openRoom`, weil dabei der ephemere Space mitgesetzt wird). Kein `aria-*`,
             also auch keine Aenderung an einer kalibrierten Traegerzahl. --}}
        x-bind:data-room-h="room.h"
        x-bind:aria-current="room.h === activeRoomH ? 'page' : null"
        x-bind:aria-label="isPinned(room) && isMuted(room)
            ? @js(__(':name, angeheftet und stummgeschaltet')).split(':name').join(room.name || room.h)
            : (isPinned(room)
                ? @js(__(':name, angeheftet')).split(':name').join(room.name || room.h)
                : (isMuted(room)
                    ? @js(__(':name, stummgeschaltet')).split(':name').join(room.name || room.h)
                    : null))"
        class="pressable group relative flex min-h-8 w-full items-center gap-2 rounded-tile px-2 py-1 text-start transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800"
        x-bind:class="room.h === activeRoomH
            ? 'bg-brand-500/10 font-semibold text-zinc-900 dark:text-zinc-50'
            : (isMuted(room)
                ? 'font-normal text-muted'
                : (room.joined ? 'font-medium text-zinc-800 dark:text-zinc-100' : 'font-normal text-muted'))">

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
            <span aria-hidden="true" class="text-sm text-muted">#</span>
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
          class="shrink-0 text-sm leading-none" x-text="roomFlag(room)"></span>

    <flux:icon.lock-closed x-show="room.locked" x-cloak variant="micro" aria-hidden="true"
                           class="size-3.5 shrink-0 text-muted" />

    <template x-if="isPinned(room)">
        <span class="inline-flex shrink-0 items-center">
            <flux:icon.map-pin variant="micro" aria-hidden="true" class="size-3.5 text-muted" />
        </span>
    </template>

    <template x-if="isMuted(room)">
        <span class="inline-flex shrink-0 items-center">
            <flux:icon.bell-slash variant="micro" aria-hidden="true" class="size-3.5 text-muted" />
        </span>
    </template>

    {{-- `!isMuted(room) && …` statt eines zweiten `x-if` außen herum: der Zähler
         ist bereits ein `x-if`, und der Ausdruck ist dort die einzige Bedingung.
         Bei stumm ist er `false` → es rendert nichts, `capped()` läuft nie.

         Im Quelltext steht danach `&amp;&amp;`, nicht `&&`: `unread-badge` echot den
         Ausdruck über `{{ }}`, und das escapt. Der HTML-Parser dekodiert Entities in
         Attributwerten wieder, Alpine bekommt also `&&`. Sieht in „Seitenquelltext
         anzeigen" falsch aus, ist es nicht — hier notiert, damit es niemand
         zweimal nachschlägt. --}}
    <x-group::unread-badge count="!isMuted(room) && $store.unread?.rooms?.[room.h]" size="sm" :sr="false" />
</button>

{{-- Trefferbegründung: traf die Suche über die STADT und nicht über den Namen,
     steht die Stadt darunter. Ohne das findet der Nutzer eine Zeile, in der sein
     Suchwort nicht vorkommt — und traut der Suche nicht mehr. Erscheint NUR im
     Trefferfall; im Ruhezustand wäre es eine zweite Textspalte in 280px. --}}
<template x-if="cityHint(room)">
        <div class="-mt-0.5 mb-0.5 ps-9 text-xs text-muted" x-text="cityHint(room)"></div>
    </template>
</div>
