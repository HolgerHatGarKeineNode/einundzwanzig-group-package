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
         ein Fremdhost (Portal) setzt config('group.head_partial')='group::partials.head'. --}}
    @include(config('group.head_partial', 'partials.head'))
</head>
<body class="min-h-screen bg-zinc-50 text-zinc-900 antialiased dark:bg-zinc-950 dark:text-zinc-100">
    {{-- P2: Die beiden Signer-Banner leben jetzt im <x-group::status-strip> der
         app-shell (§3.1, EIN Strip, eine Höhe). Die Tab-Seiten rendern ihn über
         app-shell; chrome-lose Seiten ohne Shell (Raum) ziehen ihn direkt. Hier
         kein doppelter Inline-Balken mehr — sonst stünden zwei identische fixed-
         Overlays übereinander. --}}
    {{ $slot }}

    {{-- P6 (§4.2): Das globale Login-Sheet. Außerhalb des $slot → überlebt
         `wire:navigate` und liegt auf JEDER Seite (auch chrome-lose), damit der
         `authGate`-Store sein `open-login-sheet`-Event immer abfangen kann. --}}
    <x-group::login-sheet />

    {{-- Ziel für Insel-Toasts (Publish-Fehler etc.), per `toast-show`-Event. --}}
    <flux:toast position="bottom center" />

    @fluxScripts
</body>
</html>
