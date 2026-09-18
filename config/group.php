<?php

use Einundzwanzig\Group\Shell\AreaRegistry;

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
     * P2 — the relays a meetup's NIP-52 DATES live on (kind 31923) and that this client
     * writes its RSVPs to (kind 31925). Comma separated, e.g.
     * `wss://nos.lol,wss://relay.damus.io`.
     *
     * **This is the PORTAL's address, not ours.** The association portal has signed and
     * published its meetups and dates itself since 2026-09-04 (`einundzwanzig-portal`,
     * `nostr:publish-calendar`, every five minutes) — to the relays from ITS own
     * `NOSTR_RELAYS` (`config/services.php`, default `wss://nos.lol,wss://relay.damus.io`).
     * If the portal's production instance differs, ITS value belongs here; otherwise the
     * client asks the wrong relay and falls back to the HTTP source in every room.
     *
     * No code default, for the same reason as `board_relay_url`: a default turns a
     * missing configuration into a silent WebSocket connection to the public internet,
     * and an E2E run would go red against the relay guard immediately. Empty means: the
     * date card keeps showing the HTTP date from `/api/mobile/meetups` and sends NO REQ.
     *
     * ── What these relays learn about your readers ────────────────────────────────
     *
     * On the bare opening of a MEETUP room — no click, nothing the reader does — they get
     * a WebSocket connection and with it the IP address, the user agent, the time and the
     * filters asked for, i.e. **which meetup this reader is looking at** (the filter
     * carries exactly one coordinate). The **pubkey** does not go out: `js/relayConfig.ts`
     * puts these addresses into the same AUTH block as the metric relays above. Whoever
     * accepts an invitation does of course reveal their pubkey — a kind 31925 carries it
     * in the clear — but that only happens on a button press, and the surface says so
     * next to the button.
     */
    'calendar_relay_urls' => env('NOSTR_CALENDAR_RELAYS'),

    /*
     * P2 — the pubkeys (hex, comma separated) whose kind 31923 counts as a date of a
     * meetup. Without this value the client asks for **nothing at all**.
     *
     * **The author filter is half the surface, not a hardening.** A kind 31923 is a
     * public kind on public relays, and the `a` tag that binds a date to a meetup
     * calendar is a CLAIM: anybody may publish an event carrying our coordinate. Measured
     * 2026-09-05, a bare `nak req -k 31923 -l 100 wss://nos.lol` returned 100 events from
     * 16 authors — baseball fixtures, Brazilian concerts, and two different keys
     * publishing the same Austrian club's dates byte for byte. Without `authors` the room
     * header would show whatever a stranger points at it.
     *
     * The measured production value is ONE key:
     * `daf83d92768b5d0005373f83e30d4203c0b747c170449e02fea611a0da125ee6`
     * (`npub1mturmynk3dwsqpfh87p7xr2zq0qtw37pwpzfuqh75cg6pksjtmnqqxv6kw`, kind 0
     * "Einundzwanzig Portal", `website: portal.einundzwanzig.space`). It belongs in
     * `.env.example`, not here — but a LIST is provided for, because the calendar
     * coordinate embeds the author: after a key rotation every previously published date
     * would otherwise be unfindable.
     */
    'calendar_authors' => env('NOSTR_CALENDAR_AUTHORS'),

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
     * Öffentliche Creator-Seite des eigenen Ökosystems — das Ziel der Profil-Verweise
     * („Profil auf … ansehen" in der Profilkarte und auf der Autorenseite). Statt Leute
     * auf njump oder einen fremden Client zu schicken, schließt der Verweis den Loop im
     * eigenen Haus.
     *
     * **Der Wert ist das GANZE Präfix vor `/u/…`, nicht nur der Host.**
     * `media.einundzwanzig.space` ist eine Vue-SPA mit `createWebHashHistory`
     * (`~/Code/standup`, `src/router/index.js:1` und `:228`); die Profilroute ist
     * `/u/:identifier` und liegt damit HINTER dem Hash. Gemessen am 2026-08-21 antwortet
     * der Host trotzdem auf BEIDE Formen mit 200: `/#/u/…` ist die reine SPA-Route,
     * `/u/…` leitet in dieselbe SPA und liefert zusätzlich profilspezifische OG-Tags
     * (`og:title` mit dem echten Namen, `og:image` mit dem echten Avatar).
     *
     * **Der Default ist deshalb der Klarpfad OHNE `#`** — Entscheidung des Auftraggebers
     * am 2026-08-21, und sie hängt an einem Argument: dieser Verweis ist zum Teilen da.
     * Ein in Telegram oder Signal geteilter Profil-Link zeigt in dieser Form Name und Bild
     * des Autors, in der Hash-Form nur die generische Karte. Es ist zugleich die Form, die
     * media. in seinem EIGENEN Teilen-Dialog baut (`src/views/CreatorPage.vue:221-223`).
     *
     * Wer die reine SPA-Route will, hängt in der `.env` ein `#` an — eine Zeile, kein
     * Code-Umbau. **Dann aber in Anführungszeichen**, siehe unten.
     *
     * **`env(…, default)` und ausdrücklich NICHT `?:`** — anders als bei
     * `verein_public_url` darüber, und genau deshalb steht es hier: Laravels Default
     * greift nur, wenn der Schlüssel ganz FEHLT; eine leere Zeile liefert `''`
     * (am 2026-08-21 gegen `vlucas/phpdotenv` gemessen). Damit trägt eine leere Zeile
     * eine Bedeutung, und die ist hier gewollt:
     *
     * **Leer = kein Verweis.** Dann entfällt die Zeile auf beiden Flächen ganz, statt auf
     * eine kaputte Adresse zu zeigen — dieselbe Regel wie bei
     * `NOSTR_ARTICLE_METRIC_RELAYS`. Ein fremder Host (Portal, Mobile-Build eines anderen
     * Vereins) soll den Verweis abschalten können, ohne Code anzufassen. Bei
     * `verein_public_url` wäre dasselbe sinnlos — dort ist der Wert der letzte Ausweg des
     * Nutzers und darf nie fehlen.
     *
     * ── Ein `#` in der `.env` MUSS in Anführungszeichen stehen ───────────────────────
     * Der heutige Default braucht keins — diese Warnung trotzdem, denn sie gilt für den
     * einen Handgriff, den der Absatz oben ausdrücklich anbietet. Am 2026-08-21 gemessen
     * schneidet `phpdotenv` ein unquotiertes `#` samt Rest ab: aus
     * `MEDIA_PUBLIC_URL=https://media.einundzwanzig.space/#` wird still
     * `https://media.einundzwanzig.space/`. Die Hash-Route fiele damit lautlos auf den
     * Klarpfad zurück, und weil media. BEIDE beantwortet, fiele es niemandem auf — wer
     * zurückstellt, hielte die Umstellung für vollzogen. Die Fassung mit `"…"` kommt
     * unversehrt an. `.env.example` sagt es an der Zeile, und
     * `tests/Feature/MediaProfilLinkTest.php` hält die Warnung fest.
     */
    'media_public_url' => env('MEDIA_PUBLIC_URL', 'https://media.einundzwanzig.space'),

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
     * ── The shell's route registry (Concept C "One Entrance", P2) ─────────────────
     *
     * The bottom nav is no longer a config list. It has exactly THREE slots (Start ·
     * Search · Postfach) as fixed markup in `components/bottom-nav.blade.php`; what a
     * host may still redirect is WHERE those three, the avatar and the settings hub
     * point. The keys are flat and single-valued on purpose: the merge is shallow
     * (`mergeConfigFrom` → `array_merge` on the top level), so a nested override would
     * silently replace the whole subtree.
     *
     * `exit`, `nav` and the companion's `unified_shell` are gone with this phase — a
     * config-driven N-tab bar invites drift, and the design has three slots.
     */
    'start_route' => 'group.start',

    /*
     * The avatar in the app header points here ("Ich"). Guests get the login sheet
     * instead; the decision is made client-side, because on the app the login state
     * lives only in `localStorage` (D4).
     */
    'me_route' => 'group.ich',

    /*
     * The route that means „Einstellungen" in this host.
     *
     * Read by the command palette, the Ich page and the Start tiles. Default is the
     * package hub (`group::pages.settings`, which iterates `settings` below). A host
     * that mounts the sections elsewhere names its own route here — but since P2 the
     * companion no longer does: its app-only sections are injected INTO this registry
     * (`view:…` entries, see `settings`), so there is one settings place, not two.
     *
     * Deliberately a ROUTE and not an href: `route()` throws on a typo, a wrong URL
     * would fail silently.
     */
    'settings_route' => 'group.ich.einstellungen',

    /*
     * Origin of the association portal. The `meetups`/`kurse` tiles link there until
     * P4 builds the read-only pages in the package (D9), and the palette's Portal
     * sections (P4) read the same value.
     */
    'portal_url' => env('PORTAL_URL', 'https://portal.einundzwanzig.space'),

    /*
     * "Alle Bereiche" — the tile grid on Start. Source of truth is
     * `Einundzwanzig\Group\Shell\AreaRegistry`; a host passes its own route targets
     * there instead of copying the list (the shallow merge would otherwise force a
     * full copy, and a copy drifts).
     *
     * @var list<array{key: string, route: string|null, path?: string, icon: string, gate: 'guest'|'nostr', requires?: string}>
     */
    'areas' => AreaRegistry::defaults(),

    /*
     * Ordered entries of the „Ich" page. Keys map to `group::partials.ich.<key>`;
     * a host may inject its own with a `view:` prefix (same mechanism as `settings`).
     *
     * @var list<string>
     */
    'ich' => ['identitaet', 'wallet', 'verein', 'lesezeichen', 'einstellungen'],

    /*
     * The views `/bereich/meetups` offers (P4). Listed here already because the
     * companion adds `karte` — a view only the app can bind (Leaflet + native
     * location) — and P2's redirect map has to know the token set.
     *
     * @var list<string>
     */
    'meetup_views' => ['liste', 'termine'],

    /*
     * The view that RENDERS `?ansicht=karte` (P4). `null` (default) = this host has no
     * map: the meetups page then links to the Portal's map instead of offering a tab
     * that leads nowhere.
     *
     * A host view and not a package one, because the map is the one Portal surface whose
     * ingredients are host-owned: Leaflet plus marker clustering (~150 kB) and, in the
     * app, the device location. Shipping that in the package would put it in the
     * association's embed as well, which needs four chat views and no map.
     *
     * The view is included with `$meetups` (list<PortalMeetup>) in scope.
     */
    'meetup_map_view' => null,

    /*
     * The host's block at the END of a Portal detail page (P4) — `null` = none.
     *
     * Read-only pages, one host-specific exception (D9): on the web this is the way OUT
     * („Im Portal bearbeiten"), in the app it is the way IN — its editor sheets, which
     * need a Portal token the package knows nothing about. Both are the same slot
     * because it is the same question („what can I do with this object beyond reading
     * it?"), and a package that answered it itself would answer it wrong in one host.
     *
     * Included with `$portalLink` (string) and, where the object has one, `$meetupId` /
     * `$courseId` / `$lecturerId` in scope.
     */
    'portal_detail_actions' => null,

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
     *   Mobile→ mit 'relays', ohne 'wallet' (Wallet ist dort eigener Bereich).
     *
     * ── Host-injected sections (P2) ───────────────────────────────────────────────
     * An entry prefixed `view:` is included as a HOST view instead of a package
     * partial: `view:partials.settings.region` → `@includeIf('partials.settings.region')`.
     * That is how `twenty-one-companion` folds its app-only sections (region, push,
     * portal connection, about) into this one hub instead of keeping a second
     * settings screen — the reason `settings_route` no longer points away there.
     *
     * @var list<string>
     */
    'settings' => ['account', 'space', 'wallet', 'relays', 'blossom', 'mutes', 'appearance', 'language', 'session'],

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
