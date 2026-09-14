{{-- The loading state of the member directory — four placeholder rows.

     It is included TWICE and that is the point: once by the shell while the island's
     chunk is in flight (`nostrDirectoryShell`, `js/bridge.ts`), once by the island
     itself while the member profiles are still coming in (`profilesReady`). The two
     waits follow each other on a cold visit, and a reader must not see the screen
     change shape between them — so both show the same thing, out of one file.

     Nothing in here reads the island's scope. That is a requirement, not a
     coincidence: in the shell's branch the island does not exist yet, and an
     expression naming one of its fields would be a ReferenceError, which Alpine
     reports as a thrown page error. --}}
<div class="space-y-2" aria-busy="true">
    <span class="sr-only" aria-live="polite">{{ __('Mitglieder werden geladen…') }}</span>
    <template x-for="i in 4" :key="i">
        <div class="surface-card flex items-center gap-3 p-3">
            <div class="skeleton size-9 rounded-full"></div>
            <div class="flex-1 space-y-1.5">
                <div class="skeleton h-3.5 w-32"></div>
                <div class="skeleton h-2.5 w-20"></div>
            </div>
        </div>
    </template>
</div>
