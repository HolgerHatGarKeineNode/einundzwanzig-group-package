<?php

declare(strict_types=1);

namespace Einundzwanzig\Group;

use Einundzwanzig\Group\Console\Commands\WarmNostrCache;
use Einundzwanzig\Group\Http\Middleware\EnsureNostrAuth;
use Illuminate\Console\Scheduling\Schedule;
use Illuminate\Support\Facades\Blade;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\ServiceProvider;
use Livewire\Livewire;

/**
 * Registriert den EINUNDZWANZIG-Group-Kern (Spaces/Räume/Directory/Login) im Host.
 * Alle Bausteine leben im `group::`-View-Namespace, den `x-group.*`-Komponenten
 * und den `group.*`-Routen — kollisionsfrei neben der Host-App (Web-Client + Portal).
 */
class GroupServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->mergeConfigFrom(__DIR__.'/../config/group.php', 'group');
    }

    public function boot(): void
    {
        $views = __DIR__.'/../resources/views';

        // `group::einundzwanzig` (Layout) + `group::*` als Blade-Views.
        $this->loadViewsFrom($views, 'group');
        // Livewire-Full-Page-SFCs: `group::spaces`, `group::settings.space`, …
        Livewire::addNamespace('group', $views);
        // Anonyme Blade-Komponenten: `<x-group.app-header>` etc. (absoluter Pfad).
        Blade::anonymousComponentPath($views.'/components', 'group');

        Route::aliasMiddleware('nostr.auth', EnsureNostrAuth::class);
        $this->loadRoutesFrom(__DIR__.'/../routes/group.php');

        $this->publishes([
            __DIR__.'/../config/group.php' => config_path('group.php'),
        ], 'group-config');

        // Brand-Mark (von x-group::app-brand-mark referenziert). Der Host
        // publiziert es nach public/img: `vendor:publish --tag=group-assets`.
        $this->publishes([
            __DIR__.'/../public/img' => public_path('img'),
        ], 'group-assets');

        if ($this->app->runningInConsole()) {
            $this->commands([WarmNostrCache::class]);
        }

        // Read-Cache warmhalten (§10/M7) — Web-only-Beschleuniger, auf Mobile aus.
        $this->callAfterResolving(Schedule::class, function (Schedule $schedule): void {
            $schedule->command('nostr:warm-cache')->everyFiveMinutes()->withoutOverlapping();
        });
    }
}
