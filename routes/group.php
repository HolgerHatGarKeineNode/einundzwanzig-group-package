<?php

use Einundzwanzig\Group\Http\Controllers\NostrAuthController;
use Einundzwanzig\Group\Http\Middleware\ContentSecurityPolicy;
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

    // Geschützt durch das Nostr-Gate: aktiver Space + Raum-Liste (Single-Space §12).
    Route::middleware('nostr.auth')->group(function (): void {
        Route::livewire('/spaces', 'group::spaces')->name('spaces');
        Route::livewire('/directory', 'group::directory')->name('directory');
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
    });
});
