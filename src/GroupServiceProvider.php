<?php

declare(strict_types=1);

namespace Einundzwanzig\Group;

use Einundzwanzig\Group\Console\Commands\WarmNostrCache;
use Einundzwanzig\Group\Http\Middleware\EnsureNostrAuth;
use Einundzwanzig\Group\Portal\HttpPortalCatalog;
use Einundzwanzig\Group\Portal\PortalAffordances;
use Einundzwanzig\Group\Portal\PortalCatalog;
use Einundzwanzig\Group\Portal\WebPortalAffordances;
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

        /*
         * ── The Portal seam (D6/D9, P4) ──────────────────────────────────────────
         *
         * `bindIf` and not `bind`: a host that has its OWN way to the Portal registers it
         * in its provider and wins here. That is not hypothetical — `twenty-one-companion`
         * binds a catalog over its `PortalApi` (two-tier cache with a permanent stale copy,
         * so the pages still render offline) and native affordances (share sheet, in-app
         * browser, calendar editor).
         *
         * `scoped` and not `singleton`: {@see PortalCatalog::status()} is an answer about
         * THIS request. A singleton would carry a „stale" from one request into the next
         * and hang a banner over a page that loaded fine (the same reason the app's
         * `PortalApi` resets its flags per Livewire request).
         *
         * The web defaults live in the PACKAGE and not in the web host, deliberately: the
         * package route `/suche/portal-index` must answer in ANY host that mounts these
         * routes, and a host that forgets a binding would get a container error on a
         * public URL instead of a Portal page.
         */
        $this->app->scopedIf(PortalCatalog::class, HttpPortalCatalog::class);
        $this->app->scopedIf(PortalAffordances::class, WebPortalAffordances::class);
    }

    public function boot(): void
    {
        $views = __DIR__.'/../resources/views';

        // `group::einundzwanzig` (Layout) + `group::*` als Blade-Views.
        $this->loadViewsFrom($views, 'group');

        // JSON-Translations mit DEUTSCHEN Quell-Keys (__('Deutscher Text')). Beide
        // Consumer laden sie: der Web-Host bleibt via APP_LOCALE=de beim Key (kein
        // de.json nötig), die Mobile-App rendert sie über ihre 8 Locales. Additiv —
        // die app-eigenen lang/*.json des Hosts bleiben unberührt und haben Vorrang.
        $this->loadJsonTranslationsFrom(__DIR__.'/../lang');
        // Livewire-Full-Page-SFCs: `group::spaces`, `group::settings.space`, …
        Livewire::addNamespace('group', $views);
        // Anonyme Blade-Komponenten: `<x-group.app-header>` etc. (absoluter Pfad).
        Blade::anonymousComponentPath($views.'/components', 'group');
        // Package-owned Flux icons (`<flux:icon.pin>`), available in every host without a
        // copy in the host's own `resources/views/flux`. Blade tries the `flux` paths in
        // registration order, and this provider boots BEFORE Flux's (measured in
        // twenty-one-companion: this path is listed first) — a file here therefore shadows a
        // host override AND Flux's own stub of the same name. Only add names Flux does not ship.
        Blade::anonymousComponentPath($views.'/flux', 'flux');

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
