<?php

declare(strict_types=1);

namespace App\Chat\Console\Commands;

use App\Chat\Nostr\SpaceCache;
use Illuminate\Console\Command;

/**
 * Wärmt den Read-Through-Cache (§10/M7): zieht die Raum-Metadaten des
 * Default-Space für schnelleren First-Paint + per-Raum-OG-Tags. Läuft
 * geplant (routes/console.php), nie im Request-Pfad.
 */
class WarmNostrCache extends Command
{
    protected $signature = 'nostr:warm-cache';

    protected $description = 'Wärmt den Read-Cache (Raum-Metadaten) für First-Paint & OG-Tags';

    public function handle(SpaceCache $cache): int
    {
        $url = SpaceCache::spaceUrl();

        try {
            $rooms = $cache->refreshRooms($url);
        } catch (\Throwable $e) {
            // Relay unerreichbar/langsam: alten Cache behalten, nicht crashen.
            $this->warn('Warmen fehlgeschlagen ('.$url.'): '.$e->getMessage());

            return self::FAILURE;
        }

        $this->info(count($rooms).' Räume gecacht für '.$url);

        return self::SUCCESS;
    }
}
