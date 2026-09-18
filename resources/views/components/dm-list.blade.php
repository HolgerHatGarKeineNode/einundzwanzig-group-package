@props([
    // Alpine expression that is true while this surface is NEEDED. It decides the
    // EXISTENCE of the node, not its visibility — see below.
    'show' => 'true',
])

{{-- ── The way into the encrypted conversations, from the room list (mobile) ───────

     ── What P3 changed here, and why it is a REDUCTION ─────────────────────────────
     Until P3 this section listed the conversations themselves, with a stock number next to
     the heading and an unread pill per row. All three are gone. D5: **NIP-17 wraps are
     decrypted only while „Direkt" is open** — and a list of conversations IS the decrypted
     state. Titles come from the participants inside the seal, the preview from the message,
     the unread number from a watermark whose key is only known after decrypting. There is no
     version of this list that costs the signer nothing.

     So what stands here is one row that LEADS there and says nothing else. The price is
     named rather than hidden: from the room list you can no longer see whether something is
     waiting. The plan takes that price knowingly (D5, and the planner's default "no DM count
     and no DM preview before Direkt was opened in that tab").

     ── Why the PLACE stays ─────────────────────────────────────────────────────────
     Unchanged since P8: the rail never renders on a phone, and a third entry in the
     segmented bar does not fit — measured, not judged. The bar is `inline-flex` and does not
     shrink; three entries measure 314 px together while the content column at a 320 px
     viewport measures 288 px (`document.scrollWidth` 330 against `clientWidth` 320, i.e.
     10 px of horizontal overflow on the main surface of the client). With two entries it is
     212 px.

     ── `x-if` and not `xl:hidden` ──────────────────────────────────────────────────
     Kept, although this row no longer mounts anything expensive: the caller's condition
     carries the three parts the tests pin (`tab === 'rooms'`, `!focusMode()`,
     `!$store.viewport?.desktop`), and from `xl` up the rail carries the same entry. A CSS
     hide would render a second entry point into a column that already has one.

     ── No count, no state, no store ────────────────────────────────────────────────
     This component reads NOTHING from `$store.privateMessages` any more. That is deliberate
     and it is the enforceable half of D5: a row that reads no store cannot grow a number
     back. `MobileErreichbarkeitTest` pins both — the row is here, and the store is mounted
     nowhere but the Direkt segment. --}}
<template x-if="{{ $show }}">
    <div data-dm-panel class="mt-2">
        {{-- A plain link and not a store call: the store no longer exists on this page.
             `wire:navigate` keeps it an SPA jump; the target is the segment itself, so the
             Postfach opens on „Direkt" and mounts the surface there.

             `min-h-11` = 44 px, the same touch target the rows above carry. --}}
        <a href="{{ route('group.postfach', ['ansicht' => 'direkt']) }}" wire:navigate data-dm-oeffnen
           class="pressable flex min-h-11 w-full items-center gap-2.5 rounded-tile p-1.5 text-start transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800">
            <span class="flex size-8 shrink-0 items-center justify-center rounded-tile bg-brand-500/10">
                <flux:icon.lock-closed variant="micro" aria-hidden="true" class="size-4 text-brand-500" />
            </span>
            <span class="min-w-0 flex-1 truncate font-medium">{{ __('Verschlüsselte Nachrichten öffnen') }}</span>
            <flux:icon.chevron-right class="size-4 shrink-0 text-zinc-400" />
        </a>
    </div>
</template>
