<?php

declare(strict_types=1);

namespace Einundzwanzig\Group\Http\Controllers;

use Einundzwanzig\Group\Http\Middleware\SetLocale;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/**
 * Der einzige Ort, an dem die Sprachwahl geschrieben wird (P2).
 *
 * Bewusst ein normaler Formular-POST und KEIN Livewire-Call: die Antwort ist ein
 * 302, der Browser lädt das Dokument vollständig neu. Das ist die Anforderung —
 * `wire:navigate` tauscht nur den Body, aber `__()` ist beim Rendern des
 * <head>/<html lang> längst gelaufen. Der Cookie muss VOR dem Render stehen,
 * nicht danach.
 *
 * Guest-fähig: die Route liegt außerhalb von `nostr.auth`, damit der Picker auch
 * auf einer künftigen Login-/Landeseite funktioniert.
 */
class LocaleController
{
    public function update(Request $request): RedirectResponse
    {
        $validated = $request->validate([
            'locale' => ['required', 'string', Rule::in(SetLocale::supported())],
        ]);

        $locale = $validated['locale'];

        // Session UND Cookie: das Cookie trägt über Sitzungen hinweg, die Session
        // hält die Wahl auch dann, wenn ein WebView das Cookie-Jar nicht
        // durchschreibt. Beide werden nur hier gesetzt — die Middleware liest.
        $request->session()->put(SetLocale::SESSION_KEY, $locale);

        return back(fallback: '/')->withCookie(cookie(
            name: SetLocale::COOKIE,
            value: $locale,
            minutes: SetLocale::LIFETIME_MINUTES,
            // path/domain/secure/sameSite bleiben null → CookieJar zieht die
            // Defaults aus `config/session.php` (identisch zum Session-Cookie).
            httpOnly: false,
        ));
    }
}
