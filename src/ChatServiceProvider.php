<?php

declare(strict_types=1);

namespace App\Chat;

use App\Chat\Console\Commands\WarmNostrCache;
use App\Chat\Http\Middleware\EnsureNostrAuth;
use Illuminate\Console\Scheduling\Schedule;
use Illuminate\Support\Facades\Blade;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\ServiceProvider;
use Livewire\Livewire;

/**
 * Registriert den Nostr-Chat-Kern (Spaces/Räume/Directory/Login) im Host.
 * Alle Chat-Bausteine leben im `chat::`-View-Namespace, den `x-chat.*`-
 * Komponenten und den `chat.*`-Routen — kollisionsfrei neben der Host-App
 * (Web-Client heute, Portal in P1).
 */
class ChatServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->mergeConfigFrom(__DIR__.'/../config/chat.php', 'chat');
    }

    public function boot(): void
    {
        $views = __DIR__.'/../resources/views';

        // `chat::einundzwanzig` (Layout) + `chat::*` als Blade-Views.
        $this->loadViewsFrom($views, 'chat');
        // Livewire-Full-Page-SFCs: `chat::spaces`, `chat::settings.space`, …
        Livewire::addNamespace('chat', $views);
        // Anonyme Blade-Komponenten: `<x-chat.app-header>` etc. (absoluter Pfad).
        Blade::anonymousComponentPath($views.'/components', 'chat');

        Route::aliasMiddleware('nostr.auth', EnsureNostrAuth::class);
        $this->loadRoutesFrom(__DIR__.'/../routes/chat.php');

        $this->publishes([
            __DIR__.'/../config/chat.php' => config_path('chat.php'),
        ], 'chat-config');

        // Brand-Mark (von x-chat::app-brand-mark referenziert). Der Host
        // publiziert es nach public/img: `vendor:publish --tag=chat-assets`.
        $this->publishes([
            __DIR__.'/../public/img' => public_path('img'),
        ], 'chat-assets');

        if ($this->app->runningInConsole()) {
            $this->commands([WarmNostrCache::class]);
        }

        // Read-Cache warmhalten (§10/M7) — Web-only-Beschleuniger, auf Mobile aus.
        $this->callAfterResolving(Schedule::class, function (Schedule $schedule): void {
            $schedule->command('nostr:warm-cache')->everyFiveMinutes()->withoutOverlapping();
        });
    }
}
