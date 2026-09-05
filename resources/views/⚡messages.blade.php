<?php

use Livewire\Attributes\Layout;
use Livewire\Component;

/**
 * Encrypted conversations (`/messages`, P7, NIP-17) as a Livewire full-page SFC.
 * A thin shell like `⚡bookmarks.blade.php`: list, permissions, read and write path all
 * live in the Alpine store `privateMessages` (js/privateMessages.ts), the pure rules next
 * to it in `js/privateMessageModels.ts`, the envelope in `js/giftWrap.ts`. No `mount()` —
 * there is nothing to prepare server-side, and there MUST be nothing: the content of this
 * page exists in cleartext only inside the browser.
 */
new #[Layout('group::einundzwanzig')] class extends Component
{
    public function render()
    {
        return $this->view()->title(__('Verschlüsselt'));
    }
}; ?>

<x-group::app-shell>

    {{-- `init`/`destroy` keep the wrap subscription alive while this screen stands — and
         ONLY while it stands. It is the one request in the client whose answers cost the
         signer (every unwrapped envelope = two `nip44.decrypt`), so it does not keep
         running in the background. The counter in `mount`/`unmount` covers the fact that
         `wire:navigate` MOUNTS the new body before it tears the old one down. --}}
    <div x-data="nostrPrivateMessages" class="page-enter">

        <x-group::app-header :title="__('Verschlüsselt')" :back="route('group.spaces')" />

        {{-- The relay's error, verbatim. Same construction as everywhere in this house:
             on a rejection the original wording is the only honest answer we have. --}}
        <template x-if="$store.privateMessages?.error">
            <flux:callout variant="danger" icon="exclamation-triangle" class="mb-3">
                <flux:callout.text x-text="$store.privateMessages?.error"></flux:callout.text>
                <x-slot name="actions">
                    <flux:button size="sm" variant="ghost" x-on:click="$store.privateMessages?.dismissError()">{{ __('Verstanden') }}</flux:button>
                </x-slot>
            </flux:callout>
        </template>

        {{-- ── The promise this surface owes ────────────────────────────────────────
             Measured on 2026-09-05 against local slots, with a positive control
             (`p7-messung-d-lesegatter.txt`): content and sender stay hidden from the
             operator as well — the envelope is signed by a throwaway key. The RECIPIENT
             is not hidden on a zooid space: there the relay answers a `{"kinds":[1059]}`
             without `#p` to every member with every envelope. Buzz refuses the same
             request.

             The sentence stands here and not in a footnote, for the same reason as the
             plaintext note on the Buzz DM dialog: a reader who sees "encrypted" and
             assumes more than holds has been misled by the surface, not by the relay. --}}
        <flux:callout variant="secondary" icon="lock-closed" class="mb-3" data-pm-zusage>
            <flux:callout.heading>{{ __('Was hier verborgen bleibt') }}</flux:callout.heading>
            <flux:callout.text>{{ __('Inhalt und Absender sieht niemand — auch der Relay-Betreiber nicht. Wer eine Nachricht bekommt, ist auf einem zooid-Space für andere Mitglieder sichtbar; auf einem Buzz-Space nicht.') }}</flux:callout.text>
        </flux:callout>

        {{-- ── Reachability (kind 10050) ────────────────────────────────────────────
             The list a FOREIGN client reads to learn where to deliver. Without it the
             transport between members of the same space still works (the space relay is
             the fallback) — interop does not.

             Buzz does not know the kind and answers `restricted: unknown event kind`
             (measured, with kind 10000 as the positive control). So instead of the button
             there is a sentence saying why — a button that cannot do anything is worse
             than no button. --}}
        <div class="surface-card mb-3 px-4 py-3" data-pm-relays>
            <h2 class="text-[0.7rem] font-semibold uppercase tracking-wider text-muted">{{ __('Wo du privat erreichbar bist') }}</h2>

            <div x-show="($store.privateMessages?.myRelays ?? []).length" x-cloak class="mt-2 flex flex-wrap gap-1">
                <template x-for="url in ($store.privateMessages?.myRelays ?? [])" :key="url">
                    <flux:badge size="sm" icon="server" x-text="url"></flux:badge>
                </template>
            </div>

            <flux:text class="mt-2 text-sm text-muted"
                       x-show="!($store.privateMessages?.myRelays ?? []).length">{{ __('Noch keine Liste veröffentlicht. Andere Clients wissen dann nicht, wohin sie dir schreiben sollen.') }}</flux:text>

            <template x-if="$store.privateMessages?.canListRelays">
                <flux:button class="mt-3" size="sm" variant="ghost" icon="paper-airplane"
                             data-pm-relay-publish
                             x-bind:disabled="$store.privateMessages?.busy"
                             x-on:click="$store.privateMessages?.publishOwnRelays()">{{ __('Diesen Space als Zustelladresse veröffentlichen') }}</flux:button>
            </template>
            <template x-if="$store.privateMessages && !$store.privateMessages.canListRelays">
                <flux:text class="mt-2 text-xs text-muted" data-pm-relay-refused>{{ __('Dieser Space nimmt die Zustellliste nicht an. Nachrichten zwischen seinen Mitgliedern funktionieren trotzdem.') }}</flux:text>
            </template>
        </div>

        {{-- ── The conversations ────────────────────────────────────────────────────
             A NIP-17 conversation is nothing but the set of its participants — there is
             no room to enter and no identifier to share. So "new" is a purely local act
             here: only the first message makes the conversation visible to anybody. --}}
        <div x-show="!$store.privateMessages?.openKey" class="surface-card overflow-hidden" data-pm-liste>

            <span class="sr-only" aria-live="polite"
                  x-text="$store.privateMessages?.ready ? '' : @js(__('Unterhaltungen werden geladen…'))"></span>

            <div class="flex items-center justify-between gap-2 border-b border-zinc-200/60 px-4 py-3 dark:border-zinc-800/60">
                <h2 class="text-[0.7rem] font-semibold uppercase tracking-wider text-muted">{{ __('Unterhaltungen') }}</h2>
                <flux:button size="sm" variant="ghost" icon="pencil-square"
                             data-pm-neu
                             x-bind:disabled="!$store.privateMessages?.canSend"
                             x-on:click="$store.privateMessages?.startPicking()">{{ __('Neu') }}</flux:button>
            </div>

            {{-- Empty: a statement rather than a white area. Server-rendered so it
                 stands from the first paint. --}}
            <div x-show="!($store.privateMessages?.conversations ?? []).length && !$store.privateMessages?.picking"
                 class="empty-state px-4 py-10 text-center">
                <flux:icon.lock-closed class="mx-auto size-8 text-zinc-400" />
                <flux:heading class="mt-2">{{ __('Noch keine verschlüsselte Unterhaltung.') }}</flux:heading>
                <flux:text class="mt-1 text-sm text-muted">{{ __('Bestehende Unterhaltungen wandern nicht hierher — sie waren nie verschlüsselt.') }}</flux:text>
            </div>

            <div x-show="($store.privateMessages?.conversations ?? []).length" x-cloak
                 class="divide-y divide-zinc-200/60 dark:divide-zinc-800/60">
                <template x-for="row in ($store.privateMessages?.conversations ?? [])" :key="row.key">
                    <button type="button" data-pm-zeile
                            x-on:click="$store.privateMessages?.openConversation(row.key)"
                            class="pressable flex min-h-14 w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-brand-500/5">
                        <flux:icon.lock-closed variant="micro" class="mt-1 size-4 shrink-0 text-brand-500" />
                        <span class="min-w-0 flex-1">
                            <span class="block truncate text-sm font-medium text-zinc-900 dark:text-zinc-100" x-text="row.title"></span>
                            <span class="mt-0.5 block truncate text-sm text-muted" x-text="row.preview"></span>
                        </span>
                        <flux:icon.chevron-right class="mt-1 size-4 shrink-0 text-muted" />
                    </button>
                </template>
            </div>
        </div>

        {{-- ── Picking people ───────────────────────────────────────────────────────
             Two ways into the same selection, as in the Buzz DM dialog: typing (a name
             from the space directory) or pasting a key. --}}
        <template x-if="$store.privateMessages?.picking">
            <div class="surface-card mt-3 px-4 py-3" data-pm-picker>
                <h2 class="text-[0.7rem] font-semibold uppercase tracking-wider text-muted">{{ __('Mit wem?') }}</h2>

                <template x-if="($store.privateMessages?.picked ?? []).length">
                    <div class="mt-2 flex flex-wrap gap-1">
                        <template x-for="pk in ($store.privateMessages?.picked ?? [])" :key="pk">
                            <button type="button" x-on:click="$store.privateMessages?.unpick(pk)"
                                    x-bind:aria-label="@js(__('“:name” aus der Auswahl nehmen')).split(':name').join($store.privateMessages?.nameOf(pk) ?? pk)"
                                    class="pressable inline-flex min-h-6 items-center gap-1 rounded-pill bg-zinc-100 px-2 py-0.5 text-xs text-zinc-800 transition-colors hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700">
                                <span x-text="$store.privateMessages?.nameOf(pk) ?? pk"></span>
                                <flux:icon.x-mark variant="micro" aria-hidden="true" class="size-3" />
                            </button>
                        </template>
                    </div>
                </template>

                {{-- `x-model` WITHOUT the optional chain, and that is not an oversight:
                     Alpine compiles it into an assignment, and `a?.b = v` is a
                     SyntaxError — "Invalid left-hand side in assignment", which the E2E
                     page-error guard caught on the first run. Safe here because the whole
                     block sits inside `x-if="$store.privateMessages?.picking"`, so it
                     does not exist until the store does. --}}
                <flux:field class="mt-2">
                    <flux:label>{{ __('Person') }}</flux:label>
                    <flux:input x-model="$store.privateMessages.personDraft"
                                x-on:keydown.enter.prevent="$store.privateMessages?.addPersonDraft()"
                                placeholder="{{ __('Name, npub… oder öffentlicher Schlüssel') }}" />
                </flux:field>

                <template x-if="($store.privateMessages?.suggestions() ?? []).length">
                    <div class="mt-1 flex max-h-48 flex-col gap-px overflow-y-auto">
                        <template x-for="c in ($store.privateMessages?.suggestions() ?? [])" :key="c.pubkey">
                            <button type="button" data-pm-vorschlag x-on:click="$store.privateMessages?.pick(c.pubkey)"
                                    class="pressable flex min-h-9 w-full items-center gap-2 rounded-tile px-2 text-start text-sm transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800">
                                <span class="inline-flex size-6 shrink-0 items-center justify-center overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                                    <template x-if="c.picture">
                                        <img alt="" class="size-full object-cover" x-bind:src="$img(c.picture)" />
                                    </template>
                                    <template x-if="!c.picture">
                                        <flux:icon.user variant="micro" aria-hidden="true" class="size-3.5 text-muted" />
                                    </template>
                                </span>
                                <span class="min-w-0 flex-1 truncate" x-text="c.name"></span>
                            </button>
                        </template>
                    </div>
                </template>

                <div class="mt-3 flex justify-end gap-2">
                    <flux:button size="sm" variant="ghost" x-on:click="$store.privateMessages?.stopPicking()">{{ __('Abbrechen') }}</flux:button>
                    <flux:button size="sm" variant="primary" data-pm-oeffnen
                                 x-bind:disabled="($store.privateMessages?.picked ?? []).length === 0"
                                 x-on:click="$store.privateMessages?.beginConversation()">{{ __('Unterhaltung öffnen') }}</flux:button>
                </div>
            </div>
        </template>

        {{-- ── The open conversation ────────────────────────────────────────────────
             Its own surface and not `deriveRoomChat`: the chat feed is filtered on `#h`,
             and a NIP-17 conversation has no `h`. Deliberately narrow — no quoting, no
             reactions, no attachments: each of those would need its own answer to the
             question of what part of it ends up in cleartext on the relay. --}}
        <template x-if="$store.privateMessages?.openKey">
            <div class="surface-card mt-3 flex flex-col overflow-hidden" data-pm-verlauf>
                <div class="flex items-center gap-2 border-b border-zinc-200/60 px-2 py-2 dark:border-zinc-800/60">
                    <flux:button size="sm" variant="ghost" icon="arrow-left" data-pm-zurueck
                                 x-on:click="$store.privateMessages?.closeConversation()"
                                 aria-label="{{ __('Zurück zur Liste') }}" />
                    <span class="min-w-0 flex-1 truncate text-sm font-medium text-zinc-900 dark:text-zinc-100"
                          data-pm-titel
                          x-text="(($store.privateMessages?.conversations ?? []).find(r => r.key === $store.privateMessages?.openKey) ?? {}).title ?? ''"></span>
                </div>

                <div class="flex max-h-[50vh] flex-col gap-2 overflow-y-auto px-3 py-3">
                    <template x-if="!($store.privateMessages?.messages ?? []).length">
                        <flux:text class="py-6 text-center text-sm text-muted">{{ __('Noch nichts geschrieben.') }}</flux:text>
                    </template>
                    <template x-for="m in ($store.privateMessages?.messages ?? [])" :key="m.id">
                        <div data-pm-nachricht class="flex flex-col" x-bind:class="m.mine ? 'items-end' : 'items-start'">
                            <span class="text-[0.7rem] text-muted" x-text="m.name"></span>
                            <span class="max-w-[85%] whitespace-pre-wrap break-words rounded-tile px-3 py-2 text-sm"
                                  x-bind:class="m.mine ? 'bg-brand-500/15 text-zinc-900 dark:text-zinc-100' : 'bg-black/5 text-zinc-900 dark:bg-white/10 dark:text-zinc-100'"
                                  x-text="m.content"></span>
                        </div>
                    </template>
                </div>

                {{-- Again `x-model` without the optional chain — same reason as in the
                     picker above, and the same protection: this block only exists inside
                     `x-if="$store.privateMessages?.openKey"`. --}}
                <div class="flex items-end gap-2 border-t border-zinc-200/60 px-2 py-2 dark:border-zinc-800/60">
                    <flux:input class="flex-1" data-pm-eingabe
                                x-model="$store.privateMessages.draft"
                                x-on:keydown.enter.prevent="$store.privateMessages?.send()"
                                x-bind:disabled="!$store.privateMessages?.canSend || $store.privateMessages?.busy"
                                placeholder="{{ __('Verschlüsselte Nachricht…') }}" />
                    <flux:button variant="primary" icon="paper-airplane" data-pm-senden
                                 x-bind:disabled="!$store.privateMessages?.canSend || $store.privateMessages?.busy || !($store.privateMessages?.draft ?? '').trim()"
                                 x-on:click="$store.privateMessages?.send()"
                                 aria-label="{{ __('Senden') }}" />
                </div>
            </div>
        </template>
    </div>

</x-group::app-shell>
