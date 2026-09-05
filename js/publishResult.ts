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
import { t } from './i18n.ts'

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
    return bad.detail || bad.status || t('Publish fehlgeschlagen')
}

/**
 * Die BESTÄTIGUNG des Relays, wörtlich — `''`, wenn es keine gibt.
 *
 * **Warum das eine zweite Auswertung neben {@link publishError} ist.** Diese liest die
 * `detail`-Zeile des ERSTEN Relays, das `success` gemeldet hat; jene die des ersten, das
 * es NICHT hat. Zwei Fragen, zwei Funktionen — ein gemeinsamer Rückgabewert müsste an
 * jeder Aufrufstelle wieder auseinandergenommen werden.
 *
 * **Wofür es das überhaupt braucht.** NIP-01 lässt das `OK`-Frame auch bei `true` eine
 * Nachricht tragen, und Buzz benutzt genau das als Antwortkanal seiner Kommando-Kinds:
 * ein 41010 wird nicht mit einem Ereignis beantwortet, sondern mit
 * `response:{"channel_id":"…","created":true}` im `OK` (`command_executor.rs:436-447`).
 * welshman hebt den Text auf — `publishOne` setzt `result.detail = detail` auch im
 * Erfolgszweig (`@welshman/net` `publish.js:56-59`) —, aber die vorhandenen Auswerter
 * kommen nicht an ihn heran: `getUrlsWithStatus(PublishStatus.Success)` liefert URLs,
 * und {@link publishError} sieht eine erfolgreiche Zeile gar nicht erst an.
 *
 * `undefined` heißt „noch nicht entschieden" — dieselbe Konvention wie oben, damit beide
 * an derselben Stelle abgefragt werden können.
 */
export const publishDetail = (results: Record<string, PublishResultRow> | undefined): string | undefined => {
    const rows = Object.values(results ?? {})
    if (rows.length === 0) {
        return undefined
    }
    if (rows.some((r) => r.status === 'sending' || r.status === 'pending')) {
        return undefined
    }

    return rows.find((r) => r.status === 'success')?.detail ?? ''
}

/**
 * Which relays took the event and which did not — the third reading next to
 * {@link publishError} and {@link publishDetail}, and the one that tells "nowhere" from
 * "somewhere" apart.
 *
 * ## Why the first two are not enough
 *
 * `publishError` reports the reason of the FIRST relay that did not answer `success`.
 * That is the right answer to "is anything wrong", and the wrong one to "did the write
 * happen": with `{nos.lol: success, relay.damus.io: timeout}` it returns `"timeout"`,
 * and a caller that rolls back on any error removes an event that one relay is holding
 * — publicly, permanently, and out of the client's reach.
 *
 * That combination is not exotic. Measured on 2026-09-05, `relay.damus.io` answered 5 of
 * 8 attempts with `503`; for a two-relay write the partial result is the ordinary case.
 *
 * `undefined` while anything is still `sending`/`pending`, or when there is no result at
 * all — same convention as its two neighbours.
 */
export const publishSpread = (
    results: Record<string, PublishResultRow> | undefined,
): { delivered: string[]; failed: string[] } | undefined => {
    const rows = Object.entries(results ?? {})
    if (rows.length === 0) {
        return undefined
    }
    if (rows.some(([, r]) => r.status === 'sending' || r.status === 'pending')) {
        return undefined
    }

    return {
        delivered: rows.filter(([, r]) => r.status === 'success').map(([url]) => url),
        // Everything that is not `success` counts as failed, including a status this
        // version does not know yet — the same inversion the module header argues for.
        failed: rows.filter(([, r]) => r.status !== 'success').map(([url]) => url),
    }
}

/**
 * Should the optimistically inserted event be taken out of the repository again?
 *
 * **Only when it landed NOWHERE.** The rule is one line and it is here, pure and
 * exported, because it is the one that was silently wrong: rolling back on
 * `error !== ''` deletes the local copy of an event that a relay is holding — publicly,
 * permanently, and out of the client's reach. `publishOptimistic` used to do exactly
 * that, and on a two-relay write the partial result is the ordinary case (measured
 * 2026-09-05: `relay.damus.io` answered 5 of 8 attempts with `503`).
 *
 * A rule that only exists inside the `if` of a network function cannot be falsified: a
 * mutation back to `if (outcome.error)` left every test in this repository green.
 */
export const rollBackAfterPublish = (spread: { delivered: readonly string[] }): boolean =>
    spread.delivered.length === 0

