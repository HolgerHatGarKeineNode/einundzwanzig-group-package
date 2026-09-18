<?php

declare(strict_types=1);

namespace Einundzwanzig\Group\Http\Controllers;

use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;

/**
 * The hub routes moved (D3). This is the one place that forwards the old ones.
 *
 * **Why not `Route::redirect()`.** Laravel's `RedirectController` builds the target
 * from the `destination` default and never looks at the query string — `/messages?c=<npub>`
 * would land on `/postfach` without the conversation, `/spaces?rt=meetups` without the
 * focus mode, `/forge?tab=workspaces` on the wrong tab. Those parameters are in links
 * people have already shared and in shipped app builds (R7), so they have to survive, and
 * two of them have to be RENAMED (`c` → `an`, `tab` → `ansicht` for the courses view).
 *
 * **Why an invokable controller and not a closure.** Closures do not survive
 * `route:cache`, and the mobile build caches its routes. Same reason `verein.return`
 * already uses `RedirectController` instead of a closure.
 *
 * **301 since P7 — 302 until then.** A 301 is cached by a browser indefinitely and cannot
 * be taken back, so the plan carried the redirects at 302 for five phases and flipped the
 * status in the release sweep, once every row had a green test
 * (`tests/Feature/LegacyRedirectTest.php`, one case per row INCLUDING the status). The
 * default lives here and nowhere else; a row may still override it with `status`.
 *
 * The map itself is NOT in here. It stands in `routes/group.php` (package rows) and in the
 * host's own route file (companion rows), because that is where a reader looks for "which
 * URL answers what" — this class only knows how to carry the query along.
 */
final class LegacyRedirect
{
    /**
     * Route defaults consumed here (all set via `->defaults(…)`):
     *   ziel     (string, required) target path, may carry its own query
     *   behalte  (list<string>)     query keys to copy over unchanged
     *   umbenenne(array<string,string>) query keys to copy under a new name
     *   weiche   (array{param: string, werte: array<string, string>})
     *            one old path, two targets, chosen by a query VALUE — `/spaces?tab=workspaces`
     *            became `/bereich/forge` while bare `/spaces` became `/bereich/chat`.
     *            A route cannot be matched on a query string, so the branch lives here.
     *   status   (int)              HTTP status, default 301 (302 until P7)
     *
     * `ziel` may carry PATH PARAMETERS of the matched route as `{name}` (P5): the companion's
     * `/meetups/{slug}` forwards to `/bereich/meetups/{slug}`, and three rows like it would
     * otherwise each need a controller of their own. Substituted from the route's own
     * parameters and URL-encoded per segment — a slug comes from Portal data, and a `/` in it
     * would silently address a different route.
     */
    public function __invoke(Request $request): RedirectResponse
    {
        $route = $request->route();
        $ziel = (string) $route->defaults['ziel'];
        $status = (int) ($route->defaults['status'] ?? 301);

        /** @var array{param: string, werte: array<string, string>}|null $weiche */
        $weiche = $route->defaults['weiche'] ?? null;
        if ($weiche !== null) {
            $wert = $request->query($weiche['param']);
            if (is_string($wert) && isset($weiche['werte'][$wert])) {
                $ziel = $weiche['werte'][$wert];
            }
        }

        /** @var list<string> $behalte */
        $behalte = $route->defaults['behalte'] ?? [];
        /** @var array<string, string> $umbenenne */
        $umbenenne = $route->defaults['umbenenne'] ?? [];

        [$pfad, $bestand] = $this->zerlege($this->setzeParameter($ziel, $route->parameters()));

        $mitgenommen = [];
        foreach ($behalte as $key) {
            if ($this->traegt($request, $key)) {
                $mitgenommen[$key] = $request->query($key);
            }
        }
        foreach ($umbenenne as $von => $nach) {
            if ($this->traegt($request, $von)) {
                $mitgenommen[$nach] = $request->query($von);
            }
        }

        /*
         * The target's OWN query wins AND stands first: `/postfach?ansicht=direkt` says
         * which segment to open, and a stale `ansicht` carried over from the old URL must
         * not override it. Everything the old URL brought along and the target does not
         * name is appended behind it.
         *
         * `+` and not `array_merge()`: for a duplicate key `array_merge` keeps the RIGHT
         * value, so the carried parameter would win — the opposite of the rule above. `+`
         * keeps the left one and appends the rest, which is also the readable order
         * (`?ansicht=direkt&an=…`, not `?an=…&ansicht=direkt`).
         */
        $query = $bestand + $mitgenommen;

        return redirect()->to(
            $query === [] ? $pfad : $pfad.'?'.http_build_query($query),
            $status,
        );
    }

    /**
     * A key counts as present only when it carries a scalar value. `?c=` (empty) and
     * `?c[]=x` (array) are not conversation ids — copying either would produce a target
     * the receiving page has to defend against a second time.
     */
    private function traegt(Request $request, string $key): bool
    {
        $wert = $request->query($key);

        return is_string($wert) && $wert !== '';
    }

    /**
     * `{slug}` → the matched route parameter, URL-encoded.
     *
     * A placeholder the route does not carry stays as it is rather than becoming an empty
     * segment: `/bereich/meetups/` would be a 404 that reads like a broken page, while the
     * literal `{slug}` in the address says what went wrong — and the redirect map has a test
     * per row.
     *
     * @param  array<string, mixed>  $parameter
     */
    private function setzeParameter(string $ziel, array $parameter): string
    {
        foreach ($parameter as $name => $wert) {
            if (is_scalar($wert)) {
                $ziel = str_replace('{'.$name.'}', rawurlencode((string) $wert), $ziel);
            }
        }

        return $ziel;
    }

    /**
     * @return array{0: string, 1: array<string, string>}
     */
    private function zerlege(string $ziel): array
    {
        $trenner = strpos($ziel, '?');
        if ($trenner === false) {
            return [$ziel, []];
        }

        parse_str(substr($ziel, $trenner + 1), $bestand);

        /** @var array<string, string> $bestand */
        return [substr($ziel, 0, $trenner), $bestand];
    }
}
