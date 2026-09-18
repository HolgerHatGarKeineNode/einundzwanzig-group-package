<?php

declare(strict_types=1);

namespace Einundzwanzig\Group\Portal;

/**
 * How trustworthy is what a {@see PortalCatalog} just handed over?
 *
 * The three values are the ONE reason this enum exists: a read-only Portal page has to
 * say WHY it shows what it shows. „Nothing found" and „nothing loaded" look identical on
 * screen and mean opposite things — the first is an answer, the second is a failure.
 *
 *  · `fresh`   the answer came from the Portal or from a cache entry inside its TTL
 *  · `stale`   the Portal did not answer, but a previously stored copy did (the app's
 *              two-tier cache; on the web `Cache::flexible` serves the stale half while
 *              it revalidates)
 *  · `offline` no answer and no copy — the surface shows its error state, not an empty list
 *
 * The status is per REQUEST, not per call: one stale list among five fresh ones makes the
 * page stale, because the banner speaks about the page.
 */
enum PortalStatus: string
{
    case Fresh = 'fresh';
    case Stale = 'stale';
    case Offline = 'offline';

    /** Does this status deserve a banner? `fresh` is the silent one. */
    public function needsNotice(): bool
    {
        return $this !== self::Fresh;
    }

    /**
     * The worse of two statuses — `offline` beats `stale` beats `fresh`.
     *
     * A page that loaded three lists reports the worst of them: claiming freshness
     * because two thirds of the page are fresh would be the lie described above.
     */
    public function worst(self $other): self
    {
        $rank = [self::Fresh->value => 0, self::Stale->value => 1, self::Offline->value => 2];

        return $rank[$other->value] > $rank[$this->value] ? $other : $this;
    }
}
