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
     (presence has no persistence). --}}
<a href="{{ route(config('group.me_route', 'group.ich')) }}" wire:navigate
   x-data="nostrAuth" data-app-header-avatar
   :aria-label="$store.authGate?.authed
       ? @js(__('Angemeldet als :name')).split(':name').join(myName)
       : @js(__('Anmelden'))"
   x-on:mousedown.capture="$store.authGate.gateTap($event, { label: @js(__('Ich')), returnUrl: $el.pathname })"
   x-on:keydown.enter.capture="$store.authGate.gateTap($event, { label: @js(__('Ich')), returnUrl: $el.pathname })"
   {{ $attributes->class('pressable flex size-11 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-black/5 dark:hover:bg-white/5') }}>
    <x-group::nostr-avatar picture="myPicture" name="myName" size="2rem"
                           presence="$store.presence?.mine" />
</a>
