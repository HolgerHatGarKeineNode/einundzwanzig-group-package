<?php

namespace Einundzwanzig\Group;

/**
 * PLAN4 IMG — Server-Pendant zu `proxifyImage()` (js/core.ts) für Blade-gerenderte
 * Bilder (Raum-Header-Avatar). Baut die Proxy-URL gegen den festen Web-Host:
 * Web = relativ, Mobile (NativePHP) = absolut, da die App den Proxy nicht hostet.
 */
class ImageProxy
{
    private const HOST = 'https://group.einundzwanzig.space';

    public static function url(?string $src, string $preset = 'avatar'): string
    {
        $src = (string) $src;
        if (! preg_match('#^https?://#i', $src)) {
            return $src;
        }
        $base = config('nativephp-internal.running') ? self::HOST : '';

        return $base.'/img/'.$preset.'?src='.rawurlencode($src);
    }
}
