<?php

use App\Chat\Http\Controllers\NostrAuthController;
use App\Chat\Http\Middleware\ContentSecurityPolicy;
use Illuminate\Support\Facades\Route;

/*
 * Chat-Routen des Packages. Alle Namen unter dem `chat.`-Präfix — der Host
 * verlinkt via `route('chat.spaces')` (Web-Client heute, Portal-Nav in P1).
 * CSP nur auf diesen Routen (Reibung 9), nicht global an die Host-web-Group.
 */
// `web` explizit: Package-Routen (loadRoutesFrom) erben die web-Group des Hosts
// nicht automatisch — ohne sie fehlen Session/Cookies/CSRF.
Route::middleware(['web', ContentSecurityPolicy::class])->name('chat.')->group(function (): void {
    // M1 — Nostr-Login (Client-Signer) + NIP-98-Handoff an die Laravel-Session.
    Route::livewire('/nostr-login', 'chat::nostr-login')->name('nostr-login');
    Route::get('/nostr/challenge', [NostrAuthController::class, 'challenge'])->name('nostr.challenge');
    Route::post('/nostr/login', [NostrAuthController::class, 'login'])->name('nostr.login');
    Route::post('/nostr/logout', [NostrAuthController::class, 'logout'])->name('nostr.logout');

    // Geschützt durch das Nostr-Gate: aktiver Space + Raum-Liste (Single-Space §12).
    Route::middleware('nostr.auth')->group(function (): void {
        Route::livewire('/spaces', 'chat::spaces')->name('spaces');
        Route::livewire('/directory', 'chat::directory')->name('directory');
        Route::livewire('/rooms/{h}', 'chat::room')->name('room');
        Route::livewire('/settings/space', 'chat::settings.space')->name('space.settings');
        Route::livewire('/join', 'chat::join')->name('join');
    });
});
