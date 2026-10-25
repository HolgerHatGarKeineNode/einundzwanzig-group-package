<?php

declare(strict_types=1);

namespace Einundzwanzig\Group\Http\Controllers;

use Einundzwanzig\Group\Nostr\Nip05Resolver;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * `GET /nostr/nip05?h[]=name@domain` — the verified-badge lookup (`js/handles.ts`).
 *
 * Stateless and outside the `web` group for the same reason as `/suche/portal-index`: no
 * session row per call (SQLite serialises them), no CSRF token, nothing per visitor. The
 * fetch itself, its limits and its cache live in {@see Nip05Resolver}.
 *
 * `config('group.handle_proxy') === false` answers every handle as `disabled` without a
 * single outbound request — the E2E suite runs that way (it stubs `.well-known` in the
 * browser and must not leave the machine from the server).
 */
final class Nip05Controller
{
    /** How long a browser may reuse an answer, seconds. */
    private const MAX_AGE = 600;

    public function __invoke(Request $request, Nip05Resolver $resolver): JsonResponse
    {
        $handles = array_values(array_filter(
            (array) $request->query('h', []),
            static fn ($handle): bool => is_string($handle) && $handle !== '' && strlen($handle) <= 320,
        ));

        $data = config('group.handle_proxy', true)
            ? $resolver->resolve($handles)
            : array_map(static fn (string $handle): array => ['handle' => $handle, 'status' => 'disabled', 'info' => null], array_slice($handles, 0, Nip05Resolver::MAX_HANDLES));

        return response()->json(['data' => $data], 200, [
            'Cache-Control' => 'public, max-age='.self::MAX_AGE,
        ], JSON_UNESCAPED_SLASHES);
    }
}
