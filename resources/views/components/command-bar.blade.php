{{-- The command bar (Concept C, P6/D10) — the top edge of the desktop stage.

     Three things, left to right: the always-visible ⌘K field, the way into the Postfach
     with the count of what addresses the reader, and the avatar as the one way to „Ich".

     ── Why it exists at all, and why exactly these three ──────────────────────────────
     Until P6 the desktop answered „where else?" in three vocabularies at once (rail footer
     rows, rail nav tabs, a bell) and carried the identity in three forms. D2 cut all of
     them. What the desktop still needs and a phone solves with the bottom bar is a place
     for the three GLOBAL affordances — search, inbox, me. On a phone that is the bar at the
     bottom; here it is this strip, and the left bar next to it holds the PLACES.

     ── Why it is server-rendered and gated by CSS, not by `x-if` ───────────────────────
     `desktop-rail.blade.php` hangs in `<template x-if="$store.viewport?.desktop">` for a
     measured reason: `nostrRail` subscribes to relays, and Alpine boots an island even
     inside a CSS-hidden element, so every phone would pay for a column nobody sees there.
     This bar has no such cost — its only island is the avatar, and that one stands in the
     app header of EVERY page anyway (`me-avatar.blade.php`), so gating it would save
     nothing and buy a layout jump: an `x-if` bar does not exist until Alpine boots, and
     the stage below it would start 53 px too high and then slide down. `hidden xl:flex`
     reserves the height from the first paint, which is the whole lesson of
     `rail-skelett.blade.php` — only here it costs no placeholder.

     ── Who decides that it renders ────────────────────────────────────────────────────
     `app-frame.blade.php`, under the same condition as the rail (`$rail` and not
     `Chassis::istApp()`). The app host never gets it: on a tablet in landscape the native
     shell would otherwise show a ⌘K field on a device without a ⌘ key, next to its own
     bottom bar that already carries all three affordances. The host is the right question,
     not the width — same rule and same reason as in `bottom-nav.blade.php`. --}}
{{-- P3 (Entwurf C `screen-desktop`): die Leiste ist der 72-px-Kopf der Bühne. Die
     Maße kommen aus dem Artboard, nicht aus dem Gefühl: 72 px hoch (`xl:h-18`),
     Kante unten #242427 (`--color-border`), Grund #0b0b0c — die Leiste ist KEINE
     eigene Fläche, sie steht auf dem Seitenhintergrund; nur die Kante trennt sie.
     Der Trigger in der Mitte misst 640 × 44 (radius 12 = `--radius-tile`), ist
     surface #161617 mit Chip-Kante #2f2f33 und spricht in fg-muted #a3a3a3 —
     ein Platzhalterversprechen, kein ausgefülltes Feld. --}}