type ThunkLike = {
    results?: Record<string, PublishResultRow>
    /** welshmans `Thunk` trägt hier seine Zielrelays — die Quelle für die NOTICE-Nachfrage. */
    options?: { relays?: readonly string[] }
    subscribe: (cb: (t: { results?: Record<string, PublishResultRow> }) => void) => unknown
}

/**
 * Liest die Relay-Begründung (`NOTICE`), die seit `since` für `url` eintraf.
 *
 * Wird von `relayNotices.ts` beim App-Boot gesetzt. Der Default liefert '' — dieses Modul
 * bleibt damit frei von `@welshman/net` und unter `node --test` ladbar, und ein Host ohne
 * den Mitschnitt bekommt eine etwas ärmere, aber nicht falsche Meldung.
 */
let readNotice: (url: string, since: number) => string = () => ''

export const setRelayNoticeReader = (fn: (url: string, since: number) => string): void => {
    readNotice = fn
}

/**
 * Wie lange auf ein Verdikt gewartet wird, bevor der Vorgang als fehlgeschlagen gilt.
 *
 * Der Wert liegt bewusst über welshmans eigenem Publish-Timeout (dessen `timeout`-Status
 * ist ein regulärer Endstatus und wird oben schon als Fehler gewertet): diese Grenze fängt
 * nur den Fall ab, in dem **gar kein Verdikt kommt** — dann greift auch welshmans Timer
 * nicht, weil es nichts gibt, dem er ein Ergebnis zuordnen könnte.
 */
export const PUBLISH_VERDICT_TIMEOUT_MS = 20_000

/** Die Meldung, wenn das Relay überhaupt nichts zum Event gesagt hat. */
export const NO_VERDICT_ERROR = t('Das Relay hat den Vorgang nicht bestätigt.')

/** Ausgang eines Publish MIT der Bestätigungszeile des Relays. */
export type PublishOutcome = {
    /** `''` = zugestellt, sonst die (bereits übersetzte) Begründung. */
    error: string
    /** `detail` des `OK`-Frames bei Erfolg, sonst `''`. */
    detail: string
    /**
     * The relays that took the event. EMPTY is the only state that means "nowhere" —
     * `error !== ''` does not, see {@link publishSpread}.
     */
    delivered: string[]
    /** The relays that did not, for any reason (rejection, timeout, abort, no verdict). */
    failed: string[]
}

/**
 * Wie {@link waitForPublishError}, liefert aber zusätzlich die Bestätigungszeile.
 *
 * Für Buzz' Kommando-Kinds (41010/41011/41012) ist diese Zeile das ganze Ergebnis: sie
 * trägt die `channel_id` des Kanals, den der Relay gerade angelegt oder wiedergefunden
 * hat. Ohne sie wüsste der Client nur, DASS das Kommando durchging — und müsste die
 * frisch eröffnete Unterhaltung raten oder erst über einen zweiten REQ suchen.
 *
 * Die Zeitgrenze, der NOTICE-Rückgriff und die Regel „alles außer `success` ist ein
 * Fehler" sind unverändert die von {@link waitForPublishError}; diese Funktion ist die
 * ehrliche Verallgemeinerung, nicht ein zweiter Weg daneben. Deshalb ist auch die andere
 * jetzt in ihr ausgedrückt statt daneben kopiert — zwei Fassungen derselben Wartezeit
 * wären zwei Wahrheiten über den Abbruchfall.
 */
export const waitForPublishOutcome = (thunk: ThunkLike): Promise<PublishOutcome> =>
    new Promise((resolve) => {
        const started = Date.now()
        let settled = false
        const settle = (outcome: PublishOutcome) => {
            if (settled) {
                return
            }
            settled = true
            clearTimeout(timer)
            resolve(outcome)
        }
        const timer = setTimeout(() => {
            const reason = (thunk.options?.relays ?? []).map((url) => readNotice(url, started)).find(Boolean) ?? ''
            // No verdict at all means nothing is known to have landed anywhere — the
            // spread has to say so, or a caller would read the empty `failed` as "fine".
            settle({
                error: reason ? `${NO_VERDICT_ERROR} ${reason}` : NO_VERDICT_ERROR,
                detail: '',
                delivered: [],
                failed: [...(thunk.options?.relays ?? [])],
            })
        }, PUBLISH_VERDICT_TIMEOUT_MS)
        thunk.subscribe(($thunk) => {
            const err = publishError($thunk.results)
            if (err !== undefined) {
                const spread = publishSpread($thunk.results) ?? { delivered: [], failed: [] }
                settle({ error: err, detail: publishDetail($thunk.results) ?? '', ...spread })
            }
        })
    })

