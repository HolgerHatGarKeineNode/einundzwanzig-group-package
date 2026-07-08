{{--
    Gemeinsames Layout der EINUNDZWANZIG-Seiten (Livewire-Full-Page-SFCs).
    Die welshman-Insel wird EINMAL im <head> geladen (@vite in partials/head) und
    überlebt so `wire:navigate` (Body-Swap, Head bleibt) → das welshman-Repository,
    offene Subscriptions und optimistischer State bleiben zwischen Seiten warm.
    Die Seiten liefern nur ihren Rumpf (Alpine-Inseln via x-data); Hülle + Scripts
    liegen hier. Theme (Hell/Auto/Dunkel) steuert @fluxAppearance flackerfrei aus
    dem geteilten `flux.appearance`-Store — daher KEIN hartes class="dark" hier
    (würde Light toten Code machen und den Portal-WebView-Sync brechen).
--}}
<!DOCTYPE html>
<html lang="de">
<head>
    {{-- Head pro Host: Web-Client nutzt seine reiche partials.head (OG/Favicons);
         ein Fremdhost (Portal) setzt config('chat.head_partial')='chat::partials.head'. --}}
    @include(config('chat.head_partial', 'partials.head'))
</head>
<body class="min-h-screen bg-zinc-50 text-zinc-900 antialiased dark:bg-zinc-950 dark:text-zinc-100">
    {{-- Globaler Signer-Health-Banner: erscheint app-weit, wenn der Signer
         (v.a. NIP-46-Bunker) nicht/langsam antwortet. --}}
    <div x-data="nostrSignerBanner" x-show="message" x-cloak x-transition.opacity
         class="fixed inset-x-0 top-0 z-50 flex justify-center px-4 pt-safe">
        <div class="mt-2 flex items-center gap-2 rounded-tile bg-amber-500/95 px-3 py-1.5 text-xs font-medium text-amber-950 shadow-pop">
            <flux:icon.signal-slash variant="micro" />
            <span x-text="message"></span>
        </div>
    </div>

    {{ $slot }}

    {{-- Ziel für Insel-Toasts (Publish-Fehler etc.), per `toast-show`-Event. --}}
    <flux:toast position="bottom center" />

    @fluxScripts
</body>
</html>
