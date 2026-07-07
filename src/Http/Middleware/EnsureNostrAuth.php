<?php

namespace App\Chat\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Gate für Nostr-authentifizierte Routen.
 *
 * Web: verlangt einen via NIP-98 beglaubigten pubkey in der Session (§7).
 * Mobile: die Laravel-Instanz läuft lokal single-user im WebView — kein
 * Server-Handshake, die Präsenz-Prüfung passiert client-seitig in der Insel.
 */
class EnsureNostrAuth
{
    public function handle(Request $request, Closure $next): Response
    {
        // ponytail: Mobile durchlassen — lokale single-user-Instanz, echtes
        // Präsenz-Gate kommt mit dem Mobile-Signer-Pfad (M8). NICHT
        // `function_exists('nativephp_call')` — die Funktion existiert auch im
        // Web (PHP-Fallback des Pakets); nur `NATIVEPHP_RUNNING` heißt echtes Gerät.
        if (config('nativephp-internal.running')) {
            return $next($request);
        }

        if (! $request->session()->has('nostr_pubkey')) {
            return redirect()->guest(route('chat.nostr-login'));
        }

        return $next($request);
    }
}