/**
 * Ersatz für `waitForThunkError`: wartet, bis jedes Relay einen Endstatus hat, und
 * meldet alles außer `success` als Fehler. `''` = Erfolg — dieselbe Konvention wie
 * überall sonst im Client, damit die Aufrufer unverändert bleiben.
 *
 * **Es gibt eine Zeitgrenze, und die ist kein Sicherheitsnetz, sondern eine gemessene
 * Notwendigkeit.** Buzz antwortet auf ein ratenbegrenztes `EVENT` mit einer nackten
 * `NOTICE` statt mit einem `OK` (NIP-01 verlangt das `OK`; Fundstelle und Mitschnitt in
 * `relayNotices.ts`). welshman ordnet Publish-Ergebnisse über die Event-Id aus dem `OK`
 * zu — ohne `OK` bleibt der Thunk für IMMER `pending`. Ohne diese Grenze wartete der
 * Aufrufer ewig: kein Fehler, keine Meldung, der Knopf bleibt `busy`. Genau so verschwand
 * eine Moderations-Löschung spurlos, und genau das trug den `buzz-moderation:95`-Flake.
 *
 * Läuft die Grenze ab, nennt die Meldung die **echte** Relay-Begründung, sofern in dieser
 * Zeit eine NOTICE kam („rate-limited: quota exceeded; retry in 2s") — statt einer
 * Vermutung. Die Zielrelays kommen aus dem Thunk selbst, damit die Härtung an ALLEN
 * Aufrufstellen gleichzeitig greift: betroffen ist nicht eine Aktion, sondern jede Mutation.
 */
export const waitForPublishError = (thunk: ThunkLike): Promise<string> =>
    waitForPublishOutcome(thunk).then((outcome) => outcome.error)


/**
 * Rohe Relay-Ablehnung → deutscher Text, **der den Grund des Relays mitführt**.
 *
 * ── Was hier vorher stand, und warum es der teuerste Fehler dieser Kette war ────────
 *
 * Die frühere Fassung ersetzte den Relay-Grund durch einen eigenen Satz:
 *
 * ```ts
 * if (s.includes('restrict') || s.includes('blocked') || …) {
 *     return t('Nachricht vom Relay abgelehnt — du bist evtl. kein Mitglied dieses Raums.')
 * }
 * ```
 *
 * Für zooid (`restricted: you are not a member of this relay`) traf das zu. Für den
 * Artikel-Relay trifft es **nicht** zu: `wss://nostr.einundzwanzig.space` ist
 * nostr-rs-relay 0.10.0 mit `restricted_writes: true` und **ohne NIP-42**; er lehnt mit
 * `blocked: NIP-05 verification needed to publish events` ab (gemessen 2026-08-21 an
 * seiner NIP-11 und am Ablehnungstext). Der Nutzer las dann „du bist evtl. kein Mitglied
 * dieses Raums" — eine **erfundene Ursache**, und zwar eine, die in die falsche Richtung
 * schickt: nicht die Mitgliedschaft fehlt, sondern die NIP-05-Verifikation, und die
 * repariert man woanders. Für Buzz (`restricted: unknown event kind`) war derselbe Satz
 * ebenso falsch.
 *
 * ── Die Regel, die daraus folgt ────────────────────────────────────────────────────
 *
 * 1. **Der Originaltext des Relays geht nie verloren.** Er steht wörtlich in der Meldung.
 *    Er ist das einzige, was am Vorgang belegt ist; alles andere ist unsere Deutung.
 * 2. **Ein Hinweis nur dort, wo der Originaltext ihn trägt.** Gesucht wird nach dem
 *    konkreten Wortlaut (`member`, `nip-05`, …), nicht nach der groben Klasse
 *    (`blocked`) — eine Klasse deckt viele Ursachen ab, und genau daraus entstand die
 *    Erfindung oben.
 * 3. **Ohne passenden Hinweis: nur der Grund.** „Vom Relay abgelehnt: <Grund>" sagt
 *    weniger und behauptet nichts.
 *
 * Der Gegenfall steht im Gedächtnis und ist der Grund für {@link PUBLISH_VERDICT_TIMEOUT_MS}:
 * bei Buzz' Ratenbegrenzer kommt gar kein `OK`, sondern eine nackte `NOTICE` — dort gibt
 * es keinen Grund zum Mitführen, und die Meldung sagt das (`NO_VERDICT_ERROR`).
 *
 * Exportiert und in `publishResult.ts` statt in `feeds.ts`, damit ein `node --test` sie
 * fahren kann: `feeds.ts` ist unter node nicht ladbar (endungslose Importe, danach
 * `localStorage` beim Import von `session.ts`).
 */
