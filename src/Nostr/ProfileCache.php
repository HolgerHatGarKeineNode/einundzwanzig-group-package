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
 * geteilten First-Paint — einmal je pubkey geholt, danach instant aus dem Cache.
 * Kein AUTH nötig (kind 0 ist public).
 *
 * Abwesenheit wird ebenfalls gecacht (sonst wäre jeder unbekannte Pubkey eine
 * Relay-Runde pro Seitenaufruf), aber KÜRZER und mit wachsender Frist statt fest —
 * die Begründung steht bei {@link MISS_TTL_FIRST}.
 */
class ProfileCache
{
    /** Ein gefundenes kind 0 bleibt einen Tag liegen. */
    private const TTL = 86400;

    /**
     * ── Abwesenheit gilt kürzer und nicht unbedingt ──
     *
     * Bis hierher lag ein Fehlversuch genauso lange im Cache wie ein Treffer: 24 h,
     * ohne Invalidierung. Ein einziger Fehlgriff — ein Indexer, der gerade nicht
     * antwortet, eine WS-Verbindung, die in denselben Sekundenbruchteil fällt — blendete
     * einen Pubkey damit für einen ganzen Tag aus dem First Paint aus. Gemessen genau
     * das beim Eigentümer des Vereins, dessen kind 0 `purplepag.es` durchgehend
     * ausliefert. Client-seitig heilt welshman den Ausfall Sekunden später; server-seitig
     * war er ein Dauerschaden pro Tag.
     *
     * **Die Frist wächst statt fest zu sein**, und zwar aus zwei Richtungen:
     *
     * - *Nach unten* begrenzt sie der Indexer-Schutz. `get()` läuft in jedem
     *   Server-Rendering; eine Frist von 0 (oder wenigen Sekunden) machte aus jedem
     *   Seitenaufruf eine WS-Runde je unbekanntem Pubkey — bei einer Mitgliederliste
     *   mit 50 Namen und zehn gleichzeitigen Lesern eine Lastpumpe auf fremde Relays.
     *   60 s deckelt das auf einen Versuch je Pubkey und Minute und ist zugleich kurz
     *   genug, dass ein frisch veröffentlichtes Profil erscheint, bevor jemand es für
     *   kaputt hält.
     * - *Nach oben* begrenzt sie der Normalfall. `sources()` fragt Indexer + Vereins-
     *   Space, nie den Workspace: ein Pubkey, der nur dort ein Profil hat, ist hier
     *   **immer** ein Fehlversuch. Für ihn darf keine Dauerabfrage entstehen — deshalb
     *   verdoppelt sich die Frist mit jedem weiteren Fehlversuch (60 s, 2 min, 4 min …)
     *   und stößt mit dem 12. Versuch an den Deckel von 24 h. Der Preis der Reparatur
     *   ist damit beziffert und nachgerechnet: die Wartezeiten summieren sich auf
     *   60·(2^n − 1) s, ein solcher Pubkey kostet am ERSTEN Tag also elf Abfragen
     *   (60·(2^11 − 1) = 34 h > 24 h) und danach genau eine pro Tag wie bisher — nie
     *   mehr Dauerlast als vor dieser Änderung.
     *
     * Ein Treffer setzt den Zähler zurück, weil er den Eintrag ersetzt.
     */
    private const MISS_TTL_FIRST = 60;

    /** Deckel der Fehlversuchs-Frist = TTL eines Treffers. Nie schlechter als vorher. */
    private const MISS_TTL_MAX = self::TTL;

    /**
     * Wie lange der ZÄHLER überlebt — deutlich länger als die Frist, die er bemisst.
     *
     * Er muss seine eigene Wartezeit überdauern, sonst begänne jeder Versuch wieder bei
     * 60 s und die Verdopplung käme nie an ihrem Deckel an (genau die Lastpumpe, die sie
     * verhindern soll). Sieben Tage: ein Pubkey, nach dem eine Woche lang niemand
     * gefragt hat, darf von vorn anfangen.
     */
    private const MISS_MEMORY_TTL = 604800;

    /**
     * Die Relays, die dieser Cache befragt: Profil-Indexer (beste kind-0-Abdeckung)
     * + der eigene Space. Der Indexer ist konfigurierbar und in der E2E-Suite LEER —
     * er ist die einzige Stelle, an der der Server von sich aus ins öffentliche
     * Internet greift, und ein Testlauf darf das nicht tun.
     *
     * @return array<int, string>
     */
    private static function sources(): array
    {
        return array_values(array_filter([
            (string) config('group.profile_indexer', ''),
            SpaceCache::spaceUrl(),
        ]));
    }

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

