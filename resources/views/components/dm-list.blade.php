@props([
    // Alpine expression that is true while this surface is NEEDED. It decides the
    // EXISTENCE of the node, not its visibility — see below.
    'show' => 'true',
])

{{-- ── The encrypted conversations inside the room list (mobile reachability) ──────

     ── What P8 changed here ────────────────────────────────────────────────────────
     Until P7 this spot held the list of BUZZ DM channels — a channel with an `h` whose
     messages lie in plaintext on the relay. That surface is gone; a conversation in this
     house is always a NIP-17 gift wrap from now on (`/messages`, `js/privateMessages.ts`).
     The PLACE stayed, because the reasoning for it is unchanged: the rail never renders on
     a phone, and a third tab does not fit (measurement below). What changed is the data
     source, the target and the wording.

     ── Why a SECTION of the room list and not a third tab ──────────────────────────
     The first draft was a third entry "direct" in the segmented bar. It failed on a
     measurement, not on an opinion: the bar is `inline-flex` and does not shrink, its
     three entries measure **314 px** together (per tab 32 px padding + 20 px icon + 8 px
     gap + text; text 35/49/42 px in Inconsolata 14 px), while the content column at a
     320 px viewport measures **288 px**. Result on the rendered element:
     `document.scrollWidth` 330 against `clientWidth` 320 — 10 px of horizontal overflow,
     on the main surface of the client. With two entries it is 212 px; the bar is already
     74 % full before this change.

     Three ways out were costed and rejected: dropping the icons (−84 px, fits — but takes
     back an explicit decision with a mutation-checked test, `OrtskartenTest` "threads tab
     and chat location card show different glyphs"), padding at `px-2` (fits — but loses
     against Flux' own `px-4`: both are Tailwind utilities of equal specificity, and in the
     built bundle `.px-4` sits at byte 70292, `.px-2` at 70086, so `px-4` wins), and making
     the bar scroll (an entry you have to push out of the way is not an entry point).

     ── Why there is NO unread pill here ────────────────────────────────────────────
     Until P7 `$store.unread.dmsTotal` stood here — a partition of the `rooms` map that
     counted Buzz DM CHANNELS. A NIP-17 conversation has no `h` and sits in no such map;
     there is no unread counter for it today. A pill that always reads zero would not be
     information but an empty promise — so it goes entirely instead of quietly standing at
     zero. The COUNT (how many conversations exist) stays as a grey number next to the
     heading, exactly like the neighbouring sections.

     ── `x-if` and not `xl:hidden`, although the neighbouring sections do the opposite ─
     The neighbours ("my rooms", "other rooms") hide themselves from `xl` up via CSS, with
     the explicit reasoning that an `x-if` condition would be a second truth about the
     breakpoint. For them that holds: they cost nothing while invisible.

     This section costs something — and since P8 more than before: `nostrPrivateMessages`
     holds the wrap subscription, the ONE request in the client whose answers cost the
     signer (every unwrapped envelope = two `nip44.decrypt`). **Alpine initialises
     `x-data` inside elements hidden by CSS as well** — the same trap that puts
     `desktop-rail` inside a `<template x-if>`. Hidden via `xl:hidden` every desktop view
     would pay twice: here AND in the rail, which shows the same list there. The condition
     reads `$store.viewport.desktop`, so exactly the one `matchMedia` truth from
     `viewport.ts` — not a second one.

     ── Why there is NO empty state "this space cannot do DMs" ──────────────────────
     Because a section that is not there is the more honest answer. A tab always has to
     stand and therefore explain why it is empty; a section in a list may simply be absent.
     If the reachable space cannot accept gift wraps (`canSend`, fail-closed through
     `mayWriteKind`), there are neither rows nor a button here.

     And this surface says NOTHING about encryption in detail. The promise — what stays
     hidden and what does not — lives on `/messages`, where a conversation is CREATED.
     Making the same promise in two places is how two versions of it begin. --}}