/**
 * Der HANDLUNGSLEITENDE Satz zu einer Relay-Begründung — oder `''`, wenn der
 * Wortlaut keinen trägt.
 *
 * **Warum das seit dem 2026-08-27 eine eigene Funktion ist und nicht mehr nur eine
 * lokale Konstante in {@link mapRelayError}:** weil es einen zweiten Aufrufer gibt,
 * und zwar genau für den Fall, wegen dem dieses Modul überhaupt existiert.
 *
 * `mapRelayError` setzt eine ABLEHNUNG voraus („Vom Relay abgelehnt: …"). Beim
 * Ratenbegrenzer von Buzz gibt es aber gar keine Ablehnung, sondern eine nackte
 * `NOTICE` und **kein `OK`** — {@link waitForPublishError} macht daraus
 * {@link NO_VERDICT_ERROR} plus den NOTICE-Wortlaut. Dieses Gebilde durch
 * `mapRelayError` zu schicken, ergäbe „Vom Relay abgelehnt: Das Relay hat den
 * Vorgang nicht bestätigt." — ein Satz, der sich selbst widerspricht und obendrein
 * eine Ablehnung behauptet, die nicht stattgefunden hat.
 *
 * Der Hinweis ist trotzdem derselbe und wird dort genauso gebraucht: „kurz warten
 * und erneut senden" ist bei einem Ratenbegrenzer die einzige richtige Handlung,
 * ob er nun mit `OK false` oder mit einer NOTICE antwortet. Deshalb ist die
 * Zuordnung Wortlaut → Handlung hier herausgezogen und die Rahmung dem Aufrufer
 * überlassen.
 *
 * Reihenfolge = Spezifität. `auth` steht ZULETZT, weil das Wort als
 * Teilzeichenkette in vielen Ablehnungen vorkommt (`unauthorized`,
 * `authentication`) und sonst spezifischere Gründe verschluckte.
 */
export const relayHinweis = (raw: string): string => {
    const s = raw.trim().toLowerCase()
    if (s.includes('rate') && s.includes('limit')) {
        return t('Zu viele Nachrichten in kurzer Zeit — kurz warten und erneut senden.')
    }
    if (s.includes('nip-05') || s.includes('nip05')) {
        return t('Dieses Relay nimmt nur Beiträge von Konten mit verifizierter NIP-05-Adresse an.')
    }
    if (s.includes('member')) {
        return t('Du bist kein Mitglied dieses Relays.')
    }
    if (s.includes('auth')) {
        return t('Am Relay nicht angemeldet — bitte erneut senden.')
    }

    return ''
}

export const mapRelayError = (raw: string): string => {
    const grund = raw.trim()
    if (!grund) {
        return t('Konnte nicht gesendet werden.')
    }
    const hinweis = relayHinweis(grund)

    return hinweis ? `${hinweis} (${grund})` : t('Vom Relay abgelehnt: :grund', { grund })
}

/**
 * Die Meldung, die ein Nutzer nach einem gescheiterten Publish zu sehen bekommt —
 * **mit** dem handlungsleitenden Satz und **ohne** eine erfundene Ablehnung.
 *
 * Sie unterscheidet die zwei Ausgänge, die {@link waitForPublishError} liefern
 * kann, weil sie sachlich verschieden sind:
 *
 * - **Der Relay hat abgelehnt** (`OK false`, ein `detail` liegt vor) → das ist
 *   `mapRelayError`: Hinweis plus wörtlicher Grund, sonst „Vom Relay abgelehnt: …".
 * - **Der Relay hat NICHTS gesagt** (Buzz' Ratenbegrenzer antwortet mit einer
 *   `NOTICE` statt mit dem von NIP-01 verlangten `OK`; welshman ordnet ohne `OK`
 *   nichts zu und bliebe für immer `pending`) → hier steht `NO_VERDICT_ERROR`
 *   vorn, gefolgt vom NOTICE-Wortlaut, sofern einer kam. Der Satz bleibt stehen,
 *   wie er ist — und bekommt den handlungsleitenden Hinweis VORANGESTELLT, wenn
 *   der Wortlaut einen trägt.
 *
 * `''` bleibt `''`: Erfolg ist kein Sonderfall.
 */
export const publishFehlermeldung = (raw: string): string => {
    if (!raw) {
        return ''
    }
    if (!raw.startsWith(NO_VERDICT_ERROR)) {
        return mapRelayError(raw)
    }
    const hinweis = relayHinweis(raw)

    return hinweis ? `${hinweis} (${raw})` : raw
}
