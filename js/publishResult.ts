/**
 * Ehrliche Auswertung eines welshman-Publish-Ergebnisses.
 *
 * **Warum das hier steht statt `waitForThunkError` aus `@welshman/app`:** dessen
 * `getThunkError` meldet nur `PublishStatus.Failure` als Fehler —
 *
 * ```js
 * export const getThunkError = (thunk) => {
 *     for (const [_, {status, detail}] of Object.entries(thunk.results)) {
 *         if (status === PublishStatus.Failure) return detail
 *     }
 *     if (thunkIsComplete(thunk)) return ""      // <- hier landen Timeout UND Aborted
 * }
 * export const thunkIsComplete = (thunk) =>
 *     !thunkHasStatus([PublishStatus.Sending, PublishStatus.Pending], thunk)
 * ```
 *
 * `PublishStatus` kennt sechs Werte (`net/src/publish.js`): `sending`, `pending`,
 * `success`, `failure`, `timeout`, `aborted`. Ein **Timeout** und ein **Abbruch** sind
 * weder `Sending` noch `Pending`, also gilt der Thunk als „komplett" — und
 * `waitForThunkError` liefert `''`, den Erfolgs-Code. welshman selbst zählt `Timeout`
 * an anderer Stelle sehr wohl zu den Fehlschlägen (`getFailedThunkUrls`); nur diese
 * eine Auswertung tut es nicht.
 *
 * **Was das im Betrieb anrichtet:** Der Aufrufer hält ein nie gesendetes Event für
 * zugestellt. Aufgefallen an `buzz-moderation:95` — in roten Läufen liegt am Relay
 * KEIN 9005, der Client meldet trotzdem Erfolg, macht mit dem 9044 weiter und schließt
 * die Meldung. Ergebnis: Report `resolved`, Inhalt noch da, kein Fehler, kein Hinweis.
 * Dieselbe Falle steckt in jeder anderen Mutation — Raum anlegen, umbenennen,
 * beitreten, Mitglied aufnehmen.
 *
 * Diese Auswertung ist bewusst umgekehrt gebaut: **alles außer `success` ist ein
 * Fehler**, auch ein künftiger Status, den es heute noch nicht gibt.
 */
/** Ergebniszeile eines Relays, so wie `thunk.results` sie führt. */
export type PublishResultRow = { status?: string; detail?: string }

/**
 * `''` = überall zugestellt · `undefined` = noch nicht entschieden (läuft noch oder
 * es gibt noch gar kein Ergebnis) · sonst die Begründung des ersten Relays, das
 * nicht `success` gemeldet hat.
 *
 * Pure Funktion, damit sie ohne Relay testbar ist.
 */
export const publishError = (results: Record<string, PublishResultRow> | undefined): string | undefined => {
    const rows = Object.values(results ?? {})
    if (rows.length === 0) {
        return undefined
    }
    if (rows.some((r) => r.status === 'sending' || r.status === 'pending')) {
        return undefined
    }
    const bad = rows.find((r) => r.status !== 'success')
    if (!bad) {
        return ''
    }
    return bad.detail || bad.status || 'Publish fehlgeschlagen'
}

type ThunkLike = {
    results?: Record<string, PublishResultRow>
    subscribe: (cb: (t: { results?: Record<string, PublishResultRow> }) => void) => unknown
}

/**
 * Ersatz für `waitForThunkError`: wartet, bis jedes Relay einen Endstatus hat, und
 * meldet alles außer `success` als Fehler. `''` = Erfolg — dieselbe Konvention wie
 * überall sonst im Client, damit die Aufrufer unverändert bleiben.
 */
export const waitForPublishError = (thunk: ThunkLike): Promise<string> =>
    new Promise((resolve) => {
        let settled = false
        thunk.subscribe(($thunk) => {
            if (settled) {
                return
            }
            const err = publishError($thunk.results)
            if (err !== undefined) {
                settled = true
                resolve(err)
            }
        })
    })
