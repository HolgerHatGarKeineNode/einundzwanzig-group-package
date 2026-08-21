<?php

return [
    /*
     * Fixierter Default-Space (§12): die Relay-URL, die die Web-Client-Insel
     * VOR dem welshman-Boot als `window.__nostrSpace` gesetzt bekommt. Leer =
     * Code-Default (lokaler Test-Relay). Prod setzt die echte Vereins-Relay-URL.
     */
    'space_url' => env('NOSTR_SPACE_URL'),

    /*
     * Zweiter, FESTER Space für den Tab „Workspaces" — ein Buzz-Relay neben dem
     * zooid-Space aus `space_url`. Leer (Default) = der Tab erscheint gar nicht;
     * damit ist das Feature in jedem Host per .env-Zeile zuschaltbar und der
     * bestehende Client verhält sich unverändert.
     *
     * Bewusst NICHT dieselbe Adresse wie `space_url`: zooid bleibt in Betrieb, Buzz
     * bekommt eine eigene Subdomain. Die Adresse muss zeichengenau zu `BUZZ_DOMAIN`
     * des Relays passen, sonst beantwortet er NIP-11 über HTTP, verweigert aber den
     * WebSocket-Upgrade mit 404 — der Client zeigt dann Name und Beschreibung des
     * Space an und keine Räume.
     */
    'workspace_url' => env('NOSTR_WORKSPACE_URL'),

    /*
     * Quelle der Longform-Artikel (P7, NIP-23 kind 30023) — der öffentliche
     * Vereins-Relay, NICHT der Space aus `space_url`. Leer (Default) = der Screen
     * zeigt seinen Leerzustand und schickt keinen einzigen REQ.
     *
     * Bewusst ohne Code-Default auf die echte Adresse: ein Default machte aus einer
     * fehlenden Konfiguration eine stille WebSocket-Verbindung ins öffentliche
     * Internet — genau das, was `profile_indexer` oben für die Testumgebung
     * ausdrücklich abschaltbar hält. Ein E2E-Lauf, der Artikel prüfen will, setzt die
     * Variable auf seinen eigenen Relay (oder `window.__nostrBoard` per
     * `addInitScript`, siehe `partials/head.blade.php`).
     *
     * Der Relay ist zugleich der Kurationsfilter: er ist `restricted_writes`, wer
     * dort schreiben darf, ist kuratiert. Deshalb genügt clientseitig ein Filter auf
     * das Kind — keine Autorenliste, kein `#t`, kein Muster auf dem `d`-Tag.
     */
    'board_relay_url' => env('NOSTR_BOARD_URL'),

    /*
     * P6 — die Relays, auf denen die SOZIALSIGNALE zu den Artikeln liegen: Reaktionen
     * (kind 7), Zap-Quittungen (9735) und Kommentare (1111). Kommagetrennt, z. B.
     * `wss://nos.lol,wss://relay.damus.io`.
     *
     * Dies ist die EINZIGE Ausnahme von der Kuratierungsregel, und sie ist eng: die
     * Artikel selbst (kind 30023) kommen weiterhin ausschließlich vom Board-Relay
     * darüber. Von diesen Adressen werden ausdrücklich nur die drei Kinds oben geholt —
     * Ereignisse ÜBER Artikel, die auf dem Board schlicht nicht liegen.
     *
     * Ebenfalls ohne Code-Default, aus demselben Grund wie `board_relay_url`: sonst
     * verbände sich jede Installation und jeder Testlauf ungefragt mit fremden Relays.
     * Leer heißt, dass nur der Board gefragt wird — am 2026-08-21 über alle 104 Artikel
     * gemessen sieht der 14 % der Reaktionen, 3 % der Zaps und 20 % der Kommentare. Die
     * Zähler sind dann kleiner; nichts bricht.
     *
     * ── WAS DIESE RELAYS ÜBER DEINE LESER ERFAHREN ─────────────────────────────────
     *
     * Der Handel ist nicht nur funktional, und das gehört hierher, wo der Betreiber ihn
     * liest. Jede hier eingetragene Adresse bekommt beim **bloßen Öffnen** einer
     * Artikelfläche — ohne Klick, ohne Zutun des Lesers — eine WebSocket-Verbindung und
     * damit:
     *
     *  · die **IP-Adresse** und den User-Agent des Lesers,
     *  · den **Zeitpunkt**,
     *  · und die angefragten Filter, also **welche Artikel dieser Leser gerade ansieht**.
     *    Die Vollansicht fragt mit genau EINER Artikeladresse.
     *
     * Der **Pubkey** des Lesers geht dabei NICHT hinaus: `js/core.ts` beantwortet
     * NIP-42-AUTH-Challenges dieser Relays seit P6 ausdrücklich nicht mehr (`shouldAuth`
     * → `darfAuthBekommen` in `js/articleMetrics.ts`). Ohne diesen Riegel wäre es die
     * Verknüpfung von Identität und Lesehistorie gewesen.
     *
     * ── EIN ZWEITER ABFLUSS, den diese Variable NICHT abschaltet ──────────────────
     *
     * Um eine Zap-Quittung zu validieren, braucht der Client die LNURL-Metadaten des
     * ARTIKEL-AUTORS — und die holt er mit einer **HTTPS-Anfrage an dessen fremden
     * Wallet-Host** (`getalby.com`, `primal.net`, `walletofsatoshi.com` …). Auch das
     * geschieht beim bloßen Öffnen der Liste, ohne Nutzerhandlung. Dieser Host erfährt
     * IP, Zeitpunkt **und welchen Autor** — der angefragte Pfad trägt dessen lud16-Namen,
     * und auf der Vollansicht ist das genau **einer**. Er erfährt **nicht**, welchen
     * Artikel jemand liest: gemessen überträgt der `Referer` nur den Origin, nie den
     * `naddr` aus der Adresszeile.
     *
     * Fachlich ist der Aufruf nicht vermeidbar: ohne aufgelösten Zapper verwirft
     * welshmans `zapFromEvent` jede Quittung, und es stünde dauerhaft „0 Sats" da.
     *
     * **Er ist aber an den echten Bedarf gekoppelt** (`autorenMitQuittungen` in
     * `js/articleMetrics.ts`): angefragt werden nur die Autoren, für deren Artikel
     * wirklich eine Quittung vorliegt. Am 2026-08-21 gemessen sind das **6 von 12**
     * Autoren — und ohne Metrik-Relais und ohne Zaps auf dem Board sind es **null**.
     *
     * **Die „6" ist eine Bestandsmessung, keine Zusage:** ein Dritter kann die Kopplung
     * mit zwölf gefälschten Quittungen aufheben und die Zahl auf zwölf zurückdrehen. Den
     * Host **wählen** kann er nicht — der kommt aus dem geladenen Board-Bestand, nie aus
     * der Quittung. Härten lässt es sich nicht: die echte Prüfung bräuchte genau die
     * Anfrage, die man vermeiden will. Herleitung bei `autorenMitQuittungen`.
     *
     * **Was diese Variable also leistet, genau:** leer zu lassen schaltet die
     * **Metrik-Relais** ab. Die LNURL-Anfragen schaltet sie **nicht direkt** ab — sie
     * fallen nur deshalb mit weg, weil ohne die Fremdrelais kaum noch Quittungen
     * eintreffen (der Board trägt 5 von 168). Ein Autor mit einer Quittung auf dem Board
     * wird auch dann noch angefragt. Sie hat keinen Default; ein zusätzliches Opt-in in
     * der Oberfläche gibt es bewusst nicht — die Entscheidung liegt beim Betreiber, hier,
     * an einer Stelle.
     */
    'article_relay_urls' => env('NOSTR_ARTICLE_METRIC_RELAYS'),

    /*
     * P5 (Onboarding) — Origin der Vereins-API, z.B. `https://verein.einundzwanzig.space`.
     *
     * Das ist KEIN Geheimnis (der Schlüssel dazu ist eins und bleibt im Proxy,
     * siehe `config/verein.php` des Hosts), aber die Insel braucht den Wert im
     * Browser: der `u`-Tag des NIP-98-Ausweises zielt auf den VEREIN, nicht auf
     * unsere Proxy-Route, und der Verein vergleicht ihn byteweise. Ohne die
     * Basis-URL im Browser wäre jede Signatur wertlos.
     *
     * Dieselbe Env-Variable wie der Proxy (`VEREIN_API_URL`) — eine Adresse, ein
     * Wert. Zwei Quellen könnten auseinanderlaufen, und die Abweichung fiele
     * erst als 401 beim Verein auf.
     *
     * Leer = der Beitritts-Flow existiert nicht; das Vereins-Gate fällt auf
     * seinen Link nach außen zurück (`components/verein-gate.blade.php`).
     */
    'verein_api_url' => env('VEREIN_API_URL', ''),

    /*
     * Origin des Vereins-Proxys. Leer (Default) = derselbe Origin wie die Seite.
     *
     * Der Proxy ist NUR in der gehosteten Web-Instanz registriert
     * (`bootstrap/app.php`: nicht im NativePHP-Lauf, weil „Server-Konfiguration"
     * dort dasselbe wäre wie „Bundle"). Der Mobile-Build ruft deshalb denselben
     * Proxy über HTTPS bei der Web-Instanz auf und trägt kein Geheimnis — dafür
     * und nur dafür gibt es diesen Wert.
     */
    'verein_proxy_base' => env('VEREIN_PROXY_BASE', ''),

    /*
     * P5 — wie lange es nach der Zahlung bis zur Freischaltung dauert, in Minuten.
     *
     * DER EINE WERT. Der Wartezustand nennt bei jedem Übergang eine Dauer, und
     * jede dieser Stellen liest diese Zahl (`vereinFlow.formatWait`). Heute ist
     * die Wahrheit `1440` — der Abgleich läuft als nächtlicher Cron um 00:30
     * (Forge Scheduled Job 2092398). Nach P1 (Frequenz auf viertelstündlich) wird
     * hier `15` eingetragen und KEIN Satz umgeschrieben.
     *
     * `0` = keine Dauer nennen. Eine Zahl zu zeigen, die nicht stimmt, ist an
     * dieser Stelle schlimmer als gar keine — deshalb gibt es diesen Ausweg
     * überhaupt, und deshalb ist er nicht der Default.
     *
     * `is_numeric` statt eines `env()`-Defaults: Laravels Default greift NUR,
     * wenn der Schlüssel ganz fehlt. Eine leere Zeile in der `.env` — genau die
     * Form, in der `.env.example` sie ausliefert — liefert `''`, und `(int) ''`
     * wäre `0`. Der Wartezustand nennte dann keine Dauer, obwohl 1440 gemeint
     * war, und niemand würde es merken.
     */
    'verein_activation_minutes' => is_numeric(env('VEREIN_ACTIVATION_MINUTES'))
        ? (int) env('VEREIN_ACTIVATION_MINUTES')
        : 1440,

    /*
     * Öffentliche Vereinsseite — der Ausweg, wenn der Weg im Client nicht trägt
     * (Proxy nicht konfiguriert, unerwartete Weiterleitung, keine Zahlmethode).
     * Bewusst eine eigene Adresse und nicht `verein_api_url`: die API-Basis kann
     * auf einem eigenen Host liegen, dem eine Beitrittsseite fehlt.
     *
     * `?:` statt eines `env()`-Defaults — gleiche Falle wie oben: eine leere
     * Zeile in der `.env` liefert `''`, und dann führte der letzte Ausweg des
     * Nutzers ins Nichts.
     */
    'verein_public_url' => env('VEREIN_PUBLIC_URL') ?: 'https://verein.einundzwanzig.space/',

    /*
     * Profil-Indexer des SERVER-seitigen kind-0-Caches (`ProfileCache`). Bewusst
     * konfigurierbar statt hartkodiert: es ist die einzige Stelle, an der der Server
     * von sich aus ins öffentliche Internet greift, und in einer hermetischen
     * Testumgebung muss sie abschaltbar sein — die E2E-Suite setzt sie leer
     * (`tests/e2e/support/fixtures.ts`), sonst öffnete jeder Lauf eine echte
     * WebSocket-Verbindung nach draußen.
     *
     * Leer = nur der eigene Space-Relay wird gefragt.
     */
    'profile_indexer' => env('NOSTR_PROFILE_INDEXER', 'wss://purplepag.es/'),

    /*
     * Head-Partial des Group-Vollbild-Layouts. Der Web-Client nutzt seine eigene
     * `partials.head` (mit OG/Favicons). Ein Fremdhost (Portal) setzt hier
     * `group::partials.head` — die lädt nur __nostrSpace + die `group.vite`-Entries.
     */
    'head_partial' => 'partials.head',

    /*
     * Vite-Entries, die `group::partials.head` lädt (nur relevant, wenn
     * head_partial = group::partials.head). Der Fremdhost zeigt hier auf seinen
     * Insel-Entry + das Group-Theme-CSS.
     */
    'vite' => ['resources/css/app.css', 'resources/js/app.ts'],

    /*
     * Rücksprung aus dem Vollbild-Chat in die Host-App. Das Group-Layout ist ein
     * kompletter Vollbild-Takeover (eigene Bottom-Nav) — betreibt die App den
     * Chat als eingebetteten Tab (z.B. einundzwanzig-mobile-app neben „Meetups"),
     * bliebe der Nutzer sonst ohne sichtbaren Ausgang gefangen. Der Host setzt
     * hier eine benannte Route + Label; der App-Header zeigt dann oben links einen
     * „‹ {label}"-Ausgang, der DIREKT dorthin springt (umgeht eine home-Weiche,
     * die chat-eingeloggte Nutzer zurück in den Chat loopen würde).
     * `null` = eigenständiger Web-Client (kein Rücksprung → Brand-Mark bleibt).
     *
     * @var array{route: string, label: string}|null
     */
    'exit' => null,

    /*
     * Nav-Registry der Shell (`<x-group::app-shell>` / `<x-group::bottom-nav>`).
     * Die eigentliche Vereinigung (§8.2): jeder Host publiziert seine Tabs als
     * Config, `bottom-nav` iteriert sie und rendert je Eintrag `<x-group::nav-tab>`.
     * „GENAU N Tabs" ist damit eine Config-Zeile, in jedem Consumer identisch.
     *
     * Default = die drei package-nativen Chat-Tabs (Räume/Mitglieder/Einstellungen),
     * damit das alte Vollbild-Layout unverändert weiterläuft. Hosts überschreiben:
     *   Web → 3 Tabs (Chat · Wallet · Einstellungen), Mobile → 4 (+ Meetups · Mehr).
     *
     * Felder je Eintrag:
     *   key    stabiler Bezeichner (Aktiv-Match für host-injizierte Routen, §10.6)
     *   route  benannte Route (route()-auflösbar)
     *   match  routeIs()-Pattern für den Aktiv-State (Default: route)
     *   icon   Flux-Icon-Name (outline/solid je Aktiv-State)
     *   label  Tab-Beschriftung
     *   gate   'guest' = frei | 'nostr' = Tap ohne pubkey → open-login-sheet
     *
     * @var list<array{key: string, route: string, match?: string, icon: string, label: string, gate: 'guest'|'nostr'}>
     */
    'nav' => [
        ['key' => 'chat', 'route' => 'group.spaces', 'match' => 'group.spaces', 'icon' => 'chat-bubble-left-right', 'label' => 'Räume', 'gate' => 'nostr'],
        ['key' => 'members', 'route' => 'group.directory', 'match' => 'group.directory', 'icon' => 'users', 'label' => 'Mitglieder', 'gate' => 'nostr'],
        ['key' => 'settings', 'route' => 'group.settings', 'match' => 'group.settings,group.space.settings', 'icon' => 'cog-6-tooth', 'label' => 'Einstellungen', 'gate' => 'nostr'],
    ],

    /*
     * Settings-Registry (§4.1): geordnete Liste der Sektions-Keys, die der
     * verschmolzene Settings-Hub (`group::pages.settings`) iteriert und je Key als
     * `group::partials.settings.<key>` einbindet. Sichtbarkeit + Reihenfolge sind
     * damit eine Config-Zeile je Host — exakt wie `nav`. Löst `show_relays` ab
     * (Sichtbarkeit = „ist 'relays' in der Liste?").
     *
     * NUR Keys, KEINE `__()`-Labels: Config lädt VOR der Locale-Middleware (gleiche
     * Falle wie `nav`); Labels kommen aus den Partials via `__()`.
     *
     * Default = voller Satz (Package-nativ). Hosts überschreiben:
     *   Web   → ohne 'relays' (Web-Client editiert/zeigt keine Relays).
     *   Mobile→ mit 'relays', ohne 'wallet' (Wallet ist dort eigener Bottom-Nav-Tab).
     *
     * @var list<string>
     */
    'settings' => ['account', 'space', 'wallet', 'relays', 'blossom', 'appearance', 'language', 'session'],

    /*
     * Sprach-Registry (P2): die Whitelist, gegen die `SetLocale` Cookie und
     * `Accept-Language` prüft, und zugleich die Auswahl des Sprach-Pickers
     * (`partials/settings/language`). Schlüssel = Locale-Code, Wert = ENDONYM
     * (die Sprachbezeichnung IN dieser Sprache).
     *
     * Endonyme laufen bewusst NICHT durch `__()` — anders als die übrigen Labels.
     * Zwei Gründe: (a) Config lädt VOR der Locale-Middleware (dieselbe Falle wie
     * `nav`/`settings`), (b) „Español" heißt in jeder Oberflächensprache Español;
     * ein übersetztes Sprachmenü („Spanisch") ist genau für den unlesbar, der es
     * braucht — er liest die aktuelle Sprache ja nicht.
     *
     * Der ERSTE Eintrag ist der Rückfall, wenn weder Cookie noch Session noch
     * `Accept-Language` etwas Passendes hergeben.
     *
     * Die Codes müssen zu `lang/<code>.json` passen. `de` hat bewusst KEINE Datei:
     * die Quell-Keys sind deutsch (`__('Deutscher Text')`), Laravel gibt den Key
     * zurück, wenn keine Übersetzung existiert.
     *
     * @var array<string, string>
     */
    'locales' => [
        'de' => 'Deutsch',
        'en' => 'English',
        'es' => 'Español',
        'hu' => 'Magyar',
        'lv' => 'Latviešu',
        'nl' => 'Nederlands',
        'pl' => 'Polski',
        'pt' => 'Português',
    ],
];
