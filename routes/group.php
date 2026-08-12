<?php

use Einundzwanzig\Group\Http\Controllers\LocaleController;
use Einundzwanzig\Group\Http\Controllers\NostrAuthController;
use Einundzwanzig\Group\Http\Middleware\ContentSecurityPolicy;
use Illuminate\Routing\RedirectController;
use Illuminate\Support\Facades\Route;

/*
 * Group-Routen des Packages. Alle Namen unter dem `group.`-Präfix — der Host
 * verlinkt via `route('group.spaces')` (Web-Client heute, Portal-Nav in P1).
 * CSP nur auf diesen Routen (Reibung 9), nicht global an die Host-web-Group.
 */
// `web` explizit: Package-Routen (loadRoutesFrom) erben die web-Group des Hosts
// nicht automatisch — ohne sie fehlen Session/Cookies/CSRF.
Route::middleware(['web', ContentSecurityPolicy::class])->name('group.')->group(function (): void {
    // M1 — Nostr-Login (Client-Signer) + NIP-98-Handoff an die Laravel-Session.
    Route::livewire('/nostr-login', 'group::nostr-login')->name('nostr-login');
    Route::get('/nostr/challenge', [NostrAuthController::class, 'challenge'])->name('nostr.challenge');
    Route::post('/nostr/login', [NostrAuthController::class, 'login'])->name('nostr.login');
    Route::post('/nostr/logout', [NostrAuthController::class, 'logout'])->name('nostr.logout');

    // P2 — Sprachwahl. BEWUSST außerhalb von `nostr.auth`: Sprache ist eine
    // Anzeige-Einstellung, kein Konto-Zustand; ein Gast auf der Login-Seite muss
    // sie umstellen können. Antwort ist ein 302 → volles Neuladen (der Cookie
    // muss vor dem nächsten Render stehen, `wire:navigate` reicht dafür nicht).
    Route::post('/locale', [LocaleController::class, 'update'])->name('locale');

    // Geschützt durch das Nostr-Gate: aktiver Space + Raum-Liste (Single-Space §12).
    Route::middleware('nostr.auth')->group(function (): void {
        Route::livewire('/spaces', 'group::spaces')->name('spaces');
        // Benachrichtigungen („Neu", P4). Eigener Screen statt Bottom-Nav-Tab —
        // ein fünfter Tab bräche `bottom-nav.blade.php` still auf 3 Spalten und
        // wäre ein Drei-Repo-Release inkl. Play-Store. Statisches erstes Segment,
        // kollidiert also mit keinem `/rooms/{h}`.
        Route::livewire('/updates', 'group::updates')->name('updates');
        Route::livewire('/directory', 'group::directory')->name('directory');
        // Longform-Artikel (P7, NIP-23). Eigener Screen, KEIN Bottom-Nav-Tab und kein
        // Rail-Eintrag: die Spaltenklasse der Bottom-Nav hängt an `count($items)`
        // (`bottom-nav.blade.php:56`) — ein vierter Tab wäre ein Drei-Repo-Release; und
        // die Rail ist eine Sprungliste für RÄUME (`RailRoom` verlangt ein `h`), ein
        // Artikel hat keins. Einstiege sind deshalb Befehlspalette, Rail-Fußzeile und
        // eine Zeile auf der Übersicht. Statisches erstes Segment, kollidiert mit keinem
        // `/rooms/{h}`.
        Route::livewire('/articles', 'group::articles')->name('articles');
        // Die Vollansicht adressiert über `naddr` (NIP-19), nicht über die Event-Id: ein
        // 30023 ist ersetzbar, seine Id wechselt mit jeder Überarbeitung — der `naddr`
        // (Kind + Autor + `d`) bleibt und funktioniert auch in fremden Clients.
        Route::livewire('/articles/{naddr}', 'group::article')->name('article');
        Route::livewire('/rooms/{h}', 'group::room')->name('room');
        // Direkt verlinkbarer Thread (C6b): dieselbe Room-SFC, öffnet den Thread als
        // Vollansicht. `{nevent}` = bech32-Referenz auf die Wurzel-Nachricht (portabel/teilbar).
        Route::livewire('/rooms/{h}/thread/{nevent}', 'group::room')->name('room.thread');
        // Verschmolzener Settings-Screen (§6): der EINE Settings-Ort.
        Route::livewire('/settings', 'group::pages.settings')->name('settings');
        // Alte ad-hoc space.settings-Seite konsolidiert → Redirect auf den Hub.
        // Route-NAME beibehalten (Cross-Repo-Hardlinks: Mobile-`nav`-`match` +
        // layouts/mobile.blade.php verweisen darauf; Rename = 3 Repos). Entfällt
        // in P5, sobald der Mobile-Host keine space.settings-Referenz mehr hält.
        Route::redirect('/settings/space', '/settings')->name('space.settings');
        Route::livewire('/settings/wallet', 'group::settings.wallet')->name('wallet');
        Route::livewire('/join', 'group::join')->name('join');

        /*
         * P5 — Vereins-Onboarding. Statisches erstes Segment, kollidiert mit
         * keinem `/rooms/{h}`. Interstitial ohne Bottom-Nav (wie `/join`): der
         * Nutzer ist auf einer Strecke, kein Tab-Wechsel dazwischen.
         */
        Route::livewire('/verein/beitritt', 'group::verein')->name('verein.join');

        /*
         * Der Rücksprung aus dem BTCPay-Checkout.
         *
         * Ein eigener, statischer Pfad und keine Query-Variante des Flows: der
         * Verein prüft `return_url` gegen eine **serverseitige Allowlist**
         * (`app/Support/InvoiceReturnUrl.php` dort, P3). Was dort eingetragen
         * wird, muss zeichengenau und dauerhaft sein — `https://<host>/verein/zurueck`
         * ist genau ein Eintrag, eine Query-Variante wäre je nach Zustand eine
         * andere Zeichenkette und fiele mit 422 durch.
         *
         * Der Sprung landet im WARTEZUSTAND, nicht am Anfang: wer gerade bezahlt
         * hat, darf nicht auf einen Knopf schauen, der eine zweite Rechnung aus
         * einem Kontingent von drei pro Tag zieht.
         *
         * Aufgebaut wie `Route::redirect()`, aber als `GET` statt `ANY`: der
         * Rücksprung aus einem Browser-Checkout ist ein GET, und eine Route, die
         * jede Methode annimmt, ist eine Methode-Fläche ohne Zweck. Dieselbe
         * Bauart wie der Proxy nebenan (`routes/verein.php`) — dort ist die
         * Routentabelle die Erlaubnisliste, hier gilt derselbe Grundsatz.
         *
         * `RedirectController` statt einer Closure: Closures überleben
         * `route:cache` nicht, und der Mobile-Build cacht.
         */
        Route::get('/verein/zurueck', RedirectController::class)
            ->defaults('destination', '/verein/beitritt?schritt=warten')
            ->defaults('status', 302)
            ->name('verein.return');
    });
});
