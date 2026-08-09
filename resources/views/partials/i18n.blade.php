{{--
    P2 (Strang C): Übersetzungskatalog der AKTIVEN Sprache für die TS-Insel.

    Muss VOR `@vite` stehen — dieselbe Regel wie bei `window.__nostrSpace`: das
    ES-Modul-Bundle wertet beim Boot bereits Modul-Konstanten aus, die durch
    `t()` laufen (`publishResult.NO_VERDICT_ERROR`, `rail.GROUP_LABEL`,
    `updatesView.BUCKET_LABELS`).

    Die ausführliche Begründung der Bauweise (und die zwei verworfenen
    Alternativen) steht am Mechanismus selbst: `js/i18n.ts`.

    Warum `getLoader()->load()` und nicht `file_get_contents(lang/…)`: der Loader
    liefert GENAU das, was `__()` serverseitig sieht — die JSON-Zeilen des Hosts
    und die per `loadJsonTranslationsFrom()` ergänzten des Pakets, in derselben
    Vorrangfolge. Ein direkt gelesenes Paket-JSON würde eine Host-Überschreibung
    unterschlagen, und die Insel spräche anders als die Blade-Seite daneben.

    Unter `de` gibt es bewusst kein `lang/de.json` → der Katalog ist `{}` und
    `t()` gibt den Schlüssel zurück, also den deutschen Quelltext. Genau wie `__()`.

    Harte Zuweisung (kein `??` wie bei `__nostrSpace`): die Sprache ist eine
    Server-Entscheidung aus Cookie/Session/Accept-Language. Ein vorab gesetzter
    Wert dürfte sie nicht überstimmen — er könnte nur veraltet oder untergeschoben
    sein.
--}}
@php
    /** @var array<string, string> $islandTranslations */
    $islandTranslations = app('translator')->getLoader()->load(app()->getLocale(), '*', '*');
@endphp
<script>window.__nostrI18n = @js($islandTranslations);</script>
