/**
 * P5 Punkt 1 — die reine Entscheidung hinter `RECONNECT_MIN_GAP_MS`
 * (`verein.ts`, `_reconnectDirectory`), herausgelöst wie `vereinFlow.ts`s
 * Reduzierer: ohne einen einzigen Import, damit sie unter `node --test` läuft.
 *
 * **Warum eine eigene Datei und nicht in `vereinFlow.ts`:** die parallele
 * Copy-/Übersetzungs-Phase dieses Plans arbeitet gerade in `vereinFlow.ts` —
 * eine weitere Datei ist hier der Unterschied zwischen einer Ein-Zeilen-Änderung
 * und einem Merge-Konflikt in fremder Arbeit.
 *
 * **Was diese Datei NICHT abdeckt:** ob `Pool.get().remove(url)` bei einem
 * fälligen Abriss tatsächlich aufgerufen wird — das ist Verdrahtung, keine
 * Arithmetik, und dafür bräuchte es einen echten (oder Buzz-simulierenden)
 * Relay-Socket. Siehe `tests/e2e/verein-buzz-reconnect.spec.ts` (geskippt,
 * blockiert von einem separaten Fund in `authHold.ts`).
 */

/**
 * Ist ein Socket-Abriss gegen Buzz fällig? Reine Millisekunden-Arithmetik,
 * `now`/`lastReconnectAt` als Parameter statt `Date.now()`-Aufruf — deterministisch
 * testbar, ohne die Systemzeit zu fälschen.
 *
 * `lastReconnectAt === 0` (noch nie abgerissen) ist IMMER fällig — das ist der
 * Zustand direkt nach `init()`, bevor je ein Abriss stattfand.
 */
export const reconnectDue = (now: number, lastReconnectAt: number, minGapMs: number): boolean =>
    now - lastReconnectAt >= minGapMs
