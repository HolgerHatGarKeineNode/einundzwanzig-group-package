<?php

namespace App\Chat\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Content-Security-Policy als Defense-in-Depth für den Web-Client.
 *
 * Realität: Flux liefert Alpine OHNE CSP-Build, und Livewire injiziert Inline-
 * Skripte — `script-src` braucht daher `unsafe-eval` (Alpine wertet Ausdrücke
 * per Function-Konstruktor aus) und `unsafe-inline`. Eine strikte Script-Sperre
 * ist so nicht erreichbar; die CSP härtet stattdessen die übrigen Vektoren:
 * `connect-src` nur ws/wss/https (Relays/NIP-11/dufflepud), `object-src none`,
 * `base-uri`/`form-action` self, `frame-ancestors none` (Clickjacking).
 *
 * ponytail: script/style bleiben `unsafe-*` wegen Alpine/Flux — Upgrade auf
 * nonce-basiert erst, wenn Livewire/Flux einen CSP-Build mitliefern.
 */
class ContentSecurityPolicy
{
    public function handle(Request $request, Closure $next): Response
    {
        $response = $next($request);

        // Auf Mobile (lokaler WebView) übernimmt die native Shell die Isolation;
        // eine HTTP-CSP brächte dort nur Reibung.
        if (config('nativephp-internal.running')) {
            return $response;
        }

        // Dev: Vite serviert @vite/client + app.ts/css von seinem eigenen Origin
        // (public/hot). Ohne Freigabe blockt die CSP das Insel-Bundle → keine
        // Alpine-Komponenten. Nur im Dev aktiv (im Prod-Build fehlt public/hot).
        $vite = '';
        if (is_file($hot = public_path('hot'))) {
            $vite = ' '.trim((string) file_get_contents($hot));
        }

        $policy = implode('; ', [
            "default-src 'self'",
            // Alpine/Livewire-Realität (siehe Klassendoku).
            "script-src 'self' 'unsafe-eval' 'unsafe-inline'".$vite,
            "style-src 'self' 'unsafe-inline'".$vite,
            // Avatare/Chat-Bilder kommen von beliebigen Hosts.
            'img-src * data: blob:',
            "font-src 'self' data:",
            // Relays (ws/wss) + deren NIP-11 (http/https — plain-ws-Relays servieren
            // NIP-11 über http). Für Nostr muss connect-src breit sein; der Härtungs-
            // wert dieser CSP liegt bei object-src/base-uri/frame-ancestors.
            "connect-src 'self' ws: wss: http: https:",
            "object-src 'none'",
            "base-uri 'self'",
            "form-action 'self'",
            "frame-ancestors 'none'",
        ]);

        $response->headers->set('Content-Security-Policy', $policy);
        $response->headers->set('X-Content-Type-Options', 'nosniff');
        $response->headers->set('Referrer-Policy', 'strict-origin-when-cross-origin');

        return $response;
    }
}
