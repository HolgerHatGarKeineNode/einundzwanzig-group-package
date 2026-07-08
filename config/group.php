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
];
