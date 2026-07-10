<?php

return [
    /*
     * Fixierter Default-Space (§12): die Relay-URL, die die Web-Client-Insel
     * VOR dem welshman-Boot als `window.__nostrSpace` gesetzt bekommt. Leer =
     * Code-Default (lokaler Test-Relay). Prod setzt die echte Vereins-Relay-URL.
     */
    'space_url' => env('NOSTR_SPACE_URL'),

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
        ['key' => 'settings', 'route' => 'group.space.settings', 'match' => 'group.space.settings', 'icon' => 'cog-6-tooth', 'label' => 'Einstellungen', 'gate' => 'nostr'],
    ],
];