<div data-command-bar
     class="hidden shrink-0 border-b border-zinc-200 bg-white px-6 xl:grid xl:h-18 xl:grid-cols-[1fr_minmax(0,40rem)_1fr] xl:items-center dark:border-border dark:bg-zinc-950">

    {{-- The ⌘K field. A BUTTON that looks like a field, and that is deliberate: the palette
         brings its own input (`flux:command` is a `<ui-select filter>` and owns filtering,
         ↑/↓/↵ and the empty state), so a real input here would be a second text field for
         the same query — the first keystroke would have to be forwarded and the two would
         drift on every paste, IME composition and undo.

         `data-command-bar-search` and NOT `data-palette-open`: that anchor belongs to the
         centre slot of the bottom bar, which stays in the DOM at this width (`xl:hidden`).
         Two elements under one anchor make every E2E locator ambiguous in strict mode.

         The label is the palette's own placeholder, so the promise and what the reader sees
         after the click are the same sentence. Der Trigger ZENTRIERT in der Bühne
         (`flex-1 justify-center`, Breite gedeckelt auf 640 px): das Feld ist die Mitte
         der Leiste, nicht ihr erster Block — links und rechts bleibt Raum für das, was
         je Seite dazukommt. --}}
    {{-- Die linke Zelle bleibt LEER und ist trotzdem da: das Grid
         `1fr auto 1fr` zentriert den Trigger über die SYMMETRIE der beiden
         Flanken, nicht über `justify-center` in einem Rest-Container — dort
         hätte die rechte Gruppe (Postfach, Avatar) den Trigger um die halbe
         eigene Breite nach links gedrückt (gemessen −108 px Asymmetrie).
         Die leere Zelle ist die reservierte Marke-Position des Artboards;
         bis sie ein Träger hat, ist sie ehrlich leer. --}}
    <div aria-hidden="true"></div>
    <div class="flex min-w-0 justify-center">
        <button type="button" data-command-bar-search
                x-data
                x-on:click="$dispatch('open-command-palette')"
                aria-label="{{ __('Befehlspalette öffnen') }}"
                aria-haspopup="dialog"
                aria-keyshortcuts="Meta+K Control+K"
                class="pressable flex min-h-11 w-full max-w-[640px] items-center gap-2.5 rounded-tile border border-zinc-300 bg-zinc-100 px-3.5 text-start text-[15px] text-muted transition-colors hover:text-zinc-900 dark:border-border-chip dark:bg-zinc-900 dark:hover:text-zinc-100">
            <flux:icon.magnifying-glass variant="micro" aria-hidden="true" class="sw-18 size-5 shrink-0" />
            <span class="min-w-0 flex-1 truncate">{{ __('Springen, suchen, ausführen…') }}</span>
            {{-- The cap is the same class string as in the palette footer (`$kbd` there); it is
                 decoration for the shortcut the button carries in `aria-keyshortcuts`.
                 P3: Dom-Pille des Entwurfs — Kontur #3a3a3e statt Alpha-Fläche, 11 px. --}}
            <kbd aria-hidden="true"
                 class="shrink-0 rounded-pill border border-zinc-300 px-2 py-0.5 text-[11px] leading-none text-muted dark:border-border-strong">⌘K</kbd>
        </button>
    </div>

    <div class="flex shrink-0 items-center gap-2">
        {{-- ── The inbox, and the one number the desktop shows ───────────────────────
             The bell died with P2 because the Postfach became a slot of the bottom bar.
             The desktop has no such bar, so the entrance comes back here — as the icon of
             the page it leads to (`inbox`, the same icon as that slot), not as a bell.

             **What the badge counts: mentions, thread replies and due reminders — never
             conversations.** Three reasons, and only the first is thrift:
               · a number about NIP-17 wraps exists only after decrypting, and D5 forbids
                 paying that on every page (`$store.privateMessages` is mounted inside the
                 „Direkt" segment alone);
               · plain room messages are left out as well: the left bar next to this shows
                 them per room, and a total that mixes „someone wrote in #welcome" with
                 „someone wrote to YOU" makes the number unreadable;
               · so what is left is exactly what ADDRESSES the reader, which is the promise
                 of an inbox.
             The count therefore comes from `$store.unread.postfach`
             (`countAddressedUpdates`, `js/updatesView.ts`) and not from `.updates`, which
             counts every notice row including room traffic.

             Due reminders ride along WHEN they are known: `$store.reminders` is a store,
             but its `due` list fills only after a `mount()`, and mounting it here would
             nip44-decrypt every reminder on every page — the same signer bill D5 refuses
             for conversations. So the term is read defensively and contributes on the
             surfaces that mount the store anyway (Start, Postfach). Stated rather than
             hidden: elsewhere the badge is mentions + threads.

             Cap 9 and not 99 (§4.2): the number sits in a 44 px target next to an icon,
             where three digits stop being a count and become a second glyph. --}}
        {{-- The two terms stand in ONE getter and are read three times from there (label,
             pill, and the pill's own existence). Written out three times they would be
             three chances to let the spoken number and the printed one drift apart — and
             the spoken one is the half nobody notices. --}}
        <a href="{{ route('group.postfach') }}" wire:navigate data-command-bar-postfach
           x-data="{ get hints() { return ($store.unread?.postfach ?? 0) + ($store.reminders?.due?.length ?? 0) } }"
           {{-- The gate of a nav slot (D4): a guest's tap opens the login sheet instead of
                running into the server gate. In the CAPTURE phase, because `wire:navigate`
                commits the SPA navigation on `mousedown` already. --}}
           x-on:mousedown.capture="$store.authGate.gateTap($event, { label: @js(__('Postfach')), returnUrl: $el.pathname })"
           x-on:keydown.enter.capture="$store.authGate.gateTap($event, { label: @js(__('Postfach')), returnUrl: $el.pathname })"
           :aria-label="hints > 0
               ? @js(__('Postfach, :hints')).split(':hints').join($plural(hints, '1 ungelesener Hinweis', ':count ungelesene Hinweise'))
               : @js(__('Postfach'))"
           class="pressable relative flex size-11 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-black/5 dark:hover:bg-white/5">
            <flux:icon.inbox class="sw-18 size-5 text-zinc-700 dark:text-zinc-300" />
            {{-- `sr=false`: the hint is already in the `aria-label` of the link, and a
                 sr-only sibling inside a labelled link is dead markup. The ring in the page
                 background colour separates the pill from the icon. --}}
            <x-group::unread-badge count="hints" :cap="9" size="bar" :sr="false"
                                   badge-class="absolute end-1 top-1 ring-2 ring-zinc-50 dark:ring-zinc-950" />
        </a>

        {{-- The avatar, in the place the desktop expects it and in the ONE form this client
             has for it. `place=command-bar` only switches the anchor: the gate, the target
             (`config('group.me_route')`) and the presence dot stay in `me-avatar`, so there
             is no second identity affordance to drift from the header's. --}}
        <x-group::me-avatar place="command-bar" />
    </div>
</div>
