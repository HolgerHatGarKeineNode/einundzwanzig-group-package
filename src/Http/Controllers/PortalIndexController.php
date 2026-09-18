<?php

declare(strict_types=1);

namespace Einundzwanzig\Group\Http\Controllers;

use Einundzwanzig\Group\Portal\PortalCatalog;
use Einundzwanzig\Group\Portal\PortalHit;
use Illuminate\Http\Request;
use Illuminate\Http\Response;

/**
 * `GET /suche/portal-index` — the ONE compact index the command palette loads (D6).
 *
 * ── Why the palette gets an index instead of a search endpoint ────────────────────
 * The typed query never leaves the device. That is not a style choice: a search endpoint
 * would hand this server (and, one hop further, the Portal) the search history of every
 * visitor, keystroke by keystroke, and it would spend the Portal's 60/min per IP on a
 * bucket the whole instance shares (R9). So the browser asks ONCE per palette session,
 * filters in memory (`js/portalIndex.ts`) and asks nothing else.
 *
 * ── Why the route carries no session ─────────────────────────────────────────────
 * Same reason as the image proxy (`routes/img.php` in the host): the answer depends on
 * nothing but the Portal's public lists. Inside the `web` group every call would write a
 * session row, and on SQLite that serialises against every other request of the instance.
 * No session also means: no CSRF token, no cookie, nothing that could make the response
 * per-visitor — which is exactly what lets it be cached and ETagged.
 *
 * ── ETag ─────────────────────────────────────────────────────────────────────────
 * The index changes when the Portal's lists change, not when someone opens a palette. A
 * strong ETag over the body therefore turns the second load of the day into a 304 with an
 * empty body. `max-age` is short on purpose: the ETag does the saving, and a long
 * `max-age` would keep a cancelled date visible for hours.
 */
final class PortalIndexController
{
    /** How long a browser may reuse the index without asking (seconds). */
    private const MAX_AGE = 300;

    public function __invoke(Request $request, PortalCatalog $catalog): Response
    {
        /*
         * `search('')` and NOT `search($request->query('q'))`. The empty query is the
         * whole promise of this endpoint — see the class docblock. Reading a `q` here
         * would be the one line that turns a private palette into a query log.
         */
        $rows = array_map(
            static fn (PortalHit $hit): array => $hit->toIndexRow(),
            $catalog->search(''),
        );

        $body = (string) json_encode([
            'v' => 1,
            'status' => $catalog->status()->value,
            'rows' => $rows,
        ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

        $etag = '"'.md5($body).'"';

        $headers = [
            'Content-Type' => 'application/json; charset=utf-8',
            'Cache-Control' => 'public, max-age='.self::MAX_AGE,
            'ETag' => $etag,
        ];

        /*
         * `If-None-Match` may carry a LIST and weak validators (`W/"…"`) — a bare
         * `===` against the header would miss both and always answer 200. A revalidation
         * that never validates costs the whole point of the ETag.
         */
        foreach (array_map('trim', explode(',', (string) $request->header('If-None-Match', ''))) as $candidate) {
            if ($candidate === $etag || $candidate === 'W/'.$etag || $candidate === '*') {
                return response('', 304, $headers);
            }
        }

        return response($body, 200, $headers);
    }
}
