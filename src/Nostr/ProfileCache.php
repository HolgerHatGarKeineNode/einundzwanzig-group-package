<?php

declare(strict_types=1);

namespace Einundzwanzig\Group\Nostr;

use Illuminate\Support\Facades\Cache;
use swentel\nostr\Filter\Filter;
use swentel\nostr\Message\RequestMessage;
use swentel\nostr\Relay\Relay;
use swentel\nostr\RelayResponse\RelayResponseEvent;
use swentel\nostr\Request\Request;
use swentel\nostr\Subscription\Subscription;

/**
 * Server-seitiger, GETEILTER Profil-Cache (kind 0) gegen das Namens-/Avatar-Flackern.
 *
 * Nostr bleibt Source of Truth: der Client (welshman) löst Profile weiterhin live
 * auf und überschreibt. Dieser Cache liefert nur den SCHNELLEN, über alle Nutzer
 * geteilten First-Paint — einmal je pubkey geholt (auch Abwesenheit gecacht, gegen
 * Fetch-Stürme), danach instant aus dem Cache. Kein AUTH nötig (kind 0 ist public).
 */
class ProfileCache
{
    private const TTL = 86400;

    /** Profil-Indexer mit bester kind-0-Abdeckung. */
    private const INDEXER = 'wss://purplepag.es/';

    /**
     * Roh-kind-0-Events für die pubkeys (aus Cache; Misses werden geholt + gecacht).
     *
     * @param  array<int, string>  $pubkeys
     * @return array<int, \stdClass>
     */
    public function get(array $pubkeys): array
    {
        $pubkeys = array_values(array_unique(array_filter(
            array_map('strval', $pubkeys),
            static fn (string $pk): bool => preg_match('/^[0-9a-f]{64}$/', $pk) === 1,
        )));

        // Laravel-Cache kann `null` nicht von „nicht gecacht" unterscheiden → `false`
        // als Abwesenheits-Sentinel: null = nicht gecacht, false = bekannt-abwesend.
        $events = [];
        $missing = [];
        foreach ($pubkeys as $pk) {
            $cached = Cache::get(self::key($pk));
            if ($cached === null) {
                $missing[] = $pk;
            } elseif ($cached !== false) {
                $events[] = $cached;
            }
        }

        if ($missing !== []) {
            $fetched = $this->fetchProfiles($missing);
            foreach ($missing as $pk) {
                $event = $fetched[$pk] ?? null;
                Cache::put(self::key($pk), $event ?? false, self::TTL);
                if ($event !== null) {
                    $events[] = $event;
                }
            }
        }

        return $events;
    }

    /**
     * Neuestes kind-0 je pubkey über Indexer + Space-Relay.
     *
     * @param  array<int, string>  $pubkeys
     * @return array<string, \stdClass>
     */
    private function fetchProfiles(array $pubkeys): array
    {
        $byPubkey = [];
        foreach (array_filter([self::INDEXER, SpaceCache::spaceUrl()]) as $url) {
            foreach ($this->fetchFrom($url, $pubkeys) as $event) {
                $pk = $event->pubkey ?? null;
                if ($pk !== null && ($event->created_at ?? 0) > ($byPubkey[$pk]->created_at ?? -1)) {
                    $byPubkey[$pk] = $event;
                }
            }
        }

        return $byPubkey;
    }

    /**
     * Kurzlebige WS-Verbindung: kind 0 der angefragten Autoren bis EOSE. Ein toter
     * Relay darf den Cache nicht sprengen → Fehler schluckt der Aufrufer via Merge.
     *
     * @param  array<int, string>  $pubkeys
     * @return array<int, \stdClass>
     */
    private function fetchFrom(string $url, array $pubkeys): array
    {
        try {
            $filter = (new Filter)->setKinds([0])->setAuthors($pubkeys);
            $request = new Request(
                new Relay($url),
                new RequestMessage((new Subscription)->getId(), [$filter]),
            );

            $events = [];
            foreach ($request->send() as $responses) {
                foreach ($responses as $response) {
                    if ($response instanceof RelayResponseEvent) {
                        $events[] = $response->event;
                    }
                }
            }

            return $events;
        } catch (\Throwable) {
            return [];
        }
    }

    private static function key(string $pubkey): string
    {
        return 'nostr:profile:'.$pubkey;
    }
}
