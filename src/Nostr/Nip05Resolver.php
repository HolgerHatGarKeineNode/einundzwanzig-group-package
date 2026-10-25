<?php

declare(strict_types=1);

namespace Einundzwanzig\Group\Nostr;

use Closure;
use Illuminate\Http\Client\Pool;
use Illuminate\Http\Client\Response;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\RateLimiter;
use Throwable;

/**
 * Server-side NIP-05 lookup for the verified badge (`js/handles.ts`).
 *
 * ── Why the server asks and not the browser ──────────────────────────────────────
 * The browser can only read a `.well-known/nostr.json` whose host answers CORS correctly,
 * and many do not. Measured 2026-10-25 from the companion app: `primal.net` sends
 * `Access-Control-Allow-Origin: *, *` (a duplicated value, rejected by every browser),
 * `0xchat.com` sends none. Those users lost their badge although their NIP-05 is valid.
 * NIP-05 itself never mentions CORS as a requirement of the domain; welshman's answer to
 * the same problem is the "dufflepud" proxy (`@welshman/app` `plugins/handles.js`), and the
 * response shape here mirrors it: `{data: [{handle, info}]}`.
 *
 * A second effect is deliberate: the domain now sees this server's address instead of the
 * reader's — the privacy argument welshman gives for dufflepud.
 *
 * ── The outbound fetch is hardened in the first version, not after review ─────────
 *  1. https only, a syntactically valid public host name (no IP literals, no ports).
 *  2. DNS resolved ONCE; every A/AAAA record must be public, and the connection is pinned
 *     to the checked address (`CURLOPT_RESOLVE`) so a rebinding answer between the check
 *     and the connect cannot reach a private network.
 *  3. No redirects at all — NIP-05: "Fetchers MUST ignore any HTTP redirects given by the
 *     /.well-known/nostr.json endpoint." That also closes the redirect-to-private path.
 *  4. `decode_content` off, and the size limit counts RAW bytes while they arrive
 *     (`progress` aborts the transfer), with a final length check behind it.
 *  5. A total deadline per request and a connect deadline.
 *  6. A per-domain budget, so one request full of names cannot make this server hammer a
 *     single foreign host; results are cached (found / unknown / failed apart).
 */
final class Nip05Resolver
{
    /** Handles answered per call; the client sends batches of this size. */
    public const MAX_HANDLES = 30;

    /** Raw bytes read from one `nostr.json` before the transfer is aborted. */
    public const MAX_BYTES = 128 * 1024;

    /** Total deadline per lookup, seconds. */
    public const TIMEOUT = 5;

    /** Connect deadline per lookup, seconds. */
    public const CONNECT_TIMEOUT = 3;

    /** Lookups one domain may receive from this server per minute. */
    public const DOMAIN_BUDGET_PER_MINUTE = 30;

    /** Cache lifetimes per outcome, seconds. */
    private const TTL = ['found' => 3600, 'unknown' => 900, 'failed' => 300];

    private const NAME = '/^[a-z0-9._-]{1,64}$/i';

    private const HOST = '/^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/';

    /**
     * @param  (Closure(string): list<string>)|null  $resolveHost  host → all A/AAAA addresses;
     *                                                             injectable for tests (no DNS there)
     */
    public function __construct(private ?Closure $resolveHost = null) {}

    /**
     * Split a NIP-05 identifier the way welshman's `queryProfile` does: the part before the
     * last `@` is the name, a bare domain means `_`.
     *
     * @return array{name: string, domain: string}|null
     */
    public static function parse(string $handle): ?array
    {
        $parts = explode('@', trim($handle));
        $domain = strtolower((string) array_pop($parts));
        $name = $parts === [] ? '_' : implode('@', $parts);

        if (! preg_match(self::NAME, $name) || ! preg_match(self::HOST, $domain)) {
            return null;
        }

        return ['name' => $name, 'domain' => $domain];
    }

    /**
     * @param  list<string>  $handles
     * @return list<array{handle: string, status: string, info: array{pubkey: string, relays: list<string>}|null}>
     */
    public function resolve(array $handles): array
    {
        $results = [];
        $pending = [];

        foreach (array_slice(array_values(array_unique($handles)), 0, self::MAX_HANDLES) as $handle) {
            $target = self::parse($handle);
            if ($target === null) {
                $results[$handle] = ['status' => 'invalid', 'info' => null];

                continue;
            }

            $cached = Cache::get(self::cacheKey($handle));
            if (is_array($cached)) {
                $results[$handle] = $cached;

                continue;
            }

            $pending[$handle] = $target;
        }

        foreach ($this->fetch($pending) as $handle => $outcome) {
            $results[$handle] = $outcome;
            if ($outcome['status'] !== 'throttled') {
                Cache::put(self::cacheKey($handle), $outcome, self::TTL[$outcome['status']] ?? 300);
            }
        }

        $out = [];
        foreach ($results as $handle => $outcome) {
            $out[] = ['handle' => (string) $handle, 'status' => $outcome['status'], 'info' => $outcome['info']];
        }

        return $out;
    }

