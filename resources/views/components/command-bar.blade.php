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
<div data-command-bar
     class="hidden shrink-0 items-center gap-3 border-b border-zinc-200 bg-white px-[clamp(2rem,2.5vw,3rem)] py-2 xl:flex dark:border-zinc-800 dark:bg-zinc-900">

    {{-- The ⌘K field. A BUTTON that looks like a field, and that is deliberate: the palette
         brings its own input (`flux:command` is a `<ui-select filter>` and owns filtering,
         ↑/↓/↵ and the empty state), so a real input here would be a second text field for
         the same query — the first keystroke would have to be forwarded and the two would
         drift on every paste, IME composition and undo.

         `data-command-bar-search` and NOT `data-palette-open`: that anchor belongs to the
         centre slot of the bottom bar, which stays in the DOM at this width (`xl:hidden`).
         Two elements under one anchor make every E2E locator ambiguous in strict mode.

         The label is the palette's own placeholder, so the promise and what the reader sees
         after the click are the same sentence. --}}
    <button type="button" data-command-bar-search
            x-data
            x-on:click="$dispatch('open-command-palette')"
            aria-label="{{ __('Befehlspalette öffnen') }}"
            aria-haspopup="dialog"
            aria-keyshortcuts="Meta+K Control+K"
            class="pressable flex min-h-9 w-full max-w-md items-center gap-2 rounded-tile bg-zinc-100 px-2.5 text-start text-sm text-muted transition-colors hover:text-zinc-900 dark:bg-zinc-800 dark:hover:text-zinc-100">
        <flux:icon.magnifying-glass variant="micro" aria-hidden="true" class="size-4 shrink-0" />
        <span class="min-w-0 flex-1 truncate">{{ __('Springen, suchen, ausführen…') }}</span>
        {{-- The cap is the same class string as in the palette footer (`$kbd` there); it is
             decoration for the shortcut the button carries in `aria-keyshortcuts`. --}}
        <kbd aria-hidden="true"
             class="shrink-0 rounded bg-black/5 px-1 py-0.5 font-mono text-xs leading-none text-muted dark:bg-white/10">⌘K</kbd>
    </button>

    <div class="ms-auto flex shrink-0 items-center gap-1">
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
            <flux:icon.inbox class="size-5 text-muted" />
            {{-- `sr=false`: the hint is already in the `aria-label` of the link, and a
                 sr-only sibling inside a labelled link is dead markup. The ring in the page
                 background colour separates the pill from the icon. --}}
            <x-group::unread-badge count="hints" :cap="9" size="sm" :sr="false"
                                   badge-class="absolute end-1.5 top-1.5 ring-2 ring-zinc-50 dark:ring-zinc-950" />
        </a>

        {{-- The avatar, in the place the desktop expects it and in the ONE form this client
             has for it. `place=command-bar` only switches the anchor: the gate, the target
             (`config('group.me_route')`) and the presence dot stay in `me-avatar`, so there
             is no second identity affordance to drift from the header's. --}}
        <x-group::me-avatar place="command-bar" />
    </div>
</div>
