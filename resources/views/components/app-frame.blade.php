@props([
    'rail' => true,
])

{{-- Das Desktop-Chassis (Plan „Desktop-Shell", P1).

     Unterhalb `xl` ist dieser Wrapper `display:contents` — er erzeugt KEINE Box.
     Das Layout darunter ist damit zeichengleich zu dem, was vor der Desktop-Shell
     hier stand; es gibt keinen zweiten Codepfad für Mobil, sondern denselben.
     Genau deshalb steht `contents` unbedingt und die Grid-Klassen bedingt: fiele
     der Wrapper unter `xl` weg, wäre jede Seite ein anderes DOM als vorher.

     Ab `xl` wird derselbe Knoten zum zweispaltigen Grid: Navigator (20rem) neben
     Bühne (Rest). `h-dvh` + `overflow-hidden` machen die Seite zur App-Fläche —
     gescrollt wird ab da INNERHALB der Spalten, nicht im Dokument.

     ── Warum `grid-rows-1` unverzichtbar ist ─────────────────────────────────
     Das Grid hat DREI Kinder im Fluss: Rail, Bühne — und die `profile-card` ganz
     unten. Die ist ein Overlay (geschlossenes `<dialog>`, 0px hoch), aber sie ist
     eben doch ein Grid-Item und wurde per Auto-Placement in eine ZWEITE, implizite
     Zeile gesetzt. Beide Zeilen sind dann `auto`, und `align-content: stretch`
     (der Default) verteilt den freien Platz GLEICHMÄSSIG auf beide: die Rail
     bekam nur ihre Inhaltshöhe plus die Hälfte des Rests und endete sichtbar vor
     dem unteren Fensterrand — gemessen 672 px statt 1291 px bei 1291 px Viewport,
     darunter der nackte Seitengrund. `grid-rows-1` (= `minmax(0,1fr)`) macht die
     erste Zeile zur einzigen, die Platz bekommt; die implizite bleibt bei 0.
     Das gilt für JEDES künftige Overlay am Ende dieses Rahmens, nicht nur für
     die Profilkarte — deshalb die Zeilenachse am Container, nicht ein Sonderweg
     an der Karte.

     ── Warum der NativePHP-Ausschluss KEIN Breakpoint ist ────────────────────
     Ein iPad Pro 12,9" quer misst 1366 CSS-px und läge damit über `xl`. Die
     Mobile-App würde dort ihren eigenen 4-Tab-Satz samt `config('group.exit')`
     in eine Desktop-Rail rendern, für die sie nie entworfen wurde. Der Host ist
     hier die richtige Frage, nicht die Breite — dasselbe Muster und derselbe
     Grund wie in `bottom-nav.blade.php` beim backdrop-blur.

     `rail=false` schaltet das Chassis pro Seite ab (Onboarding, Vollbild-Views):
     dann bleibt der Wrapper auf jeder Breite `contents`, und die Seite rendert
     exakt wie vor der Desktop-Shell.

     EIN Wurzel-Element: die Shell ist Root eines Livewire-Full-Page-SFC, und
     Livewire erlaubt nur genau eine Wurzel. `app-frame` liefert genau ein <div>. --}}
@php($desktop = $rail && ! \Einundzwanzig\Group\Chassis::istApp())

<div @class([
    'contents',
    'xl:grid xl:h-dvh xl:grid-cols-[20rem_minmax(0,1fr)] xl:grid-rows-1 xl:overflow-hidden' => $desktop,
])>
    {{-- ── Encrypted conversations: the mount is GONE from here (P3, D5) ──────────

         Until P3 this spot carried `<div x-data="nostrPrivateMessages" hidden>` — on every
         page behind the gate, so the rail group and the list on the chat area could show
         conversations and an unread number. D5 ends that: **NIP-17 wraps are decrypted only
         while „Direkt" is open.**

         Why the mount was the thing that had to go, and not just the count: the store's
         `mount()` arms the wrap subscription, and every envelope it answers with costs the
         user's signer two `nip44.decrypt` — on NIP-46 two bunker round trips, on NIP-55
         potentially two prompts on the phone. A page that shows a number for those
         conversations has already paid for it. There is no version of "count without
         decrypting": the sender sits inside the seal, `created_at` is randomised and our own
         copy of every sent message arrives as a second envelope (measured 139 ms apart), so
         even counting envelopes gives a wrong number.

         The mount now stands exactly once, inside the Direkt segment of
         `⚡updates.blade.php`, and `js/wrapIngest.ts` queues arriving wraps while no such
         segment is mounted. Everything that used to read the store here shows a neutral row
         instead (`dm-list.blade.php`, the rail group) — it leads there, it counts nothing.

         `MobileErreichbarkeitTest` holds both halves: no mount outside the Direkt segment,
         and the neutral row present on the chat area. --}}

    @if ($desktop)
        {{-- WCAG 2.4.1 (Blöcke überspringen): ab xl liegen 25+ Tab-Stopps der Rail
             vor dem eigentlichen Inhalt. Der Sprung-Link ist die einzige Tastatur-
             Abkürzung daran vorbei. Sichtbar erst bei Fokus. --}}
        <a href="#buehne"
           class="sr-only focus:not-sr-only focus:fixed focus:start-4 focus:top-4 focus:z-50 focus:rounded-tile focus:bg-white focus:px-3 focus:py-2 focus:text-sm focus:font-semibold focus:ring-2 focus:ring-accent dark:focus:bg-zinc-900">
            {{ __('Zum Inhalt springen') }}
        </a>

        {{-- Der Platzhalter steht VOR der Rail und füllt deren Spur, solange es sie
             nicht gibt (erster Paint bis Alpine-Boot). Begründung, Messwerte und
             Bauform: `rail-skelett.blade.php`. --}}
        <x-group::rail-skelett />

        <x-group::desktop-rail />
    @endif

    {{-- Die Bühne. Unterhalb xl ebenfalls `contents` — der Slot-Inhalt hängt dann
         direkt im Dokumentfluss, so wie vorher.

         ── Warum die Bühne ihre Spur AUSDRÜCKLICH nennt (`xl:col-start-2`) ─────
         Bis hierher entschied das Auto-Placement, und das rechnet mit der ANZAHL
         der Kinder im Fluss. Vor dem Alpine-Boot gibt es die Rail nicht (sie steht
         in einem `<template x-if>`), die Bühne war damit das erste Kind — und
         landete in Spur 1, den 20 rem des Navigators: `#buehne` 320 px statt 1120 px.
         **Die vollständige Messreihe steht an EINER Stelle**, im Kopf von
         `tests/e2e/desktop-boot-geometrie.spec.ts` — zusammen mit den Tests, die sie
         reproduzieren. Sie hier ein zweites Mal zu führen, hat schon einmal zu zwei
         verschiedenen Zahlenreihen in zwei Dateien geführt.

         **Heute trägt diese Zeile die Geometrie NICHT allein — und das ist gemessen,
         nicht angenommen:** entfernt man sie, bleibt die Bühne trotzdem in Spur 2,
         weil der Platzhalter oben schon als erstes Kind in Spur 1 sitzt. Rot werden
         dabei nur die Tests, die auf das Literal zielen. Sie ist also HÄRTUNG, kein
         Lastträger, und sie bleibt genau deshalb: ohne sie ruhte der Fix allein
         darauf, dass der Platzhalter das erste Kind ist — also wieder auf einer
         Reihenfolge, und genau diese Abhängigkeit war die Ursache. Ein künftiges
         Geschwister, server-gerendert und vor dem Platzhalter eingehängt, bräche es
         erneut und wieder still. Dasselbe gilt für jedes Overlay, das wie die
         `profile-card` am Ende dazukommt.

         `grid-rows-1` bleibt daneben stehen: es deckelt die IMPLIZITE Zeile, in die
         auto-platzierte Nachzügler fallen (siehe die Herleitung ganz oben). Beides
         zusammen macht Zeile UND Spalte unabhängig von der Reihenfolge. --}}
    <div @class(['contents', 'xl:col-start-2 xl:row-start-1 xl:flex xl:min-h-0 xl:flex-col xl:overflow-hidden' => $desktop])>
        @if ($desktop)
            {{-- P6/D10 — the command bar: ⌘K, the Postfach with its count, the avatar.
                 It sits at the top of the STAGE and not across both columns, so the left
                 bar keeps the full height of the window (the established desktop form:
                 places on the left, global affordances above the work).

                 Under the same condition as the rail, one line above — and therefore never
                 in the app host. Reasoning in `command-bar.blade.php`. --}}
            <x-group::command-bar />
        @endif

        {{-- ── Why the slot sits in a wrapper of its own since P6 ────────────────────
             The bar is a flex ITEM of the stage column, so everything below it may only
             claim the REMAINING height. `main#buehne` does that by itself (`xl:flex-1`),
             but `⚡room.blade.php` says `xl:h-full` — 100 % of the column, measured
             against the parent and not against what is left of it. With the bar above,
             that is the column height PLUS the bar, and the bottom of the room (the
             composer) would be clipped by the column's `overflow-hidden`.

             This wrapper is the fix with the smallest reach: it takes the remaining height
             (`xl:flex-1 xl:min-h-0`) and becomes the parent every `h-full` inside a page
             resolves against — one place instead of an audit of every page's root class.
             No `overflow-hidden` here: the column above already clips, and a second
             clipping box would be a new one for overlays that reach past the stage.

             Below `xl` it is `contents` and therefore no box at all — the same trick and
             the same reason as the frame itself: there must be no second DOM for mobile. --}}
        <div @class(['contents', 'xl:flex xl:min-h-0 xl:flex-1 xl:flex-col' => $desktop])>
            {{ $slot }}
        </div>
    </div>

    {{-- P4: Die Profilkarte stand bis hierher dreimal einzeln (Raum, Directory,
         Spaces). Die Befehlspalette adressiert Mitglieder von JEDER Seite aus —
         auf Einstellungen, Wallet und Neu wäre die Zeile sonst ein Klick ohne
         Wirkung.

         Bewusst hier und nicht im Layout: `app-frame` ist die Wurzel genau der
         Seiten, die hinter dem Gate liegen (Spaces, Directory, Updates,
         Einstellungen, Wallet, Raum) — Login und Beitritt tragen sie nicht. Das
         ist dieselbe Menge, die `EnsureNostrAuth` schützt, ohne dessen Bedingung
         ein zweites Mal auszuschreiben. Die Insel ist bis zum ersten
         `open-profile` untätig (keine Abos im `init`). --}}
    <x-group::profile-card />
</div>
