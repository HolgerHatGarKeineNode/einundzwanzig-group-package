<?php

declare(strict_types=1);

namespace Einundzwanzig\Group\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\App;
use Symfony\Component\HttpFoundation\Response;

/**
 * Setzt die Oberflächensprache pro Request (P2).
 *
 * Auflösung, erste Übereinstimmung gewinnt:
 *   1. Cookie `locale` — die ausdrückliche Wahl des Nutzers, 1 Jahr haltbar.
 *   2. Session — dieselbe Wahl, für die Lebensdauer der Sitzung.
 *   3. Der ERSTE Whitelist-Eintrag (`de`).
 *
 * **`Accept-Language` entscheidet bewusst NICHT** (Entscheidung des Nutzers,
 * 2026-08-13). Vorher stand die Verhandlung auf Platz 3, und damit bekam jeder
 * Besucher mit englischem Browser eine englische Oberfläche, ohne je etwas
 * gewählt zu haben. Das ist für einen deutschsprachigen Verein die falsche
 * Vorgabe: Deutsch ist hier nicht eine Sprache unter acht, sondern die Sprache
 * des Hauses — die Schlüssel der Kataloge SIND der deutsche Text.
 *
 * Der Preis ist benannt und in Kauf genommen: ein spanischer oder polnischer
 * Besucher sieht beim ersten Mal Deutsch, obwohl die App seine Sprache hätte.
 * Er kommt mit einem Klick heraus, und die Wahl hält ein Jahr. Umgekehrt hatte
 * ein deutscher Nutzer mit englischem Systembrowser keinen Weg, ohne dieselbe
 * Handlung Deutsch zu sehen — und das ist der häufigere Fall.
 *
 * Die Whitelist bleibt vollständig: alle acht Sprachen sind weiter wählbar,
 * nur nicht mehr automatisch.
 *
 * Warum Cookie und nicht `localStorage` oder ein kind-30078-Event: `__()` läuft
 * SERVERSEITIG, bevor irgendein Skript startet. Ein client-seitig gehaltener Wert
 * käme immer eine Runde zu spät — die erste Seite stünde in der falschen Sprache
 * und müsste sich selbst neu laden (Flash). Und Gäste haben keinen Signer, könnten
 * also gar kein 30078 schreiben.
 *
 * Diese Middleware SCHREIBT nichts (weder Cookie noch Session) — sie liest nur.
 * Geschrieben wird ausschließlich in `LocaleController::update()`, also genau dann,
 * wenn der Nutzer wechselt. Ein GET, der stillschweigend die Session mutiert, würde
 * eine per `Accept-Language` verhandelte Sprache einfrieren und wäre danach nicht
 * mehr von einer echten Wahl zu unterscheiden.
 */
class SetLocale
{
    /**
     * Name des Sprach-Cookies.
     *
     * Bewusst UNVERSCHLÜSSELT (`encryptCookies(except:)` in `bootstrap/app.php`)
     * und ohne `httpOnly`: der Wert ist eine Anzeige-Vorliebe, kein Credential.
     * Verschlüsselt hinge er am APP_KEY — ein Key-Wechsel (NativePHP-Build,
     * Server-Neuaufsetzung) würde die Sprachwahl aller Nutzer still zurücksetzen.
     * Ein manipulierter Wert kostet nichts: er fällt unten durch die Whitelist.
     */
    public const COOKIE = 'locale';

    /** Session-Schlüssel derselben Wahl. */
    public const SESSION_KEY = 'locale';

    /** 1 Jahr in Minuten (365 × 24 × 60). */
    public const LIFETIME_MINUTES = 525600;

    public function handle(Request $request, Closure $next): Response
    {
        App::setLocale(self::resolve($request));

        return $next($request);
    }

    /** Die aufgelöste Sprache für diesen Request — immer ein Whitelist-Eintrag. */
    public static function resolve(Request $request): string
    {
        $supported = self::supported();
        $fallback = $supported[0];

        $cookie = $request->cookie(self::COOKIE);
        if (is_string($cookie) && in_array($cookie, $supported, true)) {
            return $cookie;
        }

        if ($request->hasSession()) {
            $fromSession = $request->session()->get(self::SESSION_KEY);
            if (is_string($fromSession) && in_array($fromSession, $supported, true)) {
                return $fromSession;
            }
        }

        // Hier stand `$request->getPreferredLanguage($supported)`. Es ist bewusst
        // WEG, nicht vergessen: ohne ausdrückliche Wahl gilt die Sprache des
        // Hauses, nicht die des Browsers. Siehe Klassenkommentar.
        return $fallback;
    }

    /**
     * Die Whitelist als Liste von Locale-Codes; erster Eintrag = Rückfall.
     *
     * @return non-empty-list<string>
     */
    public static function supported(): array
    {
        /** @var array<array-key, string> $configured */
        $configured = (array) config('group.locales', []);

        $codes = array_values(array_map(strval(...), array_keys($configured)));

        // Eine leere/kaputte Config darf die Seite nicht auf `null` setzen.
        return $codes === [] ? ['de'] : $codes;
    }
}