    /**
     * @param  array<string, array{name: string, domain: string}>  $targets
     * @return array<string, array{status: string, info: array{pubkey: string, relays: list<string>}|null}>
     */
    private function fetch(array $targets): array
    {
        $outcomes = [];
        $requests = [];

        foreach ($targets as $handle => $target) {
            $budgetKey = 'group-nip05-domain:'.$target['domain'];
            if (RateLimiter::tooManyAttempts($budgetKey, self::DOMAIN_BUDGET_PER_MINUTE)) {
                $outcomes[$handle] = ['status' => 'throttled', 'info' => null];

                continue;
            }
            RateLimiter::hit($budgetKey, 60);

            $ip = $this->pinnableAddress($target['domain']);
            if ($ip === null) {
                $outcomes[$handle] = ['status' => 'failed', 'info' => null];

                continue;
            }

            $requests[$handle] = $target + ['ip' => $ip];
        }

        if ($requests === []) {
            return $outcomes;
        }

        /** @var array<string, Response|Throwable> $responses */
        $responses = Http::pool(function (Pool $pool) use ($requests): array {
            $calls = [];
            foreach ($requests as $handle => $request) {
                $calls[] = $pool->as((string) $handle)
                    ->timeout(self::TIMEOUT)
                    ->connectTimeout(self::CONNECT_TIMEOUT)
                    ->accept('application/json')
                    ->withOptions(self::fetchOptions($request['domain'], $request['ip']))
                    ->get('https://'.$request['domain'].'/.well-known/nostr.json', ['name' => $request['name']]);
            }

            return $calls;
        });

        foreach ($requests as $handle => $request) {
            $outcomes[$handle] = self::read($responses[$handle] ?? null, $request['name']);
        }

        return $outcomes;
    }

    /**
     * Guzzle options of one lookup. Public so a test can check the hardening that
     * `Http::fake()` short-circuits (it never reaches the curl handler).
     *
     * @return array<string, mixed>
     */
    public static function fetchOptions(string $domain, string $ip): array
    {
        return [
            'allow_redirects' => false,
            'decode_content' => false,
            'curl' => [CURLOPT_RESOLVE => [$domain.':443:'.(str_contains($ip, ':') ? '['.$ip.']' : $ip)]],
            'progress' => static function (int|float $downloadTotal, int|float $downloaded): void {
                if ($downloadTotal > self::MAX_BYTES || $downloaded > self::MAX_BYTES) {
                    throw new \RuntimeException('nostr.json exceeds the size limit');
                }
            },
        ];
    }

    /**
     * @return array{status: string, info: array{pubkey: string, relays: list<string>}|null}
     */
    private static function read(Response|Throwable|null $response, string $name): array
    {
        $failed = ['status' => 'failed', 'info' => null];
        if (! $response instanceof Response || $response->status() !== 200) {
            return $failed;
        }

        $body = $response->body();
        if ($body === '' || strlen($body) > self::MAX_BYTES) {
            return $failed;
        }

        $json = json_decode($body, true);
        if (! is_array($json) || ! is_array($json['names'] ?? null)) {
            return $failed;
        }

        // Exact lookup, as welshman's `queryProfile` does it.
        $pubkey = $json['names'][$name] ?? null;
        if (! is_string($pubkey) || ! preg_match('/^[0-9a-f]{64}$/', $pubkey)) {
            return ['status' => 'unknown', 'info' => null];
        }

        $relays = $json['relays'][$pubkey] ?? [];
        $relays = is_array($relays)
            ? array_values(array_slice(array_filter($relays, static fn ($url): bool => is_string($url) && preg_match('#^wss?://#i', $url) === 1 && strlen($url) < 256), 0, 20))
            : [];

        return ['status' => 'found', 'info' => ['pubkey' => $pubkey, 'relays' => $relays]];
    }

    /**
     * The one address the connection is pinned to — null unless EVERY record is public.
     */
    private function pinnableAddress(string $host): ?string
    {
        $addresses = ($this->resolveHost ?? self::systemResolve(...))($host);
        if ($addresses === []) {
            return null;
        }

        foreach ($addresses as $ip) {
            if (! filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE)) {
                return null;
            }
        }

        return $addresses[0];
    }

    /**
     * @return list<string>
     */
    private static function systemResolve(string $host): array
    {
        return array_values(array_merge(
            array_column(@dns_get_record($host, DNS_A) ?: [], 'ip'),
            array_column(@dns_get_record($host, DNS_AAAA) ?: [], 'ipv6'),
        ));
    }

    private static function cacheKey(string $handle): string
    {
        return 'group:nip05:v1:'.sha1($handle);
    }
}