        // Laravel-Cache kann `null` nicht von „nicht gecacht" unterscheiden. Drei
        // Werteformen liegen deshalb im Store: ein \stdClass = Treffer, ein
        // Fehlversuchs-Protokoll (siehe {@link missRecord}) = bekannt-abwesend,
        // `false` = dasselbe in der ALTEN Form (Einträge, die beim Ausrollen dieser
        // Änderung schon lagen; sie laufen binnen 24 h aus und werden bis dahin wie
        // bisher behandelt — ein sofortiger Nachfass für alle wäre ein Ansturm auf die
        // Indexer, ausgelöst von einem Deploy).
        $now = time();
        $events = [];
        $missing = [];
        $attempts = [];
        foreach ($pubkeys as $pk) {
            $cached = Cache::get(self::cacheKey($pk));
            if ($cached === null) {
                $missing[] = $pk;
            } elseif ($cached === false) {
                continue;
            } elseif (is_array($cached)) {
                if ((int) ($cached['retry_after'] ?? 0) <= $now) {
                    $missing[] = $pk;
                    $attempts[$pk] = (int) ($cached['attempts'] ?? 0);
                }
            } else {
                $events[] = $cached;
            }
        }

        if ($missing !== []) {
            $fetched = $this->fetchProfiles($missing);
            foreach ($missing as $pk) {
                $event = $fetched[$pk] ?? null;
                if ($event !== null) {
                    // Der Treffer ERSETZT das Protokoll — die Invalidierung des
                    // Fehlversuchs ist damit keine eigene Operation, die man vergessen kann.
                    Cache::put(self::cacheKey($pk), $event, self::TTL);
                    $events[] = $event;
                } else {
                    Cache::put(self::cacheKey($pk), self::missRecord(($attempts[$pk] ?? 0) + 1, $now), self::MISS_MEMORY_TTL);
                }
            }
        }

        return $events;
    }

    /**
     * Wie lange nach dem `$attempt`-ten Fehlversuch nicht erneut gefragt wird:
     * 60 s, 2 min, 4 min … gedeckelt bei 24 h (erreicht mit dem 11. Versuch).
     *
     * Öffentlich, weil die Frist die eigentliche Entscheidung dieser Klasse ist und
     * direkt prüfbar sein soll — nicht nur über ihre Wirkung im Cache.
     */
    public static function missBackoffSeconds(int $attempt): int
    {
        $steps = max(0, $attempt - 1);
        // Vor dem Potenzieren deckeln: 2**($attempt-1) läuft sonst bei genügend vielen
        // Versuchen in den Float-Bereich (und `min` danach rettet den Typ nicht mehr).
        if ($steps >= 32) {
            return self::MISS_TTL_MAX;
        }

        return (int) min(self::MISS_TTL_MAX, self::MISS_TTL_FIRST * (2 ** $steps));
    }

    /**
     * Das Protokoll eines Fehlversuchs: wie oft schon, und ab wann wieder gefragt wird.
     *
     * @return array{attempts: int, retry_after: int}
     */
    private static function missRecord(int $attempts, int $now): array
    {
        return ['attempts' => $attempts, 'retry_after' => $now + self::missBackoffSeconds($attempts)];
    }

    /**
     * Neuestes kind-0 je pubkey über Indexer + Space-Relay.
     *
     * `protected` als **Testnaht**, nicht als Erweiterungspunkt: die Frist-Logik über
     * dieser Methode ist die eigentliche Entscheidung dieser Klasse, und sie ohne
     * Relay prüfbar zu halten ist der Unterschied zwischen einem Test und einem
     * Netzzugriff im Testlauf (der Indexer ist in der E2E-Suite aus genau diesem Grund
     * leer konfiguriert). Produktiv überschreibt das niemand.
     *
     * @param  array<int, string>  $pubkeys
     * @return array<string, \stdClass>
     */
    protected function fetchProfiles(array $pubkeys): array
    {
        $byPubkey = [];
        foreach (self::sources() as $url) {
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

    /**
     * Cache-Schlüssel je pubkey UND je Relay-Quellenmenge.
     *
     * Der Zusatz ist nicht kosmetisch: gecacht wird auch die ABWESENHEIT (als
     * Fehlversuchs-Protokoll mit wachsender Frist). „Bei diesen Relays nicht gefunden" sagt aber nichts über eine andere
     * Relay-Menge aus — und der Cache-Store ist geteilt. Ohne die Namensräume
     * schrieb ein E2E-Lauf (worker-eigener Test-Relay, kein Indexer) sein
     * „abwesend" in denselben Schlüssel, aus dem die Dev-App liest, und umgekehrt.
     * Genau diese Verschränkung stand hinter der Profil-Verseuchung, die den
     * wochenlangen `storage-cache`-Flake getragen hat.
     *
     * Ein Konfigurationswechsel invalidiert damit automatisch — richtig so, denn
     * die Antwort hing an der alten Quelle.
     */
    public static function cacheKey(string $pubkey): string
    {
        return 'nostr:profile:'.substr(md5(implode('|', self::sources())), 0, 8).':'.$pubkey;
    }
}
