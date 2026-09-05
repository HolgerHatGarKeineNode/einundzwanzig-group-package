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
import { mapRelayError, rollBackAfterPublish, waitForPublishOutcome } from './publishResult.ts'

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
 *
 * ── `url` takes a LIST since P2, and the rollback rule changed with it ──────────────
 *
 * The NIP-52 calendar (`calendar.ts`) writes its RSVP to SEVERAL relays: the dates live
 * on the portal's public addresses, and an answer that lands on only one of them does
 * not exist for anybody reading the other. Writing a second thunk by hand in
 * `calendar.ts` would have been exactly the copy this file's header argues against —
 * two answers to "what happens on a relay reject", of which the second ages unnoticed.
 *
 * The widening is SOURCE-COMPATIBLE: all 16 existing calls pass a string and go through
 * the same branch. `readonly string[]` because the callers keep their relay list as a
 * module constant.
 *
 * **And the rollback now asks "did it land ANYWHERE", not "was anything wrong".** With
 * one relay the two questions have the same answer, so nothing changes for the 16; with
 * several they come apart, and the old reading destroyed real writes. See
 * {@link publishSpreadOptimistic}, which is where the distinction lives — this function
 * only flattens it back to the one-string convention.
 */
export const publishOptimistic = async (
    url: string | readonly string[],
    event: ThunkOptions['event'],
): Promise<string> => (await publishSpreadOptimistic(url, event)).error

/** What a publish across several relays actually did. */
export type OptimisticSpread = {
    /** `''` = landed everywhere, otherwise the translated reason of the first failure. */
    error: string
    /** The relays that took it. Empty means the event was rolled back locally. */
    delivered: string[]
    /** The relays that did not. */
    failed: string[]
}

/**
 * The same publish, but reporting WHERE the event ended up.
 *
 * ## The rule, and the measurement behind it
 *
 * `{nos.lol: success, relay.damus.io: timeout}` used to be reported as a failure and
 * rolled back — while nos.lol kept the event, publicly and permanently. On 2026-09-05
 * `relay.damus.io` answered 5 of 8 attempts with `503`; for a two-relay write the
 * partial result is the ordinary case, not an edge one.
 *
 * So the event is removed again only when **nothing** landed. A caller with a non-empty
 * `failed` next to a non-empty `delivered` has a write that happened, and it is the
 * caller's job to say so rather than to pretend either way.
 *
 * The reason string is still filled on a partial result: it names what went wrong. It is
 * the wrong thing to render as an error on its own, which is why `delivered` is here.
 */
export const publishSpreadOptimistic = async (
    url: string | readonly string[],
    event: ThunkOptions['event'],
): Promise<OptimisticSpread> => {
    const thunk = app.use(Thunks).publish({ relays: typeof url === 'string' ? [url] : [...url], event })
    const outcome = await waitForPublishOutcome(thunk)
    // Through the pure rule and not inline: see {@link rollBackAfterPublish}. Written
    // out here, a mutation back to `if (outcome.error)` left every test green.
    if (rollBackAfterPublish(outcome)) {
        app.repository.removeEvent(thunk.event.id)
    }

    return {
        error: outcome.error ? mapRelayError(outcome.error) : '',
        delivered: outcome.delivered,
        failed: outcome.failed,
    }
}
