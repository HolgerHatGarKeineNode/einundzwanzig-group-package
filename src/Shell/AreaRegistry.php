<?php

declare(strict_types=1);

namespace Einundzwanzig\Group\Shell;

/**
 * The ONE list of areas the Start page turns into tiles ("Alle Bereiche", D4).
 *
 * **Why a class and not just an array in `config/group.php`.** The merge is shallow
 * (`GroupServiceProvider::mergeConfigFrom`, `array_merge` on the top level), so a host
 * that wants to redirect ONE tile has to publish the WHOLE list — and a copied list is a
 * second truth that drifts. `defaults()` keeps the list here and takes the per-host
 * overrides as an argument, so `twenty-one-companion` names its two deviations and
 * inherits every other entry, including ones added later.
 *
 * Fields per entry:
 *   key       stable identifier; the label comes from Blade via `__()` (config loads
 *             BEFORE the locale middleware — the same trap the old `nav` registry had)
 *   route     named route inside this host, or null for an outward link
 *   path      path appended to `config('group.portal_url')` when `route` is null
 *   icon      Flux icon name
 *   gate      'guest' = open | 'nostr' = tap without a pubkey opens the login sheet
 *   requires  config key under `group.` that must be non-empty for the tile to exist
 */
final class AreaRegistry
{
    /**
     * @param  array<string, string>  $routes  key => named route, replacing that entry's
     *                                         outward link (P2: the companion binds
     *                                         `meetups`/`kurse` to its own Portal pages
     *                                         until P4 builds them in the package)
     * @return list<array{key: string, route: string|null, path?: string, icon: string, gate: 'guest'|'nostr', requires?: string}>
     */
    public static function defaults(array $routes = []): array
    {
        /*
         * `/bereich/meetups` and `/bereich/kurse` do NOT exist in P2 — their content is
         * D9 and arrives with P4. Until then these two tiles leave the client: on web to
         * the Portal, in the companion to its own existing pages (the `$routes`
         * argument). Both forms are reachable, neither is a route that would 404.
         */
        $areas = [
            ['key' => 'chat', 'route' => 'group.bereich.chat', 'icon' => 'chat-bubble-left-right', 'gate' => 'nostr', 'requires' => 'space_url'],
            ['key' => 'meetups', 'route' => null, 'path' => '/meetups', 'icon' => 'map-pin', 'gate' => 'guest', 'requires' => 'portal_url'],
            ['key' => 'artikel', 'route' => 'group.bereich.artikel', 'icon' => 'document-text', 'gate' => 'guest', 'requires' => 'board_relay_url'],
            ['key' => 'forge', 'route' => 'group.bereich.forge', 'icon' => 'code-bracket', 'gate' => 'nostr', 'requires' => 'workspace_url'],
            ['key' => 'leute', 'route' => 'group.bereich.leute', 'icon' => 'users', 'gate' => 'nostr', 'requires' => 'space_url'],
            ['key' => 'wallet', 'route' => 'group.bereich.wallet', 'icon' => 'bolt', 'gate' => 'nostr'],
            ['key' => 'kurse', 'route' => null, 'path' => '/courses', 'icon' => 'academic-cap', 'gate' => 'guest', 'requires' => 'portal_url'],
            ['key' => 'verein', 'route' => 'group.ich.verein', 'icon' => 'identification', 'gate' => 'nostr', 'requires' => 'verein_api_url'],
        ];

        if ($routes === []) {
            return $areas;
        }

        return array_map(static function (array $area) use ($routes): array {
            if (isset($routes[$area['key']])) {
                $area['route'] = $routes[$area['key']];
                unset($area['path']);
            }

            return $area;
        }, $areas);
    }
}
