<?php

declare(strict_types=1);

namespace Einundzwanzig\Group\Console\Commands;

use Einundzwanzig\Group\Nostr\SpaceCache;
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
            $cache->refreshRelayInfo($url);
        } catch (\Throwable $e) {
            // Relay unerreichbar/langsam: alten Cache behalten, nicht crashen.
            $this->warn('Warmen fehlgeschlagen ('.$url.'): '.$e->getMessage());

            return self::FAILURE;
        }

        $this->info(count($rooms).' Räume gecacht für '.$url);

        $this->warmWorkspace($cache);

        return self::SUCCESS;
    }

    /**
     * Denselben Cache für den zweiten Space wärmen, falls konfiguriert.
     *
     * Seit Workspace-Räume über `/rooms/{h}?space=workspace` direkt erreichbar sind
     * (Reload, Bookmark, geteilter Link), braucht auch dieser Space seine Raum-Namen
     * server-seitig — sonst steht im Kopf und im OG-Tag die rohe Raum-UUID.
     *
     * Eigenes try/catch: der zweite Space darf den Exit-Code des ersten nicht kippen.
     * Der Vereins-Space ist der tragende; ein stiller Workspace ist ein Schönheitsfehler,
     * kein Fehlschlag des Warmlaufs.
     */
    private function warmWorkspace(SpaceCache $cache): void
    {
        $url = SpaceCache::workspaceUrl();

        if ($url === '') {
            return;
        }

        try {
            $rooms = $cache->refreshRooms($url);
            $cache->refreshRelayInfo($url);
            $this->info(count($rooms).' Räume gecacht für '.$url);
        } catch (\Throwable $e) {
            $this->warn('Warmen fehlgeschlagen ('.$url.'): '.$e->getMessage());
        }
    }
}
