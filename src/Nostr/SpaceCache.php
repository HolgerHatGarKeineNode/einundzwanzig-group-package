<?php

declare(strict_types=1);

namespace App\Chat\Nostr;

use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Cache;
use swentel\nostr\Filter\Filter;
use swentel\nostr\Message\RequestMessage;
use swentel\nostr\Relay\Relay;
use swentel\nostr\RelayResponse\RelayResponseEvent;
use swentel\nostr\Request\Request;
use swentel\nostr\Subscription\Subscription;

/**
 * Server-seitiger Read-Through-Cache für öffentliche Space-Daten (§10/M7).
 *
 * Nie autoritativ, sieht nie einen Key: ein Scheduled Command wärmt die
 * Raum-Metadaten (kind 39000) einmalig via kurzlebiger WS-Verbindung; die
 * Livewire-SFCs lesen daraus für First-Paint-Titel + OG-Tags. Cache-Miss = leer
 * → die welshman-Insel füllt ohnehin live nach.
 */
class SpaceCache
{
    private const TTL = 3600;

    /** Fixierter Default-Space (spiegelt `DEFAULT_SPACE_URL` der Insel). */
    public static function spaceUrl(): string
    {
        return config('nostr.space_url') ?: 'ws://localhost:3334/';
    }

    /**
     * Gecachte Raum-Metadaten je `h`. Leer bei Cache-Miss.
     *
     * @return array<string, array{name: string, about: string}>
     */
    public function rooms(string $url): array
    {
        return Cache::get(self::key($url), []);
    }

    /**
     * Liest kind 39000 vom Relay und cached Name/Beschreibung je Raum.
     *
     * @return array<string, array{name: string, about: string}>
     */
    public function refreshRooms(string $url): array
    {
        $rooms = self::parseRooms($this->fetchEvents($url, [39000]));
        Cache::put(self::key($url), $rooms, self::TTL);

        return $rooms;
    }

    /**
     * Baut aus 39000-Events die Map `h => {name, about}`.
     *
     * @param  array<int, \stdClass>  $events
     * @return array<string, array{name: string, about: string}>
     */
    public static function parseRooms(array $events): array
    {
        $rooms = [];
        foreach ($events as $event) {
            $tags = collect($event->tags ?? []);
            $h = self::tag($tags, 'd');
            if ($h === null) {
                continue;
            }
            $rooms[$h] = [
                'name' => self::tag($tags, 'name') ?? $h,
                'about' => self::tag($tags, 'about') ?? '',
            ];
        }

        return $rooms;
    }

    private static function key(string $url): string
    {
        return 'nostr:rooms:'.$url;
    }

    /**
     * @param  Collection<int, array<int, string>>  $tags
     */
    private static function tag(Collection $tags, string $name): ?string
    {
        return $tags->firstWhere(fn ($t) => ($t[0] ?? null) === $name)[1] ?? null;
    }

    /**
     * Kurzlebige WS-Verbindung: alle Events der Kinds ziehen, bis EOSE.
     *
     * @param  array<int, int>  $kinds
     * @return array<int, \stdClass>
     */
    private function fetchEvents(string $url, array $kinds): array
    {
        $request = new Request(
            new Relay($url),
            new RequestMessage((new Subscription)->getId(), [(new Filter)->setKinds($kinds)]),
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
    }
}
