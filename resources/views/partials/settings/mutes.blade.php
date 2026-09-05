{{-- ── Hidden people (P6, NIP-51 kind 10000) ────────────────────────────────────
     The place where the list is managed: "who have I hidden", and the way back. Hiding
     happens on the profile card, un-hiding happens here AND there — a hidden person is
     gone from the chat list, so their card cannot be reached from there any more.
     Without this section, hiding would be a one-way street.

     No `x-data` of its own: the section hangs on the global `$store.mutes`, which arms
     itself on space and identity at boot (`js/mutes.ts`). The same list that filters the
     chat — there must not be two truths about "is this person hidden". --}}
<section aria-labelledby="settings-mutes" data-settings-section="mutes">
    <flux:heading id="settings-mutes" level="2" size="sm" class="mb-2 text-muted">{{ __('Ausgeblendete Personen') }}</flux:heading>

    {{-- The sentence the plan wants in the SURFACE rather than in a comment: the filter
         hides the display, not the data. Whoever takes it for confidentiality is wrong —
         and would be trusting a protection that does not exist. --}}
    <flux:text class="mb-2 text-xs text-muted">{{ __('Wirkt nur in deiner Anzeige. Die Beiträge werden weiterhin vom Relay geladen — das ist keine Sperre und keine Vertraulichkeit.') }}</flux:text>

    <template x-if="$store.mutes?.error">
        <div class="surface-card mb-2 flex items-start gap-2 p-3">
            <flux:icon.exclamation-triangle class="mt-0.5 size-4 shrink-0 text-red-600 dark:text-red-400" />
            <flux:text class="min-w-0 flex-1 text-sm" x-text="$store.mutes.error"></flux:text>
            <flux:button size="xs" variant="ghost" x-on:click="$store.mutes.dismissError()">{{ __('Schließen') }}</flux:button>
        </div>
    </template>

    <template x-if="!$store.mutes?.entries?.length">
        <div class="surface-card p-3">
            <flux:text class="text-sm text-muted">{{ __('Niemand ausgeblendet.') }}</flux:text>
        </div>
    </template>

    <div class="surface-card divide-y divide-zinc-100 dark:divide-zinc-800" role="list"
         x-show="$store.mutes?.entries?.length" x-cloak>
        <template x-for="person in $store.mutes.entries" :key="person.pubkey">
            <div class="flex items-center gap-2 p-3" role="listitem">
                <flux:icon.eye-slash class="size-4 shrink-0 text-muted" />
                <div class="min-w-0 flex-1">
                    <div class="truncate text-sm" x-text="person.name"></div>
                    <div class="truncate font-mono text-[0.7rem] text-muted" x-text="person.npub"></div>
                </div>
                {{-- `:name` as a WHOLE key with a placeholder, not a concatenation —
                     the rule `I18nCatalogGateTest` enforces. Without the name, a list
                     would announce a dozen identical-sounding buttons. --}}
                <flux:button size="xs" variant="ghost" class="shrink-0" data-mute-remove
                             x-bind:aria-label="@js(__('Ausblenden von :name aufheben')).split(':name').join(person.name)"
                             x-on:click="$store.mutes.toggle(person.pubkey)">{{ __('Wieder einblenden') }}</flux:button>
            </div>
        </template>
    </div>

    {{-- The private half of a NIP-51 list is encrypted. This client neither writes nor
         reads it — it carries it over byte for byte on every write, so it cannot be lost
         here. A surface that silently omits entries would be the worse failure, so the
         fact is stated instead. --}}
    <flux:text x-show="$store.mutes?.hasPrivate" x-cloak class="mt-2 text-xs text-muted">
        {{ __('Diese Liste hat einen verschlüsselten privaten Teil, den dieser Client nicht anzeigt. Er bleibt unangetastet.') }}
    </flux:text>
</section>
