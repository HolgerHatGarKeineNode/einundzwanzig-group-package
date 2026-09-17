{{-- ══ The shell's bottom bar — THREE slots, fixed markup (Concept C, P2) ═════════

     Start · Search · Postfach. It is no longer driven by `config('group.nav')`, and
     that registry is gone from every host with this phase.

     **Why the config went away.** The old bar iterated a per-host list and derived its
     column class from `count($items)` — three hosts published three different tab sets,
     a fourth entry silently fell back to three columns, and every screen that was not a
     tab had to justify why it was not one (the old route file is full of those
     paragraphs). A config-driven N-tab bar invites exactly that drift. The design has
     three slots; three slots are what stands here.

     **The middle slot is not a place.** Search is the one thing that reaches everything
     (D6), so it dispatches `open-command-palette` instead of navigating — the same event
     the magnifier used to send from beside the grid. It is a `button`, not a link, and
     it carries no active state: you are never "on" search.

     Fixed at the bottom, centred in the same continuous width as before. --}}

{{-- `backdrop-blur` on web only: a fixed nav with a backdrop-filter over scrolling
     content is the classic mobile-WebView scroll killer (the blur is recomputed per
     frame → stutter and black patches). On native therefore an opaque background
     without blur. --}}
@php($native = \Einundzwanzig\Group\Chassis::istApp())
<nav
    aria-label="{{ __('Hauptnavigation') }}"
    @class([
        {{-- ── EINE stetige Breite statt dreier Schwellen (P5, aus P2/6) ─────────
             Hier stand `max-w-md md:max-w-lg lg:max-w-2xl`: drei Viewport-Schwellen
             an EINEM Bauteil, neben der einen Chassis-Schwelle `xl`. Am gebauten
             Stand nachgemessen sprang die Bar dadurch zweimal — bei 768 px um
             64 px (448 → 512) und bei 1024 px um **160 px** (512 → 672). Ein
             Sprung dieser Größe in der Hauptnavigation ist keine Anpassung, den
             sieht man.

             `min(100%, clamp(28rem, 66vw, 42rem))` trifft beide alten Endwerte und
             füllt den Weg dazwischen stetig: unter 678 px liegt die alte 28-rem-
             Decke (und `min(100%,…)` gibt auf schmalen Geräten die volle Breite
             frei), ab 1018 px die alte 42-rem-Decke. Die 66 vw sind aus den alten
             Sprungpunkten gerechnet: 32rem/48rem = 66,7 %, 42rem/64rem = 65,6 %.

             Eine Container-Query wäre hier FALSCH und nicht bloß unnötig: die Bar
             ist `position: fixed`, ihr Bezugsrahmen IST das Ansichtsfenster —
             und ein Vorfahre mit `container-type` würde sie sogar aus ihm
             herausreissen. --}}
        'fixed inset-x-0 bottom-0 z-40 mx-auto w-[min(100%,clamp(28rem,66vw,42rem))] border-t border-zinc-200 px-2 pb-safe dark:border-zinc-800',
        'bg-zinc-50 dark:bg-zinc-950' => $native,
        'bg-zinc-50/90 backdrop-blur-md dark:bg-zinc-950/90' => ! $native,
        // From xl up the navigator carries the destinations vertically — two navigations
        // at once would be one too many. In the NativePHP app there is no desktop chassis
        // (see app-frame), so the bar stays there at EVERY width.
        'xl:hidden' => ! $native,
    ])
    {{-- ── The bar reports its own height; nothing else guesses it ───────────────
         A surface whose last row has to stay clear of this bar needs to know how
         tall it is. The bar adds `pb-safe` on top of its content height, so no
         constant written in another file is right for every device.

         So the bar measures ITSELF and publishes the number as `--group-nav-h` on
         `<html>`. `display: none` — the `xl:hidden` of the web host — reports 0 px
         through the same observer, so the variable also answers "is there a bar at
         all", not just "how tall is it". No consumer needs a breakpoint of its own.

         Inline instead of a module under `js/`: it is four lines that belong to
         this element, and a bundle entry for them would be harder to find than the
         element itself. --}}
    x-data="{
        beobachter: null,
        melde() {
            document.documentElement.style.setProperty('--group-nav-h', `${this.$el.offsetHeight}px`)
        },
        init() {
            this.melde()
            this.beobachter = new ResizeObserver(() => this.melde())
            this.beobachter.observe(this.$el)
        },
        destroy() {
            this.beobachter?.disconnect()
            document.documentElement.style.removeProperty('--group-nav-h')
        },
    }"
>
    {{-- `grid-cols-3` as a literal and not derived from a count: there are three
         slots, and the number is a property of the design, not of a list. --}}
    <div class="grid grid-cols-3" data-bottom-nav>
        {{-- Start is `guest`: it is the one route that renders for everyone (D4). --}}
        <x-group::nav-tab :route="config('group.start_route', 'group.start')"
                          icon="home" :label="__('Start')" gate="guest" />

        {{-- ── The centre button ────────────────────────────────────────────────
             The one search (D6). No route, no active state, no unread dot — it opens
             the command palette, which is mounted in the group layout and listens for
             this event.

             `data-palette-open` stays as the anchor the E2E specs use; it moved from
             the magnifier beside the grid into the grid itself, and the anchor is what
             makes that provable rather than guessable. --}}
        <button type="button" data-palette-open
                x-data
                x-on:click="$dispatch('open-command-palette')"
                aria-label="{{ __('Suchen und springen') }}"
                aria-haspopup="dialog"
                class="pressable relative flex min-h-14 flex-col items-center justify-center gap-1 py-2.5 text-zinc-600 active:text-zinc-800 dark:text-zinc-400 dark:active:text-zinc-200">
            <span class="relative inline-flex">
                <flux:icon.magnifying-glass class="size-6" />
            </span>
            <span class="text-[11px] font-semibold leading-none">{{ __('Suche') }}</span>
        </button>

        {{-- Postfach carries the unread dot — it is the one place that answers "is
             anything waiting anywhere". `gate=nostr`: a guest's tap opens the login
             sheet instead of running into the server gate. --}}
        <x-group::nav-tab route="group.postfach" icon="inbox"
                          :label="__('Postfach')" gate="nostr" :unread-dot="true" />
    </div>
</nav>
