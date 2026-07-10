{{-- P6 (§4.2): Das globale Login-Sheet. EINMAL im Layout gemountet, überlebt
     `wire:navigate` (liegt außerhalb des SFC-$slot). Fängt das `open-login-sheet`-
     Event des `authGate`-Stores (bridge.ts) ab — gatete eine Tab/Aktion einen Gast,
     öffnet sich das Sheet in-place STATT auf den Login-View zu springen. Der Store
     dispatcht cancelable; unser `preventDefault()` unterdrückt den harten Fallback.

     Präsentation zweigeteilt (§5.1): Bottom-Sheet (mobil/schmal), zentriertes
     Dialog-Panel (breit). Die `login-form`-Insel wird erst bei `open` gemountet
     (`x-if`) — die schwere `nostrAuth`-Insel kostet nichts, solange das Sheet zu ist.

     Kein Client-`resume()`: `completeLogin` (Insel) navigiert bei Erfolg hart auf
     `postLoginRedirect()`, das den vom Gate gemerkten `?return`/pendingReturn (das
     getappte Tab-Ziel) honoriert — die Navigation räumt das Sheet von selbst weg. --}}
<div
    x-data="{ open: false, label: null }"
    x-on:open-login-sheet.window="$event.preventDefault(); label = $event.detail?.intent?.label ?? null; open = true"
    x-on:keydown.escape.window="open = false"
    x-cloak
>
    <div x-show="open" class="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-label="Anmelden">
        {{-- Scrim: Tap schließt (Gast bleibt, wo er war). --}}
        <div x-show="open" x-transition.opacity class="absolute inset-0 bg-black/40" x-on:click="open = false"></div>

        {{-- Bottom-Sheet slide-up (mobil) / Fade+Scale (breit). Unter prefers-
             reduced-motion neutralisieren die motion-reduce:*-Utilities Slide UND
             Scale in den Start/End-States → es bleibt ein reiner Opacity-Fade
             (§7.6). Alpines bare `x-transition` hätte hart hochskaliert (kein Guard). --}}
        <div
            x-show="open"
            x-transition:enter="transition ease-out duration-300 motion-reduce:duration-150"
            x-transition:enter-start="opacity-0 translate-y-full sm:translate-y-4 sm:scale-95 motion-reduce:!translate-y-0 motion-reduce:!scale-100"
            x-transition:enter-end="opacity-100 translate-y-0 sm:scale-100"
            x-transition:leave="transition ease-in duration-200 motion-reduce:duration-150"
            x-transition:leave-start="opacity-100 translate-y-0 sm:scale-100"
            x-transition:leave-end="opacity-0 translate-y-full sm:translate-y-4 sm:scale-95 motion-reduce:!translate-y-0 motion-reduce:!scale-100"
            class="surface-card relative z-10 max-h-[90dvh] w-full overflow-y-auto rounded-t-sheet pb-safe sm:max-w-md sm:rounded-sheet"
        >
            <div class="sticky top-0 flex justify-end p-2">
                <flux:button variant="ghost" size="sm" icon="x-mark" x-on:click="open = false" aria-label="Schließen" />
            </div>
            <div class="px-2 pb-2">
                {{-- Kontextzeile (§4.2, `intent.label`): warum das Sheet gerade aufging.
                     Runtime-Wert → hier im Sheet-Scope, nicht in der server-gerenderten
                     Form. --}}
                {{-- Orange-Kleintext auf weißem Sheet: Light-Mode brand-700 (≥4.5:1),
                     Dark brand-400 (≈9:1) — brand-600 riss im Light die AA-Schwelle (§7.6). --}}
                <flux:text x-show="label" x-cloak class="mb-3 px-4 text-brand-700 dark:text-brand-400" x-text="label"></flux:text>
                {{-- Insel erst bei geöffnetem Sheet mounten (deferred). Sheet öffnet
                     nur für Gäste → kein „Angemeldet"/Abmelden-Zweig (Logout bleibt
                     an EINEM Ort, §5.4). --}}
                <template x-if="open">
                    <x-group::login-form :show-logged-in="false" />
                </template>
            </div>
        </div>
    </div>
</div>
