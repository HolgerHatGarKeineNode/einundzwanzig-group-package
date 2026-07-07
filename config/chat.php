<?php

return [
    /*
     * Fixierter Default-Space (§12): die Relay-URL, die die Web-Client-Insel
     * VOR dem welshman-Boot als `window.__nostrSpace` gesetzt bekommt. Leer =
     * Code-Default (lokaler Test-Relay). Prod setzt die echte Vereins-Relay-URL.
     */
    'space_url' => env('NOSTR_SPACE_URL'),

    /*
     * Head-Partial des Chat-Vollbild-Layouts. Der Web-Client nutzt seine eigene
     * `partials.head` (mit OG/Favicons). Ein Fremdhost (Portal) setzt hier
     * `chat::partials.head` — die lädt nur __nostrSpace + die `chat.vite`-Entries.
     */
    'head_partial' => 'partials.head',

    /*
     * Vite-Entries, die `chat::partials.head` lädt (nur relevant, wenn
     * head_partial = chat::partials.head). Der Fremdhost zeigt hier auf seinen
     * Insel-Entry + das Chat-Theme-CSS.
     */
    'vite' => ['resources/css/app.css', 'resources/js/app.ts'],
];
