@props([
    // Where this instance stands: 'header' (the app header of every screen, and the room
    // list which builds its own) or 'command-bar' (the desktop bar, P6). It decides TWO
    // things and nothing else — the anchor E2E and Pest address it by, and whether the
    // instance steps aside from `xl` up.
    'place' => 'header',
])

{{-- ── The avatar: the ONE way to „Ich" (Concept C, P2) ───────────────────────────────

     It stands in the `app-header` of every surface and — because the room list builds its
     own header — explicitly once more in there. That is exactly why it is a component and
     not a block written twice: until P2 the identity lived in two places in two forms (a
     chip with a popover on `/spaces`, a row in the rail footer), and the two drifted apart
     — the popover carried shortcuts, the rail carried different ones.

     What is NO LONGER here lives on `/ich`: npub, signer, bookmarks, association, settings,
     sign out. A drawer on a single surface is not a place; „Ich" is one.

     GUEST: the same gate pattern as a nav tab. The tap opens the login sheet instead of
     navigating, intercepted in the CAPTURE phase — `wire:navigate` commits the SPA
     navigation on `mousedown` already, so a `click` handler would come too late.

     `nostrAuth` with its OWN scope, so the avatar does not depend on the page around it
     bringing one. On pages that have one themselves (settings, Ich, room list) this
     shadows correctly as an Alpine child scope — the same construction the settings hub
     uses for its sections.

     The own PRESENCE DOT reads `$store.presence?.mine` and NOT
     `byPubkey[<own pubkey>]`: the relay does not reliably fan the own 20001 back out to
     the own connection. No store, no open room → no dot, and that is the correct state
     (presence has no persistence).

     ── From P6 on there are TWO places, and only one of them shows at a time ───────────
     The desktop command bar carries the avatar (D10's „right, next to the inbox icon"),
     and the header carries it everywhere else. Both are rendered server-side, so at
     1440 px the header instance would sit some 20 px below the bar's — the same avatar
     twice in one glance, which is the drift P2 removed.

     The header instance therefore steps aside from `xl` up, **in the web host only**: the
     app never renders the command bar (see there), and on a tablet in landscape it is
     above `xl` all the same — hiding it there would leave the app without a way to „Ich".
     The host is the right question, not the width, exactly as in `bottom-nav.blade.php`.

     Both anchors stand as full literals in this file, so `grep` finds either one; a name
     assembled from `$place` would be invisible to the searches that Pest and two E2E
     suites hang on. --}}
@php($stepsAside = $place === 'header' && ! \Einundzwanzig\Group\Chassis::istApp())

<a href="{{ route(config('group.me_route', 'group.ich')) }}" wire:navigate
   x-data="nostrAuth"
   @if ($place === 'command-bar') data-command-bar-avatar @else data-app-header-avatar @endif
   :aria-label="$store.authGate?.authed
       ? @js(__('Angemeldet als :name')).split(':name').join(myName)
       : @js(__('Anmelden'))"
   x-on:mousedown.capture="$store.authGate.gateTap($event, { label: @js(__('Ich')), returnUrl: $el.pathname })"
   x-on:keydown.enter.capture="$store.authGate.gateTap($event, { label: @js(__('Ich')), returnUrl: $el.pathname })"
   {{-- `xl:hidden` as a full literal in the array and not assembled: Tailwind scans
        source text, and a class built at runtime would never exist in the built
        stylesheet — the same rule as `grid-cols-3` in `bottom-nav.blade.php`. --}}
   {{ $attributes->class([
       'pressable flex size-11 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-black/5 dark:hover:bg-white/5',
       'xl:hidden' => $stepsAside,
   ]) }}>
    <x-group::nostr-avatar picture="myPicture" name="myName" size="2.25rem" tone="accent"
                           presence="$store.presence?.mine" />
</a>
