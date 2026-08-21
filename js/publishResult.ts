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
    new Promise((resolve) => {
        const started = Date.now()
        let settled = false
        const settle = (err: string) => {
            if (settled) {
                return
            }
            settled = true
            clearTimeout(timer)
            resolve(err)
        }
        const timer = setTimeout(() => {
            const reason = (thunk.options?.relays ?? []).map((url) => readNotice(url, started)).find(Boolean) ?? ''
            settle(reason ? `${NO_VERDICT_ERROR} ${reason}` : NO_VERDICT_ERROR)
        }, PUBLISH_VERDICT_TIMEOUT_MS)
        thunk.subscribe(($thunk) => {
            const err = publishError($thunk.results)
            if (err !== undefined) {
                settle(err)
            }
        })
    })

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
export const mapRelayError = (raw: string): string => {
    const grund = raw.trim()
    if (!grund) {
        return t('Konnte nicht gesendet werden.')
    }
    const s = grund.toLowerCase()
    // Reihenfolge = Spezifität. `auth` steht ZULETZT, weil das Wort als Teilzeichenkette
    // in vielen Ablehnungen vorkommt (`unauthorized`, `authentication`) und sonst
    // spezifischere Gründe verschluckte.
    const hinweis =
        s.includes('rate') && s.includes('limit')
            ? t('Zu viele Nachrichten in kurzer Zeit — kurz warten und erneut senden.')
            : s.includes('nip-05') || s.includes('nip05')
              ? t('Dieses Relay nimmt nur Beiträge von Konten mit verifizierter NIP-05-Adresse an.')
              : s.includes('member')
                ? t('Du bist kein Mitglied dieses Relays.')
                : s.includes('auth')
                  ? t('Am Relay nicht angemeldet — bitte erneut senden.')
                  : ''

    return hinweis ? `${hinweis} (${grund})` : t('Vom Relay abgelehnt: :grund', { grund })
}
