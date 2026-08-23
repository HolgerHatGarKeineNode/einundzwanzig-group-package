{{-- Was aus der Weckmeldung wurde (P9) — auch dann, wenn keine entstand.

     **Das ist die Stelle, die „kein stilles Nichts" einlöst.** Ein Git-Ereignis
     weckt einen headless Agenten nie (der Relay ignoriert `h` an NIP-34-Events,
     `ingest.rs:425-437`); die Weckmeldung ist ein zweiter, eigener Vorgang. Geht
     sie nicht raus — kein `buzz-channel` am Repo, kein weckbarer Agent, Relay
     abgelehnt —, dann wartet der Nutzer sonst auf eine Antwort, die per
     Konstruktion nie kommt.

     Der Beitrag selbst bleibt in JEDEM dieser Fälle gültig und steht in der
     Liste. Deshalb ist dieser Block `role="status"` und nicht `role="alert"`:
     er meldet den Ausgang eines Nebenvorgangs, keinen Fehlschlag.

     `$target` ist der Schlüssel im `wakeNotice`-Verzeichnis ('issue' oder
     `comment:<id>`) — als JS-Ausdruck, weil er bei Kommentaren erst zur Laufzeit
     feststeht. --}}
<template x-if="wakeNotice[{!! $target !!}]">
    <div role="status" data-forge-wake-notice="{{ $label }}"
         :data-tone="wakeNotice[{!! $target !!}].tone"
         :class="wakeNotice[{!! $target !!}].tone === 'ok'
             ? 'border-emerald-500/40 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400'
             : 'border-amber-500/40 bg-amber-500/5 text-amber-700 dark:text-amber-400'"
         class="mt-2 flex items-start gap-2 rounded-tile border px-3 py-2 text-xs">
        <flux:icon.information-circle class="mt-0.5 size-4 shrink-0" />
        <span class="min-w-0 flex-1" x-text="wakeNotice[{!! $target !!}].text"></span>
        <button type="button" x-on:click="dismissWake({!! $target !!})"
                class="shrink-0 font-medium underline">{{ __('Verwerfen') }}</button>
    </div>
</template>
