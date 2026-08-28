/**
 * Optimistisch publizieren — **eine** Fassung für Chat und Artikelfläche.
 *
 * ── Warum das eine eigene Datei ist und keine Zeile in `feeds.ts` ───────────────────
 *
 * Diese fünf Zeilen standen bis P7 privat in `feeds.ts` und hatten dort genau einen
 * Nutzerkreis: den Chat. P7 gibt der Artikelfläche Reaktionen und Kommentare, und damit
 * standen zwei Wege offen, beide schlecht:
 *
 *  - **`feeds.ts` aus `longformFeed.ts` importieren.** `feeds.ts` ist das Chat-Modul
 *    (über 2 000 Zeilen samt Emoji-Picker, Threads, Polls, Zap-Tally). Die Artikelfläche
 *    lädt ihren Fachcode per `import('./longformFeed')` in einen eigenen Chunk; ein
 *    Wertimport von `feeds.ts` zöge den ganzen Chat dort hinein. Dieselbe Kante, gegen
 *    die `bundleGrenze.nodetest.ts` schon einmal gebaut wurde (`longform.ts` →
 *    markdown-it, +48 kB gzip in JEDEM Chunk).
 *  - **Die fünf Zeilen kopieren.** Dann gäbe es zwei Antworten auf die Frage „was
 *    passiert bei einem Relay-Reject" — und die zweite altert unbemerkt. Genau dieser
 *    Riss ist im Haus schon einmal aufgetreten (`isCappedEvent`, siehe `storage.ts`).
 *
 * Also: eine kleine Datei, die beide importieren. Sie zieht nur `@welshman/app` (das im
 * Boot-Pfad ohnehin liegt) und `publishResult.ts` (kein welshman).
 */
import { app, Thunks, type ThunkOptions } from './welshmanApp.ts'
import { mapRelayError, waitForPublishError } from './publishResult.ts'

/**
 * Publiziert ein Event optimistisch (der Thunk legt es sofort ins Repository → die UI
 * zeigt es ohne Round-Trip) und wartet auf die Relay-Bestätigung.
 *
 * **Bei Reject wird das optimistisch eingelegte Event zurückgenommen.** welshman tut das
 * von sich aus nur bei einem Abbruch, nicht bei einem Relay-Reject — ohne die Rücknahme
 * bliebe ein Kommentar sichtbar stehen, den der Relay nie angenommen hat. Auf der
 * Artikelfläche wäre das besonders heimtückisch: dort ist die Ablehnung der NORMALFALL
 * für jeden ohne verifizierte NIP-05-Adresse (`wss://nostr.einundzwanzig.space` verlangt
 * sie zum Schreiben, gemessen 2026-08-21), und ein Zähler, der um eins hochspringt und
 * beim nächsten Laden wieder fällt, sieht wie ein Fehler des Relays aus.
 *
 * Gibt `''` bei Erfolg, sonst die übersetzte Relay-Begründung — dieselbe Konvention wie
 * überall im Haus, und {@link mapRelayError} führt seit P7 den Originaltext des Relays
 * wörtlich mit.
 */
export const publishOptimistic = async (
    url: string,
    event: ThunkOptions['event'],
): Promise<string> => {
    const thunk = app.use(Thunks).publish({ relays: [url], event })
    const err = await waitForPublishError(thunk)
    if (err) {
        app.repository.removeEvent(thunk.event.id)
    }

    return err ? mapRelayError(err) : ''
}
