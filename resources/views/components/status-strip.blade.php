{{-- Globaler Status-Strip der Shell (§3.1/§7.2): trägt Signer-Health- UND
     Reconnect-Banner in EINER Höhe, statt zweier gestapelter fixed-Overlays.
     App-weit, einmal — die Banner erscheinen nie im reinen Gast-Modus (ihre
     Alpine-Stores bleiben still ohne aktiven Signer).

     Ersetzt die beiden Inline-Banner aus `einundzwanzig.blade.php` — dort bleiben
     sie in P1 additiv unangetastet, `app-shell` nutzt diesen Strip. Slide-down
     (x-transition), fixe Top-Position mit Safe-Area. --}}
{{-- aria-live-Region: die Banner poppen zustandsbasiert auf (x-show) → Screenreader
     sollen „Signer antwortet nicht"/Reconnect angesagt bekommen (WCAG 4.1.3).
     motion-reduce:transition-none unterdrückt den Slide bei prefers-reduced-motion
     — der theme.css-Block deckt nur benannte Klassen, nicht Alpines x-transition-
     Utilities (§7.6: „Slides aus"). --}}
<div role="status" aria-live="polite"
     class="pointer-events-none fixed inset-x-0 top-0 z-50 flex flex-col items-center gap-1.5 px-4 pt-safe">
    {{-- Signer-Health: Signer (v.a. NIP-46-Bunker) antwortet nicht/langsam. --}}
    <div x-data="nostrSignerBanner" x-show="message" x-cloak
         x-transition:enter="transition ease-out duration-200 motion-reduce:transition-none" x-transition:enter-start="-translate-y-2 opacity-0"
         class="pointer-events-auto mt-2 flex items-center gap-2 rounded-tile bg-amber-500/95 px-3 py-1.5 text-xs font-medium text-amber-950 shadow-pop">
        <flux:icon.signal-slash variant="micro" />
        <span x-text="message"></span>
    </div>

    {{-- Reconnect-Nudge: veraltete NIP-46-Verbindung (Perms-Update) neu aufsetzen. --}}
    <div x-data="nostrReconnectBanner" x-show="stale" x-cloak
         x-transition:enter="transition ease-out duration-200 motion-reduce:transition-none" x-transition:enter-start="-translate-y-2 opacity-0"
         class="pointer-events-auto mt-2 flex items-center gap-2 rounded-tile bg-brand-500/95 px-3 py-1.5 text-xs font-medium text-brand-950 shadow-pop">
        <flux:icon.arrow-path variant="micro" />
        <span>Für Zaps, Umfragen &amp; Admin einmal neu verbinden.</span>
        <button type="button" x-on:click="reconnect()" class="ml-1 rounded-full bg-brand-950 px-2 py-0.5 font-semibold text-brand-50 hover:bg-brand-900">Neu verbinden</button>
    </div>
</div>
