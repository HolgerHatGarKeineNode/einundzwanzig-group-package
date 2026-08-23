{{-- @-Vorschlagsliste eines Forge-Composers (P9).

     `$targetExpr` ist ein **JS-Ausdruck**, kein Wert: die Kommentarfelder stehen
     in einem `x-for`, ihr Ziel heißt `'comment:' + issue.id` und ist erst zur
     Laufzeit bekannt. `$targetLabel` ist die statische Entsprechung fürs
     Datenattribut ('issue' bzw. 'comment') — ein Locator braucht etwas, das im
     Markup steht.

     Der Zustand `mention` ist EINER für die ganze Seite; `mention.target`
     entscheidet, welcher Composer sein Popover zeigt. Es tippt immer nur ein
     Feld, es kann also nie zwei offene geben — anders als im Chat, wo Raum- und
     Thread-Composer denselben Zustand teilen und beide Popover im DOM stehen.

     Ohne Agenten-Verzeichnis (zooid, oder Repo ohne `buzz-channel`) enthält die
     Liste nur Menschen: der Riegel steht in `agentMentionItems`, nicht hier. --}}
<template x-if="mention.open && mention.target === ({!! $targetExpr !!})">
    <div data-forge-mention-popover="{{ $targetLabel }}"
         class="surface-card absolute bottom-full left-0 z-30 mb-1 max-h-56 w-full max-w-xs overflow-y-auto rounded-card p-1 shadow-xl"
         x-on:click.stop>
        <template x-for="(item, i) in mention.items" :key="item.pubkey">
            {{-- `data-agent` ist der Haken für die Tests: „hier steht kein
                 Agentenvorschlag" ist nur prüfbar, wenn die Zeile im Ja-Fall ein
                 eigenes Merkmal trägt. --}}
            <button type="button" x-on:click="pickMention(item)" x-on:mouseenter="mention.index = i"
                    class="pressable flex w-full items-center gap-2 rounded-tile px-2 py-1.5 text-left"
                    :data-agent="item.isAgent ? 'true' : null"
                    :class="mention.index === i ? 'bg-brand-500/15' : ''">
                <x-group::nostr-avatar picture="item.picture" name="item.name" />
                <span class="truncate text-sm" x-text="item.name"></span>
                {{-- Erkennbar als Maschine: der Vorschlag verhält sich beim
                     Absenden wie jeder andere, aber am anderen Ende antwortet
                     ein Prozess — und nur für ihn entsteht die Weckmeldung. --}}
                <template x-if="item.isAgent">
                    <span class="ml-auto shrink-0 rounded-full bg-brand-500/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-brand-600 dark:text-brand-300"
                          title="{{ __('Headless Agent — antwortet auf Erwähnung') }}">{{ __('Agent') }}</span>
                </template>
            </button>
        </template>
    </div>
</template>