<template x-if="{{ $show }}">
    <div data-dm-panel>

        {{-- The whole section exists only when there is something to show or to do:
             rows, or the right to open a conversation. --}}
        <template x-if="($store.privateMessages?.conversations ?? []).length > 0 || $store.privateMessages?.canSend">
            <div class="mt-2">

                {{-- Section heading in the shape of its neighbours: label, count as a grey
                     number next to it. The number stands INLINE behind the label and not
                     flush right — the same decision as for "my rooms" and "other rooms",
                     and for the same reason: it describes exactly what stands right below.

                     The compose button sits right in the same row. `min-h-11` (44 px) is on
                     the ROW and not on the button: the heading keeps its height even when
                     the button is absent (no `canSend`) — otherwise the list would jump the
                     moment the NIP-11 answer arrives. --}}
                <div class="flex min-h-11 items-center justify-between gap-2 px-2">
                    <p class="flex min-w-0 items-baseline gap-1.5 text-[0.7rem] font-semibold uppercase tracking-wider text-muted">
                        <span class="truncate">{{ __('Verschlüsselt') }}</span>
                        <span x-show="($store.privateMessages?.conversations ?? []).length > 0" x-cloak
                              class="font-normal normal-case tabular-nums tracking-normal"
                              x-text="($store.privateMessages?.conversations ?? []).length"></span>
                    </p>

                    {{-- On `canSend` and not on the relay kind: the button is a WRITE
                         action, and without a signer session it would lead into a signature
                         that never comes. Icon-only with an `aria-label` — the label "new
                         conversation" costs more room next to the heading in a 288 px column
                         than it explains, and the rail carries the same glyph
                         (`pencil-square`) in the same position.

                         The person picker lives on `/messages`; the button opens it in the
                         store and jumps there. A second dialog HERE would be a second
                         version of the same surface. --}}
                    <flux:button x-show="$store.privateMessages?.canSend" x-cloak size="sm" variant="ghost"
                                 icon="pencil-square" class="icon-btn-touch shrink-0" data-dm-neu
                                 aria-label="{{ __('Neue Unterhaltung') }}"
                                 x-on:click="$store.privateMessages?.startPicking(); $store.privateMessages?.goTo()" />
                </div>

                {{-- No separate empty state when only the button stands there: the row
                     "encrypted +" already says everything a sentence would, and an empty
                     state in the middle of a list of other sections would be a second card
                     inside a card (the same rule as for the gated state and the meetup
                     filter in this card). --}}
                <div class="space-y-0.5">
                    <template x-for="row in ($store.privateMessages?.conversations ?? [])" :key="row.key">
                        {{-- `row.title` arrives finished from the store (`titleOf`), which
                             resolves the participants' profiles and warms the missing ones
                             itself. No `aria-label` on the button: its child text IS the
                             name — a label would replace it and have to rebuild it (same
                             rule as in `room-tile`).

                             The avatar deliberately gets NO picture: a conversation has
                             none, and a picture taken from the counterparty's profile would
                             be an assertion once there are three people. The initial from
                             the title distinguishes the row at a glance from the `#` tile of
                             the rooms above; the padlock in front says why it is here. --}}
                        <button type="button" data-dm-row
                                x-on:click="$store.privateMessages?.goTo(row.key)"
                                class="pressable flex min-h-11 w-full items-center gap-2.5 rounded-tile p-1.5 text-start transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800">
                            <x-group::nostr-avatar picture="''" name="row.title" size="2rem" />
                            <flux:icon.lock-closed variant="micro" aria-hidden="true" class="size-3.5 shrink-0 text-brand-500" />
                            <span class="min-w-0 flex-1 truncate font-medium" x-text="row.title"></span>
                            <flux:icon.chevron-right class="size-4 shrink-0 text-zinc-400" />
                        </button>
                    </template>
                </div>
            </div>
        </template>
    </div>
</template>
