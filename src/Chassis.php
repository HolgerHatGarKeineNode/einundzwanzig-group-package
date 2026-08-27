<?php

namespace Einundzwanzig\Group;

/**
 * Das Chassis — welche GEHÄUSEFORM rendert dieser Client gerade?
 *
 * ── Warum es diese Klasse gibt (P2, 2026-08-26) ────────────────────────────
 * Der NativePHP-Laufzeitschalter stand an **zehn** Stellen in sieben
 * Dateien: in vier Views, im Kopf-Partial, in zwei Middlewares und im
 * Bild-Proxy. Zehnmal dieselbe Frage, zehnmal eine eigene lokale Variable
 * (`$native`, `$nativeShell`, `$desktop`) — und drei Docblocks nannten sich je
 * „die EINE Wahrheit" über die Form.
 *
 * Das ist keine Stilfrage. Der Anlassfall steht im Code: bei
 * `NATIVEPHP_RUNNING=true` und 1366 × 1024 fiel der Abstand von 112 px auf
 * 32 px und die fixe Leiste überlappte den Inhalt (gemessen 2026-08-23, Fix
 * `2467bb0`). Eine Frage mit zehn Antwortstellen hat früher oder später zehn
 * verschiedene Antworten.
 *
 * ── Warum eine Methode und kein geteilter View-Wert ────────────────────────
 * `View::share()` beim Boot läse die Config EINMAL pro Prozess. Der
 * Chassis-Test kippt sie aber MITTEN im Lauf
 * (`AppShellChassisTest`: `config(['nativephp-internal.running' => true])`,
 * dann rendern) — ein geteilter Wert wäre dort veraltet und der Test grün aus
 * dem falschen Grund. Deshalb wird zur RENDERZEIT gefragt; neu ist nur, dass
 * genau eine Stelle die Config liest.
 *
 * ── Was diese Klasse NICHT beantwortet ─────────────────────────────────────
 * „schmal oder breit". Das ist eine Frage an die BREITE, und die kennt der
 * Server nicht. Sie gehört ins Stylesheet (`xl:`) und in `$store.viewport`
 * (`form`, drei Werte: `app` · `web-schmal` · `web-breit`). Der Server
 * entscheidet den Host, der Client die Breite — und beide benutzen dieselbe
 * Schwelle, seit `DESKTOP_QUERY` in `rem` misst wie Tailwind.
 */
final class Chassis
{
    /**
     * DIE EINE Stelle im ganzen Paket, an der der NativePHP-Laufzeitschalter
     * gelesen wird. Wer sie zweimal schreibt, baut den Anlassfall nach.
     *
     * (Der Config-Schlüssel steht in dieser Datei bewusst nur EINMAL im
     * Quelltext — die Abnahme dieser Phase zählt seine Vorkommen mit `grep`,
     * und ein Zitat im Kommentar wäre dort ein Treffer.)
     */
    public static function istApp(): bool
    {
        return (bool) config('nativephp-internal.running');
    }

    /**
     * Der Host als WORT — für Blade, für das `data-chassis`-Attribut und für
     * die Übergabe an die Insel. Ein Wort statt eines Booleans, weil die Form
     * im Client drei Werte hat und `false` dort nicht „web-schmal ODER
     * web-breit" heißen soll.
     */
    public static function host(): string
    {
        return self::istApp() ? 'app' : 'web';
    }
}
